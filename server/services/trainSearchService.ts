import type { TicketIntent, TrainCandidate } from '../../src/types.js';
import { getCityCodes, getStationsByCity, getTrains, getVehicleKinds, type TagoItem } from '../integrations/tagoClient.js';
import { minutesBetween, normalizeTimeForFilter, parseTagoDateTime, toYyyymmdd, todayInSeoul } from './dateTime.js';

export type Station = { id: string; name: string; cityCode?: string; cityName?: string };
export type VehicleKind = { code: string; name: string };

let stationCache: { expiresAt: number; stations: Station[] } | null = null;
let vehicleCache: { expiresAt: number; vehicles: VehicleKind[] } | null = null;

function cleanStationName(name: string) {
  return name.replace(/역$/u, '').trim();
}

function itemString(item: TagoItem, keys: string[]) {
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

export async function listStations(force = false): Promise<Station[]> {
  if (!force && stationCache && stationCache.expiresAt > Date.now()) return stationCache.stations;
  const cities = await getCityCodes();
  const stations: Station[] = [];
  for (const city of cities) {
    const cityCode = itemString(city, ['citycode', 'cityCode']);
    const cityName = itemString(city, ['cityname', 'cityName']);
    if (!cityCode) continue;
    const rows = await getStationsByCity(cityCode);
    for (const row of rows) {
      const id = itemString(row, ['nodeid', 'nodeId']);
      const name = itemString(row, ['nodename', 'nodeName']);
      if (id && name) stations.push({ id, name, cityCode, cityName });
    }
  }
  stationCache = { stations, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
  return stations;
}

export async function listVehicleKinds(force = false): Promise<VehicleKind[]> {
  if (!force && vehicleCache && vehicleCache.expiresAt > Date.now()) return vehicleCache.vehicles;
  const rows = await getVehicleKinds();
  const vehicles = rows
    .map((row) => ({ code: itemString(row, ['vehiclekndid', 'vehicleKndId']), name: itemString(row, ['vehiclekndnm', 'vehicleKndNm']) }))
    .filter((row) => row.code && row.name);
  vehicleCache = { vehicles, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
  return vehicles;
}

export async function resolveStation(name: string) {
  const stations = await listStations();
  const needle = cleanStationName(name);
  return (
    stations.find((s) => s.name === name) ||
    stations.find((s) => cleanStationName(s.name) === needle) ||
    stations.find((s) => cleanStationName(s.name).includes(needle))
  );
}

async function resolveKtxCode() {
  const vehicles = await listVehicleKinds();
  return vehicles.find((v) => /KTX/i.test(v.name))?.code;
}

function tagTrain(row: TrainCandidate, all: TrainCandidate[]): TrainCandidate['tags'] {
  const tags: TrainCandidate['tags'] = [];
  const fastest = [...all].sort((a, b) => new Date(a.arrivalAt).getTime() - new Date(b.arrivalAt).getTime())[0];
  const cheapest = [...all]
    .filter((x) => typeof x.adultFareKrw === 'number')
    .sort((a, b) => (a.adultFareKrw ?? Infinity) - (b.adultFareKrw ?? Infinity))[0];
  const soonest = [...all].sort((a, b) => new Date(a.departureAt).getTime() - new Date(b.departureAt).getTime())[0];
  if (fastest?.id === row.id) tags.push('fastest');
  if (cheapest?.id === row.id) tags.push('cheapest');
  if (soonest?.id === row.id) tags.push('soonest');
  if (tags.length === 0) tags.push('recommended');
  return tags;
}

export async function searchTrains(intent: TicketIntent): Promise<TrainCandidate[]> {
  if (!intent.arrivalStation) throw new Error('arrivalStation is required');
  const date = intent.date || todayInSeoul();
  const departure = await resolveStation(intent.departureStation || '서울');
  const arrival = await resolveStation(intent.arrivalStation);
  if (!departure || !arrival) throw new Error('Could not resolve station');
  const ktxCode = intent.trainTypes?.includes('ANY') ? undefined : await resolveKtxCode();
  const rows = await getTrains({
    depPlaceId: departure.id,
    arrPlaceId: arrival.id,
    depPlandTime: toYyyymmdd(date),
    trainGradeCode: ktxCode,
    numOfRows: 80
  });

  const threshold = normalizeTimeForFilter(date, intent.timePreference?.time);
  const normalized = rows.map((row, index): TrainCandidate => {
    const departureAt = parseTagoDateTime(itemString(row, ['depplandtime', 'depPlandTime']));
    const arrivalAt = parseTagoDateTime(itemString(row, ['arrplandtime', 'arrPlandTime']));
    const trainNo = itemString(row, ['trainno', 'trainNo']) || String(index + 1);
    return {
      id: `${trainNo}-${departureAt}`,
      trainNo,
      trainName: itemString(row, ['traingradename', 'trainGradeName']) || '기차',
      departureStation: itemString(row, ['depplacename', 'depPlaceName']) || departure.name,
      arrivalStation: itemString(row, ['arrplacename', 'arrPlaceName']) || arrival.name,
      departureAt,
      arrivalAt,
      durationMinutes: minutesBetween(departureAt, arrivalAt),
      adultFareKrw: Number(itemString(row, ['adultcharge', 'adultCharge'])) || undefined,
      tags: ['recommended'],
      source: 'TAGO'
    };
  });

  const filtered = normalized
    .filter((row) => !threshold || new Date(row.departureAt).getTime() >= threshold)
    .sort((a, b) => new Date(a.departureAt).getTime() - new Date(b.departureAt).getTime())
    .slice(0, 8);

  const tagged = filtered.map((row) => ({ ...row, tags: tagTrain(row, filtered) }));
  const fastest = tagged.find((row) => row.tags.includes('fastest'));
  const cheapest = tagged.find((row) => row.tags.includes('cheapest'));
  const picked: TrainCandidate[] = [];
  if (fastest) picked.push({ ...fastest, tags: ['fastest'] });
  if (cheapest && cheapest.id !== fastest?.id) picked.push({ ...cheapest, tags: ['cheapest'] });

  for (const candidate of tagged) {
    if (picked.length >= 2) break;
    if (picked.some((item) => item.id === candidate.id)) continue;
    picked.push({ ...candidate, tags: ['recommended'] });
  }

  return picked.slice(0, 2);
}
