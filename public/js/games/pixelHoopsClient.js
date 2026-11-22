import * as THREE from '../../vendor/three/three.module.js';
import { sound } from '../audio.js';
import { drawPixelText, drawPixelTextCentered, pixelTextWidth } from './pixelFont.js';

/**
 * Pixel Hoops renderer: Jordan vs. Bird (NES, 1989) inspired 8-bit pixel-art
 * tabletop basketball. Chunky voxel-blocky ballers with crisp nearest-neighbor
 * pixel textures, 2-step NES shading, stepped retro sprite animation frames,
 * signature moves (crossover, 360 spin, fadeaway jumper, tomahawk/windmill/
 * cradle/two-hand dunks), and an 8-bit hardwood half-court.
 */

const SKIN_TONES = ['#8d5524', '#c68642', '#e0ac69', '#f1c27d', '#5c3a1e', '#a86b3c', '#f5cfa0'];
const HAIR_COLORS = ['#181820', '#3b2314', '#6b3e1f', '#d4a438', '#2b1b10', '#8a3b12'];
const HAIR_STYLES = ['bald', 'flattop', 'curly', 'buzz', 'mullet'];
const JERSEY_NUMBERS = [23, 33, 32, 21, 34, 11, 7, 8, 12, 44, 15, 24];

// 3x5 digits for the NES dot-matrix scoreboard.
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
        if (row[rx] === '1') ctx.fillRect(Math.round(x + (ci * 4 + rx) * px), Math.round(y + ry * px), Math.ceil(px), Math.ceil(px));
      }
    });
  });
}

function canvasTexture(w, h, draw, { smooth = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
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

/** Step a continuous phase into discrete NES animation frames. */
function stepPhase(phase, stepsPerCycle = 4) {
  const unit = (Math.PI * 2) / stepsPerCycle;
  return Math.floor(phase / unit) * unit;
}

/** Bresenham pixel circle/arc for crisp 8-bit court markings. */
function drawPixelArc(ctx, cx, cy, r, startAng, endAng, color) {
  ctx.fillStyle = color;
  const steps = Math.max(24, Math.ceil(r * 8));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = startAng + (endAng - startAng) * t;
    const px = Math.round(cx + Math.cos(a) * r);
    const py = Math.round(cy + Math.sin(a) * r);
    ctx.fillRect(px, py, 1, 1);
  }
}

// ---- Retro NES rendering: vivid CRT-bright 2-step shading + bold black pixel outlines.
let toonRamp = null;
function toonGradient() {
  if (!toonRamp) {
    toonRamp = new THREE.DataTexture(new Uint8Array([208, 255]), 2, 1, THREE.RedFormat);
    toonRamp.magFilter = THREE.NearestFilter;
    toonRamp.minFilter = THREE.NearestFilter;
    toonRamp.generateMipmaps = false;
    toonRamp.needsUpdate = true;
  }
  return toonRamp;
}

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
    const m = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
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

function addOutlines(root, width = 0.015) {
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

/** Blocky voxel limb hanging down from its pivot (top at y=0). */
function pixelLimb(w, len, d, material) {
  const geo = new THREE.BoxGeometry(w, len, d);
  geo.translate(0, -len / 2, 0);
  return mesh(geo, material);
}

// ---- Crisp NES solid dark pixel oval shadow
let pixelShadowTex = null;
function pixelShadow(size, opacity, color = 0x000000) {
  if (!pixelShadowTex) {
    pixelShadowTex = canvasTexture(16, 12, (ctx) => {
      ctx.fillStyle = '#ffffff';
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 16; x++) {
          const dx = (x - 7.5) / 7;
          const dy = (y - 5.5) / 5;
          if (dx * dx + dy * dy <= 0.88) {
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }
    });
  }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size * 0.72),
    new THREE.MeshBasicMaterial({ map: pixelShadowTex, color, transparent: true, opacity, depthWrite: false })
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
    ctx.fillStyle = '#090910';
    ctx.fillRect(Math.floor(64 - tw / 2 - 5), 4, tw + 10, 22);
    ctx.fillStyle = color;
    ctx.fillRect(Math.floor(64 - tw / 2 - 5), 22, tw + 10, 4);
    drawPixelTextCentered(ctx, text, 64, 13, scale, '#ffffff');
  });
}

function jerseyFaceTexture(color, number, isFront) {
  return canvasTexture(16, 18, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    // White collar + shoulder trim
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, 2);
    ctx.fillRect(0, h - 2, w, 2);
    // Side vertical trim pixels
    ctx.fillRect(0, 2, 1, h - 4);
    ctx.fillRect(w - 1, 2, 1, h - 4);
    // V-neck cutout on front
    if (isFront) {
      ctx.fillStyle = '#090910';
      ctx.fillRect(6, 0, 4, 2);
      ctx.fillRect(7, 2, 2, 1);
    }
    // Crisp 8-bit jersey number
    const numStr = String(number);
    const numW = numStr.length * 4 - 1;
    const startX = Math.floor((w - numW) / 2);
    drawPixelNumber(ctx, numStr, startX, 6, 1, '#090910');
    drawPixelNumber(ctx, numStr, startX, 5, 1, '#ffffff');
  });
}

function jerseySideTexture(color) {
  return canvasTexture(8, 18, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(3, 0, 2, h);
    ctx.fillStyle = '#090910';
    ctx.fillRect(2, 0, 1, h);
    ctx.fillRect(5, 0, 1, h);
  });
}

function shortsTexture(color) {
  return canvasTexture(16, 10, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    // White waistband
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, 2);
    // Bottom trim stripe
    ctx.fillRect(0, h - 2, w, 1);
    // Side stripe
    ctx.fillRect(0, 2, 2, h - 3);
    ctx.fillRect(w - 2, 2, 2, h - 3);
  });
}

function faceTexture(skinHex, hairHex, hasMustache, hasHeadband, teamHex) {
  return canvasTexture(16, 16, (ctx, w, h) => {
    ctx.fillStyle = skinHex;
    ctx.fillRect(0, 0, w, h);
    // Forehead shadow / hairline
    ctx.fillStyle = hairHex;
    ctx.fillRect(0, 0, w, 3);
    if (hasHeadband) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 2, w, 3);
      ctx.fillStyle = teamHex;
      ctx.fillRect(0, 3, w, 1);
    }
    // Brows
    ctx.fillStyle = '#111118';
    ctx.fillRect(3, 6, 3, 1);
    ctx.fillRect(10, 6, 3, 1);
    // Eyes (classic NES white + black pixel)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(3, 7, 3, 2);
    ctx.fillRect(10, 7, 3, 2);
    ctx.fillStyle = '#090910';
    ctx.fillRect(4, 7, 2, 2);
    ctx.fillRect(10, 7, 2, 2);
    // Pixel nose
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(7, 9, 2, 2);
    // Optional Bird-style 80s mustache
    if (hasMustache) {
      ctx.fillStyle = hairHex;
      ctx.fillRect(5, 11, 6, 2);
    }
    // Determined NES mouth
    ctx.fillStyle = '#2b1010';
    ctx.fillRect(6, 13, 4, 1);
  });
}

function sockTexture(stripe) {
  return canvasTexture(8, 12, (ctx, w, h) => {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = stripe;
    ctx.fillRect(0, 1, w, 2);
    ctx.fillRect(0, 4, w, 2);
  });
}

function createBaller(player, isSelf) {
  const seed = hashString(player.id);
  const jerseyColor = new THREE.Color(player.color);
  const jerseyHex = `#${jerseyColor.getHexString()}`;
  const shortsColor = jerseyColor.clone().multiplyScalar(0.82);
  const shortsHex = `#${shortsColor.getHexString()}`;
  const number = JERSEY_NUMBERS[seed % JERSEY_NUMBERS.length];
  const skinHex = SKIN_TONES[seed % SKIN_TONES.length];
  const hairHex = HAIR_COLORS[(seed >> 3) % HAIR_COLORS.length];
  const hairStyle = HAIR_STYLES[(seed >> 2) % HAIR_STYLES.length];
  const hasHeadband = (seed >> 5) % 3 === 0;
  const hasMustache = (seed >> 6) % 3 === 0;

  const skin = mat(skinHex);
  const hair = mat(hairHex);
  const trim = mat(0xf8fafc);
  const sock = toon({ map: sockTexture(jerseyHex) });
  const shoe = mat(0xf8fafc);
  const sole = mat(0x181822);
  const accent = mat(jerseyColor);

  const root = new THREE.Group();
  const shadow = pixelShadow(0.68, isSelf ? 0.62 : 0.52, 0x080810);
  root.add(shadow);
  if (isSelf) {
    // Crisp 8-bit player marker ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.34, 8),
      new THREE.MeshBasicMaterial({ color: jerseyColor, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.016;
    root.add(ring);
  }

  const body = new THREE.Group(); // yaw + jump height
  root.add(body);
  const hips = new THREE.Group(); // crouch / lean / twist pivot (lanky NES height)
  hips.position.y = 0.62;
  body.add(hips);

  // ---- Lanky 3D-extruded NES Sprite Legs: long athletic legs, striped tube socks, high-tops
  const makeLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.078, 0, 0);
    hips.add(hip);
    hip.add(pixelLimb(0.088, 0.29, 0.082, skin));
    const knee = new THREE.Group();
    knee.position.y = -0.29;
    hip.add(knee);
    knee.add(pixelLimb(0.076, 0.13, 0.074, skin));
    const sockMesh = pixelLimb(0.084, 0.16, 0.082, sock);
    sockMesh.position.y = -0.12;
    knee.add(sockMesh);
    const foot = new THREE.Group();
    foot.position.y = -0.28;
    knee.add(foot);
    // Iconic 8-bit white high-top sneaker with team stripe & black sole
    foot.add(mesh(new THREE.BoxGeometry(0.096, 0.078, 0.21), shoe, 0, -0.008, 0.042));
    foot.add(mesh(new THREE.BoxGeometry(0.102, 0.022, 0.22), sole, 0, -0.048, 0.042));
    foot.add(mesh(new THREE.BoxGeometry(0.1, 0.022, 0.12), accent, 0, 0.005, 0.032));
    foot.add(mesh(new THREE.BoxGeometry(0.098, 0.02, 0.065), accent, 0, 0.03, -0.02));
    return { hip, knee, foot };
  };
  const legL = makeLeg(1);
  const legR = makeLeg(-1);

  // ---- Extruded NES Sprite Shorts & Tank-Top Jersey (leaner sprite silhouette)
  const shortsTex = shortsTexture(shortsHex);
  const shortsMat = toon({ map: shortsTex });
  const shorts = mesh(new THREE.BoxGeometry(0.28, 0.2, 0.165), shortsMat, 0, -0.06, 0);
  hips.add(shorts);

  const frontMat = toon({ map: jerseyFaceTexture(jerseyHex, number, true) });
  const backMat = toon({ map: jerseyFaceTexture(jerseyHex, number, false) });
  const sideMat = toon({ map: jerseySideTexture(jerseyHex) });
  const topMat = mat(jerseyColor);
  const torso = mesh(
    new THREE.BoxGeometry(0.275, 0.38, 0.15),
    [sideMat, sideMat, topMat, topMat, frontMat, backMat],
    0,
    0.23,
    0
  );
  hips.add(torso);

  const chest = new THREE.Group();
  chest.position.y = 0.42;
  hips.add(chest);

  // ---- Lean 3D-extruded NES Arms
  const makeArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.185, -0.02, 0);
    chest.add(shoulder);
    shoulder.add(pixelLimb(0.076, 0.23, 0.072, skin));
    const elbow = new THREE.Group();
    elbow.position.y = -0.23;
    shoulder.add(elbow);
    elbow.add(pixelLimb(0.068, 0.2, 0.066, skin));
    const band = pixelLimb(0.078, 0.048, 0.076, trim);
    band.position.y = -0.14;
    elbow.add(band);
    elbow.add(mesh(new THREE.BoxGeometry(0.076, 0.074, 0.074), skin, 0, -0.23, 0));
    return { shoulder, elbow };
  };
  const armL = makeArm(1);
  const armR = makeArm(-1);

  // ---- Neck & Crisp 3D-extruded NES Pixel Head
  chest.add(mesh(new THREE.BoxGeometry(0.078, 0.08, 0.078), skin, 0, 0.03, 0));
  const head = new THREE.Group();
  head.position.y = 0.165;
  chest.add(head);

  const faceMat = toon({ map: faceTexture(skinHex, hairStyle === 'bald' ? skinHex : hairHex, hasMustache, hasHeadband, jerseyHex) });
  const headBackMat = hairStyle === 'bald' ? skin : hair;
  const skull = mesh(
    new THREE.BoxGeometry(0.195, 0.215, 0.175),
    [skin, skin, headBackMat, skin, faceMat, headBackMat]
  );
  head.add(skull);

  // Pixel ears
  head.add(mesh(new THREE.BoxGeometry(0.03, 0.055, 0.035), skin, 0.108, -0.01, 0));
  head.add(mesh(new THREE.BoxGeometry(0.03, 0.055, 0.035), skin, -0.108, -0.01, 0));

  // Iconic 80s NES Hairstyles (voxel blocks)
  switch (hairStyle) {
    case 'flattop':
      head.add(mesh(new THREE.BoxGeometry(0.205, 0.09, 0.185), hair, 0, 0.135, -0.005));
      break;
    case 'curly':
      head.add(mesh(new THREE.BoxGeometry(0.235, 0.105, 0.215), hair, 0, 0.115, -0.01));
      head.add(mesh(new THREE.BoxGeometry(0.225, 0.1, 0.075), hair, 0, 0.035, -0.09));
      break;
    case 'mullet':
      head.add(mesh(new THREE.BoxGeometry(0.205, 0.058, 0.185), hair, 0, 0.12, -0.01));
      head.add(mesh(new THREE.BoxGeometry(0.195, 0.145, 0.055), hair, 0, -0.035, -0.095));
      break;
    case 'buzz':
      head.add(mesh(new THREE.BoxGeometry(0.2, 0.038, 0.18), hair, 0, 0.115, -0.005));
      break;
    case 'bald':
    default:
      break;
  }

  // Stumble / ankle-broken spinning pixel stars
  const stars = new THREE.Group();
  stars.position.y = 0.26;
  stars.visible = false;
  const starGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const starMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const s = new THREE.Mesh(starGeo, starMat);
    s.position.set(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2);
    s.userData.noOutline = true;
    stars.add(s);
  }
  head.add(stars);

  const labelSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: makeNameTexture(player.name, player.color, player.score, isSelf), transparent: true, depthTest: false })
  );
  labelSprite.position.set(0, 1.58, 0);
  labelSprite.scale.set(1.1, 0.275, 1);
  body.add(labelSprite);
  addOutlines(body, 0.012);

  return {
    root,
    body,
    hips,
    chest,
    head,
    stars,
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
  const tex = canvasTexture(32, 16, (ctx, w, h) => {
    // Classic 2-tone NES orange basketball with chunky black pixel seams
    ctx.fillStyle = '#e86a17';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f89030';
    ctx.fillRect(0, 2, w, 5);
    ctx.fillStyle = '#b84810';
    ctx.fillRect(0, 12, w, 4);

    ctx.fillStyle = '#100c08';
    // Equator seam
    ctx.fillRect(0, 7, w, 2);
    // Vertical meridian seams
    ctx.fillRect(7, 0, 2, h);
    ctx.fillRect(23, 0, 2, h);
    // Pixel rib curves
    for (let x = 0; x < w; x++) {
      const y = Math.round(7.5 + Math.sin((x / w) * Math.PI * 4) * 4.5);
      ctx.fillRect(x, y, 1, 1);
    }
  });
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.125, 10, 7),
    toon({ map: tex })
  );
  ball.castShadow = true;
  addOutlines(ball, 0.01);
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
  ankle: () => sound.playNotes([[N.E5, 0.6], [N.C5, 0.6], [N.G4, 0.8], [N.E4, 1.4]], { type: 'square', step: 0.045, gain: 0.09 }),
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

const DUNK_CALLOUTS = {
  tomahawk: 'AIR SLAM!',
  windmill: 'WINDMILL!',
  cradle: 'CRADLE JAM!',
  twohand: 'MONSTER SLAM!',
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
    this.ballShadow = pixelShadow(0.32, 0.48);
    this.group.add(this.ballShadow);
    this.ballTarget = new THREE.Vector3(0, 0.5, 0);
    sfx.tipoff();
  }

  _buildCourt(cfg) {
    const w = cfg.courtWidth;
    const d = cfg.courtDepth;
    const hoop = cfg.hoop;
    // Chunky 8-bit NES resolution: 16 texels per board unit -> 192 x 128 pixel court!
    const PX = 16;
    const APRON = 0.35;

    const courtTex = canvasTexture(w * PX, d * PX, (ctx, cw, ch) => {
      const toPx = (x, z) => [Math.round((x + w / 2) * PX), Math.round((z + d / 2) * PX)];

      // Classic Jordan vs. Bird (NES) clean bright tan hardwood
      const woodPalette = ['#f4be72', '#ecb262', '#f8c880'];
      const boardW = 4;
      let seed = 17;
      const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      for (let x = 0; x < cw; x += boardW) {
        let y = -Math.floor(rnd() * 14);
        while (y < ch) {
          const len = 18 + Math.floor(rnd() * 20);
          ctx.fillStyle = woodPalette[Math.floor(rnd() * woodPalette.length)];
          ctx.fillRect(x, y, boardW, len);
          // Crisp subtle NES plank seam
          ctx.fillStyle = '#c88c40';
          ctx.fillRect(x, y, boardW, 1);
          y += len;
        }
        ctx.fillStyle = '#d49a4c';
        ctx.fillRect(x, 0, 1, ch);
      }

      // Iconic Jordan vs. Bird NES Royal Blue Apron
      const ap = Math.round(APRON * PX);
      ctx.fillStyle = '#1c3cd8';
      ctx.fillRect(0, 0, cw, ap);
      ctx.fillRect(0, ch - ap, cw, ap);
      ctx.fillRect(0, 0, ap, ch);
      ctx.fillRect(cw - ap, 0, ap, ch);

      const [hx, hz] = toPx(hoop.x, hoop.z);
      const baseline = ap;
      const r3u = cfg.threePtRadius;
      const laneW = Math.round(r3u * 0.53 * PX);
      const ftDist = r3u * 0.58;
      const ftR = Math.round(r3u * 0.25 * PX);
      const ftLine = Math.round(hz + ftDist * PX);

      // Iconic NES Royal Blue Painted Key
      const laneX = Math.round(hx - laneW / 2);
      const laneH = ftLine - baseline;
      ctx.fillStyle = '#1c3cd8';
      ctx.fillRect(laneX, baseline, laneW, laneH);

      // Red top-of-key free-throw semi-circle fill (classic 80s NES contrast)
      ctx.fillStyle = '#d82818';
      for (let py = ftLine; py <= ftLine + ftR; py++) {
        for (let px = hx - ftR; px <= hx + ftR; px++) {
          const dx = px - hx;
          const dy = py - ftLine;
          if (dx * dx + dy * dy <= ftR * ftR) ctx.fillRect(px, py, 1, 1);
        }
      }

      // Crisp 1-pixel bright white NES court lines
      const white = '#fcfcfc';
      ctx.fillStyle = white;
      // Outer boundary
      ctx.fillRect(ap, ap, cw - ap * 2, 1);
      ctx.fillRect(ap, ch - ap - 1, cw - ap * 2, 1);
      ctx.fillRect(ap, ap, 1, ch - ap * 2);
      ctx.fillRect(cw - ap - 1, ap, 1, ch - ap * 2);

      // Key box outline
      ctx.fillRect(laneX, baseline, laneW, 1);
      ctx.fillRect(laneX, ftLine, laneW, 1);
      ctx.fillRect(laneX, baseline, 1, laneH + 1);
      ctx.fillRect(laneX + laneW - 1, baseline, 1, laneH + 1);

      // Free-throw circle (solid bottom half, dashed top half)
      drawPixelArc(ctx, hx, ftLine, ftR, 0, Math.PI, white);
      for (let i = 0; i < 6; i++) {
        const a0 = Math.PI + (i / 6) * Math.PI;
        drawPixelArc(ctx, hx, ftLine, ftR, a0, a0 + Math.PI / 10, white);
      }

      // Lane hash marks
      for (const k of [0.4, 0.62, 0.84].map((f) => Math.round(hz + f * ftDist * PX))) {
        ctx.fillRect(laneX - 3, k, 3, 1);
        ctx.fillRect(laneX + laneW, k, 3, 1);
      }

      // Restricted arc under rim
      drawPixelArc(ctx, hx, hz, Math.round(r3u * 0.17 * PX), 0, Math.PI, white);

      // Three-point line (straight corners + pixel arc)
      const r3 = Math.round(r3u * PX);
      const cornerX = Math.min(Math.round(r3 * 0.94), Math.floor(cw / 2 - ap - 4));
      const a = Math.asin(cornerX / r3);
      const cornerZ = Math.round(hz + Math.cos(a) * r3);
      ctx.fillRect(hx - cornerX, baseline, 1, cornerZ - baseline);
      ctx.fillRect(hx + cornerX, baseline, 1, cornerZ - baseline);
      drawPixelArc(ctx, hx, hz, r3, Math.PI / 2 - a, Math.PI / 2 + a, white);

      // Half-court center circle with 8-bit 1-ON-1 emblem
      const cr = Math.round(1.15 * PX);
      ctx.fillStyle = '#d82818';
      for (let py = ch - ap - cr; py < ch - ap; py++) {
        for (let px = Math.floor(cw / 2) - cr; px <= Math.floor(cw / 2) + cr; px++) {
          const dx = px - cw / 2;
          const dy = py - (ch - ap);
          if (dx * dx + dy * dy <= cr * cr) ctx.fillRect(px, py, 1, 1);
        }
      }
      drawPixelArc(ctx, Math.floor(cw / 2), ch - ap, cr, Math.PI, Math.PI * 2, white);
      drawPixelTextCentered(ctx, '1 ON 1', Math.floor(cw / 2), ch - ap - 8, 1, '#fcfcfc', '#101018');

      // Check-ball pixel cross
      const [cx, cz] = toPx(cfg.checkSpot.x, cfg.checkSpot.z);
      ctx.fillStyle = white;
      ctx.fillRect(cx - 1, cz, 3, 1);
      ctx.fillRect(cx, cz - 1, 1, 3);
    });

    const slab = 0.18;
    const sideMat = toon({ color: 0x102078 });
    const floorMat = toon({ map: courtTex });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, slab, d), [sideMat, sideMat, floorMat, sideMat, sideMat, sideMat]);
    floor.position.y = -slab / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // ---- 3D-Extruded NES Baseline Ad Boards & Cheering Pixel Crowd Bleachers
    const buildCrowdTex = (frame) => canvasTexture(128, 28, (ctx, cw, ch) => {
      ctx.fillStyle = '#181828';
      ctx.fillRect(0, 0, cw, ch);
      const shirts = ['#d82818', '#1c3cd8', '#00a800', '#f8b800', '#fcfcfc', '#3cbcfc', '#e85898'];
      const skins = ['#f8d8a8', '#e0ac69', '#8d5524', '#c68642'];
      let s = 31;
      const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      for (let row = 0; row < 3; row++) {
        const baseY = 3 + row * 8;
        ctx.fillStyle = row % 2 === 0 ? '#282c42' : '#202438';
        ctx.fillRect(0, baseY + 5, cw, 3);
        for (let x = 2; x < cw - 4; x += 6) {
          const shirt = shirts[Math.floor(rnd() * shirts.length)];
          const skin = skins[Math.floor(rnd() * skins.length)];
          const bounce = frame === 1 && ((x + row) % 2 === 0) ? -1 : 0;
          // Pixel spectator head + torso + cheering arms
          ctx.fillStyle = '#000000';
          ctx.fillRect(x, baseY + bounce, 4, 6);
          ctx.fillStyle = skin;
          ctx.fillRect(x + 1, baseY + bounce, 2, 2);
          ctx.fillStyle = shirt;
          ctx.fillRect(x, baseY + 2 + bounce, 4, 4);
          if (frame === 1 && ((x + row) % 3 === 0)) {
            ctx.fillStyle = skin;
            ctx.fillRect(x - 1, baseY + bounce, 1, 2);
            ctx.fillRect(x + 4, baseY + bounce, 1, 2);
          }
        }
      }
    });
    this.crowdTexA = buildCrowdTex(0);
    this.crowdTexB = buildCrowdTex(1);
    this.crowdCheer = 0;
    const crowdMat = new THREE.MeshBasicMaterial({ map: this.crowdTexA });
    this.crowdMat = crowdMat;
    const standDark = toon({ color: 0x181c2c });
    const bleachers = new THREE.Mesh(
      new THREE.BoxGeometry(w, 1.35, 0.45),
      [standDark, standDark, standDark, standDark, crowdMat, standDark]
    );
    bleachers.position.set(0, 0.92, -d / 2 - 0.34);
    this.group.add(bleachers);

    // Classic NES Courtside Baseline Ad Banner Wall
    const bannerTex = canvasTexture(160, 16, (ctx, cw, ch) => {
      ctx.fillStyle = '#101018';
      ctx.fillRect(0, 0, cw, ch);
      const panels = [
        { bg: '#d82818', fg: '#fcfcfc', text: '1 ON 1' },
        { bg: '#1c3cd8', fg: '#f8d800', text: 'PIXEL HOOPS' },
        { bg: '#00a800', fg: '#fcfcfc', text: '8-BIT ARENA' },
        { bg: '#d82818', fg: '#fcfcfc', text: '1 ON 1' },
      ];
      const pw = cw / panels.length;
      panels.forEach((p, i) => {
        ctx.fillStyle = p.bg;
        ctx.fillRect(i * pw + 1, 2, pw - 2, ch - 4);
        drawPixelTextCentered(ctx, p.text, i * pw + pw / 2, ch / 2, 1, p.fg, '#000000');
      });
    });
    const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTex });
    const adWall = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.42, 0.14),
      [standDark, standDark, standDark, standDark, bannerMat, standDark]
    );
    adWall.position.set(0, 0.21, -d / 2 - 0.08);
    this.group.add(adWall);

    // ---- Hoop: blocky NES stanchion, pixel-dithered glass backboard, faceted rim & net
    const hoopGroup = new THREE.Group();
    this.group.add(hoopGroup);
    const bbZ = cfg.backboardZ;
    const poleZ = bbZ - 0.5;
    const steel = toon({ color: 0x384050 });
    const pad = toon({ color: 0xd82818 });
    hoopGroup.add(mesh(new THREE.BoxGeometry(0.56, 0.24, 0.42), pad, hoop.x, 0.12, poleZ - 0.05));
    const poleH = hoop.rimY + 0.35;
    hoopGroup.add(mesh(new THREE.BoxGeometry(0.11, poleH, 0.11), steel, hoop.x, poleH / 2, poleZ));
    hoopGroup.add(mesh(new THREE.BoxGeometry(0.16, 0.72, 0.16), pad, hoop.x, 0.55, poleZ));
    hoopGroup.add(mesh(new THREE.BoxGeometry(0.08, 0.08, bbZ - poleZ), steel, hoop.x, poleH - 0.05, (bbZ + poleZ) / 2));

    const boardTex = canvasTexture(64, 40, (ctx, cw, ch) => {
      // NES pixel-dithered translucent glass
      ctx.fillStyle = 'rgba(210, 236, 255, 0.65)';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      for (let y = 3; y < ch - 3; y += 2) {
        for (let x = 3; x < cw - 3; x += 2) {
          if (((x + y) >> 1) % 2 === 0) ctx.fillRect(x, y, 1, 1);
        }
      }
      // Thick pixel border
      ctx.fillStyle = '#090910';
      ctx.fillRect(0, 0, cw, 3);
      ctx.fillRect(0, ch - 3, cw, 3);
      ctx.fillRect(0, 0, 3, ch);
      ctx.fillRect(cw - 3, 0, 3, ch);
      // Classic NES orange-red shooter's square
      ctx.fillStyle = '#e83820';
      const sx = 21, sy = 17, sw = 22, sh = 17;
      ctx.fillRect(sx, sy, sw, 2);
      ctx.fillRect(sx, sy + sh - 2, sw, 2);
      ctx.fillRect(sx, sy, 2, sh);
      ctx.fillRect(sx + sw - 2, sy, 2, sh);
    });
    const glass = toon({ map: boardTex, transparent: true });
    const backboard = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.82, 0.04), glass);
    backboard.position.set(hoop.x, hoop.rimY + 0.3, bbZ);
    hoopGroup.add(backboard);

    this.rim = new THREE.Group();
    this.rim.position.set(hoop.x, hoop.rimY, hoop.z);
    const rimMat = toon({ color: 0xff521b });
    // Chunky faceted 10-sided retro rim
    const torus = mesh(new THREE.TorusGeometry(hoop.rimRadius, 0.02, 5, 10), rimMat);
    torus.rotation.x = Math.PI / 2;
    this.rim.add(torus);
    const bracketLen = hoop.z - bbZ - hoop.rimRadius;
    this.rim.add(mesh(new THREE.BoxGeometry(0.09, 0.04, bracketLen), rimMat, 0, 0, -hoop.rimRadius - bracketLen / 2));
    hoopGroup.add(this.rim);

    // Net: crisp retro diamond lattice
    this.net = new THREE.Group();
    this.net.position.set(hoop.x, hoop.rimY, hoop.z);
    const rows = 4;
    const cols = 10;
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
        const below = row % 2 === 0 ? [col - 1, col] : [col, col + 1];
        for (const c of below) pts.push(p, ringPt(row + 1, (c + cols) % cols));
      }
    }
    this.net.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.92 })
    ));
    hoopGroup.add(this.net);
    addOutlines(hoopGroup, 0.014);

    // NES Dot-Matrix Scoreboard on top of the backboard
    this.scoreCanvas = document.createElement('canvas');
    this.scoreCanvas.width = 128;
    this.scoreCanvas.height = 56;
    this.scoreTex = new THREE.CanvasTexture(this.scoreCanvas);
    this.scoreTex.magFilter = THREE.NearestFilter;
    this.scoreTex.minFilter = THREE.NearestFilter;
    this.scoreTex.generateMipmaps = false;
    this.scoreTex.colorSpace = THREE.SRGBColorSpace;
    const sbMat = new THREE.MeshBasicMaterial({ map: this.scoreTex });
    const sbFrame = toon({ color: 0x111420 });
    const scoreboard = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.52, 0.08), [sbFrame, sbFrame, sbFrame, sbFrame, sbMat, sbFrame]);
    scoreboard.position.set(hoop.x, hoop.rimY + 1.02, bbZ - 0.03);
    hoopGroup.add(scoreboard);
    hoopGroup.add(mesh(new THREE.BoxGeometry(0.05, 0.3, 0.05), steel, hoop.x, hoop.rimY + 0.72, bbZ - 0.05));
    this.scoreKey = '';

    // Blocky sideline bench
    const benchWood = toon({ color: 0x7a4b24 });
    const bx = -w / 2 + 1.9;
    const bz = d / 2 - 0.15;
    this.group.add(mesh(new THREE.BoxGeometry(3.4, 0.06, 0.28), benchWood, bx, 0.26, bz));
    for (const ox of [-1.55, 0, 1.55]) {
      this.group.add(mesh(new THREE.BoxGeometry(0.06, 0.24, 0.06), steel, bx + ox, 0.12, bz));
    }
  }

  _drawScoreboard(players, difficulty = 'medium') {
    const court = players.filter((p) => p.role === 'court');
    const diffLabel = difficulty === 'easy' ? 'CPU EASY' : difficulty === 'hard' ? 'CPU HARD' : 'CPU MED';
    const key = `${court.map((p) => `${p.id}:${p.score}`).join('|')}|${diffLabel}`;
    if (key === this.scoreKey) return;
    this.scoreKey = key;
    const ctx = this.scoreCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#080a10';
    ctx.fillRect(0, 0, 128, 56);
    // Crisp NES bezel border
    ctx.fillStyle = '#384058';
    ctx.fillRect(0, 0, 128, 2);
    ctx.fillRect(0, 54, 128, 2);
    ctx.fillRect(0, 0, 2, 56);
    ctx.fillRect(126, 0, 2, 56);
    // Unlit LED dot grid
    ctx.fillStyle = '#181c28';
    for (let y = 4; y < 44; y += 3) for (let x = 4; x < 124; x += 3) ctx.fillRect(x, y, 2, 2);

    [court[0], court[1]].forEach((p, i) => {
      if (!p) return;
      const x0 = i === 0 ? 6 : 70;
      ctx.fillStyle = p.color;
      ctx.fillRect(x0, 5, 52, 5);
      const s = String(p.score);
      const textW = s.length * 16 - 4;
      drawPixelNumber(ctx, s, x0 + 26 - textW / 2, 15, 4, '#ffd23f');
    });
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(62, 20, 4, 4);
    ctx.fillRect(62, 30, 4, 4);

    // Bottom status bar with CPU difficulty mode
    ctx.fillStyle = '#121622';
    ctx.fillRect(3, 43, 122, 10);
    const diffColor = difficulty === 'hard' ? '#ff5a5f' : difficulty === 'easy' ? '#4ade80' : '#38bdf8';
    drawPixelTextCentered(ctx, diffLabel, 64, 48, 1, diffColor);
    this.scoreTex.needsUpdate = true;
  }

  _burst(x, y, z, color, count = 10, speed = 2.6, size = 0.065) {
    // Chunky 8-bit 3D pixel cubes!
    const geo = new THREE.BoxGeometry(size, size, size);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }));
      m.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2;
      const spd = (0.4 + Math.random() * 0.8) * speed;
      this.group.add(m);
      this.particles.push({ mesh: m, vx: Math.cos(a) * spd, vy: (0.5 + Math.random()) * speed * 0.7, vz: Math.sin(a) * spd, life: 0.45 + Math.random() * 0.25, maxLife: 0.7 });
    }
  }

  _popup(text, color, x, y, z) {
    const tex = canvasTexture(128, 32, (ctx) => {
      const scale = pixelTextWidth(text, 3) <= 120 ? 3 : 2;
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [2, 2]]) {
        drawPixelTextCentered(ctx, text, 64 + ox * scale, 16 + oy * scale, scale, '#090910');
      }
      drawPixelTextCentered(ctx, text, 64, 16, scale, color);
    });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.position.set(x, y, z);
    sprite.scale.set(1.85, 0.46, 1);
    this.group.add(sprite);
    this.popups.push({ sprite, life: 1.3 });
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
    this._drawScoreboard(state.players, state.botDifficulty || this.config.botDifficulty || 'medium');

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
          this.crowdCheer = ev.dunk ? 2.6 : 1.8;
          this._burst(hoop.x, hoop.rimY - 0.2, hoop.z, ev.color, ev.dunk ? 24 : 14, 2.5);
          const label = ev.dunk
            ? (DUNK_CALLOUTS[ev.dunkStyle] || 'SLAM!')
            : ev.fadeaway
              ? (ev.points === 3 ? 'FADE 3!' : 'FADEAWAY!')
              : ev.points === 3
                ? '3 PTS!'
                : '2 PTS';
          this._popup(label, ev.color, hoop.x, hoop.rimY + 0.72, hoop.z + 0.4);
          sfx.swish();
          if (ev.dunk) sfx.slam();
          else if (ev.points === 3) sfx.three();
          else sfx.two();
          break;
        }
        case 'rim_shake':
          this.rimShake = 1;
          // Monster dunk rim sparks
          this._burst(hoop.x, hoop.rimY, hoop.z, 0xffd23f, 8, 2.0, 0.05);
          break;
        case 'clank':
          this.rimShake = 0.6;
          this._burst(ev.x, ev.y, ev.z, 0xff521b, 6, 1.6, 0.045);
          sfx.clank();
          break;
        case 'block':
          this._burst(ev.x, ev.y, ev.z, 0xffffff, 12, 3.0);
          this._popup('SWATTED!', '#ff3b30', ev.x, ev.y + 0.6, ev.z);
          sfx.block();
          break;
        case 'steal':
          this._burst(ev.x, 0.5, ev.z, 0xffd23f, 10, 2.4);
          this._popup('STEAL!', '#ffd23f', ev.x, 1.6, ev.z);
          sfx.steal();
          break;
        case 'ankle_break':
          this._burst(ev.x, 0.12, ev.z, 0xffd23f, 8, 2.0, 0.055);
          this._popup('ANKLES!', '#ffd23f', ev.x, 1.55, ev.z);
          sfx.ankle();
          break;
        case 'swipe':
          if (ev.playerId === this.selfPlayerId) sfx.swipe();
          break;
        case 'juke':
          this._burst(ev.x, 0.05, ev.z, 0xe2e8f0, 7, 1.5, 0.055);
          if (ev.variant === 'spin') {
            this._popup('SPIN!', '#38bdf8', ev.x, 1.5, ev.z);
          }
          if (ev.playerId === this.selfPlayerId) sfx.juke();
          break;
        case 'jump':
        case 'shot_rise':
        case 'dunk_start':
          if (ev.playerId === this.selfPlayerId) sfx.jump();
          break;
        case 'shot':
          if (ev.playerId === this.selfPlayerId && ev.timing > 0.85) {
            this._popup(ev.fadeaway ? 'PURE FADE!' : 'PERFECT!', '#4ade80', ev.x, ev.y + 0.52, ev.z);
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
    // Stepped 8-bit NES animation cadence (4 crisp frames per stride!)
    const steppedPh = stepPhase(p.animPhase, 4);
    const steppedTime = Math.floor(time * 9) / 9;
    const onDefense = p.role === 'court' && !p.onOffense && !p.hasBall;
    const hand = p.dribbleHand || 1;
    const prog = p.moveProgress || 0;

    // ---- Lower body
    let crouch = 0;
    let lean = 0;
    let twist = 0;
    let spread = 0;
    const legs = { L: { hip: 0, knee: 0 }, R: { hip: 0, knee: 0 } };

    if (p.action === 'dunk') {
      // Iconic Jordan vs Bird midair dunk silhouettes!
      if (p.moveVariant === 'tomahawk') {
        // Air Jordan Jumpman wide-scissor flight!
        legs.L = { hip: -0.75, knee: 0.45 };
        legs.R = { hip: 0.65, knee: 0.55 };
        lean = 0.18;
      } else if (p.moveVariant === 'twohand') {
        // Power two-hand knee-tuck
        legs.L = { hip: -0.85, knee: 1.5 };
        legs.R = { hip: -0.85, knee: 1.5 };
        lean = 0.22;
      } else if (p.moveVariant === 'windmill') {
        legs.L = { hip: -0.55, knee: 0.9 };
        legs.R = { hip: 0.35, knee: 0.8 };
        lean = 0.14;
      } else {
        // Cradle tuck -> stretch
        legs.L = { hip: -0.6, knee: 1.1 };
        legs.R = { hip: -0.25, knee: 0.65 };
        lean = 0.16;
      }
    } else if (p.action === 'shoot' && p.moveVariant === 'fadeaway') {
      // Iconic Bird/Jordan lean-back fadeaway with front leg kicked for balance
      legs.L = { hip: -0.55, knee: 0.2 };
      legs.R = { hip: 0.15, knee: 0.45 };
      lean = -0.44;
    } else if (p.action === 'block') {
      // NES vertical swat block: legs kicked back/tucked
      legs.L = { hip: 0.25, knee: 1.05 };
      legs.R = { hip: -0.15, knee: 0.9 };
      lean = -0.06;
    } else if (air) {
      // Standard jump-shot airborne tuck
      legs.L = { hip: -0.45, knee: 0.85 };
      legs.R = { hip: -0.15, knee: 0.45 };
    } else if (p.action === 'crossover') {
      // Low wide crossover lunge
      crouch = 0.95;
      spread = 0.34;
      lean = 0.28;
      twist = hand * 0.45;
      legs.L = { hip: -0.35 * hand, knee: 0.35 };
      legs.R = { hip: 0.35 * hand, knee: 0.35 };
    } else if (p.action === 'spin') {
      // Tight crouched 360° spin move
      crouch = 0.85;
      lean = 0.22;
      legs.L = { hip: -0.3, knee: 0.4 };
      legs.R = { hip: 0.3, knee: 0.4 };
    } else if (p.action === 'steal') {
      // Low forward swipe lunge
      crouch = 0.9;
      lean = 0.42;
      legs.L = { hip: -0.55, knee: 0.5 };
      legs.R = { hip: 0.45, knee: 0.2 };
    } else if (running) {
      // Crisp 4-frame NES running stride
      const s = Math.sin(steppedPh);
      legs.L = { hip: s * 0.82, knee: 0.22 + Math.max(0, Math.sin(steppedPh + 1.57)) * 1.15 };
      legs.R = { hip: -s * 0.82, knee: 0.22 + Math.max(0, Math.sin(steppedPh + 4.71)) * 1.15 };
      lean = 0.14;
    }

    if (p.hasBall && !air && p.action === 'dribble') {
      crouch = Math.max(crouch, 0.45);
      lean += 0.12;
    }
    if (onDefense && !air && p.action !== 'steal' && p.action !== 'stumble') {
      crouch = 0.88;
      spread = 0.28;
      lean = 0.2;
    }
    if (p.action === 'stumble') {
      lean = 0.38 + Math.sin(steppedTime * 22) * 0.14;
      twist = Math.sin(steppedTime * 18) * 0.3;
    }
    if (p.action === 'celebrate' && !air) {
      // Snappy 2-frame NES victory hop
      const hop = Math.floor(time * 8) % 2;
      vis.body.position.y += hop * 0.1;
    }

    const bend = crouch * 0.52;
    for (const [key, leg] of [['L', vis.legL], ['R', vis.legR]]) {
      const side = key === 'L' ? 1 : -1;
      const hip = legs[key].hip - bend;
      const knee = legs[key].knee + bend * 2;
      leg.hip.rotation.set(hip, 0, side * spread);
      leg.knee.rotation.x = knee;
      leg.foot.rotation.x = air ? 0.45 : -(hip + knee) * 0.85;
      leg.foot.rotation.z = -side * spread;
    }
    vis.hips.position.y = 0.62 - (1 - Math.cos(bend)) * 0.52 - spread * 0.05;
    vis.hips.rotation.set(lean, twist, 0);

    // ---- Upper body: [shoulderX, shoulderZ(outward), elbow]
    let L = [0.08, 0.14, -0.15];
    let R = [0.08, 0.14, -0.15];
    const wave = Math.sin(steppedTime * 16);

    switch (p.action) {
      case 'shoot':
        if (p.followThrough) {
          // Gooseneck follow-through after release
          L = [-2.2, 0.22, -0.45];
          R = [-2.05, 0.08, -0.15];
        } else {
          // Classic NES high-set two-hand rise
          L = [-2.45, 0.28, -0.95];
          R = [-2.7, 0.1, -1.15];
        }
        break;
      case 'dunk':
        if (p.moveVariant === 'windmill') {
          // Full 360° vertical windmill arm swing!
          const rot = -0.6 - prog * Math.PI * 2;
          R = [rot, 0.15, -0.15];
          L = [-1.4, 0.75, -0.35];
        } else if (p.moveVariant === 'tomahawk') {
          // Air Jordan cock-back -> hammer slam!
          const slam = prog < 0.65 ? -3.45 : -2.25;
          R = [slam, 0.12, prog < 0.65 ? -0.45 : -0.1];
          L = [-1.2, 0.95, -0.25];
        } else if (p.moveVariant === 'cradle') {
          // Low hip cradle -> explosive one-hand reach
          if (prog < 0.45) {
            R = [-0.65, 0.35, -1.35];
            L = [-0.8, 0.5, -0.6];
          } else {
            R = [-3.05, 0.08, -0.1];
            L = [-1.5, 0.6, -0.3];
          }
        } else {
          // Power two-hand jam
          const slam = prog < 0.7 ? -3.15 : -2.1;
          L = [slam, 0.2, -0.2];
          R = [slam, 0.2, -0.2];
        }
        break;
      case 'crossover':
        // Whip arm low across body, off-arm balancing
        if (hand === 1) {
          R = [-0.95, 0.1, -0.55];
          L = [-0.45, 0.85, -0.75];
        } else {
          L = [-0.95, 0.1, -0.55];
          R = [-0.45, 0.85, -0.75];
        }
        break;
      case 'spin':
        // Elbows tucked tight protecting the ball during 360° spin
        L = [-0.9, 0.45, -1.25];
        R = [-0.9, 0.45, -1.25];
        break;
      case 'block':
        L = [-3.05, 0.22, -0.05];
        R = [-3.05, 0.22, -0.05];
        break;
      case 'steal':
        L = [-0.35, 0.45, -0.4];
        R = [-1.55, 0.1, -0.08];
        break;
      case 'celebrate': {
        const up = Math.floor(time * 8) % 2 === 0;
        L = [up ? -3.05 : -2.3, 0.55, up ? -0.15 : -0.75];
        R = [up ? -3.05 : -2.3, 0.55, up ? -0.15 : -0.75];
        break;
      }
      case 'stumble':
        L = [-1.25 + wave * 0.65, 0.95, -0.45];
        R = [-0.65 - wave * 0.65, 0.95, -0.45];
        break;
      default:
        if (p.followThrough) {
          L = [-2.0, 0.2, -0.4];
          R = [-1.95, 0.08, -0.12];
        } else if (p.hasBall) {
          // Crisp 2-frame NES dribble pat on active hand, shield arm on opposite side
          const pat = Math.floor((p.animPhase * 1.6) / (Math.PI / 2)) % 2;
          const dribArm = [-0.45 - pat * 0.35, 0.24, -0.6 - pat * 0.45];
          const guardArm = [-0.95, 0.62, -0.95];
          if (hand === 1) {
            R = dribArm;
            L = guardArm;
          } else {
            L = dribArm;
            R = guardArm;
          }
        } else if (onDefense) {
          // Wide NES defensive stance with choppy hands
          const chop = Math.floor(time * 7) % 2 === 0 ? 0.14 : -0.14;
          L = [-0.42, 1.2 + chop, -0.55];
          R = [-0.42, 1.2 - chop, -0.55];
        } else if (running) {
          const s = Math.sin(steppedPh);
          L = [-s * 0.78, 0.15, -0.95];
          R = [s * 0.78, 0.15, -0.95];
        }
    }

    vis.armL.shoulder.rotation.set(L[0], 0, L[1]);
    vis.armL.elbow.rotation.x = L[2];
    vis.armR.shoulder.rotation.set(R[0], 0, -R[1]);
    vis.armR.elbow.rotation.x = R[2];
    vis.head.rotation.x = -lean * 0.75 + (p.action === 'shoot' || p.action === 'dunk' ? -0.25 : 0);

    // Spinning pixel stars when stumbling / ankles broken
    if (vis.stars) {
      vis.stars.visible = p.action === 'stumble';
      if (vis.stars.visible) {
        vis.stars.rotation.y = steppedTime * 10;
      }
    }
  }

  update(dt) {
    const time = performance.now() / 1000;
    const smooth = Math.min(1, dt * 20);
    for (const vis of this.visuals.values()) {
      vis.root.position.x += (vis.targetX - vis.root.position.x) * smooth;
      vis.root.position.z += (vis.targetZ - vis.root.position.z) * smooth;
      vis.body.position.y += (vis.targetY - vis.body.position.y) * smooth;
      const p = vis.state;
      // During a 360° spin move, spin the character cleanly around Y!
      const spinExtra = p && p.action === 'spin' ? (p.moveProgress || 0) * Math.PI * 2 : 0;
      const targetYaw = vis.targetYaw + spinExtra;
      if (p && p.action === 'spin') {
        vis.body.rotation.y = targetYaw;
      } else {
        let diff = vis.targetYaw - vis.body.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        vis.body.rotation.y += diff * smooth;
      }
      vis.shadow.scale.setScalar(Math.max(0.45, 1 - vis.body.position.y * 0.3));
      this._animateBaller(vis, dt, time);
    }

    // Ball: snappier smoothing so the dribble keeps its crisp NES bounce.
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
      this.rim.rotation.x = Math.sin(time * 60) * 0.14 * this.rimShake;
    } else {
      this.rim.rotation.x = 0;
    }

    // 2-frame NES pixel crowd animation (fast cheering on baskets, gentle idle pulse)
    if (this.crowdMat) {
      if (this.crowdCheer > 0) this.crowdCheer = Math.max(0, this.crowdCheer - dt);
      const rate = this.crowdCheer > 0 ? 7 : 1.5;
      const desired = Math.floor(time * rate) % 2 === 0 ? this.crowdTexA : this.crowdTexB;
      if (this.crowdMat.map !== desired) {
        this.crowdMat.map = desired;
        this.crowdMat.needsUpdate = true;
      }
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
