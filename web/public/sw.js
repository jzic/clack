// Clack service worker — intentionally NETWORK-ONLY. It exists solely so Chrome
// offers "Install as app" (installability wants a fetch handler). It deliberately
// caches NOTHING: Clack updates by rebuilding web/dist, and a caching SW would
// serve stale bundles (the exact trap `npm run update` fixes). Every request goes
// straight to the network; the SW is just a pass-through.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
