#!/usr/bin/env node
// Usage: node scripts/build-timetable.mjs [--in data/t0165/transcription.json] [--out public/data/corridor.json] [--built-at ISO]
// Turns the checked transcription of NJ Transit's printed route 165 timetable into the dataset the app loads.
// Replace this with scripts/build-gtfs.mjs output once NJ Transit's developer approval arrives (M2).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildTimetableDataset } from './timetable-lib.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const input = opt('in', 'data/t0165/transcription.json');
const out = opt('out', 'public/data/corridor.json');
const builtAt = opt('built-at', new Date().toISOString());
const ds = buildTimetableDataset(JSON.parse(readFileSync(input, 'utf8')), { builtAt });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(ds));
console.log(`${out}: ${ds.routes.length} routes, ${ds.patterns.length} patterns, ${ds.trips.length} trips, ${ds.stops.length} stops`);
