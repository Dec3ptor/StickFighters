// Online play without a network: a host and players joined by in-memory links.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { NavGraph } from '../web/src/nav.js';
import { BotController, BOT_PROFILES } from '../web/src/bot.js';
import { NetHost } from '../web/src/net/host.js';
import { NetClient } from '../web/src/net/client.js';
import { memoryLinks } from '../web/src/net/peer.js';
import { encodeInputs, decodeInputs, encodeWorld, encodeSnapshot, decodeSnapshot, SNAPSHOT_EVERY } from '../web/src/net/protocol.js';
import { DEFAULT_SPEED, PHYS } from '../web/src/config.js';
import { useOwnTuning, usingHostTuning } from '../web/src/tuning.js';
import { makeRng } from '../web/src/util.js';
import { WEAPONS } from '../web/src/weapons.js';
import { spawn } from '../web/src/combat.js';
import { loadMap } from './helpers.mjs';

test('inputs survive the trip (and silly values are clamped)', () => {
  const inputs = [
    { seq: 41, move: -1, jump: true, jumpPressed: true, aim: 1.25, aimDist: 300, fire: true, firePressed: true, switchTo: 'Sheep', sprint: true },
    { seq: 42, move: 0.5, crouch: true, jet: true, selfDestruct: true, aim: -2, aimDist: 99999, cycle: -1 },
  ];
  const out = decodeInputs(encodeInputs(inputs));
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(i => i.seq), [41, 42]);
  assert.equal(out[0].move, -1);
  assert.ok(out[0].jump && out[0].jumpPressed && out[0].fire && out[0].firePressed && !out[0].selfDestruct);
  assert.ok(out[1].selfDestruct, 'self-destruct (held K)');
  assert.ok(out[0].sprint && !out[1].sprint, 'sprint (Shift)');
  assert.equal(out[0].switchTo, 'Sheep');
  assert.ok(Math.abs(out[0].aim - 1.25) < 0.001);
  assert.equal(out[1].aimDist, 65535);
  assert.ok(Math.abs(out[1].aim - (-2 + Math.PI * 2)) < 0.001);
  assert.equal(out[1].cycle, -1);
  assert.ok(out[1].crouch && out[1].jet && !out[1].fire);
});

function botGame(file = 'ssdm1.json', mode = 'ffa', seed = 5, options = {}) {
  const mapData = loadMap(file);
  const game = new Game({ mapData, mode, fragLimit: 999, seed, effects: true, speed: DEFAULT_SPEED, options });
  const nav = game.useNav(new NavGraph(game.map));
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
async function onlineMatch({ players = 1, latency = 0, loss = 0, mode = 'ffa', file = 'ssdm1.json', controllers = [], options = {}, before, tuning = null } = {}) {
  const first = botGame(file, mode, 5, options);
  const { mapData, addBot } = first;
  let game = first.game;
  let now = 0;
  const queue = [];
  const schedule = (fn, ms) => queue.push({ at: now + ms, fn });
  const host = new NetHost({
    maxPlayers: 8, botCount: 3,
    matchInfo: () => ({ mode, fragLimit: 999, options: game.options, speed: DEFAULT_SPEED, map: { builtin: file }, mapName: 'test', tuning }),
    addBot,
  });
  game.addSoldier({ name: 'Host', isBot: false }, { input: () => ({ move: 0 }) });
  host.setGame(game);
  before?.(game);
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
  /** The host starts the next match (as after a match ends). */
  const newMatch = async () => {
    const next = botGame(file, mode, 21);
    game = next.game;
    game.addSoldier({ name: 'Host', isBot: false }, { input: () => ({ move: 0 }) });
    host.opts.addBot = next.addBot;
    host.setGame(game);
    await pump();
    return game;
  };
  return { get game() { return game; }, host, clients, step, mapData, newMatch };
}

test('a player joins: same soldiers on both sides, bots make room, prediction matches the host', async () => {
  const { game, host, clients, step } = await onlineMatch({ players: 1 });
  const c = clients[0];
  assert.ok(c.game, 'client got the match');
  assert.equal(c.game.soldiers.length, game.soldiers.length);
  assert.equal(game.soldiers.filter(s => s.isBot).length, 3);
  await step(600);
  const mine = game.soldiers.find(s => s.remote);
  assert.ok(mine.alive || mine.deaths > 0, 'my soldier spawned on the host');
  // (If a bot has just got me, wait until I'm back: both sides then agree I'm alive.)
  for (let i = 0; i < 600 && !(mine.alive && c.me.alive); i++) await step(1);
  assert.ok(mine.alive && c.me.alive, 'alive on the host and on my screen');
  // No lag: what I predict is where the host has me, plus the one input it hasn't used yet (a tick of moving).
  const ahead = Math.hypot(mine.body.vx, mine.body.vy) + 2;
  assert.ok(Math.hypot(c.me.x - mine.x, c.me.y - mine.y) < ahead, `prediction off by ${Math.hypot(c.me.x - mine.x, c.me.y - mine.y).toFixed(1)} px`);
  for (const s of c.game.soldiers) assert.ok(Number.isFinite(s.x));
  host.close();
});

test('with lag and packet loss, my soldier still ends up where the host has it', async () => {
  const { game, clients, step } = await onlineMatch({ players: 1, latency: 60, loss: 0.1 });
  const c = clients[0];
  await step(900);
  const mine = game.soldiers.find(s => s.remote);
  // (If a bot has just got me, wait until I'm back.)
  for (let i = 0; i < 600 && !(mine.alive && c.me.alive); i++) await step(1);
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

test('sprinting online: my screen predicts the speed and stamina the host has', async () => {
  const sprinter = { input: g => ({ move: Math.sin(g.tick / 90) > 0 ? 1 : -1, sprint: g.tick % 400 < 300, aim: 0, aimDist: 200 }) };
  const { game, clients, step } = await onlineMatch({ players: 1, controllers: [sprinter] });
  const c = clients[0];
  await step(600);
  const mine = game.soldiers.find(s => s.remote);
  for (let i = 0; i < 600 && !(mine.alive && c.me.alive); i++) await step(1);
  let sprinted = false;
  for (let i = 0; i < 200; i++) {
    await step(1);
    if (!mine.alive || !c.me.alive) continue;
    sprinted ||= mine.body.sprinting;
    // (My screen runs one input ahead of the host.)
    assert.ok(Math.abs(c.me.body.stamina - mine.body.stamina) <= 1, `stamina ${c.me.body.stamina} vs ${mine.body.stamina}`);
    assert.ok(Math.hypot(c.me.x - mine.x, c.me.y - mine.y) < Math.hypot(mine.body.vx, mine.body.vy) + 2);
  }
  assert.ok(sprinted, 'sprinted on the host');
});

test('destructible maps online: players get every hole the host blows, joining late or missing some', async () => {
  const blocks = g => g.map.solids.map(b => `${b.l},${b.t},${b.r},${b.b}`).sort().join('|');
  // Blow a hole in the middle of the i-th block that can be destroyed.
  const blast = (g, i) => { const b = g.map.solids.filter(s => !s.hard)[i]; g.carve((b.l + b.r) / 2, (b.t + b.b) / 2, 40); };
  // Holes blown before the player joins come with the welcome...
  const { game, clients, step } = await onlineMatch({ players: 1, options: { destruction: true }, before: g => { blast(g, 0); blast(g, 3); } });
  const c = clients[0];
  await step(30);
  assert.equal(game.carves.length, 2);
  assert.equal(c.game.carves.length, game.carves.length);
  assert.equal(blocks(c.game), blocks(game), 'same map after the early holes');
  // ...and ones blown during the match arrive as they happen.
  for (const i of [1, 2, 5]) blast(game, i);
  await step(10);
  assert.equal(c.game.carves.length, game.carves.length);
  assert.equal(blocks(c.game), blocks(game), 'same map after more holes');
  // A player who notices it's missing some asks, and gets them.
  const asked = [];
  const send = c.link.send.bind(c.link);
  c.link.send = (m, r) => { if (m?.t === 'carves?') asked.push(m); return send(m, r); };
  c.game.carves.pop(); // (pretend the last one never arrived)
  c.carvesBehind = null;
  await step(60);
  assert.ok(asked.length >= 1, 'asked for the missing holes');
  assert.equal(c.game.carves.length, game.carves.length, 'caught up');
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
  assert.ok(c.chat.every(m => !m.team), 'no teams: no team colours');
});

test('in team modes, chat says which team each message is from (its name is shown in that colour)', async () => {
  const { host, clients, step } = await onlineMatch({ players: 2, mode: 'team' });
  await step(60);
  const from = clients[1];
  const team = from.me?.team;
  assert.ok(team === 1 || team === 2, `on a team (${team})`);
  from.sendChat('push left');
  host.chat('Host', 'on it', 2);
  host.chat('Nobody', 'no team', 0);
  await step(5);
  const got = clients[0].chat;
  assert.equal(got.find(m => m.text === 'push left')?.team, team);
  assert.equal(got.find(m => m.text === 'on it')?.team, 2);
  assert.equal(got.find(m => m.text === 'no team')?.team, 0);
});

test('players use the host\'s numbers (its developer menu), and their own again after', async () => {
  const m = await onlineMatch({ tuning: { PHYS: { runSpeed: 5 }, WEAPONS: { M4: { damage: 30 } } } });
  try {
    assert.ok(m.clients[0].game, 'joined');
    assert.ok(usingHostTuning(), 'the host\'s numbers in use');
    assert.ok(Math.abs(PHYS.runSpeed - 5 * DEFAULT_SPEED) < 1e-9, `run speed ${PHYS.runSpeed}`);
    assert.equal(WEAPONS.M4.damage, 30);
  } finally { useOwnTuning(); }
  assert.ok(!usingHostTuning());
  assert.ok(Math.abs(PHYS.runSpeed - 3.4 * DEFAULT_SPEED) < 1e-9, 'our own (the game\'s) again');
  assert.equal(WEAPONS.M4.damage, 12);
});

test('everyone sees each player\'s skin: the host\'s, and a player\'s chosen on joining or mid-match', async () => {
  const m = await onlineMatch({ before: g => { g.soldiers.find(s => s.name === 'Host').skin = 'knight'; } });
  const client = m.clients[0];
  assert.equal(client.game.soldiers.find(s => s.name === 'Host').skin, 'knight', 'the host\'s skin, from the roster');
  client.sendSkin('robot');
  await m.step(3);
  const theirs = m.game.soldiers.find(s => s.remote);
  assert.equal(theirs.skin, 'robot', 'on the host');
  assert.equal(client.game.soldiers.find(s => s.id === client.me.id).skin, 'robot', 'and back to them');
  // Not a skin: ignored.
  client.link.send({ t: 'skin', skin: 'constructor' }, true);
  await m.step(2);
  assert.equal(theirs.skin, 'robot');
  // The next match: still theirs.
  await m.newMatch();
  await m.step(3);
  assert.equal(m.game.soldiers.find(s => s.remote).skin, 'robot', 'kept into the next match');
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

test('after the host starts a new match, players see everyone, bots included', async () => {
  const m = await onlineMatch({ players: 2 });
  m.host.chat('Host', 'first match');
  await m.step(300);
  const chatBefore = m.clients[0].chat.length;
  const game = await m.newMatch();
  await m.step(300);
  for (const c of m.clients) {
    assert.equal(c.game.soldiers.length, game.soldiers.length, 'same number of soldiers');
    for (const s of game.soldiers) {
      const mine = c.game.soldiers.find(x => x.id === s.id);
      assert.ok(mine, `${s.name} missing on a player's screen`);
      assert.equal(mine.name, s.name);
      if (s.alive && s !== m.clients.find(x => x === c)?.me) assert.ok(Math.hypot(mine.x - s.x, mine.y - s.y) < 150, `${s.name} is in the wrong place`);
    }
    assert.equal(c.game.soldiers.filter(s => s.isBot).length, 3, 'bots are there');
  }
  assert.equal(m.clients[0].chat.length, chatBefore, 'chat history is not repeated each match');
  assert.ok(m.clients[0].game.pickups.items.every(it => it.dropped || m.clients[0].game.map.items.some(mi => mi.x === it.x && mi.y === it.y)), 'pickups belong to the new match');
});

test('a snapshot from the last match that turns up after the welcome to the next is ignored', async () => {
  const m = await onlineMatch({ players: 1 });
  // (Keep the last snapshot the host sends the player.)
  const [p] = m.host.players;
  let last = null;
  const send = p.link.send.bind(p.link);
  p.link.send = (data, reliable) => { if (data instanceof Uint8Array && data[0] === 2) last = data.slice(); return send(data, reliable); };
  await m.step(300);
  const stale = last;
  const c = m.clients[0], oldGame = c.game;
  await m.newMatch();
  assert.ok(c.game !== oldGame, 'the player is in the new match');
  // The last match's snapshot, overtaken on the way by the welcome (the fast channel's packets
  // can be): taken, it would hold up every snapshot of the new match until its clock got that far.
  c.receive(stale, false);
  assert.equal(c.snaps.length, 0, 'ignored');
  await m.step(60);
  const newest = c.snaps.at(-1);
  assert.ok(newest && m.game.tick - newest.tick < 10, `the new match's snapshots are taken (newest ${newest?.tick}, host at ${m.game.tick})`);
  assert.ok(c.game.tick > 30, 'and others are shown moving on');
});

test('a player who somehow misses a roster update asks for it again', async () => {
  const m = await onlineMatch({ players: 1 });
  await m.step(60);
  // Simulate the player losing track of a bot.
  const c = m.clients[0];
  const bot = c.game.soldiers.find(s => s.isBot);
  c.game.removeSoldier(bot);
  await m.step(120);
  assert.ok(c.game.soldiers.some(s => s.id === bot.id), 'bot came back');
});

test('pings: players measure theirs, and the host shares everyone\'s for the scoreboard', async () => {
  const m = await onlineMatch({ players: 2, latency: 40 });
  await m.step(30);
  const [a, b] = m.clients;
  a.sendPing(); b.sendPing();
  await m.step(10);
  assert.ok(a.ping > 60 && a.ping < 120, `ping about 80 ms with 40 ms each way (${a.ping})`);
  // The next pings tell the host what they measured; the host passes them on.
  a.sendPing(); b.sendPing();
  await m.step(10);
  m.host.sharePings(Date.now() + 60000);
  await m.step(10);
  const onHost = m.game.soldiers.find(s => s.id === a.me.id);
  assert.ok(onHost.ping > 60 && onHost.ping < 120, `host knows a's ping (${onHost.ping})`);
  const onB = b.game.soldiers.find(s => s.id === a.me.id);
  assert.equal(onB.ping, onHost.ping, "b's scoreboard shows a's ping");
  for (const c of m.clients) c.leave();
});

test('the host ending the game tells everyone why', async () => {
  const { host, clients, step } = await onlineMatch({ players: 1 });
  let why = null;
  clients[0].opts.onEnd = r => { why = r; };
  host.close('Host went for dinner');
  await step(30);
  assert.equal(why, 'Host went for dinner');
});

// ---- Showing everyone else between snapshots ------------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * What a player was shown at host tick `rt` before drawing stopped making garbage (the old way,
 * new copies of everything every frame). The client must still show exactly this.
 */
function oldView(snaps, rt, me) {
  rt = Math.min(rt, snaps[snaps.length - 1].tick + 6);
  let a = snaps[0], b = a;
  for (let i = snaps.length - 1; i >= 0; i--) if (snaps[i].tick <= rt) { a = snaps[i]; b = snaps[i + 1] || a; break; }
  if (rt < a.tick) rt = a.tick;
  const t = b.tick > a.tick ? Math.min(1.25, (rt - a.tick) / (b.tick - a.tick)) : 0;
  const tick = Math.floor(rt);
  const before = new Map(a.soldiers.map(s => [s.id, s]));
  const soldiers = new Map();
  for (const sb of b.soldiers) {
    if (sb.id === me?.id) continue;
    const sa = before.get(sb.id) || sb;
    const smooth = sa.alive && sb.alive && Math.hypot(sb.x - sa.x, sb.y - sa.y) < 150 * Math.max(1, (b.tick - a.tick) / SNAPSHOT_EVERY);
    const k = smooth ? t : 1, src = t < 0.5 && smooth ? sa : sb;
    const x = lerp(sa.x, sb.x, k), y = lerp(sa.y, sb.y, k);
    soldiers.set(sb.id, {
      x, y, prevX: x, prevY: y, vx: sb.vx, vy: sb.vy, crouching: src.crouching, onGround: src.onGround, jetting: src.jetting, hasJetpack: sb.hasJetpack,
      fuel: sb.fuel, padLaunch: src.padLaunch, rope: sb.rope, alive: sb.alive, aim: smooth ? lerpAngle(sa.aim, sb.aim, t) : sb.aim, facing: src.facing,
      health: sb.health, armour: sb.armour, current: sb.current, frags: sb.frags, deaths: sb.deaths, points: sb.points, level: sb.level, lives: sb.lives,
      cls: sb.cls, streak: sb.streak, jugger: sb.jugger, respawnTimer: sb.respawnTimer, spawnProtect: sb.protected ? 1 : 0, burnTicks: sb.burning ? 1 : 0,
      kamikaze: sb.kamikaze, run: smooth && Math.abs(sb.anim.run - sa.anim.run) < 0.5 ? lerp(sa.anim.run, sb.anim.run, t) : sb.anim.run,
      flip: sb.anim.flip, land: sb.anim.land, recoil: sb.anim.recoil, swing: sb.anim.swing, idle: tick,
    });
  }
  const prev = new Map(a.projectiles.map(p => [p.id, p]));
  const projectiles = b.projectiles.map(pb => {
    const pa = prev.get(pb.id), p = { ...pb };
    if (pa && t <= 1) { p.x = lerp(pa.x, pb.x, t); p.y = lerp(pa.y, pb.y, t); p.angle = lerpAngle(pa.angle, pb.angle, t); }
    else if (!pa) { const back = Math.max(0, 1 - t) * (b.tick - a.tick || 3); p.x -= pb.vx * back; p.y -= pb.vy * back; }
    return p;
  });
  const loose = b.looseItems.map(it => ({ ...it, active: true, dropped: true, bob: 0 }));
  return { tick, soldiers, projectiles, on: b.fixedItems, loose, beacons: b.beacons.map(x => ({ ...x })) };
}

/** A soldier as the client shows it (the parts oldView works out). */
function shown(s) {
  const b = s.body, a = s.anim;
  return {
    x: b.x, y: b.y, prevX: s.prevX, prevY: s.prevY, vx: b.vx, vy: b.vy, crouching: b.crouching, onGround: b.onGround, jetting: b.jetting, hasJetpack: b.hasJetpack,
    fuel: b.fuel, padLaunch: b.padLaunch, rope: b.rope, alive: s.alive, aim: s.aim, facing: s.facing,
    health: s.health, armour: s.armour, current: s.current, frags: s.frags, deaths: s.deaths, points: s.points, level: s.level, lives: s.lives,
    cls: s.cls, streak: s.streak, jugger: s.jugger, respawnTimer: s.respawnTimer, spawnProtect: s.spawnProtect, burnTicks: s.burnTicks,
    kamikaze: !!s.kamikaze?.remote, run: a.run, flip: a.flip, land: a.land, recoil: a.recoil, swing: a.swing, idle: a.idle,
  };
}

test('everyone else is shown between snapshots exactly as before, refilling the same lists every frame', async () => {
  const busy = { input: g => ({ move: Math.sin(g.tick / 40) > 0 ? 1 : -1, jump: g.tick % 50 < 10, jumpPressed: g.tick % 50 === 0, fire: g.tick % 30 < 6, firePressed: g.tick % 30 === 0, aim: Math.sin(g.tick / 70), aimDist: 200 }) };
  const arm = g => { for (const s of g.soldiers) Object.assign(s.weapons, { Sheep: { ammo: 3 }, Bazooka: { ammo: 20 }, Grenade: { ammo: 10 } }); };
  const m = await onlineMatch({ players: 1, latency: 40, loss: 0.1, controllers: [busy], before: arm });
  const c = m.clients[0], rng = makeRng(3);
  const seen = { projectiles: 0, dropped: 0, beacons: 0, kamikaze: 0, mine: 0 };
  let lists = null;
  for (let i = 0; i < 1500; i++) {
    const g = m.game;
    // Now and then a dropped weapon, a spawn beacon (some of them the player's), or a soldier flying kamikaze.
    const alive = g.soldiers.filter(s => s.alive && s.isBot);
    if (g.tick % 40 === 0 && alive.length) {
      const s = alive[Math.floor(rng() * alive.length)], k = (g.tick / 40) % 3;
      if (k === 0) g.pickups.drop('Bazooka', 5, s.x, s.y - 10, rng() * 2 - 1);
      else if (k === 1) {
        const owner = rng() < 0.5 ? g.soldiers.find(o => o.remote) : s;
        if (g.beacons.length >= 6) g.beacons.shift();
        g.beacons.push({ id: ++g.nextId, owner: owner.id, team: owner.team, x: s.x, y: s.y + 10, vy: 0, hp: 60 + Math.floor(rng() * 40) });
      } else if (!s.kamikaze) s.kamikaze = { ticks: 30, dx: Math.cos(s.aim), dy: Math.sin(s.aim), cfg: WEAPONS.Kamikaze };
    }
    await m.step(1);
    if (!c.snaps.length || c.viewTick == null) continue;
    const view = c.game, old = oldView(c.snaps, c.viewTick, c.me);
    assert.equal(view.tick, old.tick);
    for (const s of view.soldiers) if (s !== c.me && old.soldiers.has(s.id)) assert.deepEqual(shown(s), old.soldiers.get(s.id), `${s.name} at tick ${view.tick}`);
    assert.deepEqual(view.projectiles.map(p => ({ ...p })), old.projectiles);
    assert.deepEqual(view.pickups.items.filter(it => it.dropped).map(it => ({ ...it })), old.loose);
    for (let k = 0; k < old.on.length && k < c.fixed.length; k++) assert.equal(c.fixed[k].active, old.on[k]);
    assert.deepEqual(view.beacons.map(x => ({ ...x })), old.beacons);
    seen.projectiles += view.projectiles.length;
    seen.dropped += old.loose.length;
    seen.beacons += view.beacons.length;
    seen.kamikaze += view.soldiers.filter(s => s.kamikaze && s !== c.me).length;
    if (c.me?.deployAt?.startsWith('b:')) seen.mine++;
    // (The game is given the same lists every frame, refilled: no new ones to collect.)
    if (lists) assert.ok(lists[0] === view.projectiles && lists[1] === view.pickups.items && lists[2] === view.beacons, 'same lists');
    lists = [view.projectiles, view.pickups.items, view.beacons];
  }
  for (const [what, n] of Object.entries(seen)) assert.ok(n > 0, `no ${what} seen`);
});

/**
 * A host run the way the page runs it (main.js): when updates are slow, a frame catches up at
 * most 2 of them and lets the rest go, so a slow host's ticks come late for good. Here its frames
 * slow to `slowFrameMs` from `slowFrom` to `slowTo` (37 ms: about 90% speed). One player draws at
 * `fps`; snapshots reach them 30 ms after they're sent, plus 0 to `jitter` ms more (none of those
 * sent in `drops`: [{ at, ms }]). Returns, for each frame drawn, the tick shown, the newest
 * snapshot's and the host's, and the same for the old clock (the earliest of the last 60
 * snapshots' arrivals, 7 ticks behind) on the very same snapshots.
 */
async function timedMatch({ seconds = 24, fps = 60, jitter = 40, slowFrom = 4000, slowTo = 16000, slowFrameMs = 37, seed = 11, drops = [] } = {}) {
  const { game, mapData, addBot } = botGame();
  let now = 0;
  const queue = []; // (in time order)
  const later = (ms, fn) => { const at = now + ms; let i = queue.length; while (i && queue[i - 1].at > at) i--; queue.splice(i, 0, { at, fn }); };
  const host = new NetHost({
    maxPlayers: 8, botCount: 3, addBot,
    matchInfo: () => ({ mode: 'ffa', fragLimit: 999, options: game.options, speed: DEFAULT_SPEED, map: { builtin: 'ssdm1.json' }, mapName: 'test' }),
  });
  game.addSoldier({ name: 'Host', isBot: false }, { input: () => ({ move: 0 }) });
  host.setGame(game);
  const [h, c] = memoryLinks({ latency: 30, schedule: (fn, ms) => later(ms, fn) });
  const rng = makeRng(seed), send = h.send.bind(h);
  h.send = (data, reliable) => {
    if (!(data instanceof Uint8Array)) return send(data, reliable);
    if (drops.some(d => now >= d.at && now < d.at + d.ms)) return true; // (lost)
    const copy = data.slice();
    later(30 + rng() * jitter, () => c.onmessage(copy, false));
    return true;
  };
  const client = new NetClient({ link: c, controller: { input: () => ({ move: 0, aim: 0, aimDist: 200 }) }, loadMap: async () => mapData, clock: () => now });
  host.addPlayer(h, 'Guest');
  const STEP = 1000 / 60, offsets = [], frames = [], old = [];
  const onSnapshot = client.onSnapshot.bind(client);
  client.onSnapshot = snap => {
    onSnapshot(snap);
    if (client.snaps[client.snaps.length - 1] !== snap) return;
    offsets.push(snap.arrival - snap.tick * STEP);
    if (offsets.length > 60) offsets.shift();
  };
  const slow = t => t >= slowFrom && t < slowTo;
  let hostAt = 0, hostLast = 0, acc = 0, tickAt = 0;
  for (let f = 0; f < seconds * fps; f++) {
    const frameAt = f * 1000 / fps;
    for (;;) {
      const next = Math.min(hostAt, tickAt, queue[0]?.at ?? Infinity);
      if (next > frameAt) break;
      now = next;
      if (queue[0]?.at === next) { queue.shift().fn(); await new Promise(r => setImmediate(r)); continue; }
      if (hostAt === next) {
        acc += next - hostLast; hostLast = next;
        for (let n = 0; acc >= STEP && !(n >= 2 && slow(next)); n++) { game.update(); host.afterTick(); acc -= STEP; }
        if (acc > STEP) acc = STEP;
        hostAt = next + (slow(next) ? slowFrameMs : STEP);
        continue;
      }
      client.tick(); tickAt += STEP;
    }
    now = frameAt;
    client.updateView(frameAt);
    if (client.viewTick == null) continue;
    const newest = client.snaps[client.snaps.length - 1].tick;
    frames.push({ at: frameAt, tick: client.viewTick, newest, host: game.tick });
    old.push({ at: frameAt, tick: Math.min((frameAt - Math.min(...offsets)) / STEP - 7, newest + 6), newest, host: game.tick });
  }
  host.close();
  return { frames, old, client };
}

/**
 * How smoothly the shown tick moved, from the second second on: steps back; each frame's step
 * against the time the frame took (1: the host's normal pace); and spells with no snapshot
 * ahead of the tick shown (the picture stops, or jumps when one comes).
 */
function smoothness(frames) {
  const STEP = 1000 / 60, steps = [];
  let back = 0, starved = 0, spell = 0, longest = 0;
  frames = frames.filter(f => f.at >= 1000);
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i], p = frames[i - 1];
    if (f.tick < p.tick) back++;
    // (What's drawn: the tick shown, or the newest snapshot if it's past that.)
    steps.push((Math.min(f.tick, f.newest) - Math.min(p.tick, p.newest)) / ((f.at - p.at) / STEP));
    if (f.tick >= f.newest) { starved++; spell += f.at - p.at; longest = Math.max(longest, spell); } else spell = 0;
  }
  const sorted = [...steps].sort((a, b) => a - b), q = k => sorted[Math.floor(k * (sorted.length - 1))];
  const changes = steps.slice(1).map((s, i) => Math.abs(s - steps[i]));
  return {
    back, starvedPct: +(100 * starved / frames.length).toFixed(2), longestSpellMs: Math.round(longest),
    stepP1: +q(0.01).toFixed(3), stepMedian: +q(0.5).toFixed(3), stepP99: +q(0.99).toFixed(3),
    stepChange: +(changes.reduce((a, b) => a + b, 0) / changes.length).toFixed(4),
  };
}

test('a slow host and late snapshots: others move on smoothly, never back, and rarely run out of snapshots', async t => {
  for (const fps of [60, 144]) {
    const { frames, old, client } = await timedMatch({ fps });
    const now = smoothness(frames), before = smoothness(old);
    t.diagnostic(`${fps} fps: new ${JSON.stringify(now)}; old clock on the same snapshots ${JSON.stringify(before)}; host's pace seen ${client.hostRate.toFixed(3)}, delay ${client.delay} ticks`);
    assert.equal(now.back, 0, 'never goes back');
    assert.ok(now.starvedPct < 1 && now.longestSpellMs <= 100, `rarely runs out of snapshots, and not for long (${now.starvedPct}%, ${now.longestSpellMs} ms)`);
    // Steps even: at the host's pace (0.9 while it's slow, 1 otherwise), give or take a tenth.
    assert.ok(now.stepP1 > 0.75 && now.stepP99 < 1.15 && now.stepChange < 0.01, `even steps (${now.stepP1} to ${now.stepP99}, changing ${now.stepChange} a frame)`);
    // (The old clock starved through the slow spell: the test is a hard one.)
    assert.ok(before.starvedPct > 20 && before.longestSpellMs > 5000, `the old clock starved (${before.starvedPct}%, ${before.longestSpellMs} ms)`);
  }
});

test('no snapshots for half a second (lost, the host carrying on): others are shown on time again at once, not seconds late', async t => {
  const gapAt = 6000, gap = 500;
  const { frames, old } = await timedMatch({ seconds: 12, slowFrom: Infinity, drops: [{ at: gapAt, ms: gap }] });
  // How many ticks behind the host what's drawn is: as usual (the second before the gap), and after it.
  const late = (list, from, to) => Math.max(...list.filter(f => f.at >= from && f.at < to).map(f => f.host - Math.min(f.tick, f.newest)));
  const usual = late(frames, gapAt - 1000, gapAt), after = late(frames, gapAt + gap + 150, gapAt + gap + 3000);
  t.diagnostic(`usual ${usual.toFixed(1)} ticks behind the host; after the gap ${after.toFixed(1)} (the old clock: ${late(old, gapAt - 1000, gapAt).toFixed(1)}, ${late(old, gapAt + gap + 150, gapAt + gap + 3000).toFixed(1)})`);
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].tick >= frames[i - 1].tick, 'never goes back');
  // (It jumps on, as the old clock did, rather than show everyone a quarter to half a second late for seconds.)
  assert.ok(after <= usual + 4, `shown ${after.toFixed(1)} ticks behind the host after the gap, ${usual.toFixed(1)} before`);
});

test('destructible maps online: a hole doesn\'t change the projectiles shown (kept and refilled every frame)', async () => {
  const { game, clients, step } = await onlineMatch({ players: 1, options: { destruction: true } });
  const c = clients[0];
  await step(30);
  // An arrow stuck in a block that can be blown up, and a mine lying on top of it.
  const b = game.map.solids.find(s => !s.hard && s.r - s.l >= 40 && s.b - s.t >= 20);
  const cx = (b.l + b.r) / 2, cy = (b.t + b.b) / 2;
  spawn(game, { kind: 'arrow', sprite: 'arrow', cfg: WEAPONS.Longbow, x: cx, y: cy, vx: 0, vy: 0, angle: 0.3, stuck: true, life: 3000, owner: null, weapon: 'Longbow' });
  spawn(game, { kind: 'placed', sprite: 'mine', cfg: WEAPONS.Mine, x: cx + 10, y: b.t - 4, vx: 0, vy: 0, owner: null, weapon: 'Mine', life: 3600, armed: 90, triggered: -1, onGround: false });
  await step(20);
  const list = c.game.projectiles;
  assert.ok(list.some(p => p.kind === 'arrow' && p.stuck) && list.some(p => p.kind === 'placed' && p.onGround), 'the client shows the stuck arrow and the mine on the ground');
  const copies = list.map(p => ({ ...p }));
  // The host blows a hole there: the client makes it as soon as it hears (before the next snapshot).
  assert.ok(c.game.map.overlap(cx - 2, cy - 2, cx + 2, cy + 2), 'solid there before');
  c.applyCarves(c.game.carves.length, [[cx, cy, 30]]);
  assert.ok(c.game.carves.length === 1 && !c.game.map.overlap(cx - 2, cy - 2, cx + 2, cy + 2), 'the hole went in');
  assert.equal(c.game.projectiles, list, 'the same list');
  // (Knocked down or killed here, it would stay so for whatever's shown in its place later.)
  assert.deepEqual(list.map(p => ({ ...p })), copies, 'what was shown is unchanged');
});

test('how far behind others are shown follows late snapshots, within 5 to 10 ticks: up at once, down a tick at a time', () => {
  // The client's clock alone, fed snapshots 20 a second (3 ticks apart) that take 30 ms plus up to `jitter` more.
  const c = Object.create(NetClient.prototype);
  c.step = 1000 / 60;
  c.resetClock();
  const rng = makeRng(4);
  let sent = 0, tick = 0, last = -1;
  const run = (seconds, jitter) => {
    const out = [];
    for (let i = 0; i < seconds * 20; i++) { sent += 50; tick += 3; out.push({ tick, at: sent + 30 + rng() * jitter }); }
    const delays = [];
    // (In the order they arrive; late ones that come after a newer one are left out, as onSnapshot does.)
    for (const s of out.sort((a, b) => a.at - b.at)) {
      if (s.tick <= last) continue;
      last = s.tick;
      c.timeSnapshot(s.tick, s.at);
      delays.push(c.delay);
    }
    return delays;
  };
  const steady = run(10, 2), jittery = run(10, 100), calm = run(30, 2);
  const all = [...steady, ...jittery, ...calm];
  assert.ok(all.every(d => d >= 5 && d <= 10), 'within 5 to 10 ticks');
  assert.equal(steady.at(-1), 6, 'a steady link: down to 6 (a snapshot apart, and 2 to spare)');
  assert.equal(Math.max(...jittery.slice(0, 40)), 10, 'late snapshots: up (to the most) within 2 seconds');
  // Back on a steady link: down a tick at a time, at most one every 5 seconds (100 snapshots).
  let at = -100;
  for (let i = 1; i < calm.length; i++) {
    if (calm[i] === calm[i - 1]) continue;
    assert.equal(calm[i], calm[i - 1] - 1, 'a tick at a time');
    assert.ok(i - at >= 100, 'not sooner than 5 seconds apart');
    at = i;
  }
  assert.equal(calm.at(-1), 6, 'and back to 6');
});
