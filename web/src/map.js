// A playable map built from the decoded Stick Soldiers II map JSON.
// Coordinates are map pixels with y pointing down.

const CELL = 64;

export class GameMap {
  constructor(data) {
    this.name = data.name;
    this.bounds = { ...data.bounds };
    this.solids = data.platforms.map((p, i) => ({
      id: i, l: p.left, t: p.top, r: p.right, b: p.bottom, bounce: p.bounce || 0,
    }));
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
    this._seen = new Int32Array(this.solids.length);
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
