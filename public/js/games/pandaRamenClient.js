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
  const tex = makeCanvasTex(384, 68, (ctx, w, h) => {
    ctx.font = '900 24px "Trebuchet MS", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = Math.min(w - 20, ctx.measureText(text).width + 32);
    const rx = (w - tw) / 2;
    const ry = 10;
    const rh = h - 20;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
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
  sp.scale.set(2.9, 0.52, 1);
  return sp;
}

// ---------------------------------------------------------------------------
// Whimsical Fall-Guys / Cartoon Sound Effects
// ---------------------------------------------------------------------------

const sfx = {
  wheelClick() {
    sound._tone({ type: 'triangle', f0: 540, f1: 720, duration: 0.055, gain: 0.1 });
  },
  rouletteTick() {
    sound._tone({ type: 'triangle', f0: 820, f1: 420, duration: 0.032, gain: 0.075 });
  },
  rouletteLand() {
    sound.playNotes([[523.25, 1], [659.25, 1], [783.99, 1.8]], { type: 'triangle', step: 0.06, gain: 0.12 });
  },
  countdownTick(urgent = false) {
    sound._tone({ type: 'square', f0: urgent ? 880 : 620, f1: urgent ? 660 : 520, duration: 0.06, gain: 0.085 });
  },
  hop() {
    sound._tone({ type: 'sine', f0: 260, f1: 560, duration: 0.12, gain: 0.11 });
  },
  fire(weaponId) {
    if (weaponId === 'balloon-bazooka') {
      sound._tone({ type: 'sine', f0: 560, f1: 280, duration: 0.24, gain: 0.13 });
      sound.playNoise({ duration: 0.2, freq: 1400, q: 1.2, gain: 0.1, type: 'bandpass' });
    } else if (weaponId === 'glitter-grenade') {
      sound._tone({ type: 'triangle', f0: 320, f1: 610, duration: 0.14, gain: 0.12 });
    } else if (weaponId === 'dumpling-airstrike') {
      sound._tone({ type: 'sine', f0: 380, f1: 760, duration: 0.18, gain: 0.12 });
    } else if (weaponId === 'udon-hook') {
      sound._tone({ type: 'sawtooth', f0: 260, f1: 740, duration: 0.16, gain: 0.12 });
    } else if (weaponId === 'towel-gun') {
      sound.playNoise({ duration: 0.18, freq: 720, q: 0.7, gain: 0.16, type: 'bandpass' });
      sound._tone({ type: 'sine', f0: 190, f1: 110, duration: 0.15, gain: 0.14 });
    } else {
      sound._tone({ type: 'triangle', f0: 440, f1: 880, duration: 0.11, gain: 0.12 });
    }
  },
  lanternGong() {
    sound.playNotes([[392, 1.5], [523.25, 2.2]], { type: 'sine', step: 0.09, gain: 0.11 });
  },
  udonYank() {
    sound._tone({ type: 'sine', f0: 220, f1: 880, duration: 0.22, gain: 0.15 });
  },
  backfire() {
    sound.playNoise({ duration: 0.36, freq: 380, q: 0.6, gain: 0.18, type: 'lowpass' });
    sound.playNotes([[349.2, 1.2], [311.1, 1.2], [277.2, 1.4], [220, 2.5]], { type: 'sawtooth', step: 0.09, gain: 0.1 });
  },
  boing() {
    sound._tone({ type: 'sine', f0: 190, f1: 620, duration: 0.18, gain: 0.15 });
  },
  explosion(weaponId) {
    if (weaponId === 'glitter-grenade') {
      sound.playNotes([[784, 0.7], [1046.5, 0.7], [1318.5, 0.9], [1568, 1.3]], { type: 'triangle', step: 0.045, gain: 0.11 });
      sound.playNoise({ duration: 0.28, freq: 2400, q: 0.8, gain: 0.13, type: 'bandpass' });
    } else if (weaponId === 'towel-gun') {
      sound.playNoise({ duration: 0.34, freq: 1700, q: 0.6, gain: 0.16, type: 'bandpass' });
      sound._tone({ type: 'sine', f0: 240, f1: 95, duration: 0.18, gain: 0.12 });
    } else if (weaponId === 'balloon-bazooka') {
      sound.playNoise({ duration: 0.12, freq: 1100, q: 0.5, gain: 0.2, type: 'highpass' });
      sound._tone({ type: 'triangle', f0: 360, f1: 80, duration: 0.12, gain: 0.15 });
    } else {
      sound.playNoise({ duration: 0.26, freq: 480, q: 0.6, gain: 0.16, type: 'lowpass' });
      sound._tone({ type: 'triangle', f0: 190, f1: 55, duration: 0.24, gain: 0.15 });
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

  if (weaponId === 'balloon-bazooka') {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.82, 12), mats.olive);
    tube.rotation.x = Math.PI / 2;
    tube.position.z = 0.06;
    tube.castShadow = true;
    g.add(tube);

    const wood = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.12, 0.34, 12), mats.wood);
    wood.rotation.x = Math.PI / 2;
    wood.position.z = -0.18;
    g.add(wood);

    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.185, 0.24, 12), mats.exhaustBlue);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.z = -0.46;
    g.add(exhaust);

    const balloon = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 12), mats.balloonPink);
    balloon.scale.set(0.92, 0.95, 1.28);
    balloon.position.z = 0.62;
    balloon.castShadow = true;
    g.add(balloon);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 7), mats.balloonPink);
    knot.rotation.x = Math.PI / 2;
    knot.position.z = 0.37;
    g.add(knot);
    g.scale.setScalar(1.18);
  } else if (weaponId === 'glitter-grenade') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.36, 10), mats.bambooLight);
    body.position.set(0, 0.02, 0.24);
    body.castShadow = true;
    g.add(body);
    for (const dy of [-0.08, 0.08]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.168, 0.022, 6, 12), mats.bambooNode);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, 0.02 + dy, 0.24);
      g.add(ring);
    }
    const pin = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 10), mats.goldMetal);
    pin.position.set(0.08, 0.24, 0.24);
    g.add(pin);
    const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), mats.glitterGold);
    spark.position.set(0, 0.26, 0.24);
    g.add(spark);
  } else if (weaponId === 'dumpling-airstrike') {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.85, 8), mats.bambooDark);
    pole.rotation.x = Math.PI / 2 - 0.35;
    pole.position.set(0, 0.08, 0.15);
    g.add(pole);
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), mats.lanternRed);
    lantern.scale.set(1.0, 1.2, 1.0);
    lantern.position.set(0, 0.14, 0.56);
    lantern.castShadow = true;
    g.add(lantern);
    for (const dy of [-0.21, 0.21]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 10), mats.goldMetal);
      cap.position.set(0, 0.14 + dy, 0.56);
      g.add(cap);
    }
    const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 7), mats.goldMetal);
    tassel.position.set(0, -0.16, 0.56);
    g.add(tassel);
  } else if (weaponId === 'udon-hook') {
    const stock = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.68, 8), mats.wood);
    stock.rotation.x = Math.PI / 2;
    stock.position.z = 0.02;
    g.add(stock);
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.036, 8, 14), mats.udonCream);
    coil.position.set(0.12, -0.02, 0.06);
    coil.rotation.y = Math.PI / 2;
    g.add(coil);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.38, 8), mats.goldMetal);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 0.48;
    g.add(shaft);
    for (let k = 0; k < 3; k++) {
      const ang = (k / 3) * Math.PI * 2;
      const prong = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 6, 10, Math.PI * 0.9), mats.goldMetal);
      prong.position.set(Math.cos(ang) * 0.06, Math.sin(ang) * 0.06, 0.62);
      prong.rotation.z = ang + Math.PI * 0.5;
      prong.rotation.x = Math.PI * 0.5;
      g.add(prong);
    }
  } else if (weaponId === 'towel-gun') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.68, 14), mats.exhaustBlue);
    body.rotation.x = Math.PI / 2;
    body.position.z = 0.06;
    body.castShadow = true;
    g.add(body);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 10), mats.gunmetal);
    tank.rotation.x = Math.PI / 2;
    tank.position.set(0, -0.17, -0.02);
    g.add(tank);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.155, 0.12, 14), mats.goldMetal);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.z = 0.42;
    g.add(nozzle);
    const towel = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.34, 12), mats.towelWhite);
    towel.rotation.x = Math.PI / 2;
    towel.position.z = 0.56;
    towel.castShadow = true;
    g.add(towel);
    g.scale.setScalar(1.12);
  } else if (weaponId === 'lotus-sling') {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.34, 8), mats.wood);
    handle.position.set(0, -0.08, 0.25);
    g.add(handle);
    for (const side of [-1, 1]) {
      const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 0.3, 8), mats.wood);
      fork.position.set(side * 0.13, 0.18, 0.25);
      fork.rotation.z = -side * 0.52;
      g.add(fork);
    }
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.03), mats.lotusPink);
    band.position.set(0, 0.28, 0.22);
    g.add(band);
    const bud = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mats.lotusPink);
    bud.position.set(0, 0.28, 0.3);
    g.add(bud);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), mats.glitterGold);
    core.position.set(0, 0.33, 0.31);
    g.add(core);
  }

  return g;
}

function createChineseLanternMesh(mats) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.68, 16, 12), mats.lanternRed);
  body.scale.set(1.0, 1.24, 1.0);
  body.castShadow = true;
  g.add(body);
  for (let i = 0; i < 4; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.67, 0.026, 6, 20), mats.goldMetal);
    rib.rotation.y = (i / 4) * Math.PI;
    rib.scale.set(1.0, 1.24, 1.0);
    g.add(rib);
  }
  const topCap = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.12, 14), mats.goldMetal);
  topCap.position.y = 0.84;
  const botCap = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.12, 14), mats.goldMetal);
  botCap.position.y = -0.84;
  const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.42, 8), mats.goldMetal);
  tassel.position.y = -1.14;
  const glowLight = new THREE.PointLight(0xffaa33, 1.4, 14, 1.2);
  glowLight.position.y = -0.2;
  g.add(topCap, botCap, tassel, glowLight);
  return g;
}

function createProjectileMesh(weaponId, mats, isSub = false) {
  const g = new THREE.Group();
  if (weaponId === 'balloon-bazooka') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), mats.balloonPink);
    body.scale.set(0.88, 0.92, 1.38);
    body.castShadow = true;
    g.add(body);
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.032, 8, 16), mats.glitterGold);
    g.add(stripe);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 8), mats.balloonPink);
    knot.rotation.x = Math.PI / 2;
    knot.position.z = -0.36;
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 5), mats.cream);
    tail.rotation.x = Math.PI / 2;
    tail.position.z = -0.58;
    g.add(knot, tail);
  } else if (weaponId === 'glitter-grenade') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.19, 0.38, 10), mats.bambooLight);
    body.castShadow = true;
    g.add(body);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.025, 6, 12), mats.bambooNode);
    band.rotation.x = Math.PI / 2;
    g.add(band);
    const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), mats.glitterGold);
    spark.position.y = 0.25;
    g.add(spark);
  } else if (weaponId === 'dumpling-airstrike') {
    if (isSub) {
      const bao = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), mats.dumpling);
      bao.scale.set(1.12, 0.84, 1.12);
      bao.castShadow = true;
      g.add(bao);
      const pinch = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.1, 8), mats.dumpling);
      pinch.position.y = 0.2;
      g.add(pinch);
    } else {
      const flare = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), mats.lanternRed);
      flare.scale.set(1, 1.25, 1);
      g.add(flare);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), mats.glitterGold);
      glow.material = glow.material.clone();
      glow.material.transparent = true;
      glow.material.opacity = 0.35;
      g.add(glow);
    }
  } else if (weaponId === 'udon-hook') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.48, 8), mats.goldMetal);
    shaft.rotation.x = Math.PI / 2;
    shaft.castShadow = true;
    g.add(shaft);
    for (let k = 0; k < 3; k++) {
      const ang = (k / 3) * Math.PI * 2;
      const prong = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.032, 6, 12, Math.PI * 0.95), mats.goldMetal);
      prong.position.set(Math.cos(ang) * 0.08, Math.sin(ang) * 0.08, 0.16);
      prong.rotation.z = ang + Math.PI * 0.5;
      prong.rotation.x = Math.PI * 0.5;
      g.add(prong);
    }
  } else if (weaponId === 'towel-gun') {
    const towel = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.52, 12), mats.towelWhite);
    towel.rotation.z = Math.PI / 2;
    towel.castShadow = true;
    g.add(towel);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.022, 6, 14), mats.exhaustBlue);
    band.rotation.y = Math.PI / 2;
    g.add(band);
    const steam = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), mats.steam);
    steam.position.set(0, 0.14, -0.18);
    g.add(steam);
  } else if (weaponId === 'lotus-sling') {
    const center = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mats.glitterGold);
    g.add(center);
    for (let p = 0; p < 6; p++) {
      const ang = (p / 6) * Math.PI * 2;
      const petal = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), mats.lotusPink);
      petal.scale.set(0.65, 0.32, 1.35);
      petal.position.set(Math.sin(ang) * 0.18, 0.02, Math.cos(ang) * 0.18);
      petal.rotation.y = ang;
      petal.rotation.x = -0.25;
      petal.castShadow = true;
      g.add(petal);
    }
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
    case 'balloon-bazooka':
      return `
        <g transform="rotate(-24)">
          <rect x="-22" y="-5" width="24" height="10" rx="2" fill="#779642" stroke="#111" stroke-width="2"/>
          <rect x="-14" y="-5" width="8" height="10" fill="#9c6234" stroke="#111" stroke-width="1.6"/>
          <ellipse cx="14" cy="0" rx="11" ry="8.5" fill="#ec4899" stroke="#111" stroke-width="2"/>
          <path d="M9,-5 Q14,0 9,5 M16,-6 Q20,0 16,6" fill="none" stroke="#fde047" stroke-width="2"/>
        </g>`;
    case 'glitter-grenade':
      return `
        <g>
          <rect x="-10" y="-8" width="20" height="22" rx="5" fill="#77b83c" stroke="#111" stroke-width="2"/>
          <line x1="-10" y1="0" x2="10" y2="0" stroke="#2c4f18" stroke-width="2.2"/>
          <line x1="-10" y1="7" x2="10" y2="7" stroke="#2c4f18" stroke-width="2.2"/>
          <circle cx="8" cy="-12" r="4.5" fill="none" stroke="#facc15" stroke-width="2.2"/>
          <polygon points="-2,-19 0,-13 6,-13 1,-9 3,-3 -2,-7 -7,-3 -5,-9 -10,-13 -4,-13" fill="#fde047" stroke="#111" stroke-width="1.2"/>
        </g>`;
    case 'dumpling-airstrike':
      return `
        <g>
          <ellipse cx="0" cy="-5" rx="13" ry="11" fill="#dc2626" stroke="#111" stroke-width="2"/>
          <path d="M-5,-15 Q-8,-5 -5,5 M5,-15 Q8,-5 5,5" fill="none" stroke="#facc15" stroke-width="1.8"/>
          <rect x="-6" y="-17" width="12" height="3.5" rx="1" fill="#facc15" stroke="#111" stroke-width="1.3"/>
          <rect x="-6" y="5" width="12" height="3.5" rx="1" fill="#facc15" stroke="#111" stroke-width="1.3"/>
          <ellipse cx="-6" cy="14" rx="5" ry="4" fill="#f5f3ff" stroke="#111" stroke-width="1.5"/>
          <ellipse cx="6" cy="14" rx="5" ry="4" fill="#f5f3ff" stroke="#111" stroke-width="1.5"/>
        </g>`;
    case 'udon-hook':
      return `
        <g>
          <path d="M-16,12 Q-6,16 -2,4 Q2,-8 10,-6" fill="none" stroke="#fff7e6" stroke-width="4.5" stroke-linecap="round"/>
          <path d="M-16,12 Q-6,16 -2,4 Q2,-8 10,-6" fill="none" stroke="#111" stroke-width="1.2" stroke-linecap="round"/>
          <path d="M4,-14 C14,-16 18,-6 11,1 C16,-2 17,9 7,10" fill="none" stroke="#f59e0b" stroke-width="3.6" stroke-linecap="round"/>
          <circle cx="9" cy="-5" r="3" fill="#facc15" stroke="#111" stroke-width="1.5"/>
        </g>`;
    case 'towel-gun':
      return `
        <g transform="rotate(-18)">
          <rect x="-19" y="-7" width="22" height="14" rx="3" fill="#64748b" stroke="#111" stroke-width="2"/>
          <rect x="2" y="-9" width="16" height="16" rx="4" fill="#f8fafc" stroke="#111" stroke-width="2"/>
          <line x1="10" y1="-9" x2="10" y2="7" stroke="#38bdf8" stroke-width="2.5"/>
          <path d="M19,-8 Q23,-12 21,-16 M22,-1 Q26,-5 24,-9" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        </g>`;
    case 'lotus-sling':
      return `
        <g>
          <path d="M0,15 L0,3 L-11,-9 M0,3 L11,-9" fill="none" stroke="#92400e" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>
          <ellipse cx="0" cy="-7" rx="5.5" ry="9" fill="#f472b6" stroke="#111" stroke-width="1.6"/>
          <ellipse cx="-8" cy="-4" rx="5" ry="7.5" transform="rotate(-35 -8 -4)" fill="#f9a8d4" stroke="#111" stroke-width="1.5"/>
          <ellipse cx="8" cy="-4" rx="5" ry="7.5" transform="rotate(35 8 -4)" fill="#f9a8d4" stroke="#111" stroke-width="1.5"/>
          <circle cx="0" cy="-5" r="3.2" fill="#fde047"/>
        </g>`;
    default:
      return '';
  }
}

function createWeaponWheelOverlay({ onSlingshotAim, onSlingshotFire, onAngleChange, onNextPanda }) {
  const wrap = document.createElement('div');
  wrap.className = 'panda-ui-layer';

  // Top-center Turn, Ramen Scoreboard, 15s Timer & Wind Pill
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
        <span id="pandaTimerText" class="panda-timer">15s</span>
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

  // Lower-left Angry-Birds-Style Pull-Back Slingshot + Vertical Elevation Angle + NEXT Panda!
  const aimDeck = document.createElement('div');
  aimDeck.className = 'panda-slingshot-deck';
  aimDeck.innerHTML = `
    <div class="panda-slingshot-col">
      <div id="pandaSlingshotPad" class="panda-slingshot-pad" aria-label="Pull back and release to shoot">
        <svg class="slingshot-svg" viewBox="0 0 144 144">
          <!-- Outer approximation dial rings -->
          <circle cx="72" cy="72" r="64" fill="rgba(15,23,42,0.78)" stroke="rgba(255,255,255,0.22)" stroke-width="2.5"/>
          <circle cx="72" cy="72" r="42" fill="none" stroke="rgba(255,255,255,0.12)" stroke-dasharray="4 4"/>
          <circle cx="72" cy="72" r="15" fill="rgba(255,255,255,0.06)" stroke="rgba(247,226,49,0.45)" stroke-width="1.5"/>
          <!-- Aim direction arrow ahead of center -->
          <line id="slingAimLine" x1="72" y1="72" x2="72" y2="28" stroke="#f7e231" stroke-width="3" stroke-dasharray="4 4" stroke-linecap="round" opacity="0"/>
          <!-- Stretched elastic bands from wooden prongs to puck -->
          <line id="slingBandL" x1="56" y1="72" x2="72" y2="72" stroke="#f97316" stroke-width="5" stroke-linecap="round"/>
          <line id="slingBandR" x1="88" y1="72" x2="72" y2="72" stroke="#f97316" stroke-width="5" stroke-linecap="round"/>
          <!-- Wooden slingshot prongs -->
          <circle cx="56" cy="72" r="5" fill="#92400e" stroke="#fde68a" stroke-width="1.8"/>
          <circle cx="88" cy="72" r="5" fill="#92400e" stroke="#fde68a" stroke-width="1.8"/>
          <!-- Draggable launch puck -->
          <g id="slingPuck" transform="translate(72, 72)">
            <circle cx="0" cy="0" r="18" fill="#ef4444" stroke="#ffffff" stroke-width="3"/>
            <text id="slingPuckIcon" x="0" y="6" text-anchor="middle" font-size="16">🎈</text>
          </g>
        </svg>
        <div id="slingReadout" class="sling-readout">PULL TO SHOOT</div>
      </div>
      <div class="control-caption">PULL BACK &amp; RELEASE</div>
    </div>

    <div class="panda-side-controls">
      <button id="pandaNextBtn" type="button" class="panda-next-btn" aria-label="Switch Panda">
        <span class="panda-next-icon">🐼</span>
        <span class="panda-next-lbl">NEXT</span>
      </button>
      <div class="panda-angle-wrap" aria-label="Launch angle">
        <span class="angle-lbl">ANGLE</span>
        <span id="pandaAngleVal" class="angle-val">42°</span>
        <input id="pandaAngleSlider" class="angle-slider" type="range" min="14" max="74" step="1" value="42" orient="vertical" />
      </div>
    </div>
  `;
  wrap.appendChild(aimDeck);

  // Wire Angry-Birds Slingshot Pull-Back & Release!
  const padEl = aimDeck.querySelector('#pandaSlingshotPad');
  const bandL = aimDeck.querySelector('#slingBandL');
  const bandR = aimDeck.querySelector('#slingBandR');
  const aimLine = aimDeck.querySelector('#slingAimLine');
  const puckG = aimDeck.querySelector('#slingPuck');
  const puckIcon = aimDeck.querySelector('#slingPuckIcon');
  const readoutEl = aimDeck.querySelector('#slingReadout');
  const angleSlider = aimDeck.querySelector('#pandaAngleSlider');
  const angleValEl = aimDeck.querySelector('#pandaAngleVal');
  const nextBtn = aimDeck.querySelector('#pandaNextBtn');

  let slingPointerId = null;
  let slingCanShoot = false;
  let currentPull = { active: false, yaw: 0, power: 0.6, cancelled: true };

  const resetPuckVisual = () => {
    puckG.setAttribute('transform', 'translate(72, 72)');
    bandL.setAttribute('x2', '72');
    bandL.setAttribute('y2', '72');
    bandR.setAttribute('x2', '72');
    bandR.setAttribute('y2', '72');
    bandL.setAttribute('stroke', '#f97316');
    bandR.setAttribute('stroke', '#f97316');
    aimLine.setAttribute('opacity', '0');
    readoutEl.textContent = slingCanShoot ? 'PULL TO SHOOT' : 'WAIT TURN';
    readoutEl.classList.remove('cancel');
    padEl.classList.remove('pulling');
  };

  const updatePullFromEvent = (e) => {
    const rect = padEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const scale = 144 / Math.max(1, rect.width);
    const maxR = 56;
    let dx = (e.clientX - cx) * scale;
    let dy = (e.clientY - cy) * scale;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    const clampedDist = Math.min(dist, maxR);
    const px = 72 + dx;
    const py = 72 + dy;
    puckG.setAttribute('transform', `translate(${px.toFixed(1)}, ${py.toFixed(1)})`);
    bandL.setAttribute('x2', px.toFixed(1));
    bandL.setAttribute('y2', py.toFixed(1));
    bandR.setAttribute('x2', px.toFixed(1));
    bandR.setAttribute('y2', py.toFixed(1));

    const cancelled = clampedDist < 13;
    if (cancelled) {
      aimLine.setAttribute('opacity', '0');
      readoutEl.textContent = 'CANCEL';
      readoutEl.classList.add('cancel');
      currentPull.cancelled = true;
      onSlingshotAim({ pulling: false });
      return;
    }

    // Angry-Birds rule: pulling BACK shoots in the OPPOSITE direction!
    const launchDx = -dx;
    const launchDy = -dy; // screen-up (-dy > 0) maps to board -Z (away from viewer)
    // Board coordinate yaw = atan2(vx, vz): +X is right, +Z is toward viewer, -Z is away from viewer
    const aimYaw = Math.atan2(launchDx, launchDy);
    const frac = Math.min(1, Math.max(0, (clampedDist - 13) / (maxR - 13)));
    const power = 0.2 + frac * 0.8;
    const pct = Math.round(frac * 100);

    // Tension color: green -> yellow -> orange -> red
    const bandColor = frac < 0.35 ? '#4ade80' : frac < 0.68 ? '#facc15' : frac < 0.88 ? '#f97316' : '#ef4444';
    bandL.setAttribute('stroke', bandColor);
    bandR.setAttribute('stroke', bandColor);

    const arrowLen = 22 + frac * 34;
    const len = Math.hypot(launchDx, launchDy) || 1;
    aimLine.setAttribute('x2', (72 + (launchDx / len) * arrowLen).toFixed(1));
    aimLine.setAttribute('y2', (72 + (launchDy / len) * arrowLen).toFixed(1));
    aimLine.setAttribute('opacity', '0.92');

    readoutEl.textContent = `POWER ${pct}%`;
    readoutEl.classList.remove('cancel');
    currentPull = { active: true, yaw: aimYaw, power, cancelled: false };
    onSlingshotAim({ pulling: true, aimYaw, aimPower: power });
  };

  padEl.addEventListener('pointerdown', (e) => {
    if (!slingCanShoot) return;
    e.preventDefault();
    e.stopPropagation();
    sound.unlock();
    slingPointerId = e.pointerId;
    padEl.setPointerCapture(e.pointerId);
    padEl.classList.add('pulling');
    updatePullFromEvent(e);
  });

  padEl.addEventListener('pointermove', (e) => {
    if (slingPointerId !== e.pointerId) return;
    e.preventDefault();
    updatePullFromEvent(e);
  });

  const endPull = (e) => {
    if (slingPointerId !== e.pointerId) return;
    e.preventDefault();
    slingPointerId = null;
    const pull = { ...currentPull };
    currentPull.active = false;
    resetPuckVisual();
    if (slingCanShoot && !pull.cancelled) {
      onSlingshotFire({ aimYaw: pull.yaw, aimPower: pull.power });
    } else {
      onSlingshotAim({ pulling: false });
    }
  };

  padEl.addEventListener('pointerup', endPull);
  padEl.addEventListener('pointercancel', endPull);

  angleSlider.addEventListener('input', () => {
    sound.unlock();
    const deg = Number(angleSlider.value);
    angleValEl.textContent = `${deg}°`;
    onAngleChange((deg * Math.PI) / 180);
  });

  nextBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    sound.unlock();
    onNextPanda();
  });

  const onBlur = () => {
    if (slingPointerId !== null) {
      slingPointerId = null;
      currentPull.active = false;
      resetPuckVisual();
      onSlingshotAim({ pulling: false });
    }
  };
  window.addEventListener('blur', onBlur);

  // Roulette Weapon Wheel (spins LARGE in center per turn, then docks in lower-right!)
  const wheelWrap = document.createElement('div');
  wheelWrap.className = 'panda-weapon-wheel';
  wheelWrap.setAttribute('aria-label', 'Roulette Weapon Wheel');

  const size = 224;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = 104;
  const innerR = 28;

  const SLICE_LAYOUT = [
    { ix: 112, iy: 58, tx: 112, ty: 26 },
    { ix: 169, iy: 72, tx: 168, ty: 97 },
    { ix: 169, iy: 132, tx: 168, ty: 158 },
    { ix: 112, iy: 160, tx: 112, ty: 186 },
    { ix: 55, iy: 132, tx: 56, ty: 158 },
    { ix: 55, iy: 72, tx: 56, ty: 97 },
  ];

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
      <g class="wheel-slice ${idx === 0 ? 'selected' : ''}" data-weapon="${w.id}">
        <path class="wheel-wedge" d="${d}" fill="${w.color}" stroke="#141418" stroke-width="3.2" stroke-linejoin="round" />
        <g transform="translate(${pos.ix}, ${pos.iy}) scale(0.76)">
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
    <div id="rouletteBanner" class="roulette-banner hidden">SPINNING WEAPON...</div>
    <div class="wheel-stage">
      <div class="roulette-pointer" aria-hidden="true">▼</div>
      <svg class="wheel-svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
        <circle cx="${cx}" cy="${cy}" r="${outerR + 4}" fill="#141418" />
        <g id="wheelRotor" transform="rotate(0 ${cx} ${cy})">
          ${slicesMarkup}
        </g>
        <g class="wheel-hub">
          <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="#222327" stroke="#111114" stroke-width="4" />
          <text id="wheelHubTop" x="${cx}" y="${cy - 3}" text-anchor="middle" class="wheel-hub-top">SPIN</text>
          <text id="wheelHubBot" x="${cx}" y="${cy + 11}" text-anchor="middle" class="wheel-hub-deg">🎡</text>
        </g>
      </svg>
    </div>
  `;
  wrap.appendChild(wheelWrap);

  const wheelRotor = wheelWrap.querySelector('#wheelRotor');
  const rouletteBanner = wheelWrap.querySelector('#rouletteBanner');
  for (const g of wheelWrap.querySelectorAll('.wheel-slice')) {
    sliceButtons.set(g.getAttribute('data-weapon'), g);
  }

  document.body.appendChild(wrap);

  const WEAPON_EMOJI = {
    'balloon-bazooka': '🎈',
    'glitter-grenade': '✨',
    'dumpling-airstrike': '🏮',
    'udon-hook': '🍜',
    'towel-gun': '♨️',
    'lotus-sling': '🪷',
  };

  return {
    root: wrap,
    wheelWrap,
    wheelRotor,
    rouletteBanner,
    aimDeck,
    sliceButtons,
    redScoreEl: topBanner.querySelector('#pandaRedScore'),
    blueScoreEl: topBanner.querySelector('#pandaBlueScore'),
    turnLabelEl: topBanner.querySelector('#pandaTurnLabel'),
    timerEl: topBanner.querySelector('#pandaTimerText'),
    windEl: topBanner.querySelector('#pandaWindText'),
    hubTopEl: wheelWrap.querySelector('#wheelHubTop'),
    hubBotEl: wheelWrap.querySelector('#wheelHubBot'),
    angleSlider,
    angleValEl,
    nextBtn,
    setSelectedWeapon(weaponId) {
      for (const [id, el] of sliceButtons.entries()) {
        el.classList.toggle('selected', id === weaponId);
      }
      puckIcon.textContent = WEAPON_EMOJI[weaponId] || '🎈';
    },
    setWheelRotation(deg) {
      wheelRotor.setAttribute('transform', `rotate(${deg.toFixed(1)} ${cx} ${cy})`);
    },
    setRouletteCenter(active, bannerText = '') {
      wheelWrap.classList.toggle('roulette-center', Boolean(active));
      rouletteBanner.classList.toggle('hidden', !active);
      if (bannerText) rouletteBanner.textContent = bannerText;
    },
    setCanShoot(canShoot, canSwap) {
      slingCanShoot = Boolean(canShoot);
      aimDeck.classList.toggle('disabled', !slingCanShoot);
      nextBtn.disabled = !slingCanShoot || !canSwap;
      angleSlider.disabled = !slingCanShoot;
      if (!slingCanShoot && slingPointerId === null) {
        readoutEl.textContent = 'WAIT TURN';
      } else if (slingCanShoot && !currentPull.active) {
        readoutEl.textContent = 'PULL TO SHOOT';
      }
    },
    syncAngle(deg) {
      if (document.activeElement !== angleSlider) {
        angleSlider.value = String(deg);
      }
      angleValEl.textContent = `${deg}°`;
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
    this.lanternVisuals = new Map();
    this.ropeVisuals = new Map();
    this.yankRopes = [];
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

    this.roulette = {
      active: false,
      turnNumber: -1,
      startDeg: 0,
      targetDeg: 0,
      currentDeg: 0,
      elapsed: 0,
      duration: 2.55,
      holdTail: 0.58,
      lastTickSlice: -1,
      landedPlayed: false,
      weaponId: WEAPONS[0].id,
      bannerText: '',
    };
    this.lastCountdownSec = 15;

    this.controlLabels = {
      jump: 'NEXT',
      shoot: 'PULL',
      jumpIcon: '🐼',
      shootIcon: '🎈',
      badge: 'BALLOON BAZOOKA',
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
      onSlingshotAim: ({ pulling, aimYaw, aimPower }) => {
        if (pulling) {
          this.sendAction({ isSlingshotPulling: true, aimYaw, aimPower });
        } else {
          this.sendAction({ isSlingshotPulling: false });
        }
      },
      onSlingshotFire: ({ aimYaw, aimPower }) => {
        this.sendAction({ aimYaw, aimPower, fireSlingshot: true, isSlingshotPulling: false });
      },
      onAngleChange: (aimPitch) => {
        this.sendAction({ aimPitch });
      },
      onNextPanda: () => {
        sfx.wheelClick();
        this.sendAction({ nextPanda: true });
      },
    });

    this._onKeyDown = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Tab') {
        e.preventDefault();
        sfx.wheelClick();
        this.sendAction({ nextPanda: true });
      } else if (e.code === 'KeyQ' || e.code === 'KeyE') {
        const curDeg = this.lastState?.aimDeg ?? 36;
        const nextDeg = Math.max(14, Math.min(74, curDeg + (e.code === 'KeyE' ? 4 : -4)));
        this.ui.syncAngle(nextDeg);
        this.sendAction({ aimPitch: (nextDeg * Math.PI) / 180 });
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
      dumpling: new THREE.MeshStandardMaterial({ color: 0xfbf4e4, roughness: 0.75 }),
      melon: new THREE.MeshStandardMaterial({ map: createMelonTexture(), roughness: 0.58 }),
      flame: new THREE.MeshBasicMaterial({ color: 0xfef08a }),
      balloonPink: new THREE.MeshStandardMaterial({ color: 0xff5a8a, roughness: 0.28, metalness: 0.08 }),
      goldMetal: new THREE.MeshStandardMaterial({ color: 0xf5c542, roughness: 0.32, metalness: 0.65 }),
      glitterGold: new THREE.MeshStandardMaterial({
        color: 0xffe45e,
        emissive: 0xd99b00,
        emissiveIntensity: 0.45,
        roughness: 0.24,
        metalness: 0.5,
      }),
      lanternRed: new THREE.MeshStandardMaterial({
        color: 0xe63946,
        emissive: 0xc1121f,
        emissiveIntensity: 0.55,
        roughness: 0.52,
      }),
      udonCream: new THREE.MeshStandardMaterial({ color: 0xf8e7b5, roughness: 0.58, metalness: 0.04 }),
      towelWhite: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.92, metalness: 0.01 }),
      lotusPink: new THREE.MeshStandardMaterial({ color: 0xf472b6, roughness: 0.48, metalness: 0.04 }),
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
    // Angry-Birds style short initial launch stub (7 fading dots, NO full-map cheat reticle!)
    const dotGeo = new THREE.SphereGeometry(0.115, 8, 6);
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(
        dotGeo,
        new THREE.MeshBasicMaterial({
          color: i % 2 === 0 ? 0xfff8dc : 0xf7d13d,
          transparent: true,
          opacity: Math.max(0.18, 0.94 - i * 0.12),
        }),
      );
      m.visible = false;
      this.group.add(m);
      this.aimDots.push(m);
    }
    this.aimRing = null;
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
        roughness: 0.72,
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
        life: 0.55 + Math.random() * 0.45,
        maxLife: 1.0,
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

  _spawnUdonYankRope(fromX, fromY, fromZ, toX, toY, toZ) {
    const start = new THREE.Vector3(fromX, fromY, fromZ);
    const end = new THREE.Vector3(toX, toY, toZ);
    const mid = start.clone().lerp(end, 0.5);
    mid.y += 0.55;
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.055, 6, false), this.mats.udonCream);
    this.group.add(mesh);
    this.yankRopes.push({ mesh, life: 0.45, maxLife: 0.45 });
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
        const rope = this.ropeVisuals.get(id);
        if (rope) {
          this.group.remove(rope);
          rope.geometry.dispose();
          this.ropeVisuals.delete(id);
        }
      }
    }

    // Sync overhead Chinese Paper Lanterns (Dumpling Airstrike)
    const seenLanterns = new Set();
    for (const l of state.lanterns || []) {
      seenLanterns.add(l.id);
      let lVis = this.lanternVisuals.get(l.id);
      if (!lVis) {
        const mesh = createChineseLanternMesh(this.mats);
        mesh.position.set(l.x, l.y, l.z);
        this.group.add(mesh);
        lVis = { mesh, target: new THREE.Vector3(l.x, l.y, l.z), state: l };
        this.lanternVisuals.set(l.id, lVis);
      }
      lVis.target.set(l.x, l.y, l.z);
      lVis.state = l;
    }
    for (const [id, lVis] of this.lanternVisuals.entries()) {
      if (!seenLanterns.has(id)) {
        this.group.remove(lVis.mesh);
        this.lanternVisuals.delete(id);
      }
    }

    // Determine whose turn it is
    const teamInfo = TEAMS[state.activeTeam];
    const isMyTurn = state.activeControllerId === this.selfPlayerId && !state.activeControllerIsBot;
    const activeWeapon = WEAPON_BY_ID[state.selectedWeapon] || WEAPONS[0];
    const winIdx = Math.max(0, WEAPONS.findIndex((w) => w.id === activeWeapon.id));

    // Per-turn Roulette Weapon Wheel spin (LARGE & centered for the active user BEFORE timer starts!)
    if (state.phase === 'wheel_spin') {
      if (!this.roulette.active || this.roulette.turnNumber !== state.turnNumber) {
        const spins = state.wheelSpinTurns || 4;
        const startDeg = this.roulette.currentDeg;
        const targetMod = (((-winIdx * 60) % 360) + 360) % 360;
        const curMod = ((startDeg % 360) + 360) % 360;
        const deltaMod = (targetMod - curMod + 360) % 360;
        const duration = Math.max(1.0, state.wheelSpinDuration || 2.55);
        const holdTail = Math.min(0.62, duration * 0.25);

        this.roulette = {
          active: true,
          turnNumber: state.turnNumber,
          startDeg,
          targetDeg: startDeg + spins * 360 + deltaMod,
          currentDeg: startDeg,
          elapsed: Math.max(0, duration - (state.wheelSpinLeft ?? duration)),
          duration,
          holdTail,
          lastTickSlice: Math.floor(startDeg / 60),
          landedPlayed: false,
          weaponId: activeWeapon.id,
          bannerText: isMyTurn
            ? `🎡 ${state.activePandaName.toUpperCase()}'S WEAPON ROULETTE!`
            : `🎡 ${teamInfo.name.toUpperCase()} SPINNING...`,
        };
        this.lastCountdownSec = 15;
      }
      // Appear large & centered for the user whose turn it is!
      this.ui.setRouletteCenter(isMyTurn, this.roulette.bannerText);
    } else {
      if (this.roulette.active) {
        this.roulette.active = false;
      }
      const lockedDeg = (((-winIdx * 60) % 360) + 360) % 360;
      this.roulette.currentDeg = lockedDeg;
      this.ui.setWheelRotation(lockedDeg);
      this.ui.setRouletteCenter(false);
      this.ui.setSelectedWeapon(activeWeapon.id);
      const shortHub = activeWeapon.id === 'towel-gun' ? 'TOWEL' : activeWeapon.name.split(' ')[0].toUpperCase();
      this.ui.hubTopEl.textContent = 'LOCKED';
      this.ui.hubBotEl.textContent = shortHub;
    }

    // Score, Turn, 15s Urgent Timer & Wind HUD
    this.ui.redScoreEl.textContent = `🍜 ${state.ramenLeft[0]}`;
    this.ui.blueScoreEl.textContent = `${state.ramenLeft[1]} 🍜`;

    if (state.phase === 'round_over') {
      this.ui.turnLabelEl.textContent = `${state.winnerName} Wins! 🍜`;
    } else if (state.phase === 'wheel_spin') {
      const who = isMyTurn ? 'YOUR TURN' : (state.activeControllerIsBot ? `${teamInfo.name} AI` : state.activeControllerName);
      this.ui.turnLabelEl.textContent = `${who} — SPINNING WHEEL!`;
    } else {
      const who = isMyTurn ? 'YOUR TURN' : (state.activeControllerIsBot ? `${teamInfo.name} AI` : state.activeControllerName);
      this.ui.turnLabelEl.textContent = `${who} — ${state.activePandaName}`;
    }

    if (state.phase === 'wheel_spin') {
      this.ui.timerEl.textContent = 'SPIN';
      this.ui.timerEl.classList.remove('urgent');
    } else {
      const sec = Math.max(0, Math.ceil(state.turnTimeLeft));
      this.ui.timerEl.textContent = `${sec}s`;
      const urgent = state.phase === 'aim' && sec <= 5 && sec > 0;
      this.ui.timerEl.classList.toggle('urgent', urgent);
      if (isMyTurn && urgent && sec !== this.lastCountdownSec) {
        this.lastCountdownSec = sec;
        sfx.countdownTick(sec <= 3);
      }
    }

    const windMag = Math.hypot(state.windX, state.windZ);
    const windArrows = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
    const windIdx = ((Math.round((Math.atan2(state.windZ, state.windX) / (Math.PI * 2)) * 8) % 8) + 8) % 8;
    const windLabel = windMag < 0.45 ? 'Calm' : windMag < 1.1 ? 'Breeze' : 'Gusty';
    this.ui.windEl.textContent = `🍃 ${windLabel} ${windArrows[windIdx]}`;

    // Sync Slingshot Pad, Elevation Angle Slider & NEXT Panda Button
    const canSwap = (state.ramenLeft?.[state.activeTeam] || 0) > 1;
    this.ui.setCanShoot(isMyTurn && state.phase === 'aim', canSwap);
    if (typeof state.aimDeg === 'number') {
      this.ui.syncAngle(state.aimDeg);
    }

    this.controlLabels = isMyTurn && state.phase === 'aim'
      ? {
          jump: canSwap ? 'NEXT' : 'SOLO',
          shoot: 'PULL',
          jumpIcon: '🐼',
          shootIcon: '🎯',
          badge: activeWeapon.displayName.toUpperCase(),
          armed: true,
        }
      : {
          jump: 'WAIT',
          shoot: state.phase === 'wheel_spin' ? 'SPIN' : 'TURN',
          jumpIcon: '🐼',
          shootIcon: '🎡',
          badge: state.phase === 'wheel_spin' ? 'ROULETTE SPIN' : `${teamInfo.name.toUpperCase()}`,
          armed: false,
        };

    // Process one-shot game events for juicy Fall-Guys visuals & sounds
    for (const ev of state.events || []) {
      switch (ev.type) {
        case 'wheel_spin_start':
          this.lastCountdownSec = 15;
          break;
        case 'wheel_spin_end':
          if (!this.roulette.landedPlayed) {
            this.roulette.landedPlayed = true;
            sfx.rouletteLand();
          }
          break;
        case 'panda_switch':
          sfx.hop();
          this._spawnCartoonBurst(ev.x, ev.y + 0.35, ev.z, [0xf7e231, 0xf3ede0], 7, 1.8, 0.08);
          this._spawnPopup(ev.pandaName, TEAMS[ev.team].color, ev.x, ev.y + 1.15, ev.z);
          break;
        case 'fire':
          sfx.fire(ev.weapon);
          this._spawnCartoonBurst(ev.x, ev.y, ev.z, [0xfff8dc, 0xf7e231, 0xe2e8f0], 10, 2.4, 0.12);
          break;
        case 'grenade_bounce':
          sfx.boing();
          this._spawnCartoonBurst(ev.x, ev.y, ev.z, [0x4ade80, 0xffe45e, 0xf472b6, 0xffffff], 14, 3.0, 0.11);
          this._spawnPopup('BOING! ✨', '#4ade80', ev.x, ev.y + 0.9, ev.z);
          break;
        case 'lantern_airstrike':
          sfx.lanternGong();
          this._spawnCartoonBurst(ev.x, ev.y - 0.5, ev.z, [0xe63946, 0xf5c542, 0xfef08a], 16, 3.2, 0.14);
          this._spawnPopup('🏮 DUMPLING AIRSTRIKE!', '#e63946', ev.x, ev.y - 1.5, ev.z);
          break;
        case 'udon_yank':
          sfx.udonYank();
          this._spawnUdonYankRope(ev.fromX, ev.fromY, ev.fromZ, ev.x, ev.y, ev.z);
          this._spawnCartoonBurst(ev.x, ev.y + 0.25, ev.z, [0xf8e7b5, 0xfde68a, 0xffffff], 16, 3.4, 0.12);
          this._spawnPopup('YOINK! 🍜', '#f59e0b', ev.x, ev.y + 1.05, ev.z);
          break;
        case 'backfire':
          sfx.backfire();
          this._spawnCartoonBurst(ev.x, ev.y + 0.2, ev.z, [0xef4444, 0xfacc15, 0x1e293b, 0xffffff], 28, 4.4, 0.17);
          this._spawnPopup('💥 BACKFIRE! 💤', '#dc2626', ev.x, ev.y + 1.25, ev.z);
          break;
        case 'explosion': {
          sfx.explosion(ev.weapon);
          if (ev.weapon === 'glitter-grenade') {
            // Dazzling rainbow glitter explosion!
            this._spawnCartoonBurst(
              ev.x,
              ev.y + 0.25,
              ev.z,
              [0xff4d94, 0xffe45e, 0x38bdf8, 0xa855f7, 0x4ade80, 0xffffff],
              36,
              4.6,
              0.13,
            );
            this._spawnPopup('✨ GLITTER BOOM!', '#ec4899', ev.x, ev.y + 1.0, ev.z);
          } else if (ev.weapon === 'towel-gun') {
            this._spawnCartoonBurst(ev.x, ev.y + 0.25, ev.z, [0xffffff, 0xe0f2fe, 0xbae6fd], 20, 3.4, 0.18);
            this._spawnPopup('♨️ HOT TOWEL!', '#38bdf8', ev.x, ev.y + 0.95, ev.z);
          } else if (ev.weapon === 'lotus-sling') {
            this._spawnCartoonBurst(ev.x, ev.y + 0.2, ev.z, [0xf472b6, 0xfbcfe8, 0xfde047, 0xffffff], 18, 3.6, 0.14);
          } else if (ev.weapon === 'balloon-bazooka') {
            this._spawnCartoonBurst(ev.x, ev.y + 0.25, ev.z, [0xff5a8a, 0xffe45e, 0x38bdf8, 0x4ade80], 24, 4.2, 0.15);
            this._spawnPopup('POP! 🎈', '#ff5a8a', ev.x, ev.y + 0.95, ev.z);
          } else if (ev.weapon === 'dumpling-airstrike') {
            this._spawnCartoonBurst(ev.x, ev.y + 0.2, ev.z, [0xfef3c7, 0xfde68a, 0xffffff, 0xf97316], 16, 3.4, 0.14);
          } else {
            this._spawnCartoonBurst(ev.x, ev.y + 0.2, ev.z, [0xf8e7b5, 0xfde68a, 0xffffff], 14, 3.0, 0.13);
          }
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
    const activeWepId = this.lastState?.selectedWeapon || 'balloon-bazooka';
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
      // Comical sputtering rattle in the last 3.5 seconds before weapon backfire!
      const urgentShake = this.lastState?.phase === 'aim' && this.lastState.turnTimeLeft <= 3.5
        ? Math.sin(time * 42) * 0.11 * (1 - Math.max(0, this.lastState.turnTimeLeft) / 3.5)
        : 0;

      vis.torso.position.y = 0.45;
      vis.torso.rotation.set(-0.08 - recoil, 0, Math.sin(time * 1.8) * 0.03 + urgentShake * 0.5);
      // Slight goofy head tilt so the panda looks chill & clumsy, never angry!
      vis.headGroup.rotation.set(0.06, -0.08, 0.14 + Math.sin(time * 2.2) * 0.05);

      // Pitch weapon smoothly with continuous launch angle!
      vis.weaponMount.rotation.set(-pitchRad * 0.78 - recoil * 0.55 + urgentShake, 0, urgentShake * 1.2);
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

  _updateAimTrajectory() {
    const s = this.lastState;
    if (!s || s.phase !== 'aim') {
      for (const d of this.aimDots) d.visible = false;
      return;
    }
    const pd = s.pandas.find((p) => p.id === s.activePandaId);
    if (!pd || !pd.hasRamen) {
      for (const d of this.aimDots) d.visible = false;
      return;
    }

    // Angry-Birds style short initial direction & force stub (7 fading dots out of the barrel)
    const weapon = WEAPON_BY_ID[s.selectedWeapon] || WEAPONS[0];
    const pitchRad = typeof s.aimPitch === 'number'
      ? s.aimPitch
      : (ARC_ANGLES[s.arcIndex] || ARC_ANGLES[1]).rad;
    const power = typeof s.aimPower === 'number' ? s.aimPower : 0.62;
    const speed = weapon.speed * (0.42 + 0.72 * power);
    const sinY = Math.sin(pd.yaw);
    const cosY = Math.cos(pd.yaw);
    const cosP = Math.cos(pitchRad);
    const sinP = Math.sin(pitchRad);

    let x = pd.x + sinY * 0.65;
    let y = pd.y + 0.82;
    let z = pd.z + cosY * 0.65;
    let vx = sinY * cosP * speed;
    let vy = sinP * speed;
    let vz = cosY * cosP * speed;
    const grav = GRAVITY * weapon.gravityScale;

    let blocked = false;
    const stepDt = 0.064;
    for (let i = 0; i < this.aimDots.length; i++) {
      const dot = this.aimDots[i];
      if (blocked) {
        dot.visible = false;
        continue;
      }
      vy -= grav * stepDt;
      x += vx * stepDt;
      y += vy * stepDt;
      z += vz * stepDt;

      const g = getSurfaceHeight(x, z, y + 0.3);
      if (y <= g + 0.08 || Math.abs(x) > HALF_W || Math.abs(z) > HALF_D) {
        blocked = true;
        dot.visible = false;
      } else {
        dot.visible = true;
        dot.position.set(x, y, z);
        const sc = Math.max(0.42, 1.05 - i * 0.09);
        dot.scale.setScalar(sc);
        dot.material.color.setHex(s.isCharging ? (i % 2 === 0 ? 0xfef08a : 0xf97316) : (i % 2 === 0 ? 0xfff8dc : 0xf7d13d));
      }
    }
  }

  _updateRoulette(dt) {
    if (!this.roulette.active) return;
    const r = this.roulette;
    r.elapsed += dt;
    const spinDur = Math.max(0.45, r.duration - r.holdTail);
    const u = Math.min(1, r.elapsed / spinDur);
    // Smooth casino roulette cubic ease-out!
    const ease = 1 - Math.pow(1 - u, 3);
    const deg = r.startDeg + (r.targetDeg - r.startDeg) * ease;
    r.currentDeg = deg;
    this.ui.setWheelRotation(deg);

    const sliceCross = Math.floor((deg + 30) / 60);
    if (sliceCross !== r.lastTickSlice && u < 1) {
      r.lastTickSlice = sliceCross;
      sfx.rouletteTick();
    }

    if (u < 1) {
      const curIdx = (((Math.round(-deg / 60)) % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
      const curW = WEAPONS[curIdx] || WEAPONS[0];
      this.ui.setSelectedWeapon(curW.id);
      this.ui.hubTopEl.textContent = 'SPIN';
      this.ui.hubBotEl.textContent = '🎡';
    } else {
      const winW = WEAPON_BY_ID[r.weaponId] || WEAPONS[0];
      this.ui.setSelectedWeapon(winW.id);
      this.ui.hubTopEl.textContent = 'USE!';
      this.ui.hubBotEl.textContent = winW.id === 'towel-gun' ? 'TOWEL' : winW.name.split(' ')[0].toUpperCase();
      if (!r.landedPlayed) {
        r.landedPlayed = true;
        sfx.rouletteLand();
      }
      if (this.ui.rouletteBanner && !this.ui.rouletteBanner.classList.contains('hidden')) {
        this.ui.rouletteBanner.textContent = `🎉 ${winW.displayName.toUpperCase()}!`;
      }
    }
  }

  update(dt) {
    const time = performance.now() / 1000;
    const smooth = Math.min(1, dt * 16);

    // Animate per-turn Roulette Weapon Wheel spin!
    this._updateRoulette(dt);

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

    // Smoothly move overhead Chinese Paper Lanterns with gentle festive sway
    const ls = Math.min(1, dt * 14);
    for (const lVis of this.lanternVisuals.values()) {
      lVis.mesh.position.lerp(lVis.target, ls);
      lVis.mesh.rotation.y = lVis.state.yaw;
      lVis.mesh.rotation.z = Math.sin(time * 4.2) * 0.12;
      lVis.mesh.rotation.x = Math.cos(time * 3.1) * 0.08;
    }

    // Smoothly move, orient & tether projectiles (including live 3D Udon noodle rope!)
    const ps = Math.min(1, dt * 24);
    for (const [id, pVis] of this.projVisuals.entries()) {
      pVis.mesh.position.lerp(pVis.target, ps);
      const st = pVis.state;
      if (st.weaponId === 'balloon-bazooka' || st.weaponId === 'udon-hook' || st.weaponId === 'towel-gun') {
        const dir = new THREE.Vector3(st.vx, st.vy, st.vz);
        if (dir.lengthSq() > 0.01) {
          pVis.mesh.lookAt(pVis.mesh.position.clone().add(dir));
        }
        if (st.weaponId === 'towel-gun') {
          pVis.mesh.rotation.z += st.spin * 0.12;
        }
      } else if (st.weaponId === 'lotus-sling') {
        pVis.mesh.rotation.y = st.spin * 1.4;
        pVis.mesh.rotation.x = Math.sin(time * 8) * 0.25;
      } else {
        pVis.mesh.rotation.x = st.spin;
        pVis.mesh.rotation.z = st.spin * 0.6;
      }

      // Live wavy Udon noodle rope stretching from panda to flying grappling hook!
      if (st.weaponId === 'udon-hook') {
        const start = new THREE.Vector3(st.originX, st.originY, st.originZ);
        const end = pVis.mesh.position.clone();
        if (start.distanceTo(end) > 0.15) {
          const mid = start.clone().lerp(end, 0.5);
          mid.y += Math.sin(time * 16) * 0.18 - 0.14;
          const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
          const geo = new THREE.TubeGeometry(curve, 12, 0.042, 6, false);
          let ropeMesh = this.ropeVisuals.get(id);
          if (!ropeMesh) {
            ropeMesh = new THREE.Mesh(geo, this.mats.udonCream);
            this.group.add(ropeMesh);
            this.ropeVisuals.set(id, ropeMesh);
          } else {
            ropeMesh.geometry.dispose();
            ropeMesh.geometry = geo;
          }
        }
      }
    }

    // Fade out dramatic Udon yank snap lines
    for (let i = this.yankRopes.length - 1; i >= 0; i--) {
      const yr = this.yankRopes[i];
      yr.life -= dt;
      if (yr.life <= 0) {
        this.group.remove(yr.mesh);
        yr.mesh.geometry.dispose();
        this.yankRopes.splice(i, 1);
      } else {
        yr.mesh.scale.setScalar(0.6 + 0.4 * (yr.life / yr.maxLife));
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

    // Update short Angry-Birds 3D aim stub
    this._updateAimTrajectory();

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
    for (const rope of this.ropeVisuals.values()) {
      this.group.remove(rope);
      rope.geometry.dispose();
    }
    this.ropeVisuals.clear();
    for (const yr of this.yankRopes) {
      this.group.remove(yr.mesh);
      yr.mesh.geometry.dispose();
    }
    this.yankRopes = [];
    if (this.ui) this.ui.dispose();
    this.boardRoot.remove(this.group);
  }
}
