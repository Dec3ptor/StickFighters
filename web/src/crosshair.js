// The crosshair at the mouse, drawn the way the player set it up in Settings: its
// shape, colour, size, thickness, gap and opacity, and an edge in the opposite shade
// (light round a dark crosshair, dark round a light one) so it shows on any background.
// The "Default" colour is each game's own: near-black in the original, white in Remastered.
//
// Usually it's the system's own mouse pointer, drawn as the crosshair (crosshairCursor):
// the operating system moves that itself, straight away, as smoothly as the mouse moves
// anywhere else. Locked to the game (Settings), the browser hides the pointer, and the
// game draws the crosshair with everything else (drawCrosshair), a frame or so behind.

export const CROSSHAIR_STYLES = [
  ['crossDot', 'Cross and dot'], ['cross', 'Cross'], ['dot', 'Dot'], ['circle', 'Circle'],
  ['circleDot', 'Circle and dot'], ['t', 'T'], ['x', 'X'],
];
export const CROSSHAIR_COLORS = [
  ['default', 'Default'], ['#3dff5a', 'Green'], ['#2ee6ff', 'Cyan'], ['#ffe02e', 'Yellow'], ['#ff3df2', 'Pink'],
  ['#ff3b30', 'Red'], ['#ffffff', 'White'], ['#111111', 'Black'], ['custom', 'Custom…'],
];
// size: arm length (px); thickness: line width (px); gap: from the middle to the arms (px); opacity: percent.
export const CROSSHAIR_DEFAULTS = Object.freeze({
  style: 'crossDot', color: 'default', custom: '#3dff5a', size: 6, thickness: 1.5, gap: 4, opacity: 100, outline: true,
});
export const CROSSHAIR_LIMITS = { size: [2, 20], thickness: [1, 5], gap: [0, 12], opacity: [20, 100] };

const xh = { ...CROSSHAIR_DEFAULTS };
const HEX = /^#[0-9a-f]{6}$/i;
let version = 0; // (goes up with every change of settings: pointer pictures are made again)

/** Use these crosshair settings (anything missing or out of range is left at its default). */
export function setCrosshair(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  xh.style = CROSSHAIR_STYLES.some(([k]) => k === o.style) ? o.style : CROSSHAIR_DEFAULTS.style;
  xh.color = CROSSHAIR_COLORS.some(([k]) => k === o.color) ? o.color : CROSSHAIR_DEFAULTS.color;
  xh.custom = HEX.test(o.custom) ? o.custom.toLowerCase() : CROSSHAIR_DEFAULTS.custom;
  for (const k of Object.keys(CROSSHAIR_LIMITS)) {
    const [lo, hi] = CROSSHAIR_LIMITS[k], n = Number(o[k]);
    xh[k] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : CROSSHAIR_DEFAULTS[k];
  }
  xh.outline = typeof o.outline === 'boolean' ? o.outline : CROSSHAIR_DEFAULTS.outline;
  version++;
  return { ...xh };
}

/** The colour the crosshair is drawn in. `edition`: 'classic' or 'remastered'; `red`: aiming down a sniper scope. */
export function crosshairColor(edition, red = false) {
  if (red) return edition === 'remastered' ? '#ff4a3a' : '#ee2222';
  if (xh.color === 'default') return edition === 'remastered' ? '#ffffff' : '#111111';
  return xh.color === 'custom' ? xh.custom : xh.color;
}

/** The edge round a colour: dark round light colours, light round dark ones. */
export function edgeColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.5 ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)';
}

/** How far out the crosshair reaches from the middle (px), for the reload ring round it. */
function reach() {
  if (xh.style === 'dot') return xh.thickness + 2;
  if (xh.style === 'circle' || xh.style === 'circleDot') return ringRadius() + xh.thickness / 2;
  return xh.gap + xh.size;
}
const ringRadius = () => Math.max(2, xh.gap + xh.size / 2);
const D = Math.SQRT1_2;
const ARMS = { cross: [1, 0, -1, 0, 0, 1, 0, -1], t: [1, 0, -1, 0, 0, 1], x: [D, D, -D, D, D, -D, -D, -D] };

/** The lines of the crosshair (not its dot) as a path; `e`: how much longer each arm is (for the edge). */
function linesPath(ctx, x, y, e) {
  ctx.beginPath();
  if (xh.style === 'circle' || xh.style === 'circleDot') {
    const r = ringRadius();
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
    return true;
  }
  const arms = ARMS[xh.style === 'crossDot' ? 'cross' : xh.style];
  if (!arms) return false;
  const a = Math.max(0, xh.gap - e), b = xh.gap + xh.size + e;
  for (let i = 0; i < arms.length; i += 2) {
    const dx = arms[i], dy = arms[i + 1];
    ctx.moveTo(x + dx * a, y + dy * a);
    ctx.lineTo(x + dx * b, y + dy * b);
  }
  return true;
}

const hasDot = () => xh.style === 'crossDot' || xh.style === 'circleDot' || xh.style === 'dot';

function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Draw the crosshair at (x, y) in the canvas's current units (screen pixels).
 * `reload`: how far through a reload (0-1), drawn as a ring filling up round it.
 */
export function drawCrosshair(ctx, x, y, { edition = 'classic', red = false, reload = null, ringOnly = false } = {}) {
  const color = crosshairColor(edition, red), edge = edgeColor(color);
  const t = xh.thickness, dotR = xh.style === 'dot' ? Math.max(1.5, t) : Math.max(1, t * 0.8);
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * xh.opacity / 100;
  ctx.lineCap = 'butt';
  if (reload != null) {
    const r = Math.max(15, reach() + 5);
    ctx.lineWidth = 3;
    ctx.strokeStyle = edition === 'remastered' ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = edition === 'remastered' ? 2 : 3;
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, reload))); ctx.stroke();
  }
  // (The system pointer is the crosshair: just the ring round it.)
  if (ringOnly) { ctx.globalAlpha = alpha; return; }
  if (xh.outline) {
    ctx.strokeStyle = ctx.fillStyle = edge;
    ctx.lineWidth = t + 2;
    if (linesPath(ctx, x, y, 1)) ctx.stroke();
    if (hasDot()) dot(ctx, x, y, dotR + 1);
  }
  ctx.strokeStyle = ctx.fillStyle = color;
  ctx.lineWidth = t;
  if (linesPath(ctx, x, y, 0)) ctx.stroke();
  if (hasDot()) dot(ctx, x, y, dotR);
  ctx.globalAlpha = alpha;
}

// The pointer's pictures, made once for each look (settings, game, red down a scope, screen sharpness).
const cursors = new Map();
let cursorForm = null; // how this browser takes a sharp picture: 'image-set', '-webkit-image-set' or 'plain'
// (The last one asked for, every frame: given back as it was, with nothing worked out or made.)
const last = { version: -1, edition: '', red: false, dpr: 0, css: '' };

/**
 * The CSS cursor that makes the system's mouse pointer the crosshair, as set up: a picture of
 * it, its middle on the pointer's hot spot, sharp on screens with more pixels (dpr). Falls
 * back to the browser's own crosshair pointer. `edition`: 'classic' or 'remastered'; `red`:
 * down a sniper scope.
 */
export function crosshairCursor(edition = 'classic', red = false, dpr = 1) {
  if (last.version === version && last.edition === edition && last.red === red && last.dpr === dpr) return last.css;
  const css = pointerFor(edition, red, dpr);
  Object.assign(last, { version, edition, red, dpr, css });
  return css;
}

function pointerFor(edition, red, dpr) {
  // (As big as it reaches, its edge included; browsers ignore pointers over 128 pixels.)
  const R = Math.ceil(reach() + xh.thickness + 3), size = R * 2 + 1;
  const scale = Math.max(1, Math.min(Math.round(dpr * 2) / 2, Math.floor((128 / size) * 2) / 2));
  const key = `${version}|${edition}|${red ? 1 : 0}|${scale}`;
  let css = cursors.get(key);
  if (css) return css;
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.ceil(size * scale);
  const ctx = cv.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  // (Its middle on the middle of a pixel, the hot spot's.)
  drawCrosshair(ctx, R + 0.5, R + 0.5, { edition, red });
  const url = `url(${cv.toDataURL('image/png')})`;
  cursorForm ??= sharpForm();
  css = scale === 1 || cursorForm === 'plain' ? null : `${cursorForm}(${url} ${scale}x) ${R} ${R}, crosshair`;
  // (No sharp form here: the picture at its size in pixels.)
  if (!css) {
    if (scale !== 1) return pointerFor(edition, red, 1);
    css = `${url} ${R} ${R}, crosshair`;
  }
  if (cursors.size > 24) cursors.clear();
  cursors.set(key, css);
  return css;
}

/** Which way of giving a pointer a sharper picture this browser takes (it ignores the ones it doesn't). */
function sharpForm() {
  const el = document.createElement('div'), tiny = 'url(data:image/png;base64,iVBORw0KGgo=)';
  for (const form of ['image-set', '-webkit-image-set']) {
    el.style.cursor = '';
    el.style.cursor = `${form}(${tiny} 2x) 0 0, auto`;
    if (el.style.cursor) return form;
  }
  return 'plain';
}
