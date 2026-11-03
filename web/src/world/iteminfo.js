// What items are, for the screens (world mode): a colour for each kind of thing (the loot feed,
// the names of things lying on the ground, the inventory's slots), which things are precious
// (they glow where they lie), and each item's details for the inventory's card: what it does,
// what it's worth, what it's made from.

import { BLOCKS } from './blocks.js';
import { itemOf } from './items.js';
import { WEAPONS } from '../weapons.js';
import { RECIPES, STATION_NAMES, madeFrom } from './crafting.js';
import { valueOf, SHOPS, offerFor } from './trade.js';
import { RARITY, gearLines, gearValue, rarityOf } from './gear.js';
import { ATT_SLOTS, attLines, effects } from './attachments.js';
import { BOATS } from './boats.js';

/** Each kind of thing's colour (bright: they're shown on dark panels). */
export const CATEGORY_COLORS = {
  coins: '#ffd23f', gem: '#d08cff', potion: '#ff6f8e', food: '#f4b06a', weapon: '#ffb347', tool: '#7cc0ff', ammo: '#e8cf7a',
  contract: '#f2e3b3', bar: '#e4e8ef', ore: '#d6ae84', block: '#ececec', wall: '#bdbdbd', material: '#dccdaa', quest: '#ffe36e', gear: '#f0f0f0',
  attachment: '#9fd8ff',
  boat: '#8fd8c8',
};
/** What each kind is called. */
const CATEGORY_NAMES = {
  coins: 'Money', gem: 'Gem', potion: 'Potion', food: 'Food', weapon: 'Weapon', tool: 'Tool', ammo: 'Ammunition', contract: 'Contract',
  bar: 'Metal bar', ore: 'Ore', block: 'Block', wall: 'Wall', material: 'Material', quest: 'Quest item', gear: 'Gear',
  attachment: 'Attachment',
  boat: 'Boat',
};

/** The kind of thing an item is (for its colour). */
export function categoryOf(it) {
  if (!it) return 'material';
  if (it.key === 'coins') return 'coins';
  if (it.gem) return 'gem';
  if (it.kind === 'food') return it.look === 'potion' ? 'potion' : 'food';
  if (it.kind === 'bucket') return 'tool';
  if (it.kind === 'boat') return 'boat';
  if (it.kind === 'weapon' || it.kind === 'tool' || it.kind === 'ammo' || it.kind === 'contract' || it.kind === 'wall' || it.kind === 'quest' || it.kind === 'gear' || it.kind === 'attachment') return it.kind;
  if (it.key.endsWith('_bar')) return 'bar';
  if (it.key.endsWith('_ore') || it.key === 'coal' || it.key === 'kimberlite') return 'ore';
  if (it.kind === 'block') return 'block';
  return 'material';
}

/** An item's colour (by its key or the item; a piece of gear: its rarity's, gear.js, given its details or just its rarity). */
export function itemColor(it, g = null) {
  if (g) return RARITY[rarityOf(typeof g === 'string' ? g : g.r)].color;
  return CATEGORY_COLORS[categoryOf(typeof it === 'string' ? itemOf(it) : it)] || '#dddddd';
}

/** What a stack's called on screen: its name, or a piece of gear's own ("Hale Iron helm of Mending"). */
export const stackName = (it, g = null) => g?.name || it?.name || '';

/** Whether an item is worth making a fuss of: it glows where it lies, and it's said big as it's picked up. (Gear: magic or better.) */
export function isPrecious(it, g = null) {
  if (!it) return false;
  if (g) return rarityOf(typeof g === 'string' ? g : g.r) !== 'basic';
  const c = categoryOf(it);
  return c === 'gem' || c === 'potion' || c === 'weapon' || c === 'coins' || c === 'quest' || valueOf(it.key) >= 15;
}

const TIERS = ['', 'copper', 'iron', 'gold', 'crystal', 'diamond'];
// (A base, and defending it: bases.js.)
const BASE_LINES = {
  claim_flag: ['Claims the blocks round it as your base (and your party\'s)', 'Mend it with a builder\'s hammer; a stronghold charter raises it a level'],
  arrow_turret: ['Only in your own base: shoots monsters, and (PvP) intruders', 'Click it with arrows to load it, or put a chest of them beside it'],
  gun_turret: ['Only in your own base: shoots monsters, and (PvP) intruders', 'Click it with bullets to load it, or put a chest of them beside it'],
  spikes: ['Only in your own base: hurts and slows whoever walks through (not your side)'],
  pressure_mine: ['Only in your own base: blows up under whoever steps on it (not your side)'],
  alarm_bell: ['Only in your own base: when it\'s attacked, you hear of it wherever you are'],
  reinforced_bricks: ['Shrugs off blasts; in a raid, only siege tools break it'],
  iron_door: ['In your base, it opens only for you and your party', 'In a raid, only siege tools break it'],
};
const round = v => (v >= 10 ? Math.round(v) : v >= 1 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100);

/**
 * An item's details: { name, kind (what kind of thing, in words), color, lines (what it does),
 * worth (what it's worth, in words, or ''), made (how it's made, or '') }. n: how many there are.
 */
export function itemDetails(it, n = 1, g = null) {
  const cat = categoryOf(it), lines = [];
  let kind = CATEGORY_NAMES[cat];
  // (Gear: what it is and what it gives, its rarity's colour, its worth: gear.js.)
  if (cat === 'gear') {
    const v = gearValue(it.key, g);
    const where = { ring: 'a finger', amulet: 'the neck', hands: 'the hands', waist: 'the waist' }[it.wear] || `the ${it.wear}`;
    return { name: g?.name || it.name, kind: `Gear · worn on ${where} · right click to wear it`, color: itemColor(it, g || 'basic'), lines: gearLines(it.key, g), worth: v ? `Worth about ${v} coins` : '', made: '' };
  }
  // (A weapon dropped with affixes of its own: its own name and colour, then what it is. And what's
  // fitted to it: attachments.js.)
  if (cat === 'weapon' && g) {
    const plain = itemDetails(it, n, null), fitted = attLines(g.att);
    return { ...plain, name: g.name, color: itemColor(it, g), lines: [...gearLines(it.key, g).filter(l => !/^Basic ·/.test(l) || !fitted.length), ...plain.lines, ...(fitted.length ? ['Fitted (right click to take them off):', ...fitted] : [])], worth: `Worth about ${Math.round(valueOf(it.key) * ({ magic: 1.5, rare: 2.2, epic: 3, legendary: 4.5, unique: 6 }[g.r] || 1))} coins` };
  }
  // (A shulker box with things in it: what's in it.)
  if (it.box && g?.box?.length) {
    const plain = itemDetails(it, n, null);
    const held = g.box.slice(0, 8).map(([k, m, , sg]) => `${m > 1 ? `${m} × ` : ''}${sg?.name || itemOf(k)?.name || k}`);
    return { ...plain, name: g.name, lines: ['Holds:', ...held, ...(g.box.length > 8 ? [`and ${g.box.length - 8} more`] : []), 'Put it down to open it; picked up, it keeps them'], worth: plain.worth };
  }
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
      kind = it.kind === 'bucket' ? 'Tool · bucket' : it.tool === 'pick' ? 'Tool · pickaxe' : it.tool === 'axe' ? 'Tool · axe' : it.tool === 'hoe' ? 'Tool · hoe' : it.tool === 'shears' ? 'Tool · shears' : it.tool === 'ram' ? 'Tool · battering ram' : 'Tool · hammer';
      if (it.kind === 'bucket') lines.push(...(it.fluid ? ['Click where it\'s to go (either hand): it pours out, and flows from there'] : ['Click still water (either hand) to fill it: a sea, a lake, a pool', 'Not flowing water: it runs out of still water']));
      else if (it.tool === 'pick') lines.push(`Digs ${TIERS[it.tier] || ''}-tier blocks and softer`, `Digging power ${round(it.power)}`);
      else if (it.tool === 'axe') lines.push('Fells trees, breaks wooden things', `Chopping power ${round(it.power)}`);
      else if (it.tool === 'hoe') lines.push('Tills dirt and grass into farmland', 'Plant seeds, carrots or potatoes on it');
      else if (it.tool === 'shears') lines.push('Click a sheep: its wool (it grows back)');
      // (Raiding a base: bases.js.)
      else if (it.tool === 'ram') lines.push('Knocks in built blocks, reinforced bricks and iron doors too, in a few swings', 'Batters a base\'s flag', 'Not on a base that can\'t be raided now, nor in towns');
      else lines.push('Shapes blocks into halves and ramps', 'Takes down walls');
      break;
    case 'food': case 'potion':
      // (Where there's hunger, food fills you up: hunger.js. Without it, food heals.)
      if (it.food) lines.push(`Fills ${it.food} of 20 hunger${it.raw ? ' (raw: cook it for more)' : ''}`, `Heals ${it.heal} where there's no hunger${it.heals ? `; ${it.heals} anywhere` : ''}`);
      else lines.push(`Heals ${it.heal >= 400 ? 'you fully' : it.heal}`);
      if (it.sick) lines.push(`Raw: ${Math.round(it.sick * 100)}% chance it makes you sick`);
      if (it.plant) lines.push('Or plant it on farmland');
      lines.push(`Click to ${cat === 'potion' ? 'drink' : 'eat'} one (either hand)`);
      break;
    case 'ammo': lines.push('Ammunition, carried for the guns that use it'); break;
    case 'contract': lines.push('Use it (like a weapon) to hire a mercenary'); break;
    case 'attachment': {
      const a = it.att;
      kind = `Attachment · ${ATT_SLOTS[a.slot].toLowerCase()}`;
      const said = effects(a).join(', ');
      if (said) lines.push(said[0].toUpperCase() + said.slice(1));
      if (a.needs === 'mag') lines.push('Only for guns with a magazine (pistols)');
      lines.push('Pick it up, then click a gun to fit it (one in each place)');
      break;
    }
    case 'quest': lines.push('Carried for a quest (your journal says what for)', 'Nobody will buy it'); break;
    // (Boats: boats.js.)
    case 'boat': lines.push(BOATS[it.boat]?.about || 'A boat', 'Click the water (either hand) to put it on', 'Right click it to get in; left and right row it; jump to get out', 'A few hits break it, back into this'); break;
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
      if (BASE_LINES[it.key]) lines.push(...BASE_LINES[it.key]);
      break;
    }
    case 'material':
      // (Farming: farming.js.)
      if (it.plant) lines.push('Planted on farmland (till dirt or grass with a hoe)');
      else if (it.meal) lines.push('Click a crop: it grows; click grass: grass and flowers');
      // (Raiding a base, and making yours stronger: bases.js.)
      else if (it.kind === 'siege') { kind = 'Siege · explosive'; lines.push('Click a wall, a door or a base\'s flag (in reach): it goes off in a few seconds', 'Breaks everything round it, reinforced bricks and iron doors too, and hits a flag hard', 'Not on a base that can\'t be raided now, nor in towns'); }
      else if (it.kind === 'charter') { kind = 'Charter'; lines.push('Use it in your base (or click its flag): the base goes up a level', 'A wider claim, a tougher flag (three levels)'); }
      break;
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
