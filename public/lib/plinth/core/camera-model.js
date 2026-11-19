// Pinhole camera intrinsics and the transforms between capture, processing
// and display resolutions.
//
// Pixel convention: pixel (i, j) has its centre at (u, v) = (i, j); u grows
// right, v grows down. The principal point of a centred W x H image is
// ((W - 1) / 2, (H - 1) / 2). This matches the convention used by 8th Wall's
// engine (e.g. 239.5, 319.5 for a 480 x 640 image).

export class Intrinsics {
  constructor({ width, height, fx, fy, cx, cy }) {
    this.width = width;
    this.height = height;
    this.fx = fx;
    this.fy = fy;
    this.cx = cx;
    this.cy = cy;
  }

  static fromFocal(width, height, f) {
    return new Intrinsics({ width, height, fx: f, fy: f, cx: (width - 1) / 2, cy: (height - 1) / 2 });
  }

  /** Build from a field of view (degrees) measured across the image's longer side. */
  static fromLongSideFov(width, height, fovDeg) {
    const long = Math.max(width, height);
    const f = (0.5 * long) / Math.tan((fovDeg * Math.PI) / 360);
    return Intrinsics.fromFocal(width, height, f);
  }

  clone() {
    return new Intrinsics(this);
  }

  /** Swap axes for a 90° rotated frame (portrait <-> landscape). */
  transposed() {
    return new Intrinsics({
      width: this.height, height: this.width,
      fx: this.fy, fy: this.fx, cx: this.cy, cy: this.cx,
    });
  }

  /**
   * Intrinsics of this camera after the image is uniformly scaled to cover a
   * width x height viewport and centre-cropped ("object-fit: cover"). This is
   * how a 4:3 sensor calibration maps onto a 16:9 capture, how a capture maps
   * onto a smaller processing image, and how the camera feed maps onto the
   * screen.
   */
  cropAndScale(width, height) {
    const s = Math.max(width / this.width, height / this.height);
    return new Intrinsics({
      width,
      height,
      fx: this.fx * s,
      fy: this.fy * s,
      cx: (width - 1) / 2 + (this.cx - (this.width - 1) / 2) * s,
      cy: (height - 1) / 2 + (this.cy - (this.height - 1) / 2) * s,
    });
  }

  /** Project a camera-frame point (three.js convention, looking down -Z). */
  project(p, out = [0, 0]) {
    const z = -p[2];
    if (z <= 1e-9) return null;
    out[0] = this.cx + (this.fx * p[0]) / z;
    out[1] = this.cy - (this.fy * p[1]) / z;
    return out;
  }

  /** Ray direction (not normalised, z = -1) through pixel (u, v), in the camera frame. */
  unproject(u, v) {
    return [(u - this.cx) / this.fx, -(v - this.cy) / this.fy, -1];
  }

  /** Vertical / horizontal field of view in degrees. */
  get fovY() {
    return (2 * Math.atan(this.height / (2 * this.fy)) * 180) / Math.PI;
  }

  get fovX() {
    return (2 * Math.atan(this.width / (2 * this.fx)) * 180) / Math.PI;
  }

  /**
   * OpenGL projection matrix (column-major, three.js `Matrix4.elements` layout)
   * that reproduces these pixel intrinsics exactly for a viewport of the same
   * size as the intrinsics' image.
   */
  projectionMatrix(near = 0.01, far = 1000, out = new Float32Array(16)) {
    const w = this.width;
    const h = this.height;
    out.fill(0);
    out[0] = (2 * this.fx) / w;
    out[5] = (2 * this.fy) / h;
    out[8] = 1 - (2 * (this.cx + 0.5)) / w;
    out[9] = (2 * (this.cy + 0.5)) / h - 1;
    out[10] = -(far + near) / (far - near);
    out[11] = -1;
    out[14] = (-2 * far * near) / (far - near);
    return out;
  }
}

/**
 * Compute the UV transform that draws a camera texture of size (tw, th) so it
 * covers a (vw, vh) viewport, matching Intrinsics.cropAndScale(vw, vh).
 * Returns {scaleX, scaleY, offsetX, offsetY}: uv_tex = uv_view * scale + offset.
 */
export function coverUvTransform(tw, th, vw, vh) {
  const s = Math.max(vw / tw, vh / th);
  const scaleX = vw / (tw * s);
  const scaleY = vh / (th * s);
  return { scaleX, scaleY, offsetX: (1 - scaleX) / 2, offsetY: (1 - scaleY) / 2 };
}
