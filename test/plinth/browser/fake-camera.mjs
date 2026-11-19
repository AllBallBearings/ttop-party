// Write a Y4M video of the synthetic scene for Chromium's fake camera
// (--use-file-for-fake-video-capture).
import fs from 'node:fs';
import { render, defaultScene } from '../synth.mjs';
import { captureIntrinsics } from '../../../public/lib/plinth/core/device-calibration.js';

export function writeY4M(file, poses, { width = 480, height = 640, focal480, scene = defaultScene(1) } = {}) {
  const K = captureIntrinsics(width, height, focal480);
  const fd = fs.openSync(file, 'w');
  fs.writeSync(fd, `YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\n`);
  const uv = Buffer.alloc((width / 2) * (height / 2), 128);
  let last = null;
  let lastPose = null;
  for (const pose of poses) {
    if (pose !== lastPose) last = Buffer.from(render(scene, pose, K, { noise: 2 }).data.buffer);
    lastPose = pose;
    fs.writeSync(fd, 'FRAME\n');
    fs.writeSync(fd, last);
    fs.writeSync(fd, uv);
    fs.writeSync(fd, uv);
  }
  fs.closeSync(fd);
  return file;
}
