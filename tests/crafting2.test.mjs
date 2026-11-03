// Crafting's second half (world mode): more things from the world and made from them (craftitems.js),
// blocks in colours and kinds (blocks.js's variants, kept as a tile's paint: tileworld.js), what
// decorations do (decor.js: lamps, signs, flower pots, chairs, windows), blueprints (kits.js) and
// building quicker (buildtools.js: pick block, fill, replace, undo). Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { NetHost } from '../web/src/net/host.js';
import { NetClient } from '../web/src/net/client.js';
import { memoryLinks } from '../web/src/net/peer.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { TileWorld, TILE } from '../web/src/world/tileworld.js';
import * as K from '../web/src/world/blocks.js';
import { ITEMS, itemOf, Inventory, HOTBAR } from '../web/src/world/items.js';
import { RECIPES, STATIONS, STATION_NAMES, stationsNear, timesCanMake, craft } from '../web/src/world/crafting.js';
import { CRAFT_RECIPES, CRAFT_CATS, craftCategory, BLUEPRINTS } from '../web/src/world/craftitems.js';
import { codexEntries } from '../web/src/world/codex.js';
import { valueOf, SHOPS } from '../web/src/world/trade.js';
import { breakBlock, worldFromSave, canPlace, buildAction, signWrite, finishBuildings, mayChange, chestAt, BRUSHES } from '../web/src/world/worldplay.js';
import { signText, signsToSave, signsFromSave, decorSupported, painted } from '../web/src/world/decor.js';
import { BUILDINGS, kitCells, kitNeeds, kitCheck } from '../web/src/world/kits.js';
import { fillTiles, replaceTiles } from '../web/src/world/buildtools.js';
import { drawIcon, drawTileIcon, paintPatch, PATCH } from '../web/src/world/worldrender.js';
import { packBytes, unpackBytes } from '../web/src/world/worldsave.js';
import { WorldHost, WorldClient } from '../web/src/world/worldnet.js';

// ---- Helpers ---------------------------------------------------------------------------------------------

/** A world, a game, and a player in it (ctl.script: their input). */
function play(seed = 4242) {
  const world = new TileWorld({ seed, name: 'Crafting', gen: 7 });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const ctl = { script: { move: 0 }, input() { const s = this.script; this.script = { ...s, firePressed: false, jumpPressed: false, switchTo: null, cycle: 0, reload: false }; return s; } };
  const me = game.addSoldier({ name: 'Builder', isBot: false }, ctl);
  me.world = worldFromSave(null);
  return { world, game, me, ctl };
}
/** A flat stone floor where the world starts, open for 30 tiles each way and 20 up, no walls. */
function arena(world) {
  const sp = world.spawns[0], fx = Math.floor(sp.x / TILE), fy = Math.floor((sp.y + 13) / TILE);
  for (let y = fy - 20; y <= fy + 2; y++) {
    for (let x = fx - 30; x <= fx + 30; x++) { world.setTile(x, y, y >= fy ? K.STONE : K.AIR); world.setWall(x, y, K.NO_WALL); }
  }
  return { fx, fy };
}
const run = (game, n) => { for (let i = 0; i < n; i++) game.update(); };
function start() {
  const m = play();
  const { fx, fy } = arena(m.world);
  for (let i = 0; i < 300 && !m.me.alive; i++) m.game.update();
  assert.ok(m.me.alive, 'spawned');
  m.me.spawnProtect = 0;
  m.world.devQuiet = true;
  run(m.game, 20);
  return { ...m, fx, fy };
}
const aimAt = (me, tx, ty, oy = 8) => { const x = tx * TILE + 8, y = ty * TILE + oy; return { aim: Math.atan2(y - me.shoulderY, x - me.shoulderX), aimDist: Math.hypot(x - me.shoulderX, y - me.shoulderY) }; };
/** Hold `key` (n of it) in hotbar slot 0. */
function hold(m, key, n = 1) {
  m.me.world.inv.slots[0] = { key, n };
  m.me.world.inv.version++;
  m.ctl.script = { move: 0, switchTo: '#0' };
  run(m.game, 2);
}
/** A left click at tile (tx, ty) (oy: how far down the tile). */
function click(m, tx, ty, oy = 8) {
  m.ctl.script = { move: 0, fire: true, firePressed: true, ...aimAt(m.me, tx, ty, oy) };
  run(m.game, 2);
  m.ctl.script = { move: 0, ...aimAt(m.me, tx, ty, oy) };
  run(m.game, 8);
}
/** A right click at tile (tx, ty). */
function rightClick(m, tx, ty) {
  m.ctl.script = { move: 0, alt: true, ...aimAt(m.me, tx, ty) };
  run(m.game, 3);
  m.ctl.script = { move: 0, ...aimAt(m.me, tx, ty) };
  run(m.game, 2);
}
/** Aim at tile (tx, ty) (for a key that acts on what's aimed at). */
function aim(m, tx, ty) { m.ctl.script = { move: 0, ...aimAt(m.me, tx, ty) }; run(m.game, 2); }
const onGround = (m, key) => (m.world.drops || []).filter(d => d.key === key).reduce((n, d) => n + d.n, 0);
/** A 2D context that keeps what's drawn: [method, ...arguments]. */
function recorder() {
  const calls = [];
  const g = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : k === 'measureText' ? s => ({ width: String(s).length * 4 }) : (...a) => { calls.push([k, ...a]); }),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return { g, calls };
}
// (What there was before this: items.js's own, by the blocks and the rest.)
const NEW_KEYS = new Set([...ITEMS.keys()].filter(k => {
  const it = itemOf(k);
  if (it.paint || it.shape || it.dyeOf || it.kind === 'blueprint') return true;
  if (it.kind === 'block' && it.block >= K.CONCRETE) return true;
  return CRAFT_RECIPES.some(r => r[0] === k) && !RECIPES.slice(0, RECIPES.length - CRAFT_RECIPES.length).some(r => r.key === k);
}));

// ---- Items, recipes, where things come from ----------------------------------------------------------

test('well over a hundred new things: each has a recipe or a source, a worth, an icon, a tab', () => {
  assert.ok(NEW_KEYS.size >= 150, `new things: ${NEW_KEYS.size}`);
  assert.ok(CRAFT_RECIPES.length >= 150, `new recipes: ${CRAFT_RECIPES.length}`);
  const entries = new Map(codexEntries().filter(e => !e.g).map(e => [e.key, e]));
  for (const key of NEW_KEYS) {
    const it = itemOf(key), e = entries.get(key);
    assert.ok(e && e.where && e.where !== 'Found in the world', `${key}: where it comes from (${e?.where})`);
    assert.ok(valueOf(key) > 0, `${key}: worth something`);
    assert.ok(Object.keys(CRAFT_CATS).includes(craftCategory(it)), `${key}: a crafting tab`);
  }
  // (A base's own things under Bases; boats with the tools.)
  for (const key of ['claim_flag', 'charter', 'arrow_turret', 'gun_turret', 'spikes', 'pressure_mine', 'alarm_bell', 'reinforced_bricks', 'iron_door', 'breach_charge', 'demo_charge', 'battering_ram']) {
    assert.equal(craftCategory(itemOf(key)), 'base', `${key}: under Bases`);
  }
  for (const key of ['raft', 'rowboat', 'sailboat']) assert.equal(craftCategory(itemOf(key)), 'gear', `${key}: with the tools`);
  // Every recipe resolves: what it makes and what from are things; where, a station.
  for (const r of RECIPES) {
    assert.ok(itemOf(r.key), `recipe ${r.id} makes ${r.key}`);
    for (const [k, n] of r.of) { assert.ok(itemOf(k), `${r.key} from ${k}`); assert.ok(n > 0); }
    if (r.at) { assert.ok(STATIONS.includes(r.at), `${r.key} at ${r.at}`); assert.ok(STATION_NAMES[r.at]); }
  }
  // Shops' stock is all things there are.
  for (const sh of Object.values(SHOPS)) for (const [k] of [...sh.sells, ...(sh.rare || [])]) assert.ok(itemOf(k), `shop sells ${k}`);
  // The new stations are blocks to put down, each a station.
  for (const st of ['stove', 'loom', 'mason', 'drafting']) assert.ok(K.BLOCKS.some(b => b.station === st && itemOf(b.key)), st);
  // Blocks: room left for more (a tile's block is a byte).
  assert.ok(K.BLOCKS.length <= 220, `blocks: ${K.BLOCKS.length} (of 256)`);
});

test('icons: every item draws (as an icon, in a hand\'s size, as a block in the world), in both games', () => {
  for (const it of ITEMS.values()) {
    for (const classic of [true, false]) {
      const { g } = recorder();
      assert.doesNotThrow(() => drawIcon(g, it, 0, 0, 20, classic, true), `${it.key}: icon`);
      assert.doesNotThrow(() => drawIcon(g, it, 0, 0, 10, classic, false), `${it.key}: small icon`);
      if (it.kind === 'block' || it.kind === 'wall') assert.doesNotThrow(() => drawTileIcon(g, it, 0, 0, 32, classic), `${it.key}: tile`);
    }
  }
  // And every new block and variant drawn in the world, standing on a table where it can.
  const world = new TileWorld({ seed: 5, name: 'Paint', gen: 3 });
  for (let y = 0; y < PATCH * 2; y++) for (let x = 0; x < PATCH * 2; x++) { world.setTile(x, y, y === 30 ? K.STONE : K.AIR); world.setWall(x, y, y % 3 ? K.PLANK_WALL : K.NO_WALL); }
  let x = 0;
  for (const it of ITEMS.values()) {
    if (it.kind !== 'block' || !NEW_KEYS.has(it.key)) continue;
    const tx = x % 30, ty = 2 + 3 * Math.floor(x / 30);
    world.setTile(tx, ty + 1, K.TABLE);
    world.setTile(tx, ty, it.block);
    if (it.paint) world.setPaint(tx, ty, it.paint);
    x++;
  }
  for (const look of ['classic', 'remastered']) {
    for (const [px, py] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const { g, calls } = recorder();
      assert.doesNotThrow(() => paintPatch(g, world, px, py, look, []), `${look}: picture ${px},${py}`);
      assert.ok(!calls.some(c => c.slice(1).some(v => typeof v === 'number' && Number.isNaN(v))), `${look}: nothing drawn at NaN`);
    }
  }
});

test('variants: a block\'s colour is kept with its tile (shape too), given back when it\'s broken, and saved', () => {
  const m = start(), { world, fx, fy } = m;
  // Blue carpet, red concrete, a birch table: each its own item, placing its block in its variant.
  hold(m, 'blue_carpet', 3);
  click(m, fx + 2, fy - 1);
  assert.equal(world.tile(fx + 2, fy - 1), K.CARPET);
  assert.equal(world.paint(fx + 2, fy - 1), K.BLOCKS[K.CARPET].variants.findIndex(v => v.key === 'blue_carpet'));
  hold(m, 'red_concrete', 3);
  click(m, fx + 3, fy - 1);
  assert.equal(world.tile(fx + 3, fy - 1), K.CONCRETE);
  assert.equal(painted(K.CONCRETE, world.paint(fx + 3, fy - 1)).name, 'Red concrete');
  // Hammered into a half block, it stays red (the shape and the paint are kept apart), and it's half a block to stand on.
  world.setShape(fx + 3, fy - 1, 1);
  assert.equal(world.shape(fx + 3, fy - 1), 1);
  assert.ok(world.paint(fx + 3, fy - 1) > 0, 'still red');
  assert.ok(!world.overlap((fx + 3) * TILE + 2, (fy - 1) * TILE + 1, (fx + 3) * TILE + 14, (fy - 1) * TILE + 7), 'its top half is open');
  assert.ok(world.overlap((fx + 3) * TILE + 2, (fy - 1) * TILE + 9, (fx + 3) * TILE + 14, (fy - 1) * TILE + 15), 'its bottom half is solid');
  // Broken: the blue carpet and the red concrete come back as themselves.
  breakBlock(m.game, fx + 2, fy - 1, m.me);
  breakBlock(m.game, fx + 3, fy - 1, m.me);
  assert.equal(onGround(m, 'blue_carpet'), 1);
  assert.equal(onGround(m, 'red_concrete'), 1);
  assert.equal(world.shapeByte(fx + 3, fy - 1), 0, 'gone, its paint with it');
  // A painted tile's chunk saved and loaded: its paint still there.
  world.setTile(fx + 5, fy - 1, K.WOOL);
  world.setPaint(fx + 5, fy - 1, 7);
  const c = world.chunk((fx + 5) >> 5, (fy - 1) >> 5), back = unpackBytes(packBytes(c.shape));
  const w2 = new TileWorld({ seed: 4242, name: 'Again', gen: 7, saved: new Map([[(c.cx + 1048576) * 64 + c.cy, { fg: c.fg.slice(), bg: c.bg.slice(), shape: back }]]) });
  assert.equal(w2.tile(fx + 5, fy - 1), K.WOOL);
  assert.equal(w2.paint(fx + 5, fy - 1), 7);
  // Slabs and stairs: put down shaped (a slab low, or high aimed at the tile's top; stairs the way you face).
  hold(m, 'stone_brick_slab', 2);
  click(m, fx + 4, fy - 1, 12);
  assert.equal(world.tile(fx + 4, fy - 1), K.STONE_BRICKS);
  assert.equal(K.SHAPES[world.shape(fx + 4, fy - 1)].key, 'bottom');
  click(m, fx + 4, fy - 2, 3);
  assert.equal(K.SHAPES[world.shape(fx + 4, fy - 2)].key, 'top');
  hold(m, 'roof_tile_stairs', 1);
  click(m, fx - 2, fy - 1);
  assert.equal(world.tile(fx - 2, fy - 1), K.ROOF_TILES);
  assert.match(K.SHAPES[world.shape(fx - 2, fy - 1)].key, /^ramp/);
});

test('from the world: flowers picked (which one, by its colour), reeds, kelp, a dead bush\'s sticks; dyes from them', () => {
  const m = start(), { world, fx, fy, game } = m;
  const got = [];
  for (let i = 0; i < 8; i++) {
    world.setTile(fx + 2 + i, fy - 1, K.FLOWER);
    breakBlock(game, fx + 2 + i, fy - 1, m.me);
  }
  for (const d of world.drops) got.push(d.key);
  assert.ok(got.length === 8 && got.every(k => ['rose', 'dandelion', 'violet', 'daisy'].includes(k)), `flowers: ${got}`);
  assert.ok(new Set(got).size > 1, 'more than one kind');
  world.drops = [];
  world.setTile(fx + 2, fy - 1, K.DEAD_BUSH);
  breakBlock(game, fx + 2, fy - 1, m.me);
  assert.ok(onGround(m, 'stick') >= 1, 'sticks');
  // A rose, made into red dye by hand.
  const inv = new Inventory();
  inv.add('rose', 1);
  const r = RECIPES.find(x => x.key === 'red_dye' && x.of[0][0] === 'rose');
  assert.equal(craft(inv, r, new Set()).made, 1);
  assert.equal(inv.count('red_dye'), 2);
  // A stove counts as a campfire: what a campfire cooks, it cooks.
  world.setTile(fx + 1, fy - 1, K.STOVE);
  const near = stationsNear(world, m.me.x, m.me.y - 8);
  assert.ok(near.has('stove') && near.has('campfire'));
  inv.add('raw_beef', 1);
  assert.equal(timesCanMake(inv, RECIPES.find(x => x.key === 'steak' && x.at === 'campfire'), near), 1);
});

// ---- Decorations that do something ---------------------------------------------------------------------

test('lamps light; candles and pots stand on tables; windows, trapdoors and gates open and shut', () => {
  const m = start(), { world, fx, fy, game } = m;
  for (const k of ['candle', 'paper_lantern', 'crystal_lamp', 'chandelier', 'lamp_post', 'red_candle', 'blue_paper_lantern']) assert.ok(K.LIGHT[itemOf(k).block] > 0, `${k} gives light`);
  // A candle on a table: it stands there; the table taken away, it falls.
  world.setTile(fx + 3, fy - 1, K.TABLE);
  hold(m, 'candle', 2);
  click(m, fx + 3, fy - 2);
  assert.equal(world.tile(fx + 3, fy - 2), K.CANDLE, 'on the table');
  assert.ok(decorSupported(world, fx + 3, fy - 2, K.CANDLE));
  breakBlock(game, fx + 3, fy - 1, m.me);
  assert.equal(world.tile(fx + 3, fy - 2), K.AIR, 'fell with it');
  assert.equal(onGround(m, 'candle'), 1);
  // A window: shut, solid; right clicked, open (walked through); again, shut.
  world.setTile(fx + 3, fy - 1, K.WINDOW);
  rightClick(m, fx + 3, fy - 1);
  assert.equal(world.tile(fx + 3, fy - 1), K.WINDOW_OPEN);
  rightClick(m, fx + 3, fy - 1);
  assert.equal(world.tile(fx + 3, fy - 1), K.WINDOW);
  // A trapdoor: shut, the top half of its tile, stood on; open, gone through.
  hold(m, 'trapdoor', 1);
  world.setTile(fx + 5, fy - 3, K.STONE);
  click(m, fx + 5, fy - 2);
  assert.equal(world.tile(fx + 5, fy - 2), K.TRAPDOOR);
  assert.equal(K.SHAPES[world.shape(fx + 5, fy - 2)].key, 'top');
  rightClick(m, fx + 5, fy - 2);
  assert.equal(world.tile(fx + 5, fy - 2), K.TRAPDOOR_OPEN);
  rightClick(m, fx + 5, fy - 2);
  assert.equal(K.SHAPES[world.shape(fx + 5, fy - 2)].key, 'top', 'shut again: a hatch again');
  // Broken open, a window gives a window.
  world.setTile(fx + 3, fy - 1, K.WINDOW_OPEN);
  breakBlock(game, fx + 3, fy - 1, m.me);
  assert.equal(onGround(m, 'window'), 1);
});

test('flower pots take a flower and give it back; chairs are sat in; signs say what\'s written on them', () => {
  const m = start(), { world, fx, fy, game, me } = m;
  world.setTile(fx + 2, fy - 1, K.FLOWER_POT);
  hold(m, 'cornflower', 2);
  rightClick(m, fx + 2, fy - 1);
  assert.equal(K.BLOCKS[K.FLOWER_POT].variants[world.paint(fx + 2, fy - 1)].key, 'cornflower', 'planted');
  assert.equal(me.world.inv.count('cornflower'), 1, 'one used');
  rightClick(m, fx + 2, fy - 1);
  assert.equal(world.paint(fx + 2, fy - 1), 0, 'taken out again');
  assert.equal(me.world.inv.count('cornflower'), 2);
  rightClick(m, fx + 2, fy - 1);
  breakBlock(game, fx + 2, fy - 1, me);
  assert.equal(onGround(m, 'flower_pot'), 1);
  assert.equal(onGround(m, 'cornflower'), 1, 'its flower too');
  // A chair: sat in; moving, up again.
  hold(m, 'apple', 1);
  world.setTile(fx + 2, fy - 1, K.CHAIR);
  world.setPaint(fx + 2, fy - 1, 3);
  rightClick(m, fx + 2, fy - 1);
  assert.ok(me.world.sit && me.sitting, 'sitting');
  assert.ok(Math.abs(me.x - ((fx + 2) * TILE + 8)) < 1, 'on the chair');
  run(game, 30);
  assert.ok(me.sitting, 'still sitting');
  m.ctl.script = { move: 1 };
  run(game, 3);
  assert.ok(!me.world.sit && !me.sitting, 'up');
  m.ctl.script = { move: 0 };
  run(game, 10);
  // A sign: put up, it's to be written on; written, it says so (and is saved, and gone when it's broken).
  hold(m, 'sign', 1);
  click(m, fx + 4, fy - 1);
  assert.equal(world.tile(fx + 4, fy - 1), K.SIGN);
  assert.ok(me.world.signEdit && me.world.signEdit.tx === fx + 4, 'asked what it says');
  assert.ok(signWrite(game, me, fx + 4, fy - 1, '  Welcome   home!\n'));
  assert.equal(signText(world, fx + 4, fy - 1), 'Welcome home!');
  const saved = signsToSave(world);
  const w2 = new TileWorld({ seed: 1, name: 'Signs' });
  w2.setTile(fx + 4, fy - 1, K.SIGN);
  signsFromSave(w2, saved);
  assert.equal(signText(w2, fx + 4, fy - 1), 'Welcome home!');
  // Someone else's base: not theirs to write on.
  world.claims = new Map([[`${fx + 4},${fy - 5}`, { tx: fx + 4, ty: fy - 5, owner: 'Someone' }]]);
  assert.ok(!signWrite(game, me, fx + 4, fy - 1, 'Mine now'));
  world.claims = new Map();
  breakBlock(game, fx + 4, fy - 1, me);
  assert.equal(signText(world, fx + 4, fy - 1), '');
  assert.equal(signsToSave(world).length, 0);
});

// ---- Blueprints -----------------------------------------------------------------------------------------

test('blueprints: each building fits its own rows, uses up what it\'s made of, and goes up, block by block', () => {
  for (const [key, , kit] of BLUEPRINTS) {
    assert.ok(BUILDINGS[kit], `${key}: its building`);
    const rows = BUILDINGS[kit].rows;
    assert.ok(rows.every(r => r.length === rows[0].length) && BUILDINGS[kit].walls.length === rows.length, `${kit}: rows the same size`);
    assert.ok(kitNeeds(kit).length > 0);
    assert.ok(RECIPES.some(r => r.key === key && r.at === 'drafting'), `${key}: drawn up at a drafting table`);
  }
  const m = start(), { world, fx, fy, game, me } = m;
  const tx = fx + 10, ty = fy - 1;
  // Not enough: it says what's short, and nothing's built.
  hold(m, 'blueprint_cottage', 1);
  click(m, tx, ty);
  assert.ok(!world.builds?.length, 'nothing going up');
  // Everything it needs: it goes up over a few seconds, and what it needed is used up.
  for (const [k, n] of kitNeeds('cottage')) me.world.inv.add(k, n);
  const before = Object.fromEntries(kitNeeds('cottage').map(([k]) => [k, me.world.inv.count(k)]));
  click(m, tx, ty);
  assert.equal(world.builds?.length, 1, 'going up');
  for (const [k, n] of kitNeeds('cottage')) assert.equal(me.world.inv.count(k), before[k] - n, `${k} used`);
  run(game, 20);
  assert.ok(world.builds.length === 1, 'still going up after a moment');
  run(game, 400);
  assert.ok(!world.builds.length, 'up');
  for (const c of kitCells('cottage')) {
    if (c.layer === 'fg') assert.equal(world.tile(tx + c.dx, ty + c.dy), c.id, `cottage at ${c.dx},${c.dy}`);
    if (c.layer === 'bg') assert.equal(world.wall(tx + c.dx, ty + c.dy), c.id);
    if (c.layer === 'fg' && c.shape) assert.equal(world.shape(tx + c.dx, ty + c.dy), c.shape);
  }
  assert.ok(world.tile(tx - 3, ty - 1) === K.BED && world.tile(tx, ty - 2) === K.CANDLE && world.tile(tx, ty - 1) === K.TABLE, 'furnished');
  // Where it's built already: refused, and why.
  const check = kitCheck(game, 'cottage', false, tx, ty);
  assert.ok(!check.ok && check.bad.length > 0 && /in the way/.test(check.why));
  // In the air (no ground), in a town or someone's base: refused.
  assert.ok(!kitCheck(game, 'wall', false, fx - 20, fy - 12).ok, 'no ground under it');
  world.claims = new Map([[`${fx - 20},${fy - 3}`, { tx: fx - 20, ty: fy - 3, owner: 'Someone' }]]);
  assert.match(kitCheck(game, 'wall', false, fx - 20, fy - 1, (x, y) => mayChange(world, me, x, y)).why, /base/);
  world.claims = new Map();
  // Flipped (R): the other way round, its ramps the other way.
  for (const c of kitCells('cottage')) {
    const f = kitCells('cottage', true).find(o => o.dx === -c.dx && o.dy === c.dy && o.layer === c.layer);
    assert.ok(f && f.id === c.id, `flipped ${c.dx},${c.dy}`);
    if (c.shape === 3) assert.equal(f.shape, 4);
  }
  // Undo: the whole of it comes down, and what it used comes back.
  const planks = me.world.inv.count('planks');
  assert.match(buildAction(game, me, 'undo'), /Undone/);
  assert.equal(world.tile(tx - 3, ty - 1), K.AIR, 'gone');
  assert.equal(me.world.inv.count('planks') + onGround(m, 'planks'), planks + kitNeeds('cottage').find(([k]) => k === 'planks')[1], 'planks back');
  // A bridge: over a gap, with ground at both ends.
  const bx = fx - 16;
  for (let x = bx - 8; x <= bx + 8; x++) for (let y = fy; y <= fy + 4; y++) world.setTile(x, y, Math.abs(x - bx) >= 7 ? K.STONE : K.AIR);
  assert.ok(kitCheck(game, 'bridge', false, bx, fy - 1).ok, 'a bridge over the gap');
  assert.ok(!kitCheck(game, 'bridge', false, bx + 3, fy - 1).ok, 'not with an end over nothing');
});

test('blueprints: what\'s still going up is finished before the world is saved; dev mode builds for free', () => {
  const m = start(), { world, fx, fy, game, me } = m;
  me.world.dev = { brush: 1, fly: false, god: true };
  hold(m, 'blueprint_watchtower', 1);
  const had = me.world.inv.count('stone_bricks');
  click(m, fx + 8, fy - 1);
  assert.equal(world.builds?.length, 1);
  assert.equal(me.world.inv.count('stone_bricks'), had, 'free');
  finishBuildings(game);
  assert.ok(!world.builds.length);
  for (const c of kitCells('watchtower')) if (c.layer === 'fg') assert.equal(world.tile(fx + 8 + c.dx, fy - 1 + c.dy), c.id);
  // Aimed at the ground: its bottom row goes into it, flush; undone, the ground's back.
  m.ctl.script = { move: 0, switchTo: '#1' };
  me.world.inv.slots[1] = { key: 'blueprint_wall', n: 1 };
  run(game, 2);
  assert.ok(kitCheck(game, 'wall', false, fx - 8, fy).ok, 'on the ground row');
  click(m, fx - 8, fy);
  finishBuildings(game);
  assert.equal(world.tile(fx - 8, fy), K.COBBLESTONE, 'the foundation, in the ground');
  assert.equal(world.tile(fx - 8, fy - 1), K.STONE_BRICKS);
  buildAction(game, me, 'undo');
  assert.equal(world.tile(fx - 8, fy), K.STONE, 'the ground back');
  assert.equal(world.tile(fx - 8, fy - 1), K.AIR);
});

// ---- Building quicker ------------------------------------------------------------------------------------

test('pick block, fill, replace and undo', () => {
  const m = start(), { world, fx, fy, game, me } = m;
  const inv = me.world.inv;
  // Pick block: what's under the crosshair, from the bag into the hand.
  inv.slots.fill(null);
  inv.slots[HOTBAR + 3] = { key: 'polished_marble', n: 20 };
  inv.version++;
  world.setTile(fx - 3, fy - 1, K.POLISHED);
  world.setPaint(fx - 3, fy - 1, K.BLOCKS[K.POLISHED].variants.findIndex(v => v.key === 'polished_marble'));
  aim(m, fx - 3, fy - 1);
  buildAction(game, me, 'pick');
  assert.equal(inv.slots[me.world.slot]?.key, 'polished_marble', 'in hand');
  // Already in the hotbar: that slot chosen.
  inv.slots[7] = { key: 'planks', n: 5 };
  world.setTile(fx - 4, fy - 1, K.PLANKS);
  aim(m, fx - 4, fy - 1);
  buildAction(game, me, 'pick');
  assert.equal(me.world.slot, 7);
  // Fill: a room closed in with stone, filled with planks; the open air, not.
  for (let x = fx + 1; x <= fx + 5; x++) { world.setTile(x, fy - 5, K.STONE); world.setTile(x, fy - 1, K.STONE); }
  for (let y = fy - 5; y <= fy - 1; y++) { world.setTile(fx + 1, y, K.STONE); world.setTile(fx + 5, y, K.STONE); }
  assert.equal(fillTiles(world, fx + 3, fy - 3)?.length, 9, 'three by three inside');
  assert.equal(fillTiles(world, fx - 10, fy - 10), null, 'the open air: spills out');
  inv.slots[0] = { key: 'planks', n: 30 };
  inv.version++;
  me.world.brush = 'fill';
  m.ctl.script = { move: 0, switchTo: '#0' };
  run(game, 2);
  click(m, fx + 3, fy - 3);
  assert.equal(world.tile(fx + 3, fy - 3), K.PLANKS, 'filled');
  assert.equal(inv.count('planks'), 30 + 5 - 9);
  // Undo: the fill comes out, the planks come back.
  buildAction(game, me, 'undo');
  assert.equal(world.tile(fx + 3, fy - 3), K.AIR);
  assert.equal(inv.count('planks'), 35);
  // Replace: the stone round the room becomes bricks, the stone given back.
  inv.slots[1] = { key: 'bricks', n: 40 };
  inv.version++;
  me.world.brush = 'replace';
  m.ctl.script = { move: 0, switchTo: '#1' };
  run(game, 2);
  const ring = replaceTiles(world, fx + 1, fy - 3);
  assert.ok(ring && ring.length >= 16, `the joined stone: ${ring?.length}`);
  const stone = inv.count('stone');
  click(m, fx + 1, fy - 3);
  assert.equal(world.tile(fx + 1, fy - 3), K.BRICKS);
  assert.ok(inv.count('stone') + onGround(m, 'stone') > stone, 'the stone given back');
  // Undo puts the stone back (taking it again), the bricks back in hand.
  const bricks = inv.count('bricks');
  buildAction(game, me, 'undo');
  assert.equal(world.tile(fx + 1, fy - 3), K.STONE);
  assert.ok(inv.count('bricks') > bricks);
  assert.match(buildAction(game, me, 'undo'), /Nothing to undo|Undone|Nothing left/);
  assert.deepEqual(BRUSHES.slice(-2), ['fill', 'replace']);
});

// ---- Online ----------------------------------------------------------------------------------------------

test('online: a guest\'s coloured blocks, signs, blueprints, pick block and undo, all through the host', async () => {
  const world = new TileWorld({ seed: 4242, name: 'Shared', gen: 7 });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, effects: true, seed: 1, options: { destruction: true } });
  game.online = true;
  game.addSoldier({ name: 'Host', isBot: false }, { input: () => ({ move: 0 }) });
  const sync = new WorldHost(game, {});
  const net = new NetHost({ maxPlayers: 8, botCount: 0, world: sync, matchInfo: () => ({ mode: 'world', mapName: world.name, speed: DEFAULT_SPEED, options: game.options, world: sync.info() }), addBot: () => {} });
  net.setGame(game);
  let now = 0, input = { move: 0 };
  const queue = [], schedule = (fn, ms) => queue.push({ fn, at: now + ms });
  const [h, c] = memoryLinks({ latency: 20, schedule });
  const seen = { sign: null };
  const wc = new WorldClient({ onSign: s => { seen.sign = s; } });
  const client = new NetClient({ link: c, controller: { input: () => input }, loadMap: async () => null, clock: () => now, world: wc });
  net.addPlayer(h, 'Guest');
  const pump = async () => { for (let k = 0; k < 4; k++) { await new Promise(r => setImmediate(r)); for (const q of queue.filter(q => q.at <= now)) { queue.splice(queue.indexOf(q), 1); q.fn(); } } };
  const step = async (n = 1) => { for (let i = 0; i < n; i++) { game.update(); net.afterTick(); client.tick(); now += 1000 / 60; await pump(); client.updateView(now); } };
  await pump();
  await step(120);
  world.devQuiet = true;
  const guest = game.soldiers.find(s => s.remote), cw = client.game.world;
  const gx = Math.floor(guest.x / TILE), gy = Math.floor((guest.y + 13) / TILE);
  for (let x = gx - 12; x <= gx + 12; x++) for (let y = gy - 12; y <= gy + 1; y++) { world.setTile(x, y, y >= gy ? K.STONE : K.AIR); world.setWall(x, y, K.NO_WALL); }
  await step(10);
  // A coloured block: the guest's copy of the world has its colour too.
  world.setTile(gx + 2, gy - 1, K.WOOL);
  world.setPaint(gx + 2, gy - 1, 9);
  await step(10);
  assert.equal(cw.tile(gx + 2, gy - 1), K.WOOL);
  assert.equal(cw.paint(gx + 2, gy - 1), 9, 'its colour, sent');
  // A sign: the guest's to write on (asked on their screen), written through the host, and seen.
  world.setTile(gx - 2, gy - 1, K.SIGN);
  guest.world.signEdit = { tx: gx - 2, ty: gy - 1, text: '' };
  await step(6);
  assert.deepEqual([seen.sign?.tx, seen.sign?.ty], [gx - 2, gy - 1], 'asked to write on it');
  c.send({ t: 'wop', op: 'sign', tx: gx - 2, ty: gy - 1, text: 'The guest was here' }, true);
  await step(40);
  assert.equal(signText(world, gx - 2, gy - 1), 'The guest was here');
  assert.equal(signText(cw, gx - 2, gy - 1), 'The guest was here', 'the guest sees it');
  // Sat in a chair: everyone sees it.
  world.setTile(gx + 4, gy - 1, K.CHAIR);
  const { sitDown } = await import('../web/src/world/decor.js');
  sitDown(game, guest, gx + 4, gy - 1);
  await step(20);
  assert.ok(client.game.soldiers.find(s => s.id === guest.id)?.sitting, 'sitting, on the guest\'s screen');
  input = { move: 1 };
  await step(6);
  input = { move: 0 };
  await step(6);
  assert.ok(!guest.sitting, 'up');
  // A blueprint, through the host: the wall goes up, then undone by the guest.
  guest.world.inv.slots[0] = { key: 'blueprint_wall', n: 1 };
  for (const [k, n] of kitNeeds('wall')) guest.world.inv.add(k, n);
  guest.world.inv.version++;
  guest.world.slot = 0;
  const bricks = guest.world.inv.count('stone_bricks');
  const ax = Math.floor(guest.x / TILE) + 6, ay = gy - 1;
  const at = { aim: Math.atan2(ay * TILE + 8 - guest.shoulderY, ax * TILE + 8 - guest.shoulderX), aimDist: Math.hypot(ax * TILE + 8 - guest.shoulderX, ay * TILE + 8 - guest.shoulderY) };
  input = { move: 0, fire: true, firePressed: true, ...at };
  await step(2);
  input = { move: 0, ...at };
  await step(300);
  assert.equal(world.tile(ax, ay), K.COBBLESTONE, 'the wall section, up');
  assert.equal(cw.tile(ax, ay - 1), K.STONE_BRICKS, 'and on the guest\'s screen');
  assert.equal(guest.world.inv.count('stone_bricks'), bricks - 25, 'their stone bricks used');
  c.send({ t: 'wop', op: 'undo' }, true);
  await step(20);
  assert.equal(world.tile(ax, ay), K.AIR, 'undone');
  assert.equal(guest.world.inv.count('stone_bricks') + onGround({ world }, 'stone_bricks'), bricks, 'its stone bricks back');
  // Pick block, through the host: what they aim at, into their hand.
  guest.world.inv.slots[HOTBAR + 1] = { key: 'red_wool', n: 4 };
  guest.world.inv.version++;
  const wool = { aim: Math.atan2((gy - 1) * TILE + 8 - guest.shoulderY, (gx + 2) * TILE + 8 - guest.shoulderX), aimDist: Math.hypot((gx + 2) * TILE + 8 - guest.shoulderX, (gy - 1) * TILE + 8 - guest.shoulderY) };
  world.setPaint(gx + 2, gy - 1, K.BLOCKS[K.WOOL].variants.findIndex(v => v.key === 'red_wool'));
  input = { move: 0, ...wool };
  await step(4);
  c.send({ t: 'wop', op: 'pick' }, true);
  await step(10);
  assert.equal(guest.world.inv.slots[guest.world.slot]?.key, 'red_wool', 'in their hand');
  assert.equal(client.me.world.inv.slots[client.me.world.slot]?.key, 'red_wool', 'as their screen has it');
});
