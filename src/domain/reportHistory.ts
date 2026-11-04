// Personal arrival and crowding history (issue #57): the rider's own Bus Lock reports, kept on this
// phone across trips, summarised for the same scheduled bus (stop, route, scheduled time, kind of day).
// Past personal observations only: never shared, never official, never about today's bus, and never
// from the invented demo. No position is stored, only the stop and times the rider already chose.
import type { BusSession, CapacityLevel, RiderReportKind } from './busLock';
import type { Dataset, Departure } from './types';
import { isNjtHoliday } from './holidays';
import { weekdayIndex } from './time';

export type DayType = 'weekday' | 'saturday' | 'sunday';

export interface PastReport {
  /** The Bus Lock session it came from (a local, ephemeral id), so one ride counts once. */
  session: string;
  routeId: string;
  stopId: string;
  /** Scheduled departure at that stop, in minutes after the service day's start (a 24:10 trip is 1450). */
  slot: number;
  dayType: DayType;
  /** Service date, YYYYMMDD. */
  date: string;
  kind: Exclude<RiderReportKind, 'boarded' | 'left'>;
  /** When the rider reported it, in whole minutes after the scheduled departure (negative = before). */
  atMin: number;
  capacity?: CapacityLevel;
  reportedAt: number;
}

export const HISTORY_KEY = 'arriba.history.v1';
export const MAX_HISTORY = 1000;
export const KEEP_DAYS = 180;
const KINDS = new Set(['no_bus', 'arrived', 'passed_without_stopping', 'capacity']);
const LEVELS = new Set(['seats', 'standing', 'full']);

const dayTypeOf = (date: string): DayType => { const w = weekdayIndex(date); return w === 5 ? 'saturday' : w === 6 ? 'sunday' : 'weekday'; };

/** The scheduled slot of a departure: its stop time in the trip, in minutes of the service day. */
export function slotOf(ds: Dataset, dep: Departure): number | undefined {
  const seconds = ds.trips.find((t) => t.id === dep.tripId)?.times[dep.stopIndex];
  return typeof seconds === 'number' ? Math.round(seconds / 60) : undefined;
}

const valid = (x: unknown): x is PastReport => {
  if (!x || typeof x !== 'object') return false;
  const p = x as Record<string, unknown>;
  const str = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 80;
  const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v);
  return str(p.session) && str(p.routeId) && str(p.stopId) && int(p.slot) && ['weekday', 'saturday', 'sunday'].includes(p.dayType as string)
    && typeof p.date === 'string' && /^\d{8}$/.test(p.date) && KINDS.has(p.kind as string) && int(p.atMin)
    && typeof p.reportedAt === 'number' && Number.isFinite(p.reportedAt)
    && (p.capacity === undefined || LEVELS.has(p.capacity as string)) && (p.kind !== 'capacity' || p.capacity !== undefined);
};

const keyOf = (p: PastReport) => `${p.session}|${p.kind}|${p.reportedAt}`;

export function loadHistory(storage: Pick<Storage, 'getItem'> | undefined, now: number): PastReport[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(HISTORY_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const cutoff = now - KEEP_DAYS * 86_400_000;
    return parsed.filter(valid).filter((p) => p.reportedAt >= cutoff && p.reportedAt <= now + 86_400_000);
  } catch { return []; }
}

function save(storage: Pick<Storage, 'setItem'> | undefined, list: PastReport[]): void {
  try { storage?.setItem(HISTORY_KEY, JSON.stringify(list.slice(-MAX_HISTORY))); } catch { /* not kept */ }
}

/** The session's reports as history entries (no_bus, arrived, passed, capacity); none for the demo. */
export function toPastReports(ds: Dataset, session: BusSession): PastReport[] {
  if (ds.meta.demo) return [];
  const dep = session.departure;
  // A printed timetable has no holiday schedules: a holiday's bus is not the usual weekday bus.
  if (ds.meta.transcribed && isNjtHoliday(dep.serviceDate)) return [];
  const slot = slotOf(ds, dep);
  if (slot === undefined) return [];
  return session.reports.filter((r) => KINDS.has(r.kind)).map((r) => ({
    session: session.id.slice(0, 80), routeId: dep.route.id, stopId: r.stopId, slot, dayType: dayTypeOf(dep.serviceDate), date: dep.serviceDate,
    kind: r.kind as PastReport['kind'], atMin: Math.floor((r.reportedAt - dep.departs) / 60_000),
    ...(r.capacity ? { capacity: r.capacity } : {}), reportedAt: r.reportedAt,
  }));
}

/** Adds the session's new reports to the phone's history (each once). Returns the stored list. */
export function recordSession(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, ds: Dataset, session: BusSession, now: number): PastReport[] {
  const fresh = toPastReports(ds, session);
  const list = loadHistory(storage, now);
  if (!fresh.length) return list;
  const seen = new Set(list.map(keyOf));
  const added = fresh.filter((p) => !seen.has(keyOf(p)));
  if (!added.length) return list;
  const next = [...list, ...added];
  save(storage, next);
  return next;
}

/** Rewrites the stored history without entries past the 180-day limit (or damaged ones). */
export function pruneHistory(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, now: number): PastReport[] {
  const list = loadHistory(storage, now);
  try {
    const stored: unknown = JSON.parse(storage?.getItem(HISTORY_KEY) ?? '[]');
    if (Array.isArray(stored) && stored.length !== list.length) save(storage, list);
  } catch { save(storage, list); }
  return list;
}

export function clearHistory(storage: Pick<Storage, 'removeItem'> | undefined): void {
  try { storage?.removeItem(HISTORY_KEY); } catch { /* nothing kept */ }
}

export interface HistorySummary {
  /** Distinct past rides with any report for this scheduled bus. */
  rides: number;
  firstDate: string;
  lastDate: string;
  arrived?: { count: number; medianMin: number; minMin: number; maxMin: number };
  passed: number;
  noBus: number;
  capacity: Record<CapacityLevel, number>;
}

/**
 * Past reports for the same scheduled bus as `dep` (same stop, route, scheduled minute and kind of
 * day) on earlier days: this run of the bus (its service date) and `excludeSession` are left out, so
 * today's reports never mix in. Undefined if none.
 */
export function summarize(ds: Dataset, history: readonly PastReport[], dep: Departure, excludeSession?: string): HistorySummary | undefined {
  const slot = slotOf(ds, dep);
  if (slot === undefined) return undefined;
  const stopId = dep.pattern.stopIds[dep.stopIndex];
  const dayType = dayTypeOf(dep.serviceDate);
  const same = history.filter((p) => p.session !== excludeSession && p.date !== dep.serviceDate && p.stopId === stopId && p.routeId === dep.route.id && p.slot === slot && p.dayType === dayType);
  if (!same.length) return undefined;
  const sessions = (kind: PastReport['kind']) => new Set(same.filter((p) => p.kind === kind).map((p) => p.session));
  // One arrival per ride: the first one the rider reported.
  const firstArrival = new Map<string, number>();
  for (const p of same) if (p.kind === 'arrived' && !firstArrival.has(p.session)) firstArrival.set(p.session, p.atMin);
  const mins = [...firstArrival.values()].sort((a, b) => a - b);
  // One crowding answer per ride: the last one the rider gave.
  const lastCapacity = new Map<string, CapacityLevel>();
  for (const p of [...same].sort((a, b) => a.reportedAt - b.reportedAt)) if (p.kind === 'capacity' && p.capacity) lastCapacity.set(p.session, p.capacity);
  const capacity: Record<CapacityLevel, number> = { seats: 0, standing: 0, full: 0 };
  for (const level of lastCapacity.values()) capacity[level]++;
  const dates = same.map((p) => p.date).sort();
  return {
    rides: new Set(same.map((p) => p.session)).size,
    firstDate: dates[0]!, lastDate: dates[dates.length - 1]!,
    ...(mins.length ? { arrived: { count: mins.length, medianMin: mins[Math.floor((mins.length - 1) / 2)]!, minMin: mins[0]!, maxMin: mins[mins.length - 1]! } } : {}),
    passed: sessions('passed_without_stopping').size,
    noBus: sessions('no_bus').size,
    capacity,
  };
}
