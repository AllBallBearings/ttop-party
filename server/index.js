const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const { ensureTlsCertificates, getLanIPv4Addresses } = require('./tls');
const { RoomManager } = require('./roomManager');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const CERTS_DIR = path.join(ROOT_DIR, 'certs');
const THREE_BUILD_DIR = path.join(ROOT_DIR, 'node_modules', 'three', 'build');
const JSQR_DIST_DIR = path.join(ROOT_DIR, 'node_modules', 'jsqr', 'dist');

const HTTPS_PORT = Number(process.env.PORT || 3443);
const HTTP_PORT = Number(process.env.HTTP_PORT || 3000);
const ANCHOR_MARKER_PAYLOAD = 'TABLETOP-AR-ANCHOR-V1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const room = new RoomManager();

function resolveSafeFile(baseDir, relPath) {
  const normalized = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(baseDir, normalized);
  if (!fullPath.startsWith(baseDir)) return null;
  return fullPath;
}

function serveStaticFile(res, filePath) {
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
}

async function handleRequest(req, res, isHttps) {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  // Redirect LAN HTTP visits to HTTPS so mobile browsers allow getUserMedia() camera access
  const hostHeader = (req.headers.host || '').split(':')[0];
  const isLocalhost = hostHeader === 'localhost' || hostHeader === '127.0.0.1';
  if (!isHttps && !isLocalhost && pathname === '/') {
    const targetHost = hostHeader || getLanIPv4Addresses()[0] || 'localhost';
    res.writeHead(302, { Location: `https://${targetHost}:${HTTPS_PORT}/` });
    res.end();
    return;
  }

  if (pathname === '/api/info') {
    const lanIps = getLanIPv4Addresses();
    const primaryIp = lanIps[0] || '127.0.0.1';
    const primaryJoinUrl = `https://${primaryIp}:${HTTPS_PORT}/`;
    const [anchorQrSvg, joinQrSvg] = await Promise.all([
      QRCode.toString(ANCHOR_MARKER_PAYLOAD, {
        type: 'svg',
        errorCorrectionLevel: 'H',
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      }),
      QRCode.toString(primaryJoinUrl, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
      }),
    ]);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      httpsPort: HTTPS_PORT,
      httpPort: HTTP_PORT,
      lanIps,
      primaryJoinUrl,
      lanUrls: lanIps.map((ip) => `https://${ip}:${HTTPS_PORT}/`),
      anchorPayload: ANCHOR_MARKER_PAYLOAD,
      anchorQrSvg,
      joinQrSvg,
    }));
    return;
  }

  if (pathname.startsWith('/vendor/three/')) {
    const rel = pathname.slice('/vendor/three/'.length);
    serveStaticFile(res, resolveSafeFile(THREE_BUILD_DIR, rel));
    return;
  }

  if (pathname.startsWith('/vendor/jsqr/')) {
    const rel = pathname.slice('/vendor/jsqr/'.length);
    serveStaticFile(res, resolveSafeFile(JSQR_DIST_DIR, rel));
    return;
  }

  if (pathname === '/anchor') {
    serveStaticFile(res, path.join(PUBLIC_DIR, 'anchor.html'));
    return;
  }

  const targetRel = pathname === '/' ? 'index.html' : pathname.slice(1);
  serveStaticFile(res, resolveSafeFile(PUBLIC_DIR, targetRel));
}

function attachWebSocket(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const reqUrl = new URL(req.url || '/', 'http://localhost');
    const explicitRoom = (reqUrl.searchParams.get('room') || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 32);
    const activeRoom = room.getRoom(explicitRoom || 'local-wifi');
    let playerId = null;

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === 'hello') {
        playerId = activeRoom.connectClient(ws, msg);
        return;
      }

      if (!playerId) return;
      activeRoom.handleMessage(playerId, msg);
    });

    ws.on('close', () => {
      if (playerId) {
        activeRoom.disconnectClient(playerId);
      }
    });
  });

  return wss;
}

async function start() {
  const { key, cert, lanIps } = ensureTlsCertificates(CERTS_DIR);

  const httpsServer = https.createServer({ key, cert }, (req, res) => {
    handleRequest(req, res, true).catch((err) => {
      console.error(err);
      res.writeHead(500);
      res.end('Internal server error');
    });
  });

  const httpServer = http.createServer((req, res) => {
    handleRequest(req, res, false).catch((err) => {
      console.error(err);
      res.writeHead(500);
      res.end('Internal server error');
    });
  });

  attachWebSocket(httpsServer);
  attachWebSocket(httpServer);

  await new Promise((resolve) => httpsServer.listen(HTTPS_PORT, '0.0.0.0', resolve));
  await new Promise((resolve) => httpServer.listen(HTTP_PORT, '0.0.0.0', resolve));

  const primaryIp = lanIps[0] || 'localhost';
  const joinUrl = `https://${primaryIp}:${HTTPS_PORT}/`;

  console.log('\n==============================================================');
  console.log('  TABLETOP AR MULTIPLAYER GAME SUITE');
  console.log('==============================================================');
  console.log(`  First player to visit becomes the HOST!`);
  console.log(`  Mobile AR (HTTPS):  ${joinUrl}`);
  if (lanIps.length > 1) {
    lanIps.slice(1).forEach((ip) => {
      console.log(`  Alt LAN (HTTPS):    https://${ip}:${HTTPS_PORT}/`);
    });
  }
  console.log(`  Print QR Anchor:    http://${primaryIp}:${HTTP_PORT}/anchor`);
  console.log(`  Desktop Preview:    http://localhost:${HTTP_PORT}/`);
  console.log('--------------------------------------------------------------');
  console.log('  Scan to join on phone (same Wi-Fi):');

  const terminalQr = await QRCode.toString(joinUrl, { type: 'terminal', small: true });
  console.log(terminalQr);
  console.log('  Note: On mobile first visit, tap "Advanced -> Proceed" to');
  console.log('  accept the local self-signed HTTPS certificate for camera AR.');
  console.log('==============================================================\n');
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
