// Synthetic bundle check only. Deployment always overwrites this with an authenticated official G2 download.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { buildDataset } from './gtfs-lib.mjs';
const dir = new URL('../tests/fixtures/gtfs-mini/', import.meta.url);
const files = Object.fromEntries(readdirSync(dir).map((name) => [name, readFileSync(new URL(name, dir), 'utf8')]));
const ds = buildDataset(files, { routeShortNames: ['165', '165T'], splitVariants: true, feedVersion: 'SYNTHETIC-DO-NOT-DEPLOY' });
ds.meta.realtime = { provider: 'njt-bus-g2' };
mkdirSync(new URL('../worker/generated/', import.meta.url), { recursive: true });
writeFileSync(new URL('../worker/generated/corridor.json', import.meta.url), JSON.stringify(ds));
