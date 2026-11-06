/**
 * Frog Jumper Online — Cloudflare Durable Objects room server.
 * One Durable Object instance owns each room and broadcasts authoritative
 * player presence/position updates to up to ten connected players.
 */
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PLAYERS = 10;
const MAX_NAME_LENGTH = 16;
const ALLOWED_MODES = new Set(["level", "race", "boss", "infinite"]);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "https://coolboy354059.github.io").split(",").map(v => v.trim());
  const headers = { "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" };
  if (allowed.includes(origin)) headers["access-control-allow-origin"] = origin;
  headers["vary"] = "Origin";
  return headers;
}

function makeCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (url.pathname === "/health") return json({ ok: true, service: "frog-jumper-multiplayer" }, 200, headers);

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const code = makeCode();
      const id = env.ROOMS.idFromName(code);
      const room = env.ROOMS.get(id);
      const response = await room.fetch("https://room.internal/create", { method: "POST" });
      if (!response.ok) return json({ error: "Could not create a room. Please try again." }, 503, headers);
      return json({ code }, 201, headers);
    }

    const match = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/(join|socket)$/);
    if (match) {
      const [, code, action] = match;
      const id = env.ROOMS.idFromName(code);
      const room = env.ROOMS.get(id);
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
        socketUrl.searchParams.set("name", url.searchParams.get("name") || "Frog");
        socketUrl.searchParams.set("token", url.searchParams.get("token") || "");
        const forwarded = new Request(socketUrl, request);
        return room.fetch(forwarded);
      }
    }
    return json({ error: "Not found" }, 404, headers);
  },
};

export class FrogRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.players = new Map();
    this.roomCreated = false;
    this.ctx.blockConcurrencyWhile(async () => {
      this.roomCreated = (await this.ctx.storage.get("created")) === true;
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/create" && request.method === "POST") {
      if (!this.roomCreated) {
        this.roomCreated = true;
        await this.ctx.storage.put("created", true);
      }
      return json({ ok: true });
    }

    if (!this.roomCreated) return json({ error: "Room not found. Check the code or create a new room." }, 404);

    if (url.pathname === "/join" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const name = String(body.name || "Frog").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, MAX_NAME_LENGTH) || "Frog";
      const mode = ALLOWED_MODES.has(body.mode) ? body.mode : "level";
      const active = this.ctx.getWebSockets().filter(ws => ws.deserializeAttachment()?.joined);
      if (active.length >= MAX_PLAYERS) return json({ error: "This room is full (10/10 players)." }, 409);
      const token = crypto.randomUUID();
      await this.ctx.storage.put("ticket:" + token, { name, mode, createdAt: Date.now() });
      return json({ token, name, mode, capacity: MAX_PLAYERS });
    }

    if (url.pathname === "/connect" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const token = url.searchParams.get("token") || "";
      const ticket = await this.ctx.storage.get("ticket:" + token);
      if (!ticket) return json({ error: "Join ticket expired. Please join the room again." }, 401);
      await this.ctx.storage.delete("ticket:" + token);
      const active = this.ctx.getWebSockets().filter(ws => ws.deserializeAttachment()?.joined);
      if (active.length >= MAX_PLAYERS) return json({ error: "This room is full (10/10 players)." }, 409);

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      const playerId = crypto.randomUUID();
      server.serializeAttachment({ joined: true, playerId, name: ticket.name, mode: ticket.mode, x: 80, y: 440, face: 1, updatedAt: Date.now() });
      this.ctx.acceptWebSocket(server);
      const player = server.deserializeAttachment();
      this.broadcast({ type: "player-joined", player: this.publicPlayer(player), players: this.getPlayers() }, server);
      server.send(JSON.stringify({ type: "welcome", playerId, players: this.getPlayers(), capacity: MAX_PLAYERS }));
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ error: "Not found" }, 404);
  }

  publicPlayer(player) {
    return { id: player.playerId, name: player.name, mode: player.mode, x: player.x, y: player.y, face: player.face };
  }

  getPlayers() {
    return this.ctx.getWebSockets().map(ws => ws.deserializeAttachment()).filter(p => p?.joined).map(p => this.publicPlayer(p));
  }

  broadcast(message, except = null) {
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except) {
        try { ws.send(payload); } catch (_) { /* Closed sockets are removed by the runtime. */ }
      }
    }
  }

  webSocketMessage(ws, message) {
    const player = ws.deserializeAttachment();
    if (!player?.joined) return;
    let data;
    try { data = JSON.parse(message); } catch (_) { return; }
    if (data.type === "move") {
      const x = Number(data.x), y = Number(data.y), face = Number(data.face);
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 100000 || Math.abs(y) > 100000) return;
      player.x = Math.round(x * 10) / 10;
      player.y = Math.round(y * 10) / 10;
      player.face = face < 0 ? -1 : 1;
      player.updatedAt = Date.now();
      ws.serializeAttachment(player);
      this.broadcast({ type: "player-moved", player: this.publicPlayer(player) }, ws);
    } else if (data.type === "mode" && ALLOWED_MODES.has(data.mode)) {
      player.mode = data.mode;
      ws.serializeAttachment(player);
      this.broadcast({ type: "player-updated", player: this.publicPlayer(player) }, ws);
    } else if (data.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", at: Date.now() }));
    }
  }

  webSocketClose(ws) {
    const player = ws.deserializeAttachment();
    if (player?.joined) this.broadcast({ type: "player-left", playerId: player.playerId });
  }

  webSocketError(ws) {
    this.webSocketClose(ws);
  }
}
