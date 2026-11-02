// Playing in a world (world mode): the rules the game plays by there (no frag limit, respawning
// where you started), and everything players do with their things: the hotbar, digging with
// a pickaxe, felling trees, shaping blocks with the hammer, building (one block at a time, or a
// line, a rectangle or a box dragged out), opening doors, supply crates, and things on the ground
// to pick up. The guns are the game's own, using ammunition from the inventory.

import * as K from './blocks.js';
import { BLOCKS, SOLID, PLATFORMS, TILE, AIR, NO_WALL } from './blocks.js';
import { Inventory, itemOf, HOTBAR, CRATE_LOOT, boxDetails } from './items.js';
import { WORLD_H, CHUNK } from './worldgen.js';
import { MOTION, BODY } from '../config.js';
import { WEAPONS } from '../weapons.js';
import { monstersTick, armNpc, foes, isMonster, monsterLoot, hireMerc, mercsOf, MERC, DAY_TICKS, hourOf } from './monsters.js';
import { setDoor, pushDoor, doorsTick, soldierIn } from './doors.js';
import { damage } from '../combat.js';
import { devFly, devInput } from './devmode.js';
import { townsfolkTick, isFolk } from './townsfolk.js';
import { startTalk, talkTick, folkAt } from './talk.js';
import { giveXp, countStat, applyProgress, maxHealthOf, damageScale, digScale, lootScale, doubleOreChance, regenTick, progToSave, progFromSave, KILL_XP, MINE_XP } from './progress.js';
import { questEvent, questsTick, questsToSave, questsFromSave, setQuestHooks } from './quests.js';
import { valueOf } from './trade.js';
import { playerAt, shareKill, partyView } from './social.js';
import { raidsTick, raidKill, raidersLeft } from './raids.js';
import { SLOTS, slotKind, gearStats, armorCut, rollGear, dropSeed, dropLevel, RARITY, weaponWith } from './gear.js';
import { cleanGear } from './items.js';
import { scanFound, cleanFound } from './codex.js';
import { useBed, sleepInput, sleepTick, wake, homeOf } from './sleep.js';
import { addWaystone, removeWaystone, waystoneMenu } from './waystones.js';
import { settingOf, difficultyOf, keepTime, KITS } from './worldrules.js';
import { setDev } from './devmode.js';

/** How far from your shoulder you can reach to dig or build (to a block's middle). */
export const REACH = 6 * TILE;
/** The building brushes (R cycles them while holding blocks): one block, or a shape dragged out. */
export const BRUSHES = ['single', 'line', 'rect', 'box'];
export const BRUSH_NAMES = { single: 'One block', line: 'Line', rect: 'Rectangle', box: 'Box (outline)' };
const MAX_DRAG = 32;           // tiles a dragged shape can reach either way
const PLACE_EVERY = 5;         // updates between blocks placed while holding the button (at full speed)
const DROP_LIFE = 5 * 60 * 60; // things on the ground go after five minutes (at full speed)
const MAX_DROPS = 400;

// Plants and the like: broken by anything, put in the way of nothing (building replaces them).
const SOFT = new Set([K.TALL_GRASS, K.FLOWER, K.DEAD_BUSH, K.VINE, K.WHEAT]);
// What needs something to stand on (or hang from) and goes when it's taken away.
const NEEDS_GROUND = new Set([K.TALL_GRASS, K.FLOWER, K.DEAD_BUSH, K.MUSHROOM, K.CACTUS, K.WHEAT]);
const DOORS = new Set([K.DOOR, K.DOOR_OPEN]);
const LEAF = new Set([K.LEAVES, K.PINE_LEAVES, K.JUNGLE_LEAVES, K.VINE]);

// ---- Bases (claims) -----------------------------------------------------------------------------

/** How far a base flag claims round it (blocks, each way, across and up and down). */
export const CLAIM_R = 20;

/** The claim covering tile (tx, ty) ({ tx, ty, owner }), or null. */
export function claimAt(world, tx, ty) {
  for (const c of world.claims?.values() || []) if (Math.abs(c.tx - tx) <= CLAIM_R && Math.abs(c.ty - ty) <= CLAIM_R) return c;
  return null;
}

const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** Whether soldier s may change tile (tx, ty) (dig, build, open a chest): not in a town, nor someone else's base. */
export function mayChange(world, s, tx, ty) {
  if (!s) return true;
  if (world.gen?.townProtecting(tx, ty)) return false;
  if (!world.claims?.size) return true;
  const c = claimAt(world, tx, ty);
  return !c || sameName(c.owner, s.name);
}

/** A world's claims as saved: [[tx, ty, owner], ...]. */
export const claimsToSave = world => [...(world.claims?.values() || [])].map(c => [c.tx, c.ty, c.owner]);

/** A world's claims from a save (those whose flag is still there). */
export function claimsFromSave(world, list) {
  world.claims = new Map();
  if (!Array.isArray(list)) return;
  for (const row of list) {
    if (!Array.isArray(row) || !Number.isInteger(row[0]) || !Number.isInteger(row[1]) || typeof row[2] !== 'string') continue;
    world.claims.set(`${row[0]},${row[1]}`, { tx: row[0], ty: row[1], owner: row[2].slice(0, 14) });
  }
}

/** Tell s it's a town, or someone else's base (once in a while, not for every click). */
function notYours(game, s, tx, ty) {
  const town = game.world.gen?.townProtecting(tx, ty), c = town ? null : claimAt(game.world, tx, ty);
  if (s.world && game.tick - (s.world.toldClaim || -1e9) > 90) {
    s.world.toldClaim = game.tick;
    game.notify(s, town ? `You can't dig or build in ${town.name}` : `That's ${c?.owner ?? 'someone'}'s base`);
  }
  return false;
}

// ---- Chests -------------------------------------------------------------------------------------

/** How many things a chest holds. */
export const CHEST_SIZE = 30;
const chestKey = (tx, ty) => `${tx},${ty}`;

/** Whether block `id` keeps things in the world: a chest, or a shulker box (an ender chest's are each player's own). */
export const isContainer = id => id === K.CHEST || K.SHULKER_BOXES.has(id);

/**
 * The things in the chest (or shulker box) at (tx, ty) (made empty the first time it's looked
 * in), or null if there's none there. (A shulker box won't take a shulker box.)
 */
export function chestAt(world, tx, ty) {
  const id = world.tile(tx, ty);
  if (!isContainer(id)) return null;
  const chests = world.chests ||= new Map(), k = chestKey(tx, ty);
  let c = chests.get(k);
  if (!c) chests.set(k, c = new Inventory(CHEST_SIZE));
  c.refuse = K.SHULKER_BOXES.has(id) ? noBoxes : null;
  return c;
}
const noBoxes = key => !!itemOf(key)?.box;

/**
 * What player s sees opening the thing at (tx, ty): a chest's or a shulker box's things, or
 * their own ender chest's (the same in every ender chest), or null.
 */
export function boxFor(game, s, tx, ty) {
  if (game.world.tile(tx, ty) === K.ENDER_CHEST) return s?.world ? (s.world.ender ||= new Inventory(CHEST_SIZE)) : null;
  return chestAt(game.world, tx, ty);
}

/** What kind of thing's open at (tx, ty), and what it's called: { kind ('chest', 'shulker', 'ender'), name }. */
export function boxKind(world, tx, ty) {
  const id = world.tile(tx, ty);
  return id === K.ENDER_CHEST ? { kind: 'ender', name: 'Your ender chest' } : K.SHULKER_BOXES.has(id) ? { kind: 'shulker', name: BLOCKS[id].name } : { kind: 'chest', name: 'The chest' };
}

/** A shulker box at (tx, ty) broken: it drops whole, with what's in it (an empty one: just the box). */
function dropShulker(game, tx, ty, id, x, y) {
  const k = chestKey(tx, ty), inv = game.world.chests?.get(k), key = BLOCKS[id].key;
  game.world.chests?.delete(k);
  const full = inv?.slots.some(Boolean);
  dropItem(game, key, 1, x, y, (game.rng() - 0.5) * 2, -2, 0, full ? boxDetails(key, inv.slots) : null);
}

/** A world's chests as saved: [[tx, ty, things], ...] (the empty ones, and any whose chest is gone, left out). */
export function chestsToSave(world) {
  const out = [];
  for (const [k, inv] of world.chests || []) {
    const [tx, ty] = k.split(',').map(Number);
    if (inv.slots.some(Boolean) && isContainer(world.tile(tx, ty))) out.push([tx, ty, inv.toJSON()]);
  }
  return out;
}

/** A world's chests from a save. */
export function chestsFromSave(world, list) {
  world.chests = new Map();
  if (!Array.isArray(list)) return;
  for (const row of list) {
    if (!Array.isArray(row) || !Number.isInteger(row[0]) || !Number.isInteger(row[1])) continue;
    world.chests.set(chestKey(row[0], row[1]), Inventory.from(row[2], CHEST_SIZE));
  }
}

/** A chest broken: what was in it falls out. */
function spillChest(game, tx, ty) {
  const k = chestKey(tx, ty), inv = game.world.chests?.get(k);
  if (!inv) return;
  game.world.chests.delete(k);
  for (const s of inv.slots) {
    if (!s) continue;
    dropItem(game, s.key, s.n, tx * TILE + 8, ty * TILE + 4, (game.rng() - 0.5) * 3, -2, 0, s.g || null);
  }
}

// ---- Going home, and putting things away ------------------------------------------------------------

/** How long a recall scroll takes to read (updates, keeping still). */
export const RECALL_TICKS = 180;

/** A recall scroll read to the end: one used up, and player s (and their mercenaries) home: their bed, an inn, or where the world starts. */
export function recallHome(game, s) {
  const w = s.world;
  if (w.inv.remove('recall_scroll', 1) < 1) return;
  const home = homeOf(game, s), p = safeSpot(game.world, (home || game.world.spawns[0]).x, (home || game.world.spawns[0]).y);
  game.fx?.sparks?.(s.x, s.y - 14, 0, -1);
  s.body.x = p.x; s.body.y = p.y; s.body.vx = s.body.vy = 0;
  for (const m of game.soldiers) if (m.alive && m.npc?.kind === 'merc' && m.npc.owner === s.id) { m.body.x = p.x - s.facing * 20; m.body.y = p.y; m.body.vx = m.body.vy = 0; }
  game.sound('respawnItem', p.x, p.y);
  game.notify(s, home ? 'Home again' : 'Back where the world starts (you have no bed)');
}

/**
 * Player s's bag put away into the chests near them (and shulker boxes) that have some of the same
 * things already: as much as fits (not what's in the hotbar, coins, gear or what's for quests).
 * Returns what to tell them.
 */
export function stackToChests(game, s) {
  const world = game.world, inv = s.world.inv, cx = Math.floor(s.x / TILE), cy = Math.floor((s.y - 8) / TILE);
  const boxes = [];
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -8; dx <= 8; dx++) {
      const tx = cx + dx, ty = cy + dy;
      if (isContainer(world.tile(tx, ty)) && mayChange(world, s, tx, ty)) boxes.push(chestAt(world, tx, ty));
    }
  }
  let moved = 0;
  const into = new Set();
  for (let i = HOTBAR; i < inv.slots.length; i++) {
    for (const b of boxes) {
      const sl = inv.slots[i];
      if (!sl || sl.key === 'coins' || sl.g || itemOf(sl.key)?.kind === 'quest') break;
      if (b.refuse?.(sl.key) || !b.slots.some(o => o?.key === sl.key)) continue;
      const had = sl.n;
      Inventory.send(inv, i, b, 0);
      const left = inv.slots[i] === sl ? sl.n : 0;
      if (left < had) { moved += had - left; into.add(b); }
    }
  }
  if (moved) game.sound('pickup', s.x, s.y, s.id);
  return moved ? `Put ${moved} thing${moved > 1 ? 's' : ''} away, in ${into.size} chest${into.size > 1 ? 's' : ''} that had some already` : boxes.length ? 'Nothing to put away: no chest near has any of what\'s in your bag' : 'No chests near enough';
}

// ---- Graves ----------------------------------------------------------------------------------------
//
// What a player loses when they die goes in a grave where they died, the world's choice (world.death):
//   'coins'  half their coins
//   'bag'    half their coins, and their bag (the hotbar's kept, and what they wear)
//   'all'    all their coins and everything they have, worn or carried
// What's carried for a quest is always kept. Their grave is theirs to open (a right click: all of
// it back, as much as they have room for); after GRAVE_KEEP, anyone's.

export const DEATH_RULES = ['coins', 'bag', 'all'];
export const DEATH_NAMES = { coins: 'Half your coins', bag: 'Your bag, and half your coins', all: 'Everything' };
/** How long (ms) only a grave's owner can open it. */
export const GRAVE_KEEP = 15 * 60 * 1000;
const GRAVE_SIZE = HOTBAR + 30 + SLOTS.length + 2;

/** The grave at (tx, ty): { owner, at (when, ms), inv, worn: { slot: { key, n, g } } }, or null. */
export function graveAt(world, tx, ty) {
  if (world.tile(tx, ty) !== K.GRAVE) return null;
  return world.graves?.get(chestKey(tx, ty)) || null;
}

/** Where a grave goes for someone who died at (x, y): an empty place there (or near), down on the ground. */
function graveSpot(world, x, y) {
  const tx0 = Math.floor(x / TILE), ty0 = Math.floor(y / TILE);
  const free = (tx, ty) => ty > 1 && ty < WORLD_H - 2 && world.tile(tx, ty) === AIR;
  for (let r = 0; r <= 5; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        let tx = tx0 + dx, ty = ty0 + dy;
        if (!free(tx, ty)) continue;
        for (let k = 0; k < 40 && free(tx, ty + 1); k++) ty++;
        return { tx, ty };
      }
    }
  }
  return null;
}

/** Player s has died (at where they are): what they lose goes in a grave there (DEATH_RULES). */
export function bury(game, s) {
  const world = game.world, w = s.world, rule = DEATH_RULES.includes(world.death) ? world.death : 'bag', inv = w.inv;
  const box = new Inventory(GRAVE_SIZE), worn = {};
  const coins = inv.count('coins'), lose = rule === 'all' ? coins : Math.floor(coins / 2);
  if (lose > 0) { inv.remove('coins', lose); box.add('coins', lose); }
  if (rule !== 'coins') {
    for (let i = rule === 'all' ? 0 : HOTBAR; i < inv.slots.length; i++) {
      const sl = inv.slots[i], at = box.slots.indexOf(null);
      // (Quest things are kept; and coins, but for what's lost of them: above.)
      if (!sl || at < 0 || itemOf(sl.key)?.kind === 'quest' || sl.key === 'coins') continue;
      box.slots[at] = sl;
      inv.slots[i] = null;
    }
    inv.version++;
    if (rule === 'all') {
      for (const k of SLOTS) if (w.gear?.[k]) { worn[k] = w.gear[k]; w.gear[k] = null; }
      if (Object.keys(worn).length) { w.gearV = (w.gearV || 0) + 1; applyProgress(s); }
    }
  }
  if (!box.slots.some(Boolean) && !Object.keys(worn).length) return null;
  const spot = graveSpot(world, s.x, s.y + BODY.bottom - 6);
  if (!spot) {
    // (Nowhere for it: on the ground, then.)
    for (const sl of [...box.slots, ...Object.values(worn)]) if (sl) dropItem(game, sl.key, sl.n, s.x, s.y - 10, (game.rng() - 0.5) * 3, -2, 60, sl.g || null);
    return null;
  }
  world.setTile(spot.tx, spot.ty, K.GRAVE);
  (world.graves ||= new Map()).set(chestKey(spot.tx, spot.ty), { owner: s.name, at: Date.now(), inv: box, worn });
  w.graves = [...(w.graves || []).filter(([x, y]) => x !== spot.tx || y !== spot.ty), [spot.tx, spot.ty]].slice(-8);
  game.notify(s, `${DEATH_NAMES[rule]}: in your grave where you died. Right click it to have it back`);
  return spot;
}

/** Player s opens the grave at (tx, ty): everything in it back (to its owner; after a while, to anyone), as much as there's room for. */
export function openGrave(game, s, tx, ty) {
  const world = game.world, gr = graveAt(world, tx, ty), w = s.world, x = tx * TILE + 8, y = ty * TILE + 8;
  if (!gr) { world.setTile(tx, ty, AIR); return true; }
  const mine = gr.owner === s.name, wait = GRAVE_KEEP - (Date.now() - gr.at);
  if (!mine && wait > 0) { game.notify(s, `${gr.owner}'s grave: only they can open it, for ${Math.ceil(wait / 60000)} more minutes`); return true; }
  const inv = w.inv;
  // (What was worn, back on, if nothing else is there now.)
  for (const [k, it] of Object.entries(gr.worn || {})) {
    if (mine && !w.gear[k]) { w.gear[k] = it; delete gr.worn[k]; w.gearV = (w.gearV || 0) + 1; }
    else { const at = inv.slots.indexOf(null); if (at >= 0) { inv.slots[at] = it; delete gr.worn[k]; } }
  }
  for (let i = 0; i < gr.inv.slots.length; i++) {
    const sl = gr.inv.slots[i];
    if (!sl) continue;
    if (sl.g || sl.mag != null || (itemOf(sl.key)?.stack ?? 1) === 1) {
      const at = inv.slots.indexOf(null);
      if (at >= 0) { inv.slots[at] = sl; gr.inv.slots[i] = null; }
    } else {
      const left = inv.add(sl.key, sl.n);
      if (left > 0) sl.n = left; else gr.inv.slots[i] = null;
    }
  }
  inv.version++;
  gr.inv.version++;
  applyProgress(s);
  const left = gr.inv.slots.some(Boolean) || Object.keys(gr.worn || {}).length > 0;
  if (!left) {
    world.graves.delete(chestKey(tx, ty));
    world.setTile(tx, ty, AIR);
    const owner = game.soldiers.find(o => o.world && o.name === gr.owner);
    if (owner) owner.world.graves = (owner.world.graves || []).filter(([a, b]) => a !== tx || b !== ty);
    game.fx?.rubble?.(x, y, 4);
  }
  game.notify(s, `${mine ? 'Your things, back' : `${gr.owner}'s things`}${left ? ' (no room for the rest: it stays in the grave)' : ''}`);
  game.sound('respawnItem', x, y);
  return true;
}

/** A world's graves as saved: [[tx, ty, owner, at, things, worn]]. */
export function gravesToSave(world) {
  const out = [];
  for (const [k, gr] of world.graves || []) {
    const [tx, ty] = k.split(',').map(Number);
    if (world.tile(tx, ty) === K.GRAVE) out.push([tx, ty, gr.owner, gr.at, gr.inv.toJSON(), Object.fromEntries(Object.entries(gr.worn || {}).map(([s, it]) => [s, [it.key, it.g]]))]);
  }
  return out;
}

/** A world's graves from a save. */
export function gravesFromSave(world, list) {
  world.graves = new Map();
  if (!Array.isArray(list)) return;
  for (const row of list) {
    if (!Array.isArray(row) || !Number.isInteger(row[0]) || !Number.isInteger(row[1])) continue;
    const worn = {};
    for (const [k, it] of Object.entries(row[5] || {})) if (SLOTS.includes(k) && Array.isArray(it) && itemOf(it[0])?.kind === 'gear') worn[k] = { key: it[0], n: 1, g: cleanGear(it[1]) || { r: 'basic', name: itemOf(it[0]).name, stats: {}, ilvl: 1 } };
    world.graves.set(chestKey(row[0], row[1]), { owner: String(row[2] || '').slice(0, 24), at: Number(row[3]) || 0, inv: Inventory.from(row[4], GRAVE_SIZE), worn });
  }
}

// ---- Players' things ---------------------------------------------------------------------------

/** A soldier's world state: their things, and what they're doing with them. */
export function worldState(inv = Inventory.starting()) {
  return {
    inv, slot: 0, slot2: -1, brush: 'single', target: null, mine: null, cool: 0, drag: null, ammo: null,
    prevFire: false, prevAlt: false, altDone: false, got: [], warned: null,
    // What's worn (gear.js): each slot null or { key, n: 1, g }.
    gear: Object.fromEntries(SLOTS.map(k => [k, null])), gearV: 0,
  };
}

/** A soldier's world state as saved (worldsave.js): their things, where they were, their mercenaries. */
export function playerToSave(s, game = null) {
  const w = s.world;
  return {
    inv: w.inv.toJSON(), slot: w.slot, slot2: w.slot2, brush: w.brush, home: w.home || null,
    x: s.alive ? Math.round(s.x) : null, y: s.alive ? Math.round(s.y) : null,
    mercs: game ? mercsOf(game, s).map(m => ({ gun: m.npc.gun })) : [],
    // (Their level and perks, and their quests: progress.js, quests.js. What they wear: gear.js.)
    prog: progToSave(s), quests: questsToSave(s),
    gear: Object.fromEntries(SLOTS.map(k => [k, w.gear?.[k] ? [w.gear[k].key, w.gear[k].g] : null])),
    graves: w.graves || [], found: w.found || [], over: !!w.over,
    // (Their ender chest's things: the same in every ender chest.)
    ender: w.ender?.slots.some(Boolean) ? w.ender.toJSON() : null,
  };
}

/** A soldier's world state from a save (or a new character's, with nothing saved). */
export function worldFromSave(p, kit = null) {
  // (A new character: what the world says they start with: worldrules.js.)
  const w = worldState(Array.isArray(p?.inv) ? Inventory.from(p.inv) : kit ? Inventory.starting(kit) : Inventory.starting());
  if (!p) return w;
  // (Hardcore: their one life spent.)
  if (p.over) w.over = true;
  w.slot = Math.max(0, Math.min(HOTBAR - 1, p.slot | 0));
  w.slot2 = Number.isInteger(p.slot2) && p.slot2 >= 0 && p.slot2 < HOTBAR ? p.slot2 : -1;
  if (BRUSHES.includes(p.brush)) w.brush = p.brush;
  if (Number.isFinite(p.home?.x) && Number.isFinite(p.home?.y)) {
    w.home = { x: p.home.x, y: p.home.y };
    // (A bed's tile, to check it's still there; an inn's rest.)
    if (Number.isInteger(p.home.tx) && Number.isInteger(p.home.ty)) { w.home.tx = p.home.tx; w.home.ty = p.home.ty; }
    if (p.home.inn) w.home.inn = true;
  }
  // (Back where they were, the first time they spawn.)
  if (Number.isFinite(p.x) && Number.isFinite(p.y)) w.resume = { x: p.x, y: p.y };
  // (Their mercenaries, hired again when they're back: rehire.)
  w.mercs = Array.isArray(p.mercs) ? p.mercs.filter(m => WEAPONS[m?.gun]).slice(0, MERC.most) : [];
  progFromSave(w, p.prog);
  questsFromSave(w, p.quests);
  w.found = cleanFound(p.found);
  if (Array.isArray(p.ender)) w.ender = Inventory.from(p.ender, CHEST_SIZE);
  w.graves = Array.isArray(p.graves) ? p.graves.filter(g => Array.isArray(g) && Number.isInteger(g[0]) && Number.isInteger(g[1])).slice(-8).map(g => [g[0], g[1]]) : [];
  for (const k of SLOTS) {
    const it = p.gear?.[k];
    if (Array.isArray(it) && itemOf(it[0])?.kind === 'gear' && itemOf(it[0]).wear === slotKind(k)) w.gear[k] = { key: it[0], n: 1, g: cleanGear(it[1]) || { r: 'basic', name: itemOf(it[0]).name, stats: {}, ilvl: 1 } };
  }
  return w;
}

/** A player's mercenaries, as saved, hired again (they appear beside them). */
export function rehire(game, s) {
  for (const m of s.world?.mercs || []) hireMerc(game, s, m.gun);
  if (s.world) s.world.mercs = [];
}

/**
 * Somewhere a soldier fits at or above (x, y) (a body's middle): blocks built where they
 * left, or where the world starts, are climbed out of; with no room within a long way up,
 * the top of the ground there.
 */
export function safeSpot(world, x, y) {
  const fits = yy => !world.overlap(x - BODY.halfW, yy + BODY.top, x + BODY.halfW, yy + BODY.bottom);
  for (let up = 0; up < 96; up++) {
    const yy = y - up * TILE;
    if (yy + BODY.top < 0) break;
    if (fits(yy)) return { x, y: yy };
  }
  const tx = Math.floor(x / TILE);
  return { x: tx * TILE + TILE / 2, y: world.surface(tx) * TILE - BODY.bottom - 1 };
}

/** What's in the soldier's hand now ({ key, n } and its item), or nulls. */
export function inHand(s) {
  const w = s.world, slot = w?.inv.slots[w.slot];
  return slot ? { slot, item: itemOf(slot.key) } : { slot: null, item: null };
}

/** What's in the soldier's right hand (what right click uses): { slot, item }, or nulls. Never a gun. */
export function rightHand(s) {
  const w = s.world, slot = w && w.slot2 >= 0 ? w.inv.slots[w.slot2] : null, item = slot && itemOf(slot.key);
  return item && item.kind !== 'weapon' ? { slot, item } : { slot: null, item: null };
}

/**
 * Pick what right click uses: v is a hotbar slot ('0'-'9': the one already picked again, none),
 * '+' or '-' (the next or the one before, round the hotbar and through none), or 'x' (none).
 * Guns stay in the left hand (right click aims them). Returns the slot picked (-1: none).
 */
export function setRightHand(game, s, v, quiet = false) {
  const w = s.world;
  if (!w) return -1;
  let n = w.slot2;
  if (v === 'x') n = -1;
  else if (v === '+' || v === '-') {
    // (Round the hotbar's slots that hold something a right hand can, and none.)
    const ok = i => i === -1 || (w.inv.slots[i] && itemOf(w.inv.slots[i].key)?.kind !== 'weapon');
    const d = v === '+' ? 1 : -1;
    for (let k = 0; k <= HOTBAR; k++) { n = n + d < -1 ? HOTBAR - 1 : n + d >= HOTBAR ? -1 : n + d; if (ok(n)) break; }
  } else if (/^\d$/.test(v)) {
    const i = Number(v);
    const it = w.inv.slots[i] && itemOf(w.inv.slots[i].key);
    if (it?.kind === 'weapon') { if (!quiet) game.notify(s, `${it.name}: guns stay in your left hand (right click aims them)`); return w.slot2; }
    n = w.slot2 === i ? -1 : i;
  }
  w.slot2 = n;
  if (!quiet) {
    const it = n >= 0 && w.inv.slots[n] ? itemOf(w.inv.slots[n].key) : null;
    game.notify(s, n < 0 ? 'Right click: nothing (doors, chests and beds; it aims a gun)' : `Right click: ${it ? it.name : `slot ${(n + 1) % 10} (empty)`}`);
  }
  return n;
}

// How items look in the hand (drawn as a weapon would be: sprites.js).
const LOOKS = new Map();
function heldLook(it) {
  let l = LOOKS.get(it.key);
  if (l) return l;
  if (it.kind === 'tool') {
    const type = it.tool === 'pick' ? 'pickaxe' : it.tool === 'axe' ? 'axe' : 'mallet';
    l = { kind: 'melee', look: { type, length: 13, color: it.handle, head: it.color } };
  } else if (it.key === 'torch') l = { kind: 'build', look: { type: 'torch' } };
  else if (it.kind === 'block' || it.kind === 'wall' || it.kind === 'ammo' || it.kind === 'material' || it.kind === 'contract') {
    l = { kind: 'build', look: { type: 'block', color: it.color || '#888', dark: it.dark || '#555' } };
  } else l = WEAPONS.Hands;
  LOOKS.set(it.key, l);
  return l;
}

/**
 * Put what's in the hotbar slot in the soldier's hand: a gun (its spare rounds are the
 * inventory's ammunition for it; its magazine stays with it in its slot), or anything else
 * in their hands (drawn as it is). First, what the gun they had used since the last update
 * (shots, and rounds loaded into its magazine) comes out of the inventory.
 */
export function hold(s) {
  const w = s.world, a = w.ammo;
  if (a) {
    const inv = s.weapons[a.weapon];
    if (inv) {
      if (a.key && Number.isFinite(inv.ammo) && inv.ammo < a.had) w.inv.remove(a.key, a.had - inv.ammo);
      if (a.slot && Number.isFinite(inv.mag)) a.slot.mag = inv.mag;
    }
  }
  const { slot, item } = inHand(s);
  if (item?.kind === 'weapon') {
    // (A dropped weapon with affixes of its own: gear.js. The game asks for it through weaponFor.)
    const id = item.weapon, def = weaponWith(id, slot.g?.stats), key = item.ammo === 'self' ? item.key : item.ammo;
    if (w.own?.slot !== slot || w.own.g !== slot.g) w.own = { slot, g: slot.g, fn: slot.g ? x => (x === id ? def : null) : null };
    s.weaponOverride = w.own.fn;
    let inv = s.weapons[id];
    if (!a || a.slot !== slot || a.weapon !== id || !inv) {
      // (Another gun in hand: a reload under way is lost.)
      s.reloadTimer = 0;
      s.reloading = null;
      s.weapons = {};
      inv = s.weapons[id] = def.mag ? { ammo: 0, mag: Math.max(0, Math.min(def.mag, slot.mag || 0)) } : { ammo: 0 };
    }
    inv.ammo = key ? w.inv.count(key) : Infinity;
    w.ammo = { key, weapon: id, had: inv.ammo, slot };
    s.current = id;
    s.held = null;
  } else {
    if (a) { s.weapons = {}; s.reloadTimer = 0; s.reloading = null; }
    w.ammo = null;
    s.weaponOverride = null;
    s.current = 'Hands';
    s.held = item ? heldLook(item) : null;
  }
}

// ---- Things on the ground --------------------------------------------------------------------------

/**
 * Put n of `key` on the ground at (x, y) (thrown with speed vx, vy; delay: updates before it can be
 * picked up; g: a piece of gear's details, gear.js: each piece lies on its own).
 */
export function dropItem(game, key, n, x, y, vx = 0, vy = -1.5, delay = 0, g = null) {
  const world = game.world;
  if (!itemOf(key) || n <= 0) return null;
  const drops = world.drops ||= [];
  // (Next to the same thing lying still: one pile.)
  if (!g) for (const d of drops) {
    if (d.key === key && !d.g && !delay && Math.abs(d.x - x) < 12 && Math.abs(d.y - y) < 12 && d.rest) { d.n += n; return d; }
  }
  const d = { key, n, x, y, px: x, py: y, vx: vx * MOTION.timeScale, vy: vy * MOTION.timeScale, age: 0, delay, rest: false, g };
  drops.push(d);
  if (drops.length > MAX_DROPS) drops.splice(0, drops.length - MAX_DROPS);
  return d;
}

/** Things on the ground fall, settle, and fly to whoever's near enough to pick them up. */
function updateDrops(game) {
  const world = game.world, drops = world.drops;
  if (!drops?.length) return;
  const ts = MOTION.timeScale;
  let n = 0;
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    d.age += 1;
    if (d.delay > 0) d.delay--;
    d.px = d.x; d.py = d.y;
    if (d.age * ts > DROP_LIFE || d.n <= 0) { d.n = 0; continue; }
    // The nearest player with room for it, close by, pulls it in.
    let to = null, best = 60 * 60;
    if (d.delay <= 0) {
      for (const s of game.soldiers) {
        if (!s.alive || !s.world) continue;
        const dx = s.x - d.x, dy = s.y - 8 - d.y, dd = dx * dx + dy * dy;
        if (dd < best && (d.g ? s.world.inv.slots.includes(null) : s.world.inv.room(d.key) > 0)) { best = dd; to = s; }
      }
    }
    if (to) {
      const dx = to.x - d.x, dy = to.y - 8 - d.y, dist = Math.sqrt(dx * dx + dy * dy) || 1;
      if (dist < 12) {
        // (A piece of gear: into a slot of its own.)
        const left = d.g ? (to.world.inv.addGear(d.key, d.g) ? 0 : d.n) : to.world.inv.add(d.key, d.n);
        const took = d.n - left;
        if (took > 0) {
          gotItem(game, to, d.key, took, d.g);
          d.n = left;
        }
        if (d.n <= 0) continue;
      }
      const pull = 4.5 * ts;
      d.vx = (dx / dist) * pull;
      d.vy = (dy / dist) * pull;
      d.x += d.vx; d.y += d.vy;
      d.rest = false;
      drops[n++] = d;
      continue;
    }
    // Falling, and coming to rest on whatever's solid.
    d.vy = Math.min(d.vy + MOTION.itemGravity, MOTION.itemMaxFall);
    const nx = d.x + d.vx;
    if (SOLID[world.tileAt(nx, d.y)]) d.vx = 0; else d.x = nx;
    const ny = d.y + d.vy + 3;
    const under = world.tileAt(d.x, ny);
    if (SOLID[under] || (PLATFORMS[under] && d.vy >= 0 && Math.floor((d.y + 3) / TILE) < Math.floor(ny / TILE))) {
      d.y = Math.floor(ny / TILE) * TILE - 3;
      d.vy = 0;
      d.vx *= 0.7;
      const was = d.rest;
      d.rest = Math.abs(d.vx) < 0.05;
      // Come to rest by a pile of the same thing: one pile.
      if (d.rest && !was) {
        const o = drops.find(o => o !== d && o.rest && o.n > 0 && o.key === d.key && Math.abs(o.x - d.x) < 12 && Math.abs(o.y - d.y) < 12);
        if (o) { o.n += d.n; d.n = 0; continue; }
      }
    } else { d.y += d.vy; d.rest = false; }
    drops[n++] = d;
  }
  drops.length = n;
}

/** Something picked up: a sound for its owner, and a line on their screen (the HUD's list; gear: its name and rarity). */
function gotItem(game, s, key, n, g = null) {
  game.sound('pickup', s.x, s.y, s.id);
  const got = s.world.got, last = got[got.length - 1];
  if (!g && last && !last.r && last.key === key && game.tick - last.tick < 90) { last.n += n; last.tick = game.tick; }
  else got.push(g ? { key, n, tick: game.tick, r: g.r, name: g.name } : { key, n, tick: game.tick });
  if (got.length > 8) got.shift();
}

// ---- Digging ---------------------------------------------------------------------------------------

/** The tile under the soldier's crosshair, and whether it's in reach. */
export function targetOf(s, inp) {
  const a = inp?.aim ?? s.aim, d = Math.min(inp?.aimDist ?? s.aimDist ?? 0, 4000);
  const x = s.shoulderX + Math.cos(a) * d, y = s.shoulderY + Math.sin(a) * d;
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  const cx = tx * TILE + TILE / 2 - s.shoulderX, cy = ty * TILE + TILE / 2 - s.shoulderY;
  return { tx, ty, x, y, near: cx * cx + cy * cy <= REACH * REACH };
}

/** Whether tool `it` can dig block b (and how: 'ok', 'tier': it needs a better one, or null: the wrong tool). */
function digs(it, b) {
  if (b.id === AIR) return null;
  if (b.tool === 'hand' || b.tool === 'any') return 'ok';
  if (!it) return null;
  const right = it.tool === 'pick' ? b.tool === 'pick' : it.tool === 'axe' ? b.tool === 'axe' || b.wood : false;
  if (!right) return null;
  return b.tier > (it.tier ?? 0) ? 'tier' : 'ok';
}

/**
 * Holding the use button with a pickaxe or axe: hits at the block under the crosshair (if it's
 * in reach) until it breaks. Returns false if there's nothing it can dig there (the swing hits
 * whoever's in front instead).
 */
function dig(game, s, it, inp) {
  const w = s.world, t = w.target, world = game.world;
  const b = BLOCKS[world.tile(t.tx, t.ty)];
  const how = t.near ? digs(it, b) : null;
  if (!how) return false;
  if (!mayChange(world, s, t.tx, t.ty)) return notYours(game, s, t.tx, t.ty) || true;
  if (w.cool > 0) return true;
  w.cool = it.every / MOTION.timeScale;
  s.anim.swing = 1;
  const x = t.tx * TILE + TILE / 2, y = t.ty * TILE + TILE / 2;
  if (how === 'tier') {
    game.sound('tink', x, y);
    if (w.warned !== b.id) { w.warned = b.id; game.notify(s, `${b.name} needs a better pickaxe`); }
    return true;
  }
  if (!w.mine || w.mine.tx !== t.tx || w.mine.ty !== t.ty || w.mine.layer !== 'fg') w.mine = { tx: t.tx, ty: t.ty, layer: 'fg', dmg: 0, of: b.hard };
  // (Faster with the Miner perk: progress.js.)
  w.mine.dmg += it.power * digScale(s);
  w.mine.at = game.tick;
  game.fx?.sparks?.(x, y, 0, -1);
  if (w.mine.dmg >= Math.max(0.5, b.hard)) {
    breakBlock(game, t.tx, t.ty, s);
    w.mine = null;
  } else game.sound(it.tool === 'axe' || b.wood ? 'thunk' : 'tink', x, y);
  return true;
}

/**
 * Break the block at (tx, ty), dropping what it gives (by: who broke it). Trees fall whole,
 * doors come down whole, crates spill what's in them, and whatever stood on it goes too.
 */
export function breakBlock(game, tx, ty, by = null) {
  const world = game.world, id = world.tile(tx, ty), b = BLOCKS[id];
  if (id === AIR || b.resist >= 1e9) return false;
  const x = tx * TILE + TILE / 2, y = ty * TILE + TILE / 2;
  if (id === K.TRUNK) return fell(game, tx, ty);
  if (DOORS.has(id)) {
    // The whole door (three tall).
    let top = ty, bottom = ty;
    while (DOORS.has(world.tile(tx, top - 1))) top--;
    while (DOORS.has(world.tile(tx, bottom + 1))) bottom++;
    for (let yy = top; yy <= bottom; yy++) world.setTile(tx, yy, AIR);
    dropItem(game, 'door', 1, x, (top + bottom + 1) * TILE / 2);
  } else {
    world.setTile(tx, ty, AIR);
    if (id === K.LOOT_CRATE) openCrate(game, x, y);
    // (A shulker box: picked up whole, what's in it kept in it.)
    else if (K.SHULKER_BOXES.has(id)) dropShulker(game, tx, ty, id, x, y);
    else if (b.drop) {
      dropItem(game, b.drop, 1, x, y);
      // Mined by a player: experience for ore and gems (and, with the Prospector perk, now and
      // then twice as much), and quests that count what's mined.
      if (by?.world && MINE_XP[b.drop]) {
        if (game.rng() < doubleOreChance(by)) dropItem(game, b.drop, 1, x, y);
        giveXp(game, by, MINE_XP[b.drop], b.name);
        countStat(by, 'mined');
        questEvent(game, by, { type: 'mine', key: b.drop });
      }
    }
    if (id === K.CHEST) spillChest(game, tx, ty);
    if (id === K.CLAIM_FLAG) world.claims?.delete(`${tx},${ty}`);
    if (id === K.WAYSTONE) removeWaystone(world, tx, ty);
  }
  game.sound(b.wood ? 'thunk' : 'smash', x, y);
  game.fx?.rubble?.(x, y, 6);
  settle(game, tx, ty);
  return true;
}

/** After (tx, ty) changed: what stood on it, hung from it or leant on it goes too. */
function settle(game, tx, ty) {
  const world = game.world;
  for (const [x, y] of [[tx, ty - 1], [tx, ty + 1], [tx - 1, ty], [tx + 1, ty]]) {
    const id = world.tile(x, y);
    if (id === AIR || supported(world, x, y, id)) continue;
    const b = BLOCKS[id];
    if (DOORS.has(id)) { breakBlock(game, x, y); continue; }
    world.setTile(x, y, AIR);
    if (K.SHULKER_BOXES.has(id)) dropShulker(game, x, y, id, x * TILE + TILE / 2, y * TILE + TILE / 2);
    else if (b.drop) dropItem(game, b.drop, 1, x * TILE + TILE / 2, y * TILE + TILE / 2);
    if (id === K.CHEST) spillChest(game, x, y);
    if (id === K.CLAIM_FLAG) world.claims?.delete(`${x},${y}`);
    if (id === K.WAYSTONE) removeWaystone(world, x, y);
    settle(game, x, y);
  }
}

/** Whether block `id` at (x, y) still has what it needs to stay up. */
function supported(world, x, y, id) {
  if (BLOCKS[id].furniture) return SOLID[world.tile(x, y + 1)] || PLATFORMS[world.tile(x, y + 1)];
  if (NEEDS_GROUND.has(id)) return SOLID[world.tile(x, y + 1)] || (id === K.CACTUS && world.tile(x, y + 1) === K.CACTUS) || (id === K.CACTUS && (world.tile(x - 1, y) === K.CACTUS || world.tile(x + 1, y) === K.CACTUS));
  if (id === K.VINE) return world.tile(x, y - 1) === K.VINE || SOLID[world.tile(x, y - 1)] || LEAF.has(world.tile(x, y - 1));
  if (id === K.TORCH) return SOLID[world.tile(x, y + 1)] || SOLID[world.tile(x - 1, y)] || SOLID[world.tile(x + 1, y)] || world.wall(x, y) !== NO_WALL;
  if (id === K.LANTERN || id === K.BANNER || id === K.FENCE) return hangsOrStands(world, x, y, id);
  if (DOORS.has(id)) {
    let bottom = y;
    while (DOORS.has(world.tile(x, bottom + 1))) bottom++;
    return SOLID[world.tile(x, bottom + 1)];
  }
  return true;
}

/**
 * What lanterns, banners and fences need: a lantern hangs from a block or platform above, or
 * stands on a block or a post; a banner hangs from a block above or a wall behind; a fence
 * stands on the ground, or another fence.
 */
function hangsOrStands(world, x, y, id) {
  const above = world.tile(x, y - 1), below = world.tile(x, y + 1);
  if (id === K.FENCE) return !!(SOLID[below] || PLATFORMS[below]) || below === K.FENCE || below === K.POST;
  if (id === K.BANNER) return !!(SOLID[above] || PLATFORMS[above]) || world.wall(x, y) !== NO_WALL;
  return !!(SOLID[above] || PLATFORMS[above] || SOLID[below]) || below === K.FENCE || below === K.POST || world.wall(x, y) !== NO_WALL;
}

/** A tree cut at (tx, ty): everything above comes down (the trunk and its crown) as wood. */
function fell(game, tx, ty) {
  const world = game.world;
  let top = ty, wood = 0;
  while (world.tile(tx, top - 1) === K.TRUNK) top--;
  for (let y = top; y <= ty; y++) { world.setTile(tx, y, AIR); wood++; }
  // The crown: leaves joined to the top of the trunk, within a few tiles of it.
  const seen = new Set(), stack = [[tx, top - 1], [tx - 1, top], [tx + 1, top], [tx, top]];
  while (stack.length) {
    const [x, y] = stack.pop(), k = `${x},${y}`;
    if (seen.has(k) || Math.abs(x - tx) > 5 || y < top - 6 || y > top + 6) continue;
    seen.add(k);
    if (!LEAF.has(world.tile(x, y)) && !(x === tx && y === top)) continue;
    if (LEAF.has(world.tile(x, y))) world.setTile(x, y, AIR);
    stack.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
  }
  const x = tx * TILE + TILE / 2, y = (top + ty) * TILE / 2;
  dropItem(game, 'wood', wood, x, y);
  game.sound('thunk', x, y);
  game.fx?.rubble?.(x, y, 10);
  settle(game, tx, ty);
  return true;
}

// What's in a supply crate: [key, least, most, weight].
const LOOT = CRATE_LOOT;
const LOOT_WEIGHT = LOOT.reduce((n, l) => n + l[3], 0);

/** A supply crate broken open: three or four things fly out. */
function openCrate(game, x, y) {
  const n = 3 + Math.floor(game.rng() * 2);
  for (let i = 0; i < n; i++) {
    let r = game.rng() * LOOT_WEIGHT, pick = LOOT[0];
    for (const l of LOOT) { r -= l[3]; if (r <= 0) { pick = l; break; } }
    const [key, lo, hi] = pick;
    dropItem(game, key, lo + Math.floor(game.rng() * (hi - lo + 1)), x, y - 4, (game.rng() - 0.5) * 4, -2 - game.rng() * 2);
  }
  // (Now and then a piece of gear, as good as how deep it was: gear.js.)
  if (game.rng() < 0.35) {
    const depth = Math.max(0, Math.floor(y / TILE) - game.world.gen.surfaceAt(Math.floor(x / TILE)));
    const piece = rollGear(dropSeed(game.world.gen.seed + game.tick, Math.floor(x), Math.floor(y)), dropLevel(depth, 'skeleton', 1), 0);
    dropItem(game, piece.key, 1, x, y - 4, (game.rng() - 0.5) * 4, -2.5, 0, piece.g);
  }
  game.sound('respawnItem', x, y);
}

// ---- Building --------------------------------------------------------------------------------------

/** Whether item `it` can go at (tx, ty) now. */
export function canPlace(game, it, tx, ty) {
  const world = game.world;
  if (ty < 1 || ty >= WORLD_H - 1) return false;
  if (it.kind === 'wall') {
    if (world.wall(tx, ty) !== NO_WALL) return false;
    // (Against another wall or a block.)
    for (const [x, y] of AROUND) if (world.wall(tx + x, ty + y) !== NO_WALL || world.tile(tx + x, ty + y) !== AIR) return true;
    return world.tile(tx, ty) !== AIR;
  }
  const id = it.block, cur = world.tile(tx, ty);
  if (cur !== AIR && !SOFT.has(cur)) return false;
  if (id === K.DOOR) return doorSpot(game, tx, ty) != null;
  if (SOLID[id] && soldierIn(game, tx, ty, ty)) return false;
  if (id === K.TORCH) return SOLID[world.tile(tx, ty + 1)] || SOLID[world.tile(tx - 1, ty)] || SOLID[world.tile(tx + 1, ty)] || world.wall(tx, ty) !== NO_WALL;
  if (id === K.LANTERN || id === K.BANNER || id === K.FENCE) return hangsOrStands(world, tx, ty, id);
  if (NEEDS_GROUND.has(id)) return SOLID[world.tile(tx, ty + 1)];
  // (Furniture stands on the floor, or a platform.)
  if (BLOCKS[id].furniture) return !!(SOLID[world.tile(tx, ty + 1)] || PLATFORMS[world.tile(tx, ty + 1)]);
  // Something to build onto: a block, platform or ladder beside it, or a wall behind.
  if (world.wall(tx, ty) !== NO_WALL) return true;
  for (const [x, y] of AROUND) {
    const n = world.tile(tx + x, ty + y);
    if (SOLID[n] || PLATFORMS[n] || n === K.LADDER || DOORS.has(n)) return true;
  }
  return false;
}
const AROUND = [[0, 1], [0, -1], [-1, 0], [1, 0]];

/** A door put at (tx, ty) goes from the floor up (three tall): the bottom row, or null if there's no room. */
function doorSpot(game, tx, ty) {
  const world = game.world;
  for (let bottom = ty; bottom <= ty + 2; bottom++) {
    if (!SOLID[world.tile(tx, bottom + 1)]) continue;
    for (let y = bottom - 2; y <= bottom; y++) { const c = world.tile(tx, y); if (c !== AIR && !SOFT.has(c)) return null; }
    return soldierIn(game, tx, bottom - 2, bottom) ? null : bottom;
  }
  return null;
}


/** Put one of the soldier's `it` at (tx, ty). Returns true if it went in. */
function placeOne(game, s, it, tx, ty) {
  const w = s.world, world = game.world;
  if (w.inv.count(it.key) <= 0 || !canPlace(game, it, tx, ty)) return false;
  if (!mayChange(world, s, tx, ty)) return notYours(game, s, tx, ty);
  // A base flag: not where it would take in someone else's base.
  if (it.block === K.CLAIM_FLAG) {
    for (const c of world.claims?.values() || []) {
      if (!sameName(c.owner, s.name) && Math.abs(c.tx - tx) <= 2 * CLAIM_R && Math.abs(c.ty - ty) <= 2 * CLAIM_R) {
        game.notify(s, `Too near ${c.owner}'s base`);
        return false;
      }
    }
  }
  if (it.kind === 'wall') world.setWall(tx, ty, it.wall);
  else if (it.block === K.DOOR) {
    const bottom = doorSpot(game, tx, ty);
    for (let y = bottom - 2; y <= bottom; y++) world.setTile(tx, y, K.DOOR);
  } else world.setTile(tx, ty, it.block);
  if (it.box) {
    // (A shulker box: the one in hand, what's in it put in the box put down.)
    const i = [w.slot, w.slot2].find(j => j >= 0 && w.inv.slots[j]?.key === it.key) ?? w.inv.slots.findIndex(sl => sl?.key === it.key);
    const sl = w.inv.slots[i];
    w.inv.slots[i] = null;
    w.inv.version++;
    world.chests?.delete(chestKey(tx, ty));
    if (sl?.g?.box?.length) {
      const inv = chestAt(world, tx, ty);
      inv.slots.fill(null);
      sl.g.box.slice(0, CHEST_SIZE).forEach((e, j) => { inv.slots[j] = e[3] ? { key: e[0], n: e[1], mag: e[2] || undefined, g: e[3] } : e[2] > 0 ? { key: e[0], n: e[1], mag: e[2] } : { key: e[0], n: e[1] }; });
      inv.version++;
    }
  } else w.inv.remove(it.key, 1);
  if (it.block === K.WAYSTONE) game.notify(s, `${addWaystone(world, tx, ty, s.name).name}: right click it to go to any other waystone`);
  if (it.block === K.CLAIM_FLAG) {
    (world.claims ||= new Map()).set(`${tx},${ty}`, { tx, ty, owner: s.name });
    game.notify(s, `Your base: nobody else can build, dig or open chests within ${CLAIM_R} blocks of the flag`);
  }
  return true;
}

/** The tiles of a dragged-out shape from a to b (brush 'line', 'rect' or 'box'), nearest a first. */
export function shapeTiles(brush, a, b) {
  const dx = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, b.tx - a.tx)), dy = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, b.ty - a.ty));
  const out = [];
  if (brush === 'line') {
    // Straight across, up and down, or at 45 degrees (stairs): whichever is nearest.
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const sx = Math.sign(dx), sy = Math.sign(dy);
    const n = Math.max(ax, ay);
    const diag = Math.min(ax, ay) > n / 2;
    for (let i = 0; i <= n; i++) {
      if (diag) out.push({ tx: a.tx + sx * Math.min(i, ax), ty: a.ty + sy * Math.min(i, ay) });
      else if (ax >= ay) out.push({ tx: a.tx + sx * i, ty: a.ty });
      else out.push({ tx: a.tx, ty: a.ty + sy * i });
    }
    return out;
  }
  const x0 = Math.min(a.tx, a.tx + dx), x1 = Math.max(a.tx, a.tx + dx), y0 = Math.min(a.ty, a.ty + dy), y1 = Math.max(a.ty, a.ty + dy);
  for (let y = y1; y >= y0; y--) {
    for (let x = x0; x <= x1; x++) {
      if (brush === 'box' && x !== x0 && x !== x1 && y !== y0 && y !== y1) continue;
      out.push({ tx: x, ty: y });
    }
  }
  // (Nearest the start first, so each block has the one before it to build onto.)
  out.sort((p, q) => (Math.abs(p.tx - a.tx) + Math.abs(p.ty - a.ty)) - (Math.abs(q.tx - a.tx) + Math.abs(q.ty - a.ty)));
  return out;
}

/** Holding blocks or walls: build where the crosshair is (or drag out a line, rectangle or box). */
function build(game, s, it, inp, pressed = inp.firePressed) {
  const w = s.world, t = w.target;
  const brush = it.block === K.DOOR || it.block === K.TORCH ? 'single' : w.brush;
  if (brush === 'single') {
    w.drag = null;
    if (!inp.fire || w.cool > 0 || !t.near) return;
    if (placeOne(game, s, it, t.tx, t.ty)) {
      w.cool = PLACE_EVERY / MOTION.timeScale;
      s.anim.swing = Math.max(s.anim.swing, 0.4);
      game.sound('build', t.tx * TILE + 8, t.ty * TILE + 8);
    }
    return;
  }
  if (inp.fire && pressed && t.near) w.drag = { tx: t.tx, ty: t.ty };
  if (inp.fire || !w.drag) return;
  // Let go: the whole shape goes in, as far as the blocks carried go (a few passes, so blocks
  // with nothing to build onto yet get it from those put in first).
  let left = shapeTiles(brush, w.drag, t), placed = 0;
  w.drag = null;
  for (let pass = 0; pass < 4 && left.length; pass++) {
    const next = [];
    for (const p of left) { if (placeOne(game, s, it, p.tx, p.ty)) placed++; else next.push(p); }
    if (next.length === left.length) break;
    left = next;
  }
  if (placed) {
    s.anim.swing = 1;
    game.sound('build', t.tx * TILE + 8, t.ty * TILE + 8);
    game.notify(s, `${placed} × ${it.name}`);
  }
}

/**
 * The builder's hammer: on a block, changes its shape (full, half, ramps: each hit the next);
 * where there's no block, takes down the wall behind.
 */
function hammer(game, s, it, inp) {
  const w = s.world, t = w.target, world = game.world;
  if (!inp.fire || w.cool > 0 || !t.near) return !!inp.fire && t.near;
  const id = world.tile(t.tx, t.ty), x = t.tx * TILE + 8, y = t.ty * TILE + 8;
  if (!mayChange(world, s, t.tx, t.ty)) return notYours(game, s, t.tx, t.ty) || true;
  w.cool = it.every / MOTION.timeScale;
  s.anim.swing = 1;
  if (SOLID[id]) {
    if (DOORS.has(id) || id === K.LOOT_CRATE || BLOCKS[id].resist >= 1e9) return true;
    world.setShape(t.tx, t.ty, (world.shape(t.tx, t.ty) + 1) % K.SHAPES.length);
    game.sound('tink', x, y);
    return true;
  }
  const wall = world.wall(t.tx, t.ty);
  if (wall === NO_WALL) return false;
  if (!w.mine || w.mine.tx !== t.tx || w.mine.ty !== t.ty || w.mine.layer !== 'bg') w.mine = { tx: t.tx, ty: t.ty, layer: 'bg', dmg: 0, of: 2 };
  w.mine.dmg += it.power;
  w.mine.at = game.tick;
  game.sound('thunk', x, y);
  if (w.mine.dmg >= 2) {
    world.setWall(t.tx, t.ty, NO_WALL);
    const drop = K.WALLS[wall].drop;
    if (drop) dropItem(game, drop, 1, x, y);
    settle(game, t.tx, t.ty);
    w.mine = null;
  }
  return true;
}

/**
 * Right click on something in reach: a door opens (or shuts, if nobody's in the way), a chest
 * opens (w.openChest: the page shows what's in it), a bed is where you'll come back.
 */
function interact(game, s) {
  const w = s.world, t = w.target, world = game.world;
  if (!t?.near) return false;
  const id = world.tile(t.tx, t.ty);
  if (id === K.GRAVE) return openGrave(game, s, t.tx, t.ty);
  // (A waystone: where it can take you, to choose: waystones.js.)
  if (id === K.WAYSTONE) {
    w.wayMenu = waystoneMenu(game, s, t.tx, t.ty);
    game.sound('click', t.tx * TILE + 8, t.ty * TILE + 8, s.id);
    return true;
  }
  if (isContainer(id) || id === K.ENDER_CHEST) {
    // (Someone's base: not their chests. An ender chest's things are your own, anywhere.)
    if (id !== K.ENDER_CHEST && !mayChange(world, s, t.tx, t.ty)) return notYours(game, s, t.tx, t.ty) || true;
    boxFor(game, s, t.tx, t.ty);
    w.openChest = { tx: t.tx, ty: t.ty };
    game.sound('click', t.tx * TILE + 8, t.ty * TILE + 8, s.id);
    return true;
  }
  if (id === K.BED) {
    // (Where you'll come back; at night, you sleep: sleep.js.)
    useBed(game, s, t.tx, t.ty);
    return true;
  }
  if (!DOORS.has(id)) return false;
  setDoor(game, t.tx, t.ty, id === K.DOOR);
  return true;
}

// ---- Each update, for each soldier ----------------------------------------------------------------

/**
 * The world's part in a soldier's update (the mode's input hook): the hotbar (the number keys,
 * the wheel), the brush (R), the use button with tools and blocks, right click on doors,
 * dropping what's in hand (G). Returns the input for the rest of the update (shooting is the
 * game's own, with a gun in hand).
 */
export function worldInput(game, s, inp) {
  const w = s.world;
  if (!w || !s.alive) return inp;
  if (game.mirror) return mirrorInput(game, s, inp);
  // (Asleep in a bed: kept there, till they move: sleep.js.)
  if (w.sleep) inp = sleepInput(game, s, inp);
  if (w.sleep) return inp;
  // The hotbar: slots by number ('#n': see setup), or along with the wheel and Q / E.
  if (typeof inp.switchTo === 'string' && inp.switchTo[0] === '#') w.slot = Math.max(0, Math.min(HOTBAR - 1, Number(inp.switchTo.slice(1)) || 0));
  else if (typeof inp.switchTo === 'string' && inp.switchTo[0] === '%') setRightHand(game, s, inp.switchTo.slice(1));
  else if (inp.cycle) w.slot = (w.slot + inp.cycle + HOTBAR) % HOTBAR;
  if (inp.switchTo || inp.cycle) { w.mine = null; w.drag = null; }
  inp = { ...inp, switchTo: null, cycle: 0 };
  hold(s);
  if (w.cool > 0) w.cool -= 1;
  // (Dev mode, devmode.js: wipes out and builds its own way.)
  if (w.dev) {
    const isBlocks = it => it && (it.kind === 'block' || it.kind === 'wall'), l = inHand(s).item, r = rightHand(s).item;
    return devInput(game, s, inp, isBlocks(l) ? l : isBlocks(r) ? r : null);
  }
  w.target = targetOf(s, inp);
  // (Hits on a block stop counting a while after you stop hitting it.)
  if (w.mine && game.tick - w.mine.at > 150) w.mine = null;
  // Walking into a closed door opens it (doors.js: it shuts again behind you).
  if (inp.move && !inp.crouch) pushDoor(game, s, Math.sign(inp.move));
  const { item } = inHand(s);
  // R: the next brush (holding blocks).
  if (inp.reload && item && (item.kind === 'block' || item.kind === 'wall')) {
    w.brush = BRUSHES[(BRUSHES.indexOf(w.brush) + 1) % BRUSHES.length];
    w.drag = null;
    game.notify(s, `Brush: ${BRUSH_NAMES[w.brush]}`);
    inp.reload = false;
  }
  // G: throw what's in hand.
  if (inp.drop) {
    inp.drop = false;
    const i = w.slot, slot = w.inv.slots[i];
    if (slot) {
      const taken = w.inv.take(i);
      dropItem(game, taken.key, taken.n, s.x + s.facing * 8, s.y - 14, s.facing * 3, -2, 60, taken.g || null);
      hold(s);
    }
  }
  // Right click: what's in the right hand (doors, chests and beds first, unless crouching); with
  // nothing there, doors, chests and beds (and with a gun in hand, aiming down the sights).
  const right = rightHand(s).item, alt = !!inp.alt, altPressed = alt && !w.prevAlt;
  w.prevAlt = alt;
  if (!alt) w.altDone = false;
  let useRight = false;
  // (Right click on another player: what you can do with them, social.js; not with a gun in hand
  // in a PvP world: that's aiming. On one of the townsfolk, whatever's in hand: talking, talk.js.)
  const other = altPressed && !inp.crouch && w.target && !(game.world.pvp && item?.kind === 'weapon') ? playerAt(game, s, w.target.x, w.target.y) : null;
  const npc = !other && altPressed && !inp.crouch && w.target ? folkAt(game, s, w.target.x, w.target.y) : null;
  if (other) { w.social = { id: other.id, at: game.tick }; w.altDone = true; inp.alt = false; }
  else if (npc && startTalk(game, s, npc)) { w.altDone = true; inp.alt = false; }
  else if (right) {
    if (altPressed && !inp.crouch && interact(game, s)) w.altDone = true;
    else if (alt && !w.altDone && !inp.fire) useRight = true;
    inp.alt = false;
  } else if (altPressed && item?.kind !== 'weapon') interact(game, s);
  const prevLeft = w.prevFire;
  w.prevFire = !!inp.fire;
  if (useRight || (right && !alt && w.drag && w.dragHand === 'right')) {
    // (Shown in hand while it's used, unless there's a gun in the left: that stays. Let go of
    // right click with a shape dragged out: the right hand's blocks go in.)
    if (item?.kind !== 'weapon') s.held = heldLook(right);
    w.dragHand = 'right';
    useItem(game, s, right, { ...inp, fire: useRight, firePressed: altPressed }, altPressed);
    inp.fire = false;
    inp.firePressed = false;
    return inp;
  }
  w.dragHand = 'left';
  const fire = useItem(game, s, item, inp, inp.fire && !prevLeft);
  inp.fire = fire;
  if (!fire) inp.firePressed = false;
  return inp;
}

/**
 * Use `item` (in either hand) with input `inp` (its fire: the button for that hand held; pressed:
 * just now). Returns whether a gun should fire (a weapon in hand): else the button's taken.
 */
function useItem(game, s, item, inp, pressed) {
  const w = s.world;
  let fire = inp.fire;
  if (item?.kind === 'food') {
    if (pressed) eat(game, s, item);
    fire = false;
  } else if (item?.kind === 'scroll') {
    if (pressed && !w.recall) {
      w.recall = { at: game.tick, x: s.x, y: s.y };
      game.notify(s, 'You read the scroll... (keep still)');
      game.sound('click', s.x, s.y, s.id);
    }
    fire = false;
  } else if (item?.kind === 'contract') {
    if (pressed) {
      if (mercsOf(game, s).length >= MERC.most) game.notify(s, `You can have ${MERC.most} mercenaries at a time`);
      else {
        w.inv.remove(item.key, 1);
        const m = hireMerc(game, s);
        game.notify(s, `${m.name} has joined you`);
        game.sound('spawn', s.x, s.y, s.id);
      }
    }
    fire = false;
  } else if (item?.kind === 'tool') {
    if (item.tool === 'hammer') { if (hammer(game, s, item, inp)) fire = false; }
    else if (inp.fire && dig(game, s, item, inp)) fire = false;
  } else if (item && (item.kind === 'block' || item.kind === 'wall')) {
    build(game, s, item, inp, pressed);
    fire = false;
  } else if (item && item.kind !== 'weapon') fire = false;
  // (Nothing in hand: a punch. And plants and torches break with anything.)
  if (!item && inp.fire && w.target.near && BLOCKS[game.world.tile(w.target.tx, w.target.ty)].tool === 'hand' && w.cool <= 0 && mayChange(game.world, s, w.target.tx, w.target.ty)) {
    breakBlock(game, w.target.tx, w.target.ty, s);
    w.cool = 12 / MOTION.timeScale;
    fire = false;
  }
  return !!fire;
}

/**
 * Player s made `made` lots of recipe r (crafting.js; the inventory screen, or online the host):
 * experience for what's worth something, and quests that count what's made.
 */
export function crafted(game, s, r, made) {
  if (!s?.world || made <= 0) return;
  const n = made * r.n, xp = Math.min(30, Math.round(valueOf(r.key) * n * 0.3));
  if (xp > 0) giveXp(game, s, xp, `made ${itemOf(r.key)?.name ?? r.key}`);
  countStat(s, 'crafted', n);
  questEvent(game, s, { type: 'craft', key: r.key, n });
}

/**
 * Player s puts on the piece of gear in slot i of their things (gear.js): where it's worn, swapped
 * with what was there (a ring: the empty ring finger, else the first). Returns what to tell them.
 */
export function equip(game, s, i) {
  const w = s.world, sl = w?.inv.slots[i], it = sl && itemOf(sl.key);
  if (!it || it.kind !== 'gear') return null;
  const where = it.wear === 'ring' ? (!w.gear.ring1 ? 'ring1' : !w.gear.ring2 ? 'ring2' : 'ring1') : it.wear;
  const was = w.gear[where];
  w.gear[where] = { key: sl.key, n: 1, g: sl.g || { r: 'basic', name: it.name, stats: {}, ilvl: 1 } };
  w.inv.slots[i] = was;
  w.inv.version++;
  w.gearV++;
  applyProgress(s);
  game.sound('click', s.x, s.y, s.id);
  return `Wearing ${w.gear[where].g.name}`;
}

/** Player s takes off what's worn in `slot` (into their things, if there's room). */
export function unequip(game, s, slot) {
  const w = s.world, it = w?.gear?.[slot];
  if (!it) return null;
  if (!w.inv.addGear(it.key, it.g)) return 'No room in your things';
  w.gear[slot] = null;
  w.gearV++;
  applyProgress(s);
  game.sound('click', s.x, s.y, s.id);
  return `Took off ${it.g.name}`;
}

/** Eat (or drink) one of `item` (food: items.js): it heals. Not at full health. */
function eat(game, s, item) {
  const w = s.world, max = s.maxHealth || 150;
  if (w.cool > 0) return;
  if (s.health >= max) { game.notify(s, 'You\'re not hurt'); w.cool = 30; return; }
  w.inv.remove(item.key, 1);
  s.health = Math.min(max, s.health + item.heal);
  w.cool = 30 / MOTION.timeScale;
  game.sound('health', s.x, s.y, s.id);
}

/**
 * Playing in someone else's world: the host does it all. Here, only the block aimed at, and the
 * shape being dragged out (for drawing them). (Called for each input again as the host's
 * corrections come in: the drag goes by new inputs only.)
 */
function mirrorInput(game, s, inp) {
  const w = s.world;
  w.target = targetOf(s, inp);
  if (inp.seq == null || inp.seq > (w.seenSeq || 0)) {
    w.seenSeq = inp.seq ?? 0;
    if (typeof inp.switchTo === 'string' && inp.switchTo[0] === '%') setRightHand(game, s, inp.switchTo.slice(1), true);
    // (The hand in use: the right while right click's held, and the left isn't.)
    const right = rightHand(s).item, useRight = !!right && !!inp.alt && !inp.fire;
    const item = useRight ? right : inHand(s).item, held = useRight || inp.fire, pressed = useRight ? inp.alt && !w.mirrorAlt : inp.firePressed;
    w.mirrorAlt = !!inp.alt;
    const dragging = item && (item.kind === 'block' || item.kind === 'wall') && w.brush !== 'single' && item.block !== K.DOOR && item.block !== K.TORCH;
    if (!dragging || !held) w.drag = null;
    else if (!w.drag && pressed && w.target.near) w.drag = { tx: w.target.tx, ty: w.target.ty };
  }
  return inp;
}

/** The world's part in each update: things on the ground, and the chunks around everyone made ready. */
export function worldTick(game) {
  updateDrops(game);
  doorsTick(game);
  magmaBurns(game);
  const world = game.world;
  world.time = (world.time || 0) + 1;
  // (Always day, or always night, as the world was made: worldrules.js.)
  if (game.tick % 30 === 0 && !game.mirror) world.time = keepTime(world, world.time, DAY_TICKS, hourOf);
  monstersTick(game);
  townsfolkTick(game);
  questsTick(game);
  raidsTick(game);
  sleepTick(game);
  // (Each player's party and the raid near them, as their HUD shows it: worked out now and then.)
  if (game.tick % 30 === 11) {
    const raid = world.raid, t = raid && world.gen.townIn(raid.k);
    for (const s of game.soldiers) {
      if (!s.world || s.npc) continue;
      s.world.partyList = partyView(game, s);
      s.world.raidInfo = t && Math.abs(s.x / TILE - (t.x0 + t.x1) / 2) < (t.x1 - t.x0) / 2 + 100 ? { name: raid.name, left: raidersLeft(game), total: raid.total } : null;
    }
  }
  for (const s of game.soldiers) {
    if (!s.world) continue;
    if (s.world.talk) talkTick(game, s);
    regenTick(game, s);
    // (Creative: dev mode, from the start: worldrules.js. Turned off, it stays off.)
    if (!s.world.creative && s.alive && !s.npc && !game.mirror && settingOf(world, 'mode') === 'creative') { s.world.creative = true; if (!s.world.dev) setDev(game, s, true); }
    // (A recall scroll being read: three seconds keeping still, then home.)
    const rc = s.world.recall;
    if (rc && !game.mirror) {
      if (!s.alive || Math.hypot(s.x - rc.x, s.y - rc.y) > 12) { s.world.recall = null; game.notify(s, 'The scroll\'s magic fades: you moved'); }
      else if (game.tick - rc.at >= RECALL_TICKS) { s.world.recall = null; recallHome(game, s); }
    }
    // (What's come into their hands, found: the codex.)
    const fk = `${s.world.inv.version}|${s.world.gearV || 0}`;
    if (game.tick % 20 === 5 && s.world.foundAt !== fk && !game.mirror) { s.world.foundAt = fk; scanFound(s); }
  }
  // The chunks round each player made ready before they're wanted (drawn, lit, walked on): three
  // either side and two up and down, and one more the way they're going; nearest first, for up
  // to a couple of milliseconds each update (making one takes half a millisecond or so, some
  // a few: all of a new column at once stutters).
  const want = world.wanted ||= [];
  if (game.tick % 10 === 0) {
    const R = CHUNK * TILE;
    want.length = 0;
    for (const s of game.soldiers) {
      if (!s.alive || !s.world) continue;
      const cx = Math.floor(s.x / R), cy = Math.floor(s.y / R), way = Math.sign(s.body?.vx || 0);
      for (let y = Math.max(0, cy - 2); y <= Math.min(WORLD_H / CHUNK - 1, cy + 2); y++) {
        for (let x = cx - 3 + Math.min(0, way); x <= cx + 3 + Math.max(0, way); x++) if (!world.has(x, y)) want.push([x, y, (x - cx) ** 2 + (y - cy) ** 2]);
      }
    }
    want.sort((a, b) => b[2] - a[2]);
  }
  const t0 = performance.now();
  for (let i = 0; want.length && (i === 0 || performance.now() - t0 < 2); i++) { const c = want.pop(); world.chunk(c[0], c[1]); }
  if (game.tick % 600 === 0) world.trim(game.soldiers.filter(s => s.alive).map(s => ({ x: s.x, y: s.y })), 12);
}

// ---- Magma ------------------------------------------------------------------------------------------

const MAGMA_EVERY = 6;    // updates between burns while touching magma
const MAGMA_DAMAGE = 1.5; // each time; and whoever touches it catches fire a moment (game.js burns them)

/** Soldiers touching magma (standing on it, against it, or with it overhead) are burnt, and set alight. */
function magmaBurns(game) {
  if (game.tick % MAGMA_EVERY) return;
  const world = game.world, M = K.MAGMA;
  for (const s of game.soldiers) {
    if (!s.alive) continue;
    const l = s.x - BODY.halfW - 2, r = s.x + BODY.halfW + 2, feet = s.y + BODY.bottom + 2, low = s.y + BODY.bottom - 4, mid = s.y - 6;
    if (world.tileAt(s.x - 5, feet) !== M && world.tileAt(s.x + 5, feet) !== M && world.tileAt(l, low) !== M && world.tileAt(r, low) !== M &&
      world.tileAt(l, mid) !== M && world.tileAt(r, mid) !== M && world.tileAt(s.x, s.y + BODY.top - 2) !== M) continue;
    damage(game, s, MAGMA_DAMAGE, null, 'Magma', { burn: true });
    if (!s.alive) continue;
    s.burnTicks = Math.max(s.burnTicks || 0, 45);
    s.burnBy = null;
    if (game.tick % 30 === 0) game.sound('flame', s.x, s.y);
  }
}

// ---- The mode -------------------------------------------------------------------------------------

// (Hitting back with thorns, once: not thorns against thorns forever.)
let thorny = false;

// (How likely each monster is to drop a piece of gear: gear.js. A named one always does, and better.)
const GEAR_CHANCE = { zombie: 0.025, skeleton: 0.05, brute: 0.2 };

/** Gear dropped by a monster killed (by: the player who killed it, their magic find). */
function dropGear(game, victim, by, x, y) {
  const champ = victim.npc.champion, chance = champ ? 1 : GEAR_CHANCE[victim.npc.type] || 0;
  if (game.rng() >= chance) return;
  const world = game.world, depth = Math.floor(victim.y / TILE) - world.gen.surfaceAt(Math.floor(victim.x / TILE));
  const mf = by ? gearStats(by).mf || 0 : 0, level = by?.world?.prog?.level || 1;
  const ilvl = dropLevel(depth, victim.npc.type, level) + (champ ? 4 : 0);
  const seed = dropSeed(world.gen.seed + game.tick, victim.id, Math.floor(victim.x));
  // (Named monsters: rare at least. The story's: something special.)
  const special = victim.name === 'The Ember King' ? ['unique', 'ember_crown'] : victim.name === 'The Warden' ? ['unique', 'warden'] : null;
  // (Now and then a weapon with affixes of its own instead.)
  const weapon = !special && game.rng() < 0.3;
  const piece = special ? rollGear(seed, ilvl, mf, special[0], special[1]) : rollGear(seed, ilvl, mf + (champ ? 150 : 0), champ && game.rng() < 0.5 ? 'rare' : null, null, weapon);
  dropItem(game, piece.key, 1, x, y, (game.rng() - 0.5) * 3, -2.5, 0, piece.g);
  // (The Ember King: his maul too.)
  if (victim.name === 'The Ember King') { const maul = rollGear(seed + 1, 30, 0, 'unique', 'embermaul', true); dropItem(game, maul.key, 1, x, y, 1.5, -3, 0, maul.g); }
}

/** The rules a world plays by (modes.js lists it; it isn't in the menus' list of modes). */
export const worldMode = {
  name: 'World',
  blurb: 'An endless world to explore, dig, build and fight in.',
  hidden: true,
  teams: false,
  pickups: false,
  crates: false,
  dropWeapons: false,
  infiniteAmmo: false,
  mapLoadout: false,
  limit: 'none',
  streaks: false,
  callouts: false,
  classes: false,

  /** A world's game begins: blasts drop some of what they break (and crates spill open). */
  begin(game) {
    const world = game.world;
    if (!world) return;
    // (Quests drop rewards that don't fit at your feet, and put lost things in chests.)
    setQuestHooks({ drop: (g, key, n, x, y, gear) => dropItem(g, key, n, x, y, 0, -2, 30, gear || null), chestAt });
    world.drops ||= [];
    world.claims ||= new Map();
    world.protect = (tx, ty) => !!world.gen?.townProtecting(tx, ty) || (world.claims.size > 0 && !!claimAt(world, tx, ty));
    world.onBreak = (tx, ty, id) => {
      const b = BLOCKS[id], x = tx * TILE + TILE / 2, y = ty * TILE + TILE / 2;
      if (id === K.LOOT_CRATE) openCrate(game, x, y);
      else if (id === K.CHEST) { dropItem(game, 'chest', 1, x, y); spillChest(game, tx, ty); }
      else if (K.SHULKER_BOXES.has(id)) dropShulker(game, tx, ty, id, x, y);
      else if (id === K.ENDER_CHEST) dropItem(game, 'ender_chest', 1, x, y);
      else if (id === K.WAYSTONE) { dropItem(game, 'waystone', 1, x, y); removeWaystone(world, tx, ty); }
      else if (id === K.TRUNK) dropItem(game, 'wood', 1, x, y);
      else if ((id === K.LEAVES || id === K.JUNGLE_LEAVES) && game.rng() < 0.04) dropItem(game, 'apple', 1, x, y, (game.rng() - 0.5) * 2, -1.5);
      else if (b.drop && game.rng() < (b.natural ? 0.3 : 0.6)) dropItem(game, b.drop, 1, x, y, (game.rng() - 0.5) * 3, -2);
    };
  },

  setup(game, s) {
    // Monsters and mercenaries (monsters.js): their own weapon, no things of their own.
    s.npc = s.profile?.npc ? { ...s.profile.npc } : null;
    if (!s.npc) {
      s.world ||= worldState();
      // (The number keys pick hotbar slots for left click, or with the right hand's key held, right click: worldInput.)
      s.slotChoice = (i, second = false) => (i < HOTBAR ? `${second ? '%' : '#'}${i}` : null);
    }
    // (Nothing switches weapons by itself: the hotbar decides.)
    s.selectBest = () => {};
  },

  spawnLoadout(game, s) {
    if (s.npc) { armNpc(s); s.npc.spawned = true; return; }
    // (Their health by their level and perks: progress.js.)
    if (s.world) { s.maxHealth = maxHealthOf(s); s.health = s.maxHealth; }
    s.weapons = {};
    hold(s);
  },

  /** (Nothing hurts a player in dev mode, nor any of the townsfolk but guards: townsfolk.js.) */
  damage(game, amount, attacker, target, weapon) {
    if (target?.world?.dev || (isFolk(target) && !target.npc.guard)) return 0;
    // (Hurt in bed: awake, at once. Reading a recall scroll: it's spoilt.)
    if (target?.world?.sleep && amount > 0) wake(game, target, 'Something woke you!');
    if (target?.world?.recall && amount > 0) { target.world.recall = null; game.notify(target, 'The scroll\'s magic fades: you were hurt'); }
    // (Harder hitting with the Marksman and Brawler perks and gear: progress.js. Less taken with
    // armour, and fire resistance against magma and burning: gear.js.)
    let dmg = attacker?.world ? amount * damageScale(attacker, weapon) : amount;
    // (Monsters hit as hard as the world's difficulty says: worldrules.js.)
    if (attacker && isMonster(attacker) && target?.world) dmg *= difficultyOf(game.world).dmg;
    const as = attacker?.world?.gear ? gearStats(attacker) : null;
    // (A critical hit: twice the damage.)
    if (as?.crit && game.rng() * 100 < as.crit) { dmg *= 2; game.fx?.sparks?.(target.x, target.y - 14, 0, -1); }
    if (target?.world?.gear) {
      const st = gearStats(target);
      if (st.armor) dmg *= 1 - armorCut(st.armor);
      if (st.fire && (weapon === 'Magma' || !attacker && target.burnTicks > 0)) dmg *= 1 - Math.min(90, st.fire) / 100;
      // (Thorns: whoever hits them up close is hurt back.)
      if (st.thorns && attacker && attacker !== target && attacker.alive && !thorny && Math.hypot(attacker.x - target.x, attacker.y - target.y) < 80) {
        thorny = true;
        damage(game, attacker, st.thorns, target, 'Thorns');
        thorny = false;
      }
    }
    // (Life leech: some of the damage done heals the one who did it.)
    if (as?.leech && attacker.alive) attacker.health = Math.min(attacker.maxHealth, attacker.health + dmg * as.leech / 100);
    return dmg;
  },
  /** Dev mode flies (devmode.js); else the game moves them. */
  moveSoldier(game, s, inp) { return devFly(game, s, inp); },
  /** Monsters don't hurt monsters; nor mercenaries the one who hired them; players each other only with PvP on. */
  canHurt(game, attacker, target) { return foes(game.world, attacker, target); },

  /** Killed: a monster drops coins and loot; a player leaves a grave with what they lose in it (bury). */
  onKill(game, victim, killer) {
    const x = victim.x, y = victim.y - 10;
    const drop = (key, n) => dropItem(game, key, n, x, y, (game.rng() - 0.5) * 3, -2 - game.rng() * 1.5);
    // (Whose kill it was: a player's, or their mercenary's.)
    const by = killer?.world ? killer : killer?.npc?.kind === 'merc' ? game.soldiers.find(o => o.id === killer.npc.owner && o.world) : null;
    if (isMonster(victim)) {
      monsterLoot(game, victim, drop, by ? lootScale(by) : 1);
      dropGear(game, victim, by, x, y);
      if (by) {
        const champion = victim.npc.champion, xp = champion ? KILL_XP.champion : KILL_XP[victim.npc.type] || 10;
        giveXp(game, by, xp, victim.name);
        countStat(by, 'kills');
        questEvent(game, by, { type: 'kill', what: victim.npc.type, x: victim.x, y: victim.y, champion });
        // (Their party near shares it: social.js. A raider: counted for the raid, raids.js.)
        shareKill(game, by, victim, xp);
      }
      raidKill(game, victim, by);
    }
    // (A player: what they lose goes in a grave, where they died. Hardcore: that was their one life.)
    else if (victim.world) {
      bury(game, victim);
      if (settingOf(game.world, 'mode') === 'hardcore') { victim.world.died = true; victim.world.over = true; game.notify(victim, 'You died. A hardcore world: there\'s no coming back (you can watch)'); }
    }
  },
  // (G throws what's in hand: worldInput. Saying there's a drop makes the key mean that.)
  drop() {},
  /** Players always come back; a monster or mercenary only appears the once (a mercenary beside whoever hired them). */
  canRespawn(game, s) {
    // (Hardcore: one life. Dead, you watch: worldrules.js.)
    if (!s.npc) return !(s.world?.over || (settingOf(game.world, 'mode') === 'hardcore' && s.world?.died));
    if (s.npc.spawned) return false;
    return s.npc.kind !== 'merc' || game.soldiers.some(o => o.id === s.npc.owner && o.alive && !o.npc);
  },
  winner() { return null; },
  /** Out for good (hardcore): what the screen says. */
  outText(game, s) { return s.world?.over ? 'Your one life is spent: this world is hardcore' : "You're out"; },

  /**
   * Where to come back: where they were when the world was last saved (the first time), else
   * where they last slept (the next stage's beds), else where the world starts. (Never inside
   * blocks built there since.)
   */
  spawnPoint(game, s) {
    if (s.npc?.spawnAt) return s.npc.spawnAt;
    if (s.npc?.kind === 'merc') {
      const o = game.soldiers.find(x => x.id === s.npc.owner);
      return safeSpot(game.world, o.x - o.facing * 24, o.y);
    }
    // (A bed that's gone: where the world starts, and they're told: sleep.js.)
    const w = s.world, p = w?.resume || homeOf(game, s) || game.map.spawns[0];
    if (w) w.resume = null;
    return safeSpot(game.world || game.map, p.x, p.y);
  },

  input(game, s, inp) { return worldInput(game, s, inp); },
  tick(game) { worldTick(game); },

  compare: (a, b) => b.frags - a.frags,
  score: s => s.frags,
  scoreLabel: 'Frags',
};
