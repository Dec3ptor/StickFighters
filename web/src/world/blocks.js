// The blocks a world is made of (world mode): what each one is, whether you can walk through
// it, how it's mined and blasted, what it drops, how much light it gives, and how it looks in
// each game. A block's number is its place in BLOCKS: saved worlds keep these numbers, so new
// blocks only ever go on the end.
//
//   solid      soldiers, shots and blasts stop at it (else you walk through: plants, trees, torches)
//   platform   stood on from above, jumped up through, dropped through (crouch + jump)
//   hard       how long it takes to mine: hits of a basic pickaxe's worth (see worldplay.js)
//   tool       'pick' (most), 'axe' (trees), 'hand' (anything breaks it: plants, torches)
//   tier       the pickaxe it needs (0: any; 9: nothing breaks it)
//   resist     how much smaller a blast's hole is in it (px): soft dirt 0, metal plate 30
//   drop       the item it gives when mined (its own, unless said; null: nothing)
//   light      light it gives off (0-15); clear: light goes through it (not a solid wall to light)
//   color      Remastered's colour; pattern: the marks it gets in both games (worldrender.js)
//   station    a crafting station ('workbench', 'furnace', 'anvil', 'gunsmith': crafting.js)
//   furniture  stands on the floor (and goes when the floor does), walked through

export const TILE = 16;

const B = [];
const def = (key, name, o = {}) => {
  const b = {
    id: B.length, key, name, solid: true, platform: false, hard: 3, tool: 'pick', tier: 0, resist: 6,
    drop: key, light: 0, clear: false, color: '#888888', dark: null, pattern: 'plain', natural: false, station: null, furniture: false, ...o,
  };
  b.dark ??= shade(b.color, 0.72);
  B.push(b);
  return b.id;
};

/** A colour ('#rrggbb') made darker (k < 1) or lighter (k > 1). */
export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = v => Math.max(0, Math.min(255, Math.round(k > 1 ? v + (255 - v) * (k - 1) : v * k)));
  return `#${((c(n >> 16) << 16) | (c((n >> 8) & 255) << 8) | c(n & 255)).toString(16).padStart(6, '0')}`;
}

export const AIR = def('air', 'Air', { solid: false, hard: 0, drop: null, clear: true, resist: 0 });

// ---- The ground ----------------------------------------------------------------------------
export const GRASS = def('grass', 'Grass', { hard: 2, resist: 0, drop: 'dirt', color: '#6a8f3b', dark: '#5b4129', pattern: 'grass', natural: true });
export const DIRT = def('dirt', 'Dirt', { hard: 2, resist: 0, color: '#7a5636', pattern: 'dots', natural: true });
export const STONE = def('stone', 'Stone', { hard: 4, resist: 6, color: '#7c7f86', pattern: 'cracks', natural: true });
export const SLATE = def('slate', 'Slate', { hard: 6, resist: 10, color: '#4f535c', pattern: 'cracks', natural: true });
export const SAND = def('sand', 'Sand', { hard: 2, resist: 0, color: '#dcc68a', pattern: 'stipple', natural: true });
export const SANDSTONE = def('sandstone', 'Sandstone', { hard: 4, resist: 5, color: '#c9a86a', pattern: 'strata', natural: true });
export const SNOW = def('snow', 'Snow', { hard: 2, resist: 0, color: '#eef3f7', pattern: 'plain', natural: true });
// (Slippery underfoot: physics.js. slip: how much, 0 to 1.)
export const ICE = def('ice', 'Ice', { hard: 3, resist: 4, color: '#9fd0ea', pattern: 'glass', natural: true, slip: 1 });
export const MUD = def('mud', 'Mud', { hard: 2, resist: 0, color: '#5a4636', pattern: 'dots', natural: true });
export const JUNGLE_GRASS = def('jungle_grass', 'Jungle grass', { hard: 2, resist: 0, drop: 'mud', color: '#3f8f3a', dark: '#4a3a2c', pattern: 'grass', natural: true });
export const RED_SAND = def('red_sand', 'Red sand', { hard: 2, resist: 0, color: '#c97a45', pattern: 'stipple', natural: true });
export const CLAY = def('clay', 'Clay', { hard: 3, resist: 3, color: '#b3664a', pattern: 'strata', natural: true });
export const CLAY_PALE = def('clay_pale', 'Pale clay', { hard: 3, resist: 3, color: '#d9b48c', pattern: 'strata', natural: true });
export const GRAVEL = def('gravel', 'Gravel', { hard: 2, resist: 1, color: '#8e8a84', pattern: 'pebbles', natural: true });
export const BASALT = def('basalt', 'Basalt', { hard: 7, resist: 12, color: '#3a3438', pattern: 'cracks', natural: true });
export const MAGMA = def('magma', 'Magma rock', { hard: 6, resist: 10, color: '#a8401c', dark: '#5c2414', pattern: 'veins', light: 9, natural: true });
export const OBSIDIAN = def('obsidian', 'Obsidian', { hard: 24, resist: 40, tier: 3, color: '#2a1f38', pattern: 'glass', natural: true });
export const BEDROCK = def('bedrock', 'Bedrock', { hard: 0, tier: 9, resist: 1e9, drop: null, color: '#25252a', pattern: 'cracks', natural: true });

// ---- Ores (in stone) ------------------------------------------------------------------------
export const COAL = def('coal_ore', 'Coal ore', { hard: 4, resist: 6, drop: 'coal', color: '#7c7f86', pattern: 'ore', ore: '#202020', natural: true });
export const COPPER = def('copper_ore', 'Copper ore', { hard: 5, resist: 6, drop: 'copper_ore', color: '#7c7f86', pattern: 'ore', ore: '#d07a3a', natural: true });
export const IRON = def('iron_ore', 'Iron ore', { hard: 6, resist: 8, color: '#7c7f86', pattern: 'ore', ore: '#d8b89a', natural: true });
export const GOLD = def('gold_ore', 'Gold ore', { hard: 8, resist: 10, tier: 1, color: '#4f535c', pattern: 'ore', ore: '#f2c230', natural: true });
export const CRYSTAL = def('crystal_ore', 'Crystal', { hard: 10, resist: 12, tier: 2, color: '#4f535c', pattern: 'ore', ore: '#5ee0ff', light: 5, natural: true });
export const EMBER = def('ember_ore', 'Ember ore', { hard: 12, resist: 14, tier: 3, color: '#3a3438', pattern: 'ore', ore: '#ff5a1f', light: 7, natural: true });

// ---- Trees and plants (walked through) ----------------------------------------------------------
export const TRUNK = def('trunk', 'Tree', { solid: false, hard: 3, tool: 'axe', resist: 2, drop: 'wood', color: '#7a5634', pattern: 'bark', natural: true });
export const LEAVES = def('leaves', 'Leaves', { solid: false, hard: 0, tool: 'hand', resist: 0, drop: null, clear: true, color: '#4f8a34', pattern: 'leaves', natural: true });
export const PINE_LEAVES = def('pine_leaves', 'Pine needles', { solid: false, hard: 0, tool: 'hand', resist: 0, drop: null, clear: true, color: '#2f5f3a', pattern: 'leaves', natural: true });
export const JUNGLE_LEAVES = def('jungle_leaves', 'Jungle leaves', { solid: false, hard: 0, tool: 'hand', resist: 0, drop: null, clear: true, color: '#2f8a3a', pattern: 'leaves', natural: true });
export const CACTUS = def('cactus', 'Cactus', { solid: false, hard: 1, tool: 'axe', resist: 0, color: '#4f9a4a', pattern: 'cactus', natural: true });
export const TALL_GRASS = def('tall_grass', 'Tall grass', { solid: false, hard: 0, tool: 'hand', resist: 0, drop: null, clear: true, color: '#6f9a3f', pattern: 'blades', natural: true });
export const FLOWER = def('flower', 'Flower', { solid: false, hard: 0, tool: 'hand', resist: 0, drop: null, clear: true, color: '#e05a6a', pattern: 'flower', natural: true });
export const MUSHROOM = def('mushroom', 'Glowing mushroom', { solid: false, hard: 0, tool: 'hand', resist: 0, clear: true, light: 6, color: '#5ad0e0', pattern: 'mushroom', natural: true });
export const VINE = def('vine', 'Vine', { solid: false, hard: 0, tool: 'hand', resist: 0, drop: null, clear: true, color: '#2f7a34', pattern: 'vine', natural: true });
export const DEAD_BUSH = def('dead_bush', 'Dead bush', { solid: false, hard: 0, tool: 'hand', resist: 0, drop: null, clear: true, color: '#8a6a3a', pattern: 'blades', natural: true });

// ---- Built (placed by players) ----------------------------------------------------------------
export const LOG = def('log', 'Log', { hard: 3, resist: 4, wood: true, color: '#8a6238', pattern: 'rings' });
export const PLANKS = def('planks', 'Planks', { hard: 3, resist: 4, wood: true, color: '#b08250', pattern: 'planks' });
export const STONE_BRICKS = def('stone_bricks', 'Stone bricks', { hard: 6, resist: 12, color: '#8c8f96', pattern: 'bricks' });
export const BRICKS = def('bricks', 'Bricks', { hard: 6, resist: 12, color: '#a8503c', pattern: 'bricks' });
export const SANDSTONE_BRICKS = def('sandstone_bricks', 'Sandstone bricks', { hard: 5, resist: 10, color: '#d6b67a', pattern: 'bricks' });
export const GLASS = def('glass', 'Glass', { hard: 2, resist: 2, clear: true, color: '#cfeaf4', pattern: 'glass' });
export const METAL = def('metal', 'Metal plate', { hard: 14, resist: 30, tier: 1, color: '#9aa3ad', pattern: 'metal' });
export const PLATFORM = def('platform', 'Wooden platform', { solid: false, platform: true, hard: 1, resist: 2, wood: true, clear: true, color: '#b08250', pattern: 'platform' });
export const DOOR = def('door', 'Door', { hard: 3, resist: 6, wood: true, color: '#9a6a3a', pattern: 'door' });
export const DOOR_OPEN = def('door_open', 'Door (open)', { solid: false, hard: 3, resist: 6, wood: true, drop: 'door', clear: true, color: '#9a6a3a', pattern: 'door_open' });
export const TORCH = def('torch', 'Torch', { solid: false, hard: 0, tool: 'hand', resist: 0, clear: true, light: 14, color: '#ffb040', pattern: 'torch' });
export const LOOT_CRATE = def('loot_crate', 'Supply crate', { hard: 2, tool: 'any', resist: 4, wood: true, drop: null, color: '#7a6a3a', pattern: 'crate' });
export const MOSSY_BRICKS = def('mossy_bricks', 'Mossy bricks', { hard: 6, resist: 12, drop: 'stone_bricks', color: '#7a8a6a', pattern: 'bricks' });
export const SNOW_BRICKS = def('snow_bricks', 'Snow bricks', { hard: 3, resist: 4, color: '#e2ebf2', pattern: 'bricks' });
export const BLAST_BRICKS = def('blast_bricks', 'Blast-proof bricks', { hard: 18, resist: 60, tier: 2, color: '#5c6470', pattern: 'bricks' });
export const LADDER = def('ladder', 'Ladder', { solid: false, hard: 1, resist: 2, wood: true, clear: true, color: '#a87a48', pattern: 'ladder' });

// ---- Furniture: crafting stations, chests and beds (stood on the floor, walked through) --------------
const furniture = o => ({ solid: false, clear: true, furniture: true, ...o });
export const WORKBENCH = def('workbench', 'Workbench', furniture({ hard: 2, resist: 4, wood: true, color: '#9a6a3a', pattern: 'workbench', station: 'workbench' }));
export const FURNACE = def('furnace', 'Furnace', furniture({ hard: 4, resist: 10, light: 9, color: '#6e6e74', pattern: 'furnace', station: 'furnace' }));
export const ANVIL = def('anvil', 'Anvil', furniture({ hard: 6, resist: 20, color: '#4f555e', pattern: 'anvil', station: 'anvil' }));
export const GUNSMITH = def('gunsmith', "Gunsmith's bench", furniture({ hard: 4, resist: 12, color: '#56606e', pattern: 'gunsmith', station: 'gunsmith' }));
export const CHEST = def('chest', 'Chest', furniture({ hard: 2, resist: 6, wood: true, color: '#9a6a3a', pattern: 'chest' }));
export const BED = def('bed', 'Bed', furniture({ hard: 2, resist: 4, wood: true, color: '#b03a3a', pattern: 'bed' }));
// A base flag: claims the blocks round it (worldplay.js: CLAIM_R) for whoever put it up.
export const CLAIM_FLAG = def('claim_flag', 'Base flag', furniture({ hard: 3, resist: 30, wood: true, color: '#c8282e', pattern: 'flag' }));

// ---- What towns are built of (towns.js), and players can make too (crafting.js) ------------------
export const COBBLESTONE = def('cobblestone', 'Cobblestone', { hard: 5, resist: 10, color: '#8d8b86', pattern: 'cobble' });
export const ROOF_TILES = def('roof_tiles', 'Roof tiles', { hard: 3, resist: 6, color: '#a4472f', pattern: 'shingles' });
export const THATCH = def('thatch', 'Thatch', { hard: 1, resist: 1, wood: true, color: '#c9a44c', pattern: 'thatch' });
export const PLASTER = def('plaster', 'Plaster', { hard: 3, resist: 6, color: '#e9e1cd', pattern: 'plain' });
export const TIMBER = def('timber', 'Timber beam', { hard: 3, resist: 5, wood: true, color: '#5e3f25', pattern: 'timber' });
export const MUD_BRICKS = def('mud_bricks', 'Mud bricks', { hard: 4, resist: 8, color: '#9b6b45', pattern: 'bricks' });
export const STAINED_GLASS = def('stained_glass', 'Stained glass', { hard: 2, resist: 2, clear: true, color: '#7a52b8', pattern: 'stained' });
export const FENCE = def('fence', 'Fence', { solid: false, hard: 1, resist: 2, wood: true, clear: true, color: '#9a7046', pattern: 'fence' });
export const LANTERN = def('lantern', 'Lantern', { solid: false, hard: 0, tool: 'hand', resist: 0, clear: true, light: 13, color: '#ffc860', pattern: 'lantern' });
export const AWNING = def('awning', 'Awning', { solid: false, platform: true, hard: 1, resist: 1, clear: true, color: '#c23a34', pattern: 'awning' });
export const BANNER = def('banner', 'Banner', { solid: false, hard: 1, tool: 'hand', resist: 1, clear: true, color: '#b02a30', pattern: 'banner' });
export const WHEAT = def('wheat', 'Wheat', { solid: false, hard: 0, tool: 'hand', resist: 0, clear: true, color: '#d8b04a', pattern: 'crops' });
export const TABLE = def('table', 'Table', furniture({ hard: 2, resist: 4, wood: true, color: '#9a6a3a', pattern: 'table' }));
export const CHAIR = def('chair', 'Chair', furniture({ hard: 1, resist: 3, wood: true, color: '#9a6a3a', pattern: 'chair' }));
export const BOOKSHELF = def('bookshelf', 'Bookshelf', furniture({ hard: 2, resist: 4, wood: true, color: '#6e4a2c', pattern: 'bookshelf' }));
export const BARREL = def('barrel', 'Barrel', furniture({ hard: 2, resist: 4, wood: true, color: '#8a5a32', pattern: 'barrel' }));
export const SIGN = def('sign', 'Sign', furniture({ hard: 1, resist: 2, wood: true, color: '#a87a48', pattern: 'sign' }));
export const POST = def('post', 'Wooden post', { solid: false, hard: 2, resist: 3, wood: true, clear: true, color: '#7a5634', pattern: 'post' });

// ---- Ores in veins and nodes, gems and diamonds (worlds made since: worldgen.js's oreVeins) ---------
export const SILVER = def('silver_ore', 'Silver ore', { hard: 7, resist: 9, tier: 1, color: '#7c7f86', pattern: 'ore', ore: '#dfe4ec', natural: true });
const gem = (key, name, drop, ore) => def(key, name, { hard: 9, resist: 10, tier: 2, drop, color: '#4f535c', pattern: 'gem', ore, light: 2, natural: true });
export const RUBY = gem('ruby_ore', 'Ruby', 'ruby', '#e0213c');
export const SAPPHIRE = gem('sapphire_ore', 'Sapphire', 'sapphire', '#2f62ee');
export const EMERALD = gem('emerald_ore', 'Emerald', 'emerald', '#1fc45c');
export const TOPAZ = gem('topaz_ore', 'Topaz', 'topaz', '#f2a81e');
export const AMETHYST = gem('amethyst_ore', 'Amethyst', 'amethyst', '#a052ea');
export const KIMBERLITE = def('kimberlite', 'Kimberlite', { hard: 8, resist: 12, tier: 2, color: '#3e4a56', pattern: 'cracks', natural: true });
export const DIAMOND = def('diamond_ore', 'Diamond', { hard: 14, resist: 16, tier: 3, drop: 'diamond', color: '#3e4a56', pattern: 'gem', ore: '#c4f6ff', light: 4, natural: true });
// ---- A grave (worldplay.js): where a player died, with what they lost in it. Nothing breaks it:
// right clicked, it gives its things back (to whoever it was, or, after a while, to anyone).
export const GRAVE = def('grave', 'Grave', { solid: false, clear: true, hard: 1, tier: 9, resist: 1e9, drop: null, light: 3, color: '#8d8b86', pattern: 'grave' });
// ---- Storage (worldplay.js). An ender chest: each player's own things, the same in every ender
// chest anywhere. Shulker boxes: chests that keep what's in them when they're picked up.
export const ENDER_CHEST = def('ender_chest', 'Ender chest', furniture({ hard: 8, tier: 2, resist: 40, light: 4, color: '#1d2a2e', pattern: 'ender' }));
const shulker = (key, name, color) => def(key, name, furniture({ hard: 2, resist: 8, color, pattern: 'shulker' }));
export const SHULKER_BOX = shulker('shulker_box', 'Shulker box', '#9a6ab8');
export const RED_SHULKER_BOX = shulker('red_shulker_box', 'Red shulker box', '#c0392b');
export const BLUE_SHULKER_BOX = shulker('blue_shulker_box', 'Blue shulker box', '#2f62ee');
export const GREEN_SHULKER_BOX = shulker('green_shulker_box', 'Green shulker box', '#1f9c4c');
export const YELLOW_SHULKER_BOX = shulker('yellow_shulker_box', 'Yellow shulker box', '#e0b020');
/** The shulker boxes. */
export const SHULKER_BOXES = new Set([SHULKER_BOX, RED_SHULKER_BOX, BLUE_SHULKER_BOX, GREEN_SHULKER_BOX, YELLOW_SHULKER_BOX]);
// ---- A waystone (waystones.js): stood by, it takes you to any other waystone in the world.
export const WAYSTONE = def('waystone', 'Waystone', furniture({ hard: 10, tier: 1, resist: 60, light: 7, color: '#8a93a6', pattern: 'waystone' }));

// ---- Water and what grows in it (worlds made since seas: worldgen.js's gen 4) ------------------
// Water: swum in (physics.js), not dug or blasted. Still water is a source: the land's seas, lakes
// and pools, and wells, are; it stays as it is, and flows out where a way opens up beside or below
// it (tileworld.js's flow: flowing water, below). What grows in it is in water too (liquid: swum
// through, drawn under the water; a source): seagrass, kelp, coral fans, reeds at the edges, and
// lily pads on top (stood on, like a platform). Coral grows into blocks, on reefs in warm seas.
const wet = o => ({ solid: false, hard: 0, tool: 'hand', resist: 0, drop: null, clear: true, natural: true, liquid: true, fluid: 'water', amount: 8, source: true, ...o });
export const WATER = def('water', 'Water', wet({ tool: 'none', tier: 9, resist: 999, color: '#2f6fd0', pattern: 'water' }));
export const SEAGRASS = def('seagrass', 'Seagrass', wet({ color: '#3f9a4a', pattern: 'seagrass' }));
export const KELP = def('kelp', 'Kelp', wet({ color: '#4f7a2a', pattern: 'kelp' }));
export const CORAL_FAN = def('coral_fan', 'Coral fan', wet({ color: '#e0607a', pattern: 'fan' }));
export const REEDS = def('reeds', 'Reeds', wet({ color: '#8a9a4a', pattern: 'reeds' }));
export const LILY_PAD = def('lily_pad', 'Lily pad', wet({ platform: true, color: '#4f9a3a', pattern: 'lily' }));
const coral = (key, name, color) => def(key, name, { hard: 2, resist: 2, color, pattern: 'coral', natural: true });
export const CORAL = coral('coral', 'Coral', '#e05a7a');
export const CORAL_BLUE = coral('coral_blue', 'Blue coral', '#3a7ae0');
export const CORAL_GOLD = coral('coral_gold', 'Gold coral', '#e0b030');
// Shipwrecks (worldgen.js): their hulls, of old timber gone dark in the sea.
export const OLD_PLANKS = def('old_planks', 'Old planks', { hard: 3, resist: 4, wood: true, drop: 'planks', color: '#6a5238', pattern: 'planks' });

// ---- More trees, ground and plants (worlds made since forests: worldgen.js's gen 5) ---------------
// Trunks are walked through and felled whole with an axe (wood); leaves, broken by hand. A giant
// mushroom's cap is stood on, like a platform.
const trunk = (key, name, color, pattern = 'bark', o = {}) => def(key, name, { solid: false, hard: 3, tool: 'axe', resist: 2, drop: 'wood', color, pattern, natural: true, trunk: true, ...o });
const leaves = (key, name, color, o = {}) => def(key, name, { solid: false, hard: 0, tool: 'hand', resist: 0, drop: null, clear: true, color, pattern: 'leaves', natural: true, leaf: true, ...o });
export const BIRCH_TRUNK = trunk('birch_trunk', 'Birch tree', '#e4e0d4', 'birch');
export const BIRCH_LEAVES = leaves('birch_leaves', 'Birch leaves', '#7cae4a');
export const DARK_TRUNK = trunk('dark_trunk', 'Dark oak', '#4a3422');
export const DARK_LEAVES = leaves('dark_leaves', 'Dark oak leaves', '#2c5622');
export const SPRUCE_TRUNK = trunk('spruce_trunk', 'Spruce', '#5a3e28');
export const SPRUCE_LEAVES = leaves('spruce_leaves', 'Spruce needles', '#2a4c38', { spiky: true });
export const SNOWY_LEAVES = leaves('snowy_needles', 'Snowy needles', '#d8e6e8', { spiky: true });
export const ACACIA_TRUNK = trunk('acacia_trunk', 'Acacia', '#7a6250');
export const ACACIA_LEAVES = leaves('acacia_leaves', 'Acacia leaves', '#8a9e3a');
export const CHERRY_TRUNK = trunk('cherry_trunk', 'Cherry tree', '#5a3236');
export const CHERRY_LEAVES = leaves('cherry_leaves', 'Cherry blossom', '#f4a6c8');
export const PALM_TRUNK = trunk('palm_trunk', 'Palm', '#a8885a', 'palm');
export const PALM_LEAVES = leaves('palm_leaves', 'Palm fronds', '#4a9a38', { pattern: 'frond' });
export const MUSHROOM_STEM = trunk('mushroom_stem', 'Giant mushroom', '#e4dccc', 'stem', { drop: null });
const cap = (key, name, color) => def(key, name, { solid: false, platform: true, hard: 1, tool: 'axe', resist: 1, drop: null, clear: true, color, pattern: 'cap', natural: true, cap: true });
export const RED_CAP = cap('red_cap', 'Red mushroom cap', '#c8323a');
export const BROWN_CAP = cap('brown_cap', 'Brown mushroom cap', '#9a7656');
// The ground: under spruces, on the savanna, in mushroom fields; moss on forest floors; and
// what lies on it: mossy boulders, fallen logs, pumpkins.
export const PODZOL = def('podzol', 'Podzol', { hard: 2, resist: 0, drop: 'dirt', color: '#7a5a2c', dark: '#5b4129', pattern: 'grass', natural: true });
export const DRY_GRASS = def('dry_grass', 'Dry grass', { hard: 2, resist: 0, drop: 'dirt', color: '#b4a452', dark: '#7a5636', pattern: 'grass', natural: true });
export const MYCELIUM = def('mycelium', 'Mycelium', { hard: 2, resist: 0, drop: 'dirt', color: '#8a7a92', dark: '#5b4129', pattern: 'grass', natural: true });
export const MOSS = def('moss', 'Moss', { hard: 1, resist: 0, color: '#4f8a34', pattern: 'moss', natural: true });
export const MOSSY_COBBLE = def('mossy_cobblestone', 'Mossy cobblestone', { hard: 5, resist: 10, color: '#7a8a6a', pattern: 'cobble', natural: true });
export const FALLEN_LOG = def('fallen_log', 'Fallen log', { hard: 3, tool: 'axe', resist: 2, drop: 'wood', wood: true, color: '#6a4a30', pattern: 'fallen', natural: true });
export const PUMPKIN = def('pumpkin', 'Pumpkin', { hard: 1, tool: 'axe', resist: 1, color: '#e0861e', pattern: 'pumpkin', natural: true });
// Plants (walked through, broken by anything).
const plant = (key, name, color, pattern, o = {}) => def(key, name, { solid: false, hard: 0, tool: 'hand', resist: 0, drop: null, clear: true, color, pattern, natural: true, ...o });
export const FERN = plant('fern', 'Fern', '#3f7a3a', 'fern');
export const BUSH = plant('bush', 'Bush', '#3a7232', 'bush');
export const BERRY_BUSH = plant('berry_bush', 'Berry bush', '#36602c', 'berries', { drop: 'berries' });
export const DRY_TALL_GRASS = plant('dry_tall_grass', 'Dry grass', '#c8b462', 'blades');
export const BAMBOO = plant('bamboo', 'Bamboo', '#7ab040', 'bamboo', { tool: 'axe', hard: 1 });
export const PETALS = plant('petals', 'Fallen petals', '#f4b0cc', 'petals');
// ---- A sail (worlds made since capitals: boats in harbours): cloth, walked through.
export const SAIL = def('sail', 'Sail', { solid: false, hard: 1, tool: 'hand', resist: 0, drop: null, clear: true, color: '#efe6d2', pattern: 'sail' });

// ---- Flowing water (tileworld.js's flow: Minecraft's way) -----------------------------------------
// What runs out of a source: flowing water along the ground, a level less with each tile it goes
// (7 beside its source, down to 1 at its far edge: drawn shallower and shallower, its top sloping
// down to its edge), and falling water, a column down to wherever it lands. Never dug, blasted or
// made by the land: only ever what's flowed (and dries up again when what fed it is gone).
const flowing = n => def(`water_${n}`, 'Flowing water', wet({ tool: 'none', tier: 9, resist: 999, color: '#2f6fd0', pattern: 'water', amount: n, source: false }));
/** Flowing water by its level (1 to 7; [0]: none). */
export const WATER_FLOW = [AIR, flowing(1), flowing(2), flowing(3), flowing(4), flowing(5), flowing(6), flowing(7)];
export const WATER_FALL = def('water_fall', 'Falling water', wet({ tool: 'none', tier: 9, resist: 999, color: '#2f6fd0', pattern: 'water', source: false, falling: true }));

/** The gem blocks (they glint). */
export const GEMS = new Set([RUBY, SAPPHIRE, EMERALD, TOPAZ, AMETHYST, DIAMOND]);

export const BLOCKS = B;
export const BLOCK_BY_KEY = new Map(B.map(b => [b.key, b]));
export const blockId = key => BLOCK_BY_KEY.get(key)?.id ?? AIR;

// Fast lookups by number, for the collision code (worlds ask millions of times).
export const SOLID = Uint8Array.from(B, b => (b.solid ? 1 : 0));
export const PLATFORMS = Uint8Array.from(B, b => (b.platform ? 1 : 0));
export const LIGHT = Uint8Array.from(B, b => b.light);
// Light passes through (air, glass, plants, torches): else a block lets a little in at its face.
export const CLEAR = Uint8Array.from(B, b => (b.clear || !b.solid ? 1 : 0));
// Water, and what's in it: swum in, drawn under water, flowed out of.
export const LIQUID = Uint8Array.from(B, b => (b.liquid ? 1 : 0));

// ---- Fluids (tileworld.js's flow) -------------------------------------------------------------------
// Each kind of fluid: its source, its flowing blocks by level, its falling one; how much it drops
// a tile (levels), how far ahead it looks for a way down (tiles), how many of the flow's waves it
// takes a step (1: every one), and whether two sources make another between them (on something).
// Only water, so far.
export const FLUIDS = [null, { key: 'water', source: WATER, flow: WATER_FLOW, fall: WATER_FALL, drop: 1, reach: 4, every: 1, renew: true }];
/** Which fluid each block is (an index into FLUIDS; 0: none). What grows in water is water, a source. */
export const FLUID = Uint8Array.from(B, b => (b.fluid ? FLUIDS.findIndex(f => f?.key === b.fluid) : 0));
/** How much of it a block is: 8, a source or falling; flowing, its level (7 to 1). */
export const AMOUNT = Uint8Array.from(B, b => (b.fluid ? b.amount || 8 : 0));
export const SOURCE = Uint8Array.from(B, b => (b.source ? 1 : 0));
export const FALLING = Uint8Array.from(B, b => (b.falling ? 1 : 0));
/** A fluid's own blocks (not what grows in it): drawn over everything, each frame (worldrender.js's drawWater). */
export const PURE = Uint8Array.from(B, b => (b.fluid && b.pattern === 'water' ? 1 : 0));
/** All water's own blocks: still, flowing at each level, falling. */
export const WATERS = B.filter(b => b.fluid === 'water' && b.pattern === 'water').map(b => b.id);
// Where flowing water runs: into the open, and washing away small plants and torches (dropped,
// as broken: worldplay.js). Anything else holds it back.
const WASHED = new Set([TALL_GRASS, FLOWER, DEAD_BUSH, MUSHROOM, WHEAT, TORCH, FERN, BUSH, BERRY_BUSH, DRY_TALL_GRASS, PETALS]);
export const WASH = Uint8Array.from(B, b => (b.id === AIR || WASHED.has(b.id) ? 1 : 0));
/** How slippery each block is underfoot (0 to 1: ice). */
export const SLIP = Float32Array.from(B, b => b.slip || 0);
/**
 * How full of fluid tile id is (0 to 1: its top, from the bottom of the tile), with `above` (the
 * block over it): a source, falling water, or any with more of it above, full; flowing, by its
 * level ((level + 1) / 9). Not a fluid: 0.
 */
export function fluidHeight(id, above) {
  const f = FLUID[id];
  if (!f) return 0;
  if (AMOUNT[id] >= 8 || FLUID[above] === f) return 1;
  return (AMOUNT[id] + 1) / 9;
}
/** Trees' trunks (felled whole), their leaves (and the like: a crown), and giant mushrooms' caps. */
export const TRUNKS = new Set([TRUNK, ...B.filter(b => b.trunk).map(b => b.id)]);
export const LEAVES_ALL = new Set([LEAVES, PINE_LEAVES, JUNGLE_LEAVES, ...B.filter(b => b.leaf).map(b => b.id)]);
export const CAPS = new Set(B.filter(b => b.cap).map(b => b.id));

// ---- Walls: the layer behind (dug-out caves keep theirs; rooms are walled in) ----------------
const W = [];
const wall = (key, name, color, o = {}) => { W.push({ id: W.length, key, name, color, drop: key, natural: false, ...o }); return W.length - 1; };
export const NO_WALL = wall('none', 'No wall', null, { drop: null });
export const DIRT_WALL = wall('dirt_wall', 'Dirt wall', '#4a3524', { natural: true });
export const STONE_WALL = wall('stone_wall', 'Stone wall', '#4b4d52', { natural: true });
export const SLATE_WALL = wall('slate_wall', 'Slate wall', '#33363c', { natural: true });
export const SANDSTONE_WALL = wall('sandstone_wall', 'Sandstone wall', '#8c7448', { natural: true });
export const ICE_WALL = wall('ice_wall', 'Ice wall', '#6a8ea4', { natural: true });
export const MUD_WALL = wall('mud_wall', 'Mud wall', '#3a2e24', { natural: true });
export const BASALT_WALL = wall('basalt_wall', 'Basalt wall', '#262226', { natural: true });
export const CLAY_WALL = wall('clay_wall', 'Clay wall', '#7a4632', { natural: true });
export const PLANK_WALL = wall('plank_wall', 'Plank wall', '#6e5236');
export const BRICK_WALL = wall('brick_wall', 'Brick wall', '#6a3a30');
export const STONE_BRICK_WALL = wall('stone_brick_wall', 'Stone brick wall', '#55585e');
export const GLASS_WALL = wall('glass_wall', 'Glass wall', '#7e98a4');
export const SANDSTONE_BRICK_WALL = wall('sandstone_brick_wall', 'Sandstone brick wall', '#8e7650');
export const PLASTER_WALL = wall('plaster_wall', 'Plaster wall', '#cfc5ad');
export const TIMBER_WALL = wall('timber_wall', 'Timber-framed wall', '#d3c7ab');
export const LOG_WALL = wall('log_wall', 'Log wall', '#6a4a2c');
export const COBBLE_WALL = wall('cobble_wall', 'Cobblestone wall', '#5f5e5a');
export const MUD_BRICK_WALL = wall('mud_brick_wall', 'Mud brick wall', '#6b4a32');
export const WALLS = W;
export const WALL_BY_KEY = new Map(W.map(w => [w.key, w]));

// ---- Shapes: hit with the hammer, a block becomes a half block or a slope -------------------------
// Each shape's solid parts, in sixteenths of the tile: [left, top, right, bottom]. A slope is a
// two-step stair (stepped up as a ledge: half a block is less than a soldier steps up), drawn
// as the ramp it stands for.
export const SHAPES = [
  { key: 'full', name: 'Full', boxes: [[0, 0, 16, 16]] },
  { key: 'bottom', name: 'Half (low)', boxes: [[0, 8, 16, 16]] },
  { key: 'top', name: 'Half (high)', boxes: [[0, 0, 16, 8]] },
  { key: 'rampR', name: 'Ramp up to the right', boxes: [[0, 8, 16, 16], [8, 0, 16, 8]] },
  { key: 'rampL', name: 'Ramp up to the left', boxes: [[0, 8, 16, 16], [0, 0, 8, 8]] },
  { key: 'ceilR', name: 'Ceiling ramp, right', boxes: [[0, 0, 16, 8], [8, 8, 16, 16]] },
  { key: 'ceilL', name: 'Ceiling ramp, left', boxes: [[0, 0, 16, 8], [0, 8, 8, 16]] },
];
