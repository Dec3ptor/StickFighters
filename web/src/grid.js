// Where the soldiers are, in a grid of cells, so "who's near here?" doesn't
// mean checking every soldier. Only used in big games: with a handful of
// soldiers, checking them all is just as quick (and keeps small games exactly
// as they were).

export const GRID_MIN = 32;   // soldiers needed before the grid is used
export const CELL = 64;       // cell size, in pixels

const key = (cx, cy) => (cx + 32768) * 65536 + (cy + 32768);

export class SoldierGrid {
  constructor() {
    this.cells = new Map();
    this.tick = -1;
  }

  /** Put every living soldier in its cell (positions as of now). */
  rebuild(soldiers, tick) {
    this.tick = tick;
    for (const list of this.cells.values()) list.length = 0;
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
    const k = key(Math.floor(s.x / CELL), Math.floor(s.y / CELL));
    let list = this.cells.get(k);
    if (!list) this.cells.set(k, list = []);
    list.push(s);
    s.gridCell = list;
  }

  /** Soldiers in the cells overlapping a box (callers still check exact positions). */
  query(l, t, r, b, out = []) {
    const c0 = Math.floor(l / CELL), c1 = Math.floor(r / CELL);
    const r0 = Math.floor(t / CELL), r1 = Math.floor(b / CELL);
    for (let cx = c0; cx <= c1; cx++) {
      for (let cy = r0; cy <= r1; cy++) {
        const list = this.cells.get(key(cx, cy));
        if (list) for (const s of list) out.push(s);
      }
    }
    return out;
  }

  /** Soldiers in the ring of cells exactly `k` cells away from cell (cx, cy). */
  ring(cx, cy, k, out = []) {
    const add = (x, y) => { const list = this.cells.get(key(x, y)); if (list) for (const s of list) out.push(s); };
    if (k === 0) { add(cx, cy); return out; }
    for (let x = cx - k; x <= cx + k; x++) { add(x, cy - k); add(x, cy + k); }
    for (let y = cy - k + 1; y <= cy + k - 1; y++) { add(cx - k, y); add(cx + k, y); }
    return out;
  }
}
