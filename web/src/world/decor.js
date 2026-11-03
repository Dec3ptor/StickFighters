// Decorating (world mode): blocks' variants, and what decorations do.
//
// A block can come in variants (blocks.js: wool in sixteen colours, tables of six woods, the
// flower in a pot...): which one a tile is, its paint, is kept with its shape (tileworld.js), so
// it's saved and sent online with no more to it. Each variant has its own item (but a flower
// pot's plants and a painting's pictures: no items of their own), and gives it back when broken.
//
// And what decorations do: lamps light (blocks.js's light), windows, trapdoors and fence gates open
// and shut (right click), a flower pot takes a flower (right click with one; again, it comes out),
// a chair is sat in (right click; move to get up), a sign says what's written on it (written as
// it's put up, or on a right click; shown with the mouse over it), and candles, pots and lamps stand
// on tables, cabinets and barrels as well as the floor.

import * as K from './blocks.js';
import { BLOCKS, SOLID, PLATFORMS, TILE, NO_WALL, SHAPES, shade } from './blocks.js';
import { hash3 } from './noise.js';
import { BODY } from '../config.js';
import { soldierIn } from './doors.js';

// ---- Variants ------------------------------------------------------------------------------------

const PAINTED = [];
/** Block `id` as its variant `paint`, for drawing (its colours, and a pale tint of them for the original's paper): the block itself for 0. */
export function painted(id, paint) {
  const b = BLOCKS[id];
  if (!paint || !b.variants?.[paint]) return b;
  const row = PAINTED[id] ||= [];
  if (!row[paint]) {
    const v = b.variants[paint];
    row[paint] = { ...b, color: v.color, dark: shade(v.color, 0.72), name: v.name, paper: shade(v.color, 1.72), paint, variant: v };
  }
  return row[paint];
}

/** The item block `id` is as its variant `paint` (null: it has none). */
export function variantKey(id, paint) {
  const b = BLOCKS[id];
  if (!paint || !b.variants?.[paint]) return b.drop === b.key ? b.key : null;
  return b.variantItems === false ? b.key : b.variants[paint].key;
}

/** A flower out in the world (paint 0): which of the first four it is, by where it grows (as it's drawn: worldrender.js). */
export const wildFlower = (tx, ty) => 1 + (hash3(5, tx, ty) & 3);

/** What's planted in a flower pot, by the item that's planted (its paint: blocks.js's flower pot variants). */
export const POT_PLANTS = new Map(BLOCKS[K.FLOWER_POT].variants.map((v, i) => [v.key, i]).filter(([, i]) => i > 0));

/**
 * What tile (tx, ty), block `id` with shape byte `sb` (its shape and paint, read before it went),
 * gives when it's broken, if it's something of this file's ([[key, n]...]), or null: what it
 * always gave. Its variant's item; a wild flower, which it is; what a pot had in it besides the
 * pot; and what plants give that gave nothing before (reeds, kelp, coral fans, ferns and bushes,
 * fallen petals, a dead bush's sticks).
 */
export function decorDrops(world, tx, ty, id, sb) {
  const paint = sb >> 4, b = BLOCKS[id];
  switch (id) {
    case K.FLOWER: return [[b.variants[paint || wildFlower(tx, ty)].key, 1]];
    case K.FLOWER_POT: return paint ? [['flower_pot', 1], [b.variants[paint].key, 1]] : [['flower_pot', 1]];
    case K.PAINTING: return [['painting', 1]];
    case K.REEDS: return [['reed', 1 + (hash3(11, tx, ty) & 1)]];
    case K.KELP: return [['kelp', 1]];
    case K.CORAL_FAN: return [['coral_fan', 1]];
    case K.PETALS: return [['petals', 1]];
    case K.FERN: return [['fern', 1]];
    case K.BUSH: return [['bush', 1]];
    case K.DEAD_BUSH: return [['stick', 1 + (hash3(12, tx, ty) & 1)]];
    default: break;
  }
  if (paint && b.variants?.[paint] && b.variantItems !== false && b.drop === b.key) return [[b.variants[paint].key, 1]];
  return null;
}

// ---- Standing, hanging ---------------------------------------------------------------------------

/** How far down its tile the top of what's there is, if things stand on it (tables, cabinets...: px), else 0. */
export const surfaceOf = id => BLOCKS[id]?.surface || 0;
// (What stands on a table as well as the floor; what hangs from a ceiling, or a chain.)
const SMALL = new Set([K.CANDLE, K.FLOWER_POT, K.CRYSTAL_LAMP, K.PAPER_LANTERN, K.LANTERN]);
/** Things drawn sunk to a table's top when they stand on one (worldrender.js). */
export const SINKS = new Set(['candle', 'pot', 'crystal_lamp', 'paper_lantern', 'lantern']);
const holds = id => !!(SOLID[id] || PLATFORMS[id]) || id === K.CHAIN;

/**
 * Whether block `id` has what it needs at (x, y) (put there, or staying there), for the blocks
 * this file looks after; undefined for the rest (worldplay.js decides). Candles, pots and lamps
 * stand on the floor or a table (lamps hang too, from a ceiling or a chain, or on a wall behind);
 * chandeliers and chains hang; a street lamp stands on the ground or a post; columns stand on
 * the ground or another column (or hold up a ceiling); paintings and shelves go on a wall behind
 * (a shelf, beside a block too); scaffolding stands on something, or reaches out from scaffolding
 * beside it.
 */
export function decorSupported(world, x, y, id) {
  const above = world.tile(x, y - 1), below = world.tile(x, y + 1), wall = world.wall(x, y) !== NO_WALL;
  const floor = !!(SOLID[below] || PLATFORMS[below]) || surfaceOf(below) > 0;
  switch (id) {
    case K.CANDLE: case K.FLOWER_POT: return floor;
    case K.CRYSTAL_LAMP: case K.PAPER_LANTERN: case K.LANTERN: return floor || holds(above) || wall || below === K.FENCE || below === K.POST || below === K.COLUMN;
    case K.CHANDELIER: case K.CHAIN: return holds(above);
    case K.LAMP_POST: return !!SOLID[below] || below === K.POST || below === K.FENCE || below === K.COLUMN;
    case K.COLUMN: return !!SOLID[below] || below === K.COLUMN || !!SOLID[above] || above === K.COLUMN;
    case K.PAINTING: return wall;
    case K.SHELF: return wall || !!SOLID[world.tile(x - 1, y)] || !!SOLID[world.tile(x + 1, y)];
    case K.SCAFFOLD: return floor || below === K.SCAFFOLD || world.tile(x - 1, y) === K.SCAFFOLD || world.tile(x + 1, y) === K.SCAFFOLD;
    default: return undefined;
  }
}
/** Whether the blocks decorSupported looks after need it checked (they can't be just put anywhere). */
export const DECOR_SUPPORT = new Set([...SMALL, K.CHANDELIER, K.CHAIN, K.LAMP_POST, K.COLUMN, K.PAINTING, K.SHELF, K.SCAFFOLD]);

// ---- Putting one up --------------------------------------------------------------------------------

const SHAPE_INDEX = new Map(SHAPES.map((s, i) => [s.key, i]));

/**
 * After item `it` was put at (tx, ty) (its block's in): its variant (a painting, one of its
 * pictures, by where it is), and its shape (a slab: low, or high aimed at the top of the tile; stairs:
 * up the way the soldier faces; a trapdoor shut: the top half). s: who put it there (or null).
 */
export function afterPlace(world, it, tx, ty, s = null, aimY = null) {
  if (it.paint) world.setPaint(tx, ty, it.paint);
  else if (it.block === K.PAINTING) world.setPaint(tx, ty, 1 + (hash3(13, tx, ty) % (BLOCKS[K.PAINTING].variants.length - 1)));
  if (it.block === K.TRAPDOOR) world.setShape(tx, ty, SHAPE_INDEX.get('top'));
  if (it.shape === 'slab') world.setShape(tx, ty, SHAPE_INDEX.get(aimY != null && aimY - ty * TILE < TILE / 2 ? 'top' : 'bottom'));
  else if (it.shape === 'stairs') world.setShape(tx, ty, SHAPE_INDEX.get((s?.facing ?? 1) > 0 ? 'rampR' : 'rampL'));
}

// ---- Opening and shutting ----------------------------------------------------------------------------

const OPENS = new Map([[K.WINDOW, K.WINDOW_OPEN], [K.WINDOW_OPEN, K.WINDOW], [K.TRAPDOOR, K.TRAPDOOR_OPEN], [K.TRAPDOOR_OPEN, K.TRAPDOOR], [K.GATE, K.GATE_OPEN], [K.GATE_OPEN, K.GATE]]);
/** Whether block `id` opens and shuts with a right click (a window, a trapdoor, a fence gate). */
export const opens = id => OPENS.has(id);

/** The window, trapdoor or gate at (tx, ty) opened, or shut (not on anyone). Returns whether it was. */
export function openShut(game, tx, ty) {
  const world = game.world, id = world.tile(tx, ty), to = OPENS.get(id);
  if (to == null) return false;
  if (SOLID[to] && soldierIn(game, tx, ty, ty)) return false;
  world.setTile(tx, ty, to);
  if (to === K.TRAPDOOR) world.setShape(tx, ty, SHAPE_INDEX.get('top'));
  game.sound('click', tx * TILE + 8, ty * TILE + 8);
  return true;
}

// ---- Flower pots ---------------------------------------------------------------------------------------

/**
 * A right click on the flower pot at (tx, ty), with `item` in hand (or null): a flower (or a fern, a
 * cactus, a mushroom...) planted in it, if it's empty; else what's in it comes out. Returns what to
 * tell the player, or '' (done, nothing to say).
 */
export function usePot(game, s, tx, ty, items) {
  const world = game.world, paint = world.paint(tx, ty), inv = s.world.inv;
  if (paint) {
    const key = BLOCKS[K.FLOWER_POT].variants[paint].key;
    if (inv.add(key, 1) > 0) return 'No room in your things';
    world.setPaint(tx, ty, 0);
    game.sound('pickup', tx * TILE + 8, ty * TILE + 8, s.id);
    return '';
  }
  const it = items.find(i => i && POT_PLANTS.has(i.key));
  if (!it) return 'Plant a flower in it (a flower, a fern, a cactus, a mushroom...: right click with one in hand)';
  inv.remove(it.key, 1);
  world.setPaint(tx, ty, POT_PLANTS.get(it.key));
  game.sound('build', tx * TILE + 8, ty * TILE + 8);
  return '';
}

// ---- Chairs ------------------------------------------------------------------------------------------

/** Player s sits down on the chair at (tx, ty): kept on it (drawn sitting: stickman.js), till they move. */
export function sitDown(game, s, tx, ty) {
  const w = s.world;
  if (!w || game.world.tile(tx, ty) !== K.CHAIR) return false;
  w.sit = { tx, ty, since: game.tick };
  s.body.x = tx * TILE + TILE / 2;
  s.body.y = (ty + 1) * TILE - BODY.bottom - 1;
  s.body.vx = 0;
  s.sitting = true;
  game.sound('click', s.x, s.y, s.id);
  return true;
}
/** While sitting: kept on the chair (gone, or they move or jump: up). Returns the input to use. */
export function sitInput(game, s, inp) {
  const z = s.world.sit, b = s.body;
  const up = (inp.move || inp.jump || inp.crouch) && game.tick - z.since > 8;
  if (up || game.world.tile(z.tx, z.ty) !== K.CHAIR || !s.alive) { standUp(s); return inp; }
  b.x = z.tx * TILE + TILE / 2;
  b.vx = 0;
  s.sitting = true;
  return { ...inp, move: 0, jump: false, jumpPressed: false, crouch: false };
}

/** Player s gets up out of their chair. */
export function standUp(s) {
  if (s.world) s.world.sit = null;
  s.sitting = false;
}

// ---- Signs -------------------------------------------------------------------------------------------

/** The most a sign says. */
export const SIGN_MAX = 60;
/** What's written on a sign, tidied (one line, no more than SIGN_MAX). */
export const cleanSign = text => String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SIGN_MAX);
const signKey = (tx, ty) => `${tx},${ty}`;

/** What the sign at (tx, ty) says ('' for nothing: a sign that isn't there says nothing). */
export function signText(world, tx, ty) {
  if (world.tile(tx, ty) !== K.SIGN) return '';
  return world.signs?.get(signKey(tx, ty)) || '';
}

/** Write `text` on the sign at (tx, ty). Returns whether it's a sign. */
export function writeSign(world, tx, ty, text) {
  if (world.tile(tx, ty) !== K.SIGN) return false;
  const t = cleanSign(text), map = world.signs ||= new Map();
  if (t) map.set(signKey(tx, ty), t); else map.delete(signKey(tx, ty));
  world.signsV = (world.signsV || 0) + 1;
  return true;
}

/** A world's signs as saved: [[tx, ty, text]...] (those still there). */
export const signsToSave = world => [...(world.signs || [])].map(([k, t]) => { const [tx, ty] = k.split(',').map(Number); return [tx, ty, t]; }).filter(([tx, ty]) => world.tile(tx, ty) === K.SIGN);

/** A world's signs from a save (or the host). */
export function signsFromSave(world, list) {
  world.signs = new Map();
  if (Array.isArray(list)) {
    for (const row of list.slice(0, 5000)) {
      if (!Array.isArray(row) || !Number.isInteger(row[0]) || !Number.isInteger(row[1])) continue;
      const t = cleanSign(row[2]);
      if (t) world.signs.set(signKey(row[0], row[1]), t);
    }
  }
  world.signsV = (world.signsV || 0) + 1;
}

/** A sign gone: what it said, forgotten. */
export function signGone(world, tx, ty) {
  if (world.signs?.delete(signKey(tx, ty))) world.signsV = (world.signsV || 0) + 1;
}

