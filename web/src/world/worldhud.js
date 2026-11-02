// World mode's heads-up display (hud.js draws it for world games): the hotbar the number keys
// pick from, what you've just picked up, where you are (the biome, how deep, how far from where
// the world starts), and a small map of the world round you. Drawn in screen pixels.

import { HOTBAR, itemOf } from './items.js';
import { WEAPONS } from '../weapons.js';
import { BLOCKS, WALLS, TILE, AIR, NO_WALL, shade } from './blocks.js';
import { WORLD_H } from './worldgen.js';
import { inHand, BRUSH_NAMES, claimAt } from './worldplay.js';
import { drawIcon } from './worldrender.js';
import { clock, dayOf, isNight, nightness } from './monsters.js';
import { keyShort, slotAction, keyLabel } from '../keys.js';

const FONT = 'Arial, Helvetica, sans-serif';
export const HOT_SIZE = 46;
const HOT_GAP = 4;
const GOT_LIFE = 240; // (updates a line of what you picked up stays)

/** The hotbar's scale for a screen W wide (smaller on narrow screens). */
const hotScale = W => Math.min(1, (W - 24) / (HOTBAR * HOT_SIZE + (HOTBAR - 1) * HOT_GAP));

/** Everything world mode adds to the HUD (r: the renderer; W, H: the screen in CSS pixels). */
export function drawWorldHud(r, ctx, game, me, W, H) {
  if (me.alive && me.world) drawHotbar(ctx, me, W, H);
  if (me.world) drawGot(ctx, game, me, H);
  drawWhere(ctx, game, me, W);
  drawMiniMap(ctx, game, me, W, H);
}

/** The bar for what's in your hand (hud.js's status row, right side): [fill, kind, label], or null. */
export function heldBar(me) {
  const { slot, item } = inHand(me);
  if (!item) return [1, 'ammo', 'Fists  ·  plants and torches come away by hand'];
  const n = me.world.inv.count(item.key);
  if (item.kind === 'block' || item.kind === 'wall') {
    const brush = item.key === 'door' || item.key === 'torch' ? '' : `  ·  ${BRUSH_NAMES[me.world.brush]} (${keyLabel('reload')})`;
    return [Math.min(1, n / item.stack), 'ammo', `${item.name}  ${n}${brush}`];
  }
  if (item.kind === 'tool') {
    const what = item.tool === 'hammer' ? 'shapes blocks, takes down walls' : item.tool === 'axe' ? 'fells trees' : `tier ${item.tier}`;
    return [1, 'ammo', `${item.name}  ·  ${what}`];
  }
  if (item.kind === 'contract') return [1, 'ammo', `${item.name}  ${n}  ·  click: hire a mercenary`];
  return [1, 'ammo', `${item.name}  ${slot.n > 1 ? slot.n : ''}`.trim()];
}

// ---- The hotbar ------------------------------------------------------------------------------

const TEXTS = new Map();
/** A short text, made once (the same string each frame: no garbage, and WebGL keeps its picture). */
function text(key, make) {
  let t = TEXTS.get(key);
  if (t === undefined) {
    if (TEXTS.size > 500) TEXTS.clear();
    TEXTS.set(key, t = make());
  }
  return t;
}

function drawHotbar(ctx, me, W, H) {
  const w = me.world, k = hotScale(W), total = HOTBAR * HOT_SIZE + (HOTBAR - 1) * HOT_GAP;
  ctx.save();
  ctx.translate(W / 2 - (total * k) / 2, H - (HOT_SIZE + 10) * k);
  ctx.scale(k, k);
  ctx.textBaseline = 'middle';
  for (let i = 0; i < HOTBAR; i++) {
    const x = i * (HOT_SIZE + HOT_GAP), slot = w.inv.slots[i], it = slot && itemOf(slot.key), on = i === w.slot;
    ctx.fillStyle = on ? 'rgba(30,30,30,0.88)' : slot ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.4)';
    ctx.fillRect(x, 0, HOT_SIZE, HOT_SIZE);
    ctx.strokeStyle = on ? '#f2c230' : slot ? '#333' : 'rgba(0,0,0,0.15)';
    ctx.lineWidth = on ? 2 : 1;
    ctx.strokeRect(x + (on ? 1 : 0.5), on ? 1 : 0.5, HOT_SIZE - (on ? 2 : 1), HOT_SIZE - (on ? 2 : 1));
    ctx.textAlign = 'left';
    ctx.font = `bold 10px ${FONT}`;
    ctx.fillStyle = on ? '#fff' : slot ? '#333' : 'rgba(0,0,0,0.3)';
    ctx.fillText(keyShort(slotAction(i)), x + 4, 9);
    if (!it) continue;
    ctx.textAlign = 'center';
    if (it.kind === 'weapon') {
      const def = WEAPONS[it.weapon];
      ctx.font = def.short.length > 8 ? `8px ${FONT}` : `10px ${FONT}`;
      ctx.fillText(def.short, x + HOT_SIZE / 2, 23);
      ctx.font = `9px ${FONT}`;
      const spare = it.ammo === 'self' ? w.inv.count(it.key) : it.ammo ? w.inv.count(it.ammo) : null;
      const label = spare == null ? '' : def.mag ? text(`m${slot.mag || 0}/${spare}`, () => `${slot.mag || 0}/${spare}`) : String(spare);
      if (label) ctx.fillText(label, x + HOT_SIZE / 2, 36);
    } else {
      drawIcon(ctx, it, x + 13, 12, 20, false, true);
      if (slot.n > 1) {
        ctx.textAlign = 'right';
        ctx.font = `bold 9px ${FONT}`;
        ctx.fillStyle = on ? '#fff' : '#222';
        ctx.fillText(String(slot.n), x + HOT_SIZE - 3, HOT_SIZE - 7);
      }
    }
  }
  ctx.restore();
}

// ---- What you picked up --------------------------------------------------------------------------

function drawGot(ctx, game, me, H) {
  const got = me.world.got;
  if (!got.length) return;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 12px ${FONT}`;
  let row = 0;
  for (let i = got.length - 1; i >= 0 && row < 6; i--) {
    const g = got[i], age = game.tick - g.tick;
    if (age > GOT_LIFE) continue;
    const it = itemOf(g.key), line = text(`g${g.n}${g.key}`, () => `+${g.n} ${it?.name ?? g.key}`);
    ctx.globalAlpha = Math.min(1, (GOT_LIFE - age) / 40);
    const y = H - 24 - row * 18;
    // (On a pale panel: it's often dark underground.)
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.fillRect(8, y - 8, 30 + ctx.measureText(line).width, 16);
    if (it) drawIcon(ctx, it, 12, y - 6, 12, false, true);
    ctx.fillStyle = '#222';
    ctx.fillText(line, 30, y);
    row++;
  }
  ctx.globalAlpha = 1;
}

// ---- Where you are -------------------------------------------------------------------------------

function drawWhere(ctx, game, me, W) {
  const world = game.world, x = me.alive ? me.x : me.body?.x ?? 0, y = me.alive ? me.y : me.body?.y ?? 0;
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  const col = world.gen.column(tx), deep = ty - col.surf + 1;
  const from = Math.round((x - world.spawns[0].x) / TILE);
  const where = deep > 2 ? `${deep} blocks down` : 'on the surface';
  const along = from === 0 ? 'where the world starts' : `${Math.abs(from)} ${from < 0 ? 'west' : 'east'}`;
  const time = `Day ${dayOf(world.time || 0)}, ${clock(world.time || 0)}${isNight(world.time || 0) ? ' (night)' : ''}`;
  const c = world.claims?.size ? claimAt(world, tx, ty) : null;
  // (In a town: its name, and it's said on the screen as you come into it.)
  const town = deep < 14 ? world.gen.townNear(tx, 2) : null;
  const base = town ? `${town.name} (${town.kind})` : c ? (c.owner.toLowerCase() === String(me.name).toLowerCase() ? 'your base' : `${c.owner}'s base`) : '';
  const line = text(`w${col.biome.name}|${where}|${along}|${time}|${base}`, () => `${base ? `${base}  ·  ` : ''}${col.biome.name}  ·  ${where}  ·  ${along}  ·  ${time}`);
  if (town !== arrival.town) { arrival.town = town; arrival.at = town ? performance.now() : 0; }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // (On a pale panel: it's often dark underground.)
  ctx.font = `12px ${FONT}`;
  const bw = Math.max(160, ctx.measureText(line).width + 24);
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.fillRect(W / 2 - bw / 2, 4, bw, 40);
  ctx.font = `bold 14px ${FONT}`;
  ctx.fillStyle = '#333';
  ctx.fillText(world.name, W / 2, 16);
  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = '#666';
  ctx.fillText(line, W / 2, 33);
  drawArrival(ctx, W);
}

// Coming into a town: its name across the screen a moment, fading.
const arrival = { town: null, at: 0 };
const ARRIVAL_MS = 3200;
function drawArrival(ctx, W) {
  const t = arrival.town, age = performance.now() - arrival.at;
  if (!t || age > ARRIVAL_MS) return;
  const a = Math.min(1, age / 300, (ARRIVAL_MS - age) / 700);
  ctx.globalAlpha = Math.max(0, a);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // (On a pale panel, as the rest of the HUD: the WebGL renderer's text has no outlines.)
  ctx.font = `bold 30px ${FONT}`;
  const bw = Math.max(220, ctx.measureText(t.name).width + 60);
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.fillRect(W / 2 - bw / 2, 70, bw, 62);
  ctx.fillStyle = '#333';
  ctx.fillText(t.name, W / 2, 93);
  ctx.font = `italic 14px ${FONT}`;
  ctx.fillStyle = '#666';
  ctx.fillText(t.kind === 'city' ? 'a walled city' : 'a village', W / 2, 119);
  ctx.globalAlpha = 1;
}

// ---- The map of what's round you ------------------------------------------------------------------

const MAP_W = 120, MAP_H = 76;    // tiles shown
const MAP_SCALE = 1.5;            // screen pixels a tile
const mm = { canvas: null, g: null, img: null, at: -1e9, tx: NaN, ty: NaN, version: -1, world: null, colors: null };

/** Each block's colour on the map ([r, g, b]), and each wall's (darker). */
function mapColors() {
  const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  return {
    blocks: BLOCKS.map(b => (b.id === AIR ? null : rgb(b.ore || b.color))),
    walls: WALLS.map(w => (w.color ? rgb(shade(w.color, 0.6)) : null)),
  };
}

function drawMiniMap(ctx, game, me, W, H) {
  const world = game.world, x = me.alive ? me.x : me.body?.x ?? 0, y = me.alive ? me.y : me.body?.y ?? 0;
  const ctr = Math.floor(x / TILE), cty = Math.floor(y / TILE);
  const w = MAP_W * MAP_SCALE, h = MAP_H * MAP_SCALE, x0 = W - 12 - w, y0 = H - 30 - h;
  // Worked out again every half second or so (or straight away after a long way).
  const stale = mm.world !== world || game.tick - mm.at > 30 || Math.abs(ctr - mm.tx) > 8 || Math.abs(cty - mm.ty) > 8 || game.tick < mm.at;
  if (stale && typeof document !== 'undefined') {
    if (!mm.canvas) {
      mm.canvas = document.createElement('canvas');
      mm.canvas.width = MAP_W;
      mm.canvas.height = MAP_H;
      mm.g = mm.canvas.getContext('2d');
      mm.img = mm.g.createImageData(MAP_W, MAP_H);
      mm.colors = mapColors();
    }
    mm.world = world; mm.at = game.tick; mm.tx = ctr; mm.ty = cty;
    const px = mm.img.data, { blocks, walls } = mm.colors, X0 = ctr - MAP_W / 2, Y0 = cty - MAP_H / 2;
    // (The sky darker at night.)
    const n = nightness(world.time || 0), sky = SKY.map((c, i) => Math.round(c + (NIGHT_SKY[i] - c) * n));
    for (let j = 0; j < MAP_H; j++) {
      const ty = Y0 + j;
      for (let i = 0; i < MAP_W; i++) {
        const tx = X0 + i, o = (j * MAP_W + i) * 4;
        let c = null;
        if (ty >= 0 && ty < WORLD_H) {
          // (Only what's been made already: the map doesn't make the world.)
          if (world.has(tx >> 5, ty >> 5)) c = blocks[world.tile(tx, ty)] || walls[world.wall(tx, ty)];
          else { px[o + 3] = 0; continue; }
        }
        if (!c) c = ty < (world.gen.column(tx).surf) ? sky : CAVE;
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
      }
    }
    mm.g.putImageData(mm.img, 0, 0);
    mm.version++;
  }
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.fillRect(x0 - 3, y0 - 3, w + 6, h + 6);
  if (mm.canvas) {
    if (ctx.image) ctx.image(mm.canvas, x0, y0, w, h, mm.version);
    else {
      const smooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(mm.canvas, x0, y0, w, h);
      ctx.imageSmoothingEnabled = smooth;
    }
  }
  // Who else is about: monsters red, mercenaries blue, other players white.
  for (const o of game.soldiers) {
    if (!o.alive || o === me) continue;
    const ox = Math.floor(o.x / TILE) - mm.tx + MAP_W / 2, oy = Math.floor(o.y / TILE) - mm.ty + MAP_H / 2;
    if (ox < 0 || ox >= MAP_W || oy < 0 || oy >= MAP_H) continue;
    ctx.fillStyle = o.npc?.kind === 'monster' ? '#ff3b2f' : o.npc?.kind === 'merc' ? '#3d7ff0' : '#ffffff';
    ctx.fillRect(x0 + ox * MAP_SCALE - 1.5, y0 + oy * MAP_SCALE - 2, 3, 3);
  }
  // You, in the middle (and where the world starts, if it's on the map).
  ctx.fillStyle = '#e02020';
  ctx.fillRect(x0 + (ctr - mm.tx + MAP_W / 2) * MAP_SCALE - 2, y0 + (cty - mm.ty + MAP_H / 2) * MAP_SCALE - 3, 4, 5);
  const sp = world.spawns[0], sx = Math.floor(sp.x / TILE) - mm.tx + MAP_W / 2, sy = Math.floor(sp.y / TILE) - mm.ty + MAP_H / 2;
  if (sx >= 0 && sx < MAP_W && sy >= 0 && sy < MAP_H) {
    ctx.strokeStyle = '#2f6fdb';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0 + sx * MAP_SCALE - 2.5, y0 + sy * MAP_SCALE - 2.5, 5, 5);
  }
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 - 0.5, y0 - 0.5, w + 1, h + 1);
}
const SKY = [156, 203, 232], NIGHT_SKY = [22, 30, 56], CAVE = [26, 22, 20];
