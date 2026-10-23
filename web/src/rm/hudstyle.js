// Remastered's heads-up display: the original's HUD code, drawn through a stand-in
// for the canvas that swaps its colours and font as they're set. Dark text for a
// white page becomes light text, white panels become dark glass, and the font a
// modern one, so the HUD reads over Remastered's scenery while staying the same
// HUD (every part of it, in both games).

import { rgb } from './color.js';

export const HUD_FONT = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// Colours the HUD uses, and what Remastered draws instead.
const SWAP = new Map(Object.entries({
  '#111': '#f2f5f9', '#1a1a1a': '#f2f5f9', '#222': '#f2f5f9', '#333': '#e3e8ef', '#444': '#d2d9e2',
  '#555': '#c2c9d3', '#666': '#b4bcc7', '#777': '#a6afbb', '#888': '#98a1ad', '#8a8a8a': '#98a1ad',
  '#999': '#8f99a6', '#9a9a9a': '#8f99a6', '#aaa': '#7f8995', '#b9b9b9': '#707a86', '#ddd': 'rgba(255,255,255,0.16)',
  '#c22': '#ff5a4a', '#c21b1b': '#ffe1dc', '#e02020': '#ff5a4a',
  '#2f6fdb': '#4a8bff', '#d33b2f': '#ff5a4a',
  'rgba(30,30,30,0.88)': 'rgba(61,127,240,0.88)',
}));

/** What Remastered draws in place of colour `c`. */
export function swapColor(c) {
  if (typeof c !== 'string') return c;
  const key = c.replace(/\s+/g, '').toLowerCase();
  const hit = SWAP.get(key);
  if (hit) return hit;
  if (key.startsWith('rgba(')) {
    const [r, g, b, a] = rgb(key);
    // Light panels become dark glass; faint dark lines and tracks become faint light ones.
    if (r > 240 && g > 240 && b > 240) return a >= 0.6 ? `rgba(12,16,24,${Math.min(0.8, a * 0.85).toFixed(2)})` : `rgba(12,16,24,${(a * 1.1).toFixed(2)})`;
    if (r < 20 && g < 20 && b < 20 && a <= 0.5) return `rgba(255,255,255,${Math.min(0.3, a * 1.2).toFixed(2)})`;
  }
  return c;
}

// The HUD sets the same few colours over and over: each is worked out once.
const swapped = new Map();
function swapCached(c) {
  if (typeof c !== 'string') return c;
  let out = swapped.get(c);
  if (out === undefined) {
    out = swapColor(c);
    if (swapped.size > 500) swapped.clear();
    swapped.set(c, out);
  }
  return out;
}

const fonts = new Map();
function swapFont(f) {
  let out = fonts.get(f);
  if (!out) {
    out = String(f).replace(/Arial, Helvetica, sans-serif|Arial, sans-serif/g, HUD_FONT);
    if (fonts.size > 200) fonts.clear();
    fonts.set(f, out);
  }
  return out;
}

/** Whether colour c (as the canvas gives it back) is light, so its text gets a dark edge. */
const lights = new Map();
function isLight(c) {
  if (typeof c !== 'string') return false;
  let v = lights.get(c);
  if (v === undefined) {
    const [r, g, b] = rgb(c);
    v = 0.3 * r + 0.59 * g + 0.11 * b > 150;
    if (lights.size > 200) lights.clear();
    lights.set(c, v);
  }
  return v;
}

/**
 * The stand-in's class for contexts like `ctx`: every method and property goes straight
 * through to the real context (this.ctx), except the colours and font, swapped as they're
 * set, and fillText, which gives light text its shadow. Made once per kind of context.
 */
const classes = new WeakMap();
function classFor(ctx) {
  const proto = Object.getPrototypeOf(ctx);
  // (A real canvas context: one class for all of them. Anything else: its own.)
  const key = proto && proto !== Object.prototype ? proto : ctx;
  let C = classes.get(key);
  if (C) return C;
  C = class StyledContext {
    constructor(real, dpr) { this.ctx = real; this.dpr = dpr; }
  };
  const names = new Set();
  for (let o = ctx; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) for (const k of Object.getOwnPropertyNames(o)) names.add(k);
  for (const k of names) {
    if (k === 'constructor' || k === 'ctx' || k === 'dpr') continue;
    let d = null;
    for (let o = ctx; o && !d; o = Object.getPrototypeOf(o)) d = Object.getOwnPropertyDescriptor(o, k);
    if (typeof d.value === 'function') {
      // (apply with `arguments`: the same arguments, as many as were given, and nothing made for it.)
      Object.defineProperty(C.prototype, k, { value: function () { const c = this.ctx; return c[k].apply(c, arguments); }, writable: true, configurable: true });
    } else {
      Object.defineProperty(C.prototype, k, { get() { return this.ctx[k]; }, set(v) { this.ctx[k] = v; }, configurable: true });
    }
  }
  const style = k => ({ get() { return this.ctx[k]; }, set(v) { this.ctx[k] = swapCached(v); }, configurable: true });
  Object.defineProperty(C.prototype, 'fillStyle', style('fillStyle'));
  Object.defineProperty(C.prototype, 'strokeStyle', style('strokeStyle'));
  Object.defineProperty(C.prototype, 'font', { get() { return this.ctx.font; }, set(v) { this.ctx.font = swapFont(v); }, configurable: true });
  Object.defineProperty(C.prototype, 'fillText', {
    value(text, x, y, maxWidth) {
      const ctx = this.ctx, shadow = isLight(ctx.fillStyle);
      if (shadow) {
        const d = this.dpr();
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowOffsetY = Math.max(1, Math.round(d));
        ctx.shadowBlur = 2 * d;
      }
      if (maxWidth === undefined) ctx.fillText(text, x, y);
      else ctx.fillText(text, x, y, maxWidth);
      if (shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0)';
        ctx.shadowOffsetY = 0;
        ctx.shadowBlur = 0;
      }
    },
    writable: true, configurable: true,
  });
  classes.set(key, C);
  return C;
}

/**
 * A stand-in for ctx that swaps colours and fonts as they're set, and gives light
 * text a dark drop shadow so it reads over bright scenery (everything else goes
 * straight through). dpr(): the screen's pixel ratio (the shadow is in screen pixels).
 */
export function styledContext(ctx, dpr = () => 1) {
  return new (classFor(ctx))(ctx, dpr);
}
