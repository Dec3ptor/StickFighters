// Townsfolk (world mode): the people of each town (who they are comes from the seed), coming and
// going as players come near, going about the town and keeping to where they can walk; nobody
// hurts them (but monsters hurt guards, and guards shoot monsters); talking to them with a right
// click, trading (stock by the day, never a profit to be made buying and selling), healing and
// resting, food that heals, and all of it online through the host. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { NetHost } from '../web/src/net/host.js';
import { NetClient } from '../web/src/net/client.js';
import { memoryLinks } from '../web/src/net/peer.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { TileWorld, TILE } from '../web/src/world/tileworld.js';
import { WorldGen } from '../web/src/world/worldgen.js';
import { folkOf, isFolk, walkSpan, ROLES } from '../web/src/world/townsfolk.js';
import { talkView, talkDo, startTalk } from '../web/src/world/talk.js';
import { SHOPS, stockOf, offerFor, valueOf, bundleOf } from '../web/src/world/trade.js';
import { spawnMonster, DAY_TICKS, hourOf } from '../web/src/world/monsters.js';
import { itemOf, ITEMS } from '../web/src/world/items.js';
import { RECIPES } from '../web/src/world/crafting.js';
import { WorldHost, WorldClient } from '../web/src/world/worldnet.js';
import { canHurt, damage } from '../web/src/combat.js';
import { isSkin, TOWN_SKINS } from '../web/src/skins.js';

const SEED = 777;

/** A world with towns, and a game in it with one player (scripted input). */
function play(seed = SEED) {
  const world = new TileWorld({ seed, name: 'Folk', towns: true });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const ctl = { script: { move: 0 }, input() { const s = this.script; this.script = { ...s, firePressed: false, jumpPressed: false, switchTo: null }; return s; } };
  const me = game.addSoldier({ name: 'Walker', isBot: false }, ctl);
  for (let i = 0; i < 300 && !me.alive; i++) game.update();
  return { world, game, me, ctl, town: world.gen.townIn(world.gen.spawnRegion) };
}
const run = (game, n) => { for (let i = 0; i < n; i++) game.update(); };
/** Put soldier s standing at tile column tx, feet in row ty. */
const put = (s, tx, ty) => { s.body.x = tx * TILE + 8; s.body.y = (ty + 1) * TILE - 14; s.body.vx = s.body.vy = 0; };
const mid = t => (t.x0 + t.x1) >> 1;
/** The nearest city east of the start. */
function cityOf(gen) {
  for (let k = gen.spawnRegion + 1; k < gen.spawnRegion + 40; k++) if (gen.townIn(k)?.kind === 'city') return gen.townIn(k);
  return null;
}
/** Into town t's middle, until its people have come. */
function visit(m, t) {
  put(m.me, mid(t), t.level - 1);
  run(m.game, 150);
  return m.game.soldiers.filter(s => isFolk(s) && s.alive);
}
const aimAt = (s, x, y) => ({ aim: Math.atan2(y - s.shoulderY, x - s.shoulderX), aimDist: Math.hypot(x - s.shoulderX, y - s.shoulderY) });

test('the people of a town come from the seed: who lives where, their names, their work', () => {
  const a = new WorldGen(SEED, { towns: true }), b = new WorldGen(SEED, { towns: true });
  let towns = 0, people = 0;
  const roles = new Set();
  for (let k = a.spawnRegion - 12; k <= a.spawnRegion + 12; k++) {
    const t = a.townIn(k);
    if (!t) continue;
    towns++;
    const fa = folkOf(SEED, t), fb = folkOf(SEED, b.townIn(k));
    assert.deepEqual(fa.map(f => [f.key, f.name, f.role, f.at]), fb.map(f => [f.key, f.name, f.role, f.at]), `${t.name}: the same people`);
    assert.equal(new Set(fa.map(f => f.name)).size, fa.length, `${t.name}: everyone has their own name`);
    for (const bd of t.buildings) if (bd.role) assert.ok(fa.some(f => t.buildings[f.bi] === bd), `${t.name}: someone in the ${bd.kind}`);
    for (const f of fa) {
      roles.add(f.role);
      assert.ok(ROLES[f.role] && isSkin(ROLES[f.role].skin), `${f.label}: a role and a look`);
      const bd = t.buildings[f.bi];
      if (bd.kind === 'gate') assert.ok(f.at.x > t.x0 && f.at.x < t.x1 && Math.abs(f.at.x - (bd.x0 + bd.x1) / 2) < 8, `${f.label}: just inside the gate`);
      else assert.ok(f.at.x > bd.x0 && f.at.x < bd.x1 && f.at.y === bd.base - 1, `${f.label}: at home in their ${bd.kind}`);
      assert.ok(f.label.startsWith(f.name) && f.label.length <= 24, `${f.label}: a name tag`);
    }
    if (t.kind === 'city') for (const r of ['lord', 'trader', 'innkeeper', 'healer', 'smith', 'gunsmith', 'guard']) assert.ok(fa.some(f => f.role === r), `${t.name}: a city has a ${r}`);
    people += fa.length;
  }
  assert.ok(towns >= 6 && people >= towns * 5, `towns full of people (${people} in ${towns} towns)`);
  for (let k = a.spawnRegion - 40; k <= a.spawnRegion + 40; k++) { const t = a.townIn(k); if (t) for (const f of folkOf(SEED, t)) roles.add(f.role); }
  assert.equal(roles.size, Object.keys(ROLES).length, `every kind of work done somewhere (${[...roles]})`);
  assert.deepEqual([...TOWN_SKINS].sort(), [...new Set(Object.values(ROLES).map(r => r.skin))].sort(), 'a look for each');
});

test('townsfolk come when a player comes near, go about the town where they can walk, and go when everyone has gone', () => {
  const m = play(), t = m.town;
  const here = visit(m, t);
  const near = folkOf(SEED, t).filter(f => Math.abs(f.at.x - mid(t)) <= 60);
  assert.equal(here.length, near.length, `everyone within reach came (${here.map(s => s.name)})`);
  const start = new Map(here.map(s => [s.npc.key, s.x]));
  run(m.game, 3600);
  let moved = 0;
  for (const s of m.game.soldiers.filter(isFolk)) {
    const tx = s.x / TILE;
    assert.ok(s.alive && s.body.onGround, `${s.name}: standing`);
    assert.ok(tx >= t.x0 && tx <= t.x1 + 1, `${s.name}: in town (${tx.toFixed(1)})`);
    assert.ok(Math.abs(s.y / TILE - (t.level - 1)) < 1.2 || s.y / TILE < t.level - 2, `${s.name}: on the ground or a floor (${(s.y / TILE).toFixed(1)})`);
    if (Math.abs(s.x - start.get(s.npc.key)) > TILE) moved++;
  }
  assert.ok(moved >= 1, 'people get about');
  // Gone when everyone's far away; back as they were when someone comes again.
  put(m.me, t.x1 + 400, m.world.gen.surfaceAt(t.x1 + 400) - 1);
  run(m.game, 120);
  assert.equal(m.game.soldiers.filter(isFolk).length, 0, 'gone');
  const again = visit(m, t);
  assert.deepEqual(again.map(s => s.npc.key).sort(), here.map(s => s.npc.key).sort(), 'the same people come back');
});

test('townsfolk keep to where they can walk: not into the well, not off a porch on stilts', () => {
  const world = new TileWorld({ seed: SEED, towns: true }), g = world.gen;
  let wells = 0;
  for (let k = g.spawnRegion - 10; k <= g.spawnRegion + 10; k++) {
    const t = g.townIn(k);
    if (!t) continue;
    const well = t.buildings.find(b => b.kind === 'well');
    for (const f of folkOf(SEED, t)) {
      const [lo, hi] = walkSpan(world, f.at.x, f.at.y);
      assert.ok(lo <= f.at.x && hi >= f.at.x, `${f.label}: where they are`);
      if (well && f.home.ground) {
        wells++;
        const pit = [well.x0 + 2, well.x0 + 4];
        assert.ok(hi < pit[0] || lo > pit[1], `${f.label} in ${t.name}: not into the well (${lo}..${hi}, the well ${pit})`);
      }
    }
  }
  assert.ok(wells > 5, 'villages with wells looked at');
});

test("nobody hurts townsfolk (shots go through them), but monsters fight guards, and guards shoot monsters", () => {
  const m = play();
  const city = cityOf(m.world.gen);
  assert.ok(city, 'a city to the east');
  // (By one of its guards: at a gate, or the barracks.)
  const gf = folkOf(SEED, city).find(f => f.guard);
  put(m.me, gf.at.x, city.level - 1);
  run(m.game, 150);
  const here = m.game.soldiers.filter(s => isFolk(s) && s.alive);
  const folk = here.find(s => !s.npc.guard), guard = here.find(s => s.npc.key === gf.key);
  assert.ok(folk && guard, `townsfolk and a guard (${here.map(s => s.name)})`);
  assert.ok(!canHurt(m.game, m.me, folk) && !canHurt(m.game, m.me, guard), 'players can\'t hurt them');
  assert.ok(!canHurt(m.game, folk, m.me) && !canHurt(m.game, guard, m.me), 'nor they players');
  const h = folk.health;
  damage(m.game, folk, 60, null, 'Magma');
  assert.equal(folk.health, h, 'nothing hurts townsfolk');
  // A monster in town, out in the street where the guard can see it: the guard goes for it.
  const gx = Math.floor(guard.x / TILE), feet = Math.floor((guard.y + 13) / TILE);
  let zx = null;
  for (let d = 8; d <= 24 && zx == null; d++) {
    for (const dir of [1, -1]) {
      const x = gx + dir * d;
      if (m.world.clearLine(guard.shoulderX, guard.shoulderY, x * TILE + 8, guard.y - 14) && walkSpan(m.world, x, feet, 1)[0] <= x) { zx = x; break; }
    }
  }
  assert.ok(zx != null, 'somewhere in sight of the guard');
  const z = spawnMonster(m.game, 'zombie', zx * TILE + 8, guard.y - 2);
  run(m.game, 2);
  assert.ok(canHurt(m.game, z, guard) && canHurt(m.game, guard, z), 'monsters and guards fight');
  assert.ok(!canHurt(m.game, z, folk), 'monsters leave the rest of the townsfolk alone');
  // (The player out of the way, or the zombie's after them; at night, or a zombie with nobody
  // near goes in the daylight; and no more monsters coming.)
  m.me.body.y -= 60 * TILE;
  m.world.time = DAY_TICKS * 0.75;
  m.world.devQuiet = true;
  m.game.controllers.get(guard).wait = 0;
  let dead = false;
  for (let i = 0; i < 1200 && !dead; i++) { m.game.update(); dead = !z.alive; }
  assert.ok(dead, 'the guard saw the zombie off');
});

test('right click on someone to talk: they stop, face you, and say something; walk off and it ends', () => {
  const m = play(), t = m.town;
  visit(m, t);
  const merchant = m.game.soldiers.find(s => isFolk(s) && s.npc.role === 'merchant');
  assert.ok(merchant, 'the village merchant');
  m.game.controllers.get(merchant).wait = 600;
  put(m.me, Math.floor(merchant.x / TILE) - 3, Math.floor((merchant.y + 13) / TILE));
  run(m.game, 4);
  m.ctl.script = { move: 0, alt: true, ...aimAt(m.me, merchant.x, merchant.y - 6) };
  run(m.game, 2);
  m.ctl.script = { move: 0 };
  assert.equal(m.me.world.talk?.id, merchant.id, 'talking to the merchant');
  const v = talkView(m.game, m.me);
  assert.equal(v.title, 'Merchant');
  assert.equal(v.town, t.name);
  assert.ok(v.said.length > 5 && !v.said.includes('{'), `they say something (${v.said})`);
  assert.deepEqual(v.options.map(o => o.op), ['trade', 'news', 'bye']);
  assert.ok(v.shop?.stock.length >= 5, 'a shop with things in it');
  run(m.game, 30);
  assert.equal(merchant.npc.talkTo, m.me.id, 'they stop to talk');
  assert.ok(merchant.aim > Math.PI / 2, 'facing you (you\'re to the west)');
  // News: the towns either way, and something about what's deep down.
  talkDo(m.game, m.me, { op: 'news' });
  assert.ok(talkView(m.game, m.me).news.some(n => /blocks (east|west) of here/.test(n)), 'news of other towns');
  // Walking off ends it.
  put(m.me, Math.floor(merchant.x / TILE) - 20, Math.floor((merchant.y + 13) / TILE));
  run(m.game, 3);
  assert.equal(m.me.world.talk, null, 'walked off: the talk is over');
});

test('trading: buying a lot for coins, sold out till tomorrow, selling what they deal in, and no profit in buying to sell', () => {
  const m = play(), t = m.town;
  visit(m, t);
  const smith = m.game.soldiers.find(s => isFolk(s) && s.npc.role === 'smith') || m.game.soldiers.find(s => isFolk(s) && s.npc.role === 'merchant');
  put(m.me, Math.floor(smith.x / TILE) - 2, Math.floor((smith.y + 13) / TILE));
  run(m.game, 2);
  assert.ok(startTalk(m.game, m.me, smith));
  const inv = m.me.world.inv;
  const stock = talkView(m.game, m.me).shop.stock, o = stock.find(x => !x.rare);
  talkDo(m.game, m.me, { op: 'buy', key: o.key });
  assert.match(talkView(m.game, m.me).said, /need \d+ coins/, 'no coins, no sale');
  inv.add('coins', 5000);
  const had = inv.count(o.key);
  talkDo(m.game, m.me, { op: 'buy', key: o.key });
  assert.equal(inv.count('coins'), 5000 - o.price, 'paid');
  assert.equal(inv.count(o.key), had + o.n, `got ${o.n} × ${o.key}`);
  for (let i = 0; i < 20; i++) talkDo(m.game, m.me, { op: 'buy', key: o.key });
  const after = talkView(m.game, m.me).shop.stock.find(x => x.key === o.key);
  assert.equal(after.left, 0, 'sold out');
  assert.equal(inv.count(o.key), had + o.n * o.left, `as many as they had (${o.left} lots)`);
  // The same shop, the same day: the same things at the same prices (what's bought, bought).
  const ctl = m.game.controllers.get(smith);
  assert.deepEqual(stockOf(m.world, ctl.f, false).map(x => [x.key, x.price]), stock.map(x => [x.key, x.price]));
  // Tomorrow: new stock.
  m.world.time += DAY_TICKS;
  const tomorrow = stockOf(m.world, ctl.f, false);
  assert.ok(tomorrow.every(x => x.left > 0), 'restocked');
  // Selling: only what they deal in.
  inv.add('stone', 99);
  const coins = inv.count('coins'), si = inv.slots.findIndex(s => s?.key === 'stone');
  talkDo(m.game, m.me, { op: 'sell', i: si, all: true });
  const said = talkView(m.game, m.me).said;
  if (smith.npc.role === 'smith') assert.match(said, /doesn't buy/, 'a smith doesn\'t buy stone');
  inv.add('iron_ore', 30);
  const oi = inv.slots.findIndex(s => s?.key === 'iron_ore');
  talkDo(m.game, m.me, { op: 'sell', i: oi, all: true });
  assert.ok(inv.count('coins') > coins && inv.count('iron_ore') === 0, `sold the ore (${talkView(m.game, m.me).said})`);
});

test('every shop sells real things at a price, buys for less than anyone sells (no profit to be had), and everything made is worth something', () => {
  for (const r of RECIPES) assert.ok(valueOf(r.key) > 0, `${r.key} is worth something`);
  for (const [role, shop] of Object.entries(SHOPS)) {
    for (const [key] of [...shop.sells, ...(shop.rare || [])]) {
      assert.ok(itemOf(key), `${shop.name}: ${key} is a thing`);
      assert.ok(valueOf(key) > 0, `${shop.name}: ${key} has a price`);
      const n = bundleOf(key), price = Math.max(1, Math.round(valueOf(key) * n * shop.markup));
      for (const other of Object.keys(SHOPS)) assert.ok(offerFor(other, key, n) < price, `${key}: bought from the ${shop.name} for ${price}, sold to the ${SHOPS[other].name} for less (${offerFor(other, key, n)})`);
    }
    assert.ok(ROLES[role], `${shop.name}: kept by someone`);
  }
  // Gems: a trader pays the most for them.
  assert.ok(offerFor('trader', 'diamond') > offerFor('merchant', 'diamond'));
  assert.equal(offerFor('merchant', 'coins'), 0, 'coins aren\'t for sale');
  // Every food heals.
  for (const it of ITEMS.values()) if (it.kind === 'food') assert.ok(it.heal > 0, `${it.key} heals`);
});

test('a healer heals for coins, an innkeeper gives a bed (and the morning) and you come back there', () => {
  const m = play();
  const city = cityOf(m.world.gen);
  visit(m, city);
  const healer = m.game.soldiers.find(s => isFolk(s) && s.npc.role === 'healer');
  const inn = m.game.soldiers.find(s => isFolk(s) && s.npc.role === 'innkeeper');
  assert.ok(healer && inn, 'a healer and an innkeeper in the city');
  const inv = m.me.world.inv;
  put(m.me, Math.floor(healer.x / TILE) - 2, Math.floor((healer.y + 13) / TILE));
  run(m.game, 2);
  startTalk(m.game, m.me, healer);
  m.me.health = 40;
  const fee = talkView(m.game, m.me).options.find(o => o.op === 'heal').price;
  assert.ok(fee > 0, `healing costs (${fee})`);
  inv.add('coins', 300);
  talkDo(m.game, m.me, { op: 'heal' });
  assert.equal(m.me.health, m.me.maxHealth, 'healed');
  assert.equal(inv.count('coins'), 300 - fee, 'paid for it');
  // The inn: at night, alone, you sleep till morning.
  put(m.me, Math.floor(inn.x / TILE) - 2, Math.floor((inn.y + 13) / TILE));
  run(m.game, 2);
  startTalk(m.game, m.me, inn);
  m.world.time = Math.floor(m.world.time / DAY_TICKS) * DAY_TICKS + DAY_TICKS * (16 / 24); // ten at night
  m.me.health = 10;
  talkDo(m.game, m.me, { op: 'rest' });
  assert.ok(Math.abs(hourOf(m.world.time) - 7) < 0.01, `morning (${hourOf(m.world.time)})`);
  assert.equal(m.me.health, m.me.maxHealth, 'rested');
  assert.ok(m.me.world.home && Math.abs(m.me.world.home.x - inn.x) < 4 * TILE, 'you\'ll come back here');
});

test('food and potions heal when eaten (one at a time), not when you\'re not hurt', () => {
  const m = play();
  const w = m.me.world;
  w.inv.slots[9] = { key: 'bread', n: 3 };
  w.inv.version++;
  m.ctl.script = { move: 0, switchTo: '#9' };
  run(m.game, 2);
  m.me.health = 60;
  m.ctl.script = { move: 0, fire: true, firePressed: true };
  run(m.game, 1);
  m.ctl.script = { move: 0 };
  run(m.game, 2);
  assert.equal(m.me.health, 60 + itemOf('bread').heal, 'bread heals');
  assert.equal(w.inv.count('bread'), 2, 'one eaten');
  m.me.health = m.me.maxHealth;
  run(m.game, 40);
  m.ctl.script = { move: 0, fire: true, firePressed: true };
  run(m.game, 1);
  m.ctl.script = { move: 0 };
  run(m.game, 2);
  assert.equal(w.inv.count('bread'), 2, 'not eaten at full health');
});

test('online: a player talks to the townsfolk and trades through the host', async () => {
  const world = new TileWorld({ seed: SEED, name: 'Shared', towns: true });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, effects: true, seed: 1, options: { destruction: true } });
  game.online = true;
  const host = game.addSoldier({ name: 'Host', isBot: false }, { input: () => ({ move: 0 }) });
  const sync = new WorldHost(game, {});
  const net = new NetHost({ maxPlayers: 8, botCount: 0, world: sync, matchInfo: () => ({ mode: 'world', mapName: world.name, speed: DEFAULT_SPEED, options: game.options, world: sync.info() }), addBot: () => {} });
  net.setGame(game);
  let now = 0;
  const queue = [], talks = [];
  const schedule = (fn, ms) => queue.push({ fn, at: now + ms });
  const ctl = { script: { move: 0 }, input() { const s = this.script; this.script = { ...s, jumpPressed: false, firePressed: false }; return s; } };
  const [h, c] = memoryLinks({ latency: 20, schedule });
  const wc = new WorldClient({ onTalk: v => talks.push(v) });
  const client = new NetClient({ link: c, controller: ctl, loadMap: async () => null, clock: () => now, world: wc });
  net.addPlayer(h, 'Guest');
  const pump = async () => {
    for (let k = 0; k < 4; k++) {
      await new Promise(r => setImmediate(r));
      const due = queue.filter(q => q.at <= now);
      for (const q of due) { queue.splice(queue.indexOf(q), 1); q.fn(); }
    }
  };
  const step = async (n = 1) => {
    for (let i = 0; i < n; i++) { game.update(); net.afterTick(); client.tick(); now += 1000 / 60; await pump(); client.updateView(now); }
  };
  await pump();
  await step(120);
  const t = world.gen.townIn(world.gen.spawnRegion), guest = game.soldiers.find(s => s.remote);
  put(host, mid(t), t.level - 1);
  put(guest, mid(t), t.level - 1);
  await step(150);
  const npc = game.soldiers.find(s => isFolk(s) && s.alive && SHOPS[s.npc.role]);
  assert.ok(npc, 'a shopkeeper about');
  game.controllers.get(npc).wait = 900;
  put(guest, Math.floor(npc.x / TILE) - 3, Math.floor((npc.y + 13) / TILE));
  await step(20);
  // (They see the townsfolk, with their work in their name tags.)
  const seen = client.game.soldiers.find(s => s.id === npc.id);
  assert.equal(seen?.npc?.kind, 'townsfolk');
  assert.equal(seen.name, npc.name);
  // Right click on them.
  ctl.script = { move: 0, alt: true, ...aimAt(guest, npc.x, npc.y - 6) };
  await step(8);
  ctl.script = { move: 0 };
  await step(10);
  const view = talks.at(-1);
  assert.ok(view && view.id === npc.id, 'the host tells them who they\'re talking to');
  assert.ok(view.shop.stock.length > 0, 'and what\'s for sale');
  // Buying: done by the host, their things come back changed.
  guest.world.inv.add('coins', 1000);
  const o = view.shop.stock.find(x => x.left > 0);
  await step(6);
  c.send({ t: 'wop', op: 'talk', d: { op: 'buy', key: o.key } }, true);
  await step(12);
  assert.equal(guest.world.inv.count('coins'), 1000 - o.price, 'the host took the coins');
  assert.equal(client.me.world.inv.count('coins'), 1000 - o.price, 'and they see it');
  assert.match(talks.at(-1).said, /^Bought/, 'and what was said');
  // Goodbye.
  c.send({ t: 'wop', op: 'talk', d: { op: 'bye' } }, true);
  await step(10);
  assert.equal(guest.world.talk, null, 'the talk is over');
  assert.equal(talks.at(-1), null, 'and they\'re told');
});
