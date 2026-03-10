const CACHE = 'routeapp-v1';
const ASSETS = [
  '/routeplanner-post/',
  '/routeplanner-post/index.html',
  '/routeplanner-post/scan.html',
  '/routeplanner-post/style.css',
  '/routeplanner-post/scan.css',
  '/routeplanner-post/app.js',
  '/routeplanner-post/scan.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
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
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
