import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { demoDataset } from '../../src/data/demo';
import { createBusSession, reduceBusSession } from '../../src/domain/busLock';
import { forgetLock, loadLock, LOCK_KEY, saveLock } from '../../src/domain/lockStore';
import { departuresOn } from '../../src/domain/schedule';
import type { Dataset } from '../../src/domain/types';

const ds = JSON.parse(readFileSync('public/data/corridor.json', 'utf8')) as Dataset;
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
const dep = departuresOn(ds, { stopId: 'N19', toStopId: 'PABT', date: '20261104' })[3]!;
const leg = { fromStopId: 'N19', toStopId: 'PABT', routeIds: [] as string[] };
const lockedAt = dep.departs - 10 * 60_000;
const waiting = () => reduceBusSession(createBusSession(dep, lockedAt), { type: 'start_waiting', now: lockedAt + 60_000 });

describe('Bus Lock kept on this phone (issue #53)', () => {
  it('round-trips the exact departure, leg and reports with their original times', () => {
    const store = memory();
    const session = reduceBusSession(waiting(), { type: 'no_bus', now: dep.departs + 2 * 60_000 });
    saveLock(store, ds, { dep, leg, session }, dep.departs + 3 * 60_000);
    const back = loadLock<typeof leg>(store, ds, dep.departs + 20 * 60_000)!;
    expect(back.dep.tripInstanceId).toBe(dep.tripInstanceId);
    expect(back.leg).toEqual(leg);
    expect(back.session.reports.map((r) => [r.kind, r.reportedAt])).toEqual([['no_bus', dep.departs + 2 * 60_000]]);
    expect(back.session.waitingSince).toBe(lockedAt + 60_000);
  });

  it('is not offered for another schedule, a trip that is gone, a finished session, or long after the trip', () => {
    const store = memory();
    const save = () => saveLock(store, ds, { dep, leg, session: waiting() }, lockedAt + 60_000);
    save();
    expect(loadLock(store, { ...ds, meta: { ...ds.meta, feedVersion: 'other' } }, dep.departs)).toBeUndefined();
    expect(store.m.has(LOCK_KEY)).toBe(false); // an invalid lock is forgotten
    save();
    expect(loadLock(store, { ...ds, trips: ds.trips.filter((t) => t.id !== dep.tripId) }, dep.departs)).toBeUndefined();
    save();
    expect(loadLock(store, ds, dep.arrivesEnd + 3 * 3600_000)).toBeUndefined();
    save();
    expect(loadLock(store, ds, lockedAt - 60_000)).toBeUndefined(); // clock set back before the lock
    const ended = reduceBusSession(waiting(), { type: 'end', now: lockedAt + 2 * 60_000 });
    saveLock(store, ds, { dep, leg, session: ended }, lockedAt + 2 * 60_000);
    expect(store.m.has(LOCK_KEY)).toBe(false);
  });

  it('never keeps the invented demo, and survives storage errors', () => {
    const store = memory();
    const demoDep = departuresOn(demoDataset, { stopId: 'D2', toStopId: 'PABT', date: '20261104' })[0]!;
    saveLock(store, demoDataset, { dep: demoDep, leg, session: createBusSession(demoDep, demoDep.departs) }, demoDep.departs);
    expect(store.m.has(LOCK_KEY)).toBe(false);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(() => saveLock(broken, ds, { dep, leg, session: waiting() }, lockedAt)).not.toThrow();
    expect(loadLock(broken, ds, lockedAt)).toBeUndefined();
    expect(() => forgetLock(broken)).not.toThrow();
    store.setItem(LOCK_KEY, '{not json');
    expect(loadLock(store, ds, lockedAt)).toBeUndefined();
  });
});
