// A soldier: player or bot. Holds state only; the game decides what happens to it.

import { makeBody, stepBody } from './physics.js';
import { RULES, MOTION } from './config.js';
import { WEAPONS, WEAPON_ORDER } from './weapons.js';

const STRIDE = 46; // pixels travelled per full run cycle

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
    this.anim = { run: 0, idle: 0, land: 0, flip: 0, recoil: 0 };
    // Placeholder state until the first spawn.
    this.health = 0;
    this.armour = 0;
    this.weapons = { Platinum: { ammo: Infinity, mag: WEAPONS.Platinum.mag } };
    this.current = 'Platinum';
    this.cooldown = 0;
    this.reloadTimer = 0;
    this.spawnProtect = 0;
    this.burnTicks = 0;
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
    this.weapons = { Platinum: { ammo: Infinity, mag: WEAPONS.Platinum.mag } };
    this.current = 'Platinum';
    this.cooldown = 0;
    this.reloadTimer = 0;
    this.spawnProtect = protectTicks;
    this.burnTicks = 0;
    this.burnBy = null;
    this.lastHurtBy = null;
    this.lastHurtWeapon = null;
    this.lastHurtTick = -9999;
    this.anim = { run: 0, idle: 0, land: 0, flip: 0, recoil: 0 };
  }

  has(id) {
    const w = this.weapons[id];
    return !!w && (w.ammo > 0 || (WEAPONS[id].mag && w.mag > 0));
  }

  select(id) {
    if (id === this.current || !this.has(id)) return false;
    this.current = id;
    this.cooldown = Math.max(this.cooldown, 12);
    return true;
  }

  /** Cycle through owned weapons in slot order (dir = 1 or -1). */
  cycle(dir) {
    const owned = WEAPON_ORDER.filter(id => this.has(id));
    if (owned.length < 2) return false;
    const i = owned.indexOf(this.current);
    return this.select(owned[(i + dir + owned.length) % owned.length]);
  }

  /** Switch to the best weapon that still has ammo. */
  selectBest() {
    for (let i = WEAPON_ORDER.length - 1; i >= 0; i--) {
      if (this.has(WEAPON_ORDER[i])) { this.select(WEAPON_ORDER[i]); return; }
    }
  }

  /** Movement and animation for one tick. Weapons and damage are handled by the game. */
  move(input, map) {
    this.prevX = this.body.x;
    this.prevY = this.body.y;
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
  }
}
