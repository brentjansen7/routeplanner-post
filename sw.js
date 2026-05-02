const CACHE = 'route-optimizer-v9';
const ASSETS = [
  '/routeplanner-post/',
  '/routeplanner-post/index.html',
  '/routeplanner-post/scan.html',
  '/routeplanner-post/style.css',
  '/routeplanner-post/scan.css',
  '/routeplanner-post/app.js',
  '/routeplanner-post/scan.js',
  '/routeplanner-post/cluster.js',
  '/routeplanner-post/split.js',
  '/routeplanner-post/import.js',
  '/routeplanner-post/tsp-worker.js',
  '/routeplanner-post/manifest.json',
  '/routeplanner-post/icon-192.svg',
  '/routeplanner-post/icon-512.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Externe requests (Tesseract CDN etc) altijd via netwerk
  if (!e.request.url.includes('/routeplanner-post/')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }
  // App-bestanden: netwerk-first zodat updates altijd doorkomen, cache als fallback
  e.respondWith(
    fetch(e.request).then(resp => {
      const clone = resp.clone();
      caches.open(CACHE).then(cache => cache.put(e.request, clone));
      return resp;
    }).catch(() => caches.match(e.request))
  );
});
