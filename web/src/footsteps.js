// Other soldiers' footsteps, heard: someone running near you makes a step every stride, quieter
// with distance and to the side they're on, so you can hear an enemy coming before you see them
// (creeping along crouched is silent, as it is to bots that listen: game.js's noise). Worked out
// where it's heard, from how each soldier's seen to move, so it's the same offline and online and
// nothing's sent for it. Your own aren't played.

import { PHYS, MOTION } from './config.js';

/** A step each this far run (px), and how far off one's heard: an enemy's, and a team-mate's. */
export const STRIDE = 34, STEP_RANGE = 540, MATE_RANGE = 300;
/** No more than this many soldiers' steps in a frame (the nearest come first in small games; in big ones, the first found). */
const MOST = 8;

// (How far each has run since their last step, and where they were last seen.)
const run = new WeakMap();

/**
 * This frame's footsteps near the listener at (ex, ey), added to `sounds` (the game's queue, played
 * after: audio.js's playQueue, which uses each one's own range). `me`: the player, whose own aren't heard.
 * Returns how many were added.
 */
export function footsteps(game, me, ex, ey, sounds) {
  const near = game.near ? game.near(ex - STEP_RANGE, ey - STEP_RANGE, ex + STEP_RANGE, ey + STEP_RANGE) : game.soldiers;
  const creep = PHYS.runSpeed * MOTION.timeScale * 0.6;
  let n = 0;
  for (let i = 0; i < near.length && n < MOST; i++) {
    const s = near[i];
    if (s === me || !s.alive || s.hidden || s.npc?.kind === 'animal') continue;
    const b = s.body;
    let r = run.get(s);
    if (!r) { run.set(s, r = { x: b.x, d: 0 }); continue; }
    const dx = Math.abs(b.x - r.x);
    r.x = b.x;
    // (Not a step: in the air, crouched, hardly moving, or somewhere else altogether: respawned.)
    if (!b.onGround || b.crouching || dx > 40 || Math.abs(b.vx) < creep) { if (dx > 40) r.d = 0; continue; }
    r.d += dx;
    if (r.d < STRIDE) continue;
    r.d %= STRIDE;
    const mate = !!game.rules.teams && s.team === me.team;
    const range = mate ? MATE_RANGE : STEP_RANGE;
    if (Math.hypot(b.x - ex, b.y - ey) > range) continue;
    sounds.push({ name: 'step', x: b.x, y: b.y + 10, to: null, range });
    n++;
  }
  return n;
}
