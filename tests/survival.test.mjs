// Survival in worlds (web/src/world/hunger.js, animals.js, farming.js, survival.js): hunger and
// food, animals (hunted, sheared, fed and bred), cooking, and farming. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { NetHost } from '../web/src/net/host.js';
import { NetClient } from '../web/src/net/client.js';
import { memoryLinks } from '../web/src/net/peer.js';
import { DEFAULT_SPEED, BODY } from '../web/src/config.js';
import { TileWorld, TILE } from '../web/src/world/tileworld.js';
import * as K from '../web/src/world/blocks.js';
import { ITEMS, itemOf } from '../web/src/world/items.js';
import { worldFromSave, playerToSave, breakBlock } from '../web/src/world/worldplay.js';
import { cleanSettings, settingsSummary } from '../web/src/world/worldrules.js';
import { FOOD_MAX, exert, foodBar } from '../web/src/world/hunger.js';
import { ANIMALS, isAnimal, spawnAnimal, animalsTick, clearAnimals, parseLook } from '../web/src/world/animals.js';
import { asleepAny } from '../web/src/world/sleepers.js';
import { grow, farmingTick, harvest, ripe } from '../web/src/world/farming.js';
import { RECIPES, craft, stationsNear } from '../web/src/world/crafting.js';
import { DAY_TICKS, spawnMonster, foes } from '../web/src/world/monsters.js';
import { WorldHost, WorldClient } from '../web/src/world/worldnet.js';
import { codexEntries } from '../web/src/world/codex.js';
import { damage } from '../web/src/combat.js';

const SEED = 777;

/** A world (its settings: worldrules.js) and a player in it, standing at the start; ctl.script: their input. */
function play(settings = {}, seed = SEED) {
  const world = new TileWorld({ seed, name: 'Survival', gen: 6 });
  world.settings = cleanSettings(settings);
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const ctl = { script: { move: 0 }, input() { const s = this.script; this.script = { ...s, firePressed: false, jumpPressed: false, switchTo: null, cycle: 0 }; return s; } };
  const me = game.addSoldier({ name: 'Survivor', isBot: false }, ctl);
  me.world = worldFromSave(null);
  for (let i = 0; i < 300 && !me.alive; i++) game.update();
  me.spawnProtect = 0;
  return { world, game, me, ctl };
}
const run = (game, n) => { for (let i = 0; i < n; i++) game.update(); };
/** Aim from s at tile (tx, ty)'s middle (or the point x, y). */
const aimAt = (s, x, y) => ({ aim: Math.atan2(y - s.shoulderY, x - s.shoulderX), aimDist: Math.hypot(x - s.shoulderX, y - s.shoulderY) });
const tileAim = (s, tx, ty) => aimAt(s, tx * TILE + 8, ty * TILE + 8);
/** Put item `key` (n of it) in hotbar slot 0 and hold it. */
function hold(m, key, n = 1) {
  m.me.world.inv.slots[0] = { key, n };
  m.me.world.inv.version++;
  m.me.world.slot = 0;
}
/** One click (left), aimed as `aim` says. */
function click(m, aim) {
  m.ctl.script = { move: 0, fire: true, firePressed: true, ...aim };
  run(m.game, 1);
  m.ctl.script = { move: 0, ...aim };
  run(m.game, 2);
}
/** The tile the player's feet stand on, and the row they're in. */
const feet = s => ({ tx: Math.floor(s.x / TILE), ty: Math.floor((s.y + BODY.bottom - 1) / TILE) });
const drops = (m, key) => (m.game.world.drops || []).filter(d => d.key === key).reduce((n, d) => n + d.n, 0);
/** What there is of `key`: on the ground, and picked up. */
const got = (m, key) => drops(m, key) + m.me.world.inv.count(key);

// ---- Hunger ----------------------------------------------------------------------------------------------

test('hunger: on in new worlds (and ones made before), off as a setting; tiring things use up saturation, then food', () => {
  assert.equal(cleanSettings(null).hunger, 'on');
  assert.equal(settingsSummary({ hunger: 'off' }), 'No hunger');
  const m = play(), w = m.me.world;
  run(m.game, 2);
  assert.equal(w.food, FOOD_MAX, 'starting full');
  assert.ok(w.sat > 0);
  // Saturation goes first.
  w.sat = 3; w.exh = 0;
  exert(m.me, 8);
  assert.equal(w.food, FOOD_MAX);
  assert.equal(w.sat, 1);
  exert(m.me, 4 * 6);
  assert.equal(w.sat, 0);
  assert.equal(w.food, FOOD_MAX - 5);
  // Just being alive: a little, over time.
  w.food = 10; w.sat = 0; w.exh = 0;
  run(m.game, 60 * 60 * 3);
  assert.ok(w.food < 10 && w.food >= 7, `a few points over three minutes (${w.food})`);
  // No hunger: none of it.
  const off = play({ hunger: 'off' });
  run(off.game, 60);
  assert.equal(off.me.world.food, undefined, 'none kept');
  assert.equal(foodBar(off.me.world), null, 'nor shown');
});

test('starving hurts: on normal to the last of your health, on easy to half, on hard to death', () => {
  for (const [difficulty, floor] of [['normal', 1], ['easy', 0.5], ['hard', 0]]) {
    const m = play({ difficulty }), w = m.me.world;
    run(m.game, 2);
    w.food = 0; w.sat = 0;
    const max = m.me.maxHealth;
    m.me.health = max;
    run(m.game, 80 * 30);
    if (floor === 0) assert.ok(!m.me.alive || m.me.world.food === FOOD_MAX, 'hard: starved to death (back full)');
    else {
      assert.ok(m.me.alive, `${difficulty}: alive`);
      assert.ok(Math.abs(m.me.health - (floor === 1 ? 1 : max / 2)) < 1e-6, `${difficulty}: down to ${floor === 1 ? 1 : max / 2} (${m.me.health})`);
    }
    assert.equal(foodBar({ food: 0 })[1], 'starving');
  }
});

test('well fed and out of a fight, you heal by yourself; hungry, you don\'t (not even with perks)', () => {
  const m = play(), w = m.me.world, max = m.me.maxHealth;
  run(m.game, 2);
  m.me.health = 60;
  w.hurtAt = m.game.tick;
  run(m.game, 200);
  assert.equal(m.me.health, 60, 'just hurt: not yet');
  run(m.game, 600);
  assert.ok(m.me.health > 80, `well fed: healing (${m.me.health})`);
  const was = w.food + w.sat;
  assert.ok(w.food + w.sat < was + 1, 'it tires you');
  // Hungry: no healing, even with the Second wind perk.
  m.me.health = 60;
  w.food = 6; w.sat = 0;
  w.prog = { ...(w.prog || {}), xp: 0, level: 1, points: 0, perks: { regen: 5 }, stats: {}, seen: { towns: [], biomes: [], deepest: 0 } };
  run(m.game, 900);
  assert.equal(m.me.health, 60, 'hungry: none');
  assert.ok(m.me.health < max);
});

test('eating fills you up (cooked better than raw); not when you\'re full; potions heal; raw chicken can make you sick', () => {
  const m = play(), w = m.me.world;
  run(m.game, 2);
  hold(m, 'bread', 3);
  w.food = 10; w.sat = 0;
  click(m, {});
  assert.equal(w.food, 15, 'bread: five');
  assert.equal(w.sat, 6, 'and how long it lasts');
  assert.equal(w.inv.count('bread'), 2);
  w.food = FOOD_MAX;
  run(m.game, 60);
  click(m, {});
  assert.equal(w.inv.count('bread'), 2, 'full: not eaten');
  assert.ok(itemOf('steak').food > itemOf('raw_beef').food && itemOf('steak').sat > itemOf('raw_beef').sat, 'cooked is better');
  // A potion heals (food or not).
  hold(m, 'healing_potion', 1);
  m.me.health = 30;
  w.hurtAt = m.game.tick;
  run(m.game, 60);
  click(m, {});
  assert.equal(m.me.health, 30 + itemOf('healing_potion').heal);
  // Raw chicken: sometimes ill (hungry quicker a while).
  let sick = 0;
  for (let i = 0; i < 40 && !sick; i++) {
    hold(m, 'raw_chicken', 1);
    w.food = 5;
    run(m.game, 60);
    click(m, {});
    if (w.sick > 0) sick++;
  }
  assert.ok(sick, 'sick, now and then');
  assert.equal(foodBar(w)[1], 'sick');
  // Every food fills you up (and heals, where there's no hunger).
  for (const it of ITEMS.values()) if (it.kind === 'food' && it.look !== 'potion') assert.ok(it.food > 0 && it.sat >= 0 && it.heal > 0, it.key);
});

test('hunger is kept with the player, and they come back full after dying', () => {
  const m = play(), w = m.me.world;
  run(m.game, 2);
  w.food = 7; w.sat = 2.5; w.exh = 1.25; w.sick = 300;
  const back = worldFromSave(JSON.parse(JSON.stringify(playerToSave(m.me, m.game))));
  assert.deepEqual([back.food, back.sat, back.exh, back.sick], [7, 2.5, 1.25, 300]);
  // (Saved before there was hunger: full, when it starts.)
  const old = worldFromSave({ inv: [] });
  assert.equal(old.food, undefined);
  m.game.kill(m.me, null, null);
  assert.equal(w.food, FOOD_MAX, 'full again');
});

// ---- Animals ---------------------------------------------------------------------------------------------

test('animals come round players by day, by their land (fish in the water), and sleep where they are when everyone\'s far away', () => {
  const m = play();
  m.world.time = 0;
  run(m.game, 60 * 50);
  const all = m.game.soldiers.filter(isAnimal);
  assert.ok(all.length >= 3, `${all.length} animals`);
  const gen = m.world.gen;
  for (const a of all) {
    const at = a.npc.spawnAt, biome = gen.biomeAt(Math.floor(at.x / TILE)).key;
    assert.ok(a.npc.type === 'fish' || a.npc.type === 'crab' || ANIMALS[a.npc.type], a.npc.type);
    if (!['fish', 'crab'].includes(a.npc.type)) assert.ok(['plains', 'meadow', 'forest', 'birch_forest', 'dark_forest', 'cherry_grove', 'taiga', 'giant_taiga', 'snowy_taiga', 'snow', 'mountains', 'desert', 'badlands', 'savanna', 'jungle', 'bamboo_jungle', 'swamp', 'mushroom_fields'].includes(biome), `${a.npc.type} in ${biome}`);
    assert.equal(a.npc.kind, 'animal');
    assert.equal(parseLook(a.skin).type, a.npc.type, 'its look, to send');
  }
  // Night: no more come (on land).
  clearAnimals(m.game);
  m.world.time = DAY_TICKS * 0.75;
  run(m.game, 60 * 40);
  assert.equal(m.game.soldiers.filter(s => isAnimal(s) && s.npc.type !== 'fish').length, 0, 'none by night');
  // Far from everyone: asleep where it is, out of the game till someone comes back (sleepers.js).
  // (The night's monsters may have killed the player: back first, and left alone; with nobody
  // about, nothing changes.)
  for (let i = 0; i < 1200 && !m.me.alive; i++) m.game.update();
  m.me.spawnProtect = 1e9;
  const cow = spawnAnimal(m.game, 'cow', m.me.x + 60, m.me.y);
  run(m.game, 3);
  cow.body.x = m.me.x + 200 * TILE;
  run(m.game, 60);
  assert.ok(!m.game.soldiers.includes(cow), 'gone');
  assert.ok(asleepAny(m.world, r => r.kind === 'animal' && r.type === 'cow'), 'asleep where it was');
});

test('a fish shoal in a lake: they stay in the water, under its top', () => {
  const m = play();
  // A pool by the start: dug out and filled.
  const { tx, ty } = feet(m.me);
  for (let x = tx + 6; x <= tx + 26; x++) for (let y = ty - 4; y <= ty + 7; y++) m.world.setTile(x, y, y <= ty ? K.AIR : x === tx + 6 || x === tx + 26 || y === ty + 7 ? K.STONE : K.WATER);
  const fish = spawnAnimal(m.game, 'fish', (tx + 16) * TILE + 8, (ty + 5) * TILE);
  run(m.game, 60 * 20);
  assert.ok(fish.alive, 'alive');
  assert.ok(m.world.liquidAt(fish.x, fish.y - 4), 'in the water');
});

test('hunting: animals give meat, leather, wool, feathers (cooked if they burnt); only players hurt them; a polar bear fights back', () => {
  const m = play();
  run(m.game, 2);
  const cow = spawnAnimal(m.game, 'cow', m.me.x + 40, m.me.y);
  const sheep = spawnAnimal(m.game, 'sheep', m.me.x - 40, m.me.y);
  run(m.game, 3);
  const z = spawnMonster(m.game, 'zombie', m.me.x + 60, m.me.y);
  run(m.game, 3);
  m.world.pvp = false;
  assert.equal(foes(m.world, m.me, cow), true, 'players hunt them (PvP or not)');
  assert.equal(foes(m.world, z, cow), false, 'monsters leave them be');
  assert.equal(foes(m.world, cow, m.me), false, 'they hurt nobody');
  const xp = m.me.world.prog?.xp || 0;
  damage(m.game, cow, 999, m.me, 'Knife');
  damage(m.game, sheep, 999, m.me, 'Flamer');
  assert.ok(!cow.alive && !sheep.alive);
  assert.ok(drops(m, 'raw_beef') >= 1, 'beef');
  assert.ok(drops(m, 'cooked_mutton') >= 1 && drops(m, 'raw_mutton') === 0, 'burnt: cooked');
  assert.equal(drops(m, 'wool'), 1, 'its wool');
  assert.ok((m.me.world.prog?.xp || 0) > xp, 'experience');
  // A polar bear: hurt, it goes for whoever did it.
  const bear = spawnAnimal(m.game, 'polar_bear', m.me.x + 30, m.me.y);
  run(m.game, 3);
  damage(m.game, bear, 5, m.me, 'Knife');
  run(m.game, 2);
  assert.equal(foes(m.world, bear, m.me), true, 'angry with them');
  const hp = m.me.health;
  run(m.game, 240);
  assert.ok(m.me.health < hp, 'and hits them');
});

test('shears clip a sheep (its wool grows back); fed their food, two of a kind make a young one, which grows up', () => {
  const m = play();
  run(m.game, 2);
  const sheep = spawnAnimal(m.game, 'sheep', m.me.x + 36, m.me.y);
  run(m.game, 3);
  hold(m, 'shears');
  click(m, aimAt(m.me, sheep.x, sheep.y));
  assert.ok(sheep.npc.shorn, 'sheared');
  assert.ok(got(m, 'wool') >= 1, 'wool');
  assert.equal(parseLook(sheep.skin).shorn, true, 'it looks it');
  const wool = got(m, 'wool');
  run(m.game, 30);
  click(m, aimAt(m.me, sheep.x, sheep.y));
  assert.equal(got(m, 'wool'), wool, 'nothing more to clip');
  sheep.npc.shorn = m.game.tick - 60 * 60 * 3;
  run(m.game, 60);
  assert.ok(!sheep.npc.shorn, 'grown back');
  // Two cows, fed wheat: a calf.
  clearAnimals(m.game);
  const a = spawnAnimal(m.game, 'cow', m.me.x + 30, m.me.y), b = spawnAnimal(m.game, 'cow', m.me.x + 40, m.me.y);
  run(m.game, 3);
  hold(m, 'wheat', 5);
  click(m, aimAt(m.me, a.x, a.y));
  click(m, aimAt(m.me, b.x, b.y));
  assert.equal(m.me.world.inv.count('wheat'), 3, 'both ate');
  run(m.game, 120);
  const young = m.game.soldiers.find(s => isAnimal(s) && s.npc.baby != null);
  assert.ok(young && young.npc.type === 'cow', 'a calf');
  assert.equal(parseLook(young.skin).baby, true);
  young.npc.baby = m.game.tick - 60 * 60 * 5;
  run(m.game, 60);
  assert.equal(young.npc.baby, null, 'grown up');
});

test('animals walk round water and drops, stay inside fences, and come to whoever holds their food', () => {
  const m = play();
  run(m.game, 2);
  clearAnimals(m.game);
  const { tx, ty } = feet(m.me);
  // A flat floor with a deep pit a way off.
  for (let x = tx - 30; x <= tx + 30; x++) { for (let y = ty - 6; y <= ty; y++) m.world.setTile(x, y, K.AIR); m.world.setTile(x, ty + 1, K.STONE); }
  for (let x = tx + 18; x <= tx + 21; x++) for (let y = ty + 1; y <= ty + 9; y++) m.world.setTile(x, y, K.AIR);
  // (Deep water the other way: a pool sunk in the floor.)
  for (let x = tx + 5; x <= tx + 8; x++) for (let y = ty + 1; y <= ty + 4; y++) m.world.setTile(x, y, K.WATER);
  const pig = spawnAnimal(m.game, 'pig', (tx + 12) * TILE + 8, (ty + 1) * TILE - BODY.bottom - 1);
  for (let i = 0; i < 60; i++) {
    run(m.game, 60);
    assert.ok(!pig.body.swimming && pig.x > (tx + 8) * TILE, 'kept out of the pool');
  }
  assert.ok(pig.alive && pig.y < (ty + 2) * TILE, 'never fell in');
  // A fence instead of the pool: it keeps it in too.
  for (let x = tx + 5; x <= tx + 8; x++) for (let y = ty + 1; y <= ty + 4; y++) m.world.setTile(x, y, K.STONE);
  m.world.setTile(tx + 6, ty, K.FENCE);
  m.world.setTile(tx + 6, ty - 1, K.FENCE);
  for (let i = 0; i < 60; i++) {
    run(m.game, 60);
    assert.ok(pig.x > (tx + 6) * TILE, 'kept in by the fence');
  }
  // A carrot held near: it comes.
  hold(m, 'carrot', 3);
  m.world.setTile(tx + 6, ty, K.AIR);
  m.world.setTile(tx + 6, ty - 1, K.AIR);
  pig.body.x = m.me.x + 8 * TILE;
  run(m.game, 60 * 12);
  assert.ok(Math.abs(pig.x - m.me.x) < 4 * TILE, `came (${((pig.x - m.me.x) / TILE).toFixed(1)} tiles away)`);
});

// ---- Cooking and farming ------------------------------------------------------------------------------

test('cooking: at a campfire (or a furnace); the campfire made by hand, and lit', () => {
  assert.ok(RECIPES.some(r => r.key === 'campfire' && !r.at), 'by hand');
  assert.ok(K.LIGHT[K.CAMPFIRE] > 10, 'it lights the night');
  const m = play();
  run(m.game, 2);
  const inv = m.me.world.inv, { tx, ty } = feet(m.me);
  inv.add('raw_beef', 2);
  const steak = RECIPES.find(r => r.key === 'steak' && r.at === 'campfire');
  assert.equal(craft(inv, steak, stationsNear(m.world, m.me.x, m.me.y)).made, 0, 'no fire: no cooking');
  m.world.setTile(tx + 2, ty, K.CAMPFIRE);
  const near = stationsNear(m.world, m.me.x, m.me.y);
  assert.ok(near.has('campfire'));
  assert.equal(craft(inv, steak, near, 2).made, 2);
  assert.equal(inv.count('steak'), 2);
  // Every raw thing can be cooked, both ways.
  for (const it of ITEMS.values()) if (it.kind === 'food' && it.raw && it.key !== 'potato') for (const at of ['campfire', 'furnace']) assert.ok(RECIPES.some(r => r.at === at && r.of.length === 1 && r.of[0][0] === it.key), `${it.key} at a ${at}`);
});

test('farming: a hoe tills, seeds are planted, crops grow (faster watered), ripe ones give wheat and seeds; bone meal', () => {
  const m = play();
  run(m.game, 2);
  const { tx, ty } = feet(m.me), gx = tx + 3, gy = ty + 1;
  for (let x = gx - 1; x <= gx + 6; x++) { m.world.setTile(x, gy, K.GRASS); m.world.setTile(x, gy - 1, K.AIR); m.world.setTile(x, gy - 2, K.AIR); }
  m.world.setTile(gx + 1, gy - 1, K.TALL_GRASS);
  hold(m, 'hoe');
  click(m, tileAim(m.me, gx, gy));
  assert.equal(m.world.tile(gx, gy), K.FARMLAND, 'tilled');
  click(m, tileAim(m.me, gx + 1, gy));
  assert.equal(m.world.tile(gx + 1, gy), K.FARMLAND, 'under the grass too (it goes)');
  assert.equal(m.world.tile(gx + 1, gy - 1), K.AIR);
  // Seeds on it (clicking the farmland, or the air over it).
  hold(m, 'wheat_seeds', 4);
  click(m, tileAim(m.me, gx, gy));
  click(m, tileAim(m.me, gx + 1, gy - 1));
  assert.equal(m.world.tile(gx, gy - 1), K.WHEAT_CROPS[0], 'planted');
  assert.equal(m.world.tile(gx + 1, gy - 1), K.WHEAT_CROPS[0]);
  assert.equal(m.me.world.inv.count('wheat_seeds'), 2);
  // Not on plain grass.
  click(m, tileAim(m.me, gx + 3, gy));
  assert.equal(m.world.tile(gx + 3, gy - 1), K.AIR, 'not on grass');
  // Growing: by itself, in time (the world's own random growth).
  for (let i = 0; i < 400 && !ripe(m.world.tile(gx, gy - 1)); i++) run(m.game, 60);
  assert.ok(ripe(m.world.tile(gx, gy - 1)), 'ripe in time');
  // Picked: wheat and seeds.
  const before = drops(m, 'wheat');
  assert.ok(breakBlock(m.game, gx, gy - 1, m.me));
  assert.equal(drops(m, 'wheat') - before, 1, 'wheat');
  assert.ok(drops(m, 'wheat_seeds') >= 1, 'and seeds');
  // Bone meal: grown at once.
  if (ripe(m.world.tile(gx + 1, gy - 1))) { m.world.setTile(gx + 1, gy - 1, K.WHEAT_CROPS[0]); }
  hold(m, 'bone_meal', 3);
  click(m, tileAim(m.me, gx + 1, gy - 1));
  assert.ok(m.world.tile(gx + 1, gy - 1) >= K.WHEAT_CROPS[2], 'two stages or more');
  assert.equal(m.me.world.inv.count('bone_meal'), 2);
  // Carrots: planted, they give more (ripe).
  assert.deepEqual(harvest(K.CARROT_CROPS[0], () => 0.5), [['carrot', 1]]);
  assert.ok(harvest(K.CARROT_CROPS[3], () => 0.5)[0][1] >= 2);
  // Water near: faster (on average, over a lot of growth).
  const fast = (wet) => {
    const g = play();
    run(g.game, 2);
    const f = feet(g.me), y = f.ty + 1;
    for (let x = f.tx - 8; x <= f.tx + 8; x++) { g.world.setTile(x, y, K.FARMLAND); g.world.setTile(x, y - 1, x === f.tx ? K.AIR : K.WHEAT_CROPS[0]); g.world.setTile(x, y - 2, K.AIR); }
    if (wet) for (const x of [f.tx - 9, f.tx + 9]) g.world.setTile(x, y, K.WATER);
    for (let i = 0; i < 60 * 60 * 2; i++) farmingTick(g.game), g.game.tick++;
    let stages = 0;
    for (let x = f.tx - 8; x <= f.tx + 8; x++) stages += K.BLOCKS[g.world.tile(x, y - 1)].stage || 0;
    return stages;
  };
  assert.ok(fast(true) > fast(false), 'watered: faster');
});

test('seeds from tall grass, flint from gravel (now and then); crops fall when their farmland goes', () => {
  let seeds = 0, flint = 0;
  for (let i = 0; i < 400; i++) {
    const r = (i % 100) / 100;
    seeds += (harvest(K.TALL_GRASS, () => r) || []).length;
    flint += (harvest(K.GRAVEL, () => r) || []).length;
  }
  assert.ok(seeds > 20 && seeds < 100, `seeds ${seeds}`);
  assert.ok(flint > 20 && flint < 80, `flint ${flint}`);
  const m = play();
  run(m.game, 2);
  const { tx, ty } = feet(m.me);
  m.world.setTile(tx + 3, ty + 1, K.FARMLAND);
  m.world.setTile(tx + 3, ty, K.WHEAT_CROPS[3]);
  breakBlock(m.game, tx + 3, ty + 1, m.me);
  assert.equal(m.world.tile(tx + 3, ty), K.AIR, 'the crop went with it');
});

test('what animals give and farming makes is had somewhere (the codex says how), and worth something', () => {
  const all = codexEntries();
  for (const key of ['raw_beef', 'leather', 'wool', 'feather', 'egg', 'flint', 'wheat_seeds', 'carrot', 'potato', 'bone_meal', 'hoe', 'shears', 'campfire', 'steak', 'berry_pie']) {
    const e = all.find(x => x.key === key);
    assert.ok(e && e.where && e.where !== 'Found in the world', `${key}: ${e?.where}`);
  }
  assert.ok(RECIPES.some(r => r.key === 'leather_armor') && RECIPES.some(r => r.key === 'bed' && r.of.some(([k]) => k === 'wool')), 'leather armour, and beds of wool');
});

// ---- Online -----------------------------------------------------------------------------------------------

test('online: a player\'s hunger is sent to them; animals show for them (sheared or not), as animals', async () => {
  const world = new TileWorld({ seed: 4242, name: 'Shared', gen: 6 });
  world.settings = cleanSettings({});
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, effects: true, seed: 1, options: { destruction: true } });
  game.online = true;
  game.addSoldier({ name: 'Host', isBot: false }, { input: () => ({ move: 0 }) });
  const sync = new WorldHost(game, { load: () => null, save: () => {} });
  const host = new NetHost({ maxPlayers: 8, botCount: 0, world: sync, matchInfo: () => ({ mode: 'world', mapName: world.name, speed: DEFAULT_SPEED, options: game.options, world: sync.info() }), addBot: () => {} });
  host.setGame(game);
  let now = 0;
  const queue = [], schedule = (fn, ms) => queue.push({ fn, at: now + ms });
  const [h, c] = memoryLinks({ latency: 20, schedule });
  const client = new NetClient({ link: c, controller: { input: () => ({ move: 0 }) }, loadMap: async () => null, clock: () => now, world: new WorldClient({}) });
  host.addPlayer(h, 'Guest');
  const pump = async () => { for (let k = 0; k < 4; k++) { await new Promise(r => setImmediate(r)); const due = queue.filter(q => q.at <= now); for (const q of due) { queue.splice(queue.indexOf(q), 1); q.fn(); } } };
  const step = async (n = 1) => { for (let i = 0; i < n; i++) { game.update(); host.afterTick(); client.tick(); now += 1000 / 60; await pump(); client.updateView(now); } };
  await pump();
  await step(180);
  const guest = game.soldiers.find(s => s.remote);
  assert.ok(guest?.world, 'joined');
  assert.equal(client.game.world.genVersion, world.genVersion, 'the same world, made the same way');
  guest.world.food = 7;
  await step(20);
  assert.equal(client.me.world.food, 7, 'their hunger, as the host has it');
  const sheep = spawnAnimal(game, 'sheep', guest.x + 60, guest.y);
  await step(40);
  const seen = client.game.soldiers.find(s => s.id === sheep.id);
  assert.ok(seen?.npc?.kind === 'animal' && parseLook(seen.npc.look).type === 'sheep', 'a sheep, there too');
  sheep.npc.shorn = game.tick;
  sheep.skin = 'sheep.s';
  await step(40);
  assert.equal(parseLook(client.game.soldiers.find(s => s.id === sheep.id).npc.look).shorn, true, 'sheared, there too');
});
