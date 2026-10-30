// Offline cache for the app shell and the engine. Bump VERSION when files change.
const VERSION = 'blundercheck-v1';
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/analysis.js',
  './js/board.js',
  './js/chesscom.js',
  './js/engine.js',
  './js/graph.js',
  './js/insights.js',
  './js/pgn.js',
  './js/store.js',
  './vendor/chess.js',
  './vendor/pieces.svg',
  './vendor/stockfish/stockfish-19-lite-single.js',
  './vendor/stockfish/stockfish-19-lite-single.wasm',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// App code: network first so updates show up right away, cache when offline.
// Libraries and the engine (vendor/) never change for a given version: cache first.
// Chess.com API calls are not intercepted.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      if (url.pathname.includes('/vendor/')) {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        const hit = await cache.match(req, { ignoreSearch: true });
        return hit || Response.error();
      }
    })
  );
});
