   /* Frog Jumper offline support. Update CACHE_VERSION whenever the game shell changes. */ 
const SCOPE_URL = new URL(self.registration.scope);
const CACHE_PREFIX = 'frog-jumper-shell-' + encodeURIComponent(SCOPE_URL.pathname) + '-';
const CACHE_NAME = CACHE_PREFIX + 'v18';
const GAME_URL = new URL('index-game.html', SCOPE_URL).href;
const GAME_PATH = new URL(GAME_URL).pathname;
const ROOT_NAVIGATION_PATHS = new Set([SCOPE_URL.pathname, new URL('index.html', SCOPE_URL).pathname]);
const NETWORK_TIMEOUT_MS = 4000;

// Failed cosmetic downloads never prevent the game from installing.
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

function fetchWithTimeout(request, options = {}) {
  let signal;
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    signal = AbortSignal.timeout(NETWORK_TIMEOUT_MS);
  } else {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
    signal = controller.signal;
  }
  return fetch(request, { ...options, signal });
}

async function isPlayable(response) {
  if (!response?.ok || !response.headers.get('Content-Type')?.includes('text/html')) return false;
  return /<canvas\b[^>]*\bid=["']game["']/i.test(await response.clone().text());
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const game = await fetchWithTimeout(GAME_URL, { cache: 'reload' });
    if (!await isPlayable(game)) throw new Error('No playable Frog Jumper page was available');
    await cache.put(GAME_URL, game);
    await Promise.allSettled([...OPTIONAL_ASSET_URLS].map(async url => {
      const image = await fetchWithTimeout(url, { cache: 'reload' });
      if (image.ok && image.headers.get('Content-Type')?.startsWith('image/')) await cache.put(url, image);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
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
    ROOT_NAVIGATION_PATHS.has(url.pathname) || url.pathname === GAME_PATH
  );
  if (isGameNavigation) {
    event.respondWith((async () => {
      let cache;
      try { cache = await caches.open(CACHE_NAME); } catch (_) {}
      let response;
      try {
        response = await fetchWithTimeout(request);
        if (response.ok) {
          if (cache && url.pathname === GAME_PATH && await isPlayable(response)) {
            try { await cache.put(GAME_URL, response.clone()); } catch (_) {}
          }
          return response;
        }
      } catch (_) { response = null; }
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

  // Dynamic URLs and query-string variants are never added to Cache Storage.
  const cacheKey = url.href === GAME_URL || OPTIONAL_ASSET_URLS.has(url.href) ? url.href : null;
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
          const refresh = fetchWithTimeout(request).then(async response => {
            if (response.ok && response.headers.get('Content-Type')?.startsWith('image/')) await cache.put(cacheKey, response.clone());
          }).catch(() => {});
          if (typeof event.waitUntil === 'function') event.waitUntil(refresh);
        }
        return cached;
      }
    } catch (_) {}
    try {
      const response = await fetchWithTimeout(request);
      if (response && response.ok && cache) {
        try {
          const cacheable = cacheKey === GAME_URL
            ? await isPlayable(response)
            : response.headers.get('Content-Type')?.startsWith('image/');
          if (cacheable) await cache.put(cacheKey, response.clone());
        } catch (_) {}
      }
      return response;
    } catch (_) {
      return new Response('', { status: 504, statusText: 'Offline resource unavailable' });
    }
  })());
});
