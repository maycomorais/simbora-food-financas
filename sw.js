/* ============================================================
   SIMBORA FOOD PARK — Service Worker v1.0
   ============================================================ */

const CACHE_NAME   = 'sfp-v1';
const STATIC_CACHE = 'sfp-static-v1';

const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
];

const NETWORK_ONLY = [
  'supabase.co',
  'economia.awesomeapi.com.br',
  'res.cloudinary.com',
  'api.cloudinary.com',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(STATIC_CACHE).then(c => c.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== STATIC_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (NETWORK_ONLY.some(h => url.hostname.includes(h))) {
    e.respondWith(fetch(e.request));
    return;
  }
  if (url.hostname.includes('fonts.') || url.hostname.includes('cdn.')) {
    e.respondWith(caches.open(CACHE_NAME).then(c => c.match(e.request).then(r => r || fetch(e.request).then(res => { c.put(e.request, res.clone()); return res; }))));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

self.addEventListener('sync', e => {
  if (e.tag === 'sync-sfp-queue') {
    e.waitUntil(self.clients.matchAll().then(clients => {
      clients.forEach(c => c.postMessage({ type: 'SYNC_OFFLINE_QUEUE' }));
    }));
  }
});
