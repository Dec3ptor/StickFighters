// Remastered's map blocks, drawn as solid 2.5D blocks: each box gets depth behind
// it, as if seen from the camera, so you see the tops of floors below you, the
// undersides of ledges above, and the sides of walls, and they shift as you move.
//
// The play happens on the blocks' fronts; the depth is only drawn (nothing about
// the game changes). A side is drawn only along a block's open edges (not where
// it meets another block), worked out once per block and again only for blocks
// near a change (holes, building).

import { hatch } from '../map.js';
import { css } from './color.js';

export const DEPTH = 0.93;   // a block's back is this much of the way from the vanishing point to its front
const VP_LIFT = 50;          // the vanishing point sits this far above the camera's centre (more floor tops show)
const EDGE = 0.25;           // how far outside an edge to look for a neighbour

/** Stretches [[a, b]...] less (l, r). */
function cut(list, l, r) {
  const out = [];
  for (const [a, b] of list) {
    if (r <= a || l >= b) { out.push([a, b]); continue; }
    if (l > a) out.push([a, l]);
    if (r < b) out.push([r, b]);
  }
  return out;
}

export class Blocks {
  constructor() {
    this.open = new WeakMap(); // block -> its open edges { top, bottom, left, right }
    this.map = null;
    this.seen = 0;
    this.faces = [];
  }

  /** The open stretches of each edge of block s (not touching or inside another block). */
  edges(map, s) {
    let e = this.open.get(s);
    if (e) return e;
    let top = [[s.l, s.r]], bottom = [[s.l, s.r]], left = [[s.t, s.b]], right = [[s.t, s.b]];
    map.query(s.l - 1, s.t - 1, s.r + 1, s.b + 1, o => {
      if (o === s) return false;
      const yT = s.t - EDGE, yB = s.b + EDGE, xL = s.l - EDGE, xR = s.r + EDGE;
      if (o.t < yT && o.b > yT) top = cut(top, o.l, o.r);
      if (o.t < yB && o.b > yB) bottom = cut(bottom, o.l, o.r);
      if (o.l < xL && o.r > xL) left = cut(left, o.t, o.b);
      if (o.l < xR && o.r > xR) right = cut(right, o.t, o.b);
      return false;
    });
    const min = 0.5;
    e = {
      top: top.filter(([a, b]) => b - a > min), bottom: bottom.filter(([a, b]) => b - a > min),
      left: left.filter(([a, b]) => b - a > min), right: right.filter(([a, b]) => b - a > min),
    };
    this.open.set(s, e);
    return e;
  }

  /** Blocks changed since last time (holes, building): forget the open edges near the changes. */
  catchUp(map) {
    if (map !== this.map) { this.map = map; this.open = new WeakMap(); this.seen = map.editCount; return; }
    if (map.editCount === this.seen) return;
    const n = map.editCount - this.seen;
    this.seen = map.editCount;
    if (n > map.edits.length) { this.open = new WeakMap(); return; }
    for (const a of map.edits.slice(-n)) map.query(a.l - 2, a.t - 2, a.r + 2, a.b + 2, s => { this.open.delete(s); return false; });
  }

  /**
   * Draw the blocks in view for renderer r (world transform set): the sides first,
   * furthest from the vanishing point first, then the fronts with their edges.
   * mats: from textures.js; theme: for the light's direction and the edge colours.
   */
  draw(r, map, mats, theme, destruction) {
    this.catchUp(map);
    const ctx = r.ctx, v = r.view;
    const vx = r.cam.x, vy = r.cam.y - VP_LIFT, k = DEPTH;
    const bx = x => vx + (x - vx) * k, by = y => vy + (y - vy) * k;
    const lightLeft = (theme.light?.x ?? 0) < 0;
    const margin = Math.max(v.r - v.l, v.b - v.t) * (1 - k) * 0.6 + 10;
    const shown = [];
    map.query(v.l - margin, v.t - margin, v.r + margin, v.b + margin, s => { shown.push(s); return false; });
    const faces = this.faces;
    faces.length = 0;
    for (const s of shown) {
      const e = this.edges(map, s);
      const m = s.built ? mats.built : mats.main;
      if (s.t > vy) for (const [a, b] of e.top) faces.push({ kind: 'top', a, b, at: s.t, d: segDist(vx, vy, a, b, s.t, true), mat: s.bounce ? null : s.built ? mats.built : mats.top, s });
      if (s.b < vy) for (const [a, b] of e.bottom) faces.push({ kind: 'under', a, b, at: s.b, d: segDist(vx, vy, a, b, s.b, true), mat: m, s });
      if (s.l > vx) for (const [a, b] of e.left) faces.push({ kind: 'left', a, b, at: s.l, d: segDist(vx, vy, a, b, s.l, false), mat: m, s });
      if (s.r < vx) for (const [a, b] of e.right) faces.push({ kind: 'right', a, b, at: s.r, d: segDist(vx, vy, a, b, s.r, false), mat: m, s });
    }
    faces.sort((p, q) => q.d - p.d);
    for (const f of faces) {
      ctx.beginPath();
      if (f.kind === 'top' || f.kind === 'under') {
        ctx.moveTo(f.a, f.at); ctx.lineTo(f.b, f.at); ctx.lineTo(bx(f.b), by(f.at)); ctx.lineTo(bx(f.a), by(f.at));
      } else {
        ctx.moveTo(f.at, f.a); ctx.lineTo(f.at, f.b); ctx.lineTo(bx(f.at), by(f.b)); ctx.lineTo(bx(f.at), by(f.a));
      }
      ctx.closePath();
      if (f.s.bounce) ctx.fillStyle = f.kind === 'top' ? '#8fe36a' : '#2c3a2a';
      else {
        const shadeOf = f.kind === 'top' ? 'top' : f.kind === 'under' ? 'under' : (f.kind === 'left') === lightLeft ? 'lit' : 'side';
        // (Patterned on high quality; plain colours otherwise, quicker to fill.)
        ctx.fillStyle = r.quality === 'high' ? f.mat[shadeOf] : f.mat[shadeOf + 'Color'];
      }
      ctx.fill();
      // Darker further back (high quality only).
      if (r.quality === 'high' && f.kind !== 'top') {
        const h = f.kind === 'under';
        const g = h ? ctx.createLinearGradient(0, f.at, 0, by(f.at)) : ctx.createLinearGradient(f.at, 0, bx(f.at), 0);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.38)');
        ctx.fillStyle = g;
        ctx.fill();
      }
    }
    // The fronts.
    for (const s of shown) {
      if (s.bounce) continue;
      const m = s.built ? mats.built : mats.main;
      ctx.fillStyle = r.flat ? m.frontColor : m.front;
      ctx.fillRect(s.l, s.t, s.r - s.l, s.b - s.t);
    }
    // Indestructible blocks (destructible maps): a light hatching, as in the original.
    if (destruction) {
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (const s of shown) if (s.hard && !s.bounce) hatch(s.l, s.t, s.r, s.b, 10, (x0, y0, x1, y1) => { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); });
      ctx.stroke();
    }
    this.drawEdges(r, map, shown, mats, theme);
  }

  /** The open edges of the fronts: a lip of the top material, a lit rim on top, dark undersides. */
  drawEdges(r, map, shown, mats, theme) {
    const ctx = r.ctx, lip = theme.top === theme.material ? 0 : 3.2;
    // A lip of the top material (grass, snow, sand...) along the top edges.
    if (lip) {
      ctx.fillStyle = r.flat ? mats.top.frontColor : mats.top.front;
      for (const s of shown) {
        if (s.bounce || s.built) continue;
        for (const [a, b] of this.edges(map, s).top) ctx.fillRect(a, s.t, b - a, Math.min(lip, s.b - s.t));
      }
    }
    const rim = theme.rim || '#ffffff';
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = css(rim, 0.55);
    ctx.beginPath();
    for (const s of shown) for (const [a, b] of this.edges(map, s).top) { ctx.moveTo(a, s.t + 0.45); ctx.lineTo(b, s.t + 0.45); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const s of shown) {
      const e = this.edges(map, s);
      for (const [a, b] of e.bottom) { ctx.moveTo(a, s.b - 0.6); ctx.lineTo(b, s.b - 0.6); }
      for (const [a, b] of e.left) { ctx.moveTo(s.l + 0.6, a); ctx.lineTo(s.l + 0.6, b); }
      for (const [a, b] of e.right) { ctx.moveTo(s.r - 0.6, a); ctx.lineTo(s.r - 0.6, b); }
    }
    ctx.stroke();
  }
}

/** Distance from (px, py) to an edge: from a to b along y = at (horizontal) or x = at. */
function segDist(px, py, a, b, at, horizontal) {
  const along = horizontal ? px : py, across = horizontal ? py : px;
  const c = along < a ? a : along > b ? b : along;
  return Math.hypot(c - along, at - across);
}
