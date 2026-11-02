// Gear (world mode): what's worn, and loot as Diablo 2 had it. Five places to wear things (head,
// body, feet, two rings and an amulet), each kind of thing in a few bases (a leather cap, an iron
// helm, a steel helm, a circlet...). What drops (from monsters, named ones most of all, and the
// chests deep down) comes in five rarities:
//
//   normal (white)  just the base
//   magic  (blue)   one or two affixes, named for them: "Hale Iron helm of Mending"
//   rare   (yellow) three or four, and a name of its own: "Grim Shroud"
//   set    (green)  one piece of a set: the more of it worn, the more it gives
//   unique (gold)   one of a kind, always the same: "The Gravedigger's Hood"
//
// Each piece has an item level (from where it dropped): better bases and bigger numbers higher up.
// What gear gives (gearStats): armour (less damage taken), health, gun and melee damage, faster
// digging, more coins, magic find (better drops), healing over time, more experience, and fire
// resistance (magma). An item's gear is kept in its slot (items.js: slot.g), as saved and sent.

import { hash3 } from './noise.js';

/** Where things are worn, in the order the inventory shows them. */
export const SLOTS = ['head', 'amulet', 'body', 'ring1', 'ring2', 'feet'];
export const SLOT_NAMES = { head: 'Head', amulet: 'Amulet', body: 'Body', ring1: 'Ring', ring2: 'Ring', feet: 'Feet' };
const KIND_OF = { ring1: 'ring', ring2: 'ring' };
/** The kind of thing slot `slot` takes. */
export const slotKind = slot => KIND_OF[slot] || slot;

/** The bases: what each is, where it's worn, its armour, from what item level it drops, its colours. */
export const BASES = {
  leather_cap: { name: 'Leather cap', kind: 'head', armor: 3, level: 1, color: '#8a5a32' },
  iron_helm: { name: 'Iron helm', kind: 'head', armor: 7, level: 6, color: '#9aa4ae' },
  circlet: { name: 'Circlet', kind: 'head', armor: 2, level: 10, color: '#f2c230' },
  steel_helm: { name: 'Steel helm', kind: 'head', armor: 11, level: 14, color: '#c9d2dc' },
  leather_armor: { name: 'Leather armour', kind: 'body', armor: 6, level: 1, color: '#8a5a32' },
  chainmail: { name: 'Chainmail', kind: 'body', armor: 12, level: 6, color: '#9aa4ae' },
  plate: { name: 'Plate armour', kind: 'body', armor: 19, level: 14, color: '#c9d2dc' },
  leather_boots: { name: 'Leather boots', kind: 'feet', armor: 2, level: 1, color: '#6b4423' },
  iron_boots: { name: 'Iron boots', kind: 'feet', armor: 5, level: 8, color: '#9aa4ae' },
  copper_ring: { name: 'Copper ring', kind: 'ring', armor: 0, level: 1, color: '#d07a3a' },
  silver_ring: { name: 'Silver ring', kind: 'ring', armor: 0, level: 6, color: '#dfe4ec' },
  gold_band: { name: 'Gold band', kind: 'ring', armor: 0, level: 12, color: '#f2c230' },
  amulet: { name: 'Amulet', kind: 'amulet', armor: 0, level: 3, color: '#f2c230' },
};

/** What gear can give: its words, and how it's said. */
export const STATS = {
  armor: { word: 'armour', show: v => `+${v} armour` },
  hp: { word: 'health', show: v => `+${v} health` },
  gun: { word: 'gun damage', show: v => `+${v}% gun damage` },
  melee: { word: 'melee damage', show: v => `+${v}% melee damage` },
  dig: { word: 'digging', show: v => `+${v}% digging speed` },
  coin: { word: 'coins', show: v => `+${v}% coins from monsters` },
  mf: { word: 'magic find', show: v => `+${v}% magic find (better drops)` },
  regen: { word: 'regeneration', show: v => `Heals ${v} health every two seconds` },
  xp: { word: 'experience', show: v => `+${v}% experience` },
  fire: { word: 'fire resistance', show: v => `${v}% less harm from fire and magma` },
};

/**
 * The affixes: prefixes and suffixes, each a stat, its range at item level 1 and at 30 (rolled
 * in between, by the item's level), and which kinds of thing it can be on.
 */
const PREFIXES = [
  { name: 'Sturdy', stat: 'armor', lo: [2, 4], hi: [8, 14], on: ['head', 'body', 'feet'] },
  { name: 'Hale', stat: 'hp', lo: [8, 15], hi: [30, 50] },
  { name: 'Deadly', stat: 'gun', lo: [4, 8], hi: [14, 22], on: ['ring', 'amulet', 'head'] },
  { name: 'Savage', stat: 'melee', lo: [8, 15], hi: [25, 40], on: ['ring', 'amulet', 'body'] },
  { name: "Miner's", stat: 'dig', lo: [8, 15], hi: [25, 40], on: ['head', 'ring', 'amulet', 'body'] },
  { name: 'Lucky', stat: 'coin', lo: [10, 20], hi: [30, 50], on: ['ring', 'amulet', 'feet'] },
  { name: 'Gilded', stat: 'mf', lo: [6, 12], hi: [20, 35], on: ['ring', 'amulet', 'head'] },
];
const SUFFIXES = [
  { name: 'of Mending', stat: 'regen', lo: [1, 1], hi: [2, 4] },
  { name: 'of the Fox', stat: 'xp', lo: [3, 6], hi: [10, 18], on: ['ring', 'amulet', 'head'] },
  { name: 'of Embers', stat: 'fire', lo: [10, 20], hi: [35, 60], on: ['body', 'feet', 'ring', 'amulet'] },
  { name: 'of the Bear', stat: 'hp', lo: [10, 18], hi: [35, 60], on: ['body', 'head', 'amulet'] },
  { name: 'of Warding', stat: 'armor', lo: [2, 5], hi: [8, 15], on: ['body', 'feet', 'amulet', 'ring'] },
  { name: 'of the Hunt', stat: 'gun', lo: [3, 7], hi: [12, 20], on: ['head', 'feet', 'ring'] },
  { name: 'of Plenty', stat: 'mf', lo: [5, 10], hi: [15, 30], on: ['feet', 'body', 'ring'] },
];
// (Rare items' names: two halves.)
const RARE_A = ['Grim', 'Doom', 'Storm', 'Bone', 'Blood', 'Raven', 'Dread', 'Iron', 'Ghoul', 'Wraith', 'Viper', 'Soul', 'Hailstone', 'Ember', 'Gloom'];
const RARE_B = { head: ['Visage', 'Crown', 'Brow', 'Hood', 'Cowl'], body: ['Shroud', 'Hide', 'Mantle', 'Carapace', 'Coat'], feet: ['Stride', 'Trample', 'Track', 'Tread'], ring: ['Loop', 'Coil', 'Band', 'Spiral', 'Eye'], amulet: ['Charm', 'Talisman', 'Heart', 'Ward', 'Torc'] };

/** The uniques: one of a kind, always the same. */
export const UNIQUES = {
  gravedigger: { name: "The Gravedigger's Hood", base: 'leather_cap', stats: { dig: 35, hp: 20, armor: 4 } },
  warden: { name: "The Warden's Plate", base: 'plate', stats: { armor: 30, hp: 45, regen: 2 } },
  ember_crown: { name: 'The Ember Crown', base: 'circlet', stats: { hp: 60, fire: 60, gun: 15, mf: 25 } },
  bonecrusher: { name: 'Bonecrusher', base: 'gold_band', stats: { melee: 30, hp: 15 } },
  miners_luck: { name: "Miner's Luck", base: 'copper_ring', stats: { coin: 30, mf: 20, dig: 10 } },
  eye_deep: { name: 'Eye of the Deep', base: 'amulet', stats: { xp: 20, mf: 25, fire: 20 } },
  ravens_mantle: { name: "Raven's Mantle", base: 'leather_armor', stats: { armor: 10, gun: 12, xp: 10 } },
  old_king: { name: "The Old King's Circlet", base: 'circlet', stats: { regen: 3, xp: 25, hp: 25 } },
  stormstep: { name: 'Stormstep', base: 'iron_boots', stats: { armor: 8, hp: 30, gun: 8 } },
  brute_hide: { name: 'Hide of the Brute', base: 'chainmail', stats: { armor: 18, hp: 50, melee: 15 } },
};

/** The sets: their pieces (and the uniques' way of naming them), and what wearing 2 or 3 adds. */
export const SETS = {
  watchman: {
    name: "Watchman's Vigil",
    pieces: { iron_helm: "Watchman's Helm", chainmail: "Watchman's Coat", silver_ring: "Watchman's Seal" },
    stats: { iron_helm: { armor: 6, hp: 15 }, chainmail: { armor: 10, hp: 20 }, silver_ring: { gun: 8 } },
    bonus: { 2: { hp: 25 }, 3: { gun: 12, armor: 12, regen: 1 } },
  },
  delver: {
    name: "Deepdelver's Kit",
    pieces: { leather_cap: "Deepdelver's Cap", leather_armor: "Deepdelver's Jerkin", copper_ring: "Deepdelver's Ring" },
    stats: { leather_cap: { dig: 15 }, leather_armor: { armor: 6, hp: 10 }, copper_ring: { coin: 15 } },
    bonus: { 2: { dig: 20 }, 3: { mf: 30, coin: 20, fire: 20 } },
  },
};

/** The rarities: their colours (as Diablo 2 had them) and names. */
export const RARITY = {
  normal: { name: 'Normal', color: '#f0f0f0' },
  magic: { name: 'Magic', color: '#7b8cff' },
  rare: { name: 'Rare', color: '#ffff64' },
  set: { name: 'Set', color: '#3cff3c' },
  unique: { name: 'Unique', color: '#c8a464' },
};
export const RARITIES = Object.keys(RARITY);

/** A random number source from a seed. */
function rngOf(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = list => list[Math.floor(r() * list.length)];
  return r;
}

/** An affix's roll at item level `ilvl` (between its low and high ranges). */
function roll(a, ilvl, r) {
  const f = Math.max(0, Math.min(1, (ilvl - 1) / 29));
  const lo = Math.round(a.lo[0] + (a.hi[0] - a.lo[0]) * f), hi = Math.round(a.lo[1] + (a.hi[1] - a.lo[1]) * f);
  return r.int(lo, Math.max(lo, hi));
}

/**
 * A piece of gear dropped at item level `ilvl` (by `seed`, a number): { key (its base, an item key),
 * g: { r (rarity), name, stats, ilvl, set?, unique? } }. mf: magic find (%), better rarities more
 * often. rarity: one asked for (a boss's unique, say) instead of rolled.
 */
export function rollGear(seed, ilvl = 1, mf = 0, rarity = null, uniqueId = null) {
  const r = rngOf(seed);
  // The rarity: more magic find, more of the good ones.
  const m = 1 + mf / 100;
  let rar = rarity;
  if (!rar) {
    const x = r();
    rar = x < 0.012 * m ? 'unique' : x < 0.03 * m ? 'set' : x < 0.12 * m ? 'rare' : x < 0.45 * m ? 'magic' : 'normal';
  }
  if (rar === 'unique') {
    const ids = Object.keys(UNIQUES).filter(id => BASES[UNIQUES[id].base].level <= Math.max(ilvl, 12));
    const id = uniqueId || r.pick(ids.length ? ids : Object.keys(UNIQUES)), u = UNIQUES[id];
    return { key: u.base, g: { r: 'unique', name: u.name, stats: { ...u.stats }, ilvl, unique: id } };
  }
  if (rar === 'set') {
    const setId = r.pick(Object.keys(SETS)), set = SETS[setId], base = r.pick(Object.keys(set.pieces));
    return { key: base, g: { r: 'set', name: set.pieces[base], stats: { ...set.stats[base] }, ilvl, set: setId } };
  }
  // A base this level can have.
  const bases = Object.keys(BASES).filter(k => BASES[k].level <= ilvl);
  const key = r.pick(bases.length ? bases : ['leather_cap']), base = BASES[key], kind = base.kind;
  const fits = list => list.filter(a => !a.on || a.on.includes(kind));
  const stats = {}, add = (stat, v) => { stats[stat] = (stats[stat] || 0) + v; };
  let name = base.name;
  if (rar === 'magic') {
    const pre = r() < 0.75 ? r.pick(fits(PREFIXES)) : null, suf = !pre || r() < 0.5 ? r.pick(fits(SUFFIXES)) : null;
    if (pre) { add(pre.stat, roll(pre, ilvl, r)); name = `${pre.name} ${name}`; }
    if (suf) { add(suf.stat, roll(suf, ilvl, r)); name = `${name} ${suf.name}`; }
  } else if (rar === 'rare') {
    // (Three or four different things.)
    const n = r.int(3, 4);
    let pool = [...fits(PREFIXES), ...fits(SUFFIXES)];
    for (let i = 0; i < n && pool.length; i++) {
      const a = pool[Math.floor(r() * pool.length)];
      add(a.stat, roll(a, ilvl, r));
      pool = pool.filter(b => b.stat !== a.stat);
    }
    name = `${r.pick(RARE_A)} ${r.pick(RARE_B[kind] || ['Thing'])}`;
  }
  return { key, g: { r: rar, name, stats, ilvl } };
}

/** What player s's worn gear gives, all added up (with set bonuses): { armor, hp, gun, ... }. */
export function gearStats(s) {
  const worn = s?.world?.gear, out = {};
  if (!worn) return out;
  const add = st => { for (const [k, v] of Object.entries(st || {})) out[k] = (out[k] || 0) + v; };
  const sets = {};
  for (const slot of SLOTS) {
    const it = worn[slot];
    if (!it) continue;
    add({ armor: BASES[it.key]?.armor || 0 });
    add(it.g?.stats);
    if (it.g?.set) sets[it.g.set] = (sets[it.g.set] || 0) + 1;
  }
  for (const [id, n] of Object.entries(sets)) for (const [k, b] of Object.entries(SETS[id]?.bonus || {})) if (n >= +k) add(b);
  return out;
}

/** How much less damage armour lets through (0 to 1): diminishing as it goes up. */
export const armorCut = armor => (armor > 0 ? armor / (armor + 60) : 0);

/** What a piece of gear is worth (coins): its base's, by rarity and level. */
export function gearValue(key, g) {
  const base = BASES[key];
  if (!base) return 0;
  const k = { normal: 1, magic: 2.2, rare: 4, set: 6, unique: 9 }[g?.r || 'normal'] || 1;
  return Math.round((6 + base.armor * 2 + base.level * 2) * k * (1 + (g?.ilvl || 1) / 30));
}

/** What a piece of gear's card says: its lines (its stats, its set's bonuses). */
export function gearLines(key, g) {
  const base = BASES[key], out = [];
  if (!base) return out;
  out.push(`${RARITY[g?.r || 'normal'].name} · ${base.name}${base.armor ? ` · ${base.armor} armour` : ''} · item level ${g?.ilvl || 1}`);
  for (const [k, v] of Object.entries(g?.stats || {})) if (STATS[k] && v) out.push(STATS[k].show(v));
  if (g?.set) {
    const set = SETS[g.set];
    out.push(`${set.name}: ${Object.values(set.pieces).join(', ')}`);
    for (const [n, b] of Object.entries(set.bonus)) out.push(`(${n} worn) ${Object.entries(b).map(([k, v]) => STATS[k].show(v)).join(', ')}`);
  }
  return out;
}

/** The seed for a drop (the same drop for the same monster, tick and place). */
export const dropSeed = (a, b, c) => hash3(a | 0, b | 0, c | 0);

/** What item level something dropped at depth `depth` (blocks down) by a monster of `type` has. */
export function dropLevel(depth, type, playerLevel = 1) {
  const fromDepth = Math.max(1, Math.round(depth / 12)), fromType = { zombie: 0, skeleton: 2, brute: 6 }[type] || 0;
  return Math.max(1, Math.min(30, Math.round((fromDepth + fromType + playerLevel) / 2)));
}
