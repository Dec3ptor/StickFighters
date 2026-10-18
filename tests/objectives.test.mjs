// The objective modes: king of the hill, capture the flag, conquest and rush.
// Their rules on a flat test arena, objectives in the map format and share
// links, objectives worked out for maps without them, sending the modes'
// state to online players, and bots actually playing them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { MODES } from '../web/src/modes.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { normalizeMap, encodeShare, decodeShare } from '../web/src/custommaps.js';
import { GameMap } from '../web/src/map.js';
import { objectivesOf } from '../web/src/objectives.js';
import { encodeWorld, encodeSnapshot, decodeSnapshot } from '../web/src/net/protocol.js';
import { botMatch, loadMap } from './helpers.mjs';

const SEC = 60;
const ARM = 2 * SEC, DISARM = 7 * SEC, FUSE = 14 * SEC; // rush timings
const OBJECTIVES = [
  { type: 'hill', left: -60, top: -90, right: 60, bottom: 0 },
  { type: 'flag', team: 1, x: -700, y: 0 },
  { type: 'flag', team: 2, x: 700, y: 0 },
  { type: 'point', label: 'A', left: -500, top: -100, right: -300, bottom: 0 },
  { type: 'point', label: 'B', left: -100, top: -100, right: 100, bottom: 0 },
  { type: 'point', label: 'C', left: 300, top: -100, right: 500, bottom: 0 },
  { type: 'mcom', sector: 1, x: 200, y: 0 },
  { type: 'mcom', sector: 2, x: 600, y: 0 },
];

function arena(mode, { fragLimit = 0, objectives = OBJECTIVES, spawns } = {}) {
  const map = {
    name: 'arena', bounds: { left: -900, top: -400, right: 900, bottom: 200 },
    platforms: [{ left: -900, top: 0, right: 900, bottom: 40 }],
    spawns: spawns || [{ x: -800, y: -12, team: 1 }, { x: 800, y: -12, team: 2 }],
    items: [], objectives,
  };
  return new Game({ mapData: map, mode, fragLimit, effects: false, seed: 4, speed: DEFAULT_SPEED });
}

/** A soldier standing still at x (or doing what `ctl` says). */
function put(game, name, team, x, ctl = () => ({ move: 0 })) {
  const s = game.addSoldier({ name, isBot: true, team }, { input: ctl });
  game.respawn(s);
  place(s, x);
  return s;
}
function place(s, x, y = -12) {
  s.body.x = x; s.body.y = y; s.body.vx = s.body.vy = 0; s.prevX = x; s.prevY = y;
  s.spawnProtect = 0;
}
const run = (game, ticks) => { for (let i = 0; i < ticks; i++) game.update(); };

test('the objective modes are in the menu list with what the menu needs', () => {
  for (const id of ['koth', 'ctf', 'conquest', 'rush']) {
    const m = MODES[id];
    assert.ok(m.teams && m.objective, `${id} is a team objective mode`);
    assert.equal(m.limit, 'goal');
    assert.ok(m.goal.label && m.goal.options.includes(m.goal.value), `${id} has a goal choice`);
    for (const k of ['begin', 'tick', 'botGoal', 'winner', 'blurb']) assert.ok(m[k], `${id} has ${k}`);
  }
});

test('maps keep their objectives and spawn sectors, in files and share links', async () => {
  const raw = {
    name: 'x', platforms: [{ left: -300, top: 0, right: 300, bottom: 24 }],
    spawns: [{ x: -200, y: -30, team: 1, sector: 2 }, { x: 200, y: -30, team: 2 }],
    items: [],
    objectives: [
      { type: 'hill', left: 50, top: 0, right: -50, bottom: -90 },   // backwards: tidied
      { type: 'flag', team: 2, x: 100, y: 0 },
      { type: 'point', left: -100, top: -100, right: 0, bottom: 0 },  // no label: gets A
      { type: 'mcom', sector: 99, x: 0, y: 0 },                         // sector clamped
      { type: 'nonsense', x: 1, y: 2 },                                 // dropped
    ],
  };
  const m = normalizeMap(raw);
  assert.deepEqual(m.objectives, [
    { type: 'hill', left: -50, top: -90, right: 50, bottom: 0 },
    { type: 'flag', team: 2, x: 100, y: 0 },
    { type: 'point', label: 'A', left: -100, top: -100, right: 0, bottom: 0 },
    { type: 'mcom', sector: 8, x: 0, y: 0 },
  ]);
  assert.equal(m.spawns[0].sector, 2);
  assert.equal(m.spawns[1].sector, undefined);
  const back = await decodeShare(await encodeShare(m));
  assert.deepEqual(back.objectives, m.objectives);
  assert.deepEqual(back.spawns, m.spawns);
  // Maps without objectives don't grow an empty list.
  assert.equal(normalizeMap({ ...raw, objectives: undefined }).objectives, undefined);
});

test('maps without objectives get some worked out from their layout', () => {
  for (const file of ['ssdm1.json', 'ssdm3.json', 'ssteam1.json']) {
    const data = { ...loadMap(file), objectives: undefined };
    const map = new GameMap(data);
    const hills = objectivesOf(map, 'hill'), flags = objectivesOf(map, 'flag');
    const points = objectivesOf(map, 'point'), mcoms = objectivesOf(map, 'mcom');
    assert.equal(hills.length, 1, file);
    assert.deepEqual(flags.map(f => f.team), [1, 2], file);
    assert.ok(Math.abs(flags[0].x - flags[1].x) > 300, `${file}: flags far apart`);
    assert.deepEqual(points.map(p => p.label), ['A', 'B', 'C'], file);
    assert.ok(mcoms.length >= 2 && new Set(mcoms.map(m => m.sector)).size === 2, `${file}: two rush sectors`);
    // Everything is on a floor.
    for (const o of [...flags, ...mcoms]) assert.ok(map.solids.some(p => o.x >= p.l && o.x <= p.r && Math.abs(p.t - o.y) < 0.5), `${file}: ${o.type} on a floor`);
  }
});

test('king of the hill: a point a second for holding it alone, nothing while contested', () => {
  const game = arena('koth', { fragLimit: 5 });
  const blue = put(game, 'Blue', 1, 0);
  const red = put(game, 'Red', 2, -400);
  run(game, 3 * SEC + 2);
  assert.equal(game.teamScore[1], 3);
  assert.equal(game.modeState.owner, 1);
  assert.equal(blue.points, 3);
  place(red, 20);
  run(game, 3 * SEC);
  assert.equal(game.teamScore[1], 3, 'contested: no points');
  assert.equal(game.teamScore[2], 0);
  place(red, -400);
  run(game, 2 * SEC + 2);
  assert.equal(game.teamScore[1], 5);
  assert.ok(game.over && game.winner.team === 1, 'first to the goal wins');
});

test('king of the hill: with several hills, the hill moves every minute', () => {
  const game = arena('koth', { objectives: [OBJECTIVES[0], { type: 'hill', left: 400, top: -90, right: 520, bottom: 0 }] });
  put(game, 'Blue', 1, 0);
  run(game, 60 * SEC - 1);
  assert.equal(game.modeState.hill, 0);
  run(game, 2);
  assert.equal(game.modeState.hill, 1);
  const before = game.teamScore[1];
  run(game, 3 * SEC);
  assert.equal(game.teamScore[1], before, 'nobody on the new hill');
});

test('capture the flag: take it, carry it home, score (only with your own flag home)', () => {
  const game = arena('ctf', { fragLimit: 2 });
  const blue = put(game, 'Blue', 1, 690);
  const red = put(game, 'Red', 2, -690);
  run(game, 1);
  const st = game.modeState;
  assert.equal(st.flags[1].carrier, blue.id, 'blue took the red flag');
  assert.equal(st.flags[0].carrier, red.id, 'red took the blue flag');
  // Blue carries it home, but blue's own flag is away: no score.
  // (Walked over in steps: a jump of more than 120 px in one update counts as teleporting, which drops the flag.)
  for (let x = 690; x >= -700; x -= 100) { place(blue, Math.max(-700, x)); run(game, 1); }
  place(blue, -700);
  run(game, 1);
  assert.equal(game.teamScore[1], 0);
  assert.equal(st.flags[1].x, blue.x, 'the flag goes with its carrier');
  // Red's carrier dies: the blue flag drops; blue touches it and it goes home; then blue scores.
  game.kill(red, blue, 'M4');
  assert.equal(st.flags[0].carrier, -1);
  assert.equal(st.flags[0].home, false);
  place(blue, red.x);
  run(game, 1);
  assert.equal(st.flags[0].home, true, 'returned');
  place(blue, -700);
  run(game, 1);
  assert.equal(game.teamScore[1], 1, 'captured');
  assert.ok(st.flags[1].home && st.flags[1].carrier < 0, 'the red flag is back at its base');
  assert.ok(blue.points >= 10 + 3 + 2);
});

test('capture the flag: dropped flags go home by themselves, at once if they fall off the map', () => {
  const game = arena('ctf');
  const blue = put(game, 'Blue', 1, 690);
  run(game, 1);
  const f = game.modeState.flags[1];
  place(blue, 0);
  run(game, 1);
  game.kill(blue, null, null);
  assert.equal(f.home, false);
  run(game, 20 * SEC + 1);
  assert.equal(f.home, true, 'back after 20 seconds');
  // Falling off the map with it: straight home.
  place(blue, 690);
  game.respawn(blue);
  place(blue, 690);
  run(game, 1);
  assert.equal(f.carrier, blue.id);
  game.kill(blue, null, null, { fall: true });
  assert.equal(f.home, true);
});

test('capture the flag: a carrier who leaves the game drops it', () => {
  const game = arena('ctf');
  const blue = put(game, 'Blue', 1, 690);
  run(game, 1);
  game.removeSoldier(blue);
  run(game, 1);
  assert.equal(game.modeState.flags[1].carrier, -1);
});

test('conquest: standing on a point captures it, more soldiers capture faster', () => {
  const game = arena('conquest', { fragLimit: 100 });
  put(game, 'Blue', 1, -400);
  run(game, 1);
  const a = game.modeState.points[0];
  run(game, 7 * SEC - 3);
  assert.equal(a.own, 0, 'not yet');
  run(game, 4);
  assert.equal(a.own, 1, 'captured in 7 seconds');
  // Three red soldiers take it back faster than one would: neutral, then red.
  const reds = [put(game, 'R1', 2, -1000), put(game, 'R2', 2, -1000), put(game, 'R3', 2, -1000)];
  // (Blue leaves first.)
  for (const s of game.soldiers.filter(s => s.team === 1)) place(s, 0);
  for (const r of reds) place(r, -400);
  let t = 0;
  while (a.own !== 2 && t < 20 * SEC) { game.update(); t++; }
  assert.equal(a.own, 2);
  assert.ok(t < 8 * SEC, `three soldiers took it back from blue in ${(t / SEC).toFixed(1)} s`);
});

test('conquest: deaths cost tickets, holding fewer points bleeds them, out of tickets loses', () => {
  const game = arena('conquest', { fragLimit: 30 });
  const blue = put(game, 'Blue', 1, -400);
  const red = put(game, 'Red', 2, 800);
  run(game, 1);
  assert.deepEqual([game.teamScore[1], game.teamScore[2]], [30, 30]);
  game.kill(red, blue, 'M4');
  assert.equal(game.teamScore[2], 29);
  assert.equal(game.teamScore[1], 30, "a kill doesn't cost the killer's team");
  run(game, 7 * SEC + 2); // blue takes A: red now holds fewer points and bleeds
  const before = game.teamScore[2];
  run(game, 5 * SEC);
  assert.ok(game.teamScore[2] < before, 'bleeding');
  for (let i = 0; i < 40 && !game.over; i++) { game.respawn(red); place(red, 800); game.kill(red, blue, 'M4'); }
  assert.ok(game.over && game.winner.team === 1);
});

test('conquest: soldiers respawn at the usable place nearest where they died', () => {
  const game = arena('conquest', { fragLimit: 100 });
  const blue = put(game, 'Blue', 1, 0);
  run(game, 7 * SEC + 2);
  assert.equal(game.modeState.points[1].own, 1, 'blue holds B');
  const diesAt = x => { if (!blue.alive) game.respawn(blue); place(blue, x); game.kill(blue, null, null); };
  // Died near B: back on B. Near the base (or further out than B): the base.
  diesAt(150);
  for (let i = 0; i < 10; i++) { const p = game.pickSpawn(blue); assert.ok(p.x > -100 && p.x < 100, `on B (${p.x})`); }
  diesAt(-650);
  for (let i = 0; i < 10; i++) assert.equal(game.pickSpawn(blue).x, -800, 'at base');
  // B with an enemy on it can't be used: the nearest usable place is the base.
  diesAt(150);
  put(game, 'Red', 2, 50);
  for (let i = 0; i < 10; i++) assert.equal(game.pickSpawn(blue).x, -800);
});

test('conquest: players choose where they spawn: base, or a point their team holds', () => {
  const game = arena('conquest', { fragLimit: 100 });
  const blue = put(game, 'Blue', 1, 0);
  run(game, 7 * SEC + 2);
  const me = game.addSoldier({ name: 'Me', isBot: false, team: 1 }, null);
  assert.deepEqual(game.rules.deployOptions(game, me).map(o => o.key), ['auto', 'base', 'B']);
  me.deployAt = 'B';
  for (let i = 0; i < 10; i++) { const p = game.pickSpawn(me); assert.ok(p.x > -100 && p.x < 100, 'on B'); }
  me.deployAt = 'base';
  for (let i = 0; i < 10; i++) assert.equal(game.pickSpawn(me).x, -800);
  // A point lost (or under attack) can't be chosen: back to the usual choice.
  me.deployAt = 'B';
  put(game, 'Red', 2, 30);
  for (let i = 0; i < 10; i++) assert.equal(game.pickSpawn(me).x, -800);
  assert.ok(blue.alive);
});

test('rush: arm an M-COM, it blows, the next sector opens with fresh tickets; the last one wins', () => {
  const game = arena('rush', { fragLimit: 20 });
  const blue = put(game, 'Blue', 1, 200);
  const red = put(game, 'Red', 2, -800);
  run(game, 1);
  const st = game.modeState;
  assert.equal(game.teamScore[1], 20);
  run(game, ARM - 2);
  assert.equal(st.mcoms[0].s, 0, 'not armed yet');
  run(game, 2);
  assert.equal(st.mcoms[0].s, 1, 'armed after 2 seconds');
  game.kill(blue, red, 'M4');
  assert.equal(game.teamScore[1], 19, 'attackers pay a ticket per death');
  run(game, FUSE);
  assert.equal(st.mcoms[0].s, 2, 'destroyed when the fuse runs out');
  assert.equal(st.sector, 1, 'on to sector 2');
  assert.equal(game.teamScore[1], 20, 'tickets refilled');
  game.respawn(blue);
  place(blue, 600);
  run(game, ARM + FUSE + 2);
  assert.equal(st.mcoms[1].s, 2);
  assert.ok(game.over && game.winner.team === 1, 'attackers win');
});

test('rush: defenders disarm; attackers out of tickets stay down and lose', () => {
  const game = arena('rush', { fragLimit: 2 });
  const blue = put(game, 'Blue', 1, 200);
  const red = put(game, 'Red', 2, -800);
  run(game, ARM + 1);
  const m = game.modeState.mcoms[0];
  assert.equal(m.s, 1);
  place(blue, -500);
  place(red, 200);
  run(game, DISARM - 2);
  assert.equal(m.s, 1, 'not disarmed yet');
  run(game, 3);
  assert.equal(m.s, 0, 'disarmed after 7 seconds');
  game.kill(blue, red, 'M4');
  game.respawn(blue);
  place(blue, -500);
  game.kill(blue, red, 'M4');
  assert.equal(game.teamScore[1], 0);
  assert.equal(game.rules.canRespawn(game, blue), false, 'no tickets, no respawn');
  assert.ok(game.over && game.winner.team === 2);
});

test("rush: an M-COM's blast can't end the round on tickets the next sector refills", () => {
  const game = arena('rush', { fragLimit: 3 });
  const blue = put(game, 'Blue', 1, 200);
  const red = put(game, 'Red', 2, -800);
  run(game, 1);
  for (let i = 0; i < 2; i++) { game.kill(blue, red, 'M4'); game.respawn(blue); place(blue, 200); }
  assert.equal(game.teamScore[1], 1);
  run(game, ARM + 1);
  // Blue's last ticket, standing right by the M-COM when it blows.
  run(game, FUSE);
  assert.equal(game.modeState.sector, 1, 'sector 2');
  assert.ok(!blue.alive, 'caught in the blast');
  assert.equal(game.teamScore[1], 2, 'that death costs a ticket from the refill');
  assert.ok(!game.over, `the round goes on (${JSON.stringify(game.winner)})`);
});

test('rush: soldiers respawn as far forward as they can', () => {
  const spawns = [
    { x: -850, y: -12, team: 1, sector: 1 }, { x: -500, y: -12, team: 1, sector: 1 }, { x: -200, y: -12, team: 1, sector: 1 },
    { x: 850, y: -12, team: 2, sector: 1 }, { x: 450, y: -12, team: 2, sector: 1 },
  ];
  const game = arena('rush', { spawns });
  const blue = put(game, 'Blue', 1, -850), red = put(game, 'Red', 2, 850);
  run(game, 1);
  // Sector 1's M-COM is at x 200: blue's most forward spawn is -200, red's 450.
  for (let i = 0; i < 10; i++) assert.equal(game.pickSpawn(blue).x, -200);
  for (let i = 0; i < 10; i++) assert.equal(game.pickSpawn(red).x, 450);
  // Unless the enemy is standing on it.
  place(red, -180);
  for (let i = 0; i < 10; i++) assert.equal(game.pickSpawn(blue).x, -500);
});

test('rush: each sector uses its own spawn points', () => {
  const spawns = [
    { x: -800, y: -12, team: 1 }, { x: 800, y: -12, team: 2 },
    { x: -300, y: -12, team: 1, sector: 1 }, { x: 0, y: -12, team: 1, sector: 2 },
    { x: 400, y: -12, team: 2, sector: 1 },
  ];
  const game = arena('rush', { spawns });
  const blue = put(game, 'Blue', 1, -800), red = put(game, 'Red', 2, 800);
  assert.equal(game.pickSpawn(blue).x, -300);
  assert.equal(game.pickSpawn(red).x, 400);
  game.modeState.sector = 1;
  assert.equal(game.pickSpawn(blue).x, 0);
  assert.equal(game.pickSpawn(red).x, 800, 'no sector 2 spawns for red: its others');
  // Other modes ignore the sector spawns.
  const ctf = arena('ctf', { spawns });
  const b2 = put(ctf, 'Blue', 1, 0);
  for (let i = 0; i < 10; i++) assert.equal(ctf.pickSpawn(b2).x, -800);
});

test("kills don't change the team score in the objective modes", () => {
  const game = arena('ctf');
  const blue = put(game, 'Blue', 1, 0), red = put(game, 'Red', 2, 100);
  game.kill(red, blue, 'M4');
  assert.deepEqual([game.teamScore[1], game.teamScore[2]], [0, 0]);
  assert.equal(blue.frags, 1);
});

test("online players get the mode's state and everyone's objective score", () => {
  const game = arena('conquest', { fragLimit: 100 });
  const blue = put(game, 'Blue', 1, -400);
  run(game, 3 * SEC);
  blue.points = 42;
  const snap = decodeSnapshot(encodeSnapshot(game, blue, 0, encodeWorld(game)));
  assert.equal(snap.mode.points[0].own, 0);
  assert.ok(Math.abs(snap.mode.points[0].v - game.modeState.points[0].v) < 0.001);
  assert.deepEqual(snap.mode.points[0].c, [1, 0]);
  assert.equal(snap.soldiers.find(s => s.id === blue.id).points, 42);
  const plain = arena('ffa');
  put(plain, 'A', 0, 0);
  assert.equal(decodeSnapshot(encodeSnapshot(plain, null, 0, encodeWorld(plain))).mode, null);
});

test('bots play the objective modes', () => {
  // On an original map (objectives worked out from its layout), 10 bots for two minutes.
  const happened = {};
  for (const mode of ['koth', 'ctf', 'conquest', 'rush']) {
    const { game } = botMatch('ssdm1.json', { bots: 10, mode, seed: 11, fragLimit: 0 });
    const feed = [];
    const add = game.addFeed.bind(game);
    game.addFeed = e => { feed.push(e.text); add(e); };
    for (let i = 0; i < 120 * SEC && !game.over; i++) game.update();
    happened[mode] = { feed: feed.filter(t => !/fragged|fell|blew|knocked|bang/.test(t)), score: { ...game.teamScore } };
  }
  assert.ok(happened.koth.score[1] + happened.koth.score[2] > 10, `hill points: ${JSON.stringify(happened.koth.score)}`);
  assert.ok(happened.ctf.feed.some(t => /captured/.test(t)), `a flag captured: ${happened.ctf.feed.join('; ')}`);
  assert.ok(happened.conquest.feed.some(t => /captured [ABC]/.test(t)), `a point captured: ${happened.conquest.feed.join('; ')}`);
  assert.ok(happened.rush.feed.some(t => /armed/.test(t)), `an M-COM armed: ${happened.rush.feed.join('; ')}`);
});
