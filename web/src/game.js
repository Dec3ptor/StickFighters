// One match: the map, the soldiers, and everything flying around.
// No DOM or audio in here, so whole matches can run headless in tests (and on
// the host of an online game, which sends the results to everyone else).

import { GameMap, hypot } from './map.js';
import { Soldier } from './soldier.js';
import { Pickups } from './pickups.js';
import { Effects } from './effects.js';
import { fire, updateProjectiles, damage, explode, canHurt, reload, refill } from './combat.js';
import { buildPose } from './stickman.js';
import { RULES, TICK_RATE, MOTION, PHYS, BODY } from './config.js';
import { setGameSpeed } from './speed.js';
import { WEAPONS } from './weapons.js';
import { modeOf } from './modes.js';
import { makeRng } from './util.js';
import { SoldierGrid, GRID_MIN } from './grid.js';
import { objectivesOf } from './objectives.js';
import { setupClass, applyKit, weaponFor } from './classes.js';
import { useGadget, updateGadgets, removeGadgets, blastGadgets, beaconSpawn, beaconSpawned, beaconOptions, classChanged, botDeploy } from './gadgets.js';
import { onStreakKill, streakOff, useReward, updateStreaks, matchAwards } from './streaks.js';

const IDLE = { move: 0 };
// (The soldiers near a spawn point, for spawnDanger(): one list, filled again each time.)
const NEAR_SPAWN = [];
// Holding self-destruct this many updates (a second) blows you up: the way out of a pit you can't climb out of.
export const SELF_DESTRUCT_TICKS = 60;
// When the map changes (holes, building), the bots' route map is patched this many updates
// after the first change since the last patch (changes meanwhile are done in the same go),
// a few spots each update (about 2 ms' worth), so it never holds the game up.
const NAV_PATCH_DELAY = 20;
const NAV_SPOTS_PER_UPDATE = 6;

export class Game {
  /**
   * options: { lives (one in the chamber), gunGameKills (kills per weapon), crates: 'off'|'normal'|'lots',
   *   botVision: 'classic' (bots see everyone nearby in a clear line) | 'sight' (only what's on their
   *   screen in front of them, plus what they hear), fog: true (players only see what's in their line of sight),
   *   destruction: true (explosions blow holes in the map),
   *   classes: true (everyone spawns with a class's kit and uses gadgets: classes.js),
   *   bulletSpeed: bullets fly this many times as fast (guns' bullets, not rockets, grenades or arrows),
   *   fireDelay: the time between shots, times this (every weapon),
   *   streaks: false turns kill streak rewards off (where the mode has them: streaks.js) }
   */
  constructor({ mapData, mode = 'ffa', fragLimit = 20, seed = 1, effects = true, speed = 1, options = {} }) {
    // Speed rescales shared constants, so set it before anything reads them.
    setGameSpeed(speed);
    this.map = new GameMap(mapData);
    this.mode = mode;
    this.rules = modeOf(mode);
    this.options = { lives: 3, gunGameKills: 1, crates: 'normal', botVision: 'classic', fog: false, destruction: false, classes: false, bulletSpeed: 1, fireDelay: 1, ...options };
    // Every change to the map so far, in order (online players repeat them): holes blown
    // ([x, y, radius]: destructible maps) and blocks built (['+', l, t, r, b, built]: the Engineer's Builder).
    this.carves = [];
    if (this.options.destruction) this.protectFloors();
    // Noises bots can hear (with bot vision 'sight'): { x, y, r (how far it carries), by, tick }.
    this.noises = [];
    this.fragLimit = fragLimit;
    this.tickRate = TICK_RATE;
    this.speed = speed;
    this.rng = makeRng(seed);
    this.tick = 0;
    this.nextId = 0;
    this.soldiers = [];
    this.controllers = new Map();
    this.projectiles = [];
    this.spawnList = []; // (where projectiles made during an update go: combat.js updateProjectiles)
    this.pickups = new Pickups(this.map, this);
    this.fx = effects ? new Effects() : null;
    this.sounds = [];
    this.feed = [];
    this.notes = [];
    this.shakes = [];
    // Big messages ('Double kill', 'Rampage'...): { text, sub, kind, tick, to (a soldier id; null: everyone), about }.
    this.callouts = [];
    this.teamScore = { 1: 0, 2: 0 };
    this.quake = null;
    this.over = false;
    this.winner = null;
    this.stats = { kills: 0, suicides: 0, falls: 0 };
    // Kill streaks (streaks.js): who drew first blood (a soldier id), the last kill
    // ({ tick, killer, victim, weapon, headshot, x, y }: ids), the one that won the match
    // (for its replay, if a kill won it), and the end-of-match awards.
    this.firstBlood = null;
    this.lastKill = null;
    this.finalKill = null;
    this.awards = null;
    // Sentry Sheep out there (kill streak rewards; also in projectiles).
    this.sentries = [];
    this.grid = new SoldierGrid(this.map.bounds);
    // The objective modes' state (flags, capture points...): plain data, sent to online players.
    this.modeState = null;
    // Classes on: spawn beacons (gadgets.js).
    this.beacons = [];
    this.rules.begin?.(this);
  }

  /** True if this match has classes, kits and gadgets (a match option; not in gun game or one in the chamber). */
  get classesOn() { return !!this.options.classes && this.rules.classes !== false; }

  /** True if kill streaks earn rewards in this match (a match option; not in gun game, one in the chamber or Defuse). */
  get streaksOn() { return this.options.streaks !== false && this.rules.streaks !== false; }

  /** True when there are enough soldiers that looking them up by area is worth it. */
  get crowded() { return this.soldiers.length > GRID_MIN; }

  /**
   * Soldiers that might be inside a box (callers check exactly). In small games
   * that's simply every soldier; in big ones, those in the grid cells around it.
   * The grid is rebuilt once per update, so boxes get a margin for movement since.
   */
  near(l, t, r, b) {
    if (!this.crowded) return this.soldiers;
    if (this.grid.tick !== this.tick) this.grid.rebuild(this.soldiers, this.tick);
    const m = 32;
    return this.grid.query(l - m, t - m, r + m, b + m);
  }

  /**
   * near() without making a list, for code that asks thousands of times an update: the
   * same soldiers, in the same order, written into `out` from the start. Returns how many
   * (out[0] to out[n - 1]). Go through them before asking again with the same list.
   */
  nearInto(l, t, r, b, out) {
    if (!this.crowded) {
      const all = this.soldiers;
      for (let i = 0; i < all.length; i++) out[i] = all[i];
      return all.length;
    }
    if (this.grid.tick !== this.tick) this.grid.rebuild(this.soldiers, this.tick);
    const m = 32;
    return this.grid.queryInto(l - m, t - m, r + m, b + m, out);
  }

  /** Big games: the sheep (or other remote-controlled thing) each soldier has out, worked out once per update. */
  remoteOf(s) {
    if (this.remotesTick !== this.tick) {
      this.remotesTick = this.tick;
      this.remotes = new Map();
      for (const p of this.projectiles) if (p.remote && !p.dead && p.owner && !this.remotes.has(p.owner)) this.remotes.set(p.owner, p);
    }
    const p = this.remotes.get(s);
    return p && !p.dead ? p : null;
  }

  /** A soldier appeared somewhere new mid-update (respawned, teleported): keep the grid right. */
  moved(s) {
    if (this.crowded && this.grid.tick === this.tick) this.grid.place(s);
  }

  /** The grid, up to date for this update (big games only). */
  soldierGrid() {
    if (this.grid.tick !== this.tick) this.grid.rebuild(this.soldiers, this.tick);
    return this.grid;
  }

  addSoldier(opts, controller) {
    const s = new Soldier({ id: opts.id ?? this.nextSoldierId(), ...opts });
    // Soldiers arrive a few at a time; with lots of them, in groups (all in within 2 seconds).
    s.respawnTimer = 1 + (this.soldiers.length % 30) * 4;
    this.rules.setup(this, s);
    if (this.classesOn) setupClass(this, s);
    this.soldiers.push(s);
    this.ids?.add(s.id);
    this.controllers.set(s, controller);
    return s;
  }

  /** The lowest id no soldier has. */
  nextSoldierId() {
    // (Kept in a set, so adding thousands of bots doesn't check every soldier each time.)
    if (!this.ids || this.ids.size !== this.soldiers.length) {
      this.ids = new Set(this.soldiers.map(s => s.id));
      this.freeId = 0;
    }
    let id = this.freeId;
    while (this.ids.has(id)) id++;
    this.freeId = id;
    return id;
  }

  removeSoldier(s) {
    this.rules.onRemove?.(this, s);
    if (this.classesOn) removeGadgets(this, s);
    this.soldiers = this.soldiers.filter(o => o !== s);
    if (this.ids) { this.ids.delete(s.id); this.freeId = Math.min(this.freeId, s.id); }
    this.controllers.delete(s);
    for (const p of this.projectiles) { if (p.owner === s) p.owner = null; if (p.target === s) p.target = null; }
    for (const o of this.soldiers) { if (o.lastHurtBy === s) o.lastHurtBy = null; if (o.burnBy === s) o.burnBy = null; }
    if (this.quake?.owner === s) this.quake.owner = null;
  }

  /** A noise bots can hear (bot vision 'sight' only): made by `by` at (x, y), heard up to r px away. */
  noise(x, y, r, by) {
    if (this.options.botVision !== 'sight') return;
    this.noises.push({ x, y, r, by, tick: this.tick, id: (this.noiseCount = (this.noiseCount || 0) + 1) });
  }

  /** Queue a sound at (x, y). `to` = a soldier id when only that player should hear it. */
  sound(name, x, y, to = null) {
    if (this.sounds.length < 96) this.sounds.push({ name, x, y, to });
    this.recorder?.sound(name, x, y, to);
    this.tape?.sound(name, x, y, to);
  }

  /**
   * The bots' route map, once it's built: it tells the game which spots are in a
   * pit nobody can climb out of (no spawning there; players stuck there are told
   * how to get out). When the map can change (destruction, or Engineers building),
   * the game works on its own copy. Returns the route map the bots should use.
   */
  useNav(nav) {
    // (Where the map can change, by holes or building (the Hammer turns up wherever there are
    // pickups or crates), the match works on its own copy of the route map, kept up to date.)
    const changes = this.options.destruction || this.classesOn || this.rules.pickups || this.rules.crates;
    this.nav = changes ? nav.clone(this.map) : nav;
    this.spawnSets = null;
    return this.nav;
  }

  /**
   * Destructible maps: the floors that spawn points, flags, M-COMs, hills,
   * capture points and bomb sites stand on can't be destroyed (so every mode keeps working).
   */
  protectFloors() {
    const map = this.map;
    const floorUnder = (x, y) => {
      const hit = map.raycast(x, y, x, y + 3000);
      if (hit && hit.ny < 0) hit.solid.hard = true;
    };
    for (const p of map.spawns) floorUnder(p.x, p.y);
    for (const type of ['flag', 'mcom']) for (const o of objectivesOf(map, type)) floorUnder(o.x, o.y - 4);
    for (const type of ['hill', 'point', 'site']) {
      for (const z of objectivesOf(map, type)) {
        map.query(z.left, z.bottom - 3, z.right, z.bottom + 3, s => {
          if (Math.abs(s.t - z.bottom) <= 3 && s.r > z.left && s.l < z.right) s.hard = true;
          return false;
        });
      }
    }
  }

  /**
   * Destructible maps: an explosion at (x, y) blows a hole of radius r in whatever
   * isn't hard. Every hole is remembered (online players are sent them), and the
   * bots' route map is patched shortly after.
   */
  carve(x, y, r) {
    // (Built blocks break on any map.)
    if (!this.options.destruction && !this.map.builtCount) return;
    x = Math.round(x); y = Math.round(y); r = Math.round(r);
    if (this.applyCarve(x, y, r)) this.fx?.rubble(x, y, r);
  }

  /** Blow a hole (online players: one the host made). Returns true if anything broke. */
  applyCarve(x, y, r) {
    const area = this.map.carve(x, y, r, !this.options.destruction);
    // (Kept even if nothing broke here, so everyone's list of holes lines up.)
    if (this.online) this.carves.push([x, y, r]);
    if (!area) return false;
    if (!this.online) this.carves.push([x, y, r]);
    // Things lying on what's gone fall; arrows stuck in it go with it.
    for (const p of this.projectiles) {
      if (p.x < area.l - 8 || p.x > area.r + 8 || p.y < area.t - 16 || p.y > area.b + 8) continue;
      if (p.stuck) p.dead = true;
      else if (p.onGround) p.onGround = false;
    }
    for (const it of this.pickups.items) {
      if (it.dropped && it.vy === null && it.x >= area.l - 4 && it.x <= area.r + 4 && it.y >= area.t - 16 && it.y <= area.b) it.vy = 0;
    }
    this.mapChanged(area);
    return true;
  }

  /**
   * The Engineer's Builder: new blocks (`built`: new ones, rather than repairs to
   * the map as it was). Remembered with the holes, so online players get them too.
   */
  addBlocks(boxes, built) {
    let area = null;
    for (const b of boxes) {
      if (!this.applyBuild(b.l, b.t, b.r, b.b, built)) continue;
      area = area ? { l: Math.min(area.l, b.l), t: Math.min(area.t, b.t), r: Math.max(area.r, b.r), b: Math.max(area.b, b.b) } : { ...b };
    }
    if (!area) return;
    this.fx?.built(area.l, area.t, area.r, area.b);
    this.sound(built ? 'build' : 'repair', (area.l + area.r) / 2, (area.t + area.b) / 2);
  }

  /** Add one block (online players: one the host built). Returns true if it went in. */
  applyBuild(l, t, r, b, built) {
    this.carves.push(['+', l, t, r, b, built ? 1 : 0]);
    const area = this.map.add(l, t, r, b, built);
    if (!area) return false;
    this.mapChanged(area);
    return true;
  }

  /** Blocks changed in `area`: the bots' route map is patched shortly (changes meanwhile go in the same go). */
  mapChanged(area) {
    if (!this.nav) return;
    this.navDirty = this.navDirty
      ? { l: Math.min(this.navDirty.l, area.l), t: Math.min(this.navDirty.t, area.t), r: Math.max(this.navDirty.r, area.r), b: Math.max(this.navDirty.b, area.b) }
      : area;
    this.navPatchAt ??= this.tick + NAV_PATCH_DELAY;
  }

  /**
   * Start bringing the bots' route map up to date with the changes to the map (it's
   * finished a bit at a time: navStep()). Spots an unfinished patch hadn't got to go
   * in this one. (Bots carry on along their routes meanwhile, and plan again once it's done.)
   */
  patchNav() {
    this.navJob = this.nav.patchJob(this.navDirty, this.navJob ? this.navJob.left : []);
    this.navDirty = null;
    this.navPatchAt = null;
  }

  /** Some more of the route map's patch: once it's done, the bots plan again with it. */
  navStep(n = NAV_SPOTS_PER_UPDATE) {
    if (this.navJob?.step(n)) { this.navJob = null; this.navUpdated(); }
  }

  /** The route map changed: spawn points are checked again, and bots plan again. */
  navUpdated() {
    this.spawnSets = null;
    for (const [s, ctl] of this.controllers) ctl.navChanged?.(this, s);
  }

  /**
   * The map's spawn points, less any in a pit nobody can climb out of (once the
   * route map is known), unless that's all a team has.
   */
  get spawns() {
    if (!this.nav) return this.map.spawns;
    if (this.spawnsFor !== this.nav || this.spawnsVersion !== this.nav.version) {
      this.spawnsVersion = this.nav.version;
      const trapped = this.nav.trapped();
      const inPit = p => { const n = this.nav.landing(p.x, p.y); return !!n && trapped[n.id] === 1; };
      const all = this.map.spawns;
      this.pitTeams = new Set();
      for (const team of new Set(all.map(p => p.team))) {
        if (all.every(p => p.team !== team || inPit(p))) this.pitTeams.add(team);
      }
      this.okSpawns = all.filter(p => !inPit(p) || this.pitTeams.has(p.team));
      this.spawnsFor = this.nav;
    }
    return this.okSpawns;
  }

  /** True if dying would get s out of a pit: they'd respawn somewhere that isn't one. */
  respawnEscapes(s) {
    if (!this.nav) return false;
    void this.spawns; // (works out pitTeams)
    const teams = this.rules.teams && this.map.spawns.some(p => p.team === s.team) ? [s.team] : [...new Set(this.map.spawns.map(p => p.team))];
    return teams.some(t => !this.pitTeams.has(t));
  }

  /** True if soldier s is standing in a pit they can't climb out of (when the route map is known). */
  trapped(s) {
    if (!this.nav || !s.body.onGround) return false;
    const n = this.nav.nodeAt(s.x, s.y, 14);
    return !!n && this.nav.trapped()[n.id] === 1;
  }

  /**
   * A big message on screen ('Double kill', 'Rampage'): to one player (a soldier, not a
   * bot), or to = null for everyone (smaller: news about soldier `about`, who isn't shown it).
   */
  callout(to, text, sub = '', kind = '', about = null) {
    if (to?.isBot) return;
    const c = { text, sub, kind, tick: this.tick, to: to ? to.id : null, about: about ? about.id : null };
    this.callouts.push(c);
    if (this.callouts.length > 16) this.callouts.splice(0, this.callouts.length - 16);
    this.recorder?.callout?.(c);
  }

  notify(s, text) {
    if (!s || s.isBot) return;
    this.notes.push({ text, tick: this.tick, to: s.id });
    this.recorder?.note(text, s.id);
  }

  shake(x, y, amount) {
    this.shakes.push({ x, y, amount });
    this.recorder?.shake(x, y, amount);
  }

  addFeed(entry) {
    this.feed.push(entry);
    this.recorder?.feed(entry);
  }

  onDamage(target, attacker, amount, weapon) {
    this.controllers.get(target)?.onHurt?.(this, target, attacker, amount, weapon);
  }

  update() {
    if (this.over) { this.fx?.update(this.map, MOTION.timeScale); return; }
    this.tick++;
    for (const s of this.soldiers) {
      const ctl = this.controllers.get(s);
      this.updateSoldier(s, ctl ? ctl.input(this, s) : IDLE);
    }
    updateProjectiles(this);
    if (this.navDirty && this.tick >= this.navPatchAt) this.patchNav();
    else if (this.navJob) this.navStep();
    this.pickups.update(this);
    if (this.classesOn) updateGadgets(this);
    if (this.streaksOn) updateStreaks(this);
    if (!this.over) this.rules.tick?.(this);
    if (this.quake) this.updateQuake();
    this.fx?.update(this.map, MOTION.timeScale);
    if (this.feed.length > 6) this.feed.splice(0, this.feed.length - 6);
    // (Bots listen every few updates: keep the last few updates' noises.)
    if (this.noises.length) this.noises = this.noises.filter(n => this.tick - n.tick < 8);
    if (this.notes.length > 20) this.notes.splice(0, this.notes.length - 20);
    // (Recording the last few seconds, for the replay of the winning kill: replay.js.)
    this.tape?.capture(this);
  }

  updateSoldier(s, input) {
    if (!s.alive) {
      // Spectating: sitting out until they join again.
      if (s.spectating) return;
      // (Choosing a class holds the respawn for a while.)
      if (s.holdSpawn > 0) { s.holdSpawn--; return; }
      if (this.rules.canRespawn(this, s) && --s.respawnTimer <= 0) this.respawn(s);
      return;
    }
    if (s.spawnProtect > 0) s.spawnProtect--;
    if (s.flashTicks > 0) s.flashTicks = Math.max(0, s.flashTicks - 1);
    // (The mode can hold soldiers still: Defuse's freeze time at the start of a round.)
    if (this.rules.input) input = this.rules.input(this, s, input);
    if (input.aimDist != null) s.aimDist = input.aimDist;
    // Holding E (or fire with the bomb in hand): Defuse's planting and defusing.
    s.using = !!input.use || (!!input.fire && s.current === 'C4');

    if (s.kamikaze) { this.updateKamikaze(s, input); return; }

    // (A Juggernaut keeps its minigun in hand.)
    const switched = s.jugger > 0 ? false : input.switchTo ? s.select(input.switchTo) : input.cycle ? s.cycle(input.cycle) : false;
    if (switched && !s.isBot) this.sound('click', s.x, s.y, s.id);

    // The minigun is heavy: you walk slowly while it's spinning.
    const def = WEAPONS[s.current];
    if (!input.fire || !def.spinup) s.spin = Math.max(0, s.spin - 1);
    const move = def.heavy && s.spin > 0 ? { ...input, move: (input.move || 0) * def.heavy } : input;

    // Self-destruct (held for a second): the way out of a pit you can't climb out of.
    if (input.selfDestruct) {
      s.destructHold = (s.destructHold || 0) + 1;
      if (s.destructHold >= SELF_DESTRUCT_TICKS) { this.selfDestruct(s); return; }
    } else s.destructHold = 0;

    s.move(move, this.map);
    const b = s.body;
    if (b.bounced) this.sound('bounce', s.x, s.y);
    if (b.landed > MOTION.landSound) { this.sound('land', s.x, s.y); this.noise(s.x, s.y, 220, s); }
    // Footsteps: running is heard close by (creeping along crouched isn't).
    if (b.onGround && !b.crouching && Math.abs(b.vx) > PHYS.runSpeed * MOTION.timeScale * 0.6 && this.tick % 12 === s.id % 12) this.noise(s.x, s.y, b.sprinting ? 180 : 110, s);
    if (b.jetting && this.tick % 10 === s.id % 10) this.noise(s.x, s.y, 420, s);
    if (b.jetting) {
      if (this.tick % 30 === 0) this.sound('jet', s.x, s.y);
      if (this.tick % 2 === 0) this.fx?.fire(s.x + s.facing * 3, s.y - 4);
    }

    if (s.cooldown > 0) s.cooldown--;
    // Timers aren't whole numbers at reduced game speed, so count down to <= 0.
    // (Magazines refill to the soldier's size: Extended mag makes them bigger. Guns with
    // spare ammo reload from it; pistols with endless ammo reload in your pocket too.)
    if (s.reloadTimer > 0 && (s.reloadTimer -= 1) <= 0) {
      s.reloadTimer = 0;
      const id = s.weapons[s.reloading] ? s.reloading : s.current;
      s.reloading = null;
      const reloaded = refill(s, id);
      for (const w in s.weapons) if (s.weapons[w].ammo === Infinity && weaponFor(s, w).mag) refill(s, w);
      if (reloaded) this.sound('reload', s.x, s.y);
    }
    if (input.reload) reload(s);
    // Dropping the weapon in hand (Defuse: G, to give it to a teammate).
    if (input.drop) this.rules.drop?.(this, s);
    if (input.gadget && this.classesOn) useGadget(this, s);
    // X: a banked kill streak reward (streaks.js).
    if (input.streak && this.streaksOn) useReward(this, s, input.streak);
    if (input.plank != null) s.buildPlank = !!input.plank; // (the Builder: a plank rather than a wall)
    if (input.fire) fire(this, s, input);

    if (s.burnTicks > 0) {
      s.burnTicks--;
      if (this.tick % 2 === 0) this.fx?.fire(s.x + (this.rng() - 0.5) * 8, s.y - 4 - this.rng() * 16);
      damage(this, s, RULES.burnDamage, s.burnBy, 'Flamer', { burn: true });
      if (!s.alive) return;
    }

    this.pickups.touch(this, s);
    this.checkFall(s);
    // Players who end up in a pit with no way out are told how to get out.
    if (!s.isBot && this.tick % 30 === s.id % 30) {
      const stuck = this.trapped(s) && this.respawnEscapes(s);
      if (stuck && !s.toldTrapped) this.notify(s, "There's no way out of here: hold K to self-destruct");
      s.toldTrapped = stuck;
    }
  }

  /** Blow up (no harm to anyone else). Counts as a suicide, or as a kill for whoever hurt you just before. */
  selfDestruct(s) {
    s.destructHold = 0;
    this.fx?.explosion?.(s.x, s.y - 10, 26);
    this.sound('explosionSmall', s.x, s.y);
    this.kill(s, null, null, { explosive: true, selfDestruct: true });
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
      // (Inside the soldier's box, as soldierBox() has it, give or take 4.)
      const ob = o.body, top = ob.crouching ? BODY.crouchTop : BODY.top;
      if (s.x + vx > ob.x - BODY.halfW - 4 && s.x + vx < ob.x + BODY.halfW + 4 && s.y - 6 + vy > ob.y + top - 4 && s.y - 6 + vy < ob.y + BODY.bottom + 4) victim = o;
    }
    if (wall || victim || k.ticks <= 0) {
      s.kamikaze = null;
      const x = wall ? wall.x - k.dx * 4 : s.x, y = wall ? wall.y - k.dy * 4 : s.y - 6;
      explode(this, x, y, k.cfg.blast, s, 'Kamikaze', victim);
      blastGadgets(this, x, y, k.cfg.blast, s);
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
    if (this.tick % 10 === 0) this.shake(null, null, 7);
    if (this.tick % 45 === 0) this.sound('rumble', null, null);
    for (const s of this.soldiers) {
      if (!s.alive || s === q.owner || !s.body.onGround || s.jugger > 0) continue;
      s.body.vx += (this.rng() - 0.5) * 2 * c.kick;
      if (this.rng() < c.hopChance) { s.body.vy = -c.hop; s.body.onGround = false; }
      if (q.owner && canHurt(this, q.owner, s)) { s.lastHurtBy = q.owner; s.lastHurtWeapon = 'Earthquake'; s.lastHurtTick = this.tick; }
    }
    for (const p of this.projectiles) if (p.onGround && this.rng() < 0.05) { p.onGround = false; p.vy = -2 * MOTION.timeScale; }
  }

  /** Spawn point far from enemies (with some randomness). Modes can choose instead (conquest's points, rush's sectors). */
  pickSpawn(s) {
    // Classes on: a spawn beacon the soldier picked ({ x, y, beacon }).
    const beacon = this.classesOn ? beaconSpawn(this, s) : null;
    if (beacon) return beacon;
    const chosen = this.rules.spawnPoint?.(this, s);
    if (chosen) return chosen;
    let points = this.rules.spawnPoints ? this.rules.spawnPoints(this, s) : this.spawns;
    if (this.rules.teams && !this.rules.spawnPoints) {
      const mine = points.filter(p => p.team === s.team);
      if (mine.length) points = mine;
    }
    if (!points.length) return { x: 0, y: 0 };
    const danger = this.crowded ? this.spawnDanger(points, s.team) : null;
    let best = points[0], bestScore = -Infinity;
    for (const [i, p] of points.entries()) {
      let near = 1000;
      if (danger) near = danger[i];
      else {
        for (const o of this.soldiers) {
          if (o === s || !o.alive || (this.rules.teams && o.team === s.team)) continue;
          near = Math.min(near, hypot(o.body.x - p.x, o.body.y - p.y));
        }
      }
      const score = near + this.rng() * 300;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  /**
   * Big games: how far the nearest enemy is from each spawn point, worked out
   * once per update (lots of soldiers respawn each update).
   */
  spawnDanger(points, team) {
    const key = this.rules.teams ? team : 0;
    const c = (this.dangerCache ||= new Map()).get(key);
    // (Refreshed every quarter second: good enough for picking a spawn point.)
    if (c && this.tick - c.tick < 15 && this.tick >= c.tick && c.points === points) return c.near;
    const list = NEAR_SPAWN;
    const near = points.map(p => {
      let n = 1000;
      const count = this.nearInto(p.x - 1000, p.y - 1000, p.x + 1000, p.y + 1000, list);
      for (let i = 0; i < count; i++) {
        const o = list[i];
        if (!o.alive || (this.rules.teams && o.team === team)) continue;
        n = Math.min(n, hypot(o.body.x - p.x, o.body.y - p.y));
      }
      return n;
    });
    this.dangerCache.set(key, { tick: this.tick, points, near });
    return near;
  }

  respawn(s) {
    const p = this.pickSpawn(s);
    s.spawnAt(p);
    this.moved(s);
    if (this.classesOn) {
      // The class's kit instead of the mode's loadout.
      const was = s.cls;
      applyKit(this, s);
      s.spawnedAt = this.tick;
      if (s.cls !== was) classChanged(this, s);
      if (p.beacon) beaconSpawned(this, s, p.beacon);
    } else this.rules.spawnLoadout(this, s);
    this.fx?.ring(p.x, p.y - 4, s.team === 2 ? '#d33' : '#36c');
    this.sound('spawn', p.x, p.y);
    this.controllers.get(s)?.onSpawn?.(this, s);
  }

  kill(victim, killer, weapon, opts = {}) {
    if (!victim.alive) return;
    // A fall or burn soon after being hurt counts for whoever hurt you (not Defuse's bomb going off).
    if ((!killer || killer === victim) && weapon !== 'Kamikaze' && !opts.world && victim.lastHurtBy && this.tick - victim.lastHurtTick < RULES.creditFallTicks) {
      killer = victim.lastHurtBy;
      weapon = weapon || victim.lastHurtWeapon;
    }
    victim.alive = false;
    victim.deaths++;
    // Where they died (conquest respawns them at the nearest place they can).
    victim.deathX = victim.x;
    victim.deathY = victim.y;
    victim.respawnTimer = RULES.respawnTicks;
    victim.burnTicks = 0;
    victim.kamikaze = null;
    victim.body.rope = null;

    let text;
    const name = weapon ? WEAPONS[weapon]?.name ?? weapon : null;
    // (In the objective modes, the objective decides the team score, not kills.)
    const teamFrags = this.rules.teams && this.rules.killScore !== false;
    if (killer && killer !== victim) {
      killer.frags++;
      if (teamFrags) this.teamScore[killer.team]++;
      this.stats.kills++;
      const how = opts.fall ? 'knocked' : 'fragged';
      text = opts.fall ? `${killer.name} knocked ${victim.name} off the map` : `${killer.name} fragged ${victim.name}`;
      if (!killer.isBot) this.notify(killer, `You ${how} ${victim.name}${opts.headshot ? ' (headshot!)' : ''}`);
      if (!victim.isBot) this.notify(victim, `You were fragged by ${killer.name}`);
      this.lastKill = { tick: this.tick, killer: killer.id, victim: victim.id, weapon: weapon || null, headshot: !!opts.headshot, x: victim.x, y: victim.y };
      // The kill confirmed: a sharp flash where they fell, and (for a player) a sound only they hear.
      if (!opts.fall) this.fx?.killFlash?.(victim.x, victim.y - 12);
      if (!killer.isBot) this.sound('killConfirm', victim.x, victim.y, killer.id);
    } else {
      // Kamikaze is meant to kill you, so it doesn't cost a frag (nor does being caught by Defuse's bomb).
      if (weapon !== 'Kamikaze' && !opts.world) {
        victim.frags--;
        if (teamFrags) this.teamScore[victim.team]--;
      }
      if (opts.fall) { this.stats.falls++; text = `${victim.name} fell off the map`; }
      else if (weapon === 'Kamikaze') text = `${victim.name} went out with a bang`;
      else if (opts.world) text = `${victim.name} was caught in the blast`;
      else if (opts.selfDestruct) { this.stats.suicides++; text = `${victim.name} self-destructed`; }
      else { this.stats.suicides++; text = `${victim.name} blew themselves up`; }
    }
    this.addFeed({ text, tick: this.tick, killer, victim, weapon: name });
    // Kill streaks: the victim's ends, the killer's goes on (callouts, rewards: streaks.js).
    onStreakKill(this, victim, killer, weapon, opts);
    this.rules.onKill(this, victim, killer, weapon, opts);
    // Classes on: bots choose where to respawn (their beacon, now and then a teammate's).
    if (this.classesOn && victim.isBot) victim.deployAt = botDeploy(this, victim, this.rng);

    // Drop the weapon in hand (the mode can choose what's dropped: Defuse drops your best gun and the bomb).
    const inv = victim.weapons[victim.current];
    if (this.rules.dropOnDeath) this.rules.dropOnDeath(this, victim, opts);
    else if (this.rules.dropWeapons && victim.current !== 'Platinum' && WEAPONS[victim.current] && !WEAPONS[victim.current].hidden &&
        inv && inv.ammo > 0 && inv.ammo !== Infinity && !opts.fall) {
      this.pickups.drop(victim.current, inv.ammo, victim.x, victim.y - 8, victim.body.vx * 0.5);
    }

    // (The pieces only matter to the effects: no working out the pose when they're off.)
    if (!opts.fall && this.fx) {
      const pose = buildPose(victim);
      const segs = pose.lines.map(l => [victim.x + l[0], victim.y + l[1], victim.x + l[2], victim.y + l[3]]);
      const head = { x: victim.x + pose.head.x, y: victim.y + pose.head.y, r: pose.head.r };
      this.fx.gibs(segs, head, victim.body.vx, victim.body.vy, opts.explosive ? 6 : 1.5);
      this.fx.blood(victim.x, victim.y - 8, 0, -1, 40);
    }
    this.sound(opts.fall ? 'fall' : opts.explosive ? 'gib' : 'death', victim.x, victim.y);
    this.controllers.get(victim)?.onDeath?.(this, victim, killer);

    this.checkWin();
  }

  /**
   * Spectating (from the in-game menu): a player sits out and watches until they
   * join again. Leaving play isn't a death (no frag lost, no life used), unless
   * they'd just been hurt: then it counts for whoever hurt them, as self-destructing
   * does. A flag they were carrying drops. Joining again respawns them as usual.
   * quiet: no message in the kill feed (carrying it into the next match).
   */
  spectate(s, on, { quiet = false } = {}) {
    on = !!on;
    if (!!s.spectating === on) return false;
    if (on && s.alive) {
      if (s.lastHurtBy && s.lastHurtBy !== s && this.tick - s.lastHurtTick < RULES.creditFallTicks) this.kill(s, null, null);
      else {
        this.rules.onRemove?.(this, s);
        streakOff(this, s);
        s.alive = false;
        s.kamikaze = null;
        s.burnTicks = 0;
        s.body.rope = null;
        this.fx?.ring(s.x, s.y - 6, '#999');
      }
    }
    s.spectating = on;
    s.holdSpawn = 0;
    s.respawnTimer = RULES.respawnTicks;
    if (!quiet) this.addFeed({ text: on ? `${s.name} is spectating` : `${s.name} joined the game`, tick: this.tick });
    this.recorder?.rosterChanged?.();
    this.checkWin();
    return true;
  }

  checkWin() {
    if (this.over) return;
    const w = this.rules.winner(this);
    if (w) {
      this.over = true;
      this.winner = w;
      this.sound('gameover', null, null);
      // The kill that won it, if one did (the mode can say: Defuse's last round was won a few
      // seconds before the match ends), for its replay; and the awards.
      const k = this.lastKill;
      this.finalKill = this.rules.finalKill ? this.rules.finalKill(this) : k && k.tick === this.tick ? { ...k } : null;
      this.awards = matchAwards(this);
    }
  }


  /**
   * Where a soldier waiting to respawn can choose to spawn (number keys): conquest's
   * points, and spawn beacons (classes on). Null when there's no choice.
   */
  deployOptions(s) {
    const mode = this.rules.deployOptions?.(this, s) || null;
    const beacons = this.classesOn ? beaconOptions(this, s) : [];
    if (!beacons.length) return mode;
    return [...(mode || [{ key: 'auto', label: 'Base' }]), ...beacons];
  }

  /** Soldiers in order: best first. */
  standings() {
    return [...this.soldiers].sort(this.rules.compare);
  }
}
