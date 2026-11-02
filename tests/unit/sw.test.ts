// Runs public/sw.js against a stand-in network and cache. The network timeout is shortened for the test.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const ORIGIN = 'https://jwchr.github.io';
const source = readFileSync(join(__dirname, '../../public/sw.js'), 'utf8').replace('const NETWORK_TIMEOUT_MS = 4000;', 'const NETWORK_TIMEOUT_MS = 30;');

interface FakeRequest { url: string; method: string; mode: string }
type Net = (req: FakeRequest, init?: RequestInit) => Promise<Response>;

let saved: Map<string, Response>;
let calls: { url: string; init?: RequestInit | undefined }[];
let net: Net;
let onFetch: (e: { request: FakeRequest; respondWith: (p: Promise<Response>) => void }) => void;

beforeEach(() => {
  saved = new Map();
  calls = [];
  net = () => Promise.reject(new TypeError('offline'));
  const caches = {
    open: async () => ({ put: async (req: FakeRequest, res: Response) => { saved.set(req.url, res); } }),
    match: async (req: FakeRequest, opts?: { ignoreSearch?: boolean }) => {
      const base = (u: string) => u.split('?')[0];
      const key = opts?.ignoreSearch ? [...saved.keys()].find((k) => base(k) === base(req.url)) : req.url;
      return key ? saved.get(key)?.clone() : undefined;
    },
  };
  const self = {
    location: { origin: ORIGIN },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
    addEventListener: (type: string, fn: typeof onFetch) => { if (type === 'fetch') onFetch = fn; },
  };
  const fetch = (req: FakeRequest, init?: RequestInit) => { calls.push({ url: req.url, init }); return net(req, init); };
  new Function('self', 'caches', 'fetch', source)(self, caches, fetch);
});

const get = (path: string, mode = 'cors'): FakeRequest => ({ url: `${ORIGIN}${path}`, method: 'GET', mode });
function handle(req: FakeRequest): Promise<Response> | undefined {
  let result: Promise<Response> | undefined;
  onFetch({ request: req, respondWith: (p) => { result = p; } });
  return result;
}
const settle = () => new Promise((r) => setTimeout(r, 20));
const DATA = '/arriba/data/corridor.json';

describe('service worker', () => {
  it('runs with a shortened network timeout (the constant the test patches still exists)', () => {
    expect(source).toContain('NETWORK_TIMEOUT_MS = 30;');
  });

  it('answers from the network, revalidating the schedule, and saves a copy with the time it was saved', async () => {
    net = async () => new Response('{"v":2}', { status: 200 });
    const res = await handle(get(DATA))!;
    expect(await res.text()).toBe('{"v":2}');
    expect(res.headers.get('x-arriba-from-cache')).toBeNull();
    expect(calls[0]?.init).toEqual({ cache: 'no-cache' });
    await settle();
    const copy = saved.get(`${ORIGIN}${DATA}`);
    expect(Number(copy?.headers.get('x-arriba-saved-at'))).toBeGreaterThan(Date.parse('2026-01-01'));
  });

  it('uses the saved copy, marked as saved, when the network hangs', async () => {
    saved.set(`${ORIGIN}${DATA}`, new Response('{"v":1}', { headers: { 'x-arriba-saved-at': '1793600000000' } }));
    net = () => new Promise(() => {}); // the tunnel: no answer, no error
    const res = await handle(get(DATA))!;
    expect(await res.text()).toBe('{"v":1}');
    expect(res.headers.get('x-arriba-from-cache')).toBe('1');
    expect(res.headers.get('x-arriba-saved-at')).toBe('1793600000000');
  });

  it('uses the saved copy when the network fails, and fails when nothing is saved', async () => {
    await expect(handle(get(DATA))!).rejects.toThrow();
    saved.set(`${ORIGIN}${DATA}`, new Response('{"v":1}'));
    const res = await handle(get(DATA))!;
    expect(res.headers.get('x-arriba-from-cache')).toBe('1');
  });

  it('passes a network error page through rather than hiding it behind the saved copy', async () => {
    saved.set(`${ORIGIN}${DATA}`, new Response('{"v":1}'));
    net = async () => new Response('missing', { status: 404 });
    expect((await handle(get(DATA))!).status).toBe(404);
  });

  it('loads the saved page offline whatever the query string', async () => {
    saved.set(`${ORIGIN}/arriba/?now=2026-11-04T07:50`, new Response('<html>'));
    const res = await handle(get('/arriba/?demo', 'navigate'))!;
    expect(await res.text()).toBe('<html>');
    // A data request with a different query is not the same file, so it does not fall back.
    saved.set(`${ORIGIN}${DATA}?x=1`, new Response('{}'));
    await expect(handle(get(DATA))!).rejects.toThrow();
  });

  it('uses saved hashed assets without the network, and fetches them once when missing', async () => {
    saved.set(`${ORIGIN}/arriba/assets/index-abc.js`, new Response('js'));
    expect(await (await handle(get('/arriba/assets/index-abc.js'))!).text()).toBe('js');
    expect(calls).toHaveLength(0);
    net = async () => new Response('css');
    expect(await (await handle(get('/arriba/assets/index-abc.css'))!).text()).toBe('css');
    expect(calls).toEqual([{ url: `${ORIGIN}/arriba/assets/index-abc.css`, init: undefined }]);
  });

  it('leaves other sites and non-GET requests alone', () => {
    expect(handle({ url: 'https://www.njtransit.com/x', method: 'GET', mode: 'cors' })).toBeUndefined();
    expect(handle({ url: `${ORIGIN}${DATA}`, method: 'POST', mode: 'cors' })).toBeUndefined();
  });
});
