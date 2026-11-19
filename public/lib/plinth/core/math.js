// Plinth — small, allocation-light linear algebra for tracking code.
//
// Conventions used throughout Plinth:
//   * Vectors are plain arrays [x, y, z].
//   * Quaternions are [x, y, z, w] (Hamilton product, rotates v as q v q*).
//   * 3x3 matrices are flat row-major arrays of length 9.
//   * World frame is right-handed, +Y up (opposite gravity).
//   * Camera frame follows three.js: +X right, +Y up, looking down -Z.
//   * A pose {q, t} is camera-to-world: p_world = R(q) p_cam + t.

export const EPS = 1e-12;

// ---------------------------------------------------------------- vec3

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm3 = (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
export const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function normalize3(a) {
  const n = norm3(a);
  return n < EPS ? [0, 0, 0] : [a[0] / n, a[1] / n, a[2] / n];
}
export const lerp3 = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// ---------------------------------------------------------------- quaternion

export const quatIdentity = () => [0, 0, 0, 1];

export function quatMul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export const quatConj = (q) => [-q[0], -q[1], -q[2], q[3]];

export function quatNormalize(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  if (n < EPS) return [0, 0, 0, 1];
  // Keep w >= 0 so quaternions have a canonical sign (helps filtering).
  const s = q[3] < 0 ? -1 / n : 1 / n;
  return [q[0] * s, q[1] * s, q[2] * s, q[3] * s];
}

export function quatRotate(q, v) {
  // v' = v + 2w (u x v) + 2 u x (u x v), u = q.xyz
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

export function quatFromAxisAngle(axis, angle) {
  const a = normalize3(axis);
  const s = Math.sin(angle / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
}

/** Exponential map: rotation vector (axis * angle) -> quaternion. */
export function quatFromRotVec(r) {
  const th = norm3(r);
  if (th < 1e-9) return quatNormalize([r[0] / 2, r[1] / 2, r[2] / 2, 1]);
  const s = Math.sin(th / 2) / th;
  return [r[0] * s, r[1] * s, r[2] * s, Math.cos(th / 2)];
}

/** Logarithm map: quaternion -> rotation vector (axis * angle), angle in [0, pi]. */
export function quatToRotVec(q) {
  let [x, y, z, w] = q;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.sqrt(x * x + y * y + z * z);
  if (s < 1e-9) return [2 * x, 2 * y, 2 * z];
  const th = 2 * Math.atan2(s, w);
  const k = th / s;
  return [x * k, y * k, z * k];
}

/** Angle (radians) of the relative rotation between two quaternions. */
export function quatAngle(a, b) {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, d));
}

export function quatSlerp(a, b, t) {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; cos = -cos; }
  if (cos > 0.9995) {
    return quatNormalize([
      a[0] + (bx - a[0]) * t,
      a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t,
      a[3] + (bw - a[3]) * t,
    ]);
  }
  const th = Math.acos(cos);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

export function quatToMat3(q) {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ];
}

export function mat3ToQuat(m) {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return quatNormalize(q);
}

/** Rotation that maps unit vector a onto unit vector b (shortest arc). */
export function quatFromTo(a, b) {
  const u = normalize3(a);
  const v = normalize3(b);
  const d = dot3(u, v);
  if (d < -0.999999) {
    let axis = cross3([1, 0, 0], u);
    if (norm3(axis) < 1e-6) axis = cross3([0, 1, 0], u);
    return quatFromAxisAngle(axis, Math.PI);
  }
  const c = cross3(u, v);
  return quatNormalize([c[0], c[1], c[2], 1 + d]);
}

/**
 * Heading of a camera-to-world rotation around world +Y. Measured from the
 * camera's forward (-Z) projected on the horizontal plane; 0 means facing -Z.
 */
export function yawOfQuat(q) {
  const f = quatRotate(q, [0, 0, -1]);
  return Math.atan2(-f[0], -f[2]);
}

export const quatFromYaw = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

/** Remove the yaw component, keeping only tilt (roll + pitch) relative to gravity. */
export function quatTiltOnly(q) {
  return quatNormalize(quatMul(quatFromYaw(-yawOfQuat(q)), q));
}

export function normalizeAngle(a) {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

// ---------------------------------------------------------------- mat3

export function mat3Mul(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return r;
}

export const mat3T = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

export const mat3MulVec = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

export const mat3TMulVec = (m, v) => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];

// ---------------------------------------------------------------- pose helpers

/** Transform a world point into the camera frame of a camera-to-world pose. */
export function worldToCamera(pose, p) {
  return quatRotate(quatConj(pose.q), sub3(p, pose.t));
}

export function cameraToWorld(pose, p) {
  return add3(quatRotate(pose.q, p), pose.t);
}

export const clonePose = (p) => ({ q: p.q.slice(), t: p.t.slice() });

/** Compose poses: (a ∘ b) maps b's local frame through a. */
export function poseMul(a, b) {
  return { q: quatNormalize(quatMul(a.q, b.q)), t: add3(quatRotate(a.q, b.t), a.t) };
}

export function poseInverse(p) {
  const qi = quatConj(p.q);
  return { q: qi, t: scale3(quatRotate(qi, p.t), -1) };
}

// ---------------------------------------------------------------- linear solvers

/**
 * Solve the symmetric positive (semi)definite n x n system A x = b by Cholesky.
 * A is a flat row-major Float64Array/Array; it is not modified. Returns null if
 * the system is singular.
 */
export function solveSPD(A, b, n) {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      if (i === j) {
        if (s <= 1e-15) return null;
        L[i * n + i] = Math.sqrt(s);
      } else {
        L[i * n + j] = s / L[j * n + j];
      }
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k];
    y[i] = s / L[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}

/** General n x n solve with partial pivoting. Returns null if singular. */
export function solveLinear(A, b, n) {
  const M = new Float64Array(n * (n + 1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i * (n + 1) + j] = A[i * n + j];
    M[i * (n + 1) + n] = b[i];
  }
  const w = n + 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    let best = Math.abs(M[c * w + c]);
    for (let r = c + 1; r < n; r++) {
      const v = Math.abs(M[r * w + c]);
      if (v > best) { best = v; p = r; }
    }
    if (best < 1e-14) return null;
    if (p !== c) {
      for (let j = c; j < w; j++) {
        const t = M[c * w + j]; M[c * w + j] = M[p * w + j]; M[p * w + j] = t;
      }
    }
    const d = M[c * w + c];
    for (let r = c + 1; r < n; r++) {
      const f = M[r * w + c] / d;
      if (f === 0) continue;
      for (let j = c; j < w; j++) M[r * w + j] -= f * M[c * w + j];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i * w + n];
    for (let j = i + 1; j < n; j++) s -= M[i * w + j] * x[j];
    x[i] = s / M[i * w + i];
  }
  return x;
}

/** Symmetric 3x3 eigen-decomposition (Jacobi). Returns {values, vectors} ascending; vectors are columns. */
export function eigenSym3(m) {
  const a = m.slice();
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 32; sweep++) {
    const off = Math.abs(a[1]) + Math.abs(a[2]) + Math.abs(a[5]);
    if (off < 1e-14) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = a[p * 3 + q];
      if (Math.abs(apq) < 1e-18) continue;
      const app = a[p * 3 + p];
      const aqq = a[q * 3 + q];
      const theta = (aqq - app) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p];
        const akq = a[k * 3 + q];
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k];
        const aqk = a[q * 3 + k];
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p];
        const vkq = v[k * 3 + q];
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  const idx = [0, 1, 2].sort((i, j) => a[i * 4] - a[j * 4]);
  return {
    values: idx.map((i) => a[i * 4]),
    vectors: idx.map((i) => [v[i], v[3 + i], v[6 + i]]),
  };
}

// ---------------------------------------------------------------- misc

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/** Deterministic PRNG (mulberry32) so tests and descriptor patterns are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function median(values) {
  if (!values.length) return NaN;
  const s = Float64Array.from(values).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}
