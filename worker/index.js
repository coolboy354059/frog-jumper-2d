/**
 * Frog Jumper multiplayer — room-based presence using SQLite Durable Objects.
 * Up to ten players share a room and stream their frog positions over WebSockets.
 */
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PLAYERS = 10;
const MAX_NAME_LENGTH = 16;
const TICKET_TTL_MS = 60_000;
const ROOM_IDLE_TTL_MS = 6 * 60 * 60 * 1000;
const ALLOWED_MODES = new Set(["level", "race", "boss", "infinite"]);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return true;
  const allowed = (env.ALLOWED_ORIGINS || "https://coolboy354059.github.io").split(",").map(v => v.trim());
  return allowed.includes(origin);
}
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "https://coolboy354059.github.io").split(",").map(v => v.trim());
  const headers = {
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
  if (allowed.includes(origin)) headers["access-control-allow-origin"] = origin;
  return headers;
}
function makeCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join("");
}
function cleanName(value) {
  return String(value || "Frog").replace(/[<>\\u0000-\\u001f]/g, "").trim().slice(0, MAX_NAME_LENGTH) || "Frog";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (!allowedOrigin(request, env)) return json({ error: "This game origin is not allowed." }, 403, headers);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "frog-jumper-multiplayer", maxPlayers: MAX_PLAYERS }, 200, headers);
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const mode = ALLOWED_MODES.has(body.mode) ? body.mode : null;
      if (!mode) return json({ error: "Choose a valid game mode." }, 400, headers);
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

    const match = url.pathname.match(/^\\/api\\/rooms\\/([A-Z0-9]{6})\\/(join|socket)$/);
    if (match) {
      const [, code, action] = match;
      const room = env.ROOMS.get(env.ROOMS.idFromName(code));
      if (action === "join" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const response = await room.fetch("https://room.internal/join", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
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
    this.ctx.blockConcurrencyWhile(async () => {
      this.roomCreated = (await this.ctx.storage.get("created")) === true;
      this.roomMode = (await this.ctx.storage.get("mode")) || "level";
    });
  }

  async countReservations() {
    const now = Date.now();
    const tickets = await this.ctx.storage.list({ prefix: "ticket:" });
    let pending = 0;
    for (const [key, ticket] of tickets) {
      if (ticket.expiresAt > now) pending++;
      else await this.ctx.storage.delete(key);
    }
    const active = this.ctx.getWebSockets().filter(ws => ws.deserializeAttachment()?.joined).length;
    return active + pending;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/create" && request.method === "POST") {
      if (this.roomCreated) return json({ error: "Room code already exists." }, 409);
      const body = await request.json().catch(() => ({}));
      if (!ALLOWED_MODES.has(body.mode)) return json({ error: "Invalid game mode." }, 400);
      this.roomCreated = true;
      this.roomMode = body.mode;
      await this.ctx.storage.put({ created: true, mode: body.mode });
      await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_TTL_MS);
      return json({ ok: true, mode: body.mode });
    }

    if (!this.roomCreated) return json({ error: "Room not found. Check the code or create a new room." }, 404);

    if (url.pathname === "/join" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const name = cleanName(body.name);
      if (body.mode !== this.roomMode) {
        return json({ error: "This room is for " + this.roomMode + ". Choose the same game mode to join." }, 409);
      }
      if (await this.countReservations() >= MAX_PLAYERS) {
        return json({ error: "This room is full (10/10 players)." }, 409);
      }
      const token = crypto.randomUUID();
      await this.ctx.storage.put("ticket:" + token, {
        name, mode: this.roomMode, createdAt: Date.now(), expiresAt: Date.now() + TICKET_TTL_MS,
      });
      await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_TTL_MS);
      return json({ token, name, mode: this.roomMode, capacity: MAX_PLAYERS });
    }

    if (url.pathname === "/connect" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const token = url.searchParams.get("token") || "";
      const ticket = await this.ctx.storage.get("ticket:" + token);
      if (!ticket || ticket.expiresAt <= Date.now()) {
        if (ticket) await this.ctx.storage.delete("ticket:" + token);
        return json({ error: "Join ticket expired. Please join the room again." }, 401);
      }
      await this.ctx.storage.delete("ticket:" + token);
      const active = this.ctx.getWebSockets().filter(ws => ws.deserializeAttachment()?.joined).length;
      if (active >= MAX_PLAYERS) return json({ error: "This room is full (10/10 players)." }, 409);

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      const player = {
        joined: true,
        playerId: crypto.randomUUID(),
        name: ticket.name,
        mode: ticket.mode,
        levelIndex: 0,
        x: 80,
        y: 440,
        face: 1,
        updatedAt: Date.now(),
      };
      server.serializeAttachment(player);
      this.ctx.acceptWebSocket(server);
      const players = this.getPlayers();
      server.send(JSON.stringify({ type: "welcome", playerId: player.playerId, players, capacity: MAX_PLAYERS }));
      this.broadcast({ type: "player-joined", player: this.publicPlayer(player) }, server);
      await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_TTL_MS);
      return new Response(null, { status: 101, webSocket: client });
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
      if (ws !== except) {
        try { ws.send(payload); } catch (_) { /* The runtime removes closed sockets. */ }
      }
    }
  }

  webSocketMessage(ws, message) {
    const player = ws.deserializeAttachment();
    if (!player?.joined || typeof message !== "string" || message.length > 1024) return;
    let data;
    try { data = JSON.parse(message); } catch (_) { return; }
    if (data.type === "move") {
      const now = Date.now();
      if (now - (player.updatedAt || 0) < 25) return;
      const x = Number(data.x), y = Number(data.y), face = Number(data.face);
      const levelIndex = Number(data.levelIndex);
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1_000_000 || Math.abs(y) > 10_000) return;
      player.x = Math.round(x * 10) / 10;
      player.y = Math.round(y * 10) / 10;
      player.face = face < 0 ? -1 : 1;
      player.levelIndex = Number.isSafeInteger(levelIndex) ? Math.max(0, Math.min(999, levelIndex)) : 0;
      player.updatedAt = now;
      ws.serializeAttachment(player);
      this.broadcast({ type: "player-moved", player: this.publicPlayer(player) }, ws);
    } else if (data.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", at: now }));
    }
  }

  async webSocketClose(ws) {
    const player = ws.deserializeAttachment();
    if (player?.joined) this.broadcast({ type: "player-left", playerId: player.playerId });
    const remaining = this.ctx.getWebSockets().filter(socket => socket !== ws && socket.deserializeAttachment()?.joined);
    if (remaining.length === 0) await this.ctx.storage.setAlarm(Date.now() + 30 * 60 * 1000);
  }
  webSocketError(ws) {
    this.webSocketClose(ws);
  }
  async alarm() {
    for (const [key] of await this.ctx.storage.list({ prefix: "ticket:" })) {
      await this.ctx.storage.delete(key);
    }
    await this.ctx.storage.delete("created");
    await this.ctx.storage.delete("mode");
    this.roomCreated = false;
  }
}
