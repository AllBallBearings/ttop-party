// Browser tests (headless Chromium via Playwright): the real WebGL + worker
// pipeline, not just the tracking math.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runE2E, serve } from './browser/run-e2e.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');

test('GPU grayscale stage maps processing pixels to the right capture pixels', { timeout: 120000 }, async () => {
  const server = await serve();
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/test/plinth/browser/gpu-mapping.html`);
    await page.waitForFunction(() => window.__done === true, null, { timeout: 60000 });
    const r = await page.evaluate(() => window.__result);
    for (const mode of ['async', 'sync']) {
      // One 8-bit gray level of the test ramp is ~1.4 capture px.
      assert.ok(Math.abs(r[mode].meanErrCapturePx) < 0.3, `${mode} mean ${r[mode].meanErrCapturePx}`);
      assert.ok(r[mode].maxErrCapturePx < 1.5, `${mode} max ${r[mode].maxErrCapturePx}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
});

for (const worker of [true, false]) {
  test(`full pipeline in Chromium (${worker ? 'worker' : 'inline'} tracker): content stays on the table`, { timeout: 600000 }, async () => {
    const { result, errors } = await runE2E({ traj: 'orbit', frames: 60, worker });
    assert.ok(!result.error, result.error);
    assert.deepEqual(errors.filter((e) => !e.startsWith('[warning]')), []);
    assert.equal(result.measured, 60);
    assert.equal(result.status, 'NORMAL');
    assert.ok(result.p95 < 3, `anchor p95 ${result.p95}px`);
  });
}

test('gestures on the demo page: tap to place, hold-drag, pinch, twist', { timeout: 180000 }, async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { writeY4M } = await import('./browser/fake-camera.mjs');
  const { lookAtQuat } = await import('./synth.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinth-'));
  const eye = [0, 0.45, 0.55];
  const pose = { q: lookAtQuat(eye, [0, 0, 0]), t: eye };
  const video = writeY4M(path.join(dir, 'static.y4m'), Array(30).fill(pose));
  const server = await serve();
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${video}`, '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, permissions: ['camera'], hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${server.address().port}/public/lib/plinth/examples/place.html`);
    await page.click('#startBtn');
    await page.waitForFunction(() => window.ar?.engine?.trackingStatus === 'NORMAL', null, { timeout: 30000 });
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
    const state = () => page.evaluate(() => {
      const anchors = [...ar.anchorObjects.values()];
      const obj = anchors[0]?.children.find((c) => c.isGroup);
      if (!obj) return { anchors: anchors.length };
      const p = obj.getWorldPosition(new obj.position.constructor());
      const s = p.clone(); s.y += 0.04; s.project(ar.camera);
      return { anchors: anchors.length, pos: p.toArray(), scale: obj.scale.x, rotY: obj.rotation.y, screen: [(s.x + 1) * 195, (1 - s.y) * 390] };
    });
    await touch('touchStart', [[195, 390]]); await touch('touchEnd', []);
    await page.waitForTimeout(700);
    const placed = await state();
    assert.equal(placed.anchors, 1, 'tap places one object');
    assert.ok(Math.abs(placed.pos[1]) < 0.01, 'object stands on the surface');
    const [sx, sy] = placed.screen;
    await touch('touchStart', [[sx, sy]]);
    await page.waitForTimeout(450);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', [[sx + i * 8, sy]]); await page.waitForTimeout(30); }
    await page.waitForTimeout(300);
    const lifted = await state();
    assert.ok(lifted.pos[1] > 0.02, `lifted while dragging (${lifted.pos[1]})`);
    await touch('touchEnd', []);
    await page.waitForTimeout(600);
    const dropped = await state();
    assert.ok(dropped.pos[0] - placed.pos[0] > 0.04, `moved right (${dropped.pos[0] - placed.pos[0]})`);
    assert.ok(Math.abs(dropped.pos[1]) < 0.005, 'dropped back onto the surface');
    const [cx, cy] = dropped.screen;
    await touch('touchStart', [[cx - 20, cy], [cx + 20, cy]]);
    for (let i = 1; i <= 5; i++) { const d = 20 + i * 4; await touch('touchMove', [[cx - d, cy], [cx + d, cy]]); await page.waitForTimeout(20); }
    await touch('touchEnd', []);
    const pinched = await state();
    assert.ok(Math.abs(pinched.scale - 2) < 0.05, `pinch 40px -> 80px doubles the scale (${pinched.scale})`);
    await touch('touchStart', [[cx - 50, cy], [cx + 50, cy]]);
    for (let i = 1; i <= 10; i++) { const a = i * 0.05; await touch('touchMove', [[cx - 50 * Math.cos(a), cy - 50 * Math.sin(a)], [cx + 50 * Math.cos(a), cy + 50 * Math.sin(a)]]); await page.waitForTimeout(20); }
    await touch('touchEnd', []);
    const twisted = await state();
    assert.ok(Math.abs(twisted.rotY + 0.5) < 0.02, `twist 0.5 rad rotates by 0.5 rad (${twisted.rotY})`);
    assert.equal(twisted.anchors, 1, 'multi-touch gestures do not place extra objects');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tabletop app: QR marker anchors the board with metric scale', { timeout: 240000 }, async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { writeY4M } = await import('./browser/fake-camera.mjs');
  const { lookAtQuat, defaultScene } = await import('./synth.mjs');
  const { referenceFocal } = await import('../../public/lib/plinth/core/device-calibration.js');
  const qrcode = createRequire(import.meta.url)('qrcode-generator');
  const q = qrcode(0, 'H');
  q.addData('TABLETOP-AR-ANCHOR-V1');
  q.make();
  const n = q.getModuleCount();
  const scene = defaultScene(1);
  scene.qr = { matrix: Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c))), size: 0.0967, center: [0, 0] };
  // Ping-pong orbit (no jump when the fake camera loops). True camera height 0.36 m;
  // the app assumes 0.45 m until the marker reveals the scale.
  const poses = [];
  for (let i = 0; i < 40; i++) {
    const k = i < 20 ? i / 20 : (40 - i) / 20;
    const a = k * 0.5;
    const eye = [Math.sin(a) * 0.38, 0.36, Math.cos(a) * 0.38];
    poses.push({ q: lookAtQuat(eye, [0, 0, 0]), t: eye });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinth-'));
  const video = writeY4M(path.join(dir, 'qr.y4m'), poses, { width: 720, height: 960, focal480: referenceFocal({ platform: 'desktop' }), scene });
  const server = await serve();
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${video}`, '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${server.address().port}/public/index.html?debug=1`);
    await page.waitForFunction(() => window.__tabletop?.arTracker?.anchorSource === 'marker', null, { timeout: 60000 });
    await page.waitForTimeout(3000);
    const s = await page.evaluate(() => {
      const t = window.__tabletop.arTracker;
      return {
        visible: t.boardPivot.visible,
        cameraHeight: t.engine.opts.cameraHeight,
        yawDeg: (2 * Math.atan2(t.anchor.rotation[1], t.anchor.rotation[3]) * 180) / Math.PI,
        anchorY: t.anchor.position[1],
      };
    });
    assert.ok(s.visible, 'board visible');
    assert.ok(Math.abs(s.cameraHeight - 0.36) < 0.036, `metric scale: camera height ${s.cameraHeight.toFixed(3)} m (true 0.36)`);
    assert.ok(Math.abs(s.yawDeg) < 5, `board heading ${s.yawDeg.toFixed(1)}° (true 0°)`);
    assert.ok(Math.abs(s.anchorY) < 0.01, 'board on the table plane');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
