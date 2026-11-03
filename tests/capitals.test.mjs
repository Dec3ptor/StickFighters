// Capitals and harbours (worlds made since capitals: worldgen.js's gen 6, towns.js): a capital
// takes two regions, hundreds of blocks across (great gates, a grand plaza with a fountain, a
// cathedral, a palace on a terrace, the market, inn, smiths, library, guild hall, counting house,
// barracks, rows of townhouses with walkways between their upper floors, and the undercity under
// its street); towns by the sea have a harbour (a road down to it, a pier, a lighthouse, boats).
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { TileWorld } from '../web/src/world/tileworld.js';
import { WorldGen, SEA_ROW, WORLD_H } from '../web/src/world/worldgen.js';
import * as K from '../web/src/world/blocks.js';
import { SOLID, PLATFORMS, LIQUID, AIR } from '../web/src/world/blocks.js';
import { folkOf } from '../web/src/world/townsfolk.js';

const SEED = 777;

/** The capital nearest where everyone starts (and its region). */
function nearestCapital(g) {
  for (let d = 0; d < 60; d++) for (const k of [g.spawnRegion + d, g.spawnRegion - d]) if (g.capitalStart(k)) return g.townIn(k);
  return null;
}

test('capitals: now and then in new worlds (one near the start), never in worlds made before; each takes two regions', () => {
  for (const seed of [SEED, 2, 4242]) {
    const g = new WorldGen(seed, { gen: 6 }), old = new WorldGen(seed, { gen: 5 });
    const caps = [];
    for (let k = g.spawnRegion - 100; k <= g.spawnRegion + 100; k++) {
      if (g.capitalStart(k)) caps.push(k);
      assert.ok(!old.capitalStart(k) && old.townIn(k)?.kind !== 'capital', 'none in a world made before');
    }
    assert.ok(caps.length >= 5, `seed ${seed}: ${caps.length} capitals`);
    assert.ok(caps.some(k => Math.abs(k - g.spawnRegion) <= 12), `seed ${seed}: one near the start`);
    for (const k of caps) {
      const t = g.townIn(k);
      assert.equal(t.kind, 'capital');
      assert.ok(t.title && t.name, 'a name and a title');
      assert.equal(g.townIn(k + 1), null, 'the next region: no town of its own');
      assert.equal(g.townOf(k + 1), t, '...the capital\'s');
      assert.equal(g.regionBiome(k + 1), g.regionBiome(k), 'the same land');
      assert.ok(t.x1 - t.x0 >= 380, `seed ${seed}: ${t.x1 - t.x0} blocks across`);
      assert.ok(t.x1 > g.edge(k + 1), 'into its second region');
    }
  }
});

test('what\'s in a capital: great gates, its landmarks, its trades, rows of townhouses, and the undercity\'s', () => {
  const g = new WorldGen(SEED, { gen: 6 }), t = nearestCapital(g);
  const kinds = t.buildings.map(b => b.kind);
  for (const k of ['palace', 'cathedral', 'grandplaza', 'market', 'inn', 'smithy', 'gunsmith', 'library', 'guildhall', 'bank', 'barracks', 'cellarbar', 'blackmarket', 'vault']) assert.ok(kinds.includes(k), `a ${k}`);
  assert.equal(kinds.filter(k => k === 'greatgate').length, 2, 'a great gate at each end');
  assert.ok(kinds.filter(k => k === 'townhouse').length >= 6, 'rows of townhouses');
  const palace = t.buildings.find(b => b.kind === 'palace');
  assert.ok(palace.base < t.level, 'the palace up on its terrace');
  for (const b of t.buildings.filter(o => o.under)) assert.ok(b.base > t.level + 8, `${b.kind}: under the street`);
  // Nothing overlaps on the street.
  const street = t.buildings.filter(b => !b.under).sort((a, b) => a.x0 - b.x0);
  for (let i = 1; i < street.length; i++) assert.ok(street[i].x0 > street[i - 1].x1, `${street[i - 1].kind} and ${street[i].kind} apart`);
});

test('its blocks: the fountain\'s water, the undercity\'s street with shafts down to it, walkways between upper floors', () => {
  const world = new TileWorld({ seed: SEED, gen: 6 }), g = world.gen, t = nearestCapital(g), lv = t.level;
  const plaza = t.buildings.find(b => b.kind === 'grandplaza'), m = (plaza.x0 + plaza.x1) >> 1;
  assert.equal(world.tile(m - 2, lv), K.WATER, 'the fountain\'s water');
  // The undercity: open along its length, between its ceiling and floor.
  let open = 0, n = 0;
  for (let x = t.x0 + 20; x <= t.x1 - 20; x++) { n++; if (!SOLID[world.tile(x, lv + 9)] && !SOLID[world.tile(x, lv + 10)]) open++; }
  assert.ok(open / n > 0.95, `the undercity's street, open (${open} of ${n})`);
  // A shaft: a trapdoor in the street, a ladder down.
  let shafts = 0;
  for (let x = t.x0; x <= t.x1; x++) if (world.tile(x, lv) === K.PLATFORM && world.tile(x, lv + 3) === K.LADDER && world.tile(x, lv + 9) === K.LADDER) shafts++;
  assert.ok(shafts >= 2, `shafts down to it (${shafts})`);
  // Walkways: a platform a storey up over the street, a door at each end.
  let walks = 0;
  for (let x = t.x0; x <= t.x1; x++) if (world.tile(x, lv - 5) === K.PLATFORM && world.tile(x, lv - 6) === K.FENCE && !SOLID[world.tile(x, lv - 1)]) walks++;
  assert.ok(walks > 0, 'walkways over the streets');
  // The cathedral's tower stands high.
  const cat = t.buildings.find(b => b.kind === 'cathedral');
  let tallest = WORLD_H;
  for (let x = cat.x0; x <= cat.x1; x++) for (let y = t.top; y < lv; y++) if (SOLID[world.tile(x, y)]) { tallest = Math.min(tallest, y); break; }
  assert.ok(lv - tallest >= 34, `its bell tower, ${lv - tallest} blocks up`);
});

test('its street can be walked from gate to gate: open, only doors in the way, a block up or down at a time', () => {
  const world = new TileWorld({ seed: SEED, gen: 6 }), g = world.gen, t = nearestCapital(g), lv = t.level;
  const DOORS = new Set([K.DOOR, K.DOOR_OPEN]);
  let prev = null;
  for (let x = t.x0; x <= t.x1; x++) {
    // (The fountain in the plaza: swum across.)
    if (LIQUID[world.tile(x, lv)]) { prev = null; continue; }
    // (Where you'd stand: the lowest ground with room over it, from the street up to the top of the
    // palace's terrace.)
    let ground = -1;
    for (let y = lv + 1; y >= lv - 8 && ground < 0; y--) {
      // (Platforms too: a shaft's trapdoor is walked over.)
      if ((!SOLID[world.tile(x, y)] && !PLATFORMS[world.tile(x, y)]) || DOORS.has(world.tile(x, y))) continue;
      let room = true;
      for (let yy = y - 3; yy < y; yy++) if (SOLID[world.tile(x, yy)] && !DOORS.has(world.tile(x, yy))) room = false;
      if (room) ground = y;
    }
    assert.ok(ground >= 0, `room to walk at ${x}`);
    if (prev !== null) assert.ok(Math.abs(ground - prev) <= 1, `a step of a block at most at ${x} (${prev} to ${ground})`);
    prev = ground;
  }
});

test('its people: a lord in the palace, guards at the gates (rifles), a healer, traders under the street', () => {
  const g = new WorldGen(SEED, { gen: 6 }), t = nearestCapital(g), folk = folkOf(g.seed, t);
  assert.ok(folk.length >= 25, `${folk.length} people`);
  assert.ok(folk.some(f => f.role === 'lord'), 'a lord');
  assert.ok(folk.some(f => f.role === 'healer'), 'a healer');
  const gate = folk.filter(f => f.role === 'guard' && f.home.kind === 'gate');
  assert.ok(gate.length >= 2 && gate.every(f => f.weapon === 'M4'), 'guards at the gates');
  assert.ok(folk.some(f => f.role === 'trader' && f.home.base > t.level + 8), 'a trader in the undercity');
});

test('harbours: towns by the sea have one: a road down to it, a pier over the water, a lighthouse, boats dry inside', () => {
  let seen = 0, lights = 0, boats = 0;
  for (const seed of [SEED, 2, 4242]) {
    const world = new TileWorld({ seed, gen: 6 }), g = world.gen;
    for (let k = g.spawnRegion - 60; k <= g.spawnRegion + 60; k++) {
      const t = g.townIn(k), H = g.harborOf(t);
      if (!H) continue;
      seen++;
      // The pier: a deck just over the water, on pilings.
      const at = H.shore + H.side * 6;
      assert.equal(world.tile(at, H.deck), K.PLATFORM, 'the pier\'s deck');
      // (Or over ice: a frozen sea.)
      assert.ok(LIQUID[world.tile(at, H.deck + 1)] || [K.LOG, K.ICE].includes(world.tile(at, H.deck + 1)), 'over the water');
      let pilings = 0;
      for (let d = 0; d <= H.len; d++) if (world.tile(H.shore + H.side * d, H.deck + 2) === K.LOG) pilings++;
      assert.ok(pilings >= 3, 'pilings');
      if (H.light !== null) {
        lights++;
        let light = false;
        for (let x = Math.min(H.light, H.light + H.side * 4); x <= Math.max(H.light, H.light + H.side * 4); x++) for (let y = H.y0; y < H.deck; y++) if (world.tile(x, y) === K.TORCH) light = true;
        assert.ok(light, 'a light at the top of the lighthouse');
      }
      // Boats: on the water, dry inside (no water next to the air in them), sealed.
      for (const b of H.boats) {
        boats++;
        let dry = 0;
        for (let x = b.x; x < b.x + b.w; x++) {
          for (let y = SEA_ROW; y <= SEA_ROW + 3; y++) {
            if (world.tile(x, y) !== AIR) continue;
            dry++;
            for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) assert.ok(!LIQUID[world.tile(x + dx, y + dy)], `boat at ${b.x}: no water next to its dry inside (${x + dx},${y + dy})`);
          }
        }
        assert.ok(dry > 0, 'dry inside, under the waterline');
      }
      // And none of it's to be broken.
      assert.ok(g.townProtecting(at, H.deck), 'protected, as the town is');
    }
  }
  assert.ok(seen >= 3 && lights >= 1 && boats >= 3, `harbours (${seen}), lighthouses (${lights}), boats (${boats})`);
});

test('water in new towns\' wells and fountains (ice in towns made before)', () => {
  for (const [gen, want] of [[6, K.WATER], [5, K.ICE]]) {
    const world = new TileWorld({ seed: SEED, gen }), g = world.gen;
    const t = g.townIn(g.spawnRegion), well = t.buildings.find(b => b.kind === 'well');
    assert.ok(well, 'a well in the starting village');
    assert.equal(world.tile(well.x0 + 3, t.level + 1), want, `gen ${gen}: ${K.BLOCKS[want].key} in the well`);
  }
});
