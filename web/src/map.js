// A playable map built from the decoded Stick Soldiers II map JSON.
// Coordinates are map pixels with y pointing down.

const CELL = 64;
// Destructible maps: explosions carve holes in blocks (see carve()). Pieces thinner
// than this are swept away rather than left as slivers, and a map stops breaking
// up once it's in this many pieces.
const MIN_PIECE = 4;
const MAX_SOLIDS = 6000;

export class GameMap {
  constructor(data) {
    this.name = data.name;
    this.theme = data.theme || null; // its look in Remastered (picked in the map maker), if it has one
    this.bounds = { ...data.bounds };
    // hard: can't be destroyed (marked in the map, or jump pads).
    this.solids = data.platforms.map((p, i) => ({
      id: i, l: p.left, t: p.top, r: p.right, b: p.bottom, bounce: p.bounce || 0, hard: !!(p.hard || p.bounce),
    }));
    this.nextId = this.solids.length;
    this.version = 0; // goes up whenever blocks change (destruction, building)
    // The map as it was (what the Engineer's Builder can repair), and whether any of it is gone.
    this.original = this.solids.filter(s => !s.bounce).map(s => ({ l: s.l, t: s.t, r: s.r, b: s.b }));
    this.changed = false;
    this.builtCount = 0; // blocks soldiers have built (explosions break these even on maps that don't break)
    // Where blocks changed, most recent last (for redrawing just those parts): editCount in all,
    // the last few in edits.
    this.edits = [];
    this.editCount = 0;
    this.spawns = data.spawns.map(s => (s.sector ? { x: s.x, y: s.y, team: s.team, sector: s.sector } : { x: s.x, y: s.y, team: s.team }));
    this.items = data.items.map(it => ({ type: it.type, weapon: it.weapon || null, x: it.x, y: it.y }));
    // What everyone spawns with on this map (custom maps): { weapons: [ids], armour, jetpack }.
    this.loadout = data.loadout || null;
    // Hills, flags, capture points and M-COMs for the objective modes (see objectives.js).
    this.objectives = (data.objectives || []).map(o => ({ ...o }));
    this._buildGrid();
  }

  _buildGrid() {
    const b = this.bounds;
    // Pad the grid well past the bounds so off-map queries stay cheap and safe.
    this.gx0 = Math.floor((b.left - 512) / CELL);
    this.gy0 = Math.floor((b.top - 512) / CELL);
    this.gw = Math.ceil((b.right + 512) / CELL) - this.gx0 + 1;
    this.gh = Math.ceil((b.bottom + 512) / CELL) - this.gy0 + 1;
    this.grid = Array.from({ length: this.gw * this.gh }, () => []);
    for (const s of this.solids) {
      for (let cy = this._cy(s.t); cy <= this._cy(s.b); cy++)
        for (let cx = this._cx(s.l); cx <= this._cx(s.r); cx++)
          this.grid[cy * this.gw + cx].push(s);
    }
    this._stamp = 0;
    this._seen = new Int32Array(Math.max(16, this.nextId));
  }

  _cells(s, fn) {
    for (let cy = this._cy(s.t); cy <= this._cy(s.b); cy++)
      for (let cx = this._cx(s.l); cx <= this._cx(s.r); cx++) fn(this.grid[cy * this.gw + cx]);
  }

  _add(s) {
    this.solids.push(s);
    this._cells(s, list => list.push(s));
    if (s.id >= this._seen.length) {
      const seen = new Int32Array(Math.max(s.id + 1, this._seen.length * 2));
      seen.set(this._seen);
      this._seen = seen;
    }
  }

  _remove(s) {
    const i = this.solids.indexOf(s);
    if (i >= 0) this.solids.splice(i, 1);
    this._cells(s, list => { const j = list.indexOf(s); if (j >= 0) list.splice(j, 1); });
  }

  /**
   * Blow a roughly round hole, radius r, at (x, y) through every block that isn't
   * hard (builtOnly: only through built blocks). Each block hit is replaced by the
   * boxes left around the hole. Returns the area that changed ({ l, t, r, b }), or
   * null if there was nothing to break. Integer arguments give exactly the same
   * result everywhere (online players repeat the host's holes).
   */
  carve(x, y, r, builtOnly = false) {
    if (r < 2 || this.solids.length > MAX_SOLIDS) return null;
    // A rounded hole: a wide box, a tall box and a square between them.
    const k = Math.round(r * 0.42), m = Math.round(r * 0.74);
    const holes = [
      { l: x - r, t: y - k, r: x + r, b: y + k },
      { l: x - k, t: y - r, r: x + k, b: y + r },
      { l: x - m, t: y - m, r: x + m, b: y + m },
    ];
    const hit = [];
    this.query(x - r, y - r, x + r, y + r, s => {
      if (!s.hard && (!builtOnly || s.built) && holes.some(h => s.l < h.r && s.r > h.l && s.t < h.b && s.b > h.t)) hit.push(s);
      return false;
    });
    if (!hit.length) return null;
    // (In the order blocks were made, so every player gets the same new ids.)
    hit.sort((a, b) => a.id - b.id);
    let area = null;
    for (const s of hit) {
      let pieces = [s];
      for (const h of holes) pieces = pieces.flatMap(p => subtractBox(p, snapHole(p, h)));
      this._remove(s);
      if (s.built) this.builtCount--;
      for (const p of pieces) {
        // (Bits left too small to matter are swept away; snapHole keeps them small.)
        if (p.r - p.l < MIN_PIECE || p.b - p.t < MIN_PIECE) continue;
        this._add({ id: this.nextId++, l: p.l, t: p.t, r: p.r, b: p.b, bounce: 0, hard: false, built: !!s.built });
        if (s.built) this.builtCount++;
      }
      area = area ? { l: Math.min(area.l, s.l), t: Math.min(area.t, s.t), r: Math.max(area.r, s.r), b: Math.max(area.b, s.b) }
        : { l: s.l, t: s.t, r: s.r, b: s.b };
    }
    this.version++;
    this.changed = true;
    const e = r + MIN_PIECE;
    const changed = { l: Math.max(area.l, x - e), t: Math.max(area.t, y - e), r: Math.min(area.r, x + e), b: Math.min(area.b, y + e) };
    this._edited(changed);
    return changed;
  }

  /**
   * A new block (the Engineer's Builder): `built` if it's new, rather than a repair
   * to the map as it was. Returns its area, or null if the map is too full to take it.
   */
  add(l, t, r, b, built = false) {
    if (!(r > l && b > t) || this.solids.length > MAX_SOLIDS) return null;
    this._add({ id: this.nextId++, l, t, r, b, bounce: 0, hard: false, built: !!built });
    if (built) this.builtCount++;
    this.version++;
    this._edited({ l, t, r, b });
    return { l, t, r, b };
  }

  _edited(area) {
    this.edits.push(area);
    this.editCount++;
    if (this.edits.length > 64) this.edits.shift();
  }

  /** Where blocks just meet (see seamsOf), worked out again when they change. */
  getSeams() {
    if (this.seams && this.seamsVersion === this.version) return this.seams;
    const out = [];
    for (const a of this.solids) {
      this.query(a.l - 0.1, a.t - 0.1, a.r + 0.1, a.b + 0.1, c => {
        if (c.id > a.id) seamBetween(a, c, out);
        return false;
      });
    }
    this.seams = out;
    this.seamsVersion = this.version;
    return out;
  }

  _cx(x) { return Math.max(0, Math.min(this.gw - 1, Math.floor(x / CELL) - this.gx0)); }
  _cy(y) { return Math.max(0, Math.min(this.gh - 1, Math.floor(y / CELL) - this.gy0)); }

  /** Calls fn(solid) once for each solid whose grid cells touch the box; stops if fn returns true. */
  query(l, t, r, b, fn) {
    const stamp = ++this._stamp;
    for (let cy = this._cy(t); cy <= this._cy(b); cy++) {
      for (let cx = this._cx(l); cx <= this._cx(r); cx++) {
        for (const s of this.grid[cy * this.gw + cx]) {
          if (this._seen[s.id] === stamp) continue;
          this._seen[s.id] = stamp;
          if (fn(s)) return true;
        }
      }
    }
    return false;
  }

  /** First solid overlapping the box (edges touching don't count), or null. */
  overlap(l, t, r, b) {
    let hit = null;
    this.query(l, t, r, b, s => {
      if (l < s.r && r > s.l && t < s.b && b > s.t) { hit = s; return true; }
      return false;
    });
    return hit;
  }

  /**
   * First point where the segment (x0,y0)->(x1,y1) enters a solid.
   * Returns { t, x, y, nx, ny, solid } with t in [0, 1], or null.
   */
  raycast(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    let best = null;
    this.query(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), s => {
      const h = segmentBox(x0, y0, dx, dy, s.l, s.t, s.r, s.b);
      if (h && (!best || h.t < best.t)) best = { ...h, solid: s };
      return false;
    });
    if (best) { best.x = x0 + dx * best.t; best.y = y0 + dy * best.t; }
    return best;
  }

  /** True if nothing solid blocks the straight line between two points. */
  clearLine(x0, y0, x1, y1) {
    return !this.raycast(x0, y0, x1, y1);
  }
}

/**
 * Where two boxes meet edge to edge, without overlapping: the shared part of
 * the edge. Each box is drawn as a black outline under a white fill, and two
 * fills that just meet never quite cover the pixels on the line between them
 * (each only partly covers them), so a hairline of outline shows through.
 * Drawing a thin white strip along each of these hides it.
 * boxes: [{ l, t, r, b }]. Returns [{ x, t, b } (a vertical seam) or { y, l, r } (horizontal), max]
 * where max is how far the strip can reach into either box (half the thinner one).
 */
export function seamsOf(boxes) {
  const out = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) seamBetween(boxes[i], boxes[j], out);
  return out;
}

/** The seam between boxes a and c, if they meet edge to edge (added to out). */
function seamBetween(a, c, out) {
  const meet = (p, q) => Math.abs(p - q) < 0.05;
  if (meet(a.r, c.l) || meet(c.r, a.l)) {
    const t = Math.max(a.t, c.t), b = Math.min(a.b, c.b);
    if (b - t > 0.5) out.push({ x: meet(a.r, c.l) ? a.r : a.l, t, b, max: Math.min(a.r - a.l, c.r - c.l) / 2 });
  }
  if (meet(a.b, c.t) || meet(c.b, a.t)) {
    const l = Math.max(a.l, c.l), r = Math.min(a.r, c.r);
    if (r - l > 0.5) out.push({ y: meet(a.b, c.t) ? a.b : a.t, l, r, max: Math.min(a.b - a.t, c.b - c.t) / 2 });
  }
}

const NO_HOLE = { l: 0, t: 0, r: 0, b: 0 };

/**
 * A hole h as cut out of box a: where the hole stops just short of one of a's
 * edges, it goes all the way to it instead, rather than leaving a sliver (which
 * would run the whole length of the box). One that only just touches the box
 * leaves it alone.
 */
function snapHole(a, h) {
  // Only just touching the box: leave it alone (what's left beside the hole would be a sliver).
  if (Math.min(a.r, h.r) - Math.max(a.l, h.l) < MIN_PIECE || Math.min(a.b, h.b) - Math.max(a.t, h.t) < MIN_PIECE) return NO_HOLE;
  return {
    l: h.l - a.l < MIN_PIECE ? Math.min(h.l, a.l) : h.l,
    t: h.t - a.t < MIN_PIECE ? Math.min(h.t, a.t) : h.t,
    r: a.r - h.r < MIN_PIECE ? Math.max(h.r, a.r) : h.r,
    b: a.b - h.b < MIN_PIECE ? Math.max(h.b, a.b) : h.b,
  };
}

/** Box a ({ l, t, r, b }) less box h: the (up to 4) boxes left. */
export function subtractBox(a, h) {
  if (h.l >= a.r || h.r <= a.l || h.t >= a.b || h.b <= a.t) return [a];
  const out = [];
  if (h.t > a.t) out.push({ l: a.l, t: a.t, r: a.r, b: h.t });
  if (h.b < a.b) out.push({ l: a.l, t: h.b, r: a.r, b: a.b });
  const t = Math.max(a.t, h.t), b = Math.min(a.b, h.b);
  if (h.l > a.l) out.push({ l: a.l, t, r: h.l, b });
  if (h.r < a.r) out.push({ l: h.r, t, r: a.r, b });
  return out;
}

/** seamsOf() for map data platforms ({ left, top, right, bottom }), remembered while they don't change. */
export function platformSeams(platforms) {
  const key = platforms.map(p => `${p.left},${p.top},${p.right},${p.bottom}`).join('|');
  if (platformSeams.key !== key) {
    platformSeams.key = key;
    platformSeams.seams = seamsOf(platforms.map(p => ({ l: p.left, t: p.top, r: p.right, b: p.bottom })));
  }
  return platformSeams.seams;
}

/** Fill the seams (see seamsOf) with strips reaching `w` into each box: calls rect(x, y, w, h). */
export function fillSeams(seams, w, rect) {
  for (const s of seams) {
    const k = Math.min(w, s.max);
    if (s.x !== undefined) rect(s.x - k, s.t, 2 * k, s.b - s.t);
    else rect(s.l, s.y - k, s.r - s.l, 2 * k);
  }
}

/**
 * Diagonal hatching inside a box (how indestructible blocks are shown on
 * destructible maps): lines `gap` apart, already cut to the box. Calls line(x0, y0, x1, y1).
 */
export function hatch(l, t, r, b, gap, line) {
  // Lines x - y = c, for c from (l - b) up to (r - t).
  const start = Math.ceil((l - b) / gap) * gap;
  for (let c = start; c <= r - t; c += gap) {
    // Where the line x = y + c enters and leaves the box.
    const y0 = Math.max(t, l - c), y1 = Math.min(b, r - c);
    if (y1 - y0 > 0.5) line(y0 + c, y0, y1 + c, y1);
  }
}

/**
 * Built blocks (the Engineer's Builder) are drawn as rows of sandbags: lines across
 * the box `gap` apart, with joins staggered from row to row. Calls line(x0, y0, x1, y1).
 */
export function courses(l, t, r, b, gap, line) {
  const wide = r - l >= b - t;
  if (wide) {
    for (let y = t + gap; y < b - 1; y += gap) line(l, y, r, y);
    let row = 0;
    for (let y = t; y < b - 1; y += gap, row++) {
      for (let x = l + (row % 2 ? gap : gap * 2); x < r - 2; x += gap * 3) line(x, y, x, Math.min(b, y + gap));
    }
  } else {
    for (let y = t + gap; y < b - 1; y += gap) line(l, y, r, y);
  }
}

/**
 * Segment vs box (slab method). The segment starts at (x0,y0) and moves by (dx,dy).
 * Returns { t, nx, ny } for the entry point, or null. A segment starting inside the box hits at t = 0.
 */
export function segmentBox(x0, y0, dx, dy, l, t, r, b) {
  let tmin = 0, tmax = 1, nx = 0, ny = 0;
  if (dx === 0) {
    if (x0 <= l || x0 >= r) return null;
  } else {
    let t1 = (l - x0) / dx, t2 = (r - x0) / dx, n = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = n; ny = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (dy === 0) {
    if (y0 <= t || y0 >= b) return null;
  } else {
    let t1 = (t - y0) / dy, t2 = (b - y0) / dy, n = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = n; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return { t: tmin, nx, ny };
}
