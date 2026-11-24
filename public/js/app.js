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
import {
  installZoomGuard,
  isFullscreenSupported,
  isFullscreen,
  enterFullscreen,
  exitFullscreen,
  onFullscreenChange,
  isStandaloneApp,
  isIOS,
} from './viewportGuard.js';

const TOKEN_KEY = 'tabletop_ar_player_token';
const NAME_KEY = 'tabletop_ar_player_name';
const BOT_DIFFICULTY_KEY = 'tabletop_ar_bot_difficulty';

const els = {
  video: document.getElementById('cameraVideo'),
  canvas: document.getElementById('arCanvas'),
  playerHudBar: document.getElementById('playerHudBar'),
  arStatusDot: document.getElementById('arStatusDot'),
  arStatusText: document.getElementById('arStatusText'),
  motionBtn: document.getElementById('motionBtn'),
  replaceBtn: document.getElementById('replaceBtn'),
  modeBtn: document.getElementById('modeBtn'),
  menuBtn: document.getElementById('menuBtn'),
  fullscreenBtn: document.getElementById('fullscreenBtn'),
  lobbyFullscreenBtn: document.getElementById('lobbyFullscreenBtn'),
  homeScreenTip: document.getElementById('homeScreenTip'),
  homeScreenTipClose: document.getElementById('homeScreenTipClose'),
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
  difficultySection: document.getElementById('difficultySection'),
  difficultyGroup: document.getElementById('difficultyGroup'),
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
  promptMotionBtn: document.getElementById('promptMotionBtn'),
  placeConfirmBar: document.getElementById('placeConfirmBar'),
  placeConfirmText: document.getElementById('placeConfirmText'),
  confirmPlayBtn: document.getElementById('confirmPlayBtn'),
  adjustBoardBtn: document.getElementById('adjustBoardBtn'),
};

const savedBotDifficulty = (() => {
  try {
    return localStorage.getItem(BOT_DIFFICULTY_KEY) || 'medium';
  } catch {
    return 'medium';
  }
})();

let ws = null;
let soloMode = false;
let selfPlayerId = null;
let roomKey = '';
let hostId = null;
let humanPlayers = [];
let hostMeta = {
  selectedGameId: 'stickman-showdown',
  botDifficulty: savedBotDifficulty,
  inGame: false,
  bots: [],
  wins: {},
};

let clientGame = null;
let currentGameId = null;
let lastInputSentAt = 0;
let pendingInput = { x: 0, y: 0, jump: false, shoot: false };

// Camera-relative movement: "up" on the stick always means away from this
// player across the board, wherever they stand. The view direction is
// smoothed so hand shake doesn't wobble the character.
let viewYaw = null; // board-space angle of "away from me": atan2(x, z)
const VIEW_SMOOTHING = 10; // 1/s

function updateViewYaw(dt) {
  const basis = arTracker.getBoardViewBasis();
  if (!basis) return;
  const target = Math.atan2(basis.forward[0], basis.forward[1]);
  if (viewYaw === null) {
    viewYaw = target;
    return;
  }
  let diff = target - viewYaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  viewYaw += diff * Math.min(1, dt * VIEW_SMOOTHING);
}

/** Stick (x right, y away) -> board-space direction for this player's view. */
function stickToBoard(x, y) {
  // Before the board is placed, "away" defaults to the board's far side (-Z).
  const yaw = viewYaw ?? Math.PI;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // Right = forward x up on a y-up board.
  const rx = -fz;
  const rz = fx;
  return { moveX: x * rx + y * fx, moveZ: x * rz + y * fz };
}

function sendRelay(payload) {
  if (soloMode || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function needsArPlacement() {
  return arTracker.mode === 'ar' && (!arTracker.anchor || !arTracker.locked);
}

function syncPlayUi() {
  const lobbyOpen = !els.lobbyModal.classList.contains('hidden');
  const inAr = arTracker.mode === 'ar';
  const placedUnpinned = inAr && Boolean(arTracker.anchor) && !arTracker.locked;

  // Show confirmation bar right after placing/moving the AR board.
  const showConfirm = !lobbyOpen && placedUnpinned;
  els.placeConfirmBar.classList.toggle('hidden', !showConfirm);
  if (showConfirm) {
    if (clientGame) {
      const midRound = Boolean(hostController.activeEngine && hostController.activeEngine.roundTime > 0.15);
      els.confirmPlayBtn.textContent = isSelfHost()
        ? (midRound ? 'Resume Game' : 'Start Game')
        : 'Play Here';
      els.placeConfirmText.textContent = 'Board placed! Tap table to adjust, or tap below to play.';
    } else {
      els.confirmPlayBtn.textContent = 'Choose a Game';
      els.placeConfirmText.textContent = 'Board placed! Pin it here and pick a game to play.';
    }
  }

  // Only show touch controls when a game is active, lobby is closed, and board is ready.
  const readyToPlay = Boolean(clientGame) && !lobbyOpen && (!inAr || arTracker.locked);
  els.touchOverlay.classList.toggle('hidden', !readyToPlay);
}

function handleGameStarted(msg) {
  if (clientGame) {
    clientGame.dispose();
    clientGame = null;
  }
  currentGameId = msg.gameId;
  clientGame = createClientGame(msg.gameId, arTracker.boardRoot, msg.config, selfPlayerId, {
    sendAction: (extra) => sendGameAction(extra),
  });
  arTracker.setPreviewDist(clientGame?.preferredPreviewDist || 13.5);
  els.touchOverlay.classList.toggle('panda-ramen-active', msg.gameId === 'panda-ramen');
  resetActionButtons();
  els.lobbyModal.classList.add('hidden');
  els.roundBanner.classList.add('hidden');
  syncPlayUi();
  maybeShowHomeScreenTip();
}

function handleReturnedLobby() {
  if (clientGame) {
    clientGame.dispose();
    clientGame = null;
  }
  currentGameId = null;
  arTracker.setPreviewDist(13.5);
  els.touchOverlay.classList.remove('panda-ramen-active');
  els.roundBanner.classList.add('hidden');
  els.lobbyModal.classList.remove('hidden');
  syncPlayUi();
}

const hostController = new HostController({
  sendRelay,
  initialBotDifficulty: savedBotDifficulty,
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
    els.modeBtn.textContent = status.mode === 'preview' ? 'AR Cam' : '3D View';
    els.motionBtn.style.display = status.mode === 'ar' && status.needsMotionPermission ? 'inline-flex' : 'none';
    els.promptMotionBtn.classList.toggle('hidden', !(status.mode === 'ar' && status.needsMotionPermission));
    els.replaceBtn.style.display = status.mode === 'ar' && status.anchored ? 'inline-flex' : 'none';

    const showPrompt = status.mode === 'ar' && !status.anchored;
    els.anchorPrompt.classList.toggle('hidden', !showPrompt);
    // If switching into 3D View while paused for AR placement, auto-resume!
    if (status.mode === 'preview' && isSelfHost() && hostController.paused) {
      hostController.setPaused(false);
    }
    syncPlayUi();
  },
});

// Inspection hook for automated tests and on-device debugging (?debug).
const DEBUG = new URLSearchParams(location.search).has('debug');
if (DEBUG) window.__tabletop = { arTracker };

// ?debug also shows a small live readout of what the tracker believes, so a
// problem on a real phone can be described with numbers.
let debugEl = null;
function updateDebugReadout() {
  if (!DEBUG) return;
  if (!debugEl) {
    debugEl = document.createElement('pre');
    Object.assign(debugEl.style, {
      position: 'fixed', left: '8px', top: '72px', zIndex: '60', margin: '0', padding: '6px 8px',
      background: 'rgba(2,6,23,0.8)', color: '#a5f3fc', font: '11px/1.35 ui-monospace, monospace',
      borderRadius: '8px', pointerEvents: 'none', whiteSpace: 'pre',
    });
    document.body.appendChild(debugEl);
  }
  const e = arTracker.engine;
  const fs = e.frameState;
  const a = arTracker.anchor;
  const cm = (m) => `${(m * 100).toFixed(1)} cm`;
  const lines = [
    `mode     ${arTracker.mode}  ${e.trackingStatus}/${e.trackingReason}`,
    `anchor   ${arTracker.anchorSource || 'none'}${arTracker.markerVisible ? ' (QR in view)' : ''}`,
    `imu      ${e.imu?.available ? 'on' : 'OFF'}   cam ${e.capW}x${e.capH}  f480 ${Number(e.focal480 || 0).toFixed(0)}`,
    `cam h    ${cm(e.opts.cameraHeight)} (world scale)`,
  ];
  if (fs?.pose) {
    const t = fs.pose.t;
    lines.push(`cam pos  ${t.map((v) => (v * 100).toFixed(0)).join(', ')} cm`);
    if (a) lines.push(`to board ${cm(Math.hypot(t[0] - a.position[0], t[1] - a.position[1], t[2] - a.position[2]))}`);
  }
  debugEl.textContent = lines.join('\n');
}

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

  const move = stickToBoard(pendingInput.x, pendingInput.y);
  const cleanInput = {
    moveX: Number(move.moveX.toFixed(3)),
    moveZ: Number(move.moveZ.toFixed(3)),
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

function sendGameAction(extra) {
  if (!clientGame || !extra) return;
  if (isSelfHost()) {
    hostController.handleGuestInput(selfPlayerId, extra);
    return;
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input', ...extra }));
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

  const activeDiff = hostMeta.botDifficulty || 'medium';
  const hasDifficulty = hostMeta.selectedGameId === 'pixel-hoops' || hostMeta.selectedGameId === 'panda-ramen';
  els.difficultySection.classList.toggle('hidden', !hasDifficulty);
  for (const btn of els.difficultyGroup.querySelectorAll('.diff-btn')) {
    const level = btn.dataset.difficulty;
    btn.classList.toggle('active', level === activeDiff);
    btn.disabled = !host;
  }

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

const DEFAULT_BUTTON_UI = {
  jump: { icon: '⏫', label: 'JUMP' },
  shoot: { icon: '🎯', label: 'SHOOT' },
};

function setActionButton(btn, icon, label) {
  const iconEl = btn.querySelector('.btn-icon');
  const labelEl = btn.querySelector('.btn-label');
  if (iconEl && iconEl.textContent !== icon) iconEl.textContent = icon;
  if (labelEl && labelEl.textContent !== label) labelEl.textContent = label;
}

function resetActionButtons() {
  setActionButton(els.jumpBtn, DEFAULT_BUTTON_UI.jump.icon, DEFAULT_BUTTON_UI.jump.label);
  setActionButton(els.shootBtn, DEFAULT_BUTTON_UI.shoot.icon, DEFAULT_BUTTON_UI.shoot.label);
}

function handleGameState(state) {
  if (!clientGame || state.gameId !== currentGameId) return;
  clientGame.applyState(state);

  // Games can supply their own HUD rows and button labels.
  if (clientGame.getHudPlayers) {
    renderHudPlayers(clientGame.getHudPlayers(state));
    const labels = clientGame.controlLabels || {};
    const icons = { JUKE: '💨', BLOCK: '✋', SHOOT: '🏀', STEAL: '🫳' };
    setActionButton(els.jumpBtn, labels.jumpIcon || icons[labels.jump] || '·', labels.jump || '');
    setActionButton(els.shootBtn, labels.shootIcon || icons[labels.shoot] || '·', labels.shoot || '');
    els.shootBtn.classList.toggle('armed', Boolean(labels.armed));
    els.shootBtn.classList.toggle('unarmed', !labels.armed);
    els.shootBadge.textContent = labels.badge || '';
  } else {
    renderHudPlayers(state.players);
  }

  const me = !clientGame.getHudPlayers && state.players.find((p) => p.id === selfPlayerId);
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
    if (soloMode) return;
    hostController.deactivate();
    renderLobby();
    if (resolveRelayWebSocketUrl()) {
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

// ---- Full screen ----
// The game goes full screen when a match starts (needs a tap, so it happens on
// Start Match / Next Round, or a guest's first touch on the controls). If the
// player leaves full screen with the small button, we stop forcing it back.
let fullscreenOptOut = false;
const HOME_TIP_KEY = 'tabletop_ar_home_tip_seen';

function autoFullscreen() {
  if (!fullscreenOptOut) enterFullscreen();
}

function updateFullscreenBtns() {
  const on = isFullscreen();
  const label = on ? 'Exit Full' : 'Fullscreen';
  for (const btn of [els.fullscreenBtn, els.lobbyFullscreenBtn]) {
    if (!btn) continue;
    btn.textContent = label;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Enter fullscreen');
    btn.title = on ? 'Exit fullscreen' : 'Enter fullscreen';
  }
}

function showHomeScreenTip(force = false) {
  if (!force) {
    if (isFullscreenSupported() || isStandaloneApp() || !isIOS()) return;
    try {
      if (localStorage.getItem(HOME_TIP_KEY)) return;
      localStorage.setItem(HOME_TIP_KEY, '1');
    } catch { /* storage unavailable: still show once this session */ }
  }
  els.homeScreenTip.classList.remove('hidden');
  clearTimeout(showHomeScreenTip._t);
  showHomeScreenTip._t = setTimeout(() => els.homeScreenTip.classList.add('hidden'), 9000);
}

function maybeShowHomeScreenTip() {
  showHomeScreenTip(false);
}

async function toggleFullscreen() {
  if (isFullscreenSupported()) {
    if (isFullscreen()) {
      fullscreenOptOut = true;
      await exitFullscreen();
    } else {
      fullscreenOptOut = false;
      const ok = await enterFullscreen();
      if (!ok) showHomeScreenTip(true);
    }
    updateFullscreenBtns();
  } else {
    // iOS Safari/Chrome blocks the Fullscreen API; nudge scroll & show Home Screen tip.
    window.scrollTo(0, 1);
    showHomeScreenTip(true);
  }
}

if (isStandaloneApp()) {
  els.fullscreenBtn.style.display = 'none';
  if (els.lobbyFullscreenBtn) els.lobbyFullscreenBtn.style.display = 'none';
} else {
  updateFullscreenBtns();
  onFullscreenChange(updateFullscreenBtns);
  els.fullscreenBtn.addEventListener('click', toggleFullscreen);
  if (els.lobbyFullscreenBtn) els.lobbyFullscreenBtn.addEventListener('click', toggleFullscreen);
  if (isFullscreenSupported()) {
    // Guests get the match start over the network (no tap), so go full screen
    // on their first touch of the game controls.
    els.touchOverlay.addEventListener('pointerdown', () => {
      if (!isFullscreen()) autoFullscreen();
    }, true);
  }
}

els.homeScreenTipClose.addEventListener('click', () => {
  els.homeScreenTip.classList.add('hidden');
});

installZoomGuard();

els.startGameBtn.addEventListener('click', () => {
  autoFullscreen();
  sound.unlock();
  arTracker.requestMotionPermission();
  if (isSelfHost()) {
    hostController.startGame(undefined, { startPaused: needsArPlacement() });
  }
});

els.addBotBtn.addEventListener('click', () => {
  if (isSelfHost()) hostController.addBot();
});

els.clearBotsBtn.addEventListener('click', () => {
  if (isSelfHost()) hostController.clearBots();
});

els.difficultyGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('.diff-btn');
  if (!btn || !isSelfHost()) return;
  const level = btn.dataset.difficulty;
  if (!level) return;
  try { localStorage.setItem(BOT_DIFFICULTY_KEY, level); } catch {}
  hostMeta = { ...hostMeta, botDifficulty: level };
  hostController.setBotDifficulty(level);
  renderLobby();
});

els.nextRoundBtn.addEventListener('click', () => {
  autoFullscreen();
  sound.unlock();
  if (isSelfHost()) {
    hostController.startGame(undefined, { startPaused: needsArPlacement() });
  }
});

els.backLobbyBtn.addEventListener('click', () => {
  if (isSelfHost()) hostController.returnToLobby();
});

els.motionBtn.addEventListener('click', () => {
  sound.unlock();
  arTracker.requestMotionPermission();
});

els.promptMotionBtn.addEventListener('click', () => {
  sound.unlock();
  arTracker.requestMotionPermission();
});

els.menuBtn.addEventListener('click', () => {
  arTracker.requestMotionPermission();
  els.lobbyModal.classList.toggle('hidden');
  syncPlayUi();
});

els.closeLobbyBtn.addEventListener('click', () => {
  arTracker.requestMotionPermission();
  els.lobbyModal.classList.add('hidden');
  syncPlayUi();
});

function beginMoveBoard() {
  arTracker.requestMotionPermission();
  if (isSelfHost() && hostController.activeEngine) {
    hostController.setPaused(true);
  }
  arTracker.replaceBoard();
  syncPlayUi();
}

els.replaceBtn.addEventListener('click', beginMoveBoard);
els.adjustBoardBtn.addEventListener('click', beginMoveBoard);

els.confirmPlayBtn.addEventListener('click', () => {
  autoFullscreen();
  sound.unlock();
  arTracker.requestMotionPermission();
  arTracker.setLocked(true);
  if (!clientGame) {
    els.lobbyModal.classList.remove('hidden');
  } else if (isSelfHost()) {
    hostController.setPaused(false);
  }
  syncPlayUi();
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
    pendingInput.x !== 0 ||
    pendingInput.y !== 0 ||
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
  updateViewYaw(dt);
  if (DEBUG && now - (updateDebugReadout.last || 0) > 200) {
    updateDebugReadout.last = now;
    updateDebugReadout();
  }
}

// Boot
els.relayInput.value = getSavedRelayUrl();
connectRelay();
arTracker.startCamera();
requestAnimationFrame(animate);
