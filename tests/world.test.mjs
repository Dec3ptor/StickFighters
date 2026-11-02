// World mode (web/src/world/): the world made from its seed (the same in any order, on any
// machine), what the rest of the game sees of it (collision, platforms, ladders, steps a block
// high, shots, blasts), digging, building and the hammer, the inventory, guns using its
// ammunition, things on the ground, the light, and keeping a world (saves, files, the player).
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { TileWorld, TILE, CHUNK, WORLD_H, chunkKey } from '../web/src/world/tileworld.js';
import * as K from '../web/src/world/blocks.js';
import { BLOCKS, SHAPES, BLOCK_BY_KEY } from '../web/src/world/blocks.js';
import { BIOMES } from '../web/src/world/worldgen.js';
import { Inventory, itemOf, ammoOf, HOTBAR, BAG, STARTING_KIT } from '../web/src/world/items.js';
import { worldState, playerToSave, worldFromSave, safeSpot, shapeTiles, canPlace, breakBlock, dropItem, REACH } from '../web/src/world/worldplay.js';
import { lightBox, SOLDIER_GLOW } from '../web/src/world/worldrender.js';
import { packBytes, unpackBytes, createWorld, saveWorld, loadChunks, listWorlds, deleteWorld, exportWorld, importWorld, worldName } from '../web/src/world/worldsave.js';
import { seedOf } from '../web/src/world/noise.js';

const id = key => BLOCK_BY_KEY.get(key).id;

/** A world game with one soldier, driven by `script` (its input each update). */
function play(seed = 4242) {
  const world = new TileWorld({ seed, name: 'Test' });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const ctl = { script: { move: 0 }, input() { return this.script; } };
  const me = game.addSoldier({ name: 'Tester', isBot: false }, ctl);
  return { world, game, me, ctl };
}

/** A flat stone floor at the start, cleared of everything for 24 tiles each way and 14 up. */
function arena(world) {
  const sp = world.spawns[0], fx = Math.floor(sp.x / TILE), fy = Math.floor((sp.y + 13) / TILE);
  for (let y = fy - 14; y <= fy + 2; y++) {
    for (let x = fx - 24; x <= fx + 24; x++) {
      world.setTile(x, y, y >= fy ? K.STONE : K.AIR);
      world.setWall(x, y, K.NO_WALL);
    }
  }
  return { fx, fy };
}

function untilAlive(game, me) { for (let i = 0; i < 300 && !me.alive; i++) game.update(); assert.ok(me.alive, 'spawned'); }
const run = (game, n) => { for (let i = 0; i < n; i++) game.update(); };
/** Input aiming at tile (tx, ty)'s middle from the soldier's shoulder. */
const aimAt = (me, tx, ty) => { const x = tx * TILE + 8, y = ty * TILE + 8; return { aim: Math.atan2(y - me.shoulderY, x - me.shoulderX), aimDist: Math.hypot(x - me.shoulderX, y - me.shoulderY) }; };
const slotOf = (me, key) => me.world.inv.slots.findIndex(s => s?.key === key);

// ---- The world from its seed ------------------------------------------------------------------

test('a world comes out the same from its seed, whatever order its chunks are made in', () => {
  const a = new TileWorld({ seed: 99 }), b = new TileWorld({ seed: 99 });
  const keys = [];
  for (let cy = 0; cy < WORLD_H / CHUNK; cy++) for (let cx = -3; cx <= 3; cx++) keys.push([cx, cy]);
  for (const [cx, cy] of keys) a.chunk(cx, cy);
  for (const [cx, cy] of [...keys].reverse()) b.chunk(cx, cy);
  for (const [cx, cy] of keys) {
    const ca = a.chunk(cx, cy), cb = b.chunk(cx, cy);
    assert.deepEqual(ca.fg, cb.fg, `blocks of chunk ${cx},${cy}`);
    assert.deepEqual(ca.bg, cb.bg, `walls of chunk ${cx},${cy}`);
  }
  // Another seed: another world.
  const c = new TileWorld({ seed: 100 });
  let same = 0;
  for (let x = -200; x < 200; x++) if (c.surface(x) === a.surface(x)) same++;
  assert.ok(same < 300, `a different seed's ground differs (${same} of 400 columns the same height)`);
  // Seeds typed as words or numbers.
  assert.equal(seedOf('12345'), 12345);
  assert.equal(seedOf('stick'), seedOf('stick'));
  assert.notEqual(seedOf('stick'), seedOf('stock'));
});

test('a world has biomes side by side, everyone starting on solid ground in the plains', () => {
  for (const seed of [1, 2, 3, 77, 1234]) {
    const world = new TileWorld({ seed });
    const sp = world.spawns[0], tx = Math.floor(sp.x / TILE);
    assert.equal(world.gen.column(tx).biome.key, 'plains', `seed ${seed}: the start is in the plains`);
    // Standing on the ground, with room to stand.
    assert.ok(!world.overlap(sp.x - 6, sp.y - 22, sp.x + 6, sp.y + 12), `seed ${seed}: room to stand at the start`);
    assert.ok(world.support(sp.x - 6, sp.y + 12, sp.x + 6, sp.y + 14), `seed ${seed}: ground under the start`);
    // The ground near the start is gentle: no cliff higher than a few blocks for 40 tiles either way.
    for (let x = tx - 40; x < tx + 40; x++) assert.ok(Math.abs(world.gen.surfaceAt(x + 1) - world.gen.surfaceAt(x)) <= 3, `seed ${seed}: gentle ground at ${x}`);
  }
  const world = new TileWorld({ seed: 5 }), seen = new Set();
  for (let x = -40000; x < 40000; x += 37) seen.add(world.gen.biomeAt(x).key);
  for (const b of BIOMES) assert.ok(seen.has(b.key), `${b.name} somewhere in 80,000 tiles`);
});

test('underground: caves, ores deeper down, bedrock at the bottom', () => {
  const world = new TileWorld({ seed: 31 });
  let air = 0, ores = 0, n = 0;
  for (let x = -600; x < 600; x += 3) {
    const surf = world.gen.surfaceAt(x);
    for (let y = surf + 20; y < WORLD_H - 8; y += 3) {
      n++;
      const t = world.tile(x, y);
      if (t === K.AIR) air++;
      if (BLOCKS[t].pattern === 'ore') ores++;
    }
    assert.equal(world.tile(x, WORLD_H - 1), K.BEDROCK, 'bedrock at the bottom');
  }
  assert.ok(air / n > 0.03 && air / n < 0.45, `some of the underground is caves (${(100 * air / n).toFixed(1)}%)`);
  assert.ok(ores / n > 0.005, `ores underground (${(100 * ores / n).toFixed(2)}%)`);
  // Crystal only deep down.
  let shallowCrystal = 0;
  for (let x = -600; x < 600; x++) for (let y = world.gen.surfaceAt(x); y < world.gen.surfaceAt(x) + 40; y++) if (world.tile(x, y) === K.CRYSTAL) shallowCrystal++;
  assert.equal(shallowCrystal, 0, 'no crystal near the surface');
});

// ---- What the game sees of it ----------------------------------------------------------------------

test('solid blocks are boxes to collide with, shots stop at them, half blocks and ramps are their shapes', () => {
  const world = new TileWorld({ seed: 7 });
  const { fx, fy } = arena(world);
  const y = fy - 1;
  world.setTile(fx + 3, y, K.STONE);
  assert.ok(world.overlap((fx + 3) * TILE + 2, y * TILE + 2, (fx + 3) * TILE + 6, y * TILE + 6), 'a block is solid');
  assert.equal(world.overlap((fx + 4) * TILE + 1, y * TILE + 1, (fx + 4) * TILE + 6, y * TILE + 6), null, 'air is not');
  // Plants, trees and torches don't stop anyone.
  world.setTile(fx + 4, y, K.TALL_GRASS);
  assert.equal(world.overlap((fx + 4) * TILE + 1, y * TILE + 1, (fx + 4) * TILE + 6, y * TILE + 6), null, 'grass is walked through');
  // A shot from the left stops at the block's face.
  const hit = world.raycast(fx * TILE, y * TILE + 8, (fx + 8) * TILE, y * TILE + 8);
  assert.ok(hit && Math.abs(hit.x - (fx + 3) * TILE) < 0.01, 'the shot hits the face of the block');
  assert.ok(!world.clearLine(fx * TILE, y * TILE + 8, (fx + 8) * TILE, y * TILE + 8));
  // Half (low): only its bottom half is solid.
  world.setShape(fx + 3, y, SHAPES.findIndex(s => s.key === 'bottom'));
  assert.equal(world.overlap((fx + 3) * TILE + 2, y * TILE + 1, (fx + 3) * TILE + 6, y * TILE + 6), null, 'the top half is open');
  assert.ok(world.overlap((fx + 3) * TILE + 2, y * TILE + 10, (fx + 3) * TILE + 6, y * TILE + 14), 'the bottom half is solid');
  // A ramp: two steps.
  world.setShape(fx + 3, y, SHAPES.findIndex(s => s.key === 'rampR'));
  assert.equal(world.overlap((fx + 3) * TILE + 1, y * TILE + 1, (fx + 3) * TILE + 6, y * TILE + 6), null, 'the low corner of a ramp is open');
  assert.ok(world.overlap((fx + 3) * TILE + 10, y * TILE + 1, (fx + 3) * TILE + 14, y * TILE + 6), 'the high side is solid');
  // Blasts: blocks go within the radius (less their toughness); bedrock never does.
  const broken = [];
  world.onBreak = (tx, ty, b) => broken.push(b);
  for (let x = fx - 2; x <= fx + 2; x++) world.setTile(x, y - 2, K.DIRT);
  world.setTile(fx, y - 3, K.BEDROCK);
  world.carve(fx * TILE + 8, (y - 2) * TILE + 8, 30);
  assert.equal(world.tile(fx, y - 2), K.AIR, 'dirt at the middle goes');
  assert.equal(world.tile(fx, y - 3), K.BEDROCK, 'bedrock stays');
  assert.ok(broken.length >= 3 && broken.every(b => b === K.DIRT), 'what broke is told');
});

test('soldiers stand on the ground, walk up a block without jumping, stand on platforms, drop through them, and climb ladders', () => {
  const { world, game, me, ctl } = play();
  const { fx, fy } = arena(world);
  untilAlive(game, me);
  run(game, 30);
  assert.ok(me.body.onGround, 'standing');
  // A step a block high, two tiles ahead: walked up.
  for (let y = fy - 1; y >= fy - 1; y--) for (let x = fx + 2; x <= fx + 20; x++) world.setTile(x, y, K.STONE);
  const y0 = me.y;
  ctl.script = { move: 1 };
  run(game, 40);
  ctl.script = { move: 0 };
  run(game, 10);
  assert.ok(me.y < y0 - 12 && me.body.onGround, `up the step without jumping (from ${y0.toFixed(1)} to ${me.y.toFixed(1)})`);
  // A platform above: jumped up through, stood on, dropped through (crouch + jump).
  const tx = Math.floor(me.x / TILE), standY = me.y, py = Math.floor((me.y + 12) / TILE) - 4;
  for (let x = tx - 3; x <= tx + 3; x++) world.setTile(x, py, K.PLATFORM);
  ctl.script = { move: 0, jump: true, jumpPressed: true };
  game.update();
  ctl.script = { move: 0, jump: true };
  run(game, 30);
  ctl.script = { move: 0 };
  run(game, 40);
  assert.ok(Math.abs(me.y + 12 - py * TILE) < 1 && me.body.onGround, `on the platform (feet ${(me.y + 12).toFixed(1)}, platform ${py * TILE})`);
  ctl.script = { move: 0, crouch: true, jump: true, jumpPressed: true };
  game.update();
  ctl.script = { move: 0 };
  run(game, 60);
  assert.ok(Math.abs(me.y - standY) < 1, 'dropped through it, back on the ground');
  // A ladder up to the platform: climbed by holding jump.
  for (let y = py; y < Math.floor((me.y + 12) / TILE); y++) world.setTile(tx + 5, y, K.LADDER);
  me.body.x = (tx + 5) * TILE + 8;
  ctl.script = { move: 0, jump: true };
  run(game, 50);
  assert.ok(me.y < standY - 30, `climbing the ladder (${(standY - me.y).toFixed(1)} up)`);
});

// ---- Digging and building -----------------------------------------------------------------------------

test('a pickaxe digs blocks out (dropping them, picked up), a better one is needed for the hard ones, an axe fells trees', () => {
  const { world, game, me, ctl } = play();
  const { fx, fy } = arena(world);
  untilAlive(game, me);
  run(game, 20);
  const tx = Math.floor(me.x / TILE), ty = Math.floor((me.y + 12) / TILE);
  world.setTile(tx + 1, ty - 1, K.DIRT);
  world.setTile(tx - 1, ty - 1, K.CRYSTAL);
  ctl.script = { move: 0, switchTo: '#0' };
  game.update();
  assert.equal(me.world.inv.slots[me.world.slot].key, 'pickaxe');
  // Dirt: two hits.
  for (let i = 0; i < 80 && world.tile(tx + 1, ty - 1) !== K.AIR; i++) { ctl.script = { move: 0, fire: true, ...aimAt(me, tx + 1, ty - 1) }; game.update(); }
  assert.equal(world.tile(tx + 1, ty - 1), K.AIR, 'dug out');
  ctl.script = { move: 0 };
  run(game, 60);
  assert.ok(me.world.inv.count('dirt') >= 1, 'the dirt picked up');
  assert.ok(me.world.got.some(g => g.key === 'dirt'), 'and told');
  // Crystal needs a better pickaxe than copper.
  for (let i = 0; i < 200; i++) { ctl.script = { move: 0, fire: true, ...aimAt(me, tx - 1, ty - 1) }; game.update(); }
  assert.equal(world.tile(tx - 1, ty - 1), K.CRYSTAL, 'copper can\'t mine crystal');
  me.world.inv.add('iron_pickaxe', 1);
  ctl.script = { move: 0, switchTo: `#${slotOf(me, 'iron_pickaxe') < HOTBAR ? slotOf(me, 'iron_pickaxe') : 0}` };
  if (slotOf(me, 'iron_pickaxe') >= HOTBAR) { me.world.inv.move(slotOf(me, 'iron_pickaxe'), 0); }
  game.update();
  for (let i = 0; i < 400 && world.tile(tx - 1, ty - 1) !== K.AIR; i++) { ctl.script = { move: 0, fire: true, ...aimAt(me, tx - 1, ty - 1) }; game.update(); }
  assert.equal(world.tile(tx - 1, ty - 1), K.AIR, 'iron mines crystal');
  // A tree: cut at the bottom, the whole of it comes down as wood.
  for (let y = ty - 6; y < ty; y++) world.setTile(tx + 3, y, K.TRUNK);
  for (let x = tx + 1; x <= tx + 5; x++) for (let y = ty - 9; y < ty - 6; y++) world.setTile(x, y, K.LEAVES);
  ctl.script = { move: 0, switchTo: `#${slotOf(me, 'axe')}` };
  game.update();
  for (let i = 0; i < 200 && world.tile(tx + 3, ty - 1) !== K.AIR; i++) { ctl.script = { move: 0, fire: true, ...aimAt(me, tx + 3, ty - 1) }; game.update(); }
  for (let y = ty - 9; y < ty; y++) for (let x = tx + 1; x <= tx + 5; x++) assert.equal(world.tile(x, y), K.AIR, `the tree's gone at ${x},${y}`);
  ctl.script = { move: 0 };
  run(game, 90);
  assert.ok(me.world.inv.count('wood') >= 6, `wood from the trunk (${me.world.inv.count('wood')})`);
});

test('building: blocks need something to build onto, never inside anyone; a dragged rectangle; walls, doors and torches', () => {
  const { world, game, me, ctl } = play();
  const { fx, fy } = arena(world);
  untilAlive(game, me);
  run(game, 20);
  const tx = Math.floor(me.x / TILE), ty = Math.floor((me.y + 12) / TILE);
  const planks = itemOf('planks');
  assert.ok(canPlace(game, planks, tx + 2, ty - 1), 'beside the floor');
  assert.ok(!canPlace(game, planks, tx + 2, ty - 6), 'not in mid-air');
  assert.ok(!canPlace(game, planks, tx, ty - 1), 'not inside the soldier');
  assert.ok(!canPlace(game, planks, tx + 2, ty), 'not where there\'s a block');
  // A rectangle, dragged out: placed on letting go, as far as there's something to build onto.
  ctl.script = { move: 0, switchTo: `#${slotOf(me, 'planks')}` };
  game.update();
  me.world.brush = 'rect';
  const had = me.world.inv.count('planks');
  ctl.script = { move: 0, fire: true, firePressed: true, ...aimAt(me, tx + 2, ty - 1) };
  game.update();
  ctl.script = { move: 0, fire: true, ...aimAt(me, tx + 4, ty - 3) };
  game.update();
  ctl.script = { move: 0, fire: false, ...aimAt(me, tx + 4, ty - 3) };
  game.update();
  for (let x = tx + 2; x <= tx + 4; x++) for (let y = ty - 3; y <= ty - 1; y++) assert.equal(world.tile(x, y), K.PLANKS, `plank at ${x},${y}`);
  assert.equal(me.world.inv.count('planks'), had - 9, 'nine planks used');
  // The shapes the brushes make.
  assert.equal(shapeTiles('line', { tx: 0, ty: 0 }, { tx: 5, ty: 1 }).length, 6, 'a line across');
  assert.equal(shapeTiles('box', { tx: 0, ty: 0 }, { tx: 3, ty: 3 }).length, 12, 'a box\'s outline');
  assert.equal(shapeTiles('rect', { tx: 0, ty: 0 }, { tx: 3, ty: 3 }).length, 16, 'a rectangle filled');
  // A door goes from the floor up, three tall; a torch needs something to hang on.
  ctl.script = { move: 0, switchTo: `#${slotOf(me, 'door')}` };
  game.update();
  ctl.script = { move: 0, fire: true, firePressed: true, ...aimAt(me, tx - 3, ty - 1) };
  game.update();
  ctl.script = { move: 0 };
  run(game, 10);
  for (let y = ty - 3; y <= ty - 1; y++) assert.equal(world.tile(tx - 3, y), K.DOOR, `door at ${y}`);
  assert.ok(!canPlace(game, itemOf('torch'), tx - 8, ty - 6), 'no torch in mid-air');
  assert.ok(canPlace(game, itemOf('torch'), tx - 8, ty - 1), 'a torch on the floor');
  // A wall behind, against the blocks.
  assert.ok(canPlace(game, itemOf('plank_wall'), tx + 5, ty - 1), 'a wall beside a block');
  assert.ok(!canPlace(game, itemOf('plank_wall'), tx - 10, ty - 8), 'not a wall in the open');
});

test('the hammer shapes blocks (half, ramps) and takes down walls', () => {
  const { world, game, me, ctl } = play();
  arena(world);
  untilAlive(game, me);
  run(game, 20);
  const tx = Math.floor(me.x / TILE), ty = Math.floor((me.y + 12) / TILE);
  world.setTile(tx + 2, ty - 1, K.STONE_BRICKS);
  ctl.script = { move: 0, switchTo: `#${slotOf(me, 'hammer')}` };
  game.update();
  const shapes = [];
  for (let n = 0; n < SHAPES.length; n++) {
    ctl.script = { move: 0, fire: true, ...aimAt(me, tx + 2, ty - 1) };
    game.update();
    shapes.push(world.shape(tx + 2, ty - 1));
    ctl.script = { move: 0 };
    run(game, 25);
  }
  assert.deepEqual(shapes, [1, 2, 3, 4, 5, 6, 0], 'each hit, the next shape, and back to a full block');
  world.setWall(tx - 2, ty - 1, K.PLANK_WALL);
  for (let i = 0; i < 80 && world.wall(tx - 2, ty - 1) !== K.NO_WALL; i++) { ctl.script = { move: 0, fire: true, ...aimAt(me, tx - 2, ty - 1) }; game.update(); }
  assert.equal(world.wall(tx - 2, ty - 1), K.NO_WALL, 'the wall taken down');
  ctl.script = { move: 0 };
  run(game, 60);
  assert.ok(me.world.inv.count('plank_wall') >= 100, 'and picked up');
});

// ---- Things --------------------------------------------------------------------------------------------

test('the inventory: stacks, room, moving, splitting, the hotbar and the bag, sorting, kept and loaded', () => {
  const inv = new Inventory();
  assert.equal(inv.slots.length, HOTBAR + BAG);
  assert.equal(inv.add('dirt', 1500), 0, 'all fits');
  assert.equal(inv.count('dirt'), 1500);
  assert.equal(inv.slots.filter(Boolean).length, 2, 'in stacks of 999');
  assert.equal(inv.remove('dirt', 600), 600);
  assert.equal(inv.count('dirt'), 900);
  inv.add('M4', 1); inv.add('M4', 1);
  assert.equal(inv.slots.filter(s => s?.key === 'M4').length, 2, 'guns don\'t stack');
  const a = slotOfInv(inv, 'M4');
  inv.slots[a].mag = 12;
  inv.move(a, 25);
  assert.equal(inv.slots[25].key, 'M4');
  assert.equal(inv.slots[25].mag, 12, 'a gun keeps its magazine when it\'s moved');
  inv.add('stone', 10);
  const st = slotOfInv(inv, 'stone');
  assert.ok(inv.split(st));
  assert.equal(inv.slots.filter(s => s?.key === 'stone').map(s => s.n).sort().join(), '5,5', 'split in two');
  // Shift-click: to the bag from the hotbar, onto a stack of the same thing there.
  const fresh = new Inventory();
  fresh.add('torch', 10);
  fresh.slots[HOTBAR + 3] = { key: 'torch', n: 5 };
  fresh.quickMove(0);
  assert.equal(fresh.slots[0], null);
  assert.equal(fresh.slots[HOTBAR + 3].n, 15, 'onto the torches in the bag');
  // Sorting the bag joins stacks of the same thing.
  const bag = new Inventory();
  bag.slots[HOTBAR + 5] = { key: 'dirt', n: 3 };
  bag.slots[HOTBAR + 1] = { key: 'pickaxe', n: 1 };
  bag.slots[HOTBAR + 9] = { key: 'dirt', n: 4 };
  bag.sortBag();
  assert.equal(bag.slots[HOTBAR].key, 'pickaxe', 'tools first');
  assert.deepEqual(bag.slots[HOTBAR + 1], { key: 'dirt', n: 7 }, 'the dirt in one stack');
  // Kept and loaded.
  const back = Inventory.from(JSON.parse(JSON.stringify(inv)));
  assert.deepEqual(back.slots, inv.slots);
  assert.equal(back.slots[25].mag, 12);
  // A new character's things: what the starting kit says, guns loaded.
  const kit = Inventory.starting();
  for (const [key, n] of STARTING_KIT) assert.equal(kit.count(key), n, key);
  assert.equal(kit.slots[slotOfInv(kit, 'Platinum')].mag, 8, 'the pistol loaded');
  // Every item has a name and a stack size; every weapon's ammo is an item (or itself).
  for (const key of ['Platinum', 'M4', 'Shotgun', 'Bazooka', 'Grenade', 'Flamer', 'Longbow']) {
    const it = itemOf(key);
    if (!it) continue;
    const ammo = ammoOf(key);
    assert.ok(ammo === null || ammo === 'self' || itemOf(ammo), `${key}'s ammunition (${ammo}) is something you can have`);
  }
});
const slotOfInv = (inv, key) => inv.slots.findIndex(s => s?.key === key);

test('guns fire from their magazine, reload from the inventory\'s rounds, and switching away loses the reload', () => {
  const { world, game, me, ctl } = play();
  arena(world);
  untilAlive(game, me);
  run(game, 20);
  const pistol = slotOf(me, 'Platinum');
  ctl.script = { move: 0, switchTo: `#${pistol}` };
  game.update();
  assert.equal(me.current, 'Platinum');
  assert.equal(me.weapons.Platinum.mag, 8, 'loaded');
  const bullets = me.world.inv.count('bullets');
  // Shoot the magazine empty (aiming up, into the sky).
  for (let i = 0; i < 400 && me.weapons.Platinum.mag > 0; i++) {
    ctl.script = { move: 0, fire: true, firePressed: i % 2 === 0, aim: -Math.PI / 2, aimDist: 200 };
    game.update();
  }
  assert.equal(me.weapons.Platinum.mag, 0, 'emptied');
  assert.equal(me.world.inv.count('bullets'), bullets, 'shots from the magazine don\'t use the inventory\'s rounds');
  // The reload (started by itself) takes eight rounds from the inventory.
  ctl.script = { move: 0 };
  run(game, 200);
  assert.equal(me.weapons.Platinum.mag, 8, 'reloaded');
  assert.equal(me.world.inv.count('bullets'), bullets - 8, 'eight rounds from the inventory');
  assert.equal(me.world.inv.slots[pistol].mag, 8, 'the magazine kept with the gun');
  // Another thing in hand and back: the magazine's as it was.
  ctl.script = { move: 0, switchTo: '#0' };
  game.update();
  assert.equal(me.current, 'Hands');
  ctl.script = { move: 0, switchTo: `#${pistol}` };
  game.update();
  assert.equal(me.weapons.Platinum.mag, 8);
  // Out of rounds: nothing more to reload with.
  me.world.inv.remove('bullets', 999);
  for (let i = 0; i < 400 && me.weapons.Platinum.mag > 0; i++) {
    ctl.script = { move: 0, fire: true, firePressed: i % 2 === 0, aim: -Math.PI / 2, aimDist: 200 };
    game.update();
  }
  ctl.script = { move: 0 };
  run(game, 200);
  assert.equal(me.weapons.Platinum.mag, 0, 'empty, with nothing to reload');
});

test('things on the ground fall, pile up, and fly to whoever comes near', () => {
  const { world, game, me, ctl } = play();
  const { fx, fy } = arena(world);
  untilAlive(game, me);
  run(game, 20);
  dropItem(game, 'stone', 3, (fx + 12) * TILE + 8, (fy - 8) * TILE);
  dropItem(game, 'stone', 2, (fx + 12) * TILE + 8, (fy - 8) * TILE);
  run(game, 90);
  assert.equal(world.drops.length, 1, 'one pile');
  assert.equal(world.drops[0].n, 5);
  assert.ok(Math.abs(world.drops[0].y - (fy * TILE - 3)) < 1, 'lying on the floor');
  const had = me.world.inv.count('stone');
  ctl.script = { move: 1 };
  run(game, 150);
  assert.equal(world.drops.length, 0, 'picked up');
  assert.equal(me.world.inv.count('stone'), had + 5);
});

// ---- Light ------------------------------------------------------------------------------------------------

test('the light: daylight down to the ground, dark deep underground, torches light it up', () => {
  const world = new TileWorld({ seed: 7 });
  const { fx, fy } = arena(world);
  const x0 = fx - 10, y0 = fy - 10, w = 21, h = 40;
  let light = lightBox(world, x0, y0, w, h);
  const at = (x, y) => light[(y - y0) * w + (x - x0)];
  assert.equal(at(fx, fy - 2), 15, 'open sky');
  assert.ok(at(fx, fy + 2) < 15 && at(fx, fy + 2) > 0, 'a little way into the ground');
  assert.equal(at(fx, fy + 20), 0, 'dark deep down');
  // A torch in a hole deep down.
  for (let y = fy + 18; y <= fy + 22; y++) for (let x = fx - 2; x <= fx + 2; x++) world.setTile(x, y, K.AIR);
  world.setTile(fx, fy + 22, K.TORCH);
  light = lightBox(world, x0, y0, w, h);
  assert.ok(at(fx, fy + 20) >= 10, 'the torch lights the hole');
  assert.ok(SOLDIER_GLOW > 0 && SOLDIER_GLOW < 15);
});

// ---- Keeping a world ---------------------------------------------------------------------------------------

test('keeping a world: chunks packed small, saved and loaded, changed blocks come back, files out and in', async () => {
  // Packing: runs of the same block.
  const a = new Uint8Array(1024);
  a.fill(3, 0, 500);
  a.fill(7, 500, 1024);
  a[42] = 9;
  const packed = packBytes(a);
  assert.ok(packed.length < 40, `small (${packed.length} characters)`);
  assert.deepEqual(unpackBytes(packed), a);
  assert.equal(unpackBytes(packBytes(new Uint8Array(1000))), null, 'the wrong size is refused');
  assert.equal(unpackBytes('not base64!'), null);
  assert.equal(worldName('   '), 'World');
  assert.equal(worldName('x'.repeat(50)).length, 32);

  // A world played: blocks changed, the player's things and place kept.
  const rec = await createWorld({ name: 'Kept', seed: 555 });
  const { world, game, me } = (() => {
    const world = new TileWorld({ seed: rec.seed, name: rec.name });
    const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false });
    const me = game.addSoldier({ name: 'K', isBot: false }, { input: () => ({ move: 0 }) });
    return { world, game, me };
  })();
  untilAlive(game, me);
  const sp = world.spawns[0], tx = Math.floor(sp.x / TILE), ty = Math.floor((sp.y + 13) / TILE);
  world.setTile(tx + 3, ty - 1, K.GOLD);
  world.setTile(tx + 4, ty, K.AIR);
  world.setWall(tx + 5, ty - 2, K.BRICK_WALL);
  me.world.inv.add('gold_ore', 7);
  rec.player = playerToSave(me);
  await saveWorld(rec, world.takeDirty());
  assert.equal(world.takeDirty().length, 0, 'nothing left to save');

  const saved = await loadChunks(rec.id);
  assert.ok(saved.size >= 1 && saved.has(chunkKey(tx + 3 >> 5, ty - 1 >> 5)));
  const again = new TileWorld({ seed: rec.seed, saved });
  assert.equal(again.tile(tx + 3, ty - 1), K.GOLD, 'a block put there');
  assert.equal(again.tile(tx + 4, ty), K.AIR, 'a block dug out');
  assert.equal(again.wall(tx + 5, ty - 2), K.BRICK_WALL, 'a wall');
  assert.equal(again.tile(tx + 40, ty + 30), world.tile(tx + 40, ty + 30), 'the rest from the seed');
  const w = worldFromSave(rec.player);
  assert.equal(w.inv.count('gold_ore'), 7, 'the player\'s things');
  assert.deepEqual(w.resume, { x: Math.round(me.x), y: Math.round(me.y) }, 'and where they were');

  // A file out, and in again (a new world, its name made unique).
  const { text, file } = await exportWorld(rec.id);
  assert.match(file, /\.ssworld$/);
  const copy = await importWorld(text);
  assert.notEqual(copy.id, rec.id);
  assert.equal(copy.name, 'Kept (2)');
  const copied = new TileWorld({ seed: copy.seed, saved: await loadChunks(copy.id) });
  assert.equal(copied.tile(tx + 3, ty - 1), K.GOLD, 'the copy has the changes');
  await assert.rejects(importWorld('{"kind":"nope"}'), /isn't a world/);
  // Deleted: gone, with its chunks.
  await deleteWorld(rec.id);
  assert.ok(!(await listWorlds()).some(r => r.id === rec.id));
  assert.equal((await loadChunks(rec.id)).size, 0);
  await deleteWorld(copy.id);
});

test('coming back: where you were, never inside blocks built there since', () => {
  const { world, game, me } = play();
  const { fx, fy } = arena(world);
  const at = { x: (fx + 6) * TILE + 8, y: fy * TILE - 13 };
  me.world = worldFromSave({ inv: Inventory.starting().toJSON(), x: at.x, y: at.y });
  untilAlive(game, me);
  assert.ok(Math.abs(me.x - at.x) < 1 && Math.abs(me.y - at.y) < 1, 'back where they were');
  // Blocks built where someone would come back: they come back on top of them.
  for (let y = fy - 4; y < fy; y++) world.setTile(fx + 9, y, K.STONE);
  const spot = safeSpot(world, (fx + 9) * TILE + 8, fy * TILE - 13);
  assert.ok(!world.overlap(spot.x - 6, spot.y - 22, spot.x + 6, spot.y + 12), 'room to stand');
  assert.ok(spot.y + 12 <= (fy - 4) * TILE + 0.5, 'on top of the blocks');
  assert.equal(REACH, 6 * TILE);
  void worldState;
  void breakBlock;
});
