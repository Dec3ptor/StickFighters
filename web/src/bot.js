// Computer-controlled soldiers.

import { MOTION } from './config.js';
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


/** How much a bot wants to use a weapon at distance d. */
function weaponScore(id, d) {
  switch (id) {
    case 'Platinum': return 2;
    case 'Uzi': return d < 450 ? 6 : 3;
    case 'M4': return d < 800 ? 7 : 4;
    case 'Shotgun': return d < 160 ? 10 : d < 280 ? 6 : 1;
    case 'SR': return d > 300 ? 9 : 3;
    case 'GrenadeLauncher': return d > 110 && d < 450 ? 7 : 1;
    case 'Bazooka': return d > 130 && d < 800 ? 9 : 0.5;
    case 'Flamer': return d < 170 ? 11 : 0.5;
  }
  return 0;
}

const WEAPON_VALUE = { Platinum: 0, Uzi: 3, M4: 4, Shotgun: 4, SR: 4, GrenadeLauncher: 4, Bazooka: 6, Flamer: 4 };

export class BotController {
  constructor(nav, difficulty, profile, rng) {
    this.nav = nav;
    this.d = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.profile = profile;
    this.rng = rng;
    this.aimMult = 0.6 + profile.acc / 25;
    this.reaction = Math.round(this.d.reaction * (1.2 - profile.skill * 0.1));
    this.phase = [rng() * 10, rng() * 10];
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
    this.ignore = this.ignore || new Map();
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
    const inp = { move: 0, jump: false, jumpPressed: false, aim: this.aim ?? s.aim, fire: false };
    if (!s.alive) return inp;
    if (game.tick % 3 === s.id % 3) this.perceive(game, s);
    if (game.tick % 15 === s.id % 15) this.pickWeapon(game, s, inp);
    if (--this.thinkIn <= 0 && !this.exec && s.body.onGround) this.think(game, s);
    this.steer(game, s, inp);
    this.fight(game, s, inp);
    return inp;
  }

  enemies(game, s) {
    return game.soldiers.filter(o => o !== s && o.alive && !(game.mode === 'team' && o.team === s.team));
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
    const d = this.target ? Math.hypot(this.target.x - s.x, this.target.y - s.y) : 450;
    let best = s.current, bestScore = s.has(s.current) ? weaponScore(s.current, d) + 0.5 : -1;
    for (const id in s.weapons) {
      if (!s.has(id)) continue;
      const sc = weaponScore(id, d);
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
    const items = game.pickups.items.filter(it => it.active && !((this.ignore.get(it) || 0) > game.tick));
    let goalItem = null;
    const best = (filter, value) => {
      let pick = null, pv = -Infinity, item = null;
      for (const it of items) {
        if (!filter(it)) continue;
        const { n, c } = costTo(it.x, it.y + 12);
        if (!n || c === Infinity) continue;
        const v = value(it) - c / 60;
        if (v > pv) { pv = v; pick = n; item = it; }
      }
      if (pv <= 0) return null;
      goalItem = item;
      return pick;
    };

    if (s.health < 55) {
      goal = best(it => it.type === 'health', () => (70 - s.health) / 6);
      kind = 'health';
    }
    if (!goal) {
      const owned = Object.keys(s.weapons).filter(id => s.has(id));
      const topValue = Math.max(...owned.map(id => WEAPON_VALUE[id] || 0));
      goal = best(
        it => it.type === 'weapon' && (!s.weapons[it.weapon] || s.weapons[it.weapon].ammo < WEAPONS[it.weapon].ammo),
        it => (s.weapons[it.weapon] ? 1.5 : WEAPON_VALUE[it.weapon] + 2) + (topValue < 3 ? 6 : 0) - (this.target ? 3 : 0),
      );
      kind = 'weapon';
    }
    if (!goal && s.armour < 50) { goal = best(it => it.type === 'armour', () => 3); kind = 'armour'; }

    const def = WEAPONS[s.current];
    const reach = def.kind === 'rail' ? 1400 : Math.min(def.range * 0.85, 650);
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
        if (n === link.to) this.li++;
        else this.thinkIn = 0;
      } else if (e.t > 400 / MOTION.timeScale || (!e.airborne && e.t > 30)) {
        this.exec = null;
        this.thinkIn = 0;
      }
      return;
    }
    if (!b.onGround) return;

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
      if (Math.abs(dx) < 3 || Math.sign(dx) !== link.dir) { this.li++; inp.move = link.dir; }
      else inp.move = Math.sign(dx);
      if (Math.abs(s.y - link.to.y) > 14) this.thinkIn = 0;
    } else {
      const from = this.li === 0 ? this.start : this.path[this.li - 1].to;
      const dx = from.x - s.x;
      if (Math.abs(s.y - from.y) > 14) { this.thinkIn = 0; return; }
      if (Math.abs(dx) > 6) inp.move = Math.sign(dx);
      else if (Math.abs(dx) > 1.5) inp.move = Math.abs(b.vx) < 1 ? Math.sign(dx) : 0;
      else if (Math.abs(b.vx) > 0.6) inp.move = 0;
      else {
        this.exec = { link, t: 0, airborne: false, fellAt: -1 };
        this.steer(game, s, inp);
        return;
      }
    }
    this.watchStuck(game, s, inp);
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
    let tx = t.x, ty = t.y - (def.kind === 'rail' && this.profile.skill >= 2 ? 15 : 7);
    const dist = Math.hypot(tx - sx, ty - sy);
    let desired;
    if (def.kind === 'grenade') {
      desired = lobAngle(tx - sx, ty - sy, def.speed, MOTION.grenadeGravity) ?? Math.atan2(ty - sy, tx - sx);
    } else {
      if (def.speed && def.kind !== 'rail') {
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
    const off = Math.abs(angleDiff(this.aim, desired));
    const cone = def.kind === 'rail' ? this.d.fireCone * 0.35 : def.kind === 'pellets' || def.kind === 'flame' ? this.d.fireCone * 1.6 : this.d.fireCone;
    if (off > cone || dist > def.range * 1.05) return;
    if ((def.kind === 'rocket' || def.kind === 'grenade') && dist < 75) return;
    if (def.kind === 'rocket' || def.kind === 'grenade') {
      // Don't blow ourselves up on a wall right in front of us.
      const dx = Math.cos(this.aim), dy = Math.sin(this.aim);
      if (game.map.raycast(sx, sy, sx + dx * 70, sy + dy * 70)) return;
    }
    if (this.rng() < this.d.trigger) inp.fire = true;
  }
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
