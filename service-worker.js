   /* Frog Jumper offline support. Update CACHE_VERSION whenever the game shell changes. */ 
const CACHE_VERSION = 'frog-jumper-shell-v14';
const CACHE_NAME = CACHE_VERSION;
const GAME_URL = new URL('./index-game.html', self.registration.scope).toString();
const SCOPE_URL = new URL(self.registration.scope);
const ROOT_NAVIGATION_PATHS = new Set([SCOPE_URL.pathname, new URL('index.html', SCOPE_URL).pathname]);

// Only the main game page is required during installation.
const SHELL_FILES = ['./index-game.html'];
const SHELL_URLS = new Set(SHELL_FILES.map(file => new URL(file, self.registration.scope).toString()));

// Cosmetics are optional: cache each one only after the game actually requests it.
const OPTIONAL_ASSET_FILES = [
  './assets/601f2f8d-d595-494c-bd9e-6aaaf5fcdcea.png',
  './assets/wacky-beak.png',
  './assets/black-hat.png',
  './assets/car-skin.png',
  './assets/tv-hat.png',
  './assets/poppy-skin.png',
  './assets/us-flag-skin.png'
];
const OPTIONAL_ASSET_URLS = new Set(OPTIONAL_ASSET_FILES.map(file => new URL(file, self.registration.scope).toString()));

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

  // Handle the normal project root and direct game-page navigations alike.
  // A root navigation redirects online; offline, serve the cached game page.
  const isGameNavigation = request.mode === 'navigate' && (
    ROOT_NAVIGATION_PATHS.has(url.pathname) || url.pathname === new URL(GAME_URL).pathname
  );
  if (isGameNavigation) {
    event.respondWith((async () => {
      let cache;
      try { cache = await caches.open(CACHE_NAME); } catch (_) {}
      let response;
      try { response = await fetch(request); } catch (_) {}
      if (response && response.ok) {
        if (cache && url.pathname === new URL(GAME_URL).pathname) {
          try { await cache.put(GAME_URL, response.clone()); } catch (_) {}
        }
        return response;
      }
      if (cache) {
        try {
          const cached = await cache.match(GAME_URL);
          if (cached) return cached;
        } catch (_) {}
      }
      if (response) return response;
      return new Response('Frog Jumper could not be loaded. Please reconnect and try again.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    })());
    return;
  }

  // Cache the game shell and approved optional cosmetics only when requested.
  // Dynamic URLs and query-string variants are never added to Cache Storage.
  const cacheKey = SHELL_URLS.has(url.href) || OPTIONAL_ASSET_URLS.has(url.href) ? url.href : null;
  if (!cacheKey) return;

  event.respondWith((async () => {
    let cache;
    try {
      cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(cacheKey);
      if (cached) {
        // Cosmetic pictures refresh in the background (stale-while-revalidate)
        // so a changed skin PNG updates without waiting for a version bump,
        // while offline play still gets the saved copy right away.
        if (OPTIONAL_ASSET_URLS.has(cacheKey)) {
          const refresh = fetch(request).then(async response => {
            if (response && response.ok) { try { await cache.put(cacheKey, response.clone()); } catch (_) {} }
          }).catch(() => {});
          if (typeof event.waitUntil === 'function') event.waitUntil(refresh);
        }
        return cached;
      }
    } catch (_) {}
    try {
      const response = await fetch(request);
      if (response && response.ok && cache) {
        try { await cache.put(cacheKey, response.clone()); } catch (_) {}
      }
      return response;
    } catch (_) {
      return new Response('', { status: 504, statusText: 'Offline resource unavailable' });
    }
  })());
});
