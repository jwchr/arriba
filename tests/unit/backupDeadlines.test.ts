import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backupDeadlines, BACKUP_HORIZON_MS } from '../../src/domain/backupDeadlines';
import { createBusSession, reduceBusSession, type BusSession, type BusSessionEvent } from '../../src/domain/busLock';
import { nextDepartures } from '../../src/domain/schedule';
import { zonedWallTime } from '../../src/domain/time';
import type { Dataset } from '../../src/domain/types';

const ds = JSON.parse(readFileSync(join(__dirname, '../../public/data/corridor.json'), 'utf8')) as Dataset;
const TZ = ds.meta.timezone;
const from = ds.stops.find((s) => /Irvington/.test(s.name) && /New York/.test(s.name))!;
const pabt = ds.stops.find((s) => s.terminal)!;
const dep = nextDepartures(ds, { stopId: from.id, toStopId: pabt.id, routeIds: [] }, zonedWallTime(2026, 11, 4, 7, 0, TZ), 1)[0]!;
const alight = dep.pattern.stopIds.indexOf(pabt.id);
const MIN = 60_000;
const session = (...events: BusSessionEvent[]): BusSession =>
  events.reduce(reduceBusSession, reduceBusSession(createBusSession(dep, dep.departs - 5 * MIN, 's'), { type: 'start_waiting', now: dep.departs - 5 * MIN }));

describe('backup deadlines while waiting (issue #59)', () => {
  it('stays quiet until the bus is late by the chosen threshold', () => {
    expect(backupDeadlines(ds, session(), alight, dep.departs - MIN, 10).show).toBe(false);
    expect(backupDeadlines(ds, session(), alight, dep.departs + 9 * MIN + 59_000, 10).show).toBe(false);
    expect(backupDeadlines(ds, session(), alight, dep.departs + 10 * MIN, 10)).toMatchObject({ show: true, reason: 'late', lateMin: 10 });
    expect(backupDeadlines(ds, session(), alight, dep.departs + 5 * MIN, 5).show).toBe(true);
  });

  it('lists later scheduled buses with minutes left, never the locked one or one already gone', () => {
    const now = dep.departs + 12 * MIN;
    const r = backupDeadlines(ds, session(), alight, now, 10);
    if (!r.show) throw new Error('expected backups');
    expect(r.backups.length).toBeGreaterThan(0);
    for (const { option, minutesLeft } of r.backups) {
      expect(option.dep.tripInstanceId).not.toBe(dep.tripInstanceId);
      expect(option.dep.departs).toBeGreaterThanOrEqual(now);
      expect(option.dep.departs).toBeLessThanOrEqual(now + BACKUP_HORIZON_MS);
      expect(minutesLeft).toBe(Math.floor((option.dep.departs - now) / MIN));
    }
    expect(r.backups.map((b) => b.option.dep.departs)).toEqual([...r.backups.map((b) => b.option.dep.departs)].sort((a, b) => a - b));
  });

  it('shows at once after a pass-up, and never changes the lock', () => {
    const s = session({ type: 'passed_without_stopping', now: dep.departs + MIN });
    const r = backupDeadlines(ds, s, alight, dep.departs + 2 * MIN, 15);
    expect(r).toMatchObject({ show: true, reason: 'passed' });
    expect(s.lock.tripInstanceId).toBe(dep.tripInstanceId);
  });

  it('shows at once when NJ Transit cancels the trip, but a bus that stops reporting is only late', () => {
    const early = dep.departs - 2 * MIN;
    expect(backupDeadlines(ds, session({ type: 'official_cancellation', tripInstanceId: dep.tripInstanceId, now: early }), alight, early, 10)).toMatchObject({ show: true, reason: 'cancelled' });
    const quiet = session({ type: 'tick', now: dep.departs + 30 * MIN });
    expect(backupDeadlines(ds, quiet, alight, dep.departs + 30 * MIN, 10)).toMatchObject({ show: true, reason: 'late' });
  });

  it('is not shown once the rider is not waiting, or without a destination', () => {
    const late = dep.departs + 20 * MIN;
    expect(backupDeadlines(ds, session({ type: 'arrived', now: late }), alight, late, 10).show).toBe(false);
    expect(backupDeadlines(ds, session({ type: 'left', now: late }), alight, late, 10).show).toBe(false);
    expect(backupDeadlines(ds, session(), dep.stopIndex, late, 10).show).toBe(false);
  });
});
