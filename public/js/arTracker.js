import * as THREE from '../vendor/three/three.module.js';

class LowPassFilter {
  constructor(alpha = 1.0) {
    this.s = 0;
    this.initialized = false;
    this.alpha = alpha;
  }

  reset() {
    this.initialized = false;
    this.s = 0;
  }

  filter(value, alpha) {
    this.alpha = Math.max(0.001, Math.min(1, alpha));
    if (!this.initialized) {
      this.initialized = true;
      this.s = value;
      return value;
    }
    this.s = this.alpha * value + (1 - this.alpha) * this.s;
    return this.s;
  }
}

/**
 * Adaptive One-Euro Filter: heavy smoothing when still (kills 1px jitter),
 * fast response when moving.
 */
class OneEuroFilter {
  constructor({ minCutoff = 0.65, beta = 0.07, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPassFilter();
    this.dx = new LowPassFilter();
    this.lastTime = null;
  }

  _alpha(cutoff, dt) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  reset() {
    this.x.reset();
    this.dx.reset();
    this.lastTime = null;
  }

  filter(value, timeSec) {
    if (this.lastTime === null) {
      this.lastTime = timeSec;
      return this.x.filter(value, 1.0);
    }
    const dt = Math.max(1 / 120, Math.min(0.25, timeSec - this.lastTime));
    this.lastTime = timeSec;

    const dVal = (value - this.x.s) / dt;
    const edVal = this.dx.filter(dVal, this._alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edVal);
    return this.x.filter(value, this._alpha(cutoff, dt));
  }
}

/**
 * Solves an NxN linear system A * x = b via Gaussian elimination with partial pivoting.
 */
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const val = Math.abs(M[r][col]);
      if (val > maxVal) {
        maxVal = val;
        pivotRow = r;
      }
    }
    if (maxVal < 1e-10) return null;

    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const diag = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= diag;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let j = col; j <= n; j++) {
        M[r][j] -= factor * M[col][j];
      }
    }
  }

  return M.map((row) => row[n]);
}

/**
 * Refines 6DoF (position, quaternion) against normalized 2D corner observations
 * via 4 damped Gauss-Newton iterations to minimize geometric reprojection error.
 */
function refinePoseGaussNewton(pos, quat, worldPts, obsUV, iterations = 4) {
  const p = pos.clone();
  const q = quat.clone();

  const evalResiduals = (testP, testQ) => {
    const r = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < 4; i++) {
      v.set(worldPts[i][0], 0, worldPts[i][1]).applyQuaternion(testQ).add(testP);
      if (v.z >= -0.05) return null;
      const u = v.x / -v.z;
      const w = v.y / -v.z;
      r.push(u - obsUV[i][0], w - obsUV[i][1]);
    }
    return r;
  };

  const eps = 1e-4;
  const dq = new THREE.Quaternion();
  const euler = new THREE.Euler();

  for (let iter = 0; iter < iterations; iter++) {
    const r0 = evalResiduals(p, q);
    if (!r0) break;

    const J = Array.from({ length: 8 }, () => new Array(6).fill(0));
    for (let k = 0; k < 6; k++) {
      const tp = p.clone();
      const tq = q.clone();
      if (k === 0) tp.x += eps;
      else if (k === 1) tp.y += eps;
      else if (k === 2) tp.z += eps;
      else {
        euler.set(k === 3 ? eps : 0, k === 4 ? eps : 0, k === 5 ? eps : 0, 'XYZ');
        dq.setFromEuler(euler);
        tq.multiply(dq);
      }
      const rk = evalResiduals(tp, tq);
      if (!rk) continue;
      for (let row = 0; row < 8; row++) {
        J[row][k] = (rk[row] - r0[row]) / eps;
      }
    }

    // Normal equations: (J^T J + lambda * I) * delta = -J^T r0
    const JTJ = Array.from({ length: 6 }, () => new Array(6).fill(0));
    const JTr = new Array(6).fill(0);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        let sum = 0;
        for (let row = 0; row < 8; row++) sum += J[row][i] * J[row][j];
        JTJ[i][j] = sum + (i === j ? 1e-3 : 0);
      }
      let rsum = 0;
      for (let row = 0; row < 8; row++) rsum += J[row][i] * r0[row];
      JTr[i] = -rsum;
    }

    const delta = solveLinear(JTJ, JTr);
    if (!delta) break;

    const stepNorm = Math.hypot(...delta);
    if (stepNorm < 1e-5) break;

    const nextP = p.clone().add(new THREE.Vector3(delta[0], delta[1], delta[2]));
    euler.set(delta[3], delta[4], delta[5], 'XYZ');
    dq.setFromEuler(euler);
    const nextQ = q.clone().multiply(dq).normalize();

    const rNext = evalResiduals(nextP, nextQ);
    if (!rNext) break;

    const err0 = r0.reduce((s, val) => s + val * val, 0);
    const err1 = rNext.reduce((s, val) => s + val * val, 0);
    if (err1 <= err0) {
      p.copy(nextP);
      q.copy(nextQ);
    } else {
      break;
    }
  }

  return { position: p, quaternion: q };
}

/**
 * Estimates 6DoF board pose (position + quaternion) in Three.js camera space
 * from the 4 detected QR code corners.
 */
function estimatePoseFromCorners(corners, videoW, videoH, fVideo, markerHalfSize = 1.0) {
  const cx = videoW * 0.5;
  const cy = videoH * 0.5;
  const m = markerHalfSize;

  const worldPts = [
    [-m, -m],
    [m, -m],
    [m, m],
    [-m, m],
  ];

  const imgPts = [
    corners.topLeftCorner,
    corners.topRightCorner,
    corners.bottomRightCorner,
    corners.bottomLeftCorner,
  ];

  const A = [];
  const b = [];
  const obsUV = [];

  for (let i = 0; i < 4; i++) {
    const [X, Z] = worldPts[i];
    const u = (imgPts[i].x - cx) / fVideo;
    const v = -(imgPts[i].y - cy) / fVideo;
    obsUV.push([u, v]);

    A.push([X, Z, 1, 0, 0, 0, -u * X, -u * Z]);
    b.push(u);
    A.push([0, 0, 0, X, Z, 1, -v * X, -v * Z]);
    b.push(v);
  }

  const h = solveLinear(A, b);
  if (!h) return null;

  const c1 = new THREE.Vector3(h[0], h[3], -h[6]);
  const c2 = new THREE.Vector3(h[1], h[4], -h[7]);
  const c3 = new THREE.Vector3(h[2], h[5], -1.0);

  const norm1 = c1.length();
  const norm2 = c2.length();
  if (norm1 < 1e-6 || norm2 < 1e-6) return null;

  const scale = 2.0 / (norm1 + norm2);
  const sign = c3.z * scale > 0 ? -1 : 1;

  const r1 = c1.clone().multiplyScalar(sign * scale);
  const r3 = c2.clone().multiplyScalar(sign * scale);
  const t = c3.clone().multiplyScalar(sign * scale);

  if (t.z > -0.2 || t.length() > 60) return null;

  r1.normalize();
  r3.addScaledVector(r1, -r1.dot(r3)).normalize();
  const r2 = new THREE.Vector3().crossVectors(r3, r1).normalize();
  r3.crossVectors(r1, r2).normalize();

  const rotMatrix = new THREE.Matrix4().makeBasis(r1, r2, r3);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

  return refinePoseGaussNewton(t, quaternion, worldPts, obsUV, 4);
}

const ZEE_AXIS = new THREE.Vector3(0, 0, 1);
const CAMERA_OFFSET_QUAT = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

function deviceOrientationToQuat(alphaDeg, betaDeg, gammaDeg, screenAngleDeg) {
  const alpha = THREE.MathUtils.degToRad(alphaDeg || 0);
  const beta = THREE.MathUtils.degToRad(betaDeg || 0);
  const gamma = THREE.MathUtils.degToRad(gammaDeg || 0);
  const orient = THREE.MathUtils.degToRad(screenAngleDeg || 0);

  const euler = new THREE.Euler(beta, alpha, -gamma, 'YXZ');
  const q = new THREE.Quaternion().setFromEuler(euler);
  q.multiply(CAMERA_OFFSET_QUAT);
  const qScreen = new THREE.Quaternion().setFromAxisAngle(ZEE_AXIS, -orient);
  q.multiply(qScreen);
  return q;
}

export class ARTracker {
  constructor({ videoEl, canvasEl, onStatus }) {
    this.videoEl = videoEl;
    this.canvasEl = canvasEl;
    this.onStatus = onStatus || (() => {});

    this.mode = 'ar';
    this.locked = false;
    this.boardScale = 1.0;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvasEl,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 120);

    this.boardRoot = new THREE.Group();
    this.boardRoot.visible = false;
    this.scene.add(this.boardRoot);

    this.previewEnv = this._createPreviewTabletop();
    this.previewEnv.visible = false;
    this.scene.add(this.previewEnv);

    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x334155, 1.2);
    this.scene.add(hemi);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.35);
    dirLight.position.set(5, 11, 6);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 30;
    dirLight.shadow.camera.left = -8;
    dirLight.shadow.camera.right = 8;
    dirLight.shadow.camera.top = 8;
    dirLight.shadow.camera.bottom = -8;
    this.boardRoot.add(dirLight);
    this.boardRoot.add(dirLight.target);

    // Pose state (camera space, fused with IMU gyroscope)
    this.hasAnchoredOnce = false;
    this.lastSeenAt = 0;
    this.fusedPos = new THREE.Vector3(0, -1.5, -10);
    this.fusedQuat = new THREE.Quaternion();
    this.displayPos = new THREE.Vector3(0, -1.5, -10);
    this.displayQuat = new THREE.Quaternion();

    // Corner One-Euro filters (8 scalars for 4 corners)
    this.cornerFilters = Array.from({ length: 8 }, () =>
      new OneEuroFilter({ minCutoff: 0.55, beta: 0.06, dCutoff: 1.0 })
    );
    this.posFilters = [
      new OneEuroFilter({ minCutoff: 0.75, beta: 0.35 }),
      new OneEuroFilter({ minCutoff: 0.75, beta: 0.35 }),
      new OneEuroFilter({ minCutoff: 0.75, beta: 0.35 }),
    ];

    // IMU / Gyroscope fusion state
    this.hasImu = false;
    this.imuNeededPermission =
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function';
    this.imuPermissionGranted = !this.imuNeededPermission;
    this.imuQuat = new THREE.Quaternion();
    this.prevImuQuat = new THREE.Quaternion();
    this.hasPrevImu = false;
    this.recentImuSpeed = 0;

    // QR worker setup
    this.scanCanvas = document.createElement('canvas');
    this.scanCtx = this.scanCanvas.getContext('2d', { willReadFrequently: true });
    this.worker = new Worker(new URL('./qrWorker.js', import.meta.url));
    this.workerBusy = false;
    this.lastScanVideoW = 0;
    this.lastScanVideoH = 0;
    this.lastScanW = 0;
    this.lastScanH = 0;

    this.worker.onmessage = (e) => {
      this.workerBusy = false;
      this._onQrResult(e.data);
    };

    this.stream = null;
    this.previewAngle = 0.0;
    this.previewPitch = 0.62;
    this.previewDist = 13.5;

    this._bindResize();
    this._bindPreviewDrag();
    this._bindDeviceOrientation();
    this.resize();
  }

  _bindDeviceOrientation() {
    const handler = (e) => {
      if (e.alpha === null || e.beta === null || e.gamma === null) return;
      const screenAngle =
        (window.screen && window.screen.orientation && window.screen.orientation.angle) ||
        window.orientation ||
        0;
      const q = deviceOrientationToQuat(e.alpha, e.beta, e.gamma, screenAngle);
      this.imuQuat.copy(q);
      this.hasImu = true;
      this.imuPermissionGranted = true;
    };

    this._orientationHandler = handler;
    if (!this.imuNeededPermission && typeof window !== 'undefined') {
      window.addEventListener('deviceorientation', handler, true);
    }
  }

  async requestMotionPermission() {
    if (!this.imuNeededPermission || this.imuPermissionGranted) return true;
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res === 'granted') {
        this.imuPermissionGranted = true;
        window.addEventListener('deviceorientation', this._orientationHandler, true);
        this._emitStatus();
        return true;
      }
    } catch {
      // Ignore if not triggered inside user gesture
    }
    return false;
  }

  _emitStatus(extra = {}) {
    this.onStatus({
      mode: this.mode,
      anchored: this.hasAnchoredOnce,
      locked: this.locked,
      hasImu: this.hasImu,
      needsMotionPermission: this.imuNeededPermission && !this.imuPermissionGranted,
      message: extra.message || (
        this.mode === 'preview'
          ? 'Tabletop Preview Mode'
          : this.locked
            ? 'Board Locked'
            : this.hasAnchoredOnce
              ? 'QR Anchor Active'
              : 'Point camera at printed QR code on table'
      ),
      ...extra,
    });
  }

  _createPreviewTabletop() {
    const group = new THREE.Group();
    const tableGeo = new THREE.BoxGeometry(22, 0.6, 16);
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x7c4d2b,
      roughness: 0.72,
      metalness: 0.05,
    });
    const table = new THREE.Mesh(tableGeo, tableMat);
    table.position.set(0, -0.45, 0);
    table.receiveShadow = true;
    group.add(table);
    return group;
  }

  _bindResize() {
    window.addEventListener('resize', () => this.resize());
  }

  _bindPreviewDrag() {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    this.canvasEl.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'preview') return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    window.addEventListener('pointermove', (e) => {
      if (!dragging || this.mode !== 'preview') return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      this.previewAngle -= dx * 0.006;
      this.previewPitch = Math.max(0.25, Math.min(1.25, this.previewPitch + dy * 0.005));
    });
    window.addEventListener('pointerup', () => {
      dragging = false;
    });
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  async startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.setPreviewMode('Camera API unavailable (use HTTPS or Preview Mode)');
      return false;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      this.videoEl.srcObject = this.stream;
      await this.videoEl.play();
      this.mode = 'ar';
      this.videoEl.style.display = 'block';
      this.previewEnv.visible = false;
      this._emitStatus();
      return true;
    } catch (err) {
      console.warn('Camera start failed, switching to Tabletop Preview Mode:', err);
      this.setPreviewMode('Camera unavailable — Tabletop Preview active');
      return false;
    }
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.videoEl.srcObject = null;
  }

  setPreviewMode(reason) {
    this.mode = 'preview';
    this.videoEl.style.display = 'none';
    this.previewEnv.visible = true;
    this.boardRoot.visible = true;
    this.boardRoot.position.set(0, 0, 0);
    this.boardRoot.quaternion.identity();
    this.boardRoot.scale.setScalar(1);
    this._emitStatus({
      anchored: true,
      locked: false,
      message: reason || 'Tabletop Preview Mode (drag sky to orbit)',
    });
  }

  async toggleMode() {
    if (this.mode === 'preview') {
      const ok = await this.startCamera();
      if (!ok) return 'preview';
      return 'ar';
    }
    this.stopCamera();
    this.setPreviewMode('Tabletop Preview Mode');
    return 'preview';
  }

  setLocked(locked) {
    this.locked = Boolean(locked);
    this._emitStatus({
      message: this.locked
        ? (this.hasImu ? 'QR Locked (Motion Pan Active)' : 'Board Position Locked')
        : 'Live QR + Motion Tracking',
    });
  }

  setBoardScale(scale) {
    this.boardScale = Math.max(0.5, Math.min(2.0, Number(scale) || 1.0));
  }

  _onQrResult(result) {
    if (this.mode !== 'ar' || this.locked) return;
    if (!result || !result.found) return;

    const vw = this.lastScanVideoW;
    const vh = this.lastScanVideoH;
    if (!vw || !vh) return;

    const nowMs = performance.now();
    const nowSec = nowMs / 1000;
    const timeSinceLast = nowMs - this.lastSeenAt;

    // Reset 2D corner filters if QR was out of view > 350ms so re-acquisition is instant
    if (timeSinceLast > 350) {
      for (const f of this.cornerFilters) f.reset();
    }

    const sx = vw / this.lastScanW;
    const sy = vh / this.lastScanH;

    const rawPts = [
      result.location.topLeftCorner,
      result.location.topRightCorner,
      result.location.bottomRightCorner,
      result.location.bottomLeftCorner,
    ];

    const filtPts = rawPts.map((pt, idx) => ({
      x: this.cornerFilters[idx * 2].filter(pt.x * sx, nowSec),
      y: this.cornerFilters[idx * 2 + 1].filter(pt.y * sy, nowSec),
    }));

    const scaledCorners = {
      topLeftCorner: filtPts[0],
      topRightCorner: filtPts[1],
      bottomRightCorner: filtPts[2],
      bottomLeftCorner: filtPts[3],
    };

    const fVideo = 0.82 * Math.max(vw, vh);
    const pose = estimatePoseFromCorners(scaledCorners, vw, vh, fVideo, 1.0);
    if (!pose) return;

    if (!this.hasAnchoredOnce) {
      this.hasAnchoredOnce = true;
      this.fusedPos.copy(pose.position);
      this.fusedQuat.copy(pose.quaternion);
      this.displayPos.copy(pose.position);
      this.displayQuat.copy(pose.quaternion);
      this.boardRoot.visible = true;
      this.lastSeenAt = nowMs;
      this._emitStatus({
        qrData: result.data,
        message: this.hasImu ? 'QR + Motion Locked' : 'QR Anchor Locked',
      });
      return;
    }

    // Outlier guard while actively anchored (ignore sudden single-frame misreads)
    const jumpDist = pose.position.distanceTo(this.fusedPos);
    const angleDiff = pose.quaternion.angleTo(this.fusedQuat);
    if (timeSinceLast < 1600 && (jumpDist > 4.0 || angleDiff > 0.7)) {
      return;
    }

    this.lastSeenAt = nowMs;

    // When IMU is active and phone is nearly stationary, trust IMU heavily and damp QR noise
    const isStill = this.hasImu && this.recentImuSpeed < 0.015;
    const posBlend = !this.hasImu ? 0.35 : isStill ? 0.08 : 0.22;
    const rotBlend = !this.hasImu ? 0.35 : isStill ? 0.08 : 0.24;

    this.fusedPos.lerp(pose.position, posBlend);
    this.fusedQuat.slerp(pose.quaternion, rotBlend);

    this._emitStatus({
      qrData: result.data,
      stale: false,
      message: this.hasImu ? 'QR + Motion Locked' : 'QR Anchor Locked',
    });
  }

  update(dt) {
    if (this.mode === 'preview') {
      const camX = Math.sin(this.previewAngle) * Math.cos(this.previewPitch) * this.previewDist;
      const camY = Math.sin(this.previewPitch) * this.previewDist;
      const camZ = Math.cos(this.previewAngle) * Math.cos(this.previewPitch) * this.previewDist;
      this.camera.fov = 48;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(camX, camY, camZ);
      this.camera.lookAt(0, 0.4, 0);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const vw = this.videoEl.videoWidth;
    const vh = this.videoEl.videoHeight;

    if (vw > 0 && vh > 0) {
      const viewW = window.innerWidth;
      const viewH = window.innerHeight;
      const coverScale = Math.max(viewW / vw, viewH / vh);
      const fVideo = 0.82 * Math.max(vw, vh);
      const fyView = fVideo * coverScale;
      const fovDeg = (2 * Math.atan((viewH * 0.5) / fyView) * 180) / Math.PI;
      if (Math.abs(this.camera.fov - fovDeg) > 0.1) {
        this.camera.fov = fovDeg;
        this.camera.updateProjectionMatrix();
      }
      this.camera.position.set(0, 0, 0);
      this.camera.quaternion.identity();

      if (!this.workerBusy && !this.locked && this.videoEl.readyState >= 2) {
        const targetW = 640;
        const targetH = Math.max(240, Math.round((vh / vw) * targetW));
        if (this.scanCanvas.width !== targetW || this.scanCanvas.height !== targetH) {
          this.scanCanvas.width = targetW;
          this.scanCanvas.height = targetH;
        }
        this.scanCtx.drawImage(this.videoEl, 0, 0, targetW, targetH);
        const imgData = this.scanCtx.getImageData(0, 0, targetW, targetH);

        this.lastScanVideoW = vw;
        this.lastScanVideoH = vh;
        this.lastScanW = targetW;
        this.lastScanH = targetH;
        this.workerBusy = true;
        this.worker.postMessage(
          { buffer: imgData.data.buffer, width: targetW, height: targetH },
          [imgData.data.buffer]
        );
      }
    }

    // Apply 60Hz gyroscope delta so panning left/right keeps the board anchored even when QR leaves frame
    if (this.hasImu) {
      if (this.hasPrevImu && this.hasAnchoredOnce) {
        const deltaCam = this.imuQuat.clone().invert().multiply(this.prevImuQuat);
        const stepAngle = this.imuQuat.angleTo(this.prevImuQuat);
        this.recentImuSpeed = this.recentImuSpeed * 0.7 + stepAngle * 0.3;

        this.fusedPos.applyQuaternion(deltaCam);
        this.fusedQuat.premultiply(deltaCam).normalize();
        this.displayPos.applyQuaternion(deltaCam);
        this.displayQuat.premultiply(deltaCam).normalize();
      }
      this.prevImuQuat.copy(this.imuQuat);
      this.hasPrevImu = true;
    }

    if (this.hasAnchoredOnce) {
      const nowSec = performance.now() / 1000;
      const smoothPos = new THREE.Vector3(
        this.posFilters[0].filter(this.fusedPos.x, nowSec),
        this.posFilters[1].filter(this.fusedPos.y, nowSec),
        this.posFilters[2].filter(this.fusedPos.z, nowSec)
      );

      // Blend display pose gently toward fused pose (if IMU is active, rotation updates 1:1 with gyro)
      const dispAlpha = this.hasImu ? Math.min(1, dt * 16) : Math.min(1, dt * 10);
      this.displayPos.lerp(smoothPos, dispAlpha);
      this.displayQuat.slerp(this.fusedQuat, dispAlpha);

      this.boardRoot.visible = true;
      this.boardRoot.position.copy(this.displayPos);
      this.boardRoot.quaternion.copy(this.displayQuat);
      this.boardRoot.scale.setScalar(this.boardScale);

      const age = performance.now() - this.lastSeenAt;
      if (!this.locked && age > 2000) {
        this._emitStatus({
          stale: true,
          message: this.hasImu
            ? 'Motion Pan Active — point at QR to re-sync'
            : 'Hold QR code in view (or tap Lock)',
        });
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
