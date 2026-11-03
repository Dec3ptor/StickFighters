// Blueprints (world mode): whole buildings put up at once. A blueprint is drawn up at a drafting
// table (craftitems.js) and kept: held, it shows its building where it would go (a ghost of it,
// worldrender.js: red where something's in the way), R flips it, and a click puts it up, a block
// at a time over a few seconds, from what's carried (dev mode: free). It needs room (nothing in
// the way where it goes: plants are cleared), ground under it (a bridge: at both ends), the
// right to build there (not in a town, nor someone else's base) and everything it's made of.
// Aimed at the ground, its bottom row goes into it, flush (a foundation); aimed above it, on it.
//
// A building is drawn in rows of letters, top to bottom (LEGEND: what each puts there, and what
// it uses up), and the walls behind in rows of their own (WALL_LEGEND); '.' is room inside (kept
// clear), ' ' is outside it (left as it is). It goes up from where it's aimed: the middle of its
// bottom row.

import * as K from './blocks.js';
import { BLOCKS, SOLID, LIQUID, TILE, AIR, NO_WALL, WALLS, SHAPES } from './blocks.js';
import { itemOf } from './items.js';
import { soldierIn } from './doors.js';
import { WORLD_H } from './worldgen.js';

const SHAPE = Object.fromEntries(SHAPES.map((s, i) => [s.key, i]));
// (Flipped: a ramp up to the right becomes one up to the left.)
const FLIP_SHAPE = [0, 1, 2, 4, 3, 6, 5];

/** What each letter of a building puts there: [the item it uses, its shape]. */
const LEGEND = {
  P: ['planks'], S: ['stone_bricks'], C: ['cobblestone'], L: ['wood'], M: ['mossy_cobblestone'], Q: ['polished_stone'],
  '^': ['roof_tiles'], '/': ['roof_tiles', SHAPE.rampR], '\\': ['roof_tiles', SHAPE.rampL], s: ['stone_bricks', SHAPE.bottom],
  D: ['door'], G: ['glass_pane'], W: ['window'], H: ['ladder'], '-': ['platform'], F: ['fence'], l: ['post'], I: ['iron_bars'],
  o: ['lantern'], c: ['candle'], b: ['bed'], t: ['table'], h: ['chair'], x: ['chest'], w: ['workbench'], f: ['furnace'], a: ['anvil'],
  B: ['bookshelf'], p: ['flower_pot'], r: ['carpet'], T: ['trapdoor'], n: ['banner'], k: ['cabinet'], e: ['stove'], O: ['torch'],
};
/** The walls behind. */
const WALL_LEGEND = { p: 'plank_wall', s: 'stone_brick_wall', g: 'glass_wall', t: 'timber_wall', c: 'cobble_wall', l: 'log_wall', b: 'brick_wall' };

/**
 * The buildings: name, rows (top to bottom), walls (the same size), ground ('floor': under its bottom
 * row, mostly ground; 'ends': under both ends of it, a bridge's).
 */
export const BUILDINGS = {
  cottage: {
    name: 'Cottage', ground: 'floor',
    rows: [
      '    /^\\    ',
      '   /^^^\\   ',
      '  /^^^^^\\  ',
      ' /^^^^^^^\\ ',
      '/PPPPPPPPP\\',
      ' L...o...L ',
      ' D.......D ',
      ' D...c...D ',
      ' Db.htx.pD ',
      ' PPPPPPPPP ',
    ],
    walls: [
      '           ',
      '           ',
      '           ',
      '           ',
      '           ',
      '  ppppppp  ',
      '  pggpggp  ',
      '  pggpggp  ',
      '  ppppppp  ',
      '           ',
    ],
  },
  stone_house: {
    name: 'Stone house', ground: 'floor',
    rows: [
      '     /^\\     ',
      '    /^^^\\    ',
      '   /^^^^^\\   ',
      '  /^^^^^^^\\  ',
      ' /^^^^^^^^^\\ ',
      '/SSSSSSSSSSS\\',
      ' S....o....S ',
      ' G.........G ',
      ' G.........G ',
      ' S.Bb.r.hBHS ',
      ' S--------HS ',
      ' S....o...HS ',
      ' D........HD ',
      ' D...c....HD ',
      ' Df.htx.wkHD ',
      ' SSSSSSSSSSS ',
    ],
    walls: [
      '             ',
      '             ',
      '             ',
      '             ',
      '             ',
      '             ',
      '  sssssssss  ',
      '  ssggsggss  ',
      '  ssggsggss  ',
      '  sssssssss  ',
      '             ',
      '  sssssssss  ',
      '  ssggsggss  ',
      '  ssggsggss  ',
      '  sssssssss  ',
      '             ',
    ],
  },
  watchtower: {
    name: 'Watchtower', ground: 'floor',
    rows: [
      'S S S S',
      'SSSSSHS',
      'S..o.HS',
      'S....HS',
      'I....HI',
      'S....HS',
      'S----HS',
      'S..o.HS',
      'S....HS',
      'I....HI',
      'S....HS',
      'D....HD',
      'D....HD',
      'Dx...HD',
      'SSSSSSS',
    ],
    walls: [
      '       ',
      '       ',
      ' sssss ',
      ' sssss ',
      ' sssss ',
      ' sssss ',
      '       ',
      ' sssss ',
      ' sssss ',
      ' sssss ',
      ' sssss ',
      ' sssss ',
      ' sssss ',
      ' sssss ',
      '       ',
    ],
  },
  wall: {
    name: 'Wall section', ground: 'floor',
    rows: [
      'S S S S',
      'SSSSSSS',
      'SSSSSSS',
      'SSSSSSS',
      'CCCCCCC',
    ],
    walls: ['       ', '       ', '       ', '       ', '       '],
  },
  bridge: {
    name: 'Bridge', ground: 'ends',
    rows: [
      'o             o',
      'lFFFFFFFFFFFFFl',
      'PPPPPPPPPPPPPPP',
    ],
    walls: ['               ', '               ', '               '],
  },
  workshop: {
    name: 'Workshop', ground: 'floor',
    rows: [
      '    /^\\    ',
      '   /^^^\\   ',
      '  /^^^^^\\  ',
      ' /^^^^^^^\\ ',
      '/PPPPPPPPP\\',
      ' l...o...l ',
      ' l.......l ',
      ' l.......l ',
      ' lw.f.a.xl ',
      ' CCCCCCCCC ',
    ],
    walls: [
      '           ',
      '           ',
      '           ',
      '           ',
      '           ',
      '  ttttttt  ',
      '  ttttttt  ',
      '  ttttttt  ',
      '  ttttttt  ',
      '           ',
    ],
  },
};

// ---- A building's cells ------------------------------------------------------------------------------

const CELLS = new Map();

/**
 * Building `key`'s cells, flipped or not: [{ dx, dy (from the middle of its bottom row), layer ('fg',
 * 'bg' or 'room': kept clear), id (a block or a wall), shape, key (the item it uses up; null: none,
 * the rest of a door), phase (1: walls behind, 2: blocks, 3: what stands, hangs or is opened) }],
 * in the order they go up. Worked out once each.
 */
export function kitCells(key, flip = false) {
  const ck = `${key}|${flip ? 1 : 0}`;
  if (CELLS.has(ck)) return CELLS.get(ck);
  const kit = BUILDINGS[key];
  if (!kit) return [];
  const H = kit.rows.length, W = kit.rows[0].length, mid = Math.floor(W / 2), out = [];
  const dxOf = c => (flip ? W - 1 - c : c) - mid;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const ch = kit.rows[r][c], wc = kit.walls[r]?.[c], dx = dxOf(c), dy = r - (H - 1);
      if (wc && WALL_LEGEND[wc]) {
        const w = WALLS.find(x => x.key === WALL_LEGEND[wc]);
        out.push({ dx, dy, layer: 'bg', id: w.id, shape: 0, key: w.key, phase: 1 });
      }
      if (ch === ' ' || ch == null) continue;
      if (ch === '.') { out.push({ dx, dy, layer: 'room', id: AIR, shape: 0, key: null, phase: 0 }); continue; }
      const [item, shape = 0] = LEGEND[ch] || [];
      const it = itemOf(item);
      if (!it) throw new Error(`Blueprint ${key}: no item for '${ch}'`);
      const id = it.block, sh = flip ? FLIP_SHAPE[shape] : shape;
      // (A door: one used up for the three tiles of it, counted at its bottom.)
      const doorRest = ch === 'D' && kit.rows[r + 1]?.[c] === 'D';
      out.push({ dx, dy, layer: 'fg', id, shape: id === K.TRAPDOOR ? SHAPE.top : sh, key: doorRest ? null : item, phase: SOLID[id] && id !== K.DOOR ? 2 : 3 });
    }
  }
  // Walls behind first, then the blocks, then what stands on them, hangs from them, or opens: each
  // from the bottom up, along each row.
  out.sort((a, b) => a.phase - b.phase || b.dy - a.dy || a.dx - b.dx);
  CELLS.set(ck, out);
  return out;
}

/** How big building `key` is: { w, h }. */
export const kitSize = key => ({ w: BUILDINGS[key]?.rows[0].length || 0, h: BUILDINGS[key]?.rows.length || 0 });

/** What building `key` uses up: [[item key, n]...], the most first. */
export function kitNeeds(key) {
  const n = new Map();
  for (const c of kitCells(key)) if (c.key) n.set(c.key, (n.get(c.key) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]);
}

/** What's short of building `key`, carried in inventory `inv` (free: nothing): [[item key, n short]...]. */
export function kitShort(key, inv, free = false) {
  if (free) return [];
  return kitNeeds(key).map(([k, n]) => [k, n - inv.count(k)]).filter(([, n]) => n > 0);
}

// What building over is fine: nothing, or plants (cleared).
const CLEARS = new Set([K.TALL_GRASS, K.FLOWER, K.DEAD_BUSH, K.FERN, K.BUSH, K.DRY_TALL_GRASS, K.PETALS, K.MUSHROOM]);
const free = id => id === AIR || CLEARS.has(id);
// What a building's bottom row can go into, as its foundation (aimed at the ground: flush with it):
// plain natural ground (dirt, grass, sand, stone...), not ore, nothing hard to dig.
const groundOf = id => !!SOLID[id] && BLOCKS[id].natural && BLOCKS[id].tier === 0 && BLOCKS[id].resist < 1e9 && !BLOCKS[id].ore && !LIQUID[id];
/** Whether cell c (of a building) can go where block `id` is: it's free, or it's the bottom row's block going into the ground. */
const takes = (c, id) => (free(id) && !LIQUID[id]) || (c.dy === 0 && c.layer === 'fg' && !!SOLID[c.id] && groundOf(id));

/**
 * Whether building `key` (flipped or not) can go up from (tx, ty) (the middle of its bottom row),
 * for player s (allowed(tx, ty): whether they may build there). Returns { ok, why, bad (the cells in
 * the way: [[tx, ty]...]) }. Materials aren't looked at here: kitShort.
 */
export function kitCheck(game, key, flip, tx, ty, allowed = () => true) {
  const world = game.world, kit = BUILDINGS[key], bad = [];
  if (!kit) return { ok: false, why: 'No such building', bad };
  let why = '';
  for (const c of kitCells(key, flip)) {
    if (c.layer === 'bg') continue;
    const x = tx + c.dx, y = ty + c.dy;
    if (y < 1 || y >= WORLD_H - 1) { bad.push([x, y]); why ||= 'Too near the top or bottom of the world'; continue; }
    const id = world.tile(x, y);
    if (!takes(c, id)) { bad.push([x, y]); why ||= 'Something\'s in the way'; continue; }
    if (!allowed(x, y)) { bad.push([x, y]); why ||= 'Not here: it\'s a town, or someone\'s base'; continue; }
    if (c.layer === 'fg' && SOLID[c.id] && soldierIn(game, x, y, y)) { bad.push([x, y]); why ||= 'Someone\'s standing in the way'; }
  }
  // Ground under it.
  const { w, h } = kitSize(key), bottom = BUILDINGS[key].rows[h - 1], cols = [];
  for (let c = 0; c < w; c++) if (bottom[c] !== ' ') cols.push((flip ? w - 1 - c : c) - Math.floor(w / 2));
  const ground = dx => !!SOLID[world.tile(tx + dx, ty + 1)];
  if (kit.ground === 'ends') {
    if (!cols.length || !ground(Math.min(...cols)) || !ground(Math.max(...cols))) why ||= 'A bridge needs ground under both its ends';
  } else if (cols.filter(ground).length < Math.ceil(cols.length * 0.6)) why ||= 'It needs level ground under it';
  return { ok: !why, why, bad };
}

// ---- Putting one up ----------------------------------------------------------------------------------

/** How long a building takes to go up (updates, at full speed), at most; and at least how many cells a step. */
const BUILD_TICKS = 150;

/**
 * Start building `key` (flipped or not) from (tx, ty), for player s: what it uses up taken from
 * their things (unless free), the job queued (kitsTick puts it up). drop(key, n, x, y): something
 * on the ground (what a cell that couldn't go in would have used). Returns the job.
 */
export function startKit(game, s, key, flip, tx, ty, { free = false, drop = null } = {}) {
  if (!free) for (const [k, n] of kitNeeds(key)) s.world.inv.remove(k, n);
  const cells = kitCells(key, flip).map(c => ({ ...c, tx: tx + c.dx, ty: ty + c.dy }));
  const job = { key, owner: s?.id ?? -1, cells, at: 0, step: Math.max(1, Math.ceil(cells.length / BUILD_TICKS)), placed: [], free, drop, tick: game.tick };
  (game.world.builds ||= []).push(job);
  game.sound('build', tx * TILE + 8, ty * TILE + 8);
  return job;
}

/**
 * Each update: the buildings going up, a few cells each (a puff of dust as each part goes in).
 * A cell that's been filled since is skipped (what it would have used goes on the ground); one with
 * someone standing in it waits a little, then the same. Returns the jobs finished (for undo: their
 * `placed`).
 */
export function kitsTick(game, all = false) {
  const world = game.world, jobs = world.builds;
  if (!jobs?.length) return [];
  const done = [];
  for (const job of jobs) {
    let n = all ? Infinity : job.step;
    while (n-- > 0 && job.at < job.cells.length) {
      const c = job.cells[job.at++];
      placeCell(game, job, c, all);
    }
    if (job.at >= job.cells.length) done.push(job);
  }
  if (done.length) world.builds = jobs.filter(j => !done.includes(j));
  return done;
}

function placeCell(game, job, c, all) {
  const world = game.world, x = c.tx, y = c.ty;
  if (c.layer === 'bg') {
    const had = world.wall(x, y);
    if (had !== NO_WALL && !WALLS[had].natural) return refund(game, job, c);
    world.setWall(x, y, c.id);
    job.placed.push(c);
    return;
  }
  const id = world.tile(x, y);
  if (c.layer === 'room') { if (id !== AIR && free(id)) world.setTile(x, y, AIR); return; }
  if (!takes(c, id)) return refund(game, job, c);
  if (SOLID[c.id] && soldierIn(game, x, y, y)) {
    // (Someone in the way: tried again at the end, a few times.)
    if (!all && (c.waits = (c.waits || 0) + 1) < 4) { job.cells.push(c); return; }
    return refund(game, job, c);
  }
  // (Into the ground, a foundation: what was there, kept for undo.)
  const was = free(id) ? null : { id, sb: world.shapeByte(x, y) };
  world.setTile(x, y, c.id);
  if (c.shape) world.setShape(x, y, c.shape);
  job.placed.push(was ? { ...c, was } : c);
  if (!all && (job.placed.length % 6 === 0 || c.phase === 3)) game.fx?.built?.(x * TILE, y * TILE, x * TILE + TILE, y * TILE + TILE);
  if (!all && job.placed.length % 10 === 0) game.sound('build', x * TILE + 8, y * TILE + 8);
}

/** A cell that couldn't go in: what it would have used, on the ground there (unless it was free). */
function refund(game, job, c) {
  if (!job.free && c.key) job.drop?.(c.key, 1, c.tx * TILE + 8, c.ty * TILE + 8);
}

/** Every building still going up, finished now (before the world's saved). */
export const finishKits = game => kitsTick(game, true);

/** Whether block `id` (a cell of a building) is still what was put there, at (tx, ty). */
export const stillThere = (world, c) => (c.layer === 'bg' ? world.wall(c.tx, c.ty) === c.id : world.tile(c.tx, c.ty) === c.id);
