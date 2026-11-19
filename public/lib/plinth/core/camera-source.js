// Camera capture via getUserMedia.
//
// 8th Wall requests 4:3 resolutions (e.g. 960x720 on iOS) rather than 16:9:
// a 16:9 stream is a crop of the 4:3 sensor that throws away field of view
// (fewer trackable features), and device calibrations are full-sensor 4:3.
// Plinth does the same and lets the display crop ("cover") the feed instead.
//
// New frames are detected with requestVideoFrameCallback when available
// (which also provides capture timestamps), else by watching currentTime.

const RESOLUTIONS = {
  low: { width: 640, height: 480 },
  medium: { width: 960, height: 720 },
  high: { width: 1280, height: 960 },
  max: { width: 1920, height: 1440 },
};

export class CameraSource {
  constructor({ facingMode = 'environment', resolution = 'medium', latencyMs = 33, video = null } = {}) {
    this.facingMode = facingMode;
    this.resolution = RESOLUTIONS[resolution] || resolution;
    this.latencyMs = latencyMs;
    this.stream = null;
    this.video = video || CameraSource.createVideoElement();
    this.frameId = 0;
    this.lastTime = -1;
    this.pendingMeta = null;
    this.running = false;
    this.useRvfc = typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  }

  static createVideoElement() {
    const v = document.createElement('video');
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    v.setAttribute('autoplay', '');
    v.muted = true;
    v.playsInline = true;
    // Keep it in the DOM but invisible: iOS will not decode frames for
    // detached or display:none videos reliably.
    Object.assign(v.style, {
      position: 'fixed', left: '0', top: '0', width: '2px', height: '2px',
      opacity: '0', pointerEvents: 'none', zIndex: '-1',
    });
    return v;
  }

  static isSupported() {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  async start() {
    if (!CameraSource.isSupported()) {
      throw new Error('Camera API unavailable (a secure https:// context is required).');
    }
    const { width, height } = this.resolution;
    const attempts = [
      { facingMode: { ideal: this.facingMode }, width: { ideal: width }, height: { ideal: height }, aspectRatio: { ideal: 4 / 3 }, frameRate: { ideal: 30 } },
      { facingMode: { ideal: this.facingMode }, width: { ideal: width }, height: { ideal: height } },
      { facingMode: { ideal: this.facingMode } },
      true,
    ];
    let lastErr = null;
    for (const video of attempts) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        break;
      } catch (err) {
        lastErr = err;
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) throw err;
      }
    }
    if (!this.stream) throw lastErr || new Error('getUserMedia failed');
    if (!this.video.isConnected && typeof document !== 'undefined') document.body.appendChild(this.video);
    this.video.srcObject = this.stream;
    await this.video.play();
    await this._waitForDimensions();
    this.running = true;
    this._armRvfc();
    return { width: this.video.videoWidth, height: this.video.videoHeight };
  }

  _waitForDimensions() {
    return new Promise((resolve) => {
      const check = () => {
        if (this.video.videoWidth > 0 && this.video.videoHeight > 0) resolve();
        else setTimeout(check, 30);
      };
      check();
    });
  }

  _armRvfc() {
    if (!this.useRvfc || !this.running) return;
    this.video.requestVideoFrameCallback((now, meta) => {
      this.pendingMeta = { now, ...meta };
      this._armRvfc();
    });
  }

  stop() {
    this.running = false;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
  }

  get width() {
    return this.video.videoWidth;
  }

  get height() {
    return this.video.videoHeight;
  }

  /**
   * Returns a descriptor for a new camera frame since the last call, or null.
   * time is the estimated capture time on the performance.now() clock (ms).
   */
  poll() {
    const v = this.video;
    if (!this.running || v.readyState < 2 || v.videoWidth === 0) return null;
    let time;
    if (this.useRvfc) {
      const m = this.pendingMeta;
      if (!m) return null;
      this.pendingMeta = null;
      time = m.captureTime ?? ((m.presentationTime ?? m.now) - this.latencyMs);
    } else {
      if (v.currentTime === this.lastTime) return null;
      this.lastTime = v.currentTime;
      time = performance.now() - this.latencyMs;
    }
    return { id: ++this.frameId, source: v, width: v.videoWidth, height: v.videoHeight, time };
  }
}

/**
 * A frame source driven by a canvas (or anything texImage2D accepts) plus an
 * optional orientation per frame: used for tests, replays and synthetic scenes.
 * Call push() with each new frame.
 */
export class ManualSource {
  constructor() {
    this.queue = [];
    this.frameId = 0;
    this.running = false;
    this.width = 0;
    this.height = 0;
  }

  async start() {
    this.running = true;
    return { width: this.width, height: this.height };
  }

  stop() {
    this.running = false;
  }

  push(source, width, height, timeMs = performance.now(), imuQ = null) {
    this.width = width;
    this.height = height;
    this.queue.push({ id: ++this.frameId, source, width, height, time: timeMs, imuQ });
  }

  poll() {
    return this.running ? this.queue.shift() || null : null;
  }
}
