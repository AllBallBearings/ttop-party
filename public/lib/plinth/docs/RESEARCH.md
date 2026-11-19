# How 8th Wall made web AR feel solid: research notes

These notes record what was learned about 8th Wall's engine and how Plinth
reproduces each piece.

## Sources

* **8th Wall's open-sourced framework**, [github.com/8thwall/8thwall](https://github.com/8thwall/8thwall)
  (MIT, published when the hosted platform shut down on Feb 28, 2026). The
  SLAM core stayed closed and ships only as a binary, but the open repo contains
  the camera pipeline, the JS↔WASM glue, the GPU feature shaders, geometry
  solvers, device calibrations and XRExtras. File paths below refer to that repo.
* The archived examples repo, [github.com/8thwall/web](https://github.com/8thwall/web).
* Niantic's announcement of the open-source release and engineering posts
  ("How we engineered AR for the mobile browser", "Building the next generation
  of SLAM for the browser"). These describe a 6-DoF markerless pipeline with
  "feature point extraction, sensor fusion, robust estimation, triangulation,
  mapping, bundle adjustment and relocalization" built on MediaDevices, Sensor
  APIs, WebGL and WebAssembly.

## Findings

### 1. Rendering is synchronized to tracking, not to the live video

`reality/app/xr/js/tracking-controller.cc`, `processPipeline()`:

> Runs the entire pipeline on each frame but lags 2 frames behind. This allows
> us to have deferred reads of the camera frame from the gpu to the cpu.

`tracking-controller.ts` `onProcessCpu` returns
`realityTexture: XR8.drawTexForComputeTex(window._c8.realityTexture)` together
with the pose, and `threejs-renderer.ts` draws that texture before the scene
(`renderer.autoClear = false`). The camera image you see is the exact frame the
pose belongs to, so virtual content can't "swim" against the video. The
`<video>` element is shrunk to 2×2 px and only decodes.

**Plinth:** `core/gpu.js` texture ring and `core/engine.js` `syncMode: 'frame'`.
The previous version of this app laid a transparent canvas over a `<video>`,
which is exactly the lag this design avoids.

### 2. GPU preprocessing, deferred read-back

`reality/engine/features/gl-reality-frame.cc`, `gr8-*.frag`: grayscale conversion,
a 4-level pyramid with 1.44× steps at 480×640 (360×640 for 16:9), packed into one
texture. A FAST-9 score (`gr8-stage2.frag`, max over 9-pixel arcs of the
16-pixel circle), 7×7 NMS and a Gaussian blur are computed in shaders, then
read back. The CPU keeps the best corners per grid bin.

**Plinth:** a shader downsamples and converts to gray, packing 4 pixels per
RGBA texel, with an asynchronous PBO + fence read-back. FAST runs in the worker,
only in grid cells that need points.

### 3. Raw IMU fused with vision

`reality/app/xr/js/src/sensors.ts` queues raw `devicemotion` events (gyro,
accelerometer with and without gravity) with arrival *and* event timestamps,
and hands them to the engine per frame. The orientation quaternion goes along
with each staged frame. `reality/engine/tracking/tracking-sensor-event.cc`
documents platform quirks:

* iOS reports `DeviceMotionEvent.interval` in seconds, not milliseconds.
* Android quantizes the 60 Hz interval to 16 ms.
* iOS flips the sign of acceleration relative to Android.

**Plinth:** `core/imu.js` keeps a timestamped orientation history and pairs
each frame with the orientation at its capture time (rVFC `captureTime`), plus
an online time-offset estimator. The IMU gives the rotation prediction for
optical flow, the relative-rotation and gravity priors, and the 3-DoF fallback
while lost.

### 4. Instant placement through an assumed camera height

`tracking-controller.ts`: the default origin is `{x: 0, y: 2, z: 0}`, and for
"responsive" scale `scale_ = origin_.y`. The ground plane is `y = 0`, and the
camera's height above it *defines* the unit. That's why 8th Wall content can be
placed on the first frame without a scanning motion.
`resetOriginToLastPose()` restarts a map while keeping the camera pose, so
content doesn't jump.

**Plinth:** `cameraHeight`, ground-plane initialization in `vision/tracker.js`,
and `resetTracking({continuePose})`.

### 5. Gravity-aware features and solvers

`reality/engine/tracking/tracker.cc`:

> ORB features for lowest 45 degrees of rays to track the ground plane stably

Elsewhere 8th Wall uses "GORB": the descriptor orientation comes from gravity
projected at the keypoint (`gr8gl.cc`) rather than from the intensity centroid.
`geometry/p2p.cc` solves camera pose from **two** points when gravity is known.
`pose-pnp.h` has a constraint that keeps RANSAC from "proposing camera positions
underneath the ground".

**Plinth:** a gravity-aware 4-DoF absolute pose (linear in `cos ψ, sin ψ, t`) for
relocalization, RANSAC over translation given the IMU rotation, and a gravity
tilt prior. It goes one step further with *ground-rectified* descriptors: BRIEF
sampled on a world-aligned top-down patch through the plane homography. This
cut true-match distances from about 72 to 24 bits after walking 60° around a
table.

### 6. Local descriptor matching with tuned thresholds

`features/local-matcher.h`: search radius 0.1 in normalized ray space, Hamming
≤ 64/256, ratio test 0.78. Matches are searched around predicted positions.

**Plinth:** frame-to-frame tracking uses KLT, which is sub-pixel and cheaper in
JS. Descriptors are used where 8th Wall uses them: re-acquiring mapped points
at keyframes (local search) and relocalizing (global search). The
`descriptorMaxDistance`, `rectifiedMaxDistance` and `ratioTest` defaults are in
the same range.

### 7. Device calibration and 4:3 capture

`c8/geometry/intrinsics.cc` holds per-device focal lengths for a 480×640 portrait
reference (default iPhone X, 506.4 px), mapped to any resolution with
`cropAndScale` (scale to cover, center crop). iPhones are identified by
`screen.height × devicePixelRatio` plus the GPU string (`devices/override.ts`).
`constraints-helper.ts` requests 4:3 streams (960×720 on iOS) because 16:9 crops
the sensor.

**Plinth:** `core/device-calibration.js` adapts the table (MIT, attributed), and
`core/camera-source.js` requests 4:3.

### 8. Hit tests, light estimation, interaction

* Hit-test types `FEATURE_POINT`, `ESTIMATED_SURFACE`, `DETECTED_SURFACE` with
  normalized screen coordinates (`tracking-controller.ts`). Plinth implements
  all three. Detected surfaces come from peaks in the height histogram of
  trusted map points.
* Exposure estimate: fraction of near-white pixels minus fraction of near-black
  pixels (`c8/pixels/pixel-transforms.cc`). Plinth computes the same, plus mean
  luminance, and scales scene lights with it.
* XRExtras `gestures-components.ts`: a gesture detector normalized by screen
  size, hold-drag (300 ms delay, rise while dragging, 300 ms ease-out drop),
  pinch-scale clamped to [0.33, 3], two-finger rotate. Plinth's
  `ObjectManipulator` follows these and adds grab-offset dragging and true
  twist rotation.

## What could not be verified

The SLAM core (bundle adjustment schedule, map management, the exact VIO
filter) is closed and was not reverse-engineered. Plinth's tracker is an
independent design that reproduces the observable behavior: instant placement,
stability, re-acquisition and relocalization. The engineering blog posts and
the 8th Wall patent (US 11,494,987 B2) couldn't be fetched from this
environment, so the claims above rest on the open-source code.
