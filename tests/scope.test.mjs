// Looking down a scope (web/src/world/scope.js): it doesn't zoom by itself; the wheel zooms in
// and out on what's under the crosshair (and that stays under it); the middle of the screen holds
// the view still and toward the edge steers it (as fast on the screen whatever the zoom, faster
// kept there); the mouse out of the window stops it; it goes no further than the scope reaches,
// nor shows anything further than the gun's shots go (combat.js's shotReach: an arrow, as far as
// it carries); and only where the one looking could see: not through walls or into hills (glass is
// seen through), nor into land not made yet, and back into sight if they step behind something.
// And a sniper rifle has a scope of its own (attachments.js), a better one fitted taking over.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { TileWorld, TILE } from '../web/src/world/tileworld.js';
import * as K from '../web/src/world/blocks.js';
import { newScopeView, scopeStart, scopeWheel, scopeFrame, pushOf, boostOf, SCOPE_DEAD } from '../web/src/world/scope.js';
import { scopeOf, OWN_SCOPES, ATTACHMENTS } from '../web/src/world/attachments.js';
import { shotReach } from '../web/src/combat.js';
import { WEAPONS } from '../web/src/weapons.js';
import { sightFrom } from '../web/src/world/worldrender.js';
import { Fog } from '../web/src/fog.js';

const W = 1280, H = 720, BASE = 1.6, DT = 1000 / 60;

/** A world with a stone floor, open air over it for 200 tiles each way and 40 up. */
function flat() {
  const world = new TileWorld({ seed: 77, name: 'Range', gen: 7 });
  const fy = 200;
  for (let x = -200; x <= 200; x++) {
    for (let y = fy - 40; y <= fy + 2; y++) world.setTile(x, y, y >= fy ? K.STONE : K.AIR);
  }
  // (The eye: standing on the floor in the middle.)
  return { world, fy, ex: 8, ey: fy * TILE - 28 };
}
const run = (sv, m, n, mx, my, opts = {}) => {
  for (let i = 0; i < n; i++) scopeFrame(sv, m.world, opts.ex ?? m.ex, opts.ey ?? m.ey, mx, my, W, H, BASE, DT, opts.out);
  return sv;
};
/** Scoped at the eye (no limit to the shots unless given), zoomed in by the wheel `notches`, settled. */
function scoped(m, scope = { reach: 120, mag: 2.4 }, notches = 0, range = 0) {
  const sv = newScopeView();
  scopeStart(sv, scope, m.ex, m.ey, 1, 0, 0, BASE, range);
  for (let i = 0; i < notches; i++) scopeWheel(sv, -1, 0, 0, BASE);
  return run(sv, m, 60, 0, 0);
}

test('it doesn\'t zoom by itself; the wheel zooms in on what\'s under the crosshair, and that stays under it', () => {
  const m = flat(), sv = newScopeView();
  // (A point well off the middle, but where the view holds still.)
  const cx = m.ex + 30, cy = m.ey - 20, mx = 250, my = -90;
  scopeStart(sv, { reach: 120, mag: 2.4 }, cx, cy, 1, mx, my, BASE);
  run(sv, m, 60, mx, my);
  assert.equal(sv.z, 1, 'not zoomed');
  assert.ok(Math.abs(sv.vx - cx) < 1e-6 && Math.abs(sv.vy - cy) < 1e-6, 'and the view where it was');
  const under = { x: cx + mx / BASE, y: cy + my / BASE };
  for (let i = 0; i < 4; i++) scopeWheel(sv, -1, mx, my, BASE);
  for (let i = 0; i < 60; i++) {
    scopeFrame(sv, m.world, m.ex, m.ey, mx, my, W, H, BASE, DT);
    // (Under the crosshair, all the way in.)
    const x = sv.vx + mx / (BASE * sv.z), y = sv.vy + my / (BASE * sv.z);
    assert.ok(Math.abs(x - under.x) < 0.5 && Math.abs(y - under.y) < 0.5, `frame ${i}: ${x.toFixed(1)},${y.toFixed(1)}`);
  }
  assert.equal(sv.z, 2.4, 'zoomed in by the wheel, as far as the scope goes');
  // (Started again: not zoomed, whatever it was before.)
  scopeStart(sv, { reach: 120, mag: 2.4 }, sv.vx, sv.vy, sv.z, mx, my, BASE);
  run(sv, m, 60, mx, my);
  assert.equal(sv.z, 1, 'back to none');
});

test('the wheel zooms in and out, from none to the scope\'s own', () => {
  const m = flat(), sv = scoped(m);
  assert.equal(sv.z, 1);
  scopeWheel(sv, -1, 0, 0, BASE);
  run(sv, m, 60, 0, 0);
  assert.ok(Math.abs(sv.z - 1.25) < 1e-6, `a notch in (${sv.z})`);
  for (let i = 0; i < 10; i++) scopeWheel(sv, -1, 0, 0, BASE);
  run(sv, m, 60, 0, 0);
  assert.equal(sv.z, 2.4, 'never in past the scope\'s own');
  for (let i = 0; i < 10; i++) scopeWheel(sv, 1, 0, 0, BASE);
  run(sv, m, 60, 0, 0);
  assert.equal(sv.z, 1, 'never out past none');
});

test('the middle of the screen holds still; toward the edge steers, faster nearer it', () => {
  const m = flat();
  assert.equal(pushOf(0, 0, W, H), 0);
  assert.equal(pushOf(W / 2 * (SCOPE_DEAD - 0.05), 0, W, H), 0, 'still, well out from the middle');
  assert.ok(pushOf(W / 2 * 0.8, 0, W, H) > 0 && pushOf(W / 2 * 0.8, 0, W, H) < pushOf(W / 2 * 0.98, 0, W, H), 'harder nearer the edge');
  assert.equal(pushOf(W / 2, 0, W, H), 1);
  const sv = scoped(m), x0 = sv.vx;
  run(sv, m, 30, 200, 100);
  assert.equal(sv.vx, x0, 'aiming in the middle: still');
  run(sv, m, 30, W / 2 - 4, 0);
  assert.ok(sv.vx > x0 + 50, `steered right (${(sv.vx - x0).toFixed(0)} px)`);
  const y0 = sv.vy;
  run(sv, m, 20, 0, -(H / 2 - 4));
  assert.ok(sv.vy < y0 - 20, 'and up');
});

test('steering goes as fast on the screen whatever the zoom; kept at the edge, faster', () => {
  const m = flat();
  const moved = notches => {
    const sv = scoped(m, { reach: 120, mag: 3 }, notches), x0 = sv.vx;
    run(sv, m, 10, W / 2 - 2, 0);
    return (sv.vx - x0) * BASE * sv.z;  // (on the screen)
  };
  const a = moved(0), b = moved(4);
  assert.ok(Math.abs(a - b) / a < 0.05, `the same on the screen (${a.toFixed(0)} and ${b.toFixed(0)} px)`);
  // (Long scopes pick up speed, kept at the edge; short ones don't need to.)
  assert.equal(boostOf(30), 1);
  assert.ok(boostOf(500) >= 6);
  // (From the arena's far end: room to go.)
  const far = { ex: -190 * TILE, ey: m.ey }, sv = newScopeView();
  scopeStart(sv, { reach: 500, mag: 2 }, far.ex, far.ey, 1, 0, 0, BASE);
  for (let i = 0; i < 3; i++) scopeWheel(sv, -1, 0, 0, BASE);
  run(sv, m, 60, 0, 0, far);
  run(sv, m, 6, W / 2 - 2, 0, far);
  const x1 = sv.vx;
  run(sv, m, 6, W / 2 - 2, 0, far);
  const early = sv.vx - x1;
  run(sv, m, 150, W / 2 - 2, 0, far);
  const x2 = sv.vx;
  run(sv, m, 6, W / 2 - 2, 0, far);
  assert.ok(sv.vx - x2 > early * 3, `faster after a while (${early.toFixed(0)} then ${(sv.vx - x2).toFixed(0)} px)`);
});

test('the mouse out of the window: it stops', () => {
  const m = flat(), sv = scoped(m), x0 = sv.vx;
  run(sv, m, 30, W / 2 - 2, 0, { out: true });
  assert.equal(sv.vx, x0);
});

test('no further than the scope reaches', () => {
  const m = flat(), sv = scoped(m, { reach: 30, mag: 1.6 });
  run(sv, m, 600, W / 2 - 2, 0);
  const d = Math.hypot(sv.vx - m.ex, sv.vy - m.ey);
  assert.ok(d <= 30 * TILE + 0.01 && d > 30 * TILE - 2, `${(d / TILE).toFixed(1)} blocks`);
});

test('only where they could see: not through a wall, nor into a hill; glass is seen through', () => {
  const m = flat(), wall = 20;
  for (let y = m.fy - 40; y < m.fy; y++) m.world.setTile(wall, y, K.STONE);
  const sv = scoped(m);
  run(sv, m, 400, W / 2 - 2, 0);
  assert.ok(sv.vx < wall * TILE, `stopped short of the wall (${(sv.vx / TILE).toFixed(1)}, the wall at ${wall})`);
  assert.ok(sv.blocked, 'and says so');
  assert.ok(m.world.sight(m.ex, m.ey, sv.vx, sv.vy) >= 1, 'in sight');
  // (Glass instead: seen through, on out.)
  for (let y = m.fy - 40; y < m.fy; y++) m.world.setTile(wall, y, K.GLASS);
  run(sv, m, 200, W / 2 - 2, 0);
  assert.ok(sv.vx > (wall + 10) * TILE, `through the glass (${(sv.vx / TILE).toFixed(1)})`);
  // (Steered down into the floor: it stays above it.)
  const sv2 = scoped(m);
  run(sv2, m, 300, 0, H / 2 - 2);
  assert.ok(sv2.vy < m.fy * TILE, 'not into the ground');
  // (A hill out there: along its side, not into it.)
  const m2 = flat();
  for (let x = 30; x < 60; x++) for (let y = m2.fy - 12; y < m2.fy; y++) m2.world.setTile(x, y, K.DIRT);
  const sv3 = scoped(m2);
  run(sv3, m2, 300, W / 2 - 2, H / 2 - 120);
  const tx = Math.floor(sv3.vx / TILE), ty = Math.floor(sv3.vy / TILE);
  assert.ok(!K.SOLID[m2.world.tile(tx, ty)], 'never inside the hill');
  assert.ok(m2.world.sight(m2.ex, m2.ey, sv3.vx, sv3.vy) >= 1, 'always in sight');
});

test('not into land not made yet; and back into sight when they step behind something', () => {
  const m = flat();
  // (Nothing made past the arena: its edge is as far as it sees, for now.)
  const edge = (Math.floor(200 / 32) + 1) * 32 * TILE;
  assert.ok(!m.world.has(edge / (32 * TILE), Math.floor(m.ey / (32 * TILE))), 'beyond: not made');
  const sv = scoped(m, { reach: 500, mag: 1.5 });
  run(sv, m, 900, W / 2 - 2, 0);
  assert.ok(sv.vx <= edge + 1, `stopped where the made land ends (${(sv.vx / TILE).toFixed(0)}, ${(edge / TILE).toFixed(0)})`);
  // (A wall goes up between them and the view: it comes back to this side of it.)
  const back = Math.floor(sv.vx / TILE) - 40;
  for (let y = m.fy - 40; y < m.fy; y++) m.world.setTile(back, y, K.STONE);
  run(sv, m, 1, 0, 0);
  assert.ok(sv.vx < back * TILE, 'back this side of it');
  assert.ok(m.world.sight(m.ex, m.ey, sv.vx, sv.vy) >= 1);
});

test('nothing on the screen further than the shots go; zoomed in, it can look further', () => {
  const m = flat(), R = 1200;
  const corner = sv => { const hw = W / (2 * BASE * sv.z), hh = H / (2 * BASE * sv.z); return Math.hypot(Math.abs(sv.vx - m.ex) + hw, Math.abs(sv.vy - m.ey) + hh); };
  const sv = scoped(m, { reach: 500, mag: 3 }, 0, R);
  run(sv, m, 400, W / 2 - 2, 0);
  assert.ok(corner(sv) <= R + 0.5 && corner(sv) > R - 8, `the screen's furthest corner: ${corner(sv).toFixed(0)} of ${R}`);
  assert.equal(sv.limit, 'range', 'and says so');
  assert.equal(sv.blocked, false);
  const out = sv.vx;
  // (Zoomed in, the screen's narrower: the view can go further, its corner still in range.)
  for (let i = 0; i < 5; i++) scopeWheel(sv, -1, 0, 0, BASE);
  run(sv, m, 400, W / 2 - 2, 0);
  assert.ok(sv.vx > out + 100 && corner(sv) <= R + 0.5, `further in (${(sv.vx - out).toFixed(0)} px more)`);
  // (Back out: pulled in, so the screen's in range again.)
  for (let i = 0; i < 5; i++) scopeWheel(sv, 1, 0, 0, BASE);
  run(sv, m, 120, 0, 0);
  assert.equal(sv.z, 1);
  assert.ok(corner(sv) <= R + 0.5, `zoomed out, in range (${corner(sv).toFixed(0)})`);
  // (Shots that go less far than the screen's already wide: no further out at all.)
  const short = scoped(m, { reach: 500, mag: 3 }, 0, 300), x0 = short.vx, y0 = short.vy;
  run(short, m, 200, W / 2 - 2, 0);
  run(short, m, 100, 0, -(H / 2 - 2));
  assert.ok(Math.hypot(short.vx - m.ex, short.vy - m.ey) <= Math.hypot(x0 - m.ex, y0 - m.ey) + 1e-6, 'no further out');
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

test('a sniper rifle\'s own scope; a better one fitted takes over, a lesser one doesn\'t', () => {
  assert.deepEqual(scopeOf({ key: 'SR', n: 1 }), OWN_SCOPES.SR, 'its own');
  assert.equal(scopeOf({ key: 'M4', n: 1 }), null, 'others: none of their own');
  assert.deepEqual(scopeOf({ key: 'M4', n: 1, g: { att: { sight: 'scope4' } } }), ATTACHMENTS.scope4.scope);
  assert.deepEqual(scopeOf({ key: 'SR', n: 1, g: { att: { sight: 'hawkeye' } } }), ATTACHMENTS.hawkeye.scope, 'a better one');
  assert.deepEqual(scopeOf({ key: 'SR', n: 1, g: { att: { sight: 'red_dot' } } }), OWN_SCOPES.SR, 'not a lesser one');
  // (Each scope zooms in more than the last, and sees further.)
  const keys = ['red_dot', 'scope2', 'scope4', 'scope8', 'scope16', 'hawkeye'];
  for (let i = 1; i < keys.length; i++) {
    const a = ATTACHMENTS[keys[i - 1]].scope, b = ATTACHMENTS[keys[i]].scope;
    assert.ok(b.mag > a.mag && b.reach > a.reach, keys[i]);
  }
  assert.ok(ATTACHMENTS.scope2.scope.mag >= 1.5, 'real zoom');
});

test('down a scope, what can\'t be seen from where they stand is dark, and nobody there is shown', () => {
  const m = flat(), wall = 40;
  for (let y = m.fy - 10; y < m.fy; y++) m.world.setTile(wall, y, K.STONE);
  // (The view round the wall, the one looking well off to its left.)
  const x0 = wall - 10, y0 = m.fy - 20, w = 30, h = 22, out = new Uint8Array(w * h);
  sightFrom(m.world, x0, y0, w, h, m.ex, m.ey, out);
  const seen = (tx, ty) => out[(ty - y0) * w + (tx - x0)] === 1;
  assert.ok(seen(wall - 3, m.fy - 2), 'in front of the wall');
  assert.ok(seen(wall, m.fy - 2), 'the wall itself');
  assert.ok(!seen(wall + 3, m.fy - 2), 'behind it: dark');
  assert.ok(seen(wall + 3, m.fy - 19), 'high over it: seen');
  // (Who's shown: the eye's sight, through glass but not stone.)
  const fog = new Fog();
  fog.map = m.world;
  fog.eye = { x: m.ex, y: m.ey };
  assert.equal(fog.sees((wall + 3) * TILE, (m.fy - 2) * TILE), false, 'behind stone: not shown');
  for (let y = m.fy - 10; y < m.fy; y++) m.world.setTile(wall, y, K.GLASS);
  assert.equal(fog.sees((wall + 3) * TILE, (m.fy - 2) * TILE), true, 'behind glass: shown');
});
