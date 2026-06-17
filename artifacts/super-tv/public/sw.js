const CACHE_VERSION = 'super-tv-v9';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      return cache.addAll(STATIC_ASSETS).catch(function() {});
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_VERSION; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return clients.claim(); })
  );
});

self.addEventListener('fetch', function(event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch(e) { return; }

  if (url.pathname.startsWith('/api/')) return;

  var path = url.pathname;

  // JS / CSS / fonts / woff — cache-first forever (Vite hashes filenames)
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

  // Images — stale-while-revalidate
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

  // HTML — network-first, cache fallback
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
