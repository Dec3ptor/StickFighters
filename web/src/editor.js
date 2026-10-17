// The map maker: draw platforms and jump pads, place spawn points and pickups,
// check the map, and play it with bots. Maps save automatically in the browser.

import { normalizeMap, computeBounds, checkMap, encodeShare, encodeSSM, decodeSSM, BOUNCE, LIMITS } from './custommaps.js';
import { listMaps, getMap, saveMap, deleteMap } from './mapstore.js';
import { WEAPONS, PICKUP_WEAPONS, SLOTS } from './weapons.js';
import { drawWeapon, drawHealth, drawArmour, drawJetpack } from './render.js';
import { RULES } from './config.js';

const TOOLS = [
  { id: 'select', label: 'Select', key: 'KeyV', short: 'V', hint: 'Click to select. Drag to move, drag the corner squares to resize. Drag empty space to move the view.' },
  { id: 'platform', label: 'Platform', key: 'KeyP', short: 'P', hint: 'Drag to draw a platform.' },
  { id: 'pad', label: 'Jump pad', key: 'KeyJ', short: 'J', hint: 'Drag to draw a jump pad. Set how strong it is on the right.' },
  { id: 'spawn', label: 'Spawn', key: 'KeyS', short: 'S', hint: 'Click to place a spawn point. Pick blue or red team on the right.' },
  { id: 'weapon', label: 'Weapon', key: 'KeyW', short: 'W', hint: 'Click to place a weapon. Pick which one on the right.' },
  { id: 'health', label: 'Health', key: 'KeyH', short: 'H', hint: 'Click to place a health pack.' },
  { id: 'armour', label: 'Armour', key: 'KeyA', short: 'A', hint: 'Click to place armour.' },
  { id: 'jetpack', label: 'Jetpack', key: 'KeyK', short: 'K', hint: 'Click to place a jetpack.' },
];
const ITEM_TOOLS = new Set(['weapon', 'health', 'armour', 'jetpack']);
const GRIDS = [8, 16, 32, 0];
const TEAM_COLORS = { 1: '#2f6fdb', 2: '#d33b2f' };
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A starting map with a floor and two spawn points, so test play works straight away. */
export function blankMap() {
  return {
    name: 'New map',
    platforms: [{ left: -400, top: 200, right: 400, bottom: 240 }],
    spawns: [{ x: -300, y: 176, team: 1 }, { x: 300, y: 176, team: 2 }],
    items: [],
  };
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Editor {
  /**
   * opts: { root, originals: [{ name, data }], onExit(), onTestPlay(record), onChanged(), onUpload(record) -> { relays } }
   */
  constructor(opts) {
    this.opts = opts;
    this.root = opts.root;
    this.$ = sel => this.root.querySelector(sel);
    this.canvas = this.$('#edCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.view = { x: 0, y: 0, zoom: 1 };
    this.tool = 'select';
    this.team = 1;
    this.weapon = 'M4';
    this.grid = 8;
    this.sitOnFloor = true;
    this.sel = null;
    this.hover = null;
    this.drag = null;
    this.mouse = { x: 0, y: 0, wx: 0, wy: 0, inside: false };
    this.undoStack = [];
    this.redoStack = [];
    this.check = null;
    this.flash = null;
    this.spaceDown = false;
    this.active = false;
    // Mirror editing: changes on one side of the line are copied to the other.
    this.mirror = { on: false, x: 0, swapTeams: true, placed: false };
    this.loadoutOpen = false;
    this.buildToolbar();
    this.wire();
    new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement);
  }

  // ---- Opening and saving ----------------------------------------------------

  open(record) {
    if (!record) record = this.createRecord(blankMap());
    this.record = record;
    this.map = JSON.parse(JSON.stringify({ name: record.data.name, platforms: record.data.platforms, spawns: record.data.spawns, items: record.data.items, loadout: record.data.loadout || null }));
    this.mirror.placed = false;
    if (this.mirror.on) this.centreMirror();
    this.undoStack = [];
    this.redoStack = [];
    this.sel = null;
    this.check = null;
    this.$('#edName').value = this.map.name;
    this.setStatus('Saved');
    this.active = true;
    this.root.classList.remove('hidden');
    this.resize();
    this.fit();
    this.refreshPanel();
    this.loop();
  }

  close() {
    this.active = false;
    this.root.classList.add('hidden');
    this.saveNow();
  }

  createRecord(data, name) {
    const clean = normalizeMap({ ...data, name: name || data.name });
    return saveMap({ name: clean.name, data: clean }) || { id: null, name: clean.name, data: clean };
  }

  /** Called after every change: autosave shortly after, clear the old check. */
  changed() {
    this.check = null;
    this.setStatus('Saving…');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 400);
    this.refreshPanel();
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    if (!this.record) return;
    let clean;
    try { clean = normalizeMap(this.map); }
    catch (e) { this.setStatus(`Not saved: ${e.message}`, true); return; }
    const rec = saveMap({ id: this.record.id, name: clean.name, data: clean });
    if (!rec) { this.setStatus('Not saved: browser storage is full', true); return; }
    this.record = rec;
    this.setStatus('Saved');
    this.opts.onChanged?.();
  }

  setStatus(text, bad) {
    const el = this.$('#edStatus');
    el.textContent = text;
    el.classList.toggle('bad', !!bad);
  }

  // ---- Undo ------------------------------------------------------------------

  remember() {
    this.undoStack.push(JSON.stringify(this.map));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.map));
    this.map = JSON.parse(this.undoStack.pop());
    this.sel = null;
    this.$('#edName').value = this.map.name;
    this.changed();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.map));
    this.map = JSON.parse(this.redoStack.pop());
    this.sel = null;
    this.$('#edName').value = this.map.name;
    this.changed();
  }

  // ---- View ------------------------------------------------------------------

  resize() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(100, box.width);
    this.h = Math.max(100, box.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  toScreen(x, y) { return [(x - this.view.x) * this.view.zoom + this.w / 2, (y - this.view.y) * this.view.zoom + this.h / 2]; }
  toWorld(sx, sy) { return [(sx - this.w / 2) / this.view.zoom + this.view.x, (sy - this.h / 2) / this.view.zoom + this.view.y]; }

  /** Zoom to show the whole map. */
  fit() {
    const b = computeBounds(this.map.platforms, this.map.spawns, this.map.items, 60);
    this.view.x = (b.left + b.right) / 2;
    this.view.y = (b.top + b.bottom) / 2;
    this.view.zoom = Math.max(0.15, Math.min(2.5, Math.min(this.w / (b.right - b.left), this.h / (b.bottom - b.top))));
  }

  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.view.zoom = Math.max(0.15, Math.min(4, this.view.zoom * factor));
    const [nx, ny] = this.toWorld(sx, sy);
    this.view.x += wx - nx;
    this.view.y += wy - ny;
  }

  snap(v) { return this.grid ? Math.round(v / this.grid) * this.grid : Math.round(v); }

  /** The top of the platform under (x, y), if one is within reach below. */
  floorBelow(x, y, reach = 140) {
    let best = null;
    for (const p of this.map.platforms) {
      if (x < p.left || x > p.right || p.top < y - 4 || p.top > y + reach) continue;
      if (best === null || p.top < best) best = p.top;
    }
    return best;
  }

  /** Where a click places a spawn point or item: on the grid, sitting on the floor below if that's turned on. */
  placeAt(wx, wy, kind) {
    const x = this.snap(wx);
    let y = this.snap(wy);
    if (this.sitOnFloor) {
      const floor = this.floorBelow(x, y - 20);
      if (floor !== null) y = floor - (kind === 'spawn' ? 24 : 20);
    }
    return [x, y];
  }

  // ---- Finding things under the mouse ------------------------------------------

  objectAt(wx, wy) {
    const r = Math.max(8, 9 / this.view.zoom);
    const its = this.map.items;
    for (let i = its.length - 1; i >= 0; i--) if (Math.abs(its[i].x - wx) <= r && Math.abs(its[i].y - wy) <= r) return { kind: 'item', i };
    const sp = this.map.spawns;
    for (let i = sp.length - 1; i >= 0; i--) if (Math.abs(sp[i].x - wx) <= r && wy >= sp[i].y - 24 && wy <= sp[i].y + 12) return { kind: 'spawn', i };
    const pl = this.map.platforms;
    const e = 2 / this.view.zoom;
    for (const wantPad of [true, false]) {
      for (let i = pl.length - 1; i >= 0; i--) {
        const p = pl[i];
        if (!!p.bounce !== wantPad) continue;
        if (wx >= p.left - e && wx <= p.right + e && wy >= p.top - e && wy <= p.bottom + e) return { kind: 'platform', i };
      }
    }
    return null;
  }

  handlePoints(p) {
    const mx = (p.left + p.right) / 2, my = (p.top + p.bottom) / 2;
    return { nw: [p.left, p.top], n: [mx, p.top], ne: [p.right, p.top], e: [p.right, my], se: [p.right, p.bottom], s: [mx, p.bottom], sw: [p.left, p.bottom], w: [p.left, my] };
  }

  handleAt(sx, sy) {
    if (this.sel?.kind !== 'platform') return null;
    const pts = this.handlePoints(this.map.platforms[this.sel.i]);
    for (const h of HANDLES) {
      const [hx, hy] = this.toScreen(...pts[h]);
      if (Math.abs(hx - sx) <= 6 && Math.abs(hy - sy) <= 6) return h;
    }
    return null;
  }

  selected() {
    if (!this.sel) return null;
    const list = { platform: this.map.platforms, spawn: this.map.spawns, item: this.map.items }[this.sel.kind];
    return list[this.sel.i] || null;
  }

  // ---- Editing -----------------------------------------------------------------

  select(sel) {
    this.sel = sel;
    this.refreshPanel();
  }

  deleteSelected() {
    if (!this.sel || !this.selected()) return;
    this.remember();
    const twin = this.selectedTwin();
    const list = this.listOf(this.sel.kind);
    for (const i of [this.sel.i, twin].filter(i => i >= 0).sort((a, b) => b - a).filter((v, k, a) => a.indexOf(v) === k)) list.splice(i, 1);
    this.sel = null;
    this.changed();
  }

  duplicateSelected() {
    const o = this.selected();
    if (!o) return;
    this.remember();
    const step = this.grid || 16;
    const copy = JSON.parse(JSON.stringify(o));
    if (this.sel.kind === 'platform') { copy.left += step * 2; copy.right += step * 2; copy.top += step * 2; copy.bottom += step * 2; }
    else { copy.x += step * 2; }
    const list = this.listOf(this.sel.kind);
    const twin = this.selectedTwin();
    list.push(copy);
    const sel = { kind: this.sel.kind, i: list.length - 1 };
    if (twin >= 0 && twin !== this.sel.i) list.push(this.mirrored(this.sel.kind, copy));
    this.sel = sel;
    this.changed();
  }

  nudge(dx, dy) {
    const o = this.selected();
    if (!o) return;
    this.remember();
    const twin = this.selectedTwin();
    if (this.sel.kind === 'platform') { o.left += dx; o.right += dx; o.top += dy; o.bottom += dy; }
    else { o.x += dx; o.y += dy; }
    this.syncTwin(twin);
    this.changed();
  }

  placePoint(wx, wy) {
    const tool = this.tool;
    if (tool === 'spawn') {
      if (this.map.spawns.length >= LIMITS.maxSpawns) return this.setStatus(`At most ${LIMITS.maxSpawns} spawn points`, true);
      const [x, y] = this.placeAt(wx, wy, 'spawn');
      this.remember();
      this.map.spawns.push({ x, y, team: this.team });
      this.sel = { kind: 'spawn', i: this.map.spawns.length - 1 };
      if (this.mirror.on && x !== this.mirror.x) this.map.spawns.push(this.mirrored('spawn', { x, y, team: this.team }));
    } else {
      if (this.map.items.length >= LIMITS.maxItems) return this.setStatus(`At most ${LIMITS.maxItems} items`, true);
      const [x, y] = this.placeAt(wx, wy, 'item');
      this.remember();
      const it = { type: tool, x, y };
      if (tool === 'weapon') it.weapon = this.weapon;
      this.map.items.push(it);
      this.sel = { kind: 'item', i: this.map.items.length - 1 };
      if (this.mirror.on && x !== this.mirror.x) this.map.items.push(this.mirrored('item', it));
    }
    this.changed();
  }

  // ---- Mirror editing --------------------------------------------------------------

  listOf(kind) { return { platform: this.map.platforms, spawn: this.map.spawns, item: this.map.items }[kind]; }

  mx(x) { return 2 * this.mirror.x - x; }

  /** The object as it would be on the other side of the mirror line. */
  mirrored(kind, o) {
    if (kind === 'platform') return { ...o, left: this.mx(o.right), right: this.mx(o.left) };
    if (kind === 'spawn') return { ...o, x: this.mx(o.x), team: this.mirror.swapTeams ? 3 - o.team : o.team };
    return { ...o, x: this.mx(o.x) };
  }

  /** Index of the object mirroring list[i]: i itself if it sits across the line, -1 if it has no twin. */
  twinIndex(kind, i) {
    const list = this.listOf(kind), o = list[i];
    if (!o) return -1;
    const m = this.mirrored(kind, o);
    const near = (a, b) => Math.abs(a - b) < 0.6;
    const same = q => kind === 'platform'
      ? near(q.left, m.left) && near(q.right, m.right) && near(q.top, m.top) && near(q.bottom, m.bottom) && !!q.bounce === !!o.bounce
      : near(q.x, m.x) && near(q.y, m.y) && (kind === 'spawn' || (q.type === o.type && q.weapon === o.weapon));
    if (same(o)) return i;
    return list.findIndex((q, j) => j !== i && same(q));
  }

  /** The current selection's twin (only while mirror editing is on). */
  selectedTwin() {
    return this.mirror.on && this.sel ? this.twinIndex(this.sel.kind, this.sel.i) : -1;
  }

  /** Copy the selected object's changes to its twin (or keep a self-mirrored platform centred). */
  syncTwin(twin, handle = null) {
    if (!this.sel || twin < 0) return;
    const kind = this.sel.kind, list = this.listOf(kind), o = list[this.sel.i];
    if (twin === this.sel.i) {
      if (kind === 'platform') {
        if (handle?.includes('w')) o.right = this.mx(o.left);
        else if (handle?.includes('e')) o.left = this.mx(o.right);
        else { const w = o.right - o.left; o.left = this.mirror.x - w / 2; o.right = this.mirror.x + w / 2; }
        if (o.left > o.right) [o.left, o.right] = [o.right, o.left];
      } else o.x = this.mirror.x;
      return;
    }
    list[twin] = this.mirrored(kind, o);
  }

  /** Put the mirror line in the middle of the map (on the grid). */
  centreMirror() {
    const b = computeBounds(this.map.platforms, this.map.spawns, this.map.items, 0);
    this.mirror.x = this.map.platforms.length ? this.snap((b.left + b.right) / 2) : 0;
    this.mirror.placed = true;
  }

  toggleMirror(on = !this.mirror.on) {
    this.mirror.on = on;
    if (on && !this.mirror.placed) this.centreMirror();
    this.refreshPanel();
  }

  /** Copy the selected object to the other side of the mirror line. */
  mirrorSelection() {
    const o = this.selected();
    if (!o) return;
    if (!this.mirror.placed) this.centreMirror();
    if (this.twinIndex(this.sel.kind, this.sel.i) >= 0) return this.setStatus('Already mirrored');
    this.remember();
    const list = this.listOf(this.sel.kind);
    list.push(this.mirrored(this.sel.kind, o));
    this.changed();
  }

  /** Rebuild one half of the map as a mirror image of the other ('right' copies left to right). */
  copySide(to) {
    if (!this.mirror.placed) this.centreMirror();
    const m = this.mirror.x;
    const fromLeft = to === 'right';
    const keepSide = (a, b) => (fromLeft ? b <= m : a >= m);   // wholly on the source side
    const otherSide = (a, b) => (fromLeft ? a >= m : b <= m);  // wholly on the copied-to side
    this.remember();
    const plats = [];
    for (const p of this.map.platforms) {
      if (otherSide(p.left, p.right) && !(p.left === m && p.right === m)) continue;
      if (keepSide(p.left, p.right)) { plats.push(p, this.mirrored('platform', p)); continue; }
      // Across the line: keep the source half and mirror it.
      const half = fromLeft ? p.left : p.right;
      plats.push({ ...p, left: Math.min(half, this.mx(half)), right: Math.max(half, this.mx(half)) });
    }
    this.map.platforms = plats;
    for (const kind of ['spawn', 'item']) {
      const list = this.listOf(kind), out = [];
      for (const q of list) {
        if (q.x === m) { out.push(q); continue; }
        if (fromLeft ? q.x < m : q.x > m) out.push(q, this.mirrored(kind, q));
      }
      if (kind === 'spawn') this.map.spawns = out; else this.map.items = out;
    }
    this.sel = null;
    this.changed();
    this.setStatus(`Copied the ${fromLeft ? 'left' : 'right'} side to the ${fromLeft ? 'right' : 'left'}`);
  }

  // ---- Mouse and keyboard --------------------------------------------------------

  wire() {
    const cv = this.canvas;
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('mousedown', e => {
      const [sx, sy] = pos(e);
      const [wx, wy] = this.toWorld(sx, sy);
      cv.focus();
      if (e.button === 1 || e.button === 2 && !this.objectAt(wx, wy) || this.spaceDown) {
        this.drag = { mode: 'pan', sx, sy, vx: this.view.x, vy: this.view.y };
        e.preventDefault();
        return;
      }
      if (e.button === 2) {
        // Right-click deletes whatever is under the mouse.
        this.sel = this.objectAt(wx, wy);
        this.deleteSelected();
        return;
      }
      if (e.button !== 0) return;
      if (this.tool === 'select') {
        const h = this.handleAt(sx, sy);
        if (h) {
          this.remember();
          this.drag = { mode: 'resize', handle: h, orig: { ...this.selected() }, before: this.undoStack[this.undoStack.length - 1], twin: this.selectedTwin() };
          return;
        }
        const hit = this.objectAt(wx, wy);
        if (hit) {
          this.select(hit);
          this.remember();
          this.drag = { mode: 'move', wx, wy, orig: { ...this.selected() }, before: this.undoStack[this.undoStack.length - 1], twin: this.selectedTwin() };
        } else {
          this.select(null);
          this.drag = { mode: 'pan', sx, sy, vx: this.view.x, vy: this.view.y };
        }
      } else if (this.tool === 'platform' || this.tool === 'pad') {
        if (this.map.platforms.length >= LIMITS.maxPlatforms) return this.setStatus(`At most ${LIMITS.maxPlatforms} platforms`, true);
        this.drag = { mode: 'create', x0: this.snap(wx), y0: this.snap(wy), x1: this.snap(wx), y1: this.snap(wy) };
      } else {
        this.placePoint(wx, wy);
      }
    });

    window.addEventListener('mousemove', e => {
      if (!this.active) return;
      const [sx, sy] = pos(e);
      const [wx, wy] = this.toWorld(sx, sy);
      Object.assign(this.mouse, { x: sx, y: sy, wx, wy, inside: sx >= 0 && sy >= 0 && sx <= this.w && sy <= this.h });
      const d = this.drag;
      if (!d) {
        this.hover = this.tool === 'select' ? this.objectAt(wx, wy) : null;
        const h = this.tool === 'select' && this.handleAt(sx, sy);
        cv.style.cursor = this.spaceDown ? 'grab' : h ? (h === 'n' || h === 's' ? 'ns-resize' : h === 'e' || h === 'w' ? 'ew-resize' : h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize')
          : this.tool === 'select' ? (this.hover ? 'move' : 'default') : 'crosshair';
        return;
      }
      if (d.mode === 'pan') {
        this.view.x = d.vx - (sx - d.sx) / this.view.zoom;
        this.view.y = d.vy - (sy - d.sy) / this.view.zoom;
      } else if (d.mode === 'create') {
        d.x1 = this.snap(wx); d.y1 = this.snap(wy);
      } else if (d.mode === 'move') {
        const o = this.selected(), dx = wx - d.wx, dy = wy - d.wy;
        if (this.sel.kind === 'platform') {
          const nl = this.snap(d.orig.left + dx), nt = this.snap(d.orig.top + dy);
          o.left = nl; o.top = nt; o.right = nl + (d.orig.right - d.orig.left); o.bottom = nt + (d.orig.bottom - d.orig.top);
        } else {
          o.x = this.snap(d.orig.x + dx); o.y = this.snap(d.orig.y + dy);
        }
        this.syncTwin(d.twin);
        this.refreshPanelValues();
      } else if (d.mode === 'resize') {
        const o = this.selected(), h = d.handle, min = 8;
        const x = this.snap(wx), y = this.snap(wy);
        if (h.includes('w')) o.left = Math.min(x, d.orig.right - min);
        if (h.includes('e')) o.right = Math.max(x, d.orig.left + min);
        if (h.includes('n')) o.top = Math.min(y, d.orig.bottom - min);
        if (h.includes('s')) o.bottom = Math.max(y, d.orig.top + min);
        this.syncTwin(d.twin, h);
        this.refreshPanelValues();
      }
    });

    window.addEventListener('mouseup', () => {
      const d = this.drag;
      if (!d || !this.active) return;
      this.drag = null;
      if (d.mode === 'create') {
        const l = Math.min(d.x0, d.x1), r = Math.max(d.x0, d.x1), t = Math.min(d.y0, d.y1), b = Math.max(d.y0, d.y1);
        if (r - l < 4 || b - t < 4) return;
        this.remember();
        const p = { left: l, top: t, right: r, bottom: b };
        if (this.tool === 'pad') p.bounce = -(this.padStrength || BOUNCE.standard);
        const m = this.mirror.x;
        if (this.mirror.on && l < m && r > m) {
          // Drawn across the mirror line: make it symmetric.
          p.left = Math.min(l, this.mx(r)); p.right = Math.max(r, this.mx(l));
        }
        this.map.platforms.push(p);
        this.sel = { kind: 'platform', i: this.map.platforms.length - 1 };
        if (this.mirror.on && !(p.left < m && p.right > m) && !(p.left === this.mx(p.right))) this.map.platforms.push(this.mirrored('platform', p));
        this.changed();
      } else if (d.mode === 'move' || d.mode === 'resize') {
        // Nothing actually moved: forget the undo step.
        if (JSON.stringify(this.map) === d.before) this.undoStack.pop();
        else this.changed();
      }
    });

    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const [sx, sy] = pos(e);
      this.zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    window.addEventListener('keydown', e => {
      if (!this.active || this.root.querySelector('dialog[open]')) return;
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === 'KeyZ' && !typing) { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if (mod && e.code === 'KeyY' && !typing) { e.preventDefault(); this.redo(); return; }
      if (mod && e.code === 'KeyD' && !typing) { e.preventDefault(); this.duplicateSelected(); return; }
      if (typing || mod || e.altKey) return;
      if (e.code === 'Space') { this.spaceDown = true; e.preventDefault(); return; }
      if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); this.deleteSelected(); return; }
      if (e.code === 'Escape') { this.drag = null; this.select(null); this.setTool('select'); return; }
      if (e.code === 'KeyF') { this.fit(); return; }
      if (e.code === 'KeyG') { this.grid = GRIDS[(GRIDS.indexOf(this.grid) + 1) % GRIDS.length]; this.refreshPanel(); return; }
      if (e.code === 'KeyM') { this.toggleMirror(); return; }
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[e.code] && this.sel) {
        e.preventDefault();
        const step = (this.grid || 1) * (e.shiftKey ? 4 : 1);
        this.nudge(arrows[e.code][0] * step, arrows[e.code][1] * step);
        return;
      }
      const tool = TOOLS.find(t => t.key === e.code);
      if (tool) this.setTool(tool.id);
    });
    window.addEventListener('keyup', e => { if (e.code === 'Space') this.spaceDown = false; });

    // Top bar
    this.$('#edName').addEventListener('input', () => {
      this.map.name = this.$('#edName').value.slice(0, LIMITS.nameLength);
      this.changed();
    });
    this.$('#edBack').addEventListener('click', () => { this.close(); this.opts.onExit(this.record); });
    this.$('#edUndo').addEventListener('click', () => this.undo());
    this.$('#edRedo').addEventListener('click', () => this.redo());
    this.$('#edFit').addEventListener('click', () => this.fit());
    this.$('#edCheck').addEventListener('click', () => this.runCheck());
    this.$('#edTest').addEventListener('click', () => this.testPlay());

    // Files
    this.$('#edNew').addEventListener('click', () => { this.saveNow(); this.open(this.createRecord(blankMap())); });
    this.$('#edOpen').addEventListener('click', () => this.showOpenDialog());
    this.$('#edCopy').addEventListener('click', () => { this.saveNow(); this.open(this.createRecord(this.map, `Copy of ${this.map.name}`.slice(0, LIMITS.nameLength))); });
    this.$('#edDelete').addEventListener('click', () => {
      if (!confirm(`Delete "${this.map.name}"? This can't be undone.`)) return;
      if (this.record.id) deleteMap(this.record.id);
      this.record = null;
      this.opts.onChanged?.();
      const next = listMaps()[0];
      this.open(next || null);
    });
    this.$('#edExport').addEventListener('click', () => this.download(`${this.fileName()}.json`, 'application/json', JSON.stringify(normalizeMap(this.map), null, 2)));
    this.$('#edExportSSM').addEventListener('click', () => this.download(`${this.fileName()}.ssm`, 'application/octet-stream', encodeSSM(this.map)));
    this.$('#edImport').addEventListener('click', () => this.$('#edFile').click());
    this.$('#edFile').addEventListener('change', () => this.importFile(this.$('#edFile').files[0]));
    this.$('#edShare').addEventListener('click', () => this.shareLink());
    this.$('#edUpload').addEventListener('click', () => this.upload());
    this.$('#edOpenDialog').addEventListener('close', () => this.canvas.focus());
  }

  setTool(id) {
    this.tool = id;
    for (const b of this.root.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === id));
    this.$('#edHint').textContent = TOOLS.find(t => t.id === id).hint;
    this.refreshPanel();
  }

  buildToolbar() {
    const bar = this.$('#edTools');
    bar.innerHTML = TOOLS.map(t => `<button type="button" data-tool="${t.id}" title="${t.label} (${t.short})"><span class="ed-icon ed-icon-${t.id}"></span>${t.label}<kbd>${t.short}</kbd></button>`).join('');
    for (const b of bar.querySelectorAll('[data-tool]')) b.addEventListener('click', () => this.setTool(b.dataset.tool));
    this.setTool('select');
  }

  // ---- Side panel ----------------------------------------------------------------

  refreshPanel() {
    const box = this.$('#edProps');
    if (!box || !this.map) return;
    const o = this.selected();
    let html = '';
    const num = (id, label, value) => `<label class="ed-num">${label}<input type="number" id="${id}" value="${Math.round(value * 10) / 10}" step="${this.grid || 1}"></label>`;
    const weaponOptions = sel => SLOTS.map((slot, i) => {
      const ids = PICKUP_WEAPONS.filter(id => WEAPONS[id].slot === i);
      return ids.length ? `<optgroup label="${slot.key}: ${slot.name}">${ids.map(id => `<option value="${id}"${id === sel ? ' selected' : ''}>${WEAPONS[id].name}</option>`).join('')}</optgroup>` : '';
    }).join('');
    const teamButtons = (name, team) => `<div class="seg ed-team"><label><input type="radio" name="${name}" value="1"${team === 1 ? ' checked' : ''}> Blue team</label><label><input type="radio" name="${name}" value="2"${team === 2 ? ' checked' : ''}> Red team</label></div>`;

    if (o && this.sel.kind === 'platform') {
      const pad = !!o.bounce;
      html += `<h3>${pad ? 'Jump pad' : 'Platform'}</h3>
        <div class="ed-grid">${num('pX', 'X', o.left)}${num('pY', 'Y', o.top)}${num('pW', 'Width', o.right - o.left)}${num('pH', 'Height', o.bottom - o.top)}</div>
        <label class="check"><input type="checkbox" id="pPad"${pad ? ' checked' : ''}> Jump pad</label>
        ${pad ? `<label class="ed-range">Strength <output>${-o.bounce}</output><input type="range" id="pBounce" min="${BOUNCE.min}" max="${BOUNCE.max}" step="0.5" value="${-o.bounce}"></label>` : ''}`;
    } else if (o && this.sel.kind === 'spawn') {
      html += `<h3>Spawn point</h3>${teamButtons('sTeam', o.team)}<div class="ed-grid">${num('sX', 'X', o.x)}${num('sY', 'Y', o.y)}</div>
        <p class="ed-note">Free-for-all uses every spawn point. Team games use each team's own.</p>`;
    } else if (o && this.sel.kind === 'item') {
      html += `<h3>Pickup</h3>
        <label class="ed-field">Type<select id="iType">${['weapon', 'health', 'armour', 'jetpack'].map(t => `<option value="${t}"${t === o.type ? ' selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></label>
        ${o.type === 'weapon' ? `<label class="ed-field">Weapon<select id="iWeapon">${weaponOptions(o.weapon)}</select></label>` : ''}
        <div class="ed-grid">${num('iX', 'X', o.x)}${num('iY', 'Y', o.y)}</div>`;
    }
    if (o) {
      html += `<div class="ed-row"><button type="button" id="selDup">Duplicate</button><button type="button" id="selDel">Delete</button></div>
        <div class="ed-row"><button type="button" id="selMirror">Mirror to other side</button></div>`;
    } else {
      // Tool options and map summary.
      if (this.tool === 'spawn') html += `<h3>Placing spawn points</h3>${teamButtons('toolTeam', this.team)}`;
      if (this.tool === 'weapon') html += `<h3>Placing weapons</h3><label class="ed-field">Weapon<select id="toolWeapon">${weaponOptions(this.weapon)}</select></label>`;
      if (this.tool === 'pad') html += `<h3>Drawing jump pads</h3><label class="ed-range">Strength <output>${this.padStrength || BOUNCE.standard}</output><input type="range" id="toolBounce" min="${BOUNCE.min}" max="${BOUNCE.max}" step="0.5" value="${this.padStrength || BOUNCE.standard}"></label><p class="ed-note">7 launches about twice as high as a jump.</p>`;
      const m = this.map, b = computeBounds(m.platforms, m.spawns, m.items);
      const blue = m.spawns.filter(s => s.team === 1).length;
      html += `<h3>Map</h3><p class="ed-stats">${count(m.platforms.length, 'platform')} &middot; ${count(m.spawns.length, 'spawn')} (${blue} blue, ${m.spawns.length - blue} red) &middot; ${count(m.items.length, 'pickup')}<br>${Math.round(b.right - b.left)} &times; ${Math.round(b.bottom - b.top)} px</p>`;
      html += this.loadoutPanel();
    }
    const mir = this.mirror;
    html += `<h3>Mirror</h3>
      <label class="check"><input type="checkbox" id="mirOn"${mir.on ? ' checked' : ''}> Mirror editing <kbd>M</kbd></label>
      ${mir.on ? `<p class="ed-note">Anything you add, move or delete is copied to the other side of the purple line.</p>
        <label class="ed-num ed-wide">Mirror line X<input type="number" id="mirX" value="${mir.x}" step="${this.grid || 1}"></label>
        <label class="check"><input type="checkbox" id="mirSwap"${mir.swapTeams ? ' checked' : ''}> Swap blue and red spawns on the other side</label>
        <div class="ed-row"><button type="button" id="mirLR">Copy left &rarr; right</button><button type="button" id="mirRL">Copy right &rarr; left</button></div>` : ''}`;
    html += `<h3>Placing</h3>
      <label class="ed-field">Snap to grid<select id="gridSize">${GRIDS.map(g => `<option value="${g}"${g === this.grid ? ' selected' : ''}>${g ? g + ' px' : 'Off'}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="sitFloor"${this.sitOnFloor ? ' checked' : ''}> Drop pickups and spawns onto the floor</label>`;
    box.innerHTML = html;
    this.wirePanel();
    this.renderReport();
  }

  /** "Everyone spawns with": weapons, armour and a jetpack for free-for-all and team games. */
  loadoutPanel() {
    const lo = this.map.loadout || { weapons: [], armour: 0, jetpack: false };
    const groups = SLOTS.map((slot, i) => {
      const ids = PICKUP_WEAPONS.filter(id => WEAPONS[id].slot === i);
      if (!ids.length) return '';
      return `<div class="ed-lo-group"><span>${slot.key}</span>${ids.map(id => `<label><input type="checkbox" name="loWeapon" value="${id}"${lo.weapons.includes(id) ? ' checked' : ''}> ${WEAPONS[id].short}</label>`).join('')}</div>`;
    }).join('');
    return `<h3>Everyone spawns with</h3>
      <p class="ed-note">As well as the pistol and prod, in free-for-all and team games.</p>
      <details id="loDetails"${this.loadoutOpen ? ' open' : ''}><summary>Weapons (${lo.weapons.length})</summary><div class="ed-loadout">${groups}</div></details>
      <div class="ed-grid">
        <label class="ed-field">Armour<select id="loArmour">${[[0, 'None'], [50, 'Half'], [100, 'Full']].map(([v, t]) => `<option value="${v}"${(lo.armour || 0) === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="check ed-jet"><input type="checkbox" id="loJet"${lo.jetpack ? ' checked' : ''}> Jetpack</label>
      </div>`;
  }

  /** Update just the number boxes while dragging (rebuilding the panel would steal focus). */
  refreshPanelValues() {
    const o = this.selected();
    if (!o) return;
    const set = (id, v) => { const el = this.$('#' + id); if (el && document.activeElement !== el) el.value = Math.round(v * 10) / 10; };
    if (this.sel.kind === 'platform') { set('pX', o.left); set('pY', o.top); set('pW', o.right - o.left); set('pH', o.bottom - o.top); }
    else if (this.sel.kind === 'spawn') { set('sX', o.x); set('sY', o.y); }
    else { set('iX', o.x); set('iY', o.y); }
  }

  wirePanel() {
    const on = (id, ev, fn) => { const el = this.$('#' + id); if (el) el.addEventListener(ev, () => fn(el)); };
    const edit = fn => el => { this.remember(); const twin = this.selectedTwin(); fn(el); this.syncTwin(twin); this.changed(); };
    const o = this.selected();
    on('pX', 'change', edit(el => { const w = o.right - o.left; o.left = +el.value || 0; o.right = o.left + w; }));
    on('pY', 'change', edit(el => { const h = o.bottom - o.top; o.top = +el.value || 0; o.bottom = o.top + h; }));
    on('pW', 'change', edit(el => { o.right = o.left + Math.max(8, +el.value || 8); }));
    on('pH', 'change', edit(el => { o.bottom = o.top + Math.max(8, +el.value || 8); }));
    on('pPad', 'change', edit(el => { if (el.checked) o.bounce = -(this.padStrength || BOUNCE.standard); else delete o.bounce; }));
    on('pBounce', 'input', el => { el.previousElementSibling.textContent = el.value; });
    on('pBounce', 'change', edit(el => { o.bounce = -(+el.value); this.padStrength = +el.value; }));
    on('sX', 'change', edit(el => { o.x = +el.value || 0; }));
    on('sY', 'change', edit(el => { o.y = +el.value || 0; }));
    on('iX', 'change', edit(el => { o.x = +el.value || 0; }));
    on('iY', 'change', edit(el => { o.y = +el.value || 0; }));
    on('iType', 'change', edit(el => { o.type = el.value; if (o.type === 'weapon') o.weapon = o.weapon || this.weapon; else delete o.weapon; }));
    on('iWeapon', 'change', edit(el => { o.weapon = el.value; this.weapon = el.value; }));
    for (const r of this.root.querySelectorAll('input[name=sTeam]')) r.addEventListener('change', () => { this.remember(); const twin = this.selectedTwin(); o.team = +r.value; this.team = o.team; this.syncTwin(twin); this.changed(); });
    for (const r of this.root.querySelectorAll('input[name=toolTeam]')) r.addEventListener('change', () => { this.team = +r.value; });
    on('toolWeapon', 'change', el => { this.weapon = el.value; });
    on('toolBounce', 'input', el => { el.previousElementSibling.textContent = el.value; this.padStrength = +el.value; });
    on('gridSize', 'change', el => { this.grid = +el.value; });
    on('sitFloor', 'change', el => { this.sitOnFloor = el.checked; });
    on('selDup', 'click', () => this.duplicateSelected());
    on('selDel', 'click', () => this.deleteSelected());
    on('selMirror', 'click', () => this.mirrorSelection());
    on('mirOn', 'change', el => this.toggleMirror(el.checked));
    on('mirX', 'change', el => { this.mirror.x = +el.value || 0; this.mirror.placed = true; });
    on('mirSwap', 'change', el => { this.mirror.swapTeams = el.checked; });
    on('mirLR', 'click', () => this.copySide('right'));
    on('mirRL', 'click', () => this.copySide('left'));
    const lo = () => this.map.loadout || (this.map.loadout = { weapons: [], armour: 0, jetpack: false });
    for (const c of this.root.querySelectorAll('input[name=loWeapon]')) c.addEventListener('change', () => {
      this.remember();
      const l = lo();
      l.weapons = l.weapons.filter(id => id !== c.value);
      if (c.checked) l.weapons.push(c.value);
      this.changed();
    });
    on('loArmour', 'change', edit(el => { lo().armour = +el.value; }));
    on('loJet', 'change', edit(el => { lo().jetpack = el.checked; }));
    const det = this.$('#loDetails');
    if (det) det.addEventListener('toggle', () => { this.loadoutOpen = det.open; });
  }

  // ---- Map check -----------------------------------------------------------------

  runCheck() {
    this.saveNow();
    try { this.check = checkMap(this.map); }
    catch (e) { this.check = { problems: [{ level: 'error', text: e.message }], spots: [] }; }
    this.renderReport();
  }

  renderReport() {
    const box = this.$('#edReport');
    if (!this.check) { box.innerHTML = '<p class="ed-note">Check the map to find places players get stuck, spawn points in walls and pickups nobody can reach.</p>'; return; }
    box.innerHTML = '<h3>Map check</h3>' + this.check.problems.map((p, i) =>
      `<button type="button" class="ed-problem ${p.level}" data-i="${i}"${p.x === undefined ? ' disabled' : ''}>${esc(p.text)}</button>`).join('');
    for (const b of box.querySelectorAll('.ed-problem:not([disabled])')) {
      b.addEventListener('click', () => {
        const p = this.check.problems[+b.dataset.i];
        this.view.x = p.x; this.view.y = p.y;
        this.view.zoom = Math.max(this.view.zoom, 1.2);
        this.flash = { x: p.x, y: p.y, until: performance.now() + 1500 };
      });
    }
  }

  testPlay() {
    let result;
    try { result = checkMap(this.map); }
    catch (e) { alert(e.message); return; }
    const errors = result.problems.filter(p => p.level === 'error');
    if (errors.length) {
      this.check = result;
      this.renderReport();
      alert(`Fix these first:\n\n${errors.map(p => '• ' + p.text).join('\n')}`);
      return;
    }
    this.saveNow();
    this.active = false;
    this.root.classList.add('hidden');
    this.opts.onTestPlay(this.record);
  }

  /** Come back from a test match. */
  resume() {
    this.active = true;
    this.root.classList.remove('hidden');
    this.resize();
    this.loop();
  }

  // ---- Files ---------------------------------------------------------------------

  fileName() { return (this.map.name || 'map').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'map'; }

  download(name, type, content) {
    try {
      const url = URL.createObjectURL(new Blob([content], { type }));
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { this.setStatus(`Couldn't download: ${e.message}`, true); }
  }

  async importFile(file) {
    this.$('#edFile').value = '';
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const isSSM = /\.ssm$/i.test(file.name);
      const data = isSSM ? decodeSSM(buf) : normalizeMap(JSON.parse(new TextDecoder().decode(buf)));
      this.saveNow();
      this.open(this.createRecord(data));
      this.setStatus(`Imported ${file.name}`);
    } catch (e) {
      alert(`Couldn't import ${file.name}: ${e.message}`);
    }
  }

  async shareLink() {
    try {
      const code = await encodeShare(this.map);
      const url = `${location.origin}${location.pathname}#map=${code}`;
      try { await navigator.clipboard.writeText(url); this.setStatus('Share link copied'); }
      catch { prompt('Copy this link to share your map:', url); }
    } catch (e) {
      alert(`Couldn't make a link: ${e.message}`);
    }
  }

  /** Put the map in the community maps, for everyone to play. */
  async upload() {
    if (!this.opts.onUpload || !this.record?.id) return;
    let result;
    try { result = checkMap(this.map); } catch (e) { alert(e.message); return; }
    const errors = result.problems.filter(p => p.level === 'error');
    if (errors.length) {
      this.check = result;
      this.renderReport();
      alert(`Fix these before uploading:\n\n${errors.map(p => '• ' + p.text).join('\n')}`);
      return;
    }
    if (!confirm(`Upload "${this.map.name}" for everyone to play? It's public, and your name will be shown with it.${this.record.communitySlot ? ' (This replaces your earlier upload.)' : ''}`)) return;
    this.saveNow();
    this.setStatus('Uploading…');
    try {
      const res = await this.opts.onUpload(this.record);
      this.record = getMap(this.record.id) || this.record;
      this.setStatus(`Uploaded (${res.relays} server${res.relays === 1 ? '' : 's'})`);
    } catch (e) {
      this.setStatus(`Upload failed: ${e.message}`, true);
    }
  }

  showOpenDialog() {
    this.saveNow();
    const dlg = this.$('#edOpenDialog');
    const mine = listMaps();
    const list = dlg.querySelector('.ed-list');
    list.innerHTML = `<h3>Your maps</h3>` + (mine.length ? mine.map(m => `<div class="ed-list-row"><span>${esc(m.name)}<small>${new Date(m.updated).toLocaleString()}</small></span><button type="button" data-open="${m.id}">Open</button></div>`).join('') : '<p class="ed-note">None yet.</p>')
      + `<h3>Start from an original map</h3>` + this.opts.originals.map((o, i) => `<div class="ed-list-row"><span>${esc(o.name)}</span><button type="button" data-orig="${i}">Copy &amp; edit</button></div>`).join('');
    for (const b of list.querySelectorAll('[data-open]')) b.addEventListener('click', () => { dlg.close(); this.open(getMap(b.dataset.open)); });
    for (const b of list.querySelectorAll('[data-orig]')) b.addEventListener('click', () => {
      dlg.close();
      const o = this.opts.originals[+b.dataset.orig];
      this.open(this.createRecord(o.data, `${o.name} (edit)`.slice(0, LIMITS.nameLength)));
    });
    dlg.showModal();
  }

  // ---- Drawing ---------------------------------------------------------------------

  loop() {
    if (!this.active) return;
    this.draw();
    requestAnimationFrame(() => this.loop());
  }

  draw() {
    const ctx = this.ctx, z = this.view.zoom, d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, this.w, this.h);
    this.drawGrid();

    // World transform
    ctx.setTransform(d * z, 0, 0, d * z, d * (this.w / 2 - this.view.x * z), d * (this.h / 2 - this.view.y * z));
    const m = this.map;
    const b = computeBounds(m.platforms, m.spawns, m.items);
    const px = 1 / z;

    // Map edge and the line below which players die.
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.strokeStyle = '#c9c9c9';
    ctx.lineWidth = px;
    ctx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    const death = b.bottom + RULES.fallDeathMargin;
    ctx.strokeStyle = '#e8a0a0';
    ctx.beginPath(); ctx.moveTo(b.left - 200, death); ctx.lineTo(b.right + 200, death); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#d88';
    ctx.font = `${11 * px}px Arial, sans-serif`;
    ctx.fillText('Falling below this line kills', b.left, death - 4 * px);

    // Platforms: black outline of their combined shape, like the game draws them.
    const e = Math.max(1.1, 1.3 * px);
    ctx.fillStyle = '#111';
    for (const p of m.platforms) ctx.fillRect(p.left - e, p.top - e, p.right - p.left + 2 * e, p.bottom - p.top + 2 * e);
    for (const p of m.platforms) {
      ctx.fillStyle = p.bounce ? '#eef3e2' : '#fff';
      ctx.fillRect(p.left, p.top, p.right - p.left, p.bottom - p.top);
    }
    ctx.strokeStyle = '#7c9a3d';
    ctx.lineWidth = 1.5 * Math.max(1, px);
    for (const p of m.platforms) {
      if (!p.bounce) continue;
      for (let x = p.left + 10; x < p.right - 4; x += 14) {
        const y = p.top + Math.min(12, (p.bottom - p.top) * 0.6);
        ctx.beginPath(); ctx.moveTo(x - 4, y + 3); ctx.lineTo(x, y - 1); ctx.lineTo(x + 4, y + 3); ctx.stroke();
      }
    }

    // Mirror line.
    if (this.mirror.on) {
      ctx.setLineDash([8 * px, 5 * px]);
      ctx.strokeStyle = 'rgba(122,79,208,0.8)';
      ctx.lineWidth = 1.5 * px;
      const [, top] = this.toWorld(0, 0), [, bottom] = this.toWorld(0, this.h);
      ctx.beginPath(); ctx.moveTo(this.mirror.x, top); ctx.lineTo(this.mirror.x, bottom); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Check overlay: where soldiers can stand, coloured by whether they can get back.
    if (this.check?.spots) {
      for (const s of this.check.spots) {
        ctx.fillStyle = s.kind === 'ok' ? 'rgba(60,160,60,0.35)' : s.kind === 'trap' ? 'rgba(220,40,40,0.9)' : 'rgba(150,150,150,0.6)';
        ctx.beginPath(); ctx.arc(s.x, s.y + 12, Math.max(2.2, 3 * px), 0, Math.PI * 2); ctx.fill();
      }
    }

    // Spawn points: small stick figures in team colours.
    for (const s of m.spawns) drawSpawn(ctx, s);

    // Pickups, drawn as in the game.
    for (const it of m.items) {
      ctx.save();
      ctx.translate(it.x, it.y);
      if (it.type === 'health') drawHealth(ctx);
      else if (it.type === 'armour') drawArmour(ctx);
      else if (it.type === 'jetpack') drawJetpack(ctx);
      else drawWeapon(ctx, WEAPONS[it.weapon], true);
      ctx.restore();
    }

    // Hover and selection.
    const outline = (sel, color, width) => {
      const o = sel && ({ platform: m.platforms, spawn: m.spawns, item: m.items }[sel.kind] || [])[sel.i];
      if (!o) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width * px;
      if (sel.kind === 'platform') ctx.strokeRect(o.left - 2 * px, o.top - 2 * px, o.right - o.left + 4 * px, o.bottom - o.top + 4 * px);
      else if (sel.kind === 'spawn') ctx.strokeRect(o.x - 9, o.y - 26, 18, 40);
      else ctx.strokeRect(o.x - 11, o.y - 9, 22, 18);
    };
    if (!this.drag) outline(this.hover, 'rgba(47,111,219,0.45)', 1.5);
    outline(this.sel, '#2f6fdb', 2);
    if (this.sel?.kind === 'platform' && this.tool === 'select') {
      const pts = this.handlePoints(this.map.platforms[this.sel.i]);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#2f6fdb';
      ctx.lineWidth = 1.5 * px;
      for (const h of HANDLES) {
        const [hx, hy] = pts[h];
        ctx.fillRect(hx - 4 * px, hy - 4 * px, 8 * px, 8 * px);
        ctx.strokeRect(hx - 4 * px, hy - 4 * px, 8 * px, 8 * px);
      }
    }

    // A platform being drawn.
    const dr = this.drag;
    if (dr?.mode === 'create') {
      const l = Math.min(dr.x0, dr.x1), t = Math.min(dr.y0, dr.y1);
      ctx.fillStyle = this.tool === 'pad' ? 'rgba(124,154,61,0.25)' : 'rgba(0,0,0,0.08)';
      ctx.fillRect(l, t, Math.abs(dr.x1 - dr.x0), Math.abs(dr.y1 - dr.y0));
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.strokeStyle = '#111';
      ctx.lineWidth = px;
      ctx.strokeRect(l, t, Math.abs(dr.x1 - dr.x0), Math.abs(dr.y1 - dr.y0));
      if (this.mirror.on) {
        ctx.strokeStyle = 'rgba(122,79,208,0.8)';
        ctx.strokeRect(this.mx(l + Math.abs(dr.x1 - dr.x0)), t, Math.abs(dr.x1 - dr.x0), Math.abs(dr.y1 - dr.y0));
      }
      ctx.setLineDash([]);
    }

    // Ghost of what a click would place.
    if (!dr && this.mouse.inside && (this.tool === 'spawn' || ITEM_TOOLS.has(this.tool))) {
      const [gx, gy] = this.placeAt(this.mouse.wx, this.mouse.wy, this.tool === 'spawn' ? 'spawn' : 'item');
      const ghosts = [[gx, gy, this.team]];
      if (this.mirror.on && gx !== this.mirror.x) ghosts.push([this.mx(gx), gy, this.mirror.swapTeams ? 3 - this.team : this.team]);
      ghosts.forEach(([x, y, team], k) => {
        ctx.globalAlpha = k ? 0.3 : 0.45;
        if (this.tool === 'spawn') drawSpawn(ctx, { x, y, team });
        else {
          ctx.save(); ctx.translate(x, y);
          if (this.tool === 'health') drawHealth(ctx);
          else if (this.tool === 'armour') drawArmour(ctx);
          else if (this.tool === 'jetpack') drawJetpack(ctx);
          else drawWeapon(ctx, WEAPONS[this.weapon], true);
          ctx.restore();
        }
      });
      ctx.globalAlpha = 1;
    }

    if (this.flash && performance.now() < this.flash.until) {
      ctx.strokeStyle = '#e22';
      ctx.lineWidth = 2 * px;
      const r = 14 + 6 * Math.sin(performance.now() / 80);
      ctx.beginPath(); ctx.arc(this.flash.x, this.flash.y, r, 0, Math.PI * 2); ctx.stroke();
    }

    // Cursor position, in screen space.
    ctx.setTransform(d, 0, 0, d, 0, 0);
    if (this.mouse.inside) {
      ctx.fillStyle = '#999';
      ctx.font = '11px Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.round(this.snap(this.mouse.wx))}, ${Math.round(this.snap(this.mouse.wy))}  ·  zoom ${Math.round(z * 100)}%`, this.w - 8, this.h - 8);
      ctx.textAlign = 'left';
    }
  }

  drawGrid() {
    const ctx = this.ctx, z = this.view.zoom;
    const g = this.grid || 8;
    let step = g;
    while (step * z < 12) step *= 2;
    const [x0, y0] = this.toWorld(0, 0), [x1, y1] = this.toWorld(this.w, this.h);
    ctx.lineWidth = 1;
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
      const [sx] = this.toScreen(x, 0);
      ctx.strokeStyle = x === 0 ? '#d8d8d8' : x % (step * 8) === 0 ? '#ececec' : '#f6f6f6';
      ctx.beginPath(); ctx.moveTo(Math.round(sx) + 0.5, 0); ctx.lineTo(Math.round(sx) + 0.5, this.h); ctx.stroke();
    }
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
      const [, sy] = this.toScreen(0, y);
      ctx.strokeStyle = y === 0 ? '#d8d8d8' : y % (step * 8) === 0 ? '#ececec' : '#f6f6f6';
      ctx.beginPath(); ctx.moveTo(0, Math.round(sy) + 0.5); ctx.lineTo(this.w, Math.round(sy) + 0.5); ctx.stroke();
    }
  }
}

function drawSpawn(ctx, s) {
  const c = TEAM_COLORS[s.team] || TEAM_COLORS[1];
  ctx.strokeStyle = c;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(s.x, s.y - 14); ctx.lineTo(s.x, s.y - 2);
  ctx.moveTo(s.x, s.y - 2); ctx.lineTo(s.x - 5, s.y + 10);
  ctx.moveTo(s.x, s.y - 2); ctx.lineTo(s.x + 5, s.y + 10);
  ctx.moveTo(s.x, s.y - 11); ctx.lineTo(s.x - 6, s.y - 5);
  ctx.moveTo(s.x, s.y - 11); ctx.lineTo(s.x + 6, s.y - 5);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(s.x, s.y - 18, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}
