import { describe, expect, it } from 'vitest';
import { fixPosition, scheduledAt, stopReached, timetablePosition, tripProgress, type Fix } from '../../src/domain/tripProgress';
import type { Stop } from '../../src/domain/types';

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 4, 12, 0);
// Invented straight line, about 1.1 km between stops, 10 minutes apart.
const stops: Stop[] = [0, 1, 2, 3, 4].map((i) => ({ id: `S${i}`, name: `Stop ${i}`, lat: 40.9 + i * 0.01, lon: -74.0 }));
const times = stops.map((_, i) => T0 + i * 10 * MIN);
const at = (i: number, extra = 0): Fix => ({ lat: 40.9 + i * 0.01, lon: -74.0, at: extra, accuracyM: 20 });
const base = { stops, times, boardIndex: 0, alightIndex: 4, milestones: [] };

describe('trip progress while riding (owner request 2026-11-04)', () => {
  it('interpolates the timetable both ways', () => {
    expect(scheduledAt(times, 1.5)).toBe(T0 + 15 * MIN);
    expect(timetablePosition(times, T0 + 25 * MIN)).toBeCloseTo(2.5);
    expect(timetablePosition(times, T0 - MIN)).toBe(0);
    expect(timetablePosition(times, T0 + 99 * MIN)).toBe(4);
  });

  it('without evidence, shows the timetable position and claims no ahead or behind', () => {
    const p = tripProgress({ ...base, now: T0 + 15 * MIN });
    expect(p).toMatchObject({ basis: 'timetable', projected: false });
    expect(p.position).toBeCloseTo(1.5);
    expect(p.delayMin).toBeUndefined();
    expect(p.alight.projected).toBeUndefined();
  });

  it('a tap at a stop gives the delay and carries the bus forward at that pace', () => {
    // Reached stop 2 at 12:24, scheduled 12:20: 4 min behind.
    const now = T0 + 26 * MIN;
    const p = tripProgress({ ...base, now, milestones: [{ index: 2, at: T0 + 24 * MIN, source: 'tap' }] });
    expect(p).toMatchObject({ basis: 'tap', delayMin: 4, reachedIndex: 2, projected: true });
    expect(p.position).toBeCloseTo(2.2);
    expect(p.alight).toEqual({ scheduled: times[4], projected: times[4]! + 4 * MIN });
  });

  it('phone GPS between stops gives the position and delay; old or imprecise fixes are ignored', () => {
    const now = T0 + 13 * MIN;
    const mid = { lat: 40.915, lon: -74.0, at: now - 5_000, accuracyM: 25 };
    const p = tripProgress({ ...base, now, phone: mid });
    expect(p.basis).toBe('phone_gps');
    expect(p.position).toBeCloseTo(1.5, 1);
    expect(p.delayMin).toBe(-2); // where the timetable puts 12:15, at 12:13: 2 min ahead
    expect(tripProgress({ ...base, now, phone: { ...mid, at: now - 10 * MIN } }).basis).toBe('timetable');
    expect(tripProgress({ ...base, now, phone: { ...mid, accuracyM: 500 } }).basis).toBe('timetable');
  });

  it('GPS jitter never moves the bus behind a stop already reached', () => {
    const now = T0 + 22 * MIN;
    const p = tripProgress({ ...base, now, milestones: [{ index: 2, at: T0 + 21 * MIN, source: 'tap' }], phone: { lat: 40.919, lon: -74.0, at: now - 1_000, accuracyM: 20 } });
    expect(p.position).toBeGreaterThanOrEqual(2);
  });

  it('the newest evidence wins, and the bus GPS beats the phone when equally fresh', () => {
    const now = T0 + 21 * MIN;
    const p = tripProgress({ ...base, now, milestones: [{ index: 1, at: T0 + 12 * MIN, source: 'tap' }], bus: at(2, now - 2_000), phone: at(2, now - 2_000) });
    expect(p.basis).toBe('bus_gps');
    expect(p.delayMin).toBe(0); // at stop 2 at 12:20:58, scheduled 12:20: under a minute is on time
  });

  it('marks a stop reached only within 80 m and beyond the last one reached', () => {
    expect(stopReached(stops, 0, at(1))).toBe(1);
    expect(stopReached(stops, 1, at(1))).toBeUndefined();
    expect(stopReached(stops, 0, { lat: 40.912, lon: -74.0, at: 0, accuracyM: 20 })).toBeUndefined();
    expect(stopReached(stops, 0, { ...at(1), accuracyM: 400 })).toBeUndefined();
  });

  it('needs every stop located to use GPS at all (the printed timetable has none)', () => {
    const unlocated = stops.map((s) => ({ id: s.id, name: s.name }));
    expect(fixPosition(unlocated, 0, at(1, T0), T0)).toBeUndefined();
    expect(tripProgress({ ...base, stops: unlocated, now: T0 + 5 * MIN, phone: at(1, T0 + 5 * MIN) }).basis).toBe('timetable');
  });
});
