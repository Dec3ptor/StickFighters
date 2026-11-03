// A world's dev mode (web/src/world/devmode.js): flying smoothly (drawn, and followed by the
// camera, between where it was and where it is), and everything free: every recipe, anywhere,
// from nothing, and everything else there is besides (crafting.js's DEV_RECIPES); the codex
// gives anything, uniques and set pieces too. Online: a guest's own, in a creative world.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { NetHost } from '../web/src/net/host.js';
import { NetClient } from '../web/src/net/client.js';
import { memoryLinks } from '../web/src/net/peer.js';
import { DEFAULT_SPEED, MOTION } from '../web/src/config.js';
import { TileWorld } from '../web/src/world/tileworld.js';
import { setDev } from '../web/src/world/devmode.js';
import { RECIPES, DEV_RECIPES, recipeById } from '../web/src/world/crafting.js';
import { makeRecipe, devTake } from '../web/src/world/worldplay.js';
import { ITEMS, HOTBAR, BAG } from '../web/src/world/items.js';
import { codexEntries } from '../web/src/world/codex.js';
import { progOf } from '../web/src/world/progress.js';
import { cleanSettings } from '../web/src/world/worldrules.js';
import { WorldHost, WorldClient } from '../web/src/world/worldnet.js';

function play(settings = null) {
  const world = new TileWorld({ seed: 4242, name: 'Dev', gen: 3 });
  if (settings) world.settings = cleanSettings(settings);
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const ctl = { script: { move: 0 }, input() { return this.script; } };
  const me = game.addSoldier({ name: 'Dev', isBot: false }, ctl);
  for (let i = 0; i < 300 && !me.alive; i++) game.update();
  assert.ok(me.alive, 'spawned');
  return { world, game, me, ctl };
}
const run = (game, n) => { for (let i = 0; i < n; i++) game.update(); };

test('flying: drawn (and followed) from where it was each update to where it is, facing where it aims', () => {
  const { game, me, ctl } = play();
  run(game, 30);
  setDev(game, me, true);
  ctl.script = { move: 1, sprint: true, aim: Math.PI };
  run(game, 2);
  for (let i = 0; i < 30; i++) {
    const x = me.x, y = me.y;
    game.update();
    assert.equal(me.prevX, x, 'where it was: the last update\'s');
    assert.equal(me.prevY, y);
    assert.ok(Math.abs(me.x - me.prevX - 30 * MOTION.timeScale) < 1e-6, `a steady step (${(me.x - me.prevX).toFixed(2)})`);
  }
  assert.equal(me.facing, -1, 'facing where it aims, flying the other way');
  ctl.script = { jump: true, aim: 0 };
  const y0 = me.y;
  run(game, 10);
  assert.ok(me.y < y0 - 5 * 10 * MOTION.timeScale && me.facing === 1, 'up, and turned');
});

test('everything free in dev mode: every recipe, anywhere, from nothing; everything else there is too; no XP for it', () => {
  // (Everything there is can be had: by a recipe, or dev mode's own.)
  const can = new Set([...RECIPES, ...DEV_RECIPES].map(r => r.key));
  for (const key of ITEMS.keys()) assert.ok(can.has(key), `${key} can be had`);
  for (const r of [...RECIPES, ...DEV_RECIPES]) assert.equal(recipeById(r.id), r, `recipe ${r.id} by its number`);
  assert.equal(recipeById(-1), null);
  assert.equal(recipeById('3'), null);
  assert.equal(recipeById(DEV_RECIPES.at(-1).id + 1), null);

  const { game, me } = play();
  const inv = me.world.inv;
  inv.slots.fill(null);
  const ender = RECIPES.find(r => r.key === 'ender_chest'), diamond = DEV_RECIPES.find(r => r.key === 'diamond');
  assert.equal(makeRecipe(game, me, ender, 1), 0, 'not in dev mode: not without what it takes');
  assert.equal(makeRecipe(game, me, diamond, 1), 0, 'nor dev mode\'s own');
  setDev(game, me, true);
  const xp = progOf(me).xp, made = progOf(me).stats?.crafted || 0;
  assert.equal(makeRecipe(game, me, ender, 5), 5, 'five times, from nothing, with no anvil near');
  assert.equal(inv.count('ender_chest'), 5);
  assert.equal(makeRecipe(game, me, diamond, 2), 2);
  assert.equal(inv.count('diamond'), 2 * diamond.n, 'a stack each time');
  assert.equal(progOf(me).xp, xp, 'no XP for it');
  assert.equal(progOf(me).stats?.crafted || 0, made, 'nor counted as made');
  // Gear: a plain piece of it, each.
  makeRecipe(game, me, DEV_RECIPES.find(r => r.key === 'leather_cap'), 2);
  const caps = inv.slots.filter(s => s?.key === 'leather_cap');
  assert.equal(caps.length, 2);
  assert.ok(caps.every(s => s.g?.r === 'basic' && s.g.name === 'Leather cap'), 'plain caps');
  // No room: on the ground (gear, a piece at a time, as it was made).
  for (let i = 0; i < HOTBAR + BAG; i++) if (!inv.slots[i]) inv.slots[i] = { key: 'dirt', n: 999 };
  const drops = (game.world.drops ||= []).length;
  makeRecipe(game, me, DEV_RECIPES.find(r => r.key === 'leather_boots'), 2);
  const fell = game.world.drops.slice(drops);
  assert.equal(fell.length, 2, 'both on the ground');
  assert.ok(fell.every(d => d.key === 'leather_boots' && d.n === 1 && d.g?.r === 'basic'));
});

test('the codex in dev mode: any of it, free: uniques and set pieces as they drop, a stack of anything else', () => {
  const { game, me } = play();
  const inv = me.world.inv;
  inv.slots.fill(null);
  const all = codexEntries(), u = all.find(e => e.cat === 'unique'), set = all.find(e => e.cat === 'set');
  assert.equal(devTake(game, me, u.id), null, 'not out of dev mode');
  setDev(game, me, true);
  assert.match(devTake(game, me, u.id), new RegExp(`Took ${u.name}`));
  const got = inv.slots.find(s => s?.key === u.key);
  assert.equal(got?.g?.unique, u.g.unique, 'the unique');
  got.g.stats.armor = 999;
  assert.notEqual(u.g.stats.armor, 999, 'a piece of its own (the codex\'s is untouched)');
  devTake(game, me, set.id);
  assert.equal(inv.slots.find(s => s?.key === set.key && s.g?.set)?.g.set, set.g.set, 'the set piece');
  assert.match(devTake(game, me, 'diamond'), /Took 99 × Diamond/);
  assert.equal(inv.count('diamond'), 99);
  for (const bad of ['u:nobody', 's:none:leather_cap', 'nothing', 42, null]) assert.equal(devTake(game, me, bad), null, `${bad}: nothing`);
});

test('online, in a creative world: a guest makes anything for free and takes from the codex; their screen knows', async () => {
  const world = new TileWorld({ seed: 4242, name: 'Creative', gen: 3 });
  world.settings = cleanSettings({ mode: 'creative' });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, effects: false, seed: 1, options: { destruction: true } });
  game.online = true;
  game.addSoldier({ name: 'Host', isBot: false }, { input: () => ({ move: 0 }) });
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
  const guest = game.soldiers.find(s => s.remote);
  assert.ok(guest?.world?.dev, 'dev mode, theirs too');
  assert.equal(client.me.world.devCraft, true, 'and their screen knows');
  const diamond = DEV_RECIPES.find(r => r.key === 'diamond');
  c.send({ t: 'wop', op: 'craft', r: diamond.id, times: 2 }, true);
  c.send({ t: 'wop', op: 'devtake', id: 'u:warden' }, true);
  await step(10);
  assert.equal(guest.world.inv.count('diamond'), 2 * diamond.n, 'made, on the host');
  assert.equal(client.me.world.inv.count('diamond'), 2 * diamond.n, 'and they have them');
  assert.equal(guest.world.inv.slots.find(s => s?.g?.unique === 'warden')?.key, 'plate', 'taken from the codex');
  // Dev mode off (in a creative world it stays off): nothing free any more.
  setDev(game, guest, false);
  await step(10);
  assert.equal(client.me.world.devCraft, false, 'their screen knows');
  c.send({ t: 'wop', op: 'craft', r: diamond.id, times: 1 }, true);
  c.send({ t: 'wop', op: 'devtake', id: 'diamond' }, true);
  await step(10);
  assert.equal(guest.world.inv.count('diamond'), 2 * diamond.n, 'nothing more');
});
