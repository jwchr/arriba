// Arriba service worker, built for the Lincoln Tunnel and terminal basements.
// - The page and the schedule JSON are fetched fresh (cache: 'no-cache'), so the browser's copy of an old page
//   (GitHub Pages sends max-age=600) is not run against newer data after a deploy.
// - If the network has not answered within NETWORK_TIMEOUT_MS, or fails, the saved copy is used and marked
//   `x-arriba-from-cache: 1`, with `x-arriba-saved-at` (ms since epoch), so the app can say it is showing a saved
//   schedule and when it was saved. The network request keeps going and refreshes the saved copy.
// - Vite's hashed /assets/ files never change, so their saved copy is used first.
// - Page loads ignore the query string when falling back, so `?now=` and `?demo` load the saved page offline.
// tests/unit/sw.test.ts runs this file against stand-in fetch and caches.
const CACHE = 'arriba-v1';
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(url.pathname.includes('/assets/') ? savedFirst(req) : networkFirst(req, url));
});

async function save(req, res) {
  const headers = new Headers(res.headers);
  headers.set('x-arriba-saved-at', String(Date.now()));
  const copy = new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
  await (await caches.open(CACHE)).put(req, copy);
}

function fetchAndSave(req, init) {
  return fetch(req, init).then((res) => {
    if (res.ok) save(req, res.clone()).catch(() => {});
    return res;
  });
}

async function savedFirst(req) {
  return (await caches.match(req)) || fetchAndSave(req);
}

async function markSaved(hit) {
  const headers = new Headers(hit.headers);
  headers.set('x-arriba-from-cache', '1');
  return new Response(await hit.blob(), { status: hit.status, statusText: hit.statusText, headers });
}

async function networkFirst(req, url) {
  const fresh = req.mode === 'navigate' || /\.(json|html)$/.test(url.pathname);
  const network = fetchAndSave(req, fresh ? { cache: 'no-cache' } : undefined);
  network.catch(() => {}); // a failure after the saved copy was used is not an error
  let timer;
  const timedOut = new Promise((resolve) => { timer = setTimeout(resolve, NETWORK_TIMEOUT_MS, 'timeout'); });
  try {
    const first = await Promise.race([network, timedOut]);
    if (first !== 'timeout') return first;
  } catch {
    // network failed: use the saved copy below
  } finally {
    clearTimeout(timer);
  }
  const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
  return hit ? markSaved(hit) : network;
}
