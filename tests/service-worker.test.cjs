'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const workerSource = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
const scope = 'https://example.test/frog-jumper-2d/';

function loadWorker(fetchImpl) {
  const handlers = {};
  const entries = new Map();
  let installFiles = [];
  const cache = {
    async addAll(files) {
      installFiles = [...files];
    },
    async match(key) {
      const value = entries.get(typeof key === 'string' ? key : key.url);
      return value ? value.clone() : null;
    },
    async put(key, response) {
      entries.set(typeof key === 'string' ? key : key.url, response.clone());
    }
  };
  const caches = {
    async open() { return cache; },
    async keys() { return []; },
    async delete() { return true; }
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
    Set,
    Promise
  });

  return { handlers, entries, getInstallFiles: () => installFiles };
}

async function installWorker(worker) {
  let pending;
  worker.handlers.install({ waitUntil(value) { pending = value; } });
  await pending;
}

async function dispatchFetch(worker, request) {
  let pending;
  worker.handlers.fetch({
    request,
    respondWith(value) { pending = Promise.resolve(value); }
  });
  return pending ? pending : null;
}

test('installation precaches only the essential game page, not optional cosmetics', async () => {
  const worker = loadWorker(async () => new Response('network'));
  await installWorker(worker);
  assert.deepEqual(worker.getInstallFiles(), ['./index-game.html']);
});

test('optional cosmetic images are cached on first request and reused afterward', async () => {
  let networkCalls = 0;
  const worker = loadWorker(async () => {
    networkCalls += 1;
    return new Response('wacky-beak-image');
  });
  await installWorker(worker);

  const assetUrl = scope + 'assets/wacky-beak.png';
  const request = { method: 'GET', mode: 'no-cors', url: assetUrl };
  const first = await dispatchFetch(worker, request);
  assert.equal(await first.text(), 'wacky-beak-image');
  assert.equal(networkCalls, 1);
  assert.equal(worker.entries.has(assetUrl), true);

  const second = await dispatchFetch(worker, request);
  assert.equal(await second.text(), 'wacky-beak-image');
  assert.equal(networkCalls, 1, 'the second request should use the cached cosmetic');
});

test('the project root and index.html navigation fall back to the cached game page offline', async () => {
  const worker = loadWorker(async () => { throw new Error('simulated offline network'); });
  await installWorker(worker);
  const gameUrl = new URL('index-game.html', scope).toString();
  worker.entries.set(gameUrl, new Response('cached Frog Jumper game'));

  for (const url of [scope, scope + 'index.html']) {
    const response = await dispatchFetch(worker, { method: 'GET', mode: 'navigate', url });
    assert.ok(response, 'the navigation should be handled by the service worker');
    assert.equal(await response.text(), 'cached Frog Jumper game');
  }
});
