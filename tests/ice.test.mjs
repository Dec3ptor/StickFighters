// Ice is slippery (worlds: blocks.js's slip, physics.js): slow to get going, slow to stop (let go,
// you slide on), slow to turn round, and sprinting a little faster; nothing else changes (stone,
// swimming, maps). Worked out from the blocks under the feet each step, so a player's own steps
// online come out as the host's do. Monsters, mercenaries and townsfolk brake on it.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED, BODY, PHYS } from '../web/src/config.js';
import { makeBody, stepBody, iceBrake } from '../web/src/physics.js';
import { TileWorld, TILE } from '../web/src/world/tileworld.js';
import * as K from '../web/src/world/blocks.js';
import { AIR, SLIP } from '../web/src/world/blocks.js';
import { hireMerc, mercsOf } from '../web/src/world/monsters.js';

const Y = 40;
/** A world with a long flat floor of `block` at row Y, open above. */
function floorOf(block, world = new TileWorld({ seed: 4242, name: 'Ice' })) {
  for (let x = -260; x <= 260; x++) for (let y = Y - 12; y <= Y + 1; y++) world.setTile(x, y, y >= Y ? block : AIR);
  return world;
}
/** A body standing on the floor at x (px), going at vx. */
function standing(world, x, vx = 0) {
  const b = makeBody(x, Y * TILE - BODY.bottom - 0.5);
  for (let i = 0; i < 5; i++) stepBody(b, { move: 0 }, world);
  b.vx = vx;
  return b;
}

test('ice: only ice (not snow) is slippery', () => {
  assert.equal(SLIP[K.ICE], 1);
  for (const k of ['snow', 'stone', 'dirt', 'snow_bricks', 'glass', 'water']) assert.equal(SLIP[K.BLOCK_BY_KEY.get(k).id], 0, k);
});

test('ice: let go at a walk, you slide on much farther than on stone, and still stop', () => {
  const slide = block => {
    const world = floorOf(block), b = standing(world, 0, PHYS.runSpeed);
    let n = 0;
    while (b.vx !== 0 && n < 2000) { stepBody(b, { move: 0 }, world); n++; }
    return { far: b.x, n, stopped: b.vx === 0 };
  };
  const stone = slide(K.STONE), ice = slide(K.ICE);
  assert.ok(stone.stopped && ice.stopped, 'both stop');
  assert.ok(ice.far > stone.far * 8 && ice.far > 3 * TILE, `slid ${ice.far.toFixed(1)} px on ice, ${stone.far.toFixed(1)} on stone`);
  assert.ok(ice.far < 12 * TILE, 'but not for ever');
});

test('ice: turning round takes longer; getting going too; sprinting a little faster', () => {
  const turn = block => {
    const world = floorOf(block), b = standing(world, 0, PHYS.runSpeed);
    let n = 0;
    while (b.vx > -PHYS.runSpeed * 0.9 && n < 2000) { stepBody(b, { move: -1 }, world); n++; }
    return n;
  };
  const tStone = turn(K.STONE), tIce = turn(K.ICE);
  assert.ok(tIce > tStone * 5, `turning round: ${tIce} updates on ice, ${tStone} on stone`);
  const go = (block, sprint) => {
    const world = floorOf(block), b = standing(world, -200 * TILE);
    let n = 0, top = 0;
    for (; n < 400; n++) { stepBody(b, { move: 1, sprint }, world); top = Math.max(top, b.vx); }
    return top;
  };
  const sStone = go(K.STONE, true), sIce = go(K.ICE, true);
  assert.ok(sIce > sStone * 1.05 && sIce < sStone * 1.25, `sprinting: ${sIce.toFixed(2)} on ice, ${sStone.toFixed(2)} on stone`);
  assert.ok(Math.abs(go(K.ICE, false) - go(K.STONE, false)) < 1e-9, 'walking: as fast in the end');
});

test('ice: stone, maps without ice, and swimming are just as they were', () => {
  const inputs = Array.from({ length: 120 }, (_, i) => ({ move: i < 40 ? 1 : i < 70 ? 0 : -1, sprint: i < 20, jump: i === 50, jumpPressed: i === 50 }));
  // On stone, or where there's no ice at all (a map of boxes: no slipAt), the same steps.
  const w1 = floorOf(K.STONE), w2 = floorOf(K.STONE);
  w2.slipAt = undefined;
  const a = standing(w1, 0, PHYS.runSpeed), b = standing(w2, 0, PHYS.runSpeed);
  for (const inp of inputs) { stepBody(a, inp, w1); stepBody(b, inp, w2); }
  assert.equal(a.x, b.x);
  assert.equal(a.vx, b.vx);
  // Swimming over an icy bottom: as over stone.
  const swim = block => {
    const world = floorOf(block);
    for (let x = -20; x <= 20; x++) for (let y = Y - 4; y < Y; y++) world.setTile(x, y, K.WATER);
    const s = standing(world, 0, 0);
    for (const inp of inputs) stepBody(s, { ...inp, sprint: false, jump: false, jumpPressed: false }, world);
    return s;
  };
  const si = swim(K.ICE), ss = swim(K.STONE);
  assert.ok(si.swimming && ss.swimming, 'swimming');
  assert.equal(si.x, ss.x);
});

test('ice: nothing kept but what online play keeps: a step from the host\'s numbers comes out the same', () => {
  const world = floorOf(K.ICE), b = standing(world, 0, 0);
  const inputs = Array.from({ length: 160 }, (_, i) => ({ move: i < 50 ? 1 : i < 90 ? 0 : -1, sprint: i < 30, jump: i === 60, jumpPressed: i === 60 }));
  for (let i = 0; i < 80; i++) stepBody(b, inputs[i], world);
  // (The fields the host sends a player of their own body, client.js: from them, the same steps again.)
  const c = makeBody(0, 0);
  Object.assign(c, { x: b.x, y: b.y, vx: b.vx, vy: b.vy, onGround: b.onGround, crouching: b.crouching, padLaunch: b.padLaunch, hasJetpack: b.hasJetpack, fuel: b.fuel, momentum: b.momentum, rope: null, stamina: b.stamina, winded: b.winded, sprinting: b.sprinting });
  for (let i = 80; i < 160; i++) { stepBody(b, inputs[i], world); stepBody(c, inputs[i], world); }
  assert.equal(c.x, b.x);
  assert.equal(c.vx, b.vx);
});

test('ice: something steering a body brakes when it means to stop (and not on stone)', () => {
  const ice = floorOf(K.ICE), stone = floorOf(K.STONE);
  assert.equal(iceBrake(standing(ice, 0, 2), ice), -1);
  assert.equal(iceBrake(standing(ice, 0, -2), ice), 1);
  assert.equal(iceBrake(standing(stone, 0, 2), stone), 0);
  assert.equal(iceBrake(standing(ice, 0, 0.1), ice), 0, 'stopped, near enough');
});

test('ice: a mercenary follows its owner across ice, and comes to rest near them (no jittering)', () => {
  const world = floorOf(K.ICE);
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const owner = game.addSoldier({ name: 'Owner', isBot: false }, { input: () => ({ move: 0 }) });
  for (let i = 0; i < 300 && !owner.alive; i++) game.update();
  const put = (s, tx) => { s.body.x = tx * TILE + 8; s.body.y = Y * TILE - BODY.bottom - 0.5; s.body.vx = s.body.vy = 0; };
  put(owner, 20);
  const merc = hireMerc(game, owner);
  for (let i = 0; i < 120 && !merc.alive; i++) game.update();
  assert.ok(merc.alive && mercsOf(game, owner).length === 1, 'hired');
  put(merc, -15);
  put(owner, 20);
  const xs = [];
  for (let i = 0; i < 1200; i++) { game.update(); put(owner, 20); xs.push(merc.x); }
  const gap = Math.abs(owner.x - merc.x) / TILE;
  assert.ok(gap < 8, `it caught up (${gap.toFixed(1)} tiles off)`);
  assert.ok(Math.abs(merc.body.vx) < 0.05, `and stopped (${merc.body.vx.toFixed(3)})`);
  let turns = 0;
  for (let i = xs.length - 400; i < xs.length - 1; i++) if (Math.sign(xs[i + 1] - xs[i]) * Math.sign(xs[i] - xs[i - 1]) < 0) turns++;
  assert.ok(turns <= 2, `no going back and forth (${turns} turns)`);
});
