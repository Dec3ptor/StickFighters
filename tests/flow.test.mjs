// Water flowing, Minecraft's way (tileworld.js's flow, blocks.js's flowing water): sources stay
// still; what runs out of them falls first, then spreads along the ground seven tiles at most, a
// level less each tile, toward the nearest way down; it dries up when what fed it is gone; two
// sources make another between them; never into towns or bases; the land's own water never moves
// by itself. Buckets carry it (worldplay.js), flowing water washes away plants and torches, carries
// what's in it along, and is only as deep as its level. Kept in saves as it is.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED, BODY } from '../web/src/config.js';
import { TileWorld, TILE } from '../web/src/world/tileworld.js';
import { SEA_ROW } from '../web/src/world/worldgen.js';
import * as K from '../web/src/world/blocks.js';
import { LIQUID, AIR, AMOUNT, SOURCE, FALLING, WATER_FLOW, WATER_FALL } from '../web/src/world/blocks.js';
import { Inventory, itemOf } from '../web/src/world/items.js';
import { dropItem } from '../web/src/world/worldplay.js';
import { RECIPES } from '../web/src/world/crafting.js';

/** A world (made before seas: no water of its own near) with a flat stone floor at row Y, open above. */
function bed(width = 30) {
  const world = new TileWorld({ seed: 4242, name: 'Flow' });
  const Y = 40;
  for (let x = -width; x <= width; x++) for (let y = Y - 16; y <= Y + 3; y++) world.setTile(x, y, y >= Y ? K.STONE : AIR);
  world.flowing.clear();
  const waves = n => { for (let i = 0; i < n; i++) world.flowTick(); };
  const level = (x, y = Y - 1) => { const id = world.tile(x, y); return SOURCE[id] && LIQUID[id] ? 'S' : FALLING[id] ? 'F' : AMOUNT[id]; };
  return { world, Y, waves, level };
}

test('flowing water: a level less each tile out from its source, seven tiles at most, then no further', () => {
  const { world, Y, waves, level } = bed();
  world.setTile(0, Y - 1, K.WATER);
  waves(30);
  assert.deepEqual([...Array(9)].map((_, i) => level(i)), ['S', 7, 6, 5, 4, 3, 2, 1, 0], 'to the right');
  assert.deepEqual([...Array(9)].map((_, i) => level(-i)), ['S', 7, 6, 5, 4, 3, 2, 1, 0], 'and the left');
  assert.equal(world.tile(3, Y - 2), AIR, 'one tile deep: flowing water doesn\'t pile up');
  assert.equal(world.flowing.size, 0, 'it\'s come to rest: nothing left to do');
  assert.equal(world.flowTick(), 0);
  // Only as deep as its level: in at its bottom, not at its top.
  assert.ok(world.liquidAt(7 * TILE + 8, Y * TILE - 1), 'in the shallowest, at the bottom');
  assert.ok(!world.liquidAt(7 * TILE + 8, Y * TILE - 6), 'not over its top');
  assert.ok(world.liquidAt(0 * TILE + 8, (Y - 1) * TILE + 1), 'the source: all of the tile');
});

test('falling water: down first, a column to the ground, then out along it from where it lands', () => {
  const { world, Y, waves, level } = bed();
  world.setTile(0, Y - 12, K.WATER);
  waves(60);
  for (let y = Y - 11; y <= Y - 1; y++) assert.equal(world.tile(0, y), WATER_FALL, `falling at ${y}`);
  // (A source in the open falls, and spreads beside itself too, as Minecraft's does: three columns.)
  assert.equal(level(1), 'F');
  assert.deepEqual([2, 3, 4, 8].map(x => level(x)), [7, 6, 5, 1], 'out along the ground from where it lands');
  assert.equal(level(9), 0);
});

test('it runs toward the nearest way down (within four tiles), not the other way', () => {
  const { world, Y, waves, level } = bed();
  // A hole in the floor three tiles to the right of where it lands.
  world.setTile(3, Y, AIR);
  world.setTile(3, Y + 1, AIR);
  world.flowing.clear();
  world.setTile(0, Y - 3, K.WATER);
  // (Walls either side of the source up there, so it only falls.)
  world.setTile(-1, Y - 3, K.STONE); world.setTile(1, Y - 3, K.STONE);
  waves(40);
  assert.equal(world.tile(0, Y - 1), WATER_FALL, 'landed');
  assert.ok(LIQUID[world.tile(2, Y - 1)] && LIQUID[world.tile(3, Y)], 'toward the hole, and down it');
  assert.equal(level(-1), 0, 'not the other way');
  // With no way down near, both ways.
  const b = bed();
  b.world.setTile(0, b.Y - 1, K.WATER);
  b.waves(20);
  assert.ok(b.level(-3) > 0 && b.level(3) > 0, 'both ways');
});

test('what fed it gone, it dries up; a falling column drains from the top', () => {
  const { world, Y, waves } = bed();
  world.setTile(0, Y - 8, K.WATER);
  waves(60);
  assert.ok(LIQUID[world.tile(5, Y - 1)]);
  world.setTile(0, Y - 8, AIR);
  waves(80);
  for (let x = -12; x <= 12; x++) for (let y = Y - 9; y < Y; y++) assert.equal(world.tile(x, y), AIR, `dry at ${x},${y}`);
  assert.equal(world.flowing.size, 0);
});

test('two sources make another between them (on the ground, or on a source); not over a drop', () => {
  const { world, Y, waves } = bed();
  world.setTile(-1, Y - 1, K.WATER);
  world.setTile(1, Y - 1, K.WATER);
  waves(10);
  assert.equal(world.tile(0, Y - 1), K.WATER, 'a source between them');
  // Over a hole: it falls instead.
  world.setTile(10, Y, AIR); world.setTile(10, Y + 1, AIR);
  world.setTile(9, Y - 1, K.WATER); world.setTile(11, Y - 1, K.WATER);
  waves(10);
  assert.ok(!SOURCE[world.tile(10, Y)], 'over a drop: no source');
  // Still water scooped from the sea comes back (sources all round it).
  const sea = new TileWorld({ seed: 777, gen: 4 });
  let sp = null;
  for (let k = sea.gen.spawnRegion + 2; k < sea.gen.spawnRegion + 80 && !sp; k++) if (sea.gen.regionBiome(k).sea) sp = sea.gen.seaSpan(k);
  const mid = (sp.x0 + sp.x1) >> 1;
  for (let x = mid - 2; x <= mid + 2; x++) sea.tile(x, SEA_ROW + 1);
  sea.flowing.clear();
  sea.setTile(mid, SEA_ROW, AIR);
  for (let i = 0; i < 5; i++) sea.flowTick();
  assert.equal(sea.tile(mid, SEA_ROW), K.WATER, 'the sea fills the hole again');
});

test('not into towns or bases (world.protect)', () => {
  const { world, Y, waves } = bed();
  world.protect = (tx, ty) => tx >= 3;
  world.setTile(0, Y - 1, K.WATER);
  waves(30);
  assert.ok(LIQUID[world.tile(2, Y - 1)]);
  for (let x = 3; x <= 8; x++) assert.ok(!LIQUID[world.tile(x, Y - 1)], `kept out at ${x}`);
});

test('the land\'s own water never runs by itself: seas, lakes, pools, wells and fountains stay still', () => {
  for (const [seed, gen] of [[777, 6], [2, 5], [4242, 6]]) {
    const world = new TileWorld({ seed, gen }), g = world.gen;
    // The chunks round seas, lakes and towns near the start made (the water along their edges
    // woken, as it is whenever a chunk's made).
    const spans = [];
    for (let k = g.spawnRegion - 12; k <= g.spawnRegion + 12; k++) {
      const sp = g.seaSpan(k), t = g.townIn(k);
      if (sp) spans.push([sp.x0 - 40, sp.x1 + 40, SEA_ROW - 40, g.surfaceAt((sp.x0 + sp.x1) >> 1) + 8]);
      if (t) spans.push([t.x0 - 8, t.x1 + 8, t.top, t.bottom + 2]);
    }
    for (let i = -40; i < 40; i++) { const L = g.lake(i, false); if (L) spans.push([L.x0 - 8, L.x1 + 8, L.level - 8, g.surfaceAt(L.mid) + 4]); }
    for (const [x0, x1, y0, y1] of spans) for (let cx = Math.floor(x0 / 32); cx <= Math.floor(x1 / 32); cx++) for (let cy = Math.max(0, Math.floor(y0 / 32)); cy <= Math.floor(y1 / 32); cy++) world.chunk(cx, cy);
    let water = 0;
    for (const c of world.chunks.values()) for (const id of c.fg) if (LIQUID[id]) water++;
    assert.ok(water > 5000, `seed ${seed}: water about (${water})`);
    assert.ok(world.flowing.size > 0, 'its edges woken');
    const before = world.editCount;
    for (let i = 0; i < 40; i++) world.flowTick();
    assert.equal(world.editCount, before, `seed ${seed}: nothing flowed`);
  }
});

test('kept in a save as it is (the flowing too), and goes on flowing after', () => {
  const { world, Y, waves } = bed();
  world.setTile(0, Y - 6, K.WATER);
  waves(4);
  const saved = new Map([...world.chunks].filter(([, c]) => c.edited).map(([k, c]) => [k, { fg: c.fg.slice(), bg: c.bg.slice(), shape: c.shape.slice() }]));
  const again = new TileWorld({ seed: 4242, saved });
  for (let y = Y - 6; y < Y; y++) for (let x = -3; x <= 3; x++) assert.equal(again.tile(x, y), world.tile(x, y), `kept at ${x},${y}`);
  assert.ok(again.flowing.size > 0, 'what was on its way, woken');
  for (let i = 0; i < 60; i++) { again.flowTick(); world.flowTick(); }
  for (let x = -9; x <= 9; x++) assert.equal(again.tile(x, Y - 1), world.tile(x, Y - 1), `and it ends the same at ${x}`);
  assert.ok(AMOUNT[again.tile(5, Y - 1)] > 0);
});

/** A world game with one soldier on the flow test's floor, driven by `ctl.script`. */
function playOn(width = 30) {
  const { world, Y, waves, level } = bed(width);
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const ctl = { script: { move: 0 }, input() { return this.script; } };
  const me = game.addSoldier({ name: 'Bucket', isBot: false }, ctl);
  for (let i = 0; i < 300 && !me.alive; i++) game.update();
  me.spawnProtect = 0;
  me.body.x = 0.5 * TILE; me.body.y = Y * TILE - BODY.bottom - 0.5; me.body.vx = me.body.vy = 0;
  me.world.inv = new Inventory();
  return { world, game, me, ctl, Y, waves, level };
}
const aimAt = (me, tx, ty) => { const x = tx * TILE + 8, y = ty * TILE + 8; return { aim: Math.atan2(y - me.shoulderY, x - me.shoulderX), aimDist: Math.hypot(x - me.shoulderX, y - me.shoulderY) }; };
const click = (game, me, ctl, tx, ty) => { ctl.script = { move: 0, fire: true, firePressed: true, ...aimAt(me, tx, ty) }; game.update(); ctl.script = { move: 0, ...aimAt(me, tx, ty) }; game.update(); };

test('buckets: made at an anvil from iron; a full one pours a source out, an empty one takes a source back (not flowing water)', () => {
  assert.ok(RECIPES.some(r => r.key === 'bucket' && r.at === 'anvil' && r.of.some(([k]) => k === 'iron_bar')), 'a recipe');
  assert.equal(itemOf('water_bucket').kind, 'bucket');
  const { world, game, me, ctl, Y } = playOn();
  me.world.inv.slots[0] = { key: 'water_bucket', n: 1 };
  me.world.slot = 0;
  game.update();
  click(game, me, ctl, 3, Y - 1);
  assert.equal(world.tile(3, Y - 1), K.WATER, 'poured: a source');
  assert.equal(me.world.inv.slots[0]?.key, 'bucket', 'the bucket, empty, still in hand');
  for (let i = 0; i < 60; i++) game.update();
  assert.ok(AMOUNT[world.tile(5, Y - 1)] > 0 && !SOURCE[world.tile(5, Y - 1)], 'it flows from there');
  // Flowing water can't be scooped.
  click(game, me, ctl, 5, Y - 1);
  assert.equal(me.world.inv.slots[0]?.key, 'bucket', 'not from flowing water');
  click(game, me, ctl, 3, Y - 1);
  // (What flowed out of it may run back in a moment, flowing: it's no source.)
  assert.ok(!SOURCE[world.tile(3, Y - 1)], 'scooped up');
  assert.equal(me.world.inv.slots[0]?.key, 'water_bucket', 'full again');
  for (let i = 0; i < 200; i++) game.update();
  for (let x = -6; x <= 12; x++) assert.ok(!LIQUID[world.tile(x, Y - 1)], `and what flowed from it dries up (${x})`);
  // One of a stack of empty ones: the full one goes in another slot.
  me.world.inv.slots[0] = { key: 'bucket', n: 3 };
  world.setTile(-3, Y - 1, K.WATER);
  click(game, me, ctl, -3, Y - 1);
  assert.equal(me.world.inv.count('bucket'), 2);
  assert.equal(me.world.inv.count('water_bucket'), 1);
});

test('buckets: not in someone else\'s base (or a town)', () => {
  const { world, game, me, ctl, Y } = playOn();
  world.protect = () => true;
  world.claims.set('6,0', { tx: 6, ty: Y - 1, owner: 'Someone' });
  me.world.inv.slots[0] = { key: 'water_bucket', n: 1 };
  me.world.slot = 0;
  game.update();
  click(game, me, ctl, 4, Y - 1);
  assert.equal(world.tile(4, Y - 1), AIR, 'nothing poured');
  assert.equal(me.world.inv.slots[0]?.key, 'water_bucket');
});

test('flowing water washes away plants and torches (dropping them), carries things lying in it along, and pushes whoever stands in it', () => {
  const { world, game, me, Y } = playOn(40);
  world.setTile(6, Y - 1, K.TORCH);
  world.setTile(4, Y - 1, K.TALL_GRASS);
  // (Out of the way.)
  me.body.x = -25 * TILE;
  world.setTile(0, Y - 1, K.WATER);
  for (let i = 0; i < 200; i++) game.update();
  assert.ok(LIQUID[world.tile(4, Y - 1)] && LIQUID[world.tile(6, Y - 1)], 'water where they were');
  assert.ok(world.drops.some(d => d.key === 'torch'), 'the torch, washed out and dropped');
  // Things lying in it drift along it, away from its source.
  const d = dropItem(game, 'stone', 1, 2 * TILE + 8, (Y - 1) * TILE + 4);
  d.delay = 1e9;
  const x0 = d.x;
  for (let i = 0; i < 40; i++) game.update();
  assert.ok(d.x > x0 + 12, `carried along (${(d.x - x0).toFixed(1)} px)`);
  // Whoever stands in it, pushed along gently.
  assert.equal(world.currentAt(2 * TILE + 8, Y * TILE - 2), 1, 'it runs to the right');
  me.body.x = 2 * TILE + 8; me.body.y = Y * TILE - BODY.bottom - 0.5; me.body.vx = 0;
  const mx = me.x;
  for (let i = 0; i < 30; i++) game.update();
  assert.ok(me.x > mx + 8, `pushed along (${(me.x - mx).toFixed(1)} px)`);
  assert.ok(!me.body.swimming, 'shallow: not swimming');
});
