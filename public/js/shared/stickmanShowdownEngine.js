/**
 * Stickman Showdown - Authoritative Game Engine (runs in Host's browser)
 *
 * Players drop onto a glowing flat tabletop arena, a gun drops near each player,
 * and they battle with camera-relative movement, jumping, and shooting until one remains.
 */

export const ARENA_WIDTH = 12;
export const ARENA_DEPTH = 8;
const HALF_W = ARENA_WIDTH / 2;
const HALF_D = ARENA_DEPTH / 2;

const PLAYER_RADIUS = 0.32;
const PICKUP_RADIUS = 0.85;
const BULLET_RADIUS = 0.14;
const BULLET_HEIGHT = 0.56;
const PLAYER_HEIGHT = 1.05;

const MOVE_SPEED = 3.9;
const REVERSE_SPEED = 2.6;
const TURN_SPEED = 3.4;
// Direct (camera-relative) steering: how fast a character swings to face
// the stick direction.
const FACE_TURN_SPEED = 14.0;
const JUMP_VELOCITY = 6.9;
const GRAVITY = 19.5;
const BULLET_SPEED = 14.0;
const SHOOT_COOLDOWN = 0.28;
const RAPID_COOLDOWN = 0.14;
const BULLET_DAMAGE = 25;

export const OBSTACLES = [
  { id: 'wall-nw', type: 'wall', x: -2.5, z: -1.1, halfW: 0.95, halfD: 0.24, height: 0.92, rotY: 0.22 },
  { id: 'wall-se', type: 'wall', x: 2.5, z: 1.1, halfW: 0.95, halfD: 0.24, height: 0.92, rotY: 0.22 },
  { id: 'wall-ne', type: 'wall', x: 2.4, z: -1.5, halfW: 0.8, halfD: 0.24, height: 0.88, rotY: -0.35 },
  { id: 'wall-sw', type: 'wall', x: -2.4, z: 1.5, halfW: 0.8, halfD: 0.24, height: 0.88, rotY: -0.35 },
  { id: 'rock-n', type: 'rock', x: 0.0, z: -2.45, halfW: 0.52, halfD: 0.45, height: 0.64, rotY: 0.4 },
  { id: 'rock-s', type: 'rock', x: 0.0, z: 2.45, halfW: 0.52, halfD: 0.45, height: 0.64, rotY: -0.5 },
  { id: 'rock-w', type: 'rock', x: -4.1, z: 0.0, halfW: 0.48, halfD: 0.48, height: 0.62, rotY: 0.8 },
  { id: 'rock-e', type: 'rock', x: 4.1, z: 0.0, halfW: 0.48, halfD: 0.48, height: 0.62, rotY: -0.7 },
];

const SPAWN_POINTS = [
  { x: -4.6, z: -2.7, yaw: Math.PI * 0.25 },
  { x: 4.6, z: 2.7, yaw: -Math.PI * 0.75 },
  { x: 4.6, z: -2.7, yaw: -Math.PI * 0.25 },
  { x: -4.6, z: 2.7, yaw: Math.PI * 0.75 },
  { x: 0.0, z: -3.2, yaw: 0 },
  { x: 0.0, z: 3.2, yaw: Math.PI },
  { x: -5.0, z: 0.0, yaw: Math.PI * 0.5 },
  { x: 5.0, z: 0.0, yaw: -Math.PI * 0.5 },
];

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function collideObstacleXZ(x, z, radius, obs) {
  const cos = Math.cos(-obs.rotY);
  const sin = Math.sin(-obs.rotY);
  const dx = x - obs.x;
  const dz = z - obs.z;

  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;

  const cx = clamp(lx, -obs.halfW, obs.halfW);
  const cz = clamp(lz, -obs.halfD, obs.halfD);

  const distX = lx - cx;
  const distZ = lz - cz;
  const distSq = distX * distX + distZ * distZ;

  if (distSq >= radius * radius) return null;

  let pushLX = 0;
  let pushLZ = 0;
  if (distSq > 1e-6) {
    const dist = Math.sqrt(distSq);
    const overlap = radius - dist;
    pushLX = (distX / dist) * overlap;
    pushLZ = (distZ / dist) * overlap;
  } else {
    const penX = obs.halfW - Math.abs(lx) + radius;
    const penZ = obs.halfD - Math.abs(lz) + radius;
    if (penX < penZ) {
      pushLX = (lx >= 0 ? 1 : -1) * penX;
    } else {
      pushLZ = (lz >= 0 ? 1 : -1) * penZ;
    }
  }

  const wCos = Math.cos(obs.rotY);
  const wSin = Math.sin(obs.rotY);
  return {
    dx: pushLX * wCos - pushLZ * wSin,
    dz: pushLX * wSin + pushLZ * wCos,
  };
}

function pointInObstacleXZ(x, z, margin, obs) {
  const cos = Math.cos(-obs.rotY);
  const sin = Math.sin(-obs.rotY);
  const dx = x - obs.x;
  const dz = z - obs.z;
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  return Math.abs(lx) <= obs.halfW + margin && Math.abs(lz) <= obs.halfD + margin;
}

export class StickmanShowdownEngine {
  constructor(players, callbacks = {}) {
    this.id = 'stickman-showdown';
    this.callbacks = callbacks;
    this.roundTime = 0;
    this.phase = 'dropping';
    this.dropDuration = 1.25;
    this.winnerId = null;
    this.winnerName = null;
    this.nextEntityId = 1;
    this.bonusSpawnTimer = 9.0;

    this.players = new Map();
    this.guns = [];
    this.bullets = [];
    this.events = [];

    this._initRound(players);
  }

  _initRound(roster) {
    this.players.clear();
    this.guns = [];
    this.bullets = [];
    this.events = [];
    this.roundTime = 0;
    this.phase = 'dropping';
    this.winnerId = null;
    this.winnerName = null;
    this.bonusSpawnTimer = 9.0;

    roster.forEach((p, idx) => {
      const sp = SPAWN_POINTS[idx % SPAWN_POINTS.length];
      const ringOffset = idx >= 8 ? 0.6 : 0;
      const px = clamp(sp.x + ringOffset, -HALF_W + 0.8, HALF_W - 0.8);
      const pz = clamp(sp.z, -HALF_D + 0.8, HALF_D - 0.8);

      this.players.set(p.id, {
        id: p.id,
        name: p.name,
        color: p.color,
        isBot: !!p.isBot,
        x: px,
        y: 4.8,
        z: pz,
        vx: 0,
        vy: -2.0,
        vz: 0,
        yaw: sp.yaw,
        hp: 100,
        maxHp: 100,
        alive: true,
        hasGun: false,
        weaponType: 'pistol',
        shootCooldown: 0,
        hitFlash: 0,
        animPhase: 0,
        grounded: false,
        kills: 0,
        input: { throttle: 0, turn: 0, moveX: 0, moveZ: 0, shoot: false, jump: false },
        botState: { strafeDir: idx % 2 === 0 ? 1 : -1, decisionTimer: 0.4 },
      });

      const toCenterX = -px;
      const toCenterZ = -pz;
      const len = Math.hypot(toCenterX, toCenterZ) || 1;
      const gunX = clamp(px + (toCenterX / len) * 1.35, -HALF_W + 0.7, HALF_W - 0.7);
      const gunZ = clamp(pz + (toCenterZ / len) * 1.35, -HALF_D + 0.7, HALF_D - 0.7);

      this.guns.push({
        id: `gun-${this.nextEntityId++}`,
        type: 'pistol',
        x: gunX,
        y: 5.8,
        z: gunZ,
        vy: -1.5,
        rotY: Math.random() * Math.PI * 2,
        grounded: false,
      });
    });

    this.events.push({ type: 'round_start' });
  }

  addPlayerMidMatch(player) {
    if (this.players.has(player.id)) return;
    const sp = SPAWN_POINTS[this.players.size % SPAWN_POINTS.length];
    this.players.set(player.id, {
      id: player.id,
      name: player.name,
      color: player.color,
      isBot: !!player.isBot,
      x: sp.x,
      y: 4.5,
      z: sp.z,
      vx: 0,
      vy: -2.0,
      vz: 0,
      yaw: sp.yaw,
      hp: 100,
      maxHp: 100,
      alive: true,
      hasGun: false,
      weaponType: 'pistol',
      shootCooldown: 0,
      hitFlash: 0,
      animPhase: 0,
      grounded: false,
      kills: 0,
      input: { throttle: 0, turn: 0, moveX: 0, moveZ: 0, shoot: false, jump: false },
      botState: { strafeDir: 1, decisionTimer: 0.5 },
    });

    const len = Math.hypot(sp.x, sp.z) || 1;
    this.guns.push({
      id: `gun-${this.nextEntityId++}`,
      type: 'pistol',
      x: sp.x - (sp.x / len) * 1.3,
      y: 5.5,
      z: sp.z - (sp.z / len) * 1.3,
      vy: -1.5,
      rotY: 0,
      grounded: false,
    });
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
  }

  renamePlayer(playerId, name) {
    const p = this.players.get(playerId);
    if (p) p.name = name;
  }

  handleInput(playerId, input) {
    const p = this.players.get(playerId);
    if (!p || !p.alive) return;
    p.input.throttle = clamp(Number(input.throttle) || 0, -1, 1);
    p.input.turn = clamp(Number(input.turn) || 0, -1, 1);
    // Board-space move direction (camera-relative stick, already rotated by
    // the player's phone). Length is the stick deflection, capped at 1.
    let mx = Number(input.moveX) || 0;
    let mz = Number(input.moveZ) || 0;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    p.input.moveX = mx;
    p.input.moveZ = mz;
    p.input.shoot = Boolean(input.shoot);
    p.input.jump = Boolean(input.jump);
  }

  _updateBotInput(bot, dt) {
    bot.botState.decisionTimer -= dt;
    if (bot.botState.decisionTimer <= 0) {
      bot.botState.decisionTimer = 0.6 + Math.random() * 0.9;
      if (Math.random() < 0.35) bot.botState.strafeDir *= -1;
    }

    let targetX = 0;
    let targetZ = 0;
    let hasTarget = false;
    let wantShoot = false;
    let wantJump = false;

    if (!bot.hasGun && this.guns.length > 0) {
      let bestDist = Infinity;
      for (const g of this.guns) {
        const d = Math.hypot(g.x - bot.x, g.z - bot.z);
        if (d < bestDist) {
          bestDist = d;
          targetX = g.x;
          targetZ = g.z;
          hasTarget = true;
        }
      }
    } else {
      let bestDist = Infinity;
      let enemy = null;
      for (const other of this.players.values()) {
        if (other.id === bot.id || !other.alive) continue;
        const d = Math.hypot(other.x - bot.x, other.z - bot.z);
        if (d < bestDist) {
          bestDist = d;
          enemy = other;
        }
      }
      if (enemy) {
        targetX = enemy.x;
        targetZ = enemy.z;
        hasTarget = true;

        const desiredYaw = Math.atan2(targetX - bot.x, targetZ - bot.z);
        const diff = normalizeAngle(desiredYaw - bot.yaw);
        if (Math.abs(diff) < 0.24 && bot.hasGun && bestDist < 10.5) {
          wantShoot = true;
        }
      }
    }

    if (!hasTarget) {
      bot.input = { throttle: 0, turn: 0.4, shoot: false, jump: false };
      return;
    }

    const desiredYaw = Math.atan2(targetX - bot.x, targetZ - bot.z);
    const angleDiff = normalizeAngle(desiredYaw - bot.yaw);
    const turn = clamp(-angleDiff * 2.2, -1, 1);

    const distToTarget = Math.hypot(targetX - bot.x, targetZ - bot.z);
    let throttle = 0;
    if (!bot.hasGun) {
      throttle = Math.abs(angleDiff) < 1.1 ? 1.0 : 0.25;
    } else if (distToTarget > 3.6) {
      throttle = 0.85;
    } else if (distToTarget < 2.0) {
      throttle = -0.6;
    } else {
      throttle = 0.25 * bot.botState.strafeDir;
    }

    if (bot.grounded && Math.random() < 0.015) {
      wantJump = true;
    }

    bot.input = { throttle, turn, shoot: wantShoot, jump: wantJump };
  }

  tick(dt) {
    this.events = [];
    this.roundTime += dt;

    if (this.phase === 'dropping' && this.roundTime >= this.dropDuration) {
      this.phase = 'playing';
      this.events.push({ type: 'fight_start' });
    }

    for (const g of this.guns) {
      if (!g.grounded) {
        g.vy -= GRAVITY * 0.65 * dt;
        g.y += g.vy * dt;
        if (g.y <= 0) {
          g.y = 0;
          g.vy = 0;
          g.grounded = true;
          this.events.push({ type: 'gun_land', x: g.x, z: g.z });
        }
      }
      g.rotY = (g.rotY + dt * 2.1) % (Math.PI * 2);
    }

    if (this.phase === 'playing') {
      this.bonusSpawnTimer -= dt;
      if (this.bonusSpawnTimer <= 0 && this.guns.length < 6) {
        this.bonusSpawnTimer = 11.0;
        const bx = (Math.random() - 0.5) * 3.0;
        const bz = (Math.random() - 0.5) * 1.6;
        this.guns.push({
          id: `gun-${this.nextEntityId++}`,
          type: 'rapid',
          x: bx,
          y: 5.2,
          z: bz,
          vy: -1.0,
          rotY: 0,
          grounded: false,
        });
        this.events.push({ type: 'bonus_drop', x: bx, z: bz });
      }
    }

    for (const p of this.players.values()) {
      if (!p.alive) continue;

      if (p.hitFlash > 0) p.hitFlash = Math.max(0, p.hitFlash - dt);
      if (p.shootCooldown > 0) p.shootCooldown = Math.max(0, p.shootCooldown - dt);

      if (this.phase === 'dropping') {
        p.vy -= GRAVITY * 0.75 * dt;
        p.y += p.vy * dt;
        if (p.y <= 0) {
          p.y = 0;
          p.vy = 0;
          if (!p.grounded) {
            p.grounded = true;
            this.events.push({ type: 'land', playerId: p.id, x: p.x, z: p.z, color: p.color });
          }
        }
        continue;
      }

      if (this.phase === 'round_over') {
        p.vx = 0;
        p.vz = 0;
        continue;
      }

      if (p.isBot) {
        this._updateBotInput(p, dt);
      }

      const moveMag = Math.hypot(p.input.moveX || 0, p.input.moveZ || 0);
      if (moveMag > 0.001) {
        // Direct steering: run where the stick points, turning to face it.
        const desiredYaw = Math.atan2(p.input.moveX, p.input.moveZ);
        const diff = normalizeAngle(desiredYaw - p.yaw);
        const step = FACE_TURN_SPEED * dt;
        p.yaw = normalizeAngle(p.yaw + clamp(diff, -step, step));
        p.vx = (p.input.moveX / moveMag) * Math.min(1, moveMag) * MOVE_SPEED;
        p.vz = (p.input.moveZ / moveMag) * Math.min(1, moveMag) * MOVE_SPEED;
      } else {
        // RC steering (bots): turn, then drive forward/back.
        p.yaw = normalizeAngle(p.yaw - p.input.turn * TURN_SPEED * dt);
        const drive = p.input.throttle >= 0
          ? p.input.throttle * MOVE_SPEED
          : p.input.throttle * REVERSE_SPEED;
        p.vx = Math.sin(p.yaw) * drive;
        p.vz = Math.cos(p.yaw) * drive;
      }
      // Facing (used for shooting) and ground speed (run animation).
      const fwdX = Math.sin(p.yaw);
      const fwdZ = Math.cos(p.yaw);
      const moveSpeed = Math.hypot(p.vx, p.vz);
      p.x = clamp(p.x + p.vx * dt, -HALF_W + PLAYER_RADIUS, HALF_W - PLAYER_RADIUS);
      p.z = clamp(p.z + p.vz * dt, -HALF_D + PLAYER_RADIUS, HALF_D - PLAYER_RADIUS);

      if (p.input.jump && p.grounded) {
        p.vy = JUMP_VELOCITY;
        p.grounded = false;
        this.events.push({ type: 'jump', playerId: p.id, x: p.x, z: p.z });
      }

      let floorHeight = 0;
      for (const obs of OBSTACLES) {
        if (pointInObstacleXZ(p.x, p.z, PLAYER_RADIUS * 0.6, obs)) {
          if (p.y >= obs.height - 0.14) {
            floorHeight = Math.max(floorHeight, obs.height);
          }
        }
      }

      p.vy -= GRAVITY * dt;
      p.y += p.vy * dt;

      if (p.y <= floorHeight) {
        p.y = floorHeight;
        p.vy = 0;
        p.grounded = true;
      } else {
        p.grounded = false;
      }

      for (const obs of OBSTACLES) {
        if (p.y < obs.height - 0.14) {
          const push = collideObstacleXZ(p.x, p.z, PLAYER_RADIUS, obs);
          if (push) {
            p.x += push.dx;
            p.z += push.dz;
          }
        }
      }

      for (const other of this.players.values()) {
        if (other.id === p.id || !other.alive) continue;
        if (Math.abs(other.y - p.y) > 0.85) continue;
        const dx = p.x - other.x;
        const dz = p.z - other.z;
        const dist = Math.hypot(dx, dz);
        const minDist = PLAYER_RADIUS * 2;
        if (dist > 0.001 && dist < minDist) {
          const push = (minDist - dist) * 0.5;
          p.x += (dx / dist) * push;
          p.z += (dz / dist) * push;
          other.x -= (dx / dist) * push;
          other.z -= (dz / dist) * push;
        }
      }

      if (moveSpeed > 0.15 && p.grounded) {
        p.animPhase += dt * (moveSpeed * 3.1);
      }

      for (let i = this.guns.length - 1; i >= 0; i--) {
        const g = this.guns[i];
        if (!g.grounded) continue;
        const d = Math.hypot(g.x - p.x, g.z - p.z);
        if (d <= PICKUP_RADIUS && p.y < 0.8) {
          if (!p.hasGun || (g.type === 'rapid' && p.weaponType !== 'rapid')) {
            p.hasGun = true;
            p.weaponType = g.type;
            this.guns.splice(i, 1);
            this.events.push({
              type: 'pickup',
              playerId: p.id,
              weaponType: g.type,
              x: p.x,
              y: p.y,
              z: p.z,
              color: p.color,
            });
          }
        }
      }

      if (p.input.shoot && p.hasGun && p.shootCooldown <= 0) {
        p.shootCooldown = p.weaponType === 'rapid' ? RAPID_COOLDOWN : SHOOT_COOLDOWN;
        const muzzleX = p.x + fwdX * 0.52;
        const muzzleY = p.y + BULLET_HEIGHT;
        const muzzleZ = p.z + fwdZ * 0.52;

        this.bullets.push({
          id: `b-${this.nextEntityId++}`,
          ownerId: p.id,
          color: p.color,
          x: muzzleX,
          y: muzzleY,
          z: muzzleZ,
          vx: fwdX * BULLET_SPEED,
          vz: fwdZ * BULLET_SPEED,
          life: 1.35,
        });

        this.events.push({
          type: 'shoot',
          playerId: p.id,
          x: muzzleX,
          y: muzzleY,
          z: muzzleZ,
          yaw: p.yaw,
          color: p.color,
        });
      }
    }

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.life -= dt;

      if (b.life <= 0 || Math.abs(b.x) > HALF_W + 0.3 || Math.abs(b.z) > HALF_D + 0.3) {
        this.bullets.splice(i, 1);
        continue;
      }

      let hitWall = false;
      for (const obs of OBSTACLES) {
        if (b.y <= obs.height && pointInObstacleXZ(b.x, b.z, BULLET_RADIUS, obs)) {
          hitWall = true;
          this.events.push({ type: 'wall_hit', x: b.x, y: b.y, z: b.z, color: b.color });
          break;
        }
      }
      if (hitWall) {
        this.bullets.splice(i, 1);
        continue;
      }

      let hitPlayer = false;
      for (const p of this.players.values()) {
        if (!p.alive || p.id === b.ownerId) continue;
        const distXZ = Math.hypot(b.x - p.x, b.z - p.z);
        if (distXZ <= PLAYER_RADIUS + BULLET_RADIUS && b.y >= p.y && b.y <= p.y + PLAYER_HEIGHT) {
          p.hp = Math.max(0, p.hp - BULLET_DAMAGE);
          p.hitFlash = 0.22;
          const bLen = Math.hypot(b.vx, b.vz) || 1;
          p.x = clamp(p.x + (b.vx / bLen) * 0.22, -HALF_W + PLAYER_RADIUS, HALF_W - PLAYER_RADIUS);
          p.z = clamp(p.z + (b.vz / bLen) * 0.22, -HALF_D + PLAYER_RADIUS, HALF_D - PLAYER_RADIUS);

          this.events.push({
            type: 'hit',
            targetId: p.id,
            attackerId: b.ownerId,
            x: b.x,
            y: b.y,
            z: b.z,
            color: b.color,
          });

          if (p.hp <= 0) {
            p.alive = false;
            const attacker = this.players.get(b.ownerId);
            if (attacker) attacker.kills += 1;
            if (p.hasGun) {
              this.guns.push({
                id: `gun-${this.nextEntityId++}`,
                type: p.weaponType,
                x: p.x,
                y: 0.3,
                z: p.z,
                vy: 2.0,
                rotY: p.yaw,
                grounded: false,
              });
            }
            this.events.push({
              type: 'elim',
              targetId: p.id,
              targetName: p.name,
              attackerId: b.ownerId,
              x: p.x,
              y: p.y + 0.5,
              z: p.z,
              color: b.color,
            });
          }

          hitPlayer = true;
          break;
        }
      }
      if (hitPlayer) {
        this.bullets.splice(i, 1);
      }
    }

    if (this.phase === 'playing' && this.players.size >= 2) {
      const aliveList = [];
      for (const p of this.players.values()) {
        if (p.alive) aliveList.push(p);
      }
      if (aliveList.length <= 1) {
        this.phase = 'round_over';
        const winner = aliveList[0] || null;
        this.winnerId = winner ? winner.id : null;
        this.winnerName = winner ? winner.name : 'Draw';
        this.events.push({
          type: 'round_over',
          winnerId: this.winnerId,
          winnerName: this.winnerName,
          winnerColor: winner ? winner.color : '#ffffff',
        });
        if (winner && this.callbacks.onRoundWin) {
          this.callbacks.onRoundWin(winner.id);
        }
      }
    }
  }

  getStaticConfig() {
    return {
      arenaWidth: ARENA_WIDTH,
      arenaDepth: ARENA_DEPTH,
      obstacles: OBSTACLES,
    };
  }

  getState() {
    const players = [];
    for (const p of this.players.values()) {
      players.push({
        id: p.id,
        name: p.name,
        color: p.color,
        isBot: p.isBot,
        x: Number(p.x.toFixed(3)),
        y: Number(p.y.toFixed(3)),
        z: Number(p.z.toFixed(3)),
        yaw: Number(p.yaw.toFixed(3)),
        hp: p.hp,
        maxHp: p.maxHp,
        alive: p.alive,
        hasGun: p.hasGun,
        weaponType: p.weaponType,
        hitFlash: Number(p.hitFlash.toFixed(2)),
        animPhase: Number(p.animPhase.toFixed(2)),
        kills: p.kills,
      });
    }

    return {
      gameId: this.id,
      phase: this.phase,
      roundTime: Number(this.roundTime.toFixed(2)),
      winnerId: this.winnerId,
      winnerName: this.winnerName,
      players,
      guns: this.guns.map((g) => ({
        id: g.id,
        type: g.type,
        x: Number(g.x.toFixed(2)),
        y: Number(g.y.toFixed(2)),
        z: Number(g.z.toFixed(2)),
        rotY: Number(g.rotY.toFixed(2)),
        grounded: g.grounded,
      })),
      bullets: this.bullets.map((b) => ({
        id: b.id,
        color: b.color,
        x: Number(b.x.toFixed(2)),
        y: Number(b.y.toFixed(2)),
        z: Number(b.z.toFixed(2)),
        vx: Number(b.vx.toFixed(2)),
        vz: Number(b.vz.toFixed(2)),
      })),
      events: this.events,
    };
  }
}
