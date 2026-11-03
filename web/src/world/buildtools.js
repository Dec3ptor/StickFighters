// Building quicker (world mode): picking a block (the middle button: what's under the crosshair, into
// your hand, if you have it), the fill and replace brushes (worldplay.js's BRUSHES), and undoing what
// you built (Z, a few times back: what went up comes down, and what it used comes back).
//
// worldplay.js hands in what it does itself (h): give(game, s, key, n) puts something in a player's
// things (on the ground if there's no room), allowed(game, s, tx, ty) says whether they may change a
// tile, settle(game, tx, ty) brings down what a change leaves unsupported.

import * as K from './blocks.js';
import { BLOCKS, SOLID, AIR, NO_WALL, WALLS } from './blocks.js';
import { ITEMS, itemOf, HOTBAR } from './items.js';
import { signGone } from './decor.js';

// ---- Picking a block ------------------------------------------------------------------------------------

// What places each block (and variant): `${id}:${paint}` -> its items, its own first.
let PLACERS = null;
function placers() {
  if (PLACERS) return PLACERS;
  PLACERS = new Map();
  for (const it of ITEMS.values()) {
    if (it.kind !== 'block' || it.shape) continue;
    const k = `${it.block}:${it.paint || 0}`;
    const list = PLACERS.get(k) || [];
    if (BLOCKS[it.block].key === it.key || BLOCKS[it.block].variants?.[it.paint || 0]?.key === it.key) list.unshift(it.key); else list.push(it.key);
    PLACERS.set(k, list);
  }
  // (Open, it's the same thing shut; and a door is a door.)
  for (const [open, shut] of [[K.DOOR_OPEN, K.DOOR], [K.WINDOW_OPEN, K.WINDOW], [K.TRAPDOOR_OPEN, K.TRAPDOOR], [K.GATE_OPEN, K.GATE]]) PLACERS.set(`${open}:0`, PLACERS.get(`${shut}:0`) || []);
  return PLACERS;
}

/** The items that are tile (tx, ty) (what picking it would take: its block's, its variant's; with no block, its wall's), the likeliest first. */
export function itemsAt(world, tx, ty) {
  const id = world.tile(tx, ty);
  if (id === AIR) {
    const w = world.wall(tx, ty);
    return w !== NO_WALL && itemOf(WALLS[w].drop) ? [WALLS[w].drop] : [];
  }
  const list = [...(placers().get(`${id}:${world.paint(tx, ty)}`) || [])];
  const drop = BLOCKS[id].drop;
  if (drop && itemOf(drop) && !list.includes(drop)) list.push(drop);
  return list;
}

/**
 * Player s picks the block under their crosshair: the hotbar slot holding it chosen, or it brought
 * from the bag into the slot in hand. Returns what to tell them (null: nothing to say).
 */
export function pickBlock(game, s) {
  const w = s.world, t = w?.target;
  if (!t) return null;
  const keys = itemsAt(game.world, t.tx, t.ty), inv = w.inv;
  if (!keys.length) return null;
  for (let i = 0; i < HOTBAR; i++) if (keys.includes(inv.slots[i]?.key)) { if (w.slot !== i) { w.slot = i; inv.version++; } return null; }
  for (let i = HOTBAR; i < inv.slots.length; i++) {
    if (!keys.includes(inv.slots[i]?.key)) continue;
    // (Into an empty hotbar slot if there is one, else the one in hand: what was there goes back in the bag.)
    const empty = inv.slots.slice(0, HOTBAR).indexOf(null), to = empty >= 0 ? empty : w.slot;
    [inv.slots[to], inv.slots[i]] = [inv.slots[i], inv.slots[to]];
    w.slot = to;
    inv.version++;
    return `${itemOf(inv.slots[to].key).name}: in hand`;
  }
  return `You have no ${itemOf(keys[0])?.name.toLowerCase() ?? 'more of that'}`;
}

// ---- Fill and replace ------------------------------------------------------------------------------------

/** The most a fill or a replace changes at once (tiles). */
export const FILL_MOST = 320;
const REACH_FILL = 24; // tiles from where it starts, each way

// (What filling goes through: the open, and plants.)
const OPEN = new Set([AIR, K.TALL_GRASS, K.FLOWER, K.DEAD_BUSH, K.FERN, K.BUSH, K.DRY_TALL_GRASS, K.PETALS]);

/**
 * The tiles a fill from (tx, ty) would fill: the open space joined to it, as far as what's built
 * round it (walls: the tiles with no wall behind, as far as walls and blocks round them). Null if
 * it isn't closed in (it would spill out past FILL_MOST tiles, or REACH_FILL either way).
 */
export function fillTiles(world, tx, ty, wall = false) {
  const open = wall ? (x, y) => world.wall(x, y) === NO_WALL && !SOLID[world.tile(x, y)] : (x, y) => OPEN.has(world.tile(x, y));
  if (!open(tx, ty)) return null;
  // (The bottom first: each block has something to go onto.)
  return flood(tx, ty, open)?.sort((a, b) => b.ty - a.ty || Math.abs(a.tx - tx) - Math.abs(b.tx - tx)) || null;
}

/** The tiles a replace from (tx, ty) would change: the same block (and variant) joined to it; walls: the same wall. Null if there's none, or too many. */
export function replaceTiles(world, tx, ty, wall = false) {
  if (wall) {
    const w = world.wall(tx, ty);
    if (w === NO_WALL || world.tile(tx, ty) !== AIR) return null;
    return flood(tx, ty, (x, y) => world.wall(x, y) === w && world.tile(x, y) === AIR);
  }
  const id = world.tile(tx, ty), sb = world.shapeByte(tx, ty);
  if (!replaceable(id)) return null;
  return flood(tx, ty, (x, y) => world.tile(x, y) === id && world.shapeByte(x, y) === sb);
}

/** Whether block `id` can be replaced (a plain block: not a door, a chest, a station, nor what nothing breaks). */
export const replaceable = id => !!SOLID[id] && !BLOCKS[id].station && BLOCKS[id].resist < 1e9 && BLOCKS[id].tier <= 1 && ![K.DOOR, K.LOOT_CRATE, K.TREASURE, K.CHEST].includes(id);

/** The tiles joined to (tx, ty) that `open` takes in, the nearest first; null if there are more than FILL_MOST. */
function flood(tx, ty, open) {
  const seen = new Set([`${tx},${ty}`]), out = [{ tx, ty }];
  for (let i = 0; i < out.length; i++) {
    const { tx: x, ty: y } = out[i];
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      const k = `${nx},${ny}`;
      if (seen.has(k) || Math.abs(nx - tx) > REACH_FILL || Math.abs(ny - ty) > REACH_FILL) continue;
      seen.add(k);
      if (!open(nx, ny)) continue;
      out.push({ tx: nx, ty: ny });
      if (out.length > FILL_MOST) return null;
    }
  }
  return out;
}

// ---- Undo ----------------------------------------------------------------------------------------------

/** How many times back undo goes, and for how long after (updates, at full speed: three minutes). */
export const UNDO_STEPS = 5;
const UNDO_KEEP = 3 * 60 * 60;
// (What undo leaves alone: what's been made someone's, or has things in it.)
const KEEP = new Set([K.CLAIM_FLAG, K.WAYSTONE, K.CHEST, K.CABINET, K.ENDER_CHEST, ...K.SHULKER_BOXES]);

/**
 * Player s did something undo can take back: cells, each { tx, ty, layer ('fg' or 'bg'), id (what
 * went in), key (the item it used: given back), was ({ id, sb, key }: what was there, and the item
 * they got for it, a replace's) }.
 */
export function noteBuilt(game, s, cells) {
  if (!s?.world || !cells.length) return;
  const list = s.world.undo ||= [];
  list.push({ tick: game.tick, cells });
  while (list.length > UNDO_STEPS) list.shift();
}

/** Player s takes back the last thing they built (what of it's still as they left it). Returns what to tell them. */
export function undoLast(game, s, h) {
  const w = s.world, world = game.world;
  const list = (w.undo || []).filter(e => game.tick - e.tick < UNDO_KEEP);
  w.undo = list;
  const e = list.pop();
  if (!e) return 'Nothing to undo';
  let n = 0;
  for (const c of [...e.cells].reverse()) {
    if (!h.allowed(game, s, c.tx, c.ty)) continue;
    if (c.layer === 'bg') {
      if (world.wall(c.tx, c.ty) !== c.id) continue;
      world.setWall(c.tx, c.ty, c.was?.id ?? NO_WALL);
    } else {
      if (world.tile(c.tx, c.ty) !== c.id || KEEP.has(c.id)) continue;
      // (A replace: the block that was there back, if they still have it.)
      if (c.was?.key && w.inv.remove(c.was.key, 1) < 1) continue;
      world.setTile(c.tx, c.ty, c.was?.id ?? AIR);
      if (c.was?.sb) world.set('shape', c.tx, c.ty, c.was.sb);
      if (c.id === K.SIGN) signGone(world, c.tx, c.ty);
    }
    if (c.key) h.give(game, s, c.key, 1);
    h.settle(game, c.tx, c.ty);
    n++;
  }
  game.sound('pickup', s.x, s.y, s.id);
  return n ? `Undone (${n} block${n === 1 ? '' : 's'})${list.length ? `: ${list.length} more to undo` : ''}` : 'Nothing left of that to undo';
}

