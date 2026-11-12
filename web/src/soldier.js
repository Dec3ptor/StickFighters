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

/** Updates before a weapon just taken out can fire (a fifth of a second). */
export const DRAW_TICKS = 12;

export class Soldier {
  constructor({ id, name, team = 0, isBot = false, profile = null, maxHealth = RULES.maxHealth, skin = 'auto' }) {
    this.id = id;
    this.name = name;
    this.team = team;
    this.skin = skin;       // how they look (skins.js): 'auto' is each game's own
    this.isBot = isBot;
    this.profile = profile;
    this.frags = 0;
    this.deaths = 0;
    this.points = 0;        // the objective modes' score (captures, holding the hill...)
    this.alive = false;
    this.respawnTimer = 0;
    this.body = makeBody(0, 0);
    this.prevX = 0;
    this.prevY = 0;
    this.aim = Math.PI;
    this.facing = -1;
    // (act: what they're doing with what's in hand, use: how far through it, rate: how fast: useanim.js.)
    this.anim = { run: 0, idle: 0, land: 0, flip: 0, recoil: 0, act: '', use: 0, rate: 0 };
    // Placeholder state until the first spawn.
    this.health = 0;
    this.maxHealth = maxHealth; // (the mode's: see Game.maxHealth)
    this.armour = 0;
    this.weapons = startingWeapons();
    this.current = 'Platinum';
    this.cooldown = 0;
    // (The waits of the weapons not in hand, each its own: { id: updates left }. See select.)
    this.cooldowns = {};
    this.reloadTimer = 0;
    this.reloadTotal = 0;   // (how long the reload under way takes in all: its animation)
    this.spawnProtect = 0;
    this.burnTicks = 0;
    this.aimDist = 200;     // how far away the mouse is (throw strength, air strike target, teleport)
    this.spin = 0;          // minigun spin-up
    this.kamikaze = null;
    this.lastInSlot = {};
    this.flashTicks = 0;    // blinded by a flashbang for this long (flashFull: how long it was at first)
    this.flashFull = 0;
    // Kill streaks (streaks.js): kills in a row this life, the best this match, kills close
    // together (multi: how many, multiAt: when the last was), rewards banked (ids, oldest
    // first), Juggernaut time left, and counts for the end-of-match awards.
    this.streak = 0;
    this.bestStreak = 0;
    this.multi = 0;
    this.multiAt = -1e9;
    this.bank = [];
    this.jugger = 0;
    this.headshots = 0;
    this.blasts = 0;
    // Every field a soldier gets later on (elsewhere in the game), made here, so all soldiers
    // share one shape and reading their fields stays fast. Each starts out undefined, just as
    // it was before anything set it (code checks these with == null, ?? and ||).
    // Respawning (spawnAt) and the hurt and burn credit (combat.js):
    this.reloading = undefined;
    this.burnBy = undefined;
    this.lastHurtBy = undefined;
    this.lastHurtWeapon = undefined;
    this.lastHurtTick = undefined;
    // (Who last threw them with a blast, and when: a fall off the map after is theirs, game.js.)
    this.pushedBy = undefined;
    this.pushedTick = undefined;
    // (What they're told of hits, theirs landing and others' on them: combat.js's damage, feedback.js.)
    this.scoped = false; // (looking down a scope: game.js)
    // (A player's last sign of life: what their input was, and when it last changed; and sat out
    // for having given none: game.js's update, net/host.js.)
    this.inputSig = null;
    this.activeTick = 0;
    this.afk = false;
    this.hitTick = -1;
    this.hitHead = false;
    this.tickedAt = -99;
    this.hurtTick = -1;
    this.animPrev = undefined;
    // The game (game.js): use key, self-destruct, where they died, spectating, held respawns, the Builder's choice.
    this.using = undefined;
    this.destructHold = undefined;
    this.deathX = undefined;
    this.deathY = undefined;
    this.toldTrapped = undefined;
    this.spectating = undefined;
    this.holdSpawn = undefined;
    this.buildPlank = undefined;
    this.toldBuild = undefined;
    this.gassed = undefined;   // the update skunk gas last hurt them (combat.js)
    this.gridCell = undefined; // the soldier grid's cell they're in (grid.js)
    this.bankedAt = undefined; // kill streaks (streaks.js)
    // Modes: gun game, one in the chamber (modes.js) and Defuse (defuse.js).
    this.level = undefined;
    this.levelKills = undefined;
    this.lives = undefined;
    this.bullets = undefined;
    this.shop = undefined;
    this.helmet = undefined;
    this.kit = undefined;
    this.fresh = undefined;
    // Classes (classes.js, gadgets.js).
    this.cls = undefined;
    this.pickCls = undefined;
    this.loadouts = undefined;
    this.mods = undefined;
    this.kitAmmo = undefined;
    this.gadgetCharge = undefined;
    this.blockRegen = undefined;
    this.deployAt = undefined;
    this.spawnedAt = undefined;
    this.toldCharging = undefined;
    this.beforeTool = undefined;
    // Online play (net/): a remote player, their ping, and smoothing our own corrections.
    this.remote = undefined;
    this.ping = undefined;
    this.drawDX = undefined;
    this.drawDY = undefined;
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
    this.health = this.maxHealth;
    this.armour = 0;
    this.weapons = startingWeapons();
    this.current = 'Platinum';
    this.cooldown = 0;
    this.cooldowns = {};
    this.reloadTimer = 0;
    this.spin = 0;
    this.kamikaze = null;
    this.spawnProtect = protectTicks;
    this.burnTicks = 0;
    this.flashTicks = 0;
    this.reloading = null;
    this.burnBy = null;
    this.lastHurtBy = null;
    this.lastHurtWeapon = null;
    this.lastHurtTick = -9999;
    this.pushedBy = null;
    this.pushedTick = -9999;
    this.anim = { run: 0, idle: 0, land: 0, flip: 0, recoil: 0, act: '', use: 0, rate: 0 };
    this.animPrev = null;
    this.jugger = 0; // (a new life isn't a Juggernaut: Defuse puts round survivors back with this too)
  }

  has(id) {
    const w = this.weapons[id];
    return !!w && (w.ammo > 0 || w.mag > 0);
  }

  select(id) {
    if (id === this.current || !this.has(id) || this.kamikaze) return false;
    // (Defuse: switching weapons stops a reload, as in Counter-Strike.)
    if (this.shop && this.reloadTimer > 0) { this.reloadTimer = 0; this.reloading = null; }
    // (Each weapon has its own wait between shots: what's left of this one's stays with it, and
    // the one taken out has what's left of its own, or the moment it takes to draw. A rocket and
    // then the shotgun, so; but not the same slow gun sooner by putting it away and back.)
    if (this.cooldown > 0) this.cooldowns[this.current] = this.cooldown;
    const own = this.cooldowns[id] || 0;
    if (own) delete this.cooldowns[id];
    this.current = id;
    this.lastInSlot[WEAPONS[id].slot] = id;
    this.cooldown = Math.max(own, DRAW_TICKS);
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
    this.beginMove(input);
    stepBody(this.body, input, map);
    this.animate();
  }

  /**
   * The start of a tick's movement, however it moves (walking, or a world's dev mode flying):
   * where it was and its animation as it was (the renderer draws in between them and now, and
   * the camera follows that), its aim, and which way it faces.
   */
  beginMove(input) {
    this.prevX = this.body.x;
    this.prevY = this.body.y;
    // (Copied into the same object every update.)
    const a0 = this.anim, p = this.animPrev || (this.animPrev = { run: 0, idle: 0, land: 0, flip: 0, recoil: 0, act: '', use: 0 });
    p.run = a0.run; p.idle = a0.idle; p.land = a0.land; p.flip = a0.flip; p.recoil = a0.recoil; p.act = a0.act; p.use = a0.use;
    if (input.aim != null) this.aim = input.aim;
    const c = Math.cos(this.aim);
    if (Math.abs(c) > 0.05) this.facing = c < 0 ? -1 : 1;
  }

  /** The animation, once the body's moved this tick. */
  animate() {
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
    // What they're doing with what's in hand (useanim.js): a reload goes as the reload does.
    // (Online, a player's own reload: as the host has it, sent with the snapshots.)
    if (this.reloadTimer > 0 && this.reloadTotal > 0) { a.act = 'reload'; a.use = Math.max(0, Math.min(1, 1 - this.reloadTimer / this.reloadTotal)); }
    else if (a.act === 'reload') { if (!(this.reloadTimer > 0)) { a.act = ''; a.use = 0; } }
    else if (a.act) { a.use += a.rate || 0.1; if (a.use >= 1) { a.act = ''; a.use = 0; } }
  }
}
