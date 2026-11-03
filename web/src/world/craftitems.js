// Crafting's second half (world mode): the things added for building and decorating, and how
// they're made. items.js adds the items (addCraftItems), crafting.js the recipes (CRAFT_RECIPES);
// the inventory screen sorts recipes by craftCategory.
//
//   From the world: flowers (picked: dyes), reeds (paper), kelp, coral fans and petals (dyes, food),
//     ferns and bushes (to plant in pots), sticks (from dead bushes, or planks).
//   Made: string and rope (wool), cloth (the loom), paper and books, nails and chains (the anvil),
//     tallow and candles, sixteen dyes (flowers and minerals, mixed), and every block's variants
//     dyed (blocks.js), woods by their finish, cut and polished stone (the mason's bench), slabs
//     and stairs, lamps of several kinds, furniture and stations, food cooked on a stove, and
//     blueprints for whole buildings (the drafting table: kits.js).

import { BLOCKS, DYES, WOODS, SHAPES, DEFENCES, shade } from './blocks.js';

/** The new stations (crafting.js's STATIONS, after the first five), and what they're called. */
export const MORE_STATIONS = ['stove', 'loom', 'mason', 'drafting'];
export const MORE_STATION_NAMES = { stove: 'Stove', loom: 'Loom', mason: "Mason's bench", drafting: 'Drafting table' };

/** The blocks that come as slabs and stairs too (their items place them shaped: decor.js's afterPlace), and where they're cut. */
export const SHAPED = [
  ['planks', 'wooden', 'Wooden', 'workbench'], ['cobblestone', 'cobblestone', 'Cobblestone', 'mason'], ['stone', 'stone', 'Stone', 'mason'],
  ['stone_bricks', 'stone_brick', 'Stone brick', 'mason'], ['bricks', 'brick', 'Brick', 'mason'], ['sandstone_bricks', 'sandstone_brick', 'Sandstone brick', 'mason'],
  ['mud_bricks', 'mud_brick', 'Mud brick', 'mason'], ['dark_bricks', 'dark_brick', 'Dark brick', 'mason'], ['snow_bricks', 'snow_brick', 'Snow brick', 'mason'],
  ['polished_stone', 'polished_stone', 'Polished stone', 'mason'], ['roof_tiles', 'roof_tile', 'Roof tile', 'mason'], ['thatch', 'thatch', 'Thatch', 'workbench'],
];
const SHAPE_AT = key => SHAPES.findIndex(s => s.key === key);

/** The blueprints (kits.js has what each builds). */
export const BLUEPRINTS = [
  ['blueprint_cottage', 'Blueprint: cottage', 'cottage'], ['blueprint_stone_house', 'Blueprint: stone house', 'stone_house'],
  ['blueprint_watchtower', 'Blueprint: watchtower', 'watchtower'], ['blueprint_wall', 'Blueprint: wall section', 'wall'],
  ['blueprint_bridge', 'Blueprint: bridge', 'bridge'], ['blueprint_workshop', 'Blueprint: workshop', 'workshop'],
];

/**
 * The items, added to items.js's (item(key, name, kind, extra), and its map, I, to look at the
 * blocks' items it's made already).
 */
export function addCraftItems(item, I) {
  const by = new Map(BLOCKS.map(b => [b.key, b]));
  // Every block's variants (blocks.js), each its own item (but a flower pot's plants and a
  // painting's pictures). The first is the block's own (its item, if it has one, is made already).
  for (const b of BLOCKS) {
    if (!b.variants || b.variantItems === false) continue;
    b.variants.forEach((v, paint) => {
      if (!paint || I.has(v.key)) return;
      item(v.key, v.name, 'block', { block: b.id, paint, color: v.color, dark: shade(v.color, 0.72), pattern: b.pattern, dye: v.dye || null, wood: v.wood || null, base: b.drop === b.key ? b.key : null });
    });
  }
  // From the world (decor.js's decorDrops): plants that gave nothing, now gathered.
  item('fern', 'Fern', 'block', { block: by.get('fern').id, color: '#3f7a3a', pattern: 'fern' });
  item('bush', 'Bush', 'block', { block: by.get('bush').id, color: '#3a7232', pattern: 'bush' });
  for (const [key, name, color] of [['reed', 'Reed', '#a8b860'], ['kelp', 'Kelp', '#4f7a2a'], ['coral_fan', 'Coral fan', '#e0607a'], ['petals', 'Petals', '#f4b0cc'], ['stick', 'Stick', '#9a6a3a']]) item(key, name, 'material', { color });
  // Made: what's spun, woven, pressed and forged.
  for (const [key, name, color] of [
    ['string', 'String', '#efeae0'], ['rope', 'Rope', '#c8a46a'], ['cloth', 'Cloth', '#e8e0cc'], ['paper', 'Paper', '#f4f0e2'], ['book', 'Book', '#8a3a2a'],
    ['nails', 'Nails', '#9aa0a8'], ['tallow', 'Tallow', '#efe2b8'],
  ]) item(key, name, 'material', { color });
  // Dyes.
  for (const d of DYES) item(`${d.key}_dye`, `${d.name} dye`, 'material', { color: d.color, dyeOf: d.key });
  // Food from the stove (and the campfire).
  const food = (key, name, f, sat, heal, color, look, o = {}) => item(key, name, 'food', { stack: 99, heal, food: f, sat, color, look, ...o });
  food('dried_kelp', 'Dried kelp', 1, 0.6, 4, '#3e5a2a', 'kelp');
  food('fried_egg', 'Fried egg', 3, 3.6, 12, '#f4e8c0', 'fried_egg');
  food('omelette', 'Mushroom omelette', 6, 7.2, 26, '#f2d878', 'fried_egg');
  food('veg_soup', 'Vegetable soup', 8, 9.6, 40, '#c8783a', 'stew', { stack: 20 });
  food('fish_stew', 'Fish stew', 10, 12, 50, '#d8b07a', 'stew', { stack: 20 });
  food('roast_dinner', 'Roast dinner', 14, 16, 70, '#8a4a2a', 'stew', { stack: 20 });
  food('apple_pie', 'Apple pie', 9, 8, 40, '#d8a050', 'pie');
  food('pumpkin_pie', 'Pumpkin pie', 8, 5, 35, '#e0861e', 'pie');
  food('cookie', 'Cookie', 2, 0.4, 6, '#b8783a', 'cookie');
  food('cake', 'Cake', 14, 6, 70, '#f4ece0', 'cake', { stack: 10 });
  // Slabs and stairs: a block, shaped as it's put down.
  for (const [blockKey, key, name] of SHAPED) {
    const b = by.get(blockKey);
    item(`${key}_slab`, `${name} slab`, 'block', { block: b.id, shape: 'slab', shapeIcon: SHAPE_AT('bottom'), color: b.color, dark: b.dark, pattern: b.pattern, base: blockKey });
    item(`${key}_stairs`, `${name} stairs`, 'block', { block: b.id, shape: 'stairs', shapeIcon: SHAPE_AT('rampR'), color: b.color, dark: b.dark, pattern: b.pattern, base: blockKey });
  }
  // Blueprints: a whole building, put up at once (kits.js). Kept: drawn up once, used again and again.
  for (const [key, name, kit] of BLUEPRINTS) item(key, name, 'blueprint', { stack: 1, kit, color: '#2f62c8' });
}

// ---- Recipes ----------------------------------------------------------------------------------------

const R = [];
const recipe = (key, n, of, at = null) => R.push([key, n, of, at]);

// From the world, and spun and woven: sticks, string, rope, cloth, paper and books, tallow.
recipe('stick', 4, [['planks', 1]]);
recipe('string', 4, [['wool', 1]]);
recipe('rope', 1, [['string', 3]]);
recipe('cloth', 2, [['string', 4]], 'loom');
recipe('rope', 2, [['string', 4]], 'loom');
recipe('paper', 3, [['reed', 3]]);
recipe('paper', 2, [['wood', 1]], 'workbench');
recipe('book', 1, [['paper', 3], ['leather', 1]]);
recipe('nails', 16, [['iron_bar', 1]], 'anvil');
recipe('chain', 3, [['iron_bar', 1]], 'anvil');
for (const meat of ['raw_pork', 'raw_beef', 'raw_mutton']) recipe('tallow', 2, [[meat, 1]], 'campfire');
recipe('coal', 1, [['wood', 2]], 'furnace');
recipe('hay_bale', 1, [['wheat', 9]]);
recipe('wheat', 9, [['hay_bale', 1]]);

// Dyes: from flowers and minerals, and mixed.
const dye = (d, n, of, at = null) => recipe(`${d}_dye`, n, of, at);
dye('white', 2, [['bone_meal', 1]]); dye('white', 2, [['daisy', 1]]);
dye('light_gray', 2, [['gray_dye', 1], ['white_dye', 1]]); dye('light_gray', 1, [['ash', 2]]);
dye('gray', 2, [['black_dye', 1], ['white_dye', 1]]);
dye('black', 2, [['coal', 1]]);
dye('brown', 1, [['dirt', 4]]); dye('brown', 2, [['mud', 2]]);
dye('red', 2, [['rose', 1]]); dye('red', 1, [['berries', 3]]);
dye('orange', 2, [['marigold', 1]]); dye('orange', 2, [['red_dye', 1], ['yellow_dye', 1]]); dye('orange', 1, [['carrot', 2]]);
dye('yellow', 2, [['dandelion', 1]]); dye('yellow', 1, [['clay_pale', 2]]);
dye('lime', 2, [['green_dye', 1], ['white_dye', 1]]);
dye('green', 1, [['cactus', 1]], 'furnace'); dye('green', 1, [['kelp', 2]], 'furnace');
dye('cyan', 2, [['green_dye', 1], ['blue_dye', 1]]);
dye('light_blue', 2, [['blue_dye', 1], ['white_dye', 1]]); dye('light_blue', 1, [['mushroom', 1]]); dye('light_blue', 4, [['crystal_ore', 1]]);
dye('blue', 2, [['cornflower', 1]]); dye('blue', 6, [['sapphire', 1]]);
dye('purple', 2, [['violet', 1]]); dye('purple', 2, [['red_dye', 1], ['blue_dye', 1]]); dye('purple', 6, [['amethyst', 1]]);
dye('magenta', 2, [['purple_dye', 1], ['pink_dye', 1]]); dye('magenta', 2, [['glowcap', 1]]);
dye('pink', 2, [['red_dye', 1], ['white_dye', 1]]); dye('pink', 1, [['petals', 2]]); dye('pink', 2, [['coral_fan', 1]]);

// Building blocks: concrete and terracotta, glass panes, cut stone, blocks of metal.
recipe('concrete', 8, [['sand', 4], ['gravel', 4], ['stone', 1]], 'mason');
recipe('terracotta', 1, [['clay', 1]], 'furnace');
recipe('glass_pane', 4, [['glass', 3]], 'workbench');
for (const [key, from, n] of [['polished_stone', 'stone', 4], ['polished_slate', 'slate', 4], ['polished_basalt', 'basalt', 4], ['polished_sandstone', 'sandstone', 4], ['polished_marble', 'calcite', 4], ['polished_obsidian', 'obsidian', 2]]) recipe(key, n, [[from, n]], 'mason');
for (const [key, from] of [['chiseled_stone', 'stone_bricks'], ['chiseled_sandstone', 'sandstone_bricks'], ['chiseled_slate', 'polished_slate'], ['chiseled_marble', 'polished_marble'], ['chiseled_dark_bricks', 'dark_bricks']]) recipe(key, 1, [[from, 1]], 'mason');
for (const [key, from] of [['stone_column', 'stone'], ['sandstone_column', 'sandstone'], ['marble_column', 'calcite'], ['basalt_column', 'basalt'], ['dark_column', 'dark_bricks']]) recipe(key, 2, [[from, 3]], 'mason');
for (const m of ['iron', 'copper', 'gold', 'silver']) { recipe(`${m}_block`, 1, [[`${m}_bar`, 6]], 'anvil'); recipe(`${m}_bar`, 6, [[`${m}_block`, 1]], 'anvil'); }
recipe('verdigris_block', 1, [['copper_block', 1], ['cyan_dye', 1]], 'anvil');
recipe('iron_bars', 8, [['iron_bar', 3]], 'anvil');
// Slabs and stairs (as many as the blocks they're cut from: broken, they're those blocks again).
for (const [blockKey, key, , at] of SHAPED) { recipe(`${key}_slab`, 4, [[blockKey, 4]], at); recipe(`${key}_stairs`, 4, [[blockKey, 4]], at); }
// Windows, trapdoors, gates, scaffolding.
recipe('window', 1, [['planks', 2], ['glass_pane', 2]], 'workbench');
recipe('trapdoor', 2, [['planks', 6]], 'workbench');
recipe('gate', 1, [['stick', 4], ['planks', 2]], 'workbench');
recipe('scaffolding', 6, [['stick', 6], ['string', 1]]);
// Lights: candles, paper lanterns, a crystal lamp, a chandelier, a street lamp.
recipe('candle', 4, [['tallow', 1], ['string', 1]]);
recipe('paper_lantern', 2, [['paper', 3], ['string', 1], ['torch', 1]], 'workbench');
recipe('crystal_lamp', 1, [['crystal_ore', 2], ['glass', 2], ['silver_bar', 1]], 'anvil');
recipe('chandelier', 1, [['gold_bar', 2], ['candle', 6], ['chain', 2]], 'anvil');
recipe('lamp_post', 1, [['iron_bar', 3], ['lantern', 1]], 'anvil');
// Decorations and furniture.
recipe('flower_pot', 1, [['clay', 2]], 'furnace');
recipe('painting', 1, [['stick', 4], ['cloth', 1], ['red_dye', 1], ['blue_dye', 1], ['yellow_dye', 1]], 'workbench');
recipe('shelf', 2, [['planks', 3], ['nails', 2]], 'workbench');
recipe('cabinet', 1, [['planks', 8], ['nails', 4], ['iron_bar', 1]], 'workbench');
recipe('bookshelf', 1, [['planks', 6], ['book', 3]], 'workbench');
recipe('banner', 1, [['cloth', 2], ['stick', 1]], 'loom');
recipe('bed', 1, [['planks', 3], ['cloth', 2]], 'workbench');
recipe('carpet', 4, [['cloth', 2]], 'loom');
// Stations.
recipe('stove', 1, [['iron_bar', 6], ['stone_bricks', 4], ['coal', 2]], 'anvil');
recipe('loom', 1, [['planks', 6], ['string', 4], ['stick', 2]], 'workbench');
recipe('mason_bench', 1, [['stone', 8], ['iron_bar', 2], ['planks', 2]], 'workbench');
recipe('drafting_table', 1, [['planks', 6], ['paper', 4], ['stick', 2]], 'workbench');
// Woods by their finish (a dye on plain planks), and tables and chairs of each.
for (const w of WOODS) {
  recipe(`${w.key}_planks`, 8, [['planks', 8], [`${w.dye}_dye`, 1]], 'workbench');
  recipe(`${w.key}_table`, 1, [[`${w.key}_planks`, 6]], 'workbench');
  recipe(`${w.key}_chair`, 1, [[`${w.key}_planks`, 4]], 'workbench');
}
// Everything that comes in colours, dyed (blocks.js's variants): n of it and a dye, n dyed.
const DYED = [['wool', 4, null], ['carpet', 8, 'loom'], ['bed', 1, 'workbench'], ['banner', 1, 'loom'], ['concrete', 8, 'mason'], ['terracotta', 8, 'mason'],
  ['glass_pane', 8, 'workbench'], ['candle', 4, null], ['paper_lantern', 2, 'workbench'], ['roof_tiles', 8, 'mason']];
for (const [base, n, at] of DYED) {
  const b = BLOCKS.find(x => x.key === base);
  for (const v of b.variants.slice(1)) recipe(v.key, n, [[base, n], [`${v.dye}_dye`, 1]], at);
}
// The stove: what a campfire cooks (it counts as one: crafting.js), and more.
recipe('dried_kelp', 1, [['kelp', 1]], 'campfire');
recipe('fried_egg', 1, [['egg', 1]], 'campfire');
recipe('omelette', 1, [['egg', 2], ['mushroom', 1]], 'stove');
recipe('veg_soup', 1, [['carrot', 1], ['potato', 1], ['mushroom', 1]], 'stove');
recipe('fish_stew', 1, [['cooked_fish', 1], ['potato', 1], ['carrot', 1]], 'stove');
recipe('roast_dinner', 1, [['steak', 1], ['baked_potato', 1], ['carrot', 1]], 'stove');
recipe('apple_pie', 1, [['apple', 3], ['wheat', 2], ['egg', 1]], 'stove');
recipe('pumpkin_pie', 1, [['pumpkin', 1], ['wheat', 1], ['egg', 1]], 'stove');
recipe('cookie', 8, [['wheat', 2], ['berries', 2]], 'stove');
recipe('cake', 1, [['wheat', 3], ['egg', 2], ['berries', 3], ['apple', 1]], 'stove');
// Blueprints, drawn up at a drafting table (the bigger the building, the more paper).
recipe('blueprint_cottage', 1, [['paper', 4], ['blue_dye', 1]], 'drafting');
recipe('blueprint_stone_house', 1, [['paper', 6], ['blue_dye', 1], ['book', 1]], 'drafting');
recipe('blueprint_watchtower', 1, [['paper', 6], ['blue_dye', 2]], 'drafting');
recipe('blueprint_wall', 1, [['paper', 2], ['blue_dye', 1]], 'drafting');
recipe('blueprint_bridge', 1, [['paper', 3], ['blue_dye', 1], ['rope', 1]], 'drafting');
recipe('blueprint_workshop', 1, [['paper', 5], ['blue_dye', 1], ['book', 1]], 'drafting');

/** The recipes: [key, n, of, at]. */
export const CRAFT_RECIPES = R;

// ---- Kinds of recipe, for the inventory screen -------------------------------------------------------

/** The crafting list's kinds of thing, in the order its tabs show them. */
export const CRAFT_CATS = { all: 'All', build: 'Building', furniture: 'Furniture', decor: 'Decor', light: 'Lights', colour: 'Colours', kits: 'Kits', base: 'Bases', gear: 'Tools & arms', food: 'Food', material: 'Materials' };
const DECOR_KEYS = new Set(['sign', 'banner', 'carpet', 'awning', 'painting', 'flower_pot', 'shelf', 'chain', 'post', 'fence', 'gate', 'stone_column', 'sandstone_column', 'marble_column', 'basalt_column', 'dark_column', 'fern', 'bush', 'hay_bale']);
// (A base's own things, bases.js: its flag, a charter, what defends it, what breaks into one.)
const BASE_KEYS = new Set(['claim_flag', 'charter', 'reinforced_bricks', 'iron_door', 'battering_ram']);
const FURNITURE_KEYS = new Set(['bed', 'chest', 'table', 'chair', 'bookshelf', 'barrel', 'cabinet', 'workbench', 'furnace', 'anvil', 'gunsmith', 'campfire', 'stove', 'loom', 'mason_bench', 'drafting_table', 'ender_chest', 'waystone']);

/**
 * Which tab item `it` (items.js) is made under: building (blocks, walls, slabs, windows), furniture
 * (beds, tables, stations, storage), decor, lights, colours (dyes, and what's dyed), kits
 * (blueprints), bases (flags, defences, siege tools), tools and arms (boats too), food, or materials.
 */
export function craftCategory(it) {
  if (!it) return 'material';
  const k = it.key;
  if (it.kind === 'blueprint') return 'kits';
  if (it.kind === 'siege' || BASE_KEYS.has(k) || (it.kind === 'block' && DEFENCES.has(it.block))) return 'base';
  if (it.kind === 'food') return 'food';
  if (['weapon', 'ammo', 'tool', 'gear', 'attachment', 'bucket', 'contract', 'scroll', 'boat'].includes(it.kind)) return 'gear';
  if (it.dyeOf || it.dye) return 'colour';
  if (FURNITURE_KEYS.has(k) || FURNITURE_KEYS.has(it.base) || /shulker_box$/.test(k)) return 'furniture';
  if (it.kind === 'block') {
    const b = BLOCKS[it.block];
    if (b.light && !b.station) return 'light';
    if (DECOR_KEYS.has(k) || DECOR_KEYS.has(it.base)) return 'decor';
    return 'build';
  }
  if (it.kind === 'wall') return 'build';
  return 'material';
}
