// The sniper's views, right click held with a sniper rifle in a match, or in a world with any gun
// with a scope (world/attachments.js), the same in both:
//   - the sniper view: zoomed out and looking further toward the crosshair (render.js's camera);
//   - the far view, the wheel up: the camera goes to where the shot would end, the first thing
//     along the line it's aimed, a monster, an animal, anyone, or something solid (in a world,
//     short of land not made yet), or as far as it goes if nothing's in the way; that spot under
//     the crosshair. Then the camera stays put, so the crosshair can be put just where it's
//     wanted (the wheel up again: on to where the shot aimed now would end). There, whatever the
//     shooter couldn't see from where they stand, and anything further than the shot goes, is
//     darkened and hidden (render.js's fog, its range). The wheel down: back to the sniper view.
//     Let go of right click: back to the shooter.
// main.js runs it; nothing in the game changes but the camera (and so where the crosshair aims).

import { shotReach, hitSoldier } from './combat.js';

/** The views: none, the sniper view, the far view. */
export const SCOPE_OFF = 0, SCOPE_SNIPER = 1, SCOPE_FAR = 2;

/** A scope's state, nothing looked at yet (main.js keeps one). */
export function newScopeView() {
  // (mode: one of the above; x, y: the far view's middle, in the world; end: where the shot ends
  // there ({ x, y, hit, d }); reach: how far the shot goes (px).)
  return { mode: SCOPE_OFF, x: 0, y: 0, end: null, reach: 0 };
}

/**
 * Where a shot from (x0, y0) aimed at `aim` (radians) ends: at the first thing it meets, someone
 * it would hit (not `skip`, the one shooting, nor anyone their shots go through: a monster, an
 * animal, a foe) or something solid (in a world, short of land not made yet: what's there isn't
 * known), or as far as it goes (`reach`, px).
 * { x, y, hit (something stopped it), who (the one it hit, if someone), d (how far it went) }.
 */
export function shotEnd(game, x0, y0, aim, reach, skip = null) {
  const dx = Math.cos(aim) * reach, dy = Math.sin(aim) * reach;
  let t = 1;
  if (game.world?.sight) t = game.world.sight(x0, y0, x0 + dx, y0 + dy, true);
  else { const h = game.map.raycast(x0, y0, x0 + dx, y0 + dy); if (h) t = h.t; }
  // (Only someone the shot would hit: it goes through those it can't hurt, as townsfolk in a world.)
  const body = game.nearInto ? hitSoldier(game, x0, y0, dx, dy, skip, skip) : null;
  const who = body && body.t < t ? body.soldier : null;
  if (who) t = body.t;
  return { x: x0 + dx * t, y: y0 + dy * t, hit: t < 1, who, d: reach * t };
}

/**
 * The far view: where a shot of weapon `def` by `s` from (x0, y0), their shoulder, aimed at `aim`,
 * would end, and how far it goes. Sets sv's x, y (the shot's end: where the camera goes, putting
 * it under the crosshair, and then stays: main.js), end and reach, and the mode.
 */
export function lookFar(sv, game, s, x0, y0, aim, def) {
  sv.reach = shotReach(def);
  sv.end = shotEnd(game, x0, y0, aim, sv.reach, s);
  sv.x = sv.end.x;
  sv.y = sv.end.y;
  sv.mode = SCOPE_FAR;
  sv.fresh = true;
  return sv;
}

/**
 * The wheel while looking (notches: up is negative): up, the far view, where the shot aimed now
 * would end (aim(): [x0, y0, aim] of it), again if already there (on from where it is); down, back
 * to the sniper view.
 */
export function scopeWheel(sv, notches, game, s, def, aim) {
  if (!notches || sv.mode === SCOPE_OFF) return sv;
  if (notches < 0) { const [x0, y0, a] = aim(); return lookFar(sv, game, s, x0, y0, a, def); }
  sv.mode = SCOPE_SNIPER;
  sv.end = null;
  return sv;
}
