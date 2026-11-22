import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StickmanShowdownEngine } from '../../public/js/shared/stickmanShowdownEngine.js';

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function advancePastDrop(engine) {
  for (let i = 0; i < 60; i++) engine.tick(1 / 30);
  assert.equal(engine.getState().phase, 'playing');
}

test('shooting applies backward weapon recoil impulse to the shooter', () => {
  const e = new StickmanShowdownEngine(
    [{ id: 'p1', name: 'P1', color: '#f00' }, { id: 'p2', name: 'P2', color: '#00f' }],
    {},
    seeded(1)
  );
  advancePastDrop(e);

  const p1 = e.players.get('p1');
  p1.x = 0;
  p1.z = 0;
  p1.y = 0;
  p1.grounded = true;
  p1.yaw = 0; // facing +Z
  p1.hasGun = true;
  p1.weaponType = 'pistol';

  const startZ = p1.z;
  e.handleInput('p1', { moveX: 0, moveZ: 0, shoot: true, jump: false });
  e.tick(1 / 30);

  const shotEv = e.events.find((ev) => ev.type === 'shoot' && ev.playerId === 'p1');
  assert.ok(shotEv, 'shoot event emitted');
  assert.ok(shotEv.recoil > 0, 'shoot event carries recoil magnitude');
  assert.ok(p1.recoilKick > 0, 'recoilKick active');
  assert.ok(p1.knockVz < -1.0, `expected negative knockVz recoil, got ${p1.knockVz}`);

  // Let recoil push the character backward over a few frames
  e.handleInput('p1', { moveX: 0, moveZ: 0, shoot: false, jump: false });
  for (let i = 0; i < 8; i++) e.tick(1 / 30);
  assert.ok(p1.z < startZ - 0.15, `expected shooter to slide back from ${startZ}, got ${p1.z}`);
});

test('bullets chip away and eventually destroy barrier chunks so shots pass through', () => {
  const e = new StickmanShowdownEngine(
    [{ id: 'p1', name: 'P1', color: '#f00' }, { id: 'p2', name: 'P2', color: '#00f' }],
    {},
    seeded(2)
  );
  advancePastDrop(e);

  const cfg = e.getStaticConfig();
  assert.ok(cfg.chunks.length >= 32, 'barriers subdivided into destructible chunks');

  // Position p1 directly in front of rock-n (x=0, z=-2.45) facing -Z
  const p1 = e.players.get('p1');
  const p2 = e.players.get('p2');
  p1.x = 0;
  p1.z = -1.2;
  p1.y = 0;
  p1.grounded = true;
  p1.yaw = Math.PI; // facing -Z toward rock-n
  p1.hasGun = true;
  p1.weaponType = 'rapid';

  // Keep p2 far away so bullets only hit the barrier
  p2.x = 5.0;
  p2.z = 3.0;

  let chippedCount = 0;
  let destroyedCount = 0;
  for (let i = 0; i < 160 && destroyedCount === 0; i++) {
    // Keep p1 anchored at firing spot despite recoil so all shots hit the same barrier
    p1.x = 0;
    p1.z = -1.2;
    p1.knockVx = 0;
    p1.knockVz = 0;
    p1.yaw = Math.PI;
    e.handleInput('p1', { moveX: 0, moveZ: 0, shoot: true, jump: false });
    e.tick(1 / 30);
    for (const ev of e.events) {
      if (ev.type === 'wall_hit') {
        chippedCount += 1;
        if (ev.destroyed) destroyedCount += 1;
      }
    }
  }

  assert.ok(chippedCount >= 2, `expected multiple barrier chip hits, got ${chippedCount}`);
  assert.ok(destroyedCount >= 1, 'expected at least one barrier chunk to be destroyed');
  const state = e.getState();
  assert.ok(state.chunkHps.some((hp) => hp === 0), 'destroyed chunk has 0 hp in state.chunkHps');
});

test('bot vs bot stickman match completes with knockback and a winner', () => {
  let winner = null;
  const e = new StickmanShowdownEngine(
    [
      { id: 'b1', name: 'B1', color: '#f00', isBot: true },
      { id: 'b2', name: 'B2', color: '#00f', isBot: true },
    ],
    { onRoundWin: (id) => { winner = id; } },
    seeded(5)
  );
  for (let i = 0; i < 30 * 60 * 3 && !winner; i++) e.tick(1 / 30);
  assert.ok(winner, 'stickman bot match finished with a winner');
  assert.equal(e.getState().phase, 'round_over');
});
