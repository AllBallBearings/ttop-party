// FAST-9 corner detection with grid bucketing.
//
// 8th Wall computes FAST-9 scores on the GPU (gr8-stage2.frag) and selects the
// strongest corners per grid bin on the CPU. Plinth runs FAST on the CPU in its
// tracking worker, only inside grid cells that need new features, which keeps
// the per-frame cost small.

// Bresenham circle of radius 3 (16 pixels), as (dx, dy).
const CIRCLE = [
  [0, -3], [1, -3], [2, -2], [3, -1], [3, 0], [3, 1], [2, 2], [1, 3],
  [0, 3], [-1, 3], [-2, 2], [-3, 1], [-3, 0], [-3, -1], [-2, -2], [-1, -3],
];

function circleOffsets(stride) {
  return CIRCLE.map(([dx, dy]) => dy * stride + dx);
}

const ARC = 9;

/**
 * Returns the FAST score at pixel index i (0 if not a corner): the sum of
 * absolute differences beyond the threshold over the 16 circle pixels, if a
 * contiguous arc of >= 9 pixels is all brighter or all darker than centre ± t.
 */
function fastScore(data, i, offs, t) {
  const c = data[i];
  const hi = c + t;
  const lo = c - t;
  // Quick rejection using the 4 compass points: at least 2 adjacent must agree.
  const p0 = data[i + offs[0]];
  const p8 = data[i + offs[8]];
  if (p0 <= hi && p0 >= lo && p8 <= hi && p8 >= lo) return 0;
  const p4 = data[i + offs[4]];
  const p12 = data[i + offs[12]];
  let nb = 0;
  let nd = 0;
  if (p0 > hi) nb++; else if (p0 < lo) nd++;
  if (p4 > hi) nb++; else if (p4 < lo) nd++;
  if (p8 > hi) nb++; else if (p8 < lo) nd++;
  if (p12 > hi) nb++; else if (p12 < lo) nd++;
  if (nb < 2 && nd < 2) return 0;

  // Full test: classify the circle, look for a 9-arc (wrapping).
  let runB = 0;
  let runD = 0;
  let bestB = 0;
  let bestD = 0;
  let sumB = 0;
  let sumD = 0;
  for (let k = 0; k < 16 + ARC - 1; k++) {
    const v = data[i + offs[k & 15]];
    if (v > hi) {
      runB++; runD = 0;
      if (runB > bestB) bestB = runB;
    } else if (v < lo) {
      runD++; runB = 0;
      if (runD > bestD) bestD = runD;
    } else {
      runB = 0; runD = 0;
    }
    if (k < 16) {
      if (v > hi) sumB += v - hi;
      else if (v < lo) sumD += lo - v;
    }
  }
  if (bestB >= ARC) return sumB;
  if (bestD >= ARC) return sumD;
  return 0;
}

/**
 * Detect FAST corners. Options:
 *   threshold   intensity threshold (default 20)
 *   border      pixels to skip at the image edge (default 16, enough for descriptors)
 *   gridCols, gridRows, perCell   keep the best `perCell` corners per cell
 *   cellMask    optional Uint8Array(gridCols*gridRows); cells with 0 are skipped
 *   minScore    discard weaker corners
 * Returns an array of {x, y, score}.
 */
export function detectFast(img, opts = {}) {
  const {
    threshold = 20,
    border = 16,
    gridCols = 8,
    gridRows = 8,
    perCell = 2,
    cellMask = null,
    minScore = 0,
  } = opts;
  const { width: w, height: h, data } = img;
  const offs = circleOffsets(w);
  const cellW = w / gridCols;
  const cellH = h / gridRows;
  const scores = new Float32Array(w * h);
  const cells = Array.from({ length: gridCols * gridRows }, () => []);

  for (let gy = 0; gy < gridRows; gy++) {
    const y0 = Math.max(border, Math.floor(gy * cellH));
    const y1 = Math.min(h - border, Math.floor((gy + 1) * cellH));
    for (let gx = 0; gx < gridCols; gx++) {
      const ci = gy * gridCols + gx;
      if (cellMask && !cellMask[ci]) continue;
      const x0 = Math.max(border, Math.floor(gx * cellW));
      const x1 = Math.min(w - border, Math.floor((gx + 1) * cellW));
      for (let y = y0; y < y1; y++) {
        let i = y * w + x0;
        for (let x = x0; x < x1; x++, i++) {
          const s = fastScore(data, i, offs, threshold);
          if (s > minScore) scores[i] = s;
        }
      }
    }
  }

  // 3x3 non-maximum suppression, then keep the best per cell.
  for (let gy = 0; gy < gridRows; gy++) {
    const y0 = Math.max(border, Math.floor(gy * cellH));
    const y1 = Math.min(h - border, Math.floor((gy + 1) * cellH));
    for (let gx = 0; gx < gridCols; gx++) {
      const ci = gy * gridCols + gx;
      if (cellMask && !cellMask[ci]) continue;
      const x0 = Math.max(border, Math.floor(gx * cellW));
      const x1 = Math.min(w - border, Math.floor((gx + 1) * cellW));
      const list = cells[ci];
      for (let y = y0; y < y1; y++) {
        let i = y * w + x0;
        for (let x = x0; x < x1; x++, i++) {
          const s = scores[i];
          if (s === 0) continue;
          if (
            s < scores[i - 1] || s <= scores[i + 1] ||
            s < scores[i - w - 1] || s < scores[i - w] || s < scores[i - w + 1] ||
            s <= scores[i + w - 1] || s <= scores[i + w] || s <= scores[i + w + 1]
          ) continue;
          list.push({ x, y, score: s });
        }
      }
      if (list.length > perCell) {
        list.sort((a, b) => b.score - a.score);
        list.length = perCell;
      }
    }
  }
  const out = [];
  for (const list of cells) for (const p of list) out.push(p);
  return out;
}

/**
 * Shi-Tomasi minimum eigenvalue of the structure tensor around (x, y) over a
 * (2r+1)^2 window, normalised per pixel. Used to reject edge-like corners that
 * KLT cannot track well.
 */
export function minEigenScore(img, x, y, r = 3) {
  const { width: w, data } = img;
  let gxx = 0;
  let gyy = 0;
  let gxy = 0;
  for (let dy = -r; dy <= r; dy++) {
    let i = (y + dy) * w + (x - r);
    for (let dx = -r; dx <= r; dx++, i++) {
      const ix = (data[i + 1] - data[i - 1]) * 0.5;
      const iy = (data[i + w] - data[i - w]) * 0.5;
      gxx += ix * ix;
      gyy += iy * iy;
      gxy += ix * iy;
    }
  }
  const n = (2 * r + 1) * (2 * r + 1);
  gxx /= n; gyy /= n; gxy /= n;
  const tr = gxx + gyy;
  const det = gxx * gyy - gxy * gxy;
  return tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
}
