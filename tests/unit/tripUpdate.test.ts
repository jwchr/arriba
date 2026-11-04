import { describe, expect, it } from 'vitest';
import { demoDataset } from '../../src/data/demo';
import { createBusSession, reduceBusSession, type BusSession, type BusSessionEvent } from '../../src/domain/busLock';
import { nextDepartures } from '../../src/domain/schedule';
import { zonedWallTime } from '../../src/domain/time';
import { tripUpdate } from '../../src/domain/tripUpdate';
import { strings } from '../../src/ui/i18n';

const ds = demoDataset;
const TZ = ds.meta.timezone;
const from = ds.stops.find((s) => s.name === 'Maple Ave & Main St (to NYC)')!;
const pabt = ds.stops.find((s) => s.terminal)!;
const dep = nextDepartures(ds, { stopId: from.id, toStopId: pabt.id, routeIds: [] }, zonedWallTime(2026, 11, 4, 7, 50, TZ), 1)[0]!;
const alight = dep.pattern.stopIds.indexOf(pabt.id);
const MIN = 60_000;
const run = (...events: BusSessionEvent[]): BusSession => events.reduce(reduceBusSession, createBusSession(dep, dep.departs - 10 * MIN, 's'));

describe('trip update to share (issue #61)', () => {
  it('follows what the rider reported, step by step', () => {
    const t0 = dep.departs - 10 * MIN;
    expect(tripUpdate(ds, run(), alight, t0).update).toEqual({ kind: 'planning' });
    const waiting = run({ type: 'start_waiting', now: t0 });
    expect(tripUpdate(ds, waiting, alight, t0).update).toEqual({ kind: 'waiting' });
    expect(tripUpdate(ds, waiting, alight, dep.departs + 30_000).update).toEqual({ kind: 'not_here', lateMin: 0 });
    expect(tripUpdate(ds, waiting, alight, dep.departs + 7 * MIN).update).toEqual({ kind: 'not_here', lateMin: 7 });
    const passed = reduceBusSession(waiting, { type: 'passed_without_stopping', now: dep.departs + MIN });
    expect(tripUpdate(ds, passed, alight, dep.departs + 2 * MIN).update).toEqual({ kind: 'passed' });
    const arrived = reduceBusSession(waiting, { type: 'arrived', now: dep.departs });
    expect(tripUpdate(ds, arrived, alight, dep.departs).update).toEqual({ kind: 'arrived' });
    const onboard = reduceBusSession(arrived, { type: 'boarded', now: dep.departs });
    expect(tripUpdate(ds, onboard, alight, dep.departs).update).toMatchObject({ kind: 'onboard', to: { stopId: pabt.id } });
    expect(tripUpdate(ds, onboard, dep.stopIndex, dep.departs).update).toEqual({ kind: 'onboard' });
    expect(tripUpdate(ds, reduceBusSession(onboard, { type: 'end', now: dep.departs + MIN }), alight, dep.departs + MIN).update).toEqual({ kind: 'off' });
    expect(tripUpdate(ds, reduceBusSession(waiting, { type: 'left', now: t0 }), alight, t0).update).toEqual({ kind: 'left' });
  });

  it('marks the demo, and says cancelled only when NJ Transit cancelled the trip', () => {
    const u = tripUpdate(ds, run(), alight, dep.departs);
    expect(u.demo).toBe(true);
    const cancelled = run({ type: 'start_waiting', now: dep.departs - MIN }, { type: 'official_cancellation', tripInstanceId: dep.tripInstanceId, now: dep.departs });
    expect(tripUpdate(ds, cancelled, alight, dep.departs).update).toEqual({ kind: 'cancelled' });
    // A bus that stops reporting is never "cancelled".
    const quiet = run({ type: 'start_waiting', now: dep.departs - MIN }, { type: 'tick', now: dep.departs + 30 * MIN });
    expect(tripUpdate(ds, quiet, alight, dep.departs + 30 * MIN).update.kind).toBe('not_here');
  });

  it('reads naturally in English and Spanish', () => {
    const en = strings.en.share.text, es = strings.es.share.text;
    expect(en({ kind: 'not_here', lateMin: 7 }, '165', '7:52 AM', 'Irvington St.')).toBe('Still waiting at Irvington St. for the 7:52 AM 165. Not here yet, 7 min after its scheduled time.');
    expect(en({ kind: 'onboard', to: { stopId: 'x', at: 0, estimated: false } }, '165', '7:52 AM', 'Irvington St.', { stop: 'Port Authority', time: '8:37 AM' }))
      .toBe("I'm on the 7:52 AM 165 from Irvington St. Scheduled to reach Port Authority at 8:37 AM.");
    expect(es({ kind: 'onboard', to: { stopId: 'x', at: 0, estimated: false } }, '165', '1:10 a. m.', 'Port Authority', { stop: 'Irvington St.', time: '2:05 a. m.' }))
      .toBe('Voy en el 165 de la 1:10 a. m. desde Port Authority. Llegada prevista a Irvington St. a las 2:05 a. m.');
    expect(es({ kind: 'off' }, '165', '7:52 a. m.', 'x')).toBe('Me bajé del 165 de las 7:52 a. m.');
    expect(es({ kind: 'not_here', lateMin: 0 }, '165', '7:52 a. m.', 'Irvington St.')).toBe('Sigo esperando en Irvington St. el 165 de las 7:52 a. m. Todavía no llega.');
  });
});
