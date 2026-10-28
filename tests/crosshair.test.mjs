// The crosshair's settings (Settings > Crosshair) and its drawing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CROSSHAIR_STYLES, CROSSHAIR_COLORS, CROSSHAIR_DEFAULTS, setCrosshair, crosshairColor, edgeColor, drawCrosshair } from '../web/src/crosshair.js';

/** A stand-in canvas that keeps what was drawn: strokes and fills, with their colour, width and opacity. */
function recorder() {
  const ops = [];
  let path = [];
  return {
    ops, globalAlpha: 1, lineWidth: 1, strokeStyle: '#000', fillStyle: '#000', lineCap: 'butt',
    beginPath() { path = []; },
    moveTo(x, y) { path.push(['M', x, y]); },
    lineTo(x, y) { path.push(['L', x, y]); },
    arc(x, y, r) { path.push(['A', x, y, r]); },
    stroke() { ops.push({ op: 'stroke', color: this.strokeStyle, width: this.lineWidth, alpha: this.globalAlpha, path }); },
    fill() { ops.push({ op: 'fill', color: this.fillStyle, alpha: this.globalAlpha, path }); },
  };
}

test('crosshair settings: anything missing or silly goes back to its default', () => {
  assert.deepEqual(setCrosshair({}), { ...CROSSHAIR_DEFAULTS });
  assert.deepEqual(setCrosshair(null), { ...CROSSHAIR_DEFAULTS });
  const xh = setCrosshair({ style: 'banana', color: 'plaid', custom: 'red', size: 999, thickness: -3, gap: 'wide', opacity: 0, outline: 'yes' });
  assert.equal(xh.style, CROSSHAIR_DEFAULTS.style);
  assert.equal(xh.color, 'default');
  assert.equal(xh.custom, CROSSHAIR_DEFAULTS.custom);
  assert.equal(xh.size, 20, 'size at most 20');
  assert.equal(xh.thickness, 1, 'thickness at least 1');
  assert.equal(xh.gap, CROSSHAIR_DEFAULTS.gap);
  assert.equal(xh.opacity, 20, 'never invisible');
  assert.equal(xh.outline, true);
  setCrosshair(CROSSHAIR_DEFAULTS);
});

test('crosshair colour: each game\'s own by default, the one picked otherwise, red down a sniper scope', () => {
  setCrosshair({});
  assert.equal(crosshairColor('classic'), '#111111');
  assert.equal(crosshairColor('remastered'), '#ffffff');
  setCrosshair({ color: '#2ee6ff' });
  assert.equal(crosshairColor('classic'), '#2ee6ff');
  assert.equal(crosshairColor('remastered'), '#2ee6ff');
  setCrosshair({ color: 'custom', custom: '#ABCDEF' });
  assert.equal(crosshairColor('classic'), '#abcdef');
  assert.notEqual(crosshairColor('classic', true), '#abcdef', 'sniping: red');
  assert.match(edgeColor('#111111'), /255,255,255/, 'a dark crosshair gets a light edge');
  assert.match(edgeColor('#ffffff'), /0,0,0/, 'a light one a dark edge');
  setCrosshair({});
});

test('every crosshair style draws, in the colour, thickness and opacity set', () => {
  for (const [style] of CROSSHAIR_STYLES) {
    setCrosshair({ style, color: '#3dff5a', thickness: 3, opacity: 50, outline: false, size: 8, gap: 5 });
    const ctx = recorder();
    drawCrosshair(ctx, 100, 50);
    assert.ok(ctx.ops.length > 0, `${style} drew nothing`);
    for (const o of ctx.ops) {
      assert.equal(o.color, '#3dff5a', style);
      assert.equal(o.alpha, 0.5, style);
      if (o.op === 'stroke') assert.equal(o.width, 3, style);
    }
    assert.equal(ctx.globalAlpha, 1, 'opacity put back');
  }
  // The cross: four arms from the gap out to gap + size.
  setCrosshair({ style: 'cross', size: 8, gap: 5, outline: false });
  const ctx = recorder();
  drawCrosshair(ctx, 100, 50);
  const ends = ctx.ops[0].path.filter(p => p[0] === 'L').map(p => Math.hypot(p[1] - 100, p[2] - 50));
  assert.deepEqual(ends, [13, 13, 13, 13]);
  assert.equal(ctx.ops.length, 1, 'no dot');
  // With the edge: drawn first, wider, in the opposite shade.
  setCrosshair({ style: 'crossDot', color: '#ffffff', outline: true, thickness: 2 });
  const e = recorder();
  drawCrosshair(e, 0, 0);
  assert.equal(e.ops[0].width, 4);
  assert.match(e.ops[0].color, /0,0,0/);
  assert.equal(e.ops.at(-1).color, '#ffffff');
  setCrosshair({});
});

test('the reload ring sits outside a big crosshair', () => {
  setCrosshair({ style: 'cross', size: 20, gap: 12 });
  const ctx = recorder();
  drawCrosshair(ctx, 0, 0, { reload: 0.5 });
  const ring = ctx.ops[0].path.find(p => p[0] === 'A');
  assert.ok(ring[3] > 32, `ring radius ${ring[3]}`);
  setCrosshair({});
  const small = recorder();
  drawCrosshair(small, 0, 0, { reload: 0.5 });
  assert.equal(small.ops[0].path.find(p => p[0] === 'A')[3], 15, 'the usual size by default');
});
