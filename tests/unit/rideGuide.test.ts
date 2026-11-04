import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { demoDataset as ds } from '../../src/data/demo';
import type { TripLock } from '../../src/domain/lock';
import { rideGuide } from '../../src/domain/rideGuide';
import type { Dataset } from '../../src/domain/types';

// Demo route L0: D1, D2, D3, D4, PABT. The rider boards at D2 (index 1) and gets off at Port Authority (4).
const stopIds = ds.patterns.find((p) => p.id === 'L0')!.stopIds;
const at = (id: string) => { const s = ds.stops.find((x) => x.id === id)!; return { lat: s.lat!, lon: s.lon! }; };
const between = (a: string, b: string, f: number) => ({ lat: at(a).lat + (at(b).lat - at(a).lat) * f, lon: at(a).lon + (at(b).lon - at(a).lon) * f });
const lock = (pos: { lat: number; lon: number } | undefined, status: TripLock['status'] = 'tracked'): TripLock => ({
  tripInstanceId: 'T@20261104', status, lockedAt: 0, vehicleId: pos ? 'V1' : undefined,
  last: pos ? { tripInstanceId: 'T@20261104', vehicleId: 'V1', observedAt: 1000, ...pos } : undefined,
});
const guide = (l: TripLock, data: Dataset = ds) => rideGuide(data, stopIds, 1, 4, l);

describe('ride guide: stop countdown only from fresh GPS on a trip with every stop listed', () => {
  it('counts the stops still ahead, the rider’s own included', () => {
    expect(guide(lock(at('D2')))).toMatchObject({ basis: 'gps', stage: 'three', stopsAway: 3 });
    expect(guide(lock(between('D2', 'D3', 0.5)))).toMatchObject({ stage: 'three', stopsAway: 3 });
    expect(guide(lock(at('D3')))).toMatchObject({ stage: 'two', stopsAway: 2 });
    expect(guide(lock(between('D3', 'D4', 0.6)))).toMatchObject({ stage: 'two' });
    expect(guide(lock(at('D4')))).toMatchObject({ stage: 'one', stopsAway: 1 });
    expect(guide(lock(at('PABT')))).toMatchObject({ stage: 'arrived', stopsAway: 0 });
  });

  it('treats a bus pulling into a stop as at that stop', () => {
    expect(guide(lock(between('D3', 'D4', 0.995)))).toMatchObject({ stage: 'one' });
  });

  it('says what it cannot know instead of counting', () => {
    expect(guide(lock(undefined, 'scheduled_only'))).toEqual({ basis: 'uncertain', reason: 'no_gps' });
    expect(guide(lock(at('D3'), 'stale'))).toEqual({ basis: 'uncertain', reason: 'stale_gps' });
    expect(guide(lock(at('D3'), 'vanished'))).toEqual({ basis: 'uncertain', reason: 'stale_gps' });
    expect(guide(lock(at('D3'), 'needs_confirmation'))).toEqual({ basis: 'uncertain', reason: 'identity' });
    expect(guide(lock({ lat: at('D3').lat, lon: at('D3').lon + 0.05 }))).toEqual({ basis: 'uncertain', reason: 'off_route' });
  });

  it('never counts stops on a printed timetable, which lists timepoints only', () => {
    const printed = JSON.parse(readFileSync('public/data/corridor.json', 'utf8')) as Dataset;
    expect(rideGuide(printed, ['W19', 'W20'], 0, 1, lock(at('D2')))).toEqual({ basis: 'timetable_only' });
  });

  it('needs a destination after the boarding stop', () => {
    expect(rideGuide(ds, stopIds, 2, 2, lock(at('D3')))).toEqual({ basis: 'uncertain', reason: 'no_gps' });
  });
});
