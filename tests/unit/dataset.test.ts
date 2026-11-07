import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoDataset } from '../../src/data/demo';
import { parseDataset } from '../../src/domain/dataset';
// @ts-expect-error plain ESM script without type declarations
import { buildDataset } from '../../scripts/gtfs-lib.mjs';

const printed = JSON.parse(readFileSync(join(__dirname, '../../public/data/corridor.json'), 'utf8'));
function corrupt(path: string, value: unknown, source: unknown = demoDataset): unknown {
  const copy = structuredClone(source) as Record<string, unknown>;
  const keys = path.split('.');
  let parent = copy;
  for (const key of keys.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  parent[keys.at(-1)!] = value;
  return copy;
}

describe('schedule JSON boundary', () => {
  it('preserves printed and demo data, sources, after-midnight times and optional metadata', () => {
    expect(parseDataset(printed)).toBe(printed);
    expect(parseDataset(demoDataset)).toBe(demoDataset);
    const extended = { ...structuredClone(printed), futureMetadata: { version: 2 } };
    expect(parseDataset(extended)).toBe(extended);
    expect(printed.trips.some((t: { times: number[] }) => t.times.some((s) => s > 86400))).toBe(true);
  });

  it('accepts the actual GTFS builder output, including exception-only service and estimated times', () => {
    const dir = join(__dirname, '../fixtures/gtfs-mini');
    const files = Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
    const ds = buildDataset(files, { routeShortNames: ['165', '165t'], builtAt: '2026-11-06T12:00:00Z' });
    expect(parseDataset(ds)).toBe(ds);
    expect(ds.calendars.HOL).toMatchObject({ start: '99999999', end: '00000000', added: ['20261126'] });
    expect(ds.trips.some((t: { estimated?: number[] }) => t.estimated?.length)).toBe(true);
  });

  it.each([null, [], {}, { trips: [{}] }])('rejects incomplete top-level data: %j', (value) => {
    expect(() => parseDataset(value)).toThrow();
  });

  it.each([
    ['meta', null], ['meta.demo', 'false'], ['meta.source', {}], ['meta.feedVersion', null],
    ['meta.builtAt', 'not a date'], ['meta.timezone', 'Not/A_timezone'],
    ['routes', {}], ['stops', null], ['patterns', []], ['trips', []], ['calendars', []],
    ['routes.0.shortName', {}], ['routes.0.id', ''], ['stops.0.name', {}],
    ['stops.0.lat', 91], ['stops.0.lon', NaN], ['stops.0.twin', 'missing-stop'],
    ['patterns.0.routeId', 'missing-route'], ['patterns.0.directionId', 2],
    ['patterns.0.headsign', {}], ['patterns.0.stopIds', ['D1', 'missing-stop']],
    ['patterns.0.stopIds', ['D1']], ['trips.0.patternId', 'missing-pattern'],
    ['trips.0.serviceId', 'missing-service'], ['trips.0.serviceId', 'constructor'],
    ['trips.0.times', [0]], ['trips.0.times.0', -1], ['trips.0.times.0', Infinity],
    ['trips.0.times.0', Number.MAX_SAFE_INTEGER], ['trips.0.times.0', 0.5],
    ['trips.0.times.1', 0], ['trips.0.estimated', [999]], ['trips.0.estimated', ['1']],
    ['calendars.WKDY.days', [true]], ['calendars.WKDY.days.0', 1],
    ['calendars.WKDY.start', '20260230'], ['calendars.WKDY.end', '20200101'],
    ['calendars.WKDY.added', ['20260230']], ['calendars.WKDY.removed', null],
  ])('rejects malformed %s', (path, value) => {
    expect(() => parseDataset(corrupt(path as string, value))).toThrow();
  });

  it.each(['routes', 'stops', 'patterns', 'trips'] as const)('rejects ambiguous duplicate %s ids', (field) => {
    expect(() => parseDataset({ ...demoDataset, [field]: [...demoDataset[field], demoDataset[field][0]] })).toThrow();
  });

  it.each([
    ['meta.transcribed', {}], ['meta.transcribed.issued', '20261301'],
    ['publishedGates', null], ['publishedGates.rules', {}], ['publishedGates.rules.0.gate', {}],
    ['publishedGates.rules.0.dayTypes', ['holiday']], ['publishedGates.rules.0.fromMin', 1441], ['publishedGates.rules.0.toMin', undefined],
    ['publishedGates.effective', 'unknown'], ['publishedFares', {}], ['publishedFares.stopZones', null],
    ['publishedFares.stopZones.PABT', [2, 1]], ['publishedFares.newYorkStopIds', ['missing-stop']],
    ['publishedFares.toFromNewYork.adult', { '2': -1 }], ['publishedFares.withinNewJersey.reduced', null],
  ])('rejects malformed optional source data: %s', (path, value) => {
    expect(() => parseDataset(corrupt(path as string, value, printed))).toThrow();
  });
});
