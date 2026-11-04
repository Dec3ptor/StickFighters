// A sniper's views (web/src/scope.js), the same in a match and in a world: where a shot would end
// (the first solid thing in the way, glass too, or as far as it goes; in a world, short of land not
// made yet), the wheel taking the camera there (the far view) and back to the sniper view; how far shots go (combat.js's shotReach: an arrow, as far as it carries); and in the
// far view, what the shooter can't see from where they stand, or that's further than the shot goes,
// darkened and hidden (fog.js, worldrender.js's sightFrom). And which guns have a scope in a world
// (attachments.js): a sniper rifle has its own, a fitted one taking over.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { TileWorld, TILE } from '../web/src/world/tileworld.js';
import * as K from '../web/src/world/blocks.js';
import { newScopeView, shotEnd, lookFar, scopeWheel, SCOPE_OFF, SCOPE_SNIPER, SCOPE_FAR } from '../web/src/scope.js';
import { scopeOf, OWN_SCOPES, ATTACHMENTS } from '../web/src/world/attachments.js';
import { shotReach, laserEnd } from '../web/src/combat.js';
import { WEAPONS } from '../web/src/weapons.js';
import { sightFrom } from '../web/src/world/worldrender.js';
import { Fog } from '../web/src/fog.js';

/** A world with a stone floor, open air over it for 200 tiles each way and 40 up. */
function flat() {
  const world = new TileWorld({ seed: 77, name: 'Range', gen: 7 });
  const fy = 200;
  for (let x = -200; x <= 200; x++) {
    for (let y = fy - 40; y <= fy + 2; y++) world.setTile(x, y, y >= fy ? K.STONE : K.AIR);
  }
  // (Someone standing on the floor in the middle: their shoulder.)
  return { world, game: { world, map: world }, fy, s: { shoulderX: 8, shoulderY: fy * TILE - 26 } };
}

/** A match's map: a floor, and a wall 600 px to the right. */
function arena() {
  const map = { name: 'arena', bounds: { left: -400, top: -600, right: 3000, bottom: 200 }, spawns: [{ x: 0, y: -12, team: 1 }], items: [],
    platforms: [{ left: -400, top: 0, right: 3000, bottom: 40 }, { left: 600, top: -300, right: 640, bottom: 0 }] };
  return new Game({ mapData: map, effects: false, seed: 3, speed: DEFAULT_SPEED, mode: 'ffa' });
}

test('where a shot ends: what\'s in the way (glass too), or as far as it goes; in a world, short of land not made yet', () => {
  const m = flat(), { s } = m, wall = 20;
  for (let y = m.fy - 40; y < m.fy; y++) m.world.setTile(wall, y, K.STONE);
  const end = shotEnd(m.game, s.shoulderX, s.shoulderY, 0, 2000);
  assert.ok(end.hit && Math.abs(end.x - wall * TILE) < 1, `stopped by the wall (${end.x})`);
  assert.ok(Math.abs(end.d - (wall * TILE - s.shoulderX)) < 1);
  // (Up into the open: as far as it goes.)
  const up = shotEnd(m.game, s.shoulderX, s.shoulderY, -Math.PI / 2 + 0.3, 400);
  assert.ok(!up.hit && Math.abs(up.d - 400) < 1e-6, 'nothing in the way: all the way');
  // (Glass: seen through, but a shot stops at it.)
  for (let y = m.fy - 40; y < m.fy; y++) m.world.setTile(wall, y, K.GLASS);
  assert.ok(shotEnd(m.game, s.shoulderX, s.shoulderY, 0, 2000).hit, 'glass stops a shot');
  assert.equal(m.world.sight(s.shoulderX, s.shoulderY, (wall + 5) * TILE, s.shoulderY), 1, 'and is seen through');
  // (Land not made yet: no further, for now.)
  for (let y = m.fy - 40; y < m.fy; y++) m.world.setTile(wall, y, K.AIR);
  const edge = (Math.floor(200 / 32) + 1) * 32 * TILE, far = shotEnd(m.game, s.shoulderX, s.shoulderY, 0, 20000);
  assert.ok(far.hit && far.x <= edge + 1, `stopped where the made land ends (${far.x}, ${edge})`);
  // (A match's map: its blocks.)
  const g = arena();
  const hit = shotEnd(g, 0, -20, 0, 2200);
  assert.ok(hit.hit && Math.abs(hit.x - 600) < 1, `the wall in a match (${hit.x})`);
  const miss = shotEnd(g, 0, -20, -0.6, 500);
  assert.ok(!miss.hit && Math.abs(miss.d - 500) < 1e-6);
});

test('the wheel: up, the far view, where the shot ends (then staying put; up again, on to where the aim ends now); down, back to the sniper view', () => {
  const m = flat(), { s: sh } = m, sr = WEAPONS.SR;
  for (let y = m.fy - 40; y < m.fy; y++) m.world.setTile(30, y, K.STONE);
  const sv = newScopeView();
  let aim = 0;
  const at = () => [sh.shoulderX, sh.shoulderY, aim];
  assert.equal(sv.mode, SCOPE_OFF);
  scopeWheel(sv, -1, m.game, null, sr, at);
  assert.equal(sv.mode, SCOPE_OFF, 'not looking: nothing');
  sv.mode = SCOPE_SNIPER;
  scopeWheel(sv, -1, m.game, null, sr, at);
  assert.equal(sv.mode, SCOPE_FAR, 'up: the far view');
  assert.ok(sv.fresh, 'the camera to go there (once)');
  assert.ok(sv.end.hit && Math.abs(sv.x - 30 * TILE) < 1 && sv.y === sv.end.y, 'where the shot ends: the wall');
  assert.equal(sv.reach, shotReach(sr));
  // (Aimed elsewhere: nothing moves; the wheel up again, on to where that shot ends, no further than it goes.)
  const was = { x: sv.x, y: sv.y };
  aim = -0.25;
  assert.deepEqual({ x: sv.x, y: sv.y }, was, 'staying put as the aim moves');
  scopeWheel(sv, -1, m.game, null, sr, at);
  assert.equal(sv.mode, SCOPE_FAR, 'up again: still the far view');
  const d = Math.hypot(sv.x - sh.shoulderX, sv.y - sh.shoulderY);
  assert.ok(sv.y < was.y, 'on, where the aim ends now');
  assert.ok(d > 30 * TILE || sv.end.hit, 'over the wall, or on it');
  assert.ok(d <= shotReach(sr) + 1e-6, 'never further than the shot goes');
  scopeWheel(sv, 1, m.game, null, sr, at);
  assert.equal(sv.mode, SCOPE_SNIPER, 'down: back');
  assert.equal(sv.end, null);
});

test('a shot ends at whoever is in the way: the far view stops on them (a monster, an animal, anyone), not past them; never the shooter', () => {
  const g = arena(), ctl = { input: () => ({ move: 0 }) };
  const a = g.addSoldier({ name: 'Shooter', isBot: false }, ctl), b = g.addSoldier({ name: 'Target', isBot: false }, ctl);
  for (let i = 0; i < 300 && !(a.alive && b.alive); i++) g.update();
  assert.ok(a.alive && b.alive);
  a.body.x = 0; a.body.y = -12; b.body.x = 300; b.body.y = -12;
  const end = shotEnd(g, 0, -20, 0, 2200, a);
  assert.equal(end.who, b, 'the one in the way');
  assert.ok(end.hit && end.x > 280 && end.x < 300, `at them (${end.x})`);
  // (Aimed over them: on to the wall.)
  const over = shotEnd(g, 0, -20, -0.2, 2200, a);
  assert.equal(over.who, null);
  assert.ok(over.hit && Math.abs(over.x - 600) < 1, `past them, the wall (${over.x})`);
  // (From inside the shooter: not them.)
  b.body.x = 2000;
  assert.equal(shotEnd(g, a.body.x, a.body.y - 8, 0, 300, a).who, null, 'never the shooter');
  // (The wheel: the far view, on them.)
  b.body.x = 300;
  const sv = newScopeView();
  sv.mode = SCOPE_SNIPER;
  scopeWheel(sv, -1, g, a, WEAPONS.SR, () => [0, -20, 0]);
  assert.equal(sv.end.who, b);
  assert.ok(Math.abs(sv.x - end.x) < 1e-6, 'the far view on them');
});

test('how far shots go: bullets and beams their range, an arrow as far as it carries, a seeker as far as it flies', () => {
  assert.equal(shotReach(WEAPONS.M4), WEAPONS.M4.range);
  assert.equal(shotReach(WEAPONS.SR), WEAPONS.SR.range);
  const bow = WEAPONS.Longbow, carry = bow.speed * bow.speed / bow.gravity;
  assert.equal(shotReach(bow), Math.min(bow.range, carry));
  // (A scope that stretches a bow's range doesn't make its arrows carry further.)
  assert.equal(shotReach({ ...bow, range: 8000 }), carry);
  const magic = WEAPONS.MagicBullet;
  assert.equal(shotReach(magic), magic.speed * magic.life);
  assert.equal(shotReach(null), 0);
});

test('in a world, guns with a scope: a sniper rifle\'s own, a fitted one taking over', () => {
  assert.deepEqual(scopeOf({ key: 'SR', n: 1 }), OWN_SCOPES.SR, 'its own');
  assert.equal(scopeOf({ key: 'M4', n: 1 }), null, 'others: none of their own');
  assert.deepEqual(scopeOf({ key: 'M4', n: 1, g: { att: { sight: 'scope4' } } }), ATTACHMENTS.scope4.scope);
  assert.deepEqual(scopeOf({ key: 'SR', n: 1, g: { att: { sight: 'hawkeye' } } }), ATTACHMENTS.hawkeye.scope, 'a fitted one');
  assert.deepEqual(scopeOf({ key: 'SR', n: 1, g: { att: { sight: 'red_dot' } } }), ATTACHMENTS.red_dot.scope);
  // (Each scope sees further than the last.)
  const keys = ['red_dot', 'scope2', 'scope4', 'scope8', 'scope16', 'hawkeye'];
  for (let i = 1; i < keys.length; i++) assert.ok(ATTACHMENTS[keys[i]].scope.reach > ATTACHMENTS[keys[i - 1]].scope.reach, keys[i]);
});

test('the far view: what can\'t be seen from where they stand, or is further than the shot goes, is dark, and nobody there is shown', () => {
  const m = flat(), wall = 40, ex = 8, ey = m.fy * TILE - 28;
  for (let y = m.fy - 10; y < m.fy; y++) m.world.setTile(wall, y, K.STONE);
  // (The view round the wall, the one looking well off to its left.)
  const x0 = wall - 10, y0 = m.fy - 20, w = 30, h = 22, out = new Uint8Array(w * h);
  sightFrom(m.world, x0, y0, w, h, ex, ey, out);
  const seen = (tx, ty) => out[(ty - y0) * w + (tx - x0)] === 1;
  assert.ok(seen(wall - 3, m.fy - 2), 'in front of the wall');
  assert.ok(seen(wall, m.fy - 2), 'the wall itself');
  assert.ok(!seen(wall + 3, m.fy - 2), 'behind it: dark');
  assert.ok(seen(wall + 3, m.fy - 19), 'high over it: seen');
  // (No further than the shot goes: past it, dark.)
  sightFrom(m.world, x0, y0, w, h, ex, ey, out, 36);
  assert.ok(seen(wall - 6, m.fy - 2) && !seen(wall - 2, m.fy - 2), 'past its reach: dark');
  // (Who's shown: the eye's sight, through glass but not stone; and within reach.)
  const fog = new Fog();
  fog.map = m.world;
  fog.eye = { x: ex, y: ey };
  assert.equal(fog.sees((wall + 3) * TILE, (m.fy - 2) * TILE), false, 'behind stone: not shown');
  for (let y = m.fy - 10; y < m.fy; y++) m.world.setTile(wall, y, K.GLASS);
  assert.equal(fog.sees((wall + 3) * TILE, (m.fy - 2) * TILE), true, 'behind glass: shown');
  fog.range = 30 * TILE;
  assert.equal(fog.sees((wall + 3) * TILE, (m.fy - 2) * TILE), false, 'further than the shot goes: not shown');
  assert.equal(fog.sees(20 * TILE, (m.fy - 2) * TILE), true);
});

test('a match\'s shadows from far off: the blocks between the eye and the screen cast them too, and past the range is shaded', () => {
  const asked = [], paths = { moves: 0 };
  const fog = new Fog();
  fog.map = { query: (l, t, r, b, fn) => { asked.push([l, t, r, b]); fn({ l: 500, t: -100, r: 540, b: 0 }); } };
  fog.eye = { x: 0, y: -20 };
  fog.range = 0;
  const ctx = { beginPath() {}, moveTo() { paths.moves++; }, lineTo() {}, closePath() {}, fill() {}, set fillStyle(v) {} };
  // (The screen far off to the right of the eye.)
  fog.drawShadows(ctx, { l: 1500, t: -400, r: 2300, b: 200 });
  assert.deepEqual(asked[0], [0, -400, 2300, 200], 'the blocks from the eye to the screen');
  assert.equal(paths.moves, 1, 'the block\'s shadow');
  fog.range = 1000;
  fog.drawShadows(ctx, { l: 1500, t: -400, r: 2300, b: 200 });
  assert.ok(paths.moves > 40, 'and the range\'s, all round');
});

test('a laser sight reaches as far as the gun\'s shots go (with a world\'s scope, further), stopping at what\'s in the way', () => {
  const m = flat(), wall = 150;
  for (let y = m.fy - 40; y < m.fy; y++) m.world.setTile(wall, y, K.STONE);
  const game = { world: m.world, map: m.world, nearInto: () => 0 };
  // (A sniper rifle with a long scope: its shots go 500 blocks.)
  const s = { aim: 0, shoulderX: 8, shoulderY: m.fy * TILE - 26, current: 'SR', weaponOverride: () => ({ ...WEAPONS.SR, range: 8000 }) };
  const l = laserEnd(game, s);
  assert.ok(Math.abs(l.x - wall * TILE) < 1, `out to the wall, 150 blocks off, past the rifle's own range (${l.x})`);
  // (No scope: as far as the rifle shoots.)
  for (let y = m.fy - 40; y < m.fy; y++) m.world.setTile(wall, y, K.AIR);
  const p = laserEnd(game, { ...s, weaponOverride: () => null });
  assert.ok(Math.abs(p.x - p.x0 - WEAPONS.SR.range) < 1, `${p.x - p.x0}`);
});
