// Firing, projectiles, explosions and damage.
//
// Every projectile has a `kind` (how it moves), a `sprite` (how it's drawn),
// and a `cfg` (its numbers: the weapon definition, or a payload's). Weapon
// kinds are described at the top of weapons.js.

import { BODY, RULES, MOTION } from './config.js';
import { WEAPONS, HEADSHOT_MULTIPLIER } from './weapons.js';
import { segmentBox } from './map.js';

const HEAD_ZONE = 9; // top pixels of the body box that count as a headshot
const MAX_MINES = 5; // per soldier

export function soldierBox(s) {
  const top = s.body.crouching ? BODY.crouchTop : BODY.top;
  return { l: s.x - BODY.halfW, t: s.y + top, r: s.x + BODY.halfW, b: s.y + BODY.bottom };
}

export function canHurt(game, attacker, target) {
  if (!target.alive) return false;
  if (!attacker || attacker === target) return true;
  return !(game.rules.teams && attacker.team === target.team);
}

/** Nearest soldier the segment hits (excluding `skip`), or null. */
function hitSoldier(game, x0, y0, dx, dy, skip, owner) {
  let best = null;
  for (const s of game.soldiers) {
    if (s === skip || !s.alive || !canHurt(game, owner, s)) continue;
    const b = soldierBox(s);
    const h = segmentBox(x0, y0, dx, dy, b.l, b.t, b.r, b.b);
    if (h && (!best || h.t < best.t)) best = { ...h, soldier: s, box: b };
  }
  return best;
}

/** Nearest enemy of `owner` near (x, y) that's in plain sight, or null. */
function nearestEnemy(game, owner, x, y, range, needSight = true) {
  let best = null, bd = range;
  for (const s of game.soldiers) {
    if (s === owner || !s.alive || !canHurt(game, owner, s) || s.spawnProtect > 0) continue;
    const d = Math.hypot(s.x - x, s.y - 8 - y);
    if (d >= bd) continue;
    if (needSight && !game.map.clearLine(x, y, s.x, s.y - 8)) continue;
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

/**
 * Use the soldier's current weapon if it's ready. `input.firePressed` is true
 * on the tick the button went down (remote detonation and some tools need a click each time).
 * Returns true if something was fired.
 */
export function fire(game, s, input = {}) {
  const id = s.current, def = WEAPONS[id], inv = s.weapons[id];
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
    if (inv.mag <= 0) { s.reloadTimer = def.reload; return false; }
  } else if (inv.ammo <= 0) {
    s.selectBest();
    return false;
  }

  const muzzle = muzzlePoint(game, s, def);
  if (!LAUNCH[def.kind](game, s, def, id, muzzle)) { s.cooldown = Math.max(s.cooldown, 10); return false; }

  if (def.mag) {
    inv.mag--;
    if (inv.mag === 0) s.reloadTimer = def.reload;
  } else if (!game.rules.infiniteAmmo && inv.ammo !== Infinity) {
    inv.ammo--;
  }
  s.cooldown = def.rof;
  s.spawnProtect = 0;
  s.anim.recoil = def.kind === 'rocket' || def.kind === 'rail' ? 4 : def.kind === 'melee' ? 0 : 2.5;
  if (def.kind !== 'flame' || game.tick % 6 === 0) game.sound(def.sound, muzzle.x, muzzle.y);
  if (GUN_KINDS.has(def.kind)) game.fx?.muzzle(muzzle.x, muzzle.y, s.aim, (def.pellets || 0) > 1 || def.kind === 'rocket');
  if (!def.mag && inv.ammo <= 0 && !s.body.rope) s.selectBest();
  return true;
}

const GUN_KINDS = new Set(['bullet', 'rail', 'rocket', 'seeker']);

function muzzlePoint(game, s, def) {
  const dx = Math.cos(s.aim), dy = Math.sin(s.aim);
  const len = (def.look.length || 10) + 4;
  let x = s.shoulderX + dx * len, y = s.shoulderY + dy * len;
  // Don't let the muzzle poke through a wall.
  const block = game.map.raycast(s.shoulderX, s.shoulderY, x, y);
  if (block) { x = block.x - dx * 1.5; y = block.y - dy * 1.5; }
  return { x, y, dx, dy };
}

function aimed(game, s, spread, speed) {
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
      const [vx, vy] = aimed(game, s, def.spread, def.speed * (n > 1 ? 0.85 + game.rng() * 0.3 : 1));
      spawn(game, { kind: 'bullet', sprite: def.damage >= 40 ? 'slug' : 'bullet', x: m.x, y: m.y, vx, vy, owner: s, weapon: id, life: def.range / def.speed, damage: def.damage, knock: def.knock });
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
        const ax = o.x - s.shoulderX, ay = o.y - 8 - s.shoulderY, d = Math.hypot(ax, ay);
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
      const [vx, vy] = aimed(game, s, def.spread, def.speed * (0.8 + game.rng() * 0.4));
      spawn(game, { kind: 'flame', sprite: 'flame', x: m.x, y: m.y, vx: vx + s.body.vx * 0.5, vy: vy + s.body.vy * 0.3, owner: s, weapon: id, life: def.life * (0.8 + game.rng() * 0.4), hit: new Set() });
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
    const dx = t.x - s.shoulderX, dy = t.y - s.shoulderY, d = Math.hypot(dx, dy);
    if (d > def.range) t = { x: s.shoulderX + dx / d * def.range, y: s.shoulderY + dy / d * def.range };
    const spot = freeSpot(game, t.x, t.y + 6);
    if (!spot) { game.notify(s, "Can't teleport there"); return false; }
    game.fx?.ring(s.x, s.y - 6, '#7a4fd0');
    s.body.x = spot.x; s.body.y = spot.y;
    s.body.vx = 0; s.body.vy = 0; s.body.rope = null; s.body.onGround = false;
    s.prevX = spot.x; s.prevY = spot.y;
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
    const len = Math.hypot(hit.x - s.x, hit.y - (s.y - 6));
    s.body.rope = { x: hit.x, y: hit.y, len: Math.max(20, len) };
    s.body.onGround = false;
    return true;
  },

  melee(game, s, def, id) {
    s.anim.swing = 1;
    meleeHit(game, s, def, id);
    return true;
  },
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
  for (const o of game.soldiers) {
    if (o === s || !o.alive || !canHurt(game, s, o)) continue;
    const cx = o.x, cy = o.y - 6;
    const rx = cx - sx, ry = cy - sy, d = Math.hypot(rx, ry);
    if (d > def.reach + 12) continue;
    if (d > 8 && (rx * dx + ry * dy) / d < 0.3) continue; // behind you
    if (!game.map.clearLine(sx, sy, cx, cy)) continue;
    if (d < bd) { bd = d; best = o; }
  }
  if (!best) { game.sound('swing', sx, sy); return; }
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
  o.body.vx += kx;
  o.body.vy += ky;
  if (ky < -0.5) o.body.onGround = false;
  if (Math.abs(kx) > 3 || ky < -2) o.body.momentum = 30;
  o.lastHurtBy = s; o.lastHurtWeapon = id; o.lastHurtTick = game.tick;
  game.sound(def.sound, o.x, o.y);
  game.fx?.whack(o.x, o.y - 10);
  if (def.uppercut) for (let i = 0; i < 6; i++) game.fx?.fire(o.x + (game.rng() - 0.5) * 8, o.y - 10 + (game.rng() - 0.5) * 8);
  const amount = def.halve ? Math.max(def.damage, o.health / 2) : def.damage;
  if (amount > 0) damage(game, o, amount, s, id, { dirX: dx, dirY: dy, knock: 0, melee: true });
}

function railShot(game, s, x0, y0, dx, dy, def, id) {
  const x1 = x0 + dx * def.range, y1 = y0 + dy * def.range;
  const wall = game.map.raycast(x0, y0, x1, y1);
  const wt = wall ? wall.t : 1;
  const hit = hitSoldier(game, x0, y0, x1 - x0, y1 - y0, s, s);
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
  game.projectiles = []; // anything spawned during this update lands here
  const keep = [];
  for (const p of list) {
    if (p.dead) continue;
    if (p.delay > 0) { p.delay--; keep.push(p); continue; } // air strike bombs waiting their turn
    p.life--;
    p.age++;
    p.px = p.x; p.py = p.y;
    if (STEP[p.kind](game, p) && !p.dead) keep.push(p);
  }
  game.projectiles = keep.concat(game.projectiles);
}

/** Set off a projectile's payload: blast, cluster bomblets, fire, gas. */
function detonate(game, p, direct = null) {
  const c = p.cfg;
  p.dead = true;
  if (c.blast) explode(game, p.x, p.y, c.blast, p.owner, p.weapon, direct);
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
  if (c.burst) game.sound(c.burst, p.x, p.y);
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
  bullet(game, p) {
    const wall = game.map.raycast(p.x, p.y, p.x + p.vx, p.y + p.vy);
    const hit = sweepHit(game, p, wall);
    if (hit) {
      const hy = p.y + p.vy * hit.t;
      const head = hy < hit.box.t + HEAD_ZONE;
      const sp = Math.hypot(p.vx, p.vy);
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
    if (hit) {
      const hy = p.y + p.vy * hit.t;
      const head = hy < hit.box.t + HEAD_ZONE;
      const sp = Math.hypot(p.vx, p.vy);
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
        const sp = Math.hypot(p.vx, p.vy);
        p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
      }
    }
    if (c.gravity) p.vy += c.gravity;
    const wall = game.map.raycast(p.x, p.y, p.x + p.vx, p.y + p.vy);
    const hit = sweepHit(game, p, wall);
    if (hit || wall) {
      const t = hit ? hit.t : wall.t;
      const back = 2 / (Math.hypot(p.vx, p.vy) || 1);
      p.x += p.vx * Math.max(0, t - back); p.y += p.vy * Math.max(0, t - back);
      detonate(game, p, hit ? hit.soldier : null);
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
    for (const s of game.soldiers) {
      if (s === p.owner || p.hit.has(s) || !canHurt(game, p.owner, s)) continue;
      const b = soldierBox(s);
      if (p.x + r > b.l && p.x - r < b.r && p.y + r > b.t && p.y - r < b.b) {
        p.hit.add(s);
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
      for (const s of game.soldiers) {
        if (!canHurt(game, p.owner, s) || s.spawnProtect > 0) continue;
        const b = soldierBox(s);
        if (p.x + 8 > b.l && p.x - 8 < b.r && p.y + 2 > b.t && p.y - 12 < b.b) {
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
    for (const s of game.soldiers) {
      if (!s.alive || s.spawnProtect > 0 || s.gassed === game.tick || !canHurt(game, p.owner, s)) continue;
      if (Math.hypot(s.x - p.x, s.y - 8 - p.y) < p.r * fade + 6) {
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
    const W = 5, H = 12;
    const blocked = (x, y) => map.overlap(x - W, y - H, x + W, y - 0.01);
    p.vy = Math.min(p.vy + MOTION.itemGravity * 1.5, MOTION.itemMaxFall);
    p.vx = p.dir * c.walkSpeed;
    // Horizontal
    const nx = p.x + p.vx;
    if (!blocked(nx, p.y)) p.x = nx;
    else if (p.onGround) {
      let stepped = false;
      for (let up = 1; up <= 8 && !stepped; up++) if (!blocked(nx, p.y - up)) { p.x = nx; p.y -= up; stepped = true; }
      if (!stepped) {
        if (c.hop && !p.hopped) { p.vy = -c.hop; p.onGround = false; p.hopped = true; p.hopX = p.x; }
        else { p.dir = -p.dir; p.hopped = false; }
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
    if (game.tick % 90 === p.id % 90) game.sound(p.weapon === 'MadCow' ? 'moo' : p.weapon === 'OldWoman' ? 'mumble' : 'baa', p.x, p.y);
    if (c.contact) {
      for (const s of game.soldiers) {
        if (s === p.owner || !s.alive || !canHurt(game, p.owner, s)) continue;
        if (Math.abs(s.x - p.x) < 11 && s.y - 22 < p.y && s.y + 14 > p.y - 12) { detonate(game, p, s); return false; }
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
      if (Math.hypot(t.x - p.x, t.y - p.y) > 12) p.angle += Math.max(-c.turn, Math.min(c.turn, d));
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
        for (const s of game.soldiers) {
          if (s === p.owner || !s.alive || !canHurt(game, p.owner, s)) continue;
          if (Math.hypot(s.x - p.x, s.y - p.y) < c.mine.trigger) { p.triggered = c.mine.delay; game.sound('beep', p.x, p.y); break; }
        }
      } else if (--p.triggered <= 0) { detonate(game, p); return false; }
      return p.life > 0;
    }
    if (game.tick % 3 === 0) game.fx?.spark(p.x + 2, p.y - 6);
    if (p.life <= 0) { detonate(game, p); return false; }
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
    }
    p.inside = inside;
    for (const s of game.soldiers) {
      if (!s.alive || !canHurt(game, p.owner, s) || s === p.owner) continue;
      if (Math.abs(s.x - p.x) < 16 && Math.abs(s.y - 6 - p.y) < 18 && !p.squashed?.has(s)) {
        (p.squashed ||= new Set()).add(s);
        explode(game, p.x, p.y, c.blast, p.owner, p.weapon, s);
      }
    }
    return p.smashes < c.smashes && p.y < game.map.bounds.bottom + RULES.fallDeathMargin + 100;
  },
};

function ignite(s, by) {
  if (s.alive && s.spawnProtect <= 0) { s.burnTicks = RULES.burnTicks; s.burnBy = by; }
}

/** Blast damage with falloff, blocked by walls; also throws soldiers around and sets off nearby mines. */
export function explode(game, x, y, blast, owner, weapon, direct = null) {
  game.fx?.explosion(x, y, blast.radius * 0.5);
  game.sound(blast.radius > 85 ? 'explosion' : 'explosionSmall', x, y);
  game.shake(x, y, Math.min(16, 5 + blast.radius / 20));
  const reach = blast.radius + 8;
  for (const s of game.soldiers) {
    if (!s.alive) continue;
    const cx = s.x, cy = s.y - 5;
    const d = Math.hypot(cx - x, cy - y);
    if (d > reach && s !== direct) continue;
    if (s !== direct && !game.map.clearLine(x, y, cx, cy) && !game.map.clearLine(x, y, cx, s.y - 18)) continue;
    const f = s === direct ? 1 : Math.max(0.15, 1 - d / reach);
    const self = s === owner;
    let dirX = (cx - x) / (d || 1), dirY = (cy - y) / (d || 1) - 0.6;
    const dl = Math.hypot(dirX, dirY) || 1;
    dirX /= dl; dirY /= dl;
    // Knockback applies even to teammates and yourself (rocket jumps!).
    const k = blast.knock * f * (self ? 0.85 : 1);
    s.body.vx += dirX * k;
    s.body.vy += dirY * k;
    if (s.body.vy < -1) s.body.onGround = false;
    if (k > 8) s.body.momentum = 20;
    if (canHurt(game, owner, s)) {
      damage(game, s, blast.damage * f * (self ? 0.5 : 1), owner, weapon, { dirX, dirY, knock: 0, explosive: true });
    }
  }
  // Explosions set off mines and dynamite nearby.
  for (const p of game.projectiles) {
    if (p.kind !== 'placed' || p.dead) continue;
    if (Math.hypot(p.x - x, p.y - y) > blast.radius * 0.8) continue;
    if (p.cfg.mine) { p.armed = 0; if (p.triggered < 0 || p.triggered > 4) p.triggered = 4; }
    else p.life = Math.min(p.life, 4);
  }
}

/** Apply damage. Armour soaks up part of it; burns and poison go straight to health. */
export function damage(game, target, amount, attacker, weapon, opts = {}) {
  if (!target.alive || target.spawnProtect > 0 || game.over) return;
  if (!canHurt(game, attacker, target)) return;
  let dmg = game.rules.damage(game, amount, attacker, target, weapon);
  if (target.armour > 0 && !opts.burn) {
    const soak = Math.min(target.armour, dmg * RULES.armourAbsorb);
    target.armour -= soak;
    dmg -= soak;
  }
  target.health -= dmg;
  if (opts.knock) {
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
  game.onDamage?.(target, attacker, amount);
  if (target.health <= 0) game.kill(target, attacker, weapon, opts);
}
