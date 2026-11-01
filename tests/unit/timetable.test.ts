import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without type declarations
import { buildTimetableDataset } from '../../scripts/timetable-lib.mjs';
import { alightingStopFor, checkDirection } from '../../src/domain/direction';
import { gateFor, publishedGateFor } from '../../src/domain/gate';
import { departuresOn } from '../../src/domain/schedule';
import { formatTime12 } from '../../src/domain/time';
import type { Dataset } from '../../src/domain/types';

const root = join(__dirname, '../..');
const doc = JSON.parse(readFileSync(join(root, 'data/t0165/transcription.json'), 'utf8'));
const committed = JSON.parse(readFileSync(join(root, 'public/data/corridor.json'), 'utf8')) as Dataset;
const ds = buildTimetableDataset(doc, { builtAt: committed.meta.builtAt }) as Dataset;
const TZ = 'America/New_York';
const fmt = (t: number) => formatTime12(t, TZ);
const patternOf = (id: string) => ds.patterns.find((p) => p.id === id)!;

describe('route 165 printed-timetable dataset', () => {
  it('is what the build script produces from the checked-in transcription', () => {
    expect(committed).toEqual(ds);
  });

  it('keeps every printed row as one trip (500 rows) and is honest about its source', () => {
    expect(ds.trips).toHaveLength(500);
    expect(new Set(ds.trips.map((t) => t.id)).size).toBe(500);
    expect(ds.meta.demo).toBe(false);
    expect(ds.meta.transcribed).toEqual({ issued: '20260701', documentId: 'T0165 - 7/26' });
    expect(ds.stops.every((s) => s.lat === undefined && s.lon === undefined)).toBe(true);
    expect(ds.trips.every((t) => t.estimated === undefined)).toBe(true);
  });

  it('has consistent references and plausible times on every trip', () => {
    const stopIds = new Set(ds.stops.map((s) => s.id));
    for (const p of ds.patterns) expect(p.stopIds.every((id) => stopIds.has(id))).toBe(true);
    for (const t of ds.trips) {
      const p = patternOf(t.patternId);
      expect(t.times).toHaveLength(p.stopIds.length);
      expect(ds.calendars[t.serviceId]).toBeDefined();
      for (let i = 1; i < t.times.length; i++) {
        const step = (t.times[i]! - t.times[i - 1]!) / 60;
        expect(step, `${t.id} stop ${i}`).toBeGreaterThanOrEqual(0);
        expect(step, `${t.id} stop ${i}`).toBeLessThanOrEqual(45);
      }
      expect(t.times[t.times.length - 1]!).toBeLessThan(27 * 3600);
    }
    // Direction 0 patterns all end at the terminal; PABT is the only stop shared by both directions.
    for (const p of ds.patterns.filter((x) => x.directionId === 0)) expect(p.stopIds.at(-1)).toBe('PABT');
    expect(ds.stops.filter((s) => s.terminal === 'PABT')).toHaveLength(1);
  });

  it('routes only T-marked trips to 165T and records the marker on the pattern', () => {
    for (const p of ds.patterns) {
      expect(p.routeId === 'R165T').toBe(p.variant === 'T');
      expect([undefined, 'T', 'P', 'R', 'RF', 'FP']).toContain(p.variant);
    }
  });

  it('matches values read directly off the printed page', () => {
    // Saturday to New York, T trip printed 6:37 ... 7:39 AM.
    const sat = ds.trips.find((t) => t.serviceId === 'SAT' && patternOf(t.patternId).variant === 'T' && t.times[0] === (6 * 60 + 37) * 60 && patternOf(t.patternId).directionId === 0)!;
    expect(sat.times.map((x) => (x - sat.times[0]!) / 60)).toEqual([0, 4, 8, 14, 16, 21, 28, 32, 41, 62]);
    // Weekday to Westwood, T trip leaving PABT 11:05 PM, last printed 12:01 AM (after midnight, 24:01).
    const late = ds.trips.find((t) => t.serviceId === 'WKDY' && patternOf(t.patternId).variant === 'T' && patternOf(t.patternId).directionId === 1 && t.times[0] === 23 * 3600 + 5 * 60)!;
    expect(late.times.at(-1)).toBe(24 * 3600 + 60);
    // Weekday to Westwood, first printed row: 5:19 AM at Weehawken (no PABT time).
    const first = ds.trips.filter((t) => t.serviceId === 'WKDY' && patternOf(t.patternId).directionId === 1)[0]!;
    expect(first.times[0]).toBe((5 * 60 + 19) * 3600 / 60);
    expect(patternOf(first.patternId).stopIds[0]).toBe('W2');
  });

  it('lists departures from Port Authority on a weekday, with the after-midnight trip on the next calendar day', () => {
    const wed = departuresOn(ds, { stopId: 'PABT', date: '20261104', directionId: 1 });
    expect(wed.length).toBeGreaterThan(60);
    expect(wed.some((d) => fmt(d.departs) === '11:05 PM' && d.route.shortName === '165T')).toBe(true);
    const thu = departuresOn(ds, { stopId: 'PABT', date: '20261105', directionId: 1 });
    // Service-day Wednesday trips past 24:00 appear early on Thursday's calendar date.
    expect(thu.some((d) => d.serviceDate === '20261104' && /^12:/.test(fmt(d.departs)))).toBe(true);
  });

  it('keeps Sunday free of express trips (Saturday night trips running past midnight excepted)', () => {
    const sun = departuresOn(ds, { stopId: 'PABT', date: '20261108' });
    expect(sun.length).toBeGreaterThan(20);
    const own = sun.filter((d) => d.serviceDate === '20261108');
    expect(own.length).toBeGreaterThan(20);
    expect(own.every((d) => d.route.shortName === '165' && d.pattern.variant === undefined)).toBe(true);
    expect(sun.every((d) => d.serviceDate === '20261108' || d.serviceDate === '20261107')).toBe(true);
  });
});

describe('twin stops without coordinates', () => {
  it('sends a rider on the wrong side to the stop across the street, and says nothing about distance', () => {
    const c = checkDirection(ds, 'W19', 'PABT');
    expect(c).toMatchObject({ ok: false, reason: 'wrong-side', useStop: { id: 'N19' } });
    expect((c as { distanceM?: number }).distanceM).toBeUndefined();
    expect(checkDirection(ds, 'N19', 'PABT')).toEqual({ ok: true });
  });
  it('picks the return stop from the twin link, and refuses to guess where no twin is printed', () => {
    expect(alightingStopFor(ds, 'PABT', 'N19')?.id).toBe('W19');
    // Fairview: the printed locations differ by direction, so no twin is claimed.
    expect(ds.stops.find((s) => s.id === 'N6')?.twin).toBeUndefined();
    expect(checkDirection(ds, 'W6', 'PABT')).toEqual({ ok: false, reason: 'not-served' });
  });
  it('links only stops with the same printed location, and links them both ways', () => {
    const byId = new Map(ds.stops.map((s) => [s.id, s]));
    const pairs = ds.stops.filter((s) => s.twin);
    expect(pairs.length).toBe(22);
    for (const s of pairs) {
      expect(byId.get(s.twin!)?.twin).toBe(s.id);
      const strip = (n: string) => n.replace(/ \(to (New York|Westwood)\)$/, '');
      expect(strip(byId.get(s.twin!)!.name)).toBe(strip(s.name));
    }
  });
});

describe('published Port Authority gates', () => {
  const g = ds.publishedGates;
  const at = (service: string, h: number, m: number, day: 'weekday' | 'saturday' | 'sunday') => publishedGateFor(g, service, h * 60 + m, day);
  it('applies the printed local-service windows by clock time, including after midnight', () => {
    expect(at('local', 6, 0, 'weekday')).toMatchObject({ gate: '212', door: '1' });
    expect(at('local', 22, 0, 'sunday')).toMatchObject({ gate: '212', door: '1' });
    expect(at('local', 22, 1, 'weekday')).toMatchObject({ gate: '325' });
    expect(at('local', 24, 30, 'saturday')).toMatchObject({ gate: '325' }); // 12:30 AM after Saturday service
    expect(at('local', 25, 0, 'weekday')).toMatchObject({ gate: '325' }); // 1:00 AM
    expect(at('local', 25, 1, 'weekday')).toMatchObject({ gate: '80' }); // 1:01 AM
    expect(at('local', 5, 59, 'weekday')).toMatchObject({ gate: '80' });
  });
  it('applies the express rules only on the days NJ Transit prints', () => {
    expect(at('P', 17, 0, 'weekday')?.gate).toBe('311');
    expect(at('R', 17, 0, 'weekday')?.gate).toBe('312');
    expect(at('RF', 17, 0, 'weekday')?.gate).toBe('312');
    expect(at('P', 17, 0, 'saturday')).toBeUndefined();
    expect(at('T', 17, 0, 'saturday')?.gate).toBe('310');
    expect(at('T', 23, 0, 'weekday')?.gate).toBe('324');
    expect(at('T', 17, 0, 'sunday')).toBeUndefined();
    expect(at('T', 3, 0, 'weekday')).toBeUndefined();
  });
  it('is a last resort: a posted or learned gate wins, and with no rule the answer stays unknown', () => {
    const posted = [{ tripInstanceId: 'X@20261104', gate: '218', observedAt: 1, source: 'demo' as const }];
    expect(gateFor('X@20261104', 'p', 1020, 'weekday', posted, [], g, 'P')).toMatchObject({ status: 'posted', gate: '218' });
    expect(gateFor('Y@20261104', 'p', 1020, 'weekday', [], [], g, 'P')).toMatchObject({ status: 'published', gate: '311', effective: '20250315' });
    expect(gateFor('Y@20261104', 'p', 1020, 'weekday', [], [], g, 'FP')).toEqual({ status: 'unknown' });
    expect(gateFor('Y@20261104', 'p', 1020, 'weekday', [], [])).toEqual({ status: 'unknown' });
  });
  it('has a published gate rule for every printed Port Authority departure to Westwood', () => {
    const missing: string[] = [];
    for (const t of ds.trips) {
      const p = patternOf(t.patternId);
      if (p.directionId !== 1 || p.stopIds[0] !== 'PABT') continue;
      const day = t.serviceId === 'SAT' ? 'saturday' : t.serviceId === 'SUN' ? 'sunday' : 'weekday';
      if (!publishedGateFor(g, p.variant ?? 'local', t.times[0]! / 60, day)) missing.push(`${t.id} ${p.variant ?? 'local'}`);
    }
    expect(missing).toEqual([]);
  });
});
