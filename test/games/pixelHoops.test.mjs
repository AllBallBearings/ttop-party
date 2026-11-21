import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PixelHoopsEngine, WIN_SCORE, CHECK_SPOT } from '../../public/js/shared/pixelHoopsEngine.js';

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

test('driving to the rim and pressing shoot dunks for 2', () => {
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
});

function liveSolo(seed = 5) {
  const e = new PixelHoopsEngine([{ id: 'h', name: 'H', color: '#f00' }], {}, seeded(seed));
  for (let i = 0; i < 60; i++) e.tick(1 / 30); // past the check pause
  return e;
}
const me = (e) => e.getState().players[0];

test('juke with the stick centred is a pump fake; sideways is a crossover; forward is a spin', () => {
  let e = liveSolo();
  e.handleInput('h', { moveX: 0, moveZ: 0, jump: true });
  e.tick(1 / 30);
  assert.equal(me(e).action, 'pumpfake');

  e = liveSolo();
  // Facing the hoop (-Z) at the check spot; cut hard to the side.
  e.handleInput('h', { moveX: 1, moveZ: 0, jump: true });
  e.tick(1 / 30);
  assert.equal(me(e).action, 'crossover');
  assert.equal(me(e).ballHand, 1);

  e = liveSolo();
  e.handleInput('h', { moveX: 0, moveZ: -1, jump: true });
  e.tick(1 / 30);
  assert.equal(me(e).action, 'spin');
});

test('shooting while pulling the stick away from the hoop is a fadeaway', () => {
  const e = liveSolo();
  e.handleInput('h', { moveX: 0, moveZ: 1, shoot: true });
  e.tick(1 / 30);
  assert.equal(me(e).action, 'shoot');
  assert.equal(me(e).move, 'fadeaway');
});

test('pulling up slowly at the rim is a layup that scores 2', () => {
  const e = liveSolo(11);
  // Walk to the rim, stop, then shoot.
  for (let i = 0; i < 90 && Math.hypot(me(e).x, me(e).z + 3.05) > 1.2; i++) {
    e.handleInput('h', { moveX: 0, moveZ: -1 });
    e.tick(1 / 30);
  }
  for (let i = 0; i < 10; i++) { e.handleInput('h', { moveX: 0, moveZ: 0 }); e.tick(1 / 30); }
  e.handleInput('h', { moveX: 0, moveZ: 0, shoot: true });
  e.tick(1 / 30);
  assert.equal(me(e).action, 'layup');
  let outcome = null;
  for (let i = 0; i < 90 && !outcome; i++) {
    e.handleInput('h', { moveX: 0, moveZ: 0 });
    e.tick(1 / 30);
    outcome = e.events.find((ev) => ev.type === 'score' || ev.type === 'clank');
  }
  assert.ok(outcome, 'layup finished');
  if (outcome.type === 'score') assert.equal(outcome.points, 2);
});

test('flying in at full speed from outside dunk range is a windmill', () => {
  const e = liveSolo(2);
  let style = null;
  for (let i = 0; i < 90 && !style; i++) {
    const s = me(e);
    const d = Math.hypot(s.x, s.z + 3.05);
    e.handleInput('h', { moveX: 0, moveZ: -1, shoot: d < 2.3 && d > 1.7 && s.speed > 3 });
    e.tick(1 / 30);
    if (me(e).action === 'dunk') style = me(e).move;
  }
  assert.equal(style, 'windmill');
});
