// The WebGL drawing layer (glctx.js) turns canvas drawing calls into triangles, the
// same ones PixiJS would make, drawn in batches. These tests use a stand-in for PixiJS
// (just a container and earcut) and look at the triangles; the line builder is checked
// against PixiJS's own. (tests/browser/webgl.mjs checks the real thing against the canvas.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { GLContext, parseColor, packColor, lineTriangles } from '../web/src/glctx.js';

/** A pretend PixiJS: a container, and a simple earcut (a fan: the test shapes are convex). */
function fakePixi() {
  class Container {
    constructor() { this.children = []; }
    removeChildren() { this.children = []; }
    addChild(...c) { this.children.push(...c); }
  }
  const earcut = (pts, holes, dim) => {
    const out = [];
    for (let i = 1; i + 1 < pts.length / dim; i++) out.push(0, i, i + 1);
    return out;
  };
  return { Container, earcut };
}

function setup() {
  const P = fakePixi();
  const root = new P.Container();
  const ctx = new GLContext(P, root);
  ctx.beginFrame();
  return { P, root, ctx };
}

/** A batch's corners as [x, y, colour], from corner `from` on. */
function corners(b, from = 0) {
  const out = [];
  for (let i = from; i < b.nv; i++) out.push([b.f32[i * 3], b.f32[i * 3 + 1], b.u32[i * 3 + 2]]);
  return out;
}

test('colours: hex, short hex and rgba', () => {
  assert.deepEqual(parseColor('#c40f0f'), [0xc40f0f, 1]);
  assert.deepEqual(parseColor('#fff'), [0xffffff, 1]);
  assert.deepEqual(parseColor('rgba(255,90,20,0.5)'), [0xff5a14, 0.5]);
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), [0x010203, 1]);
  // Packed as PixiJS packs a shape's colour: ABGR, the alpha cut down to a byte.
  assert.equal(packColor(0xff0000, 0.5), 0x7f0000ff);
  assert.equal(packColor(0x123456, 1), 0xff563412);
});

test('rectangles are transformed like on a canvas, and split as PixiJS splits them', () => {
  const { ctx } = setup();
  ctx.setTransform(2, 0, 0, 2, 10, 20);
  ctx.translate(5, 0);
  ctx.fillStyle = '#ff0000';
  ctx.globalAlpha = 0.5;
  ctx.fillRect(1, 1, 3, 4);
  const c = packColor(0xff0000, 0.5);
  assert.deepEqual(corners(ctx.batch), [[22, 22, c], [28, 22, c], [22, 30, c], [28, 30, c]]);
  assert.deepEqual([...ctx.batch.idx.subarray(0, ctx.batch.ni)], [0, 1, 2, 1, 3, 2]);
});

test('save and restore bring back the transform and styles', () => {
  const { ctx } = setup();
  ctx.fillStyle = '#123456';
  ctx.save();
  ctx.translate(100, 0);
  ctx.rotate(1);
  ctx.fillStyle = '#000';
  ctx.save();
  ctx.scale(3, 3);
  ctx.restore();
  ctx.restore();
  assert.deepEqual(ctx.m, [1, 0, 0, 1, 0, 0]);
  assert.equal(ctx.fillStyle, '#123456');
  ctx.restore(); // (one too many: nothing happens)
  assert.deepEqual(ctx.m, [1, 0, 0, 1, 0, 0]);
});

test('circles get enough points to look round at their size on screen', () => {
  const { ctx } = setup();
  ctx.setTransform(3, 0, 0, 3, 0, 0);
  ctx.beginPath();
  ctx.arc(10, 10, 5, 0, Math.PI * 2);
  ctx.fill();
  const pts = corners(ctx.batch);
  assert.ok(pts.length >= 16, `only ${pts.length} points`);
  for (const [x, y] of pts) assert.ok(Math.abs(Math.hypot(x - 30, y - 30) - 15) < 1e-4, 'point on the circle');
  assert.ok(ctx.batch.ni >= (pts.length - 2) * 3, 'filled with triangles');
});

test('line widths scale with the transform; hairlines are drawn faint, not lost', () => {
  const { ctx } = setup();
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(10, 0); ctx.stroke();
  const first = ctx.batch.nv;
  ctx.lineWidth = 0.25;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(10, 0); ctx.stroke();
  const a = corners(ctx.batch).slice(0, first), b = corners(ctx.batch, first);
  // (A butt-capped line: four corners, half its width either side.)
  assert.deepEqual(a.map(([x, y]) => [x, y]), [[0, 1.5], [0, -1.5], [20, 1.5], [20, -1.5]]);
  assert.deepEqual(b.map(([x, y]) => [x, y]), [[0, 0.5], [0, -0.5], [20, 0.5], [20, -0.5]]);
  assert.equal(a[0][2] >>> 24, 255);
  assert.equal(b[0][2] >>> 24, 127, 'a quarter-pixel line: a pixel wide at half the alpha');
});

test('drawing order is kept: shapes after an inserted object go into a new batch', () => {
  const { P, root, ctx } = setup();
  ctx.fillRect(0, 0, 1, 1);
  const first = ctx.batch;
  const layer = new P.Container();
  ctx.insert(layer);
  ctx.fillRect(0, 0, 1, 1);
  assert.notEqual(ctx.batch, first);
  ctx.endFrame();
  assert.deepEqual(root.children, [first, layer, ctx.batch]);
  // Next frame reuses the same batches, emptied.
  ctx.beginFrame();
  ctx.fillRect(0, 0, 1, 1);
  assert.equal(ctx.batch, first);
  assert.equal(first.nv, 4);
});

test('a path is kept after fill, so fill then stroke draws the same shape', () => {
  const { ctx } = setup();
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(4, 0); ctx.lineTo(4, 4); ctx.closePath();
  ctx.fill();
  const filled = ctx.batch.nv;
  assert.deepEqual(corners(ctx.batch).map(([x, y]) => [x, y]), [[0, 0], [4, 0], [4, 4]]);
  ctx.stroke();
  const outline = corners(ctx.batch, filled);
  assert.ok(outline.length >= 8, 'a closed outline round all three sides');
  // Every corner of the outline is within half the line's width of the triangle's sides.
  const near = (x, y) => Math.min(Math.abs(y), Math.abs(x - 4), Math.abs(x - y) / Math.SQRT2) <= 0.5 + 1e-9;
  for (const [x, y] of outline) assert.ok(near(x, y), `(${x}, ${y}) is on the outline`);
});

test('nothing made per frame for paths: parts of paths and saved states are reused', () => {
  const { ctx } = setup();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(1, 1); ctx.rect(0, 0, 2, 2);
  const parts = ctx.subs.slice(0, ctx.nsub);
  ctx.save(); const saved = ctx.stack[0]; ctx.restore();
  ctx.beginPath(); ctx.moveTo(5, 5); ctx.lineTo(6, 6); ctx.rect(1, 1, 2, 2);
  ctx.save();
  assert.deepEqual(ctx.subs.slice(0, ctx.nsub), parts, 'the same objects');
  assert.equal(ctx.stack[0], saved);
});

test('lines are the same triangles PixiJS makes (its builder, copied)', async () => {
  const P = await import('../web/vendor/pixi.min.js');
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let t = 0; t < 2000; t++) {
    const n = 2 + Math.floor(rnd() * 5), pts = [];
    for (let i = 0; i < n; i++) {
      if (i && rnd() < 0.1) { pts.push(pts[pts.length - 2], pts[pts.length - 1]); continue; }
      pts.push(rnd() * 100 - 50, rnd() * 100 - 50);
    }
    const width = rnd() < 0.3 ? 1 : rnd() * 8;
    const cap = ['butt', 'round', 'square'][t % 3], join = ['miter', 'round', 'bevel'][Math.floor(t / 3) % 3], closed = t % 4 === 0;
    const v = [], idx = [];
    P.buildLine(pts.slice(), { width, alignment: 0.5, cap, join, miterLimit: 10 }, false, closed, v, idx);
    const mine = lineTriangles(pts, width, cap, join, closed);
    assert.deepEqual(mine.corners, v, `corners of line ${t}`);
    assert.deepEqual(mine.triangles, idx, `triangles of line ${t}`);
  }
});

test('polygons are cut into triangles by PixiJS\'s earcut', async () => {
  const P = await import('../web/vendor/pixi.min.js');
  const root = { children: [], removeChildren() { this.children = []; }, addChild(...c) { this.children.push(...c); } };
  const ctx = new GLContext({ earcut: P.earcut }, root);
  ctx.beginFrame();
  ctx.beginPath();
  // A star: not convex.
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 4 : 10, a = i * Math.PI / 5; ctx.lineTo(20 + Math.cos(a) * r, 20 + Math.sin(a) * r); }
  ctx.closePath();
  ctx.fill();
  const pts = corners(ctx.batch).flatMap(([x, y]) => [x, y]);
  assert.deepEqual([...ctx.batch.idx.subarray(0, ctx.batch.ni)], P.earcut(ctx.path[0].pts, [], 2));
  assert.equal(pts.length, 20);
});

test('a run of shapes with no triangles is hidden, so nothing an earlier frame left is drawn', async () => {
  // A pretend PixiJS with meshes (PixiJS, told to draw no triangles, draws the whole buffer).
  class Buffer { constructor(o) { this.data = o.data; } setDataWithSize(d, n) { this.data = d; this.size = n; } }
  class Geometry { constructor(o) { Object.assign(this, o); this.indexCount = 0; } }
  class Mesh { constructor(o) { Object.assign(this, o); this.visible = true; } }
  class Shader { constructor(o) { Object.assign(this, o); } }
  class GlProgram { constructor(o) { Object.assign(this, o); } }
  const { earcut } = await import('../web/vendor/pixi.min.js');
  const P = { ...fakePixi(), earcut, Buffer, Geometry, Mesh, Shader, GlProgram, BufferUsage: { VERTEX: 32, INDEX: 16, COPY_DST: 8 } };
  const root = new P.Container(), ctx = new GLContext(P, root);
  ctx.beginFrame();
  ctx.fillRect(0, 0, 10, 10);
  ctx.endFrame();
  const b = ctx.batches[0];
  assert.equal(b.mesh.visible, true);
  assert.equal(b.geometry.indexCount, 6);
  // The next frame, the same run of shapes is just a flat triangle: no area, no triangles.
  ctx.beginFrame();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(5, 0); ctx.lineTo(10, 0); ctx.fill();
  ctx.endFrame();
  assert.equal(b.ni, 0);
  assert.equal(b.mesh.visible, false, 'hidden: last frame\'s square isn\'t drawn again');
  ctx.beginFrame();
  ctx.fillRect(0, 0, 10, 10);
  ctx.endFrame();
  assert.equal(b.mesh.visible, true, 'shown again');
  assert.equal(b.geometry.indexCount, 6);
});

test('a whole circle with more of the path after it is cut up by earcut, as PixiJS would, not as a convex fan', async () => {
  const { earcut } = await import('../web/vendor/pixi.min.js');
  const { root } = setup();
  const ctx = new GLContext({ ...fakePixi(), earcut }, root);
  ctx.beginFrame();
  // Two circles in one part of a path (no moveTo between them, as a canvas allows): not convex.
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.arc(50, 0, 10, 0, Math.PI * 2);
  ctx.fill();
  assert.deepEqual([...ctx.batch.idx.subarray(0, ctx.batch.ni)], earcut(ctx.path[0].pts, [], 2));
  // And a circle with a line after it.
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.lineTo(30, 30);
  const first = ctx.batch.ni, base = ctx.batch.nv;
  ctx.fill();
  assert.deepEqual([...ctx.batch.idx.subarray(first, ctx.batch.ni)].map(i => i - base), earcut(ctx.path[0].pts, [], 2));
});

test('gradient textures are kept by the context alone, not in PixiJS\'s shared cache (where they\'d outlive the renderer)', () => {
  const skipped = [];
  class Sprite { constructor(t) { this.texture = t; this.anchor = { set() {} }; this.position = { set() {} }; } }
  const P = { ...fakePixi(), Sprite, Texture: { from: (cv, skipCache) => { skipped.push(skipCache); return { cv }; } } };
  const realDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) };
  try {
    const ctx = new GLContext(P, new P.Container());
    ctx.beginFrame();
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 10);
    g.addColorStop(0, 'rgba(255,0,0,1)');
    g.addColorStop(1, 'rgba(255,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
    assert.deepEqual(skipped, [true]);
  } finally {
    globalThis.document = realDocument;
  }
});
