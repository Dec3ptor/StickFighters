// Towns (world mode): villages and walled cities along the surface, each built in the style of
// the biome it's in: timber, plaster and tiled roofs in the plains and forests, sandstone with
// flat roofs, awnings and domes in the deserts, log cabins with snowy roofs in the tundra, and
// huts on stilts in the jungle. A village is a dozen buildings round a well: the elder's house,
// a shop, a smithy, houses, maybe a farm and a watchtower. A city has a tower with a gate at
// each end, a plaza, a keep, a market, an inn, a temple, a smithy, a gunsmith, barracks and
// houses. Where towns are, how big, what's in them and what they're called all come from the
// world's seed (every computer makes the same ones):
//
//   planTown   where region k's town is (if it has one), its level, and its buildings
//   buildTown  its blocks, laid out once in a picture of its own (a raster), which
//              worldgen.js copies into each chunk the town touches
//
// worldgen.js levels the ground under a town (ramps either side) and digs no caves under it.
// Players can't dig, build or blast in a town (worldplay.js), and monsters don't come there.
//
// Worlds made since capitals (worldgen.js's gen 6) have capitals too, now and then: each takes two
// regions, hundreds of blocks across (planCapital, capitalLayout), with great gates, a grand
// plaza, a cathedral, a palace up on a terrace, rows of tall townhouses with walkways between
// their upper floors, and an undercity: a street of its own under the main street.

import { hash3, rand3 } from './noise.js';
import * as K from './blocks.js';

export const TOWN_RAMP = 14;      // tiles either side over which the land comes to a town's level
const MARGIN = 44;                // tiles a town keeps from its region's edges (where biomes' hills meet)
export const ABOVE = 48;          // rows a town's raster reaches above its ground
export const BELOW = 12;          // and below (foundations, the well): also how deep it's protected
const STOREY = 5;                 // rows a storey takes: four of room, one of floor
const RAMP_R = 3, RAMP_L = 4;     // blocks.js SHAPES: ramps rising to the right, to the left

// ---- Styles ---------------------------------------------------------------------------------------

/** How a town in each biome is built. `city` overrides for cities. */
const STYLES = {
  timber: {
    foundation: K.COBBLESTONE, floor: K.PLANKS, wall: K.TIMBER, back: K.TIMBER_WALL, ceiling: K.PLANKS,
    roof: K.THATCH, attic: K.PLANK_WALL, chimney: K.BRICKS, stone: K.STONE_BRICKS, stoneBack: K.STONE_BRICK_WALL,
    path: K.GRAVEL, roofShape: 'gable', snow: false, raised: 0, post: K.POST, names: 'timber',
    city: { roof: K.ROOF_TILES, path: K.COBBLESTONE, back: K.PLASTER_WALL },
  },
  adobe: {
    foundation: K.SANDSTONE_BRICKS, floor: K.SANDSTONE_BRICKS, wall: K.MUD_BRICKS, back: K.MUD_BRICK_WALL, ceiling: K.MUD_BRICKS,
    roof: K.MUD_BRICKS, attic: K.MUD_BRICK_WALL, chimney: null, stone: K.SANDSTONE_BRICKS, stoneBack: K.SANDSTONE_BRICK_WALL,
    path: null, roofShape: 'flat', snow: false, raised: 0, post: K.POST, names: 'adobe',
    city: { wall: K.SANDSTONE_BRICKS, back: K.SANDSTONE_BRICK_WALL, ceiling: K.SANDSTONE_BRICKS, roof: K.SANDSTONE_BRICKS, path: K.SANDSTONE_BRICKS },
  },
  cabin: {
    foundation: K.COBBLESTONE, floor: K.PLANKS, wall: K.LOG, back: K.LOG_WALL, ceiling: K.PLANKS,
    roof: K.PLANKS, attic: K.PLANK_WALL, chimney: K.STONE_BRICKS, stone: K.STONE_BRICKS, stoneBack: K.STONE_BRICK_WALL,
    path: K.COBBLESTONE, roofShape: 'gable', snow: true, raised: 0, post: K.POST, names: 'cabin',
    city: {},
  },
  stilt: {
    foundation: K.LOG, floor: K.PLANKS, wall: K.PLANKS, back: K.PLANK_WALL, ceiling: K.PLANKS,
    roof: K.THATCH, attic: K.PLANK_WALL, chimney: null, stone: K.MOSSY_BRICKS, stoneBack: K.STONE_BRICK_WALL,
    path: null, roofShape: 'gable', snow: false, raised: 4, post: K.POST, names: 'stilt',
    city: { path: K.STONE_BRICKS },
  },
};
const STYLE_OF = {
  plains: 'timber', forest: 'timber', desert: 'adobe', badlands: 'adobe', snow: 'cabin', jungle: 'stilt', swamp: 'stilt',
  birch_forest: 'timber', dark_forest: 'timber', meadow: 'timber', cherry_grove: 'timber', taiga: 'cabin', snowy_taiga: 'cabin', giant_taiga: 'cabin',
  savanna: 'adobe', bamboo_jungle: 'stilt',
};

// ---- Names ------------------------------------------------------------------------------------------

const NAME_PARTS = {
  timber: [
    ['Oak', 'Ash', 'Elm', 'Bright', 'Stone', 'Mill', 'Green', 'Wolf', 'Raven', 'Thorn', 'Hearth', 'Willow', 'Amber', 'Bram', 'Fox', 'Hollin', 'Marsh', 'Kings', 'Red', 'Swan', 'High', 'Cold', 'Barrow', 'Lark'],
    ['ford', 'vale', 'wick', 'ton', 'bury', 'stead', 'mere', 'field', 'brook', 'haven', 'hollow', 'cross', 'well', 'bridge', 'gate', 'moor', 'dale', 'combe', 'ley', 'holt'],
  ],
  adobe: [
    ['Zar', 'Khem', 'Sab', 'Ras', 'Qad', 'Tah', 'Mar', 'Kesh', 'Sul', 'Dar', 'Nah', 'Bey', 'Qal', 'Ash', 'Yas', 'Om', 'Fen', 'Hal'],
    ['ir', 'abad', 'ara', 'esh', 'um', 'ani', 'ah', 'arra', 'imah', 'ud', 'an', 'ezzi', 'bar', 'oud', 'is', 'eth'],
  ],
  cabin: [
    ['Frost', 'Ulf', 'Bjorn', 'Kald', 'Hvit', 'Isa', 'Skar', 'Rime', 'Snae', 'Vind', 'Grim', 'Hald', 'Storm', 'Jarn', 'Ylf', 'Sval'],
    ['heim', 'holm', 'gard', 'vik', 'fjall', 'stad', 'by', 'mark', 'ness', 'dal', 'haug', 'berg', 'havn', 'rud'],
  ],
  stilt: [
    ['Xi', 'Tza', 'Ka', 'Mo', 'Oza', 'Ix', 'Tla', 'Yax', 'Cho', 'Pa', 'Ku', 'Na', 'Ule', 'Ama'],
    ['lan', 'tepec', 'mal', 'coa', 'chal', 'tun', 'pan', 'ka', 'lok', 'huan', 'tzin', 'mec', 'ro', 'que'],
  ],
};

/** A town's name, from its style's syllables (the same for the same seed and region). */
function townName(seed, k, names) {
  const [a, b] = NAME_PARTS[names];
  const first = a[hash3(seed, k, 411) % a.length];
  let second = b[hash3(seed, k, 412) % b.length];
  // (No doubled letters where they meet: "Stoneevale".)
  if (first.at(-1) === second[0]) second = b[(hash3(seed, k, 412) + 1) % b.length];
  return first + second;
}

// ---- A seeded random number source (the same numbers on every computer) ----------------------------

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
  r.chance = p => r() < p;
  r.pick = list => list[Math.floor(r() * list.length)];
  return r;
}

// ---- Planning: where, how big, and what's in it --------------------------------------------------------

/** What buildings there are: their widths, how many storeys, and who lives or works there (NPCs). */
export const BUILDINGS = {
  house:    { w: [9, 13], storeys: [1, 2], role: 'villager', name: 'House' },
  elder:    { w: [15, 18], storeys: [2, 2], role: 'elder', name: "Elder's house" },
  shop:     { w: [11, 13], storeys: [1, 2], role: 'merchant', name: 'Shop' },
  smithy:   { w: [11, 13], storeys: [1, 1], role: 'smith', name: 'Smithy' },
  gunsmith: { w: [11, 13], storeys: [1, 2], role: 'gunsmith', name: "Gunsmith's" },
  inn:      { w: [15, 18], storeys: [3, 3], role: 'innkeeper', name: 'Inn' },
  temple:   { w: [14, 17], storeys: [1, 1], role: 'healer', name: 'Temple' },
  barracks: { w: [13, 15], storeys: [2, 2], role: 'guard', name: 'Barracks' },
  keep:     { w: [24, 29], storeys: [3, 3], role: 'lord', name: 'Keep' },
  market:   { w: [19, 25], storeys: [1, 1], role: 'trader', name: 'Market' },
  farm:     { w: [12, 17], storeys: [1, 1], role: 'farmer', name: 'Farm' },
  well:     { w: [7, 7], storeys: [1, 1], role: null, name: 'Well' },
  plaza:    { w: [14, 18], storeys: [1, 1], role: null, name: 'Plaza' },
  tower:    { w: [5, 5], storeys: [3, 3], role: 'guard', name: 'Watchtower' },
  gate:     { w: [7, 7], storeys: [4, 4], role: 'guard', name: 'Gatehouse' },
  // Capitals' (worlds made since capitals): their gates, landmarks, townhouses, and what's under their streets.
  greatgate: { w: [13, 13], storeys: [5, 5], role: 'guard', name: 'Great gate' },
  palace:   { w: [56, 66], storeys: [4, 4], role: 'lord', name: 'Palace' },
  cathedral: { w: [32, 38], storeys: [1, 1], role: 'healer', name: 'Cathedral' },
  grandplaza: { w: [30, 36], storeys: [1, 1], role: null, name: 'Grand plaza' },
  library:  { w: [16, 20], storeys: [3, 3], role: 'elder', name: 'Library' },
  guildhall: { w: [18, 22], storeys: [2, 3], role: 'merchant', name: 'Guild hall' },
  bank:     { w: [14, 16], storeys: [2, 2], role: 'trader', name: 'Counting house' },
  townhouse: { w: [8, 11], storeys: [2, 4], role: 'villager', name: 'Townhouse' },
  cellarbar: { w: [16, 20], storeys: [1, 1], role: 'innkeeper', name: 'Cellar tavern', under: true },
  blackmarket: { w: [14, 18], storeys: [1, 1], role: 'trader', name: 'Black market', under: true },
  vault:    { w: [10, 12], storeys: [1, 1], role: null, name: 'Vault', under: true },
};
// (Kinds built like a house: a shell of walls, storeys, doors at both ends, and a roof.)
const HOUSELIKE = new Set(['house', 'elder', 'shop', 'gunsmith', 'inn', 'barracks', 'townhouse', 'library', 'guildhall', 'bank']);

// ---- Capitals (worlds made since capitals) ---------------------------------------------------------------

/** Rows a capital's raster reaches below its street (the undercity), and the undercity's ceiling and floor (rows under the street). */
export const CAP_BELOW = 16;
const UNDER_CEIL = 7, UNDER_FLOOR = 12;
/** How high a palace's terrace stands over the street. */
const TERRACE = 6;
/** What each style's capital is called, after its name. */
export const CAPITAL_TITLE = { timber: 'the Crown City', adobe: 'the Golden City', cabin: 'the High Seat', stilt: 'the City of the Sun' };
// The walls townhouses are built of (a row of them, each its own), by style.
const FACADES = {
  timber: [[K.TIMBER, K.TIMBER_WALL], [K.BRICKS, K.BRICK_WALL], [K.PLASTER, K.PLASTER_WALL], [K.STONE_BRICKS, K.STONE_BRICK_WALL]],
  adobe: [[K.MUD_BRICKS, K.MUD_BRICK_WALL], [K.SANDSTONE_BRICKS, K.SANDSTONE_BRICK_WALL], [K.PLASTER, K.PLASTER_WALL]],
  cabin: [[K.LOG, K.LOG_WALL], [K.PLANKS, K.PLANK_WALL], [K.STONE_BRICKS, K.STONE_BRICK_WALL]],
  stilt: [[K.PLANKS, K.PLANK_WALL], [K.LOG, K.LOG_WALL], [K.MOSSY_BRICKS, K.STONE_BRICK_WALL]],
};

/** Whether biome `key` has towns (a style to build them in). */
export const hasTowns = key => !!STYLE_OF[key];

/**
 * The capital starting in region k (worldgen.js's capitalStart: it takes k and k + 1): like
 * planTown's, but kind 'capital', two regions across, its title, and capitalLayout's buildings.
 */
function planCapital(gen, k) {
  const s = gen.seed, biome = gen.regionBiome(k), styleId = STYLE_OF[biome.key];
  if (!styleId) return null;
  const x0 = gen.edge(k) + MARGIN + TOWN_RAMP, x1 = gen.edge(k + 2) - 1 - MARGIN - TOWN_RAMP;
  let sum = 0, n = 0;
  for (let x = x0; x <= x1; x += 2) { sum += gen.naturalHeight(x, gen.regionAt(x)); n++; }
  const level = Math.max(ABOVE + 4, gen.surfaceRow(sum / n)), h = gen.heightOfRow(level);
  const style = { ...STYLES[styleId], ...STYLES[styleId].city, id: styleId };
  const town = {
    id: `${k}`, k, kind: 'capital', capital: true, name: townName(s, k, style.names), title: CAPITAL_TITLE[styleId], biome: biome.key, style, gen: gen.version,
    x0, x1, h, level, top: level - ABOVE, bottom: level + CAP_BELOW, buildings: null,
  };
  town.buildings = capitalLayout(town, rngOf(hash3(s, k, 425)));
  return town;
}

/**
 * A capital's buildings: a great gate at each end; in the middle the grand plaza, the cathedral
 * on one side of it and the palace (on its terrace) on the other; out from them the market, the
 * inn, smiths, a library, guild hall, counting house and barracks, and rows of townhouses (three
 * to five side by side, each its own) between streets; under the street, a cellar tavern, a black
 * market and a vault.
 */
function capitalLayout(town, rng) {
  const out = [];
  const add = (kind, x0, x1, base = town.level) => {
    const d = BUILDINGS[kind];
    const b = { kind, x0, x1, storeys: rng.int(d.storeys[0], d.storeys[1]), role: d.role, name: d.name, base, spots: [], under: !!d.under };
    b.spots.push({ x: (x0 + x1) >> 1, y: base - 1 });
    out.push(b);
    return b;
  };
  let L = town.x0, R = town.x1;
  add('greatgate', L, L + 12);
  add('greatgate', R - 12, R);
  L += 13 + rng.int(4, 6);
  R -= 13 + rng.int(4, 6);
  // The middle.
  const pw = rng.int(30, 36), p0 = ((L + R) >> 1) - (pw >> 1);
  add('grandplaza', p0, p0 + pw - 1);
  let left = p0 - 1, right = p0 + pw;
  const cw = rng.int(32, 38), palw = rng.int(56, 66), g1 = rng.int(4, 6), g2 = TERRACE + 3;
  const cathedral = side => { if (side < 0) { add('cathedral', left - g1 - cw + 1, left - g1); left -= g1 + cw; } else { add('cathedral', right + g1, right + g1 + cw - 1); right += g1 + cw; } };
  const palace = side => {
    if (side < 0) { add('palace', left - g2 - palw + 1, left - g2, town.level - TERRACE); left -= g2 + palw + TERRACE + 1; }
    else { add('palace', right + g2, right + g2 + palw - 1, town.level - TERRACE); right += g2 + palw + TERRACE + 1; }
  };
  if (rng.chance(0.5)) { cathedral(-1); palace(1); } else { palace(-1); cathedral(1); }
  // Out from the middle, either side in turn: the rest, then rows of townhouses while there's room.
  const queue = ['market', 'inn', 'row', 'smithy', 'guildhall', 'row', 'gunsmith', 'library', 'row', 'bank', 'barracks', 'row', 'inn', 'row', 'house', 'row', 'row', 'row', 'row', 'row', 'row'];
  let side = rng.chance(0.5) ? -1 : 1;
  for (const kind of queue) {
    const gap = rng.int(3, 6);
    // (A row: three to five townhouses wall to wall.)
    const widths = kind === 'row' ? Array.from({ length: rng.int(3, 5) }, () => rng.int(8, 11)) : [rng.int(BUILDINGS[kind].w[0], BUILDINGS[kind].w[1])];
    const w = widths.reduce((a, b) => a + b, 0);
    const fitsL = left - gap - w + 1 >= L, fitsR = right + gap + w - 1 <= R;
    if (!fitsL && !fitsR) continue;
    const goLeft = side < 0 ? fitsL : !fitsR;
    let x = goLeft ? left - gap - w + 1 : right + gap;
    for (const bw of widths) { add(kind === 'row' ? 'townhouse' : kind, x, x + bw - 1); x += bw; }
    if (goLeft) left -= gap + w; else right += gap + w;
    side = -side;
  }
  // Under the street: the undercity's own (along its length, apart from each other).
  const under = town.level + UNDER_FLOOR, span = town.x1 - town.x0 - 60;
  ['cellarbar', 'blackmarket', 'vault'].forEach((kind, i) => {
    const d = BUILDINGS[kind], w = rng.int(d.w[0], d.w[1]), x0 = town.x0 + 30 + Math.floor(((i + 0.5) / 3) * span) - (w >> 1);
    add(kind, x0, x0 + w - 1, under);
  });
  out.sort((a, b) => a.x0 - b.x0);
  return out;
}

/**
 * Region k's town, if it has one: { id, k, kind ('village' or 'city'), name, biome, style,
 * x0, x1 (the level part, tiles), h (its height, as worldgen.js's column has heights), level
 * (its ground's row), top, bottom (rows its raster covers), buildings: [{ kind, x0, x1,
 * storeys, role, base (the floor's row), spots: [{ x, y }] (where someone stands inside) }] }.
 * The region where everyone starts always has a village, just beside the start.
 */
export function planTown(gen, k) {
  // (Worlds made since capitals: a capital takes two regions; the second has no town of its own.)
  if (gen.capitalStart?.(k - 1)) return null;
  if (gen.capitalStart?.(k)) return planCapital(gen, k);
  const s = gen.seed, biome = gen.regionBiome(k), styleId = STYLE_OF[biome.key];
  if (!styleId) return null;
  const spawn = k === gen.spawnRegion;
  let kind = 'village';
  if (!spawn) {
    const r = rand3(s, k, 401);
    if (r < 0.17) kind = 'city';
    else if (r >= 0.6) return null;
  }
  const start = gen.edge(k), end = gen.edge(k + 1);
  const lo = start + MARGIN + TOWN_RAMP, hi = end - 1 - MARGIN - TOWN_RAMP;
  let w = kind === 'city' ? 170 + (hash3(s, k, 402) % 51) : 68 + (hash3(s, k, 403) % 31);
  let x0;
  if (spawn) {
    // Beside where everyone starts (on whichever side has more room): in sight, not on top of it.
    const gap = 26, east = hi - (gen.spawnX + gap) + 1, west = gen.spawnX - gap - lo + 1;
    w = Math.min(w, Math.max(east, west));
    if (w < 52) return null;
    x0 = east >= west ? gen.spawnX + gap : gen.spawnX - gap - w + 1;
  } else {
    const room = hi - lo + 1;
    if (room < w && kind === 'city') { if (room >= 120) w = room; else { kind = 'village'; w = Math.min(w, 96); } }
    if (room < w) w = room;
    if (w < 52) return null;
    x0 = lo + (hash3(s, k, 404) % (room - w + 1));
  }
  const x1 = x0 + w - 1;
  // Its level: the land's own height, on average, over it.
  let sum = 0;
  for (let x = x0; x <= x1; x++) sum += gen.naturalHeight(x, k);
  const level = Math.max(ABOVE + 4, gen.surfaceRow(sum / w)), h = gen.heightOfRow(level);
  const style = { ...STYLES[styleId], ...(kind === 'city' ? STYLES[styleId].city : {}), id: styleId };
  const town = {
    id: `${k}`, k, kind, name: townName(s, k, style.names), biome: biome.key, style, gen: gen.version,
    x0, x1, h, level, top: level - ABOVE, bottom: level + BELOW, buildings: null,
  };
  town.buildings = layout(town, rngOf(hash3(s, k, 405)));
  return town;
}

/** The buildings along a town, from the middle out: its centrepiece, then the rest either side, with streets between. */
function layout(town, rng) {
  const out = [], city = town.kind === 'city';
  const add = (kind, x0, x1) => {
    const d = BUILDINGS[kind];
    const b = { kind, x0, x1, storeys: rng.int(d.storeys[0], d.storeys[1]), role: d.role, name: d.name, base: town.level, spots: [] };
    if (HOUSELIKE.has(kind) && town.style.raised) b.base = town.level - town.style.raised;
    b.spots.push({ x: (x0 + x1) >> 1, y: b.base - 1 });
    out.push(b);
    return b;
  };
  let L = town.x0, R = town.x1;
  if (city) {
    add('gate', L, L + 6);
    add('gate', R - 6, R);
    L += 7 + rng.int(3, 5);
    R -= 7 + rng.int(3, 5);
  } else if (rng.chance(0.55)) {
    if (rng.chance(0.5)) { add('tower', L + 1, L + 5); L += 6 + rng.int(3, 5); } else { add('tower', R - 5, R - 1); R -= 6 + rng.int(3, 5); }
  }
  // The centrepiece: a well, or a city's plaza.
  const cw = city ? rng.int(14, 18) : 7, mid = (L + R) >> 1, c0 = mid - (cw >> 1);
  add(city ? 'plaza' : 'well', c0, c0 + cw - 1);
  let left = c0 - 1, right = c0 + cw; // the next building ends before left, or starts after right
  const queue = city
    ? ['keep', 'market', 'inn', 'temple', 'smithy', 'gunsmith', 'barracks', 'house', 'house', 'house', 'house', 'house', 'house', 'house', 'house', 'house', 'house']
    : ['elder', 'shop', 'smithy', 'house', 'house', 'house', 'house', 'house', 'house', 'farm'];
  let side = rng.chance(0.5) ? -1 : 1;
  for (const kind of queue) {
    const d = BUILDINGS[kind], w = rng.int(d.w[0], d.w[1]), gap = rng.int(3, 6);
    const fitsL = left - gap - w + 1 >= L, fitsR = right + gap + w - 1 <= R;
    const goLeft = side < 0 ? fitsL || !fitsR : !fitsR && fitsL;
    if (goLeft && fitsL) { const x1 = left - gap; add(kind, x1 - w + 1, x1); left = x1 - w; }
    else if (fitsR) { const x0 = right + gap; add(kind, x0, x0 + w - 1); right = x0 + w; }
    else continue;
    side = -side;
  }
  out.sort((a, b) => a.x0 - b.x0);
  return out;
}

// ---- Building: a town's blocks in a raster of its own --------------------------------------------------

/** A town's blocks: fg (blocks), bg (walls) (-1: leave the land as it is), sh (shapes), over x0..x1, y0..y1. */
class Raster {
  constructor(x0, y0, x1, y1, level) {
    this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1; this.level = level;
    this.w = x1 - x0 + 1;
    const n = this.w * (y1 - y0 + 1);
    this.fg = new Int16Array(n).fill(-1);
    this.bg = new Int16Array(n).fill(-1);
    this.sh = new Uint8Array(n);
  }
  at(x, y) { return x < this.x0 || x > this.x1 || y < this.y0 || y > this.y1 ? -1 : (y - this.y0) * this.w + (x - this.x0); }
  /** Block b (shape sh) and wall w at (x, y) (-1: leave what's there). */
  set(x, y, b, w = -1, sh = 0) {
    const i = this.at(x, y);
    if (i < 0) return;
    if (b >= 0) { this.fg[i] = b; this.sh[i] = sh; }
    if (w >= 0) this.bg[i] = w;
  }
  wall(x, y, w) { this.set(x, y, -1, w); }
  block(x, y) { const i = this.at(x, y); return i < 0 ? -1 : this.fg[i]; }
  rect(x0, y0, x1, y1, b, w = -1) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, b, w); }
}

/** Town t's raster (made once, then kept by worldgen.js). */
export function buildTown(seed, t) {
  const R = new Raster(t.x0 - 2, t.top, t.x1 + 2, t.bottom, t.level), st = t.style, lv = t.level;
  const rng = rngOf(hash3(seed, t.k, 406));
  // The ground: a path (or the biome's own ground), with a firm layer under it.
  if (st.path != null) for (let x = t.x0; x <= t.x1; x++) R.set(x, lv, st.path);
  // (A capital: its street paved, and the undercity under it first: the buildings go over it.)
  if (t.capital) { for (let x = t.x0; x <= t.x1; x++) R.set(x, lv, st.path ?? K.COBBLESTONE); undercity(R, st, t, rng); }
  for (const b of t.buildings) BUILD[b.kind](R, st, b, rng, t);
  if (t.capital) { walkways(R, t); shafts(R, st, t, rng); }
  // Lamp posts along the streets (in the gaps between buildings), and benches.
  let prev = t.x0 - 1;
  for (const b of [...t.buildings.filter(o => !o.under), { x0: t.x1 + 1 }]) {
    const gapL = prev + 1, gapR = b.x0 - 1;
    if (gapR - gapL >= 2) {
      const x = (gapL + gapR) >> 1;
      if (R.block(x, lv - 1) < 0) lampPost(R, st, x, lv);
      if (gapR - gapL >= 5 && rng.chance(0.4) && R.block(x + 2, lv - 1) < 0) R.set(x + 2, lv - 1, rng.chance(0.5) ? K.BARREL : K.CHAIR);
    }
    prev = b.x1 ?? prev;
  }
  return R;
}

function lampPost(R, st, x, lv) {
  R.set(x, lv - 1, K.FENCE);
  R.set(x, lv - 2, K.FENCE);
  R.set(x, lv - 3, K.LANTERN);
}

// ---- The buildings ---------------------------------------------------------------------------------------

/** A gable roof over walls x0..x1 standing on the row `ceil`: slopes of ramps, an attic inside, a ridge on top. */
function gable(R, st, x0, x1, ceil, roof = st.roof) {
  let top = ceil;
  for (let i = 0; ; i++) {
    const y = ceil - 1 - i, l = x0 - 1 + i, r = x1 + 1 - i;
    if (l > r) break;
    top = y;
    const outer = st.snow ? K.SNOW : roof;
    if (r - l <= 1) { R.set(l, y, outer); R.set(r, y, outer); break; }
    R.set(l, y, outer, -1, RAMP_R);
    R.set(r, y, outer, -1, RAMP_L);
    R.set(l + 1, y, roof);
    R.set(r - 1, y, roof);
    for (let x = l + 2; x <= r - 2; x++) R.set(x, y, K.AIR, st.attic);
  }
  return top;
}

/** A flat roof with a low wall round its edge (and, now and then, a shade on it). */
function flatRoof(R, st, x0, x1, ceil, rng) {
  R.set(x0, ceil - 1, st.roof);
  R.set(x1, ceil - 1, st.roof);
  for (let x = x0 + 2; x < x1 - 1; x += 3) R.set(x, ceil - 1, st.roof, -1, 1);
  if (x1 - x0 >= 10 && rng.chance(0.5)) {
    const a = x0 + 3, b = Math.min(x1 - 3, a + 5);
    for (const x of [a, b]) { R.set(x, ceil - 1, K.FENCE); R.set(x, ceil - 2, K.FENCE); }
    for (let x = a - 1; x <= b + 1; x++) R.set(x, ceil - 3, K.AWNING);
  }
  return ceil - 1;
}

/** A dome over x0..x1 on the row `ceil`. */
function dome(R, st, x0, x1, ceil) {
  const r = (x1 - x0) / 2, cx = (x0 + x1) / 2;
  let prevHalf = r + 1;
  for (let dy = 0; dy <= Math.ceil(r); dy++) {
    const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)) + 0.25), y = ceil - 1 - dy;
    if (half < 0) break;
    const l = Math.round(cx - half), rr = Math.round(cx + half);
    const step = half < prevHalf;
    R.set(l, y, st.roof, -1, step ? RAMP_R : 0);
    R.set(rr, y, st.roof, -1, step ? RAMP_L : 0);
    for (let x = l + 1; x < rr; x++) R.set(x, y, K.AIR, st.attic);
    prevHalf = half;
    if (half === 0) { R.set(Math.round(cx), y, st.roof); break; }
  }
}

/** The roof the style has, over walls x0..x1 on row `ceil` (and a chimney). Returns the top row. */
function roofOver(R, st, b, x0, x1, ceil, rng) {
  if (st.roofShape === 'flat') return flatRoof(R, st, x0, x1, ceil, rng);
  const top = gable(R, st, x0, x1, ceil);
  if (st.chimney != null && x1 - x0 >= 8) {
    const c = rng.chance(0.5) ? x0 + 2 : x1 - 2, slope = ceil - 1 - Math.min(c - (x0 - 1), (x1 + 1) - c);
    for (let y = ceil - 1; y >= slope - 2; y--) R.set(c, y, st.chimney);
  }
  return top;
}

/** A building with walls round it, storeys, doors at both ends of the ground floor, and its roof. */
function shell(R, st, b, rng, { wall = st.wall, back = st.back, terrace = false } = {}) {
  const { x0, x1, base, storeys } = b, ceil = base - storeys * STOREY;
  for (let x = x0; x <= x1; x++) R.set(x, base, st.floor);
  if (base === R.level) for (let x = x0; x <= x1; x++) R.set(x, base + 1, st.foundation);
  for (let y = ceil; y < base; y++) { R.set(x0, y, wall); R.set(x1, y, wall); }
  for (let x = x0; x <= x1; x++) R.set(x, ceil, st.ceiling);
  for (let y = ceil + 1; y < base; y++) for (let x = x0 + 1; x < x1; x++) R.set(x, y, K.AIR, back);
  // Floors between the storeys (jumped up through), and a ladder up beside the back wall.
  for (let i = 1; i < storeys; i++) for (let x = x0 + 1; x < x1; x++) R.set(x, base - STOREY * i, K.PLATFORM);
  if (storeys > 1) for (let y = base - 1; y >= base - STOREY * (storeys - 1); y--) R.set(x1 - 2, y, K.LADDER, back);
  // Doors at both ends.
  for (const x of [x0, x1]) for (let y = base - 3; y < base; y++) R.set(x, y, K.DOOR);
  // Windows (the wall behind, in glass), and a lantern under each ceiling.
  for (let i = 0; i < storeys; i++) {
    const floor = base - STOREY * i;
    for (let x = x0 + 3; x <= x1 - 4; x += 5) { R.wall(x, floor - 3, K.GLASS_WALL); R.wall(x + 1, floor - 3, K.GLASS_WALL); R.wall(x, floor - 2, K.GLASS_WALL); R.wall(x + 1, floor - 2, K.GLASS_WALL); }
    R.set((x0 + x1) >> 1, floor - 4, K.LANTERN);
  }
  // Raised (on stilts): posts down to the ground, a porch and a ladder up to each door. (Not on a terrace.)
  if (base < R.level && !terrace) {
    for (const x of [x0, x1, (x0 + x1) >> 1]) for (let y = base + 1; y < R.level; y++) R.set(x, y, st.post);
    for (const [x, dir] of [[x0 - 1, -1], [x1 + 1, 1]]) {
      R.set(x, base, K.PLATFORM);
      for (let y = base + 1; y < R.level; y++) R.set(x, y, K.LADDER);
      R.set(x + dir, base, K.PLATFORM);
    }
  }
  return ceil;
}

/** Furniture along floor `floor` from x0 to x1: what's given, spread out (each on the floor). */
function furnish(R, x0, x1, floor, things, rng) {
  const free = [];
  for (let x = x0; x <= x1; x++) if (R.block(x, floor - 1) === K.AIR) free.push(x);
  const n = Math.min(things.length, free.length);
  for (let i = 0; i < n; i++) {
    const x = free[Math.floor(((i + 0.5) * free.length) / n)];
    R.set(x, floor - 1, things[i]);
  }
}

/** A house-like building: its shell, roof and what's inside (by who lives or works there). */
function housey(inside) {
  return (R, st, b, rng) => {
    const ceil = shell(R, st, b, rng);
    roofOver(R, st, b, b.x0, b.x1, ceil, rng);
    for (let i = 0; i < b.storeys; i++) {
      const floor = b.base - STOREY * i;
      furnish(R, b.x0 + 2, b.x1 - 3, floor, inside(i, b, rng), rng);
    }
    if (b.kind === 'shop' || b.kind === 'inn') signs(R, b);
    // (Banners on the walls of the elder's house and the barracks.)
    if (b.kind === 'elder' || b.kind === 'barracks') for (let i = 0; i < b.storeys; i++) for (const x of [b.x0 + 2, b.x1 - 3]) R.set(x, b.base - STOREY * i - 3, K.BANNER);
  };
}

/** A sign and an awning outside each door. */
function signs(R, b) {
  const y = b.base;
  for (const [x, dir] of [[b.x0 - 1, -1], [b.x1 + 1, 1]]) {
    R.set(x, y - 4, K.AWNING);
    R.set(x + dir, y - 4, K.AWNING);
    if (y === R.level && R.block(x + dir, y - 1) < 0) R.set(x + dir, y - 1, K.SIGN);
  }
}

/**
 * Under a capital's main street: a street of its own, from near one gate to near the other (stone
 * above and below, lanterns hanging, gutters of water in its floor here and there), and its
 * buildings along it (a cellar tavern, a black market, a vault): rooms of the street, panelled.
 */
function undercity(R, st, t, rng) {
  const lv = t.level, c = lv + UNDER_CEIL, f = lv + UNDER_FLOOR, x0 = t.x0 + 16, x1 = t.x1 - 16;
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    R.set(x, c, st.stone);
    R.set(x, f, K.STONE_BRICKS);
    R.set(x, f + 1, K.STONE_BRICKS);
    for (let y = c + 1; y < f; y++) R.set(x, y, x < x0 || x > x1 ? st.stone : K.AIR, K.STONE_BRICK_WALL);
  }
  for (let x = x0 + 5; x < x1; x += 12) R.set(x, c + 1, K.LANTERN);
  // Gutters: a block of water in the floor, waded through.
  for (let x = x0 + 22 + rng.int(0, 8); x + 5 < x1; x += 40 + rng.int(0, 12)) for (let i = 0; i < 5; i++) R.set(x + i, f, K.WATER);
}

/** A capital's undercity buildings: rooms of its street (their walls panelled), with what's in them. */
function underRoom(inside) {
  return (R, st, b, rng) => {
    const { x0, x1, base } = b;
    for (let x = x0; x <= x1; x++) {
      R.set(x, base, K.STONE_BRICKS);
      for (let y = base - 4; y < base; y++) R.wall(x, y, b.kind === 'vault' ? K.STONE_BRICK_WALL : K.PLANK_WALL);
    }
    for (const x of [x0, x1]) { R.set(x, base - 4, K.TIMBER); R.wall(x, base - 2, K.TIMBER_WALL); }
    furnish(R, x0 + 1, x1 - 1, base, inside(b, rng), rng);
    R.set((x0 + x1) >> 1, base - 4, K.LANTERN);
  };
}

/**
 * Walkways between a capital's buildings, a storey up: over each street between two buildings of
 * two storeys or more (a bridge, railings along it, a lantern under it), a door through each wall.
 */
function walkways(R, t) {
  const street = t.buildings.filter(b => !b.under && b.base === t.level && HOUSELIKE.has(b.kind));
  for (let i = 0; i + 1 < street.length; i++) {
    const a = street[i], b = street[i + 1], gap = b.x0 - a.x1 - 1;
    if (gap < 2 || gap > 9 || a.storeys < 2 || b.storeys < 2) continue;
    const y = t.level - STOREY;
    for (let x = a.x1 + 1; x < b.x0; x++) { R.set(x, y, K.PLATFORM); R.set(x, y - 1, K.FENCE); }
    for (const x of [a.x1, b.x0]) for (let yy = y - 3; yy < y; yy++) R.set(x, yy, K.DOOR);
    for (const x of [a.x1 + 1, b.x0 - 1]) R.set(x, y - 1, K.AIR);
    R.set((a.x1 + b.x0) >> 1, y + 1, K.LANTERN);
  }
}

/**
 * Shafts from a capital's street down to the undercity, in the streets between buildings (every
 * other one): a trapdoor (a platform: crouch and jump to drop through it), a ladder down, a sign.
 */
function shafts(R, st, t, rng) {
  const lv = t.level, f = lv + UNDER_FLOOR, street = t.buildings.filter(b => !b.under);
  let n = 0;
  for (let i = 0; i + 1 < street.length; i++) {
    const a = street[i], b = street[i + 1];
    if (b.x0 - a.x1 - 1 < 5 || a.x1 < t.x0 + 20 || b.x0 > t.x1 - 20 || n++ % 2) continue;
    // (Not where the palace's terrace is.)
    if (a.kind === 'palace' || b.kind === 'palace') continue;
    // (Beside the building on its left: the street's lamp is in the middle.)
    const x = a.x1 + 1;
    R.set(x, lv, K.PLATFORM);
    for (let y = lv + 1; y < f; y++) R.set(x, y, K.LADDER, K.STONE_BRICK_WALL);
    if (R.block(x + 1, lv - 1) < 0) R.set(x + 1, lv - 1, K.SIGN);
  }
}

const BUILD = {
  house: housey((i, b, rng) => i === b.storeys - 1 && b.storeys > 1
    ? [K.BED, K.BOOKSHELF, K.CHAIR]
    : b.storeys === 1 ? [K.BED, K.TABLE, K.CHAIR, rng.chance(0.5) ? K.BOOKSHELF : K.BARREL] : [K.TABLE, K.CHAIR, K.BARREL, K.BOOKSHELF]),
  elder: housey((i) => i === 0 ? [K.BOOKSHELF, K.CHAIR, K.TABLE, K.CHAIR, K.BOOKSHELF] : [K.BED, K.BOOKSHELF, K.BOOKSHELF, K.TABLE]),
  shop: housey((i) => i === 0 ? [K.BARREL, K.TABLE, K.TABLE, K.BOOKSHELF, K.BARREL] : [K.BED, K.BARREL, K.BOOKSHELF]),
  gunsmith: housey((i) => i === 0 ? [K.GUNSMITH, K.TABLE, K.BARREL, K.ANVIL] : [K.BED, K.BARREL, K.CHAIR]),
  inn: housey((i) => i === 0 ? [K.BARREL, K.TABLE, K.CHAIR, K.TABLE, K.CHAIR, K.BARREL] : [K.BED, K.BED, K.TABLE, K.BED]),
  barracks: housey((i) => i === 0 ? [K.TABLE, K.CHAIR, K.BARREL, K.BARREL] : [K.BED, K.BED, K.BED]),

  /** An open-sided smithy: posts, a roof, an anvil, a furnace and a workbench (players can use them). */
  smithy(R, st, b, rng) {
    const { x0, x1 } = b, lv = R.level, ceil = lv - STOREY;
    for (let x = x0; x <= x1; x++) { R.set(x, lv, K.COBBLESTONE); R.set(x, ceil, st.ceiling); }
    for (const x of [x0, x1]) for (let y = ceil + 1; y < lv; y++) R.set(x, y, st.post);
    for (let y = ceil + 1; y < lv; y++) for (let x = x0 + 1; x < x1; x++) R.set(x, y, K.AIR, y < lv - 2 ? st.stoneBack : -1);
    roofOver(R, { ...st, chimney: null }, b, x0, x1, ceil, rng);
    // The chimney goes up from the furnace.
    const f = x0 + 2;
    R.set(f, lv - 1, K.FURNACE);
    for (let y = ceil; y >= ceil - 1 - Math.min(f - (x0 - 1), (x1 + 1) - f) - 2; y--) R.set(f, y, K.BRICKS);
    R.set(x0 + 5, lv - 1, K.ANVIL);
    R.set(x1 - 3, lv - 1, K.WORKBENCH);
    R.set(x1 - 2, lv - 1, K.BARREL);
    R.set((x0 + x1) >> 1, ceil + 1, K.LANTERN);
  },

  /** A watchtower: posts, floors with a ladder up through them, a lookout with a roof. */
  tower(R, st, b) {
    const { x0, x1 } = b, lv = R.level, top = lv - 15;
    for (const x of [x0, x1]) for (let y = top; y < lv; y++) R.set(x, y, st.post);
    for (let y = top + 1; y < lv; y++) for (let x = x0 + 1; x < x1; x++) R.set(x, y, K.AIR);
    for (const y of [lv - 5, lv - 10]) for (let x = x0 + 1; x < x1; x++) R.set(x, y, K.PLATFORM);
    for (let y = lv - 1; y >= lv - 10; y--) R.set(x0 + 2, y, K.LADDER);
    for (let x = x0 - 1; x <= x1 + 1; x++) R.set(x, top, K.PLATFORM);
    R.set(x0 - 1, top - 1, K.FENCE); R.set(x1 + 1, top - 1, K.FENCE);
    for (let y = top - 1; y > top - 4; y--) { R.set(x0, y, st.post); R.set(x1, y, st.post); }
    gable(R, st, x0, x1, top - 4);
    for (let x = x0; x <= x1; x++) R.set(x, top - 4, st.ceiling);
    R.set((x0 + x1) >> 1, top - 3, K.LANTERN);
  },

  /** The well in the middle of a village: a ring of stone, water in it (ice, in towns made before seas), a roof on posts. */
  well(R, st, b, rng, t) {
    const x = b.x0, lv = R.level;
    R.rect(x + 2, lv, x + 4, lv, K.AIR, K.STONE_BRICK_WALL);
    R.rect(x + 2, lv + 1, x + 4, lv + 1, t?.gen >= 6 ? K.WATER : K.ICE);
    R.set(x + 1, lv, K.STONE_BRICKS); R.set(x + 5, lv, K.STONE_BRICKS);
    R.set(x + 1, lv + 1, K.STONE_BRICKS); R.set(x + 5, lv + 1, K.STONE_BRICKS);
    R.set(x + 1, lv - 1, K.STONE_BRICKS); R.set(x + 5, lv - 1, K.STONE_BRICKS);
    for (let y = lv - 4; y <= lv - 2; y++) { R.set(x + 1, y, K.FENCE); R.set(x + 5, y, K.FENCE); }
    for (let i = x + 1; i <= x + 5; i++) R.set(i, lv - 5, K.TIMBER);
    gable(R, st, x + 1, x + 5, lv - 5);
    R.set(x + 3, lv - 4, K.LANTERN);
    for (const xx of [x, x + 6]) R.set(xx, lv, K.COBBLESTONE);
  },

  /** A fenced field of wheat, with a scarecrow. */
  farm(R, st, b) {
    const { x0, x1 } = b, lv = R.level;
    for (let x = x0; x <= x1; x++) R.set(x, lv, K.DIRT);
    R.set(x0, lv - 1, K.FENCE); R.set(x1, lv - 1, K.FENCE);
    for (let x = x0 + 1; x < x1; x++) R.set(x, lv - 1, (x - x0) % 4 === 0 ? K.AIR : K.WHEAT);
    const m = (x0 + x1) >> 1;
    R.set(m, lv - 1, K.FENCE); R.set(m, lv - 2, K.FENCE); R.set(m, lv - 3, K.BANNER);
  },

  /** A city's plaza: paved, a fountain in the middle (water: ice, in towns made before seas), benches and lamps. */
  plaza(R, st, b, rng, t) {
    const { x0, x1 } = b, lv = R.level, m = (x0 + x1) >> 1;
    for (let x = x0; x <= x1; x++) R.set(x, lv, K.COBBLESTONE);
    for (let x = m - 3; x <= m + 3; x++) { R.set(x, lv, K.AIR, K.STONE_BRICK_WALL); R.set(x, lv + 1, t?.gen >= 6 ? K.WATER : K.ICE); }
    if (t?.gen >= 6) for (const x of [m - 4, m + 4]) R.set(x, lv + 1, K.STONE_BRICKS);
    R.set(m - 4, lv, K.STONE_BRICKS); R.set(m + 4, lv, K.STONE_BRICKS);
    R.set(m - 4, lv - 1, K.STONE_BRICKS, -1, 1); R.set(m + 4, lv - 1, K.STONE_BRICKS, -1, 1);
    for (let y = lv; y >= lv - 3; y--) R.set(m, y, K.STONE_BRICKS);
    R.set(m, lv + 1, K.STONE_BRICKS);
    R.set(m, lv - 4, K.LANTERN);
    for (const x of [x0 + 1, x1 - 1]) lampPost(R, st, x, lv);
    for (const x of [m - 6, m + 6]) if (x > x0 + 1 && x < x1 - 1) R.set(x, lv - 1, K.CHAIR);
  },

  /** A city's market: stalls under awnings, with counters and barrels. */
  market(R, st, b, rng) {
    const { x0, x1 } = b, lv = R.level;
    for (let x = x0; x <= x1; x++) R.set(x, lv, st.path ?? K.COBBLESTONE);
    for (let sx = x0 + 1; sx + 5 <= x1; sx += 7) {
      for (const x of [sx, sx + 5]) for (let y = lv - 3; y < lv; y++) R.set(x, y, K.FENCE);
      for (let x = sx - 1; x <= sx + 6; x++) R.set(x, lv - 4, K.AWNING);
      R.set(sx + 2, lv - 1, K.TABLE); R.set(sx + 3, lv - 1, K.TABLE);
      R.set(rng.chance(0.5) ? sx + 1 : sx + 4, lv - 1, K.BARREL);
      R.set(sx + 2, lv - 3, K.LANTERN);
    }
  },

  /** A temple: a tall hall, stained glass high in its walls, an altar and benches, a steep roof and a spire. */
  temple(R, st, b) {
    const { x0, x1 } = b, lv = R.level, ceil = lv - 9, m = (x0 + x1) >> 1;
    for (let x = x0; x <= x1; x++) { R.set(x, lv, st.stone); R.set(x, lv + 1, st.foundation); R.set(x, ceil, st.stone); }
    for (let y = ceil; y < lv; y++) { R.set(x0, y, st.stone); R.set(x1, y, st.stone); }
    for (let y = ceil + 1; y < lv; y++) for (let x = x0 + 1; x < x1; x++) R.set(x, y, K.AIR, st.stoneBack);
    for (const x of [x0, x1]) { for (let y = lv - 3; y < lv; y++) R.set(x, y, K.DOOR); for (let y = ceil + 2; y <= lv - 6; y++) R.set(x, y, K.STAINED_GLASS); }
    for (let x = x0 + 3; x <= x1 - 3; x += 4) for (let y = ceil + 2; y <= lv - 5; y++) R.wall(x, y, K.GLASS_WALL);
    R.set(m, lv - 1, K.TABLE); R.set(m - 1, lv - 1, K.LANTERN); R.set(m + 1, lv - 1, K.LANTERN);
    R.set(m, ceil + 2, K.BANNER);
    for (let x = x0 + 2; x <= m - 3; x += 2) R.set(x, lv - 1, K.CHAIR);
    for (let x = m + 3; x <= x1 - 2; x += 2) R.set(x, lv - 1, K.CHAIR);
    for (const x of [x0 + 2, x1 - 2]) R.set(x, ceil + 1, K.LANTERN);
    if (st.roofShape === 'flat') dome(R, st, x0, x1, ceil);
    else {
      const top = gable(R, st, x0, x1, ceil);
      for (let y = top - 1; y >= top - 4; y--) R.set(m, y, st.stone);
      R.set(m, top - 5, K.LANTERN);
    }
  },

  /** A city's keep: three storeys of stone, turrets at its corners, a great hall, a library and bedrooms. */
  keep(R, st, b, rng) {
    const s2 = { ...st, wall: st.stone, back: st.stoneBack, ceiling: st.stone, floor: st.stone };
    const ceil = shell(R, s2, b, rng, { wall: st.stone, back: st.stoneBack });
    const { x0, x1 } = b;
    // Battlements along the roof, and a turret at each corner with a pointed roof.
    for (let x = x0; x <= x1; x += 2) R.set(x, ceil - 1, st.stone);
    for (const [a, z] of [[x0, x0 + 4], [x1 - 4, x1]]) {
      for (let y = ceil - 1; y >= ceil - 5; y--) { R.set(a, y, st.stone); R.set(z, y, st.stone); for (let x = a + 1; x < z; x++) R.set(x, y, K.AIR, st.stoneBack); }
      for (let x = a; x <= z; x++) R.set(x, ceil - 6, st.stone);
      if (st.roofShape === 'flat') dome(R, st, a, z, ceil - 6); else gable(R, { ...st, roof: K.ROOF_TILES }, a, z, ceil - 6);
      R.set(a + 2, ceil - 2, K.LANTERN);
    }
    const m = (x0 + x1) >> 1;
    furnish(R, x0 + 2, x1 - 3, b.base, [K.BANNER, K.TABLE, K.CHAIR, K.TABLE, K.CHAIR, K.TABLE, K.BANNER], rng);
    R.set(m, b.base - 1, K.CHAIR);
    furnish(R, x0 + 2, x1 - 3, b.base - STOREY, [K.BOOKSHELF, K.BOOKSHELF, K.TABLE, K.CHAIR, K.BOOKSHELF, K.BOOKSHELF], rng);
    furnish(R, x0 + 2, x1 - 3, b.base - STOREY * 2, [K.BED, K.BOOKSHELF, K.BED, K.TABLE, K.BED], rng);
    // Banners down its front (the wall behind the doorway rows).
    for (const x of [x0 + 2, x1 - 2]) R.set(x, b.base - 4, K.BANNER);
  },

  // ---- Capitals' ----

  /** A townhouse: one of a row, its own walls (by the style's facades), storeys, roof and what's inside. */
  townhouse(R, st, b, rng) {
    const [wall, back] = rng.pick(FACADES[st.id] || FACADES.timber);
    const ceil = shell(R, st, b, rng, { wall, back });
    roofOver(R, st, b, b.x0, b.x1, ceil, rng);
    for (let i = 0; i < b.storeys; i++) furnish(R, b.x0 + 2, b.x1 - 3, b.base - STOREY * i, i === 0 ? [K.TABLE, K.CHAIR, K.BARREL] : [K.BED, K.BOOKSHELF], rng);
  },
  library: housey(() => [K.BOOKSHELF, K.BOOKSHELF, K.TABLE, K.CHAIR, K.BOOKSHELF, K.BOOKSHELF, K.BOOKSHELF]),
  guildhall: housey((i) => i === 0 ? [K.BANNER, K.TABLE, K.CHAIR, K.TABLE, K.CHAIR, K.BANNER] : [K.BOOKSHELF, K.TABLE, K.BARREL, K.BOOKSHELF]),
  bank: housey((i) => i === 0 ? [K.TABLE, K.CHAIR, K.TABLE, K.BARREL] : [K.BOOKSHELF, K.BARREL, K.BARREL, K.BOOKSHELF]),
  cellarbar: underRoom(() => [K.BARREL, K.TABLE, K.CHAIR, K.TABLE, K.CHAIR, K.BARREL, K.BARREL]),
  blackmarket: underRoom(() => [K.BARREL, K.TABLE, K.BOOKSHELF, K.TABLE, K.BARREL]),
  vault: underRoom(() => [K.LOOT_CRATE, K.BARREL, K.LOOT_CRATE]),

  /**
   * A capital's great gate: a gatehouse between two towers, the street through it (doors at both
   * faces, a portcullis over it), rooms and floors up inside with a ladder, arrow slits, a long
   * banner on each face, battlements along its top and the towers' tops higher still.
   */
  greatgate(R, st, b) {
    const { x0, x1 } = b, lv = R.level, top = lv - 22, tower = lv - 28;
    for (let x = x0; x <= x1; x++) { R.set(x, lv, st.stone); R.set(x, lv + 1, st.stone); }
    for (let y = top; y < lv; y++) for (let x = x0; x <= x1; x++) R.set(x, y, x === x0 || x === x1 || y === top || y === lv - 5 ? st.stone : K.AIR, st.stoneBack);
    // The street through it, under a portcullis.
    for (const x of [x0, x1]) for (let y = lv - 3; y < lv; y++) R.set(x, y, K.DOOR);
    for (let x = x0 + 3; x <= x1 - 3; x++) R.set(x, lv - 4, K.FENCE);
    // Floors and a ladder up through them.
    for (const y of [lv - 10, lv - 15]) for (let x = x0 + 1; x < x1; x++) R.set(x, y, K.PLATFORM);
    for (let y = lv - 1; y > top; y--) R.set(x0 + 2, y, K.LADDER, st.stoneBack);
    R.set(x0 + 2, lv - 5, K.LADDER, st.stoneBack);
    R.set(x0 + 2, top, K.LADDER, st.stoneBack);
    for (const y of [lv - 8, lv - 13, lv - 18]) { R.set(x0, y, K.GLASS); R.set(x1, y, K.GLASS); }
    for (const y of [lv - 9, lv - 14, lv - 19]) R.set((x0 + x1) >> 1, y, K.LANTERN);
    for (let y = lv - 20; y <= lv - 16; y++) { R.set(x0 + 4, y, K.BANNER); R.set(x1 - 4, y, K.BANNER); }
    // Its towers, higher, and battlements.
    for (const [a, z] of [[x0, x0 + 3], [x1 - 3, x1]]) {
      for (let y = tower; y < top; y++) for (let x = a; x <= z; x++) R.set(x, y, x === a || x === z || y === tower ? st.stone : K.AIR, st.stoneBack);
      for (let x = a; x <= z; x += 2) R.set(x, tower - 1, st.snow ? K.SNOW_BRICKS : st.stone);
      R.set(a + 1, top + 1, K.LANTERN);
    }
    for (let x = x0 + 4; x <= x1 - 4; x += 2) R.set(x, top - 1, st.snow ? K.SNOW_BRICKS : st.stone);
  },

  /**
   * A capital's grand plaza: paved, a fountain in its middle (a basin of water, a statue on a
   * column in it), planters of flowers, benches and lamps.
   */
  grandplaza(R, st, b) {
    const { x0, x1 } = b, lv = R.level, m = (x0 + x1) >> 1;
    for (let x = x0; x <= x1; x++) R.set(x, lv, K.COBBLESTONE);
    // The fountain: a basin two deep, its rim, and the statue's column up out of it.
    for (let x = m - 5; x <= m + 5; x++) R.set(x, lv + 2, K.STONE_BRICKS);
    for (const x of [m - 5, m + 5]) for (let y = lv - 1; y <= lv + 1; y++) R.set(x, y, K.STONE_BRICKS);
    for (let x = m - 4; x <= m + 4; x++) for (let y = lv; y <= lv + 1; y++) R.set(x, y, K.WATER, K.STONE_BRICK_WALL);
    for (let y = lv + 1; y >= lv - 6; y--) R.set(m, y, K.STONE_BRICKS);
    R.set(m - 1, lv - 6, K.STONE_BRICKS, -1, RAMP_R); R.set(m + 1, lv - 6, K.STONE_BRICKS, -1, RAMP_L);
    R.set(m, lv - 7, K.LANTERN);
    // Planters, benches, lamps.
    for (const x of [x0 + 2, x1 - 3]) { R.set(x, lv, K.DIRT); R.set(x + 1, lv, K.DIRT); R.set(x, lv - 1, K.FLOWER); R.set(x + 1, lv - 1, K.FLOWER); }
    for (const x of [m - 9, m + 9]) R.set(x, lv - 1, K.CHAIR);
    for (const x of [x0 + 5, x1 - 5]) lampPost(R, st, x, lv);
  },

  /**
   * A capital's cathedral: a tall nave of stone, stained glass windows in its walls, pews and an
   * altar, lanterns hanging; a bell tower at one end, rising high over the city, its belfry open,
   * a spire on top.
   */
  cathedral(R, st, b, rng) {
    const { x0, x1 } = b, lv = R.level, ceil = lv - 14, tw = 7, left = rng.chance(0.5);
    const t0 = left ? x0 : x1 - tw + 1, t1 = t0 + tw - 1, n0 = left ? t1 + 1 : x0, n1 = left ? x1 : t0 - 1;
    // The nave.
    for (let x = n0; x <= n1; x++) { R.set(x, lv, st.stone); R.set(x, lv + 1, st.foundation); R.set(x, ceil, st.stone); }
    for (let y = ceil; y < lv; y++) { R.set(n0, y, st.stone); R.set(n1, y, st.stone); }
    for (let y = ceil + 1; y < lv; y++) for (let x = n0 + 1; x < n1; x++) R.set(x, y, K.AIR, st.stoneBack);
    for (const x of [n0, n1]) { for (let y = lv - 3; y < lv; y++) R.set(x, y, K.DOOR); for (let y = ceil + 2; y <= lv - 6; y++) R.set(x, y, K.STAINED_GLASS); }
    for (let x = n0 + 3; x <= n1 - 3; x += 4) for (let y = ceil + 2; y <= lv - 6; y++) R.wall(x, y, K.GLASS_WALL);
    const m = (n0 + n1) >> 1;
    R.set(m, lv - 1, K.TABLE); R.set(m - 1, lv - 1, K.LANTERN); R.set(m + 1, lv - 1, K.LANTERN);
    for (let y = ceil + 2; y <= ceil + 5; y++) R.set(m, y, K.BANNER);
    for (let x = n0 + 2; x <= m - 3; x += 2) R.set(x, lv - 1, K.CHAIR);
    for (let x = m + 3; x <= n1 - 2; x += 2) R.set(x, lv - 1, K.CHAIR);
    for (let x = n0 + 4; x <= n1 - 4; x += 6) R.set(x, ceil + 1, K.LANTERN);
    if (st.roofShape === 'flat') dome(R, st, n0, n1, ceil); else gable(R, { ...st, roof: K.ROOF_TILES }, n0, n1, ceil);
    // The bell tower: up through floors by a ladder, the belfry open (railings), a spire.
    const belfry = lv - 34;
    for (let x = t0; x <= t1; x++) { R.set(x, lv, st.stone); R.set(x, lv + 1, st.foundation); }
    for (let y = belfry; y < lv; y++) for (let x = t0; x <= t1; x++) R.set(x, y, x === t0 || x === t1 ? st.stone : K.AIR, st.stoneBack);
    for (const x of [t0, t1]) for (let y = lv - 3; y < lv; y++) R.set(x, y, K.DOOR);
    for (let y = lv - 8; y > belfry; y -= 6) for (let x = t0 + 1; x < t1; x++) R.set(x, y, K.PLATFORM);
    for (let y = lv - 1; y > belfry; y--) R.set(t0 + 2, y, K.LADDER, st.stoneBack);
    for (const x of [t0, t1]) for (let y = belfry + 1; y <= belfry + 3; y++) R.set(x, y, K.FENCE);
    R.set(t0 + 3, belfry + 1, K.LANTERN); R.set(t0 + 4, belfry + 1, K.LANTERN);
    for (let x = t0; x <= t1; x++) R.set(x, belfry, st.stone);
    for (const y of [lv - 12, lv - 18, lv - 24]) { R.set(t0, y, K.STAINED_GLASS); R.set(t1, y, K.STAINED_GLASS); }
    if (st.roofShape === 'flat') dome(R, st, t0, t1, belfry);
    else {
      const top = gable(R, { ...st, roof: K.ROOF_TILES }, t0, t1, belfry);
      for (let y = top - 1; y >= top - 3; y--) R.set((t0 + t1) >> 1, y, st.stone);
    }
  },

  /**
   * A capital's palace, up on a terrace (stone, stairs up at both ends): four storeys of stone
   * with battlements, a turret at each end and a great tower in the middle; inside, the throne
   * room (the throne on a dais, banners, a feast laid), a library, and bedchambers.
   */
  palace(R, st, b, rng) {
    const lv = R.level, { x0, x1, base } = b;
    // The terrace and its stairs.
    for (let x = x0 - TERRACE - 1; x <= x1 + TERRACE + 1; x++) {
      const i = Math.min(x - (x0 - TERRACE - 1), (x1 + TERRACE + 1) - x), topRow = Math.max(base, lv - i);
      for (let y = topRow; y <= lv; y++) R.set(x, y, st.stone);
    }
    const s2 = { ...st, wall: st.stone, back: st.stoneBack, ceiling: st.stone, floor: st.stone };
    const ceil = shell(R, s2, b, rng, { wall: st.stone, back: st.stoneBack, terrace: true });
    for (let x = x0; x <= x1; x += 2) R.set(x, ceil - 1, st.stone);
    // Turrets at the ends, and the great tower in the middle.
    const m = (x0 + x1) >> 1, roofStyle = { ...st, roof: K.ROOF_TILES };
    for (const [a, z, up] of [[x0, x0 + 5, 8], [x1 - 5, x1, 8], [m - 4, m + 4, 13]]) {
      for (let y = ceil - 1; y >= ceil - up; y--) for (let x = a; x <= z; x++) R.set(x, y, x === a || x === z ? st.stone : K.AIR, st.stoneBack);
      for (let x = a; x <= z; x++) R.set(x, ceil - up - 1, st.stone);
      if (st.roofShape === 'flat') dome(R, st, a, z, ceil - up - 1); else gable(R, roofStyle, a, z, ceil - up - 1);
      R.set(a + 2, ceil - up + 1, K.LANTERN);
      for (let y = ceil - up + 3; y <= ceil - 2; y += 4) { R.set(a, y, K.GLASS); R.set(z, y, K.GLASS); }
    }
    // The throne room: the throne on a dais in the middle, banners either side, a feast down the hall.
    R.set(m, base - 1, K.STONE_BRICKS, -1, 1);
    R.set(m, base - 2, K.CHAIR);
    for (const x of [m - 2, m + 2]) { R.set(x, base - 4, K.BANNER); R.set(x, base - 3, K.BANNER); }
    furnish(R, x0 + 3, m - 4, base, [K.TABLE, K.CHAIR, K.TABLE, K.CHAIR, K.TABLE, K.BANNER], rng);
    furnish(R, m + 4, x1 - 4, base, [K.BANNER, K.TABLE, K.CHAIR, K.TABLE, K.CHAIR, K.TABLE], rng);
    furnish(R, x0 + 2, x1 - 3, base - STOREY, [K.BOOKSHELF, K.BOOKSHELF, K.TABLE, K.CHAIR, K.BOOKSHELF, K.BOOKSHELF, K.TABLE, K.BOOKSHELF], rng);
    furnish(R, x0 + 2, x1 - 3, base - STOREY * 2, [K.BED, K.TABLE, K.BED, K.BOOKSHELF, K.BED, K.TABLE, K.BED], rng);
    furnish(R, x0 + 2, x1 - 3, base - STOREY * 3, [K.BANNER, K.BED, K.BOOKSHELF, K.BANNER, K.BED], rng);
    for (const x of [x0 + 2, x1 - 2, m - 6, m + 6]) R.set(x, base - 4, K.BANNER);
  },

  /** A city's gatehouse: a stone tower with doors through it at ground level, floors inside and battlements. */
  gate(R, st, b) {
    const { x0, x1 } = b, lv = R.level, top = lv - 20;
    for (let x = x0; x <= x1; x++) { R.set(x, lv, st.stone); R.set(x, lv + 1, st.stone); R.set(x, top, st.stone); }
    for (let y = top; y < lv; y++) { R.set(x0, y, st.stone); R.set(x1, y, st.stone); }
    for (let y = top + 1; y < lv; y++) for (let x = x0 + 1; x < x1; x++) R.set(x, y, K.AIR, st.stoneBack);
    for (const x of [x0, x1]) for (let y = lv - 3; y < lv; y++) R.set(x, y, K.DOOR);
    for (const y of [lv - 5, lv - 10, lv - 15]) for (let x = x0 + 1; x < x1; x++) R.set(x, y, K.PLATFORM);
    for (let y = lv - 1; y >= top; y--) R.set(x0 + 3, y, K.LADDER, st.stoneBack);
    // Arrow slits (glass), lanterns, banners.
    for (const y of [lv - 7, lv - 12, lv - 17]) { R.set(x0, y, K.GLASS); R.set(x1, y, K.GLASS); }
    for (const y of [lv - 4, lv - 9, lv - 14, lv - 19]) R.set(x0 + 1, y, K.LANTERN);
    R.set(x1 - 1, lv - 4, K.BANNER);
    // Battlements, a little wider than the tower.
    for (let x = x0 - 1; x <= x1 + 1; x++) R.set(x, top, st.stone);
    for (let x = x0 - 1; x <= x1 + 1; x += 2) R.set(x, top - 1, st.snow ? K.SNOW_BRICKS : st.stone);
  },
};
