class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  unlock() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  _tone({ type = 'sine', f0 = 440, f1 = 220, duration = 0.12, gain = 0.14 }) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + duration);

    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);

    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }

  playShoot() {
    this._tone({ type: 'sawtooth', f0: 680, f1: 160, duration: 0.09, gain: 0.12 });
  }

  playJump() {
    this._tone({ type: 'triangle', f0: 230, f1: 520, duration: 0.12, gain: 0.11 });
  }

  playPickup() {
    this._tone({ type: 'sine', f0: 520, f1: 980, duration: 0.11, gain: 0.14 });
  }

  playHit() {
    this._tone({ type: 'square', f0: 210, f1: 80, duration: 0.1, gain: 0.13 });
  }

  playLand() {
    this._tone({ type: 'sine', f0: 150, f1: 65, duration: 0.08, gain: 0.08 });
  }

  playElim() {
    this._tone({ type: 'sawtooth', f0: 320, f1: 55, duration: 0.3, gain: 0.16 });
  }

  playWin() {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      setTimeout(() => {
        this._tone({ type: 'triangle', f0: freq, f1: freq * 1.02, duration: 0.18, gain: 0.13 });
      }, i * 95);
    });
  }
}

export const sound = new SoundEngine();
