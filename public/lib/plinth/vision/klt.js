// Pyramidal Lucas-Kanade feature tracking (Bouguet), with mean-offset
// compensation so auto-exposure changes on phones do not break tracks.
//
// Frame-to-frame tracking is seeded with a predicted location (from the IMU
// rotation and the motion model), which is what lets tracking survive fast
// handheld rotations.
//
// Performance note: within one window the sub-pixel offset is constant, so the
// bilinear weights are computed once per iteration and the inner loops read
// raw pixel rows.

/**
 * Sample a (size x size) patch whose top-left sample is at (x0, y0) (real
 * coordinates) into out. Caller guarantees the patch (plus one pixel) is
 * inside the image.
 */
function samplePatch(img, x0, y0, size, out) {
  const w = img.width;
  const d = img.data;
  const ix = Math.floor(x0);
  const iy = Math.floor(y0);
  const fx = x0 - ix;
  const fy = y0 - iy;
  const w00 = (1 - fx) * (1 - fy);
  const w01 = fx * (1 - fy);
  const w10 = (1 - fx) * fy;
  const w11 = fx * fy;
  let k = 0;
  for (let r = 0; r < size; r++) {
    let i = (iy + r) * w + ix;
    for (let c = 0; c < size; c++, i++, k++) {
      out[k] = w00 * d[i] + w01 * d[i + 1] + w10 * d[i + w] + w11 * d[i + w + 1];
    }
  }
}

function trackOneWay(prevPyr, nextPyr, points, guesses, opts) {
  const {
    halfWindow = 5,
    maxIterations = 12,
    epsilon = 0.02,
    minEigen = 1e-3,
    maxError = 18,
  } = opts;
  const levels = Math.min(prevPyr.length, nextPyr.length);
  const n = points.length >> 1;
  const positions = new Float32Array(points.length);
  const status = new Uint8Array(n);
  const error = new Float32Array(n);
  const win = 2 * halfWindow + 1;
  const area = win * win;
  const big = win + 2; // template with a 1-pixel border for gradients
  const TB = new Float32Array(big * big);
  const T = new Float32Array(area);
  const GX = new Float32Array(area);
  const GY = new Float32Array(area);
  const JP = new Float32Array(area);
  const margin = halfWindow + 2;

  for (let p = 0; p < n; p++) {
    const px = points[p * 2];
    const py = points[p * 2 + 1];
    const gx0 = guesses ? guesses[p * 2] : px;
    const gy0 = guesses ? guesses[p * 2 + 1] : py;
    const topScale = 1 / (1 << (levels - 1));
    let dx = (gx0 - px) * topScale;
    let dy = (gy0 - py) * topScale;
    let ok = true;
    let residual = 0;

    for (let L = levels - 1; L >= 0; L--) {
      const I = prevPyr[L];
      const J = nextPyr[L];
      const s = 1 / (1 << L);
      const cx = px * s;
      const cy = py * s;
      if (cx < margin || cy < margin || cx > I.width - margin - 1 || cy > I.height - margin - 1) {
        // Too close to the border at this scale: skip coarse levels, fail at level 0.
        if (L === 0) { ok = false; break; }
        dx *= 2;
        dy *= 2;
        continue;
      }
      samplePatch(I, cx - halfWindow - 1, cy - halfWindow - 1, big, TB);
      let gxx = 0;
      let gyy = 0;
      let gxy = 0;
      let tMean = 0;
      let sGX = 0;
      let sGY = 0;
      let k = 0;
      for (let r = 1; r <= win; r++) {
        let b = r * big + 1;
        for (let c = 1; c <= win; c++, b++, k++) {
          const ix = (TB[b + 1] - TB[b - 1]) * 0.5;
          const iy = (TB[b + big] - TB[b - big]) * 0.5;
          const v = TB[b];
          T[k] = v;
          GX[k] = ix;
          GY[k] = iy;
          tMean += v;
          gxx += ix * ix;
          gyy += iy * iy;
          gxy += ix * iy;
          sGX += ix;
          sGY += iy;
        }
      }
      tMean /= area;
      const det = gxx * gyy - gxy * gxy;
      const tr = gxx + gyy;
      const lambdaMin = (tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det))) / area;
      if (lambdaMin < minEigen || Math.abs(det) < 1e-9) {
        if (L === 0) { ok = false; break; }
        dx *= 2;
        dy *= 2;
        continue;
      }
      const invDet = 1 / det;

      for (let it = 0; it < maxIterations; it++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < margin || ny < margin || nx > J.width - margin - 1 || ny > J.height - margin - 1) {
          if (L === 0) ok = false;
          break;
        }
        samplePatch(J, nx - halfWindow, ny - halfWindow, win, JP);
        // sum(((T - tMean) - (J - jMean)) * G) = sum((T - J) * G) + (jMean - tMean) * sum(G)
        let bx = 0;
        let by = 0;
        let jSum = 0;
        for (k = 0; k < area; k++) {
          const jv = JP[k];
          const diff = T[k] - jv;
          bx += diff * GX[k];
          by += diff * GY[k];
          jSum += jv;
        }
        const off = jSum / area - tMean;
        bx += off * sGX;
        by += off * sGY;
        const ex = (gyy * bx - gxy * by) * invDet;
        const ey = (gxx * by - gxy * bx) * invDet;
        dx += ex;
        dy += ey;
        if (ex * ex + ey * ey < epsilon * epsilon) break;
      }
      if (!ok) break;
      if (L > 0) {
        dx *= 2;
        dy *= 2;
      } else {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < margin || ny < margin || nx > J.width - margin - 1 || ny > J.height - margin - 1) {
          ok = false;
          break;
        }
        samplePatch(J, nx - halfWindow, ny - halfWindow, win, JP);
        let jSum = 0;
        for (k = 0; k < area; k++) jSum += JP[k];
        const off = jSum / area - tMean;
        let sum = 0;
        for (k = 0; k < area; k++) sum += Math.abs(T[k] - (JP[k] - off));
        residual = sum / area;
      }
    }

    positions[p * 2] = px + dx;
    positions[p * 2 + 1] = py + dy;
    error[p] = residual;
    status[p] = ok && residual <= maxError ? 1 : 0;
  }
  return { positions, status, error };
}

/**
 * Track points from prevPyr to nextPyr.
 *   points: Float32Array [x0, y0, x1, y1, ...] in level-0 pixels of prev
 *   guesses: Float32Array of predicted positions in next (same layout), or null
 * Returns {positions: Float32Array, status: Uint8Array, error: Float32Array}.
 * status 1 = tracked. error = mean absolute (mean-compensated) intensity residual.
 * opts.fbThreshold: if > 0, also track back and require the round trip to land
 * within this many pixels of the start (forward-backward check).
 */
export function trackKLT(prevPyr, nextPyr, points, guesses, opts = {}) {
  const fwd = trackOneWay(prevPyr, nextPyr, points, guesses, opts);
  const fb = opts.fbThreshold || 0;
  if (fb > 0) {
    const back = trackOneWay(nextPyr, prevPyr, fwd.positions, points, opts);
    const n = points.length >> 1;
    for (let i = 0; i < n; i++) {
      if (!fwd.status[i]) continue;
      const ex = back.positions[i * 2] - points[i * 2];
      const ey = back.positions[i * 2 + 1] - points[i * 2 + 1];
      if (!back.status[i] || ex * ex + ey * ey > fb * fb) fwd.status[i] = 0;
    }
  }
  return fwd;
}
