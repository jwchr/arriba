// Trip progress while riding (owner request 2026-11-04): where the bus is along the line and whether
// it is ahead of or behind the timetable, from the freshest evidence available. Evidence, best first
// when equally fresh: the matched bus's GPS, the rider's own phone GPS (they are on the bus), and the
// rider's taps ("we're at this stop"). Without any, the position is the timetable's, labeled as such,
// and no ahead/behind is claimed. Pure: positions are passed in, nothing is stored here.
import { DEFAULT_TIMING } from './lock';
import { progressAlong } from './rideGuide';
import type { Stop } from './types';

export interface Fix { lat: number; lon: number; at: number; accuracyM: number }
export type EvidenceSource = 'tap' | 'phone_gps' | 'bus_gps';
export interface Milestone { index: number; at: number; source: EvidenceSource }

export interface ProgressInput {
  /** The trip's stops in order, with scheduled times (epoch ms). */
  stops: readonly (Stop | undefined)[];
  times: readonly number[];
  boardIndex: number;
  alightIndex: number;
  now: number;
  milestones: readonly Milestone[];
  phone?: Fix;
  bus?: Fix;
}

export type ProgressBasis = EvidenceSource | 'timetable';

export interface TripProgress {
  /** Fractional stop index (3.5 = halfway between stops 3 and 4). */
  position: number;
  /** True when the position is carried forward from older evidence at the same pace, not observed now. */
  projected: boolean;
  basis: ProgressBasis;
  observedAt?: number;
  /** Minutes behind (+) or ahead (−) of the timetable, rounded; 0 = within a minute; undefined without evidence. */
  delayMin?: number;
  /** Highest stop index confirmed reached (by a tap or a GPS fix at the stop). */
  reachedIndex: number;
  /** Scheduled arrival at the rider's stop, and the same shifted by the delay ("if it keeps this pace"). */
  alight: { scheduled: number; projected?: number };
}

/** A GPS fix this old or less precise is not used. */
export const FIX_MAX_AGE_MS = DEFAULT_TIMING.staleAfterMs;
export const FIX_MAX_ACCURACY_M = 150;
/** A fix this close to a stop counts as reaching it. */
export const AT_STOP_M = 80;
const OFF_ROUTE_M = 400;

type Located = Stop & { lat: number; lon: number };
const isLocated = (s: Stop | undefined): s is Located => typeof s?.lat === 'number' && typeof s?.lon === 'number';
export const hasLocations = (stops: readonly (Stop | undefined)[]) => stops.length > 1 && stops.every(isLocated);

/** Scheduled time at a fractional position along the trip. */
export function scheduledAt(times: readonly number[], p: number): number {
  const i = Math.max(0, Math.min(times.length - 2, Math.floor(p)));
  const f = Math.max(0, Math.min(1, p - i));
  return times[i]! + f * (times[i + 1]! - times[i]!);
}

/** Where the timetable puts the bus at `t`, as a fractional stop index, clamped to the trip. */
export function timetablePosition(times: readonly number[], t: number): number {
  if (t <= times[0]!) return 0;
  for (let i = 0; i < times.length - 1; i++) {
    const a = times[i]!, b = times[i + 1]!;
    if (t < b) return b > a ? i + (t - a) / (b - a) : i + 1;
  }
  return times.length - 1;
}

/** The trip position a GPS fix shows, or undefined when it is old, imprecise, off the route or ambiguous. */
export function fixPosition(stops: readonly (Stop | undefined)[], from: number, fix: Fix, now: number): number | undefined {
  if (!hasLocations(stops) || now - fix.at > FIX_MAX_AGE_MS || fix.at > now + 60_000 || fix.accuracyM > FIX_MAX_ACCURACY_M) return undefined;
  const line = stops as Located[];
  const r = progressAlong(line, Math.max(0, from - 1), line.length - 1, fix);
  return r && r.offM <= OFF_ROUTE_M ? r.progress : undefined;
}

/** The stop a fix is at (within AT_STOP_M, beyond `after`), for an automatic milestone. */
export function stopReached(stops: readonly (Stop | undefined)[], after: number, fix: Fix): number | undefined {
  if (fix.accuracyM > FIX_MAX_ACCURACY_M) return undefined;
  let best: { i: number; d: number } | undefined;
  stops.forEach((s, i) => {
    if (i <= after || !isLocated(s)) return;
    const d = metres(s, fix);
    if (d <= AT_STOP_M && (!best || d < best.d)) best = { i, d };
  });
  return best?.i;
}

function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const kx = Math.cos((a.lat * Math.PI) / 180) * 111_320;
  return Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * 110_540);
}

export function tripProgress(input: ProgressInput): TripProgress {
  const { stops, times, boardIndex, alightIndex, now, milestones } = input;
  const reachedIndex = Math.max(boardIndex, ...milestones.map((m) => m.index));
  const evidence: { position: number; at: number; source: EvidenceSource }[] = [];
  const last = [...milestones].sort((a, b) => a.at - b.at || a.index - b.index).at(-1);
  if (last) evidence.push({ position: last.index, at: last.at, source: last.source });
  for (const [fix, source] of [[input.bus, 'bus_gps'], [input.phone, 'phone_gps']] as const) {
    if (!fix) continue;
    const p = fixPosition(stops, boardIndex, fix, now);
    // Never behind a stop already confirmed: GPS jitter does not move the bus backwards.
    if (p !== undefined) evidence.push({ position: Math.max(p, reachedIndex), at: fix.at, source });
  }
  const rank: Record<EvidenceSource, number> = { bus_gps: 0, phone_gps: 1, tap: 2 };
  const best = evidence.sort((a, b) => b.at - a.at || rank[a.source] - rank[b.source])[0];
  const scheduledAlight = times[alightIndex]!;
  if (!best) {
    return { position: Math.max(boardIndex, timetablePosition(times, now)), projected: false, basis: 'timetable', reachedIndex, alight: { scheduled: scheduledAlight } };
  }
  const delayMs = best.at - scheduledAt(times, best.position);
  // Carry the position forward at the observed pace until newer evidence arrives, never past the end.
  const carried = timetablePosition(times, now - delayMs);
  const position = Math.min(times.length - 1, Math.max(best.position, carried));
  return {
    position, projected: position > best.position + 0.01, basis: best.source, observedAt: best.at,
    delayMin: Math.abs(delayMs) < 60_000 ? 0 : Math.round(delayMs / 60_000), reachedIndex,
    alight: { scheduled: scheduledAlight, projected: scheduledAlight + delayMs },
  };
}
