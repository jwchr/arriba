// Manual main-only deployment. Secret values and raw CLI/API errors never leave the runner.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { liveApiUrl, parseLiveSnapshot } from '../src/domain/liveBus.ts';
let temporary;
try {
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== 'jwchr/dale') throw new Error('manual-main-required');
  const url = liveApiUrl(process.env.DALE_WORKER_URL);
  const ds = JSON.parse(readFileSync(new URL('../worker/generated/corridor.json', import.meta.url), 'utf8'));
  if (!url || !process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.NJT_API_USERNAME || !process.env.NJT_API_PASSWORD
    || ds.meta?.source !== 'NJ Transit GTFS BUS G2' || !/^[a-f0-9]{12}$/.test(ds.meta.feedVersion) || ds.meta.realtime?.provider !== 'njt-bus-g2' || ds.meta.demo) throw new Error('configuration-invalid');
  temporary = mkdtempSync(join(tmpdir(), 'dale-worker-secrets-'));
  const secrets = join(temporary, 'secrets.json');
  writeFileSync(secrets, JSON.stringify({ NJT_API_USERNAME: process.env.NJT_API_USERNAME, NJT_API_PASSWORD: process.env.NJT_API_PASSWORD }), { mode: 0o600, flag: 'wx' });
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', 'worker/wrangler.jsonc', '--secrets-file', secrets], {
    encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 240_000,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG: 'error' },
  });
  if (result.status !== 0) {
    const detail = String(result.stderr ?? '') + String(result.stdout ?? '');
    if (/10000|Authentication error/i.test(detail)) console.error('Cloudflare denied the deployment credential. App activation is held.');
    else if (/10021|startup/i.test(detail)) console.error('Cloudflare rejected Worker startup. App activation is held.');
    else if (/limit|quota/i.test(detail)) console.error('Cloudflare reported a resource limit. Do not upgrade automatically.');
    throw new Error('deployment-failed');
  }
  const health = await fetch(url + '/health', { signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!health.ok || (await health.json()).feedVersion !== ds.meta.feedVersion) throw new Error('health-check-failed');
  const status = await fetch(url + '/v1/status', { signal: AbortSignal.timeout(45_000), redirect: 'error', cache: 'no-store' });
  if (!status.ok) throw new Error('live-check-failed');
  const profile = await status.json();
  const v = profile.vehicles?.state, u = profile.updates?.state;
  const allowed = ['ok', 'stale', 'unavailable', 'invalid'];
  if (!allowed.includes(v) || !allowed.includes(u) || profile.feedVersion !== ds.meta.feedVersion || !Number.isSafeInteger(profile.reportingBuses)) throw new Error('invalid-profile');
  console.log('Worker deployed and canonical schedule verified. No credentials, tokens or raw responses logged.');
  console.log(`Vehicle feed: ${v}; trip-update feed: ${u}; matched corridor buses: ${profile.reportingBuses}.`);
  if (!profile.example || v !== 'ok') {
    const safeCount = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000 ? n : 0;
    console.log(`Known static trips: ${safeCount(profile.vehicleDiagnostics?.knownTrips)}; corridor route reports: ${safeCount(profile.vehicleDiagnostics?.corridorRoutes)}; missing service dates: ${safeCount(profile.vehicleDiagnostics?.missingServiceDates)}; missing GPS timestamps: ${safeCount(profile.vehicleDiagnostics?.missingObservationTimes)}.`);
    console.log('No fresh matched bus confirmed yet. Do not activate the app live feature.'); process.exitCode = 1;
  } else {
    // Confirm the exact same public bus through the actual tracker endpoint without printing its position.
    const [trip, date] = profile.example.tripInstanceId.split('@');
    const endpoint = new URL('/v1/live', url); endpoint.searchParams.set('trip', trip); endpoint.searchParams.set('date', date);
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
    const packet = response.ok ? parseLiveSnapshot(await response.json(), ds, trip, date, Date.now()) : undefined;
    if (packet?.vehicles.state !== 'ok' || !packet.observations.some((p) => p.vehicleId === profile.example.vehicleId && p.tripInstanceId === profile.example.tripInstanceId && p.observedAt >= profile.example.observedAt && Date.now() - p.observedAt <= 120_000)) throw new Error('exact-bus-check-failed');
    console.log('A fresh official bus report matched its canonical trip/date through the tracker endpoint. Ready for app activation and a real ride test.');
  }
} catch {
  console.error('Live Worker deployment or validation failed. App activation is held. No raw error or secret values are logged. Check the private hosting setup.');
  process.exitCode = 1;
} finally { if (temporary) rmSync(temporary, { recursive: true, force: true }); }
