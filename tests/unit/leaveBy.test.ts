import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { arriveByDeadline, arriveByPick, cleanLeavePlan, earliestArrival, leaveAdvice, type LeaveOption } from '../../src/domain/leaveBy';
import { loadFavorites } from '../../src/domain/favorites';
import { nextDepartures, tripStopTimes } from '../../src/domain/schedule';
import { zonedWallTime } from '../../src/domain/time';
import type { Dataset, Departure } from '../../src/domain/types';

const TZ = 'America/New_York';
const at = (h: number, m: number) => zonedWallTime(2026, 11, 4, h, m, TZ);
const MIN = 60_000;
/** A departure leaving at h:m and arriving `ride` minutes later (only the fields leaveBy reads). */
const opt = (id: string, h: number, m: number, ride?: number, estimated = false): LeaveOption => ({
  dep: { tripInstanceId: id, departs: at(h, m) } as Departure,
  ...(ride === undefined ? {} : { arrives: { at: at(h, m) + ride * MIN, estimated } }),
});

describe('leave-by countdown (issue #54)', () => {
  const plan = { walkMin: 5, cushionMin: 3 };
  const options = [opt('a', 7, 10, 40), opt('b', 7, 25, 40), opt('c', 7, 40, 40)];

  it('counts down to leaving for the first bus, with the walk and spare minutes', () => {
    expect(leaveAdvice(options, at(6, 52), plan)).toEqual({ kind: 'leave_in', dep: options[0]!.dep, leaveAt: at(7, 2), minutes: 10 });
    // 30 seconds before the leave time rounds down: never says "1 min" when it is less.
    expect(leaveAdvice(options, at(7, 2) - 30_000, plan)).toMatchObject({ kind: 'leave_in', minutes: 0 });
  });

  it('says leave now when only part of the spare time is left, and moves on when the walk no longer makes it', () => {
    expect(leaveAdvice(options, at(7, 3), plan)).toEqual({ kind: 'leave_now', dep: options[0]!.dep, spareMin: 2 });
    expect(leaveAdvice(options, at(7, 5), plan)).toEqual({ kind: 'leave_now', dep: options[0]!.dep, spareMin: 0 });
    // One minute later the 7:10 cannot be reached on foot: the advice is for the 7:25, never the bus that is gone.
    expect(leaveAdvice(options, at(7, 6), plan)).toMatchObject({ kind: 'leave_in', dep: options[1]!.dep, leaveAt: at(7, 17) });
    expect(leaveAdvice(options, at(7, 36), plan)).toEqual({ kind: 'none' });
  });
});

describe('arrive-by planning (issue #54)', () => {
  const plan = { walkMin: 5, cushionMin: 3, arriveBy: '09:00' };

  it('finds the next 9:00, today or tomorrow, in local time', () => {
    expect(arriveByDeadline(at(7, 0), '09:00', TZ)).toBe(at(9, 0));
    expect(arriveByDeadline(at(9, 0), '09:00', TZ)).toBe(zonedWallTime(2026, 11, 5, 9, 0, TZ));
    expect(arriveByDeadline(at(7, 0), '9:00', TZ)).toBeUndefined();
    expect(arriveByDeadline(at(7, 0), '24:00', TZ)).toBeUndefined();
  });

  it('picks the latest bus that still arrives in time, and when to leave for it', () => {
    const options = [opt('a', 7, 40, 45), opt('b', 8, 5, 50), opt('c', 8, 10, 40), opt('d', 8, 25, 40)];
    const r = arriveByPick(options, at(7, 0), plan, at(9, 0));
    // 8:10 arrives 8:50; 8:25 arrives 9:05, too late. 8:05 arrives 8:55, but leaves earlier.
    expect(r).toMatchObject({ kind: 'pick', option: { dep: { tripInstanceId: 'c' } }, leaveAt: at(8, 2), leaveNow: false });
    expect(arriveByPick(options, at(8, 4), plan, at(9, 0))).toMatchObject({ kind: 'pick', leaveNow: true });
  });

  it('says so when no reachable bus arrives in time, or when arrivals are not listed', () => {
    expect(arriveByPick([opt('a', 7, 40, 45), opt('b', 8, 30, 45)], at(7, 40), plan, at(9, 0))).toEqual({ kind: 'none_in_time', deadline: at(9, 0) });
    expect(arriveByPick([opt('a', 8, 0)], at(7, 0), plan, at(9, 0))).toEqual({ kind: 'unknown', deadline: at(9, 0) });
  });
});

describe('earliest-arrival pick (issue #54)', () => {
  it('flags an express that leaves later but arrives sooner, with the reason', () => {
    const options = [opt('local', 7, 10, 55), opt('express', 7, 18, 35), opt('next', 7, 25, 55)];
    expect(earliestArrival(options, at(7, 0))).toEqual({ index: 1, laterMin: 8, earlierMin: 12, estimated: false });
  });

  it('says nothing when the first bus arrives first, or by under a minute, or arrivals are not listed', () => {
    expect(earliestArrival([opt('a', 7, 10, 40), opt('b', 7, 20, 40)], at(7, 0))).toBeUndefined();
    expect(earliestArrival([opt('a', 7, 10, 40), { ...opt('b', 7, 11, 0), arrives: { at: at(7, 50) - 20_000, estimated: false } }], at(7, 0))).toBeUndefined();
    expect(earliestArrival([opt('a', 7, 10), opt('b', 7, 18, 20)], at(7, 0))).toBeUndefined();
  });

  it('compares only buses the rider can walk to, and carries estimates', () => {
    const options = [opt('gone', 7, 3, 20), opt('local', 7, 10, 55), opt('express', 7, 18, 35, true)];
    expect(earliestArrival(options, at(7, 0), { walkMin: 5, cushionMin: 0 })).toEqual({ index: 2, laterMin: 8, earlierMin: 12, estimated: true });
  });

  it('on the printed 165 timetable, every flagged bus really leaves later and arrives earlier', () => {
    const ds = JSON.parse(readFileSync(join(__dirname, '../../public/data/corridor.json'), 'utf8')) as Dataset;
    const from = ds.stops.find((s) => /Irvington/.test(s.name) && /New York/.test(s.name))!;
    const to = ds.stops.find((s) => s.terminal)!;
    let flagged = 0;
    for (let min = 5 * 60; min < 10 * 60; min += 5) {
      const now = at(Math.floor(min / 60), min % 60);
      const deps = nextDepartures(ds, { stopId: from.id, toStopId: to.id, routeIds: [] }, now, 5);
      const options = deps.map((d) => ({ dep: d, arrives: tripStopTimes(ds, d)[d.pattern.stopIds.indexOf(to.id)] }));
      const e = earliestArrival(options, now);
      if (!e) continue;
      flagged++;
      expect(options[e.index]!.dep.departs).toBeGreaterThan(options[0]!.dep.departs);
      expect(options[e.index]!.arrives!.at).toBeLessThan(options[0]!.arrives!.at);
    }
    expect(flagged).toBeGreaterThan(0);
  });
});

describe('stored leave plans', () => {
  it('keeps valid plans and drops bad ones, without losing the commute', () => {
    expect(cleanLeavePlan({ walkMin: 5, cushionMin: 2, arriveBy: '08:45' })).toEqual({ walkMin: 5, cushionMin: 2, arriveBy: '08:45' });
    expect(cleanLeavePlan({ walkMin: 5, cushionMin: 2, arriveBy: '8:45' })).toEqual({ walkMin: 5, cushionMin: 2 });
    expect(cleanLeavePlan({ walkMin: -1, cushionMin: 2 })).toBeUndefined();
    expect(cleanLeavePlan({ walkMin: 61, cushionMin: 2 })).toBeUndefined();
    expect(cleanLeavePlan({ walkMin: 2.5, cushionMin: 2 })).toBeUndefined();
    const raw = JSON.stringify([{ id: 'x', label: 'Work', fromStopId: 'a', toStopId: 'b', routeIds: [], leave: { out: { walkMin: 4, cushionMin: 1 }, back: { walkMin: 'far' } } }]);
    expect(loadFavorites({ getItem: () => raw })).toEqual([{ id: 'x', label: 'Work', fromStopId: 'a', toStopId: 'b', routeIds: [], leave: { out: { walkMin: 4, cushionMin: 1 } } }]);
  });
});
