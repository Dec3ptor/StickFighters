// Online play without a network: a host and players joined by in-memory links.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { NavGraph } from '../web/src/nav.js';
import { BotController, BOT_PROFILES } from '../web/src/bot.js';
import { NetHost } from '../web/src/net/host.js';
import { NetClient } from '../web/src/net/client.js';
import { memoryLinks } from '../web/src/net/peer.js';
import { encodeInputs, decodeInputs, encodeWorld, encodeSnapshot, decodeSnapshot } from '../web/src/net/protocol.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { makeRng } from '../web/src/util.js';
import { loadMap } from './helpers.mjs';

test('inputs survive the trip (and silly values are clamped)', () => {
  const inputs = [
    { seq: 41, move: -1, jump: true, jumpPressed: true, aim: 1.25, aimDist: 300, fire: true, firePressed: true, switchTo: 'Sheep' },
    { seq: 42, move: 0.5, crouch: true, jet: true, aim: -2, aimDist: 99999, cycle: -1 },
  ];
  const out = decodeInputs(encodeInputs(inputs));
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(i => i.seq), [41, 42]);
  assert.equal(out[0].move, -1);
  assert.ok(out[0].jump && out[0].jumpPressed && out[0].fire && out[0].firePressed);
  assert.equal(out[0].switchTo, 'Sheep');
  assert.ok(Math.abs(out[0].aim - 1.25) < 0.001);
  assert.equal(out[1].aimDist, 65535);
  assert.ok(Math.abs(out[1].aim - (-2 + Math.PI * 2)) < 0.001);
  assert.equal(out[1].cycle, -1);
  assert.ok(out[1].crouch && out[1].jet && !out[1].fire);
});

function botGame(file = 'ssdm1.json', mode = 'ffa', seed = 5) {
  const mapData = loadMap(file);
  const game = new Game({ mapData, mode, fragLimit: 999, seed, effects: true, speed: DEFAULT_SPEED });
  const nav = new NavGraph(game.map);
  const rng = makeRng(seed);
  const addBot = g => {
    const profile = BOT_PROFILES[g.soldiers.length % BOT_PROFILES.length];
    g.addSoldier({ name: profile.name + g.soldiers.length, isBot: true, profile, team: g.rules.teams ? 1 + (g.soldiers.length % 2) : 0 }, new BotController(nav, 'normal', profile, rng));
  };
  return { game, mapData, nav, addBot };
}

test('snapshots carry every soldier, projectile and pickup', () => {
  const { game, addBot } = botGame();
  for (let i = 0; i < 6; i++) addBot(game);
  for (const s of game.soldiers) s.weapons.Sheep = { ammo: 3 };
  for (let i = 0; i < 900; i++) game.update();
  const me = game.soldiers.find(s => s.alive);
  const snap = decodeSnapshot(encodeSnapshot(game, me, 77, encodeWorld(game)));
  assert.equal(snap.tick, game.tick);
  assert.equal(snap.ack, 77);
  assert.equal(snap.soldiers.length, game.soldiers.length);
  for (const s of game.soldiers) {
    const t = snap.soldiers.find(x => x.id === s.id);
    assert.ok(Math.abs(t.x - s.x) < 0.01 && Math.abs(t.y - s.y) < 0.01, 'positions');
    assert.equal(t.alive, s.alive);
    assert.equal(t.current, s.current);
    assert.equal(t.frags, s.frags);
  }
  assert.equal(snap.projectiles.length, game.projectiles.filter(p => !p.dead).length);
  assert.equal(snap.fixedItems.length, game.pickups.items.filter(it => !it.dropped).length);
  assert.ok(Math.abs(snap.me.x - me.x) < 1e-3);
  assert.deepEqual(Object.keys(snap.me.weapons).sort(), Object.keys(me.weapons).sort());
  const size = encodeSnapshot(game, me, 77, encodeWorld(game)).length;
  assert.ok(size < 4000, `snapshot is ${size} bytes`);
});

/** A host with bots, and `players` remote players joined over in-memory links on a simulated clock. */
async function onlineMatch({ players = 1, latency = 0, loss = 0, mode = 'ffa', file = 'ssdm1.json', controllers = [] } = {}) {
  const { game, mapData, addBot } = botGame(file, mode);
  let now = 0;
  const queue = [];
  const schedule = (fn, ms) => queue.push({ at: now + ms, fn });
  const host = new NetHost({
    maxPlayers: 8, botCount: 3,
    matchInfo: () => ({ mode, fragLimit: 999, options: game.options, speed: DEFAULT_SPEED, map: { builtin: file }, mapName: 'test' }),
    addBot,
  });
  game.addSoldier({ name: 'Host', isBot: false }, { input: () => ({ move: 0 }) });
  host.setGame(game);
  const clients = [];
  for (let i = 0; i < players; i++) {
    const [h, c] = memoryLinks({ latency, loss, schedule, rng: makeRng(9 + i) });
    const ctl = controllers[i] || { input: (g, s) => ({ move: Math.sin(g.tick / 40) > 0 ? 1 : -1, jump: g.tick % 50 < 10, jumpPressed: g.tick % 50 === 0, aim: 0, aimDist: 200 }) };
    const client = new NetClient({ link: c, controller: ctl, loadMap: async () => mapData, clock: () => now });
    clients.push(client);
    host.addPlayer(h, `Guest${i}`);
  }
  const pump = async () => {
    for (let k = 0; k < 4; k++) {
      await new Promise(r => setImmediate(r));
      const due = queue.filter(q => q.at <= now);
      for (const q of due) { queue.splice(queue.indexOf(q), 1); q.fn(); }
    }
  };
  await pump();
  const step = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      game.update();
      host.afterTick();
      for (const c of clients) c.tick();
      now += 1000 / 60;
      await pump();
      for (const c of clients) c.updateView(now);
    }
  };
  return { game, host, clients, step, mapData };
}

test('a player joins: same soldiers on both sides, bots make room, prediction matches the host', async () => {
  const { game, host, clients, step } = await onlineMatch({ players: 1 });
  const c = clients[0];
  assert.ok(c.game, 'client got the match');
  assert.equal(c.game.soldiers.length, game.soldiers.length);
  assert.equal(game.soldiers.filter(s => s.isBot).length, 3);
  await step(600);
  const mine = game.soldiers.find(s => s.remote);
  assert.ok(mine.alive, 'my soldier spawned on the host');
  assert.ok(c.me.alive, 'and on my screen');
  // No lag: what I predict is where the host has me, plus the one input it hasn't used yet (a tick of running).
  assert.ok(Math.hypot(c.me.x - mine.x, c.me.y - mine.y) < 4, `prediction off by ${Math.hypot(c.me.x - mine.x, c.me.y - mine.y).toFixed(1)} px`);
  for (const s of c.game.soldiers) assert.ok(Number.isFinite(s.x));
  host.close();
});

test('with lag and packet loss, my soldier still ends up where the host has it', async () => {
  const { game, clients, step } = await onlineMatch({ players: 1, latency: 60, loss: 0.1 });
  const c = clients[0];
  await step(900);
  const mine = game.soldiers.find(s => s.remote);
  assert.ok(mine.alive && c.me.alive);
  // Let the last inputs reach the host, standing still.
  c.opts.controller = { input: () => ({ move: 0, aim: 0 }) };
  await step(120);
  const d = Math.hypot(c.me.x - mine.x, c.me.y - mine.y);
  assert.ok(d < 3, `after settling, prediction is ${d.toFixed(1)} px from the host`);
  // Others are shown smoothly: their positions are recent host positions.
  for (const s of c.game.soldiers) {
    if (s === c.me || !s.alive) continue;
    const h = game.soldiers.find(x => x.id === s.id);
    if (h.alive) assert.ok(Math.hypot(s.x - h.x, s.y - h.y) < 150, `${s.name} is ${Math.hypot(s.x - h.x, s.y - h.y).toFixed(0)} px off`);
  }
});

test('players hear the host\'s sounds, see the feed, and can chat', async () => {
  const shoot = { input: (g, s) => ({ move: 0, aim: Math.PI, fire: true, firePressed: g.tick % 20 === 0 }) };
  const { host, clients, step } = await onlineMatch({ players: 2, controllers: [shoot] });
  await step(400);
  const c = clients[0];
  const heard = new Set(c.game.sounds.map(s => s.name));
  assert.ok(heard.size > 0, 'sounds arrived');
  clients[1].sendChat('hello there');
  await step(5);
  assert.ok(c.chat.some(m => m.text === 'hello there'), 'chat arrived');
  host.chat('Host', 'welcome!');
  await step(2);
  assert.ok(clients[1].chat.some(m => m.text === 'welcome!'));
});

test('a player leaving removes their soldier and a bot takes the slot back', async () => {
  const { game, host, clients, step } = await onlineMatch({ players: 2 });
  await step(60);
  const before = game.soldiers.length;
  clients[1].leave();
  await step(30);
  assert.equal(host.players.size, 1);
  assert.equal(game.soldiers.filter(s => s.remote).length, 1);
  assert.equal(game.soldiers.filter(s => s.isBot).length, 3, 'bots back to the bot count');
  assert.equal(game.soldiers.length, before - 1);
  assert.equal(clients[0].game.soldiers.length, game.soldiers.length, 'the other player sees the change');
});

test('a full game makes bots leave as players join', async () => {
  const { game, host } = await onlineMatch({ players: 0 });
  host.opts.maxPlayers = 4;
  host.balanceBots();
  assert.equal(game.soldiers.length, 4);
  const [h] = memoryLinks();
  host.addPlayer(h, 'Late');
  assert.equal(game.soldiers.length, 4, 'still 4');
  assert.equal(game.soldiers.filter(s => s.isBot).length, 2);
});

test('gun game online: levels show on the player\'s screen', async () => {
  const { game, clients, step } = await onlineMatch({ players: 1, mode: 'gungame', file: 'ssdm4.json' });
  const mine = game.soldiers.find(s => s.remote);
  await step(240);
  mine.level = 5;
  await step(10);
  assert.equal(clients[0].me.level, 5);
  assert.equal(clients[0].game.mode, 'gungame');
});

test('the host ending the game tells everyone why', async () => {
  const { host, clients, step } = await onlineMatch({ players: 1 });
  let why = null;
  clients[0].opts.onEnd = r => { why = r; };
  host.close('Host went for dinner');
  await step(30);
  assert.equal(why, 'Host went for dinner');
});
