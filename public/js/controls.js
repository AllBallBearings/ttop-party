export class TouchControls {
  constructor({ stickZoneEl, stickKnobEl, jumpBtnEl, shootBtnEl, onChange }) {
    this.stickZoneEl = stickZoneEl;
    this.stickKnobEl = stickKnobEl;
    this.jumpBtnEl = jumpBtnEl;
    this.shootBtnEl = shootBtnEl;
    this.onChange = onChange || (() => {});

    this.state = {
      throttle: 0,
      turn: 0,
      jump: false,
      shoot: false,
    };

    this.stickPointerId = null;
    this.stickOrigin = { x: 0, y: 0 };
    this.maxRadius = 46;

    this.jumpPointers = new Set();
    this.shootPointers = new Set();
    this.keys = new Set();

    this._bindStick();
    this._bindButtons();
    this._bindKeyboard();
  }

  _emit() {
    this.onChange({ ...this.state });
  }

  _updateStickFromPointer(clientX, clientY) {
    const dx = clientX - this.stickOrigin.x;
    const dy = clientY - this.stickOrigin.y;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, this.maxRadius);
    const angle = Math.atan2(dy, dx);

    const knobX = Math.cos(angle) * clamped;
    const knobY = Math.sin(angle) * clamped;
    this.stickKnobEl.style.transform = `translate3d(${knobX}px, ${knobY}px, 0)`;

    let normX = knobX / this.maxRadius;
    // Screen Y down is positive, so pushing UP (dy < 0) means forward (+1)
    let normY = -knobY / this.maxRadius;

    const deadzone = 0.14;
    if (Math.abs(normX) < deadzone) normX = 0;
    else normX = (normX - Math.sign(normX) * deadzone) / (1 - deadzone);

    if (Math.abs(normY) < deadzone) normY = 0;
    else normY = (normY - Math.sign(normY) * deadzone) / (1 - deadzone);

    this.state.turn = Math.max(-1, Math.min(1, normX));
    this.state.throttle = Math.max(-1, Math.min(1, normY));
    this._emit();
  }

  _resetStick() {
    this.stickPointerId = null;
    this.stickKnobEl.style.transform = 'translate3d(0px, 0px, 0)';
    this.stickZoneEl.classList.remove('active');
    this.state.turn = 0;
    this.state.throttle = 0;
    this._syncKeyboard();
  }

  _bindStick() {
    this.stickZoneEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.stickPointerId !== null) return;
      this.stickPointerId = e.pointerId;
      this.stickZoneEl.setPointerCapture(e.pointerId);
      this.stickZoneEl.classList.add('active');

      const rect = this.stickZoneEl.getBoundingClientRect();
      this.maxRadius = Math.max(32, rect.width * 0.36);
      this.stickOrigin = {
        x: rect.left + rect.width * 0.5,
        y: rect.top + rect.height * 0.5,
      };
      this._updateStickFromPointer(e.clientX, e.clientY);
    });

    this.stickZoneEl.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickPointerId) return;
      e.preventDefault();
      this._updateStickFromPointer(e.clientX, e.clientY);
    });

    const onEnd = (e) => {
      if (e.pointerId !== this.stickPointerId) return;
      e.preventDefault();
      this._resetStick();
    };
    this.stickZoneEl.addEventListener('pointerup', onEnd);
    this.stickZoneEl.addEventListener('pointercancel', onEnd);
  }

  _bindButtons() {
    const bindActionBtn = (el, pointerSet, field) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pointerSet.add(e.pointerId);
        el.setPointerCapture(e.pointerId);
        el.classList.add('pressed');
        this.state[field] = true;
        this._emit();
      });

      const release = (e) => {
        if (!pointerSet.has(e.pointerId)) return;
        e.preventDefault();
        pointerSet.delete(e.pointerId);
        if (pointerSet.size === 0) {
          el.classList.remove('pressed');
          this.state[field] = false;
          this._syncKeyboard();
        }
      };

      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
    };

    bindActionBtn(this.jumpBtnEl, this.jumpPointers, 'jump');
    bindActionBtn(this.shootBtnEl, this.shootPointers, 'shoot');
  }

  _syncKeyboard() {
    if (this.stickPointerId === null) {
      let throttle = 0;
      let turn = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) throttle += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) throttle -= 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) turn -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) turn += 1;
      this.state.throttle = throttle;
      this.state.turn = turn;
    }

    if (this.jumpPointers.size === 0) {
      this.state.jump = this.keys.has('Space');
    }
    if (this.shootPointers.size === 0) {
      this.state.shoot =
        this.keys.has('KeyF') || this.keys.has('KeyJ') || this.keys.has('Enter');
    }

    this._emit();
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (this.keys.has(e.code)) return;
      this.keys.add(e.code);
      this._syncKeyboard();
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this._syncKeyboard();
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.jumpPointers.clear();
      this.shootPointers.clear();
      this.jumpBtnEl.classList.remove('pressed');
      this.shootBtnEl.classList.remove('pressed');
      this._resetStick();
    });
  }
}
