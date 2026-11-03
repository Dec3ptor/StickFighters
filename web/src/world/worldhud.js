// World mode's heads-up display (hud.js draws it for world games): the hotbar the number keys
// pick from, what you've just picked up, where you are (the biome, how deep, how far from where
// the world starts), and a small map of the world round you. Drawn in screen pixels.

import { HOTBAR, itemOf } from './items.js';
import { WEAPONS } from '../weapons.js';
import { BLOCKS, WALLS, TILE, AIR, NO_WALL, shade } from './blocks.js';
import { WORLD_H } from './worldgen.js';
import { inHand, rightHand, BRUSH_NAMES, claimAt } from './worldplay.js';
import { drawIcon } from './worldrender.js';
import { clock, dayOf, isNight, nightness } from './monsters.js';
import { keyShort, slotAction, keyLabel } from '../keys.js';
import { devLines } from './devmode.js';
import { folkAt } from './talk.js';
import { itemColor, isPrecious, stackName } from './iteminfo.js';
import { xpToNext, MAX_LEVEL } from './progress.js';
import { RARITY } from './gear.js';
import { goalText, goalPlace, goalMet, questReady, turnInTo } from './quests.js';

const FONT = 'Arial, Helvetica, sans-serif';
export const HOT_SIZE = 46;
const HOT_GAP = 4;
const GOT_LIFE = 240; // (updates a line of what you picked up stays)

/** The hotbar's scale for a screen W wide (smaller on narrow screens). */
const hotScale = W => Math.min(1, (W - 24) / (HOTBAR * HOT_SIZE + (HOTBAR - 1) * HOT_GAP));

/**
 * Everything world mode adds to the HUD (r: the renderer; W, H: the screen in CSS pixels;
 * opts.showItems: the key's held that names everything on the ground).
 */
export function drawWorldHud(r, ctx, game, me, W, H, opts = {}) {
  if (opts.scope) drawScope(ctx, opts.scope, W, H);
  if (game.world.drops?.length) drawDropNames(r, ctx, game, me, W, H, !!opts.showItems);
  if (me.world?.marks?.length) drawMarks(r, ctx, game, me, W, H);
  if (me.alive && me.world?.quests?.list.length) drawQuestPointer(r, ctx, game, me, W, H);
  if (me.alive && me.world?.graves?.length) drawGravePointer(r, ctx, game, me, W, H);
  if (me.alive && me.world?.sleep) drawSleep(ctx, game, me, W, H);
  else if (me.world) me.world.sleepSeen = null;
  if (me.alive && me.world) { drawHotbar(ctx, me, W, H); drawXpBar(ctx, game, me, W, H); }
  if (me.world?.quests?.list.length) drawTracker(ctx, game, me, W);
  if (me.world?.levelUp) drawLevelUp(ctx, game, me, W, H);
  if (me.world?.partyList?.length) drawParty(ctx, me, W);
  if (me.world?.raidInfo) drawRaid(ctx, game, me, W);
  if (me.alive && me.world && !me.world.dev) drawTalkHint(ctx, game, me, W, H);
  if (me.world) drawGot(ctx, game, me, W, H);
  drawWhere(ctx, game, me, W);
  drawMiniMap(ctx, game, me, W, H);
  if (me.world?.dev) drawDev(ctx, me, r.zoomScale || 1);
}

// ---- Level, experience and quests (progress.js, quests.js) ------------------------------------------

/** The experience bar, just over the hotbar: the level, how far to the next, and what was just earned. */
function drawXpBar(ctx, game, me, W, H) {
  const p = me.world.prog;
  if (!p) return;
  const k = hotScale(W), total = (HOTBAR * HOT_SIZE + (HOTBAR - 1) * HOT_GAP) * k, x0 = W / 2 - total / 2, y = H - (HOT_SIZE + 10) * k - 9;
  const need = xpToNext(p.level), f = p.level >= MAX_LEVEL ? 1 : Math.min(1, p.xp / need);
  ctx.fillStyle = 'rgba(16,18,24,0.6)';
  ctx.fillRect(x0, y, total, 6);
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(x0 + 1, y + 1, (total - 2) * f, 4);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `bold 11px ${FONT}`;
  const label = text(`lv${p.level}|${p.points}`, () => `Level ${p.level}${p.points ? `  ·  ${p.points} perk point${p.points > 1 ? 's' : ''} (${keyLabel('journal')})` : ''}`);
  // (Its label to the left of it, level with it.)
  const lw = ctx.measureText(label).width + 10, lx = Math.max(4, x0 - lw - 6);
  ctx.fillStyle = 'rgba(16,18,24,0.72)';
  ctx.fillRect(lx, y - 4, lw, 14);
  ctx.fillStyle = p.points ? '#ffe36e' : '#f2c230';
  ctx.fillText(label, lx + 5, y + 3.5);
  // What was just earned, rising off the bar's end.
  ctx.textAlign = 'right';
  let row = 0;
  for (let i = (me.world.xpGot?.length || 0) - 1; i >= 0 && row < 3; i--) {
    const g = me.world.xpGot[i], age = game.tick - g.tick;
    if (age > 150 || age < 0) continue;
    ctx.globalAlpha = Math.min(1, (150 - age) / 40);
    ctx.font = `bold 12px ${FONT}`;
    const t = text(`xp${g.n}|${g.why}`, () => `+${g.n} XP${g.why ? `  ${g.why}` : ''}`);
    const w = ctx.measureText(t).width + 10, yy = y - 26 - row * 17 - Math.min(10, age * 0.3);
    ctx.fillStyle = 'rgba(16,18,24,0.66)';
    ctx.fillRect(x0 + total - w, yy - 8, w, 16);
    ctx.fillStyle = '#ffe36e';
    ctx.fillText(t, x0 + total - 5, yy);
    row++;
  }
  ctx.globalAlpha = 1;
}

/** A level reached: said big across the screen a moment. */
function drawLevelUp(ctx, game, me, W, H) {
  const lu = me.world.levelUp, age = game.tick - lu.tick;
  if (age < 0 || age > 200) return;
  const a = Math.min(1, age / 12, (200 - age) / 40);
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const y = H * 0.2;
  ctx.fillStyle = 'rgba(16,18,24,0.7)';
  ctx.fillRect(W / 2 - 170, y - 34, 340, 68);
  ctx.strokeStyle = '#f2c230';
  ctx.lineWidth = 2;
  ctx.strokeRect(W / 2 - 169, y - 33, 338, 66);
  ctx.font = `bold 28px ${FONT}`;
  ctx.fillStyle = '#ffe36e';
  ctx.fillText(text(`lvup${lu.level}`, () => `Level ${lu.level}!`), W / 2, y - 8);
  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = '#eef2f7';
  ctx.fillText(text(`lvupk${lu.level}`, () => `More health, and a perk point to spend (${keyLabel('journal')})`), W / 2, y + 18);
  ctx.globalAlpha = 1;
}

/** The quest being followed (the journal picks it): its goals, and which way to go. */
function drawTracker(ctx, game, me, W) {
  const qs = me.world.quests, q = qs.list.find(x => x.id === qs.track) || qs.list.at(-1);
  if (!q) return;
  const x0 = 10, y0 = me.world.dev ? 120 : 56, lines = [];
  const ready = questReady(me, q);
  for (const g of q.goals) lines.push([goalMet(me, g) ? '✓ ' : '• ', goalText(me, g), goalMet(me, g)]);
  const to = ready ? turnInTo(q) : null;
  if (ready) lines.push(['→ ', to ? `${q.turnIn === q.giver.key ? 'Back to' : 'Take it to'} ${to.name}${to.town ? ` in ${to.town}` : ''}` : 'Hand it over', false]);
  // (Which way: to the first goal that's somewhere, or to whoever it's handed in to.)
  let place = null;
  for (const g of q.goals) if ((place = goalPlace(me, g))) break;
  if (ready) place = to ? { x: to.x, y: to.y } : null;
  const dir = place ? wayTo(me, place) : '';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 13px ${FONT}`;
  let w = ctx.measureText(q.title).width;
  ctx.font = `12px ${FONT}`;
  for (const l of lines) w = Math.max(w, ctx.measureText(l[0] + l[1]).width);
  if (dir) w = Math.max(w, ctx.measureText(dir).width);
  const more = qs.list.length - 1, h = 24 + lines.length * 16 + (dir ? 16 : 0) + (more > 0 ? 15 : 0);
  ctx.fillStyle = 'rgba(16,18,24,0.66)';
  ctx.fillRect(x0, y0, w + 22, h);
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(x0, y0, 3, h);
  ctx.font = `bold 13px ${FONT}`;
  ctx.fillStyle = ready ? '#7ee07a' : '#ffe36e';
  ctx.fillText(q.title, x0 + 11, y0 + 12);
  ctx.font = `12px ${FONT}`;
  lines.forEach(([mark, t, met], i) => {
    ctx.fillStyle = met ? '#8fd18b' : '#eef2f7';
    ctx.fillText(mark + t, x0 + 11, y0 + 30 + i * 16);
  });
  let y = y0 + 30 + lines.length * 16;
  if (dir) { ctx.fillStyle = '#9ad0ff'; ctx.fillText(dir, x0 + 11, y); y += 16; }
  if (more > 0) { ctx.fillStyle = '#9aa5b4'; ctx.font = `11px ${FONT}`; ctx.fillText(text(`qmore${more}`, () => `and ${more} more (${keyLabel('journal')})`), x0 + 11, y - 1); }
}

/** Which way, and how far, from soldier me to tile `place` ('↘ 120 east, 40 down'). */
function wayTo(me, place) {
  const dx = Math.round(place.x - me.x / TILE), dy = Math.round(place.y - me.y / TILE);
  const arrow = Math.abs(dx) < 3 && Math.abs(dy) < 3 ? '●' : ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'][((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8];
  const parts = [];
  if (Math.abs(dx) >= 3) parts.push(`${Math.abs(dx)} ${dx < 0 ? 'west' : 'east'}`);
  if (Math.abs(dy) >= 3) parts.push(`${Math.abs(dy)} ${dy < 0 ? 'up' : 'down'}`);
  return text(`way${dx}|${dy}`, () => `${arrow} ${parts.length ? parts.join(', ') : 'here'}`);
}

/**
 * Where the followed quest's goal is: a pulsing mark on the spot when it's on the screen, else an
 * arrow at the edge of the screen pointing that way.
 */
function drawQuestPointer(r, ctx, game, me, W, H) {
  const qs = me.world.quests, q = qs.list.find(x => x.id === qs.track) || qs.list.at(-1);
  if (!q) return;
  let place = null;
  for (const g of q.goals) if ((place = goalPlace(me, g))) break;
  if (questReady(me, q)) { const to = turnInTo(q); place = to ? { x: to.x, y: to.y } : null; }
  if (place) pointAt(r, ctx, game, place, W, H, '#ffe36e');
}

/** Asleep in a bed (sleep.js): the screen darkens, Zs rise, and online, how many are asleep. */
function drawSleep(ctx, game, me, W, H) {
  const w = me.world, now = performance.now();
  if (w.sleepSeen == null) w.sleepSeen = now;
  const t = (now - w.sleepSeen) / 1000, k = Math.min(1, t / 1.2);
  ctx.save();
  ctx.setTransform?.(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = `rgba(4,6,16,${(0.72 * k).toFixed(3)})`;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // (Zs drifting up, one after another.)
  for (let i = 0; i < 3; i++) {
    const p = (t * 0.45 + i / 3) % 1;
    ctx.globalAlpha = k * Math.sin(p * Math.PI);
    ctx.fillStyle = '#e8ecff';
    ctx.font = `bold ${Math.round(22 + p * 20)}px ${FONT}`;
    ctx.fillText('Z', W / 2 + 30 + p * 40 + i * 6, H / 2 - 40 - p * 70);
  }
  ctx.globalAlpha = k;
  ctx.fillStyle = '#e8ecff';
  ctx.font = `bold 20px ${FONT}`;
  ctx.fillText('Sleeping...', W / 2, H / 2 + 10);
  const n = w.sleep.n ?? game.world?.asleep?.n, of = w.sleep.of ?? game.world?.asleep?.of;
  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = '#b8c0dc';
  ctx.fillText(of > 1 ? `${n} of ${of} asleep: when everyone is, the night goes by · move to get up` : 'Move to get up', W / 2, H / 2 + 36);
  ctx.restore();
}

/** Your nearest grave (worldplay.js's bury): a pale arrow to it, and its name over it. */
function drawGravePointer(r, ctx, game, me, W, H) {
  let best = null, bd = Infinity;
  for (const [tx, ty] of me.world.graves) {
    const d = Math.hypot((tx + 0.5) * TILE - me.x, (ty + 0.5) * TILE - me.y);
    if (d < bd) { bd = d; best = { x: tx, y: ty }; }
  }
  if (!best || bd < 20) return;
  pointAt(r, ctx, game, best, W, H, '#cfd6e0', `Your grave · ${Math.round(bd / TILE)} m`);
}

/**
 * A pointer to a place (a tile): on screen, a pulsing diamond on it; off it, an arrow at the
 * screen's edge pointing that way. label: said beside it.
 */
function pointAt(r, ctx, game, place, W, H, color, label = null) {
  const k = r.scale, sx = W / 2 + ((place.x + 0.5) * TILE - r.cam.x) * k, sy = H / 2 + ((place.y + 0.5) * TILE - r.cam.y) * k;
  const pulse = 0.5 + 0.5 * Math.sin(game.tick * 0.12);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  const say = (x, y) => {
    if (!label) return;
    ctx.font = `bold 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width + 10, lx = Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, x));
    ctx.fillStyle = 'rgba(16,18,24,0.72)';
    ctx.fillRect(lx - w / 2, y - 8, w, 16);
    ctx.fillStyle = color;
    ctx.fillText(label, lx, y + 0.5);
  };
  if (sx > 20 && sx < W - 20 && sy > 20 && sy < H - 20) {
    ctx.globalAlpha = 0.6 + 0.4 * pulse;
    ctx.lineWidth = 2;
    const s = 8 + pulse * 3;
    ctx.beginPath(); ctx.moveTo(sx, sy - s); ctx.lineTo(sx + s, sy); ctx.lineTo(sx, sy + s); ctx.lineTo(sx - s, sy); ctx.closePath(); ctx.stroke();
    ctx.globalAlpha = 1;
    say(sx, sy - 22);
    return;
  }
  // (At the edge: inset from it, pointing out.)
  const a = Math.atan2(sy - H / 2, sx - W / 2), m = 40;
  const t = Math.min(Math.abs((W / 2 - m) / Math.cos(a) || 1e9), Math.abs((H / 2 - m) / Math.sin(a) || 1e9));
  const ex = W / 2 + Math.cos(a) * t, ey = H / 2 + Math.sin(a) * t;
  ctx.save();
  ctx.translate(ex, ey);
  ctx.rotate(a);
  ctx.globalAlpha = 0.75 + 0.25 * pulse;
  ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-6, -9); ctx.lineTo(-2, 0); ctx.lineTo(-6, 9); ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
  say(ex - Math.cos(a) * 26, ey - Math.sin(a) * 26);
}

/** Over the townsfolk with something for you: a gold ! (work) or ? (a quest to hand in). */
function drawMarks(r, ctx, game, me, W, H) {
  const k = r.scale;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 16px ${FONT}`;
  for (const [id, mark] of me.world.marks) {
    const o = game.soldiers.find(s => s.id === id);
    if (!o?.alive) continue;
    // (Over their name tag.)
    const sx = W / 2 + (o.x - r.cam.x) * k, sy = H / 2 + (o.y - 46 - r.cam.y) * k - 12;
    if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
    const bob = Math.sin(game.tick * 0.1 + id) * 2;
    ctx.fillStyle = 'rgba(16,18,24,0.75)';
    ctx.beginPath(); ctx.arc(sx, sy + bob, 10, 0, Math.PI * 2); ctx.fill();
    const col = mark === '?' ? '#7ee07a' : mark === '★' ? '#d08cff' : '#f2c230';
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = mark === '?' ? '#7ee07a' : mark === '★' ? '#e2b8ff' : '#ffe36e';
    ctx.fillText(mark, sx, sy + bob + 1);
  }
}

/** Your party (social.js): each of the others, their level and health, top right. */
function drawParty(ctx, me, W) {
  const list = me.world.partyList, x0 = W - 182;
  let y = 56;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(16,18,24,0.66)';
  ctx.fillRect(x0, y, 170, 18 + list.length * 26);
  ctx.font = `bold 11px ${FONT}`;
  ctx.fillStyle = '#5ad1ff';
  ctx.fillText('Party', x0 + 8, y + 10);
  y += 20;
  for (const p of list) {
    ctx.font = `bold 12px ${FONT}`;
    ctx.fillStyle = p.alive ? '#eef2f7' : '#9aa5b4';
    ctx.fillText(text(`pt${p.name}${p.level}`, () => `${p.name}  ·  ${p.level}`), x0 + 8, y + 5);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(x0 + 8, y + 13, 154, 5);
    ctx.fillStyle = p.health / p.max > 0.4 ? '#5ad16a' : '#e05a4a';
    ctx.fillRect(x0 + 8, y + 13, 154 * Math.max(0, Math.min(1, p.health / p.max)), 5);
    y += 26;
  }
}

/** A raid on the town you're near (raids.js): said at the top, with how many are left. */
function drawRaid(ctx, game, me, W) {
  const r = me.world.raidInfo, pulse = 0.5 + 0.5 * Math.sin(game.tick * 0.15);
  const line = text(`raid${r.name}${r.left}`, () => `Raid on ${r.name}!  ${r.left} of ${r.total} left`);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 15px ${FONT}`;
  const w = ctx.measureText(line).width + 30;
  ctx.fillStyle = `rgba(120,16,12,${0.7 + 0.2 * pulse})`;
  ctx.fillRect(W / 2 - w / 2, 50, w, 26);
  ctx.fillStyle = '#fff';
  ctx.fillText(line, W / 2, 63);
}

/** Pointing at one of the townsfolk (talk.js): how to talk to them, over the hotbar. */
function drawTalkHint(ctx, game, me, W, H) {
  const t = me.world.target;
  if (!t || me.world.talk) return;
  const npc = folkAt(game, me, t.x, t.y);
  if (!npc) return;
  const line = text(`talk${npc.id}${npc.name}`, () => `${keyLabel('aim')}: talk to ${npc.name}`);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 14px ${FONT}`;
  const w = ctx.measureText(line).width + 28, y = H - (HOT_SIZE + 10) * hotScale(W) - 34;
  ctx.fillStyle = 'rgba(255,255,255,0.86)';
  ctx.fillRect(W / 2 - w / 2, y - 13, w, 26);
  ctx.fillStyle = '#333';
  ctx.fillText(line, W / 2, y + 1);
}

/** Dev mode's card (devmode.js): what it's set to, and its keys. */
/** Looking through a scope (attachments.js): the edges darkened, and how far out the view is. */
function drawScope(ctx, sc, W, H) {
  const r = Math.min(W, H) * 0.55, g = ctx.createRadialGradient(W / 2, H / 2, r * 0.75, W / 2, H / 2, Math.hypot(W, H) / 2);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const text = `Scope · ${sc.blocks} block${sc.blocks === 1 ? '' : 's'} out, of ${sc.reach} · the mouse at the screen's edge looks further · let go of right click to come back`;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const tw = ctx.measureText(text).width;
  ctx.fillRect(W / 2 - tw / 2 - 8, H - 132, tw + 16, 22);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, W / 2, H - 116);
}

function drawDev(ctx, me, zoom) {
  const lines = devLines(me, zoom);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `12px ${FONT}`;
  let w = 0;
  for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.fillRect(8, 52, w + 20, lines.length * 17 + 10);
  for (let i = 0; i < lines.length; i++) {
    ctx.font = i === 0 ? `bold 12px ${FONT}` : `12px ${FONT}`;
    ctx.fillStyle = i === 0 ? '#333' : '#666';
    ctx.fillText(lines[i], 18, 66 + i * 17);
  }
}

/** The bar for what's in your hand (hud.js's status row, right side): [fill, kind, label], or null. */
export function heldBar(me) {
  const bar = leftBar(me), r = rightHand(me).item;
  if (!r) return bar;
  const n = me.world.inv.count(r.key);
  bar[2] = text(`h${bar[2]}|${r.key}|${n}`, () => `${bar[2]}  ·  right click: ${r.name}${r.kind === 'block' || r.kind === 'wall' ? ` ${n}` : ''}`);
  return bar;
}

/** The bar for what's in the left hand (left click). */
function leftBar(me) {
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
    const x = i * (HOT_SIZE + HOT_GAP), slot = w.inv.slots[i], it = slot && itemOf(slot.key), on = i === w.slot, r = i === w.slot2;
    ctx.fillStyle = on ? 'rgba(30,30,30,0.88)' : slot ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.4)';
    ctx.fillRect(x, 0, HOT_SIZE, HOT_SIZE);
    ctx.strokeStyle = on ? '#f2c230' : r ? '#4a9ae8' : slot ? '#333' : 'rgba(0,0,0,0.15)';
    ctx.lineWidth = on || r ? 2 : 1;
    ctx.strokeRect(x + (on || r ? 1 : 0.5), on || r ? 1 : 0.5, HOT_SIZE - (on || r ? 2 : 1), HOT_SIZE - (on || r ? 2 : 1));
    // (Which button uses it: L for left click, R for right.)
    if (on || r) {
      ctx.textAlign = 'center';
      ctx.font = `bold 9px ${FONT}`;
      for (const [hand, mark, col] of [[on, 'L', '#f2c230'], [r, 'R', '#4a9ae8']]) {
        if (!hand) continue;
        const mx = mark === 'L' ? x + HOT_SIZE - 9 : x + HOT_SIZE - (on ? 19 : 9);
        ctx.fillStyle = col; ctx.fillRect(mx - 5, -7, 10, 10);
        ctx.fillStyle = mark === 'L' ? '#222' : '#fff'; ctx.fillText(mark, mx, -2);
      }
    }
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

function drawGot(ctx, game, me, W, H) {
  const got = me.world.got;
  if (!got.length) return;
  ctx.textBaseline = 'middle';
  // (Over the map, on the right: the newest at the bottom, sliding in.)
  const right = W - 12, bottom = H - 30 - MAP_H * MAP_SCALE - 14;
  let row = 0;
  for (let i = got.length - 1; i >= 0 && row < 7; i--) {
    const g = got[i], age = game.tick - g.tick;
    if (age > GOT_LIFE) continue;
    const it = itemOf(g.key);
    if (!it) continue;
    // (Gear: its own name, in its rarity's colour.)
    const big = isPrecious(it, g.r), color = itemColor(it, g.r), have = g.r ? 0 : me.world.inv.count(g.key);
    const name = text(`gn${g.n}${g.key}${g.name || ''}`, () => (g.name ? g.name : `+${g.n}  ${it.name}`)), total = have > g.n ? text(`gt${have}`, () => `(${have})`) : '';
    ctx.font = `bold ${big ? 15 : 13}px ${FONT}`;
    const nw = ctx.measureText(name).width;
    ctx.font = `12px ${FONT}`;
    const tw = total ? ctx.measureText(total).width + 10 : 0;
    const h = big ? 30 : 26, w = 44 + nw + tw + 10;
    const slide = Math.max(0, 1 - age / 10), x = right - w + slide * 40, y = bottom - row * (h + 4) - h;
    ctx.globalAlpha = Math.min(1, (GOT_LIFE - age) / 40) * (1 - slide * 0.6);
    // A dark panel, a bar in the thing's colour, its picture, what and how many (and how many you have now).
    ctx.fillStyle = 'rgba(16,18,24,0.78)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 4, h);
    if (big && age < 30) { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); }
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(x + 9, y + 3, h - 6, h - 6);
    drawIcon(ctx, it, x + 11, y + 5, h - 10, false, true);
    ctx.textAlign = 'left';
    ctx.font = `bold ${big ? 15 : 13}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.fillText(name, x + 14 + h - 6, y + h / 2 + 1);
    if (total) {
      ctx.font = `12px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(total, x + 14 + h - 6 + nw + 10, y + h / 2 + 1);
    }
    row++;
  }
  ctx.globalAlpha = 1;
}

/**
 * The names of things lying on the ground: those near you (and the one under the crosshair), or
 * with the key held, everything on the screen. On dark labels in their colour, stacked so they
 * don't cover each other.
 */
const placed = [];
function drawDropNames(r, ctx, game, me, W, H, all) {
  const drops = game.world.drops, k = r.scale, cx = r.cam.x, cy = r.cam.y;
  const t = me.world?.target, near = 9 * TILE;
  const list = [];
  for (const d of drops) {
    if (d.n <= 0 || !d.rest) continue;
    const sx = W / 2 + (d.x - cx) * k, sy = H / 2 + (d.y - cy) * k;
    if (sx < -40 || sx > W + 40 || sy < -20 || sy > H + 20) continue;
    const pointed = t && Math.abs(t.x - d.x) < 10 && Math.abs(t.y - d.y) < 10;
    const dist = Math.hypot(d.x - me.x, d.y - me.y);
    if (!all && !pointed && dist > near) continue;
    list.push({ d, sx, sy, dist, pointed });
  }
  if (!list.length) return;
  list.sort((a, b) => a.dist - b.dist);
  list.length = Math.min(list.length, all ? 40 : 12);
  // (The nearest placed first; the rest go above them where they'd overlap.)
  placed.length = 0;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 12px ${FONT}`;
  for (const { d, sx, sy, pointed } of list) {
    const it = itemOf(d.key);
    if (!it) continue;
    // (Gear: its own name and its rarity's colour; online, only its rarity comes with it.)
    const rar = d.g?.r || d.r || null;
    const label = text(`dn${d.n}${d.key}${d.g?.name || rar || ''}`, () => (d.g ? d.g.name : rar ? `${RARITY[rar]?.name ?? ''} ${it.name}` : d.n > 1 ? `${it.name} × ${d.n}` : it.name));
    const w = ctx.measureText(label).width + 12, h = 17;
    let x = sx - w / 2, y = sy - 14 * Math.max(1, k * 0.5) - h;
    for (let tries = 0; tries < 8; tries++) {
      const hit = placed.find(p => x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + h > p.y);
      if (!hit) break;
      y = hit.y - h - 2;
    }
    placed.push({ x, y, w, h });
    const color = itemColor(it, rar);
    ctx.fillStyle = pointed ? 'rgba(40,44,56,0.92)' : 'rgba(16,18,24,0.74)';
    ctx.fillRect(x, y, w, h);
    if (pointed || isPrecious(it, rar)) { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
    ctx.fillStyle = color;
    ctx.fillText(label, sx, y + h / 2 + 1);
  }
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
  ctx.fillText(t.kind === 'capital' ? `${t.title}, the capital` : t.kind === 'city' ? 'a walled city' : 'a village', W / 2, 119);
  ctx.globalAlpha = 1;
}

// ---- The map of what's round you ------------------------------------------------------------------

const MAP_W = 120, MAP_H = 76;    // tiles shown
const MAP_SCALE = 1.5;            // screen pixels a tile
const mm = { canvas: null, g: null, img: null, at: -1e9, tx: NaN, ty: NaN, version: -1, world: null, colors: null };

/** Each block's colour on the map ([r, g, b]), and each wall's (darker). */
function mapColors() {
  const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  // (What grows in water: the water's colour, on the map.)
  const water = BLOCKS.find(b => b.key === 'water').color;
  return {
    blocks: BLOCKS.map(b => (b.id === AIR ? null : rgb(b.liquid && b.key !== 'lily_pad' ? water : b.ore || b.color))),
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
  // Who else is about: monsters red, mercenaries blue, townsfolk gold, other players white.
  for (const o of game.soldiers) {
    // (Not someone invisible: a world's dev mode.)
    if (!o.alive || o === me || o.hidden || o.world?.dev?.invisible) continue;
    const ox = Math.floor(o.x / TILE) - mm.tx + MAP_W / 2, oy = Math.floor(o.y / TILE) - mm.ty + MAP_H / 2;
    if (ox < 0 || ox >= MAP_W || oy < 0 || oy >= MAP_H) continue;
    const k = o.npc?.kind, mate = me.world?.partyList?.some(p => p.id === o.id);
    ctx.fillStyle = k === 'monster' ? '#ff3b2f' : k === 'merc' ? '#3d7ff0' : k === 'townsfolk' ? '#f2c230' : mate ? '#5ad1ff' : '#ffffff';
    ctx.fillRect(x0 + ox * MAP_SCALE - 1.5, y0 + oy * MAP_SCALE - 2, 3, 3);
  }
  // Your graves: a pale cross.
  for (const [gx, gy] of me.world?.graves || []) {
    const ox = gx - mm.tx + MAP_W / 2, oy = gy - mm.ty + MAP_H / 2;
    if (ox < 0 || ox >= MAP_W || oy < 0 || oy >= MAP_H) continue;
    ctx.fillStyle = '#cfd6e0';
    ctx.fillRect(x0 + ox * MAP_SCALE - 0.75, y0 + oy * MAP_SCALE - 3, 1.5, 6);
    ctx.fillRect(x0 + ox * MAP_SCALE - 2.25, y0 + oy * MAP_SCALE - 1.5, 4.5, 1.5);
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
