/**
 * Pixel Hoops 1-on-1 - Authoritative Game Engine (runs in Host's browser)
 *
 * Original half-court streetball for the tabletop: two players, one hoop,
 * first to 11. Offense dribbles with the stick, JUKE (jump button) gives a
 * quick burst, SHOOT is hold-to-jump / release-at-the-top. Driving in close
 * turns a shot into a dunk. Defense uses STEAL (shoot button) and BLOCK
 * (jump button). Anyone beyond the first two waits on the sideline and the
 * winner stays on for the next challenger.
 */

export const COURT_WIDTH = 12;
export const COURT_DEPTH = 8;
const HALF_W = COURT_WIDTH / 2;
const HALF_D = COURT_DEPTH / 2;

// Hoop sits near the far (-Z) baseline, facing +Z.
export const HOOP = { x: 0, z: -HALF_D + 0.95, rimY: 1.75, rimRadius: 0.27 };
export const BACKBOARD_Z = HOOP.z - 0.38;
export const THREE_PT_RADIUS = 3.6;
export const CHECK_SPOT = { x: 0, z: HOOP.z + 4.6 };
export const WIN_SCORE = 11;

const PLAYER_RADIUS = 0.3;
const MOVE_SPEED = 3.6;
const DRIBBLE_SPEED = 3.25;
const JUKE_SPEED = 6.2;
const JUKE_TIME = 0.22;
const JUKE_COOLDOWN = 0.9;
const FACE_TURN_SPEED = 14.0;
const GRAVITY = 19.5;
const BALL_GRAVITY = 9.8;
const BLOCK_JUMP_VY = 6.6;
const SHOT_JUMP_VY = 5.6;
const DUNK_RANGE = 1.55;
const MAX_SHOT_RANGE = 7.2;
const STEAL_RANGE = 0.85;
const STEAL_COOLDOWN = 0.75;
const STUMBLE_TIME = 0.45;
const PICKUP_RANGE = 0.55;
const CHECK_PAUSE = 1.1;
const BALL_RADIUS = 0.12;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function distToHoop(x, z) {
  return Math.hypot(x - HOOP.x, z - HOOP.z);
}

function blankInput() {
  return { moveX: 0, moveZ: 0, jump: false, shoot: false };
}

export class PixelHoopsEngine {
  /**
   * @param roster all players in the room; the first two play, the rest wait.
   * @param callbacks { onRoundWin(winnerId) }
   * @param rng optional deterministic random source (tests)
   */
  constructor(roster, callbacks = {}, rng = Math.random) {
    this.id = 'pixel-hoops';
    this.callbacks = callbacks;
    this.rng = rng;
    this.players = new Map();
    this.events = [];
    this.roundTime = 0;
    this.phase = 'tipoff';
    this.phaseTimer = CHECK_PAUSE + 0.4;
    this.winnerId = null;
    this.winnerName = null;
    this.ball = { state: 'held', ownerId: null, x: 0, y: 0.6, z: 0, vx: 0, vy: 0, vz: 0, flight: null, spin: 0 };
    this.offenseId = null;
    this.lastShot = null;
    this.nextOffenseId = null;

    const active = roster.slice(0, 2);
    const waiting = roster.slice(2);
    active.forEach((p, i) => this._addPlayer(p, i === 0 ? 'court' : 'court'));
    waiting.forEach((p) => this._addPlayer(p, 'bench'));

    const courtIds = this._courtIds();
    this.offenseId = courtIds[0] || null;
    this._setupCheck(this.offenseId, false);
    this.events.push({ type: 'round_start' });
  }

  // ---------------------------------------------------------------- roster

  _addPlayer(p, role) {
    const benchIndex = [...this.players.values()].filter((q) => q.role === 'bench').length;
    this.players.set(p.id, {
      id: p.id,
      name: p.name,
      color: p.color,
      isBot: !!p.isBot,
      role,
      score: 0,
      x: role === 'bench' ? -HALF_W + 0.6 + benchIndex * 0.8 : 0,
      y: 0,
      z: role === 'bench' ? HALF_D - 0.35 : 0,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: Math.PI,
      grounded: true,
      animPhase: 0,
      action: 'idle', // idle | dribble | shoot | dunk | block | steal | stumble | celebrate
      actionTimer: 0,
      jukeTimer: 0,
      jukeCooldown: 0,
      jukeX: 0,
      jukeZ: 0,
      stealCooldown: 0,
      shootHeld: false,
      shotStartT: 0,
      prevJump: false,
      prevShoot: false,
      input: blankInput(),
      bot: { reaction: 0, decide: 0, weave: this.rng() < 0.5 ? 1 : -1, holdUntil: 0 },
    });
  }

  _courtIds() {
    return [...this.players.values()].filter((p) => p.role === 'court').map((p) => p.id);
  }

  _opponentOf(id) {
    for (const p of this.players.values()) {
      if (p.role === 'court' && p.id !== id) return p;
    }
    return null;
  }

  addPlayerMidMatch(player) {
    if (this.players.has(player.id)) return;
    const courtCount = this._courtIds().length;
    this._addPlayer(player, courtCount < 2 ? 'court' : 'bench');
    if (courtCount < 2) {
      const np = this.players.get(player.id);
      np.x = 0;
      np.z = HOOP.z + 2.2;
      if (!this.offenseId) this._setupCheck(player.id, false);
    }
  }

  removePlayer(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    this.players.delete(playerId);
    if (p.role === 'court') {
      // Promote the first benched player.
      const next = [...this.players.values()].find((q) => q.role === 'bench');
      if (next) {
        next.role = 'court';
        next.x = 0;
        next.z = HOOP.z + 2.2;
      }
      if (this.ball.ownerId === playerId || this.offenseId === playerId) {
        const ids = this._courtIds();
        this._setupCheck(ids[0] || null, false);
      }
    }
  }

  renamePlayer(playerId, name) {
    const p = this.players.get(playerId);
    if (p) p.name = name;
  }

  handleInput(playerId, input) {
    const p = this.players.get(playerId);
    if (!p) return;
    let mx = Number(input.moveX) || 0;
    let mz = Number(input.moveZ) || 0;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    p.input = { moveX: mx, moveZ: mz, jump: Boolean(input.jump), shoot: Boolean(input.shoot) };
  }

  // -------------------------------------------------------------- flow

  _setupCheck(offenseId, announce = true) {
    this.offenseId = offenseId;
    this.phase = 'check';
    this.phaseTimer = CHECK_PAUSE;
    const off = this.players.get(offenseId);
    const def = off ? this._opponentOf(off.id) : null;
    if (off) {
      Object.assign(off, { x: CHECK_SPOT.x, z: CHECK_SPOT.z, y: 0, vx: 0, vy: 0, vz: 0, yaw: Math.PI, grounded: true, action: 'dribble', actionTimer: 0, shootHeld: false });
    }
    if (def) {
      Object.assign(def, { x: CHECK_SPOT.x, z: CHECK_SPOT.z - 1.3, y: 0, vx: 0, vy: 0, vz: 0, yaw: 0, grounded: true, action: 'idle', actionTimer: 0, shootHeld: false });
    }
    this.ball.state = 'held';
    this.ball.ownerId = offenseId;
    this.ball.flight = null;
    this.lastShot = null;
    if (announce && off) this.events.push({ type: 'check', offenseId, name: off.name });
  }

  _changePossession(newOwner) {
    this.offenseId = newOwner.id;
    this.ball.state = 'held';
    this.ball.ownerId = newOwner.id;
    this.ball.flight = null;
    newOwner.action = 'dribble';
  }

  // ---------------------------------------------------------------- bots

  _botInput(bot, dt) {
    const b = bot.bot;
    const opp = this._opponentOf(bot.id);
    const input = blankInput();
    b.decide -= dt;
    if (b.decide <= 0) {
      b.decide = 0.5 + this.rng() * 0.8;
      if (this.rng() < 0.4) b.weave *= -1;
    }
    const hasBall = this.ball.state === 'held' && this.ball.ownerId === bot.id;
    const toward = (tx, tz, scale = 1) => {
      const dx = tx - bot.x;
      const dz = tz - bot.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.08) return;
      input.moveX = (dx / d) * Math.min(1, d * 2) * scale;
      input.moveZ = (dz / d) * Math.min(1, d * 2) * scale;
    };

    if (this.phase !== 'live') {
      bot.input = input;
      return;
    }

    if (bot.shootHeld) {
      // Release near the top of the jump, with some human-like error.
      if (bot.vy <= (b.releaseVy ?? 0)) {
        input.shoot = false;
      } else {
        input.shoot = true;
      }
      bot.input = input;
      return;
    }

    if (hasBall) {
      const d = distToHoop(bot.x, bot.z);
      const defGap = opp ? Math.hypot(opp.x - bot.x, opp.z - bot.z) : 9;
      // Drive with a weave so the defender has to move.
      const sideX = HOOP.x + b.weave * 1.3;
      if (d < DUNK_RANGE * 0.95 && (defGap > 0.7 || this.rng() < 0.03)) {
        toward(HOOP.x, HOOP.z + 0.6);
        input.shoot = true;
      } else if (d > 1.8 && d < 5.4 && this.rng() < (defGap > 1.2 ? 0.06 : 0.012)) {
        input.shoot = true;
        b.releaseVy = (this.rng() - 0.5) * 2.2;
      } else if (d > 6.2) {
        toward(HOOP.x, HOOP.z + 3.0);
      } else {
        toward(d > 2.6 ? sideX : HOOP.x, HOOP.z + 0.4);
        if (defGap < 0.8 && bot.jukeCooldown <= 0 && this.rng() < 0.08) input.jump = true;
      }
    } else if (opp && this.ball.state === 'held' && this.ball.ownerId === opp.id) {
      // Defense: stay between the ball and the hoop.
      const hx = HOOP.x - opp.x;
      const hz = HOOP.z - opp.z;
      const hl = Math.hypot(hx, hz) || 1;
      const gap = Math.min(0.85, hl * 0.5);
      toward(opp.x + (hx / hl) * gap, opp.z + (hz / hl) * gap);
      const gapNow = Math.hypot(opp.x - bot.x, opp.z - bot.z);
      if (gapNow < STEAL_RANGE && bot.stealCooldown <= 0 && this.rng() < 0.035) input.shoot = true;
      if (opp.shootHeld || opp.action === 'dunk') {
        b.reaction += dt;
        if (b.reaction > 0.12 + this.rng() * 0.15 && gapNow < 1.6) input.jump = true;
      } else {
        b.reaction = 0;
      }
    } else if (this.ball.state === 'loose' || this.ball.state === 'flight') {
      // Chase the rebound.
      const tx = this.ball.state === 'flight' ? HOOP.x : this.ball.x;
      const tz = this.ball.state === 'flight' ? HOOP.z + 1.0 : this.ball.z;
      toward(tx, tz);
    }
    bot.input = input;
  }

  // ---------------------------------------------------------------- tick

  tick(dt) {
    this.events = [];
    this.roundTime += dt;

    if (this.phase === 'tipoff' || this.phase === 'check') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.phase = 'live';
        this.events.push({ type: 'ball_in' });
      }
    } else if (this.phase === 'scored') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) this._setupCheck(this.nextOffenseId);
    }

    for (const p of this.players.values()) {
      if (p.role !== 'court') {
        p.vx = 0;
        p.vz = 0;
        continue;
      }
      if (p.isBot) this._botInput(p, dt);
      this._updatePlayer(p, dt);
    }
    this._separatePlayers();
    this._updateBall(dt);

    for (const p of this.players.values()) {
      p.prevJump = p.input.jump;
      p.prevShoot = p.input.shoot;
    }
  }

  _updatePlayer(p, dt) {
    const input = p.input;
    const jumpPressed = input.jump && !p.prevJump;
    const shootPressed = input.shoot && !p.prevShoot;
    const shootReleased = !input.shoot && p.prevShoot;

    p.jukeCooldown = Math.max(0, p.jukeCooldown - dt);
    p.stealCooldown = Math.max(0, p.stealCooldown - dt);
    if (p.actionTimer > 0) {
      p.actionTimer -= dt;
      if (p.actionTimer <= 0 && (p.action === 'steal' || p.action === 'stumble' || p.action === 'celebrate')) {
        p.action = this.ball.ownerId === p.id && this.ball.state === 'held' ? 'dribble' : 'idle';
      }
    }

    const live = this.phase === 'live';
    const hasBall = this.ball.state === 'held' && this.ball.ownerId === p.id;
    const canMove = live && p.grounded && p.action !== 'stumble' && p.action !== 'dunk' && !p.shootHeld;

    // ---- Movement
    const mag = Math.hypot(input.moveX, input.moveZ);
    if (canMove) {
      if (p.jukeTimer > 0) {
        p.jukeTimer -= dt;
        p.vx = p.jukeX * JUKE_SPEED;
        p.vz = p.jukeZ * JUKE_SPEED;
      } else if (mag > 0.01) {
        const speed = (hasBall ? DRIBBLE_SPEED : MOVE_SPEED) * Math.min(1, mag);
        p.vx = (input.moveX / mag) * speed;
        p.vz = (input.moveZ / mag) * speed;
        const desiredYaw = Math.atan2(input.moveX, input.moveZ);
        const diff = normalizeAngle(desiredYaw - p.yaw);
        const step = FACE_TURN_SPEED * dt;
        p.yaw = normalizeAngle(p.yaw + clamp(diff, -step, step));
      } else {
        p.vx = 0;
        p.vz = 0;
      }
    } else if (p.grounded && p.action !== 'dunk') {
      p.vx *= Math.max(0, 1 - dt * 12);
      p.vz *= Math.max(0, 1 - dt * 12);
    }

    // Defenders and idle players square up to the ball while standing still.
    if (canMove && mag < 0.01 && !hasBall) {
      const desiredYaw = Math.atan2(this.ball.x - p.x, this.ball.z - p.z);
      const diff = normalizeAngle(desiredYaw - p.yaw);
      p.yaw = normalizeAngle(p.yaw + clamp(diff, -6 * dt, 6 * dt));
    }

    // ---- Actions
    if (live && hasBall) {
      if (jumpPressed && p.grounded && p.jukeCooldown <= 0 && !p.shootHeld) {
        let jx = input.moveX;
        let jz = input.moveZ;
        const jl = Math.hypot(jx, jz);
        if (jl < 0.2) { jx = Math.sin(p.yaw); jz = Math.cos(p.yaw); } else { jx /= jl; jz /= jl; }
        p.jukeX = jx;
        p.jukeZ = jz;
        p.jukeTimer = JUKE_TIME;
        p.jukeCooldown = JUKE_COOLDOWN;
        this.events.push({ type: 'juke', playerId: p.id, x: p.x, z: p.z });
      }
      if (shootPressed && p.grounded) {
        const d = distToHoop(p.x, p.z);
        if (d <= DUNK_RANGE) this._startDunk(p);
        else this._startJumpShot(p);
      }
    } else if (live && !hasBall) {
      if (jumpPressed && p.grounded && p.action !== 'stumble') {
        p.vy = BLOCK_JUMP_VY;
        p.grounded = false;
        p.action = 'block';
        this.events.push({ type: 'jump', playerId: p.id, x: p.x, z: p.z });
      }
      if (shootPressed && p.grounded && p.stealCooldown <= 0 && p.action !== 'stumble') {
        this._attemptSteal(p);
      }
    }

    if (p.shootHeld && (shootReleased || p.vy < -2.6 || !live)) {
      this._releaseJumpShot(p);
    }

    // ---- Integrate
    p.x = clamp(p.x + p.vx * dt, -HALF_W + PLAYER_RADIUS, HALF_W - PLAYER_RADIUS);
    p.z = clamp(p.z + p.vz * dt, -HALF_D + PLAYER_RADIUS, HALF_D - PLAYER_RADIUS);
    // Keep players from walking through the hoop stanchion.
    if (p.z < BACKBOARD_Z + 0.25 && Math.abs(p.x - HOOP.x) < 0.9) p.z = BACKBOARD_Z + 0.25;

    if (!p.grounded || p.vy > 0) {
      p.vy -= GRAVITY * (p.action === 'dunk' ? 0.85 : 1) * dt;
      p.y += p.vy * dt;
      if (p.y <= 0) {
        p.y = 0;
        p.vy = 0;
        p.grounded = true;
        if (p.action === 'block' || p.action === 'shoot' || p.action === 'dunk') {
          p.action = this.ball.ownerId === p.id && this.ball.state === 'held' ? 'dribble' : 'idle';
        }
        this.events.push({ type: 'land', playerId: p.id, x: p.x, z: p.z });
      }
    }

    const ground = Math.hypot(p.vx, p.vz);
    if (ground > 0.15 && p.grounded) p.animPhase += dt * ground * 3.2;
    else if (hasBall) p.animPhase += dt * 6; // keep the dribble bouncing
  }

  _separatePlayers() {
    const court = [...this.players.values()].filter((p) => p.role === 'court');
    if (court.length < 2) return;
    const [a, b] = court;
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    const d = Math.hypot(dx, dz);
    const min = PLAYER_RADIUS * 2;
    if (d > 0.001 && d < min && Math.abs(a.y - b.y) < 0.9) {
      const push = (min - d) * 0.5;
      a.x += (dx / d) * push;
      a.z += (dz / d) * push;
      b.x -= (dx / d) * push;
      b.z -= (dz / d) * push;
    }
  }

  _startJumpShot(p) {
    p.shootHeld = true;
    p.action = 'shoot';
    p.vy = SHOT_JUMP_VY;
    p.grounded = false;
    p.vx *= 0.25;
    p.vz *= 0.25;
    p.yaw = Math.atan2(HOOP.x - p.x, HOOP.z - p.z);
    this.events.push({ type: 'shot_rise', playerId: p.id, x: p.x, z: p.z });
  }

  _releaseJumpShot(p) {
    p.shootHeld = false;
    const d = distToHoop(p.x, p.z);
    const opp = this._opponentOf(p.id);

    // Timing: 1.0 = released right at the top of the jump.
    const timing = clamp(1 - Math.abs(p.vy) / 4.2, 0, 1);
    let pct = d < 2.2 ? 0.72 : d < THREE_PT_RADIUS ? 0.58 : 0.46;
    pct -= Math.max(0, d - THREE_PT_RADIUS) * 0.09;
    pct += (timing - 0.6) * 0.55;
    let contest = 0;
    if (opp) {
      const od = Math.hypot(opp.x - p.x, opp.z - p.z);
      contest = clamp((1.6 - od) / 1.6, 0, 1);
      if (!opp.grounded) contest *= 1.35;
      pct -= contest * 0.32;
    }
    if (d > MAX_SHOT_RANGE) pct = 0.02;
    pct = clamp(pct, 0.02, 0.95);

    const made = this.rng() < pct;
    const points = d > THREE_PT_RADIUS ? 3 : 2;
    const hx = Math.sin(p.yaw);
    const hz = Math.cos(p.yaw);
    const start = { x: p.x + hx * 0.25, y: p.y + 1.25, z: p.z + hz * 0.25 };
    this._launchBall(p, start, made, points, false, { timing, contest });
    this.events.push({ type: 'shot', playerId: p.id, timing: Number(timing.toFixed(2)), points, x: start.x, y: start.y, z: start.z });
  }

  _startDunk(p) {
    p.action = 'dunk';
    p.vy = 6.8;
    p.grounded = false;
    const dx = HOOP.x - p.x;
    const dz = HOOP.z + 0.18 - p.z;
    const t = 0.62;
    p.vx = dx / t;
    p.vz = dz / t;
    p.yaw = Math.atan2(dx, dz);
    this.ball.state = 'dunk';
    this.ball.ownerId = p.id;
    this.ball.flight = { t: 0, dur: t, shooterId: p.id, points: 2, dunk: true };
    this.lastShot = { shooterId: p.id, points: 2 };
    this.events.push({ type: 'dunk_start', playerId: p.id, x: p.x, z: p.z });
  }

  _launchBall(p, start, made, points, dunk, meta) {
    let target;
    if (made) {
      target = { x: HOOP.x, y: HOOP.rimY + 0.02, z: HOOP.z };
    } else {
      // Clank: aim for a point on the rim (front, back or side).
      const a = this.rng() * Math.PI * 2;
      const r = HOOP.rimRadius * (0.95 + this.rng() * 0.35);
      target = { x: HOOP.x + Math.sin(a) * r, y: HOOP.rimY + 0.04, z: HOOP.z + Math.cos(a) * r };
    }
    const horiz = Math.hypot(target.x - start.x, target.z - start.z);
    const dur = 0.62 + horiz * 0.085;
    const vx = (target.x - start.x) / dur;
    const vz = (target.z - start.z) / dur;
    const vy = (target.y - start.y + 0.5 * BALL_GRAVITY * dur * dur) / dur;
    Object.assign(this.ball, {
      state: 'flight',
      ownerId: null,
      x: start.x,
      y: start.y,
      z: start.z,
      vx,
      vy,
      vz,
      flight: { t: 0, dur, made, points, shooterId: p.id, dunk, blockable: 0.32, ...meta },
    });
    this.lastShot = { shooterId: p.id, points };
  }

  _attemptSteal(p) {
    p.stealCooldown = STEAL_COOLDOWN;
    p.action = 'steal';
    p.actionTimer = 0.28;
    this.events.push({ type: 'swipe', playerId: p.id, x: p.x, z: p.z });
    if (this.ball.state !== 'held' || !this.ball.ownerId) return;
    const handler = this.players.get(this.ball.ownerId);
    if (!handler || handler.id === p.id || handler.shootHeld) return;
    const d = Math.hypot(handler.x - p.x, handler.z - p.z);
    if (d > STEAL_RANGE) {
      return;
    }
    // Reaching at a moving dribbler from behind is harder; a standing one is easier.
    const handlerSpeed = Math.hypot(handler.vx, handler.vz);
    const toThiefYaw = Math.atan2(p.x - handler.x, p.z - handler.z);
    const facing = Math.cos(normalizeAngle(toThiefYaw - handler.yaw)); // 1 = thief in front
    let chance = 0.26 + (handlerSpeed < 0.5 ? 0.16 : 0) + facing * 0.08;
    if (handler.jukeTimer > 0) chance = 0.04;
    if (this.rng() < chance) {
      this.events.push({ type: 'steal', playerId: p.id, fromId: handler.id, x: handler.x, z: handler.z });
      this._changePossession(p);
      handler.action = 'stumble';
      handler.actionTimer = STUMBLE_TIME;
    } else if (this.rng() < 0.35) {
      // Overreached.
      p.action = 'stumble';
      p.actionTimer = STUMBLE_TIME;
    }
  }

  _updateBall(dt) {
    const ball = this.ball;
    ball.spin += dt * 9;

    if (ball.state === 'held') {
      const owner = this.players.get(ball.ownerId);
      if (!owner) return;
      const hx = Math.sin(owner.yaw);
      const hz = Math.cos(owner.yaw);
      const rx = -hz;
      const rz = hx;
      if (owner.shootHeld || owner.action === 'shoot') {
        ball.x = owner.x + hx * 0.18;
        ball.y = owner.y + 1.25;
        ball.z = owner.z + hz * 0.18;
      } else {
        // Dribble: bounce at the right hand.
        const bounce = Math.abs(Math.sin(owner.animPhase * 1.6));
        ball.x = owner.x + hx * 0.28 + rx * 0.2;
        ball.z = owner.z + hz * 0.28 + rz * 0.2;
        ball.y = owner.y + BALL_RADIUS + bounce * 0.48;
      }
      return;
    }

    if (ball.state === 'dunk') {
      const f = ball.flight;
      const owner = this.players.get(f.shooterId);
      f.t += dt;
      if (owner) {
        ball.x = owner.x + Math.sin(owner.yaw) * 0.22;
        ball.z = owner.z + Math.cos(owner.yaw) * 0.22;
        ball.y = owner.y + 1.35 + Math.min(0.35, f.t * 0.8);
      }
      const opp = owner ? this._opponentOf(owner.id) : null;
      if (opp && !opp.grounded && !f.blockRolled && f.t < f.dur * 0.85) {
        const od = Math.hypot(opp.x - ball.x, opp.z - ball.z);
        if (od < 0.6 && opp.y + 1.5 > ball.y - 0.3) {
          // A well-timed rejection at the rim stops a dunk about a third of the time.
          f.blockRolled = true;
          if (this.rng() < 0.35) {
            this._block(opp, owner);
            return;
          }
        }
      }
      if (f.t >= f.dur) {
        if (owner) {
          owner.vx = 0;
          owner.vz = 0;
          owner.vy = Math.min(owner.vy, -0.5); // hang then drop
        }
        ball.state = 'flight';
        ball.x = HOOP.x;
        ball.z = HOOP.z;
        ball.y = HOOP.rimY + 0.05;
        ball.vx = 0;
        ball.vz = 0;
        ball.vy = -2.5;
        ball.flight = { t: 0, dur: 0, made: true, points: 2, shooterId: f.shooterId, dunk: true, sunk: true };
        this.events.push({ type: 'rim_shake', x: HOOP.x, z: HOOP.z });
        this._score(f.shooterId, 2, true);
      }
      return;
    }

    if (ball.state === 'flight') {
      const f = ball.flight;
      f.t += dt;
      ball.vy -= BALL_GRAVITY * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      ball.z += ball.vz * dt;

      if (f.sunk) {
        // Falling through the net, then hand off to the floor bounce.
        if (ball.y < HOOP.rimY - 0.55) {
          ball.state = 'loose';
          ball.flight = null;
        }
        return;
      }

      // Blocks while the ball is still rising off the shooter's hand.
      if (f.t < f.blockable) {
        const shooter = this.players.get(f.shooterId);
        const opp = shooter ? this._opponentOf(shooter.id) : null;
        if (opp && !opp.grounded) {
          const handY = opp.y + 1.45;
          const dist = Math.hypot(opp.x - ball.x, opp.z - ball.z);
          if (dist < 0.62 && Math.abs(handY - ball.y) < 0.5) {
            this._block(opp, shooter);
            return;
          }
        }
      }

      if (f.t >= f.dur) {
        if (f.made) {
          ball.x = HOOP.x;
          ball.z = HOOP.z;
          ball.vx = 0;
          ball.vz = 0;
          ball.vy = -1.8;
          f.sunk = true;
          this._score(f.shooterId, f.points, false);
        } else {
          // Off the rim.
          const ox = ball.x - HOOP.x;
          const oz = ball.z - HOOP.z;
          const ol = Math.hypot(ox, oz) || 1;
          const kick = 1.6 + this.rng() * 1.8;
          ball.vx = (ox / ol) * kick + (this.rng() - 0.5) * 1.2;
          ball.vz = Math.abs(oz / ol) * kick + 0.6 + this.rng() * 0.8; // off the back board, out to the court
          ball.vy = 2.2 + this.rng() * 1.5;
          ball.state = 'loose';
          ball.flight = null;
          this.events.push({ type: 'clank', x: ball.x, y: ball.y, z: ball.z });
        }
      }
      return;
    }

    if (ball.state === 'loose') {
      ball.vy -= BALL_GRAVITY * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      ball.z += ball.vz * dt;
      if (ball.y <= BALL_RADIUS) {
        ball.y = BALL_RADIUS;
        if (Math.abs(ball.vy) > 0.8) {
          ball.vy = -ball.vy * 0.62;
          this.events.push({ type: 'bounce', x: ball.x, z: ball.z });
        } else {
          ball.vy = 0;
        }
        ball.vx *= 0.9;
        ball.vz *= 0.9;
      }
      if (Math.abs(ball.x) > HALF_W - BALL_RADIUS) {
        ball.x = clamp(ball.x, -HALF_W + BALL_RADIUS, HALF_W - BALL_RADIUS);
        ball.vx *= -0.6;
      }
      if (ball.z > HALF_D - BALL_RADIUS || ball.z < -HALF_D + BALL_RADIUS) {
        ball.z = clamp(ball.z, -HALF_D + BALL_RADIUS, HALF_D - BALL_RADIUS);
        ball.vz *= -0.6;
      }
      if (this.phase !== 'live') return;

      // Pick up a loose ball (rebound / block recovery).
      let best = null;
      let bestD = PICKUP_RANGE;
      for (const p of this.players.values()) {
        if (p.role !== 'court' || p.action === 'stumble') continue;
        const d = Math.hypot(p.x - ball.x, p.z - ball.z);
        if (d < bestD && ball.y < p.y + 1.9) {
          best = p;
          bestD = d;
        }
      }
      if (best) {
        const wasOffense = best.id === this.offenseId;
        this.events.push({ type: 'rebound', playerId: best.id, offensive: wasOffense, x: ball.x, z: ball.z });
        if (wasOffense) {
          this._changePossession(best);
        } else {
          // Change of possession: take it back to the check spot.
          this._setupCheck(best.id);
        }
      }
    }
  }

  _block(blocker, shooter) {
    const ball = this.ball;
    const dx = ball.x - blocker.x;
    const dz = ball.z - blocker.z;
    const dl = Math.hypot(dx, dz) || 1;
    ball.state = 'loose';
    ball.flight = null;
    ball.ownerId = null;
    ball.vx = (dx / dl) * 3.2 + (this.rng() - 0.5);
    ball.vz = (dz / dl) * 3.2 + 1.2;
    ball.vy = 1.0;
    if (shooter) {
      shooter.shootHeld = false;
      shooter.action = 'stumble';
      shooter.actionTimer = 0.3;
      if (!shooter.grounded) { shooter.vx = 0; shooter.vz = 0; }
    }
    this.events.push({ type: 'block', playerId: blocker.id, x: ball.x, y: ball.y, z: ball.z });
  }

  _score(shooterId, points, dunk) {
    const shooter = this.players.get(shooterId);
    if (!shooter) return;
    shooter.score += points;
    shooter.action = 'celebrate';
    shooter.actionTimer = 0.9;
    const opp = this._opponentOf(shooterId);
    this.events.push({
      type: 'score',
      playerId: shooterId,
      name: shooter.name,
      color: shooter.color,
      points,
      dunk,
      score: shooter.score,
      x: HOOP.x,
      y: HOOP.rimY,
      z: HOOP.z,
    });
    if (shooter.score >= WIN_SCORE) {
      this.phase = 'round_over';
      this.winnerId = shooter.id;
      this.winnerName = shooter.name;
      this.events.push({ type: 'round_over', winnerId: shooter.id, winnerName: shooter.name, winnerColor: shooter.color });
      if (this.callbacks.onRoundWin) this.callbacks.onRoundWin(shooter.id);
      return;
    }
    // Loser of the point checks it up next.
    this.phase = 'scored';
    this.phaseTimer = dunk ? 1.4 : 1.2;
    this.nextOffenseId = opp ? opp.id : shooterId;
  }

  // ---------------------------------------------------------------- output

  getStaticConfig() {
    return {
      courtWidth: COURT_WIDTH,
      courtDepth: COURT_DEPTH,
      hoop: HOOP,
      backboardZ: BACKBOARD_Z,
      threePtRadius: THREE_PT_RADIUS,
      checkSpot: CHECK_SPOT,
      winScore: WIN_SCORE,
    };
  }

  getState() {
    const r = (v, n = 3) => Number(v.toFixed(n));
    const players = [];
    for (const p of this.players.values()) {
      players.push({
        id: p.id,
        name: p.name,
        color: p.color,
        isBot: p.isBot,
        role: p.role,
        score: p.score,
        x: r(p.x),
        y: r(p.y),
        z: r(p.z),
        yaw: r(p.yaw),
        action: p.action,
        hasBall: this.ball.ownerId === p.id && (this.ball.state === 'held' || this.ball.state === 'dunk'),
        onOffense: this.offenseId === p.id,
        animPhase: r(p.animPhase, 2),
        speed: r(Math.hypot(p.vx, p.vz), 2),
      });
    }
    const b = this.ball;
    return {
      gameId: this.id,
      phase: this.phase,
      roundTime: r(this.roundTime, 2),
      winnerId: this.winnerId,
      winnerName: this.winnerName,
      offenseId: this.offenseId,
      players,
      ball: { state: b.state, ownerId: b.ownerId, x: r(b.x), y: r(b.y), z: r(b.z), spin: r(b.spin % (Math.PI * 2), 2) },
      events: this.events,
    };
  }
}
