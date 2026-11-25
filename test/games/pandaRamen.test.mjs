import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PandaRamenEngine,
  BOARD_WIDTH,
  BOARD_DEPTH,
  WATER_LEVEL,
  WATERFALL_CONFIG,
  TURN_DURATION,
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

function finishRouletteSpin(engine, maxSteps = 30 * 5) {
  for (let i = 0; i < maxSteps && engine.getState().phase === 'wheel_spin'; i++) {
    engine.tick(1 / 30);
  }
}

test('initializes expanded 2x board with towering peaks, waterfall & river, 6 whimsical roulette weapons, and wheel_spin before 15s timer', () => {
  const e = new PandaRamenEngine([{ id: 'h1', name: 'Player 1', color: '#d94e3b' }], {}, seeded(7));
  const s = e.getState();

  assert.equal(s.gameId, 'panda-ramen');
  assert.equal(TURN_DURATION, 15, 'turn timer is 15 seconds');
  assert.ok(BOARD_WIDTH >= 22 && BOARD_DEPTH >= 15, 'board is ~2x bigger to spread pandas out');
  assert.equal(s.pandas.length, 8, '8 pandas total');
  assert.equal(s.pandas.filter((p) => p.team === 0).length, 4, '4 pandas on Red Team');
  assert.equal(s.pandas.filter((p) => p.team === 1).length, 4, '4 pandas on Blue Team');
  assert.ok(s.pandas.every((p) => p.hasRamen), 'every panda starts with a bowl of ramen');

  // Exact 6 whimsical weapons on the roulette wheel
  assert.deepEqual(
    WEAPONS.map((w) => w.id),
    ['balloon-bazooka', 'glitter-grenade', 'dumpling-airstrike', 'udon-hook', 'towel-gun', 'lotus-sling'],
  );

  // Turn starts in wheel_spin BEFORE the 15-second countdown ticks down!
  assert.equal(s.phase, 'wheel_spin', 'turn starts with roulette wheel spin');
  assert.equal(s.turnTimeLeft, 15, '15s timer starts full');
  for (let i = 0; i < 30; i++) e.tick(1 / 30);
  assert.equal(e.getState().phase, 'wheel_spin', 'still spinning after 1s');
  assert.equal(e.getState().turnTimeLeft, 15, '15s timer stays frozen during roulette spin');

  // Once wheel spin finishes, phase enters aim and timer starts ticking!
  finishRouletteSpin(e);
  assert.equal(e.getState().phase, 'aim', 'transitions to aim after wheel spin');
  for (let i = 0; i < 30; i++) e.tick(1 / 30);
  assert.ok(e.getState().turnTimeLeft < 15 && e.getState().turnTimeLeft > 13.5, 'timer ticks down during aim');

  // Manual weapon override is locked out (must use the roulette-chosen weapon!)
  const lockedWeapon = e.getState().selectedWeapon;
  const otherWeapon = WEAPONS.find((w) => w.id !== lockedWeapon).id;
  e.handleInput('h1', { weapon: otherWeapon });
  assert.equal(e.getState().selectedWeapon, lockedWeapon, 'cannot manually override roulette-chosen weapon');

  // Dramatic verticality & waterfall/river geometry
  const ys = s.pandas.map((p) => p.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 3.2, 'pandas span high peaks, mid ledges, and low meadows');
  assert.ok(getTerrainHeight(-8.95, -5.45) > 6.5, 'NW mountain spire towers high above the valley');
  assert.ok(getTerrainHeight(WATERFALL_CONFIG.x, WATERFALL_CONFIG.lipZ) > 4.2, 'waterfall pours from high cliff edge');
  const midRiverX = getRiverCenterX(0.4);
  assert.equal(isInRiver(midRiverX, 0.4), true, 'river flows through the middle of the board');
  assert.ok(getTerrainHeight(midRiverX, 0.4) < WATER_LEVEL, 'riverbed is carved below water level');

  // Zoo structures exist
  assert.ok(ZOO_STRUCTURES.length >= 5, 'zoo structures and river bridge present');
  const deck = ZOO_STRUCTURES.find((z) => z.id === 'zoo-deck-upper');
  assert.ok(getSurfaceHeight(deck.x, deck.z, 5) >= deck.topY - 1e-6);
});

test('all 6 whimsical weapons fire via Angry-Birds slingshot and perform their signature mechanics', () => {
  for (const w of WEAPONS) {
    const e = new PandaRamenEngine([{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }], {}, seeded(19));
    finishRouletteSpin(e);
    // Force this specific weapon for deterministic per-weapon coverage
    e.selectedWeaponId = w.id;

    const shooter = e.pandas.find((p) => p.id === e.activePandaId);
    const enemy = e.pandas.find((p) => p.team === 1);
    // For udon-hook, position enemy on a nearby perch and aim directly at them so grab & yank lands!
    if (w.id === 'udon-hook') {
      enemy.x = shooter.x + 4.8;
      enemy.z = shooter.z;
      enemy.y = shooter.y;
    }

    const aimYaw = Math.atan2(enemy.x - shooter.x, enemy.z - shooter.z);
    const aimPitch = w.id === 'udon-hook' ? 0.25 : 0.68;
    const aimPower = w.id === 'udon-hook' ? 0.42 : 0.72;

    e.handleInput('p1', { aimYaw, aimPitch, aimPower, fireSlingshot: true });

    let sawFire = false;
    let sawLantern = false;
    let sawSubDumpling = false;
    let sawUdonYank = false;
    let yankedTargetId = null;
    let yankedStartX = enemy.x;
    let sawBounceOrBoom = false;
    let maxSpiralOffset = 0;
    let maxProjectilesSeen = 0;

    for (let i = 0; i < 30 * 10; i++) {
      e.tick(1 / 30);
      const st = e.getState();
      if (st.projectiles.length > maxProjectilesSeen) maxProjectilesSeen = st.projectiles.length;
      if (st.lanterns.length > 0) sawLantern = true;
      for (const pr of st.projectiles) {
        if (pr.isSub) sawSubDumpling = true;
        if (w.id === 'balloon-bazooka') {
          // Measure perpendicular deviation from firing ray
          const perpX = Math.cos(aimYaw);
          const perpZ = -Math.sin(aimYaw);
          const lateral = Math.abs((pr.x - shooter.x) * perpX + (pr.z - shooter.z) * perpZ);
          if (lateral > maxSpiralOffset) maxSpiralOffset = lateral;
        }
      }
      for (const ev of e.events) {
        if (ev.type === 'fire') sawFire = true;
        if (ev.type === 'lantern_airstrike') sawLantern = true;
        if (ev.type === 'udon_yank') {
          sawUdonYank = true;
          yankedTargetId = ev.targetId;
          yankedStartX = ev.x;
        }
        if (ev.type === 'grenade_bounce' || ev.type === 'explosion') sawBounceOrBoom = true;
      }
      if (st.activeTeam === 1 && (st.phase === 'wheel_spin' || st.phase === 'aim')) break;
    }

    assert.ok(sawFire, `${w.id} fired`);
    if (w.id === 'balloon-bazooka') {
      assert.ok(maxSpiralOffset > 0.28, `balloon-bazooka flies in a corkscrew spiral (offset=${maxSpiralOffset.toFixed(2)})`);
    }
    if (w.id === 'glitter-grenade') {
      assert.ok(sawBounceOrBoom, 'glitter-grenade bounced/exploded with glitter');
    }
    if (w.id === 'dumpling-airstrike') {
      assert.ok(sawLantern, 'dumpling-airstrike summoned an overhead Chinese paper lantern');
      assert.ok(sawSubDumpling, 'Chinese paper lantern dropped steaming dumplings');
    }
    if (w.id === 'udon-hook') {
      assert.ok(sawUdonYank, 'udon-hook grabbed target panda foot and yanked them off perch');
      const yanked = e.pandas.find((p) => p.id === yankedTargetId);
      assert.ok(yanked, 'yanked target panda exists');
      assert.ok(yanked.ramenHp < 100 || !yanked.hasRamen, 'yanked panda took ramen-grip damage');
      assert.ok(Math.abs(yanked.x - yankedStartX) > 0.5, 'yanked panda was jerked off their perch');
    }
    if (w.id === 'lotus-sling') {
      assert.ok(maxProjectilesSeen >= 3, `lotus-sling launches a barrage of lotus flowers (saw ${maxProjectilesSeen})`);
    }
    assert.equal(e.getState().activeTeam, 1, `turn passes to Blue Team after ${w.id}`);
  }
});

test('15-second turn timeout backfires & self-destructs active panda, forfeiting their ramen bowl and sending them to the den', () => {
  const e = new PandaRamenEngine([{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }], {}, seeded(42));
  finishRouletteSpin(e);
  assert.equal(e.getState().phase, 'aim');

  const activeId = e.getState().activePandaId;
  let sawBackfire = false;
  let sawRamenTaken = false;
  let sawSleep = false;

  // Let the full 15s timer expire without firing (plus settle/roll-home time)
  for (let i = 0; i < 30 * 24; i++) {
    e.tick(1 / 30);
    for (const ev of e.events) {
      if (ev.type === 'backfire' && ev.pandaId === activeId) sawBackfire = true;
      if (ev.type === 'ramen_taken' && ev.pandaId === activeId) sawRamenTaken = true;
      if (ev.type === 'panda_sleep' && ev.pandaId === activeId) sawSleep = true;
    }
    if (sawSleep && e.getState().activeTeam === 1) break;
  }

  assert.ok(sawBackfire, 'emits backfire event on 15s timeout');
  assert.ok(sawRamenTaken, 'active panda forfeits their bowl of ramen on backfire');
  assert.ok(sawSleep, 'self-destructed panda rolls back to the den to sleep');

  const st = e.getState();
  const fallen = st.pandas.find((p) => p.id === activeId);
  assert.equal(fallen.hasRamen, false);
  assert.equal(fallen.state, 'sleeping');
  assert.equal(st.ramenLeft[0], 3, 'Red Team lost 1 bowl of ramen');
  assert.equal(st.ramenTaken[1], 1, 'Blue Team awarded the forfeited ramen bowl');
  assert.equal(st.activeTeam, 1, 'turn passes to Blue Team after backfire');
});

test('Angry-Birds slingshot aiming updates direction, force, and angle without moving pandas, and NEXT cycles pandas cleanly', () => {
  const e = new PandaRamenEngine([{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }], {}, seeded(33));
  finishRouletteSpin(e);
  const before = e.getState();
  const activeBefore = before.pandas.find((p) => p.id === before.activePandaId);

  // Pull slingshot & adjust elevation angle
  e.handleInput('p1', { isSlingshotPulling: true, aimYaw: 1.25, aimPower: 0.88, aimPitch: 0.95 });
  e.tick(1 / 30);

  const afterAim = e.getState();
  const pAfter = afterAim.pandas.find((p) => p.id === before.activePandaId);
  assert.equal(pAfter.x, activeBefore.x, 'panda X stays stationary');
  assert.equal(pAfter.z, activeBefore.z, 'panda Z stays stationary');
  assert.ok(Math.abs(pAfter.yaw - 1.25) < 0.01, 'slingshot sets exact direction yaw');
  assert.ok(Math.abs(afterAim.aimPower - 0.88) < 0.01, 'slingshot sets stretch force');
  assert.ok(Math.abs(afterAim.aimPitch - 0.95) < 0.01, 'slider sets elevation angle');

  // Release slingshot pull before tapping NEXT
  e.handleInput('p1', { isSlingshotPulling: false });
  e.tick(1 / 30);

  // NEXT cycles cleanly through all 4 living Red Team pandas
  const visited = [afterAim.activePandaId];
  for (let step = 0; step < 3; step++) {
    e.handleInput('p1', { nextPanda: true });
    e.tick(1 / 30);
    assert.ok(e.events.some((ev) => ev.type === 'panda_switch'), 'emits panda_switch event');
    visited.push(e.getState().activePandaId);
  }
  assert.equal(new Set(visited).size, 4, 'cycled through all 4 living pandas on the active team');
});

test('bot vs bot matches across easy, medium, and hard finish cleanly with a winner', () => {
  for (const level of BOT_DIFFICULTIES) {
    let winner = null;
    const e = new PandaRamenEngine(bots(2), { onRoundWin: (id) => { winner = id; } }, seeded(101), { botDifficulty: level });
    assert.equal(e.getStaticConfig().botDifficulty, level);

    for (let i = 0; i < 30 * 60 * 8 && !winner; i++) {
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
