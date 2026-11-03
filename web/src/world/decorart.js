// How building and decorating's things look (world mode; worldrender.js draws the world with them):
// the new blocks' marks (concrete, terracotta, polished and chiseled stone, blocks of metal, glass
// panes, windows, gates, iron bars, hay), the things walked past (open windows and trapdoors,
// scaffolding, columns, chains, candles and lamps, flower pots, paintings, shelves, cabinets and the
// new stations), and the new items' icons (materials, dyes, blueprints, food). In the original's
// ink on paper, and in Remastered's colours, as the rest of the world is.

import * as K from './blocks.js';
import { BLOCKS, SOLID, PLATFORMS, TILE, shade } from './blocks.js';
import { SINKS, surfaceOf } from './decor.js';

const INK = '#111';
const tint = (hex, k) => shade(hex, k);

/** Blocks seen through (nothing filled in behind their marks): gates and iron bars. And glass, half seen through. */
export const SEE_THROUGH = new Set(['gate', 'bars']);
export const HALF_SEEN = new Set(['pane', 'window']);

// ---- Blocks ----------------------------------------------------------------------------------------------

/** A new block's marks (its pattern), if it's one of these: returns whether it was. */
export function decorMarks(g, b, x, y, h, classic) {
  const ink = classic ? '#9a9a9a' : b.dark;
  switch (b.pattern) {
    case 'concrete':
      // Smooth: a few faint flecks.
      g.fillStyle = classic ? '#d6d6d6' : tint(b.color, 0.86);
      for (let i = 0; i < 4; i++) g.fillRect(x + 2 + ((h >>> (i * 4)) % 12), y + 2 + ((h >>> (i * 4 + 2)) % 12), 1, 1);
      return true;
    case 'terracotta':
      // Fired clay: soft bands across it.
      g.fillStyle = classic ? '#e2e2e2' : tint(b.color, 0.88);
      g.fillRect(x, y + 4 + (h & 1), TILE, 1.5); g.fillRect(x, y + 11 - (h & 1), TILE, 1);
      return true;
    case 'polished':
      // Bevelled: lit along its top and left, shaded along its bottom and right.
      g.strokeStyle = classic ? '#c4c4c4' : tint(b.color, 1.18); g.lineWidth = 1;
      g.beginPath(); g.moveTo(x + 2.5, y + 13.5); g.lineTo(x + 2.5, y + 2.5); g.lineTo(x + 13.5, y + 2.5); g.stroke();
      g.strokeStyle = ink;
      g.beginPath(); g.moveTo(x + 13.5, y + 2.5); g.lineTo(x + 13.5, y + 13.5); g.lineTo(x + 2.5, y + 13.5); g.stroke();
      return true;
    case 'chiseled':
      // Carved: a frame, and a ring with a diamond in it.
      g.strokeStyle = ink; g.lineWidth = 1;
      g.strokeRect(x + 1.5, y + 1.5, 13, 13);
      g.beginPath(); g.arc(x + 8, y + 8, 4, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(x + 8, y + 5.5); g.lineTo(x + 10.5, y + 8); g.lineTo(x + 8, y + 10.5); g.lineTo(x + 5.5, y + 8); g.closePath(); g.stroke();
      return true;
    case 'metalblock':
      // Plates riveted in a frame, a shine across them.
      g.strokeStyle = classic ? '#9a9a9a' : tint(b.color, 0.68); g.lineWidth = 1;
      g.strokeRect(x + 1.5, y + 1.5, 13, 13);
      g.beginPath(); g.moveTo(x + 1.5, y + 8); g.lineTo(x + 14.5, y + 8); g.stroke();
      g.fillStyle = classic ? INK : tint(b.color, 0.55);
      for (const [rx, ry] of [[3, 3], [11.5, 3], [3, 11.5], [11.5, 11.5]]) g.fillRect(x + rx, y + ry, 1.5, 1.5);
      if (!classic) { g.fillStyle = 'rgba(255,255,255,0.32)'; g.beginPath(); g.moveTo(x + 4, y + 7); g.lineTo(x + 7, y + 3); g.lineTo(x + 9, y + 3); g.lineTo(x + 6, y + 7); g.closePath(); g.fill(); }
      return true;
    case 'pane':
      // A pane in a thin frame, a glint on it.
      g.strokeStyle = classic ? INK : tint(b.color, 0.55); g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      g.strokeStyle = classic ? '#b0c0c8' : 'rgba(255,255,255,0.7)'; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(x + 3, y + 8); g.lineTo(x + 8, y + 3); g.moveTo(x + 5, y + 12); g.lineTo(x + 12, y + 5); g.stroke();
      return true;
    case 'window':
      // A wooden frame, four panes, glints.
      g.fillStyle = classic ? INK : '#7a5232';
      g.fillRect(x, y, TILE, 2); g.fillRect(x, y + 14, TILE, 2); g.fillRect(x, y, 2, TILE); g.fillRect(x + 14, y, 2, TILE);
      g.fillRect(x + 7.25, y, 1.5, TILE); g.fillRect(x, y + 7.25, TILE, 1.5);
      g.strokeStyle = classic ? '#b0c0c8' : 'rgba(255,255,255,0.65)'; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(x + 3, y + 6); g.lineTo(x + 6, y + 3); g.moveTo(x + 10, y + 13); g.lineTo(x + 13, y + 10); g.stroke();
      return true;
    case 'trapdoor':
      // A hatch of planks (the top half of its tile), its hinge and handle.
      g.fillStyle = classic ? '#9a9a9a' : tint(b.color, 0.7);
      g.fillRect(x + 5, y, 1, 8); g.fillRect(x + 10.5, y, 1, 8);
      g.fillStyle = classic ? INK : '#3a3430';
      g.fillRect(x + 1, y + 2, 3, 1.5); g.fillRect(x + 12, y + 3, 2, 2);
      return true;
    case 'gate':
      // A fence gate, shut: posts, rails and a brace across.
      g.fillStyle = classic ? '#fff' : b.color;
      g.fillRect(x, y + 1, 3, TILE - 1); g.fillRect(x + 13, y + 1, 3, TILE - 1);
      g.fillRect(x + 3, y + 4, 10, 2); g.fillRect(x + 3, y + 11, 10, 2);
      g.strokeStyle = classic ? INK : tint(b.color, 0.55); g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 1.5, 2, TILE - 2); g.strokeRect(x + 13.5, y + 1.5, 2, TILE - 2);
      g.strokeRect(x + 3, y + 4.5, 10, 1); g.strokeRect(x + 3, y + 11.5, 10, 1);
      g.beginPath(); g.moveTo(x + 3, y + 11); g.lineTo(x + 13, y + 6); g.stroke();
      return true;
    case 'bars':
      // Iron bars: uprights and a cross-bar.
      g.fillStyle = classic ? INK : b.color;
      for (const bx of [1.5, 5.5, 9.5, 13.5]) g.fillRect(x + bx, y, 1.6, TILE);
      g.fillRect(x, y + 7, TILE, 1.6);
      if (!classic) { g.fillStyle = 'rgba(255,255,255,0.3)'; for (const bx of [1.5, 5.5, 9.5, 13.5]) g.fillRect(x + bx, y, 0.6, TILE); }
      return true;
    case 'hay':
      // Straw lengthways, bound with two bands.
      g.strokeStyle = ink; g.lineWidth = 0.7;
      g.beginPath(); for (let i = 2; i < TILE; i += 3) { g.moveTo(x, y + i + ((h >>> i) & 1) * 0.5); g.lineTo(x + TILE, y + i); } g.stroke();
      g.fillStyle = classic ? INK : '#8a5a2a';
      g.fillRect(x + 3, y, 1.5, TILE); g.fillRect(x + 11.5, y, 1.5, TILE);
      return true;
    default: return false;
  }
}

// ---- Things (walked past) -------------------------------------------------------------------------------

// The pictures a painting can be (by its variant: blocks.js).
function picture(g, v, x, y, w, h, classic) {
  const sky = classic ? '#fff' : ['#9ad0f0', '#9ad0f0', '#5a8ac8', '#f0a060', '#1e2a5a', '#c8b48a', '#a8c8e8', '#e8d8c0', '#9ac0e0'][v] || '#ccc';
  g.fillStyle = sky; g.fillRect(x, y, w, h);
  const ink = classic ? INK : null, fill = c => { g.fillStyle = ink || c; };
  switch (v) {
    case 1: fill('#5f9a3a'); g.beginPath(); g.moveTo(x, y + h); g.quadraticCurveTo(x + w * 0.3, y + h * 0.3, x + w * 0.6, y + h * 0.7); g.quadraticCurveTo(x + w * 0.8, y + h * 0.5, x + w, y + h * 0.6); g.lineTo(x + w, y + h); g.closePath(); g.fill(); break;
    case 2: fill('#2a5a9a'); g.fillRect(x, y + h * 0.55, w, h * 0.45); fill('#f4f4f4'); g.fillRect(x + w * 0.2, y + h * 0.5, w * 0.25, 0.8); break;
    case 3: fill('#f8e070'); g.beginPath(); g.arc(x + w * 0.5, y + h * 0.7, h * 0.28, Math.PI, 0); g.fill(); fill('#7a3a2a'); g.fillRect(x, y + h * 0.7, w, h * 0.3); break;
    case 4: fill('#f8f0a0'); for (const [sx, sy] of [[0.2, 0.25], [0.6, 0.2], [0.8, 0.55], [0.35, 0.6]]) g.fillRect(x + w * sx, y + h * sy, 1, 1); g.beginPath(); g.arc(x + w * 0.75, y + h * 0.3, 1.4, 0, Math.PI * 2); g.fill(); break;
    case 5: fill('#3a2a1e'); g.beginPath(); g.arc(x + w * 0.5, y + h * 0.42, h * 0.2, 0, Math.PI * 2); g.fill(); g.fillRect(x + w * 0.25, y + h * 0.65, w * 0.5, h * 0.35); break;
    case 6: fill('#6a7a8a'); g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + w * 0.35, y + h * 0.25); g.lineTo(x + w * 0.6, y + h * 0.6); g.lineTo(x + w * 0.8, y + h * 0.35); g.lineTo(x + w, y + h); g.closePath(); g.fill(); break;
    case 7: for (const [fx, c] of [[0.25, '#e04a6a'], [0.5, '#f2c230'], [0.75, '#8a6ae0']]) { fill(c); g.beginPath(); g.arc(x + w * fx, y + h * 0.45, 1.5, 0, Math.PI * 2); g.fill(); } fill('#3f7a3a'); g.fillRect(x, y + h * 0.75, w, h * 0.25); break;
    case 8: fill('#2a5a9a'); g.fillRect(x, y + h * 0.7, w, h * 0.3); fill('#7a5634'); g.fillRect(x + w * 0.25, y + h * 0.58, w * 0.5, h * 0.14); fill('#f4f0e2'); g.beginPath(); g.moveTo(x + w * 0.5, y + h * 0.15); g.lineTo(x + w * 0.5, y + h * 0.55); g.lineTo(x + w * 0.75, y + h * 0.55); g.closePath(); g.fill(); break;
    default: break;
  }
}

// What grows in a pot (its variant: blocks.js).
function potPlant(g, v, x, y, classic) {
  if (!v) return;
  const name = BLOCKS[K.FLOWER_POT].variants[v].key, c = BLOCKS[K.FLOWER_POT].variants[v].color;
  g.strokeStyle = classic ? INK : '#4f8a34'; g.lineWidth = 1;
  if (name === 'cactus') {
    g.fillStyle = classic ? '#fff' : c; g.fillRect(x + 6.5, y + 3, 3, 7); g.fillRect(x + 4, y + 5, 2, 3); g.fillRect(x + 10, y + 4, 2, 3);
    g.strokeStyle = classic ? INK : tint(c, 0.6); g.strokeRect(x + 6.5, y + 3, 3, 7);
    return;
  }
  if (name === 'fern' || name === 'bush') {
    g.fillStyle = classic ? '#fff' : c;
    g.beginPath(); g.ellipse(x + 8, y + 6, name === 'bush' ? 4.5 : 3.5, 4, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = classic ? INK : tint(c, 0.6); g.stroke();
    return;
  }
  if (name === 'mushroom' || name === 'glowcap') {
    g.fillStyle = classic ? '#fff' : '#e8e0d0'; g.fillRect(x + 7, y + 6, 2, 4);
    g.fillStyle = classic ? '#ddd' : c; g.beginPath(); g.arc(x + 8, y + 6.5, 3.5, Math.PI, 0); g.fill();
    if (classic) { g.strokeStyle = INK; g.stroke(); }
    return;
  }
  // A flower: a stalk, its head.
  g.beginPath(); g.moveTo(x + 8, y + 10); g.lineTo(x + 8, y + 5); g.stroke();
  g.fillStyle = classic ? '#fff' : c; g.beginPath(); g.arc(x + 8, y + 4.5, 2.5, 0, Math.PI * 2); g.fill();
  if (classic) { g.strokeStyle = INK; g.stroke(); }
  else { g.fillStyle = '#f2d04a'; g.fillRect(x + 7.5, y + 4, 1, 1); }
}

/**
 * A new thing (walked past)'s picture, if it's one of these: returns whether it was. b: the block
 * (painted: its variant's colours), col and line: its fill and outline, as drawThing has them.
 */
export function decorThing(g, grid, k, x, y, b, classic, h, col, line) {
  const W = grid.w, above = grid.fg[k - W], below = grid.fg[k + W];
  const hangs = !!(SOLID[above] || PLATFORMS[above]) || above === K.CHAIN;
  // (Standing on a table, a cabinet, a barrel: down on its top.)
  const sink = SINKS.has(b.pattern) ? surfaceOf(below) : 0;
  y += sink;
  switch (b.pattern) {
    case 'window_open':
      // The frame's empty; its shutters swung back against the wall either side.
      g.fillStyle = classic ? '#fff' : b.color;
      g.fillRect(x, y + 1, 3, 14); g.fillRect(x + 13, y + 1, 3, 14);
      g.strokeStyle = line; g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 1.5, 2, 13); g.strokeRect(x + 13.5, y + 1.5, 2, 13);
      g.fillStyle = classic ? INK : '#7a5232'; g.fillRect(x + 3, y, 10, 1.5); g.fillRect(x + 3, y + 14.5, 10, 1.5);
      return true;
    case 'trapdoor_open':
      // Swung up, against the side of its opening.
      g.fillStyle = classic ? '#fff' : b.color; g.fillRect(x, y, 4, TILE);
      g.strokeStyle = line; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, 3, TILE - 1);
      g.fillStyle = classic ? INK : '#3a3430'; g.fillRect(x + 1, y + 1, 2, 2);
      return true;
    case 'gate_open':
      // Its posts; the gate swung open, edge on, against one.
      g.fillStyle = col;
      g.fillRect(x, y + 1, 3, TILE - 1); g.fillRect(x + 13, y + 1, 3, TILE - 1); g.fillRect(x + 3, y + 3, 2.5, 11);
      g.strokeStyle = line; g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 1.5, 2, TILE - 2); g.strokeRect(x + 13.5, y + 1.5, 2, TILE - 2); g.strokeRect(x + 3.5, y + 3.5, 1.5, 10);
      return true;
    case 'scaffold':
      // Poles, a plank on top (stood on), and a brace across.
      g.fillStyle = col;
      g.fillRect(x + 1, y, 2, TILE); g.fillRect(x + 13, y, 2, TILE); g.fillRect(x, y, TILE, 3);
      g.strokeStyle = line; g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, TILE - 1, 2.5);
      g.beginPath(); g.moveTo(x + 2, y + 3); g.lineTo(x + 14, y + TILE); g.moveTo(x + 14, y + 3); g.lineTo(x + 2, y + TILE); g.stroke();
      return true;
    case 'column': {
      // A fluted shaft; a capital where nothing of it's above, a base where nothing's below.
      const top = above !== b.id, bottom = below !== b.id;
      g.fillStyle = col; g.fillRect(x + 3, y, 10, TILE);
      g.strokeStyle = classic ? '#9a9a9a' : tint(b.color, 0.75); g.lineWidth = 0.8;
      g.beginPath(); for (const fx of [5.5, 8, 10.5]) { g.moveTo(x + fx, y + (top ? 3 : 0)); g.lineTo(x + fx, y + (bottom ? 13 : TILE)); } g.stroke();
      g.fillStyle = col;
      if (top) g.fillRect(x + 1, y, 14, 3);
      if (bottom) g.fillRect(x + 1, y + 13, 14, 3);
      g.strokeStyle = line; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x + 3, y + (top ? 3 : 0)); g.lineTo(x + 3, y + (bottom ? 13 : TILE)); g.moveTo(x + 13, y + (top ? 3 : 0)); g.lineTo(x + 13, y + (bottom ? 13 : TILE)); g.stroke();
      if (top) g.strokeRect(x + 1.5, y + 0.5, 13, 2.5);
      if (bottom) g.strokeRect(x + 1.5, y + 13, 13, 2.5);
      return true;
    }
    case 'chain':
      // Links, one way and then the other.
      g.strokeStyle = classic ? INK : b.color; g.lineWidth = 1.2;
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        if (i & 1) g.ellipse(x + 8, y + 2 + i * 4, 0.8, 2.2, 0, 0, Math.PI * 2); else g.ellipse(x + 8, y + 2 + i * 4, 1.9, 2.2, 0, 0, Math.PI * 2);
        g.stroke();
      }
      return true;
    case 'candle': {
      // A stub of wax (its colour), its wick, its flame.
      g.fillStyle = col; g.fillRect(x + 6, y + 9, 4, 7);
      g.strokeStyle = line; g.lineWidth = 0.8; g.strokeRect(x + 6.4, y + 9.4, 3.2, 6.6);
      g.strokeStyle = INK; g.beginPath(); g.moveTo(x + 8, y + 9); g.lineTo(x + 8, y + 7.5); g.stroke();
      g.fillStyle = '#ffb040'; g.beginPath(); g.ellipse(x + 8, y + 5.6, 1.6, 2.6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff4c0'; g.beginPath(); g.ellipse(x + 8, y + 6.2, 0.7, 1.3, 0, 0, Math.PI * 2); g.fill();
      return true;
    }
    case 'paper_lantern': {
      // A paper globe, ribbed, its top and bottom caps; on a string where it hangs.
      const cy = hangs ? y + 8 : y + 10;
      if (hangs) { g.strokeStyle = classic ? INK : '#3a3430'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x + 8, y); g.lineTo(x + 8, cy - 5); g.stroke(); }
      if (!classic) { g.fillStyle = 'rgba(255,220,140,0.35)'; g.beginPath(); g.arc(x + 8, cy, 7, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = col; g.beginPath(); g.ellipse(x + 8, cy, 5, 4.5, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = classic ? INK : tint(b.color, 0.6); g.lineWidth = 0.8; g.stroke();
      g.beginPath(); g.ellipse(x + 8, cy, 2.2, 4.5, 0, 0, Math.PI * 2); g.stroke();
      g.fillStyle = classic ? INK : '#2a2420'; g.fillRect(x + 6, cy - 5.5, 4, 1.5); g.fillRect(x + 6, cy + 4, 4, 1.5);
      return true;
    }
    case 'crystal_lamp': {
      // A crystal on a silver stand, glowing; hanging, from a chain.
      const by = hangs ? y + 4 : y + 16;
      g.fillStyle = classic ? '#ddd' : '#c9ccd2';
      if (hangs) { g.fillRect(x + 7.5, y, 1, 4); g.fillRect(x + 5, y + 3, 6, 1.5); }
      else { g.fillRect(x + 5, by - 1.5, 6, 1.5); g.fillRect(x + 7.25, by - 4, 1.5, 3); }
      const cy = hangs ? y + 9 : y + 7.5;
      if (!classic) { g.fillStyle = 'rgba(140,230,255,0.35)'; g.beginPath(); g.arc(x + 8, cy, 6.5, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = classic ? '#fff' : b.color;
      g.beginPath(); g.moveTo(x + 8, cy - 5); g.lineTo(x + 11, cy); g.lineTo(x + 8, cy + 4); g.lineTo(x + 5, cy); g.closePath(); g.fill();
      g.strokeStyle = classic ? INK : '#3a8ab0'; g.lineWidth = 0.9; g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(x + 7, cy - 2.5, 1, 2);
      return true;
    }
    case 'chandelier':
      // A chain down to a ring, candles on it.
      g.strokeStyle = classic ? INK : '#5a5e66'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x + 8, y); g.lineTo(x + 8, y + 7); g.moveTo(x + 8, y + 7); g.lineTo(x + 2, y + 10); g.moveTo(x + 8, y + 7); g.lineTo(x + 14, y + 10); g.stroke();
      g.fillStyle = classic ? '#fff' : b.color;
      g.beginPath(); g.ellipse(x + 8, y + 11, 7, 1.8, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = classic ? INK : tint(b.color, 0.6); g.stroke();
      for (const cx of [2.5, 8, 13.5]) {
        g.fillStyle = classic ? '#fff' : '#efe4c8'; g.fillRect(x + cx - 1, y + 6.5, 2, 3.5);
        g.fillStyle = '#ffb040'; g.beginPath(); g.ellipse(x + cx, y + 5, 1, 1.6, 0, 0, Math.PI * 2); g.fill();
      }
      return true;
    case 'lamp_post':
      // An iron post up to a lamp in a cage, with a cap.
      g.fillStyle = classic ? INK : b.color;
      g.fillRect(x + 7, y + 9, 2, 7); g.fillRect(x + 5, y + 14, 6, 2);
      g.fillRect(x + 4, y + 1, 8, 1.5); g.fillRect(x + 5, y + 8, 6, 1.5);
      g.fillStyle = '#ffd070'; g.fillRect(x + 5.5, y + 2.5, 5, 5.5);
      g.fillStyle = '#fff4c0'; g.fillRect(x + 6.8, y + 3.5, 2.4, 3);
      g.strokeStyle = classic ? INK : b.color; g.lineWidth = 0.8; g.strokeRect(x + 5.5, y + 2.5, 5, 5.5);
      g.beginPath(); g.moveTo(x + 8, y + 2.5); g.lineTo(x + 8, y + 8); g.stroke();
      return true;
    case 'pot': {
      // A clay pot, what's planted in it growing out of it.
      potPlant(g, b.paint || 0, x, y, classic);
      g.fillStyle = classic ? '#fff' : BLOCKS[K.FLOWER_POT].color;
      g.beginPath(); g.moveTo(x + 4, y + 10); g.lineTo(x + 12, y + 10); g.lineTo(x + 11, y + 16); g.lineTo(x + 5, y + 16); g.closePath(); g.fill();
      g.strokeStyle = classic ? INK : '#6e3a22'; g.lineWidth = 1; g.stroke();
      g.fillStyle = classic ? INK : '#8a4a2c'; g.fillRect(x + 3.5, y + 10, 9, 1.6);
      return true;
    }
    case 'painting':
      // A picture in a wooden frame (which picture: its variant).
      g.fillStyle = classic ? INK : '#7a5232'; g.fillRect(x + 1, y + 2, 14, 12);
      picture(g, b.paint || 0, x + 2.5, y + 3.5, 11, 9, classic);
      g.strokeStyle = classic ? INK : '#c8a050'; g.lineWidth = 0.8; g.strokeRect(x + 1.5, y + 2.5, 13, 11);
      return true;
    case 'shelf': {
      // A board on two brackets, with things on it: books, a jar, a pot (by where it is).
      g.fillStyle = col; g.fillRect(x, y + 9, TILE, 2);
      g.strokeStyle = line; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 9.5, TILE - 1, 1.5);
      g.beginPath(); g.moveTo(x + 2, y + 11); g.lineTo(x + 4, y + 13.5); g.moveTo(x + 14, y + 11); g.lineTo(x + 12, y + 13.5); g.stroke();
      const BOOKS = ['#8a2c2c', '#2c4a8a', '#2c7a4a', '#8a6a2c'];
      for (let i = 0; i < 3; i++) {
        const kind = (h >>> (i * 3)) % 4, sx = x + 2 + i * 4.5;
        g.fillStyle = classic ? (i & 1 ? '#fff' : '#ddd') : kind === 3 ? '#b8d8e8' : BOOKS[kind];
        if (kind === 3) { g.fillRect(sx, y + 5, 3, 4); g.fillStyle = classic ? INK : '#7a5634'; g.fillRect(sx, y + 4.5, 3, 1); }
        else g.fillRect(sx, y + 3 + kind, 2.4, 6 - kind);
        if (classic) { g.strokeStyle = INK; g.lineWidth = 0.6; g.strokeRect(sx, y + 3 + (kind === 3 ? 2 : kind), kind === 3 ? 3 : 2.4, kind === 3 ? 4 : 6 - kind); }
      }
      return true;
    }
    case 'cabinet':
      // A cupboard: two doors, their knobs, its top.
      g.fillStyle = col; g.fillRect(x + 1, y + 2, 14, 14);
      g.strokeStyle = line; g.lineWidth = 1;
      g.strokeRect(x + 1.5, y + 2.5, 13, 13);
      g.beginPath(); g.moveTo(x + 8, y + 4); g.lineTo(x + 8, y + 15); g.stroke();
      g.strokeRect(x + 3, y + 5, 3.5, 8.5); g.strokeRect(x + 9.5, y + 5, 3.5, 8.5);
      g.fillStyle = classic ? INK : '#e0c060'; g.fillRect(x + 6.6, y + 8.5, 1, 1.5); g.fillRect(x + 8.4, y + 8.5, 1, 1.5);
      if (!classic) { g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(x + 1, y + 2, 14, 1); }
      return true;
    case 'stove':
      // An iron range: its oven door glowing, hotplates on top, a flue.
      g.fillStyle = classic ? '#fff' : b.color; g.fillRect(x + 1, y + 4, 14, 12); g.fillRect(x + 11, y, 2.5, 4);
      g.strokeStyle = classic ? INK : '#1e2024'; g.lineWidth = 1; g.strokeRect(x + 1.5, y + 4.5, 13, 11); g.strokeRect(x + 11.5, y + 0.5, 1.5, 3.5);
      g.fillStyle = classic ? '#ddd' : '#55595f'; g.fillRect(x + 2.5, y + 3, 4, 1.5); g.fillRect(x + 7.5, y + 3, 3, 1.5);
      g.fillStyle = '#1a1210'; g.fillRect(x + 3.5, y + 8, 9, 6);
      g.fillStyle = '#ff8a30'; g.fillRect(x + 4.5, y + 11, 7, 2.5);
      g.fillStyle = classic ? INK : '#c9ccd2'; g.fillRect(x + 3.5, y + 6.5, 9, 1);
      return true;
    case 'loom':
      // A frame strung with threads, cloth wound on its roller.
      g.fillStyle = col;
      g.fillRect(x + 1, y + 3, 2, 13); g.fillRect(x + 13, y + 3, 2, 13); g.fillRect(x + 1, y + 3, 14, 2); g.fillRect(x + 1, y + 12, 14, 2);
      g.strokeStyle = classic ? '#9a9a9a' : '#efeae0'; g.lineWidth = 0.6;
      g.beginPath(); for (let i = 4; i < 13; i += 1.5) { g.moveTo(x + i, y + 5); g.lineTo(x + i, y + 12); } g.stroke();
      g.fillStyle = classic ? '#ddd' : '#c83a3a'; g.fillRect(x + 3, y + 10, 10, 2);
      g.strokeStyle = line; g.lineWidth = 1; g.strokeRect(x + 1.5, y + 3.5, 13, 10);
      return true;
    case 'mason':
      // A stone bench with a saw's round blade standing up in it.
      g.fillStyle = classic ? '#fff' : b.color; g.fillRect(x + 1, y + 8, 14, 8);
      g.strokeStyle = line; g.lineWidth = 1; g.strokeRect(x + 1.5, y + 8.5, 13, 7);
      g.fillStyle = classic ? '#eee' : '#d0d4da'; g.beginPath(); g.arc(x + 8, y + 7, 4.5, Math.PI, 0); g.fill();
      g.strokeStyle = classic ? INK : '#5a5e66'; g.stroke();
      g.fillStyle = classic ? INK : '#3a3e44'; g.beginPath(); g.arc(x + 8, y + 7, 1, 0, Math.PI * 2); g.fill();
      return true;
    case 'drafting':
      // A board on legs, tilted, a blueprint pinned on it.
      g.strokeStyle = line; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x + 3, y + 16); g.lineTo(x + 5, y + 9); g.moveTo(x + 13, y + 16); g.lineTo(x + 11, y + 7); g.stroke();
      g.fillStyle = col; g.beginPath(); g.moveTo(x + 1, y + 10); g.lineTo(x + 15, y + 6); g.lineTo(x + 15, y + 8.5); g.lineTo(x + 1, y + 12.5); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = classic ? '#ddd' : '#2f62c8'; g.beginPath(); g.moveTo(x + 4, y + 9.4); g.lineTo(x + 12, y + 7.2); g.lineTo(x + 12, y + 8.6); g.lineTo(x + 4, y + 10.8); g.closePath(); g.fill();
      return true;
    default: return false;
  }
}

// ---- Icons -----------------------------------------------------------------------------------------------

/** The new materials' icons (stroked in ink, filled in their colour). */
const ICONS = {
  string(ctx, x, y, w) {
    // A ball of it, a loose end.
    ctx.beginPath(); ctx.arc(x + w * 0.45, y + w * 0.55, w * 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w * 0.2, y + w * 0.45); ctx.quadraticCurveTo(x + w * 0.45, y + w * 0.3, x + w * 0.7, y + w * 0.5); ctx.moveTo(x + w * 0.25, y + w * 0.68); ctx.quadraticCurveTo(x + w * 0.45, y + w * 0.52, x + w * 0.72, y + w * 0.68); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w * 0.72, y + w * 0.4); ctx.quadraticCurveTo(x + w * 0.9, y + w * 0.2, x + w * 0.95, y + w * 0.1); ctx.stroke();
  },
  rope(ctx, x, y, w) {
    // A coil.
    ctx.lineWidth = Math.max(1, w / 8);
    for (const r of [0.34, 0.22, 0.1]) { ctx.beginPath(); ctx.arc(x + w * 0.5, y + w * 0.55, w * r, 0, Math.PI * 2); ctx.strokeStyle = INK; ctx.stroke(); }
    ctx.lineWidth = Math.max(0.6, w / 14); ctx.strokeStyle = ctx.fillStyle;
    for (const r of [0.34, 0.22]) { ctx.beginPath(); ctx.arc(x + w * 0.5, y + w * 0.55, w * r, 0, Math.PI * 2); ctx.stroke(); }
  },
  cloth(ctx, x, y, w) {
    // A folded bolt of it.
    ctx.fillRect(x + w * 0.12, y + w * 0.3, w * 0.76, w * 0.5); ctx.strokeRect(x + w * 0.12, y + w * 0.3, w * 0.76, w * 0.5);
    ctx.beginPath(); ctx.moveTo(x + w * 0.12, y + w * 0.47); ctx.lineTo(x + w * 0.88, y + w * 0.47); ctx.moveTo(x + w * 0.12, y + w * 0.63); ctx.lineTo(x + w * 0.88, y + w * 0.63); ctx.stroke();
  },
  paper(ctx, x, y, w) {
    // A sheet, its corner turned.
    ctx.beginPath(); ctx.moveTo(x + w * 0.2, y + w * 0.1); ctx.lineTo(x + w * 0.65, y + w * 0.1); ctx.lineTo(x + w * 0.82, y + w * 0.27); ctx.lineTo(x + w * 0.82, y + w * 0.9); ctx.lineTo(x + w * 0.2, y + w * 0.9); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w * 0.65, y + w * 0.1); ctx.lineTo(x + w * 0.65, y + w * 0.27); ctx.lineTo(x + w * 0.82, y + w * 0.27); ctx.stroke();
  },
  book(ctx, x, y, w) {
    // Bound in leather: its pages showing at the edge.
    ctx.fillRect(x + w * 0.18, y + w * 0.12, w * 0.6, w * 0.76); ctx.strokeRect(x + w * 0.18, y + w * 0.12, w * 0.6, w * 0.76);
    ctx.fillStyle = '#f4f0e2'; ctx.fillRect(x + w * 0.78, y + w * 0.16, w * 0.08, w * 0.68); ctx.strokeRect(x + w * 0.78, y + w * 0.16, w * 0.08, w * 0.68);
    ctx.fillStyle = '#e0c060'; ctx.fillRect(x + w * 0.3, y + w * 0.3, w * 0.36, w * 0.08);
  },
  nails(ctx, x, y, w) {
    // Three nails.
    for (const [a, b] of [[0.25, 0.15], [0.5, 0.25], [0.72, 0.12]]) {
      ctx.fillRect(x + w * (a - 0.1), y + w * b, w * 0.2, w * 0.07);
      ctx.beginPath(); ctx.moveTo(x + w * (a - 0.03), y + w * (b + 0.07)); ctx.lineTo(x + w * a, y + w * (b + 0.7)); ctx.lineTo(x + w * (a + 0.03), y + w * (b + 0.07)); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  },
  tallow(ctx, x, y, w) {
    ctx.beginPath(); ctx.ellipse(x + w * 0.5, y + w * 0.62, w * 0.36, w * 0.24, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(x + w * 0.32, y + w * 0.52, w * 0.14, w * 0.06);
  },
  stick(ctx, x, y, w) {
    ctx.lineCap = 'round'; ctx.lineWidth = w * 0.16; ctx.strokeStyle = INK;
    ctx.beginPath(); ctx.moveTo(x + w * 0.2, y + w * 0.85); ctx.lineTo(x + w * 0.8, y + w * 0.15); ctx.stroke();
    ctx.lineWidth = w * 0.09; ctx.strokeStyle = ctx.fillStyle; ctx.stroke(); ctx.lineCap = 'butt'; ctx.lineWidth = Math.max(0.6, w / 12);
  },
  reed(ctx, x, y, w) {
    ctx.strokeStyle = '#7a8a3a'; ctx.lineWidth = Math.max(1, w / 9);
    ctx.beginPath(); for (const dx of [0.3, 0.5, 0.7]) { ctx.moveTo(x + w * dx, y + w * 0.92); ctx.lineTo(x + w * (dx + (dx - 0.5) * 0.4), y + w * 0.12); } ctx.stroke();
    ctx.fillStyle = '#8a6a3a'; ctx.fillRect(x + w * 0.44, y + w * 0.1, w * 0.12, w * 0.24);
  },
  kelp(ctx, x, y, w) {
    ctx.beginPath(); ctx.moveTo(x + w * 0.45, y + w * 0.95); ctx.quadraticCurveTo(x + w * 0.15, y + w * 0.6, x + w * 0.45, y + w * 0.35); ctx.quadraticCurveTo(x + w * 0.7, y + w * 0.15, x + w * 0.55, y + w * 0.05);
    ctx.quadraticCurveTo(x + w * 0.95, y + w * 0.3, x + w * 0.62, y + w * 0.55); ctx.quadraticCurveTo(x + w * 0.4, y + w * 0.75, x + w * 0.6, y + w * 0.95); ctx.closePath(); ctx.fill(); ctx.stroke();
  },
  coral_fan(ctx, x, y, w) {
    ctx.beginPath(); ctx.moveTo(x + w * 0.5, y + w * 0.9); ctx.lineTo(x + w * 0.1, y + w * 0.3); ctx.quadraticCurveTo(x + w * 0.5, y + w * 0.02, x + w * 0.9, y + w * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); for (const ex of [0.25, 0.5, 0.75]) { ctx.moveTo(x + w * 0.5, y + w * 0.88); ctx.lineTo(x + w * ex, y + w * 0.22); } ctx.stroke();
  },
  petals(ctx, x, y, w) {
    for (const [px, py, a] of [[0.35, 0.4, 0.4], [0.62, 0.35, -0.5], [0.5, 0.65, 1.2], [0.28, 0.7, -1]]) { ctx.beginPath(); ctx.ellipse(x + w * px, y + w * py, w * 0.15, w * 0.09, a, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  },
};

/** A dye: a little cloth bag of its powder, tied at the neck. */
function dyeIcon(ctx, it, x, y, w) {
  ctx.fillStyle = it.color; ctx.strokeStyle = INK;
  ctx.beginPath(); ctx.moveTo(x + w * 0.35, y + w * 0.3); ctx.quadraticCurveTo(x + w * 0.05, y + w * 0.9, x + w * 0.5, y + w * 0.9); ctx.quadraticCurveTo(x + w * 0.95, y + w * 0.9, x + w * 0.65, y + w * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#d8c8a0'; ctx.beginPath(); ctx.moveTo(x + w * 0.32, y + w * 0.12); ctx.lineTo(x + w * 0.68, y + w * 0.12); ctx.lineTo(x + w * 0.62, y + w * 0.3); ctx.lineTo(x + w * 0.38, y + w * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(x + w * 0.3, y + w * 0.52, w * 0.1, w * 0.16);
}

/** A blueprint: a blue sheet rolled at its ends, a house drawn on it in white. */
function blueprintIcon(ctx, it, x, y, w) {
  ctx.strokeStyle = INK; ctx.fillStyle = it.color || '#2f62c8';
  ctx.fillRect(x + w * 0.12, y + w * 0.18, w * 0.76, w * 0.64); ctx.strokeRect(x + w * 0.12, y + w * 0.18, w * 0.76, w * 0.64);
  ctx.fillStyle = '#9ab4e8'; ctx.fillRect(x + w * 0.06, y + w * 0.14, w * 0.1, w * 0.72); ctx.fillRect(x + w * 0.84, y + w * 0.14, w * 0.1, w * 0.72);
  ctx.strokeStyle = '#f4f8ff'; ctx.lineWidth = Math.max(0.6, w / 16);
  ctx.beginPath(); ctx.moveTo(x + w * 0.3, y + w * 0.72); ctx.lineTo(x + w * 0.3, y + w * 0.48); ctx.lineTo(x + w * 0.5, y + w * 0.3); ctx.lineTo(x + w * 0.7, y + w * 0.48); ctx.lineTo(x + w * 0.7, y + w * 0.72); ctx.closePath();
  ctx.moveTo(x + w * 0.45, y + w * 0.72); ctx.lineTo(x + w * 0.45, y + w * 0.58); ctx.lineTo(x + w * 0.55, y + w * 0.58); ctx.lineTo(x + w * 0.55, y + w * 0.72); ctx.stroke();
}

/** A new item's icon, if it's one of these (materials, dyes, blueprints): returns whether it was. */
export function drawCraftIcon(ctx, it, x, y, w) {
  if (it.kind === 'blueprint') { blueprintIcon(ctx, it, x, y, w); return true; }
  if (it.dyeOf) { ctx.lineWidth = Math.max(0.6, w / 12); dyeIcon(ctx, it, x, y, w); return true; }
  const f = ICONS[it.key];
  if (!f) return false;
  ctx.strokeStyle = INK; ctx.fillStyle = it.color || '#888'; ctx.lineWidth = Math.max(0.6, w / 12);
  f(ctx, x, y, w);
  return true;
}

/** The new food's icons (their look: craftitems.js), if it's one of them: returns whether it was. */
export function drawCraftFood(ctx, it, x, y, w) {
  const c = it.color;
  ctx.strokeStyle = INK;
  switch (it.look) {
    case 'cake':
      // A round cake, iced, berries on top.
      ctx.fillStyle = '#d8a050'; ctx.fillRect(x + w * 0.12, y + w * 0.45, w * 0.76, w * 0.35); ctx.strokeRect(x + w * 0.12, y + w * 0.45, w * 0.76, w * 0.35);
      ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x + w * 0.5, y + w * 0.45, w * 0.38, w * 0.12, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillRect(x + w * 0.2, y + w * 0.45, w * 0.08, w * 0.14);
      ctx.fillStyle = '#c8303a'; for (const bx of [0.32, 0.5, 0.68]) { ctx.beginPath(); ctx.arc(x + w * bx, y + w * 0.4, w * 0.05, 0, Math.PI * 2); ctx.fill(); }
      return true;
    case 'cookie':
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + w * 0.5, y + w * 0.55, w * 0.34, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#4a2a1a'; for (const [cx, cy] of [[0.38, 0.45], [0.6, 0.5], [0.45, 0.68], [0.62, 0.7]]) ctx.fillRect(x + w * cx, y + w * cy, w * 0.07, w * 0.07);
      return true;
    case 'fried_egg':
      ctx.fillStyle = '#f8f6ee'; ctx.beginPath(); ctx.ellipse(x + w * 0.5, y + w * 0.58, w * 0.4, w * 0.28, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = it.key === 'omelette' ? c : '#f2b820'; ctx.beginPath(); ctx.arc(x + w * 0.48, y + w * 0.55, w * (it.key === 'omelette' ? 0.26 : 0.14), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      return true;
    case 'kelp':
      ctx.fillStyle = c;
      for (let i = 0; i < 3; i++) { ctx.fillRect(x + w * (0.18 + i * 0.24), y + w * 0.2, w * 0.16, w * 0.62); ctx.strokeRect(x + w * (0.18 + i * 0.24), y + w * 0.2, w * 0.16, w * 0.62); }
      return true;
    default: return false;
  }
}
