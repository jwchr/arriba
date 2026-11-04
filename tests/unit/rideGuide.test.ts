import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { demoDataset as ds } from '../../src/data/demo';
import type { TripLock, VehicleObservation } from '../../src/domain/lock';
import { rideGuide } from '../../src/domain/rideGuide';
import type { Dataset } from '../../src/domain/types';

// Demo route L0: D1, D2, D3, D4, PABT (Port Authority is the end of the line).
const L0 = ds.patterns.find((p) => p.id === 'L0')!.stopIds;
const NOW = 1_000_000;
const pt = (d: Dataset, id: string) => { const s = d.stops.find((x) => x.id === id)!; return { lat: s.lat!, lon: s.lon! }; };
const at = (id: string) => pt(ds, id);
const between = (a: { lat: number; lon: number }, b: { lat: number; lon: number }, f: number) => ({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
/** Move a position `m` metres east (+) or west (-). */
const east = (p: { lat: number; lon: number }, m: number) => ({ lat: p.lat, lon: p.lon + m / (111_320 * Math.cos((p.lat * Math.PI) / 180)) });
const obs = (pos: { lat: number; lon: number }, observedAt = NOW - 5_000): VehicleObservation => ({ tripInstanceId: 'T@1', vehicleId: 'V1', observedAt, ...pos });
const lock = (pos: { lat: number; lon: number } | undefined, status: TripLock['status'] = 'tracked', observedAt?: number): TripLock => ({
  tripInstanceId: 'T@1', status, lockedAt: 0, vehicleId: pos ? 'V1' : undefined, last: pos ? obs(pos, observedAt) : undefined,
});
const g = (l: TripLock, board = 1, alight = 4, history: VehicleObservation[] = [], data: Dataset = ds, stops: readonly string[] = L0) => rideGuide(data, stops, board, alight, l, NOW, history);

describe('ride guide: a stop count only from fresh, unambiguous GPS on a trip with every stop listed', () => {
  it('counts the stops still ahead, the rider’s own included', () => {
    expect(g(lock(at('D2')))).toMatchObject({ basis: 'gps', stage: 'three', stopsAway: 3 });
    expect(g(lock(between(at('D2'), at('D3'), 0.5)))).toMatchObject({ stage: 'three' });
    expect(g(lock(at('D3')))).toMatchObject({ stage: 'two', stopsAway: 2 });
    expect(g(lock(between(at('D3'), at('D4'), 0.995)))).toMatchObject({ stage: 'last_next', stopsAway: 1 }); // pulling into D4
  });

  it('says to ask for the stop only after the bus leaves the stop before it', () => {
    // Getting off at D4 (index 3), not the end of the line.
    expect(g(lock(at('D3')), 1, 3)).toMatchObject({ stage: 'one' });
    expect(g(lock(between(at('D3'), at('D4'), 0.97)), 1, 3)).toMatchObject({ stage: 'request' }); // about 120 m before D4
    expect(g(lock(between(at('D3'), at('D4'), 0.995)), 1, 3)).toMatchObject({ stage: 'arrived' }); // about 20 m: at D4
  });

  it('never says "press now" while still at the stop before the rider’s, or right after boarding for the next stop', () => {
    expect(g(lock(between(at('D3'), at('D4'), 0.0005)), 1, 3)).toMatchObject({ stage: 'one' });
    expect(g(lock(at('D2')), 1, 2)).toMatchObject({ stage: 'one' }); // boarded; your stop is the next one
    expect(g(lock(between(at('D2'), at('D3'), 0.4)), 1, 2)).toMatchObject({ stage: 'request' });
    expect(g(lock(between(at('D3'), at('D4'), 0.5)), 1, 3)).toMatchObject({ stage: 'request' });
  });

  it('does not ask riders to request the end of the line, which the bus serves anyway', () => {
    expect(g(lock(between(at('D4'), at('PABT'), 0.5)))).toMatchObject({ stage: 'last_next' });
    expect(g(lock(at('PABT')))).toMatchObject({ stage: 'arrived' });
  });

  it('says the bus may have passed the stop instead of "this is your stop"', () => {
    expect(g(lock(between(at('D4'), at('PABT'), 0.05)), 1, 3)).toMatchObject({ stage: 'passed' });
    expect(g(lock(between(at('D4'), at('PABT'), 0.3)), 1, 3)).toMatchObject({ stage: 'passed' });
    expect(g(lock(at('D4')), 1, 3)).toMatchObject({ stage: 'arrived' });
  });

  it('absorbs small backward GPS jitter but not a big disagreement', () => {
    const jitter = between(at('D3'), at('D2'), 0.035); // about 65 m back from D3
    expect(g(lock(jitter))).toMatchObject({ stage: 'three' }); // on its own: not yet at D3
    expect(g(lock(jitter), 1, 4, [obs(at('D3'), NOW - 20_000)])).toMatchObject({ stage: 'two' });
    expect(g(lock(between(at('D2'), at('D3'), 0.6)), 1, 4, [obs(at('D3'), NOW - 20_000)])).toEqual({ basis: 'uncertain', reason: 'inconsistent' });
  });

  it('never lets one GPS reading far ahead override the newest one', () => {
    // Straight line, stops every 300 m: S0..S6. Board at S0, get off at S4. Newest fix exactly at S2.
    const S = Array.from({ length: 7 }, (_, i) => ({ id: `S${i}`, name: `S${i}`, lat: 40.8 + (i * 300) / 110_540, lon: -74.0 }));
    const line: Dataset = { ...ds, meta: { ...ds.meta }, stops: S };
    const ids = S.map((s) => s.id);
    const along = (m: number) => ({ lat: 40.8 + m / 110_540, lon: -74.0 });
    const run = (history: VehicleObservation[]) => g(lock(along(600), 'tracked', NOW - 1_000), 0, 4, history, line, ids);
    expect(run([])).toMatchObject({ stage: 'two' });
    expect(run([obs(along(1_000), NOW - 20_000)])).toEqual({ basis: 'uncertain', reason: 'inconsistent' });
    expect(run([obs(along(1_150), NOW - 20_000)])).toEqual({ basis: 'uncertain', reason: 'inconsistent' });
    expect(run([obs(along(1_250), NOW - 5 * 60_000)])).toMatchObject({ stage: 'two' }); // too old to weigh in
    expect(run([obs(along(660), NOW - 10_000)])).toMatchObject({ stage: 'two' }); // 60 m ahead: jitter, absorbed
  });

  it('treats a position clamped at the end of the line as arrived, never passed', () => {
    expect(g(lock({ lat: at('PABT').lat - 0.0018, lon: at('PABT').lon + 0.0008 }))).toMatchObject({ stage: 'arrived' });
  });

  it('refuses to count when another part of the route is about as close', () => {
    // An out-and-back line: A -> B north on one street, C -> D south on a parallel street 150 m east.
    const A = { lat: 40.80, lon: -74.0 }, B = { lat: 40.81, lon: -74.0 };
    const ob: Dataset = { ...ds, meta: { ...ds.meta }, stops: [
      { id: 'A', name: 'A', ...A }, { id: 'B', name: 'B', ...B },
      { id: 'C', name: 'C', ...east(B, 150) }, { id: 'D', name: 'D', ...east(A, 150) },
    ] };
    const halfway = between(A, B, 0.5);
    expect(g(lock(halfway), 0, 3, [], ob, ['A', 'B', 'C', 'D'])).toMatchObject({ basis: 'gps', stage: 'three' });
    expect(g(lock(east(halfway, 80)), 0, 3, [], ob, ['A', 'B', 'C', 'D'])).toEqual({ basis: 'uncertain', reason: 'ambiguous' });
  });

  it('says what it cannot know instead of counting', () => {
    expect(g(lock(undefined, 'scheduled_only'))).toEqual({ basis: 'uncertain', reason: 'no_gps' });
    expect(g(lock(at('D3'), 'stale'))).toEqual({ basis: 'uncertain', reason: 'stale_gps' });
    expect(g(lock(at('D3'), 'tracked', NOW - 3 * 60_000))).toEqual({ basis: 'uncertain', reason: 'stale_gps' }); // a missed tick
    expect(g(lock(at('D3'), 'needs_confirmation'))).toEqual({ basis: 'uncertain', reason: 'identity' });
    expect(g(lock(at('D3'), 'cancelled'))).toEqual({ basis: 'uncertain', reason: 'cancelled' });
    expect(g(lock(east(at('D3'), 2_000)))).toEqual({ basis: 'uncertain', reason: 'off_route' });
    expect(g(lock(between(at('D1'), at('D2'), 0.5)))).toEqual({ basis: 'uncertain', reason: 'behind' });
  });

  it('never counts stops on a printed timetable, which lists timepoints only', () => {
    const printed = JSON.parse(readFileSync('public/data/corridor.json', 'utf8')) as Dataset;
    expect(rideGuide(printed, ['W19', 'W20'], 0, 1, lock(at('D2')), NOW)).toEqual({ basis: 'timetable_only' });
  });

  it('needs a destination after the boarding stop', () => {
    expect(g(lock(at('D3')), 2, 2)).toEqual({ basis: 'uncertain', reason: 'no_gps' });
  });
});
