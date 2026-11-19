// Headless-Chromium end-to-end test of the full browser pipeline:
// texture ring upload -> GPU grayscale pack -> (async) read-back -> tracking
// worker -> frame-synchronised background + three.js render.
//
//   node test/plinth/browser/run-e2e.mjs [--traj orbit] [--frames 90] [--no-worker] [--shot out.png]

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Resolve Playwright from the project or a global install (NODE_PATH).
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };

export function serve(root = ROOT) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

export async function runE2E({ traj = 'orbit', frames = 90, worker = true, shot = null } = {}) {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
    await page.goto(`http://127.0.0.1:${port}/test/plinth/browser/e2e.html?traj=${traj}&frames=${frames}&worker=${worker ? 1 : 0}`);
    await page.waitForFunction(() => window.__done === true, null, { timeout: 600000 });
    const result = await page.evaluate(() => window.__result);
    if (shot) await page.screenshot({ path: shot });
    return { result, errors };
  } finally {
    await browser.close();
    server.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const out = await runE2E({
    traj: arg('--traj', 'orbit'),
    frames: Number(arg('--frames', 90)),
    worker: !process.argv.includes('--no-worker'),
    shot: arg('--shot', null),
  });
  console.log(JSON.stringify(out, null, 2));
  if (out.result?.error || out.errors.some((e) => !e.startsWith('[warning]'))) process.exitCode = 1;
}
