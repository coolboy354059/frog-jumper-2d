/* Frog Jumper offline support. Update CACHE_VERSION whenever the game shell changes. */
const CACHE_VERSION = 'frog-jumper-shell-v2';
const CACHE_NAME = CACHE_VERSION;
const GAME_URL = new URL('./index-game.html', self.registration.scope).toString();
const SHELL_FILES = [
  './index-game.html',
  './assets/601f2f8d-d595-494c-bd9e-6aaaf5fcdcea.png',
  './assets/wacky-beak.png',
  './assets/black-hat.png',
  './assets/car-skin.png',
  './assets/tv-hat.png'
];
const SHELL_URLS = new Set(
  SHELL_FILES.map(file => new URL(file, self.registration.scope).toString())
);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('frog-jumper-shell-') && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Keep the game page available offline, but always use its single
  // canonical cache key so query-string variants cannot accumulate.
  if (request.mode === 'navigate' && url.pathname.endsWith('/index-game.html')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response && response.ok) await cache.put(GAME_URL, response.clone());
        return response;
      } catch (_) {
        const cached = await cache.match(GAME_URL);
        if (cached) return cached;
        return new Response('Frog Jumper has not been saved for offline play yet. Open the game once while online, then try again.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  // Only the small, explicitly listed game-shell files are cached.
  // Everything else (including dynamic URLs and query-string variants)
  // goes straight to the network and is never added to Cache Storage.
  const cacheKey = SHELL_URLS.has(url.href)
    ? url.href
    : null;
  if (!cacheKey) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response && response.ok) await cache.put(cacheKey, response.clone());
      return response;
    } catch (_) {
      return new Response('', { status: 504, statusText: 'Offline resource unavailable' });
    }
  })());
});
