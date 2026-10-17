// One match: the map, the soldiers, and everything flying around.
// No DOM or audio in here, so whole matches can run headless in tests.

import { GameMap } from './map.js';
import { Soldier } from './soldier.js';
import { Pickups } from './pickups.js';
import { Effects } from './effects.js';
import { fire, updateProjectiles, damage } from './combat.js';
import { buildPose } from './stickman.js';
import { RULES, TICK_RATE } from './config.js';
import { WEAPONS } from './weapons.js';
import { makeRng } from './util.js';

const IDLE = { move: 0 };

export class Game {
  constructor({ mapData, mode = 'ffa', fragLimit = 20, seed = 1, effects = true, speed = 1 }) {
    this.map = new GameMap(mapData);
    this.mode = mode;
    this.fragLimit = fragLimit;
    this.tickRate = TICK_RATE * speed; // real ticks per second, for countdowns
    this.rng = makeRng(seed);
    this.tick = 0;
    this.soldiers = [];
    this.controllers = new Map();
    this.projectiles = [];
    this.pickups = new Pickups(this.map);
    this.fx = effects ? new Effects() : null;
    this.sounds = [];
    this.feed = [];
    this.notes = [];
    this.shakes = [];
    this.teamScore = { 1: 0, 2: 0 };
    this.over = false;
    this.winner = null;
    this.stats = { kills: 0, suicides: 0, falls: 0 };
  }

  addSoldier(opts, controller) {
    const s = new Soldier({ id: this.soldiers.length, ...opts });
    s.respawnTimer = 1 + this.soldiers.length * 4;
    this.soldiers.push(s);
    this.controllers.set(s, controller);
    return s;
  }

  sound(name, x, y) {
    if (this.sounds.length < 96) this.sounds.push({ name, x, y });
  }

  notify(s, text) {
    if (!s.isBot) this.notes.push({ text, tick: this.tick });
  }

  shake(x, y, amount) {
    this.shakes.push({ x, y, amount });
  }

  onDamage(target, attacker, amount) {
    this.controllers.get(target)?.onHurt?.(this, target, attacker, amount);
  }

  update() {
    if (this.over) { this.fx?.update(this.map); return; }
    this.tick++;
    for (const s of this.soldiers) {
      const ctl = this.controllers.get(s);
      this.updateSoldier(s, ctl ? ctl.input(this, s) : IDLE);
    }
    updateProjectiles(this);
    this.pickups.update(this);
    this.fx?.update(this.map);
    if (this.feed.length > 6) this.feed.splice(0, this.feed.length - 6);
    if (this.notes.length > 10) this.notes.splice(0, this.notes.length - 10);
  }

  updateSoldier(s, input) {
    if (!s.alive) {
      if (--s.respawnTimer <= 0) this.respawn(s);
      return;
    }
    if (s.spawnProtect > 0) s.spawnProtect--;

    const switched = input.switchTo ? s.select(input.switchTo) : input.cycle ? s.cycle(input.cycle) : false;
    if (switched && !s.isBot) this.sound('click', s.x, s.y);

    s.move(input, this.map);
    const b = s.body;
    if (b.bounced) this.sound('bounce', s.x, s.y);
    if (b.landed > 7) this.sound('land', s.x, s.y);
    if (b.jetting) {
      if (this.tick % 30 === 0) this.sound('jet', s.x, s.y);
      if (this.tick % 2 === 0) this.fx?.fire(s.x + s.facing * 3, s.y - 4);
    }

    if (s.cooldown > 0) s.cooldown--;
    if (s.reloadTimer > 0 && --s.reloadTimer === 0) {
      s.weapons.Platinum.mag = WEAPONS.Platinum.mag;
      if (s.current === 'Platinum') this.sound('reload', s.x, s.y);
    }
    if (input.fire) fire(this, s);

    if (s.burnTicks > 0) {
      s.burnTicks--;
      if (this.tick % 2 === 0) this.fx?.fire(s.x + (this.rng() - 0.5) * 8, s.y - 4 - this.rng() * 16);
      damage(this, s, RULES.burnDamage, s.burnBy, 'Flamer', { burn: true });
      if (!s.alive) return;
    }

    this.pickups.touch(this, s);

    const bd = this.map.bounds;
    if (s.y > bd.bottom + RULES.fallDeathMargin || s.x < bd.left - 700 || s.x > bd.right + 700) {
      this.kill(s, null, null, { fall: true });
    }
  }

  /** Spawn point far from enemies (with some randomness). */
  pickSpawn(s) {
    let points = this.map.spawns;
    if (this.mode === 'team') {
      const mine = points.filter(p => p.team === s.team);
      if (mine.length) points = mine;
    }
    let best = points[0], bestScore = -Infinity;
    for (const p of points) {
      let near = 1000;
      for (const o of this.soldiers) {
        if (o === s || !o.alive || (this.mode === 'team' && o.team === s.team)) continue;
        near = Math.min(near, Math.hypot(o.x - p.x, o.y - p.y));
      }
      const score = near + this.rng() * 300;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  respawn(s) {
    const p = this.pickSpawn(s);
    s.spawnAt(p);
    this.fx?.ring(p.x, p.y - 4, s.team === 2 ? '#d33' : '#36c');
    this.sound('spawn', p.x, p.y);
    this.controllers.get(s)?.onSpawn?.(this, s);
  }

  kill(victim, killer, weapon, opts = {}) {
    if (!victim.alive) return;
    // A fall or burn soon after being hurt counts for whoever hurt you.
    if ((!killer || killer === victim) && victim.lastHurtBy && this.tick - victim.lastHurtTick < RULES.creditFallTicks) {
      killer = victim.lastHurtBy;
      weapon = weapon || victim.lastHurtWeapon;
    }
    victim.alive = false;
    victim.deaths++;
    victim.respawnTimer = RULES.respawnTicks;
    victim.burnTicks = 0;

    let text;
    if (killer && killer !== victim) {
      killer.frags++;
      if (this.mode === 'team') this.teamScore[killer.team]++;
      this.stats.kills++;
      const how = opts.fall ? 'knocked' : 'fragged';
      text = opts.fall ? `${killer.name} knocked ${victim.name} off the map` : `${killer.name} fragged ${victim.name}`;
      if (!killer.isBot) this.notify(killer, `You ${how} ${victim.name}${opts.headshot ? ' (headshot!)' : ''}`);
      if (!victim.isBot) this.notify(victim, `You were fragged by ${killer.name}`);
    } else {
      victim.frags--;
      if (this.mode === 'team') this.teamScore[victim.team]--;
      if (opts.fall) { this.stats.falls++; text = `${victim.name} fell off the map`; }
      else { this.stats.suicides++; text = `${victim.name} blew themselves up`; }
    }
    this.feed.push({ text, tick: this.tick, killer, victim, weapon: weapon ? WEAPONS[weapon]?.name : null });

    // Drop the weapon in hand.
    const inv = victim.weapons[victim.current];
    if (victim.current !== 'Platinum' && inv && inv.ammo > 0 && !opts.fall) {
      this.pickups.drop(victim.current, inv.ammo, victim.x, victim.y - 8, victim.body.vx * 0.5);
    }

    if (this.fx && !opts.fall) {
      const pose = buildPose(victim);
      const segs = pose.lines.map(([a, b, c, d]) => [victim.x + a, victim.y + b, victim.x + c, victim.y + d]);
      const head = { x: victim.x + pose.head.x, y: victim.y + pose.head.y, r: pose.head.r };
      this.fx.gibs(segs, head, victim.body.vx, victim.body.vy, opts.explosive ? 6 : 1.5);
      this.fx.blood(victim.x, victim.y - 8, 0, -1, 40);
    }
    this.sound(opts.fall ? 'fall' : opts.explosive ? 'gib' : 'death', victim.x, victim.y);
    this.controllers.get(victim)?.onDeath?.(this, victim, killer);

    this.checkWin();
  }

  checkWin() {
    if (this.mode === 'team') {
      for (const t of [1, 2]) if (this.teamScore[t] >= this.fragLimit) { this.over = true; this.winner = { team: t }; }
    } else {
      const top = this.soldiers.find(s => s.frags >= this.fragLimit);
      if (top) { this.over = true; this.winner = { soldier: top }; }
    }
    if (this.over) this.sound('gameover', 0, 0);
  }

  /** Soldiers sorted by frags (then fewest deaths). */
  standings() {
    return [...this.soldiers].sort((a, b) => b.frags - a.frags || a.deaths - b.deaths);
  }
}
