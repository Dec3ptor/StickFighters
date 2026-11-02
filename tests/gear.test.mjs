// Gear and loot (web/src/world/gear.js): pieces rolled from a seed in seven rarities (basic,
// magic, rare, epic, legendary, set, unique) with affixes by item level, and weapons with affixes
// of their own; worn (health, armour, digging, damage), dropped by monsters (named ones always),
// picked up with its name and rarity, kept, sold, bought, given for quests and raids, left in a
// grave when you die; the codex of everything there is. And online. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { NetHost } from '../web/src/net/host.js';
import { NetClient } from '../web/src/net/client.js';
import { memoryLinks } from '../web/src/net/peer.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { TileWorld, TILE } from '../web/src/world/tileworld.js';
import { rollGear, gearStats, armorCut, RARITY, RARITIES, UNIQUES, SETS, BASES, gearValue, weaponWith, DROP_WEAPONS, countItems, rarityOf } from '../web/src/world/gear.js';
import { equip, unequip, playerToSave, worldFromSave, dropItem, hold, openGrave, graveAt, gravesToSave, gravesFromSave, GRAVE_KEEP } from '../web/src/world/worldplay.js';
import { WEAPONS } from '../web/src/weapons.js';
import { weaponFor } from '../web/src/classes.js';
import { stockOf, buy } from '../web/src/world/trade.js';
import { makeQuest, acceptQuest, turnIn, questsOf } from '../web/src/world/quests.js';
import { codexEntries, cleanFound } from '../web/src/world/codex.js';
import * as K from '../web/src/world/blocks.js';
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

test('gear is rolled from a seed: seven rarities, affixes by item level, uniques and sets as they are', () => {
  const count = {};
  for (let i = 0; i < 5000; i++) {
    const p = rollGear(i * 7919 + 1, 12, 0);
    assert.deepEqual(rollGear(i * 7919 + 1, 12, 0), p, 'the same from the same seed');
    assert.ok(BASES[p.key] && itemOf(p.key)?.kind === 'gear', `a base (${p.key})`);
    count[p.g.r] = (count[p.g.r] || 0) + 1;
    assert.ok(RARITIES.includes(p.g.r), `a rarity there is (${p.g.r})`);
    if (p.g.r === 'basic') assert.deepEqual(p.g.stats, {}, 'basic: nothing more');
    if (p.g.r === 'magic') assert.ok(Object.keys(p.g.stats).length >= 1 && Object.keys(p.g.stats).length <= 2, 'magic: one or two');
    if (p.g.r === 'rare') assert.ok(Object.keys(p.g.stats).length >= 3, 'rare: three or more');
    if (p.g.r === 'epic') assert.ok(Object.keys(p.g.stats).length >= 4, 'epic: four or more');
    if (p.g.r === 'legendary') assert.ok(Object.keys(p.g.stats).length >= 5 && / of /.test(p.g.name), `legendary: five or more, and a title (${p.g.name})`);
    if (p.g.r === 'unique') assert.equal(p.g.name, UNIQUES[p.g.unique].name);
    if (p.g.r === 'set') assert.equal(p.g.name, SETS[p.g.set].pieces[p.key]);
  }
  assert.ok(count.basic > count.magic && count.magic > count.rare && count.rare > count.epic && count.epic > count.legendary && count.legendary > count.unique, `rarer as they get better (${JSON.stringify(count)})`);
  // Higher item levels: bigger numbers.
  const avg = ilvl => { let t = 0, n = 0; for (let i = 0; i < 2000; i++) { const p = rollGear(i * 31 + 5, ilvl, 0, 'rare'); for (const v of Object.values(p.g.stats)) { t += v; n++; } } return t / n; };
  assert.ok(avg(25) > avg(2) * 1.6, 'deeper, better');
  // Magic find: better rarities more often.
  const better = mf => { let n = 0; for (let i = 0; i < 3000; i++) if (rollGear(i * 13 + 7, 10, mf).g.r !== 'basic') n++; return n; };
  assert.ok(better(200) > better(0) * 1.3, 'magic find works');
  for (const r of Object.keys(RARITY)) assert.match(RARITY[r].color, /^#[0-9a-f]{6}$/i);
  // A kind asked for (a shop's, a quest's): that kind.
  for (const kind of ['head', 'body', 'hands', 'waist', 'feet', 'ring', 'amulet']) {
    for (let i = 0; i < 60; i++) assert.equal(BASES[rollGear(i * 101 + 9, 20, 300, null, null, false, kind).key].kind, kind);
  }
  // Saves from before epic and legendary things: 'normal' is basic now.
  assert.equal(rarityOf('normal'), 'basic');
  // Hundreds of things: bases, weapons, uniques and set pieces, and a codex of all of it.
  const c = countItems();
  assert.ok(c.bases >= 57 && c.weapons >= 20 && c.uniques >= 50 && c.setPieces >= 40, JSON.stringify(c));
  for (const [id, u] of Object.entries(UNIQUES)) assert.ok(u.weapon ? WEAPONS[u.weapon] : BASES[u.base], `${id}'s base`);
});

test('weapons drop with affixes of their own: held, the gun fires as they say', () => {
  const m = play(), inv = m.me.world.inv;
  let p = null;
  for (let i = 0; p?.key !== 'Beretta' && i < 4000; i++) p = rollGear(i * 37 + 1, 20, 0, 'rare', null, true);
  assert.ok(DROP_WEAPONS.includes(p.key) && p.key === 'Beretta', 'a weapon');
  // (Each affix is one the weapon has the thing for: no magazine size on a gun without a magazine.)
  for (let i = 0; i < 3000; i++) {
    const q = rollGear(i * 53 + 11, 25, 300, null, null, true);
    if (WEAPONS[q.key] && q.g.r !== 'unique') for (const k of Object.keys(q.g.stats)) if (k.startsWith('w')) assert.ok(k === 'wdmg' || WEAPONS[q.key][{ wrof: 'rof', wreload: 'reload', wmag: 'mag', wacc: 'spread' }[k]] > 0, `${q.key}: ${k}`);
  }
  const g = { ...p.g, stats: { wdmg: 50, wrof: 25, wmag: 100, wacc: 50, crit: 10 } };
  const def = weaponWith('Beretta', g.stats), base = WEAPONS.Beretta;
  assert.ok(Math.abs(def.damage - base.damage * 1.5) < 1e-9, 'more damage');
  assert.ok(def.rof < base.rof && def.mag === Math.round(base.mag * 2) && def.spread < base.spread, 'faster, a bigger magazine, more accurate');
  assert.equal(weaponWith('Beretta', g.stats), def, 'made once');
  // In hand: what the game fires is it.
  inv.slots[0] = { key: 'Beretta', n: 1, g };
  inv.version++;
  m.me.world.slot = 0;
  hold(m.me);
  assert.equal(weaponFor(m.me, 'Beretta').damage, def.damage, 'the gun in hand is the rolled one');
  assert.equal(m.me.weapons.Beretta.mag <= def.mag, true, 'its own magazine');
  assert.equal(gearStats(m.me).crit, 10, 'its crits count while it\'s held');
  inv.slots[0] = { key: 'Beretta', n: 1 };
  inv.version++;
  hold(m.me);
  assert.equal(weaponFor(m.me, 'Beretta').damage, base.damage, 'a plain one: as it always was');
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
  assert.ok(['magic', 'rare', 'epic', 'legendary', 'set', 'unique'].includes(loot[0].g.r), `good gear from a named monster (${loot[0].g.r})`);
  run(m.game, 240);
  const got = m.me.world.got.find(g => g.r);
  assert.ok(got && got.name === loot[0].g.name, 'picked up: its name in the loot feed');
  const slot = m.me.world.inv.slots.find(s => s?.g?.name === loot[0].g.name);
  assert.ok(slot, 'in the bag, with what it is');
  // Kept: worn (a weapon: carried, with its affixes).
  if (itemOf(slot.key).kind === 'gear') equip(m.game, m.me, m.me.world.inv.slots.indexOf(slot));
  const back = worldFromSave(JSON.parse(JSON.stringify(playerToSave(m.me, m.game))));
  const kept = Object.values(back.gear).find(Boolean) || back.inv.slots.find(s => s?.g);
  assert.equal(kept?.g.name, loot[0].g.name, 'kept');
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

test('shops sell gear rolled for the day: bought, it\'s that very piece', () => {
  const m = play(), t = m.world.gen.townIn(m.world.gen.spawnRegion);
  const smith = folkOf(777, t).find(f => f.role === 'smith') || folkOf(777, t).find(f => f.role === 'merchant');
  const stock = stockOf(m.world, smith, false), gear = stock.filter(o => o.g);
  assert.ok(gear.length >= 1, 'gear for sale');
  for (const o of gear) assert.ok(['basic', 'magic', 'rare', 'epic'].includes(o.g.r) && o.price > 0, `never the best (${o.g.r})`);
  assert.deepEqual(stockOf(m.world, smith, false).filter(o => o.g).map(o => o.g.name), gear.map(o => o.g.name), 'the same all day');
  const o = gear[0];
  m.me.world.inv.add('coins', o.price + 5);
  assert.match(buy(m.world, m.me, smith, o.key, false, o.slot), /^Bought/);
  assert.ok(m.me.world.inv.slots.some(s => s?.g?.name === o.g.name), 'that very piece');
  assert.equal(stockOf(m.world, smith, false).find(x => x.slot === o.slot).left, 0, 'sold');
  assert.doesNotMatch(buy(m.world, m.me, smith, o.key, false, o.slot) || '', /^Bought/, 'only the once');
});

test('quests give gear: rolled when it\'s handed in, the same for the same quest and player', () => {
  const m = play(), t = m.world.gen.townIn(m.world.gen.spawnRegion), f = folkOf(777, t).find(x => x.role === 'guard') || folkOf(777, t)[0];
  let q = null;
  for (let period = 0; period < 40 && !q?.reward?.gear; period++) q = makeQuest(m.world, f, t, period, 0, 5, 'deliver') || q;
  assert.ok(q?.reward?.gear, 'one with gear in its reward');
  assert.equal(acceptQuest(m.game, m.me, q).startsWith('Quest'), true);
  const mine = questsOf(m.me).list.find(x => x.id === q.id);
  for (const g of mine.goals) g.done = true;
  const before = m.me.world.inv.slots.filter(s => s?.g).length;
  const said = turnIn(m.game, m.me, q.id);
  const piece = m.me.world.inv.slots.filter(s => s?.g).at(-1);
  assert.equal(m.me.world.inv.slots.filter(s => s?.g).length, before + 1, 'a piece of gear');
  assert.equal(piece.g.r, q.reward.gear.r, 'as rare as it said');
  assert.ok(said.includes(piece.g.name), 'named when it\'s handed in');
});

test('dying: what you lose goes in a grave where you died; your grave is yours to open; kept in saves', () => {
  for (const rule of ['bag', 'coins', 'all']) {
    const m = play(), inv = m.me.world.inv;
    m.world.death = rule;
    inv.add('coins', 100);
    inv.add('ruby', 3);
    inv.add('letter', 1);
    inv.addGear('iron_helm', { r: 'magic', name: 'Hale Iron helm', stats: { hp: 20 }, ilvl: 5 });
    equip(m.game, m.me, inv.slots.findIndex(s => s?.key === 'iron_helm'));
    const hotbar = inv.slots.slice(0, 10).filter(Boolean).length, all = inv.slots.filter(Boolean).length;
    m.me.spawnProtect = 0;
    damage(m.game, m.me, 1e9, null, 'Fall');
    assert.equal(m.me.alive, false);
    const [tx, ty] = m.me.world.graves.at(-1);
    assert.equal(m.world.tile(tx, ty), K.GRAVE, `${rule}: a grave`);
    const gr = graveAt(m.world, tx, ty);
    assert.equal(inv.count('letter'), 1, `${rule}: what's carried for a quest is kept`);
    if (rule === 'coins') {
      assert.equal(inv.count('coins'), 50, 'half the coins kept');
      assert.equal(inv.slots.filter(Boolean).length, all, 'everything else kept');
    }
    if (rule === 'bag') {
      assert.equal(inv.count('coins'), 50, 'half the coins kept');
      assert.equal(inv.slots.slice(0, 10).filter(Boolean).length, hotbar, 'the hotbar kept');
      assert.equal(inv.count('ruby'), 0, 'the bag in the grave');
      assert.ok(m.me.world.gear.head, 'what\'s worn kept');
    }
    if (rule === 'all') {
      assert.equal(inv.count('coins'), 0, 'every coin');
      assert.ok(inv.slots.every(s => !s || s.key === 'letter'), 'everything');
      assert.equal(m.me.world.gear.head, null, 'what was worn too');
      assert.ok(gr.worn.head, 'in the grave');
    }
    // Kept with the world.
    const copy = { tile: (x, y) => m.world.tile(x, y) };
    gravesFromSave(copy, JSON.parse(JSON.stringify(gravesToSave(m.world))));
    assert.equal(copy.graves.size, 1);
    // Somebody else: not yet.
    const other = m.game.addSoldier({ name: 'Robber', isBot: false }, { input: () => ({ move: 0 }) });
    run(m.game, 200);
    assert.ok(openGrave(m.game, other, tx, ty));
    assert.equal(m.world.tile(tx, ty), K.GRAVE, 'only its owner, for a while');
    // Its owner: all of it back.
    run(m.game, 300);
    assert.equal(m.me.alive, true, 'back');
    openGrave(m.game, m.me, tx, ty);
    assert.equal(m.world.tile(tx, ty), K.AIR, `${rule}: emptied, it goes`);
    assert.equal(inv.count('coins'), 100, 'every coin back');
    assert.equal(inv.count('ruby'), 3, 'the rubies back');
    assert.equal(m.me.world.gear.head?.g.name, 'Hale Iron helm', 'worn again');
    assert.deepEqual(m.me.world.graves, [], 'not on the map any more');
  }
  // After a while, anyone's.
  const m = play();
  m.me.world.inv.add('ruby', 2);
  m.me.spawnProtect = 0;
  damage(m.game, m.me, 1e9, null, 'Fall');
  const [tx, ty] = m.me.world.graves.at(-1);
  graveAt(m.world, tx, ty).at -= GRAVE_KEEP + 1000;
  const other = m.game.addSoldier({ name: 'Robber', isBot: false }, { input: () => ({ move: 0 }) });
  run(m.game, 200);
  openGrave(m.game, other, tx, ty);
  assert.equal(other.world.inv.count('ruby'), 2, 'theirs to take');
});

test('the codex: hundreds of things, how each is had, and what you\'ve found', () => {
  const all = codexEntries();
  assert.ok(all.length >= 300, `${all.length} things`);
  assert.equal(new Set(all.map(e => e.id)).size, all.length, 'each once');
  for (const e of all) assert.ok(e.where && e.where !== 'Found in the world', `how ${e.name} is had (${e.where})`);
  for (const cat of ['gear', 'weapon', 'unique', 'set', 'block', 'material', 'food', 'tool']) assert.ok(all.some(e => e.cat === cat), cat);
  const m = play();
  m.me.world.inv.addGear('copper_ring', { r: 'unique', name: "Miner's Luck", stats: { coin: 30 }, ilvl: 3, unique: 'miners_luck' });
  run(m.game, 30);
  assert.ok(m.me.world.found.includes('u:miners_luck') && m.me.world.found.includes('copper_ring') && m.me.world.found.includes('pickaxe'), 'found: what\'s in your hands');
  const back = worldFromSave(JSON.parse(JSON.stringify(playerToSave(m.me, m.game))));
  assert.ok(back.found.includes('u:miners_luck'), 'kept');
  assert.deepEqual(cleanFound(['u:miners_luck', 'nonsense', 42, 'u:miners_luck']), ['u:miners_luck'], 'only what there is');
});
