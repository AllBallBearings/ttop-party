// Tracking worker: runs the Tracker off the main thread.
// Also importable on the main thread (createInlineTracker) as a fallback.

import { Tracker } from '../vision/tracker.js';
import { GrayImage } from '../vision/image.js';

export function createTrackerHost(post) {
  let tracker = null;
  // The tracker keeps the previous frame's image for optical flow, while the
  // incoming buffer is handed back to the main thread for reuse. Copy each
  // frame into host-owned storage, alternating two buffers so the previous
  // frame stays intact.
  const owned = [null, null];
  let flip = 0;
  const ownCopy = (buffer) => {
    const src = new Uint8Array(buffer);
    flip ^= 1;
    if (!owned[flip] || owned[flip].length !== src.length) owned[flip] = new Uint8Array(src.length);
    owned[flip].set(src);
    return owned[flip];
  };
  return function handle(msg) {
    switch (msg.type) {
      case 'init':
        tracker = new Tracker(msg.intrinsics, msg.config || {});
        if (msg.continuePose) tracker.reset(msg.continuePose);
        break;
      case 'frame': {
        if (!tracker) return;
        const image = new GrayImage(msg.width, msg.height, ownCopy(msg.buffer));
        const result = tracker.process({ id: msg.id, time: msg.time, image, imuQ: msg.imuQ });
        if (msg.wantPoints) result.points = tracker.exportPoints();
        result.yawOffset = tracker.yawOffset;
        const transfer = [msg.buffer];
        if (result.points) transfer.push(result.points.buffer);
        post({ type: 'result', result, buffer: msg.buffer }, transfer);
        break;
      }
      case 'reset':
        if (tracker) tracker.reset(msg.continuePose || null);
        break;
      case 'rescale':
        if (tracker) tracker.rescale(msg.scale, msg.center);
        post({ type: 'rescaled', scale: msg.scale, center: msg.center });
        break;
      case 'transform':
        if (tracker) tracker.transformMap(msg.yaw, msg.translation);
        break;
      case 'lost':
        if (tracker && tracker.initialized) tracker._declareLost();
        break;
      case 'configure':
        if (tracker) Object.assign(tracker.cfg, msg.config);
        break;
      default:
        break;
    }
  };
}

// Running as a worker?
if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof self.postMessage === 'function') {
  const handle = createTrackerHost((m, t) => self.postMessage(m, t));
  self.onmessage = (e) => handle(e.data);
}
