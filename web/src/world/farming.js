// Farming (world mode). A hoe tills dirt and grass into farmland; seeds (from tall grass, and
// shops), carrots and potatoes are planted on it, and grow a stage at a time till they're ripe
// (the host's random growth: now and then a few tiles of each chunk near a player are looked at,
// as Minecraft's random ticks do; twice as fast with water within four blocks). They come away by
// hand (or anything): ripe, with what they give (wheat and seeds, carrots, potatoes), else just
// what was planted. Bone meal grows a crop at once (on grass, grass and flowers spring up).
// Gravel gives flint now and then.
//
// Crops are blocks (blocks.js: a block for each stage), so they're saved and sent online as any
// block is; nothing else is kept.

import * as K from './blocks.js';
import { BLOCKS, SOLID, LIQUID, AIR, TILE, CROP_NEXT } from './blocks.js';
import { CHUNK, WORLD_H } from './worldgen.js';
import { hash3 } from './noise.js';

/** What a hoe tills into farmland (with room over it: air, or a plant, which goes). */
const TILLS = new Set([K.GRASS, K.DIRT, K.PODZOL, K.DRY_GRASS, K.MYCELIUM, K.JUNGLE_GRASS]);
const COVER = new Set([AIR, K.TALL_GRASS, K.FLOWER, K.DRY_TALL_GRASS, K.FERN, K.PETALS, K.DEAD_BUSH]);
/** Each crop's first stage (what's planted). */
export const SEEDLING = { wheat: K.WHEAT_CROPS[0], carrot: K.CARROT_CROPS[0], potato: K.POTATO_CROPS[0] };

/** Till tile (tx, ty) with a hoe: true if it's farmland now. */
export function till(world, tx, ty) {
  if (!TILLS.has(world.tile(tx, ty)) || !COVER.has(world.tile(tx, ty - 1))) return false;
  if (world.tile(tx, ty - 1) !== AIR) world.setTile(tx, ty - 1, AIR);
  return world.setTile(tx, ty, K.FARMLAND);
}

/** Where a crop goes for a click at tile (tx, ty): over farmland (the farmland clicked, or the air over it), or null. */
export function plotAt(world, tx, ty) {
  if (world.tile(tx, ty) === K.FARMLAND && world.tile(tx, ty - 1) === AIR) return { tx, ty: ty - 1 };
  if (world.tile(tx, ty) === AIR && world.tile(tx, ty + 1) === K.FARMLAND) return { tx, ty };
  return null;
}

/** Plant crop `kind` ('wheat', 'carrot', 'potato') at (tx, ty) (a plot: plotAt). */
export const plant = (world, tx, ty, kind) => !!SEEDLING[kind] && world.setTile(tx, ty, SEEDLING[kind]);

/** Whether there's water within four blocks of the farmland under a crop at (tx, ty) (it grows faster). */
export function watered(world, tx, ty) {
  for (let x = tx - 4; x <= tx + 4; x++) if (LIQUID[world.tile(x, ty)] || LIQUID[world.tile(x, ty + 1)]) return true;
  return false;
}

/** Grow the crop at (tx, ty) n stages (no further than ripe). True if it grew. */
export function grow(world, tx, ty, n = 1) {
  const was = world.tile(tx, ty);
  let id = was;
  for (let i = 0; i < n && CROP_NEXT.has(id); i++) id = CROP_NEXT.get(id);
  return id !== was && world.setTile(tx, ty, id);
}

/** Whether block `id` is a crop that's ripe. */
export const ripe = id => !!BLOCKS[id]?.crop && BLOCKS[id].stage === 3;

/**
 * What block `id` gives when it's broken, if farming says ([[key, n], ...]: crops by how far
 * they've grown, tall grass now and then seeds, gravel now and then flint), or null: its own drop.
 */
export function harvest(id, rng) {
  const b = BLOCKS[id];
  if (b.crop) {
    if (b.crop === 'wheat') return b.stage === 3 ? [['wheat', 1], ['wheat_seeds', 1 + Math.floor(rng() * 3)]] : [['wheat_seeds', 1]];
    return [[b.crop, b.stage === 3 ? 2 + Math.floor(rng() * 3) : 1]];
  }
  if (id === K.TALL_GRASS || id === K.DRY_TALL_GRASS || id === K.FERN) return rng() < 0.125 ? [['wheat_seeds', 1]] : [];
  if (id === K.GRAVEL && rng() < 0.1) return [['flint', 1]];
  return null;
}

/**
 * Bone meal on (tx, ty): a crop grows two or three stages; on grass (or what's on it), grass and
 * flowers spring up round about. True if it did something (and the bone meal's used).
 */
export function boneMeal(world, tx, ty, rng) {
  if (CROP_NEXT.has(world.tile(tx, ty))) return grow(world, tx, ty, 2 + Math.floor(rng() * 2));
  // (Grass: the block clicked, or the one under what was clicked.)
  let gy = ty;
  if (world.tile(tx, gy) !== K.GRASS) gy++;
  if (world.tile(tx, gy) !== K.GRASS || SOLID[world.tile(tx, gy - 1)]) return false;
  let any = false;
  for (let i = 0; i < 10; i++) {
    const x = tx + Math.floor(rng() * 7) - 3;
    for (let y = gy - 2; y <= gy + 2; y++) {
      if (world.tile(x, y) !== K.GRASS || world.tile(x, y - 1) !== AIR) continue;
      world.setTile(x, y - 1, rng() < 0.75 ? K.TALL_GRASS : K.FLOWER);
      any = true;
      break;
    }
  }
  return any;
}

const GROW_EVERY = 4;   // updates between looks
const PER_CHUNK = 3;    // tiles of each chunk looked at each time
const CHANCE = 0.22;    // a crop looked at grows a stage (twice as likely with water near)

/**
 * Crops grow (the world mode's tick; the host's): every few updates, a few tiles of each chunk
 * near a player are looked at, and a crop there may grow a stage. (Its own dice, from the world's
 * seed and the time: the game's aren't used up.)
 */
export function farmingTick(game) {
  if (game.mirror || game.tick % GROW_EVERY) return;
  const world = game.world, t = game.tick, seen = SEEN;
  seen.clear();
  for (const p of game.soldiers) {
    if (!p.alive || !p.world || p.npc) continue;
    const pcx = Math.floor(p.x / (CHUNK * TILE)), pcy = Math.floor(p.y / (CHUNK * TILE));
    for (let cy = Math.max(0, pcy - 1); cy <= Math.min(WORLD_H / CHUNK - 1, pcy + 1); cy++) {
      for (let cx = pcx - 2; cx <= pcx + 2; cx++) {
        const key = cx * 4096 + cy;
        if (seen.has(key) || !world.has(cx, cy)) continue;
        seen.add(key);
        for (let i = 0; i < PER_CHUNK; i++) {
          const h = hash3(world.seed ^ t, cx * 31 + i, cy), tx = cx * CHUNK + (h & 31), ty = cy * CHUNK + ((h >>> 5) & 31);
          if (!CROP_NEXT.has(world.tile(tx, ty))) continue;
          const roll = ((h >>> 10) & 1023) / 1024;
          if (roll < CHANCE * (watered(world, tx, ty) ? 2 : 1)) grow(world, tx, ty);
        }
      }
    }
  }
}
const SEEN = new Set();
