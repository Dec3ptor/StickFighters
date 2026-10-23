// The canvas renderer's map, drawn once and reused: kept as tiles (pictures of
// 512x512 screen pixels) that are drawn when they first come on screen, again
// only where blocks change (holes, building), and copied onto the screen each
// frame instead of drawing every block, outline and hatch line again.
//
// Only with ?tiles=on in the address: with the canvas drawn by a graphics card,
// copying the tiles every frame turned out slower than drawing the map (about 20%
// fewer frames), so by default the map is drawn directly (paintMap()).
//
// The world is drawn at whole screen pixels (render.js rounds the camera), so a
// tile copied into place gives the pixels drawing the map there would.
//
// Without fog of war, tiles are opaque (the white background included): they
// cover the whole screen, so there's nothing to clear first, and copying an opaque
// picture needs no blending. With fog, the shadows go under the map, so tiles are
// see-through and go on top of them.

import { fillSeams, hatch, courses } from './map.js';

const INK = '#111';
const TILE = 512;              // tile size, in screen pixels
const NEW_PER_FRAME = 8;       // most tiles drawn in one frame (the rest wait for the next)
const SETTLE_FRAMES = 3;       // the zoom must hold still this many frames before tiles are made for it
export const HATCH = '#dcdcdc', HATCH_GAP = 10;
export const BUILT = '#efe5cf', BUILT_LINE = '#c4ae86', BUILT_ROW = 6;

/**
 * Draw the map's blocks that touch `rect` (world { l, t, r, b }; all of them if
 * null) on ctx, in world coordinates: outlines `e` wide, the fills, no hairlines
 * where blocks meet, built blocks as sandbags, hatching on blocks that can't be
 * destroyed (destructible maps), and jump pads' fill. Returns the box around
 * everything it drew (world), or null if there was nothing there.
 */
export function paintMap(ctx, map, e, rect, destruction) {
  let list = map.solids;
  if (rect) {
    list = Q.list;
    list.length = 0;
    Q.rect = rect; Q.e = e;
    map.query(rect.l - e - 1, rect.t - e - 1, rect.r + e + 1, rect.b + e + 1, near);
    Q.rect = null;
    if (!list.length) return null;
  }
  // (Indexed loops: drawn every frame, these must make no garbage.)
  const n = list.length;
  ctx.fillStyle = INK;
  for (let i = 0; i < n; i++) { const p = list[i]; ctx.fillRect(p.l - e, p.t - e, p.r - p.l + 2 * e, p.b - p.t + 2 * e); }
  ctx.fillStyle = '#fff';
  for (let i = 0; i < n; i++) { const p = list[i]; ctx.fillRect(p.l, p.t, p.r - p.l, p.b - p.t); }
  // No hairlines where blocks just meet.
  let seams = map.getSeams();
  if (rect) {
    const all = seams;
    seams = Q.seams;
    seams.length = 0;
    for (let i = 0; i < all.length; i++) {
      const s = all[i];
      if (s.x !== undefined
        ? s.x + e >= rect.l && s.x - e <= rect.r && s.b >= rect.t && s.t <= rect.b
        : s.y + e >= rect.t && s.y - e <= rect.b && s.r >= rect.l && s.l <= rect.r) seams.push(s);
    }
  }
  Q.ctx = ctx;
  fillSeams(seams, e, fillTo);
  // Built blocks (the Engineer's Builder): sandbag colour, with the rows drawn in.
  if (map.builtCount && list.some(isBuilt)) {
    ctx.fillStyle = BUILT;
    for (let i = 0; i < n; i++) { const p = list[i]; if (p.built) ctx.fillRect(p.l, p.t, p.r - p.l, p.b - p.t); }
    ctx.strokeStyle = BUILT_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const p = list[i]; if (p.built) courses(p.l, p.t, p.r, p.b, BUILT_ROW, lineTo); }
    ctx.stroke();
  }
  // Destructible maps: blocks explosions can't break are hatched.
  if (destruction) {
    ctx.strokeStyle = HATCH;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p = list[i];
      if (!p.hard || p.bounce) continue;
      hatch(p.l, p.t, p.r, p.b, HATCH_GAP, lineTo);
    }
    ctx.stroke();
  }
  Q.ctx = null;
  // Jump pads: a light fill (their chevrons move, so they're drawn each frame).
  ctx.fillStyle = '#eef3e2';
  for (let i = 0; i < n; i++) { const p = list[i]; if (p.bounce) ctx.fillRect(p.l, p.t, p.r - p.l, p.b - p.t); }
  const box = Q.box;
  box.l = Infinity; box.t = Infinity; box.r = -Infinity; box.b = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = list[i];
    if (p.l - e < box.l) box.l = p.l - e;
    if (p.t - e < box.t) box.t = p.t - e;
    if (p.r + e > box.r) box.r = p.r + e;
    if (p.b + e > box.b) box.b = p.b + e;
  }
  return box;
}

// paintMap's working state, used again on every call (no new lists or functions each
// frame): the blocks and seams near the area, the area, the outline width, the canvas,
// and the box it returns (read it straight away: the next call fills it in again).
const Q = { list: [], seams: [], rect: null, e: 0, ctx: null, box: { l: 0, t: 0, r: 0, b: 0 } };
const near = s => {
  const rect = Q.rect, e = Q.e;
  if (s.r + e >= rect.l && s.l - e <= rect.r && s.b + e >= rect.t && s.t - e <= rect.b) Q.list.push(s);
  return false;
};
const fillTo = (x, y, w, h) => Q.ctx.fillRect(x, y, w, h);
const lineTo = (x0, y0, x1, y1) => { Q.ctx.moveTo(x0, y0); Q.ctx.lineTo(x1, y1); };
const isBuilt = p => p.built;

const makeCanvas = () => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(TILE, TILE) : Object.assign(document.createElement('canvas'), { width: TILE, height: TILE }));
const contextOf = (canvas, opaque) => canvas.getContext('2d', { alpha: !opaque });

export class MapTiles {
  constructor() {
    this.tiles = new Map();  // `${scale}|${i},${j}` -> { canvas, rect (world), empty, dirty, used }
    this.pools = { true: [], false: [] }; // canvases from tiles let go, to reuse (opaque ones, and see-through)
    this.map = null;
    this.scaleKey = null;
    this.settled = 0;
    this.frame = 0;
  }

  /** Forget every tile (a different map, or the window changed size). */
  clear() {
    for (const t of this.tiles.values()) this.release(t);
    this.tiles.clear();
  }

  release(t) {
    if (t.canvas) this.pools[t.opaque].push(t.canvas);
    t.canvas = null;
  }

  /** Blocks changed in `area` (world): tiles there are drawn again (any zoom). */
  invalidate(area) {
    const m = 8;
    for (const t of this.tiles.values()) {
      if (t.rect.l < area.r + m && t.rect.r > area.l - m && t.rect.t < area.b + m && t.rect.b > area.t - m) t.dirty = true;
    }
  }

  /**
   * Draw the map for renderer r (its ctx is set to the world transform: scale s,
   * then (tx, ty), whole screen pixels). opaque: with the white background (nothing
   * drawn yet). Returns false if it didn't (the zoom is still changing, or there are
   * tiles still to make): draw it directly this frame.
   */
  draw(r, game, opaque) {
    const map = game.map, s = r.s, tx = r.tx, ty = r.ty, e = r.lineW;
    const destruction = !!game.options?.destruction;
    if (map !== this.map) { this.clear(); this.map = map; this.seen = map.editCount; }
    const key = `${s}|${e}|${destruction}|${opaque}`;
    if (key !== this.scaleKey) { this.scaleKey = key; this.settled = 0; }
    if (++this.settled < SETTLE_FRAMES) return false;
    // Blocks changed since the last frame: just those tiles are drawn again.
    if (map.editCount !== this.seen) {
      const n = map.editCount - this.seen;
      if (n > map.edits.length) this.clear();
      else for (const a of map.edits.slice(-n)) this.invalidate(a);
      this.seen = map.editCount;
    }
    const T = TILE / s; // a tile's size in the world
    const i0 = Math.floor(-tx / TILE), i1 = Math.floor((r.pw - 1 - tx) / TILE);
    const j0 = Math.floor(-ty / TILE), j1 = Math.floor((r.ph - 1 - ty) / TILE);
    const frame = ++this.frame;
    let made = 0, waiting = false;
    const shown = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = `${key}|${i},${j}`;
        let t = this.tiles.get(k);
        if (!t) this.tiles.set(k, t = { canvas: null, opaque, rect: { l: i * T, t: j * T, r: (i + 1) * T, b: (j + 1) * T }, empty: false, dirty: true, used: 0 });
        t.used = frame;
        if (t.dirty) {
          if (made >= NEW_PER_FRAME) { waiting = true; continue; }
          this.paint(t, i, j, map, s, e, destruction);
          made++;
        }
        if (!t.empty || opaque) shown.push(t, i, j);
      }
    }
    this.trim((i1 - i0 + 1) * (j1 - j0 + 1));
    if (waiting) return false;
    const ctx = r.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    for (let n = 0; n < shown.length; n += 3) {
      const t = shown[n], x = shown[n + 1] * TILE + tx, y = shown[n + 2] * TILE + ty;
      // An empty opaque tile is just white (no picture kept for it). A mostly empty one is
      // white, with only the part that has blocks in copied: filling is quicker than copying.
      if (!t.canvas) ctx.fillRect(x, y, TILE, TILE);
      else if (!t.part) ctx.drawImage(t.canvas, x, y);
      else {
        const p = t.part;
        if (t.opaque) ctx.fillRect(x, y, TILE, TILE);
        ctx.drawImage(t.canvas, p.x, p.y, p.w, p.h, x + p.x, y + p.y, p.w, p.h);
      }
    }
    ctx.setTransform(s, 0, 0, s, tx, ty);
    return true;
  }

  /** Draw tile (i, j): the blocks in it, at scale s. */
  paint(t, i, j, map, s, e, destruction) {
    t.dirty = false;
    t.canvas ||= this.pools[t.opaque].pop() || makeCanvas();
    const ctx = contextOf(t.canvas, t.opaque);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (t.opaque) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, TILE, TILE); } else ctx.clearRect(0, 0, TILE, TILE);
    ctx.setTransform(s, 0, 0, s, -i * TILE, -j * TILE);
    const box = paintMap(ctx, map, e, t.rect, destruction);
    t.empty = !box;
    // (An empty tile keeps no picture.)
    if (t.empty) { this.release(t); return; }
    // Where on the tile the blocks are (whole pixels, a pixel to spare): if that's less than
    // half of it, only that part is copied to the screen.
    const x0 = Math.max(0, Math.floor(box.l * s) - i * TILE - 1), y0 = Math.max(0, Math.floor(box.t * s) - j * TILE - 1);
    const x1 = Math.min(TILE, Math.ceil(box.r * s) - i * TILE + 1), y1 = Math.min(TILE, Math.ceil(box.b * s) - j * TILE + 1);
    t.part = (x1 - x0) * (y1 - y0) < TILE * TILE / 2 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  /** Keep at most twice what's on screen (the least recently shown go first). */
  trim(onScreen) {
    const most = onScreen * 2 + 8;
    if (this.tiles.size <= most) return;
    const old = [...this.tiles].sort((a, b) => a[1].used - b[1].used).slice(0, this.tiles.size - most);
    for (const [k, t] of old) {
      this.release(t);
      this.tiles.delete(k);
    }
    for (const pool of Object.values(this.pools)) if (pool.length > 16) pool.length = 16;
  }
}
