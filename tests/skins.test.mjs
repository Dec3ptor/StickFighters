// Character skins (Settings, Character): each game draws every skin, on any canvas (WebGL's
// stand-in can't round corners or fade colours), the team's colour always on show. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKINS, isSkin, skinFor, drawSkinHead } from '../web/src/skins.js';
import { Renderer } from '../web/src/render.js';
import { RemasteredRenderer } from '../web/src/rm/renderer.js';
import { THEMES } from '../web/src/rm/themes.js';
import { botMatch } from './helpers.mjs';

globalThis.window ??= { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, addEventListener() {} };

/** A 2D context without rounded corners or gradients (like WebGL's), recording the colours each stroke and fill used. */
function canvasLike() {
  const ctx = { calls: [], strokes: [], fills: [], fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', globalAlpha: 1, font: '10px sans-serif' };
  const keys = ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'globalAlpha', 'font'];
  const stack = [];
  ctx.save = () => { ctx.calls.push('save'); stack.push(keys.map(k => ctx[k])); };
  ctx.restore = () => { ctx.calls.push('restore'); const v = stack.pop(); keys.forEach((k, i) => { ctx[k] = v[i]; }); };
  for (const m of ['beginPath', 'moveTo', 'lineTo', 'arc', 'ellipse', 'rect', 'closePath', 'setTransform', 'translate', 'rotate', 'scale', 'fillText', 'quadraticCurveTo', 'bezierCurveTo', 'strokeRect']) ctx[m] = () => ctx.calls.push(m);
  ctx.stroke = () => { ctx.calls.push('stroke'); ctx.strokes.push(ctx.strokeStyle); };
  ctx.fill = () => { ctx.calls.push('fill'); ctx.fills.push(ctx.fillStyle); };
  ctx.fillRect = () => { ctx.calls.push('fillRect'); ctx.fills.push(ctx.fillStyle); };
  ctx.measureText = t => ({ width: String(t).length * 4 });
  ctx.createRadialGradient = () => ({ addColorStop() {} });
  return ctx;
}

test('the skins, and which one each game draws a soldier with', () => {
  assert.deepEqual(SKINS.map(s => s.id), ['auto', 'classic', 'soldier', 'ninja', 'robot', 'cowboy', 'knight']);
  assert.ok(isSkin('ninja') && !isSkin('pirate') && !isSkin(undefined) && !isSkin('__proto__'));
  assert.equal(skinFor({ skin: 'auto' }, 'classic'), 'classic', 'the game\'s own: the stick figure in the original');
  assert.equal(skinFor({ skin: 'auto' }, 'soldier'), 'soldier', 'and the soldier in Remastered');
  assert.equal(skinFor({ skin: 'classic' }, 'soldier'), 'classic', 'the classic stick figure in Remastered');
  assert.equal(skinFor({ skin: 'soldier' }, 'classic'), 'soldier', 'and Remastered\'s soldier in the original');
  assert.equal(skinFor({ skin: 'nonsense' }, 'classic'), 'classic');
  assert.equal(skinFor({}, 'soldier'), 'soldier');
});

/** A team match with soldiers about, each given skin `skin`. */
function soldiersIn(skin) {
  const { game } = botMatch('ssdm1.json', { bots: 6, mode: 'team' });
  for (let i = 0; i < 300; i++) game.update();
  const list = game.soldiers.filter(s => s.alive);
  list.forEach((s, i) => { s.skin = skin; s.armour = i % 2 ? 40 : 0; s.body.hasJetpack = i % 3 === 0; s.body.jetting = i % 3 === 0; });
  return { game, list };
}

test('the original draws every skin (Remastered\'s soldier too), leaving the canvas as it found it', () => {
  for (const { id } of SKINS) {
    const { game, list } = soldiersIn(id);
    const ctx = canvasLike();
    const r = new Renderer({ style: {}, width: 0, height: 0 }, ctx);
    r.s = 1.5; r.tx = 0; r.ty = 0; r.alpha = 0.5;
    ctx.lineCap = 'square';
    r.drawSoldiers(game, list, 0.5, list[0]);
    assert.equal(ctx.lineCap, 'square', `${id}: line ends as they were`);
    assert.equal(ctx.globalAlpha, 1, `${id}: opacity as it was`);
    assert.ok(ctx.calls.filter(c => c === 'stroke').length >= list.length, `${id}: drawn`);
    // Team colours: on the head (a band, a visor, a plume, a hat band), or the Remastered soldier's helmet.
    if (!['auto', 'classic'].includes(id)) {
      const used = new Set([...ctx.strokes, ...ctx.fills].map(String));
      const blue = id === 'soldier' ? '#3d7ff0' : '#2f6fdb', red = id === 'soldier' ? '#e8483a' : '#d33b2f';
      assert.ok(used.has(blue) && used.has(red), `${id}: both teams' colours (${[...used].join(' ')})`);
    }
  }
});

test('Remastered draws every skin (the classic stick figure too), with its theme\'s ink and the team colours', () => {
  for (const { id } of SKINS) {
    const { game, list } = soldiersIn(id);
    const ctx = canvasLike();
    const r = Object.assign(Object.create(RemasteredRenderer.prototype), { ctx, alpha: 1, look: { theme: THEMES.night }, lights: { add() {} } });
    for (const s of list) r.drawSoldier(game, s, 1);
    assert.equal(ctx.calls.filter(c => c === 'save').length, ctx.calls.filter(c => c === 'restore').length, `${id}: saves and restores match`);
    const used = new Set([...ctx.strokes, ...ctx.fills].map(String));
    assert.ok(used.has('#3d7ff0') && used.has('#e8483a'), `${id}: both teams' colours`);
  }
});

test('heads: every skin\'s, facing either way, leaving the line ends round', () => {
  for (const { id } of SKINS) {
    for (const facing of [1, -1]) {
      const ctx = canvasLike();
      drawSkinHead(ctx, { x: 0, y: -20, r: 4.2 }, id, facing, { ink: '#111', lw: 1.5, fill: '#fff', accent: '#2f6fdb', tick: 5 });
      assert.equal(ctx.lineCap, 'round');
      assert.ok(ctx.calls.includes('fill'), `${id}: drawn`);
    }
  }
});
