// Monsters, mercenaries, and day and night (world mode).
//
// Monsters come near players where it's dark: zombies on the surface at night, skeletons with
// pistols underground, brutes with clubs deep down. They're soldiers like any other (the same
// bodies, guns, damage and deaths), each run by a simple controller: go for the nearest player
// or mercenary, shoot or hit them, jump what's in the way. Killed, they drop coins and loot;
// far from everyone (or zombies, in daylight), they go.
//
// Mercenaries are hired with a contract (crafted from coins at the gunsmith's bench, used like
// a weapon): each follows whoever hired them, shooting the monsters near them.
//
// A day lasts DAY_TICKS updates; the world keeps the time (world.time), saved with it.

import * as K from './blocks.js';
import { BLOCKS, WALLS, TILE, SOLID, NO_WALL } from './blocks.js';
import { WORLD_H } from './worldgen.js';
import { WEAPONS } from '../weapons.js';
import { BODY } from '../config.js';
import { iceBrake } from '../physics.js';
import { pushDoor } from './doors.js';
import { difficultyOf } from './worldrules.js';

// ---- Day and night ---------------------------------------------------------------------------

/** How long a day is (updates: sixteen minutes). The world starts at six in the morning. */
export const DAY_TICKS = 60 * 60 * 16;
/** The hour of the day (0-24) at world time t. */
export const hourOf = t => (((t / DAY_TICKS) * 24 + 6) % 24 + 24) % 24;
/** Which day it is (1 the first). */
export const dayOf = t => Math.floor((t / DAY_TICKS * 24 + 6) / 24) + 1;
/** How dark it is outside (0 at midday, 1 in the middle of the night): dusk from 18 to 20, dawn from 4 to 6. */
export function nightness(t) {
  const h = hourOf(t);
  if (h >= 6 && h < 18) return 0;
  if (h >= 18 && h < 20) return (h - 18) / 2;
  if (h >= 4 && h < 6) return 1 - (h - 4) / 2;
  return 1;
}
/** How much daylight there is (15 at day, 4 at night: moonlight). */
export const skyLevel = t => Math.round(15 - 11 * nightness(t));
/** True at night (zombies come out). */
export const isNight = t => nightness(t) > 0.6;
/** The time of day as a clock reads it ('21:40'). */
export function clock(t) {
  const h = hourOf(t), hh = Math.floor(h), mm = Math.floor((h - hh) * 6) * 10;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ---- Who's who -------------------------------------------------------------------------------------

export const MONSTERS = {
  zombie: { name: 'Zombie', health: 70, speed: 0.5, weapon: 'Claws', skin: 'zombie', coins: [2, 6], loot: [['wood', 1, 3, 0.25], ['coal', 1, 2, 0.2], ['torch', 1, 3, 0.15], ['apple', 1, 2, 0.1], ['bread', 1, 1, 0.06]] },
  skeleton: { name: 'Skeleton', health: 80, speed: 0.7, weapon: 'Beretta', skin: 'skeleton', ranged: true, coins: [4, 10], loot: [['bullets', 6, 18, 0.5], ['iron_ore', 1, 4, 0.25], ['Beretta', 1, 1, 0.03], ['healing_potion', 1, 1, 0.05]] },
  brute: { name: 'Brute', health: 320, speed: 0.55, weapon: 'BruteClub', skin: 'brute', coins: [20, 45], loot: [['iron_bar', 2, 5, 0.6], ['gold_bar', 1, 3, 0.35], ['ember_ore', 1, 2, 0.15], ['healing_potion', 1, 2, 0.3], ['greater_potion', 1, 1, 0.06], ['ruby', 1, 1, 0.04]] },
};
/** Mercenaries: a rifle, a soldier's health. */
export const MERC = { gun: 'M4', speed: 1, most: 3 };
const MERC_NAMES = ['Vasquez', 'Drake', 'Hicks', 'Frost', 'Apone', 'Dietrich', 'Hudson', 'Ferro', 'Spunkmeyer', 'Crowe', 'Wierzbowski'];

/** Which side a soldier's on: monsters together, townsfolk together, each player with their mercenaries. */
export function sideOf(s) {
  const k = s.npc?.kind;
  // (A monster on someone's side, summoned in dev mode: theirs.)
  return k === 'monster' ? (s.npc.ally != null ? `p${s.npc.ally}` : 'monsters') : k === 'merc' ? `p${s.npc.owner}` : k === 'townsfolk' ? 'town' : `p${s.id}`;
}
/**
 * Whether `a` can hurt `b` in `world`: not on the same side, and players (and their mercenaries)
 * only with PvP on. Townsfolk (townsfolk.js) only fight if they're guards, and only monsters:
 * nothing else hurts them, and they hurt nobody else.
 */
export function foes(world, a, b) {
  const sa = sideOf(a), sb = sideOf(b);
  if (sa === sb) return false;
  if (sa === 'town') return !!a.npc.guard && sb === 'monsters';
  if (sb === 'town') return !!b.npc.guard && sa === 'monsters';
  if (sa === 'monsters' || sb === 'monsters') return true;
  return world?.pvp !== false;
}
export const isMonster = s => s.npc?.kind === 'monster';
/** A monster that's against everyone (not one summoned to someone's side: devtools.js). */
export const isHostile = s => s.npc?.kind === 'monster' && s.npc.ally == null;
export const isMerc = s => s.npc?.kind === 'merc';

/** The weapon an NPC carries, ready to use (endless rounds: they don't run out). Townsfolk: theirs, if any. */
export function armNpc(s) {
  const n = s.npc;
  const id = n.kind === 'monster' ? MONSTERS[n.type].weapon : n.kind === 'townsfolk' ? n.weapon : n.gun || MERC.gun;
  const def = WEAPONS[id];
  if (!def) {
    // (Nothing: their hands, or what they work with.)
    s.weapons = {};
    s.current = 'Hands';
    s.held = n.held || null;
    return;
  }
  s.weapons = { [id]: def.mag ? { ammo: Infinity, mag: def.mag } : { ammo: Infinity } };
  s.current = id;
  s.held = null;
}

/** A monster of `type`, to appear at (x, y) (a body's middle) at the next update. */
export function spawnMonster(game, type, x, y) {
  const def = MONSTERS[type], hp = Math.round(def.health * difficultyOf(game.world).hp);
  const s = game.addSoldier({ name: def.name, isBot: true, team: 0, skin: def.skin, maxHealth: hp, profile: { npc: { kind: 'monster', type } } }, new MonsterController(type));
  s.respawnTimer = 1;
  s.npc.spawnAt = { x, y };
  return s;
}

/** A mercenary for `owner` (appearing next to them). gun: what they carry. */
export function hireMerc(game, owner, gun = MERC.gun) {
  const name = MERC_NAMES[(game.soldiers.length * 7 + owner.id) % MERC_NAMES.length];
  const s = game.addSoldier({ name, isBot: true, team: 0, profile: { npc: { kind: 'merc', owner: owner.id, gun } } }, new MercController(owner.id));
  s.respawnTimer = 1;
  return s;
}

/** A player's mercenaries (alive, or about to appear). */
export const mercsOf = (game, owner) => game.soldiers.filter(s => isMerc(s) && s.npc.owner === owner.id && (s.alive || !s.npc.spawned));

// ---- Where they appear, and go ------------------------------------------------------------------------

const SPAWN_EVERY = 30;   // updates between tries
const NEAR = 80;          // tiles round a player counted as theirs
const GONE = 110;         // tiles from every player a monster goes at
const BUILT_WALLS = new Set(WALLS.filter(w => w.id !== NO_WALL && !w.natural).map(w => w.id));

/** Monsters come and go (the world mode's tick). */
export function monstersTick(game) {
  const world = game.world;
  if (game.tick % SPAWN_EVERY !== 0) return;
  // (Where a scope's looking, far off, counts as somewhere someone is: monsters there stay, and come,
  // as round a player: main.js's world.lookAt, attachments.js.)
  const players = game.soldiers.filter(s => s.alive && s.world);
  if (world.lookAt) players.push({ x: world.lookAt.x, y: world.lookAt.y });
  const night = isNight(world.time || 0);
  // Gone: the dead (a while after), those far from everyone, zombies caught out in daylight.
  for (const s of game.soldiers) {
    if (!isMonster(s)) continue;
    if (!s.alive) { if (s.npc.spawned && game.tick - (s.npc.diedAt ?? game.tick) > 180) game.removeSoldier(s); continue; }
    const tx = Math.floor(s.x / TILE), ty = Math.floor(s.y / TILE);
    let near = Infinity;
    for (const p of players) near = Math.min(near, Math.max(Math.abs(p.x - s.x), Math.abs(p.y - s.y)) / TILE);
    const outside = ty < world.gen.surfaceAt(tx) + 6;
    if (near > GONE || (!night && outside && s.npc.type === 'zombie' && near > 30)) game.removeSoldier(s);
  }
  for (const s of game.soldiers) if (isMerc(s) && !s.alive && s.npc.spawned && game.tick - (s.npc.diedAt ?? game.tick) > 180) game.removeSoldier(s);
  // (Dev mode can say none come; so can a peaceful world: worldrules.js.)
  const diff = difficultyOf(world);
  if (world.devQuiet || !diff.spawn) return;
  // Come: near each player, where it's dark (at night outside; underground, always).
  for (const p of players) {
    const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
    const depth = pty - world.gen.surfaceAt(ptx);
    const under = depth > 12;
    if (!under && !night) continue;
    let count = 0;
    for (const s of game.soldiers) if (isMonster(s) && Math.abs(s.x - p.x) < NEAR * TILE && Math.abs(s.y - p.y) < NEAR * TILE) count++;
    if (count >= Math.round((under ? 3 : 4) * Math.max(1, diff.spawn)) || game.rng() > 0.15 * diff.spawn) continue;
    const spot = spawnSpot(game, ptx, pty, under);
    if (!spot) continue;
    const d = spot.ty - world.gen.surfaceAt(spot.tx);
    const r = game.rng();
    const type = !under ? (r < 0.1 ? 'skeleton' : 'zombie') : d > 180 ? (r < 0.3 ? 'brute' : 'skeleton') : r < 0.6 ? 'skeleton' : 'zombie';
    spawnMonster(game, type, spot.tx * TILE + TILE / 2, (spot.ty + 1) * TILE - BODY.bottom - 1);
  }
}

/**
 * Somewhere for a monster to come from, out of sight of a player at (ptx, pty): standing room
 * (three blocks of air on a solid floor), dark (no torch near, not someone's walled-in room).
 * Returns { tx, ty } (the tile its feet are in), or null.
 */
export function spawnSpot(game, ptx, pty, under) {
  const world = game.world, rng = game.rng;
  for (let attempt = 0; attempt < 6; attempt++) {
    const side = rng() < 0.5 ? -1 : 1, tx = ptx + side * (34 + Math.floor(rng() * 22));
    const surf = world.gen.surfaceAt(tx);
    // (Not in a town, nor near one: towns are safe.)
    if (!under && world.gen.townNear(tx, 24)) continue;
    const tries = under ? [pty, pty - 6, pty + 6, pty - 12, pty + 12] : [world.surface(tx) - 1];
    for (const y0 of tries) {
      for (let dy = 0; dy < 8; dy++) {
        const ty = y0 + dy;
        if (ty < 3 || ty >= WORLD_H - 2) continue;
        if (under && ty < surf + 8) continue;
        if (!SOLID[world.tile(tx, ty + 1)] || world.tile(tx, ty) !== K.AIR || world.tile(tx, ty - 1) !== K.AIR || world.tile(tx, ty - 2) !== K.AIR) continue;
        if (BUILT_WALLS.has(world.wall(tx, ty)) || torchNear(world, tx, ty)) break;
        return { tx, ty };
      }
    }
  }
  return null;
}

function torchNear(world, tx, ty) {
  for (let y = ty - 6; y <= ty + 6; y++) for (let x = tx - 6; x <= tx + 6; x++) if (world.tile(x, y) === K.TORCH) return true;
  return false;
}

/** What a monster drops when it's killed: coins, and now and then something from its loot (more: the killer's Scavenger perk). */
export function monsterLoot(game, s, drop, more = 1) {
  const def = MONSTERS[s.npc.type], rng = game.rng;
  // (A named monster, a quest's quarry: a lot more.)
  const champ = s.npc.champion ? 6 : 1;
  const coins = Math.round((def.coins[0] + Math.floor(rng() * (def.coins[1] - def.coins[0] + 1))) * more * champ);
  drop('coins', coins);
  for (const [key, lo, hi, chance] of def.loot) if (rng() < Math.min(1, chance * more * champ)) drop(key, lo + Math.floor(rng() * (hi - lo + 1)));
}

// ---- How they behave ------------------------------------------------------------------------------------

/** The nearest soldier s can fight (foes), within (rx, ry) px, that `ok` agrees to. */
function nearestFoe(game, s, rx, ry, ok = null) {
  let best = null, bd = Infinity;
  for (const o of game.soldiers) {
    // (Someone invisible, dev mode's: not seen.)
    if (!o.alive || o === s || o.world?.dev?.invisible || !foes(game.world, s, o) || (ok && !ok(o))) continue;
    const dx = o.x - s.x, dy = o.y - s.y;
    if (Math.abs(dx) > rx || Math.abs(dy) > ry) continue;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

const seesFrom = (game, s, o) => game.world.clearLine(s.shoulderX, s.shoulderY, o.x, o.y - 14);

/** Walking toward dir (-1, 0, 1): jumps when it's stopped by something, or what it's after is above. (Stopping on ice: braking.) */
function walk(game, s, ctl, inp, dir, speed, above) {
  inp.move = (dir || iceBrake(s.body, game.world)) * speed;
  if (dir && !isMonster(s)) pushDoor(game, s, dir);
  if (dir && s.body.onGround) {
    ctl.stuck = Math.abs(s.x - ctl.lastX) < 0.15 ? ctl.stuck + 1 : 0;
    if (ctl.stuck > 5 || (above && game.rng() < 0.06)) { inp.jump = true; inp.jumpPressed = true; ctl.stuck = 0; }
  } else if (!s.body.onGround) inp.jump = s.body.vy < 0;
  ctl.lastX = s.x;
}

export class MonsterController {
  constructor(type) {
    this.type = type;
    this.def = MONSTERS[type];
    this.stuck = 0;
    this.lastX = 0;
    this.wander = 0;
    this.wanderDir = 0;
    this.aimWobble = 0;
  }

  input(game, s) {
    const def = this.def, inp = { move: 0, jump: false, jumpPressed: false, crouch: false, fire: false, firePressed: false, aim: s.aim, aimDist: 120 };
    // (Summoned to someone's side: it keeps up with them, and goes for what they're up against.)
    const lead = s.npc.ally != null ? game.soldiers.find(o => o.id === s.npc.ally && !o.npc) : null;
    if (lead?.alive && (Math.abs(lead.x - s.x) > 50 * TILE || Math.abs(lead.y - s.y) > 24 * TILE)) {
      s.body.x = lead.x - lead.facing * 24;
      s.body.y = lead.y;
      s.body.vx = s.body.vy = 0;
    }
    const foe = nearestFoe(game, s, 44 * TILE, 22 * TILE);
    if (!foe && lead?.alive) {
      const dx = lead.x - s.x;
      walk(game, s, this, inp, Math.abs(dx) > 4 * TILE ? Math.sign(dx) : 0, def.speed * 1.4, lead.y < s.y - 40);
      if (Math.abs(dx) > 4) inp.aim = dx < 0 ? Math.PI : 0;
      return inp;
    }
    if (!foe) {
      // Nobody near: wandering about.
      if (--this.wander <= 0) { this.wanderDir = [-1, 0, 0, 1][Math.floor(game.rng() * 4)]; this.wander = 60 + game.rng() * 160; }
      walk(game, s, this, inp, this.wanderDir, def.speed * 0.6, false);
      if (this.wanderDir) inp.aim = this.wanderDir < 0 ? Math.PI : 0;
      return inp;
    }
    const dx = foe.x - s.x, dy = foe.y - s.y, dist = Math.hypot(dx, dy);
    // (Not quite on target: a monster's aim wanders.)
    this.aimWobble += (game.rng() - 0.5) * 0.08;
    this.aimWobble *= 0.9;
    inp.aim = Math.atan2(foe.y - 14 - s.shoulderY, foe.x - s.shoulderX) + (def.ranged ? this.aimWobble : 0);
    inp.aimDist = dist;
    let dir = Math.sign(dx);
    if (def.ranged) {
      const sees = dist < 440 && seesFrom(game, s, foe);
      if (sees) {
        inp.fire = true;
        inp.firePressed = game.tick % 16 === 0;
        dir = dist > 240 ? Math.sign(dx) : dist < 100 ? -Math.sign(dx) : 0;
      }
    } else {
      const reach = WEAPONS[def.weapon].reach || 20;
      if (Math.abs(dx) < reach + 8 && Math.abs(dy) < 34) { inp.fire = true; inp.firePressed = true; dir = Math.abs(dx) > 6 ? Math.sign(dx) : 0; }
    }
    walk(game, s, this, inp, dir, def.speed, dy < -40);
    return inp;
  }

  onDeath(game, s) { s.npc.diedAt = game.tick; }
}

export class MercController {
  constructor(owner) {
    this.owner = owner;
    this.stuck = 0;
    this.lastX = 0;
  }

  input(game, s) {
    const inp = { move: 0, jump: false, jumpPressed: false, crouch: false, fire: false, firePressed: false, aim: s.aim, aimDist: 120 };
    const owner = game.soldiers.find(o => o.id === this.owner && !o.npc);
    if (!owner) return inp;
    // Lost (far behind, or the owner's gone where it can't follow): it catches up.
    if (owner.alive && (Math.abs(owner.x - s.x) > 50 * TILE || Math.abs(owner.y - s.y) > 24 * TILE)) {
      s.body.x = owner.x - owner.facing * 24;
      s.body.y = owner.y;
      s.body.vx = s.body.vy = 0;
    }
    const foe = nearestFoe(game, s, 30 * TILE, 16 * TILE, o => isMonster(o) && seesFrom(game, s, o));
    if (foe) {
      inp.aim = Math.atan2(foe.y - 14 - s.shoulderY, foe.x - s.shoulderX);
      inp.aimDist = Math.hypot(foe.x - s.x, foe.y - s.y);
      inp.fire = true;
      inp.firePressed = game.tick % 8 === 0;
    } else if (owner.alive) {
      inp.aim = owner.aim;
    }
    // Following, a few blocks behind.
    const dx = owner.x - s.x, gap = Math.abs(dx);
    const dir = gap > (foe ? 10 : 5) * TILE ? Math.sign(dx) : 0;
    inp.sprint = gap > 14 * TILE;
    walk(game, s, this, inp, dir, MERC.speed, owner.y < s.y - 40);
    return inp;
  }

  onDeath(game, s) { s.npc.diedAt = game.tick; }
}


