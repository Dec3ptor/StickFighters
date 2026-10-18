// The WebGL drawing layer (glctx.js) turns canvas drawing calls into PixiJS
// shapes. These tests use a stand-in for PixiJS that records what it's asked
// to draw. (tests/browser/webgl.mjs checks the real thing against the canvas.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { GLContext, parseColor } from '../web/src/glctx.js';

/** A pretend PixiJS: Graphics objects record their calls. */
function fakePixi() {
  class Graphics {
    constructor() { this.calls = []; }
    clear() { this.calls = []; return this; }
    beginPath() { return this; }
    rect(...a) { this.calls.push(['rect', ...a]); return this; }
    poly(pts, close) { this.calls.push(['poly', pts, close]); return this; }
    fill(style) { this.calls.push(['fill', style]); return this; }
    stroke(style) { this.calls.push(['stroke', style]); return this; }
  }
  class Container {
    constructor() { this.children = []; }
    removeChildren() { this.children = []; }
    addChild(...c) { this.children.push(...c); }
  }
  return { Graphics, Container };
}

function setup() {
  const P = fakePixi();
  const root = new P.Container();
  const ctx = new GLContext(P, root);
  ctx.beginFrame();
  return { P, root, ctx };
}

test('colours: hex, short hex and rgba', () => {
  assert.deepEqual(parseColor('#c40f0f'), [0xc40f0f, 1]);
  assert.deepEqual(parseColor('#fff'), [0xffffff, 1]);
  assert.deepEqual(parseColor('rgba(255,90,20,0.5)'), [0xff5a14, 0.5]);
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), [0x010203, 1]);
});

test('rectangles are transformed like on a canvas', () => {
  const { ctx } = setup();
  ctx.setTransform(2, 0, 0, 2, 10, 20);
  ctx.translate(5, 0);
  ctx.fillStyle = '#ff0000';
  ctx.globalAlpha = 0.5;
  ctx.fillRect(1, 1, 3, 4);
  const calls = ctx.gfx.calls;
  assert.deepEqual(calls[0], ['rect', 22, 22, 6, 8]);
  assert.deepEqual(calls[1], ['fill', { color: 0xff0000, alpha: 0.5 }]);
});

test('save and restore bring back the transform and styles', () => {
  const { ctx } = setup();
  ctx.fillStyle = '#123456';
  ctx.save();
  ctx.translate(100, 0);
  ctx.rotate(1);
  ctx.fillStyle = '#000';
  ctx.restore();
  assert.deepEqual(ctx.m, [1, 0, 0, 1, 0, 0]);
  assert.equal(ctx.fillStyle, '#123456');
});

test('circles get enough points to look round at their size on screen', () => {
  const { ctx } = setup();
  ctx.setTransform(3, 0, 0, 3, 0, 0);
  ctx.beginPath();
  ctx.arc(10, 10, 5, 0, Math.PI * 2);
  ctx.fill();
  const [, pts, closed] = ctx.gfx.calls.find(c => c[0] === 'poly');
  assert.equal(closed, true);
  assert.ok(pts.length / 2 >= 16, `only ${pts.length / 2} points`);
  for (let i = 0; i < pts.length; i += 2) {
    assert.ok(Math.abs(Math.hypot(pts[i] - 30, pts[i + 1] - 30) - 15) < 1e-6, 'point on the circle');
  }
});

test('line widths scale with the transform; hairlines are drawn faint, not lost', () => {
  const { ctx } = setup();
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(10, 0); ctx.stroke();
  ctx.lineWidth = 0.25;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(10, 0); ctx.stroke();
  const strokes = ctx.gfx.calls.filter(c => c[0] === 'stroke').map(c => c[1]);
  assert.equal(strokes[0].width, 3);
  assert.equal(strokes[1].width, 1);
  assert.equal(strokes[1].alpha, 0.5);
});

test('drawing order is kept: shapes after an inserted object go into a new layer', () => {
  const { P, root, ctx } = setup();
  ctx.fillRect(0, 0, 1, 1);
  const first = ctx.gfx;
  const layer = new P.Container();
  ctx.insert(layer);
  ctx.fillRect(0, 0, 1, 1);
  assert.notEqual(ctx.gfx, first);
  ctx.endFrame();
  assert.deepEqual(root.children, [first, layer, ctx.gfx]);
  // Next frame reuses the same graphics objects.
  ctx.beginFrame();
  ctx.fillRect(0, 0, 1, 1);
  assert.equal(ctx.gfx, first);
});

test('a path is kept after fill, so fill then stroke draws the same shape', () => {
  const { ctx } = setup();
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(4, 0); ctx.lineTo(4, 4); ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const polys = ctx.gfx.calls.filter(c => c[0] === 'poly');
  assert.equal(polys.length, 2);
  assert.deepEqual(polys[0][1], polys[1][1]);
  assert.equal(polys[1][2], true, 'closed outline');
});
