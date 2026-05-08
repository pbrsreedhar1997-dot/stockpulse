/* StockPulse Service Worker — handles Web Push notifications */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}

  const title = data.title || '🔔 StockPulse Alert';
  const options = {
    body:             data.body   || 'A price alert has triggered.',
    icon:             '/favicon.png',
    badge:            '/favicon.png',
    tag:              data.tag    || 'sp-alert',
    requireInteraction: true,
    vibrate:          [200, 100, 200],
    data:             { url: '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      for (const w of wins) {
        if ('focus' in w) return w.focus();
      }
      return self.clients.openWindow('/');
    }),
  );
});
