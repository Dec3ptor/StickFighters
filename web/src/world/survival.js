// Survival (world mode): what hunger.js, farming.js and animals.js add to playing, put together for
// worldplay.js. Each update: hunger for each player, animals coming and going, crops growing. A
// click: a hoe tills, seeds (a carrot, a potato) are planted on farmland, bone meal grows things,
// shears clip a sheep, an animal's food feeds it, and anything else picks a crop that's clicked.
// And what crops, tall grass and gravel give when they're broken.
//
// worldplay.js hands in what it does itself (h): drop(game, key, n, x, y) puts something on the
// ground, breakBlock(game, tx, ty, s) breaks a block as a player would, allowed(game, s, tx, ty)
// says whether they may change a tile there (telling them why not).

import * as K from './blocks.js';
import { TILE } from './blocks.js';
import { hungerTick, exert } from './hunger.js';
import { till, plotAt, plant, boneMeal, harvest, farmingTick } from './farming.js';
import { animalsTick, animalAt, shear, eats, feedAnimal } from './animals.js';

/** How far a player reaches an animal (px, from them). */
const ANIMAL_REACH = 7 * TILE;

/** The world mode's update, for survival. */
export function survivalTick(game, h) {
  for (const s of game.soldiers) if (s.world && !s.npc) hungerTick(game, s);
  animalsTick(game, (key, n, x, y) => h.drop(game, key, n, x, y));
  farmingTick(game);
}

/**
 * A click with `item` (in either hand: worldplay.js's useItem), if survival has something to do
 * with it. Returns undefined if not (the click does what it always did), else false (no shot).
 */
export function useSurvival(game, s, item, inp, pressed, h) {
  const w = s.world, t = w?.target, world = game.world;
  if (!item || !inp.fire || !pressed || !t) return undefined;
  const drop = (key, n, x, y) => h.drop(game, key, n, x, y);
  // An animal clicked: shears clip a sheep; its food feeds it.
  if (item.tool === 'shears' || item.kind !== 'weapon') {
    const a = animalAt(game, s, t.x, t.y, ANIMAL_REACH);
    if (a && item.tool === 'shears') {
      if (shear(game, a, drop)) { exert(s, 0.025); return false; }
    } else if (a && eats(a, item.key)) {
      if (feedAnimal(game, s, a)) { w.inv.remove(item.key, 1); game.sound('click', a.x, a.y, s.id); }
      return false;
    }
  }
  if (!t.near) return undefined;
  const id = world.tile(t.tx, t.ty);
  // A hoe: dirt and grass into farmland.
  if (item.tool === 'hoe') {
    if (!h.allowed(game, s, t.tx, t.ty)) return false;
    if (!till(world, t.tx, t.ty)) return undefined;
    game.sound('thunk', t.tx * TILE + 8, t.ty * TILE + 8);
    exert(s, 0.025);
    return false;
  }
  // Bone meal: a crop grows; on grass, grass and flowers.
  if (item.meal) {
    if (h.allowed(game, s, t.tx, t.ty) && boneMeal(world, t.tx, t.ty, game.rng)) {
      w.inv.remove(item.key, 1);
      game.fx?.sparks?.(t.tx * TILE + 8, t.ty * TILE + 8, 0, -1);
      game.sound('click', t.tx * TILE + 8, t.ty * TILE + 8);
    }
    return false;
  }
  // A crop clicked (with anything but a tool, a weapon or bone meal): picked.
  if (K.CROPS.has(id) && item.kind !== 'tool' && item.kind !== 'weapon') {
    if (h.allowed(game, s, t.tx, t.ty)) h.breakBlock(game, t.tx, t.ty, s);
    return false;
  }
  // Seeds, a carrot, a potato: planted on farmland.
  if (item.plant) {
    const p = plotAt(world, t.tx, t.ty);
    if (!p) return item.kind === 'seed' ? false : undefined;
    if (!h.allowed(game, s, p.tx, p.ty)) return false;
    if (plant(world, p.tx, p.ty, item.plant)) {
      w.inv.remove(item.key, 1);
      game.sound('build', p.tx * TILE + 8, p.ty * TILE + 8);
    }
    return false;
  }
  return undefined;
}

/** What block `id`, broken, gives if survival says ([[key, n]]: crops, tall grass, gravel), or null: its own drop. */
export const blockDrops = (game, id) => harvest(id, game.rng);
