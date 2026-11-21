import * as THREE from '../../vendor/three/three.module.js';
import { sound } from '../audio.js';
import { drawPixelText, drawPixelTextCentered, pixelTextWidth } from './pixelFont.js';

/**
 * Pixel Hoops renderer: original late-80s streetball look in smooth
 * low-poly 3D. Lanky ballers with jointed limbs, tank tops, striped tube
 * socks and high-tops, on a polished hardwood half court with a real rim
 * and net. Only the scoreboard keeps a retro dot-matrix display.
 */

const SKIN_TONES = [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0x5c3a1e, 0xa86b3c, 0xffdbac];
const HAIR_COLORS = [0x1a1a1a, 0x3b2314, 0x6b3e1f, 0xc99a45, 0x2b1b10, 0x8a3b12];
const HAIR_STYLES = ['short', 'flattop', 'curly', 'buzz', 'mullet'];

// 3x5 digits for the dot-matrix scoreboard.
const DIGITS = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};

function drawPixelNumber(ctx, num, x, y, px, color) {
  ctx.fillStyle = color;
  String(num).split('').forEach((ch, ci) => {
    const rows = DIGITS[ch];
    if (!rows) return;
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < 3; rx++) {
        if (row[rx] === '1') ctx.fillRect(x + (ci * 4 + rx) * px, y + ry * px, px - 0.4, px - 0.4);
      }
    });
  });
}

function canvasTexture(w, h, draw, { smooth = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  if (smooth) {
    tex.anisotropy = 4;
  } else {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
  }
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ---- Retro rendering: 3-step cel shading and inverted-hull black outlines.
let toonRamp = null;
function toonGradient() {
  if (!toonRamp) {
    toonRamp = new THREE.DataTexture(new Uint8Array([70, 160, 255]), 3, 1, THREE.RedFormat);
    toonRamp.magFilter = THREE.NearestFilter;
    toonRamp.minFilter = THREE.NearestFilter;
    toonRamp.generateMipmaps = false;
    toonRamp.needsUpdate = true;
  }
  return toonRamp;
}

/** Cel-shaded material; PBR-only options are ignored. */
function toon(opts = {}) {
  const { roughness, metalness, flatShading, ...rest } = opts;
  return new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...rest });
}

function mat(color, opts = {}) {
  return toon({ color, ...opts });
}

const outlineMats = new Map();
function outlineMaterial(width) {
  if (!outlineMats.has(width)) {
    const m = new THREE.MeshBasicMaterial({ color: 0x0b0b14, side: THREE.BackSide });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position) + normalize(normal) * ${width.toFixed(4)};`
      );
    };
    m.customProgramCacheKey = () => `outline-${width}`;
    outlineMats.set(width, m);
  }
  return outlineMats.get(width);
}

/** Give every lit mesh under `root` a black back-face shell. */
function addOutlines(root, width = 0.012) {
  const targets = [];
  root.traverse((o) => {
    if (o.isMesh && !o.userData.noOutline && o.material && !o.material.isMeshBasicMaterial && !o.material.transparent) {
      targets.push(o);
    }
  });
  for (const m of targets) {
    const shell = new THREE.Mesh(m.geometry, outlineMaterial(width));
    shell.userData.noOutline = true;
    shell.castShadow = false;
    m.add(shell);
  }
}

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Cylinder hanging down from its pivot (top at y=0). */
function limb(rTop, rBot, len, material, seg = 7) {
  const geo = new THREE.CylinderGeometry(rTop, rBot, len, seg);
  geo.translate(0, -len / 2, 0);
  return mesh(geo, material);
}

let blobShadowTex = null;
function blobShadow(size, opacity, color = 0x000000) {
  if (!blobShadowTex) {
    blobShadowTex = canvasTexture(64, 64, (ctx) => {
      const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    });
  }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: blobShadowTex, color, transparent: true, opacity, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.012;
  return m;
}

function makeNameTexture(name, color, score, isSelf) {
  const text = `${isSelf ? '>' : ''}${name} ${score}`.slice(0, 20);
  return canvasTexture(128, 32, (ctx) => {
    const scale = pixelTextWidth(text, 1) <= 56 ? 2 : 1;
    const tw = pixelTextWidth(text, scale);
    ctx.fillStyle = '#0b0b14';
    ctx.fillRect(64 - tw / 2 - 5, 4, tw + 10, 22);
    ctx.fillStyle = color;
    ctx.fillRect(64 - tw / 2 - 5, 22, tw + 10, 4);
    drawPixelTextCentered(ctx, text, 64, 13, scale, '#ffffff');
  }, { smooth: false });
}

function jerseyTexture(color, number) {
  // Cylinder UVs here put the chest at u=0.25 and the back at u=0.75.
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    // Trim at the neckline and hem
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, 7);
    ctx.fillRect(0, h - 6, w, 6);
    for (const u of [0.25, 0.75]) {
      drawPixelTextCentered(ctx, String(number), u * w, h * 0.56, 8, '#ffffff');
    }
  }, { smooth: false });
}

function sockTexture(stripe) {
  return canvasTexture(16, 64, (ctx, w, h) => {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = stripe;
    ctx.fillRect(0, 6, w, 7);
    ctx.fillRect(0, 18, w, 5);
  });
}

function createBaller(player, isSelf) {
  const seed = hashString(player.id);
  const jerseyColor = new THREE.Color(player.color);
  const jerseyHex = `#${jerseyColor.getHexString()}`;
  const number = (seed % 54) + 1;
  const hairStyle = HAIR_STYLES[(seed >> 2) % HAIR_STYLES.length];
  const hasHeadband = (seed >> 5) % 2 === 0;

  const skin = mat(SKIN_TONES[seed % SKIN_TONES.length]);
  const hair = mat(HAIR_COLORS[(seed >> 3) % HAIR_COLORS.length], { roughness: 0.9 });
  const jersey = toon({ map: jerseyTexture(jerseyHex, number), roughness: 0.75 });
  const shortsMat = mat(jerseyColor.clone().multiplyScalar(0.82));
  const trim = mat(0xffffff);
  const sock = toon({ map: sockTexture(jerseyHex), roughness: 0.85 });
  const shoe = mat(0xf1f5f9, { roughness: 0.5 });
  const sole = mat(0x1f2937);
  const accent = mat(jerseyColor);
  const dark = mat(0x111111);

  const root = new THREE.Group();
  const shadow = blobShadow(0.7, isSelf ? 0.7 : 0.45, isSelf ? jerseyColor : 0x000000);
  root.add(shadow);
  if (isSelf) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.35, 32),
      new THREE.MeshBasicMaterial({ color: jerseyColor, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.016;
    root.add(ring);
  }

  const body = new THREE.Group(); // yaw + jump height
  root.add(body);
  const hips = new THREE.Group(); // crouch / lean pivot
  hips.position.y = 0.56;
  body.add(hips);

  // ---- Legs: hip -> thigh -> knee -> shin -> ankle -> high-top
  const makeLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.075, 0, 0);
    hips.add(hip);
    hip.add(limb(0.062, 0.05, 0.27, skin));
    const knee = new THREE.Group();
    knee.position.y = -0.27;
    hip.add(knee);
    knee.add(mesh(new THREE.SphereGeometry(0.05, 7, 5), skin));
    knee.add(limb(0.048, 0.038, 0.12, skin));
    const sockMesh = limb(0.042, 0.04, 0.13, sock);
    sockMesh.position.y = -0.11;
    knee.add(sockMesh);
    const foot = new THREE.Group();
    foot.position.y = -0.24;
    knee.add(foot);
    foot.add(mesh(new THREE.BoxGeometry(0.1, 0.075, 0.2), shoe, 0, -0.012, 0.035));
    foot.add(mesh(new THREE.BoxGeometry(0.104, 0.022, 0.21), sole, 0, -0.05, 0.035));
    foot.add(mesh(new THREE.BoxGeometry(0.105, 0.02, 0.1), accent, 0, 0.0, 0.02));
    return { hip, knee, foot };
  };
  const legL = makeLeg(1);
  const legR = makeLeg(-1);

  // ---- Shorts (one flared tube over both thighs) and torso
  shortsMat.side = THREE.DoubleSide;
  const shorts = mesh(new THREE.CylinderGeometry(0.15, 0.175, 0.2, 10, 1, true), shortsMat, 0, -0.06, 0);
  shorts.scale.z = 0.72;
  hips.add(shorts);
  const waistband = mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.035, 10), trim, 0, 0.04, 0);
  waistband.scale.z = 0.72;
  hips.add(waistband);

  const torsoGeo = new THREE.CylinderGeometry(0.17, 0.135, 0.36, 12, 1, false, -Math.PI / 2);
  const torso = mesh(torsoGeo, jersey, 0, 0.23, 0);
  torso.scale.z = 0.62;
  hips.add(torso);
  const chest = new THREE.Group();
  chest.position.y = 0.41;
  hips.add(chest);

  // ---- Arms: shoulder -> upper arm -> elbow -> forearm -> wristband -> hand
  const makeArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.2, 0, 0);
    chest.add(shoulder);
    shoulder.add(mesh(new THREE.SphereGeometry(0.052, 7, 5), skin));
    shoulder.add(limb(0.045, 0.038, 0.22, skin));
    const elbow = new THREE.Group();
    elbow.position.y = -0.22;
    shoulder.add(elbow);
    elbow.add(limb(0.037, 0.032, 0.2, skin));
    const band = limb(0.04, 0.04, 0.045, trim);
    band.position.y = -0.14;
    elbow.add(band);
    elbow.add(mesh(new THREE.SphereGeometry(0.045, 7, 5), skin, 0, -0.22, 0));
    return { shoulder, elbow };
  };
  const armL = makeArm(1);
  const armR = makeArm(-1);

  // ---- Neck and head
  chest.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 7), skin, 0, 0.03, 0));
  const head = new THREE.Group();
  head.position.y = 0.15;
  chest.add(head);
  const skull = mesh(new THREE.SphereGeometry(0.105, 10, 8), skin);
  skull.scale.set(0.92, 1.08, 1);
  head.add(skull);
  head.add(mesh(new THREE.SphereGeometry(0.025, 5, 4), skin, 0.1, -0.005, 0));
  head.add(mesh(new THREE.SphereGeometry(0.025, 5, 4), skin, -0.1, -0.005, 0));
  head.add(mesh(new THREE.BoxGeometry(0.022, 0.026, 0.01), dark, 0.037, 0.015, 0.1));
  head.add(mesh(new THREE.BoxGeometry(0.022, 0.026, 0.01), dark, -0.037, 0.015, 0.1));
  head.add(mesh(new THREE.BoxGeometry(0.03, 0.04, 0.03), skin, 0, -0.01, 0.105));

  const hairCap = (r, sy, y, z = -0.005) => {
    const cap = mesh(new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, y, z);
    cap.scale.y = sy;
    head.add(cap);
  };
  switch (hairStyle) {
    case 'flattop':
      hairCap(0.108, 0.9, 0.012);
      head.add(mesh(new THREE.BoxGeometry(0.19, 0.1, 0.19), hair, 0, 0.1, -0.01));
      break;
    case 'curly':
      hairCap(0.13, 1.0, 0.0, -0.015);
      break;
    case 'buzz':
      hairCap(0.107, 0.75, 0.018);
      break;
    case 'mullet':
      hairCap(0.11, 0.95, 0.01);
      head.add(mesh(new THREE.BoxGeometry(0.16, 0.14, 0.05), hair, 0, -0.05, -0.085));
      break;
    default:
      hairCap(0.11, 0.85, 0.014);
  }
  if (hasHeadband) {
    const headband = mesh(new THREE.CylinderGeometry(0.108, 0.108, 0.03, 12, 1, true), mat(0xffffff, { side: THREE.DoubleSide }), 0, 0.05, 0);
    head.add(headband);
  }

  const labelSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: makeNameTexture(player.name, player.color, player.score, isSelf), transparent: true, depthTest: false })
  );
  labelSprite.position.set(0, 1.55, 0);
  labelSprite.scale.set(1.1, 0.275, 1);
  body.add(labelSprite);
  addOutlines(body, 0.011);

  return {
    root,
    body,
    hips,
    chest,
    head,
    shadow,
    legL,
    legR,
    armL,
    armR,
    labelSprite,
    labelKey: '',
    targetX: player.x,
    targetY: player.y,
    targetZ: player.z,
    targetYaw: player.yaw,
  };
}

function createBall() {
  const tex = canvasTexture(256, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#f08a3c');
    g.addColorStop(1, '#d9661f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1c0f06';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    for (const x of [w * 0.25, w * 0.75]) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    ctx.stroke();
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const y = h / 2 + Math.sin((x / w) * Math.PI * 4) * h * 0.32;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 24, 16),
    toon({ map: tex, roughness: 0.75 })
  );
  ball.castShadow = true;
  addOutlines(ball, 0.009);
  return ball;
}

// ---- Chiptune sound effects (square/triangle waves + noise, NES-era style)
const N = { C4: 261.6, E4: 329.6, G4: 392.0, A4: 440.0, B4: 493.9, C5: 523.3, D5: 587.3, E5: 659.3, F5: 698.5, G5: 784.0, A5: 880.0, C6: 1046.5, E6: 1318.5, G6: 1568.0 };
const sfx = {
  swish: () => sound.playNoise({ duration: 0.28, freq: 4200, q: 0.6, gain: 0.1 }),
  two: () => sound.playNotes([[N.C5], [N.E5], [N.G5, 2]], { step: 0.06 }),
  three: () => sound.playNotes([[N.C5], [N.E5], [N.G5], [N.C6, 3]], { step: 0.06 }),
  slam: () => {
    sound.playNoise({ duration: 0.35, freq: 180, q: 0.7, gain: 0.25, type: 'lowpass' });
    sound.playNotes([[N.G4], [N.C5], [N.E5], [N.G5], [N.C6], [0], [N.C6, 3]], { step: 0.055, gain: 0.1 });
  },
  clank: () => sound.playNotes([[1250, 0.6], [0, 0.3], [980, 1.2]], { type: 'square', step: 0.05, gain: 0.07 }),
  block: () => sound.playNotes([[N.A5], [N.E5], [N.C5], [N.A4, 2]], { type: 'square', step: 0.045, gain: 0.1 }),
  steal: () => sound.playNotes([[N.E5], [N.A5], [N.E6, 2]], { type: 'square', step: 0.045, gain: 0.09 }),
  juke: () => sound.playNotes([[N.C5, 0.5], [N.G5, 0.5], [N.C6, 0.5]], { type: 'triangle', step: 0.04, gain: 0.12 }),
  jump: () => sound.playNotes([[N.C4, 0.5], [N.G4, 0.5], [N.C5, 0.5]], { type: 'square', step: 0.035, gain: 0.06 }),
  swipe: () => sound.playNoise({ duration: 0.08, freq: 1800, q: 1.2, gain: 0.07 }),
  bounce: () => sound.playNotes([[110, 1]], { type: 'triangle', step: 0.06, gain: 0.16 }),
  whistle: () => sound.playNotes([[2400, 1.5], [0, 0.5], [2400, 3]], { type: 'sine', step: 0.06, gain: 0.06 }),
  tipoff: () => sound.playNotes([[N.C5], [N.C5], [N.G5, 2], [N.E5], [N.G5, 3]], { step: 0.09, gain: 0.08 }),
  perfect: () => sound.playNotes([[N.E6, 0.5], [N.G6, 1]], { type: 'square', step: 0.05, gain: 0.05 }),
  win: () => sound.playNotes(
    [[N.C5], [N.E5], [N.G5], [N.C6, 2], [N.G5], [N.C6, 4], [0], [N.A5], [N.F5], [N.D5], [N.G5, 6]],
    { step: 0.1, gain: 0.09 }
  ),
};

export class PixelHoopsClient {
  constructor(boardRoot, config, selfPlayerId) {
    this.boardRoot = boardRoot;
    this.config = config;
    this.selfPlayerId = selfPlayerId;
    this.group = new THREE.Group();
    this.boardRoot.add(this.group);
    this.visuals = new Map();
    this.particles = [];
    this.popups = [];
    this.netShake = 0;
    this.rimShake = 0;
    this.lastState = null;

    this.controlLabels = { jump: 'JUKE', shoot: 'SHOOT', badge: '' };

    this._buildCourt(config);
    this.ball = createBall();
    this.group.add(this.ball);
    this.ballShadow = blobShadow(0.3, 0.45);
    this.group.add(this.ballShadow);
    this.ballTarget = new THREE.Vector3(0, 0.5, 0);
    sfx.tipoff();
  }

  _buildCourt(cfg) {
    const w = cfg.courtWidth;
    const d = cfg.courtDepth;
    const hoop = cfg.hoop;
    const PX = 48; // texture pixels per board unit
    const APRON = 0.3; // out-of-bounds border, in board units

    const courtTex = canvasTexture(w * PX, d * PX, (ctx, cw, ch) => {
      const toPx = (x, z) => [(x + w / 2) * PX, (z + d / 2) * PX];

      // Maple boards running toward the hoop, with staggered joints.
      const boardW = 0.11 * PX;
      let seed = 7;
      const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      for (let x = 0, i = 0; x < cw; x += boardW, i++) {
        let y = -rnd() * 3 * PX;
        while (y < ch) {
          const len = (1.6 + rnd() * 2.4) * PX;
          const l = 62 + rnd() * 7;
          ctx.fillStyle = `hsl(${30 + rnd() * 4}, ${52 + rnd() * 8}%, ${l}%)`;
          ctx.fillRect(x, y, boardW, len);
          ctx.fillStyle = 'rgba(110, 60, 20, 0.35)';
          ctx.fillRect(x, y, boardW, 1);
          y += len;
        }
        ctx.fillStyle = 'rgba(110, 60, 20, 0.22)';
        ctx.fillRect(x, 0, 1, ch);
      }
      // Soft varnish sheen
      const sheen = ctx.createRadialGradient(cw / 2, ch * 0.45, 10, cw / 2, ch * 0.45, cw * 0.7);
      sheen.addColorStop(0, 'rgba(255,255,255,0.14)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, cw, ch);

      // Apron (out of bounds)
      const ap = APRON * PX;
      ctx.fillStyle = '#8c1d2c';
      ctx.fillRect(0, 0, cw, ap);
      ctx.fillRect(0, ch - ap, cw, ap);
      ctx.fillRect(0, 0, ap, ch);
      ctx.fillRect(cw - ap, 0, ap, ch);

      const [hx, hz] = toPx(hoop.x, hoop.z);
      const baseline = ap;
      // Painted lane
      // Key proportions follow a regulation court, scaled to the 3-point radius:
      // free-throw line ~58% of the arc distance, circle radius ~25%, lane ~53% wide.
      const r3u = cfg.threePtRadius;
      const laneW = r3u * 0.53 * PX;
      const ftDist = r3u * 0.58;
      const ftR = r3u * 0.25 * PX;
      const ftLine = hz + ftDist * PX;
      ctx.fillStyle = '#8c1d2c';
      ctx.fillRect(hx - laneW / 2, baseline, laneW, ftLine - baseline);

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.05 * PX;
      ctx.lineJoin = 'round';
      // Lane outline + free throw circle
      ctx.strokeRect(hx - laneW / 2, baseline, laneW, ftLine - baseline);
      ctx.beginPath();
      ctx.arc(hx, ftLine, ftR, 0, Math.PI);
      ctx.stroke();
      ctx.setLineDash([0.18 * PX, 0.14 * PX]);
      ctx.beginPath();
      ctx.arc(hx, ftLine, ftR, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Lane hash marks
      for (const k of [0.4, 0.62, 0.84].map((f) => f * ftDist)) {
        ctx.beginPath();
        ctx.moveTo(hx - laneW / 2, hz + k * PX);
        ctx.lineTo(hx - laneW / 2 - 0.15 * PX, hz + k * PX);
        ctx.moveTo(hx + laneW / 2, hz + k * PX);
        ctx.lineTo(hx + laneW / 2 + 0.15 * PX, hz + k * PX);
        ctx.stroke();
      }
      // Restricted arc
      ctx.beginPath();
      ctx.arc(hx, hz, r3u * 0.17 * PX, 0, Math.PI);
      ctx.stroke();
      // Three-point line: straight corners into the arc
      const r3 = cfg.threePtRadius * PX;
      const cornerX = Math.min(r3 * 0.94, cw / 2 - ap - 0.25 * PX);
      const a = Math.asin(cornerX / r3);
      const cornerZ = hz + Math.cos(a) * r3;
      ctx.beginPath();
      ctx.moveTo(hx - cornerX, baseline);
      ctx.lineTo(hx - cornerX, cornerZ);
      ctx.arc(hx, hz, r3, Math.PI / 2 + a, Math.PI / 2 - a, true);
      ctx.lineTo(hx + cornerX, baseline);
      ctx.stroke();
      // Boundary
      ctx.strokeRect(ap, ap, cw - ap * 2, ch - ap * 2);
      // Half-court circle with an original center logo
      ctx.beginPath();
      ctx.arc(cw / 2, ch - ap, 1.2 * PX, Math.PI, Math.PI * 2);
      ctx.fillStyle = 'rgba(140, 29, 44, 0.85)';
      ctx.fill();
      ctx.stroke();
      drawPixelTextCentered(ctx, 'HOOPS', cw / 2, ch - ap - 0.55 * PX, 4, '#ffd23f', '#3b0a12');
      // Check-ball spot
      const [cx, cz] = toPx(cfg.checkSpot.x, cfg.checkSpot.z);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cz, 0.06 * PX, 0, Math.PI * 2);
      ctx.fill();
      // Apron lettering
      drawPixelTextCentered(ctx, 'TABLETOP STREETBALL LEAGUE', cw / 2, ch - ap / 2, 2, '#ffffff');
    });

    const slab = 0.16;
    const sideMat = toon({ color: 0x3a1f10, roughness: 0.6 });
    const floorMat = toon({ map: courtTex, roughness: 0.38, metalness: 0.05 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, slab, d), [sideMat, sideMat, floorMat, sideMat, sideMat, sideMat]);
    floor.position.y = -slab / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // ---- Hoop: padded base, curved support arm, glass-style board, rim and net
    const hoopGroup = new THREE.Group();
    this.group.add(hoopGroup);
    const bbZ = cfg.backboardZ;
    const poleZ = bbZ - 0.5;
    const steel = toon({ color: 0x2d3340, roughness: 0.4, metalness: 0.6 });
    const pad = toon({ color: 0x8c1d2c, roughness: 0.8 });
    const base = mesh(new THREE.BoxGeometry(0.55, 0.22, 0.4), pad, hoop.x, 0.11, poleZ - 0.05);
    hoopGroup.add(base);
    const poleH = hoop.rimY + 0.35;
    hoopGroup.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, poleH, 12), steel, hoop.x, poleH / 2, poleZ));
    hoopGroup.add(mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.7, 12), pad, hoop.x, 0.55, poleZ));
    const arm = mesh(new THREE.CylinderGeometry(0.035, 0.035, bbZ - poleZ, 8), steel, hoop.x, poleH - 0.05, (bbZ + poleZ) / 2);
    arm.rotation.x = Math.PI / 2;
    hoopGroup.add(arm);

    const boardTex = canvasTexture(260, 160, (ctx, cw, ch) => {
      ctx.fillStyle = 'rgba(235, 245, 255, 0.55)';
      ctx.fillRect(0, 0, cw, ch);
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 10;
      ctx.strokeRect(5, 5, cw - 10, ch - 10);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6;
      ctx.strokeRect(cw * 0.33, ch * 0.42, cw * 0.34, ch * 0.42);
    });
    const glass = toon({ map: boardTex, transparent: true, roughness: 0.15, metalness: 0.1 });
    const backboard = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.03), glass);
    backboard.position.set(hoop.x, hoop.rimY + 0.3, bbZ);
    hoopGroup.add(backboard);

    this.rim = new THREE.Group();
    this.rim.position.set(hoop.x, hoop.rimY, hoop.z);
    const rimMat = toon({ color: 0xff5a1f, roughness: 0.35, metalness: 0.5 });
    const torus = mesh(new THREE.TorusGeometry(hoop.rimRadius, 0.016, 8, 32), rimMat);
    torus.rotation.x = Math.PI / 2;
    this.rim.add(torus);
    const bracketLen = hoop.z - bbZ - hoop.rimRadius;
    const bracket = mesh(new THREE.BoxGeometry(0.08, 0.03, bracketLen), rimMat, 0, 0, -hoop.rimRadius - bracketLen / 2);
    this.rim.add(bracket);
    hoopGroup.add(this.rim);

    // Net: diamond lattice that narrows toward the bottom.
    this.net = new THREE.Group();
    this.net.position.set(hoop.x, hoop.rimY, hoop.z);
    const rows = 5;
    const cols = 14;
    const netDepth = 0.42;
    const pts = [];
    const ringPt = (row, col) => {
      const t = row / rows;
      const r = hoop.rimRadius * (1 - t * 0.42);
      const ang = ((col + (row % 2) * 0.5) / cols) * Math.PI * 2;
      return new THREE.Vector3(Math.sin(ang) * r, -t * netDepth, Math.cos(ang) * r);
    };
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const p = ringPt(row, col);
        // Each knot links to the two below it, making diamonds.
        const below = row % 2 === 0 ? [col - 1, col] : [col, col + 1];
        for (const c of below) pts.push(p, ringPt(row + 1, (c + cols) % cols));
      }
    }
    this.net.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
    ));
    hoopGroup.add(this.net);
    addOutlines(hoopGroup, 0.014);

    // Dot-matrix scoreboard on top of the backboard
    this.scoreCanvas = document.createElement('canvas');
    this.scoreCanvas.width = 128;
    this.scoreCanvas.height = 48;
    this.scoreTex = new THREE.CanvasTexture(this.scoreCanvas);
    this.scoreTex.colorSpace = THREE.SRGBColorSpace;
    const sbMat = new THREE.MeshBasicMaterial({ map: this.scoreTex });
    const sbFrame = toon({ color: 0x111827, roughness: 0.5 });
    const scoreboard = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.45, 0.06), [sbFrame, sbFrame, sbFrame, sbFrame, sbMat, sbFrame]);
    scoreboard.position.set(hoop.x, hoop.rimY + 0.98, bbZ - 0.03);
    hoopGroup.add(scoreboard);
    hoopGroup.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), steel, hoop.x, hoop.rimY + 0.72, bbZ - 0.05));
    this.scoreKey = '';

    // Sideline bench for players waiting their turn
    const benchWood = toon({ color: 0x6b4423, roughness: 0.7 });
    const bx = -w / 2 + 1.9;
    const bz = d / 2 - 0.15;
    this.group.add(mesh(new THREE.BoxGeometry(3.4, 0.05, 0.26), benchWood, bx, 0.26, bz));
    for (const ox of [-1.55, 0, 1.55]) {
      this.group.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.24, 6), steel, bx + ox, 0.12, bz));
    }
  }

  _drawScoreboard(players) {
    const court = players.filter((p) => p.role === 'court');
    const key = court.map((p) => `${p.id}:${p.score}`).join('|');
    if (key === this.scoreKey) return;
    this.scoreKey = key;
    const ctx = this.scoreCanvas.getContext('2d');
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, 128, 48);
    // Unlit dot grid
    ctx.fillStyle = '#1a1c26';
    for (let y = 1; y < 48; y += 3) for (let x = 1; x < 128; x += 3) ctx.fillRect(x, y, 2, 2);
    [court[0], court[1]].forEach((p, i) => {
      if (!p) return;
      const x0 = i === 0 ? 6 : 70;
      ctx.fillStyle = p.color;
      ctx.fillRect(x0, 4, 52, 5);
      const s = String(p.score);
      const textW = s.length * 16 - 4;
      drawPixelNumber(ctx, s, x0 + 26 - textW / 2, 15, 4, '#ffd23f');
    });
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(62, 20, 4, 4);
    ctx.fillRect(62, 31, 4, 4);
    this.scoreTex.needsUpdate = true;
  }

  _burst(x, y, z, color, count = 10, speed = 2.6, size = 0.06) {
    const geo = new THREE.OctahedronGeometry(size * 0.7, 0);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }));
      m.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2;
      const spd = (0.4 + Math.random() * 0.8) * speed;
      this.group.add(m);
      this.particles.push({ mesh: m, vx: Math.cos(a) * spd, vy: (0.5 + Math.random()) * speed * 0.7, vz: Math.sin(a) * spd, life: 0.5 + Math.random() * 0.3, maxLife: 0.8 });
    }
  }

  _popup(text, color, x, y, z, size = 1) {
    const tex = canvasTexture(192, 32, (ctx) => {
      const scale = pixelTextWidth(text, 3) <= 182 ? 3 : 2;
      // Thick arcade outline: stamp the text in black around itself.
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [2, 2]]) {
        drawPixelTextCentered(ctx, text, 96 + ox * scale, 16 + oy * scale, scale, '#0b0b14');
      }
      drawPixelTextCentered(ctx, text, 96, 16, scale, color);
    }, { smooth: false });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.position.set(x, y, z);
    sprite.scale.set(2.7 * size, 0.45 * size, 1);
    this.group.add(sprite);
    this.popups.push({ sprite, life: size < 1 ? 0.9 : 1.3 });
  }

  applyState(state) {
    this.lastState = state;
    const seen = new Set();
    for (const p of state.players) {
      seen.add(p.id);
      let vis = this.visuals.get(p.id);
      const isSelf = p.id === this.selfPlayerId;
      if (!vis) {
        vis = createBaller(p, isSelf);
        this.group.add(vis.root);
        this.visuals.set(p.id, vis);
      }
      vis.targetX = p.x;
      vis.targetY = p.y;
      vis.targetZ = p.z;
      vis.targetYaw = p.yaw;
      vis.state = p;

      const key = `${p.name}|${p.score}`;
      if (key !== vis.labelKey) {
        vis.labelKey = key;
        vis.labelSprite.material.map.dispose();
        vis.labelSprite.material.map = makeNameTexture(p.name, p.color, p.score, isSelf);
        vis.labelSprite.material.needsUpdate = true;
      }
    }
    for (const [id, vis] of this.visuals) {
      if (!seen.has(id)) {
        this.group.remove(vis.root);
        this.visuals.delete(id);
      }
    }

    this.ballTarget.set(state.ball.x, state.ball.y, state.ball.z);
    this.ballState = state.ball.state;
    this.ballSpin = state.ball.spin;
    this._drawScoreboard(state.players);

    // Controls follow possession: offense = JUKE / SHOOT, defense = BLOCK / STEAL.
    const me = state.players.find((p) => p.id === this.selfPlayerId);
    if (me && me.role === 'court') {
      const offense = state.offenseId === me.id;
      this.controlLabels = offense
        ? { jump: 'JUKE', shoot: 'SHOOT', badge: 'HOLD + RELEASE', armed: true }
        : { jump: 'BLOCK', shoot: 'STEAL', badge: 'DEFENSE', armed: true };
    } else {
      this.controlLabels = { jump: '—', shoot: '—', badge: 'NEXT UP', armed: false };
    }

    const hoop = this.config.hoop;
    for (const ev of state.events || []) {
      switch (ev.type) {
        case 'score': {
          this.netShake = 1;
          this._burst(hoop.x, hoop.rimY - 0.2, hoop.z, ev.color, ev.dunk ? 24 : 14, 2.4);
          this._popup(ev.dunk ? ev.moveName || 'SLAM!' : ev.points === 3 ? '3 PTS!' : '2 PTS', ev.color, hoop.x, hoop.rimY + 0.7, hoop.z + 0.4);
          sfx.swish();
          if (ev.dunk) sfx.slam();
          else if (ev.points === 3) sfx.three();
          else sfx.two();
          break;
        }
        case 'move':
          // Name the move over the player's head (dunk names show on the score).
          if (!['power', 'tomahawk', 'windmill', 'reverse'].includes(ev.move)) {
            this._popup(ev.name, '#7dd3fc', ev.x, (ev.y || 0) + 1.9, ev.z, 0.75);
          }
          break;
        case 'rim_shake':
          this.rimShake = 1;
          break;
        case 'clank':
          this.rimShake = 0.6;
          this._burst(ev.x, ev.y, ev.z, 0xff5a1f, 6, 1.6, 0.04);
          sfx.clank();
          break;
        case 'block':
          this._burst(ev.x, ev.y, ev.z, 0xffffff, 12, 3.0);
          this._popup('BLOCKED!', '#ff3b30', ev.x, ev.y + 0.6, ev.z);
          sfx.block();
          break;
        case 'steal':
          this._burst(ev.x, 0.5, ev.z, 0xffd23f, 10, 2.4);
          this._popup('STEAL!', '#ffd23f', ev.x, 1.6, ev.z);
          sfx.steal();
          break;
        case 'swipe':
          if (ev.playerId === this.selfPlayerId) sfx.swipe();
          break;
        case 'juke':
          this._burst(ev.x, 0.05, ev.z, 0xe2e8f0, 6, 1.4, 0.05);
          if (ev.playerId === this.selfPlayerId) sfx.juke();
          break;
        case 'jump':
        case 'shot_rise':
        case 'dunk_start':
          if (ev.playerId === this.selfPlayerId) sfx.jump();
          break;
        case 'shot':
          if (ev.playerId === this.selfPlayerId && ev.timing > 0.85) {
            this._popup('PERFECT', '#4ade80', ev.x, ev.y + 0.5, ev.z);
            sfx.perfect();
          }
          break;
        case 'bounce':
          sfx.bounce();
          break;
        case 'check':
          this._popup('CHECK BALL', '#ffffff', this.config.checkSpot.x, 1.8, this.config.checkSpot.z);
          sfx.whistle();
          break;
        case 'round_over':
          sfx.win();
          break;
        default:
          break;
      }
    }
  }

  getHudPlayers(state) {
    const win = this.config.winScore || 11;
    return state.players.map((p) => ({
      id: p.id,
      name: `${p.name} ${p.score}${p.hasBall ? ' 🏀' : ''}`,
      color: p.color,
      hp: p.score,
      maxHp: win,
      alive: p.role === 'court',
    }));
  }

  _animateBaller(vis, dt, time) {
    const p = vis.state;
    if (!p) return;
    const air = vis.body.position.y > 0.05;
    const running = p.speed > 0.2 && !air;
    const ph = p.animPhase;
    const onDefense = p.role === 'court' && !p.onOffense && !p.hasBall;

    // ---- Lower body
    let crouch = 0;
    let lean = 0;
    let spread = 0;
    const legs = { L: { hip: 0, knee: 0 }, R: { hip: 0, knee: 0 } };
    if (air) {
      legs.L = { hip: -0.55, knee: 1.0 };
      legs.R = { hip: -0.15, knee: 0.45 };
    } else if (running) {
      const s = Math.sin(ph);
      legs.L = { hip: s * 0.75, knee: 0.25 + Math.max(0, Math.sin(ph + 1.6)) * 1.1 };
      legs.R = { hip: -s * 0.75, knee: 0.25 + Math.max(0, Math.sin(ph + 1.6 + Math.PI)) * 1.1 };
      lean = 0.12;
    }
    if (p.hasBall && !air) { crouch = 0.35; lean += 0.1; }
    if (onDefense && !air && p.action !== 'steal') { crouch = 0.8; spread = 0.22; lean = 0.18; }
    if (p.action === 'stumble') lean = 0.35 + Math.sin(time * 25) * 0.08;
    const prog = p.actionP || 0;
    if (p.action === 'shoot' && p.move === 'fadeaway') lean = -0.35;
    if (p.action === 'layup') {
      // Knee drive off one foot.
      legs.L = { hip: -1.25, knee: 1.5 };
      legs.R = { hip: 0.2, knee: 0.3 };
    }
    if (p.action === 'dunk' && (p.move === 'tomahawk' || p.move === 'windmill')) {
      legs.L = { hip: -1.0, knee: 1.6 };
      legs.R = { hip: 0.35, knee: 1.1 };
      lean = p.move === 'tomahawk' ? (prog < 0.6 ? -0.25 : 0.25) : 0.1;
    }
    if (p.action === 'dunk' && p.move === 'reverse') lean = -0.3;
    if (p.action === 'pumpfake') { crouch = 0.25; lean = -0.05; }
    if (p.action === 'crossover') { crouch = 0.6; lean = 0.25; }
    if (p.action === 'spin') { crouch = 0.4; lean = 0.15; }
    vis.spin = p.action === 'spin' ? prog * Math.PI * 2 * (p.ballHand < 0 ? -1 : 1) : 0;

    const bend = crouch * 0.55;
    for (const [key, leg] of [['L', vis.legL], ['R', vis.legR]]) {
      const side = key === 'L' ? 1 : -1;
      const hip = legs[key].hip - bend;
      const knee = legs[key].knee + bend * 2;
      leg.hip.rotation.set(hip, 0, side * spread);
      leg.knee.rotation.x = knee;
      leg.foot.rotation.x = air ? 0.5 : -(hip + knee) * 0.9;
      leg.foot.rotation.z = -side * spread;
    }
    vis.hips.position.y = 0.56 - (1 - Math.cos(bend)) * 0.5 - spread * 0.05;
    vis.hips.rotation.x = lean;

    // ---- Upper body: [shoulderX, shoulderZ(outward), elbow]
    let L = [0.08, 0.12, -0.15];
    let R = [0.08, 0.12, -0.15];
    const wave = Math.sin(time * 16);
    switch (p.action) {
      case 'shoot':
        if (p.move === 'hook') {
          // Ball arm swept up over the head, off arm out to shield the defender.
          const sweep = Math.min(1, prog * 2.2);
          const ballArm = [-0.3 - sweep * 0.2, 0.6 + sweep * 2.2, -0.15];
          const offArm = [-1.2, 1.1, -0.6];
          if (p.ballHand < 0) { R = ballArm; L = offArm; } else { L = ballArm; R = offArm; }
        } else {
          L = [-2.35, 0.25, -0.9];
          R = [-2.55, 0.1, -1.0];
        }
        break;
      case 'layup':
        R = [-2.6 - prog * 0.3, 0.1, -0.15];
        L = [-0.9, 0.5, -0.6];
        break;
      case 'dunk':
        if (p.move === 'windmill') {
          // Ball arm makes a full circle; matches the engine's ball path.
          const a = prog * Math.PI * 2 + Math.PI / 2;
          R = [-(a + Math.PI / 2), 0.15, -0.05];
          L = [-1.6, 0.7, -0.3];
        } else if (p.move === 'tomahawk') {
          R = prog < 0.6 ? [-3.5, 0.1, -1.6] : [-3.5 + (prog - 0.6) * 3.2, 0.1, -1.6 + (prog - 0.6) * 3.6];
          L = [-1.4, 0.6, -0.4];
        } else if (p.move === 'reverse') {
          L = [-3.3, 0.2, -0.1];
          R = [-3.3, 0.2, -0.1];
        } else {
          L = [-2.9, 0.15, -0.2];
          R = [-2.9, 0.15, -0.2];
        }
        break;
      case 'pumpfake': {
        const up = Math.sin(prog * Math.PI);
        L = [-0.9 - up * 1.4, 0.2, -1.2 + up * 0.5];
        R = [-0.9 - up * 1.4, 0.2, -1.2 + up * 0.5];
        break;
      }
      case 'crossover':
        L = [-0.5, 0.5, -0.5];
        R = [-0.5, 0.5, -0.5];
        break;
      case 'spin':
        L = [-0.5, 0.9, -0.6];
        R = [-0.5, 0.9, -0.6];
        break;
      case 'block':
        L = [-3.0, 0.25, 0];
        R = [-3.0, 0.25, 0];
        break;
      case 'steal':
        L = [-0.4, 0.3, -0.3];
        R = [-1.35, 0.15, -0.15];
        break;
      case 'celebrate':
        L = [-2.8 + wave * 0.25, 0.5, -0.3];
        R = [-2.8 - wave * 0.25, 0.5, -0.3];
        break;
      case 'stumble':
        L = [-1.2 + wave * 0.6, 0.9, -0.4];
        R = [-0.6 - wave * 0.6, 0.9, -0.4];
        break;
      default:
        if (p.hasBall) {
          const bounce = Math.abs(Math.sin(ph * 1.6));
          const dribble = [-0.55 + bounce * 0.35, 0.25, -0.75 + bounce * 0.3];
          const guard = [-0.95, 0.55, -0.9];
          if (p.ballHand < 0) { R = dribble; L = guard; } else { L = dribble; R = guard; }
        } else if (onDefense) {
          const shuffle = running ? Math.sin(ph) * 0.1 : 0;
          L = [-0.35, 1.15 + shuffle, -0.5];
          R = [-0.35, 1.15 - shuffle, -0.5];
        } else if (running) {
          const s = Math.sin(ph);
          L = [-s * 0.7, 0.12, -0.9];
          R = [s * 0.7, 0.12, -0.9];
        }
    }
    vis.armL.shoulder.rotation.set(L[0], 0, L[1]);
    vis.armL.elbow.rotation.x = L[2];
    vis.armR.shoulder.rotation.set(R[0], 0, -R[1]);
    vis.armR.elbow.rotation.x = R[2];
    vis.head.rotation.x = -lean * 0.8 + (['shoot', 'dunk', 'layup', 'pumpfake'].includes(p.action) ? -0.25 : 0);
  }

  update(dt) {
    const time = performance.now() / 1000;
    const smooth = Math.min(1, dt * 18);
    for (const vis of this.visuals.values()) {
      vis.root.position.x += (vis.targetX - vis.root.position.x) * smooth;
      vis.root.position.z += (vis.targetZ - vis.root.position.z) * smooth;
      vis.body.position.y += (vis.targetY - vis.body.position.y) * smooth;
      if (vis.yaw === undefined) vis.yaw = vis.targetYaw;
      let diff = vis.targetYaw - vis.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      vis.yaw += diff * smooth;
      vis.body.rotation.y = vis.yaw + (vis.spin || 0);
      vis.shadow.scale.setScalar(Math.max(0.45, 1 - vis.body.position.y * 0.3));
      this._animateBaller(vis, dt, time);
    }

    // Ball: snappier smoothing so the dribble keeps its bounce.
    const bs = Math.min(1, dt * 28);
    this.ball.position.lerp(this.ballTarget, bs);
    this.ball.rotation.x = this.ballSpin || 0;
    this.ball.rotation.z = (this.ballSpin || 0) * 0.5;
    this.ballShadow.position.x = this.ball.position.x;
    this.ballShadow.position.z = this.ball.position.z;
    this.ballShadow.scale.setScalar(Math.max(0.3, 1 - this.ball.position.y * 0.3));

    // Net swish and rim rattle
    if (this.netShake > 0) {
      this.netShake = Math.max(0, this.netShake - dt * 1.6);
      this.net.scale.set(1 - this.netShake * 0.25, 1 + this.netShake * 0.6, 1 - this.netShake * 0.25);
      this.net.rotation.y += dt * this.netShake * 10;
    } else {
      this.net.scale.set(1, 1, 1);
    }
    if (this.rimShake > 0) {
      this.rimShake = Math.max(0, this.rimShake - dt * 2.5);
      this.rim.rotation.x = Math.sin(time * 60) * 0.12 * this.rimShake;
    } else {
      this.rim.rotation.x = 0;
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        this.group.remove(pt.mesh);
        pt.mesh.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      pt.vy -= 9.5 * dt;
      pt.mesh.position.x += pt.vx * dt;
      pt.mesh.position.y = Math.max(0.03, pt.mesh.position.y + pt.vy * dt);
      pt.mesh.position.z += pt.vz * dt;
      pt.mesh.rotation.x += dt * 8;
      pt.mesh.material.opacity = Math.max(0, pt.life / pt.maxLife);
    }

    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pop = this.popups[i];
      pop.life -= dt;
      if (pop.life <= 0) {
        this.group.remove(pop.sprite);
        pop.sprite.material.map.dispose();
        pop.sprite.material.dispose();
        this.popups.splice(i, 1);
        continue;
      }
      pop.sprite.position.y += dt * 0.5;
      pop.sprite.material.opacity = Math.min(1, pop.life * 2);
    }
  }

  dispose() {
    this.boardRoot.remove(this.group);
  }
}
