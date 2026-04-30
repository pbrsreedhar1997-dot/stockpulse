/* StockPulse Service Worker — v2 */

const CACHE     = 'stockpulse-v2';
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

  /* API calls: network-only */
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(
          JSON.stringify({ ok: false, error: 'You are offline' }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  /* App shell + static: cache-first, refresh in background */
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

/* ── Push: show notification ──────────────────────────────────────────────── */
self.addEventListener('push', e => {
  let data = { title: 'StockPulse', body: 'Price alert triggered', url: '/' };
  try { if (e.data) data = { ...data, ...e.data.json() }; } catch {}

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    '/icon-192.png',
      badge:   '/icon-192.png',
      tag:     'stockpulse-alert',          // replace previous alert instead of stacking
      renotify: true,
      vibrate: [200, 100, 200],
      data:    { url: data.url },
    })
  );
});

/* ── Notification click: focus or open app ────────────────────────────────── */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); existing.navigate(target); }
      else clients.openWindow(target);
    })
  );
});
