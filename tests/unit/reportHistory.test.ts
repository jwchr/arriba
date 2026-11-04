import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoDataset } from '../../src/data/demo';
import { createBusSession, reduceBusSession, type BusSession, type BusSessionEvent } from '../../src/domain/busLock';
import { clearHistory, HISTORY_KEY, KEEP_DAYS, loadHistory, recordSession, summarize } from '../../src/domain/reportHistory';
import { departuresOn } from '../../src/domain/schedule';
import type { Dataset, Departure } from '../../src/domain/types';
import { strings } from '../../src/ui/i18n';

const ds = JSON.parse(readFileSync(join(__dirname, '../../public/data/corridor.json'), 'utf8')) as Dataset;
const MIN = 60_000;
// The same scheduled bus (first weekday 165 from N19) on three Wednesdays and one Saturday.
const depOn = (date: string) => departuresOn(ds, { stopId: 'N19', toStopId: 'PABT', date }).find((d) => d.route.shortName === '165')!;
const first = depOn('20261104');
const sameBus = (date: string): Departure => departuresOn(ds, { stopId: 'N19', toStopId: 'PABT', date }).find((d) => d.tripId === first.tripId)!;
const ride = (dep: Departure, id: string, ...events: ((d: Departure) => BusSessionEvent)[]): BusSession =>
  events.reduce((s, e) => reduceBusSession(s, e(dep)), reduceBusSession(createBusSession(dep, dep.departs - 5 * MIN, id), { type: 'start_waiting', now: dep.departs - 5 * MIN }));
const arrived = (late: number) => (d: Departure): BusSessionEvent => ({ type: 'arrived', now: d.departs + late * MIN });
const seats = (d: Departure): BusSessionEvent => ({ type: 'capacity', level: 'seats', now: d.departs + 6 * MIN });
const noBus = (late: number) => (d: Departure): BusSessionEvent => ({ type: 'no_bus', now: d.departs + late * MIN });
function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

describe('personal report history (issue #57)', () => {
  it('keeps each report once, summarises past rides of the same scheduled bus, and leaves today out', () => {
    const store = memory();
    const d1 = sameBus('20261021'), d2 = sameBus('20261028'), today = sameBus('20261104');
    recordSession(store, ds, ride(d1, 'a', arrived(2), seats), d1.departs + 10 * MIN);
    const s2 = ride(d2, 'b', noBus(3), arrived(9));
    recordSession(store, ds, s2, d2.departs + 10 * MIN);
    recordSession(store, ds, s2, d2.departs + 11 * MIN); // the same session again adds nothing
    recordSession(store, ds, ride(today, 'c', arrived(30)), today.departs + 31 * MIN);
    const h = loadHistory(store, today.departs + 40 * MIN);
    expect(h).toHaveLength(5);
    const sum = summarize(ds, h, today, 'c')!;
    expect(sum).toMatchObject({ rides: 2, firstDate: '20261021', lastDate: '20261028', passed: 0, noBus: 1, capacity: { seats: 1, standing: 0, full: 0 } });
    expect(sum.arrived).toEqual({ count: 2, medianMin: 2, minMin: 2, maxMin: 9 });
    // Today's run is never counted, even after its lock ends.
    expect(summarize(ds, h, today)!.rides).toBe(2);
    // A Saturday bus at another time is a different bus.
    const sat = departuresOn(ds, { stopId: 'N19', toStopId: 'PABT', date: '20261107' })[0]!;
    expect(summarize(ds, h, sat)).toBeUndefined();
  });

  it('never keeps the demo, drops damaged and old entries, and can be cleared', () => {
    const store = memory();
    const demoDep = departuresOn(demoDataset, { stopId: demoDataset.stops[0]!.id, date: '20261104' })[0];
    if (demoDep) expect(recordSession(store, demoDataset, ride(demoDep, 'd', arrived(1)), demoDep.departs + 5 * MIN)).toEqual([]);
    const d1 = sameBus('20261021');
    recordSession(store, ds, ride(d1, 'a', arrived(2)), d1.departs + 10 * MIN);
    const good = JSON.parse(store.m.get(HISTORY_KEY)!);
    store.m.set(HISTORY_KEY, JSON.stringify([...good, { ...good[0], kind: 'boarded' }, { ...good[0], slot: 'x' }, { ...good[0], kind: 'capacity' }, null, 5]));
    expect(loadHistory(store, d1.departs + 20 * MIN)).toHaveLength(1);
    expect(loadHistory(store, d1.departs + (KEEP_DAYS + 1) * 86_400_000)).toHaveLength(0);
    store.m.set(HISTORY_KEY, '{oops');
    expect(loadHistory(store, d1.departs)).toEqual([]);
    clearHistory(store);
    expect(store.m.has(HISTORY_KEY)).toBe(false);
  });

  it('keeps no position, only the stop and minutes', () => {
    const store = memory();
    const d1 = sameBus('20261021');
    const s = reduceBusSession(ride(d1, 'a', arrived(2)), { type: 'observation', obs: { tripInstanceId: d1.tripInstanceId, vehicleId: 'v', observedAt: d1.departs, lat: 40.9, lon: -74.0 }, source: 'official', receivedAt: d1.departs });
    recordSession(store, ds, s, d1.departs + 10 * MIN);
    expect(store.m.get(HISTORY_KEY)).not.toMatch(/lat|lon|40\\.9|vehicle/);
  });

  it('reads naturally in English and Spanish', () => {
    expect(strings.en.history.arrived(2, 2, 2, 9)).toBe('You pressed "Bus arrived" 2 times: typically 2 min after the scheduled time (from 2 min after to 9 min after).');
    expect(strings.en.history.arrived(1, -1, -1, -1)).toBe('You pressed "Bus arrived" once, 1 min before the scheduled time.');
    expect(strings.es.history.noBus(1)).toBe('Reportaste que no había llegado una vez.');
    expect(Object.keys(strings.es.history).sort()).toEqual(Object.keys(strings.en.history).sort());
  });
});
