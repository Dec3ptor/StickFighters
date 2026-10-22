// Defuse, the Counter-Strike-style mode: rounds with a freeze and no respawns,
// buying with money from kills, wins and losses, magazines, planting and defusing
// the bomb, half time and overtime, flashbangs and smoke, bots playing it, maps
// with bomb sites, and online play (buying through the host, what players are sent).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { MODES } from '../web/src/modes.js';
import { WEAPONS, PICKUP_WEAPONS } from '../web/src/weapons.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { DEFUSE, SHOP, GEAR, buy, whyNot, moneyOf, gearOf, sideOf, kindOf, priceOf, canShop, useHere } from '../web/src/defuse.js';
import { weaponFor } from '../web/src/classes.js';
import { smokeBetween, flash } from '../web/src/combat.js';
import { objectivesOf } from '../web/src/objectives.js';
import { normalizeMap, encodeShare, decodeShare } from '../web/src/custommaps.js';
import { encodeInputs, decodeInputs, encodeWorld, encodeSnapshot, decodeSnapshot } from '../web/src/net/protocol.js';
import { NavGraph } from '../web/src/nav.js';
import { BotController, BOT_PROFILES } from '../web/src/bot.js';
import { NetHost } from '../web/src/net/host.js';
import { NetClient } from '../web/src/net/client.js';
import { memoryLinks } from '../web/src/net/peer.js';
import { makeRng } from '../web/src/util.js';
import { botMatch, loadMap, mapIndex } from './helpers.mjs';

const SEC = 60;
const SITES = [
  { type: 'site', label: 'A', left: -400, top: -110, right: -200, bottom: 0 },
  { type: 'site', label: 'B', left: 200, top: -110, right: 400, bottom: 0 },
];
const ARENA = {
  name: 'defuse arena', bounds: { left: -1300, top: -500, right: 1300, bottom: 200 },
  platforms: [{ left: -1300, top: 0, right: 1300, bottom: 40 }],
  spawns: [
    { x: -1150, y: -12, team: 1 }, { x: -1100, y: -12, team: 1 }, { x: -1050, y: -12, team: 1 },
    { x: 1150, y: -12, team: 2 }, { x: 1100, y: -12, team: 2 }, { x: 1050, y: -12, team: 2 },
  ],
  items: [], objectives: SITES,
};

/** A Defuse match on a flat arena: blue's spawns on the left are the attackers' (T), red's the defenders' (CT). */
const arena = (goal = 7, mapData = ARENA) => new Game({ mapData, mode: 'defuse', fragLimit: goal, effects: false, seed: 4, speed: DEFAULT_SPEED });

/** A soldier we steer: set s.inp to what they do (move, fire, use...). */
function player(game, name, team) {
  const ctl = { input: (g, s) => ({ move: 0, aim: s.facing < 0 ? Math.PI : 0, aimDist: 200, ...s.inp }) };
  const s = game.addSoldier({ name, isBot: false, team }, ctl);
  s.inp = {};
  return s;
}
function place(s, x, y = -12) {
  s.body.x = x; s.body.y = y; s.body.vx = s.body.vy = 0; s.prevX = x; s.prevY = y;
}
const run = (game, ticks) => { for (let i = 0; i < ticks; i++) game.update(); };
/** Run until the mode's phase is `phase` (or give up after `max` updates). */
function until(game, phase, max = 200 * SEC) {
  for (let i = 0; i < max && game.modeState.phase !== phase && !game.over; i++) game.update();
  assert.equal(game.modeState.phase, phase, `reached ${phase}`);
}
/** Two attackers and two defenders, a round under way (frozen). */
function teams(goal = 7) {
  const game = arena(goal);
  const [t1, t2, c1, c2] = [player(game, 'T1', 1), player(game, 'T2', 1), player(game, 'C1', 2), player(game, 'C2', 2)];
  until(game, 'freeze');
  return { game, st: game.modeState, t1, t2, c1, c2, carrier: [t1, t2].find(s => s.weapons.C4) };
}

test('Defuse is in the mode list with what the menus and the game need', () => {
  const m = MODES.defuse;
  assert.ok(m.teams && m.objective && m.limit === 'goal');
  assert.ok(m.goal.options.includes(m.goal.value), 'rounds to win');
  for (const k of ['begin', 'tick', 'input', 'useHere', 'drop', 'canPickUp', 'dropOnDeath', 'buyItem', 'botGoal', 'botUse', 'botThrow', 'winner', 'blurb', 'outText'])
    assert.ok(m[k], `has ${k}`);
  assert.equal(m.pickups, false, 'no weapons lying about: you buy them');
  assert.equal(m.canRespawn(), false, 'no respawns in a round');
  // The shop: everything in it has a price, and the grenades and guns are shop-only weapons that stay off maps.
  for (const col of SHOP) for (const id of col.items) assert.ok(priceOf(id) > 0, `${id} is for sale`);
  for (const id of ['Beretta', 'MP5K', 'AK47']) assert.ok(PICKUP_WEAPONS.includes(id), `the new guns are in the other modes too: ${id}`);
  for (const id of ['HEGrenade', 'Flashbang', 'SmokeGrenade', 'Knife', 'C4']) {
    assert.ok(WEAPONS[id], id);
    assert.ok(!PICKUP_WEAPONS.includes(id), `${id} isn't on maps or in crates`);
  }
});

test('a round starts frozen: everyone at their side\'s spawn with $800, a knife and a pistol, and an attacker has the bomb', () => {
  const { game, st, t1, t2, c1, carrier } = teams();
  assert.equal(st.round, 1);
  assert.equal(sideOf(game, 1), 'T');
  assert.equal(sideOf(game, 2), 'CT');
  for (const s of game.soldiers) {
    assert.ok(s.alive);
    assert.equal(moneyOf(game, s), DEFUSE.startMoney);
    assert.ok(s.weapons.Knife && s.weapons.Platinum, `${s.name}: knife and pistol`);
    assert.equal(s.weapons.Platinum.mag, weaponFor(s, 'Platinum').mag, 'a full magazine');
    assert.ok(s.team === 1 ? s.x < -1000 : s.x > 1000, `${s.name} at their side's spawn`);
  }
  assert.ok(carrier, 'an attacker has the bomb');
  assert.equal(st.bomb.s, 'carried');
  assert.equal(st.bomb.by, carrier.id);
  assert.ok(!c1.weapons.C4);
  // Frozen: nobody moves (they can look about and switch weapons).
  for (const s of game.soldiers) s.inp = { move: 1 };
  const x0 = t1.x;
  run(game, SEC);
  assert.ok(Math.abs(t1.x - x0) < 0.5, 'held still');
  until(game, 'live');
  assert.equal(st.timer, DEFUSE.roundTime);
  run(game, 30);
  assert.ok(t1.x - x0 > 5, 'off they go');
  assert.ok(t2.alive && c1.alive);
});

test('buying: prices, money, one gun of each sort, the side\'s own items, the buy zone and buy time', () => {
  const { game, st, t1, c1 } = teams();
  assert.equal(whyNot(game, t1, 'AK47'), 'Not enough money');
  assert.equal(buy(game, t1, 'Beretta'), null);
  assert.equal(moneyOf(game, t1), 500);
  assert.ok(t1.weapons.Beretta && !t1.weapons.Platinum, 'one pistol: the old one is dropped');
  assert.ok(game.pickups.items.some(it => it.dropped && it.weapon === 'Platinum'), 'for a teammate to pick up');
  st.money[t1.id] = 9000;
  assert.equal(buy(game, t1, 'M4'), 'Counter-Terrorists only');
  assert.equal(buy(game, t1, 'kit'), 'Counter-Terrorists only');
  assert.equal(buy(game, t1, 'AK47'), null);
  assert.deepEqual(t1.weapons.AK47, { ammo: 90, mag: 30 }, 'a magazine and spare ammo');
  assert.equal(t1.current, 'AK47', 'in hand');
  assert.equal(buy(game, t1, 'AK47'), 'You have one');
  assert.equal(buy(game, t1, 'MP5K'), null);
  assert.ok(!t1.weapons.AK47, 'buying another gun of the sort drops the one you had');
  assert.equal(moneyOf(game, t1), 9000 - 2700 - 1500);
  // Armour: a vest, then the helmet for the difference.
  assert.equal(buy(game, t1, 'kevlar'), null);
  assert.equal(t1.armour, 100);
  assert.equal(whyNot(game, t1, 'kevlar'), 'You have a vest');
  const before = moneyOf(game, t1);
  assert.equal(buy(game, t1, 'helmet'), null);
  assert.equal(before - moneyOf(game, t1), GEAR.helmet.price - GEAR.kevlar.price);
  assert.ok(gearOf(game, t1).helmet);
  // Grenades: one or two of a kind, four at most.
  assert.equal(buy(game, t1, 'HEGrenade'), null);
  assert.equal(buy(game, t1, 'HEGrenade'), "You can't carry more");
  assert.equal(buy(game, t1, 'Flashbang'), null);
  assert.equal(buy(game, t1, 'Flashbang'), null);
  assert.equal(buy(game, t1, 'SmokeGrenade'), null);
  assert.equal(buy(game, t1, 'PetrolBomb'), '4 grenades at most');
  // Defenders buy defuse kits.
  st.money[c1.id] = 1000;
  assert.equal(buy(game, c1, 'kit'), null);
  assert.ok(gearOf(game, c1).kit);
  // Away from the spawn, or after buy time: no.
  until(game, 'live');
  place(t1, 0);
  assert.equal(canShop(game, t1), false);
  assert.equal(whyNot(game, t1, 'Uzi'), 'Go back to your buy zone');
  place(c1, 1100);
  assert.equal(whyNot(game, c1, 'Beretta'), null);
  run(game, DEFUSE.buyTime);
  assert.equal(whyNot(game, c1, 'Beretta'), 'Buy time is over');
  assert.equal(kindOf('AK47'), 'primary');
  assert.equal(kindOf('Beretta'), 'pistol');
  assert.equal(kindOf('Flashbang'), 'grenade');
});

test('magazines: shots use the magazine, it reloads from the spare ammo, R reloads early, and empty is empty', () => {
  const { game, st, t1 } = teams();
  st.money[t1.id] = 5000;
  buy(game, t1, 'AK47');
  until(game, 'live');
  const inv = t1.weapons.AK47;
  inv.mag = 5; inv.ammo = 10;
  t1.inp = { fire: true, aim: -Math.PI / 2 };
  for (let i = 0; i < 5 * SEC && inv.mag > 0; i++) game.update();
  assert.equal(inv.mag, 0);
  assert.ok(t1.reloadTimer > 0, 'reloading by itself');
  t1.inp = {};
  for (let i = 0; i < 10 * SEC && t1.reloadTimer > 0; i++) game.update();
  assert.deepEqual([inv.mag, inv.ammo], [10, 0], 'the rest of the spare ammo went in');
  t1.inp = { fire: true, aim: -Math.PI / 2 };
  for (let i = 0; i < 10 * SEC && t1.current === 'AK47'; i++) game.update();
  assert.equal(inv.mag, 0);
  assert.notEqual(t1.current, 'AK47', 'out of ammo: on to another weapon');
  // R: a half-empty magazine reloads from the spare ammo.
  t1.inp = {};
  Object.assign(inv, { mag: 20, ammo: 30 });
  t1.select('AK47');
  run(game, 30);
  t1.inp = { reload: true };
  game.update();
  t1.inp = {};
  assert.ok(t1.reloadTimer > 0);
  for (let i = 0; i < 10 * SEC && t1.reloadTimer > 0; i++) game.update();
  assert.deepEqual([inv.mag, inv.ammo], [30, 20]);
});

test('the bomb: planted by holding E at a site; the clock stops; it goes off and the attackers win', () => {
  const { game, st, t1, t2, c1, c2, carrier } = teams();
  until(game, 'live');
  const other = carrier === t1 ? t2 : t1;
  assert.equal(useHere(game, carrier), null, 'not at a site yet');
  place(carrier, -300);
  game.update();
  assert.equal(useHere(game, carrier), 'plant');
  assert.equal(useHere(game, other), null, 'only the carrier plants');
  carrier.inp = { use: true };
  const money = Object.fromEntries(game.soldiers.map(s => [s.id, moneyOf(game, s)]));
  run(game, DEFUSE.plantTime + 3);
  assert.equal(st.bomb.s, 'planted');
  assert.equal(st.bomb.site, 'A');
  assert.ok(!carrier.weapons.C4);
  assert.equal(moneyOf(game, carrier) - money[carrier.id], DEFUSE.planterBonus);
  carrier.inp = {};
  // Everyone out of the way but one defender, who's too late.
  place(carrier, -1150); place(other, -1100); place(c2, 1150);
  place(c1, -260);
  const timer = st.timer;
  run(game, SEC);
  assert.equal(st.timer, timer, 'the round clock stops once it\'s planted');
  run(game, DEFUSE.bombTime);
  assert.equal(st.bomb.s, 'exploded');
  assert.equal(st.phase, 'over');
  assert.deepEqual([st.result.team, st.result.why], [1, 'bomb']);
  assert.equal(game.teamScore[1], 1);
  assert.equal(c1.alive, false, 'caught in the blast');
  assert.ok(carrier.alive && c2.alive, 'far enough away');
  assert.equal(c1.frags, 0, 'no frag lost to the bomb');
  // Money: the winners' reward; the losers' bonus for a first loss (the counter starts at 1).
  assert.equal(moneyOf(game, other) - money[other.id], DEFUSE.winBomb);
  assert.equal(moneyOf(game, c2) - money[c2.id], DEFUSE.lossBonus + DEFUSE.lossStep);
});

test('defusing: by the bomb, holding E; 10 seconds, 5 with a kit; letting go starts it again; the defenders win', () => {
  const { game, st, t1, t2, c1, c2, carrier } = teams();
  st.money[c1.id] = 1000;
  buy(game, c1, 'kit');
  until(game, 'live');
  place(carrier, -300);
  carrier.inp = { use: true };
  run(game, DEFUSE.plantTime + 3);
  assert.equal(st.bomb.s, 'planted');
  carrier.inp = {};
  for (const s of [t1, t2]) place(s, -1150 + (s === t1 ? 0 : 50));
  // Without a kit: two seconds in, let go, and it's back to nothing.
  place(c2, st.bomb.x + 6);
  assert.equal(useHere(game, c2), 'defuse');
  assert.equal(useHere(game, t1), null);
  c2.inp = { use: true };
  run(game, 2 * SEC);
  const halfway = st.bomb.defuse;
  assert.ok(Math.abs(halfway - 2 * SEC / DEFUSE.defuseTime) < 0.02, `10 seconds without a kit (${halfway})`);
  assert.ok(c2.inp.use && c2.body.vx === 0, 'held still while defusing');
  c2.inp = {};
  run(game, 2);
  assert.equal(st.bomb.defuse, 0, 'let go: it starts again');
  place(c2, 1150);
  // With a kit: 5 seconds.
  const money = moneyOf(game, c1), tMoney = moneyOf(game, t1);
  place(c1, st.bomb.x - 6);
  c1.inp = { use: true };
  run(game, DEFUSE.kitTime + 3);
  assert.equal(st.bomb.s, 'defused');
  assert.deepEqual([st.result.team, st.result.why], [2, 'defused']);
  assert.equal(moneyOf(game, c1) - money, DEFUSE.winDefuse + DEFUSE.defuserBonus);
  assert.equal(moneyOf(game, t1) - tMoney, DEFUSE.lossBonus + DEFUSE.lossStep + DEFUSE.plantBonus, 'the attackers planted: a bonus on top');
});

test('a side wiped out loses; time running out is the defenders\' round; kill rewards depend on the weapon', () => {
  const { game, st, t1, t2, c1, c2 } = teams();
  until(game, 'live');
  const m = s => moneyOf(game, s);
  let before = m(t1);
  game.kill(c1, t1, 'Knife');
  assert.equal(m(t1) - before, 1500, 'a knife kill');
  before = m(t2);
  game.kill(c2, t2, 'MP5K');
  game.update();
  assert.equal(m(t2) - before, 600 + DEFUSE.winElimination, 'an SMG kill, then the round');
  assert.equal(st.phase, 'over');
  assert.deepEqual([st.result.team, st.result.why], [1, 'elimination']);
  // Next round: everyone back, and nobody does anything until time's up.
  until(game, 'live');
  assert.ok(c1.alive && c2.alive, 'back for the next round');
  assert.ok(t1.weapons.Knife && t1.alive);
  before = m(t1);
  const cBefore = m(c1);
  run(game, DEFUSE.roundTime + 2);
  assert.deepEqual([st.result.team, st.result.why], [2, 'time']);
  assert.equal(m(t1), before, 'attackers who didn\'t plant and are still alive get nothing');
  assert.equal(m(c1) - cBefore, DEFUSE.winTime);
  // Killing a teammate pays nothing.
  until(game, 'live');
  before = m(t1);
  game.kill(t2, t1, 'AK47');
  assert.equal(m(t1), before);
});

test('survivors keep their weapons and armour into the next round; the dead start again with a pistol', () => {
  const { game, st, t1, t2, c1, c2 } = teams();
  st.money[t1.id] = st.money[t2.id] = 5000;
  buy(game, t1, 'AK47'); buy(game, t1, 'kevlar');
  buy(game, t2, 'AK47'); buy(game, t2, 'kevlar');
  until(game, 'live');
  game.kill(t2, c1, 'M4');
  game.kill(c1, t1, 'AK47');
  game.kill(c2, t1, 'AK47');
  game.update();
  assert.equal(st.result.why, 'elimination');
  until(game, 'freeze');
  assert.ok(t1.weapons.AK47 && t1.armour > 0, 'the survivor kept them');
  assert.ok(!t2.weapons.AK47 && t2.armour === 0 && t2.weapons.Platinum, 'the dead start again');
  assert.ok(game.pickups.items.some(it => it.dropped && it.weapon === 'AK47' && it.mag != null), 'their rifle lies where they died');
});

test('the bomb drops when its carrier dies or throws it (G), and attackers pick it up', () => {
  const { game, st, t1, t2, c1, carrier } = teams();
  until(game, 'live');
  const other = carrier === t1 ? t2 : t1;
  place(carrier, 0);
  place(other, -1150);
  run(game, 2);
  game.kill(carrier, c1, 'M4');
  assert.equal(st.bomb.s, 'dropped');
  run(game, 30);
  assert.ok(Math.abs(st.bomb.x) < 40 && Math.abs(st.bomb.y) < 2, 'on the floor where they died');
  place(c1, st.bomb.x);
  run(game, 3);
  assert.equal(st.bomb.s, 'dropped', 'defenders can\'t take it');
  place(c1, 1150);
  place(other, st.bomb.x);
  run(game, 3);
  assert.deepEqual([st.bomb.s, st.bomb.by], ['carried', other.id]);
  assert.ok(other.weapons.C4);
  // G with the bomb in hand: thrown ahead.
  other.select('C4');
  other.inp = { drop: true };
  game.update();
  other.inp = {};
  assert.equal(st.bomb.s, 'dropped');
  assert.ok(!other.weapons.C4);
});

test('G drops the gun in your hands for a teammate; you only pick up a gun of a sort you don\'t have', () => {
  const { game, st, t1, t2, c1 } = teams();
  st.money[t1.id] = st.money[t2.id] = 9000;
  buy(game, t1, 'AK47');
  buy(game, t2, 'MP5K');
  until(game, 'live');
  place(t1, 0); place(t2, 0); place(c1, 600);
  run(game, 2);
  t1.weapons.AK47.mag = 17;
  t1.inp = { drop: true };
  game.update();
  t1.inp = {};
  assert.ok(!t1.weapons.AK47, 'dropped');
  const it = game.pickups.items.find(i => i.weapon === 'AK47');
  assert.ok(it && it.mag === 17, 'with what was in the magazine');
  run(game, 60);
  assert.ok(!t1.weapons.AK47, 'not straight back up');
  assert.ok(!t2.weapons.AK47, 'a teammate with an SMG doesn\'t take it');
  place(c1, it.x);
  run(game, 3);
  assert.equal(c1.weapons.AK47?.mag, 17, 'anyone without a rifle or SMG does (the other side too)');
});

test('half time: sides swap and money starts again; level at the end, overtime with $10,000 each', () => {
  const game = arena(3);
  const a = player(game, 'A', 1), b = player(game, 'B', 2);
  const st = game.modeState;
  /** Team `win` takes the round (the other team's soldier is killed). */
  const round = win => {
    until(game, 'live');
    const [w, l] = win === 1 ? [a, b] : [b, a];
    game.kill(l, w, 'Knife');
    game.update();
    assert.equal(st.phase, 'over');
  };
  round(1);
  round(2);
  until(game, 'freeze');
  assert.equal(st.round, 3);
  assert.equal(st.t, 2, 'half time: red attacks now');
  assert.equal(sideOf(game, 1), 'CT');
  assert.equal(moneyOf(game, a), DEFUSE.startMoney);
  assert.equal(moneyOf(game, b), DEFUSE.startMoney);
  assert.ok(a.weapons.Platinum && a.weapons.Knife, 'back to the basics');
  round(1);
  round(2);
  until(game, 'freeze');
  assert.equal(st.ot, 1, '2-2 with first to 3: overtime');
  assert.equal(st.t, 1, 'sides swap again for overtime');
  assert.equal(moneyOf(game, a), DEFUSE.overtimeMoney);
  assert.equal(MODES.defuse.needed(game), 6, 'four rounds of the next six');
  round(1); round(1); round(1);
  until(game, 'freeze');
  assert.equal(st.t, 2, 'overtime\'s half time');
  assert.equal(game.over, false);
  round(1);
  for (let i = 0; i < 20 * SEC && !game.over; i++) game.update();
  assert.ok(game.over, 'won it');
  assert.equal(game.winner.team, 1);
  assert.equal(game.teamScore[1], 6);
  assert.deepEqual(st.history.slice(0, 2), ['1te', '2ce']);
});

test('flashbangs blind those who see them go off (less if they look away); smoke hides people from bots', () => {
  const { game, t1, t2, c1, c2 } = teams();
  until(game, 'live');
  place(t1, 0); place(t2, 300); place(c1, -300); place(c2, 900);
  run(game, 2);
  t1.facing = 1; c1.facing = -1;
  flash(game, 150, -14, WEAPONS.Flashbang.flash);
  assert.ok(t1.flashTicks > 60, 'facing it: blinded');
  assert.ok(c1.flashTicks > 0 && c1.flashTicks < t1.flashTicks, 'looking away: less');
  assert.equal(c2.flashTicks || 0, 0, 'too far');
  // A blinded bot sees nobody.
  const nav = new NavGraph(game.map);
  const bot = new BotController(nav, 'normal', BOT_PROFILES[0], makeRng(3));
  bot.reset();
  bot.perceive(game, t1);
  assert.equal(bot.target, null);
  t1.flashTicks = 0;
  bot.perceive(game, t1);
  assert.ok(bot.target, 'sees again once it wears off');
  // Smoke: a big cloud between them blocks sight (not bullets).
  assert.equal(smokeBetween(game, t1.x, t1.y - 12, c2.x, c2.y - 12), false);
  game.projectiles.push({ kind: 'cloud', x: 600, y: -40, r: 100, cfg: WEAPONS.SmokeGrenade.smoke, life: 600, age: 0, vx: 0, vy: 0 });
  game.tick++;
  assert.equal(smokeBetween(game, t1.x, t1.y - 12, c2.x, c2.y - 12), true);
  assert.equal(bot.canSee(game, t1, c2), false);
  assert.equal(bot.canSee(game, t1, t2), true, 'the cloud isn\'t in the way of this one');
});

test('maps keep their bomb sites in files and share links; maps without them get two', async () => {
  const m = normalizeMap({ ...ARENA, objectives: [{ type: 'site', left: 300, top: 0, right: 100, bottom: -90 }, { type: 'site', label: 'B', left: -300, top: -90, right: -100, bottom: 0 }] });
  assert.deepEqual(m.objectives.map(o => [o.type, o.label, o.left, o.right]), [['site', 'A', 100, 300], ['site', 'B', -300, -100]]);
  const back = normalizeMap(await decodeShare(await encodeShare(m)));
  assert.deepEqual(back.objectives, m.objectives);
  for (const file of ['crossfire.json', 'ssdm1.json']) {
    const g = new Game({ mapData: loadMap(file), mode: 'defuse', fragLimit: 7, effects: false, seed: 1, speed: DEFAULT_SPEED });
    const sites = objectivesOf(g.map, 'site');
    assert.equal(sites.length, 2, `${file}: two sites`);
    assert.deepEqual(sites.map(z => z.label), ['A', 'B']);
  }
});

test('online: the inputs carry E, G and R; snapshots carry magazines, flashbangs and the mode\'s money and bomb', () => {
  const [i] = decodeInputs(encodeInputs([{ seq: 1, use: true, drop: true, reload: true }]));
  assert.ok(i.use && i.drop && i.reload);
  const { game, st, t1 } = teams();
  st.money[t1.id] = 4000;
  buy(game, t1, 'AK47');
  t1.weapons.AK47.mag = 7;
  t1.flashTicks = 100; t1.flashFull = 160;
  const snap = decodeSnapshot(encodeSnapshot(game, t1, 1, encodeWorld(game)));
  assert.deepEqual(snap.me.weapons.AK47, { ammo: 90, mag: 7 });
  assert.equal(snap.me.weapons.Knife.mag, undefined);
  assert.deepEqual([snap.me.flashTicks, snap.me.flashFull], [100, 160]);
  assert.equal(snap.mode.money[t1.id], 1300);
  assert.equal(snap.mode.bomb.s, 'carried');
  assert.equal(snap.mode.phase, 'freeze');
});

test('online: a player buys through the host, which checks they can', async () => {
  const mapData = ARENA;
  const game = arena(7, mapData);
  const rng = makeRng(5);
  let now = 0;
  const queue = [];
  const schedule = (fn, ms) => queue.push({ at: now + ms, fn });
  const host = new NetHost({
    maxPlayers: 4, botCount: 0,
    matchInfo: () => ({ mode: 'defuse', fragLimit: 7, options: game.options, speed: DEFAULT_SPEED, map: { builtin: 'arena' }, mapName: 'arena' }),
    addBot: () => {},
  });
  const me = player(game, 'Host', 1);
  host.setGame(game);
  const [h, c] = memoryLinks({ schedule, rng: makeRng(9) });
  const idle = { input: () => ({ move: 0, aim: 0, aimDist: 200 }) };
  const client = new NetClient({ link: c, controller: idle, loadMap: async () => mapData, clock: () => now });
  host.addPlayer(h, 'Guest');
  const pump = async () => {
    for (let k = 0; k < 4; k++) {
      await new Promise(r => setImmediate(r));
      const due = queue.filter(q => q.at <= now);
      for (const q of due) { queue.splice(queue.indexOf(q), 1); q.fn(); }
    }
  };
  const step = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      game.update();
      host.afterTick();
      client.tick();
      now += 1000 / 60;
      await pump();
      client.updateView(now);
    }
  };
  await pump();
  await step(40);
  assert.equal(game.modeState.phase, 'freeze');
  const guest = game.soldiers.find(s => s.id === client.me.id);
  assert.ok(guest && guest.alive, 'the guest is in the round');
  client.sendBuy('kevlar');
  client.sendBuy('Minigun');   // (can't afford it)
  await step(10);
  assert.equal(guest.armour, 100);
  assert.equal(moneyOf(game, guest), DEFUSE.startMoney - GEAR.kevlar.price);
  assert.ok(!guest.weapons.Minigun);
  assert.equal(client.game.modeState.money[guest.id], DEFUSE.startMoney - GEAR.kevlar.price, 'the player sees their money');
  assert.ok(game.notes.some(n => n.to === guest.id && /Not enough money/.test(n.text)), 'and why they couldn\'t buy the minigun');
  void rng; void me;
});

test('bots play a whole Defuse match: they buy, plant, defuse or blow it up, and someone wins', () => {
  const { game } = botMatch('crossfire.json', { bots: 8, mode: 'defuse', fragLimit: 4, seed: 3 });
  let planted = 0, rifles = 0, lastRound = 0;
  const st = () => game.modeState;
  for (let i = 0; i < 40 * 60 * SEC && !game.over; i++) {
    const b = st().bomb.s;
    game.update();
    if (b !== 'planted' && st().bomb.s === 'planted') planted++;
    if (st().round !== lastRound && st().phase === 'live') {
      lastRound = st().round;
      rifles += game.soldiers.filter(s => s.weapons.AK47 || s.weapons.M4 || s.weapons.SR).length;
    }
  }
  assert.ok(game.over, `finished (round ${st().round}, ${game.teamScore[1]}-${game.teamScore[2]})`);
  assert.ok(Math.max(game.teamScore[1], game.teamScore[2]) >= 4);
  assert.ok(planted > 0, 'the bomb was planted at least once');
  assert.ok(rifles > 0, 'bots bought rifles once they had the money');
});

test('every built-in map can host Defuse: two bomb sites and spawns for both sides', () => {
  for (const { file } of mapIndex()) {
    const g = new Game({ mapData: loadMap(file), mode: 'defuse', fragLimit: 7, effects: false, seed: 1, speed: DEFAULT_SPEED });
    assert.equal(objectivesOf(g.map, 'site').length, 2, `${file} has two bomb sites`);
  }
});
