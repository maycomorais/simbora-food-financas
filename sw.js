/* ============================================================
   SIMBORA FOOD PARK — Service Worker v2.1
   Estratégias:
     • App shell (HTML/JS/CSS) → Network-first, fallback cache
     • Fontes / CDN             → Cache-first (imutáveis)
     • Supabase / APIs externas → Network-only (nunca cacheado)
   ============================================================ */

const APP_VERSION  = 'sfp-v2.2';         // ← sobe este número a cada deploy
const FONT_CACHE   = 'sfp-fonts-v1';     // raramente muda; versione só se trocar fonte

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
];

// Nunca cachear — sempre vai à rede
const NETWORK_ONLY_HOSTS = [
  'supabase.co',
  'economia.awesomeapi.com.br',
  'script.google.com',        // Google Apps Script (upload Drive)
  'drive.google.com',
];

// Cache eterno — só vai à rede se não estiver no cache
const CACHE_FOREVER_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
];

// ============================================================
// INSTALL — pré-carrega o app shell com bypass de cache HTTP
// ============================================================
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(APP_VERSION)
      .then(cache =>
        // cache: 'reload' ignora o cache HTTP do browser — garante arquivos frescos
        Promise.all(
          APP_SHELL.map(url =>
            fetch(url, { cache: 'reload' })
              .then(res => { if (res.ok) cache.put(url, res); })
              .catch(() => {}) // não quebra o install se um asset falhar
          )
        )
      )
      .then(() => self.skipWaiting()) // ativa imediatamente sem esperar abas fecharem
  );
});

// ============================================================
// ACTIVATE — apaga TODOS os caches antigos
// ============================================================
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(k => k !== APP_VERSION && k !== FONT_CACHE)
            .map(k => {
              console.log('[SW] Deletando cache antigo:', k);
              return caches.delete(k);
            })
        )
      )
      .then(() => self.clients.claim()) // assume controle de todas as abas abertas
  );
});

// ============================================================
// FETCH — roteamento por estratégia
// ============================================================
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 1. Network-only: Supabase, APIs externas
  if (NETWORK_ONLY_HOSTS.some(h => url.hostname.includes(h))) {
    e.respondWith(fetch(e.request));
    return;
  }

  // 2. Cache-first: fontes e CDN (assets imutáveis)
  if (CACHE_FOREVER_HOSTS.some(h => url.hostname.includes(h))) {
    e.respondWith(
      caches.open(FONT_CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(res => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }

  // 3. Network-first: app shell (HTML, JS, CSS, manifest)
  //    Sempre tenta a rede — usa cache só se offline
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then(res => {
        // Atualiza o cache com a resposta mais recente
        if (res.ok && e.request.method === 'GET') {
          caches.open(APP_VERSION).then(cache => cache.put(e.request, res.clone()));
        }
        return res;
      })
      .catch(() =>
        // Offline: serve do cache como fallback
        caches.match(e.request).then(cached => cached || caches.match('./index.html'))
      )
  );
});

// ============================================================
// BACKGROUND SYNC — sincroniza fila offline
// ============================================================
self.addEventListener('sync', e => {
  if (e.tag === 'sync-sfp-queue') {
    e.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'SYNC_OFFLINE_QUEUE' }))
      )
    );
  }
});

// ============================================================
// MESSAGE — força atualização sob demanda (ex: botão "Atualizar")
// ============================================================
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});