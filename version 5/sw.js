/**
 * Happy Warmi Spa - Service Worker (Versión 2.3.0 PWA & Modo Offline Integral)
 * Precaché de assets estáticos, scripts esenciales, mariposas, vistas y caché dinámico.
 */

const CACHE_NAME = 'happy-warmi-spa-v2.4.0';
const DYNAMIC_CACHE_NAME = 'happy-warmi-dynamic-v2.4.0';

const STATIC_ASSETS = [
  './',
  './index.html',
  './admin.html',
  './style.css',
  './app.js',
  './supabase-client.js',
  './manifest.json',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './imagenes_spa/mariposa-dorada-zen.svg',
  './imagenes_spa/mariposa-lila-armonia.svg',
  './imagenes_spa/mariposa-loto-wellness.svg',
  './imagenes_spa/mariposa-monarca-spa.svg',
  './imagenes_spa/mariposa-botanica-zen.svg'
];

const EXTERNAL_PRECACHE = [
  'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(STATIC_ASSETS);
      // Cachear librerías externas sin bloquear la instalación si se instala sin red
      await Promise.allSettled(
        EXTERNAL_PRECACHE.map((url) => cache.add(url))
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== DYNAMIC_CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  if (!requestUrl.protocol.startsWith('http') || event.request.method !== 'GET') {
    return;
  }

  // Las llamadas REST a Supabase no se sirven desde caché HTTP; WarmiDB gestiona su propia cola offline
  if (requestUrl.hostname.includes('supabase.co')) {
    return;
  }

  // Navegación HTML (index.html / admin.html) - Network first con respaldo offline inmediato
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const exactMatch = await caches.match(event.request, { ignoreSearch: true });
          if (exactMatch) return exactMatch;
          if (requestUrl.pathname.endsWith('admin.html')) {
            return caches.match('./admin.html');
          }
          return caches.match('./index.html');
        })
    );
    return;
  }

  // Assets del mismo origen (CSS, JS, iconos, SVG, manifest)
  if (requestUrl.origin === location.origin) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
        const networkFetch = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        }).catch(() => cachedResponse);

        return cachedResponse || networkFetch;
      })
    );
    return;
  }

  // Assets externos (CDNs, Google Fonts, Unsplash Images) - Cache first con respaldo
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || (networkResponse.status !== 200 && networkResponse.type !== 'opaque')) {
          return networkResponse;
        }
        const responseClone = networkResponse.clone();
        caches.open(DYNAMIC_CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return networkResponse;
      }).catch(() => {
        if (event.request.destination === 'image') {
          return caches.match('./imagenes_spa/mariposa-dorada-zen.svg');
        }
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
