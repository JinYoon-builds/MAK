export function todayInSeoul() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function toYyyymmdd(date: string) {
  return date.replaceAll('-', '').slice(0, 8);
}

export function formatKoreanDate(date?: string) {
  if (!date) return '오늘';
  const today = todayInSeoul();
  if (date === today) return '오늘';
  return date;
}

export function normalizeTimeForFilter(date: string, time?: string) {
  if (!time) return null;
  const [h = '0', m = '0'] = time.split(':');
  return new Date(`${date}T${h.padStart(2, '0')}:${m.padStart(2, '0')}:00+09:00`).getTime();
}

export function parseTagoDateTime(value: string | number) {
  const s = String(value);
  const y = s.slice(0, 4);
  const mo = s.slice(4, 6);
  const d = s.slice(6, 8);
  const h = s.slice(8, 10) || '00';
  const mi = s.slice(10, 12) || '00';
  const sec = s.slice(12, 14) || '00';
  return `${y}-${mo}-${d}T${h}:${mi}:${sec}+09:00`;
}

export function minutesBetween(startIso: string, endIso: string) {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
}
