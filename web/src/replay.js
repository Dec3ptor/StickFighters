// The replay of the winning kill. The last few seconds of a match are kept as they
// happen (offline and on the host from the game itself; online players from the host's
// snapshots and events), and once a kill wins the match they're played back in slow
// motion, on a copy of the game made for drawing (the real one isn't touched: the host
// is still sending it to everyone).

import { Soldier } from './soldier.js';
import { Effects } from './effects.js';
import { MOTION } from './config.js';

// How much is kept (updates of game time), and up to how many soldiers (beyond that
// it's too much to record every update: no replay in huge battles).
const KEEP = 7 * 60;
const MAX_SOLDIERS = 120;

// The replay: from LEAD updates before the kill to TAIL after it (when there's that
// much), then HOLD more for the pieces to land. Played at these speeds (shares of normal):
// the run-up, the moment of the kill (SLOW_FROM before it to SLOW_TO after), the end.
export const LEAD = 100, TAIL = 40, HOLD = 50;
const SLOW_FROM = 26, SLOW_TO = 14;
const SPEED = { lead: 0.6, slow: 0.22, tail: 0.5 };

// Effects a replay may call (what the game calls on Effects).
const FX = new Set(['blood', 'sparks', 'muzzle', 'shell', 'smoke', 'explosion', 'bang', 'rubble', 'built', 'fire', 'trail', 'ring', 'whack',
  'sparkle', 'spark', 'plane', 'gibs', 'killFlash']);

/** A soldier as drawn: the same fields as a soldier in an online snapshot (protocol.js). */
function soldierState(s) {
  const b = s.body, a = s.anim;
  return {
    id: s.id, alive: s.alive, crouching: b.crouching, onGround: b.onGround, jetting: b.jetting, hasJetpack: b.hasJetpack,
    burning: s.burnTicks > 0, protected: s.spawnProtect > 0, kamikaze: !!s.kamikaze, facing: s.facing, padLaunch: !!b.padLaunch,
    x: b.x, y: b.y, vx: b.vx, vy: b.vy, aim: s.aim, health: s.health, armour: s.armour, current: s.current,
    anim: { run: a.run, flip: a.flip, land: a.land, recoil: a.recoil, swing: a.swing },
    rope: b.rope ? { x: b.rope.x, y: b.rope.y, len: b.rope.len } : null, jugger: s.jugger > 0 ? 1 : 0, streak: s.streak || 0, cls: s.cls,
  };
}

/** A projectile as drawn (as in an online snapshot). */
function projectileState(p) {
  return {
    id: p.id, kind: p.kind, sprite: p.sprite, x: p.x, y: p.y, vx: p.vx || 0, vy: p.vy || 0, angle: p.angle || 0, dir: p.dir ?? 1,
    armed: p.armed > 0 ? 1 : 0, stuck: !!p.stuck, delay: p.delay > 0 ? 1 : 0, onGround: !!p.onGround, praying: !!p.praying,
    age: p.age || 0, life: p.life || 0, r: p.r || 0, team: p.team || 0,
  };
}

/** The last few seconds of a match, kept for its replay. */
export class Tape {
  constructor() {
    this.frames = [];   // { tick, soldiers, projectiles }, oldest first
    this.events = [];   // { tick, s: [{ name, x, y, to }], fx: [[method, ...args]] }
    this.pending = null;
    this.off = false;
  }

  /** Offline and on the host: after every game update. */
  capture(game) {
    if (game.soldiers.length > MAX_SOLDIERS) {
      // (Too many to keep up with: nothing is kept, and there's no replay.)
      this.off = true;
      this.frames.length = 0;
      this.events.length = 0;
      this.pending = null;
      return;
    }
    this.off = false;
    if (this.pending) { this.pending.tick = game.tick; this.events.push(this.pending); this.pending = null; }
    // (Every update in small games; every other one, or every third, in bigger ones.)
    const every = game.soldiers.length <= 24 ? 1 : game.soldiers.length <= 64 ? 2 : 3;
    if (game.tick % every === 0 || game.over) {
      const live = [];
      for (const p of game.projectiles) if (!p.dead) live.push(projectileState(p));
      this.frames.push({ tick: game.tick, soldiers: game.soldiers.map(soldierState), projectiles: live });
    }
    this.trim(game.tick);
  }

  /** Offline and on the host: a sound the game made this update. */
  sound(name, x, y, to) {
    if (this.off) return;
    (this.pending ||= { tick: null, s: [], fx: [] }).s.push({ name, x, y, to });
  }

  /** Offline and on the host: an effect the game showed this update. */
  fx(method, args) {
    if (this.off || !FX.has(method)) return;
    const e = (this.pending ||= { tick: null, s: [], fx: [] });
    if (e.fx.length < 300) e.fx.push([method, ...args]);
  }

  /** Online players: a snapshot from the host (as decoded by protocol.js). */
  addSnapshot(snap) {
    const last = this.frames[this.frames.length - 1];
    if (last && snap.tick <= last.tick) return;
    this.frames.push({ tick: snap.tick, soldiers: snap.soldiers, projectiles: snap.projectiles });
    this.trim(snap.tick);
  }

  /** Online players: a batch of the host's events ({ tick, s: [[name, x, y]], fx }). */
  addEvents(ev) {
    if (!Number.isFinite(ev?.tick)) return;
    this.events.push({ tick: ev.tick, s: (ev.s || []).map(([name, x, y]) => ({ name: String(name), x, y })), fx: Array.isArray(ev.fx) ? ev.fx : [] });
    this.remote = true;
  }

  trim(now) {
    while (this.frames.length && this.frames[0].tick < now - KEEP) this.frames.shift();
    while (this.events.length && this.events[0].tick < now - KEEP) this.events.shift();
  }
}

/**
 * Wrap a game's effects so every one shown is also kept on the tape. (Its own flag, not
 * the host's `recording`: the host wraps these again to send them to players.)
 */
export function tapeFx(fx, tape) {
  if (!fx || fx.taped) return fx;
  return new Proxy(fx, {
    get(target, prop) {
      if (prop === 'taped') return true;
      const v = target[prop];
      if (typeof v !== 'function' || prop === 'update' || prop === 'add' || prop === 'trim') return v;
      return (...args) => { tape.fx(prop, args); return v.apply(target, args); };
    },
  });
}

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Plays the tape back around `kill` ({ tick, killer, victim, x, y, ... }: game.finalKill).
 * `view` is what to draw (the game, with the replay's soldiers, projectiles and effects);
 * call update(ms) each frame. `ok` is false when the tape doesn't cover the kill.
 */
export class ReplayPlayer {
  constructor(game, tape, kill) {
    this.game = game;
    this.kill = kill;
    const frames = tape ? tape.frames.filter(f => f.tick >= kill.tick - LEAD - 6 && f.tick <= kill.tick + TAIL) : [];
    this.frames = frames;
    const first = frames[0], last = frames[frames.length - 1];
    this.ok = frames.length >= 3 && first.tick <= kill.tick - 20 && last.tick >= kill.tick - 4;
    if (!this.ok) return;
    this.t0 = Math.max(first.tick, kill.tick - LEAD);
    this.t1 = last.tick;
    this.end = this.t1 + HOLD;
    this.rt = this.t0;
    this.events = tape.events.filter(e => e.tick > this.t0 && e.tick <= this.t1 + 2);
    this.ei = 0;
    this.remote = !!tape.remote;
    this.fx = new Effects();
    // (The blood on the walls, as it is: it doesn't disappear for the replay.)
    if (game.fx?.stains) this.fx.stains = game.fx.stains.map(st => ({ ...st }));
    // The copy of the game that's drawn: its own soldiers (made from the real ones), projectiles
    // and effects; everything else (the map, pickups, objectives) as the match ended.
    const view = Object.create(game);
    view.soldiers = game.soldiers.map(s => {
      const c = new Soldier({ id: s.id, name: s.name, team: s.team, isBot: s.isBot });
      c.cls = s.cls;
      c.alive = false;
      return c;
    });
    view.byId = new Map(view.soldiers.map(s => [s.id, s]));
    view.projectiles = [];
    view.fx = this.fx;
    view.sounds = [];
    view.shakes = [];
    view.feed = [];
    view.notes = [];
    view.callouts = [];
    view.options = { ...game.options, fog: false };
    view.over = false;
    this.view = view;
    this.apply(this.rt);
  }

  /** Who did it and who it was done to, as soldiers in the replay (either can be missing: they left). */
  get killer() { return this.view.byId.get(this.kill.killer) || null; }
  get victim() { return this.view.byId.get(this.kill.victim) || null; }

  /** How far through it is (0 to 1). */
  get progress() { return this.ok ? Math.min(1, (this.rt - this.t0) / (this.end - this.t0)) : 1; }

  /** True around the moment of the kill (the slowest part). */
  get slow() { const d = this.rt - this.kill.tick; return d > -SLOW_FROM && d < SLOW_TO; }

  /** How fast the replay runs at replay time rt: easing into slow motion for the kill, and out after. */
  speedAt(rt) {
    const d = rt - this.kill.tick;
    if (d < 0) return lerp(SPEED.slow, SPEED.lead, smooth(Math.min(1, Math.max(0, (-d - SLOW_FROM) / 20))));
    return lerp(SPEED.slow, SPEED.tail, smooth(Math.min(1, Math.max(0, (d - SLOW_TO) / 16))));
  }

  /** Move the replay on by `ms` of real time. Returns true once it's finished. */
  update(ms) {
    if (!this.ok) return true;
    const step = 1000 / 60;
    const adv = Math.min(4, (ms / step) * this.speedAt(this.rt));
    this.rt = Math.min(this.end, this.rt + adv);
    // Sounds and effects, as their moment comes.
    while (this.ei < this.events.length && this.events[this.ei].tick <= this.rt + 0.5) this.play(this.events[this.ei++]);
    this.apply(Math.min(this.rt, this.t1));
    if (this.remote) this.trails();
    this.fx.update(this.game.map, MOTION.timeScale * adv);
    this.view.tick = Math.floor(this.rt);
    return this.rt >= this.end;
  }

  /** Skip to the end. */
  finish() { this.rt = this.end; }

  play(e) {
    for (const s of e.s) if (this.view.sounds.length < 64) this.view.sounds.push({ ...s });
    for (const [m, ...args] of e.fx) {
      if (!FX.has(m) || typeof this.fx[m] !== 'function') continue;
      try { this.fx[m](...args); } catch { /* a bad one */ }
    }
  }

  /** Online replays: rocket smoke, sparkles, jetpack flames and fires (online players make these themselves). */
  trails() {
    const t = (this.trailTick = (this.trailTick || 0) + 1);
    if (t % 2) return;
    for (const p of this.view.projectiles) {
      if (p.delay > 0) continue;
      if (p.kind === 'rocket' && p.sprite !== 'bomb') this.fx.smoke(p.x - p.vx, p.y - p.vy, 2.5, 30);
      else if (p.kind === 'seeker') this.fx.sparkle(p.x, p.y);
      else if (p.kind === 'fire' && t % 4 === 0) this.fx.fire(p.x + (Math.random() - 0.5) * 6, p.y - 2);
    }
    for (const s of this.view.soldiers) {
      if (!s.alive) continue;
      if (s.body.jetting) this.fx.fire(s.x + s.facing * 3, s.y - 4);
      if (s.burnTicks > 0 || s.kamikaze) this.fx.fire(s.x + (Math.random() - 0.5) * 8, s.y - 4 - Math.random() * 16);
    }
  }

  /** Put everything where it was at replay time rt, between the two frames either side of it. */
  apply(rt) {
    const frames = this.frames;
    let i = frames.length - 1;
    while (i > 0 && frames[i].tick > rt) i--;
    const a = frames[i], b = frames[i + 1] || a;
    const t = b.tick > a.tick ? Math.min(1, Math.max(0, (rt - a.tick) / (b.tick - a.tick))) : 0;
    const before = new Map(a.soldiers.map(s => [s.id, s]));
    const seen = new Set();
    for (const sb of b.soldiers) {
      const s = this.view.byId.get(sb.id);
      if (!s) continue;
      seen.add(s);
      const sa = before.get(sb.id) || sb;
      const near = sa.alive && sb.alive && Math.hypot(sb.x - sa.x, sb.y - sa.y) < 150;
      const k = near ? t : 1;
      const src = t < 0.5 && near ? sa : sb;
      const body = s.body;
      body.x = lerp(sa.x, sb.x, k); body.y = lerp(sa.y, sb.y, k);
      body.vx = sb.vx; body.vy = sb.vy;
      body.crouching = src.crouching; body.onGround = src.onGround; body.jetting = src.jetting; body.hasJetpack = src.hasJetpack;
      body.padLaunch = src.padLaunch;
      body.rope = src.rope ? { ...src.rope } : null;
      s.prevX = body.x; s.prevY = body.y;
      s.drawDX = s.drawDY = 0;
      // (Alive or dead as of the nearer frame: the victim drops at the kill.)
      s.alive = (t < 0.5 ? sa : sb).alive;
      s.aim = near ? lerpAngle(sa.aim, sb.aim, t) : sb.aim;
      s.facing = src.facing;
      s.health = src.health; s.armour = src.armour;
      s.current = src.current || 'Platinum';
      s.spawnProtect = src.protected ? 1 : 0;
      s.burnTicks = src.burning ? 1 : 0;
      s.kamikaze = src.kamikaze ? { remote: true } : null;
      s.jugger = src.jugger ? 1 : 0;
      s.streak = src.streak || 0;
      s.anim.run = near && Math.abs(sb.anim.run - sa.anim.run) < 0.5 ? lerp(sa.anim.run, sb.anim.run, t) : src.anim.run;
      s.anim.flip = src.anim.flip; s.anim.land = src.anim.land; s.anim.recoil = src.anim.recoil; s.anim.swing = src.anim.swing;
      s.anim.idle = rt;
      s.animPrev = null;
    }
    for (const s of this.view.soldiers) if (!seen.has(s)) s.alive = false;
    // (From the moment of the kill, the victim's down, whatever the last frame caught.)
    if (rt >= this.kill.tick) { const v = this.victim; if (v) v.alive = false; }
    const prev = new Map(a.projectiles.map(p => [p.id, p]));
    this.view.projectiles = b.projectiles.map(pb => {
      const pa = prev.get(pb.id);
      const p = { ...pb };
      if (pa) {
        p.x = lerp(pa.x, pb.x, t); p.y = lerp(pa.y, pb.y, t);
        p.angle = lerpAngle(pa.angle, pb.angle, t);
        p.age = lerp(pa.age, pb.age, t);
      } else {
        // (New in this frame: back along its path, so it doesn't pop in ahead.)
        const back = (1 - t) * (b.tick - a.tick);
        p.x -= pb.vx * back; p.y -= pb.vy * back;
      }
      p.px = p.x; p.py = p.y;
      return p;
    });
  }

  /**
   * Where the camera looks: at the killer for the run-up, gliding over to take in the
   * kill (both of them, when they're close enough to fit on screen) as it happens.
   */
  focus() {
    const k = this.killer, kill = this.kill;
    const kx = k?.alive ? k.x : kill.x, ky = k?.alive ? k.y : kill.y;
    const far = Math.hypot(kx - kill.x, ky - kill.y) > 520;
    const w = smooth(Math.min(1, Math.max(0, (this.rt - (kill.tick - 50)) / 40)));
    const tx = far ? kill.x : (kx + kill.x) / 2, ty = far ? kill.y : (ky + kill.y) / 2;
    return { x: lerp(kx, tx, w), y: lerp(ky, ty, w) };
  }

  /** How far to zoom in (1: as usual): a little closer for the slow-motion moment. */
  zoom() {
    const d = this.rt - this.kill.tick;
    const into = smooth(Math.min(1, Math.max(0, (d + SLOW_FROM + 20) / 24)));
    const out = smooth(Math.min(1, Math.max(0, (d - SLOW_TO) / 30)));
    return 1 + 0.22 * into * (1 - out);
  }
}
