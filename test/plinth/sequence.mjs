// Run the tracker over rendered camera trajectories and measure accuracy.
//
//   node test/plinth/sequence.mjs [orbit|handheld|lookaway|all] [--width 270]

import {
  quatMul, quatFromYaw, quatFromAxisAngle, quatNormalize, quatRotate, quatConj, quatAngle,
  yawOfQuat, sub3, mulberry32, quatFromRotVec,
} from '../../public/lib/plinth/core/math.js';
import { captureIntrinsics } from '../../public/lib/plinth/core/device-calibration.js';
import { Tracker } from '../../public/lib/plinth/vision/tracker.js';
import { projectPoint } from '../../public/lib/plinth/vision/geometry.js';
import { defaultScene, render, lookAtQuat } from './synth.mjs';
import { GrayImage } from '../../public/lib/plinth/vision/image.js';

export const TRAJECTORIES = {
  // Walk all the way around the table while looking at its centre.
  orbit: { frames: 240, pose(i, n) {
    const a = (i / n) * 2 * Math.PI;
    const r = 0.55;
    const eye = [Math.sin(a) * r, 0.45 + 0.03 * Math.sin(a * 3), Math.cos(a) * r];
    return { q: lookAtQuat(eye, [0, 0, 0], 0.05 * Math.sin(a * 2)), t: eye };
  } },
  // Hand-held jitter: fast small rotations and translations around one spot.
  handheld: { frames: 150, pose(i) {
    const t = i / 30;
    const eye = [0.05 * Math.sin(t * 2.1), 0.42 + 0.03 * Math.sin(t * 3.3), 0.45 + 0.05 * Math.sin(t * 1.7)];
    const base = lookAtQuat(eye, [0.02 * Math.sin(t), 0, 0]);
    const shake = quatFromRotVec([0.12 * Math.sin(t * 9.1), 0.15 * Math.sin(t * 7.3), 0.08 * Math.sin(t * 11)]);
    return { q: quatNormalize(quatMul(base, shake)), t: eye };
  } },
  // Look away from the table at the room for a second, then come back.
  lookaway: { frames: 180, pose(i) {
    const eye0 = [0, 0.45, 0.5];
    let target = [0, 0, 0];
    if (i >= 50 && i < 130) {
      const k = i < 70 ? (i - 50) / 20 : i < 110 ? 1 : 1 - (i - 110) / 20;
      target = [0.8 * k, 0.45 * k, -1.5 * k];
    }
    const a = i * 0.004;
    const eye = [eye0[0] + Math.sin(a) * 0.1, eye0[1], eye0[2] - a * 0.1];
    return { q: lookAtQuat(eye, target), t: eye };
  } },
  // Lean in toward the board and back out again (the camera's distance to
  // the board halves, then recovers), looking at the board centre.
  dolly: { frames: 180, pose(i, n) {
    const k = 0.5 - 0.5 * Math.cos((i / n) * 2 * Math.PI); // 0 -> 1 -> 0
    const s = 1 - 0.55 * k; // distance scale
    const eye = [0.03 * Math.sin(i * 0.05), 0.45 * s, 0.5 * s];
    return { q: lookAtQuat(eye, [0, 0, 0]), t: eye };
  } },
  // Camera covered for ~1.3 s while the user walks 60° around the table.
  blackout: { frames: 170, pose(i) {
    const blank = i >= 50 && i < 90;
    const k = i < 50 ? 0 : i < 90 ? (i - 50) / 40 : 1;
    const a = (k * 60 + (i >= 90 ? (i - 90) * 0.3 : 0)) * (Math.PI / 180);
    const eye = [Math.sin(a) * 0.55, 0.45, Math.cos(a) * 0.55];
    return { q: lookAtQuat(eye, [0, 0, 0]), t: eye, blank };
  } },
};

function blankImage(K, seed) {
  const rand = mulberry32(seed);
  const img = new GrayImage(K.width, K.height);
  for (let i = 0; i < img.data.length; i++) img.data[i] = 18 + rand() * 4;
  return img;
}

export function runSequence(name, { width = 270, seed = 1, log = false, imuDriftDegPerSec = 0.6, noise = 2, heightScale = 1, noImu = false } = {}) {
  const traj = TRAJECTORIES[name];
  const height = Math.round((width * 16) / 9 / 2) * 2;
  const K = captureIntrinsics(720, 1280).cropAndScale(width, height);
  const scene = defaultScene(seed);
  const rand = mulberry32(seed * 77);
  const n = traj.frames;
  const truth0 = traj.pose(0, n);
  const h = truth0.t[1];
  // heightScale != 1: the tracker is told the wrong starting height (as on a
  // phone, where the real height is unknown); its world is then scaled by it.
  const tracker = new Tracker(K, { cameraHeight: h * heightScale });

  // True world -> tracker world (heading and horizontal position of frame 0).
  const psi0 = yawOfQuat(truth0.q);
  const qAlign = quatFromYaw(-psi0);
  const toTracker = (p) => quatRotate(qAlign, [p[0] - truth0.t[0], p[1], p[2] - truth0.t[2]]).map((v) => v * heightScale);
  const anchors = [[0, 0, 0], [0.2, 0, -0.15], [-0.25, 0, 0.2]].map((p) => ({ world: p, trk: toTracker(p) }));

  const stats = { posErr: [], rotErr: [], anchorErr: [], ms: [], status: [], anchorByFrame: new Array(n).fill(NaN) };
  for (let i = 0; i < n; i++) {
    const truth = traj.pose(i, n);
    const img = truth.blank
      ? blankImage(K, seed * 1000 + i)
      : render(scene, truth, K, { noise, seed: seed * 1000 + i });
    const time = i / 30;
    const drift = (imuDriftDegPerSec * time + 20) * (Math.PI / 180);
    const imuNoise = quatFromRotVec([(rand() - 0.5) * 0.003, (rand() - 0.5) * 0.003, (rand() - 0.5) * 0.003]);
    const imuQ = quatNormalize(quatMul(quatMul(quatFromYaw(drift), truth.q), imuNoise));
    const out = tracker.process({ id: i, time, image: img, imuQ: noImu ? null : imuQ });
    stats.ms.push(out.ms);
    stats.status.push(out.status === 'NORMAL' ? 'N' : out.reason === 'RELOCALIZING' ? 'R' : 'L');
    if (!out.pose) continue;
    const tTrue = toTracker(truth.t);
    const qTrue = quatNormalize(quatMul(qAlign, truth.q));
    const pe = Math.hypot(...sub3(out.pose.t, tTrue)) / heightScale;
    const re = (quatAngle(out.pose.q, qTrue) * 180) / Math.PI;
    let ae = 0;
    let an = 0;
    for (const a of anchors) {
      const pt = projectPoint(truth, K, a.world);
      const pe2 = projectPoint(out.pose, K, a.trk);
      if (!pt || !pe2) continue;
      if (pt[0] < 0 || pt[1] < 0 || pt[0] > K.width || pt[1] > K.height) continue;
      ae += Math.hypot(pt[0] - pe2[0], pt[1] - pe2[1]);
      an++;
    }
    stats.posErr.push(pe);
    stats.rotErr.push(re);
    if (an) {
      const err = (ae / an) * (640 / height); // normalised to a 640 px tall image
      stats.anchorErr.push(err);
      stats.anchorByFrame[i] = err;
    }
    if (log && (i % 10 === 0 || out.status !== 'NORMAL')) {
      console.log(
        `${name} #${i} ${out.status}/${out.reason} tracked=${out.tracked} inl=${out.inliers} map=${out.mapSize}` +
        ` pos=${(pe * 100).toFixed(1)}cm rot=${re.toFixed(2)}° anchor=${an ? ((ae / an) * (640 / height)).toFixed(1) : '-'}px ${out.ms.toFixed(1)}ms`
      );
    }
  }
  const summarize = (arr) => {
    const s = Float64Array.from(arr).sort();
    return {
      mean: arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length),
      p50: s[Math.floor(s.length * 0.5)] ?? NaN,
      p95: s[Math.floor(s.length * 0.95)] ?? NaN,
      max: s[s.length - 1] ?? NaN,
    };
  };
  return {
    name,
    resolution: `${width}x${height}`,
    pos: summarize(stats.posErr),
    rot: summarize(stats.rotErr),
    anchor: summarize(stats.anchorErr),
    ms: summarize(stats.ms),
    statusTimeline: stats.status.join(''),
    anchorByFrame: stats.anchorByFrame,
    summarize,
    finalMap: tracker.points.length,
  };
}

if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  const which = process.argv[2] || 'all';
  const wIdx = process.argv.indexOf('--width');
  const width = wIdx > 0 ? Number(process.argv[wIdx + 1]) : 270;
  const names = which === 'all' ? Object.keys(TRAJECTORIES) : [which];
  for (const nm of names) {
    const hIdx = process.argv.indexOf('--height-scale');
    const heightScale = hIdx > 0 ? Number(process.argv[hIdx + 1]) : 1;
    const r = runSequence(nm, { width, heightScale, noImu: process.argv.includes("--no-imu"), log: process.argv.includes('--log') });
    const f = (o, k = 1, d = 2) => `mean ${(o.mean * k).toFixed(d)} p50 ${(o.p50 * k).toFixed(d)} p95 ${(o.p95 * k).toFixed(d)} max ${(o.max * k).toFixed(d)}`;
    console.log(`\n== ${r.name} @ ${r.resolution}`);
    console.log(`  position cm : ${f(r.pos, 100, 1)}`);
    console.log(`  rotation deg: ${f(r.rot)}`);
    console.log(`  anchor px   : ${f(r.anchor, 1, 1)}   (640px-tall equivalent)`);
    console.log(`  tracker ms  : ${f(r.ms, 1, 1)}`);
    console.log(`  status      : ${r.statusTimeline}`);
  }
}
