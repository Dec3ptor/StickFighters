// The Engineer's Builder (classes on). Click where you aim to:
//   - repair: on a destructible map, put back what explosions broke there
//     (the map as it was, in a square around where you aim), or
//   - build: put up a wall (standing on the floor below where you aim) or, after
//     a right click, a plank (a little platform, or a bridge over a hole).
// Each click uses a block; blocks come back over time (gadgets.js) and from ammo boxes.
//
// buildPlan() works out what a click would do, so the player's screen can show it
// before they click; build() does it. Built blocks are ordinary map blocks that
// explosions can break, even on maps that don't otherwise break. Online, the host
// builds, and new blocks go out to everyone with the holes (game.carves).

import { BODY } from './config.js';
import { subtractBox } from './map.js';
import { objectivesOf } from './objectives.js';
import { soldierBox, aimTarget } from './combat.js';

export const BUILD = {
  reach: 150,                 // how far from your shoulder you can build
  wall: { w: 12, h: 40 },     // a wall covers a soldier standing behind it
  plank: { w: 64, h: 10 },
  repair: 32,                 // a repair fills a square this far each way from where you aim
  keepClear: 40,              // no building this close to a spawn point, flag or M-COM
  minShare: 0.5,              // a block needs at least this much of it clear of the map to go up
  maxPieces: 24,              // at most this many new blocks in one go
  maxSolids: 6000,            // a map stops taking new blocks at this many (as with holes)
};

const area = b => (b.r - b.l) * (b.b - b.t);
const overlaps = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

/** Boxes less every block of the map in the way (pieces smaller than `min` px each way are dropped). */
function lessMap(map, boxes, min) {
  let out = boxes;
  for (const box of boxes) {
    map.query(box.l, box.t, box.r, box.b, s => {
      if (overlaps(s, box)) out = out.flatMap(p => subtractBox(p, s));
      return false;
    });
  }
  return out.filter(p => p.r - p.l >= min && p.b - p.t >= min);
}

/** Boxes less where soldiers are (with a pixel to spare), so nobody ends up inside a block. */
function lessSoldiers(game, boxes) {
  let out = boxes;
  for (const box of boxes) {
    for (const o of game.near(box.l - 10, box.t - 16, box.r + 10, box.b + 26)) {
      if (!o.alive) continue;
      const sb = soldierBox(o);
      const b = { l: sb.l - 1, t: sb.t - 1, r: sb.r + 1, b: sb.b + 1 };
      if (overlaps(b, box)) out = out.flatMap(p => subtractBox(p, b));
    }
  }
  return out;
}

/**
 * Where building isn't allowed: around spawn points, and the flags (capture the flag)
 * or M-COMs (rush) in play, so nobody can be walled in or wall them off.
 */
function keepClearOf(game) {
  if (game.buildKeepClear) return game.buildKeepClear;
  const map = game.map, k = BUILD.keepClear, out = [];
  for (const p of map.spawns) out.push({ l: p.x - k, t: p.y + BODY.top - k, r: p.x + k, b: p.y + BODY.bottom + 2 });
  const type = { ctf: 'flag', rush: 'mcom' }[game.mode];
  if (type) for (const o of objectivesOf(map, type)) out.push({ l: o.x - k, t: o.y - 30 - k, r: o.x + k, b: o.y + 2 });
  return (game.buildKeepClear = out);
}

/**
 * Where the soldier is building: where they aim, no further than the Builder
 * reaches, and stopping at the first block in the way (you can't build through walls).
 */
function buildSpot(game, s) {
  const sx = s.shoulderX, sy = s.shoulderY;
  let { x, y } = aimTarget(s);
  const dx = x - sx, dy = y - sy, d = Math.hypot(dx, dy) || 1;
  if (d > BUILD.reach) { x = sx + (dx / d) * BUILD.reach; y = sy + (dy / d) * BUILD.reach; }
  const hit = game.map.raycast(sx, sy, x, y);
  if (hit) { x = hit.x - (dx / d) * 1.5; y = hit.y - (dy / d) * 1.5; }
  return { x: Math.round(x), y: Math.round(y) };
}

/** On a destructible map: what's missing of the map as it was, in the repair square around (x, y). */
function missingAt(game, x, y) {
  const map = game.map;
  if (!map.original || !map.changed) return [];
  const r = BUILD.repair, sq = { l: x - r, t: y - r, r: x + r, b: y + r };
  const pieces = [];
  for (const o of map.original) {
    if (!overlaps(o, sq)) continue;
    pieces.push({ l: Math.max(o.l, sq.l), t: Math.max(o.t, sq.t), r: Math.min(o.r, sq.r), b: Math.min(o.b, sq.b) });
  }
  return pieces.length ? lessMap(map, pieces, 1) : [];
}

/**
 * What a click with the Builder would do now:
 * { kind: 'repair' | 'wall' | 'plank', boxes: [{ l, t, r, b }] (the blocks it adds),
 *   ok, why (when not ok), x, y (where) }.
 */
export function buildPlan(game, s) {
  const { x, y } = buildSpot(game, s);
  const map = game.map;
  const full = map.solids.length >= BUILD.maxSolids;
  // Repairs first: anything of the map missing right there is put back.
  const missing = missingAt(game, x, y);
  if (missing.length) {
    const boxes = lessSoldiers(game, missing).filter(p => p.r - p.l >= 1 && p.b - p.t >= 1).slice(0, BUILD.maxPieces);
    const ok = boxes.length > 0 && !full;
    return { kind: 'repair', x, y, boxes, ok, why: ok ? null : full ? "The map can't take any more" : 'Someone is in the way' };
  }
  const kind = s.buildPlank ? 'plank' : 'wall';
  const size = BUILD[kind];
  let l = x - Math.round(size.w / 2), t = y - Math.round(size.h / 2);
  if (kind === 'wall') {
    // A wall stands on the floor under where you aim (if there's one within its height).
    const floor = map.raycast(x, y, x, y + size.h);
    if (floor && floor.ny < 0) t = Math.round(floor.y) - size.h;
  } else {
    // A plank that would dip into a floor (or a ceiling) sits flush against it instead.
    const floor = map.raycast(x, y, x, y + size.h / 2);
    const ceiling = !floor && map.raycast(x, y, x, y - size.h / 2);
    if (floor && floor.ny < 0) t = Math.round(floor.y) - size.h;
    else if (ceiling && ceiling.ny > 0) t = Math.round(ceiling.y);
  }
  const block = { l, t, r: l + size.w, b: t + size.h };
  const plan = { kind, x, y, boxes: [block], ok: false, why: null };
  const bounds = map.bounds;
  if (block.l < bounds.left || block.r > bounds.right || block.t < bounds.top || block.b > bounds.bottom) plan.why = 'Out of bounds';
  else if (full) plan.why = "The map can't take any more";
  else if (keepClearOf(game).some(k => overlaps(k, block))) plan.why = 'Too close to a spawn point or objective';
  else if (game.near(block.l - 10, block.t - 16, block.r + 10, block.b + 26).some(o => o.alive && overlaps(soldierBox(o), block))) plan.why = 'Someone is in the way';
  else {
    // Only the part that's clear of the map goes up (so it fits snugly against walls and
    // floors), and not bits on the far side of a wall it would have gone through.
    const free = lessMap(map, [block], 2).filter(p => map.clearLine(x, y, (p.l + p.r) / 2, (p.t + p.b) / 2));
    const share = free.reduce((n, p) => n + area(p), 0) / area(block);
    if (share < BUILD.minShare) plan.why = 'No room there';
    else { plan.boxes = free.slice(0, BUILD.maxPieces); plan.ok = true; }
  }
  return plan;
}

/** Click with the Builder: repair or build, if it can go there. Returns true if it did. */
export function build(game, s) {
  const plan = buildPlan(game, s);
  if (!plan.ok) {
    if (!s.isBot && game.tick - (s.toldBuild ?? -999) > 45) { s.toldBuild = game.tick; game.notify(s, `Can't build there: ${plan.why.toLowerCase()}`); }
    return false;
  }
  game.addBlocks(plan.boxes, plan.kind !== 'repair');
  return true;
}
