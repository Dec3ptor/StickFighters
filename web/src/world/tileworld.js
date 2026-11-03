// A world's tiles (world mode), seen by the rest of the game as a map: what's solid where (each
// solid tile as one box, or two for a ramp), what a shot or a line of sight hits first, where
// a soldier can stand (one-way platforms too), ladders, holes blown by explosions, and where
// everyone starts. Chunks are made from the seed (worldgen.js) the first time anything looks at
// them; those players change are kept, and saved (worldsave.js).

import * as K from './blocks.js';
import { TILE, SOLID, PLATFORMS, LIQUID, SHAPES, BLOCKS, AIR, BEDROCK, FLUIDS, FLUID, AMOUNT, SOURCE, FALLING, WASH, SLIP } from './blocks.js';
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
// (A tile's shape byte: its shape in the bottom four bits, its variant, a block's `variants`, in the
// top four: its paint. Every byte's boxes, so collisions read it as it is.)
const SHAPE_BOXES = Array.from({ length: 256 }, (_, i) => (SHAPES[i & 15] || SHAPES[0]).boxes);

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
   * used in place of the seed's. gen: the generator's version it was made with (worldgen.js:
   * 2 has towns, 3 ores in veins; worlds keep theirs). towns: true, an older way to say 2.
   */
  constructor({ seed = 1, name = 'World', saved = null, towns = false, gen = 0, noTowns = false } = {}) {
    this.seed = seed | 0;
    this.name = name;
    this.genVersion = gen || (towns ? 2 : 1);
    this.gen = new WorldGen(this.seed, { gen: this.genVersion, noTowns });
    this.towns = this.gen.towns;
    this.noTowns = !!noTowns;
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
    // Told of each block a blast breaks: fn(tx, ty, block, its shape byte). (The world's rules drop what it gives.)
    this.onBreak = null;
    // The boxes handed out by the lookups: used again in turn (callers read what they need
    // straight away, as with GameMap's).
    this.ring = Array.from({ length: 4096 }, () => ({ l: 0, t: 0, r: 0, b: 0, id: -1, bounce: 0, hard: false, built: false, look: null, tx: 0, ty: 0, block: 0, platform: false }));
    this.ringAt = 0;
    // Water to look at in the flow's next wave (flowTick): tiles changed, and the water beside
    // them, as keys (flowKey). And the waves so far.
    this.flowing = new Set();
    this.waves = 0;
    // (Told of each block flowing water washes away: fn(tx, ty, block). The world's rules drop it.)
    this.onWash = null;
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
      this.wakeChunk(c, !!s);
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

  // ---- Making chunks off the game's thread (in a page: genworker.js) ----------------------------

  /**
   * A worker to make chunks before they're wanted (url: genworker.js's address), off the game's
   * thread: making one takes half a millisecond or so, some a few. Where there are no workers
   * (or it fails), chunks are made here as ever, when they're first wanted.
   */
  startWorker(url) {
    if (this.worker || typeof Worker === 'undefined') return false;
    try { this.worker = new Worker(url, { type: 'module' }); } catch { this.worker = null; return false; }
    this.pending = new Set();
    this.worker.onmessage = e => this.adopt(e.data);
    this.worker.onerror = () => this.stopWorker();
    this.worker.postMessage({ init: true, seed: this.seed, gen: this.genVersion, noTowns: this.noTowns });
    return true;
  }

  stopWorker() {
    this.worker?.terminate();
    this.worker = null;
    this.pending?.clear();
  }

  /**
   * Chunks wanted soon ([cx, cy], nearest first), asked of the worker: those not made yet, asked
   * for already, or kept (changed by players: made from what's kept instead). False with no worker.
   */
  ask(list) {
    if (!this.worker) return false;
    const out = [];
    for (const [cx, cy] of list) {
      const k = chunkKey(cx, cy);
      if (cy < 0 || cy >= CHUNKS_Y || this.chunks.has(k) || this.pending.has(k) || this.saved.has(k)) continue;
      this.pending.add(k);
      out.push([cx, cy]);
    }
    if (out.length) this.worker.postMessage({ want: out });
    return true;
  }

  /** A chunk the worker made: taken, unless it's been made here meanwhile (or is kept changed). */
  adopt(d) {
    if (!d || !Number.isInteger(d.cx) || !Number.isInteger(d.cy)) return;
    const k = chunkKey(d.cx, d.cy), n = CHUNK * CHUNK;
    this.pending?.delete(k);
    if (this.chunks.has(k) || this.saved.has(k) || d.fg?.length !== n || d.bg?.length !== n || d.shape?.length !== n) return;
    const c = new Chunk(d.cx, d.cy);
    c.fg = d.fg; c.bg = d.bg; c.shape = d.shape;
    this.chunks.set(k, c);
    this.wakeChunk(c, false);
  }

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
    return this.chunk(tx >> 5, ty >> 5).shape[((ty & 31) << 5) | (tx & 31)] & 15;
  }

  /** Which of its block's variants tile (tx, ty) is (blocks.js: 0, its own; the top half of the shape byte). */
  paint(tx, ty) {
    if (ty < 0 || ty >= WORLD_H) return 0;
    return this.chunk(tx >> 5, ty >> 5).shape[((ty & 31) << 5) | (tx & 31)] >> 4;
  }

  /** A tile's shape byte as it's kept (its shape and its paint): what's sent online. */
  shapeByte(tx, ty) {
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
    if (layer === 'fg') this.wakeWater(tx, ty, v);
    return true;
  }

  setTile(tx, ty, block) { return this.set('fg', tx, ty, block); }
  setWall(tx, ty, wall) { return this.set('bg', tx, ty, wall); }
  setShape(tx, ty, shape) {
    if (!SOLID[this.tile(tx, ty)]) return false;
    return this.set('shape', tx, ty, (this.shapeByte(tx, ty) & 0xf0) | (shape & 15));
  }
  /** Make tile (tx, ty) its block's variant `paint` (0 to 15), keeping its shape. */
  setPaint(tx, ty, paint) { return this.set('shape', tx, ty, (this.shapeByte(tx, ty) & 15) | ((paint & 15) << 4)); }

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

  /**
   * True if the point (in pixels) is in water (or something growing in it): under its top, in
   * flowing water as shallow as its level (with more above it, all of the tile).
   */
  liquidAt(x, y) {
    const ty = Math.floor(y / TILE);
    if (ty < 0 || ty >= WORLD_H) return false;
    const tx = Math.floor(x / TILE), id = this.chunk(tx >> 5, ty >> 5).fg[((ty & 31) << 5) | (tx & 31)];
    if (LIQUID[id] !== 1) return false;
    const a = AMOUNT[id];
    if (a >= 8 || ty === 0 || FLUID[this.tile(tx, ty - 1)] === FLUID[id]) return true;
    return y - ty * TILE >= TILE - (TILE * (a + 1)) / 9;
  }

  /**
   * How slippery the ground is under feet at height y (px; just under them), across [l, r], x their
   * middle: the block under the middle's slip (ice: 1), or on an edge (nothing solid under the
   * middle), the most of those under the feet. 0: not slippery.
   */
  slipAt(x, l, r, y) {
    const ty = Math.floor(y / TILE);
    if (ty < 0 || ty >= WORLD_H) return 0;
    const mid = this.tile(Math.floor(x / TILE), ty);
    if (SOLID[mid]) return SLIP[mid];
    let most = 0;
    for (let tx = Math.floor(l / TILE), t1 = Math.floor((r - 0.01) / TILE); tx <= t1; tx++) {
      const id = this.tile(tx, ty);
      if (SOLID[id] && SLIP[id] > most) most = SLIP[id];
    }
    return most;
  }

  /**
   * Which way the water at the point (px) runs, Minecraft's way: -1 or 1 (left or right: flowing
   * water, downhill: toward lower water, or the open beside it), 2 (falling), 0 (still, or none).
   */
  currentAt(x, y) {
    const ty = Math.floor(y / TILE);
    if (ty < 0 || ty >= WORLD_H) return 0;
    const tx = Math.floor(x / TILE), id = this.chunk(tx >> 5, ty >> 5).fg[((ty & 31) << 5) | (tx & 31)], f = FLUID[id];
    if (!f || SOURCE[id]) return 0;
    if (FALLING[id]) return 2;
    if (!this.liquidAt(x, y)) return 0;
    // (Each side: how much lower its water is, or the open, where it'll run.)
    const own = AMOUNT[id];
    let way = 0;
    for (let d = -1; d <= 1; d += 2) {
      const n = this.tile(tx + d, ty);
      if (FLUID[n] === f) way += d * (own - (FALLING[n] ? 8 : AMOUNT[n]));
      else if (WASH[n]) way += d * own;
    }
    return way > 0 ? 1 : way < 0 ? -1 : 0;
  }

  // ---- Water flowing (Minecraft's way) ------------------------------------------------------------
  // Still water (a source: the land's seas, lakes and pools) stays as it is until a way opens up
  // beside or below it. Then it flows, a step a wave (flowTick: every few updates), as Minecraft's:
  //   * down first, into the open under it: falling water, a column down to wherever it lands;
  //   * where it can't fall (on the ground; a source on water too), out to the sides, a level less
  //     each tile (7 beside its source or where it lands, down to 1: seven tiles out at most), and
  //     only toward the nearest way down within four tiles, if there is one (both ways if there
  //     isn't, or they're as near); flowing water on more water goes no further;
  //   * each tile's level worked out again from what's round it (the best beside it, less one; with
  //     water above it, falling): what fed it gone, it dries up, a level at a time;
  //   * between two sources, on something (or on a source), flowing water becomes a source.
  // Each change wakes the water round it for the next wave. Only in chunks that are made (it waits
  // at the edge of one that isn't, and goes on when it is made); not into towns or bases.

  /** The block at (tx, ty) if its chunk is made, else -1 (without making it). */
  peek(tx, ty) {
    if (ty < 0 || ty >= WORLD_H) return ty < 0 ? AIR : BEDROCK;
    const c = this.chunks.get(chunkKey(tx >> 5, ty >> 5));
    return c ? c.fg[((ty & 31) << 5) | (tx & 31)] : -1;
  }

  /** Tile (tx, ty) just became block v: it, and the water beside, above and under it, looked at in the next wave. */
  wakeWater(tx, ty, v) {
    if (FLUID[v]) this.flowing.add(flowKey(tx, ty));
    for (let i = 0; i < NEAR.length; i += 2) {
      const x = tx + NEAR[i], y = ty + NEAR[i + 1];
      if (FLUID[this.peek(x, y)]) this.flowing.add(flowKey(x, y));
    }
  }

  /**
   * Chunk c just made: the water along its edges and the edges of those beside it, looked at (it
   * may run on from one into the other); from a save (`saved`), all its flowing water too (it was
   * on its way when it was saved).
   */
  wakeChunk(c, saved) {
    const x0 = c.cx * CHUNK, y0 = c.cy * CHUNK, fg = c.fg;
    if (saved) for (let i = 0; i < fg.length; i++) if (FLUID[fg[i]] && !SOURCE[fg[i]]) this.flowing.add(flowKey(x0 + (i & 31), y0 + (i >> 5)));
    for (let side = 0; side < 4; side++) {
      // (Above, right, below, left.)
      const n = this.chunks.get(chunkKey(c.cx + (side === 1 ? 1 : side === 3 ? -1 : 0), c.cy + (side === 2 ? 1 : side === 0 ? -1 : 0)));
      if (!n) continue;
      for (let j = 0; j < CHUNK; j++) {
        // (This chunk's tile along that edge, and the one over the edge from it.)
        const lx = side === 1 ? CHUNK - 1 : side === 3 ? 0 : j, ly = side === 2 ? CHUNK - 1 : side === 0 ? 0 : j;
        const ox = side === 1 ? 0 : side === 3 ? CHUNK - 1 : j, oy = side === 2 ? 0 : side === 0 ? CHUNK - 1 : j;
        if (FLUID[fg[(ly << 5) | lx]]) this.flowing.add(flowKey(x0 + lx, y0 + ly));
        if (FLUID[n.fg[(oy << 5) | ox]]) this.flowing.add(flowKey(n.cx * CHUNK + ox, n.cy * CHUNK + oy));
      }
    }
  }

  /** Whether flowing water can run into (tx, ty) (block id there): the open, or what it washes away; not into towns or bases. */
  canEnter(tx, ty, id) {
    return id >= 0 && WASH[id] === 1 && ty > 0 && ty < WORLD_H - 1 && tx >= -HALF_W && tx < HALF_W && !this.protect?.(tx, ty);
  }

  /** Whether fluid f could go along through (tx, ty) (block id): where it can run, or where it's flowing already (not a source). */
  passes(tx, ty, id, f) {
    if (id < 0) return false;
    if (FLUID[id]) return FLUID[id] === f && !SOURCE[id];
    return this.canEnter(tx, ty, id);
  }

  /** Whether there's a way down under (tx, ty) for fluid f: where it can run, or more of it. */
  holeUnder(tx, ty, f) {
    const id = this.peek(tx, ty + 1);
    return FLUID[id] === f || this.canEnter(tx, ty + 1, id);
  }

  /**
   * What fluid f makes (tx, ty) now, from what's round it (Minecraft's getNewLiquid): a source
   * (between two of them, on something), falling (more of it above), flowing (the best beside it,
   * a level less), or AIR; -1 if what's round it isn't all made yet.
   */
  fluidFor(tx, ty, f) {
    const F = FLUIDS[f], l = this.peek(tx - 1, ty), r = this.peek(tx + 1, ty), up = this.peek(tx, ty - 1), dn = this.peek(tx, ty + 1);
    if (l < 0 || r < 0 || up < 0 || dn < 0) return -1;
    let sources = 0, most = 0;
    if (FLUID[l] === f) { sources += SOURCE[l]; most = AMOUNT[l]; }
    if (FLUID[r] === f) { sources += SOURCE[r]; most = Math.max(most, AMOUNT[r]); }
    if (sources >= 2 && F.renew && (FLUID[dn] === f ? SOURCE[dn] === 1 : !FLUID[dn] && !WASH[dn])) return F.source;
    if (FLUID[up] === f) return F.fall;
    const a = most - F.drop;
    return a > 0 ? F.flow[a] : AIR;
  }

  /** Fluid block v into (tx, ty) (where `was` was: what it washes away, dropped: onWash). */
  pour(tx, ty, was, v) {
    this.setTile(tx, ty, v);
    if (was !== AIR) this.onWash?.(tx, ty, was);
  }

  /** The fluid at (tx, ty) worked out again from what's round it, then run on from there (Minecraft's tick). Returns the tiles changed. */
  flowAt(tx, ty) {
    const id = this.peek(tx, ty), f = id > 0 ? FLUID[id] : 0;
    if (!f) return 0;
    let n = 0, cur = id;
    if (!SOURCE[id]) {
      const now = this.fluidFor(tx, ty, f);
      if (now < 0) return 0;
      if (now !== id) {
        this.setTile(tx, ty, now);
        n++;
        if (now === AIR) return n;
        cur = now;
      }
    }
    return n + this.spread(tx, ty, cur, f);
  }

  /** Fluid block id at (tx, ty) running on: down if it can, else out to the sides. Returns the tiles changed. */
  spread(tx, ty, id, f) {
    const F = FLUIDS[f], dn = this.peek(tx, ty + 1);
    if (dn < 0) return 0;
    if (this.canEnter(tx, ty + 1, dn)) {
      const v = this.fluidFor(tx, ty + 1, f);
      if (v <= 0) return 0;
      this.pour(tx, ty + 1, dn, v);
      return 1;
    }
    // (Flowing on more of itself: no further. A source on it spreads.)
    if (FLUID[dn] === f && !SOURCE[id]) return 0;
    if ((FALLING[id] ? 8 : AMOUNT[id]) - F.drop <= 0) return 0;
    // Each way along it can go: how far that way to the nearest way down (0: right beside it).
    let best = NO_DROP, ways = 0;
    for (let d = -1; d <= 1; d += 2) {
      const x = tx + d;
      if (!this.passes(x, ty, this.peek(x, ty), f)) continue;
      const far = this.holeUnder(x, ty, f) ? 0 : this.slope(x, ty, d, f, F.reach);
      if (far < best) { best = far; ways = 0; }
      if (far === best) ways |= d < 0 ? 1 : 2;
    }
    let n = 0;
    for (let d = -1; d <= 1; d += 2) {
      if (!(ways & (d < 0 ? 1 : 2))) continue;
      const x = tx + d, was = this.peek(x, ty);
      if (!this.canEnter(x, ty, was)) continue;
      const v = this.fluidFor(x, ty, f);
      if (v <= 0) continue;
      this.pour(x, ty, was, v);
      n++;
    }
    return n;
  }

  /** How many tiles on along way d from (tx, ty) to a way down for fluid f (Minecraft's slope distance): NO_DROP if none within `reach`. */
  slope(tx, ty, d, f, reach) {
    for (let x = tx + d, k = 1; ; x += d, k++) {
      if (!this.passes(x, ty, this.peek(x, ty), f)) return NO_DROP;
      if (this.holeUnder(x, ty, f)) return k;
      if (k >= reach) return NO_DROP;
    }
  }

  /**
   * One wave of the flow: each tile waiting looked at (flowAt), till `most` tiles have changed (the
   * rest wait for the next wave; a slower fluid's, for its own). What changes wakes the water round
   * it, for the next wave. Returns how many tiles changed.
   */
  flowTick(most = FLOW_WAVE) {
    if (!this.flowing.size) return 0;
    const wave = this.wave ||= [];
    wave.length = 0;
    for (const k of this.flowing) wave.push(k);
    this.flowing.clear();
    this.waves++;
    let n = 0, looked = 0;
    for (let i = 0; i < wave.length; i++) {
      const k = wave[i];
      if (n >= most || looked >= most * 6) { this.flowing.add(k); continue; }
      const tx = Math.floor(k / 512) - HALF_W, ty = k % 512, every = FLUIDS[FLUID[this.peek(tx, ty)] || 0]?.every || 1;
      if (every > 1 && this.waves % every) { this.flowing.add(k); continue; }
      looked++;
      n += this.flowAt(tx, ty);
    }
    return n;
  }

  /** True if the box touches a ladder. */
  climbable(l, t, r, b) {
    const tx0 = Math.floor(l / TILE), tx1 = Math.floor((r - 0.01) / TILE), ty0 = Math.max(0, Math.floor(t / TILE)), ty1 = Math.min(WORLD_H - 1, Math.floor((b - 0.01) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) { const id = this.tile(tx, ty); if (id === K.LADDER || id === K.SCAFFOLD) return true; }
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
        const sb = this.shapeByte(tx, ty);
        this.setTile(tx, ty, AIR);
        this.onBreak?.(tx, ty, id, sb);
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
// Water flowing: a tile's key in the waiting list; the tiles beside, above and under one ([dx, dy]
// pairs); the most tiles changed in a wave; no way down found.
const flowKey = (tx, ty) => (tx + HALF_W) * 512 + ty;
const NEAR = [-1, 0, 1, 0, 0, -1, 0, 1];
const FLOW_WAVE = 240;
const NO_DROP = 1000;
