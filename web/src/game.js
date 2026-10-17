// One match: the map, the soldiers, and everything flying around.
// No DOM or audio in here, so whole matches can run headless in tests (and on
// the host of an online game, which sends the results to everyone else).

import { GameMap } from './map.js';
import { Soldier } from './soldier.js';
import { Pickups } from './pickups.js';
import { Effects } from './effects.js';
import { fire, updateProjectiles, damage, explode, soldierBox, canHurt } from './combat.js';
import { buildPose } from './stickman.js';
import { RULES, TICK_RATE, MOTION } from './config.js';
import { setGameSpeed } from './speed.js';
import { WEAPONS } from './weapons.js';
import { modeOf } from './modes.js';
import { makeRng } from './util.js';

const IDLE = { move: 0 };

export class Game {
  /**
   * options: { lives (one in the chamber), gunGameKills (kills per weapon), crates: 'off'|'normal'|'lots' }
   */
  constructor({ mapData, mode = 'ffa', fragLimit = 20, seed = 1, effects = true, speed = 1, options = {} }) {
    // Speed rescales shared constants, so set it before anything reads them.
    setGameSpeed(speed);
    this.map = new GameMap(mapData);
    this.mode = mode;
    this.rules = modeOf(mode);
    this.options = { lives: 3, gunGameKills: 1, crates: 'normal', ...options };
    this.fragLimit = fragLimit;
    this.tickRate = TICK_RATE;
    this.speed = speed;
    this.rng = makeRng(seed);
    this.tick = 0;
    this.nextId = 0;
    this.soldiers = [];
    this.controllers = new Map();
    this.projectiles = [];
    this.pickups = new Pickups(this.map, this);
    this.fx = effects ? new Effects() : null;
    this.sounds = [];
    this.feed = [];
    this.notes = [];
    this.shakes = [];
    this.teamScore = { 1: 0, 2: 0 };
    this.quake = null;
    this.over = false;
    this.winner = null;
    this.stats = { kills: 0, suicides: 0, falls: 0 };
  }

  addSoldier(opts, controller) {
    const s = new Soldier({ id: opts.id ?? this.nextSoldierId(), ...opts });
    s.respawnTimer = 1 + this.soldiers.length * 4;
    this.rules.setup(this, s);
    this.soldiers.push(s);
    this.controllers.set(s, controller);
    return s;
  }

  nextSoldierId() {
    let id = 0;
    while (this.soldiers.some(s => s.id === id)) id++;
    return id;
  }

  removeSoldier(s) {
    this.soldiers = this.soldiers.filter(o => o !== s);
    this.controllers.delete(s);
    for (const p of this.projectiles) if (p.owner === s) p.owner = null;
    for (const o of this.soldiers) { if (o.lastHurtBy === s) o.lastHurtBy = null; if (o.burnBy === s) o.burnBy = null; }
    if (this.quake?.owner === s) this.quake.owner = null;
  }

  /** Queue a sound at (x, y). `to` = a soldier id when only that player should hear it. */
  sound(name, x, y, to = null) {
    if (this.sounds.length < 96) this.sounds.push({ name, x, y, to });
  }

  notify(s, text) {
    if (s && !s.isBot) this.notes.push({ text, tick: this.tick, to: s.id });
  }

  shake(x, y, amount) {
    this.shakes.push({ x, y, amount });
  }

  onDamage(target, attacker, amount) {
    this.controllers.get(target)?.onHurt?.(this, target, attacker, amount);
  }

  update() {
    if (this.over) { this.fx?.update(this.map, MOTION.timeScale); return; }
    this.tick++;
    for (const s of this.soldiers) {
      const ctl = this.controllers.get(s);
      this.updateSoldier(s, ctl ? ctl.input(this, s) : IDLE);
    }
    updateProjectiles(this);
    this.pickups.update(this);
    if (this.quake) this.updateQuake();
    this.fx?.update(this.map, MOTION.timeScale);
    if (this.feed.length > 6) this.feed.splice(0, this.feed.length - 6);
    if (this.notes.length > 20) this.notes.splice(0, this.notes.length - 20);
  }

  updateSoldier(s, input) {
    if (!s.alive) {
      if (this.rules.canRespawn(this, s) && --s.respawnTimer <= 0) this.respawn(s);
      return;
    }
    if (s.spawnProtect > 0) s.spawnProtect--;
    if (input.aimDist != null) s.aimDist = input.aimDist;

    if (s.kamikaze) { this.updateKamikaze(s, input); return; }

    const switched = input.switchTo ? s.select(input.switchTo) : input.cycle ? s.cycle(input.cycle) : false;
    if (switched && !s.isBot) this.sound('click', s.x, s.y, s.id);

    // The minigun is heavy: you walk slowly while it's spinning.
    const def = WEAPONS[s.current];
    if (!input.fire || !def.spinup) s.spin = Math.max(0, s.spin - 1);
    const move = def.heavy && s.spin > 0 ? { ...input, move: (input.move || 0) * def.heavy } : input;

    s.move(move, this.map);
    const b = s.body;
    if (b.bounced) this.sound('bounce', s.x, s.y);
    if (b.landed > MOTION.landSound) this.sound('land', s.x, s.y);
    if (b.jetting) {
      if (this.tick % 30 === 0) this.sound('jet', s.x, s.y);
      if (this.tick % 2 === 0) this.fx?.fire(s.x + s.facing * 3, s.y - 4);
    }

    if (s.cooldown > 0) s.cooldown--;
    // Timers aren't whole numbers at reduced game speed, so count down to <= 0.
    if (s.reloadTimer > 0 && (s.reloadTimer -= 1) <= 0) {
      s.reloadTimer = 0;
      const inv = s.weapons[s.current];
      if (WEAPONS[s.current].mag && inv) inv.mag = WEAPONS[s.current].mag;
      for (const id in s.weapons) if (WEAPONS[id].mag) s.weapons[id].mag = WEAPONS[id].mag;
      if (WEAPONS[s.current].mag) this.sound('reload', s.x, s.y);
    }
    if (input.fire) fire(this, s, input);

    if (s.burnTicks > 0) {
      s.burnTicks--;
      if (this.tick % 2 === 0) this.fx?.fire(s.x + (this.rng() - 0.5) * 8, s.y - 4 - this.rng() * 16);
      damage(this, s, RULES.burnDamage, s.burnBy, 'Flamer', { burn: true });
      if (!s.alive) return;
    }

    this.pickups.touch(this, s);
    this.checkFall(s);
  }

  checkFall(s) {
    const bd = this.map.bounds;
    if (s.alive && (s.y > bd.bottom + RULES.fallDeathMargin || s.x < bd.left - 700 || s.x > bd.right + 700)) {
      this.kill(s, null, null, { fall: true });
    }
  }

  /** Kamikaze: fly in a straight line, then explode (taking yourself with you). */
  updateKamikaze(s, input) {
    const k = s.kamikaze, b = s.body;
    k.ticks--;
    // Steer a little with the mouse.
    if (input.aim != null) {
      const want = Math.atan2(Math.sin(input.aim), Math.cos(input.aim));
      let a = Math.atan2(k.dy, k.dx), d = want - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      a += Math.max(-0.04, Math.min(0.04, d));
      k.dx = Math.cos(a); k.dy = Math.sin(a);
    }
    s.prevX = s.x; s.prevY = s.y;
    const vx = k.dx * k.cfg.speed, vy = k.dy * k.cfg.speed;
    const wall = this.map.raycast(s.x, s.y - 6, s.x + vx, s.y - 6 + vy);
    let victim = null;
    for (const o of this.soldiers) {
      if (o === s || !o.alive || !canHurt(this, s, o)) continue;
      const bx = soldierBox(o);
      if (s.x + vx > bx.l - 4 && s.x + vx < bx.r + 4 && s.y - 6 + vy > bx.t - 4 && s.y - 6 + vy < bx.b + 4) victim = o;
    }
    if (wall || victim || k.ticks <= 0) {
      s.kamikaze = null;
      const x = wall ? wall.x - k.dx * 4 : s.x, y = wall ? wall.y - k.dy * 4 : s.y - 6;
      explode(this, x, y, k.cfg.blast, s, 'Kamikaze', victim);
      if (s.alive) this.kill(s, s, 'Kamikaze', { explosive: true });
      return;
    }
    b.x += vx; b.y += vy; b.vx = vx; b.vy = vy; b.onGround = false;
    if (this.tick % 2 === 0) this.fx?.fire(s.x - vx, s.y - 6 - vy);
    this.checkFall(s);
  }

  /** Earthquake: everyone but whoever started it gets shaken about. */
  updateQuake() {
    const q = this.quake, c = q.cfg;
    if (--q.ticks <= 0) { this.quake = null; return; }
    if (this.tick % 10 === 0) this.shakes.push({ x: null, y: null, amount: 7 });
    if (this.tick % 45 === 0) this.sound('rumble', null, null);
    for (const s of this.soldiers) {
      if (!s.alive || s === q.owner || !s.body.onGround) continue;
      s.body.vx += (this.rng() - 0.5) * 2 * c.kick;
      if (this.rng() < c.hopChance) { s.body.vy = -c.hop; s.body.onGround = false; }
      if (q.owner && canHurt(this, q.owner, s)) { s.lastHurtBy = q.owner; s.lastHurtWeapon = 'Earthquake'; s.lastHurtTick = this.tick; }
    }
    for (const p of this.projectiles) if (p.onGround && this.rng() < 0.05) { p.onGround = false; p.vy = -2 * MOTION.timeScale; }
  }

  /** Spawn point far from enemies (with some randomness). */
  pickSpawn(s) {
    let points = this.map.spawns;
    if (this.rules.teams) {
      const mine = points.filter(p => p.team === s.team);
      if (mine.length) points = mine;
    }
    if (!points.length) return { x: 0, y: 0 };
    let best = points[0], bestScore = -Infinity;
    for (const p of points) {
      let near = 1000;
      for (const o of this.soldiers) {
        if (o === s || !o.alive || (this.rules.teams && o.team === s.team)) continue;
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
    this.rules.spawnLoadout(this, s);
    this.fx?.ring(p.x, p.y - 4, s.team === 2 ? '#d33' : '#36c');
    this.sound('spawn', p.x, p.y);
    this.controllers.get(s)?.onSpawn?.(this, s);
  }

  kill(victim, killer, weapon, opts = {}) {
    if (!victim.alive) return;
    // A fall or burn soon after being hurt counts for whoever hurt you.
    if ((!killer || killer === victim) && weapon !== 'Kamikaze' && victim.lastHurtBy && this.tick - victim.lastHurtTick < RULES.creditFallTicks) {
      killer = victim.lastHurtBy;
      weapon = weapon || victim.lastHurtWeapon;
    }
    victim.alive = false;
    victim.deaths++;
    victim.respawnTimer = RULES.respawnTicks;
    victim.burnTicks = 0;
    victim.kamikaze = null;
    victim.body.rope = null;

    let text;
    const name = weapon ? WEAPONS[weapon]?.name : null;
    if (killer && killer !== victim) {
      killer.frags++;
      if (this.rules.teams) this.teamScore[killer.team]++;
      this.stats.kills++;
      const how = opts.fall ? 'knocked' : 'fragged';
      text = opts.fall ? `${killer.name} knocked ${victim.name} off the map` : `${killer.name} fragged ${victim.name}`;
      if (!killer.isBot) this.notify(killer, `You ${how} ${victim.name}${opts.headshot ? ' (headshot!)' : ''}`);
      if (!victim.isBot) this.notify(victim, `You were fragged by ${killer.name}`);
    } else {
      // Kamikaze is meant to kill you, so it doesn't cost a frag.
      if (weapon !== 'Kamikaze') {
        victim.frags--;
        if (this.rules.teams) this.teamScore[victim.team]--;
      }
      if (opts.fall) { this.stats.falls++; text = `${victim.name} fell off the map`; }
      else if (weapon === 'Kamikaze') text = `${victim.name} went out with a bang`;
      else { this.stats.suicides++; text = `${victim.name} blew themselves up`; }
    }
    this.feed.push({ text, tick: this.tick, killer, victim, weapon: name });
    this.rules.onKill(this, victim, killer, weapon, opts);

    // Drop the weapon in hand.
    const inv = victim.weapons[victim.current];
    if (this.rules.dropWeapons && victim.current !== 'Platinum' && WEAPONS[victim.current] && !WEAPONS[victim.current].hidden &&
        inv && inv.ammo > 0 && inv.ammo !== Infinity && !opts.fall) {
      this.pickups.drop(victim.current, inv.ammo, victim.x, victim.y - 8, victim.body.vx * 0.5);
    }

    if (!opts.fall) {
      const pose = buildPose(victim);
      const segs = pose.lines.map(([a, b, c, d]) => [victim.x + a, victim.y + b, victim.x + c, victim.y + d]);
      const head = { x: victim.x + pose.head.x, y: victim.y + pose.head.y, r: pose.head.r };
      this.fx?.gibs(segs, head, victim.body.vx, victim.body.vy, opts.explosive ? 6 : 1.5);
      this.fx?.blood(victim.x, victim.y - 8, 0, -1, 40);
    }
    this.sound(opts.fall ? 'fall' : opts.explosive ? 'gib' : 'death', victim.x, victim.y);
    this.controllers.get(victim)?.onDeath?.(this, victim, killer);

    this.checkWin();
  }

  checkWin() {
    if (this.over) return;
    const w = this.rules.winner(this);
    if (w) {
      this.over = true;
      this.winner = w;
      this.sound('gameover', null, null);
    }
  }

  /** Soldiers in order: best first. */
  standings() {
    return [...this.soldiers].sort(this.rules.compare);
  }
}
