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
import { planTown, buildTown, TOWN_RAMP, BELOW as TOWN_BELOW } from './towns.js';

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
];
export const BIOME_BY_KEY = new Map(BIOMES.map((b, i) => [b.key, { ...b, index: i }]));
const BY_CLIMATE = [[6, 2, 6], [0, 1, 1, 2, 0], [3, 4, 5, 3]];
const biomeIndex = key => BIOMES.findIndex(b => b.key === key);
// Worlds made since seas: the lands for each climate, and the sea.
const BY_CLIMATE_4 = [['snow', 'mountains', 'snow'], ['plains', 'forest', 'forest', 'mountains', 'plains', 'swamp'], ['desert', 'badlands', 'jungle', 'desert', 'swamp']].map(l => l.map(biomeIndex));
const SEAS = ['frozen_ocean', 'ocean', 'warm_ocean'].map(biomeIndex);

/** The world's ruins and cabins: { kind, x0, y0, x1, y1 (tiles, inclusive), ... }. */
const RUIN_CELL = 240, CABIN_W = 160, CABIN_H = 96;

export class WorldGen {
  /**
   * gen: the version of the generator the world was made with (worldsave.js's WORLD_GEN): 1 the
   * first; 2 has towns (towns.js); 3 ores in veins and nodes, gems, diamond pipes and geodes;
   * 4 seas, beaches, lakes and swamps. Worlds keep the land they were made with. (towns: true,
   * an older way to say 2.)
   */
  constructor(seed, { towns = false, gen = 0, noTowns = false } = {}) {
    this.seed = seed | 0;
    this.version = gen || (towns ? 2 : 1);
    // (A world made without towns, by its settings: worldrules.js.)
    this.towns = this.version >= 2 && !noTowns;
    this.veins = this.version >= 3;
    this.seas = this.version >= 4;
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
    if (k === this.spawnRegion) b = BIOMES[0];
    else {
      const t = fbm1(this.seed + 11, k * 0.31, 2);
      const climate = t < -0.22 ? 0 : t > 0.22 ? 2 : 1;
      if (this.seas && Math.abs(k - this.spawnRegion) > 1 && fbm1(this.seed + 13, k * 0.2, 2) > SEA_NOISE) b = BIOMES[SEAS[climate]];
      else {
        const list = (this.seas ? BY_CLIMATE_4 : BY_CLIMATE)[climate];
        b = BIOMES[list[hash3(this.seed, k, 5) % list.length]];
      }
    }
    if (this.biomes.size > 512) this.biomes.clear();
    this.biomes.set(k, b);
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
    let town = this.townIn(k);
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
        c.beach = true;
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
      return b.top;
    }
    if (depth < col.soilDepth) return b.soil;
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

  /** The ruins, cabins and shipwrecks touching the tile box (inclusive). */
  structuresIn(x0, y0, x1, y1) {
    const out = [];
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
    const t = this.townIn(this.regionAt(x));
    return t && x >= t.x0 - TOWN_RAMP && x <= t.x1 + TOWN_RAMP ? t : null;
  }

  /** The town within `margin` tiles of column x (across), or null. */
  townNear(x, margin = 0) {
    const t = this.townIn(this.regionAt(x));
    return t && x >= t.x0 - margin && x <= t.x1 + margin ? t : null;
  }

  /** The town protecting tile (x, y) from being dug, built on or blasted, or null. */
  townProtecting(x, y) {
    const t = this.townNear(x, 1);
    return t && y >= t.top && y <= t.bottom ? t : null;
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
    // Trees (crowns reach a few tiles either side of the trunk).
    for (let x = x0 - 5; x < x0 + CHUNK + 5; x++) {
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
    const wrecks = y0 + CHUNK > SEA_ROW ? this.structuresIn(x0, SEA_ROW, x0 + CHUNK - 1, WORLD_H - 1).filter(st => st.kind === 'wreck') : [];
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
