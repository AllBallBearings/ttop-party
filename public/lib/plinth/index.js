// Plinth — stable web AR for mobile browsers.
//
// Core (framework-agnostic):
export { PlinthEngine, HitTestType, detectHorizontalPlanes } from './core/engine.js';
export { Intrinsics, coverUvTransform } from './core/camera-model.js';
export { captureIntrinsics, detectDevice, referenceFocal } from './core/device-calibration.js';
export { ImuSource, deviceOrientationToQuat } from './core/imu.js';
export { CameraSource, ManualSource } from './core/camera-source.js';
export { GpuFrameProcessor } from './core/gpu.js';
export { Tracker, TrackingStatus, TrackingReason, DEFAULT_TRACKER_CONFIG } from './vision/tracker.js';
export { MarkerAnchor, createJsQrDetector } from './marker/marker-anchor.js';
export * as math from './core/math.js';
// three.js integration lives in './three/index.js' (import 'plinth-ar/three').
