import * as THREE from '../../vendor/three/three.module.js';
import { sound } from '../audio.js';
import {
  BOARD_WIDTH,
  BOARD_DEPTH,
  HALF_W,
  HALF_D,
  WATER_LEVEL,
  WATERFALL_CONFIG,
  GRAVITY,
  WEAPONS,
  WEAPON_BY_ID,
  ARC_ANGLES,
  TEAMS,
  ZOO_STRUCTURES,
  LOUNGE_BOULDERS,
  BAMBOO_GROVES,
  getTerrainHeight,
  getSurfaceHeight,
  getRiverCenterX,
  getRiverHalfWidth,
  isInRiver,
} from '../shared/pandaRamenEngine.js';

/**
 * Panda Ramen Rumble — Stylized Illustrative 3D Renderer (Team Fortress 2 vibe)
 *
 * Renders an expansive coffee-table diorama with painterly grass, winding dirt
 * trails, towering sculpted mossy limestone peaks and overhangs, an animated
 * cascading mountain waterfall feeding a meandering stream, wooden zoo climbing
 * decks/ladders/bridges/tables, cozy timber-framed dens, swaying bamboo
 * groves, 8 fat-and-happy pandas with steaming bowls of ramen, whimsical
 * 3D weapons (starting with the Rocket Launcher), Fall-Guys tumble VFX,
 * a lower-left 4-way D-Pad, and the lower-right cartoon Weapon Wheel.
 */

// ---------------------------------------------------------------------------
// Painterly procedural canvas textures (TF2 stylized illustrative aesthetic)
// ---------------------------------------------------------------------------

function makeCanvasTex(w, h, draw, { repeatX = 1, repeatY = 1 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeatX !== 1 || repeatY !== 1) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
  }
  return tex;
}

function createStylizedWaterTexture({ isWaterfall = false } = {}) {
  const tex = makeCanvasTex(256, 256, (ctx, w, h) => {
    // Rich TF2 stylized mountain stream turquoise gradient across channel width
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    if (isWaterfall) {
      grad.addColorStop(0.0, '#d8f6ff');
      grad.addColorStop(0.14, '#54c7de');
      grad.addColorStop(0.5, '#30a6c7');
      grad.addColorStop(0.86, '#54c7de');
      grad.addColorStop(1.0, '#d8f6ff');
    } else {
      grad.addColorStop(0.0, '#a9e6f0');
      grad.addColorStop(0.16, '#3cb5cf');
      grad.addColorStop(0.5, '#248eb0');
      grad.addColorStop(0.84, '#3cb5cf');
      grad.addColorStop(1.0, '#a9e6f0');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Painterly flowing current ribbons (seamlessly tiled vertically!)
    let s = isWaterfall ? 2027 : 5153;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };

    const streakCount = isWaterfall ? 48 : 34;
    ctx.lineCap = 'round';
    for (let i = 0; i < streakCount; i++) {
      const x = 14 + rand() * (w - 28);
      const y = rand() * h;
      const len = isWaterfall ? (32 + rand() * 58) : (22 + rand() * 44);
      const isBright = rand() > (isWaterfall ? 0.35 : 0.55);
      ctx.strokeStyle = isBright
        ? (isWaterfall ? 'rgba(242, 252, 255, 0.72)' : 'rgba(224, 248, 255, 0.52)')
        : 'rgba(18, 92, 120, 0.28)';
      ctx.lineWidth = isWaterfall ? (3 + rand() * 5.5) : (2.5 + rand() * 4);

      for (const offset of [0, -h, h]) {
        ctx.beginPath();
        ctx.moveTo(x, y + offset);
        ctx.bezierCurveTo(
          x + (rand() - 0.5) * 10,
          y + offset + len * 0.35,
          x + (rand() - 0.5) * 10,
          y + offset + len * 0.7,
          x,
          y + offset + len,
        );
        ctx.stroke();
      }
    }

    // Soft bright shoreline / edge foam scallops
    ctx.fillStyle = 'rgba(245, 253, 255, 0.45)';
    for (let y = 0; y < h; y += 24) {
      ctx.beginPath();
      ctx.ellipse(8, y + 10, 8, 12, 0, 0, Math.PI * 2);
      ctx.ellipse(w - 8, y + 18, 8, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { repeatX: 1, repeatY: isWaterfall ? 2 : 5 });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createPainterlyTerrainTexture() {
  return makeCanvasTex(512, 512, (ctx, w, h) => {
    // Rich sunlit meadow base (vertex colors will tint cliffs to grey rock!)
    ctx.fillStyle = '#c8d6a8';
    ctx.fillRect(0, 0, w, h);

    // Broad painterly brushstrokes for organic TF2 gouache feel
    let s = 1337;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };

    for (let i = 0; i < 650; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const rw = 14 + rand() * 34;
      const rh = 6 + rand() * 14;
      const ang = rand() * Math.PI;
      const tone = rand();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.fillStyle = tone < 0.33
        ? 'rgba(255, 252, 230, 0.14)'
        : tone < 0.66
          ? 'rgba(85, 110, 50, 0.14)'
          : 'rgba(130, 155, 75, 0.16)';
      ctx.beginPath();
      ctx.ellipse(0, 0, rw, rh, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Subtle crisp grass tuft accents
    ctx.lineCap = 'round';
    for (let i = 0; i < 420; i++) {
      const x = rand() * w;
      const y = rand() * h;
      ctx.strokeStyle = rand() > 0.5 ? 'rgba(65, 92, 36, 0.22)' : 'rgba(225, 238, 170, 0.22)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rand() - 0.5) * 6, y - 4 - rand() * 5);
      ctx.stroke();
    }
  }, { repeatX: 3, repeatY: 2 });
}

function createPainterlyRockTexture() {
  return makeCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#928e83';
    ctx.fillRect(0, 0, w, h);
    let s = 4049;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    // Layered horizontal limestone strata brushstrokes
    for (let i = 0; i < 180; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const bw = 20 + rand() * 55;
      const bh = 6 + rand() * 14;
      ctx.fillStyle = rand() > 0.5
        ? 'rgba(218, 212, 196, 0.18)'
        : 'rgba(68, 66, 60, 0.22)';
      ctx.fillRect(x - bw / 2, y - bh / 2, bw, bh);
    }
    // Painterly crack lines
    ctx.strokeStyle = 'rgba(48, 46, 42, 0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 24; i++) {
      const x = rand() * w;
      const y = rand() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rand() - 0.5) * 44, y + (rand() - 0.5) * 28);
      ctx.stroke();
    }
  });
}

function createPainterlyWoodTexture(base = '#8e5b32', dark = '#5a3519', light = '#b47c48') {
  return makeCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    let s = 9001;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    // Painted grain streaks
    for (let i = 0; i < 140; i++) {
      const y = rand() * h;
      ctx.strokeStyle = rand() > 0.45 ? dark : light;
      ctx.globalAlpha = 0.22 + rand() * 0.22;
      ctx.lineWidth = 1.5 + rand() * 3;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.33, y + (rand() - 0.5) * 10, w * 0.66, y + (rand() - 0.5) * 10, w, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Plank seam lines
    ctx.fillStyle = 'rgba(34, 18, 8, 0.45)';
    for (let p = 1; p < 4; p++) {
      ctx.fillRect(0, Math.floor((h / 4) * p), w, 3);
    }
  });
}

function createPandaFaceTexture(mode = 'happy') {
  // Mapped onto a sphere (u=0.5 is front +Z if sphere rotated -PI/2 around Y)
  return makeCanvasTex(256, 256, (ctx, w, h) => {
    // Warm cream ivory panda head fur
    ctx.fillStyle = '#f3ede0';
    ctx.fillRect(0, 0, w, h);

    // Subtle painterly warm-shadow gradient around cheeks & chin
    const grad = ctx.createRadialGradient(w * 0.5, h * 0.48, 18, w * 0.5, h * 0.5, 118);
    grad.addColorStop(0, 'rgba(255, 252, 244, 0.5)');
    grad.addColorStop(0.75, 'rgba(225, 214, 195, 0.25)');
    grad.addColorStop(1, 'rgba(195, 182, 162, 0.45)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Face sits centered at (128, 128)
    const cx = w * 0.5;
    const cy = h * 0.5;

    // Adorable tilted oval black eye patches
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(cx + side * 27, cy - 6);
      ctx.rotate(side * 0.24);
      ctx.fillStyle = '#222127';
      ctx.beginPath();
      ctx.ellipse(0, 0, 17, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Rosy fat-and-happy cheek blush
    for (const side of [-1, 1]) {
      ctx.fillStyle = 'rgba(235, 145, 140, 0.36)';
      ctx.beginPath();
      ctx.ellipse(cx + side * 38, cy + 16, 11, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (mode === 'sleepy') {
      // Blissful curved closed sleeping eyes
      ctx.strokeStyle = '#f3ede0';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(cx + side * 26, cy - 5, 8, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
      }
    } else {
      // Cheerful, nonchalant glossy eyes (NEVER angry or scared!)
      for (const side of [-1, 1]) {
        const ex = cx + side * 25;
        const ey = cy - 7;
        // Soft warm white eye ring so dark eyes pop playfully against black patch
        ctx.fillStyle = '#f8f5ec';
        ctx.beginPath();
        ctx.arc(ex, ey, 6.2, 0, Math.PI * 2);
        ctx.fill();

        // Slightly goofy off-center pupil when 'goofy' (holding rocket launcher!)
        const lookX = mode === 'goofy' ? side * 0.8 : 0;
        const lookY = mode === 'goofy' ? -0.6 : 0.4;
        ctx.fillStyle = '#141318';
        ctx.beginPath();
        ctx.arc(ex + lookX, ey + lookY, 4.1, 0, Math.PI * 2);
        ctx.fill();

        // Bright cartoon catchlight sparkle
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(ex + lookX - 1.5, ey + lookY - 1.6, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Cute shiny button nose
    ctx.fillStyle = '#242228';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 12, 9, 6.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.ellipse(cx - 2.5, cy + 10, 2.8, 1.4, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // Gentle happy ':3' smile
    ctx.strokeStyle = '#2d2825';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy + 18);
    ctx.lineTo(cx, cy + 23);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx - 7, cy + 23, 7, 0.05 * Math.PI, 0.82 * Math.PI);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx + 7, cy + 23, 7, 0.18 * Math.PI, 0.95 * Math.PI);
    ctx.stroke();
  });
}

function createRamenTopTexture() {
  return makeCanvasTex(128, 128, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    // Rich golden miso-tonkotsu broth
    const grad = ctx.createRadialGradient(cx, cy, 8, cx, cy, 60);
    grad.addColorStop(0, '#e8a838');
    grad.addColorStop(0.75, '#c97b22');
    grad.addColorStop(1, '#9c5414');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Wavy golden ramen noodles
    ctx.strokeStyle = '#f5d96b';
    ctx.lineWidth = 4.2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const y = 26 + i * 5.6;
      ctx.beginPath();
      ctx.moveTo(20, y);
      for (let x = 24; x <= 108; x += 12) {
        ctx.lineTo(x, y + Math.sin(x * 0.28 + i) * 4);
      }
      ctx.stroke();
    }

    // Pink-and-white narutomaki fishcake swirl
    ctx.fillStyle = '#fff9f2';
    ctx.beginPath();
    ctx.arc(cx - 18, cy - 12, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ec6a92';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    for (let t = 0; t < 16; t++) {
      const a = t * 0.55;
      const r = t * 0.62;
      const px = cx - 18 + Math.cos(a) * r;
      const py = cy - 12 + Math.sin(a) * r;
      if (t === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Half soft-boiled ramen egg
    ctx.fillStyle = '#fffdf7';
    ctx.beginPath();
    ctx.ellipse(cx + 18, cy + 10, 14, 11, 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(cx + 18, cy + 10, 6.5, 0, Math.PI * 2);
    ctx.fill();

    // Chopped green scallions
    ctx.fillStyle = '#4f9c35';
    for (const [sx, sy] of [[cx + 4, cy - 20], [cx + 16, cy - 14], [cx - 8, cy + 18], [cx - 24, cy + 8], [cx + 2, cy + 4]]) {
      ctx.beginPath();
      ctx.arc(sx, sy, 3.8, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function createMelonTexture() {
  return makeCanvasTex(128, 64, (ctx, w, h) => {
    ctx.fillStyle = '#5bb842';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#235e20';
    for (let x = 0; x < w; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 7, 0);
      ctx.lineTo(x + 9, h * 0.5);
      ctx.lineTo(x + 6, h);
      ctx.lineTo(x - 1, h);
      ctx.lineTo(x + 2, h * 0.5);
      ctx.closePath();
      ctx.fill();
    }
  });
}

function createWarheadTexture() {
  // Whimsical painted olive/magenta/yellow polka-dot rocket nosecone (exact match to image!)
  return makeCanvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#7b993e';
    ctx.fillRect(0, 0, w, h);
    // Magenta front nose band
    ctx.fillStyle = '#d45294';
    ctx.fillRect(0, 0, w, h * 0.44);
    // Yellow chevron / stripe band
    ctx.fillStyle = '#f5dd3d';
    ctx.fillRect(0, h * 0.42, w, h * 0.14);
    // Playful yellow polka dots on magenta
    ctx.fillStyle = '#f7e44c';
    for (let x = 14; x < w; x += 28) {
      ctx.beginPath();
      ctx.arc(x, h * 0.22, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    // Soft olive dots on base
    ctx.fillStyle = '#5c752b';
    for (let x = 20; x < w; x += 30) {
      ctx.beginPath();
      ctx.arc(x, h * 0.75, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function makeBadgeSprite(text, bgColor, textColor = '#ffffff') {
  const tex = makeCanvasTex(256, 64, (ctx, w, h) => {
    ctx.font = '900 28px "Trebuchet MS", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = Math.min(w - 28, ctx.measureText(text).width + 26);
    const rx = (w - tw) / 2;
    const ry = 10;
    const rh = h - 20;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.beginPath();
    ctx.roundRect(rx, ry, tw, rh, 14);
    ctx.fill();

    ctx.lineWidth = 4;
    ctx.strokeStyle = bgColor;
    ctx.stroke();

    ctx.lineWidth = 4;
    ctx.strokeStyle = '#111827';
    ctx.strokeText(text, w / 2, h / 2 + 1);
    ctx.fillStyle = textColor;
    ctx.fillText(text, w / 2, h / 2 + 1);
  });
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(2.05, 0.52, 1);
  return sp;
}

// ---------------------------------------------------------------------------
// Whimsical Fall-Guys / Cartoon Sound Effects
// ---------------------------------------------------------------------------

const sfx = {
  wheelClick() {
    sound._tone({ type: 'triangle', f0: 540, f1: 720, duration: 0.055, gain: 0.1 });
  },
  hop() {
    sound._tone({ type: 'sine', f0: 260, f1: 560, duration: 0.12, gain: 0.11 });
  },
  fire(weaponId) {
    if (weaponId === 'rocket-launcher') {
      sound._tone({ type: 'sawtooth', f0: 220, f1: 95, duration: 0.22, gain: 0.14 });
      sound.playNoise({ duration: 0.24, freq: 900, q: 0.7, gain: 0.14, type: 'bandpass' });
    } else if (weaponId === 'bouncing-tire') {
      sound._tone({ type: 'sine', f0: 180, f1: 420, duration: 0.16, gain: 0.14 });
    } else if (weaponId === 'ramen-bomb') {
      sound._tone({ type: 'triangle', f0: 360, f1: 580, duration: 0.16, gain: 0.12 });
    } else if (weaponId === 'bamboo-bazooka') {
      sound._tone({ type: 'triangle', f0: 640, f1: 320, duration: 0.11, gain: 0.13 });
    } else {
      sound._tone({ type: 'sine', f0: 320, f1: 680, duration: 0.15, gain: 0.13 });
    }
  },
  boing() {
    sound._tone({ type: 'sine', f0: 190, f1: 620, duration: 0.18, gain: 0.15 });
  },
  explosion(weaponId) {
    if (weaponId === 'ramen-bomb') {
      sound.playNoise({ duration: 0.32, freq: 1400, q: 0.9, gain: 0.16, type: 'bandpass' });
      sound._tone({ type: 'sine', f0: 260, f1: 90, duration: 0.22, gain: 0.14 });
    } else {
      sound.playNoise({ duration: 0.28, freq: 450, q: 0.6, gain: 0.18, type: 'lowpass' });
      sound._tone({ type: 'triangle', f0: 190, f1: 55, duration: 0.26, gain: 0.16 });
    }
  },
  bonk() {
    sound._tone({ type: 'triangle', f0: 420, f1: 190, duration: 0.12, gain: 0.12 });
  },
  ramenTaken() {
    sound.playNotes([[523.25, 1], [659.25, 1], [783.99, 1], [1046.5, 2]], { type: 'triangle', step: 0.065, gain: 0.12 });
  },
  sleep() {
    sound.playNotes([[523.25, 1.5], [440, 1.5], [392, 2.5]], { type: 'sine', step: 0.11, gain: 0.08 });
  },
  splash() {
    sound.playNoise({ duration: 0.28, freq: 1850, q: 0.7, gain: 0.14, type: 'bandpass' });
    sound._tone({ type: 'sine', f0: 360, f1: 150, duration: 0.18, gain: 0.1 });
  },
  win() {
    sound.playWin();
  },
};

// ---------------------------------------------------------------------------
// 3D Geometry Builders (Ramen Bowl, Whimsical Weapons, Pandas, Diorama Props)
// ---------------------------------------------------------------------------

function createRamenBowl(mats, teamIdx = 0, scale = 1.0) {
  const g = new THREE.Group();
  const bowlMat = teamIdx === 0 ? mats.bowlRed : mats.bowlBlue;

  // Classic flared ceramic ramen bowl (LatheGeometry!)
  const pts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.11, 0.0),
    new THREE.Vector2(0.13, 0.04),
    new THREE.Vector2(0.22, 0.13),
    new THREE.Vector2(0.245, 0.19),
    new THREE.Vector2(0.225, 0.195),
    new THREE.Vector2(0.19, 0.12),
    new THREE.Vector2(0.0, 0.10),
  ];
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(pts, 18), bowlMat);
  bowl.castShadow = true;
  bowl.receiveShadow = true;
  g.add(bowl);

  // Cream/gold rim ring
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.236, 0.015, 8, 20), mats.cream);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.19;
  g.add(rim);

  // Steaming noodle & broth top surface
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.215, 16), mats.ramenTop);
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.168;
  g.add(top);

  // Cute sculpted noodle mound puff
  const noodlePuff = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), mats.noodles);
  noodlePuff.scale.set(1.2, 0.35, 1.15);
  noodlePuff.position.set(0, 0.175, 0);
  g.add(noodlePuff);

  // Pair of wooden chopsticks resting across the bowl rim
  const stickGeo = new THREE.CylinderGeometry(0.008, 0.013, 0.44, 6);
  const c1 = new THREE.Mesh(stickGeo, mats.chopstick);
  c1.position.set(0.07, 0.24, 0.02);
  c1.rotation.set(0.18, 0.25, -1.05);
  const c2 = new THREE.Mesh(stickGeo, mats.chopstick);
  c2.position.set(0.09, 0.25, -0.04);
  c2.rotation.set(-0.1, 0.35, -0.98);
  g.add(c1, c2);

  // Delicate animated steam wisps
  const steam = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.036, 7, 6), mats.steam);
    puff.position.set((i - 1) * 0.06, 0.26 + i * 0.07, (i % 2 - 0.5) * 0.05);
    steam.add(puff);
  }
  g.add(steam);
  g.userData.steam = steam;

  g.scale.setScalar(scale);
  return g;
}

function createWeaponModel(weaponId, mats) {
  const g = new THREE.Group();

  if (weaponId === 'rocket-launcher') {
    // Stylized TF2-style chunky Rocket Launcher matching image.png!
    // Barrel points along +Z
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.88, 12), mats.olive);
    tube.rotation.x = Math.PI / 2;
    tube.position.z = 0.08;
    tube.castShadow = true;
    g.add(tube);

    // Warm wooden mid-grip sleeve
    const wood = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.12, 0.38, 12), mats.wood);
    wood.rotation.x = Math.PI / 2;
    wood.position.z = -0.18;
    wood.castShadow = true;
    g.add(wood);

    // Gunmetal collar clamps
    for (const zPos of [-0.36, 0.02, 0.36]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.132, 0.132, 0.06, 12), mats.gunmetal);
      band.rotation.x = Math.PI / 2;
      band.position.z = zPos;
      g.add(band);
    }

    // Flared slate-blue rear exhaust funnel
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.195, 0.26, 14), mats.exhaustBlue);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.z = -0.5;
    exhaust.castShadow = true;
    g.add(exhaust);

    // Chunky whimsical painted warhead poking out the front!
    const warhead = new THREE.Mesh(new THREE.SphereGeometry(0.165, 14, 12), mats.warhead);
    warhead.scale.set(1.0, 1.0, 1.65);
    warhead.position.z = 0.62;
    warhead.castShadow = true;
    g.add(warhead);

    // Underslung cartoon trigger handle
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.1), mats.gunmetal);
    grip.position.set(0, -0.16, -0.05);
    grip.rotation.x = 0.22;
    g.add(grip);
    g.scale.setScalar(1.22);
  } else if (weaponId === 'ramen-bomb') {
    const megaBowl = createRamenBowl(mats, 0, 1.45);
    megaBowl.position.set(0, -0.08, 0.25);
    g.add(megaBowl);
  } else if (weaponId === 'bouncing-tire') {
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.10, 10, 18), mats.tireRubber);
    tire.position.set(0, 0.02, 0.24);
    tire.rotation.y = Math.PI / 2;
    tire.castShadow = true;
    g.add(tire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.14, 12), mats.gunmetal);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(0, 0.02, 0.24);
    g.add(hub);
  } else if (weaponId === 'bamboo-bazooka') {
    const main = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 1.05, 10), mats.bambooLight);
    main.rotation.x = Math.PI / 2;
    main.position.z = 0.1;
    main.castShadow = true;
    g.add(main);
    for (const zPos of [-0.32, -0.04, 0.24, 0.52]) {
      const node = new THREE.Mesh(new THREE.TorusGeometry(0.122, 0.02, 6, 12), mats.bambooNode);
      node.position.z = zPos;
      g.add(node);
    }
    // Side mini-tubes
    for (const side of [-1, 1]) {
      const mini = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.72, 8), mats.bambooDark);
      mini.rotation.x = Math.PI / 2;
      mini.position.set(side * 0.13, -0.03, 0.18);
      g.add(mini);
    }
  } else if (weaponId === 'dumpling-drop') {
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.23, 0.16, 14), mats.woodLight);
    basket.position.set(0, -0.02, 0.24);
    basket.castShadow = true;
    g.add(basket);
    for (const [dx, dz] of [[-0.09, -0.06], [0.09, -0.05], [0, 0.09], [0, -0.01]]) {
      const bao = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), mats.dumpling);
      bao.scale.set(1, 0.78, 1);
      bao.position.set(dx, 0.11, 0.24 + dz);
      g.add(bao);
    }
  } else if (weaponId === 'melon-cannon') {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.65, 12), mats.wood);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.04;
    barrel.castShadow = true;
    g.add(barrel);
    const melon = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), mats.melon);
    melon.position.set(0, 0.01, 0.42);
    melon.castShadow = true;
    g.add(melon);
  }

  return g;
}

function createProjectileMesh(weaponId, mats, isSub = false) {
  const g = new THREE.Group();
  if (weaponId === 'rocket-launcher') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), mats.warhead);
    body.scale.set(0.85, 0.85, 1.85);
    body.castShadow = true;
    g.add(body);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.16), mats.gunmetal);
    fin.position.z = -0.22;
    const fin2 = fin.clone();
    fin2.rotation.z = Math.PI / 2;
    g.add(fin, fin2);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mats.flame);
    glow.position.z = -0.32;
    g.add(glow);
  } else if (weaponId === 'ramen-bomb') {
    const bowl = createRamenBowl(mats, 0, 1.35);
    bowl.position.y = -0.12;
    g.add(bowl);
  } else if (weaponId === 'bouncing-tire') {
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.11, 10, 18), mats.tireRubber);
    tire.castShadow = true;
    g.add(tire);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.16, 12), mats.gunmetal);
    rim.rotation.x = Math.PI / 2;
    g.add(rim);
  } else if (weaponId === 'bamboo-bazooka') {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.08, 0.56, 8), mats.bambooLight);
    stalk.rotation.x = Math.PI / 2;
    stalk.castShadow = true;
    g.add(stalk);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.18, 8), mats.bowlRed);
    tip.rotation.x = Math.PI / 2;
    tip.position.z = 0.34;
    g.add(tip);
  } else if (weaponId === 'dumpling-drop') {
    const sc = isSub ? 0.65 : 1.15;
    const bao = new THREE.Mesh(new THREE.SphereGeometry(0.22 * sc, 12, 10), mats.dumpling);
    bao.scale.set(1.05, 0.82, 1.05);
    bao.castShadow = true;
    g.add(bao);
    const pinch = new THREE.Mesh(new THREE.ConeGeometry(0.07 * sc, 0.09 * sc, 8), mats.dumpling);
    pinch.position.y = 0.19 * sc;
    g.add(pinch);
  } else if (weaponId === 'melon-cannon') {
    const melon = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), mats.melon);
    melon.castShadow = true;
    g.add(melon);
  }
  return g;
}

/**
 * Builds a plump, fat-and-happy stylized 3D Panda Bear matching image.png.
 * Every panda is the EXACT same scale and lives ON the board, complete with
 * their own steaming bowl of ramen, bamboo stick, team bandana, and swappable
 * whimsical weapon mount.
 */
function createPandaVisual(pandaData, mats) {
  const root = new THREE.Group();

  // Soft contact shadow decal underneath
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.56, 18),
    new THREE.MeshBasicMaterial({ color: 0x162210, transparent: true, opacity: 0.32, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.025;
  root.add(shadow);

  // Subtle team halo ring shown when this panda is the active turn panda!
  const teamColor = TEAMS[pandaData.team].color;
  const activeRing = new THREE.Mesh(
    new THREE.RingGeometry(0.56, 0.72, 28),
    new THREE.MeshBasicMaterial({ color: teamColor, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  activeRing.rotation.x = -Math.PI / 2;
  activeRing.position.y = 0.04;
  activeRing.visible = false;
  root.add(activeRing);

  // Main tumbling/body pivot
  const body = new THREE.Group();
  root.add(body);

  // Big round chubby cream belly (pear-shaped!)
  const torso = new THREE.Group();
  torso.position.y = 0.44;
  body.add(torso);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), mats.pandaCream);
  belly.scale.set(1.06, 0.96, 1.02);
  belly.castShadow = true;
  belly.receiveShadow = true;
  torso.add(belly);

  // Black shoulder-and-chest saddle band (classic panda markings)
  const saddle = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 12), mats.pandaBlack);
  saddle.scale.set(1.05, 0.52, 0.96);
  saddle.position.set(0, 0.24, -0.02);
  saddle.castShadow = true;
  torso.add(saddle);

  // Cute stubby white/cream tail in back
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.10, 10, 8), mats.pandaCream);
  tail.position.set(0, -0.14, -0.39);
  torso.add(tail);

  // Cozy TF2-style Team Bandana / Neckerchief around the neck!
  const bandanaMat = pandaData.team === 0 ? mats.teamRed : mats.teamBlue;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 8, 18), bandanaMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, 0.36, 0.01);
  torso.add(collar);
  const knot = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.18, 4), bandanaMat);
  knot.position.set(0, 0.28, -0.25);
  knot.rotation.set(-0.65, 0, 0);
  torso.add(knot);

  // Adorable chubby round head with painted happy/goofy/sleepy face texture!
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.62, 0.04);
  torso.add(headGroup);

  const faceMat = mats.faceHappy.clone();
  const headSphere = new THREE.Mesh(new THREE.SphereGeometry(0.31, 20, 16), faceMat);
  headSphere.scale.set(1.06, 0.96, 1.02);
  headSphere.rotation.y = -Math.PI / 2; // Align canvas center (u=0.5) to +Z front!
  headSphere.castShadow = true;
  headGroup.add(headSphere);

  // Round black ears perched high on the head
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 10), mats.pandaBlack);
    ear.scale.set(1.0, 1.0, 0.72);
    ear.position.set(side * 0.23, 0.24, -0.02);
    ear.castShadow = true;
    headGroup.add(ear);
  }

  // Stubby chubby arms (pivoted at shoulders)
  const makeArm = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.34, 0.24, 0.04);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.24, 6, 10), mats.pandaBlack);
    arm.position.set(side * 0.04, -0.14, 0.05);
    arm.rotation.z = side * 0.22;
    arm.castShadow = true;
    pivot.add(arm);
    return pivot;
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);
  torso.add(armL, armR);

  // Stubby chubby black legs with light grey-tan paw pads!
  const makeLeg = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.23, -0.24, 0.08);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.125, 0.22, 6, 10), mats.pandaBlack);
    leg.position.set(0, -0.08, 0.06);
    leg.rotation.x = Math.PI * 0.44;
    leg.castShadow = true;
    pivot.add(leg);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.085, 10), mats.pawPad);
    pad.position.set(0, -0.10, 0.29);
    pivot.add(pad);
    return pivot;
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);
  torso.add(legL, legR);

  // Personal bamboo stick (shown when idlePose === 'bamboo_sit')
  const bambooStick = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.62, 8), mats.bambooLight);
  bambooStick.position.set(0.04, 0.26, 0.34);
  bambooStick.rotation.set(0.2, 0.15, 0.68);
  bambooStick.castShadow = true;
  torso.add(bambooStick);

  // Every panda has their own steaming bowl of ramen!
  // Mounted on belly/paws OR placed right beside them on the grass/ledge!
  const bellyRamen = createRamenBowl(mats, pandaData.team, 0.88);
  bellyRamen.position.set(0, 0.08, 0.36);
  torso.add(bellyRamen);

  const groundRamen = createRamenBowl(mats, pandaData.team, 0.96);
  groundRamen.position.set(0.54, 0.01, 0.36);
  root.add(groundRamen);

  // Weapon mount (over right shoulder / held clumsily in paws when active!)
  const weaponMount = new THREE.Group();
  weaponMount.position.set(0.28, 0.34, 0.18);
  torso.add(weaponMount);

  const weaponMeshes = {};
  for (const w of WEAPONS) {
    const wm = createWeaponModel(w.id, mats);
    wm.visible = false;
    weaponMount.add(wm);
    weaponMeshes[w.id] = wm;
  }

  // Compact floating ramen-grip HP bar (visible when active or damaged)
  const hpCanvas = document.createElement('canvas');
  hpCanvas.width = 128;
  hpCanvas.height = 36;
  const hpTex = new THREE.CanvasTexture(hpCanvas);
  hpTex.colorSpace = THREE.SRGBColorSpace;
  const hpSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: hpTex, transparent: true, depthTest: false }));
  hpSprite.position.set(0, 1.52, 0);
  hpSprite.scale.set(1.22, 0.34, 1);
  root.add(hpSprite);

  return {
    root,
    body,
    torso,
    headGroup,
    faceMat,
    armL,
    armR,
    legL,
    legR,
    bambooStick,
    bellyRamen,
    groundRamen,
    weaponMount,
    weaponMeshes,
    activeRing,
    shadow,
    hpCanvas,
    hpTex,
    hpSprite,
    hpKey: '',
    faceMode: 'happy',
    targetX: pandaData.x,
    targetY: pandaData.y,
    targetZ: pandaData.z,
    targetYaw: pandaData.yaw,
    state: pandaData,
    zzzTimer: 0,
  };
}

// ---------------------------------------------------------------------------
// Lower-Right Illustrated Cartoon Weapon Wheel (matching image.png!)
// ---------------------------------------------------------------------------

function weaponIconSvg(id) {
  switch (id) {
    case 'rocket-launcher':
      return `
        <g transform="rotate(-24)">
          <polygon points="-24,-7 -16,-4 -16,4 -24,7" fill="#6d8f9e" stroke="#111" stroke-width="2"/>
          <rect x="-16" y="-5" width="12" height="10" rx="2" fill="#9c6234" stroke="#111" stroke-width="2"/>
          <rect x="-4" y="-6" width="18" height="12" rx="2" fill="#779642" stroke="#111" stroke-width="2"/>
          <ellipse cx="18" cy="0" rx="8" ry="6" fill="#d95397" stroke="#111" stroke-width="2"/>
          <circle cx="17" cy="-2" r="2" fill="#f7e231"/>
          <circle cx="20" cy="2" r="1.6" fill="#f7e231"/>
        </g>`;
    case 'ramen-bomb':
      return `
        <g>
          <path d="M-16,-2 Q-14,13 0,13 Q14,13 16,-2 Z" fill="#d43f33" stroke="#111" stroke-width="2"/>
          <ellipse cx="0" cy="-2" rx="16" ry="5" fill="#f5d565" stroke="#111" stroke-width="1.8"/>
          <line x1="-2" y1="-4" x2="17" y2="-16" stroke="#8a5a30" stroke-width="2.6" stroke-linecap="round"/>
          <line x1="3" y1="-3" x2="20" y2="-12" stroke="#8a5a30" stroke-width="2.6" stroke-linecap="round"/>
          <path d="M-8,-10 Q-10,-16 -6,-19 M0,-11 Q-2,-17 2,-20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        </g>`;
    case 'bouncing-tire':
      return `
        <g>
          <circle cx="0" cy="0" r="15" fill="#3a3d45" stroke="#111" stroke-width="2.4"/>
          <circle cx="0" cy="0" r="7" fill="#94a3b8" stroke="#111" stroke-width="2"/>
          <circle cx="0" cy="0" r="3" fill="#1e293b"/>
          <path d="M-14,-4 L-10,-2 M14,4 L10,2 M-4,14 L-2,10 M4,-14 L2,-10" stroke="#111" stroke-width="2"/>
        </g>`;
    case 'bamboo-bazooka':
      return `
        <g transform="rotate(-26)">
          <rect x="-20" y="-6" width="40" height="12" rx="3" fill="#77b83c" stroke="#111" stroke-width="2"/>
          <line x1="-8" y1="-6" x2="-8" y2="6" stroke="#2c4f18" stroke-width="2.5"/>
          <line x1="6" y1="-6" x2="6" y2="6" stroke="#2c4f18" stroke-width="2.5"/>
          <rect x="-6" y="6" width="6" height="8" rx="1" fill="#8b5a30" stroke="#111" stroke-width="1.8"/>
        </g>`;
    case 'dumpling-drop':
      return `
        <g>
          <path d="M-15,1 Q-13,13 0,13 Q13,13 15,1 Z" fill="#c79557" stroke="#111" stroke-width="2"/>
          <ellipse cx="-6" cy="-2" rx="7" ry="6" fill="#f3e8ff" stroke="#111" stroke-width="1.8"/>
          <ellipse cx="6" cy="-2" rx="7" ry="6" fill="#e9d5ff" stroke="#111" stroke-width="1.8"/>
          <ellipse cx="0" cy="-7" rx="7" ry="6" fill="#f5f3ff" stroke="#111" stroke-width="1.8"/>
        </g>`;
    case 'melon-cannon':
      return `
        <g>
          <circle cx="0" cy="0" r="14" fill="#52b83e" stroke="#111" stroke-width="2.2"/>
          <path d="M-6,-13 Q-10,0 -6,13 M0,-14 Q-2,0 0,14 M6,-13 Q10,0 6,13" fill="none" stroke="#1e591b" stroke-width="2.5"/>
          <path d="M0,-14 Q4,-18 7,-16" fill="none" stroke="#5a381e" stroke-width="2.2" stroke-linecap="round"/>
        </g>`;
    default:
      return '';
  }
}

function createWeaponWheelOverlay({ onSelectWeapon, onCycleArc, onDpad }) {
  const wrap = document.createElement('div');
  wrap.className = 'panda-ui-layer';

  // Top-center Turn, Ramen Scoreboard & Wind Pill
  const topBanner = document.createElement('div');
  topBanner.className = 'panda-turn-banner';
  topBanner.innerHTML = `
    <div class="panda-score-chip red">
      <span class="panda-team-dot red"></span>
      <span id="pandaRedScore">🍜 4</span>
    </div>
    <div class="panda-turn-center">
      <div id="pandaTurnLabel" class="panda-turn-title">Red Team — Mochi</div>
      <div class="panda-turn-sub">
        <span id="pandaTimerText">28s</span>
        <span class="panda-sep">•</span>
        <span id="pandaWindText">🍃 Breeze</span>
      </div>
    </div>
    <div class="panda-score-chip blue">
      <span id="pandaBlueScore">4 🍜</span>
      <span class="panda-team-dot blue"></span>
    </div>
  `;
  wrap.appendChild(topBanner);

  // Lower-left Precision 4-Way D-Pad (Up/Down = Distance, Left/Right = Direction)
  const dpadWrap = document.createElement('div');
  dpadWrap.className = 'panda-dpad-wrap';
  dpadWrap.setAttribute('aria-label', 'Aim and Distance D-Pad');
  dpadWrap.innerHTML = `
    <div class="panda-dpad">
      <button type="button" class="dpad-btn dpad-up" data-dx="0" data-dy="1" aria-label="Farther">
        <span class="dpad-arrow">▲</span>
        <span class="dpad-tag">FAR</span>
      </button>
      <button type="button" class="dpad-btn dpad-left" data-dx="-1" data-dy="0" aria-label="Aim Left">
        <span class="dpad-arrow">◀</span>
      </button>
      <div class="dpad-center" aria-hidden="true">
        <span class="dpad-center-lbl">DIST</span>
        <span id="pandaDistPct" class="dpad-center-val">50%</span>
      </div>
      <button type="button" class="dpad-btn dpad-right" data-dx="1" data-dy="0" aria-label="Aim Right">
        <span class="dpad-arrow">▶</span>
      </button>
      <button type="button" class="dpad-btn dpad-down" data-dx="0" data-dy="-1" aria-label="Closer">
        <span class="dpad-tag">NEAR</span>
        <span class="dpad-arrow">▼</span>
      </button>
    </div>
    <div class="control-caption">RANGE ▲▼ • AIM ◀▶</div>
  `;
  wrap.appendChild(dpadWrap);

  const dpadButtons = [...dpadWrap.querySelectorAll('.dpad-btn')];
  const activeDpadPointers = new Map(); // pointerId -> { dx, dy, btn }
  const emitDpad = () => {
    let dpadX = 0;
    let dpadY = 0;
    for (const v of activeDpadPointers.values()) {
      if (v.dx !== 0) dpadX = v.dx;
      if (v.dy !== 0) dpadY = v.dy;
    }
    onDpad({ dpadX, dpadY });
  };

  for (const btn of dpadButtons) {
    const dx = Number(btn.dataset.dx);
    const dy = Number(btn.dataset.dy);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sound.unlock();
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('pressed');
      activeDpadPointers.set(e.pointerId, { dx, dy, btn });
      emitDpad();
    });
    const release = (e) => {
      if (!activeDpadPointers.has(e.pointerId)) return;
      e.preventDefault();
      activeDpadPointers.delete(e.pointerId);
      const stillHeld = [...activeDpadPointers.values()].some((v) => v.btn === btn);
      if (!stillHeld) btn.classList.remove('pressed');
      emitDpad();
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
  }

  const onBlur = () => {
    if (activeDpadPointers.size > 0) {
      activeDpadPointers.clear();
      for (const b of dpadButtons) b.classList.remove('pressed');
      onDpad({ dpadX: 0, dpadY: 0 });
    }
  };
  window.addEventListener('blur', onBlur);

  // Lower-right Illustrated Cartoon Weapon Wheel!
  const wheelWrap = document.createElement('div');
  wheelWrap.className = 'panda-weapon-wheel';
  wheelWrap.setAttribute('aria-label', 'Weapon Wheel');

  const size = 224;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = 105;
  const innerR = 28;

  // Hand-tuned (iconX, iconY, textX, textY) per slice so every label sits cleanly inside its wedge
  const SLICE_LAYOUT = [
    { ix: 112, iy: 58, tx: 112, ty: 26 }, // 0: top (rocket launcher)
    { ix: 169, iy: 72, tx: 170, ty: 97 }, // 1: top-right (ramen bomb)
    { ix: 169, iy: 132, tx: 168, ty: 158 }, // 2: bottom-right (bouncing tire)
    { ix: 112, iy: 160, tx: 112, ty: 186 }, // 3: bottom (bamboo bazooka)
    { ix: 55, iy: 132, tx: 56, ty: 158 }, // 4: bottom-left (dumpling drop)
    { ix: 55, iy: 72, tx: 54, ty: 97 }, // 5: top-left (melon cannon)
  ];

  // 6 slices starting centered at top (-90 deg) clockwise, matching image.png!
  const sliceButtons = new Map();
  let slicesMarkup = '';
  WEAPONS.forEach((w, idx) => {
    const startDeg = -120 + idx * 60;
    const endDeg = startDeg + 60;
    const sRad = (startDeg * Math.PI) / 180;
    const eRad = (endDeg * Math.PI) / 180;

    const x1 = cx + Math.cos(sRad) * outerR;
    const y1 = cy + Math.sin(sRad) * outerR;
    const x2 = cx + Math.cos(eRad) * outerR;
    const y2 = cy + Math.sin(eRad) * outerR;
    const x3 = cx + Math.cos(eRad) * innerR;
    const y3 = cy + Math.sin(eRad) * innerR;
    const x4 = cx + Math.cos(sRad) * innerR;
    const y4 = cy + Math.sin(sRad) * innerR;

    const d = [
      `M ${x1.toFixed(1)} ${y1.toFixed(1)}`,
      `A ${outerR} ${outerR} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`,
      `L ${x3.toFixed(1)} ${y3.toFixed(1)}`,
      `A ${innerR} ${innerR} 0 0 0 ${x4.toFixed(1)} ${y4.toFixed(1)}`,
      'Z',
    ].join(' ');

    const pos = SLICE_LAYOUT[idx];
    const words = w.name.split(' ');
    const line1 = words[0] || '';
    const line2 = words.slice(1).join(' ');

    slicesMarkup += `
      <g class="wheel-slice ${idx === 0 ? 'selected' : ''}" data-weapon="${w.id}" role="button" tabindex="0">
        <path class="wheel-wedge" d="${d}" fill="${w.color}" stroke="#141418" stroke-width="3.2" stroke-linejoin="round" />
        <g transform="translate(${pos.ix}, ${pos.iy}) scale(0.78)">
          ${weaponIconSvg(w.id)}
        </g>
        <text class="wheel-label" x="${pos.tx}" y="${pos.ty}" text-anchor="middle">
          <tspan x="${pos.tx}" dy="0">${line1}</tspan>
          ${line2 ? `<tspan x="${pos.tx}" dy="10">${line2}</tspan>` : ''}
        </text>
      </g>
    `;
  });

  wheelWrap.innerHTML = `
    <svg class="wheel-svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${cx}" cy="${cy}" r="${outerR + 3}" fill="#141418" />
      ${slicesMarkup}
      <g class="wheel-hub" role="button" tabindex="0">
        <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="#222327" stroke="#111114" stroke-width="4" />
        <text id="wheelArcTop" x="${cx}" y="${cy - 4}" text-anchor="middle" class="wheel-hub-top">ARC</text>
        <text id="wheelArcDeg" x="${cx}" y="${cy + 11}" text-anchor="middle" class="wheel-hub-deg">44°</text>
      </g>
    </svg>
  `;
  wrap.appendChild(wheelWrap);

  for (const g of wheelWrap.querySelectorAll('.wheel-slice')) {
    const id = g.getAttribute('data-weapon');
    sliceButtons.set(id, g);
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sound.unlock();
      onSelectWeapon(id);
    });
  }

  const hub = wheelWrap.querySelector('.wheel-hub');
  hub.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    sound.unlock();
    onCycleArc();
  });

  document.body.appendChild(wrap);

  return {
    root: wrap,
    sliceButtons,
    redScoreEl: topBanner.querySelector('#pandaRedScore'),
    blueScoreEl: topBanner.querySelector('#pandaBlueScore'),
    turnLabelEl: topBanner.querySelector('#pandaTurnLabel'),
    timerEl: topBanner.querySelector('#pandaTimerText'),
    windEl: topBanner.querySelector('#pandaWindText'),
    distPctEl: dpadWrap.querySelector('#pandaDistPct'),
    arcTopEl: wheelWrap.querySelector('#wheelArcTop'),
    arcDegEl: wheelWrap.querySelector('#wheelArcDeg'),
    setSelectedWeapon(weaponId) {
      for (const [id, el] of sliceButtons.entries()) {
        el.classList.toggle('selected', id === weaponId);
      }
    },
    dispose() {
      window.removeEventListener('blur', onBlur);
      wrap.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Main PandaRamenClient Class
// ---------------------------------------------------------------------------

export class PandaRamenClient {
  constructor(boardRoot, config, selfPlayerId, context = {}) {
    this.boardRoot = boardRoot;
    this.config = config;
    this.selfPlayerId = selfPlayerId;
    this.sendAction = context.sendAction || (() => {});
    this.preferredPreviewDist = 23.0;

    this.group = new THREE.Group();
    this.boardRoot.add(this.group);

    this.lastState = null;
    this.pandaVisuals = new Map();
    this.projVisuals = new Map();
    this.bambooStalks = [];
    this.particles = [];
    this.popups = [];
    this.flyingBowls = [];
    this.windLeaves = [];
    this.waterfallMist = [];
    this.foamRings = [];
    this.waterfallTex = null;
    this.riverTex = null;
    this.aimDots = [];
    this.aimRing = null;

    this.controlLabels = {
      jump: 'NEXT',
      shoot: 'FIRE',
      jumpIcon: '🐼',
      shootIcon: '🚀',
      badge: 'ROCKET LAUNCHER',
      armed: true,
    };

    this._initMaterials();
    this._buildLights();
    this._buildDioramaBoard();
    this._buildWaterfallAndRiver();
    this._buildZooStructures();
    this._buildDens();
    this._buildBambooGroves();
    this._buildAimTrajectory();
    this._buildWindLeaves();

    this.ui = createWeaponWheelOverlay({
      onSelectWeapon: (weaponId) => {
        sfx.wheelClick();
        this.ui.setSelectedWeapon(weaponId);
        this.sendAction({ weapon: weaponId });
      },
      onCycleArc: () => {
        sfx.wheelClick();
        this.sendAction({ arcCycle: true });
      },
      onDpad: ({ dpadX, dpadY }) => {
        this.sendAction({ dpadX, dpadY });
      },
    });

    this._onKeyDown = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code >= 'Digit1' && e.code <= 'Digit6') {
        const idx = Number(e.code.slice(5)) - 1;
        const w = WEAPONS[idx];
        if (w) {
          sfx.wheelClick();
          this.ui.setSelectedWeapon(w.id);
          this.sendAction({ weapon: w.id });
        }
      } else if (e.code === 'Tab') {
        e.preventDefault();
        sfx.wheelClick();
        this.sendAction({ nextPanda: true });
      } else if (e.code === 'KeyQ' || e.code === 'KeyE' || e.code === 'KeyR') {
        sfx.wheelClick();
        this.sendAction({ arcCycle: true });
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
  }

  _initMaterials() {
    const terrainTex = createPainterlyTerrainTexture();
    const rockTex = createPainterlyRockTexture();
    const woodTex = createPainterlyWoodTexture('#8f5d32', '#523016', '#b77f4a');
    const woodLightTex = createPainterlyWoodTexture('#b88754', '#7a512a', '#d4a66e');
    const frameWoodTex = createPainterlyWoodTexture('#5c3c22', '#351f0f', '#785130');
    this.waterfallTex = createStylizedWaterTexture({ isWaterfall: true });
    this.riverTex = createStylizedWaterTexture({ isWaterfall: false });

    this.mats = {
      terrain: new THREE.MeshStandardMaterial({
        map: terrainTex,
        vertexColors: true,
        roughness: 0.9,
        metalness: 0.02,
      }),
      rock: new THREE.MeshStandardMaterial({
        map: rockTex,
        color: 0xc8c3b6,
        roughness: 0.9,
        metalness: 0.02,
        flatShading: true,
      }),
      moss: new THREE.MeshStandardMaterial({
        color: 0x76a03b,
        roughness: 0.9,
        metalness: 0.01,
        flatShading: true,
      }),
      waterfall: new THREE.MeshStandardMaterial({
        map: this.waterfallTex,
        color: 0xdff8ff,
        roughness: 0.28,
        metalness: 0.06,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      }),
      river: new THREE.MeshStandardMaterial({
        map: this.riverTex,
        color: 0xd6f4ff,
        roughness: 0.22,
        metalness: 0.08,
        transparent: true,
        opacity: 0.88,
      }),
      waterFoam: new THREE.MeshBasicMaterial({
        color: 0xf0fcff,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      }),
      wood: new THREE.MeshStandardMaterial({
        map: woodTex,
        roughness: 0.84,
        metalness: 0.03,
      }),
      woodLight: new THREE.MeshStandardMaterial({
        map: woodLightTex,
        roughness: 0.82,
        metalness: 0.02,
      }),
      frameWood: new THREE.MeshStandardMaterial({
        map: frameWoodTex,
        roughness: 0.78,
        metalness: 0.04,
      }),
      caveDark: new THREE.MeshStandardMaterial({
        color: 0x161210,
        roughness: 0.98,
      }),
      bambooLight: new THREE.MeshStandardMaterial({ color: 0x82ab3d, roughness: 0.74 }),
      bambooDark: new THREE.MeshStandardMaterial({ color: 0x5c8227, roughness: 0.78 }),
      bambooNode: new THREE.MeshStandardMaterial({ color: 0x3b5719, roughness: 0.85 }),
      bambooLeaf: new THREE.MeshStandardMaterial({
        color: 0x6fa132,
        roughness: 0.78,
        side: THREE.DoubleSide,
      }),
      pandaCream: new THREE.MeshStandardMaterial({ color: 0xf3ede0, roughness: 0.88, metalness: 0.01 }),
      pandaBlack: new THREE.MeshStandardMaterial({ color: 0x25242b, roughness: 0.86, metalness: 0.02 }),
      pawPad: new THREE.MeshStandardMaterial({ color: 0x8d8278, roughness: 0.9 }),
      teamRed: new THREE.MeshStandardMaterial({ color: 0xd94e3b, roughness: 0.82 }),
      teamBlue: new THREE.MeshStandardMaterial({ color: 0x3b7fb8, roughness: 0.82 }),
      bowlRed: new THREE.MeshStandardMaterial({ color: 0xc93a2b, roughness: 0.42, metalness: 0.08 }),
      bowlBlue: new THREE.MeshStandardMaterial({ color: 0x2f6fa3, roughness: 0.42, metalness: 0.08 }),
      cream: new THREE.MeshStandardMaterial({ color: 0xf7f1df, roughness: 0.5 }),
      ramenTop: new THREE.MeshStandardMaterial({ map: createRamenTopTexture(), roughness: 0.55 }),
      noodles: new THREE.MeshStandardMaterial({ color: 0xf2d163, roughness: 0.72 }),
      chopstick: new THREE.MeshStandardMaterial({ color: 0xb9824a, roughness: 0.75 }),
      steam: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.34, depthWrite: false }),
      olive: new THREE.MeshStandardMaterial({ color: 0x6f873f, roughness: 0.68, metalness: 0.12 }),
      gunmetal: new THREE.MeshStandardMaterial({ color: 0x4b535c, roughness: 0.55, metalness: 0.35 }),
      exhaustBlue: new THREE.MeshStandardMaterial({ color: 0x6d8c9a, roughness: 0.58, metalness: 0.28 }),
      warhead: new THREE.MeshStandardMaterial({ map: createWarheadTexture(), roughness: 0.62 }),
      tireRubber: new THREE.MeshStandardMaterial({ color: 0x2d3036, roughness: 0.9, metalness: 0.05 }),
      dumpling: new THREE.MeshStandardMaterial({ color: 0xe9d8fa, roughness: 0.8 }),
      melon: new THREE.MeshStandardMaterial({ map: createMelonTexture(), roughness: 0.58 }),
      flame: new THREE.MeshBasicMaterial({ color: 0xfef08a }),
      faceHappy: new THREE.MeshStandardMaterial({ map: createPandaFaceTexture('happy'), roughness: 0.88 }),
      faceGoofy: new THREE.MeshStandardMaterial({ map: createPandaFaceTexture('goofy'), roughness: 0.88 }),
      faceSleepy: new THREE.MeshStandardMaterial({ map: createPandaFaceTexture('sleepy'), roughness: 0.9 }),
    };
  }

  _buildLights() {
    // Warm sunlit TF2-style fill bounce + cool waterfall mist rim light!
    const warmBounce = new THREE.PointLight(0xffdfb0, 1.15, 44, 1.1);
    warmBounce.position.set(-6, 10.5, 8);
    const coolWaterGlow = new THREE.PointLight(0x8be4f7, 0.55, 22, 1.3);
    coolWaterGlow.position.set(WATERFALL_CONFIG.x, 3.2, WATERFALL_CONFIG.poolZ + 0.5);
    this.group.add(warmBounce, coolWaterGlow);
  }

  _buildDioramaBoard() {
    // 1. Handcrafted carved walnut wood diorama tray sitting on the coffee table
    const baseTray = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_WIDTH + 0.68, 0.72, BOARD_DEPTH + 0.68),
      this.mats.frameWood,
    );
    baseTray.position.y = -0.34;
    baseTray.receiveShadow = true;
    baseTray.castShadow = true;
    this.group.add(baseTray);

    // Subtle wooden lip trim along the 4 sides (leaving a clean river outflow notch on front!)
    const lipH = 0.24;
    const lipT = 0.28;
    const backLip = new THREE.Mesh(new THREE.BoxGeometry(BOARD_WIDTH + 0.7, lipH, lipT), this.mats.frameWood);
    backLip.position.set(0, 0.04, -(HALF_D + 0.18));
    backLip.receiveShadow = true;
    this.group.add(backLip);

    // Front rim split around the river outflow so the stream pours cleanly to the edge!
    const exitX = getRiverCenterX(HALF_D);
    const gapHalf = getRiverHalfWidth(HALF_D) + 0.28;
    const leftFrontW = Math.max(0.5, (exitX - gapHalf) - (-HALF_W - 0.35));
    const rightFrontW = Math.max(0.5, (HALF_W + 0.35) - (exitX + gapHalf));
    const frontL = new THREE.Mesh(new THREE.BoxGeometry(leftFrontW, lipH, lipT), this.mats.frameWood);
    frontL.position.set(-HALF_W - 0.35 + leftFrontW / 2, 0.04, HALF_D + 0.18);
    frontL.receiveShadow = true;
    const frontR = new THREE.Mesh(new THREE.BoxGeometry(rightFrontW, lipH, lipT), this.mats.frameWood);
    frontR.position.set(exitX + gapHalf + rightFrontW / 2, 0.04, HALF_D + 0.18);
    frontR.receiveShadow = true;
    this.group.add(frontL, frontR);

    const leftRight = new THREE.BoxGeometry(lipT, lipH, BOARD_DEPTH + 0.24);
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(leftRight, this.mats.frameWood);
      m.position.set(sx * (HALF_W + 0.18), 0.04, 0);
      m.receiveShadow = true;
      this.group.add(m);
    }

    // 2. High-Res Sculpted Multi-Level Terrain Heightfield Mesh (104 x 72 grid)
    const segX = 104;
    const segZ = 72;
    const geo = new THREE.PlaneGeometry(BOARD_WIDTH, BOARD_DEPTH, segX, segZ);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cGrass = new THREE.Color('#7da542');
    const cGrassSun = new THREE.Color('#97bd4f');
    const cGrassDeep = new THREE.Color('#5a7b2c');
    const cDirt = new THREE.Color('#c8a872');
    const cSand = new THREE.Color('#cfb786');
    const cRiverBed = new THREE.Color('#3b7274');
    const cRock = new THREE.Color('#969186');
    const cRockDark = new THREE.Color('#68645c');
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = getTerrainHeight(x, z);
      pos.setY(i, y);

      const eps = 0.24;
      const hx = (getTerrainHeight(x + eps, z) - getTerrainHeight(x - eps, z)) / (2 * eps);
      const hz = (getTerrainHeight(x, z + eps) - getTerrainHeight(x, z - eps)) / (2 * eps);
      const slope = Math.hypot(hx, hz);

      const riverDist = z >= WATERFALL_CONFIG.poolZ - 1.5
        ? Math.abs(x - getRiverCenterX(z)) - getRiverHalfWidth(z)
        : 99;

      // Winding valley dirt footpaths crossing toward the wooden river bridge
      const pathCurve = Math.abs(z - (0.35 + Math.sin(x * 0.35) * 1.15));
      const onPath = y > 0.18 && y < 0.72 && pathCurve < 0.75 && Math.abs(x) < 6.8;

      if (riverDist < 0.12 && y <= 0.16) {
        tmp.copy(cRiverBed);
      } else if (riverDist < 0.85 && y <= 0.42) {
        const bankMix = Math.max(0, 1 - Math.max(0, riverDist) / 0.85);
        tmp.copy(cGrass).lerp(cSand, bankMix * 0.85);
      } else if (slope > 0.72 || (y > 4.2 && slope > 0.42)) {
        const rockMix = Math.min(1, (slope - 0.56) * 1.15);
        tmp.copy(cRock).lerp(cRockDark, Math.min(1, slope * 0.26));
        if (y > 4.8) tmp.lerp(cGrassDeep, 0.22);
        if (rockMix < 1) tmp.lerp(cGrassDeep, 1 - rockMix);
      } else {
        const sun = Math.sin(x * 0.42 + z * 0.28) * 0.5 + 0.5;
        tmp.copy(cGrass).lerp(sun > 0.5 ? cGrassSun : cGrassDeep, Math.abs(sun - 0.5) * 0.9);
        if (onPath) {
          const blend = Math.max(0, 1 - pathCurve / 0.75);
          tmp.lerp(cDirt, blend * 0.78);
        }
      }

      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const terrainMesh = new THREE.Mesh(geo, this.mats.terrain);
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = true;
    this.group.add(terrainMesh);

    // 3. Towering Sculpted TF2-style Limestone Mountain Spires & Stepped Crag Cliffs
    const addRockSpire = (x, z, rBot, rTop, totalH, rotY = 0, withMoss = true) => {
      const spireG = new THREE.Group();
      spireG.position.set(x, -0.02, z);
      spireG.rotation.y = rotY;

      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(rTop, rBot, totalH, 7, 3),
        this.mats.rock,
      );
      body.position.y = totalH * 0.5;
      body.scale.set(1.08, 1.0, 0.88);
      body.castShadow = true;
      body.receiveShadow = true;
      spireG.add(body);

      if (withMoss) {
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(rTop * 0.82, rTop * 1.05, 0.28, 7), this.mats.moss);
        cap.position.y = totalH + 0.05;
        cap.scale.set(1.06, 1.0, 0.86);
        cap.receiveShadow = true;
        spireG.add(cap);
      }
      this.group.add(spireG);
    };

    const addBoulder = (x, z, sx, sy, sz, rotY = 0, withMoss = false) => {
      const baseY = getTerrainHeight(x, z);
      const bG = new THREE.Group();
      bG.position.set(x, baseY - sy * 0.16, z);
      bG.rotation.y = rotY;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.58, 0), this.mats.rock);
      rock.scale.set(sx, sy, sz);
      rock.position.y = sy * 0.35;
      rock.castShadow = true;
      rock.receiveShadow = true;
      bG.add(rock);
      if (withMoss) {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.47, 7, 5), this.mats.moss);
        cap.scale.set(sx * 0.92, sy * 0.24, sz * 0.9);
        cap.position.y = sy * 0.72;
        cap.receiveShadow = true;
        bG.add(cap);
      }
      this.group.add(bG);
    };

    // Towering mountain spires framing the waterfall canyon, NE summit, and East pinnacle!
    addRockSpire(-8.95, -5.45, 2.25, 0.72, 7.45, 0.3, true);
    addRockSpire(-6.65, -5.85, 1.85, 0.68, 5.95, -0.45, true);
    addRockSpire(-9.85, -3.15, 1.65, 0.72, 4.65, 0.55, true);
    // Dramatic twin canyon walls flanking the waterfall chute!
    addRockSpire(-5.25, -6.55, 1.55, 0.62, 5.65, 0.22, true);
    addRockSpire(-1.45, -6.45, 1.55, 0.58, 5.35, -0.35, true);
    // Towering NE mountain peak behind Dumpling!
    addRockSpire(4.65, -6.05, 1.85, 0.62, 6.05, 0.42, true);
    addRockSpire(2.35, -5.65, 1.4, 0.68, 4.35, -0.2, true);
    // Soaring Far-East pinnacle behind Matcha!
    addRockSpire(9.75, -2.85, 1.85, 0.58, 6.45, -0.25, true);
    addRockSpire(10.15, -0.65, 1.3, 0.62, 3.85, 0.48, true);

    // Stepped rock cliff buttresses around mid-tier ledges & river gorge
    addBoulder(-5.2, -1.25, 1.5, 1.25, 1.2, 0.2, true);
    addBoulder(-8.85, 0.25, 1.6, 1.35, 1.3, -0.5, true);
    addBoulder(1.95, -4.15, 1.5, 1.65, 1.35, 0.4, true);
    addBoulder(6.1, -4.35, 1.6, 1.85, 1.35, -0.3, true);
    addBoulder(9.15, 1.45, 1.45, 1.25, 1.3, 0.5, true);
    addBoulder(-4.65, -4.65, 1.15, 0.95, 1.05, 0.7, true);
    addBoulder(-2.35, -4.85, 1.1, 0.9, 1.0, -0.6, true);

    // Valley lounge rocks
    for (const b of LOUNGE_BOULDERS) {
      addBoulder(b.x, b.z, b.r * 1.45, b.h * 1.25, b.r * 1.35, b.x * 0.7, b.h > 0.75);
    }

    // Stray decorative bamboo sticks lying on the sunny meadows
    const straySticks = [
      [-1.8, 2.5, 0.4],
      [3.4, 0.8, -0.8],
      [3.9, 1.25, 0.3],
      [-5.1, 2.8, -0.4],
      [1.2, -1.8, 1.1],
      [5.4, 4.2, -0.6],
    ];
    for (const [sx, sz, rot] of straySticks) {
      if (isInRiver(sx, sz)) continue;
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.75, 6), this.mats.bambooLight);
      stick.rotation.set(Math.PI / 2, 0, rot);
      stick.position.set(sx, getTerrainHeight(sx, sz) + 0.04, sz);
      this.group.add(stick);
    }
  }

  /**
   * Builds the animated mountain waterfall pouring in from the back cliff edge,
   * cascading down two rocky tiers into a foaming turquoise plunge pool, and
   * flowing all the way through the valley as a meandering stream!
   */
  _buildWaterfallAndRiver() {
    const wf = WATERFALL_CONFIG;

    // 1. Curved Cascading 2-Tier Waterfall Ribbon entering from back board edge (z = -HALF_D - 0.34 -> poolZ)
    const wfProfile = [
      { z: -HALF_D - 0.34, y: wf.topY + 0.16, w: wf.width * 0.92 },
      { z: wf.topZ + 0.05, y: wf.topY + 0.14, w: wf.width * 0.96 },
      { z: wf.lipZ - 0.18, y: wf.topY + 0.08, w: wf.width },
      { z: wf.lipZ + 0.22, y: wf.topY - 0.32, w: wf.width * 1.03 },
      { z: wf.lipZ + 0.65, y: wf.midY + 0.48, w: wf.width * 1.06 },
      { z: wf.lipZ + 1.04, y: wf.midY, w: wf.width * 1.12 },
      { z: wf.lipZ + 1.38, y: wf.midY - 0.56, w: wf.width * 1.16 },
      { z: wf.poolZ - 0.12, y: WATER_LEVEL + 0.03, w: wf.width * 1.24 },
    ];
    const wfPos = [];
    const wfUv = [];
    const wfIdx = [];
    let arcLen = 0;
    for (let i = 0; i < wfProfile.length; i++) {
      const pt = wfProfile[i];
      if (i > 0) {
        const prev = wfProfile[i - 1];
        arcLen += Math.hypot(pt.z - prev.z, pt.y - prev.y);
      }
      const hw = pt.w * 0.5;
      wfPos.push(wf.x - hw, pt.y, pt.z, wf.x + hw, pt.y, pt.z);
      const v = arcLen / 3.4;
      wfUv.push(0, v, 1, v);
      if (i < wfProfile.length - 1) {
        const a = i * 2;
        wfIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const wfGeo = new THREE.BufferGeometry();
    wfGeo.setAttribute('position', new THREE.Float32BufferAttribute(wfPos, 3));
    wfGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wfUv, 2));
    wfGeo.setIndex(wfIdx);
    wfGeo.computeVertexNormals();

    const waterfallMesh = new THREE.Mesh(wfGeo, this.mats.waterfall);
    waterfallMesh.receiveShadow = true;
    this.group.add(waterfallMesh);

    // Sculpted upper canyon stone chute & mossy lip framing the waterfall inflow from the back edge!
    const chuteBed = new THREE.Mesh(new THREE.BoxGeometry(wf.width + 1.2, 0.55, 1.55), this.mats.rock);
    chuteBed.position.set(wf.x, wf.topY - 0.16, -HALF_D + 0.4);
    chuteBed.castShadow = true;
    chuteBed.receiveShadow = true;
    this.group.add(chuteBed);

    // Whitewater crest foam bar where the inflow tips over the cliff edge
    const crestFoam = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, wf.width * 0.96, 8), this.mats.waterFoam);
    crestFoam.rotation.z = Math.PI / 2;
    crestFoam.position.set(wf.x, wf.topY + 0.04, wf.lipZ + 0.04);
    this.group.add(crestFoam);

    // Rooted canyon rock buttresses framing the waterfall walls (replacing any floating mid-rock!)
    for (const side of [-1, 1]) {
      const buttress = new THREE.Mesh(new THREE.DodecahedronGeometry(0.68, 0), this.mats.rock);
      buttress.scale.set(1.05, 1.35, 1.15);
      buttress.position.set(wf.x + side * (wf.width * 0.56 + 0.25), wf.midY + 0.15, wf.lipZ + 0.62);
      buttress.castShadow = true;
      buttress.receiveShadow = true;
      this.group.add(buttress);
    }

    // 2. Meandering River Ribbon from Waterfall Plunge Pool to Front-Right Edge!
    const riverSegs = 58;
    const zStart = wf.poolZ - 0.85;
    const zEnd = HALF_D + 0.34;
    const rPos = [];
    const rUv = [];
    const rIdx = [];
    let riverLen = 0;
    let prevCx = getRiverCenterX(zStart);
    let prevZ = zStart;

    for (let i = 0; i <= riverSegs; i++) {
      const t = i / riverSegs;
      const z = zStart + (zEnd - zStart) * t;
      const cx = getRiverCenterX(Math.min(HALF_D, z));
      const hw = getRiverHalfWidth(Math.min(HALF_D, z)) * 1.1;
      if (i > 0) riverLen += Math.hypot(cx - prevCx, z - prevZ);
      prevCx = cx;
      prevZ = z;

      // Tangent perpendicular (smoothly straightened flush at the front edge notch!)
      const eps = 0.12;
      const dxdz = (getRiverCenterX(Math.min(HALF_D, z + eps)) - getRiverCenterX(Math.max(zStart, z - eps))) / (2 * eps);
      const len = Math.hypot(1, dxdz) || 1;
      const edgeFlatten = t > 0.88 ? Math.min(1, (t - 0.88) / 0.12) : 0;
      const nx = (1 / len) * (1 - edgeFlatten) + 1 * edgeFlatten;
      const nz = (-dxdz / len) * (1 - edgeFlatten);
      // Slight downward lip at the very outer edge of the front walnut frame
      const spillDrop = t > 0.96 ? ((t - 0.96) / 0.04) * 0.12 : 0;

      rPos.push(cx - nx * hw, WATER_LEVEL - spillDrop, z - nz * hw);
      rPos.push(cx + nx * hw, WATER_LEVEL - spillDrop, z + nz * hw);
      const v = riverLen / 3.2;
      rUv.push(0, v, 1, v);

      if (i < riverSegs) {
        const a = i * 2;
        rIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const rGeo = new THREE.BufferGeometry();
    rGeo.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
    rGeo.setAttribute('uv', new THREE.Float32BufferAttribute(rUv, 2));
    rGeo.setIndex(rIdx);
    rGeo.computeVertexNormals();

    const riverMesh = new THREE.Mesh(rGeo, this.mats.river);
    riverMesh.receiveShadow = true;
    this.group.add(riverMesh);

    // Mossy riverbank rocks cleanly framing the front walnut outflow notch
    const exitX = getRiverCenterX(HALF_D);
    const exitHw = getRiverHalfWidth(HALF_D);
    for (const side of [-1, 1]) {
      const bankRock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 0), this.mats.rock);
      bankRock.scale.set(1.15, 0.72, 1.05);
      bankRock.position.set(exitX + side * (exitHw + 0.34), 0.14, HALF_D - 0.12);
      bankRock.castShadow = true;
      bankRock.receiveShadow = true;
      this.group.add(bankRock);
    }

    // 3. Foaming Plunge Pool Rings & Rising Waterfall Mist Puffs
    for (let r = 0; r < 3; r++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.45 + r * 0.25, 0.72 + r * 0.28, 22),
        this.mats.waterFoam.clone(),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(wf.x, WATER_LEVEL + 0.03, wf.poolZ + 0.05);
      this.group.add(ring);
      this.foamRings.push({ mesh: ring, phase: r * 0.33 });
    }

    for (let m = 0; m < 14; m++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.18 + (m % 3) * 0.07, 8, 6),
        this.mats.waterFoam.clone(),
      );
      this.group.add(puff);
      this.waterfallMist.push({
        mesh: puff,
        phase: m / 14,
        ox: (Math.sin(m * 2.1) * 0.85),
        oz: (Math.cos(m * 1.7) * 0.45),
      });
    }

    // 4. Smooth River Stepping Stones & Bank Pebbles along the Stream!
    const stoneZs = [-3.1, -1.6, 2.2, 4.1, 6.2];
    for (let idx = 0; idx < stoneZs.length; idx++) {
      const sz = stoneZs[idx];
      const cx = getRiverCenterX(sz);
      const hw = getRiverHalfWidth(sz);
      const side = idx % 2 === 0 ? -1 : 1;
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32, 0), this.mats.rock);
      stone.scale.set(1.25, 0.55, 1.05);
      stone.position.set(cx + side * hw * 0.62, WATER_LEVEL + 0.02, sz);
      stone.rotation.y = idx * 1.1;
      stone.castShadow = true;
      stone.receiveShadow = true;
      this.group.add(stone);

      // Tiny bright foam ring around each river boulder
      const wake = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.46, 14), this.mats.waterFoam);
      wake.rotation.x = -Math.PI / 2;
      wake.position.set(stone.position.x, WATER_LEVEL + 0.02, stone.position.z);
      this.group.add(wake);
    }
  }

  _buildZooStructures() {
    for (const s of ZOO_STRUCTURES) {
      const g = new THREE.Group();
      g.position.set(s.x, 0, s.z);
      g.rotation.y = s.rotY;

      const baseY = Math.max(WATER_LEVEL - 0.15, getTerrainHeight(s.x, s.z) - 0.15);
      const h = Math.max(0.55, s.topY - baseY);

      if (s.arched) {
        // Charming arched wooden footbridge spanning right over the flowing river!
        const plankCount = 11;
        const span = s.halfW * 2;
        const plankW = span / plankCount - 0.03;
        const plankGeo = new THREE.BoxGeometry(plankW, 0.08, s.halfD * 2 + 0.08);
        for (let i = 0; i < plankCount; i++) {
          const u = (i + 0.5) / plankCount; // 0..1
          const px = -s.halfW + u * span;
          const arch = Math.sin(u * Math.PI) * 0.42;
          const slope = Math.cos(u * Math.PI) * 0.36;
          const plank = new THREE.Mesh(plankGeo, i % 2 === 0 ? this.mats.woodLight : this.mats.wood);
          plank.position.set(px, s.topY - 0.28 + arch, 0);
          plank.rotation.z = slope;
          plank.castShadow = true;
          plank.receiveShadow = true;
          g.add(plank);
        }
        // Sturdy riverbank posts & rope/wood side handrails
        const postGeo = new THREE.CylinderGeometry(0.065, 0.075, 1.15, 8);
        for (const px of [-s.halfW + 0.18, 0, s.halfW - 0.18]) {
          const archBoost = px === 0 ? 0.38 : 0;
          for (const pz of [-s.halfD - 0.02, s.halfD + 0.02]) {
            const post = new THREE.Mesh(postGeo, this.mats.wood);
            post.position.set(px, s.topY - 0.25 + archBoost + 0.32, pz);
            post.castShadow = true;
            g.add(post);
          }
        }
        const railGeo = new THREE.BoxGeometry(s.halfW * 2.02, 0.07, 0.07);
        for (const pz of [-s.halfD - 0.02, s.halfD + 0.02]) {
          const rail = new THREE.Mesh(railGeo, this.mats.woodLight);
          rail.position.set(0, s.topY + 0.45, pz);
          rail.castShadow = true;
          g.add(rail);
        }
        this.group.add(g);
        continue;
      }

      // 4 sturdy cedar support posts
      const postGeo = new THREE.CylinderGeometry(0.08, 0.09, h + 0.28, 8);
      for (const px of [-s.halfW + 0.14, s.halfW - 0.14]) {
        for (const pz of [-s.halfD + 0.12, s.halfD - 0.12]) {
          const post = new THREE.Mesh(postGeo, this.mats.wood);
          post.position.set(px, baseY + h / 2 + 0.06, pz);
          post.castShadow = true;
          post.receiveShadow = true;
          g.add(post);
        }
      }

      // Cross support rails under deck
      const railGeo = new THREE.BoxGeometry(s.halfW * 2, 0.1, 0.1);
      for (const pz of [-s.halfD + 0.12, s.halfD - 0.12]) {
        const rail = new THREE.Mesh(railGeo, this.mats.wood);
        rail.position.set(0, s.topY - 0.1, pz);
        rail.castShadow = true;
        g.add(rail);
      }

      // Individual rustic wooden deck planks with neat visual gaps
      const plankCount = Math.max(4, Math.round((s.halfW * 2) / 0.28));
      const plankW = (s.halfW * 2) / plankCount - 0.03;
      const plankGeo = new THREE.BoxGeometry(plankW, 0.08, s.halfD * 2 + 0.1);
      for (let i = 0; i < plankCount; i++) {
        const px = -s.halfW + (i + 0.5) * ((s.halfW * 2) / plankCount);
        const plank = new THREE.Mesh(plankGeo, i % 2 === 0 ? this.mats.woodLight : this.mats.wood);
        plank.position.set(px, s.topY - 0.03, 0);
        plank.castShadow = true;
        plank.receiveShadow = true;
        g.add(plank);
      }

      // Rustic wooden ladder leading up to the two-tier zoo climbing fort!
      if (s.hasLadder) {
        const ladder = new THREE.Group();
        ladder.position.set(0.18, baseY + 0.1, s.halfD + 0.42);
        ladder.rotation.x = -0.44;
        const ladLen = h * 1.18;
        const stileGeo = new THREE.CylinderGeometry(0.042, 0.046, ladLen, 6);
        for (const sx of [-0.26, 0.26]) {
          const stile = new THREE.Mesh(stileGeo, this.mats.wood);
          stile.position.set(sx, ladLen / 2, 0);
          stile.castShadow = true;
          ladder.add(stile);
        }
        const rungGeo = new THREE.CylinderGeometry(0.03, 0.032, 0.56, 6);
        for (let r = 0; r < 6; r++) {
          const rung = new THREE.Mesh(rungGeo, this.mats.woodLight);
          rung.rotation.z = Math.PI / 2;
          rung.position.set(0, 0.2 + r * (ladLen / 6.3), 0);
          ladder.add(rung);
        }
        g.add(ladder);
      }

      if (s.type === 'table') {
        const back = new THREE.Mesh(new THREE.BoxGeometry(s.halfW * 1.6, 0.4, 0.08), this.mats.wood);
        back.position.set(0, s.topY + 0.22, -s.halfD + 0.05);
        back.castShadow = true;
        g.add(back);

        const tableBowl = createRamenBowl(this.mats, 0, 1.0);
        tableBowl.position.set(0.06, s.topY + 0.01, 0.05);
        g.add(tableBowl);
      }

      this.group.add(g);
    }
  }

  _buildDens() {
    // Cozy timber-framed panda dens embedded into rocky hillside arches!
    const buildTimberDen = (x, z, yaw, teamIdx, withSign = true) => {
      const y = getTerrainHeight(x, z);
      const den = new THREE.Group();
      den.position.set(x, y - 0.05, z);
      den.rotation.y = yaw;

      const rockBack = new THREE.Mesh(new THREE.DodecahedronGeometry(1.05, 0), this.mats.rock);
      rockBack.scale.set(1.25, 0.95, 0.85);
      rockBack.position.set(0, 0.48, -0.45);
      rockBack.castShadow = true;
      rockBack.receiveShadow = true;
      den.add(rockBack);

      const mossTop = new THREE.Mesh(new THREE.SphereGeometry(0.84, 8, 6), this.mats.moss);
      mossTop.scale.set(1.12, 0.22, 0.78);
      mossTop.position.set(0, 0.98, -0.35);
      den.add(mossTop);

      const cave = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 0.84), this.mats.caveDark);
      cave.position.set(0, 0.42, 0.08);
      den.add(cave);

      const postGeo = new THREE.BoxGeometry(0.17, 0.88, 0.17);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(postGeo, this.mats.wood);
        post.position.set(side * 0.52, 0.42, 0.15);
        post.rotation.z = side * 0.07;
        post.castShadow = true;
        den.add(post);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.18, 0.24), this.mats.woodLight);
      lintel.position.set(0, 0.86, 0.16);
      lintel.castShadow = true;
      den.add(lintel);

      if (withSign) {
        const teamMat = teamIdx === 0 ? this.mats.teamRed : this.mats.teamBlue;
        const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), teamMat);
        lantern.scale.set(0.9, 1.15, 0.9);
        lantern.position.set(0.68, 0.68, 0.26);
        den.add(lantern);

        const spareBowl = createRamenBowl(this.mats, teamIdx, 0.9);
        spareBowl.position.set(0.05, 0.01, 0.58);
        den.add(spareBowl);
      }

      this.group.add(den);
    };

    const redDen = TEAMS[0].den;
    const blueDen = TEAMS[1].den;
    buildTimberDen(redDen.x, redDen.z, redDen.yaw, 0, true);
    buildTimberDen(blueDen.x, blueDen.z, blueDen.yaw, 1, true);
    // Decorative cave recess tucked low beneath Matcha's towering East cliff ledge
    const eastCave = new THREE.Group();
    eastCave.position.set(7.65, 0.25, 1.05);
    eastCave.rotation.y = -0.65;
    const eDark = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.9), this.mats.caveDark);
    eDark.position.set(0, 0.45, 0);
    eastCave.add(eDark);
    this.group.add(eastCave);
  }

  _buildBambooGroves() {
    let seed = 777;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const leafGeo = new THREE.PlaneGeometry(0.11, 0.42);
    leafGeo.translate(0, 0.18, 0);

    for (const grove of BAMBOO_GROVES) {
      for (let i = 0; i < grove.count; i++) {
        const ang = (i / grove.count) * Math.PI * 2 + rand() * 0.7;
        const rad = 0.18 + rand() * 0.55;
        const bx = grove.x + Math.cos(ang) * rad;
        const bz = grove.z + Math.sin(ang) * rad;
        const by = getTerrainHeight(bx, bz);
        if (isInRiver(bx, bz) || by < WATER_LEVEL + 0.08) continue;

        const stalkGroup = new THREE.Group();
        stalkGroup.position.set(bx, by - 0.05, bz);

        const totalH = grove.height * (0.72 + rand() * 0.45);
        const segs = 4;
        const segH = totalH / segs;

        for (let s = 0; s < segs; s++) {
          const rBot = 0.058 * (1 - s * 0.14);
          const rTop = 0.058 * (1 - (s + 1) * 0.12);
          const seg = new THREE.Mesh(
            new THREE.CylinderGeometry(rTop, rBot, segH - 0.02, 7),
            s % 2 === 0 ? this.mats.bambooLight : this.mats.bambooDark,
          );
          seg.position.y = s * segH + segH * 0.5;
          seg.castShadow = true;
          stalkGroup.add(seg);

          if (s > 0) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(rBot * 1.12, 0.014, 5, 8), this.mats.bambooNode);
            ring.rotation.x = Math.PI / 2;
            ring.position.y = s * segH;
            stalkGroup.add(ring);
          }

          // Fanning green bamboo leaf blades on upper nodes
          if (s >= 1) {
            const leafCount = s === segs - 1 ? 5 : 3;
            for (let l = 0; l < leafCount; l++) {
              const leaf = new THREE.Mesh(leafGeo, this.mats.bambooLeaf);
              leaf.position.y = (s + 0.85) * segH;
              leaf.rotation.y = (l / leafCount) * Math.PI * 2 + rand() * 0.6;
              leaf.rotation.x = 0.75 + rand() * 0.55;
              stalkGroup.add(leaf);
            }
          }
        }

        const baseLeanX = (rand() - 0.5) * 0.18;
        const baseLeanZ = (rand() - 0.5) * 0.18;
        stalkGroup.rotation.set(baseLeanX, rand() * Math.PI * 2, baseLeanZ);
        this.group.add(stalkGroup);
        this.bambooStalks.push({
          mesh: stalkGroup,
          baseLeanX,
          baseLeanZ,
          phase: rand() * Math.PI * 2,
        });
      }
    }
  }

  _buildAimTrajectory() {
    const dotGeo = new THREE.SphereGeometry(0.11, 8, 6);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(
        dotGeo,
        new THREE.MeshBasicMaterial({
          color: i % 2 === 0 ? 0xfff8dc : 0xf7d13d,
          transparent: true,
          opacity: Math.max(0.22, 0.92 - i * 0.028),
        }),
      );
      m.visible = false;
      this.group.add(m);
      this.aimDots.push(m);
    }

    this.aimRing = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.68, 28),
      new THREE.MeshBasicMaterial({
        color: 0xf7e231,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    this.aimRing.rotation.x = -Math.PI / 2;
    this.aimRing.visible = false;
    this.group.add(this.aimRing);
  }

  _buildWindLeaves() {
    const geo = new THREE.PlaneGeometry(0.14, 0.07);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(geo, this.mats.bambooLeaf);
      m.position.set(
        (Math.random() - 0.5) * BOARD_WIDTH,
        1.2 + Math.random() * 2.8,
        (Math.random() - 0.5) * BOARD_DEPTH,
      );
      this.group.add(m);
      this.windLeaves.push({
        mesh: m,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  _updatePandaHpCanvas(vis, pd) {
    const key = `${pd.name}|${pd.ramenHp}|${pd.state}|${pd.hasRamen}`;
    if (key === vis.hpKey) return;
    vis.hpKey = key;

    const ctx = vis.hpCanvas.getContext('2d');
    ctx.clearRect(0, 0, 128, 36);

    if (pd.state === 'sleeping') {
      vis.hpSprite.visible = false;
      return;
    }

    // Show clean badge for active panda OR any panda that has taken a bonk
    const show = pd.state === 'active' || pd.ramenHp < pd.maxRamenHp || !pd.hasRamen;
    vis.hpSprite.visible = show;
    if (!show) return;

    const teamColor = TEAMS[pd.team].color;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
    ctx.beginPath();
    ctx.roundRect(6, 3, 116, 30, 10);
    ctx.fill();
    ctx.strokeStyle = teamColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.font = '800 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(pd.hasRamen ? `${pd.name} 🍜` : `${pd.name} 💤`, 64, 16);

    // Mini ramen grip bar
    const pct = Math.max(0, Math.min(1, pd.ramenHp / (pd.maxRamenHp || 100)));
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(16, 22, 96, 6);
    ctx.fillStyle = pct > 0.45 ? '#4ade80' : '#fbbf24';
    ctx.fillRect(16, 22, Math.round(96 * pct), 6);

    vis.hpTex.needsUpdate = true;
  }

  _spawnCartoonBurst(x, y, z, colors, count = 14, speed = 3.2, size = 0.14) {
    for (let i = 0; i < count; i++) {
      const col = colors[i % colors.length];
      const mat = new THREE.MeshStandardMaterial({
        color: col,
        roughness: 0.85,
        transparent: true,
        opacity: 0.95,
      });
      const m = new THREE.Mesh(new THREE.SphereGeometry(size * (0.7 + Math.random() * 0.7), 8, 6), mat);
      m.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2;
      const spd = (0.35 + Math.random() * 0.85) * speed;
      this.group.add(m);
      this.particles.push({
        mesh: m,
        vx: Math.cos(a) * spd,
        vy: (0.45 + Math.random() * 0.9) * speed * 0.72,
        vz: Math.sin(a) * spd,
        life: 0.55 + Math.random() * 0.35,
        maxLife: 0.9,
        gravity: 7.5,
      });
    }
  }

  _spawnPopup(text, bgColor, x, y, z) {
    const sp = makeBadgeSprite(text, bgColor);
    sp.position.set(x, y, z);
    this.group.add(sp);
    this.popups.push({ sprite: sp, life: 1.55, maxLife: 1.55 });
  }

  _spawnFlyingRamenBowl(x, y, z, pandaTeam, takerTeam) {
    const bowl = createRamenBowl(this.mats, pandaTeam, 1.05);
    bowl.position.set(x, y, z);
    this.group.add(bowl);
    const den = TEAMS[takerTeam].den;
    this.flyingBowls.push({
      mesh: bowl,
      sx: x,
      sy: y,
      sz: z,
      tx: den.x,
      ty: den.y + 1.8,
      tz: den.z,
      t: 0,
      dur: 1.15,
    });
  }

  applyState(state) {
    this.lastState = state;

    // Sync 8 pandas
    const seenPandas = new Set();
    for (const pd of state.pandas || []) {
      seenPandas.add(pd.id);
      let vis = this.pandaVisuals.get(pd.id);
      if (!vis) {
        vis = createPandaVisual(pd, this.mats);
        vis.root.position.set(pd.x, pd.y, pd.z);
        vis.body.rotation.y = pd.yaw;
        this.group.add(vis.root);
        this.pandaVisuals.set(pd.id, vis);
      }
      vis.targetX = pd.x;
      vis.targetY = pd.y;
      vis.targetZ = pd.z;
      vis.targetYaw = pd.yaw;
      vis.state = pd;
      this._updatePandaHpCanvas(vis, pd);
    }
    for (const [id, vis] of this.pandaVisuals.entries()) {
      if (!seenPandas.has(id)) {
        this.group.remove(vis.root);
        this.pandaVisuals.delete(id);
      }
    }

    // Sync active projectiles
    const seenProjs = new Set();
    for (const pr of state.projectiles || []) {
      seenProjs.add(pr.id);
      let pVis = this.projVisuals.get(pr.id);
      if (!pVis) {
        const mesh = createProjectileMesh(pr.weaponId, this.mats, pr.isSub);
        mesh.position.set(pr.x, pr.y, pr.z);
        this.group.add(mesh);
        pVis = { mesh, target: new THREE.Vector3(pr.x, pr.y, pr.z), state: pr };
        this.projVisuals.set(pr.id, pVis);
      }
      pVis.target.set(pr.x, pr.y, pr.z);
      pVis.state = pr;
    }
    for (const [id, pVis] of this.projVisuals.entries()) {
      if (!seenProjs.has(id)) {
        this.group.remove(pVis.mesh);
        this.projVisuals.delete(id);
      }
    }

    // Update lower-right Weapon Wheel, D-Pad Distance readout & Turn HUD
    this.ui.setSelectedWeapon(state.selectedWeapon);
    const arc = ARC_ANGLES[state.arcIndex] || ARC_ANGLES[1];
    this.ui.arcTopEl.textContent = arc.label;
    this.ui.arcDegEl.textContent = `${arc.deg}°`;
    if (this.ui.distPctEl && typeof state.aimDistancePct === 'number') {
      this.ui.distPctEl.textContent = `${state.aimDistancePct}%`;
    }

    this.ui.redScoreEl.textContent = `🍜 ${state.ramenLeft[0]}`;
    this.ui.blueScoreEl.textContent = `${state.ramenLeft[1]} 🍜`;

    const teamInfo = TEAMS[state.activeTeam];
    const isMyTurn = state.activeControllerId === this.selfPlayerId && !state.activeControllerIsBot;
    if (state.phase === 'round_over') {
      this.ui.turnLabelEl.textContent = `${state.winnerName} Wins! 🍜`;
    } else {
      const who = isMyTurn ? 'YOUR TURN' : (state.activeControllerIsBot ? `${teamInfo.name} AI` : state.activeControllerName);
      this.ui.turnLabelEl.textContent = `${who} — ${state.activePandaName}`;
    }
    this.ui.timerEl.textContent = `${Math.ceil(state.turnTimeLeft)}s`;

    const windMag = Math.hypot(state.windX, state.windZ);
    const windArrows = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
    const windIdx = ((Math.round((Math.atan2(state.windZ, state.windX) / (Math.PI * 2)) * 8) % 8) + 8) % 8;
    const windLabel = windMag < 0.45 ? 'Calm' : windMag < 1.1 ? 'Breeze' : 'Gusty';
    this.ui.windEl.textContent = `🍃 ${windLabel} ${windArrows[windIdx]}`;

    // Touch action button labels (secondary button swaps active panda, FIRE shoots immediately!)
    const activeWeapon = WEAPON_BY_ID[state.selectedWeapon] || WEAPONS[0];
    const canSwap = (state.ramenLeft?.[state.activeTeam] || 0) > 1;
    this.controlLabels = isMyTurn && state.phase === 'aim'
      ? {
          jump: canSwap ? 'NEXT' : 'SOLO',
          shoot: 'FIRE',
          jumpIcon: '🐼',
          shootIcon: state.selectedWeapon === 'ramen-bomb' ? '🍜' : state.selectedWeapon === 'bouncing-tire' ? '🛞' : '🚀',
          badge: activeWeapon.displayName.toUpperCase(),
          armed: true,
        }
      : {
          jump: 'WAIT',
          shoot: 'TURN',
          jumpIcon: '🐼',
          shootIcon: '🍜',
          badge: state.phase === 'aim' ? `${teamInfo.name.toUpperCase()}` : 'WATCH!',
          armed: false,
        };

    // Process one-shot game events for juicy Fall-Guys visuals & sounds
    for (const ev of state.events || []) {
      switch (ev.type) {
        case 'panda_switch':
          sfx.hop();
          this._spawnCartoonBurst(ev.x, ev.y + 0.35, ev.z, [0xf7e231, 0xf3ede0], 7, 1.8, 0.08);
          this._spawnPopup(ev.pandaName, TEAMS[ev.team].color, ev.x, ev.y + 1.15, ev.z);
          break;
        case 'fire':
          sfx.fire(ev.weapon);
          this._spawnCartoonBurst(ev.x, ev.y, ev.z, [0xfff8dc, 0xf7e231, 0xe2e8f0], 10, 2.4, 0.12);
          break;
        case 'tire_bounce':
          sfx.boing();
          this._spawnCartoonBurst(ev.x, ev.y, ev.z, [0xf7e231, 0xffffff, 0x94a3b8], 10, 2.8, 0.11);
          this._spawnPopup('BOING!', '#f5c724', ev.x, ev.y + 0.9, ev.z);
          break;
        case 'cluster_split':
          sfx.boing();
          this._spawnCartoonBurst(ev.x, ev.y, ev.z, [0xe9d5ff, 0xa54bd6, 0xffffff], 12, 2.6, 0.12);
          this._spawnPopup('POP!', '#a54bd6', ev.x, ev.y + 0.6, ev.z);
          break;
        case 'explosion': {
          sfx.explosion(ev.weapon);
          const palette = ev.weapon === 'ramen-bomb'
            ? [0xf5d565, 0xf28c28, 0xffffff, 0xec6a92]
            : ev.weapon === 'melon-cannon'
              ? [0x59c747, 0xff5e7e, 0xf7e231]
              : ev.weapon === 'dumpling-drop'
                ? [0xe9d5ff, 0xa54bd6, 0xffffff]
                : [0xf7e231, 0xf28c28, 0xfff8dc, 0xd45a9e];
          this._spawnCartoonBurst(ev.x, ev.y + 0.2, ev.z, palette, 18, 3.8, 0.16);
          break;
        }
        case 'bonk':
          sfx.bonk();
          this._spawnPopup(`-${ev.damage} BOOP!`, TEAMS[ev.team].color, ev.x, ev.y + 0.65, ev.z);
          break;
        case 'belly_bounce':
          sfx.boing();
          this._spawnPopup(`BELLY BOING! -${ev.damage}`, '#f59e0b', ev.x, ev.y + 0.8, ev.z);
          break;
        case 'ramen_taken':
          sfx.ramenTaken();
          this._spawnFlyingRamenBowl(ev.x, ev.y, ev.z, ev.pandaTeam, ev.takerTeam);
          this._spawnPopup('RAMEN TAKEN! 🍜', TEAMS[ev.takerTeam].color, ev.x, ev.y + 1.1, ev.z);
          this._spawnCartoonBurst(ev.x, ev.y + 0.3, ev.z, [0xf7e231, 0xf5d565, 0xffffff], 16, 3.4, 0.12);
          break;
        case 'panda_sleep':
          sfx.sleep();
          this._spawnPopup(`${ev.pandaName} NAP TIME 💤`, TEAMS[ev.team].color, ev.x, ev.y + 0.9, ev.z);
          break;
        case 'water_splash':
          sfx.splash();
          this._spawnCartoonBurst(ev.x, ev.y + 0.12, ev.z, [0x54c7de, 0x99ebff, 0xffffff], 14, 3.4, 0.14);
          this._spawnPopup('SPLASH! 💦', '#0ea5e9', ev.x, ev.y + 0.95, ev.z);
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
    return TEAMS.map((t) => ({
      id: `team-${t.id}`,
      name: `${t.name} 🍜 ${state.ramenLeft[t.id]}/4`,
      color: t.color,
      hp: state.ramenLeft[t.id],
      maxHp: 4,
      alive: state.ramenLeft[t.id] > 0,
    }));
  }

  _animatePanda(vis, dt, time) {
    const pd = vis.state;
    if (!pd) return;

    // Swap happy / goofy / sleepy face texture smoothly
    const desiredFace = pd.state === 'sleeping'
      ? 'sleepy'
      : pd.state === 'active'
        ? 'goofy'
        : 'happy';
    if (vis.faceMode !== desiredFace) {
      vis.faceMode = desiredFace;
      vis.faceMat.map = desiredFace === 'sleepy'
        ? this.mats.faceSleepy.map
        : desiredFace === 'goofy'
          ? this.mats.faceGoofy.map
          : this.mats.faceHappy.map;
      vis.faceMat.needsUpdate = true;
    }

    const isActive = pd.state === 'active';
    const isTumbling = pd.state === 'tumbling' || pd.state === 'rolling_home';
    const isSleeping = pd.state === 'sleeping';
    const ph = pd.animPhase || 0;

    vis.activeRing.visible = isActive;
    if (isActive) {
      const pulse = 1 + Math.sin(time * 5.2) * 0.08;
      vis.activeRing.scale.setScalar(pulse);
    }

    // Show weapon only when active!
    const activeWepId = this.lastState?.selectedWeapon || 'rocket-launcher';
    for (const [wid, wm] of Object.entries(vis.weaponMeshes)) {
      wm.visible = isActive && wid === activeWepId;
    }

    // Ramen bowl & bamboo stick visibility based on pose!
    const hasRamen = pd.hasRamen;
    const onBelly = hasRamen && !isActive && !isTumbling && !isSleeping && (pd.ramenPlacement === 'belly' || pd.ramenPlacement === 'paws');
    const onGround = hasRamen && !onBelly && !isTumbling && !isSleeping;
    vis.bellyRamen.visible = onBelly;
    vis.groundRamen.visible = onGround;
    vis.bambooStick.visible = !isActive && !isTumbling && !isSleeping && pd.idlePose === 'bamboo_sit';

    // Animate delicate ramen steam wisps
    for (const bowl of [vis.bellyRamen, vis.groundRamen]) {
      if (bowl.visible && bowl.userData.steam) {
        bowl.userData.steam.children.forEach((p, idx) => {
          const st = (time * 0.9 + idx * 0.35) % 1;
          p.position.y = 0.24 + st * 0.24;
          p.scale.setScalar(0.75 + st * 0.6);
        });
      }
    }

    // Reset base transforms before applying pose
    vis.torso.position.set(0, 0.44, 0);
    vis.torso.rotation.set(0, 0, 0);
    vis.headGroup.rotation.set(0, 0, 0);
    vis.armL.rotation.set(0, 0, 0);
    vis.armR.rotation.set(0, 0, 0);
    vis.legL.rotation.set(0, 0, 0);
    vis.legR.rotation.set(0, 0, 0);

    if (isSleeping) {
      // Curled up peacefully snoring at the den entrance!
      const breath = Math.sin(time * 2.1 + pd.slot) * 0.04;
      vis.torso.position.set(0, 0.28, 0);
      vis.torso.rotation.set(0.75, 0.25, 0.45);
      vis.torso.scale.set(1 + breath, 1 - breath * 0.5, 1 + breath);
      vis.headGroup.rotation.set(0.32, 0.2, 0.28);
      vis.armL.rotation.set(-0.6, 0, 0.5);
      vis.armR.rotation.set(-0.5, 0, -0.5);

      // Periodic floating Zzz bubbles!
      vis.zzzTimer -= dt;
      if (vis.zzzTimer <= 0) {
        vis.zzzTimer = 1.9 + Math.random() * 1.1;
        this._spawnPopup('Zzz', '#38bdf8', vis.root.position.x, vis.root.position.y + 0.95, vis.root.position.z);
      }
      return;
    }

    vis.torso.scale.set(1, 1, 1);

    if (isTumbling) {
      // Joyful clumsy Fall-Guys somersault tumble!
      vis.torso.position.y = 0.52;
      vis.torso.rotation.set(pd.tumbleAngleX, 0, pd.tumbleAngleZ);
      const flail = Math.sin(time * 16 + pd.slot) * 0.7;
      vis.armL.rotation.set(-1.3 + flail, 0, 0.7);
      vis.armR.rotation.set(-1.3 - flail, 0, -0.7);
      vis.legL.rotation.set(flail * 0.6, 0, 0.2);
      vis.legR.rotation.set(-flail * 0.6, 0, -0.2);
      return;
    }

    if (isActive) {
      // Clumsy, nonchalant stationary panda holding & aiming the whimsical weapon!
      const pitchRad = typeof this.lastState?.aimPitch === 'number'
        ? this.lastState.aimPitch
        : (ARC_ANGLES[this.lastState?.arcIndex ?? 1] || ARC_ANGLES[1]).rad;
      const recoil = pd.recoilTimer > 0 ? Math.sin((pd.recoilTimer / 0.44) * Math.PI) * 0.44 : 0;

      vis.torso.position.y = 0.45;
      vis.torso.rotation.set(-0.08 - recoil, 0, Math.sin(time * 1.8) * 0.03);
      // Slight goofy head tilt so the panda looks chill & clumsy, never angry!
      vis.headGroup.rotation.set(0.06, -0.08, 0.14 + Math.sin(time * 2.2) * 0.05);

      // Pitch weapon smoothly with continuous launch angle!
      vis.weaponMount.rotation.set(-pitchRad * 0.78 - recoil * 0.55, 0, 0);
      vis.armR.rotation.set(-1.12 - pitchRad * 0.48, 0, -0.18);
      vis.armL.rotation.set(-1.02 - pitchRad * 0.38, 0, 0.42);
      vis.legL.rotation.set(-0.62, 0, 0.08);
      vis.legR.rotation.set(-0.62, 0, -0.08);
      return;
    }

    // Serene fat-and-happy idle poses across the landscape!
    const sway = Math.sin(ph) * 0.08;
    if (pd.idlePose === 'belly_ramen') {
      // Lounging happily on back with ramen bowl resting right on belly!
      vis.torso.position.y = 0.36;
      vis.torso.rotation.set(-0.62, 0, sway * 0.6);
      vis.headGroup.rotation.set(0.42, sway * 0.9, 0.08);
      vis.bellyRamen.position.set(0, 0.1, 0.4);
      vis.bellyRamen.rotation.set(0.58, 0, 0);
      vis.armL.rotation.set(-0.85, 0, 0.35 + Math.sin(ph * 1.6) * 0.12);
      vis.armR.rotation.set(-0.85, 0, -0.35 - Math.sin(ph * 1.6) * 0.12);
      vis.legL.rotation.set(0.25 + Math.sin(ph) * 0.12, 0.25, 0.15);
      vis.legR.rotation.set(0.25 - Math.sin(ph) * 0.12, -0.25, -0.15);
    } else if (pd.idlePose === 'eat_ramen') {
      // Sitting upright slurping ramen happily from bowl in paws!
      vis.torso.position.y = 0.40;
      vis.torso.rotation.set(0.12, 0, sway * 0.5);
      vis.headGroup.rotation.set(0.18 + Math.sin(ph * 2) * 0.08, 0, sway * 0.6);
      vis.bellyRamen.position.set(0, 0.12, 0.38);
      vis.bellyRamen.rotation.set(0, 0, 0);
      vis.armL.rotation.set(-1.15, 0, 0.42);
      vis.armR.rotation.set(-1.25 + Math.sin(ph * 2.2) * 0.16, 0, -0.42);
    } else if (pd.idlePose === 'lazy_roll') {
      // Playfully rocking side-to-side on their chubby bottom!
      const rock = Math.sin(ph * 1.35) * 0.34;
      vis.torso.position.y = 0.40;
      vis.torso.rotation.set(-0.12, 0, rock);
      vis.headGroup.rotation.set(0.08, rock * 0.5, -rock * 0.35);
      vis.armL.rotation.set(-0.7 + rock * 0.5, 0, 0.55);
      vis.armR.rotation.set(-0.7 - rock * 0.5, 0, -0.55);
      vis.legL.rotation.set(0.2 + rock * 0.5, 0.15, 0.15);
      vis.legR.rotation.set(0.2 - rock * 0.5, -0.15, -0.15);
    } else {
      // 'bamboo_sit': Sitting fat-and-happy munching a crisp green stick of bamboo!
      const chew = Math.sin(ph * 2.6) * 0.08;
      vis.torso.position.y = 0.41;
      vis.torso.rotation.set(0.06, 0, sway * 0.4);
      vis.headGroup.rotation.set(0.12 + chew, sway * 0.6, 0.06);
      vis.armL.rotation.set(-1.28 + chew, 0, 0.44);
      vis.armR.rotation.set(-1.15 - chew, 0, -0.44);
      vis.bambooStick.rotation.set(0.2 + chew * 0.8, 0.15, 0.68);
    }
  }

  _updateAimTrajectory(time) {
    const s = this.lastState;
    if (!s || s.phase !== 'aim') {
      for (const d of this.aimDots) d.visible = false;
      this.aimRing.visible = false;
      return;
    }
    const pd = s.pandas.find((p) => p.id === s.activePandaId);
    if (!pd || !pd.hasRamen) {
      for (const d of this.aimDots) d.visible = false;
      this.aimRing.visible = false;
      return;
    }

    const weapon = WEAPON_BY_ID[s.selectedWeapon] || WEAPONS[0];
    const pitchRad = typeof s.aimPitch === 'number'
      ? s.aimPitch
      : (ARC_ANGLES[s.arcIndex] || ARC_ANGLES[1]).rad;
    const power = typeof s.aimPower === 'number' ? s.aimPower : (s.isCharging ? s.chargePower : 0.62);
    const speed = weapon.speed * (0.42 + 0.72 * power);
    const sinY = Math.sin(pd.yaw);
    const cosY = Math.cos(pd.yaw);
    const cosP = Math.cos(pitchRad);
    const sinP = Math.sin(pitchRad);

    let x = pd.x + sinY * 0.62;
    let y = pd.y + 0.78;
    let z = pd.z + cosY * 0.62;
    let vx = sinY * cosP * speed;
    let vy = sinP * speed;
    let vz = cosY * cosP * speed;
    const grav = GRAVITY * weapon.gravityScale;

    let landed = null;
    const stepDt = 0.088;
    for (let i = 0; i < this.aimDots.length; i++) {
      const dot = this.aimDots[i];
      if (landed) {
        dot.visible = false;
        continue;
      }
      vx += s.windX * 0.45 * stepDt;
      vz += s.windZ * 0.45 * stepDt;
      vy -= grav * stepDt;
      x += vx * stepDt;
      y += vy * stepDt;
      z += vz * stepDt;

      const g = getSurfaceHeight(x, z, y + 0.3);
      if (y <= g + 0.08 || Math.abs(x) > HALF_W || Math.abs(z) > HALF_D) {
        landed = { x: Math.max(-HALF_W, Math.min(HALF_W, x)), y: g + 0.05, z: Math.max(-HALF_D, Math.min(HALF_D, z)) };
        dot.visible = false;
      } else {
        dot.visible = true;
        dot.position.set(x, y, z);
        const sc = Math.max(0.45, 1.05 - i * 0.02);
        dot.scale.setScalar(sc);
      }
    }

    if (landed) {
      this.aimRing.visible = true;
      this.aimRing.position.set(landed.x, landed.y, landed.z);
      const pulse = 0.92 + Math.sin(time * 7) * 0.12;
      this.aimRing.scale.setScalar(pulse);
    } else {
      this.aimRing.visible = false;
    }
  }

  update(dt) {
    const time = performance.now() / 1000;
    const smooth = Math.min(1, dt * 16);

    // Animate cascading waterfall & meandering mountain river flow!
    if (this.waterfallTex) {
      this.waterfallTex.offset.y = (this.waterfallTex.offset.y - dt * 1.35) % 1;
    }
    if (this.riverTex) {
      this.riverTex.offset.y = (this.riverTex.offset.y - dt * 0.55) % 1;
    }
    const wf = WATERFALL_CONFIG;
    for (const r of this.foamRings) {
      const u = (time * 0.72 + r.phase) % 1;
      r.mesh.scale.setScalar(0.55 + u * 1.15);
      r.mesh.material.opacity = (1 - u) * 0.68;
    }
    for (const m of this.waterfallMist) {
      const u = (time * 0.58 + m.phase) % 1;
      m.mesh.position.set(
        wf.x + m.ox * (0.65 + u * 0.8),
        WATER_LEVEL + 0.12 + u * 1.35,
        wf.poolZ + m.oz + u * 0.55,
      );
      m.mesh.scale.setScalar(0.65 + u * 1.1);
      m.mesh.material.opacity = Math.sin(u * Math.PI) * 0.52;
    }

    // Smoothly interpolate & animate all 8 pandas
    for (const vis of this.pandaVisuals.values()) {
      vis.root.position.x += (vis.targetX - vis.root.position.x) * smooth;
      vis.root.position.y += (vis.targetY - vis.root.position.y) * smooth;
      vis.root.position.z += (vis.targetZ - vis.root.position.z) * smooth;

      let diff = vis.targetYaw - vis.body.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      vis.body.rotation.y += diff * smooth;

      this._animatePanda(vis, dt, time);
    }

    // Smoothly move & spin projectiles
    const ps = Math.min(1, dt * 24);
    for (const pVis of this.projVisuals.values()) {
      pVis.mesh.position.lerp(pVis.target, ps);
      const st = pVis.state;
      if (st.weaponId === 'rocket-launcher' || st.weaponId === 'bamboo-bazooka') {
        const dir = new THREE.Vector3(st.vx, st.vy, st.vz);
        if (dir.lengthSq() > 0.01) {
          pVis.mesh.lookAt(pVis.mesh.position.clone().add(dir));
        }
      } else {
        pVis.mesh.rotation.x = st.spin;
        pVis.mesh.rotation.z = st.spin * 0.6;
      }
    }

    // Gentle bamboo grove sway in the breeze
    const wx = this.lastState?.windX || 0.35;
    const wz = this.lastState?.windZ || 0.1;
    for (const b of this.bambooStalks) {
      const s = Math.sin(time * 2.1 + b.phase) * 0.045;
      b.mesh.rotation.x = b.baseLeanX + wz * 0.04 + s;
      b.mesh.rotation.z = b.baseLeanZ - wx * 0.04 + s * 0.7;
    }

    // Drifting bamboo breeze leaves
    for (const lf of this.windLeaves) {
      lf.mesh.position.x += (wx * 0.9 + Math.sin(time + lf.phase) * 0.2) * dt;
      lf.mesh.position.z += (wz * 0.9 + Math.cos(time + lf.phase) * 0.2) * dt;
      lf.mesh.position.y -= 0.18 * dt;
      lf.mesh.rotation.x += dt * 2.4;
      lf.mesh.rotation.y += dt * 3.1;
      if (
        lf.mesh.position.y < 0.25 ||
        Math.abs(lf.mesh.position.x) > HALF_W ||
        Math.abs(lf.mesh.position.z) > HALF_D
      ) {
        lf.mesh.position.set(
          (Math.random() - 0.5) * BOARD_WIDTH,
          2.6 + Math.random() * 2.0,
          (Math.random() - 0.5) * BOARD_DEPTH,
        );
      }
    }

    // Update 3D aim arc dots
    this._updateAimTrajectory(time);

    // Flying captured ramen bowls arcing to the winning team's den!
    for (let i = this.flyingBowls.length - 1; i >= 0; i--) {
      const fb = this.flyingBowls[i];
      fb.t += dt;
      const u = Math.min(1, fb.t / fb.dur);
      fb.mesh.position.x = fb.sx + (fb.tx - fb.sx) * u;
      fb.mesh.position.z = fb.sz + (fb.tz - fb.sz) * u;
      fb.mesh.position.y = fb.sy + (fb.ty - fb.sy) * u + Math.sin(u * Math.PI) * 2.8;
      fb.mesh.rotation.y += dt * 8;
      fb.mesh.scale.setScalar(1.05 * (1 - u * 0.35));
      if (u >= 1) {
        this.group.remove(fb.mesh);
        this.flyingBowls.splice(i, 1);
      }
    }

    // Cartoon particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        this.group.remove(pt.mesh);
        pt.mesh.geometry.dispose();
        pt.mesh.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      pt.vy -= pt.gravity * dt;
      pt.mesh.position.x += pt.vx * dt;
      pt.mesh.position.y = Math.max(0.06, pt.mesh.position.y + pt.vy * dt);
      pt.mesh.position.z += pt.vz * dt;
      const ratio = Math.max(0, pt.life / pt.maxLife);
      pt.mesh.material.opacity = ratio;
      pt.mesh.scale.setScalar(0.55 + ratio * 0.7);
    }

    // Comic popup sprites
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
      pop.sprite.position.y += dt * 0.62;
      pop.sprite.material.opacity = Math.min(1, pop.life * 2.2);
    }
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    if (this.ui) this.ui.dispose();
    this.boardRoot.remove(this.group);
  }
}
