// Building maps in code, for the maps that come with the game (web/data/maps/).
// A map is just boxes; these helpers place floors, walls, steps and jump pads,
// and put spawn points, items and objectives on the floor they stand on.
//
// Each map is a script in tools/maps/designs/ that exports a function
// returning a MapBuilder; `node tools/maps/build.mjs` writes them all out.
// Check one with `node tools/maps/check.mjs <name>` and look at it with
// `node tools/maps/preview.mjs <name>`.
//
// Handy numbers (the game's physics, see web/src/config.js):
//   A jump climbs about 168 px and carries about 186 px sideways.
//   Soldiers walk up steps up to 10 px high without jumping.
//   Soldiers are 34 px tall (12 crouching less), 12 px wide.
//   A jump pad of strength 7 launches about 3.5x higher than a jump.
//   Falling more than 160 px below the map's bounds kills.

import { normalizeMap } from '../../web/src/custommaps.js';

export const T = 24; // standard floor thickness

export class MapBuilder {
  constructor(name) {
    this.name = name;
    this.platforms = [];
    this.spawns = [];
    this.items = [];
    this.objectives = [];
    this.loadout = null;
  }

  /** A solid box. */
  box(left, top, right, bottom) {
    this.platforms.push({ left, top, right, bottom });
    return this;
  }

  /** A floor from x = l to r, with its top at y. */
  floor(l, r, y, thick = T) { return this.box(l, y, r, y + thick); }

  /** A wall with its left edge at x, from top to bottom. */
  wall(x, top, bottom, width = T) { return this.box(x, top, x + width, bottom); }

  /** A jump pad (strength 2-12; 7 is standard) from l to r with its top at y. */
  pad(l, r, y, strength = 7, thick = 12) {
    this.platforms.push({ left: l, top: y, right: r, bottom: y + thick, bounce: -strength });
    return this;
  }

  /**
   * Steps: `n` floors each `w` wide, starting with the top at (x, y) and
   * moving `dx` across and `dy` down (negative dy climbs) each step.
   */
  steps(x, y, n, dx, dy, w, thick = T) {
    for (let i = 0; i < n; i++) {
      const sx = x + dx * i;
      this.floor(Math.min(sx, sx + w), Math.max(sx, sx + w), y + dy * i, thick);
    }
    return this;
  }

  /** A spawn point for a soldier standing on the floor at floorY. sector: Rush only. */
  spawn(x, floorY, team, sector) {
    this.spawns.push(sector ? { x, y: floorY - 30, team, sector } : { x, y: floorY - 30, team });
    return this;
  }

  /** An item floating over the floor at floorY: 'health', 'armour', 'jetpack', or a weapon id. */
  item(what, x, floorY) {
    const y = floorY - 26;
    if (['health', 'armour', 'jetpack'].includes(what)) this.items.push({ type: what, x, y });
    else this.items.push({ type: 'weapon', x, y, weapon: what });
    return this;
  }

  /** King of the hill: an area from l to r, standing on the floor at floorY. */
  hill(l, r, floorY, h = 90) {
    this.objectives.push({ type: 'hill', left: l, top: floorY - h, right: r, bottom: floorY });
    return this;
  }

  /** Capture the flag: a team's flag stand on the floor at floorY. */
  flag(team, x, floorY) {
    this.objectives.push({ type: 'flag', team, x, y: floorY });
    return this;
  }

  /** Conquest: a capture point from l to r, standing on the floor at floorY. */
  point(label, l, r, floorY, h = 100) {
    this.objectives.push({ type: 'point', label, left: l, top: floorY - h, right: r, bottom: floorY });
    return this;
  }

  /** Rush: an M-COM station on the floor at floorY, in a sector (1 falls first). */
  mcom(sector, x, floorY) {
    this.objectives.push({ type: 'mcom', sector, x, y: floorY });
    return this;
  }

  /**
   * Copy everything added so far, mirrored across x = cx: platforms, items,
   * spawn points and flags (with the teams swapped). Hills, capture points
   * and M-COMs aren't copied (place those yourself).
   */
  mirror(cx = 0) {
    const mx = x => 2 * cx - x;
    for (const p of [...this.platforms]) {
      if (Math.abs(p.left + p.right - 2 * cx) < 0.5) continue; // centred: already symmetric
      this.platforms.push({ ...p, left: mx(p.right), right: mx(p.left) });
    }
    for (const s of [...this.spawns]) this.spawns.push({ ...s, x: mx(s.x), team: 3 - s.team });
    for (const it of [...this.items]) if (Math.abs(it.x - cx) > 0.5) this.items.push({ ...it, x: mx(it.x) });
    for (const o of [...this.objectives]) if (o.type === 'flag') this.objectives.push({ ...o, x: mx(o.x), team: 3 - o.team });
    return this;
  }

  /** The finished map data (checked and tidied like any custom map). */
  build() {
    return normalizeMap({
      name: this.name, platforms: this.platforms, spawns: this.spawns, items: this.items,
      objectives: this.objectives, ...(this.loadout ? { loadout: this.loadout } : {}),
    });
  }
}
