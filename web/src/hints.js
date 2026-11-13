// A new player's first matches: what the keys are, said as they come up rather than all at once.
// Each hint is shown once, ever (kept in the browser), the first time it'd help: sprinting after
// a few seconds of running, reloading when the magazine's low, the other weapon once there's one
// to switch to, crouching to steady a shot, the jetpack when one's picked up. They're ordinary
// messages on the screen ({key:...} is whatever that action's bound to: keys.js's keyText).

import { WEAPONS } from './weapons.js';

/** The hints: id, what it says, and when (given what the player's soldier is doing). */
export const HINTS = [
  { id: 'move', text: 'Move with {key:left} / {key:right}, jump with {key:jump}. Aim with the mouse and fire with {key:fire}.', when: c => c.secs > 1 },
  { id: 'sprint', text: 'Hold {key:sprint} to sprint.', when: c => c.secs > 12 && c.ranFor > 3 && !c.sprinted },
  { id: 'reload', text: 'Press {key:reload} to reload.', when: c => c.cap > 0 && c.left <= Math.max(1, c.cap * 0.25) },
  { id: 'switch', text: '{key:next} and {key:prev} change weapon; the number keys pick one.', when: c => c.guns >= 2 },
  { id: 'crouch', text: 'Crouch with {key:crouch} to shoot straighter (and to be less to hit).', when: c => c.secs > 30 && c.shots >= 12 && !c.crouched },
  { id: 'jetpack', text: 'A jetpack: hold {key:jump} in the air to fly.', when: c => c.jetpack },
  { id: 'aim', text: 'Hold {key:aim} to aim down the sights: a closer look, and a steadier shot.', when: c => c.secs > 50 && c.shots >= 25 && !c.aimed },
  { id: 'scores', text: 'Hold {key:scores} for the scores. Esc opens the menu.', when: c => c.secs > 75 },
];

/** How long between one hint and the next, at least (seconds). */
export const HINT_GAP = 9;

/** A player's hints: `seen` is the ids already shown (kept between visits). */
export function newHints(seen = []) {
  return { seen: new Set(seen), last: -1e9, ranFor: 0, shots: 0, sprinted: false, crouched: false, aimed: false, start: null };
}

/**
 * Once a second or so: the hint to show now, if any (its text), given the player's soldier `me`,
 * their input `inp` and the time `secs`. It's marked as seen.
 */
export function nextHint(h, me, inp, secs) {
  if (!me?.alive) return null;
  if (h.start == null) h.start = secs;
  if (inp?.move && me.body?.onGround) h.ranFor += 1; else if (!inp?.move) h.ranFor = 0;
  if (inp?.fire) h.shots++;
  h.sprinted ||= !!me.body?.sprinting;
  h.crouched ||= !!me.body?.crouching;
  h.aimed ||= !!inp?.alt;
  if (secs - h.last < HINT_GAP) return null;
  const w = me.weapons?.[me.current] || {};
  const guns = Object.keys(me.weapons || {}).filter(id => WEAPONS[id] && !WEAPONS[id].tool && WEAPONS[id].kind !== 'melee' && (me.has ? me.has(id) : true)).length;
  const c = { secs: secs - h.start, ranFor: h.ranFor, sprinted: h.sprinted, crouched: h.crouched, aimed: h.aimed, shots: h.shots,
    cap: WEAPONS[me.current]?.mag || 0, left: w.mag ?? Infinity, guns, jetpack: !!me.body?.hasJetpack };
  for (const hint of HINTS) {
    if (h.seen.has(hint.id) || !hint.when(c)) continue;
    h.seen.add(hint.id);
    h.last = secs;
    return hint.text;
  }
  return null;
}
