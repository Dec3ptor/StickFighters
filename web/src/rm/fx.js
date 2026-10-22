// Remastered's light and atmosphere: glowing lights from muzzle flashes,
// explosions, fire, rockets and jetpacks (added onto the picture), darkness that
// they cut through on night maps, weather (rain, snow, dust, embers, ash, motes)
// at different depths, and the soft sprites for fireballs and smoke.

import { css, rgb } from './color.js';

const canvas = (w, h = w) => Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.ceil(w)), height: Math.max(1, Math.ceil(h)) });

// ---- Sprites ---------------------------------------------------------------------------------

const sprites = new Map();

/** A soft round glow of `color`, fading out to its edge (128 px; draw it at any size). */
export function glowSprite(color) {
  let cv = sprites.get(color);
  if (cv) return cv;
  cv = canvas(128);
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  const c = rgb(color);
  g.addColorStop(0, css(c, 1));
  g.addColorStop(0.22, css(c, 0.55));
  g.addColorStop(0.55, css(c, 0.16));
  g.addColorStop(1, css(c, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  sprites.set(color, cv);
  return cv;
}

/** A fireball: white-hot in the middle, through yellow and orange to dark red smoke at the edge. */
export function fireballSprite() {
  let cv = sprites.get('fireball');
  if (cv) return cv;
  cv = canvas(128);
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,235,1)');
  g.addColorStop(0.18, 'rgba(255,236,150,1)');
  g.addColorStop(0.4, 'rgba(255,160,50,0.95)');
  g.addColorStop(0.68, 'rgba(200,70,20,0.6)');
  g.addColorStop(1, 'rgba(60,30,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  sprites.set('fireball', cv);
  return cv;
}

/** A puff of smoke (grey, soft-edged, a little lumpy). */
export function smokeSprite() {
  let cv = sprites.get('smoke');
  if (cv) return cv;
  cv = canvas(128);
  const ctx = cv.getContext('2d');
  for (const [x, y, r, a] of [[64, 64, 60, 0.55], [48, 56, 34, 0.35], [80, 58, 30, 0.3], [62, 78, 30, 0.3]]) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(120,118,116,${a})`);
    g.addColorStop(1, 'rgba(120,118,116,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  sprites.set('smoke', cv);
  return cv;
}

/** A puff of a smoke grenade's cloud: light grey, thick in the middle, soft at the edge. */
export function cloudSprite() {
  let cv = sprites.get('cloud');
  if (cv) return cv;
  cv = canvas(128);
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(222,224,228,0.95)');
  g.addColorStop(0.55, 'rgba(204,207,212,0.8)');
  g.addColorStop(0.85, 'rgba(190,193,198,0.3)');
  g.addColorStop(1, 'rgba(190,193,198,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  sprites.set('cloud', cv);
  return cv;
}

// ---- Lights ----------------------------------------------------------------------------------

export const LIGHT = {
  muzzle: '#ffd795', fire: '#ff8a30', boom: '#ffa850', rocket: '#ffb466', jet: '#ffb648',
  pad: '#8dff7a', magic: '#b48cff', laser: '#ff4040', spark: '#ffe2a0', teleport: '#9fd6ff',
  jugger: '#ff9a2a', kill: '#ffd8c8',
};
const MAX_LIGHTS = 72;

export class Lights {
  constructor() { this.list = []; }

  clear() { this.list.length = 0; }

  /** A light at (x, y) (world), reaching r, of `color`, at strength a (0..1). */
  add(x, y, r, color, a) {
    if (this.list.length < MAX_LIGHTS * 2 && a > 0.02) this.list.push({ x, y, r, color, a });
  }

  /** Add the lights onto the picture (world transform set). */
  draw(ctx, view) {
    const L = this.list;
    if (L.length > MAX_LIGHTS) L.sort((p, q) => q.a * q.r - p.a * p.r).length = MAX_LIGHTS;
    ctx.globalCompositeOperation = 'lighter';
    for (const l of L) {
      if (l.x + l.r < view.l || l.x - l.r > view.r || l.y + l.r < view.t || l.y - l.r > view.b) continue;
      ctx.globalAlpha = Math.min(1, l.a);
      ctx.drawImage(glowSprite(l.color), l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Night maps: darken the picture, except where lights shine. Drawn at a quarter of
   * the screen's resolution (it's all soft) and stretched over it.
   */
  drawDarkness(r, amount, tint = '#02040a') {
    if (!(amount > 0)) return;
    const w = Math.ceil(r.pw / 4), h = Math.ceil(r.ph / 4);
    if (!this.dark || this.dark.width !== w || this.dark.height !== h) this.dark = canvas(w, h);
    const d = this.dark.getContext('2d');
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = 'copy';
    d.fillStyle = css(tint, amount);
    d.fillRect(0, 0, w, h);
    d.globalCompositeOperation = 'destination-out';
    const k = r.s / 4;
    d.setTransform(k, 0, 0, k, r.tx / 4, r.ty / 4);
    const white = glowSprite('#ffffff');
    for (const l of this.list) {
      d.globalAlpha = Math.min(1, l.a * 1.4);
      const R = l.r * 1.6;
      d.drawImage(white, l.x - R, l.y - R, R * 2, R * 2);
    }
    d.globalAlpha = 1;
    d.globalCompositeOperation = 'source-over';
    const ctx = r.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.dark, 0, 0, r.pw, r.ph);
    ctx.setTransform(r.s, 0, 0, r.s, r.tx, r.ty);
  }
}

// ---- Weather ---------------------------------------------------------------------------------

const WEATHER = {
  rain: { n: 220, color: 'rgba(170,200,255,0.42)', fall: [14, 20], drift: -2.5, size: [10, 18], kind: 'streak' },
  snow: { n: 170, color: 'rgba(255,255,255,0.9)', fall: [0.6, 1.6], drift: 0.4, size: [1.2, 3.4], kind: 'flake', sway: 1 },
  dust: { n: 90, color: 'rgba(255,236,190,0.55)', fall: [-0.1, 0.25], drift: 0.9, size: [0.8, 2], kind: 'flake', sway: 0.6 },
  embers: { n: 110, color: '#ffa040', fall: [-1.6, -0.6], drift: 0.3, size: [1, 2.4], kind: 'glow', sway: 1.2 },
  ash: { n: 130, color: 'rgba(70,64,60,0.7)', fall: [0.4, 1.1], drift: 0.6, size: [1, 2.6], kind: 'flake', sway: 1 },
  motes: { n: 70, color: 'rgba(255,250,210,0.65)', fall: [-0.25, 0.15], drift: 0.15, size: [0.8, 1.8], kind: 'glow', sway: 0.8 },
};

export class Weather {
  constructor(kind, quality = 'high') {
    this.def = WEATHER[kind] || null;
    this.parts = [];
    if (!this.def) return;
    const n = Math.round(this.def.n * (quality === 'low' ? 0.35 : quality === 'medium' ? 0.65 : 1));
    for (let i = 0; i < n; i++) this.parts.push(this.spawn(Math.random()));
    this.cam = null;
  }

  spawn(y) {
    const d = this.def;
    const z = 0.35 + Math.random() * 1.25; // depth: small and slow far away, big and quick up close
    return { x: Math.random(), y, z, v: d.fall[0] + Math.random() * (d.fall[1] - d.fall[0]), s: d.size[0] + Math.random() * (d.size[1] - d.size[0]), ph: Math.random() * 6.3 };
  }

  /** Move and draw the weather over the screen (screen pixels), following the camera at each particle's depth. */
  draw(ctx, r, dt) {
    const d = this.def;
    if (!d) return;
    const W = r.pw, H = r.ph, S = r.scale * r.dpr, f = dt / 16.7;
    const cam = r.cam;
    const dx = this.cam ? (cam.x - this.cam.x) * S : 0, dy = this.cam ? (cam.y - this.cam.y) * S : 0;
    this.cam = { x: cam.x, y: cam.y };
    const t = performance.now() / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (d.kind === 'glow') ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = d.color;
    ctx.strokeStyle = d.color;
    ctx.lineWidth = Math.max(1, r.dpr * 0.9);
    if (d.kind === 'streak') ctx.beginPath();
    for (const p of this.parts) {
      const k = p.z * S * 0.5;
      p.x = (p.x * W - dx * p.z + (d.drift * k + (d.sway ? Math.sin(t * d.sway + p.ph) * 0.4 * k : 0)) * f) / W;
      p.y = (p.y * H - dy * p.z + p.v * k * f) / H;
      if (p.y > 1.05) Object.assign(p, this.spawn(-0.05));
      else if (p.y < -0.05) Object.assign(p, this.spawn(1.05));
      p.x = ((p.x % 1) + 1) % 1;
      const x = p.x * W, y = p.y * H, s = p.s * p.z * r.dpr;
      if (d.kind === 'streak') {
        ctx.moveTo(x, y);
        ctx.lineTo(x + d.drift * s * 0.4, y + s * 3);
      } else {
        ctx.globalAlpha = Math.min(1, 0.35 + p.z * 0.45);
        ctx.fillRect(x, y, s, s);
      }
    }
    if (d.kind === 'streak') ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ---- Vignette ----------------------------------------------------------------------------------

const vigs = new Map();

/** Darken the edges of a w x h picture (ctx at no transform) a little. */
export function drawVignette(ctx, w, h, amount) {
  if (!(amount > 0)) return;
  const key = `${Math.round(w / 8)}x${Math.round(h / 8)}@${amount}`;
  let cv = vigs.get(key);
  if (!cv) {
    const vw = Math.max(8, Math.ceil(w / 4)), vh = Math.max(8, Math.ceil(h / 4));
    cv = canvas(vw, vh);
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.35, vw / 2, vh / 2, Math.hypot(vw, vh) * 0.6);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${amount})`);
    c.fillStyle = g;
    c.fillRect(0, 0, vw, vh);
    if (vigs.size > 8) vigs.clear();
    vigs.set(key, cv);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(cv, 0, 0, w, h);
}
