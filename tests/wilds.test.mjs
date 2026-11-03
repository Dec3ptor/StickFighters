// The wild lands (worlds made since towers: worldgen.js's gen 7): dangerous lands (the blight and
// the ashen wastes: their own monsters out by day as well as night, thorns that cut), crystal
// fields, sky islands with treasure on them, and monster towers: floors one over another with
// ladders up through them, monsters as you climb (lairs.js), a lord at the top, and treasure that
// now and then holds wings, which glide (physics.js, worldplay.js).
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED, BODY } from '../web/src/config.js';
import { TileWorld } from '../web/src/world/tileworld.js';
import { WorldGen, FLOOR_H } from '../web/src/world/worldgen.js';
import * as K from '../web/src/world/blocks.js';
import { TILE, SOLID, AIR } from '../web/src/world/blocks.js';
import { Inventory } from '../web/src/world/items.js';
import { rollGear } from '../web/src/world/gear.js';
import { equip, breakBlock } from '../web/src/world/worldplay.js';
import { moveTo } from '../web/src/world/devmode.js';
import { floorOf } from '../web/src/world/lairs.js';
import { encodeWorld, encodeSnapshot, decodeSnapshot } from '../web/src/net/protocol.js';

const SEED = 777;

/** The first tower each way from where everyone starts (in a dangerous land, if `danger`). */
function firstTower(g, danger = false) {
  for (let d = 0; d < 120; d++) for (const k of [g.spawnRegion + d, g.spawnRegion - d]) { const t = g.tower(k); if (t && (!danger || t.danger)) return t; }
  return null;
}

/** A world, a player in it (`gen` 7), their things emptied. */
function play(seed = SEED) {
  const world = new TileWorld({ seed, name: 'Wilds', gen: 7 });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const inp = { move: 0, aim: 0, aimDist: 40 };
  const me = game.addSoldier({ name: 'Climber', isBot: false }, { input: () => inp });
  for (let i = 0; i < 300 && !me.alive; i++) game.update();
  me.world.inv = new Inventory();
  me.spawnProtect = 0;
  return { world, game, me, inp };
}

test('the wild lands: dangerous lands and crystal fields in new worlds only, well away from the start', () => {
  for (const seed of [SEED, 2, 4242]) {
    const g = new WorldGen(seed, { gen: 7, towns: true }), old = new WorldGen(seed, { gen: 6, towns: true });
    const keys = new Set();
    for (let k = g.spawnRegion - 150; k <= g.spawnRegion + 150; k++) {
      const b = g.regionBiome(k);
      keys.add(b.key);
      if (b.danger || b.rare) assert.ok(Math.abs(k - g.spawnRegion) > 4, `seed ${seed}: ${b.key} not by the start`);
      assert.ok(!['blight', 'ashlands', 'crystal_fields'].includes(old.regionBiome(k).key), 'none in worlds made before');
      assert.equal(old.tower(k), null);
      assert.equal(old.isle(k), null);
    }
    assert.ok(keys.has('blight') && keys.has('crystal_fields'), `seed ${seed}: ${[...keys].join(', ')}`);
  }
});

test('monster towers: in every dangerous land and now and then elsewhere; floors with a ladder up through each, treasure on top', () => {
  const world = new TileWorld({ seed: SEED, gen: 7 }), g = world.gen;
  let towers = 0, danger = 0;
  for (let k = g.spawnRegion - 80; k <= g.spawnRegion + 80; k++) {
    const t = g.tower(k);
    if (!t) continue;
    towers++;
    if (t.danger) danger++;
    assert.ok(!g.townOf(k), 'never in a town\'s region');
    assert.ok(t.name && t.floors >= 6 && t.top === t.base - t.floors * FLOOR_H, t.name);
  }
  assert.ok(towers >= 6 && danger >= 2, `${towers} towers, ${danger} in dangerous lands`);
  const T = firstTower(g, true);
  // Up from the ground floor to the roof: a ladder on each floor, from its floor to the hole in the one over it.
  for (let i = 0; i < T.floors; i++) {
    const floorRow = T.base - i * FLOOR_H, next = floorRow - FLOOR_H;
    const ladder = [];
    for (let x = T.x0 + 1; x < T.x1; x++) if (world.tile(x, next) === K.LADDER && world.tile(x, floorRow - 1) === K.LADDER) ladder.push(x);
    assert.equal(ladder.length, 1, `floor ${i}: one way up`);
    for (let y = next; y < floorRow; y++) assert.equal(world.tile(ladder[0], y), K.LADDER, `floor ${i}: the ladder whole (${y})`);
  }
  // Its treasure on the top floor; crates on the way up; a doorway at the foot.
  let treasure = 0, crates = 0;
  for (let y = T.top; y <= T.base; y++) for (let x = T.x0; x <= T.x1; x++) { const id = world.tile(x, y); if (id === K.TREASURE) { treasure++; assert.equal(floorOf(T, y), T.floors - 1, 'on the top floor'); } if (id === K.LOOT_CRATE) crates++; }
  assert.equal(treasure, 1, 'treasure at the top');
  assert.ok(crates >= 2, `${crates} crates on the way up`);
  assert.ok(!SOLID[world.tile(T.x0, T.base - 1)] && !SOLID[world.tile(T.x0, T.base - 2)], 'a doorway at its foot');
  // Nothing growing in it.
  for (let y = T.top; y < T.base; y++) for (let x = T.x0 + 1; x < T.x1; x++) assert.ok(!K.TRUNKS.has(world.tile(x, y)) && !K.LEAVES_ALL.has(world.tile(x, y)), `no tree inside (${x}, ${y})`);
});

test('sky islands: floating high over the land, with a tree and treasure on them', () => {
  const world = new TileWorld({ seed: SEED, gen: 7 }), g = world.gen;
  let n = 0;
  for (let k = g.spawnRegion - 60; k <= g.spawnRegion + 60; k++) {
    const I = g.isle(k);
    if (!I) continue;
    n++;
    assert.equal(world.tile(I.cx, I.top), K.GRASS, 'grass on top');
    assert.ok(I.top < g.surfaceAt(I.cx) - 40, 'high over the land');
    // Air under it (a long way down), never over a town.
    let solid = 0;
    for (let y = I.y1 + 1; y < I.y1 + 24; y++) for (const x of [I.cx - 2, I.cx, I.cx + 2]) if (SOLID[world.tile(x, y)]) solid++;
    assert.equal(solid, 0, 'floating');
    assert.ok(!g.townNear(I.cx, I.rx), 'not over a town');
    let treasure = false;
    for (let x = I.x0; x <= I.x1; x++) if (world.tile(x, I.top - 1) === K.TREASURE || world.tile(x, I.top) === K.TREASURE) treasure = true;
    assert.ok(treasure, 'its treasure');
  }
  assert.ok(n >= 5, `${n} sky islands`);
});

test('climbing a tower: monsters come on the floors round you, and near the top, its lord', () => {
  const { world, game, me } = play();
  const T = firstTower(world.gen, true);
  // (Into the tower, on its second floor.)
  const at = f => { moveTo(me, ((T.x0 + T.x1) >> 1) * TILE + TILE / 2, (T.base - f * FLOOR_H) * TILE - BODY.bottom - 1); };
  at(1);
  let inside = 0;
  for (let i = 0; i < 1200 && inside < 3; i++) {
    game.update();
    if (i % 40 === 0) at(1);
    inside = game.soldiers.filter(o => o.npc?.lair === T.k && o.alive).length;
  }
  assert.ok(inside >= 3, `monsters in the tower (${inside})`);
  for (const o of game.soldiers) if (o.npc?.lair === T.k) assert.ok(o.x >= T.x0 * TILE && o.x <= (T.x1 + 1) * TILE, 'inside it');
  // Near the top: its lord.
  at(T.floors - 2);
  let lord = null;
  for (let i = 0; i < 300 && !lord; i++) { game.update(); at(T.floors - 2); lord = game.soldiers.find(o => o.npc?.lord === T.k); }
  assert.ok(lord, 'the lord comes');
  assert.ok(lord.maxHealth >= 1600 && /lord of/.test(lord.name), `${lord.name} (${lord.maxHealth})`);
  assert.equal(lord.npc.type, 'tyrant');
});

test('treasure: gold, gems and fine gear; and now and then, wings', () => {
  const { world, game, me } = play();
  const tx = Math.floor(me.x / TILE) + 2, ty = Math.floor(me.y / TILE);
  let wings = 0, gear = 0;
  for (let i = 0; i < 40; i++) {
    world.setTile(tx, ty, K.TREASURE);
    const before = world.drops?.length || 0;
    breakBlock(game, tx, ty, me);
    const got = world.drops.slice(before);
    assert.ok(got.some(d => d.key === 'gold_bar') && got.some(d => d.key === 'coins'), 'gold');
    gear += got.filter(d => d.g).length;
    wings += got.filter(d => d.key === 'wings').length;
    world.drops.length = 0;
  }
  assert.ok(gear >= 80, `fine gear (${gear})`);
  assert.ok(wings >= 4 && wings <= 25, `wings now and then (${wings} of 40)`);
});

test('wings: worn, they glide (slow falling, faster across); the better ones beat for a lift', () => {
  const { world, game, me, inp } = play();
  // (High in the open sky, falling.)
  const x = me.x, high = (world.gen.surfaceAt(Math.floor(x / TILE)) - 70) * TILE;
  const fall = (glide) => {
    moveTo(me, x, high);
    inp.jump = glide; inp.move = 1;
    let vy = 0;
    for (let i = 0; i < 90; i++) { game.update(); vy = Math.max(vy, me.body.vy); }
    inp.jump = false; inp.move = 0;
    return { vy, dy: me.y - high };
  };
  const plain = fall(true);
  const w = rollGear(1, 24, 0, 'unique', 'spirewings');
  me.world.inv.slots[5] = { key: w.key, n: 1, g: w.g };
  equip(game, me, 5);
  game.update();
  assert.ok(me.wings, 'wearing wings');
  const glided = fall(true), fell = fall(false);
  assert.ok(glided.dy < plain.dy * 0.4, `gliding falls far less (${glided.dy.toFixed(0)} against ${plain.dy.toFixed(0)})`);
  assert.ok(fell.dy > glided.dy * 2, 'not holding jump: falling as ever');
  // Online: everyone sees the wings, and the gliding.
  moveTo(me, x, high);
  inp.jump = true;
  game.update(); game.update();
  const snap = decodeSnapshot(encodeSnapshot(game, me, 1, encodeWorld(game))), got = snap.soldiers.find(o => o.id === me.id);
  assert.ok(got.wings && got.gliding, 'sent');
  inp.jump = false;
  // Stormwings: a beat for a lift.
  const sw = rollGear(2, 30, 0, 'unique', 'stormwings');
  me.world.inv.slots[5] = { key: sw.key, n: 1, g: sw.g };
  equip(game, me, 5);
  moveTo(me, x, high);
  inp.jump = true;
  for (let i = 0; i < 20; i++) game.update();
  const y0 = me.y;
  inp.jumpPressed = true; game.update(); inp.jumpPressed = false;
  for (let i = 0; i < 10; i++) game.update();
  inp.jump = false;
  assert.ok(me.y < y0, `a beat lifts them (${(y0 - me.y).toFixed(1)} px up)`);
});

test('dangerous lands: their own monsters out by day; thorns cut', () => {
  const { world, game, me } = play();
  const g = world.gen;
  let k = g.spawnRegion + 5;
  while (!g.regionBiome(k).danger) k++;
  const b = g.regionBiome(k), x = (g.edge(k) + g.edge(k + 1)) >> 1;
  const home = () => moveTo(me, x * TILE + TILE / 2, (world.surface(x) - 1) * TILE - BODY.bottom);
  home();
  world.time = 30000; // (midday)
  const own = b.danger === 2 ? 'fiend' : 'wraith';
  let seen = false;
  for (let i = 0; i < 4000 && !seen; i++) {
    game.update();
    if (i % 60 === 0) { home(); me.health = me.maxHealth; }
    seen = game.soldiers.some(o => o.npc?.type === own);
  }
  assert.ok(seen, `${own}s out by day in the ${b.name}`);
  // Thorns: standing in them hurts.
  for (const o of game.soldiers) if (o.npc) game.removeSoldier(o);
  home();
  for (let i = 0; i < 30; i++) game.update();
  const fx = Math.floor(me.x / TILE), fy = Math.floor(me.y / TILE);
  world.setTile(fx, fy, K.THORNS);
  world.setTile(fx, fy + 1, K.THORNS);
  me.health = me.maxHealth;
  for (let i = 0; i < 200; i++) game.update();
  assert.ok(me.health < me.maxHealth, `cut (${me.health})`);
});
