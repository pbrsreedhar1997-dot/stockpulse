/* StockPulse Service Worker — v1 */

const CACHE     = 'stockpulse-v1';
const SHELL_URL = '/';

/* ── Install: cache the app shell ─────────────────────────────────────────── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll([SHELL_URL, '/manifest.json']))
  );
  self.skipWaiting();
});

/* ── Activate: remove old caches ──────────────────────────────────────────── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* ── Fetch strategy ───────────────────────────────────────────────────────── */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  /* API calls: network-only, return JSON error when offline */
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(
          JSON.stringify({ ok: false, error: 'You are offline — cached data may be stale' }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  /* App shell + static assets: cache-first, refresh in background */
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => cached); // offline fallback to cache

      return cached || network;
    })
  );
});
