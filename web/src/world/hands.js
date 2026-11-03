// How a world's things look in a hand (drawn by held.js; posed by stickman.js): a pickaxe, an
// axe or a hammer as tools are (sprites.js), a torch with its flame, and everything else as
// itself, held out (a block as it looks in the world, an apple, a potion, a gem, a scroll:
// worldrender.js paints them). Players, townsfolk and online players all go by the item's key.

import { itemOf } from './items.js';
import { WEAPONS } from '../weapons.js';

const LOOKS = new Map();

/** How item `it` looks in a hand (the same object each time), or null for nothing. */
export function heldLook(it) {
  if (!it) return null;
  let l = LOOKS.get(it.key);
  if (l !== undefined) return l;
  if (it.kind === 'tool' && (it.tool === 'pick' || it.tool === 'axe' || it.tool === 'hammer')) {
    const type = it.tool === 'pick' ? 'pickaxe' : it.tool === 'axe' ? 'axe' : 'mallet';
    l = { kind: 'melee', look: { type, length: 13, color: it.handle || '#7a5634', head: it.color } };
  } else if (it.key === 'torch') l = { kind: 'build', look: { type: 'torch' } };
  else if (it.kind === 'weapon') l = WEAPONS[it.weapon] || null;
  else l = { kind: 'item', look: { type: 'item' }, item: it };
  LOOKS.set(it.key, l);
  return l;
}

/** How the thing with key `key` looks in a hand (null: nothing, or no such thing). */
export const lookOfKey = key => (key ? heldLook(itemOf(key)) : null);
