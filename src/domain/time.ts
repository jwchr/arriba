// Service-day time handling. GTFS times count from "noon minus 12 hours" on the service date in the
// agency timezone, so 25:10:00 is 1:10 AM the next calendar day and DST days are handled correctly.

/** Offset of `timeZone` from UTC, in minutes, at the given instant. */
export function tzOffsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - (instant - (instant % 1000))) / 60000);
}

/** Epoch ms of local wall-clock time y-m-d h:m in `timeZone`. */
export function zonedWallTime(y: number, m: number, d: number, h: number, min: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess - tzOffsetMinutes(guess, timeZone) * 60000;
  // One correction pass handles instants near a DST change.
  t = guess - tzOffsetMinutes(t, timeZone) * 60000;
  return t;
}

export function parseYmd(ymd: string): [number, number, number] {
  return [Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)), Number(ymd.slice(6, 8))];
}

/** Epoch ms for a GTFS service-day time (seconds since noon-minus-12h). */
export function serviceTimeToInstant(serviceDate: string, seconds: number, timeZone: string): number {
  const [y, m, d] = parseYmd(serviceDate);
  const noon = zonedWallTime(y, m, d, 12, 0, timeZone);
  return noon - 12 * 3600_000 + seconds * 1000;
}

/** YYYYMMDD of the local calendar date of `instant` in `timeZone`. */
export function localYmd(instant: number, timeZone: string): string {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(instant),
  );
  return s.replaceAll('-', '');
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = parseYmd(ymd);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** Day of week for YYYYMMDD: 0 = Monday .. 6 = Sunday (GTFS calendar order). */
export function weekdayIndex(ymd: string): number {
  const [y, m, d] = parseYmd(ymd);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** "7:05 AM" in the agency timezone; 12-hour clock in both languages per owner decision D05. */
export function formatTime12(instant: number, timeZone: string, lang: 'en' | 'es' = 'en'): string {
  return new Intl.DateTimeFormat(lang === 'es' ? 'es-US' : 'en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(new Date(instant))
    .replace(/ | /g, ' ');
}

/** "HH:MM:SS" (possibly >= 24) to seconds. */
export function parseGtfsTime(s: string): number {
  const [h, m, sec] = s.trim().split(':').map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) throw new Error(`bad GTFS time: ${s}`);
  return h * 3600 + m * 60 + (sec ?? 0);
}
