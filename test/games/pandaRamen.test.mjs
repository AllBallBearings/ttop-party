import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PandaRamenEngine,
  BOARD_WIDTH,
  BOARD_DEPTH,
  WATER_LEVEL,
  WATERFALL_CONFIG,
  WEAPONS,
  ZOO_STRUCTURES,
  BOT_DIFFICULTIES,
  getTerrainHeight,
  getSurfaceHeight,
  getRiverCenterX,
  isInRiver,
} from '../../public/js/shared/pandaRamenEngine.js';

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const bots = (n) => Array.from({ length: n }, (_, i) => ({
  id: `b${i}`,
  name: `Bot ${i + 1}`,
  color: i % 2 === 0 ? '#d94e3b' : '#3b7fb8',
  isBot: true,
}));

test('initializes expanded 2x board with towering peaks, waterfall & river, 2x4 pandas, ramen bowls, and rocket launcher selected', () => {
  const e = new PandaRamenEngine([{ id: 'h1', name: 'Player 1', color: '#d94e3b' }], {}, seeded(7));
  const s = e.getState();

  assert.equal(s.gameId, 'panda-ramen');
  assert.ok(BOARD_WIDTH >= 22 && BOARD_DEPTH >= 15, 'board is ~2x bigger to spread pandas out');
  assert.equal(s.pandas.length, 8, '8 pandas total');
  assert.equal(s.pandas.filter((p) => p.team === 0).length, 4, '4 pandas on Red Team');
  assert.equal(s.pandas.filter((p) => p.team === 1).length, 4, '4 pandas on Blue Team');
  assert.ok(s.pandas.every((p) => p.hasRamen), 'every panda starts with a bowl of ramen');
  assert.equal(s.selectedWeapon, 'rocket-launcher', 'wheel starts on rocket launcher');
  assert.equal(WEAPONS.length, 6, '6 whimsical weapons on the wheel');

  // Dramatic verticality: towering spires & >3.2u vertical spread between high and low pandas
  const ys = s.pandas.map((p) => p.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 3.2, 'pandas span high peaks, mid ledges, and low meadows');
  assert.ok(getTerrainHeight(-8.95, -5.45) > 6.5, 'NW mountain spire towers high above the valley');

  // Waterfall cliff headwall & carved sunken river channel flowing through the board
  assert.ok(getTerrainHeight(WATERFALL_CONFIG.x, WATERFALL_CONFIG.lipZ) > 4.2, 'waterfall pours from a high cliff edge');
  const midRiverX = getRiverCenterX(0.4);
  assert.equal(isInRiver(midRiverX, 0.4), true, 'river flows through the middle of the board');
  assert.ok(getTerrainHeight(midRiverX, 0.4) < WATER_LEVEL, 'riverbed is carved below water level');

  // Active panda is ON the board and inside bounds
  const active = s.pandas.find((p) => p.id === s.activePandaId);
  assert.ok(active, 'active panda exists');
  assert.equal(active.state, 'active');
  assert.ok(Math.abs(active.x) < BOARD_WIDTH / 2 && Math.abs(active.z) < BOARD_DEPTH / 2);

  // Zoo structures (including river bridge & climbing tower) exist and provide elevated walkable surfaces
  assert.ok(ZOO_STRUCTURES.length >= 5, 'zoo structures and river bridge present');
  const deck = ZOO_STRUCTURES.find((z) => z.id === 'zoo-deck-upper');
  assert.ok(getSurfaceHeight(deck.x, deck.z, 5) >= deck.topY - 1e-6);
});

test('weapon wheel switching, charging, and firing works for all 6 whimsical weapons', () => {
  for (const w of WEAPONS) {
    const e = new PandaRamenEngine([{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }], {}, seeded(11));
    e.handleInput('p1', { weapon: w.id });
    assert.equal(e.getState().selectedWeapon, w.id, `selected ${w.id}`);

    // Dial distance slightly with D-Pad Up, then tap FIRE to launch immediately
    e.handleInput('p1', { dpadY: 1 });
    for (let i = 0; i < 6; i++) e.tick(1 / 30);
    e.handleInput('p1', { dpadY: 0, shoot: true });

    let sawFire = false;
    let sawSplit = false;
    let sawBounce = false;
    let sawExplosion = false;

    for (let i = 0; i < 30 * 8; i++) {
      e.tick(1 / 30);
      if (i === 1) e.handleInput('p1', { shoot: false });
      for (const ev of e.events) {
        if (ev.type === 'fire') sawFire = true;
        if (ev.type === 'cluster_split') sawSplit = true;
        if (ev.type === 'tire_bounce') sawBounce = true;
        if (ev.type === 'explosion') sawExplosion = true;
      }
      if (e.getState().activeTeam === 1 && e.getState().phase === 'aim') break;
    }

    assert.ok(sawFire, `${w.id} fired`);
    if (w.id === 'dumpling-drop') assert.ok(sawSplit, 'dumpling drop splits into mini dumplings');
    if (w.id === 'bouncing-tire') assert.ok(sawBounce || sawExplosion, 'bouncing tire bounces or impacts');
    assert.equal(e.getState().activeTeam, 1, `turn passes to Blue Team after ${w.id}`);
  }
});

test('taking a rival ramen bowl sends the panda rolling back to their den to sleep', () => {
  const e = new PandaRamenEngine([{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }], {}, seeded(21));
  const victim = e.pandas.find((p) => p.team === 1);
  assert.equal(victim.hasRamen, true);

  // Deal fatal ramen-grip knockback via engine damage helper
  e._damageRamenGrip(victim, 120, 0, false);
  assert.equal(victim.hasRamen, false, 'victim ramen bowl is taken');
  assert.equal(e.getState().ramenLeft[1], 3, 'Blue Team has 3 ramen bowls left');
  assert.equal(e.getState().ramenTaken[0], 1, 'Red Team took 1 ramen bowl');

  let sawSleep = false;
  for (let i = 0; i < 30 * 10; i++) {
    e.tick(1 / 30);
    if (e.events.some((ev) => ev.type === 'panda_sleep' && ev.pandaId === victim.id)) {
      sawSleep = true;
      break;
    }
  }
  assert.ok(sawSleep, 'panda rolled back to den and went to sleep');
  const updated = e.getState().pandas.find((p) => p.id === victim.id);
  assert.equal(updated.state, 'sleeping');
  assert.equal(updated.expression, 'sleepy');
});

test('bot vs bot matches across easy, medium, and hard finish cleanly with a winner', () => {
  for (const level of BOT_DIFFICULTIES) {
    let winner = null;
    const e = new PandaRamenEngine(bots(2), { onRoundWin: (id) => { winner = id; } }, seeded(101), { botDifficulty: level });
    assert.equal(e.getStaticConfig().botDifficulty, level);

    for (let i = 0; i < 30 * 60 * 6 && !winner; i++) {
      e.tick(1 / 30);
    }

    assert.ok(winner, `difficulty ${level}: match finished with a winner`);
    const s = e.getState();
    assert.equal(s.phase, 'round_over');
    assert.ok(s.ramenLeft[0] === 0 || s.ramenLeft[1] === 0, 'losing team lost all 4 ramen bowls');
  }
});

test('hot-joining and disconnecting players preserves both teams', () => {
  const e = new PandaRamenEngine([{ id: 'h1', name: 'Host' }], {}, seeded(5));
  assert.equal(e.getState().players.length, 2); // Host + virtual AI
  e.addPlayerMidMatch({ id: 'g1', name: 'Guest', color: '#3b7fb8' });
  assert.equal(e.getState().players.length, 2); // Guest replaces virtual AI on Blue Team
  e.renamePlayer('g1', 'GuestRenamed');
  assert.equal(e.getState().players.find((p) => p.id === 'g1').name, 'GuestRenamed');
  e.removePlayer('g1');
  assert.ok(e.getState().players.some((p) => p.team === 1), 'fallback AI restores Blue Team');
});

test('D-Pad controls direction and distance independently without moving panda, and NEXT cycles pandas without hopping', () => {
  const e = new PandaRamenEngine([{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }], {}, seeded(33));
  const before = e.getState();
  const activeBefore = before.pandas.find((p) => p.id === before.activePandaId);

  // 1. D-Pad Right ONLY changes direction (yaw), leaving distance (aimPower) and position untouched!
  e.handleInput('p1', { dpadX: 1, dpadY: 0 });
  for (let i = 0; i < 12; i++) e.tick(1 / 30);
  const afterYaw = e.getState();
  const pAfterYaw = afterYaw.pandas.find((p) => p.id === before.activePandaId);
  assert.equal(pAfterYaw.x, activeBefore.x, 'panda X stays stationary');
  assert.equal(pAfterYaw.z, activeBefore.z, 'panda Z stays stationary');
  assert.notEqual(pAfterYaw.yaw, activeBefore.yaw, 'D-Pad right rotates yaw');
  assert.equal(afterYaw.aimPower, before.aimPower, 'D-Pad right does not alter distance');

  // 2. D-Pad Up ONLY increases distance (aimPower), leaving direction (yaw) untouched!
  e.handleInput('p1', { dpadX: 0, dpadY: 1 });
  for (let i = 0; i < 12; i++) e.tick(1 / 30);
  const afterDist = e.getState();
  const pAfterDist = afterDist.pandas.find((p) => p.id === before.activePandaId);
  assert.equal(pAfterDist.yaw, pAfterYaw.yaw, 'D-Pad up does not alter yaw');
  assert.ok(afterDist.aimPower > afterYaw.aimPower, 'D-Pad up increases shot distance');

  // 3. Secondary button (NEXT PANDA) cycles cleanly through all 4 Red Team pandas without hopping
  e.handleInput('p1', { dpadX: 0, dpadY: 0, jump: false });
  e.tick(1 / 30);

  const visited = [afterDist.activePandaId];
  for (let step = 0; step < 3; step++) {
    e.handleInput('p1', { jump: true });
    e.tick(1 / 30);
    const cur = e.getState();
    assert.ok(e.events.some((ev) => ev.type === 'panda_switch'), 'emits panda_switch event');
    assert.ok(!e.events.some((ev) => ev.type === 'hop'), 'never emits hop event');
    visited.push(cur.activePandaId);
    e.handleInput('p1', { jump: false });
    e.tick(1 / 30);
  }
  assert.equal(new Set(visited).size, 4, 'cycled through all 4 living pandas on the active team');
});

