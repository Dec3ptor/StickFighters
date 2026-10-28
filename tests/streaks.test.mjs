// Kill streaks: rewards (supply drop, sentry sheep, stampede, Juggernaut), callouts,
// shutdowns, awards, online sync, and the replay of the winning kill. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { WEAPONS } from '../web/src/weapons.js';
import { RULES, DEFAULT_SPEED } from '../web/src/config.js';
import { damage, explode } from '../web/src/combat.js';
import { REWARDS, REWARD_IDS, SENTRY_TICKS, JUGGER_TICKS, SUPPLY_LOCK, useReward, botReward, matchAwards, nextReward } from '../web/src/streaks.js';
import { Tape, tapeFx, ReplayPlayer } from '../web/src/replay.js';
import { encodeInputs, decodeInputs, encodeWorld, encodeSnapshot, decodeSnapshot, PROTOCOL } from '../web/src/net/protocol.js';
import { NetHost } from '../web/src/net/host.js';
import { NetClient } from '../web/src/net/client.js';
import { memoryLinks } from '../web/src/net/peer.js';
import { Input, PlayerController } from '../web/src/input.js';
import { makeRng } from '../web/src/util.js';
import { botMatch } from './helpers.mjs';

const FLOOR = [{ left: -1400, top: 0, right: 1400, bottom: 40 }];
const MAP = { name: 'arena', bounds: { left: -1400, top: -500, right: 1400, bottom: 200 }, spawns: [{ x: 0, y: -12, team: 1 }, { x: 600, y: -12, team: 2 }], items: [], platforms: FLOOR };

function arena({ mode = 'ffa', options = {}, effects = false, fragLimit = 999, platforms = FLOOR } = {}) {
  return new Game({ mapData: { ...MAP, platforms }, mode, effects, seed: 3, speed: DEFAULT_SPEED, options, fragLimit });
}

/** A soldier standing at (x, y) who does what `ctl` says (nothing, by default). */
function put(game, name, x, y = -12, { team = 0, ctl = () => ({ move: 0 }), bot = true } = {}) {
  const s = game.addSoldier({ name, isBot: bot, team }, { input: (g, me) => ctl(g, me) });
  s.spawnAt({ x, y }, 0);
  return s;
}

const run = (game, n, until = () => false) => { for (let i = 0; i < n && !until(); i++) game.update(); };

/** Kill `victim` as `killer` would with `weapon` (as damage() does when a hit kills). */
function frag(game, killer, victim, weapon = 'M4', opts = {}) {
  if (!victim.alive) victim.spawnAt({ x: victim.x || 300, y: -12 }, 0);
  game.kill(victim, killer, weapon, opts);
}

test('kills in a row earn rewards (where the mode has them), banked through death', () => {
  const game = arena();
  const a = put(game, 'A', 0), b = put(game, 'B', 300);
  assert.ok(game.streaksOn);
  for (let i = 0; i < 2; i++) frag(game, a, b);
  assert.deepEqual(a.bank, []);
  assert.equal(nextReward(a), 'supply');
  frag(game, a, b);
  assert.deepEqual(a.bank, ['supply'], 'three in a row: a supply drop');
  frag(game, a, b); frag(game, a, b);
  assert.deepEqual(a.bank, ['supply', 'sentry'], 'five: a sentry sheep');
  frag(game, a, b); frag(game, a, b);
  assert.deepEqual(a.bank, ['supply', 'sentry', 'stampede']);
  for (let i = 0; i < 3; i++) frag(game, a, b);
  assert.deepEqual(a.bank, ['supply', 'sentry', 'stampede', 'juggernaut']);
  assert.equal(a.streak, 10);
  assert.equal(nextReward(a), null);
  frag(game, b, a);
  assert.equal(a.streak, 0, 'dying ends the streak');
  assert.equal(a.bestStreak, 10);
  assert.equal(a.bank.length, 4, 'banked rewards are kept');
  for (const id of REWARD_IDS) assert.ok(REWARDS[id].name && REWARDS[id].kills > 0);
});

test('reward kills and kills after dying don\'t count toward the next reward; no rewards in gun game, OITC, Defuse or with the option off', () => {
  const game = arena();
  const a = put(game, 'A', 0), b = put(game, 'B', 300);
  frag(game, a, b, 'SentrySheep');
  frag(game, a, b, 'Stampede');
  assert.equal(a.streak, 0, 'sentry and stampede kills are frags, not streak');
  assert.equal(a.frags, 2);
  a.alive = false;
  frag(game, a, b, 'Bazooka', { explosive: true });
  assert.equal(a.streak, 0, 'a grenade landing after you died');
  for (const mode of ['gungame', 'oitc', 'defuse']) assert.equal(arena({ mode }).streaksOn, false, mode);
  for (const mode of ['ffa', 'team', 'koth', 'ctf', 'conquest', 'rush']) assert.equal(arena({ mode }).streaksOn, true, mode);
  const off = arena({ options: { streaks: false } });
  const c = put(off, 'C', 0), d = put(off, 'D', 300);
  for (let i = 0; i < 4; i++) frag(off, c, d);
  assert.equal(c.streak, 4, 'callouts and counts still run');
  assert.deepEqual(c.bank, [], 'but no rewards');
  assert.equal(useReward(off, c, 'supply'), false);
});

test('callouts: multi-kills close together, sprees, first blood (once), and a shutdown bonus', () => {
  const game = arena();
  const a = put(game, 'A', 0, -12, { bot: false }), b = put(game, 'B', 300), c = put(game, 'C', -300);
  const mine = () => game.callouts.filter(x => x.to === a.id).map(x => x.text);
  frag(game, a, b);
  assert.deepEqual(mine(), ['First blood']);
  assert.ok(game.callouts.some(x => x.to == null && x.about === a.id && /first blood/.test(x.text)), 'everyone hears of it');
  frag(game, a, c);
  assert.ok(mine().includes('Double kill'));
  frag(game, a, b);
  assert.ok(mine().includes('Triple kill') && mine().includes('Killing spree') && mine().includes('Supply Drop ready'));
  run(game, 600); // (later: not a multi-kill)
  game.callouts.length = 0;
  frag(game, a, c);
  assert.ok(!mine().some(t => /kill$/.test(t)), 'kills far apart aren\'t a multi-kill');
  frag(game, c, b);
  assert.ok(!mine().includes('First blood') && !game.callouts.some(x => x.text === 'First blood' && x.to !== a.id), 'first blood is once a match');
  run(game, 600);
  frag(game, a, b);
  assert.equal(a.streak, 5);
  assert.ok(mine().includes('Rampage'));
  assert.ok(game.callouts.some(x => x.to == null && /rampage/.test(x.text)), 'a rampage is news for everyone');
  const before = c.frags;
  frag(game, c, a);
  assert.equal(c.frags, before + 2, 'ending a 5-kill streak: a bonus frag');
  assert.ok(game.callouts.some(x => x.text.includes("ended A's 5-kill streak")));
  // (Bots get the rewards, but no messages.)
  assert.ok(!game.callouts.some(x => x.to === b.id || x.to === c.id));
  // The killer hears one sting (the biggest news), the kill confirmed.
  game.sounds.length = 0;
  frag(game, a, b);
  const toA = game.sounds.filter(x => x.to === a.id).map(x => x.name);
  assert.ok(toA.includes('killConfirm'));
});

test('Supply Drop: a crate with a strong weapon lands beside you, yours (and your team\'s) for a while', () => {
  const game = arena({ mode: 'team' });
  const a = put(game, 'A', 0, -12, { team: 1 }), mate = put(game, 'M', 400, -12, { team: 1 }), foe = put(game, 'F', 900, -12, { team: 2 });
  a.bank = ['supply'];
  assert.ok(useReward(game, a, 'supply'));
  assert.deepEqual(a.bank, []);
  const crate = game.pickups.items.find(it => it.streak);
  assert.ok(crate && WEAPONS[crate.weapon] && !WEAPONS[crate.weapon].hidden);
  assert.ok(Math.abs(crate.x - a.x) <= 70, 'beside the caller');
  run(game, 400, () => crate.landed);
  assert.ok(crate.landed && crate.y > -20, `landed on the floor (${crate.y})`);
  assert.ok(game.tick < 400, 'quickly');
  // An enemy standing on it can't take it yet; a teammate can.
  foe.body.x = crate.x; foe.body.y = -12;
  game.update();
  assert.ok(game.pickups.items.includes(crate) && !foe.weapons[crate.weapon], 'locked to the caller\'s team');
  mate.body.x = crate.x;
  game.update();
  assert.ok(mate.has(crate.weapon), 'a teammate can open it');
  assert.ok(!game.pickups.items.includes(crate));
  // Free-for-all: after the lock, anyone.
  const ffa = arena();
  const b = put(ffa, 'B', 0), c = put(ffa, 'C', 800);
  b.bank = ['supply'];
  useReward(ffa, b, 'supply');
  const box = ffa.pickups.items.find(it => it.streak);
  run(ffa, 300, () => box.landed);
  c.body.x = box.x;
  ffa.update();
  assert.ok(!c.has(box.weapon) || box.weapon === 'Platinum');
  run(ffa, SUPPLY_LOCK + 5);
  c.body.x = box.x; c.body.y = -12;
  ffa.update();
  assert.ok(c.has(box.weapon), 'anyone, once the lock runs out');
});

test('Sentry Sheep: shoots enemies near it (not teammates), for 20 seconds; armoured, but it can be wrecked', () => {
  const game = arena({ mode: 'team' });
  const a = put(game, 'A', 0, -12, { team: 1 });
  const mate = put(game, 'M', 150, -12, { team: 1 });
  const foe = put(game, 'F', 350, -12, { team: 2 });
  a.bank = ['sentry'];
  assert.ok(useReward(game, a, 'sentry'));
  const p = game.sentries[0];
  assert.ok(p && p.kind === 'sentry' && game.projectiles.includes(p));
  run(game, 900, () => !foe.alive);
  assert.equal(foe.alive, false, 'the enemy was shot');
  assert.equal(game.lastKill.weapon, 'SentrySheep');
  assert.equal(game.lastKill.killer, a.id, 'credited to its owner');
  assert.ok(mate.alive && mate.health === RULES.maxHealth, 'teammates are safe');
  assert.equal(a.streak, 0, 'its kills don\'t count toward the next reward');
  // Wrecked by explosions (its owner's don't hurt it).
  a.body.x = -600; mate.body.x = -700;
  explode(game, p.x, p.y - 6, { radius: 80, damage: 100, knock: 0 }, a, 'Bazooka');
  assert.ok(!p.dead && p.r === 100, 'its own side\'s blasts don\'t hurt it');
  explode(game, p.x, p.y - 6, { radius: 80, damage: 100, knock: 0 }, foe, 'Bazooka');
  assert.ok(p.r < 100 && !p.dead, 'armoured');
  explode(game, p.x, p.y - 6, { radius: 80, damage: 120, knock: 0 }, foe, 'Bazooka');
  assert.ok(p.dead, 'wrecked');
  game.update();
  assert.equal(game.sentries.length, 0);
  // Its time runs out.
  a.bank = ['sentry'];
  useReward(game, a, 'sentry');
  const q = game.sentries[0];
  run(game, SENTRY_TICKS + 5);
  assert.ok(q.dead && !game.projectiles.includes(q), 'gone after 20 s');
});

test('Sentry Sheep: hit by bullets; gone if its owner leaves; one each', () => {
  const game = arena();
  const a = put(game, 'A', 0), b = put(game, 'B', 900);
  a.bank = ['sentry'];
  useReward(game, a, 'sentry');
  const p = game.sentries[0];
  run(game, 40);
  // A bullet along the floor hits the sheep, not A behind it.
  const side = Math.sign(p.x - a.x) || 1;
  game.projectiles.push({ id: 99999, kind: 'bullet', sprite: 'bullet', x: p.x + side * 60, y: p.y - 8, px: 0, py: 0, vx: -side * 20, vy: 0, owner: b, weapon: 'M4', life: 30, age: 0, damage: 40, knock: 0 });
  run(game, 6);
  assert.ok(p.r < 100, 'the bullet hit it');
  assert.equal(a.health, RULES.maxHealth);
  a.bank = ['sentry'];
  useReward(game, a, 'sentry');
  game.update();
  assert.equal(game.sentries.filter(x => !x.dead).length, 1, 'a new one replaces the old');
  const q = game.sentries[0];
  game.removeSoldier(a);
  game.update();
  assert.ok(q.dead, 'its owner left: it goes too');
});

test('Sheep Stampede: a flock runs at the nearest enemies and blows up on them', () => {
  const game = arena();
  const a = put(game, 'A', 0), b = put(game, 'B', 520), c = put(game, 'C', -700);
  a.bank = ['stampede'];
  assert.ok(useReward(game, a, 'stampede'));
  const flock = game.projectiles.filter(p => p.weapon === 'Stampede');
  assert.equal(flock.length, WEAPONS.Stampede.count);
  assert.ok(flock.some(p => p.dir > 0) && flock.some(p => p.dir < 0), 'after both enemies');
  const killed = new Set();
  const kill = game.kill.bind(game);
  game.kill = (v, k, w, o) => { if (k === a && w === 'Stampede') killed.add(v); return kill(v, k, w, o); };
  run(game, 900, () => killed.size === 2);
  assert.ok(killed.has(b) && killed.has(c), 'both blown up');
  assert.ok(a.frags >= 2);
  assert.ok(a.alive, 'they don\'t go off on their owner');
});

test('Juggernaut: a minigun that never runs out, a fraction of the damage, no knockback, 30 seconds', () => {
  const game = arena();
  const a = put(game, 'A', 0), b = put(game, 'B', 300);
  a.bank = ['juggernaut'];
  assert.ok(useReward(game, a, 'juggernaut'));
  assert.equal(a.jugger, JUGGER_TICKS);
  assert.equal(a.current, 'JuggerGun');
  assert.equal(a.weapons.JuggerGun.ammo, Infinity);
  damage(game, a, 50, b, 'M4', { dirX: 1, dirY: 0, knock: 5 });
  assert.ok(Math.abs(a.health + a.armour * 0 - (RULES.maxHealth - 50 * RULES.juggerDamage * (1 - RULES.armourAbsorb))) < 0.01, `took ${RULES.maxHealth - a.health}`);
  assert.equal(a.body.vx, 0, 'no knockback from hits');
  explode(game, a.x - 20, a.y - 6, { radius: 80, damage: 30, knock: 15 }, b, 'Bazooka');
  assert.equal(a.body.vx, 0, 'or blasts');
  // It keeps the minigun in hand.
  a.weapons.M4 = { ammo: 30 };
  game.controllers.set(a, { input: () => ({ move: 0, switchTo: 'M4' }) });
  game.update();
  assert.equal(a.current, 'JuggerGun');
  run(game, JUGGER_TICKS);
  assert.equal(a.jugger, 0, 'it wears off');
  assert.ok(!a.weapons.JuggerGun && a.current !== 'JuggerGun');
  // Dying ends it too (and the minigun isn't dropped).
  a.bank = ['juggernaut'];
  useReward(game, a, 'juggernaut');
  frag(game, b, a, 'Bazooka');
  assert.equal(a.jugger, 0);
  assert.ok(!game.pickups.items.some(it => it.weapon === 'JuggerGun'));
});

test('X uses the picked reward (Z picks another); the key press reaches the game', () => {
  globalThis.window ??= { addEventListener() {} };
  globalThis.document ??= { addEventListener() {}, body: { classList: { contains: () => false } } };
  const game = arena();
  const input = new Input({ addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) });
  const view = { screenToWorld: () => ({ x: 100, y: 0 }) };
  const ctl = new PlayerController(input, view);
  const a = game.addSoldier({ name: 'A', isBot: false }, ctl);
  a.spawnAt({ x: 0, y: -12 }, 0);
  a.bank = ['supply', 'sentry'];
  assert.equal(ctl.pickedReward(a), 'sentry', 'the newest, to start with');
  input.queue.push('KeyZ');
  ctl.input(game, a);
  assert.equal(ctl.pickedReward(a), 'supply');
  input.queue.push('KeyX');
  const inp = ctl.input(game, a);
  assert.equal(inp.streak, 'supply');
  game.controllers.set(a, { input: () => inp });
  game.update();
  assert.deepEqual(a.bank, ['sentry']);
  assert.ok(game.pickups.items.some(it => it.streak));
});

test('bots use their rewards (in a bot match, and the right one at the right time)', () => {
  const game = arena();
  const a = put(game, 'A', 0), b = put(game, 'B', 400);
  run(game, 10);
  a.bank = ['supply', 'juggernaut'];
  a.bankedAt = game.tick - 100;
  assert.equal(botReward(game, a, { target: null }), 'juggernaut', 'the Juggernaut straight away');
  a.bank = ['sentry'];
  a.bankedAt = game.tick;
  assert.equal(botReward(game, a, { target: null }), null, 'a sentry: not with nobody about');
  assert.equal(botReward(game, a, { target: b }), 'sentry', 'in a fight');
  a.bank = ['stampede'];
  assert.equal(botReward(game, a, {}), 'stampede', 'an enemy not far off along the ground');
  b.alive = false;
  assert.equal(botReward(game, a, {}), null);

  const { game: match } = botMatch('ssdm1.json', { bots: 8, seed: 5, difficulty: 'hard' });
  let used = 0;
  const orig = match.pickups.items.push.bind(match.pickups.items);
  for (let t = 0; t < 12000; t++) {
    const before = match.soldiers.reduce((n, s) => n + s.bank.length, 0);
    match.update();
    const after = match.soldiers.reduce((n, s) => n + s.bank.length, 0);
    if (after < before) used += before - after;
  }
  void orig;
  assert.ok(used >= 2, `bots used ${used} rewards`);
});

test('awards at the end, and the kill that won it', () => {
  const game = arena({ fragLimit: 6 });
  const a = put(game, 'A', 0), b = put(game, 'B', 300), c = put(game, 'C', -300);
  frag(game, b, c, 'SR', { headshot: true });
  frag(game, b, a, 'SR', { headshot: true });
  frag(game, c, a, 'Bazooka', { explosive: true });
  a.spawnAt({ x: 0, y: -12 }, 0);
  for (let i = 0; i < 6; i++) frag(game, a, i % 2 ? b : c, 'M4');
  assert.ok(game.over && game.winner.soldier === a);
  assert.equal(game.finalKill.killer, a.id, 'the winning kill');
  assert.equal(game.finalKill.tick, game.tick);
  const aw = Object.fromEntries(game.awards.map(x => [x.id, x]));
  assert.equal(aw.mvp.soldier, a.id);
  assert.equal(aw.streak.soldier, a.id);
  assert.match(aw.streak.text, /6 kills in a row/);
  assert.equal(aw.headshots.soldier, b.id);
  assert.equal(aw.demolition.soldier, c.id);
  assert.deepEqual(matchAwards(game).map(x => x.id), ['mvp', 'streak', 'headshots', 'demolition']);
  // Won without a kill (the hill): no winning kill to replay.
  const koth = arena({ mode: 'koth' });
  const k = put(koth, 'K', 0, -12, { team: 1 });
  const j = put(koth, 'J', 300, -12, { team: 2 });
  frag(koth, k, j);
  run(koth, 5);
  koth.winner = null;
  koth.rules.winner = () => ({ team: 1 });
  koth.checkWin();
  assert.ok(koth.over && koth.finalKill === null && koth.awards.length >= 1);
});

test('online: the reward key, Juggernauts, streaks, banked rewards, sentries, supply crates and the results travel', () => {
  const [inp] = decodeInputs(encodeInputs([{ seq: 3, streak: 'stampede', move: 1 }, { seq: 4 }]));
  assert.equal(inp.streak, 'stampede');
  assert.equal(decodeInputs(encodeInputs([{ seq: 5 }]))[0].streak, null);
  assert.ok(PROTOCOL >= 13);
  const game = arena({ mode: 'team' });
  const a = put(game, 'A', 0, -12, { team: 1 }), b = put(game, 'B', 400, -12, { team: 2 });
  a.bank = ['sentry', 'juggernaut', 'supply'];
  useReward(game, a, 'juggernaut');
  useReward(game, a, 'sentry');
  useReward(game, a, 'supply');
  a.streak = 7;
  a.bank = ['stampede'];
  game.update();
  const snap = decodeSnapshot(encodeSnapshot(game, a, 1, encodeWorld(game)));
  const sa = snap.soldiers.find(s => s.id === a.id), sb = snap.soldiers.find(s => s.id === b.id);
  assert.equal(sa.jugger, 1);
  assert.equal(sb.jugger, 0);
  assert.equal(sa.streak, 7);
  assert.ok(snap.me.jugger > JUGGER_TICKS - 5);
  assert.deepEqual(snap.me.bank, ['stampede']);
  const sentry = snap.projectiles.find(p => p.kind === 'sentry');
  assert.ok(sentry && sentry.sprite === 'sentry' && sentry.team === 1 && sentry.r === 100);
  assert.ok(snap.looseItems.some(it => it.type === 'crate' && it.streak && it.team === 1));
  assert.equal(snap.end, null, 'no results till it\'s over');
  game.over = true;
  game.awards = [{ id: 'mvp', title: 'MVP', soldier: a.id, name: 'A', team: 1, text: '3 frags' }];
  game.finalKill = { tick: 9, killer: a.id, victim: b.id, weapon: 'M4', headshot: true, x: 1, y: 2 };
  const end = decodeSnapshot(encodeSnapshot(game, a, 1, encodeWorld(game))).end;
  assert.deepEqual(end.awards, game.awards);
  assert.deepEqual(end.finalKill, game.finalKill);
});

/** A host with players over in-memory links on a simulated clock (as in net.test.mjs). */
async function online({ players = 1, mode = 'ffa', controllers = [] } = {}) {
  const mapData = { ...MAP };
  const game = new Game({ mapData, mode, fragLimit: 999, seed: 5, effects: true, speed: DEFAULT_SPEED });
  let now = 0;
  const queue = [];
  const schedule = (fn, ms) => queue.push({ at: now + ms, fn });
  const host = new NetHost({ maxPlayers: 8, botCount: 0, matchInfo: () => ({ mode, fragLimit: 999, options: game.options, speed: DEFAULT_SPEED, map: { builtin: 'x' } }), addBot() {} });
  const me = game.addSoldier({ name: 'Host', isBot: false }, { input: () => ({ move: 0 }) });
  host.setGame(game);
  const clients = [];
  for (let i = 0; i < players; i++) {
    const [h, c] = memoryLinks({ schedule, rng: makeRng(9 + i) });
    clients.push(new NetClient({ link: c, controller: controllers[i] || { input: () => ({ move: 0 }) }, loadMap: async () => mapData, clock: () => now }));
    host.addPlayer(h, `Guest${i}`);
  }
  const pump = async () => {
    for (let k = 0; k < 4; k++) {
      await new Promise(r => setImmediate(r));
      for (const q of queue.filter(x => x.at <= now)) { queue.splice(queue.indexOf(q), 1); q.fn(); }
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
  return { game, host, clients, step, me };
}

test('online: callouts reach the right players, a player\'s X press uses one reward, and the replay tape fills', async () => {
  let press = 0;
  const ctl = { input: (g, s) => ({ move: 0, streak: press-- > 0 ? 'supply' : null }) };
  const { game, clients, step, me } = await online({ players: 2, controllers: [ctl] });
  await step(150);
  const [c1, c2] = clients;
  const s1 = game.soldiers.find(s => s.id === c1.me.id), s2 = game.soldiers.find(s => s.id === c2.me.id);
  assert.ok(s1.alive && s2.alive);
  for (let i = 0; i < 3; i++) { s2.alive || s2.spawnAt({ x: 500, y: -12 }, 0); game.kill(s2, s1, 'M4'); }
  await step(30);
  const mine = c1.game.callouts.filter(c => c.to === c1.me.id).map(c => c.text);
  assert.ok(mine.includes('First blood') && mine.includes('Supply Drop ready'), mine.join(', '));
  assert.ok(!c2.game.callouts.some(c => c.to != null), 'nothing personal reaches the other player');
  assert.ok(c2.game.callouts.some(c => c.to == null && /first blood/.test(c.text)), 'but the news does');
  assert.deepEqual(c1.me.bank, ['supply'], 'the bank reaches its player');
  await step(RULES.respawnTicks);
  press = 1;
  await step(20);
  assert.deepEqual(s1.bank, [], 'used once');
  assert.equal(game.pickups.items.filter(it => it.streak).length, 1);
  assert.ok(c1.tape.frames.length > 50 && c1.tape.events.length > 0, 'the replay tape fills');
  void me;
});

test('the replay of the winning kill: recorded as it happens, played slowly on a copy of the game', () => {
  const game = arena({ fragLimit: 3, effects: true });
  game.tape = new Tape();
  game.fx = tapeFx(game.fx, game.tape);
  // (The winning shot is fired during an update, as in a match.)
  let shoot = false;
  const a = put(game, 'A', -200, -12, {
    ctl: (g, me) => { if (shoot) { shoot = false; damage(g, b, 500, me, 'Shotgun', { dirX: 1, dirY: 0, knock: 1 }); } return { move: 1 }; },
  });
  const b = put(game, 'B', 300);
  run(game, 60);
  frag(game, a, b); frag(game, a, b);
  run(game, 300);
  b.body.x = a.x + 200;
  game.update();
  assert.ok(b.alive);
  shoot = true;
  game.update();
  assert.ok(game.over && game.finalKill?.victim === b.id);
  const startX = a.x;
  const rp = new ReplayPlayer(game, game.tape, game.finalKill);
  assert.ok(rp.ok, 'the tape covers it');
  const ka = rp.killer, kb = rp.victim;
  assert.ok(ka !== a && ka.id === a.id, 'its own copies of the soldiers');
  assert.ok(kb.alive, 'the victim is alive at the start');
  assert.ok(ka.x < startX - 10, 'the killer a little way back');
  let frames = 0, slowAt = null;
  while (!rp.update(1000 / 60) && frames < 5000) { frames++; if (rp.slow && slowAt == null) slowAt = frames; }
  assert.ok(frames > 150 && frames < 800, `${frames} frames (${(frames / 60).toFixed(1)} s)`);
  assert.ok(slowAt != null, 'slow motion around the kill');
  assert.equal(kb.alive, false, 'the victim falls');
  assert.ok(rp.fx.parts.length > 0 || rp.events.some(e => e.fx.some(f => f[0] === 'gibs')), 'the gibs are in it');
  assert.equal(a.x, startX, 'the real game is untouched');
  assert.equal(game.soldiers[0], a);
  // Not covered (no tape, or a kill from before it): no replay.
  assert.equal(new ReplayPlayer(game, new Tape(), game.finalKill).ok, false);
  assert.equal(new ReplayPlayer(game, game.tape, { ...game.finalKill, tick: 5 }).ok, false);
});

test('online: the host\'s own kill sounds and stings stay on the host\'s screen (free-for-all: soldier 0 isn\'t team 0)', async () => {
  const { game, clients, step, me } = await online({ players: 1 });
  await step(150);
  const c = clients[0];
  assert.equal(me.id, 0);
  const victim = game.soldiers.find(s => s.id === c.me.id);
  c.game.sounds.length = 0;
  for (let i = 0; i < 3; i++) { if (!victim.alive) victim.spawnAt({ x: 500, y: -12 }, 0); game.kill(victim, me, 'M4'); }
  assert.ok(game.sounds.some(x => x.name === 'killConfirm' && x.to === 0), 'the host hears it');
  await step(20);
  const heard = c.game.sounds.map(x => x.name);
  assert.ok(!heard.includes('killConfirm') && !heard.includes('firstBlood') && !heard.includes('tripleKill'), `the player heard ${heard.join(', ')}`);
});

test('a sentry and a stampede go with a player who sits out or leaves; sheep let go of a soldier who left', () => {
  // Spectating: no kills (or a win) for someone sitting out.
  const game = arena({ fragLimit: 1 });
  const a = put(game, 'A', 0, -12, { bot: false }), b = put(game, 'B', 250);
  a.bank = ['sentry', 'stampede'];
  assert.ok(useReward(game, a, 'sentry') && useReward(game, a, 'stampede'));
  run(game, 5);
  game.spectate(a, true);
  run(game, 900);
  assert.equal(a.frags, 0);
  assert.ok(b.alive && !game.over);
  assert.equal(game.sentries.length, 0, 'the sentry folded up');
  assert.ok(!game.projectiles.some(p => p.weapon === 'Stampede'), 'the sheep went');
  // Leaving a team game: the flock doesn't hunt their own side.
  const t = arena({ mode: 'team' });
  const o = put(t, 'O', 0, -12, { team: 1 }), mate = put(t, 'M', 300, -12, { team: 1 }), foe = put(t, 'F', 1300, -12, { team: 2 });
  o.bank = ['stampede'];
  assert.ok(useReward(t, o, 'stampede'));
  run(t, 30);
  t.removeSoldier(o);
  run(t, 900);
  assert.ok(mate.alive && mate.health === mate.maxHealth && t.teamScore[1] === 0, 'the teammate is left alone');
  assert.ok(foe.alive);
  // Sheep after someone who left go after someone else.
  const f = arena();
  const s = put(f, 'S', 0), gone = put(f, 'G', 900), c = put(f, 'C', -900);
  s.bank = ['stampede'];
  assert.ok(useReward(f, s, 'stampede'));
  run(f, 60);
  assert.ok(f.projectiles.some(p => p.target === gone));
  f.removeSoldier(gone);
  assert.ok(!f.projectiles.some(p => p.target === gone));
  run(f, 600, () => !c.alive);
  assert.equal(c.alive, false, 'the flock found the one left');
});

test('Supply Drop: none in the air over a pit (it stays banked); one beside you from a high jump', () => {
  const pit = [{ left: -1400, top: 0, right: -100, bottom: 40 }, { left: 100, top: 0, right: 1400, bottom: 40 }];
  const game = arena({ platforms: pit });
  const a = put(game, 'A', 0, -120, { bot: false });
  a.bank = ['supply'];
  assert.equal(useReward(game, a, 'supply'), false);
  assert.deepEqual(a.bank, ['supply']);
  assert.ok(!game.pickups.items.some(it => it.streak));
  assert.ok(game.notes.some(n => n.to === a.id && /No floor/.test(n.text)));
  const high = arena();
  const b = put(high, 'B', 0, -300);
  b.bank = ['supply'];
  assert.ok(useReward(high, b, 'supply'), 'a floor 300 px below is near enough');
});

test('the replay: skipping it plays nothing that was left; the end of the match isn\'t heard twice; huge online games aren\'t taped', () => {
  const game = arena({ fragLimit: 1, effects: true });
  game.tape = new Tape();
  game.fx = tapeFx(game.fx, game.tape);
  let shoot = false;
  const a = put(game, 'A', -200, -12, {
    ctl: (g, me) => { if (shoot) { shoot = false; damage(g, b, 500, me, 'Shotgun', { dirX: 1, dirY: 0, knock: 1 }); } return { move: 1, fire: g.tick % 20 === 0 }; },
  });
  const b = put(game, 'B', 300);
  run(game, 240);
  b.body.x = a.x + 200;
  game.update();
  shoot = true;
  game.update();
  assert.ok(game.over && game.finalKill);
  // Played through: everything but the stings of the end of the match.
  const full = new ReplayPlayer(game, game.tape, game.finalKill);
  const heard = [];
  while (!full.update(1000 / 60)) { heard.push(...full.view.sounds.map(s => s.name)); full.view.sounds.length = 0; }
  heard.push(...full.view.sounds.map(s => s.name));
  assert.ok(heard.length > 0);
  assert.ok(!heard.includes('gameover') && !heard.includes('firstBlood'), heard.join());
  // Skipped a few frames in: the rest isn't all played at once.
  const rp = new ReplayPlayer(game, game.tape, game.finalKill);
  for (let i = 0; i < 3; i++) rp.update(1000 / 60);
  rp.view.sounds.length = 0;
  const parts = rp.fx.parts.length;
  rp.finish();
  assert.equal(rp.update(1000 / 60), true);
  assert.equal(rp.view.sounds.length, 0, 'no burst of sounds');
  assert.ok(rp.fx.parts.length <= parts, 'nor of effects');
  // Online, a game too big to tape (as on the host).
  const tape = new Tape();
  tape.addSnapshot({ tick: 10, soldiers: Array.from({ length: 200 }, (_, id) => ({ id })), projectiles: [] });
  tape.addEvents({ tick: 10, s: [['pistol', 0, 0]], fx: [] });
  assert.ok(tape.off && tape.frames.length === 0 && tape.events.length === 0);
});

test('Defuse: the winning kill is the one that won the last round, not one after it or before a round won on time', () => {
  const ARENA = {
    name: 'defuse arena', bounds: { left: -1300, top: -500, right: 1300, bottom: 200 },
    platforms: [{ left: -1300, top: 0, right: 1300, bottom: 40 }],
    spawns: [{ x: -1150, y: -12, team: 1 }, { x: -1100, y: -12, team: 1 }, { x: 1150, y: -12, team: 2 }, { x: 1100, y: -12, team: 2 }],
    items: [],
    objectives: [{ type: 'site', label: 'A', left: -400, top: -110, right: -200, bottom: 0 }, { type: 'site', label: 'B', left: 200, top: -110, right: 400, bottom: 0 }],
  };
  const until = (game, phase) => { for (let i = 0; i < 12000 && game.modeState.phase !== phase && !game.over; i++) game.update(); };
  const setup = () => {
    const game = new Game({ mapData: ARENA, mode: 'defuse', fragLimit: 7, effects: false, seed: 4, speed: DEFAULT_SPEED });
    const sides = ['T1', 'T2', 'C1', 'C2'].map((name, i) => game.addSoldier({ name, isBot: false, team: i < 2 ? 1 : 2 }, { input: () => ({ move: 0, aim: 0, aimDist: 200 }) }));
    until(game, 'freeze');
    return { game, sides };
  };
  // Won by elimination; a kill in the moments after the round doesn't take its place.
  {
    const { game, sides: [t1, , c1, c2] } = setup();
    game.teamScore[1] = game.rules.needed(game) - 1;
    until(game, 'live');
    game.kill(c1, t1, 'AK47');
    game.kill(c2, t1, 'AK47');
    const k = game.tick;
    game.update();
    for (let i = 0; i < 60; i++) game.update();
    c1.spawnAt({ x: 0, y: -12 }, 0);
    t1.spawnAt({ x: 100, y: -12 }, 0);
    game.kill(t1, c1, 'Beretta');
    for (let i = 0; i < 400 && !game.over; i++) game.update();
    assert.ok(game.over);
    assert.equal(game.finalKill?.tick, k);
    assert.equal(game.finalKill.killer, t1.id);
    assert.equal(game.finalKill.victim, c2.id);
  }
  // Won on time: no winning kill (so no replay).
  {
    const { game, sides: [t1, , c1] } = setup();
    game.teamScore[2] = game.rules.needed(game) - 1;
    until(game, 'live');
    while (game.modeState.timer > 120) game.update();
    game.kill(c1, t1, 'AK47');
    for (let i = 0; i < 1000 && !game.over; i++) game.update();
    assert.ok(game.over && game.winner?.team === 2);
    assert.equal(game.finalKill, null);
  }
});
