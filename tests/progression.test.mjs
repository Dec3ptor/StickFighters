// Progression: XP for what you do, ranks, unlocks and the profile saved in the browser. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { damage } from '../web/src/combat.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { CLASS_IDS } from '../web/src/classes.js';
import {
  XP, XP_LABEL, RANKS, rankOf, classRankOf, CLASS_RANK_XP, mainUnlocked, upgradeUnlocked, upgradeKills, playLoadouts,
  newProfile, loadProfile, saveProfile, cleanProfile, PROFILE_KEY, MatchXp, unlocksOf, nextMain, nextUpgrade,
} from '../web/src/progression.js';

const SEC = 60;
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

function arena(mode, { classes = true, fragLimit = 0 } = {}) {
  const map = {
    name: 'arena', bounds: { left: -900, top: -400, right: 900, bottom: 200 },
    platforms: [{ left: -900, top: 0, right: 900, bottom: 40 }],
    spawns: [{ x: -800, y: -12, team: 1 }, { x: 800, y: -12, team: 2 }], items: [], objectives: OBJECTIVES,
  };
  return new Game({ mapData: map, mode, fragLimit, effects: false, seed: 4, speed: DEFAULT_SPEED, options: { classes } });
}
function put(game, name, team, x, { bot = false, cls = 'assault' } = {}) {
  const s = game.addSoldier({ name, isBot: bot, team }, { input: () => ({ move: 0 }) });
  s.pickCls = cls;
  game.respawn(s);
  place(s, x);
  return s;
}
function place(s, x, y = -12) {
  s.body.x = x; s.body.y = y; s.body.vx = s.body.vy = 0; s.prevX = x; s.prevY = y;
  s.spawnProtect = 0;
}
const run = (game, ticks) => { for (let i = 0; i < ticks; i++) game.update(); };
const whys = (game, s) => game.xpLog.filter(e => e.to === s.id).map(e => e.why);
/** Carry a flag home from x: walked in steps (a jump of over 120 px in one update drops it). */
function carryHome(game, s, x) {
  for (; x >= -700; x -= 100) { place(s, x); game.update(); }
  place(s, -700);
  game.update();
}

/** A stand-in for localStorage. */
function memoryStore() {
  const data = new Map();
  return { data, getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
}

test('XP for kills and headshots: players only, and only with classes on', () => {
  const game = arena('ffa', { fragLimit: 99 });
  const a = put(game, 'A', 0, -200, { cls: 'recon' });
  const bot = put(game, 'Bot', 0, 200, { bot: true });
  damage(game, bot, 1000, a, 'SR', { headshot: true });
  const mine = game.xpLog.filter(e => e.to === a.id);
  assert.deepEqual(mine.map(e => [e.why, e.n, e.w, e.c]), [['kill', XP.kill, 'SR', 'recon'], ['headshot', XP.headshot, 'SR', 'recon']]);
  run(game, 200);
  damage(game, a, 1000, bot, 'M4');
  assert.equal(game.xpLog.filter(e => e.to === bot.id).length, 0, 'bots don\'t earn XP');
  // Classes off: the classic game has no XP at all.
  const classic = arena('ffa', { classes: false, fragLimit: 99 });
  const c = put(classic, 'C', 0, -200), d = put(classic, 'D', 0, 200);
  damage(classic, d, 1000, c, 'M4', { headshot: true });
  assert.equal(classic.xpLog.length, 0);
});

test('objective XP: capturing a point, the hill, taking and capturing a flag, arming and disarming an M-COM', () => {
  const cq = arena('conquest');
  const capper = put(cq, 'Capper', 1, -400);
  put(cq, 'Red', 2, 800, { bot: true });
  run(cq, 8 * SEC);
  assert.ok(whys(cq, capper).includes('capture'), `conquest: ${whys(cq, capper)}`);
  assert.equal(cq.xpLog.find(e => e.why === 'capture').n, XP.capture);

  const koth = arena('koth', { fragLimit: 99 });
  const king = put(koth, 'King', 1, 0);
  put(koth, 'Red', 2, -400, { bot: true });
  run(koth, 3 * SEC + 2);
  assert.deepEqual(whys(koth, king), ['hill', 'hill', 'hill'], 'a little XP every second on the hill');

  const ctf = arena('ctf', { fragLimit: 9 });
  const runner = put(ctf, 'Runner', 1, 700);
  put(ctf, 'Red', 2, 0, { bot: true });
  run(ctf, 2);
  assert.ok(whys(ctf, runner).includes('flagTake'), 'took the flag');
  carryHome(ctf, runner, 700);
  assert.ok(whys(ctf, runner).includes('flagCapture'), 'captured it');

  const rush = arena('rush');
  const blue = put(rush, 'Blue', 1, 200);
  const red = put(rush, 'Red', 2, -800);
  run(rush, 2 * SEC + 3);
  assert.ok(whys(rush, blue).includes('arm'), 'armed the M-COM');
  place(blue, -800);
  place(red, 200);
  run(rush, 7 * SEC + 3);
  assert.ok(whys(rush, red).includes('disarm'), 'disarmed it');
});

test('finishing a match earns XP, and winning more', () => {
  const game = arena('ffa', { fragLimit: 1 });
  const a = put(game, 'A', 0, -200), b = put(game, 'B', 0, 200);
  damage(game, b, 1000, a, 'M4');
  assert.ok(game.over);
  assert.deepEqual(whys(game, a), ['kill', 'finish', 'win']);
  assert.deepEqual(whys(game, b), ['finish']);
  const team = arena('ctf', { fragLimit: 1 });
  const r = put(team, 'Runner', 1, 700), mate = put(team, 'Mate', 1, -300), foe = put(team, 'Foe', 2, 300);
  run(team, 2);
  carryHome(team, r, 700);
  assert.ok(team.over);
  assert.ok(whys(team, mate).includes('win'), 'the whole winning team');
  assert.ok(!whys(team, foe).includes('win') && whys(team, foe).includes('finish'));
});

test('ranks from total XP, and class ranks from XP as that class', () => {
  assert.equal(rankOf(0).name, 'Recruit');
  assert.equal(rankOf(999).rank, 0);
  assert.equal(rankOf(1000).rank, 1);
  assert.equal(rankOf(2500).rank, 2);
  const top = rankOf(1e9);
  assert.equal(top.name, RANKS.at(-1));
  assert.equal(top.next, null);
  for (let r = 1; r < RANKS.length; r++) assert.ok(rankOf(r * 1000).at < rankOf(r * 1000).next || rankOf(r * 1000).next === null);
  assert.equal(classRankOf(0).rank, 0);
  assert.equal(classRankOf(CLASS_RANK_XP[1]).rank, 1);
  assert.equal(classRankOf(1e9).rank, CLASS_RANK_XP.length - 1);
  for (const why of Object.keys(XP)) assert.ok(XP_LABEL[why], `${why} has a label`);
});

test('unlocks: main weapons by class rank, upgrades by kills with the weapon', () => {
  const p = newProfile();
  assert.ok(mainUnlocked(p, 'assault', 'M4'));
  assert.ok(!mainUnlocked(p, 'assault', 'Shotgun'));
  assert.ok(!mainUnlocked(p, 'engineer', 'HomingMissile'));
  assert.ok(!mainUnlocked(p, 'assault', 'Bazooka'), 'not one of its weapons');
  assert.deepEqual(nextMain(p, 'engineer'), { id: 'HomingMissile', rank: 1, xpLeft: CLASS_RANK_XP[1] });
  p.classXp.engineer = CLASS_RANK_XP[1];
  assert.ok(mainUnlocked(p, 'engineer', 'HomingMissile'));
  assert.ok(!mainUnlocked(p, 'engineer', 'Mortar'));
  assert.equal(upgradeKills('M4', 'steady'), 5);
  assert.equal(upgradeKills('M4', 'quick'), 50);
  assert.equal(upgradeKills('Bazooka', 'charge'), 3);
  assert.equal(upgradeKills('M4', 'charge'), Infinity);
  assert.ok(!upgradeUnlocked(p, 'M4', 'steady'));
  p.kills.M4 = 5;
  assert.ok(upgradeUnlocked(p, 'M4', 'steady') && !upgradeUnlocked(p, 'M4', 'extmag'));
  assert.deepEqual(nextUpgrade(p, 'M4'), { up: 'extmag', kills: 15, left: 10 });
  // What's played (and sent to the host) leaves out anything not unlocked.
  p.loadouts.engineer = { main: 'Mortar', ups: { Mortar: 'charge' } };
  p.loadouts.assault = { main: 'M4', ups: { M4: 'extmag', Platinum: 'steady' } };
  const lo = playLoadouts(p);
  assert.equal(lo.engineer.main, 'Bazooka', 'the mortar is still locked');
  assert.deepEqual(lo.assault.ups, {}, 'extended mag needs 15 kills; the pistol has none');
  p.loadouts.engineer = { main: 'HomingMissile', ups: {} };
  assert.equal(playLoadouts(p).engineer.main, 'HomingMissile');
  assert.ok(unlocksOf(p).some(u => u.key === 'main:engineer:HomingMissile'));
  assert.ok(unlocksOf(p).some(u => u.key === 'up:M4:steady'));
});

test('the profile is saved in the browser, apart from the settings, and loads safely', () => {
  const store = memoryStore();
  store.setItem('stick-soldiers', '{"name":"Me"}');
  const p = loadProfile(store);
  assert.deepEqual(p, newProfile(), 'a new profile to start with');
  const xp = new MatchXp(p, { save: q => saveProfile(q, store) });
  xp.add({ n: 100, why: 'kill', w: 'M4', c: 'assault' });
  xp.add({ n: 50, why: 'headshot', w: 'M4', c: 'assault' });
  assert.equal(PROFILE_KEY, 'stick-soldiers-profile');
  assert.equal(store.getItem('stick-soldiers'), '{"name":"Me"}', 'the settings are left alone');
  const back = loadProfile(store);
  assert.equal(back.xp, 150);
  assert.equal(back.classXp.assault, 150);
  assert.equal(back.kills.M4, 1, 'a kill with the M4 (not counting the headshot twice)');
  // Rubbish in storage: a fresh (or tidied) profile.
  store.setItem(PROFILE_KEY, '{not json');
  assert.deepEqual(loadProfile(store), newProfile());
  const odd = cleanProfile({ xp: -5, classXp: { assault: 'lots', wizard: 9 }, kills: { M4: 3.7, Nope: 9 }, cls: 'wizard', loadouts: { recon: { main: 'Longbow' } } });
  assert.equal(odd.xp, 0);
  assert.equal(odd.classXp.assault, 0);
  assert.ok(!('wizard' in odd.classXp));
  assert.deepEqual(odd.kills, { M4: 3 });
  assert.equal(odd.cls, 'assault');
  assert.equal(odd.loadouts.recon.main, 'Longbow');
  assert.deepEqual(Object.keys(odd.loadouts).sort(), [...CLASS_IDS].sort());
  // No storage at all (private browsing): still works.
  assert.deepEqual(loadProfile(null), newProfile());
  saveProfile(newProfile(), { setItem() { throw new Error('full'); } });
});

test('a match\'s XP: pop-ups add up, and the summary gives XP by reason, rank progress and new unlocks', () => {
  let now = 0;
  const p = newProfile();
  p.xp = 900;
  p.classXp.assault = CLASS_RANK_XP[1] - 100;
  p.kills.M4 = 4;
  const xp = new MatchXp(p, { save: () => {}, now: () => now });
  xp.add({ n: XP.kill, why: 'kill', w: 'M4', c: 'assault' });
  now += 500;
  xp.add({ n: XP.kill, why: 'kill', w: 'M4', c: 'assault' });
  assert.deepEqual(xp.showing().map(x => x.text), ['+200 Kill'], 'close together: added up');
  now += 3000;
  assert.deepEqual(xp.showing(), [], 'gone after a couple of seconds');
  xp.add({ n: XP.heal, why: 'heal', c: 'assault' });
  xp.add({ n: XP.finish, why: 'finish', c: 'assault' });
  xp.add({ n: 99, why: 'nonsense' });
  const sum = xp.summary();
  assert.equal(sum.total, 200 + XP.heal + XP.finish);
  assert.deepEqual(sum.reasons.map(r => [r.label, r.count]), [['Kill', 2], ['Heal', 1], ['Match completed', 1]]);
  assert.equal(sum.rank.before.rank, 0);
  assert.equal(sum.rank.after.rank, 1, 'ranked up');
  assert.deepEqual(sum.classes.map(c => [c.cls, c.before.rank, c.after.rank]), [['assault', 0, 1]]);
  const texts = sum.unlocked.map(u => u.text);
  assert.ok(texts.includes('Shotgun for Assault'), texts.join('; '));
  assert.ok(texts.includes('Steady grip for the M4 Carbine'), texts.join('; '));
  assert.equal(p.matches, 1);
});
