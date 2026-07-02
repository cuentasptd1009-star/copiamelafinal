const CACHE_VERSION = 'super-tv-v8';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// On install: cache static shell immediately
self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      return cache.addAll(STATIC_ASSETS).catch(function() {});
    })
  );
});

// On activate: delete old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_VERSION; }).map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return clients.claim(); })
  );
});

// Fetch strategy:
// - API calls: always network (never cache)
// - JS/CSS/fonts/icons (hashed filenames): cache-first (instant on repeat visits)
// - HTML pages: network-first with cache fallback (always get fresh HTML)
// - Images: cache-first with network update in background (stale-while-revalidate)
self.addEventListener('fetch', function(event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch(e) { return; }

  // Never cache API calls
  if (url.pathname.startsWith('/api/')) return;

  var path = url.pathname;

  // JS / CSS / fonts — cache-first (Vite adds content hash, safe to cache forever)
  if (/\.(js|css|woff2?|ttf|otf)(\?.*)?$/.test(path)) {
    event.respondWith(
      caches.match(req).then(function(cached) {
        if (cached) return cached;
        return fetch(req).then(function(response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(CACHE_VERSION).then(function(cache) { cache.put(req, clone); });
          }
          return response;
        }).catch(function() { return caches.match(req); });
      })
    );
    return;
  }

  // Images / icons — stale-while-revalidate (show cached immediately, update in background)
  if (/\.(png|jpg|jpeg|svg|webp|gif|ico)(\?.*)?$/.test(path)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(function(cache) {
        return cache.match(req).then(function(cached) {
          var networkFetch = fetch(req).then(function(response) {
            if (response.ok) cache.put(req, response.clone());
            return response;
          }).catch(function() { return cached; });
          return cached || networkFetch;
        });
      })
    );
    return;
  }

  // HTML and everything else — network-first with cache fallback
  event.respondWith(
    fetch(req).then(function(response) {
      if (response.ok) {
        var clone = response.clone();
        caches.open(CACHE_VERSION).then(function(cache) { cache.put(req, clone); });
      }
      return response;
    }).catch(function() {
      return caches.match(req).then(function(cached) {
        return cached || caches.match('/');
      });
    })
  );
});
