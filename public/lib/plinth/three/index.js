// three.js adapter for Plinth.
//
// Mirrors how 8th Wall drives three.js: the camera's projection matrix is set
// directly from the camera intrinsics (cover-cropped to the canvas), the camera
// pose comes from the tracker, and the camera feed is drawn as the background
// from the *same frame* the pose was computed for, before the scene renders.

import * as THREE from 'three';
import { PlinthEngine, HitTestType } from '../core/engine.js';
import { coverUvTransform } from '../core/camera-model.js';
import { createProgram } from '../core/gpu.js';

const BG_VERT = `
attribute vec2 aPos;
varying vec2 vUv;
uniform vec4 uUvXform; // scaleX, scaleY, offsetX, offsetY
void main() {
  vec2 uv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); // top-left origin
  vUv = uv * uUvXform.xy + uUvXform.zw;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;
const BG_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uMirror;
void main() {
  vec2 uv = vec2(mix(vUv.x, 1.0 - vUv.x, uMirror), vUv.y);
  gl_FragColor = vec4(texture2D(uTex, uv).rgb, 1.0);
}
`;

class CameraBackground {
  constructor(gl) {
    this.gl = gl;
    this.isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    this.program = createProgram(gl, BG_VERT, BG_FRAG);
    this.uTex = gl.getUniformLocation(this.program, 'uTex');
    this.uXform = gl.getUniformLocation(this.program, 'uUvXform');
    this.uMirror = gl.getUniformLocation(this.program, 'uMirror');
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  }

  draw(texture, texW, texH, viewW, viewH, mirror = false) {
    const gl = this.gl;
    const x = coverUvTransform(texW, texH, viewW, viewH);
    if (this.isWebGL2) gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, viewW, viewH);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.uTex, 0);
    gl.uniform4f(this.uXform, x.scaleX, x.scaleY, x.offsetX, x.offsetY);
    gl.uniform1f(this.uMirror, mirror ? 1 : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

/**
 * PlinthThree: one-stop AR view for three.js.
 *
 *   const ar = new PlinthThree({ canvas });
 *   await ar.start();               // camera + motion + tracking
 *   ar.scene.add(myObject);         // world units: see cameraHeight
 *   // in your rAF loop (or use ar.run()):
 *   ar.update();                    // tracks, positions camera, renders
 */
export class PlinthThree {
  constructor(options = {}) {
    const {
      canvas,
      renderer = null,
      scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000),
      near = 0.01,
      far = 1000,
      pixelRatio = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2),
      shadows = true,
      lightEstimation = true,
      autoResize = true,
      ...engineOptions
    } = options;
    this.canvas = canvas || renderer?.domElement;
    this.renderer = renderer || new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (shadows) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
    }
    this.scene = scene;
    this.camera = camera;
    this.camera.matrixAutoUpdate = true;
    this.near = near;
    this.far = far;
    this.lightEstimation = lightEstimation;
    this.exposure = 0;
    this.lightScale = 1;
    this.anchorObjects = new Map();
    this.background = null;
    this.mirror = false;
    this.enabled = true;
    this.tickers = new Set();
    this._lastTick = 0;

    const gl = this.renderer.getContext();
    this.engine = new PlinthEngine({
      ...engineOptions,
      gl,
      onGlStateDirty: () => this.renderer.resetState(),
    });
    this.engine.addPipelineModule(this);
    this.name = 'plinth-three';
    if (autoResize && typeof window !== 'undefined') {
      this._onResize = () => this.resize();
      window.addEventListener('resize', this._onResize);
      window.addEventListener('orientationchange', this._onResize);
    }
    this.resize();
  }

  /** Register fn(dt, frameState) to run every frame after the camera pose is updated. */
  addTicker(fn) {
    this.tickers.add(fn);
  }

  removeTicker(fn) {
    this.tickers.delete(fn);
  }

  get hitTestType() {
    return HitTestType;
  }

  async start() {
    if (!this.background) {
      this.background = new CameraBackground(this.renderer.getContext());
      this.renderer.resetState();
    }
    await this.engine.start();
  }

  stop() {
    this.engine.stop();
  }

  requestMotionPermission() {
    return this.engine.requestMotionPermission();
  }

  resize(width, height) {
    const w = width ?? (this.canvas.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 300));
    const h = height ?? (this.canvas.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 150));
    this.renderer.setSize(w, h, false);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.engine.setDisplaySize(size.x, size.y);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** Drive the AR view; call once per animation frame. */
  update(now = performance.now()) {
    if (!this.enabled) return;
    if (this.engine.state === 'running') {
      const fs = this.engine.update(now);
      if (!fs) this._renderEmpty();
    }
  }

  /** Convenience render loop. Calls onFrame(dt) before each render. */
  run(onFrame) {
    let last = performance.now();
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      onFrame?.(dt, now);
      this.update(now);
    };
    this._raf = requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------- pipeline module hooks

  onUpdate(fs) {
    const cam = this.camera;
    if (fs.pose) {
      cam.position.set(fs.pose.t[0], fs.pose.t[1], fs.pose.t[2]);
      cam.quaternion.set(fs.pose.q[0], fs.pose.q[1], fs.pose.q[2], fs.pose.q[3]);
    }
    if (fs.displayIntrinsics) {
      fs.displayIntrinsics.projectionMatrix(this.near, this.far, cam.projectionMatrix.elements);
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    }
    cam.updateMatrixWorld(true);
    for (const [id, obj] of this.anchorObjects) {
      const a = this.engine.anchors.get(id);
      if (!a) continue;
      obj.position.set(a.position[0], a.position[1], a.position[2]);
      obj.quaternion.set(a.rotation[0], a.rotation[1], a.rotation[2], a.rotation[3]);
    }
    const now = performance.now();
    const dt = this._lastTick ? Math.min(0.1, (now - this._lastTick) / 1000) : 1 / 60;
    this._lastTick = now;
    for (const fn of this.tickers) fn(dt, fs);
    if (this.lightEstimation && fs.exposure) {
      // Map mean camera luminance to a gentle light multiplier so content
      // dims in dark rooms and brightens outdoors.
      const target = 0.55 + 1.1 * fs.exposure.mean;
      this.lightScale += (target - this.lightScale) * 0.1;
      this.exposure = fs.exposure.score;
    }
  }

  onRender(fs) {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(this._size || (this._size = new THREE.Vector2()));
    if (fs.texture && this.background) {
      this.background.draw(fs.texture, fs.textureWidth, fs.textureHeight, size.x, size.y, this.mirror);
      r.resetState();
      r.clearDepth();
    } else {
      r.clear();
    }
    r.render(this.scene, this.camera);
  }

  _renderEmpty() {
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
  }

  // ---------------------------------------------------------- anchors & hit tests

  /** Create a world-fixed anchor and an Object3D that follows it. */
  createAnchor(position, rotation = [0, 0, 0, 1], data = {}) {
    const a = this.engine.createAnchor(position, rotation, data);
    const obj = new THREE.Group();
    obj.name = `plinth-anchor-${a.id}`;
    obj.userData.anchorId = a.id;
    obj.position.fromArray(a.position);
    obj.quaternion.fromArray(a.rotation);
    this.scene.add(obj);
    this.anchorObjects.set(a.id, obj);
    return obj;
  }

  removeAnchor(obj) {
    const id = obj.userData.anchorId;
    this.engine.removeAnchor(id);
    this.anchorObjects.delete(id);
    obj.removeFromParent();
  }

  /** Object3D that follows an engine anchor created elsewhere (e.g. a marker). */
  objectForAnchor(anchor) {
    let obj = this.anchorObjects.get(anchor.id);
    if (!obj) {
      obj = new THREE.Group();
      obj.userData.anchorId = anchor.id;
      this.scene.add(obj);
      this.anchorObjects.set(anchor.id, obj);
    }
    return obj;
  }

  /**
   * Hit test at client (CSS pixel) coordinates. Returns engine hits with
   * THREE.Vector3/Quaternion conveniences.
   */
  hitTest(clientX, clientY, types) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / Math.max(1, rect.width);
    const y = (clientY - rect.top) / Math.max(1, rect.height);
    return this.engine.hitTest(x, y, types).map((h) => ({
      ...h,
      point: new THREE.Vector3().fromArray(h.position),
      quaternion: new THREE.Quaternion().fromArray(h.rotation),
    }));
  }

  /** Raycaster from client coordinates using the current AR camera. */
  raycasterAt(clientX, clientY, raycaster = new THREE.Raycaster()) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, this.camera);
    return raycaster;
  }

  dispose() {
    this.stop();
    if (this._onResize) {
      window.removeEventListener('resize', this._onResize);
      window.removeEventListener('orientationchange', this._onResize);
    }
    cancelAnimationFrame(this._raf);
  }
}

/**
 * Invisible ground that only shows shadows — the single biggest realism cue
 * for objects standing on a real table (8th Wall's examples use the same).
 */
export function createShadowCatcher(size = 4, opacity = 0.35) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.ShadowMaterial({ opacity, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.renderOrder = -1;
  mesh.name = 'plinth-shadow-catcher';
  return mesh;
}

/**
 * Default AR lighting: sky/ground hemisphere + a shadow-casting key light.
 * Returns {group, update(lightScale)}; call update with ar.lightScale.
 */
export function createDefaultLighting({ shadowSize = 2, shadowMapSize = 1024 } = {}) {
  const group = new THREE.Group();
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(0.6, 2, 0.8);
  key.castShadow = true;
  key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  key.shadow.camera.near = 0.05;
  key.shadow.camera.far = 10;
  key.shadow.camera.left = -shadowSize;
  key.shadow.camera.right = shadowSize;
  key.shadow.camera.top = shadowSize;
  key.shadow.camera.bottom = -shadowSize;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  group.add(hemi, key, key.target);
  return {
    group,
    hemi,
    key,
    update(scale = 1) {
      hemi.intensity = 1.1 * scale;
      key.intensity = 1.6 * scale;
    },
  };
}

export { HitTestType };
