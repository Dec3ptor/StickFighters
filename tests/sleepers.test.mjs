// Creatures out of everyone's way sleep where they are (web/src/world/sleepers.js): a monster or an
// animal far from every player is kept where it was, as hurt as it was, with its name and what's its
// own, and wakes there when someone comes back; time stands still for it meanwhile; raiders aren't
// kept; nothing's made again that's only asleep (a quest's quarry); and it's all kept in the world's
// save. The townsfolk keep their places too (townsfolk.js): back where they were, not at home.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { TileWorld, TILE } from '../web/src/world/tileworld.js';
import { worldFromSave } from '../web/src/world/worldplay.js';
import { spawnMonster, monstersTick, isMonster, DAY_TICKS, isNight } from '../web/src/world/monsters.js';
import { spawnAnimal } from '../web/src/world/animals.js';
import { isFolk, folkToSave, folkFromSave } from '../web/src/world/townsfolk.js';
import { sleepersToSave, sleepersFromSave, asleepNear, asleepAny, lull, SLEEP_AT } from '../web/src/world/sleepers.js';

/** A world and a player standing at its start (no monsters of its own coming). */
function play(opts = {}) {
  const world = new TileWorld({ seed: 4242, name: 'Sleepers', gen: 6, ...opts });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const ctl = { script: { move: 0 }, input() { return this.script; } };
  const me = game.addSoldier({ name: 'Wanderer', isBot: false }, ctl);
  me.world = worldFromSave(null);
  for (let i = 0; i < 300 && !me.alive; i++) game.update();
  me.spawnProtect = 0;
  world.devQuiet = true;
  // (Nobody hurts the one walking about: the test's about the others.)
  me.spawnProtect = 1e9;
  return { world, game, me };
}
const run = (game, n) => { for (let i = 0; i < n; i++) game.update(); };
/** The player at column tx, on the ground there (the land made first). */
function goTo(m, tx) {
  for (let cy = 0; cy < 16; cy++) m.world.chunk(Math.floor(tx / 32), cy);
  const ty = m.world.surface(tx);
  m.me.body.x = tx * TILE + 8; m.me.body.y = ty * TILE - 14; m.me.body.vx = m.me.body.vy = 0;
}
const named = (m, name) => m.game.soldiers.find(s => s.name === name);

test('a monster far from everyone sleeps where it is, and wakes there, as hurt as it was, with its name and what\'s its own', () => {
  const m = play(), home = Math.floor(m.me.x / TILE);
  const z = spawnMonster(m.game, 'skeleton', m.me.x + 60 * TILE, m.me.y - 40);
  run(m.game, 3);
  z.name = 'Bonesy';
  z.npc.champion = 'wild';
  z.maxHealth = 300;
  z.health = 120;
  run(m.game, 20);
  // (Everyone off far away: asleep, where it was.)
  const was = { x: z.x, y: z.y };
  goTo(m, home + 400);
  run(m.game, 40);
  assert.equal(named(m, 'Bonesy'), undefined, 'not about');
  assert.equal(asleepNear(m.world, was.x, was.y, 3 * TILE, 3 * TILE, r => r.name === 'Bonesy'), 1, 'asleep where it was');
  const kept = [...m.world.sleepers.values()].flat().find(r => r.name === 'Bonesy');
  // (Back: awake, as it was, just where it fell asleep.)
  goTo(m, home);
  let back = null;
  for (let i = 0; i < 60 && !back; i++) { m.game.update(); back = m.game.soldiers.find(s => s.name === 'Bonesy' && s.alive) || null; }
  assert.ok(back, 'awake again');
  assert.equal(back.npc.champion, 'wild');
  assert.equal(back.maxHealth, 300);
  assert.equal(back.health, 120, 'as hurt as it was');
  assert.ok(Math.abs(back.x - kept.x) < 4 && Math.abs(back.y - kept.y) < 4, `where it was (${Math.round(back.x - kept.x)}, ${Math.round(back.y - kept.y)} px off)`);
  run(m.game, 30);
  assert.equal(m.game.soldiers.filter(s => s.name === 'Bonesy').length, 1, 'just the one');
});

test('an animal asleep grows no older; raiders aren\'t kept', () => {
  const m = play(), home = Math.floor(m.me.x / TILE);
  const lamb = spawnAnimal(m.game, 'sheep', m.me.x + 40 * TILE, m.me.y - 40, { baby: m.game.tick - 100, variant: 2, kept: true });
  lamb.name = 'Dolly';
  const raider = spawnMonster(m.game, 'zombie', m.me.x + 50 * TILE, m.me.y - 40);
  raider.name = 'Raider';
  raider.npc.raid = 3;
  run(m.game, 20);
  const age = m.game.tick - lamb.npc.baby;
  goTo(m, home + 400);
  run(m.game, 900);
  assert.equal(named(m, 'Dolly'), undefined, 'the lamb asleep');
  assert.equal(named(m, 'Raider'), undefined, 'the raider gone');
  assert.equal(asleepNear(m.world, m.me.x - 400 * TILE, m.me.y, 200 * TILE, 200 * TILE, r => r.name === 'Raider'), 0, 'and not kept');
  goTo(m, home);
  run(m.game, 40);
  const back = named(m, 'Dolly');
  assert.ok(back?.alive, 'the lamb\'s back');
  assert.equal(back.npc.variant, 2);
  assert.ok(back.npc.kept);
  const now = m.game.tick - back.npc.baby;
  assert.ok(now < age + 120, `no older for being away (${age} then, ${now} now)`);
});

test('kept in the world\'s save: those asleep and those awake, asleep again in the world loaded', () => {
  const m = play(), home = Math.floor(m.me.x / TILE);
  const far = spawnMonster(m.game, 'brute', m.me.x + 30 * TILE, m.me.y - 40);
  far.name = 'Far one';
  const near = spawnAnimal(m.game, 'cow', m.me.x - 20 * TILE, m.me.y - 40);
  near.name = 'Daisy';
  run(m.game, 20);
  goTo(m, home + 400);
  run(m.game, 40);
  goTo(m, home - 2);
  run(m.game, 2);
  // (Saved just as the player's come back: the brute may be asleep or waking; the cow, awake or asleep.)
  const data = JSON.parse(JSON.stringify(sleepersToSave(m.game)));
  assert.ok(data.some(r => r.name === 'Far one' && r.kind === 'monster' && r.type === 'brute'), 'the brute');
  assert.ok(data.some(r => r.name === 'Daisy' && r.kind === 'animal' && r.type === 'cow'), 'the cow');
  const w2 = new TileWorld({ seed: 4242, name: 'Again', gen: 6 });
  sleepersFromSave(w2, data);
  assert.ok(asleepAny(w2, r => r.name === 'Far one') && asleepAny(w2, r => r.name === 'Daisy'), 'asleep in the world loaded');
  sleepersFromSave(w2, [{ kind: 'dragon', type: 'x', x: 0, y: 0 }, { kind: 'monster', type: 'zombie', x: 'no' }, null]);
  assert.equal(w2.sleeperCount, 0, 'nothing that isn\'t a creature');
});

test('too many asleep in one place: the longest asleep let go, but not an animal that\'s someone\'s', () => {
  const m = play();
  const herd = Array.from({ length: 70 }, (_, i) => spawnAnimal(m.game, 'cow', m.me.x + 40 * TILE + (i % 10), m.me.y - 40, i === 0 ? { kept: true } : {}));
  herd[0].name = 'Bessie';
  run(m.game, 5);
  assert.ok(herd.every(s => s.alive));
  for (const s of herd) lull(m.game, s);
  const kept = [...m.world.sleepers.values()].flat();
  assert.equal(kept.length, 64, 'no more than so many in one place');
  assert.equal(m.world.sleeperCount, 64, 'and counted right');
  assert.ok(kept.some(r => r.name === 'Bessie'), 'the one that\'s someone\'s kept, though asleep the longest');
});

test('a quest\'s quarry asleep isn\'t made again', async () => {
  const m = play();
  const q = spawnMonster(m.game, 'brute', m.me.x + 30 * TILE, m.me.y - 40);
  q.npc.champion = 'q1#0';
  run(m.game, 20);
  goTo(m, Math.floor(m.me.x / TILE) + 400);
  run(m.game, 40);
  assert.ok(asleepAny(m.world, r => r.own?.champion === 'q1#0'), 'asleep, and known to be');
});

test('where monsters are asleep, no more come besides (they\'ll be about again)', () => {
  const m = play();
  m.world.devQuiet = false;
  // (Midnight.)
  let t = 0;
  while (!isNight(t)) t += DAY_TICKS / 48;
  const tries = () => { for (let i = 0; i < 3000; i++) { m.game.tick++; m.world.time = t; monstersTick(m.game); } };
  const awake = () => m.game.soldiers.filter(isMonster).length;
  sleepersFromSave(m.world, Array.from({ length: 6 }, (_, i) => ({ kind: 'monster', type: 'zombie', name: 'Zombie', x: m.me.x + (30 + i * 4) * TILE, y: m.me.y, hp: 50, max: 70 })));
  const before = awake();
  tries();
  assert.equal(awake(), before, 'none came: enough asleep round here');
  // (None asleep: some come.)
  sleepersFromSave(m.world, []);
  tries();
  assert.ok(awake() > before, 'with none asleep, some come');
});

test('the townsfolk come back where they were, not at home, as hurt as they were; kept in the save', () => {
  const world = new TileWorld({ seed: 777, name: 'Folk', towns: true });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const me = game.addSoldier({ name: 'Walker', isBot: false }, { input: () => ({ move: 0 }) });
  for (let i = 0; i < 300 && !me.alive; i++) game.update();
  const t = world.gen.townIn(world.gen.spawnRegion), mid = (t.x0 + t.x1) >> 1;
  const m = { world, game, me };
  goTo(m, mid);
  run(game, 150);
  const one = game.soldiers.find(s => isFolk(s) && s.alive && !s.npc.guard);
  assert.ok(one, 'someone in town');
  // (Somewhere that isn't home, and hurt.)
  one.body.x += 3 * TILE;
  one.health = Math.max(1, one.maxHealth - 7);
  const key = one.npc.key;
  goTo(m, mid + 400);
  run(game, 60);
  assert.ok(!game.soldiers.some(s => isFolk(s) && s.npc.key === key), 'gone, everyone being far');
  const kept = world.folkWhere.get(key);
  assert.ok(kept && kept[2] === one.maxHealth - 7, `where they were, and how hurt, kept (${kept})`);
  const saved = JSON.parse(JSON.stringify(folkToSave(game)));
  assert.deepEqual(saved.where[key], kept, 'and saved');
  // (Back: they come back just there.)
  goTo(m, mid);
  let back = null;
  for (let i = 0; i < 300 && !back; i++) { game.update(); back = game.soldiers.find(s => isFolk(s) && s.npc.key === key && s.alive) || null; }
  assert.ok(back, 'back');
  assert.ok(Math.abs(back.x - kept[0]) < 4, `where they were (${Math.round(back.x - kept[0])} px off)`);
  assert.equal(back.health, kept[2], 'as hurt as they were');
  // (From a save.)
  const w2 = new TileWorld({ seed: 777, name: 'Folk', towns: true });
  folkFromSave(w2, saved);
  assert.deepEqual(w2.folkWhere.get(key), saved.where[key]);
  folkFromSave(w2, { where: { a: 'no', b: [1] } });
  assert.equal(w2.folkWhere.size, 0, 'nothing that isn\'t somewhere');
  assert.ok(SLEEP_AT > 0);
});
