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
  const { response, done } = url.pathname.includes('/assets/') ? savedFirst(req) : networkFirst(req, url);
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
