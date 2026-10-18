// Computer-controlled soldiers.

import { MOTION, PHYS, RULES } from './config.js';
import { WEAPONS } from './weapons.js';
import { jumpSteer, dropSteer } from './nav.js';
import { angleDiff, clamp } from './util.js';

export const DIFFICULTY = {
  easy: { reaction: 34, aimError: 0.17, turn: 0.07, fireCone: 0.24, trigger: 0.55 },
  normal: { reaction: 20, aimError: 0.09, turn: 0.13, fireCone: 0.16, trigger: 0.85 },
  hard: { reaction: 11, aimError: 0.045, turn: 0.22, fireCone: 0.11, trigger: 1 },
};

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

export class BotController {
  constructor(nav, difficulty, profile, rng) {
    this.nav = nav;
    this.d = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.profile = profile;
    this.rng = rng;
    this.aimMult = 0.6 + profile.acc / 25;
    this.reaction = Math.round(this.d.reaction * (1.2 - profile.skill * 0.1));
    this.phase = [rng() * 10, rng() * 10];
    this.prevFire = false;
    this.reset();
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
    this.airTicks = 0;
    this.bounces = 0;
    this.ignore = this.ignore || new Map();
  }

  /**
   * Catch loops: if the bot has stayed in one small area for a few seconds
   * without fighting anyone, give up on what it was doing and go somewhere else.
   */
  watchdog(game, s) {
    if (game.tick % 30 !== s.id % 30) return;
    const h = this.history;
    h.push({ x: s.x });
    if (h.length > 8) h.shift();
    if (h.length < 8) return;
    const xs = h.map(p => p.x);
    const fighting = this.target && game.tick - (this.lastSeen?.tick ?? -1e9) < 60;
    if (Math.max(...xs) - Math.min(...xs) > 50 || fighting || this.goalKind === 'fight') return;
    if (this.goalItem) this.ignore.set(this.goalItem, game.tick + 2400);
    this.goalItem = null;
    this.forceRoam = true;
    this.exec = null;
    this.path = null;
    this.thinkIn = 0;
    this.history = [];
    this.unstuck = (this.unstuck || 0) + 1;
  }

  onSpawn(game, s) {
    this.reset();
    this.aim = s.facing < 0 ? Math.PI : 0;
    this.thinkIn = 5 + Math.floor(this.rng() * 10);
  }

  onHurt(game, s, attacker) {
    if (attacker && attacker !== s && attacker.alive) {
      this.threat = attacker;
      this.lastSeen = { x: attacker.x, y: attacker.y, tick: game.tick };
      if (!this.target) this.thinkIn = Math.min(this.thinkIn, 4);
    }
  }

  input(game, s) {
    const inp = { move: 0, jump: false, jumpPressed: false, aim: this.aim ?? s.aim, fire: false, aimDist: 200 };
    if (!s.alive) return inp;
    if (game.tick % 3 === s.id % 3) this.perceive(game, s);
    if (game.tick % 15 === s.id % 15) this.pickWeapon(game, s, inp);
    this.watchdog(game, s);
    const it = this.goalItem;
    if (it && (!it.active || (it.dropped && it.life <= 0) || !wants(s, it))) {
      // Someone else took it, or we picked up the same thing elsewhere: find something else to do.
      this.goalItem = null;
      this.grabTicks = 0;
      this.thinkIn = Math.min(this.thinkIn, 3);
    }
    if (--this.thinkIn <= 0 && !this.exec && s.body.onGround) this.think(game, s);
    this.steer(game, s, inp);
    this.fight(game, s, inp);
    this.detonate(game, s, inp);
    inp.firePressed = inp.fire && !this.prevFire;
    this.prevFire = inp.fire;
    return inp;
  }

  /** The bot's sheep (or other remote-controlled thing) still out there, if any. */
  remoteOut(game, s) {
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

  canSee(game, s, o) {
    const sx = s.shoulderX, sy = s.shoulderY;
    return game.map.clearLine(sx, sy, o.x, o.y - 8) || game.map.clearLine(sx, sy, o.x, o.y - 17);
  }

  perceive(game, s) {
    let best = null, bestD = Infinity;
    for (const o of this.enemies(game, s)) {
      if (o.spawnProtect > 30) continue;
      const d = Math.hypot(o.x - s.x, o.y - s.y);
      if (d > 1300 || !this.canSee(game, s, o)) continue;
      const score = d * (o === this.target ? 0.6 : 1) * (o === this.threat ? 0.7 : 1);
      if (score < bestD) { bestD = score; best = o; }
    }
    if (best !== this.target) {
      this.seen = 0;
      if (best && !this.target) this.thinkIn = Math.min(this.thinkIn, 6);
    }
    this.target = best;
    if (best) this.lastSeen = { x: best.x, y: best.y, tick: game.tick };
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

  think(game, s) {
    this.thinkIn = 35 + Math.floor(this.rng() * 25);
    const start = this.nav.nodeAt(s.x, s.y, 10);
    if (!start) {
      // Somewhere the route map doesn't cover: head for the closest spot that it does.
      const near = this.nav.nearest(s.x, s.y, 200);
      this.path = [];
      this.offGraph = near;
      this.thinkIn = 20;
      return;
    }
    this.offGraph = null;
    const search = this.nav.costsFrom(start);
    const costTo = (x, y) => {
      const n = this.nav.nearest(x, y, 90);
      return n ? { n, c: search.cost[n.id] } : { n: null, c: Infinity };
    };

    let goal = null, kind = null;
    if (this.forceRoam) {
      // Just got unstuck: go somewhere well away from here first.
      this.forceRoam = false;
      const far = this.nav.nodes.filter(n => search.cost[n.id] < Infinity && Math.hypot(n.x - s.x, n.y - s.y) > 250);
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
    // Items teammates are already going for are worth less: spread out instead of crowding.
    // (In a free-for-all, racing someone to a weapon is fine: they'll fight over it.)
    const claimed = new Set();
    for (const o of game.soldiers) {
      if (o === s || !o.isBot || !o.alive || !game.rules.teams || o.team !== s.team) continue;
      const it = game.controllers.get(o)?.goalItem;
      if (it) claimed.add(it);
    }
    let goalItem = null;
    const best = (filter, value) => {
      let pick = null, pv = -Infinity, item = null;
      for (const it of items) {
        if (!filter(it)) continue;
        const n = this.nav.nearest(it.x, it.y + 12, 90);
        // Only items a soldier standing at that spot could reach (not on a roof above it).
        if (!n || Math.abs(n.x - it.x) > 45 || it.y < n.y - 75 || it.y > n.y + 30) continue;
        const c = search.cost[n.id];
        if (c === Infinity) continue;
        const v = value(it) - c / 60 - (claimed.has(it) ? 4 : 0);
        if (v > pv) { pv = v; pick = n; item = it; }
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
      const isWeapon = it => (it.type === 'weapon' || (it.type === 'crate' && it.landed && !it.health)) && WEAPONS[it.weapon];
      goal = best(
        it => isWeapon(it) && wants(s, it),
        it => (s.weapons[it.weapon] ? 1.5 : weaponValue(it.weapon) + 2) + (topValue < 3 ? 6 : 0) - (this.target ? 3 : 0) + (it.type === 'crate' ? 1.5 : 0),
      );
      kind = 'weapon';
    }
    if (!goal && s.armour < 50) { goal = best(it => it.type === 'armour', () => 3); kind = 'armour'; }

    const def = WEAPONS[s.current];
    const far = def.bot?.far ?? def.range ?? 400;
    const reach = def.kind === 'melee' ? far + 4 : ['rail', 'seeker', 'strike'].includes(def.kind) ? 1400 : Math.min(far * 0.9, 650);
    const inRange = this.target && Math.hypot(this.target.x - s.x, this.target.y - s.y) < reach;
    if (!goal && this.target && !inRange) {
      goal = costTo(this.target.x, this.target.y + 4).n;
      kind = 'chase';
    }
    if (!goal && this.target) {
      // In a fight: hold position (campers) or move around nearby to be harder to hit.
      kind = 'fight';
      if (this.rng() * 40 < this.profile.camp) goal = start;
      else {
        const near = this.nav.nodes.filter(n => Math.abs(n.x - s.x) < 140 && Math.abs(n.y - s.y) < 120 && search.cost[n.id] < 110);
        goal = near.length ? near[Math.floor(this.rng() * near.length)] : start;
      }
    }
    if (!goal && this.lastSeen && game.tick - this.lastSeen.tick < 300) {
      goal = costTo(this.lastSeen.x, this.lastSeen.y).n;
      kind = 'chase';
    }
    if (!goal) {
      // Hunt: head for a random enemy, or wander.
      const foes = this.enemies(game, s);
      if (foes.length && this.rng() < 0.75) {
        const f = foes[Math.floor(this.rng() * foes.length)];
        goal = costTo(f.x, f.y + 4).n;
        kind = 'hunt';
      }
      if (!goal || search.cost[goal.id] === Infinity) {
        goal = this.nav.nodes[Math.floor(this.rng() * this.nav.nodes.length)];
        kind = 'roam';
      }
    }

    // In melee range of the target, get right up close.
    if (kind === 'chase' && def.kind === 'melee' && this.target) goal = costTo(this.target.x, this.target.y + 4).n || goal;
    this.goalKind = kind;
    this.goalItem = ['health', 'weapon', 'armour'].includes(kind) ? goalItem : null;
    this.path = this.nav.pathTo(search, goal) || [];
    this.li = 0;
    this.start = start;
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
      } else if (e.t > 400 / MOTION.timeScale || (!e.airborne && e.t > 30)) {
        this.exec = null;
        this.thinkIn = 0;
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
      inp.move = Math.abs(dx) > 2 ? Math.sign(dx) : 0;
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
        this.thinkIn = Math.max(this.thinkIn, 10);
        return;
      }
      this.grabTicks = 0;
      if (this.thinkIn > 8) this.thinkIn = 8;
      this.watchStuck(game, s, inp);
      return;
    }
    if (link.type === 'walk') {
      const dx = link.to.x - s.x;
      // Keep running if the route carries on the same way; otherwise slow down to stop on the spot.
      const next = this.path[this.li + 1];
      const through = next && next.type === 'walk' && next.dir === link.dir;
      if (Math.abs(dx) < 3 || Math.sign(dx) !== link.dir) { this.li++; inp.move = through ? link.dir : 0; }
      else inp.move = through ? Math.sign(dx) : approach(dx, b.vx);
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
    if (want && (this.bounces > 0 || this.airTicks > 45)) {
      const dx = want.x - s.x;
      inp.move = Math.abs(dx) > 4 ? Math.sign(dx) : 0;
    }
    if (this.bounces >= 3) {
      // Stuck bouncing: give up on whatever is here, step off the pad, and plan again on landing.
      if (it) this.ignore.set(it, game.tick + 2400);
      this.goalItem = null;
      if (!inp.move) {
        const pad = game.map.solids.find(p => p.bounce && s.x >= p.l - 8 && s.x <= p.r + 8 && p.t >= s.y && p.t - s.y < 900);
        if (pad) inp.move = s.x - pad.l < pad.r - s.x ? -1 : 1;
      }
      this.thinkIn = 0;
      this.path = null;
    }
    if (it && it.active && !link && Math.abs(it.x - s.x) < 100) {
      // At the item but can't land next to it: don't keep trying forever.
      this.grabTicks++;
      if (this.grabTicks > 150 / MOTION.timeScale) { this.ignore.set(it, game.tick + 1800); this.goalItem = null; this.grabTicks = 0; }
    }
  }

  /** If the bot hasn't moved for a while, jump somewhere and rethink. */
  watchStuck(game, s, inp) {
    const n = this.nav.nodeAt(s.x, s.y, 14);
    if (n && n === this.lastNode && this.goalKind !== 'fight') this.stuck++;
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

  fight(game, s, inp) {
    const t = this.target;
    const sx = s.shoulderX, sy = s.shoulderY;
    if (!t) {
      // Look where we're going, or where the enemy was last seen.
      let want;
      if (this.lastSeen && game.tick - this.lastSeen.tick < 120) want = Math.atan2(this.lastSeen.y - 10 - sy, this.lastSeen.x - sx);
      else if (Math.abs(s.body.vx) > 0.5) want = s.body.vx < 0 ? Math.PI + 0.05 : -0.05;
      else want = this.aim ?? s.aim;
      this.aim = (this.aim ?? s.aim) + clamp(angleDiff(this.aim ?? s.aim, want), -this.d.turn * 0.6, this.d.turn * 0.6);
      inp.aim = this.aim;
      return;
    }
    this.seen++;
    const def = WEAPONS[s.current];
    const b = def.bot || {};
    let tx = t.x, ty = t.y - (def.kind === 'rail' && this.profile.skill >= 2 ? 15 : 7);
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
        const lead = (dist / def.speed) * (0.5 + this.profile.skill * 0.15);
        tx += t.body.vx * lead;
        ty += t.body.vy * lead * 0.4;
      }
      desired = Math.atan2(ty - sy, tx - sx);
    }
    const time = game.tick * 0.06;
    const shake = Math.abs(s.body.vx) > 1 || !s.body.onGround ? 1.4 : 1;
    const wobble = this.d.aimError * this.aimMult * shake * (Math.sin(time + this.phase[0]) + 0.6 * Math.sin(time * 2.7 + this.phase[1]));
    const want = desired + wobble;
    const cur = this.aim ?? s.aim;
    this.aim = cur + clamp(angleDiff(cur, want), -this.d.turn, this.d.turn);
    inp.aim = this.aim;

    if (this.seen < this.reaction) return;
    if (this.steering(game, s)) return; // the super sheep is steered by our aim
    const off = Math.abs(angleDiff(this.aim, desired));
    const cone = def.kind === 'rail' ? this.d.fireCone * 0.35
      : def.kind === 'flame' || (def.pellets || 0) > 1 ? this.d.fireCone * 1.6
      : def.kind === 'melee' || b.walker || def.kind === 'quake' || def.kind === 'strike' ? 3
      : this.d.fireCone;
    if (off > cone) return;
    const maxRange = def.kind === 'melee' ? (b.far ?? 22) + 8 : (b.far ?? def.range ?? 600) * 1.05;
    if (dist > maxRange) return;
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
