import * as THREE from '../../vendor/three/three.module.js';
import { sound } from '../audio.js';

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
    roughness: 0.35,
    metalness: 0.65,
  });
  const accentMat = new THREE.MeshBasicMaterial({
    color: type === 'rapid' ? 0xf59e0b : 0x38bdf8,
  });

  const barrel = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 0.11, type === 'rapid' ? 0.52 : 0.38),
    bodyMat
  );
  barrel.position.set(0, 0.06, 0.12);
  barrel.castShadow = true;
  group.add(barrel);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.17, 0.11), bodyMat);
  grip.position.set(0, -0.05, -0.02);
  grip.rotation.x = 0.25;
  group.add(grip);

  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.03, type === 'rapid' ? 0.34 : 0.22),
    accentMat
  );
  strip.position.set(0, 0.11, 0.12);
  group.add(strip);

  return group;
}

function createStickmanVisual(player, isSelf) {
  const root = new THREE.Group();
  const color = new THREE.Color(player.color);

  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.32,
    metalness: 0.1,
  });

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

  // Body pivot (rotates with yaw & lifts with Y)
  const body = new THREE.Group();
  root.add(body);

  // Torso
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.34, 6, 12), mat);
  torso.position.y = 0.54;
  torso.castShadow = true;
  body.add(torso);

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 14), mat);
  head.position.y = 0.94;
  head.castShadow = true;
  body.add(head);

  // Visor/eyes so facing direction is immediately readable
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.06, 0.08),
    new THREE.MeshBasicMaterial({ color: 0x0f172a })
  );
  visor.position.set(0, 0.95, 0.14);
  body.add(visor);

  // Legs
  const legGeo = new THREE.CapsuleGeometry(0.055, 0.24, 4, 8);
  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(0.08, 0.36, 0);
  const leftLeg = new THREE.Mesh(legGeo, mat);
  leftLeg.position.y = -0.16;
  leftLeg.castShadow = true;
  leftLegPivot.add(leftLeg);
  body.add(leftLegPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(-0.08, 0.36, 0);
  const rightLeg = new THREE.Mesh(legGeo, mat);
  rightLeg.position.y = -0.16;
  rightLeg.castShadow = true;
  rightLegPivot.add(rightLeg);
  body.add(rightLegPivot);

  // Arms
  const armGeo = new THREE.CapsuleGeometry(0.048, 0.24, 4, 8);
  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(0.17, 0.68, 0);
  const leftArm = new THREE.Mesh(armGeo, mat);
  leftArm.position.y = -0.14;
  leftArm.castShadow = true;
  leftArmPivot.add(leftArm);
  body.add(leftArmPivot);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(-0.17, 0.68, 0);
  const rightArm = new THREE.Mesh(armGeo, mat);
  rightArm.position.y = -0.14;
  rightArm.castShadow = true;
  rightArmPivot.add(rightArm);
  body.add(rightArmPivot);

  // Held gun attached to torso/aiming forward
  const heldPistol = createGunMesh('pistol');
  heldPistol.position.set(-0.06, 0.56, 0.28);
  heldPistol.visible = false;
  body.add(heldPistol);

  const heldRapid = createGunMesh('rapid');
  heldRapid.position.set(-0.06, 0.56, 0.3);
  heldRapid.visible = false;
  body.add(heldRapid);

  // Floating Name & Health sprite
  const labelTex = makeLabelTexture(player.name, player.color, player.hp, player.maxHp, isSelf);
  const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false });
  const labelSprite = new THREE.Sprite(labelMat);
  labelSprite.position.set(0, 1.42, 0);
  labelSprite.scale.set(1.35, 0.5, 1);
  body.add(labelSprite);

  return {
    root,
    body,
    shadow,
    mat,
    leftLegPivot,
    rightLegPivot,
    leftArmPivot,
    rightArmPivot,
    heldPistol,
    heldRapid,
    labelSprite,
    lastLabelHp: player.hp,
    lastLabelName: player.name,
    targetX: player.x,
    targetY: player.y,
    targetZ: player.z,
    targetYaw: player.yaw,
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
    this.particles = [];

    this._buildArena(config);
  }

  _buildArena(config) {
    const w = config.arenaWidth || 12;
    const d = config.arenaDepth || 8;

    // Translucent frosted arena plane so printed QR code underneath remains visible
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.22,
      roughness: 0.6,
      metalness: 0.15,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Glowing grid lines matching reference image
    const gridPoints = [];
    const step = 2.0;
    for (let x = -w / 2; x <= w / 2 + 0.001; x += step) {
      gridPoints.push(new THREE.Vector3(x, 0.01, -d / 2), new THREE.Vector3(x, 0.01, d / 2));
    }
    for (let z = -d / 2; z <= d / 2 + 0.001; z += step) {
      gridPoints.push(new THREE.Vector3(-w / 2, 0.01, z), new THREE.Vector3(w / 2, 0.01, z));
    }
    const gridGeo = new THREE.BufferGeometry().setFromPoints(gridPoints);
    const gridMat = new THREE.LineBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.55,
    });
    this.group.add(new THREE.LineSegments(gridGeo, gridMat));

    // Glowing tabletop border frame
    const frameMat = new THREE.MeshBasicMaterial({
      color: 0xbae6fd,
      transparent: true,
      opacity: 0.85,
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

    // Tactical cover obstacles (concrete walls and faceted rocks)
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x9ca3af,
      roughness: 0.78,
      metalness: 0.08,
    });
    const wallCapMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.6,
    });
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.88,
      flatShading: true,
    });

    for (const obs of config.obstacles || []) {
      const obsGroup = new THREE.Group();
      obsGroup.position.set(obs.x, 0, obs.z);
      obsGroup.rotation.y = obs.rotY;

      if (obs.type === 'wall') {
        const base = new THREE.Mesh(
          new THREE.BoxGeometry(obs.halfW * 2, obs.height - 0.08, obs.halfD * 2),
          wallMat
        );
        base.position.y = (obs.height - 0.08) / 2;
        base.castShadow = true;
        base.receiveShadow = true;
        obsGroup.add(base);

        const cap = new THREE.Mesh(
          new THREE.BoxGeometry(obs.halfW * 2 + 0.05, 0.09, obs.halfD * 2 + 0.05),
          wallCapMat
        );
        cap.position.y = obs.height - 0.04;
        cap.castShadow = true;
        cap.receiveShadow = true;
        obsGroup.add(cap);
      } else {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(obs.halfW * 1.15, 0), rockMat);
        rock.scale.set(1.0, obs.height / (obs.halfW * 1.45), obs.halfD / obs.halfW);
        rock.position.y = obs.height * 0.45;
        rock.castShadow = true;
        rock.receiveShadow = true;
        obsGroup.add(rock);
      }

      this.group.add(obsGroup);
    }
  }

  _spawnBurst(x, y, z, color, count = 10, speed = 2.8, size = 0.08) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const geo = new THREE.SphereGeometry(size, 6, 6);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2;
      const up = 0.4 + Math.random() * 1.4;
      const spd = (0.4 + Math.random() * 0.8) * speed;
      this.group.add(mesh);
      this.particles.push({
        mesh,
        vx: Math.cos(a) * spd,
        vy: up * spd * 0.6,
        vz: Math.sin(a) * spd,
        life: 0.38 + Math.random() * 0.25,
        maxLife: 0.55,
      });
    }
  }

  applyState(state) {
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

      // Weapon visuals
      vis.heldPistol.visible = p.hasGun && p.weaponType !== 'rapid';
      vis.heldRapid.visible = p.hasGun && p.weaponType === 'rapid';

      if (p.hasGun) {
        vis.leftArmPivot.rotation.set(-1.35, 0.2, 0);
        vis.rightArmPivot.rotation.set(-1.35, -0.2, 0);
      } else {
        const swing = Math.sin(p.animPhase) * 0.55;
        vis.leftArmPivot.rotation.set(swing, 0, 0);
        vis.rightArmPivot.rotation.set(-swing, 0, 0);
      }

      // Legs animation
      if (p.y > 0.08) {
        vis.leftLegPivot.rotation.x = -0.35;
        vis.rightLegPivot.rotation.x = 0.35;
      } else {
        const stride = Math.sin(p.animPhase) * 0.65;
        vis.leftLegPivot.rotation.x = stride;
        vis.rightLegPivot.rotation.x = -stride;
      }

      // Hit flash
      if (p.hitFlash > 0) {
        vis.mat.emissive.setHex(0xffffff);
        vis.mat.emissiveIntensity = 0.7;
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
          new THREE.SphereGeometry(0.1, 8, 8),
          new THREE.MeshBasicMaterial({ color: b.color })
        );
        const trail = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.07, 0.45, 6),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })
        );
        trail.rotation.x = Math.PI / 2;
        trail.position.z = -0.22;
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

    // Handle server events for VFX & audio
    for (const ev of state.events || []) {
      switch (ev.type) {
        case 'land':
          this._spawnBurst(ev.x, 0.08, ev.z, 0xe2e8f0, 8, 2.0, 0.06);
          sound.playLand();
          break;
        case 'jump':
          if (ev.playerId === this.selfPlayerId) sound.playJump();
          this._spawnBurst(ev.x, 0.05, ev.z, 0xcbd5e1, 5, 1.5, 0.05);
          break;
        case 'pickup':
          this._spawnBurst(ev.x, ev.y + 0.4, ev.z, 0x38bdf8, 12, 2.6, 0.07);
          sound.playPickup();
          break;
        case 'shoot':
          this._spawnBurst(ev.x, ev.y, ev.z, ev.color, 4, 1.8, 0.05);
          sound.playShoot();
          break;
        case 'wall_hit':
          this._spawnBurst(ev.x, ev.y, ev.z, 0xfbbf24, 7, 2.5, 0.055);
          break;
        case 'hit':
          this._spawnBurst(ev.x, ev.y, ev.z, ev.color, 10, 3.0, 0.07);
          sound.playHit();
          break;
        case 'elim':
          this._spawnBurst(ev.x, ev.y, ev.z, ev.color, 22, 4.2, 0.11);
          sound.playElim();
          break;
        case 'round_over':
          sound.playWin();
          break;
        default:
          break;
      }
    }
  }

  update(dt) {
    const smooth = Math.min(1, dt * 18);
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
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        this.group.remove(pt.mesh);
        this.particles.splice(i, 1);
        continue;
      }
      pt.vy -= 9.5 * dt;
      pt.mesh.position.x += pt.vx * dt;
      pt.mesh.position.y = Math.max(0.02, pt.mesh.position.y + pt.vy * dt);
      pt.mesh.position.z += pt.vz * dt;
      pt.mesh.material.opacity = Math.max(0, pt.life / pt.maxLife);
    }
  }

  dispose() {
    this.boardRoot.remove(this.group);
  }
}
