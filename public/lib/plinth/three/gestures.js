// Touch interaction for AR objects: gesture detection, hold-to-drag on the
// ground, pinch-to-scale, two-finger twist rotation, tap-to-place with a
// surface reticle.
//
// Behaviour follows 8th Wall's XRExtras components (gesture-detector,
// hold-drag with a lift while dragging and an eased drop, pinch-scale with
// clamping), with two refinements: dragging keeps the grab offset so the object
// does not jump under the finger, and rotation follows the actual twist angle
// between the two fingers.

import * as THREE from 'three';
import { HitTestType } from '../core/engine.js';

const TAP_MAX_MS = 280;
const TAP_MAX_PX = 12;

/**
 * Pointer-based multi-touch gesture detector (works for touch, pen and mouse).
 * Callbacks receive gesture state with:
 *   count, center {x, y} (client px), spread (px, mean distance to centre),
 *   angle (rad, between the first two pointers), and on move: delta,
 *   spreadRatio, angleDelta.
 */
export class GestureDetector {
  constructor(element, handlers = {}) {
    this.el = element;
    this.h = handlers;
    this.pointers = new Map();
    this.state = null;
    this.down = null;
    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    element.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove, { passive: true });
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onUp);
    element.style.touchAction = 'none';
  }

  dispose() {
    this.el.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onUp);
  }

  _snapshot() {
    const pts = [...this.pointers.values()];
    const n = pts.length;
    if (!n) return null;
    const cx = pts.reduce((s, p) => s + p.x, 0) / n;
    const cy = pts.reduce((s, p) => s + p.y, 0) / n;
    const spread = n >= 2 ? pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / n : 0;
    const angle = n >= 2 ? Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) : 0;
    return { count: n, center: { x: cx, y: cy }, spread, angle };
  }

  _restart(time) {
    if (this.state) this.h.onEnd?.(this.state);
    this.state = this._snapshot();
    if (this.state) {
      this.state.startTime = time;
      this.state.startCenter = { ...this.state.center };
      this.state.startSpread = this.state.spread;
      this.h.onStart?.(this.state);
    }
  }

  _onDown(e) {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) this.down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
    else this.down = null;
    this._restart(performance.now());
  }

  _onMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.down) this.down.moved = Math.max(this.down.moved, Math.hypot(p.x - this.down.x, p.y - this.down.y));
    const prev = this.state;
    const cur = this._snapshot();
    if (!prev || !cur || cur.count !== prev.count) return;
    let angleDelta = cur.angle - prev.angle;
    if (angleDelta > Math.PI) angleDelta -= 2 * Math.PI;
    if (angleDelta < -Math.PI) angleDelta += 2 * Math.PI;
    const move = {
      ...cur,
      startTime: prev.startTime,
      startCenter: prev.startCenter,
      startSpread: prev.startSpread,
      delta: { x: cur.center.x - prev.center.x, y: cur.center.y - prev.center.y },
      spreadRatio: prev.spread > 0 ? cur.spread / prev.spread : 1,
      angleDelta,
    };
    this.state = move;
    this.h.onMove?.(move);
  }

  _onUp(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const d = this.down;
    if (d && this.pointers.size === 0 && performance.now() - d.t < TAP_MAX_MS && d.moved < TAP_MAX_PX) {
      this.h.onTap?.({ x: e.clientX, y: e.clientY });
    }
    if (this.pointers.size === 0) this.down = null;
    this._restart(performance.now());
  }
}

const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);

/**
 * Manipulate one Object3D standing on the ground plane.
 *   ar: PlinthThree instance
 *   options: dragDelay (ms), liftHeight (world units), minScale, maxScale,
 *            requireTouchOnObject (bool), oneFingerRotate (rad per px or 0),
 *            hitTypes, onChange(object)
 */
export class ObjectManipulator {
  /** The manipulator that receives two-finger gestures (last touched/placed). */
  static selected = null;

  constructor(ar, object, options = {}) {
    this.ar = ar;
    this.object = object;
    this.o = {
      dragDelay: 250,
      liftHeight: 0.05,
      minScale: 0.33,
      maxScale: 3,
      requireTouchOnObject: true,
      oneFingerRotate: 0,
      hitTypes: [HitTestType.DETECTED_SURFACE, HitTestType.ESTIMATED_SURFACE],
      ...options,
    };
    this.baseScale = object.scale.clone();
    this.scaleFactor = 1;
    this.dragging = false;
    this.grabOffset = new THREE.Vector3();
    this.target = null;
    this.drop = null;
    this.raycaster = new THREE.Raycaster();
    this.enabled = true;
    this.detector = new GestureDetector(ar.canvas, {
      onStart: (s) => this._start(s),
      onMove: (s) => this._move(s),
      onEnd: (s) => this._end(s),
    });
    this._tick = (dt) => this.update(dt);
    ar.addTicker?.(this._tick);
    if (options.select !== false) this.select();
  }

  /** Make this object the target of pinch / twist gestures. */
  select() {
    ObjectManipulator.selected = this;
    this.o.onSelect?.(this.object);
  }

  dispose() {
    this.detector.dispose();
    this.ar.removeTicker?.(this._tick);
    if (ObjectManipulator.selected === this) ObjectManipulator.selected = null;
  }

  _touchesObject(x, y) {
    const rc = this.ar.raycasterAt(x, y, this.raycaster);
    return rc.intersectObject(this.object, true).length > 0;
  }

  _groundPoint(x, y) {
    const hit = this.ar.hitTest(x, y, this.o.hitTypes)[0];
    return hit ? hit.point : null;
  }

  _start(s) {
    if (!this.enabled) return;
    clearTimeout(this.holdTimer);
    if (s.count >= 2) {
      // Two-finger gestures go to the selected object only (touch an object
      // or place one to select it), so several objects never scale at once.
      this.active = ObjectManipulator.selected === this;
    } else {
      this.active = !this.o.requireTouchOnObject || this._touchesObject(s.center.x, s.center.y);
      if (this.active) this.select();
    }
    if (!this.active) return;
    if (s.count === 1) {
      this.holdTimer = setTimeout(() => this._beginDrag(s.center), this.o.dragDelay);
    }
  }

  _beginDrag(center) {
    const g = this._groundPoint(center.x, center.y);
    if (!g) return;
    this.dragging = true;
    this.drop = null;
    const parent = this.object.parent;
    const worldPos = this.object.getWorldPosition(new THREE.Vector3());
    this.grabOffset.copy(worldPos).sub(g);
    this.grabOffset.y = 0;
    this.lastCenter = center;
    this.target = worldPos.clone();
    this.target.y += this.o.liftHeight;
    if (parent) parent.updateMatrixWorld();
  }

  _move(s) {
    if (!this.enabled || !this.active) return;
    if (s.count === 1) {
      if (this.dragging) {
        this.lastCenter = s.center;
        const g = this._groundPoint(s.center.x, s.center.y);
        if (g) {
          this.target = g.add(this.grabOffset);
          this.target.y += this.o.liftHeight;
        }
      } else if (this.o.oneFingerRotate) {
        this.object.rotation.y += s.delta.x * this.o.oneFingerRotate;
        this.o.onChange?.(this.object);
      }
    } else if (s.count >= 2) {
      clearTimeout(this.holdTimer);
      this.scaleFactor = Math.min(this.o.maxScale, Math.max(this.o.minScale, this.scaleFactor * s.spreadRatio));
      this.object.scale.copy(this.baseScale).multiplyScalar(this.scaleFactor);
      // Screen y points down, so a clockwise twist is a positive angle delta.
      this.object.rotation.y -= s.angleDelta;
      this.o.onChange?.(this.object);
    }
  }

  _end() {
    clearTimeout(this.holdTimer);
    if (this.dragging) {
      this.dragging = false;
      const from = this.object.position.clone();
      const to = from.clone();
      to.y -= this.o.liftHeight;
      this.drop = { from, to, t: 0 };
    }
    this.active = false;
  }

  update(dt) {
    const obj = this.object;
    if (this.dragging && this.target) {
      const local = obj.parent ? obj.parent.worldToLocal(this.target.clone()) : this.target.clone();
      obj.position.lerp(local, 1 - Math.pow(0.001, dt));
      this.o.onChange?.(obj);
    } else if (this.drop) {
      this.drop.t = Math.min(1, this.drop.t + dt / 0.3);
      obj.position.lerpVectors(this.drop.from, this.drop.to, easeOutQuad(this.drop.t));
      if (this.drop.t >= 1) this.drop = null;
      this.o.onChange?.(obj);
    }
  }
}

/**
 * Surface reticle that follows the hit test at the screen centre, plus tap to
 * place. onPlace({position: Vector3, quaternion, hit}) fires on tap.
 */
export class PlacementReticle {
  constructor(ar, { onPlace, hitTypes, color = 0xffffff, radius = 0.06, tapAnywhere = false } = {}) {
    this.ar = ar;
    this.onPlace = onPlace;
    this.hitTypes = hitTypes || [HitTestType.DETECTED_SURFACE, HitTestType.ESTIMATED_SURFACE];
    this.tapAnywhere = tapAnywhere;
    this.enabled = true;
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.8, radius, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false }),
    );
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 0.12, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false }),
    );
    ring.rotation.x = dot.rotation.x = -Math.PI / 2;
    ring.renderOrder = dot.renderOrder = 999;
    group.add(ring, dot);
    group.visible = false;
    this.mesh = group;
    ar.scene.add(group);
    this.hasHit = false;
    this.detector = new GestureDetector(ar.canvas, { onTap: (p) => this._tap(p) });
    this._tick = (dt) => this.update(dt);
    ar.addTicker?.(this._tick);
  }

  update() {
    if (!this.enabled) { this.mesh.visible = false; return; }
    const rect = this.ar.canvas.getBoundingClientRect();
    const hit = this.ar.hitTest(rect.left + rect.width / 2, rect.top + rect.height / 2, this.hitTypes)[0];
    this.hasHit = !!hit;
    this.mesh.visible = !!hit;
    if (hit) {
      if (!this._placed) {
        this.mesh.position.copy(hit.point);
        this._placed = true;
      } else {
        this.mesh.position.lerp(hit.point, 0.35);
      }
      this.mesh.position.y = hit.point.y + 0.001;
    }
  }

  _tap(p) {
    if (!this.enabled || !this.onPlace) return;
    let hit = null;
    if (this.tapAnywhere) hit = this.ar.hitTest(p.x, p.y, this.hitTypes)[0];
    if (!hit && this.hasHit) {
      hit = { point: this.mesh.position.clone(), quaternion: new THREE.Quaternion(), position: this.mesh.position.toArray() };
    }
    if (hit) this.onPlace({ position: hit.point.clone(), quaternion: hit.quaternion.clone(), hit });
  }

  dispose() {
    this.detector.dispose();
    this.ar.removeTicker?.(this._tick);
    this.mesh.removeFromParent();
  }
}
