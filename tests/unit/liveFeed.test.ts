import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNormalizer } from '../../worker/normalize';
import { createFeedClass, createRouter } from '../../worker/service';
import { njtRequest, authenticate } from '../../worker/njt-client';
import { departuresOn } from '../../src/domain/schedule';
import { liveApiUrl, parseLiveSnapshot, LIVE_SOURCE } from '../../src/domain/liveBus';
import { createBusSession, reduceBusSession } from '../../src/domain/busLock';
import { gpsLost } from '../../src/domain/alternatives';
import { liveDataset as ds, NOW, binaryFeed, descriptor, vehicle, update } from '../helpers/liveBus';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const normalize = createNormalizer(ds);
const gps = () => binaryFeed([{ id: 'v', vehicle: vehicle() }]);
const updates = () => binaryFeed([{ id: 'u', tripUpdate: update() }]);
const dep = () => departuresOn(ds, { stopId: '2', date: '20261104' }).find((d) => d.tripId === 'T1')!;
const request = (path = '/v1/live?trip=T1&date=20261104') => new Request('https://dale-live.test.workers.dev' + path);
const creds = { NJT_API_USERNAME: 'synthetic-user', NJT_API_PASSWORD: 'synthetic-password' };
function harness() {
  let now = NOW;
  const saved = new Map<string, unknown>(), calls: string[] = [];
  const storage = { get: async <T,>(key: string) => structuredClone(saved.get(key)) as T | undefined, put: async (key: string, v: unknown) => { saved.set(key, structuredClone(v)); } };
  const ctx = { storage, blockConcurrencyWhile: async <T,>(fn: () => Promise<T>) => fn() };
  const net = (async (url: RequestInfo | URL) => {
    calls.push(String(url));
    if (String(url).endsWith('authenticateUser')) return Response.json({ Authenticated: 'True', UserToken: 'private-synthetic-token' });
    return new Response(new Uint8Array(String(url).endsWith('getVehiclePositions') ? gps() : updates()).buffer);
  }) as typeof fetch;
  const Feed = createFeedClass(ds, net, () => now);
  const env = { ...creds, FEED: { idFromName: (name: string) => name, get: () => object } };
  const object = new Feed(ctx, env);
  return { object, env, ctx, calls, Feed, saved, clock: (n: number) => { now = n; } };
}

describe('official GTFS-RT normalization', () => {
  it('decodes an exact canonical trip/date/route with its actual timestamp, and explicit stop prediction', () => {
    expect(normalize(gps(), 'vehicles', NOW)).toMatchObject({ feed: { state: 'ok', timestamp: NOW - 10_000 }, observations: [{ tripInstanceId: 'T1@20261104', vehicleId: 'bus-A', observedAt: NOW - 15_000 }] });
    expect(normalize(updates(), 'updates', NOW).updates[0]).toMatchObject({ cancelled: false, predictions: [{ stopIndex: 1, at: NOW + 300_000, observedAt: NOW - 20_000, kind: 'departure' }] });
  });
  it.each([
    { trip: { ...descriptor, startDate: '' } }, { trip: { ...descriptor, startDate: '20261344' } },
    { trip: { ...descriptor, routeId: 'other' } }, { trip: { ...descriptor, directionId: 1 } },
    { trip: { ...descriptor, startDate: '20261107' } }, { trip: { ...descriptor, tripId: 'not-in-static-feed' } },
    { trip: { ...descriptor, scheduleRelationship: 1 } }, { timestamp: 0 }, { timestamp: NOW / 1000 + 5 },
    { vehicle: {} }, { position: { latitude: 91, longitude: 0 } },
  ])('does not invent a match/measurement for unsupported descriptor or position: %j', (patch) => {
    expect(normalize(binaryFeed([{ id: 'v', vehicle: vehicle(patch) }]), 'vehicles', NOW).observations).toEqual([]);
  });
  it('distinguishes a deleted vehicle from an official trip cancellation', () => {
    expect(normalize(binaryFeed([{ id: 'v', isDeleted: true, vehicle: vehicle() }]), 'vehicles', NOW).observations).toEqual([]);
    expect(normalize(binaryFeed([{ id: 'u', tripUpdate: update({ trip: { ...descriptor, scheduleRelationship: 3 } }) }]), 'updates', NOW).updates[0]?.cancelled).toBe(true);
  });
  it('requires both stop selectors to agree and does not infer predictions from skipped/no-data stops or delays', () => {
    const stops = [
      { stopSequence: 2, stopId: '3', departure: { time: NOW / 1000 + 2 } },
      { stopSequence: 2, stopId: '2', scheduleRelationship: 1, departure: { time: NOW / 1000 + 2 } },
      { stopSequence: 3, stopId: '3', scheduleRelationship: 2, departure: { time: NOW / 1000 + 2 } },
      { stopSequence: 1, stopId: '1', departure: { delay: 300 } },
    ];
    const out = normalize(binaryFeed([{ id: 'u', tripUpdate: update({ stopTimeUpdate: stops }) }]), 'updates', NOW).updates[0]!;
    expect(out.predictions).toEqual([]); expect(out.skippedStops).toEqual([1]);
  });
  it('rejects malformed/differential/future feeds and keeps old timestamps stale', () => {
    expect(normalize(new Uint8Array([255]), 'vehicles', NOW).feed.state).toBe('invalid');
    expect(normalize(binaryFeed([], { incrementality: 1 }), 'vehicles', NOW).feed.state).toBe('invalid');
    expect(normalize(binaryFeed([], { timestamp: NOW / 1000 + 1 }), 'vehicles', NOW).feed.state).toBe('invalid');
    expect(normalize(gps(), 'vehicles', NOW + 180_000).feed).toEqual({ state: 'stale', timestamp: NOW - 10_000 });
  });
});

describe('single paced private live relay', () => {
  it('authenticates once, coalesces concurrent requests and never sends a token/password to clients', async () => {
    const h = harness();
    const responses = await Promise.all([h.object.fetch(request()), h.object.fetch(request()), h.object.fetch(request())]);
    expect(h.calls).toHaveLength(3);
    for (const response of responses) {
      const text = await response.text(); expect(text).not.toContain('private-synthetic-token'); expect(text).not.toContain(creds.NJT_API_PASSWORD);
      const snapshot = parseLiveSnapshot(JSON.parse(text), ds, 'T1', '20261104', NOW);
      expect(snapshot.observations).toHaveLength(1); expect(snapshot.predictions).toHaveLength(1);
    }
    h.clock(NOW + 10_000); await h.object.fetch(request()); expect(h.calls).toHaveLength(3);
    // Cold start respects persisted token and pace; the next allowed poll reuses the token.
    const cold = new h.Feed(h.ctx, h.env); await cold.fetch(request()); expect(h.calls).toHaveLength(3);
    h.clock(NOW + 31_000); await cold.fetch(request()); expect(h.calls).toHaveLength(5);
    expect(h.calls.filter((s) => s.endsWith('authenticateUser'))).toHaveLength(1);
  });
  it('drops old normalized stop indices after a schedule change while preserving token reuse and pacing', async () => {
    const h = harness(); await h.object.fetch(request());
    const changed = structuredClone(ds); changed.meta.feedVersion = 'next-feed';
    const Next = createFeedClass(changed, (async () => { throw new Error('Must not poll before paced deadline'); }) as typeof fetch, () => NOW + 1000);
    const next = new Next(h.ctx, h.env), packet = await (await next.fetch(request())).json();
    expect(packet.feedVersion).toBe('next-feed'); expect(packet.observations).toEqual([]); expect(packet.predictions).toEqual([]);
    expect((h.saved.get('state-v1') as { token: unknown }).token).toBeDefined();
  });
  it('does not turn receipt time into an observation timestamp', async () => {
    const h = harness(); await h.object.fetch(request()); h.clock(NOW + 180_000);
    const snapshot = await (await h.object.fetch(request())).json();
    expect(snapshot.receivedAt).toBe(NOW + 180_000); expect(snapshot.vehicles.state).toBe('stale');
    expect(snapshot.observations[0].observedAt).toBe(NOW - 15_000);
  });
  it('keeps an unavailable feed unknown, paces failed requests and backs off failed authentication', async () => {
    let calls = 0;
    const ctx = { storage: { get: async <T,>() => undefined as T | undefined, put: async () => {} }, blockConcurrencyWhile: async <T,>(f: () => Promise<T>) => f() };
    const Feed = createFeedClass(ds, (async () => { calls++; throw new Error(creds.NJT_API_PASSWORD); }) as typeof fetch, () => NOW);
    const h = harness(), instance = new Feed(ctx, h.env);
    const text = await (await instance.fetch(request())).text();
    expect(text).not.toContain(creds.NJT_API_PASSWORD); expect(JSON.parse(text).vehicles.state).toBe('unavailable');
    await instance.fetch(request()); expect(calls).toBe(1);
  });
  it('routes only approved-origin read requests and known active trips, and serves the canonical static feed', async () => {
    const h = harness(), router = createRouter(ds);
    expect((await router.fetch(new Request(request(), { method: 'POST' }), h.env)).status).toBe(405);
    expect((await router.fetch(new Request(request(), { headers: { origin: 'https://bad.example' } }), h.env)).status).toBe(403);
    for (const path of ['/v1/live?trip=other&date=20261104', '/v1/live?trip=T1&date=20261301', '/v1/live?trip=T1&date=20261107']) {
      expect((await router.fetch(request(path), h.env)).status).toBe(400);
    }
    expect(h.calls).toHaveLength(0);
    const schedule = await router.fetch(request('/v1/schedule'), h.env); expect(await schedule.json()).toMatchObject({ meta: { realtime: { provider: 'njt-bus-g2' } } });
    const options = await router.fetch(new Request(request(), { method: 'OPTIONS' }), h.env); expect(options.status).toBe(204);
    const status = await (await router.fetch(request('/v1/status'), h.env)).json(); expect(status.reportingBuses).toBe(1); expect(status.example.tripInstanceId).toBe('T1@20261104');
  });
});

describe('safe live protocol and existing lock', () => {
  it('requires a compatible version, fixed trip and sane source timestamps', async () => {
    const h = harness(), packet = await (await h.object.fetch(request())).json();
    expect(parseLiveSnapshot(packet, ds, 'T1', '20261104', NOW).source).toBe(LIVE_SOURCE);
    for (const patch of [{ feedVersion: 'changed' }, { tripInstanceId: 'T2@20261104' }, { receivedAt: NOW + 60_000 }, { observations: [{ vehicleId: 'A' }] }]) {
      expect(() => parseLiveSnapshot({ ...packet, ...patch }, ds, 'T1', '20261104', NOW)).toThrow();
    }
    expect(liveApiUrl('https://dale-live.test.workers.dev')).toBeDefined();
    for (const url of ['http://dale-live.test.workers.dev', 'https://evil.example', 'https://dale-live.test.workers.dev/?token=secret']) expect(liveApiUrl(url)).toBeUndefined();
  });
  it('falls back immediately on a checked feed gap without changing identity, cancelling or inventing observations', () => {
    let session = createBusSession(dep(), NOW - 30_000);
    session = reduceBusSession(session, { type: 'observation', source: 'official', receivedAt: NOW, obs: { tripInstanceId: dep().tripInstanceId, vehicleId: 'A', observedAt: NOW - 1000, lat: 40.89, lon: -74.04 } });
    session = reduceBusSession(session, { type: 'feed_status', tripInstanceId: dep().tripInstanceId, state: 'missing', now: NOW });
    expect(session.lock.status).toBe('stale'); expect(gpsLost(session, NOW)).toBe(true);
    expect(reduceBusSession(session, { type: 'tick', now: NOW + 1000 }).lock.status).toBe('stale');
    expect(session.lock.vehicleId).toBe('A'); expect(session.history).toHaveLength(1); expect(session.lock.tripInstanceId).toBe(dep().tripInstanceId);
    session = reduceBusSession(session, { type: 'feed_status', tripInstanceId: dep().tripInstanceId, state: 'ok', now: NOW + 1000 });
    expect(session.lock.status).toBe('tracked');
  });
});


describe('bounded private NJ Transit client', () => {
  it('does not accept string False or log echoed credentials', async () => {
    const log = vi.spyOn(console, 'log'), error = vi.spyOn(console, 'error');
    await expect(authenticate(creds, (async () => Response.json({ Authenticated: 'False', UserToken: 'do-not-use' })) as typeof fetch)).rejects.toThrow('access-denied');
    await expect(njtRequest('getVehiclePositions', { token: 'private-token' }, 100, (async () => { throw new Error('private-token'); }) as typeof fetch)).rejects.toThrow('network-error');
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it('bounds response size and refuses redirects before a token can reach another host', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe('error'); return new Response('x'.repeat(101));
    }) as unknown as typeof fetch;
    await expect(njtRequest('getTripUpdates', { token: 'private-token' }, 100, fetchImpl)).rejects.toThrow('response-too-large');
  });
  it('enforces a deadline through a stalled body read without returning raw errors', async () => {
    vi.useFakeTimers();
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array([1])); init?.signal?.addEventListener('abort', () => controller.error(new Error('private-token')));
    } }))) as typeof fetch;
    const checked = expect(njtRequest('getTripUpdates', { token: 'private-token' }, 100, fetchImpl, 30)).rejects.toThrow('timed-out');
    await vi.advanceTimersByTimeAsync(31); await checked; expect(vi.getTimerCount()).toBe(0);
  });
});
