// Tactile 3D vertical slot-machine roller control for choosing a game.
// Rolls one game at a time up or down on mouse wheel, touch/pointer drag,
// arrow keys, or chevron button taps, with bespoke SVG artwork per game.

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderGameGraphic(gameId) {
  switch (gameId) {
    case 'stickman-showdown':
      return `
        <svg viewBox="0 0 112 88" class="roller-art-svg" aria-hidden="true">
          <defs>
            <linearGradient id="sgBg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#1e293b"/>
              <stop offset="100%" stop-color="#0f172a"/>
            </linearGradient>
            <linearGradient id="sgFloor" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#334155"/>
              <stop offset="100%" stop-color="#1e293b"/>
            </linearGradient>
          </defs>
          <rect width="112" height="88" rx="14" fill="url(#sgBg)"/>
          <polygon points="8,72 56,56 104,72 56,84" fill="url(#sgFloor)" stroke="#475569" stroke-width="1.5"/>
          <!-- Destructible wooden crate barrier -->
          <rect x="47" y="45" width="18" height="17" rx="3" fill="#b45309" stroke="#451a03" stroke-width="2"/>
          <line x1="47" y1="53" x2="65" y2="53" stroke="#78350f" stroke-width="1.5"/>
          <line x1="56" y1="45" x2="56" y2="62" stroke="#78350f" stroke-width="1.5"/>
          <!-- Red clay stickman left -->
          <circle cx="28" cy="31" r="7.5" fill="#f87171" stroke="#7f1d1d" stroke-width="2"/>
          <path d="M28,39 L28,56 M28,56 L21,69 M28,56 L35,68 M28,44 L40,42" stroke="#f87171" stroke-width="4.5" stroke-linecap="round"/>
          <!-- Blaster + muzzle spark -->
          <rect x="38" y="38" width="11" height="5" rx="1.5" fill="#94a3b8" stroke="#0f172a" stroke-width="1.4"/>
          <circle cx="53" cy="39" r="4" fill="#fde047"/>
          <line x1="57" y1="38" x2="72" y2="33" stroke="#fef08a" stroke-width="2.5" stroke-dasharray="4 3" stroke-linecap="round"/>
          <!-- Blue clay stickman jumping right -->
          <circle cx="84" cy="24" r="7.5" fill="#38bdf8" stroke="#0c4a6e" stroke-width="2"/>
          <path d="M84,32 L82,48 M82,48 L75,58 M82,48 L92,56 M83,37 L72,34" stroke="#38bdf8" stroke-width="4.5" stroke-linecap="round"/>
        </svg>`;

    case 'pixel-hoops':
      return `
        <svg viewBox="0 0 112 88" class="roller-art-svg" aria-hidden="true">
          <defs>
            <linearGradient id="phSky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#1d4ed8"/>
              <stop offset="100%" stop-color="#1e1b4b"/>
            </linearGradient>
          </defs>
          <rect width="112" height="88" rx="14" fill="url(#phSky)"/>
          <!-- Hardwood half-court -->
          <rect x="6" y="56" width="100" height="26" rx="4" fill="#d97706" stroke="#78350f" stroke-width="2"/>
          <line x1="6" y1="65" x2="106" y2="65" stroke="#b45309" stroke-width="1.5"/>
          <line x1="6" y1="74" x2="106" y2="74" stroke="#b45309" stroke-width="1.5"/>
          <ellipse cx="56" cy="69" rx="22" ry="8" fill="none" stroke="#fef3c7" stroke-width="2"/>
          <!-- Backboard & rim -->
          <rect x="76" y="14" width="24" height="18" rx="2" fill="#f8fafc" stroke="#1e293b" stroke-width="2"/>
          <rect x="82" y="20" width="12" height="9" fill="none" stroke="#ef4444" stroke-width="2"/>
          <rect x="92" y="32" width="4" height="28" fill="#64748b"/>
          <line x1="72" y1="30" x2="88" y2="30" stroke="#f97316" stroke-width="3.5" stroke-linecap="round"/>
          <path d="M74,31 L77,42 M80,31 L80,42 M86,31 L83,42 M75,37 L85,37" stroke="#f8fafc" stroke-width="1.4"/>
          <!-- Pixel basketball arc -->
          <path d="M24,44 Q50,8 76,26" fill="none" stroke="#fde047" stroke-width="2" stroke-dasharray="3 3"/>
          <circle cx="54" cy="22" r="9.5" fill="#f97316" stroke="#1e293b" stroke-width="2"/>
          <path d="M45,22 L63,22 M54,13 L54,31 M48,15 Q54,22 48,29 M60,15 Q54,22 60,29" fill="none" stroke="#431407" stroke-width="1.4"/>
          <!-- 8-bit player sprite -->
          <rect x="19" y="39" width="12" height="10" rx="2" fill="#f8fafc" stroke="#0f172a" stroke-width="1.8"/>
          <rect x="18" y="49" width="14" height="14" rx="2" fill="#ef4444" stroke="#0f172a" stroke-width="1.8"/>
          <rect x="20" y="63" width="4" height="9" fill="#1e293b"/>
          <rect x="26" y="63" width="4" height="9" fill="#1e293b"/>
        </svg>`;

    case 'panda-ramen':
      return `
        <svg viewBox="0 0 112 88" class="roller-art-svg" aria-hidden="true">
          <defs>
            <linearGradient id="prSky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#38bdf8"/>
              <stop offset="65%" stop-color="#7dd3fc"/>
              <stop offset="100%" stop-color="#5a8f34"/>
            </linearGradient>
          </defs>
          <rect width="112" height="88" rx="14" fill="url(#prSky)"/>
          <!-- Towering cliffs & waterfall -->
          <polygon points="4,72 18,16 32,72" fill="#6b7068"/>
          <polygon points="24,22 38,22 42,72 20,72" fill="#38bdf8"/>
          <line x1="28" y1="24" x2="27" y2="66" stroke="#e0f2fe" stroke-width="2" stroke-dasharray="6 4"/>
          <line x1="34" y1="28" x2="35" y2="68" stroke="#e0f2fe" stroke-width="2" stroke-dasharray="5 5"/>
          <polygon points="36,72 48,24 62,72" fill="#7c8076"/>
          <!-- Green valley hill -->
          <ellipse cx="62" cy="76" rx="56" ry="20" fill="#76a03b"/>
          <!-- Fat-and-happy panda -->
          <circle cx="57" cy="57" r="16" fill="#f5efe2" stroke="#1f2937" stroke-width="2"/>
          <ellipse cx="57" cy="49" rx="15" ry="5.5" fill="#25242b"/>
          <circle cx="57" cy="36" r="12" fill="#f5efe2" stroke="#1f2937" stroke-width="2"/>
          <circle cx="47" cy="26" r="4.5" fill="#25242b"/>
          <circle cx="67" cy="26" r="4.5" fill="#25242b"/>
          <ellipse cx="52.5" cy="36" rx="3.4" ry="2.6" fill="#25242b"/>
          <ellipse cx="61.5" cy="36" rx="3.4" ry="2.6" fill="#25242b"/>
          <circle cx="52.5" cy="35.5" r="1.1" fill="#ffffff"/>
          <circle cx="61.5" cy="35.5" r="1.1" fill="#ffffff"/>
          <ellipse cx="57" cy="39.5" rx="2.3" ry="1.6" fill="#25242b"/>
          <path d="M54,42 Q57,44.5 60,42" fill="none" stroke="#25242b" stroke-width="1.5" stroke-linecap="round"/>
          <!-- Whimsical polka-dot rocket launcher -->
          <g transform="translate(76, 42) rotate(-22)">
            <rect x="-12" y="-5" width="22" height="10" rx="2" fill="#6f873f" stroke="#111827" stroke-width="1.8"/>
            <ellipse cx="14" cy="0" rx="7" ry="5.5" fill="#d95397" stroke="#111827" stroke-width="1.8"/>
            <circle cx="13" cy="-1.5" r="1.6" fill="#f7e231"/>
            <circle cx="16" cy="2" r="1.3" fill="#f7e231"/>
          </g>
          <!-- Steaming red ramen bowl -->
          <path d="M74,66 Q76,78 88,78 Q100,78 102,66 Z" fill="#d43f33" stroke="#111827" stroke-width="1.8"/>
          <ellipse cx="88" cy="66" rx="14" ry="4" fill="#f5d565" stroke="#111827" stroke-width="1.5"/>
          <line x1="88" y1="64" x2="104" y2="54" stroke="#92400e" stroke-width="2" stroke-linecap="round"/>
          <path d="M83,59 Q81,54 84,51 M90,58 Q88,53 91,50" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`;

    case 'sumo-bumper':
      return `
        <svg viewBox="0 0 112 88" class="roller-art-svg" aria-hidden="true">
          <rect width="112" height="88" rx="14" fill="#1e1b2e"/>
          <ellipse cx="56" cy="58" rx="42" ry="18" fill="#d6b47c" stroke="#92400e" stroke-width="3"/>
          <ellipse cx="56" cy="58" rx="34" ry="13" fill="none" stroke="#fef3c7" stroke-width="2.5" stroke-dasharray="6 4"/>
          <circle cx="40" cy="46" r="11" fill="#fb7185" stroke="#881337" stroke-width="2"/>
          <circle cx="40" cy="34" r="6" fill="#fda4af" stroke="#881337" stroke-width="1.8"/>
          <circle cx="72" cy="46" r="11" fill="#60a5fa" stroke="#1e3a8a" stroke-width="2"/>
          <circle cx="72" cy="34" r="6" fill="#93c5fd" stroke="#1e3a8a" stroke-width="1.8"/>
          <path d="M51,44 L61,44 M56,39 L56,49" stroke="#fde047" stroke-width="3" stroke-linecap="round"/>
        </svg>`;

    case 'king-of-qr':
      return `
        <svg viewBox="0 0 112 88" class="roller-art-svg" aria-hidden="true">
          <rect width="112" height="88" rx="14" fill="#0f172a"/>
          <!-- Glowing QR pedestal -->
          <rect x="34" y="42" width="44" height="36" rx="6" fill="#f8fafc" stroke="#38bdf8" stroke-width="2.5"/>
          <rect x="40" y="48" width="10" height="10" fill="#0f172a"/>
          <rect x="62" y="48" width="10" height="10" fill="#0f172a"/>
          <rect x="40" y="62" width="10" height="10" fill="#0f172a"/>
          <rect x="54" y="55" width="6" height="6" fill="#0f172a"/>
          <rect x="63" y="63" width="8" height="8" fill="#0f172a"/>
          <!-- Golden crown -->
          <polygon points="36,36 42,16 56,28 70,16 76,36" fill="#facc15" stroke="#854d0e" stroke-width="2" stroke-linejoin="round"/>
          <circle cx="42" cy="14" r="3" fill="#fef08a"/>
          <circle cx="56" cy="12" r="3.5" fill="#fef08a"/>
          <circle cx="70" cy="14" r="3" fill="#fef08a"/>
        </svg>`;

    default:
      return `<svg viewBox="0 0 112 88" class="roller-art-svg" aria-hidden="true"><rect width="112" height="88" rx="14" fill="#1e293b"/></svg>`;
  }
}

export class GameRoller {
  constructor({ containerEl, games, initialGameId, canControl = true, onSelect, onTick }) {
    this.containerEl = containerEl;
    this.games = games || [];
    this.canControl = Boolean(canControl);
    this.onSelect = onSelect || (() => {});
    this.onTick = onTick || (() => {});

    const initIdx = Math.max(0, this.games.findIndex((g) => g.id === initialGameId));
    this.targetIndex = initIdx;
    this.visualOffset = initIdx;
    this.lastTickIndex = initIdx;

    this.dragging = false;
    this.dragStartY = 0;
    this.dragStartOffset = initIdx;
    this.dragStartTime = 0;
    this.wheelLockUntil = 0;
    this.wheelAccum = 0;
    this.rafId = 0;

    this._buildDom();
    this._bindEvents();
    this._renderPositions();
  }

  get currentGame() {
    return this.games[this.targetIndex] || this.games[0] || null;
  }

  _buildDom() {
    this.containerEl.innerHTML = '';
    const shell = document.createElement('div');
    shell.className = 'game-roller';
    shell.setAttribute('role', 'listbox');
    shell.setAttribute('aria-label', 'Choose a game');
    shell.tabIndex = 0;

    shell.innerHTML = `
      <button type="button" class="roller-nudge roller-nudge-up" aria-label="Previous game">▲</button>
      <div class="roller-viewport">
        <div class="roller-drum"></div>
        <div class="roller-window" aria-hidden="true">
          <span class="roller-pointer left">▸</span>
          <span class="roller-pointer right">◂</span>
        </div>
        <div class="roller-fade roller-fade-top" aria-hidden="true"></div>
        <div class="roller-fade roller-fade-bottom" aria-hidden="true"></div>
      </div>
      <button type="button" class="roller-nudge roller-nudge-down" aria-label="Next game">▼</button>
      <div class="roller-meta">
        <div class="roller-dots" aria-hidden="true"></div>
        <span class="roller-hint-text">Scroll or swipe to roll</span>
      </div>
    `;

    this.shell = shell;
    this.upBtn = shell.querySelector('.roller-nudge-up');
    this.downBtn = shell.querySelector('.roller-nudge-down');
    this.viewport = shell.querySelector('.roller-viewport');
    this.drum = shell.querySelector('.roller-drum');
    this.dotsEl = shell.querySelector('.roller-dots');
    this.hintEl = shell.querySelector('.roller-hint-text');

    this.itemEls = this.games.map((g, idx) => {
      const item = document.createElement('div');
      item.className = `roller-item ${g.status === 'playable' ? 'playable' : 'soon'}`;
      item.setAttribute('role', 'option');
      item.dataset.index = String(idx);
      item.dataset.gameId = g.id;
      const pillText = g.status === 'playable' ? 'PLAYABLE' : 'COMING SOON';
      item.innerHTML = `
        <div class="roller-art">${renderGameGraphic(g.id)}</div>
        <div class="roller-copy">
          <div class="roller-title-row">
            <span class="roller-title">${escapeHtml(g.name)}</span>
            <span class="roller-pill ${g.status === 'playable' ? 'ready' : 'soon'}">${pillText}</span>
          </div>
          <div class="roller-desc">${escapeHtml(g.tagline)}</div>
          ${g.controlsHint ? `<div class="roller-controls">${escapeHtml(g.controlsHint)}</div>` : ''}
        </div>
      `;
      item.addEventListener('click', () => {
        if (!this.canControl) return;
        if (idx !== this.targetIndex) {
          this.rollTo(idx, { emit: true });
        }
      });
      this.drum.appendChild(item);
      return item;
    });

    this.dotEls = this.games.map((g, idx) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'roller-dot';
      dot.setAttribute('aria-label', g.name);
      dot.addEventListener('click', () => {
        if (!this.canControl) return;
        this.rollTo(idx, { emit: true });
      });
      this.dotsEl.appendChild(dot);
      return dot;
    });

    this.containerEl.appendChild(shell);
    this._syncControlState();
  }

  _bindEvents() {
    this.upBtn.addEventListener('click', () => {
      if (!this.canControl) return;
      this.step(-1);
    });
    this.downBtn.addEventListener('click', () => {
      if (!this.canControl) return;
      this.step(1);
    });

    this.shell.addEventListener('keydown', (e) => {
      if (!this.canControl) return;
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        this.step(-1);
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        e.preventDefault();
        this.step(1);
      }
    });

    // Mouse wheel / trackpad scroll: roll strictly ONE choice per gesture!
    this.viewport.addEventListener('wheel', (e) => {
      if (!this.canControl) return;
      e.preventDefault();
      const now = performance.now();
      if (now < this.wheelLockUntil) return;
      this.wheelAccum += e.deltaY;
      if (Math.abs(this.wheelAccum) < 16) return;
      const dir = this.wheelAccum > 0 ? 1 : -1;
      this.wheelAccum = 0;
      this.wheelLockUntil = now + 190;
      this.step(dir);
    }, { passive: false });

    // Touch / pointer drag on the slot drum
    const ITEM_STEP_PX = 104;
    this.viewport.addEventListener('pointerdown', (e) => {
      if (!this.canControl) return;
      this.dragging = true;
      this.dragStartY = e.clientY;
      this.dragStartOffset = this.visualOffset;
      this.dragStartTime = performance.now();
      this.viewport.setPointerCapture(e.pointerId);
      this.viewport.classList.add('dragging');
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
    });

    this.viewport.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dy = e.clientY - this.dragStartY;
      let raw = this.dragStartOffset - dy / ITEM_STEP_PX;
      const maxIdx = Math.max(0, this.games.length - 1);
      // Soft rubber-band resistance past ends of drum
      if (raw < 0) raw *= 0.28;
      else if (raw > maxIdx) raw = maxIdx + (raw - maxIdx) * 0.28;
      this.visualOffset = raw;

      const nearest = Math.max(0, Math.min(maxIdx, Math.round(raw)));
      if (nearest !== this.lastTickIndex) {
        this.lastTickIndex = nearest;
        this.onTick();
      }
      this._renderPositions();
    });

    const endDrag = (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.viewport.classList.remove('dragging');
      const dy = e.clientY - this.dragStartY;
      const dt = Math.max(16, performance.now() - this.dragStartTime);
      const velocity = -dy / dt; // positive = scroll down to next item
      const maxIdx = Math.max(0, this.games.length - 1);

      let nextIdx = Math.round(this.visualOffset);
      // Crisp 1-step snap when user makes a quick flick even if drag distance was short
      if (nextIdx === this.targetIndex && Math.abs(dy) > 18) {
        nextIdx = this.targetIndex + (dy < 0 ? 1 : -1);
      } else if (Math.abs(velocity) > 0.7 && Math.abs(nextIdx - this.targetIndex) === 0) {
        nextIdx = this.targetIndex + (velocity > 0 ? 1 : -1);
      }
      // Keep rolling controlled to at most 1 notch per short swipe (up to 2 on a big drag)
      const maxStep = Math.abs(dy) > ITEM_STEP_PX * 1.45 ? 2 : 1;
      const clampedStep = Math.max(-maxStep, Math.min(maxStep, nextIdx - this.targetIndex));
      const finalIdx = Math.max(0, Math.min(maxIdx, this.targetIndex + clampedStep));
      this.rollTo(finalIdx, { emit: true });
    };

    this.viewport.addEventListener('pointerup', endDrag);
    this.viewport.addEventListener('pointercancel', endDrag);
  }

  setCanControl(canControl) {
    this.canControl = Boolean(canControl);
    this._syncControlState();
  }

  _syncControlState() {
    const maxIdx = Math.max(0, this.games.length - 1);
    this.shell.classList.toggle('readonly', !this.canControl);
    this.upBtn.disabled = !this.canControl || this.targetIndex <= 0;
    this.downBtn.disabled = !this.canControl || this.targetIndex >= maxIdx;
    this.hintEl.textContent = this.canControl
      ? 'Scroll, swipe, or tap ▲▼ to roll'
      : 'Host controls the game wheel';
  }

  step(delta) {
    const maxIdx = Math.max(0, this.games.length - 1);
    const next = Math.max(0, Math.min(maxIdx, this.targetIndex + delta));
    if (next === this.targetIndex) return;
    this.rollTo(next, { emit: true });
  }

  setSelectedId(gameId, { animate = true } = {}) {
    const idx = this.games.findIndex((g) => g.id === gameId);
    if (idx < 0) return;
    if (idx === this.targetIndex && Math.abs(this.visualOffset - idx) < 0.01) {
      this._syncControlState();
      return;
    }
    this.rollTo(idx, { emit: false, animate });
  }

  rollTo(index, { emit = true, animate = true } = {}) {
    const maxIdx = Math.max(0, this.games.length - 1);
    const clamped = Math.max(0, Math.min(maxIdx, index));
    const changed = clamped !== this.targetIndex;
    this.targetIndex = clamped;
    this._syncControlState();

    if (changed && emit) {
      this.onTick();
      this.onSelect(this.games[clamped]);
    }

    if (!animate) {
      this.visualOffset = clamped;
      this.lastTickIndex = clamped;
      this._renderPositions();
      return;
    }
    this._startSnapAnimation();
  }

  _startSnapAnimation() {
    if (this.rafId) return;
    let lastNow = performance.now();
    const tick = (now) => {
      if (this.dragging) {
        this.rafId = 0;
        return;
      }
      const dt = Math.min(0.08, Math.max(0.004, (now - lastNow) / 1000));
      lastNow = now;
      const diff = this.targetIndex - this.visualOffset;
      if (Math.abs(diff) < 0.004) {
        this.visualOffset = this.targetIndex;
        this.lastTickIndex = this.targetIndex;
        this._renderPositions();
        this.rafId = 0;
        return;
      }
      const alpha = 1 - Math.exp(-16 * dt);
      this.visualOffset += diff * alpha;
      this._renderPositions();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  _renderPositions() {
    const STEP_Y = 98;
    const activeIdx = this.targetIndex;
    this.itemEls.forEach((el, idx) => {
      const delta = idx - this.visualOffset;
      const absD = Math.abs(delta);
      const visible = absD <= 1.75;
      el.style.visibility = visible ? 'visible' : 'hidden';
      if (!visible) return;

      // Cylindrical slot-wheel 3D curve
      const y = delta * STEP_Y;
      const rotX = -delta * 28;
      const scale = Math.max(0.76, 1 - absD * 0.14);
      const opacity = Math.max(0, 1 - absD * 0.56);
      el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0) rotateX(${rotX.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
      el.style.opacity = opacity.toFixed(3);
      el.style.zIndex = String(10 - Math.round(absD * 4));
      const isCenter = idx === activeIdx && absD < 0.35;
      el.classList.toggle('active', isCenter);
      el.setAttribute('aria-selected', String(idx === activeIdx));
    });

    this.dotEls.forEach((dot, idx) => {
      dot.classList.toggle('active', idx === activeIdx);
    });
  }
}
