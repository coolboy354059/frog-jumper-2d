'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const workerSource = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
const scope = 'https://example.test/frog-jumper-2d/';

function loadWorker(fetchImpl, failures = {}) {
  const handlers = {};
  const entries = new Map();
  const deleted = [];
  const cache = {
    async match(key) {
      const value = entries.get(typeof key === 'string' ? key : key.url);
      return value ? value.clone() : null;
    },
    async put(key, response) {
      if (failures.put) throw new Error('cache put failed');
      entries.set(typeof key === 'string' ? key : key.url, response.clone());
    }
  };
  const caches = {
    async open() { if (failures.open) throw new Error('cache open failed'); return cache; },
    async keys() { return failures.cacheNames || []; },
    async delete(name) { deleted.push(name); return true; }
  };
  const self = {
    registration: { scope },
    location: { origin: new URL(scope).origin },
    clients: { async claim() {} },
    addEventListener(type, handler) { handlers[type] = handler; },
    async skipWaiting() {}
  };

  vm.runInNewContext(workerSource, {
    self,
    caches,
    fetch: fetchImpl,
    URL,
    Response,
    AbortSignal: failures.abortSignal || AbortSignal,
    AbortController,
    setTimeout: failures.setTimeout || setTimeout,
    Set,
    Promise
  });

  return { handlers, entries, deleted };
}

async function installWorker(worker) {
  let pending;
  worker.handlers.install({ waitUntil(value) { pending = value; } });
  await pending;
}

async function dispatchFetch(worker, request) {
  let pending;
  const waits = [];
  worker.handlers.fetch({
    request,
    respondWith(value) { pending = Promise.resolve(value); },
    waitUntil(value) { waits.push(Promise.resolve(value)); }
  });
  const result = pending ? await pending : null;
  await Promise.all(waits);
  return result;
}

const gameHtml = '<canvas id="game"></canvas>';
const page = body => new Response(body, { headers: { 'Content-Type': 'text/html' } });
const png = body => new Response(body, { headers: { 'Content-Type': 'image/png' } });

test('installation precaches every shipped cosmetic for offline use', async () => {
  const worker = loadWorker(async url => url.endsWith('.png') ? png('cosmetic') : page(gameHtml));
  await installWorker(worker);
  const artwork = fs.readdirSync(path.join(__dirname, '..', 'assets')).filter(file => file.endsWith('.png'));
  assert.deepEqual([...worker.entries.keys()].sort(), [
    scope + 'index-game.html', ...artwork.map(file => scope + 'assets/' + file)
  ].sort());
});

test('a missing cosmetic does not block installation or replace the cached game', async () => {
  let offline = false;
  const worker = loadWorker(async url => {
    if (offline) throw new Error('offline');
    if (url.endsWith('index-game.html')) return page(gameHtml);
    if (url.endsWith('tv-hat.png')) return new Response('missing', { status: 404 });
    return png('saved cosmetic');
  });
  await installWorker(worker);
  offline = true;
  const load = file => dispatchFetch(worker, { method: 'GET', mode: 'no-cors', url: scope + 'assets/' + file });
  assert.equal(await (await load('poppy-skin.png')).text(), 'saved cosmetic');
  assert.equal((await load('tv-hat.png')).status, 504);
  assert.equal(await worker.entries.get(scope + 'index-game.html').text(), gameHtml);
});

test('optional cosmetic images are cached on first request and reused afterward', async () => {
  let networkCalls = 0;
  const worker = loadWorker(async () => {
    networkCalls += 1;
    return png('wacky-beak-image');
  });

  const assetUrl = scope + 'assets/wacky-beak.png';
  const request = { method: 'GET', mode: 'no-cors', url: assetUrl };
  const first = await dispatchFetch(worker, request);
  assert.equal(await first.text(), 'wacky-beak-image');
  assert.equal(networkCalls, 1);
  assert.equal(worker.entries.has(assetUrl), true);

  const second = await dispatchFetch(worker, request);
  assert.equal(await second.text(), 'wacky-beak-image', 'the second request should be served from the cache right away');
  assert.equal(networkCalls, 2, 'the cached cosmetic should also refresh in the background');
});

test('a changed cosmetic picture replaces the cached copy in the background', async () => {
  let body = 'old-skin-image';
  const worker = loadWorker(async () => png(body));

  const assetUrl = scope + 'assets/wacky-beak.png';
  const request = { method: 'GET', mode: 'no-cors', url: assetUrl };
  assert.equal(await (await dispatchFetch(worker, request)).text(), 'old-skin-image');

  body = 'new-skin-image';
  assert.equal(await (await dispatchFetch(worker, request)).text(), 'old-skin-image', 'the saved copy is served while the refresh runs');
  assert.equal(await worker.entries.get(assetUrl).text(), 'new-skin-image', 'the background refresh should store the new picture');
  assert.equal(await (await dispatchFetch(worker, request)).text(), 'new-skin-image', 'later requests get the updated picture');
});

test('the project root and index.html navigation fall back to the cached game page offline', async () => {
  const worker = loadWorker(async () => { throw new Error('simulated offline network'); });
  const gameUrl = new URL('index-game.html', scope).toString();
  worker.entries.set(gameUrl, new Response('cached Frog Jumper game'));

  for (const url of [scope, scope + 'index.html']) {
    const response = await dispatchFetch(worker, { method: 'GET', mode: 'navigate', url });
    assert.ok(response, 'the navigation should be handled by the service worker');
    assert.equal(await response.text(), 'cached Frog Jumper game');
  }
});

test('online root navigation does not overwrite the cached game with the redirect page', async () => {
  const worker = loadWorker(async () => new Response('redirect page'));
  const gameUrl = new URL('index-game.html', scope).toString();
  worker.entries.set(gameUrl, new Response('cached game'));
  const response = await dispatchFetch(worker, { method: 'GET', mode: 'navigate', url: scope });
  assert.equal(await response.text(), 'redirect page');
  assert.equal(await worker.entries.get(gameUrl).text(), 'cached game');
});

test('all newer optional skins are cached on demand', async () => {
  for (const file of ['poppy-skin.png', 'us-flag-skin.png']) {
    let calls = 0;
    const worker = loadWorker(async () => { calls++; return png('skin'); });
    const request = { method: 'GET', mode: 'no-cors', url: scope + 'assets/' + file };
    assert.equal(await (await dispatchFetch(worker, request)).text(), 'skin');
    assert.equal(await (await dispatchFetch(worker, request)).text(), 'skin');
    assert.equal(calls, 2, 'first request caches the skin, second serves the cache and refreshes in the background');
  }
});

test('successful network responses survive runtime cache failures', async () => {
  for (const failure of ['open', 'put']) {
    for (const [mode, path] of [['navigate', 'index-game.html'], ['no-cors', 'assets/poppy-skin.png']]) {
      const body = mode === 'navigate' ? gameHtml : 'network success';
      const worker = loadWorker(async () => mode === 'navigate' ? page(body) : png(body), { [failure]: true });
      const response = await dispatchFetch(worker, { method: 'GET', mode, url: scope + path });
      assert.equal(await response.text(), body, failure + ' ' + path);
    }
  }
});

test('navigation HTTP errors use saved game, or preserve the error if none is cached', async () => {
  const worker = loadWorker(async () => new Response('server error', { status: 503 }));
  const request = { method: 'GET', mode: 'navigate', url: scope + 'index-game.html' };
  assert.equal((await dispatchFetch(worker, request)).status, 503);
  worker.entries.set(scope + 'index-game.html', new Response('saved game'));
  assert.equal(await (await dispatchFetch(worker, request)).text(), 'saved game');
});

test('unrelated missing pages ending in index-game.html are not served the game', async () => {
  const worker = loadWorker(async () => { throw new Error('simulated offline network'); });
  const gameUrl = new URL('index-game.html', scope).toString();
  worker.entries.set(gameUrl, new Response('cached Frog Jumper game'));
  const response = await dispatchFetch(worker, { method: 'GET', mode: 'navigate', url: scope + 'missing/index-game.html' });
  assert.equal(response, null, 'the service worker should not handle unrelated missing pages');
});

test('maintenance HTML is served online and leaves the last playable copy available offline', async () => {
  let online=true;
  const worker=loadWorker(async () => {
    if (!online) throw new Error('offline');
    return page('<h1>Maintenance</h1>');
  });
  const url=scope+'index-game.html';
  const request={method:'GET',mode:'navigate',url};
  worker.entries.set(url,page(gameHtml));
  assert.equal(await (await dispatchFetch(worker,request)).text(),'<h1>Maintenance</h1>');
  online=false;
  assert.equal(await (await dispatchFetch(worker,request)).text(),gameHtml);
});

test('an unresponsive network falls back to the cached game after the deadline', async () => {
  const controller=new AbortController();
  const worker=loadWorker(async (_,options) => new Promise((resolve,reject) => {
    options.signal.addEventListener('abort',() => reject(options.signal.reason),{once:true});
  }), {abortSignal:{timeout(ms){assert.equal(ms,4000);setImmediate(()=>controller.abort());return controller.signal;}}});
  const url=scope+'index-game.html';
  worker.entries.set(url,page(gameHtml));
  assert.equal(await (await dispatchFetch(worker,{method:'GET',mode:'navigate',url})).text(),gameHtml);
});

test('older service workers still time out when AbortSignal.timeout is unavailable', async () => {
  const worker=loadWorker(async (_,options) => new Promise((resolve,reject) => {
    options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
  }), {abortSignal:{},setTimeout(callback,ms){assert.equal(ms,4000);setImmediate(callback);}});
  const url=scope+'index-game.html';
  worker.entries.set(url,page(gameHtml));
  assert.equal(await (await dispatchFetch(worker,{method:'GET',mode:'navigate',url})).text(),gameHtml);
});

test('activation only clears older cache versions for its own registration scope', async () => {
  const current='frog-jumper-shell-'+encodeURIComponent(new URL(scope).pathname)+'-';
  const preview='frog-jumper-shell-'+encodeURIComponent('/preview/')+'-v17';
  const worker=loadWorker(null,{cacheNames:[current+'v17',current+'v18',preview,'frog-jumper-shell-v17']});
  let pending;
  worker.handlers.activate({waitUntil(promise){pending=promise;}});
  await pending;
  assert.deepEqual(worker.deleted,[current+'v17']);
});
