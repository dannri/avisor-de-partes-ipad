/*
 * AVISOR DE PARTES - Service Worker (PWA del jefe: /avisor-de-partes-ipad/)
 * Caches all app assets so the iPad PWA works offline after the first load.
 *
 * v20 (oct-2026, igual que el v11+ de ios): la PÁGINA (index.html) va RED
 * PRIMERO — con conexión el iPad carga SIEMPRE el último index.html publicado
 * (antes era caché primero y el iPad podía seguir con una versión vieja). Sin
 * conexión (o si la red tarda más de 4 s) se usa la copia guardada. Los assets
 * (app.js, css, imágenes, firebase) siguen caché primero: no cambian entre
 * versiones de la PWA.
 *
 * To force users to pick up new ASSETS: bump CACHE_VERSION.
 */
const CACHE_VERSION = 'v20';
const CACHE_NAME = 'avisor-de-partes-ipad-' + CACHE_VERSION;
const RED_TIMEOUT_MS = 4000;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-180.png',
  './icon-512.png',
  './assets/app.js',
  './assets/app.css',
  './assets/fondo.jpg',
  './assets/firebase-app-compat.js',
  './assets/firebase-firestore-compat.js'
];

// Install: pre-cache the app shell. {cache:'reload'} → del servidor, no de la
// caché HTTP del navegador (GitHub Pages sirve max-age=600).
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE_URLS.map(function (u) { return new Request(u, { cache: 'reload' }); }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// Activate: borrar SOLO las cachés viejas de ESTA PWA: las de su prefijo nuevo
// ('avisor-de-partes-ipad-') y las de antes de v20 ('avisor-de-partes-v19'…).
// dannri.github.io es un único origen compartido con la PWA de pruebas (ios):
// sus cachés ('avisor-de-partes-ios-…') NO se tocan.
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) {
          if (k === CACHE_NAME) return false;
          return k.indexOf('avisor-de-partes-ipad-') === 0 || /^avisor-de-partes-v\d+$/.test(k);
        }).map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

// La página = la raíz de la PWA o su index.html (nada más).
var RAIZ = new URL('./', self.location).pathname;
function esPagina(url) {
  return url.pathname === RAIZ || url.pathname === RAIZ + 'index.html';
}

// Red primero para la página, con límite de tiempo y copia de reserva.
function paginaRedPrimero(event) {
  var request = event.request;
  var red = fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' });
  // Guardar la copia nueva (solo si es HTML de verdad), sin retrasar la respuesta
  event.waitUntil(red.then(function (response) {
    var tipo = (response && response.headers.get('content-type')) || '';
    if (response && response.status === 200 && response.type === 'basic' && tipo.indexOf('text/html') !== -1) {
      var copia = response.clone();
      return caches.open(CACHE_NAME).then(function (cache) { return cache.put('./index.html', copia); });
    }
  }).catch(function () {}));
  var reserva = function () {
    return caches.match('./index.html').then(function (c) { return c || caches.match('./'); });
  };
  var limite = new Promise(function (resolve) {
    setTimeout(function () { resolve(null); }, RED_TIMEOUT_MS);
  });
  return Promise.race([red.catch(function () { return null; }), limite]).then(function (r) {
    if (r && r.ok) return r;
    // red caída, lenta o con error → copia guardada (o, si no hay, lo que diga la red)
    return reserva().then(function (c) { return c || red; });
  });
}

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  if (esPagina(url)) {
    event.respondWith(paginaRedPrimero(event));
    return;
  }

  // Assets: cache-first, network fallback
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        // Cache successful responses for later offline use
        if (response && response.status === 200 && response.type === 'basic') {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    })
  );
});
