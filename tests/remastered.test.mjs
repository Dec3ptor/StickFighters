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

test('Auto quality: a level down each time the frame pacer has to step the rate down, once things have settled', () => {
  const r = Object.create(RemasteredRenderer.prototype);
  Object.assign(r, { auto: true, quality: 'high', adaptedAt: 0, look: { at: 0 }, seenSteps: null });
  const pacer = { mode: 'auto', divisor: 1, stepped: 3, retries: 0, restarts: 0, tryAgainSoon() { this.retries++; }, restart() { this.restarts++; } };
  assert.equal(r.adapt(pacer, 10000), false, 'steps from before it was watching don\'t count');
  assert.equal(r.adapt(pacer, 10000), false, 'keeping up');
  pacer.divisor = 2; pacer.stepped = 4;
  assert.equal(r.adapt(pacer, 10000), true, 'the pacer stepped the rate down (it takes a couple of slow seconds to): a level down');
  assert.equal(r.quality, 'medium');
  assert.equal(pacer.divisor, 2, '...the rate stays steady');
  assert.equal(pacer.retries, 1, '...and the full rate is tried again soon at the new quality');
  assert.equal(pacer.restarts, 1, '...with the scenery-making moments not judged');
  pacer.stepped = 5;
  assert.equal(r.adapt(pacer, 11000), false, 'not straight after a step (the scenery is being made)');
  r.look = { at: 11000 };
  assert.equal(r.adapt(pacer, 13000), false, 'nor straight after a new look (a map starting)');
  r.look = { at: 0 };
  assert.equal(r.adapt(pacer, 14000), true, 'once that has settled, the step counts');
  assert.equal(r.quality, 'low');
  pacer.stepped = 6;
  assert.equal(r.adapt(pacer, 40000), false, 'low is as low as it goes');
  const fixed = Object.assign(Object.create(RemasteredRenderer.prototype), { auto: false, quality: 'high', adaptedAt: 0, look: null, seenSteps: null });
  pacer.stepped = 7;
  assert.equal(fixed.adapt(pacer, 50000), false);
  assert.equal(fixed.quality, 'high', 'a quality picked in Settings stays');
});
