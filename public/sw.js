// Network-first service worker: always try fresh data, fall back to the last copy when offline
// (Lincoln Tunnel, terminal basements). Cached schedules are shown with their age by the app.
// The page and the schedule JSON are revalidated with the server on every load (cache: 'no-cache'), so
// after a deploy the browser's copy of the old page (GitHub Pages sends max-age=600) is not run against
// the newer dataset. Vite's hashed /assets/ files never change, so they keep the normal HTTP cache.
const CACHE = 'arriba-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const revalidate = req.mode === 'navigate' || url.pathname.endsWith('.json') || url.pathname.endsWith('.html');
  e.respondWith(
    fetch(req, revalidate ? { cache: 'no-cache' } : undefined)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || Promise.reject(new Error('offline')))),
  );
});
