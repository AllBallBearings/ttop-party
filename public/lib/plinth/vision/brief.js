// Oriented BRIEF (ORB-style) 256-bit binary descriptors.
//
// 8th Wall's "Gr8" features were forked from OpenCV ORB. Their tracker uses
// intensity-centroid orientation (ORB) for rays pointing at the ground and a
// gravity-derived orientation (GORB) elsewhere. Plinth targets tabletops where
// the camera often looks steeply down, so it uses intensity-centroid
// orientation everywhere, which is rotation invariant at every view angle.

import { mulberry32 } from '../core/math.js';

export const DESC_WORDS = 8; // 256 bits
const PATCH_RADIUS = 15;
const PAIR_RADIUS = 12;
const ANGLE_BINS = 30;

function makePattern() {
  const rand = mulberry32(0x0b51ef);
  const gauss = () => {
    // Box-Muller
    const u = Math.max(1e-9, rand());
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const sigma = 31 / 5;
  const pairs = [];
  while (pairs.length < 256) {
    const p = [gauss() * sigma, gauss() * sigma, gauss() * sigma, gauss() * sigma];
    if (Math.hypot(p[0], p[1]) > PAIR_RADIUS || Math.hypot(p[2], p[3]) > PAIR_RADIUS) continue;
    if (Math.round(p[0]) === Math.round(p[2]) && Math.round(p[1]) === Math.round(p[3])) continue;
    pairs.push(p);
  }
  return pairs;
}

const BASE_PATTERN = makePattern();

// Pre-rotated patterns as (dx1, dy1, dx2, dy2) integer offsets per angle bin.
const ROTATED = Array.from({ length: ANGLE_BINS }, (_, b) => {
  const a = (b * 2 * Math.PI) / ANGLE_BINS;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const out = new Int8Array(256 * 4);
  BASE_PATTERN.forEach(([x1, y1, x2, y2], i) => {
    out[i * 4] = Math.round(c * x1 - s * y1);
    out[i * 4 + 1] = Math.round(s * x1 + c * y1);
    out[i * 4 + 2] = Math.round(c * x2 - s * y2);
    out[i * 4 + 3] = Math.round(s * x2 + c * y2);
  });
  return out;
});

// Circular patch row extents for the intensity centroid.
const UMAX = Array.from({ length: PATCH_RADIUS + 1 }, (_, v) =>
  Math.floor(Math.sqrt(PATCH_RADIUS * PATCH_RADIUS - v * v))
);

/** Intensity-centroid orientation (radians) of a circular patch around (x, y). */
export function orientation(img, x, y) {
  const { width: w, data } = img;
  const c = y * w + x;
  let m01 = 0;
  let m10 = 0;
  for (let u = -PATCH_RADIUS; u <= PATCH_RADIUS; u++) m10 += u * data[c + u];
  for (let v = 1; v <= PATCH_RADIUS; v++) {
    let vsum = 0;
    const d = UMAX[v];
    for (let u = -d; u <= d; u++) {
      const top = data[c + u - v * w];
      const bot = data[c + u + v * w];
      vsum += bot - top;
      m10 += u * (bot + top);
    }
    m01 += v * vsum;
  }
  return Math.atan2(m01, m10);
}

/**
 * Compute a 256-bit descriptor at integer pixel (x, y) of a blurred image.
 * The caller must keep (x, y) at least 16 px from the border.
 */
export function describe(blurred, x, y, angle, out = new Uint32Array(DESC_WORDS)) {
  const { width: w, data } = blurred;
  let bin = Math.round((angle / (2 * Math.PI)) * ANGLE_BINS) % ANGLE_BINS;
  if (bin < 0) bin += ANGLE_BINS;
  const pat = ROTATED[bin];
  const c = y * w + x;
  for (let word = 0; word < DESC_WORDS; word++) {
    let bits = 0;
    for (let b = 0; b < 32; b++) {
      const k = (word * 32 + b) * 4;
      const a = data[c + pat[k + 1] * w + pat[k]];
      const d = data[c + pat[k + 3] * w + pat[k + 2]];
      if (a < d) bits |= 1 << b;
    }
    out[word] = bits >>> 0;
  }
  return out;
}

/**
 * Ground-plane rectified descriptor ("top-down BRIEF").
 *
 * For a point X on the ground plane y = 0, the BRIEF pattern is laid out on the
 * plane itself, aligned with the world X/Z axes, with `spacing` world units per
 * pattern unit, and each sample is mapped into the image through the
 * plane-to-image homography H (see planeHomography in geometry.js). The
 * descriptor is therefore (to first order) invariant to the viewing direction,
 * distance and in-plane rotation of the camera — the dominant appearance
 * changes when walking around a table — provided the world yaw is known
 * (from the tracker, or from the IMU over a short tracking loss).
 *
 * Returns null if any sample falls outside the image or behind the camera.
 */
export function describeRectified(blurred, H, X, spacing, out = new Uint32Array(DESC_WORDS)) {
  const { width: w, height: h, data } = blurred;
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = H;
  const x0 = X[0];
  const z0 = X[2];
  const sample = (px, pz) => {
    const x = x0 + px * spacing;
    const z = z0 + pz * spacing;
    const ww = h6 * x + h7 * z + h8;
    if (ww <= 1e-9) return -1;
    const u = (h0 * x + h1 * z + h2) / ww;
    const v = (h3 * x + h4 * z + h5) / ww;
    if (u < 0 || v < 0 || u > w - 2 || v > h - 2) return -1;
    const xi = u | 0;
    const yi = v | 0;
    const fx = u - xi;
    const fy = v - yi;
    const i = yi * w + xi;
    const a = data[i];
    const b = data[i + 1];
    const c = data[i + w];
    const d = data[i + w + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  for (let word = 0; word < DESC_WORDS; word++) {
    let bits = 0;
    for (let b = 0; b < 32; b++) {
      const [x1, y1, x2, y2] = BASE_PATTERN[word * 32 + b];
      const s1 = sample(x1, y1);
      const s2 = sample(x2, y2);
      if (s1 < 0 || s2 < 0) return null;
      if (s1 < s2) bits |= 1 << b;
    }
    out[word] = bits >>> 0;
  }
  return out;
}

function popcount32(v) {
  let x = v - ((v >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24);
}

export function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < DESC_WORDS; i++) d += popcount32(a[i] ^ b[i]);
  return d;
}

export const DESCRIPTOR_BORDER = PATCH_RADIUS + 1;
