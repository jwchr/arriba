#!/usr/bin/env node
// Usage: node scripts/build-gtfs.mjs <bus_data.zip | folder> [--routes 163,164,165,165T] [--out public/data/corridor.json]
// The GTFS file is downloaded separately (it is never committed; see .gitignore).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { buildDataset } from './gtfs-lib.mjs';

const args = process.argv.slice(2);
const input = args[0];
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
if (!input) {
  console.error('usage: build-gtfs.mjs <zip|folder> [--routes 163,164,165,165T] [--out public/data/corridor.json]');
  process.exit(2);
}
const routes = opt('routes', '163,164,165,165T').split(',').map((s) => s.trim()).filter(Boolean);
const out = opt('out', 'public/data/corridor.json');

const files = {};
let digestSource;
if (statSync(input).isDirectory()) {
  for (const f of readdirSync(input)) if (f.endsWith('.txt')) files[f] = readFileSync(join(input, f), 'utf8');
  digestSource = Object.keys(files).sort().map((k) => files[k]).join('\n');
} else {
  const buf = readFileSync(input);
  digestSource = buf;
  for (const [name, data] of Object.entries(unzipSync(new Uint8Array(buf)))) {
    const base = name.split('/').pop();
    if (base && base.endsWith('.txt')) files[base] = strFromU8(data);
  }
}
const feedVersion = createHash('sha256').update(digestSource).digest('hex').slice(0, 12);
const ds = buildDataset(files, { routeShortNames: routes, feedVersion });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(ds));
console.log(`${out}: ${ds.routes.length} routes, ${ds.patterns.length} patterns, ${ds.trips.length} trips, ${ds.stops.length} stops, feed ${feedVersion}`);
