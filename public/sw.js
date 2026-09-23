// Service worker: cache-first para assets estáticos, network-first para navegación.
const CACHE = 'liga-static-v2';
const ASSETS = [
  '/css/app.css',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/img/icon-192.png',
  '/img/icon-512.png',
  '/img/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' evita que el caché HTTP del navegador entregue una copia vieja
  // de los assets justo después de un deploy.
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        Promise.all(
          ASSETS.map((url) =>
            fetch(new Request(url, { cache: 'reload' })).then((resp) => {
              if (resp.ok) return c.put(url, resp);
              return undefined;
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Navegación: red primero (contenido siempre fresco), fallback al cache offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request).then((r) => r || caches.match('/')))
    );
    return;
  }

  // Estáticos: sirve del cache al instante y refresca en segundo plano
  // (stale-while-revalidate), así un deploy nuevo llega solo.
  if (ASSETS.some((a) => a.split('?')[0] === url.pathname)) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        const fresh = fetch(e.request)
          .then((resp) => {
            if (resp && resp.ok) {
              const copy = resp.clone();
              caches.open(CACHE).then((c) => c.put(e.request, copy));
            }
            return resp;
          })
          .catch(() => cached);
        return cached || fresh;
      })
    );
  }
});
