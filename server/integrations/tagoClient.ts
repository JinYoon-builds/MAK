import { config, requireEnv } from '../config.js';

export type TagoItem = Record<string, string | number | undefined>;

function appendParams(base: string, params: Record<string, string | number | undefined>) {
  requireEnv('DATA_GO_KR_SERVICE_KEY');
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  query.set('_type', 'json');
  const serviceKey = config.dataGoKrServiceKey;
  const separator = base.includes('?') ? '&' : '?';
  // 공공데이터포털의 encoding key는 URLSearchParams로 한 번 더 인코딩되면 인증 실패할 수 있어 raw append한다.
  return `${base}${separator}serviceKey=${serviceKey}&${query.toString()}`;
}

function asArray(item: unknown): TagoItem[] {
  if (!item) return [];
  return Array.isArray(item) ? (item as TagoItem[]) : [item as TagoItem];
}

async function request(operation: string, params: Record<string, string | number | undefined> = {}) {
  const url = appendParams(`${config.tagoBaseUrl}/${operation}`, params);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`TAGO HTTP ${response.status}`);
    const json = await response.json();
    const header = json?.response?.header;
    const resultCode = header?.resultCode;
    if (resultCode && resultCode !== '00') {
      throw new Error(`TAGO ${resultCode}: ${header?.resultMsg ?? 'Unknown error'}`);
    }
    return asArray(json?.response?.body?.items?.item);
  } finally {
    clearTimeout(timeout);
  }
}

export function getCityCodes() {
  return request('GetCtyCodeList', { pageNo: 1, numOfRows: 100 });
}

export function getStationsByCity(cityCode: string | number) {
  return request('GetCtyAcctoTrainSttnList', { cityCode, pageNo: 1, numOfRows: 200 });
}

export function getVehicleKinds() {
  return request('GetVhcleKndList', { pageNo: 1, numOfRows: 100 });
}

export function getTrains(params: {
  depPlaceId: string;
  arrPlaceId: string;
  depPlandTime: string;
  trainGradeCode?: string;
  numOfRows?: number;
}) {
  return request('GetStrtpntAlocFndTrainInfo', {
    pageNo: 1,
    numOfRows: params.numOfRows ?? 50,
    depPlaceId: params.depPlaceId,
    arrPlaceId: params.arrPlaceId,
    depPlandTime: params.depPlandTime,
    trainGradeCode: params.trainGradeCode
  });
}
