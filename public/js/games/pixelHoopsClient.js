import * as THREE from '../../vendor/three/three.module.js';
import { sound } from '../audio.js';

/**
 * Pixel Hoops renderer: an original chunky voxel / pixel-art look.
 * Everything is built from boxes with flat colors, and all painted
 * surfaces (court, backboard, jerseys, scoreboard) come from tiny canvases
 * scaled up with nearest-neighbour filtering so the pixels stay crisp.
 */

const SKIN_TONES = [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0x5c3a1e, 0xffdbac];
const HAIR_COLORS = [0x1a1a1a, 0x3b2314, 0x6b3e1f, 0xd9a441, 0x2b1b10, 0x101010];

// 3x5 pixel digits for scoreboards and jersey numbers.
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
  const str = String(num);
  str.split('').forEach((ch, ci) => {
    const rows = DIGITS[ch];
    if (!rows) return;
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < 3; rx++) {
        if (row[rx] === '1') ctx.fillRect(x + (ci * 4 + rx) * px, y + ry * px, px, px);
      }
    });
  });
}

function pixelTexture(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function flat(color) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function makeNameTexture(name, color, score, isSelf) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = 'rgba(8, 8, 20, 0.82)';
  ctx.fillRect(8, 6, 240, 46);
  ctx.fillStyle = color;
  ctx.fillRect(8, 6, 240, 4);
  ctx.font = 'bold 24px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${isSelf ? '▶' : ''}${name.toUpperCase()} ${score}`, 128, 31);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createBaller(player, isSelf) {
  const seed = hashString(player.id);
  const skin = flat(SKIN_TONES[seed % SKIN_TONES.length]);
  const hair = flat(HAIR_COLORS[(seed >> 3) % HAIR_COLORS.length]);
  const jerseyColor = new THREE.Color(player.color);
  const number = (seed % 98) + 1;
  const jerseyTex = pixelTexture(16, 16, (ctx) => {
    ctx.fillStyle = `#${jerseyColor.getHexString()}`;
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 16, 1);
    const n = String(number);
    drawPixelNumber(ctx, n, n.length === 1 ? 6 : 1, 5, 2 * (n.length === 1 ? 1 : 1), '#ffffff');
  });
  const jersey = new THREE.MeshLambertMaterial({ map: jerseyTex });
  const jerseySide = flat(jerseyColor);
  const shorts = flat(jerseyColor.clone().multiplyScalar(0.7));
  const shoe = flat(0xf5f5f5);
  const sock = flat(0xffffff);
  const band = flat(0xffffff);

  const root = new THREE.Group();
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.5),
    new THREE.MeshBasicMaterial({ color: isSelf ? jerseyColor : 0x000000, transparent: true, opacity: isSelf ? 0.55 : 0.3, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  root.add(shadow);

  const body = new THREE.Group();
  root.add(body);

  // Legs (pivot at hip)
  const makeLeg = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.09, 0.5, 0);
    pivot.add(box(0.13, 0.12, 0.14, shorts, 0, -0.04, 0));
    pivot.add(box(0.1, 0.24, 0.1, skin, 0, -0.2, 0));
    pivot.add(box(0.1, 0.08, 0.1, sock, 0, -0.36, 0));
    pivot.add(box(0.12, 0.08, 0.2, shoe, 0, -0.46, 0.03));
    body.add(pivot);
    return pivot;
  };
  const leftLeg = makeLeg(1);
  const rightLeg = makeLeg(-1);

  // Torso: jersey front gets the pixel number texture.
  const torsoMats = [jerseySide, jerseySide, jerseySide, shorts, jersey, jersey];
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.2), torsoMats);
  torso.position.y = 0.72;
  torso.castShadow = true;
  body.add(torso);

  // Head
  const head = new THREE.Group();
  head.position.y = 1.02;
  head.add(box(0.24, 0.24, 0.22, skin));
  head.add(box(0.25, 0.07, 0.23, hair, 0, 0.1, -0.01));
  head.add(box(0.25, 0.04, 0.23, band, 0, 0.045, 0));
  const eyeMat = flat(0x111111);
  head.add(box(0.04, 0.04, 0.02, eyeMat, 0.055, 0.0, 0.11));
  head.add(box(0.04, 0.04, 0.02, eyeMat, -0.055, 0.0, 0.11));
  body.add(head);

  // Arms (pivot at shoulder)
  const makeArm = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.22, 0.87, 0);
    pivot.add(box(0.1, 0.1, 0.12, jerseySide, 0, -0.03, 0));
    pivot.add(box(0.08, 0.3, 0.08, skin, 0, -0.2, 0));
    pivot.add(box(0.09, 0.06, 0.09, band, 0, -0.3, 0));
    body.add(pivot);
    return pivot;
  };
  const leftArm = makeArm(1);
  const rightArm = makeArm(-1);

  const labelSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: makeNameTexture(player.name, player.color, player.score, isSelf), transparent: true, depthTest: false })
  );
  labelSprite.position.set(0, 1.55, 0);
  labelSprite.scale.set(1.2, 0.3, 1);
  body.add(labelSprite);

  return {
    root,
    body,
    shadow,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    head,
    labelSprite,
    labelKey: '',
    targetX: player.x,
    targetY: player.y,
    targetZ: player.z,
    targetYaw: player.yaw,
  };
}

function createBall() {
  const tex = pixelTexture(16, 8, (ctx) => {
    ctx.fillStyle = '#e8772e';
    ctx.fillRect(0, 0, 16, 8);
    ctx.fillStyle = '#c45a1a';
    for (let i = 0; i < 16; i += 2) ctx.fillRect(i, (i * 3) % 8, 1, 1);
    ctx.fillStyle = '#1a0d05';
    ctx.fillRect(0, 4, 16, 1);
    ctx.fillRect(4, 0, 1, 8);
    ctx.fillRect(12, 0, 1, 8);
  });
  const ball = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.12, 1),
    new THREE.MeshLambertMaterial({ map: tex, flatShading: true })
  );
  ball.castShadow = true;
  return ball;
}

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
    this.ballShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.position.y = 0.014;
    this.group.add(this.ballShadow);
    this.ballTarget = new THREE.Vector3(0, 0.5, 0);
  }

  _buildCourt(cfg) {
    const w = cfg.courtWidth;
    const d = cfg.courtDepth;
    const hoop = cfg.hoop;
    const PX = 16; // texture pixels per board unit

    // Hardwood + painted lines on one low-res canvas.
    const courtTex = pixelTexture(w * PX, d * PX, (ctx, cw, ch) => {
      const toPx = (x, z) => [(x + w / 2) * PX, (z + d / 2) * PX];
      // Planks
      for (let y = 0; y < ch; y += 4) {
        for (let x = 0; x < cw + 24; x += 24) {
          const off = ((y / 4) % 3) * 8;
          const shade = ((x + off + y * 7) % 5);
          ctx.fillStyle = ['#c98b4a', '#c48444', '#cf9353', '#bd7d3e', '#c88a49'][shade];
          ctx.fillRect(x - off, y, 24, 4);
          ctx.fillStyle = '#a86b33';
          ctx.fillRect(x - off, y + 3, 24, 1);
          ctx.fillRect(x - off, y, 1, 4);
        }
      }
      const [hx, hz] = toPx(hoop.x, hoop.z);
      // Painted lane
      ctx.fillStyle = '#3d4ec9';
      const laneW = 1.9 * PX;
      const laneD = 2.9 * PX;
      ctx.fillRect(hx - laneW / 2, 0, laneW, hz + laneD);
      // Lines (pixel-stepped circles)
      ctx.fillStyle = '#ffffff';
      const ring = (cx, cy, r, from, to, thick = 1) => {
        for (let a = from; a <= to; a += 0.6 / r) {
          ctx.fillRect(Math.round(cx + Math.sin(a) * r), Math.round(cy + Math.cos(a) * r), thick, thick);
        }
      };
      ctx.fillRect(hx - laneW / 2, 0, 1, hz + laneD);
      ctx.fillRect(hx + laneW / 2 - 1, 0, 1, hz + laneD);
      ctx.fillRect(hx - laneW / 2, hz + laneD - 1, laneW, 1);
      ring(hx, hz + laneD, 0.9 * PX, -Math.PI / 2, Math.PI / 2, 1);
      // Three-point arc with straight corners
      const r3 = cfg.threePtRadius * PX;
      const cornerX = Math.min(r3, cw / 2 - 6);
      ring(hx, hz, r3, -Math.asin(cornerX / r3), Math.asin(cornerX / r3), 2);
      const cornerZ = Math.cos(Math.asin(cornerX / r3)) * r3;
      ctx.fillRect(hx - cornerX, 0, 2, hz + cornerZ);
      ctx.fillRect(hx + cornerX - 1, 0, 2, hz + cornerZ);
      // Boundary
      ctx.fillRect(0, 0, cw, 2);
      ctx.fillRect(0, ch - 2, cw, 2);
      ctx.fillRect(0, 0, 2, ch);
      ctx.fillRect(cw - 2, 0, 2, ch);
      // Center circle stub at the far edge (half court)
      ring(cw / 2, ch, 1.2 * PX, Math.PI / 2, Math.PI * 1.5, 2);
      // Check-ball "X"
      const [cx, cz] = toPx(cfg.checkSpot.x, cfg.checkSpot.z);
      ctx.fillStyle = '#ffd23f';
      for (let i = -3; i <= 3; i++) {
        ctx.fillRect(cx + i, cz + i, 1, 1);
        ctx.fillRect(cx + i, cz - i, 1, 1);
      }
    });

    const slab = 0.16;
    const sideMat = flat(0x7a4a22);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, slab, d), [
      sideMat, sideMat, new THREE.MeshLambertMaterial({ map: courtTex }), sideMat, sideMat, sideMat,
    ]);
    floor.position.y = -slab / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Chunky out-of-bounds border
    const borderMat = flat(0x1e2a78);
    const bt = 0.18;
    this.group.add(box(w + bt * 2, 0.08, bt, borderMat, 0, 0.0, -d / 2 - bt / 2));
    this.group.add(box(w + bt * 2, 0.08, bt, borderMat, 0, 0.0, d / 2 + bt / 2));
    this.group.add(box(bt, 0.08, d, borderMat, -w / 2 - bt / 2, 0.0, 0));
    this.group.add(box(bt, 0.08, d, borderMat, w / 2 + bt / 2, 0.0, 0));

    // ---- Hoop: stanchion, backboard, rim, voxel net
    const hoopGroup = new THREE.Group();
    this.group.add(hoopGroup);
    const poleMat = flat(0x2b2f3a);
    const padMat = flat(0x1e2a78);
    const bbZ = cfg.backboardZ;
    hoopGroup.add(box(0.5, 0.18, 0.5, padMat, hoop.x, 0.09, bbZ - 0.55));
    hoopGroup.add(box(0.14, hoop.rimY + 0.45, 0.14, poleMat, hoop.x, (hoop.rimY + 0.45) / 2, bbZ - 0.55));
    hoopGroup.add(box(0.12, 0.12, 0.55, poleMat, hoop.x, hoop.rimY + 0.38, bbZ - 0.3));

    const boardTex = pixelTexture(32, 20, (ctx) => {
      ctx.fillStyle = '#f4f4f4';
      ctx.fillRect(0, 0, 32, 20);
      ctx.fillStyle = '#d8442f';
      ctx.fillRect(0, 0, 32, 1);
      ctx.fillRect(0, 19, 32, 1);
      ctx.fillRect(0, 0, 1, 20);
      ctx.fillRect(31, 0, 1, 20);
      ctx.fillRect(11, 9, 10, 1);
      ctx.fillRect(11, 17, 10, 1);
      ctx.fillRect(11, 9, 1, 9);
      ctx.fillRect(20, 9, 1, 9);
    });
    const boardMat = new THREE.MeshLambertMaterial({ map: boardTex });
    const backboard = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.06), [poleMat, poleMat, poleMat, poleMat, boardMat, poleMat]);
    backboard.position.set(hoop.x, hoop.rimY + 0.32, bbZ);
    backboard.castShadow = true;
    hoopGroup.add(backboard);

    // Rim: a ring of little orange cubes (pixel-stepped circle)
    this.rim = new THREE.Group();
    this.rim.position.set(hoop.x, hoop.rimY, hoop.z);
    const rimMat = flat(0xff5a1f);
    const segs = 16;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const c = box(0.07, 0.05, 0.07, rimMat, Math.sin(a) * hoop.rimRadius, 0, Math.cos(a) * hoop.rimRadius);
      c.rotation.y = a;
      this.rim.add(c);
    }
    this.rim.add(box(0.06, 0.05, hoop.z - bbZ - hoop.rimRadius, rimMat, 0, 0, -(hoop.z - bbZ + hoop.rimRadius) / 2));
    hoopGroup.add(this.rim);

    // Net: stacked rings of white voxels that narrow toward the bottom
    this.net = new THREE.Group();
    this.net.position.set(hoop.x, hoop.rimY - 0.04, hoop.z);
    const netMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
    for (let row = 0; row < 4; row++) {
      const r = hoop.rimRadius * (0.95 - row * 0.12);
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = ((i + (row % 2) * 0.5) / n) * Math.PI * 2;
        this.net.add(box(0.035, 0.09, 0.035, netMat, Math.sin(a) * r, -row * 0.1, Math.cos(a) * r));
      }
    }
    hoopGroup.add(this.net);

    // Floating pixel scoreboard above the backboard
    this.scoreCanvas = document.createElement('canvas');
    this.scoreCanvas.width = 64;
    this.scoreCanvas.height = 24;
    this.scoreTex = new THREE.CanvasTexture(this.scoreCanvas);
    this.scoreTex.magFilter = THREE.NearestFilter;
    this.scoreTex.minFilter = THREE.NearestFilter;
    this.scoreTex.generateMipmaps = false;
    this.scoreTex.colorSpace = THREE.SRGBColorSpace;
    const sbMat = new THREE.MeshBasicMaterial({ map: this.scoreTex });
    const sbFrame = flat(0x111111);
    const scoreboard = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 0.08), [sbFrame, sbFrame, sbFrame, sbFrame, sbMat, sbFrame]);
    scoreboard.position.set(hoop.x, hoop.rimY + 1.15, bbZ - 0.02);
    hoopGroup.add(scoreboard);
    this.scoreKey = '';

    // Sideline bench for players waiting their turn
    const benchMat = flat(0x5b3a1e);
    this.group.add(box(3.6, 0.08, 0.3, benchMat, -w / 2 + 1.9, 0.26, d / 2 - 0.15));
    this.group.add(box(0.08, 0.26, 0.26, benchMat, -w / 2 + 0.2, 0.13, d / 2 - 0.15));
    this.group.add(box(0.08, 0.26, 0.26, benchMat, -w / 2 + 3.6, 0.13, d / 2 - 0.15));
  }

  _drawScoreboard(players) {
    const court = players.filter((p) => p.role === 'court');
    const key = court.map((p) => `${p.id}:${p.score}`).join('|');
    if (key === this.scoreKey) return;
    this.scoreKey = key;
    const ctx = this.scoreCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0b0b14';
    ctx.fillRect(0, 0, 64, 24);
    const slots = [court[0], court[1]];
    slots.forEach((p, i) => {
      if (!p) return;
      const x0 = i === 0 ? 3 : 35;
      ctx.fillStyle = p.color;
      ctx.fillRect(x0, 2, 26, 3);
      const s = String(p.score);
      const textW = s.length * 8 - 2;
      drawPixelNumber(ctx, s, x0 + 13 - textW / 2, 8, 2, '#ffd23f');
    });
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(31, 10, 2, 2);
    ctx.fillRect(31, 15, 2, 2);
    this.scoreTex.needsUpdate = true;
  }

  _burst(x, y, z, color, count = 10, speed = 2.6, size = 0.06) {
    const geo = new THREE.BoxGeometry(size, size, size);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }));
      mesh.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2;
      const spd = (0.4 + Math.random() * 0.8) * speed;
      this.group.add(mesh);
      this.particles.push({ mesh, vx: Math.cos(a) * spd, vy: (0.5 + Math.random()) * speed * 0.7, vz: Math.sin(a) * spd, life: 0.5 + Math.random() * 0.3, maxLife: 0.8 });
    }
  }

  _popup(text, color, x, y, z) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 40px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000000';
    ctx.fillText(text, 131, 35);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.position.set(x, y, z);
    sprite.scale.set(1.8, 0.45, 1);
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
          this._popup(ev.dunk ? 'SLAM!' : ev.points === 3 ? '3 PTS!' : '2 PTS', ev.color, hoop.x, hoop.rimY + 0.7, hoop.z + 0.4);
          if (ev.dunk) sound.playElim();
          else sound.playPickup();
          break;
        }
        case 'rim_shake':
          this.rimShake = 1;
          break;
        case 'clank':
          this.rimShake = 0.6;
          this._burst(ev.x, ev.y, ev.z, 0xff5a1f, 6, 1.6, 0.04);
          sound.playHit();
          break;
        case 'block':
          this._burst(ev.x, ev.y, ev.z, 0xffffff, 12, 3.0);
          this._popup('BLOCKED!', '#ff3b30', ev.x, ev.y + 0.6, ev.z);
          sound.playHit();
          break;
        case 'steal':
          this._burst(ev.x, 0.5, ev.z, 0xffd23f, 10, 2.4);
          this._popup('STEAL!', '#ffd23f', ev.x, 1.6, ev.z);
          sound.playPickup();
          break;
        case 'swipe':
          if (ev.playerId === this.selfPlayerId) sound.playShoot();
          break;
        case 'juke':
          this._burst(ev.x, 0.05, ev.z, 0xe2e8f0, 6, 1.4, 0.05);
          if (ev.playerId === this.selfPlayerId) sound.playJump();
          break;
        case 'jump':
        case 'shot_rise':
        case 'dunk_start':
          if (ev.playerId === this.selfPlayerId) sound.playJump();
          break;
        case 'shot':
          if (ev.playerId === this.selfPlayerId && ev.timing > 0.85) {
            this._popup('PERFECT', '#4ade80', ev.x, ev.y + 0.5, ev.z);
          }
          break;
        case 'bounce':
          sound.playLand();
          break;
        case 'check':
          this._popup('CHECK BALL', '#ffffff', this.config.checkSpot.x, 1.8, this.config.checkSpot.z);
          break;
        case 'round_over':
          sound.playWin();
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
    const stride = running ? Math.sin(p.animPhase) * 0.7 : 0;
    vis.leftLeg.rotation.x = air ? -0.5 : stride;
    vis.rightLeg.rotation.x = air ? 0.3 : -stride;

    let la = 0;
    let ra = 0;
    let laz = 0;
    let raz = 0;
    switch (p.action) {
      case 'shoot':
        la = -2.9; ra = -2.9; break;
      case 'dunk':
        la = -3.0; ra = -3.1; break;
      case 'block':
        la = -3.1; ra = -3.1; laz = 0.2; raz = -0.2; break;
      case 'steal':
        ra = -1.4; la = -0.3; break;
      case 'celebrate':
        la = -2.8 + Math.sin(time * 18) * 0.3; ra = -2.8 - Math.sin(time * 18) * 0.3; laz = 0.4; raz = -0.4; break;
      case 'stumble':
        la = 0.6; ra = -0.6; break;
      default:
        if (p.hasBall) {
          // Dribbling hand pumps; off hand guards the ball.
          ra = -0.6 + Math.abs(Math.sin(p.animPhase * 1.6)) * 0.5;
          la = -0.7; laz = 0.3;
        } else if (p.role === 'court' && !p.onOffense) {
          // Defensive stance: arms wide.
          laz = 0.9; raz = -0.9; la = -0.4; ra = -0.4;
        } else {
          la = -stride * 0.8; ra = stride * 0.8;
        }
    }
    vis.leftArm.rotation.set(la, 0, laz);
    vis.rightArm.rotation.set(ra, 0, raz);
    // Crouch a little on defense and when dribbling.
    const crouch = p.role === 'court' && !air && (p.hasBall || !p.onOffense) ? 0.05 : 0;
    vis.body.scale.y = 1 - crouch;
    vis.body.rotation.z = p.action === 'stumble' ? Math.sin(time * 30) * 0.12 : 0;
  }

  update(dt) {
    const time = performance.now() / 1000;
    const smooth = Math.min(1, dt * 18);
    for (const vis of this.visuals.values()) {
      vis.root.position.x += (vis.targetX - vis.root.position.x) * smooth;
      vis.root.position.z += (vis.targetZ - vis.root.position.z) * smooth;
      vis.body.position.y += (vis.targetY - vis.body.position.y) * smooth;
      let diff = vis.targetYaw - vis.body.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      vis.body.rotation.y += diff * smooth;
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
