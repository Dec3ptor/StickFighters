// Playing together in a world (social.js, raids.js): raids on towns at night that whoever's near
// beats back (and is thanked for), parties that share their fights and quests, trading between
// players, and all of it online through the host. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { NetHost } from '../web/src/net/host.js';
import { NetClient } from '../web/src/net/client.js';
import { memoryLinks } from '../web/src/net/peer.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { TileWorld, TILE } from '../web/src/world/tileworld.js';
import { folkOf } from '../web/src/world/townsfolk.js';
import { worldState } from '../web/src/world/worldplay.js';
import { Inventory } from '../web/src/world/items.js';
import { startRaid, raidersLeft } from '../web/src/world/raids.js';
import { invite, joinParty, leaveParty, partyOf, partyMates, shareQuest, askTrade, offerTrade, acceptTrade, tradeOf, tradeView, socialOptions } from '../web/src/world/social.js';
import { makeQuest, acceptQuest, questsOf } from '../web/src/world/quests.js';
import { progOf } from '../web/src/world/progress.js';
import { spawnMonster, DAY_TICKS } from '../web/src/world/monsters.js';
import { WorldHost, WorldClient } from '../web/src/world/worldnet.js';
import { damage } from '../web/src/combat.js';

const SEED = 777;
const put = (s, tx, ty) => { s.body.x = tx * TILE + 8; s.body.y = (ty + 1) * TILE - 14; s.body.vx = s.body.vy = 0; };
const run = (game, n) => { for (let i = 0; i < n; i++) game.update(); };

/** A world with two players in it (as a host and someone who's joined would be). */
function two() {
  const world = new TileWorld({ seed: SEED, name: 'Together', towns: true });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const a = game.addSoldier({ name: 'Ann', isBot: false }, { input: () => ({ move: 0 }) });
  const b = game.addSoldier({ name: 'Bo', isBot: false }, { input: () => ({ move: 0 }) });
  for (let i = 0; i < 300 && !(a.alive && b.alive); i++) game.update();
  world.devQuiet = true;
  const t = world.gen.townIn(world.gen.spawnRegion);
  put(a, (t.x0 + t.x1) >> 1, t.level - 1);
  put(b, ((t.x0 + t.x1) >> 1) + 3, t.level - 1);
  run(game, 60);
  return { world, game, a, b, t };
}
const kill = (m, z, by) => { z.spawnProtect = 0; damage(m.game, z, 1e9, by, 'M4'); };

test('a raid on a town at night: the horde at its edges, beaten back, and whoever fought is thanked', () => {
  const m = two();
  m.world.time = DAY_TICKS * 0.75; // (night)
  const raid = startRaid(m.game, m.t, 6);
  run(m.game, 3);
  assert.equal(raid.total, 6);
  const raiders = m.game.soldiers.filter(s => s.npc?.raid === m.t.k);
  assert.equal(raiders.length, 6, 'six of them');
  for (const r of raiders) assert.ok(r.x < m.t.x0 * TILE || r.x > m.t.x1 * TILE, 'at the town\'s edges');
  assert.equal(raidersLeft(m.game), 6);
  run(m.game, 31);
  assert.deepEqual(m.a.world.raidInfo, { name: m.t.name, left: 6, total: 6 }, 'said on the HUD');
  const coins = m.a.world.inv.count('coins'), xp = progOf(m.a).xp + progOf(m.a).level * 1e5;
  raiders.forEach((r, i) => kill(m, r, i < 4 ? m.a : m.b));
  run(m.game, 31);
  assert.equal(m.world.raid, null, 'beaten');
  assert.equal(m.a.world.inv.count('coins'), coins + 20 + 4 * 8, 'thanked by the kill');
  assert.ok(progOf(m.a).xp + progOf(m.a).level * 1e5 > xp, 'and experience');
  assert.equal(progOf(m.a).stats.raids, 1);
  // A raid not beaten by dawn: over, for nothing.
  startRaid(m.game, m.t, 4);
  run(m.game, 3);
  m.world.time = DAY_TICKS * 1.1;
  run(m.game, 31);
  assert.equal(m.world.raid, null, 'over at dawn');
  assert.equal(m.game.soldiers.filter(s => s.npc?.raid).length, 0, 'the dead gone back into the ground');
});

test('a party: invited and joined; kills near each other shared (quests and half the experience); a quest shared; leaving', () => {
  const m = two();
  assert.match(invite(m.game, m.a, m.b), /asked Bo/);
  assert.deepEqual(socialOptions(m.game, m.b, m.a).map(o => o.op), ['pjoin', 'trade'], 'Bo can join Ann\'s party');
  assert.match(joinParty(m.game, m.b, m.a), /joined Ann's party/);
  assert.ok(partyOf(m.game, m.a) && partyOf(m.game, m.a) === partyOf(m.game, m.b), 'one party');
  assert.deepEqual(partyMates(m.game, m.a), [m.b]);
  run(m.game, 31);
  assert.equal(m.a.world.partyList[0].name, 'Bo', 'on each other\'s HUD');
  // Bo's quest to cull zombies counts Ann's kill.
  const f = folkOf(SEED, m.t)[0];
  const q = makeQuest(m.world, f, m.t, 200, 0, 1, 'cull');
  q.goals[0].what = 'zombie';
  acceptQuest(m.game, m.b, q);
  const bxp = progOf(m.b).xp;
  const z = spawnMonster(m.game, 'zombie', m.a.x + 30, m.a.y - 6);
  run(m.game, 2);
  kill(m, z, m.a);
  assert.equal(questsOf(m.b).list[0].goals[0].have, 1, 'Ann\'s kill counted for Bo');
  assert.equal(progOf(m.b).xp - bxp, 5, 'and half its experience');
  // Bo shares the quest with Ann: hers fresh.
  assert.match(shareQuest(m.game, m.b, q.id), /Shared with 1/);
  assert.equal(questsOf(m.a).list[0].goals[0].have, 0, 'Ann has it, fresh');
  // Too far away: nothing shared.
  m.b.body.x += 200 * TILE;
  const z2 = spawnMonster(m.game, 'zombie', m.a.x + 30, m.a.y - 6);
  run(m.game, 2);
  kill(m, z2, m.a);
  assert.equal(questsOf(m.b).list[0].goals[0].have, 1, 'not when far away');
  assert.match(leaveParty(m.game, m.b), /left/);
  assert.equal(partyOf(m.game, m.a), null, 'a party of one is no party');
});

test('trading: each puts things up, both accept, and they swap; any change, and both accept again', () => {
  const m = two();
  m.a.world.inv = Inventory.from([]);
  m.b.world.inv = Inventory.from([]);
  m.a.world.inv.add('iron_bar', 10);
  m.a.world.inv.add('coins', 50);
  m.b.world.inv.add('diamond', 1);
  assert.match(askTrade(m.game, m.a, m.b), /asked Bo to trade/);
  assert.match(askTrade(m.game, m.b, m.a), /Trading with Ann/, 'asked back: it starts');
  assert.ok(tradeOf(m.game, m.a) && tradeOf(m.game, m.a) === tradeOf(m.game, m.b));
  offerTrade(m.game, m.a, [[m.a.world.inv.slots.findIndex(s => s?.key === 'iron_bar'), 10]], 20);
  offerTrade(m.game, m.b, [[m.b.world.inv.slots.findIndex(s => s?.key === 'diamond'), 1]], 0);
  const v = tradeView(m.game, m.b);
  assert.deepEqual(v.theirs.items.map(x => [x[0], x[1]]), [['iron_bar', 10]]);
  assert.equal(v.theirs.coins, 20);
  assert.match(acceptTrade(m.game, m.a), /Waiting/);
  // Bo changes his offer: Ann has to accept again.
  offerTrade(m.game, m.b, [[m.b.world.inv.slots.findIndex(s => s?.key === 'diamond'), 1]], 0);
  assert.equal(tradeView(m.game, m.a).mine.ok, false, 'a change: accept again');
  acceptTrade(m.game, m.a);
  assert.equal(acceptTrade(m.game, m.b), 'Traded');
  assert.equal(m.a.world.inv.count('diamond'), 1);
  assert.equal(m.a.world.inv.count('iron_bar'), 0);
  assert.equal(m.a.world.inv.count('coins'), 30);
  assert.equal(m.b.world.inv.count('iron_bar'), 10);
  assert.equal(m.b.world.inv.count('coins'), 20);
  assert.equal(tradeOf(m.game, m.a), null, 'done');
});

test('online: a player right clicks on another, invites them, and trades, all through the host', async () => {
  const world = new TileWorld({ seed: SEED, name: 'Shared', towns: true });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, effects: true, seed: 1, options: { destruction: true } });
  game.online = true;
  world.pvp = false;
  const host = game.addSoldier({ name: 'Host', isBot: false }, { input: () => ({ move: 0 }) });
  host.world = worldState(new Inventory());
  const sync = new WorldHost(game, {});
  const net = new NetHost({ maxPlayers: 8, botCount: 0, world: sync, matchInfo: () => ({ mode: 'world', mapName: world.name, speed: DEFAULT_SPEED, options: game.options, world: sync.info() }), addBot: () => {} });
  net.setGame(game);
  let now = 0;
  const queue = [], menus = [], trades = [];
  const schedule = (fn, ms) => queue.push({ fn, at: now + ms });
  const ctl = { script: { move: 0 }, input() { const s = this.script; this.script = { ...s, jumpPressed: false, firePressed: false }; return s; } };
  const [h, c] = memoryLinks({ latency: 20, schedule });
  const wc = new WorldClient({ onSocial: v => menus.push(v), onTrade: v => trades.push(v) });
  const client = new NetClient({ link: c, controller: ctl, loadMap: async () => null, clock: () => now, world: wc });
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
  const guest = game.soldiers.find(s => s.remote), t = world.gen.townIn(world.gen.spawnRegion);
  put(host, t.x0 - 30, world.gen.surfaceAt(t.x0 - 30) - 1);
  put(guest, t.x0 - 33, world.gen.surfaceAt(t.x0 - 33) - 1);
  await step(20);
  // Right click on the host.
  const aim = { aim: Math.atan2(host.y - 6 - guest.shoulderY, host.x - guest.shoulderX), aimDist: Math.hypot(host.x - guest.shoulderX, host.y - 6 - guest.shoulderY) };
  ctl.script = { move: 0, alt: true, ...aim };
  await step(6);
  ctl.script = { move: 0 };
  await step(8);
  const menu = menus.at(-1);
  assert.ok(menu && menu.name === 'Host', 'a menu for the other player');
  assert.ok(menu.options.some(o => o.op === 'pinvite') && menu.options.some(o => o.op === 'trade'));
  c.send({ t: 'wop', op: 'social', id: menu.id, act: 'pinvite' }, true);
  await step(8);
  assert.equal(host.world.invite?.from, 'Guest', 'the host is invited');
  joinParty(game, host, guest);
  await step(40);
  assert.equal(client.me.world.partyList?.[0]?.name, 'Host', 'they see their party');
  // A trade: asked both ways.
  askTrade(game, host, guest);
  c.send({ t: 'wop', op: 'social', id: menu.id, act: 'trade' }, true);
  await step(10);
  assert.equal(trades.at(-1)?.with, 'Host', 'trading, and they see it');
  guest.world.inv.add('ruby', 1);
  await step(4);
  c.send({ t: 'wop', op: 'toffer', slots: [[guest.world.inv.slots.findIndex(s => s?.key === 'ruby'), 1]], coins: 0 }, true);
  await step(8);
  assert.equal(trades.at(-1).mine.items[0][0], 'ruby', 'their offer, as the host has it');
  acceptTrade(game, host);
  c.send({ t: 'wop', op: 'taccept' }, true);
  await step(10);
  assert.equal(host.world.inv.count('ruby'), 1, 'the ruby went over');
  assert.equal(trades.at(-1), null, 'and the trade closed for them');
});
