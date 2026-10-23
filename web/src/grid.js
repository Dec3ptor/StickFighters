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
    // Each cell's soldiers: the first counts[i] of cells[i] (null until someone's been there).
    // A cell is emptied by setting its count to 0, so its list keeps its room: shortening a
    // list would make V8 let the room go, and make it again as soldiers are put back.
    this.cells = new Array(this.cols * this.rows).fill(null);
    this.counts = new Int32Array(this.cols * this.rows);
    // The cells that have had someone put in them since the last rebuild (the only ones it
    // empties): the first `filledCount` of `filled`.
    this.filled = [];
    this.filledCount = 0;
    this.tick = -1;
  }

  /** Put every living soldier in its cell (positions as of now). */
  rebuild(soldiers, tick) {
    this.tick = tick;
    const filled = this.filled, counts = this.counts;
    for (let i = 0; i < this.filledCount; i++) counts[filled[i]] = 0;
    this.filledCount = 0;
    for (let i = 0; i < soldiers.length; i++) {
      const s = soldiers[i];
      s.gridCell = -1;
      if (s.alive) this.place(s);
    }
  }

  /** Put a soldier in the cell where it is now (after a respawn or teleport mid-update). */
  place(s) {
    const counts = this.counts;
    if (s.gridCell >= 0) {
      // (Out of the cell they were in, the others there keeping their order.)
      const c = s.gridCell, list = this.cells[c], n = counts[c];
      for (let j = 0; j < n; j++) {
        if (list[j] !== s) continue;
        for (let k = j + 1; k < n; k++) list[k - 1] = list[k];
        counts[c] = n - 1;
        break;
      }
    }
    const b = s.body;
    const x = Math.min(this.cols - 1, Math.max(0, Math.floor(b.x / CELL) - this.cx0));
    const y = Math.min(this.rows - 1, Math.max(0, Math.floor(b.y / CELL) - this.cy0));
    const i = y * this.cols + x;
    let list = this.cells[i];
    if (!list) list = this.cells[i] = [];
    const n = counts[i];
    if (n === 0) this.filled[this.filledCount++] = i;
    list[n] = s;
    counts[i] = n + 1;
    s.gridCell = i;
  }

  /** Soldiers in the cells overlapping a box, added to `out` (callers still check exact positions). */
  query(l, t, r, b, out = []) {
    const c0 = Math.max(0, Math.floor(l / CELL) - this.cx0), c1 = Math.min(this.cols - 1, Math.floor(r / CELL) - this.cx0);
    const r0 = Math.max(0, Math.floor(t / CELL) - this.cy0), r1 = Math.min(this.rows - 1, Math.floor(b / CELL) - this.cy0);
    const cells = this.cells, counts = this.counts, cols = this.cols;
    for (let x = c0; x <= c1; x++) {
      for (let y = r0; y <= r1; y++) {
        const i = y * cols + x, list = cells[i];
        if (list) for (let j = 0, n = counts[i]; j < n; j++) out.push(list[j]);
      }
    }
    return out;
  }

  /**
   * query() without making a list: the soldiers are written into `out` from the start, and
   * this returns how many (out[0] to out[n - 1]; what's after is left over from before, so
   * the list keeps its room).
   */
  queryInto(l, t, r, b, out) {
    const c0 = Math.max(0, Math.floor(l / CELL) - this.cx0), c1 = Math.min(this.cols - 1, Math.floor(r / CELL) - this.cx0);
    const r0 = Math.max(0, Math.floor(t / CELL) - this.cy0), r1 = Math.min(this.rows - 1, Math.floor(b / CELL) - this.cy0);
    const cells = this.cells, counts = this.counts, cols = this.cols;
    let n = 0;
    for (let x = c0; x <= c1; x++) {
      for (let y = r0; y <= r1; y++) {
        const i = y * cols + x, list = cells[i];
        if (list) for (let j = 0, m = counts[i]; j < m; j++) out[n++] = list[j];
      }
    }
    return n;
  }

  /** Soldiers in the ring of cells exactly `k` cells away from cell (cx, cy), added to `out`. */
  ring(cx, cy, k, out = []) {
    if (k === 0) { this._add(cx, cy, out); return out; }
    for (let x = cx - k; x <= cx + k; x++) { this._add(x, cy - k, out); this._add(x, cy + k, out); }
    for (let y = cy - k + 1; y <= cy + k - 1; y++) { this._add(cx - k, y, out); this._add(cx + k, y, out); }
    return out;
  }

  /** The soldiers in cell (cx, cy) (cell coordinates), added to `out`. */
  _add(cx, cy, out) {
    const x = cx - this.cx0, y = cy - this.cy0;
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const i = y * this.cols + x, list = this.cells[i];
    if (list) for (let j = 0, n = this.counts[i]; j < n; j++) out.push(list[j]);
  }
}
