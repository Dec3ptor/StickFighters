// The sniper's views, right click held with a sniper rifle in a match, or in a world with any gun
// with a scope (world/attachments.js), the same in both:
//   - the sniper view: zoomed out and looking further toward the crosshair (render.js's camera);
//   - the far view, the wheel up: the camera goes to where the shot would end, the first solid
//     thing along the line it's aimed (in a world, short of land not made yet), or as far as it
//     goes if nothing's in the way, and that's where the crosshair is: it stays on the shot's end
//     as the mouse moves, the camera following it. There, whatever the shooter couldn't see from
//     where they stand, and anything further than the shot goes, is darkened and hidden (render.js's
//     fog, its range). The wheel down: back to the sniper view. Let go of right click: back to the
//     shooter.
// main.js runs it; nothing in the game changes but the camera (and so where the crosshair aims).

import { shotReach } from './combat.js';

/** The views: none, the sniper view, the far view. */
export const SCOPE_OFF = 0, SCOPE_SNIPER = 1, SCOPE_FAR = 2;

/** A scope's state, nothing looked at yet (main.js keeps one). */
export function newScopeView() {
  // (mode: one of the above; x, y: the far view's middle, in the world; end: where the shot ends
  // there ({ x, y, hit, d }); reach: how far the shot goes (px).)
  return { mode: SCOPE_OFF, x: 0, y: 0, end: null, reach: 0 };
}

/**
 * Where a shot from (x0, y0) aimed at `aim` (radians) ends: at the first solid thing it meets (in a
 * world, short of land not made yet: what's there isn't known), or as far as it goes (`reach`, px).
 * { x, y, hit (something stopped it), d (how far it went) }.
 */
export function shotEnd(game, x0, y0, aim, reach) {
  const x1 = x0 + Math.cos(aim) * reach, y1 = y0 + Math.sin(aim) * reach;
  if (game.world?.sight) {
    const t = game.world.sight(x0, y0, x1, y1, true);
    return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, hit: t < 1, d: reach * t };
  }
  const h = game.map.raycast(x0, y0, x1, y1);
  return h ? { x: h.x, y: h.y, hit: true, d: Math.hypot(h.x - x0, h.y - y0) } : { x: x1, y: y1, hit: false, d: reach };
}

/**
 * The far view, each frame: where a shot of weapon `def` from (x0, y0), the shoulder, aimed at
 * `aim`, would end, and how far it goes. Sets sv's x, y (the shot's end: the camera puts it under
 * the crosshair, main.js), end and reach.
 */
export function lookFar(sv, game, x0, y0, aim, def) {
  sv.reach = shotReach(def);
  sv.end = shotEnd(game, x0, y0, aim, sv.reach);
  sv.x = sv.end.x;
  sv.y = sv.end.y;
  return sv;
}

/** The wheel while looking (notches: up is negative): up, the far view; down, back to the sniper view. */
export function scopeWheel(sv, notches) {
  if (!notches || sv.mode === SCOPE_OFF) return sv;
  sv.mode = notches < 0 ? SCOPE_FAR : SCOPE_SNIPER;
  if (sv.mode === SCOPE_SNIPER) sv.end = null;
  return sv;
}
