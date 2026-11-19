// End-to-end tracking accuracy on rendered sequences (ground truth known).
// Anchor error = how far (in pixels, on a 640 px tall image) a virtual object
// placed on the table drifts from where it should appear.

import test from 'node:test';
import assert from 'node:assert/strict';
import { runSequence } from './sequence.mjs';

test('orbit: full 360° walk around the table', { timeout: 240000 }, () => {
  const r = runSequence('orbit');
  assert.ok(!r.statusTimeline.includes('R'), `never lost: ${r.statusTimeline}`);
  assert.ok(r.anchor.p50 < 2, `anchor p50 ${r.anchor.p50.toFixed(2)}px`);
  assert.ok(r.anchor.p95 < 6, `anchor p95 ${r.anchor.p95.toFixed(2)}px`);
  assert.ok(r.pos.p95 < 0.03, `position p95 ${(r.pos.p95 * 100).toFixed(1)}cm`);
});

test('handheld: fast jitter', { timeout: 240000 }, () => {
  const r = runSequence('handheld');
  assert.ok(/^N+$/.test(r.statusTimeline), r.statusTimeline);
  assert.ok(r.anchor.p95 < 1.5, `anchor p95 ${r.anchor.p95.toFixed(2)}px`);
});

test('lookaway: table leaves the view and returns', { timeout: 240000 }, () => {
  const r = runSequence('lookaway');
  assert.ok(r.anchor.p95 < 4, `anchor p95 ${r.anchor.p95.toFixed(2)}px`);
});

test('blackout: relocalises after the camera is covered and moved', { timeout: 240000 }, () => {
  const r = runSequence('blackout');
  const firstAfter = r.statusTimeline.indexOf('N', 90);
  assert.ok(firstAfter >= 90 && firstAfter <= 94, `relocalised at frame ${firstAfter}: ${r.statusTimeline}`);
  assert.ok(/^N+$/.test(r.statusTimeline.slice(firstAfter)), 'stays tracking after relocalisation');
  const after = r.anchorByFrame.slice(firstAfter).filter((x) => Number.isFinite(x));
  const s = r.summarize(after);
  assert.ok(s.p95 < 3, `post-relocalisation anchor p95 ${s.p95.toFixed(2)}px`);
});
