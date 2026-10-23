// Route planning for bots.
//
// Nodes are spots a soldier can stand on. Links between them are found by
// simulating moves with the real physics (walk, jump left/right/up with
// different amounts of steering, step off ledges), so every link is a move
// that actually works in the game, including jump-pad launches.

import { BODY, PHYS, MOTION } from './config.js';
import { makeBody, stepBody } from './physics.js';

const NODE_STEP = 12;
// A remembered jump or drop is tried again when blocks change this close to where it went.
const TRY_MARGIN = 10;
const NODE_CELL = 64; // grid cells for finding the nearest node
const MAX_SIM = 320;
// What a jump costs on top of the time it takes (in updates at full speed). A jump
// along a flat floor is about as quick as running, and bots jumping about for no
// reason look odd, so they only jump when it saves real time, or to get somewhere.
const JUMP_COST = 40;

// Jump moves: wait `delay` ticks, steer `dir` for `hold` ticks, then steer `then`.
const JUMPS = [
  { dir: 0, delay: 0, hold: 0 },
  { dir: -1, delay: 0, hold: 999 }, { dir: 1, delay: 0, hold: 999 },
  { dir: -1, delay: 0, hold: 8 }, { dir: 1, delay: 0, hold: 8 },
  { dir: -1, delay: 0, hold: 18 }, { dir: 1, delay: 0, hold: 18 },
  { dir: -1, delay: 14, hold: 999 }, { dir: 1, delay: 14, hold: 999 },
  { dir: -1, delay: 24, hold: 12 }, { dir: 1, delay: 24, hold: 12 },
  // Steer one way, then the other (e.g. onto a jump pad, then back over a ledge).
  { dir: -1, delay: 0, hold: 10, then: 1 }, { dir: 1, delay: 0, hold: 10, then: -1 },
  { dir: -1, delay: 0, hold: 22, then: 1 }, { dir: 1, delay: 0, hold: 22, then: -1 },
  { dir: -1, delay: 0, hold: 40, then: 1 }, { dir: 1, delay: 0, hold: 40, then: -1 },
];
// Stepping off a ledge: keep steering `dir` for `hold` ticks once falling, then steer `then`.
const DROPS = [
  { dir: -1, hold: 0 }, { dir: 1, hold: 0 },
  { dir: -1, hold: 10 }, { dir: 1, hold: 10 },
  { dir: -1, hold: 999 }, { dir: 1, hold: 999 },
  { dir: -1, hold: 4, then: 1 }, { dir: 1, hold: 4, then: -1 },
];

/** The steering a jump move uses on tick t (shared with the bots that perform it). */
export function jumpSteer(j, t) {
  if (t < j.delay) return 0;
  if (t < j.delay + j.hold) return j.dir;
  return j.then || 0;
}

/** The steering a drop move uses, given ticks since the soldier started falling (-1 = not yet). */
export function dropSteer(d, fallTicks) {
  if (fallTicks < 0 || fallTicks < d.hold) return d.dir;
  return d.then || 0;
}

export class NavGraph {
  constructor(map) {
    this.map = map;
    this.nodes = [];
    this.version = 0; // goes up when patch() changes the spots (they're numbered afresh)
    // At lower game speeds everything takes longer, so stretch the move timings
    // to match: the moves (and so the routes) are then the same at every speed.
    const t = 1 / MOTION.timeScale;
    this.timeScale = MOTION.timeScale;
    this.maxSim = MAX_SIM * t;
    this.jumps = JUMPS.map(j => ({ ...j, delay: j.delay * t, hold: j.hold * t }));
    this.drops = DROPS.map(d => ({ ...d, hold: d.hold * t }));
    this._buildNodes();
    this._buildLinks();
    this._prepare();
  }

  /**
   * Work out now what searches and lookups need (the links as flat arrays, the spots by
   * grid cell, which spots are in pits), rather than in the middle of the first update
   * that wants them. (The same as working it out then: nothing changes in between.)
   */
  _prepare() {
    this._flat();
    this._indexNodes();
    this.trapped();
  }

  _standable(x, y) {
    const m = this.map;
    if (m.overlap(x - BODY.halfW, y + BODY.top, x + BODY.halfW, y + BODY.bottom)) return false;
    return !!m.overlap(x - BODY.halfW, y + BODY.bottom, x + BODY.halfW, y + BODY.bottom + 1);
  }

  _buildNodes() {
    this.rows = new Map();
    for (const s of this.map.solids) this._nodesOn(s);
  }

  /**
   * Spots to stand on along the top of solid s (only inside `area` { l, t, r, b }, if given).
   * Worked out from where there's room for a soldier on it (partly hanging over its ends,
   * less wherever a block is in the way of the body), with spots at both ends of every
   * stretch of room and about NODE_STEP apart between: so even a nook a few pixels wide
   * that holes left has a spot (a soldier who ends up there isn't off the route map).
   */
  _nodesOn(s, area = null) {
    if (s.bounce) return;
    const y = s.t - BODY.bottom, hw = BODY.halfW;
    if (area && (y < area.t || y > area.b)) return;
    let room = [[s.l - hw + 1, s.r + hw - 1]];
    this.map.query(s.l - hw, y + BODY.top, s.r + hw, y + BODY.bottom, o => {
      // (The body overlaps block o anywhere strictly between o.l - hw and o.r + hw.)
      if (o !== s && o.t < y + BODY.bottom && o.b > y + BODY.top) room = without(room, o.l - hw, o.r + hw);
      return false;
    });
    for (const [a, b] of room) {
      const n = Math.round((b - a) / NODE_STEP);
      for (let i = 0; i <= n; i++) {
        const x = n ? a + ((b - a) * i) / n : (a + b) / 2;
        if (area && (x < area.l || x > area.r)) continue;
        if (this._taken(x, y)) continue;
        if (this._standable(x, y)) this._addNode({ id: this.nodes.length, x, y, links: [] });
      }
    }
  }

  /** True if there's already a spot within half a step of (x, y) on the same row. */
  _taken(x, y) {
    for (const k of [Math.round(y) - 1, Math.round(y), Math.round(y) + 1]) {
      for (const o of this.rows.get(k) || []) if (Math.abs(o.y - y) < 0.5 && Math.abs(o.x - x) < NODE_STEP * 0.5) return true;
    }
    return false;
  }

  _addNode(n) {
    this._flatLinks = null;
    this.nodes.push(n);
    const k = Math.round(n.y);
    if (!this.rows.has(k)) this.rows.set(k, []);
    this.rows.get(k).push(n);
    this.nodeCells = null;
  }

  /** Index the spots again (ids, rows, cells) after some were taken away. */
  _reindex() {
    this.rows = new Map();
    const all = this.nodes;
    this.nodes = [];
    for (const n of all) { n.id = this.nodes.length; this._addNode(n); }
  }

  /** Nearest node to a standing position (same height, within `reach` px), or null. */
  nodeAt(x, y, reach = NODE_STEP) {
    let best = null, bd = reach;
    const r = Math.round(y);
    // (The rows just above, at and just below, in that order.)
    for (let i = -1; i <= 1; i++) {
      const row = this.rows.get(r + i);
      if (!row) continue;
      for (let j = 0; j < row.length; j++) {
        const n = row[j], d = Math.abs(n.x - x);
        if (d <= bd) { bd = d; best = n; }
      }
    }
    return best;
  }

  /** Nearest node to any point (for goals in mid-air, like items or enemies). */
  nearest(x, y, maxDist = 400) {
    // Only nodes in the grid cells within reach (same answer as checking them all,
    // ties going to the lowest id).
    const cells = this.nodeCells || this._indexNodes();
    const c0 = Math.floor((x - maxDist) / NODE_CELL), c1 = Math.floor((x + maxDist) / NODE_CELL);
    const r0 = Math.floor((y - maxDist / 1.6) / NODE_CELL), r1 = Math.floor((y + maxDist / 1.6) / NODE_CELL);
    let best = null, bd = maxDist * maxDist;
    const check = n => {
      const dy = (n.y - y) * 1.6; // prefer nodes level with the point
      const d = (n.x - x) ** 2 + dy * dy;
      if (d < bd || (d === bd && best && n.id < best.id)) { bd = d; best = n; }
    };
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > this.nodes.length) { for (const n of this.nodes) check(n); return best; }
    for (let cx = c0; cx <= c1; cx++) {
      for (let cy = r0; cy <= r1; cy++) {
        const list = cells.get(cx * 100003 + cy);
        if (list) for (const n of list) check(n);
      }
    }
    return best;
  }

  /** Nodes less than rx across and ry up or down from a point, in id order. */
  nodesNear(x, y, rx, ry) {
    const cells = this.nodeCells || this._indexNodes();
    const out = [];
    for (let cx = Math.floor((x - rx) / NODE_CELL); cx <= Math.floor((x + rx) / NODE_CELL); cx++) {
      for (let cy = Math.floor((y - ry) / NODE_CELL); cy <= Math.floor((y + ry) / NODE_CELL); cy++) {
        const list = cells.get(cx * 100003 + cy);
        if (list) for (const n of list) if (Math.abs(n.x - x) < rx && Math.abs(n.y - y) < ry) out.push(n);
      }
    }
    return out.sort(byId);
  }

  _indexNodes() {
    this.nodeCells = new Map();
    for (const n of this.nodes) {
      const k = Math.floor(n.x / NODE_CELL) * 100003 + Math.floor(n.y / NODE_CELL);
      if (!this.nodeCells.has(k)) this.nodeCells.set(k, []);
      this.nodeCells.get(k).push(n);
    }
    return this.nodeCells;
  }

  /** Try a move from `start`. reach: a box grown to cover everywhere the body went. */
  _simulate(start, inputAt, reach) {
    const body = makeBody(start.x, start.y);
    body.onGround = true;
    let airborne = false;
    const bottom = this.map.bounds.bottom + 120;
    for (let t = 0; t < this.maxSim; t++) {
      stepBody(body, inputAt(t, body, airborne), this.map);
      if (body.x < reach.l) reach.l = body.x; else if (body.x > reach.r) reach.r = body.x;
      if (body.y < reach.t) reach.t = body.y; else if (body.y > reach.b) reach.b = body.y;
      if (!body.onGround) airborne = true;
      else if (airborne) {
        const n = this.nodeAt(body.x, body.y, 7);
        return n && n !== start ? { node: n, ticks: t + 1 } : null;
      }
      if (body.y > bottom) return null;
      if (!airborne && t > 40 / this.timeScale) return null; // never left the ground
    }
    return null;
  }

  _addLink(from, to, link) {
    const old = from.links.find(l => l.to === to);
    if (old && old.cost <= link.cost) return;
    if (old) from.links.splice(from.links.indexOf(old), 1);
    from.links.push({ to, ...link });
  }

  _buildLinks() {
    for (const a of this.nodes) this._linkNode(a);
    this.linkCount = this.nodes.reduce((n, a) => n + a.links.length, 0);
  }

  /**
   * Work out the moves from spot a: walking to its neighbours, then every jump
   * and drop. a.reach: a box around everywhere those moves went (so after blocks
   * change, only spots whose moves went near the change need doing again).
   * Each jump and drop tried is remembered in a.tries (where the body went, and
   * where it landed): given the `area` that changed, only the tries that went
   * near it are simulated again, and the rest come out as they did before.
   */
  _linkNode(a, area = null) {
    a.links = [];
    const reach = a.reach = { l: a.x - NODE_STEP - 6, t: a.y - 4, r: a.x + NODE_STEP + 6, b: a.y + 4 };
    // Walking between neighbouring spots.
    for (let dy = -PHYS.stepUp; dy <= PHYS.stepUp; dy++) {
      for (const b of this.rows.get(Math.round(a.y) + dy) || []) {
        // (Spots where two floors meet can be a little further apart than usual.)
        if (b === a || Math.abs(b.x - a.x) > NODE_STEP + 4) continue;
        const dir = Math.sign(b.x - a.x);
        if (dir && this._walkReaches(a, b, dir)) {
          this._addLink(a, b, { type: 'walk', dir, cost: Math.abs(b.x - a.x) / PHYS.runSpeed + 1 });
        }
      }
    }
    const walkL = a.links.some(l => l.type === 'walk' && l.dir < 0);
    const walkR = a.links.some(l => l.type === 'walk' && l.dir > 0);
    const old = area && a.tries, tries = a.tries = new Array(this.jumps.length + this.drops.length).fill(null);
    // (A try is simulated again if the body went near the change, or where it landed is gone.)
    const m = TRY_MARGIN;
    const stale = tr => !tr || tr.box.l - BODY.halfW - m < area.r && tr.box.r + BODY.halfW + m > area.l &&
      tr.box.t + BODY.top - m < area.b && tr.box.b + BODY.bottom + m > area.t || (tr.res && this.nodes[tr.res.node.id] !== tr.res.node);
    const attempt = (i, inputAt) => {
      let tr = old && old[i];
      if (!old || stale(tr)) {
        const box = { l: a.x, t: a.y, r: a.x, b: a.y };
        tr = { box, res: this._simulate(a, inputAt, box) };
      }
      tries[i] = tr;
      if (tr.box.l < reach.l) reach.l = tr.box.l;
      if (tr.box.r > reach.r) reach.r = tr.box.r;
      if (tr.box.t < reach.t) reach.t = tr.box.t;
      if (tr.box.b > reach.b) reach.b = tr.box.b;
      return tr.res;
    };
    this.jumps.forEach((j, i) => {
      const r = attempt(i, t => ({ move: jumpSteer(j, t), jump: true, jumpPressed: t === 0 }));
      if (r) this._addLink(a, r.node, { type: 'jump', move: j, cost: r.ticks + JUMP_COST / this.timeScale, ticks: r.ticks });
    });
    this.drops.forEach((d, k) => {
      if ((d.dir < 0 && walkL) || (d.dir > 0 && walkR)) return; // (walking that way instead)
      let fellAt = -1;
      const r = attempt(this.jumps.length + k, (t, body, airborne) => {
        if (airborne && fellAt < 0) fellAt = t;
        return { move: dropSteer(d, fellAt < 0 ? -1 : t - fellAt) };
      });
      if (r) this._addLink(a, r.node, { type: 'drop', move: d, cost: r.ticks + 3, ticks: r.ticks });
    });
  }

  /**
   * Ways out of somewhere that isn't a spot: a soldier standing at (x, y) where the
   * route map has none (in the moment before a patch adds one, say). Every jump and
   * drop, and walking either way, tried with the real physics from right there.
   * Returns the quickest move that lands on a spot (one with a way back to the main
   * part of the map, if any does) as a link ({ type, move or dir, to, cost, ticks }),
   * or null if none does. `only(node)`: just moves that land on spots it allows.
   */
  escape(x, y, only = null) {
    const from = { x, y, id: -1 }, box = { l: x, t: y, r: x, b: y };
    const trapped = this.trapped();
    let best = null;
    const consider = link => {
      if (only && !only(link.to)) return;
      const a = trapped[link.to.id], b = best && trapped[best.to.id];
      if (!best || a < b || (a === b && link.cost < best.cost)) best = link;
    };
    for (const dir of [-1, 1]) {
      const body = makeBody(x, y);
      body.onGround = true;
      for (let t = 1; t <= 60 / this.timeScale; t++) {
        stepBody(body, { move: dir }, this.map);
        if (!body.onGround) break;
        const n = this.nodeAt(body.x, body.y, 4);
        if (n) { consider({ type: 'walk', dir, to: n, cost: t, ticks: t }); break; }
      }
    }
    this.jumps.forEach(j => {
      const r = this._simulate(from, t => ({ move: jumpSteer(j, t), jump: true, jumpPressed: t === 0 }), box);
      if (r) consider({ type: 'jump', move: j, to: r.node, cost: r.ticks + JUMP_COST / this.timeScale, ticks: r.ticks });
    });
    this.drops.forEach(d => {
      let fellAt = -1;
      const r = this._simulate(from, (t, body, airborne) => {
        if (airborne && fellAt < 0) fellAt = t;
        return { move: dropSteer(d, fellAt < 0 ? -1 : t - fellAt) };
      }, box);
      if (r) consider({ type: 'drop', move: d, to: r.node, cost: r.ticks + 3, ticks: r.ticks });
    });
    return best;
  }

  /**
   * The spot nearest (x, y) (within maxDist) that the search got to (and `ok` allows):
   * where to head for when the spot nearest a place can't be got to (an enemy on a
   * ledge cut off by holes, say). Null if there's none.
   */
  nearestReached(search, x, y, maxDist, ok = () => true) {
    let best = null, bd = maxDist * maxDist;
    for (const n of this.nodesNear(x, y, maxDist, maxDist)) {
      if (search.cost[n.id] === Infinity || !ok(n)) continue;
      const dy = (n.y - y) * 1.6, d = (n.x - x) ** 2 + dy * dy;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /**
   * Blocks changed inside `area` (holes, building): find the spots there again,
   * and work out the moves again from every spot whose moves went near it. The
   * rest of the route map stays as it was. Spots are numbered afresh (bots plan
   * again afterwards).
   */
  patch(area) {
    const job = this.patchJob(area);
    job.step();
    return { removed: job.removed, added: job.added, redone: job.redone };
  }

  /**
   * patch(), a bit at a time, so a hole doesn't hold up the game: the spots change
   * straight away, and the moves from the spots near the change are worked out
   * `n` spots per job.step(n) (each spot is a few dozen short simulations). Until
   * then, those spots keep their old moves (less any to spots that are gone).
   * step() returns true once it's all done. `also`: spots an earlier job hadn't
   * got to yet (job.left: [{ node, area }]), to do in this one.
   */
  patchJob(area, also = []) {
    // Spots whose standing room or floor was inside the area.
    const touched = n => n.x + BODY.halfW > area.l && n.x - BODY.halfW < area.r && n.y + BODY.bottom + 1 > area.t && n.y + BODY.top < area.b;
    const removed = new Set(this.nodes.filter(touched));
    // (Which spots are in a pit nobody can climb out of: kept as it was until the job's done.)
    const wasTrapped = this._trapped && new Map(this.nodes.map(n => [n, this._trapped[n.id]]));
    this.nodes = this.nodes.filter(n => !removed.has(n));
    this._reindex();
    const pad = { l: area.l - BODY.halfW - 2, t: area.t - BODY.bottom - 2, r: area.r + BODY.halfW + 2, b: area.b - BODY.top + 2 };
    const fresh = new Set();
    for (const s of this.map.solids) {
      if (s.r + BODY.halfW < pad.l || s.l - BODY.halfW > pad.r) continue;
      const before = this.nodes.length;
      this._nodesOn(s, pad);
      for (let i = before; i < this.nodes.length; i++) fresh.add(this.nodes[i]);
    }
    // Moves that went near the change (or start next to it) are worked out again.
    const near = r => r.l - BODY.halfW - 2 < area.r && r.r + BODY.halfW + 2 > area.l && r.t + BODY.top - 2 < area.b && r.b + BODY.bottom + 2 > area.t;
    const besidePad = n => n.x > pad.l - NODE_STEP - 6 && n.x < pad.r + NODE_STEP + 6 && n.y > pad.t - PHYS.stepUp - 2 && n.y < pad.b + PHYS.stepUp + 2;
    // Each spot to redo, with the area its tries need checking against.
    const redo = [], todo = new Map();
    for (const a of this.nodes) {
      if (fresh.has(a) || besidePad(a) || !a.reach || near(a.reach)) { const e = { node: a, area }; redo.push(e); todo.set(a, e); }
      if (removed.size) a.links = a.links.filter(l => !removed.has(l.to));
    }
    this._flatLinks = null;
    for (const { node, area: was } of also) {
      if (this.nodes[node.id] !== node) continue;
      const e = todo.get(node);
      if (!e) { redo.push({ node, area: was }); continue; }
      e.area = { l: Math.min(e.area.l, was.l), t: Math.min(e.area.t, was.t), r: Math.max(e.area.r, was.r), b: Math.max(e.area.b, was.b) };
    }
    const done = () => {
      this.linkCount = this.nodes.reduce((n, a) => n + a.links.length, 0);
      this._flatLinks = null;
      this.searches = null;
      this.zoneCache = null;
      this._trapped = null;
      this.version = (this.version || 0) + 1;
    };
    done();
    if (wasTrapped) this._trapped = Uint8Array.from(this.nodes, n => wasTrapped.get(n) || 0);
    // (Until the job's done, searches use the moves as they were, less those to spots that
    // are gone: _flatLinks isn't worked out again for each spot redone.)
    let i = 0;
    const job = {
      removed: removed.size, added: fresh.size, redone: 0,
      get left() { return redo.slice(i); },
      step: (n = Infinity) => {
        for (let k = 0; k < n && i < redo.length; i++) {
          const { node: a, area: changed } = redo[i];
          if (this.nodes[a.id] !== a) continue; // (gone since)
          this._linkNode(a, changed);
          job.redone++;
          k++;
        }
        if (i < redo.length) return false;
        done();
        return true;
      },
    };
    return job;
  }

  /** A copy of this route map, for a match whose map can change (on `map`, that match's map). */
  clone(map = this.map) {
    const g = Object.create(NavGraph.prototype);
    Object.assign(g, { map, timeScale: this.timeScale, maxSim: this.maxSim, jumps: this.jumps, drops: this.drops, version: 0, linkCount: this.linkCount });
    g.nodes = [];
    g.rows = new Map();
    for (const n of this.nodes) g._addNode({ id: n.id, x: n.x, y: n.y, links: [], reach: n.reach && { ...n.reach } });
    for (const n of this.nodes) {
      const c = g.nodes[n.id];
      c.links = n.links.map(l => ({ ...l, to: g.nodes[l.to.id], penalty: 0 }));
      // (Where each try went doesn't change, so the boxes are shared.)
      c.tries = n.tries && n.tries.map(t => t && { box: t.box, res: t.res && { node: g.nodes[t.res.node.id], ticks: t.res.ticks } });
    }
    g._prepare();
    return g;
  }

  _walkReaches(a, b, dir) {
    const body = makeBody(a.x, a.y);
    body.onGround = true;
    for (let t = 0; t < 16 / this.timeScale; t++) {
      stepBody(body, { move: dir }, this.map);
      if (!body.onGround) return false;
      if ((body.x - b.x) * dir >= 0) return Math.abs(body.y - b.y) < 1;
    }
    return false;
  }

  /**
   * Groups of spots that can all reach each other (strongly connected
   * components). Returns { comp: Int32Array (group per node), sizes: Map(group -> size) }.
   */
  groups() {
    // (Tarjan's strongly connected components, without recursion, on the flat links.)
    const n = this.nodes.length, g = this._flat();
    const index = new Int32Array(n).fill(-1), low = new Int32Array(n), onStack = new Uint8Array(n);
    const comp = new Int32Array(n).fill(-1);
    const stack = new Int32Array(n), workNode = new Int32Array(n), workLink = new Int32Array(n);
    let sp = 0, next = 0, groupCount = 0;
    for (let root = 0; root < n; root++) {
      if (index[root] >= 0) continue;
      let wp = 0;
      workNode[wp] = root; workLink[wp] = g.from[root]; wp++;
      index[root] = low[root] = next++;
      stack[sp++] = root; onStack[root] = 1;
      while (wp) {
        const u = workNode[wp - 1], k = workLink[wp - 1];
        if (k < g.from[u + 1]) {
          workLink[wp - 1]++;
          const w = g.to[k];
          if (index[w] < 0) {
            index[w] = low[w] = next++;
            stack[sp++] = w; onStack[w] = 1;
            workNode[wp] = w; workLink[wp] = g.from[w]; wp++;
          } else if (onStack[w]) low[u] = Math.min(low[u], index[w]);
        } else {
          wp--;
          if (wp) { const p = workNode[wp - 1]; low[p] = Math.min(low[p], low[u]); }
          if (low[u] === index[u]) {
            let w;
            do { w = stack[--sp]; onStack[w] = 0; comp[w] = groupCount; } while (w !== u);
            groupCount++;
          }
        }
      }
    }
    const sizes = new Map();
    for (const c of comp) sizes.set(c, (sizes.get(c) || 0) + 1);
    return { comp, sizes };
  }

  /**
   * Spots with no way back to the main part of the map (the group of spots that
   * can all reach each other holding the most spawn points, or the biggest): pits
   * you can drop into but not climb out of. Uint8Array, 1 = trapped (remembered).
   */
  trapped() {
    if (this._trapped) return this._trapped;
    const n = this.nodes.length;
    const { comp, sizes } = this.groups();
    const spawnsIn = new Map();
    for (const p of this.map.spawns || []) {
      const at = this.landing(p.x, p.y);
      if (at) spawnsIn.set(comp[at.id], (spawnsIn.get(comp[at.id]) || 0) + 1);
    }
    let main = -1, most = -1;
    for (const [c, k] of spawnsIn.size ? spawnsIn : sizes) if (k > most) { most = k; main = c; }
    // Work back from the main group: every spot with a way into it can get back.
    const { intoFrom, into } = this._into();
    const back = new Uint8Array(n), queue = new Int32Array(n);
    let q = 0;
    for (let i = 0; i < n; i++) if (comp[i] === main) { back[i] = 1; queue[q++] = i; }
    while (q) {
      const v = queue[--q];
      for (let k = intoFrom[v]; k < intoFrom[v + 1]; k++) { const j = into[k]; if (!back[j]) { back[j] = 1; queue[q++] = j; } }
    }
    this._trapped = back.map(b => 1 - b);
    return this._trapped;
  }

  /**
   * Spots with a way to `target` (a spot): Uint8Array, 1 = can get there (the target too).
   * (Worked back from the target, along the links turned round.)
   */
  reachers(target) {
    const n = this.nodes.length, { intoFrom, into } = this._into();
    const ok = new Uint8Array(n), queue = new Int32Array(n);
    let q = 0;
    ok[target.id] = 1; queue[q++] = target.id;
    while (q) {
      const v = queue[--q];
      for (let k = intoFrom[v]; k < intoFrom[v + 1]; k++) { const j = into[k]; if (!ok[j]) { ok[j] = 1; queue[q++] = j; } }
    }
    return ok;
  }

  /** The spot a soldier dropped at (x, y) lands on (null: none, a pit or a jump pad). */
  landing(x, y) {
    const hit = this.map.raycast(x, y, x, y + 3000);
    return hit && hit.ny < 0 ? this.nodeAt(x, hit.y - BODY.bottom, 14) : null;
  }

  /**
   * The links as flat arrays, for searching (worked out again after they change):
   * node i's links are from[i] to from[i + 1] - 1 in to (node ids), cost, penalty (as
   * link.penalty || 0: kept in step by penalize()) and link (the objects; each link's
   * place in these is link.index).
   */
  _flat() {
    if (this._flatLinks) return this._flatLinks;
    const n = this.nodes.length;
    let e = 0;
    for (const a of this.nodes) e += a.links.length;
    const from = new Int32Array(n + 1), to = new Int32Array(e), cost = new Float64Array(e), penalty = new Float64Array(e), link = new Array(e);
    let k = 0;
    for (let i = 0; i < n; i++) {
      from[i] = k;
      for (const l of this.nodes[i].links) { to[k] = l.to.id; cost[k] = l.cost; penalty[k] = l.penalty || 0; link[k] = l; l.index = k; k++; }
    }
    from[n] = k;
    return (this._flatLinks = { from, to, cost, penalty, link });
  }

  /**
   * The extra cost bots put on a move that went wrong for them (bot.js): on the link, and
   * where searches read it (if the link is in this route map's flat arrays as they are now:
   * not one from before a patch, nor a move worked out on the spot, like escape()'s).
   */
  penalize(link, penalty) {
    link.penalty = penalty;
    const g = this._flatLinks;
    if (g && g.link[link.index] === link) g.penalty[link.index] = penalty || 0;
  }

  /**
   * A new match on this route map: what bots learnt in the last one (moves that went wrong,
   * and the searches made since) is forgotten, so every match starts the same.
   */
  forget() {
    for (const n of this.nodes) for (const l of n.links) if (l.penalty) this.penalize(l, 0);
    this.searches = null;
    this.spareSearch = null;
  }

  /**
   * The links turned round, as flat arrays: the spots with a link into spot i are
   * into[intoFrom[i]] to into[intoFrom[i + 1] - 1] (worked out again with _flat()).
   */
  _into() {
    const g = this._flat();
    if (g.into) return g.into;
    const n = this.nodes.length, e = g.to.length;
    const intoFrom = new Int32Array(n + 1), into = new Int32Array(e);
    for (let k = 0; k < e; k++) intoFrom[g.to[k] + 1]++;
    for (let i = 0; i < n; i++) intoFrom[i + 1] += intoFrom[i];
    const fill = intoFrom.slice(0, n);
    for (let i = 0; i < n; i++) for (let k = g.from[i]; k < g.from[i + 1]; k++) into[fill[g.to[k]]++] = i;
    return (g.into = { intoFrom, into });
  }

  /**
   * Cheapest cost from `start` to every node: { cost: Float64Array, prev: Int32Array, via: [] }.
   * into: an earlier result to work in rather than new arrays (it's overwritten, and returned).
   */
  costsFrom(start, into = null) {
    const n = this.nodes.length;
    const reuse = !!into && into.cost.length === n;
    const cost = reuse ? into.cost.fill(Infinity) : new Float64Array(n).fill(Infinity);
    const prev = reuse ? into.prev.fill(-1) : new Int32Array(n).fill(-1);
    // (via is only read where prev says a link led there, so what's left from before can stay.)
    const via = reuse ? into.via : new Array(n);
    let done = this._done;
    if (done && done.length === n) done.fill(0);
    else done = this._done = new Uint8Array(n);
    const g = this._flat(), from = g.from, linkTo = g.to, linkCost = g.cost, penalty = g.penalty, link = g.link;
    cost[start.id] = 0;
    // A binary heap of (cost, node) in two typed arrays, so a search makes no garbage.
    // (Each link can add one entry at most.)
    if (heapCost.length <= g.to.length) { heapCost = new Float64Array(g.to.length * 2 + 16); heapNode = new Int32Array(g.to.length * 2 + 16); }
    const hc = heapCost, hn = heapNode;
    let size = 1;
    hc[0] = 0; hn[0] = start.id;
    while (size) {
      // Take the cheapest.
      const c = hc[0], id = hn[0];
      size--;
      if (size) {
        hc[0] = hc[size]; hn[0] = hn[size];
        for (let i = 0; ;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < size && hc[l] < hc[m]) m = l;
          if (r < size && hc[r] < hc[m]) m = r;
          if (m === i) break;
          const tc = hc[m], tn = hn[m];
          hc[m] = hc[i]; hn[m] = hn[i]; hc[i] = tc; hn[i] = tn;
          i = m;
        }
      }
      if (done[id]) continue;
      done[id] = 1;
      for (let k = from[id], end = from[id + 1]; k < end; k++) {
        // (penalty: extra cost bots add to moves that went wrong for them, see bot.js)
        const to = linkTo[k], nc = c + linkCost[k] + penalty[k];
        if (nc < cost[to]) {
          cost[to] = nc;
          prev[to] = id;
          via[to] = link[k];
          // Add it, and let it rise to its place.
          let i = size++;
          hc[i] = nc; hn[i] = to;
          while (i > 0) {
            const p = (i - 1) >> 1;
            if (hc[p] <= hc[i]) break;
            const tc = hc[p], tn = hn[p];
            hc[p] = hc[i]; hn[p] = hn[i]; hc[i] = tc; hn[i] = tn;
            i = p;
          }
        }
      }
    }
    return reuse ? into : { cost, prev, via };
  }

  /**
   * costsFrom(), but remembered for a couple of seconds and shared: in big
   * games, lots of bots plan from the same spots. (A recent search is plenty
   * good enough: it only matters which way to go.) A search is worked out in the
   * arrays of the one it replaces, or of the last one dropped from the cache.
   */
  cachedCostsFrom(start, tick) {
    const cache = (this.searches ||= new Map());
    const hit = cache.get(start.id);
    if (hit && tick - hit.tick < 120 && tick >= hit.tick) return hit.search;
    const search = this.costsFrom(start, hit ? hit.search : this.spareSearch);
    if (!hit) this.spareSearch = null;
    cache.delete(start.id);
    cache.set(start.id, { tick, search });
    if (cache.size > 200) {
      // (Oldest first.)
      const oldest = cache.keys().next().value;
      this.spareSearch = cache.get(oldest).search;
      cache.delete(oldest);
    }
    return search;
  }

  /**
   * costsFrom(), in the same arrays every time: for a search used straight away and
   * then let go of (the next one overwrites it).
   */
  costsFromHere(start) {
    return (this.hereSearch = this.costsFrom(start, this.hereSearch));
  }

  /** The list of links from the search's start to `goal`, or null if unreachable. */
  pathTo(search, goal) {
    if (!goal || search.cost[goal.id] === Infinity) return null;
    const links = [];
    for (let id = goal.id; search.prev[id] >= 0; id = search.prev[id]) links.push(search.via[id]);
    return links.reverse();
  }
}

const byId = (a, b) => a.id - b.id;

/** Stretches [[a, b], ...] less the open stretch (l, r). */
function without(stretches, l, r) {
  const out = [];
  for (const [a, b] of stretches) {
    if (r <= a || l >= b) { out.push([a, b]); continue; }
    // (What's left can be a single point, as the stretch taken out is open: a soldier wedged in exactly.)
    if (l >= a) out.push([a, l]);
    if (r <= b) out.push([r, b]);
  }
  return out;
}

// Scratch space for costsFrom()'s heap (grown when needed).
let heapCost = new Float64Array(1024), heapNode = new Int32Array(1024);
