// Offline support: network first (so updates show up right away), cached copy when offline.
const CACHE = 'meal-planner-v2';
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest', './icons/icon.svg',
  './js/app.js', './js/db.js', './js/util.js', './js/prefs.js', './js/units.js', './js/ingredients.js',
  './js/aisles.js', './js/parser.js', './js/importlog.js', './js/model.js', './js/ui.js',
  './js/views/recipes.js', './js/views/plan.js', './js/views/shop.js', './js/views/add.js', './js/views/more.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
