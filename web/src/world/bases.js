// Bases (world mode): a base flag claims the blocks round it for whoever put it up, and for their
// party (social.js). The flag is the base's core: it has health, and a stronghold charter raises
// the base a level (a wider claim, a tougher flag). Nobody else can build, dig or open chests in a
// base, nor do blasts break it, unless the world lets bases be raided (worldrules.js's raiding:
// never, only while one of a base's side is in the world, only at night, or any time; never with
// PvP off). A base open to a raid can be broken into: its walls take three times as long to dig
// (reinforced bricks and iron doors not at all: only a battering ram or a siege charge breaks
// those), its flag can be hit, and blasts break its blocks. Its chests stay locked till its flag
// falls; then the base is anyone's (chests and all) till its side mends the flag with a builder's
// hammer. A fallen flag's turrets stop till then too (with PvP off, or raiding off, a flag brought
// down by monsters only does that: the base stays its side's).
//
// Defences, in your own base only: turrets shoot monsters (and, with PvP on, other players who come
// into the base) with the arrows or bullets they're loaded with, or take from a chest beside them;
// spikes hurt whoever walks through them, and a pressure mine blows up under them (never the base's
// own side); an alarm bell tells the base's side when it's attacked, wherever they are. Iron doors
// in a base open only for its side.
//
// And at night, now and then, the dead come for a base someone's in (the world's base raids): they
// break through what's in their way and go for the flag. Beaten, they're worth coins and experience
// to whoever fought; a flag they bring down falls.
//
// For one player or many: online, the host does it all. The bases go to everyone with the claims
// (worldnet.js: claimsToSave's rows, kept in saves too); turrets' shots and siege charges are
// projectiles like any others.

import * as K from './blocks.js';
import { BLOCKS, TILE, AIR, SOLID, LIQUID, PLATFORMS } from './blocks.js';
import { BODY, MOTION } from '../config.js';
import { WEAPONS } from '../weapons.js';
import { spawn, explode, damage } from '../combat.js';
import { spawnMonster, isNight, hourOf, isHostile } from './monsters.js';
import { settingOf, difficultyOf } from './worldrules.js';
import { giveXp, progOf, countStat } from './progress.js';
import { startAct } from '../useanim.js';
import { exert } from './hunger.js';

// ---- Bases and who they're for -------------------------------------------------------------------

/** A base's levels (a stronghold charter raises it one): how far it claims round its flag (tiles, each way), and its flag's health. */
export const BASE_LEVELS = [null, { r: 20, hp: 1000 }, { r: 28, hp: 2500 }, { r: 36, hp: 5000 }];
/** How far a new base claims round its flag. */
export const CLAIM_R = BASE_LEVELS[1].r;
export const levelOf = c => Math.max(1, Math.min(3, c?.level | 0 || 1));
export const radiusOf = c => BASE_LEVELS[levelOf(c)].r;
export const maxHpOf = c => BASE_LEVELS[levelOf(c)].hp;

const PICK_CORE = 2;          // a pickaxe's (or axe's) hit on a flag: its power times this
const RAM_CORE = 30;          // a battering ram's
const RAM_POWER = 8;          // a battering ram's hit on a built block (a pickaxe's power: 1 to 4.4); on the land's own, 1.5
const RAM_EVERY = 30;         // updates between its swings
const WALL_SHARE = 1 / 3;     // how much of a hit counts on a raided base's built blocks
const REPAIR_HP = 25;         // a builder's hammer's hit, mending your flag (using up one of REPAIR_WITH)
const REPAIR_WITH = ['stone_bricks', 'cobblestone', 'stone', 'bricks', 'planks'];
const RAISE_AT = 0.25;        // a fallen flag's raised again once it's mended this far
const CALM = 60 * 10;         // world time since it was last hit before a flag can be mended
const ALARM_EVERY = 60 * 20;  // updates between alarms
const HIT_SHOWN = 60 * 8;     // world time a flag's shown as under attack after a hit
const NEAR_BASE = 90;         // tiles from a base its side hears it attacked without a bell

const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const keyOf = (tx, ty) => `${tx},${ty}`;
/** Whether block id is a base's flag (standing, or fallen). */
export const isFlag = id => id === K.CLAIM_FLAG || id === K.FLAG_DOWN;
// What a raid can't dig through (only a ram or a charge breaks them), and what stays shut till a flag falls.
const TOUGH = new Set([K.REINFORCED, K.IRON_DOOR, K.IRON_DOOR_OPEN]);
const LOCKED = new Set([K.CHEST, ...K.SHULKER_BOXES]);

/** The base covering tile (tx, ty) ({ tx, ty, owner, level, hp, down, open }), or null. */
export function claimAt(world, tx, ty) {
  for (const c of world.claims?.values() || []) {
    const r = radiusOf(c);
    if (Math.abs(c.tx - tx) <= r && Math.abs(c.ty - ty) <= r) return c;
  }
  return null;
}

/** The base whose flag is at (tx, ty), or null. */
export const baseOfFlag = (world, tx, ty) => world.claims?.get(keyOf(tx, ty)) || null;

/** Whether `name` is on base c's side: its owner, or in a party with them (social.js's parties: the host's). */
export function onSide(world, c, name) {
  if (!c || name == null) return false;
  if (sameName(c.owner, name)) return true;
  for (const p of world.parties?.values() || []) {
    if (p.members.some(n => sameName(n, c.owner)) && p.members.some(n => sameName(n, name))) return true;
  }
  return false;
}

/** Who soldier s counts as, for a base: themselves; a mercenary, whoever hired them; anything else, nobody. */
function nameFor(game, s) {
  if (s?.npc?.kind === 'merc') return game.soldiers.find(o => o.id === s.npc.owner)?.name ?? null;
  return s && !s.npc ? s.name : null;
}

/** Whether base c's under attack (hit lately): the host knows when it was; everyone else is told (claimsFromSave's c.alarm). */
export function underAttack(world, c) {
  const now = world.time || 0;
  return !!c.alarm || (c.hitAt != null && now >= c.hitAt && now - c.hitAt < HIT_SHOWN);
}

/** Whether players can raid bases in `world` at all: PvP on, and its raiding setting not off. */
export const raidsAllowed = world => !!world && world.pvp !== false && settingOf(world, 'raiding') !== 'off';
/** Whether base c has fallen where players raid: anyone's, till its side mends its flag. */
export const fallen = (world, c) => !!c?.down && raidsAllowed(world);

/** The players on base c's side in the world now. */
const sidePlayers = (game, c) => game.soldiers.filter(o => o.world && !o.npc && onSide(game.world, c, o.name));

/** Whether base c is open to a raid now (worked out every half second, as c.open: basesTick). */
function openNow(game, c) {
  const world = game.world;
  if (c.down || !raidsAllowed(world)) return false;
  const rule = settingOf(world, 'raiding');
  if (rule === 'anytime') return true;
  if (rule === 'night') return isNight(world.time || 0);
  return sidePlayers(game, c).length > 0;
}

// ---- What others can do in a base ----------------------------------------------------------------

/** Whether soldier s may change tile (tx, ty) as they please (dig, build, open a chest): not in a town, nor someone else's standing base. */
export function mayChange(world, s, tx, ty) {
  if (!s) return true;
  if (world.gen?.townProtecting(tx, ty)) return false;
  if (!world.claims?.size) return true;
  const c = claimAt(world, tx, ty);
  return !c || onSide(world, c, s.name) || fallen(world, c);
}

/** Whether soldier s may put `it` at (tx, ty): where they may change it, or blocks and walls in a base open to a raid (a ladder over its wall...). */
export function mayBuild(world, s, tx, ty, it) {
  if (mayChange(world, s, tx, ty)) return true;
  if (world.gen?.townProtecting(tx, ty) || !claimAt(world, tx, ty)?.open) return false;
  const id = it?.block;
  return it?.kind === 'wall' || (id != null && (!!SOLID[id] || !!PLATFORMS[id] || id === K.LADDER || id === K.TORCH) && !TOUGH.has(id));
}

/**
 * How much of a hit by soldier s counts on block id at (tx, ty): 1 (as anywhere), a share (a
 * raided base's walls hold), or 0 (not at all: someone else's base, its flag, its chests, what
 * only siege tools break).
 */
export function digShare(world, s, tx, ty, id) {
  if (mayChange(world, s, tx, ty)) return 1;
  if (world.gen?.townProtecting(tx, ty)) return 0;
  const c = claimAt(world, tx, ty);
  if (!c?.open || isFlag(id) || TOUGH.has(id) || LOCKED.has(id)) return 0;
  return BLOCKS[id].natural ? 1 : WALL_SHARE;
}

/** Whether soldier s (or a mercenary: whoever hired them) can open the iron door at (tx, ty): in a base, only its side. */
export function mayUnlock(game, s, tx, ty) {
  const world = game.world, c = world.claims?.size ? claimAt(world, tx, ty) : null;
  return !c || onSide(world, c, nameFor(game, s)) || fallen(world, c);
}

/** Why soldier s can't do that at (tx, ty) (what's there: id), in a few words. */
export function whyNot(world, s, tx, ty, id = world.tile(tx, ty)) {
  const town = world.gen?.townProtecting(tx, ty);
  if (town) return `You can't dig or build in ${town.name}`;
  const c = claimAt(world, tx, ty);
  if (!c) return 'You can\'t do that here';
  if (!c.open) return `That's ${c.owner}'s base${raidsAllowed(world) ? ` (${closedWhy(world)})` : ''}`;
  if (TOUGH.has(id)) return `${BLOCKS[id].name}: only a battering ram or a siege charge breaks it`;
  if (LOCKED.has(id)) return `${c.owner}'s chests stay locked till their flag falls`;
  if (isFlag(id)) return `${c.owner}'s flag: hit it to bring it down`;
  return `That's ${c.owner}'s base`;
}
const closedWhy = world => ({ online: 'raided only while they\'re here', night: 'raided only at night' })[settingOf(world, 'raiding')] || 'not to be raided now';

/**
 * Whether a blast (or flowing water) leaves tile (tx, ty) alone (TileWorld's protect): a town, a
 * standing base not open to a raid; in one that is, its flag and chests. (world.blastGuard: a
 * trap's own blast, which breaks nothing.)
 */
export function shielded(world, tx, ty) {
  if (world.blastGuard) return true;
  if (world.gen?.townProtecting(tx, ty)) return true;
  if (!world.claims?.size) return false;
  const c = claimAt(world, tx, ty);
  if (!c || fallen(world, c)) return false;
  if (!c.open) return true;
  const id = world.tile(tx, ty);
  return isFlag(id) || LOCKED.has(id);
}

/** Why soldier s can't use siege tools at (tx, ty) (a town, a base that can't be raided now), or null if they can. */
export function siegeBlocked(world, s, tx, ty) {
  const town = world.gen?.townProtecting(tx, ty);
  if (town) return `Not in ${town.name}`;
  const c = claimAt(world, tx, ty);
  if (!c || onSide(world, c, s.name) || c.open || fallen(world, c)) return null;
  return raidsAllowed(world) ? `${c.owner}'s base is ${closedWhy(world)}` : `${c.owner}'s base can't be raided: ${world.pvp === false ? 'PvP is off' : 'raiding is off'} in this world`;
}

// ---- Putting up a base, and defences -------------------------------------------------------------

/** The base in the way of a base of claim r at (tx, ty) for soldier s (someone else's it would overlap), or null. except: a base not to count (one growing). */
export function inTheWay(world, s, tx, ty, r = CLAIM_R, except = null) {
  for (const c of world.claims?.values() || []) {
    if (c === except || sameName(c.owner, s.name)) continue;
    const reach = r + radiusOf(c);
    if (Math.abs(c.tx - tx) <= reach && Math.abs(c.ty - ty) <= reach) return c;
  }
  return null;
}

/** A base flag put up at (tx, ty) by soldier s: their base. */
export function newBase(game, s, tx, ty) {
  const c = { tx, ty, owner: s.name, level: 1, hp: BASE_LEVELS[1].hp, down: false, open: false };
  (game.world.claims ||= new Map()).set(keyOf(tx, ty), c);
  c.open = openNow(game, c);
  game.notify(s, `Your base: nobody else can build, dig or open chests within ${CLAIM_R} blocks of the flag${raidsAllowed(game.world) ? ' (unless it\'s raided: guard it, with turrets and traps)' : ''}`);
  return c;
}

/** Whether soldier s can put defence block id at (tx, ty): only in a base of their side's. */
export const defenceSpot = (world, s, tx, ty) => onSide(world, claimAt(world, tx, ty), s.name);

/** Defence block id put at (tx, ty) by soldier s (a turret starts empty). */
export function defencePut(game, s, tx, ty, id) {
  const world = game.world;
  if (K.TURRETS.has(id)) {
    (world.turrets ||= new Map()).set(keyOf(tx, ty), { tx, ty, ammo: 0, cool: 0 });
    const k = turretOf(id);
    game.notify(s, `${BLOCKS[id].name}: load it with ${k.ammo} (click it with them in hand), or put a chest of them beside it`);
  } else if (id === K.ALARM_BELL) game.notify(s, 'Alarm bell: when your base is attacked, you\'ll hear of it wherever you are');
}

/** Block id at (tx, ty) gone (broken, blown up, fallen): a flag's base goes with it; a turret drops what's left in it. */
export function baseBlockGone(game, tx, ty, id, h) {
  const world = game.world, key = keyOf(tx, ty);
  if (isFlag(id)) {
    world.claims?.delete(key);
    if (world.baseRaid?.key === key) endBaseRaid(game, 'gone');
  } else if (K.TURRETS.has(id)) {
    const t = world.turrets?.get(key);
    world.turrets?.delete(key);
    if (t?.ammo > 0) h.dropItem(game, turretOf(id).ammo, t.ammo, tx * TILE + 8, ty * TILE + 8);
  }
}

// ---- The flag: hit, falling, mended, raised a level --------------------------------------------------

/** Base c's flag hit for `amount` (by: who, if anyone). Returns true if it was (a fallen one isn't). */
export function hitCore(game, c, amount, by = null) {
  if (!c || c.down || !(amount > 0)) return false;
  const world = game.world, x = c.tx * TILE + 8, y = c.ty * TILE + 8;
  c.hp = Math.max(0, (c.hp ?? maxHpOf(c)) - amount);
  c.hitAt = world.time || 0;
  game.fx?.sparks?.(x, y - 4, 0, -1);
  game.sound('thunk', x, y);
  alarm(game, c, by);
  if (c.hp <= 0) fall(game, c, by);
  return true;
}

/** Base c's flag falls: open to anyone where players raid (its turrets stop till it's mended, anyway). */
function fall(game, c, by) {
  const world = game.world, x = c.tx * TILE + 8, y = c.ty * TILE + 8;
  c.down = true;
  c.hp = 0;
  c.open = false;
  if (world.tile(c.tx, c.ty) === K.CLAIM_FLAG) world.setTile(c.tx, c.ty, K.FLAG_DOWN);
  game.fx?.explosion?.(x, y, 10);
  game.sound('explosionSmall', x, y);
  const open = raidsAllowed(world);
  for (const o of sidePlayers(game, c)) {
    game.notify(o, open ? 'Your base has fallen! Anyone can take what\'s in it: mend its flag with a builder\'s hammer to raise it again'
      : 'Your base\'s flag has fallen: its turrets are down till you mend it (a builder\'s hammer)');
  }
  const p = by?.world && !by.npc ? by : null;
  if (p && !onSide(world, c, p.name)) {
    game.notify(p, `You brought down ${c.owner}'s base${open ? ': its chests are open' : ''}`);
    giveXp(game, p, 150, `${c.owner}'s base`);
  }
  if (world.baseRaid?.key === keyOf(c.tx, c.ty)) endBaseRaid(game, 'fell');
}

/** Tell player s something (once in a while: not for every swing). */
function tell(game, s, text) {
  const w = s.world;
  if (!w || game.tick - (w.toldClaim ?? -1e9) <= 90) return;
  w.toldClaim = game.tick;
  game.notify(s, text);
}

/** Player s mends their base's flag (c) with a builder's hammer (it): a stone, brick or plank a hit; fallen, it's raised again once it's mended enough. */
function mend(game, s, c, it) {
  const w = s.world, world = game.world, max = maxHpOf(c), x = c.tx * TILE + 8, y = c.ty * TILE + 8;
  if (w.cool > 0) return;
  w.cool = it.every / MOTION.timeScale;
  startAct(s, 'hammer', it.every);
  if ((world.time || 0) - (c.hitAt ?? -1e9) < CALM) { tell(game, s, 'Your base is under attack: no time to mend its flag'); return; }
  if (!c.down && (c.hp ?? max) >= max) { tell(game, s, `Your base's flag is in good repair (level ${levelOf(c)}: it can take ${max})`); return; }
  const key = REPAIR_WITH.find(k => w.inv.count(k) > 0);
  if (!key) { tell(game, s, 'Mending a flag takes stone, bricks or planks'); return; }
  w.inv.remove(key, 1);
  c.hp = Math.min(max, (c.hp || 0) + REPAIR_HP);
  exert(s, 0.02);
  game.sound('repair', x, y);
  game.fx?.sparks?.(x, y - 4, 0, -1);
  if (c.down && c.hp >= max * RAISE_AT) {
    c.down = false;
    if (world.tile(c.tx, c.ty) === K.FLAG_DOWN) world.setTile(c.tx, c.ty, K.CLAIM_FLAG);
    c.open = openNow(game, c);
    for (const o of sidePlayers(game, c)) game.notify(o, 'Your base\'s flag is raised again: it\'s yours to keep');
    game.sound('levelUp', null, null, s.id);
  }
}

/** Player s raises their base (c) a level with a stronghold charter (it). */
function charter(game, s, c, it) {
  const world = game.world, lv = levelOf(c);
  if (lv >= BASE_LEVELS.length - 1) { tell(game, s, 'Your base is as strong as a base gets'); return; }
  if (c.down) { tell(game, s, 'Raise your flag again first: mend it with a builder\'s hammer'); return; }
  const next = BASE_LEVELS[lv + 1], near = inTheWay(world, s, c.tx, c.ty, next.r, c);
  if (near) { tell(game, s, `Too near ${near.owner}'s base to grow`); return; }
  s.world.inv.remove(it.key, 1);
  c.hp = (c.hp ?? maxHpOf(c)) + next.hp - maxHpOf(c);
  c.level = lv + 1;
  startAct(s, 'show', 30);
  game.notify(s, `Your base is level ${c.level}: it claims ${next.r} blocks round its flag, and its flag can take ${next.hp}`);
  game.sound('levelUp', null, null, s.id);
  game.fx?.sparks?.(c.tx * TILE + 8, c.ty * TILE, 0, -1);
}

/** Base c attacked (by: who, if anyone): its side's told (wherever they are, with an alarm bell in it; else those near). */
export function alarm(game, c, by = null) {
  const world = game.world;
  c.hitAt = world.time || 0;
  if (game.tick - (c.alarmAt ?? -1e9) < ALARM_EVERY) return;
  c.alarmAt = game.tick;
  c.bell = hasBell(world, c);
  if (c.bell) game.sound('alarm', c.tx * TILE + 8, c.ty * TILE);
  const who = by?.npc?.kind === 'monster' ? 'Monsters are' : by?.name ? `${by.name} is` : 'Something is';
  for (const o of sidePlayers(game, c)) {
    const dx = c.tx - o.x / TILE, near = Math.abs(dx) < NEAR_BASE && Math.abs(c.ty - o.y / TILE) < NEAR_BASE;
    if (!c.bell && !near) continue;
    game.notify(o, `${who} attacking your base!${near ? '' : ` (the alarm bell: ${Math.round(Math.abs(dx))} blocks ${dx < 0 ? 'west' : 'east'})`}`);
    game.sound('alarm', null, null, o.id);
  }
}

/** Whether there's an alarm bell in base c. */
function hasBell(world, c) {
  const r = radiusOf(c);
  for (let y = c.ty - r; y <= c.ty + r; y++) {
    for (let x = c.tx - r; x <= c.tx + r; x++) if (world.has(x >> 5, y >> 5) && world.tile(x, y) === K.ALARM_BELL) return true;
  }
  return false;
}

/** Player s hits base c's flag (amount: how hard; every: updates till the next; act: how they swing). */
function strike(game, s, c, amount, every, act) {
  const w = s.world;
  if (w.cool > 0) return;
  w.cool = every / MOTION.timeScale;
  startAct(s, act, every);
  exert(s, 0.03);
  raider(game, s, c);
  hitCore(game, c, amount, s);
}

/** Player s at someone else's base c's flag: told (the first time) what bringing it down does. */
function raider(game, s, c) {
  const w = s.world, key = keyOf(c.tx, c.ty);
  if (w.raiding === key) return;
  w.raiding = key;
  game.notify(s, `Bring down ${c.owner}'s flag, and their chests are yours`);
}

// ---- Saved, and sent to everyone ----------------------------------------------------------------------

/**
 * A world's bases as saved (and as players online are sent them): [tx, ty, owner, level, health,
 * flags (1: fallen, 2: open to a raid, 4: under attack, 8: and its alarm bell's ringing), its
 * turrets ([tx, ty, ammo])].
 */
export function claimsToSave(world) {
  const turrets = new Map();
  for (const t of world.turrets?.values() || []) {
    const c = claimAt(world, t.tx, t.ty);
    if (!c) continue;
    if (!turrets.has(c)) turrets.set(c, []);
    turrets.get(c).push([t.tx, t.ty, Math.max(0, t.ammo | 0)]);
  }
  return [...(world.claims?.values() || [])].map(c => {
    const hot = underAttack(world, c);
    const flags = (c.down ? 1 : 0) | (c.open ? 2 : 0) | (hot ? 4 : 0) | (hot && c.bell ? 8 : 0);
    return [c.tx, c.ty, c.owner, levelOf(c), Math.round(c.hp ?? maxHpOf(c)), flags, turrets.get(c) || []];
  });
}

/** A world's bases from a save (or the host): older saves' [tx, ty, owner] are level 1, their flags whole. */
export function claimsFromSave(world, list) {
  world.claims = new Map();
  world.turrets = new Map();
  if (!Array.isArray(list)) return;
  for (const row of list) {
    if (!Array.isArray(row) || !Number.isInteger(row[0]) || !Number.isInteger(row[1]) || typeof row[2] !== 'string') continue;
    const c = { tx: row[0], ty: row[1], owner: row[2].slice(0, 14), level: Math.max(1, Math.min(3, row[3] | 0 || 1)) };
    const f = row[5] | 0;
    c.hp = Number.isFinite(row[4]) ? Math.max(0, Math.min(maxHpOf(c), row[4])) : maxHpOf(c);
    c.down = !!(f & 1);
    c.open = !!(f & 2);
    // (Shown on players' screens: under attack, and the alarm ringing.)
    c.alarm = !!(f & 4);
    c.bell = !!(f & 8);
    world.claims.set(keyOf(c.tx, c.ty), c);
    for (const t of Array.isArray(row[6]) ? row[6].slice(0, 64) : []) {
      if (Array.isArray(t) && Number.isInteger(t[0]) && Number.isInteger(t[1])) world.turrets.set(keyOf(t[0], t[1]), { tx: t[0], ty: t[1], ammo: Math.max(0, Math.min(5000, t[2] | 0)), cool: 0 });
    }
  }
}

// ---- Using things on a base ---------------------------------------------------------------------------

/**
 * Player s uses `item` (inp: the button for that hand; pressed: just now; h: worldplay.js's
 * breakBlock, dropItem, notYours), where it's bases' own: a siege charge, a battering ram, a
 * stronghold charter, ammo into a turret, a builder's hammer on your flag, a pickaxe on someone
 * else's. Returns whether a gun should fire (false: the button's taken), or undefined if it's
 * nothing of the kind.
 */
export function useBase(game, s, item, inp, pressed, h) {
  const w = s.world, t = w?.target, world = game.world;
  if (!item || !t) return undefined;
  if (item.kind === 'siege') { if (pressed) plant(game, s, item); return false; }
  if (item.tool === 'ram') { if (inp.fire) ram(game, s, item, h); return false; }
  if (item.kind === 'charter') {
    if (!pressed) return false;
    // (Your base's flag clicked; or anywhere in your base.)
    const c = (t.near && baseOfFlag(world, t.tx, t.ty)) || claimAt(world, Math.floor(s.x / TILE), Math.floor(s.y / TILE));
    if (c && onSide(world, c, s.name)) charter(game, s, c, item);
    else tell(game, s, 'A stronghold charter raises your base a level: use it in your base');
    return false;
  }
  if (!t.near) return undefined;
  const id = world.tile(t.tx, t.ty);
  if (item.kind === 'ammo' && K.TURRETS.has(id)) { if (pressed) load(game, s, item, t.tx, t.ty, id); return false; }
  if (isFlag(id) && item.kind === 'tool' && inp.fire) {
    const c = baseOfFlag(world, t.tx, t.ty);
    if (!c) return undefined;
    if (item.tool === 'hammer') {
      if (onSide(world, c, s.name)) mend(game, s, c, item);
      else h.notYours(game, s, t.tx, t.ty);
      return false;
    }
    if ((item.tool === 'pick' || item.tool === 'axe') && !onSide(world, c, s.name) && !fallen(world, c)) {
      if (c.open && !c.down) strike(game, s, c, (item.power || 1) * PICK_CORE, item.every || 13, item.tool === 'axe' ? 'chop' : 'mine');
      else h.notYours(game, s, t.tx, t.ty);
      return false;
    }
  }
  return undefined;
}

/**
 * Right click on block id at (tx, ty), where it's bases' own: a turret says what's in it, a flag
 * says whose base it is and how it stands, a locked iron door stays shut. Returns true if that's
 * what it was (undefined: carry on as usual).
 */
export function interactBase(game, s, tx, ty, id) {
  const world = game.world;
  if (K.TURRETS.has(id)) {
    const k = turretOf(id), n = world.turrets?.get(keyOf(tx, ty))?.ammo || 0, c = claimAt(world, tx, ty);
    game.notify(s, `${BLOCKS[id].name}: ${n} ${k.ammo}${n ? '' : ` (load it: click it with ${k.ammo} in hand, or put a chest of them beside it)`}${c?.down ? '. Its base\'s flag has fallen: it\'s down till that\'s mended' : ''}`);
    return true;
  }
  if (isFlag(id)) {
    const c = baseOfFlag(world, tx, ty);
    if (c) game.notify(s, baseText(world, c, s));
    return !!c;
  }
  if ((id === K.IRON_DOOR || id === K.IRON_DOOR_OPEN) && !mayUnlock(game, s, tx, ty)) {
    tell(game, s, `Locked: ${claimAt(world, tx, ty)?.owner ?? 'someone'}'s iron door`);
    game.sound('tink', tx * TILE + 8, ty * TILE + 8);
    return true;
  }
  return undefined;
}

/** How base c stands, for player s (its flag clicked). */
function baseText(world, c, s) {
  const mine = onSide(world, c, s.name), hp = Math.round(c.hp ?? maxHpOf(c)), max = maxHpOf(c);
  const whose = mine ? (sameName(c.owner, s.name) ? 'Your base' : `${c.owner}'s base (your party's)`) : `${c.owner}'s base`;
  const state = c.down ? (raidsAllowed(world) ? 'its flag has fallen: anyone can take what\'s in it' : 'its flag has fallen') : `its flag ${hp}/${max}`;
  const raids = !raidsAllowed(world) ? 'it can\'t be raided' : c.open ? 'open to raids now' : closedWhy(world);
  return `${whose}, level ${levelOf(c)}: ${state}; ${raids}${mine && !c.down && hp < max ? '. Mend it with a builder\'s hammer' : ''}`;
}

// ---- Turrets -------------------------------------------------------------------------------------------

// Each kind: what it shoots, how much it holds, how far it reaches (tiles), updates between shots,
// how hard each one hits.
const TURRET = {
  arrow_turret: { ammo: 'arrows', most: 120, range: 18, every: 48, damage: 30, weapon: 'Arrow turret', sound: 'bow' },
  gun_turret: { ammo: 'bullets', most: 400, range: 22, every: 9, damage: 8, weapon: 'Gun turret', sound: 'rifle' },
};
const turretOf = id => (id === K.ARROW_TURRET ? TURRET.arrow_turret : id === K.GUN_TURRET ? TURRET.gun_turret : null);
const ARROW = { ...WEAPONS.Longbow, damage: TURRET.arrow_turret.damage };
const BULLET_SPEED = 30;

/** Player s loads the turret at (tx, ty) with what's in hand (item: its ammo). */
function load(game, s, item, tx, ty, id) {
  const world = game.world, k = turretOf(id), key = keyOf(tx, ty);
  if (item.key !== k.ammo) { tell(game, s, `${BLOCKS[id].name}s take ${k.ammo}`); return; }
  const c = claimAt(world, tx, ty);
  if (!c || !onSide(world, c, s.name)) { tell(game, s, 'That\'s not your turret'); return; }
  const t = (world.turrets ||= new Map()).get(key) || world.turrets.set(key, { tx, ty, ammo: 0, cool: 0 }).get(key);
  const n = Math.min(k.most - t.ammo, s.world.inv.count(k.ammo));
  if (n <= 0) { tell(game, s, `${BLOCKS[id].name}: full (${t.ammo} ${k.ammo})`); return; }
  s.world.inv.remove(k.ammo, n);
  t.ammo += n;
  startAct(s, 'place', 14);
  game.sound('reload', tx * TILE + 8, ty * TILE + 8);
  game.notify(s, `${BLOCKS[id].name}: ${t.ammo} ${k.ammo}`);
}

/** A turret with nothing in it takes what it shoots from a chest beside it (or above or below). */
function restock(world, t, k) {
  for (let y = t.ty - 1; y <= t.ty + 1; y++) {
    for (let x = t.tx - 2; x <= t.tx + 2; x++) {
      if (world.tile(x, y) !== K.CHEST) continue;
      const inv = world.chests?.get(keyOf(x, y));
      const n = Math.min(k.most - t.ammo, inv?.count(k.ammo) || 0);
      if (n <= 0) continue;
      inv.remove(k.ammo, n);
      t.ammo += n;
      if (t.ammo >= k.most) return;
    }
  }
}

/**
 * What a base's turrets and traps hurt (their projectiles' owner: canHurt, monsters.js's foes):
 * hostile monsters always; with PvP on, players not on its side, and their mercenaries.
 */
function hits(game, c, o) {
  const n = o.npc, world = game.world;
  if (n?.kind === 'monster') return n.ally == null || (world.pvp !== false && !onSide(world, c, game.soldiers.find(p => p.id === n.ally)?.name));
  if (world.pvp === false || (n && n.kind !== 'merc')) return false;
  const who = nameFor(game, o);
  return who != null && !onSide(world, c, who);
}

/** Whether a turret of base c shoots at o: what its shots hurt, players only once they're in the base. */
function turretFoe(game, c, o) {
  if (!o.alive || o.spawnProtect > 0 || o.world?.dev?.invisible || !hits(game, c, o)) return false;
  if (o.npc?.kind === 'monster') return true;
  const r = radiusOf(c) + 1;
  return Math.abs(o.x / TILE - c.tx) <= r && Math.abs(o.y / TILE - c.ty) <= r;
}

// Who a base's turrets and traps are, to what they hurt (the projectile's owner, the kill feed's
// killer): one for each base, never in the game's list of soldiers.
const GUARDS = new WeakMap();
function guardOf(game, c) {
  let m = GUARDS.get(c);
  if (!m || m.game !== game) {
    m = {
      id: -1, name: `${c.owner}'s base`, isBot: true, alive: true, team: 0, frags: 0, deaths: 0, x: 0, y: 0, facing: 1, streak: 0,
      body: { x: 0, y: 0, vx: 0, vy: 0 }, game, npc: { kind: 'turret', owner: c.owner, hits: o => hits(game, c, o) },
    };
    GUARDS.set(c, m);
  }
  return m;
}

const NEAR_TURRET = [];

/** Each few updates: turrets with something to shoot at shoot it (their base's flag standing). */
function turretsTick(game) {
  const world = game.world;
  for (const [key, t] of world.turrets) {
    if (!world.has(t.tx >> 5, t.ty >> 5)) continue;
    const id = world.tile(t.tx, t.ty), k = turretOf(id);
    if (!k) { world.turrets.delete(key); continue; }
    if (t.cool > 0) { t.cool -= 5; continue; }
    const c = claimAt(world, t.tx, t.ty);
    if (!c || c.down) continue;
    if (t.ammo <= 0) restock(world, t, k);
    if (t.ammo <= 0) continue;
    const x = t.tx * TILE + 8, y = t.ty * TILE + 5, R = k.range * TILE;
    let best = null, bd = R * R;
    const near = NEAR_TURRET, n = game.nearInto(x - R, y - R, x + R, y + R, near);
    for (let i = 0; i < n; i++) {
      const o = near[i], dx = o.body.x - x, dy = o.body.y - 8 - y, d = dx * dx + dy * dy;
      if (d >= bd || !turretFoe(game, c, o) || !world.clearLine(x, y, o.body.x, o.body.y - 8)) continue;
      best = o; bd = d;
    }
    if (!best) continue;
    shoot(game, c, t, k, x, y, best);
  }
}

/** A turret (t, of kind k, its head at (x, y)) shoots at o. */
function shoot(game, c, t, k, x, y, o) {
  const g = guardOf(game, c);
  g.x = g.body.x = x; g.y = g.body.y = y;
  let dx = o.body.x - x, dy = o.body.y - 8 - y;
  const d = Math.hypot(dx, dy) || 1;
  if (k === TURRET.arrow_turret) {
    // (Aimed high, for the drop over the way.)
    const time = d / ARROW.speed;
    dy -= 0.5 * ARROW.gravity * time * time;
    const l = Math.hypot(dx, dy) || 1;
    spawn(game, { kind: 'arrow', sprite: 'arrow', cfg: ARROW, x: x + dx / l * 6, y: y + dy / l * 6, vx: dx / l * ARROW.speed, vy: dy / l * ARROW.speed, owner: g, weapon: k.weapon, life: 600 });
  } else {
    const a = Math.atan2(dy, dx) + (game.rng() - 0.5) * 0.06;
    spawn(game, { kind: 'bullet', sprite: 'bullet', x: x + Math.cos(a) * 7, y: y + Math.sin(a) * 7, vx: Math.cos(a) * BULLET_SPEED, vy: Math.sin(a) * BULLET_SPEED, owner: g, weapon: k.weapon, life: (k.range * TILE + 60) / BULLET_SPEED, damage: k.damage, knock: 0.6 });
    game.fx?.muzzle?.(x + Math.cos(a) * 8, y + Math.sin(a) * 8, a, false);
  }
  t.ammo--;
  t.cool = k.every / MOTION.timeScale;
  game.sound(k.sound, x, y);
  // (Shooting at a player: the base's side hears of it.)
  if (!o.npc) alarm(game, c, o);
}

// ---- Traps: spikes, pressure mines --------------------------------------------------------------------

const SPIKE_DAMAGE = 6;
const MINE_BLAST = { radius: 70, damage: 110, knock: 10 };

/** Each few updates: whoever's in spikes is hurt (and slowed); a pressure mine under a foe goes off. Never the base's own side. */
function trapsTick(game) {
  const world = game.world;
  for (const s of game.soldiers) {
    if (!s.alive || s.spawnProtect > 0 || s.world?.dev) continue;
    const fy = Math.floor((s.y + BODY.bottom - 1) / TILE);
    for (const fx of [Math.floor((s.x - BODY.halfW + 1) / TILE), Math.floor((s.x + BODY.halfW - 1) / TILE)]) {
      const id = world.tile(fx, fy);
      if (id !== K.SPIKES && id !== K.PRESSURE_MINE) continue;
      const c = claimAt(world, fx, fy);
      // (A base's: what it fights. With its base gone: monsters only.)
      if (c ? !hits(game, c, s) : !isHostile(s)) continue;
      const by = c ? guardOf(game, c) : null;
      if (id === K.SPIKES) {
        s.body.vx *= 0.35;
        if (game.tick % 12 < 6) damage(game, s, SPIKE_DAMAGE, by, 'Spikes', { dirX: 0, dirY: -1, knock: 0.5 });
      } else {
        world.setTile(fx, fy, AIR);
        blast(game, fx * TILE + 8, fy * TILE + 12, MINE_BLAST, by, 'Pressure mine');
      }
      break;
    }
  }
}

/** A blast that hurts and throws whoever's near but breaks no blocks (a trap's, a siege charge's: those break blocks their own way). */
function blast(game, x, y, b, by, weapon) {
  const world = game.world;
  world.blastGuard = true;
  try { explode(game, x, y, b, by, weapon); } finally { world.blastGuard = false; }
}

// ---- Siege tools: charges, the battering ram -------------------------------------------------------------

// Each charge: its fuse (updates), how far it breaks blocks (tiles: everything but bedrock, water
// and graves), how hard it hits a flag in reach, its blast (who's near), and how it looks.
const SIEGE = {
  breach_charge: { fuse: 180, r: 2.6, core: 300, blast: { radius: 60, damage: 70, knock: 9 }, sprite: 'dynamite' },
  demo_charge: { fuse: 300, r: 4.2, core: 800, blast: { radius: 110, damage: 120, knock: 14 }, sprite: 'mine' },
};

/** Player s puts a siege charge (item) on what's under their crosshair: it goes off when its fuse is out. */
function plant(game, s, item) {
  const w = s.world, t = w.target, world = game.world;
  if (w.cool > 0) return;
  const id = t.near ? world.tile(t.tx, t.ty) : AIR;
  if (id === AIR || LIQUID[id]) { tell(game, s, 'Put a charge on a wall, a door, a floor or a base\'s flag (in reach)'); return; }
  const why = siegeBlocked(world, s, t.tx, t.ty);
  if (why) { tell(game, s, why); return; }
  const k = SIEGE[item.key];
  // (On the face of what it's put on, toward whoever put it there.)
  const cx = t.tx * TILE + 8, cy = t.ty * TILE + 8, dx = s.shoulderX - cx, dy = s.shoulderY - cy, d = Math.hypot(dx, dy) || 1;
  const x = SOLID[id] ? cx + (dx / d) * 9 : cx, y = SOLID[id] ? cy + (dy / d) * 9 : cy + 6;
  spawn(game, { kind: 'placed', sprite: k.sprite, cfg: { siege: item.key }, x, y, vx: 0, vy: 0, onGround: true, owner: s, weapon: item.name, life: k.fuse, armed: 0, triggered: -1 });
  w.inv.remove(item.key, 1);
  w.cool = 30 / MOTION.timeScale;
  startAct(s, 'place', 20);
  game.sound('fuse', x, y);
  game.notify(s, `${item.name} set: ${Math.round(k.fuse / 60)} seconds!`);
  const c = claimAt(world, t.tx, t.ty);
  if (c && !onSide(world, c, s.name)) alarm(game, c, s);
}

/** Each update: siege charges whose fuse is out go off (their own way: TileWorld's carve keeps out of bases). */
function siegeTick(game, h) {
  for (const p of game.projectiles) if (p.cfg?.siege && !p.dead && p.life <= 1) goOff(game, p, h);
}

/** Siege charge p goes off: the blocks round it broken (bases that can't be raided, towns, kept), flags in reach hit, whoever's near hurt. */
function goOff(game, p, h) {
  const world = game.world, k = SIEGE[p.cfg.siege], by = p.owner || null, name = nameFor(game, by);
  p.dead = true;
  const r = k.r * TILE, tx0 = Math.floor((p.x - r) / TILE), tx1 = Math.floor((p.x + r) / TILE), ty0 = Math.floor((p.y - r) / TILE), ty1 = Math.floor((p.y + r) / TILE);
  const raided = new Set();
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const cx = tx * TILE + 8 - p.x, cy = ty * TILE + 8 - p.y;
      if (cx * cx + cy * cy > r * r) continue;
      const id = world.tile(tx, ty), b = BLOCKS[id];
      if (id === AIR || LIQUID[id] || b.resist >= 1e9 || id === K.GRAVE || isFlag(id)) continue;
      if (world.gen?.townProtecting(tx, ty)) continue;
      const c = claimAt(world, tx, ty);
      if (c && !onSide(world, c, name) && !fallen(world, c) && (!c.open || LOCKED.has(id))) continue;
      if (id === K.DOOR || id === K.DOOR_OPEN || id === K.IRON_DOOR || id === K.IRON_DOOR_OPEN) { h.breakBlock(game, tx, ty, null); continue; }
      world.setTile(tx, ty, AIR);
      world.onBreak?.(tx, ty, id);
      if (c && !onSide(world, c, name)) raided.add(c);
    }
  }
  // Flags in reach: hit hard. (And the side of any base it broke into, told.)
  for (const c of [...(world.claims?.values() || [])]) {
    const fx = c.tx * TILE + 8 - p.x, fy = c.ty * TILE + 8 - p.y, reach = r + TILE * 1.5;
    if (fx * fx + fy * fy > reach * reach || onSide(world, c, name) || !c.open) continue;
    if (hitCore(game, c, k.core, by)) raided.delete(c);
  }
  for (const c of raided) alarm(game, c, by);
  blast(game, p.x, p.y, k.blast, by, p.weapon);
  game.fx?.rubble?.(p.x, p.y, r);
}

/** A swing of a battering ram (it) by player s at what's under their crosshair: built blocks go in a few (the toughest too), flags take a beating. */
function ram(game, s, it, h) {
  const w = s.world, t = w.target, world = game.world;
  if (w.cool > 0 || !t.near) return;
  const id = world.tile(t.tx, t.ty), b = BLOCKS[id], x = t.tx * TILE + 8, y = t.ty * TILE + 8;
  if (id === AIR || LIQUID[id]) return;
  const why = siegeBlocked(world, s, t.tx, t.ty);
  if (why) { tell(game, s, why); return; }
  w.cool = RAM_EVERY / MOTION.timeScale;
  startAct(s, 'hammer', RAM_EVERY);
  exert(s, 0.05);
  const c = claimAt(world, t.tx, t.ty), theirs = c && !onSide(world, c, s.name);
  if (isFlag(id)) {
    const f = baseOfFlag(world, t.tx, t.ty);
    if (f && theirs && !f.down) { raider(game, s, f); hitCore(game, f, RAM_CORE, s); game.shake?.(x, y, 3); return; }
  }
  if (b.resist >= 1e9 || id === K.GRAVE || (theirs && !fallen(world, c) && LOCKED.has(id))) { game.sound('tink', x, y); if (theirs) tell(game, s, whyNot(world, s, t.tx, t.ty, id)); return; }
  if (!w.mine || w.mine.tx !== t.tx || w.mine.ty !== t.ty || w.mine.layer !== 'fg') w.mine = { tx: t.tx, ty: t.ty, layer: 'fg', dmg: 0, of: b.hard };
  w.mine.dmg += b.natural ? 1.5 : RAM_POWER;
  w.mine.at = game.tick;
  game.shake?.(x, y, 2);
  game.fx?.sparks?.(x, y, 0, -1);
  if (theirs) alarm(game, c, s);
  if (w.mine.dmg >= Math.max(0.5, b.hard)) { h.breakBlock(game, t.tx, t.ty, s); w.mine = null; }
  else game.sound(b.wood ? 'thunk' : 'smash', x, y);
}

// ---- The dead come for a base (the world's base raids) --------------------------------------------------

const RAID_EVERY = 60 * 30;     // updates between chances of a raid on a base starting (half a minute)
const RAID_CHANCE = 0.12;       // the chance each time (at night, someone in their base)
const RAID_QUIET = 60 * 60 * 8; // updates after one before the next
// How hard each kind hits a flag (a bite each RAID_BITE updates), and a built block in its way.
const BITE = { zombie: 12, skeleton: 8, brute: 40 };
const BASH = { zombie: 1, skeleton: 0.7, brute: 3 };
const RAID_BITE = 40;

/** A raid on base c starts: the dead gather at its edges, and come for its flag. size: how many. */
export function startBaseRaid(game, c, size = null) {
  const world = game.world, key = keyOf(c.tx, c.ty), r = radiusOf(c);
  const side = sidePlayers(game, c).filter(s => s.alive && Math.abs(s.x / TILE - c.tx) < r + 40);
  const level = side.length ? Math.max(...side.map(s => progOf(s).level)) : 1;
  const n = size ?? Math.min(14, 4 + levelOf(c) * 2 + side.length * 2);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const dir = i % 2 ? 1 : -1, spot = raidSpot(world, c, dir, i);
    const roll = game.rng();
    const type = level >= 8 && roll < 0.15 ? 'brute' : level >= 3 && roll < 0.4 ? 'skeleton' : 'zombie';
    const m = spawnMonster(game, type, spot.tx * TILE + TILE / 2, (spot.ty + 1) * TILE - BODY.bottom - 1);
    m.npc.baseRaid = key;
    m.npc.goal = { x: c.tx * TILE + 8, y: c.ty * TILE + 8 };
    ids.push(m.id);
  }
  world.baseRaid = { key, owner: c.owner, monsters: ids, total: ids.length, kills: {}, started: world.time || 0 };
  for (const p of sidePlayers(game, c)) game.notify(p, 'The dead are coming for your base! Hold it till they\'re beaten');
  game.sound('rumble', c.tx * TILE + 8, c.ty * TILE);
  alarm(game, c, { npc: { kind: 'monster' } });
  return world.baseRaid;
}

/** Somewhere at base c's edge (dir: which side; i: which of them) for a raider to come from: standing room near the flag's height, else the ground there. */
function raidSpot(world, c, dir, i) {
  const tx = c.tx + dir * (radiusOf(c) + 3 + (i % 4) * 2);
  for (let d = 0; d < 14; d++) {
    for (const ty of d ? [c.ty - d, c.ty + d] : [c.ty]) {
      if (ty < 3) continue;
      if (SOLID[world.tile(tx, ty + 1)] && !SOLID[world.tile(tx, ty)] && !SOLID[world.tile(tx, ty - 1)] && !LIQUID[world.tile(tx, ty)] && !LIQUID[world.tile(tx, ty - 1)]) return { tx, ty };
    }
  }
  return { tx, ty: world.surface(tx) - 1 };
}

/** The raiders of the raid on a base still to beat (alive, or about to appear). */
function raidersLeft(game, raid) {
  let n = 0;
  for (const id of raid.monsters) { const m = game.soldiers.find(s => s.id === id); if (m && (m.alive || !m.npc.spawned)) n++; }
  return n;
}

/** A raider on a base killed (worldplay.js's onKill): counted for whoever killed it. */
export function baseRaidKill(game, victim, by) {
  const raid = game.world.baseRaid;
  if (!raid || victim.npc?.baseRaid !== raid.key) return;
  if (by) raid.kills[by.id] = (raid.kills[by.id] || 0) + 1;
}

/** The raid on a base near player s, for their HUD ({ name, left, total }), or null. */
export function baseRaidInfo(game, s) {
  const world = game.world, raid = world.baseRaid, c = raid && world.claims?.get(raid.key);
  if (!c || Math.abs(s.x / TILE - c.tx) > radiusOf(c) + 60 || Math.abs(s.y / TILE - c.ty) > radiusOf(c) + 40) return null;
  return { name: onSide(world, c, s.name) ? 'your base' : `${c.owner}'s base`, left: raidersLeft(game, raid), total: raid.total };
}

/** The raid on a base is over: won (beaten: coins and experience for whoever fought), at dawn, its flag fallen, or the base gone. */
export function endBaseRaid(game, how) {
  const world = game.world, raid = world.baseRaid;
  if (!raid) return;
  world.baseRaid = null;
  world.lastBaseRaid = game.tick;
  const c = world.claims?.get(raid.key);
  for (const id of raid.monsters) {
    const m = game.soldiers.find(s => s.id === id);
    if (!m) continue;
    if (how === 'dawn' || how === 'gone') game.removeSoldier(m);
    else { m.npc.goal = null; m.npc.baseRaid = null; }
  }
  if (!c) return;
  const r = radiusOf(c);
  for (const s of game.soldiers) {
    if (!s.world || s.npc || Math.abs(s.x / TILE - c.tx) > r + 60) continue;
    const mine = onSide(world, c, s.name), kills = raid.kills[s.id] || 0;
    if (how === 'dawn') { if (mine) game.notify(s, 'Dawn: the dead have gone back into the ground'); continue; }
    if (how === 'fell') { if (mine) game.notify(s, 'The dead broke through: your base\'s flag has fallen'); continue; }
    if (!kills) { if (mine) game.notify(s, 'Your base held!'); continue; }
    const coins = 15 + kills * 6, xp = 40 + kills * 20;
    s.world.inv.add('coins', coins);
    giveXp(game, s, xp, mine ? 'defending your base' : `defending ${c.owner}'s base`);
    countStat(s, 'raids');
    game.notify(s, `${mine ? 'Your base' : `${c.owner}'s base`} held! ${coins} coins (${kills} killed)`);
    game.sound('hallelujah', s.x, s.y, s.id);
  }
}

/** Each update: a raid on a base starting, going on (raiders breaking through to the flag), and ending. */
function baseRaidsTick(game, h) {
  const world = game.world, raid = world.baseRaid;
  if (raid) {
    const c = world.claims?.get(raid.key);
    if (!c) { endBaseRaid(game, 'gone'); return; }
    if (game.tick % 10 === 0) raidersAt(game, c, raid, h);
    if (game.tick % 30) return;
    if (raidersLeft(game, raid) === 0) endBaseRaid(game, 'won');
    else if (!isNight(world.time || 0)) endBaseRaid(game, 'dawn');
    return;
  }
  if (settingOf(world, 'baseRaids') === 'off' || !difficultyOf(world).spawn || world.devQuiet) return;
  const hour = hourOf(world.time || 0);
  if (game.tick % RAID_EVERY || !isNight(world.time || 0) || (hour < 21 && hour > 4)) return;
  if (game.tick - (world.lastBaseRaid ?? -1e9) < RAID_QUIET) return;
  // (Someone in a base of their side's, awake, and the dice.)
  for (const p of game.soldiers) {
    if (!p.alive || !p.world || p.npc || p.world.sleep) continue;
    const c = claimAt(world, Math.floor(p.x / TILE), Math.floor(p.y / TILE));
    if (!c || c.down || !onSide(world, c, p.name)) continue;
    if (game.rng() < RAID_CHANCE) startBaseRaid(game, c);
    return;
  }
}

/** Every few updates: raiders at base c's flag bite at it; those stuck against a built block break through it. */
function raidersAt(game, c, raid, h) {
  const world = game.world, gx = c.tx * TILE + 8, gy = c.ty * TILE + 8, diff = difficultyOf(world).dmg;
  for (const id of raid.monsters) {
    const m = game.soldiers.find(s => s.id === id);
    if (!m?.alive) continue;
    const n = m.npc, type = n.type;
    if (Math.abs(m.x - gx) < 1.4 * TILE && Math.abs(m.y - gy) < 2.5 * TILE) {
      if ((n.bitAt ?? -1e9) + RAID_BITE <= game.tick) { n.bitAt = game.tick; hitCore(game, c, (BITE[type] || 10) * diff, m); }
      continue;
    }
    // (Stuck: hardly moved this last half second, on the way to the flag.)
    n.stuck = Math.abs(m.x - (n.lastX ?? m.x)) < 3 ? (n.stuck || 0) + 10 : 0;
    n.lastX = m.x;
    if (n.stuck < 30) continue;
    // What's in its way: ahead of it (feet, middle, head), or (on a roof, the flag below) under it.
    const dir = Math.sign(gx - m.x) || 1, ahead = Math.floor((m.x + dir * (BODY.halfW + 4)) / TILE);
    const spots = [[ahead, m.y + BODY.bottom - 3], [ahead, m.y - 6], [ahead, m.y - 18]];
    if (gy - m.y > TILE) spots.push([Math.floor(m.x / TILE), m.y + BODY.bottom + 2]);
    for (const [tx, yy] of spots) {
      const ty = Math.floor(yy / TILE), bid = world.tile(tx, ty), b = BLOCKS[bid];
      if (!SOLID[bid] || b.natural || b.resist >= 1e9) continue;
      const key = keyOf(tx, ty), done = ((world.bashed ||= new Map()).get(key) || 0) + (BASH[type] || 1) * diff;
      game.sound(b.wood ? 'thunk' : 'smash', tx * TILE + 8, ty * TILE + 8);
      game.fx?.sparks?.(tx * TILE + 8, ty * TILE + 8, -dir, 0);
      alarm(game, c, m);
      if (done >= Math.max(1, b.hard)) { world.bashed.delete(key); h.breakBlock(game, tx, ty, null); }
      else world.bashed.set(key, done);
      break;
    }
  }
  if (world.bashed?.size > 500) world.bashed.clear();
}

// ---- Each update ---------------------------------------------------------------------------------------

/** The bases' part in each update (the host's): which are open to raids, turrets, traps, siege charges, raids by the dead. */
export function basesTick(game, h) {
  if (game.mirror) return;
  const world = game.world;
  // (Whether each is open to a raid now. And under attack is the host's to know, from when it was
  // last hit: not what a save said.)
  if (game.tick % 30 === 7) for (const c of world.claims?.values() || []) { c.open = openNow(game, c); c.alarm = false; }
  if (world.turrets?.size && game.tick % 5 === 0) turretsTick(game);
  if (game.tick % 6 === 3) trapsTick(game);
  siegeTick(game, h);
  baseRaidsTick(game, h);
}
