import { describe, expect, it } from 'vitest';
import { createNormalizer } from '../../worker/normalize';
import { uniqueCalendarDate } from '../../worker/service-date';
import { parseLiveSnapshot, LIVE_SOURCE } from '../../src/domain/liveBus';
import { serviceTimeToInstant } from '../../src/domain/time';
import { liveDataset, NOW, binaryFeed, descriptor, vehicle, update } from '../helpers/liveBus';

function oneDate(date = '20261104') {
  const ds = structuredClone(liveDataset);
  for (const cal of Object.values(ds.calendars)) { cal.start = date; cal.end = date; cal.days.fill(true); cal.added = []; cal.removed = []; }
  return ds;
}
const undated = { tripId: descriptor.tripId, routeId: descriptor.routeId, directionId: descriptor.directionId };
const report = (trip = undated) => binaryFeed([{ id: 'v', vehicle: vehicle({ trip }) }]);

describe('provably unique service date compatibility', () => {
  it('accepts a missing date only when the entire calendar has exactly one active date', () => {
    const ds = oneDate(), normalize = createNormalizer(ds);
    expect(normalize(report(), 'vehicles', NOW).observations[0]).toMatchObject({ tripInstanceId: 'T1@20261104', observedAt: NOW - 15_000 });
    expect(normalize(binaryFeed([{ id: 'u', tripUpdate: update({ trip: undated }) }]), 'updates', NOW).updates[0]).toMatchObject({ tripInstanceId: 'T1@20261104', predictions: [{ at: NOW + 300_000 }] });
    expect(normalize(report({ ...undated, startDate: '' } as typeof undated), 'vehicles', NOW).observations).toHaveLength(1);
    expect(createNormalizer(liveDataset)(report(), 'vehicles', NOW).observations).toEqual([]);
  });
  it('proves one Saturday in a weekly calendar, but refuses two Saturdays in a longer feed', () => {
    const cal = { days: [false, false, false, false, false, true, false] as [boolean, boolean, boolean, boolean, boolean, boolean, boolean], start: '20261106', end: '20261113', added: [], removed: [] };
    expect(uniqueCalendarDate(cal)).toBe('20261107');
    expect(uniqueCalendarDate({ ...cal, end: '20261114' })).toBeUndefined();
  });
  it('uses holiday exceptions and removals, including exceptions-only calendars, without choosing the closest day', () => {
    const cal = oneDate().calendars.WK!;
    expect(uniqueCalendarDate({ ...cal, removed: ['20261104'] })).toBeUndefined();
    expect(uniqueCalendarDate({ ...cal, added: ['20261105'] })).toBeUndefined();
    expect(uniqueCalendarDate({ ...cal, start: '99999999', end: '00000000', days: [false, false, false, false, false, false, false], added: ['20261104', '20261104'] })).toBe('20261104');

  });
  it.each([' ', '20261344', '20261105'])('never repairs an explicit invalid/inactive date %j using the unique date', (startDate) => {
    expect(createNormalizer(oneDate())(report({ ...undated, startDate } as typeof undated), 'vehicles', NOW).observations).toEqual([]);
  });
  it('does not convert a fresh report from another day into the sole published trip', () => {
    const ds = oneDate('20261103');
    expect(createNormalizer(ds)(report(), 'vehicles', NOW).observations).toEqual([]);
  });
  it('keeps after-midnight reports on the previous service date and respects the GTFS DST time base', () => {
    for (const date of ['20261103', '20261101', '20260308']) {
      const ds = oneDate(date), trip = ds.trips.find((t) => t.id === 'T1')!;
      trip.times = [24 * 3600 + 600, 24 * 3600 + 1200, 24 * 3600 + 2400];
      const at = serviceTimeToInstant(date, 24 * 3600 + 1500, ds.meta.timezone);
      const bytes = binaryFeed([{ id: 'v', vehicle: vehicle({ trip: undated, timestamp: at / 1000 - 15 }) }], { timestamp: at / 1000 - 10 });
      expect(createNormalizer(ds)(bytes, 'vehicles', at).observations[0]?.tripInstanceId).toBe('T1@' + date);
    }
  });
  it('retains route/direction/relationship checks and never enables compatibility for printed/demo data', () => {
    for (const patch of [{ routeId: 'other' }, { directionId: 1 }, { scheduleRelationship: 1 }]) {
      expect(createNormalizer(oneDate())(report({ ...undated, ...patch }), 'vehicles', NOW).observations).toEqual([]);
    }
    for (const patch of [{ demo: true }, { transcribed: { issued: '20261104', documentId: 'synthetic' } }, { realtime: undefined }]) {
      const ds = oneDate(); Object.assign(ds.meta, patch);
      expect(createNormalizer(ds)(report(), 'vehicles', NOW).observations).toEqual([]);
    }
  });
  it('keeps ambiguous cancellations unknown and accepts an explicit official cancellation date', () => {
    const bytes = (trip: Record<string, unknown>) => binaryFeed([{ id: 'u', tripUpdate: update({ trip: { ...trip, scheduleRelationship: 3 } }) }]);
    expect(createNormalizer(liveDataset)(bytes(undated), 'updates', NOW).updates).toEqual([]);
    expect(createNormalizer(liveDataset)(bytes(descriptor), 'updates', NOW).updates[0]?.cancelled).toBe(true);
  });
  it('discards unusable timestamps without poisoning otherwise valid GPS in the browser packet', () => {
    const ds = oneDate(), normalize = createNormalizer(ds), positions = normalize(report(), 'vehicles', NOW);
    const updates = normalize(binaryFeed([{ id: 'u', tripUpdate: update({ trip: undated, stopTimeUpdate: [{ stopId: '2', departure: { time: Number.MAX_SAFE_INTEGER } }] }) }]), 'updates', NOW);
    expect(updates.updates[0]?.predictions).toEqual([]);
    const packet = { v: 1, source: LIVE_SOURCE, feedVersion: ds.meta.feedVersion, tripInstanceId: 'T1@20261104', receivedAt: NOW, vehicles: positions.feed, updates: updates.feed, observations: positions.observations, predictions: [], skippedStops: [] };
    expect(parseLiveSnapshot(packet, ds, 'T1', '20261104', NOW).observations).toHaveLength(1);
    expect(normalize(binaryFeed([{ id: 'v', vehicle: vehicle({ trip: undated, timestamp: Number.MAX_SAFE_INTEGER }) }]), 'vehicles', NOW).observations).toEqual([]);
    expect(normalize(binaryFeed([], { timestamp: Number.MAX_SAFE_INTEGER }), 'vehicles', NOW).feed.state).toBe('invalid');
  });
});
