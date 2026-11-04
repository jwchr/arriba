// Ride mode (UX-10, issue #34): where the rider is on the trip relative to the stop they get off at.
// A stop countdown ("3 stops") needs two things: a dataset that lists every stop of the trip, and a
// fresh GPS position of the matched bus. Without both, the guide says what it cannot know instead of
// counting: a printed timetable lists main timepoints only, and a schedule is not a position.
import { distanceM } from './direction';
import type { TripLock } from './lock';
import type { Dataset, Stop } from './types';

export type RideStage = 'riding' | 'three' | 'two' | 'one' | 'arrived';

export type RideGuide =
  /** Fresh matched-bus GPS on a trip whose every stop is listed: an honest stop count. */
  | { basis: 'gps'; stage: RideStage; stopsAway: number; observedAt: number }
  /** The data lists every stop but the bus position is missing, old or disputed. */
  | { basis: 'uncertain'; reason: 'no_gps' | 'stale_gps' | 'identity' | 'off_route' }
  /** Printed timepoints only: no stop can be counted, so only scheduled times are given. */
  | { basis: 'timetable_only' };

/** Positions farther than this from the trip's line between stops are not trusted for a count. */
export const OFF_ROUTE_M = 400;

const located = (s: Stop | undefined): s is Stop & { lat: number; lon: number } => typeof s?.lat === 'number' && typeof s?.lon === 'number';

/**
 * Progress of a position along the stops from `fromIndex` to `toIndex`, as a fractional stop index
 * (3.5 = halfway between stops 3 and 4), with the distance from the nearest segment.
 * Uses a local flat projection, accurate enough over the few hundred metres between bus stops.
 */
export function progressAlong(stops: readonly (Stop & { lat: number; lon: number })[], fromIndex: number, toIndex: number, pos: { lat: number; lon: number }): { progress: number; offM: number } | undefined {
  let best: { progress: number; offM: number } | undefined;
  const kx = Math.cos((pos.lat * Math.PI) / 180) * 111_320;
  const ky = 110_540;
  for (let i = fromIndex; i < toIndex; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    const ax = a.lon * kx, ay = a.lat * ky, bx = b.lon * kx, by = b.lat * ky, px = pos.lon * kx, py = pos.lat * ky;
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const f = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2));
    const offM = Math.hypot(px - (ax + f * (bx - ax)), py - (ay + f * (by - ay)));
    if (!best || offM < best.offM) best = { progress: i + f, offM };
  }
  if (!best && fromIndex === toIndex) {
    const s = stops[fromIndex]!;
    best = { progress: fromIndex, offM: distanceM(s, pos) };
  }
  return best;
}

/** A bus within this distance of a stop counts as at that stop. */
const AT_STOP_M = 60;

/**
 * The ride guide for a rider who has boarded at `boardIndex` and gets off at `alightIndex`.
 * `stopIds` is the trip's stop sequence; `lock` carries the matched vehicle and its freshness.
 */
export function rideGuide(ds: Dataset, stopIds: readonly string[], boardIndex: number, alightIndex: number, lock: TripLock): RideGuide {
  // A transcribed printed timetable lists timepoints, not every stop: never count stops from it.
  if (ds.meta.transcribed) return { basis: 'timetable_only' };
  if (lock.status === 'needs_confirmation') return { basis: 'uncertain', reason: 'identity' };
  if (!lock.last || lock.status === 'scheduled_only') return { basis: 'uncertain', reason: 'no_gps' };
  if (lock.status !== 'tracked') return { basis: 'uncertain', reason: 'stale_gps' };
  const stops = stopIds.map((id) => ds.stops.find((s) => s.id === id));
  if (!(alightIndex > boardIndex) || !stops.every(located)) return { basis: 'uncertain', reason: 'no_gps' };
  const at = progressAlong(stops as (Stop & { lat: number; lon: number })[], boardIndex, alightIndex, lock.last);
  if (!at || at.offM > OFF_ROUTE_M) return { basis: 'uncertain', reason: 'off_route' };
  // Stops still ahead, counting the rider's own: a bus at (or just leaving) stop k has alightIndex - k to go.
  const segment = Math.floor(at.progress);
  const nearEnd = segment < alightIndex && distanceM(stops[segment + 1]!, lock.last) <= AT_STOP_M;
  const current = nearEnd ? segment + 1 : segment;
  const stopsAway = Math.max(0, alightIndex - current);
  const stage: RideStage = stopsAway === 0 ? 'arrived' : stopsAway === 1 ? 'one' : stopsAway === 2 ? 'two' : stopsAway === 3 ? 'three' : 'riding';
  return { basis: 'gps', stage, stopsAway, observedAt: lock.last.observedAt };
}
