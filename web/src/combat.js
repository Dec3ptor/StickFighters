// Firing, projectiles, explosions and damage.
//
// Every projectile has a `kind` (how it moves), a `sprite` (how it's drawn),
// and a `cfg` (its numbers: the weapon definition, or a payload's). Weapon
// kinds are described at the top of weapons.js.

import { BODY, RULES, MOTION } from './config.js';
import { WEAPONS, HEADSHOT_MULTIPLIER } from './weapons.js';
import { segmentT, SEG, hypot } from './map.js';
import { weaponFor } from './classes.js';
import { projectileBeacon, shotBeacon, blastGadgets, meleeBeacon } from './gadgets.js';
import { build } from './building.js';

const HEAD_ZONE = 9; // top pixels of the body box that count as a headshot
const MAX_MINES = 5; // per soldier

// Lists for game.nearInto() to put soldiers in, one for each place that asks (filled again
// each time, rather than a new list every shot and every flame, every update). None of these
// places can be asked again while it's still going through its list.
const NEAR_SHOT = [], NEAR_FOE = [], NEAR_MELEE = [], NEAR_FLASH = [], NEAR_FLAME = [], NEAR_FIRE = [],
  NEAR_GAS = [], NEAR_WALKER = [], NEAR_MINE = [], NEAR_DONKEY = [], NEAR_BLAST = [];

export function soldierBox(s) {
  const top = s.body.crouching ? BODY.crouchTop : BODY.top;
  return { l: s.x - BODY.halfW, t: s.y + top, r: s.x + BODY.halfW, b: s.y + BODY.bottom };
}

export function canHurt(game, attacker, target) {
  if (!target.alive) return false;
  if (!attacker || attacker === target) return true;
  return !(game.rules.teams && attacker.team === target.team);
}

/** Nearest soldier the segment hits (excluding `skip`): { t, nx, ny, soldier, box }, or null. */
export function hitSoldier(game, x0, y0, dx, dy, skip, owner) {
  const len = hypot(dx, dy);
  const crowded = game.crowded;
  // In big games, a long shot is checked a stretch at a time from the gun, stopping
  // one stretch after the first hit (nobody further on can be hit first).
  const pieces = crowded ? Math.max(1, Math.ceil(len / 160)) : 1;
  let best = null, bestT = 0, nx = 0, ny = 0, firstHit = -1;
  for (let i = 0; i < pieces; i++) {
    if (firstHit >= 0 && i > firstHit + 1) break;
    const a = i / pieces, b = (i + 1) / pieces;
    const ax = x0 + dx * a, ay = y0 + dy * a, bx = x0 + dx * b, by = y0 + dy * b;
    const near = NEAR_SHOT, n = game.nearInto(Math.min(ax, bx) - 10, Math.min(ay, by) - 16, Math.max(ax, bx) + 10, Math.max(ay, by) + 26, near);
    for (let j = 0; j < n; j++) {
      const s = near[j];
      if (s === skip || !s.alive || !canHurt(game, owner, s)) continue;
      // (The soldier's box, as soldierBox() has it.)
      const sb = s.body, top = sb.crouching ? BODY.crouchTop : BODY.top;
      const h = segmentT(x0, y0, dx, dy, sb.x - BODY.halfW, sb.y + top, sb.x + BODY.halfW, sb.y + BODY.bottom);
      // (Ties, like a shot starting inside two soldiers, go to the lower id, as in
      // the list of soldiers; the grid finds soldiers in a different order.)
      if (h >= 0 && (!best || h < bestT || (crowded && h === bestT && s.id < best.id))) { best = s; bestT = h; nx = SEG.nx; ny = SEG.ny; }
    }
    if (best && firstHit < 0) firstHit = i;
  }
  return best ? { t: bestT, nx, ny, soldier: best, box: soldierBox(best) } : null;
}

/** Nearest enemy of `owner` near (x, y) that's in plain sight, or null. */
export function nearestEnemy(game, owner, x, y, range, needSight = true) {
  let best = null, bd = range;
  const near = NEAR_FOE, n = game.nearInto(x - range, y - range, x + range, y + range, near);
  for (let i = 0; i < n; i++) {
    const s = near[i];
    if (s === owner || !s.alive || !canHurt(game, owner, s) || s.spawnProtect > 0) continue;
    const b = s.body;
    const d = hypot(b.x - x, b.y - 8 - y);
    if (d >= bd) continue;
    if (needSight && !game.map.clearLine(x, y, b.x, b.y - 8)) continue;
    bd = d; best = s;
  }
  return best;
}

/** Where a soldier is pointing: the shoulder, plus the aim direction times the mouse distance. */
export function aimTarget(s) {
  const d = s.aimDist ?? 200;
  return { x: s.shoulderX + Math.cos(s.aim) * d, y: s.shoulderY + Math.sin(s.aim) * d };
}

/** Add a projectile. Every projectile gets a number, so the network can follow it. */
export function spawn(game, p) {
  p.id = ++game.nextId;
  p.px = p.x; p.py = p.y;
  p.age = 0;
  game.projectiles.push(p);
  return p;
}

// ---- Firing -------------------------------------------------------------------------

/** How fast weapon def's shots fly in this match (bullets go faster with the bullet speed option). */
export function shotSpeed(game, def) {
  return def.kind === 'bullet' ? def.speed * (game.options?.bulletSpeed || 1) : def.speed;
}

/** Updates between shots of weapon def in this match (the time between shots option). */
export function shotDelay(game, def) {
  return def.rof * (game.options?.fireDelay || 1);
}

/**
 * Use the soldier's current weapon if it's ready. `input.firePressed` is true
 * on the tick the button went down (remote detonation and some tools need a click each time).
 * Returns true if something was fired.
 */
export function fire(game, s, input = {}) {
  // (The soldier's weapon upgrade, if any, changes its numbers: classes.js.)
  const id = s.current, def = weaponFor(s, id), inv = s.weapons[id];
  if (!def || !inv) return false;
  const pressed = input.firePressed ?? true;

  // A second click sets off whatever you launched (sheep, super sheep).
  if (def.remote && pressed) {
    const mine = game.projectiles.find(p => p.owner === s && p.weapon === id && p.remote && !p.dead && p.age > 6);
    if (mine) { mine.detonate = true; s.cooldown = Math.max(s.cooldown, 8); return false; }
  }
  // Click again to let go of the rope.
  if (def.kind === 'rope' && s.body.rope) {
    if (pressed) { s.body.rope = null; s.body.momentum = 45; s.cooldown = def.rof; game.sound('rope', s.x, s.y); }
    return false;
  }
  if (def.spinup) {
    s.spin = Math.min(def.spinup, (s.spin || 0) + 2);
    if (s.spin < def.spinup) { if (game.tick % 8 === 0) game.sound('spin', s.x, s.y); return false; }
  }
  if (s.cooldown > 0) return false;
  if (def.semi && !pressed) return false;

  if (def.mag) {
    if (s.reloadTimer > 0) return false;
    if (inv.mag <= 0) {
      // Empty: reload from the spare ammo (endless for the pistol), or swap to something else.
      if (inv.ammo > 0) startReload(s, id, def);
      else s.selectBest();
      return false;
    }
  } else if (inv.ammo <= 0) {
    s.selectBest();
    return false;
  }

  const muzzle = muzzlePoint(game, s, def);
  if (!LAUNCH[def.kind](game, s, def, id, muzzle)) { s.cooldown = Math.max(s.cooldown, 10); return false; }

  if (def.mag) {
    inv.mag--;
    if (inv.mag === 0 && inv.ammo > 0) startReload(s, id, def);
  } else if ((!game.rules.infiniteAmmo || def.tool) && inv.ammo !== Infinity) {
    // (Blocks for the Builder run out even in modes with endless ammo.)
    inv.ammo--;
  }
  s.cooldown = shotDelay(game, def);
  s.spawnProtect = 0;
  s.anim.recoil = def.kind === 'rocket' || def.kind === 'rail' ? 4 : def.kind === 'melee' || def.kind === 'build' ? 0 : 2.5;
  // (Building makes its own sound, where the block goes.)
  if (def.kind !== 'build' && (def.kind !== 'flame' || game.tick % 6 === 0)) game.sound(def.sound, muzzle.x, muzzle.y);
  // How far the shot is heard (by bots that only know what they see and hear).
  game.noise(s.x, s.y, def.kind === 'melee' ? 150 : def.kind === 'arrow' ? 260 : def.kind === 'thrown' || def.kind === 'placed' || def.kind === 'build' ? 320 : def.kind === 'flame' ? 450 : def.kind === 'rail' ? 1200 : 950, s);
  if (GUN_KINDS.has(def.kind)) game.fx?.muzzle(muzzle.x, muzzle.y, s.aim, (def.pellets || 0) > 1 || def.kind === 'rocket');
  if (!def.mag && inv.ammo <= 0 && !s.body.rope) s.selectBest();
  return true;
}

const GUN_KINDS = new Set(['bullet', 'rail', 'rocket', 'seeker']);

/** Start reloading weapon `id` (def: as the soldier has it). */
function startReload(s, id, def) {
  s.reloadTimer = def.reload;
  s.reloading = id;
}

/**
 * Reload the weapon in hand now (R), if its magazine isn't full and there's spare
 * ammo for it. Returns true if a reload started.
 */
export function reload(s) {
  const id = s.current, def = weaponFor(s, id), inv = s.weapons[id];
  if (!def?.mag || !inv || s.reloadTimer > 0 || inv.mag >= def.mag || !(inv.ammo > 0)) return false;
  startReload(s, id, def);
  return true;
}

/** A reload has finished: fill weapon `id`'s magazine from its spare ammo. */
export function refill(s, id) {
  const def = weaponFor(s, id), inv = s.weapons[id];
  if (!def?.mag || !inv) return false;
  const take = Math.max(0, Math.min(def.mag - (inv.mag || 0), inv.ammo));
  inv.mag = (inv.mag || 0) + take;
  if (inv.ammo !== Infinity) inv.ammo -= take;
  return take > 0;
}

function muzzlePoint(game, s, def) {
  const dx = Math.cos(s.aim), dy = Math.sin(s.aim);
  const len = (def.look.length || 10) + 4;
  let x = s.shoulderX + dx * len, y = s.shoulderY + dy * len;
  // Don't let the muzzle poke through a wall.
  const block = game.map.raycast(s.shoulderX, s.shoulderY, x, y);
  if (block) { x = block.x - dx * 1.5; y = block.y - dy * 1.5; }
  return { x, y, dx, dy };
}

// Crouched on the ground, shots spread this much less (a shotgun's pellets less so).
const CROUCH_SPREAD = 0.5, CROUCH_PELLETS = 0.75;

/** A shot's velocity: aimed, give or take the weapon's spread (`crouched`: the share of it left when crouching). */
function aimed(game, s, spread, speed, crouched = CROUCH_SPREAD) {
  if (s.body.crouching && s.body.onGround) spread *= crouched;
  const a = s.aim + (game.rng() - 0.5) * spread;
  return [Math.cos(a) * speed, Math.sin(a) * speed];
}

/** How hard a throw is: further from the mouse is harder (like charging a throw in Worms). */
function throwPower(s, def) {
  if (def.launcher) return 1;
  return Math.max(0.35, Math.min(1, (s.aimDist ?? 260) / 260));
}

const LAUNCH = {
  bullet(game, s, def, id, m) {
    const n = def.pellets || 1;
    for (let i = 0; i < n; i++) {
      const speed = shotSpeed(game, def);
      const [vx, vy] = aimed(game, s, def.spread, speed * (n > 1 ? 0.85 + game.rng() * 0.3 : 1), n > 1 ? CROUCH_PELLETS : CROUCH_SPREAD);
      // (Knock-back as at the usual speed: hits push the same however fast bullets fly.)
      spawn(game, { kind: 'bullet', sprite: def.damage >= 40 ? 'slug' : 'bullet', x: m.x, y: m.y, vx, vy, owner: s, weapon: id, life: def.range / speed, damage: def.damage, knock: def.knock });
    }
    if (n === 1) game.fx?.shell(s.shoulderX + m.dx * 6, s.shoulderY + m.dy * 6, s.facing);
    return true;
  },

  rail(game, s, def, id, m) {
    railShot(game, s, m.x, m.y, m.dx, m.dy, def, id);
    return true;
  },

  arrow(game, s, def, id, m) {
    const [vx, vy] = aimed(game, s, 0, def.speed);
    spawn(game, { kind: 'arrow', sprite: 'arrow', cfg: def, x: m.x, y: m.y, vx: vx + s.body.vx * 0.3, vy, owner: s, weapon: id, life: 600 });
    return true;
  },

  seeker(game, s, def, id, m) {
    spawn(game, { kind: 'seeker', sprite: 'magic', cfg: def, x: m.x, y: m.y, angle: s.aim, vx: m.dx * def.speed, vy: m.dy * def.speed, owner: s, weapon: id, life: def.life });
    return true;
  },

  thrown(game, s, def, id, m) {
    const p = throwPower(s, def);
    const [vx, vy] = aimed(game, s, def.spread || 0, def.speed * p);
    spawn(game, {
      kind: 'thrown', sprite: def.sprite, cfg: def, x: m.x, y: m.y, vx: vx + s.body.vx * 0.4, vy: vy + s.body.vy * 0.3,
      owner: s, weapon: id, life: def.fuse, angle: 0,
    });
    return true;
  },

  rocket(game, s, def, id, m) {
    const [vx, vy] = aimed(game, s, def.spread || 0, def.speed);
    const p = spawn(game, {
      kind: 'rocket', sprite: def.sprite, cfg: def, x: m.x, y: m.y, vx, vy, owner: s, weapon: id,
      life: def.gravity ? 600 : def.range / def.speed + 30,
    });
    if (def.homing) {
      // Lock on to the enemy closest to where you're aiming.
      let best = null, bs = Infinity;
      for (const o of game.soldiers) {
        if (o === s || !o.alive || !canHurt(game, s, o)) continue;
        const ax = o.body.x - s.shoulderX, ay = o.body.y - 8 - s.shoulderY, d = hypot(ax, ay);
        const off = Math.acos(Math.max(-1, Math.min(1, (ax * m.dx + ay * m.dy) / (d || 1))));
        const score = off * 400 + d * 0.3;
        if (off < 1.2 && score < bs) { bs = score; best = o; }
      }
      p.target = best;
    }
    return true;
  },

  flame(game, s, def, id, m) {
    for (let i = 0; i < 2; i++) {
      const [vx, vy] = aimed(game, s, def.spread, def.speed * (0.8 + game.rng() * 0.4), 1); // (flames spray just the same)
      // (hit: the soldiers it has burnt, a Set made when it first burns someone.)
      spawn(game, { kind: 'flame', sprite: 'flame', x: m.x, y: m.y, vx: vx + s.body.vx * 0.5, vy: vy + s.body.vy * 0.3, owner: s, weapon: id, life: def.life * (0.8 + game.rng() * 0.4), hit: null });
    }
    return true;
  },

  walker(game, s, def, id) {
    const n = def.count || 1;
    for (let i = 0; i < n; i++) {
      let x = s.x + s.facing * 8;
      if (game.map.overlap(x - 5, s.y, x + 5, s.y + BODY.bottom - 1)) x = s.x;
      spawn(game, {
        kind: 'walker', sprite: def.sprite, cfg: def, x, y: s.y + BODY.bottom - 0.5, vx: 0, vy: -1.5, dir: s.facing,
        owner: s, weapon: id, life: def.fuse, remote: !!def.remote, delay: i * (def.interval || 0), onGround: false,
      });
    }
    return true;
  },

  flyer(game, s, def, id, m) {
    spawn(game, { kind: 'flyer', sprite: def.sprite, cfg: def, x: m.x, y: m.y, angle: s.aim, vx: m.dx * def.speed, vy: m.dy * def.speed, owner: s, weapon: id, life: def.fuse, remote: true });
    return true;
  },

  placed(game, s, def, id) {
    if (def.mine) {
      const mine = game.projectiles.filter(p => p.owner === s && p.weapon === id);
      if (mine.length >= MAX_MINES) mine[0].dead = true;
    }
    spawn(game, {
      kind: 'placed', sprite: def.sprite, cfg: def, x: s.x + s.facing * 6, y: s.y - 2,
      vx: s.facing * def.throwSpeed + s.body.vx * 0.5, vy: -def.throwSpeed * 0.7, owner: s, weapon: id, life: def.fuse,
      armed: def.mine ? def.mine.arm : 0, triggered: -1, onGround: false,
    });
    return true;
  },

  strike(game, s, def, id) {
    const t = aimTarget(s);
    const top = game.map.bounds.top - 140;
    const n = def.bombs;
    for (let i = 0; i < n; i++) {
      const x = t.x + (i - (n - 1) / 2) * (def.spacing || 0);
      const delay = i * (def.interval || 0);
      if (def.payload === 'donkey') {
        spawn(game, { kind: 'donkey', sprite: 'donkey', cfg: def, x, y: top, vx: 0, vy: def.speed, owner: s, weapon: id, life: 3000, delay, smashes: 0, inside: false });
      } else if (def.payload === 'napalm') {
        spawn(game, { kind: 'thrown', sprite: 'napalm', cfg: { impact: true, gravity: 0.12 * MOTION.timeScale ** 2, fire: def.fire, burst: 'smash' }, x, y: top, vx: 0, vy: def.speed, owner: s, weapon: id, life: 3000, delay, angle: 0 });
      } else {
        spawn(game, { kind: 'rocket', sprite: 'bomb', cfg: { blast: def.blast, gravity: 0.1 * MOTION.timeScale ** 2 }, x, y: top, vx: 0, vy: def.speed, owner: s, weapon: id, life: 3000, delay });
      }
    }
    game.fx?.plane(t.x, game.map.bounds.top - 60, s.facing);
    game.sound(def.sound, t.x, Math.max(t.y, game.map.bounds.top));
    return true;
  },

  quake(game, s, def) {
    game.quake = { ticks: def.duration, owner: s, cfg: def };
    for (const o of game.soldiers) game.notify(o, o === s ? 'You started an earthquake!' : `${s.name} started an earthquake!`);
    return true;
  },

  teleport(game, s, def) {
    let t = aimTarget(s);
    const dx = t.x - s.shoulderX, dy = t.y - s.shoulderY, d = hypot(dx, dy);
    if (d > def.range) t = { x: s.shoulderX + dx / d * def.range, y: s.shoulderY + dy / d * def.range };
    const spot = freeSpot(game, t.x, t.y + 6);
    if (!spot) { game.notify(s, "Can't teleport there"); return false; }
    game.fx?.ring(s.x, s.y - 6, '#7a4fd0');
    s.body.x = spot.x; s.body.y = spot.y;
    s.body.vx = 0; s.body.vy = 0; s.body.rope = null; s.body.onGround = false;
    s.prevX = spot.x; s.prevY = spot.y;
    game.moved(s);
    game.fx?.ring(spot.x, spot.y - 6, '#7a4fd0');
    return true;
  },

  kamikaze(game, s, def) {
    s.kamikaze = { ticks: def.duration, dx: Math.cos(s.aim), dy: Math.sin(s.aim), cfg: def };
    s.body.rope = null;
    return true;
  },

  rope(game, s, def, id, m) {
    const x1 = s.shoulderX + m.dx * def.range, y1 = s.shoulderY + m.dy * def.range;
    const hit = game.map.raycast(s.shoulderX, s.shoulderY, x1, y1);
    if (!hit) { game.fx?.trail(s.shoulderX, s.shoulderY, x1, y1); return false; }
    const len = hypot(hit.x - s.x, hit.y - (s.y - 6));
    s.body.rope = { x: hit.x, y: hit.y, len: Math.max(20, len) };
    s.body.onGround = false;
    return true;
  },

  melee(game, s, def, id) {
    s.anim.swing = 1;
    meleeHit(game, s, def, id);
    return true;
  },

  build(game, s) {
    if (!build(game, s)) return false;
    s.anim.swing = 1;
    return true;
  },

  // The Defuse mode's bomb: holding fire plants it at a bomb site (defuse.js), it isn't fired.
  plant() { return false; },
};

/** A spot near (x, y) where a soldier fits, inside the map, or null. */
export function freeSpot(game, x, y) {
  const b = game.map.bounds;
  const fits = (px, py) => px > b.left && px < b.right && py < b.bottom && py > b.top - 200 &&
    !game.map.overlap(px - BODY.halfW, py + BODY.top, px + BODY.halfW, py + BODY.bottom);
  for (const [ox, oy] of [[0, 0], [0, -12], [0, 12], [-12, 0], [12, 0], [0, -24], [-20, -12], [20, -12], [0, 24], [-24, 0], [24, 0]]) {
    if (fits(x + ox, y + oy)) return { x: x + ox, y: y + oy };
  }
  return null;
}

function meleeHit(game, s, def, id) {
  const dx = Math.cos(s.aim), dy = Math.sin(s.aim);
  const sx = s.shoulderX, sy = s.shoulderY;
  let best = null, bd = Infinity;
  const reach = def.reach + 12, arc = def.arc ?? 0.3;
  const near = NEAR_MELEE, n = game.nearInto(sx - reach, sy - reach, sx + reach, sy + reach, near);
  for (let i = 0; i < n; i++) {
    const o = near[i];
    if (o === s || !o.alive || !canHurt(game, s, o)) continue;
    const cx = o.body.x, cy = o.body.y - 6;
    const rx = cx - sx, ry = cy - sy, d = hypot(rx, ry);
    if (d > def.reach + 12) continue;
    if (d > 8 && (rx * dx + ry * dy) / d < arc) continue; // behind you, or too far round
    if (!game.map.clearLine(sx, sy, cx, cy)) continue;
    if (d < bd) { bd = d; best = o; }
  }
  if (!best) {
    if (!meleeBeacon(game, s, def) && !meleeSentry(game, s, def) && !meleeBlock(game, def, sx, sy, dx, dy)) game.sound('swing', sx, sy);
    return;
  }
  const o = best;
  if (o.spawnProtect > 0) return;
  let kx = dx * def.knock, ky = dy * def.knock - (def.lift || 0);
  if (def.uppercut) {
    kx = dx * def.knock;
    ky = -def.uppercut;
    s.body.vy = -def.selfHop;
    s.body.onGround = false;
    s.body.momentum = 20;
  }
  // (A Juggernaut can't be knocked about.)
  if (!(o.jugger > 0)) {
    o.body.vx += kx;
    o.body.vy += ky;
    if (ky < -0.5) o.body.onGround = false;
    if (Math.abs(kx) > 3 || ky < -2) o.body.momentum = 30;
  }
  o.lastHurtBy = s; o.lastHurtWeapon = id; o.lastHurtTick = game.tick;
  game.sound(def.sound, o.x, o.y);
  game.fx?.whack(o.x, o.y - 10);
  if (def.uppercut) for (let i = 0; i < 6; i++) game.fx?.fire(o.x + (game.rng() - 0.5) * 8, o.y - 10 + (game.rng() - 0.5) * 8);
  let amount = def.halve ? Math.max(def.damage, o.health / 2) : def.damage;
  // A stab in the back (they're facing away from you) does more.
  if (def.backstab && Math.sign(o.x - s.x || s.facing) === o.facing) amount *= def.backstab;
  if (amount > 0) damage(game, o, amount, s, id, { dirX: dx, dirY: dy, knock: 0, melee: true });
}

/**
 * A swing that hit nobody, with a weapon that breaks things (def.chip, the sledgehammer):
 * the block it lands on loses a chunk, radius def.chip, if it's one that breaks (built
 * blocks, and on destructible maps any that aren't hard: game.carve, which online players
 * are sent). A few swings break through. True if it landed on a block.
 */
function meleeBlock(game, def, sx, sy, dx, dy) {
  if (!def.chip) return false;
  const reach = def.reach + 12;
  const hit = game.map.raycast(sx, sy, sx + dx * reach, sy + dy * reach);
  if (!hit) return false;
  const x = hit.x, y = hit.y, nx = hit.nx, ny = hit.ny;
  // (Centred into the block, the hole reaching back to where it landed: each swing digs in
  // further, and one goes right through a built wall's thickness.)
  game.carve(x + dx * def.chip * 0.8, y + dy * def.chip * 0.8, def.chip);
  game.sound('chip', x, y);
  game.fx?.sparks(x, y, nx, ny);
  return true;
}

function railShot(game, s, x0, y0, dx, dy, def, id) {
  const x1 = x0 + dx * def.range, y1 = y0 + dy * def.range;
  const wall = game.map.raycast(x0, y0, x1, y1);
  const wt = wall ? wall.t : 1;
  const hit = hitSoldier(game, x0, y0, x1 - x0, y1 - y0, s, s);
  // (A spawn beacon in the way takes the shot.)
  const gad = shotBeacon(game, s, x0, y0, x1 - x0, y1 - y0, Math.min(wt, hit ? hit.t : 1), def.damage) ||
    shotSentry(game, s, x0, y0, x1 - x0, y1 - y0, Math.min(wt, hit ? hit.t : 1), def.damage);
  if (gad) { game.fx?.trail(x0, y0, gad.x, gad.y); return; }
  if (hit && hit.t < wt) {
    const hx = x0 + (x1 - x0) * hit.t, hy = y0 + (y1 - y0) * hit.t;
    const head = hy < hit.box.t + HEAD_ZONE;
    damage(game, hit.soldier, def.damage * (head ? def.headMultiplier : 1), s, id, { dirX: dx, dirY: dy, knock: def.knock, headshot: head });
    game.fx?.trail(x0, y0, hx, hy);
  } else {
    const ex = wall ? wall.x : x1, ey = wall ? wall.y : y1;
    game.fx?.trail(x0, y0, ex, ey);
    if (wall) game.fx?.sparks(ex, ey, wall.nx, wall.ny);
  }
}

/** Where the sniper laser lands (for drawing): first wall or soldier along the aim. */
export function laserEnd(game, s) {
  const dx = Math.cos(s.aim), dy = Math.sin(s.aim);
  const x0 = s.shoulderX + dx * 26, y0 = s.shoulderY + dy * 26;
  const x1 = x0 + dx * 2200, y1 = y0 + dy * 2200;
  const wall = game.map.raycast(x0, y0, x1, y1);
  let t = wall ? wall.t : 1;
  const hit = hitSoldier(game, x0, y0, x1 - x0, y1 - y0, s, null);
  if (hit && hit.t < t) t = hit.t;
  return { x0, y0, x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t };
}

// ---- Projectiles ----------------------------------------------------------------------

export function updateProjectiles(game) {
  const list = game.projectiles;
  // (The Sentry Sheep out there, for shots and blasts to hit: kept apart, as game.projectiles
  // only holds what's new while they move.)
  if (game.sentries?.length) game.sentries = game.sentries.filter(p => !p.dead);
  // Anything spawned during this update lands in a list of its own (kept to use again), and
  // the ones still going are kept in the same list, moved up over the ones that are gone.
  // (A new one if it's the list itself: an update an error stopped part way through leaves it
  // there, and filling a list from itself would never end.)
  let fresh = game.spawnList;
  if (!fresh || fresh === list) fresh = game.spawnList = [];
  game.projectiles = fresh;
  // (The ones out there already, while game.projectiles holds only what's new: blasts still set
  // off mines and dynamite among them, and holes still drop what's lying on them.)
  game.moving = list;
  let n = 0;
  try {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.dead) continue;
      if (p.delay > 0) { p.delay--; list[n++] = p; continue; } // air strike bombs waiting their turn
      p.life--;
      p.age++;
      p.px = p.x; p.py = p.y;
      if (STEP[p.kind](game, p) && !p.dead) list[n++] = p;
    }
  } finally {
    game.moving = null;
  }
  list.length = n;
  // (What's new goes after them. Something may have swapped the list meanwhile: then its list.)
  const added = game.projectiles;
  for (let i = 0; i < added.length; i++) list.push(added[i]);
  fresh.length = 0;
  game.projectiles = list;
}

/** Set off a projectile's payload: blast, cluster bomblets, fire, gas. */
function detonate(game, p, direct = null) {
  const c = p.cfg;
  p.dead = true;
  if (c.blast) {
    explode(game, p.x, p.y, c.blast, p.owner, p.weapon, direct);
    blastGadgets(game, p.x, p.y, c.blast, p.owner);
  }
  if (c.cluster) {
    const k = c.cluster;
    for (let i = 0; i < k.count; i++) {
      const a = -Math.PI / 2 + (i - (k.count - 1) / 2) * 0.32 + (game.rng() - 0.5) * 0.2;
      const sp = k.speed * (0.7 + game.rng() * 0.5);
      spawn(game, { kind: 'thrown', sprite: k.sprite, cfg: k, x: p.x, y: p.y - 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, owner: p.owner, weapon: p.weapon, life: k.fuse || 999, angle: 0 });
    }
  }
  if (c.fire) {
    for (let i = 0; i < c.fire.count; i++) {
      spawn(game, {
        kind: 'fire', sprite: 'fire', cfg: c.fire, x: p.x, y: p.y - 3,
        vx: (game.rng() - 0.5) * 2 * c.fire.scatter, vy: -game.rng() * c.fire.scatter * 1.2,
        owner: p.owner, weapon: p.weapon, life: c.fire.life * (0.75 + game.rng() * 0.5), onGround: false,
      });
    }
    if (!c.blast) game.fx?.explosion(p.x, p.y, 18);
  }
  if (c.gas) {
    for (let i = 0; i < c.gas.count; i++) {
      spawn(game, {
        kind: 'gas', sprite: 'gas', cfg: c.gas, x: p.x + (game.rng() - 0.5) * 10, y: p.y - 6,
        vx: (game.rng() - 0.5) * 1.6 * MOTION.timeScale, vy: (-0.2 - game.rng() * 0.4) * MOTION.timeScale,
        owner: p.owner, weapon: p.weapon, life: c.gas.life * (0.8 + game.rng() * 0.4), r: 6,
      });
    }
  }
  if (c.flash) flash(game, p.x, p.y - 2, c.flash);
  if (c.smoke) {
    spawn(game, { kind: 'cloud', sprite: 'cloud', cfg: c.smoke, x: p.x, y: p.y - 10, vx: 0, vy: 0, owner: p.owner, weapon: p.weapon, life: c.smoke.life, r: 8 });
  }
  if (c.burst) game.sound(c.burst, p.x, p.y);
}

/**
 * A flashbang going off at (x, y): everyone who can see it (in a clear line, within
 * its radius) is blinded for a while: longer the closer they are, and less if they're
 * facing away. Teammates and the thrower too, as in Counter-Strike.
 */
export function flash(game, x, y, f) {
  game.fx?.bang?.(x, y);
  game.noise(x, y, 900, null);
  const list = NEAR_FLASH, n = game.nearInto(x - f.radius, y - f.radius, x + f.radius, y + f.radius, list);
  for (let i = 0; i < n; i++) {
    const s = list[i];
    if (!s.alive) continue;
    const hx = s.body.x, hy = s.body.y - 17;
    const d = hypot(hx - x, hy - y);
    if (d > f.radius || !game.map.clearLine(x, y, hx, hy)) continue;
    const near = Math.sqrt(1 - d / f.radius);
    const facing = d < 30 || Math.sign(x - s.body.x) === s.facing ? 1 : 0.4;
    const ticks = f.duration * near * facing;
    if (ticks > (s.flashTicks || 0)) { s.flashTicks = ticks; s.flashFull = ticks; }
    if (ticks > 60 && !s.isBot) game.sound('flashRing', null, null, s.id);
  }
}

/** The smoke clouds big enough to hide behind (looked for once an update). */
function cloudsOf(game) {
  if (game.cloudsTick !== game.tick || !game.clouds) {
    game.cloudsTick = game.tick;
    game.clouds = game.projectiles.filter(p => p.kind === 'cloud' && !p.dead && p.r >= 30);
  }
  return game.clouds;
}

/** True if a smoke cloud is between (x0, y0) and (x1, y1) (it blocks sight, not bullets). */
export function smokeBetween(game, x0, y0, x1, y1) {
  for (const p of cloudsOf(game)) {
    if (p.dead) continue;
    const r = p.r * 0.85;
    // Distance from the cloud's middle to the segment.
    const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - x0) * dx + (p.y - y0) * dy) / len2));
    if (hypot(x0 + dx * t - p.x, y0 + dy * t - p.y) < r) return true;
  }
  return false;
}

/** A thrown bomb whose fuse ran out while bouncing off someone: go off now. */
function detonateLater(game, p) {
  detonate(game, p);
  return false;
}

/** Soldier hit by a projectile moving from (x, y) by (vx, vy) this tick, if any (and not hidden behind a wall). */
function sweepHit(game, p, wall) {
  const hit = hitSoldier(game, p.x, p.y, p.vx, p.vy, p.owner, p.owner);
  return hit && (!wall || hit.t <= wall.t) ? hit : null;
}

const STEP = {
  /** A smoke grenade's cloud: billows out to full size, stays a while, then thins out. */
  cloud(game, p) {
    const c = p.cfg;
    p.r = Math.min(c.radius, p.r + c.radius / 40);
    if (p.life < 90) p.r = Math.max(10, p.r - c.radius / 120);
    return p.life > 0;
  },

  bullet(game, p) {
    const wall = game.map.raycast(p.x, p.y, p.x + p.vx, p.y + p.vy);
    const hit = sweepHit(game, p, wall);
    if (projectileBeacon(game, p, hit, wall, p.damage) || projectileSentry(game, p, hit, wall, p.damage)) return false;
    if (hit) {
      const hy = p.y + p.vy * hit.t;
      const head = hy < hit.box.t + HEAD_ZONE;
      const sp = hypot(p.vx, p.vy);
      damage(game, hit.soldier, p.damage * (head ? HEADSHOT_MULTIPLIER : 1), p.owner, p.weapon, { dirX: p.vx / sp, dirY: p.vy / sp, knock: p.knock, headshot: head });
      p.x += p.vx * hit.t; p.y = hy;
      return false;
    }
    if (wall) {
      p.x = wall.x; p.y = wall.y;
      game.fx?.sparks(wall.x, wall.y, wall.nx, wall.ny);
      if (game.rng() < 0.15) game.sound('ricochet', wall.x, wall.y);
      return false;
    }
    p.x += p.vx; p.y += p.vy;
    return p.life > 0;
  },

  arrow(game, p) {
    if (p.stuck) return p.life > 0;
    p.vy += p.cfg.gravity;
    const wall = game.map.raycast(p.x, p.y, p.x + p.vx, p.y + p.vy);
    const hit = sweepHit(game, p, wall);
    if (projectileBeacon(game, p, hit, wall, p.cfg.damage) || projectileSentry(game, p, hit, wall, p.cfg.damage)) return false;
    if (hit) {
      const hy = p.y + p.vy * hit.t;
      const head = hy < hit.box.t + HEAD_ZONE;
      const sp = hypot(p.vx, p.vy);
      damage(game, hit.soldier, p.cfg.damage * (head ? p.cfg.headMultiplier : 1), p.owner, p.weapon, { dirX: p.vx / sp, dirY: p.vy / sp, knock: p.cfg.knock, headshot: head });
      return false;
    }
    if (wall) {
      // Stick in the wall for a while.
      p.angle = Math.atan2(p.vy, p.vx);
      p.x = wall.x; p.y = wall.y;
      p.vx = 0; p.vy = 0;
      p.stuck = true;
      p.life = 300 / MOTION.timeScale;
      game.sound('thunk', p.x, p.y);
      return true;
    }
    p.x += p.vx; p.y += p.vy;
    p.angle = Math.atan2(p.vy, p.vx);
    return p.life > 0 && p.y < game.map.bounds.bottom + 400;
  },

  seeker(game, p) {
    const c = p.cfg;
    if (p.age % 8 === 1 || (p.target && !p.target.alive)) p.target = nearestEnemy(game, p.owner, p.x, p.y, 1100);
    if (p.target && p.age > 6) {
      const want = Math.atan2(p.target.y - 9 - p.y, p.target.x - p.x);
      let d = want - p.angle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      p.angle += Math.max(-c.turn, Math.min(c.turn, d));
    }
    p.vx = Math.cos(p.angle) * c.speed; p.vy = Math.sin(p.angle) * c.speed;
    const wall = game.map.raycast(p.x, p.y, p.x + p.vx, p.y + p.vy);
    const hit = sweepHit(game, p, wall);
    if (projectileBeacon(game, p, hit, wall, c.damage) || projectileSentry(game, p, hit, wall, c.damage)) { game.fx?.ring(p.x, p.y, '#8a5fe0'); return false; }
    if (hit) {
      damage(game, hit.soldier, c.damage, p.owner, p.weapon, { dirX: Math.cos(p.angle), dirY: Math.sin(p.angle), knock: c.knock });
      game.fx?.ring(p.x, p.y, '#8a5fe0');
      return false;
    }
    if (wall) { game.fx?.sparks(wall.x, wall.y, wall.nx, wall.ny); game.fx?.ring(wall.x, wall.y, '#8a5fe0'); return false; }
    p.x += p.vx; p.y += p.vy;
    if (game.tick % 2 === 0) game.fx?.sparkle(p.x, p.y);
    return p.life > 0;
  },

  thrown(game, p) {
    const c = p.cfg;
    p.vy += c.gravity ?? MOTION.grenadeGravity;
    const wall = game.map.raycast(p.x, p.y, p.x + p.vx, p.y + p.vy);
    const hit = sweepHit(game, p, wall);
    if (hit && hit.soldier !== p.owner) {
      if (c.contact || c.impact) {
        p.x += p.vx * hit.t; p.y += p.vy * hit.t;
        detonate(game, p, hit.soldier);
        return false;
      }
      // Bombs bounce off people (and drop at their feet).
      if (!(p.age - (p.bumped ?? -99) < 6)) {
        p.x += p.vx * hit.t * 0.8; p.y += p.vy * hit.t * 0.8;
        p.vx = -p.vx * 0.08; p.vy *= 0.3;
        p.bumped = p.age;
        game.sound('tink', p.x, p.y);
        return p.life > 0 || detonateLater(game, p);
      }
    }
    if (wall) {
      if (c.impact) {
        p.x = wall.x + wall.nx * 2; p.y = wall.y + wall.ny * 2;
        detonate(game, p);
        return false;
      }
      p.x = wall.x + wall.nx * 0.6; p.y = wall.y + wall.ny * 0.6;
      const bounce = c.bounce ?? 0.45;
      if (wall.nx) { p.vx = -p.vx * bounce; p.vy *= 0.8; }
      else { p.vy = -p.vy * bounce; p.vx *= c.friction ?? 0.75; }
      if (Math.abs(p.vx) + Math.abs(p.vy) > 2 * MOTION.timeScale) game.sound(p.sprite === 'banana' ? 'boing' : 'tink', p.x, p.y);
    } else {
      p.x += p.vx; p.y += p.vy;
      // Rolling along the ground slows it down.
      if (Math.abs(p.vy) < 1.2 && game.map.overlap(p.x - 1, p.y + 0.5, p.x + 1, p.y + 3)) p.vx *= c.roll ?? 0.92;
    }
    p.angle += p.vx * 0.2;
    if (p.y > game.map.bounds.bottom + RULES.fallDeathMargin + 200) return false;
    if (p.life <= 0) {
      if (c.holy && !p.praying) {
        // The Holy Hand Grenade sings before it goes off.
        p.praying = true;
        p.life = c.holy;
        game.sound('hallelujah', p.x, p.y);
        return true;
      }
      detonate(game, p);
      return false;
    }
    return true;
  },

  rocket(game, p) {
    const c = p.cfg;
    if (c.homing && p.age > c.homing.delay) {
      if (!p.target || !p.target.alive) p.target = nearestEnemy(game, p.owner, p.x, p.y, 900, false);
      if (p.target) {
        const want = Math.atan2(p.target.y - 8 - p.y, p.target.x - p.x);
        let a = Math.atan2(p.vy, p.vx), d = want - a;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        a += Math.max(-c.homing.turn, Math.min(c.homing.turn, d));
        const sp = hypot(p.vx, p.vy);
        p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
      }
    }
    if (c.gravity) p.vy += c.gravity;
    const wall = game.map.raycast(p.x, p.y, p.x + p.vx, p.y + p.vy);
    const hit = sweepHit(game, p, wall);
    // (A Sentry Sheep in the way takes the hit.)
    const sentry = findSentry(game, p.owner, p.x, p.y, p.vx, p.vy, Math.min(hit ? hit.t : 1, wall ? wall.t : 1));
    if (hit || wall || sentry) {
      const t = sentry ? sentry.t : hit ? hit.t : wall.t;
      const back = 2 / (hypot(p.vx, p.vy) || 1);
      p.x += p.vx * Math.max(0, t - back); p.y += p.vy * Math.max(0, t - back);
      detonate(game, p, hit && !sentry ? hit.soldier : null);
      return false;
    }
    p.x += p.vx; p.y += p.vy;
    if (game.tick % 2 === 0 && p.sprite !== 'bomb') game.fx?.smoke(p.x - p.vx, p.y - p.vy, 2.5, 30);
    if (p.y > game.map.bounds.bottom + RULES.fallDeathMargin + 200) return false;
    if (p.life <= 0) { detonate(game, p); return false; }
    return true;
  },

  flame(game, p) {
    p.vx *= MOTION.flameDrag; p.vy = p.vy * MOTION.flameDrag - MOTION.flameLift;
    const nx = p.x + p.vx, ny = p.y + p.vy;
    const wall = game.map.raycast(p.x, p.y, nx, ny);
    if (wall) {
      // Flames lick along walls instead of vanishing at once.
      p.x = wall.x + wall.nx; p.y = wall.y + wall.ny;
      if (wall.nx) p.vx = 0; else p.vy = Math.min(p.vy, 0) * 0.3;
      p.life -= 4 * MOTION.timeScale;
    } else { p.x = nx; p.y = ny; }
    const r = 3 + p.age * MOTION.flameGrow;
    const near = NEAR_FLAME, n = game.nearInto(p.x - r, p.y - r, p.x + r, p.y + r, near);
    for (let i = 0; i < n; i++) {
      const s = near[i];
      if (s === p.owner || (p.hit && p.hit.has(s)) || !canHurt(game, p.owner, s)) continue;
      // (Touching the soldier's box, as soldierBox() has it.)
      const b = s.body, top = b.crouching ? BODY.crouchTop : BODY.top;
      if (p.x + r > b.x - BODY.halfW && p.x - r < b.x + BODY.halfW && p.y + r > b.y + top && p.y - r < b.y + BODY.bottom) {
        (p.hit || (p.hit = new Set())).add(s);
        damage(game, s, WEAPONS.Flamer.damage, p.owner, p.weapon, { dirX: p.vx * 0.1, dirY: 0, knock: 0.05 });
        ignite(s, p.owner);
      }
    }
    return p.life > 0;
  },

  /** A patch of burning petrol: falls, then sits and burns. */
  fire(game, p) {
    if (!p.onGround) {
      p.vy += MOTION.itemGravity;
      const wall = game.map.raycast(p.x, p.y, p.x + p.vx, p.y + p.vy + 1);
      if (wall) {
        p.x = wall.x + wall.nx; p.y = wall.y + wall.ny;
        if (wall.ny < 0) { p.onGround = true; p.vx = 0; p.vy = 0; } else { p.vx *= -0.3; p.vy = Math.max(0, p.vy) * 0.3; }
      } else { p.x += p.vx; p.y += p.vy; }
      if (p.y > game.map.bounds.bottom + RULES.fallDeathMargin) return false;
    }
    if (game.tick % 4 === p.id % 4) game.fx?.fire(p.x + (game.rng() - 0.5) * 6, p.y - 2);
    if (game.tick % 6 === p.id % 6) {
      const near = NEAR_FIRE, n = game.nearInto(p.x - 8, p.y - 12, p.x + 8, p.y + 2, near);
      for (let i = 0; i < n; i++) {
        const s = near[i];
        if (!canHurt(game, p.owner, s) || s.spawnProtect > 0) continue;
        const b = s.body, top = b.crouching ? BODY.crouchTop : BODY.top;
        if (p.x + 8 > b.x - BODY.halfW && p.x - 8 < b.x + BODY.halfW && p.y + 2 > b.y + top && p.y - 12 < b.y + BODY.bottom) {
          damage(game, s, 1.2, p.owner, p.weapon, { burn: true });
          ignite(s, p.owner);
        }
      }
    }
    return p.life > 0;
  },

  /** Skunk gas: a drifting cloud that poisons whoever stands in it. */
  gas(game, p) {
    const c = p.cfg;
    p.vx *= 0.985; p.vy *= 0.985;
    const wall = game.map.raycast(p.x, p.y, p.x + p.vx, p.y + p.vy);
    if (wall) { if (wall.nx) p.vx = -p.vx * 0.5; else p.vy = -p.vy * 0.5; } else { p.x += p.vx; p.y += p.vy; }
    p.r = Math.min(c.radius, p.r + 0.3 * MOTION.timeScale);
    const fade = Math.min(1, p.life / 60);
    const gr = p.r * fade + 6;
    const near = NEAR_GAS, n = game.nearInto(p.x - gr, p.y - gr, p.x + gr, p.y + gr, near);
    for (let i = 0; i < n; i++) {
      const s = near[i];
      if (!s.alive || s.spawnProtect > 0 || s.gassed === game.tick || !canHurt(game, p.owner, s)) continue;
      if (hypot(s.body.x - p.x, s.body.y - 8 - p.y) < p.r * fade + 6) {
        s.gassed = game.tick; // overlapping clouds don't stack
        damage(game, s, c.dpt, p.owner, p.weapon, { burn: true, poison: true });
      }
    }
    return p.life > 0;
  },

  /** Sheep, old women and mad cows: walk along the ground, hop small walls, turn at big ones. */
  walker(game, p) {
    const c = p.cfg, map = game.map;
    if (p.detonate) { detonate(game, p); return false; }
    // (A stampede whose owner left: it goes with them, rather than hunting everyone, their side too.)
    if (c.seek && !p.owner) { game.fx?.smoke(p.x, p.y - 6, 4, 24); return false; }
    const W = 5, H = 12;
    const blocked = (x, y) => map.overlap(x - W, y - H, x + W, y - 0.01);
    p.vy = Math.min(p.vy + MOTION.itemGravity * 1.5, MOTION.itemMaxFall);
    p.vx = p.dir * (p.speed ?? c.walkSpeed);
    // Horizontal
    const nx = p.x + p.vx;
    if (!blocked(nx, p.y)) p.x = nx;
    else if (p.onGround) {
      let stepped = false;
      for (let up = 1; up <= 8 && !stepped; up++) if (!blocked(nx, p.y - up)) { p.x = nx; p.y -= up; stepped = true; }
      if (!stepped) {
        if (c.hop && !p.hopped) { p.vy = -c.hop; p.onGround = false; p.hopped = true; p.hopX = p.x; }
        else { p.dir = -p.dir; p.hopped = false; p.turnedAt = p.age; }
      }
    }
    // Vertical
    const ny = p.y + p.vy;
    if (!blocked(p.x, ny)) { p.y = ny; p.onGround = false; }
    else if (p.vy > 0) {
      let y = p.y;
      while (!blocked(p.x, y + 0.5) && y < ny) y += 0.5;
      p.y = y;
      const pad = map.overlap(p.x - 1, p.y, p.x + 1, p.y + 1);
      if (pad && pad.bounce) { p.vy = pad.bounce * 1.6 * MOTION.timeScale; p.onGround = false; }
      else {
        p.vy = 0;
        p.onGround = true;
        // A hop that got nowhere means the wall is too tall: turn round next time.
        if (p.hopped && Math.abs(p.x - p.hopX) > 4) p.hopped = false;
      }
    } else { p.vy = 0; }
    // A stampede's sheep (kill streak reward) head for the enemy they were sent after, or the
    // nearest one once that one's dead (not straight back into a wall they've just turned at).
    if (c.seek && p.onGround && !p.hopped && game.tick % 10 === p.id % 10 && p.age - (p.turnedAt ?? -1e9) > 45 / MOTION.timeScale) {
      if (!p.target || !p.target.alive || !canHurt(game, p.owner, p.target)) p.target = nearestEnemy(game, p.owner, p.x, p.y - 10, 1600, false);
      if (p.target && Math.abs(p.target.x - p.x) > 16) p.dir = Math.sign(p.target.x - p.x);
    }
    if (game.tick % 90 === p.id % 90) game.sound(p.weapon === 'MadCow' ? 'moo' : p.weapon === 'OldWoman' ? 'mumble' : 'baa', p.x, p.y);
    if (c.contact) {
      const near = NEAR_WALKER, n = game.nearInto(p.x - 11, p.y - 14, p.x + 11, p.y + 22, near);
      for (let i = 0; i < n; i++) {
        const s = near[i];
        if (s === p.owner || !s.alive || !canHurt(game, p.owner, s)) continue;
        const b = s.body;
        if (Math.abs(b.x - p.x) < 11 && b.y - 22 < p.y && b.y + 14 > p.y - 12) { detonate(game, p, s); return false; }
      }
    }
    if (p.y > map.bounds.bottom + RULES.fallDeathMargin) return false;
    if (p.life <= 0) { detonate(game, p); return false; }
    return true;
  },

  /** Super sheep: flies toward wherever its owner is aiming. */
  flyer(game, p) {
    const c = p.cfg;
    if (p.detonate) { detonate(game, p); return false; }
    const o = p.owner;
    if (o && o.alive) {
      const t = aimTarget(o);
      const want = Math.atan2(t.y - p.y, t.x - p.x);
      let d = want - p.angle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (hypot(t.x - p.x, t.y - p.y) > 12) p.angle += Math.max(-c.turn, Math.min(c.turn, d));
    }
    p.vx = Math.cos(p.angle) * c.speed; p.vy = Math.sin(p.angle) * c.speed;
    const wall = game.map.raycast(p.x, p.y, p.x + p.vx, p.y + p.vy);
    const hit = sweepHit(game, p, wall);
    if (hit) { detonate(game, p, hit.soldier); return false; }
    if (wall) { p.x = wall.x + wall.nx * 2; p.y = wall.y + wall.ny * 2; detonate(game, p); return false; }
    p.x += p.vx; p.y += p.vy;
    if (game.tick % 75 === p.id % 75) game.sound('baa', p.x, p.y);
    if (p.life <= 0) { detonate(game, p); return false; }
    return true;
  },

  /** Dynamite and mines: tossed at your feet, then wait. */
  placed(game, p) {
    const c = p.cfg;
    if (!p.onGround) {
      p.vy = Math.min(p.vy + MOTION.itemGravity, MOTION.itemMaxFall);
      const wall = game.map.raycast(p.x, p.y, p.x + p.vx, p.y + p.vy + 2);
      if (wall) {
        p.x = wall.x + wall.nx; p.y = wall.y + wall.ny - 1;
        if (wall.ny < 0) {
          const pad = game.map.overlap(p.x - 1, p.y + 1, p.x + 1, p.y + 4);
          if (pad && pad.bounce) { p.vy = pad.bounce * 1.4 * MOTION.timeScale; }
          else { p.onGround = true; p.vx = 0; p.vy = 0; }
        } else { p.vx = -p.vx * 0.3; }
      } else { p.x += p.vx; p.y += p.vy; }
      if (p.y > game.map.bounds.bottom + RULES.fallDeathMargin) return false;
    }
    if (c.mine) {
      if (p.armed > 0) p.armed--;
      else if (p.triggered < 0) {
        const tr = c.mine.trigger;
        const near = NEAR_MINE, n = game.nearInto(p.x - tr, p.y - tr, p.x + tr, p.y + tr, near);
        for (let i = 0; i < n; i++) {
          const s = near[i];
          if (s === p.owner || !s.alive || !canHurt(game, p.owner, s)) continue;
          if (hypot(s.body.x - p.x, s.body.y - p.y) < c.mine.trigger) { p.triggered = c.mine.delay; game.sound('beep', p.x, p.y); break; }
        }
      } else if (--p.triggered <= 0) { detonate(game, p); return false; }
      return p.life > 0;
    }
    if (game.tick % 3 === 0) game.fx?.spark(p.x + 2, p.y - 6);
    if (p.life <= 0) { detonate(game, p); return false; }
    return true;
  },

  /**
   * A Sentry Sheep (a kill streak reward, streaks.js): drops to the floor, unfolds its gun
   * (p.armed: updates until it's ready), then turns to the nearest enemy in sight and in
   * range and shoots. It's gone when its time's up (p.life) or it's wrecked (p.hp).
   */
  sentry(game, p) {
    const c = p.cfg;
    // (Its owner left the game: it goes with them, rather than shooting at everyone.)
    if (p.dead || !p.owner) { p.dead = true; return false; }
    if (!p.onGround) {
      p.vy = Math.min(p.vy + MOTION.itemGravity, MOTION.itemMaxFall);
      const wall = game.map.raycast(p.x, p.y - 1, p.x + p.vx, p.y - 1 + p.vy + 1);
      if (wall && wall.ny < 0) { p.x = wall.x; p.y = wall.y - 0.01; p.onGround = true; p.vx = 0; p.vy = 0; }
      else if (wall) { p.x = wall.x + wall.nx; p.y = wall.y + 1 + Math.max(0, wall.ny); p.vx = -p.vx * 0.3; p.vy = Math.max(0, p.vy); }
      else { p.x += p.vx; p.y += p.vy; }
      if (p.y > game.map.bounds.bottom + RULES.fallDeathMargin) { p.dead = true; return false; }
    } else if (game.tick % 10 === p.id % 10 && !game.map.overlap(p.x - 4, p.y + 0.5, p.x + 4, p.y + 3)) {
      p.onGround = false; // (the floor under it was blown away)
    }
    if (p.life <= 0) {
      p.dead = true;
      game.fx?.explosion(p.x, p.y - 8, 10);
      game.sound('explosionSmall', p.x, p.y);
      if (p.owner) game.notify(p.owner, 'Your Sentry Sheep is out of time');
      return false;
    }
    if (p.armed > 0) { p.armed--; return true; }
    const gx = p.x, gy = p.y - SENTRY_GUN;
    if (game.tick % 6 === p.id % 6 || (p.target && !p.target.alive)) p.target = nearestEnemy(game, p.owner, gx, gy, c.range);
    if (p.cool > 0) p.cool--;
    const t = p.target;
    if (!t) return true;
    let d = Math.atan2(t.y - 12 - gy, t.x - gx) - p.angle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    p.angle += Math.max(-c.turn, Math.min(c.turn, d));
    p.dir = Math.cos(p.angle) < 0 ? -1 : 1;
    if (p.cool > 0 || Math.abs(d) > 0.25) return true;
    const dx = Math.cos(p.angle), dy = Math.sin(p.angle);
    let mx = gx + dx * 11, my = gy + dy * 11;
    const block = game.map.raycast(gx, gy, mx, my);
    if (block) { mx = block.x - dx * 1.5; my = block.y - dy * 1.5; }
    const a = p.angle + (game.rng() - 0.5) * c.spread;
    const sp = c.speed * (game.options?.bulletSpeed || 1);
    spawn(game, { kind: 'bullet', sprite: 'bullet', x: mx, y: my, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, owner: p.owner, weapon: p.weapon, life: c.range / sp, damage: c.damage, knock: c.knock });
    p.cool = shotDelay(game, c);
    p.shots = (p.shots || 0) + 1;
    game.sound(c.sound, mx, my);
    game.noise(p.x, p.y, 700, p.owner);
    game.fx?.muzzle(mx, my, p.angle, false);
    return true;
  },

  /** The Concrete Donkey: falls straight through everything, smashing whatever it lands on. */
  donkey(game, p) {
    const c = p.cfg;
    p.y += p.vy;
    const inside = !!game.map.overlap(p.x - 10, p.y - 4, p.x + 10, p.y + 4);
    if (inside && !p.inside) {
      p.smashes++;
      explode(game, p.x, p.y, c.blast, p.owner, p.weapon);
      blastGadgets(game, p.x, p.y, c.blast, p.owner);
    }
    p.inside = inside;
    const near = NEAR_DONKEY, n = game.nearInto(p.x - 16, p.y - 12, p.x + 16, p.y + 24, near);
    for (let i = 0; i < n; i++) {
      const s = near[i];
      if (!s.alive || !canHurt(game, p.owner, s) || s === p.owner) continue;
      if (Math.abs(s.body.x - p.x) < 16 && Math.abs(s.body.y - 6 - p.y) < 18 && !p.squashed?.has(s)) {
        (p.squashed ||= new Set()).add(s);
        explode(game, p.x, p.y, c.blast, p.owner, p.weapon, s);
        blastGadgets(game, p.x, p.y, c.blast, p.owner);
      }
    }
    return p.smashes < c.smashes && p.y < game.map.bounds.bottom + RULES.fallDeathMargin + 100;
  },
};

// ---- Sentry Sheep (a kill streak reward, streaks.js) --------------------------------------

// Its hit box (from where it stands), and how high its gun is.
const SENTRY_W = 8, SENTRY_H = 17, SENTRY_GUN = 13;

/** True if `by` (a soldier, or null for the world) can damage Sentry Sheep p: anyone but its owner's side. */
function canHitSentry(game, by, p) {
  if (p.dead || !(p.hp > 0)) return false;
  if (!by) return true;
  if (by === p.owner) return false;
  return !(game.rules.teams && by.team === p.team);
}

/** Hurt a Sentry Sheep; with no armour left it's wrecked (its owner, and whoever did it, are told). */
export function damageSentry(game, p, amount, by) {
  if (!(amount > 0) || !canHitSentry(game, by, p)) return;
  p.hp -= amount;
  // (Its health, as a percentage, goes to online players in `r`.)
  p.r = Math.max(0, Math.ceil((p.hp / p.cfg.hp) * 100));
  game.fx?.sparks(p.x, p.y - 10, 0, -1);
  if (p.hp > 0) { game.sound('tink', p.x, p.y); return; }
  p.dead = true;
  if (p.mark) p.mark.alive = false; // (bots shooting at it look for someone else)
  game.fx?.explosion(p.x, p.y - 8, 16);
  game.sound('explosionSmall', p.x, p.y);
  if (p.owner) game.notify(p.owner, 'Your Sentry Sheep was destroyed');
  if (by && by !== p.owner) game.notify(by, 'You destroyed a Sentry Sheep');
}

/** The first Sentry Sheep `owner` can hit along a path from (x, y) by (dx, dy), before maxT: { t, p }, or null. */
function findSentry(game, owner, x, y, dx, dy, maxT = 1) {
  if (!game.sentries?.length) return null;
  let best = null;
  const l = Math.min(x, x + dx), r = Math.max(x, x + dx), t = Math.min(y, y + dy), b = Math.max(y, y + dy);
  for (const p of game.sentries) {
    if (p.x + SENTRY_W < l || p.x - SENTRY_W > r || p.y < t || p.y - SENTRY_H > b || !canHitSentry(game, owner, p)) continue;
    const h = segmentT(x, y, dx, dy, p.x - SENTRY_W, p.y - SENTRY_H, p.x + SENTRY_W, p.y);
    if (h >= 0 && h < maxT && (!best || h < best.t)) best = { t: h, p };
  }
  return best;
}

/** A shot along that path: if it hits a Sentry Sheep first, that takes `amount`, and this says where (so the shot stops there). */
export function shotSentry(game, owner, x, y, dx, dy, maxT, amount) {
  const hit = findSentry(game, owner, x, y, dx, dy, maxT);
  if (!hit) return null;
  damageSentry(game, hit.p, amount, owner);
  return { x: x + dx * hit.t, y: y + dy * hit.t };
}

/** A projectile's move this update hit a Sentry Sheep before the soldier or wall it would hit: true if so. */
function projectileSentry(game, p, hit, wall, amount) {
  if (!game.sentries?.length) return false;
  const at = shotSentry(game, p.owner, p.x, p.y, p.vx, p.vy, Math.min(hit ? hit.t : 1, wall ? wall.t : 1), amount);
  if (!at) return false;
  p.x = at.x; p.y = at.y;
  return true;
}

/** An explosion: Sentry Sheep in reach take its damage (half as much again: they're tough, but blasts are what breaks them). */
function blastSentries(game, x, y, blast, owner) {
  if (!game.sentries?.length || !blast) return;
  const reach = blast.radius + 10;
  for (const p of game.sentries) {
    if (Math.abs(p.x - x) > reach || Math.abs(p.y - 8 - y) > reach || !canHitSentry(game, owner, p)) continue;
    const d = hypot(p.x - x, p.y - 8 - y);
    if (d > reach) continue;
    if (!game.map.clearLine(x, y, p.x, p.y - 8) && !game.map.clearLine(x, y, p.x, p.y - 15)) continue;
    damageSentry(game, p, blast.damage * 1.5 * Math.max(0.15, 1 - d / reach), owner);
  }
}

/** A melee swing that hit nobody: an enemy Sentry Sheep right in front gets it. True if one did. */
function meleeSentry(game, s, def) {
  if (!game.sentries?.length || !(def.damage > 0)) return false;
  const dx = Math.cos(s.aim), dy = Math.sin(s.aim);
  for (const p of game.sentries) {
    const rx = p.x - s.shoulderX, ry = p.y - 8 - s.shoulderY, d = hypot(rx, ry);
    if (d > def.reach + 12 || (d > 8 && (rx * dx + ry * dy) / d < 0.3) || !canHitSentry(game, s, p)) continue;
    game.sound(def.sound, p.x, p.y);
    game.fx?.whack(p.x, p.y - 8);
    damageSentry(game, p, def.damage, s);
    return true;
  }
  return false;
}

function ignite(s, by) {
  if (s.alive && s.spawnProtect <= 0) { s.burnTicks = RULES.burnTicks; s.burnBy = by; }
}

// Blasts going off right now (one inside another: see explode()).
let blasting = 0;

/** Blast damage with falloff, blocked by walls; also throws soldiers around and sets off nearby mines. */
export function explode(game, x, y, blast, owner, weapon, direct = null) {
  game.fx?.explosion(x, y, blast.radius * 0.5);
  game.sound(blast.radius > 85 ? 'explosion' : 'explosionSmall', x, y);
  game.noise(x, y, 1100, owner);
  game.shake(x, y, Math.min(16, 5 + blast.radius / 20));
  const reach = blast.radius + 8;
  // Everyone near, then the one hit directly if they aren't among them. (Its own list, unless
  // a blast is set off while another's still going: then a new one.)
  const near = blasting ? [] : NEAR_BLAST, n = game.nearInto(x - reach, y - reach, x + reach, y + reach, near);
  blasting++;
  let extra = direct;
  for (let i = 0; i < n && extra; i++) if (near[i] === direct) extra = null;
  for (let i = 0, end = extra ? n + 1 : n; i < end; i++) {
    const s = i < n ? near[i] : extra;
    if (!s.alive) continue;
    const cx = s.body.x, cy = s.body.y - 5;
    const d = hypot(cx - x, cy - y);
    if (d > reach && s !== direct) continue;
    if (s !== direct && !game.map.clearLine(x, y, cx, cy) && !game.map.clearLine(x, y, cx, s.body.y - 18)) continue;
    const f = s === direct ? 1 : Math.max(0.15, 1 - d / reach);
    const self = s === owner;
    let dirX = (cx - x) / (d || 1), dirY = (cy - y) / (d || 1) - 0.6;
    const dl = hypot(dirX, dirY) || 1;
    dirX /= dl; dirY /= dl;
    // Knockback applies even to teammates and yourself (rocket jumps!), not to a Juggernaut.
    const k = blast.knock * f * (self ? 0.85 : 1);
    if (!(s.jugger > 0)) {
      s.body.vx += dirX * k;
      s.body.vy += dirY * k;
      if (s.body.vy < -1) s.body.onGround = false;
      if (k > 8) s.body.momentum = 20;
    }
    if (canHurt(game, owner, s)) {
      // (Blasts were made for 100 health: they take the same share of the mode's.)
      damage(game, s, blast.damage * f * (self ? 0.5 : 1) * game.maxHealth / 100, owner, weapon, { dirX, dirY, knock: 0, explosive: true });
    }
  }
  blasting--;
  blastSentries(game, x, y, blast, owner);
  // Explosions set off mines and dynamite nearby (while projectiles move, among the ones out
  // there already too: see updateProjectiles).
  setOff(game.projectiles, x, y, blast.radius * 0.8);
  if (game.moving) setOff(game.moving, x, y, blast.radius * 0.8);
  // Destructible maps: a hole (after the damage, so the wall still shielded anyone behind it).
  game.carve?.(x, y, blast.radius * CARVE_SHARE);
}

/** Mines and dynamite in `list` within r of (x, y): set off (a mine at once, dynamite's fuse cut short). */
function setOff(list, x, y, r) {
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.kind !== 'placed' || p.dead) continue;
    if (hypot(p.x - x, p.y - y) > r) continue;
    if (p.cfg.mine) { p.armed = 0; if (p.triggered < 0 || p.triggered > 4) p.triggered = 4; }
    else p.life = Math.min(p.life, 4);
  }
}

// How big a hole an explosion blows in the map (destructible maps), as a share of its blast radius.
const CARVE_SHARE = 0.4;

/** Apply damage. Armour soaks up part of it; burns and poison go straight to health. */
export function damage(game, target, amount, attacker, weapon, opts = {}) {
  if (!target.alive || target.spawnProtect > 0 || game.over) return;
  if (!canHurt(game, attacker, target)) return;
  let dmg = game.rules.damage(game, amount, attacker, target, weapon);
  // (A Juggernaut takes a fraction of it.)
  if (target.jugger > 0) dmg *= RULES.juggerDamage;
  // (Where the mode has helmets, armour only covers a headshot if you have one.)
  const covered = !(opts.headshot && game.rules.helmets && !target.helmet);
  if (target.armour > 0 && !opts.burn && covered) {
    const soak = Math.min(target.armour, dmg * (game.rules.armourAbsorb ?? RULES.armourAbsorb));
    target.armour -= soak;
    dmg -= soak;
  }
  target.health -= dmg;
  if (opts.knock && !(target.jugger > 0)) {
    target.body.vx += (opts.dirX || 0) * opts.knock;
    target.body.vy += (opts.dirY || 0) * opts.knock * 0.5;
  }
  if (attacker && attacker !== target) {
    target.lastHurtBy = attacker;
    target.lastHurtWeapon = weapon;
    target.lastHurtTick = game.tick;
  }
  if (!opts.burn) {
    game.fx?.blood(target.x, target.y - 8, opts.dirX || 0, opts.dirY || 0, amount);
    game.sound(opts.headshot ? 'headshot' : 'hit', target.x, target.y);
  } else if (opts.poison && game.tick % 20 === 0) {
    game.sound('cough', target.x, target.y);
  }
  // The player hears a hitmarker tick when they land a headshot.
  if (opts.headshot && attacker && attacker !== target && !attacker.isBot) game.sound('hitmarker', attacker.x, attacker.y, attacker.id);
  game.onDamage?.(target, attacker, amount, weapon);
  if (target.health <= 0) game.kill(target, attacker, weapon, opts);
}
