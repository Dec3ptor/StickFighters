// More biomes and dense forests (worlds made since forests: worldgen.js's gen 5): birch forests,
// dark forests, taiga (and snowy, and old spruce forests), savanna, cherry groves, flower
// meadows, bamboo jungles and mushroom fields; forests far denser than before, with many kinds
// of tree (two trunks wide, bent, curved, mushrooms you stand on); what grows under them; fallen
// logs and boulders; palms on warm shores. Trees felled whole, whatever their shape.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { TileWorld } from '../web/src/world/tileworld.js';
import { WorldGen, BIOMES, WORLD_H } from '../web/src/world/worldgen.js';
import * as K from '../web/src/world/blocks.js';
import { TILE, SOLID, AIR, TRUNKS } from '../web/src/world/blocks.js';
import { Inventory, itemOf } from '../web/src/world/items.js';
import { breakBlock, canPlace } from '../web/src/world/worldplay.js';
import { WORLD_GEN } from '../web/src/world/worldsave.js';

const SEED = 777;
const gen5 = new WorldGen(SEED, { gen: 5 });

/** The widest stretch of biome `key` away from towns (and the edges of its region), of those near where everyone starts. */
function regionOf(g, key) {
  let best = null;
  for (let k = g.spawnRegion - 95; k <= g.spawnRegion + 95; k++) {
    if (g.regionBiome(k).key !== key) continue;
    const t = g.townIn(k), a = g.edge(k) + 45, b = g.edge(k + 1) - 45;
    for (const [x0, x1] of t ? [[a, t.x0 - 30], [t.x1 + 30, b]] : [[a, b]]) if (x1 - x0 > (best ? best.x1 - best.x0 : 30)) best = { k, x0, x1 };
  }
  return best;
}

test('new worlds are made with forests; their biomes are new to them', () => {
  assert.equal(WORLD_GEN, 5);
  const keys = BIOMES.filter(b => b.since === 5).map(b => b.key);
  assert.ok(keys.length >= 10, 'ten new biomes');
  const seen = new Set(), seenOld = new Set();
  for (const seed of [SEED, 2, 4242, 99]) {
    const g = new WorldGen(seed, { gen: 5 }), old = new WorldGen(seed, { gen: 4 });
    for (let k = g.spawnRegion - 90; k <= g.spawnRegion + 90; k++) { seen.add(g.regionBiome(k).key); seenOld.add(old.regionBiome(k).key); }
  }
  for (const key of keys.filter(k => k !== 'mushroom_fields')) assert.ok(seen.has(key), `${key} in a new world`);
  for (const key of keys) assert.ok(!seenOld.has(key), `${key}: not in a world made before`);
});

test('forests are dense: a trunk every few tiles, far more than before', () => {
  const count = (g, x0, x1) => { let n = 0; for (let x = x0; x <= x1; x++) if (g.treeAt(x)) n++; return n / (x1 - x0 + 1) * 100; };
  for (const key of ['forest', 'dark_forest', 'taiga', 'birch_forest']) {
    const r = regionOf(gen5, key);
    assert.ok(r, `a ${key}`);
    const d = count(gen5, r.x0, r.x1);
    assert.ok(d >= 12, `${key}: ${d.toFixed(1)} trees per 100 tiles`);
  }
  // Before forests: a forest had a tree every eight tiles or so.
  const old = new WorldGen(SEED, { gen: 4 }), ro = regionOf(old, 'forest');
  const before = count(old, ro.x0, ro.x1), now = count(gen5, regionOf(gen5, 'forest').x0, regionOf(gen5, 'forest').x1);
  assert.ok(now > before * 1.6, `denser than before (${now.toFixed(1)} against ${before.toFixed(1)})`);
});

test('every kind of tree grows, each in its own lands, standing on the ground and never in water', () => {
  const kinds = new Map(), world = new TileWorld({ seed: SEED, gen: 5 }), g = world.gen;
  for (let k = g.spawnRegion - 90; k <= g.spawnRegion + 90; k++) {
    const a = g.edge(k), b = g.edge(k + 1);
    for (let x = a; x < b; x += 1) {
      const t = g.treeAt(x);
      if (!t) continue;
      if (!kinds.has(t.kind)) kinds.set(t.kind, { t, biome: g.biomeAt(x).key });
    }
  }
  for (const kind of ['oak', 'big_oak', 'birch', 'tall_birch', 'dark_oak', 'spruce', 'snowy_spruce', 'mega_spruce', 'jungle', 'acacia', 'cherry', 'giant_mushroom', 'swamp', 'cactus', 'palm']) {
    assert.ok(kinds.has(kind), `${kind} trees grow`);
  }
  assert.equal(kinds.get('acacia').biome, 'savanna');
  assert.equal(kinds.get('cherry').biome, 'cherry_grove');
  // Each one, as made: its trunk on solid ground; no water in its column.
  for (const [kind, { t }] of kinds) {
    for (let c = 0; c < t.w; c++) {
      const below = world.tile(t.x + c, t.base), foot = world.tile(t.x + c, t.base - 1);
      assert.ok(SOLID[below], `${kind} at ${t.x}: on the ground`);
      if (kind !== 'palm') assert.ok(TRUNKS.has(foot) || foot === K.CACTUS, `${kind} at ${t.x}: its trunk from the ground up (${K.BLOCKS[foot].key})`);
    }
    assert.equal(g.waterTop(t.x), WORLD_H, `${kind}: not in water`);
  }
});

test('what grows under the trees, and lies on the ground: each land its own', () => {
  const world = new TileWorld({ seed: SEED, gen: 5 }), g = world.gen;
  const find = (key, blocks) => {
    const r = regionOf(g, key), seen = new Map();
    for (let x = r.x0; x <= r.x1; x++) {
      const s = g.surfaceAt(x);
      for (let y = s - 14; y < s; y++) { const b = world.tile(x, y); if (blocks.includes(b)) seen.set(b, (seen.get(b) || 0) + 1); }
    }
    return seen;
  };
  assert.ok(find('taiga', [K.FERN]).get(K.FERN) > 5, 'ferns in the taiga');
  assert.ok(find('savanna', [K.DRY_TALL_GRASS]).get(K.DRY_TALL_GRASS) > 10, 'dry grass on the savanna');
  assert.ok(find('cherry_grove', [K.PETALS]).get(K.PETALS) > 5, 'petals under the cherry trees');
  assert.ok(find('meadow', [K.FLOWER]).get(K.FLOWER) > 15, 'a meadow full of flowers');
  assert.ok(find('bamboo_jungle', [K.BAMBOO]).get(K.BAMBOO) > 20, 'bamboo in the bamboo jungle');
  const forest = find('forest', [K.BUSH, K.FERN, K.BERRY_BUSH]);
  assert.ok(forest.get(K.BUSH) > 3 && forest.get(K.FERN) > 3, 'bushes and ferns in the forest');
  // Fallen logs and boulders, somewhere in the forests.
  let logs = 0, boulders = 0;
  for (const key of ['forest', 'dark_forest', 'taiga', 'giant_taiga', 'birch_forest']) {
    const s = find(key, [K.FALLEN_LOG, K.MOSSY_COBBLE]);
    logs += s.get(K.FALLEN_LOG) || 0;
    boulders += s.get(K.MOSSY_COBBLE) || 0;
  }
  assert.ok(logs > 0 && boulders > 0, `fallen logs (${logs}) and boulders (${boulders})`);
  // Moss on the dark forest's floor; podzol in the taiga; mycelium in mushroom fields.
  const top = key => { const r = regionOf(g, key), seen = new Set(); for (let x = r.x0; x <= r.x1; x++) seen.add(world.tile(x, g.surfaceAt(x))); return seen; };
  assert.ok(top('dark_forest').has(K.MOSS), 'moss in the dark forest');
  assert.ok(top('taiga').has(K.PODZOL), 'podzol in the taiga');
  assert.ok(top('savanna').has(K.DRY_GRASS), 'dry grass ground on the savanna');
});

function play() {
  const world = new TileWorld({ seed: SEED, name: 'Forest', gen: 5 });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const me = game.addSoldier({ name: 'Woodcutter', isBot: false }, { input: () => ({ move: 0 }) });
  for (let i = 0; i < 300 && !me.alive; i++) game.update();
  me.world.inv = new Inventory();
  return { world, game, me };
}

/** The first tree of `kind` in the world (and a world with it in). */
function firstTree(g, kind) {
  for (let k = g.spawnRegion - 90; k <= g.spawnRegion + 90; k++) {
    for (let x = g.edge(k); x < g.edge(k + 1); x++) { const t = g.treeAt(x); if (t?.kind === kind) return t; }
  }
  return null;
}

test('felled whole, whatever its shape: two trunks wide, branching, bent; its crown with it, its neighbours\' left', () => {
  const { world, game } = play(), g = world.gen;
  for (const kind of ['dark_oak', 'acacia', 'big_oak', 'mega_spruce', 'palm', 'cherry']) {
    const t = firstTree(g, kind);
    assert.ok(t, `a ${kind}`);
    const box = [t.x - t.reach, t.top, t.x + t.reach, t.base - 1];
    const trunkTiles = () => { let n = 0; for (let y = box[1]; y <= box[3]; y++) for (let x = box[0]; x <= box[2]; x++) if (TRUNKS.has(world.tile(x, y)) && Math.abs(x - t.x) <= (kind === 'acacia' || kind === 'palm' ? 4 : 2)) n++; return n; };
    // (Its own crown: where it puts leaves, and there are leaves, before it's cut; right over its
    // trunk, where no neighbour's crown reaches.)
    const own = [];
    for (let y = box[1]; y <= box[3]; y++) for (let x = t.x - 1; x <= t.x + t.w; x++) { const b = g.treeTile5(t, x, y); if (K.LEAVES_ALL.has(b) && world.tile(x, y) === b) own.push([x, y]); }
    const leaves = () => own.filter(([x, y]) => K.LEAVES_ALL.has(world.tile(x, y))).length;
    const crown = leaves();
    assert.ok(trunkTiles() > 2 && leaves() > 0, `${kind}: a trunk and a crown`);
    const drops = world.drops?.length ?? 0;
    // Cut at the foot.
    breakBlock(game, t.x, t.base - 1);
    assert.ok(!TRUNKS.has(world.tile(t.x, t.base - 1)), `${kind}: cut`);
    for (let y = t.top; y < t.base; y++) for (let c = 0; c < t.w; c++) assert.ok(!TRUNKS.has(world.tile(t.x + c, y)) || y >= t.base - 1, `${kind}: all of its trunk down (${t.x + c},${y})`);
    assert.ok(leaves() <= crown * 0.1, `${kind}: its crown gone too (${leaves()} of ${crown} left)`);
    assert.ok((world.drops?.length ?? 0) > drops || game.world.drops === undefined, `${kind}: wood`);
  }
});

test('giant mushrooms: their caps stood on; felled, they give no wood', () => {
  const { world, game } = play(), g = world.gen, t = firstTree(g, 'giant_mushroom');
  assert.ok(t);
  let capY = -1;
  for (let y = t.top; y < t.base && capY < 0; y++) if (K.CAPS.has(world.tile(t.x, y))) capY = y;
  assert.ok(capY >= 0, 'a cap over its stem');
  assert.ok(world.support((t.x * TILE) + 2, capY * TILE - 1, (t.x * TILE) + 10, capY * TILE + 1), 'stood on');
  breakBlock(game, t.x, t.base - 1);
  assert.ok(!K.CAPS.has(world.tile(t.x, capY)), 'its cap down with it');
});

test('berry bushes give berries (to eat); bamboo stands on the ground or more bamboo; plants are built over', () => {
  const { world, game } = play();
  assert.equal(itemOf('berries')?.kind, 'food');
  const x = Math.floor(game.soldiers[0].x / TILE), top = xx => world.gen.surfaceAt(xx) - 1;
  world.setTile(x + 3, top(x + 3), K.BERRY_BUSH);
  const before = world.drops?.length ?? 0;
  breakBlock(game, x + 3, top(x + 3));
  assert.ok((world.drops?.length ?? 0) > before && world.drops.at(-1).key === 'berries', 'berries');
  // Bamboo: the bottom of a stalk cut, the rest comes down.
  const y = top(x + 5);
  world.setTile(x + 5, y, K.BAMBOO); world.setTile(x + 5, y - 1, K.BAMBOO); world.setTile(x + 5, y - 2, K.BAMBOO);
  breakBlock(game, x + 5, y);
  assert.equal(world.tile(x + 5, y - 2), AIR, 'the stalk came down');
  // Ferns: built over.
  world.setTile(x + 6, top(x + 6), K.FERN);
  assert.ok(canPlace(game, itemOf('stone'), x + 6, top(x + 6)), 'a block goes in place of a fern');
});

test('palms on warm shores', () => {
  let palms = 0;
  for (const seed of [SEED, 2, 4242]) {
    const g = new WorldGen(seed, { gen: 5 });
    for (let k = g.spawnRegion - 60; k <= g.spawnRegion + 60; k++) {
      const sp = g.seaSpan(k);
      if (!sp) continue;
      for (let x = sp.x0 - 12; x <= sp.x0; x++) if (g.treeAt(x)?.kind === 'palm') palms++;
      for (let x = sp.x1; x <= sp.x1 + 12; x++) if (g.treeAt(x)?.kind === 'palm') palms++;
    }
  }
  assert.ok(palms > 0, `palms on the shores (${palms})`);
});

test('chunks are made as quickly as before', () => {
  const fg = new Uint8Array(1024), bg = new Uint8Array(1024), sh = new Uint8Array(1024);
  const time = g => { const t0 = performance.now(); let n = 0; for (let cx = -40; cx < 40; cx++) for (let cy = 3; cy < 7; cy++) { g.fillChunk(cx, cy, fg, bg, sh); n++; } return (performance.now() - t0) / n; };
  time(new WorldGen(31, { gen: 5 }));
  const before = time(new WorldGen(SEED, { gen: 4 })), now = time(new WorldGen(SEED, { gen: 5 }));
  assert.ok(now < Math.max(2, before * 2.5), `${now.toFixed(2)} ms a chunk (before: ${before.toFixed(2)})`);
});
