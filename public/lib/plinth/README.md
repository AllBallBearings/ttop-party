# Plinth — stable web AR for mobile browsers

Plinth places 3D content on real tables and floors from a plain mobile web page
and keeps it there: you can walk all the way around the table, cover the camera,
and look away, and the content stays where you put it. It's a clean-room
JavaScript reimplementation of the techniques behind 8th Wall's web AR engine.
See [docs/RESEARCH.md](docs/RESEARCH.md) for what was learned from 8th Wall's
open-sourced code and how each piece maps to Plinth.

No build step, no WebAssembly, no native app. It needs `three` (r150+) only for
the three.js adapter.

## What you get

| Capability | How |
| --- | --- |
| **Instant placement**, no scanning | Gravity from the IMU + an assumed camera height define the ground plane on the first frame (8th Wall's "responsive scale") |
| **Content glued to the scene** | The camera feed is drawn in WebGL from the *same frame* the pose was computed on (frame-synchronized rendering) |
| **6-DoF visual-inertial tracking** | FAST corners, pyramidal Lucas-Kanade seeded by the gyro, robust pose with gyro and gravity priors, in a Web Worker |
| **Walk around the table** | Mapped points are re-acquired with ground-rectified descriptors, so the map stays anchored instead of drifting |
| **Recovery after loss** | Gravity-aware 4-DoF relocalization. While lost, an IMU-only 3-DoF fallback keeps content roughly in place |
| **Hit tests** | `ESTIMATED_SURFACE` (ground plane), `DETECTED_SURFACE` (horizontal planes found in the map), `FEATURE_POINT` |
| **Shared, metric anchors** | `MarkerAnchor`: a printed QR code (or any detector you plug in) gives every phone the same world anchor and the true scale |
| **Interaction** | Tap-to-place reticle, hold-to-drag with lift, pinch-to-scale, two-finger twist rotation |
| **Realism** | Shadow catcher, light estimation from camera exposure, per-device camera calibration |

## Quick start (three.js)

```html
<script type="importmap">
  { "imports": { "three": "/path/to/three.module.js" } }
</script>
<canvas id="ar"></canvas>
<button id="start">Start AR</button>
<script type="module">
  import * as THREE from 'three';
  import { PlinthThree, createShadowCatcher, createDefaultLighting } from './lib/plinth/three/index.js';
  import { PlacementReticle, ObjectManipulator } from './lib/plinth/three/gestures.js';

  const ar = new PlinthThree({ canvas: document.getElementById('ar'), cameraHeight: 0.45 });
  const lights = createDefaultLighting();
  ar.scene.add(lights.group);

  new PlacementReticle(ar, {
    onPlace: ({ position, quaternion }) => {
      const anchor = ar.createAnchor(position.toArray(), quaternion.toArray());
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: 'tomato' }));
      cube.position.y = 0.025;
      cube.castShadow = true;
      anchor.add(cube, createShadowCatcher(0.3));
      new ObjectManipulator(ar, cube); // hold to drag, pinch, twist
    },
  });

  document.getElementById('start').onclick = async () => {
    await ar.requestMotionPermission(); // iOS requires a user gesture
    await ar.start();                   // camera + sensors + tracking
  };
  ar.run((dt) => lights.update(ar.lightScale));
</script>
```

The page must be served over HTTPS (or `localhost`) for camera access.
[`examples/place.html`](examples/place.html) is a complete demo. In this project
it's served at `/lib/plinth/examples/place.html`.

### Units and scale

With no marker, world units are meters **if** `cameraHeight` (the assumed height
of the phone above the surface you start on) is right: about 0.45 for a table,
about 1.3 for the floor. A wrong guess only scales everything uniformly; tracking
quality doesn't depend on it. Add a `MarkerAnchor` with the printed size and the
world becomes truly metric.

## Using it in another project

Plinth is self-contained: copy the `plinth/` folder and either

* **no bundler**: add an import map for `three` (as above) and import the files, or
* **bundler** (Vite, webpack, …): it's plain ESM with a `package.json`
  (`"name": "plinth-ar"`, exports `.` and `./three`). Point a dependency at the
  folder (`"plinth-ar": "file:./lib/plinth"`) and `import { PlinthThree } from 'plinth-ar/three'`.

The core (`index.js`, `core/`, `vision/`, `marker/`) has no three.js dependency.
Use `PlinthEngine` directly to drive Babylon.js, PlayCanvas or raw WebGL: each
frame gives you a camera pose, intrinsics, and the camera texture to draw.

## API

### `PlinthThree(options)`

| option | default | |
| --- | --- | --- |
| `canvas` / `renderer` | – | canvas to render into, or an existing `THREE.WebGLRenderer` |
| `scene`, `camera` | new | your `THREE.Scene` / `THREE.PerspectiveCamera` (projection is overwritten each frame) |
| `cameraHeight` | `1.0` | assumed starting height above the ground plane (sets the scale) |
| `processingLongSide` | `480` | tracking resolution (long side, px) |
| `capture` | `{}` | `{ facingMode, resolution: 'low'\|'medium'\|'high'\|'max', video }` |
| `syncMode` | `'frame'` | `'frame'`: display the tracked frame (most stable). `'latest'`: newest frame + IMU-rotated pose (lowest latency) |
| `tracker` | `{}` | overrides for `DEFAULT_TRACKER_CONFIG` |
| `useWorker` | `true` | run tracking in a module worker (falls back to the main thread) |
| `shadows`, `lightEstimation` | `true` | |
| `source`, `imu`, `intrinsics`, `focal480` | – | custom frame source (`ManualSource`), IMU, or calibration |

Methods: `start()`, `stop()`, `requestMotionPermission()`, `update(now)` (call per
animation frame) or `run(onFrame)`, `createAnchor(position, rotation)` →
`THREE.Group`, `removeAnchor(obj)`, `objectForAnchor(engineAnchor)`,
`hitTest(clientX, clientY, types?)`, `raycasterAt(clientX, clientY)`,
`addTicker(fn)`, `setShowFeaturePoints(bool)`, `resize()`.
Properties: `engine`, `scene`, `camera`, `renderer`, `lightScale`.

### `PlinthEngine` (framework-agnostic core)

* Events (`engine.on(name, fn)`): `trackingstatus` `{status, reason}`,
  `camerastatuschange`, `cameraframe`, `result`, `update`, `markerfound`,
  `markerupdated`, `markerlost`, `worldtransform`, `recenter`, `trackingreset`.
  `status` is `NORMAL | LIMITED | NOT_AVAILABLE`. `reason` is
  `INITIALIZING | RELOCALIZING | TOO_MUCH_MOTION | NOT_ENOUGH_TEXTURE | UNSPECIFIED`
  (the same vocabulary as 8th Wall).
* `update(now)` → frame state `{pose: {q, t}, texture, textureWidth, textureHeight,
  displayIntrinsics, status, reason, exposure, frameId}`. `pose` is camera-to-world.
  Quaternions are `[x, y, z, w]`, world +Y is up, and the camera looks down −Z.
* `hitTest(x, y, types)`: normalized view coordinates, like `XR8.XrController.hitTest`.
* `createAnchor / removeAnchor / anchors`: world-fixed anchors, kept consistent
  when the world is rescaled.
* `rescaleWorld(scale, center)`, `transformWorld(yaw, t)`, `resetTracking({continuePose, cameraHeight})`, `recenter()`.
* `addPipelineModule({onAttach, onStart, onCameraFrame, onUpdate, onRender, onDetach})`:
  the same idea as 8th Wall's camera pipeline modules.

### `MarkerAnchor` (shared, metric anchor)

```js
import { MarkerAnchor, createJsQrDetector } from './lib/plinth/index.js';
const marker = new MarkerAnchor({
  detector: createJsQrDetector({ scriptUrl: '/vendor/jsqr/jsQR.js' }),
  size: 0.0967,                 // meters between the code's outer corners
  match: 'MY-TABLE-ANCHOR',     // payload filter (string or RegExp)
});
ar.engine.addPipelineModule(marker);
ar.engine.on('markerfound', ({ anchor }) => ar.objectForAnchor(anchor).add(board));
```

QR detection runs in its own worker on exactly the frames being tracked. Each
sighting is fused with *that frame's* tracked pose: the corner rays are
intersected with the marker's plane to get its world position, heading and size.
The known printed size makes the world metric. When the marker leaves the view,
SLAM keeps the anchor where it is. `marker.frozen = true` stops sightings from
moving it. The detector is pluggable (`{detect({data, width, height}) → {corners, data}}`),
so ArUco/AprilTag or image-target detectors drop in.

### Gestures (`three/gestures.js`)

* `GestureDetector(element, {onStart, onMove, onEnd, onTap})`: pointer-based
  one- and two-finger gestures with center, spread and twist angle.
* `ObjectManipulator(ar, object, {dragDelay, liftHeight, minScale, maxScale})`:
  hold to drag along the surface (keeps the grab offset, lifts while dragging,
  eases down on release), pinch to scale, two-finger twist to rotate. Two-finger
  gestures go to the selected (last touched/placed) object.
* `PlacementReticle(ar, {onPlace})`: surface reticle at screen center, tap to place.

## How it works

```
camera (getUserMedia, 4:3)            IMU (deviceorientation 60 Hz, timestamped history)
   │ requestVideoFrameCallback           │
   ▼                                     │ orientation at the frame's capture time
texture ring slot k ──► GPU: downsample + grayscale, 4 px packed per texel
   │                     │  async read-back (PBO + fence), no GPU stall
   │                     ▼
   │                tracking worker ◄────┘
   │                  KLT (gyro-predicted) → RANSAC(t | R_imu) → robust pose
   │                  + gyro/gravity priors → keyframes → triangulate / verify
   │                  plane points → re-acquire (rectified BRIEF) → relocalize
   │                     │ pose_k
   ▼                     ▼
draw camera texture k + render scene with pose_k   ← same frame, so no "swimming"
```

Key design points, with 8th Wall's equivalents:

* **Frame sync.** 8th Wall's `processPipeline()` "lags 2 frames behind" to
  allow deferred GPU→CPU reads, and returns the `realityTexture` that matches
  the pose. Plinth keeps a 4-slot texture ring and shows slot *k* with pose *k*.
* **Calibration.** 8th Wall's per-device focal lengths (480×640 reference,
  MIT-licensed) with their screen-height-based iPhone detection;
  `cropAndScale` maps a calibration to any capture or display size.
* **4:3 capture.** 16:9 streams are crops of the 4:3 sensor, which throws away
  field of view and trackable features.
* **Plane prior + verification.** Corners whose rays hit the ground within
  about 14° below the horizon start on the plane. Each is triangulated once
  there's parallax and demoted if it isn't actually on the plane (objects on
  the table, the floor beyond the table edge).
* **Ground-rectified descriptors.** For points on the plane, the BRIEF pattern
  is sampled on a world-aligned, top-down patch through the plane homography.
  This makes descriptors invariant to the oblique foreshortening that changes
  as you walk around a table. True matches went from about 72 to 24 of 256 bits
  apart, which is what makes walk-around re-acquisition and relocalization work.
  It extends 8th Wall's gravity-oriented "GORB" idea.
* **Gravity everywhere.** The tilt prior, 4-DoF relocalization
  (`R = R_y(ψ)·R_tilt`, linear in `cos ψ, sin ψ, t`), and the heading offset between
  IMU and map are tracked continuously, because browser yaw drifts.
* **Online camera-IMU time offset.** Estimated by matching visual and IMU
  rotation over candidate offsets.

## Accuracy and performance

Measured on rendered sequences with exact ground truth (`test/plinth/sequence.mjs`,
270×480 tracking, IMU with 0.6°/s yaw drift and noise). *Anchor error* is how
far a virtual object placed on the table appears from where it should be,
in pixels on a 640 px tall image.

| sequence | anchor error p50 / p95 | camera position p50 | notes |
| --- | --- | --- | --- |
| 360° walk around the table | 0.9 / 3.5 px | 0.5 cm | never lost |
| hand-held jitter | 0.3 / 0.6 px | 0.2 cm | |
| look away at the walls and back | 0.7 / 1.0 px | 1.4 cm | |
| camera covered while walking 60° | 0.8 / 1.4 px after recovery | – | relocalized on the first uncovered frame |

Headless Chromium running the full pipeline (WebGL, async read-back, worker,
three.js) measured 0.49 / 1.15 px over 90 frames. Tracking takes about 4–7 ms per
frame on a desktop CPU in Node. Expect about 3× that on a phone, in the worker,
off the main thread.

## Tests

```
npm run test:ar           # unit + tracking accuracy (Node)
npm run test:ar:browser   # GPU stage + full pipeline in headless Chromium (Playwright)
```

## Limitations and what's not included

* Tracking is designed for **horizontal surfaces** (tables, floors). Vertical
  planes, meshes and depth aren't estimated.
* Monocular scale is defined by `cameraHeight` (or a marker). There's no
  accelerometer-based absolute scale.
* 8th Wall features outside this scope: face effects, sky segmentation, image
  targets (use a `MarkerAnchor` detector), VPS, hand tracking, media recording.
* Verified on synthetic sequences and in headless Chromium. Real-device tuning
  (thresholds, camera latency) should be checked on the phones you target.
  `?debug` in the tabletop app exposes the tracker for inspection, and
  `ar.setShowFeaturePoints(true)` shows the map.

## Credits

Device focal lengths and the iPhone screen-size detection table are adapted
from 8th Wall's open-source engine (MIT License, © 8th Wall / Niantic). All other
code is original.
