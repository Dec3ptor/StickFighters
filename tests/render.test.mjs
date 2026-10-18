// Drawing at any frame rate: the game updates 60 times a second, and frames
// (60, 120, 144 a second...) draw everything part way between two updates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { between, Renderer } from '../web/src/render.js';
import { Effects } from '../web/src/effects.js';
import { botMatch } from './helpers.mjs';

// Just enough of a browser for the renderer's camera.
globalThis.window ??= { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, addEventListener() {} };
const fakeCanvas = () => ({ style: {}, width: 0, height: 0 });

test('things are drawn part way between where they were and where they are', () => {
  const p = { x: 10, y: 20, px: 4, py: 26, vx: 6 };
  const v = between(p, 0.5);
  assert.equal(v.x, 7);
  assert.equal(v.y, 23);
  assert.equal(v.vx, 6, 'everything else is the same');
  assert.equal(between(p, 1), p);
  assert.equal(between({ x: 1, y: 2 }, 0.3).x, 1, 'no earlier position: drawn where it is');
});

test('particles and falling items remember where they were last update', () => {
  const fx = new Effects();
  fx.add({ kind: 'spark', x: 0, y: 0, vx: 2, vy: 0, life: 10 });
  const map = { raycast: () => null };
  fx.update(map, 1);
  const s = fx.parts[0];
  assert.equal(s.px, 0);
  assert.ok(s.x > 1.5);
});

test('the camera follows at the same speed at 60, 144 and 240 frames a second', () => {
  const { game } = botMatch('ssdm1.json', { bots: 0 });
  const ends = [60, 144, 240].map(fps => {
    const r = new Renderer(fakeCanvas(), {});
    r.snapCamera(0, 0);
    for (let i = 0; i < fps / 2; i++) r.updateCamera(game, 400, 300, null, false, 1000 / fps);
    return r.cam;
  });
  for (const c of ends.slice(1)) {
    assert.ok(Math.abs(c.x - ends[0].x) < 3 && Math.abs(c.y - ends[0].y) < 3, `camera at ${c.x},${c.y} vs ${ends[0].x},${ends[0].y}`);
  }
});

test('the running animation is drawn in between updates, even where its loop wraps round', () => {
  const r = new Renderer(fakeCanvas(), {});
  const s = { anim: { run: 0.04, idle: 11, land: 0, flip: 0.5, recoil: 0, swing: 0 }, animPrev: { run: 0.96, idle: 10, land: 0, flip: 0.6, recoil: 0, swing: 0 } };
  r.alpha = 0.5;
  const v = r.animated(s);
  assert.ok(Math.abs(v.anim.run - 0) < 1e-9 || Math.abs(v.anim.run - 1) < 1e-9, `run ${v.anim.run}`);
  assert.equal(v.anim.idle, 10.5);
  assert.ok(Math.abs(v.anim.flip - 0.55) < 1e-9);
  // Something starting (a shot's kick) shows straight away.
  s.anim.recoil = 3;
  assert.equal(r.animated(s).anim.recoil, 3);
  // At the update itself, it's just the soldier.
  r.alpha = 1;
  assert.equal(r.animated(s), s);
});
