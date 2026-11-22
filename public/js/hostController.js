import { StickmanShowdownEngine } from './shared/stickmanShowdownEngine.js';
import { PixelHoopsEngine, normalizeBotDifficulty } from './shared/pixelHoopsEngine.js';
import { getGameDefinition } from './shared/gameCatalog.js';

const BOT_COLORS = [
  { name: 'Orange', hex: '#ff9f0a' },
  { name: 'Purple', hex: '#bf5af2' },
  { name: 'Cyan', hex: '#64d2ff' },
  { name: 'Pink', hex: '#ff375f' },
  { name: 'Red', hex: '#ff3b30' },
  { name: 'Blue', hex: '#0a84ff' },
  { name: 'Green', hex: '#30d158' },
  { name: 'Yellow', hex: '#ffd60a' },
];

export class HostController {
  constructor({ sendRelay, onLocalGameStarted, onLocalState, onLocalReturnedLobby, onHostRosterChange, initialBotDifficulty = 'medium' }) {
    this.sendRelay = sendRelay;
    this.onLocalGameStarted = onLocalGameStarted;
    this.onLocalState = onLocalState;
    this.onLocalReturnedLobby = onLocalReturnedLobby;
    this.onHostRosterChange = onHostRosterChange;

    this.active = false;
    this.selectedGameId = 'stickman-showdown';
    this.botDifficulty = normalizeBotDifficulty(initialBotDifficulty);
    this.humanPlayers = [];
    this.bots = [];
    this.botCounter = 0;
    this.winsById = new Map();
    this.activeEngine = null;
    this.tickTimer = null;
    this.lastTickAt = 0;
    // Pixel Hoops: winner stays on, everyone else waits in line.
    this.lastWinnerId = null;
    this.hoopsQueue = [];
  }

  activate(humanPlayers) {
    this.active = true;
    this.syncHumanPlayers(humanPlayers);
  }

  deactivate() {
    this.active = false;
    this.stopGameLoop();
    this.activeEngine = null;
  }

  _pickBotColor() {
    const used = new Set([...this.humanPlayers, ...this.bots].map((p) => p.color));
    for (const c of BOT_COLORS) {
      if (!used.has(c.hex)) return c.hex;
    }
    return BOT_COLORS[this.bots.length % BOT_COLORS.length].hex;
  }

  getCombinedRoster() {
    const combined = [...this.humanPlayers, ...this.bots].map((p) => ({
      ...p,
      wins: this.winsById.get(p.id) || p.wins || 0,
    }));
    return combined;
  }

  syncHumanPlayers(humanPlayers) {
    const prevIds = new Set(this.humanPlayers.map((p) => p.id));
    const nextIds = new Set(humanPlayers.map((p) => p.id));
    this.humanPlayers = humanPlayers.map((p) => ({ ...p }));

    if (this.activeEngine) {
      for (const p of this.humanPlayers) {
        if (!prevIds.has(p.id)) {
          this.activeEngine.addPlayerMidMatch(p);
        } else {
          this.activeEngine.renamePlayer(p.id, p.name);
        }
      }
      for (const oldId of prevIds) {
        if (!nextIds.has(oldId)) {
          this.activeEngine.removePlayer(oldId);
        }
      }
    }

    if (this.active) {
      this._broadcastHostMeta();
    }
  }

  selectGame(gameId) {
    if (!this.active) return;
    const def = getGameDefinition(gameId);
    if (!def || def.status !== 'playable') return;
    this.selectedGameId = def.id;
    this._broadcastHostMeta();
  }

  setBotDifficulty(level) {
    this.botDifficulty = normalizeBotDifficulty(level);
    if (this.activeEngine?.setBotDifficulty) {
      this.activeEngine.setBotDifficulty(this.botDifficulty);
    }
    if (this.active) {
      this._broadcastHostMeta();
    }
  }

  addBot() {
    if (!this.active) return;
    if (this.humanPlayers.length + this.bots.length >= 8) return;
    this.botCounter += 1;
    const bot = {
      id: `bot-${Date.now().toString(36)}-${this.botCounter}`,
      name: `Bot ${this.botCounter}`,
      color: this._pickBotColor(),
      isBot: true,
      isHost: false,
      connected: true,
      wins: 0,
    };
    this.bots.push(bot);
    if (this.activeEngine) {
      this.activeEngine.addPlayerMidMatch(bot);
    }
    this._broadcastHostMeta();
  }

  clearBots() {
    if (!this.active) return;
    if (this.activeEngine) {
      for (const b of this.bots) {
        this.activeEngine.removePlayer(b.id);
      }
    }
    this.bots = [];
    this.botCounter = 0;
    this._broadcastHostMeta();
  }

  startGame(gameId = this.selectedGameId) {
    if (!this.active) return;
    const def = getGameDefinition(gameId);
    if (!def || def.status !== 'playable') return;

    this.selectedGameId = def.id;
    this.stopGameLoop();

    const roster = this.getCombinedRoster();
    const callbacks = {
      onRoundWin: (winnerId) => {
        const prev = this.winsById.get(winnerId) || 0;
        this.winsById.set(winnerId, prev + 1);
        if (def.id === 'pixel-hoops') this.lastWinnerId = winnerId;
        this._broadcastHostMeta();
      },
    };
    this.activeEngine = def.id === 'pixel-hoops'
      ? new PixelHoopsEngine(this._hoopsLineup(roster), callbacks, Math.random, { botDifficulty: this.botDifficulty })
      : new StickmanShowdownEngine(roster, callbacks);

    const startPayload = {
      type: 'game_started',
      gameId: def.id,
      config: this.activeEngine.getStaticConfig(),
    };

    this.onLocalGameStarted(startPayload);
    this.sendRelay({ type: 'relay_broadcast', payload: startPayload });
    this._broadcastHostMeta();

    this.lastTickAt = performance.now();
    this.tickTimer = setInterval(() => {
      if (!this.active || !this.activeEngine) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.lastTickAt) / 1000);
      this.lastTickAt = now;

      this.activeEngine.tick(dt);
      const state = this.activeEngine.getState();
      this.onLocalState(state);
      this.sendRelay({
        type: 'relay_broadcast',
        payload: { type: 'game_state', state },
      });
    }, 33);
  }

  /** Winner stays on court; the next player in line challenges. */
  _hoopsLineup(roster) {
    const ids = new Set(roster.map((p) => p.id));
    this.hoopsQueue = this.hoopsQueue.filter((id) => ids.has(id));
    for (const p of roster) {
      if (!this.hoopsQueue.includes(p.id)) this.hoopsQueue.push(p.id);
    }
    const champ = ids.has(this.lastWinnerId) ? this.lastWinnerId : null;
    if (champ) {
      // Rotate the line: everyone who isn't the champ moves up one spot, so
      // the loser of the last game goes to the back.
      const others = this.hoopsQueue.filter((id) => id !== champ);
      if (this._lastHoopsPair && others.length > 1) {
        const loser = this._lastHoopsPair.find((id) => id !== champ);
        const idx = others.indexOf(loser);
        if (idx >= 0) others.push(others.splice(idx, 1)[0]);
      }
      this.hoopsQueue = [champ, ...others];
    }
    this._lastHoopsPair = this.hoopsQueue.slice(0, 2);
    const byId = new Map(roster.map((p) => [p.id, p]));
    return this.hoopsQueue.map((id) => byId.get(id));
  }

  returnToLobby() {
    if (!this.active) return;
    this.stopGameLoop();
    this.activeEngine = null;
    this.onLocalReturnedLobby();
    this.sendRelay({ type: 'relay_broadcast', payload: { type: 'returned_lobby' } });
    this._broadcastHostMeta();
  }

  handleGuestInput(playerId, input) {
    if (!this.active || !this.activeEngine) return;
    this.activeEngine.handleInput(playerId, input);
  }

  stopGameLoop() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  _broadcastHostMeta() {
    const meta = {
      type: 'host_meta',
      selectedGameId: this.selectedGameId,
      botDifficulty: this.botDifficulty,
      inGame: Boolean(this.activeEngine),
      bots: this.bots,
      wins: Object.fromEntries(this.winsById.entries()),
    };
    this.onHostRosterChange(meta);
    this.sendRelay({ type: 'relay_broadcast', payload: meta });
  }
}
