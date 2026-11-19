// Grayscale images and image pyramids.

export class GrayImage {
  constructor(width, height, data = new Uint8Array(width * height)) {
    this.width = width;
    this.height = height;
    this.data = data;
  }
}

/**
 * Half-resolution image using the 5-tap binomial kernel [1 4 6 4 1] / 16 in both
 * directions followed by decimation (OpenCV pyrDown). Edges are clamped.
 */
export function pyrDown(src) {
  const { width: w, height: h, data: s } = src;
  const ow = w >> 1;
  const oh = h >> 1;
  const tmp = new Float32Array(ow * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < ow; x++) {
      const cx = x * 2;
      const xm2 = cx - 2 < 0 ? 0 : cx - 2;
      const xm1 = cx - 1 < 0 ? 0 : cx - 1;
      const xp1 = cx + 1 >= w ? w - 1 : cx + 1;
      const xp2 = cx + 2 >= w ? w - 1 : cx + 2;
      tmp[y * ow + x] = s[row + xm2] + 4 * s[row + xm1] + 6 * s[row + cx] + 4 * s[row + xp1] + s[row + xp2];
    }
  }
  const out = new Uint8Array(ow * oh);
  for (let y = 0; y < oh; y++) {
    const cy = y * 2;
    const ym2 = (cy - 2 < 0 ? 0 : cy - 2) * ow;
    const ym1 = (cy - 1 < 0 ? 0 : cy - 1) * ow;
    const y0 = cy * ow;
    const yp1 = (cy + 1 >= h ? h - 1 : cy + 1) * ow;
    const yp2 = (cy + 2 >= h ? h - 1 : cy + 2) * ow;
    for (let x = 0; x < ow; x++) {
      const v = tmp[ym2 + x] + 4 * tmp[ym1 + x] + 6 * tmp[y0 + x] + 4 * tmp[yp1 + x] + tmp[yp2 + x];
      out[y * ow + x] = (v + 128) >> 8;
    }
  }
  return new GrayImage(ow, oh, out);
}

export function buildPyramid(img, levels) {
  const pyr = [img];
  for (let i = 1; i < levels; i++) pyr.push(pyrDown(pyr[i - 1]));
  return pyr;
}

/** Separable 5-tap binomial blur (σ ≈ 1), used before sampling descriptors. */
export function blur5(src) {
  const { width: w, height: h, data: s } = src;
  const tmp = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const xm2 = x - 2 < 0 ? 0 : x - 2;
      const xm1 = x - 1 < 0 ? 0 : x - 1;
      const xp1 = x + 1 >= w ? w - 1 : x + 1;
      const xp2 = x + 2 >= w ? w - 1 : x + 2;
      tmp[row + x] = s[row + xm2] + 4 * s[row + xm1] + 6 * s[row + x] + 4 * s[row + xp1] + s[row + xp2];
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym2 = (y - 2 < 0 ? 0 : y - 2) * w;
    const ym1 = (y - 1 < 0 ? 0 : y - 1) * w;
    const y0 = y * w;
    const yp1 = (y + 1 >= h ? h - 1 : y + 1) * w;
    const yp2 = (y + 2 >= h ? h - 1 : y + 2) * w;
    for (let x = 0; x < w; x++) {
      const v = tmp[ym2 + x] + 4 * tmp[ym1 + x] + 6 * tmp[y0 + x] + 4 * tmp[yp1 + x] + tmp[yp2 + x];
      out[y0 + x] = (v + 128) >> 8;
    }
  }
  return new GrayImage(w, h, out);
}

/** Bilinear sample with edge clamping. */
export function sampleBilinear(img, x, y) {
  const { width: w, height: h, data } = img;
  let x0 = Math.floor(x);
  let y0 = Math.floor(y);
  let fx = x - x0;
  let fy = y - y0;
  if (x0 < 0) { x0 = 0; fx = 0; } else if (x0 >= w - 1) { x0 = w - 2; fx = 1; }
  if (y0 < 0) { y0 = 0; fy = 0; } else if (y0 >= h - 1) { y0 = h - 2; fy = 1; }
  const i = y0 * w + x0;
  const a = data[i];
  const b = data[i + 1];
  const c = data[i + w];
  const d = data[i + w + 1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * Exposure statistics in the style of 8th Wall's lighting estimator:
 * score = (fraction of near-white pixels) - (fraction of near-black pixels),
 * in [-1, 1]; plus mean luminance in [0, 1]. Subsamples for speed.
 */
export function exposureStats(img, step = 4) {
  const { width: w, height: h, data } = img;
  let sum = 0;
  let hi = 0;
  let lo = 0;
  let n = 0;
  for (let y = 0; y < h; y += step) {
    const row = y * w;
    for (let x = 0; x < w; x += step) {
      const v = data[row + x];
      sum += v;
      if (v >= 245) hi++;
      else if (v <= 10) lo++;
      n++;
    }
  }
  return { mean: n ? sum / (n * 255) : 0.5, score: n ? (hi - lo) / n : 0 };
}
