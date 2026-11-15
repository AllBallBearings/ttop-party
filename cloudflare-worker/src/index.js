const PLAYER_COLORS = [
  { name: 'Red', hex: '#ff3b30' },
  { name: 'Blue', hex: '#0a84ff' },
  { name: 'Green', hex: '#30d158' },
  { name: 'Yellow', hex: '#ffd60a' },
  { name: 'Purple', hex: '#bf5af2' },
  { name: 'Orange', hex: '#ff9f0a' },
  { name: 'Cyan', hex: '#64d2ff' },
  { name: 'Pink', hex: '#ff375f' },
];

const HOST_GRACE_MS = 7000;

async function sha256Short(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes.slice(0, 5))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response(
        JSON.stringify({ ok: true, service: 'tabletop-ar-relay', wsPath: '/ws' }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const explicitRoom = (url.searchParams.get('room') || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 32);

    let roomKey = explicitRoom;
    if (!roomKey) {
      const clientIp = request.headers.get('CF-Connecting-IP') || 'shared-public';
      const hash = await sha256Short(`tabletop-ar:${clientIp}`);
      roomKey = `wifi-${hash}`;
    }

    const id = env.ROOMS.idFromName(roomKey);
    const stub = env.ROOMS.get(id);
    const forwardUrl = new URL(request.url);
    forwardUrl.searchParams.set('roomKey', roomKey);
    return stub.fetch(new Request(forwardUrl.toString(), request));
  },
};

export class TabletopRoom {
  constructor(state) {
    this.state = state;
    this.players = new Map(); // id -> player
    this.tokenToId = new Map(); // token -> id
    this.sockets = new Map(); // id -> ws
    this.disconnectTimers = new Map();
    this.hostId = null;
    this.roomKey = '';
    this.lastGameStarted = null;
    this.lastHostMeta = null;
  }

  _pickColor(preferIdx = 0) {
    const used = new Set();
    for (const p of this.players.values()) used.add(p.color);
    for (let i = 0; i < PLAYER_COLORS.length; i++) {
      const c = PLAYER_COLORS[(preferIdx + i) % PLAYER_COLORS.length];
      if (!used.has(c.hex)) return c;
    }
    return PLAYER_COLORS[this.players.size % PLAYER_COLORS.length];
  }

  _ensureHost() {
    if (this.hostId && this.players.has(this.hostId)) return;
    const sorted = Array.from(this.players.values()).sort((a, b) => a.joinedAt - b.joinedAt);
    this.hostId = sorted.length > 0 ? sorted[0].id : null;
  }

  _send(ws, payload) {
    try {
      if (ws.readyState === 1) ws.send(JSON.stringify(payload));
    } catch {
      // Ignore closed socket
    }
  }

  _broadcastRoomState() {
    const players = Array.from(this.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      colorName: p.colorName,
      connected: p.connected,
      isHost: p.id === this.hostId,
      isBot: false,
    }));

    const payload = JSON.stringify({
      type: 'room_state',
      roomKey: this.roomKey,
      hostId: this.hostId,
      players,
    });

    for (const ws of this.sockets.values()) {
      try {
        if (ws.readyState === 1) ws.send(payload);
      } catch {
        // Ignore
      }
    }
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const url = new URL(request.url);
    if (!this.roomKey) {
      this.roomKey = url.searchParams.get('roomKey') || 'default';
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    let playerId = null;

    server.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === 'hello') {
        const token = typeof msg.token === 'string' && msg.token.length >= 8
          ? msg.token
          : crypto.randomUUID();
        const requestedName = typeof msg.name === 'string' ? msg.name.trim().slice(0, 14) : '';

        let player = null;
        const existingId = this.tokenToId.get(token);
        if (existingId && this.players.has(existingId)) {
          player = this.players.get(existingId);
          if (this.disconnectTimers.has(player.id)) {
            clearTimeout(this.disconnectTimers.get(player.id));
            this.disconnectTimers.delete(player.id);
          }
          player.connected = true;
          if (requestedName) player.name = requestedName;
        } else {
          const id = `p-${crypto.randomUUID().slice(0, 8)}`;
          const colorObj = this._pickColor(this.players.size);
          player = {
            id,
            token,
            name: requestedName || colorObj.name,
            color: colorObj.hex,
            colorName: colorObj.name,
            connected: true,
            joinedAt: Date.now(),
          };
          this.players.set(id, player);
          this.tokenToId.set(token, id);
        }

        playerId = player.id;
        this.sockets.set(playerId, server);

        if (!this.hostId || !this.players.has(this.hostId)) {
          this.hostId = playerId;
        }

        this._send(server, {
          type: 'welcome',
          playerId,
          token: player.token,
          roomKey: this.roomKey,
          hostId: this.hostId,
          isHost: playerId === this.hostId,
        });

        if (this.lastHostMeta && playerId !== this.hostId) {
          this._send(server, this.lastHostMeta);
        }
        if (this.lastGameStarted && playerId !== this.hostId) {
          this._send(server, this.lastGameStarted);
        }

        this._broadcastRoomState();
        return;
      }

      if (!playerId) return;

      if (msg.type === 'set_name') {
        const p = this.players.get(playerId);
        const clean = String(msg.name || '').trim().slice(0, 14);
        if (p && clean) {
          p.name = clean;
          this._broadcastRoomState();
        }
        return;
      }

      if (msg.type === 'input') {
        const hostWs = this.hostId ? this.sockets.get(this.hostId) : null;
        if (hostWs && playerId !== this.hostId) {
          this._send(hostWs, { ...msg, from: playerId });
        }
        return;
      }

      if (msg.type === 'relay_broadcast' && playerId === this.hostId && msg.payload) {
        if (msg.payload.type === 'game_started') this.lastGameStarted = msg.payload;
        else if (msg.payload.type === 'returned_lobby') this.lastGameStarted = null;
        else if (msg.payload.type === 'host_meta') this.lastHostMeta = msg.payload;

        const raw = JSON.stringify(msg.payload);
        for (const [id, ws] of this.sockets.entries()) {
          if (id === this.hostId) continue;
          try {
            if (ws.readyState === 1) ws.send(raw);
          } catch {
            // Ignore
          }
        }
      }
    });

    const handleClose = () => {
      if (!playerId) return;
      const pid = playerId;
      const player = this.players.get(pid);
      if (!player) return;

      this.sockets.delete(pid);
      player.connected = false;
      this._broadcastRoomState();

      const timer = setTimeout(() => {
        this.disconnectTimers.delete(pid);
        const cur = this.players.get(pid);
        if (!cur || cur.connected) return;

        this.players.delete(pid);
        this.tokenToId.delete(cur.token);

        if (this.players.size === 0) {
          this.hostId = null;
          this.lastGameStarted = null;
          this.lastHostMeta = null;
          return;
        }

        if (this.hostId === pid) {
          this.hostId = null;
          this._ensureHost();
          const newHostWs = this.hostId ? this.sockets.get(this.hostId) : null;
          if (newHostWs) {
            this._send(newHostWs, { type: 'you_are_host', hostId: this.hostId });
          }
        }

        this._broadcastRoomState();
      }, HOST_GRACE_MS);

      this.disconnectTimers.set(pid, timer);
    };

    server.addEventListener('close', handleClose);
    server.addEventListener('error', handleClose);

    return new Response(null, { status: 101, webSocket: client });
  }
}
