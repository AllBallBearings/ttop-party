/**
 * Panda Ramen Rumble - Authoritative Turn-Based Tabletop Strategy Engine
 *
 * A Worms-style tabletop AR turn-based strategy game set on a coffee-table
 * diorama of mossy rocky peaks, ledges, bamboo groves, wooden zoo climbing
 * structures, and cozy hillside dens.
 *
 * Two teams of 4 fat-and-happy panda bears (RED vs BLU) lounge across the
 * landscape with their cherished bowls of ramen. On each turn, the active
 * panda clumsily hoists a whimsical weapon from the 6-slice wheel (starting
 * on the Rocket Launcher), aims across the terrain, and launches cartoon
 * Fall-Guys-style volleys to knock loose rival bowls of ramen and send
 * opposing pandas tumbling and rolling back to their den for a cozy nap.
 */

export const BOARD_WIDTH = 15.6;
export const BOARD_DEPTH = 10.6;
export const HALF_W = BOARD_WIDTH / 2;
export const HALF_D = BOARD_DEPTH / 2;

export const BOT_DIFFICULTIES = ['easy', 'medium', 'hard'];
export const DEFAULT_BOT_DIFFICULTY = 'medium';

export function normalizeBotDifficulty(level) {
  const key = String(level || '').toLowerCase();
  return BOT_DIFFICULTIES.includes(key) ? key : DEFAULT_BOT_DIFFICULTY;
}

export const TURN_DURATION = 28;
export const MOVE_STAMINA_MAX = 3.2; // seconds of waddling per turn
export const GRAVITY = 13.5;
export const PANDA_RADIUS = 0.48;
export const MAX_RAMEN_HP = 100;

export const ARC_ANGLES = [
  { id: 'low', label: 'FLAT', deg: 26, rad: (26 * Math.PI) / 180 },
  { id: 'mid', label: 'ARC', deg: 44, rad: (44 * Math.PI) / 180 },
  { id: 'high', label: 'LOB', deg: 62, rad: (62 * Math.PI) / 180 },
];

export const WEAPONS = [
  {
    id: 'rocket-launcher',
    name: 'rocket launcher',
    displayName: 'Rocket Launcher',
    color: '#f7e231',
    sliceIndex: 0,
    speed: 13.2,
    gravityScale: 0.68,
    damage: 68,
    radius: 2.5,
    knockback: 8.6,
    upKnock: 5.2,
    bounces: 0,
    burstCount: 1,
    clusterCount: 0,
    desc: 'Classic goofy rocket with bouncy knockback',
  },
  {
    id: 'ramen-bomb',
    name: 'ramen bomb',
    displayName: 'Ramen Bomb',
    color: '#f28c28',
    sliceIndex: 1,
    speed: 11.4,
    gravityScale: 1.0,
    damage: 76,
    radius: 3.15,
    knockback: 7.4,
    upKnock: 4.8,
    bounces: 0,
    burstCount: 1,
    clusterCount: 0,
    desc: 'Steaming mega-ramen lob with huge broth splash',
  },
  {
    id: 'bouncing-tire',
    name: 'bouncing tire',
    displayName: 'Bouncing Tire',
    color: '#f5c724',
    sliceIndex: 2,
    speed: 11.8,
    gravityScale: 1.05,
    damage: 56,
    radius: 2.2,
    knockback: 10.6,
    upKnock: 5.8,
    bounces: 3,
    burstCount: 1,
    clusterCount: 0,
    desc: 'Bouncy zoo tire that bonks across hills 3 times',
  },
  {
    id: 'bamboo-bazooka',
    name: 'bamboo bazooka',
    displayName: 'Bamboo Bazooka',
    color: '#3895e8',
    sliceIndex: 3,
    speed: 12.6,
    gravityScale: 0.78,
    damage: 36,
    radius: 1.85,
    knockback: 6.6,
    upKnock: 4.5,
    bounces: 0,
    burstCount: 3,
    clusterCount: 0,
    desc: 'Triple whistling bamboo volley in a fan spread',
  },
  {
    id: 'dumpling-drop',
    name: 'dumpling drop',
    displayName: 'Dumpling Drop',
    color: '#a54bd6',
    sliceIndex: 4,
    speed: 11.5,
    gravityScale: 0.96,
    damage: 34,
    radius: 1.8,
    knockback: 6.2,
    upKnock: 4.4,
    bounces: 0,
    burstCount: 1,
    clusterCount: 4,
    desc: 'Giant taro bao that pops into 4 mini dumplings',
  },
  {
    id: 'melon-cannon',
    name: 'melon cannon',
    displayName: 'Melon Cannon',
    color: '#59c747',
    sliceIndex: 5,
    speed: 12.0,
    gravityScale: 0.9,
    damage: 60,
    radius: 2.65,
    knockback: 12.6,
    upKnock: 7.4,
    bounces: 1,
    burstCount: 1,
    clusterCount: 0,
    desc: 'Mega bouncy watermelon that sends pandas soaring',
  },
];

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

export const TEAMS = [
  {
    id: 0,
    key: 'red',
    name: 'Red Team',
    color: '#d94e3b',
    accent: '#f7c948',
    den: { x: -4.2, y: 0.35, z: 3.35, yaw: -0.45 },
  },
  {
    id: 1,
    key: 'blue',
    name: 'Blue Team',
    color: '#3b7fb8',
    accent: '#7dd3fc',
    den: { x: 2.35, y: 0.58, z: -1.72, yaw: 0.18 },
  },
];

// Walkable / decorative wooden zoo structures (mirrors the reference diorama)
export const ZOO_STRUCTURES = [
  {
    id: 'zoo-deck-upper',
    type: 'deck',
    x: -0.55,
    z: -3.25,
    halfW: 0.95,
    halfD: 0.62,
    topY: 1.72,
    rotY: -0.1,
  },
  {
    id: 'zoo-deck-lower',
    type: 'deck',
    x: -1.78,
    z: -2.42,
    halfW: 0.68,
    halfD: 0.52,
    topY: 1.05,
    rotY: -0.1,
    hasLadder: true,
  },
  {
    id: 'nw-zoo-table',
    type: 'table',
    x: -5.35,
    z: -2.05,
    halfW: 0.55,
    halfD: 0.44,
    topY: 2.15,
    rotY: 0.25,
  },
  {
    id: 'east-bridge',
    type: 'bridge',
    x: 4.15,
    z: -1.55,
    halfW: 0.88,
    halfD: 0.46,
    topY: 1.08,
    rotY: 0.32,
  },
  {
    id: 'sw-den-bridge',
    type: 'bridge',
    x: -4.25,
    z: 2.85,
    halfW: 0.82,
    halfD: 0.48,
    topY: 1.12,
    rotY: 0.28,
  },
];

// Scattered lounge boulders in the meadow (for cozy sitting & physics bounce)
export const LOUNGE_BOULDERS = [
  { id: 'boulder-center-w', x: -1.95, z: 0.65, r: 0.58, h: 0.52 },
  { id: 'boulder-se', x: 3.65, z: 1.95, r: 0.68, h: 0.56 },
  { id: 'boulder-sw-front', x: -5.35, z: 3.95, r: 0.66, h: 0.72 },
  { id: 'boulder-sw-mid', x: -3.1, z: 3.55, r: 0.75, h: 0.85 },
];

// Bamboo cluster locations shared so engine/renderer stay harmonious
export const BAMBOO_GROVES = [
  { x: -6.7, z: -1.5, count: 6, height: 2.3 },
  { x: -3.55, z: -2.95, count: 5, height: 2.1 },
  { x: -5.0, z: -3.95, count: 5, height: 2.4 },
  { x: 4.95, z: -2.9, count: 5, height: 2.0 },
  { x: 0.85, z: 3.3, count: 5, height: 2.1 },
  { x: -6.45, z: 4.15, count: 6, height: 2.2 },
  { x: 6.45, z: 1.85, count: 4, height: 1.85 },
];

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Deterministic multi-feature terrain heightfield matching the reference diorama:
 * - NW dramatic rocky peak + broad mossy upper terrace
 * - NE terraced rocky mound with summit perch & Blue Team den
 * - East overhanging cliff ledge + back spire
 * - SW low mossy outcrops + Red Team den
 * - Gentle rolling grassy valley floor in the center
 */
export function getTerrainHeight(x, z) {
  // Base gentle valley undulation
  let h = 0.14
    + 0.08 * Math.sin(x * 0.42 + 0.5) * Math.cos(z * 0.48 - 0.3)
    + 0.04 * Math.cos(x * 0.9 - z * 0.7);

  // Helper: smooth rounded plateau / rock mesa
  const plateau = (cx, cz, rx, rz, height, sharpness = 2.6) => {
    const dx = (x - cx) / rx;
    const dz = (z - cz) / rz;
    const d = Math.hypot(dx, dz);
    if (d >= 1.35) return 0;
    const f = 1 - smoothstep(0.42, 1.18, d);
    return height * Math.pow(f, sharpness * 0.42);
  };

  // Helper: sharper rocky spire peak
  const spire = (cx, cz, rx, rz, height) => {
    const dx = (x - cx) / rx;
    const dz = (z - cz) / rz;
    const d = Math.hypot(dx, dz);
    if (d >= 1.25) return 0;
    const f = Math.max(0, 1 - d * 0.92);
    return height * Math.pow(f, 1.65);
  };

  // 1. NW Broad Mossy Terrace (where Bao & zoo feeding table sit)
  h = Math.max(h, plateau(-4.95, -1.35, 2.35, 1.95, 1.38, 2.2));
  h = Math.max(h, plateau(-3.85, -1.75, 1.65, 1.45, 1.26, 2.4));

  // 2. NW Tall Dramatic Rocky Peak (back-left spire)
  h = Math.max(h, spire(-6.25, -3.55, 1.95, 1.65, 4.15));
  h = Math.max(h, spire(-5.15, -3.65, 1.45, 1.35, 2.75));
  h = Math.max(h, spire(-6.65, -2.0, 1.25, 1.45, 2.45));

  // 3. NE Rounded Rocky Mound & Summit Peak (Blue Team den sits in front face)
  h = Math.max(h, plateau(2.15, -2.55, 2.55, 1.85, 0.95, 2.0));
  h = Math.max(h, plateau(2.35, -3.35, 1.75, 1.35, 2.25, 2.4));
  h = Math.max(h, spire(2.55, -3.85, 1.2, 0.95, 2.55));

  // 4. East Overhang Outcrop & Right Spire (where Matcha lounges high up)
  h = Math.max(h, plateau(5.65, -0.35, 1.78, 1.75, 1.52, 2.5));
  h = Math.max(h, spire(6.65, -1.75, 1.35, 1.45, 3.45));
  h = Math.max(h, plateau(6.15, 0.95, 1.25, 1.1, 0.78, 2.2));

  // 5. SW Rocky Outcrops framing the Red Team Den & bridge
  h = Math.max(h, plateau(-5.55, 3.55, 1.45, 1.2, 1.05, 2.4));
  h = Math.max(h, plateau(-3.05, 3.35, 1.35, 1.25, 1.08, 2.3));

  // 6. Subtle natural rim edges so the diorama feels carved into the wood tray
  const edgeX = smoothstep(HALF_W - 0.55, HALF_W, Math.abs(x));
  const edgeZ = smoothstep(HALF_D - 0.55, HALF_D, Math.abs(z));
  const rimDrop = Math.max(edgeX, edgeZ);
  h = h * (1 - rimDrop * 0.45) + 0.08 * rimDrop;

  return Math.max(0.08, h);
}

/**
 * Returns the playable surface height at (x, z), including wooden zoo decks
 * and bridges when the entity is at or above them (or climbing via ladder).
 */
export function getSurfaceHeight(x, z, currentY = 99) {
  let h = getTerrainHeight(x, z);
  for (const s of ZOO_STRUCTURES) {
    if (s.type === 'table') continue; // table is a prop for ramen, not main walk floor
    const dx = x - s.x;
    const dz = z - s.z;
    const cos = Math.cos(-s.rotY);
    const sin = Math.sin(-s.rotY);
    const lx = dx * cos + dz * sin;
    const lz = -dx * sin + dz * cos;
    if (Math.abs(lx) <= s.halfW + 0.16 && Math.abs(lz) <= s.halfD + 0.16) {
      if (currentY >= s.topY - 0.55) {
        h = Math.max(h, s.topY);
      }
    }
  }
  return h;
}

// Initial spread-out positions for the 2 teams of 4 pandas (matching reference image!)
const PANDA_SPAWNS = [
  // Team 0 (RED) — 4 pandas
  {
    id: 'p-red-0',
    name: 'Mochi',
    team: 0,
    slot: 0,
    x: -4.25,
    z: 1.15,
    yaw: 1.12, // Facing across the board toward Blue Team!
    idlePose: 'eat_ramen',
    ramenPlacement: 'beside',
  },
  {
    id: 'p-red-1',
    name: 'Bao',
    team: 0,
    slot: 1,
    x: -4.45,
    z: -1.15,
    yaw: 0.72,
    idlePose: 'bamboo_sit',
    ramenPlacement: 'beside',
  },
  {
    id: 'p-red-2',
    name: 'Yuzu',
    team: 0,
    slot: 2,
    x: -1.15,
    z: 0.72,
    yaw: 0.45,
    idlePose: 'eat_ramen',
    ramenPlacement: 'paws',
  },
  {
    id: 'p-red-3',
    name: 'Sesame',
    team: 0,
    slot: 3,
    x: -1.35,
    z: 3.15,
    yaw: 0.35,
    idlePose: 'lazy_roll',
    ramenPlacement: 'beside',
  },

  // Team 1 (BLUE) — 4 pandas
  {
    id: 'p-blue-0',
    name: 'Dumpling',
    team: 1,
    slot: 0,
    x: 2.35,
    z: -3.28, // Perched high up on the NE summit peak!
    yaw: -0.25,
    idlePose: 'bamboo_sit',
    ramenPlacement: 'beside',
  },
  {
    id: 'p-blue-1',
    name: 'Matcha',
    team: 1,
    slot: 1,
    x: 5.55,
    z: -0.28, // Lounging on the East overhanging outcrop!
    yaw: -1.08,
    idlePose: 'bamboo_sit',
    ramenPlacement: 'beside',
  },
  {
    id: 'p-blue-2',
    name: 'Noodle',
    team: 1,
    slot: 2,
    x: 1.48,
    z: -0.15, // Sitting in the central meadow eating bamboo
    yaw: -0.65,
    idlePose: 'bamboo_sit',
    ramenPlacement: 'beside',
  },
  {
    id: 'p-blue-3',
    name: 'Tofu',
    team: 1,
    slot: 3,
    x: 2.88,
    z: 2.05, // Lounging back with ramen bowl resting on big round belly!
    yaw: -0.82,
    idlePose: 'belly_ramen',
    ramenPlacement: 'belly',
  },
];

function blankInput() {
  return {
    moveX: 0,
    moveZ: 0,
    jump: false,
    shoot: false,
    weapon: null,
    arcIndex: null,
    arcCycle: false,
  };
}

const BOT_PROFILES = {
  easy: {
    aimErrorRad: 0.24,
    powerError: 0.16,
    thinkDelay: 1.15,
    chargeDuration: 0.95,
    windComp: 0.35,
  },
  medium: {
    aimErrorRad: 0.1,
    powerError: 0.08,
    thinkDelay: 0.9,
    chargeDuration: 0.85,
    windComp: 0.72,
  },
  hard: {
    aimErrorRad: 0.035,
    powerError: 0.035,
    thinkDelay: 0.7,
    chargeDuration: 0.75,
    windComp: 0.96,
  },
};

export class PandaRamenEngine {
  constructor(roster = [], callbacks = {}, rng = Math.random, options = {}) {
    this.callbacks = callbacks;
    this.rng = rng;
    this.botDifficulty = normalizeBotDifficulty(options.botDifficulty);

    this.roundTime = 0;
    this.phase = 'aim'; // 'aim' | 'firing' | 'settling' | 'round_over'
    this.phaseTimer = 0;
    this.turnNumber = 1;
    this.turnTimeLeft = TURN_DURATION;
    this.activeTeam = 0;
    this.teamTurnCursor = [0, 0];
    this.teamPlayerCursor = [0, 0];

    this.winnerTeam = null;
    this.winnerId = null;
    this.winnerName = null;

    this.windX = 0;
    this.windZ = 0;

    // Players from the suite roster, mapped to Team 0 (RED) and Team 1 (BLU)
    this.players = [];
    this.inputs = new Map();
    this.prevShoot = new Map();
    this.prevJump = new Map();

    // 8 Pandas (4 per team)
    this.pandas = [];
    this.activePandaId = null;
    this.activeControllerId = null;
    this.selectedWeaponId = 'rocket-launcher';
    this.arcIndex = 1; // Classic 44 deg arc
    this.chargePower = 0;
    this.chargeDir = 1;
    this.isCharging = false;
    this.moveStamina = MOVE_STAMINA_MAX;
    this.shotFiredThisTurn = false;

    // Active projectiles & delayed bursts
    this.projectiles = [];
    this.pendingBursts = [];
    this.projectileSeq = 1;

    // Per-tick events for renderer SFX / particles / popups
    this.events = [];

    // Bot turn planner state
    this.botPlan = null;

    this._initRoster(roster);
    this._initPandas();
    this._startTurn(0, true);
  }

  _initRoster(roster) {
    const clean = (roster && roster.length > 0)
      ? roster.map((p) => ({
          id: p.id,
          name: p.name || 'Player',
          color: p.color || '#d94e3b',
          isBot: Boolean(p.isBot),
          botDifficulty: p.botDifficulty ? normalizeBotDifficulty(p.botDifficulty) : null,
        }))
      : [{ id: 'solo-p1', name: 'Player 1', color: '#d94e3b', isBot: false, botDifficulty: null }];

    clean.forEach((p, idx) => {
      const team = idx % 2;
      this.players.push({
        ...p,
        team,
        teamColor: TEAMS[team].color,
      });
      this.inputs.set(p.id, blankInput());
      this.prevShoot.set(p.id, false);
      this.prevJump.set(p.id, false);
    });

    // Guarantee both teams have at least one controller (add virtual CPU commander if solo!)
    for (const teamIdx of [0, 1]) {
      if (!this.players.some((p) => p.team === teamIdx)) {
        const cpuId = `cpu-team-${teamIdx}`;
        this.players.push({
          id: cpuId,
          name: teamIdx === 0 ? 'Red Pandas AI' : 'Blue Pandas AI',
          color: TEAMS[teamIdx].color,
          team: teamIdx,
          teamColor: TEAMS[teamIdx].color,
          isBot: true,
          isVirtual: true,
          botDifficulty: null,
        });
        this.inputs.set(cpuId, blankInput());
      }
    }
  }

  _initPandas() {
    this.pandas = PANDA_SPAWNS.map((sp) => {
      const y = getSurfaceHeight(sp.x, sp.z, 10);
      return {
        id: sp.id,
        name: sp.name,
        team: sp.team,
        slot: sp.slot,
        x: sp.x,
        y,
        z: sp.z,
        vx: 0,
        vy: 0,
        vz: 0,
        yaw: sp.yaw,
        ramenHp: MAX_RAMEN_HP,
        maxRamenHp: MAX_RAMEN_HP,
        hasRamen: true,
        state: 'idle', // 'idle' | 'active' | 'tumbling' | 'rolling_home' | 'sleeping'
        idlePose: sp.idlePose,
        ramenPlacement: sp.ramenPlacement,
        expression: 'happy', // 'happy' | 'goofy' | 'blissful' | 'sleepy'
        animPhase: this.rng() * Math.PI * 2,
        tumbleAngleX: 0,
        tumbleAngleZ: 0,
        recoilTimer: 0,
        homeTimer: 0,
        fallPeakY: y,
        hitByTeam: null,
        speed: 0,
        sleepOffset: (sp.slot - 1.5) * 0.55,
      };
    });
  }

  setBotDifficulty(level) {
    this.botDifficulty = normalizeBotDifficulty(level);
  }

  addPlayerMidMatch(p) {
    if (!p || this.players.some((x) => x.id === p.id)) return;
    // Replace a virtual CPU slot if one exists, otherwise assign to smaller team
    const virtualIdx = this.players.findIndex((x) => x.isVirtual);
    let team;
    if (virtualIdx >= 0) {
      team = this.players[virtualIdx].team;
      this.players.splice(virtualIdx, 1);
    } else {
      const count0 = this.players.filter((x) => x.team === 0).length;
      const count1 = this.players.filter((x) => x.team === 1).length;
      team = count0 <= count1 ? 0 : 1;
    }
    this.players.push({
      id: p.id,
      name: p.name || 'Player',
      color: p.color || TEAMS[team].color,
      team,
      teamColor: TEAMS[team].color,
      isBot: Boolean(p.isBot),
      botDifficulty: p.botDifficulty ? normalizeBotDifficulty(p.botDifficulty) : null,
    });
    this.inputs.set(p.id, blankInput());
    this.prevShoot.set(p.id, false);
    this.prevJump.set(p.id, false);
  }

  removePlayer(playerId) {
    const idx = this.players.findIndex((x) => x.id === playerId);
    if (idx < 0) return;
    const removed = this.players.splice(idx, 1)[0];
    this.inputs.delete(playerId);
    this.prevShoot.delete(playerId);
    this.prevJump.delete(playerId);

    // Ensure the team still has a controller
    if (!this.players.some((x) => x.team === removed.team)) {
      const cpuId = `cpu-team-${removed.team}`;
      this.players.push({
        id: cpuId,
        name: removed.team === 0 ? 'Red Pandas AI' : 'Blue Pandas AI',
        color: TEAMS[removed.team].color,
        team: removed.team,
        teamColor: TEAMS[removed.team].color,
        isBot: true,
        isVirtual: true,
        botDifficulty: null,
      });
      this.inputs.set(cpuId, blankInput());
    }
    if (this.activeControllerId === playerId) {
      const fallback = this.players.find((x) => x.team === this.activeTeam);
      this.activeControllerId = fallback ? fallback.id : null;
    }
  }

  renamePlayer(playerId, name) {
    const p = this.players.find((x) => x.id === playerId);
    if (p && name) p.name = name;
  }

  handleInput(playerId, input) {
    if (!input || typeof input !== 'object') return;
    const prev = this.inputs.get(playerId) || blankInput();
    const next = {
      moveX: typeof input.moveX === 'number' ? clamp(input.moveX, -1, 1) : prev.moveX,
      moveZ: typeof input.moveZ === 'number' ? clamp(input.moveZ, -1, 1) : prev.moveZ,
      jump: typeof input.jump === 'boolean' ? input.jump : prev.jump,
      shoot: typeof input.shoot === 'boolean' ? input.shoot : prev.shoot,
      weapon: prev.weapon,
      arcIndex: prev.arcIndex,
      arcCycle: prev.arcCycle,
    };

    // One-shot weapon selection or arc change from the lower-right wheel / HUD
    if (typeof input.weapon === 'string' && WEAPON_BY_ID[input.weapon]) {
      next.weapon = input.weapon;
      if (playerId === this.activeControllerId && this.phase === 'aim' && !this.isCharging) {
        if (this.selectedWeaponId !== input.weapon) {
          this.selectedWeaponId = input.weapon;
          this.events.push({ type: 'weapon_select', weapon: input.weapon, pandaId: this.activePandaId });
        }
      }
    }
    if (typeof input.arcIndex === 'number' && input.arcIndex >= 0 && input.arcIndex < ARC_ANGLES.length) {
      if (playerId === this.activeControllerId && this.phase === 'aim') {
        this.arcIndex = Math.floor(input.arcIndex);
      }
    }
    if (input.arcCycle) {
      if (playerId === this.activeControllerId && this.phase === 'aim') {
        this.arcIndex = (this.arcIndex + 1) % ARC_ANGLES.length;
        this.events.push({ type: 'arc_change', arcIndex: this.arcIndex });
      }
    }

    this.inputs.set(playerId, next);
  }

  getStaticConfig() {
    return {
      gameId: 'panda-ramen',
      boardWidth: BOARD_WIDTH,
      boardDepth: BOARD_DEPTH,
      teams: TEAMS,
      weapons: WEAPONS,
      arcAngles: ARC_ANGLES,
      zooStructures: ZOO_STRUCTURES,
      loungeBoulders: LOUNGE_BOULDERS,
      bambooGroves: BAMBOO_GROVES,
      botDifficulty: this.botDifficulty,
    };
  }

  _livingPandas(team) {
    return this.pandas.filter((p) => p.team === team && p.hasRamen);
  }

  _rollWind() {
    const angle = this.rng() * Math.PI * 2;
    const strength = 0.25 + this.rng() * 1.45;
    this.windX = Number((Math.cos(angle) * strength).toFixed(3));
    this.windZ = Number((Math.sin(angle) * strength).toFixed(3));
  }

  _startTurn(team, isFirstTurn = false) {
    // Check win condition before starting a turn
    const aliveRed = this._livingPandas(0);
    const aliveBlue = this._livingPandas(1);
    if (aliveRed.length === 0 || aliveBlue.length === 0) {
      this._finishMatch(aliveRed.length > 0 ? 0 : 1);
      return;
    }

    this.activeTeam = team;
    if (!isFirstTurn) this.turnNumber += 1;
    this.phase = 'aim';
    this.phaseTimer = 0;
    this.turnTimeLeft = TURN_DURATION;
    this.moveStamina = MOVE_STAMINA_MAX;
    this.isCharging = false;
    this.chargePower = 0;
    this.chargeDir = 1;
    this.shotFiredThisTurn = false;
    this.botPlan = null;

    // Reset all non-sleeping/non-rolling pandas to idle
    for (const pd of this.pandas) {
      if (pd.state === 'active') {
        pd.state = 'idle';
        pd.expression = 'happy';
      }
    }

    // Pick next living panda on this team
    const teamPandas = this.pandas.filter((p) => p.team === team);
    let chosen = null;
    for (let tries = 0; tries < teamPandas.length; tries++) {
      const idx = (this.teamTurnCursor[team] + tries) % teamPandas.length;
      if (teamPandas[idx].hasRamen) {
        chosen = teamPandas[idx];
        this.teamTurnCursor[team] = (idx + 1) % teamPandas.length;
        break;
      }
    }
    if (!chosen) {
      this._finishMatch(1 - team);
      return;
    }

    chosen.state = 'active';
    chosen.expression = 'goofy';
    this.activePandaId = chosen.id;

    // Pick controlling player on this team
    const teamPlayers = this.players.filter((p) => p.team === team);
    const pIdx = this.teamPlayerCursor[team] % Math.max(1, teamPlayers.length);
    this.teamPlayerCursor[team] = (pIdx + 1) % Math.max(1, teamPlayers.length);
    const controller = teamPlayers[pIdx] || this.players[0];
    this.activeControllerId = controller ? controller.id : null;

    // Keep weapon on rocket launcher on Turn 1 (matching the spec & reference image!)
    if (isFirstTurn) {
      this.selectedWeaponId = 'rocket-launcher';
      this.arcIndex = 1;
      // Gently aim the clumsy Turn-1 panda toward an opposing panda across the board
      const opp = this._livingPandas(1)[2] || this._livingPandas(1)[0];
      if (opp) {
        chosen.yaw = Math.atan2(opp.x - chosen.x, opp.z - chosen.z);
      }
      this.windX = 0.45;
      this.windZ = -0.18;
    } else {
      this._rollWind();
      // Gently orient toward nearest enemy panda so player starts facing the action
      const enemies = this._livingPandas(1 - team);
      if (enemies.length > 0) {
        let nearest = enemies[0];
        let bestD = Infinity;
        for (const e of enemies) {
          const d = Math.hypot(e.x - chosen.x, e.z - chosen.z);
          if (d < bestD) {
            bestD = d;
            nearest = e;
          }
        }
        chosen.yaw = Math.atan2(nearest.x - chosen.x, nearest.z - chosen.z);
      }
    }

    // Clear stale edge states for active controller
    if (this.activeControllerId) {
      const inp = this.inputs.get(this.activeControllerId);
      if (inp) {
        this.prevShoot.set(this.activeControllerId, Boolean(inp.shoot));
        this.prevJump.set(this.activeControllerId, Boolean(inp.jump));
      }
    }

    this.events.push({
      type: 'turn_start',
      team,
      pandaId: chosen.id,
      pandaName: chosen.name,
      controllerId: this.activeControllerId,
      controllerName: controller ? controller.name : TEAMS[team].name,
      weapon: this.selectedWeaponId,
    });
  }

  _finishMatch(winningTeam) {
    if (this.phase === 'round_over') return;
    this.phase = 'round_over';
    this.winnerTeam = winningTeam;
    const teamPlayers = this.players.filter((p) => p.team === winningTeam && !p.isVirtual);
    const lead = teamPlayers[0] || this.players.find((p) => p.team === winningTeam);
    this.winnerId = lead ? lead.id : null;
    this.winnerName = TEAMS[winningTeam].name;
    this.events.push({
      type: 'round_over',
      winnerTeam: winningTeam,
      winnerId: this.winnerId,
      winnerName: this.winnerName,
    });
    if (this.callbacks.onRoundWin && this.winnerId) {
      this.callbacks.onRoundWin(this.winnerId);
    }
  }

  _activePanda() {
    return this.pandas.find((p) => p.id === this.activePandaId) || null;
  }

  _activeController() {
    return this.players.find((p) => p.id === this.activeControllerId) || null;
  }

  /** Computes the launch origin and velocity vector for a shot. */
  getLaunchParams(panda, weaponId = this.selectedWeaponId, power = 0.65, arcIdx = this.arcIndex) {
    const weapon = WEAPON_BY_ID[weaponId] || WEAPONS[0];
    const arc = ARC_ANGLES[clamp(arcIdx, 0, ARC_ANGLES.length - 1)];
    const p = clamp(power, 0.25, 1.0);
    const speed = weapon.speed * (0.42 + 0.72 * p);

    const sinY = Math.sin(panda.yaw);
    const cosY = Math.cos(panda.yaw);
    const cosP = Math.cos(arc.rad);
    const sinP = Math.sin(arc.rad);

    const origin = {
      x: panda.x + sinY * 0.62,
      y: panda.y + 0.78,
      z: panda.z + cosY * 0.62,
    };

    return {
      origin,
      vx: sinY * cosP * speed,
      vy: sinP * speed,
      vz: cosY * cosP * speed,
      gravity: GRAVITY * weapon.gravityScale,
      weapon,
    };
  }

  _fireWeapon(panda, weaponId, power, arcIdx) {
    const weapon = WEAPON_BY_ID[weaponId] || WEAPONS[0];
    this.shotFiredThisTurn = true;
    this.isCharging = false;
    this.phase = 'firing';
    this.phaseTimer = 0;
    panda.recoilTimer = 0.42;

    // Playful tiny clumsy recoil hop on the shooter (not enough to fall off ledge!)
    const sinY = Math.sin(panda.yaw);
    const cosY = Math.cos(panda.yaw);
    panda.vx -= sinY * 0.85;
    panda.vz -= cosY * 0.85;
    panda.vy = Math.max(panda.vy, 1.4);

    if (weapon.burstCount > 1) {
      // Fan volley (e.g. 3 whistling bamboo rockets!)
      const spreads = [-0.14, 0, 0.14];
      spreads.forEach((yawOff, idx) => {
        this.pendingBursts.push({
          delay: idx * 0.13,
          pandaId: panda.id,
          team: panda.team,
          weaponId: weapon.id,
          power,
          arcIdx,
          yawOff,
        });
      });
    } else {
      this._spawnProjectile(panda, weapon.id, power, arcIdx, 0);
    }

    this.events.push({
      type: 'fire',
      weapon: weapon.id,
      pandaId: panda.id,
      team: panda.team,
      x: panda.x + sinY * 0.62,
      y: panda.y + 0.78,
      z: panda.z + cosY * 0.62,
      yaw: panda.yaw,
      power,
    });
  }

  _spawnProjectile(panda, weaponId, power, arcIdx, yawOffset = 0, override = null) {
    const savedYaw = panda.yaw;
    panda.yaw = savedYaw + yawOffset;
    const launch = this.getLaunchParams(panda, weaponId, power, arcIdx);
    panda.yaw = savedYaw;

    const proj = {
      id: `proj-${this.projectileSeq++}`,
      weaponId,
      ownerPandaId: panda.id,
      ownerTeam: panda.team,
      x: override ? override.x : launch.origin.x,
      y: override ? override.y : launch.origin.y,
      z: override ? override.z : launch.origin.z,
      vx: override ? override.vx : launch.vx,
      vy: override ? override.vy : launch.vy,
      vz: override ? override.vz : launch.vz,
      gravity: launch.gravity,
      bouncesLeft: override ? (override.bouncesLeft ?? 0) : launch.weapon.bounces,
      age: 0,
      splitDone: Boolean(override?.isSub),
      isSub: Boolean(override?.isSub),
      spin: 0,
    };
    this.projectiles.push(proj);
    return proj;
  }

  _explode(proj, impactX, impactY, impactZ, isBounceImpact = false) {
    const weapon = WEAPON_BY_ID[proj.weaponId] || WEAPONS[0];
    const dmgScale = isBounceImpact ? 0.52 : 1.0;
    const radScale = isBounceImpact ? 0.75 : 1.0;
    const radius = weapon.radius * radScale;

    this.events.push({
      type: isBounceImpact ? 'tire_bounce' : 'explosion',
      weapon: weapon.id,
      x: Number(impactX.toFixed(3)),
      y: Number(impactY.toFixed(3)),
      z: Number(impactZ.toFixed(3)),
      radius,
      team: proj.ownerTeam,
    });

    for (const pd of this.pandas) {
      if (!pd.hasRamen) continue;
      const dx = pd.x - impactX;
      const dy = (pd.y + 0.45) - impactY;
      const dz = pd.z - impactZ;
      const dist = Math.hypot(dx, dy * 0.75, dz);
      if (dist > radius) continue;

      const falloff = clamp(1 - (dist / radius) * 0.65, 0.35, 1.0);
      const dmg = Math.round(weapon.damage * dmgScale * falloff);
      const horizDist = Math.hypot(dx, dz) || 0.001;
      const dirX = horizDist > 0.05 ? dx / horizDist : Math.sin(pd.yaw + Math.PI);
      const dirZ = horizDist > 0.05 ? dz / horizDist : Math.cos(pd.yaw + Math.PI);

      // Whimsical Fall-Guys bouncy launch!
      const kb = weapon.knockback * falloff * (isBounceImpact ? 0.8 : 1.0);
      pd.vx += dirX * kb;
      pd.vz += dirZ * kb;
      pd.vy = Math.max(pd.vy, weapon.upKnock * falloff + 2.2);
      pd.fallPeakY = Math.max(pd.fallPeakY, pd.y + 0.4);
      pd.state = 'tumbling';
      pd.expression = 'blissful';
      pd.hitByTeam = proj.ownerTeam;

      this._damageRamenGrip(pd, dmg, proj.ownerTeam, false);
    }
  }

  _damageRamenGrip(pd, amount, attackerTeam, isTumbleBonus = false) {
    if (!pd.hasRamen || amount <= 0) return;
    pd.ramenHp = Math.max(0, pd.ramenHp - amount);

    this.events.push({
      type: isTumbleBonus ? 'belly_bounce' : 'bonk',
      pandaId: pd.id,
      pandaName: pd.name,
      team: pd.team,
      damage: amount,
      ramenHp: pd.ramenHp,
      x: Number(pd.x.toFixed(3)),
      y: Number((pd.y + 0.9).toFixed(3)),
      z: Number(pd.z.toFixed(3)),
    });

    if (pd.ramenHp <= 0) {
      this._takeRamenBowl(pd, attackerTeam ?? (1 - pd.team));
    }
  }

  _takeRamenBowl(pd, attackerTeam) {
    if (!pd.hasRamen) return;
    pd.hasRamen = false;
    pd.ramenHp = 0;
    pd.expression = 'blissful';

    // Give a joyful Fall-Guys pop before they roll back to their den to nap!
    pd.vy = Math.max(pd.vy, 5.2);
    if (pd.state !== 'rolling_home' && pd.state !== 'sleeping') {
      pd.state = 'tumbling';
    }

    this.events.push({
      type: 'ramen_taken',
      pandaId: pd.id,
      pandaName: pd.name,
      pandaTeam: pd.team,
      takerTeam: attackerTeam,
      x: Number(pd.x.toFixed(3)),
      y: Number((pd.y + 0.7).toFixed(3)),
      z: Number(pd.z.toFixed(3)),
    });
  }

  /** Ballistic solver for Bot AI to find a smart aim yaw, arc, weapon & power. */
  _planBotTurn(panda, controller) {
    const diff = controller?.botDifficulty || this.botDifficulty;
    const profile = BOT_PROFILES[diff] || BOT_PROFILES.medium;
    const enemies = this._livingPandas(1 - panda.team);
    if (enemies.length === 0) return null;

    // Pick a target: prefer low-HP or high-altitude (for fun tumble knockoffs)
    let target = enemies[0];
    let bestScore = -Infinity;
    for (const e of enemies) {
      const dist = Math.hypot(e.x - panda.x, e.z - panda.z);
      const score = (100 - e.ramenHp) * 0.6 + e.y * 14 - dist * 1.8 + this.rng() * 18;
      if (score > bestScore) {
        bestScore = score;
        target = e;
      }
    }

    // Pick a fun whimsical weapon suited to the shot
    const dist = Math.hypot(target.x - panda.x, target.z - panda.z);
    const dy = target.y - panda.y;
    let weaponId = 'rocket-launcher';
    if (target.y > 1.35 && this.rng() < 0.45) {
      weaponId = 'melon-cannon';
    } else if (dy > 0.7 || dist < 4.5) {
      weaponId = this.rng() < 0.55 ? 'ramen-bomb' : 'dumpling-drop';
    } else if (dist > 7.5 && this.rng() < 0.45) {
      weaponId = 'bamboo-bazooka';
    } else {
      const pool = ['rocket-launcher', 'ramen-bomb', 'bouncing-tire', 'bamboo-bazooka', 'dumpling-drop', 'melon-cannon'];
      weaponId = pool[Math.floor(this.rng() * pool.length)];
    }

    const weapon = WEAPON_BY_ID[weaponId];
    const arcIdx = dy > 0.65 || weaponId === 'dumpling-drop' || weaponId === 'ramen-bomb'
      ? (this.rng() < 0.55 ? 2 : 1)
      : (weaponId === 'rocket-launcher' && dy < 0.3 ? 0 : 1);

    // Search power in [0.25..1.0] via fast ballistic simulation so bots clear peaks cleanly!
    const baseYaw = Math.atan2(target.x - panda.x, target.z - panda.z);
    let bestPow = 0.65;
    let bestYaw = baseYaw;
    let bestErr = Infinity;

    const testYaws = [baseYaw - 0.08, baseYaw, baseYaw + 0.08];
    for (const ty of testYaws) {
      for (let p = 0.28; p <= 1.0; p += 0.06) {
        const sim = this._simulateShotLanding(panda, weaponId, p, arcIdx, ty, profile.windComp);
        const err = Math.hypot(sim.x - target.x, (sim.y - target.y) * 0.8, sim.z - target.z);
        if (err < bestErr) {
          bestErr = err;
          bestPow = p;
          bestYaw = ty;
        }
      }
    }

    // Apply difficulty spread
    const aimYaw = normalizeAngle(bestYaw + (this.rng() * 2 - 1) * profile.aimErrorRad);
    const aimPower = clamp(bestPow + (this.rng() * 2 - 1) * profile.powerError, 0.28, 1.0);

    return {
      weaponId,
      arcIdx,
      aimYaw,
      aimPower,
      thinkTimer: profile.thinkDelay,
      chargeTimer: 0,
      chargeDuration: profile.chargeDuration,
      stage: 'think', // 'think' -> 'charge' -> 'done'
    };
  }

  _simulateShotLanding(panda, weaponId, power, arcIdx, yaw, windComp = 1) {
    const savedYaw = panda.yaw;
    panda.yaw = yaw;
    const launch = this.getLaunchParams(panda, weaponId, power, arcIdx);
    panda.yaw = savedYaw;

    let x = launch.origin.x;
    let y = launch.origin.y;
    let z = launch.origin.z;
    let vx = launch.vx;
    let vy = launch.vy;
    let vz = launch.vz;
    const dt = 0.04;
    for (let step = 0; step < 95; step++) {
      vx += this.windX * windComp * 0.45 * dt;
      vz += this.windZ * windComp * 0.45 * dt;
      vy -= launch.gravity * dt;
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;
      if (Math.abs(x) > HALF_W + 0.5 || Math.abs(z) > HALF_D + 0.5) break;
      const ground = getSurfaceHeight(x, z, y + 0.3);
      if (y <= ground + 0.12) {
        return { x, y: ground, z };
      }
    }
    return { x, y, z };
  }

  _tickAimPhase(dt) {
    const panda = this._activePanda();
    const controller = this._activeController();
    if (!panda || !panda.hasRamen) {
      this._startTurn(1 - this.activeTeam);
      return;
    }

    this.turnTimeLeft = Math.max(0, this.turnTimeLeft - dt);

    // Bot AI control
    if (controller?.isBot) {
      if (!this.botPlan) {
        this.botPlan = this._planBotTurn(panda, controller);
        if (this.botPlan) {
          this.selectedWeaponId = this.botPlan.weaponId;
          this.arcIndex = this.botPlan.arcIdx;
          this.events.push({ type: 'weapon_select', weapon: this.selectedWeaponId, pandaId: panda.id });
        }
      }
      if (this.botPlan) {
        // Smoothly rotate panda toward bot's planned aim yaw
        const diff = normalizeAngle(this.botPlan.aimYaw - panda.yaw);
        panda.yaw = normalizeAngle(panda.yaw + diff * Math.min(1, dt * 6.5));

        if (this.botPlan.stage === 'think') {
          this.botPlan.thinkTimer -= dt;
          if (this.botPlan.thinkTimer <= 0) {
            this.botPlan.stage = 'charge';
            this.isCharging = true;
            this.chargePower = 0.25;
          }
        } else if (this.botPlan.stage === 'charge') {
          this.botPlan.chargeTimer += dt;
          const t = clamp(this.botPlan.chargeTimer / this.botPlan.chargeDuration, 0, 1);
          this.chargePower = 0.25 + (this.botPlan.aimPower - 0.25) * t;
          if (t >= 1) {
            this.botPlan.stage = 'done';
            this._fireWeapon(panda, this.selectedWeaponId, this.botPlan.aimPower, this.arcIndex);
          }
        }
      }
      return;
    }

    // Human player control
    const inp = this.inputs.get(this.activeControllerId) || blankInput();
    const wasShoot = Boolean(this.prevShoot.get(this.activeControllerId));
    const wasJump = Boolean(this.prevJump.get(this.activeControllerId));
    this.prevShoot.set(this.activeControllerId, Boolean(inp.shoot));
    this.prevJump.set(this.activeControllerId, Boolean(inp.jump));

    const stickMag = Math.hypot(inp.moveX, inp.moveZ);
    if (stickMag > 0.12) {
      const desiredYaw = Math.atan2(inp.moveX, inp.moveZ);
      const diff = normalizeAngle(desiredYaw - panda.yaw);
      panda.yaw = normalizeAngle(panda.yaw + diff * Math.min(1, dt * 10.5));

      // Waddle when stick pushed past 0.35 and not charging a shot
      if (!this.isCharging && stickMag > 0.35 && this.moveStamina > 0) {
        const moveSpeed = 2.45 * clamp((stickMag - 0.25) / 0.75, 0.2, 1.0);
        const nx = clamp(panda.x + Math.sin(panda.yaw) * moveSpeed * dt, -HALF_W + 0.55, HALF_W - 0.55);
        const nz = clamp(panda.z + Math.cos(panda.yaw) * moveSpeed * dt, -HALF_D + 0.55, HALF_D - 0.55);
        const curGround = getSurfaceHeight(panda.x, panda.z, panda.y + 0.25);
        const nextGround = getSurfaceHeight(nx, nz, panda.y + 0.25);

        // Soft cliff-guard & steep-wall guard while walking on foot (hop to climb or jump off!)
        const onGround = panda.y <= curGround + 0.08;
        const slopeOk = (nextGround - panda.y <= 0.42) && (!onGround || (panda.y - nextGround <= 0.55));
        if (slopeOk) {
          panda.x = nx;
          panda.z = nz;
          panda.speed = moveSpeed;
          panda.animPhase += dt * moveSpeed * 3.8;
          this.moveStamina = Math.max(0, this.moveStamina - dt);
        } else {
          panda.speed = 0;
        }
      } else {
        panda.speed = 0;
      }
    } else {
      panda.speed = 0;
    }

    // Playful Panda Hop (allows climbing ledges & wooden zoo decks!)
    const ground = getSurfaceHeight(panda.x, panda.z, panda.y + 0.2);
    if (inp.jump && !wasJump && !this.isCharging && panda.y <= ground + 0.1) {
      panda.vy = 5.9;
      if (stickMag > 0.25) {
        panda.vx += Math.sin(panda.yaw) * 2.2;
        panda.vz += Math.cos(panda.yaw) * 2.2;
      }
      this.events.push({ type: 'hop', pandaId: panda.id, x: panda.x, y: panda.y, z: panda.z });
    }

    // Hold FIRE to charge power, Release to launch!
    if (inp.shoot) {
      if (!this.isCharging) {
        this.isCharging = true;
        this.chargePower = 0.26;
        this.chargeDir = 1;
      } else {
        this.chargePower += this.chargeDir * dt * 0.92;
        if (this.chargePower >= 1.0) {
          this.chargePower = 1.0;
          this.chargeDir = -1;
        } else if (this.chargePower <= 0.25) {
          this.chargePower = 0.25;
          this.chargeDir = 1;
        }
      }
    } else if (wasShoot && this.isCharging) {
      this._fireWeapon(panda, this.selectedWeaponId, this.chargePower, this.arcIndex);
      return;
    }

    // Auto-fire if turn timer runs out
    if (this.turnTimeLeft <= 0) {
      const power = this.isCharging ? this.chargePower : 0.62;
      this._fireWeapon(panda, this.selectedWeaponId, power, this.arcIndex);
    }
  }

  _tickProjectiles(dt) {
    // Process staggered burst shots (Bamboo Bazooka)
    for (let i = this.pendingBursts.length - 1; i >= 0; i--) {
      const b = this.pendingBursts[i];
      b.delay -= dt;
      if (b.delay <= 0) {
        this.pendingBursts.splice(i, 1);
        const pd = this.pandas.find((p) => p.id === b.pandaId);
        if (pd) {
          this._spawnProjectile(pd, b.weaponId, b.power, b.arcIdx, b.yawOff);
        }
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      const weapon = WEAPON_BY_ID[pr.weaponId] || WEAPONS[0];
      pr.age += dt;
      pr.spin += dt * 9.0;

      // Apply wind & gravity
      pr.vx += this.windX * 0.45 * dt;
      pr.vz += this.windZ * 0.45 * dt;
      pr.vy -= pr.gravity * dt;

      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.z += pr.vz * dt;

      // Cluster split at apex for Dumpling Drop!
      if (weapon.clusterCount > 0 && !pr.splitDone && pr.age > 0.22 && pr.vy <= 0.6) {
        pr.splitDone = true;
        this.events.push({
          type: 'cluster_split',
          weapon: weapon.id,
          x: pr.x,
          y: pr.y,
          z: pr.z,
        });
        const owner = this.pandas.find((p) => p.id === pr.ownerPandaId) || this.pandas[0];
        for (let k = 0; k < weapon.clusterCount; k++) {
          const ang = (k / weapon.clusterCount) * Math.PI * 2 + 0.4;
          this._spawnProjectile(owner, weapon.id, 0.5, this.arcIndex, 0, {
            x: pr.x + Math.cos(ang) * 0.25,
            y: pr.y,
            z: pr.z + Math.sin(ang) * 0.25,
            vx: pr.vx * 0.68 + Math.cos(ang) * 2.4,
            vy: 1.8 + (k % 2) * 0.7,
            vz: pr.vz * 0.68 + Math.sin(ang) * 2.4,
            bouncesLeft: 0,
            isSub: true,
          });
        }
        this.projectiles.splice(i, 1);
        continue;
      }

      // Out of tabletop bounds -> harmless splash off the edge
      if (Math.abs(pr.x) > HALF_W + 1.4 || Math.abs(pr.z) > HALF_D + 1.4 || pr.y < -2.0 || pr.age > 6.0) {
        this.projectiles.splice(i, 1);
        continue;
      }

      // Direct hit on any panda (ignore shooter for first 0.18s)
      let hitPanda = null;
      for (const pd of this.pandas) {
        if (!pd.hasRamen) continue;
        if (pd.id === pr.ownerPandaId && pr.age < 0.22) continue;
        const d = Math.hypot(pr.x - pd.x, (pr.y - (pd.y + 0.5)) * 0.9, pr.z - pd.z);
        if (d < PANDA_RADIUS + 0.28) {
          hitPanda = pd;
          break;
        }
      }

      const ground = getSurfaceHeight(pr.x, pr.z, pr.y + 0.35);
      const hitGround = pr.y <= ground + 0.14;

      if (hitPanda || hitGround) {
        if (pr.bouncesLeft > 0 && !hitPanda) {
          // Whimsical rubber BOING bounce (Bouncing Tire & Melon Cannon!)
          pr.bouncesLeft -= 1;
          pr.y = ground + 0.16;
          // Estimate surface slope normal for lively uphill/downhill bounce!
          const eps = 0.25;
          const hx = getTerrainHeight(pr.x + eps, pr.z) - getTerrainHeight(pr.x - eps, pr.z);
          const hz = getTerrainHeight(pr.x, pr.z + eps) - getTerrainHeight(pr.x, pr.z - eps);
          const nx = -hx / (2 * eps);
          const nz = -hz / (2 * eps);
          const ny = 1;
          const nLen = Math.hypot(nx, ny, nz) || 1;
          const nnx = nx / nLen;
          const nny = ny / nLen;
          const nnz = nz / nLen;
          const dot = pr.vx * nnx + pr.vy * nny + pr.vz * nnz;
          pr.vx = (pr.vx - 2 * dot * nnx) * 0.78;
          pr.vy = Math.max(3.6, Math.abs(pr.vy - 2 * dot * nny) * 0.72);
          pr.vz = (pr.vz - 2 * dot * nnz) * 0.78;
          this._explode(pr, pr.x, ground + 0.18, pr.z, true);
        } else {
          this._explode(pr, pr.x, Math.max(pr.y, ground + 0.15), pr.z, false);
          this.projectiles.splice(i, 1);
        }
      }
    }
  }

  _tickPandas(dt) {
    let anyMoving = false;

    for (const pd of this.pandas) {
      pd.animPhase += dt * (pd.state === 'sleeping' ? 1.4 : 2.2);
      if (pd.recoilTimer > 0) pd.recoilTimer = Math.max(0, pd.recoilTimer - dt);

      if (pd.state === 'sleeping') {
        pd.vx = 0;
        pd.vy = 0;
        pd.vz = 0;
        continue;
      }

      // Rolling cheerfully back to their team's den to take a cozy nap!
      if (pd.state === 'rolling_home') {
        anyMoving = true;
        const den = TEAMS[pd.team].den;
        const tx = den.x + pd.sleepOffset * 0.45;
        const tz = den.z + Math.abs(pd.sleepOffset) * 0.12;
        const dx = tx - pd.x;
        const dz = tz - pd.z;
        const dist = Math.hypot(dx, dz);
        pd.homeTimer += dt;

        if (dist < 0.45 || pd.homeTimer > 3.2) {
          pd.x = tx;
          pd.z = tz;
          pd.y = getTerrainHeight(tx, tz) + 0.05;
          pd.yaw = den.yaw;
          pd.vx = 0;
          pd.vy = 0;
          pd.vz = 0;
          pd.state = 'sleeping';
          pd.expression = 'sleepy';
          pd.tumbleAngleX = 0;
          pd.tumbleAngleZ = 0;
          this.events.push({
            type: 'panda_sleep',
            pandaId: pd.id,
            pandaName: pd.name,
            team: pd.team,
            x: pd.x,
            y: pd.y + 0.6,
            z: pd.z,
          });
        } else {
          const rollSpeed = 5.4;
          pd.x += (dx / dist) * rollSpeed * dt;
          pd.z += (dz / dist) * rollSpeed * dt;
          pd.yaw = Math.atan2(dx, dz);
          const g = getTerrainHeight(pd.x, pd.z);
          // Bouncy joyful somersault roll!
          const hopBounce = Math.abs(Math.sin(pd.homeTimer * 10.5)) * 0.42;
          pd.y = g + hopBounce;
          pd.tumbleAngleX += dt * 11.0;
        }
        continue;
      }

      // Physics integration for active/tumbling/airborne pandas
      const ground = getSurfaceHeight(pd.x, pd.z, pd.y + 0.3);
      const speedH = Math.hypot(pd.vx, pd.vz);
      const airborne = pd.y > ground + 0.04 || pd.vy > 0.05;

      if (airborne || speedH > 0.08 || pd.state === 'tumbling') {
        if (pd.state === 'tumbling' || airborne || speedH > 0.25) {
          anyMoving = true;
        }
        pd.vy -= GRAVITY * dt;
        pd.x += pd.vx * dt;
        pd.y += pd.vy * dt;
        pd.z += pd.vz * dt;

        if (pd.y > pd.fallPeakY) pd.fallPeakY = pd.y;

        if (pd.state === 'tumbling') {
          pd.tumbleAngleX += dt * (4.5 + speedH * 1.4);
          pd.tumbleAngleZ += dt * 3.1;
        }

        // Bounced right off the tabletop edge -> ramen spills & panda bounces back to den!
        if (Math.abs(pd.x) > HALF_W - 0.15 || Math.abs(pd.z) > HALF_D - 0.15) {
          if (pd.state === 'tumbling') {
            pd.x = clamp(pd.x, -HALF_W + 0.35, HALF_W - 0.35);
            pd.z = clamp(pd.z, -HALF_D + 0.35, HALF_D - 0.35);
            if (pd.hasRamen) {
              this._takeRamenBowl(pd, pd.hitByTeam ?? (1 - pd.team));
            }
            pd.state = 'rolling_home';
            pd.homeTimer = 0;
            continue;
          } else {
            pd.x = clamp(pd.x, -HALF_W + 0.4, HALF_W - 0.4);
            pd.z = clamp(pd.z, -HALF_D + 0.4, HALF_D - 0.4);
            pd.vx *= -0.35;
            pd.vz *= -0.35;
          }
        }

        const newGround = getSurfaceHeight(pd.x, pd.z, pd.y + 0.35);
        if (pd.y <= newGround) {
          const dropHeight = pd.fallPeakY - newGround;
          pd.y = newGround;

          if (pd.state === 'tumbling' && Math.abs(pd.vy) > 2.8) {
            // Fall-Guys bouncy belly landing!
            pd.vy = Math.abs(pd.vy) * 0.42;
            pd.vx *= 0.68;
            pd.vz *= 0.68;
            if (dropHeight > 1.05 && pd.hasRamen) {
              const bonus = Math.min(28, Math.round((dropHeight - 0.85) * 14));
              this._damageRamenGrip(pd, bonus, pd.hitByTeam ?? (1 - pd.team), true);
            }
            pd.fallPeakY = newGround;
          } else {
            pd.vy = 0;
            pd.vx *= Math.max(0, 1 - dt * 6.5);
            pd.vz *= Math.max(0, 1 - dt * 6.5);
            pd.fallPeakY = newGround;

            if (pd.state === 'tumbling' && Math.hypot(pd.vx, pd.vz) < 0.45) {
              pd.vx = 0;
              pd.vz = 0;
              pd.tumbleAngleX = 0;
              pd.tumbleAngleZ = 0;
              if (!pd.hasRamen) {
                pd.state = 'rolling_home';
                pd.homeTimer = 0;
              } else {
                pd.state = pd.id === this.activePandaId && this.phase === 'aim' ? 'active' : 'idle';
                pd.expression = 'happy';
              }
            }
          }
        }
      } else {
        // Gently hug terrain height
        pd.y = ground;
        pd.vx = 0;
        pd.vy = 0;
        pd.vz = 0;
        pd.fallPeakY = ground;
        pd.tumbleAngleX *= 0.8;
        pd.tumbleAngleZ *= 0.8;
        if (!pd.hasRamen) {
          pd.state = 'rolling_home';
          pd.homeTimer = 0;
          anyMoving = true;
        }
      }
    }

    // Soft panda-to-panda bumper bounce so chubby pandas never overlap!
    for (let i = 0; i < this.pandas.length; i++) {
      const a = this.pandas[i];
      if (a.state === 'sleeping' || a.state === 'rolling_home') continue;
      for (let j = i + 1; j < this.pandas.length; j++) {
        const b = this.pandas[j];
        if (b.state === 'sleeping' || b.state === 'rolling_home') continue;
        if (Math.abs(a.y - b.y) > 0.9) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const minD = PANDA_RADIUS * 1.95;
        if (d > 0.001 && d < minD) {
          const push = (minD - d) * 0.5;
          const nx = dx / d;
          const nz = dz / d;
          a.x = clamp(a.x - nx * push, -HALF_W + 0.45, HALF_W - 0.45);
          a.z = clamp(a.z - nz * push, -HALF_D + 0.45, HALF_D - 0.45);
          b.x = clamp(b.x + nx * push, -HALF_W + 0.45, HALF_W - 0.45);
          b.z = clamp(b.z + nz * push, -HALF_D + 0.45, HALF_D - 0.45);
        }
      }
    }

    return anyMoving;
  }

  tick(dt) {
    this.events = [];
    if (this.phase === 'round_over') {
      this._tickPandas(dt);
      return;
    }

    this.roundTime += dt;
    this.phaseTimer += dt;

    if (this.phase === 'aim') {
      this._tickAimPhase(dt);
    }

    this._tickProjectiles(dt);
    const pandasMoving = this._tickPandas(dt);

    if (this.phase === 'firing') {
      if (this.projectiles.length === 0 && this.pendingBursts.length === 0) {
        this.phase = 'settling';
        this.phaseTimer = 0;
      }
    } else if (this.phase === 'settling') {
      const aliveRed = this._livingPandas(0).length;
      const aliveBlue = this._livingPandas(1).length;
      if (aliveRed === 0 || aliveBlue === 0) {
        if (!pandasMoving || this.phaseTimer > 2.8) {
          this._finishMatch(aliveRed > 0 ? 0 : 1);
        }
      } else if ((!pandasMoving && this.phaseTimer > 0.7) || this.phaseTimer > 3.6) {
        this._startTurn(1 - this.activeTeam);
      }
    }
  }

  getState() {
    const redLeft = this._livingPandas(0).length;
    const blueLeft = this._livingPandas(1).length;
    const activePanda = this._activePanda();
    const activeCtrl = this._activeController();

    return {
      gameId: 'panda-ramen',
      phase: this.phase,
      roundTime: Number(this.roundTime.toFixed(2)),
      turnNumber: this.turnNumber,
      turnTimeLeft: Number(this.turnTimeLeft.toFixed(1)),
      activeTeam: this.activeTeam,
      activePandaId: this.activePandaId,
      activePandaName: activePanda ? activePanda.name : '',
      activeControllerId: this.activeControllerId,
      activeControllerName: activeCtrl ? activeCtrl.name : TEAMS[this.activeTeam].name,
      activeControllerIsBot: Boolean(activeCtrl?.isBot),
      selectedWeapon: this.selectedWeaponId,
      arcIndex: this.arcIndex,
      isCharging: this.isCharging,
      chargePower: Number(this.chargePower.toFixed(3)),
      moveStamina: Number((this.moveStamina / MOVE_STAMINA_MAX).toFixed(3)),
      windX: this.windX,
      windZ: this.windZ,
      botDifficulty: this.botDifficulty,
      ramenLeft: [redLeft, blueLeft],
      ramenTaken: [4 - blueLeft, 4 - redLeft],
      winnerTeam: this.winnerTeam,
      winnerId: this.winnerId,
      winnerName: this.winnerName,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.teamColor,
        team: p.team,
        isBot: p.isBot,
        hp: p.team === 0 ? redLeft : blueLeft,
        maxHp: 4,
        alive: (p.team === 0 ? redLeft : blueLeft) > 0,
      })),
      pandas: this.pandas.map((pd) => ({
        id: pd.id,
        name: pd.name,
        team: pd.team,
        slot: pd.slot,
        x: Number(pd.x.toFixed(3)),
        y: Number(pd.y.toFixed(3)),
        z: Number(pd.z.toFixed(3)),
        yaw: Number(pd.yaw.toFixed(3)),
        ramenHp: pd.ramenHp,
        maxRamenHp: pd.maxRamenHp,
        hasRamen: pd.hasRamen,
        state: pd.state,
        idlePose: pd.idlePose,
        ramenPlacement: pd.ramenPlacement,
        expression: pd.expression,
        animPhase: Number(pd.animPhase.toFixed(2)),
        tumbleAngleX: Number(pd.tumbleAngleX.toFixed(2)),
        tumbleAngleZ: Number(pd.tumbleAngleZ.toFixed(2)),
        recoilTimer: Number(pd.recoilTimer.toFixed(2)),
        speed: Number(pd.speed.toFixed(2)),
      })),
      projectiles: this.projectiles.map((pr) => ({
        id: pr.id,
        weaponId: pr.weaponId,
        ownerTeam: pr.ownerTeam,
        x: Number(pr.x.toFixed(3)),
        y: Number(pr.y.toFixed(3)),
        z: Number(pr.z.toFixed(3)),
        vx: Number(pr.vx.toFixed(2)),
        vy: Number(pr.vy.toFixed(2)),
        vz: Number(pr.vz.toFixed(2)),
        spin: Number(pr.spin.toFixed(2)),
        isSub: pr.isSub,
      })),
      events: this.events,
    };
  }
}
