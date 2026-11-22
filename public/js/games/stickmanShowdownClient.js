import * as THREE from '../../vendor/three/three.module.js';
import { sound } from '../audio.js';

/**
 * Stickman Showdown renderer: tactile claymation / rubbery Stick-Fight-style
 * active-ragdoll stickmen with spring-driven squash-and-stretch, floppy
 * multi-jointed noodle limbs, punchy recoil & muzzle flashes, brass shell
 * casings, ragdoll KO tumbles, and chippable/destructible cover barriers.
 */

// ---- Simple damped harmonic spring for rubbery claymation physics
class Spring {
  constructor(value = 0, stiffness = 180, damping = 12) {
    this.value = value;
    this.velocity = 0;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  impulse(dv) {
    this.velocity += dv;
  }

  step(target, dt) {
    const force = (target - this.value) * this.stiffness;
    this.velocity += (force - this.velocity * this.damping) * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
}

// ---- Procedural subtle claymation bump texture (soft sculpted thumbprint grain)
let cachedClayBump = null;
function clayBumpTexture() {
  if (cachedClayBump) return cachedClayBump;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 64, 64);
  let seed = 42;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 160; i++) {
    const x = rnd() * 64;
    const y = rnd() * 64;
    const r = 1.5 + rnd() * 4.5;
    const v = Math.floor(110 + rnd() * 36);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  cachedClayBump = tex;
  return tex;
}

// ---- Cracked concrete / chipped barrier texture
let cachedCrackTex = null;
function crackedBarrierTexture() {
  if (cachedCrackTex) return cachedCrackTex;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#a0a7b2';
  ctx.fillRect(0, 0, 64, 64);
  // Subtle masonry speckle
  let seed = 99;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 120; i++) {
    const v = 135 + Math.floor(rnd() * 45);
    ctx.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    ctx.fillRect(rnd() * 64, rnd() * 64, 3, 3);
  }
  // Bold dark cracks
  ctx.strokeStyle = '#272c36';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(8, 6);
  ctx.lineTo(26, 24);
  ctx.lineTo(22, 42);
  ctx.lineTo(40, 58);
  ctx.moveTo(26, 24);
  ctx.lineTo(48, 18);
  ctx.lineTo(58, 30);
  ctx.moveTo(22, 42);
  ctx.lineTo(10, 52);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  cachedCrackTex = tex;
  return tex;
}

function makeLabelTexture(name, color, hp, maxHp, isSelf) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, 256, 96);

  // Name pill
  ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const label = isSelf ? `${name} (YOU)` : name;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
  ctx.beginPath();
  ctx.roundRect(18, 6, 220, 38, 12);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.fillText(label, 128, 25);

  // Health bar background
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.beginPath();
  ctx.roundRect(34, 52, 188, 22, 8);
  ctx.fill();

  // Health bar fill
  const ratio = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
  ctx.fillStyle = ratio > 0.35 ? color : '#ef4444';
  if (ratio > 0) {
    ctx.beginPath();
    ctx.roundRect(38, 56, Math.max(8, 180 * ratio), 14, 6);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createGunMesh(type = 'pistol') {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.55,
    metalness: 0.35,
  });
  const accentMat = new THREE.MeshBasicMaterial({
    color: type === 'rapid' ? 0xf59e0b : 0x38bdf8,
  });

  const barrel = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 0.11, type === 'rapid' ? 0.54 : 0.38),
    bodyMat
  );
  barrel.position.set(0, 0.06, 0.14);
  barrel.castShadow = true;
  group.add(barrel);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.17, 0.11), bodyMat);
  grip.position.set(0, -0.05, -0.02);
  grip.rotation.x = 0.25;
  group.add(grip);

  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.032, type === 'rapid' ? 0.36 : 0.22),
    accentMat
  );
  strip.position.set(0, 0.11, 0.14);
  group.add(strip);

  // Muzzle flash mesh (hidden until shot)
  const flash = new THREE.Mesh(
    new THREE.OctahedronGeometry(type === 'rapid' ? 0.16 : 0.14, 0),
    new THREE.MeshBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.95 })
  );
  flash.position.set(0, 0.06, type === 'rapid' ? 0.48 : 0.38);
  flash.visible = false;
  group.add(flash);
  group.userData.flash = flash;

  return group;
}

/** Hanging rubbery clay limb segment (pivot at top y=0). */
function claySegment(radius, length, mat) {
  const geo = new THREE.CapsuleGeometry(radius, Math.max(0.02, length - radius * 2), 5, 10);
  geo.translate(0, -length / 2, 0);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

function createClayStickmanRig(color, { withLabel = false, player = null, isSelf = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0.0,
    bumpMap: clayBumpTexture(),
    bumpScale: 0.016,
  });

  const body = new THREE.Group();

  // Rubbery hips pivot
  const hips = new THREE.Group();
  hips.position.y = 0.44;
  body.add(hips);

  // Little rounded clay pelvis
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), mat);
  pelvis.scale.set(1.05, 0.85, 0.95);
  pelvis.castShadow = true;
  hips.add(pelvis);

  // 2-segment rubbery legs: hip -> thigh -> knee -> shin -> rounded clay foot
  const makeLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.085, -0.02, 0);
    hips.add(hip);
    hip.add(claySegment(0.048, 0.22, mat));
    const knee = new THREE.Group();
    knee.position.y = -0.21;
    hip.add(knee);
    knee.add(claySegment(0.044, 0.22, mat));
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.052, 8, 6), mat);
    foot.scale.set(0.95, 0.65, 1.45);
    foot.position.set(0, -0.21, 0.03);
    foot.castShadow = true;
    knee.add(foot);
    return { hip, knee };
  };
  const leftLeg = makeLeg(1);
  const rightLeg = makeLeg(-1);

  // Flexible noodle spine: waist -> chest -> neck -> clay head
  const waist = new THREE.Group();
  waist.position.y = 0.04;
  hips.add(waist);

  const lowerTorso = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.14, 5, 10), mat);
  lowerTorso.position.y = 0.11;
  lowerTorso.castShadow = true;
  waist.add(lowerTorso);

  const chest = new THREE.Group();
  chest.position.y = 0.22;
  waist.add(chest);

  const upperTorso = new THREE.Mesh(new THREE.CapsuleGeometry(0.082, 0.14, 5, 10), mat);
  upperTorso.position.y = 0.08;
  upperTorso.castShadow = true;
  chest.add(upperTorso);

  // Expressive Stick-Fight clay head with googly dot eyes
  const head = new THREE.Group();
  head.position.y = 0.32;
  chest.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.185, 14, 12), mat);
  skull.scale.set(1.02, 0.96, 1.0);
  skull.castShadow = true;
  head.add(skull);

  const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.7 });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
  for (const side of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.044, 8, 8), eyeWhiteMat);
    eye.position.set(side * 0.068, 0.02, 0.155);
    eye.scale.set(0.95, 1.12, 0.6);
    head.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.023, 8, 8), pupilMat);
    pupil.position.set(side * 0.068, 0.02, 0.18);
    head.add(pupil);
  }

  // 2-segment floppy noodle arms: shoulder -> upper -> elbow -> forearm -> clay hand
  const makeArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.13, 0.14, 0);
    chest.add(shoulder);
    shoulder.add(claySegment(0.042, 0.19, mat));
    const elbow = new THREE.Group();
    elbow.position.y = -0.18;
    shoulder.add(elbow);
    elbow.add(claySegment(0.038, 0.19, mat));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.046, 8, 6), mat);
    hand.position.y = -0.19;
    hand.castShadow = true;
    elbow.add(hand);
    return { shoulder, elbow };
  };
  const leftArm = makeArm(1);
  const rightArm = makeArm(-1);

  // Held gun pivot attached to chest so recoil whips the whole upper body
  const gunPivot = new THREE.Group();
  gunPivot.position.set(-0.04, 0.05, 0.28);
  chest.add(gunPivot);

  const heldPistol = createGunMesh('pistol');
  heldPistol.visible = false;
  gunPivot.add(heldPistol);

  const heldRapid = createGunMesh('rapid');
  heldRapid.visible = false;
  gunPivot.add(heldRapid);

  let labelSprite = null;
  if (withLabel && player) {
    const labelTex = makeLabelTexture(player.name, player.color, player.hp, player.maxHp, isSelf);
    const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false });
    labelSprite = new THREE.Sprite(labelMat);
    labelSprite.position.set(0, 1.46, 0);
    labelSprite.scale.set(1.35, 0.5, 1);
    body.add(labelSprite);
  }

  return {
    body,
    hips,
    waist,
    chest,
    head,
    mat,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    gunPivot,
    heldPistol,
    heldRapid,
    labelSprite,
  };
}

function createStickmanVisual(player, isSelf) {
  const root = new THREE.Group();
  const color = new THREE.Color(player.color);

  // Ground shadow / ring
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.32, 20),
    new THREE.MeshBasicMaterial({
      color: isSelf ? color : 0x020617,
      transparent: true,
      opacity: isSelf ? 0.45 : 0.28,
      depthWrite: false,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  root.add(shadow);

  if (isSelf) {
    const selfRing = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.42, 24),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
    );
    selfRing.rotation.x = -Math.PI / 2;
    selfRing.position.y = 0.02;
    root.add(selfRing);
  }

  const rig = createClayStickmanRig(color, { withLabel: true, player, isSelf });
  root.add(rig.body);

  return {
    root,
    shadow,
    color,
    ...rig,
    lastLabelHp: player.hp,
    lastLabelName: player.name,
    targetX: player.x,
    targetY: player.y,
    targetZ: player.z,
    targetYaw: player.yaw,
    state: player,
    prevVx: 0,
    prevVz: 0,
    flashTimer: 0,
    // Rubbery claymation springs
    leanX: new Spring(0, 150, 9.5),
    leanZ: new Spring(0, 150, 9.5),
    headPitch: new Spring(0, 110, 7.5),
    headRoll: new Spring(0, 110, 7.5),
    squash: new Spring(0, 220, 11),
    gunKick: new Spring(0, 260, 12),
  };
}

export class StickmanShowdownClient {
  constructor(boardRoot, config, selfPlayerId) {
    this.boardRoot = boardRoot;
    this.config = config;
    this.selfPlayerId = selfPlayerId;

    this.group = new THREE.Group();
    this.boardRoot.add(this.group);

    this.playerVisuals = new Map();
    this.gunVisuals = new Map();
    this.bulletVisuals = new Map();
    this.chunkVisuals = [];
    this.chunkById = new Map();
    this.particles = [];
    this.ragdolls = [];
    this.shake = 0;

    this._buildArena(config);
  }

  _buildArena(config) {
    const w = config.arenaWidth || 12;
    const d = config.arenaDepth || 8;

    // Solid opaque tabletop arena slab
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      transparent: false,
      opacity: 1.0,
      roughness: 0.78,
      metalness: 0.08,
    });
    const slabThickness = 0.16;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, slabThickness, d), floorMat);
    floor.position.y = -slabThickness / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Crisp tactical grid lines on top of the opaque slab
    const gridPoints = [];
    const step = 2.0;
    for (let x = -w / 2; x <= w / 2 + 0.001; x += step) {
      gridPoints.push(new THREE.Vector3(x, 0.008, -d / 2), new THREE.Vector3(x, 0.008, d / 2));
    }
    for (let z = -d / 2; z <= d / 2 + 0.001; z += step) {
      gridPoints.push(new THREE.Vector3(-w / 2, 0.008, z), new THREE.Vector3(w / 2, 0.008, z));
    }
    const gridGeo = new THREE.BufferGeometry().setFromPoints(gridPoints);
    const gridMat = new THREE.LineBasicMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.65,
    });
    this.group.add(new THREE.LineSegments(gridGeo, gridMat));

    // Solid glowing tabletop border frame
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.45,
      roughness: 0.35,
      metalness: 0.25,
    });
    const borderThickness = 0.12;
    const borderHeight = 0.1;

    const topBar = new THREE.Mesh(new THREE.BoxGeometry(w + borderThickness * 2, borderHeight, borderThickness), frameMat);
    topBar.position.set(0, borderHeight / 2, -d / 2 - borderThickness / 2);
    const botBar = topBar.clone();
    botBar.position.z = d / 2 + borderThickness / 2;

    const leftBar = new THREE.Mesh(new THREE.BoxGeometry(borderThickness, borderHeight, d), frameMat);
    leftBar.position.set(-w / 2 - borderThickness / 2, borderHeight / 2, 0);
    const rightBar = leftBar.clone();
    rightBar.position.x = w / 2 + borderThickness / 2;

    this.group.add(topBar, botBar, leftBar, rightBar);

    // Chippable & destructible barriers built from authoritative engine chunks
    const wallIntactMat = new THREE.MeshStandardMaterial({
      color: 0x9ca3af,
      roughness: 0.85,
      metalness: 0.04,
      bumpMap: clayBumpTexture(),
      bumpScale: 0.012,
    });
    const wallCapIntactMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.72,
      bumpMap: clayBumpTexture(),
      bumpScale: 0.01,
    });
    const wallChippedMat = new THREE.MeshStandardMaterial({
      map: crackedBarrierTexture(),
      color: 0x9ca3af,
      roughness: 0.92,
      metalness: 0.02,
    });
    const rockIntactMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.9,
      flatShading: true,
    });
    const rockChippedMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.95,
      flatShading: true,
    });

    this.barrierMats = { wallIntactMat, wallCapIntactMat, wallChippedMat, rockIntactMat, rockChippedMat };

    const chunks = config.chunks || [];
    for (const ch of chunks) {
      const container = new THREE.Group();
      container.position.set(ch.x, ch.y + ch.height / 2, ch.z);
      container.rotation.y = ch.rotY;

      let mesh;
      if (ch.type === 'wall') {
        const geo = new THREE.BoxGeometry(ch.halfW * 2 - 0.015, ch.height - 0.012, ch.halfD * 2);
        mesh = new THREE.Mesh(geo, ch.isCap ? wallCapIntactMat : wallIntactMat);
      } else {
        const geo = new THREE.DodecahedronGeometry(ch.halfW * 1.15, 0);
        mesh = new THREE.Mesh(geo, rockIntactMat);
        mesh.scale.set(1.0, ch.height / (ch.halfW * 1.65), ch.halfD / ch.halfW);
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      container.add(mesh);
      this.group.add(container);

      const entry = {
        id: ch.id,
        type: ch.type,
        isCap: ch.isCap,
        maxHp: ch.maxHp,
        hp: ch.maxHp,
        baseX: ch.x,
        baseY: ch.y + ch.height / 2,
        baseZ: ch.z,
        baseRotY: ch.rotY,
        baseScale: mesh.scale.clone(),
        container,
        mesh,
        jolt: 0,
      };
      this.chunkVisuals.push(entry);
      this.chunkById.set(ch.id, entry);
    }
  }

  _spawnBurst(x, y, z, color, count = 10, speed = 2.8, size = 0.08, { shape = 'sphere', bounce = 0.35 } = {}) {
    const geo = shape === 'cube'
      ? new THREE.BoxGeometry(size, size * 0.85, size * 0.9)
      : shape === 'casing'
        ? new THREE.CylinderGeometry(size * 0.35, size * 0.35, size * 1.5, 6)
        : new THREE.SphereGeometry(size, 6, 6);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color,
        roughness: shape === 'casing' ? 0.3 : 0.85,
        metalness: shape === 'casing' ? 0.8 : 0.05,
        transparent: true,
        opacity: 0.98,
      }));
      m.position.set(x, y, z);
      m.castShadow = shape === 'cube';
      const a = Math.random() * Math.PI * 2;
      const up = 0.45 + Math.random() * 1.25;
      const spd = (0.4 + Math.random() * 0.85) * speed;
      this.group.add(m);
      this.particles.push({
        mesh: m,
        vx: Math.cos(a) * spd,
        vy: up * spd * 0.65,
        vz: Math.sin(a) * spd,
        rx: (Math.random() - 0.5) * 14,
        ry: (Math.random() - 0.5) * 14,
        bounce,
        life: (shape === 'cube' ? 0.75 : 0.42) + Math.random() * 0.3,
        maxLife: shape === 'cube' ? 0.95 : 0.6,
      });
    }
  }

  _spawnShellCasing(x, y, z, yaw) {
    // Eject brass shell casing to the right of the barrel
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const geo = new THREE.CylinderGeometry(0.018, 0.018, 0.065, 6);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      roughness: 0.25,
      metalness: 0.85,
      transparent: true,
      opacity: 1,
    }));
    m.position.set(x, y, z);
    this.group.add(m);
    const spd = 1.6 + Math.random() * 1.1;
    this.particles.push({
      mesh: m,
      vx: rightX * spd + (Math.random() - 0.5) * 0.6,
      vy: 2.2 + Math.random() * 1.2,
      vz: rightZ * spd + (Math.random() - 0.5) * 0.6,
      rx: 18,
      ry: 12,
      bounce: 0.52,
      life: 0.9,
      maxLife: 0.9,
    });
  }

  _spawnRagdoll(x, y, z, vx, vz, colorHex) {
    const color = new THREE.Color(colorHex);
    const rig = createClayStickmanRig(color);
    rig.body.position.set(x, Math.max(0.25, y), z);
    this.group.add(rig.body);
    this.ragdolls.push({
      rig,
      vx: (vx || 0) + (Math.random() - 0.5) * 2.0,
      vy: 4.8 + Math.random() * 1.8,
      vz: (vz || 0) + (Math.random() - 0.5) * 2.0,
      rotVx: (Math.random() - 0.5) * 14,
      rotVy: (Math.random() - 0.5) * 12,
      rotVz: (Math.random() - 0.5) * 14,
      life: 1.7,
      maxLife: 1.7,
    });
  }

  _syncBarriers(chunkHps) {
    if (!chunkHps) return;
    const { wallIntactMat, wallCapIntactMat, wallChippedMat, rockIntactMat, rockChippedMat } = this.barrierMats;
    for (let i = 0; i < this.chunkVisuals.length; i++) {
      const cv = this.chunkVisuals[i];
      const nextHp = chunkHps[i];
      if (nextHp === undefined || nextHp === cv.hp) continue;
      cv.hp = nextHp;
      if (nextHp <= 0) {
        cv.container.visible = false;
      } else {
        cv.container.visible = true;
        const ratio = nextHp / cv.maxHp;
        const chipped = ratio < 0.99;
        // Visibly chip/shrink and crack the barrier segment!
        const s = 0.72 + ratio * 0.28;
        cv.mesh.scale.set(cv.baseScale.x * (0.82 + ratio * 0.18), cv.baseScale.y * s, cv.baseScale.z * (0.8 + ratio * 0.2));
        cv.container.position.y = cv.baseY - (1 - s) * 0.08;
        if (chipped) {
          cv.mesh.material = cv.type === 'wall' ? wallChippedMat : rockChippedMat;
          cv.container.rotation.z = ((i % 2 === 0 ? 1 : -1) * 0.06) * (1 - ratio);
        } else {
          cv.mesh.material = cv.type === 'wall' ? (cv.isCap ? wallCapIntactMat : wallIntactMat) : rockIntactMat;
          cv.container.rotation.z = 0;
        }
      }
    }
  }

  applyState(state) {
    this._syncBarriers(state.chunkHps);

    const activePlayerIds = new Set();
    for (const p of state.players) {
      activePlayerIds.add(p.id);
      let vis = this.playerVisuals.get(p.id);
      if (!vis) {
        vis = createStickmanVisual(p, p.id === this.selfPlayerId);
        this.group.add(vis.root);
        this.playerVisuals.set(p.id, vis);
      }

      vis.root.visible = p.alive;
      vis.targetX = p.x;
      vis.targetY = p.y;
      vis.targetZ = p.z;
      vis.targetYaw = p.yaw;
      vis.state = p;

      // Weapon visuals
      vis.heldPistol.visible = p.hasGun && p.weaponType !== 'rapid';
      vis.heldRapid.visible = p.hasGun && p.weaponType === 'rapid';

      // Hit flash
      if (p.hitFlash > 0) {
        vis.mat.emissive.setHex(0xffffff);
        vis.mat.emissiveIntensity = 0.75;
      } else {
        vis.mat.emissive.setHex(0x000000);
        vis.mat.emissiveIntensity = 0;
      }

      // Update floating HP label when changed
      if (vis.lastLabelHp !== p.hp || vis.lastLabelName !== p.name) {
        vis.lastLabelHp = p.hp;
        vis.lastLabelName = p.name;
        const nextTex = makeLabelTexture(p.name, p.color, p.hp, p.maxHp, p.id === this.selfPlayerId);
        vis.labelSprite.material.map.dispose();
        vis.labelSprite.material.map = nextTex;
        vis.labelSprite.material.needsUpdate = true;
      }
    }

    for (const [id, vis] of this.playerVisuals.entries()) {
      if (!activePlayerIds.has(id)) {
        this.group.remove(vis.root);
        this.playerVisuals.delete(id);
      }
    }

    // Sync dropped guns
    const activeGunIds = new Set();
    for (const g of state.guns) {
      activeGunIds.add(g.id);
      let gv = this.gunVisuals.get(g.id);
      if (!gv) {
        const container = new THREE.Group();
        const mesh = createGunMesh(g.type);
        mesh.position.y = 0.26;
        mesh.scale.setScalar(1.35);
        container.add(mesh);

        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.28, 0.36, 20),
          new THREE.MeshBasicMaterial({
            color: g.type === 'rapid' ? 0xf59e0b : 0x38bdf8,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
          })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.025;
        container.add(ring);

        this.group.add(container);
        gv = { container, mesh, ring };
        this.gunVisuals.set(g.id, gv);
      }
      gv.container.position.set(g.x, g.y, g.z);
      gv.mesh.rotation.y = g.rotY;
      gv.ring.visible = g.grounded;
    }

    for (const [id, gv] of this.gunVisuals.entries()) {
      if (!activeGunIds.has(id)) {
        this.group.remove(gv.container);
        this.gunVisuals.delete(id);
      }
    }

    // Sync bullets
    const activeBulletIds = new Set();
    for (const b of state.bullets) {
      activeBulletIds.add(b.id);
      let bv = this.bulletVisuals.get(b.id);
      if (!bv) {
        const bolt = new THREE.Mesh(
          new THREE.SphereGeometry(0.11, 8, 8),
          new THREE.MeshBasicMaterial({ color: b.color })
        );
        const trail = new THREE.Mesh(
          new THREE.CylinderGeometry(0.032, 0.075, 0.52, 6),
          new THREE.MeshBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.85 })
        );
        trail.rotation.x = Math.PI / 2;
        trail.position.z = -0.25;
        const container = new THREE.Group();
        container.add(bolt, trail);
        container.rotation.y = Math.atan2(b.vx, b.vz);
        this.group.add(container);
        bv = { container };
        this.bulletVisuals.set(b.id, bv);
      }
      bv.container.position.set(b.x, b.y, b.z);
    }

    for (const [id, bv] of this.bulletVisuals.entries()) {
      if (!activeBulletIds.has(id)) {
        this.group.remove(bv.container);
        this.bulletVisuals.delete(id);
      }
    }

    // Handle server events for rubbery impulses, barrier chipping VFX & audio
    for (const ev of state.events || []) {
      switch (ev.type) {
        case 'land': {
          const vis = this.playerVisuals.get(ev.playerId);
          if (vis) vis.squash.impulse(-4.8); // big claymation landing squish!
          this._spawnBurst(ev.x, 0.08, ev.z, 0xe2e8f0, 8, 2.0, 0.06);
          sound.playLand();
          break;
        }
        case 'jump': {
          const vis = this.playerVisuals.get(ev.playerId);
          if (vis) vis.squash.impulse(4.2); // stretch tall on jump!
          if (ev.playerId === this.selfPlayerId) sound.playJump();
          this._spawnBurst(ev.x, 0.05, ev.z, 0xcbd5e1, 5, 1.5, 0.05);
          break;
        }
        case 'pickup': {
          const vis = this.playerVisuals.get(ev.playerId);
          if (vis) vis.squash.impulse(3.0);
          this._spawnBurst(ev.x, ev.y + 0.4, ev.z, 0x38bdf8, 12, 2.6, 0.07);
          sound.playPickup();
          break;
        }
        case 'shoot': {
          const vis = this.playerVisuals.get(ev.playerId);
          if (vis) {
            const kickPower = ev.weaponType === 'rapid' ? 7.5 : 10.5;
            vis.gunKick.impulse(kickPower);
            vis.leanX.impulse(-kickPower * 0.65); // whip torso back from recoil!
            vis.headPitch.impulse(-kickPower * 0.55); // bobblehead lag!
            vis.squash.impulse(-2.2);
            vis.flashTimer = 0.065;
          }
          this.shake = Math.min(0.14, this.shake + (ev.weaponType === 'rapid' ? 0.032 : 0.05));
          this._spawnBurst(ev.x, ev.y, ev.z, 0xfef08a, 5, 2.4, 0.055);
          this._spawnShellCasing(ev.x, ev.y, ev.z, ev.yaw || 0);
          sound.playShoot();
          sound.playNoise({ duration: 0.07, freq: 520, q: 0.7, gain: 0.13, type: 'lowpass' });
          break;
        }
        case 'wall_hit': {
          const cv = this.chunkById.get(ev.chunkId);
          if (cv) cv.jolt = 1.0;
          const rubbleColor = ev.chunkType === 'rock' ? 0x64748b : 0xb0b8c4;
          const count = ev.destroyed ? 16 : 8;
          const spd = ev.destroyed ? 3.8 : 2.6;
          // Chunky 3D rubble debris + impact sparks!
          this._spawnBurst(ev.x, ev.y, ev.z, rubbleColor, count, spd, ev.destroyed ? 0.095 : 0.065, { shape: 'cube', bounce: 0.42 });
          this._spawnBurst(ev.x, ev.y, ev.z, 0xfbbf24, ev.destroyed ? 8 : 5, 2.8, 0.045);
          if (ev.destroyed) {
            this.shake = Math.min(0.18, this.shake + 0.09);
            sound.playNoise({ duration: 0.22, freq: 340, q: 0.6, gain: 0.2, type: 'lowpass' });
            sound.playNoise({ duration: 0.12, freq: 2200, q: 1.0, gain: 0.12 });
          } else {
            this.shake = Math.min(0.12, this.shake + 0.035);
            sound.playNoise({ duration: 0.09, freq: 1850, q: 1.2, gain: 0.11 });
          }
          break;
        }
        case 'hit': {
          const vis = this.playerVisuals.get(ev.targetId);
          if (vis) {
            vis.leanX.impulse(-9.0);
            vis.headPitch.impulse(-11.0);
            vis.headRoll.impulse((Math.random() - 0.5) * 14);
            vis.squash.impulse(-4.0);
          }
          this.shake = Math.min(0.16, this.shake + 0.06);
          this._spawnBurst(ev.x, ev.y, ev.z, ev.color, 12, 3.4, 0.075);
          sound.playHit();
          break;
        }
        case 'elim': {
          this.shake = Math.min(0.24, this.shake + 0.15);
          this._spawnRagdoll(ev.x, ev.y, ev.z, ev.vx, ev.vz, ev.color);
          this._spawnBurst(ev.x, ev.y, ev.z, ev.color, 22, 4.4, 0.1, { shape: 'cube', bounce: 0.45 });
          sound.playElim();
          break;
        }
        case 'round_over':
          sound.playWin();
          break;
        default:
          break;
      }
    }
  }

  _animateClayStickman(vis, dt, time) {
    const p = vis.state;
    if (!p) return;

    const vx = p.vx || 0;
    const vy = p.vy || 0;
    const vz = p.vz || 0;
    const speedXZ = Math.hypot(vx, vz);
    const air = vis.body.position.y > 0.07;

    // Project velocity onto character's local forward & right axes for realistic lean
    const fwdX = Math.sin(vis.body.rotation.y);
    const fwdZ = Math.cos(vis.body.rotation.y);
    const rightX = -fwdZ;
    const rightZ = fwdX;
    const localFwd = vx * fwdX + vz * fwdZ;
    const localRight = vx * rightX + vz * rightZ;

    // Acceleration spike -> rubbery whip impulse!
    const accX = (vx - vis.prevVx) / Math.max(dt, 0.016);
    const accZ = (vz - vis.prevVz) / Math.max(dt, 0.016);
    const accFwd = accX * fwdX + accZ * fwdZ;
    const accRight = accX * rightX + accZ * rightZ;
    vis.prevVx = vx;
    vis.prevVz = vz;

    if (Math.abs(accFwd) > 12) vis.headPitch.impulse(-Math.sign(accFwd) * 0.45);
    if (Math.abs(accRight) > 12) vis.headRoll.impulse(Math.sign(accRight) * 0.45);

    const targetLeanX = Math.max(-0.55, Math.min(0.55, localFwd * 0.095 - (p.recoilKick || 0) * 0.35));
    const targetLeanZ = Math.max(-0.45, Math.min(0.45, -localRight * 0.09));
    const leanX = vis.leanX.step(targetLeanX, dt);
    const leanZ = vis.leanZ.step(targetLeanZ, dt);
    const headPitch = vis.headPitch.step(-leanX * 0.55, dt);
    const headRoll = vis.headRoll.step(-leanZ * 0.65, dt);
    const squash = Math.max(-0.32, Math.min(0.38, vis.squash.step(air ? Math.max(-0.1, Math.min(0.18, vy * 0.025)) : 0, dt)));
    const gunKick = Math.max(-0.2, Math.min(1.1, vis.gunKick.step(0, dt)));

    // Squash & stretch volume-preserving clay scale
    const sy = 1 + squash;
    const sxz = 1 / Math.sqrt(Math.max(0.55, sy));
    vis.body.scale.set(sxz, sy, sxz);

    // Flexible rubbery spine curve
    const idleWobble = Math.sin(time * 4.5 + vis.targetX) * 0.04;
    vis.hips.rotation.set(leanX * 0.5, 0, leanZ * 0.45 + idleWobble);
    vis.waist.rotation.set(leanX * 0.55, 0, leanZ * 0.5);
    vis.chest.rotation.set(leanX * 0.45, 0, leanZ * 0.35);
    vis.head.rotation.set(headPitch, 0, headRoll);

    // Muzzle flash visibility
    if (vis.flashTimer > 0) {
      vis.flashTimer = Math.max(0, vis.flashTimer - dt);
    }
    const activeGun = p.weaponType === 'rapid' ? vis.heldRapid : vis.heldPistol;
    if (activeGun.userData.flash) {
      activeGun.userData.flash.visible = vis.flashTimer > 0 && p.hasGun;
      if (activeGun.userData.flash.visible) {
        activeGun.userData.flash.rotation.z += dt * 35;
      }
    }

    // Weapon kickback & recoil bounce
    vis.gunPivot.rotation.set(-gunKick * 0.72, 0, gunKick * 0.12);
    vis.gunPivot.position.set(-0.04, 0.05 + gunKick * 0.06, 0.28 - gunKick * 0.11);

    // Floppy multi-jointed legs (Stick-Fight noodle gait & midair flail!)
    const ph = p.animPhase || 0;
    if (air) {
      const flail = Math.sin(time * 22);
      vis.leftLeg.hip.rotation.set(-0.55 + flail * 0.5, 0, 0.15);
      vis.leftLeg.knee.rotation.x = 0.65 + Math.max(0, -flail) * 0.75;
      vis.rightLeg.hip.rotation.set(-0.55 - flail * 0.5, 0, -0.15);
      vis.rightLeg.knee.rotation.x = 0.65 + Math.max(0, flail) * 0.75;
    } else if (speedXZ > 0.2) {
      const s = Math.sin(ph);
      const liftL = Math.max(0, Math.sin(ph + 1.5));
      const liftR = Math.max(0, Math.sin(ph + 1.5 + Math.PI));
      vis.leftLeg.hip.rotation.set(s * 0.85 - 0.1, 0, 0.06);
      vis.leftLeg.knee.rotation.x = 0.25 + liftL * 1.15;
      vis.rightLeg.hip.rotation.set(-s * 0.85 - 0.1, 0, -0.06);
      vis.rightLeg.knee.rotation.x = 0.25 + liftR * 1.15;
      // Bouncy clay run bob!
      vis.hips.position.y = 0.44 + Math.abs(Math.sin(ph)) * 0.065;
    } else {
      vis.leftLeg.hip.rotation.set(-0.06, 0, 0.08);
      vis.leftLeg.knee.rotation.x = 0.12;
      vis.rightLeg.hip.rotation.set(0.06, 0, -0.08);
      vis.rightLeg.knee.rotation.x = 0.12;
      vis.hips.position.y = 0.44 + Math.sin(time * 4.5) * 0.015;
    }

    // Floppy multi-jointed arms
    if (p.hasGun) {
      const aimLift = -1.32 - gunKick * 0.65;
      vis.leftArm.shoulder.rotation.set(aimLift, 0.25, 0.18);
      vis.leftArm.elbow.rotation.x = -0.35 - gunKick * 0.35;
      vis.rightArm.shoulder.rotation.set(aimLift, -0.22, -0.15);
      vis.rightArm.elbow.rotation.x = -0.3 - gunKick * 0.35;
    } else if (air) {
      // Wild Stick-Fight midair arm flailing!
      const w = Math.sin(time * 24);
      vis.leftArm.shoulder.rotation.set(-2.2 + w * 0.5, 0, 0.65);
      vis.leftArm.elbow.rotation.x = -0.5;
      vis.rightArm.shoulder.rotation.set(-2.2 - w * 0.5, 0, -0.65);
      vis.rightArm.elbow.rotation.x = -0.5;
    } else if (speedXZ > 0.2) {
      const s = Math.sin(ph);
      vis.leftArm.shoulder.rotation.set(-s * 0.95, 0, 0.22);
      vis.leftArm.elbow.rotation.x = -0.65 - Math.max(0, -s) * 0.55;
      vis.rightArm.shoulder.rotation.set(s * 0.95, 0, -0.22);
      vis.rightArm.elbow.rotation.x = -0.65 - Math.max(0, s) * 0.55;
    } else {
      vis.leftArm.shoulder.rotation.set(0.08, 0, 0.16 + idleWobble);
      vis.leftArm.elbow.rotation.x = -0.22;
      vis.rightArm.shoulder.rotation.set(0.08, 0, -0.16 + idleWobble);
      vis.rightArm.elbow.rotation.x = -0.22;
    }
  }

  update(dt) {
    const time = performance.now() / 1000;
    const smooth = Math.min(1, dt * 19);

    // Subtle impact board shake
    if (this.shake > 0.001) {
      this.shake = Math.max(0, this.shake - dt * 1.1);
      this.group.position.set(
        (Math.random() - 0.5) * this.shake,
        (Math.random() - 0.5) * this.shake * 0.5,
        (Math.random() - 0.5) * this.shake
      );
    } else {
      this.group.position.set(0, 0, 0);
    }

    // Barrier chip jolt vibration
    for (const cv of this.chunkVisuals) {
      if (cv.jolt > 0 && cv.container.visible) {
        cv.jolt = Math.max(0, cv.jolt - dt * 7);
        cv.container.position.x = cv.baseX + (Math.random() - 0.5) * 0.06 * cv.jolt;
        cv.container.position.z = cv.baseZ + (Math.random() - 0.5) * 0.06 * cv.jolt;
      } else if (cv.container.visible) {
        cv.container.position.x = cv.baseX;
        cv.container.position.z = cv.baseZ;
      }
    }

    for (const vis of this.playerVisuals.values()) {
      vis.root.position.x += (vis.targetX - vis.root.position.x) * smooth;
      vis.root.position.z += (vis.targetZ - vis.root.position.z) * smooth;
      vis.body.position.y += (vis.targetY - vis.body.position.y) * smooth;

      // Shortest-angle yaw interpolation
      let diff = vis.targetYaw - vis.body.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      vis.body.rotation.y += diff * smooth;

      const heightScale = Math.max(0.4, 1 - vis.body.position.y * 0.25);
      vis.shadow.scale.setScalar(heightScale);

      if (vis.root.visible) {
        this._animateClayStickman(vis, dt, time);
      }
    }

    // Update tumbling KO ragdolls
    for (let i = this.ragdolls.length - 1; i >= 0; i--) {
      const rd = this.ragdolls[i];
      rd.life -= dt;
      if (rd.life <= 0) {
        this.group.remove(rd.rig.body);
        this.ragdolls.splice(i, 1);
        continue;
      }
      rd.vy -= 17.5 * dt;
      rd.rig.body.position.x += rd.vx * dt;
      rd.rig.body.position.y += rd.vy * dt;
      rd.rig.body.position.z += rd.vz * dt;
      if (rd.rig.body.position.y < 0.2) {
        rd.rig.body.position.y = 0.2;
        rd.vy = Math.abs(rd.vy) * 0.45;
        rd.vx *= 0.72;
        rd.vz *= 0.72;
        rd.rotVx *= 0.7;
        rd.rotVz *= 0.7;
      }
      rd.rig.body.rotation.x += rd.rotVx * dt;
      rd.rig.body.rotation.y += rd.rotVy * dt;
      rd.rig.body.rotation.z += rd.rotVz * dt;
      // Floppy ragdoll limbs!
      const flop = Math.sin(time * 26 + i);
      rd.rig.leftArm.shoulder.rotation.set(-1.8 + flop, 0, 0.8);
      rd.rig.rightArm.shoulder.rotation.set(-1.8 - flop, 0, -0.8);
      rd.rig.leftLeg.hip.rotation.x = flop * 0.9;
      rd.rig.rightLeg.hip.rotation.x = -flop * 0.9;
      if (rd.life < 0.45) {
        rd.rig.body.scale.setScalar(Math.max(0.01, rd.life / 0.45));
      }
    }

    // Update particles (sparks, brass casings, bouncing rubble chunks)
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        this.group.remove(pt.mesh);
        pt.mesh.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      pt.vy -= 12.5 * dt;
      pt.mesh.position.x += pt.vx * dt;
      pt.mesh.position.y += pt.vy * dt;
      pt.mesh.position.z += pt.vz * dt;
      if (pt.mesh.position.y <= 0.03) {
        pt.mesh.position.y = 0.03;
        if (Math.abs(pt.vy) > 0.6) {
          pt.vy = -pt.vy * (pt.bounce ?? 0.35);
          pt.vx *= 0.75;
          pt.vz *= 0.75;
        } else {
          pt.vy = 0;
          pt.vx *= 0.82;
          pt.vz *= 0.82;
        }
      }
      pt.mesh.rotation.x += (pt.rx || 0) * dt;
      pt.mesh.rotation.y += (pt.ry || 0) * dt;
      pt.mesh.material.opacity = Math.max(0, Math.min(1, (pt.life / pt.maxLife) * 1.4));
    }
  }

  dispose() {
    this.boardRoot.remove(this.group);
  }
}
