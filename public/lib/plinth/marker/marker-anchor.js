// Marker anchors: a printed marker (QR code by default) of known size gives
// every device the same, metric, world-fixed reference — what a shared
// tabletop needs for multiplayer.
//
// How it fuses with tracking:
//   * Detection runs on a throttled, downscaled copy of exactly the camera
//     frame being tracked (captured in onCameraFrame) in a separate worker.
//   * When a detection for frame k arrives, it is combined with the tracked
//     camera pose of frame k: the corner rays are intersected with the plane
//     the marker lies on, giving its world position, heading and size.
//   * Size vs. the known physical size reveals the true scale, so the world
//     is rescaled once (and drift corrected gently afterwards): world units
//     become metres.
//   * The anchor is filtered; when the marker leaves the view the anchor
//     simply stays where it is in the tracked world.

import { quatFromYaw, normalizeAngle, sub3, add3, scale3, norm3 } from '../core/math.js';
import { pixelRay, projectPoint } from '../vision/geometry.js';

/**
 * Detector backed by jsQR in a worker. `scriptUrl` is the URL of jsQR.js
 * (resolved against the document). Returns {detect({data,width,height}) -> Promise}.
 */
export function createJsQrDetector({ scriptUrl, inversionAttempts = 'dontInvert' } = {}) {
  const abs = new URL(scriptUrl, typeof document !== 'undefined' ? document.baseURI : undefined).href;
  const src = `
    importScripts(${JSON.stringify(abs)});
    self.onmessage = (e) => {
      const { id, buffer, width, height } = e.data;
      let out = null;
      try {
        const code = jsQR(new Uint8ClampedArray(buffer), width, height, { inversionAttempts: ${JSON.stringify(inversionAttempts)} });
        if (code) {
          const l = code.location;
          out = { data: code.data, corners: [l.topLeftCorner, l.topRightCorner, l.bottomRightCorner, l.bottomLeftCorner] };
        }
      } catch (err) { out = null; }
      self.postMessage({ id, result: out });
    };`;
  const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  let nextId = 1;
  const waiting = new Map();
  worker.onmessage = (e) => {
    const cb = waiting.get(e.data.id);
    waiting.delete(e.data.id);
    cb?.(e.data.result);
  };
  return {
    detect({ data, width, height }) {
      const id = nextId++;
      return new Promise((resolve) => {
        waiting.set(id, resolve);
        worker.postMessage({ id, buffer: data.buffer, width, height }, [data.buffer]);
      });
    },
    dispose() { worker.terminate(); },
  };
}

function quadIsPlausible(c) {
  const sides = [0, 1, 2, 3].map((i) => Math.hypot(c[(i + 1) % 4].x - c[i].x, c[(i + 1) % 4].y - c[i].y));
  const mn = Math.min(...sides);
  const mx = Math.max(...sides);
  if (mn < 12 || mx / mn > 3) return false;
  // Convex and consistently wound.
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i]; const b = c[(i + 1) % 4]; const d = c[(i + 2) % 4];
    const cr = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
    if (!sign) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) return false;
  }
  return true;
}

export class MarkerAnchor {
  /**
   * options:
   *   detector    {detect(imageData) -> Promise<{corners, data}|null>}
   *   size        physical side length of the marker (metres), as measured
   *               between the detector's corner points
   *   match       string or RegExp the payload must match (optional)
   *   every       scan every N camera frames (default 3)
   *   scanLongSide  scan resolution long side in px (default 720)
   *   autoScale   rescale the world so it is metric (default true)
   *   smoothing   anchor blend factor per detection (default 0.3)
   *   lostAfterMs time without detections before 'markerlost' (default 1500)
   */
  constructor(options) {
    this.o = {
      every: 3,
      scanLongSide: 720,
      autoScale: true,
      smoothing: 0.3,
      lostAfterMs: 1500,
      ...options,
    };
    this.name = 'plinth-marker';
    this.engine = null;
    this.anchor = null;
    this.state = 'searching';
    this.lastSeen = 0;
    this.frameCount = 0;
    this.busy = false;
    this.pending = new Map(); // frameId -> detection waiting for its pose
    this.scaleVotes = [];
    this.calibrated = !this.o.autoScale;
    this.lastMeasurement = null;
    this.canvas = null;
    this.ctx = null;
    this.frozen = false; // when true, sightings no longer move the anchor
  }

  onAttach({ engine }) {
    this.engine = engine;
    this._onResult = (r) => {
      const det = this.pending.get(r.id);
      if (det) {
        this.pending.delete(r.id);
        this._process(r.id, det);
      }
    };
    engine.on('result', this._onResult);
  }

  onDetach({ engine }) {
    engine.off('result', this._onResult);
    this.o.detector?.dispose?.();
  }

  onCameraFrame({ engine, frame }) {
    this.frameCount++;
    if (this.busy || this.frameCount % this.o.every !== 0) return;
    const long = this.o.scanLongSide;
    const s = long / Math.max(frame.width, frame.height);
    const w = Math.round(frame.width * s);
    const h = Math.round(frame.height * s);
    if (!this.canvas) {
      this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
    }
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.ctx = null;
    }
    if (!this.ctx) this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    // Same JS task as the texture upload: this is the same camera frame.
    this.ctx.drawImage(frame.source, 0, 0, w, h);
    const img = this.ctx.getImageData(0, 0, w, h);
    this.busy = true;
    const frameId = frame.id;
    const capW = frame.width;
    const capH = frame.height;
    this.o.detector.detect({ data: img.data, width: w, height: h }).then((res) => {
      this.busy = false;
      if (!res || !res.corners) return;
      if (this.o.match && !(typeof this.o.match === 'string' ? res.data === this.o.match : this.o.match.test(res.data))) return;
      if (!quadIsPlausible(res.corners)) return;
      const det = { ...res, scanW: w, scanH: h, capW, capH, time: performance.now() };
      if (engine.getPose(frameId)) this._process(frameId, det);
      else {
        this.pending.set(frameId, det);
        if (this.pending.size > 8) this.pending.delete(this.pending.keys().next().value);
      }
    }).catch(() => { this.busy = false; });
  }

  onUpdate() {
    if (this.state === 'tracking' && performance.now() - this.lastSeen > this.o.lostAfterMs) {
      this.state = 'lost';
      this.engine.emit('markerlost', { anchor: this.anchor });
    }
  }

  /** Marker measurement in the world for frame `frameId`. */
  measure(frameId, det) {
    const engine = this.engine;
    const pose = engine.getPose(frameId);
    const K = engine.captureK?.cropAndScale(det.scanW, det.scanH);
    if (!pose || !K) return null;
    // Only fuse sightings from frames whose camera pose is trustworthy.
    if (pose.status && pose.status !== 'NORMAL') return null;
    const rays = det.corners.map((c) => pixelRay(pose, K, c.x, c.y));
    if (rays.some((d) => d[1] > -0.05)) return null; // must look down at the marker

    // Which horizontal plane is the marker on? Use trusted map points that
    // project inside the marker quad; default to the ground plane y = 0.
    let planeY = 0;
    const pts = engine.points;
    const ys = [];
    const inside = (u, v) => {
      let pos = 0; let neg = 0;
      for (let i = 0; i < 4; i++) {
        const a = det.corners[i]; const b = det.corners[(i + 1) % 4];
        const cr = (b.x - a.x) * (v - a.y) - (b.y - a.y) * (u - a.x);
        if (cr > 0) pos++; else neg++;
      }
      return pos === 4 || neg === 4;
    };
    for (let i = 0; i < pts.length; i += 4) {
      if (pts[i + 3] < 0.3) continue;
      const pr = projectPoint(pose, K, [pts[i], pts[i + 1], pts[i + 2]]);
      if (pr && inside(pr[0], pr[1])) ys.push(pts[i + 1]);
    }
    if (ys.length >= 4) {
      ys.sort((a, b) => a - b);
      const med = ys[ys.length >> 1];
      if (Math.abs(med) > 0.08 * Math.max(1e-3, pose.t[1])) planeY = med;
    }
    const h = pose.t[1] - planeY;
    if (h <= 1e-4) return null;
    const W = rays.map((d) => add3(pose.t, scale3(d, -h / d[1])));
    const sides = [0, 1, 2, 3].map((i) => norm3(sub3(W[(i + 1) % 4], W[i])));
    const size = sides.reduce((a, b) => a + b, 0) / 4;
    const diag1 = norm3(sub3(W[2], W[0]));
    const diag2 = norm3(sub3(W[3], W[1]));
    if (Math.max(...sides) / Math.min(...sides) > 1.35 || Math.abs(diag1 - diag2) / Math.max(diag1, diag2) > 0.25) return null;
    const center = scale3(add3(add3(W[0], W[1]), add3(W[2], W[3])), 0.25);
    const xAxis = add3(sub3(W[1], W[0]), sub3(W[2], W[3]));
    const yaw = Math.atan2(-xAxis[2], xAxis[0]);
    return { center, yaw, size, planeY, frameId, data: det.data };
  }

  _process(frameId, det) {
    const engine = this.engine;
    const m = this.measure(frameId, det);
    if (!m) return;
    const physical = this.o.size;

    // Metric scale.
    if (this.o.autoScale && physical) {
      const k = physical / m.size;
      if (!this.calibrated) {
        if (m.planeY !== 0) {
          // The tracker's ground is not the marker's surface (e.g. it started
          // on the floor): restart tracking with the marker plane as ground.
          const pose = engine.lastResult?.pose;
          const cur = pose ? { q: pose.q, t: [pose.t[0] * k, (pose.t[1] - m.planeY) * k, pose.t[2] * k] } : null;
          engine.resetTracking({ continuePose: cur, cameraHeight: cur ? cur.t[1] : engine.opts.cameraHeight * k });
          if (this.anchor) engine.removeAnchor(this.anchor);
          this.anchor = null;
          return;
        }
        engine.rescaleWorld(k, m.center);
        this.calibrated = true;
        m.size *= k;
      } else {
        // Gentle drift correction once several detections agree.
        this.scaleVotes.push(k);
        if (this.scaleVotes.length >= 5) {
          const sorted = [...this.scaleVotes].sort((a, b) => a - b);
          const med = sorted[2];
          this.scaleVotes = [];
          if (Math.abs(med - 1) > 0.03) engine.rescaleWorld(1 + (med - 1) * 0.5, m.center);
        }
      }
    }

    const found = !this.anchor;
    if (this.frozen && !found) {
      // Locked by the app: keep the anchor exactly where it is.
      this.lastSeen = performance.now();
      if (this.state !== 'tracking') {
        this.state = 'tracking';
        engine.emit('markerfound', { anchor: this.anchor, data: m.data, size: m.size });
      } else {
        engine.emit('markerupdated', { anchor: this.anchor, data: m.data, size: m.size });
      }
      return;
    }
    if (found) {
      this.anchor = engine.createAnchor(m.center, quatFromYaw(m.yaw), { marker: m.data });
    } else {
      const a = this.anchor;
      const d = norm3(sub3(m.center, a.position));
      const big = d > 0.25 * (physical || m.size);
      const prev = this.lastMeasurement;
      // A large jump must be confirmed by a second consistent detection.
      if (big && !(prev && norm3(sub3(prev.center, m.center)) < 0.1 * (physical || m.size))) {
        this.lastMeasurement = m;
        return;
      }
      const alpha = big ? 1 : this.o.smoothing;
      a.position = add3(a.position, scale3(sub3(m.center, a.position), alpha));
      const curYaw = 2 * Math.atan2(a.rotation[1], a.rotation[3]);
      a.rotation = quatFromYaw(curYaw + normalizeAngle(m.yaw - curYaw) * alpha);
    }
    this.lastMeasurement = m;
    this.lastSeen = performance.now();
    const wasTracking = this.state === 'tracking';
    this.state = 'tracking';
    engine.emit(found || !wasTracking ? 'markerfound' : 'markerupdated', { anchor: this.anchor, data: m.data, size: m.size });
  }
}
