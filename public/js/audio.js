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

  /** Play a chiptune note sequence: [[freqHz | 0 (rest), beats], ...]. */
  playNotes(seq, { type = 'square', step = 0.07, gain = 0.09 } = {}) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    let t = this.ctx.currentTime + 0.005;
    for (const [freq, beats = 1] of seq) {
      const dur = step * beats;
      if (freq > 0) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(gain, t);
        g.gain.setValueAtTime(gain, t + dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.98);
        osc.connect(g);
        g.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + dur);
      }
      t += dur;
    }
  }

  /** Filtered white-noise burst (swish, crowd, thud). */
  playNoise({ duration = 0.2, freq = 3000, q = 0.8, gain = 0.12, type = 'bandpass' } = {}) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.ctx.destination);
    src.start(t);
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
