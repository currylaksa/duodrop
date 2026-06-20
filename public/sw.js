/* DuoDrop service worker (phase 5) — offline app shell + installability.
   Stale-while-revalidate for same-origin GETs only; signaling, TURN, and fonts pass through. */
const CACHE = 'duodrop-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache dynamic endpoints. /ice-servers returns short-lived TURN credentials — a
  // secret that also expires, so a stale cache hit would silently break the relay. /health is
  // a liveness probe. Only the static app shell belongs in the cache (008, ADR 0002).
  if (url.pathname === '/ice-servers' || url.pathname === '/health') return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // The HTML document carries the CSP header and links the hashed bundles, so a stale copy
      // pins old security policy and old asset URLs (008 fix shipped but couldn't reach cached
      // clients). Navigations go network-first — fresh when online, cache only as offline
      // fallback. Hashed static assets stay stale-while-revalidate; their URLs change on deploy.
      if (request.mode === 'navigate') {
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch {
          return (await cache.match(request)) ?? Response.error();
        }
      }
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
