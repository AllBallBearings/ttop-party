const crypto = require('crypto');

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

class RelayRoom {
  constructor(roomKey) {
    this.roomKey = roomKey;
    this.players = new Map();
    this.tokenToId = new Map();
    this.sockets = new Map();
    this.disconnectTimers = new Map();
    this.hostId = null;
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
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(payload));
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

    const raw = JSON.stringify({
      type: 'room_state',
      roomKey: this.roomKey,
      hostId: this.hostId,
      players,
    });

    for (const ws of this.sockets.values()) {
      if (ws.readyState === 1) ws.send(raw);
    }
  }

  connectClient(ws, hello = {}) {
    const token = typeof hello.token === 'string' && hello.token.length >= 8
      ? hello.token
      : crypto.randomUUID();
    const requestedName = typeof hello.name === 'string' ? hello.name.trim().slice(0, 14) : '';

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
      const id = `p-${crypto.randomBytes(4).toString('hex')}`;
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

    this.sockets.set(player.id, ws);

    if (!this.hostId || !this.players.has(this.hostId)) {
      this.hostId = player.id;
    }

    this._send(ws, {
      type: 'welcome',
      playerId: player.id,
      token: player.token,
      roomKey: this.roomKey,
      hostId: this.hostId,
      isHost: player.id === this.hostId,
    });

    if (this.lastHostMeta && player.id !== this.hostId) {
      this._send(ws, this.lastHostMeta);
    }
    if (this.lastGameStarted && player.id !== this.hostId) {
      this._send(ws, this.lastGameStarted);
    }

    this._broadcastRoomState();
    return player.id;
  }

  disconnectClient(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;

    this.sockets.delete(playerId);
    player.connected = false;
    this._broadcastRoomState();

    const timer = setTimeout(() => {
      this.disconnectTimers.delete(playerId);
      const cur = this.players.get(playerId);
      if (!cur || cur.connected) return;

      this.players.delete(playerId);
      this.tokenToId.delete(cur.token);

      if (this.players.size === 0) {
        this.hostId = null;
        this.lastGameStarted = null;
        this.lastHostMeta = null;
        return;
      }

      if (this.hostId === playerId) {
        this.hostId = null;
        this._ensureHost();
        const newHostWs = this.hostId ? this.sockets.get(this.hostId) : null;
        if (newHostWs) {
          this._send(newHostWs, { type: 'you_are_host', hostId: this.hostId });
        }
      }

      this._broadcastRoomState();
    }, HOST_GRACE_MS);

    this.disconnectTimers.set(playerId, timer);
  }

  handleMessage(playerId, msg) {
    if (!msg || typeof msg !== 'object') return;

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
        if (ws.readyState === 1) ws.send(raw);
      }
    }
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  getRoom(roomKey = 'local-wifi') {
    if (!this.rooms.has(roomKey)) {
      this.rooms.set(roomKey, new RelayRoom(roomKey));
    }
    return this.rooms.get(roomKey);
  }
}

module.exports = {
  RoomManager,
  RelayRoom,
};
