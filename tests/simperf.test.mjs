// The quick ways the game looks things up and keeps its lists (made so an update makes
// little garbage) give exactly the answers of the plain ways. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMap, botMatch } from './helpers.mjs';
import { GameMap, segmentBox, hypot } from '../web/src/map.js';
import { Soldier } from '../web/src/soldier.js';
import { Effects, Particle } from '../web/src/effects.js';
import { Tape } from '../web/src/replay.js';
import { makeRng } from '../web/src/util.js';

/** A map with holes blown in it (so blocks are split into pieces, in many grid cells). */
function holedMap() {
  const map = new GameMap(loadMap('ssdm2.json'));
  const rng = makeRng(2);
  const b = map.bounds;
  for (let i = 0; i < 40; i++) map.carve(Math.round(b.left + rng() * (b.right - b.left)), Math.round(b.top + rng() * (b.bottom - b.top)), 20 + Math.round(rng() * 30));
  return map;
}

/** segmentBox() as it was first written (a result object at every step), to check the quick one against. */
function plainSegmentBox(x0, y0, dx, dy, l, t, r, b) {
  let tmin = 0, tmax = 1, nx = 0, ny = 0;
  if (dx === 0) {
    if (x0 <= l || x0 >= r) return null;
  } else {
    let t1 = (l - x0) / dx, t2 = (r - x0) / dx, n = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = n; ny = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (dy === 0) {
    if (y0 <= t || y0 >= b) return null;
  } else {
    let t1 = (t - y0) / dy, t2 = (b - y0) / dy, n = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = n; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return { t: tmin, nx, ny };
}

test('map lookups give the same answers as checking every block', () => {
  for (const map of [new GameMap(loadMap('ssdm1.json')), new GameMap(loadMap('ssdm7.json')), holedMap()]) {
    const rng = makeRng(5), b = map.bounds;
    const at = () => [b.left - 100 + rng() * (b.right - b.left + 200), b.top - 100 + rng() * (b.bottom - b.top + 200)];
    for (let i = 0; i < 3000; i++) {
      // Boxes: overlap() is the first overlapping block, overlapAll() all of them, support() prefers floor to a jump pad.
      const [x, y] = at(), w = rng() * 60, h = i % 3 ? rng() * 60 : 1;
      const all = map.solids.filter(s => x < s.r && x + w > s.l && y < s.b && y + h > s.t);
      const out = [], n = map.overlapAll(x, y, x + w, y + h, out);
      assert.deepEqual(new Set(out.slice(0, n)), new Set(all));
      assert.equal(n, all.length);
      assert.equal(map.overlap(x, y, x + w, y + h), out[0] ?? null, 'overlap: the first one overlapAll finds');
      const pad = out.slice(0, n).find(s => !s.bounce) || out[0] || null;
      assert.equal(map.support(x, y, x + w, y + h), pad);
      // Segments: the nearest block's entry point, with the normal of the side it goes in by.
      const [x1, y1] = at(), len = i % 4 ? 5 + rng() * 80 : rng() * 900, a = rng() * Math.PI * 2;
      const x2 = x1 + Math.cos(a) * len, y2 = y1 + Math.sin(a) * len;
      let best = null;
      for (const s of map.solids) {
        const hit = plainSegmentBox(x1, y1, x2 - x1, y2 - y1, s.l, s.t, s.r, s.b);
        assert.deepEqual(segmentBox(x1, y1, x2 - x1, y2 - y1, s.l, s.t, s.r, s.b), hit);
        if (hit && (!best || hit.t < best.t)) best = hit;
      }
      const hit = map.raycast(x1, y1, x2, y2);
      assert.equal(!!hit, !!best);
      assert.equal(map.clearLine(x1, y1, x2, y2), !best);
      if (hit) {
        assert.equal(hit.t, best.t);
        assert.equal(hit.x, x1 + (x2 - x1) * best.t);
        assert.equal(hit.y, y1 + (y2 - y1) * best.t);
        // (When two blocks are entered at the same point, either can be the one; its normal is its own.)
        const own = plainSegmentBox(x1, y1, x2 - x1, y2 - y1, hit.solid.l, hit.solid.t, hit.solid.r, hit.solid.b);
        assert.ok(own && own.t === hit.t && own.nx === hit.nx && own.ny === hit.ny);
      }
      // A move inside one empty grid cell can't hit anything.
      if (map.emptyBetween(x1, y1, x1 + Math.cos(a) * 3, y1 + Math.sin(a) * 3)) assert.equal(map.raycast(x1, y1, x1 + Math.cos(a) * 3, y1 + Math.sin(a) * 3), null);
    }
  }
});

test('hypot() is exactly Math.hypot', () => {
  const edge = [0, -0, 1, -1, 0.5, 3, 4, 1e-300, 5e-324, 1e300, 1.7976931348623157e308, Infinity, -Infinity, NaN, 0.1, 1e-160, 1e160];
  for (const a of edge) for (const b of edge) assert.ok(Object.is(hypot(a, b), Math.hypot(a, b)), `hypot(${a}, ${b})`);
  const rng = makeRng(9), f = new Float64Array(1), u = new Uint32Array(f.buffer);
  const any = () => { u[0] = rng() * 2 ** 32; u[1] = rng() * 2 ** 32; return f[0]; };
  for (let i = 0; i < 200000; i++) {
    const a = i % 2 ? (rng() - 0.5) * 4000 : any(), b = i % 2 ? (rng() - 0.5) * 900 : any();
    assert.ok(Object.is(hypot(a, b), Math.hypot(a, b)), `hypot(${a}, ${b})`);
  }
});

test('soldiers are made with every field they ever get (so they all share one shape)', () => {
  const fields = Object.keys(new Soldier({ id: 0, name: 'x' })).join();
  for (const [file, mode, options] of [['ssdm1.json', 'ffa', {}], ['ssdm1.json', 'gungame', {}], ['ssdm1.json', 'oitc', {}], ['kasbah.json', 'defuse', {}],
    ['crossfire.json', 'ctf', { classes: true }], ['valley.json', 'conquest', { destruction: true }]]) {
    const { game } = botMatch(file, { bots: 40, mode, options });
    for (let i = 0; i < 600; i++) game.update();
    game.spectate(game.soldiers[0], true);
    for (const s of game.soldiers) assert.equal(Object.keys(s).join(), fields, `${mode}: ${s.name}`);
  }
});

test('nearInto() finds the same soldiers, in the same order, as near()', () => {
  for (const bots of [12, 300]) {
    const { game } = botMatch('ssdm1.json', { bots, mode: 'ffa', seed: 4 });
    for (let i = 0; i < 200; i++) game.update();
    const rng = makeRng(6), b = game.map.bounds, out = [];
    for (let i = 0; i < 500; i++) {
      const x = b.left + rng() * (b.right - b.left), y = b.top + rng() * (b.bottom - b.top), w = rng() * 400, h = rng() * 300;
      const n = game.nearInto(x, y, x + w, y + h, out);
      assert.deepEqual(out.slice(0, n), [...game.near(x, y, x + w, y + h)]);
    }
    // Someone moved mid-update goes to the end of their new cell's list, as before.
    if (game.crowded) {
      const s = game.soldiers.find(o => o.alive);
      s.body.x += 300;
      game.moved(s);
      const n = game.nearInto(s.x - 1, s.y - 1, s.x + 1, s.y + 1, out);
      assert.ok(out.slice(0, n).includes(s));
      assert.deepEqual(out.slice(0, n), game.near(s.x - 1, s.y - 1, s.x + 1, s.y + 1));
    }
  }
});

test('particles all have one shape, and are used again once they\'re gone', () => {
  const map = new GameMap(loadMap('ssdm1.json'));
  const fx = new Effects();
  // (A particle made elsewhere, as a plain object, still moves as before.)
  fx.add({ kind: 'spark', x: 0, y: 0, vx: 2, vy: 0, life: 10 });
  assert.ok(fx.parts[0] instanceof Particle);
  fx.update(map, 1);
  assert.equal(fx.parts[0].px, 0);
  assert.ok(fx.parts[0].x > 1.5);
  const made = new Set();
  for (let t = 0; t < 600; t++) {
    if (t % 3 === 0) fx.blood(100 + t % 300, -200, 1, 0, 30);
    if (t % 50 === 0) fx.explosion(300, -150, 30);
    fx.update(map, 0.75);
    for (const p of fx.parts) { assert.ok(p instanceof Particle); made.add(p); }
  }
  assert.ok(fx.stains.length > 0 && fx.stains.length <= 260, 'blood on the walls, up to the limit');
  assert.ok(made.size < 700, `particles used again (${made.size} made for over 2,000 shown)`);
});

test('the replay tape keeps every other update, in frames it fills again', () => {
  const { game } = botMatch('ssdm1.json', { bots: 8, mode: 'ffa', seed: 3 });
  game.tape = new Tape();
  const frames = new Set();
  for (let i = 0; i < 1200; i++) {
    game.update();
    for (const f of game.tape.frames) frames.add(f);
  }
  const ticks = game.tape.frames.map(f => f.tick);
  assert.ok(ticks.every(t => t % 2 === 0), 'every other update');
  assert.deepEqual(ticks, ticks.map((_, i) => ticks[0] + 2 * i), 'none missed');
  assert.ok(frames.size < game.tape.frames.length + 8, `frames used again (${frames.size} for ${game.tape.frames.length} kept)`);
  const last = game.tape.frames.at(-1);
  assert.deepEqual(last.soldiers.map(s => [s.id, s.x, s.y, s.alive]), game.soldiers.map(s => [s.id, s.x, s.y, s.alive]));
});

test('map lookups keep working after two billion of them (the marks start again)', () => {
  const map = new GameMap({ name: 't', bounds: { left: -600, top: -400, right: 600, bottom: 200 }, spawns: [{ x: 0, y: -12 }], items: [],
    platforms: [{ left: -500, top: 0, right: 500, bottom: 40 }] });
  const once = () => { let n = 0; map.query(-500, -10, 500, 50, () => { n++; }); return n; };
  const before = once();
  assert.equal(before, 1, 'a block spanning many cells is found once');
  map._stamp = 0x7fffffff - 2;
  for (let i = 0; i < 6; i++) assert.equal(once(), before, `lookup ${i} around the wrap`);
  assert.ok(map._stamp > 0 && map._stamp < 10);
  assert.ok(map.raycast(0, -100, 0, 100), 'raycasts too');
});

test('a speed that isn\'t a number (a bug elsewhere) stops the soldier rather than hanging the page', () => {
  const { game } = botMatch('ssdm1.json', { bots: 2, mode: 'ffa', seed: 3 });
  for (let i = 0; i < 30; i++) game.update();
  const [a, b] = game.soldiers;
  a.body.vx = NaN;
  b.body.vy = Infinity;
  game.update();
  assert.equal(a.body.vx === 0 || Number.isFinite(a.body.vx), true);
  assert.ok(Number.isFinite(b.body.vy));
});
