// Device orientation capture with a timestamped history, so each camera frame
// can be paired with the orientation at the moment it was captured.
//
// Orientation comes from `deviceorientation` (the browser's fused attitude:
// gravity exact, yaw relative and slowly drifting) which is reliable on both
// iOS Safari and Android Chrome. `devicemotion` supplies the gyro rate for
// motion-blur detection and time-offset estimation. Quirks handled (several
// documented in 8th Wall's engine, tracking-sensor-event.cc):
//   * iOS reports DeviceMotionEvent.interval in seconds instead of ms.
//   * iOS 13+ needs DeviceOrientationEvent/DeviceMotionEvent.requestPermission()
//     from a user gesture.
//   * Old Safari used epoch-based event timestamps.

import { quatMul, quatFromAxisAngle, quatSlerp, quatNormalize } from './math.js';

const DEG = Math.PI / 180;
// Camera looks out of the back of the device (three.js DeviceOrientationControls).
const Q_CAMERA = [-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)];

function screenAngleDeg() {
  if (typeof window === 'undefined') return 0;
  if (window.screen?.orientation && typeof window.screen.orientation.angle === 'number') {
    return window.screen.orientation.angle;
  }
  return typeof window.orientation === 'number' ? window.orientation : 0;
}

/**
 * Convert W3C device orientation Euler angles (degrees) to a camera-to-world
 * quaternion in Plinth's convention (world +Y up, camera looking down -Z,
 * camera X/Y aligned with the current screen orientation).
 */
export function deviceOrientationToQuat(alpha, beta, gamma, screenAngle = 0) {
  const a = (alpha || 0) * DEG;
  const b = (beta || 0) * DEG;
  const g = (gamma || 0) * DEG;
  // Euler 'YXZ' with (beta, alpha, -gamma), as in three.js.
  const c1 = Math.cos(b / 2), s1 = Math.sin(b / 2); // x
  const c2 = Math.cos(a / 2), s2 = Math.sin(a / 2); // y
  const c3 = Math.cos(-g / 2), s3 = Math.sin(-g / 2); // z
  const q = [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 - s1 * s2 * c3,
    c1 * c2 * c3 + s1 * s2 * s3,
  ];
  const withCam = quatMul(q, Q_CAMERA);
  return quatNormalize(quatMul(withCam, quatFromAxisAngle([0, 0, 1], -screenAngle * DEG)));
}

function eventTime(e) {
  const now = performance.now();
  const ts = e && typeof e.timeStamp === 'number' ? e.timeStamp : now;
  // Guard against epoch-based timestamps (legacy Safari) or clock skew.
  return Math.abs(ts - now) < 5000 ? ts : now;
}

export class ImuSource {
  constructor({ historySize = 240 } = {}) {
    this.historySize = historySize;
    this.history = []; // {t (ms), q}
    this.gyroRate = 0; // rad/s, smoothed magnitude
    this.lastGyro = null; // {t, w: [x, y, z] rad/s in device frame}
    this.running = false;
    this.hasOrientation = false;
    this.hasMotion = false;
    this.permissionGranted = !ImuSource.permissionRequired();
    this._onOrientation = this._onOrientation.bind(this);
    this._onMotion = this._onMotion.bind(this);
    this.listeners = new Set();
  }

  static permissionRequired() {
    return typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  /** Must be called from a user gesture on iOS. Resolves true when granted. */
  async requestPermission() {
    if (this.permissionGranted) return true;
    try {
      const results = await Promise.all([
        DeviceOrientationEvent.requestPermission(),
        typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission
          ? DeviceMotionEvent.requestPermission().catch(() => 'denied')
          : 'granted',
      ]);
      this.permissionGranted = results[0] === 'granted';
    } catch {
      this.permissionGranted = false;
    }
    if (this.permissionGranted && this.running) this._attach();
    return this.permissionGranted;
  }

  start() {
    if (this.running) return;
    this.running = true;
    // Listen right away: browsers that expose requestPermission() but do not
    // require it (e.g. desktop Chrome) deliver events anyway, and receiving
    // one proves access. iOS simply sends nothing until permission is granted.
    this._attach();
  }

  stop() {
    this.running = false;
    if (typeof window === 'undefined') return;
    window.removeEventListener('deviceorientation', this._onOrientation, true);
    window.removeEventListener('devicemotion', this._onMotion, true);
    this._attached = false;
  }

  _attach() {
    if (this._attached || typeof window === 'undefined') return;
    this._attached = true;
    window.addEventListener('deviceorientation', this._onOrientation, true);
    window.addEventListener('devicemotion', this._onMotion, true);
  }

  /** Feed a sample directly (tests, replays, custom sensor sources). */
  pushSample(tMs, q) {
    this.hasOrientation = true;
    const h = this.history;
    if (h.length && tMs <= h[h.length - 1].t) tMs = h[h.length - 1].t + 0.01;
    h.push({ t: tMs, q });
    if (h.length > this.historySize) h.shift();
    for (const fn of this.listeners) fn(tMs, q);
  }

  _onOrientation(e) {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    this.permissionGranted = true;
    this.pushSample(eventTime(e), deviceOrientationToQuat(e.alpha, e.beta, e.gamma, screenAngleDeg()));
  }

  _onMotion(e) {
    const r = e.rotationRate;
    if (!r || r.alpha == null) return;
    this.hasMotion = true;
    // W3C: alpha about Z, beta about X, gamma about Y, deg/s.
    const w = [(r.beta || 0) * DEG, (r.gamma || 0) * DEG, (r.alpha || 0) * DEG];
    const mag = Math.hypot(w[0], w[1], w[2]);
    this.gyroRate = this.gyroRate * 0.7 + mag * 0.3;
    this.lastGyro = { t: eventTime(e), w };
  }

  get available() {
    return this.hasOrientation;
  }

  latest() {
    const h = this.history;
    return h.length ? h[h.length - 1] : null;
  }

  /**
   * Orientation at time tMs (performance.now() clock), slerped between
   * samples. Beyond the newest sample it extrapolates with the gyro for up
   * to 60 ms.
   */
  orientationAt(tMs) {
    const h = this.history;
    if (!h.length) return null;
    if (tMs <= h[0].t) return h[0].q;
    const last = h[h.length - 1];
    if (tMs >= last.t) {
      // Extrapolate with the angular velocity of the last two samples (frame
      // conventions of rotationRate differ between browsers; this does not
      // depend on them).
      if (h.length >= 2) {
        const prev = h[h.length - 2];
        const span = last.t - prev.t;
        const ahead = Math.min(60, tMs - last.t);
        if (span > 0 && span < 100 && ahead > 0) {
          return quatSlerp(prev.q, last.q, 1 + ahead / span);
        }
      }
      return last.q;
    }
    // Binary search for the bracketing pair.
    let lo = 0;
    let hi = h.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (h[mid].t <= tMs) lo = mid; else hi = mid;
    }
    const a = h[lo];
    const b = h[hi];
    const f = (tMs - a.t) / Math.max(1e-6, b.t - a.t);
    return quatSlerp(a.q, b.q, f);
  }
}
