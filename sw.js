// sw.js - Service Worker Básico
const CACHE_NAME = 'roteiros-app-cache-v2'; // Versão do cache atualizada
const urlsToCache = [
  '/', // Cacheia a raiz, que geralmente é o index.html
  '/index.html', // Explicitamente
  // Adicione aqui outros arquivos estáticos importantes se tiver (CSS, JS específicos)
  // Não adicione URLs do Firebase SDK aqui, elas são gerenciadas pela SDK.
  // As CDNs de fontes e Tailwind são melhor gerenciadas pelo cache do navegador,
  // mas podem ser adicionadas aqui se o offline for crítico para elas.
  // No entanto, o Service Worker tentará cacheá-las via fetch se não estiverem no cache do navegador.
];

self.addEventListener('install', event => {
  console.log('[ServiceWorker] Install Event');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[ServiceWorker] Caching app shell essentials');
        // Para CDNs ou recursos de terceiros, o fetch pode falhar se não houver CORS adequado
        // ou se a rede estiver indisponível no momento da instalação.
        // É mais seguro focar em cachear os assets locais aqui.
        // O fetch handler abaixo cuidará de cachear recursos da rede conforme são acessados.
        return cache.addAll(urlsToCache.filter(url => !url.startsWith('http'))); // Cacheia apenas URLs locais/relativas
      })
      .catch(error => {
        console.error('[ServiceWorker] Installation failed:', error);
      })
  );
});

self.addEventListener('activate', event => {
  console.log('[ServiceWorker] Activate Event');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim(); // Torna este SW o controlador ativo imediatamente
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  // Ignora requisições para o Firebase (Firestore, Auth, Installations, etc.)
  // A SDK do Firebase tem seu próprio mecanismo de persistência offline.
  if (requestUrl.protocol === 'chrome-extension:' || 
      requestUrl.hostname.includes('firestore.googleapis.com') ||
      requestUrl.hostname.includes('firebaseinstallations.googleapis.com') ||
      requestUrl.hostname.includes('identitytoolkit.googleapis.com') || // Firebase Auth
      event.request.method !== 'GET') { // Só faz cache de requisições GET
    // console.log('[ServiceWorker] Bypassing cache for non-GET or Firebase request:', event.request.url);
    return; 
  }

  // Estratégia: Cache first, then network.
  // Para recursos da aplicação (HTML, CSS, JS, Imagens locais)
  if (urlsToCache.includes(requestUrl.pathname) || requestUrl.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          if (cachedResponse) {
            // console.log('[ServiceWorker] Returning from Cache:', event.request.url);
            return cachedResponse;
          }
          // console.log('[ServiceWorker] Not in Cache, fetching from Network:', event.request.url);
          return fetch(event.request).then(networkResponse => {
            if (networkResponse && networkResponse.ok) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then(cache => {
                  // console.log('[ServiceWorker] Caching new resource:', event.request.url);
                  cache.put(event.request, responseToCache);
                });
            }
            return networkResponse;
          }).catch(error => {
            console.error('[ServiceWorker] Fetch failed; returning offline fallback or error for app resource.', error, event.request.url);
            // Aqui você poderia retornar uma página offline padrão se tivesse uma no cache:
            // return caches.match('/offline.html');
          });
        })
    );
  } else {
    // Para recursos de terceiros (CDNs, etc.), pode-se usar uma estratégia NetworkFirst ou CacheFirst com atualização em background
    // Por simplicidade, vamos tentar CacheFirst e atualizar.
    event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            const cachedResponse = await cache.match(event.request);
            const fetchedResponsePromise = fetch(event.request).then(
                (networkResponse) => {
                    if (networkResponse && networkResponse.ok) {
                        cache.put(event.request, networkResponse.clone());
                    }
                    return networkResponse;
                }
            ).catch(error => {
                console.warn('[ServiceWorker] Network fetch failed for third-party resource:', event.request.url, error);
            });
            return cachedResponse || fetchedResponsePromise;
        })
    );
  }
});