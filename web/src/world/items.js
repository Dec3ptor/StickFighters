// What players carry in a world (world mode): every block and wall they can place, the tools
// that mine and shape them, the game's own weapons and their ammunition, and materials. And
// the inventory that holds them: a hotbar of ten slots (the number keys) and a bag.
//
// Items go by key (text), which saved worlds keep: 'dirt', 'pickaxe', 'M4', 'bullets'...
//   kind   'block' (places a block), 'wall' (a wall behind), 'tool' (pick, axe, hammer),
//          'weapon' (one of WEAPONS), 'ammo', 'material', 'food' (eaten: heals), 'contract',
//          'quest' (carried for a quest: quests.js), 'gear' (worn: gear.js; each piece its own, slot.g)
//   stack  how many fit in a slot

import { BLOCKS, WALLS, BLOCK_BY_KEY, SHULKER_BOXES } from './blocks.js';
import { WEAPONS } from '../weapons.js';
import { BASES, rarityOf } from './gear.js';
import { ATTACHMENTS, cleanAtt } from './attachments.js';

export const HOTBAR = 10;
export const BAG = 30;

const I = new Map();
const item = (key, name, kind, o = {}) => I.set(key, { key, name, kind, stack: 999, ...o });

// Blocks: each one players can have (what mining gives, and what's built with).
for (const b of BLOCKS) {
  if (b.key === 'air' || b.drop !== b.key) continue;
  if (['loot_crate', 'bedrock', 'door_open'].includes(b.key)) continue;
  item(b.key, b.name, 'block', { block: b.id, color: b.ore || b.color, dark: b.dark, pattern: b.pattern });
  // (A shulker box: one to a slot, with what's in it kept in the slot: slot.g.box.)
  if (SHULKER_BOXES.has(b.id)) Object.assign(I.get(b.key), { stack: 1, box: true });
}
// (Mining a tree gives wood, which is built with as logs.)
item('wood', 'Wood', 'block', { block: BLOCK_BY_KEY.get('log').id, color: '#8a6238', dark: '#5c3f22', pattern: 'rings' });
// Walls.
for (const w of WALLS) if (w.drop === w.key) item(w.key, w.name, 'wall', { wall: w.id, color: w.color });

// Materials (crafting.js): coal, and bars smelted from ore in a furnace.
item('coal', 'Coal', 'material', { color: '#202020' });
item('copper_bar', 'Copper bar', 'material', { color: '#d07a3a' });
item('iron_bar', 'Iron bar', 'material', { color: '#c9ccd2' });
item('gold_bar', 'Gold bar', 'material', { color: '#f2c230' });
item('silver_bar', 'Silver bar', 'material', { color: '#dfe4ec' });
// Gems (mined from their nodes deep down, diamonds from kimberlite pipes): worth a lot, to traders and smiths.
item('ruby', 'Ruby', 'material', { color: '#e0213c', gem: true });
item('sapphire', 'Sapphire', 'material', { color: '#2f62ee', gem: true });
item('emerald', 'Emerald', 'material', { color: '#1fc45c', gem: true });
item('topaz', 'Topaz', 'material', { color: '#f2a81e', gem: true });
item('amethyst', 'Amethyst', 'material', { color: '#a052ea', gem: true });
item('diamond', 'Diamond', 'material', { color: '#c4f6ff', gem: true });
// Food and potions: eaten (used with either hand: a click), they heal (heal: how much). Bought in
// towns (trade.js), baked, picked from trees, and dropped by monsters now and then.
item('apple', 'Apple', 'food', { stack: 99, heal: 12, color: '#d8342c', look: 'apple' });
// (From berry bushes: worlds made since forests.)
item('berries', 'Berries', 'food', { stack: 99, heal: 8, color: '#b0223c', look: 'berries' });
item('bread', 'Bread', 'food', { stack: 99, heal: 25, color: '#c88a3a', look: 'bread' });
item('stew', 'Mushroom stew', 'food', { stack: 20, heal: 50, color: '#9a6a3a', look: 'stew' });
item('healing_potion', 'Healing potion', 'food', { stack: 20, heal: 80, color: '#e0303c', look: 'potion' });
item('greater_potion', 'Greater healing potion', 'food', { stack: 20, heal: 400, color: '#ff5aa0', look: 'potion' });
// Quest items (quests.js): carried for someone, or found for them; not for sale.
for (const [key, name, color] of [
  ['parcel', 'Parcel', '#c8a070'], ['letter', 'Sealed letter', '#f0e6c8'], ['locket', 'Silver locket', '#dfe4ec'], ['journal', 'Old journal', '#8a5a2a'],
  ['satchel', 'Lost satchel', '#7a5634'], ['relic', 'Family relic', '#c2a8ff'], ['ring', 'Gold ring', '#f2c230'], ['idol', 'Stone idol', '#9aa0a8'],
  ['map_scrap', 'Torn map', '#e8dcc0'], ['tools', 'Bag of tools', '#8a8f96'], ['reply', 'Folded reply', '#e6dcc0'],
  ['seal', 'Ancient seal', '#c46a2a'], ['ember_key', 'Ember key', '#ff7a2a'],
]) item(key, name, 'quest', { stack: 20, color });
// Gear (gear.js): worn on the head, body or feet, rings and amulets. Each piece is one of a kind
// (its rarity, name and affixes kept in its slot: slot.g), so they don't stack.
for (const [key, b] of Object.entries(BASES)) item(key, b.name, 'gear', { stack: 1, wear: b.kind, color: b.color });
// Weapon attachments (attachments.js): fitted to a gun in the inventory (picked up, put on it).
for (const [key, a] of Object.entries(ATTACHMENTS)) item(key, a.name, 'attachment', { stack: 10, color: a.color, att: a });
// A recall scroll: read (a click, either hand), after a few moments it takes you home (your bed, an
// inn you rested at, or where the world starts): worldplay.js. Sold at temples and markets.
item('recall_scroll', 'Recall scroll', 'scroll', { stack: 20, color: '#e8dcc0' });
// Coins: what monsters drop (and half of what you carry, when you die): mercenaries are hired with them.
item('coins', 'Coins', 'material', { color: '#f2c230' });
// A mercenary's contract: used (like a weapon), it hires one, who follows you and shoots monsters.
item('merc_contract', 'Mercenary contract', 'contract', { stack: 10, color: '#e8dcc0' });
// Buckets (worldplay.js's useBucket): an empty one fills from still water (a click, either hand, on
// a source in reach); a full one pours it out where it's clicked, to flow from there. fluid: what's in it.
item('bucket', 'Bucket', 'bucket', { stack: 16, color: '#c9ccd2' });
item('water_bucket', 'Water bucket', 'bucket', { stack: 1, color: '#2f6fd0', fluid: 'water' });

// Tools. power: damage a hit does to a block (a block's `hard` is how many basic hits it
// takes); every: updates between hits (at full speed); tier: the hardest blocks it can mine.
item('pickaxe', 'Copper pickaxe', 'tool', { stack: 1, tool: 'pick', power: 1, every: 13, tier: 1, color: '#d07a3a', handle: '#7a5634' });
item('iron_pickaxe', 'Iron pickaxe', 'tool', { stack: 1, tool: 'pick', power: 1.6, every: 12, tier: 2, color: '#c9ccd2', handle: '#7a5634' });
item('gold_pickaxe', 'Gold pickaxe', 'tool', { stack: 1, tool: 'pick', power: 2.3, every: 11, tier: 3, color: '#f2c230', handle: '#5c3f22' });
item('crystal_pickaxe', 'Crystal pickaxe', 'tool', { stack: 1, tool: 'pick', power: 3.2, every: 9, tier: 4, color: '#5ee0ff', handle: '#3a2c48' });
item('diamond_pickaxe', 'Diamond pickaxe', 'tool', { stack: 1, tool: 'pick', power: 4.4, every: 8, tier: 5, color: '#c4f6ff', handle: '#2a2a34' });
item('axe', 'Copper axe', 'tool', { stack: 1, tool: 'axe', power: 1.2, every: 15, tier: 1, color: '#d07a3a', handle: '#7a5634' });
item('hammer', 'Builder\'s hammer', 'tool', { stack: 1, tool: 'hammer', power: 1.5, every: 12, tier: 1, color: '#8a8f96', handle: '#7a5634' });

// Ammunition, and the game's weapons (each takes one kind of ammo, or uses itself up: grenades,
// sheep, dynamite...; melee weapons and the rope need none).
item('bullets', 'Bullets', 'ammo', { color: '#c8a040' });
item('shells', 'Shotgun shells', 'ammo', { color: '#c8402c' });
item('rockets', 'Rockets', 'ammo', { stack: 99, color: '#5a6a3a' });
item('arrows', 'Arrows', 'ammo', { color: '#8a6a3a' });
item('fuel', 'Fuel', 'ammo', { color: '#e07a1f' });

/** The ammo item weapon `id` uses: a key, 'self' (each one is used up), or null (none needed). */
export function ammoOf(id) {
  const d = WEAPONS[id];
  if (!d) return null;
  switch (d.kind) {
    case 'bullet': return (d.pellets || 0) > 1 ? 'shells' : 'bullets';
    case 'rail': case 'seeker': return 'bullets';
    case 'arrow': return 'arrows';
    case 'rocket': return 'rockets';
    case 'flame': return 'fuel';
    case 'melee': case 'rope': return null;
    default: return 'self';
  }
}

for (const [id, d] of Object.entries(WEAPONS)) {
  if (d.hidden || d.kind === 'build' || d.kind === 'plant') continue;
  const self = ammoOf(id) === 'self';
  item(id, d.name, 'weapon', { weapon: id, stack: self ? 20 : 1, ammo: ammoOf(id) });
}

/** What a supply crate (found in ruins and caves) can hold: [key, least, most, how likely (a weight)]. */
export const CRATE_LOOT = [
  ['bullets', 40, 120, 8], ['shells', 10, 30, 4], ['rockets', 3, 8, 2], ['arrows', 20, 40, 2], ['fuel', 80, 160, 1],
  ['torch', 6, 14, 5], ['iron_ore', 6, 14, 4], ['gold_ore', 3, 8, 2], ['coal', 6, 16, 4], ['glass', 10, 20, 2], ['metal', 4, 10, 2],
  ['copper_bar', 3, 8, 3], ['iron_bar', 2, 6, 3], ['gold_bar', 1, 4, 2],
  ['Magnum', 1, 1, 2], ['Uzi', 1, 1, 2], ['MP5K', 1, 1, 2], ['M4', 1, 1, 2], ['AK47', 1, 1, 2], ['Shotgun', 1, 1, 2],
  ['Longbow', 1, 1, 1], ['SR', 1, 1, 1], ['Bazooka', 1, 1, 1], ['GrenadeLauncher', 1, 1, 1], ['Flamer', 1, 1, 1],
  ['ClusterBomb', 2, 4, 2], ['Dynamite', 2, 4, 2], ['Mine', 2, 5, 2], ['Sheep', 1, 2, 1], ['NinjaRope', 1, 1, 1], ['iron_pickaxe', 1, 1, 1],
  // (The rarest: only ever found in crates.)
  // (Attachments for guns: attachments.js. The best scopes only from crafting, and the rarest finds.)
  ['red_dot', 1, 1, 0.8], ['scope2', 1, 1, 0.8], ['scope4', 1, 1, 0.5], ['scope8', 1, 1, 0.2], ['foregrip', 1, 1, 0.7], ['ext_mag', 1, 1, 0.6],
  ['suppressor', 1, 1, 0.4], ['hollow_points', 2, 6, 0.8], ['laser', 1, 1, 0.4],
  ['recall_scroll', 1, 2, 1], ['Skunk', 1, 2, 0.6], ['OldWoman', 1, 1, 0.4], ['AirStrike', 1, 1, 0.4], ['NapalmStrike', 1, 1, 0.3], ['Earthquake', 1, 1, 0.2], ['Kamikaze', 1, 1, 0.4],
];

export const ITEMS = I;
export const itemOf = key => I.get(key) || null;

/**
 * What a new character starts with: tools to dig and build, a pistol and a shotgun, enough to
 * start a base, and a workbench to start crafting at (crafting.js).
 */
export const STARTING_KIT = [
  ['pickaxe', 1], ['axe', 1], ['hammer', 1], ['Platinum', 1], ['torch', 30], ['planks', 99], ['platform', 40], ['ladder', 20],
  ['door', 4], ['plank_wall', 99], ['bullets', 120], ['glass', 30], ['stone_bricks', 99], ['Shotgun', 1], ['shells', 30],
  ['workbench', 1],
];

/** A piece of gear's details from a save or the network: only what there should be. */
export function cleanGear(g) {
  if (!g || typeof g !== 'object') return null;
  const out = { r: rarityOf(g.r), name: String(g.name || '').slice(0, 60), stats: {}, ilvl: Math.max(1, Math.min(60, g.ilvl | 0 || 1)) };
  for (const [k, v] of Object.entries(g.stats || {})) if (/^[a-z]{2,6}$/.test(k) && Number.isFinite(v)) out.stats[k] = Math.max(-100, Math.min(500, Math.round(v)));
  if (typeof g.set === 'string') out.set = g.set.slice(0, 24);
  if (typeof g.unique === 'string') out.unique = g.unique.slice(0, 24);
  // (A gun's attachments: attachments.js.)
  const att = cleanAtt(g.att);
  if (att) out.att = att;
  // (A shulker box's things: [[key, n, mag, g]], none of them shulker boxes.)
  if (Array.isArray(g.box)) {
    out.box = [];
    for (const e of g.box.slice(0, 40)) {
      const it = Array.isArray(e) && typeof e[0] === 'string' ? itemOf(e[0]) : null;
      if (!it || it.box) continue;
      const n = Math.max(1, Math.min(it.stack, e[1] | 0)), sub = e[3] ? cleanGear(e[3]) : null;
      out.box.push(sub ? [e[0], n, e[2] | 0, sub] : (e[2] | 0) > 0 ? [e[0], n, e[2] | 0] : [e[0], n]);
    }
  }
  return out;
}

/** A shulker box's slot details (g) for things `slots` (an inventory's): its name says how many. */
export function boxDetails(key, slots) {
  const box = slots.filter(Boolean).map(s => (s.g ? [s.key, s.n, s.mag || 0, s.g] : s.mag > 0 ? [s.key, s.n, s.mag] : [s.key, s.n]));
  const n = box.reduce((t, e) => t + e[1], 0);
  return { r: 'basic', name: `${itemOf(key)?.name ?? 'Shulker box'} (${n} thing${n === 1 ? '' : 's'})`, stats: {}, ilvl: 1, box };
}

/** A player's things: HOTBAR + BAG slots, each null or { key, n } (a gun's also has mag: rounds in its magazine; gear, g). */
export class Inventory {
  constructor(size = HOTBAR + BAG) {
    this.slots = new Array(size).fill(null);
    this.version = 0; // goes up with every change (the hotbar and inventory screen redraw)
  }

  /** How many of `key` there are in all. */
  count(key) {
    let n = 0;
    for (const s of this.slots) if (s && s.key === key) n += s.n;
    return n;
  }

  /** Room for how many more of `key`. */
  room(key) {
    const it = itemOf(key);
    if (!it) return 0;
    let n = 0;
    for (const s of this.slots) n += !s ? it.stack : s.key === key ? it.stack - s.n : 0;
    return n;
  }

  /** Put n of `key` in (onto stacks of it first, then the first empty slots). Returns how many didn't fit. */
  add(key, n = 1) {
    const it = itemOf(key);
    if (!it || n <= 0) return n;
    for (const s of this.slots) {
      if (n <= 0) break;
      if (s && s.key === key && s.n < it.stack) { const k = Math.min(n, it.stack - s.n); s.n += k; n -= k; }
    }
    for (let i = 0; i < this.slots.length && n > 0; i++) {
      if (this.slots[i]) continue;
      const k = Math.min(n, it.stack);
      this.slots[i] = { key, n: k };
      n -= k;
    }
    this.version++;
    return n;
  }

  /** Take n of `key` out (from the last stacks first). Returns how many were taken. */
  remove(key, n = 1) {
    let took = 0;
    for (let i = this.slots.length - 1; i >= 0 && took < n; i--) {
      const s = this.slots[i];
      if (!s || s.key !== key) continue;
      const k = Math.min(n - took, s.n);
      s.n -= k;
      took += k;
      if (s.n <= 0) this.slots[i] = null;
    }
    if (took) this.version++;
    return took;
  }

  /** Take n out of slot i. Returns { key, n } taken (and g, a piece of gear's), or null. */
  take(i, n = Infinity) {
    const s = this.slots[i];
    if (!s) return null;
    const k = Math.min(n, s.n);
    s.n -= k;
    if (s.n <= 0) this.slots[i] = null;
    this.version++;
    return s.g ? { key: s.key, n: k, g: s.g } : { key: s.key, n: k };
  }

  /** Put a piece of gear in (key: its base, g: its rarity, name and affixes: gear.js), in the first empty slot. Returns false if there's no room. */
  addGear(key, g) {
    const i = this.slots.indexOf(null);
    if (i < 0) return false;
    this.slots[i] = { key, n: 1, g };
    this.version++;
    return true;
  }

  /** Swap slots a and b (or put a's stack onto b's, if they're the same thing). */
  move(a, b) {
    if (a === b) return;
    const A = this.slots[a], Bs = this.slots[b];
    if (A && Bs && A.key === Bs.key && (itemOf(A.key)?.stack ?? 1) > 1) {
      const it = itemOf(A.key), k = Math.min(A.n, it.stack - Bs.n);
      Bs.n += k; A.n -= k;
      if (A.n <= 0) this.slots[a] = null;
    } else {
      this.slots[a] = Bs;
      this.slots[b] = A;
    }
    this.version++;
  }

  /** Half of slot i's stack into the first empty slot (none if there's no room). */
  split(i) {
    const s = this.slots[i];
    if (!s || s.n < 2) return false;
    const to = this.slots.indexOf(null);
    if (to < 0) return false;
    const half = Math.floor(s.n / 2);
    s.n -= half;
    this.slots[to] = { key: s.key, n: half };
    this.version++;
    return true;
  }

  /**
   * Slot i's stack across to the other part (the hotbar's to the bag, the bag's to the
   * hotbar): onto stacks of the same thing there first, then the first empty slot.
   */
  quickMove(i) {
    const s = this.slots[i];
    if (!s) return false;
    const it = itemOf(s.key), toBag = i < HOTBAR;
    const from = toBag ? HOTBAR : 0, to = toBag ? this.slots.length : HOTBAR;
    for (let j = from; j < to && s.n > 0; j++) {
      const o = this.slots[j];
      if (o && o.key === s.key && it && o.n < it.stack && o.mag == null && s.mag == null) { const k = Math.min(s.n, it.stack - o.n); o.n += k; s.n -= k; }
    }
    for (let j = from; j < to && s.n > 0; j++) if (!this.slots[j]) { this.slots[j] = s; this.slots[i] = null; break; }
    if (s.n <= 0) this.slots[i] = null;
    this.version++;
    return this.slots[i] !== s;
  }

  /** The bag put in order (tools and guns first, then blocks...), stacks of the same thing joined. */
  sortBag() {
    const order = { quest: 0, gear: 1, tool: 2, weapon: 3, ammo: 4, food: 5, block: 6, wall: 7, material: 8 };
    const items = this.slots.slice(HOTBAR).filter(Boolean);
    const joined = [];
    for (const s of items) {
      const it = itemOf(s.key);
      let left = s.n;
      if (it && s.mag == null && !s.g) {
        for (const o of joined) {
          if (left <= 0) break;
          if (o.key === s.key && o.mag == null && !o.g && o.n < it.stack) { const k = Math.min(left, it.stack - o.n); o.n += k; left -= k; }
        }
      }
      if (left > 0) joined.push({ ...s, n: left });
    }
    const rank = s => order[itemOf(s.key)?.kind] ?? 9;
    joined.sort((a, b) => rank(a) - rank(b) || (itemOf(a.key)?.name || a.key).localeCompare(itemOf(b.key)?.name || b.key) || b.n - a.n);
    for (let i = HOTBAR; i < this.slots.length; i++) this.slots[i] = joined[i - HOTBAR] || null;
    this.version++;
  }

  toJSON() { return this.slots.map(s => (!s ? null : s.g ? [s.key, s.n, s.mag || 0, s.g] : s.mag > 0 ? [s.key, s.n, s.mag] : [s.key, s.n])); }

  /** Slot i's stack of `a` onto slot j of `b` (the same inventory or another, a chest's): swapped, or onto a stack of the same thing. */
  static moveBetween(a, i, b, j) {
    if (a === b) { a.move(i, j); return; }
    const A = a.slots[i], Bs = b.slots[j];
    if (!A) return;
    // (What one won't take, it doesn't: a shulker box in a shulker box.)
    if (b.refuse?.(A.key) || (Bs && a.refuse?.(Bs.key))) return;
    const it = itemOf(A.key);
    if (Bs && Bs.key === A.key && (it?.stack ?? 1) > 1) {
      const k = Math.min(A.n, it.stack - Bs.n);
      Bs.n += k; A.n -= k;
      if (A.n <= 0) a.slots[i] = null;
    } else {
      a.slots[i] = Bs;
      b.slots[j] = A;
    }
    a.version++;
    b.version++;
  }

  /**
   * Slot i's stack of `a` sent to `b`: onto stacks of the same thing there first, then into its
   * first empty slot from `from` on (then the ones before). What doesn't fit stays.
   */
  static send(a, i, b, from = 0) {
    const s = a.slots[i];
    if (!s || a === b || b.refuse?.(s.key)) return;
    const it = itemOf(s.key);
    if ((it?.stack ?? 1) > 1) {
      for (const o of b.slots) {
        if (s.n <= 0) break;
        if (o && o.key === s.key && o.n < it.stack) { const k = Math.min(s.n, it.stack - o.n); o.n += k; s.n -= k; }
      }
    }
    if (s.n > 0) {
      const n = b.slots.length;
      for (let k = 0; k < n; k++) {
        const j = (from + k) % n;
        if (!b.slots[j]) { b.slots[j] = s; a.slots[i] = null; break; }
      }
    } else a.slots[i] = null;
    a.version++;
    b.version++;
  }

  /** Everything in `a` (from slot `start` on) sent to `b` (into its slots from `from` on), as much as fits. */
  static sendAll(a, b, start = 0, from = 0) {
    for (let i = start; i < a.slots.length; i++) Inventory.send(a, i, b, from);
  }

  /** An inventory as saved (unknown items, from a newer game, are kept as they are). */
  static from(list, size = HOTBAR + BAG) {
    const inv = new Inventory(size);
    if (Array.isArray(list)) {
      for (let i = 0; i < Math.min(size, list.length); i++) {
        const s = list[i];
        if (Array.isArray(s) && typeof s[0] === 'string' && Number.isFinite(s[1]) && s[1] > 0) {
          inv.slots[i] = { key: s[0], n: Math.floor(s[1]) };
          if (Number.isFinite(s[2]) && s[2] > 0) inv.slots[i].mag = Math.floor(s[2]);
          // (A piece of gear: what it is, as rolled: gear.js.)
          if (s[3] && typeof s[3] === 'object') inv.slots[i].g = cleanGear(s[3]);
        }
      }
    }
    return inv;
  }

  /** A new character's things (the guns loaded). */
  /** A new character's things (kit: other things to start with, [key, n] pairs: worldrules.js). */
  static starting(kit = STARTING_KIT) {
    const inv = new Inventory();
    for (const [key, n] of kit) inv.add(key, n);
    for (const s of inv.slots) if (s && WEAPONS[s.key]?.mag) s.mag = WEAPONS[s.key].mag;
    return inv;
  }
}
