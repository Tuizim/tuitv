/* TuiTV — service worker.
 * Guarda em cache APENAS os arquivos estáticos da aplicação (mesma origem).
 * Listas, guias e transmissões nunca passam por aqui: requisições a outras origens são ignoradas.
 */
const VERSION = '__VERSION__';
const BASE = '__BASE__';
const CACHE = `tuitv-app-${VERSION}`;
const ASSETS = "__ASSETS__";

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tuitv-app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') cache.put(request, response.clone());
        return response;
      } catch (error) {
        if (request.mode === 'navigate') {
          const shell = (await cache.match(`${BASE}/`)) ?? (await cache.match(`${BASE}/index.html`));
          if (shell) return shell;
        }
        throw error;
      }
    }),
  );
});
