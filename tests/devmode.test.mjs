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
import { DEFAULT_SPEED, MOTION, BODY } from '../web/src/config.js';
import * as K from '../web/src/world/blocks.js';
import { TileWorld } from '../web/src/world/tileworld.js';
import { setDev, FLY_SPEED, FLY_SPRINT } from '../web/src/world/devmode.js';
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

test('flying: drawn (and followed) from where it was each update to where it is, speeding up and slowing down smoothly, facing where it aims', () => {
  const { game, me, ctl } = play();
  run(game, 30);
  setDev(game, me, true);
  const full = FLY_SPRINT * MOTION.timeScale;
  // Off: picks up speed over a moment (not all at once), to full speed.
  ctl.script = { move: 1, sprint: true, aim: Math.PI };
  const steps = [];
  for (let i = 0; i < 12; i++) { const x = me.x; game.update(); steps.push(me.x - x); }
  assert.ok(steps[0] > 0 && steps[0] < full / 2, `not all at once (${steps[0].toFixed(1)})`);
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i] >= steps[i - 1], 'faster and faster');
  assert.ok(steps.at(-1) > full * 0.98, `full speed in a moment (${steps.at(-1).toFixed(1)} of ${full})`);
  run(game, 4);
  for (let i = 0; i < 30; i++) {
    const x = me.x, y = me.y;
    game.update();
    assert.equal(me.prevX, x, 'where it was: the last update\'s');
    assert.equal(me.prevY, y);
    assert.ok(Math.abs(me.x - me.prevX - full) < 1e-6, `a steady step (${(me.x - me.prevX).toFixed(2)})`);
  }
  assert.equal(me.facing, -1, 'facing where it aims, flying the other way');
  // Stopping: slows down, and stops soon after (not far past where you let go).
  ctl.script = { aim: 0 };
  const x0 = me.x;
  run(game, 20);
  assert.equal(me.x, me.prevX, 'stopped');
  assert.ok(me.x - x0 < full * 3, `not far past (${((me.x - x0) / 16).toFixed(1)} tiles)`);
  assert.equal(me.facing, 1, 'and turned');
  // Up, and across and up at once (no faster than straight).
  ctl.script = { jump: true };
  const y0 = me.y;
  run(game, 20);
  assert.ok(me.y < y0 - 10 * FLY_SPEED * MOTION.timeScale, 'up');
  ctl.script = { jump: true, move: 1 };
  run(game, 20);
  const d = Math.hypot(me.x - me.prevX, me.y - me.prevY);
  assert.ok(Math.abs(d - FLY_SPEED * MOTION.timeScale) < 0.05, `no faster across and up (${d.toFixed(2)})`);
});

test('dev mode off inside the ground: out to the nearest place with room to stand, not stuck in it', () => {
  const { world, game, me, ctl } = play();
  run(game, 30);
  setDev(game, me, true);
  ctl.script = { crouch: true };
  run(game, 50);
  ctl.script = {};
  run(game, 20);
  const inGround = () => !!world.overlap(me.x - BODY.halfW, me.y + BODY.top, me.x + BODY.halfW, me.y + BODY.bottom);
  // (Somewhere solid, for certain: blocks put all round.)
  const tx = Math.floor(me.x / 16), ty = Math.floor(me.y / 16);
  for (let y = ty - 3; y <= ty + 3; y++) for (let x = tx - 2; x <= tx + 2; x++) world.setTile(x, y, K.STONE);
  assert.ok(inGround(), 'in the ground');
  const at = { x: me.x, y: me.y };
  setDev(game, me, false);
  assert.ok(!inGround(), 'out of it');
  assert.ok(Math.hypot(me.x - at.x, me.y - at.y) < 26 * 16, `near where they were (${Math.round(Math.hypot(me.x - at.x, me.y - at.y) / 16)} tiles)`);
  assert.match(game.notes.at(-1).text, /out of the ground/);
  run(game, 120);
  assert.ok(me.alive, 'and fine');
  // In the open: left where they are.
  setDev(game, me, true);
  const open = { x: me.x, y: me.y };
  setDev(game, me, false);
  assert.deepEqual({ x: me.x, y: me.y }, open, 'not moved');
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
  let script = { move: 0 };
  const client = new NetClient({ link: c, controller: { input: () => ({ ...script }) }, loadMap: async () => null, clock: () => now, world: new WorldClient({}) });
  net.addPlayer(h, 'Guest');
  const pump = async () => { for (let k = 0; k < 4; k++) { await new Promise(r => setImmediate(r)); for (const q of queue.filter(q => q.at <= now)) { queue.splice(queue.indexOf(q), 1); q.fn(); } } };
  const step = async (n = 1) => { for (let i = 0; i < n; i++) { game.update(); net.afterTick(); client.tick(); now += 1000 / 60; await pump(); } };
  await pump();
  await step(120);
  const guest = game.soldiers.find(s => s.remote);
  assert.ok(guest?.world?.dev, 'dev mode, theirs too');
  assert.equal(client.me.world.hostDev, true, 'and their screen knows');
  // Flying: their own screen moves them as the host does (no snapping back to where walking would have them).
  script = { move: 1, sprint: true, aim: 0 };
  let worst = 0;
  const y0 = client.me.y;
  for (let i = 0; i < 90; i++) { await step(); worst = Math.max(worst, Math.abs(client.me.drawDX || 0), Math.abs(client.me.drawDY || 0)); }
  script = { move: 0, aim: 0 };
  await step(30);
  assert.ok(client.me.x - guest.x < 1 && Math.abs(client.me.y - guest.y) < 1, `where the host has them (${(client.me.x - guest.x).toFixed(1)}, ${(client.me.y - guest.y).toFixed(1)})`);
  assert.ok(Math.abs(client.me.y - y0) < 1, 'level: flying, not falling');
  assert.ok(worst < 2, `never put right by more than a little (${worst.toFixed(1)} px)`);
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
  assert.equal(client.me.world.hostDev, false, 'their screen knows');
  c.send({ t: 'wop', op: 'craft', r: diamond.id, times: 1 }, true);
  c.send({ t: 'wop', op: 'devtake', id: 'diamond' }, true);
  await step(10);
  assert.equal(guest.world.inv.count('diamond'), 2 * diamond.n, 'nothing more');
});
