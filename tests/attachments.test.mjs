// Weapon attachments (web/src/world/attachments.js): sights and scopes, muzzles, grips and
// lasers, magazines and rounds; which guns each fits; fitted in the inventory (one in each
// place; a new one swaps the old off) and taken off again; what each does to the gun in hand;
// kept in saves and online; and a scope's far view, its chunks made ready out there.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { TileWorld } from '../web/src/world/tileworld.js';
import { ATTACHMENTS, fits, fitsWhy, gunStats, scopeOf, cleanAtt } from '../web/src/world/attachments.js';
import { RECIPES } from '../web/src/world/crafting.js';
import { itemOf, Inventory } from '../web/src/world/items.js';
import { worldFromSave, playerToSave, fitAttachment, stripGun, hold } from '../web/src/world/worldplay.js';
import { weaponFor } from '../web/src/classes.js';
import { WEAPONS } from '../web/src/weapons.js';
import { fire } from '../web/src/combat.js';

function play(opts = {}) {
  const world = new TileWorld({ seed: 4242, name: 'Guns', gen: 3 });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true, ...opts }, effects: false, seed: 1 });
  const me = game.addSoldier({ name: 'Gunner', isBot: false }, { input: () => ({ move: 0 }) });
  for (let i = 0; i < 300 && !me.alive; i++) game.update();
  me.world.inv = new Inventory();
  return { world, game, me };
}
const slotOf = (me, key) => me.world.inv.slots.findIndex(s => s?.key === key);

test('every attachment is an item, made at a gunsmith\'s bench, and goes where it fits', () => {
  for (const [key, a] of Object.entries(ATTACHMENTS)) {
    assert.equal(itemOf(key)?.kind, 'attachment', `${key} is an item`);
    assert.equal(RECIPES.find(r => r.key === key)?.at, 'gunsmith', `${key} is made at a gunsmith's bench`);
    assert.ok(a.slot && a.name, key);
  }
  assert.ok(fits('hawkeye', 'SR') && fits('scope4', 'M4') && fits('suppressor', 'AK47') && fits('hollow_points', 'M4'));
  assert.ok(!fits('scope4', 'Knife'), 'not on a knife');
  assert.ok(!fits('suppressor', 'Bazooka'), 'no suppressor on a rocket launcher');
  assert.ok(fits('ext_mag', 'Platinum') && !fits('ext_mag', 'M4'), 'magazines only where there is one');
  assert.match(fitsWhy('ext_mag', 'M4'), /no magazine/);
  assert.deepEqual(cleanAtt({ sight: 'hawkeye', muzzle: 'scope2', under: 'nonsense', mag: 7 }), { sight: 'hawkeye' }, 'only real ones, each in its place');
});

test('fitted in the inventory (one in each place, a new one swapping the old off), and taken off again', () => {
  const { game, me } = play();
  const inv = me.world.inv;
  inv.add('SR', 1); inv.add('scope4', 1); inv.add('hawkeye', 1); inv.add('suppressor', 2);
  const gun = () => inv.slots[slotOf(me, 'SR')];
  assert.match(fitAttachment(game, me, slotOf(me, 'scope4'), slotOf(me, 'SR')), /4× scope fitted/);
  assert.equal(gun().g.att.sight, 'scope4');
  assert.equal(inv.count('scope4'), 0, 'used');
  assert.match(fitAttachment(game, me, slotOf(me, 'hawkeye'), slotOf(me, 'SR')), /came off/);
  assert.equal(gun().g.att.sight, 'hawkeye', 'the better one on');
  assert.equal(inv.count('scope4'), 1, 'the other back in the bag');
  fitAttachment(game, me, slotOf(me, 'suppressor'), slotOf(me, 'SR'));
  assert.deepEqual(gun().g.att, { sight: 'hawkeye', muzzle: 'suppressor' });
  assert.equal(inv.count('suppressor'), 1, 'one of two used');
  inv.add('Knife', 1);
  assert.match(fitAttachment(game, me, slotOf(me, 'suppressor'), slotOf(me, 'Knife')), /won't go on/);
  assert.equal(inv.count('suppressor'), 1, 'nothing used');
  // Off again: all of them, and the gun's plain again.
  assert.match(stripGun(game, me, slotOf(me, 'SR')), /hawkeye scope, suppressor/);
  assert.equal(gun().g, undefined, 'a plain gun again');
  assert.equal(inv.count('hawkeye') + inv.count('suppressor'), 3, 'all back');
});

test('what they do to the gun in hand: further, quieter, steadier, harder hitting, a bigger magazine; a scope to see far', () => {
  const { game, me } = play({ botVision: 'sight' });
  const inv = me.world.inv;
  const holding = (key, att) => {
    inv.slots.fill(null);
    inv.slots[0] = { key, n: 1, g: { r: 'basic', name: WEAPONS[key].name, stats: {}, ilvl: 1, att } };
    inv.add('bullets', 500);
    me.world.slot = 0;
    hold(me);
    return weaponFor(me, key);
  };
  const sr = holding('SR', { sight: 'hawkeye', muzzle: 'suppressor' });
  assert.ok(sr.range >= 500 * 16, `reaches as far as the scope sees (${sr.range})`);
  assert.ok(sr.quiet, 'quiet');
  assert.ok(Math.abs(sr.damage - WEAPONS.SR.damage * 0.95) < 1e-9, 'a little less damage');
  assert.deepEqual(scopeOf(inv.slots[0]), ATTACHMENTS.hawkeye.scope, 'its scope');
  const m4 = holding('M4', { muzzle: 'compensator', under: 'laser', mag: 'hollow_points' });
  assert.ok(m4.spread < WEAPONS.M4.spread * 0.7, 'steadier');
  assert.ok(m4.laser, 'a laser');
  assert.ok(Math.abs(m4.damage - WEAPONS.M4.damage * 1.15) < 1e-9, 'harder hitting');
  const lb = holding('AK47', { muzzle: 'long_barrel' });
  assert.ok(Math.abs(lb.range - WEAPONS.AK47.range * 1.5) < 1e-9, 'a long barrel: further');
  const pistol = holding('Platinum', { mag: 'ext_mag' });
  assert.equal(pistol.mag, Math.round(WEAPONS.Platinum.mag * 1.5), 'a bigger magazine');
  assert.equal(gunStats({ key: 'M4', n: 1 }), null, 'a plain gun: nothing');
  // Quieter: heard from a quarter as far.
  me.spawnProtect = 0;
  holding('SR', null);
  me.cooldown = 0;
  fire(game, me, { aim: 0 });
  const loud = game.noises.at(-1).r;
  holding('SR', { muzzle: 'suppressor' });
  me.cooldown = 0;
  fire(game, me, { aim: 0 });
  assert.equal(game.noises.at(-1).r, loud / 4, 'suppressed');
});

test('kept in saves', () => {
  const { game, me } = play();
  me.world.inv.slots[3] = { key: 'SR', n: 1, g: { r: 'rare', name: 'Doom Song', stats: { wdmg: 20 }, ilvl: 12, att: { sight: 'scope8', under: 'foregrip' } } };
  const back = worldFromSave(JSON.parse(JSON.stringify(playerToSave(me, game))));
  assert.deepEqual(back.inv.slots[3].g.att, { sight: 'scope8', under: 'foregrip' });
  assert.equal(back.inv.slots[3].g.stats.wdmg, 20, 'its own affixes too');
});

test('a scope\'s far view: the chunks out there made ready, as round a player', () => {
  const { game, world, me } = play();
  const far = { x: me.x + 400 * 16, y: me.y };
  const cx = Math.floor(far.x / 512), cy = Math.floor(far.y / 512);
  assert.equal(world.has(cx, cy), false, 'not made yet');
  world.lookAt = far;
  for (let i = 0; i < 200 && !world.has(cx, cy); i++) game.update();
  assert.ok(world.has(cx, cy), 'made, where the scope looks');
});

test('online: fitting and taking off, done by the host', async () => {
  const { NetHost } = await import('../web/src/net/host.js');
  const { NetClient } = await import('../web/src/net/client.js');
  const { memoryLinks } = await import('../web/src/net/peer.js');
  const { WorldHost, WorldClient } = await import('../web/src/world/worldnet.js');
  const world = new TileWorld({ seed: 4242, name: 'Guns online', gen: 3 });
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
  const guest = game.soldiers.find(s => s.remote), inv = guest.world.inv;
  inv.slots.fill(null);
  inv.slots[12] = { key: 'M4', n: 1 };
  inv.slots[13] = { key: 'scope2', n: 1 };
  inv.version++;
  await step(10);
  c.send({ t: 'wop', op: 'attach', a: 13, b: 12 }, true);
  await step(10);
  assert.equal(inv.slots[12].g?.att?.sight, 'scope2', 'fitted, on the host');
  assert.equal(client.me.world.inv.slots[12].g?.att?.sight, 'scope2', 'and they see it');
  c.send({ t: 'wop', op: 'detach', i: 12 }, true);
  await step(10);
  assert.equal(inv.slots[12].g, undefined, 'off again');
  assert.equal(inv.count('scope2'), 1, 'back in the bag');
});
