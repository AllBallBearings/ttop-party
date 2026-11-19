// Synthetic scene renderer for tracker tests: a textured tabletop at y = 0
// with a few boxes on it, inside a textured room. Renders grayscale images for
// exact camera poses so tracking accuracy can be measured against ground truth.

import { mulberry32, quatRotate, normalize3 } from '../../public/lib/plinth/core/math.js';
import { GrayImage } from '../../public/lib/plinth/vision/image.js';

export function makeTexture(size, seed, { blobs = 900, base = 128 } = {}) {
  const rand = mulberry32(seed);
  const tex = new Float32Array(size * size).fill(base);
  // Multi-octave value noise for low-frequency shading.
  for (let oct = 0; oct < 4; oct++) {
    const cells = 4 << oct;
    const grid = Array.from({ length: (cells + 1) * (cells + 1) }, () => rand() - 0.5);
    const amp = 40 / (oct + 1);
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * cells;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const a = grid[y0 * (cells + 1) + x0];
        const b = grid[y0 * (cells + 1) + x0 + 1];
        const c = grid[(y0 + 1) * (cells + 1) + x0];
        const d = grid[(y0 + 1) * (cells + 1) + x0 + 1];
        tex[y * size + x] += amp * (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy);
      }
    }
  }
  // High-contrast rectangles and discs give trackable corners.
  for (let i = 0; i < blobs; i++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const r = 2 + rand() * size * 0.012;
    const v = rand() < 0.5 ? 20 + rand() * 60 : 180 + rand() * 70;
    const rect = rand() < 0.6;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(size - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(size - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!rect && (x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        tex[y * size + x] = v;
      }
    }
  }
  const out = new Uint8Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(tex[i])));
  return { size, data: out };
}

function sampleTex(tex, u, v) {
  // u, v in texture pixels, wrapped.
  const s = tex.size;
  let x = u % s; if (x < 0) x += s;
  let y = v % s; if (y < 0) y += s;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = (x0 + 1) % s;
  const y1 = (y0 + 1) % s;
  const d = tex.data;
  const a = d[y0 * s + x0];
  const b = d[y0 * s + x1];
  const c = d[y1 * s + x0];
  const e = d[y1 * s + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
}

export function defaultScene(seed = 1) {
  return {
    tableTex: makeTexture(1024, seed, { blobs: 1400 }),
    tableTexScale: 1024 / 1.0, // texture pixels per meter
    table: { minX: -0.7, maxX: 0.7, minZ: -0.5, maxZ: 0.5 },
    boxes: [
      { min: [0.18, 0, -0.25], max: [0.3, 0.12, -0.12], tex: makeTexture(256, seed + 7, { blobs: 160 }) },
      { min: [-0.35, 0, 0.1], max: [-0.22, 0.2, 0.22], tex: makeTexture(256, seed + 9, { blobs: 160 }) },
    ],
    roomTex: makeTexture(1024, seed + 3, { blobs: 1200, base: 110 }),
    room: { half: 2.5, floorY: -0.75, ceilY: 1.8 },
  };
}

/**
 * Printed QR code lying on the table: {matrix: boolean[][], size (m between
 * the code's outer corners), center: [x, z], quiet: modules of white margin}.
 * Rows run along +z (top row at -z), columns along +x. Returns -1 outside.
 */
function sampleQr(qr, x, z) {
  const n = qr.matrix.length;
  const m = qr.size / n;
  const half = qr.size / 2 + (qr.quiet ?? 2) * m;
  const lx = x - qr.center[0];
  const lz = z - qr.center[1];
  if (Math.abs(lx) > half || Math.abs(lz) > half) return -1;
  const c = Math.floor((lx + qr.size / 2) / m);
  const r = Math.floor((lz + qr.size / 2) / m);
  if (r < 0 || c < 0 || r >= n || c >= n) return 235;
  return qr.matrix[r][c] ? 25 : 235;
}

function intersectBox(o, d, b) {
  let tmin = -Infinity;
  let tmax = Infinity;
  let axisMin = -1;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < b.min[a] || o[a] > b.max[a]) return null;
      continue;
    }
    let t1 = (b.min[a] - o[a]) / d[a];
    let t2 = (b.max[a] - o[a]) / d[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) { tmin = t1; axisMin = a; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin <= 1e-6) return null;
  return { t: tmin, axis: axisMin };
}

/** Trace one ray; returns intensity. */
export function traceRay(scene, o, d) {
  let bestT = Infinity;
  let value = 0;
  // Boxes
  for (const b of scene.boxes) {
    const hit = intersectBox(o, d, b);
    if (hit && hit.t < bestT) {
      bestT = hit.t;
      const p = [o[0] + d[0] * hit.t, o[1] + d[1] * hit.t, o[2] + d[2] * hit.t];
      const k = 1024;
      const [a1, a2] = hit.axis === 0 ? [2, 1] : hit.axis === 1 ? [0, 2] : [0, 1];
      const shade = hit.axis === 1 ? 1.0 : hit.axis === 0 ? 0.8 : 0.65;
      value = shade * sampleTex(b.tex, p[a1] * k, p[a2] * k);
    }
  }
  // Table top (y = 0)
  if (d[1] < -1e-9) {
    const t = -o[1] / d[1];
    if (t > 0 && t < bestT) {
      const x = o[0] + d[0] * t;
      const z = o[2] + d[2] * t;
      const tb = scene.table;
      if (x >= tb.minX && x <= tb.maxX && z >= tb.minZ && z <= tb.maxZ) {
        bestT = t;
        value = sampleTex(scene.tableTex, x * scene.tableTexScale, z * scene.tableTexScale);
        const qv = scene.qr ? sampleQr(scene.qr, x, z) : -1;
        if (qv >= 0) value = qv;
      }
    }
  }
  if (bestT < Infinity) return value;
  // Room: floor, ceiling and four walls.
  const r = scene.room;
  let tr = Infinity;
  let rv = 90;
  const planes = [
    [1, r.floorY, -1], [1, r.ceilY, 1], [0, -r.half, -1], [0, r.half, 1], [2, -r.half, -1], [2, r.half, 1],
  ];
  for (const [axis, pos] of planes) {
    if (Math.abs(d[axis]) < 1e-9) continue;
    const t = (pos - o[axis]) / d[axis];
    if (t <= 0 || t >= tr) continue;
    const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    const [a1, a2] = axis === 0 ? [2, 1] : axis === 1 ? [0, 2] : [0, 1];
    tr = t;
    rv = 0.85 * sampleTex(scene.roomTex, p[a1] * 300 + axis * 97, p[a2] * 300 + axis * 31);
  }
  return rv;
}

/** Render a grayscale image for a camera-to-world pose and intrinsics. */
export function render(scene, pose, K, { noise = 0, seed = 0, gain = 1 } = {}) {
  const { width: w, height: h } = K;
  const img = new GrayImage(w, h);
  const rand = noise ? mulberry32(seed) : null;
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      const dc = [(u - K.cx) / K.fx, -(v - K.cy) / K.fy, -1];
      const d = normalize3(quatRotate(pose.q, dc));
      let val = traceRay(scene, pose.t, d) * gain;
      if (rand) val += (rand() - 0.5) * 2 * noise;
      img.data[v * w + u] = val < 0 ? 0 : val > 255 ? 255 : val;
    }
  }
  return img;
}

/** Camera-to-world rotation looking from `eye` toward `target` (world up +Y). */
export function lookAtQuat(eye, target, roll = 0) {
  const f = normalize3([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  // Camera -Z = f; +X = right; +Y = up
  let right = [f[1] * 0 - f[2] * 1, f[2] * 0 - f[0] * 0, f[0] * 1 - f[1] * 0]; // f x up
  right = normalize3(right.every((x) => Math.abs(x) < 1e-9) ? [1, 0, 0] : right);
  const up = [
    right[1] * f[2] - right[2] * f[1],
    right[2] * f[0] - right[0] * f[2],
    right[0] * f[1] - right[1] * f[0],
  ];
  // Columns: right, up, -f
  const m = [right[0], up[0], -f[0], right[1], up[1], -f[1], right[2], up[2], -f[2]];
  // roll about camera z
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  const rz = [c, -s, 0, s, c, 0, 0, 0, 1];
  const mr = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    mr[i * 3 + j] = m[i * 3] * rz[j] + m[i * 3 + 1] * rz[3 + j] + m[i * 3 + 2] * rz[6 + j];
  }
  return mat3ToQuatLocal(mr);
}

function mat3ToQuatLocal(m) {
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
  const n = Math.hypot(...q);
  return q.map((x) => x / n);
}
