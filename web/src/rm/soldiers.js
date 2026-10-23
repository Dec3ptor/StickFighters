// Remastered's stick soldiers: still stick figures, with thickness and shading,
// the far arm and leg darker than the near ones, a soft outline so they stand out
// from any background, a helmet in their team's colour (or their own colour in
// free-for-all), a vest when they have armour, a backpack or jetpack, and a
// shadow on the ground under them.

import { buildPose } from '../stickman.js';
import { lerp } from '../util.js';
import { drawWeapon, drawStreakFlame } from '../sprites.js';
import { css, mix, shade, rgb } from './color.js';

export const TEAM_COLORS = { 1: '#3d7ff0', 2: '#e8483a' };

// Free-for-all colours, by soldier id (each worked out once).
const ownColors = new Map();

/** A soldier's own colour in free-for-all (spread round the colour wheel by id). */
export function soldierColor(game, s) {
  if (game.rules.teams) return TEAM_COLORS[s.team] || '#9aa4b2';
  let c = ownColors.get(s.id);
  if (c === undefined) {
    const h = (s.id * 137.508) % 360;
    c = `hsl(${h.toFixed(0)},70%,55%)`;
    if (ownColors.size > 5000) ownColors.clear();
    ownColors.set(s.id, c);
  }
  return c;
}

// The darker shades of a team's colour (backpack, vest, helmet band), worked out once per colour.
const teamShades = new Map();
function shadesOf(team) {
  let t = teamShades.get(team);
  if (!t) {
    t = { pack: css(shade(team, 0.55)), vest: css(shade(team, 0.7)), band: css(shade(team, 0.65)) };
    if (teamShades.size > 5000) teamShades.clear();
    teamShades.set(team, t);
  }
  return t;
}

// Limb widths (world units), and which of buildPose's lines is which.
const W = { torso: 3.1, thigh: 2.9, shin: 2.5, upper: 2.5, fore: 2.2 };
const LINES = { torso: 0, frontThigh: 1, frontShin: 2, backThigh: 3, backShin: 4, backUpper: 5, backFore: 6, frontUpper: 7, frontFore: 8 };

const colorCache = new Map();
function inks(theme) {
  let c = colorCache.get(theme);
  if (!c) {
    const ink = rgb(theme.ink);
    const light = (ink[0] + ink[1] + ink[2]) / 3 > 128;
    c = {
      ink: css(ink),
      back: css(light ? shade(ink, 0.72) : mix(ink, theme.haze || '#888', 0.28)),
      hi: css(light ? '#ffffff' : shade(mix(ink, theme.rim || '#ffffff', 0.3), 1.6), 0.55),
      halo: css(theme.halo || '#ffffff', theme.haloAlpha ?? 0.3),
      shadow: 'rgba(0,0,0,0.32)',
    };
    colorCache.set(theme, c);
  }
  return c;
}

const line = (ctx, l) => { ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); };
// The lines down the near side that get a highlight.
const LIT = [LINES.torso, LINES.frontThigh, LINES.frontShin];

/** Shadows on the ground under the soldiers (drawn before any of them). */
export function drawShadows(r, game, list, alpha) {
  const ctx = r.ctx, map = game.map;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  for (const s of list) {
    const x = lerp(s.prevX, s.x, alpha) + (s.drawDX || 0), y = lerp(s.prevY, s.y, alpha) + (s.drawDY || 0);
    const hit = map.raycast(x, y + 6, x, y + 260);
    if (!hit || hit.ny >= 0) continue;
    const h = hit.y - (y + 12);
    const k = Math.max(0, 1 - h / 240);
    if (k <= 0.02) continue;
    ctx.globalAlpha = k;
    ctx.beginPath();
    ctx.ellipse(x, hit.y, 9 * (0.5 + 0.5 * k), 2.4 * (0.5 + 0.5 * k), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** One soldier, part way between the last two game updates. */
export function drawSoldier(r, game, s, alpha, theme) {
  const ctx = r.ctx, c = inks(theme);
  const x = lerp(s.prevX, s.x, alpha) + (s.drawDX || 0), y = lerp(s.prevY, s.y, alpha) + (s.drawDY || 0);
  const v = r.animated(s);
  const pose = buildPose(v);
  const L = pose.lines, facing = s.facing;
  const team = soldierColor(game, s), shades = shadesOf(team);

  if (s.body.rope) {
    ctx.strokeStyle = '#a4844f';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + pose.shoulder[0], y + pose.shoulder[1]); ctx.lineTo(s.body.rope.x, s.body.rope.y); ctx.stroke();
  }
  ctx.save();
  ctx.translate(x, y);
  if (s.spawnProtect > 0) ctx.globalAlpha = 0.4 + 0.35 * Math.abs(Math.sin(game.tick * 0.25));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // A Juggernaut: a pulsing orange glow round the whole figure, so everyone knows to run.
  const jugger = s.jugger > 0;
  if (jugger) drawJuggerGlow(ctx, L, pose.head, game.tick);

  // A soft outline round the whole figure, so it reads against any background (gold on a Juggernaut).
  const halo = jugger ? JUGGER_HALO : c.halo;
  ctx.strokeStyle = halo;
  ctx.lineWidth = W.torso + 2.2;
  ctx.beginPath();
  for (const l of L) line(ctx, l);
  ctx.stroke();
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(pose.head.x, pose.head.y, pose.head.r + 1.6, 0, Math.PI * 2); ctx.fill();

  // The far arm and leg, a little darker.
  ctx.strokeStyle = c.back;
  ctx.lineWidth = W.thigh;
  ctx.beginPath(); line(ctx, L[LINES.backThigh]); line(ctx, L[LINES.backShin]); ctx.stroke();
  ctx.lineWidth = W.upper;
  ctx.beginPath(); line(ctx, L[LINES.backUpper]); line(ctx, L[LINES.backFore]); ctx.stroke();

  // Backpack, or a jetpack (with its flame).
  const nx = L[0][0], ny = L[0][1];
  const bx = nx - facing * 3.4;
  if (s.body.hasJetpack) {
    ctx.fillStyle = '#4b525c';
    roundRect(ctx, bx - 2.2, ny + 1, 4.4, 9, 1.4);
    ctx.fill();
    ctx.fillStyle = '#8a929c';
    ctx.fillRect(bx - 2.2, ny + 1.5, 4.4, 1.2);
    if (s.body.jetting) {
      const len = 5 + Math.random() * 5;
      const g = ctx.createLinearGradient(bx, ny + 10, bx, ny + 10 + len);
      g.addColorStop(0, '#fff3c0'); g.addColorStop(0.4, '#ffb030'); g.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(bx - 2, ny + 10); ctx.lineTo(bx, ny + 10 + len); ctx.lineTo(bx + 2, ny + 10); ctx.fill();
    }
  } else {
    ctx.fillStyle = shades.pack;
    roundRect(ctx, bx - 1.9, ny + 1.5, 3.8, 6.5, 1.3);
    ctx.fill();
  }

  // The weapon, then the body over it.
  ctx.save();
  ctx.translate(pose.gun.x, pose.gun.y);
  let angle = pose.gun.angle;
  if ((pose.gun.def.kind === 'melee' || pose.gun.def.kind === 'build') && v.anim.swing > 0) angle -= Math.sin(v.anim.swing * Math.PI) * 1.7 * (Math.cos(angle) < 0 ? -1 : 1);
  ctx.rotate(angle);
  if (Math.cos(pose.gun.angle) < 0) ctx.scale(1, -1);
  drawWeapon(ctx, pose.gun.def, false);
  ctx.restore();

  ctx.strokeStyle = c.ink;
  ctx.lineWidth = W.torso;
  ctx.beginPath(); line(ctx, L[LINES.torso]); ctx.stroke();
  ctx.lineWidth = W.thigh;
  ctx.beginPath(); line(ctx, L[LINES.frontThigh]); ctx.stroke();
  ctx.lineWidth = W.shin;
  ctx.beginPath(); line(ctx, L[LINES.frontShin]); ctx.stroke();

  // Armour: a vest over the chest.
  if (s.armour > 0) {
    const [x0, y0, x1, y1] = L[LINES.torso];
    ctx.strokeStyle = shades.vest;
    ctx.lineWidth = W.torso + 1.6;
    ctx.beginPath(); ctx.moveTo(x0 + (x1 - x0) * 0.15, y0 + (y1 - y0) * 0.15); ctx.lineTo(x0 + (x1 - x0) * 0.62, y0 + (y1 - y0) * 0.62); ctx.stroke();
  }

  // A highlight down the near side of the body and leg.
  ctx.strokeStyle = c.hi;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (const k of LIT) {
    const l = L[k];
    ctx.moveTo(l[0] - 0.7, l[1] - 0.4); ctx.lineTo(l[2] - 0.7, l[3] - 0.4);
  }
  ctx.stroke();

  // Head, helmet, and the visor showing which way they face.
  const h = pose.head;
  ctx.fillStyle = c.ink;
  ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = team;
  ctx.beginPath(); ctx.arc(h.x, h.y - 0.3, h.r + 0.7, Math.PI * 1.02, Math.PI * 1.98); ctx.closePath(); ctx.fill();
  ctx.fillStyle = shades.band;
  ctx.fillRect(h.x - h.r - 0.9, h.y - 0.6, h.r * 2 + 1.8, 1.1);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath(); ctx.arc(h.x - facing * 1.2, h.y - h.r * 0.55, 1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#bfe8ff';
  ctx.fillRect(h.x + (facing > 0 ? 0.6 : -3.2), h.y + 0.6, 2.6, 1.1);

  // The near arm, over the weapon.
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = W.upper;
  ctx.beginPath(); line(ctx, L[LINES.frontUpper]); ctx.stroke();
  ctx.lineWidth = W.fore;
  ctx.beginPath(); line(ctx, L[LINES.frontFore]); ctx.stroke();
  ctx.restore();
}

const JUGGER_HALO = 'rgba(255,200,110,0.9)';

/** A Juggernaut's glow: wide soft orange strokes round its limbs and head, added onto the picture, pulsing. */
function drawJuggerGlow(ctx, L, head, tick) {
  const pulse = 0.5 + 0.5 * Math.sin(tick * 0.2), base = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = ctx.fillStyle = '#ff7a1a';
  for (let i = 0; i < 2; i++) {
    const w = i ? 7 + pulse * 2 : 12 + pulse * 4, a = i ? 0.32 + 0.18 * pulse : 0.16 + 0.1 * pulse;
    ctx.globalAlpha = base * a;
    ctx.lineWidth = w;
    ctx.beginPath();
    for (const l of L) line(ctx, l);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(head.x, head.y, head.r + w / 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = base;
  ctx.globalCompositeOperation = 'source-over';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// How wide each text is in each font (measured once: the same names every frame).
const widths = new Map(); // font -> text -> width
function widthOf(ctx, font, text) {
  let byText = widths.get(font);
  if (!byText) widths.set(font, byText = new Map());
  let w = byText.get(text);
  if (w === undefined) {
    w = ctx.measureText(text).width;
    if (byText.size > 5000) byText.clear();
    byText.set(text, w);
  }
  return w;
}

/** A name tag (a small label in the soldier's colour) and their health under it. */
export function drawName(r, game, s, alpha, viewer) {
  const ctx = r.ctx;
  const x = lerp(s.prevX, s.x, alpha) + (s.drawDX || 0), y = lerp(s.prevY, s.y, alpha) + (s.drawDY || 0);
  const me = s === viewer, font = me ? NAME_FONT_ME : NAME_FONT;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = widthOf(ctx, font, s.name) + 6;
  const col = soldierColor(game, s);
  ctx.fillStyle = 'rgba(10,14,20,0.55)';
  roundRect(ctx, x - w / 2, y - 37, w, 9, 3);
  ctx.fill();
  ctx.fillStyle = col;
  ctx.fillRect(x - w / 2 + 2, y - 29.6, w - 4, 0.9);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(s.name, x, y - 32.4);
  // Kill streaks: a flame and the count beside the tag (3 or more in a row), and a Juggernaut's tag over it.
  if (s.streak >= 3) {
    const big = s.streak >= 5, n = String(s.streak), font = big ? STREAK_FONT_BIG : STREAK_FONT;
    ctx.font = font;
    const bw = widthOf(ctx, font, n) + (big ? 10 : 8.6), bx = x + w / 2 + 1.2;
    ctx.fillStyle = big ? 'rgba(130,28,6,0.8)' : 'rgba(10,14,20,0.55)';
    roundRect(ctx, bx, y - 37, bw, 9, 3);
    ctx.fill();
    drawStreakFlame(ctx, bx + (big ? 3.6 : 3.2), y - 32.4, big);
    ctx.textAlign = 'left';
    ctx.fillStyle = big ? '#ffd23a' : '#ffb347';
    ctx.fillText(n, bx + (big ? 6.6 : 5.6), y - 32.3);
    ctx.textAlign = 'center';
  }
  if (s.jugger > 0) {
    ctx.font = JUGGER_FONT;
    const tw = widthOf(ctx, JUGGER_FONT, 'JUGGERNAUT') + 6;
    ctx.fillStyle = 'rgba(110,36,0,0.8)';
    roundRect(ctx, x - tw / 2, y - 44.5, tw, 6.8, 2.4);
    ctx.fill();
    ctx.fillStyle = '#ffae4a';
    ctx.fillText('JUGGERNAUT', x, y - 41);
  }
  if (!me && s.health < 100) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x - 9, y - 27.6, 18, 1.8);
    ctx.fillStyle = s.health > 40 ? '#7ee07a' : '#ff5a4a';
    ctx.fillRect(x - 9, y - 27.6, 18 * Math.max(0, s.health) / 100, 1.8);
  }
  ctx.textBaseline = 'alphabetic';
}

export const FONT = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const NAME_FONT = `600 7.5px ${FONT}`, NAME_FONT_ME = `700 7.5px ${FONT}`;
const STREAK_FONT = `700 6.5px ${FONT}`, STREAK_FONT_BIG = `700 7.5px ${FONT}`, JUGGER_FONT = `800 5.5px ${FONT}`;
