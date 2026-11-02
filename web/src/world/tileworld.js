// A world's tiles (world mode), seen by the rest of the game as a map: what's solid where (each
// solid tile as one box, or two for a ramp), what a shot or a line of sight hits first, where
// a soldier can stand (one-way platforms too), ladders, holes blown by explosions, and where
// everyone starts. Chunks are made from the seed (worldgen.js) the first time anything looks at
// them; those players change are kept, and saved (worldsave.js).

import * as K from './blocks.js';
import { TILE, SOLID, PLATFORMS, SHAPES, BLOCKS, AIR, BEDROCK } from './blocks.js';
import { WorldGen, CHUNK, WORLD_H, HALF_W } from './worldgen.js';
import { segmentT, SEG } from '../map.js';

export { TILE, CHUNK, WORLD_H, HALF_W };
export const CHUNKS_Y = WORLD_H / CHUNK;
/** A chunk's number in maps of chunks (cx can be anything a world reaches). */
export const chunkKey = (cx, cy) => (cx + 1048576) * 64 + cy;
export const keyCx = k => Math.floor(k / 64) - 1048576;
export const keyCy = k => k % 64;

// How thick a platform is, for standing on it and drawing it.
export const PLATFORM_H = 4;
const SHAPE_BOXES = SHAPES.map(s => s.boxes);

export class Chunk {
  constructor(cx, cy) {
    this.cx = cx;
    this.cy = cy;
    this.fg = new Uint8Array(CHUNK * CHUNK);    // blocks
    this.bg = new Uint8Array(CHUNK * CHUNK);    // walls behind
    this.shape = new Uint8Array(CHUNK * CHUNK); // SHAPES: full, half, ramps
    this.version = 0;  // goes up with every change (drawing works out its pictures again)
    this.edited = false; // changed since it was made from the seed: saved with the world
    this.dirty = false;  // changed since it was last saved
  }
}

export class TileWorld {
  /**
   * seed: the world's seed. saved: chunks as saved ({ key: { fg, bg, shape } }, chunkKey),
   * used in place of the seed's. towns: whether it has towns (worlds made before them don't).
   */
  constructor({ seed = 1, name = 'World', saved = null, towns = false } = {}) {
    this.seed = seed | 0;
    this.name = name;
    this.towns = !!towns;
    this.gen = new WorldGen(this.seed, { towns: this.towns });
    this.chunks = new Map();
    this.saved = saved instanceof Map ? saved : new Map(Object.entries(saved || {}).map(([k, v]) => [Number(k), v]));
    this.bounds = { left: -HALF_W * TILE, top: 0, right: HALF_W * TILE, bottom: WORLD_H * TILE };
    const sp = this.gen.spawn(TILE, 12);
    this.spawns = [{ x: sp.x, y: sp.y, team: 0 }];
    // (What the rest of the game expects of a map, and a world doesn't have.)
    this.items = [];
    this.objectives = [];
    this.loadout = null;
    this.theme = null;
    this.looks = { classic: false, remastered: false };
    this.solids = [];
    this.builtCount = 1; // (so explosions break blocks: Game.carve)
    // Soldiers walk up a block's height without jumping (physics.js).
    this.stepUp = TILE;
    // The time (updates since the world began: monsters.js has the day and night).
    this.time = 0;
    this.version = 0;
    this.edits = [];
    this.editCount = 0;
    // Told of every change: fn(tx, ty, layer ('fg', 'bg' or 'shape'), was).
    this.listeners = [];
    // Told of a whole chunk replaced (loadChunk): fn(cx, cy).
    this.chunkListeners = [];
    // Told of each block a blast breaks: fn(tx, ty, block). (The world's rules drop what it gives.)
    this.onBreak = null;
    // The boxes handed out by the lookups: used again in turn (callers read what they need
    // straight away, as with GameMap's).
    this.ring = Array.from({ length: 4096 }, () => ({ l: 0, t: 0, r: 0, b: 0, id: -1, bounce: 0, hard: false, built: false, look: null, tx: 0, ty: 0, block: 0, platform: false }));
    this.ringAt = 0;
    this._hit = { t: 0, x: 0, y: 0, nx: 0, ny: 0, solid: null };
    this.lastKey = NaN;
    this.lastChunk = null;
  }

  // ---- Chunks and tiles ------------------------------------------------------------------------

  /** Chunk (cx, cy), made (or loaded) the first time it's asked for; null above or below the world. */
  chunk(cx, cy) {
    if (cy < 0 || cy >= CHUNKS_Y) return null;
    const k = chunkKey(cx, cy);
    if (k === this.lastKey) return this.lastChunk;
    let c = this.chunks.get(k);
    if (!c) {
      c = new Chunk(cx, cy);
      const s = this.saved.get(k);
      if (s) { c.fg.set(s.fg); c.bg.set(s.bg); c.shape.set(s.shape); c.edited = true; }
      else this.gen.fillChunk(cx, cy, c.fg, c.bg, c.shape);
      this.chunks.set(k, c);
    }
    this.lastKey = k;
    this.lastChunk = c;
    return c;
  }

  /**
   * Chunk `key`'s contents replaced with `data` ({ fg, bg, shape }): online, a chunk as the host
   * has it. If it isn't made yet, it's kept for when it is.
   */
  loadChunk(key, data) {
    const c = this.chunks.get(key);
    if (!c) { this.saved.set(key, data); return; }
    c.fg.set(data.fg); c.bg.set(data.bg); c.shape.set(data.shape);
    c.version++;
    c.edited = true;
    this.version++;
    for (const fn of this.chunkListeners) fn(c.cx, c.cy);
  }

  /** True if chunk (cx, cy) has been made already (without making it). */
  has(cx, cy) { return this.chunks.has(chunkKey(cx, cy)); }

  /** The block at tile (tx, ty): air above the world, bedrock below it. */
  tile(tx, ty) {
    if (ty < 0) return AIR;
    if (ty >= WORLD_H) return BEDROCK;
    return this.chunk(tx >> 5, ty >> 5).fg[((ty & 31) << 5) | (tx & 31)];
  }

  wall(tx, ty) {
    if (ty < 0 || ty >= WORLD_H) return K.NO_WALL;
    return this.chunk(tx >> 5, ty >> 5).bg[((ty & 31) << 5) | (tx & 31)];
  }

  shape(tx, ty) {
    if (ty < 0 || ty >= WORLD_H) return 0;
    return this.chunk(tx >> 5, ty >> 5).shape[((ty & 31) << 5) | (tx & 31)];
  }

  /** The block at a point in pixels. */
  tileAt(x, y) { return this.tile(Math.floor(x / TILE), Math.floor(y / TILE)); }

  /** Change a layer of tile (tx, ty) (fg: blocks, bg: walls, shape). Returns true if it changed. */
  set(layer, tx, ty, v) {
    if (ty < 0 || ty >= WORLD_H || tx < -HALF_W || tx >= HALF_W) return false;
    const c = this.chunk(tx >> 5, ty >> 5), i = ((ty & 31) << 5) | (tx & 31), arr = c[layer];
    const was = arr[i];
    if (was === v) return false;
    arr[i] = v;
    // (A block taken away or put in starts as a full one.)
    if (layer === 'fg' && c.shape[i]) c.shape[i] = 0;
    c.version++;
    c.edited = c.dirty = true;
    this.version++;
    this.editCount++;
    for (const fn of this.listeners) fn(tx, ty, layer, was);
    return true;
  }

  setTile(tx, ty, block) { return this.set('fg', tx, ty, block); }
  setWall(tx, ty, wall) { return this.set('bg', tx, ty, wall); }
  setShape(tx, ty, shape) {
    if (!SOLID[this.tile(tx, ty)]) return false;
    return this.set('shape', tx, ty, shape);
  }

  /** The chunks changed since they were last saved (and marks them saved). */
  takeDirty() {
    const out = [];
    for (const c of this.chunks.values()) {
      if (!c.dirty) continue;
      c.dirty = false;
      out.push(c);
    }
    return out;
  }

  /**
   * Let go of chunks far from all of `points` ([{x, y}] in pixels): further than `range`
   * chunks across. Changed ones are kept as saved data, to load again.
   */
  trim(points, range = 12) {
    for (const [k, c] of this.chunks) {
      let near = false;
      for (const p of points) {
        if (Math.abs(Math.floor(p.x / (CHUNK * TILE)) - c.cx) <= range && Math.abs(Math.floor(p.y / (CHUNK * TILE)) - c.cy) <= range) { near = true; break; }
      }
      if (near || c.dirty) continue;
      if (c.edited) this.saved.set(k, { fg: c.fg, bg: c.bg, shape: c.shape });
      this.chunks.delete(k);
      if (k === this.lastKey) { this.lastKey = NaN; this.lastChunk = null; }
    }
  }

  // ---- The map lookups (map.js has the same, for maps made of boxes) ------------------------

  /** A box from the ring: part `p` of tile (tx, ty) with block `id`. */
  box(tx, ty, id, p) {
    const o = this.ring[this.ringAt];
    this.ringAt = (this.ringAt + 1) & 4095;
    o.l = tx * TILE + p[0]; o.t = ty * TILE + p[1]; o.r = tx * TILE + p[2]; o.b = ty * TILE + p[3];
    o.tx = tx; o.ty = ty; o.block = id; o.platform = false;
    o.hard = BLOCKS[id].resist >= 1e9;
    o.built = !BLOCKS[id].natural;
    return o;
  }

  /** A platform's box (its top PLATFORM_H pixels). */
  platformBox(tx, ty, id) {
    const o = this.box(tx, ty, id, PLAT);
    o.platform = true;
    return o;
  }

  /** First solid box overlapping the box (edges touching don't count), or null. */
  overlap(l, t, r, b) {
    const tx0 = Math.floor(l / TILE), tx1 = Math.floor(r / TILE), ty0 = Math.max(0, Math.floor(t / TILE)), ty1 = Math.min(WORLD_H - 1, Math.floor(b / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const c = this.chunk(tx >> 5, ty >> 5), i = ((ty & 31) << 5) | (tx & 31), id = c.fg[i];
        if (!SOLID[id]) continue;
        const parts = SHAPE_BOXES[c.shape[i]];
        for (let k = 0; k < parts.length; k++) {
          const p = parts[k], bl = tx * TILE + p[0], bt = ty * TILE + p[1], br = tx * TILE + p[2], bb = ty * TILE + p[3];
          if (l < br && r > bl && t < bb && b > bt) return this.box(tx, ty, id, p);
        }
      }
    }
    return null;
  }

  /** Every solid box overlapping the box, into `out` from the start: returns how many. */
  overlapAll(l, t, r, b, out) {
    let n = 0;
    const tx0 = Math.floor(l / TILE), tx1 = Math.floor(r / TILE), ty0 = Math.max(0, Math.floor(t / TILE)), ty1 = Math.min(WORLD_H - 1, Math.floor(b / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const c = this.chunk(tx >> 5, ty >> 5), i = ((ty & 31) << 5) | (tx & 31), id = c.fg[i];
        if (!SOLID[id]) continue;
        const parts = SHAPE_BOXES[c.shape[i]];
        for (let k = 0; k < parts.length; k++) {
          const p = parts[k], bl = tx * TILE + p[0], bt = ty * TILE + p[1], br = tx * TILE + p[2], bb = ty * TILE + p[3];
          if (l < br && r > bl && t < bb && b > bt) out[n++] = this.box(tx, ty, id, p);
        }
      }
    }
    return n;
  }

  /** What a soldier standing in the box (a thin strip under their feet) stands on: a solid, else a platform, else null. */
  support(l, t, r, b) {
    const solid = this.overlap(l, t, r, b);
    if (solid) return solid;
    const tx0 = Math.floor(l / TILE), tx1 = Math.floor(r / TILE), ty0 = Math.max(0, Math.floor(t / TILE)), ty1 = Math.min(WORLD_H - 1, Math.floor(b / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const id = this.tile(tx, ty);
        if (!PLATFORMS[id]) continue;
        const top = ty * TILE;
        if (l < tx * TILE + TILE && r > tx * TILE && t < top + PLATFORM_H && b > top) return this.platformBox(tx, ty, id);
      }
    }
    return null;
  }

  /**
   * Feet across [l, r] moving down from y0 to y1: the top of the first platform they reach
   * (from above), or null. (Platforms are only stood on from above.)
   */
  landing(l, r, y0, y1) {
    const tx0 = Math.floor(l / TILE), tx1 = Math.floor(r / TILE);
    const ty0 = Math.max(0, Math.ceil(y0 / TILE)), ty1 = Math.min(WORLD_H - 1, Math.floor(y1 / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      const top = ty * TILE;
      if (top < y0 || top > y1) continue;
      for (let tx = tx0; tx <= tx1; tx++) {
        if (PLATFORMS[this.tile(tx, ty)] && l < tx * TILE + TILE && r > tx * TILE) return top;
      }
    }
    return null;
  }

  /** True if the box touches a ladder. */
  climbable(l, t, r, b) {
    const tx0 = Math.floor(l / TILE), tx1 = Math.floor((r - 0.01) / TILE), ty0 = Math.max(0, Math.floor(t / TILE)), ty1 = Math.min(WORLD_H - 1, Math.floor((b - 0.01) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (this.tile(tx, ty) === K.LADDER) return true;
    return false;
  }

  /** Calls fn(box) for each solid box touching the box; stops if fn returns true. */
  query(l, t, r, b, fn) {
    const tx0 = Math.floor(l / TILE), tx1 = Math.floor(r / TILE), ty0 = Math.max(0, Math.floor(t / TILE)), ty1 = Math.min(WORLD_H - 1, Math.floor(b / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const id = this.tile(tx, ty);
        if (!SOLID[id]) continue;
        const parts = SHAPE_BOXES[this.shape(tx, ty)];
        for (let k = 0; k < parts.length; k++) if (fn(this.box(tx, ty, id, parts[k]))) return true;
      }
    }
    return false;
  }

  /**
   * The segment (x0,y0)->(x1,y1) through the tiles it crosses, in order (a grid walk): calls
   * hitTile for each until one is hit. Returns t of the hit (0 to 1), or -1.
   */
  walk(x0, y0, x1, y1, keep) {
    const dx = x1 - x0, dy = y1 - y0;
    let tx = Math.floor(x0 / TILE), ty = Math.floor(y0 / TILE);
    const ex = Math.floor(x1 / TILE), ey = Math.floor(y1 / TILE);
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    let tMaxX = sx ? ((sx > 0 ? (tx + 1) * TILE : tx * TILE) - x0) / dx : Infinity;
    let tMaxY = sy ? ((sy > 0 ? (ty + 1) * TILE : ty * TILE) - y0) / dy : Infinity;
    const tdx = sx ? TILE / Math.abs(dx) : Infinity, tdy = sy ? TILE / Math.abs(dy) : Infinity;
    // (Enough steps for the whole way, plus one for a corner.)
    for (let steps = Math.abs(ex - tx) + Math.abs(ey - ty) + 2; steps > 0; steps--) {
      if (ty >= 0 && ty < WORLD_H) {
        const c = this.chunk(tx >> 5, ty >> 5), i = ((ty & 31) << 5) | (tx & 31), id = c.fg[i];
        if (SOLID[id]) {
          const parts = SHAPE_BOXES[c.shape[i]];
          let best = -1, bp = null, nx = 0, ny = 0;
          for (let k = 0; k < parts.length; k++) {
            const p = parts[k];
            const h = segmentT(x0, y0, dx, dy, tx * TILE + p[0], ty * TILE + p[1], tx * TILE + p[2], ty * TILE + p[3]);
            if (h >= 0 && (best < 0 || h < best)) { best = h; bp = p; nx = SEG.nx; ny = SEG.ny; }
          }
          if (best >= 0) {
            if (keep) { const hit = this._hit; hit.t = best; hit.nx = nx; hit.ny = ny; hit.solid = this.box(tx, ty, id, bp); hit.x = x0 + dx * best; hit.y = y0 + dy * best; }
            return best;
          }
        }
      } else if (ty >= WORLD_H) {
        // (Below the world: as if bedrock.)
        const h = segmentT(x0, y0, dx, dy, tx * TILE, ty * TILE, tx * TILE + TILE, ty * TILE + TILE);
        if (h >= 0) {
          if (keep) { const hit = this._hit; hit.t = h; hit.nx = SEG.nx; hit.ny = SEG.ny; hit.solid = this.box(tx, ty, BEDROCK, SHAPE_BOXES[0][0]); hit.x = x0 + dx * h; hit.y = y0 + dy * h; }
          return h;
        }
      }
      if (tx === ex && ty === ey) break;
      if (tMaxX < tMaxY) { if (tMaxX > 1) break; tMaxX += tdx; tx += sx; } else { if (tMaxY > 1) break; tMaxY += tdy; ty += sy; }
    }
    return -1;
  }

  /** First point where the segment enters a solid: { t, x, y, nx, ny, solid } (used again by the next one), or null. */
  raycast(x0, y0, x1, y1) { return this.walk(x0, y0, x1, y1, true) >= 0 ? this._hit : null; }

  /** True if nothing solid blocks the straight line between two points. */
  clearLine(x0, y0, x1, y1) { return this.walk(x0, y0, x1, y1, false) < 0; }

  /** True if both points are in the same tile and it's open (a raycast between them can't hit). */
  emptyBetween(x0, y0, x1, y1) {
    const tx = Math.floor(x0 / TILE), ty = Math.floor(y0 / TILE);
    return tx === Math.floor(x1 / TILE) && ty === Math.floor(y1 / TILE) && !SOLID[this.tile(tx, ty)];
  }

  /**
   * An explosion at (x, y), radius r (px): blocks whose middle is within the radius, less
   * their resistance (a tougher block only goes nearer the middle), are blown away; trees and
   * plants caught in it too. builtOnly: only blocks players put there. Returns the area that
   * changed ({ l, t, r, b }), or null.
   */
  carve(x, y, r, builtOnly = false) {
    if (r < 2) return null;
    const tx0 = Math.floor((x - r) / TILE), tx1 = Math.floor((x + r) / TILE);
    const ty0 = Math.max(0, Math.floor((y - r) / TILE)), ty1 = Math.min(WORLD_H - 1, Math.floor((y + r) / TILE));
    let area = null;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const id = this.tile(tx, ty);
        if (id === AIR) continue;
        const b = BLOCKS[id];
        if (builtOnly && b.natural) continue;
        // (Players' bases are blast-proof: worldplay.js's claims.)
        if (this.protect?.(tx, ty)) continue;
        const cx = tx * TILE + TILE / 2 - x, cy = ty * TILE + TILE / 2 - y, reach = r - b.resist;
        if (reach <= 0 || cx * cx + cy * cy > reach * reach) continue;
        this.setTile(tx, ty, AIR);
        this.onBreak?.(tx, ty, id);
        const l = tx * TILE, t = ty * TILE;
        area = area ? { l: Math.min(area.l, l), t: Math.min(area.t, t), r: Math.max(area.r, l + TILE), b: Math.max(area.b, t + TILE) } : { l, t, r: l + TILE, b: t + TILE };
      }
    }
    return area;
  }

  /** (Maps made of boxes can have boxes added: worlds are built a block at a time instead.) */
  add() { return null; }

  /** (Only maps made of boxes need their seams filled.) */
  getSeams() { return NONE; }

  /** The tile's surface row at column tx: the first solid block from the top (or the world's usual surface). */
  surface(tx) {
    for (let ty = 0; ty < WORLD_H; ty++) if (SOLID[this.tile(tx, ty)]) return ty;
    return WORLD_H;
  }
}

const PLAT = [0, 0, TILE, PLATFORM_H];
const NONE = [];
