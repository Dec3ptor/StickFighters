// Remastered's light and atmosphere: glowing lights from muzzle flashes,
// explosions, fire, rockets and jetpacks (added onto the picture), darkness that
// they cut through on night maps, weather (rain, snow, dust, embers, ash, motes)
// at different depths, and the soft sprites for fireballs and smoke.

import { css, rgb } from './color.js';
import { hasGPU } from '../gpu.js';

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

// ---- Drawn by the processor? ----------------------------------------------------------------------

let cpu = null;

/**
 * Whether the canvas is drawn by the processor (no graphics card). There, stretching a small
 * picture over the screen takes several times as long as copying a screen-sized one on as it
 * is, or filling the screen with a colour; so some pictures are kept at full size too, and the
 * plain parts of the darkness are filled. On a graphics card each of those is one quick step,
 * and full-size copies would only take memory, so things are drawn as they always were.
 */
export function drawnByCPU() {
  cpu ??= !hasGPU();
  return cpu;
}

// ---- Lights ----------------------------------------------------------------------------------

export const LIGHT = {
  muzzle: '#ffd795', fire: '#ff8a30', boom: '#ffa850', rocket: '#ffb466', jet: '#ffb648',
  pad: '#8dff7a', magic: '#b48cff', laser: '#ff4040', spark: '#ffe2a0', teleport: '#9fd6ff',
  jugger: '#ff9a2a', kill: '#ffd8c8',
};
const MAX_LIGHTS = 72;

export class Lights {
  constructor() {
    this.list = [];
    this.pool = []; // (the light objects, reused frame after frame)
    this.dark = null;
    this.darkWas = [];
  }

  clear() { this.list.length = 0; }

  /** A light at (x, y) (world), reaching r, of `color`, at strength a (0..1). */
  add(x, y, r, color, a) {
    const L = this.list;
    if (L.length < MAX_LIGHTS * 2 && a > 0.02) {
      let l = this.pool[L.length];
      if (!l) this.pool[L.length] = l = { x: 0, y: 0, r: 0, color: '', a: 0 };
      l.x = x; l.y = y; l.r = r; l.color = color; l.a = a;
      L.push(l);
    }
  }

  /** Add the lights onto the picture (world transform set). */
  draw(ctx, view) {
    const L = this.list;
    if (L.length) {
      if (L.length > MAX_LIGHTS) L.sort((p, q) => q.a * q.r - p.a * p.r).length = MAX_LIGHTS;
      ctx.globalCompositeOperation = 'lighter';
      for (const l of L) {
        if (l.x + l.r < view.l || l.x - l.r > view.r || l.y + l.r < view.t || l.y - l.r > view.b) continue;
        ctx.globalAlpha = Math.min(1, l.a);
        ctx.drawImage(glowSprite(l.color), l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Night maps: darken the picture, except where lights shine. Worked out at a quarter of
   * the screen's resolution (it's all soft), again only when the lights or the view have
   * changed, and stretched over the screen. (Drawn by the processor, it's stretched only
   * round the lights: elsewhere it's the same plain darkness all over, which a fill draws
   * much more quickly, with the same pixels.)
   */
  drawDarkness(r, amount, tint = '#02040a') {
    if (!(amount > 0)) return;
    const w = Math.ceil(r.pw / 4), h = Math.ceil(r.ph / 4);
    if (!this.dark || this.dark.width !== w || this.dark.height !== h) {
      this.dark = canvas(w, h);
      this.darkWas.length = 0;
      // (A canvas given back after being lost comes back blank.)
      this.dark.addEventListener?.('contextrestored', () => { this.darkWas.length = 0; });
    }
    const k = r.s / 4, ox = r.tx / 4, oy = r.ty / 4, L = this.list;
    if (this.darkFor !== tint || this.darkAmount !== amount) { this.darkFor = tint; this.darkAmount = amount; this.darkFill = css(tint, amount); this.darkWas.length = 0; }
    if (this.darkChanged(k, ox, oy) || this.dark.getContext('2d').isContextLost?.()) {
      const d = this.dark.getContext('2d');
      d.setTransform(1, 0, 0, 1, 0, 0);
      d.globalCompositeOperation = 'copy';
      d.fillStyle = this.darkFill;
      d.fillRect(0, 0, w, h);
      d.globalCompositeOperation = 'destination-out';
      d.setTransform(k, 0, 0, k, ox, oy);
      const white = glowSprite('#ffffff');
      for (const l of L) {
        d.globalAlpha = Math.min(1, l.a * 1.4);
        const R = l.r * 1.6;
        d.drawImage(white, l.x - R, l.y - R, R * 2, R * 2);
      }
      d.globalAlpha = 1;
      d.globalCompositeOperation = 'source-over';
    }
    const ctx = r.ctx, W = r.pw, H = r.ph;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const lit = drawnByCPU() ? this.litBoxes(k, ox, oy, W / w, H / h, W, H) : null;
    if (!lit) ctx.drawImage(this.dark, 0, 0, W, H);
    else {
      // Round the lights: the darkness stretched over the screen, kept to their boxes.
      for (const b of lit) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
        ctx.clip();
        ctx.drawImage(this.dark, 0, 0, W, H);
        ctx.restore();
      }
      // Everywhere else: plain darkness, in bands across the screen between the boxes.
      const fill = ctx.fillStyle;
      ctx.fillStyle = this.darkFill;
      fillAround(ctx, lit, W, H);
      ctx.fillStyle = fill;
    }
    ctx.setTransform(r.s, 0, 0, r.s, r.tx, r.ty);
  }

  /** Whether the darkness picture needs drawing again: the view or the lights have changed. */
  darkChanged(k, ox, oy) {
    const was = this.darkWas, L = this.list;
    let same = was.length === 3 + L.length * 4 && was[0] === k && was[1] === ox && was[2] === oy;
    for (let i = 0; same && i < L.length; i++) {
      const l = L[i], j = 3 + i * 4;
      same = was[j] === l.x && was[j + 1] === l.y && was[j + 2] === l.r && was[j + 3] === l.a;
    }
    if (same) return false;
    was.length = 0;
    was.push(k, ox, oy);
    for (const l of L) was.push(l.x, l.y, l.r, l.a);
    return true;
  }

  /**
   * The parts of the screen where the lights change the darkness: their boxes, in screen pixels
   * (with room for the soft edges and the stretching's blur), merged where they overlap. Null
   * when they'd cover most of the screen anyway (then it's all simply stretched over it).
   */
  litBoxes(k, ox, oy, sx, sy, W, H) {
    const boxes = this.boxes ||= [];
    let n = 0;
    for (const l of this.list) {
      const R = l.r * 1.6;
      // (In the darkness's pixels, 3 more each way: 1 for the edge, 2 for the stretching.)
      const x0 = Math.max(0, Math.floor((Math.floor((l.x - R) * k + ox) - 3) * sx)), x1 = Math.min(W, Math.ceil((Math.ceil((l.x + R) * k + ox) + 3) * sx));
      const y0 = Math.max(0, Math.floor((Math.floor((l.y - R) * k + oy) - 3) * sy)), y1 = Math.min(H, Math.ceil((Math.ceil((l.y + R) * k + oy) + 3) * sy));
      if (!(x1 > x0 && y1 > y0)) continue;
      const b = boxes[n] ||= [0, 0, 0, 0];
      b[0] = x0; b[1] = y0; b[2] = x1; b[3] = y1;
      n++;
    }
    // Merge boxes that overlap, until none do.
    for (let merged = true; merged;) {
      merged = false;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = boxes[i], b = boxes[j];
        if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) {
          a[0] = Math.min(a[0], b[0]); a[1] = Math.min(a[1], b[1]); a[2] = Math.max(a[2], b[2]); a[3] = Math.max(a[3], b[3]);
          const last = boxes[--n];
          boxes[n] = b; boxes[j] = last;
          merged = true;
          j--;
        }
      }
    }
    let area = 0;
    for (let i = 0; i < n; i++) area += (boxes[i][2] - boxes[i][0]) * (boxes[i][3] - boxes[i][1]);
    if (area > W * H * 0.6) return null;
    const out = this.litOut ||= [];
    out.length = 0;
    for (let i = 0; i < n; i++) out.push(boxes[i]);
    return out;
  }
}

/** Fill the whole screen (W x H) except the boxes (whole pixels, not overlapping), in bands. */
export function fillAround(ctx, boxes, W, H) {
  const ys = fillAround.ys ||= [];
  ys.length = 0;
  ys.push(0, H);
  for (const b of boxes) ys.push(b[1], b[3]);
  ys.sort((a, b) => a - b);
  const xs = fillAround.xs ||= [];
  for (let i = 0; i + 1 < ys.length; i++) {
    const y0 = ys[i], y1 = ys[i + 1];
    if (y1 <= y0) continue;
    // The boxes across this band, left to right.
    xs.length = 0;
    for (const b of boxes) if (b[1] < y1 && b[3] > y0) xs.push(b);
    xs.sort((a, b) => a[0] - b[0]);
    let x = 0;
    for (const b of xs) {
      if (b[0] > x) ctx.fillRect(x, y0, b[0] - x, y1 - y0);
      if (b[2] > x) x = b[2];
    }
    if (x < W) ctx.fillRect(x, y0, W - x, y1 - y0);
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
    this.camX = this.camY = null;
  }

  spawn(y) {
    return this.respawn({ x: 0, y: 0, z: 0, v: 0, s: 0, ph: 0 }, y);
  }

  /** Particle p starts again at height y (0..1 down the screen), somewhere along it. */
  respawn(p, y) {
    const d = this.def;
    const z = 0.35 + Math.random() * 1.25; // depth: small and slow far away, big and quick up close
    p.x = Math.random();
    p.y = y;
    p.z = z;
    p.v = d.fall[0] + Math.random() * (d.fall[1] - d.fall[0]);
    p.s = d.size[0] + Math.random() * (d.size[1] - d.size[0]);
    p.ph = Math.random() * 6.3;
    return p;
  }

  /** Move and draw the weather over the screen (screen pixels), following the camera at each particle's depth. */
  draw(ctx, r, dt) {
    const d = this.def;
    if (!d) return;
    const W = r.pw, H = r.ph, S = r.scale * r.dpr, f = dt / 16.7;
    const cam = r.cam;
    const dx = this.camX != null ? (cam.x - this.camX) * S : 0, dy = this.camX != null ? (cam.y - this.camY) * S : 0;
    this.camX = cam.x;
    this.camY = cam.y;
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
      if (p.y > 1.05) this.respawn(p, -0.05);
      else if (p.y < -0.05) this.respawn(p, 1.05);
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
const fullVigs = new Map();

/** Let go of the full-size vignettes (Remastered has stopped drawing). */
export function dropVignetteCopies() { fullVigs.clear(); }

/**
 * Darken the edges of a w x h picture (ctx at no transform) a little. Worked out at a quarter
 * of the size and stretched over the picture; drawn by the processor, it's stretched to full
 * size once (the same pixels as stretching it every time) and then copied on as it is.
 */
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
  if (!drawnByCPU()) {
    ctx.drawImage(cv, 0, 0, w, h);
    return;
  }
  let full = fullVigs.get(cv);
  if (!full || full.width !== w || full.height !== h || full.getContext('2d').isContextLost?.()) {
    full = canvas(w, h);
    full.getContext('2d').drawImage(cv, 0, 0, w, h);
    full.addEventListener?.('contextrestored', () => fullVigs.delete(cv));
    // (Two at most: the screen's, and the scenery's at lower quality.)
    if (fullVigs.size > 1) fullVigs.clear();
    fullVigs.set(cv, full);
  }
  ctx.drawImage(full, 0, 0);
}
