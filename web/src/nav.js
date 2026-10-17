// Route planning for bots.
//
// Nodes are spots a soldier can stand on. Links between them are found by
// simulating moves with the real physics (walk, jump left/right/up with
// different amounts of steering, step off ledges), so every link is a move
// that actually works in the game, including jump-pad launches.

import { BODY, PHYS } from './config.js';
import { makeBody, stepBody } from './physics.js';

const NODE_STEP = 12;
const MAX_SIM = 320;

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
    this._buildNodes();
    this._buildLinks();
  }

  _standable(x, y) {
    const m = this.map;
    if (m.overlap(x - BODY.halfW, y + BODY.top, x + BODY.halfW, y + BODY.bottom)) return false;
    return !!m.overlap(x - BODY.halfW, y + BODY.bottom, x + BODY.halfW, y + BODY.bottom + 1);
  }

  _buildNodes() {
    for (const s of this.map.solids) {
      if (s.bounce) continue;
      const y = s.t - BODY.bottom;
      // A soldier can stand partly hanging over an edge, so sample past the ends too.
      const x0 = s.l - BODY.halfW + 1, x1 = s.r + BODY.halfW - 1;
      const n = Math.max(1, Math.round((x1 - x0) / NODE_STEP));
      for (let i = 0; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n;
        if (this.nodes.some(o => Math.abs(o.y - y) < 0.5 && Math.abs(o.x - x) < NODE_STEP * 0.5)) continue;
        if (this._standable(x, y)) this.nodes.push({ id: this.nodes.length, x, y, links: [] });
      }
    }
    // Index nodes by row for quick lookups.
    this.rows = new Map();
    for (const n of this.nodes) {
      const k = Math.round(n.y);
      if (!this.rows.has(k)) this.rows.set(k, []);
      this.rows.get(k).push(n);
    }
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
    let best = null, bd = maxDist * maxDist;
    for (const n of this.nodes) {
      const dy = (n.y - y) * 1.6; // prefer nodes level with the point
      const d = (n.x - x) ** 2 + dy * dy;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  _simulate(start, inputAt) {
    const body = makeBody(start.x, start.y);
    body.onGround = true;
    let airborne = false;
    const bottom = this.map.bounds.bottom + 120;
    for (let t = 0; t < MAX_SIM; t++) {
      stepBody(body, inputAt(t, body, airborne), this.map);
      if (!body.onGround) airborne = true;
      else if (airborne) {
        const n = this.nodeAt(body.x, body.y, 7);
        return n && n !== start ? { node: n, ticks: t + 1 } : null;
      }
      if (body.y > bottom) return null;
      if (!airborne && t > 40) return null; // never left the ground
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
    // Walking between neighbouring spots.
    for (const a of this.nodes) {
      for (let dy = -PHYS.stepUp; dy <= PHYS.stepUp; dy++) {
        for (const b of this.rows.get(Math.round(a.y) + dy) || []) {
          if (b === a || Math.abs(b.x - a.x) > NODE_STEP + 1.5) continue;
          const dir = Math.sign(b.x - a.x);
          if (dir && this._walkReaches(a, b, dir)) {
            this._addLink(a, b, { type: 'walk', dir, cost: Math.abs(b.x - a.x) / PHYS.runSpeed + 1 });
          }
        }
      }
    }
    for (const a of this.nodes) {
      const walkL = a.links.some(l => l.type === 'walk' && l.dir < 0);
      const walkR = a.links.some(l => l.type === 'walk' && l.dir > 0);
      for (const j of JUMPS) {
        const r = this._simulate(a, t => ({ move: jumpSteer(j, t), jump: true, jumpPressed: t === 0 }));
        if (r) this._addLink(a, r.node, { type: 'jump', move: j, cost: r.ticks + 6 });
      }
      for (const d of DROPS) {
        if ((d.dir < 0 && walkL) || (d.dir > 0 && walkR)) continue;
        let fellAt = -1;
        const r = this._simulate(a, (t, body, airborne) => {
          if (airborne && fellAt < 0) fellAt = t;
          return { move: dropSteer(d, fellAt < 0 ? -1 : t - fellAt) };
        });
        if (r) this._addLink(a, r.node, { type: 'drop', move: d, cost: r.ticks + 3 });
      }
    }
    this.linkCount = this.nodes.reduce((n, a) => n + a.links.length, 0);
  }

  _walkReaches(a, b, dir) {
    const body = makeBody(a.x, a.y);
    body.onGround = true;
    for (let t = 0; t < 16; t++) {
      stepBody(body, { move: dir }, this.map);
      if (!body.onGround) return false;
      if ((body.x - b.x) * dir >= 0) return Math.abs(body.y - b.y) < 1;
    }
    return false;
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
        const nc = c + l.cost;
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
