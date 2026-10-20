// Where the soldiers are, in a grid of cells, so "who's near here?" doesn't
// mean checking every soldier. Only used in big games: with a handful of
// soldiers, checking them all is just as quick (and keeps small games exactly
// as they were).

export const GRID_MIN = 32;   // soldiers needed before the grid is used
export const CELL = 64;       // cell size, in pixels

export class SoldierGrid {
  /**
   * bounds: the map's { left, top, right, bottom }. The grid covers it (and a margin);
   * anyone beyond that counts as being in the nearest edge cell.
   */
  constructor(bounds = { left: -4096, top: -4096, right: 4096, bottom: 4096 }) {
    const m = 4 * CELL;
    this.cx0 = Math.floor((bounds.left - m) / CELL);
    this.cy0 = Math.floor((bounds.top - m) / CELL);
    this.cols = Math.floor((bounds.right + m) / CELL) - this.cx0 + 1;
    this.rows = Math.floor((bounds.bottom + m) / CELL) - this.cy0 + 1;
    // Each cell's soldiers (null until someone's been there).
    this.cells = new Array(this.cols * this.rows).fill(null);
    this.used = [];
    this.tick = -1;
  }

  /** The cell list at cell coordinates (cx, cy), or null (none there yet, or off the grid). */
  _at(cx, cy) {
    const x = cx - this.cx0, y = cy - this.cy0;
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return null;
    return this.cells[y * this.cols + x];
  }

  /** Put every living soldier in its cell (positions as of now). */
  rebuild(soldiers, tick) {
    this.tick = tick;
    for (const list of this.used) list.length = 0;
    for (const s of soldiers) {
      s.gridCell = null;
      if (s.alive) this.place(s);
    }
  }

  /** Put a soldier in the cell where it is now (after a respawn or teleport mid-update). */
  place(s) {
    if (s.gridCell) {
      const i = s.gridCell.indexOf(s);
      if (i >= 0) s.gridCell.splice(i, 1);
    }
    const x = Math.min(this.cols - 1, Math.max(0, Math.floor(s.x / CELL) - this.cx0));
    const y = Math.min(this.rows - 1, Math.max(0, Math.floor(s.y / CELL) - this.cy0));
    const i = y * this.cols + x;
    let list = this.cells[i];
    if (!list) { list = this.cells[i] = []; this.used.push(list); }
    list.push(s);
    s.gridCell = list;
  }

  /** Soldiers in the cells overlapping a box (callers still check exact positions). */
  query(l, t, r, b, out = []) {
    const c0 = Math.max(0, Math.floor(l / CELL) - this.cx0), c1 = Math.min(this.cols - 1, Math.floor(r / CELL) - this.cx0);
    const r0 = Math.max(0, Math.floor(t / CELL) - this.cy0), r1 = Math.min(this.rows - 1, Math.floor(b / CELL) - this.cy0);
    for (let x = c0; x <= c1; x++) {
      for (let y = r0; y <= r1; y++) {
        const list = this.cells[y * this.cols + x];
        if (list) for (const s of list) out.push(s);
      }
    }
    return out;
  }

  /** Soldiers in the ring of cells exactly `k` cells away from cell (cx, cy). */
  ring(cx, cy, k, out = []) {
    if (k === 0) { this._add(cx, cy, out); return out; }
    for (let x = cx - k; x <= cx + k; x++) { this._add(x, cy - k, out); this._add(x, cy + k, out); }
    for (let y = cy - k + 1; y <= cy + k - 1; y++) { this._add(cx - k, y, out); this._add(cx + k, y, out); }
    return out;
  }

  _add(cx, cy, out) {
    const list = this._at(cx, cy);
    if (list) for (const s of list) out.push(s);
  }
}
