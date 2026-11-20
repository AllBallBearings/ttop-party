// PlinthEngine: the camera pipeline that ties capture, IMU, GPU processing and
// the tracking worker together, and exposes a frame-synchronised pose.
//
// Per animation frame (update()):
//   new camera frame?  -> upload to a texture ring slot, start GPU grayscale
//                         read-back, notify modules (e.g. a QR detector)
//   finished read-back -> post to the tracking worker with the IMU orientation
//                         at the frame's capture time
//   tracker result     -> becomes the displayed frame: the pose AND the camera
//                         texture of the same frame (syncMode 'frame'), which
//                         is what keeps virtual content glued to the scene.
//
// Pipeline modules (an 8th Wall-style API) receive onStart / onCameraFrame /
// onUpdate / onRender callbacks. The three.js adapter is such a module.

import {
  quatMul, quatConj, quatNormalize, quatRotate, quatAngle, quatFromYaw, add3, sub3, scale3, dot3,
  normalize3,
} from './math.js';
import { detectDevice, referenceFocal, captureIntrinsics } from './device-calibration.js';
import { ImuSource } from './imu.js';
import { CameraSource } from './camera-source.js';
import { GpuFrameProcessor } from './gpu.js';
import { createTrackerHost } from './tracker-worker.js';

export const HitTestType = Object.freeze({
  FEATURE_POINT: 'FEATURE_POINT',
  ESTIMATED_SURFACE: 'ESTIMATED_SURFACE',
  DETECTED_SURFACE: 'DETECTED_SURFACE',
});

const DEFAULTS = {
  cameraHeight: 1.0,
  processingLongSide: 480,
  syncMode: 'frame',
  useWorker: true,
  capture: {},
  imu: true,
  tracker: {},
  focal480: null,
  pointsEvery: 6,
  maxInFlight: 2,
  autoPause: true,
};

/** Online estimate of the camera-to-IMU time offset (ms) from rotation agreement. */
class TimeOffsetEstimator {
  constructor() {
    this.candidates = [];
    for (let d = -80; d <= 80; d += 10) this.candidates.push(d);
    this.cost = new Float64Array(this.candidates.length);
    this.samples = 0;
    this.offset = 0;
  }

  add(prev, cur, imu) {
    const vis = quatMul(quatConj(prev.q), cur.q);
    const visAngle = quatAngle([0, 0, 0, 1], vis);
    if (visAngle < 0.01) return; // need rotation to be informative
    for (let i = 0; i < this.candidates.length; i++) {
      const d = this.candidates[i];
      const a = imu.orientationAt(prev.time + d);
      const b = imu.orientationAt(cur.time + d);
      if (!a || !b) return;
      const r = quatAngle(quatMul(quatConj(a), b), vis);
      this.cost[i] = this.cost[i] * 0.97 + r * r;
    }
    this.samples++;
    if (this.samples >= 20) {
      let best = 0;
      for (let i = 1; i < this.cost.length; i++) if (this.cost[i] < this.cost[best]) best = i;
      this.offset = this.offset * 0.8 + this.candidates[best] * 0.2;
    }
  }
}

export class PlinthEngine {
  constructor(options = {}) {
    this.opts = { ...DEFAULTS, ...options };
    this.gl = this.opts.gl || null;
    this.modules = [];
    this.listeners = new Map();
    this.state = 'idle';
    this.trackingStatus = 'NOT_AVAILABLE';
    this.trackingReason = 'INITIALIZING';
    this.source = null;
    this.imu = null;
    this.gpu = null;
    this.worker = null;
    this.frames = new Map(); // id -> {slot, time, imuQ, version}
    this.poseHistory = new Map(); // id -> {q, t, time}
    this.results = [];
    this.bufferPool = [];
    this.inFlight = 0;
    this.display = null; // {id, slot}
    this.frameState = null;
    this.points = new Float32Array(0);
    this.planes = [];
    this.anchors = new Map();
    this.nextAnchorId = 1;
    this.worldVersion = 0;
    this.worldTransforms = []; // per version: {scale, center} applied to reach the next version
    this.timeOffset = new TimeOffsetEstimator();
    this.lastResult = null;
    this.displayW = 1;
    this.displayH = 1;
    this.captureK = null;
    this.processingK = null;
    this.capW = 0;
    this.capH = 0;
    this.resultCount = 0;
    this._onVisibility = this._onVisibility.bind(this);
  }

  // ------------------------------------------------------------ events

  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
    return () => this.off(name, fn);
  }

  off(name, fn) {
    this.listeners.get(name)?.delete(fn);
  }

  emit(name, detail) {
    for (const fn of this.listeners.get(name) || []) {
      try { fn(detail); } catch (err) { console.error(`[plinth] ${name} listener failed`, err); }
    }
  }

  addPipelineModule(module) {
    this.modules.push(module);
    module.onAttach?.({ engine: this });
    if (this.state === 'running') module.onStart?.({ engine: this });
    return module;
  }

  removePipelineModule(module) {
    this.modules = this.modules.filter((m) => m !== module);
    module.onDetach?.({ engine: this });
  }

  _callModules(hook, arg) {
    for (const m of this.modules) {
      if (typeof m[hook] !== 'function') continue;
      try { m[hook](arg); } catch (err) { console.error(`[plinth] module ${m.name || '?'}.${hook} failed`, err); }
    }
  }

  // ------------------------------------------------------------ lifecycle

  /** Request motion-sensor permission (iOS). Call from a user gesture. */
  async requestMotionPermission() {
    if (!this.imu) this.imu = this.opts.imu instanceof ImuSource ? this.opts.imu : new ImuSource();
    const ok = await this.imu.requestPermission();
    this.emit('motionpermission', { granted: ok });
    return ok;
  }

  get needsMotionPermission() {
    return !!(this.opts.imu && ImuSource.permissionRequired() && !(this.imu && this.imu.permissionGranted));
  }

  async start() {
    if (this.state === 'running' || this.state === 'starting') return;
    if (!this.gl) throw new Error('[plinth] a WebGL context (options.gl) is required');
    this.state = 'starting';
    this.emit('camerastatuschange', { status: 'requesting' });
    try {
      const device = await detectDevice();
      this.device = device;
      this.focal480 = this.opts.focal480 || referenceFocal(device);
      this.source = this.opts.source || new CameraSource(this.opts.capture);
      await this.source.start();
      this.emit('camerastatuschange', { status: 'hasVideo', width: this.source.width, height: this.source.height });
    } catch (err) {
      this.state = 'failed';
      this.emit('camerastatuschange', { status: 'failed', error: err });
      throw err;
    }
    if (this.opts.imu) {
      if (!this.imu) this.imu = this.opts.imu instanceof ImuSource ? this.opts.imu : new ImuSource();
      this.imu.start();
    }
    this.gpu = new GpuFrameProcessor(this.gl);
    this._resetGl();
    this._startWorker();
    if (this.opts.autoPause && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onVisibility);
    }
    this.state = 'running';
    this._callModules('onStart', { engine: this });
    this.emit('start', {});
  }

  stop() {
    if (this.state === 'idle') return;
    this.source?.stop();
    this.imu?.stop();
    this.worker?.terminate?.();
    this.worker = null;
    this.gpu?.dispose();
    this.gpu = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onVisibility);
    this.state = 'idle';
    this.frames.clear();
    this.results = [];
    this.inFlight = 0;
    this.display = null;
    // A later start() runs a fresh tracker in a fresh world: forget everything
    // tied to this session so the new camera/GPU/worker get re-initialised
    // (capW = 0 forces _configureForCapture on the first new frame).
    this.capW = 0;
    this.capH = 0;
    this.lastResult = null;
    this.poseHistory.clear();
    this.points = new Float32Array(0);
    this.planes = [];
    this.anchors.clear();
    this.worldVersion = 0;
    this.worldTransforms = [];
    this.frameState = null;
    this.trackingStatus = 'NOT_AVAILABLE';
    this.trackingReason = 'INITIALIZING';
    // Stopping is not detaching: modules stay registered for the next start.
    this._callModules('onStop', { engine: this });
    this.emit('stop', {});
  }

  async pause() {
    if (this.state !== 'running') return;
    this.state = 'paused';
    this.source?.stop();
  }

  async resume() {
    if (this.state !== 'paused') return;
    await this.source.start();
    this.state = 'running';
    // The camera may have moved arbitrarily while paused: relocalise.
    this._post({ type: 'lost' });
  }

  _onVisibility() {
    if (document.visibilityState === 'hidden') this.pause();
    else this.resume().catch((err) => this.emit('camerastatuschange', { status: 'failed', error: err }));
  }

  _resetGl() {
    this.opts.onGlStateDirty?.();
  }

  _startWorker() {
    const onMessage = (m) => {
      if (m.type === 'result') {
        if (m.buffer) this.bufferPool.push(new Uint8Array(m.buffer));
        this.results.push(m.result);
      }
    };
    this.worker = null;
    if (this.opts.useWorker && typeof Worker !== 'undefined') {
      try {
        const w = new Worker(new URL('./tracker-worker.js', import.meta.url), { type: 'module' });
        w.onmessage = (e) => onMessage(e.data);
        w.onerror = (e) => {
          console.warn('[plinth] tracking worker failed; running inline', e.message || e);
          this._startInline(onMessage);
        };
        this.worker = { post: (m, t) => w.postMessage(m, t || []), terminate: () => w.terminate() };
      } catch (err) {
        console.warn('[plinth] module workers unavailable; tracking on the main thread', err);
      }
    }
    if (!this.worker) this._startInline(onMessage);
  }

  _startInline(onMessage) {
    const host = createTrackerHost((m) => onMessage(m));
    this.worker = { post: (m) => host(m), terminate: () => {} };
    // Anything in flight in the failed worker is gone.
    for (const m of this.frames.values()) if (!m.done && this.gpu) this.gpu.releaseSlot(m.slot);
    for (const [id, m] of this.frames) if (!m.done) this.frames.delete(id);
    this.inFlight = 0;
    this.capW = 0; // force re-init on next frame
  }

  _post(msg, transfer) {
    this.worker?.post(msg, transfer);
  }

  // ------------------------------------------------------------ configuration

  _configureForCapture(capW, capH) {
    const long = this.opts.processingLongSide;
    let pw;
    let ph;
    if (capW >= capH) {
      pw = long;
      ph = Math.round((long * capH) / capW);
    } else {
      ph = long;
      pw = Math.round((long * capW) / capH);
    }
    pw -= pw % 4;
    const first = !this.capW;
    this.capW = capW;
    this.capH = capH;
    this.captureK = this.opts.intrinsics
      ? this.opts.intrinsics.cropAndScale(capW, capH)
      : captureIntrinsics(capW, capH, this.focal480);
    this.processingK = this.captureK.cropAndScale(pw, ph);
    this.gpu.configure(pw, ph);
    const continuePose = !first && this.lastResult?.pose ? this.lastResult.pose : null;
    this._post({
      type: 'init',
      intrinsics: { ...this.processingK },
      config: { cameraHeight: this.opts.cameraHeight, ...this.opts.tracker },
      continuePose,
    });
    this.emit('configured', { capture: this.captureK, processing: this.processingK });
  }

  /** Size of the drawing buffer the AR view is rendered into (device pixels). */
  setDisplaySize(width, height) {
    this.displayW = Math.max(1, width);
    this.displayH = Math.max(1, height);
  }

  /** Intrinsics of the camera as displayed (cover-cropped to the viewport). */
  displayIntrinsics() {
    if (!this.captureK) return null;
    return this.captureK.cropAndScale(this.displayW, this.displayH);
  }

  // ------------------------------------------------------------ per-frame

  /** Advance the pipeline. Call once per animation frame before rendering. */
  update(nowMs = performance.now()) {
    if (this.state !== 'running') return this.frameState;
    let gpuTouched = false;

    // 1. Capture.
    const frame = this.source.poll();
    if (frame) {
      if (frame.width !== this.capW || frame.height !== this.capH) this._configureForCapture(frame.width, frame.height);
      const exclude = new Set(this.display ? [this.display.slot] : []);
      const slot = this.inFlight < this.opts.maxInFlight ? this.gpu.acquireSlot(exclude) : -1;
      if (slot >= 0) {
        this.gpu.upload(slot, frame.source, frame.width, frame.height);
        this.gpu.process(slot, frame.id);
        gpuTouched = true;
        this.inFlight++;
        this.frames.set(frame.id, { slot, time: frame.time, imuQ: frame.imuQ || null, version: this.worldVersion });
        this._callModules('onCameraFrame', { engine: this, frame, slot });
        this.emit('cameraframe', frame);
      }
    }

    // 2. Finished read-backs -> tracker.
    if (this.gpu.pending.length) {
      for (const rb of this.gpu.poll(this.bufferPool)) {
        const meta = this.frames.get(rb.tag);
        if (!meta) continue;
        let imuQ = meta.imuQ;
        if (!imuQ && this.imu && this.imu.available) imuQ = this.imu.orientationAt(meta.time + this.timeOffset.offset);
        meta.imuQ = imuQ;
        this.resultCount++;
        this._post({
          type: 'frame',
          id: rb.tag,
          time: meta.time / 1000,
          width: rb.width,
          height: rb.height,
          buffer: rb.data.buffer,
          imuQ,
          wantPoints: this.resultCount % this.opts.pointsEvery === 0,
        }, [rb.data.buffer]);
      }
      gpuTouched = true;
    }

    // 3. Tracker results -> displayed frame.
    let newest = null;
    while (this.results.length) {
      const r = this.results.shift();
      this.inFlight = Math.max(0, this.inFlight - 1);
      const meta = this.frames.get(r.id);
      if (!meta) continue;
      if (r.pose) r.pose = this._toCurrentWorld(r.pose, meta.version);
      if (r.points && meta.version !== this.worldVersion) r.points = this._pointsToCurrentWorld(r.points, meta.version);
      this._onResult(r, meta);
      newest = { r, meta };
    }
    // 4. Choose the displayed frame and recycle texture slots.
    if (this.opts.syncMode === 'latest') {
      if (frame && this.frames.has(frame.id)) this.display = { id: frame.id, slot: this.frames.get(frame.id).slot };
    } else if (newest) {
      this.display = { id: newest.r.id, slot: newest.meta.slot };
    }
    if (this.display) {
      for (const [id, m] of this.frames) {
        if (m.done && id !== this.display.id) {
          if (m.slot !== this.display.slot) this.gpu.releaseSlot(m.slot);
          this.frames.delete(id);
        }
      }
    }

    if (gpuTouched) this._resetGl();
    this.frameState = this._composeFrameState(nowMs);
    if (this.frameState) {
      this._callModules('onUpdate', this.frameState);
      this.emit('update', this.frameState);
      this._callModules('onRender', this.frameState);
    }
    return this.frameState;
  }

  _onResult(r, meta) {
    meta.done = true;
    const prev = this.lastResult;
    this.lastResult = { ...r, time: meta.time };
    if (r.pose) {
      this.poseHistory.set(r.id, { q: r.pose.q, t: r.pose.t, time: meta.time, status: r.status });
      if (this.poseHistory.size > 90) this.poseHistory.delete(this.poseHistory.keys().next().value);
      if (prev?.pose && this.imu?.available && r.status === 'NORMAL' && prev.status === 'NORMAL') {
        this.timeOffset.add({ q: prev.pose.q, time: prev.time }, { q: r.pose.q, time: meta.time }, this.imu);
      }
    }
    if (r.points) {
      this.points = r.points;
      this.planes = detectHorizontalPlanes(r.points, this.opts.cameraHeight);
    }
    if (r.status !== this.trackingStatus || r.reason !== this.trackingReason) {
      this.trackingStatus = r.status;
      this.trackingReason = r.reason;
      this.emit('trackingstatus', { status: r.status, reason: r.reason });
    }
    this.emit('result', r);
  }

  _composeFrameState(nowMs) {
    if (!this.display || !this.lastResult) return null;
    const slot = this.display.slot;
    let pose = this.lastResult.pose;
    let frameTime = this.lastResult.time;
    if (this.opts.syncMode === 'latest' && pose && this.imu?.available) {
      // Rotate the last tracked pose by the IMU rotation since that frame.
      const meta = this.frames.get(this.display.id);
      const t0 = this.lastResult.time + this.timeOffset.offset;
      const t1 = (meta ? meta.time : nowMs) + this.timeOffset.offset;
      const a = this.imu.orientationAt(t0);
      const b = this.imu.orientationAt(t1);
      if (a && b) pose = { q: quatNormalize(quatMul(pose.q, quatMul(quatConj(a), b))), t: pose.t };
      frameTime = meta ? meta.time : nowMs;
    }
    return {
      engine: this,
      frameId: this.display.id,
      time: frameTime,
      pose,
      texture: this.gpu.texture(slot),
      textureWidth: this.capW,
      textureHeight: this.capH,
      captureIntrinsics: this.captureK,
      displayIntrinsics: this.displayIntrinsics(),
      status: this.trackingStatus,
      reason: this.trackingReason,
      exposure: this.lastResult.exposure,
      trackerMs: this.lastResult.ms,
      timeOffsetMs: this.timeOffset.offset,
    };
  }

  // ------------------------------------------------------------ world transforms

  _toCurrentWorld(pose, version) {
    let { q, t } = pose;
    for (let v = version; v < this.worldVersion; v++) {
      const tr = this.worldTransforms[v];
      if (tr.scale !== undefined) t = add3(tr.center, scale3(sub3(t, tr.center), tr.scale));
      if (tr.yaw !== undefined) {
        const qy = quatFromYaw(tr.yaw);
        q = quatNormalize(quatMul(qy, q));
        t = add3(quatRotate(qy, t), tr.translation);
      }
    }
    return { q, t };
  }

  _pointsToCurrentWorld(points, version) {
    const out = new Float32Array(points);
    for (let i = 0; i < out.length; i += 4) {
      const p = this._toCurrentWorld({ q: [0, 0, 0, 1], t: [out[i], out[i + 1], out[i + 2]] }, version).t;
      out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2];
    }
    return out;
  }

  _applyToWorld(tr) {
    this.worldTransforms[this.worldVersion] = tr;
    this.worldVersion++;
    const v = this.worldVersion - 1;
    const f = (pose) => this._toCurrentWorld(pose, v);
    for (const a of this.anchors.values()) {
      const p = f({ q: a.rotation, t: a.position });
      a.position = p.t;
      a.rotation = p.q;
    }
    for (const [id, p] of this.poseHistory) this.poseHistory.set(id, { ...f(p), time: p.time, status: p.status });
    if (this.lastResult?.pose) this.lastResult.pose = f(this.lastResult.pose);
    this.points = this._pointsToCurrentWorld(this.points, v);
    this.planes = detectHorizontalPlanes(this.points, this.opts.cameraHeight * (tr.scale || 1));
    if (tr.scale !== undefined) this.opts.cameraHeight *= tr.scale;
    this.emit('worldtransform', tr);
  }

  /**
   * Uniformly rescale the world about a point on the ground plane, e.g. once
   * a marker of known physical size reveals the true metric scale.
   */
  rescaleWorld(scale, center = [0, 0, 0]) {
    if (!(scale > 0) || Math.abs(scale - 1) < 1e-6) return;
    this._post({ type: 'rescale', scale, center });
    this._applyToWorld({ scale, center });
  }

  /** Rigidly move the world: p' = R_y(yaw) p + translation. */
  transformWorld(yaw, translation = [0, 0, 0]) {
    this._post({ type: 'transform', yaw, translation });
    this._applyToWorld({ yaw, translation });
  }

  /**
   * Discard the map and restart tracking. With continuePose the camera keeps
   * that pose (so content stays roughly in place); cameraHeight sets the
   * assumed height above the ground plane for the new map.
   */
  resetTracking({ continuePose = null, cameraHeight } = {}) {
    if (cameraHeight > 0) this.opts.cameraHeight = cameraHeight;
    this._post({ type: 'configure', config: { cameraHeight: this.opts.cameraHeight } });
    this._post({ type: 'reset', continuePose });
    this.points = new Float32Array(0);
    this.planes = [];
    this.emit('trackingreset', { continuePose });
  }

  /** Restart tracking with the camera back at the configured origin. */
  recenter() {
    this._post({ type: 'reset', continuePose: null });
    this.anchors.clear();
    this.emit('recenter', {});
  }

  // ------------------------------------------------------------ queries

  getPose(frameId) {
    return this.poseHistory.get(frameId) || null;
  }

  /**
   * Hit test a point on the AR view. x, y are normalised view coordinates
   * ((0,0) top-left, (1,1) bottom-right), like 8th Wall's XrController.hitTest.
   * Returns [{type, position, rotation, distance}] sorted by distance.
   */
  hitTest(x, y, types = [HitTestType.DETECTED_SURFACE, HitTestType.ESTIMATED_SURFACE, HitTestType.FEATURE_POINT]) {
    const fs = this.frameState;
    if (!fs || !fs.pose) return [];
    const K = this.displayIntrinsics();
    const dCam = K.unproject(x * this.displayW - 0.5, y * this.displayH - 0.5);
    const dir = normalize3(quatRotate(fs.pose.q, dCam));
    const origin = fs.pose.t;
    const hits = [];
    const facing = (p) => {
      const toCam = sub3(origin, p);
      return quatFromYaw(Math.atan2(toCam[0], toCam[2]));
    };
    if (types.includes(HitTestType.DETECTED_SURFACE)) {
      for (const pl of this.planes) {
        if (Math.abs(dir[1]) < 1e-6) continue;
        const s = (pl.y - origin[1]) / dir[1];
        if (s <= 0) continue;
        const p = add3(origin, scale3(dir, s));
        const m = pl.margin;
        if (p[0] < pl.minX - m || p[0] > pl.maxX + m || p[2] < pl.minZ - m || p[2] > pl.maxZ + m) continue;
        hits.push({ type: HitTestType.DETECTED_SURFACE, position: p, rotation: facing(p), distance: s, plane: pl });
      }
    }
    if (types.includes(HitTestType.ESTIMATED_SURFACE) && dir[1] < -1e-6) {
      const s = -origin[1] / dir[1];
      if (s > 0 && s < 50 * Math.max(1e-3, origin[1])) {
        const p = add3(origin, scale3(dir, s));
        hits.push({ type: HitTestType.ESTIMATED_SURFACE, position: p, rotation: facing(p), distance: s });
      }
    }
    if (types.includes(HitTestType.FEATURE_POINT) && this.points.length) {
      const maxAngle = (12 / K.fy) ** 2; // ~12 display px
      let best = null;
      for (let i = 0; i < this.points.length; i += 4) {
        const p = [this.points[i], this.points[i + 1], this.points[i + 2]];
        const v = sub3(p, origin);
        const along = dot3(v, dir);
        if (along <= 0) continue;
        const perp2 = dot3(v, v) - along * along;
        if (perp2 / (along * along) > maxAngle) continue;
        if (!best || along < best.distance) best = { type: HitTestType.FEATURE_POINT, position: p, rotation: facing(p), distance: along };
      }
      if (best) hits.push(best);
    }
    return hits.sort((a, b) => a.distance - b.distance);
  }

  /** World-fixed anchors (kept consistent when the world is rescaled). */
  createAnchor(position, rotation = [0, 0, 0, 1], data = {}) {
    const a = { id: this.nextAnchorId++, position: position.slice(), rotation: rotation.slice(), ...data };
    this.anchors.set(a.id, a);
    return a;
  }

  removeAnchor(id) {
    this.anchors.delete(typeof id === 'object' ? id.id : id);
  }
}

/**
 * Detect horizontal planes as peaks in the height histogram of trusted map
 * points (8th Wall exposes these as DETECTED_SURFACE hit-test results).
 */
export function detectHorizontalPlanes(points, cameraHeight = 1, minPoints = 12) {
  const n = points.length / 4;
  if (n < minPoints) return [];
  const bin = 0.02 * cameraHeight;
  const bins = new Map();
  for (let i = 0; i < n; i++) {
    if (points[i * 4 + 3] < 0.2) continue;
    const k = Math.round(points[i * 4 + 1] / bin);
    bins.set(k, (bins.get(k) || 0) + 1);
  }
  const planes = [];
  const used = new Set();
  const keys = [...bins.keys()].sort((a, b) => bins.get(b) - bins.get(a));
  for (const k of keys) {
    if (used.has(k)) continue;
    const count = (bins.get(k) || 0) + (bins.get(k - 1) || 0) + (bins.get(k + 1) || 0);
    if (count < minPoints) break;
    used.add(k - 1); used.add(k); used.add(k + 1);
    let sy = 0; let c = 0;
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      if (points[i * 4 + 3] < 0.2) continue;
      const kk = Math.round(points[i * 4 + 1] / bin);
      if (Math.abs(kk - k) > 1) continue;
      const x = points[i * 4];
      const z = points[i * 4 + 2];
      sy += points[i * 4 + 1]; c++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    planes.push({ y: sy / c, minX, maxX, minZ, maxZ, count: c, margin: 0.15 * cameraHeight });
  }
  return planes.sort((a, b) => b.count - a.count);
}
