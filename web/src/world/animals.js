// Animals (world mode): cows, pigs, sheep and chickens on grassland and in woods, deer in forests,
// rabbits nearly everywhere, goats on mountains, camels in deserts, polar bears on the snow (they
// fight back), fish in seas and lakes, crabs on beaches, frogs in swamps, parrots in jungles.
//
// They're soldiers like any other (npc.kind 'animal': the same bodies, shots and deaths, drawn as
// animals: animalart.js), each run by its own simple controller: they wander and graze, keep out
// of deep water and away from drops, run when they're hurt (shy ones when you come near), and come
// to whoever's holding their food. They come round players by day (fish whenever), a few at a time
// and in herds, and go when everyone's far away: they aren't kept with the world.
//
// Killed, they give meat, leather, wool and feathers; a sheep can be sheared (its wool grows back);
// fed their food, two of a kind make a young one (it grows up); chickens lay eggs. Only players hunt
// them: monsters, guards and mercenaries leave them be (monsters.js's foes), and they hurt nobody,
// but for a polar bear that's been hurt.

import * as K from './blocks.js';
import { TILE, SOLID, PLATFORMS, LIQUID, WALLS, NO_WALL } from './blocks.js';
import { WORLD_H } from './worldgen.js';
import { BODY } from '../config.js';
import { nightness } from './monsters.js';
import { giveXp, countStat } from './progress.js';
import { sleeps, asleepNear } from './sleepers.js';

/**
 * The animals: their name, health, how fast they walk and run (of a soldier's crouched and full
 * speed), how many come together, what they eat (held, they follow it; fed it, they breed), and
 * what they give ([key, least, most, chance (1: always)]). aquatic: fish; shy: runs from people;
 * hops: goes in hops; fights: hurt, it goes for whoever did it (with `weapon`); shear: sheared.
 */
export const ANIMALS = {
  cow: { name: 'Cow', health: 60, walk: 0.3, run: 0.55, herd: [2, 4], food: ['wheat'], drops: [['raw_beef', 1, 3], ['leather', 0, 2], ['bone', 1, 1, 0.25]], xp: 3, sound: 'moo' },
  pig: { name: 'Pig', health: 45, walk: 0.32, run: 0.6, herd: [2, 3], food: ['carrot', 'potato'], drops: [['raw_pork', 1, 3]], xp: 3 },
  sheep: { name: 'Sheep', health: 45, walk: 0.3, run: 0.55, herd: [2, 4], food: ['wheat'], drops: [['raw_mutton', 1, 2], ['wool', 1, 1]], xp: 3, sound: 'baa', shear: true },
  chicken: { name: 'Chicken', health: 20, walk: 0.28, run: 0.5, herd: [2, 4], food: ['wheat_seeds'], drops: [['raw_chicken', 1, 1], ['feather', 0, 2]], xp: 2, eggs: true },
  deer: { name: 'Deer', health: 55, walk: 0.32, run: 0.8, herd: [1, 3], food: ['apple'], drops: [['raw_venison', 1, 3], ['leather', 0, 2], ['bone', 1, 1, 0.25]], xp: 4, shy: true },
  rabbit: { name: 'Rabbit', health: 15, walk: 0.35, run: 0.85, herd: [1, 2], food: ['carrot'], drops: [['raw_rabbit', 1, 1], ['leather', 1, 1, 0.4]], xp: 2, shy: true, hops: true },
  goat: { name: 'Goat', health: 50, walk: 0.3, run: 0.6, herd: [1, 3], food: ['wheat'], drops: [['raw_mutton', 1, 2], ['leather', 0, 1]], xp: 3, hops: true },
  camel: { name: 'Camel', health: 90, walk: 0.26, run: 0.5, herd: [1, 2], food: ['cactus'], drops: [['leather', 1, 3], ['bone', 1, 1, 0.3]], xp: 4 },
  polar_bear: { name: 'Polar bear', health: 140, walk: 0.28, run: 0.62, herd: [1, 1], food: ['raw_fish'], drops: [['raw_fish', 0, 2], ['leather', 1, 2], ['bone', 1, 2, 0.5]], xp: 15, fights: true, weapon: 'Claws' },
  fish: { name: 'Fish', health: 10, walk: 0.3, run: 0.6, herd: [2, 4], drops: [['raw_fish', 1, 1], ['bone', 1, 1, 0.1]], xp: 1, aquatic: true },
  crab: { name: 'Crab', health: 18, walk: 0.28, run: 0.5, herd: [1, 3], food: ['raw_fish'], drops: [['crab_meat', 1, 1]], xp: 2 },
  frog: { name: 'Frog', health: 10, walk: 0.3, run: 0.65, herd: [1, 3], food: [], drops: [], xp: 1, hops: true },
  parrot: { name: 'Parrot', health: 10, walk: 0.3, run: 0.6, herd: [1, 2], food: ['wheat_seeds'], drops: [['feather', 1, 2]], xp: 1, hops: true },
};

/** Which animals live where (by biome: worldgen.js), and how likely each is ([type, weight]). */
const LIVES = {
  plains: [['cow', 3], ['sheep', 3], ['pig', 2], ['chicken', 2], ['rabbit', 1]],
  meadow: [['sheep', 3], ['cow', 2], ['rabbit', 2], ['chicken', 1]],
  forest: [['pig', 2], ['chicken', 2], ['deer', 2], ['cow', 1], ['rabbit', 1]],
  birch_forest: [['deer', 2], ['chicken', 1], ['pig', 1], ['rabbit', 1]],
  dark_forest: [['deer', 1], ['pig', 1]],
  cherry_grove: [['sheep', 2], ['rabbit', 2], ['deer', 1]],
  taiga: [['deer', 3], ['rabbit', 2], ['sheep', 1]],
  giant_taiga: [['deer', 2], ['rabbit', 1]],
  snowy_taiga: [['rabbit', 2], ['deer', 1], ['polar_bear', 1]],
  snow: [['rabbit', 2], ['polar_bear', 1]],
  mountains: [['goat', 3], ['sheep', 1]],
  desert: [['camel', 2], ['rabbit', 1]],
  badlands: [['camel', 1]],
  savanna: [['cow', 2], ['chicken', 1], ['camel', 1]],
  jungle: [['parrot', 3], ['chicken', 1], ['pig', 1]],
  bamboo_jungle: [['parrot', 2], ['pig', 1]],
  swamp: [['frog', 3], ['pig', 1]],
  mushroom_fields: [['cow', 1]],
};

export const isAnimal = s => s?.npc?.kind === 'animal';

// ---- Their looks (animalart.js, online too: the roster carries it as their skin) ------------------

/** An animal's look, as text: its type, and .s (shorn), .b (young), .N (which of its colours). */
export function lookOf(n) {
  return `${n.type}${n.shorn ? '.s' : ''}${n.baby != null ? '.b' : ''}${n.variant ? `.${n.variant}` : ''}`;
}
/** A look from its text: { type, shorn, baby, variant }. */
export function parseLook(text) {
  const [type, ...flags] = String(text || '').split('.');
  let variant = 0;
  for (const f of flags) if (/^\d$/.test(f)) variant = +f;
  return { type: ANIMALS[type] ? type : 'cow', shorn: flags.includes('s'), baby: flags.includes('b'), variant };
}
/** After an animal's changed (sheared, grown up): its look again (the roster's skin: everyone's told). */
function relook(s) { s.skin = lookOf(s.npc); }

/** An animal of `type`, to appear at (x, y) (a body's middle) at the next update. o: { baby (born when), variant, kept }. */
export function spawnAnimal(game, type, x, y, o = {}) {
  const def = ANIMALS[type];
  const npc = { kind: 'animal', type, weapon: def.weapon || null, ...o };
  const hp = Math.round(def.health * (o.baby != null ? 0.5 : 1));
  const s = game.addSoldier({ name: def.name, isBot: true, team: 0, skin: lookOf(npc), maxHealth: hp, profile: { npc } }, new AnimalController(type));
  s.respawnTimer = 1;
  s.npc.spawnAt = { x, y };
  return s;
}

/** What animal s gives when it's killed (by: the player who did it): meat (cooked, if it burnt), leather... drop(key, n) (where it fell). */
export function animalDrops(game, s, by, drop) {
  const def = ANIMALS[s.npc.type], rng = game.rng;
  // (A young one gives nothing.)
  if (!def || s.npc.baby != null) return;
  const burnt = ['Flamer', 'PetrolBomb', 'Magma', 'FirePunch', 'NapalmStrike'].includes(s.lastHurtWeapon);
  for (const [key, lo, hi, chance = 1] of def.drops) {
    if (key === 'wool' && s.npc.shorn) continue;
    if (rng() >= chance) continue;
    const n = lo + Math.floor(rng() * (hi - lo + 1));
    if (n > 0) drop(burnt ? COOKED[key] || key : key, n);
  }
  if (by?.world) { giveXp(game, by, def.xp, def.name); countStat(by, 'hunted'); }
}
const COOKED = { raw_beef: 'steak', raw_pork: 'cooked_pork', raw_mutton: 'cooked_mutton', raw_chicken: 'cooked_chicken', raw_venison: 'cooked_venison', raw_rabbit: 'cooked_rabbit', raw_fish: 'cooked_fish', crab_meat: 'cooked_crab' };

// ---- Shearing, feeding, breeding (a player's click: survival.js) --------------------------------------

/** The animal at (x, y) (a point in pixels: the crosshair), within reach of player s, or null. */
export function animalAt(game, s, x, y, reach) {
  let best = null, bd = Infinity;
  for (const o of game.soldiers) {
    if (!o.alive || !isAnimal(o)) continue;
    // (Its body's box, a little bigger: animals are smaller than people.)
    if (x < o.x - BODY.halfW - 6 || x > o.x + BODY.halfW + 6 || y < o.y + BODY.crouchTop - 8 || y > o.y + BODY.bottom + 2) continue;
    // (In reach of them; the one nearest the point.)
    if (Math.hypot(o.x - s.x, o.y - s.y) > reach) continue;
    const d = Math.hypot(o.x - x, o.y - 2 - y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

const REGROW = 60 * 60 * 2;   // a sheared sheep's wool grows back in two minutes
const IN_LOVE = 60 * 12;      // fed, an animal looks for a mate this long
const BRED_WAIT = 60 * 60 * 3; // and breeds again after this long
const GROWN = 60 * 60 * 4;    // a young one grows up in four minutes

/** Shear animal a (a sheep, with its wool): drop(key, n, x, y) gives the wool. True if it was sheared. */
export function shear(game, a, drop) {
  if (!ANIMALS[a.npc.type]?.shear || a.npc.shorn || a.npc.baby != null) return false;
  a.npc.shorn = game.tick;
  relook(a);
  drop('wool', 1 + Math.floor(game.rng() * 3), a.x, a.y - 8);
  game.sound('baa', a.x, a.y);
  return true;
}

/** Whether `key` is what animal a eats (what it follows, and breeds when fed). */
export const eats = (a, key) => !!ANIMALS[a.npc.type]?.food?.includes(key);

/** Player s feeds animal a: it looks for a mate a while (a young one grows up quicker). True if it ate. */
export function feedAnimal(game, s, a) {
  const n = a.npc, t = game.tick;
  if (n.baby != null) { n.baby -= GROWN / 10; n.kept = true; game.fx?.sparks?.(a.x, a.y - 8, 0, -1); return true; }
  if ((n.love || 0) > t || t - (n.bredAt ?? -1e9) < BRED_WAIT) return false;
  n.love = t + IN_LOVE;
  n.lovedBy = s.id;
  n.kept = true;
  game.fx?.sparks?.(a.x, a.y - 8, 0, -1);
  return true;
}

// ---- Coming and going -----------------------------------------------------------------------------------

const ANIMAL_EVERY = 40;  // updates between looks round (offset from the monsters' and townsfolk's)
const NEAR = 64;          // tiles round a player counted as theirs
const GONE = 110;         // tiles from every player an animal goes at (fed or young: KEPT_GONE)
const KEPT_GONE = 220;
const MOST_NEAR = 8;      // land animals near a player, at most (and fish)
const MOST_FISH = 5;
const MOST = 40;          // in the world, at most
const BUILT_WALLS = new Set(WALLS.filter(w => w.id !== NO_WALL && !w.natural).map(w => w.id));

/** The animals' own dice (the game's aren't used up: what else happens stays as it was). */
function dice(world) {
  if (world.critterSeed === undefined) world.critterSeed = (world.seed ^ 0x5eed1e) >>> 0;
  world.critterSeed = (Math.imul(world.critterSeed, 1664525) + 1013904223) >>> 0;
  return world.critterSeed / 4294967296;
}

/**
 * Animals come and go (the world mode's tick; the host's): the dead go, those far from everyone
 * go, young ones grow up, sheared wool grows back, chickens lay, mates are found; and by day, near
 * each player on the surface, a herd now and then (and fish in the water).
 */
export function animalsTick(game, drop) {
  if (game.mirror || game.tick % ANIMAL_EVERY !== 25) return;
  const world = game.world, gen = world.gen, t = game.tick;
  const players = game.soldiers.filter(s => s.alive && s.world && !s.npc);
  let all = 0;
  for (const s of [...game.soldiers]) {
    if (!isAnimal(s)) continue;
    if (!s.alive) {
      if (s.npc.spawned && t - (s.npc.diedAt ?? t) > 180) game.removeSoldier(s);
      else if (!s.npc.spawned) all++;
      continue;
    }
    let near = Infinity;
    for (const p of players) near = Math.min(near, Math.max(Math.abs(p.x - s.x), Math.abs(p.y - s.y)) / TILE);
    // (Far from everyone, they sleep where they are, sleepers.js: not let go.)
    if (near > (s.npc.kept ? KEPT_GONE : GONE) && !sleeps(s)) { game.removeSoldier(s); continue; }
    all++;
    lifeTick(game, s, drop, near);
  }
  mates(game);
  if (all >= MOST || !gen) return;
  const day = nightness(world.time || 0) < 0.5;
  for (const p of players) {
    const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
    // (Not underground.)
    if (pty - gen.surfaceAt(ptx) > 16) continue;
    // (Those asleep round here count too, sleepers.js: they'll be about again, not more come besides.)
    const asleep = water => asleepNear(world, p.x, p.y, NEAR * TILE, NEAR * TILE, r => r.kind === 'animal' && !!ANIMALS[r.type]?.aquatic === water);
    let land = asleep(false), fish = asleep(true);
    for (const s of game.soldiers) {
      if (!isAnimal(s)) continue;
      const x = s.alive ? s.x : s.npc.spawnAt?.x ?? 0, y = s.alive ? s.y : s.npc.spawnAt?.y ?? 0;
      if (Math.abs(x - p.x) > NEAR * TILE || Math.abs(y - p.y) > NEAR * TILE) continue;
      if (ANIMALS[s.npc.type].aquatic) fish++; else land++;
    }
    if (day && land < MOST_NEAR && dice(world) < 0.3) all += herd(game, ptx, false);
    if (fish < MOST_FISH && dice(world) < 0.25) all += herd(game, ptx, true);
    if (all >= MOST) break;
  }
}

/** A herd of animals (or a shoal of fish) somewhere out of sight of a player in column ptx. Returns how many. */
function herd(game, ptx, water) {
  const world = game.world, gen = world.gen;
  const side = dice(world) < 0.5 ? -1 : 1, tx = ptx + side * (34 + Math.floor(dice(world) * 26));
  // (Not in towns: there are none there.)
  if (gen.townNear?.(tx, 20)) return 0;
  const biome = gen.biomeAt(tx), surf = gen.surfaceAt(tx);
  let type = null;
  if (water) type = 'fish';
  else {
    // (A beach, by the sea: crabs, now and then.)
    const top = standRow(world, tx, surf);
    if (top == null) return 0;
    const beach = world.tile(tx, top + 1) === K.SAND && (biome.sea || gen.biomeAt(tx - 16).sea || gen.biomeAt(tx + 16).sea);
    const list = beach && dice(world) < 0.6 ? [['crab', 1]] : LIVES[biome.key];
    if (!list) return 0;
    let r = dice(world) * list.reduce((n, [, w]) => n + w, 0);
    for (const [k, w] of list) { r -= w; if (r <= 0) { type = k; break; } }
    type ||= list[0][0];
  }
  const def = ANIMALS[type], n = def.herd[0] + Math.floor(dice(world) * (def.herd[1] - def.herd[0] + 1));
  // (Fish: warm seas' are bright, tropical ones.)
  const variant = type === 'fish' ? (biome.coral ? 2 + Math.floor(dice(world) * 2) : Math.floor(dice(world) * 2)) : type === 'parrot' ? Math.floor(dice(world) * 3) : 0;
  let made = 0;
  for (let i = 0; i < n; i++) {
    const x = tx + i * (2 + Math.floor(dice(world) * 2)) * side;
    const row = water ? waterRow(world, x, gen.surfaceAt(x)) : standRow(world, x, gen.surfaceAt(x));
    if (row == null) continue;
    spawnAnimal(game, type, x * TILE + TILE / 2, (row + 1) * TILE - BODY.bottom - 1, variant ? { variant } : {});
    made++;
  }
  return made;
}

/** Where an animal can stand in column tx near the ground (surf: the land's top): its feet's row, or null. */
function standRow(world, tx, surf) {
  for (let ty = surf - 8; ty <= surf + 4; ty++) {
    if (ty < 3 || ty >= WORLD_H - 2) continue;
    const below = world.tile(tx, ty + 1);
    if (!SOLID[below] && !PLATFORMS[below]) continue;
    const at = world.tile(tx, ty);
    if (SOLID[at] || LIQUID[at] || SOLID[world.tile(tx, ty - 1)]) continue;
    // (Not in someone's house.)
    if (BUILT_WALLS.has(world.wall(tx, ty))) return null;
    return ty;
  }
  return null;
}

/** Where a fish can swim in column tx (water at least four deep): its feet's row, or null. */
function waterRow(world, tx, surf) {
  let top = -1;
  for (let ty = Math.max(1, surf - 60); ty <= Math.min(WORLD_H - 2, surf + 4); ty++) if (world.tile(tx, ty) === K.WATER) { top = ty; break; }
  if (top < 0) return null;
  let d = 0;
  while (d < 12 && world.tile(tx, top + d) === K.WATER) d++;
  return d >= 4 ? top + Math.min(d - 1, 3) : null;
}

/** Each animal, now and then: young ones grow up, wool grows back, chickens lay, love wears off, a sound. */
function lifeTick(game, s, drop, near) {
  const n = s.npc, t = game.tick, world = game.world;
  if (n.baby != null && t - n.baby > GROWN) { n.baby = null; s.maxHealth = ANIMALS[n.type].health; relook(s); }
  if (n.shorn && t - n.shorn > REGROW) { n.shorn = null; relook(s); }
  if (ANIMALS[n.type].eggs && n.baby == null) {
    n.eggAt ??= t + 60 * 60 * (4 + dice(world) * 4);
    if (t >= n.eggAt) { drop('egg', 1, s.x, s.y + 4); n.eggAt = t + 60 * 60 * (4 + dice(world) * 4); }
  }
  if (n.love && n.love < t) n.love = null;
  const snd = ANIMALS[n.type].sound;
  if (snd && near < 14 && dice(world) < 0.04) game.sound(snd, s.x, s.y);
}

/** Two of a kind in love near each other: a young one between them. */
function mates(game) {
  const t = game.tick, keen = game.soldiers.filter(s => s.alive && isAnimal(s) && s.npc.love > t);
  for (let i = 0; i < keen.length; i++) {
    const a = keen[i];
    if (!(a.npc.love > t)) continue;
    for (let j = i + 1; j < keen.length; j++) {
      const b = keen[j];
      if (!(b.npc.love > t) || b.npc.type !== a.npc.type || Math.abs(a.x - b.x) > 5 * TILE || Math.abs(a.y - b.y) > 3 * TILE) continue;
      a.npc.love = b.npc.love = null;
      a.npc.bredAt = b.npc.bredAt = t;
      const young = spawnAnimal(game, a.npc.type, (a.x + b.x) / 2, Math.min(a.y, b.y), { baby: t, kept: true, variant: a.npc.variant || 0 });
      const by = game.soldiers.find(o => o.id === a.npc.lovedBy && o.world && !o.npc);
      if (by) { giveXp(game, by, 3, `A young ${ANIMALS[a.npc.type].name.toLowerCase()}`); countStat(by, 'bred'); }
      game.fx?.sparks?.(young.npc.spawnAt.x, young.npc.spawnAt.y - 8, 0, -1);
      break;
    }
  }
}

// ---- How they behave ----------------------------------------------------------------------------------------

/** The players holding (in either hand) something animal type `def` eats, within r tiles of s: the nearest, or null. */
function lure(game, s, def, r) {
  if (!def.food?.length) return null;
  let best = null, bd = Infinity;
  for (const p of game.soldiers) {
    if (!p.alive || !p.world || p.npc) continue;
    const w = p.world, a = w.inv?.slots[w.slot]?.key, b = w.slot2 >= 0 ? w.inv?.slots[w.slot2]?.key : null;
    if (!def.food.includes(a) && !def.food.includes(b)) continue;
    const d = Math.abs(p.x - s.x) + Math.abs(p.y - s.y);
    if (d < r * TILE && Math.abs(p.y - s.y) < 4 * TILE && d < bd) { bd = d; best = p; }
  }
  return best;
}

/** What pens animals in: fences and posts (people walk through them; animals don't). */
const PENS = new Set([K.FENCE, K.POST]);

/** What's ahead of a land animal at s going dir (further: px more): 'ok', 'jump' (a step up), or 'stop' (a wall, a fence, deep water, a drop). */
function ahead(world, s, dir, further = 0) {
  const fx = Math.floor((s.x + dir * (BODY.halfW + 4 + further)) / TILE), feet = Math.floor((s.y + BODY.bottom - 1) / TILE);
  if (PENS.has(world.tile(fx, feet)) || PENS.has(world.tile(fx, feet - 1))) return 'stop';
  if (SOLID[world.tile(fx, feet)]) return !SOLID[world.tile(fx, feet - 1)] && !SOLID[world.tile(fx, feet - 2)] && !SOLID[world.tile(Math.floor(s.x / TILE), feet - 2)] ? 'jump' : 'stop';
  // (Into water: only the shallows.)
  if (!s.body.swimming && (LIQUID[world.tile(fx, feet)] || LIQUID[world.tile(fx, feet + 1)])) {
    // (From the water's top: where the feet would be, or under them.)
    const top = LIQUID[world.tile(fx, feet)] ? feet : feet + 1;
    let deep = 0;
    while (deep < 3 && LIQUID[world.tile(fx, top + deep)]) deep++;
    if (deep >= 2) return 'stop';
  }
  // (Off an edge: a few blocks down at most.)
  let drop = 0;
  while (drop < 4 && !SOLID[world.tile(fx, feet + 1 + drop)] && !PLATFORMS[world.tile(fx, feet + 1 + drop)] && !LIQUID[world.tile(fx, feet + 1 + drop)]) drop++;
  return drop >= 4 ? 'stop' : 'ok';
}

export class AnimalController {
  constructor(type) {
    this.type = type;
    this.def = ANIMALS[type];
    this.dir = 0;        // which way it's wandering (0: grazing)
    this.until = 0;      // till when
    this.panic = 0;      // updates left running away
    this.away = 1;       // which way
    this.hurtAt = null;  // the last hurt it's seen
    this.jumpNext = false;
    this.stuck = 0;
    this.lastX = 0;
    this.lure = null;
    this.mate = null;
    this.r = 0;
  }

  /** Its own dice (not the game's). */
  rand() {
    this.r = (Math.imul(this.r, 1664525) + 1013904223) >>> 0;
    return this.r / 4294967296;
  }

  input(game, s) {
    const inp = { move: 0, jump: false, jumpPressed: false, crouch: false, fire: false, firePressed: false, aim: s.aim, aimDist: 60 };
    const def = this.def, n = s.npc, world = game.world, t = game.tick, b = s.body;
    if (!this.r) this.r = ((s.id + 1) * 2654435761 + t) >>> 0 || 1;
    // Hurt (just now: a soldier starts with a time long ago): run (a polar bear goes for whoever did it).
    if (s.lastHurtTick != null && s.lastHurtTick !== this.hurtAt && t - s.lastHurtTick < 10) {
      const by = s.lastHurtBy;
      if (def.fights && by?.alive && !by.npc) { n.angry = by.id; n.angryUntil = t + 900; }
      else { this.panic = 200 + this.rand() * 160; this.away = by ? Math.sign(s.x - by.x) || 1 : this.rand() < 0.5 ? -1 : 1; }
    }
    this.hurtAt = s.lastHurtTick;
    if (def.aquatic) return this.swim(game, s, inp);
    let dir = 0, speed = def.walk, run = false;
    const foe = n.angry != null ? game.soldiers.find(o => o.id === n.angry) : null;
    if (n.angry != null && (!foe?.alive || t > n.angryUntil || Math.abs(foe.x - s.x) > 30 * TILE || Math.abs(foe.y - s.y) > 12 * TILE)) n.angry = null;
    if (n.angry != null && foe) {
      // After them, and hitting them when they're in reach.
      const dx = foe.x - s.x, dy = foe.y - s.y;
      inp.aim = Math.atan2(foe.y - 14 - s.shoulderY, foe.x - s.shoulderX);
      if (Math.abs(dx) < 28 && Math.abs(dy) < 30) { inp.fire = true; inp.firePressed = true; }
      dir = Math.abs(dx) > 12 ? Math.sign(dx) : 0;
      speed = def.run;
      run = true;
    } else if (this.panic > 0) {
      this.panic--;
      dir = this.away;
      speed = def.run;
      run = true;
    } else {
      // Now and then: who's holding its food, its mate, people too close (a shy one runs).
      if ((t + s.id) % 20 === 0) {
        this.lure = lure(game, s, def, 9);
        this.mate = n.love > t ? game.soldiers.find(o => o !== s && o.alive && isAnimal(o) && o.npc.type === n.type && o.npc.love > t && Math.abs(o.x - s.x) < 14 * TILE) || null : null;
        if (def.shy && !this.lure) {
          const p = game.soldiers.find(o => o.alive && o.world && !o.npc && !o.body.crouching && Math.abs(o.x - s.x) < 5 * TILE && Math.abs(o.y - s.y) < 3 * TILE);
          if (p) { this.panic = 90 + this.rand() * 90; this.away = Math.sign(s.x - p.x) || 1; }
        }
      }
      const to = this.mate || this.lure;
      if (to) {
        const dx = to.x - s.x;
        dir = Math.abs(dx) > (this.mate ? 1 : 2.5) * TILE ? Math.sign(dx) : 0;
        if (!dir) inp.aim = dx < 0 ? Math.PI : 0;
      } else {
        if (t >= this.until) {
          const r = this.rand();
          this.dir = r < 0.3 ? -1 : r < 0.6 ? 1 : 0;
          this.until = t + 90 + this.rand() * (this.dir ? 220 : 320);
        }
        dir = this.dir;
      }
    }
    // What's ahead: a step's jumped; a wall, deep water or a drop turns it round.
    if (dir && !b.swimming) {
      const way = ahead(world, s, dir);
      if (way === 'stop') {
        if (this.panic > 0) this.away = -this.away;
        else if (!this.lure && !this.mate && n.angry == null) { this.dir = -dir; this.until = t + 60 + this.rand() * 120; }
        dir = n.angry != null || this.panic > 0 ? -dir : 0;
        if (dir && ahead(world, s, dir) === 'stop') dir = 0;
      } else if (way === 'jump') this.jumpNext = true;
    }
    // Hoppers hop as they go along (running, they just run): not into water, nor off an edge (a hop goes a way).
    if (dir && def.hops && !run && b.onGround && (t + s.id) % 22 === 0 && ahead(world, s, dir, 2 * TILE) !== 'stop' && ahead(world, s, dir, TILE) !== 'stop') this.jumpNext = true;
    // Stuck against something (going but not getting anywhere): a jump, then the other way.
    if (dir && b.onGround) {
      this.stuck = Math.abs(s.x - this.lastX) < 0.08 ? this.stuck + 1 : 0;
      if (this.stuck === 12) this.jumpNext = true;
      if (this.stuck > 40) { this.stuck = 0; this.dir = -this.dir; this.away = -this.away; }
    } else this.stuck = 0;
    this.lastX = s.x;
    // Low to the ground (crouched: the smaller target an animal is), but for running and jumping
    // (standing a moment first: a crouched body can't jump).
    if (this.jumpNext && b.onGround) {
      if (b.crouching) inp.crouch = false;
      else { inp.jump = inp.jumpPressed = true; this.jumpNext = false; }
    } else inp.crouch = !run && !b.swimming && b.onGround;
    // In the water by mistake: kept afloat, for the bank.
    if (b.swimming) { inp.crouch = false; inp.jump = true; if (!dir) dir = this.away; }
    inp.move = dir * speed;
    if (dir && n.angry == null) inp.aim = dir < 0 ? Math.PI : 0;
    return inp;
  }

  /** A fish: about in the water (under its top, over the bed), and away when hurt; out of it, flapping, it can't breathe. */
  swim(game, s, inp) {
    const world = game.world, b = s.body, t = game.tick;
    if (!b.swimming) {
      if (b.onGround && (t + s.id) % 30 === 0) { inp.jump = inp.jumpPressed = true; inp.move = this.rand() < 0.5 ? -0.6 : 0.6; }
      if ((t + s.id) % 30 === 0 && s.health > 0) { s.health -= 2; if (s.health <= 0) game.kill(s, null, null); }
      return inp;
    }
    if (t >= this.until) {
      const r = this.rand();
      this.dir = r < 0.4 ? -1 : r < 0.8 ? 1 : 0;
      this.vert = this.rand() < 0.5 ? -1 : 1;
      this.until = t + 60 + this.rand() * 160;
    }
    let dir = this.panic > 0 ? this.away : this.dir;
    if (this.panic > 0) this.panic--;
    // (Kept in the water: what's ahead must be water too.)
    if (dir && !world.liquidAt(s.x + dir * (BODY.halfW + 8), s.y - 4)) { dir = -dir; this.dir = dir; this.away = -this.away; }
    // Up and down: down from near the top, up from near the bed; between, a little each way.
    const headWet = world.liquidAt(s.x, s.y + BODY.top - 10);
    const bed = SOLID[world.tile(Math.floor(s.x / TILE), Math.floor((s.y + BODY.bottom + 10) / TILE))];
    if (!headWet) inp.crouch = true;
    else if (bed) inp.jump = true;
    else if ((t + s.id) % 50 < 25) { inp.crouch = this.vert > 0; inp.jump = this.vert < 0; }
    inp.move = dir * (this.panic > 0 ? this.def.run : this.def.walk) * 1.6;
    if (dir) inp.aim = dir < 0 ? Math.PI : 0;
    return inp;
  }

  /** (No moment of not being hurt as it appears, as soldiers have: it's only an animal.) */
  onSpawn(game, s) { s.spawnProtect = 0; }

  onDeath(game, s) { s.npc.diedAt = game.tick; }
}

/** All the animals gone (a test starting over, say). */
export function clearAnimals(game) {
  for (const s of game.soldiers.filter(isAnimal)) game.removeSoldier(s);
}
