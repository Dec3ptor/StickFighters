// Drawing at any frame rate: the game updates 60 times a second, and frames
// (60, 120, 144 a second...) draw everything part way between two updates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { between, Renderer } from '../web/src/render.js';
import { Effects } from '../web/src/effects.js';
import { botMatch } from './helpers.mjs';
import fs from 'node:fs';
import { buildPose, setLegAnimations, hypot } from '../web/src/stickman.js';
import { WEAPONS } from '../web/src/weapons.js';
import { standingsOf } from '../web/src/hud.js';

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

test('aiming down the sights: the camera comes in a little, further toward the mouse; sniping zooms out instead', () => {
  const { game } = botMatch('ssdm1.json', { bots: 0 });
  const r = new Renderer(fakeCanvas(), {});
  const mouse = { x: r.w / 2 + 300, y: r.h / 2 };
  r.snapCamera(0, 0);
  for (let i = 0; i < 60; i++) r.updateCamera(game, 0, 0, mouse, false, 1000 / 60);
  const hip = r.cam.x;
  for (let i = 0; i < 60; i++) r.updateCamera(game, 0, 0, mouse, false, 1000 / 60, 1.1);
  assert.equal(r.cam.zoom, 1.1);
  assert.ok(r.cam.x > hip + 20, `looks further toward the mouse (${hip.toFixed(0)} -> ${r.cam.x.toFixed(0)})`);
  for (let i = 0; i < 60; i++) r.updateCamera(game, 0, 0, null, true, 1000 / 60, 1.1);
  assert.equal(r.cam.zoom, 0.72, 'sniping wins');
  for (let i = 0; i < 60; i++) r.updateCamera(game, 0, 0, null, false, 1000 / 60);
  assert.equal(r.cam.zoom, 1, 'and back');
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

// ---- Drawing without garbage, and the same picture ----------------------------------------

const LEGS_DATA = JSON.parse(fs.readFileSync(new URL('../web/data/animations/legs.json', import.meta.url), 'utf8'));

/** buildPose as it was before it kept a pose per soldier (new arrays every call): the reference. */
function oldPose(s) {
  const LEGS = LEGS_DATA.map(a => a.poses.map(p => ({ neck: p.neck, hip: p.hip, fk: p.front_knee, bk: p.back_knee, ff: p.front_foot, bf: p.back_foot })));
  const mix = (a, b, t) => { const out = {}; for (const k in a) out[k] = [a[k][0] + (b[k][0] - a[k][0]) * t, a[k][1] + (b[k][1] - a[k][1]) * t]; return out; };
  const sample = (i, t, loop) => {
    const poses = LEGS[i], n = poses.length;
    if (n === 1) return poses[0];
    const f = loop ? (((t % 1) + 1) % 1) * n : Math.max(0, Math.min(1, t)) * (n - 1);
    const k = Math.floor(f);
    return mix(poses[k % n], poses[loop ? (k + 1) % n : Math.min(k + 1, n - 1)], f - k);
  };
  const legPose = () => {
    const b = s.body, a = s.anim;
    if (!b.onGround) {
      if (a.flip > 0) return sample(3, 1 - a.flip, true);
      if (b.jetting) return LEGS[6][0];
      return mix(LEGS[6][0], LEGS[6][1], Math.max(0, Math.min(1, (b.vy + 3) / 8)));
    }
    if (b.crouching) return Math.abs(b.vx) > 0.3 ? sample(5, a.run * 2, true) : LEGS[2][0];
    if (Math.abs(b.vx) > 0.3) return sample(1, a.run, true);
    if (a.land > 0) return mix(LEGS[4][0], LEGS[4][1], Math.sin(Math.PI * (1 - a.land / 10)) * 0.8);
    return mix(LEGS[0][0], LEGS[0][1], 0.12 * (0.5 - 0.5 * Math.cos(a.idle * 0.05)));
  };
  const reach = (sx, sy, tx, ty, bx, by) => {
    let dx = tx - sx, dy = ty - sy, d = Math.hypot(dx, dy) || 0.001;
    const max = 7.5 + 7 - 0.01;
    if (d > max) { tx = sx + (dx / d) * max; ty = sy + (dy / d) * max; dx = tx - sx; dy = ty - sy; d = max; }
    const ang = Math.acos(Math.max(-1, Math.min(1, (7.5 * 7.5 + d * d - 7 * 7) / (2 * 7.5 * d)))), base = Math.atan2(dy, dx);
    const e1 = [sx + Math.cos(base + ang) * 7.5, sy + Math.sin(base + ang) * 7.5], e2 = [sx + Math.cos(base - ang) * 7.5, sy + Math.sin(base - ang) * 7.5];
    return [(e1[0] - sx) * bx + (e1[1] - sy) * by >= (e2[0] - sx) * bx + (e2[1] - sy) * by ? e1 : e2, [tx, ty]];
  };
  const p = legPose(), m = -s.facing, P = k => [p[k][0] * m, p[k][1]];
  const neck = P('neck'), hip = P('hip');
  const lines = [[...neck, ...hip], [...hip, ...P('fk')], [...P('fk'), ...P('ff')], [...hip, ...P('bk')], [...P('bk'), ...P('bf')]];
  let ux = neck[0] - hip[0], uy = neck[1] - hip[1];
  const ul = Math.hypot(ux, uy) || 1;
  ux /= ul; uy /= ul;
  const head = { x: neck[0] + ux * 4.2, y: neck[1] + uy * 4.2, r: 4.2 };
  const sx = neck[0] - ux * 2, sy = neck[1] - uy * 2, def = WEAPONS[s.current] || WEAPONS.Platinum;
  const dx = Math.cos(s.aim), dy = Math.sin(s.aim), kick = s.anim.recoil;
  const two = ['smg', 'rifle', 'shotgun', 'sniper', 'launcher', 'tube', 'flamer', 'minigun', 'bat', 'axe', 'prod'].includes(def.look.type);
  const backDist = two ? 5 - kick : 11 - kick, frontDist = two ? 12 - kick : 12.5 - kick, bx = -s.facing * 0.6;
  const back = reach(sx, sy, sx + dx * backDist, sy + dy * backDist + (two ? 1.5 : 0), bx, 1), front = reach(sx, sy, sx + dx * frontDist, sy + dy * frontDist, bx, 1);
  lines.push([sx, sy, ...back[0]], [...back[0], ...back[1]], [sx, sy, ...front[0]], [...front[0], ...front[1]]);
  const gb = two ? 1 - kick : 9 - kick;
  return { lines, head, gun: { x: sx + dx * gb, y: sy + dy * gb, angle: s.aim, def }, shoulder: [sx, sy] };
}

test('hypot gives Math.hypot\'s number exactly (it only skips the garbage)', () => {
  let seed = 99;
  const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const scale = [1e-310, 1e-3, 1, 30, 1e6, 1e300];
  for (let i = 0; i < 200000; i++) {
    const x = (R() - 0.5) * scale[i % 6], y = (R() - 0.5) * scale[(i * 7) % 6];
    assert.ok(Object.is(hypot(x, y), Math.hypot(x, y)), `hypot(${x}, ${y})`);
  }
  for (const x of [0, -0, 1, -1, Infinity, -Infinity, NaN, 5e-324]) for (const y of [0, -0, 2, Infinity, NaN]) assert.ok(Object.is(hypot(x, y), Math.hypot(x, y)), `hypot(${x}, ${y})`);
});

test('a soldier\'s figure is the same as ever, in one object kept for that soldier', () => {
  setLegAnimations(LEGS_DATA);
  const ids = Object.keys(WEAPONS);
  let seed = 5;
  const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const a = { facing: 1, aim: 0, current: 'Platinum', body: {}, anim: {} }, b = { ...a, body: {}, anim: {} };
  const keep = buildPose(a);
  assert.notEqual(buildPose(b), keep, 'each soldier has its own');
  for (let i = 0; i < 3000; i++) {
    const s = i % 2 ? a : b;
    s.facing = R() < 0.5 ? -1 : 1;
    s.aim = (R() - 0.5) * 7;
    s.current = ids[i % ids.length];
    s.body = { onGround: R() < 0.7, jetting: R() < 0.2, vy: (R() - 0.5) * 12, crouching: R() < 0.2, vx: R() < 0.5 ? 0 : (R() - 0.5) * 4 };
    s.anim = { run: R(), idle: R() * 500, land: R() < 0.3 ? R() * 10 : 0, flip: R() < 0.2 ? R() : 0, recoil: R() < 0.3 ? R() * 3 : 0, swing: 0 };
    const got = buildPose(s), want = oldPose(s);
    assert.deepEqual(JSON.parse(JSON.stringify({ ...got, gun: { ...got.gun, def: got.gun.def.name } })),
      JSON.parse(JSON.stringify({ ...want, gun: { ...want.gun, def: want.gun.def.name } })), `pose ${i}`);
    if (s === a) assert.equal(got, keep, 'the same object, filled in again');
  }
});

test('the animation between updates is kept per soldier (not made new every frame), and the soldier is never a prototype', () => {
  const r = new Renderer(fakeCanvas(), {});
  r.alpha = 0.25;
  const s = { body: { x: 1 }, facing: -1, aim: 2, current: 'M4', anim: { run: 0.5, idle: 3, land: 2, flip: 0, recoil: 0, swing: 0.4 }, animPrev: { run: 0.4, idle: 2, land: 4, flip: 0, recoil: 1, swing: 0.2 } };
  const v = r.animated(s);
  assert.equal(r.animated(s), v, 'the same view each frame');
  assert.equal(Object.getPrototypeOf(v), Object.prototype, 'a plain object (a soldier made a prototype slows every soldier down)');
  assert.equal(v.body, s.body);
  assert.equal(v.facing, -1);
  assert.equal(v.aim, 2);
  assert.equal(v.current, 'M4');
  assert.equal(v.anim.land, 4 + (2 - 4) * 0.25, 'winding down: eased');
  assert.equal(v.anim.recoil, 1 + (0 - 1) * 0.25);
  assert.equal(v.anim.swing, 0.4, 'starting up: at once');
});

test('things drawn part way between updates can be worked out into a scratch object', () => {
  const p = { x: 10, y: 20, px: 4, py: 26 }, out = { x: 0, y: 0 };
  assert.equal(between(p, 0.5, out), out);
  assert.deepEqual(out, { x: 7, y: 23 });
  between({ x: 1, y: 2 }, 0.3, out);
  assert.deepEqual(out, { x: 1, y: 2 });
  between(p, 1, out);
  assert.deepEqual(out, { x: 10, y: 20 });
});

test('the standings are only sorted again when the order changes, and always match game.standings()', () => {
  const { game } = botMatch('ssdm1.json', { bots: 10 });
  let kept = 0, last = null;
  for (let i = 0; i < 3000; i++) {
    game.update();
    if (i % 3) continue;
    const got = standingsOf(game);
    assert.deepEqual(got.map(s => s.id), game.standings().map(s => s.id), `tick ${game.tick}`);
    if (got === last) kept++;
    last = got;
  }
  assert.ok(game.stats.kills > 0, 'a fight happened');
  assert.ok(kept > 100, `kept between frames (${kept} times)`);
  // Someone joining: sorted again, with them in it.
  game.addSoldier({ name: 'Late', isBot: false, team: 0 }, { input: () => ({}) });
  assert.equal(standingsOf(game).length, game.soldiers.length);
  assert.deepEqual(standingsOf(game).map(s => s.id), game.standings().map(s => s.id));
});

/** A 2D context that records what's drawn, and the line ends each stroke used. */
function recordingContext() {
  const ctx = { calls: [], strokes: [], fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', globalAlpha: 1, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic' };
  const keys = ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'globalAlpha', 'font', 'textAlign', 'textBaseline'];
  const stack = [];
  ctx.save = () => { ctx.calls.push('save'); stack.push(keys.map(k => ctx[k])); };
  ctx.restore = () => { ctx.calls.push('restore'); const v = stack.pop(); keys.forEach((k, i) => { ctx[k] = v[i]; }); };
  for (const m of ['beginPath', 'moveTo', 'lineTo', 'arc', 'ellipse', 'rect', 'closePath', 'fill', 'fillRect', 'strokeRect', 'setTransform', 'translate', 'rotate', 'scale', 'fillText', 'quadraticCurveTo', 'bezierCurveTo']) ctx[m] = () => ctx.calls.push(m);
  ctx.stroke = () => { ctx.calls.push('stroke'); ctx.strokes.push(ctx.lineCap); };
  ctx.measureText = t => ({ width: String(t).length * 4 });
  ctx.createRadialGradient = () => ({ addColorStop() {} });
  return ctx;
}

test('soldiers keep the canvas\'s state once for all of them, and leave it as they found it', () => {
  const { game } = botMatch('ssdm1.json', { bots: 8 });
  for (let i = 0; i < 400; i++) game.update();
  const ctx = recordingContext();
  const r = new Renderer(fakeCanvas(), ctx);
  r.s = 1.5; r.tx = 10; r.ty = 20; r.alpha = 0.5;
  const list = game.soldiers.filter(s => s.alive);
  assert.ok(list.length > 3);
  list[0].body.rope = { x: list[0].x + 30, y: list[0].y - 60 };
  ctx.lineCap = 'square';
  ctx.globalAlpha = 0.9;
  r.drawSoldiers(game, list, 0.5, list[0]);
  assert.equal(ctx.calls.filter(c => c === 'save').length, 1, 'one save for all of them');
  assert.equal(ctx.calls.filter(c => c === 'restore').length, 1);
  assert.equal(ctx.lineCap, 'square', 'line ends as they were');
  assert.equal(ctx.globalAlpha, 0.9);
  assert.equal(ctx.strokes[0], 'square', 'the rope: with the line ends the canvas had');
  assert.ok(ctx.strokes.slice(1).every(c => c === 'round' || c === 'square') && ctx.strokes.includes('round'), 'bodies: round');
  assert.equal(ctx.strokeStyle, '#8a6a3a', 'a rope\'s colours stay set after it, as they did');
  delete list[0].body.rope;
});

test('particles off screen aren\'t drawn, but leave the line ends and opacity drawing them would', () => {
  const ctx = recordingContext();
  const r = new Renderer(fakeCanvas(), ctx);
  r.s = 1; r.tx = 0; r.ty = 0; r.alpha = 1;
  r.updateView(1, 0, 0);
  const far = 5000, P = (kind, x, extra = {}) => ({ kind, x, y: 100, px: x, py: 100, life: 30, max: 40, size: 2, r: 3, len: 8, angle: 0, ...extra });
  const fx = { parts: [P('blood', far), P('gib', far), P('smoke', far), P('trail', 100, { x1: 140, y1: 110 }), P('blood', 120)], stains: [] };
  ctx.globalAlpha = 0.5;
  r.drawEffects({ fx });
  assert.equal(ctx.calls.filter(c => c === 'fillRect').length, 1, 'only the blood on screen');
  assert.deepEqual(ctx.strokes, ['round'], 'the trail goes by the round ends the limb (off screen) left');
  assert.equal(ctx.globalAlpha, 1, 'the smoke (off screen) left the opacity at 1');
});

test('the canvas is only resized when the size or pixel ratio changes, and a pixel ratio change is noticed', () => {
  const listeners = [];
  const old = globalThis.window;
  globalThis.window = {
    devicePixelRatio: 1, innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {},
    matchMedia: q => ({ q, addEventListener: (t, f) => listeners.push([q, f]), removeEventListener: (t, f) => { const i = listeners.findIndex(l => l[1] === f && l[0] === q); if (i >= 0) listeners.splice(i, 1); } }),
  };
  try {
    let sized = 0;
    const canvas = { style: {}, get width() { return this.w; }, set width(v) { this.w = v; sized++; }, height: 0 };
    const r = new Renderer(canvas, {});
    assert.equal(sized, 1);
    r.resize(); r.resize();
    assert.equal(sized, 1, 'nothing changed: the canvas is left alone (resizing clears it)');
    assert.equal(listeners.length, 1);
    assert.match(listeners[0][0], /resolution: 1dppx/);
    window.devicePixelRatio = 2;
    listeners[0][1]();
    assert.equal(sized, 2);
    assert.equal(canvas.width, 1600);
    assert.equal(listeners.length, 1, 'listening again, for a change from the new ratio');
    assert.match(listeners[0][0], /resolution: 2dppx/);
    r.destroy();
    assert.equal(listeners.length, 0);
  } finally {
    globalThis.window = old;
  }
});
