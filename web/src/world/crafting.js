// Crafting (world mode): what can be made from what, and where. Some things are made by hand;
// the rest at a crafting station standing near you: a workbench (wood), a furnace (smelting ore
// into bars, sand into glass, clay into bricks), an anvil (metal tools) and a gunsmith's bench
// (guns, ammunition, explosives). Each recipe makes n of something from what's listed.

import { BLOCKS, TILE } from './blocks.js';
import { ITEMS, itemOf } from './items.js';
import { BASES, namedGear } from './gear.js';

/** The crafting stations, in the order they're usually built. (A campfire: cooking, anywhere.) */
export const STATIONS = ['workbench', 'furnace', 'anvil', 'gunsmith', 'campfire'];
export const STATION_NAMES = { workbench: 'Workbench', furnace: 'Furnace', anvil: 'Anvil', gunsmith: "Gunsmith's bench", campfire: 'Campfire' };
/** How near a station has to be to craft at it (tiles from the soldier's middle, across and up or down). */
export const STATION_REACH = { x: 5, y: 4 };

const R = [];
/** key ×n, from `of` ([[key, n], ...]), at a station (null: by hand). */
const recipe = (key, n, of, at = null) => R.push({ key, n, of, at, id: R.length });

// ---- By hand ----
recipe('planks', 4, [['wood', 1]]);
recipe('torch', 3, [['wood', 1], ['coal', 1]]);
recipe('workbench', 1, [['wood', 10]]);
recipe('platform', 2, [['planks', 1]]);
recipe('ladder', 2, [['planks', 3]]);
// (Survival: a campfire to cook at, bone meal for crops, carpets from wool.)
recipe('campfire', 1, [['wood', 3], ['coal', 1]]);
recipe('bone_meal', 3, [['bone', 1]]);
recipe('carpet', 3, [['wool', 2]]);

// ---- Workbench ----
recipe('plank_wall', 4, [['planks', 1]], 'workbench');
recipe('door', 1, [['planks', 6]], 'workbench');
recipe('chest', 1, [['planks', 8]], 'workbench');
// (Storage: an ender chest, everywhere the same, and shulker boxes, to carry chests' worth: worldplay.js.)
recipe('ender_chest', 1, [['obsidian', 8], ['amethyst', 1]], 'anvil');
recipe('shulker_box', 1, [['chest', 1], ['gold_bar', 2], ['amethyst', 1]], 'anvil');
recipe('red_shulker_box', 1, [['chest', 1], ['gold_bar', 2], ['ruby', 1]], 'anvil');
recipe('blue_shulker_box', 1, [['chest', 1], ['gold_bar', 2], ['sapphire', 1]], 'anvil');
recipe('green_shulker_box', 1, [['chest', 1], ['gold_bar', 2], ['emerald', 1]], 'anvil');
recipe('yellow_shulker_box', 1, [['chest', 1], ['gold_bar', 2], ['topaz', 1]], 'anvil');
recipe('waystone', 1, [['stone_bricks', 12], ['emerald', 1], ['gold_bar', 2]], 'anvil');
recipe('bed', 1, [['planks', 15]], 'workbench');
recipe('claim_flag', 1, [['planks', 10], ['stone', 20]], 'workbench');
recipe('furnace', 1, [['stone', 20], ['wood', 4], ['torch', 3]], 'workbench');
recipe('anvil', 1, [['iron_bar', 5]], 'workbench');
recipe('arrows', 10, [['wood', 1], ['stone', 1]], 'workbench');
recipe('Longbow', 1, [['wood', 12]], 'workbench');
recipe('BaseballBat', 1, [['wood', 8]], 'workbench');
recipe('snow_bricks', 1, [['snow', 2]], 'workbench');
recipe('sandstone_bricks', 1, [['sandstone', 2]], 'workbench');
recipe('stone_brick_wall', 4, [['stone_bricks', 1]], 'workbench');
recipe('brick_wall', 4, [['bricks', 1]], 'workbench');
recipe('cobblestone', 2, [['stone', 2]], 'workbench');
recipe('timber', 2, [['wood', 1]], 'workbench');
recipe('thatch', 4, [['wheat', 2]], 'workbench');
recipe('post', 2, [['wood', 1]], 'workbench');
recipe('fence', 4, [['planks', 2]], 'workbench');
recipe('table', 1, [['planks', 6]], 'workbench');
recipe('chair', 1, [['planks', 4]], 'workbench');
recipe('bookshelf', 1, [['planks', 8], ['wood', 2]], 'workbench');
recipe('barrel', 1, [['planks', 6], ['iron_bar', 1]], 'workbench');
recipe('sign', 1, [['planks', 3]], 'workbench');
recipe('banner', 1, [['wheat', 4], ['planks', 1]], 'workbench');
recipe('awning', 4, [['wheat', 3], ['planks', 1]], 'workbench');
recipe('plaster_wall', 4, [['plaster', 1]], 'workbench');
recipe('timber_wall', 4, [['plaster', 1], ['timber', 1]], 'workbench');
recipe('log_wall', 4, [['wood', 1]], 'workbench');
recipe('cobble_wall', 4, [['cobblestone', 1]], 'workbench');
recipe('mud_brick_wall', 4, [['mud_bricks', 1]], 'workbench');
recipe('glass_wall', 4, [['glass', 1]], 'workbench');
recipe('sandstone_brick_wall', 4, [['sandstone_bricks', 1]], 'workbench');
// (Farming, animals' leather and wool, and arrows fletched with feathers.)
recipe('hoe', 1, [['wood', 2], ['stone', 2]], 'workbench');
recipe('bed', 1, [['planks', 3], ['wool', 3]], 'workbench');
recipe('arrows', 16, [['wood', 1], ['flint', 1], ['feather', 1]], 'workbench');
recipe('leather_cap', 1, [['leather', 5]], 'workbench');
recipe('leather_armor', 1, [['leather', 8]], 'workbench');
recipe('leather_gloves', 1, [['leather', 3]], 'workbench');
recipe('leather_belt', 1, [['leather', 3]], 'workbench');
recipe('leather_boots', 1, [['leather', 4]], 'workbench');
recipe('wool_mittens', 1, [['wool', 3]], 'workbench');
recipe('berry_pie', 1, [['berries', 4], ['wheat', 2], ['egg', 1]], 'workbench');

// ---- Furnace ----
recipe('copper_bar', 1, [['copper_ore', 3]], 'furnace');
recipe('iron_bar', 1, [['iron_ore', 3]], 'furnace');
recipe('gold_bar', 1, [['gold_ore', 3]], 'furnace');
recipe('silver_bar', 1, [['silver_ore', 3]], 'furnace');
recipe('glass', 1, [['sand', 2]], 'furnace');
recipe('bricks', 1, [['clay', 2]], 'furnace');
recipe('stone_bricks', 1, [['stone', 2]], 'furnace');
recipe('roof_tiles', 4, [['clay', 2]], 'furnace');
recipe('plaster', 2, [['sand', 1], ['stone', 1]], 'furnace');
recipe('mud_bricks', 1, [['mud', 2]], 'furnace');
recipe('bread', 1, [['wheat', 3]], 'furnace');
recipe('stew', 1, [['mushroom', 2], ['wheat', 1]], 'furnace');
recipe('stained_glass', 4, [['glass', 4], ['crystal_ore', 1]], 'furnace');

// ---- Cooking: at a campfire, or in a furnace ----
for (const [raw, cooked] of [['raw_beef', 'steak'], ['raw_pork', 'cooked_pork'], ['raw_mutton', 'cooked_mutton'], ['raw_chicken', 'cooked_chicken'],
  ['raw_venison', 'cooked_venison'], ['raw_rabbit', 'cooked_rabbit'], ['raw_fish', 'cooked_fish'], ['crab_meat', 'cooked_crab'], ['potato', 'baked_potato']]) {
  recipe(cooked, 1, [[raw, 1]], 'campfire');
  recipe(cooked, 1, [[raw, 1]], 'furnace');
}
recipe('bread', 1, [['wheat', 3]], 'campfire');
recipe('rabbit_stew', 1, [['cooked_rabbit', 1], ['carrot', 1], ['potato', 1], ['mushroom', 1]], 'campfire');

// ---- Anvil ----
recipe('pickaxe', 1, [['copper_bar', 9], ['wood', 3]], 'anvil');
recipe('axe', 1, [['copper_bar', 8], ['wood', 3]], 'anvil');
recipe('hammer', 1, [['copper_bar', 8], ['wood', 3]], 'anvil');
recipe('iron_pickaxe', 1, [['iron_bar', 10], ['wood', 3]], 'anvil');
recipe('gold_pickaxe', 1, [['gold_bar', 10], ['wood', 3]], 'anvil');
recipe('crystal_pickaxe', 1, [['crystal_ore', 12], ['gold_bar', 6]], 'anvil');
recipe('diamond_pickaxe', 1, [['diamond', 4], ['gold_bar', 4], ['silver_bar', 2], ['wood', 3]], 'anvil');
// (A bucket: for water, worldplay.js.)
recipe('bucket', 1, [['iron_bar', 3]], 'anvil');
recipe('metal', 2, [['iron_bar', 1]], 'anvil');
recipe('blast_bricks', 4, [['stone_bricks', 4], ['iron_bar', 1], ['coal', 2]], 'anvil');
recipe('gunsmith', 1, [['iron_bar', 10], ['gold_bar', 4], ['planks', 10]], 'anvil');
recipe('Knife', 1, [['iron_bar', 4]], 'anvil');
recipe('Sledgehammer', 1, [['iron_bar', 12], ['wood', 4]], 'anvil');
recipe('BattleAxe', 1, [['iron_bar', 10], ['gold_bar', 2], ['wood', 3]], 'anvil');
recipe('NinjaRope', 1, [['iron_bar', 6], ['planks', 4]], 'anvil');
recipe('lantern', 2, [['iron_bar', 1], ['glass', 1], ['torch', 1]], 'anvil');
recipe('shears', 1, [['iron_bar', 2]], 'anvil');
recipe('golden_apple', 1, [['apple', 1], ['gold_bar', 4]], 'anvil');

// ---- Gunsmith's bench ----
recipe('bullets', 30, [['copper_bar', 1], ['coal', 1]], 'gunsmith');
recipe('shells', 12, [['iron_bar', 1], ['coal', 2]], 'gunsmith');
recipe('rockets', 3, [['iron_bar', 2], ['coal', 3]], 'gunsmith');
recipe('fuel', 100, [['coal', 4]], 'gunsmith');
recipe('Platinum', 1, [['iron_bar', 6]], 'gunsmith');
recipe('Beretta', 1, [['iron_bar', 8], ['copper_bar', 2]], 'gunsmith');
recipe('Magnum', 1, [['iron_bar', 8], ['gold_bar', 3]], 'gunsmith');
recipe('Uzi', 1, [['iron_bar', 10], ['copper_bar', 4]], 'gunsmith');
recipe('MP5K', 1, [['iron_bar', 12], ['gold_bar', 3]], 'gunsmith');
recipe('Shotgun', 1, [['iron_bar', 12], ['wood', 6]], 'gunsmith');
recipe('M4', 1, [['iron_bar', 15], ['gold_bar', 5]], 'gunsmith');
recipe('AK47', 1, [['iron_bar', 15], ['gold_bar', 3], ['wood', 4]], 'gunsmith');
recipe('SR', 1, [['iron_bar', 15], ['gold_bar', 8], ['crystal_ore', 2]], 'gunsmith');
recipe('Flamer', 1, [['iron_bar', 15], ['copper_bar', 5]], 'gunsmith');
recipe('Bazooka', 1, [['iron_bar', 20], ['gold_bar', 6]], 'gunsmith');
recipe('Mortar', 1, [['iron_bar', 18], ['gold_bar', 4]], 'gunsmith');
recipe('Minigun', 1, [['iron_bar', 30], ['gold_bar', 10], ['ember_ore', 5]], 'gunsmith');
recipe('MagicBullet', 1, [['iron_bar', 6], ['gold_bar', 6], ['crystal_ore', 6]], 'gunsmith');
recipe('HomingMissile', 2, [['iron_bar', 4], ['gold_bar', 2], ['crystal_ore', 1]], 'gunsmith');
recipe('GrenadeLauncher', 5, [['iron_bar', 3], ['coal', 3]], 'gunsmith');
recipe('HEGrenade', 3, [['iron_bar', 2], ['coal', 2]], 'gunsmith');
recipe('ClusterBomb', 2, [['iron_bar', 3], ['coal', 4]], 'gunsmith');
recipe('Flashbang', 3, [['iron_bar', 1], ['coal', 1], ['glass', 1]], 'gunsmith');
recipe('SmokeGrenade', 3, [['iron_bar', 1], ['coal', 2]], 'gunsmith');
recipe('PetrolBomb', 3, [['glass', 3], ['coal', 3]], 'gunsmith');
recipe('Dynamite', 3, [['coal', 4], ['sand', 2]], 'gunsmith');
recipe('Mine', 2, [['iron_bar', 2], ['coal', 2]], 'gunsmith');
recipe('Teleport', 1, [['crystal_ore', 5], ['gold_bar', 2]], 'gunsmith');
recipe('merc_contract', 1, [['coins', 60], ['gold_bar', 1]], 'gunsmith');
// Attachments (attachments.js): sights and scopes (glass and metal; the best, gems), muzzles,
// under the barrel, magazines and rounds.
recipe('red_dot', 1, [['iron_bar', 2], ['glass', 2], ['ruby', 1]], 'gunsmith');
recipe('scope2', 1, [['iron_bar', 3], ['glass', 3]], 'gunsmith');
recipe('scope4', 1, [['iron_bar', 4], ['glass', 4], ['gold_bar', 1]], 'gunsmith');
recipe('scope8', 1, [['silver_bar', 3], ['glass', 6], ['gold_bar', 2]], 'gunsmith');
recipe('scope16', 1, [['gold_bar', 4], ['crystal_ore', 4], ['sapphire', 1]], 'gunsmith');
recipe('hawkeye', 1, [['gold_bar', 6], ['crystal_ore', 8], ['sapphire', 2], ['diamond', 2]], 'gunsmith');
recipe('suppressor', 1, [['iron_bar', 5], ['coal', 3]], 'gunsmith');
recipe('compensator', 1, [['iron_bar', 4], ['copper_bar', 2]], 'gunsmith');
recipe('long_barrel', 1, [['iron_bar', 6], ['silver_bar', 1]], 'gunsmith');
recipe('foregrip', 1, [['planks', 3], ['iron_bar', 1]], 'gunsmith');
recipe('laser', 1, [['copper_bar', 2], ['glass', 1], ['ruby', 1]], 'gunsmith');
recipe('ext_mag', 1, [['iron_bar', 3]], 'gunsmith');
recipe('drum_mag', 1, [['iron_bar', 6], ['copper_bar', 3]], 'gunsmith');
recipe('quick_mag', 1, [['iron_bar', 2], ['copper_bar', 2]], 'gunsmith');
recipe('hollow_points', 4, [['copper_bar', 2], ['coal', 1]], 'gunsmith');

// ---- Defending a base, and raiding one (bases.js) ----
recipe('reinforced_bricks', 4, [['stone_bricks', 4], ['iron_bar', 2]], 'anvil');
recipe('iron_door', 1, [['iron_bar', 8]], 'anvil');
recipe('spikes', 4, [['iron_bar', 2], ['planks', 2]], 'anvil');
recipe('alarm_bell', 1, [['gold_bar', 2], ['iron_bar', 2], ['planks', 4]], 'anvil');
recipe('arrow_turret', 1, [['planks', 12], ['iron_bar', 4], ['Longbow', 1]], 'anvil');
recipe('charter', 1, [['gold_bar', 4], ['iron_bar', 8], ['emerald', 1]], 'anvil');
recipe('battering_ram', 1, [['wood', 12], ['iron_bar', 10]], 'anvil');
recipe('gun_turret', 1, [['iron_bar', 14], ['gold_bar', 3], ['copper_bar', 6]], 'gunsmith');
recipe('pressure_mine', 2, [['iron_bar', 2], ['coal', 3]], 'gunsmith');
recipe('breach_charge', 2, [['iron_bar', 3], ['coal', 6], ['sand', 2]], 'gunsmith');
recipe('demo_charge', 1, [['iron_bar', 6], ['gold_bar', 2], ['coal', 12]], 'gunsmith');

// ---- Boats (boats.js), at a workbench: a raft of logs lashed with leather or wool, a rowing
// boat of planks, and a sailboat, a rowing boat with a mast and a sail of wool. ----
recipe('raft', 1, [['wood', 5], ['leather', 2]], 'workbench');
recipe('raft', 1, [['wood', 5], ['wool', 2]], 'workbench');
recipe('rowboat', 1, [['planks', 20]], 'workbench');
recipe('sailboat', 1, [['rowboat', 1], ['wood', 2], ['wool', 6]], 'workbench');

export const RECIPES = R;

/**
 * Dev mode's own (devmode.js): everything else there is, each made from nothing (a stack of it;
 * tools, weapons and gear, one). With every recipe free in dev mode, that's anything at all.
 */
export const DEV_ID0 = 10000;
export const DEV_RECIPES = [];
for (const [key, it] of ITEMS) {
  if (R.some(r => r.key === key)) continue;
  DEV_RECIPES.push({ key, n: Math.min(it.stack, 99), of: [], at: null, id: DEV_ID0 + DEV_RECIPES.length, dev: true });
}
/** A recipe by its number (dev mode's too), or null. */
export const recipeById = id => (Number.isInteger(id) ? (id >= DEV_ID0 ? DEV_RECIPES[id - DEV_ID0] : R[id]) : null) || null;

/** A plain piece of gear `key` (made, not found: basic, nothing more than its base), or null if it isn't gear. */
export function plainGear(key) {
  const it = itemOf(key);
  return it?.kind === 'gear' ? { r: 'basic', name: it.name, stats: {}, ilvl: BASES[key]?.level || 1 } : null;
}

/**
 * Dev mode: the codex's entry `id` (codex.js: an item's key, or a unique's or set piece's id,
 * gear.js's foundId) into inv: a stack of it, or one (gear, weapons, tools; a unique or set
 * piece as it drops). Returns { key, n, g, left } (left: what didn't fit), or null.
 */
export function devGive(inv, id) {
  if (typeof id !== 'string') return null;
  const named = /^[us]:/.test(id) ? namedGear().find(x => x.id === id) : null;
  const key = named ? named.key : id, it = itemOf(key);
  if (!it || (/^[us]:/.test(id) && !named)) return null;
  const g = named ? { ...named.g, stats: { ...named.g.stats } } : plainGear(key);
  if (g) return { key, n: 1, g, left: inv.addGear(key, g) ? 0 : 1 };
  const n = Math.min(it.stack, 99);
  return { key, n, g: null, left: inv.add(key, n) };
}

/** The crafting stations near (x, y) (a soldier's middle, in pixels): a Set of their names. */
export function stationsNear(world, x, y, out = new Set()) {
  out.clear();
  const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
  for (let ty = cy - STATION_REACH.y; ty <= cy + STATION_REACH.y; ty++) {
    for (let tx = cx - STATION_REACH.x; tx <= cx + STATION_REACH.x; tx++) {
      const st = BLOCKS[world.tile(tx, ty)].station;
      if (st) out.add(st);
    }
  }
  return out;
}

/** How many times recipe r can be made from inventory inv, with the stations `near` (0: it can't). free: dev mode's, from nothing, anywhere. */
export function timesCanMake(inv, r, near, free = false) {
  if (free) return 99;
  if (r.at && !near.has(r.at)) return 0;
  let times = Infinity;
  for (const [key, n] of r.of) times = Math.min(times, Math.floor(inv.count(key) / n));
  return times === Infinity ? 0 : times;
}

/**
 * Make recipe r up to `times` times from inv (with the stations `near`). Returns how many were
 * made, and how many of what was made didn't fit in the inventory (left: for the ground).
 */
export function craft(inv, r, near, times = 1, free = false) {
  let made = 0, left = 0;
  const most = Math.min(times, timesCanMake(inv, r, near, free));
  for (let t = 0; t < most; t++) {
    if (!free) for (const [key, n] of r.of) inv.remove(key, n);
    // (Gear, made: a plain piece. Dev mode's, as it has no recipe.)
    const g = plainGear(r.key);
    left += g ? (inv.addGear(r.key, g) ? 0 : 1) : inv.add(r.key, r.n);
    made++;
  }
  return { made, left };
}

/** What recipe r is made from, as text ("3 Copper ore, 1 Coal"). */
export const madeFrom = r => r.of.map(([key, n]) => `${n} ${itemOf(key)?.name ?? key}`).join(', ');
