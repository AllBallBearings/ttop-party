// Geometric estimation for tracking: robust pose optimisation with IMU priors,
// triangulation, and RANSAC solvers that exploit the gravity direction.

import {
  quatRotate, quatConj, quatMul, quatNormalize, quatFromRotVec, quatToRotVec, quatToMat3,
  quatFromYaw, yawOfQuat, sub3, add3, scale3, dot3, cross3, norm3, normalize3, solveSPD, solveLinear,
  mulberry32,
} from '../core/math.js';

/**
 * Robust Gauss-Newton / Levenberg-Marquardt refinement of a camera-to-world
 * pose from 2D-3D correspondences, with optional IMU priors.
 *
 *   obs: array of {p: [x,y,z] world, u, v, w?}
 *   K: intrinsics {fx, fy, cx, cy}
 *   opts.huber: pixel threshold where the loss turns linear (default 2)
 *   opts.tukey: if set, final iterations use Tukey biweight with this cutoff
 *   opts.rotPrior: {q, sigma} — soft prior on the full orientation (sigma in rad)
 *   opts.tiltPrior: {q, sigma} — soft prior on roll/pitch only (yaw left free)
 *   opts.pixelSigma: pixel noise used to weight priors (default 1)
 *
 * Returns {pose, residuals (Float32Array of pixel errors), cost}.
 */
export function optimizePose(pose0, obs, K, opts = {}) {
  const {
    iterations = 8,
    huber = 2,
    tukey = 0,
    rotPrior = null,
    tiltPrior = null,
    pixelSigma = 1,
    fixRotation = false,
  } = opts;
  let q = pose0.q.slice();
  let t = pose0.t.slice();
  let lambda = 1e-4;
  const n = obs.length;
  const residuals = new Float32Array(n);

  const evaluate = (qq, tt, useTukey) => {
    const qi = quatConj(qq);
    let cost = 0;
    for (let i = 0; i < n; i++) {
      const o = obs[i];
      const pc = quatRotate(qi, sub3(o.p, tt));
      const z = -pc[2];
      let e;
      if (z <= 1e-6) {
        e = 1e3;
      } else {
        const du = K.cx + (K.fx * pc[0]) / z - o.u;
        const dv = K.cy - (K.fy * pc[1]) / z - o.v;
        e = Math.sqrt(du * du + dv * dv);
      }
      residuals[i] = e;
      cost += (o.w ?? 1) * robustCost(e, huber, useTukey ? tukey : 0);
    }
    cost += priorCost(qq, rotPrior, tiltPrior, pixelSigma);
    return cost;
  };

  let useTukey = false;
  let cost = evaluate(q, t, false);
  for (let it = 0; it < iterations; it++) {
    if (tukey > 0 && it >= iterations / 2 && !useTukey) {
      useTukey = true;
      cost = evaluate(q, t, true);
    }
    const H = new Float64Array(36);
    const g = new Float64Array(6);
    const R = quatToMat3(q);
    const qi = quatConj(q);
    for (let i = 0; i < n; i++) {
      const o = obs[i];
      const pc = quatRotate(qi, sub3(o.p, t));
      const z = -pc[2];
      if (z <= 1e-6) continue;
      const iz = 1 / z;
      const ru = K.cx + K.fx * pc[0] * iz - o.u;
      const rv = K.cy - K.fy * pc[1] * iz - o.v;
      const e = Math.sqrt(ru * ru + rv * rv);
      const w = (o.w ?? 1) * robustWeight(e, huber, useTukey ? tukey : 0);
      if (w <= 0) continue;
      // d(u,v)/d(pc)
      const a0 = K.fx * iz;
      const a2 = K.fx * pc[0] * iz * iz;
      const b1 = -K.fy * iz;
      const b2 = -K.fy * pc[1] * iz * iz;
      // dpc/dθ = [pc]x ; dpc/dt = -R^T
      const [X, Y, Z] = pc;
      // Rows of [pc]x
      const sk = [0, -Z, Y, Z, 0, -X, -Y, X, 0];
      const Ju = new Float64Array(6);
      const Jv = new Float64Array(6);
      for (let c = 0; c < 3; c++) {
        Ju[c] = a0 * sk[c] + a2 * sk[6 + c];
        Jv[c] = b1 * sk[3 + c] + b2 * sk[6 + c];
        // -R^T column c => -(row c of R)... (R^T)[r][c] = R[c][r]
        const rTx = R[c * 3 + 0];
        const rTy = R[c * 3 + 1];
        const rTz = R[c * 3 + 2];
        // dpc/dt_c = -(R^T) e_c = -[R[c][0], R[c][1], R[c][2]] ... (column c of R^T is row c of R)
        Ju[3 + c] = -(a0 * rTx + a2 * rTz);
        Jv[3 + c] = -(b1 * rTy + b2 * rTz);
      }
      for (let r = 0; r < 6; r++) {
        g[r] += w * (Ju[r] * ru + Jv[r] * rv);
        for (let c = r; c < 6; c++) H[r * 6 + c] += w * (Ju[r] * Ju[c] + Jv[r] * Jv[c]);
      }
    }
    addPriors(q, H, g, rotPrior, tiltPrior, pixelSigma);
    for (let r = 0; r < 6; r++) for (let c = 0; c < r; c++) H[r * 6 + c] = H[c * 6 + r];
    if (fixRotation) {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 6; c++) { H[r * 6 + c] = 0; H[c * 6 + r] = 0; }
        H[r * 6 + r] = 1;
        g[r] = 0;
      }
    }

    let improved = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const A = Float64Array.from(H);
      for (let d = 0; d < 6; d++) A[d * 7] += lambda * (H[d * 7] + 1e-6);
      const dx = solveSPD(A, g.map((x) => -x), 6);
      if (!dx) { lambda *= 10; continue; }
      const qn = quatNormalize(quatMul(q, quatFromRotVec([dx[0], dx[1], dx[2]])));
      const tn = [t[0] + dx[3], t[1] + dx[4], t[2] + dx[5]];
      const cn = evaluate(qn, tn, useTukey);
      if (cn <= cost) {
        q = qn;
        t = tn;
        const rel = (cost - cn) / Math.max(cost, 1e-9);
        cost = cn;
        lambda = Math.max(1e-7, lambda * 0.3);
        improved = true;
        if (rel < 1e-6) it = iterations;
        break;
      }
      lambda *= 10;
    }
    if (!improved) break;
  }
  evaluate(q, t, useTukey);
  return { pose: { q, t }, residuals, cost };
}

function robustCost(e, huber, tukey) {
  if (tukey > 0) {
    if (e >= tukey) return (tukey * tukey) / 6;
    const r = 1 - (e / tukey) ** 2;
    return ((tukey * tukey) / 6) * (1 - r * r * r);
  }
  return e <= huber ? 0.5 * e * e : huber * (e - 0.5 * huber);
}

function robustWeight(e, huber, tukey) {
  if (tukey > 0) {
    if (e >= tukey) return 0;
    const r = 1 - (e / tukey) ** 2;
    return r * r;
  }
  return e <= huber ? 1 : huber / e;
}

// Rotation-prior residual: r = log(q_prior^-1 q) (local frame), J ≈ I.
// Tilt prior: same residual with the component about world-up (in the camera
// frame) projected out, so yaw stays free.
function priorTerms(q, rotPrior, tiltPrior, pixelSigma) {
  const terms = [];
  if (rotPrior) {
    const r = quatToRotVec(quatMul(quatConj(rotPrior.q), q));
    const k = pixelSigma / rotPrior.sigma;
    terms.push({ r, k, P: null });
  }
  if (tiltPrior) {
    // Compare world-up as seen in the camera frame: r = u_est x u_prior.
    // With a right-multiplied camera-frame perturbation δ, r(δ) ≈ r + (I - u uᵀ) δ,
    // so yaw (rotation about u) is unconstrained and no yaw decomposition is
    // needed (which would be singular when looking straight down).
    const up = quatRotate(quatConj(q), [0, 1, 0]);
    const upPrior = quatRotate(quatConj(tiltPrior.q), [0, 1, 0]);
    const r = cross3(up, upPrior);
    const P = [
      1 - up[0] * up[0], -up[0] * up[1], -up[0] * up[2],
      -up[1] * up[0], 1 - up[1] * up[1], -up[1] * up[2],
      -up[2] * up[0], -up[2] * up[1], 1 - up[2] * up[2],
    ];
    terms.push({ r, k: pixelSigma / tiltPrior.sigma, P });
  }
  return terms;
}

function priorCost(q, rotPrior, tiltPrior, pixelSigma) {
  let c = 0;
  for (const { r, k } of priorTerms(q, rotPrior, tiltPrior, pixelSigma)) {
    c += 0.5 * k * k * dot3(r, r);
  }
  return c;
}

function addPriors(q, H, g, rotPrior, tiltPrior, pixelSigma) {
  for (const { r, k, P } of priorTerms(q, rotPrior, tiltPrior, pixelSigma)) {
    const k2 = k * k;
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        const j = P ? P[a * 3 + b] : a === b ? 1 : 0;
        // J = P (or I); H += k² JᵀJ, g += k² Jᵀ r. P is symmetric idempotent.
        H[a * 6 + b] += k2 * j;
      }
      g[a] += k2 * r[a];
    }
  }
}

/** Project a world point with a camera-to-world pose. Returns [u, v, depth] or null. */
export function projectPoint(pose, K, p) {
  const pc = quatRotate(quatConj(pose.q), sub3(p, pose.t));
  const z = -pc[2];
  if (z <= 1e-6) return null;
  return [K.cx + (K.fx * pc[0]) / z, K.cy - (K.fy * pc[1]) / z, z];
}

/**
 * Homography mapping ground-plane coordinates [x, z, 1] (plane y = 0) to image
 * homogeneous coordinates [u w, v w, w] for a camera-to-world pose. w <= 0
 * means behind the camera. Row-major 3x3.
 */
export function planeHomography(pose, K) {
  const qi = quatConj(pose.q);
  const a = quatRotate(qi, [1, 0, 0]);
  const b = quatRotate(qi, [0, 0, 1]);
  const c = quatRotate(qi, [-pose.t[0], -pose.t[1], -pose.t[2]]);
  // w = -z_cam ; u w = fx x_cam + cx w ; v w = -fy y_cam + cy w
  return [
    K.fx * a[0] - K.cx * a[2], K.fx * b[0] - K.cx * b[2], K.fx * c[0] - K.cx * c[2],
    -K.fy * a[1] - K.cy * a[2], -K.fy * b[1] - K.cy * b[2], -K.fy * c[1] - K.cy * c[2],
    -a[2], -b[2], -c[2],
  ];
}

/** World-space unit ray through pixel (u, v) for a camera-to-world pose. */
export function pixelRay(pose, K, u, v) {
  return normalize3(quatRotate(pose.q, [(u - K.cx) / K.fx, -(v - K.cy) / K.fy, -1]));
}

/** Intersect a ray with the horizontal plane y = h. Returns distance along ray or -1. */
export function rayPlaneY(origin, dir, h = 0) {
  if (Math.abs(dir[1]) < 1e-9) return -1;
  const s = (h - origin[1]) / dir[1];
  return s > 0 ? s : -1;
}

/**
 * N-view triangulation minimising the sum of squared distances to the rays.
 * rays: [{c: origin, d: unit dir}]. Returns {p, maxParallax (rad)} or null.
 */
export function triangulateRays(rays) {
  const A = new Float64Array(9);
  const b = [0, 0, 0];
  for (const { c, d } of rays) {
    const m = [
      1 - d[0] * d[0], -d[0] * d[1], -d[0] * d[2],
      -d[1] * d[0], 1 - d[1] * d[1], -d[1] * d[2],
      -d[2] * d[0], -d[2] * d[1], 1 - d[2] * d[2],
    ];
    for (let i = 0; i < 9; i++) A[i] += m[i];
    b[0] += m[0] * c[0] + m[1] * c[1] + m[2] * c[2];
    b[1] += m[3] * c[0] + m[4] * c[1] + m[5] * c[2];
    b[2] += m[6] * c[0] + m[7] * c[1] + m[8] * c[2];
  }
  const p = solveLinear(A, b, 3);
  if (!p) return null;
  let maxParallax = 0;
  for (let i = 0; i < rays.length; i++) {
    for (let j = i + 1; j < rays.length; j++) {
      const a = Math.acos(Math.min(1, Math.max(-1, dot3(rays[i].d, rays[j].d))));
      if (a > maxParallax) maxParallax = a;
    }
  }
  const pt = [p[0], p[1], p[2]];
  // Must be in front of every camera.
  for (const { c, d } of rays) if (dot3(sub3(pt, c), d) <= 0) return null;
  return { p: pt, maxParallax };
}

/**
 * Translation from >= 2 correspondences when the rotation is known (from the
 * IMU). Each world bearing d_i must satisfy d_i x (P_i - t) = 0, linear in t.
 */
export function translationFromKnownRotation(q, K, obs, idx) {
  const A = new Float64Array(9);
  const b = [0, 0, 0];
  for (const i of idx) {
    const o = obs[i];
    const d = normalize3(quatRotate(q, [(o.u - K.cx) / K.fx, -(o.v - K.cy) / K.fy, -1]));
    // (I - d dᵀ)(t - P) = 0
    const m = [
      1 - d[0] * d[0], -d[0] * d[1], -d[0] * d[2],
      -d[1] * d[0], 1 - d[1] * d[1], -d[1] * d[2],
      -d[2] * d[0], -d[2] * d[1], 1 - d[2] * d[2],
    ];
    for (let k = 0; k < 9; k++) A[k] += m[k];
    const P = o.p;
    b[0] += m[0] * P[0] + m[1] * P[1] + m[2] * P[2];
    b[1] += m[3] * P[0] + m[4] * P[1] + m[5] * P[2];
    b[2] += m[6] * P[0] + m[7] * P[1] + m[8] * P[2];
  }
  const t = solveLinear(A, b, 3);
  return t ? [t[0], t[1], t[2]] : null;
}

function countInliers(pose, K, obs, thresh, mask) {
  let n = 0;
  const qi = quatConj(pose.q);
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    const pc = quatRotate(qi, sub3(o.p, pose.t));
    const z = -pc[2];
    let ok = false;
    if (z > 1e-6) {
      const du = K.cx + (K.fx * pc[0]) / z - o.u;
      const dv = K.cy - (K.fy * pc[1]) / z - o.v;
      ok = du * du + dv * dv <= thresh * thresh;
    }
    if (mask) mask[i] = ok ? 1 : 0;
    if (ok) n++;
  }
  return n;
}

/**
 * RANSAC over translation with a fixed rotation (2-point minimal sets).
 * Returns {pose, inliers: Uint8Array, count} or null.
 */
export function ransacTranslation(q, K, obs, opts = {}) {
  const { iterations = 40, threshold = 4, seed = 7 } = opts;
  if (obs.length < 3) return null;
  const rand = mulberry32(seed);
  let best = null;
  let bestCount = -1;
  for (let it = 0; it < iterations; it++) {
    const i = Math.floor(rand() * obs.length);
    let j = Math.floor(rand() * obs.length);
    if (j === i) j = (j + 1) % obs.length;
    const t = translationFromKnownRotation(q, K, obs, [i, j]);
    if (!t) continue;
    const pose = { q, t };
    const c = countInliers(pose, K, obs, threshold, null);
    if (c > bestCount) { bestCount = c; best = pose; }
  }
  if (!best) return null;
  const inliers = new Uint8Array(obs.length);
  countInliers(best, K, obs, threshold, inliers);
  const idx = [];
  inliers.forEach((v, i) => v && idx.push(i));
  const t = idx.length >= 2 ? translationFromKnownRotation(q, K, obs, idx) : best.t;
  const pose = { q, t: t || best.t };
  const count = countInliers(pose, K, obs, threshold, inliers);
  return { pose, inliers, count };
}

/**
 * Gravity-aware absolute pose (4 DoF: yaw + translation) from >= 3 2D-3D
 * correspondences, given the camera tilt (roll/pitch) from the IMU.
 * tiltQ is a camera-to-world rotation whose yaw is ignored.
 * The constraint R_y(-ψ)(P - t) ∥ b (b = tilt-corrected bearing) is linear in
 * (cos ψ, sin ψ, t'), t' = R_y(-ψ) t.
 */
export function absolutePoseGravity(tiltQ, K, obs, idx) {
  const tilt = quatNormalize(quatMul(quatFromYaw(-yawOfQuat(tiltQ)), tiltQ));
  const rows = [];
  const rhs = [];
  for (const i of idx) {
    const o = obs[i];
    const b = normalize3(quatRotate(tilt, [(o.u - K.cx) / K.fx, -(o.v - K.cy) / K.fy, -1]));
    const [X, Y, Z] = o.p;
    // Q = [cX - sZ - tx, Y - ty, sX + cZ - tz]; unknowns z = [c, s, tx, ty, tz]
    const Qc = [[X, -Z, -1, 0, 0], [0, 0, 0, -1, 0], [Z, X, 0, 0, -1]];
    const Qk = [0, Y, 0];
    // Q x b = 0 -> rows: Q1 b2 - Q2 b1, Q2 b0 - Q0 b2, Q0 b1 - Q1 b0
    const pairs = [[1, 2], [2, 0], [0, 1]];
    for (const [a, c] of pairs) {
      const row = new Array(5);
      for (let k = 0; k < 5; k++) row[k] = Qc[a][k] * b[c] - Qc[c][k] * b[a];
      rows.push(row);
      rhs.push(-(Qk[a] * b[c] - Qk[c] * b[a]));
    }
  }
  // Least squares via normal equations.
  const AtA = new Float64Array(25);
  const Atb = new Float64Array(5);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let i = 0; i < 5; i++) {
      Atb[i] += row[i] * rhs[r];
      for (let j = 0; j < 5; j++) AtA[i * 5 + j] += row[i] * row[j];
    }
  }
  const z = solveLinear(AtA, Atb, 5);
  if (!z) return null;
  const psi = Math.atan2(z[1], z[0]);
  const q = quatNormalize(quatMul(quatFromYaw(psi), tilt));
  // Re-solve translation exactly for this rotation.
  const t = translationFromKnownRotation(q, K, obs, idx);
  if (!t) return null;
  return { q, t };
}

/**
 * RANSAC wrapper for absolutePoseGravity (3-point samples) followed by robust
 * refinement. Returns {pose, inliers, count} or null.
 */
export function ransacAbsolutePoseGravity(tiltQ, K, obs, opts = {}) {
  const { iterations = 120, threshold = 5, seed = 11, minInliers = 10 } = opts;
  if (obs.length < minInliers) return null;
  const rand = mulberry32(seed);
  let best = null;
  let bestCount = -1;
  for (let it = 0; it < iterations; it++) {
    const s = new Set();
    while (s.size < 3) s.add(Math.floor(rand() * obs.length));
    const pose = absolutePoseGravity(tiltQ, K, obs, [...s]);
    if (!pose) continue;
    const c = countInliers(pose, K, obs, threshold, null);
    if (c > bestCount) { bestCount = c; best = pose; }
  }
  if (!best || bestCount < minInliers) return null;
  const inliers = new Uint8Array(obs.length);
  countInliers(best, K, obs, threshold, inliers);
  const inObs = obs.filter((_, i) => inliers[i]);
  const refined = optimizePose(best, inObs, K, {
    iterations: 6, huber: 2, tiltPrior: { q: tiltQ, sigma: 0.02 },
  }).pose;
  const count = countInliers(refined, K, obs, threshold, inliers);
  if (count < minInliers) return null;
  return { pose: refined, inliers, count };
}

export { add3, sub3, scale3, cross3, norm3 };
