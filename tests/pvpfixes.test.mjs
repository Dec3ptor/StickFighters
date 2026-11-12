// Fixes to things that spoilt fights: shots at arm's length hit (they started at the muzzle, past
// whoever stood right against the shooter); a blast doesn't move someone who's just spawned, and a
// team-mate thrown off the map is the thrower's to answer for; the last sheep can be set off; a
// mortar's bomblets scatter before they go off; sides stay even as players join, and can be
// changed; the listing says what a game really is; Defuse's money goes with whoever leaves.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED, RULES } from '../web/src/config.js';
import { WEAPONS } from '../web/src/weapons.js';
import { explode, spawn } from '../web/src/combat.js';
import { NetHost } from '../web/src/net/host.js';
import { GAME_MODES } from '../web/src/net/lobby.js';
import { MODES } from '../web/src/modes.js';

/** A flat floor with room either side (and a drop off each end). */
const FLAT = { name: 'flat', bounds: { left: -600, top: -600, right: 1600, bottom: 200 }, items: [],
  spawns: [{ x: 0, y: -12, team: 1 }, { x: 400, y: -12, team: 2 }], platforms: [{ left: -600, top: 0, right: 1600, bottom: 40 }] };

/** A match on the flat map: a shooter (its input in `aim`) and others who stand still, all alive and unprotected. */
function arena(mode = 'ffa', teams = [1, 2]) {
  const g = new Game({ mapData: FLAT, effects: false, seed: 5, speed: DEFAULT_SPEED, mode, fragLimit: 999 });
  const aim = { move: 0, aim: 0, fire: false, firePressed: false };
  const all = teams.map((team, i) => g.addSoldier({ name: `S${i}`, isBot: false, team: g.rules.teams ? team : 0 }, { input: () => (i === 0 ? { ...aim } : { move: 0 }) }));
  for (let i = 0; i < 400 && !all.every(s => s.alive); i++) g.update();
  for (const s of all) { s.spawnProtect = 0; s.body.y = -12; s.body.vx = s.body.vy = 0; }
  return { g, aim, all, a: all[0], b: all[1] };
}
const give = (s, id) => { const d = WEAPONS[id]; s.weapons[id] = d.mag ? { ammo: 500, mag: d.mag } : { ammo: 500 }; s.select(id); s.cooldown = 0; };
/** Hold fire for n updates, everyone kept where they are (xs: where each stands). Returns the damage each took. */
function shoot(m, xs, n = 200) {
  for (const [i, s] of m.all.entries()) { s.body.x = xs[i]; s.maxHealth = s.health = 1e6; }
  for (let i = 0; i < 20; i++) { m.g.update(); for (const [j, s] of m.all.entries()) { s.body.x = xs[j]; s.body.vx = 0; } }
  m.a.cooldown = 0;
  const before = m.all.map(s => s.health);
  m.aim.fire = true; m.aim.firePressed = true;
  for (let i = 0; i < n; i++) { m.g.update(); m.aim.firePressed = false; for (const [j, s] of m.all.entries()) { s.body.x = xs[j]; s.body.vx = 0; s.spawnProtect = 0; } }
  m.aim.fire = false;
  return m.all.map((s, i) => Math.round(before[i] - s.health));
}

test('shots hit someone standing right against the shooter (every gun, at any gap)', () => {
  for (const id of ['Shotgun', 'M4', 'Uzi', 'SR', 'Platinum', 'Flamer', 'Bazooka']) {
    for (const gap of [0, 6, 12, 18, 26]) {
      const m = arena();
      give(m.a, id);
      const [, hurt] = shoot(m, [0, gap], id === 'Bazooka' ? 260 : 120);
      assert.ok(hurt > 0, `${id} at ${gap} px hurt them (${hurt})`);
    }
  }
});

test('shots still go through a team-mate, to the enemy behind them; and not through one further off', () => {
  const m = arena('team', [1, 1, 2]);
  give(m.a, 'M4');
  const [, mate, foe] = shoot(m, [0, 10, 70]);
  assert.equal(mate, 0, 'the team-mate unhurt');
  assert.ok(foe > 0, `the enemy behind them hit (${foe})`);
});

test('a blast doesn\'t move someone who\'s just spawned, and moves them once they aren\'t', () => {
  const m = arena();
  m.b.body.x = 300;
  m.b.spawnProtect = 60;
  explode(m.g, 285, -8, { radius: 95, damage: 115, knock: 14 }, m.a, 'Bazooka');
  assert.equal(m.b.body.vx, 0, 'not thrown while protected');
  assert.equal(m.b.health, m.b.maxHealth, 'nor hurt');
  m.b.spawnProtect = 0;
  explode(m.g, 285, -8, { radius: 95, damage: 115, knock: 14 }, m.a, 'Bazooka');
  assert.ok(m.b.body.vx > 2, 'thrown, once not');
});

test('a team-mate blasted off the map is the thrower\'s to answer for: they lose the frag, not the one who fell', () => {
  const m = arena('team', [1, 1, 2]);
  const [thrower, mate] = m.all;
  mate.body.x = 1500;
  const before = { t: thrower.frags, m: mate.frags, team: m.g.teamScore[1] };
  explode(m.g, 1480, -8, { radius: 95, damage: 115, knock: 14 }, thrower, 'Bazooka');
  assert.equal(mate.health, mate.maxHealth, 'a team-mate isn\'t hurt by it');
  assert.equal(mate.pushedBy, thrower, 'but who threw them is kept');
  // (Off the end, and down.)
  mate.body.x = 1700; mate.body.y = 500;
  for (let i = 0; i < 30 && mate.alive; i++) m.g.update();
  assert.ok(!mate.alive, 'fell off the map');
  assert.equal(thrower.frags, before.t - 1, 'the thrower loses a frag');
  assert.equal(mate.frags, before.m, 'the one who fell doesn\'t');
  assert.ok(/knocked team-mate/.test(m.g.feed.at(-1)?.text || ''), `the feed says so (${m.g.feed.at(-1)?.text})`);
  // (Falling by themselves: theirs, as ever.)
  const n = arena('team', [1, 1, 2]);
  const lone = n.all[1], was = lone.frags;
  lone.body.x = 1700; lone.body.y = 500;
  for (let i = 0; i < 30 && lone.alive; i++) n.g.update();
  assert.equal(lone.frags, was - 1);
});

test('the last sheep stays in hand till it\'s gone off: a second click sets it off, and then it\'s let go of', () => {
  const m = arena();
  m.b.body.x = 900;
  m.a.weapons.Sheep = { ammo: 1 };
  m.a.select('Sheep');
  m.a.cooldown = 0;
  const click = () => { m.aim.fire = true; m.aim.firePressed = true; m.g.update(); m.aim.fire = false; m.aim.firePressed = false; };
  click();
  const sheep = m.g.projectiles.find(p => p.owner === m.a && p.weapon === 'Sheep');
  assert.ok(sheep, 'a sheep out');
  assert.equal(m.a.current, 'Sheep', 'still in hand, though it was the last');
  for (let i = 0; i < 30; i++) m.g.update();
  assert.equal(m.a.current, 'Sheep');
  click();
  for (let i = 0; i < 5; i++) m.g.update();
  assert.ok(sheep.dead, 'set off by the second click');
  assert.notEqual(m.a.current, 'Sheep', 'and let go of');
});

test('a mortar shell\'s bomblets scatter before they go off: not each a direct hit on whoever the shell hit', () => {
  const m = arena();
  m.a.body.x = 0; m.b.body.x = 300;
  m.b.maxHealth = m.b.health = 1e6;
  // (A shell coming down on their head.)
  spawn(m.g, { kind: 'rocket', sprite: 'mortar', cfg: WEAPONS.Mortar, x: 300, y: -90, vx: 0, vy: 6, owner: m.a, weapon: 'Mortar', life: 600 });
  for (let i = 0; i < 400; i++) { m.g.update(); m.b.body.x = 300; m.b.body.vx = 0; }
  const took = 1e6 - m.b.health;
  const direct = WEAPONS.Mortar.blast.damage * RULES.maxHealth / 100, each = WEAPONS.Mortar.cluster.blast.damage * RULES.maxHealth / 100, n = WEAPONS.Mortar.cluster.count;
  assert.ok(took >= direct - 1, `the shell's own blast, in full (${Math.round(took)})`);
  assert.ok(took < direct + each * n * 0.75, `not every bomblet a direct hit too (${Math.round(took)} of ${direct + each * n})`);
});

// ---- Sides ---------------------------------------------------------------------------------------------

/** A link that goes nowhere (what's sent kept). */
const fakeLink = () => ({ sent: [], send(d) { this.sent.push(d); return true; }, close() { this.onclose?.(); } });
/** A team game hosted with bots, the host on Blue. */
function hosted(botCount = 7, maxPlayers = 8, mode = 'team') {
  const g = new Game({ mapData: FLAT, effects: false, seed: 9, speed: DEFAULT_SPEED, mode, fragLimit: 999 });
  const addBot = game => {
    const n = t => game.soldiers.filter(s => s.team === t).length;
    game.addSoldier({ name: `Bot${game.soldiers.length}`, isBot: true, team: n(1) <= n(2) ? 1 : 2 }, { input: () => ({ move: 0 }) });
  };
  const host = new NetHost({ maxPlayers, botCount, addBot, matchInfo: () => ({ mode, fragLimit: 999, options: g.options, speed: DEFAULT_SPEED, map: { builtin: 'x' }, mapName: 'flat' }) });
  const me = g.addSoldier({ name: 'Host', isBot: false, team: 1 }, { input: () => ({ move: 0 }) });
  host.setGame(g);
  return { g, host, me };
}
const sizes = g => [g.teamSize(1), g.teamSize(2)];
const players = (g, t) => g.soldiers.filter(s => s.team === t && !s.isBot).length;

test('players joining a team game with bots: the sides stay even, whichever bots have the fewest frags', () => {
  const { g, host } = hosted();
  assert.deepEqual(sizes(g), [4, 4]);
  // (The bots with the fewest frags all on one side: once, the ones that went whichever side they were on.)
  for (const s of g.soldiers) if (s.isBot) s.frags = s.team === 1 ? 0 : 5;
  for (let i = 0; i < 4; i++) {
    host.addPlayer(fakeLink(), `Guest${i}`);
    const [a, b] = sizes(g);
    assert.ok(Math.abs(a - b) <= 1, `even after ${i + 1} joined (${a} v ${b})`);
    assert.equal(a + b, 8);
  }
  assert.ok(Math.abs(players(g, 1) - players(g, 2)) <= 1, 'and the players spread over both');
});

test('changing sides: when it\'s fair (the host, always); bots even the sides up after; kept for the next match', () => {
  const { g, host, me } = hosted();
  const link = fakeLink();
  const p = host.addPlayer(link, 'Friend');
  for (let i = 0; i < 200; i++) g.update();
  assert.equal(p.soldier.team, 2, 'a first friend starts across from the host');
  // (Over to the host's side: two players on one, none on the other. Not fair, for a guest.)
  assert.ok(host.cantSwitch(p.soldier), 'not to a side that would have two more players');
  // (The host can: to play alongside them against the bots.)
  assert.equal(host.switchTeam(me, true), null);
  assert.equal(me.team, 2);
  assert.ok(!me.alive, 'out, to come back on the new side');
  const [a, b] = sizes(g);
  assert.ok(Math.abs(a - b) <= 1, `bots evened up (${a} v ${b})`);
  assert.equal(players(g, 2), 2);
  for (let i = 0; i < 300 && !me.alive; i++) g.update();
  assert.ok(me.alive);
  // (A guest asking, when it's fair: one each way after.)
  link.onmessage({ t: 'team' }, true);
  assert.equal(p.soldier.team, 1, 'the guest over to Blue: one player a side');
  assert.equal(p.team, 1);
  // (Too soon to ask again.)
  link.onmessage({ t: 'team' }, true);
  assert.equal(p.soldier.team, 1);
  // (The next match: where they chose.)
  const g2 = new Game({ mapData: FLAT, effects: false, seed: 10, speed: DEFAULT_SPEED, mode: 'team', fragLimit: 999 });
  g2.addSoldier({ name: 'Host', isBot: false, team: 2 }, { input: () => ({ move: 0 }) });
  host.setGame(g2);
  assert.equal(p.soldier.team, 1, 'still on the side they chose');
  const [c, d] = sizes(g2);
  assert.ok(Math.abs(c - d) <= 1);
  // (No sides in a free-for-all.)
  const f = hosted(3, 8, 'ffa');
  assert.ok(f.host.cantSwitch(f.me, true));
  assert.equal(f.g.switchTeam(f.me, 2), false);
});

test('a player leaving, or sitting out: bots even the sides up', () => {
  const { g, host } = hosted(6, 8);
  const links = [fakeLink(), fakeLink()], ps = links.map((l, i) => host.addPlayer(l, `G${i}`));
  let [a, b] = sizes(g);
  assert.ok(Math.abs(a - b) <= 1);
  links[0].close();
  [a, b] = sizes(g);
  assert.ok(Math.abs(a - b) <= 1, `after one left (${a} v ${b})`);
  links[1].onmessage({ t: 'spectate', on: true }, true);
  [a, b] = sizes(g);
  assert.ok(Math.abs(a - b) <= 1, `after one sat out (${a} v ${b})`);
  assert.ok(ps[1].soldier.spectating);
});

test('the game listing knows every mode the game has', () => {
  for (const mode of Object.keys(MODES)) assert.ok(GAME_MODES.includes(mode), mode);
});

test('Defuse: whoever leaves takes their money with them (the next given their number starts as anyone does)', () => {
  const g = new Game({ mapData: FLAT, effects: false, seed: 5, speed: DEFAULT_SPEED, mode: 'defuse', fragLimit: 7 });
  const a = g.addSoldier({ name: 'A', isBot: false, team: 1 }, { input: () => ({ move: 0 }) });
  g.addSoldier({ name: 'B', isBot: false, team: 2 }, { input: () => ({ move: 0 }) });
  for (let i = 0; i < 5; i++) g.update();
  const start = g.modeState.money[a.id];
  g.modeState.money[a.id] = 9000;
  // (Sitting out keeps it.)
  g.spectate(a, true);
  assert.equal(g.modeState.money[a.id], 9000);
  const id = a.id;
  g.removeSoldier(a);
  assert.equal(g.modeState.money[id], undefined, 'gone with them');
  const c = g.addSoldier({ id, name: 'C', isBot: false, team: 1 }, { input: () => ({ move: 0 }) });
  assert.equal(g.modeState.money[c.id], start, 'the next with that number starts as anyone does');
});
