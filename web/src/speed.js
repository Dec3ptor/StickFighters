// Game speed: slows the mechanics while the game keeps updating 60 times a second.
//
// Every speed is multiplied by s and every acceleration by s squared, and
// fire delays, fuses and burn times are divided by s. That's the same as
// running time slower, so jumps and throws follow exactly the same paths
// (every map stays climbable), they just take longer.

import { PHYS, MOTION, RULES } from './config.js';
import { WEAPONS } from './weapons.js';

const BASE = JSON.parse(JSON.stringify({ PHYS, MOTION, RULES, WEAPONS }, (k, v) => (v === Infinity ? 'Infinity' : v)),
  (k, v) => (v === 'Infinity' ? Infinity : v));

const SPEEDS = ['runSpeed', 'crouchSpeed', 'jumpSpeed', 'jumpCut', 'bounceScale', 'jetMaxUp', 'maxFall', 'jetDrain', 'jetRegen', 'ropeClimb'];
const ACCELS = ['gravity', 'groundAccel', 'airAccel', 'jetAccel'];

// Weapon numbers by unit (anywhere in a weapon's definition, including payloads).
const W_TIMES = new Set(['rof', 'reload', 'fuse', 'life', 'spinup', 'arm', 'delay', 'duration', 'interval', 'holy']);
const W_SPEEDS = new Set(['speed', 'knock', 'walkSpeed', 'hop', 'throwSpeed', 'lift', 'uppercut', 'selfHop', 'kick', 'turn', 'dpt', 'scatter']);
const W_ACCELS = new Set(['gravity']);
const W_RATES = new Set(['hopChance']); // chance per update

let current = 1;

export function getGameSpeed() { return current; }

function scaleWeapon(out, base, s) {
  for (const k in base) {
    const b = base[k];
    if (b && typeof b === 'object' && !Array.isArray(b)) {
      if (!out[k] || typeof out[k] !== 'object') out[k] = {};
      scaleWeapon(out[k], b, s);
    } else if (typeof b === 'number' && Number.isFinite(b)) {
      out[k] = W_TIMES.has(k) ? b / s : W_SPEEDS.has(k) ? b * s : W_ACCELS.has(k) ? b * s * s : W_RATES.has(k) ? b * s : b;
    }
  }
}

/** Rescale the shared constants for speed s (1 = full speed). Call before building a game or route map. */
export function setGameSpeed(s = 1) {
  current = s;
  const v = s, a = s * s, t = 1 / s;
  for (const k of SPEEDS) if (k in BASE.PHYS) PHYS[k] = BASE.PHYS[k] * v;
  for (const k of ACCELS) PHYS[k] = BASE.PHYS[k] * a;

  MOTION.timeScale = s;
  MOTION.grenadeGravity = BASE.MOTION.grenadeGravity * a;
  MOTION.flameDrag = BASE.MOTION.flameDrag ** s;
  MOTION.flameLift = BASE.MOTION.flameLift * a;
  MOTION.flameGrow = BASE.MOTION.flameGrow * v;
  MOTION.itemGravity = BASE.MOTION.itemGravity * a;
  MOTION.itemMaxFall = BASE.MOTION.itemMaxFall * v;
  MOTION.itemToss = BASE.MOTION.itemToss * v;
  MOTION.flipRate = BASE.MOTION.flipRate * v;
  MOTION.landAnim = BASE.MOTION.landAnim * v;
  MOTION.landSound = BASE.MOTION.landSound * v;
  MOTION.crateFall = BASE.MOTION.crateFall * v;

  RULES.burnTicks = BASE.RULES.burnTicks * t;
  RULES.burnDamage = BASE.RULES.burnDamage * v;

  for (const id in WEAPONS) scaleWeapon(WEAPONS[id], BASE.WEAPONS[id], s);
}
