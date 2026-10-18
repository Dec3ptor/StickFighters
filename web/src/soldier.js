// A soldier: player or bot. Holds state only; the game decides what happens to it.

import { makeBody, stepBody } from './physics.js';
import { RULES, MOTION } from './config.js';
import { WEAPONS, STARTING_WEAPONS, NO_AUTO_SWITCH } from './weapons.js';

const STRIDE = 46; // pixels travelled per full run cycle

// Guns are what you want in your hands by default (rather than sheep or air strikes).
const HOLD_KINDS = new Set(['bullet', 'rail', 'arrow', 'seeker', 'rocket', 'flame']);

// Every weapon in slot order, including ones only game modes hand out.
const ALL_ORDER = Object.keys(WEAPONS).sort((a, b) => WEAPONS[a].slot - WEAPONS[b].slot);

function startingWeapons() {
  const out = {};
  for (const id of STARTING_WEAPONS) out[id] = WEAPONS[id].mag ? { ammo: Infinity, mag: WEAPONS[id].mag } : { ammo: WEAPONS[id].ammo ?? Infinity };
  return out;
}

export const SHOULDER_Y = -12;

export class Soldier {
  constructor({ id, name, team = 0, isBot = false, profile = null }) {
    this.id = id;
    this.name = name;
    this.team = team;
    this.isBot = isBot;
    this.profile = profile;
    this.frags = 0;
    this.deaths = 0;
    this.alive = false;
    this.respawnTimer = 0;
    this.body = makeBody(0, 0);
    this.prevX = 0;
    this.prevY = 0;
    this.aim = Math.PI;
    this.facing = -1;
    this.anim = { run: 0, idle: 0, land: 0, flip: 0, recoil: 0, swing: 0 };
    // Placeholder state until the first spawn.
    this.health = 0;
    this.armour = 0;
    this.weapons = startingWeapons();
    this.current = 'Platinum';
    this.cooldown = 0;
    this.reloadTimer = 0;
    this.spawnProtect = 0;
    this.burnTicks = 0;
    this.aimDist = 200;     // how far away the mouse is (throw strength, air strike target, teleport)
    this.spin = 0;          // minigun spin-up
    this.kamikaze = null;
    this.lastInSlot = {};
  }

  get x() { return this.body.x; }
  get y() { return this.body.y; }
  get weapon() { return WEAPONS[this.current]; }
  get shoulderX() { return this.body.x; }
  get shoulderY() { return this.body.y + (this.body.crouching ? SHOULDER_Y + 10 : SHOULDER_Y); }

  spawnAt(point, protectTicks = RULES.spawnProtectTicks) {
    this.body = makeBody(point.x, point.y);
    this.prevX = point.x;
    this.prevY = point.y;
    this.alive = true;
    this.health = RULES.maxHealth;
    this.armour = 0;
    this.weapons = startingWeapons();
    this.current = 'Platinum';
    this.cooldown = 0;
    this.reloadTimer = 0;
    this.spin = 0;
    this.kamikaze = null;
    this.spawnProtect = protectTicks;
    this.burnTicks = 0;
    this.burnBy = null;
    this.lastHurtBy = null;
    this.lastHurtWeapon = null;
    this.lastHurtTick = -9999;
    this.anim = { run: 0, idle: 0, land: 0, flip: 0, recoil: 0, swing: 0 };
    this.animPrev = null;
  }

  has(id) {
    const w = this.weapons[id];
    return !!w && (w.ammo > 0 || (WEAPONS[id].mag && w.mag > 0));
  }

  select(id) {
    if (id === this.current || !this.has(id) || this.kamikaze) return false;
    this.current = id;
    this.lastInSlot[WEAPONS[id].slot] = id;
    this.cooldown = Math.max(this.cooldown, 12);
    this.spin = 0;
    if (this.body.rope && WEAPONS[id].kind !== 'rope') { this.body.rope = null; this.body.momentum = 45; }
    return true;
  }

  /** Number key: the weapon to switch to for a slot (cycles if you're already holding one from it), or null. */
  slotChoice(slot) {
    const owned = ALL_ORDER.filter(id => WEAPONS[id].slot === slot && this.has(id));
    if (!owned.length) return null;
    const i = owned.indexOf(this.current);
    if (i >= 0) return owned.length > 1 ? owned[(i + 1) % owned.length] : null;
    const last = this.lastInSlot[slot];
    return owned.includes(last) ? last : owned[0];
  }

  /** Cycle through owned weapons in slot order (dir = 1 or -1). */
  cycle(dir) {
    const owned = ALL_ORDER.filter(id => this.has(id));
    if (owned.length < 2) return false;
    const i = owned.indexOf(this.current);
    return this.select(owned[(i + dir + owned.length) % owned.length]);
  }

  /** Switch to the best weapon that still has ammo (guns before tools; anything if that's all there is). */
  selectBest(force = false) {
    const ids = Object.keys(this.weapons);
    const rank = id => (NO_AUTO_SWITCH.has(id) ? -100 : 0) + (HOLD_KINDS.has(WEAPONS[id].kind) || WEAPONS[id].launcher ? 60 : 0) +
      (WEAPONS[id].bot?.value ?? 0) * 10 + WEAPONS[id].slot;
    let best = null;
    for (const id of ids) if (WEAPONS[id] && this.has(id) && (!best || rank(id) > rank(best))) best = id;
    if (!best) return;
    if (force) { this.current = best; this.lastInSlot[WEAPONS[best].slot] = best; }
    else this.select(best);
  }

  /** Movement and animation for one tick. Weapons and damage are handled by the game. */
  move(input, map) {
    this.prevX = this.body.x;
    this.prevY = this.body.y;
    this.animPrev = { ...this.anim }; // (the renderer draws the animation in between)
    if (input.aim != null) this.aim = input.aim;
    const c = Math.cos(this.aim);
    if (Math.abs(c) > 0.05) this.facing = c < 0 ? -1 : 1;

    stepBody(this.body, input, map);

    const b = this.body, a = this.anim;
    if (b.onGround && Math.abs(b.vx) > 0.3) {
      // Running backwards plays the cycle backwards. Sprites face left, so "forward" is -x.
      const forward = Math.sign(b.vx) === this.facing ? 1 : -1;
      a.run = (a.run + forward * Math.abs(b.vx) / STRIDE + 1) % 1;
    }
    a.idle++;
    if (b.landed > MOTION.landAnim) a.land = 10;
    else if (a.land > 0) a.land--;
    if (b.bounced) a.flip = 1;
    else if (a.flip > 0) a.flip = b.onGround ? 0 : Math.max(0, a.flip - MOTION.flipRate);
    if (a.recoil > 0) a.recoil = Math.max(0, a.recoil - 0.6);
    if (a.swing > 0) a.swing = Math.max(0, a.swing - 0.09 * MOTION.timeScale);
  }
}
