// Game speed: slows the mechanics while the game keeps updating 60 times a second.
//
// Every speed is multiplied by s and every acceleration by s squared, and
// fire delays, fuses and burn times are divided by s. That's the same as
// running time slower, so jumps and throws follow exactly the same paths
// (every map stays climbable), they just take longer.

import { PHYS, MOTION, RULES } from './config.js';
import { WEAPONS } from './weapons.js';

const BASE = JSON.parse(JSON.stringify({ PHYS, MOTION, RULES, WEAPONS }));

const SPEEDS = ['runSpeed', 'crouchSpeed', 'jumpSpeed', 'jumpCut', 'bounceScale', 'jetMaxUp', 'maxFall', 'jetDrain', 'jetRegen'];
const ACCELS = ['gravity', 'groundAccel', 'airAccel', 'jetAccel'];

let current = 1;

export function getGameSpeed() { return current; }

/** Rescale the shared constants for speed s (1 = full speed). Call before building a game or route map. */
export function setGameSpeed(s = 1) {
  current = s;
  const v = s, a = s * s, t = 1 / s;
  for (const k of SPEEDS) PHYS[k] = BASE.PHYS[k] * v;
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

  RULES.burnTicks = BASE.RULES.burnTicks * t;
  RULES.burnDamage = BASE.RULES.burnDamage * v;

  for (const id in WEAPONS) {
    const w = WEAPONS[id], b = BASE.WEAPONS[id];
    w.rof = b.rof * t;
    if (b.speed) w.speed = b.speed * v;
    if (b.reload) w.reload = b.reload * t;
    if (b.fuse) w.fuse = b.fuse * t;
    if (b.life) w.life = b.life * t;
    if (b.knock) w.knock = b.knock * v;
    if (b.blast) w.blast = { ...b.blast, knock: b.blast.knock * v };
  }
}
