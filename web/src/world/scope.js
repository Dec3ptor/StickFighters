// Looking down a scope (a world's guns: a scope fitted, attachments.js, or a sniper rifle's own).
// Right click held, the view zooms in on what's under the crosshair (it stays under it, everything
// round it growing), and can be steered out from there as far as the scope reaches, but only where
// the one looking could see from where they stand: never through a wall, into a hill or a cave,
// nor into land not made yet (glass, windows and leaves are seen through). The wheel zooms in and
// out. main.js runs it each frame; nothing in the game changes but the view (and so where the
// crosshair aims).
//
// Steering: in the middle of the screen the view holds still, to aim; further out, it glides the
// way the crosshair is, faster the nearer the edge, as fast on the screen whatever the zoom (as
// easy to follow zoomed right in), and kept at the edge a while, faster still (the best scopes
// reach hundreds of blocks). The mouse out of the window: it stops.

/** The still middle: this far to the screen's edge (0 the middle, 1 the edge; an ellipse). */
export const SCOPE_DEAD = 0.55;
/** From here on out: full speed. */
export const SCOPE_FULL = 0.95;
/** Full speed: screens a second (the screen's wider way), as seen on it. */
export const SCOPE_SPEED = 0.85;
/** How far above where a soldier's drawn they see from (px). */
export const SCOPE_EYE = 12;
const ZOOM_STEP = 1.25;          // each notch of the wheel
const ZOOM_EASE = 0.16;          // how much of the way the zoom goes each 60th of a second
const BOOST_FROM = 0.4;          // s at full speed before it picks up...
const BOOST_AT = 1.8;            // ...and when it's all there
const MARGIN = 10;               // px kept short of what's in the way

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

/** How much faster, at most, kept at the edge: none for short scopes, up to 8× for the longest. */
export const boostOf = reach => 1 + clamp((reach - 40) / 60, 0, 7);

/** A scope's view, not looking yet (main.js keeps one). */
export function newScopeView() {
  // (vx, vy: the view's middle, in the world; z: its zoom now, zoom: where that's going; x, y: the
  // camera's offset from who's followed, for coming back after.)
  return { on: false, x: 0, y: 0, vx: 0, vy: 0, z: 1, zoom: 1, mag: 1, reach: 0, held: 0, anchor: null, blocked: false };
}

/**
 * How hard the crosshair steers the view, 0 to 1: 0 in the still middle, rising (smoothly) to 1
 * near the edge. mx, my: its offset from the screen's middle; W, H: the screen.
 */
export function pushOf(mx, my, W, H) {
  const e = Math.hypot(mx / (W / 2), my / (H / 2));
  return smooth((e - SCOPE_DEAD) / (SCOPE_FULL - SCOPE_DEAD));
}

/**
 * The view starts: from the camera where it is (cx, cy, zoomed z), zooming in on the point under
 * the crosshair (mx, my: its offset from the screen's middle; base: screen px a pixel of the world
 * at zoom 1). scope: attachments.js's { reach (blocks), mag }.
 */
export function scopeStart(sv, scope, cx, cy, z, mx, my, base) {
  sv.on = true;
  sv.reach = scope.reach;
  sv.mag = scope.mag;
  sv.zoom = scope.mag;
  sv.z = z;
  sv.vx = cx;
  sv.vy = cy;
  sv.held = 0;
  sv.blocked = false;
  sv.anchor = { x: cx + mx / (base * z), y: cy + my / (base * z), mx, my };
}

/** The wheel (notches; up, in, is negative): zoomed in or out, from none to the scope's own, on the point under the crosshair. */
export function scopeWheel(sv, notches, mx, my, base) {
  if (!notches || !sv.on) return;
  const want = clamp(sv.zoom * Math.pow(ZOOM_STEP, -notches), 1, sv.mag);
  if (Math.abs(want - sv.zoom) < 1e-6) return;
  sv.zoom = want;
  sv.anchor = { x: sv.vx + mx / (base * sv.z), y: sv.vy + my / (base * sv.z), mx, my };
}

/** Whether (x, y) can be seen from the eye (ex, ey). */
const sees = (world, ex, ey, x, y) => world.sight(ex, ey, x, y) >= 1;

/**
 * Each frame, looking down the scope: the zoom eased on (zooming in on its point), or the view
 * steered by the crosshair (mx, my from the screen's middle; W, H: the screen; out: the mouse is
 * out of the window), and kept in reach of the eye (ex, ey) and in its sight. world: TileWorld
 * (its sight). base: screen px a pixel of the world at zoom 1. dt: ms since the last frame.
 */
export function scopeFrame(sv, world, ex, ey, mx, my, W, H, base, dt, out = false) {
  const f = dt / (1000 / 60);
  sv.z = Math.abs(sv.zoom - sv.z) < 0.002 ? sv.zoom : sv.z + (sv.zoom - sv.z) * (1 - Math.pow(1 - ZOOM_EASE, f));
  // (Wherever it is, first in sight: whoever's looking may have moved, behind a wall, say.)
  backInSight(sv, world, ex, ey);
  let tx = sv.vx, ty = sv.vy;
  const push = out ? 0 : pushOf(mx, my, W, H);
  sv.blocked = false;
  if (sv.anchor) {
    // Zooming in (or out) on a point: it stays under the crosshair.
    const a = sv.anchor;
    tx = a.x - a.mx / (base * sv.z);
    ty = a.y - a.my / (base * sv.z);
    if (sv.z === sv.zoom) sv.anchor = null;
    sv.held = 0;
  } else if (push > 0) {
    // Steered: that way, as fast on the screen whatever the zoom; kept at the edge, faster.
    sv.held = push > 0.85 ? sv.held + dt / 1000 : 0;
    const boost = 1 + (boostOf(sv.reach) - 1) * smooth((sv.held - BOOST_FROM) / (BOOST_AT - BOOST_FROM));
    const d = Math.hypot(mx, my) || 1, step = push * SCOPE_SPEED * Math.max(W, H) * boost / (base * sv.z) * dt / 1000;
    tx = sv.vx + (mx / d) * step;
    ty = sv.vy + (my / d) * step;
  } else sv.held = 0;
  // As far as the scope reaches (from the eye), no further.
  const R = sv.reach * 16, dx = tx - ex, dy = ty - ey, L = Math.hypot(dx, dy);
  if (L > R) { tx = ex + dx * R / L; ty = ey + dy * R / L; }
  if (tx === sv.vx && ty === sv.vy) return sv;
  // And only where it can be seen: along what's in the way, if not all the way.
  if (sees(world, ex, ey, tx, ty)) { sv.vx = tx; sv.vy = ty; return sv; }
  sv.blocked = !sv.anchor;
  if (sees(world, ex, ey, tx, sv.vy)) sv.vx = tx;
  else if (sees(world, ex, ey, sv.vx, ty)) sv.vy = ty;
  return sv;
}

/** The view's middle, back where the eye can see it if it can't: along the line, short of what's in the way. */
function backInSight(sv, world, ex, ey) {
  const t = world.sight(ex, ey, sv.vx, sv.vy);
  if (t >= 1) return;
  const L = Math.hypot(sv.vx - ex, sv.vy - ey) || 1, k = Math.max(0, t - MARGIN / L);
  sv.vx = ex + (sv.vx - ex) * k;
  sv.vy = ey + (sv.vy - ey) * k;
}
