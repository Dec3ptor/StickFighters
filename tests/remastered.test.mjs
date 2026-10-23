// Stick Soldiers Remastered's drawing, the parts that need no browser: which look
// each map gets, the looks themselves, which edges of the blocks get 2.5D sides,
// the HUD's colours, and Auto quality. (tests/browser/remastered.mjs plays it.)
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, THEME_IDS, MAP_THEMES, themeFor } from '../web/src/rm/themes.js';
import { LAYER_KINDS, FORE_KINDS } from '../web/src/rm/backdrop.js';
import { MATERIALS } from '../web/src/rm/textures.js';
import { Blocks } from '../web/src/rm/blocks.js';
import { swapColor, styledContext, HUD_FONT } from '../web/src/rm/hudstyle.js';
import { rgb } from '../web/src/rm/color.js';
import { RemasteredRenderer } from '../web/src/rm/renderer.js';
import { GameMap } from '../web/src/map.js';
import { mapIndex, loadMap } from './helpers.mjs';

test('every game map has a look of its own; custom maps always get the same one', () => {
  for (const m of mapIndex()) {
    const name = loadMap(m.file).name;
    assert.ok(MAP_THEMES[name], `${m.file} (${name}) has a look`);
    assert.equal(themeFor({ name }).id, MAP_THEMES[name]);
  }
  assert.equal(themeFor({ name: 'Fire in the Hole' }).id, 'dusk');
  assert.equal(themeFor({ name: 'Fatality Zone' }).id, 'night');
  const a = themeFor({ name: 'My Own Map' }), b = themeFor({ name: 'My Own Map' });
  assert.ok(THEME_IDS.includes(a.id) && a.id === b.id, 'a custom map picks a look from its name, the same every time');
  assert.equal(themeFor({ name: 'Fire in the Hole', theme: 'arctic' }).id, 'arctic', "a map's own look comes first");
  assert.equal(themeFor({ name: 'Fire in the Hole', theme: 'no such look' }).id, 'dusk');
  assert.equal(themeFor(null).id, themeFor({ name: '' }).id, 'no map at all: still a look');
});

test('every look has what the drawing needs', () => {
  for (const [id, t] of Object.entries(THEMES)) {
    assert.ok(t.sky.length >= 2 && t.sky.every(([o, c], i) => o >= 0 && o <= 1 && (i === 0 || o > t.sky[i - 1][0]) && rgb(c)), `${id}: sky`);
    assert.ok(t.layers.length >= 2, `${id}: layers`);
    t.layers.forEach((L, i) => {
      assert.ok(LAYER_KINDS.includes(L.gen), `${id}: layer ${L.gen}`);
      assert.ok(L.p > 0 && L.p < 1 && L.height > 0, `${id}: layer ${i} moves slower than the play area`);
      if (i) assert.ok(L.p > t.layers[i - 1].p, `${id}: layers go from far to near`);
    });
    if (t.fore) assert.ok(FORE_KINDS.includes(t.fore.gen) && t.fore.height > 0 && rgb(t.fore.color), `${id}: foreground`);
    assert.ok(MATERIALS[t.material] && MATERIALS[t.top], `${id}: materials ${t.material}, ${t.top}`);
    for (const k of ['haze', 'ground', 'tint', 'ink', 'halo', 'rim']) assert.equal(rgb(t[k]).length, 4, `${id}: ${k}`);
    assert.ok(t.dark >= 0 && t.dark < 1 && t.vignette >= 0 && t.vignette < 1, `${id}: darkness and vignette`);
  }
});

const map = blocks => new GameMap({
  name: 'test', bounds: { left: -400, top: -400, right: 400, bottom: 400 }, spawns: [], items: [],
  platforms: blocks.map(([left, top, right, bottom]) => ({ left, top, right, bottom })),
});

test('blocks get sides only along open edges, not where they meet another block', () => {
  // A floor, a block standing on it, and a block against its right end.
  const m = map([[0, 0, 100, 20], [20, -30, 60, 0], [100, 0, 200, 20]]);
  const [floor, box, next] = m.solids;
  const B = new Blocks();
  const e = B.edges(m, floor);
  assert.deepEqual(e.top, [[0, 20], [60, 100]], 'the floor\'s top shows either side of the box');
  assert.deepEqual(e.right, [], 'not where the next block carries on');
  assert.deepEqual(e.left, [[0, 20]]);
  assert.deepEqual(e.bottom, [[0, 100]]);
  assert.deepEqual(B.edges(m, box).bottom, [], 'the box\'s underside sits on the floor');
  assert.deepEqual(B.edges(m, next).left, []);
  assert.equal(B.edges(m, floor), e, 'worked out once');
});

test('blocks changing (building, holes): the edges near the change are worked out again', () => {
  const m = map([[0, 0, 100, 20], [300, 0, 380, 20]]);
  const [floor, far] = m.solids;
  const B = new Blocks();
  B.catchUp(m);
  assert.deepEqual(B.edges(m, floor).left, [[0, 20]]);
  const farEdges = B.edges(m, far);
  m.add(-40, 0, 0, 20, true); // a wall built against the floor's left end
  B.catchUp(m);
  assert.deepEqual(B.edges(m, floor).left, [], 'covered by the new block');
  assert.equal(B.edges(m, far), farEdges, 'blocks far from the change keep theirs');
  // A hole right through a block: its sides show inside the hole.
  const m2 = map([[0, 0, 300, 40]]);
  const B2 = new Blocks();
  B2.catchUp(m2);
  const before = B2.edges(m2, m2.solids[0]).top.reduce((n, [a, b]) => n + b - a, 0);
  m2.carve(150, 20, 30);
  B2.catchUp(m2);
  const pieces = m2.solids;
  assert.ok(pieces.length > 1, 'the block is in pieces');
  const after = pieces.reduce((n, s) => n + B2.edges(m2, s).top.reduce((k, [a, b]) => k + b - a, 0), 0);
  assert.ok(after < before - 20, `less top showing with a hole in it (${before} -> ${after})`);
  const sides = pieces.reduce((n, s) => n + B2.edges(m2, s).left.length + B2.edges(m2, s).right.length, 0);
  assert.ok(sides >= 4, 'the hole has sides, as do the block\'s ends');
});

test('the HUD in Remastered: light text for dark, dark glass for white panels', () => {
  assert.equal(swapColor('#222'), '#f2f5f9');
  assert.equal(swapColor('#C22'), '#ff5a4a');
  assert.equal(swapColor('rgba(255,255,255,0.92)'), 'rgba(12,16,24,0.78)');
  assert.match(swapColor('rgba(255, 255, 255, 0.35)'), /^rgba\(12,16,24,0\.3\d\)$/);
  assert.equal(swapColor('rgba(0,0,0,0.15)'), 'rgba(255,255,255,0.18)');
  assert.equal(swapColor('#123456'), '#123456', 'other colours stay');
  const gradient = {};
  assert.equal(swapColor(gradient), gradient);

  const calls = [];
  const ctx = {
    fillStyle: '#000000', strokeStyle: '#000000', font: '', shadowColor: 'rgba(0,0,0,0)', shadowBlur: 0, shadowOffsetY: 0,
    fillText(t) { calls.push([t, this.shadowColor]); },
    fillRect() { calls.push(['rect', this.fillStyle]); },
  };
  const hud = styledContext(ctx, () => 2);
  hud.font = 'bold 14px Arial, sans-serif';
  assert.equal(ctx.font, `bold 14px ${HUD_FONT}`, 'the font is a modern one');
  hud.fillStyle = 'rgba(255,255,255,0.92)';
  hud.fillRect(0, 0, 10, 10);
  hud.fillStyle = '#222';
  assert.equal(ctx.fillStyle, '#f2f5f9');
  hud.fillText('Scores', 0, 0);
  assert.deepEqual(calls, [['rect', 'rgba(12,16,24,0.78)'], ['Scores', 'rgba(0,0,0,0.7)']], 'light text gets a shadow; panels go dark');
  assert.equal(ctx.shadowColor, 'rgba(0,0,0,0)', 'and only that text');
  assert.equal(ctx.shadowBlur, 0);
});

test('Auto quality: a level down each time the frame pacer finds frames can\'t keep up, before it lowers the rate', () => {
  const r = Object.create(RemasteredRenderer.prototype);
  Object.assign(r, { auto: true, quality: 'high', adaptedAt: 0, look: { at: 0 } });
  assert.equal(r.shed(10000), true, 'frames can\'t keep up: a level down (and the rate is left alone)');
  assert.equal(r.quality, 'medium');
  assert.equal(r.shed(11000), true, 'straight after a step the scenery is being made: too soon to tell (the rate is still left alone)');
  assert.equal(r.quality, 'medium');
  r.look = { at: 11000 };
  assert.equal(r.shed(13000), true, 'nor straight after a new look (a map starting)');
  assert.equal(r.quality, 'medium');
  r.look = { at: 0 };
  assert.equal(r.shed(14000), true, 'once that has settled, another level down');
  assert.equal(r.quality, 'low');
  assert.equal(r.flat, true);
  assert.equal(r.shed(40000), false, 'low is as low as it goes: now the rate can come down');
  const fixed = Object.assign(Object.create(RemasteredRenderer.prototype), { auto: false, quality: 'high', adaptedAt: 0, look: null });
  assert.equal(fixed.shed(50000), false);
  assert.equal(fixed.quality, 'high', 'a quality picked in Settings stays');
});

test('the HUD stand-in passes everything else straight through, to the real context', () => {
  // A context like a browser's: methods and properties on its prototype.
  class FakeContext {
    constructor() { this.log = []; this._fill = '#000000'; this._font = '10px sans-serif'; this.lineWidth = 1; }
    get fillStyle() { return this._fill; }
    set fillStyle(v) { this._fill = v; }
    get strokeStyle() { return this._stroke; }
    set strokeStyle(v) { this._stroke = v; }
    get font() { return this._font; }
    set font(v) { this._font = v; }
    get canvas() { return 'the canvas'; }
    drawImage(...a) { this.log.push(['drawImage', a.length, this instanceof FakeContext]); }
    measureText(t) { return { width: t.length * 5 }; }
    fillText(t) { this.log.push(['text', t, this.shadowColor]); }
  }
  const real = new FakeContext();
  const hud = styledContext(real, () => 1);
  hud.drawImage('img', 1, 2);
  hud.drawImage('img', 1, 2, 3, 4, 5, 6, 7, 8);
  assert.deepEqual(real.log, [['drawImage', 3, true], ['drawImage', 9, true]], 'as many arguments as were given, to the real context');
  assert.equal(hud.measureText('abc').width, 15);
  assert.equal(hud.canvas, 'the canvas');
  hud.lineWidth = 4;
  assert.equal(real.lineWidth, 4);
  assert.equal(hud.lineWidth, 4);
  hud.strokeStyle = '#333';
  assert.equal(real.strokeStyle, '#e3e8ef');
  hud.font = 'bold 12px Arial, Helvetica, sans-serif';
  assert.equal(real.font, `bold 12px ${HUD_FONT}`);
  hud.fillStyle = '#123456';
  assert.equal(hud.fillStyle, '#123456', 'other colours stay');
  // One kind of context, one class: made once.
  const again = styledContext(new FakeContext(), () => 1);
  assert.equal(Object.getPrototypeOf(again), Object.getPrototypeOf(hud));
});

test('night maps, drawn by the processor: the darkness is stretched over the screen only round the lights, and filled plainly everywhere else, once', async () => {
  const { Lights, fillAround } = await import('../web/src/rm/fx.js');
  const L = new Lights();
  L.add(100, 100, 20, '#fff', 0.8);
  L.add(110, 105, 10, '#fff', 0.8); // (overlaps the first: one box for both)
  L.add(600, 300, 15, '#fff', 0.5);
  L.add(5000, 5000, 15, '#fff', 0.5); // (far off the screen: no box)
  const boxes = L.litBoxes(1 / 4, 0, 0, 4, 4, 1280, 720);
  assert.equal(boxes.length, 2, 'overlapping lights share a box; off-screen ones have none');
  for (const b of boxes) assert.ok(b.every(Number.isInteger), 'whole pixels');
  // Every light's reach (1.6 x its radius, and a bit) is inside a box.
  for (const l of L.list.slice(0, 3)) {
    const R = l.r * 1.6;
    assert.ok(boxes.some(([x0, y0, x1, y1]) => x0 <= l.x - R && y0 <= l.y - R && x1 >= l.x + R && y1 >= l.y + R), `light at ${l.x},${l.y} covered`);
  }
  // The fills cover the rest of the screen, every pixel exactly once.
  const W = 64, H = 48, grid = new Uint8Array(W * H), rects = [[5, 4, 20, 30], [30, 10, 50, 20], [40, 30, 64, 48]];
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) grid[y * W + x]++;
  fillAround({ fillRect: (x, y, w, h) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid[j * W + i]++; } }, rects, W, H);
  assert.ok(grid.every(v => v === 1), 'each pixel drawn once: in a box or by a fill');
  // Too many lights over too much of the screen: just stretched over all of it.
  const many = new Lights();
  for (let i = 0; i < 20; i++) many.add(i * 70, 360, 200, '#fff', 0.9);
  assert.equal(many.litBoxes(1 / 4, 0, 0, 4, 4, 1280, 720), null);
});

test('the darkness is worked out again only when the view or the lights change', async () => {
  const { Lights } = await import('../web/src/rm/fx.js');
  const L = new Lights();
  L.add(10, 10, 20, '#fff', 0.5);
  assert.equal(L.darkChanged(0.3, 4, 5), true);
  L.clear(); L.add(10, 10, 20, '#fff', 0.5);
  assert.equal(L.darkChanged(0.3, 4, 5), false, 'the same lights in the same view');
  assert.equal(L.darkChanged(0.3, 4.25, 5), true, 'the view moved');
  L.clear(); L.add(10, 11, 20, '#fff', 0.5);
  assert.equal(L.darkChanged(0.3, 4.25, 5), true, 'a light moved');
  const first = L.list[0];
  L.clear(); L.add(1, 2, 3, '#fff', 0.4);
  assert.equal(L.list[0], first, 'light objects are reused');
});

test('weather: a drop starting again draws its random numbers in the same order as a new one', async () => {
  const { Weather } = await import('../web/src/rm/fx.js');
  const random = Math.random;
  let seed = 5;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  try {
    Math.random = rnd;
    const w = new Weather('snow', 'high');
    seed = 99;
    const made = w.spawn(0.3);
    seed = 99;
    const again = w.respawn({ x: 7, y: 7, z: 7, v: 7, s: 7, ph: 7 }, 0.3);
    assert.deepEqual(again, made);
    // As it was worked out before: depth first, then across, speed, size and phase.
    seed = 99;
    const d = { fall: [0.6, 1.6], size: [1.2, 3.4] }, z = 0.35 + Math.random() * 1.25;
    assert.deepEqual(made, { x: Math.random(), y: 0.3, z, v: d.fall[0] + Math.random() * (d.fall[1] - d.fall[0]), s: d.size[0] + Math.random() * (d.size[1] - d.size[0]), ph: Math.random() * 6.3 });
  } finally {
    Math.random = random;
  }
});

test('soldiers\' colours are worked out once, and stay the same', async () => {
  const { soldierColor } = await import('../web/src/rm/soldiers.js');
  const ffa = { rules: { teams: false } }, teams = { rules: { teams: true } };
  const a = soldierColor(ffa, { id: 7 }), b = soldierColor(ffa, { id: 7 });
  assert.equal(a, `hsl(${((7 * 137.508) % 360).toFixed(0)},70%,55%)`);
  assert.equal(a, b);
  assert.equal(soldierColor(teams, { team: 2 }), '#e8483a');
  assert.equal(soldierColor(teams, { team: 5 }), '#9aa4b2');
});

test('drawn by the processor: the still scenery and the vignette are copied on from screen-sized copies, stretched once', async () => {
  const { Backdrop } = await import('../web/src/rm/backdrop.js');
  const { drawnByCPU, drawVignette } = await import('../web/src/rm/fx.js');
  assert.equal(drawnByCPU(), true, 'no graphics card here');
  // Pretend canvases that note what's drawn onto them.
  const fakeCanvas = name => {
    const log = [];
    const ctx = {
      log, globalCompositeOperation: 'source-over', fillStyle: '#000',
      setTransform() {}, fillRect() {}, createRadialGradient: () => ({ addColorStop() {} }),
      drawImage(img, ...a) { log.push([img.name, this.globalCompositeOperation, ...a]); },
    };
    return { name, width: 0, height: 0, getContext: () => ctx, addEventListener() {}, log };
  };
  const made = [], realDocument = globalThis.document;
  globalThis.document = { createElement: () => { const c = fakeCanvas(`made${made.length}`); made.push(c); return c; } };
  try {
    const screen = fakeCanvas('screen'), ctx = screen.getContext(), r = { pw: 1280, ph: 720 };
    const b = Object.create(Backdrop.prototype);
    b.buf = fakeCanvas('small');
    b.picture = 1;
    b.present(ctx, r);
    assert.deepEqual(screen.log, [['small', 'copy', 0, 0, 1280, 720]], 'a new picture: stretched over the screen');
    b.present(ctx, r, true);
    b.present(ctx, r, true);
    assert.equal(made.length, 1, 'one screen-sized copy');
    assert.deepEqual(made[0].log, [['small', 'copy', 0, 0, 1280, 720]], 'the picture stretched into it once');
    assert.deepEqual(screen.log.slice(1), [['made0', 'copy', 0, 0], ['made0', 'copy', 0, 0]], 'then copied on as it is');
    b.picture++; // (drawn again: the camera moved)
    b.present(ctx, r);
    b.present(ctx, r, true);
    assert.equal(made[0].log.length, 2, 'a new picture is stretched into the copy again, when it stays still');
    b.present(ctx, { pw: 1000, ph: 600 }, true);
    assert.deepEqual(made[1].log, [['small', 'copy', 0, 0, 1000, 600]], 'and for a new screen size, a new copy');
    // The vignette: worked out small, stretched to full size once, then copied on.
    screen.log.length = 0;
    const before = made.length;
    drawVignette(ctx, 640, 360, 0.37);
    drawVignette(ctx, 640, 360, 0.37);
    assert.equal(made.length - before, 2, 'the small one, and the full-size one');
    const [small, full] = made.slice(before);
    assert.deepEqual(full.log, [[small.name, 'source-over', 0, 0, 640, 360]]);
    assert.deepEqual(screen.log, [[full.name, 'source-over', 0, 0], [full.name, 'source-over', 0, 0]]);
  } finally {
    globalThis.document = realDocument;
  }
});

test('leaving Remastered lets go of the screen-sized copies, and the scenery they were of', async () => {
  const { Backdrop } = await import('../web/src/rm/backdrop.js');
  const { drawVignette } = await import('../web/src/rm/fx.js');
  const fakeCanvas = name => {
    const ctx = {
      globalCompositeOperation: 'source-over', fillStyle: '#000',
      setTransform() {}, fillRect() {}, createRadialGradient: () => ({ addColorStop() {} }), drawImage() {},
    };
    return { name, width: 0, height: 0, getContext: () => ctx, addEventListener() {} };
  };
  const made = [], realDocument = globalThis.document, realWindow = globalThis.window;
  globalThis.document = { createElement: () => { const c = fakeCanvas(`made${made.length}`); made.push(c); return c; } };
  globalThis.window = { removeEventListener() {} };
  try {
    const ctx = fakeCanvas('screen').getContext(), r = { pw: 800, ph: 450 };
    const b = Object.create(Backdrop.prototype);
    b.buf = fakeCanvas('small');
    b.picture = 1;
    b.present(ctx, r, true);
    drawVignette(ctx, 800, 450, 0.21);
    const copies = made.length;
    b.present(ctx, r, true);
    drawVignette(ctx, 800, 450, 0.21);
    assert.equal(made.length, copies, 'kept while Remastered draws');
    // Switched to the original game: the renderer goes, and its copies with it.
    RemasteredRenderer.prototype.destroy.call(Object.create(RemasteredRenderer.prototype));
    b.present(ctx, r, true);
    drawVignette(ctx, 800, 450, 0.21);
    assert.equal(made.length, copies + 2, 'made again when needed: the scenery\'s copy and the full-size vignette');
  } finally {
    globalThis.document = realDocument;
    globalThis.window = realWindow;
  }
});
