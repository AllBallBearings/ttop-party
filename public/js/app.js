import { ARTracker } from './arTracker.js';
import { TouchControls } from './controls.js';
import { createClientGame } from './games/registry.js';
import { GAME_CATALOG } from './shared/gameCatalog.js';
import { HostController } from './hostController.js';
import {
  isLocalNodeHost,
  getSavedRelayUrl,
  setSavedRelayUrl,
  resolveRelayWebSocketUrl,
} from './config.js';
import { qrcode } from '../vendor/qrcode/qrcode.mjs';
import { sound } from './audio.js';

const TOKEN_KEY = 'tabletop_ar_player_token';
const NAME_KEY = 'tabletop_ar_player_name';

const els = {
  video: document.getElementById('cameraVideo'),
  canvas: document.getElementById('arCanvas'),
  playerHudBar: document.getElementById('playerHudBar'),
  arStatusDot: document.getElementById('arStatusDot'),
  arStatusText: document.getElementById('arStatusText'),
  motionBtn: document.getElementById('motionBtn'),
  lockBtn: document.getElementById('lockBtn'),
  modeBtn: document.getElementById('modeBtn'),
  menuBtn: document.getElementById('menuBtn'),
  scaleSlider: document.getElementById('scaleSlider'),
  scaleVal: document.getElementById('scaleVal'),

  lobbyModal: document.getElementById('lobbyModal'),
  closeLobbyBtn: document.getElementById('closeLobbyBtn'),
  roleBadge: document.getElementById('roleBadge'),
  relayBanner: document.getElementById('relayBanner'),
  relayInput: document.getElementById('relayInput'),
  saveRelayBtn: document.getElementById('saveRelayBtn'),
  soloModeBtn: document.getElementById('soloModeBtn'),

  nameInput: document.getElementById('nameInput'),
  saveNameBtn: document.getElementById('saveNameBtn'),
  gameGrid: document.getElementById('gameGrid'),
  rosterList: document.getElementById('rosterList'),
  hostControls: document.getElementById('hostControls'),
  guestNotice: document.getElementById('guestNotice'),
  startGameBtn: document.getElementById('startGameBtn'),
  addBotBtn: document.getElementById('addBotBtn'),
  clearBotsBtn: document.getElementById('clearBotsBtn'),

  joinQrBtn: document.getElementById('joinQrBtn'),
  joinQrModal: document.getElementById('joinQrModal'),
  closeJoinQrBtn: document.getElementById('closeJoinQrBtn'),
  joinQrBox: document.getElementById('joinQrBox'),
  joinUrlText: document.getElementById('joinUrlText'),

  roundBanner: document.getElementById('roundBanner'),
  roundBannerTitle: document.getElementById('roundBannerTitle'),
  roundBannerSub: document.getElementById('roundBannerSub'),
  roundHostActions: document.getElementById('roundHostActions'),
  nextRoundBtn: document.getElementById('nextRoundBtn'),
  backLobbyBtn: document.getElementById('backLobbyBtn'),

  touchOverlay: document.getElementById('touchOverlay'),
  stickZone: document.getElementById('stickZone'),
  stickKnob: document.getElementById('stickKnob'),
  jumpBtn: document.getElementById('jumpBtn'),
  shootBtn: document.getElementById('shootBtn'),
  shootBadge: document.getElementById('shootBadge'),
  anchorPrompt: document.getElementById('anchorPrompt'),
};

let ws = null;
let soloMode = false;
let selfPlayerId = null;
let roomKey = '';
let hostId = null;
let humanPlayers = [];
let hostMeta = {
  selectedGameId: 'stickman-showdown',
  inGame: false,
  bots: [],
  wins: {},
};

let clientGame = null;
let currentGameId = null;
let lastInputSentAt = 0;
let pendingInput = { throttle: 0, turn: 0, jump: false, shoot: false };

function sendRelay(payload) {
  if (soloMode || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function handleGameStarted(msg) {
  if (clientGame) {
    clientGame.dispose();
    clientGame = null;
  }
  currentGameId = msg.gameId;
  clientGame = createClientGame(msg.gameId, arTracker.boardRoot, msg.config, selfPlayerId);
  els.lobbyModal.classList.add('hidden');
  els.roundBanner.classList.add('hidden');
  els.touchOverlay.classList.remove('hidden');
}

function handleReturnedLobby() {
  if (clientGame) {
    clientGame.dispose();
    clientGame = null;
  }
  currentGameId = null;
  els.roundBanner.classList.add('hidden');
  els.touchOverlay.classList.add('hidden');
  els.lobbyModal.classList.remove('hidden');
}

const hostController = new HostController({
  sendRelay,
  onLocalGameStarted: (msg) => handleGameStarted(msg),
  onLocalState: (state) => handleGameState(state),
  onLocalReturnedLobby: () => handleReturnedLobby(),
  onHostRosterChange: (meta) => {
    hostMeta = meta;
    renderLobby();
  },
});

const arTracker = new ARTracker({
  videoEl: els.video,
  canvasEl: els.canvas,
  onStatus: (status) => {
    els.arStatusText.textContent = status.message;
    els.arStatusDot.className = 'status-dot ' + (
      status.mode === 'preview'
        ? 'preview'
        : status.anchored && !status.stale
          ? 'anchored'
          : 'searching'
    );
    els.modeBtn.textContent = status.mode === 'preview' ? 'AR Cam' : 'Preview';
    els.motionBtn.style.display = status.mode === 'ar' && status.needsMotionPermission ? 'inline-flex' : 'none';
    els.lockBtn.style.display = status.mode === 'ar' && status.anchored ? 'inline-flex' : 'none';
    els.lockBtn.textContent = status.locked ? 'Unlock' : 'Lock';
    els.lockBtn.classList.toggle('active', Boolean(status.locked));

    const showPrompt = status.mode === 'ar' && !status.anchored;
    els.anchorPrompt.classList.toggle('hidden', !showPrompt);
  },
});

new TouchControls({
  stickZoneEl: els.stickZone,
  stickKnobEl: els.stickKnob,
  jumpBtnEl: els.jumpBtn,
  shootBtnEl: els.shootBtn,
  onChange: (input) => {
    sound.unlock();
    pendingInput = input;
    sendInput(true);
  },
});

function isSelfHost() {
  return Boolean(soloMode || (selfPlayerId && hostId && selfPlayerId === hostId));
}

function sendInput(immediate = false) {
  if (!clientGame) return;
  const now = performance.now();
  if (!immediate && now - lastInputSentAt < 33) return;
  lastInputSentAt = now;

  const cleanInput = {
    throttle: Number(pendingInput.throttle.toFixed(3)),
    turn: Number(pendingInput.turn.toFixed(3)),
    jump: pendingInput.jump,
    shoot: pendingInput.shoot,
  };

  if (isSelfHost()) {
    hostController.handleGuestInput(selfPlayerId, cleanInput);
    return;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input', ...cleanInput }));
  }
}

function getCombinedPlayers() {
  const wins = hostMeta.wins || {};
  return [...humanPlayers, ...(hostMeta.bots || [])].map((p) => ({
    ...p,
    wins: wins[p.id] || 0,
  }));
}

function renderLobby() {
  const host = isSelfHost();
  const combined = getCombinedPlayers();
  const hostPlayer = combined.find((p) => p.isHost);

  if (soloMode) {
    els.roleBadge.textContent = 'SOLO / OFFLINE HOST';
    els.roleBadge.classList.add('is-host');
  } else if (!ws || ws.readyState !== WebSocket.OPEN) {
    els.roleBadge.textContent = resolveRelayWebSocketUrl()
      ? 'Connecting to Relay...'
      : 'Set Cloud Relay URL or Play Solo';
    els.roleBadge.classList.remove('is-host');
  } else {
    els.roleBadge.textContent = host
      ? 'YOU ARE HOST (1st on Wi-Fi)'
      : `HOST: ${hostPlayer ? hostPlayer.name : 'Connecting...'}`;
    els.roleBadge.classList.toggle('is-host', host);
  }

  const showRelayBanner = !isLocalNodeHost() && (!resolveRelayWebSocketUrl() || soloMode);
  els.relayBanner.classList.toggle('hidden', !showRelayBanner);

  els.hostControls.classList.toggle('hidden', !host);
  els.guestNotice.classList.toggle('hidden', host);
  els.closeLobbyBtn.classList.toggle('hidden', !hostMeta.inGame);

  els.gameGrid.innerHTML = '';
  for (const game of GAME_CATALOG) {
    const card = document.createElement('button');
    card.type = 'button';
    const selected = game.id === hostMeta.selectedGameId;
    const playable = game.status === 'playable';
    card.className = `game-card ${selected ? 'selected' : ''} ${playable ? '' : 'soon'}`;
    card.disabled = !playable || !host;

    card.innerHTML = `
      <div class="game-card-top">
        <span class="game-title">${game.name}</span>
        <span class="game-pill">${playable ? (selected ? 'SELECTED' : 'READY') : 'COMING SOON'}</span>
      </div>
      <div class="game-desc">${game.tagline}</div>
      ${game.controlsHint ? `<div class="game-hint">${game.controlsHint}</div>` : ''}
    `;

    if (playable && host) {
      card.addEventListener('click', () => {
        hostController.selectGame(game.id);
      });
    }
    els.gameGrid.appendChild(card);
  }

  els.rosterList.innerHTML = '';
  for (const p of combined) {
    const item = document.createElement('div');
    item.className = 'roster-item';
    const me = p.id === selfPlayerId ? ' (You)' : '';
    const botTag = p.isBot ? '<span class="tag bot">BOT</span>' : '';
    const hostTag = p.isHost ? '<span class="tag host">HOST</span>' : '';
    const offlineTag = !p.connected ? '<span class="tag offline">RECONNECTING</span>' : '';
    item.innerHTML = `
      <span class="color-dot" style="background:${p.color}"></span>
      <span class="roster-name">${p.name}${me}</span>
      ${hostTag}${botTag}${offlineTag}
      <span class="roster-wins">${p.wins} W</span>
    `;
    els.rosterList.appendChild(item);
  }

  if (!hostMeta.inGame) {
    renderHudPlayers(
      combined.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        hp: 100,
        maxHp: 100,
        alive: true,
        hasGun: false,
      }))
    );
  }
}

function renderHudPlayers(players) {
  els.playerHudBar.innerHTML = '';
  for (const p of players) {
    const card = document.createElement('div');
    card.className = `hud-player ${p.alive ? '' : 'dead'} ${p.id === selfPlayerId ? 'self' : ''}`;
    const pct = Math.max(0, Math.min(100, (p.hp / (p.maxHp || 100)) * 100));
    card.innerHTML = `
      <div class="hud-avatar" style="background:${p.color}"></div>
      <div class="hud-info">
        <div class="hud-name">${p.name}${p.hasGun ? ' 🔫' : ''}</div>
        <div class="hud-hp-track">
          <div class="hud-hp-fill" style="width:${pct}%; background:${p.color}"></div>
        </div>
      </div>
    `;
    els.playerHudBar.appendChild(card);
  }
}

function handleGameState(state) {
  if (!clientGame || state.gameId !== currentGameId) return;
  clientGame.applyState(state);
  renderHudPlayers(state.players);

  const me = state.players.find((p) => p.id === selfPlayerId);
  if (me) {
    const armed = me.hasGun && me.alive;
    els.shootBtn.classList.toggle('armed', armed);
    els.shootBtn.classList.toggle('unarmed', !armed);
    els.shootBadge.textContent = !me.alive ? 'KO' : me.hasGun ? 'FIRE' : 'GET GUN';
  }

  if (state.phase === 'round_over') {
    els.roundBanner.classList.remove('hidden');
    els.roundBannerTitle.textContent = state.winnerName
      ? `${state.winnerName} Wins!`
      : 'Draw!';
    els.roundBannerSub.textContent = isSelfHost()
      ? 'Start the next round or switch mini-games'
      : 'Waiting for Host to start next round...';
    els.roundHostActions.classList.toggle('hidden', !isSelfHost());
  } else {
    els.roundBanner.classList.add('hidden');
  }
}

function buildJoinUrl() {
  const url = new URL(location.href);
  url.search = '';
  if (roomKey) url.searchParams.set('room', roomKey);
  const savedRelay = getSavedRelayUrl();
  if (!isLocalNodeHost() && savedRelay) {
    url.searchParams.set('relay', savedRelay);
  }
  return url.toString();
}

function renderInviteQr() {
  const joinUrl = buildJoinUrl();
  const qr = qrcode(0, 'M');
  qr.addData(joinUrl);
  qr.make();
  els.joinQrBox.innerHTML = qr.createSvgTag({ scalable: true, margin: 2 });
  els.joinUrlText.textContent = joinUrl;
}

function enterSoloMode() {
  soloMode = true;
  if (ws) {
    ws.close();
    ws = null;
  }
  selfPlayerId = 'solo-p1';
  hostId = selfPlayerId;
  const savedName = localStorage.getItem(NAME_KEY) || 'Red';
  humanPlayers = [{
    id: selfPlayerId,
    name: savedName,
    color: '#ff3b30',
    connected: true,
    isHost: true,
    isBot: false,
  }];
  hostController.activate(humanPlayers);
  if (hostController.bots.length === 0) {
    hostController.addBot();
  }
  renderLobby();
}

function connectRelay() {
  const baseWsUrl = resolveRelayWebSocketUrl();
  if (!baseWsUrl) {
    renderLobby();
    return;
  }

  soloMode = false;
  const wsUrl = new URL(baseWsUrl);
  const pageParams = new URLSearchParams(location.search);
  const explicitRoom = pageParams.get('room');
  if (explicitRoom) wsUrl.searchParams.set('room', explicitRoom);

  if (ws) {
    try { ws.close(); } catch {}
  }

  ws = new WebSocket(wsUrl.toString());

  ws.addEventListener('open', () => {
    const savedToken = sessionStorage.getItem(TOKEN_KEY) || '';
    const savedName = localStorage.getItem(NAME_KEY) || '';
    if (savedName) els.nameInput.value = savedName;

    ws.send(JSON.stringify({
      type: 'hello',
      token: savedToken,
      name: savedName,
    }));
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'welcome':
        selfPlayerId = msg.playerId;
        roomKey = msg.roomKey || '';
        hostId = msg.hostId;
        sessionStorage.setItem(TOKEN_KEY, msg.token);
        if (isSelfHost()) {
          hostController.activate(humanPlayers);
        } else {
          hostController.deactivate();
        }
        renderLobby();
        break;

      case 'room_state':
        roomKey = msg.roomKey || roomKey;
        hostId = msg.hostId;
        humanPlayers = msg.players || [];
        if (isSelfHost()) {
          if (!hostController.active) hostController.activate(humanPlayers);
          else hostController.syncHumanPlayers(humanPlayers);
        } else {
          hostController.deactivate();
        }
        renderLobby();
        break;

      case 'you_are_host':
        hostId = selfPlayerId;
        hostController.activate(humanPlayers);
        renderLobby();
        break;

      case 'host_meta':
        if (!isSelfHost()) {
          hostMeta = msg;
          renderLobby();
        }
        break;

      case 'input':
        if (isSelfHost() && msg.from) {
          hostController.handleGuestInput(msg.from, msg);
        }
        break;

      case 'game_started':
        if (!isSelfHost()) handleGameStarted(msg);
        break;

      case 'game_state':
        if (!isSelfHost()) handleGameState(msg.state);
        break;

      case 'returned_lobby':
        if (!isSelfHost()) handleReturnedLobby();
        break;

      default:
        break;
    }
  });

  ws.addEventListener('close', () => {
    hostController.deactivate();
    renderLobby();
    if (!soloMode && resolveRelayWebSocketUrl()) {
      setTimeout(connectRelay, 1500);
    }
  });
}

// UI event bindings
els.saveNameBtn.addEventListener('click', () => {
  const name = els.nameInput.value.trim().slice(0, 14);
  if (!name) return;
  localStorage.setItem(NAME_KEY, name);
  if (soloMode) {
    humanPlayers[0].name = name;
    hostController.syncHumanPlayers(humanPlayers);
    renderLobby();
  } else if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'set_name', name }));
  }
});

els.saveRelayBtn.addEventListener('click', () => {
  const raw = els.relayInput.value.trim();
  if (!raw) return;
  try {
    const normalized = setSavedRelayUrl(raw);
    els.relayInput.value = normalized;
    connectRelay();
  } catch {
    alert('Please enter a valid WebSocket or HTTPS Worker URL (e.g. wss://tabletop-ar-relay.yourname.workers.dev/ws)');
  }
});

els.soloModeBtn.addEventListener('click', () => {
  enterSoloMode();
});

els.startGameBtn.addEventListener('click', () => {
  sound.unlock();
  arTracker.requestMotionPermission();
  if (isSelfHost()) hostController.startGame();
});

els.addBotBtn.addEventListener('click', () => {
  if (isSelfHost()) hostController.addBot();
});

els.clearBotsBtn.addEventListener('click', () => {
  if (isSelfHost()) hostController.clearBots();
});

els.nextRoundBtn.addEventListener('click', () => {
  sound.unlock();
  if (isSelfHost()) hostController.startGame();
});

els.backLobbyBtn.addEventListener('click', () => {
  if (isSelfHost()) hostController.returnToLobby();
});

els.motionBtn.addEventListener('click', () => {
  sound.unlock();
  arTracker.requestMotionPermission();
});

els.menuBtn.addEventListener('click', () => {
  arTracker.requestMotionPermission();
  els.lobbyModal.classList.toggle('hidden');
});

els.closeLobbyBtn.addEventListener('click', () => {
  arTracker.requestMotionPermission();
  els.lobbyModal.classList.add('hidden');
});

els.lockBtn.addEventListener('click', () => {
  arTracker.requestMotionPermission();
  arTracker.setLocked(!arTracker.locked);
});

els.modeBtn.addEventListener('click', async () => {
  await arTracker.toggleMode();
});

els.scaleSlider.addEventListener('input', () => {
  const val = Number(els.scaleSlider.value);
  els.scaleVal.textContent = `${val.toFixed(1)}x`;
  arTracker.setBoardScale(val);
});

els.joinQrBtn.addEventListener('click', () => {
  renderInviteQr();
  els.joinQrModal.classList.remove('hidden');
});

els.closeJoinQrBtn.addEventListener('click', () => {
  els.joinQrModal.classList.add('hidden');
});

setInterval(() => {
  if (
    pendingInput.throttle !== 0 ||
    pendingInput.turn !== 0 ||
    pendingInput.jump ||
    pendingInput.shoot
  ) {
    sendInput(false);
  }
}, 40);

let lastFrame = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  if (clientGame) clientGame.update(dt);
  arTracker.update(dt);
}

// Boot
els.relayInput.value = getSavedRelayUrl();
connectRelay();
arTracker.startCamera();
requestAnimationFrame(animate);
