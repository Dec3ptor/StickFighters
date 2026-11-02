// Drawing a world (world mode), in either game's look: the original's paper and ink (blocks
// white, outlined in ink where they meet the open, marked by what they are), or Remastered's
// colours. Blocks are drawn a patch at a time (PATCH tiles square) into pictures kept until a
// block in them changes, so a frame is a few dozen pictures copied, whatever's in them. Then the
// light (dark underground, lit by torches and glowing things), what's lying on the ground, and
// the crosshair's block: what you'd dig, and what you'd build (a whole shape, dragged out).

import * as K from './blocks.js';
import { BLOCKS, WALLS, SOLID, PLATFORMS, CLEAR, LIGHT, TILE, AIR, NO_WALL, SHAPES, shade } from './blocks.js';
import { WORLD_H } from './worldgen.js';
import { hash3 } from './noise.js';
import { itemOf } from './items.js';
import { REACH, shapeTiles, canPlace, inHand, rightHand } from './worldplay.js';
import { skyLevel } from './monsters.js';
import { itemColor, isPrecious } from './iteminfo.js';

export const PATCH = 16;                 // tiles across a picture
const PP = PATCH * TILE;                 // its size in the world (px)
const PATCHES_Y = WORLD_H / PATCH;
const MAX_PIXELS = 20e6;                 // pictures kept, at most (in pixels): the least recently drawn go first
const PAINT_MS = 4;                      // time a frame spends making pictures, at most (at least one; more with none there yet)
const INK = '#111';
// shade(), remembered: the same few colours are worked out for every block drawn.
const TINTS = new Map();
function tint(hex, k) {
  const key = hex + k;
  let c = TINTS.get(key);
  if (c === undefined) {
    if (TINTS.size > 5000) TINTS.clear();
    TINTS.set(key, c = shade(hex, k));
  }
  return c;
}
const pkey = (px, py) => (px + 1048576) * 64 + py;

// Which sides of a tile each shape covers completely: [top, right, bottom, left].
const COVER = {
  full: [1, 1, 1, 1], bottom: [0, 0, 1, 0], top: [1, 0, 0, 0], rampR: [0, 1, 1, 0], rampL: [0, 0, 1, 1], ceilR: [1, 1, 0, 0], ceilL: [1, 0, 0, 1],
};
const SHAPE_KEYS = SHAPES.map(s => s.key);
// Each shape's outline (in sixteenths), drawn as a polygon: ramps are drawn as the slopes they are.
const OUTLINE = {
  full: [[0, 0], [16, 0], [16, 16], [0, 16]],
  bottom: [[0, 8], [16, 8], [16, 16], [0, 16]],
  top: [[0, 0], [16, 0], [16, 8], [0, 8]],
  rampR: [[16, 0], [16, 16], [0, 16]],
  rampL: [[0, 0], [16, 16], [0, 16]],
  ceilR: [[0, 0], [16, 0], [16, 16]],
  ceilL: [[0, 0], [16, 0], [0, 16]],
};

// ---- One picture: a patch of the world -----------------------------------------------------------

/** The patch's tiles, and a tile's worth round it (for edges), read once. */
function readPatch(world, px, py, grid) {
  const x0 = px * PATCH - 1, y0 = py * PATCH - 1, W = PATCH + 2;
  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const tx = x0 + i, ty = y0 + j, k = j * W + i;
      grid.fg[k] = world.tile(tx, ty);
      grid.bg[k] = world.wall(tx, ty);
      grid.sh[k] = SOLID[grid.fg[k]] ? world.shape(tx, ty) : 0;
    }
  }
}

/** Whether the tile at grid index k covers side `side` (0 top, 1 right, 2 bottom, 3 left) of its neighbour. */
function covers(grid, k, side) {
  const id = grid.fg[k];
  if (!SOLID[id] || CLEAR[id]) return false;
  return COVER[SHAPE_KEYS[grid.sh[k]]][side] === 1;
}

// (w: how many tiles across the grid is.)
const GRIDS = { w: PATCH + 2, fg: new Uint8Array((PATCH + 2) ** 2), bg: new Uint8Array((PATCH + 2) ** 2), sh: new Uint8Array((PATCH + 2) ** 2) };

/**
 * Draw patch (px, py) of `world` into g (set to world coordinates). What gives off light in it
 * goes in `lights` (x, y, level, block: four numbers each).
 */
function paintPatch(g, world, px, py, look, lights) {
  const grid = GRIDS, W = PATCH + 2, x0 = px * PATCH, y0 = py * PATCH;
  readPatch(world, px, py, grid);
  const classic = look === 'classic';
  lights.length = 0;
  // Walls behind, where they show.
  for (let j = 0; j < PATCH; j++) {
    for (let i = 0; i < PATCH; i++) {
      const k = (j + 1) * W + i + 1, wall = grid.bg[k], id = grid.fg[k];
      if (wall === NO_WALL || (SOLID[id] && grid.sh[k] === 0 && !CLEAR[id])) continue;
      drawWall(g, (x0 + i) * TILE, (y0 + j) * TILE, wall, classic, x0 + i, y0 + j);
    }
  }
  // Blocks, then the plants, trees and things in front.
  const edges = [];
  for (let j = 0; j < PATCH; j++) {
    for (let i = 0; i < PATCH; i++) {
      const k = (j + 1) * W + i + 1, id = grid.fg[k];
      if (id === AIR) continue;
      const x = (x0 + i) * TILE, y = (y0 + j) * TILE, tx = x0 + i, ty = y0 + j;
      if (LIGHT[id]) lights.push(x + TILE / 2, y + TILE / 2, LIGHT[id], id);
      if (SOLID[id]) drawBlock(g, grid, k, x, y, id, classic, tx, ty, edges);
      else drawThing(g, grid, k, x, y, id, classic, tx, ty);
    }
  }
  // The outlines where blocks meet the open, all in one go.
  if (edges.length) {
    g.strokeStyle = classic ? INK : 'rgba(10,8,12,0.75)';
    g.lineWidth = classic ? 1.3 : 1;
    g.lineCap = 'square';
    g.beginPath();
    for (let e = 0; e < edges.length; e += 4) { g.moveTo(edges[e], edges[e + 1]); g.lineTo(edges[e + 2], edges[e + 3]); }
    g.stroke();
  }
}

/** A wall behind: the original's light hatching, or Remastered's dark colour. */
function drawWall(g, x, y, wall, classic, tx, ty) {
  if (classic) {
    g.fillStyle = '#ececec';
    g.fillRect(x, y, TILE, TILE);
    g.strokeStyle = '#d0d0d0';
    g.lineWidth = 0.8;
    g.beginPath();
    for (let d = -TILE; d < TILE; d += 6) { g.moveTo(x + Math.max(0, d), y + Math.max(0, -d)); g.lineTo(x + Math.min(TILE, d + TILE), y + Math.min(TILE, TILE - d)); }
    g.stroke();
    return;
  }
  const w = WALLS[wall], h = hash3(7, tx, ty);
  g.fillStyle = tint(w.color, 0.92 + (h & 15) / 160);
  g.fillRect(x, y, TILE, TILE);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(x, y + TILE - 1, TILE, 1);
  g.fillRect(x + TILE - 1, y, 1, TILE);
  if (w.key.includes('brick')) { g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x, y + 7, TILE, 1); g.fillRect(x + ((ty & 1) ? 4 : 11), y, 1, 7); g.fillRect(x + ((ty & 1) ? 11 : 4), y + 8, 1, 8); }
  else if (w.key.includes('plank')) { g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x, y + 5, TILE, 1); g.fillRect(x, y + 11, TILE, 1); }
  else if (w.key === 'glass_wall') { g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(x + 3, y + 2, 2, 10); }
  else if (w.key === 'log_wall') { g.fillStyle = 'rgba(0,0,0,0.24)'; g.fillRect(x, y + 7, TILE, 1.5); g.fillRect(x, y + 15, TILE, 1); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x, y + 1, TILE, 2); }
  else if (w.key === 'timber_wall') {
    // Plaster between dark beams: posts and rails every few blocks, braces across some.
    g.fillStyle = '#5e3f25';
    if ((tx & 3) === 0) g.fillRect(x, y, 3, TILE);
    if ((ty & 3) === 0) g.fillRect(x, y, TILE, 3);
    if (((tx >> 2) + (ty >> 2)) & 1 && (tx & 3) === (ty & 3)) { g.strokeStyle = '#5e3f25'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + TILE, y + TILE); g.stroke(); }
  } else if (w.key === 'cobble_wall') { g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.8; for (const [cx, cy, rx, ry] of COBBLES[(tx + ty) & 1]) { g.beginPath(); g.ellipse(x + cx, y + cy, rx, ry, 0, 0, Math.PI * 2); g.stroke(); } }
}

// Stones in cobblestone (two layouts: [x, y, half-width, half-height]), stained glass's colours, books' bindings.
const COBBLES = [
  [[4, 4, 3.2, 2.6], [11.5, 3.5, 3.4, 2.4], [3.5, 11, 2.8, 3], [10.5, 11.5, 3.8, 2.8]],
  [[3.5, 3.5, 2.6, 2.4], [10, 4.5, 4, 3], [5, 11.5, 3.8, 2.8], [12.5, 12, 2.6, 2.6]],
];
const STAINED = ['#b8323a', '#3a6ab8', '#d8b030', '#3a9a5a'];
const BOOKS = ['#8a2c2c', '#2c4a8a', '#2c7a4a', '#8a6a2c', '#5a2c7a'];

/** A solid block: its shape, filled; its marks; the edges where it meets the open (to edges). */
function drawBlock(g, grid, k, x, y, id, classic, tx, ty, edges) {
  const b = BLOCKS[id], W = grid.w, shapeKey = SHAPE_KEYS[grid.sh[k]], h = hash3(3, tx, ty);
  const pts = OUTLINE[shapeKey];
  // Fill.
  if (classic) g.fillStyle = id === K.GLASS || id === K.ICE ? '#f4fbff' : '#fff';
  else g.fillStyle = tint(b.color, 0.93 + (h & 15) / 140);
  if (shapeKey === 'full') g.fillRect(x, y, TILE, TILE);
  else poly(g, x, y, pts, true);
  // Marks.
  if (shapeKey === 'full') marks(g, b, x, y, h, classic, grid, k);
  // Remastered: lit from above, shaded below and to the right.
  if (!classic && shapeKey === 'full') {
    if (!covers(grid, k - W, 2)) { g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x, y, TILE, 2); }
    if (!covers(grid, k + W, 0)) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + TILE - 2, TILE, 2); }
    if (!covers(grid, k + 1, 3)) { g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(x + TILE - 2, y, 2, TILE); }
  }
  // Edges where it meets the open (not where another block covers it).
  if (shapeKey === 'full') {
    if (!covers(grid, k - W, 2)) edges.push(x, y, x + TILE, y);
    if (!covers(grid, k + 1, 3)) edges.push(x + TILE, y, x + TILE, y + TILE);
    if (!covers(grid, k + W, 0)) edges.push(x, y + TILE, x + TILE, y + TILE);
    if (!covers(grid, k - 1, 1)) edges.push(x, y, x, y + TILE);
  } else {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      edges.push(x + a[0], y + a[1], x + c[0], y + c[1]);
    }
  }
}

function poly(g, x, y, pts, fill) {
  g.beginPath();
  g.moveTo(x + pts[0][0], y + pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(x + pts[i][0], y + pts[i][1]);
  g.closePath();
  if (fill) g.fill(); else g.stroke();
}

/** What marks a block (its pattern): in ink in the original, in its colours in Remastered. */
function marks(g, b, x, y, h, classic, grid, k) {
  const ink = classic ? '#9a9a9a' : b.dark;
  const r = n => (h >>> n) & 15;
  switch (b.pattern) {
    case 'grass': {
      // Soil, with grass on top where it's open (under a block, it's just soil).
      const open = !covers(grid, k - grid.w, 2);
      if (!classic) {
        g.fillStyle = b.dark;
        g.fillRect(x, y + (open ? 5 : 0), TILE, open ? TILE - 5 : TILE);
        g.fillStyle = tint(b.dark, 0.85);
        g.fillRect(x + 2 + r(4) % 12, y + 9 + r(8) % 5, 2, 2);
      }
      if (open) {
        if (!classic) { g.fillStyle = b.color; g.fillRect(x, y, TILE, 5); }
        g.fillStyle = classic ? INK : tint(b.color, 1.2);
        for (let i = 1; i < TILE; i += 3) g.fillRect(x + i, y - 1 - (((h >>> i) & 1) ? 1 : 0), 1, classic ? 2.5 : 3);
      }
      break;
    }
    case 'dots':
      g.fillStyle = ink;
      g.fillRect(x + 2 + r(0) % 11, y + 2 + r(4) % 11, 1.4, 1.4);
      g.fillRect(x + 2 + r(8) % 11, y + 2 + r(12) % 11, 1.4, 1.4);
      if (r(16) > 8) g.fillRect(x + 2 + r(20) % 11, y + 2 + r(24) % 11, 1.4, 1.4);
      break;
    case 'stipple':
      g.fillStyle = ink;
      for (let i = 0; i < 5; i++) g.fillRect(x + 1 + ((h >>> (i * 5)) & 15) % 14, y + 1 + ((h >>> (i * 5 + 2)) & 15) % 14, 1, 1);
      break;
    case 'cracks':
      if (r(0) < 6) {
        g.strokeStyle = ink;
        g.lineWidth = 0.8;
        g.beginPath();
        const cx = x + 3 + r(4) % 10, cy = y + 3 + r(8) % 10;
        g.moveTo(cx - 3, cy - 2); g.lineTo(cx, cy); g.lineTo(cx + 3, cy - 1);
        g.stroke();
      }
      break;
    case 'pebbles':
      g.strokeStyle = ink;
      g.lineWidth = 0.7;
      for (let i = 0; i < 3; i++) g.strokeRect(x + 2 + ((h >>> (i * 6)) & 15) % 11, y + 2 + ((h >>> (i * 6 + 3)) & 15) % 11, 2, 2);
      break;
    case 'strata':
      g.fillStyle = ink;
      g.fillRect(x, y + 5 + (r(0) & 1), TILE, 1);
      g.fillRect(x + r(4) % 8, y + 11, 6, 1);
      break;
    case 'veins':
      g.strokeStyle = classic ? '#d0602c' : '#ff8a3a';
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x, y + 3 + r(0) % 8); g.lineTo(x + 8, y + 6 + r(4) % 6); g.lineTo(x + TILE, y + 2 + r(8) % 10); g.stroke();
      break;
    case 'ore': {
      // Ores keep a fleck of their colour in both games: worth telling apart.
      g.fillStyle = b.ore;
      for (let i = 0; i < 4; i++) {
        const ox = x + 2 + ((h >>> (i * 7)) & 15) % 11, oy = y + 2 + ((h >>> (i * 7 + 3)) & 15) % 11;
        g.fillRect(ox, oy, 3, 3);
        if (classic) { g.strokeStyle = INK; g.lineWidth = 0.6; g.strokeRect(ox, oy, 3, 3); }
      }
      break;
    }
    case 'rings':
      g.strokeStyle = ink;
      g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(x + 2, y + 1); g.lineTo(x + 2, y + TILE - 1); g.moveTo(x + 8, y + 1); g.lineTo(x + 8, y + TILE - 1); g.moveTo(x + 13, y + 1); g.lineTo(x + 13, y + TILE - 1); g.stroke();
      break;
    case 'planks':
      g.fillStyle = ink;
      g.fillRect(x, y + 5, TILE, 1);
      g.fillRect(x, y + 11, TILE, 1);
      g.fillRect(x + ((h & 1) ? 4 : 10), y, 1, 5);
      g.fillRect(x + ((h & 1) ? 12 : 6), y + 6, 1, 5);
      break;
    case 'bricks': {
      g.fillStyle = ink;
      g.fillRect(x, y + 7, TILE, 1);
      g.fillRect(x, y + 15, TILE, 1);
      const odd = (y / TILE) & 1;
      g.fillRect(x + (odd ? 4 : 11), y, 1, 7);
      g.fillRect(x + (odd ? 11 : 4), y + 8, 1, 7);
      if (b.key === 'mossy_bricks') { g.fillStyle = classic ? '#8aa86a' : '#5f8a3a'; g.fillRect(x + r(0) % 10, y, 5, 2); }
      break;
    }
    case 'glass':
      g.strokeStyle = classic ? '#b0c0c8' : 'rgba(255,255,255,0.6)';
      g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(x + 3, y + 9); g.lineTo(x + 8, y + 4); g.moveTo(x + 6, y + 12); g.lineTo(x + 12, y + 6); g.stroke();
      break;
    case 'metal':
      g.strokeStyle = classic ? '#9a9a9a' : tint(b.color, 0.7);
      g.lineWidth = 0.8;
      g.strokeRect(x + 1.5, y + 1.5, TILE - 3, TILE - 3);
      g.fillStyle = classic ? INK : tint(b.color, 0.55);
      g.fillRect(x + 3, y + 3, 1.5, 1.5); g.fillRect(x + 11.5, y + 3, 1.5, 1.5); g.fillRect(x + 3, y + 11.5, 1.5, 1.5); g.fillRect(x + 11.5, y + 11.5, 1.5, 1.5);
      break;
    case 'door': {
      g.strokeStyle = classic ? INK : tint(b.color, 0.6);
      g.lineWidth = 0.8;
      g.strokeRect(x + 2.5, y + 0.5, TILE - 5, TILE - 1);
      // (The handle on the middle of the three.)
      const W = grid.w;
      if (grid.fg[k - W] === K.DOOR && grid.fg[k + W] === K.DOOR) { g.fillStyle = classic ? INK : '#e0c060'; g.fillRect(x + TILE - 6, y + 7, 2, 2); }
      break;
    }
    case 'gem': {
      // Crystals poking out of the rock: faceted, in the gem's colour, with a glint (in both games).
      for (let i = 0; i < 3; i++) {
        const cx = x + 3.5 + ((h >>> (i * 6)) & 7) + i * 1.5, cy = y + 4 + ((h >>> (i * 6 + 3)) & 7), s = 2.1 + ((h >>> (20 + i)) & 1) * 0.9;
        g.fillStyle = b.ore;
        g.beginPath(); g.moveTo(cx, cy - s); g.lineTo(cx + s * 0.75, cy); g.lineTo(cx, cy + s); g.lineTo(cx - s * 0.75, cy); g.closePath(); g.fill();
        g.strokeStyle = classic ? INK : 'rgba(0,0,0,0.45)'; g.lineWidth = 0.6; g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(cx - 0.7, cy - s * 0.55, 1.1, 1.1);
      }
      break;
    }
    case 'cobble':
      // Rounded stones set in mortar (two layouts, by the tile).
      g.strokeStyle = ink;
      g.lineWidth = 0.8;
      for (const [cx, cy, rx, ry] of COBBLES[h & 1]) { g.beginPath(); g.ellipse(x + cx, y + cy, rx, ry, 0, 0, Math.PI * 2); g.stroke(); }
      break;
    case 'shingles':
      // Rows of tiles, each row overlapping the one below.
      g.fillStyle = ink;
      for (let row = 0; row < 3; row++) {
        const ry = y + 5 + row * 5;
        g.fillRect(x, ry, TILE, 1);
        for (let i = row & 1 ? 2 : 5; i < TILE; i += 6) g.fillRect(x + i, ry - 4, 1, 4);
      }
      if (!classic) { g.fillStyle = 'rgba(255,255,255,0.13)'; for (let row = 0; row < 3; row++) g.fillRect(x, y + 1 + row * 5, TILE, 1); }
      break;
    case 'thatch':
      // Straw, laid in bundles.
      g.strokeStyle = ink;
      g.lineWidth = 0.8;
      g.beginPath();
      for (let i = 1; i < TILE; i += 3) {
        const j = (h >>> i) & 1;
        g.moveTo(x + i, y + 1 + j); g.lineTo(x + i + 1, y + 7 + j);
        g.moveTo(x + i + 1, y + 9 - j); g.lineTo(x + i, y + 15);
      }
      g.stroke();
      break;
    case 'timber':
      // A dark beam: its grain, and a peg.
      g.fillStyle = ink;
      g.fillRect(x + 4, y + 2 + (h & 3), 1, 9);
      g.fillRect(x + 10, y + 5 + ((h >>> 3) & 3), 1, 8);
      g.fillStyle = classic ? INK : tint(b.color, 1.4);
      g.fillRect(x + 7, y + 7, 2, 2);
      break;
    case 'stained':
      // Coloured panes, leaded.
      if (!classic) for (let i = 0; i < 4; i++) { g.fillStyle = STAINED[(h >>> (i * 2)) & 3]; g.fillRect(x + 1 + (i & 1) * 7, y + 1 + (i >> 1) * 7, 7, 7); }
      g.strokeStyle = classic ? INK : '#2a2230';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x + 8, y); g.lineTo(x + 8, y + TILE); g.moveTo(x, y + 8); g.lineTo(x + TILE, y + 8); g.stroke();
      break;
    case 'crate':
      g.strokeStyle = classic ? INK : '#3a2c14';
      g.lineWidth = 1;
      g.strokeRect(x + 1.5, y + 1.5, TILE - 3, TILE - 3);
      g.beginPath(); g.moveTo(x + 2, y + 2); g.lineTo(x + TILE - 2, y + TILE - 2); g.moveTo(x + TILE - 2, y + 2); g.lineTo(x + 2, y + TILE - 2); g.stroke();
      break;
    default: break;
  }
}

/** Something you walk through: trees, plants, torches, platforms, ladders, an open door. */
function drawThing(g, grid, k, x, y, id, classic, tx, ty) {
  const b = BLOCKS[id], h = hash3(5, tx, ty), W = grid.w;
  const col = classic ? '#fff' : b.color, line = classic ? INK : tint(b.color, 0.55);
  switch (b.pattern) {
    case 'bark': {
      // (Inside a crown: leaves behind it.)
      const l = grid.fg[k - 1], r = grid.fg[k + 1];
      if (LEAFY.has(l) && LEAFY.has(r) && l !== K.TRUNK && r !== K.TRUNK) leafFill(g, BLOCKS[l], x, y, h, classic);
      g.fillStyle = col; g.fillRect(x + 4, y, 8, TILE);
      g.strokeStyle = line; g.lineWidth = classic ? 1.2 : 1;
      g.beginPath(); g.moveTo(x + 4, y); g.lineTo(x + 4, y + TILE); g.moveTo(x + 12, y); g.lineTo(x + 12, y + TILE);
      g.moveTo(x + 7, y + 3 + (h & 3)); g.lineTo(x + 7, y + 9 + (h & 3)); g.stroke();
      break;
    }
    case 'leaves': {
      // A crown: each tile of it filled, with bumps (points, for pines) where it meets the
      // open, outlined (in ink in the original).
      leafFill(g, b, x, y, h, classic);
      const spiky = id === K.PINE_LEAVES, R = 4;
      const bumps = BUMPS;
      bumps.length = 0;
      if (!LEAFY.has(grid.fg[k - W])) bumps.push(x + 4, y, Math.PI, 0, x + 12, y, Math.PI, 0);
      if (!LEAFY.has(grid.fg[k + 1])) bumps.push(x + 16, y + 4, -Math.PI / 2, Math.PI / 2, x + 16, y + 12, -Math.PI / 2, Math.PI / 2);
      if (!LEAFY.has(grid.fg[k + W])) bumps.push(x + 12, y + 16, 0, Math.PI, x + 4, y + 16, 0, Math.PI);
      if (!LEAFY.has(grid.fg[k - 1])) bumps.push(x, y + 12, Math.PI / 2, Math.PI * 1.5, x, y + 4, Math.PI / 2, Math.PI * 1.5);
      if (!bumps.length) break;
      const edge = (fill) => {
        g.beginPath();
        for (let i = 0; i < bumps.length; i += 4) {
          const cx = bumps[i], cy = bumps[i + 1], a0 = bumps[i + 2], a1 = bumps[i + 3];
          g.moveTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
          if (spiky) { const m = (a0 + a1) / 2; g.lineTo(cx + Math.cos(m) * R * 1.3, cy + Math.sin(m) * R * 1.3); g.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R); }
          else g.arc(cx, cy, R, a0, a1);
          if (fill) g.closePath();
        }
        if (fill) g.fill(); else g.stroke();
      };
      g.fillStyle = classic ? '#fff' : leafColor(b, h);
      edge(true);
      g.strokeStyle = classic ? INK : tint(b.color, 0.55);
      g.lineWidth = classic ? 1.1 : 0.9;
      edge(false);
      break;
    }
    case 'blades':
      g.strokeStyle = classic ? INK : b.color;
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < 3; i++) { const bx = x + 3 + i * 5 + ((h >>> (i * 2)) & 1); g.moveTo(bx, y + TILE); g.lineTo(bx + ((h >>> (i + 6)) & 1 ? 2 : -2), y + 6 + ((h >>> (i * 3)) & 3)); }
      g.stroke();
      break;
    case 'flower':
      g.strokeStyle = classic ? INK : '#4f8a34'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x + 8, y + TILE); g.lineTo(x + 8, y + 8); g.stroke();
      g.fillStyle = classic ? '#fff' : ['#e05a6a', '#f2c230', '#8a6ae0', '#f2f2f2'][h & 3];
      g.beginPath(); g.arc(x + 8, y + 7, 2.6, 0, Math.PI * 2); g.fill();
      if (classic) { g.strokeStyle = INK; g.stroke(); }
      break;
    case 'mushroom':
      g.fillStyle = classic ? '#fff' : '#d8f0f4'; g.fillRect(x + 7, y + 9, 2, 7);
      g.fillStyle = classic ? '#bfe9f2' : b.color;
      g.beginPath(); g.arc(x + 8, y + 9, 5, Math.PI, 0); g.fill();
      if (classic) { g.strokeStyle = INK; g.lineWidth = 1; g.stroke(); }
      break;
    case 'vine':
      g.strokeStyle = classic ? INK : b.color; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x + 8, y); g.quadraticCurveTo(x + 4 + (h & 7), y + 8, x + 8, y + TILE); g.stroke();
      break;
    case 'cactus': {
      g.fillStyle = classic ? '#fff' : b.color;
      g.fillRect(x + 4, y, 8, TILE);
      g.strokeStyle = classic ? INK : tint(b.color, 0.6); g.lineWidth = 1;
      g.beginPath(); g.moveTo(x + 4, y); g.lineTo(x + 4, y + TILE); g.moveTo(x + 12, y); g.lineTo(x + 12, y + TILE); g.stroke();
      g.fillStyle = classic ? INK : '#d8e8a0';
      g.fillRect(x + 2, y + 4, 2, 1); g.fillRect(x + 12, y + 9, 2, 1);
      break;
    }
    case 'torch':
      g.fillStyle = classic ? INK : '#7a5634';
      g.fillRect(x + 7, y + 6, 2, 10);
      g.fillStyle = '#ffb040';
      g.beginPath(); g.arc(x + 8, y + 5, 3, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff4c0';
      g.beginPath(); g.arc(x + 8, y + 5.5, 1.4, 0, Math.PI * 2); g.fill();
      break;
    case 'platform':
      g.fillStyle = classic ? '#fff' : b.color;
      g.fillRect(x, y, TILE, 4);
      g.strokeStyle = classic ? INK : tint(b.color, 0.55); g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, TILE - 1, 3.5);
      g.beginPath(); g.moveTo(x + 3, y + 4); g.lineTo(x + 3, y + 7); g.moveTo(x + 13, y + 4); g.lineTo(x + 13, y + 7); g.stroke();
      break;
    case 'ladder':
      g.strokeStyle = classic ? INK : b.color; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(x + 3, y); g.lineTo(x + 3, y + TILE); g.moveTo(x + 13, y); g.lineTo(x + 13, y + TILE);
      g.moveTo(x + 3, y + 4); g.lineTo(x + 13, y + 4); g.moveTo(x + 3, y + 12); g.lineTo(x + 13, y + 12); g.stroke();
      break;
    case 'workbench':
    case 'gunsmith': {
      // A table: its top and legs; a saw on a workbench, a gun in a vice on a gunsmith's.
      g.fillStyle = classic ? '#fff' : b.color;
      g.fillRect(x + 1, y + 7, 14, 3);
      g.fillRect(x + 2, y + 10, 2, 6);
      g.fillRect(x + 12, y + 10, 2, 6);
      g.strokeStyle = line; g.lineWidth = 1;
      g.strokeRect(x + 1.5, y + 7.5, 13, 2);
      g.beginPath(); g.moveTo(x + 2.5, y + 10); g.lineTo(x + 2.5, y + 16); g.moveTo(x + 13.5, y + 10); g.lineTo(x + 13.5, y + 16); g.stroke();
      if (b.pattern === 'workbench') {
        g.fillStyle = classic ? INK : '#9aa0a8';
        g.beginPath(); g.moveTo(x + 4, y + 7); g.lineTo(x + 10, y + 4); g.lineTo(x + 11, y + 6); g.lineTo(x + 6, y + 7); g.closePath(); g.fill();
        g.fillStyle = classic ? '#fff' : '#7a5634'; g.fillRect(x + 10, y + 3, 3, 2);
      } else {
        g.fillStyle = classic ? INK : '#2a2e34';
        g.fillRect(x + 3, y + 4, 9, 2); g.fillRect(x + 4, y + 6, 2, 1); g.fillRect(x + 11, y + 5, 2, 2);
        g.fillStyle = classic ? '#fff' : '#8a8f96'; g.fillRect(x + 12, y + 3, 2, 4);
      }
      break;
    }
    case 'furnace': {
      // A stone box with a fire in it, and a chimney.
      g.fillStyle = classic ? '#fff' : tint(b.color, 1);
      g.fillRect(x + 1, y + 3, 14, 13);
      g.fillRect(x + 10, y, 3, 3);
      g.strokeStyle = line; g.lineWidth = 1;
      g.strokeRect(x + 1.5, y + 3.5, 13, 12);
      g.strokeRect(x + 10.5, y + 0.5, 2, 3);
      g.fillStyle = '#1a1210'; g.fillRect(x + 4, y + 8, 8, 6);
      g.fillStyle = '#ff8a30'; g.fillRect(x + 5, y + 10, 6, 4);
      g.fillStyle = '#ffd060'; g.fillRect(x + 6, y + 11, 4, 3);
      break;
    }
    case 'anvil':
      g.fillStyle = classic ? '#fff' : b.color;
      g.beginPath();
      g.moveTo(x + 1, y + 7); g.lineTo(x + 15, y + 7); g.lineTo(x + 13, y + 10); g.lineTo(x + 10, y + 10); g.lineTo(x + 11, y + 13);
      g.lineTo(x + 13, y + 16); g.lineTo(x + 3, y + 16); g.lineTo(x + 5, y + 13); g.lineTo(x + 6, y + 10); g.lineTo(x + 3, y + 10);
      g.closePath();
      g.fill();
      g.strokeStyle = line; g.lineWidth = 1; g.stroke();
      if (!classic) { g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x + 2, y + 7, 12, 1); }
      break;
    case 'chest':
      // A box with a lid and a lock (and Remastered's metal bands).
      g.fillStyle = classic ? '#fff' : b.color;
      g.fillRect(x + 1, y + 5, 14, 11);
      if (!classic) { g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x + 3, y + 5, 1.5, 11); g.fillRect(x + 11.5, y + 5, 1.5, 11); }
      g.strokeStyle = line; g.lineWidth = 1;
      g.strokeRect(x + 1.5, y + 5.5, 13, 10);
      g.beginPath(); g.moveTo(x + 1.5, y + 9.5); g.lineTo(x + 14.5, y + 9.5); g.stroke();
      g.fillStyle = classic ? INK : '#e0c060'; g.fillRect(x + 7, y + 8, 2, 3);
      break;
    case 'bed':
      // A frame, a pillow and a blanket.
      g.fillStyle = classic ? '#fff' : '#7a5634';
      g.fillRect(x, y + 6, 2, 10); g.fillRect(x + 14, y + 9, 2, 7); g.fillRect(x, y + 12, 16, 2);
      g.fillStyle = classic ? '#fff' : '#f2efe6'; g.fillRect(x + 2, y + 9, 4, 3);
      g.fillStyle = classic ? '#fff' : b.color; g.fillRect(x + 6, y + 9, 8, 3);
      g.strokeStyle = line; g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 6.5, 1, 9); g.strokeRect(x + 14.5, y + 9.5, 1, 6);
      g.strokeRect(x + 2.5, y + 9.5, 11, 4);
      g.beginPath(); g.moveTo(x + 6, y + 9.5); g.lineTo(x + 6, y + 12); g.stroke();
      break;
    case 'flag':
      // A pole, with a flag at the top.
      g.fillStyle = classic ? INK : '#5c4a3a';
      g.fillRect(x + 3, y + 1, 1.5, 15);
      g.fillRect(x + 1, y + 15, 6, 1);
      g.fillStyle = b.color;
      g.beginPath(); g.moveTo(x + 4.5, y + 1.5); g.lineTo(x + 14, y + 4.5); g.lineTo(x + 4.5, y + 7.5); g.closePath(); g.fill();
      g.strokeStyle = classic ? INK : tint(b.color, 0.55); g.lineWidth = 1; g.stroke();
      break;
    case 'door_open':
      g.fillStyle = classic ? '#fff' : b.color;
      g.fillRect(x, y, 4, TILE);
      g.strokeStyle = classic ? INK : tint(b.color, 0.55); g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, 3, TILE - 1);
      break;
    case 'post':
      // A wooden post (walked past).
      g.fillStyle = col; g.fillRect(x + 5, y, 6, TILE);
      g.strokeStyle = line; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x + 5.5, y); g.lineTo(x + 5.5, y + TILE); g.moveTo(x + 10.5, y); g.lineTo(x + 10.5, y + TILE); g.stroke();
      if (!classic) { g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(x + 6.5, y, 1.5, TILE); }
      break;
    case 'fence': {
      // A post, with rails along to the fences either side.
      const l = grid.fg[k - 1] === K.FENCE, r = grid.fg[k + 1] === K.FENCE;
      g.fillStyle = col;
      if (l || r) { const a = l ? x : x + 7, z = r ? x + TILE : x + 9; g.fillRect(a, y + 5, z - a, 2); g.fillRect(a, y + 10, z - a, 2); }
      g.fillRect(x + 6, y + 1, 4, TILE - 1);
      g.strokeStyle = line; g.lineWidth = 1;
      g.strokeRect(x + 6.5, y + 1.5, 3, TILE - 2);
      if (l || r) { const a = l ? x : x + 7, z = r ? x + TILE : x + 9; g.beginPath(); g.moveTo(a, y + 5); g.lineTo(z, y + 5); g.moveTo(a, y + 12); g.lineTo(z, y + 12); g.stroke(); }
      break;
    }
    case 'lantern': {
      // A lamp in an iron frame: on a chain under a ceiling, else standing.
      const hangs = SOLID[grid.fg[k - W]] || PLATFORMS[grid.fg[k - W]];
      g.strokeStyle = classic ? INK : '#3a3430'; g.lineWidth = 1;
      if (hangs) { g.beginPath(); g.moveTo(x + 8, y); g.lineTo(x + 8, y + 5); g.stroke(); }
      const top = hangs ? y + 5 : y + 7;
      g.fillStyle = '#ffd070'; g.fillRect(x + 5, top, 6, 7);
      g.fillStyle = '#fff4c0'; g.fillRect(x + 6.5, top + 1.5, 3, 4);
      g.fillStyle = classic ? INK : '#3a3430';
      g.fillRect(x + 4, top - 1, 8, 1.5); g.fillRect(x + 4.5, top + 7, 7, 1.5);
      g.strokeRect(x + 5.5, top + 0.5, 5, 6.5);
      break;
    }
    case 'awning':
      // Striped cloth, its edge scalloped.
      for (let i = 0; i < 4; i++) {
        g.fillStyle = classic ? (i & 1 ? '#fff' : '#e2e2e2') : i & 1 ? '#f2ead8' : b.color;
        g.fillRect(x + i * 4, y, 4, 5);
        g.beginPath(); g.arc(x + i * 4 + 2, y + 5, 2, 0, Math.PI); g.fill();
      }
      g.strokeStyle = line; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y + 0.5); g.lineTo(x + TILE, y + 0.5); g.stroke();
      break;
    case 'banner':
      // A cloth hanging from a rod, with an emblem.
      g.fillStyle = classic ? INK : '#5c4a3a'; g.fillRect(x + 2, y + 1, 12, 1.5);
      g.fillStyle = classic ? '#fff' : b.color;
      g.beginPath(); g.moveTo(x + 4, y + 2.5); g.lineTo(x + 12, y + 2.5); g.lineTo(x + 12, y + 15); g.lineTo(x + 8, y + 12); g.lineTo(x + 4, y + 15); g.closePath(); g.fill();
      g.strokeStyle = line; g.lineWidth = 1; g.stroke();
      g.fillStyle = classic ? INK : '#f2c230';
      g.beginPath(); g.arc(x + 8, y + 7, 2, 0, Math.PI * 2); g.fill();
      break;
    case 'crops':
      // Wheat: stalks with ears of grain.
      g.strokeStyle = classic ? INK : '#8a9a3a'; g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < 3; i++) { const sx = x + 3 + i * 5; g.moveTo(sx, y + TILE); g.lineTo(sx + (i - 1), y + 6); }
      g.stroke();
      for (let i = 0; i < 3; i++) {
        const sx = x + 3 + i * 5 + (i - 1), sy = y + 1 + ((h >>> i) & 1);
        g.fillStyle = classic ? '#fff' : b.color; g.fillRect(sx - 1.5, sy, 3, 6);
        if (classic) { g.strokeStyle = INK; g.strokeRect(sx - 1.5, sy, 3, 6); }
      }
      break;
    case 'table':
      g.fillStyle = col;
      g.fillRect(x, y + 7, TILE, 2.5); g.fillRect(x + 2, y + 9, 2, 7); g.fillRect(x + 12, y + 9, 2, 7);
      g.strokeStyle = line; g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 7.5, TILE - 1, 2);
      g.beginPath(); g.moveTo(x + 2.5, y + 10); g.lineTo(x + 2.5, y + 16); g.moveTo(x + 13.5, y + 10); g.lineTo(x + 13.5, y + 16); g.stroke();
      break;
    case 'chair':
      g.fillStyle = col;
      g.fillRect(x + 4, y + 2, 2, 14); g.fillRect(x + 4, y + 9, 8, 2); g.fillRect(x + 10, y + 11, 2, 5);
      g.strokeStyle = line; g.lineWidth = 0.8;
      g.strokeRect(x + 4.5, y + 2.5, 1, 13); g.strokeRect(x + 4.5, y + 9.5, 7, 1); g.strokeRect(x + 10.5, y + 11.5, 1, 4);
      break;
    case 'bookshelf':
      // Shelves of books, in many colours.
      g.fillStyle = col; g.fillRect(x + 1, y, 14, TILE);
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 4; i++) {
          const v = (h >>> (row * 8 + i * 2)) & 3;
          g.fillStyle = classic ? (v & 1 ? '#fff' : '#d8d8d8') : BOOKS[(v + row + i) % BOOKS.length];
          g.fillRect(x + 2.5 + i * 3, y + 1.5 + row * 5 + (v === 3 ? 1 : 0), 2.2, v === 3 ? 3 : 4);
        }
      }
      g.strokeStyle = line; g.lineWidth = 1;
      g.strokeRect(x + 1.5, y + 0.5, 13, TILE - 1);
      g.beginPath(); g.moveTo(x + 1.5, y + 5.5); g.lineTo(x + 14.5, y + 5.5); g.moveTo(x + 1.5, y + 10.5); g.lineTo(x + 14.5, y + 10.5); g.stroke();
      break;
    case 'barrel':
      g.fillStyle = col;
      g.beginPath(); g.moveTo(x + 4, y + 3); g.quadraticCurveTo(x + 2, y + 9.5, x + 4, y + 16); g.lineTo(x + 12, y + 16); g.quadraticCurveTo(x + 14, y + 9.5, x + 12, y + 3); g.closePath(); g.fill();
      g.strokeStyle = line; g.lineWidth = 1; g.stroke();
      g.fillStyle = classic ? INK : '#3a3430';
      g.fillRect(x + 3, y + 6, 10, 1.2); g.fillRect(x + 3, y + 12.5, 10, 1.2);
      break;
    case 'sign':
      // A board on a post.
      g.fillStyle = classic ? INK : '#5c4a3a'; g.fillRect(x + 7, y + 9, 2, 7);
      g.fillStyle = col; g.fillRect(x + 1, y + 3, 14, 7);
      g.strokeStyle = line; g.lineWidth = 1; g.strokeRect(x + 1.5, y + 3.5, 13, 6);
      g.fillStyle = classic ? '#9a9a9a' : tint(b.color, 0.5);
      g.fillRect(x + 4, y + 5.5, 8, 1); g.fillRect(x + 4, y + 7.5, 6, 1);
      break;
    default:
      g.fillStyle = col; g.fillRect(x + 4, y + 4, 8, 8);
  }
}

// Leaves (and what a crown is made of: a trunk inside it isn't its edge).
const LEAFY = new Set([K.LEAVES, K.PINE_LEAVES, K.JUNGLE_LEAVES, K.TRUNK]);
const BUMPS = [];
const leafColor = (b, h) => tint(b.color, 0.92 + (h & 15) / 140);

/** A tile of leaves, filled: white with a few leaf marks in the original; in Remastered, its colour, dappled. */
function leafFill(g, b, x, y, h, classic) {
  if (classic) {
    g.fillStyle = '#fff';
    g.fillRect(x, y, TILE, TILE);
    g.strokeStyle = '#b8b8b8';
    g.lineWidth = 0.8;
    g.beginPath();
    const ax = x + 3 + (h & 7), ay = y + 4 + ((h >> 3) & 7);
    g.moveTo(ax - 2, ay - 1.5); g.lineTo(ax, ay); g.lineTo(ax + 2, ay - 1.5);
    g.stroke();
    return;
  }
  g.fillStyle = leafColor(b, h);
  g.fillRect(x, y, TILE, TILE);
  g.fillStyle = tint(b.color, 0.72);
  g.fillRect(x + 2 + (h & 7), y + 3 + ((h >> 3) & 7), 3, 2);
  g.fillRect(x + 9 - ((h >> 6) & 3), y + 9 + ((h >> 8) & 3), 3, 2);
  g.fillStyle = tint(b.color, 1.18);
  g.fillRect(x + 4 + ((h >> 10) & 7), y + 1 + ((h >> 13) & 3), 2, 2);
}

// ---- Light ---------------------------------------------------------------------------------------

/**
 * How lit each tile in the box is (0 dark to 15 full light): daylight down to the first block
 * or wall in each column, and the light of torches and glowing blocks, spread out (less with
 * each tile, more less through solid blocks). solid: filled in with which tiles are solid
 * (for spreading more light later: spread()).
 */
export function lightBox(world, x0, y0, w, h, out, day = 15, solid = null) {
  const n = w * h;
  if (!out || out.length < n) out = new Uint8Array(n);
  if (!solid || solid.length < n) solid = new Uint8Array(n);
  for (let i = 0; i < w; i++) {
    const tx = x0 + i;
    // Down from the top of the sky: is the column open above the box?
    let sky = day;
    for (let ty = 0; ty < y0 && sky; ty++) if (blocksSky(world, tx, ty)) sky = 0;
    for (let j = 0; j < h; j++) {
      const ty = y0 + j, k = j * w + i, id = world.tile(tx, ty);
      solid[k] = SOLID[id] && !CLEAR[id] ? 1 : 0;
      if (sky && blocksSky(world, tx, ty)) sky = 0;
      out[k] = Math.max(sky, LIGHT[id]);
    }
  }
  spread(out, solid, w, 0, 0, w, h);
  lightBox.solid = solid;
  return out;
}

/**
 * Light spread out from where it is, in the part of the box (w tiles across) from (x0, y0)
 * to (x1, y1) (not including them): sweeps each way, twice (near enough to spreading from every
 * light in turn).
 */
export function spread(out, solid, w, x0, y0, x1, y1) {
  for (let pass = 0; pass < 2; pass++) {
    for (let j = y0; j < y1; j++) {
      let v = 0;
      for (let i = x0; i < x1; i++) { const k = j * w + i; v = Math.max(out[k], v - (solid[k] ? SOLID_DIM : 1)); out[k] = v; }
      v = 0;
      for (let i = x1 - 1; i >= x0; i--) { const k = j * w + i; v = Math.max(out[k], v - (solid[k] ? SOLID_DIM : 1)); out[k] = v; }
    }
    for (let i = x0; i < x1; i++) {
      let v = 0;
      for (let j = y0; j < y1; j++) { const k = j * w + i; v = Math.max(out[k], v - (solid[k] ? SOLID_DIM : 1)); out[k] = v; }
      v = 0;
      for (let j = y1 - 1; j >= y0; j--) { const k = j * w + i; v = Math.max(out[k], v - (solid[k] ? SOLID_DIM : 1)); out[k] = v; }
    }
  }
}

/** How bright the glow round each soldier is (they always see a little way round them, even underground). */
export const SOLDIER_GLOW = 11;

// How much light is lost going through a solid block (through the open, 1 a tile).
const SOLID_DIM = 2;
// The dark's colour in each game.
const DARK_CLASSIC = [34, 34, 38], DARK_RM = [5, 7, 14];
const blocksSky = (world, tx, ty) => { const id = world.tile(tx, ty); return (SOLID[id] && !CLEAR[id]) || world.wall(tx, ty) !== NO_WALL; };

// ---- The view ---------------------------------------------------------------------------------------

export class WorldView {
  /**
   * look: 'classic' or 'remastered'. picture(canvas, sx, sy, sw, sh, key, fresh, soft): how the
   * renderer puts a picture on the screen (in screen pixels; fresh: drawn again since it was
   * last shown; soft: smoothed, as the light is), by default with the canvas's drawImage.
   * forget(key): a picture's let go (WebGL frees its texture).
   */
  constructor(look, { picture = null, forget = null } = {}) {
    this.look = look;
    this.picture = picture;
    this.forget = forget;
    this.pics = new Map();  // patch key -> { canvas, g, px, py, stale, used, res, lights }
    this.world = null;
    this.frame = 0;
    this.res = 0;
    this.lit = null;        // the light worked out last: { x0, y0, w, h, data, version, canvas }
    this.glows = [];        // what gives off light on screen: x, y (world), level, block (in fours)
  }

  /** Watch `world` for changes (the pictures of patches changed are drawn again). */
  attach(world) {
    if (this.world === world) return;
    this.detach();
    this.world = world;
    this.onEdit = (tx, ty) => {
      // (The patch, and its neighbour if it's on the edge: their outlines meet.)
      const px = Math.floor(tx / PATCH), py = Math.floor(ty / PATCH);
      const lx = tx - px * PATCH, ly = ty - py * PATCH;
      this.stale(px, py);
      if (lx === 0) this.stale(px - 1, py);
      if (lx === PATCH - 1) this.stale(px + 1, py);
      if (ly === 0) this.stale(px, py - 1);
      if (ly === PATCH - 1) this.stale(px, py + 1);
    };
    world.listeners.push(this.onEdit);
    this.onChunk = (cx, cy) => {
      const per = 32 / PATCH;
      for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) this.stale(cx * per + i, cy * per + j);
    };
    world.chunkListeners?.push(this.onChunk);
  }

  detach() {
    if (!this.world) return;
    const i = this.world.listeners.indexOf(this.onEdit);
    if (i >= 0) this.world.listeners.splice(i, 1);
    const j = this.world.chunkListeners?.indexOf(this.onChunk) ?? -1;
    if (j >= 0) this.world.chunkListeners.splice(j, 1);
    for (const k of this.pics.keys()) this.forget?.(k);
    if (this.lit) this.forget?.('light');
    this.pics.clear();
    this.world = null;
    this.lit = null;
  }

  stale(px, py) { const p = this.pics.get(pkey(px, py)); if (p) p.stale = true; }

  /** Picture pixels for each world pixel, at the renderer's scale s (changed only for a real change of zoom). */
  resFor(s) {
    if (!this.res || s > this.res * 1.25 || s < this.res / 1.6) this.res = Math.min(3, Math.max(1, Math.ceil(s * 2) / 2));
    return this.res;
  }

  /** The world's blocks on screen (r: the renderer, its view and transform worked out for this frame). */
  drawBlocks(r, game) {
    const world = game.world;
    this.attach(world);
    this.frame++;
    const v = r.view, res = this.resFor(r.s);
    const px0 = Math.floor(v.l / PP), px1 = Math.floor(v.r / PP);
    const py0 = Math.max(0, Math.floor(v.t / PP)), py1 = Math.min(PATCHES_Y - 1, Math.floor(v.b / PP));
    // (Nearest the middle first, when there are more to draw again than a frame's worth.)
    const order = this.order ||= [];
    order.length = 0;
    for (let py = py0; py <= py1; py++) for (let px = px0; px <= px1; px++) order.push(pkey(px, py));
    const mx = (v.l + v.r) / 2 / PP - 0.5, my = (v.t + v.b) / 2 / PP - 0.5;
    const far = k => { const dx = Math.floor(k / 64) - 1048576 - mx, dy = (k % 64) - my; return dx * dx + dy * dy; };
    order.sort((a, b) => far(a) - far(b));
    const ctx = r.ctx, direct = !this.picture;
    if (direct) ctx.setTransform(1, 0, 0, 1, 0, 0);
    const glows = this.glows;
    glows.length = 0;
    let painted = 0;
    const start = performance.now();
    for (let i = 0; i < order.length; i++) {
      const key = order[i];
      let p = this.pics.get(key), fresh = false;
      if (!p || p.stale || p.res !== res) {
        // (Over this frame's budget: what was there before, if anything, until it's drawn again;
        // where there's nothing yet, a while longer.)
        // (Zoomed far out, as dev mode can be, there's much more to draw: a bigger share of each frame for it.)
        const budget = (r.zoomScale ?? 1) < 0.5 ? PAINT_MS * 3 : PAINT_MS;
        const over = painted > 0 && performance.now() - start > (p ? budget : budget * 3);
        if (over && !p) continue;
        if (!over) {
          p = this.paint(world, Math.floor(key / 64) - 1048576, key % 64, res, p);
          this.pics.set(key, p);
          painted++;
          fresh = true;
        }
      }
      p.used = this.frame;
      this.show(r, p, key, fresh);
      for (let j = 0; j < p.lights.length; j++) glows.push(p.lights[j]);
    }
    if (direct) ctx.setTransform(r.s, 0, 0, r.s, r.tx, r.ty);
    // Let go of pictures not shown for a while, the oldest first, past the most kept.
    // (As many as fit in MAX_PIXELS, and never fewer than what's on screen, and a few round it.)
    const most = Math.max(order.length + 8, Math.floor(MAX_PIXELS / (PP * res) ** 2));
    if (this.pics.size > most) {
      const old = [];
      for (const [k, p] of this.pics) if (p.used < this.frame - 2) old.push([k, p.used]);
      old.sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < old.length && this.pics.size > most; i++) { this.forget?.(old[i][0]); this.pics.delete(old[i][0]); }
    }
  }

  /**
   * Magma on screen, alive (over its picture, every frame): a glow breathing over each block,
   * its cracks lit by a wave of heat flowing across the rock, and embers rising off it where
   * it's open to the air. (glows: the blocks giving off light on screen, from drawBlocks.)
   */
  drawMagma(ctx, game, classic) {
    const g = this.glows, world = game.world, t = performance.now() / 1000;
    let n = 0;
    for (let i = 0; i < g.length && n < 800; i += 4) {
      if (K.GEMS.has(g[i + 3])) {
        // A gem's glint: now and then, a little star on it.
        const gh = hash3(9, g[i], g[i + 1]), tw = Math.sin(t * (1.3 + (gh & 7) / 10) + (gh & 255));
        if (tw > 0.9) {
          const k = (tw - 0.9) * 10, sx = g[i] - 4 + (gh >>> 8) % 8, sy = g[i + 1] - 4 + (gh >>> 12) % 8;
          ctx.globalAlpha = k;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(sx - 2.5 * k, sy - 0.5, 5 * k, 1);
          ctx.fillRect(sx - 0.5, sy - 2.5 * k, 1, 5 * k);
        }
        continue;
      }
      if (g[i + 3] !== K.MAGMA) continue;
      n++;
      const x = g[i] - TILE / 2, y = g[i + 1] - TILE / 2, tx = x / TILE, ty = y / TILE, h = hash3(3, tx, ty);
      const r = k => (h >>> k) & 15;
      const breath = 0.5 + 0.5 * Math.sin(t * 1.7 + (h & 63) / 10);
      ctx.globalAlpha = classic ? 0.08 + 0.1 * breath : 0.14 + 0.2 * breath;
      ctx.fillStyle = '#ff5a12';
      ctx.fillRect(x, y, TILE, TILE);
      // (The same cracks as its picture's: worldrender.js's marks, 'veins'.)
      const wave = 0.5 + 0.5 * Math.sin(t * 3 - (x + y * 0.5) / 22);
      ctx.globalAlpha = 0.3 + 0.7 * wave;
      ctx.strokeStyle = wave > 0.8 ? '#fff4b0' : '#ffc040';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y + 3 + (r(0) % 8)); ctx.lineTo(x + 8, y + 6 + (r(4) % 6)); ctx.lineTo(x + TILE, y + 2 + (r(8) % 10));
      ctx.stroke();
      if (world.tile(tx, ty - 1) !== AIR) continue;
      for (let e = 0; e < 2; e++) {
        const life = (t * 0.55 + ((h >>> (12 + e * 5)) & 31) / 31) % 1;
        ctx.globalAlpha = (1 - life) * 0.9;
        ctx.fillStyle = life < 0.35 ? '#ffe680' : '#ff7a30';
        ctx.fillRect(x + 3 + ((h >>> (e * 7)) % 10) + Math.sin(t * 2.3 + e * 2 + tx) * 2, y - life * 26, 1.6, 1.6);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Picture p on the screen, its edges on whole pixels (so pictures side by side meet exactly). */
  show(r, p, key, fresh) {
    const s = r.s, x0 = Math.round(p.px * PP * s + r.tx), y0 = Math.round(p.py * PP * s + r.ty);
    const x1 = Math.round((p.px + 1) * PP * s + r.tx), y1 = Math.round((p.py + 1) * PP * s + r.ty);
    if (this.picture) this.picture(p.canvas, x0, y0, x1 - x0, y1 - y0, key, fresh, false);
    else r.ctx.drawImage(p.canvas, x0, y0, x1 - x0, y1 - y0);
  }

  /** Draw patch (px, py) into its picture (made, or the one it had used again). */
  paint(world, px, py, res, p) {
    if (!p) {
      const canvas = document.createElement('canvas');
      p = { canvas, g: canvas.getContext('2d'), px, py, res: 0, stale: false, used: 0, lights: [] };
    }
    const size = Math.round(PP * res);
    if (p.canvas.width !== size) { p.canvas.width = size; p.canvas.height = size; }
    else { p.g.setTransform(1, 0, 0, 1, 0, 0); p.g.clearRect(0, 0, size, size); }
    p.px = px; p.py = py; p.res = res; p.stale = false;
    p.g.setTransform(res, 0, 0, res, -px * PP * res, -py * PP * res);
    paintPatch(p.g, world, px, py, this.look, p.lights);
    return p;
  }

  /**
   * The dark: underground, and in rooms walled in, the only light is from torches and what
   * glows (and a little round each soldier). Worked out for the tiles on screen (and round
   * them) when they change or the view's moved on, the soldiers' glow as they move, and drawn
   * as a soft shadow over everything (dark: how dark it gets, 0 to 1).
   */
  drawLight(r, game, dark = 0.9) {
    const world = game.world, v = r.view, m = 16;
    const x0 = Math.floor(v.l / TILE) - m, y0 = Math.max(0, Math.floor(v.t / TILE) - m);
    const w = Math.ceil((v.r - v.l) / TILE) + 2 * m, h = Math.min(WORLD_H - y0, Math.ceil((v.b - v.t) / TILE) + 2 * m);
    let lit = this.lit, all = false;
    const sky = skyLevel(world.time || 0);
    const moved = !lit || x0 < lit.x0 || y0 < lit.y0 || x0 + w > lit.x0 + lit.w || y0 + h > lit.y0 + lit.h;
    if (moved || lit.version !== world.version || lit.dark !== dark || lit.sky !== sky) {
      const X0 = x0 - 6, Y0 = Math.max(0, y0 - 6), W = w + 12, H = Math.min(WORLD_H - Y0, h + 12);
      const base = lightBox(world, X0, Y0, W, H, lit?.base, sky, lit?.solid);
      const c = lit?.canvas || document.createElement('canvas');
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const g = c.getContext('2d');
      lit = this.lit = {
        x0: X0, y0: Y0, w: W, h: H, base, solid: lightBox.solid, data: lit?.data?.length >= W * H ? lit.data : new Uint8Array(W * H),
        version: world.version, dark, sky, canvas: c, g, img: lit?.img?.width === W && lit.img.height === H ? lit.img : g.createImageData(W, H),
        glowKey: null, glow: null, fresh: true,
      };
      all = true;
    }
    // The soldiers' glow, where they are now.
    const src = this.glowSrc ||= [];
    src.length = 0;
    for (const s of game.soldiers) {
      if (!s.alive || s.spectating || s.npc?.kind === 'monster') continue;
      const tx = Math.floor(s.x / TILE) - lit.x0, ty = Math.floor((s.y - 8) / TILE) - lit.y0;
      if (tx >= 0 && ty >= 0 && tx < lit.w && ty < lit.h) src.push(tx, ty);
    }
    const key = src.join();
    if (all || key !== lit.glowKey) {
      // The part to work out again: where the glow was, and where it is now.
      const R = SOLDIER_GLOW;
      let l = Infinity, t = Infinity, rr = -Infinity, b = -Infinity;
      const add = list => { for (let i = 0; i < list.length; i += 2) { l = Math.min(l, list[i] - R); rr = Math.max(rr, list[i] + R + 1); t = Math.min(t, list[i + 1] - R); b = Math.max(b, list[i + 1] + R + 1); } };
      if (all) { l = 0; t = 0; rr = lit.w; b = lit.h; } else { add(lit.glow || []); add(src); }
      l = Math.max(0, l); t = Math.max(0, t); rr = Math.min(lit.w, rr); b = Math.min(lit.h, b);
      if (rr > l && b > t) {
        const { base, data, solid } = lit, W = lit.w;
        for (let j = t; j < b; j++) data.set(base.subarray(j * W + l, j * W + rr), j * W + l);
        for (let i = 0; i < src.length; i += 2) { const k = src[i + 1] * W + src[i]; data[k] = Math.max(data[k], SOLDIER_GLOW); }
        if (src.length) spread(data, solid, W, l, t, rr, b);
        const px = lit.img.data, dk = this.look === 'classic' ? DARK_CLASSIC : DARK_RM;
        for (let j = t; j < b; j++) {
          for (let i = l; i < rr; i++) {
            const k = j * W + i, a = 1 - data[k] / 15, o = k * 4;
            px[o] = dk[0]; px[o + 1] = dk[1]; px[o + 2] = dk[2];
            px[o + 3] = Math.round(255 * dark * a * a * (3 - 2 * a));
          }
        }
        lit.g.putImageData(lit.img, 0, 0, l, t, rr - l, b - t);
        lit.fresh = true;
      }
      lit.glowKey = key;
      lit.glow = src.slice();
    }
    const s = r.s, sx = lit.x0 * TILE * s + r.tx, sy = lit.y0 * TILE * s + r.ty, sw = lit.w * TILE * s, sh = lit.h * TILE * s;
    if (this.picture) this.picture(lit.canvas, sx, sy, sw, sh, 'light', lit.fresh, true);
    else {
      const ctx = r.ctx, smooth = ctx.imageSmoothingEnabled;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(lit.canvas, sx, sy, sw, sh);
      ctx.imageSmoothingEnabled = smooth;
      ctx.setTransform(s, 0, 0, s, r.tx, r.ty);
    }
    lit.fresh = false;
  }

  /** How lit tile (tx, ty) is (0 to 15), as last worked out (15 where it hasn't been). */
  lightAt(tx, ty) {
    const l = this.lit;
    if (!l || tx < l.x0 || ty < l.y0 || tx >= l.x0 + l.w || ty >= l.y0 + l.h) return 15;
    return l.data[(ty - l.y0) * l.w + (tx - l.x0)];
  }
}

// ---- What's drawn over the world each frame ------------------------------------------------------

/** Things lying on the ground (bobbing; precious things glow, pulsing, in their colour: iteminfo.js). */
export function drawDrops(ctx, game, look, alpha = 1, view = null) {
  const drops = game.world?.drops;
  if (!drops?.length) return;
  const classic = look === 'classic', t = game.tick;
  for (const d of drops) {
    const it = itemOf(d.key);
    if (!it || (view && (d.x < view.l || d.x > view.r || d.y < view.t || d.y > view.b))) continue;
    const x = d.px + (d.x - d.px) * alpha, y = d.py + (d.y - d.py) * alpha - 5 + (d.rest ? Math.sin((t + d.x) * 0.08) * 1.2 : 0);
    const rar = d.g?.r || d.r || null;
    if (isPrecious(it, rar)) {
      const pulse = 0.5 + 0.5 * Math.sin((t + d.x) * 0.12);
      ctx.globalAlpha = 0.25 + 0.35 * pulse;
      ctx.fillStyle = itemColor(it, rar);
      ctx.beginPath(); ctx.arc(x, y, 7 + pulse * 2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    drawIcon(ctx, it, x - 5, y - 5, 10, classic);
  }
}

// A block on its own, for its picture as an item: three tiles across, open round the middle.
const ICON = { w: 3, fg: new Uint8Array(9), bg: new Uint8Array(9), sh: new Uint8Array(9) };
const ICON_EDGES = [];

/** A block's or a wall's picture as an item (as it looks in the world), w square at (x, y). */
export function drawTileIcon(ctx, it, x, y, w, classic) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(w / TILE, w / TILE);
  if (it.kind === 'wall') {
    drawWall(ctx, 0, 0, it.wall, classic, 0, 1);
    ctx.strokeStyle = classic ? '#9a9a9a' : 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, TILE - 1, TILE - 1);
  } else {
    const id = it.block, edges = ICON_EDGES;
    ICON.fg.fill(AIR); ICON.bg.fill(NO_WALL); ICON.sh.fill(0);
    ICON.fg[4] = id;
    edges.length = 0;
    if (SOLID[id]) drawBlock(ctx, ICON, 4, 0, 0, id, classic, 2, 3, edges);
    else drawThing(ctx, ICON, 4, 0, 0, id, classic, 2, 3);
    if (edges.length) {
      ctx.strokeStyle = classic ? INK : 'rgba(10,8,12,0.75)';
      ctx.lineWidth = classic ? 1.3 : 1;
      ctx.beginPath();
      for (let e = 0; e < edges.length; e += 4) { ctx.moveTo(edges[e], edges[e + 1]); ctx.lineTo(edges[e + 2], edges[e + 3]); }
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** An item's picture, w square at (x, y) (detail: blocks and walls as they look in the world; else plain, for little ones). */
export function drawIcon(ctx, it, x, y, w, classic, detail = false) {
  const c = it.color || '#888';
  if (detail && (it.kind === 'block' || it.kind === 'wall')) { drawTileIcon(ctx, it, x, y, w, classic); return; }
  ctx.lineWidth = Math.max(0.6, w / 12);
  if (it.kind === 'block' || it.kind === 'wall') {
    ctx.fillStyle = classic && !it.color?.startsWith('#d0') ? '#fff' : c;
    if (it.kind === 'wall') { ctx.fillStyle = classic ? '#e4e4e4' : c; }
    ctx.fillRect(x, y, w, w);
    if (classic && it.pattern === 'ore') { ctx.fillStyle = c; ctx.fillRect(x + w * 0.3, y + w * 0.3, w * 0.4, w * 0.4); }
    else if (!classic) { ctx.fillStyle = it.dark || tint(c, 0.7); ctx.fillRect(x, y + w * 0.75, w, w * 0.25); }
    ctx.strokeStyle = INK;
    ctx.strokeRect(x, y, w, w);
    return;
  }
  if (it.kind === 'tool') {
    ctx.strokeStyle = it.handle || '#7a5634';
    ctx.beginPath(); ctx.moveTo(x + w * 0.2, y + w * 0.9); ctx.lineTo(x + w * 0.75, y + w * 0.25); ctx.stroke();
    ctx.fillStyle = it.color;
    if (it.tool === 'pick') { ctx.beginPath(); ctx.moveTo(x + w * 0.35, y + w * 0.05); ctx.quadraticCurveTo(x + w * 0.95, y + w * 0.05, x + w * 0.95, y + w * 0.65); ctx.lineTo(x + w * 0.75, y + w * 0.25); ctx.closePath(); ctx.fill(); ctx.strokeStyle = INK; ctx.stroke(); }
    else if (it.tool === 'axe') { ctx.beginPath(); ctx.moveTo(x + w * 0.55, y + w * 0.1); ctx.lineTo(x + w, y + w * 0.3); ctx.lineTo(x + w * 0.8, y + w * 0.55); ctx.closePath(); ctx.fill(); ctx.strokeStyle = INK; ctx.stroke(); }
    else { ctx.fillRect(x + w * 0.5, y, w * 0.45, w * 0.35); ctx.strokeStyle = INK; ctx.strokeRect(x + w * 0.5, y, w * 0.45, w * 0.35); }
    return;
  }
  if (it.key.endsWith('_bar')) {
    // An ingot.
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.08, y + w * 0.78); ctx.lineTo(x + w * 0.92, y + w * 0.78); ctx.lineTo(x + w * 0.74, y + w * 0.38); ctx.lineTo(x + w * 0.26, y + w * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.stroke();
    return;
  }
  if (it.key === 'coins') {
    // A little pile of gold coins.
    for (const [cx, cy] of [[0.38, 0.62], [0.62, 0.62], [0.5, 0.4]]) {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x + w * cx, y + w * cy, w * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#8a6a10';
      ctx.stroke();
    }
    return;
  }
  if (it.kind === 'contract') {
    // A rolled paper, sealed.
    ctx.fillStyle = c;
    ctx.fillRect(x + w * 0.2, y + w * 0.15, w * 0.6, w * 0.7);
    ctx.strokeStyle = INK;
    ctx.strokeRect(x + w * 0.2, y + w * 0.15, w * 0.6, w * 0.7);
    ctx.beginPath();
    for (let i = 0; i < 3; i++) { ctx.moveTo(x + w * 0.3, y + w * (0.3 + i * 0.13)); ctx.lineTo(x + w * 0.7, y + w * (0.3 + i * 0.13)); }
    ctx.stroke();
    ctx.fillStyle = '#c8282e';
    ctx.beginPath(); ctx.arc(x + w * 0.62, y + w * 0.74, w * 0.1, 0, Math.PI * 2); ctx.fill();
    return;
  }
  if (it.key === 'coal') {
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.2, y + w * 0.6); ctx.lineTo(x + w * 0.35, y + w * 0.25); ctx.lineTo(x + w * 0.7, y + w * 0.2); ctx.lineTo(x + w * 0.85, y + w * 0.55); ctx.lineTo(x + w * 0.6, y + w * 0.85); ctx.lineTo(x + w * 0.3, y + w * 0.82);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#555';
    ctx.stroke();
    return;
  }
  if (it.gem) {
    // A cut gem: a crown and a point, with a glint.
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.12, y + w * 0.4); ctx.lineTo(x + w * 0.3, y + w * 0.18); ctx.lineTo(x + w * 0.7, y + w * 0.18); ctx.lineTo(x + w * 0.88, y + w * 0.4); ctx.lineTo(x + w * 0.5, y + w * 0.88);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w * 0.12, y + w * 0.4); ctx.lineTo(x + w * 0.88, y + w * 0.4); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(x + w * 0.34, y + w * 0.24, w * 0.12, w * 0.1);
    return;
  }
  if (it.kind === 'food') { drawFoodIcon(ctx, it, x, y, w); return; }
  if (it.kind === 'gear') { drawGearIcon(ctx, it, x, y, w); return; }
  if (it.kind === 'quest') {
    // A bundle tied with string (a letter: a folded sheet with a seal).
    ctx.fillStyle = c;
    if (it.key === 'letter' || it.key === 'map_scrap' || it.key === 'journal' || it.key === 'reply') {
      ctx.fillRect(x + w * 0.12, y + w * 0.25, w * 0.76, w * 0.52);
      ctx.strokeStyle = INK; ctx.strokeRect(x + w * 0.12, y + w * 0.25, w * 0.76, w * 0.52);
      ctx.beginPath(); ctx.moveTo(x + w * 0.12, y + w * 0.25); ctx.lineTo(x + w * 0.5, y + w * 0.55); ctx.lineTo(x + w * 0.88, y + w * 0.25); ctx.stroke();
      ctx.fillStyle = '#c8282e'; ctx.beginPath(); ctx.arc(x + w * 0.5, y + w * 0.55, w * 0.09, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(x + w * 0.5, y + w * 0.58, w * 0.32, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = INK; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + w * 0.36, y + w * 0.3); ctx.lineTo(x + w * 0.5, y + w * 0.18); ctx.lineTo(x + w * 0.64, y + w * 0.3); ctx.stroke();
    }
    return;
  }
  if (it.kind === 'ammo' || it.kind === 'material') {
    ctx.fillStyle = c;
    for (let i = 0; i < 3; i++) ctx.fillRect(x + w * (0.12 + i * 0.3), y + w * 0.25, w * 0.2, w * 0.6);
    ctx.strokeStyle = INK;
    for (let i = 0; i < 3; i++) ctx.strokeRect(x + w * (0.12 + i * 0.3), y + w * 0.25, w * 0.2, w * 0.6);
    return;
  }
  // A weapon: a dark shape, the length of the slot.
  ctx.fillStyle = '#444';
  ctx.fillRect(x + w * 0.05, y + w * 0.4, w * 0.9, w * 0.22);
  ctx.fillRect(x + w * 0.2, y + w * 0.55, w * 0.15, w * 0.3);
}

/** Gear's icons (gear.js): a helmet, a coat, boots, a ring, an amulet, in its base's colour. */
function drawGearIcon(ctx, it, x, y, w) {
  const c = it.color;
  ctx.fillStyle = c;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  switch (it.wear) {
    case 'head':
      if (it.key === 'circlet') { ctx.moveTo(x + w * 0.1, y + w * 0.7); ctx.lineTo(x + w * 0.1, y + w * 0.35); ctx.lineTo(x + w * 0.3, y + w * 0.55); ctx.lineTo(x + w * 0.5, y + w * 0.25); ctx.lineTo(x + w * 0.7, y + w * 0.55); ctx.lineTo(x + w * 0.9, y + w * 0.35); ctx.lineTo(x + w * 0.9, y + w * 0.7); }
      else { ctx.arc(x + w * 0.5, y + w * 0.6, w * 0.38, Math.PI, 0); ctx.lineTo(x + w * 0.95, y + w * 0.75); ctx.lineTo(x + w * 0.05, y + w * 0.75); }
      break;
    case 'body':
      ctx.moveTo(x + w * 0.3, y + w * 0.1); ctx.lineTo(x + w * 0.05, y + w * 0.3); ctx.lineTo(x + w * 0.18, y + w * 0.45); ctx.lineTo(x + w * 0.25, y + w * 0.4); ctx.lineTo(x + w * 0.25, y + w * 0.92);
      ctx.lineTo(x + w * 0.75, y + w * 0.92); ctx.lineTo(x + w * 0.75, y + w * 0.4); ctx.lineTo(x + w * 0.82, y + w * 0.45); ctx.lineTo(x + w * 0.95, y + w * 0.3); ctx.lineTo(x + w * 0.7, y + w * 0.1); ctx.lineTo(x + w * 0.5, y + w * 0.22);
      break;
    case 'feet':
      ctx.moveTo(x + w * 0.25, y + w * 0.1); ctx.lineTo(x + w * 0.55, y + w * 0.1); ctx.lineTo(x + w * 0.55, y + w * 0.6); ctx.lineTo(x + w * 0.92, y + w * 0.72); ctx.lineTo(x + w * 0.92, y + w * 0.9); ctx.lineTo(x + w * 0.25, y + w * 0.9);
      break;
    case 'ring':
      ctx.arc(x + w * 0.5, y + w * 0.6, w * 0.3, 0, Math.PI * 2);
      ctx.moveTo(x + w * 0.66, y + w * 0.6); ctx.arc(x + w * 0.5, y + w * 0.6, w * 0.16, 0, Math.PI * 2, true);
      ctx.fill('evenodd'); ctx.stroke();
      ctx.fillStyle = '#d8342c'; ctx.beginPath(); ctx.arc(x + w * 0.5, y + w * 0.26, w * 0.1, 0, Math.PI * 2); ctx.fill();
      return;
    default:
      ctx.moveTo(x + w * 0.2, y + w * 0.1); ctx.quadraticCurveTo(x + w * 0.5, y + w * 0.55, x + w * 0.8, y + w * 0.1); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + w * 0.5, y + w * 0.66, w * 0.22, 0, Math.PI * 2);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/** Food and potions' icons (items.js: their look). */
function drawFoodIcon(ctx, it, x, y, w) {
  const c = it.color;
  ctx.strokeStyle = INK;
  switch (it.look) {
    case 'apple':
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x + w * 0.5, y + w * 0.58, w * 0.32, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + w * 0.5, y + w * 0.3); ctx.lineTo(x + w * 0.56, y + w * 0.12); ctx.stroke();
      ctx.fillStyle = '#4f8a34';
      ctx.beginPath(); ctx.ellipse(x + w * 0.66, y + w * 0.2, w * 0.12, w * 0.06, -0.5, 0, Math.PI * 2); ctx.fill();
      break;
    case 'bread':
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.ellipse(x + w * 0.5, y + w * 0.6, w * 0.42, w * 0.25, 0, Math.PI, 0); ctx.lineTo(x + w * 0.92, y + w * 0.72); ctx.lineTo(x + w * 0.08, y + w * 0.72); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      for (const dx of [0.32, 0.5, 0.68]) { ctx.moveTo(x + w * (dx - 0.06), y + w * 0.48); ctx.lineTo(x + w * (dx + 0.06), y + w * 0.4); }
      ctx.stroke();
      break;
    case 'stew':
      ctx.fillStyle = c;
      ctx.fillRect(x + w * 0.14, y + w * 0.42, w * 0.72, w * 0.08);
      ctx.fillStyle = '#7a7f86';
      ctx.beginPath(); ctx.moveTo(x + w * 0.1, y + w * 0.46); ctx.quadraticCurveTo(x + w * 0.5, y + w * 1.02, x + w * 0.9, y + w * 0.46); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(200,200,200,0.7)';
      ctx.beginPath(); ctx.moveTo(x + w * 0.4, y + w * 0.36); ctx.quadraticCurveTo(x + w * 0.32, y + w * 0.24, x + w * 0.42, y + w * 0.12); ctx.moveTo(x + w * 0.6, y + w * 0.36); ctx.quadraticCurveTo(x + w * 0.52, y + w * 0.24, x + w * 0.62, y + w * 0.12); ctx.stroke();
      break;
    default: {
      // A potion: a round flask, a neck and a cork.
      ctx.fillStyle = 'rgba(220,235,245,0.9)';
      ctx.fillRect(x + w * 0.4, y + w * 0.14, w * 0.2, w * 0.3);
      ctx.strokeRect(x + w * 0.4, y + w * 0.14, w * 0.2, w * 0.3);
      ctx.fillStyle = '#9a6a3a';
      ctx.fillRect(x + w * 0.38, y + w * 0.06, w * 0.24, w * 0.1);
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x + w * 0.5, y + w * 0.64, w * 0.28, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(x + w * 0.36, y + w * 0.54, w * 0.08, w * 0.1);
    }
  }
}

/**
 * The crosshair's block, for the player (`me`): how far a block being dug has got (cracks),
 * what would be built there, or the whole shape a drag would build.
 */
export function drawTarget(ctx, game, me, look) {
  const w = me?.world;
  if (!w?.target || !me.alive) return;
  const t = w.target, classic = look === 'classic';
  // (What a click would build: the left hand's blocks, else the right's.)
  const isBlocks = it => it && (it.kind === 'block' || it.kind === 'wall');
  const left = inHand(me).item, item = isBlocks(left) ? left : isBlocks(rightHand(me).item) ? rightHand(me).item : left;
  const x = t.tx * TILE, y = t.ty * TILE;
  // Digging: the cracks so far.
  if (w.mine && w.mine.tx === t.tx && w.mine.ty === t.ty) {
    const f = Math.min(1, w.mine.dmg / Math.max(0.5, w.mine.of || 1));
    ctx.strokeStyle = classic ? INK : 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const n = 1 + Math.floor(f * 4);
    for (let i = 0; i < n; i++) {
      const a = i * 1.9 + 0.4;
      ctx.moveTo(x + 8, y + 8);
      ctx.lineTo(x + 8 + Math.cos(a) * 7 * f + 1, y + 8 + Math.sin(a) * 7 * f);
    }
    ctx.stroke();
  }
  const building = item && (item.kind === 'block' || item.kind === 'wall');
  if (building) {
    const cells = w.drag ? shapeTiles(w.brush, w.drag, t) : [t];
    ctx.globalAlpha = 0.45;
    for (const c of cells) {
      const ok = canPlace(game, item, c.tx, c.ty);
      ctx.fillStyle = ok ? (classic ? '#9ad' : item.color || '#8ac') : 'rgba(220,60,60,0.6)';
      if (!ok && w.drag) continue;
      ctx.fillRect(c.tx * TILE, c.ty * TILE, TILE, TILE);
    }
    ctx.globalAlpha = 1;
    if (w.drag) {
      ctx.fillStyle = classic ? INK : '#fff';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(`${cells.filter(c => canPlace(game, item, c.tx, c.ty)).length}`, x + TILE + 2, y - 2);
    }
  }
  // The block's outline: solid in reach, dashed out of it.
  ctx.strokeStyle = classic ? INK : 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1;
  if (!t.near) ctx.setLineDash?.([2, 2]);
  ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
  if (!t.near) ctx.setLineDash?.([]);
}

export { REACH };
