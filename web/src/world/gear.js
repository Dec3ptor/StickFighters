// Gear and loot (world mode). What's worn: eight places (head, amulet, body, hands, waist, two rings
// and feet), each in many bases, from a leather cap to an ember helm (57 in all). And weapons:
// every gun, bow, blade and explosive can drop with affixes of its own too.
//
// What drops comes in seven rarities, its name in its colour:
//
//   basic     (white)   just the base
//   magic     (blue)    one or two affixes, named for them: "Hale Iron helm of Mending"
//   rare      (yellow)  three or four, and a name of its own: "Grim Shroud"
//   epic      (purple)  four or five, bigger rolls
//   legendary (orange)  five or six, the biggest, and a power (a critical hit, life leech, thorns...)
//   set       (green)   a piece of a set: the more of it worn, the more it gives
//   unique    (gold)    one of a kind, always the same: "The Gravedigger's Hood", "The Widowmaker"
//
// Each piece has an item level (by where it dropped, and what dropped it): deeper, better bases and
// bigger numbers. Magic find makes the better rarities more likely. What gear gives (gearStats):
// armour (less damage taken), health, gun and melee damage, critical hits, life leech, thorns,
// faster digging, more coins, magic find, healing over time, experience, fire resistance; a
// weapon's own affixes (weaponWith) change it: damage, rate of fire, reloading, its magazine, its
// accuracy. An item's gear is kept in its slot (items.js: slot.g), as saved and sent.

import { hash3 } from './noise.js';
import { WEAPONS } from '../weapons.js';

/** Where things are worn, in the order the inventory shows them. */
export const SLOTS = ['head', 'amulet', 'body', 'hands', 'waist', 'ring1', 'ring2', 'feet'];
export const SLOT_NAMES = { head: 'Head', amulet: 'Amulet', body: 'Body', hands: 'Hands', waist: 'Waist', ring1: 'Ring', ring2: 'Ring', feet: 'Feet' };
const KIND_OF = { ring1: 'ring', ring2: 'ring' };
/** The kind of thing slot `slot` takes. */
export const slotKind = slot => KIND_OF[slot] || slot;

/**
 * The bases: [key, name, kind, armour, the item level it starts dropping at, colour, what it
 * always gives (implicit)].
 */
const BASE_LIST = [
  // Head
  ['leather_cap', 'Leather cap', 'head', 3, 1, '#8a5a32'], ['hood', 'Hood', 'head', 2, 1, '#5a6a4a', { regen: 1 }],
  ['coif', 'Chain coif', 'head', 5, 4, '#9aa4ae'], ['iron_helm', 'Iron helm', 'head', 7, 6, '#9aa4ae'],
  ['war_hat', 'War hat', 'head', 8, 8, '#7a7f86'], ['circlet', 'Circlet', 'head', 2, 10, '#f2c230', { mf: 10 }],
  ['bone_helm', 'Bone helm', 'head', 9, 12, '#e8e2d0', { leech: 1 }], ['steel_helm', 'Steel helm', 'head', 11, 14, '#c9d2dc'],
  ['great_helm', 'Great helm', 'head', 12, 16, '#c9d2dc'],
  ['crown', 'Crown', 'head', 6, 20, '#f2c230', { mf: 15, hp: 10 }], ['ember_helm', 'Ember helm', 'head', 15, 26, '#ff7a2a', { fire: 25 }],
  // Body
  ['tunic', 'Tunic', 'body', 3, 1, '#8a6a4a'], ['leather_armor', 'Leather armour', 'body', 6, 1, '#8a5a32'],
  ['studded_leather', 'Studded leather', 'body', 9, 4, '#7a5634'], ['robe', 'Robe', 'body', 4, 6, '#6a5a8a', { regen: 2, xp: 5 }],
  ['chainmail', 'Chainmail', 'body', 12, 6, '#9aa4ae'], ['scale_mail', 'Scale mail', 'body', 14, 9, '#8a9a7a'],
  ['breastplate', 'Breastplate', 'body', 17, 12, '#b9c2cb'], ['plate', 'Plate armour', 'body', 20, 14, '#c9d2dc'],
  ['dragonhide', 'Dragonhide', 'body', 22, 20, '#4a8a5a', { fire: 20 }], ['ember_plate', 'Ember plate', 'body', 27, 26, '#ff7a2a', { fire: 30 }],
  // Hands
  ['leather_gloves', 'Leather gloves', 'hands', 2, 1, '#8a5a32'], ['wool_mittens', 'Wool mittens', 'hands', 1, 1, '#c8b8a0', { fire: 10 }],
  ['studded_gloves', 'Studded gloves', 'hands', 4, 5, '#7a5634'], ['chain_gloves', 'Chain gloves', 'hands', 5, 8, '#9aa4ae'],
  ['gauntlets', 'Gauntlets', 'hands', 7, 12, '#b9c2cb', { melee: 5 }], ['heavy_gauntlets', 'Heavy gauntlets', 'hands', 9, 18, '#c9d2dc', { melee: 8 }],
  ['ember_gauntlets', 'Ember gauntlets', 'hands', 11, 26, '#ff7a2a', { fire: 15 }],
  // Waist
  ['sash', 'Sash', 'waist', 1, 1, '#a0522d'], ['leather_belt', 'Leather belt', 'waist', 2, 2, '#6b4423'],
  ['studded_belt', 'Studded belt', 'waist', 3, 6, '#7a5634'], ['chain_belt', 'Chain belt', 'waist', 4, 10, '#9aa4ae'],
  ['plated_belt', 'Plated belt', 'waist', 6, 16, '#c9d2dc', { hp: 10 }], ['ember_girdle', 'Ember girdle', 'waist', 8, 26, '#ff7a2a', { fire: 15, hp: 15 }],
  // Feet
  ['sandals', 'Sandals', 'feet', 1, 1, '#c8a070'], ['leather_boots', 'Leather boots', 'feet', 2, 1, '#6b4423'],
  ['heavy_boots', 'Heavy boots', 'feet', 4, 5, '#5a4636'], ['iron_boots', 'Iron boots', 'feet', 5, 8, '#9aa4ae'],
  ['greaves', 'Greaves', 'feet', 7, 12, '#b9c2cb'], ['war_boots', 'War boots', 'feet', 9, 18, '#c9d2dc'],
  ['ember_boots', 'Ember boots', 'feet', 11, 26, '#ff7a2a', { fire: 20 }],
  // Rings
  ['copper_ring', 'Copper ring', 'ring', 0, 1, '#d07a3a'], ['bone_ring', 'Bone ring', 'ring', 0, 3, '#e8e2d0', { leech: 1 }],
  ['silver_ring', 'Silver ring', 'ring', 0, 6, '#dfe4ec'], ['jade_ring', 'Jade ring', 'ring', 0, 9, '#3aa86a', { regen: 1 }],
  ['gold_band', 'Gold band', 'ring', 0, 12, '#f2c230', { coin: 10 }], ['ruby_ring', 'Ruby ring', 'ring', 0, 16, '#e0213c', { hp: 15 }],
  ['sapphire_ring', 'Sapphire ring', 'ring', 0, 20, '#2f62ee', { mf: 15 }], ['diamond_ring', 'Diamond ring', 'ring', 0, 26, '#c4f6ff', { crit: 4 }],
  // Amulets
  ['wooden_charm', 'Wooden charm', 'amulet', 0, 1, '#8a6238'], ['bone_charm', 'Bone charm', 'amulet', 0, 3, '#e8e2d0'],
  ['amulet', 'Amulet', 'amulet', 0, 5, '#f2c230'], ['jade_amulet', 'Jade amulet', 'amulet', 0, 9, '#3aa86a', { regen: 1 }],
  ['gold_amulet', 'Gold amulet', 'amulet', 0, 13, '#f2c230', { coin: 10 }], ['ruby_pendant', 'Ruby pendant', 'amulet', 0, 18, '#e0213c', { hp: 20 }],
  ['star_amulet', 'Star amulet', 'amulet', 0, 24, '#c4f6ff', { xp: 10 }], ['ember_heart', 'Ember heart', 'amulet', 0, 28, '#ff7a2a', { fire: 25, gun: 8 }],
  // Wings: worn in place of a coat, they let you glide (worldplay.js). Never dropped at random:
  // only found in the treasure at the top of a monster tower (worlds made since towers).
  ['wings', 'Wings', 'body', 0, 99, '#e8e2ff', { glide: 1 }],
];
/** The bases by key: { name, kind, armor, level, color, imp }. */
export const BASES = Object.fromEntries(BASE_LIST.map(([key, name, kind, armor, level, color, imp]) => [key, { name, kind, armor, level, color, imp: imp || null }]));

/** What gear can give: how it's said. */
export const STATS = {
  armor: { show: v => `+${v} armour` },
  hp: { show: v => `+${v} health` },
  gun: { show: v => `+${v}% gun damage` },
  melee: { show: v => `+${v}% melee damage` },
  crit: { show: v => `${v}% chance of a critical hit (double damage)` },
  leech: { show: v => `${v}% of damage done heals you` },
  thorns: { show: v => `Hits back ${v} damage at whoever hits you up close` },
  dig: { show: v => `+${v}% digging speed` },
  coin: { show: v => `+${v}% coins from monsters` },
  mf: { show: v => `+${v}% magic find (better drops)` },
  regen: { show: v => `Heals ${v} health every two seconds` },
  xp: { show: v => `+${v}% experience` },
  fire: { show: v => `${v}% less harm from fire and magma` },
  glide: { show: v => (v > 1 ? 'Glide (hold jump in the air), and beat them for a lift (jump again)' : 'Glide: hold jump in the air') },
  // (A weapon's own.)
  wdmg: { show: v => `+${v}% damage` },
  wrof: { show: v => `+${v}% rate of fire` },
  wreload: { show: v => `${v}% faster reloading` },
  wmag: { show: v => `+${v}% magazine size` },
  wacc: { show: v => `${v}% more accurate` },
};

/**
 * The affixes: prefixes and suffixes, each a stat, its range at item level 1 and at 30 (rolled
 * between, by the item's level), and which kinds of thing it can be on ('weapon': guns and blades).
 */
const PREFIXES = [
  { name: 'Sturdy', stat: 'armor', lo: [2, 4], hi: [8, 14], on: ['head', 'body', 'feet', 'hands', 'waist'] },
  { name: 'Hale', stat: 'hp', lo: [8, 15], hi: [30, 50], on: ['head', 'body', 'feet', 'hands', 'waist', 'ring', 'amulet'] },
  { name: 'Deadly', stat: 'gun', lo: [4, 8], hi: [14, 22], on: ['ring', 'amulet', 'head', 'hands'] },
  { name: 'Savage', stat: 'melee', lo: [8, 15], hi: [25, 40], on: ['ring', 'amulet', 'body', 'hands'] },
  { name: 'Keen', stat: 'crit', lo: [2, 3], hi: [6, 10], on: ['ring', 'amulet', 'hands', 'head'] },
  { name: 'Vampiric', stat: 'leech', lo: [1, 2], hi: [3, 6], on: ['ring', 'amulet', 'hands'] },
  { name: 'Spiked', stat: 'thorns', lo: [3, 6], hi: [12, 25], on: ['body', 'hands', 'waist'] },
  { name: "Miner's", stat: 'dig', lo: [8, 15], hi: [25, 40], on: ['head', 'ring', 'amulet', 'body', 'hands'] },
  { name: 'Lucky', stat: 'coin', lo: [10, 20], hi: [30, 50], on: ['ring', 'amulet', 'feet', 'waist'] },
  { name: 'Gilded', stat: 'mf', lo: [6, 12], hi: [20, 35], on: ['ring', 'amulet', 'head', 'waist'] },
  // (Weapons.)
  { name: 'Cruel', stat: 'wdmg', lo: [6, 12], hi: [25, 45], on: ['weapon'] },
  { name: 'Precise', stat: 'wacc', lo: [10, 20], hi: [25, 45], on: ['weapon'] },
  { name: 'Keen', stat: 'crit', lo: [3, 5], hi: [8, 14], on: ['weapon'] },
  { name: 'Vampiric', stat: 'leech', lo: [1, 3], hi: [4, 8], on: ['weapon'] },
];
const SUFFIXES = [
  { name: 'of Mending', stat: 'regen', lo: [1, 1], hi: [2, 4] },
  { name: 'of the Fox', stat: 'xp', lo: [3, 6], hi: [10, 18], on: ['ring', 'amulet', 'head', 'waist'] },
  { name: 'of Embers', stat: 'fire', lo: [10, 20], hi: [35, 60], on: ['body', 'feet', 'ring', 'amulet', 'hands', 'waist'] },
  { name: 'of the Bear', stat: 'hp', lo: [10, 18], hi: [35, 60], on: ['body', 'head', 'amulet', 'waist'] },
  { name: 'of Warding', stat: 'armor', lo: [2, 5], hi: [8, 15], on: ['body', 'feet', 'amulet', 'ring', 'waist'] },
  { name: 'of the Hunt', stat: 'gun', lo: [3, 7], hi: [12, 20], on: ['head', 'feet', 'ring', 'hands'] },
  { name: 'of Plenty', stat: 'mf', lo: [5, 10], hi: [15, 30], on: ['feet', 'body', 'ring', 'waist'] },
  { name: 'of the Brute', stat: 'melee', lo: [5, 10], hi: [15, 30], on: ['hands', 'waist', 'feet'] },
  // (Weapons.)
  { name: 'of Speed', stat: 'wrof', lo: [5, 10], hi: [15, 30], on: ['weapon'] },
  { name: 'of Quickness', stat: 'wreload', lo: [10, 20], hi: [25, 45], on: ['weapon'] },
  { name: 'of Plenty', stat: 'wmag', lo: [15, 30], hi: [40, 80], on: ['weapon'] },
  { name: 'of Slaughter', stat: 'wdmg', lo: [5, 10], hi: [20, 35], on: ['weapon'] },
];
/** Legendary powers: one of these, big, on every legendary. */
const POWERS = [
  { stat: 'crit', lo: [8, 12], hi: [14, 22] }, { stat: 'leech', lo: [3, 5], hi: [6, 10] }, { stat: 'thorns', lo: [10, 20], hi: [30, 60] },
  { stat: 'regen', lo: [2, 3], hi: [4, 6] }, { stat: 'mf', lo: [40, 60], hi: [80, 120] }, { stat: 'xp', lo: [15, 20], hi: [25, 35] },
];
// (Names for rare, epic and legendary things: two halves.)
const RARE_A = ['Grim', 'Doom', 'Storm', 'Bone', 'Blood', 'Raven', 'Dread', 'Iron', 'Ghoul', 'Wraith', 'Viper', 'Soul', 'Hailstone', 'Ember', 'Gloom', 'Rune', 'Shadow', 'Thunder', 'Frost', 'Venom', 'Night', 'Corpse', 'Star', 'Plague', 'Steel'];
const RARE_B = {
  head: ['Visage', 'Crown', 'Brow', 'Hood', 'Cowl', 'Mask'], body: ['Shroud', 'Hide', 'Mantle', 'Carapace', 'Coat', 'Shell'], hands: ['Grip', 'Fist', 'Claw', 'Hold', 'Touch'],
  waist: ['Lash', 'Cord', 'Clasp', 'Coil', 'Girdle'], feet: ['Stride', 'Trample', 'Track', 'Tread', 'Step'], ring: ['Loop', 'Coil', 'Band', 'Spiral', 'Eye', 'Knot'],
  amulet: ['Charm', 'Talisman', 'Heart', 'Ward', 'Torc', 'Sigil'], weapon: ['Bite', 'Song', 'Fang', 'Thunder', 'Reaper', 'Sting', 'Wrath', 'Kiss'],
};
const LEGEND_TITLE = ['of the Old Kings', 'of the Deep', 'of a Thousand Nights', 'of the Last Watch', 'of the Ember Throne', 'of the Fallen', 'of Ruin', 'of the First Miner'];

/** The uniques: one of a kind, always the same. (Gear and weapons.) */
export const UNIQUES = {
  gravedigger: { name: "The Gravedigger's Hood", base: 'hood', stats: { dig: 35, hp: 20, armor: 4 } },
  warden: { name: "The Warden's Plate", base: 'plate', stats: { armor: 30, hp: 45, regen: 2, thorns: 15 } },
  ember_crown: { name: 'The Ember Crown', base: 'crown', stats: { hp: 60, fire: 60, gun: 15, mf: 25 } },
  bonecrusher: { name: 'Bonecrusher', base: 'gold_band', stats: { melee: 30, hp: 15, crit: 5 } },
  miners_luck: { name: "Miner's Luck", base: 'copper_ring', stats: { coin: 30, mf: 20, dig: 10 } },
  eye_deep: { name: 'Eye of the Deep', base: 'star_amulet', stats: { xp: 20, mf: 25, fire: 20 } },
  ravens_mantle: { name: "Raven's Mantle", base: 'studded_leather', stats: { armor: 10, gun: 12, xp: 10 } },
  old_king: { name: "The Old King's Circlet", base: 'circlet', stats: { regen: 3, xp: 25, hp: 25 } },
  stormstep: { name: 'Stormstep', base: 'iron_boots', stats: { armor: 8, hp: 30, gun: 8 } },
  brute_hide: { name: 'Hide of the Brute', base: 'chainmail', stats: { armor: 18, hp: 50, melee: 15 } },
  bloodfist: { name: 'Bloodfist', base: 'gauntlets', stats: { melee: 25, leech: 5, crit: 6 } },
  hangmans_knot: { name: "Hangman's Knot", base: 'chain_belt', stats: { hp: 40, thorns: 20, armor: 6 } },
  sunstone: { name: 'Sunstone', base: 'ruby_ring', stats: { hp: 35, fire: 40, regen: 2 } },
  frostwalkers: { name: 'Frostwalkers', base: 'greaves', stats: { armor: 10, fire: 30, hp: 25 } },
  widows_kiss: { name: "Widow's Kiss", base: 'bone_ring', stats: { leech: 6, crit: 8 } },
  crown_thorns: { name: 'Crown of Thorns', base: 'war_hat', stats: { thorns: 30, hp: 30, armor: 6 } },
  shadowstep: { name: 'Shadowstep', base: 'leather_boots', stats: { crit: 6, gun: 10, mf: 15 } },
  gilded_cage: { name: 'The Gilded Cage', base: 'breastplate', stats: { armor: 20, coin: 40, mf: 30 } },
  lifeline: { name: 'Lifeline', base: 'jade_amulet', stats: { regen: 4, hp: 40 } },
  stonefist: { name: 'Stonefist', base: 'heavy_gauntlets', stats: { melee: 35, armor: 10, dig: 20 } },
  pathfinder: { name: "Pathfinder's Belt", base: 'leather_belt', stats: { xp: 15, dig: 15, hp: 20 } },
  dragons_eye: { name: "Dragon's Eye", base: 'sapphire_ring', stats: { mf: 35, crit: 6, fire: 20 } },
  blood_bond: { name: 'Blood Bond', base: 'ruby_pendant', stats: { leech: 8, hp: 30 } },
  cinderwalk: { name: 'Cinderwalk', base: 'war_boots', stats: { fire: 60, armor: 8, regen: 2 } },
  grinning_skull: { name: 'The Grinning Skull', base: 'bone_helm', stats: { leech: 4, crit: 8, thorns: 10 } },
  silent_monk: { name: 'Robe of the Silent Monk', base: 'robe', stats: { regen: 4, xp: 20, hp: 30 } },
  goldweave: { name: 'Goldweave Gloves', base: 'chain_gloves', stats: { coin: 40, mf: 20 } },
  iron_maiden: { name: 'Iron Maiden', base: 'scale_mail', stats: { thorns: 40, armor: 16 } },
  oathkeeper: { name: 'Oathkeeper', base: 'silver_ring', stats: { hp: 25, armor: 8, regen: 1 } },
  starfall: { name: 'Starfall', base: 'diamond_ring', stats: { crit: 12, gun: 15 } },
  dragonskin: { name: 'Dragonskin Coat', base: 'dragonhide', stats: { fire: 50, armor: 12, hp: 50 } },
  // (Wings: from the monsters' towers.)
  spirewings: { name: 'Spirewings', base: 'wings', stats: { hp: 20, armor: 4 } },
  stormwings: { name: 'Stormwings', base: 'wings', stats: { glide: 1, hp: 35, armor: 8 } },
  // Weapons.
  widowmaker: { name: 'The Widowmaker', weapon: 'SR', stats: { wdmg: 60, crit: 20, wrof: 20 } },
  thunderclap: { name: 'Thunderclap', weapon: 'Shotgun', stats: { wdmg: 40, wrof: 30, wacc: 30 } },
  old_faithful: { name: 'Old Faithful', weapon: 'Platinum', stats: { wdmg: 50, leech: 5, wreload: 40 } },
  hellfire: { name: 'Hellfire', weapon: 'Flamer', stats: { wdmg: 50, fire: 30, wrof: 20 } },
  bonesaw: { name: 'Bonesaw', weapon: 'BattleAxe', stats: { wdmg: 60, leech: 8, crit: 10 } },
  kingmaker: { name: 'Kingmaker', weapon: 'M4', stats: { wdmg: 35, wrof: 25, crit: 8, wacc: 25 } },
  last_word: { name: 'The Last Word', weapon: 'Magnum', stats: { wdmg: 70, crit: 15 } },
  hornets_nest: { name: "Hornet's Nest", weapon: 'Uzi', stats: { wrof: 35, wacc: 30, wdmg: 15 } },
  splitter: { name: 'Splitter', weapon: 'AK47', stats: { wdmg: 40, wacc: 25, leech: 3 } },
  longshot: { name: 'Longshot', weapon: 'Longbow', stats: { wdmg: 55, crit: 18, wrof: 25 } },
  quiet_knife: { name: 'The Quiet Knife', weapon: 'Knife', stats: { wdmg: 80, crit: 25 } },
  embermaul: { name: "The Ember King's Maul", weapon: 'Sledgehammer', stats: { wdmg: 90, hp: 40, fire: 50 } },
  whisper: { name: 'Whisper', weapon: 'Beretta', stats: { wdmg: 35, wacc: 40, crit: 10 } },
  buzzsaw: { name: 'The Buzzsaw', weapon: 'MP5K', stats: { wrof: 40, wdmg: 20, leech: 3 } },
  old_thunder: { name: 'Old Thunder', weapon: 'Minigun', stats: { wdmg: 30, wacc: 35, hp: 30 } },
  skyfall: { name: 'Skyfall', weapon: 'Mortar', stats: { wdmg: 50, wrof: 25 } },
  doorknocker: { name: 'The Doorknocker', weapon: 'Bazooka', stats: { wdmg: 45, wrof: 30, wacc: 40 } },
  kingseeker: { name: 'Kingseeker', weapon: 'HomingMissile', stats: { wdmg: 40, crit: 10 } },
  home_run: { name: 'Home Run', weapon: 'BaseballBat', stats: { wdmg: 70, crit: 20 } },
  dragonfist: { name: 'Dragonfist', weapon: 'FirePunch', stats: { wdmg: 60, fire: 40, leech: 5 } },
};

/** Uniques only certain foes drop (worldplay.js's dropGear): the codex says who. */
export const UNIQUE_FROM = {
  warden: 'The Warden (the story)', ember_crown: 'The Ember King (the story)', embermaul: 'The Ember King (the story)',
  spirewings: 'The treasure at the top of a monster tower', stormwings: 'The lord of a monster tower',
};

/** The sets: their pieces (and their names), what each piece gives, and what wearing 2, 3 or 4 adds. */
export const SETS = {
  watchman: {
    name: "Watchman's Vigil",
    pieces: { iron_helm: "Watchman's Helm", chainmail: "Watchman's Coat", silver_ring: "Watchman's Seal" },
    stats: { iron_helm: { armor: 6, hp: 15 }, chainmail: { armor: 10, hp: 20 }, silver_ring: { gun: 8 } },
    bonus: { 2: { hp: 25 }, 3: { gun: 12, armor: 12, regen: 1 } },
  },
  delver: {
    name: "Deepdelver's Kit",
    pieces: { leather_cap: "Deepdelver's Cap", leather_armor: "Deepdelver's Jerkin", copper_ring: "Deepdelver's Ring", leather_gloves: "Deepdelver's Gloves" },
    stats: { leather_cap: { dig: 15 }, leather_armor: { armor: 6, hp: 10 }, copper_ring: { coin: 15 }, leather_gloves: { dig: 10 } },
    bonus: { 2: { dig: 20 }, 3: { mf: 30, coin: 20 }, 4: { fire: 30, regen: 2 } },
  },
  ironclad: {
    name: 'Ironclad',
    pieces: { great_helm: 'Ironclad Visor', plate: 'Ironclad Plate', heavy_gauntlets: 'Ironclad Fists', war_boots: 'Ironclad Stride' },
    stats: { great_helm: { armor: 8 }, plate: { armor: 14, hp: 20 }, heavy_gauntlets: { melee: 10 }, war_boots: { armor: 6 } },
    bonus: { 2: { armor: 15 }, 3: { hp: 60, thorns: 15 }, 4: { melee: 30, regen: 3 } },
  },
  nightstalker: {
    name: 'Nightstalker',
    pieces: { hood: 'Nightstalker Hood', studded_leather: 'Nightstalker Garb', studded_gloves: 'Nightstalker Grips' },
    stats: { hood: { crit: 4 }, studded_leather: { armor: 8, gun: 6 }, studded_gloves: { crit: 4 } },
    bonus: { 2: { gun: 12 }, 3: { crit: 10, leech: 4 } },
  },
  pilgrim: {
    name: "Pilgrim's Way",
    pieces: { robe: "Pilgrim's Robe", sash: "Pilgrim's Sash", sandals: "Pilgrim's Sandals", wooden_charm: "Pilgrim's Charm" },
    stats: { robe: { regen: 1 }, sash: { hp: 15 }, sandals: { xp: 5 }, wooden_charm: { mf: 10 } },
    bonus: { 2: { xp: 10 }, 3: { regen: 3, hp: 30 }, 4: { mf: 40, xp: 15 } },
  },
  emberforged: {
    name: 'Emberforged',
    pieces: { ember_helm: 'Emberforged Helm', ember_plate: 'Emberforged Plate', ember_gauntlets: 'Emberforged Hands', ember_boots: 'Emberforged Boots' },
    stats: { ember_helm: { fire: 15, hp: 20 }, ember_plate: { fire: 15, armor: 10 }, ember_gauntlets: { gun: 10 }, ember_boots: { fire: 15 } },
    bonus: { 2: { fire: 30 }, 3: { gun: 20, melee: 20 }, 4: { hp: 100, crit: 10 } },
  },
  goldfinger: {
    name: "Merchant Prince's",
    pieces: { gold_band: "Prince's Signet", gold_amulet: "Prince's Chain", plated_belt: "Prince's Girdle" },
    stats: { gold_band: { coin: 20 }, gold_amulet: { mf: 20 }, plated_belt: { coin: 15, hp: 10 } },
    bonus: { 2: { coin: 30 }, 3: { mf: 60, xp: 10 } },
  },
  graveborn: {
    name: 'Graveborn',
    pieces: { bone_helm: 'Graveborn Skull', bone_ring: 'Graveborn Finger', bone_charm: 'Graveborn Fetish' },
    stats: { bone_helm: { leech: 2, armor: 4 }, bone_ring: { leech: 2 }, bone_charm: { hp: 20 } },
    bonus: { 2: { leech: 3 }, 3: { thorns: 25, regen: 2, crit: 6 } },
  },
  gunslinger: {
    name: "Gunslinger's Rig",
    pieces: { war_hat: "Gunslinger's Hat", leather_belt: "Gunslinger's Bandolier", chain_gloves: "Gunslinger's Grips", leather_boots: "Gunslinger's Spurs" },
    stats: { war_hat: { gun: 8 }, leather_belt: { hp: 15 }, chain_gloves: { crit: 4 }, leather_boots: { gun: 6 } },
    bonus: { 2: { gun: 15 }, 3: { crit: 8, hp: 25 }, 4: { gun: 25, leech: 4 } },
  },
  frostborn: {
    name: 'Frostborn',
    pieces: { coif: 'Frostborn Coif', scale_mail: 'Frostborn Scales', iron_boots: 'Frostborn Treads' },
    stats: { coif: { hp: 15 }, scale_mail: { armor: 8, fire: 15 }, iron_boots: { armor: 4, fire: 10 } },
    bonus: { 2: { fire: 30 }, 3: { hp: 60, regen: 2, armor: 10 } },
  },
  kingsguard: {
    name: "The King's Guard",
    pieces: { breastplate: 'Kingsguard Cuirass', greaves: 'Kingsguard Greaves', gauntlets: 'Kingsguard Gauntlets', ruby_pendant: 'Kingsguard Medal' },
    stats: { breastplate: { armor: 10, hp: 20 }, greaves: { armor: 6 }, gauntlets: { melee: 10, armor: 4 }, ruby_pendant: { hp: 25 } },
    bonus: { 2: { hp: 40 }, 3: { armor: 20, thorns: 10 }, 4: { melee: 25, gun: 15, regen: 2 } },
  },
  wanderer: {
    name: "The Wanderer's",
    pieces: { hood: "Wanderer's Hood", tunic: "Wanderer's Tunic", heavy_boots: "Wanderer's Boots", amulet: "Wanderer's Compass" },
    stats: { hood: { xp: 5 }, tunic: { hp: 15 }, heavy_boots: { armor: 3, coin: 10 }, amulet: { mf: 15 } },
    bonus: { 2: { xp: 15 }, 3: { coin: 25, mf: 25 }, 4: { xp: 25, regen: 3, hp: 40 } },
  },
};

/** The rarities: their colours, names, how many affixes, how big the rolls. */
export const RARITY = {
  basic: { name: 'Basic', color: '#e6e6e6', affixes: [0, 0], boost: 1 },
  magic: { name: 'Magic', color: '#7b8cff', affixes: [1, 2], boost: 1 },
  rare: { name: 'Rare', color: '#ffe14a', affixes: [3, 4], boost: 1 },
  epic: { name: 'Epic', color: '#c070ff', affixes: [4, 5], boost: 1.15 },
  legendary: { name: 'Legendary', color: '#ff8c1a', affixes: [5, 6], boost: 1.3 },
  set: { name: 'Set', color: '#3cff3c' },
  unique: { name: 'Unique', color: '#d4a85a' },
};
export const RARITIES = Object.keys(RARITY);
/** (A save from before epic and legendary things: 'normal' was basic.) */
export const rarityOf = r => (r === 'normal' ? 'basic' : RARITY[r] ? r : 'basic');

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

/** An affix's roll at item level `ilvl` (between its low and high ranges), made bigger by `boost`. */
function roll(a, ilvl, r, boost = 1) {
  const f = Math.max(0, Math.min(1, (ilvl - 1) / 29));
  const lo = Math.round(a.lo[0] + (a.hi[0] - a.lo[0]) * f), hi = Math.round(a.lo[1] + (a.hi[1] - a.lo[1]) * f);
  return Math.max(1, Math.round(r.int(lo, Math.max(lo, hi)) * boost));
}

/** The rarity a drop is (r: random numbers; mf: magic find, %). */
function rarityRoll(r, mf) {
  const m = 1 + mf / 100, x = r();
  return x < 0.007 * m ? 'unique' : x < 0.019 * m ? 'legendary' : x < 0.035 * m ? 'set' : x < 0.08 * m ? 'epic' : x < 0.2 * m ? 'rare' : x < 0.5 * m ? 'magic' : 'basic';
}

/** Whether weapon `id` has what affix stat `stat` changes (a magazine for wmag, and so on). */
export function weaponHas(id, stat) {
  const d = WEAPONS[id];
  if (!d) return false;
  const has = k => typeof d[k] === 'number' && d[k] > 0;
  return { wdmg: has('damage') || !!d.blast, wrof: has('rof'), wreload: has('reload'), wmag: has('mag'), wacc: has('spread') }[stat] ?? true;
}

/** Weapons that can drop with affixes (each a gun, a bow, a blade: not explosives or ropes). */
export const DROP_WEAPONS = Object.keys(WEAPONS).filter(id => {
  const d = WEAPONS[id];
  return !d.hidden && ['bullet', 'rail', 'arrow', 'melee', 'flame', 'rocket'].includes(d.kind) && id !== 'Hands';
});

/**
 * A piece of gear (or, weapon: true, a weapon) dropped at item level `ilvl`, by `seed`: { key (an
 * item key: its base, or the weapon's), g: { r (rarity), name, stats, ilvl, set?, unique? } }.
 * mf: magic find (%). rarity: one asked for (a boss's unique, say), and uniqueId which one.
 * kind: a kind of thing asked for ('head', 'ring'... : a shop's, or a quest's reward).
 */
export function rollGear(seed, ilvl = 1, mf = 0, rarity = null, uniqueId = null, weapon = false, kind = null) {
  const r = rngOf(seed);
  if (kind === 'weapon') weapon = true;
  const fitsKind = key => !kind || weapon || BASES[key]?.kind === kind;
  let rar = rarity || rarityRoll(r, mf);
  if (rar === 'set' && weapon) rar = 'legendary';
  if (rar === 'unique') {
    const ids = Object.keys(UNIQUES).filter(id => !!UNIQUES[id].weapon === weapon && !UNIQUE_FROM[id] && fitsKind(UNIQUES[id].base) && (UNIQUES[id].weapon || BASES[UNIQUES[id].base].level <= Math.max(ilvl, 14)));
    const id = uniqueId || r.pick(ids.length ? ids : Object.keys(UNIQUES)), u = UNIQUES[id];
    return { key: u.weapon || u.base, g: { r: 'unique', name: u.name, stats: { ...u.stats }, ilvl, unique: id } };
  }
  if (rar === 'set') {
    const sets = Object.keys(SETS).filter(id => Object.keys(SETS[id].pieces).some(fitsKind));
    const setId = r.pick(sets.length ? sets : Object.keys(SETS)), set = SETS[setId], pieces = Object.keys(set.pieces).filter(fitsKind);
    const base = r.pick(pieces.length ? pieces : Object.keys(set.pieces));
    return { key: base, g: { r: 'set', name: set.pieces[base], stats: { ...set.stats[base] }, ilvl, set: setId } };
  }
  // The base (a weapon, or gear this level can have), and its kind.
  let key, baseName;
  if (weapon) {
    key = r.pick(DROP_WEAPONS);
    kind = 'weapon';
    baseName = WEAPONS[key].name;
  } else {
    const all = Object.keys(BASES).filter(fitsKind), bases = all.filter(k => BASES[k].level <= ilvl);
    key = r.pick(bases.length ? bases : all.length ? [all.reduce((a, b) => (BASES[b].level < BASES[a].level ? b : a))] : ['leather_cap']);
    kind = BASES[key].kind;
    baseName = BASES[key].name;
  }
  // (A weapon's own affixes only where it has the thing: a magazine, a reload, some spread...)
  const def = RARITY[rar], fits = list => list.filter(a => (a.on ? a.on.includes(kind) : kind !== 'weapon') && (kind !== 'weapon' || weaponHas(key, a.stat)));
  const stats = {}, add = (stat, v) => { stats[stat] = (stats[stat] || 0) + v; };
  let name = baseName;
  if (rar === 'magic') {
    const pre = r() < 0.75 ? r.pick(fits(PREFIXES)) : null, suf = !pre || r() < 0.5 ? r.pick(fits(SUFFIXES)) : null;
    if (pre) { add(pre.stat, roll(pre, ilvl, r)); name = `${pre.name} ${name}`; }
    if (suf) { add(suf.stat, roll(suf, ilvl, r)); name = `${name} ${suf.name}`; }
  } else if (rar !== 'basic') {
    // (Rare, epic, legendary: so many different things, each rolled bigger the better it is.)
    const n = r.int(def.affixes[0], def.affixes[1]);
    let pool = [...fits(PREFIXES), ...fits(SUFFIXES)];
    for (let i = 0; i < n && pool.length; i++) {
      const a = pool[Math.floor(r() * pool.length)];
      add(a.stat, roll(a, ilvl, r, def.boost));
      pool = pool.filter(b => b.stat !== a.stat);
    }
    if (rar === 'legendary') { const p = r.pick(POWERS); add(p.stat, roll(p, ilvl, r)); }
    name = `${r.pick(RARE_A)} ${r.pick(RARE_B[kind] || ['Thing'])}${rar === 'legendary' ? ` ${r.pick(LEGEND_TITLE)}` : ''}`;
  }
  return { key, g: { r: rar, name, stats, ilvl } };
}

/** What player s's worn gear gives, all added up (bases, implicits, affixes, set bonuses; and the weapon in hand's own). */
export function gearStats(s) {
  const w = s?.world, worn = w?.gear, out = {};
  if (!worn) return out;
  // (Worked out again only when what's worn, or what's in hand, changes.)
  const hand = w.inv?.slots?.[w.slot], key = `${w.gearV || 0}|${w.slot}|${hand?.g ? hand.g.name : ''}`;
  if (w.statsKey === key && w.stats) return w.stats;
  const add = st => { for (const [k, v] of Object.entries(st || {})) if (STATS[k] && !k.startsWith('w')) out[k] = (out[k] || 0) + v; };
  const sets = {};
  for (const slot of SLOTS) {
    const it = worn[slot];
    if (!it) continue;
    const base = BASES[it.key];
    add({ armor: base?.armor || 0 });
    add(base?.imp);
    add(it.g?.stats);
    if (it.g?.set) sets[it.g.set] = (sets[it.g.set] || 0) + 1;
  }
  for (const [id, n] of Object.entries(sets)) for (const [k, b] of Object.entries(SETS[id]?.bonus || {})) if (n >= +k) add(b);
  // (The weapon in hand: its crits, leech and the like count while it's held.)
  if (hand?.g && WEAPONS[hand.key]) add(hand.g.stats);
  w.stats = out;
  w.statsKey = key;
  return out;
}

/** How much less damage armour lets through (0 to 1): less and less more as it goes up. */
export const armorCut = armor => (armor > 0 ? armor / (armor + 60) : 0);

const made = new Map();
/**
 * Weapon `id` with a dropped one's affixes on it (wdmg, wrof, wreload, wmag, wacc), and its
 * attachments' (attachments.js: those too, and wrange, how far it reaches; wquiet; wlaser): what
 * the game fires (combat.js asks classes.js's weaponFor, which asks the soldier's weaponOverride).
 */
export function weaponWith(id, stats) {
  const def = WEAPONS[id];
  if (!def || !stats) return def;
  const k = `${id}|${stats.wdmg | 0}|${stats.wrof | 0}|${stats.wreload | 0}|${stats.wmag | 0}|${stats.wacc | 0}|${stats.wrange | 0}|${stats.wquiet ? 1 : 0}|${stats.wlaser ? 1 : 0}`;
  let m = made.get(k);
  if (m) return m;
  m = Object.create(def);
  const props = {}, num = key => typeof def[key] === 'number' && Number.isFinite(def[key]);
  if (stats.wdmg && num('damage')) props.damage = { get: () => def.damage * (1 + stats.wdmg / 100) };
  if (stats.wdmg && def.blast) props.blast = { get: () => ({ ...def.blast, damage: def.blast.damage * (1 + stats.wdmg / 100) }) };
  if (stats.wrof && num('rof')) props.rof = { get: () => Math.max(1, def.rof / (1 + stats.wrof / 100)) };
  if (stats.wreload && num('reload')) props.reload = { get: () => Math.max(1, Math.round(def.reload * (1 - Math.min(80, stats.wreload) / 100))) };
  if (stats.wmag && num('mag')) props.mag = { get: () => Math.max(1, Math.round(def.mag * (1 + stats.wmag / 100))) };
  if (stats.wacc && num('spread')) props.spread = { get: () => def.spread * (1 - Math.min(90, stats.wacc) / 100) };
  if (stats.wrange && num('range')) props.range = { value: Math.max(1, stats.wrange) };
  if (stats.wquiet) props.quiet = { value: true };
  if (stats.wlaser) props.laser = { value: true };
  Object.defineProperties(m, props);
  if (made.size > 500) made.clear();
  made.set(k, m);
  return m;
}

/** What a piece of gear (or a dropped weapon) is worth (coins): its base's, by rarity and level. */
export function gearValue(key, g) {
  const base = BASES[key], wdef = WEAPONS[key];
  if (!base && !wdef) return 0;
  const k = { basic: 1, normal: 1, magic: 2.2, rare: 4, epic: 6, legendary: 10, set: 7, unique: 12 }[g?.r || 'basic'] || 1;
  const from = base ? 6 + base.armor * 2 + base.level * 2 : 30;
  return Math.round(from * k * (1 + (g?.ilvl || 1) / 30));
}

/** What a piece of gear's card says: its lines (its base, its stats, its set's bonuses). */
export function gearLines(key, g) {
  const base = BASES[key], wdef = WEAPONS[key], out = [];
  if (!base && !wdef) return out;
  const rar = RARITY[rarityOf(g?.r)];
  out.push(`${rar.name} · ${base ? `${base.name}${base.armor ? ` · ${base.armor} armour` : ''}` : wdef.name} · item level ${g?.ilvl || 1}`);
  for (const [k, v] of Object.entries(base?.imp || {})) out.push(`${STATS[k].show(v)} (always)`);
  for (const [k, v] of Object.entries(g?.stats || {})) if (STATS[k] && v) out.push(STATS[k].show(v));
  if (g?.set && SETS[g.set]) {
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

/** How many different things there are to find (for the codex): bases, weapons, uniques, set pieces. */
export const countItems = () => ({ bases: BASE_LIST.length, weapons: DROP_WEAPONS.length, uniques: Object.keys(UNIQUES).length, setPieces: Object.values(SETS).reduce((n, s) => n + Object.keys(s.pieces).length, 0) });

/**
 * The uniques and set pieces, for the codex (questui.js): [{ id ('u:<unique>' or 's:<set>:<base>'),
 * key (its base or weapon), g (as it drops), where (how it's had) }].
 */
export function namedGear() {
  const out = [];
  for (const [id, u] of Object.entries(UNIQUES)) {
    const key = u.weapon || u.base, lvl = u.weapon ? 1 : BASES[u.base].level;
    out.push({ id: `u:${id}`, key, g: { r: 'unique', name: u.name, stats: { ...u.stats }, ilvl: Math.max(lvl, 10), unique: id }, where: UNIQUE_FROM[id] || `A very rare drop from monsters${lvl > 14 ? ` (item level ${lvl} or more: deep down, or tough ones)` : ''}; named monsters and raids drop the best things more often` });
  }
  for (const [id, set] of Object.entries(SETS)) {
    for (const [key, name] of Object.entries(set.pieces)) out.push({ id: `s:${id}:${key}`, key, g: { r: 'set', name, stats: { ...set.stats[key] }, ilvl: Math.max(BASES[key].level, 4), set: id }, where: `${set.name}: a rare drop from monsters, named ones and raids most often` });
  }
  return out;
}

/** What kind of thing each kind of townsperson gives for a job well done (null: anything). */
const REWARD_KINDS = { smith: ['head', 'body', 'hands', 'waist', 'feet'], gunsmith: ['weapon'], guard: ['weapon', 'body', 'head'], trader: ['ring', 'amulet'], healer: ['amulet', 'ring'], lord: [null], elder: [null] };
/** The gear a quest from someone with `role` gives (r: its rarity; pick: a number 0 to 1): { r, kind, ilvl }. */
export function gearReward(role, r, pick, ilvl) {
  const kinds = REWARD_KINDS[role] || [null];
  return { r, kind: kinds[Math.min(kinds.length - 1, Math.floor(pick * kinds.length))], ilvl: Math.max(1, Math.min(30, ilvl | 0)) };
}
const KIND_WORDS = { head: 'helmet', body: 'armour', hands: 'pair of gloves', waist: 'belt', feet: 'pair of boots', ring: 'ring', amulet: 'amulet', weapon: 'weapon' };
/** How a gear reward is said: 'a rare ring', 'an epic piece of gear'. */
export function gearRewardText(gr) {
  const rar = RARITY[rarityOf(gr?.r)].name.toLowerCase();
  return `${/^[aeiou]/.test(rar) ? 'an' : 'a'} ${rar} ${KIND_WORDS[gr?.kind] || 'piece of gear'}`;
}
/** The piece a gear reward (gr) turns out to be, for quest `id` and its player (named `who`), in the world of `seed`. */
export const rollReward = (gr, seed, id, who) => rollGear(hash3(seed | 0, textHash(id), textHash(who)), gr.ilvl || 1, 0, rarityOf(gr.r), null, false, gr.kind || null);
const textHash = t => { let h = 2166136261; for (const c of String(t)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h | 0; };

/** What found piece (key, g) counts as in the codex: its unique's or set piece's id, else its key. */
export const foundId = (key, g) => (g?.unique ? `u:${g.unique}` : g?.set ? `s:${g.set}:${key}` : key);
