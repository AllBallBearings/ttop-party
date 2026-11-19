// GPU stage of the camera pipeline.
//
// Like 8th Wall's engine (GlRealityFrame + deferred reads, "runs the entire
// pipeline on each frame but lags ... behind. This allows us to have deferred
// reads of the camera frame from the gpu to the cpu"), each camera frame is:
//   1. uploaded into a texture ring slot (kept so the *same* frame can be drawn
//      as the AR background once its pose is known — frame-synchronised
//      rendering, which is why content looks glued to the scene);
//   2. downsampled + converted to grayscale by a shader that packs 4 gray
//      pixels into each RGBA texel, so the read-back is exactly W*H bytes;
//   3. read back asynchronously with a pixel-pack buffer + fence (WebGL2), so
//      the CPU never stalls on the GPU; WebGL1 falls back to a sync read.

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Output pixel (x, y) of a (procW/4 x procH) target holds processing pixels
// (4x .. 4x+3, y). Rows are not flipped, so readPixels returns the image
// top-to-bottom. Each gray pixel averages 4 bilinear taps (approximate box
// filter over its footprint in the capture image).
const FRAG_GRAY = `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uProcSize;
uniform vec2 uCapSize;
uniform float uInvScale;
float gray(vec2 p) {
  // p: processing pixel centre in continuous coords ([i, i+1] spans pixel i)
  vec2 c = (p - 0.5 * uProcSize) * uInvScale + 0.5 * uCapSize;
  vec2 o = vec2(0.25 * uInvScale);
  vec3 w = vec3(0.299, 0.587, 0.114);
  vec3 s = texture2D(uTex, (c + vec2(-o.x, -o.y)) / uCapSize).rgb
         + texture2D(uTex, (c + vec2( o.x, -o.y)) / uCapSize).rgb
         + texture2D(uTex, (c + vec2(-o.x,  o.y)) / uCapSize).rgb
         + texture2D(uTex, (c + vec2( o.x,  o.y)) / uCapSize).rgb;
  return dot(s * 0.25, w);
}
void main() {
  float x0 = (gl_FragCoord.x - 0.5) * 4.0;
  float y = gl_FragCoord.y;
  gl_FragColor = vec4(
    gray(vec2(x0 + 0.5, y)), gray(vec2(x0 + 1.5, y)),
    gray(vec2(x0 + 2.5, y)), gray(vec2(x0 + 3.5, y)));
}
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`[plinth] shader compile failed: ${log}`);
  }
  return sh;
}

export function createProgram(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`[plinth] program link failed: ${gl.getProgramInfoLog(p)}`);
  }
  return p;
}

function makeTexture(gl, w, h, data = null) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (w && h) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return tex;
}

export class GpuFrameProcessor {
  constructor(gl, { ringSize = 4, asyncReadback = true } = {}) {
    this.gl = gl;
    this.isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    this.asyncReadback = asyncReadback && this.isWebGL2 && typeof gl.fenceSync === 'function';
    this.ring = Array.from({ length: ringSize }, () => ({ tex: makeTexture(gl, 0, 0), busy: false, width: 0, height: 0 }));
    this.program = createProgram(gl, VERT, FRAG_GRAY);
    this.loc = {
      uTex: gl.getUniformLocation(this.program, 'uTex'),
      uProcSize: gl.getUniformLocation(this.program, 'uProcSize'),
      uCapSize: gl.getUniformLocation(this.program, 'uCapSize'),
      uInvScale: gl.getUniformLocation(this.program, 'uInvScale'),
    };
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.fbo = null;
    this.fboTex = null;
    this.procW = 0;
    this.procH = 0;
    this.pending = []; // in-flight async readbacks
    this.pboPool = [];
  }

  /** Configure the processing resolution (width must be a multiple of 4). */
  configure(procW, procH) {
    if (procW % 4 !== 0) throw new Error('[plinth] processing width must be a multiple of 4');
    if (procW === this.procW && procH === this.procH) return;
    const gl = this.gl;
    this.procW = procW;
    this.procH = procH;
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.fboTex) gl.deleteTexture(this.fboTex);
    this.fboTex = makeTexture(gl, procW / 4, procH);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (const p of this.pboPool) gl.deleteBuffer(p);
    this.pboPool = [];
  }

  /** Returns a free ring slot index or -1. */
  acquireSlot(exclude = new Set()) {
    for (let i = 0; i < this.ring.length; i++) {
      if (!this.ring[i].busy && !exclude.has(i)) return i;
    }
    return -1;
  }

  releaseSlot(i) {
    if (i >= 0 && this.ring[i]) this.ring[i].busy = false;
  }

  texture(i) {
    return this.ring[i]?.tex || null;
  }

  /** Upload a camera frame (video element, canvas, ImageBitmap...) into slot i. */
  upload(i, source, width, height) {
    const gl = this.gl;
    const slot = this.ring[i];
    gl.bindTexture(gl.TEXTURE_2D, slot.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (gl.UNPACK_COLORSPACE_CONVERSION_WEBGL) gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    slot.width = width;
    slot.height = height;
    slot.busy = true;
  }

  /**
   * Render the grayscale processing image of slot i and start reading it back.
   * `tag` is returned with the data. In sync mode the data is available from
   * the next poll() immediately.
   */
  process(i, tag) {
    const gl = this.gl;
    const slot = this.ring[i];
    const capW = slot.width;
    const capH = slot.height;
    const scale = Math.max(this.procW / capW, this.procH / capH);
    // Never touch a renderer's vertex array object (three.js uses VAOs on WebGL2).
    if (this.isWebGL2) gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.procW / 4, this.procH);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, slot.tex);
    gl.uniform1i(this.loc.uTex, 0);
    gl.uniform2f(this.loc.uProcSize, this.procW, this.procH);
    gl.uniform2f(this.loc.uCapSize, capW, capH);
    gl.uniform1f(this.loc.uInvScale, 1 / scale);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const bytes = this.procW * this.procH;
    if (this.asyncReadback) {
      const pbo = this.pboPool.pop() || gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
      gl.readPixels(0, 0, this.procW / 4, this.procH, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      this.pending.push({ pbo, sync, tag, bytes, width: this.procW, height: this.procH, issued: performance.now() });
    } else {
      const data = new Uint8Array(bytes);
      gl.readPixels(0, 0, this.procW / 4, this.procH, gl.RGBA, gl.UNSIGNED_BYTE, data);
      this.pending.push({ data, tag, width: this.procW, height: this.procH });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Collect finished read-backs: [{tag, data: Uint8Array, width, height}]. */
  poll(dstPool = []) {
    const gl = this.gl;
    const done = [];
    while (this.pending.length) {
      const p = this.pending[0];
      if (p.data) {
        done.push({ tag: p.tag, data: p.data, width: p.width, height: p.height });
        this.pending.shift();
        continue;
      }
      const status = gl.clientWaitSync(p.sync, 0, 0);
      // Do not wait forever on drivers that never signal: force after 100 ms.
      if (status === gl.TIMEOUT_EXPIRED && performance.now() - p.issued < 100) break;
      const data = dstPool.find((b) => b.byteLength === p.bytes) || new Uint8Array(p.bytes);
      const idx = dstPool.indexOf(data);
      if (idx >= 0) dstPool.splice(idx, 1);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, p.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, data);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteSync(p.sync);
      this.pboPool.push(p.pbo);
      done.push({ tag: p.tag, data, width: p.width, height: p.height });
      this.pending.shift();
    }
    return done;
  }

  dispose() {
    const gl = this.gl;
    for (const s of this.ring) gl.deleteTexture(s.tex);
    for (const p of this.pending) {
      if (p.sync) gl.deleteSync(p.sync);
      if (p.pbo) gl.deleteBuffer(p.pbo);
    }
    for (const p of this.pboPool) gl.deleteBuffer(p);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.fboTex) gl.deleteTexture(this.fboTex);
    gl.deleteProgram(this.program);
    gl.deleteBuffer(this.quad);
  }
}
