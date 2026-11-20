# Tabletop AR Multiplayer Game Suite

A QR-anchored mobile web AR tabletop multiplayer mini-game suite.
Designed so the **1st player to open the URL on their Wi-Fi becomes the Host** (running the game engine inside their phone's browser), while connecting over standard HTTPS/WSS (`443`) to **bypass strict hotel/corporate Wi-Fi client isolation**.

## Architecture
- **Frontend (`public/`)** — Static HTML/CSS/JS ready for **GitHub Pages** (auto-deployed via `.github/workflows/pages.yml` on push to `main`). Includes vendored Three.js, `jsQR`, and browser QR generator (`public/vendor/`).
- **Host Game Engine (`public/js/shared/`, `public/js/hostController.js`)** — Runs inside the 1st player's phone browser (`StickmanShowdownEngine`), handling drop-in, gun drops & pickup, camera-relative movement (stick "up" = away from you, wherever you stand), jump dodging, shooting, and win tracking.
- **Cloud Relay (`cloudflare-worker/`)** — Lightweight Cloudflare Worker + SQLite-backed Durable Object (`TabletopRoom`). Hashes `CF-Connecting-IP` so everyone on the same Wi-Fi automatically lands in the same room (and supports `?room=...` via Invite QR for friends on 5G). Zero game compute on the server; promotes the next player automatically if the Host leaves.
- **Local Dev/LAN Server (`server/`)** — Runs the exact same relay protocol locally over HTTPS/WSS (`npm start`) for offline testing on your own machine or LAN.

- **AR Engine (`public/lib/plinth/`)**: **Plinth**, a reusable web AR library modelled on how 8th Wall's engine works. It provides frame-synchronized camera rendering, IMU-seeded visual tracking that keeps the board fixed when the QR leaves view or you walk around the table, automatic metric scale from the printed QR, tap-to-place on the table for solo play, and gestures. See [`public/lib/plinth/README.md`](public/lib/plinth/README.md) and the research notes in [`docs/RESEARCH.md`](public/lib/plinth/docs/RESEARCH.md). Try the standalone demo at `/lib/plinth/examples/place.html`.

### Tests
```bash
npm test                  # Plinth unit + tracking-accuracy tests (Node)
npm run test:ar:browser   # full WebGL/worker pipeline in headless Chromium (needs Playwright)
npm run bench:ar          # accuracy report on rendered camera trajectories
```

---

## Option A: Deploy to GitHub Pages + Cloudflare Worker (Bypasses Hotel/Corporate Wi-Fi)

### 1. Deploy the free Cloudflare Worker Relay
```bash
cd cloudflare-worker
npx wrangler login
npx wrangler deploy
```
Copy the printed `https://tabletop-ar-relay.<your-subdomain>.workers.dev` URL.

### 2. Configure the Relay URL & Push to GitHub Pages
Set `DEFAULT_RELAY_URL` in `public/js/config.js`:
```js
export const DEFAULT_RELAY_URL = 'wss://tabletop-ar-relay.<your-subdomain>.workers.dev/ws';
```
*(Or paste it directly into the **Cloud Relay URL** box in the Suite lobby!)*

Then push this repo to GitHub (`main` branch) and enable **Settings → Pages → Source: GitHub Actions**.

### 3. Play on Any Wi-Fi
1. Print `./anchor.html` and place the QR anchor flat on the table.
2. First player opens your GitHub Pages URL on their phone → automatically becomes **Host**.
3. Friends on the same Wi-Fi open the same URL (or scan **Invite QR** if on 5G/hotspot) → drop in and fight!

---

## Option B: Run Locally (`npm start`)
```bash
npm start
```
- Desktop Preview: `http://localhost:3000/`
- Print Anchor Sheet: `http://localhost:3000/anchor`
- Mobile LAN AR: `https://<your-lan-ip>:3443/`
