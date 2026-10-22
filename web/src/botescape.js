// Bots getting themselves out of trouble, before self-destructing (the last resort):
//   - a jetpack flies them out of a pit, or up to where they couldn't get by jumping;
//   - a hammer (or the Engineer's Builder) builds a way: plank steps up out of a pit or
//     up to a ledge, one at a time (put one up, jump onto it, look again; in a shaft too
//     narrow for a step beside us, jump and put one under our feet at the top of the
//     jump), or planks across a gap, walked onto as they go;
// and, in a fight at range, a wall for cover. The route map doesn't know about new
// blocks for a moment, so a bot checks from where it stands (nav.escape: walks, jumps
// and drops tried with the real physics) whether it can get on from there.

import { buildPlan } from './building.js';
import { BODY, PHYS } from './config.js';
import { angleDiff } from './util.js';

const STEP = { up: 78, low: 60, out: 42 };   // a step's top above our feet, and its middle across from us
const HAMMER_CLIMB = 8 * 70;                   // about how high a hammer's blocks make steps
const TOOLS = ['Hammer', 'Builder'];

/** The building tool a soldier has blocks left for (the Hammer, or the Engineer's Builder), or null. */
export function buildTool(s) {
  for (const id of TOOLS) if (s.weapons[id]?.ammo > 0) return id;
  return null;
}

/** Blocks left to build with (all tools). */
export const blocksLeft = s => TOOLS.reduce((n, id) => n + (s.weapons[id]?.ammo || 0), 0);

/** The jetpack fuel it takes to fly up from soldier s to `to`, with some to spare (more than 100: it can't). */
export function flyFuel(s, to) {
  const up = Math.max(0, s.y - to.y) + 20;
  return 10 + up * (PHYS.jetDrain / PHYS.jetMaxUp) * 1.05;
}

/** True if soldier s has a way of its own up or over to `to` (a spot): blocks to build with, or a jetpack that can fly that high. */
export function canGetPast(s, to) {
  return blocksLeft(s) >= 2 || (!!s.body.hasJetpack && flyFuel(s, to) <= 100);
}

/**
 * True if picking up item `it` would give soldier s a way up or over to `to`, starting
 * from `from` (a spot): a jetpack that can fly that high (if it hasn't one already), or a
 * hammer (if it's out of blocks) whose blocks make steps that high.
 */
export function toolFor(s, it, to, from = s) {
  if (it.type === 'jetpack') return !s.body.hasJetpack && flyFuel(from, to) <= 100;
  return it.type === 'weapon' && it.weapon === 'Hammer' && blocksLeft(s) < 2 && from.y - to.y < HAMMER_CLIMB;
}

/** What a click with a building tool, aimed at (x, y), would put up (a plank, or a wall). Leaves the soldier as it was. */
export function planAt(game, s, x, y, plank) {
  const keep = [s.aim, s.aimDist, s.buildPlank];
  s.aim = Math.atan2(y - s.shoulderY, x - s.shoulderX);
  s.aimDist = Math.hypot(x - s.shoulderX, y - s.shoulderY);
  s.buildPlank = plank;
  const plan = buildPlan(game, s);
  [s.aim, s.aimDist, s.buildPlank] = keep;
  return plan;
}

/** Aim at (x, y) this update (and say how far: building goes where the aim ends). */
function aimAt(s, inp, x, y) {
  inp.aim = Math.atan2(y - s.shoulderY, x - s.shoulderX);
  inp.aimDist = Math.hypot(x - s.shoulderX, y - s.shoulderY);
}

/**
 * Where to fly or build from to get to `to` (a spot, or { x, y }, it can't get to): of
 * the spots it can get to (`search`, and `ok`), one near it with open sky above, up to
 * its height (steps or a jetpack don't get up through a ceiling). Null if there's none.
 */
export function launchSpot(game, nav, search, to, ok, reach = 700) {
  let best = null, bs = Infinity;
  for (const n of nav.nodesNear(to.x, to.y, reach, reach)) {
    if (search.cost[n.id] === Infinity || !ok(n)) continue;
    const dy = n.y - to.y;
    if (dy > 20 && !openAbove(game.map, n.x, n.y - 24, to.y - 40)) continue;
    const v = Math.abs(n.x - to.x) + Math.max(0, dy) * 0.5 + Math.max(0, -dy) * 2 + search.cost[n.id] * 0.3;
    if (v < bs) { bs = v; best = n; }
  }
  return best;
}

/** True if nothing's in the way of a soldier at x going straight up from y to y2 (a ray up each side of them). */
function openAbove(map, x, y, y2) {
  const w = BODY.halfW + 1;
  return !map.raycast(x - w, y, x - w, y2) && !map.raycast(x + w, y, x + w, y2);
}

/** Where to get out of a pit to: the nearest spot with a way on to the rest of the map (ones above first). */
export function exitSpot(nav, s, reach = 900) {
  const trapped = nav.trapped();
  let best = null, bs = Infinity;
  for (const n of nav.nodesNear(s.x, s.y, reach, reach)) {
    if (trapped[n.id]) continue;
    const d = Math.hypot(n.x - s.x, n.y - s.y) + (n.y > s.y + 20 ? 300 : 0);
    if (d < bs) { bs = d; best = n; }
  }
  return best;
}

/**
 * A way on from exactly where soldier s stands (a walk, jump or drop that lands on a
 * spot, tried with the real physics): to somewhere that isn't a pit, or, given a `goal`
 * ({ x, y }), to somewhere with a way there. Null if there's none.
 */
export function wayOn(nav, s, goal = null) {
  if (goal) {
    const at = nav.nearest(goal.x, goal.y, 90);
    const reach = at && nav.reachers(at), trapped = nav.trapped();
    // (Nowhere to stand right there: anywhere about as high as it.)
    return nav.escape(s.x, s.y, n => reach ? reach[n.id] === 1 : n.y <= goal.y + 30 && !trapped[n.id]);
  }
  const link = nav.escape(s.x, s.y);
  return link && !nav.trapped()[link.to.id] ? link : null;
}

/**
 * Flying with the jetpack to point `to` ({ x, y }: where a soldier stands): up until
 * level with it (across as soon as the way across is clear), then over to it, and down.
 * f: { to, start, airborne }. Returns 'flying', 'landed' or 'failed'.
 */
export function fly(game, s, f, inp) {
  const b = s.body, map = game.map;
  if (game.tick - f.start > 600) return 'failed';
  if (b.onGround) {
    if (f.airborne) return 'landed';
    inp.jump = inp.jumpPressed = true;   // off the ground first
    return 'flying';
  }
  f.airborne = true;
  inp.jump = true;                       // (held: a jump let go of early is cut short)
  const dx = f.to.x - s.x, high = s.y < f.to.y - 26, d = Math.sign(dx);
  // (Open sky from our head up past its height, at x: somewhere we can fly up.)
  const top = Math.min(s.y - 40, f.to.y - 50);
  const open = x => openAbove(map, x, s.y - 20, top);
  // (And from up there, a clear line over to it: not up the far side of a wall.)
  const way = x => open(x) && map.clearLine(x, top, f.to.x, f.to.y - 20);
  // Something in the way across: up and over it.
  const wall = Math.abs(dx) > 8 && map.raycast(s.x, s.y - 4, s.x + d * 40, s.y - 4);
  // Across once high enough; lower down, only where it's open above (not in under a ledge).
  const across = Math.abs(dx) > 8 && !wall && (high || open(s.x + d * 16));
  inp.move = across ? d : 0;
  // Up while below it (or not yet over it, or a wall's in the way), then let it drop onto the spot.
  inp.jet = (s.y > f.to.y - 34 || !!wall) && !(Math.abs(dx) < 10 && s.y < f.to.y - 6);
  // (Under a ceiling: out from under it to where there's a way up and over, the nearer way.)
  if (inp.jet && !across && !open(s.x)) {
    if (!f.out || game.tick - f.outAt > 30) {
      f.outAt = game.tick;
      f.out = 0;
      for (let k = 12; k <= 480 && !f.out; k += 12) f.out = way(s.x + d * k) ? d : way(s.x - d * k) ? -d : 0;
      for (let k = 12; k <= 360 && !f.out; k += 12) f.out = open(s.x + d * k) ? d : open(s.x - d * k) ? -d : 0;
    }
    inp.move = f.out || d || 1;
  }
  return 'flying';
}

/**
 * Building a way on, a block at a time. c: { mode: 'up' (steps) or 'across' (a bridge),
 * dir, phase ('check', 'place', 'jump', 'walk' or 'pillar'), plank, misses, steps, start }.
 * Returns 'building', 'out' (a way on from here: c.link), or 'failed'.
 */
export function climb(game, s, c, inp, nav) {
  const b = s.body;
  if (game.tick - c.start > 60 * 40) return 'failed';
  const feet = s.y + BODY.bottom;
  if (c.phase === 'check') {
    if (!b.onGround) return 'building';
    const link = wayOn(nav, s, c.goal);
    // (An easy way on: a walk, a drop, or a jump not much higher. A long jump up could miss
    // and send us back down: another step first, if there are blocks for it. A bridge goes
    // all the way across: a long jump over what's left could fall short.)
    const blocks = !!buildTool(s);
    const easy = link && (link.type !== 'jump' || link.to.y > s.y - 40 || !blocks);
    const done = c.mode === 'across' ? !gapAhead(game, s, c.dir) || (link && !blocks) : easy;
    if (done) { c.link = link; return 'out'; }
    c.phase = 'place';
  }
  if (c.phase === 'place') {
    if (!b.onGround) return 'building';
    const tool = buildTool(s);
    if (!tool) return 'failed';
    if (s.current !== tool) { inp.switchTo = tool; return 'building'; }
    inp.switchTo = undefined;   // (not back to a gun just now)
    inp.plank = true;
    if (!c.aim) {
      c.aim = choosePlank(game, s, c, feet);
      // (No room for a step beside us, in a narrow shaft say: one under our feet instead.)
      if (!c.aim) {
        if (c.mode !== 'up') return 'failed';
        c.phase = 'pillar';
        c.jumpAt = -1;
        return 'building';
      }
      c.ammo = s.weapons[tool].ammo;
      c.waited = 0;
    }
    aimAt(s, inp, c.aim.x, c.aim.y);
    // (Once the aim's there, a click puts it up: building goes where the aim ends. Clicks, not a held button.)
    if (Math.abs(angleDiff(s.aim, inp.aim)) < 0.05 && s.buildPlank && s.cooldown <= 0) inp.fire = game.tick % 2 === 0;
    if (s.weapons[tool].ammo < c.ammo) {
      c.plank = c.aim.box;
      c.dir = c.aim.dir;
      // (Onto a step, or out along a bridge.)
      c.phase = c.aim.rise ? 'jump' : 'walk';
      c.aim = null;
      c.t = 0;
      c.jumpAt = -1;
    } else if (++c.waited > 90) return 'failed';
    return 'building';
  }
  if (c.phase === 'pillar') return pillar(game, s, c, inp, feet);
  const p = c.plank;
  if (c.phase === 'jump') {
    // Straight up beside the step, then across onto it.
    c.t++;
    if (b.onGround && c.jumpAt >= 0 && game.tick - c.jumpAt > 3) {
      // Landed: on it, or back where we were (try again, a couple of times).
      c.jumpAt = -1;
      if (Math.abs(feet - p.t) < 4 && s.x > p.l - 4 && s.x < p.r + 4) { c.steps++; c.phase = 'check'; c.misses = 0; return 'building'; }
      if (++c.misses >= 3) return 'failed';
      c.t = 0;
    }
    if (b.onGround && c.jumpAt < 0) {
      // Lined up beside it first (not under it: we'd hit our head).
      const edge = c.dir > 0 ? p.l - BODY.halfW - 3 : p.r + BODY.halfW + 3;
      if (Math.abs(s.x - edge) > 4 && c.t < 60) { inp.move = Math.sign(edge - s.x); return 'building'; }
      if (Math.abs(b.vx) > 0.5) return 'building';   // (standing still first)
      inp.jump = inp.jumpPressed = true;
      c.jumpAt = game.tick;
      return 'building';
    }
    inp.jump = true;
    inp.move = feet < p.t - 2 ? c.dir : 0;
    return 'building';
  }
  if (c.phase === 'walk') {
    // Out along the bridge to its far end (or onto the floor beyond).
    c.t++;
    const end = c.dir > 0 ? p.r - 8 : p.l + 8;
    if (!b.onGround && feet > p.t + 30) return 'failed';     // fell off it
    if ((end - s.x) * c.dir <= 0 || c.t > 150) { c.phase = 'check'; return 'building'; }
    inp.move = c.dir;
    return 'building';
  }
  return 'failed';
}

/**
 * Up a shaft with no room for a step beside us: jump straight up, and at the top of the
 * jump put a plank under our feet (it fills the shaft), then land on it and look again.
 */
function pillar(game, s, c, inp, feet) {
  const b = s.body, tool = buildTool(s);
  if (!tool) return 'failed';
  if (s.current !== tool) { inp.switchTo = tool; return 'building'; }
  inp.switchTo = undefined;
  if (b.onGround && c.jumpAt >= 0 && game.tick - c.jumpAt > 3) {
    // Landed: on the new block (higher than we were), or back down (again, a couple of times).
    c.jumpAt = -1;
    if (s.weapons[tool].ammo < c.ammo && feet < c.from - 30) { c.steps++; c.misses = 0; c.phase = 'check'; c.wall = null; return 'building'; }
    if (++c.misses >= 3) return 'failed';
  }
  if (b.onGround && c.jumpAt < 0 && c.wall == null) {
    // What goes up at the top of the jump (about 95 px up): a plank, or in a shaft too narrow
    // for one, a wall stood on end. Neither (by a spawn point, say): not here.
    const plank = planAt(game, s, s.x, feet - 86, true).ok;
    if (!plank && !planAt(game, s, s.x, feet - 71, false).ok) return 'failed';
    c.wall = !plank;
  }
  inp.plank = !c.wall;
  // (Aimed just under our feet the whole way: the block's top a few pixels below them.)
  aimAt(s, inp, s.x, feet + (c.wall ? 24 : 9));
  const aimed = Math.abs(angleDiff(s.aim, inp.aim)) < 0.05 && s.buildPlank === !c.wall;
  if (b.onGround) {
    if (c.jumpAt >= 0) return 'building';
    if (Math.abs(b.vx) > 0.5 || !aimed || s.cooldown > 0) return 'building';   // (still, aimed and ready first)
    c.ammo = s.weapons[tool].ammo;
    c.from = feet;
    inp.jump = inp.jumpPressed = true;
    c.jumpAt = game.tick;
    return 'building';
  }
  inp.jump = true;   // (held: the full height)
  // At the top of the jump (and only one block a jump).
  if (b.vy > -0.6 && aimed && s.cooldown <= 0 && s.weapons[tool].ammo === c.ammo) inp.fire = game.tick % 2 === 0;
  return 'building';
}

/** True if there's no floor ahead (a gap) within a fall we'd take, `dir` from soldier s. */
function gapAhead(game, s, dir) {
  const feet = s.y + BODY.bottom, x = s.x + dir * (BODY.halfW + 10);
  const hit = game.map.raycast(x, feet - 4, x, feet + 140);
  return !hit || hit.y > feet + 100;
}

/**
 * Where the next plank goes: a step up and across (toward the goal first, if there's one,
 * or carrying on the way the steps go; then the other way; then lower), or level with our
 * feet across a gap. { x, y, box, dir } or null.
 */
function choosePlank(game, s, c, feet) {
  const tries = [], first = c.goal ? Math.sign(c.to.x - s.x) || c.dir : c.dir;
  // (Up as high as where we're going, the last step needs no room above it.)
  const level = c.to.y + BODY.bottom + 10;
  if (c.mode === 'across') tries.push([c.dir, 0, BODY.halfW + 36]);
  for (const d of [first, -first]) for (const rise of [STEP.up, STEP.low]) tries.push([d, rise, STEP.out]);
  for (const [d, rise, out] of tries) {
    const x = s.x + d * out, y = feet - rise + 5;
    const plan = planAt(game, s, x, y, true);
    // (Over a hole explosions made, a click puts the floor back as it was: as good as a bridge.)
    if (!plan.ok || (plan.kind !== 'plank' && !(plan.kind === 'repair' && !rise))) continue;
    const box = plan.boxes.reduce((a, q) => ({ l: Math.min(a.l, q.l), t: Math.min(a.t, q.t), r: Math.max(a.r, q.r), b: Math.max(a.b, q.b) }));
    // A step must be one we can jump onto from beside it; a bridge must carry on from our floor.
    if (rise ? feet - box.t < 30 || box.r - box.l < 24 : Math.abs(box.t - feet) > 3) continue;
    if (rise && (box.l < s.x + BODY.halfW + 2 && box.r > s.x - BODY.halfW - 2)) continue;   // right over our head
    // (Room to stand on it and jump up again: not tucked in under a ledge.)
    const mid = (box.l + box.r) / 2;
    if (rise && box.t > level && game.map.raycast(mid, box.t - 1, mid, box.t - 120)) continue;
    return { x, y, box, dir: d, rise };
  }
  return null;
}

/**
 * Where a wall for cover goes, between soldier s and an enemy standing at x = ex: a step
 * toward them, standing on our floor. { x, y } if one can go up there, else null.
 */
export function coverSpot(game, s, ex) {
  const d = Math.sign(ex - s.x) || 1, x = s.x + d * 26, y = s.y + BODY.bottom - 22;
  const plan = planAt(game, s, x, y, false);
  if (!plan.ok || plan.kind !== 'wall') return null;
  // (Low enough to stand behind: it stands on our floor.)
  const box = plan.boxes[0];
  return Math.abs(box.b - (s.y + BODY.bottom)) < 3 && box.b - box.t >= 30 ? { x, y } : null;
}
