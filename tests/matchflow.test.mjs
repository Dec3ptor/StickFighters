// How a match runs from start to finish: a time limit (whoever's ahead wins when it's up; level,
// sudden death), a word when someone's a score from winning, a frag limit that goes by how many
// are playing; and hosting: players who've gone away sat out till they're back, sides shuffled or
// swapped for the next match, someone sent away kept out.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED, TICK_RATE } from '../web/src/config.js';
import { NetHost, IDLE_TICKS } from '../web/src/net/host.js';
import { encodeInputs, decodeInputs } from '../web/src/net/protocol.js';
import { MODES } from '../web/src/modes.js';
import { CHOICE_KEYS } from '../web/src/gamedefaults.js';

/** A flat floor with room either side. */
const FLAT = { name: 'flat', bounds: { left: -600, top: -600, right: 1600, bottom: 200 }, items: [],
  spawns: [{ x: 0, y: -12, team: 1 }, { x: 400, y: -12, team: 2 }, { x: 800, y: -12, team: 1 }, { x: 1200, y: -12, team: 2 }], platforms: [{ left: -600, top: 0, right: 1600, bottom: 40 }] };
const STILL = { input: () => ({ move: 0 }) };

/** A match of `mode` with a time limit (seconds), and `n` players standing still. */
function match(mode, timeLimit, n = 2, extra = {}) {
  const g = new Game({ mapData: FLAT, effects: false, seed: 3, speed: DEFAULT_SPEED, mode, fragLimit: 20, timeLimit, ...extra });
  const all = [];
  for (let i = 0; i < n; i++) all.push(g.addSoldier({ name: `S${i}`, isBot: false, team: g.rules.teams ? 1 + (i % 2) : 0 }, STILL));
  return { g, all };
}
const run = (g, n) => { for (let i = 0; i < n && !g.over; i++) g.update(); };
const words = g => g.callouts.map(c => c.text);

test('time\'s up: whoever is ahead wins (a free-for-all, a team game)', () => {
  const { g, all } = match('ffa', 30);
  assert.equal(g.timeLimit, 30 * TICK_RATE);
  all[1].frags = 3; all[0].frags = 1;
  run(g, 30 * TICK_RATE - 2);
  assert.ok(!g.over, 'not before it\'s up');
  assert.ok(g.timeLeft() > 0);
  run(g, 5);
  assert.ok(g.over, 'over when it is');
  assert.equal(g.winner.soldier, all[1]);

  const t = match('team', 30, 4);
  t.g.teamScore[2] = 7; t.g.teamScore[1] = 4;
  run(t.g, 30 * TICK_RATE + 5);
  assert.ok(t.g.over);
  assert.equal(t.g.winner.team, 2);
});

test('time\'s up with the scores level: sudden death, and the next score wins', () => {
  const { g } = match('team', 20, 4);
  g.teamScore[1] = g.teamScore[2] = 5;
  run(g, 20 * TICK_RATE + 30);
  assert.ok(!g.over, 'not over while it\'s level');
  assert.ok(g.suddenDeath);
  assert.equal(g.timeLeft(), 0);
  assert.equal(words(g).filter(w => w === 'Sudden death').length, 1, 'said once');
  g.teamScore[1]++;
  run(g, 2);
  assert.ok(g.over);
  assert.equal(g.winner.team, 1);

  // (A free-for-all the same: nobody ahead, nobody wins yet.)
  const f = match('ffa', 20, 3);
  run(f.g, 20 * TICK_RATE + 30);
  assert.ok(!f.g.over && f.g.suddenDeath);
  f.all[2].frags = 1;
  run(f.g, 2);
  assert.equal(f.g.winner.soldier, f.all[2]);
});

test('the clock says when it\'s running out; no limit, no clock; a world has none', () => {
  const { g } = match('ffa', 120);
  run(g, 60 * TICK_RATE + 1);
  assert.ok(words(g).includes('One minute left'));
  run(g, 50 * TICK_RATE);
  assert.ok(words(g).includes('Ten seconds left'));
  const none = match('ffa', 0);
  assert.equal(none.g.timeLimit, 0);
  assert.equal(none.g.timeLeft(), null);
  none.all[0].frags = 1;
  run(none.g, 400);
  assert.ok(!none.g.over);
});

test('Rush: the defenders win by holding out; Defuse keeps its own rounds\' clocks', () => {
  assert.deepEqual(MODES.rush.timeUp({}), { team: 2 });
  assert.ok(MODES.defuse.noClock);
  const d = new Game({ mapData: FLAT, effects: false, seed: 3, speed: DEFAULT_SPEED, mode: 'defuse', timeLimit: 600 });
  assert.equal(d.timeLimit, 0, 'no match clock in Defuse');
});

test('match point: everyone\'s told once when someone\'s a score from winning', () => {
  const { g, all } = match('ffa', 0);
  all[0].frags = 18;
  g.checkWin();
  assert.ok(!words(g).includes('Match point'));
  all[0].frags = 19;
  g.checkWin(); g.checkWin();
  assert.equal(words(g).filter(w => w === 'Match point').length, 1);
  assert.match(g.callouts.find(c => c.text === 'Match point').sub, /S0 needs one more/);
  // (Another getting there is told too.)
  all[1].frags = 19;
  g.checkWin();
  assert.equal(words(g).filter(w => w === 'Match point').length, 2);
  all[1].frags = 20;
  g.checkWin();
  assert.ok(g.over);

  const t = match('team', 0, 4);
  t.g.teamScore[2] = 19;
  t.g.checkWin(); t.g.checkWin();
  assert.equal(words(t.g).filter(w => w === 'Match point').length, 1);
  assert.match(t.g.callouts.find(c => c.text === 'Match point').sub, /Red needs one more/);
});

test('the time limit, and what the next match is played on, are among the setup\'s saved choices', () => {
  for (const k of ['timeLimit', 'rotate', 'shuffle']) assert.ok(CHOICE_KEYS.includes(k), k);
});

// ---- Hosting -------------------------------------------------------------------------------------------

/** A link that goes nowhere (what's sent kept). */
const fakeLink = () => ({ sent: [], closed: false, send(d) { this.sent.push(d); return true; }, close() { this.closed = true; this.onclose?.(); } });
/** A game hosted with bots, the host's and each guest's input in `pads` (by name). */
function hosted({ mode = 'team', botCount = 4, maxPlayers = 6, guests = 2, idleTicks } = {}) {
  const g = new Game({ mapData: FLAT, effects: false, seed: 9, speed: DEFAULT_SPEED, mode, fragLimit: 999 });
  const addBot = game => {
    const n = t => game.soldiers.filter(s => s.team === t && !s.spectating).length;
    game.addSoldier({ name: `Bot${game.soldiers.length}`, isBot: true, team: game.rules.teams ? (n(1) <= n(2) ? 1 : 2) : 0 }, STILL);
  };
  const host = new NetHost({ maxPlayers, botCount, addBot, idleTicks, matchInfo: () => ({ mode, fragLimit: 999, options: g.options, speed: DEFAULT_SPEED, map: { builtin: 'x' }, mapName: 'flat' }) });
  const pad = { move: 0 };
  const me = g.addSoldier({ name: 'Host', isBot: false, team: g.rules.teams ? 1 : 0 }, { input: () => ({ ...pad }) });
  host.setGame(g);
  const links = [], ps = [];
  for (let i = 0; i < guests; i++) { links.push(fakeLink()); ps.push(host.addPlayer(links[i], `Guest${i}`, `key${i}`)); }
  return { g, host, me, pad, links, ps };
}
/** One update of a hosted game, as main.js runs it. */
const step = (h, n = 1) => { for (let i = 0; i < n; i++) { h.g.update(); h.host.afterTick(); } };
const chats = link => link.sent.filter(m => m && m.t === 'chat').map(m => m.text);
let seq = 0;
/** A guest's input arriving at the host. */
const send = (link, inp) => link.onmessage(encodeInputs([{ move: 0, aim: 0, aimDist: 200, ...inp, seq: ++seq + 1e6 }]), false);

test('whether a player\'s there travels with their input (and old inputs read as not said)', () => {
  const [a, b] = decodeInputs(encodeInputs([{ seq: 1, move: 0, act: true }, { seq: 2, move: 1 }]));
  assert.equal(a.act, true);
  assert.equal(b.act, false);
});

test('a player who does nothing for a minute sits out, a bot in their place; back the moment they do anything', () => {
  const h = hosted({ guests: 2 });
  const [idle, busy] = h.ps;
  assert.equal(IDLE_TICKS, 60 * TICK_RATE);
  // (One guest keeps playing; the other, and the host, do nothing. The host's pad changes: they're there.)
  let k = 0;
  const tick = n => { for (let i = 0; i < n; i++) { k++; if (k % 20 === 0) { send(h.links[1], { move: k % 40 ? 1 : -1 }); h.pad.move = k % 40 ? 1 : 0; } step(h); } };
  tick(IDLE_TICKS - 40);
  assert.ok(!idle.soldier.spectating, 'not before the minute\'s up');
  const before = h.g.soldiers.filter(s => s.isBot).length;
  tick(120);
  assert.ok(idle.soldier.spectating && idle.soldier.afk, 'sat out');
  assert.ok(idle.afk);
  assert.ok(!busy.soldier.spectating && !h.me.spectating, 'those playing left alone');
  assert.ok(chats(h.links[1]).some(t => /Guest0 is away/.test(t)), 'everyone told');
  assert.equal(h.g.soldiers.filter(s => s.isBot).length, before + 1, 'a bot in their place');
  const [a, b] = [h.g.teamSize(1), h.g.teamSize(2)];
  assert.ok(Math.abs(a - b) <= 1, `sides even (${a} v ${b})`);
  // (Shot at while away: their aim moving with the camera isn't them.)
  send(h.links[0], { aim: 1.2 });
  tick(60);
  assert.ok(idle.soldier.spectating, 'an aim that moved on its own isn\'t them back');
  // (A key, or the mouse: back.)
  send(h.links[0], { act: true });
  tick(45);
  assert.ok(!idle.soldier.spectating && !idle.soldier.afk && !idle.afk, 'back in');
  assert.ok(chats(h.links[1]).some(t => /Guest0 is back/.test(t)));
  assert.equal(h.g.soldiers.filter(s => s.isBot).length, before, 'and the bot gone again');
});

test('away at the end of a match: still sat out in the next; someone watching by choice is left to', () => {
  const h = hosted({ guests: 2, idleTicks: 300 });
  h.links[1].onmessage({ t: 'spectate', on: true }, true);
  let k = 0;
  for (let i = 0; i < 500; i++) { if (++k % 20 === 0) h.pad.move = k % 40 ? 1 : 0; step(h); }
  assert.ok(h.ps[0].afk && h.ps[0].soldier.spectating);
  assert.ok(h.ps[1].soldier.spectating && !h.ps[1].soldier.afk && !h.ps[1].afk, 'watching by choice isn\'t away');
  const g2 = new Game({ mapData: FLAT, effects: false, seed: 10, speed: DEFAULT_SPEED, mode: 'team', fragLimit: 999 });
  g2.addSoldier({ name: 'Host', isBot: false, team: 1 }, { input: () => ({ ...h.pad }) });
  h.host.setGame(g2);
  h.g = g2;
  for (let i = 0; i < 200; i++) { if (++k % 20 === 0) h.pad.move = k % 40 ? 1 : 0; step(h); }
  assert.ok(h.ps[0].soldier.spectating && h.ps[0].soldier.afk, 'still sat out');
  send(h.links[0], { act: true });
  step(h, 45);
  assert.ok(!h.ps[0].soldier.spectating, 'and back when they are');
  assert.ok(h.ps[1].soldier.spectating, 'the one watching still watching');
});

test('no sitting anyone out in a world, or with it turned off', () => {
  const h = hosted({ guests: 1, idleTicks: 0 });
  step(h, 400);
  assert.ok(!h.ps[0].soldier.spectating);
});

test('the next match\'s sides: shuffled as evenly as can be; swapped for Rush', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const h = hosted({ guests: 5, maxPlayers: 8, botCount: 0 });
    let r = seed * 7919;
    const rng = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const mine = h.host.planSides('shuffle', h.me.team, rng);
    assert.ok(mine === 1 || mine === 2);
    const g2 = new Game({ mapData: FLAT, effects: false, seed, speed: DEFAULT_SPEED, mode: 'team', fragLimit: 999 });
    g2.addSoldier({ name: 'Host', isBot: false, team: mine }, STILL);
    h.host.setGame(g2);
    const n = t => g2.soldiers.filter(s => s.team === t && !s.isBot).length;
    assert.equal(n(1) + n(2), 6);
    assert.equal(n(1), 3, `three a side (seed ${seed}: ${n(1)} v ${n(2)})`);
  }
  // (Shuffling does move people: not the same sides every time.)
  const seen = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const h = hosted({ guests: 3, maxPlayers: 8, botCount: 0 });
    let r = seed * 104729;
    const rng = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const mine = h.host.planSides('shuffle', 1, rng);
    seen.add([mine, ...h.ps.map(p => p.nextTeam)].join(''));
  }
  assert.ok(seen.size > 2, `different sides from one shuffle to the next (${seen.size})`);

  const h = hosted({ guests: 3, maxPlayers: 8, botCount: 0, mode: 'rush' });
  const was = h.ps.map(p => p.soldier.team), mine = h.host.planSides('swap', h.me.team);
  assert.equal(mine, 3 - h.me.team);
  const g2 = new Game({ mapData: FLAT, effects: false, seed: 2, speed: DEFAULT_SPEED, mode: 'rush', fragLimit: 0 });
  g2.addSoldier({ name: 'Host', isBot: false, team: mine }, STILL);
  h.host.setGame(g2);
  assert.deepEqual(h.ps.map(p => p.soldier.team), was.map(t => 3 - t), 'everyone on the other side');
});

test('sent away by the host: gone, told why, and not let back in', () => {
  const h = hosted({ guests: 2 });
  const id = h.ps[0].soldier.id;
  assert.ok(h.host.kick(id));
  assert.ok(h.links[0].closed);
  assert.ok(chats(h.links[0]).some(t => /sent you away/.test(t)));
  assert.ok(!h.g.soldiers.some(s => s.id === id && !s.isBot && s.name === 'Guest0'));
  assert.ok(h.host.sentAway.has('key0'));
  assert.ok(!h.host.sentAway.has('key1'));
  assert.equal(h.host.kick(9999), false);
});
