// Sleeping (world mode). Right click a bed and it's where you come back after dying; at night
// (and with no monsters about) you lie down in it and sleep. Playing alone, the night goes by
// quickly (the sky turning, the stars going round) till the morning; online, once everyone
// playing is asleep. Moving gets you up again; anything hurting you wakes you. A bed that's
// gone (broken, or its floor taken away) wakes you, and you come back where the world starts.

import * as K from './blocks.js';
import { TILE } from './blocks.js';
import { BODY } from '../config.js';
import { hourOf, DAY_TICKS, isHostile } from './monsters.js';
import { settingOf } from './worldrules.js';

/** When you can go to sleep: from half past six in the evening to half past five in the morning. */
export const canSleepNow = world => { const h = hourOf(world.time || 0); return h >= 18.5 || h < 5.5; };
// How fast the night goes by with everyone asleep (world time each update: an hour every quarter second).
const FAST = DAY_TICKS / 24 / 15;
// How near a monster stops you sleeping (tiles across, and up and down).
const NEAR_X = 12, NEAR_Y = 6;

/** Where you come back after dying, at the bed at (tx, ty): standing on it. */
export const bedSpot = (tx, ty) => ({ x: tx * TILE + TILE / 2, y: (ty + 1) * TILE - BODY.bottom - 1, tx, ty });

/** The players playing (alive, not monsters, townsfolk or mercenaries). */
const playing = game => game.soldiers.filter(o => o.world && !o.npc && o.alive);

/** Player s right clicks the bed at (tx, ty). */
export function useBed(game, s, tx, ty) {
  const w = s.world;
  w.home = bedSpot(tx, ty);
  if (settingOf(game.world, 'time') !== 'cycle') { game.notify(s, 'You\'ll come back here, at your bed. (No sleeping the night away in a world where it never changes.)'); return; }
  if (!canSleepNow(game.world)) { game.notify(s, 'You\'ll come back here, at your bed. (You can sleep at night.)'); return; }
  const near = game.soldiers.find(o => o.alive && isHostile(o) && Math.abs(o.x - s.x) < NEAR_X * TILE && Math.abs(o.y - s.y) < NEAR_Y * TILE);
  if (near) { game.notify(s, 'You can\'t sleep now: there are monsters nearby. (You\'ll come back here.)'); return; }
  w.sleep = { tx, ty, since: game.tick };
  s.body.x = tx * TILE + TILE / 2;
  s.body.vx = 0;
  const all = playing(game), n = all.filter(o => o.world.sleep).length;
  game.notify(s, all.length > 1 ? `You lie down to sleep (${n} of ${all.length} asleep: when everyone is, the night goes by). Move to get up.` : 'You lie down to sleep... (move to get up)');
  for (const o of all) if (o !== s) game.notify(o, `${s.name} has gone to bed (${n} of ${all.length} asleep)`);
  game.sound('click', s.x, s.y, s.id);
}

/** Player s gets up (why: what they're told, if anything). */
export function wake(game, s, why = null) {
  if (!s.world?.sleep) return;
  s.world.sleep = null;
  if (why) game.notify(s, why);
}

/**
 * While asleep: kept in bed (what they press does nothing, until they move, jump or shoot, a
 * moment after lying down: then they're up). Returns the input to use.
 */
export function sleepInput(game, s, inp) {
  const z = s.world.sleep;
  const up = (inp.move || inp.jump || inp.fire || inp.firePressed || inp.crouch) && game.tick - z.since > 20;
  if (up) { wake(game, s); return inp; }
  return STILL;
}
const STILL = Object.freeze({ move: 0, jump: false, fire: false, crouch: false });

/** Each update: whoever's asleep in a bed that's gone wakes up; with everyone asleep, the night goes by, and the morning wakes them. */
export function sleepTick(game) {
  const world = game.world, all = playing(game);
  let asleep = 0;
  for (const s of all) {
    const z = s.world.sleep;
    if (!z) continue;
    if (world.tile(z.tx, z.ty) !== K.BED) { wake(game, s, 'Your bed is gone!'); continue; }
    asleep++;
  }
  world.asleep = asleep ? { n: asleep, of: all.length } : null;
  if (!asleep || asleep < all.length) return;
  const h = hourOf(world.time || 0);
  if (h >= 18 || h < 6) { world.time = (world.time || 0) + FAST; return; }
  // Morning: up, rested.
  for (const s of all) {
    if (!s.world.sleep) continue;
    s.world.sleep = null;
    s.health = Math.max(s.health, s.maxHealth || s.health);
    game.notify(s, 'Good morning! You slept well.');
  }
  game.sound('hallelujah', all[0].x, all[0].y);
}

/** Where player s comes back (their bed, if it's still there; an inn they rested at), or null (where the world starts). */
export function homeOf(game, s) {
  const h = s.world?.home;
  if (!h) return null;
  // (A bed: still there? An inn, or a bed from before beds were checked: as it was.)
  if (h.tx == null || h.inn) return h;
  if (game.world.tile(h.tx, h.ty) === K.BED) return h;
  s.world.home = null;
  game.notify(s, 'Your bed was missing, so you came back where the world starts');
  return null;
}
