// Route planning for bots.
//
// Nodes are spots a soldier can stand on. Links between them are found by
// simulating moves with the real physics (walk, jump left/right/up with
// different amounts of steering, step off ledges), so every link is a move
// that actually works in the game, including jump-pad launches.

import { BODY, PHYS, MOTION } from './config.js';
import { makeBody, stepBody } from './physics.js';

const NODE_STEP = 12;
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

  /** Spots to stand on along the top of solid s (only inside `area` { l, t, r, b }, if given). */
  _nodesOn(s, area = null) {
    if (s.bounce) return;
    const y = s.t - BODY.bottom;
    if (area && (y < area.t || y > area.b)) return;
    // A soldier can stand partly hanging over an edge, so sample past the ends too.
    const x0 = s.l - BODY.halfW + 1, x1 = s.r + BODY.halfW - 1;
    const n = Math.max(1, Math.round((x1 - x0) / NODE_STEP));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      if (area && (x < area.l || x > area.r)) continue;
      if (this._taken(x, y)) continue;
      if (this._standable(x, y)) this._addNode({ id: this.nodes.length, x, y, links: [] });
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
    for (const k of [Math.round(y) - 1, Math.round(y), Math.round(y) + 1]) {
      for (const n of this.rows.get(k) || []) {
        const d = Math.abs(n.x - x);
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
        for (const n of cells.get(cx * 100003 + cy) || []) if (Math.abs(n.x - x) < rx && Math.abs(n.y - y) < ry) out.push(n);
      }
    }
    return out.sort((a, b) => a.id - b.id);
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
   */
  _linkNode(a) {
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
    for (const j of this.jumps) {
      const r = this._simulate(a, t => ({ move: jumpSteer(j, t), jump: true, jumpPressed: t === 0 }), reach);
      if (r) this._addLink(a, r.node, { type: 'jump', move: j, cost: r.ticks + JUMP_COST / this.timeScale });
    }
    for (const d of this.drops) {
      if ((d.dir < 0 && walkL) || (d.dir > 0 && walkR)) continue;
      let fellAt = -1;
      const r = this._simulate(a, (t, body, airborne) => {
        if (airborne && fellAt < 0) fellAt = t;
        return { move: dropSteer(d, fellAt < 0 ? -1 : t - fellAt) };
      }, reach);
      if (r) this._addLink(a, r.node, { type: 'drop', move: d, cost: r.ticks + 3 });
    }
  }

  /**
   * Blocks changed inside `area` (destructible maps): find the spots there again,
   * and work out the moves again from every spot whose moves went near it. The
   * rest of the route map stays as it was. Spots are numbered afresh (bots plan
   * again afterwards).
   */
  patch(area) {
    // Spots whose standing room or floor was inside the area.
    const touched = n => n.x + BODY.halfW > area.l && n.x - BODY.halfW < area.r && n.y + BODY.bottom + 1 > area.t && n.y + BODY.top < area.b;
    const removed = new Set(this.nodes.filter(touched));
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
    let redone = 0;
    for (const a of this.nodes) {
      if (fresh.has(a) || besidePad(a) || !a.reach || near(a.reach)) { this._linkNode(a); redone++; }
      else if (removed.size) a.links = a.links.filter(l => !removed.has(l.to));
    }
    this.linkCount = this.nodes.reduce((n, a) => n + a.links.length, 0);
    this.searches = null;
    this.zoneCache = null;
    this._trapped = null;
    this.version = (this.version || 0) + 1;
    return { removed: removed.size, added: fresh.size, redone };
  }

  /** A copy of this route map, for a match whose map can change (on `map`, that match's map). */
  clone(map = this.map) {
    const g = Object.create(NavGraph.prototype);
    Object.assign(g, { map, timeScale: this.timeScale, maxSim: this.maxSim, jumps: this.jumps, drops: this.drops, version: 0, linkCount: this.linkCount });
    g.nodes = [];
    g.rows = new Map();
    for (const n of this.nodes) g._addNode({ id: n.id, x: n.x, y: n.y, links: [], reach: n.reach && { ...n.reach } });
    for (const n of this.nodes) g.nodes[n.id].links = n.links.map(l => ({ ...l, to: g.nodes[l.to.id], penalty: 0 }));
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
    const n = this.nodes.length;
    const index = new Int32Array(n).fill(-1), low = new Int32Array(n), onStack = new Uint8Array(n);
    const comp = new Int32Array(n).fill(-1);
    const stack = [];
    let next = 0, groupCount = 0;
    for (let root = 0; root < n; root++) {
      if (index[root] >= 0) continue;
      const work = [[root, 0]];
      index[root] = low[root] = next++;
      stack.push(root); onStack[root] = 1;
      while (work.length) {
        const top = work[work.length - 1];
        const [u, k] = top;
        const links = this.nodes[u].links;
        if (k < links.length) {
          top[1]++;
          const w = links[k].to.id;
          if (index[w] < 0) {
            index[w] = low[w] = next++;
            stack.push(w); onStack[w] = 1;
            work.push([w, 0]);
          } else if (onStack[w]) low[u] = Math.min(low[u], index[w]);
        } else {
          work.pop();
          if (work.length) { const p = work[work.length - 1][0]; low[p] = Math.min(low[p], low[u]); }
          if (low[u] === index[u]) {
            let w;
            do { w = stack.pop(); onStack[w] = 0; comp[w] = groupCount; } while (w !== u);
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
    const into = Array.from({ length: n }, () => []);
    for (const a of this.nodes) for (const l of a.links) into[l.to.id].push(a.id);
    const back = new Uint8Array(n), queue = [];
    for (let i = 0; i < n; i++) if (comp[i] === main) { back[i] = 1; queue.push(i); }
    while (queue.length) for (const j of into[queue.pop()]) if (!back[j]) { back[j] = 1; queue.push(j); }
    this._trapped = back.map(b => 1 - b);
    return this._trapped;
  }

  /** The spot a soldier dropped at (x, y) lands on (null: none, a pit or a jump pad). */
  landing(x, y) {
    const hit = this.map.raycast(x, y, x, y + 3000);
    return hit && hit.ny < 0 ? this.nodeAt(x, hit.y - BODY.bottom, 14) : null;
  }

  /** Cheapest cost from `start` to every node: { cost: Float64Array, prev: Int32Array, via: [] }. */
  costsFrom(start) {
    const n = this.nodes.length;
    const cost = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const via = new Array(n);
    const done = new Uint8Array(n);
    cost[start.id] = 0;
    // Small graphs: a simple binary heap keeps this fast enough to run often.
    const heap = [[0, start.id]];
    while (heap.length) {
      const [c, id] = popMin(heap);
      if (done[id]) continue;
      done[id] = 1;
      for (const l of this.nodes[id].links) {
        // (penalty: extra cost bots add to moves that went wrong for them, see bot.js)
        const nc = c + l.cost + (l.penalty || 0);
        if (nc < cost[l.to.id]) {
          cost[l.to.id] = nc;
          prev[l.to.id] = id;
          via[l.to.id] = l;
          pushHeap(heap, [nc, l.to.id]);
        }
      }
    }
    return { cost, prev, via };
  }

  /**
   * costsFrom(), but remembered for a couple of seconds and shared: in big
   * games, lots of bots plan from the same spots. (A recent search is plenty
   * good enough: it only matters which way to go.)
   */
  cachedCostsFrom(start, tick) {
    const cache = (this.searches ||= new Map());
    const hit = cache.get(start.id);
    if (hit && tick - hit.tick < 120 && tick >= hit.tick) return hit.search;
    const search = this.costsFrom(start);
    cache.delete(start.id);
    cache.set(start.id, { tick, search });
    if (cache.size > 200) cache.delete(cache.keys().next().value); // oldest first
    return search;
  }

  /** The list of links from the search's start to `goal`, or null if unreachable. */
  pathTo(search, goal) {
    if (!goal || search.cost[goal.id] === Infinity) return null;
    const links = [];
    for (let id = goal.id; search.prev[id] >= 0; id = search.prev[id]) links.push(search.via[id]);
    return links.reverse();
  }
}

function pushHeap(h, item) {
  h.push(item);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}

function popMin(h) {
  const top = h[0], last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}
