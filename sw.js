const CACHE = 'efectiva-v45';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './finance.js',
  './finance_ui.js',
  './tables.js',
  './notes_modular.js',
  './idle_alarm.js',
  './script.js',
  './ai_chat.js',
  './modals.js',
  './auth.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

// Network-First para el mismo origen: asegura que actualizaciones OTA y PWA lleguen al instante
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const isSameOrigin = new URL(event.request.url).origin === self.location.origin;
  if (!isSameOrigin) return;

  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
