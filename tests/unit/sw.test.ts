// Runs public/sw.js against a stand-in network and cache. The network timeout is shortened for the test.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const ORIGIN = 'https://jwchr.github.io';
const source = readFileSync(join(__dirname, '../../public/sw.js'), 'utf8').replace('const NETWORK_TIMEOUT_MS = 4000;', 'const NETWORK_TIMEOUT_MS = 30;');

interface FakeRequest { url: string; method: string; mode: string }
type Key = FakeRequest | string;
type Net = (url: string, init?: RequestInit) => Promise<Response>;
interface FakeEvent { request?: FakeRequest; respondWith: (p: Promise<Response>) => void; waitUntil: (p: Promise<unknown>) => void }

let saved: Map<string, Response>;
let calls: { url: string; init?: RequestInit | undefined }[];
let net: Net;
let handlers: Record<string, (e: FakeEvent) => void>;

const urlOf = (k: Key) => (typeof k === 'string' ? k : k.url);
beforeEach(() => {
  saved = new Map();
  calls = [];
  handlers = {};
  net = () => Promise.reject(new TypeError('offline'));
  const caches = {
    open: async () => ({ put: async (k: Key, res: Response) => { saved.set(urlOf(k), res); } }),
    match: async (k: Key, opts?: { ignoreSearch?: boolean }) => {
      const base = (u: string) => u.split('?')[0];
      const key = opts?.ignoreSearch ? [...saved.keys()].find((s) => base(s) === base(urlOf(k))) : urlOf(k);
      return key ? saved.get(key)?.clone() : undefined;
    },
  };
  const self = {
    location: { origin: ORIGIN, href: `${ORIGIN}/arriba/sw.js` },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
    addEventListener: (type: string, fn: (e: FakeEvent) => void) => { handlers[type] = fn; },
  };
  const fetch = (k: Key, init?: RequestInit) => { calls.push({ url: urlOf(k), init }); return net(urlOf(k), init); };
  new Function('self', 'caches', 'fetch', source)(self, caches, fetch);
});

const get = (path: string, mode = 'cors'): FakeRequest => ({ url: `${ORIGIN}${path}`, method: 'GET', mode });
/** Dispatches a fetch event; returns the answer and the promise the worker keeps itself alive for. */
function handle(req: FakeRequest): { res?: Promise<Response>; kept: Promise<unknown>[] } {
  const out: { res?: Promise<Response>; kept: Promise<unknown>[] } = { kept: [] };
  handlers.fetch!({ request: req, respondWith: (p) => { out.res = p; }, waitUntil: (p) => { out.kept.push(p); } });
  return out;
}
const answer = (req: FakeRequest) => handle(req).res!;
const DATA = '/arriba/data/corridor.json';

describe('service worker', () => {
  it('runs with a shortened network timeout (the constant the test patches still exists)', () => {
    expect(source).toContain('NETWORK_TIMEOUT_MS = 30;');
  });

  it('answers from the network, revalidating the schedule, and saves a copy with the time it was saved', async () => {
    net = async () => new Response('{"v":2}', { status: 200 });
    const { res, kept } = handle(get(DATA));
    expect(await (await res!).text()).toBe('{"v":2}');
    expect((await res!).headers.get('x-arriba-from-cache')).toBeNull();
    expect(calls[0]?.init).toEqual({ cache: 'no-cache' });
    await Promise.all(kept); // the worker stays alive until the copy is saved
    expect(Number(saved.get(`${ORIGIN}${DATA}`)?.headers.get('x-arriba-saved-at'))).toBeGreaterThan(Date.parse('2026-01-01'));
  });

  it('uses the saved copy, marked as saved, when the network hangs', async () => {
    saved.set(`${ORIGIN}${DATA}`, new Response('{"v":1}', { headers: { 'x-arriba-saved-at': '1793600000000' } }));
    net = () => new Promise(() => {}); // the tunnel: no answer, no error
    const res = await answer(get(DATA));
    expect(await res.text()).toBe('{"v":1}');
    expect(res.headers.get('x-arriba-from-cache')).toBe('1');
    expect(res.headers.get('x-arriba-saved-at')).toBe('1793600000000');
  });

  it('keeps waiting for a slow network when nothing is saved (first visit in the tunnel)', async () => {
    net = () => new Promise((r) => setTimeout(() => r(new Response('{"v":3}')), 80));
    const { res, kept } = handle(get(DATA));
    expect(await (await res!).text()).toBe('{"v":3}');
    await Promise.all(kept); // let the save finish here, not in the next test's cache
  });

  it('uses the saved copy when the network fails, and fails when nothing is saved', async () => {
    await expect(answer(get(DATA))).rejects.toThrow();
    saved.set(`${ORIGIN}${DATA}`, new Response('{"v":1}'));
    expect((await answer(get(DATA))).headers.get('x-arriba-from-cache')).toBe('1');
  });

  it('falls back on a server error but passes a 404 through', async () => {
    saved.set(`${ORIGIN}${DATA}`, new Response('{"v":1}'));
    net = async () => new Response('busy', { status: 503 });
    expect((await answer(get(DATA))).headers.get('x-arriba-from-cache')).toBe('1');
    net = async () => new Response('missing', { status: 404 });
    expect((await answer(get(DATA))).status).toBe(404);
  });

  it('saves pages under one address without the query, so every ?now= or ?demo load gets the newest page', async () => {
    net = async () => new Response('<html v2>');
    const { kept } = handle(get('/arriba/?now=2026-11-04T07:50', 'navigate'));
    await Promise.all(kept);
    expect([...saved.keys()]).toEqual([`${ORIGIN}/arriba/`]);
    net = () => Promise.reject(new TypeError('offline'));
    expect(await (await answer(get('/arriba/?demo', 'navigate'))).text()).toBe('<html v2>');
    // A data request with a different query is not the same file, so it does not fall back.
    saved.set(`${ORIGIN}${DATA}?x=1`, new Response('{}'));
    await expect(answer(get(DATA))).rejects.toThrow();
  });

  it('uses saved hashed assets without the network, and fetches them once when missing', async () => {
    saved.set(`${ORIGIN}/arriba/assets/index-abc.js`, new Response('js'));
    expect(await (await answer(get('/arriba/assets/index-abc.js'))).text()).toBe('js');
    expect(calls).toHaveLength(0);
    net = async () => new Response('css');
    const { res, kept } = handle(get('/arriba/assets/index-abc.css'));
    expect(await (await res!).text()).toBe('css');
    await Promise.all(kept);
    expect(calls).toEqual([{ url: `${ORIGIN}/arriba/assets/index-abc.css`, init: undefined }]);
    expect(saved.has(`${ORIGIN}/arriba/assets/index-abc.css`)).toBe(true);
  });

  it('saves the page, its assets and the schedule on install, so the app opens offline after the first visit', async () => {
    const files: Record<string, string> = {
      [`${ORIGIN}/arriba/`]: '<script type="module" src="/arriba/assets/index-abc.js"></script><link rel="stylesheet" href="/arriba/assets/index-def.css">',
      [`${ORIGIN}/arriba/assets/index-abc.js`]: 'js',
      [`${ORIGIN}/arriba/assets/index-def.css`]: 'css',
      [`${ORIGIN}${DATA}`]: '{}',
    };
    net = async (url) => (url in files ? new Response(files[url]) : new Response('no', { status: 404 }));
    const kept: Promise<unknown>[] = [];
    handlers.install!({ respondWith: () => {}, waitUntil: (p) => { kept.push(p); } });
    await Promise.all(kept);
    expect([...saved.keys()].sort()).toEqual(Object.keys(files).sort());
  });

  it('leaves other sites and non-GET requests alone', () => {
    expect(handle({ url: 'https://www.njtransit.com/x', method: 'GET', mode: 'cors' }).res).toBeUndefined();
    expect(handle({ url: `${ORIGIN}${DATA}`, method: 'POST', mode: 'cors' }).res).toBeUndefined();
  });
});
