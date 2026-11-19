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
