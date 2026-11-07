// Ride mode (UX-10, issue #34): where the rider is on the trip relative to the stop they get off at.
// A stop countdown ("3 stops") needs two things: a dataset that lists every stop of the trip, and a
// fresh, unambiguous GPS position of the matched bus. Without both, the guide says what it cannot know
// instead of counting: a printed timetable lists main timepoints only, and a schedule is not a position.
import { DEFAULT_TIMING, type TripLock, type VehicleObservation } from './lock';
import type { Dataset, Stop } from './types';

/**
 * riding / three / two: that many stops to go. one: the stop before the rider's is the bus's current or
 * last stop, so wait. request: the bus has left that stop; ask for yours now. last_next: the rider's stop
 * is the end of the line, which the bus serves anyway. arrived: at the stop. passed: beyond it.
 */
export type RideStage = 'riding' | 'three' | 'two' | 'one' | 'request' | 'last_next' | 'arrived' | 'passed';

export type UncertainReason = 'service_change' | 'no_gps' | 'stale_gps' | 'identity' | 'cancelled' | 'off_route' | 'ambiguous' | 'inconsistent' | 'behind';

export type RideGuide =
  /** Fresh, unambiguous matched-bus GPS on a trip whose every stop is listed: an honest stop count. */
  | { basis: 'gps'; stage: RideStage; stopsAway: number; observedAt: number; reachedIndex: number }
  /** The data lists every stop but the bus position is missing, old, disputed or unclear. */
  | { basis: 'uncertain'; reason: UncertainReason }
  /** Printed timepoints only: no stop can be counted, so only scheduled times are given. */
  | { basis: 'timetable_only' };

/** Positions farther than this from the trip's line between stops are not trusted for a count. */
export const OFF_ROUTE_M = 400;
/** A bus within this distance of a stop counts as at that stop. */
export const AT_STOP_M = 60;
/** Another, non-adjacent part of the route this close to the best match makes the position ambiguous. */
export const AMBIGUOUS_M = 100;
/** A recent fix at most this far ahead along the route is treated as jitter in the newest one; more is a disagreement. */
export const JITTER_M = 100;
/** Faster than this along the route since the previous fix (about 125 km/h) is not a bus moving: the reading is wrong. */
export const MAX_SPEED_MPS = 35;
/** GPS noise allowed for when judging speed between two fixes. */
export const GPS_NOISE_M = 50;

type Located = Stop & { lat: number; lon: number };
const located = (s: Stop | undefined): s is Located => typeof s?.lat === 'number' && typeof s?.lon === 'number';

function flat(lat0: number) {
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111_320;
  return (p: { lat: number; lon: number }) => ({ x: p.lon * kx, y: p.lat * 110_540 });
}
const dist = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const f = flat(a.lat);
  const p = f(a), q = f(b);
  return Math.hypot(p.x - q.x, p.y - q.y);
};

/**
 * Progress of a position along stops[from..to] as a fractional stop index (3.5 = halfway between stops
 * 3 and 4), with its distance from the route. Undefined when a non-adjacent part of the route is about
 * as close (an out-and-back street or a stop visited twice), so the position cannot say which part.
 */
export function progressAlong(stops: readonly Located[], from: number, to: number, pos: { lat: number; lon: number }): { progress: number; offM: number } | undefined {
  const f = flat(pos.lat);
  const p = f(pos);
  const segs: { i: number; progress: number; offM: number }[] = [];
  for (let i = from; i < to; i++) {
    const a = f(stops[i]!), b = f(stops[i + 1]!);
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
    segs.push({ i, progress: i + t, offM: Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))) });
  }
  if (!segs.length) return undefined;
  const best = segs.reduce((m, s) => (s.offM < m.offM ? s : m));
  if (segs.some((s) => Math.abs(s.i - best.i) >= 2 && s.offM <= best.offM + AMBIGUOUS_M)) return undefined;
  return { progress: best.progress, offM: best.offM };
}

/**
 * The ride guide for a rider who boarded at `boardIndex` and gets off at `alightIndex`.
 * `stopIds` is the trip's stop sequence; `lock` carries the matched vehicle; `history` is this lock's
 * accepted GPS, used so jitter never moves the bus backwards; `now` re-checks freshness here too.
 */
export function rideGuide(
  ds: Dataset, stopIds: readonly string[], boardIndex: number, alightIndex: number,
  lock: TripLock, now: number, history: readonly VehicleObservation[] = [],
): RideGuide {
  // A transcribed printed timetable lists timepoints, not every stop: never count stops from it.
  if (ds.meta.transcribed) return { basis: 'timetable_only' };
  if (lock.status === 'cancelled') return { basis: 'uncertain', reason: 'cancelled' };
  if (lock.status === 'needs_confirmation') return { basis: 'uncertain', reason: 'identity' };
  const last = lock.last;
  if (!last || lock.status === 'scheduled_only') return { basis: 'uncertain', reason: 'no_gps' };
  if (lock.status !== 'tracked' || now - last.observedAt > DEFAULT_TIMING.staleAfterMs) return { basis: 'uncertain', reason: 'stale_gps' };
  const stops = stopIds.map((id) => ds.stops.find((s) => s.id === id));
  if (!(alightIndex > boardIndex) || alightIndex >= stopIds.length || !stops.every(located)) return { basis: 'uncertain', reason: 'no_gps' };
  const line = stops as Located[];
  // Search one segment either side: behind the boarding stop, and past the rider's stop.
  const from = Math.max(0, boardIndex - 1);
  const to = Math.min(line.length - 1, alightIndex + 1);
  const here = progressAlong(line, from, to, last);
  if (!here) return { basis: 'uncertain', reason: 'ambiguous' };
  if (here.offM > OFF_ROUTE_M) return { basis: 'uncertain', reason: 'off_route' };

  // Distance along the route for a fractional stop index, to compare fixes in metres.
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1]! + dist(line[i - 1]!, line[i]!));
  const metres = (q: number) => { const i = Math.min(Math.floor(q), line.length - 2); return cum[i]! + (q - i) * (cum[i + 1]! - cum[i]!); };
  // Small backward jitter in the newest fix is absorbed by a slightly further recent fix; a recent fix
  // much further ahead means the readings disagree, and neither is trusted for a count.
  let reach = { progress: here.progress, pos: last as { lat: number; lon: number } };
  let previous: { progress: number; observedAt: number } | undefined;
  for (const o of history) {
    if (o.vehicleId !== last.vehicleId || o.tripInstanceId !== last.tripInstanceId || o.observedAt >= last.observedAt) continue;
    if (now - o.observedAt > DEFAULT_TIMING.staleAfterMs) continue;
    const h = progressAlong(line, from, to, o);
    if (!h || h.offM > OFF_ROUTE_M) continue;
    const ahead = metres(h.progress) - metres(here.progress);
    if (ahead > JITTER_M) return { basis: 'uncertain', reason: 'inconsistent' };
    if (h.progress > reach.progress) reach = { progress: h.progress, pos: o };
    if (!previous || o.observedAt > previous.observedAt) previous = { progress: h.progress, observedAt: o.observedAt };
  }
  // One impossible jump forward since the previous fix is a bad reading, not a fast bus.
  // GPS noise of a few tens of metres between close fixes is allowed for; small jumps are never judged.
  if (previous) {
    const seconds = (last.observedAt - previous.observedAt) / 1000;
    const moved = metres(here.progress) - metres(previous.progress);
    if (seconds > 0 && moved > JITTER_M && (moved - GPS_NOISE_M) / seconds > MAX_SPEED_MPS) return { basis: 'uncertain', reason: 'inconsistent' };
  }
  const guide = stageAt(reach.progress, reach.pos);
  // Before saying "press now", "this is your stop" or "passed", take the less advanced of the newest
  // fix and the slightly further recent one it was absorbed into.
  if (reach.pos !== last && guide.basis === 'gps' && ['request', 'arrived', 'passed'].includes(guide.stage)) {
    const newest = stageAt(here.progress, last);
    if (newest.basis === 'gps' && STAGE_RANK[newest.stage] < STAGE_RANK[guide.stage]) return newest;
  }
  return guide;

  function stageAt(p: number, pos: { lat: number; lon: number }): RideGuide {
    const near = (k: number) => k >= 0 && k < line.length && dist(pos, line[k]!) <= AT_STOP_M;

    if (p < boardIndex && !near(boardIndex)) return { basis: 'uncertain', reason: 'behind' };
    const base = { basis: 'gps' as const, observedAt: last!.observedAt };
    const lastStop = alightIndex === stopIds.length - 1;
    // The end of the line cannot be passed: a position clamped there is the bus arriving or in the terminal.
    if (near(alightIndex) || (lastStop && p >= alightIndex)) return { ...base, stage: 'arrived', stopsAway: 0, reachedIndex: alightIndex };
    // Beyond the rider's stop, or clamped at it while farther than an at-stop distance: it has gone by.
    if (p >= alightIndex) return { ...base, stage: 'passed', stopsAway: 0, reachedIndex: alightIndex };

    const seg = Math.floor(p);
    const current = near(seg + 1) ? seg + 1 : Math.max(seg, boardIndex);
    const stopsAway = Math.max(1, alightIndex - current);
    let stage: RideStage;
    if (stopsAway === 1) {
      // Pressing while still at the stop before yours asks for that stop. Wait until the bus leaves it.
      const leftPrevious = current === alightIndex - 1 && !near(alightIndex - 1);
      stage = lastStop ? 'last_next' : leftPrevious ? 'request' : 'one';
    } else stage = stopsAway === 2 ? 'two' : stopsAway === 3 ? 'three' : 'riding';
    return { ...base, stage, stopsAway, reachedIndex: current };
  }
}

/** Order of stages for "only ever forward" alerts; arrived and passed are not countdown alerts. */
export const STAGE_RANK: Record<RideStage, number> = { riding: 0, three: 1, two: 2, one: 3, last_next: 3, request: 4, arrived: 5, passed: 5 };
