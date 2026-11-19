import test from 'node:test';
import assert from 'node:assert/strict';

import * as M from '../../public/lib/plinth/core/math.js';
import { Intrinsics, coverUvTransform } from '../../public/lib/plinth/core/camera-model.js';
import { captureIntrinsics, detectIosModel, referenceFocal } from '../../public/lib/plinth/core/device-calibration.js';
import { GrayImage, buildPyramid, blur5 } from '../../public/lib/plinth/vision/image.js';
import { detectFast } from '../../public/lib/plinth/vision/fast.js';
import { trackKLT } from '../../public/lib/plinth/vision/klt.js';
import { describe as describeBrief, orientation, hamming } from '../../public/lib/plinth/vision/brief.js';
import {
  optimizePose, projectPoint, triangulateRays, absolutePoseGravity, ransacAbsolutePoseGravity,
  ransacTranslation, pixelRay,
} from '../../public/lib/plinth/vision/geometry.js';
import { makeTexture, render, defaultScene, lookAtQuat } from './synth.mjs';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b} (eps ${eps})`);

test('quaternion exp/log and rotation round-trip', () => {
  const r = [0.3, -0.2, 0.9];
  const q = M.quatFromRotVec(r);
  const back = M.quatToRotVec(q);
  r.forEach((x, i) => close(back[i], x, 1e-9));
  const v = [1, 2, 3];
  const m = M.quatToMat3(q);
  const a = M.quatRotate(q, v);
  const b = M.mat3MulVec(m, v);
  a.forEach((x, i) => close(x, b[i], 1e-12));
  const q2 = M.mat3ToQuat(m);
  assert.ok(M.quatAngle(q, q2) < 1e-9);
});

test('yaw extraction and tilt-only', () => {
  const q = M.quatMul(M.quatFromYaw(0.7), M.quatFromAxisAngle([1, 0, 0], -0.4));
  close(M.yawOfQuat(q), 0.7, 1e-9);
  const tilt = M.quatTiltOnly(q);
  close(M.yawOfQuat(tilt), 0, 1e-9);
});

test('intrinsics projection matrix matches pixel projection', () => {
  const K = Intrinsics.fromFocal(480, 640, 506.4).cropAndScale(390, 844);
  const P = K.projectionMatrix(0.01, 100);
  const pts = [[0.1, 0.2, -1], [-0.3, -0.25, -2], [0, 0, -0.5]];
  for (const p of pts) {
    const [u, v] = K.project(p);
    const cx = P[0] * p[0] + P[4] * p[1] + P[8] * p[2] + P[12];
    const cy = P[1] * p[0] + P[5] * p[1] + P[9] * p[2] + P[13];
    const cw = P[3] * p[0] + P[7] * p[1] + P[11] * p[2] + P[15];
    const ndcX = cx / cw;
    const ndcY = cy / cw;
    close((ndcX + 1) / 2 * K.width - 0.5, u, 1e-3, 'u');
    close((1 - ndcY) / 2 * K.height - 0.5, v, 1e-3, 'v');
  }
});

test('cover UV transform agrees with cropAndScale', () => {
  const cap = captureIntrinsics(720, 960);
  const disp = cap.cropAndScale(390, 844);
  const uv = coverUvTransform(720, 960, 390, 844);
  // A display pixel maps to the same ray as the texture pixel it samples.
  const du = 100;
  const dv = 700;
  const tu = ((du + 0.5) / 390 * uv.scaleX + uv.offsetX) * 720 - 0.5;
  const tv = ((dv + 0.5) / 844 * uv.scaleY + uv.offsetY) * 960 - 0.5;
  const r1 = disp.unproject(du, dv);
  const r2 = cap.unproject(tu, tv);
  close(r1[0], r2[0], 1e-6);
  close(r1[1], r2[1], 1e-6);
});

test('device calibration: 16:9 capture keeps the long-side FOV of the 4:3 sensor', () => {
  const k43 = captureIntrinsics(960, 1280, 506.4104).fovY;
  const k169 = captureIntrinsics(720, 1280, 506.4104).fovY;
  close(k43, k169, 1e-6);
  const land = captureIntrinsics(1280, 720, 506.4104);
  close(land.fovX, k43, 1e-6);
  assert.equal(detectIosModel(2532), 'iPhone 12/13/14');
  assert.ok(Math.abs(referenceFocal({ platform: 'android', model: 'Pixel 7' }) - 521.8225) < 1e-6);
  assert.ok(Math.abs(referenceFocal({ platform: 'android', model: 'SM-G960U1' }) - 499.9801) < 1e-6);
});

test('FAST finds corners of rectangles with grid bucketing', () => {
  const img = new GrayImage(160, 120);
  img.data.fill(60);
  for (let y = 40; y < 80; y++) for (let x = 50; x < 110; x++) img.data[y * 160 + x] = 200;
  const pts = detectFast(img, { threshold: 30, border: 4, gridCols: 4, gridRows: 4, perCell: 4 });
  const corners = [[50, 40], [109, 40], [50, 79], [109, 79]];
  for (const [cx, cy] of corners) {
    assert.ok(pts.some((p) => Math.abs(p.x - cx) <= 2 && Math.abs(p.y - cy) <= 2), `corner ${cx},${cy}`);
  }
});

function shiftedImage(tex, dx, dy, w, h, gain = 1, bias = 0) {
  const img = new GrayImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x + 200 - dx;
      const sy = y + 200 - dy;
      const x0 = Math.floor(sx); const y0 = Math.floor(sy);
      const fx = sx - x0; const fy = sy - y0;
      const s = tex.size;
      const a = tex.data[y0 * s + x0]; const b = tex.data[y0 * s + x0 + 1];
      const c = tex.data[(y0 + 1) * s + x0]; const d = tex.data[(y0 + 1) * s + x0 + 1];
      const v = (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy) * gain + bias;
      img.data[y * w + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return img;
}

test('KLT recovers sub-pixel translation with a brightness change', () => {
  const tex = makeTexture(512, 5, { blobs: 500 });
  const a = shiftedImage(tex, 0, 0, 240, 180);
  const b = shiftedImage(tex, 13.4, -9.7, 240, 180, 1, 12);
  const pa = buildPyramid(a, 3);
  const pb = buildPyramid(b, 3);
  const feats = detectFast(a, { threshold: 25, gridCols: 6, gridRows: 4, perCell: 3 });
  assert.ok(feats.length > 20);
  const pts = new Float32Array(feats.flatMap((p) => [p.x, p.y]));
  // Guesses as an IMU-driven prediction would give them: within ~2 px.
  const guesses = new Float32Array(pts.length);
  for (let i = 0; i < feats.length; i++) {
    guesses[i * 2] = pts[i * 2] + 13.4 + 1.6;
    guesses[i * 2 + 1] = pts[i * 2 + 1] - 9.7 - 1.2;
  }
  const res = trackKLT(pa, pb, pts, guesses, { maxError: 25, fbThreshold: 0.5 });
  let good = 0;
  let wrong = 0;
  let total = 0;
  for (let i = 0; i < feats.length; i++) {
    const x = pts[i * 2] + 13.4;
    const y = pts[i * 2 + 1] - 9.7;
    if (x < 10 || y < 10 || x > 230 || y > 170) continue;
    total++;
    const err = Math.hypot(res.positions[i * 2] - x, res.positions[i * 2 + 1] - y);
    if (res.status[i] && err < 0.3) good++;
    if (res.status[i] && err >= 1) wrong++;
  }
  assert.ok(good / total > 0.85, `tracked ${good}/${total}`);
  assert.equal(wrong, 0, 'no accepted wrong tracks');
  // Unguided 16 px jump: the forward-backward check removes most false
  // convergences (true aliasing between identical-looking corners can remain).
  const countWrong = (r) => {
    let c = 0;
    for (let i = 0; i < feats.length; i++) {
      if (!r.status[i]) continue;
      const err = Math.hypot(r.positions[i * 2] - pts[i * 2] - 13.4, r.positions[i * 2 + 1] - pts[i * 2 + 1] + 9.7);
      if (err > 1) c++;
    }
    return c;
  };
  const noFb = countWrong(trackKLT(pa, pb, pts, null, { maxError: 25 }));
  const withFb = countWrong(trackKLT(pa, pb, pts, null, { maxError: 25, fbThreshold: 0.5 }));
  assert.ok(withFb < noFb, `wrong tracks: ${noFb} without FB, ${withFb} with FB`);
});

test('oriented BRIEF is rotation invariant', () => {
  const tex = makeTexture(256, 3, { blobs: 220 });
  const size = 96;
  const rotImg = (angle) => {
    const img = new GrayImage(size, size);
    const c = Math.cos(angle); const s = Math.sin(angle);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = x - size / 2; const dy = y - size / 2;
      const sx = 128 + c * dx + s * dy; const sy = 128 - s * dx + c * dy;
      img.data[y * size + x] = tex.data[Math.round(sy) * 256 + Math.round(sx)];
    }
    return blur5(img);
  };
  const a = rotImg(0);
  const b = rotImg(1.1);
  const da = describeBrief(a, 48, 48, orientation(a, 48, 48));
  const db = describeBrief(b, 48, 48, orientation(b, 48, 48));
  const other = describeBrief(a, 30, 60, orientation(a, 30, 60));
  assert.ok(hamming(da, db) < 60, `same point distance ${hamming(da, db)}`);
  assert.ok(hamming(da, other) > 80, `different point distance ${hamming(da, other)}`);
});

function syntheticObs(pose, K, n, seed, noise = 0.5) {
  const rand = M.mulberry32(seed);
  const obs = [];
  // Sample inside the camera frustum (depth 0.4..2.4) and move to world.
  for (let guard = 0; obs.length < n && guard < 100000; guard++) {
    const depth = 0.4 + rand() * 2;
    const u0 = rand() * K.width;
    const v0 = rand() * K.height;
    const pc = [((u0 - K.cx) / K.fx) * depth, (-(v0 - K.cy) / K.fy) * depth, -depth];
    const p = M.cameraToWorld(pose, pc);
    const pr = projectPoint(pose, K, p);
    obs.push({ p, u: pr[0] + (rand() - 0.5) * 2 * noise, v: pr[1] + (rand() - 0.5) * 2 * noise });
  }
  return obs;
}

test('optimizePose converges with outliers and an IMU tilt prior', () => {
  const K = Intrinsics.fromFocal(360, 640, 480);
  const truth = { q: M.quatNormalize(M.quatMul(M.quatFromYaw(0.3), M.quatFromAxisAngle([1, 0, 0], -0.5))), t: [0.1, 0.6, 0.4] };
  const obs = syntheticObs(truth, K, 80, 3);
  const rand = M.mulberry32(9);
  for (let i = 0; i < 16; i++) { obs[i].u += (rand() - 0.5) * 120; obs[i].v += (rand() - 0.5) * 120; }
  const start = { q: M.quatMul(truth.q, M.quatFromRotVec([0.03, -0.04, 0.02])), t: [0.14, 0.57, 0.45] };
  const { pose } = optimizePose(start, obs, K, { iterations: 12, huber: 2, tukey: 6, tiltPrior: { q: truth.q, sigma: 0.01 } });
  assert.ok(M.dist3(pose.t, truth.t) < 0.005, `t err ${M.dist3(pose.t, truth.t)}`);
  assert.ok(M.quatAngle(pose.q, truth.q) < 0.003);
});

test('RANSAC translation with known rotation', () => {
  const K = Intrinsics.fromFocal(360, 640, 480);
  const truth = { q: M.quatFromAxisAngle([1, 0, 0], -0.6), t: [0, 0.5, 0.2] };
  const obs = syntheticObs(truth, K, 60, 4, 0.3);
  for (let i = 0; i < 20; i++) obs[i].u += 50;
  const res = ransacTranslation(truth.q, K, obs, { threshold: 3 });
  assert.ok(res && res.count >= 38);
  assert.ok(M.dist3(res.pose.t, truth.t) < 0.01);
});

test('gravity-aware 4-DoF absolute pose', () => {
  const K = Intrinsics.fromFocal(360, 640, 480);
  const truth = { q: M.quatNormalize(M.quatMul(M.quatFromYaw(2.1), M.quatFromAxisAngle([1, 0, 0], -1.2))), t: [0.4, 0.45, -0.3] };
  const obs = syntheticObs(truth, K, 40, 6, 0);
  // Tilt known, yaw unknown (IMU yaw is arbitrary).
  const imuQ = M.quatMul(M.quatFromYaw(-0.9), truth.q);
  const pose = absolutePoseGravity(imuQ, K, obs, [0, 5, 9]);
  assert.ok(M.quatAngle(pose.q, truth.q) < 1e-6, 'rotation');
  assert.ok(M.dist3(pose.t, truth.t) < 1e-6, 'translation');
  const noisy = syntheticObs(truth, K, 60, 8, 0.5);
  for (let i = 0; i < 25; i++) noisy[i].v += 80;
  const r = ransacAbsolutePoseGravity(imuQ, K, noisy, { minInliers: 20 });
  assert.ok(r && M.dist3(r.pose.t, truth.t) < 0.01);
});

test('triangulateRays', () => {
  const p = [0.2, 0.1, -1.4];
  const cams = [[0, 0.4, 0], [0.3, 0.45, 0.1], [-0.2, 0.5, 0.05]];
  const rays = cams.map((c) => ({ c, d: M.normalize3(M.sub3(p, c)) }));
  const r = triangulateRays(rays);
  assert.ok(M.dist3(r.p, p) < 1e-9);
  assert.ok(r.maxParallax > 0.1);
});

test('synthetic renderer: table point projects where the image shows it', () => {
  const scene = defaultScene(2);
  const K = Intrinsics.fromFocal(120, 160, 140);
  const eye = [0, 0.5, 0.5];
  const pose = { q: lookAtQuat(eye, [0, 0, 0]), t: eye };
  const img = render(scene, pose, K);
  assert.equal(img.width, 120);
  const center = pixelRay(pose, K, K.cx, K.cy);
  // Looking at the origin: the centre ray points toward it.
  const toOrigin = M.normalize3(M.sub3([0, 0, 0], eye));
  assert.ok(M.dot3(center, toOrigin) > 0.9999);
});

test('plane homography matches point projection', async () => {
  const { planeHomography } = await import('../../public/lib/plinth/vision/geometry.js');
  const K = Intrinsics.fromFocal(270, 480, 380);
  const pose = { q: M.quatNormalize(M.quatMul(M.quatFromYaw(0.8), M.quatFromAxisAngle([1, 0, 0], -0.9))), t: [0.2, 0.45, 0.3] };
  const H = planeHomography(pose, K);
  for (const [x, z] of [[0, 0], [0.1, -0.2], [-0.15, 0.05]]) {
    const pr = projectPoint(pose, K, [x, 0, z]);
    const w = H[6] * x + H[7] * z + H[8];
    close((H[0] * x + H[1] * z + H[2]) / w, pr[0], 1e-9);
    close((H[3] * x + H[4] * z + H[5]) / w, pr[1], 1e-9);
  }
});

test('tracker yaw error is well defined when looking straight down', async () => {
  const { Tracker } = await import('../../public/lib/plinth/vision/tracker.js');
  const tr = new Tracker(Intrinsics.fromFocal(120, 160, 140));
  tr.yawOffset = 0;
  const down = M.quatFromAxisAngle([1, 0, 0], -Math.PI / 2); // looking straight down
  for (const yaw of [0.3, -1.2, 2.5]) {
    const q = M.quatMul(M.quatFromYaw(yaw), down);
    close(tr._yawError(q, down), yaw, 1e-9);
  }
});
