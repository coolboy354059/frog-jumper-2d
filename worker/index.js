/**
 * Frog Jumper multiplayer — room-based presence using SQLite Durable Objects.
 * Up to ten players share a room and stream validated frog positions over WebSockets.
 */
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PLAYERS = 10;
const MAX_NAME_LENGTH = 16;
const MAX_JSON_BYTES = 2048;
const TICKET_TTL_MS = 60_000;
const ROOM_IDLE_TTL_MS = 6 * 60 * 60 * 1000;
const ALLOWED_MODES = new Set(["level", "race", "boss", "infinite"]);
const RATE_LIMITS = {
  create: { limit: 5, windowMs: 10 * 60 * 1000 },
  join: { limit: 20, windowMs: 60 * 1000 },
};
const DEFAULT_ALLOWED_ORIGINS = ["https://coolboy354059.github.io"];

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",").map(value => value.trim()).filter(Boolean);
}
function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  return !!origin && allowedOrigins(env).includes(origin);
}
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
  if (allowedOrigins(env).includes(origin)) headers["access-control-allow-origin"] = origin;
  return headers;
}
async function readJsonBody(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(length) && length > MAX_JSON_BYTES) {
    return { ok: false, status: 413, error: "Request body is too large." };
  }
  let raw;
  try { raw = await request.text(); }
  catch (_) { return { ok: false, status: 400, error: "Invalid JSON request." }; }
  if (new TextEncoder().encode(raw).byteLength > MAX_JSON_BYTES) {
    return { ok: false, status: 413, error: "Request body is too large." };
  }
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, status: 400, error: "A JSON object is required." };
    }
    return { ok: true, value };
  } catch (_) {
    return { ok: false, status: 400, error: "Invalid JSON request." };
  }
}
async function rateLimitKey(request) {
  // Cloudflare supplies CF-Connecting-IP at the edge. Store only a short hash,
  // never the raw address, in the rate-limit Durable Object name.
  const address = request.headers.get("CF-Connecting-IP") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  return Array.from(new Uint8Array(digest).slice(0, 16), byte => byte.toString(16).padStart(2, "0")).join("");
}
function makeCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join("");
}
function cleanName(value) {
  if (typeof value !== "string") return "Frog";
  const cleaned = value.normalize("NFKC")
    .replace(/[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
  return Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join("") || "Frog";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);
    const isApiRequest = url.pathname.startsWith("/api/");
    if (isApiRequest && !allowedOrigin(request, env)) {
      return json({ error: "This game origin is not allowed." }, 403, headers);
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "frog-jumper-multiplayer", maxPlayers: MAX_PLAYERS }, 200, headers);
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const parsed = await readJsonBody(request);
      if (!parsed.ok) return json({ error: parsed.error }, parsed.status, headers);
      const mode = ALLOWED_MODES.has(parsed.value.mode) ? parsed.value.mode : null;
      if (!mode) return json({ error: "Choose a valid game mode." }, 400, headers);

      const key = await rateLimitKey(request);
      const limiter = env.ROOMS.get(env.ROOMS.idFromName("rate:" + key));
      const limited = await limiter.fetch("https://room.internal/rate-limit/create", { method: "POST" });
      if (!limited.ok) {
        const result = await limited.json().catch(() => ({}));
        return json(result, limited.status, { ...headers, "retry-after": limited.headers.get("retry-after") || "600" });
      }

      for (let attempt = 0; attempt < 4; attempt++) {
        const code = makeCode();
        const room = env.ROOMS.get(env.ROOMS.idFromName(code));
        const response = await room.fetch("https://room.internal/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        if (response.status === 409) continue;
        if (!response.ok) return json({ error: "Could not create a room. Please try again." }, 503, headers);
        return json({ code, mode, capacity: MAX_PLAYERS }, 201, headers);
      }
      return json({ error: "Could not find an unused room code. Please try again." }, 503, headers);
    }

    const routeParts = url.pathname.split("/");
    if (routeParts.length === 5 && routeParts[1] === "api" && routeParts[2] === "rooms"
      && /^[A-HJ-NP-Z2-9]{6}$/.test(routeParts[3])
      && (routeParts[4] === "join" || routeParts[4] === "socket")) {
      const code = routeParts[3];
      const action = routeParts[4];
      const room = env.ROOMS.get(env.ROOMS.idFromName(code));
      if (action === "join" && request.method === "POST") {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) return json({ error: parsed.error }, parsed.status, headers);
        const key = await rateLimitKey(request);
        const limiter = env.ROOMS.get(env.ROOMS.idFromName("rate:" + key));
        const limited = await limiter.fetch("https://room.internal/rate-limit/join", { method: "POST" });
        if (!limited.ok) {
          const result = await limited.json().catch(() => ({}));
          return json(result, limited.status, { ...headers, "retry-after": limited.headers.get("retry-after") || "60" });
        }
        const response = await room.fetch("https://room.internal/join", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed.value),
        });
        const result = await response.json().catch(() => ({}));
        return json(result, response.status, headers);
      }
      if (action === "socket" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        const socketUrl = new URL("https://room.internal/connect");
        socketUrl.searchParams.set("token", url.searchParams.get("token") || "");
        return room.fetch(new Request(socketUrl, request));
      }
    }
    return json({ error: "Not found" }, 404, headers);
  },
};

export class FrogRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.roomCreated = false;
    this.roomMode = "level";
    this.lockTail = Promise.resolve();
    this.ready = Promise.resolve(this.ctx.blockConcurrencyWhile(async () => {
      this.roomCreated = (await this.ctx.storage.get("created")) === true;
      this.roomMode = (await this.ctx.storage.get("mode")) || "level";
    }));
  }

  withLock(callback) {
    const operation = this.lockTail.then(callback, callback);
    this.lockTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async countReservations() {
    const now = Date.now();
    const tickets = await this.ctx.storage.list({ prefix: "ticket:" });
    let pending = 0;
    for (const [key, ticket] of tickets) {
      if (ticket && ticket.expiresAt > now) pending++;
      else await this.ctx.storage.delete(key);
    }
    const active = this.ctx.getWebSockets().filter(ws => ws.deserializeAttachment()?.joined).length;
    return active + pending;
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);

    if (url.pathname.startsWith("/rate-limit/") && request.method === "POST") {
      const action = url.pathname.slice("/rate-limit/".length);
      const rule = RATE_LIMITS[action];
      if (!rule) return json({ error: "Unknown rate limit." }, 404);
      return this.withLock(async () => {
        const now = Date.now();
        const key = "rate:" + action;
        const previous = await this.ctx.storage.get(key);
        const current = !previous || previous.resetAt <= now
          ? { count: 0, resetAt: now + rule.windowMs }
          : previous;
        if (current.count >= rule.limit) {
          const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
          return json({ error: "Too many requests. Please wait before trying again." }, 429, {
            "retry-after": String(retryAfter),
          });
        }
        current.count++;
        await this.ctx.storage.put(key, current);
        await this.ctx.storage.setAlarm(current.resetAt);
        return json({ ok: true, remaining: rule.limit - current.count });
      });
    }

    if (url.pathname === "/create" && request.method === "POST") {
      const parsed = await readJsonBody(request);
      if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
      return this.withLock(async () => {
        if (this.roomCreated) return json({ error: "Room code already exists." }, 409);
        const mode = parsed.value.mode;
        if (!ALLOWED_MODES.has(mode)) return json({ error: "Invalid game mode." }, 400);
        this.roomCreated = true;
        this.roomMode = mode;
        await this.ctx.storage.put({ created: true, mode });
        await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_TTL_MS);
        return json({ ok: true, mode });
      });
    }

    if (url.pathname === "/join" && request.method === "POST") {
      const parsed = await readJsonBody(request);
      if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
      return this.withLock(async () => {
        if (!this.roomCreated) return json({ error: "Room not found. Check the code or create a new room." }, 404);
        const body = parsed.value;
        if (body.mode !== this.roomMode) {
          return json({ error: "This room is for " + this.roomMode + ". Choose the same game mode to join." }, 409);
        }
        if (await this.countReservations() >= MAX_PLAYERS) {
          return json({ error: "This room is full (10/10 players)." }, 409);
        }
        const token = crypto.randomUUID();
        const now = Date.now();
        const name = cleanName(body.name);
        await this.ctx.storage.put("ticket:" + token, {
          name, mode: this.roomMode, createdAt: now, expiresAt: now + TICKET_TTL_MS,
        });
        await this.ctx.storage.setAlarm(now + TICKET_TTL_MS);
        return json({ token, name, mode: this.roomMode, capacity: MAX_PLAYERS });
      });
    }

    if (url.pathname === "/connect" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return this.withLock(async () => {
        if (!this.roomCreated) return json({ error: "Room not found. Create or join an active room." }, 404);
        const token = url.searchParams.get("token") || "";
        if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: "Invalid join ticket." }, 401);
        const ticketKey = "ticket:" + token;
        const ticket = await this.ctx.storage.get(ticketKey);
        if (!ticket || ticket.expiresAt <= Date.now()) {
          if (ticket) await this.ctx.storage.delete(ticketKey);
          return json({ error: "Join ticket expired or already used. Please join the room again." }, 401);
        }
        const active = this.ctx.getWebSockets().filter(ws => ws.deserializeAttachment()?.joined).length;
        if (active >= MAX_PLAYERS) return json({ error: "This room is full (10/10 players)." }, 409);

        const pair = new WebSocketPair();
        const client = pair[0] || pair["0"] || Object.values(pair)[0];
        const server = pair[1] || pair["1"] || Object.values(pair)[1];
        const now = Date.now();
        const player = {
          joined: true,
          playerId: crypto.randomUUID(),
          name: ticket.name,
          mode: ticket.mode,
          levelIndex: 0,
          x: 80,
          y: 440,
          face: 1,
          updatedAt: now,
          lastMoveAt: now,
          lastPingAt: 0,
          messageWindowStartedAt: now,
          messagesInWindow: 0,
        };
        server.serializeAttachment(player);
        this.ctx.acceptWebSocket(server);
        await this.ctx.storage.delete(ticketKey);
        const players = this.getPlayers();
        server.send(JSON.stringify({ type: "welcome", playerId: player.playerId, players, capacity: MAX_PLAYERS }));
        this.broadcast({ type: "player-joined", player: this.publicPlayer(player) }, server);
        await this.ctx.storage.setAlarm(now + ROOM_IDLE_TTL_MS);
        return new Response(null, { status: 101, webSocket: client });
      });
    }
    return json({ error: "Not found" }, 404);
  }

  publicPlayer(player) {
    return {
      id: player.playerId, name: player.name, mode: player.mode,
      levelIndex: player.levelIndex, x: player.x, y: player.y, face: player.face,
    };
  }

  getPlayers() {
    return this.ctx.getWebSockets()
      .map(ws => ws.deserializeAttachment())
      .filter(player => player?.joined)
      .map(player => this.publicPlayer(player));
  }

  broadcast(message, except = null) {
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except && ws.deserializeAttachment()?.joined) {
        try { ws.send(payload); }
        catch (_) { /* The runtime removes closed sockets. */ }
      }
    }
  }

  webSocketMessage(ws, message) {
    const player = ws.deserializeAttachment();
    if (!player?.joined || typeof message !== "string") return;
    const now = Date.now();
    if (message.length > 1024) {
      try { ws.close(1009, "Message too large"); } catch (_) {}
      return;
    }

    if (!Number.isFinite(player.messageWindowStartedAt) || now - player.messageWindowStartedAt >= 1000) {
      player.messageWindowStartedAt = now;
      player.messagesInWindow = 0;
    }
    player.messagesInWindow = (player.messagesInWindow || 0) + 1;
    if (player.messagesInWindow > 40) {
      ws.serializeAttachment(player);
      try { ws.close(1008, "Message rate limit exceeded"); } catch (_) {}
      return;
    }

    let data;
    try { data = JSON.parse(message); } catch (_) {
      ws.serializeAttachment(player);
      return;
    }

    if (data.type === "move") {
      if (now - (player.lastMoveAt || 0) < 25) {
        ws.serializeAttachment(player);
        return;
      }
      const x = Number(data.x), y = Number(data.y), face = Number(data.face);
      const levelIndex = Number(data.levelIndex);
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1_000_000
        || Math.abs(y) > 10_000 || !Number.isInteger(levelIndex)
        || levelIndex < 0 || levelIndex > 999 || (face !== -1 && face !== 1)) {
        ws.serializeAttachment(player);
        return;
      }
      if (player.lastMoveAt) {
        const elapsed = Math.max(25, Math.min(2000, now - player.lastMoveAt));
        const maxHorizontalDelta = Math.min(1200, 550 * elapsed / 1000 + 40);
        const maxVerticalDelta = Math.min(1200, 850 * elapsed / 1000 + 60);
        if (Math.abs(x - player.x) > maxHorizontalDelta || Math.abs(y - player.y) > maxVerticalDelta) {
          ws.serializeAttachment(player);
          return;
        }
      }
      player.x = Math.round(x * 10) / 10;
      player.y = Math.round(y * 10) / 10;
      player.face = face;
      player.levelIndex = levelIndex;
      player.updatedAt = now;
      player.lastMoveAt = now;
      ws.serializeAttachment(player);
      this.broadcast({ type: "player-moved", player: this.publicPlayer(player) }, ws);
    } else if (data.type === "ping") {
      if (now - (player.lastPingAt || 0) < 1000) {
        ws.serializeAttachment(player);
        return;
      }
      player.lastPingAt = now;
      ws.serializeAttachment(player);
      try { ws.send(JSON.stringify({ type: "pong", at: now })); } catch (_) {}
    } else {
      ws.serializeAttachment(player);
    }
  }

  async webSocketClose(ws) {
    await this.withLock(async () => {
      const player = ws.deserializeAttachment();
      if (player?.joined) {
        player.joined = false;
        ws.serializeAttachment(player);
        this.broadcast({ type: "player-left", playerId: player.playerId }, ws);
      }
      const remaining = this.ctx.getWebSockets().filter(socket => socket !== ws && socket.deserializeAttachment()?.joined);
      if (remaining.length === 0) await this.ctx.storage.setAlarm(Date.now() + 30 * 60 * 1000);
    });
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  async alarm() {
    await this.withLock(async () => {
      const now = Date.now();
      for (const [key, ticket] of await this.ctx.storage.list({ prefix: "ticket:" })) {
        if (!ticket || ticket.expiresAt <= now) await this.ctx.storage.delete(key);
      }
      let nextRateReset = Infinity;
      for (const [key, rate] of await this.ctx.storage.list({ prefix: "rate:" })) {
        if (!rate || rate.resetAt <= now) await this.ctx.storage.delete(key);
        else nextRateReset = Math.min(nextRateReset, rate.resetAt);
      }
      const active = this.ctx.getWebSockets().some(ws => ws.deserializeAttachment()?.joined);
      if (active) {
        await this.ctx.storage.setAlarm(Math.min(now + ROOM_IDLE_TTL_MS, nextRateReset));
        return;
      }
      const pending = await this.ctx.storage.list({ prefix: "ticket:" });
      if (pending.size > 0) {
        await this.ctx.storage.setAlarm(Math.min(now + TICKET_TTL_MS, nextRateReset));
        return;
      }
      await this.ctx.storage.delete("created");
      await this.ctx.storage.delete("mode");
      this.roomCreated = false;
      if (nextRateReset !== Infinity) await this.ctx.storage.setAlarm(nextRateReset);
    });
  }
}
