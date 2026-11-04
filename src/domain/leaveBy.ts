// Leave-by countdown, arrive-by planning and the earliest-arrival pick (issue #54). Everything here is
// worked out from scheduled times and the rider's own walking time and spare minutes: no live data,
// no background reminder. A bus the rider cannot walk to in time is never the one they are told to catch.
import { zonedWallTime, addDays, localYmd, parseYmd } from './time';
import type { Departure } from './types';

/** Per saved commute and direction: minutes to walk to the stop, spare minutes, and an optional arrive-by time. */
export interface LeavePlan {
  walkMin: number;
  cushionMin: number;
  /** "HH:MM", 24-hour local time at the stop where the rider gets off. */
  arriveBy?: string;
}

export const MAX_WALK_MIN = 60;
export const MAX_CUSHION_MIN = 30;
/** The arrive-by line shows only in the hours before that time, so a morning deadline does not sit on the evening card. */
export const ARRIVE_BY_WINDOW_MS = 6 * 3600_000;

/** A stored plan, checked: whole minutes in range and a real HH:MM, or undefined. */
export function cleanLeavePlan(x: unknown): LeavePlan | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const p = x as Record<string, unknown>;
  const whole = (v: unknown, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : undefined);
  const walkMin = whole(p.walkMin, MAX_WALK_MIN);
  const cushionMin = whole(p.cushionMin, MAX_CUSHION_MIN);
  if (walkMin === undefined || cushionMin === undefined) return undefined;
  const arriveBy = typeof p.arriveBy === 'string' && parseHhMm(p.arriveBy) ? p.arriveBy : undefined;
  return { walkMin, cushionMin, ...(arriveBy ? { arriveBy } : {}) };
}

function parseHhMm(s: string): [number, number] | undefined {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

export interface LeaveOption {
  dep: Departure;
  /** Scheduled arrival where the rider gets off; undefined when the trip lists no time there. */
  arrives?: { at: number; estimated: boolean };
}

/** Whether the rider can still walk to the stop before this bus leaves (spare minutes not counted). */
export const canWalkTo = (o: LeaveOption, now: number, plan: LeavePlan) => o.dep.departs - plan.walkMin * 60_000 >= now;

export type LeaveAdvice =
  /** Leave in `minutes` (rounded down) to catch `dep` with the full spare time. */
  | { kind: 'leave_in'; dep: Departure; leaveAt: number; minutes: number }
  /** Walking still makes `dep`, but only `spareMin` of the spare minutes are left. */
  | { kind: 'leave_now'; dep: Departure; spareMin: number }
  /** No listed bus can be reached on foot in time. */
  | { kind: 'none' };

/** When to leave for the first listed bus the rider can still walk to. `options` are in departure order. */
export function leaveAdvice(options: readonly LeaveOption[], now: number, plan: LeavePlan): LeaveAdvice {
  const target = options.find((o) => canWalkTo(o, now, plan));
  if (!target) return { kind: 'none' };
  const latestWalk = target.dep.departs - plan.walkMin * 60_000;
  const leaveAt = latestWalk - plan.cushionMin * 60_000;
  if (leaveAt >= now) return { kind: 'leave_in', dep: target.dep, leaveAt, minutes: Math.floor((leaveAt - now) / 60_000) };
  return { kind: 'leave_now', dep: target.dep, spareMin: Math.floor((latestWalk - now) / 60_000) };
}

/** The next time the clock reads `arriveBy` (today, or tomorrow if it has passed), or undefined. */
export function arriveByDeadline(now: number, arriveBy: string, timeZone: string): number | undefined {
  const hm = parseHhMm(arriveBy);
  if (!hm) return undefined;
  const today = localYmd(now, timeZone);
  for (const date of [today, addDays(today, 1)]) {
    const [y, m, d] = parseYmd(date);
    const at = zonedWallTime(y, m, d, hm[0], hm[1], timeZone);
    if (at > now) return at;
  }
  return undefined;
}

export type ArriveByPick =
  /** The latest listed bus the rider can walk to that is scheduled to arrive by the deadline. */
  | { kind: 'pick'; option: LeaveOption & { arrives: { at: number; estimated: boolean } }; leaveAt: number; leaveNow: boolean; deadline: number }
  /** No listed bus the rider can reach is scheduled to arrive by then. */
  | { kind: 'none_in_time'; deadline: number }
  /** Some reachable buses list no arrival time, and none that do arrive in time: Dale cannot say. */
  | { kind: 'unknown'; deadline: number };

/**
 * Arrive-by planning: of the buses the rider can still walk to, the one that leaves latest (most time
 * before leaving) while scheduled to arrive by `deadline`; ties go to the earlier arrival.
 */
export function arriveByPick(options: readonly LeaveOption[], now: number, plan: LeavePlan, deadline: number): ArriveByPick {
  const reachable = options.filter((o) => canWalkTo(o, now, plan) && o.dep.departs < deadline);
  const inTime = reachable.filter((o): o is LeaveOption & { arrives: { at: number; estimated: boolean } } => !!o.arrives && o.arrives.at <= deadline);
  if (!inTime.length) return reachable.some((o) => !o.arrives) ? { kind: 'unknown', deadline } : { kind: 'none_in_time', deadline };
  const option = inTime.reduce((best, o) => (o.dep.departs > best.dep.departs || (o.dep.departs === best.dep.departs && o.arrives.at < best.arrives.at) ? o : best));
  const leaveAt = option.dep.departs - (plan.walkMin + plan.cushionMin) * 60_000;
  return { kind: 'pick', option, leaveAt, leaveNow: leaveAt < now, deadline };
}

export interface EarliestArrival {
  /** Index in `options` of the bus that arrives first. */
  index: number;
  /** How much later it leaves than the first bus the rider can catch, and how much earlier it arrives. */
  laterMin: number;
  earlierMin: number;
  /** Either arrival time is Dale's estimate. */
  estimated: boolean;
}

/**
 * The bus that arrives first when it is not the first one the rider can catch (an express that leaves
 * later but gets in sooner). Only buses the rider can walk to count when a plan is given. Undefined
 * when the first catchable bus arrives first, or by less than a minute, or arrivals are not listed.
 */
export function earliestArrival(options: readonly LeaveOption[], now: number, plan?: LeavePlan): EarliestArrival | undefined {
  const catchable = options.map((o, index) => ({ o, index })).filter(({ o }) => !plan || canWalkTo(o, now, plan));
  const first = catchable[0];
  if (!first?.o.arrives) return undefined;
  let best = first;
  for (const c of catchable) if (c.o.arrives && c.o.arrives.at < best.o.arrives!.at) best = c;
  if (best === first) return undefined;
  const earlierMin = Math.round((first.o.arrives.at - best.o.arrives!.at) / 60_000);
  if (earlierMin < 1) return undefined;
  return {
    index: best.index,
    laterMin: Math.round((best.o.dep.departs - first.o.dep.departs) / 60_000),
    earlierMin,
    estimated: first.o.arrives.estimated || best.o.arrives!.estimated,
  };
}
