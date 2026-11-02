// The codex (world mode: the journal's third page). Everything there is to have in a world, each
// with how it's had: mined (from what), made (where, and from what), sold (by whom), dropped (by
// which monsters), found, worn; the gear's bases, every unique and every piece of every set
// (gear.js) among them. And which of them a player has found: whatever's been in their hands
// (markFound, as their things change: worldplay.js).

import { ITEMS, CRATE_LOOT } from './items.js';
import { BLOCKS, WALLS } from './blocks.js';
import { RECIPES, STATION_NAMES, madeFrom } from './crafting.js';
import { SHOPS } from './trade.js';
import { MONSTERS } from './monsters.js';
import { BASES, DROP_WEAPONS, namedGear, foundId } from './gear.js';

/** The codex's kinds of thing, in the order its buttons show them. */
export const CODEX_CATS = { all: 'All', gear: 'Gear', weapon: 'Weapons', unique: 'Uniques', set: 'Sets', block: 'Blocks', material: 'Materials', food: 'Food', tool: 'Tools', other: 'Other' };

const CAT_OF = { gear: 'gear', weapon: 'weapon', block: 'block', wall: 'block', material: 'material', food: 'food', tool: 'tool' };
const WEAR = { head: 'head', body: 'body', hands: 'hands', waist: 'waist', feet: 'feet', ring: 'finger (two can be worn)', amulet: 'neck' };
const SHOP_FOR = { head: 'smiths', body: 'smiths', hands: 'smiths', waist: 'smiths', feet: 'smiths', ring: 'market traders', amulet: 'market traders' };
// (Things the tables don't say.)
const EXTRA = {
  wood: 'Chopped from trees (an axe is quickest)',
  apple: 'Falls from leaves now and then',
  coins: 'Dropped by every monster; paid for what you sell, and for quests',
  merc_contract: 'Used, it hires a mercenary who follows you and fights',
  Teleport: 'Rare: market traders sometimes have one',
  log: 'Wood, built with: broken, a log you built gives a log back',
};

let entries = null;

/**
 * Every entry: { id (what finding it counts as: foundId), key (its item), g (a unique's or set
 * piece's own), cat, name, where }. Worked out once.
 */
export function codexEntries() {
  if (entries) return entries;
  const out = [];
  const sellers = key => Object.values(SHOPS).filter(sh => sh.sells.some(([k]) => k === key) || sh.rare?.some(([k]) => k === key)).map(sh => sh.name.toLowerCase());
  const droppers = key => Object.values(MONSTERS).filter(m => m.loot?.some(([k]) => k === key)).map(m => `${m.name.toLowerCase()}s`);
  const a = n => `${/^[aeiou]/i.test(n) ? 'an' : 'a'} ${n}`;
  for (const [key, it] of ITEMS) {
    const where = [];
    if (EXTRA[key]) where.push(EXTRA[key]);
    // Mined: the block itself (out in the world), or what another block gives (a gem's node).
    const own = BLOCKS.find(b => b.key === key && b.drop === key && b.natural);
    for (const b of EXTRA[key] ? [] : own ? [own] : BLOCKS) {
      if (b.drop !== key || !b.natural) continue;
      where.push(b.key === key ? 'Mined, out in the world' : b.pattern === 'gem' ? `Mined from ${b.name.toLowerCase()} nodes, deep underground` : `Mined from ${b.name.toLowerCase()}`);
      break;
    }
    if (it.kind === 'wall' && WALLS.find(x => x.key === key)?.natural) where.push('Knocked out from behind the ground, with a hammer');
    for (const r of RECIPES.filter(x => x.key === key).slice(0, 2)) where.push(`Made ${r.at ? `at a ${STATION_NAMES[r.at].toLowerCase()}` : 'by hand'} from ${madeFrom(r).toLowerCase()}${r.n > 1 ? ` (${r.n} at a time)` : ''}`);
    const shops = sellers(key);
    if (shops.length) where.push(`Sold at ${list(shops.map(a))}`);
    if (CRATE_LOOT.some(([k]) => k === key)) where.push('Found in supply crates (in ruins and caves)');
    const by = droppers(key);
    if (by.length) where.push(`Dropped by ${list(by)}`);
    if (it.kind === 'gear') {
      const base = BASES[key];
      where.unshift(`Worn on the ${WEAR[base.kind] || base.kind}`);
      where.push(`Dropped by monsters from item level ${base.level}${base.level > 10 ? ' (deeper down, or tougher monsters)' : ''}, in any rarity; sold by ${SHOP_FOR[base.kind]} and general stores`);
    }
    if (it.kind === 'weapon' && DROP_WEAPONS.includes(key)) where.push('Dropped by monsters with affixes of its own (magic, rare, epic, legendary, unique); sold so by gunsmiths');
    if (it.kind === 'quest') where.push('Carried for a quest: given, or found where the quest says');
    out.push({ id: key, key, g: null, cat: CAT_OF[it.kind] || 'other', name: it.name, where: where.join('. ') || 'Found in the world' });
  }
  for (const n of namedGear()) out.push({ id: n.id, key: n.key, g: n.g, cat: n.g.r === 'unique' ? 'unique' : 'set', name: n.g.name, where: n.where });
  entries = out;
  return out;
}

const list = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);

/** Player s has had (key, g) in their hands: the codex counts it found (its base, and it, a unique or a set piece). */
export function markFound(s, key, g = null) {
  const w = s.world;
  if (!w || !ITEMS.has(key)) return false;
  const f = (w.found ||= []);
  let added = false;
  for (const id of g ? [key, foundId(key, g)] : [key]) {
    if (f.includes(id)) continue;
    f.push(id);
    added = true;
  }
  if (added) w.foundV = (w.foundV || 0) + 1;
  return added;
}

/** What's in player s's hands now (bag, hotbar, worn), found. */
export function scanFound(s) {
  const w = s.world;
  if (!w) return;
  for (const sl of w.inv.slots) if (sl) markFound(s, sl.key, sl.g || null);
  for (const it of Object.values(w.gear || {})) if (it) markFound(s, it.key, it.g || null);
}

/** A found list from a save (or the network): only what there is. */
export function cleanFound(list) {
  if (!Array.isArray(list)) return [];
  const ids = new Set(codexEntries().map(e => e.id));
  return [...new Set(list.filter(x => typeof x === 'string' && ids.has(x)))];
}

