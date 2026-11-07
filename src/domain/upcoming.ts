import { departuresOn, nextDepartures, type DepartureQuery } from './schedule';
import { addDays, localYmd } from './time';
import type { Dataset, Departure } from './types';
import type { DepartureEvidence } from './liveDepartures';
export interface UpcomingSet { ahead: Departure[]; candidates: Departure[] }
/** Bounded two-hour lookback lets an officially delayed bus stay after its scheduled minute. */
export function upcomingCandidates(ds: Dataset, q: Omit<DepartureQuery, 'date'>, now: number, count: number): UpcomingSet {
  const ahead = nextDepartures(ds, q, now, 40), today = localYmd(now, ds.meta.timezone);
  if (!ds.meta.realtime || ds.meta.demo || ds.meta.transcribed) return { ahead, candidates: ahead.slice(0, count) };
  const past = [addDays(today, -1), today].flatMap(date => departuresOn(ds, { ...q, date }))
    .filter(d => d.departs >= now - 2 * 3600_000 && d.departs < now - 60_000).slice(-10);
  return { ahead, candidates: [...ahead.slice(0, count + 2), ...past] };
}
export function selectUpcoming(set: UpcomingSet, evidence: (d: Departure) => DepartureEvidence | undefined, now: number, count: number): Departure[] {
  return set.candidates.filter(d => d.departs >= now - 60_000 || evidence(d)?.kind === 'live')
    .sort((a, b) => (evidence(a)?.boarding?.at ?? a.departs) - (evidence(b)?.boarding?.at ?? b.departs) || a.tripInstanceId.localeCompare(b.tripInstanceId))
    .slice(0, count);
}
