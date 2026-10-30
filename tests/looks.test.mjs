// Maps that mix the two games' looks (the map maker's Look tool): a block can keep the
// original's paper and ink, or Remastered's solid blocks, whichever game is played.
// (tests/browser/editor.mjs uses the tool; tests/browser/remastered.mjs plays such a map.)
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMap, encodeShare, decodeShare, encodeSSM, decodeSSM } from '../web/src/custommaps.js';
import { GameMap, seamsOf } from '../web/src/map.js';
import { paintMap } from '../web/src/maptiles.js';
import { Blocks } from '../web/src/rm/blocks.js';
import { makeMaterials } from '../web/src/rm/textures.js';
import { THEMES, themeFor } from '../web/src/rm/themes.js';
import { Renderer } from '../web/src/render.js';

globalThis.window ??= { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, addEventListener() {} };

/** A 2D context (without pictures to repeat, like WebGL's stand-in) recording what each fill covered. */
function recorder() {
  const ctx = { fills: [], fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1 };
  for (const m of ['beginPath', 'moveTo', 'lineTo', 'closePath', 'stroke', 'fill', 'setTransform', 'save', 'restore', 'strokeRect', 'arc']) ctx[m] = () => {};
  ctx.fillRect = (x, y, w, h) => ctx.fills.push({ x, y, w, h, style: ctx.fillStyle });
  /** The blocks of `map` whose whole front was filled with `style`, in the order filled. */
  ctx.filled = (map, style) => ctx.fills.filter(f => f.style === style)
    .map(f => map.solids.find(s => s.l === f.x && s.t === f.y && s.r - s.l === f.w && s.b - s.t === f.h)).filter(Boolean).map(s => s.id);
  return ctx;
}

// A row of blocks meeting end to end: a (the game's own look), b (Remastered's), c (the original's), d (the game's own).
const row = () => new GameMap({
  name: 'Half and half', bounds: { left: -400, top: -400, right: 800, bottom: 400 }, spawns: [], items: [],
  platforms: [
    { left: 0, top: 0, right: 100, bottom: 20 },
    { left: 100, top: 0, right: 200, bottom: 20, look: 'remastered' },
    { left: 200, top: 0, right: 300, bottom: 20, look: 'classic' },
    { left: 300, top: 0, right: 400, bottom: 20 },
  ],
});

test('map data keeps each platform\'s look (not jump pads\'), in share links too', async () => {
  const data = normalizeMap({
    name: 'Half and half',
    platforms: [
      { left: -400, top: 0, right: 0, bottom: 40, look: 'classic' },
      { left: 0, top: 0, right: 400, bottom: 40, look: 'remastered', hard: true },
      { left: -100, top: -100, right: 100, bottom: -80 },
      { left: 200, top: -60, right: 260, bottom: -44, bounce: -8, look: 'remastered' },
      { left: -300, top: -60, right: -200, bottom: -40, look: 'shiny' },
      { left: 100, top: -200, right: 160, bottom: -180, look: '__proto__' },
    ],
    spawns: [{ x: -300, y: -24, team: 1 }, { x: 300, y: -24, team: 2 }],
    items: [],
  });
  assert.deepEqual(data.platforms.map(p => p.look), ['classic', 'remastered', undefined, undefined, undefined, undefined]);
  assert.equal(data.platforms[1].hard, true);
  const back = await decodeShare(await encodeShare(data));
  assert.deepEqual(back.platforms, data.platforms, 'a share link (and so an online match, and a community upload) keeps them');
  // The original game's .ssm files have no room for them: the map comes back without.
  assert.ok(decodeSSM(encodeSSM(data)).platforms.every(p => !p.look));
});

test('blocks keep their look: pieces broken off too, while built blocks look like the game played', () => {
  const m = new GameMap(normalizeMap({
    name: 'Holes', spawns: [{ x: 0, y: -24, team: 1 }], items: [],
    platforms: [{ left: -400, top: 0, right: 0, bottom: 40, look: 'classic' }, { left: 0, top: 0, right: 400, bottom: 40 }],
  }));
  assert.deepEqual(m.looks, { classic: true, remastered: false });
  assert.deepEqual(m.solids.map(s => s.look), ['classic', null]);
  m.carve(-200, 20, 30);
  const pieces = m.solids.filter(s => s.l < 0);
  assert.ok(pieces.length > 1 && pieces.every(s => s.look === 'classic'), 'the block in pieces, each in the original\'s look');
  m.add(400, 0, 440, 40, true);
  assert.equal(m.solids.find(s => s.built).look, null);
  assert.deepEqual(new GameMap(normalizeMap({ name: 'Plain', spawns: [], items: [], platforms: [{ left: 0, top: 0, right: 10, bottom: 10 }] })).looks,
    { classic: false, remastered: false });
});

test('no hairline filled in between a paper block and a solid one: they keep their outline', () => {
  const m = row();
  const xs = seams => seams.map(s => s.x).sort((a, b) => a - b);
  assert.deepEqual(xs(seamsOf(m.solids)), [100, 200, 300], 'the blocks all meet');
  assert.deepEqual(xs(m.getSeams()), [300], 'in the original, only between blocks drawn on paper (c and d)');
  assert.deepEqual(xs(m.getSeams('remastered')), [], 'in Remastered, only between blocks given the original\'s look (none of them meet)');
  assert.equal(m.getSeams(), m.getSeams(), 'worked out once');
  m.carve(300, 10, 20);
  assert.deepEqual(xs(m.getSeams()), [], 'and again when blocks change (a hole where c and d met)');
});

test('each game draws on paper just the blocks in the original\'s look', () => {
  const m = row();
  let ctx = recorder();
  paintMap(ctx, m, 1.2, null, false);
  assert.deepEqual(ctx.filled(m, '#fff'), [0, 2, 3], 'the original: all but the one given Remastered\'s look');
  ctx = recorder();
  paintMap(ctx, m, 1.2, { l: -100, t: -100, r: 500, b: 100 }, false);
  assert.deepEqual(ctx.filled(m, '#fff'), [0, 2, 3], '(the part on screen, likewise)');
  ctx = recorder();
  paintMap(ctx, m, 1.2, { l: -100, t: -100, r: 500, b: 100 }, false, 'remastered');
  assert.deepEqual(ctx.filled(m, '#fff'), [2], 'Remastered: just the one given the original\'s look');
});

test('...and the solid 2.5D blocks just the ones in Remastered\'s look', () => {
  const m = row(), theme = { id: 'dusk', ...THEMES.dusk };
  const mats = makeMaterials(null, theme, { patterns: false });
  const front = mats.main.frontColor;
  const draw = own => {
    const ctx = recorder();
    const r = { ctx, cam: { x: 200, y: -300 }, view: { l: -200, t: -500, r: 600, b: 300 } };
    new Blocks().draw(r, m, mats, theme, false, { quality: 'medium', flat: true, ...(own ? { own } : {}) });
    return ctx.filled(m, front);
  };
  assert.deepEqual(draw(), [0, 1, 3], 'Remastered: all but the one given the original\'s look');
  assert.deepEqual(draw('classic'), [1], 'the original: just the one given Remastered\'s look');
});

test('the original draws a mixed map: the solid blocks first, in the map\'s theme, then the paper ones', () => {
  const m = row();
  for (const kind of ['canvas', 'webgl']) {
    const ctx = recorder();
    const r = new Renderer({ style: {}, width: 800, height: 600 }, ctx);
    r.kind = kind;
    Object.assign(r, { cleared: true, lineW: 1.2, view: { l: -200, t: -500, r: 600, b: 300 }, cam: { x: 200, y: -300, zoom: 1 } });
    r.drawMap({ map: m, options: {} });
    const front = makeMaterials(null, themeFor(m), { patterns: false }).main.frontColor;
    assert.deepEqual(ctx.filled(m, front), [1], `${kind}: the block given Remastered's look, in its theme's colours`);
    assert.deepEqual(ctx.filled(m, '#fff'), [0, 2, 3], `${kind}: the rest on paper`);
    const at = ctx.fills.findIndex(f => f.style === front), paper = ctx.fills.findIndex(f => f.style === '#fff' && f.w === 100);
    assert.ok(at < paper, `${kind}: the paper ones on top (their outline shows against the solid block)`);
    assert.equal(r.rmLook.pictures, false, `${kind}: plain colours where pictures can't be repeated`);
    r.forgetMatch();
    assert.equal(r.rmLook, null, 'let go of with the match');
  }
});
