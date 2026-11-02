// Towns (world mode): villages and cities from the seed, on level ground, protected, with doors
// that open as you walk into them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { TileWorld, TILE } from '../web/src/world/tileworld.js';
import * as K from '../web/src/world/blocks.js';
import { WorldGen } from '../web/src/world/worldgen.js';
import { TOWN_RAMP, BUILDINGS } from '../web/src/world/towns.js';
import { mayChange, canPlace, breakBlock } from '../web/src/world/worldplay.js';
import { spawnMonster, spawnSpot } from '../web/src/world/monsters.js';
import { itemOf } from '../web/src/world/items.js';
import { RECIPES } from '../web/src/world/crafting.js';

/** A world with towns, and a game in it with one player (scripted input). */
function play(seed = 777) {
  const world = new TileWorld({ seed, name: 'Towns', towns: true });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const ctl = { script: { move: 0 }, input() { return this.script; } };
  const me = game.addSoldier({ name: 'Walker', isBot: false }, ctl);
  for (let i = 0; i < 300 && !me.alive; i++) game.update();
  return { world, game, me, ctl, town: world.gen.townIn(world.gen.spawnRegion) };
}
const run = (game, n) => { for (let i = 0; i < n; i++) game.update(); };
/** Put soldier s standing at tile column tx, feet on row ty + 1 (the floor). */
const put = (s, tx, ty) => { s.body.x = tx * TILE + 8; s.body.y = (ty + 1) * TILE - 13; s.body.vx = s.body.vy = 0; };

test('towns come from the seed: the same ones, built the same, on every computer', () => {
  const a = new WorldGen(31337, { towns: true }), b = new WorldGen(31337, { towns: true });
  let towns = 0;
  for (let k = a.spawnRegion - 10; k <= a.spawnRegion + 10; k++) {
    const ta = a.townIn(k), tb = b.townIn(k);
    assert.equal(JSON.stringify(ta), JSON.stringify(tb), `region ${k}`);
    if (!ta) continue;
    towns++;
    const ra = a.townRaster(ta), rb = b.townRaster(tb);
    assert.deepEqual([ra.fg, ra.bg, ra.sh], [rb.fg, rb.bg, rb.sh]);
    assert.ok(ta.name.length >= 4 && /^[A-Z][a-z]+$/.test(ta.name), `a name (${ta.name})`);
    for (const bd of ta.buildings) assert.ok(BUILDINGS[bd.kind] && bd.x0 >= ta.x0 && bd.x1 <= ta.x1, `${bd.kind} inside ${ta.name}`);
  }
  assert.ok(towns >= 6, `plenty of towns (${towns} in 21 regions)`);
  // A different seed: different towns.
  const c = new WorldGen(31338, { towns: true });
  assert.notEqual(JSON.stringify(c.townIn(c.spawnRegion)), JSON.stringify(a.townIn(a.spawnRegion)));
});

test('every world starts beside a village, not in it, and has cities too', () => {
  let cities = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const g = new WorldGen(seed, { towns: true }), t = g.townIn(g.spawnRegion);
    assert.ok(t && t.kind === 'village', `seed ${seed}: a village at the start`);
    const gap = Math.min(Math.abs(g.spawnX - (t.x0 - TOWN_RAMP)), Math.abs(g.spawnX - (t.x1 + TOWN_RAMP)));
    assert.ok(g.spawnX < t.x0 - TOWN_RAMP || g.spawnX > t.x1 + TOWN_RAMP, `seed ${seed}: the start isn't in it`);
    assert.ok(gap < 20, `seed ${seed}: but it's right there (${gap} blocks)`);
    for (let k = g.spawnRegion - 20; k <= g.spawnRegion + 20; k++) if (g.townIn(k)?.kind === 'city') cities++;
  }
  assert.ok(cities >= 4, `cities in the worlds (${cities})`);
});

test('a town stands on level ground, with no caves under it, and its ramps meet the land', () => {
  for (const seed of [11, 12, 13]) {
    const world = new TileWorld({ seed, towns: true }), g = world.gen;
    for (let k = g.spawnRegion - 6; k <= g.spawnRegion + 6; k++) {
      const t = g.townIn(k);
      if (!t) continue;
      for (let x = t.x0; x <= t.x1; x++) assert.equal(g.surfaceAt(x), t.level, `${t.name}: level at ${x}`);
      for (let x = t.x0 - TOWN_RAMP - 2; x < t.x1 + TOWN_RAMP + 2; x++) assert.ok(Math.abs(g.surfaceAt(x + 1) - g.surfaceAt(x)) <= 3, `${t.name}: no cliff at ${x}`);
      const R = g.townRaster(t);
      for (let x = t.x0; x <= t.x1; x += 3) {
        for (let y = t.level + 1; y <= t.level + 14; y++) {
          const id = world.tile(x, y), planned = R.at(x, y) >= 0 ? R.fg[R.at(x, y)] : -1;
          if (planned === -1) assert.notEqual(id, K.AIR, `${t.name}: solid under it at (${x}, ${y})`);
        }
      }
    }
  }
});

test("a town's blocks come out the same whichever chunks they're made in", () => {
  const world = new TileWorld({ seed: 4040, towns: true }), g = world.gen, t = g.townIn(g.spawnRegion), R = g.townRaster(t);
  let checked = 0;
  for (let y = R.y0; y <= R.y1; y++) {
    for (let x = R.x0; x <= R.x1; x++) {
      const j = R.at(x, y);
      if (R.fg[j] >= 0) { assert.equal(world.tile(x, y), R.fg[j], `block at (${x}, ${y})`); assert.equal(world.shape(x, y), R.sh[j]); checked++; }
      if (R.bg[j] >= 0) assert.equal(world.wall(x, y), R.bg[j], `wall at (${x}, ${y})`);
    }
  }
  assert.ok(checked > 500, `${checked} blocks`);
  // Doors, lanterns, beds, a smithy's stations: what a village has.
  const has = id => R.fg.includes(id);
  for (const id of [K.DOOR, K.LANTERN, K.BED, K.TABLE, K.BOOKSHELF, K.ANVIL, K.FURNACE, K.WORKBENCH]) assert.ok(has(id), K.BLOCKS[id].key);
});

test('worlds made before towns have none, and keep the land they had', () => {
  const old = new WorldGen(99), withTowns = new WorldGen(99, { towns: true });
  assert.equal(old.townIn(old.spawnRegion), null);
  const t = withTowns.townIn(withTowns.spawnRegion);
  // Away from the town the land's the same; the old world's isn't levelled under where the town would be.
  for (const x of [t.x0 - TOWN_RAMP - 40, t.x1 + TOWN_RAMP + 40]) assert.equal(old.surfaceAt(x), withTowns.surfaceAt(x));
  assert.equal(new TileWorld({ seed: 99 }).gen.towns, false);
});

test("nobody can dig, build or blast in a town, and they're told so", () => {
  const { world, game, me, ctl, town } = play();
  const b = town.buildings.find(x => x.kind === 'house' || x.kind === 'elder' || x.kind === 'shop');
  put(me, b.x0 - 2, town.level - 1);
  const floor = [b.x0 + 2, b.base], wall = [b.x0, b.base - 4];
  assert.equal(mayChange(world, me, ...floor), false, 'the floor');
  assert.equal(mayChange(world, me, b.x0 - 2, town.level + 3), false, 'under the town');
  assert.equal(mayChange(world, me, town.x1 + TOWN_RAMP + 30, town.level), true, 'outside it');
  const before = world.tile(...wall);
  game.carve((wall[0] + 0.5) * TILE, (wall[1] + 0.5) * TILE, 60);
  assert.equal(world.tile(...wall), before, 'a blast leaves it');
  // Digging: the pickaxe does nothing, and says why.
  const said = [];
  game.notify = (s, text) => said.push(text);
  me.world.slot = me.world.inv.slots.findIndex(s => s?.key === 'pickaxe');
  const x = floor[0] * TILE + 8, y = floor[1] * TILE + 8;
  ctl.script = { move: 0, fire: true, firePressed: true, aim: Math.atan2(y - me.shoulderY, x - me.shoulderX), aimDist: Math.hypot(x - me.shoulderX, y - me.shoulderY) };
  put(me, floor[0] - 1, b.base - 1);
  run(game, 90);
  assert.notEqual(world.tile(...floor), K.AIR, 'still there');
  assert.ok(said.some(s => s.includes(town.name)), `told (${said.join(' / ')})`);
});

test('walking into a door opens it, it shuts behind you, and monsters stay out', () => {
  const { world, game, me, ctl, town } = play();
  const b = town.buildings.find(x => x.kind === 'house' || x.kind === 'elder' || x.kind === 'shop');
  const door = [b.x0, b.base - 1];
  assert.equal(world.tile(...door), K.DOOR);
  put(me, b.x0 - 2, b.base - 1);
  ctl.script = { move: 1 };
  run(game, 40);
  assert.equal(world.tile(...door), K.DOOR_OPEN, 'it opened');
  run(game, 60);
  assert.ok(me.x > (b.x0 + 2) * TILE, 'and they walked in');
  ctl.script = { move: 0 };
  run(game, 90);
  assert.equal(world.tile(...door), K.DOOR, 'it shut behind them');
  // A zombie outside, after the player inside: the door stays shut.
  const z = spawnMonster(game, 'zombie', (b.x0 - 3) * TILE + 8, (b.base - 1) * TILE + 3);
  run(game, 240);
  assert.ok(z.alive, 'the zombie came');
  assert.equal(world.tile(...door), K.DOOR, "monsters can't open doors");
  assert.ok(z.x < b.x0 * TILE, 'and it stayed outside');
});

test("monsters don't come into towns, or near them", () => {
  const { game, me, town } = play();
  const mid = (town.x0 + town.x1) >> 1;
  put(me, mid, town.level - 1);
  for (let i = 0; i < 300; i++) {
    const spot = spawnSpot(game, mid, town.level - 1, false);
    if (spot) assert.ok(spot.tx < town.x0 - 24 || spot.tx > town.x1 + 24, `not in ${town.name} (${spot.tx})`);
  }
});

test("towns' blocks: players can make them, and lanterns need something to hang from", () => {
  for (const key of ['cobblestone', 'roof_tiles', 'thatch', 'plaster', 'timber', 'mud_bricks', 'stained_glass', 'fence', 'post', 'lantern', 'awning', 'banner', 'table', 'chair', 'bookshelf', 'barrel', 'sign', 'plaster_wall', 'timber_wall', 'log_wall', 'cobble_wall', 'mud_brick_wall']) {
    assert.ok(itemOf(key), `${key} is an item`);
    assert.ok(RECIPES.some(r => r.key === key), `${key} can be made`);
  }
  const world = new TileWorld({ seed: 5 });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const x = 3, y = 40;
  for (let i = -2; i <= 2; i++) for (let j = -3; j <= 3; j++) { world.setTile(x + i, y + j, K.AIR); world.setWall(x + i, y + j, K.NO_WALL); }
  const lantern = itemOf('lantern');
  assert.equal(canPlace(game, lantern, x, y), false, 'not in mid-air');
  world.setTile(x, y - 1, K.PLANKS);
  assert.equal(canPlace(game, lantern, x, y), true, 'under a block');
  world.setTile(x, y, K.LANTERN);
  breakBlock(game, x, y - 1);
  assert.equal(world.tile(x, y), K.AIR, 'it falls when the block above goes');
});
