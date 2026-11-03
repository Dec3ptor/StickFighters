// What a soldier's doing with what's in their hands, for drawing it: a pickaxe's swing, a bite of
// an apple, a swig of a potion, a throw, a reload... An act runs from 0 to 1 (s.anim.use) at its
// own pace, then ends (soldier.js moves it on each update). stickman.js poses the arms for it and
// held.js draws what's in them; online, the host's acts go out with each soldier (protocol.js).

import { MOTION } from './config.js';

// (Their numbers go over the network: add new ones at the end.)
export const ACTS = ['', 'mine', 'chop', 'hammer', 'place', 'eat', 'drink', 'read', 'throw', 'stab', 'punch', 'smash', 'reload', 'reach', 'show'];
export const ACT_ID = new Map(ACTS.map((a, i) => [a, i]));

/**
 * Soldier s starts doing `act`, for `ticks` updates at full speed (slower games take longer, as
 * everything does). raw: exactly that many updates (a recall scroll's reading, timed in updates).
 */
export function startAct(s, act, ticks, raw = false) {
  const a = s.anim;
  if (!a) return;
  a.act = act;
  a.use = 0;
  a.rate = (raw ? 1 : MOTION.timeScale) / Math.max(1, ticks);
}

/** Soldier s stops doing `act` (or whatever they're doing, with none given). */
export function endAct(s, act = null) {
  const a = s.anim;
  if (a && (!act || a.act === act)) { a.act = ''; a.use = 0; }
}

/**
 * The act a melee weapon's swing makes, by how it looks: a knife stabs, fists punch, a world's
 * tools swing as they do at blocks (a pickaxe, an axe, a hammer), the rest swing hard.
 */
export function meleeAct(def) {
  switch (def?.look?.type) {
    case 'knife': return 'stab';
    case 'none': case 'glove': return 'punch';
    case 'pickaxe': return 'mine';
    case 'axe': return 'chop';
    case 'mallet': return 'hammer';
    case 'held': return def.look.sprite === 'hammer' ? 'hammer' : 'punch';
    default: return 'smash';
  }
}

/** The act a weapon that isn't fired makes as it's used (thrown, put down, called in), or null. */
export function launchAct(def) {
  switch (def?.kind) {
    case 'thrown': case 'walker': case 'flyer': return 'throw';
    case 'placed': case 'sentry': return 'place';
    case 'strike': case 'teleport': case 'quake': case 'kamikaze': return 'show';
    default: return null;
  }
}
