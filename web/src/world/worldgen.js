// Making a world from its seed (world mode): biomes side by side along the surface, hills,
// mountains, dunes and mesas, soil and rock in layers going down, caves and tunnels, ores
// by depth, trees and plants, ruins on the surface and cabins underground. Worlds made since
// seas (gen 4): seas between the lands (their floors of sand, gravel and clay, kelp and seagrass,
// coral reefs in warm seas, ice over cold ones, shipwrecks), beaches, lakes, and swamps full of
// pools with reeds and lily pads.
//
// Every tile is worked out from the seed and its own position only, so any chunk can be made
// on its own, in any order, and comes out the same every time and on every machine (noise.js).
// Worlds are endless sideways (as far as anyone will ever go) and WORLD_H tiles deep.

import { hash3, rand3, noise2, fbm1, fbm2 } from './noise.js';
import * as K from './blocks.js';
import { planTown, buildTown, hasTowns, TOWN_RAMP, BELOW as TOWN_BELOW } from './towns.js';

export const CHUNK = 32;            // tiles each side of a chunk
export const WORLD_H = 512;         // tiles from the top of the sky to the bottom of the bedrock
export const HALF_W = 32768;        // tiles either side of the middle (half a million pixels)
export const SURFACE = 160;         // where the ground usually is (tiles from the top)
export const DEEP = 360;            // slate from here down
export const UNDERWORLD = 468;      // basalt and magma from here down

const REGION = 320, JITTER = 96, BLEND = 40;
// Worlds made since seas (gen 4). The sea's top row; its height (tiles above the usual surface);
// how far either side of an edge between sea and land their heights blend (a gentler slope than
// between two lands); how far into the land the shore always is (the land's above the sea from
// there: see coastLift); how often regions are sea (a slow noise over them, above this).
export const SEA_ROW = SURFACE + 6;
const SEA_H = SURFACE - SEA_ROW, SEA_BLEND = 90, SHORE = 32, SEA_NOISE = 0.2;
// Worlds made since capitals (gen 6): how likely (in a hundred) an even region starts a capital.
const CAPITAL_CHANCE = 24;
// Lakes (one in some of the cells LAKE_CELL tiles across) and pools (POOL_CELL: swamps are full of
// them): how likely in each biome [a lake, a pool].
const LAKE_CELL = 170, POOL_CELL = 44;
const LAKE_CHANCE = { plains: [0.5, 0.06], forest: [0.45, 0.08], mountains: [0.2, 0], desert: [0.15, 0], jungle: [0.35, 0.2], snow: [0.4, 0.04], swamp: [0.6, 0.9] };
// Worlds made since veins (oreVeins): diamond pipes and geodes, how high they come, and the gems.
const PIPE_CELL = 420, PIPE_TOP = 290, GEODE_TOP = 360, HOLLOW = -2;
const GEM_ORES = [K.RUBY, K.SAPPHIRE, K.EMERALD, K.TOPAZ, K.AMETHYST];
// How thick each kind's veins are (how near nothing their noise must be).
const VEIN = { coal: 0.045, copper: 0.04, iron: 0.044, silver: 0.038, gold: 0.026 };

/**
 * The biomes. climate: 0 cold, 1 mild, 2 hot (neighbours tend to share one). Heights are in
 * tiles above (negative: below) the usual surface; scale: tiles per hill.
 */
export const BIOMES = [
  { key: 'plains', name: 'Plains', climate: 1, base: 0, amp: 13, scale: 150, shape: 'rolling', top: K.GRASS, soil: K.DIRT, soilDepth: 5, wall: K.DIRT_WALL, trees: 0.07, tree: 'oak', plants: 0.4, flowers: 0.14 },
  { key: 'forest', name: 'Forest', climate: 1, base: 3, amp: 17, scale: 110, shape: 'rolling', top: K.GRASS, soil: K.DIRT, soilDepth: 6, wall: K.DIRT_WALL, trees: 0.6, tree: 'oak', plants: 0.3, flowers: 0.05 },
  { key: 'mountains', name: 'Mountains', climate: 1, base: 36, amp: 44, scale: 64, shape: 'ridged', top: K.STONE, soil: K.STONE, soilDepth: 1, wall: K.STONE_WALL, trees: 0.1, tree: 'pine', plants: 0.05, flowers: 0 },
  { key: 'desert', name: 'Desert', climate: 2, base: -4, amp: 11, scale: 70, shape: 'dunes', top: K.SAND, soil: K.SAND, soilDepth: 8, under: K.SANDSTONE, wall: K.SANDSTONE_WALL, trees: 0.12, tree: 'cactus', plants: 0.08, plant: K.DEAD_BUSH, flowers: 0 },
  { key: 'badlands', name: 'Badlands', climate: 2, base: 18, amp: 20, scale: 56, shape: 'mesa', top: K.RED_SAND, soil: K.RED_SAND, soilDepth: 2, under: 'bands', wall: K.CLAY_WALL, trees: 0.04, tree: 'cactus', plants: 0.05, plant: K.DEAD_BUSH, flowers: 0 },
  { key: 'jungle', name: 'Jungle', climate: 2, base: 5, amp: 21, scale: 70, shape: 'rolling', top: K.JUNGLE_GRASS, soil: K.MUD, soilDepth: 11, wall: K.MUD_WALL, trees: 0.7, tree: 'jungle', plants: 0.65, flowers: 0.08 },
  { key: 'snow', name: 'Tundra', climate: 0, base: 6, amp: 18, scale: 95, shape: 'rolling', top: K.SNOW, soil: K.SNOW, soilDepth: 4, under: 'ice', wall: K.ICE_WALL, trees: 0.32, tree: 'pine', plants: 0, flowers: 0 },
  // Worlds made since seas (gen 4): the seas (cold ones iced over, warm ones with coral reefs), and swamps.
  { key: 'ocean', since: 4, name: 'Sea', climate: 1, base: -34, amp: 9, scale: 90, shape: 'rolling', top: K.SAND, soil: K.SAND, soilDepth: 4, wall: K.SANDSTONE_WALL, trees: 0, tree: 'oak', plants: 0, flowers: 0, sea: true },
  { key: 'warm_ocean', since: 4, name: 'Warm sea', climate: 2, base: -30, amp: 8, scale: 80, shape: 'rolling', top: K.SAND, soil: K.SAND, soilDepth: 5, wall: K.SANDSTONE_WALL, trees: 0, tree: 'oak', plants: 0, flowers: 0, sea: true, coral: true },
  { key: 'frozen_ocean', since: 4, name: 'Frozen sea', climate: 0, base: -32, amp: 9, scale: 90, shape: 'rolling', top: K.GRAVEL, soil: K.GRAVEL, soilDepth: 3, wall: K.STONE_WALL, trees: 0, tree: 'pine', plants: 0, flowers: 0, sea: true, frozen: true },
  { key: 'swamp', since: 4, name: 'Swamp', climate: 1, base: -2, amp: 4, scale: 60, shape: 'rolling', top: K.GRASS, soil: K.MUD, soilDepth: 6, wall: K.MUD_WALL, trees: 0.38, tree: 'swamp', plants: 0.55, flowers: 0.03 },
  // Worlds made since forests (gen 5): more lands (their trees and what grows under them: TREES, UNDERGROWTH).
  { key: 'birch_forest', since: 5, name: 'Birch forest', climate: 1, base: 4, amp: 15, scale: 110, shape: 'rolling', top: K.GRASS, soil: K.DIRT, soilDepth: 6, wall: K.DIRT_WALL, trees: 0.7, tree: 'birch', plants: 0.35, flowers: 0.1 },
  { key: 'dark_forest', since: 5, name: 'Dark forest', climate: 1, base: 6, amp: 14, scale: 100, shape: 'rolling', top: K.GRASS, soil: K.DIRT, soilDepth: 6, wall: K.DIRT_WALL, trees: 0.9, tree: 'dark_oak', plants: 0.3, flowers: 0.02, mossy: true },
  { key: 'taiga', since: 5, name: 'Taiga', climate: 0, base: 8, amp: 20, scale: 100, shape: 'rolling', top: K.PODZOL, soil: K.DIRT, soilDepth: 5, wall: K.DIRT_WALL, trees: 0.7, tree: 'spruce', plants: 0.3, flowers: 0.02 },
  { key: 'snowy_taiga', since: 5, name: 'Snowy taiga', climate: 0, base: 10, amp: 18, scale: 100, shape: 'rolling', top: K.SNOW, soil: K.DIRT, soilDepth: 5, wall: K.DIRT_WALL, trees: 0.6, tree: 'snowy_spruce', plants: 0.05, flowers: 0 },
  { key: 'giant_taiga', since: 5, name: 'Old spruce forest', climate: 0, base: 12, amp: 18, scale: 90, shape: 'rolling', top: K.PODZOL, soil: K.DIRT, soilDepth: 6, wall: K.DIRT_WALL, trees: 0.75, tree: 'mega_spruce', plants: 0.4, flowers: 0, mossy: true },
  { key: 'savanna', since: 5, name: 'Savanna', climate: 2, base: 3, amp: 7, scale: 160, shape: 'rolling', top: K.DRY_GRASS, soil: K.DIRT, soilDepth: 5, wall: K.DIRT_WALL, trees: 0.3, tree: 'acacia', plants: 0.6, plant: K.DRY_TALL_GRASS, flowers: 0.01 },
  { key: 'cherry_grove', since: 5, name: 'Cherry grove', climate: 1, base: 18, amp: 22, scale: 90, shape: 'rolling', top: K.GRASS, soil: K.DIRT, soilDepth: 5, wall: K.DIRT_WALL, trees: 0.55, tree: 'cherry', plants: 0.3, flowers: 0.12 },
  { key: 'meadow', since: 5, name: 'Flower meadow', climate: 1, base: 10, amp: 9, scale: 170, shape: 'rolling', top: K.GRASS, soil: K.DIRT, soilDepth: 6, wall: K.DIRT_WALL, trees: 0.08, tree: 'big_oak', plants: 0.45, flowers: 0.4 },
  { key: 'bamboo_jungle', since: 5, name: 'Bamboo jungle', climate: 2, base: 6, amp: 18, scale: 80, shape: 'rolling', top: K.JUNGLE_GRASS, soil: K.MUD, soilDepth: 9, wall: K.MUD_WALL, trees: 0.3, tree: 'jungle', plants: 0.4, flowers: 0.04 },
  { key: 'mushroom_fields', since: 5, name: 'Mushroom fields', climate: 1, base: 0, amp: 6, scale: 120, shape: 'rolling', top: K.MYCELIUM, soil: K.DIRT, soilDepth: 5, wall: K.DIRT_WALL, trees: 0.4, tree: 'giant_mushroom', plants: 0.15, plant: K.MUSHROOM, flowers: 0 },
  // Worlds made since towers (gen 7): dangerous lands (danger: monsters come by day as well as by
  // night, more of them, and worse: lairs.js), and now and then, rare crystal fields.
  { key: 'blight', since: 7, name: 'Blighted lands', climate: 1, base: 2, amp: 14, scale: 90, shape: 'rolling', top: K.BLIGHT_GRASS, soil: K.DIRT, soilDepth: 5, wall: K.DIRT_WALL, trees: 0.4, tree: 'dead', plants: 0.4, plant: K.THORNS, flowers: 0, danger: 1 },
  { key: 'ashlands', since: 7, name: 'Ashen wastes', climate: 2, base: 14, amp: 26, scale: 64, shape: 'ridged', top: K.ASH, soil: K.ASH, soilDepth: 3, under: K.BASALT, wall: K.BASALT_WALL, trees: 0.08, tree: 'charred', plants: 0.1, plant: K.DEAD_BUSH, flowers: 0, danger: 2 },
  { key: 'crystal_fields', since: 7, name: 'Crystal fields', climate: 0, base: 8, amp: 12, scale: 80, shape: 'rolling', top: K.CALCITE, soil: K.CALCITE, soilDepth: 6, wall: K.STONE_WALL, trees: 0.2, tree: 'crystal', plants: 0.08, plant: K.GLOWCAP, flowers: 0, rare: true },
];
export const BIOME_BY_KEY = new Map(BIOMES.map((b, i) => [b.key, { ...b, index: i }]));
const BY_CLIMATE = [[6, 2, 6], [0, 1, 1, 2, 0], [3, 4, 5, 3]];
const biomeIndex = key => BIOMES.findIndex(b => b.key === key);
// Worlds made since seas: the lands for each climate, and the sea.
const BY_CLIMATE_4 = [['snow', 'mountains', 'snow'], ['plains', 'forest', 'forest', 'mountains', 'plains', 'swamp'], ['desert', 'badlands', 'jungle', 'desert', 'swamp']].map(l => l.map(biomeIndex));
const SEAS = ['frozen_ocean', 'ocean', 'warm_ocean'].map(biomeIndex);
// Worlds made since forests: more lands for each climate (and, rarely, mushroom fields).
const BY_CLIMATE_5 = [
  ['snow', 'mountains', 'taiga', 'taiga', 'snowy_taiga', 'snowy_taiga', 'giant_taiga'],
  ['plains', 'forest', 'forest', 'birch_forest', 'dark_forest', 'meadow', 'cherry_grove', 'mountains', 'plains', 'swamp'],
  ['desert', 'badlands', 'jungle', 'savanna', 'savanna', 'bamboo_jungle', 'desert', 'swamp'],
].map(l => l.map(biomeIndex));
const MUSHROOMS = biomeIndex('mushroom_fields');
// Worlds made since towers: the dangerous lands (the blight in the mild and cold lands, the ashen
// wastes in the hot), and crystal fields.
const BLIGHT = biomeIndex('blight'), ASHLANDS = biomeIndex('ashlands'), CRYSTALS = biomeIndex('crystal_fields');
// A monster tower's floors: one every FLOOR_H rows (its floor, and room over it).
export const FLOOR_H = 8;
const TOWER_W = 15;

/**
 * Worlds made since forests: each biome's trees. cell: tiles to a tree at most (forests are
 * dense: a trunk every few tiles, their crowns meeting); p: how likely each cell has one;
 * clearings: thinned out in places (a slow noise); kinds: which trees, [kind, how often]. (Each
 * kind's shape: treeTile5.)
 */
const TREES = {
  plains: { cell: 7, p: 0.09, kinds: [['oak', 5], ['big_oak', 1], ['birch', 1]] },
  forest: { cell: 4, p: 0.9, clearings: true, kinds: [['oak', 6], ['big_oak', 2], ['birch', 2]] },
  birch_forest: { cell: 4, p: 0.88, clearings: true, kinds: [['birch', 6], ['tall_birch', 3], ['oak', 1]] },
  dark_forest: { cell: 4, p: 0.95, kinds: [['dark_oak', 6], ['big_oak', 2], ['giant_mushroom', 0.4]] },
  mountains: { cell: 5, p: 0.14, kinds: [['spruce', 3], ['pine', 1]] },
  taiga: { cell: 4, p: 0.85, clearings: true, kinds: [['spruce', 6], ['pine', 2]] },
  snowy_taiga: { cell: 4, p: 0.62, kinds: [['snowy_spruce', 6], ['spruce', 1]] },
  giant_taiga: { cell: 5, p: 0.8, kinds: [['mega_spruce', 4], ['spruce', 3]] },
  snow: { cell: 5, p: 0.28, kinds: [['snowy_spruce', 2], ['pine', 1]] },
  desert: { cell: 5, p: 0.12, kinds: [['cactus', 1]] },
  badlands: { cell: 5, p: 0.04, kinds: [['cactus', 1]] },
  jungle: { cell: 4, p: 0.9, kinds: [['jungle', 5], ['big_jungle', 1]] },
  bamboo_jungle: { cell: 6, p: 0.25, kinds: [['jungle', 1]] },
  savanna: { cell: 8, p: 0.34, kinds: [['acacia', 1]] },
  cherry_grove: { cell: 5, p: 0.58, kinds: [['cherry', 1]] },
  meadow: { cell: 9, p: 0.1, kinds: [['big_oak', 1], ['birch', 1]] },
  swamp: { cell: 5, p: 0.4, kinds: [['swamp', 1]] },
  mushroom_fields: { cell: 7, p: 0.42, kinds: [['giant_mushroom', 1]] },
  // (Worlds made since towers.)
  blight: { cell: 6, p: 0.55, kinds: [['dead', 3], ['blight_oak', 2]] },
  ashlands: { cell: 12, p: 0.3, kinds: [['charred', 1]] },
  crystal_fields: { cell: 8, p: 0.5, kinds: [['crystal', 1]] },
};
// How far each kind of tree reaches either side of its trunk (tiles); the most any does.
const TREE_REACH = { oak: 4, big_oak: 7, birch: 3, tall_birch: 3, dark_oak: 7, spruce: 4, snowy_spruce: 4, mega_spruce: 6, pine: 4, jungle: 5, big_jungle: 7, swamp: 4, cactus: 2, acacia: 8, cherry: 5, palm: 8, giant_mushroom: 5, dead: 3, blight_oak: 4, charred: 2, crystal: 2 };
const TREE_MAX_REACH = 8;

/**
 * Worlds made since forests: what grows under the trees, in each biome: p, how likely a tile of
 * ground has something; list, what, [block, how often]; patches: flowers come in patches (a slow noise).
 */
const UNDERGROWTH = {
  plains: { p: 0.5, patches: true, list: [[K.TALL_GRASS, 8], [K.FLOWER, 2], [K.BUSH, 0.4], [K.PUMPKIN, 0.08]] },
  forest: { p: 0.62, list: [[K.TALL_GRASS, 4], [K.FERN, 3], [K.BUSH, 2], [K.FLOWER, 0.6], [K.BERRY_BUSH, 0.4], [K.MUSHROOM, 0.15]] },
  birch_forest: { p: 0.5, patches: true, list: [[K.TALL_GRASS, 5], [K.FLOWER, 2.5], [K.BUSH, 0.8], [K.FERN, 0.8]] },
  dark_forest: { p: 0.58, list: [[K.FERN, 5], [K.BUSH, 3], [K.MUSHROOM, 1], [K.TALL_GRASS, 2]] },
  taiga: { p: 0.55, list: [[K.FERN, 6], [K.TALL_GRASS, 2], [K.BERRY_BUSH, 1], [K.BUSH, 0.6]] },
  snowy_taiga: { p: 0.08, list: [[K.FERN, 2], [K.BERRY_BUSH, 1]] },
  giant_taiga: { p: 0.62, list: [[K.FERN, 7], [K.BERRY_BUSH, 1], [K.BUSH, 1], [K.MUSHROOM, 0.3]] },
  savanna: { p: 0.66, list: [[K.DRY_TALL_GRASS, 8], [K.TALL_GRASS, 1], [K.FLOWER, 0.2], [K.BUSH, 0.3]] },
  cherry_grove: { p: 0.58, list: [[K.PETALS, 5], [K.TALL_GRASS, 3], [K.FLOWER, 1]] },
  meadow: { p: 0.86, patches: true, list: [[K.FLOWER, 5], [K.TALL_GRASS, 5], [K.BUSH, 0.3]] },
  jungle: { p: 0.76, list: [[K.TALL_GRASS, 4], [K.FERN, 3], [K.BUSH, 3], [K.FLOWER, 0.6]] },
  bamboo_jungle: { p: 0.5, list: [[K.FERN, 4], [K.TALL_GRASS, 3], [K.BUSH, 2]] },
  swamp: { p: 0.56, list: [[K.TALL_GRASS, 6], [K.FERN, 2], [K.MUSHROOM, 0.3]] },
  mushroom_fields: { p: 0.16, list: [[K.MUSHROOM, 1]] },
  desert: { p: 0.08, list: [[K.DEAD_BUSH, 1]] },
  badlands: { p: 0.05, list: [[K.DEAD_BUSH, 1]] },
  mountains: { p: 0.05, list: [[K.TALL_GRASS, 1]] },
  // (Worlds made since towers.)
  blight: { p: 0.42, list: [[K.THORNS, 4], [K.DEAD_BUSH, 3], [K.GLOWCAP, 1.2], [K.TALL_GRASS, 1]] },
  ashlands: { p: 0.1, list: [[K.DEAD_BUSH, 1]] },
  crystal_fields: { p: 0.08, list: [[K.GLOWCAP, 1]] },
};
// Where fallen logs lie, and boulders sit (worlds made since forests): the biomes.
const LOGS = new Set(['forest', 'birch_forest', 'dark_forest', 'taiga', 'giant_taiga', 'jungle']);
const BOULDERS = new Set(['taiga', 'giant_taiga', 'dark_forest', 'forest', 'mountains', 'snowy_taiga', 'meadow']);
// The ground's top blocks things grow on.
const GROUNDS = new Set([K.GRASS, K.JUNGLE_GRASS, K.PODZOL, K.DRY_GRASS, K.MYCELIUM, K.MOSS, K.SAND, K.RED_SAND, K.SNOW, K.STONE, K.BLIGHT_GRASS, K.ASH, K.CALCITE]);

// Monster towers' names: Raven Spire, the Black Keep...
const TOWER_A = ['Raven', 'Bone', 'Storm', 'Grim', 'Hollow', 'Iron', 'Thorn', 'Dusk', 'Ash', 'Wolf', 'Crow', 'Ember', 'Gloom', 'Widow'];
const TOWER_B = ['Spire', 'Tower', 'Keep', 'Watch', 'Fang', 'Hold', 'Needle', 'Tooth'];
const DARK = ['Black', 'Blighted', 'Burning', 'Cursed', 'Howling', 'Forsaken'];
/** Tower k's name (a dangerous land's: darker). */
function towerName(seed, k, danger) {
  const a = (danger ? DARK : TOWER_A)[hash3(seed, k, 240) % (danger ? DARK.length : TOWER_A.length)], b = TOWER_B[hash3(seed, k, 241) % TOWER_B.length];
  return danger ? `The ${a} ${b}` : `${a} ${b}`;
}

/** Pick from [[thing, how often], ...] by r (0 to 1). */
function pick(list, r) {
  let sum = 0;
  for (const e of list) sum += e[1];
  let t = r * sum;
  for (const e of list) { t -= e[1]; if (t < 0) return e[0]; }
  return list[list.length - 1][0];
}

/** The world's ruins and cabins: { kind, x0, y0, x1, y1 (tiles, inclusive), ... }. */
const RUIN_CELL = 240, CABIN_W = 160, CABIN_H = 96;

export class WorldGen {
  /**
   * gen: the version of the generator the world was made with (worldsave.js's WORLD_GEN): 1 the
   * first; 2 has towns (towns.js); 3 ores in veins and nodes, gems, diamond pipes and geodes;
   * 4 seas, beaches, lakes and swamps; 5 more biomes, dense forests and many more kinds of tree;
   * 6 capitals and harbours; 7 dangerous lands, crystal fields, sky islands and monster towers.
   * Worlds keep the land they were made with. (towns: true, an older way to say 2.)
   */
  constructor(seed, { towns = false, gen = 0, noTowns = false } = {}) {
    this.seed = seed | 0;
    this.version = gen || (towns ? 2 : 1);
    // (A world made without towns, by its settings: worldrules.js.)
    this.towns = this.version >= 2 && !noTowns;
    this.veins = this.version >= 3;
    this.seas = this.version >= 4;
    this.forests = this.version >= 5;
    this.capitals = this.version >= 6;
    this.wilds = this.version >= 7;
    this.towerPlans = new Map(); // region -> its monster tower (or null)
    this.isles = new Map();      // region -> its sky island (or null)
    this.caps = new Map();      // region -> whether a capital starts there
    this.raw = new Map();       // region -> its own biome (before a capital takes it over)
    this.biomes = new Map();    // region -> its biome
    this.spans = new Map();     // sea region -> the sea it's part of (seaSpan)
    this.lakes = new Map();     // lake cell -> its lake (or null)
    this.pools = new Map();     // pool cell -> its pool (or null)
    this.wrecks = new Map();    // sea region -> its shipwreck (or null)
    this.townPlans = new Map(); // region -> its town (or null)
    this.townRasters = new Map(); // town id -> its blocks (a few kept)
    this.columns = new Map(); // x -> column (kept for a while: chunks above and below ask too)
    this.spawnRegion = this.regionAt(0);
    // (With towns, the region where everyone starts is always wide: room for its village beside the start.)
    this.wideStart = this.towns;
    // Everyone starts in the middle of the plains there: well away from the next biome's hills.
    this.spawnX = Math.floor((this.edge(this.spawnRegion) + this.edge(this.spawnRegion + 1)) / 2);
  }

  // ---- Biomes and the surface --------------------------------------------------------------

  /** Where region k starts (tiles). */
  edge(k) {
    const e = k * REGION + Math.floor((rand3(this.seed, k, 3) - 0.5) * 2 * JITTER);
    if (this.wideStart) {
      if (k === this.spawnRegion) return Math.min(e, k * REGION - 50);
      if (k === this.spawnRegion + 1) return Math.max(e, k * REGION + 50);
    }
    return e;
  }

  /** The region column x is in. */
  regionAt(x) {
    const k = Math.floor(x / REGION);
    if (x < this.edge(k)) return k - 1;
    if (x >= this.edge(k + 1)) return k + 1;
    return k;
  }

  /**
   * Region k's biome (the one around the middle of the world is always plains: where everyone
   * starts). Worlds made since seas: some are sea (never next to where everyone starts), of the
   * climate there.
   */
  regionBiome(k) {
    let b = this.biomes.get(k);
    if (b) return b;
    // (Worlds made since capitals: a capital's second region is of its first's biome.)
    b = this.capitals && this.capitalStart(k - 1) ? this.rawBiome(k - 1) : this.rawBiome(k);
    if (this.biomes.size > 512) this.biomes.clear();
    this.biomes.set(k, b);
    return b;
  }

  /**
   * Whether a capital starts in region k (worlds made since capitals): now and then, an even
   * region, its biome and the next's land with towns, well away from where everyone starts. It
   * takes both regions (towns.js's planCapital).
   */
  capitalStart(k) {
    if (!this.capitals || !this.towns || k & 1) return false;
    let c = this.caps.get(k);
    if (c !== undefined) return c;
    const ok = j => !this.rawBiome(j).sea && !this.rawBiome(j + 1).sea && hasTowns(this.rawBiome(j).key) && Math.abs(j - this.spawnRegion) > 3;
    // (One always near where everyone starts: the first even region that can have one, either way.)
    if (this.nearCapital === undefined) {
      this.nearCapital = null;
      for (let d = 4; d <= 30 && this.nearCapital === null; d++) for (const j of [this.spawnRegion + d, this.spawnRegion - d]) if (this.nearCapital === null && !(j & 1) && ok(j)) this.nearCapital = j;
    }
    // (Never two side by side: not after another by chance.)
    const chance = j => hash3(this.seed, j, 430) % 100 < CAPITAL_CHANCE && ok(j);
    c = ok(k) && (k === this.nearCapital || (chance(k) && !chance(k - 2) && k - 2 !== this.nearCapital));
    if (this.caps.size > 512) this.caps.clear();
    this.caps.set(k, c);
    return c;
  }

  /** Region k's own biome (regionBiome: unless a capital's taken it over). */
  rawBiome(k) {
    let b = this.raw.get(k);
    if (b) return b;
    if (k === this.spawnRegion) b = BIOMES[0];
    else {
      const t = fbm1(this.seed + 11, k * 0.31, 2);
      const climate = t < -0.22 ? 0 : t > 0.22 ? 2 : 1;
      if (this.seas && Math.abs(k - this.spawnRegion) > 1 && fbm1(this.seed + 13, k * 0.2, 2) > SEA_NOISE) b = BIOMES[SEAS[climate]];
      // (Worlds made since forests: now and then, mushroom fields, in the mild lands away from the start.)
      else if (this.forests && climate === 1 && Math.abs(k - this.spawnRegion) > 3 && hash3(this.seed, k, 7) % 100 < 3) b = BIOMES[MUSHROOMS];
      // (Worlds made since towers: dangerous lands now and then, well away from the start; rarer,
      // crystal fields, in the mild and cold lands.)
      else if (this.wilds && Math.abs(k - this.spawnRegion) > 4 && hash3(this.seed, k, 17) % 100 < 8) b = BIOMES[climate === 2 ? ASHLANDS : BLIGHT];
      else if (this.wilds && climate !== 2 && Math.abs(k - this.spawnRegion) > 6 && hash3(this.seed, k, 19) % 100 < 3) b = BIOMES[CRYSTALS];
      else {
        const list = (this.forests ? BY_CLIMATE_5 : this.seas ? BY_CLIMATE_4 : BY_CLIMATE)[climate];
        b = BIOMES[list[hash3(this.seed, k, 5) % list.length]];
      }
    }
    if (this.raw.size > 512) this.raw.clear();
    this.raw.set(k, b);
    return b;
  }

  /** How high biome b's ground is at column x (tiles above the usual surface). */
  height(b, x) {
    const s = this.seed + b.climate * 101 + b.amp;
    const n = fbm1(s, x / b.scale, 4);
    switch (b.shape) {
      case 'ridged': {
        // Peaks: the noise folded over, sharper at the top, with rougher noise on it.
        const r = 1 - Math.abs(n);
        return b.base - b.amp * 0.5 + b.amp * r * r + fbm1(s + 7, x / 18, 2) * 4;
      }
      case 'mesa': {
        // Flat tops and steep sides: the height in steps, smoothed only near each step.
        const h = b.base + b.amp * n, step = 7, lo = Math.floor(h / step) * step, f = (h - lo) / step;
        return lo + step * (f > 0.82 ? (f - 0.82) / 0.18 : 0);
      }
      case 'dunes': {
        const d = fbm1(s + 3, x / 26, 2);
        return b.base + b.amp * n + Math.abs(d) * 6;
      }
      default: return b.base + b.amp * n;
    }
  }

  /**
   * The land's own height at column x (tiles above the usual surface), before any town levels
   * it: the biome's hills, rising and falling slowly with the whole land, and near an edge the
   * neighbouring biome's leaning in (half each right at the edge).
   */
  naturalHeight(x, k = this.regionAt(x)) {
    const land = fbm1(this.seed + 99, x / 1400, 3) * 16;
    if (this.seas) return this.naturalHeight4(x, k, land);
    let h = this.height(this.regionBiome(k), x) + land;
    const dl = x - this.edge(k), dr = this.edge(k + 1) - 1 - x;
    if (dl < BLEND) h = mix(this.height(this.regionBiome(k - 1), x) + land, h, 0.5 + 0.5 * dl / BLEND);
    else if (dr < BLEND) h = mix(this.height(this.regionBiome(k + 1), x) + land, h, 0.5 + 0.5 * dr / BLEND);
    return h;
  }

  /**
   * naturalHeight in worlds made since seas: the sea floor rising and falling less with the
   * whole land; between sea and land the heights blend over a wider stretch (a gentle slope down
   * into the sea), from both sides at once where a region's narrow; and the land rising out of
   * the sea not far in (coastLift).
   */
  naturalHeight4(x, k, land) {
    const b = this.regionBiome(k), bl = this.regionBiome(k - 1), br = this.regionBiome(k + 1);
    const hOf = o => this.height(o, x) + (o.sea ? land * 0.3 : land);
    const dl = x - this.edge(k), dr = this.edge(k + 1) - 1 - x;
    const wl = bl.sea !== b.sea ? SEA_BLEND : BLEND, wr = br.sea !== b.sea ? SEA_BLEND : BLEND;
    // (Each neighbour's share: half right at the edge, none from its blend's width in.)
    const sl = dl < wl ? 1 - smooth(0.5 + 0.5 * dl / wl) : 0, sr = dr < wr ? 1 - smooth(0.5 + 0.5 * dr / wr) : 0;
    let h = hOf(b) * (1 - sl - sr);
    if (sl) h += hOf(bl) * sl;
    if (sr) h += hOf(br) * sr;
    if (b.sea || (!bl.sea && !br.sea)) return h;
    return coastLift(h, Math.min(bl.sea ? dl : Infinity, br.sea ? dr : Infinity));
  }

  /** The ground's row for height h (and back). */
  surfaceRow(h) { return Math.max(24, Math.min(DEEP - 40, SURFACE - Math.round(h))); }
  heightOfRow(row) { return SURFACE - row; }

  /** Column x: { surf (the top ground tile's row), biome, soilDepth, town (if it's in one, or on its ramps) }, worked out once. */
  column(x) {
    let c = this.columns.get(x);
    if (c) return c;
    const k = this.regionAt(x), b = this.regionBiome(k);
    const start = this.edge(k), end = this.edge(k + 1);
    let h = this.naturalHeight(x, k);
    // A town levels the land under it, which comes to its level over the ramps either side.
    let town = this.townOf(k);
    if (town && x >= town.x0 - TOWN_RAMP && x <= town.x1 + TOWN_RAMP) {
      if (x < town.x0) h = mix(h, town.h, (x - (town.x0 - TOWN_RAMP)) / TOWN_RAMP);
      else if (x > town.x1) h = mix(h, town.h, (town.x1 + TOWN_RAMP - x) / TOWN_RAMP);
      else h = town.h;
    } else town = null;
    // Biomes meet along a ragged line, not a straight one.
    const dl = x - start, dr = end - 1 - x;
    const own = dl < 3 && rand3(this.seed, x, 9) < 0.5 ? this.regionBiome(k - 1) : dr < 3 && rand3(this.seed, x, 9) < 0.5 ? this.regionBiome(k + 1) : b;
    let surf = this.surfaceRow(h);
    // Worlds made since seas: a lake's bowl, dug into the land (never in a town).
    const lake = this.seas && !town ? this.lakeAt(x) : null;
    if (lake) surf = Math.max(surf, lake.level + 1 + Math.round(lake.depth * (1 - ((x - lake.mid) / lake.w) ** 2)));
    c = { surf, biome: own, soilDepth: own.soilDepth + (hash3(this.seed, x, 13) % 3), town, lake };
    if (this.columns.size > 6000) this.columns.clear();
    this.columns.set(x, c);
    return c;
  }

  surfaceAt(x) { return this.column(x).surf; }
  biomeAt(x) { return this.column(x).biome; }

  // ---- Seas and lakes (worlds made since seas) -----------------------------------------------

  /**
   * The sea that region k is part of: { x0, x1 (its first and last columns under water), biome },
   * or null (not a sea). Worked out once: from the middle of the region out each way, as far as the
   * ground's under the sea's top (into the land either side a little: coastLift sees to that; and
   * on through a sea next to it).
   */
  seaSpan(k) {
    if (!this.seas) return null;
    const b = this.regionBiome(k);
    if (!b.sea) return null;
    let sp = this.spans.get(k);
    if (sp) return sp;
    const mid = Math.floor((this.edge(k) + this.edge(k + 1)) / 2);
    let a = mid, z = mid;
    while (this.column(a - 1).surf > SEA_ROW) a--;
    while (this.column(z + 1).surf > SEA_ROW) z++;
    sp = { x0: a, x1: z, biome: b, k };
    if (this.spans.size > 64) this.spans.clear();
    this.spans.set(k, sp);
    return sp;
  }

  /** The sea column x is in (its own region's, if that's a sea: one sea's regions can be of different climates), or null. */
  seaAt(x) {
    if (!this.seas) return null;
    const k = this.regionAt(x);
    for (const j of [k, k - 1, k + 1]) {
      const sp = this.seaSpan(j);
      if (sp && x >= sp.x0 && x <= sp.x1) return sp;
    }
    return null;
  }

  /**
   * The top row of the water over column x (a sea's or a lake's), or WORLD_H: none. With it, the
   * column's bed (what the ground's made of under water, and on a beach): { top, soil, depth, under }.
   */
  waterTop(x, c = this.column(x)) {
    if (c.water !== undefined) return c.water;
    c.water = WORLD_H;
    c.bed = null;
    if (!this.seas) return c.water;
    const s = this.seed;
    if (c.lake) {
      const L = c.lake, key = L.biome;
      c.water = L.level;
      c.bed = key === 'swamp' || key === 'jungle' ? { top: K.MUD, soil: K.MUD, depth: 4 }
        : key === 'desert' ? { top: K.SAND, soil: K.SAND, depth: 4, under: K.SANDSTONE }
        : key === 'snow' || key === 'mountains' ? { top: K.GRAVEL, soil: K.GRAVEL, depth: 3 }
        : Math.abs(x - L.mid) >= L.w - 3 ? { top: K.SAND, soil: K.SAND, depth: 3 } : { top: K.CLAY, soil: K.DIRT, depth: 3 };
      return c.water;
    }
    const sp = this.seaAt(x);
    if (sp) {
      c.water = SEA_ROW;
      const deep = c.surf - SEA_ROW, n = noise2(s + 70, x / 40, 0.5);
      c.bed = sp.biome.frozen ? { top: deep < 6 ? K.SAND : K.GRAVEL, soil: K.GRAVEL, depth: 3 }
        : sp.biome.coral ? { top: K.SAND, soil: K.SAND, depth: 5, under: K.SANDSTONE }
        : { top: deep < 10 || (n > -0.3 && n < 0.3) ? K.SAND : n >= 0.3 ? K.CLAY : K.GRAVEL, soil: K.SAND, depth: 4, under: K.SANDSTONE };
      return c.water;
    }
    // A beach: dry land along a sea, not far above it.
    if (c.surf >= SEA_ROW - 6) {
      const k = this.regionAt(x);
      for (let j = k - 1; j <= k + 1; j++) {
        const o = this.seaSpan(j);
        if (!o || Math.min(Math.abs(x - o.x0), Math.abs(x - o.x1)) > 8) continue;
        c.bed = o.biome.frozen ? { top: K.GRAVEL, soil: K.GRAVEL, depth: 3 }
          : c.biome.key === 'badlands' ? { top: K.RED_SAND, soil: K.RED_SAND, depth: 4 } : { top: K.SAND, soil: K.SAND, depth: 4, under: K.SANDSTONE };
        c.beach = o;
        break;
      }
    }
    return c.water;
  }

  /** The bottom (row) of the deepest water within a few columns of x, or -1: caves keep away from it. */
  wetFloor(x) {
    const c = this.column(x);
    if (c.wetFloor !== undefined) return c.wetFloor;
    let f = -1;
    for (let xx = x - 3; xx <= x + 3; xx++) if (this.waterTop(xx) < WORLD_H) f = Math.max(f, this.column(xx).surf);
    c.wetFloor = f;
    return f;
  }

  /** The lake (or pool) whose water column x is under, if any (its edges are the land it's in). */
  lakeAt(x) {
    for (let small = 0; small < 2; small++) {
      const cell = small ? POOL_CELL : LAKE_CELL, i = Math.floor(x / cell);
      for (let j = i - 1; j <= i + 1; j++) {
        const L = this.lake(j, !!small);
        if (L && x > L.x0 && x < L.x1) return L;
      }
    }
    return null;
  }

  /** The lake in lake cell i (small: the pool in pool cell i), or null. Worked out once. */
  lake(i, small) {
    const cache = small ? this.pools : this.lakes;
    let L = cache.get(i);
    if (L !== undefined) return L;
    L = this.planLake(i, small);
    if (cache.size > 256) cache.clear();
    cache.set(i, L);
    return L;
  }

  /**
   * Lake cell i's lake, if it has one: a bowl dug into the land across [x0, x1] (those two columns
   * the land, holding it in), its water up to the lower of them (level, a row), depth rows deeper
   * in the middle. Only in one biome's land, away from seas, towns and where everyone starts, and
   * not through a hill.
   */
  planLake(i, small) {
    const s = this.seed, cell = small ? POOL_CELL : LAKE_CELL, salt = small ? 600 : 610, h = hash3(s, i, salt);
    const w = small ? 3 + ((h >>> 8) % 6) : 8 + ((h >>> 8) % 16), depth = small ? 1 + ((h >>> 12) % 3) : 3 + ((h >>> 12) % 6);
    const pad = w + 3, mid = i * cell + pad + (h % Math.max(1, cell - 2 * pad)), x0 = mid - w, x1 = mid + w;
    const k = this.regionAt(mid), b = this.regionBiome(k);
    if (rand3(s, i, salt + 1) >= (LAKE_CHANCE[b.key]?.[small ? 1 : 0] || 0)) return null;
    if (this.regionAt(x0 - 2) !== k || this.regionAt(x1 + 2) !== k) return null;
    if (this.regionBiome(k - 1).sea || this.regionBiome(k + 1).sea) return null;
    if (Math.abs(mid - this.spawnX) < w + 70) return null;
    if (this.towns && (this.townNear(x0, TOWN_RAMP + 8) || this.townNear(x1, TOWN_RAMP + 8))) return null;
    // (A pool not where a lake is.)
    if (small) for (let j = Math.floor(x0 / LAKE_CELL) - 1; j <= Math.floor(x1 / LAKE_CELL) + 1; j++) { const o = this.lake(j, false); if (o && o.x1 + 3 >= x0 && o.x0 - 3 <= x1) return null; }
    const row = x => this.surfaceRow(this.naturalHeight(x, k));
    const rl = row(x0), rr = row(x1);
    if (Math.abs(rl - rr) > (small ? 2 : 4)) return null;
    const level = Math.max(rl, rr);
    for (let x = x0 + 2; x < x1 - 1; x += 3) if (row(x) < level - (small ? 2 : 6)) return null;
    return { x0, x1, mid, w, level, depth, biome: b.key, frozen: b.climate === 0, small };
  }

  /**
   * For what changes gradually from one biome to the next (Remastered's scenery): the biomes
   * either side of the nearest edge to x (tiles, fractions too), and how much of the other one
   * there is at x: none `half` tiles or more from the edge, half right at it, rising smoothly
   * across it. Into `out` ({ own, other, t }).
   */
  blendAt(x, half = 48, out = {}) {
    const k = this.regionAt(Math.floor(x)), dl = x - this.edge(k), dr = this.edge(k + 1) - x;
    const v = Math.max(0, 0.5 - Math.min(dl, dr) / (2 * half));
    out.own = this.regionBiome(k);
    out.other = this.regionBiome(dl <= dr ? k - 1 : k + 1);
    out.t = v * v * (3 - 2 * v);
    return out;
  }

  // ---- Underground ---------------------------------------------------------------------------

  /** True if (x, y) is in a cave or tunnel. surf: the column's surface row; town: the town it's in (none close under one). */
  cave(x, y, surf, town = null) {
    const depth = y - surf;
    if (depth < 3 || y >= WORLD_H - 6) return false;
    if (town && depth < TOWN_BELOW + 8) return false;
    // (Not coming up under or beside the sea or a lake: the water would hang in the air.)
    if (this.seas && y < SURFACE + 100) { const f = this.wetFloor(x); if (f >= 0 && y < f + 14) return false; }
    // (Geodes, deep down, are hollow inside: oreVeins has their shells.)
    if (this.veins && y > GEODE_TOP && this.geode(x, y) === HOLLOW) return true;
    // (Not right under where everyone starts.)
    if (depth < 24 && x > this.spawnX - 40 && x < this.spawnX + 40) return false;
    const s = this.seed;
    // Long winding tunnels (where ridged noise is near zero), in some parts of the world more
    // than others, and none in others. Some reach the surface: cave mouths.
    const region = noise2(s + 20, x / 300, y / 160);
    if (region > -0.12) {
      const t = Math.abs(noise2(s + 21, x / 84, y / 46));
      const width = 0.014 + 0.03 * Math.min(1, region + 0.12) + Math.min(0.016, depth / 12000);
      if (t < width) return depth >= 10 || rand3(s, Math.floor(x / 56), 17) < 0.45;
    }
    // Rounded caves, bigger and more of them deeper down.
    if (depth > 16) {
      const c = fbm2(s + 22, x / 64, y / 34, 3);
      if (c > (depth < 70 ? 0.62 : depth < 160 ? 0.52 : 0.46)) return true;
    }
    // Great caverns in the deep.
    if (y > 300 && fbm2(s + 23, x / 150, y / 52, 2) > 0.5) return true;
    return false;
  }

  /** What's at (x, y) under the ground, before caves, ores and building: the rock in layers. */
  rock(x, y, col) {
    const depth = y - col.surf, b = col.biome, s = this.seed;
    const bed = WORLD_H - 1 - (hash3(s, x, 23) % 4);
    if (y >= bed) return K.BEDROCK;
    const under = UNDERWORLD + Math.floor(fbm1(s + 25, x / 40, 2) * 6);
    if (y >= under) {
      if (noise2(s + 26, x / 9, y / 9) > 0.42) return K.MAGMA;
      if (noise2(s + 27, x / 14, y / 5) > 0.5) return K.OBSIDIAN;
      return K.BASALT;
    }
    // (Under water, and on beaches: its bed. waterTop has worked it out.)
    const wet = col.bed;
    if (wet) {
      if (depth === 0) return wet.top;
      if (depth < wet.depth) return wet.soil;
      if (wet.under && depth < wet.depth + 6) return wet.under;
    }
    if (depth === 0) {
      // Snow on high peaks.
      if (b.key === 'mountains' && y < SURFACE - 34) return K.SNOW;
      // (Worlds made since forests: moss on old forests' floors, grass here and there among the podzol.)
      if (this.forests) {
        if (b.mossy && noise2(s + 131, x / 14, 0.5) > 0.1) return K.MOSS;
        if (b.top === K.PODZOL && noise2(s + 132, x / 20, 1.5) < -0.25) return K.GRASS;
      }
      // (The ashen wastes: magma breaking through the ash, and bare basalt.)
      if (b.key === 'ashlands') {
        const n = noise2(s + 140, x / 9, 0.5);
        if (n > 0.5) return K.MAGMA;
        if (n < -0.45) return K.BASALT;
      }
      return b.top;
    }
    if (depth < col.soilDepth) return b.soil;
    if (b.under === K.BASALT && depth < col.soilDepth + 30) return noise2(s + 141, x / 7, y / 7) > 0.55 ? K.MAGMA : K.BASALT;
    if (b.under === K.SANDSTONE && depth < col.soilDepth + 22) return K.SANDSTONE;
    if (b.under === 'bands' && depth < 30) {
      const band = Math.floor((y + Math.floor(noise2(s + 28, x / 40, 0.5) * 4)) / 3) % 3;
      return band === 0 ? K.CLAY : band === 1 ? K.CLAY_PALE : K.RED_SAND;
    }
    if (b.under === 'ice' && depth < 40 && noise2(s + 29, x / 11, y / 8) > 0.38) return K.ICE;
    if (b.key === 'jungle' && depth < 40 && noise2(s + 24, x / 12, y / 12) > 0.3) return K.MUD;
    const deep = DEEP + Math.floor(fbm1(s + 30, x / 50, 2) * 8);
    if (y >= deep) return K.SLATE;
    if (depth < 40 && noise2(s + 31, x / 16, y / 10) > 0.48) return K.GRAVEL;
    if (depth < 60 && noise2(s + 32, x / 18, y / 12) > 0.5) return K.DIRT;
    return K.STONE;
  }

  /** An ore at (x, y) in rock `base` (stone, slate or basalt), or the rock as it is. */
  ore(x, y, depth, base) {
    if (this.veins) return this.oreVeins(x, y, depth, base);
    const s = this.seed;
    if (base === K.BASALT) return y > UNDERWORLD + 6 && noise2(s + 46, x / 4.2, y / 4.2) > 0.52 ? K.EMBER : base;
    if (base !== K.STONE && base !== K.SLATE) return base;
    if (y > 380 && noise2(s + 45, x / 3.8, y / 3.8) > 0.55) return K.CRYSTAL;
    if (y > 270 && noise2(s + 44, x / 4.4, y / 4.4) > 0.52) return K.GOLD;
    if (depth > 26 && noise2(s + 43, x / 5, y / 5) > 0.48) return K.IRON;
    if (depth > 6 && y < 340 && noise2(s + 42, x / 5.4, y / 5.4) > 0.47) return K.COPPER;
    if (depth > 3 && y < 300 && noise2(s + 41, x / 5, y / 5) > 0.44) return K.COAL;
    return base;
  }

  /**
   * Ores, in worlds made since veins: coal in long flat seams; copper, iron, silver and gold in
   * winding veins (each at its depths, where the rock's rich: a slow noise); gold nuggets and gems
   * (ruby, sapphire, emerald, topaz, amethyst) in small nodes deep down; diamonds in kimberlite
   * pipes rising from the deep; geodes (crystal shells lined with amethyst) near the bottom;
   * ember ore in the underworld's basalt.
   */
  oreVeins(x, y, depth, base) {
    const s = this.seed;
    if (base === K.BASALT) return y > UNDERWORLD + 6 && noise2(s + 46, x / 4.2, y / 4.2) > 0.52 ? K.EMBER : base;
    if (base !== K.STONE && base !== K.SLATE) return base;
    if (y > PIPE_TOP) { const p = this.pipe(x, y); if (p) return p; }
    if (y > GEODE_TOP) { const g = this.geode(x, y); if (g) return g; }
    if (y > 300) {
      const n = this.node(x, y, 26, 0.24, 1, 1.9, 301);
      if (n) return GEM_ORES[n % GEM_ORES.length];
    }
    if (y > 250 && this.node(x, y, 17, 0.18, 0.8, 1.6, 302)) return K.GOLD;
    // (Where each kind runs: two slow fields, each ore rich in its own part of them.)
    const a = noise2(s + 140, x / 52, y / 36), b = noise2(s + 146, x / 62, y / 42);
    if (y > 270 && b > 0.5 && Math.abs(noise2(s + 145, x / 18, y / 24)) < VEIN.gold) return K.GOLD;
    if (y > 200 && a > 0.42 && Math.abs(noise2(s + 144, x / 20, y / 30)) < VEIN.silver) return K.SILVER;
    if (depth > 26 && (a < -0.4 || b < -0.4) && Math.abs(noise2(s + 143, x / 22, y / 22)) < VEIN.iron) return K.IRON;
    if (depth > 6 && y < 300 && b > 0.32 && Math.abs(noise2(s + 142, x / 26, y / 18)) < VEIN.copper) return K.COPPER;
    if (depth > 3 && y < 300 && a > 0.28 && Math.abs(noise2(s + 141, x / 34, y / 11)) < VEIN.coal) return K.COAL;
    return base;
  }

  /**
   * A node of ore at (x, y), in rock split into cells `cell` tiles across: each has one (chance p),
   * r0 to r1 tiles across, somewhere in it. Returns a number from its cell's hash (what it's of), or 0.
   */
  node(x, y, cell, p, r0, r1, salt) {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), h = hash3(this.seed + salt, cx, cy);
    if ((h & 1023) / 1024 >= p) return 0;
    const pad = Math.ceil(r1) + 1, span = cell - 2 * pad;
    const nx = cx * cell + pad + ((h >>> 10) % span), ny = cy * cell + pad + ((h >>> 17) % span);
    const r = r0 + (((h >>> 24) & 15) / 15) * (r1 - r0), dx = x - nx, dy = (y - ny) * 1.2, d2 = dx * dx + dy * dy;
    if (d2 > r * r || (d2 > (r - 0.7) * (r - 0.7) && rand3(this.seed + salt, x, y) < 0.35)) return 0;
    return (h >>> 4) + 1;
  }

  /**
   * A diamond pipe: kimberlite in a column rising from the deep, narrowing as it goes up, a
   * diamond here and there in it (more, deeper). One in some stretches PIPE_CELL tiles across.
   */
  pipe(x, y) {
    const k = Math.floor(x / PIPE_CELL), h = hash3(this.seed, k, 351);
    if ((h & 255) >= 140) return 0;
    const top = PIPE_TOP + 20 + ((h >>> 8) % 70);
    if (y < top) return 0;
    const px = k * PIPE_CELL + 30 + ((h >>> 16) % (PIPE_CELL - 60)) + fbm1(this.seed + 352, y / 26, 2) * 5;
    if (Math.abs(x - px) > 1.5 + (y - top) / 36) return 0;
    return rand3(this.seed + 353, x, y) < 0.025 + (y - top) / 6000 ? K.DIAMOND : K.KIMBERLITE;
  }

  /** A geode at (x, y): HOLLOW inside, its lining of amethyst, its crystal shell; else 0. */
  geode(x, y) {
    const cell = 44, cx = Math.floor(x / cell), cy = Math.floor(y / cell), h = hash3(this.seed, cx, cy + 361);
    if ((h & 255) >= 70) return 0;
    const r = 3.4 + ((h >>> 8) & 7) / 3.5, nx = cx * cell + 8 + ((h >>> 12) % (cell - 16)), ny = cy * cell + 8 + ((h >>> 20) % (cell - 16));
    const d = Math.hypot(x - nx, (y - ny) * 1.1);
    return d > r ? 0 : d > r - 1 ? K.CRYSTAL : d > r - 1.9 ? K.AMETHYST : HOLLOW;
  }

  /** The wall behind (x, y) underground. */
  naturalWall(y, col) {
    const depth = y - col.surf;
    if (y >= UNDERWORLD) return K.BASALT_WALL;
    if (y >= DEEP) return K.SLATE_WALL;
    if (depth < col.soilDepth + 4) return col.biome.wall;
    return col.biome.key === 'desert' && depth < col.soilDepth + 22 ? K.SANDSTONE_WALL : K.STONE_WALL;
  }

  // ---- Trees -------------------------------------------------------------------------------------

  /** The tree growing at column x, if any: { x, base (the ground's row), kind, h (trunk), r (crown) }. */
  treeAt(x) {
    if (this.forests) return this.treeAt5(x);
    const cell = Math.floor(x / 5);
    if (x !== cell * 5 + 1 + (hash3(this.seed, cell, 51) % 3)) return null;
    const col = this.column(x), b = col.biome;
    if (rand3(this.seed, cell, 52) >= b.trees) return null;
    if (col.town && x >= col.town.x0 - 6 && x <= col.town.x1 + 6) return null;
    // (Not in water, on a beach, or leaning over a lake's edge.)
    if (this.seas && (this.waterTop(x, col) < WORLD_H || col.beach || this.waterTop(x - 1) < WORLD_H || this.waterTop(x + 1) < WORLD_H)) return null;
    if (x > -6 && x < 6) return null; // (room to land where everyone starts)
    const surf = col.surf;
    if (Math.abs(this.surfaceAt(x - 1) - surf) > 1 || Math.abs(this.surfaceAt(x + 1) - surf) > 1) return null;
    if (this.inStructure(x, surf - 1)) return null;
    const kind = col.biome.tree, r = hash3(this.seed, x, 53);
    const h = kind === 'cactus' ? 2 + (r % 3) : kind === 'jungle' ? 10 + (r % 7) : kind === 'pine' ? 7 + (r % 6) : kind === 'swamp' ? 5 + (r % 3) : 5 + (r % 4);
    return { x, base: surf, kind, h, r: kind === 'jungle' ? 4 : kind === 'swamp' ? 3 : 2 + ((r >>> 4) & 1) };
  }

  /** What tree `t` puts at (x, y), or AIR. */
  treeTile(t, x, y) {
    const top = t.base - t.h; // (the trunk's top tile)
    const dx = x - t.x;
    if (t.kind === 'cactus') {
      if (dx === 0 && y < t.base && y >= top) return K.CACTUS;
      // Arms: out one, then up one.
      const arm = t.base - 2 - (t.h > 3 ? 1 : 0);
      if (t.h >= 3 && (dx === 1 || dx === -1) && (y === arm || y === arm - 1) && ((hash3(this.seed, t.x, 54) >>> (dx > 0 ? 0 : 1)) & 1)) return K.CACTUS;
      return K.AIR;
    }
    if (dx === 0 && y < t.base && y >= top) return K.TRUNK;
    if (t.kind === 'pine') {
      // Layers of needles, wider further down, from above the top to a few rows over the ground.
      const i = y - (top - 1);
      if (i < 0 || y > t.base - 3) return K.AIR;
      const half = Math.min(3, (i >> 1) + (i % 2));
      return Math.abs(dx) <= half && !(dx === 0 && y >= top) ? K.PINE_LEAVES : K.AIR;
    }
    // A round crown on top (wide and flat in the jungle, and in swamps).
    const flat = t.kind === 'jungle' || t.kind === 'swamp';
    const cy = top - (flat ? 1 : 0), ry = t.kind === 'jungle' ? 2.6 : t.kind === 'swamp' ? 1.8 : t.r;
    const ex = dx / (t.r + 0.5), ey = (y - cy) / (ry + 0.5);
    if (ex * ex + ey * ey <= 1 && !(dx === 0 && y >= top)) return t.kind === 'jungle' ? K.JUNGLE_LEAVES : K.LEAVES;
    // Jungle and swamp trees trail vines from their crowns.
    if (flat && Math.abs(dx) >= 2 && Math.abs(dx) <= t.r && y > cy && y <= cy + 2 + (hash3(this.seed, x, 55) % 4) && hash3(this.seed, x, 56) % 3 === 0) return K.VINE;
    return K.AIR;
  }

  /**
   * The tree at column x in worlds made since forests: each biome's own (TREES), as many as its
   * forests have (a trunk every few tiles in the thickest: their crowns meet), thinned out in
   * clearings; palms on warm shores. { x, base, kind, w (the trunk's width: 1, or 2 for the
   * biggest), h, r, reach (tiles either side), top (its highest row), lean (palms and acacias: -1
   * or 1), and what else its kind needs }.
   */
  treeAt5(x) {
    if (x > -6 && x < 6) return null; // (room to land where everyone starts)
    const col = this.column(x), b = col.biome, s = this.seed;
    if (this.waterTop(x, col) < WORLD_H) return null;
    // (On a warm shore: palms. On any other beach, nothing.)
    const palms = col.beach && (col.beach.biome.coral || b.climate === 2);
    if (col.beach && !palms) return null;
    const T = palms ? PALMS : TREES[b.key];
    if (!T) return null;
    // (One in each cell at most, somewhere in it: never right next to the one in the next cell.)
    const cw = T.cell, cell = Math.floor(x / cw);
    if (x !== cell * cw + (hash3(s, cell, 51) % (cw - 1))) return null;
    let p = T.p;
    if (T.clearings && noise2(s + 130, x / 70, 0.5) < -0.45) p *= 0.12;
    if (rand3(s, cell, 52 + cw) >= p) return null;
    const kind = pick(T.kinds, rand3(s, x, 57)), w = WIDE.has(kind) ? 2 : 1, reach = TREE_REACH[kind];
    if (col.town && x >= col.town.x0 - reach - 2 && x <= col.town.x1 + reach + 2) return null;
    // (Worlds made since towers: none against a tower, its crown in through the windows.)
    if (this.wilds && this.towerNear(x, reach + 2)) return null;
    // (On ground level enough for it: a wide trunk's two columns on the same level.)
    const surf = col.surf;
    for (let d = -1; d <= w; d++) if (d && Math.abs(this.surfaceAt(x + d) - surf) > (d >= 1 && d < w ? 0 : 1)) return null;
    if (this.waterTop(x - 1) < WORLD_H || this.waterTop(x + w) < WORLD_H) return null;
    if (this.inStructure(x, surf - 1)) return null;
    const r = hash3(s, x, 53), t = { x, base: surf, kind, w, h: 5, r: 2, reach, top: 0, lean: (r >>> 9) & 1 ? 1 : -1 };
    switch (kind) {
      case 'oak': t.h = 5 + (r % 4); t.r = 2 + ((r >>> 4) & 1); break;
      case 'big_oak': t.h = 8 + (r % 4); t.r = 4; break;
      case 'birch': t.h = 6 + (r % 3); break;
      case 'tall_birch': t.h = 9 + (r % 4); break;
      case 'dark_oak': t.h = 6 + (r % 3); t.r = 5; break;
      case 'spruce': case 'snowy_spruce': t.h = 9 + (r % 6); break;
      case 'mega_spruce': t.h = 18 + (r % 8); break;
      case 'pine': t.h = 7 + (r % 6); break;
      case 'jungle': t.h = 10 + (r % 7); t.r = 4; break;
      case 'big_jungle': t.h = 16 + (r % 7); t.r = 5; break;
      case 'swamp': t.h = 5 + (r % 3); t.r = 3; break;
      case 'cactus': t.h = 2 + (r % 3); break;
      case 'acacia': t.a = 3 + (r % 2); t.b = 2 + ((r >>> 3) % 2); t.h = t.a + t.b + 1; t.two = ((r >>> 5) & 3) === 0; break;
      case 'cherry': t.h = 4 + (r % 3); t.r = 4; break;
      case 'palm': t.h = 6 + (r % 4); break;
      case 'giant_mushroom': t.h = 4 + (r % 4); t.red = ((r >>> 6) & 1) === 1; break;
      case 'dead': t.h = 6 + (r % 5); break;
      case 'blight_oak': t.h = 6 + (r % 3); t.r = 3; break;
      case 'charred': t.h = 3 + (r % 4); break;
      case 'crystal': t.h = 3 + (r % 6); break;
    }
    t.top = t.base - t.h - 6;
    return t;
  }

  /** What tree t (treeAt5) puts at (x, y), or AIR. */
  treeTile5(t, x, y) {
    const dx = x - t.x, top = t.base - t.h, s = this.seed;
    if (y >= t.base) return K.AIR;
    switch (t.kind) {
      case 'oak': case 'pine': case 'jungle': case 'swamp': case 'cactus': return this.treeTile(t, x, y);
      case 'big_oak':
        // A tall trunk, a big crown, and a lobe low down either side, branches out to them.
        if (dx === 0 && y >= top) return K.TRUNK;
        if ((y === top + 2 && (dx === -1 || dx === -2)) || (y === top + 1 && (dx === 1 || dx === 2))) return K.TRUNK;
        return ell(dx, y - (top - 1), 4.5, 3) || ell(dx + 3, y - (top + 2), 2.5, 1.8) || ell(dx - 3, y - (top + 1), 2.5, 1.8) ? K.LEAVES : K.AIR;
      case 'birch': case 'tall_birch':
        // White and slim, a narrow crown.
        if (dx === 0 && y >= top) return K.BIRCH_TRUNK;
        return ell(dx, y - (top + 1), 2.2, t.kind === 'tall_birch' ? 4.2 : 3.2) ? K.BIRCH_LEAVES : K.AIR;
      case 'dark_oak':
        // Two trunks wide, roots at its foot, a wide flat crown (a dark forest's canopy).
        if ((dx === 0 || dx === 1) && y >= top) return K.DARK_TRUNK;
        if (y === t.base - 1 && (dx === -1 || dx === 2) && (hash3(s, x, 58) & 1)) return K.DARK_TRUNK;
        return ell(dx - 0.5, y - top, t.r + 0.5, 2.6) ? K.DARK_LEAVES : K.AIR;
      case 'spruce': case 'snowy_spruce': case 'mega_spruce': {
        // Tiers of needles, wider further down (snow on each tier's top, in the snowy taiga);
        // the biggest, two trunks wide and very tall, needles only on the top part.
        const wide = t.w === 2;
        if ((dx === 0 || (wide && dx === 1)) && y >= top) return K.SPRUCE_TRUNK;
        const i = y - (top - 1), bottom = wide ? top + Math.floor(t.h * 0.6) : t.base - 3;
        if (i < 0 || y > bottom) return K.AIR;
        let half = Math.min(wide ? 5.5 : 3.6, 0.6 + i * (wide ? 0.38 : 0.45));
        if (i > 1 && i % 3 === 0) half -= wide ? 1.6 : 1.1;
        if (Math.abs(wide ? dx - 0.5 : dx) > half) return K.AIR;
        return t.kind === 'snowy_spruce' && (i % 3 === 1 || i === 0) ? K.SNOWY_LEAVES : K.SPRUCE_LEAVES;
      }
      case 'big_jungle':
        // Two trunks wide and very tall, a broad crown trailing vines.
        if ((dx === 0 || dx === 1) && y >= top) return K.TRUNK;
        if (ell(dx - 0.5, y - (top - 1), t.r + 0.5, 3)) return K.JUNGLE_LEAVES;
        if (Math.abs(dx - 0.5) >= 2 && Math.abs(dx - 0.5) <= t.r && y > top && y <= top + 3 + (hash3(s, x, 55) % 4) && hash3(s, x, 56) % 3 === 0) return K.VINE;
        return K.AIR;
      case 'acacia': {
        // Straight up a few, then off to one side, a flat crown on top; some fork the other way too.
        const L = t.lean, bend = t.base - t.a;
        if (dx === 0 && y >= bend) return K.ACACIA_TRUNK;
        for (let j = 1; j <= t.b; j++) if (dx === L * j && y === bend - j) return K.ACACIA_TRUNK;
        const cx = L * t.b, cy = bend - t.b - 1;
        if ((y === cy && Math.abs(dx - cx) <= 3) || (y === cy - 1 && Math.abs(dx - cx) <= 2)) return K.ACACIA_LEAVES;
        if (t.two) {
          if (dx === -L && y === bend - 1) return K.ACACIA_TRUNK;
          const c2 = -L * 2, y2 = bend - 2;
          if ((y === y2 && Math.abs(dx - c2) <= 2) || (y === y2 - 1 && Math.abs(dx - c2) <= 1)) return K.ACACIA_LEAVES;
        }
        return K.AIR;
      }
      case 'cherry':
        // Forking near the top, a wide pink crown.
        if (dx === 0 && y >= top) return K.CHERRY_TRUNK;
        if (y === top + 1 && (dx === -1 || dx === 1) && ((hash3(s, t.x, 59) >>> (dx > 0 ? 0 : 1)) & 1)) return K.CHERRY_TRUNK;
        return ell(dx, y - (top - 1), t.r + 0.5, 2.6) ? K.CHERRY_LEAVES : K.AIR;
      case 'palm': {
        // A trunk curving over as it goes up, fronds drooping from its top.
        const j = t.base - 1 - y, bend = n => Math.round(t.lean * 2 * (n / t.h) ** 2);
        if (j >= 0 && j < t.h && dx === bend(j)) return K.PALM_TRUNK;
        const ax = Math.abs(dx - bend(t.h - 1)), ay = y - (t.base - t.h - 1);
        return (ay === -1 && ax <= 1) || (ay === 0 && ax <= 3) || (ay === 1 && ax >= 3 && ax <= 4) || (ay === 2 && ax >= 4 && ax <= 5) ? K.PALM_LEAVES : K.AIR;
      }
      case 'dead': {
        // Grey and bare: a trunk, a crooked branch one way and (on a tall one) another the other, nothing on them.
        if (dx === 0 && y >= top) return K.DEAD_TRUNK;
        const out = dx * t.lean, b1 = top + 2, b2 = top + 4;
        if (out >= 1 && out <= 2 && y === b1 - out) return K.DEAD_TRUNK;
        if (t.h > 7 && out <= -1 && out >= -2 && y === b2 + out) return K.DEAD_TRUNK;
        return K.AIR;
      }
      case 'blight_oak':
        // A dark twisted trunk, its crown ragged and violet, with holes in it.
        if (dx === 0 && y >= top) return K.DEAD_TRUNK;
        return ell(dx, y - (top - 1), t.r + 0.5, 2.6) && hash3(s, x * 7 + y, 141) % 3 ? K.BLIGHT_LEAVES : K.AIR;
      case 'charred':
        // Burnt black and broken off, a stub of a branch.
        if (dx === 0 && y >= top) return K.CHARRED_TRUNK;
        return y === top + 1 && dx === t.lean ? K.CHARRED_TRUNK : K.AIR;
      case 'crystal': {
        // A spire of crystal, wider at its foot.
        const i = t.base - 1 - y;
        if (i < 0 || i >= t.h) return K.AIR;
        return Math.abs(dx) <= (i < 2 && t.h > 4 ? 1 : 0) ? K.CRYSTAL_CLUSTER : K.AIR;
      }
      case 'giant_mushroom': {
        // A thick pale stem, and a cap to stand on: a red dome with its rim hanging down, or a wide flat brown one.
        if (dx === 0 && y >= top) return K.MUSHROOM_STEM;
        const cy = top - 1, ax = Math.abs(dx);
        if (t.red) return (y === cy - 1 && ax <= 1) || (y === cy && ax <= 2) || (y === cy + 1 && ax === 3) ? K.RED_CAP : K.AIR;
        return (y === cy && ax <= 4) || (y === cy - 1 && ax <= 2) ? K.BROWN_CAP : K.AIR;
      }
      default: return K.AIR;
    }
  }

  /**
   * Chunk (x0, y0)'s trees, in worlds made since forests (fg: its blocks): trunks first, then
   * giant mushrooms' caps, then crowns (a trunk shows through a neighbour's crown, and is felled
   * whole; a mushroom keeps its cap, among the leaves).
   */
  fillTrees5(x0, y0, fg) {
    const trees = [];
    for (let x = x0 - TREE_MAX_REACH; x < x0 + CHUNK + TREE_MAX_REACH; x++) {
      const t = this.treeAt5(x);
      if (t && t.x + t.reach >= x0 && t.x - t.reach < x0 + CHUNK && t.base > y0 && t.top < y0 + CHUNK) trees.push(t);
    }
    // (Three passes: trunks, then giant mushrooms' caps, then leaves.)
    const passOf = b => (K.TRUNKS.has(b) ? 0 : K.CAPS.has(b) ? 1 : 2);
    for (let pass = 0; pass < 3; pass++) {
      for (const t of trees) {
        if (pass === 1 && t.kind !== 'giant_mushroom') continue;
        for (let y = Math.max(y0, t.top); y < Math.min(y0 + CHUNK, t.base); y++) {
          for (let tx = Math.max(x0, t.x - t.reach); tx <= Math.min(x0 + CHUNK - 1, t.x + t.reach); tx++) {
            const i = (y - y0) * CHUNK + (tx - x0);
            if (fg[i] !== K.AIR) continue;
            const b = this.treeTile5(t, tx, y);
            if (b !== K.AIR && passOf(b) === pass) fg[i] = b;
          }
        }
      }
    }
  }

  /**
   * What grows at the foot of column x's ground, in worlds made since forests (UNDERGROWTH): a
   * block, or 0. (Flowers in patches in some lands; nothing on beaches.)
   */
  undergrowth(x, col) {
    const U = UNDERGROWTH[col.biome.key];
    if (!U || col.beach) return 0;
    const s = this.seed, r = rand3(s, x, 81);
    if (U.patches && noise2(s + 134, x / 16, 0.5) > 0.35) return r < 0.7 ? K.FLOWER : K.TALL_GRASS;
    return r < U.p ? pick(U.list, rand3(s, x, 82)) : 0;
  }

  /**
   * What lies on column x's ground, in worlds made since forests, taking more than a tile:
   * bamboo, tall, in clumps; fallen logs (a few tiles long, on flat ground); boulders, mossy in
   * old forests. [block, top row, bottom row], or null.
   */
  groundThing(x, col) {
    const s = this.seed, key = col.biome.key, surf = col.surf;
    if (col.town || col.beach || this.waterTop(x, col) < WORLD_H) return null;
    if (this.wilds && this.towerNear(x, 1)) return null;
    if (key === 'bamboo_jungle' && noise2(s + 135, x / 22, 0.5) > -0.15 && rand3(s, x, 136) < 0.55 && !this.treeAt5(x)) return [K.BAMBOO, surf - 4 - (hash3(s, x, 137) % 9), surf - 1];
    if (LOGS.has(key)) {
      for (let xs = x - 4; xs <= x; xs++) {
        if (hash3(s, xs, 140) % 1000 >= 14) continue;
        const len = 3 + (hash3(s, xs, 141) % 3);
        if (x >= xs + len) continue;
        let flat = true;
        for (let k = xs; k < xs + len && flat; k++) { const c = this.column(k); flat = c.surf === this.column(xs).surf && c.biome === col.biome && !c.town && !c.beach && this.waterTop(k, c) === WORLD_H && !this.treeAt5(k); }
        if (flat) return [K.FALLEN_LOG, surf - 1, surf - 1];
      }
    }
    if (BOULDERS.has(key)) {
      for (let xc = x - 2; xc <= x + 2; xc++) {
        if (hash3(s, xc, 142) % 1000 >= 10) continue;
        const r = 1 + (hash3(s, xc, 143) % 2), hgt = r + 1 - Math.abs(x - xc);
        if (hgt <= 0) continue;
        return [col.biome.mossy || key === 'forest' || key === 'taiga' ? K.MOSSY_COBBLE : K.STONE, surf - hgt, surf - 1];
      }
    }
    return null;
  }

  /** Chunk (x0, y0)'s bamboo, fallen logs and boulders (groundThing), in worlds made since forests. */
  fillGround5(x0, y0, fg) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const x = x0 + lx, col = this.column(x);
      if (col.surf - 12 > y0 + CHUNK || col.surf <= y0) continue;
      const g = this.groundThing(x, col);
      if (!g) continue;
      for (let y = Math.max(y0, g[1]); y <= Math.min(y0 + CHUNK - 1, g[2]); y++) {
        const i = (y - y0) * CHUNK + lx;
        if (fg[i] === K.AIR) fg[i] = g[0];
      }
    }
  }

  // ---- Ruins and cabins ---------------------------------------------------------------------------

  /** The ruin in surface cell k, if any: { kind: 'ruin', x0, x1, y0, y1, base, mat, wall }. */
  ruin(k) {
    const s = this.seed;
    if (rand3(s, k, 61) > 0.5) return null;
    const w = 9 + (hash3(s, k, 62) % 5), x0 = k * RUIN_CELL + 30 + (hash3(s, k, 63) % (RUIN_CELL - 60 - w));
    if (x0 < 20 && x0 + w > -20) return null; // (not on top of where everyone starts)
    if (this.towns && (this.townAtX(x0 - 6) || this.townAtX(x0 + w + 6))) return null; // (nor in a town)
    if (this.seas && (this.waterTop(x0 - 1) < WORLD_H || this.waterTop(x0 + (w >> 1)) < WORLD_H || this.waterTop(x0 + w) < WORLD_H)) return null; // (nor in water)
    const col = this.column(x0 + (w >> 1)), b = col.biome;
    if (!['plains', 'forest', 'desert', 'snow', 'badlands'].includes(b.key)) return null;
    let lo = Infinity, hi = -Infinity;
    for (let x = x0; x < x0 + w; x++) { const h = this.surfaceAt(x); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (hi - lo > 3) return null;
    const mat = b.key === 'desert' || b.key === 'badlands' ? K.SANDSTONE_BRICKS : b.key === 'snow' ? K.SNOW_BRICKS : K.STONE_BRICKS;
    const wall = b.key === 'desert' || b.key === 'badlands' ? K.SANDSTONE_BRICK_WALL : K.STONE_BRICK_WALL;
    return { kind: 'ruin', x0, x1: x0 + w - 1, y0: lo - 7, y1: hi + 2, base: lo, mat, wall, k };
  }

  /** The cabin in underground cell (i, j), if any. */
  cabin(i, j) {
    const s = this.seed;
    if (rand3(s, i * 977 + j, 71) > 0.38) return null;
    const w = 10 + (hash3(s, i, j + 72) % 5), h = 6 + (hash3(s, i, j + 73) % 2);
    const x0 = i * CABIN_W + 10 + (hash3(s, i, j + 74) % (CABIN_W - 20 - w));
    const y0 = j * CABIN_H + 8 + (hash3(s, i, j + 75) % (CABIN_H - 16 - h));
    if (y0 < 230 || y0 + h > UNDERWORLD - 8) return null;
    return { kind: 'cabin', x0, x1: x0 + w - 1, y0, y1: y0 + h - 1 };
  }

  /**
   * Sea region k's shipwreck, if it has one (worlds made since seas): an old ship sunk into the
   * sea floor, somewhere well out from the shore where it's deep enough, broken open, with its
   * cargo (supply crates) still in its hold. { kind: 'wreck', x0, x1, y0, y1, keel, mast, k }.
   */
  wreck(k) {
    if (!this.seas) return null;
    let st = this.wrecks.get(k);
    if (st !== undefined) return st;
    st = null;
    const s = this.seed, sp = this.seaSpan(k);
    if (sp && rand3(s, k, 91) < 0.7) {
      const w = 15 + (hash3(s, k, 92) % 8), room = Math.min(sp.x1, this.edge(k + 1)) - Math.max(sp.x0, this.edge(k)) - 2 * 24 - w;
      if (room > 0) {
        const x0 = Math.max(sp.x0, this.edge(k)) + 24 + (hash3(s, k, 93) % room), x1 = x0 + w - 1;
        let lo = Infinity, hi = -Infinity;
        for (let x = x0; x <= x1; x++) { const r = this.column(x).surf; lo = Math.min(lo, r); hi = Math.max(hi, r); }
        // (Its keel in the floor, its deck six rows up, well under the water.)
        const keel = lo + 1, mast = 4 + (hash3(s, k, 94) % 5);
        if (hi - lo <= 3 && keel - 6 - mast > SEA_ROW + 1) st = { kind: 'wreck', x0, x1, y0: keel - 6 - mast, y1: hi, keel, mast, k };
      }
    }
    if (this.wrecks.size > 64) this.wrecks.clear();
    this.wrecks.set(k, st);
    return st;
  }

  /**
   * Town t's harbour, if it's by the sea (worlds made since capitals): { kind: 'harbor', side (the
   * way the sea is: -1 or 1), shore (the first column of water), road (where the road down to it
   * from the town starts), x0, x1, y0, y1, deck (the pier's row: just over the water), len (the
   * pier's length), light (the lighthouse's first column, or null: a village's has none), boats:
   * [{ x, w, big }] (moored out past the pier) }, or null. Worked out once.
   */
  harborOf(t) {
    if (!this.capitals || !t) return null;
    if (t.harbor !== undefined) return t.harbor;
    t.harbor = null;
    const last = t.k + (t.capital ? 1 : 0), s = this.seed;
    for (const [ks, side] of [[last + 1, 1], [t.k - 1, -1]]) {
      const sp = this.seaSpan(ks);
      if (!sp) continue;
      const shore = side > 0 ? sp.x0 : sp.x1, room = (sp.x1 - sp.x0) * 0.6;
      const len = Math.min(room, t.capital ? 64 : t.kind === 'city' ? 48 : 30), light = t.kind === 'village' ? null : shore + side * len;
      const boats = [], h = hash3(s, t.k, 440);
      let at = shore + side * (len + (light === null ? 3 : 8));
      for (const big of t.capital ? [true, false] : t.kind === 'city' ? [false, false] : [false]) {
        const w = big ? 24 : 10 + (h % 3);
        if (Math.abs(at + side * w - shore) > room) break;
        boats.push({ x: side > 0 ? at : at - w + 1, w, big });
        at += side * (w + 6);
      }
      const road = side > 0 ? t.x1 + TOWN_RAMP + 1 : t.x0 - TOWN_RAMP - 1, far = at;
      const x0 = Math.min(road, far), x1 = Math.max(road, far);
      let bottom = SEA_ROW;
      for (let x = x0; x <= x1; x++) bottom = Math.max(bottom, this.column(x).surf);
      t.harbor = { kind: 'harbor', town: t.id, name: `${t.name} harbour`, side, shore, road, x0, x1, y0: SEA_ROW - 32, y1: bottom, deck: SEA_ROW - 1, len, light, boats };
      break;
    }
    return t.harbor;
  }

  /** The harbour covering tile (x, y), if any. */
  harborAt(x, y) {
    if (!this.capitals) return null;
    const k = this.regionAt(x);
    for (let j = k - 2; j <= k + 2; j++) {
      const h = this.harborOf(this.townIn(j));
      if (h && x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1) return h;
    }
    return null;
  }

  /** The ruins, cabins, shipwrecks and harbours touching the tile box (inclusive). */
  // ---- Monster towers and sky islands (worlds made since towers) -------------------------------------

  /**
   * Region k's monster tower, if it has one: in every dangerous land, and now and then elsewhere
   * (not by the sea, nor in a town's region, nor near where everyone starts), on ground as level as
   * the region has. Floors one over another, FLOOR_H rows apart, a ladder up through each (one
   * side, then the other); monsters in it (lairs.js), a crate on every other floor, the treasure
   * on the top floor, and the roof with its battlements over that. { kind: 'tower', k, x0, x1, base
   * (the ground floor's row), floors, top (the roof's row), y0, y1, mat, wall, danger, name }.
   */
  tower(k) {
    if (!this.wilds) return null;
    let t = this.towerPlans.get(k);
    if (t !== undefined) return t;
    t = null;
    const s = this.seed, b = this.regionBiome(k), danger = b.danger || 0;
    if (!b.sea && Math.abs(k - this.spawnRegion) > 2 && !this.townOf(k) && (danger || hash3(s, k, 201) % 100 < 22)) {
      const lo = this.edge(k) + 40, hi = this.edge(k + 1) - 40 - TOWER_W;
      let best = null;
      for (let i = 0; hi > lo && i < 6; i++) {
        const x0 = lo + (hash3(s, k, 202 + i) % (hi - lo));
        let min = Infinity, max = -Infinity, ok = true;
        for (let x = x0 - 2; x <= x0 + TOWER_W + 1 && ok; x++) {
          const c = this.column(x);
          min = Math.min(min, c.surf); max = Math.max(max, c.surf);
          if (c.town || (this.seas && this.waterTop(x, c) < WORLD_H)) ok = false;
        }
        for (let r = Math.floor((x0 - 20) / RUIN_CELL); r <= Math.floor((x0 + TOWER_W + 20) / RUIN_CELL) && ok; r++) {
          const ru = this.ruin(r);
          if (ru && ru.x1 >= x0 - 4 && ru.x0 <= x0 + TOWER_W + 4) ok = false;
        }
        if (ok && (!best || max - min < best.max - best.min)) best = { x0, min, max };
      }
      if (best && best.max - best.min <= 10) {
        const floors = (danger ? 8 : 6) + (hash3(s, k, 210) % 3), base = best.min, top = base - floors * FLOOR_H;
        const mat = danger ? K.DARK_BRICKS : b.key === 'desert' || b.key === 'badlands' ? K.SANDSTONE_BRICKS : K.STONE_BRICKS;
        const wall = danger ? K.DARK_BRICK_WALL : b.key === 'desert' || b.key === 'badlands' ? K.SANDSTONE_BRICK_WALL : K.STONE_BRICK_WALL;
        t = { kind: 'tower', k, x0: best.x0, x1: best.x0 + TOWER_W - 1, base, floors, top, y0: top - 3, y1: best.max + 1, mat, wall, danger, name: towerName(s, k, danger) };
      }
    }
    if (this.towerPlans.size > 128) this.towerPlans.clear();
    this.towerPlans.set(k, t);
    return t;
  }

  /** The monster tower with column x in it, or within m tiles of it, or null. */
  towerNear(x, m = 0) {
    if (!this.wilds) return null;
    const k = this.regionAt(x);
    for (const j of [k, k - 1, k + 1]) {
      const t = this.tower(j);
      if (t && x >= t.x0 - m && x <= t.x1 + m) return t;
    }
    return null;
  }

  /** What tower T puts at (x, y): [block or -1, wall or -1]. */
  towerTile(T, x, y) {
    const { x0, x1, base, top, mat, wall } = T, s = this.seed;
    // Its foundations, down to the lowest ground under it.
    if (y > base) return [mat, -1];
    // Battlements round the roof.
    if (y < top) return (y === top - 1 && (x === x0 || x === x1 || (x - x0) % 3 === 0)) || (y === top - 2 && (x === x0 || x === x1)) ? [mat, -1] : [K.AIR, -1];
    const d = base - y, i = Math.floor(d / FLOOR_H), r = d % FLOOR_H, mid = (x0 + x1) >> 1;
    // (Each floor's way up: a ladder from the floor below through a hole in it, one side then the other.)
    const hole = n => (n % 2 ? x0 + 2 : x1 - 2);
    if (r === 0 && d > 0) {
      // A floor (the roof, the last): solid but for the hole the ladder comes up through.
      if (x === x0 || x === x1) return [mat, -1];
      return x === hole(i) ? [K.LADDER, wall] : [i === T.floors ? mat : K.PLANKS, wall];
    }
    if (d === 0) return [mat, -1];
    // The outer walls: a doorway on the ground floor, slits of windows above.
    if (x === x0 || x === x1) {
      if (i === 0 && x === x0 && r <= 3) return [K.AIR, wall];
      if (i > 0 && (r === 4 || r === 5) && (i + (x === x0 ? 0 : 1)) % 2 === 0) return [K.AIR, wall];
      return [mat, -1];
    }
    // Inside, floor i: the ladder up to the next floor; old walls behind, cracked here and there.
    const back = rand3(s, x * 13 + y, 220) < 0.12 ? K.NO_WALL : wall;
    if (x === hole(i + 1) && i < T.floors) return [K.LADDER, back];
    if (r === 1) {
      // What stands on each floor: the treasure on the top one, a crate on every other, barrels and books.
      if (i === T.floors - 1 && x === mid) return [K.TREASURE, back];
      if (i % 2 === 1 && x === (hole(i + 1) === x0 + 2 ? x1 - 2 : x0 + 2)) return [K.LOOT_CRATE, back];
      if (rand3(s, x * 7 + i, 221) < 0.12 && Math.abs(x - mid) > 1) return [rand3(s, x, 222 + i) < 0.5 ? K.BARREL : K.BOOKSHELF, back];
    }
    // (Torches by the walls, on every other floor.)
    if (r === 5 && i % 2 === 0 && (x === x0 + 1 || x === x1 - 1)) return [K.TORCH, wall];
    return [K.AIR, back];
  }

  /**
   * Region k's sky island, if it has one: a lump of earth floating high over the land (not near
   * where everyone starts), grass on top, a tree and treasure on it. { kind: 'isle', k, cx, top
   * (its grass's row), rx (half its width), depth, x0, x1, y0, y1 }.
   */
  isle(k) {
    if (!this.wilds) return null;
    let I = this.isles.get(k);
    if (I !== undefined) return I;
    I = null;
    const s = this.seed;
    if (Math.abs(k - this.spawnRegion) > 2 && hash3(s, k, 230) % 100 < 18) {
      const mid = (this.edge(k) + this.edge(k + 1)) >> 1, cx = mid - 60 + (hash3(s, k, 231) % 121), rx = 8 + (hash3(s, k, 232) % 7);
      let high = Infinity;
      for (let x = cx - rx - 8; x <= cx + rx + 8; x += 2) high = Math.min(high, this.surfaceAt(x));
      const top = Math.min(high, SURFACE) - 46 - (hash3(s, k, 233) % 30);
      // (Never over a town, its treasure under the town's protection, nor over a tower.)
      const clear = !(this.towns && this.townNear(cx, rx + 12)) && !this.towerNear(cx, rx + 6);
      if (top > 30 && clear) I = { kind: 'isle', k, cx, top, rx, depth: Math.round(rx * 0.9), x0: cx - rx, x1: cx + rx, y0: top - 9, y1: top + rx + 1 };
    }
    if (this.isles.size > 128) this.isles.clear();
    this.isles.set(k, I);
    return I;
  }

  /** What sky island I puts at (x, y). */
  isleTile(I, x, y) {
    const s = this.seed, dx = x - I.cx, ax = Math.abs(dx);
    // The grass on its top, a little lower at its edges; its underside hanging down to a ragged point.
    const surf = I.top + (ax >= I.rx - 1 ? 1 : 0);
    const under = I.top + Math.round(I.depth * (1 - (ax / (I.rx + 0.5)) ** 1.6)) + (hash3(s, x, 234) % 2);
    if (y >= surf) {
      if (y > under) return [-1, -1];
      if (y === surf) return [K.GRASS, -1];
      if (y < surf + 3) return [K.DIRT, -1];
      return [rand3(s, x * 31 + y, 235) < 0.05 ? K.GOLD : K.STONE, -1];
    }
    // On it: a tree off to one side, the treasure, grass and flowers.
    const tx = I.cx - Math.round(I.rx / 2) * (I.k % 2 ? 1 : -1);
    if (x === tx && y >= surf - 5) return [K.TRUNK, -1];
    if (ell(x - tx, y - (surf - 6), 2.6, 1.9)) return [K.LEAVES, -1];
    if (y === surf - 1) {
      if (x === I.cx + (I.k % 2 ? 3 : -3)) return [K.TREASURE, -1];
      const r = rand3(s, x, 236);
      if (ax < I.rx - 1 && r < 0.45) return [r < 0.12 ? K.FLOWER : K.TALL_GRASS, -1];
    }
    return [-1, -1];
  }

  structuresIn(x0, y0, x1, y1) {
    const out = [];
    // (Worlds made since towers: monster towers, and sky islands.)
    if (this.wilds) {
      for (let k = this.regionAt(x0) - 1; k <= this.regionAt(x1) + 1; k++) {
        const t = this.tower(k);
        if (t && t.x1 >= x0 && t.x0 <= x1 && t.y1 >= y0 && t.y0 <= y1) out.push(t);
        const I = this.isle(k);
        if (I && I.x1 >= x0 && I.x0 <= x1 && I.y1 >= y0 && I.y0 <= y1) out.push(I);
      }
    }
    if (this.capitals) {
      for (let k = this.regionAt(x0) - 2; k <= this.regionAt(x1) + 2; k++) {
        const h = this.harborOf(this.townIn(k));
        if (h && h.x1 >= x0 && h.x0 <= x1 && h.y1 >= y0 && h.y0 <= y1) out.push(h);
      }
    }
    if (this.seas && y1 > SEA_ROW) {
      for (let k = this.regionAt(x0 - 30); k <= this.regionAt(x1 + 30); k++) {
        const r = this.wreck(k);
        if (r && r.x1 >= x0 && r.x0 <= x1 && r.y1 >= y0 && r.y0 <= y1) out.push(r);
      }
    }
    for (let k = Math.floor((x0 - 20) / RUIN_CELL); k <= Math.floor((x1 + 20) / RUIN_CELL); k++) {
      const r = this.ruin(k);
      if (r && r.x1 >= x0 && r.x0 <= x1 && r.y1 >= y0 && r.y0 <= y1) out.push(r);
    }
    for (let i = Math.floor((x0 - 20) / CABIN_W); i <= Math.floor((x1 + 20) / CABIN_W); i++) {
      for (let j = Math.max(0, Math.floor(y0 / CABIN_H)); j <= Math.floor(y1 / CABIN_H); j++) {
        const c = this.cabin(i, j);
        if (c && c.x1 >= x0 && c.x0 <= x1 && c.y1 >= y0 && c.y0 <= y1) out.push(c);
      }
    }
    return out;
  }

  inStructure(x, y) { return this.structuresIn(x, y, x, y).length > 0; }

  /** What structure st puts at (x, y): [block or -1 (leave it), wall or -1]. */
  structureTile(st, x, y) {
    const s = this.seed;
    if (st.kind === 'wreck') return this.wreckTile(st, x, y);
    if (st.kind === 'tower') return this.towerTile(st, x, y);
    if (st.kind === 'isle') return this.isleTile(st, x, y);
    if (st.kind === 'harbor') return this.harborTile(st, x, y);
    if (st.kind === 'ruin') {
      const { x0, x1, base, mat, wall } = st, top = base - 6;
      const broken = rand3(s, x * 31 + y, 64) < 0.22;
      if (y > base) return x >= x0 && x <= x1 && y <= st.y1 ? [mat, -1] : [-1, -1]; // (foundations down to the ground)
      if (y === base) return [mat, -1];
      if (y < top) return [-1, -1];
      const edge = x === x0 || x === x1;
      if (y === top) return [broken && !edge ? K.AIR : mat, -1];
      // (A doorway in the left wall: three blocks high, a soldier's height and a bit.)
      if (edge) return [x === x0 && y >= base - 3 ? K.AIR : broken && y < base - 3 ? K.AIR : mat, -1];
      // Inside: open, with the wall behind (some of it fallen), and a crate.
      if (x === x0 + 2 && y === base - 1) return [K.LOOT_CRATE, wall];
      return [K.AIR, broken ? K.NO_WALL : wall];
    }
    // A cabin: plank shell, plank walls inside, a shelf, a torch and a crate.
    const { x0, x1, y0, y1 } = st;
    if (x === x0 || x === x1 || y === y0 || y === y1) return [x === x1 && y >= y1 - 3 && y < y1 ? K.DOOR : K.PLANKS, K.PLANK_WALL];
    if (y === y1 - 3 && x >= x1 - 4 && x < x1) return [K.PLATFORM, K.PLANK_WALL];
    if (x === x0 + 2 && y === y1 - 1) return [K.LOOT_CRATE, K.PLANK_WALL];
    if (x === ((x0 + x1) >> 1) && y === y0 + 2) return [K.TORCH, K.PLANK_WALL];
    return [K.AIR, K.PLANK_WALL];
  }

  /**
   * A shipwreck's tile: the hull rising from its keel (in the sand) to its deck, the bow and stern
   * curving up, holes broken in it; water in its hold, with the cargo; a broken mast; sand banked
   * up under it where the floor's lower.
   */
  wreckTile(st, x, y) {
    const { x0, x1, keel, mast } = st, s = this.seed, deck = keel - 5, mid = (x0 + x1) >> 1;
    const r = keel - y, inset = Math.max(0, 3 - r), l = x0 + inset, rr = x1 - inset;
    const broken = rand3(s, x * 7 + y * 131, 95) < (y === deck ? 0.22 : 0.1);
    if (y > keel) return y <= this.column(x).surf - 1 ? [K.SAND, -1] : [-1, -1];
    if (y < deck) {
      // The mast (broken off), and a cabin at the stern: its walls and roof, half fallen in.
      if (x === mid && y >= deck - mast) return [K.LOG, -1];
      const c0 = x1 - 6;
      if (x >= c0 && x <= x1 - 1 && y >= deck - 3) {
        if (x === c0 || x === x1 - 1 || y === deck - 3) return [broken || (y === deck - 3 && x < c0 + 2) ? K.WATER : K.OLD_PLANKS, -1];
        return [K.WATER, K.PLANK_WALL];
      }
      return [-1, -1];
    }
    if (x < l || x > rr) return [-1, -1];
    const shell = y === keel || y === deck || x === l || x === rr;
    if (shell) return [broken && y !== keel ? K.WATER : K.OLD_PLANKS, -1];
    // The hold: under water, the planks behind; the cargo on its floor.
    if (y === keel - 1 && (x === l + 2 || x === rr - 3)) return [K.LOOT_CRATE, K.PLANK_WALL];
    return [K.WATER, broken ? -1 : K.PLANK_WALL];
  }

  /**
   * A harbour's tile: the road down from the town (paved, a lamp now and then); the pier out over
   * the water (a deck on pilings down to the sea floor, barrels, lanterns on posts); a lighthouse at
   * its end (on a stone footing up out of the water: banded, a ladder up inside, the light at the
   * top under glass); and boats moored out past it (a hull on the water, dry inside, a mast and a
   * sail; a capital's, a great ship with two masts and a cabin).
   */
  harborTile(H, x, y) {
    const { side, shore, deck } = H, d = (x - shore) * side, col = this.column(x), surf = col.surf;
    // The road, on the land between the town and the water.
    if (d < 0 && surf <= deck) {
      if (y === surf) return [K.COBBLESTONE, -1];
      if (Math.abs(x - H.road) % 12 === 6) { if (y === surf - 1 || y === surf - 2) return [K.FENCE, -1]; if (y === surf - 3) return [K.LANTERN, -1]; }
      return [-1, -1];
    }
    // The lighthouse.
    if (H.light !== null) {
      const l0 = side > 0 ? H.light : H.light - 4, l1 = l0 + 4;
      if (x >= l0 && x <= l1) {
        if (y > deck) return y < surf ? [K.STONE_BRICKS, -1] : [-1, -1];
        const top = deck - 18, edge = x === l0 || x === l1, mid = x === l0 + 2;
        if (y === deck) return [K.STONE_BRICKS, -1];
        if (y < top - 4) return [-1, -1];
        if (y <= top - 1) {
          // Its lamp room: glass round it, the light inside, a roof over it.
          if (y === top - 4) return [x === l0 + 2 ? K.ROOF_TILES : -1, -1];
          if (y === top - 3) return [Math.abs(x - (l0 + 2)) <= 1 ? K.ROOF_TILES : -1, -1];
          if (edge) return [K.GLASS, -1];
          return [mid ? K.TORCH : K.LANTERN, K.STONE_BRICK_WALL];
        }
        if (y === top) return [mid ? K.LADDER : K.STONE_BRICKS, K.STONE_BRICK_WALL];
        if (edge) {
          // (A door at its foot, facing the pier.)
          if (y >= deck - 3 && x === (side > 0 ? l0 : l1)) return [K.DOOR, -1];
          return [Math.floor((deck - y) / 3) % 2 ? K.PLASTER : K.BRICKS, -1];
        }
        if (mid) return [K.LADDER, K.STONE_BRICK_WALL];
        if ((deck - y) % 6 === 0) return [K.PLATFORM, K.STONE_BRICK_WALL];
        return [K.AIR, K.STONE_BRICK_WALL];
      }
    }
    // The pier.
    if (d >= -2 && d <= H.len && surf > deck) {
      if (y === deck) return [K.PLATFORM, -1];
      if (y > deck && y < surf && d % 4 === 0) return [K.LOG, -1];
      if (y === deck - 1 && d % 8 === 4) return [K.FENCE, -1];
      if (y === deck - 2 && d % 8 === 4) return [K.LANTERN, -1];
      if (y === deck - 1 && d % 11 === 7) return [K.BARREL, -1];
      return [-1, -1];
    }
    // Boats.
    for (const b of H.boats) {
      if (x < b.x || x >= b.x + b.w) continue;
      return this.boatTile(b, x, y, side);
    }
    return [-1, -1];
  }

  /**
   * A boat's tile (b: its first column and width; big: a great ship). Its hull on the water,
   * narrowing to its keel, dry inside; a mast (two on a great ship) with a sail; a great ship's
   * deck over its hold, and a cabin at its stern.
   */
  boatTile(b, x, y, side) {
    const S = SEA_ROW, i = x - b.x, w = b.w, dd = b.big ? 3 : 1, free = b.big ? 3 : 1;
    if (y > S + dd || y < S - free - 12) return [-1, -1];
    // The hull: each row's sides closer in, the further down.
    if (y >= S - free) {
      const inset = Math.max(0, y - S + 1), l = inset, r = w - 1 - inset;
      if (i < l || i > r) return [-1, -1];
      if (y === S + dd) return [K.OLD_PLANKS, -1];
      if (i === l || i === r) return [b.big ? K.OLD_PLANKS : K.PLANKS, -1];
      if (b.big && y === S - 1) return [K.PLANKS, -1]; // (its deck, over the hold)
      if (y >= S) return [i === 3 && y === S + dd - 1 ? K.BARREL : K.AIR, b.big ? K.PLANK_WALL : -1];
      return [K.AIR, -1];
    }
    // Above the hull: masts and sails; a great ship's cabin at its stern.
    const top = S - free - 1, masts = b.big ? [6, 15] : [w >> 1];
    for (const m of masts) {
      if (i === m && y >= top - (b.big ? 11 : 7)) return [K.LOG, -1];
      if ((i === m + 1 || i === m + 2 || (b.big && i === m - 1)) && y <= top - 1 && y >= top - (b.big ? 9 : 6)) return [K.SAIL, -1];
    }
    if (b.big) {
      const c0 = side > 0 ? w - 6 : 1, c1 = c0 + 4;
      if (i >= c0 && i <= c1 && y >= top - 3) {
        if (y === top - 3) return [K.PLANKS, -1];
        if (i === c0 || i === c1) return [y >= top - 2 && y <= top && i === (side > 0 ? c0 : c1) ? K.DOOR : K.PLANKS, -1];
        return [i === c0 + 2 && y === top - 2 ? K.LANTERN : K.AIR, K.PLANK_WALL];
      }
      if (y === top && (i === 2 || i === w - 3)) return [K.FENCE, -1];
    }
    return [-1, -1];
  }

  // ---- Towns (towns.js) --------------------------------------------------------------------------

  /** Region k's town, or null (worked out once). */
  townIn(k) {
    if (!this.towns) return null;
    let t = this.townPlans.get(k);
    if (t === undefined) {
      t = planTown(this, k);
      if (this.townPlans.size > 64) this.townPlans.clear();
      this.townPlans.set(k, t);
    }
    return t;
  }

  /** The town whose land (its level part, or the ramps either side) column x is in, or null. */
  townAtX(x) {
    const t = this.townOf(this.regionAt(x));
    return t && x >= t.x0 - TOWN_RAMP && x <= t.x1 + TOWN_RAMP ? t : null;
  }

  /** The town within `margin` tiles of column x (across), or null. */
  townNear(x, margin = 0) {
    const t = this.townOf(this.regionAt(x));
    return t && x >= t.x0 - margin && x <= t.x1 + margin ? t : null;
  }

  /** The town in region k: its own, or (worlds made since capitals) the capital that takes it and the region before. */
  townOf(k) {
    return this.townIn(k) || (this.capitals && this.capitalStart(k - 1) ? this.townIn(k - 1) : null);
  }

  /** The town protecting tile (x, y) from being dug, built on or blasted (or its harbour: named for it), or null. */
  townProtecting(x, y) {
    const t = this.townNear(x, 1);
    if (t && y >= t.top && y <= t.bottom) return t;
    return this.capitals ? this.harborAt(x, y) : null;
  }

  /** Town t's blocks (towns.js's raster), made the first time they're asked for (a few are kept). */
  townRaster(t) {
    let R = this.townRasters.get(t.id);
    if (!R) {
      R = buildTown(this.seed, t);
      if (this.townRasters.size >= 6) this.townRasters.delete(this.townRasters.keys().next().value);
      this.townRasters.set(t.id, R);
    }
    return R;
  }

  /** The block town t puts at (x, y), or -1 (the land's own). */
  townBlock(t, x, y) {
    if (y < t.top || y > t.bottom) return -1;
    const R = this.townRaster(t), j = R.at(x, y);
    return j < 0 ? -1 : R.fg[j];
  }

  // ---- A whole chunk ------------------------------------------------------------------------------

  /** Fill chunk (cx, cy)'s tiles: fg (blocks), bg (walls), shape (all full to start with: towns' roofs slope). */
  fillChunk(cx, cy, fg, bg, shape = null) {
    const x0 = cx * CHUNK, y0 = cy * CHUNK, s = this.seed;
    fg.fill(K.AIR);
    bg.fill(K.NO_WALL);
    for (let lx = 0; lx < CHUNK; lx++) {
      const x = x0 + lx;
      // Past the ends of the world: bedrock all the way up.
      if (x < -HALF_W || x >= HALF_W) { for (let ly = 0; ly < CHUNK; ly++) fg[ly * CHUNK + lx] = K.BEDROCK; continue; }
      const col = this.column(x);
      // (Its water, and the bed under it: rock() needs that.)
      if (this.seas) this.waterTop(x, col);
      for (let ly = 0; ly < CHUNK; ly++) {
        const y = y0 + ly, i = ly * CHUNK + lx;
        if (y < col.surf) continue;
        const depth = y - col.surf;
        if (depth >= 2) bg[i] = this.naturalWall(y, col);
        if (this.cave(x, y, col.surf, col.town)) continue;
        let b = this.rock(x, y, col);
        if (b === K.STONE || b === K.SLATE || b === K.BASALT) b = this.ore(x, y, depth, b);
        fg[i] = b;
      }
    }
    // Water over the ground (worlds made since seas): the sea's and lakes', iced over in the cold.
    if (this.seas) this.fillWater(x0, y0, fg);
    // Ruins, cabins and shipwrecks over the ground and rock.
    for (const st of this.structuresIn(x0, y0, x0 + CHUNK - 1, y0 + CHUNK - 1)) {
      for (let y = Math.max(y0, st.y0); y <= Math.min(y0 + CHUNK - 1, st.y1); y++) {
        for (let x = Math.max(x0, st.x0); x <= Math.min(x0 + CHUNK - 1, st.x1); x++) {
          const [b, w] = this.structureTile(st, x, y), i = (y - y0) * CHUNK + (x - x0);
          if (b >= 0) fg[i] = b;
          if (w >= 0) bg[i] = w;
        }
      }
    }
    // A town (towns.js) over the ground: its blocks, walls and roofs' shapes.
    const town = this.towns ? this.townAtX(x0) || this.townAtX(x0 + CHUNK - 1) : null;
    if (town && y0 <= town.bottom && y0 + CHUNK - 1 >= town.top) {
      const R = this.townRaster(town);
      for (let y = Math.max(y0, R.y0); y <= Math.min(y0 + CHUNK - 1, R.y1); y++) {
        for (let x = Math.max(x0, R.x0); x <= Math.min(x0 + CHUNK - 1, R.x1); x++) {
          const j = R.at(x, y), i = (y - y0) * CHUNK + (x - x0);
          if (R.fg[j] >= 0) { fg[i] = R.fg[j]; if (shape) shape[i] = R.sh[j]; }
          if (R.bg[j] >= 0) bg[i] = R.bg[j];
        }
      }
    }
    // Trees (crowns reach a few tiles either side of the trunk). Worlds made since forests: their
    // own trees, and fallen logs, boulders and bamboo.
    if (this.forests) { this.fillTrees5(x0, y0, fg); this.fillGround5(x0, y0, fg); }
    else for (let x = x0 - 5; x < x0 + CHUNK + 5; x++) {
      const t = this.treeAt(x);
      if (!t) continue;
      const top = t.base - t.h - 4;
      for (let y = Math.max(y0, top); y < Math.min(y0 + CHUNK, t.base); y++) {
        for (let tx = Math.max(x0, t.x - 5); tx < Math.min(x0 + CHUNK, t.x + 6); tx++) {
          const i = (y - y0) * CHUNK + (tx - x0);
          if (fg[i] !== K.AIR) continue;
          const b = this.treeTile(t, tx, y);
          if (b !== K.AIR) fg[i] = b;
        }
      }
    }
    // What grows in the water: seagrass, kelp, coral, reeds, lily pads.
    if (this.seas) this.waterLife(x0, y0, fg);
    // Plants on the ground, mushrooms on cave floors, vines from jungle cave roofs.
    for (let lx = 0; lx < CHUNK; lx++) {
      const x = x0 + lx;
      if (x < -HALF_W || x >= HALF_W) continue;
      const col = this.column(x), b = col.biome;
      const inTown = col.town && x >= col.town.x0 && x <= col.town.x1;
      for (let ly = 0; ly < CHUNK; ly++) {
        const y = y0 + ly, i = ly * CHUNK + lx;
        if (fg[i] !== K.AIR) continue;
        if (inTown && y < col.surf + 4) continue;
        const below = ly < CHUNK - 1 ? fg[i + CHUNK] : this.groundTile(x, y + 1);
        // (Worlds made since forests: their own undergrowth, on whatever the ground's top is.)
        if (this.forests && y === col.surf - 1 && GROUNDS.has(below)) {
          const p = this.undergrowth(x, col);
          if (p) fg[i] = p;
          continue;
        }
        if (y === col.surf - 1 && below === b.top) {
          const r = rand3(s, x, 81);
          if (r < b.flowers) fg[i] = K.FLOWER;
          else if (r < b.flowers + b.plants) fg[i] = b.plant ?? K.TALL_GRASS;
          continue;
        }
        if (y > col.surf + 30 && bg[i] !== K.NO_WALL && K.SOLID[below] && rand3(s, x, y + 82) < 0.035) { fg[i] = K.MUSHROOM; continue; }
        if (b.key === 'jungle' && y > col.surf + 4 && ly > 0 && K.SOLID[fg[i - CHUNK]] && rand3(s, x, y + 83) < 0.25) {
          for (let k = 0, n = 1 + (hash3(s, x, y + 84) % 4); k < n && ly + k < CHUNK && fg[i + k * CHUNK] === K.AIR; k++) fg[i + k * CHUNK] = K.VINE;
        }
      }
    }
  }

  /** Chunk (x0, y0)'s water (fg: its blocks): the sea's or a lake's, down to the ground; ice on top in the cold. */
  fillWater(x0, y0, fg) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const x = x0 + lx, wt = this.waterTop(x), col = this.column(x);
      if (wt >= col.surf || wt >= y0 + CHUNK || col.surf <= y0) continue;
      const frozen = col.lake ? col.lake.frozen : this.seaAt(x)?.biome.frozen;
      for (let y = Math.max(y0, wt); y < Math.min(y0 + CHUNK, col.surf); y++) {
        const i = (y - y0) * CHUNK + lx;
        if (fg[i] !== K.AIR) continue;
        fg[i] = frozen && y === wt && rand3(this.seed, x, 97) > 0.12 ? K.ICE : K.WATER;
      }
    }
  }

  /**
   * What grows in chunk (x0, y0)'s water (fg: its blocks, water in already): on the floor of
   * seas, seagrass and kelp (tall, in deeper water; not much in the cold), and in warm seas coral
   * reefs (blocks of coral, and fans); in lakes and pools, seagrass, reeds in the shallows at
   * the edges and lily pads on top.
   */
  waterLife(x0, y0, fg) {
    const s = this.seed;
    // (Nothing growing in a shipwreck, or through it.)
    const wrecks = y0 + CHUNK > SEA_ROW ? this.structuresIn(x0, SEA_ROW, x0 + CHUNK - 1, WORLD_H - 1).filter(st => st.kind === 'wreck' || st.kind === 'harbor') : [];
    for (let lx = 0; lx < CHUNK; lx++) {
      const x = x0 + lx, wt = this.waterTop(x), col = this.column(x), bottom = col.surf - 1;
      if (wt > bottom || wt >= y0 + CHUNK || bottom < y0) continue;
      if (wrecks.some(st => x >= st.x0 - 1 && x <= st.x1 + 1)) continue;
      const deep = col.surf - wt, r = rand3(s, x, 98), lake = col.lake;
      const put = (ya, yb, b) => {
        for (let y = Math.max(y0, ya); y <= Math.min(y0 + CHUNK - 1, yb); y++) { const i = (y - y0) * CHUNK + lx; if (fg[i] === K.WATER) fg[i] = b; }
      };
      if (lake) {
        if (lake.frozen) continue;
        const edge = Math.abs(x - lake.mid) >= lake.w - 4;
        if (edge && deep <= 2 && r < 0.55) put(wt, wt, K.REEDS);
        else if (deep >= 2 && r < 0.14) put(wt, wt, K.LILY_PAD);
        else if (r > 0.75) put(bottom, bottom, K.SEAGRASS);
        continue;
      }
      const sea = this.seaAt(x)?.biome;
      if (!sea) continue;
      if (sea.coral && deep >= 4 && noise2(s + 71, x / 26, 0.5) > -0.1) {
        // A reef: coral a block or a few high, fans between.
        if (r < 0.42) put(bottom - (hash3(s, x, 99) % 3), bottom, [K.CORAL, K.CORAL_BLUE, K.CORAL_GOLD][hash3(s, x, 100) % 3]);
        else if (r < 0.7) put(bottom, bottom, K.CORAL_FAN);
        else if (r < 0.85) put(bottom, bottom, K.SEAGRASS);
        continue;
      }
      if (deep >= 6 && r < (sea.frozen ? 0.05 : 0.12)) put(bottom - 1 - (hash3(s, x, 101) % (deep - 4)), bottom, K.KELP);
      else if (r < (sea.frozen ? 0.15 : 0.45)) put(bottom, bottom, K.SEAGRASS);
    }
  }

  /** The block at (x, y) as the ground and rock have it (no trees or plants): for looking past a chunk's edge. */
  groundTile(x, y) {
    if (y < 0 || y >= WORLD_H) return y < 0 ? K.AIR : K.BEDROCK;
    const col = this.column(x);
    if (col.town && this.towns) { const v = this.townBlock(col.town, x, y); if (v >= 0) return v; }
    if (this.seas && this.waterTop(x, col) <= y && y < col.surf) return K.WATER;
    if (y < col.surf || this.cave(x, y, col.surf, col.town)) return K.AIR;
    for (const st of this.structuresIn(x, y, x, y)) { const [b] = this.structureTile(st, x, y); if (b >= 0) return b; }
    const b = this.rock(x, y, col);
    return b === K.STONE || b === K.SLATE || b === K.BASALT ? this.ore(x, y, y - col.surf, b) : b;
  }

  /** Where everyone starts: on the ground near the middle of the world (pixels: the soldier's origin). */
  spawn(tile = 16, bottom = 12) {
    const surf = this.surfaceAt(this.spawnX);
    return { x: this.spawnX * tile + tile / 2, y: surf * tile - bottom - 1 };
  }
}

const smooth = t => t * t * (3 - 2 * t);
/** Whether (dx, dy) is inside an ellipse of radii rx, ry round the middle. */
const ell = (dx, dy, rx, ry) => (dx / rx) ** 2 + (dy / ry) ** 2 <= 1;
// Trees two trunks wide; palms' spacing on warm shores.
const WIDE = new Set(['dark_oak', 'mega_spruce', 'big_jungle']);
const PALMS = { cell: 6, p: 0.45, kinds: [['palm', 1]] };
const mix = (a, b, t) => a + (b - a) * smooth(t);

/**
 * Land d tiles from the edge of a sea (worlds made since seas), at height h: raised if it's
 * lower than the coast is there, so it's above the sea from SHORE tiles in (the shore's always
 * near the edge, whatever the land's like further in), rising a little more, then letting go.
 */
function coastLift(h, d) {
  const floor = d < SHORE ? SEA_H + 1 - (SHORE - d) * 0.5 : d < 70 ? SEA_H + 1 + (d - SHORE) / 12 : SEA_H + 1 + (70 - SHORE) / 12 - (d - 70) * 0.5;
  return Math.max(h, floor);
}
