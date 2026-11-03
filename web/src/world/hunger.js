// Hunger (world mode): each player has food (0-20) and saturation, as in Minecraft. Doing things
// tires you (exhaustion: sprinting, jumping, swimming, digging, fighting, being hurt, healing, and a
// little just from being alive), and that uses it up: saturation first, then food. Well fed (18 or
// more) and out of a fight, you heal by yourself, faster when you're full; hungry (6 or less), not
// even perks and gear heal you; starving (none at all), you're hurt now and then: on easy down to
// half your health, on normal to the last of it, on hard to death. Food fills you up (items.js:
// food, sat), cooked better than raw; potions heal. Raw chicken can make you sick: hungry quicker
// for a while.
//
// A world's setting (worldrules.js) turns it off, and then food heals, as it always did. No hunger
// in dev mode or creative; in a peaceful world, food comes back by itself. The host keeps it (it's
// sent with a player's things online: worldnet.js), and it's kept with the player when the world's
// saved; a world made before hunger starts everyone full.

import { TILE } from './blocks.js';
import { MOTION } from '../config.js';
import { settingOf } from './worldrules.js';
import { damage } from '../combat.js';

/** The most food there is (and saturation can't be more than food). */
export const FOOD_MAX = 20;
/** Well fed: you heal by yourself. Hungry: nothing heals you by itself. */
export const FED = 18, HUNGRY = 6;
const EXHAUSTED = 4;              // exhaustion that costs a point of saturation (or of food)
const PASSIVE = 4 / (60 * 60);    // just being alive: a point a minute at full speed (once saturation's gone)
const SICK_RATE = 0.004;          // sick: this much more exhaustion each update
export const SICK_TICKS = 30 * 60; // and sick this long
const REGEN_EVERY = 20, REGEN_FULL = 10; // updates between heals: well fed, and full
const REGEN_COST = 1.2;           // exhaustion for each heal (1% of your health)
const STARVE_EVERY = 80;          // updates between hurts, starving
const CALM = 300;                 // updates since you were last hurt before you heal by yourself

/** Whether players in world `world` get hungry (the world's setting). */
export const hungerOn = world => settingOf(world, 'hunger') !== 'off';

/** Player world state w's hunger, full (a new character, a world from before hunger, back from dying). */
export function fill(w) {
  w.food = FOOD_MAX;
  w.sat = 5;
  w.exh = 0;
  w.sick = 0;
  w.hungryTold = false;
}

/** Whether hunger counts for soldier s now: a player, in a world with hunger, not in dev mode or creative. */
export const hungerCounts = (game, s) => !!s?.world && !s.npc && hungerOn(game.world) && !s.world.dev && !s.world.creative;

/** Player s was hurt (by anything: a monster, a fall, fire, drowning): it tires them, and they don't heal by themselves a while. */
export function hurtNow(game, s) {
  if (!s?.world || s.npc) return;
  s.world.hurtAt = game.tick;
  exert(s, 0.1);
}

/** Tire player s (amount: exhaustion, Minecraft's): it uses up their saturation, then their food. */
export function exert(s, amount) {
  const w = s?.world;
  if (!w || w.food === undefined || w.dev || w.creative || !(amount > 0)) return;
  w.exh = (w.exh || 0) + amount;
  while (w.exh >= EXHAUSTED) {
    w.exh -= EXHAUSTED;
    if (w.sat > 0) w.sat = Math.max(0, w.sat - 1);
    else w.food = Math.max(0, w.food - 1);
  }
}

/**
 * Each update, for each player (the host's: worldplay.js's worldTick): what they did tires them,
 * well fed they heal, starving they're hurt, sick they get hungry quicker; a peaceful world feeds them.
 */
export function hungerTick(game, s) {
  if (!s.alive || game.mirror || !hungerCounts(game, s)) return;
  const w = s.world, b = s.body, ts = MOTION.timeScale, t = game.tick;
  if (w.food === undefined) fill(w);
  // What they did since the last update (where they were then, and whether they were on the ground).
  const h = w.hg || (w.hg = { x: s.x, y: s.y, ground: !!b.onGround });
  const dx = Math.abs(s.x - h.x), dy = Math.abs(s.y - h.y);
  let e = PASSIVE * ts;
  // (Not across a teleport, a waystone or a recall.)
  if (dx < 4 * TILE && dy < 4 * TILE) {
    if (b.sprinting && b.onGround) e += 0.1 * dx / TILE;
    if (b.swimming) e += 0.015 * (dx + dy) / TILE;
  }
  // A jump (off the ground and going up: not a fall).
  if (h.ground && !b.onGround && b.vy < -1) e += b.sprinting ? 0.2 : 0.05;
  h.x = s.x; h.y = s.y; h.ground = !!b.onGround;
  if (w.sick > 0) { w.sick--; e += SICK_RATE * ts; }
  const diff = settingOf(game.world, 'difficulty'), max = s.maxHealth || 150;
  // (Peaceful: it comes back by itself.)
  if (diff === 'peaceful' && t % 120 === 0 && w.food < FOOD_MAX) w.food++;
  // Well fed, and out of a fight: healing (faster when full, while saturation lasts). It tires them.
  if (w.food >= FED && s.health < max && t - (w.hurtAt ?? -1e9) >= CALM) {
    const every = w.food >= FOOD_MAX && w.sat > 0 ? REGEN_FULL : REGEN_EVERY;
    if ((t + s.id) % every === 0) { s.health = Math.min(max, s.health + Math.max(1, max * 0.01)); e += REGEN_COST; }
  }
  exert(s, e);
  // Hungry: told once (till they've eaten).
  if (w.food <= HUNGRY && !w.hungryTold) { w.hungryTold = true; game.notify(s, w.food ? 'You\'re hungry: eat something' : 'You\'re starving! Eat something'); }
  if (w.food > HUNGRY) w.hungryTold = false;
  // Starving: hurt now and then (easy: down to half your health; normal: to the last of it; hard: to death).
  if (w.food <= 0 && (t + s.id) % STARVE_EVERY === 0) {
    const floor = diff === 'hard' ? 0 : diff === 'normal' ? 1 : max / 2;
    const hurt = Math.min(max * 0.05, s.health - floor);
    if (hurt > 0) {
      damage(game, s, hurt, null, 'Starving');
      if (t % (STARVE_EVERY * 8) < STARVE_EVERY && s.alive) game.notify(s, 'You\'re starving! Eat something');
    }
  }
}

/** Whether player s is too hungry for anything to heal them (perks and gear's healing: progress.js). */
export const tooHungry = (game, s) => hungerCounts(game, s) && s.world.food !== undefined && s.world.food <= HUNGRY;

/** Why player s can't eat (or drink) one of `item` now ("You're not hungry"), or null: they can. */
export function cantEat(game, s, item) {
  const w = s.world, max = s.maxHealth || 150;
  if (hungerCounts(game, s) && item.food) {
    if (w.food === undefined) fill(w);
    return w.food >= FOOD_MAX && !(item.heals && s.health < max) ? 'You\'re not hungry' : null;
  }
  return s.health >= max ? 'You\'re not hurt' : null;
}

/**
 * Player s eats (or drinks) one of `item` (already taken from their things): with hunger, food
 * fills them up (and raw chicken may make them sick); potions, and food where there's no hunger,
 * heal them.
 */
export function feed(game, s, item) {
  const w = s.world, max = s.maxHealth || 150;
  if (hungerCounts(game, s) && item.food) {
    if (w.food === undefined) fill(w);
    w.food = Math.min(FOOD_MAX, w.food + item.food);
    w.sat = Math.min(w.food, (w.sat || 0) + (item.sat || 0));
    if (item.heals) s.health = Math.min(max, s.health + item.heals);
    if (item.sick && game.rng() < item.sick) { w.sick = SICK_TICKS; game.notify(s, 'That didn\'t agree with you: you\'ll get hungry quicker for a while (cook it next time)'); }
    return;
  }
  s.health = Math.min(max, s.health + (item.heal || 0));
}

// ---- The HUD's bar (hud.js), saving and the network ----------------------------------------------

const LABELS = new Map();
/** The HUD's food bar for player world state w: [fill, kind (its colours), label], or null (no hunger). */
export function foodBar(w) {
  if (w?.food === undefined || w.food === null || w.dev || w.creative) return null;
  const f = Math.max(0, Math.min(FOOD_MAX, w.food | 0)), sick = w.sick > 0;
  const key = `${f}${sick ? 's' : ''}`;
  let label = LABELS.get(key);
  if (label === undefined) {
    label = f === 0 ? 'Starving! Eat something' : `Food ${f} / ${FOOD_MAX}${sick ? '  ·  sick' : f <= HUNGRY ? '  ·  hungry' : ''}`;
    LABELS.set(key, label);
  }
  return [f / FOOD_MAX, f === 0 ? 'starving' : sick ? 'sick' : f <= HUNGRY ? 'hungry' : 'food', label];
}

/** Player world state w's hunger as saved: [food, saturation, exhaustion, sick], or null (none yet). */
export const hungerToSave = w => (w?.food === undefined || w.food === null ? null : [w.food | 0, Math.round((w.sat || 0) * 10) / 10, Math.round((w.exh || 0) * 100) / 100, w.sick | 0]);

/** Player world state w's hunger from a save (or the host): only what there should be. */
export function hungerFromSave(w, d) {
  if (!Array.isArray(d)) return;
  const n = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
  w.food = Math.round(n(d[0], 0, FOOD_MAX));
  w.sat = n(d[1], 0, w.food);
  w.exh = n(d[2], 0, EXHAUSTED);
  w.sick = Math.round(n(d[3], 0, SICK_TICKS));
}

/** What changes the HUD's bar (worldnet.js sends a player's hunger when it changes). */
export const hungerKey = w => (w?.food === undefined ? '' : `${w.food}${w.sick > 0 ? 's' : ''}`);
