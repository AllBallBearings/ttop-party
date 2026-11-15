import * as THREE from '../vendor/three/three.module.js';

/**
 * Solves an 8x8 linear system A * x = b via Gaussian elimination with partial pivoting.
 */
function solveLinear8(A, b) {
  const n = 8;
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
 * Estimates 6DoF board pose (position + quaternion) in Three.js camera space
 * from the 4 detected QR code corners.
 *
 * Marker plane sits at Y = 0 in board space:
 *   TL = (-m, 0, -m), TR = (+m, 0, -m), BR = (+m, 0, +m), BL = (-m, 0, +m)
 */
function estimatePoseFromCorners(corners, videoW, videoH, fVideo, markerHalfSize = 1.0) {
  const cx = videoW * 0.5;
  const cy = videoH * 0.5;
  const m = markerHalfSize;

  const worldPts = [
    [-m, -m], // topLeft
    [m, -m],  // topRight
    [m, m],   // bottomRight
    [-m, m],  // bottomLeft
  ];

  const imgPts = [
    corners.topLeftCorner,
    corners.topRightCorner,
    corners.bottomRightCorner,
    corners.bottomLeftCorner,
  ];

  const A = [];
  const b = [];

  for (let i = 0; i < 4; i++) {
    const [X, Z] = worldPts[i];
    const u = (imgPts[i].x - cx) / fVideo;
    const v = -(imgPts[i].y - cy) / fVideo;

    A.push([X, Z, 1, 0, 0, 0, -u * X, -u * Z]);
    b.push(u);
    A.push([0, 0, 0, X, Z, 1, -v * X, -v * Z]);
    b.push(v);
  }

  const h = solveLinear8(A, b);
  if (!h) return null;

  // Homography columns in normalized image space:
  // [u', v', w']^T = H * [X, Z, 1]^T with u = u'/w', v = v'/w'
  // Since camera looks along -Z_c: u = X_c / (-Z_c), v = Y_c / (-Z_c)
  // => [X_c, Y_c, Z_c]^T = lambda * [u', v', -w']^T
  const c1 = new THREE.Vector3(h[0], h[3], -h[6]);
  const c2 = new THREE.Vector3(h[1], h[4], -h[7]);
  const c3 = new THREE.Vector3(h[2], h[5], -1.0);

  const norm1 = c1.length();
  const norm2 = c2.length();
  if (norm1 < 1e-6 || norm2 < 1e-6) return null;

  const scale = 2.0 / (norm1 + norm2);
  // Ensure marker sits in front of the camera (Z_c < 0)
  const sign = c3.z * scale > 0 ? -1 : 1;

  const r1 = c1.clone().multiplyScalar(sign * scale);
  const r3 = c2.clone().multiplyScalar(sign * scale);
  const t = c3.clone().multiplyScalar(sign * scale);

  if (t.z > -0.2 || t.length() > 60) return null;

  // Orthonormalize right-handed basis [r1 (X), r2 (Y up), r3 (Z)]
  r1.normalize();
  r3.addScaledVector(r1, -r1.dot(r3)).normalize();
  const r2 = new THREE.Vector3().crossVectors(r3, r1).normalize();

  // Re-orthogonalize r3 to ensure exact frame
  r3.crossVectors(r1, r2).normalize();

  const rotMatrix = new THREE.Matrix4().makeBasis(r1, r2, r3);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

  return { position: t, quaternion };
}

export class ARTracker {
  constructor({ videoEl, canvasEl, onStatus }) {
    this.videoEl = videoEl;
    this.canvasEl = canvasEl;
    this.onStatus = onStatus || (() => {});

    this.mode = 'ar'; // 'ar' | 'preview'
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

    // Root group anchored to the QR code on the tabletop
    this.boardRoot = new THREE.Group();
    this.boardRoot.visible = false;
    this.scene.add(this.boardRoot);

    // Tabletop preview environment (shown only in preview mode)
    this.previewEnv = this._createPreviewTabletop();
    this.previewEnv.visible = false;
    this.scene.add(this.previewEnv);

    // Lights
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x334155, 1.15);
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

    // Smooth target pose
    this.hasAnchoredOnce = false;
    this.lastSeenAt = 0;
    this.targetPos = new THREE.Vector3(0, -1.5, -10);
    this.targetQuat = new THREE.Quaternion();
    this.smoothedPos = new THREE.Vector3(0, -1.5, -10);
    this.smoothedQuat = new THREE.Quaternion();

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
    this.resize();
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
    table.position.set(0, -0.32, 0);
    table.receiveShadow = true;
    group.add(table);

    // Subtle printed QR anchor decal at center of preview table
    const qrPlate = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 2.0),
      new THREE.MeshBasicMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.85 })
    );
    qrPlate.rotation.x = -Math.PI / 2;
    qrPlate.position.y = 0.002;
    group.add(qrPlate);

    const qrInner = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({ color: 0x0f172a, wireframe: true })
    );
    qrInner.rotation.x = -Math.PI / 2;
    qrInner.position.y = 0.004;
    group.add(qrInner);

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
      this.onStatus({
        mode: 'ar',
        anchored: this.hasAnchoredOnce,
        locked: this.locked,
        message: this.hasAnchoredOnce ? 'QR Anchor Active' : 'Point camera at printed QR code on table',
      });
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
    this.onStatus({
      mode: 'preview',
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
    this.onStatus({
      mode: this.mode,
      anchored: this.hasAnchoredOnce,
      locked: this.locked,
      message: this.locked ? 'Board Position Locked' : 'Live QR Tracking Active',
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

    const sx = vw / this.lastScanW;
    const sy = vh / this.lastScanH;

    const scaledCorners = {
      topLeftCorner: { x: result.location.topLeftCorner.x * sx, y: result.location.topLeftCorner.y * sy },
      topRightCorner: { x: result.location.topRightCorner.x * sx, y: result.location.topRightCorner.y * sy },
      bottomRightCorner: { x: result.location.bottomRightCorner.x * sx, y: result.location.bottomRightCorner.y * sy },
      bottomLeftCorner: { x: result.location.bottomLeftCorner.x * sx, y: result.location.bottomLeftCorner.y * sy },
    };

    const fVideo = 0.82 * Math.max(vw, vh);
    const pose = estimatePoseFromCorners(scaledCorners, vw, vh, fVideo, 1.0);
    if (!pose) return;

    const now = performance.now();
    // Reject sudden wild outlier jumps unless anchor has been stale > 750ms
    if (this.hasAnchoredOnce && now - this.lastSeenAt < 750) {
      const jumpDist = pose.position.distanceTo(this.targetPos);
      if (jumpDist > 4.5) return;
    }

    this.targetPos.copy(pose.position);
    this.targetQuat.copy(pose.quaternion);
    this.lastSeenAt = now;

    if (!this.hasAnchoredOnce) {
      this.hasAnchoredOnce = true;
      this.smoothedPos.copy(pose.position);
      this.smoothedQuat.copy(pose.quaternion);
      this.boardRoot.visible = true;
    }

    this.onStatus({
      mode: 'ar',
      anchored: true,
      locked: this.locked,
      qrData: result.data,
      message: 'QR Anchor Locked',
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

    // AR Mode
    const vw = this.videoEl.videoWidth;
    const vh = this.videoEl.videoHeight;

    if (vw > 0 && vh > 0) {
      // Match Three.js camera projection to CSS object-fit: cover video scaling
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

      // Dispatch QR detection frame to worker if idle
      if (!this.workerBusy && !this.locked && this.videoEl.readyState >= 2) {
        const targetW = 480;
        const targetH = Math.max(180, Math.round((vh / vw) * targetW));
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

    if (this.hasAnchoredOnce) {
      const alpha = Math.min(1, dt * 14);
      this.smoothedPos.lerp(this.targetPos, alpha);
      this.smoothedQuat.slerp(this.targetQuat, alpha);

      this.boardRoot.visible = true;
      this.boardRoot.position.copy(this.smoothedPos);
      this.boardRoot.quaternion.copy(this.smoothedQuat);
      this.boardRoot.scale.setScalar(this.boardScale);

      const age = performance.now() - this.lastSeenAt;
      if (!this.locked && age > 1200) {
        this.onStatus({
          mode: 'ar',
          anchored: true,
          stale: true,
          locked: false,
          message: 'Hold QR code in view to keep tracking',
        });
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
