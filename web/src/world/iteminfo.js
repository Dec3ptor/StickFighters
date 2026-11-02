// What items are, for the screens (world mode): a colour for each kind of thing (the loot feed,
// the names of things lying on the ground, the inventory's slots), which things are precious
// (they glow where they lie), and each item's details for the inventory's card: what it does,
// what it's worth, what it's made from.

import { BLOCKS } from './blocks.js';
import { itemOf } from './items.js';
import { WEAPONS } from '../weapons.js';
import { RECIPES, STATION_NAMES, madeFrom } from './crafting.js';
import { valueOf, SHOPS, offerFor } from './trade.js';

/** Each kind of thing's colour (bright: they're shown on dark panels). */
export const CATEGORY_COLORS = {
  coins: '#ffd23f', gem: '#d08cff', potion: '#ff6f8e', food: '#f4b06a', weapon: '#ffb347', tool: '#7cc0ff', ammo: '#e8cf7a',
  contract: '#f2e3b3', bar: '#e4e8ef', ore: '#d6ae84', block: '#ececec', wall: '#bdbdbd', material: '#dccdaa', quest: '#ffe36e',
};
/** What each kind is called. */
const CATEGORY_NAMES = {
  coins: 'Money', gem: 'Gem', potion: 'Potion', food: 'Food', weapon: 'Weapon', tool: 'Tool', ammo: 'Ammunition', contract: 'Contract',
  bar: 'Metal bar', ore: 'Ore', block: 'Block', wall: 'Wall', material: 'Material', quest: 'Quest item',
};

/** The kind of thing an item is (for its colour). */
export function categoryOf(it) {
  if (!it) return 'material';
  if (it.key === 'coins') return 'coins';
  if (it.gem) return 'gem';
  if (it.kind === 'food') return it.look === 'potion' ? 'potion' : 'food';
  if (it.kind === 'weapon' || it.kind === 'tool' || it.kind === 'ammo' || it.kind === 'contract' || it.kind === 'wall' || it.kind === 'quest') return it.kind;
  if (it.key.endsWith('_bar')) return 'bar';
  if (it.key.endsWith('_ore') || it.key === 'coal' || it.key === 'kimberlite') return 'ore';
  if (it.kind === 'block') return 'block';
  return 'material';
}

/** An item's colour (by its key or the item). */
export const itemColor = it => CATEGORY_COLORS[categoryOf(typeof it === 'string' ? itemOf(it) : it)] || '#dddddd';

/** Whether an item is worth making a fuss of: it glows where it lies, and it's said big as it's picked up. */
export function isPrecious(it) {
  if (!it) return false;
  const c = categoryOf(it);
  return c === 'gem' || c === 'potion' || c === 'weapon' || c === 'coins' || c === 'quest' || valueOf(it.key) >= 15;
}

const TIERS = ['', 'copper', 'iron', 'gold', 'crystal', 'diamond'];
const round = v => (v >= 10 ? Math.round(v) : v >= 1 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100);

/**
 * An item's details: { name, kind (what kind of thing, in words), color, lines (what it does),
 * worth (what it's worth, in words, or ''), made (how it's made, or '') }. n: how many there are.
 */
export function itemDetails(it, n = 1) {
  const cat = categoryOf(it), lines = [];
  let kind = CATEGORY_NAMES[cat];
  switch (cat) {
    case 'weapon': {
      const d = WEAPONS[it.weapon];
      if (!d) break;
      const melee = d.kind === 'melee', thrown = ['thrown', 'placed', 'walker', 'flyer', 'strike', 'quake'].includes(d.kind);
      kind = melee ? 'Weapon · melee' : thrown ? 'Weapon · explosive' : d.kind === 'rocket' ? 'Weapon · launcher' : 'Weapon · gun';
      if (d.damage) lines.push(`${round(d.damage)}${d.pellets > 1 ? ` × ${d.pellets} pellets` : ''} damage${d.headMultiplier ? ` (× ${d.headMultiplier} to the head)` : ''}`);
      if (d.rof && !thrown) lines.push(`${round(60 / d.rof)} ${melee ? 'swings' : 'shots'} a second`);
      if (d.mag) lines.push(`${d.mag} rounds a magazine`);
      if (melee && d.reach) lines.push(`Reach ${d.reach}`);
      else if (d.range && !thrown) lines.push(`Range ${d.range}`);
      lines.push(it.ammo === 'self' ? 'Used up as it\'s used' : it.ammo ? `Uses ${itemOf(it.ammo)?.name.toLowerCase() ?? it.ammo}` : 'Needs no ammunition');
      break;
    }
    case 'tool':
      kind = it.tool === 'pick' ? 'Tool · pickaxe' : it.tool === 'axe' ? 'Tool · axe' : 'Tool · hammer';
      if (it.tool === 'pick') lines.push(`Digs ${TIERS[it.tier] || ''}-tier blocks and softer`, `Digging power ${round(it.power)}`);
      else if (it.tool === 'axe') lines.push('Fells trees, breaks wooden things', `Chopping power ${round(it.power)}`);
      else lines.push('Shapes blocks into halves and ramps', 'Takes down walls');
      break;
    case 'food': case 'potion':
      lines.push(`Heals ${it.heal >= 400 ? 'you fully' : it.heal}`, `Click to ${cat === 'potion' ? 'drink' : 'eat'} one (either hand)`);
      break;
    case 'ammo': lines.push('Ammunition, carried for the guns that use it'); break;
    case 'contract': lines.push('Use it (like a weapon) to hire a mercenary'); break;
    case 'quest': lines.push('Carried for a quest (your journal says what for)', 'Nobody will buy it'); break;
    case 'coins': lines.push('Money: for townsfolk\'s shops, healing, a bed, hiring guards'); break;
    case 'gem': lines.push('Precious: traders pay the most for it', 'Diamonds make the best pickaxe'); break;
    case 'bar': lines.push('Smelted metal, for tools, guns and more'); break;
    case 'ore': lines.push(it.key === 'coal' ? 'Fuel for torches and smelting' : 'Smelt it in a furnace'); break;
    case 'wall': lines.push('A wall, built behind (closes a room in)'); break;
    case 'block': {
      const b = BLOCKS[it.block];
      if (b?.light) lines.push('Gives light');
      if (b && !b.solid && !b.platform) lines.push(b.pattern === 'plant' ? 'A plant' : 'Stands on the floor');
      else if (b?.platform) lines.push('Stood on, jumped up through');
      else lines.push('A block to build with');
      break;
    }
    default: break;
  }
  // What it's worth, and what the best shop would pay.
  const v = valueOf(it.key);
  let worth = '';
  if (v > 0 && it.key !== 'coins') {
    let best = 0;
    for (const role of Object.keys(SHOPS)) best = Math.max(best, offerFor(role, it.key, n));
    worth = `Worth about ${round(v * n)} coin${round(v * n) === 1 ? '' : 's'}${n > 1 ? ` (${round(v)} each)` : ''}${best > 0 ? ` · a shop pays up to ${best}` : ''}`;
  }
  const r = RECIPES.find(x => x.key === it.key);
  const made = r ? `Made from ${madeFrom(r)}, ${r.at ? `at a ${STATION_NAMES[r.at].toLowerCase()}` : 'by hand'}` : '';
  return { name: it.name, kind, color: itemColor(it), lines, worth, made };
}
