import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without type declarations
import { buildDataset, interpolate, parseCsv } from '../../scripts/gtfs-lib.mjs';
import { departuresOn } from '../../src/domain/schedule';
import { formatTime12 } from '../../src/domain/time';
import type { Dataset } from '../../src/domain/types';

const dir = join(__dirname, '../fixtures/gtfs-mini');
const files: Record<string, string> = Object.fromEntries(
  readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')]),
);

describe('GTFS build', () => {
  it('parses quoted CSV with BOM, embedded commas and doubled quotes', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n');
    expect(rows).toEqual([{ a: 'x, y', b: 'say "hi"' }]);
  });

  it('interpolates blank intermediate times', () => {
    expect(interpolate([0, undefined, undefined, 300])).toEqual([0, 100, 200, 300]);
    expect(() => interpolate([undefined, 10])).toThrow();
  });

  const ds: Dataset = buildDataset(files, { routeShortNames: ['165', '165t'], feedVersion: 'fx', builtAt: 'x' });

  it('keeps only corridor routes and the stops they use', () => {
    expect(ds.routes.map((r) => r.shortName).sort()).toEqual(['165', '165T']);
    expect(ds.stops.map((s) => s.id).sort()).toEqual(['1', '2', '3']);
    expect(ds.stops.find((s) => s.id === '3')?.terminal).toBe('PABT');
    expect(ds.stops.find((s) => s.id === '2')?.name).toBe('MAIN ST, AT ELM');
    expect(ds.meta).toMatchObject({ demo: false, timezone: 'America/New_York' });
  });

  it('keeps the express as its own pattern', () => {
    expect(ds.patterns).toHaveLength(2);
    const express = ds.patterns.find((p) => p.routeId === '11');
    expect(express?.stopIds).toEqual(['1', '3']);
  });

  it('merges calendar and calendar_dates, including calendar_dates-only services', () => {
    expect(ds.calendars.WK?.removed).toEqual(['20261126']);
    expect(ds.calendars.HOL).toMatchObject({ added: ['20261126'], days: [false, false, false, false, false, false, false] });
  });

  it('produces a schedule the app can query: interpolated stop, after-midnight trip, holiday service', () => {
    const tz = ds.meta.timezone;
    const at = (date: string, stop: string) => departuresOn(ds, { stopId: stop, date }).map((d) => formatTime12(d.departs, tz));
    // 12:20 AM is Tuesday's 24:20 trip; 7:20 AM is the interpolated midpoint of 7:00 and 7:40.
    expect(at('20261104', '2')).toEqual(['12:20 AM', '7:20 AM']);
    expect(at('20261105', '1')).toEqual(['12:10 AM', '7:00 AM', '7:05 AM']); // 24:10 from Wednesday's service
    expect(at('20261126', '1')).toEqual(['12:10 AM', '8:00 AM']); // holiday: only HOL plus Wednesday's late trip
  });
});
