import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PixelHoopsEngine,
  WIN_SCORE,
  CHECK_SPOT,
  BOT_DIFFICULTIES,
  DUNK_STYLES,
} from '../../public/js/shared/pixelHoopsEngine.js';

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const bots = (n) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `B${i}`, color: '#fff', isBot: true }));

test('bot vs bot game reaches 11 with a single winner', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    let winner = null;
    const e = new PixelHoopsEngine(bots(2), { onRoundWin: (id) => { winner = id; } }, seeded(seed));
    for (let i = 0; i < 30 * 60 * 10 && !winner; i++) e.tick(1 / 30);
    assert.ok(winner, `seed ${seed}: game finished`);
    const s = e.getState();
    assert.equal(s.phase, 'round_over');
    assert.ok(s.players.find((p) => p.id === winner).score >= WIN_SCORE);
  }
});

test('easy, medium, and hard bot modes all finish and expose botDifficulty', () => {
  for (const level of BOT_DIFFICULTIES) {
    let winner = null;
    const e = new PixelHoopsEngine(bots(2), { onRoundWin: (id) => { winner = id; } }, seeded(42), { botDifficulty: level });
    assert.equal(e.getStaticConfig().botDifficulty, level);
    assert.equal(e.getState().botDifficulty, level);
    for (let i = 0; i < 30 * 60 * 12 && !winner; i++) e.tick(1 / 30);
    assert.ok(winner, `difficulty ${level}: game finished`);
  }
});

test('hard bot beats easy bot consistently across seeded matches', () => {
  let hardWins = 0;
  const matches = 12;
  for (let m = 1; m <= matches; m++) {
    let winner = null;
    const roster = [
      { id: 'hard', name: 'Hard', color: '#f00', isBot: true, botDifficulty: 'hard' },
      { id: 'easy', name: 'Easy', color: '#0f0', isBot: true, botDifficulty: 'easy' },
    ];
    // Alternate who checks first to avoid first-possession bias.
    if (m % 2 === 0) roster.reverse();
    const e = new PixelHoopsEngine(roster, { onRoundWin: (id) => { winner = id; } }, seeded(100 + m));
    for (let i = 0; i < 30 * 60 * 10 && !winner; i++) e.tick(1 / 30);
    if (winner === 'hard') hardWins += 1;
  }
  assert.ok(hardWins >= 9, `expected hard bot to win at least 9/${matches} games, won ${hardWins}`);
});

test('only two players are on court; the rest wait on the bench', () => {
  const e = new PixelHoopsEngine(bots(4), {}, seeded(9));
  const roles = e.getState().players.map((p) => p.role);
  assert.deepEqual(roles, ['court', 'court', 'bench', 'bench']);
  e.removePlayer('b0');
  assert.equal(e.getState().players.filter((p) => p.role === 'court').length, 2);
});

test('the first player checks the ball at the top of the key', () => {
  const e = new PixelHoopsEngine([{ id: 'h', name: 'H', color: '#f00' }, ...bots(1)], {}, seeded(3));
  const s = e.getState();
  assert.equal(s.offenseId, 'h');
  const h = s.players.find((p) => p.id === 'h');
  assert.ok(Math.abs(h.x - CHECK_SPOT.x) < 1e-6 && Math.abs(h.z - CHECK_SPOT.z) < 1e-6);
  assert.equal(s.ball.ownerId, 'h');
});

test('driving to the rim and pressing shoot dunks for 2 with a signature dunk style', () => {
  const e = new PixelHoopsEngine([{ id: 'h', name: 'H', color: '#f00' }], {}, seeded(4));
  for (let i = 0; i < 60; i++) e.tick(1 / 30); // past the check pause
  let scored = null;
  for (let i = 0; i < 30 * 4 && !scored; i++) {
    const s = e.getState();
    const h = s.players[0];
    const near = Math.hypot(h.x, h.z - (-3.05)) < 1.3;
    e.handleInput('h', { moveX: 0, moveZ: -1, shoot: near, jump: false });
    e.tick(1 / 30);
    scored = e.events.find((ev) => ev.type === 'score');
  }
  assert.ok(scored, 'scored');
  assert.equal(scored.points, 2);
  assert.equal(scored.dunk, true);
  assert.ok(DUNK_STYLES.includes(scored.dunkStyle), `valid dunkStyle: ${scored.dunkStyle}`);
});

test('pulling away from hoop triggers fadeaway jumper and juke triggers crossover/spin', () => {
  const e = new PixelHoopsEngine([{ id: 'h', name: 'H', color: '#f00' }, { id: 'd', name: 'D', color: '#00f' }], {}, seeded(7));
  for (let i = 0; i < 60; i++) e.tick(1 / 30); // past the check pause

  // Defender starts 1.3 units in front -> close enough for a 360° spin move!
  const beforeHand = e.getState().players[0].dribbleHand;
  e.handleInput('h', { moveX: 1, moveZ: 0, jump: true, shoot: false });
  e.tick(1 / 30);
  const afterJuke = e.getState().players[0];
  assert.equal(afterJuke.action, 'spin');
  assert.equal(afterJuke.dribbleHand, -beforeHand);

  // Wait for spin to finish, then pull stick away from hoop (+Z) and press shoot for a fadeaway.
  e.handleInput('h', { moveX: 0, moveZ: 0, jump: false, shoot: false });
  for (let i = 0; i < 15; i++) e.tick(1 / 30);
  e.handleInput('h', { moveX: 0, moveZ: 1, jump: false, shoot: true });
  e.tick(1 / 30);
  const fadeState = e.getState().players[0];
  assert.equal(fadeState.action, 'shoot');
  assert.equal(fadeState.moveVariant, 'fadeaway');
});
