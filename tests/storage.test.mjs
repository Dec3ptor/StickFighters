// Sleeping, storage and getting about (world mode): beds (sleeping the night away, coming back at
// your bed), ender chests (your own things, the same in every one), shulker boxes (picked up with
// what's in them), waystones (from one to any other), recall scrolls (home), and putting your
// bag away into the chests near you. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { TileWorld, TILE } from '../web/src/world/tileworld.js';
import * as K from '../web/src/world/blocks.js';
import { chestAt, boxFor, breakBlock, playerToSave, worldFromSave, stackToChests, RECALL_TICKS } from '../web/src/world/worldplay.js';
import { DAY_TICKS, hourOf, spawnMonster } from '../web/src/world/monsters.js';
import { canSleepNow } from '../web/src/world/sleep.js';
import { waystoneMenu, waystoneAt, warp, waystonesToSave, waystonesFromSave, WARP_COOL } from '../web/src/world/waystones.js';
import { Inventory, itemOf } from '../web/src/world/items.js';
import { itemDetails } from '../web/src/world/iteminfo.js';

function play(seed = 4242) {
  const world = new TileWorld({ seed, name: 'Test' });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const ctl = { script: { move: 0 }, input() { return this.script; } };
  const me = game.addSoldier({ name: 'Tester', isBot: false }, ctl);
  return { world, game, me, ctl };
}
/** A flat stone floor at the start, cleared for 30 tiles each way and 14 up. */
function arena(world) {
  const sp = world.spawns[0], fx = Math.floor(sp.x / TILE), fy = Math.floor((sp.y + 13) / TILE);
  for (let y = fy - 14; y <= fy + 2; y++) {
    for (let x = fx - 30; x <= fx + 30; x++) {
      world.setTile(x, y, y >= fy ? K.STONE : K.AIR);
      world.setWall(x, y, K.NO_WALL);
    }
  }
  return { fx, fy };
}
const run = (game, n) => { for (let i = 0; i < n; i++) game.update(); };
function untilAlive(game, me) { for (let i = 0; i < 300 && !me.alive; i++) game.update(); assert.ok(me.alive, 'spawned'); }
const aimAt = (me, tx, ty) => { const x = tx * TILE + 8, y = ty * TILE + 8; return { aim: Math.atan2(y - me.shoulderY, x - me.shoulderX), aimDist: Math.hypot(x - me.shoulderX, y - me.shoulderY) }; };
/** Right click on tile (tx, ty). */
function rightClick(m, tx, ty) {
  m.ctl.script = { move: 0, alt: true, ...aimAt(m.me, tx, ty) };
  run(m.game, 3);
  m.ctl.script = { move: 0 };
  run(m.game, 2);
}
/** Put item `key` (in hotbar slot 9) down at (tx, ty), with a click. */
function place(m, key, tx, ty, g = null) {
  const inv = m.me.world.inv;
  inv.slots[9] = g ? { key, n: 1, g } : { key, n: 1 };
  inv.version++;
  m.ctl.script = { move: 0, switchTo: '#9' };
  run(m.game, 2);
  m.ctl.script = { move: 0, fire: true, firePressed: true, ...aimAt(m.me, tx, ty) };
  run(m.game, 2);
  m.ctl.script = { move: 0 };
  run(m.game, 2);
  return m.world.tile(tx, ty);
}
function start() {
  const m = play();
  const { fx, fy } = arena(m.world);
  untilAlive(m.game, m.me);
  m.world.devQuiet = true;
  run(m.game, 30);
  return { ...m, fx, fy };
}

test('beds: right clicked, where you come back; at night you sleep, and the night goes by; a bed gone, you\'re told', () => {
  const m = start(), { fx, fy, me, world } = m;
  world.time = DAY_TICKS * 0.3; // day
  assert.equal(place(m, 'bed', fx + 2, fy - 1), K.BED);
  rightClick(m, fx + 2, fy - 1);
  assert.equal(me.world.home?.tx, fx + 2, 'where you come back');
  assert.equal(me.world.sleep ?? null, null, 'no sleeping by day');
  // Night: to bed, and the night goes by.
  world.time = DAY_TICKS * 0.62;
  assert.ok(canSleepNow(world), `night (${hourOf(world.time).toFixed(1)})`);
  rightClick(m, fx + 2, fy - 1);
  assert.ok(me.world.sleep, 'asleep');
  const before = world.time;
  let n = 0;
  while (me.world.sleep && n < 3000) { m.game.update(); n++; }
  assert.equal(me.world.sleep, null, 'awake again');
  const h = hourOf(world.time);
  assert.ok(h >= 6 && h < 7 && world.time > before && n < 400, `the morning, quickly (${h.toFixed(2)} after ${n} updates)`);
  // Moving gets you up; monsters near keep you awake.
  world.time = DAY_TICKS * 0.62;
  rightClick(m, fx + 2, fy - 1);
  run(m.game, 30);
  m.ctl.script = { move: 1 };
  run(m.game, 2);
  m.ctl.script = { move: 0 };
  assert.equal(me.world.sleep, null, 'up when you move');
  world.devQuiet = false;
  const z = spawnMonster(m.game, 'zombie', me.x + 60, me.y);
  run(m.game, 2);
  rightClick(m, fx + 2, fy - 1);
  assert.equal(me.world.sleep ?? null, null, 'not with monsters near');
  m.game.kill(z, me, 'Shotgun');
  world.devQuiet = true;
  // Dying: back at the bed; the bed gone: where the world starts.
  me.spawnProtect = 0;
  m.game.kill(me, null, 'Fall');
  untilAlive(m.game, me);
  assert.ok(Math.abs(me.x - ((fx + 2) * TILE + 8)) < 24, 'back at the bed');
  world.setTile(fx + 2, fy - 1, K.AIR);
  me.spawnProtect = 0;
  m.game.kill(me, null, 'Fall');
  untilAlive(m.game, me);
  assert.equal(me.world.home, null, 'no bed now');
  assert.ok(Math.abs(me.x - world.spawns[0].x) < 40, 'where the world starts');
  // Kept: the bed's tile too.
  me.world.home = { x: 1, y: 2, tx: 3, ty: 4 };
  assert.deepEqual(worldFromSave(JSON.parse(JSON.stringify(playerToSave(me, m.game)))).home, { x: 1, y: 2, tx: 3, ty: 4 });
});

test('ender chests: your own things, the same in every one, anywhere; kept with you', () => {
  const m = start(), { fx, fy, me } = m;
  assert.equal(place(m, 'ender_chest', fx - 3, fy - 1), K.ENDER_CHEST);
  assert.equal(place(m, 'ender_chest', fx + 4, fy - 1), K.ENDER_CHEST);
  rightClick(m, fx - 3, fy - 1);
  const a = boxFor(m.game, me, fx - 3, fy - 1);
  assert.ok(a && a === me.world.ender, 'your own');
  a.add('diamond', 3);
  assert.equal(boxFor(m.game, me, fx + 4, fy - 1).count('diamond'), 3, 'the same things in the other');
  assert.equal(chestAt(m.world, fx - 3, fy - 1), null, 'nothing kept in the world');
  const other = m.game.addSoldier({ name: 'Other', isBot: false }, { input: () => ({ move: 0 }) });
  untilAlive(m.game, other);
  assert.equal(boxFor(m.game, other, fx + 4, fy - 1).count('diamond'), 0, 'someone else\'s is theirs');
  // Broken: the chest, and your things still yours.
  breakBlock(m.game, fx - 3, fy - 1, me);
  assert.equal(me.world.ender.count('diamond'), 3);
  const back = worldFromSave(JSON.parse(JSON.stringify(playerToSave(me, m.game))));
  assert.equal(back.ender.count('diamond'), 3, 'kept');
});

test('shulker boxes: broken, picked up with what\'s in them; put down, there it all is; no box in a box', () => {
  const m = start(), { fx, fy, me, world } = m;
  assert.equal(itemOf('red_shulker_box').stack, 1);
  assert.equal(place(m, 'red_shulker_box', fx + 3, fy - 1), K.RED_SHULKER_BOX);
  const box = chestAt(world, fx + 3, fy - 1);
  box.add('ruby', 5);
  box.add('stone', 200);
  box.slots[10] = { key: 'iron_helm', n: 1, g: { r: 'magic', name: 'Hale Iron helm', stats: { hp: 20 }, ilvl: 5 } };
  // No box in a box.
  const inv = me.world.inv;
  inv.slots[20] = { key: 'shulker_box', n: 1 };
  Inventory.moveBetween(inv, 20, box, 11);
  assert.equal(inv.slots[20]?.key, 'shulker_box', 'a shulker box won\'t take one');
  Inventory.send(inv, 20, box);
  assert.equal(inv.slots[20]?.key, 'shulker_box');
  inv.slots[20] = null;
  // Broken: one thing on the ground, with all of it in it.
  breakBlock(m.game, fx + 3, fy - 1, me);
  const d = world.drops.find(x => x.key === 'red_shulker_box');
  assert.ok(d?.g?.box?.length === 3, `whole (${JSON.stringify(d?.g)})`);
  assert.ok(!world.drops.some(x => x.key === 'ruby'), 'nothing spilt');
  run(m.game, 200);
  const sl = inv.slots.find(s => s?.key === 'red_shulker_box');
  assert.ok(sl?.g?.box, 'picked up, with its things');
  const det = itemDetails(itemOf(sl.key), 1, sl.g);
  assert.match(det.name, /Red shulker box \(206 things\)/);
  assert.ok(det.lines.some(l => /5 × Ruby/.test(l)) && det.lines.some(l => /Hale Iron helm/.test(l)), det.lines.join(' / '));
  // Kept as it is.
  const back = Inventory.from(JSON.parse(JSON.stringify(inv.toJSON())));
  assert.equal(back.slots.find(s => s?.key === 'red_shulker_box').g.box.length, 3);
  // Put down again: all there.
  const i = inv.slots.indexOf(sl);
  inv.slots[i] = null;
  assert.equal(place(m, 'red_shulker_box', fx - 4, fy - 1, sl.g), K.RED_SHULKER_BOX);
  const again = chestAt(world, fx - 4, fy - 1);
  assert.equal(again.count('ruby'), 5);
  assert.equal(again.count('stone'), 200);
  assert.ok(again.slots.some(s => s?.g?.name === 'Hale Iron helm'));
  assert.ok(!inv.slots.some(s => s?.key === 'red_shulker_box'), 'out of your hands');
  // An empty one: just a box.
  breakBlock(m.game, fx - 4, fy - 1, me);
  const empty = place(m, 'blue_shulker_box', fx - 4, fy - 1);
  assert.equal(empty, K.BLUE_SHULKER_BOX);
  breakBlock(m.game, fx - 4, fy - 1, me);
  assert.equal(world.drops.find(x => x.key === 'blue_shulker_box')?.g ?? null, null);
});

test('waystones: named for where they are; each lists the others; you go to the one you pick (not too often)', () => {
  const m = start(), { fx, fy, me, world } = m;
  assert.equal(place(m, 'waystone', fx + 2, fy - 1), K.WAYSTONE);
  // Another, far off (built there).
  const far = fx + 400, fy2 = world.gen.surfaceAt(far) - 1;
  for (let x = far - 2; x <= far + 2; x++) { world.setTile(x, fy2 + 1, K.STONE); for (let y = fy2 - 4; y <= fy2; y++) world.setTile(x, y, K.AIR); }
  world.setTile(far, fy2, K.WAYSTONE);
  // (One there without a record, as from before: given one when it's looked at.)
  assert.match(waystoneAt(world, far, fy2).name, /waystone/);
  const menu = waystoneMenu(m.game, me, fx + 2, fy - 1);
  assert.match(menu.name, /waystone/);
  assert.equal(menu.options.length, 1, 'the other one');
  assert.match(menu.options[0].label, /398 east/);
  rightClick(m, fx + 2, fy - 1);
  assert.equal(me.world.wayMenu?.id, `${fx + 2},${fy - 1}`, 'right clicked: the list');
  me.world.wayMenu = null;
  const said = warp(m.game, me, menu.id, menu.options[0].op);
  assert.match(said, /You step through/);
  assert.ok(Math.abs(me.x - (far * TILE + 8)) < 2, 'there');
  run(m.game, 10);
  const back = waystoneMenu(m.game, me, far, fy2);
  assert.match(warp(m.game, me, back.id, back.options[0].op), /gathering itself/, 'not straight back');
  me.world.warpAt -= WARP_COOL;
  assert.match(warp(m.game, me, back.id, back.options[0].op), /You step through/);
  // Kept; broken, forgotten.
  const copy = { tile: (x, y) => world.tile(x, y) };
  waystonesFromSave(copy, JSON.parse(JSON.stringify(waystonesToSave(world))));
  assert.equal(copy.waystones.size, 2);
  breakBlock(m.game, fx + 2, fy - 1, me);
  assert.equal(waystoneMenu(m.game, me, far, fy2).options.length, 0, 'gone from the list');
});

test('recall scrolls: read, and keeping still a moment, you\'re home; moving spoils it', () => {
  const m = start(), { fx, fy, me, world } = m;
  place(m, 'bed', fx - 3, fy - 1);
  rightClick(m, fx - 3, fy - 1);
  assert.equal(me.world.home?.tx, fx - 3);
  me.body.x += 200;
  run(m.game, 30);
  const inv = me.world.inv;
  inv.slots[8] = { key: 'recall_scroll', n: 2 };
  inv.version++;
  m.ctl.script = { move: 0, switchTo: '#8' };
  run(m.game, 2);
  m.ctl.script = { move: 0, fire: true, firePressed: true };
  run(m.game, 1);
  m.ctl.script = { move: 0 };
  assert.ok(me.world.recall, 'reading');
  run(m.game, RECALL_TICKS + 5);
  assert.ok(Math.abs(me.x - ((fx - 3) * TILE + 8)) < 24, 'home at the bed');
  assert.equal(inv.count('recall_scroll'), 1, 'one used');
  // Moving: spoilt, and none used.
  m.ctl.script = { move: 0, fire: true, firePressed: true };
  run(m.game, 1);
  m.ctl.script = { move: 1 };
  run(m.game, 40);
  m.ctl.script = { move: 0 };
  assert.equal(me.world.recall, null);
  assert.equal(inv.count('recall_scroll'), 1);
});

test('stacking into chests: what\'s in your bag goes into the chests near you that have some already', () => {
  const m = start(), { fx, fy, me, world } = m;
  place(m, 'chest', fx + 3, fy - 1);
  place(m, 'chest', fx - 3, fy - 1);
  chestAt(world, fx + 3, fy - 1).add('ruby', 1);
  chestAt(world, fx - 3, fy - 1).add('copper_bar', 1);
  const inv = me.world.inv;
  for (let i = 10; i < inv.slots.length; i++) inv.slots[i] = null;
  inv.slots[12] = { key: 'ruby', n: 7 };
  inv.slots[13] = { key: 'copper_bar', n: 20 };
  inv.slots[14] = { key: 'emerald', n: 2 };
  assert.match(stackToChests(m.game, me), /Put 27 things away, in 2 chests/);
  assert.equal(chestAt(world, fx + 3, fy - 1).count('ruby'), 8);
  assert.equal(chestAt(world, fx - 3, fy - 1).count('copper_bar'), 21);
  assert.equal(inv.count('emerald'), 2, 'what no chest has stays');
});

test('online: a guest\'s ender chest, a waystone\'s list and journey, and sleeping, all through the host', async () => {
  const { NetHost } = await import('../web/src/net/host.js');
  const { NetClient } = await import('../web/src/net/client.js');
  const { memoryLinks } = await import('../web/src/net/peer.js');
  const { WorldHost, WorldClient } = await import('../web/src/world/worldnet.js');
  const world = new TileWorld({ seed: 4242, name: 'Shared' });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, effects: true, seed: 1, options: { destruction: true } });
  game.online = true;
  game.addSoldier({ name: 'Host', isBot: false }, { input: () => ({ move: 0 }) });
  const sync = new WorldHost(game, {});
  const net = new NetHost({ maxPlayers: 8, botCount: 0, world: sync, matchInfo: () => ({ mode: 'world', mapName: world.name, speed: DEFAULT_SPEED, options: game.options, world: sync.info() }), addBot: () => {} });
  net.setGame(game);
  let now = 0;
  const queue = [], schedule = (fn, ms) => queue.push({ fn, at: now + ms });
  const [h, c] = memoryLinks({ latency: 20, schedule });
  const seen = { social: null, chest: null };
  const wc = new WorldClient({ onSocial: v => { seen.social = v; }, onChest: ch => { seen.chest = ch; } });
  const client = new NetClient({ link: c, controller: { input: () => ({ move: 0 }) }, loadMap: async () => null, clock: () => now, world: wc });
  net.addPlayer(h, 'Guest');
  const pump = async () => { for (let k = 0; k < 4; k++) { await new Promise(r => setImmediate(r)); for (const q of queue.filter(q => q.at <= now)) { queue.splice(queue.indexOf(q), 1); q.fn(); } } };
  const step = async (n = 1) => { for (let i = 0; i < n; i++) { game.update(); net.afterTick(); client.tick(); now += 1000 / 60; await pump(); client.updateView(now); } };
  await pump();
  await step(120);
  world.devQuiet = true;
  const guest = game.soldiers.find(s => s.remote);
  const gx = Math.floor(guest.x / TILE), gy = Math.floor((guest.y + 13) / TILE);
  // An ender chest beside them: opened, theirs.
  world.setTile(gx + 1, gy - 1, K.ENDER_CHEST);
  guest.world.ender = new Inventory(30);
  guest.world.ender.add('emerald', 4);
  guest.world.openChest = { tx: gx + 1, ty: gy - 1 };
  await step(10);
  assert.equal(seen.chest?.kind, 'ender', 'their ender chest shown');
  assert.equal(seen.chest.inv.count('emerald'), 4);
  // A waystone's list, and the journey.
  world.setTile(gx - 1, gy - 1, K.WAYSTONE);
  waystoneAt(world, gx - 1, gy - 1);
  const far = gx + 300, fy = world.gen.surfaceAt(far) - 1;
  for (let x = far - 2; x <= far + 2; x++) { world.setTile(x, fy + 1, K.STONE); for (let y = fy - 4; y <= fy; y++) world.setTile(x, y, K.AIR); }
  world.setTile(far, fy, K.WAYSTONE);
  waystoneAt(world, far, fy);
  guest.world.wayMenu = waystoneMenu(game, guest, gx - 1, gy - 1);
  await step(10);
  assert.equal(seen.social?.kind, 'waystone', 'the list, to them');
  c.send({ t: 'wop', op: 'warp', from: seen.social.id, to: seen.social.options[0].op }, true);
  await step(10);
  assert.ok(Math.abs(guest.x - (far * TILE + 8)) < 4, 'there');
  // Asleep: the host keeps them in bed; they see it.
  world.time = DAY_TICKS * 0.62;
  world.setTile(far + 1, fy, K.BED);
  const { useBed } = await import('../web/src/world/sleep.js');
  useBed(game, guest, far + 1, fy);
  await step(10);
  assert.ok(client.me.world.sleep, 'they know they\'re asleep');
  assert.equal(client.me.world.sleep.of, 2, 'one of two');
});
