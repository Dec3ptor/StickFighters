// The sky over a world (sky.js): the cloud layer high over the land (where its clouds are, how
// they drift, what being in one is like), birds (by land and time of day, never underground, the
// same for everyone, scared off by bangs), and the cost of drawing it all each frame.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { TileWorld } from '../web/src/world/tileworld.js';
import { SURFACE, SEA_ROW } from '../web/src/world/worldgen.js';
import { TILE } from '../web/src/world/blocks.js';
import { DAY_TICKS } from '../web/src/world/monsters.js';
import * as sky from '../web/src/world/sky.js';

const SEED = 777;
const hour = (h, day = 3) => day * DAY_TICKS + (((h - 6 + 24) % 24) / 24) * DAY_TICKS;

test('the cloud layer: high over the highest land, under the top of the sky, drifting with the wind', () => {
  const world = new TileWorld({ seed: SEED, gen: 6 }), gen = world.gen;
  let highest = Infinity;
  for (let x = -6000; x < 6000; x += 3) highest = Math.min(highest, gen.surfaceAt(x));
  assert.ok(sky.CLOUD_BOTTOM < 92 && sky.CLOUD_TOP > 0, 'over the highest mountains anywhere (row 92), under the top');
  const out = [], xs = [];
  let n = 0;
  for (const t of [0, 5000, hour(14)]) {
    sky.layerClouds(SEED, t, -6000 * TILE, 6000 * TILE, out, xs);
    for (const c of out) {
      n++;
      assert.ok(c.y - c.h / 2 >= sky.CLOUD_TOP * TILE && c.y + c.h / 2 <= sky.CLOUD_BOTTOM * TILE, `cloud at ${c.y}: in the layer`);
      assert.ok(c.y + c.h / 2 < highest * TILE, 'over the land');
    }
  }
  assert.ok(n > 100, `plenty of them (${n})`);
  // The wind takes them along: the same clouds, moved on by the wind's speed.
  const wind = sky.windOf(SEED);
  assert.ok(Math.abs(wind) > 0.05 && Math.abs(wind) < 0.4, `a gentle wind (${wind})`);
  const a = [...sky.layerClouds(SEED, 1000, -3000, 3000, [], [])], ax = [];
  sky.layerClouds(SEED, 1000, -3000, 3000, [], ax);
  const bx = [];
  const b = [...sky.layerClouds(SEED, 1600, -3000 + wind * 600, 3000 + wind * 600, [], bx)];
  const moved = a.filter((c, i) => { const j = b.indexOf(c); return j >= 0 && Math.abs(bx[j] - (ax[i] + wind * 600)) < 1e-6; });
  assert.ok(moved.length >= a.length - 2 && moved.length > 0, 'the same clouds, blown along');
});

test('in a cloud: deep in the middle of one, nothing below or above the layer', () => {
  const out = [], xs = [];
  sky.layerClouds(SEED, 2000, -20000, 20000, out, xs);
  let inside = 0;
  for (let i = 0; i < out.length; i++) if (sky.cloudAt(SEED, 2000, xs[i], out[i].y + out[i].h * 0.1) > 0.5) inside++;
  assert.ok(inside >= out.length * 0.6, `in the thick of them (${inside} of ${out.length})`);
  for (let x = -5000; x < 5000; x += 37) {
    assert.equal(sky.cloudAt(SEED, 2000, x, SURFACE * TILE), 0, 'none down at the ground');
    assert.equal(sky.cloudAt(SEED, 2000, x, 10 * TILE), 0, 'none right at the top');
  }
});

test('birds: never underground (over the land, or the sea\'s surface), and by the land and the time of day', () => {
  const world = new TileWorld({ seed: SEED, gen: 6 }), gen = world.gen;
  const kinds = { day: new Set(), night: new Set(), sea: new Set() };
  let n = 0;
  // (Days from nine till four, nights from eleven till three: an hour is 2,400 updates.)
  for (const [when, t0, len] of [['day', hour(9), 7 * 2400], ['night', hour(23), 4 * 2400], ['day', hour(9, 5), 7 * 2400], ['night', hour(23, 6), 4 * 2400]]) {
    for (let t = t0; t < t0 + len; t += 397) {
      for (const b of sky.birdsIn(world, t, -9000 * TILE, 9000 * TILE)) {
        n++;
        const tx = Math.floor(b.x / TILE), col = gen.column(tx);
        const ground = Math.min(col.surf, col.biome.sea || col.lake ? SEA_ROW : 1e9);
        assert.ok(b.y < (ground - 2) * TILE, `a ${b.kind} at row ${(b.y / TILE).toFixed(1)}: over the ground there (row ${ground})`);
        kinds[when].add(b.kind);
        if (col.biome.sea && when === 'day') kinds.sea.add(b.kind);
      }
    }
  }
  assert.ok(n > 200, `birds about (${n})`);
  assert.deepEqual([...kinds.night].filter(k => k !== 'bat'), [], `only bats at night (${[...kinds.night]})`);
  assert.ok(kinds.day.size >= 3 && !kinds.day.has('bat'), `all sorts by day (${[...kinds.day]})`);
  assert.ok(kinds.sea.has('gull'), `gulls over the sea (${[...kinds.sea]})`);
});

test('birds and clouds are the same for everyone (from the seed and the time: nothing sent)', async () => {
  const other = await import('../web/src/world/sky.js?another');
  const w1 = new TileWorld({ seed: SEED, gen: 6 }), w2 = new TileWorld({ seed: SEED, gen: 6 });
  for (const t of [hour(9), hour(13), hour(19.3)]) {
    const a = sky.birdsIn(w1, t, -4000 * TILE, 4000 * TILE).map(b => [b.kind, b.x.toFixed(3), b.y.toFixed(3)]);
    const b = other.birdsIn(w2, t, -4000 * TILE, 4000 * TILE).map(b => [b.kind, b.x.toFixed(3), b.y.toFixed(3)]);
    assert.deepEqual(a, b, `the same birds at ${t}`);
    const ca = [], cb = [], xa = [], xb = [];
    sky.layerClouds(SEED, t, -50000, 50000, ca, xa);
    other.layerClouds(SEED, t, -50000, 50000, cb, xb);
    assert.deepEqual(xa, xb, 'the same clouds');
  }
});

// ---- Drawing, with a stand-in canvas ----------------------------------------------------------

/** A canvas context that counts what's drawn (and does nothing). */
function countingContext() {
  const n = { calls: 0 };
  const grad = { addColorStop() {} };
  const ctx = new Proxy({ globalAlpha: 1, n }, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
      if (k === 'getContext') return () => ctx;
      return (...a) => { n.calls++; return undefined; };
    },
    set(o, k, v) { o[k] = v; return true; },
  });
  return ctx;
}

function setupDocument() {
  globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => countingContext() }) };
}

/** A renderer as the sky sees one: its view of the world, around (x, y). */
function view(x, y, w = 1400, h = 800) {
  return { view: { l: x - w / 2, r: x + w / 2, t: y - h / 2, b: y + h / 2 }, s: 1, tx: 0, ty: 0, pw: w, ph: h, cam: { x, y }, alpha: 0.5, quality: 'high' };
}

test('drawing the sky costs little each frame, wherever you are and however many birds there are', () => {
  setupDocument();
  const world = new TileWorld({ seed: SEED, gen: 6 }), gen = world.gen;
  const game = { world, soldiers: [] };
  let most = 0;
  for (const [what, x, y, t] of [
    ['the surface by day', 0, (gen.surfaceAt(0) - 6) * TILE, hour(11)],
    ['a forest at dusk', 1015 * TILE, (gen.surfaceAt(1015) - 4) * TILE, hour(19.2)],
    ['the clouds', 0, 50 * TILE, hour(12)],
    ['a cave', 0, (SURFACE + 60) * TILE, hour(12)],
    ['the meadow at night', 250 * TILE, (gen.surfaceAt(250) - 2) * TILE, hour(23)],
  ]) {
    world.time = t;
    // (The tiles on screen, made, as they would be by the time they're drawn.)
    const r = view(x, y);
    for (let ty = Math.floor(r.view.t / TILE); ty <= r.view.b / TILE; ty += 32) for (let tx = Math.floor(r.view.l / TILE); tx <= r.view.r / TILE; tx += 32) world.tile(tx, Math.max(0, ty));
    for (let classic of [true, false]) {
      const times = [];
      for (let f = 0; f < 40; f++) {
        world.time = t + f;
        const ctx = countingContext();
        const t0 = performance.now();
        sky.drawSkyBehind(ctx, r, game, classic);
        sky.drawSkyFront(ctx, r, game, classic);
        sky.drawSkyGlow(ctx, r, game, classic, null);
        times.push(performance.now() - t0);
        most = Math.max(most, ctx.n.calls);
        assert.ok(ctx.n.calls < 1600, `${what}: ${ctx.n.calls} calls in a frame`);
      }
      // (The usual frame's: the first ones work out the flocks and the clouds' pictures.)
      times.sort((a, b) => a - b);
      assert.ok(times[20] < 2, `${what}: ${times[20].toFixed(2)} ms a frame`);
    }
  }
  assert.ok(most > 10, `something's drawn (${most} calls at most)`);
});

test('a bang near birds scares them off', () => {
  setupDocument();
  const world = new TileWorld({ seed: SEED, gen: 6 });
  const game = { world, soldiers: [] };
  // (A time with birds over the start, and where they are.)
  let t = hour(10), birds = [];
  for (; t < hour(10) + 40000 && !birds.length; t += 300) birds = sky.birdsIn(world, t, -800, 800).filter(b => !b.scared);
  assert.ok(birds.length, 'birds about');
  world.time = t;
  const b = birds[0];
  // (Nothing about, nothing heard: they fly on.)
  sky.skyHears(game, [{ name: 'click', x: b.x, y: b.y }]);
  sky.drawSkyBehind(countingContext(), view(b.x, b.y), game, true);
  assert.ok(!sky.birdsIn(world, t, b.x - 300, b.x + 300).some(o => o.scared), 'a click scares nothing');
  // A bang near them, and they're off.
  sky.skyHears(game, [{ name: 'explosion', x: b.x + 50, y: b.y + 40 }]);
  sky.drawSkyBehind(countingContext(), view(b.x, b.y), game, true);
  assert.ok(sky.birdsIn(world, t, b.x - 300, b.x + 300).some(o => o.scared), 'scared off');
  // So are others, by someone coming close.
  let u = t + 4000, more = [];
  for (; u < t + 60000 && !more.length; u += 300) more = sky.birdsIn(world, u, -3000, 3000).filter(o => !o.scared);
  if (more.length) {
    world.time = u;
    const o = more[0];
    game.soldiers = [{ alive: true, x: o.x + 20, y: o.y + 30 }];
    sky.drawSkyBehind(countingContext(), view(o.x, o.y), game, true);
    assert.ok(sky.birdsIn(world, u, o.x - 300, o.x + 300).some(q => q.scared), 'scared by someone close');
  }
});
