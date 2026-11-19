// Plinth tracker: monocular visual-inertial "SLAM-lite" for placing content
// on horizontal surfaces from a phone browser.
//
// Design (mirrors what 8th Wall's engine exposes, re-derived for JavaScript):
//  * Instant placement: like 8th Wall's "responsive" scale, the world is
//    defined by gravity (IMU) and an assumed camera height above the ground
//    plane y = 0. Features whose rays hit that plane are mapped immediately, so
//    content can be placed on the first frame without a scanning motion.
//  * Frame-to-frame tracking with pyramidal Lucas-Kanade, seeded by the IMU
//    rotation and a constant-velocity motion model.
//  * Robust pose: RANSAC over translation with the IMU-predicted rotation, then
//    Huber/Tukey Gauss-Newton with gyro (relative rotation) and gravity (tilt)
//    priors.
//  * Mapping: points that do not lie on the plane are detected as structure
//    outliers and re-estimated by triangulating keyframe rays.
//  * Re-acquisition of previously mapped points by descriptor matching at
//    keyframes (keeps the map anchored as you walk around the table), and
//    gravity-aware 4-DoF relocalisation after tracking loss.

import {
  quatMul, quatConj, quatNormalize, quatRotate, quatFromYaw, yawOfQuat, quatSlerp,
  quatFromAxisAngle, quatAngle, sub3, add3, scale3, dot3, norm3, dist3, median, normalizeAngle,
} from '../core/math.js';
import { buildPyramid, blur5, exposureStats } from './image.js';
import { detectFast } from './fast.js';
import { trackKLT } from './klt.js';
import { describe, describeRectified, orientation, hamming, DESCRIPTOR_BORDER } from './brief.js';
import {
  optimizePose, projectPoint, pixelRay, rayPlaneY, triangulateRays, ransacTranslation,
  ransacAbsolutePoseGravity, planeHomography,
} from './geometry.js';

export const TrackingStatus = Object.freeze({
  NORMAL: 'NORMAL',
  LIMITED: 'LIMITED',
  NOT_AVAILABLE: 'NOT_AVAILABLE',
});

export const TrackingReason = Object.freeze({
  UNSPECIFIED: 'UNSPECIFIED',
  INITIALIZING: 'INITIALIZING',
  RELOCALIZING: 'RELOCALIZING',
  TOO_MUCH_MOTION: 'TOO_MUCH_MOTION',
  NOT_ENOUGH_TEXTURE: 'NOT_ENOUGH_TEXTURE',
});

const KIND_PLANE = 1; // initialised on the ground plane (trusted)
const KIND_TRI = 2; // triangulated with enough parallax (trusted)
const KIND_GUESS = 3; // depth unknown (not used for translation)

const DEG = Math.PI / 180;

export const DEFAULT_TRACKER_CONFIG = Object.freeze({
  cameraHeight: 1.0, // assumed height of the camera above the ground plane at start
  targetPoints: 150, // tracked features to maintain
  cellSize: 48, // grid cell size (px) for feature distribution
  pyramidLevels: 3,
  kltHalfWindow: 5,
  kltMaxError: 22,
  kltForwardBackward: 0, // px; 0 disables (RANSAC handles outliers)
  fastThreshold: 16,
  maxMapPoints: 900,
  maxPlaneDistance: 4, // max ray length (in camera heights) for plane initialisation (~14° below horizon)
  minInitPoints: 20,
  minGoodPoints: 10,
  inlierThreshold: 2.5, // px at 640 px image height (scaled with resolution)
  keyframeMinFrames: 4,
  keyframeTranslation: 0.08, // fraction of median scene depth
  keyframeRotation: 12 * DEG,
  minTriParallax: 1.2 * DEG,
  goodTriParallax: 3.0 * DEG,
  reacquireRadius: 18, // px
  descriptorMaxDistance: 56,
  rectifiedMaxDistance: 44,
  ratioTest: 0.82,
  lostFrames: 8, // frames with too few inliers before declaring tracking lost
  relocEvery: 2, // attempt relocalisation every N frames while lost
  rotationPriorSigma: 0.015, // rad: gyro relative rotation uncertainty per frame
  tiltPriorSigma: 0.02, // rad: accelerometer gravity uncertainty
  noImuPitch: -0.75, // assumed initial camera pitch (rad) when no IMU is available
  velocityDamping: 0.85,
});

let nextPointId = 1;

class MapPoint {
  constructor(X, kind) {
    this.id = nextPointId++;
    this.X = X;
    this.kind = kind;
    this.rays = []; // [{c, d}] observation rays from keyframes
    this.desc = null; // ORB descriptor (image-oriented)
    this.rdesc = null; // ground-plane rectified descriptor (plane points)
    this.tracked = false;
    this.u = 0;
    this.v = 0;
    this.structOutliers = 0;
    this.inliers = 0;
    this.lastSeen = 0;
    this.parallax = 0;
  }

  weight() {
    if (this.kind === KIND_PLANE) return 1;
    if (this.kind === KIND_TRI) return this.parallax >= 3 * DEG ? 1 : 0.4;
    return 0;
  }
}

export class Tracker {
  constructor(intrinsics, config = {}) {
    this.K = intrinsics;
    this.cfg = { ...DEFAULT_TRACKER_CONFIG, ...config };
    const { width, height } = intrinsics;
    this.gridCols = Math.max(4, Math.round(width / this.cfg.cellSize));
    this.gridRows = Math.max(4, Math.round(height / this.cfg.cellSize));
    this.pxScale = Math.max(width, height) / 640;
    this.reset();
  }

  /**
   * Clear the map. If `continuePose` is given, the next initialisation keeps
   * that camera position and heading so existing content stays put (8th Wall
   * calls this "resetOriginToLastPose").
   */
  reset(continuePose = null) {
    this.points = [];
    this.keyframes = [];
    this.initialized = false;
    this.pose = continuePose ? { q: continuePose.q.slice(), t: continuePose.t.slice() } : null;
    this.continuePose = continuePose;
    this.prevPyr = null;
    this.prevImuQ = null;
    this.prevTime = 0;
    this.velocity = [0, 0, 0];
    this.angVel = null;
    this.frameIndex = 0;
    this.lastKeyframeFrame = -1000;
    this.lastKeyframePose = null;
    this.badFrames = 0;
    this.lost = false;
    this.yawOffset = 0;
    this.yawCalibrated = false;
    this.rectSpacing = 0;
    this.status = TrackingStatus.LIMITED;
    this.reason = TrackingReason.INITIALIZING;
  }

  /** Uniformly rescale the map about a world point on the ground plane. */
  rescale(s, center = [0, 0, 0]) {
    const f = (p) => add3(center, scale3(sub3(p, center), s));
    for (const p of this.points) {
      p.X = f(p.X);
      for (const r of p.rays) r.c = f(r.c);
    }
    for (const kf of this.keyframes) kf.pose.t = f(kf.pose.t);
    if (this.pose) this.pose.t = f(this.pose.t);
    if (this.lastKeyframePose) this.lastKeyframePose.t = f(this.lastKeyframePose.t);
    this.velocity = scale3(this.velocity, s);
    this.cfg.cameraHeight *= s;
    this.rectSpacing *= s;
  }

  /** Rigidly transform the whole map: p' = R_y(yaw) p + t. */
  transformMap(yaw, t) {
    const q = quatFromYaw(yaw);
    const f = (p) => add3(quatRotate(q, p), t);
    for (const p of this.points) {
      p.X = f(p.X);
      for (const r of p.rays) { r.c = f(r.c); r.d = quatRotate(q, r.d); }
    }
    const fp = (pose) => ({ q: quatNormalize(quatMul(q, pose.q)), t: f(pose.t) });
    for (const kf of this.keyframes) kf.pose = fp(kf.pose);
    if (this.pose) this.pose = fp(this.pose);
    if (this.lastKeyframePose) this.lastKeyframePose = fp(this.lastKeyframePose);
    this.velocity = quatRotate(q, this.velocity);
    this.yawOffset += yaw;
  }

  /**
   * Heading difference between a world orientation and the IMU orientation
   * (in the current world frame). Uses the yaw of q * imuWorld^-1, which stays
   * well defined when the camera looks straight down.
   */
  _yawError(q, imuQ) {
    const d = quatMul(q, quatConj(this.imuWorldQ(imuQ)));
    return normalizeAngle(2 * Math.atan2(d[1], d[3]));
  }

  /** IMU orientation expressed in the tracker's world frame. */
  imuWorldQ(imuQ) {
    return quatNormalize(quatMul(quatFromYaw(this.yawOffset), imuQ));
  }

  /**
   * Process one frame.
   *   frame.image: GrayImage at the intrinsics' resolution
   *   frame.time: seconds
   *   frame.imuQ: camera-to-world quaternion from the device's orientation sensor
   *               (gravity aligned, arbitrary yaw) or null
   */
  process(frame) {
    const t0 = now();
    const cfg = this.cfg;
    const pyr = buildPyramid(frame.image, cfg.pyramidLevels);
    const exposure = exposureStats(frame.image);
    const imuQ = frame.imuQ || null;
    const dt = this.prevTime ? Math.min(0.25, Math.max(1e-3, frame.time - this.prevTime)) : 1 / 30;
    let keyframe = false;
    let inlierCount = 0;

    if (!this.initialized) {
      this._initialize(pyr, imuQ);
    } else {
      // ---- predict
      const prevPose = this.pose;
      let qPred;
      if (imuQ && this.prevImuQ) {
        qPred = quatNormalize(quatMul(prevPose.q, quatMul(quatConj(this.prevImuQ), imuQ)));
      } else if (this.angVel) {
        qPred = quatNormalize(quatMul(prevPose.q, quatSlerp([0, 0, 0, 1], this.angVel, 0.8)));
      } else {
        qPred = prevPose.q.slice();
      }
      const tPred = add3(prevPose.t, scale3(this.velocity, dt));
      const predPose = { q: qPred, t: tPred };

      let continuous = true;
      if (this.lost) {
        // 3-DoF fallback while relocalising: IMU rotation, frozen position.
        this.pose = { q: qPred, t: prevPose.t.slice() };
        continuous = false;
        if (this.frameIndex % cfg.relocEvery === 0) this._relocalize(pyr, imuQ);
      } else {
        inlierCount = this._track(pyr, predPose, imuQ, dt);
        keyframe = this._maybeKeyframe(pyr, imuQ);
      }
      // Keep the IMU heading aligned with the visual world: the browser's yaw
      // drifts, and motion permission may only be granted after start-up.
      if (imuQ && this.status === TrackingStatus.NORMAL) {
        const err = this._yawError(this.pose.q, imuQ);
        this.yawOffset += this.yawCalibrated ? 0.05 * err : err;
        this.yawCalibrated = true;
      }
      if (continuous && !this.lost) {
        const qa = this.pose.q;
        this.angVel = quatNormalize(quatMul(quatConj(prevPose.q), qa));
        const v = scale3(sub3(this.pose.t, prevPose.t), 1 / dt);
        this.velocity = add3(scale3(this.velocity, 1 - cfg.velocityDamping), scale3(v, cfg.velocityDamping));
        // Guard against runaway velocity estimates.
        const speed = norm3(this.velocity);
        const maxSpeed = 4 * cfg.cameraHeight;
        if (speed > maxSpeed) this.velocity = scale3(this.velocity, maxSpeed / speed);
      } else {
        // Lost, or just relocalised (a pose jump is not motion).
        this.velocity = [0, 0, 0];
        this.angVel = null;
      }
    }

    this.prevPyr = pyr;
    this.prevImuQ = imuQ;
    this.prevTime = frame.time;
    this.frameIndex++;
    return {
      id: frame.id,
      pose: this.pose ? { q: this.pose.q.slice(), t: this.pose.t.slice() } : null,
      status: this.status,
      reason: this.reason,
      tracked: this.points.reduce((n, p) => n + (p.tracked ? 1 : 0), 0),
      inliers: inlierCount,
      mapSize: this.points.length,
      keyframe,
      exposure,
      ms: now() - t0,
    };
  }

  // ------------------------------------------------------------------ init

  _initialize(pyr, imuQ) {
    const cfg = this.cfg;
    let q;
    let t;
    if (this.continuePose) {
      q = this.continuePose.q.slice();
      t = this.continuePose.t.slice();
      if (imuQ) {
        // Keep the heading of the previous pose, take tilt from the IMU.
        this.yawOffset = 0;
        this.yawOffset = this._yawError(q, imuQ);
        this.yawCalibrated = true;
        q = this.imuWorldQ(imuQ);
      }
    } else {
      if (imuQ) {
        this.yawOffset = -yawOfQuat(imuQ);
        this.yawCalibrated = true;
        q = this.imuWorldQ(imuQ);
      } else {
        q = quatFromAxisAngle([1, 0, 0], cfg.noImuPitch);
      }
      t = [0, cfg.cameraHeight, 0];
    }
    this.pose = { q, t };
    const h = t[1];
    if (h <= 1e-6) {
      this.status = TrackingStatus.LIMITED;
      this.reason = TrackingReason.INITIALIZING;
      return;
    }

    const corners = this._detect(pyr[0], null, 3);
    const blurred = blur5(pyr[0]);
    // World size of one rectified-descriptor sample: ~1 px at typical depth.
    this.rectSpacing = (1.3 * h) / this.K.fx;
    let planeCount = 0;
    const created = [];
    for (const c of corners) {
      const d = pixelRay(this.pose, this.K, c.x, c.y);
      const s = rayPlaneY(t, d, 0);
      if (s > 0 && s < cfg.maxPlaneDistance * h) planeCount++;
      created.push({ c, d, s });
    }
    if (planeCount < cfg.minInitPoints) {
      this.status = TrackingStatus.LIMITED;
      this.reason = TrackingReason.INITIALIZING;
      return;
    }
    // Keep the best-scoring corners per cell up to the target count.
    created.sort((a, b) => b.c.score - a.c.score);
    const perCell = Math.ceil(cfg.targetPoints / (this.gridCols * this.gridRows)) + 1;
    const cellCount = new Uint8Array(this.gridCols * this.gridRows);
    for (const { c, d, s } of created) {
      const ci = this._cellIndex(c.x, c.y);
      if (cellCount[ci] >= perCell) continue;
      cellCount[ci]++;
      const p = s > 0 && s < cfg.maxPlaneDistance * h
        ? new MapPoint(add3(t, scale3(d, s)), KIND_PLANE)
        : new MapPoint(add3(t, scale3(d, 3 * h)), KIND_GUESS);
      p.tracked = true;
      p.u = c.x;
      p.v = c.y;
      p.rays.push({ c: t.slice(), d });
      p.desc = describe(blurred, c.x, c.y, orientation(blurred, c.x, c.y));
      if (p.kind === KIND_PLANE) p.rdesc = this._rectDesc(blurred, this.pose, p.X);
      p.lastSeen = this.frameIndex;
      this.points.push(p);
    }
    this.keyframes.push({ id: this.frameIndex, pose: { q: q.slice(), t: t.slice() } });
    this.lastKeyframeFrame = this.frameIndex;
    this.lastKeyframePose = { q: q.slice(), t: t.slice() };
    this.initialized = true;
    this.continuePose = null;
    this.status = TrackingStatus.NORMAL;
    this.reason = TrackingReason.UNSPECIFIED;
  }

  // ------------------------------------------------------------------ tracking

  _track(pyr, predPose, imuQ, dt) {
    const cfg = this.cfg;
    const K = this.K;
    const active = this.points.filter((p) => p.tracked);
    if (active.length === 0) {
      this._declareLost();
      this.pose = predPose;
      return 0;
    }
    const pts = new Float32Array(active.length * 2);
    const guesses = new Float32Array(active.length * 2);
    for (let i = 0; i < active.length; i++) {
      const p = active[i];
      pts[i * 2] = p.u;
      pts[i * 2 + 1] = p.v;
      const pr = projectPoint(predPose, K, p.X);
      if (pr) {
        guesses[i * 2] = pr[0];
        guesses[i * 2 + 1] = pr[1];
      } else {
        guesses[i * 2] = p.u;
        guesses[i * 2 + 1] = p.v;
      }
    }
    const res = trackKLT(this.prevPyr, pyr, pts, guesses, {
      halfWindow: cfg.kltHalfWindow,
      maxError: cfg.kltMaxError,
      fbThreshold: cfg.kltForwardBackward,
    });

    const margin = 4;
    const tracked = [];
    for (let i = 0; i < active.length; i++) {
      const p = active[i];
      const u = res.positions[i * 2];
      const v = res.positions[i * 2 + 1];
      if (!res.status[i] || u < margin || v < margin || u > K.width - margin || v > K.height - margin) {
        p.tracked = false;
        continue;
      }
      p.u = u;
      p.v = v;
      tracked.push(p);
    }

    const good = tracked.filter((p) => p.weight() > 0);
    const thresh = cfg.inlierThreshold * this.pxScale;
    const imuWorld = imuQ ? this.imuWorldQ(imuQ) : null;
    let pose = predPose;
    let inliers = 0;

    if (good.length >= cfg.minGoodPoints) {
      const obs = good.map((p) => ({ p: p.X, u: p.u, v: p.v, w: p.weight() }));
      // RANSAC over translation with the predicted rotation guards against
      // a bad motion-model prediction and gross KLT outliers.
      const rs = ransacTranslation(predPose.q, K, obs, { iterations: 30, threshold: thresh * 2.5, seed: this.frameIndex + 1 });
      let start = predPose;
      if (rs && rs.count >= Math.max(cfg.minGoodPoints, 0.3 * obs.length)) start = rs.pose;
      const opt = optimizePose(start, obs, K, {
        iterations: 10,
        huber: thresh,
        tukey: thresh * 3,
        rotPrior: imuQ && this.prevImuQ ? { q: predPose.q, sigma: cfg.rotationPriorSigma } : null,
        tiltPrior: imuWorld ? { q: imuWorld, sigma: cfg.tiltPriorSigma } : null,
        pixelSigma: this.pxScale,
      });
      pose = opt.pose;
      for (let i = 0; i < good.length; i++) {
        const p = good[i];
        const e = opt.residuals[i];
        if (e <= thresh * 1.5) {
          inliers++;
          p.inliers++;
          p.structOutliers = 0;
          p.lastSeen = this.frameIndex;
        } else if (e <= thresh * 8) {
          // The 2D track is plausible but the 3D estimate disagrees: treat the
          // point's structure as unknown and let triangulation fix it.
          p.structOutliers++;
          if (p.structOutliers >= 3) {
            p.kind = KIND_GUESS;
            p.structOutliers = 0;
          }
        } else {
          p.tracked = false; // gross outlier: bad track
        }
      }
    }

    const minInliers = Math.max(6, Math.round(cfg.minGoodPoints * 0.8));
    if (inliers >= minInliers) {
      this.pose = pose;
      this.badFrames = 0;
      this.status = TrackingStatus.NORMAL;
      this.reason = TrackingReason.UNSPECIFIED;
    } else {
      // Not enough support for 6-DoF: keep IMU rotation, hold position.
      this.pose = { q: predPose.q, t: add3(this.pose.t, scale3(this.velocity, dt * 0.3)) };
      this.badFrames++;
      this.status = TrackingStatus.LIMITED;
      this.reason = tracked.length < cfg.minGoodPoints ? TrackingReason.NOT_ENOUGH_TEXTURE : TrackingReason.TOO_MUCH_MOTION;
      if (this.badFrames >= cfg.lostFrames) this._declareLost();
    }
    // Drop tracks of points that are behind the camera now.
    for (const p of tracked) {
      if (p.tracked && !projectPoint(this.pose, K, p.X) && p.kind !== KIND_GUESS) p.tracked = false;
    }
    return inliers;
  }

  _declareLost() {
    this.lost = true;
    this.status = TrackingStatus.LIMITED;
    this.reason = TrackingReason.RELOCALIZING;
    for (const p of this.points) p.tracked = false;
  }

  // ------------------------------------------------------------------ keyframes

  _medianDepth() {
    const depths = [];
    for (const p of this.points) {
      if (!p.tracked || p.weight() === 0) continue;
      const pr = projectPoint(this.pose, this.K, p.X);
      if (pr) depths.push(pr[2]);
    }
    return depths.length ? median(depths) : this.cfg.cameraHeight;
  }

  _maybeKeyframe(pyr, imuQ) {
    const cfg = this.cfg;
    if (this.status !== TrackingStatus.NORMAL) return false;
    if (this.frameIndex - this.lastKeyframeFrame < cfg.keyframeMinFrames) return false;
    const trackedCount = this.points.reduce((n, p) => n + (p.tracked ? 1 : 0), 0);
    const kf = this.lastKeyframePose;
    const moved = dist3(kf.t, this.pose.t) / Math.max(1e-6, this._medianDepth());
    const rotated = quatAngle(kf.q, this.pose.q);
    const needPoints = trackedCount < cfg.targetPoints * 0.7;
    if (!(needPoints || moved > cfg.keyframeTranslation || rotated > cfg.keyframeRotation)) return false;
    this._insertKeyframe(pyr, imuQ);
    return true;
  }

  _insertKeyframe(pyr, imuQ) {
    const cfg = this.cfg;
    const K = this.K;
    const pose = this.pose;
    const c = pose.t.slice();

    // 1. Add observation rays and (re)triangulate.
    for (const p of this.points) {
      if (!p.tracked) continue;
      const d = pixelRay(pose, K, p.u, p.v);
      p.rays.push({ c, d });
      if (p.rays.length > 8) p.rays.splice(1, 1); // keep the first (widest baseline) ray
      if (p.rays.length < 2) continue;
      const tri = triangulateRays(p.rays);
      if (!tri || tri.maxParallax < cfg.minTriParallax) continue;
      if (p.kind === KIND_PLANE) {
        // Verify the plane hypothesis: compare depths along the first ray.
        // Relative depth uncertainty of a triangulation ~ pixel angle / parallax.
        const r0 = p.rays[0];
        const dPlane = dot3(sub3(p.X, r0.c), r0.d);
        const dTri = dot3(sub3(tri.p, r0.c), r0.d);
        const sigmaRel = (1.5 * this.pxScale) / this.K.fx / tri.maxParallax;
        if (Math.abs(1 - dTri / dPlane) <= 3 * sigmaRel + 0.03) {
          p.verified = true;
          continue;
        }
      }
      // Reject triangulations that do not reproject well in the current view.
      const pr = projectPoint(pose, K, tri.p);
      if (!pr || Math.hypot(pr[0] - p.u, pr[1] - p.v) > cfg.inlierThreshold * this.pxScale * 2) continue;
      p.X = tri.p;
      p.parallax = tri.maxParallax;
      p.kind = KIND_TRI;
    }

    // 2. Detect corners, re-acquire lost map points, add new ones in empty cells.
    const occupancy = new Uint8Array(this.gridCols * this.gridRows);
    for (const p of this.points) if (p.tracked) occupancy[this._cellIndex(p.u, p.v)]++;
    const perCell = Math.ceil(cfg.targetPoints / (this.gridCols * this.gridRows));
    // Only cells that are short of points need corners (for re-acquisition or
    // new points), which keeps keyframes cheap once the view is well covered.
    const mask = new Uint8Array(occupancy.length);
    let needed = 0;
    for (let i = 0; i < mask.length; i++) if (occupancy[i] < perCell) { mask[i] = 1; needed++; }
    if (needed === 0) {
      this._pruneMap();
      this.lastKeyframeFrame = this.frameIndex;
      this.lastKeyframePose = { q: pose.q.slice(), t: pose.t.slice() };
      return 0;
    }
    const corners = this._detect(pyr[0], mask, perCell + 3);
    const blurred = blur5(pyr[0]);
    const descCache = new Array(corners.length);
    const cornerDesc = {
      get: (i) => descCache[i] || (descCache[i] = describe(blurred, corners[i].x, corners[i].y, orientation(blurred, corners[i].x, corners[i].y))),
    };
    const used = new Uint8Array(corners.length);
    const cornerRect = this._cornerRectDescs(corners, blurred, pose);
    this._reacquire(corners, cornerDesc, cornerRect, used, occupancy, perCell + 1);

    const h = Math.max(1e-6, this._groundHeightBelowCamera());
    const fallbackDepth = this._medianDepth();
    let added = 0;
    const order = corners.map((k, i) => i).sort((a, b) => corners[b].score - corners[a].score);
    for (const i of order) {
      if (used[i]) continue;
      const k = corners[i];
      const ci = this._cellIndex(k.x, k.y);
      if (occupancy[ci] >= perCell) continue;
      // Avoid duplicates next to existing tracks.
      let nearby = false;
      for (const p of this.points) {
        if (p.tracked && Math.abs(p.u - k.x) < 6 && Math.abs(p.v - k.y) < 6) { nearby = true; break; }
      }
      if (nearby) continue;
      const d = pixelRay(pose, K, k.x, k.y);
      const s = rayPlaneY(c, d, 0);
      const onPlane = s > 0 && s < cfg.maxPlaneDistance * h && this._planeLikely(k.x, k.y);
      const p = onPlane
        ? new MapPoint(add3(c, scale3(d, s)), KIND_PLANE)
        : new MapPoint(add3(c, scale3(d, fallbackDepth)), KIND_GUESS);
      p.tracked = true;
      p.u = k.x;
      p.v = k.y;
      p.rays.push({ c, d });
      p.desc = cornerDesc.get(i);
      if (onPlane) p.rdesc = cornerRect[i] || this._rectDesc(blurred, pose, p.X);
      p.lastSeen = this.frameIndex;
      this.points.push(p);
      occupancy[ci]++;
      used[i] = 1;
      added++;
    }

    this._pruneMap();
    this.keyframes.push({ id: this.frameIndex, pose: { q: pose.q.slice(), t: pose.t.slice() } });
    if (this.keyframes.length > 80) this.keyframes.shift();
    this.lastKeyframeFrame = this.frameIndex;
    this.lastKeyframePose = { q: pose.q.slice(), t: pose.t.slice() };
    return added;
  }

  /**
   * A new corner is assumed to be on the ground plane only if trusted
   * neighbours in the image are plane points (so features on objects standing
   * on the table are not forced onto the plane).
   */
  _planeLikely(u, v) {
    let plane = 0;
    let other = 0;
    const r2 = (this.cfg.cellSize * 1.5) ** 2;
    for (const p of this.points) {
      if (!p.tracked) continue;
      const du = p.u - u;
      const dv = p.v - v;
      if (du * du + dv * dv > r2) continue;
      if (p.kind === KIND_PLANE) plane++;
      else if (p.kind === KIND_TRI && Math.abs(p.X[1]) > 0.03 * this.cfg.cameraHeight) other++;
    }
    return plane >= other;
  }

  /** Height of the camera above the y = 0 plane. */
  _groundHeightBelowCamera() {
    return this.pose.t[1];
  }

  _reacquire(corners, cornerDesc, cornerRect, used, occupancy, maxPerCell) {
    const cfg = this.cfg;
    const K = this.K;
    const radius = cfg.reacquireRadius * this.pxScale;
    const r2 = radius * radius;
    // Prefer the oldest, most-confirmed points: they anchor the map best.
    const candidates = this.points
      .filter((p) => !p.tracked && p.desc && p.weight() > 0)
      .sort((a, b) => b.inliers - a.inliers);
    for (const p of candidates) {
      const pr = projectPoint(this.pose, K, p.X);
      if (!pr) continue;
      const [u, v] = pr;
      if (u < DESCRIPTOR_BORDER || v < DESCRIPTOR_BORDER || u > K.width - DESCRIPTOR_BORDER || v > K.height - DESCRIPTOR_BORDER) continue;
      if (occupancy[this._cellIndex(u, v)] >= maxPerCell) continue;
      // Plane points match with rectified descriptors (viewpoint invariant);
      // others with oriented BRIEF.
      const rect = p.rdesc != null;
      let best = -1;
      let bestD = 1e9;
      let second = 1e9;
      for (let i = 0; i < corners.length; i++) {
        if (used[i]) continue;
        const du = corners[i].x - u;
        const dv = corners[i].y - v;
        if (du * du + dv * dv > r2) continue;
        let d;
        if (rect) {
          if (!cornerRect[i]) continue;
          d = hamming(p.rdesc, cornerRect[i]);
        } else {
          d = hamming(p.desc, cornerDesc.get(i));
        }
        if (d < bestD) { second = bestD; bestD = d; best = i; } else if (d < second) second = d;
      }
      const maxD = rect ? cfg.rectifiedMaxDistance : cfg.descriptorMaxDistance;
      if (best < 0 || bestD > maxD || bestD > cfg.ratioTest * second) continue;
      used[best] = 1;
      p.tracked = true;
      p.u = corners[best].x;
      p.v = corners[best].y;
      p.lastSeen = this.frameIndex;
      occupancy[this._cellIndex(p.u, p.v)]++;
    }
  }

  _pruneMap() {
    const cfg = this.cfg;
    // Forget unconverged points that are no longer tracked.
    this.points = this.points.filter((p) => p.tracked || p.weight() > 0);
    if (this.points.length <= cfg.maxMapPoints) return;
    // Drop the least recently seen untracked points.
    const untracked = this.points.filter((p) => !p.tracked).sort((a, b) => a.lastSeen - b.lastSeen);
    const remove = new Set(untracked.slice(0, this.points.length - cfg.maxMapPoints));
    this.points = this.points.filter((p) => !remove.has(p));
  }

  // ------------------------------------------------------------------ relocalisation

  _relocalize(pyr, imuQ) {
    const cfg = this.cfg;
    const K = this.K;
    const candidates = this.points.filter((p) => (p.desc || p.rdesc) && p.weight() > 0);
    if (candidates.length < 15) return false;
    const corners = this._detect(pyr[0], null, 4);
    if (corners.length < 15) return false;
    const blurred = blur5(pyr[0]);
    const tilt = imuQ ? this.imuWorldQ(imuQ) : this.pose.q;
    // Rectified descriptors need the camera orientation (IMU: tilt exact, yaw
    // drifts slowly) and height above the plane (assume the last known one).
    // The unknown horizontal position does not change a rectified patch.
    const probePose = { q: tilt, t: [0, Math.max(1e-3, this.pose.t[1]), 0] };
    const cornerRect = this._cornerRectDescs(corners, blurred, probePose);
    const rectPts = candidates.filter((p) => p.rdesc);
    // Oriented BRIEF is heading-independent, so it also covers plane points
    // when the heading prior is wrong (no IMU, or a large yaw jump).
    const orbPts = candidates.filter((p) => p.desc);
    const obs = [];
    const matched = [];
    for (let ci = 0; ci < corners.length; ci++) {
      const k = corners[ci];
      let best = null;
      let bestD = 1e9;
      let second = 1e9;
      let maxD = cfg.descriptorMaxDistance;
      if (cornerRect[ci] && rectPts.length) {
        maxD = cfg.rectifiedMaxDistance;
        for (const p of rectPts) {
          const d = hamming(cornerRect[ci], p.rdesc);
          if (d < bestD) { second = bestD; bestD = d; best = p; } else if (d < second) second = d;
        }
      }
      if (!best || bestD > maxD) {
        // Fall back to oriented BRIEF against non-plane points.
        const desc = describe(blurred, k.x, k.y, orientation(blurred, k.x, k.y));
        best = null; bestD = 1e9; second = 1e9; maxD = cfg.descriptorMaxDistance;
        for (const p of orbPts) {
          const d = hamming(desc, p.desc);
          if (d < bestD) { second = bestD; bestD = d; best = p; } else if (d < second) second = d;
        }
      }
      if (!best || bestD > maxD || bestD > cfg.ratioTest * second) continue;
      obs.push({ p: best.X, u: k.x, v: k.y });
      matched.push(best);
    }
    if (obs.length < 12) return false;
    const res = ransacAbsolutePoseGravity(tilt, K, obs, {
      iterations: 200, threshold: cfg.inlierThreshold * this.pxScale * 2, minInliers: 12, seed: this.frameIndex,
    });
    if (!res) return false;
    this.pose = res.pose;
    for (let i = 0; i < obs.length; i++) {
      if (!res.inliers[i]) continue;
      const p = matched[i];
      p.tracked = true;
      p.u = obs[i].u;
      p.v = obs[i].v;
      p.lastSeen = this.frameIndex;
    }
    this.lost = false;
    this.badFrames = 0;
    this.velocity = [0, 0, 0];
    this.status = TrackingStatus.NORMAL;
    this.reason = TrackingReason.UNSPECIFIED;
    // Force a keyframe soon to refill features.
    this.lastKeyframeFrame = -1000;
    return true;
  }

  /** Rectified descriptor of a plane point X seen from `pose`. */
  _rectDesc(blurred, pose, X, H = planeHomography(pose, this.K)) {
    if (!this.rectSpacing) return null;
    return describeRectified(blurred, H, X, this.rectSpacing);
  }

  /** Rectified descriptors for corners whose rays hit the ground plane. */
  _cornerRectDescs(corners, blurred, pose) {
    const h = pose.t[1];
    const maxDist = this.cfg.maxPlaneDistance * Math.max(1e-6, h);
    const H = planeHomography(pose, this.K);
    return corners.map((k) => {
      const d = pixelRay(pose, this.K, k.x, k.y);
      const s = rayPlaneY(pose.t, d, 0);
      if (s <= 0 || s > maxDist) return null;
      return this._rectDesc(blurred, pose, add3(pose.t, scale3(d, s)), H);
    });
  }

  // ------------------------------------------------------------------ helpers

  _cellIndex(u, v) {
    const cx = Math.min(this.gridCols - 1, Math.max(0, Math.floor((u / this.K.width) * this.gridCols)));
    const cy = Math.min(this.gridRows - 1, Math.max(0, Math.floor((v / this.K.height) * this.gridRows)));
    return cy * this.gridCols + cx;
  }

  _detect(img, mask, perCell) {
    return detectFast(img, {
      threshold: this.cfg.fastThreshold,
      border: DESCRIPTOR_BORDER,
      gridCols: this.gridCols,
      gridRows: this.gridRows,
      perCell,
      cellMask: mask,
    });
  }

  /**
   * Trusted map points as a Float32Array [x, y, z, confidence, ...] for hit
   * testing and visualisation.
   */
  exportPoints(onlyTracked = false) {
    const pts = this.points.filter((p) => p.weight() > 0 && (!onlyTracked || p.tracked));
    const out = new Float32Array(pts.length * 4);
    pts.forEach((p, i) => {
      out[i * 4] = p.X[0];
      out[i * 4 + 1] = p.X[1];
      out[i * 4 + 2] = p.X[2];
      out[i * 4 + 3] = p.weight() * Math.min(1, p.inliers / 10);
    });
    return out;
  }
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
