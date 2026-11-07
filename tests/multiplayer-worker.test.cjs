'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ORIGIN = 'https://coolboy354059.github.io';
const NativeResponse = globalThis.Response;

class TestResponse extends NativeResponse {
  constructor(body, init = {}) {
    if (init.status === 101) {
      super(null, { status: 200, headers: init.headers });
      Object.defineProperty(this, 'status', { configurable: true, value: 101 });
      this.webSocket = init.webSocket;
    } else {
      super(body, init);
    }
  }
}

class FakeWebSocket {
  constructor() {
    this.messages = [];
    this.attachment = null;
    this.closed = null;
  }
  serializeAttachment(value) {
    this.attachment = structuredClone(value);
  }
  deserializeAttachment() {
    return this.attachment === null ? null : structuredClone(this.attachment);
  }
  send(message) {
    this.messages.push(message);
  }
  close(code = 1000, reason = '') {
    this.closed = { code, reason };
  }
}

class FakeWebSocketPair {
  constructor() {
    this[0] = new FakeWebSocket();
    this[1] = new FakeWebSocket();
  }
}

globalThis.Response = TestResponse;
globalThis.WebSocketPair = FakeWebSocketPair;

const source = fs.readFileSync(path.join(__dirname, '..', 'worker', 'index.js'), 'utf8');
const { default: worker, FrogRoom } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
);

class FakeStorage {
  constructor() {
    this.values = new Map();
  }
  async get(key) {
    return this.values.get(key);
  }
  async put(key, value) {
    if (typeof key === 'object' && key !== null) {
      for (const [entryKey, entryValue] of Object.entries(key)) this.values.set(entryKey, structuredClone(entryValue));
      return;
    }
    this.values.set(key, structuredClone(value));
  }
  async delete(key) {
    return this.values.delete(key);
  }
  async list({ prefix = '' } = {}) {
    return new Map([...this.values.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key, structuredClone(value)]));
  }
}

function makeEnvironment() {
  const instances = new Map();
  const env = {
    ALLOWED_ORIGINS: ORIGIN,
    ROOMS: {
      idFromName(name) { return name; },
      get(id) {
        if (!instances.has(id)) {
          const sockets = [];
          const storage = new FakeStorage();
          const ctx = {
            storage,
            blockConcurrencyWhile(callback) { return callback(); },
            getWebSockets() { return sockets; },
            acceptWebSocket(socket) { sockets.push(socket); },
          };
          instances.set(id, { durableObject: new FrogRoom(ctx, env), ctx, sockets });
        }
        const instance = instances.get(id);
        return {
          fetch(request, init) {
            const actual = request instanceof Request ? request : new Request(request, init);
            return instance.durableObject.fetch(actual);
          },
        };
      },
    },
  };
  return { env, instances };
}

function apiRequest(pathname, { method = 'GET', body, ip = '192.0.2.1', origin = ORIGIN } = {}) {
  const headers = new Headers();
  if (origin) headers.set('Origin', origin);
  if (ip) headers.set('CF-Connecting-IP', ip);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request('https://game.example' + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createRoom(context, ip = '192.0.2.1') {
  const response = await worker.fetch(apiRequest('/api/rooms', {
    method: 'POST', body: { mode: 'level' }, ip,
  }), context.env);
  assert.equal(response.status, 201, await response.text());
  return response.json();
}

async function joinRoom(context, code, ip, name = 'Test Frog') {
  return worker.fetch(apiRequest('/api/rooms/' + code + '/join', {
    method: 'POST', body: { name, mode: 'level' }, ip,
  }), context.env);
}

function connectRequest(token) {
  return {
    url: 'https://room.internal/connect?token=' + encodeURIComponent(token),
    method: 'GET',
    headers: { get(name) { return name.toLowerCase() === 'upgrade' ? 'websocket' : null; } },
  };
}

test('the room capacity limit is atomic under simultaneous join requests', async () => {
  const context = makeEnvironment();
  const { code } = await createRoom(context);
  const joins = await Promise.all(Array.from({ length: 15 }, (_, index) =>
    joinRoom(context, code, '198.51.100.' + (index + 1), 'Frog ' + index)));
  const accepted = joins.filter(response => response.status === 200);
  const rejected = joins.filter(response => response.status === 409);
  assert.equal(accepted.length, 10, 'exactly ten pending reservations should be accepted');
  assert.equal(rejected.length, 5, 'all additional simultaneous joins should be rejected as full');
});

test('join tickets are single-use even when two WebSocket connects race', async () => {
  const context = makeEnvironment();
  const { code } = await createRoom(context);
  const joined = await joinRoom(context, code, '203.0.113.8');
  assert.equal(joined.status, 200);
  const { token } = await joined.json();
  const room = context.instances.get(code);
  const [first, second] = await Promise.all([
    room.durableObject.fetch(connectRequest(token)),
    room.durableObject.fetch(connectRequest(token)),
  ]);
  assert.equal(first.status, 101);
  assert.equal(second.status, 401);
  assert.equal(room.sockets.length, 1, 'a reused ticket must not create a second player');
});

test('WebSocket ping floods are throttled and eventually closed', async () => {
  const context = makeEnvironment();
  const { code } = await createRoom(context);
  const joined = await joinRoom(context, code, '203.0.113.9');
  const { token } = await joined.json();
  const room = context.instances.get(code);
  await room.durableObject.fetch(connectRequest(token));
  const socket = room.sockets[0];

  room.durableObject.webSocketMessage(socket, JSON.stringify({ type: 'ping' }));
  for (let i = 0; i < 40; i++) {
    room.durableObject.webSocketMessage(socket, JSON.stringify({ type: 'ping' }));
  }

  const pongs = socket.messages.map(message => JSON.parse(message)).filter(message => message.type === 'pong');
  assert.equal(pongs.length, 1, 'only one ping per second should receive a pong');
  assert.equal(socket.closed?.code, 1008, 'excessive message traffic should close the connection');
});

test('movement updates reject invalid coordinates and implausible jumps', async () => {
  const context = makeEnvironment();
  const { code } = await createRoom(context);
  const joined = await joinRoom(context, code, '203.0.113.10');
  const { token } = await joined.json();
  const room = context.instances.get(code);
  await room.durableObject.fetch(connectRequest(token));
  const socket = room.sockets[0];

  room.durableObject.webSocketMessage(socket, JSON.stringify({
    type: 'move', x: 2000000, y: 440, face: 1, levelIndex: 0,
  }));
  assert.equal(socket.deserializeAttachment().x, 80, 'out-of-range coordinates must be ignored');

  room.durableObject.webSocketMessage(socket, JSON.stringify({
    type: 'move', x: 100, y: 440, face: 1, levelIndex: 0,
  }));
  assert.equal(socket.deserializeAttachment().x, 100, 'a normal movement update should be accepted');

  room.durableObject.webSocketMessage(socket, JSON.stringify({
    type: 'move', x: 100000, y: 440, face: 1, levelIndex: 0,
  }));
  assert.equal(socket.deserializeAttachment().x, 100, 'an implausible teleport must be ignored');
});

test('room creation is rate-limited per client address', async () => {
  const context = makeEnvironment();
  const responses = [];
  for (let i = 0; i < 6; i++) {
    responses.push(await worker.fetch(apiRequest('/api/rooms', {
      method: 'POST', body: { mode: 'level' }, ip: '192.0.2.44',
    }), context.env));
  }
  assert.deepEqual(responses.map(response => response.status), [201, 201, 201, 201, 201, 429]);
  assert.ok(Number(responses[5].headers.get('retry-after')) > 0);
});

test('join attempts are rate-limited per client address', async () => {
  const context = makeEnvironment();
  const responses = [];
  for (let i = 0; i < 21; i++) {
    responses.push(await worker.fetch(apiRequest('/api/rooms/ABC234/join', {
      method: 'POST', body: { name: 'Frog', mode: 'level' }, ip: '192.0.2.45',
    }), context.env));
  }
  assert.equal(responses.slice(0, 20).every(response => response.status === 404), true);
  assert.equal(responses[20].status, 429);
});

test('API requests from unapproved web origins are rejected', async () => {
  const context = makeEnvironment();
  const response = await worker.fetch(apiRequest('/api/rooms', {
    method: 'POST', body: { mode: 'level' }, origin: 'https://not-the-game.example',
  }), context.env);
  assert.equal(response.status, 403);
});

test('invalid and oversized request bodies are rejected', async () => {
  const context = makeEnvironment();
  const invalid = new Request('https://game.example/api/rooms', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'CF-Connecting-IP': '192.0.2.46', 'content-type': 'application/json' },
    body: '{invalid',
  });
  assert.equal((await worker.fetch(invalid, context.env)).status, 400);

  const oversized = new Request('https://game.example/api/rooms', {
    method: 'POST',
    headers: {
      Origin: ORIGIN, 'CF-Connecting-IP': '192.0.2.47',
      'content-type': 'application/json', 'content-length': '99999',
    },
    body: JSON.stringify({ mode: 'level' }),
  });
  assert.equal((await worker.fetch(oversized, context.env)).status, 413);
});
