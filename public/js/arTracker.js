// AR layer for the tabletop suite, built on the Plinth library
// (public/lib/plinth). Keeps the interface app.js expects:
//   boardRoot, update(dt), startCamera(), toggleMode(), setLocked(),
//   setBoardScale(), requestMotionPermission(), locked, mode
//
// The board is attached to a world anchor:
//   * the printed QR marker (shared reference for every player's phone,
//     with metric scale from its known printed size), or
//   * a tap on the table when no marker is used (solo play).
// Plinth's visual-inertial tracking keeps the anchor fixed in the room when
// the marker leaves the view, and draws the camera feed in sync with the pose.

import * as THREE from '../vendor/three/three.module.js';
import { PlinthThree } from '../lib/plinth/three/index.js';
import { MarkerAnchor, createJsQrDetector } from '../lib/plinth/marker/marker-anchor.js';
import { HitTestType } from '../lib/plinth/core/engine.js';

const MARKER_PAYLOAD = 'TABLETOP-AR-ANCHOR-V1';
// anchor.html prints the code in an 11 cm box including a 2-module quiet zone:
// a version-3 code (29 modules) is 11 * 29 / 33 = 9.67 cm between its corners.
const MARKER_SIZE_M = 0.0967;
// Game units: the board was designed around the marker's half-width = 1 unit.
const BOARD_UNIT_M = MARKER_SIZE_M / 2;
// Typical phone height above a table when looking down at it.
const ASSUMED_CAMERA_HEIGHT_M = 0.45;

export class ARTracker {
  constructor({ videoEl, canvasEl, onStatus }) {
    this.videoEl = videoEl;
    this.canvasEl = canvasEl;
    this.onStatus = onStatus || (() => {});
    this.mode = 'ar';
    this.locked = false;
    this.boardScale = 1.0;
    this.anchorSource = null; // 'marker' | 'tap'
    this.anchor = null; // engine anchor the board follows
    this.markerVisible = false;
    this.lastMarkerAt = 0;
    this.cameraStarted = false;

    // The camera feed is drawn by WebGL in sync with tracking; the <video>
    // element only decodes frames and must stay (invisibly) in the DOM.
    Object.assign(videoEl.style, {
      position: 'fixed', left: '0', top: '0', width: '2px', height: '2px',
      opacity: '0', pointerEvents: 'none', zIndex: '-1',
    });

    this.ar = new PlinthThree({
      canvas: canvasEl,
      cameraHeight: ASSUMED_CAMERA_HEIGHT_M,
      capture: { video: videoEl, resolution: 'high' },
      near: 0.01,
      far: 60,
    });
    this.renderer = this.ar.renderer;
    this.scene = this.ar.scene;
    this.camera = this.ar.camera;
    this.engine = this.ar.engine;

    // Board: pivot follows the anchor; boardRoot is in game units.
    this.boardPivot = new THREE.Group();
    this.boardPivot.visible = false;
    this.scene.add(this.boardPivot);
    this.boardRoot = new THREE.Group();
    this.boardPivot.add(this.boardRoot);
    this._applyBoardScale();
    this._addBoardLights();

    // Preview mode (no camera): a virtual table and an orbit camera.
    this.previewEnv = this._createPreviewTabletop();
    this.previewEnv.visible = false;
    this.scene.add(this.previewEnv);
    this.previewCamera = new THREE.PerspectiveCamera(48, 1, 0.05, 200);
    this.previewAngle = 0.0;
    this.previewPitch = 0.62;
    this.previewDist = 13.5;
    this._bindPreviewDrag();

    // Printed QR marker.
    this.marker = new MarkerAnchor({
      detector: createJsQrDetector({ scriptUrl: new URL('../vendor/jsqr/jsQR.js', import.meta.url).href }),
      size: MARKER_SIZE_M,
      match: MARKER_PAYLOAD,
      every: 3,
      scanLongSide: 720,
    });
    this.engine.addPipelineModule(this.marker);
    this.engine.on('markerfound', ({ anchor }) => this._onMarker(anchor, true));
    this.engine.on('markerupdated', ({ anchor }) => this._onMarker(anchor, false));
    this.engine.on('markerlost', () => { this.markerVisible = false; this._emitStatus(); });
    this.engine.on('trackingstatus', () => this._emitStatus());
    this.engine.on('motionpermission', () => this._emitStatus());
    this.engine.on('camerastatuschange', ({ status, error }) => {
      if (status === 'failed') this.setPreviewMode(`Camera unavailable — Tabletop Preview active (${error?.message || error})`);
    });

    // Tap on the table to place the board when no marker is in use.
    this._tapStart = null;
    canvasEl.addEventListener('pointerdown', (e) => { this._tapStart = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    canvasEl.addEventListener('pointerup', (e) => {
      const s = this._tapStart;
      this._tapStart = null;
      if (!s || performance.now() - s.t > 350 || Math.hypot(e.clientX - s.x, e.clientY - s.y) > 12) return;
      this._tapToPlace(e.clientX, e.clientY);
    });

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  // ------------------------------------------------------------ setup helpers

  _addBoardLights() {
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x334155, 1.2);
    const dir = new THREE.DirectionalLight(0xffffff, 1.35);
    dir.position.set(5, 11, 6);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 30;
    dir.shadow.camera.left = -8;
    dir.shadow.camera.right = 8;
    dir.shadow.camera.top = 8;
    dir.shadow.camera.bottom = -8;
    this.boardRoot.add(hemi, dir, dir.target);
    this.lights = { hemi, dir };
  }

  _createPreviewTabletop() {
    const group = new THREE.Group();
    const table = new THREE.Mesh(
      new THREE.BoxGeometry(22, 0.6, 16),
      new THREE.MeshStandardMaterial({ color: 0x7c4d2b, roughness: 0.72, metalness: 0.05 }),
    );
    table.position.set(0, -0.45, 0);
    table.receiveShadow = true;
    group.add(table);
    return group;
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
      this.previewAngle -= (e.clientX - lastX) * 0.006;
      this.previewPitch = Math.max(0.25, Math.min(1.25, this.previewPitch + (e.clientY - lastY) * 0.005));
      lastX = e.clientX;
      lastY = e.clientY;
    });
    window.addEventListener('pointerup', () => { dragging = false; });
  }

  _applyBoardScale() {
    this.boardRoot.scale.setScalar(BOARD_UNIT_M * this.boardScale);
  }

  resize() {
    this.ar.resize();
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.previewCamera.aspect = w / Math.max(1, h);
    this.previewCamera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ anchoring

  _onMarker(anchor, found) {
    this.markerVisible = true;
    this.lastMarkerAt = performance.now();
    if (this.anchorSource !== 'marker' || this.anchor !== anchor) {
      // The shared marker always wins over a tap placement.
      if (this.anchorSource === 'tap' && this.anchor) this.engine.removeAnchor(this.anchor);
      this.anchor = anchor;
      this.anchorSource = 'marker';
    }
    if (found) this._emitStatus({ message: 'QR Anchor locked — board placed' });
  }

  _tapToPlace(x, y) {
    if (this.mode !== 'ar' || this.locked || this.anchorSource === 'marker') return;
    if (this.engine.trackingStatus !== 'NORMAL') return;
    const hit = this.ar.hitTest(x, y, [HitTestType.DETECTED_SURFACE, HitTestType.ESTIMATED_SURFACE])[0];
    if (!hit) return;
    if (this.anchor && this.anchorSource === 'tap') this.engine.removeAnchor(this.anchor);
    // Face the board's +Z side (its "front") toward the player.
    this.anchor = this.engine.createAnchor(hit.position, hit.rotation, { source: 'tap' });
    this.anchorSource = 'tap';
    this._emitStatus({ message: 'Board placed — tap elsewhere to move it' });
  }

  get hasAnchoredOnce() {
    return !!this.anchor;
  }

  // ------------------------------------------------------------ public API

  async startCamera() {
    if (this.cameraStarted) {
      this.mode = 'ar';
      this.previewEnv.visible = false;
      this._emitStatus();
      return true;
    }
    try {
      await this.ar.start();
      this.cameraStarted = true;
      this.mode = 'ar';
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
    this.ar.stop();
    this.cameraStarted = false;
    // Restarting the camera starts a new tracking world, so the old anchor
    // means nothing: re-find the QR (or tap the table) after returning.
    this.anchor = null;
    this.anchorSource = null;
    this.markerVisible = false;
    this.boardPivot.visible = false;
  }

  async requestMotionPermission() {
    const ok = await this.ar.requestMotionPermission();
    this._emitStatus();
    return ok;
  }

  setPreviewMode(reason) {
    this.mode = 'preview';
    this.previewEnv.visible = true;
    this.boardPivot.visible = true;
    this.boardPivot.position.set(0, 0, 0);
    this.boardPivot.quaternion.identity();
    this._emitStatus({ anchored: true, locked: false, message: reason || 'Tabletop Preview Mode (drag sky to orbit)' });
  }

  async toggleMode() {
    if (this.mode === 'preview') {
      const ok = await this.startCamera();
      return ok ? 'ar' : 'preview';
    }
    this.stopCamera();
    this.setPreviewMode('Tabletop Preview Mode');
    return 'preview';
  }

  /**
   * Which way the player is looking across the board, in board (game) space:
   * { forward: [x, z], right: [x, z] } unit vectors on the board plane, or
   * null if there is no board yet. Recomputed from the live camera pose, so
   * it follows the player as they walk around the table.
   */
  getBoardViewBasis() {
    const cam = this.mode === 'preview' ? this.previewCamera : this.camera;
    if (this.mode !== 'preview' && !this.anchor) return null;
    const v = this._basisTmp || (this._basisTmp = {
      camQ: new THREE.Quaternion(),
      boardQ: new THREE.Quaternion(),
      fwd: new THREE.Vector3(),
      up: new THREE.Vector3(),
    });
    this.boardRoot.updateWorldMatrix(true, false);
    cam.updateWorldMatrix(true, false);
    cam.getWorldQuaternion(v.camQ);
    this.boardRoot.getWorldQuaternion(v.boardQ);
    // Camera direction in board space: q_board^-1 * q_cam.
    v.camQ.premultiply(v.boardQ.invert());
    v.fwd.set(0, 0, -1).applyQuaternion(v.camQ);
    v.up.set(0, 1, 0).applyQuaternion(v.camQ);
    // View direction + screen-up, flattened onto the board: the view
    // direction dominates when the phone is held upright, screen-up when it
    // is held flat over the table, and the sum is well defined in between.
    let fx = v.fwd.x + v.up.x;
    let fz = v.fwd.z + v.up.z;
    const len = Math.hypot(fx, fz);
    if (len < 1e-4) return null;
    fx /= len;
    fz /= len;
    // Right-hand side on a y-up board: forward x up.
    return { forward: [fx, fz], right: [-fz, fx] };
  }

  setLocked(locked) {
    this.locked = Boolean(locked);
    // Locked: keep the board exactly where it is in the room (tracking keeps
    // running); unlocked: marker sightings refine its position again.
    this.marker.frozen = this.locked;
    this._emitStatus({
      message: this.locked ? 'Board locked in place' : 'Live tracking — board follows the QR anchor',
    });
  }

  replaceBoard() {
    if (this.mode !== 'ar') return;
    if (this.anchor) {
      this.engine.removeAnchor(this.anchor);
      this.anchor = null;
    }
    this.anchorSource = null;
    this.markerVisible = false;
    this.locked = false;
    this.marker.frozen = false;
    this.marker.anchor = null;
    this.marker.state = 'searching';
    this.boardPivot.visible = false;
    this._emitStatus({ message: 'Point at the printed QR — or tap the table to place the board' });
  }

  setBoardScale(scale) {
    this.boardScale = Math.max(0.5, Math.min(2.0, Number(scale) || 1.0));
    this._applyBoardScale();
  }

  _emitStatus(extra = {}) {
    const engine = this.engine;
    const tracking = engine.trackingStatus;
    const reason = engine.trackingReason;
    const anchored = !!this.anchor;
    const stale = anchored && this.anchorSource === 'marker' && !this.markerVisible;
    let message;
    if (this.mode === 'preview') message = 'Tabletop Preview Mode';
    else if (!this.cameraStarted) message = 'Starting camera...';
    else if (reason === 'RELOCALIZING') message = 'Tracking lost — point back at the table';
    else if (!anchored) {
      message = tracking === 'NORMAL'
        ? 'Point at the printed QR — or tap the table to place the board'
        : 'Point the camera at the table';
    } else if (this.locked) message = 'Board locked in place';
    else if (tracking !== 'NORMAL') message = 'Move slowly — limited tracking';
    else message = this.anchorSource === 'marker'
      ? (stale ? 'Board anchored (QR out of view)' : 'QR Anchor locked')
      : 'Board placed on table';
    this.onStatus({
      mode: this.mode,
      anchored,
      locked: this.locked,
      stale,
      tracking,
      reason,
      hasImu: !!engine.imu?.available,
      needsMotionPermission: engine.needsMotionPermission,
      message,
      ...extra,
    });
  }

  update() {
    if (this.mode === 'preview') {
      const camX = Math.sin(this.previewAngle) * Math.cos(this.previewPitch) * this.previewDist;
      const camY = Math.sin(this.previewPitch) * this.previewDist;
      const camZ = Math.cos(this.previewAngle) * Math.cos(this.previewPitch) * this.previewDist;
      this.previewCamera.position.set(camX, camY, camZ);
      this.previewCamera.lookAt(0, 0.4, 0);
      // Preview renders the board at game-unit scale around the origin.
      this.boardRoot.scale.setScalar(this.boardScale);
      this.renderer.setRenderTarget(null);
      this.renderer.setClearColor(0x0b1220, 1);
      this.renderer.clear();
      this.renderer.render(this.scene, this.previewCamera);
      return;
    }
    this._applyBoardScale();
    if (this.anchor) {
      const a = this.anchor;
      this.boardPivot.position.set(a.position[0], a.position[1], a.position[2]);
      this.boardPivot.quaternion.set(a.rotation[0], a.rotation[1], a.rotation[2], a.rotation[3]);
      this.boardPivot.visible = true;
    } else {
      this.boardPivot.visible = false;
    }
    if (this.markerVisible && performance.now() - this.lastMarkerAt > 2000) {
      this.markerVisible = false;
      this._emitStatus();
    }
    this.lights.hemi.intensity = 1.2 * this.ar.lightScale;
    this.lights.dir.intensity = 1.35 * this.ar.lightScale;
    this.ar.update(performance.now());
  }
}
