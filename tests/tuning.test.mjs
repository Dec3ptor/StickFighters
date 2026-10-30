// The developer menu's numbers (tuning.js): changed live, at full speed (scaled for the
// game's 75%), copied out as JSON and pasted back in, and online, the host's in use. Run with: npm test
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  tuningSections, tuningField, setTuning, resetTuning, resetAllTuning, changedCount, exportTuning, importTuning,
  tuningToShare, useHostTuning, useOwnTuning, usingHostTuning, tuningVersion,
} from '../web/src/tuning.js';
import { PHYS, RULES, ITEM_RESPAWN, DEFAULT_SPEED } from '../web/src/config.js';
import { WEAPONS } from '../web/src/weapons.js';
import { DIFFICULTY, BOT_VIEW, BOT_PROFILES } from '../web/src/bot.js';
import { REWARDS } from '../web/src/streaks.js';
import { setGameSpeed } from '../web/src/speed.js';
import { Game } from '../web/src/game.js';

afterEach(() => { useOwnTuning(); resetAllTuning(); setGameSpeed(1); });

const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);
const arena = () => new Game({
  mapData: { name: 'arena', bounds: { left: -400, top: -300, right: 400, bottom: 200 }, spawns: [{ x: 0, y: -12 }], items: [], platforms: [{ left: -400, top: 0, right: 400, bottom: 40 }] },
  mode: 'ffa', effects: false, seed: 1, speed: DEFAULT_SPEED,
});

test('the menu has every part of the game, each number with its default', () => {
  const sections = tuningSections();
  assert.deepEqual(sections.map(s => s.id), ['movement', 'rules', 'weapons', 'bots', 'pickups']);
  const all = sections.flatMap(s => s.groups.flatMap(g => g.paths));
  assert.ok(all.length > 300, `${all.length} numbers`);
  const keys = new Set(all.map(p => p.join('.')));
  for (const k of ['PHYS.runSpeed', 'PHYS.jumpSpeed', 'RULES.maxHealth', 'RULES.headshotMultiplier', 'WEAPONS.M4.damage', 'WEAPONS.Bazooka.blast.radius',
    'WEAPONS.M4.cs.price', 'WEAPONS.M4.bot.far', 'BOTS.normal.reaction', 'BOT_VIEW.sight', 'BOT_PROFILES.Grunt.acc', 'ITEM_RESPAWN.health', 'CRATES.normal.every', 'REWARDS.supply.kills']) {
    assert.ok(keys.has(k), k);
  }
  assert.ok(!keys.has('WEAPONS.M4.slot') && !keys.has('WEAPONS.M4.look.length') && !keys.has('PHYS.maxStep'), 'not drawing or engine numbers');
  const f = tuningField(['PHYS', 'runSpeed']);
  assert.equal(f.def, 3.4);
  assert.equal(f.value, 3.4);
  assert.ok(!f.changed && f.label === 'Run speed');
  near(tuningField(['WEAPONS', 'M4', 'spread']).def, 2.2, 'spread shown in degrees');
});

test('a change shows in the game at once, scaled for its speed; reset puts it back', () => {
  const v0 = tuningVersion();
  setTuning(['PHYS', 'runSpeed'], 4);
  assert.ok(tuningVersion() > v0);
  near(PHYS.runSpeed, 4, 'at full speed');
  arena();
  near(PHYS.runSpeed, 4 * DEFAULT_SPEED, 'a match at 75%');
  // Numbers the speed doesn't scale apply too, and stay through new matches.
  setTuning(['PHYS', 'stepUp'], 14);
  setTuning(['RULES', 'maxHealth'], 200);
  const g = arena();
  assert.equal(PHYS.stepUp, 14);
  assert.equal(RULES.maxHealth, 200);
  const s = g.addSoldier({ name: 'A' }, null);
  assert.equal(s.maxHealth, 200, 'new soldiers get the new health');
  // Weapons: straight away; spread typed in degrees.
  setTuning(['WEAPONS', 'M4', 'damage'], 20);
  setTuning(['WEAPONS', 'M4', 'spread'], 5);
  assert.equal(WEAPONS.M4.damage, 20);
  near(WEAPONS.M4.spread, 5 * Math.PI / 180, 'spread in radians');
  near(WEAPONS.M4.rof, 8 / DEFAULT_SPEED, 'the rest of the gun as it was (scaled)');
  // Kept in range: health at most 255 (it's sent online in a byte), whole numbers where they should be.
  assert.equal(setTuning(['RULES', 'maxHealth'], 999), 255);
  assert.equal(setTuning(['WEAPONS', 'M4', 'ammo'], 12.7), 13);
  assert.equal(setTuning(['PHYS', 'gravity'], -3), 0);
  assert.equal(setTuning(['WEAPONS', 'M4', 'name'], 3), null, 'not a number');
  assert.equal(setTuning(['WEAPONS', 'M4', 'slot'], 3), null, 'not tuning');
  // (Run speed, step-up, health, the M4's damage, spread and ammo, and gravity, kept at 0.)
  assert.equal(changedCount(), 7);
  assert.equal(changedCount(['WEAPONS', 'M4']), 3);
  resetTuning(['PHYS', 'runSpeed']);
  near(PHYS.runSpeed, 3.4 * DEFAULT_SPEED, 'back');
  resetAllTuning();
  assert.equal(changedCount(), 0);
  assert.equal(RULES.maxHealth, 150);
  assert.equal(WEAPONS.M4.damage, 12);
});

test('bots, pickups and kill streaks change too', () => {
  setTuning(['BOTS', 'normal', 'reaction'], 12);
  setTuning(['BOT_VIEW', 'sight'], 900);
  setTuning(['BOT_PROFILES', 'Grunt', 'skill'], 3);
  setTuning(['ITEM_RESPAWN', 'health'], 300);
  setTuning(['REWARDS', 'supply', 'kills'], 2);
  assert.equal(DIFFICULTY.normal.reaction, 12);
  assert.equal(BOT_VIEW.sight, 900);
  assert.equal(BOT_PROFILES.find(p => p.name === 'Grunt').skill, 3);
  assert.equal(ITEM_RESPAWN.health, 300);
  assert.equal(REWARDS.supply.kills, 2);
  resetAllTuning();
  assert.equal(DIFFICULTY.normal.reaction, 30);
  assert.equal(BOT_VIEW.sight, 1300);
  assert.equal(REWARDS.supply.kills, 3);
});

test('copied out as JSON and pasted back in; anything else is left out', () => {
  setTuning(['PHYS', 'jumpSpeed'], 11);
  setTuning(['WEAPONS', 'Bazooka', 'blast', 'radius'], 120);
  setTuning(['BOTS', 'hard', 'turn'], 0.3);
  const text = exportTuning();
  const json = JSON.parse(text);
  assert.equal(json.stickSoldiersTuning, 1);
  assert.deepEqual(json.PHYS, { jumpSpeed: 11 });
  assert.deepEqual(json.WEAPONS, { Bazooka: { blast: { radius: 120 } } });
  assert.deepEqual(json.BOTS, { hard: { turn: 0.3 } });
  // Everything: every number, changed or not.
  const all = JSON.parse(exportTuning({ all: true }));
  assert.equal(all.PHYS.runSpeed, 3.4);
  assert.equal(all.PHYS.jumpSpeed, 11);
  resetAllTuning();
  const r = importTuning(text);
  assert.equal(r.applied, 3);
  assert.equal(PHYS.jumpSpeed, 11);
  assert.equal(changedCount(), 3);
  // Unknown numbers, things that aren't numbers, and attempts at the objects' insides are skipped.
  const bad = importTuning('{"PHYS":{"runSpeed":"fast","nope":3},"WEAPONS":{"M4":{"damage":15}},"__proto__":{"polluted":1},"constructor":{"x":1}}');
  assert.equal(bad.applied, 1);
  assert.ok(bad.skipped.includes('PHYS.runSpeed') && bad.skipped.includes('PHYS.nope'));
  assert.equal(WEAPONS.M4.damage, 15);
  assert.equal({}.polluted, undefined, 'no prototype pollution');
  assert.ok(importTuning('not json').error);
  // Replace: in place of the changes there were.
  importTuning({ RULES: { respawnTicks: 60 } }, { replace: true });
  assert.equal(changedCount(), 1);
  assert.equal(PHYS.jumpSpeed, 9.53);
});

test('online: everyone plays by the host\'s numbers; your own come back for your own games', () => {
  setTuning(['PHYS', 'runSpeed'], 4);
  const share = tuningToShare();
  assert.deepEqual(share, { PHYS: { runSpeed: 4 } });
  // Joining someone else's game, with their numbers (and none of ours).
  useHostTuning({ PHYS: { gravity: 0.6 }, WEAPONS: { M4: { damage: 30 } } });
  assert.ok(usingHostTuning());
  near(PHYS.runSpeed, 3.4, 'our run speed isn\'t used');
  near(PHYS.gravity, 0.6, 'theirs is');
  assert.equal(WEAPONS.M4.damage, 30);
  // A change made meanwhile is kept for later, not used here.
  setTuning(['PHYS', 'jumpSpeed'], 12);
  near(PHYS.jumpSpeed, 9.53, 'not in their game');
  // A host with no changes: the game's own numbers.
  useHostTuning(null);
  near(PHYS.gravity, 0.45, 'defaults');
  useOwnTuning();
  assert.ok(!usingHostTuning());
  near(PHYS.runSpeed, 4, 'ours again');
  near(PHYS.jumpSpeed, 12, 'with the change made meanwhile');
  near(PHYS.gravity, 0.45, 'and not theirs');
});
