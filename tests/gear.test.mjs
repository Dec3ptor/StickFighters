// Gear and loot (web/src/world/gear.js): pieces rolled from a seed in five rarities with affixes
// by item level, uniques and sets; worn (health, armour, digging, damage), dropped by monsters
// (named ones always), picked up with its name and rarity, kept, sold, and online. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { NetHost } from '../web/src/net/host.js';
import { NetClient } from '../web/src/net/client.js';
import { memoryLinks } from '../web/src/net/peer.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { TileWorld, TILE } from '../web/src/world/tileworld.js';
import { rollGear, gearStats, armorCut, RARITY, UNIQUES, SETS, BASES, gearValue } from '../web/src/world/gear.js';
import { equip, unequip, playerToSave, worldFromSave, dropItem } from '../web/src/world/worldplay.js';
import { spawnMonster } from '../web/src/world/monsters.js';
import { maxHealthOf, digScale, BASE_HEALTH } from '../web/src/world/progress.js';
import { folkOf } from '../web/src/world/townsfolk.js';
import { sell } from '../web/src/world/trade.js';
import { itemOf, Inventory } from '../web/src/world/items.js';
import { WorldHost, WorldClient } from '../web/src/world/worldnet.js';
import { damage } from '../web/src/combat.js';

function play() {
  const world = new TileWorld({ seed: 777, name: 'Loot', towns: true });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const me = game.addSoldier({ name: 'Looter', isBot: false }, { input: () => ({ move: 0 }) });
  for (let i = 0; i < 300 && !me.alive; i++) game.update();
  world.devQuiet = true;
  return { world, game, me };
}
const run = (game, n) => { for (let i = 0; i < n; i++) game.update(); };

test('gear is rolled from a seed: five rarities, affixes by item level, uniques and sets as they are', () => {
  const count = {};
  for (let i = 0; i < 5000; i++) {
    const p = rollGear(i * 7919 + 1, 12, 0);
    assert.deepEqual(rollGear(i * 7919 + 1, 12, 0), p, 'the same from the same seed');
    assert.ok(BASES[p.key] && itemOf(p.key)?.kind === 'gear', `a base (${p.key})`);
    count[p.g.r] = (count[p.g.r] || 0) + 1;
    if (p.g.r === 'normal') assert.deepEqual(p.g.stats, {}, 'normal: nothing more');
    if (p.g.r === 'magic') assert.ok(Object.keys(p.g.stats).length >= 1 && Object.keys(p.g.stats).length <= 2, 'magic: one or two');
    if (p.g.r === 'rare') assert.ok(Object.keys(p.g.stats).length >= 3, 'rare: three or more');
    if (p.g.r === 'unique') assert.equal(p.g.name, UNIQUES[p.g.unique].name);
    if (p.g.r === 'set') assert.equal(p.g.name, SETS[p.g.set].pieces[p.key]);
  }
  assert.ok(count.normal > count.magic && count.magic > count.rare && count.rare > count.unique, `rarer as they get better (${JSON.stringify(count)})`);
  // Higher item levels: bigger numbers.
  const avg = ilvl => { let t = 0, n = 0; for (let i = 0; i < 2000; i++) { const p = rollGear(i * 31 + 5, ilvl, 0, 'rare'); for (const v of Object.values(p.g.stats)) { t += v; n++; } } return t / n; };
  assert.ok(avg(25) > avg(2) * 1.6, 'deeper, better');
  // Magic find: better rarities more often.
  const better = mf => { let n = 0; for (let i = 0; i < 3000; i++) if (rollGear(i * 13 + 7, 10, mf).g.r !== 'normal') n++; return n; };
  assert.ok(better(200) > better(0) * 1.3, 'magic find works');
  for (const r of Object.keys(RARITY)) assert.match(RARITY[r].color, /^#[0-9a-f]{6}$/i);
});

test('wearing gear: health, armour (less damage taken), digging; rings on both hands; a set\'s bonus; taking it off', () => {
  const m = play(), inv = m.me.world.inv;
  inv.addGear('iron_helm', { r: 'magic', name: 'Hale Iron helm', stats: { hp: 30 }, ilvl: 8 });
  inv.addGear('copper_ring', { r: 'magic', name: "Miner's Copper ring", stats: { dig: 20 }, ilvl: 3 });
  inv.addGear('copper_ring', { r: 'magic', name: "Miner's Copper ring", stats: { dig: 10 }, ilvl: 3 });
  const at = key => inv.slots.findIndex(s => s?.key === key);
  assert.match(equip(m.game, m.me, at('iron_helm')), /Wearing Hale Iron helm/);
  equip(m.game, m.me, at('copper_ring'));
  equip(m.game, m.me, at('copper_ring'));
  assert.ok(m.me.world.gear.ring1 && m.me.world.gear.ring2, 'a ring on each hand');
  assert.equal(m.me.maxHealth, BASE_HEALTH + 30, 'more health');
  assert.equal(maxHealthOf(m.me), BASE_HEALTH + 30);
  assert.ok(Math.abs(digScale(m.me) - 1.3) < 1e-9, 'digging faster');
  const st = gearStats(m.me);
  assert.equal(st.armor, BASES.iron_helm.armor, 'the helm\'s armour');
  // Armour: less damage from a zombie's hit.
  const z = spawnMonster(m.game, 'zombie', m.me.x + 40, m.me.y - 6);
  run(m.game, 2);
  m.me.spawnProtect = 0;
  m.me.health = 100;
  damage(m.game, m.me, 20, z, 'Claws');
  assert.ok(Math.abs(100 - m.me.health - 20 * (1 - armorCut(st.armor))) < 1e-6, `armour took some of it (${(100 - m.me.health).toFixed(2)} of 20)`);
  // A set's bonus, the more of it worn.
  inv.addGear('leather_cap', { r: 'set', name: "Deepdelver's Cap", stats: { dig: 15 }, ilvl: 4, set: 'delver' });
  inv.addGear('leather_armor', { r: 'set', name: "Deepdelver's Jerkin", stats: { armor: 6, hp: 10 }, ilvl: 4, set: 'delver' });
  equip(m.game, m.me, at('leather_cap'));
  equip(m.game, m.me, at('leather_armor'));
  assert.equal(gearStats(m.me).dig, 20 + 10 + 15 + 20, 'two of the set: its bonus too');
  // Off again.
  assert.match(unequip(m.game, m.me, 'body'), /Took off/);
  assert.equal(m.me.world.gear.body, null);
  assert.ok(inv.slots.some(s => s?.g?.name === "Deepdelver's Jerkin"), 'back in the bag, as it was');
});

test('loot: a named monster always drops gear; picked up with its name and rarity; kept; sold to a shop', () => {
  const m = play();
  const champ = spawnMonster(m.game, 'brute', m.me.x + 50, m.me.y - 8);
  champ.npc.champion = 'test#0';
  run(m.game, 3);
  champ.spawnProtect = 0;
  damage(m.game, champ, 1e9, m.me, 'M4');
  const loot = m.world.drops.filter(d => d.g);
  assert.ok(loot.length >= 1, 'gear on the ground');
  assert.ok(['magic', 'rare', 'set', 'unique'].includes(loot[0].g.r), `good gear from a named monster (${loot[0].g.r})`);
  run(m.game, 240);
  const got = m.me.world.got.find(g => g.r);
  assert.ok(got && got.name === loot[0].g.name, 'picked up: its name in the loot feed');
  const slot = m.me.world.inv.slots.find(s => s?.g?.name === loot[0].g.name);
  assert.ok(slot, 'in the bag, with what it is');
  // Kept.
  equip(m.game, m.me, m.me.world.inv.slots.indexOf(slot));
  const back = worldFromSave(JSON.parse(JSON.stringify(playerToSave(m.me, m.game))));
  const worn = Object.values(back.gear).find(Boolean);
  assert.equal(worn?.g.name, loot[0].g.name, 'worn, kept');
  // Sold: by what it is.
  m.me.world.inv.addGear('plate', { r: 'rare', name: 'Grim Shroud', stats: { hp: 40, armor: 10 }, ilvl: 20 });
  const i = m.me.world.inv.slots.findIndex(s => s?.g?.name === 'Grim Shroud');
  const t = m.world.gen.townIn(m.world.gen.spawnRegion), merchant = folkOf(777, t).find(f => f.role === 'merchant');
  const coins = m.me.world.inv.count('coins');
  assert.match(sell(m.world, m.me, merchant, i, true), /Sold Grim Shroud/);
  assert.ok(m.me.world.inv.count('coins') - coins >= Math.floor(gearValue('plate', { r: 'rare', ilvl: 20 }) * 0.35), 'for what a rare plate armour is worth');
});

test('online: gear on the ground shows its rarity; what\'s worn, and wearing it, through the host', async () => {
  const world = new TileWorld({ seed: 777, name: 'Shared', towns: true });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, effects: true, seed: 1, options: { destruction: true } });
  game.online = true;
  game.addSoldier({ name: 'Host', isBot: false }, { input: () => ({ move: 0 }) });
  const sync = new WorldHost(game, {});
  const net = new NetHost({ maxPlayers: 8, botCount: 0, world: sync, matchInfo: () => ({ mode: 'world', mapName: world.name, speed: DEFAULT_SPEED, options: game.options, world: sync.info() }), addBot: () => {} });
  net.setGame(game);
  let now = 0;
  const queue = [];
  const schedule = (fn, ms) => queue.push({ fn, at: now + ms });
  const [h, c] = memoryLinks({ latency: 20, schedule });
  const client = new NetClient({ link: c, controller: { input: () => ({ move: 0 }) }, loadMap: async () => null, clock: () => now, world: new WorldClient({}) });
  net.addPlayer(h, 'Guest');
  const pump = async () => {
    for (let k = 0; k < 4; k++) {
      await new Promise(r => setImmediate(r));
      const due = queue.filter(q => q.at <= now);
      for (const q of due) { queue.splice(queue.indexOf(q), 1); q.fn(); }
    }
  };
  const step = async (n = 1) => { for (let i = 0; i < n; i++) { game.update(); net.afterTick(); client.tick(); now += 1000 / 60; await pump(); client.updateView(now); } };
  await pump();
  await step(120);
  world.devQuiet = true;
  const guest = game.soldiers.find(s => s.remote);
  dropItem(game, 'amulet', 1, guest.x + 200, guest.y - 30, 0, 0, 99999, { r: 'unique', name: 'Eye of the Deep', stats: { xp: 20 }, ilvl: 10, unique: 'eye_deep' });
  await step(20);
  const seen = client.game.world.drops.find(d => d.key === 'amulet');
  assert.equal(seen?.r, 'unique', 'its rarity, for its colour');
  guest.world.inv.addGear('chainmail', { r: 'magic', name: 'Sturdy Chainmail', stats: { armor: 5 }, ilvl: 6 });
  await step(6);
  c.send({ t: 'wop', op: 'equip', i: guest.world.inv.slots.findIndex(s => s?.key === 'chainmail') }, true);
  await step(10);
  assert.equal(guest.world.gear.body?.g.name, 'Sturdy Chainmail', 'worn, on the host');
  assert.equal(client.me.world.gear.body?.g.name, 'Sturdy Chainmail', 'and they see it');
  assert.ok(client.me.world.inv.slots.every(s => s?.key !== 'chainmail'), 'out of their bag');
  assert.ok(Inventory.from(guest.world.inv.toJSON()).slots.length > 0);
});
