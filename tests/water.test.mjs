// Water (worlds made since seas: worldgen.js's gen 4): seas between the lands, with sea floors,
// beaches, kelp, coral and shipwrecks; lakes and swamp pools held in by the land; swimming
// (physics.js), breath and drowning (worldplay.js); water flowing where a way's opened for it
// (tileworld.js), and not into towns; building in water; online, everyone sees it flow.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED, BODY } from '../web/src/config.js';
import { TileWorld } from '../web/src/world/tileworld.js';
import { WorldGen, SEA_ROW, WORLD_H, CHUNK } from '../web/src/world/worldgen.js';
import * as K from '../web/src/world/blocks.js';
import { TILE, LIQUID, SOLID, AIR } from '../web/src/world/blocks.js';
import { Inventory } from '../web/src/world/items.js';
import { moveTo, setDev } from '../web/src/world/devmode.js';
import { BREATH, canPlace, breakBlock } from '../web/src/world/worldplay.js';
import { itemOf } from '../web/src/world/items.js';

const SEED = 777;
/** The first sea east of where everyone starts, in a world made since seas. */
function firstSea(gen) {
  for (let k = gen.spawnRegion + 2; k < gen.spawnRegion + 80; k++) if (gen.regionBiome(k).sea) return gen.seaSpan(k);
  return null;
}

function play(seed = SEED) {
  const world = new TileWorld({ seed, name: 'Sea', gen: 4 });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const inp = { move: 0 };
  const me = game.addSoldier({ name: 'Swimmer', isBot: false }, { input: () => inp });
  for (let i = 0; i < 300 && !me.alive; i++) game.update();
  me.world.inv = new Inventory();
  me.spawnProtect = 0;
  return { world, game, me, inp };
}

test('seas: between the lands in new worlds only, water from the sea\'s top down to a floor of sand, beaches either side', () => {
  const gen = new WorldGen(SEED, { gen: 4 }), sp = firstSea(gen);
  assert.ok(sp, 'a sea');
  assert.ok(sp.x1 - sp.x0 > 200, `a wide one (${sp.x1 - sp.x0} tiles)`);
  const mid = (sp.x0 + sp.x1) >> 1;
  assert.equal(gen.waterTop(mid), SEA_ROW, 'its top: the sea\'s');
  assert.ok(gen.surfaceAt(mid) - SEA_ROW > 12, 'deep in the middle');
  assert.ok(gen.surfaceAt(sp.x0 - 1) <= SEA_ROW && gen.surfaceAt(sp.x1 + 1) <= SEA_ROW, 'land either side, out of the water');
  const world = new TileWorld({ seed: SEED, gen: 4 });
  assert.equal(world.tile(mid, SEA_ROW), K.WATER);
  assert.ok(LIQUID[world.tile(mid, world.gen.surfaceAt(mid) - 1)], 'water (or what grows in it) down to the floor');
  assert.ok([K.SAND, K.GRAVEL, K.CLAY].includes(world.tile(mid, world.gen.surfaceAt(mid))), 'a sea floor');
  // A beach: sand along the shore.
  let beach = 0;
  for (let x = sp.x0 - 8; x < sp.x0; x++) if (world.tile(x, world.gen.surfaceAt(x)) === K.SAND) beach++;
  assert.ok(beach >= 4, `a sandy beach (${beach} of 8)`);
  // Worlds made before keep their land: no seas, no water.
  const old = new WorldGen(SEED, { gen: 3 });
  for (let k = old.spawnRegion - 40; k <= old.spawnRegion + 40; k++) assert.ok(!old.regionBiome(k).sea, 'no seas in a world made before');
  assert.equal(old.waterTop(mid), WORLD_H);
});

test('what\'s in the sea: kelp and seagrass, coral reefs in warm seas, ice over cold ones, shipwrecks with their cargo', () => {
  const counts = new Map(), add = (b, n = 1) => counts.set(b, (counts.get(b) || 0) + n);
  let wrecks = 0, crates = 0;
  for (const seed of [SEED, 2, 4242]) {
    const world = new TileWorld({ seed, gen: 4 }), g = world.gen;
    for (let k = g.spawnRegion - 30; k <= g.spawnRegion + 30; k++) {
      const sp = g.seaSpan(k);
      if (!sp) continue;
      // (Each sea region's own part of its sea.)
      for (let x = Math.max(sp.x0, g.edge(k)); x < Math.min(sp.x1, g.edge(k + 1)); x += 2) {
        for (let y = SEA_ROW; y <= g.surfaceAt(x); y++) add(world.tile(x, y));
      }
      const w = g.wreck(k);
      if (w) {
        wrecks++;
        for (let x = w.x0; x <= w.x1; x++) for (let y = w.y0; y <= w.y1; y++) { const b = world.tile(x, y); if (b === K.LOOT_CRATE) crates++; if (b === K.OLD_PLANKS) add('hull'); }
      }
    }
  }
  for (const [b, name] of [[K.KELP, 'kelp'], [K.SEAGRASS, 'seagrass'], [K.CORAL_FAN, 'coral fans'], [K.ICE, 'ice']]) assert.ok(counts.get(b) > 0, `${name} in the seas`);
  assert.ok((counts.get(K.CORAL) || 0) + (counts.get(K.CORAL_BLUE) || 0) + (counts.get(K.CORAL_GOLD) || 0) > 0, 'coral');
  assert.ok(wrecks > 0 && counts.get('hull') > 20, `shipwrecks (${wrecks})`);
  assert.ok(crates > 0, 'their cargo');
});

test('lakes and pools: held in by the land, up to its lower edge; swamps full of pools, reeds and lily pads', () => {
  const g = new WorldGen(SEED, { gen: 4 });
  const lakes = [];
  for (let i = -80; i < 80; i++) { const L = g.lake(i, false); if (L) lakes.push(L); }
  for (let i = -300; i < 300; i++) { const L = g.lake(i, true); if (L) lakes.push(L); }
  assert.ok(lakes.filter(L => !L.small).length >= 10, `lakes (${lakes.filter(L => !L.small).length})`);
  assert.ok(lakes.filter(L => L.small && L.biome === 'swamp').length >= 10, 'swamp pools');
  for (const L of lakes) {
    assert.ok(g.surfaceAt(L.x0) <= L.level && g.surfaceAt(L.x1) <= L.level, `lake at ${L.mid}: its edges hold it in`);
    assert.equal(g.waterTop(L.mid), L.level);
    assert.ok(g.surfaceAt(L.mid) > L.level, 'water in the middle');
  }
  const world = new TileWorld({ seed: SEED, gen: 4 });
  const seen = new Set();
  for (const L of lakes.filter(o => o.biome === 'swamp').slice(0, 12)) for (let x = L.x0; x <= L.x1; x++) for (let y = L.level; y < L.level + 3; y++) seen.add(world.tile(x, y));
  assert.ok(seen.has(K.REEDS) && seen.has(K.LILY_PAD), 'reeds and lily pads in the swamp');
});

test('no water is made beside or above open air (where it would have to flow)', () => {
  for (const seed of [SEED, 2]) {
    const world = new TileWorld({ seed, gen: 4 }), g = world.gen, spans = [];
    for (let k = g.spawnRegion - 12; k <= g.spawnRegion + 12; k++) { const sp = g.seaSpan(k); if (sp) spans.push([sp.x0 - 30, sp.x1 + 30]); }
    for (let i = -40; i < 40; i++) { const L = g.lake(i, false); if (L) spans.push([L.x0 - 3, L.x1 + 3]); }
    for (const [a, b] of spans) {
      for (let x = a; x <= b; x += 1) {
        const top = Math.min(g.waterTop(x), SEA_ROW) - 2, bottom = g.surfaceAt(x) + 2;
        for (let y = top; y < bottom; y++) {
          if (!LIQUID[world.tile(x, y)]) continue;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1]]) assert.notEqual(world.tile(x + dx, y + dy), AIR, `seed ${seed}: water at ${x},${y} beside open air`);
        }
      }
    }
  }
});

test('swimming: slower; floating with the head out; diving and swimming up; leaping out onto the bank', () => {
  const { game, world, me, inp } = play();
  const sp = firstSea(world.gen), mid = (sp.x0 + sp.x1) >> 1;
  moveTo(me, mid * TILE + 8, (SEA_ROW + 6) * TILE);
  const run = (n, i = {}) => { Object.assign(inp, { move: 0, jump: false, jumpPressed: false, crouch: false }, i); for (let k = 0; k < n; k++) game.update(); };
  run(1);
  assert.ok(me.body.swimming, 'in the water');
  // Left alone: up to the top, the head out.
  run(240);
  assert.ok(me.body.swimming && !me.body.under, 'floating at the top, the head out of the water');
  const floatY = me.y;
  assert.ok(Math.abs(me.y + BODY.top - SEA_ROW * TILE) < TILE * 1.5, 'its head just over the top');
  // Crouch: down.
  run(60, { crouch: true });
  assert.ok(me.y > floatY + 2 * TILE && me.body.under, 'diving');
  // Swimming along: slower than running.
  run(60, { move: 1 });
  assert.ok(Math.abs(me.body.vx) < 3.4 * DEFAULT_SPEED * 0.75, `swimming slower than running (${me.body.vx.toFixed(2)})`);
  // Jump: up, and out of the water at the top.
  let out = false;
  for (let i = 0; i < 200 && !out; i++) { run(1, { jump: true, jumpPressed: i % 20 === 0 }); out = !me.body.swimming && me.y + BODY.bottom < SEA_ROW * TILE; }
  assert.ok(out, 'leapt out of the water');
});

test('breath: used up with the head under water, then drowning; back again at the top; none lost in dev mode', () => {
  const { game, world, me, inp } = play();
  const sp = firstSea(world.gen), mid = (sp.x0 + sp.x1) >> 1;
  const floor = world.gen.surfaceAt(mid);
  moveTo(me, mid * TILE + 8, (floor - 1) * TILE - BODY.bottom - 1);
  Object.assign(inp, { crouch: true });
  game.update();
  assert.ok(me.world.breath <= BREATH);
  for (let i = 0; i < 60; i++) game.update();
  assert.ok(me.body.under && me.world.breath < BREATH, `breath going (${me.world.breath.toFixed(1)})`);
  const hp = me.health;
  for (let i = 0; i < 60 * 30 && me.alive && me.health === hp; i++) game.update();
  assert.equal(me.world.breath, 0, 'out of breath');
  assert.ok(me.health < hp, 'drowning');
  // Up to the top: it comes back.
  Object.assign(inp, { crouch: false, jump: true });
  for (let i = 0; i < 600 && me.body.under; i++) game.update();
  for (let i = 0; i < 300; i++) game.update();
  assert.ok(me.world.breath > 50, `breath back at the top (${me.world.breath.toFixed(1)})`);
  // Dev mode: none lost.
  setDev(game, me, true);
  me.world.dev.fly = false;
  moveTo(me, mid * TILE + 8, (floor - 2) * TILE);
  Object.assign(inp, { crouch: true, jump: false });
  const b = me.world.breath;
  for (let i = 0; i < 120; i++) game.update();
  assert.ok(me.world.breath >= b, 'no breath lost in dev mode');
});

test('water puts out fire', () => {
  const { game, world, me } = play();
  const sp = firstSea(world.gen), mid = (sp.x0 + sp.x1) >> 1;
  moveTo(me, mid * TILE + 8, (SEA_ROW + 4) * TILE);
  me.burnTicks = 200;
  game.update(); game.update();
  assert.equal(me.burnTicks, 0);
});

test('water flows where a way\'s opened for it: down, and along what holds it up; a pit beside the sea fills', () => {
  const { game, world } = play();
  const sp = firstSea(world.gen);
  // Dig a pit into the beach beside the water's edge, then open it to the sea.
  const x = sp.x0 - 1, top = world.gen.surfaceAt(x);
  assert.ok(top <= SEA_ROW);
  for (let xx = x - 3; xx <= x; xx++) for (let y = top; y <= SEA_ROW + 3; y++) if (!(xx === x && y >= SEA_ROW && y <= SEA_ROW + 3)) world.setTile(xx, y, AIR);
  // (The wall between the pit and the sea, still there: nothing yet.)
  for (let i = 0; i < 40; i++) game.update();
  assert.equal(world.tile(x - 2, SEA_ROW + 3), AIR, 'dry, while the sea\'s held back');
  for (let y = SEA_ROW; y <= SEA_ROW + 3; y++) world.setTile(x, y, AIR);
  for (let i = 0; i < 400; i++) game.update();
  for (let xx = x - 3; xx <= x; xx++) for (let y = SEA_ROW; y <= SEA_ROW + 3; y++) assert.equal(world.tile(xx, y), K.WATER, `filled at ${xx},${y}`);
  // Never up, above the sea's top.
  assert.equal(world.tile(x - 2, SEA_ROW - 1), AIR, 'not above the sea');
});

test('water doesn\'t flow into towns', () => {
  const world = new TileWorld({ seed: SEED, gen: 4 });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  game.addSoldier({ name: 'Host', isBot: false }, { input: () => ({ move: 0 }) });
  game.update();
  const g = world.gen, t = g.townIn(g.spawnRegion);
  assert.ok(t, 'a town by the start');
  const tx = (t.x0 + t.x1) >> 1;
  // Water put in the sky over the town, its tiles under it opened up.
  const y = t.top + 2;
  world.setTile(tx, y - 1, K.WATER);
  world.setTile(tx, y, AIR);
  for (let i = 0; i < 100; i++) game.update();
  assert.notEqual(world.tile(tx, y), K.WATER, 'not into the town');
});

test('building in water: blocks go in (in place of the water), not torches or chests; what grows in it, picked, leaves water', () => {
  const { game, world } = play();
  const sp = firstSea(world.gen), mid = (sp.x0 + sp.x1) >> 1, floor = world.gen.surfaceAt(mid);
  // On the floor, in the water.
  assert.ok(canPlace(game, itemOf('stone'), mid, floor - 1), 'a block, on the sea floor');
  assert.ok(!canPlace(game, itemOf('torch'), mid, floor - 1), 'not a torch');
  assert.ok(!canPlace(game, itemOf('chest'), mid, floor - 1), 'not a chest');
  world.setTile(mid, floor - 1, K.SEAGRASS);
  breakBlock(game, mid, floor - 1);
  assert.equal(world.tile(mid, floor - 1), K.WATER, 'seagrass picked: water where it was');
  // The floor under kelp dug away: the kelp goes too (water where it was).
  world.setTile(mid + 3, floor - 1, K.KELP);
  world.setTile(mid + 3, floor - 2, K.KELP);
  breakBlock(game, mid + 3, floor);
  assert.notEqual(world.tile(mid + 3, floor - 1), K.KELP, 'the kelp, gone with its floor');
  assert.ok(LIQUID[world.tile(mid + 3, floor - 1)] || world.tile(mid + 3, floor - 1) === AIR);
  // Explosions don't blow water away.
  world.carve((mid + 6) * TILE, (SEA_ROW + 2) * TILE, 60);
  assert.equal(world.tile(mid + 6, SEA_ROW + 2), K.WATER, 'still water after a blast');
});

test('online: water flowing on the host is seen by everyone', async () => {
  const { NetHost } = await import('../web/src/net/host.js');
  const { NetClient } = await import('../web/src/net/client.js');
  const { memoryLinks } = await import('../web/src/net/peer.js');
  const { WorldHost, WorldClient } = await import('../web/src/world/worldnet.js');
  const world = new TileWorld({ seed: SEED, name: 'Sea online', gen: 4 });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, effects: false, seed: 1, options: { destruction: true } });
  game.online = true;
  const host = game.addSoldier({ name: 'Host', isBot: false }, { input: () => ({ move: 0 }) });
  const sync = new WorldHost(game, {});
  const net = new NetHost({ maxPlayers: 8, botCount: 0, world: sync, matchInfo: () => ({ mode: 'world', mapName: world.name, speed: DEFAULT_SPEED, options: game.options, world: sync.info() }), addBot: () => {} });
  net.setGame(game);
  let now = 0;
  const queue = [], schedule = (fn, ms) => queue.push({ fn, at: now + ms });
  const [h, c] = memoryLinks({ latency: 20, schedule });
  const client = new NetClient({ link: c, controller: { input: () => ({ move: 0 }) }, loadMap: async () => null, clock: () => now, world: new WorldClient({}) });
  net.addPlayer(h, 'Guest');
  const pump = async () => { for (let k = 0; k < 4; k++) { await new Promise(r => setImmediate(r)); for (const q of queue.filter(q => q.at <= now)) { queue.splice(queue.indexOf(q), 1); q.fn(); } } };
  const step = async (n = 1) => { for (let i = 0; i < n; i++) { game.update(); net.afterTick(); client.tick(); now += 1000 / 60; await pump(); } };
  await pump();
  await step(120);
  // A hole beside water, near the host (where the guest is too).
  const tx = Math.floor(host.x / TILE) + 3, ty = Math.floor(host.y / TILE) - 6;
  for (let y = ty; y <= ty + 3; y++) world.setTile(tx, y, AIR);
  world.setTile(tx, ty, K.WATER);
  await step(60);
  const cw = client.game.world;
  for (let y = ty + 1; y <= ty + 3; y++) assert.equal(world.tile(tx, y), K.WATER, `flowed down, on the host (${y})`);
  for (let y = ty + 1; y <= ty + 3; y++) assert.equal(cw.tile(tx, y), K.WATER, `and the guest sees it (${y})`);
});
