// Firing, projectiles, explosions and damage.

import { BODY, RULES, MOTION } from './config.js';
import { WEAPONS, HEADSHOT_MULTIPLIER } from './weapons.js';
import { segmentBox } from './map.js';

const HEAD_ZONE = 9; // top pixels of the body box that count as a headshot

export function soldierBox(s) {
  const top = s.body.crouching ? BODY.crouchTop : BODY.top;
  return { l: s.x - BODY.halfW, t: s.y + top, r: s.x + BODY.halfW, b: s.y + BODY.bottom };
}

function canHurt(game, attacker, target) {
  if (!target.alive) return false;
  if (!attacker || attacker === target) return true;
  return !(game.mode === 'team' && attacker.team === target.team);
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

/** Fire the soldier's current weapon if it's ready. Returns true if a shot went off. */
export function fire(game, s) {
  const id = s.current, def = WEAPONS[id], inv = s.weapons[id];
  if (s.cooldown > 0 || !inv) return false;
  if (def.mag) {
    if (s.reloadTimer > 0) return false;
    if (inv.mag <= 0) { s.reloadTimer = def.reload; return false; }
    inv.mag--;
    if (inv.mag === 0) s.reloadTimer = def.reload;
  } else {
    if (inv.ammo <= 0) { s.selectBest(); return false; }
    inv.ammo--;
  }
  s.cooldown = def.rof;
  s.spawnProtect = 0;
  s.anim.recoil = def.kind === 'rocket' || def.kind === 'rail' ? 4 : 2.5;

  const dx = Math.cos(s.aim), dy = Math.sin(s.aim);
  let mx = s.shoulderX + dx * (def.look.length + 4);
  let my = s.shoulderY + dy * (def.look.length + 4);
  // Don't let the muzzle poke through a wall.
  const block = game.map.raycast(s.shoulderX, s.shoulderY, mx, my);
  if (block) { mx = block.x - dx * 1.5; my = block.y - dy * 1.5; }

  const rng = game.rng;
  const shot = (spread, speedScale = 1) => {
    const a = s.aim + (rng() - 0.5) * spread;
    return [Math.cos(a) * def.speed * speedScale, Math.sin(a) * def.speed * speedScale];
  };

  switch (def.kind) {
    case 'bullet': {
      const [vx, vy] = shot(def.spread);
      game.projectiles.push({ kind: 'bullet', x: mx, y: my, px: mx, py: my, vx, vy, owner: s, weapon: id, life: def.range / def.speed, damage: def.damage, knock: def.knock });
      game.fx?.shell(s.shoulderX + dx * 6, s.shoulderY + dy * 6, s.facing);
      break;
    }
    case 'pellets':
      for (let i = 0; i < def.pellets; i++) {
        const [vx, vy] = shot(def.spread, 0.85 + rng() * 0.3);
        game.projectiles.push({ kind: 'bullet', x: mx, y: my, px: mx, py: my, vx, vy, owner: s, weapon: id, life: def.range / def.speed, damage: def.damage, knock: def.knock });
      }
      break;
    case 'rail':
      railShot(game, s, mx, my, dx, dy, def, id);
      break;
    case 'rocket': {
      const [vx, vy] = shot(def.spread);
      game.projectiles.push({ kind: 'rocket', x: mx, y: my, px: mx, py: my, vx, vy, owner: s, weapon: id, life: def.range / def.speed + 30 });
      break;
    }
    case 'grenade': {
      const [vx, vy] = shot(def.spread);
      game.projectiles.push({ kind: 'grenade', x: mx, y: my, px: mx, py: my, vx: vx + s.body.vx * 0.4, vy: vy + s.body.vy * 0.3, owner: s, weapon: id, life: def.fuse, angle: 0 });
      break;
    }
    case 'flame': {
      for (let i = 0; i < 2; i++) {
        const [vx, vy] = shot(def.spread, 0.8 + rng() * 0.4);
        game.projectiles.push({ kind: 'flame', x: mx, y: my, px: mx, py: my, vx: vx + s.body.vx * 0.5, vy: vy + s.body.vy * 0.3, owner: s, weapon: id, life: def.life * (0.8 + rng() * 0.4), age: 0, hit: new Set() });
      }
      break;
    }
  }
  if (def.kind !== 'flame' || game.tick % 6 === 0) game.sound(def.sound, mx, my);
  if (def.kind !== 'flame') game.fx?.muzzle(mx, my, s.aim, def.kind === 'pellets' || def.kind === 'rocket');

  if (!def.mag && inv.ammo <= 0) s.selectBest();
  return true;
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

export function updateProjectiles(game) {
  const keep = [];
  for (const p of game.projectiles) {
    p.life--;
    p.px = p.x; p.py = p.y;
    let alive = true;
    switch (p.kind) {
      case 'bullet': alive = stepBullet(game, p); break;
      case 'rocket': alive = stepRocket(game, p); break;
      case 'grenade': alive = stepGrenade(game, p); break;
      case 'flame': alive = stepFlame(game, p); break;
    }
    if (alive && p.life > 0) keep.push(p);
    else if (alive && p.kind === 'rocket') explode(game, p.x, p.y, WEAPONS.Bazooka.blast, p.owner, p.weapon);
  }
  game.projectiles = keep;
}

function stepBullet(game, p) {
  const wall = game.map.raycast(p.x, p.y, p.x + p.vx, p.y + p.vy);
  const wt = wall ? wall.t : 1;
  const hit = hitSoldier(game, p.x, p.y, p.vx, p.vy, p.owner, p.owner);
  if (hit && hit.t <= wt) {
    const hx = p.x + p.vx * hit.t, hy = p.y + p.vy * hit.t;
    const head = hy < hit.box.t + HEAD_ZONE;
    const sp = Math.hypot(p.vx, p.vy);
    damage(game, hit.soldier, p.damage * (head ? HEADSHOT_MULTIPLIER : 1), p.owner, p.weapon, { dirX: p.vx / sp, dirY: p.vy / sp, knock: p.knock, headshot: head });
    p.x = hx; p.y = hy;
    return false;
  }
  if (wall) {
    p.x = wall.x; p.y = wall.y;
    game.fx?.sparks(wall.x, wall.y, wall.nx, wall.ny);
    if (game.rng() < 0.15) game.sound('ricochet', wall.x, wall.y);
    return false;
  }
  p.x += p.vx; p.y += p.vy;
  return true;
}

function stepRocket(game, p) {
  const wall = game.map.raycast(p.x, p.y, p.x + p.vx, p.y + p.vy);
  const wt = wall ? wall.t : 1;
  const hit = hitSoldier(game, p.x, p.y, p.vx, p.vy, p.owner, p.owner);
  if ((hit && hit.t <= wt) || wall) {
    const t = hit && hit.t <= wt ? hit.t : wt;
    const back = 2 / Math.hypot(p.vx, p.vy);
    p.x += p.vx * Math.max(0, t - back); p.y += p.vy * Math.max(0, t - back);
    explode(game, p.x, p.y, WEAPONS.Bazooka.blast, p.owner, p.weapon, hit && hit.t <= wt ? hit.soldier : null);
    return false;
  }
  p.x += p.vx; p.y += p.vy;
  if (game.tick % 2 === 0) game.fx?.smoke(p.x - p.vx, p.y - p.vy, 2.5, 30);
  return true;
}

function stepGrenade(game, p) {
  p.vy += MOTION.grenadeGravity;
  const hit = hitSoldier(game, p.x, p.y, p.vx, p.vy, p.owner, p.owner);
  const wall = game.map.raycast(p.x, p.y, p.x + p.vx, p.y + p.vy);
  if (hit && (!wall || hit.t <= wall.t) && hit.soldier !== p.owner) {
    p.x += p.vx * hit.t; p.y += p.vy * hit.t;
    explode(game, p.x, p.y, WEAPONS.GrenadeLauncher.blast, p.owner, p.weapon, hit.soldier);
    return false;
  }
  if (wall) {
    p.x = wall.x + wall.nx * 0.6; p.y = wall.y + wall.ny * 0.6;
    if (wall.nx) { p.vx = -p.vx * 0.45; p.vy *= 0.8; } else { p.vy = -p.vy * 0.45; p.vx *= 0.75; }
    if (Math.abs(p.vx) + Math.abs(p.vy) > 2 * MOTION.timeScale) game.sound('tink', p.x, p.y);
  } else {
    p.x += p.vx; p.y += p.vy;
  }
  p.angle += p.vx * 0.2;
  if (p.life <= 0) {
    explode(game, p.x, p.y, WEAPONS.GrenadeLauncher.blast, p.owner, p.weapon);
    return false;
  }
  return true;
}

function stepFlame(game, p) {
  p.age++;
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
      if (s.alive && s.spawnProtect <= 0) { s.burnTicks = RULES.burnTicks; s.burnBy = p.owner; }
    }
  }
  return true;
}

/** Blast damage with falloff, blocked by walls; also throws soldiers around. */
export function explode(game, x, y, blast, owner, weapon, direct = null) {
  game.fx?.explosion(x, y, blast.radius * 0.5);
  game.sound(weapon === 'Bazooka' ? 'explosion' : 'explosionSmall', x, y);
  game.shake(x, y, 9);
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
    if (canHurt(game, owner, s)) {
      damage(game, s, blast.damage * f * (self ? 0.5 : 1), owner, weapon, { dirX, dirY, knock: 0, explosive: true });
    }
  }
}

/** Apply damage. Armour soaks up part of it; burns go straight to health. */
export function damage(game, target, amount, attacker, weapon, opts = {}) {
  if (!target.alive || target.spawnProtect > 0 || game.over) return;
  if (!canHurt(game, attacker, target)) return;
  let dmg = amount;
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
  }
  // The player hears a hitmarker tick when they land a headshot.
  if (opts.headshot && attacker && attacker !== target && !attacker.isBot) game.sound('hitmarker', attacker.x, attacker.y);
  game.onDamage?.(target, attacker, amount);
  if (target.health <= 0) game.kill(target, attacker, weapon, opts);
}
