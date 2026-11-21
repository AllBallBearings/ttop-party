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
