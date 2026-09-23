/* AMIS HUB — service worker
   Purpose: let the app open and be usable (read-only, last-loaded data) with no
   network at all, per "responsive layout must also support offline access."

   Strategy, deliberately simple and safe for a live, single-file app:
   - The app shell (this HTML page) is cache-first with a background refresh, so
     it opens instantly and still picks up new deploys the next time there's a
     connection.
   - Everything else (fonts, the Apps Script KPI/Collection endpoints, any other
     network call the page makes) is network-first, falling back to cache only
     if the network is unreachable. Live data should never be served stale on
     purpose — offline fallback is a safety net, not the default.
   - Nothing here touches how the page talks to KPI_ENDPOINT / COLLECTION_ENDPOINT;
     the app's own existing "pending KPI" queue already handles the case where a
     submission happens with no connection.

   Bump CACHE_NAME on every deploy so old caches are dropped automatically. */
const CACHE_NAME = 'amis-hub-shell-v1';
const APP_SHELL = [
  './',
  './AMISHUBApp.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(
        APP_SHELL.map(url => cache.add(url).catch(() => {}))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return; // never cache POSTs, never intercept writes

  const url = new URL(req.url);
  const isAppShellDoc = req.mode === 'navigate' || APP_SHELL.some(p => url.pathname.endsWith(p.replace('./', '/')));

  if (isAppShellDoc) {
    // Cache-first for the shell, with a silent background refresh.
    event.respondWith(
      caches.match(req).then(cached => {
        const network = fetch(req).then(res => {
          if (res && res.ok) caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Network-first for everything else (KPI/Collection endpoints, fonts, etc.),
  // falling back to a cached copy only when the network is genuinely unreachable.
  event.respondWith(
    fetch(req).then(res => {
      if (res && res.ok && url.origin === self.location.origin) {
        caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
