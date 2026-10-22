// Computer-controlled soldiers.

import { MOTION, PHYS, RULES } from './config.js';
import { WEAPONS } from './weapons.js';
import { jumpSteer, dropSteer } from './nav.js';
import { angleDiff, clamp } from './util.js';
import { CELL } from './grid.js';
import { inZone } from './objectives.js';
import { botWantsGadget } from './gadgets.js';
import { shotSpeed, smokeBetween } from './combat.js';
import { buildTool, blocksLeft, flyFuel, exitSpot, launchSpot, fly, climb, coverSpot } from './botescape.js';

const SIGHT = 1300;  // how far bots look for enemies
const LOOKS = 6;     // in big games, sight lines a bot checks each time it looks around
// Bot vision 'sight': what a bot can see is what would be on its screen (a 16:10 view
// around it, like a player's), in front of it, in a clear line. Right next to it, it can
// feel someone; behind it, only hear them.
const VIEW = { hw: 520, hh: 330, behind: 30, touch: 26 };
// Bots only shoot at someone who'd be on their screen if they were a player (about what
// the game shows around you on a wide window; zoomed out with a sniper rifle's scope),
// so nobody gets shot by a bot they couldn't have seen.
const FIRE_VIEW = { hw: 560, hh: 340 }, SCOPE_VIEW = { hw: 900, hh: 520 };
const onScreen = (def, dx, dy, k = 1) => {
  const v = def.kind === 'rail' ? SCOPE_VIEW : FIRE_VIEW;
  return Math.abs(dx) <= v.hw * k && Math.abs(dy) <= v.hh * k;
};

/** The route map spot nearest an item (remembered while the item stays put). */
function nodeFor(nav, it) {
  if (it.navAt !== nav || it.navVersion !== nav.version || it.navX !== it.x || it.navY !== it.y) {
    it.navAt = nav; it.navVersion = nav.version; it.navX = it.x; it.navY = it.y;
    it.navNode = nav.nearest(it.x, it.y + 12, 90);
  }
  return it.navNode;
}

// How bots aim, like a person with a mouse (all times in updates, 60 a second):
//   reaction  from spotting someone to the first shot
//   delay     what the bot aims at is where it saw the target this long ago, carried
//             on at the speed it saw them going (`extrap`: how much of the way): a
//             sudden jump or turn throws its aim off until it catches up
//   flick     aiming at someone new, its aim lands off by about this much, plus
//             `flickPct` of how far it had to turn, and settles (`settle` of the
//             way each update) down to a steady wobble of about `tremor` (more on the move)
//   turn      fastest its aim turns; fireCone: how close to where it means to aim
//             before it fires; trigger: chance it fires on an update when it could
export const DIFFICULTY = {
  easy: { reaction: 44, delay: 18, extrap: 0.4, flick: 0.14, flickPct: 0.3, settle: 0.05, tremor: 0.16, turn: 0.08, fireCone: 0.26, trigger: 0.6 },
  normal: { reaction: 30, delay: 13, extrap: 0.6, flick: 0.09, flickPct: 0.22, settle: 0.07, tremor: 0.095, turn: 0.12, fireCone: 0.17, trigger: 0.85 },
  hard: { reaction: 20, delay: 9, extrap: 0.8, flick: 0.06, flickPct: 0.15, settle: 0.09, tremor: 0.055, turn: 0.17, fireCone: 0.12, trigger: 1 },
};
// What a bot remembers of its target, for aiming with a delay (updates).
const SEEN_LEN = 24;

// Personalities use the original game's bot numbers (aim error, camping, skill), with new names.
export const BOT_PROFILES = [
  { name: 'Grunt', acc: 15, camp: 8, skill: 0 },
  { name: 'Ranger', acc: 10, camp: 12, skill: 1 },
  { name: 'Sarge', acc: 10, camp: 10, skill: 2 },
  { name: 'Ghost', acc: 10, camp: 14, skill: 1 },
  { name: 'Viper', acc: 5, camp: 12, skill: 3 },
  { name: 'Sunny', acc: 10, camp: 25, skill: 2 },
  { name: 'Slim', acc: 10, camp: 15, skill: 0 },
  { name: 'Hyper', acc: 15, camp: 8, skill: 3 },
  { name: 'Scope', acc: 3, camp: 30, skill: 2 },
  { name: 'Ninja', acc: 10, camp: 8, skill: 2 },
];


/** True if `target` is standing near a drop, on the side away from `s` (a push would knock them off). */
function nearLedge(game, s, target) {
  if (!target || !target.body.onGround) return false;
  const dir = Math.sign(target.x - s.x) || 1;
  const x = target.x + dir * 22;
  return !game.map.overlap(x - 2, target.y + 12, x + 2, target.y + 90);
}

/** How much a bot wants to use a weapon at distance d (from the weapon table's `bot` numbers). */
function weaponScore(id, d, s, game, target) {
  const def = WEAPONS[id];
  const b = def?.bot;
  if (!b) return 0;
  // The prod does no damage: only worth it to push someone off a ledge.
  if (id === 'Prod') return d <= b.far + 10 && game && nearLedge(game, s, target) ? 9 : 0.1;
  if (b.lastResort) return s && s.health < 30 && d < b.far ? 12 : 0;
  if (!b.score) return 0;
  if (def.kind === 'melee') return d <= b.far + 10 ? b.score : 0.2;
  const near = b.near ?? 0, far = b.far ?? 600;
  if (d >= near && d <= far) return b.score;
  return d < near ? b.score * 0.2 : b.score * 0.35;
}

const weaponValue = id => WEAPONS[id]?.bot?.value ?? 2;

/** True if a soldier at route map spot n can reach item `it` (nothing in the way). */
function reachable(game, n, it) {
  if (it.reachAt !== n || it.reachVersion !== game.map.version || it.reachX !== it.x || it.reachY !== it.y) {
    Object.assign(it, { reachAt: n, reachVersion: game.map.version, reachX: it.x, reachY: it.y });
    it.reach = game.map.clearLine(n.x, n.y - 10, it.x, it.y - 6);
  }
  return it.reach;
}

/** True if picking up `it` would do the soldier any good (the game won't hand over what they can't use). */
function wants(s, it) {
  if (it.type === 'health' || (it.type === 'crate' && it.health)) return s.health < RULES.maxHealth || s.burnTicks > 0;
  if (it.type === 'armour') return s.armour < RULES.maxArmour;
  if (it.type === 'weapon' || it.type === 'crate') {
    const def = WEAPONS[it.weapon], inv = s.weapons[it.weapon];
    return !!def && (!inv || inv.ammo < (def.maxAmmo ?? def.ammo ?? 1));
  }
  return true;
}

/** The same, as the mode allows (Defuse: one gun of each sort). */
function wantsItem(game, s, it) {
  if (game.rules.canPickUp && it.type === 'weapon' && !game.rules.canPickUp(game, s, it)) return false;
  return wants(s, it);
}

/**
 * Steering to walk dx pixels and stop there, easing off early so momentum
 * doesn't carry the soldier past it (and off the ledge a jump starts from).
 */
function approach(dx, vx) {
  const stopping = (vx * vx) / (2 * PHYS.groundAccel);
  if (Math.sign(vx) === Math.sign(dx) && Math.abs(dx) <= stopping + 0.5) return 0;
  return Math.abs(dx) > 1 ? Math.sign(dx) : 0;
}

// Moves that keep going wrong in practice cost more to plan, so bots find another way.
const FAIL_COST = 45, MAX_PENALTY = 270;
// Racing for items: a bot gives up on one when someone else will clearly get there first
// (by this many updates), or a player is standing this close to it.
const RACE_MARGIN = 15, NEAR_ITEM = 90;
// A bot that gives way on an item leaves it alone this long (4 seconds).
const YIELD_TICKS = 240;
// When the route map changes, bots plan again over this many updates (a few at a time).
const REPLAN_SPREAD = 30;
// Bots sprint when at least this many steps of straight walking lie ahead (about 100 px).
const SPRINT_RUN = 8;

export class BotController {
  constructor(nav, difficulty, profile, rng) {
    this.nav = nav;
    this.d = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.profile = profile;
    this.rng = rng;
    this.aimMult = 0.6 + profile.acc / 25;
    this.reaction = Math.round(this.d.reaction * (1.2 - profile.skill * 0.1));
    this.prevFire = false;
    // Where the target was, each update (x, y, vx, vy), for aiming with a delay.
    this.seenAt = new Float64Array(SEEN_LEN * 4);
    this.seenCount = 0;
    this.seenOf = null;
    this.aimOff = 0;
    this.reset();
  }

  /** The item this bot is going for (the item keeps a list of the bots going for it). */
  get goalItem() { return this._goalItem; }
  set goalItem(it) {
    if (it === this._goalItem) return;
    this._goalItem?.racers.delete(this);
    this._goalItem = it;
    if (it) (it.racers ||= new Set()).add(this);
  }

  reset() {
    this.path = null;
    this.li = 0;
    this.exec = null;
    this.target = null;
    this.seen = 0;
    this.lastSeen = null;
    this.threat = null;
    this.thinkIn = 0;
    this.stuck = 0;
    this.lastNode = null;
    this.goalKind = null;
    this.goalItem = null;
    this.offGraph = null;
    this.grabTicks = 0;
    this.history = [];
    this.forceRoam = false;
    this.destructing = false;
    this.airTicks = 0;
    this.bounces = 0;
    this.throwing = null;
    this.lookAway = null;
    this.escape = null;        // flying out of a pit, or building a way on (botescape.js)
    this.escapeFails = 0;
    this.trappedSince = -1;    // (since when it's been stuck with nothing to do and nowhere to go)
    this.towardAt = -1e9;      // (when it last tried to get somewhere it couldn't by building or flying)
    this.cover = null;         // a wall for cover being put up
    this.coverAt = -1e9;
    this.ignore = this.ignore || new Map();
  }

  /**
   * Catch loops: if the bot has stayed in one small area for a few seconds
   * without fighting anyone, give up on what it was doing and go somewhere else.
   */
  watchdog(game, s) {
    if (game.tick % 30 !== s.id % 30) return;
    const h = this.history;
    // (Flying or building its way out of somewhere, straight up, say: not stuck.)
    if (this.escape) { h.length = 0; return; }
    h.push({ x: s.x });
    if (h.length > 8) h.shift();
    if (h.length < 8) return;
    const xs = h.map(p => p.x);
    const fighting = this.target && game.tick - (this.lastSeen?.tick ?? -1e9) < 60;
    // (Or waiting where it is on purpose: holding a point, or at the spot to fly from, for fuel.)
    if (Math.max(...xs) - Math.min(...xs) > 50 || fighting || ['fight', 'hold', 'toward'].includes(this.goalKind)) return;
    // (Not in the middle of a jump: dropping it there could land us somewhere worse. Once it's down.)
    if (this.exec || !s.body.onGround) return;
    if (this.goalItem) this.ignore.set(this.goalItem, game.tick + 2400);
    this.goalItem = null;
    this.forceRoam = true;
    this.exec = null;
    this.path = null;
    this.thinkIn = 0;
    this.history = [];
    this.unstuck = (this.unstuck || 0) + 1;
  }

  /**
   * The route map changed (holes, building): plan again soon. Bots take turns over a
   * few updates (planning is the costly part), carrying on along their old route
   * meanwhile; it's still a route through real places, numbered as they were.
   */
  navChanged(game, s) {
    this.thinkIn = Math.min(this.thinkIn, 1 + (s.id % REPLAN_SPREAD));
  }

  onSpawn(game, s) {
    this.me = s;
    this.reset();
    this.aim = s.facing < 0 ? Math.PI : 0;
    this.thinkIn = 5 + Math.floor(this.rng() * 10);
  }

  onHurt(game, s, attacker) {
    // Getting hit throws the aim off a little.
    this.aimOff += this.gauss() * 0.06;
    if (attacker && attacker !== s && attacker.alive) {
      this.threat = attacker;
      this.lastSeen = { x: attacker.x, y: attacker.y, tick: game.tick };
      if (!this.target) this.thinkIn = Math.min(this.thinkIn, 4);
    }
  }

  input(game, s) {
    this.me = s;
    const inp = { move: 0, jump: false, jumpPressed: false, aim: this.aim ?? s.aim, fire: false, aimDist: 200 };
    if (!s.alive) return inp;
    // Held still by the mode (Defuse's freeze at the start of a round): not stuck.
    if (game.rules.frozen?.(game, s)) { this.history.length = 0; this.stuck = 0; }
    // (In huge games, look around a little less often.)
    const look = game.soldiers.length > 1000 ? 6 : 3;
    if (game.tick % look === s.id % look) this.perceive(game, s);
    if (game.tick % 15 === s.id % 15) this.pickWeapon(game, s, inp);
    // Classes on: medkits when someone's hurt, ammo when it's low, beacons near the objectives (gadgets.js).
    if (game.classesOn && game.tick % 20 === s.id % 20 && botWantsGadget(game, s, this)) inp.gadget = true;
    this.watchdog(game, s);
    const it = this.goalItem;
    if (it && (!it.active || (it.dropped && it.life <= 0) || !wantsItem(game, s, it))) {
      // Someone else took it, or we picked up the same thing elsewhere: find something else to do.
      this.goalItem = null;
      this.grabTicks = 0;
      this.thinkIn = Math.min(this.thinkIn, 3);
    } else if (it && game.tick % 12 === s.id % 12 && this.beaten(game, s, it, this.routeLeft())) {
      // Someone else is going to get there first: don't waste the trip (and leave it to
      // them for a few seconds, rather than taking it back the moment they look away).
      this.ignore.set(it, game.tick + YIELD_TICKS);
      this.goalItem = null;
      this.grabTicks = 0;
      this.thinkIn = Math.min(this.thinkIn, 3);
    }
    if (--this.thinkIn <= 0 && !this.exec && s.body.onGround && !this.escape) this.think(game, s);
    if (!this.escape) this.steer(game, s, inp);
    this.fight(game, s, inp);
    // Getting out of a pit or past what's in the way: a jetpack, or building with a hammer.
    if (this.escape) this.runEscape(game, s, inp);
    else this.coverUp(game, s, inp);
    this.detonate(game, s, inp);
    // Defuse: flashbangs and smoke, thrown where the mode says (not in the middle of a fight).
    if (game.rules.botThrow) this.utility(game, s, inp);
    // Defuse: hold E to plant the bomb, or to defuse it.
    if (game.rules.botUse) inp.use = game.rules.botUse(game, s, this);
    // Stuck in a pit with nothing left to do there: self-destruct (held until it goes off).
    if (this.destructing) inp.selfDestruct = true;
    inp.firePressed = inp.fire && !this.prevFire;
    this.prevFire = inp.fire;
    return inp;
  }

  /** The bot's sheep (or other remote-controlled thing) still out there, if any. */
  remoteOut(game, s) {
    if (game.crowded) return game.remoteOf(s); // (looked up once per update for everyone)
    return game.projectiles.find(p => p.owner === s && p.remote && !p.dead) || null;
  }

  /** A super sheep we're steering: keep aiming it for a few seconds before fighting on. */
  steering(game, s) {
    const p = this.remoteOut(game, s);
    return p && p.kind === 'flyer' && p.age < 240 / MOTION.timeScale ? p : null;
  }

  /** Set off our sheep when it's next to an enemy. */
  detonate(game, s, inp) {
    const p = this.remoteOut(game, s);
    if (!p || p.weapon !== s.current || p.age < 10) return;
    const r = (p.cfg.blast?.radius || 60) * 0.55;
    if (this.enemies(game, s).some(o => Math.hypot(o.x - p.x, o.y - 8 - p.y) < r)) {
      inp.fire = !this.prevFire;
    }
  }

  enemies(game, s) {
    return game.soldiers.filter(o => o !== s && o.alive && !(game.rules.teams && o.team === s.team));
  }

  /** A random enemy, without listing them all (big games). */
  someEnemy(game, s) {
    const all = game.soldiers;
    for (let i = 0; i < 12; i++) {
      const o = all[Math.floor(this.rng() * all.length)];
      if (o !== s && o.alive && !(game.rules.teams && o.team === s.team)) return o;
    }
    return null;
  }

  canSee(game, s, o) {
    const sx = s.shoulderX, sy = s.shoulderY;
    if (!game.map.clearLine(sx, sy, o.x, o.y - 8) && !game.map.clearLine(sx, sy, o.x, o.y - 17)) return false;
    // (Nobody sees through smoke.)
    return !smokeBetween(game, sx, sy, o.x, o.y - 12);
  }

  /** Bot vision 'sight': is `o` where this bot could see them (on its screen, in front of it)? */
  inView(game, s, o) {
    if (game.options.botVision !== 'sight') return true;
    const dx = o.x - s.x, dy = o.y - 10 - (s.y - 20);
    if (Math.abs(dx) > VIEW.hw || Math.abs(dy) > VIEW.hh) return false;
    if (Math.hypot(dx, o.y - s.y) < VIEW.touch) return true;
    const facing = Math.cos(this.aim ?? s.aim) >= 0 ? 1 : -1;
    return dx * facing >= -VIEW.behind;
  }

  /**
   * Bot vision 'sight': enemies' noises (shots, explosions, jetpacks, footsteps) within
   * earshot. The bot turns that way and goes to have a look (unless it's busy fighting).
   */
  listen(game, s) {
    for (const n of game.noises) {
      if (n.id <= (this.heardId ?? 0)) continue;
      this.heardId = n.id;
      const o = n.by;
      if (!o || o === s || (game.rules.teams && o.team === s.team)) continue;
      if (Math.hypot(n.x - s.x, n.y - s.y) > n.r) continue;
      if (this.target && this.target.alive) continue;
      this.lastSeen = { x: n.x, y: n.y, tick: game.tick, heard: true };
      this.thinkIn = Math.min(this.thinkIn, 8);
    }
  }

  perceive(game, s) {
    if (game.options.botVision === 'sight') this.listen(game, s);
    // Blinded by a flashbang: nothing to see until it wears off.
    const best = s.flashTicks > 40 ? null : game.crowded ? this.lookAround(game, s) : this.lookAtAll(game, s);
    if (best !== this.target) {
      // Already in a fight (or just were): quicker onto the next one than spotting someone out of the blue.
      this.quick = !!this.target || (!!this.lastSeen && game.tick - this.lastSeen.tick < 60);
      this.seen = 0;
      if (best && !this.target) this.thinkIn = Math.min(this.thinkIn, 6);
    }
    this.target = best;
    if (best) this.lastSeen = { x: best.x, y: best.y, tick: game.tick };
  }

  /** The enemy to fight: the nearest one in sight (sticking with the current target or attacker a bit longer). */
  lookAtAll(game, s) {
    let best = null, bestD = Infinity;
    for (const o of this.enemies(game, s)) {
      if (o.spawnProtect > 30) continue;
      const d = Math.hypot(o.x - s.x, o.y - s.y);
      if (d > SIGHT || !this.inView(game, s, o) || !this.canSee(game, s, o)) continue;
      const score = d * (o === this.target ? 0.6 : 1) * (o === this.threat ? 0.7 : 1);
      if (score < bestD) { bestD = score; best = o; }
    }
    return best;
  }

  /**
   * The same in a big game, without checking sight lines to everyone: look
   * outward from here, nearest soldiers first, and check at most a few.
   */
  lookAround(game, s) {
    const enemy = o => o !== s && o.alive && o.spawnProtect <= 30 && !(game.rules.teams && o.team === s.team);
    let best = null, bestD = Infinity;
    for (const o of [this.target, this.threat]) {
      if (!o || !enemy(o)) continue;
      const d = Math.hypot(o.x - s.x, o.y - s.y);
      if (d > SIGHT || !this.inView(game, s, o) || !this.canSee(game, s, o)) continue;
      const score = d * (o === this.target ? 0.6 : 1) * (o === this.threat ? 0.7 : 1);
      if (score < bestD) { bestD = score; best = o; }
    }
    const grid = game.soldierGrid(), cx = Math.floor(s.x / CELL), cy = Math.floor(s.y / CELL);
    const ring = [], near = [];
    let looks = 0;
    for (let k = 0; (k - 1) * CELL <= Math.min(SIGHT, bestD); k++) {
      ring.length = 0;
      near.length = 0;
      // The nearest few in this ring, nearest first (kept sorted as we go).
      // In a packed crowd, the first few dozen are plenty to choose from.
      let seen = 0;
      for (const o of grid.ring(cx, cy, k, ring)) {
        if (++seen > 48) break;
        if (o === this.target || o === this.threat || !enemy(o)) continue;
        const d = Math.hypot(o.x - s.x, o.y - s.y);
        if (d > SIGHT || d >= bestD || (near.length === LOOKS && d >= near[LOOKS - 1].d)) continue;
        let i = near.length < LOOKS ? near.length : LOOKS - 1;
        while (i > 0 && near[i - 1].d > d) { near[i] = near[i - 1]; i--; }
        near[i] = { d, o };
      }
      for (const { d, o } of near) {
        if (!this.inView(game, s, o)) continue;
        if (looks++ >= LOOKS) return best;
        if (this.canSee(game, s, o)) { bestD = d; best = o; break; }
      }
    }
    return best;
  }

  pickWeapon(game, s, inp) {
    if (this.steering(game, s)) return; // keep hold of the super sheep's controls
    const d = this.target ? Math.hypot(this.target.x - s.x, this.target.y - s.y) : 450;
    let best = s.current, bestScore = s.has(s.current) ? weaponScore(s.current, d, s, game, this.target) + 0.5 : -1;
    for (const id in s.weapons) {
      if (!s.has(id)) continue;
      const sc = weaponScore(id, d, s, game, this.target);
      if (sc > bestScore) { bestScore = sc; best = id; }
    }
    if (best !== s.current) inp.switchTo = best;
  }

  // ---- Choosing where to go -------------------------------------------------

  /** Roughly how many updates until this bot gets to the end of its route. */
  routeLeft() {
    const p = this.path;
    if (!p) return Infinity;
    let c = 0;
    for (let i = this.li; i < p.length; i++) c += p[i].cost + (p[i].penalty || 0);
    return c;
  }

  /**
   * Will someone else get to item `it` first, if this bot is `eta` updates away?
   * Another bot already on its way there with less of its route left (an even
   * race goes to one of them), or a player right next to it who wants it.
   * There's no point racing them for it.
   */
  beaten(game, s, it, eta) {
    // (Bots that only know what they see don't know where enemies out of sight are.)
    const sight = game.options.botVision === 'sight';
    const knows = o => !sight || (game.rules.teams && o.team === s.team) || (this.inView(game, s, o) && this.canSee(game, s, o));
    for (const c of it.racers || []) {
      const o = c.me;
      if (!o || o === s || !o.alive || game.controllers.get(o) !== c) continue;
      const theirs = c.routeLeft();
      if ((theirs < eta - RACE_MARGIN || (theirs <= eta + RACE_MARGIN && o.id < s.id)) && knows(o)) return true;
    }
    for (const o of game.near(it.x - NEAR_ITEM, it.y - NEAR_ITEM, it.x + NEAR_ITEM, it.y + NEAR_ITEM)) {
      if (o.isBot || !o.alive || o === s) continue;
      const d = Math.hypot(o.x - it.x, o.y - it.y);
      if (d < NEAR_ITEM && d / PHYS.runSpeed < eta - RACE_MARGIN && wantsItem(game, o, it) && knows(o)) return true;
    }
    return false;
  }

  think(game, s) {
    this.thinkIn = 35 + Math.floor(this.rng() * 25);
    const start = this.nav.nodeAt(s.x, s.y, 10);
    if (!start) {
      // Somewhere the route map doesn't cover (a nook holes left, before the route map
      // catches up): a jump, drop or walk from right here that lands on a spot, tried with
      // the real physics. Failing that, head for the closest spot.
      const way = this.nav.escape(s.x, s.y);
      this.thinkIn = 20;
      this.offGraph = null;
      if (way) { this.path = [way]; this.li = 0; this.start = { x: s.x, y: s.y }; return; }
      this.path = [];
      this.offGraph = this.nav.nearest(s.x, s.y, 200);
      // Nowhere to go from here: fly out, or build a way out; failing that (nobody to
      // fight, for a few seconds), self-destruct.
      if (!this.target && this.startEscape(game, s, exitSpot(this.nav, s))) return;
      this.lastResort(game, s, !this.target);
      return;
    }
    this.offGraph = null;
    // Pits nobody can climb out of: only go into one if already in it.
    const trapped = this.nav.trapped(), inPit = trapped[start.id] === 1;
    const ok = n => !!n && (inPit || !trapped[n.id]);
    const search = game.crowded ? this.nav.cachedCostsFrom(start, game.tick) : this.nav.costsFrom(start);
    // The objective modes: where the mode wants this bot to be (a hill, a flag, a capture point...).
    const obj = game.rules.botGoal?.(game, s, this) || null;
    const inObj = obj && inZone(s, obj.zone);
    // Pickups are worth less when there's somewhere to be (unless we're already there),
    // and only ones close by are worth the detour.
    const busy = obj && !(inObj && obj.hold);
    const detour = !busy ? 0 : obj.urgent ? 6 : 2;
    let pickupReach = busy ? (obj.urgent ? 90 : 150) : Infinity;
    const costTo = (x, y) => {
      let n = this.nav.nearest(x, y, 90);
      // No way there (cut off by holes, say): as close as we can get.
      if (!ok(n) || search.cost[n.id] === Infinity) n = this.nav.nearestReached(search, x, y, 700, ok);
      return n ? { n, c: search.cost[n.id] } : { n: null, c: Infinity };
    };

    let goal = null, kind = null;
    if (this.forceRoam) {
      // Just got unstuck: go somewhere well away from here first.
      this.forceRoam = false;
      const far = this.nav.nodes.filter(n => search.cost[n.id] < Infinity && ok(n) && Math.hypot(n.x - s.x, n.y - s.y) > 250);
      if (far.length) {
        this.goalKind = 'roam';
        this.goalItem = null;
        this.path = this.nav.pathTo(search, far[Math.floor(this.rng() * far.length)]) || [];
        this.li = 0;
        this.start = start;
        return;
      }
    }
    const items = game.pickups.items.filter(it => it.active && !((this.ignore.get(it) || 0) > game.tick));
    let goalItem = null;
    const best = (filter, value) => {
      let pick = null, pv = -Infinity, item = null;
      for (const it of items) {
        if (!filter(it)) continue;
        const n = nodeFor(this.nav, it);
        // Only items a soldier standing at that spot could reach (not on a roof above it).
        if (!ok(n) || Math.abs(n.x - it.x) > 45 || it.y < n.y - 75 || it.y > n.y + 30) continue;
        // (Nor one with a ceiling or wall in the way, say a pack left over a hole.)
        if (!reachable(game, n, it)) continue;
        const c = search.cost[n.id];
        // Stick with the item already on the way to (a reach judged afresh each time
        // would flip a bot back and forth between an item and its objective).
        const mine = it === this.goalItem;
        if (c > (mine ? pickupReach * 2 + 60 : pickupReach)) continue;
        const v = value(it) - c / 60 - detour + (mine ? 1.5 : 0);
        // (Not one someone else will get to first.)
        if (v > pv && !this.beaten(game, s, it, c)) { pv = v; pick = n; item = it; }
      }
      if (pv <= 0) return null;
      goalItem = item;
      return pick;
    };

    if (s.health < 55) {
      goal = best(it => it.type === 'health' || (it.type === 'crate' && it.landed && it.health), () => (70 - s.health) / 6);
      kind = 'health';
    }
    if (!goal) {
      const owned = Object.keys(s.weapons).filter(id => s.has(id));
      const topValue = Math.max(...owned.map(id => weaponValue(id)));
      // Just the pistol: a proper gun is worth a longer detour on the way.
      if (busy && topValue < 3) pickupReach = Math.max(pickupReach, 300);
      const isWeapon = it => (it.type === 'weapon' || (it.type === 'crate' && it.landed && !it.health)) && WEAPONS[it.weapon];
      goal = best(
        it => isWeapon(it) && wantsItem(game, s, it),
        // (In a fight, a new gun is worth less, unless it's the one we're already going for.)
        it => (s.weapons[it.weapon] ? 1.5 : weaponValue(it.weapon) + 2) + (topValue < 3 ? 6 : 0) - (this.target && it !== this.goalItem ? 3 : 0) + (it.type === 'crate' ? 1.5 : 0),
      );
      kind = 'weapon';
    }
    if (!goal && s.armour < 50) { goal = best(it => it.type === 'armour', () => 3); kind = 'armour'; }

    const def = WEAPONS[s.current];
    const far = def.bot?.far ?? def.range ?? 400;
    const reach = def.kind === 'melee' ? far + 4 : ['rail', 'seeker', 'strike'].includes(def.kind) ? 1400 : Math.min(far * 0.9, 650);
    const inRange = this.target && Math.hypot(this.target.x - s.x, this.target.y - s.y) < reach && onScreen(def, this.target.x - s.x, this.target.y - s.y, 0.9);
    if (!goal && obj && (!inObj || obj.hold)) {
      // On the way, an enemy in range sometimes makes the bot stop and fight (not when it's urgent).
      const stopToFight = !inObj && inRange && !obj.urgent && this.rng() < 0.4;
      if (!stopToFight) {
        if (inObj && this.rng() * 40 < this.profile.camp) goal = start; // hold still here a while
        else {
          let pv = Infinity;
          // (Spots that can see a point, where the mode wants that: Defuse's guards watch the bomb.)
          const nodes = this.zoneNodes(obj), watch = obj.see ? this.watching(game, nodes, obj.see) : null;
          for (const n of watch?.length ? watch : nodes) {
            const c = search.cost[n.id];
            if (c === Infinity || !ok(n) || (obj.avoid && inZone(n, obj.avoid))) continue;
            // Getting there: the quickest way in. Already there: move about inside, nearby.
            const v = inObj ? Math.hypot(n.x - s.x, n.y - s.y) * 0.4 + this.rng() * 160 : c + this.rng() * 30;
            if (v < pv) { pv = v; goal = n; }
          }
        }
        if (goal) kind = inObj ? 'hold' : 'objective';
        if (obj.moving || obj.urgent) this.thinkIn = 18 + Math.floor(this.rng() * 12);
      }
    }
    if (!goal && this.target && !inRange && !obj) {
      goal = costTo(this.target.x, this.target.y + 4).n;
      kind = 'chase';
    }
    if (!goal && this.target) {
      // In a fight: hold position (campers) or move around nearby to be harder to hit.
      kind = 'fight';
      if (this.rng() * 40 < this.profile.camp) goal = start;
      else {
        const near = this.nav.nodesNear(s.x, s.y, 140, 120).filter(n => search.cost[n.id] < 110 && ok(n));
        goal = near.length ? near[Math.floor(this.rng() * near.length)] : start;
      }
    }
    if (!goal && this.lastSeen && !this.lastSeen.checked && game.tick - this.lastSeen.tick < 300) {
      goal = costTo(this.lastSeen.x, this.lastSeen.y).n;
      kind = 'chase';
      // Already there (or as near as we can get), and nobody's about: look somewhere else.
      if (goal === start) { this.lastSeen.checked = true; goal = null; }
    }
    if (!goal) {
      // Hunt: head for a random enemy, or wander. (Bots that only know what they see and
      // hear don't know where anyone is: they just wander.)
      const blind = game.options.botVision === 'sight';
      const f = game.crowded && !blind ? this.someEnemy(game, s) : null;
      const foes = blind ? [] : game.crowded ? (f ? [f] : []) : this.enemies(game, s);
      if (foes.length && this.rng() < 0.75) {
        const f = foes[Math.floor(this.rng() * foes.length)];
        goal = costTo(f.x, f.y + 4).n;
        kind = 'hunt';
      }
      for (let i = 0; i < 8 && (!goal || search.cost[goal.id] === Infinity || !ok(goal)); i++) {
        goal = this.nav.nodes[Math.floor(this.rng() * this.nav.nodes.length)];
        kind = 'roam';
      }
    }

    // In melee range of the target, get right up close.
    if (kind === 'chase' && def.kind === 'melee' && this.target) goal = costTo(this.target.x, this.target.y + 4).n || goal;
    // (Where it really wants to be: the objective, or the enemy it's after.)
    const want = obj && !inObj ? { x: (obj.zone.left + obj.zone.right) / 2, y: obj.zone.bottom - 12 }
      : kind === 'chase' && this.target ? { x: this.target.x, y: this.target.y } : null;
    // Somewhere it wants to be that it can't get to at all (a ledge too high, across a gap
    // holes left, an enemy up there): over to a spot with room above to fly or build from;
    // once there, fly there with the jetpack, or build a way (steps up, a bridge across).
    let toward = null;
    if (want && !inPit && ['roam', 'hunt', 'chase'].includes(kind) && this.escapeFails < 3 && game.tick - this.towardAt > 600) {
      // (Somewhere to stand there: not an enemy up in the air with a jetpack, say.)
      const to = this.nav.nearest(want.x, want.y, 90);
      const able = to && (blocksLeft(s) >= 2 || (s.body.hasJetpack && flyFuel(s, { x: s.x, y: Math.min(s.y, to.y) }) <= 100));
      if (able && search.cost[to.id] === Infinity) {
        const from = launchSpot(game, this.nav, search, to, ok);
        if (from) { goal = from; kind = 'toward'; toward = { to, want }; }
      }
    }
    this.goalKind = kind;
    this.goalItem = ['health', 'weapon', 'armour'].includes(kind) ? goalItem : null;
    // In a pit, nobody to fight and nothing to pick up: fly or build a way out (with no
    // way of its own, after a few seconds, self-destruct: lastResort).
    if (inPit && !this.target && !this.goalItem && this.startEscape(game, s, exitSpot(this.nav, s))) return;
    this.lastResort(game, s, inPit && !this.target && !this.goalItem);
    this.path = this.nav.pathTo(search, goal) || [];
    this.li = 0;
    this.start = start;
    // At the spot to go on from: off we go (a jetpack low on fuel: once it's filled up).
    if (toward && goal === start && this.startEscape(game, s, toward.to, toward.want)) this.towardAt = game.tick;
  }

  /**
   * Stuck (`idle`: in a pit, or somewhere off the route map, with nobody to fight and
   * nothing to pick up) and no way out of its own: after a few seconds of that,
   * self-destruct to respawn, the last resort. (A jetpack filling up is a way out.)
   */
  lastResort(game, s, idle) {
    if (!idle) { this.trappedSince = -1; return; }
    if (this.trappedSince < 0) this.trappedSince = game.tick;
    if (game.tick - this.trappedSince > 240 && this.helpless(game, s) && game.respawnEscapes(s)) this.destructing = true;
  }

  /**
   * True if the bot has no way of its own out of the pit it's in (no jetpack that can
   * fly that high, no blocks to build with, or they've failed): only then does it self-destruct.
   */
  helpless(game, s) {
    const to = this.escapeFails < 3 && exitSpot(this.nav, s);
    return !to || (!buildTool(s) && !(s.body.hasJetpack && flyFuel(s, to) <= 100));
  }

  /**
   * Start getting out (of a pit) or on (to a place it can't get to): fly there with the
   * jetpack, or build plank steps up (or a bridge across a gap) with a hammer.
   * to: where to (a route map spot or { x, y }); goal: where it's really going (a bridge
   * stops once it's across). Returns true if it started.
   */
  startEscape(game, s, to, goal = null) {
    if (!to || this.escapeFails >= 3) return false;
    // A jetpack: once there's the fuel to get that high (it fills up on the ground).
    const need = s.body.hasJetpack ? flyFuel(s, to) : Infinity;
    if (need <= 100 && s.body.fuel >= need) {
      this.escape = { kind: 'fly', to, start: game.tick, airborne: false };
      return true;
    }
    if (!buildTool(s)) return false;
    const dir = Math.sign(to.x - s.x) || (this.rng() < 0.5 ? -1 : 1);
    const feet = s.y + 12;
    const gap = !game.map.raycast(s.x + dir * 16, feet - 4, s.x + dir * 16, feet + 100);
    const mode = goal && to.y > s.y - 50 && gap ? 'across' : 'up';
    this.escape = { kind: 'build', mode, dir, goal, to, phase: 'place', start: game.tick, steps: 0, misses: 0, waited: 0 };
    this.path = [];
    this.exec = null;
    return true;
  }

  /** Carry on flying or building (botescape.js); hand back to the route once there's a way on. */
  runEscape(game, s, inp) {
    const e = this.escape;
    // Someone to fight right here: that first (not mid-air: carry on).
    if (this.target && s.body.onGround && e.kind === 'build' && e.phase === 'place') return;
    const r = e.kind === 'fly' ? fly(game, s, e, inp) : climb(game, s, e, inp, this.nav);
    if (r === 'flying' || r === 'building') return;
    this.escape = null;
    this.thinkIn = 0;
    if (r === 'failed') { this.escapeFails++; return; }
    if (r === 'out' && e.link) {
      // A way on from right here (the route map doesn't know about the new blocks yet).
      this.path = [e.link];
      this.li = 0;
      this.start = { x: s.x, y: s.y };
      this.thinkIn = 40;
    }
    this.escapeFails = 0;
  }

  /**
   * In a fight at range, hurt or reloading, with blocks to build with: a wall a step
   * toward the enemy, to stand behind for a moment.
   */
  coverUp(game, s, inp) {
    const c = this.cover;
    if (c) {
      // (Put up where we stand: given up if we've been moved off it.)
      if (game.tick > c.until || !s.weapons[c.tool] || !s.alive || !s.body.onGround || Math.abs(s.x - c.fromX) > 8 || Math.abs(s.y - c.fromY) > 4) { this.cover = null; return; }
      inp.move = 0;
      inp.jump = inp.jumpPressed = false;
      if (s.current !== c.tool) { inp.switchTo = c.tool; return; }
      inp.switchTo = undefined;
      inp.plank = false;
      inp.aim = Math.atan2(c.y - s.shoulderY, c.x - s.shoulderX);
      inp.aimDist = Math.hypot(c.x - s.shoulderX, c.y - s.shoulderY);
      inp.fire = Math.abs(angleDiff(s.aim, inp.aim)) < 0.05 && !s.buildPlank && game.tick % 2 === 0;
      if (s.weapons[c.tool].ammo < c.ammo) {
        // Up: stay behind it a moment (then back to the gun: pickWeapon).
        this.cover = null;
        this.path = [];
        this.thinkIn = 90;
      }
      return;
    }
    const t = this.target;
    if (!t || !s.body.onGround || game.tick - this.coverAt < 480 || blocksLeft(s) < 2) return;
    const dx = t.x - s.x;
    if (Math.abs(dx) < 220 || Math.abs(dx) > 750 || Math.abs(t.y - s.y) > 60) return;
    if (!(s.health < 60 || s.reloadTimer > 0)) return;
    this.coverAt = game.tick;
    const spot = coverSpot(game, s, t.x);
    const tool = buildTool(s);
    if (spot && tool) this.cover = { ...spot, tool, ammo: s.weapons[tool].ammo, until: game.tick + 45, fromX: s.x, fromY: s.y };
  }

  /** Of these route map spots, the ones with a clear view of point p (remembered for the point, while the map stays as it is). */
  watching(game, nodes, p) {
    const key = `${Math.round(p.x)}|${Math.round(p.y)}|${game.map.version}|${nodes.length}`;
    if (this.watchKey !== key) {
      this.watchKey = key;
      this.watchList = nodes.filter(n => game.map.clearLine(n.x, n.y - 17, p.x, p.y));
    }
    return this.watchList;
  }

  /** Route map spots inside an objective's area (remembered, unless the area moves about). */
  zoneNodes(obj) {
    const z = obj.zone;
    const key = `${Math.round(z.left)}|${Math.round(z.top)}|${Math.round(z.right)}|${Math.round(z.bottom)}`;
    const cache = (this.nav.zoneCache ||= new Map());
    let list = obj.moving ? null : cache.get(key);
    if (!list) {
      list = this.nav.nodesNear((z.left + z.right) / 2, (z.top + z.bottom) / 2, (z.right - z.left) / 2 + 2, (z.bottom - z.top) / 2 + 8).filter(n => inZone(n, z));
      if (!list.length) {
        // Nowhere to stand in it (a flag carried through the air): the nearest spot.
        const n = this.nav.nearest((z.left + z.right) / 2, z.bottom - 12, 240);
        list = n ? [n] : [];
      }
      if (!obj.moving) {
        cache.set(key, list);
        if (cache.size > 400) cache.delete(cache.keys().next().value);
      }
    }
    return list;
  }

  // ---- Following the route --------------------------------------------------

  steer(game, s, inp) {
    const b = s.body;
    if (this.exec) {
      const e = this.exec, link = e.link;
      if (!b.onGround) e.airborne = true;
      if (link.type === 'jump') {
        inp.move = jumpSteer(link.move, e.t);
        inp.jump = true;
        inp.jumpPressed = e.t === 0;
      } else {
        if (e.airborne && e.fellAt < 0) e.fellAt = e.t;
        inp.move = dropSteer(link.move, e.fellAt < 0 ? -1 : e.t - e.fellAt);
      }
      e.t++;
      if (e.airborne && b.onGround) {
        this.exec = null;
        const n = this.nav.nodeAt(s.x, s.y, 10);
        if (n === link.to) { this.li++; link.penalty &&= link.penalty > 10 ? link.penalty * 0.6 : 0; }
        else {
          // Landed somewhere else. Unless something hit us on the way, remember this move is unreliable.
          if (s.lastHurtTick === e.hurt) linkFailed(link);
          this.thinkIn = 0;
        }
      } else if (e.t > (link.ticks ? link.ticks * 1.5 + 30 : 400 / MOTION.timeScale) || (!e.airborne && e.t > 30)) {
        // Taking far longer than it should (bouncing on the edge of a jump pad, say): it failed.
        if (e.airborne && s.lastHurtTick === e.hurt) linkFailed(link);
        this.exec = null;
        this.thinkIn = 0;
        this.path = null;
      }
      return;
    }
    if (!b.onGround) {
      // Slipped off a ledge while following the route (not knocked off, not a jump pad): that step is unreliable.
      const link = this.path && this.path[this.li];
      if (this.airTicks === 0 && link && !b.bounced && game.tick - (s.lastHurtTick ?? -1e9) > 30) linkFailed(link);
      this.steerInAir(game, s, inp);
      return;
    }
    this.airTicks = 0;
    this.bounces = 0;

    if (this.offGraph) {
      const n = this.offGraph, dx = n.x - s.x;
      // Right above it (on a jump pad's raised edge, say): step off to one side to drop down to it.
      inp.move = Math.abs(dx) > 2 || (n.y < s.y - 4 && Math.abs(dx) > 0.5) ? Math.sign(dx) : n.y > s.y + 4 ? (this.offDir ||= this.rng() < 0.5 ? -1 : 1) : 0;
      if (n.y < s.y - 4) { inp.jump = true; inp.jumpPressed = true; }
      return;
    }
    const link = this.path && this.path[this.li];
    if (!link) {
      // At the goal. Items often float above the floor or over a jump pad:
      // walk to them and hop up to grab them, but give up if it takes too long.
      const it = this.goalItem;
      if (it && it.active && Math.abs(it.x - s.x) < 100 && Math.abs(it.y - s.y) < 120) {
        this.grabTicks = (this.grabTicks || 0) + 1;
        if (this.grabTicks > 150 / MOTION.timeScale) {
          this.ignore.set(it, game.tick + 900);
          this.goalItem = null;
          this.grabTicks = 0;
          this.thinkIn = 0;
          return;
        }
        inp.move = Math.abs(it.x - s.x) > 3 ? Math.sign(it.x - s.x) : 0;
        if (Math.abs(it.x - s.x) < 14 && it.y < s.y - 10) inp.jump = inp.jumpPressed = true;
        // Walking into something (the side of a raised jump pad, say): hop over it.
        if (inp.move && Math.abs(b.vx) < 0.2 && this.grabTicks > 6) inp.jump = inp.jumpPressed = true;
        this.thinkIn = Math.max(this.thinkIn, 10);
        return;
      }
      this.grabTicks = 0;
      if (this.thinkIn > 8 && this.goalKind !== 'hold') this.thinkIn = 8;
      this.watchStuck(game, s, inp);
      return;
    }
    if (link.type === 'walk') {
      const dx = link.to.x - s.x;
      // Keep running if the route carries on the same way; otherwise slow down to stop on the spot.
      const next = this.path[this.li + 1];
      const through = next && next.type === 'walk' && next.dir === link.dir;
      // (There once level with it: a step up right by the spot isn't climbed yet.)
      if ((Math.abs(dx) < 3 && Math.abs(s.y - link.to.y) < 3) || Math.sign(dx) !== link.dir) { this.li++; inp.move = through ? link.dir : 0; }
      else inp.move = through || Math.abs(dx) < 3 ? link.dir : approach(dx, b.vx);
      // A long clear run ahead and nobody to fight: sprint (easing off before the route turns or jumps).
      if (!this.target && this.goalKind !== 'hold') {
        let run = 0;
        for (let i = this.li; i < this.path.length && run < SPRINT_RUN; i++, run++) {
          const l = this.path[i];
          if (l.type !== 'walk' || l.dir !== link.dir) break;
        }
        inp.sprint = run >= SPRINT_RUN;
      }
      if (Math.abs(s.y - link.to.y) > 14) this.thinkIn = 0;
    } else {
      const from = this.li === 0 ? this.start : this.path[this.li - 1].to;
      const dx = from.x - s.x;
      if (Math.abs(s.y - from.y) > 14) { this.thinkIn = 0; return; }
      if (Math.abs(dx) > 6) inp.move = approach(dx, b.vx);
      else if (Math.abs(dx) > 1.5) inp.move = Math.abs(b.vx) < 1 ? Math.sign(dx) : 0;
      else if (Math.abs(b.vx) > 0.6) inp.move = 0;
      else {
        this.exec = { link, t: 0, airborne: false, fellAt: -1, hurt: s.lastHurtTick };
        this.steer(game, s, inp);
        return;
      }
    }
    this.watchStuck(game, s, inp);
  }

  /**
   * In the air without a planned move (bounced off a jump pad, knocked back):
   * steer toward where we're going, and don't get stuck bouncing on a pad forever.
   */
  steerInAir(game, s, inp) {
    const b = s.body;
    this.airTicks++;
    if (b.bounced) this.bounces++;
    const it = this.goalItem;
    const link = this.path && this.path[this.li];
    const want = it && it.active && Math.abs(it.x - s.x) < 120 ? it : link ? link.to : this.offGraph;
    // Hopping for an item: steer for it straight away, and hold the jump for its full height.
    const grabbing = want === it && !link && this.grabTicks > 0;
    if (want && (this.bounces > 0 || this.airTicks > 45 || grabbing)) {
      const dx = want.x - s.x;
      inp.move = Math.abs(dx) > 4 ? Math.sign(dx) : 0;
    }
    if (grabbing && b.vy < 0) inp.jump = true;
    if (!want && this.bounces > 0) this.stepOffPad(game, s, inp);
    if (this.bounces >= 3) {
      // Stuck bouncing: give up on whatever is here, step off the pad, and plan again on landing.
      if (it) this.ignore.set(it, game.tick + 2400);
      this.goalItem = null;
      if (!inp.move) this.stepOffPad(game, s, inp);
      this.thinkIn = 0;
      this.path = null;
    }
    if (it && it.active && !link && Math.abs(it.x - s.x) < 100) {
      // At the item but can't land next to it: don't keep trying forever.
      this.grabTicks++;
      if (this.grabTicks > 150 / MOTION.timeScale) { this.ignore.set(it, game.tick + 1800); this.goalItem = null; this.grabTicks = 0; }
    }
  }

  /** Bouncing on a jump pad: steer off it, over its nearer end. */
  stepOffPad(game, s, inp) {
    const pad = game.map.solids.find(p => p.bounce && s.x >= p.l - 8 && s.x <= p.r + 8 && p.t >= s.y && p.t - s.y < 900);
    if (pad) inp.move = s.x - pad.l < pad.r - s.x ? -1 : 1;
  }

  /** If the bot hasn't moved for a while, jump somewhere and rethink. */
  watchStuck(game, s, inp) {
    const n = this.nav.nodeAt(s.x, s.y, 14);
    if (n && n === this.lastNode && this.goalKind !== 'fight' && this.goalKind !== 'hold') this.stuck++;
    else this.stuck = 0;
    this.lastNode = n;
    if (this.stuck > 150) {
      this.stuck = 0;
      inp.jump = inp.jumpPressed = true;
      inp.move = this.rng() < 0.5 ? -1 : 1;
      this.thinkIn = 0;
    }
  }

  // ---- Aiming and shooting --------------------------------------------------

  /**
   * A flashbang or smoke grenade to throw (the mode's choice: game.rules.botThrow gives
   * { id, x, y }): out it comes, a lob onto that spot, then (a flashbang) a look away
   * until it's gone off.
   */
  utility(game, s, inp) {
    let u = this.throwing;
    if (u && (this.target || game.tick > u.until || !(s.weapons[u.id]?.ammo > 0))) u = this.throwing = null;
    if (!u && !this.target && s.body.onGround && game.tick % 20 === s.id % 20) {
      u = game.rules.botThrow(game, s, this);
      if (u) this.throwing = u = { ...u, until: game.tick + 90 };
    }
    if (!u) return;
    if (s.current !== u.id) { inp.switchTo = u.id; return; }
    inp.switchTo = undefined;
    const def = WEAPONS[u.id], sx = s.shoulderX, sy = s.shoulderY;
    const want = lobAngle(u.x - sx, u.y - sy, def.speed, def.gravity ?? MOTION.grenadeGravity);
    // (Too far to throw from here after all: not now.)
    if (want == null) { this.throwing = null; return; }
    const cur = this.aim ?? s.aim;
    this.aim = cur + clamp(angleDiff(cur, want), -this.d.turn, this.d.turn);
    inp.aim = this.aim;
    inp.aimDist = 9999;
    if (Math.abs(angleDiff(this.aim, want)) < 0.04 && s.cooldown <= 0) {
      inp.fire = !this.prevFire;
      if (inp.fire) {
        this.throwing = null;
        if (def.flash) this.lookAway = { x: u.x, until: game.tick + (def.fuse || 90) + 15 };
      }
    }
  }

  fight(game, s, inp) {
    const t = this.target;
    const sx = s.shoulderX, sy = s.shoulderY;
    if (!t) {
      // Look where we're going, or where the enemy was last seen (or away from our own flashbang).
      let want;
      if (this.lookAway && game.tick < this.lookAway.until) want = this.lookAway.x < s.x ? -0.05 : Math.PI + 0.05;
      else if (this.lastSeen && game.tick - this.lastSeen.tick < 120) want = Math.atan2(this.lastSeen.y - 10 - sy, this.lastSeen.x - sx);
      else if (Math.abs(s.body.vx) > 0.5) want = s.body.vx < 0 ? Math.PI + 0.05 : -0.05;
      else if (game.options.botVision === 'sight') {
        // Standing still with only its eyes to go on: look the other way now and then.
        if (game.tick >= (this.glanceAt ?? 0)) {
          this.glanceAt = game.tick + 100 + Math.floor(this.rng() * 160);
          this.glance = Math.cos(this.aim ?? s.aim) >= 0 ? Math.PI : 0;
        }
        want = this.glance ?? this.aim ?? s.aim;
      } else want = this.aim ?? s.aim;
      this.aim = (this.aim ?? s.aim) + clamp(angleDiff(this.aim ?? s.aim, want), -this.d.turn * 0.6, this.d.turn * 0.6);
      inp.aim = this.aim;
      return;
    }
    this.seen++;
    const d = this.d;
    const def = WEAPONS[s.current];
    const b = def.bot || {};
    // Where the bot thinks the target is: where it saw them `delay` updates ago, carried on
    // part of the way at the speed they were going then.
    const seen = this.remember(t, d.delay);
    const ahead = d.delay * d.extrap;
    let tx = seen.x + seen.vx * ahead, ty = seen.y + seen.vy * ahead - (def.kind === 'rail' && this.profile.skill >= 2 ? 15 : 7);
    const dist = Math.hypot(tx - sx, ty - sy);
    inp.aimDist = dist;
    let desired;
    if (b.lob) {
      const g = def.gravity ?? MOTION.grenadeGravity;
      inp.aimDist = 9999; // throw as hard as possible, so the arc matches the maths
      desired = lobAngle(tx - sx, ty - sy, def.speed, g) ?? Math.atan2(ty - sy - dist * 0.3, tx - sx);
    } else if (b.walker) {
      desired = tx < sx ? Math.PI : 0;
    } else {
      if (def.speed && !['rail', 'seeker', 'flyer', 'strike'].includes(def.kind)) {
        const lead = (dist / shotSpeed(game, def)) * (0.5 + this.profile.skill * 0.15);
        tx += seen.vx * lead;
        ty += seen.vy * lead * 0.4;
      }
      desired = Math.atan2(ty - sy, tx - sx);
    }
    const cur = this.aim ?? s.aim;
    // Someone new: a flick over to them, landing a bit off (more, the further it turns).
    if (this.seen === 1) this.aimOff = this.gauss() * (d.flick + d.flickPct * Math.abs(angleDiff(cur, desired))) * this.aimMult;
    // Settling down to a steady wobble (a shakier one on the move).
    const shake = Math.abs(s.body.vx) > 1 || !s.body.onGround ? 1.6 : 1;
    this.aimOff += -this.aimOff * d.settle + this.gauss() * d.tremor * this.aimMult * shake * Math.sqrt(2 * d.settle);
    const want = desired + this.aimOff;
    this.aim = cur + clamp(angleDiff(cur, want), -d.turn, d.turn);
    inp.aim = this.aim;

    if (this.seen < (this.quick ? this.reaction * 0.55 : this.reaction)) return;
    if (this.steering(game, s)) return; // the super sheep is steered by our aim
    // (Not a flashbang or smoke grenade at someone: they're for throwing ahead; nor a hammer. Out comes a gun soon.)
    if ((def.kind === 'thrown' || def.kind === 'build') && !b.score) return;
    // (It fires once its aim is where it means it to be, and that doesn't look well off the target.)
    const off = Math.max(Math.abs(angleDiff(this.aim, want)), Math.abs(this.aimOff) * 0.6);
    const cone = def.kind === 'rail' ? this.d.fireCone * 0.35
      : def.kind === 'flame' || (def.pellets || 0) > 1 ? this.d.fireCone * 1.6
      : def.kind === 'melee' || b.walker || def.kind === 'quake' || def.kind === 'strike' ? 3
      : this.d.fireCone;
    if (off > cone) return;
    const maxRange = def.kind === 'melee' ? (b.far ?? 22) + 8 : (b.far ?? def.range ?? 600) * 1.05;
    if (dist > maxRange || !onScreen(def, t.x - s.x, t.y - s.y)) return;
    if (b.walker && Math.abs(ty - sy) > 70) return;
    if (b.mine && (this.lastMine && game.tick - this.lastMine < 600)) return;
    const explosive = def.kind === 'rocket' || def.kind === 'thrown' || def.kind === 'flyer' || def.kind === 'kamikaze';
    if (explosive && dist < 75 && def.kind !== 'kamikaze') return;
    if (explosive && def.kind !== 'kamikaze' && !b.lob) {
      // Don't blow ourselves up on a wall right in front of us.
      const dx = Math.cos(this.aim), dy = Math.sin(this.aim);
      if (game.map.raycast(sx, sy, sx + dx * 70, sy + dy * 70)) return;
    }
    if (this.rng() < this.d.trigger) {
      inp.fire = true;
      if (b.mine) this.lastMine = game.tick;
    }
  }

  /**
   * Remember where target t is now, and return where the bot saw them `delay` updates
   * ago ({ x, y, vx, vy }; as far back as it has, if it's only just spotted them).
   */
  remember(t, delay) {
    const a = this.seenAt;
    if (t !== this.seenOf) { this.seenOf = t; this.seenCount = 0; }
    const i = (this.seenCount % SEEN_LEN) * 4;
    a[i] = t.x; a[i + 1] = t.y; a[i + 2] = t.body.vx; a[i + 3] = t.body.vy;
    this.seenCount++;
    const back = Math.min(delay, this.seenCount - 1, SEEN_LEN - 1);
    const j = ((this.seenCount - 1 - back) % SEEN_LEN) * 4;
    const v = (this.seenView ||= {});
    v.x = a[j]; v.y = a[j + 1]; v.vx = a[j + 2]; v.vy = a[j + 3];
    return v;
  }

  /** A normally distributed random number (from two uniform ones). */
  gauss() {
    return Math.sqrt(-2 * Math.log(this.rng() || 1e-9)) * Math.cos(2 * Math.PI * this.rng());
  }
}

function linkFailed(link) {
  link.penalty = Math.min(MAX_PENALTY, (link.penalty || 0) + FAIL_COST);
}

/** Launch angle that lobs a projectile (speed v, gravity g) onto a point dx,dy away; y points down. */
export function lobAngle(dx, dy, v, g) {
  const up = -dy, x = Math.abs(dx);
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * x * x + 2 * up * v2);
  if (disc < 0 || x < 1) return null;
  const theta = Math.atan((v2 - Math.sqrt(disc)) / (g * x)); // low arc, measured upward
  return dx >= 0 ? -theta : Math.PI + theta;
}
