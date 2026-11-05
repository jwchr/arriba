// Dale service worker, built for the Lincoln Tunnel and terminal basements.
// - The page and the schedule JSON are fetched fresh (cache: 'no-cache'), so the browser's copy of an old page
//   (GitHub Pages sends max-age=600) is not run against newer data after a deploy.
// - If the network has not answered within NETWORK_TIMEOUT_MS, fails, or answers with a server error, the saved
//   copy is used and marked `x-arriba-from-cache: 1`. `x-arriba-saved-at` (ms since epoch) says when it was saved;
//   copies saved by older versions carry only the server's `Date` header. The network request is kept alive with
//   waitUntil so it can still refresh the saved copy, unless the page cancels it.
// - Vite's hashed /assets/ files never change, so their saved copy is used first.
// - Pages are saved under one address without the query string, so `?now=` and `?demo` share the newest page.
// - Install saves the page, its assets and the schedule, so the app works offline after the first visit.
// - The map file (/map/*.pmtiles) is read in byte ranges: each range is saved on its own, so map areas the
//   rider has already looked at work offline. Map fonts and icons never change, so their saved copy is used.
// tests/unit/sw.test.ts runs this file against stand-in fetch and caches.
// Cache and header names keep the app's first name (Arriba) so saved copies survive the rename to Dale.
const CACHE = 'arriba-v1';
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(precache().catch(() => { /* the first online load saves them instead */ }));
});
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const { response, done } = url.pathname.endsWith('.pmtiles') ? rangeSaved(req, url)
    : url.pathname.includes('/assets/') || url.pathname.includes('/map/') ? savedFirst(req) : networkFirst(req, url);
  e.respondWith(response);
  e.waitUntil(done);
});

/** Cache key: pages without their query string, everything else as requested. */
function keyFor(req, url) {
  return req.mode === 'navigate' ? url.origin + url.pathname : req.url;
}

async function save(key, res) {
  const headers = new Headers(res.headers);
  headers.set('x-arriba-saved-at', String(Date.now()));
  const copy = new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
  await (await caches.open(CACHE)).put(key, copy);
}

/** The network answer, and a promise that settles once a good answer is saved. */
function fetchAndSave(req, key, init) {
  const response = fetch(req, init);
  const done = response.then((res) => (res.ok ? save(key, res.clone()) : undefined)).catch(() => {});
  return { response, done };
}

async function precache() {
  const page = new URL('./', self.location.href).href;
  const res = await fetch(page, { cache: 'no-cache' });
  if (!res.ok) return;
  const html = await res.clone().text();
  await save(page, res);
  const assets = [...new Set(html.match(/[^"'\s()]*assets\/[^"'\s()]+/g) || [])].map((p) => new URL(p, page).href);
  await Promise.all([new URL('data/corridor.json', page).href, ...assets].map(async (u) => {
    const r = await fetch(u, { cache: 'no-cache' });
    if (r.ok) await save(u, r);
  }));
}

function savedFirst(req) {
  const result = caches.match(req).then((hit) => {
    if (hit) return { res: hit, done: undefined };
    const net = fetchAndSave(req, req.url);
    return net.response.then((res) => ({ res, done: net.done }));
  });
  return { response: result.then((r) => r.res), done: result.then((r) => r.done, () => {}) };
}

/** One saved copy per byte range of the map file (the file name carries its build date, so it never changes). */
function rangeSaved(req, url) {
  const range = (req.headers && req.headers.get && req.headers.get('range')) || '';
  // A query parameter, not a #fragment: the Cache API ignores fragments when matching.
  const key = `${url.origin}${url.pathname}?dale-range=${encodeURIComponent(range)}`;
  const result = caches.match(key).then(async (hit) => {
    if (hit) return { res: await asPartial(hit), done: undefined };
    const res = await fetch(req);
    // The Cache API cannot hold a 206; keep the bytes as a 200 with the range it covered. A whole-file
    // answer (no range, or a server that ignored it) is not kept: the map file is 19 MB.
    const small = res.status === 200 && Number(res.headers.get('content-length') || Infinity) <= MAX_WHOLE_BYTES;
    const done = (res.status === 206 || small) ? (async () => {
      const headers = new Headers({ 'content-type': res.headers.get('content-type') || 'application/octet-stream' });
      const cr = res.headers.get('content-range');
      if (cr) headers.set('x-dale-content-range', cr);
      const cache = await caches.open(CACHE);
      await cache.put(key, new Response(await res.clone().blob(), { status: 200, headers }));
      await dropOtherMapFiles(cache, url.pathname);
    })().catch(() => {}) : undefined;
    return { res, done };
  });
  return { response: result.then((r) => r.res), done: result.then((r) => r.done, () => {}) };
}

const MAX_WHOLE_BYTES = 1_000_000;
let mapFileInUse = '';
/** Once a map file is in use, pieces saved from an older one (an earlier dated build) are dropped. */
async function dropOtherMapFiles(cache, pathname) {
  if (mapFileInUse === pathname || !cache.keys) return;
  mapFileInUse = pathname;
  for (const k of await cache.keys()) {
    const u = new URL(typeof k === 'string' ? k : k.url);
    if (u.pathname.endsWith('.pmtiles') && u.pathname !== pathname) await cache.delete(k);
  }
}

async function asPartial(hit) {
  const cr = hit.headers.get('x-dale-content-range');
  const body = await hit.blob();
  if (!cr) return new Response(body, { status: 200, headers: { 'content-type': hit.headers.get('content-type') || 'application/octet-stream' } });
  return new Response(body, { status: 206, headers: { 'content-type': hit.headers.get('content-type') || 'application/octet-stream', 'content-range': cr, 'content-length': String(body.size) } });
}

async function markSaved(hit) {
  const headers = new Headers(hit.headers);
  headers.set('x-arriba-from-cache', '1');
  return new Response(await hit.blob(), { status: hit.status, statusText: hit.statusText, headers });
}

function networkFirst(req, url) {
  const fresh = req.mode === 'navigate' || /\.(json|html)$/.test(url.pathname);
  const key = keyFor(req, url);
  const net = fetchAndSave(req, key, fresh ? { cache: 'no-cache' } : undefined);
  net.response.catch(() => {}); // a failure after the saved copy was used is not an error
  const saved = async () => (await caches.match(key)) || (req.mode === 'navigate' ? caches.match(req, { ignoreSearch: true }) : undefined);
  const response = (async () => {
    let timer;
    const timedOut = new Promise((resolve) => { timer = setTimeout(resolve, NETWORK_TIMEOUT_MS, 'timeout'); });
    let first;
    try {
      first = await Promise.race([net.response, timedOut]);
    } catch {
      first = 'failed';
    } finally {
      clearTimeout(timer);
    }
    // 404 passes through (the app treats a missing dataset as "no data published"); server errors fall back.
    if (first instanceof Response && first.status < 500) return first;
    const hit = await saved();
    if (hit) return markSaved(hit);
    return first instanceof Response ? first : net.response;
  })();
  return { response, done: net.done };
}
