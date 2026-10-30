// Drawing the objective modes: hills, flags, capture points and M-COMs in the
// world, and how things stand at the top of the screen, with markers at the
// screen's edge pointing to objectives out of sight. Used by both renderers
// (only drawing calls the WebGL layer supports: no dashes or clipping).

import { objectivesOf, mcomZone } from './objectives.js';
import { lerp } from './util.js';
import { drawSprite } from './sprites.js';
import { sideOf, moneyOf, useHere, gearOf, canShop, SIDE_NAME, DEFUSE } from './defuse.js';
import { keyLabel, keyShort, slotAction } from './keys.js';

const TEAM = { 1: '#2f6fdb', 2: '#d33b2f' };
const TEAM_NAME = { 1: 'Blue', 2: 'Red' };
const NEUTRAL = '#8a8a8a';
const CONTESTED = '#e8a01c';
const INK = '#111';
const FONT = 'Arial, Helvetica, sans-serif';

const blink = (t, rate = 30) => Math.floor(t / rate) % 2 === 0;
const clock = ticks => { const s = Math.max(0, Math.ceil(ticks / 60)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Short dashes along a line (the WebGL layer has no dashed lines). */
function dashes(ctx, x0, y0, x1, y1, w, dash = 7, gap = 5) {
  const len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(len, d + dash);
    const ax = x0 + ux * d, ay = y0 + uy * d, bx = x0 + ux * e, by = y0 + uy * e;
    ctx.fillRect(Math.min(ax, bx) - (uy ? w / 2 : 0), Math.min(ay, by) - (ux ? w / 2 : 0), Math.abs(bx - ax) + (uy ? w : 0), Math.abs(by - ay) + (ux ? w : 0));
  }
}

/** An area (hill or capture point): a light fill and a dashed outline. */
function area(ctx, z, color, fill, line, w) {
  ctx.fillStyle = color;
  ctx.globalAlpha = fill;
  ctx.fillRect(z.left, z.top, z.right - z.left, z.bottom - z.top);
  ctx.globalAlpha = line;
  dashes(ctx, z.left, z.top, z.right, z.top, w);
  dashes(ctx, z.left, z.top, z.left, z.bottom, w);
  dashes(ctx, z.right, z.top, z.right, z.bottom, w);
  ctx.globalAlpha = 1;
}

/** A flag on a pole standing at (x, y): pole `h` tall, cloth raised `raise` (0-1) of the way up. */
function flag(ctx, x, y, color, t, { h = 40, raise = 1, dir = 1, w = 1 } = {}) {
  ctx.fillStyle = INK;
  ctx.fillRect(x - 0.7, y - h, 1.4, h);
  const top = y - h + (1 - raise) * (h - 12);
  const wave = Math.sin(t * 0.12 + x * 0.05) * 1.6;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + 0.7 * dir, top);
  ctx.quadraticCurveTo(x + 9 * dir, top + 1 + wave, x + 17 * dir, top + 5 + wave * 0.6);
  ctx.quadraticCurveTo(x + 9 * dir, top + 9 - wave, x + 0.7 * dir, top + 11);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = w * 0.7;
  ctx.stroke();
}

/** A letter in a circle (a capture point's label). */
function badge(ctx, x, y, r, text, color, fill = '#fff') {
  ctx.fillStyle = fill;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, r / 6);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = fill === '#fff' ? color : '#fff';
  ctx.font = `bold ${Math.round(r * 1.25)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + r * 0.08);
}

/** A thin progress bar centred at (x, y). */
function bar(ctx, x, y, w, frac, color) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x - w / 2, y, w, 3);
  ctx.fillStyle = color;
  ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, frac)), 3);
}

/** M-COMs of a sector get letters: A, B, ... */
function mcomLabels(mcoms) {
  const n = new Map();
  return mcoms.map(m => { const k = n.get(m.sector) || 0; n.set(m.sector, k + 1); return String.fromCharCode(65 + k); });
}

// ---- In the world ------------------------------------------------------------------------

/** Everything on the ground: drawn under the soldiers. */
export function drawObjectives(r, game) {
  const st = game.modeState;
  if (!st || !game.rules.objective) return;
  const ctx = r.ctx, t = game.tick, w = r.lineW || 1;
  ctx.textBaseline = 'middle';
  switch (game.mode) {
    case 'koth': {
      objectivesOf(game.map, 'hill').forEach((z, i) => {
        const active = i === st.hill;
        const color = !active ? '#b9b9b9' : st.count?.[1] && st.count?.[2] ? CONTESTED : TEAM[st.owner] || NEUTRAL;
        area(ctx, z, color, active ? 0.13 : 0.04, active ? 0.9 : 0.35, w * 1.4);
        if (!active) return;
        ctx.fillStyle = color;
        ctx.font = `bold 11px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('HILL', (z.left + z.right) / 2, z.top - 8);
      });
      break;
    }
    case 'conquest': {
      objectivesOf(game.map, 'point').forEach((z, i) => {
        const p = st.points?.[i];
        if (!p) return;
        const contested = p.c?.[0] && p.c?.[1];
        const color = contested && blink(t, 20) ? CONTESTED : TEAM[p.own] || NEUTRAL;
        area(ctx, z, color, 0.1, 0.8, w * 1.3);
        const x = (z.left + z.right) / 2, y = z.bottom;
        ctx.fillStyle = INK;
        ctx.fillRect(x - 6, y - 2, 12, 2);
        flag(ctx, x, y, p.v < 0 ? TEAM[1] : p.v > 0 ? TEAM[2] : '#ddd', t, { h: 50, raise: Math.max(0.04, Math.abs(p.v)), w });
        badge(ctx, x, y - 64, 8, z.label, TEAM[p.own] || NEUTRAL);
      });
      break;
    }
    case 'ctf': {
      const stands = objectivesOf(game.map, 'flag');
      for (const f of st.flags || []) {
        const stand = stands[f.team - 1];
        // The stand: a base, and the flag on it when it's home.
        ctx.fillStyle = INK;
        ctx.fillRect(stand.x - 10, stand.y - 3, 20, 3);
        ctx.fillStyle = TEAM[f.team];
        ctx.fillRect(stand.x - 8, stand.y - 2.4, 16, 1.8);
        if (f.home) flag(ctx, stand.x, stand.y - 3, TEAM[f.team], t, { h: 42, w });
        else {
          // An empty pole.
          ctx.globalAlpha = 0.35;
          flag(ctx, stand.x, stand.y - 3, '#fff', t, { h: 42, w });
          ctx.globalAlpha = 1;
        }
        if (!f.home && f.carrier < 0) {
          // Dropped: lying on the floor, with the time until it goes home.
          ctx.save();
          ctx.translate(f.x, f.y);
          ctx.rotate(-1.2);
          flag(ctx, 0, 0, TEAM[f.team], t, { h: 30, w });
          ctx.restore();
          ctx.fillStyle = TEAM[f.team];
          ctx.font = `bold 9px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.fillText(String(Math.ceil(f.timer / 60)), f.x, f.y - 36);
        }
      }
      break;
    }
    case 'rush': {
      const mcoms = objectivesOf(game.map, 'mcom'), labels = mcomLabels(mcoms);
      const sector = st.sectors?.[Math.min(st.sector, st.sectors.length - 1)];
      mcoms.forEach((m, i) => {
        const o = st.mcoms?.[i];
        if (o) drawMcom(ctx, m, o, t, labels[i], m.sector === sector, w);
      });
      break;
    }
    case 'defuse': drawDefuse(ctx, game, st, t, w, r.lights); break;
  }
  ctx.globalAlpha = 1;
}

const T_COLOR = '#d88a1a', CT_COLOR = '#3a6fb8';
const SIDE_COLOR = { T: T_COLOR, CT: CT_COLOR };

/**
 * Defuse: the bomb sites (a lettered area), and the bomb lying or planted somewhere.
 * (lights: Remastered's, where the bomb's light glows in the dark.)
 */
function drawDefuse(ctx, game, st, t, w, lights) {
  const b = st.bomb;
  for (const z of objectivesOf(game.map, 'site')) {
    const hot = b?.s === 'planted' && b.site === z.label;
    const color = hot ? (blink(t, 15) ? '#e0301e' : '#7a1410') : '#b07a2a';
    area(ctx, z, color, hot ? 0.12 : 0.06, hot ? 0.9 : 0.55, w * 1.3);
    // The letter, painted big on the wall behind the site.
    const x = (z.left + z.right) / 2, y = z.top + Math.min(46, (z.bottom - z.top) * 0.42);
    ctx.globalAlpha = hot ? 0.5 : 0.22;
    ctx.fillStyle = color;
    ctx.font = `bold 46px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(z.label, x, y);
    ctx.globalAlpha = 1;
    badge(ctx, z.left + 12, z.top - 10, 8, z.label, color);
  }
  if (!b) return;
  if (b.s === 'dropped') {
    ctx.save(); ctx.translate(b.x, b.y - 3); drawSprite(ctx, 'c4', { t }); ctx.restore();
    // (Glinting, so it's easy to find.)
    if (blink(t, 20)) { ctx.fillStyle = 'rgba(255,220,120,0.8)'; ctx.fillRect(b.x + 5, b.y - 9, 1.6, 1.6); }
    lights?.add(b.x, b.y - 4, 30, '#7fd36a', 0.35);
  } else if (b.s === 'planted' || b.s === 'defused') {
    // (A red light blinking on it, quicker as time runs out.)
    const on = blink(t, b.fuse > 600 ? 30 : b.fuse > 300 ? 15 : 6);
    if (b.s === 'planted' && on) {
      ctx.fillStyle = 'rgba(255,60,40,0.35)';
      ctx.beginPath(); ctx.arc(b.x, b.y - 5, 9, 0, Math.PI * 2); ctx.fill();
    }
    if (b.s === 'planted') lights?.add(b.x, b.y - 5, on ? 70 : 34, '#ff3a26', on ? 0.9 : 0.35);
    ctx.save(); ctx.translate(b.x, b.y - 4); ctx.scale(1.3, 1.3); drawSprite(ctx, 'c4', { t, armed: b.s === 'planted' }); ctx.restore();
    if (b.s === 'planted' && b.defuse > 0) bar(ctx, b.x, b.y - 22, 34, b.defuse, CT_COLOR);
  }
}

/** Defuse: the bomb on its carrier's back, and how far they are with planting it. */
function drawCarriedBomb(r, game) {
  const b = game.modeState?.bomb;
  if (!b || b.s !== 'carried') return;
  const s = game.soldiers.find(o => o.id === b.by);
  if (!s || !s.alive) return;
  const ctx = r.ctx, a = r.alpha ?? 1;
  const x = lerp(s.prevX, s.x, a) + (s.drawDX || 0), y = lerp(s.prevY, s.y, a) + (s.drawDY || 0);
  if (s.current !== 'C4') {
    ctx.save(); ctx.translate(x - s.facing * 6, y - 9); ctx.scale(0.75, 0.75); drawSprite(ctx, 'c4', { t: game.tick }); ctx.restore();
  }
  if (b.plant > 0) bar(ctx, x, y - 44, 34, b.plant, T_COLOR);
}

function drawMcom(ctx, m, o, t, label, current, w) {
  const x = m.x, y = m.y;
  if (o.s === 2) {
    // Rubble.
    ctx.fillStyle = '#444';
    for (const [dx, dy, s] of [[-9, -3, 5], [-3, -5, 6], [4, -3, 5], [8, -2, 3], [0, -8, 3]]) ctx.fillRect(x + dx, y + dy, s, s - 1);
    return;
  }
  ctx.globalAlpha = current ? 1 : 0.3;
  ctx.fillStyle = INK;
  ctx.fillRect(x - 9, y - 25, 18, 25);
  ctx.fillStyle = '#6a7079';
  ctx.fillRect(x - 8, y - 24, 16, 23);
  const armed = o.s === 1;
  ctx.fillStyle = armed ? (blink(t, 10) ? '#ff3b30' : '#7a1410') : '#9fd39b';
  ctx.fillRect(x - 5.5, y - 21, 11, 7);
  ctx.fillStyle = '#3d4249';
  ctx.fillRect(x - 5.5, y - 11, 11, 2);
  ctx.fillRect(x - 5.5, y - 7, 11, 2);
  ctx.fillStyle = INK;
  ctx.fillRect(x + 5, y - 33, 1.2, 8);
  ctx.fillStyle = armed && blink(t, 10) ? '#ff3b30' : '#555';
  ctx.beginPath(); ctx.arc(x + 5.6, y - 34, 1.8, 0, Math.PI * 2); ctx.fill();
  if (current) {
    badge(ctx, x - 4, y - 42, 7, label, armed ? TEAM[2] : '#555');
    if (armed) {
      ctx.fillStyle = TEAM[2];
      ctx.font = `bold 9px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(clock(o.fuse), x + 6, y - 42);
    }
    if (o.p > 0) bar(ctx, x, y - 56, 34, o.p, armed ? TEAM[2] : TEAM[1]);
  }
  ctx.globalAlpha = 1;
}

/** Flags being carried: on their carriers' backs (drawn over the soldiers); Defuse's bomb too. */
export function drawCarried(r, game) {
  const st = game.modeState;
  if (game.mode === 'defuse') { drawCarriedBomb(r, game); return; }
  if (game.mode !== 'ctf' || !st?.flags) return;
  const ctx = r.ctx, a = r.alpha ?? 1;
  for (const f of st.flags) {
    if (f.carrier < 0) continue;
    const s = game.soldiers.find(o => o.id === f.carrier);
    if (!s || !s.alive) continue;
    const x = lerp(s.prevX, s.x, a) + (s.drawDX || 0), y = lerp(s.prevY, s.y, a) + (s.drawDY || 0);
    flag(ctx, x - s.facing * 4, y + 4, TEAM[f.team], game.tick, { h: 40, dir: -s.facing, w: r.lineW || 1 });
  }
}

// ---- On the screen -------------------------------------------------------------------------

/** How the match stands, at the top of the screen; and markers pointing to objectives off screen. */
export function drawObjectiveHud(r, ctx, game, me, W, H) {
  const st = game.modeState;
  if (!st) return;
  const t = game.tick;
  ctx.textBaseline = 'middle';
  const scores = (mid, left = `Blue ${game.teamScore[1]}`, right = `Red ${game.teamScore[2]}`) => {
    ctx.font = `bold 14px ${FONT}`;
    const half = ctx.measureText(mid).width / 2 + 14;
    ctx.textAlign = 'right';
    ctx.fillStyle = TEAM[1];
    ctx.fillText(left, W / 2 - half, 16);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#999';
    ctx.fillText(mid, W / 2, 16);
    ctx.textAlign = 'left';
    ctx.fillStyle = TEAM[2];
    ctx.fillText(right, W / 2 + half, 16);
  };
  const line = (parts, y = 36) => {
    // [text, colour] pieces, centred together.
    ctx.font = `12px ${FONT}`;
    const widths = parts.map(([s]) => ctx.measureText(s).width);
    let x = W / 2 - widths.reduce((a, b) => a + b, 0) / 2;
    ctx.textAlign = 'left';
    parts.forEach(([s, c], i) => { ctx.fillStyle = c; ctx.fillText(s, x, y); x += widths[i]; });
  };
  const goal = game.fragLimit > 0 ? game.fragLimit : game.rules.goal?.value;
  const marks = [];

  switch (game.mode) {
    case 'koth': {
      scores(`/ ${goal}`);
      const hills = objectivesOf(game.map, 'hill'), z = hills[st.hill];
      const contested = st.count?.[1] && st.count?.[2];
      const parts = [contested ? ['The hill is contested!', CONTESTED] : st.owner ? [`${TEAM_NAME[st.owner]} holds the hill`, TEAM[st.owner]] : ['Nobody holds the hill', '#777']];
      if (hills.length > 1) parts.push([`  ·  moves in ${clock(st.moves)}`, '#888']);
      line(parts);
      if (z) marks.push({ x: (z.left + z.right) / 2, y: z.bottom - 30, label: 'H', color: contested ? CONTESTED : TEAM[st.owner] || NEUTRAL });
      break;
    }
    case 'ctf': {
      scores(`/ ${goal}`);
      const parts = [];
      for (const f of st.flags || []) {
        const c = f.carrier >= 0 ? game.soldiers.find(s => s.id === f.carrier) : null;
        const where = f.home ? 'at base' : c ? (c === me ? 'carried by you!' : `carried by ${c.name}`) : `dropped (${Math.ceil(f.timer / 60)})`;
        if (parts.length) parts.push(['   ·   ', '#999']);
        parts.push([`${TEAM_NAME[f.team]} flag: ${where}`, TEAM[f.team]]);
        if (!f.home && c !== me) marks.push({ x: f.x, y: f.y - 20, label: 'F', color: TEAM[f.team] });
        else if (f.team !== me.team) marks.push({ x: f.x, y: f.y - 20, label: 'F', color: TEAM[f.team] });
      }
      line(parts);
      if (st.flags?.some(f => f.carrier === me.id)) {
        ctx.font = `bold 15px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = TEAM[me.team];
        ctx.fillText(st.flags[me.team - 1]?.home ? 'You have the flag! Take it to your base' : 'You have the flag! Your own flag must be home to score', W / 2, 58);
        const home = objectivesOf(game.map, 'flag')[me.team - 1];
        marks.push({ x: home.x, y: home.y - 20, label: 'B', color: TEAM[me.team] });
      }
      break;
    }
    case 'conquest': {
      scores('tickets', `Blue ${game.teamScore[1]}`, `Red ${game.teamScore[2]}`);
      const pts = objectivesOf(game.map, 'point');
      const size = 22, gap = 6, total = pts.length * size + (pts.length - 1) * gap;
      pts.forEach((z, i) => {
        const p = st.points?.[i];
        if (!p) return;
        const x = W / 2 - total / 2 + i * (size + gap), y = 30;
        // The box fills with the colour of whoever is winning it.
        ctx.fillStyle = '#fff';
        ctx.fillRect(x, y, size, size);
        const k = Math.abs(p.v);
        ctx.fillStyle = p.v < 0 ? TEAM[1] : TEAM[2];
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x, y + size * (1 - k), size, size * k);
        ctx.globalAlpha = 1;
        const contested = p.c?.[0] && p.c?.[1];
        ctx.strokeStyle = contested && blink(t, 20) ? CONTESTED : TEAM[p.own] || '#666';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, size, size);
        ctx.font = `bold 12px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = k > 0.55 ? '#fff' : '#333';
        ctx.fillText(z.label, x + size / 2, y + size / 2 + 1);
        marks.push({ x: (z.left + z.right) / 2, y: z.bottom - 30, label: z.label, color: TEAM[p.own] || NEUTRAL });
      });
      // Capturing where you stand.
      const here = pts.findIndex(z => me.alive && me.x >= z.left && me.x <= z.right && me.y >= z.top && me.y <= z.bottom + 4);
      if (here >= 0) {
        const p = st.points[here];
        const mine = me.team === 1 ? -p.v : p.v;
        const text = p.own === me.team && mine > 0.99 ? `${pts[here].label} is ours` : p.c?.[0] && p.c?.[1] ? `Fighting for ${pts[here].label}` : `Capturing ${pts[here].label}`;
        progress(ctx, W, H, text, (mine + 1) / 2, TEAM[me.team]);
      }
      break;
    }
    case 'rush': {
      const sectors = st.sectors || [];
      scores(`Sector ${Math.min(st.sector + 1, sectors.length)} of ${sectors.length}`, `Attack ${game.teamScore[1]}`, 'Defend');
      const mcoms = objectivesOf(game.map, 'mcom'), labels = mcomLabels(mcoms);
      const sector = sectors[Math.min(st.sector, sectors.length - 1)];
      const parts = [];
      mcoms.forEach((m, i) => {
        const o = st.mcoms?.[i];
        if (!o || m.sector !== sector) return;
        if (parts.length) parts.push(['   ·   ', '#999']);
        parts.push(o.s === 2 ? [`${labels[i]}: destroyed`, '#999'] : o.s === 1 ? [`${labels[i]}: ARMED ${clock(o.fuse)}`, TEAM[2]] : [`${labels[i]}: standing`, '#555']);
        if (o.s !== 2) marks.push({ x: m.x, y: m.y - 30, label: labels[i], color: o.s === 1 ? TEAM[2] : '#555' });
        if (o.s !== 2 && me.alive && Math.abs(me.x - m.x) <= 26 && me.y >= m.y - 64 && me.y <= m.y + 4 && o.p > 0) {
          progress(ctx, W, H, o.s === 1 ? `Disarming ${labels[i]}` : `Arming ${labels[i]}`, o.p, o.s === 1 ? TEAM[2] : TEAM[1]);
        }
      });
      line(parts);
      if (me.team === 1 && game.teamScore[1] <= 0 && !game.over) {
        ctx.font = `bold 14px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = TEAM[2];
        ctx.fillText('Out of tickets!', W / 2, 58);
      }
      break;
    }
    case 'defuse': drawDefuseHud(ctx, game, me, W, H, marks); break;
  }
  const placed = [];
  for (const m of marks) edgeMarker(ctx, r, m, W, H, placed);
}

/**
 * Defuse at the top of the screen, as Counter-Strike has it: each team's rounds and
 * side, the round's clock in the middle (a blinking bomb once it's planted), who's
 * still alive; then the result when the round's over, and what you can do (plant,
 * defuse, buy).
 */
function drawDefuseHud(ctx, game, me, W, H, marks) {
  const st = game.modeState, b = st.bomb, t = game.tick;
  const clockText = st.phase === 'freeze' || st.phase === 'live' ? clock(st.timer) : '–';
  const planted = b?.s === 'planted';
  // Middle: the clock (or the bomb).
  const cx = W / 2;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillRect(cx - 44, 4, 88, 30);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - 44, 4, 88, 30);
  if (planted) {
    ctx.save(); ctx.translate(cx - 18, 19); ctx.scale(1.6, 1.6); drawSprite(ctx, 'c4', { t, armed: true }); ctx.restore();
    ctx.font = `bold 13px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = blink(t, 20) ? '#d22' : '#7a1410';
    ctx.fillText(b.site || '', cx + 2, 19);
  } else {
    ctx.font = `bold 18px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = st.phase === 'freeze' ? '#b07a00' : st.phase === 'live' && st.timer < 10 * 60 ? '#c22' : '#222';
    ctx.fillText(clockText, cx, 19);
  }
  // Each side: [score][T/CT] with the team's colour, alive pips under it.
  const block = (team, dir) => {
    const side = sideOf(game, team);
    const x = cx + dir * 52;
    ctx.textAlign = dir < 0 ? 'right' : 'left';
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillStyle = TEAM[team];
    ctx.fillText(String(game.teamScore[team]), x, 19);
    const sw = ctx.measureText(String(game.teamScore[team])).width;
    // The side tag.
    ctx.font = `bold 11px ${FONT}`;
    const label = side, lw = ctx.measureText(label).width + 10;
    const tx = dir < 0 ? x - sw - 8 - lw : x + sw + 8;
    ctx.fillStyle = SIDE_COLOR[side];
    ctx.fillRect(tx, 11, lw, 16);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(label, tx + lw / 2, 19.5);
    // Who's alive.
    const list = game.soldiers.filter(s => s.team === team && !s.spectating);
    const alive = list.filter(s => s.alive).length;
    if (list.length <= 10) {
      list.forEach((s, i) => {
        const px = dir < 0 ? x - 4 - i * 9 : x + 4 + i * 9;
        ctx.fillStyle = s.alive ? TEAM[team] : 'rgba(0,0,0,0.18)';
        ctx.fillRect(px - 3, 37, 6, 8);
      });
    } else {
      ctx.font = `11px ${FONT}`;
      ctx.textAlign = dir < 0 ? 'right' : 'left';
      ctx.fillStyle = TEAM[team];
      ctx.fillText(`${alive} of ${list.length} alive`, x, 41);
    }
  };
  block(1, -1);
  block(2, 1);
  // Under the clock: the round.
  ctx.font = `11px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#777';
  const need = (game.fragLimit > 0 ? game.fragLimit : 7) + 3 * (st.ot || 0);
  ctx.fillText(`Round ${Math.max(1, st.round)}${st.ot ? ` · overtime ${st.ot}` : ''} · first to ${need}`, cx, 56);

  // Bomb sites (off screen: a marker at the edge); the bomb when it's lying about, or planted.
  const mySide = sideOf(game, me.team);
  for (const z of objectivesOf(game.map, 'site')) {
    const hot = planted && b.site === z.label;
    marks.push({ x: (z.left + z.right) / 2, y: z.bottom - 40, label: z.label, color: hot ? '#d22' : '#b07a2a' });
  }
  if (b?.s === 'dropped' && mySide === 'T') marks.push({ x: b.x, y: b.y - 10, label: 'C4', color: T_COLOR });

  // The round's over: who won, and how.
  const r = st.result;
  if (st.phase === 'over' && r) {
    const y = H * 0.24;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(0, y - 30, W, 64);
    ctx.fillStyle = SIDE_COLOR[r.side];
    ctx.fillRect(0, y - 30, W, 3);
    ctx.fillRect(0, y + 31, W, 3);
    ctx.textAlign = 'center';
    ctx.font = `bold 24px ${FONT}`;
    ctx.fillStyle = SIDE_COLOR[r.side];
    const head = r.why === 'bomb' ? 'Terrorists win' : r.why === 'defused' || r.why === 'time' ? 'Counter-Terrorists win' : `${SIDE_NAME[r.side]} win`;
    ctx.fillText(`${head}${r.team === me.team ? '!' : ''}`, W / 2, y - 6);
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = '#444';
    const how = r.why === 'bomb' ? 'The bomb went off' : r.why === 'defused' ? 'The bomb was defused' : r.why === 'time' ? 'Time ran out: the targets were saved' : 'The other team was wiped out';
    ctx.fillText(`${how}  ·  ${TEAM_NAME[1]} ${game.teamScore[1]} – ${game.teamScore[2]} ${TEAM_NAME[2]}`, W / 2, y + 18);
    return;
  }
  if (!me.alive) return;
  // What you can do here.
  const here = useHere(game, me);
  if (b?.s === 'carried' && b.by === me.id) {
    if (b.plant > 0) progress(ctx, W, H, 'Planting the bomb…', b.plant, T_COLOR, H - 140);
    else if (here === 'plant') hint(ctx, W, H, `Hold ${keyLabel('use')} to plant the bomb`, T_COLOR);
    else if (st.phase === 'freeze' || (st.phase === 'live' && st.timer > DEFUSE.roundTime - 8 * 60)) hint(ctx, W, H, 'You have the bomb: take it to site A or B', T_COLOR, 0.75);
  } else if (planted && b.defuser === me.id) {
    progress(ctx, W, H, gearOf(game, me).kit ? 'Defusing (kit)…' : 'Defusing…', b.defuse, CT_COLOR, H - 140);
  } else if (here === 'defuse') {
    hint(ctx, W, H, `Hold ${keyLabel('use')} to defuse (${gearOf(game, me).kit ? '5 s with your kit' : '10 s'})`, CT_COLOR);
  } else if (st.phase === 'freeze' && canShop(game, me)) {
    hint(ctx, W, H, `Buy your weapons: press ${keyLabel('buy')}  (${SIDE_NAME[mySide]})`, SIDE_COLOR[mySide], 0.85);
  }
}

/** A prompt above the weapon bar (what a key does here). */
function hint(ctx, W, H, text, color, alpha = 1) {
  ctx.font = `bold 13px ${FONT}`;
  const w = ctx.measureText(text).width + 24, x = W / 2 - w / 2, y = H - 146;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillRect(x, y - 13, w, 26);
  ctx.fillStyle = color;
  ctx.fillRect(x, y - 13, 3, 26);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#222';
  ctx.fillText(text, W / 2, y + 1);
  ctx.globalAlpha = 1;
}

/**
 * Defuse: your money (and what you just earned), at the bottom left above the scores,
 * and a note when you can shop.
 */
export function drawMoney(ctx, game, me, W, H) {
  const st = game.modeState;
  if (!st) return;
  const x = 12, y = H - 76;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `bold 22px ${FONT}`;
  const text = `$${moneyOf(game, me).toLocaleString('en-US')}`;
  const tw = ctx.measureText(text).width;
  // What you just earned, next to it.
  const paid = st.paid?.[me.id], fresh = paid && game.tick - paid[1] < 150;
  const extra = fresh ? `+$${paid[0].toLocaleString('en-US')}` : '';
  ctx.font = `bold 14px ${FONT}`;
  const ew = extra ? ctx.measureText(extra).width + 8 : 0;
  // (On a panel, to read over any background.)
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillRect(x - 6, y - 15, tw + ew + 12, 30);
  ctx.fillStyle = '#1f7a2e';
  ctx.font = `bold 22px ${FONT}`;
  ctx.fillText(text, x, y);
  if (extra) {
    ctx.globalAlpha = Math.min(1, (150 - (game.tick - paid[1])) / 40);
    ctx.font = `bold 14px ${FONT}`;
    ctx.fillText(extra, x + tw + 8, y);
    ctx.globalAlpha = 1;
  }
  if (me.alive && canShop(game, me)) {
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = '#555';
    ctx.fillText(`B: buy  ·  ${Math.ceil(st.buy / 60)}s left`, x, y + 20);
  }
  const g = gearOf(game, me);
  if (me.alive && (g.helmet || g.kit)) {
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = '#666';
    ctx.fillText([g.helmet && 'Helmet', g.kit && 'Defuse kit'].filter(Boolean).join(' · '), x, y - 20);
  }
}

/** A progress bar above the weapon bar (capturing, arming). */
function progress(ctx, W, H, text, frac, color, y = H - 96) {
  const w = 220, x = W / 2 - w / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(x - 4, y - 18, w + 8, 30);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(x, y, w, 8);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), 8);
  ctx.font = `bold 12px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#222';
  ctx.fillText(text, W / 2, y - 8);
}

/** A marker at the edge of the screen pointing at something off it (moved along a bit if it would cover another). */
function edgeMarker(ctx, r, m, W, H, placed) {
  const sx = (m.x - r.cam.x) * r.scale + W / 2, sy = (m.y - r.cam.y) * r.scale + H / 2;
  // (Kept clear of the scores at the top and of your health, ammo and weapons at the bottom.)
  const pad = 22, top = 70, bottom = 190;
  if (sx > pad && sx < W - pad && sy > top && sy < H - bottom) return;
  const cx = W / 2, cy = (top + H - bottom) / 2, dx = sx - cx, dy = sy - cy;
  const k = Math.min(Math.abs((W / 2 - pad) / (dx || 1e-9)), Math.abs(((H - top - bottom) / 2) / (dy || 1e-9)), 1);
  let ex = cx + dx * k, ey = cy + dy * k;
  const side = Math.abs(ex - pad) < 1 || Math.abs(ex - (W - pad)) < 1; // on the left or right edge: move up/down
  for (let i = 0; i < 8 && placed.some(p => Math.hypot(p[0] - ex, p[1] - ey) < 22); i++) {
    if (side) ey += ey > cy ? -24 : 24; else ex += ex > cx ? -24 : 24;
  }
  placed.push([ex, ey]);
  const a = Math.atan2(dy, dx);
  ctx.save();
  ctx.translate(ex, ey);
  ctx.rotate(a);
  ctx.fillStyle = m.color;
  ctx.beginPath(); ctx.moveTo(19, 0); ctx.lineTo(11, -6); ctx.lineTo(11, 6); ctx.closePath(); ctx.fill();
  ctx.restore();
  badge(ctx, ex, ey, 10, m.label, m.color);
}

// ---- Minimap (big maps) ------------------------------------------------------------------

/** True for maps big enough to need a minimap. */
export const bigMap = map => map.bounds.right - map.bounds.left > 2600 || map.bounds.bottom - map.bounds.top > 1700;

/**
 * A small picture of the whole map at the top right: platforms, the objectives,
 * your team (dots), you, and what's on screen.
 */
// The minimap's blocks: drawn once into a picture (again when the map changes or
// the minimap's size does), not block by block every frame.
const mini = { map: null, key: null, canvas: null };

function drawMiniMapBlocks(r, ctx, map, x0, y0, w, h, k) {
  const d = r.dpr || 1, pw = Math.ceil(w * d), ph = Math.ceil(h * d);
  const key = `${map.version}|${pw}|${ph}|${k}`;
  // (No pictures to draw with: WebGL's drawing layer, or no page.)
  if (!ctx.drawImage || (typeof OffscreenCanvas === 'undefined' && typeof document === 'undefined')) {
    ctx.fillStyle = '#9a9a9a';
    for (const p of map.solids) ctx.fillRect(x0 + (p.l - map.bounds.left) * k, y0 + (p.t - map.bounds.top) * k, Math.max(1, (p.r - p.l) * k), Math.max(1, (p.b - p.t) * k));
    return;
  }
  if (mini.map !== map || mini.key !== key) {
    mini.map = map;
    mini.key = key;
    if (!mini.canvas || mini.canvas.width !== pw || mini.canvas.height !== ph) {
      mini.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(pw, ph) : Object.assign(document.createElement('canvas'), { width: pw, height: ph });
    }
    const g = mini.canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, pw, ph);
    g.setTransform(d, 0, 0, d, 0, 0);
    g.fillStyle = '#9a9a9a';
    const b = map.bounds;
    for (const p of map.solids) g.fillRect((p.l - b.left) * k, (p.t - b.top) * k, Math.max(1, (p.r - p.l) * k), Math.max(1, (p.b - p.t) * k));
  }
  ctx.drawImage(mini.canvas, x0, y0, pw / d, ph / d);
}

export function drawMinimap(r, ctx, game, me, W) {
  const b = game.map.bounds, mapW = b.right - b.left, mapH = b.bottom - b.top;
  let w = Math.min(300, W * 0.26), h = w * mapH / mapW;
  if (h > 150) { h = 150; w = h * mapW / mapH; }
  const x0 = W - 12 - w, y0 = 106, k = w / mapW;
  const X = x => x0 + (x - b.left) * k, Y = y => y0 + (y - b.top) * k;
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.fillRect(x0 - 3, y0 - 3, w + 6, h + 6);
  ctx.strokeStyle = '#999';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 - 3, y0 - 3, w + 6, h + 6);
  drawMiniMapBlocks(r, ctx, game.map, x0, y0, w, h, k);
  // Objectives.
  const st = game.modeState;
  if (st && game.rules.objective) {
    const dot = (x, y, color, label) => {
      ctx.fillStyle = color;
      ctx.fillRect(X(x) - 3, Y(y) - 3, 6, 6);
      if (label) {
        ctx.font = `bold 9px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, X(x), Y(y) - 3);
      }
    };
    if (game.mode === 'koth') {
      const z = objectivesOf(game.map, 'hill')[st.hill];
      if (z) { ctx.fillStyle = TEAM[st.owner] || '#777'; ctx.globalAlpha = 0.6; ctx.fillRect(X(z.left), Y(z.top), (z.right - z.left) * k + 1, (z.bottom - z.top) * k + 1); ctx.globalAlpha = 1; dot((z.left + z.right) / 2, z.bottom - 30, TEAM[st.owner] || '#777', 'H'); }
    } else if (game.mode === 'ctf') {
      for (const f of st.flags || []) dot(f.x, f.y - 20, TEAM[f.team], 'F');
    } else if (game.mode === 'conquest') {
      objectivesOf(game.map, 'point').forEach((z, i) => dot((z.left + z.right) / 2, z.bottom - 30, TEAM[st.points?.[i]?.own] || '#666', z.label));
    } else if (game.mode === 'defuse') {
      const bomb = st.bomb;
      for (const z of objectivesOf(game.map, 'site')) dot((z.left + z.right) / 2, z.bottom - 30, bomb?.s === 'planted' && bomb.site === z.label ? '#d22' : '#b07a2a', z.label);
      if (bomb && (bomb.s === 'planted' || (bomb.s === 'dropped' && sideOf(game, me.team) === 'T'))) dot(bomb.x, bomb.y - 6, '#d22', '');
    } else if (game.mode === 'rush') {
      const mcoms = objectivesOf(game.map, 'mcom'), labels = mcomLabels(mcoms);
      const sector = st.sectors?.[Math.min(st.sector, st.sectors.length - 1)];
      mcoms.forEach((m, i) => { const o = st.mcoms?.[i]; if (o && m.sector === sector && o.s !== 2) dot(m.x, m.y - 12, o.s === 1 ? TEAM[2] : '#444', labels[i]); });
    }
  }
  // Your team (in huge battles, some of them), then you.
  const mates = game.soldiers.filter(s => s.alive && s !== me && (!game.rules.teams || s.team === me.team) && game.rules.teams);
  const step = Math.max(1, Math.ceil(mates.length / 300));
  ctx.fillStyle = TEAM[me.team] || '#555';
  for (let i = 0; i < mates.length; i += step) ctx.fillRect(X(mates[i].x) - 1, Y(mates[i].y - 10) - 1, 2, 2);
  if (me.alive) {
    ctx.fillStyle = '#111';
    ctx.fillRect(X(me.x) - 2.5, Y(me.y - 10) - 2.5, 5, 5);
  }
  // What's on screen.
  const hw = r.w / 2 / r.scale, hh = r.h / 2 / r.scale;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.strokeRect(X(r.cam.x - hw), Y(r.cam.y - hh), hw * 2 * k, hh * 2 * k);
  ctx.textBaseline = 'middle';
}

/** While waiting to respawn (conquest, spawn beacons): where you'll spawn, and the number keys to change it. */
export function drawDeploy(ctx, game, me, W, y) {
  // (Conquest's points, and spawn beacons with classes on.)
  const opts = game.deployOptions(me);
  if (!opts) return;
  const chosen = opts.some(o => o.key === me.deployAt) ? me.deployAt : 'auto';
  const st = game.modeState, pts = objectivesOf(game.map, 'point');
  // (Wider boxes for longer names: spawn beacons.)
  ctx.font = `bold 12px ${FONT}`;
  const w = Math.max(58, ...opts.map((o, i) => ctx.measureText(`${keyShort(slotAction(i))}  ${o.label}`).width + 14));
  const gap = 8, total = opts.length * w + (opts.length - 1) * gap;
  ctx.font = `12px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#555';
  ctx.fillText('Spawn at (press its key):', W / 2, y);
  opts.forEach((o, i) => {
    const x = W / 2 - total / 2 + i * (w + gap), by = y + 12;
    const on = o.key === chosen;
    ctx.fillStyle = on ? TEAM[me.team] : 'rgba(255,255,255,0.9)';
    ctx.fillRect(x, by, w, 26);
    ctx.strokeStyle = on ? TEAM[me.team] : '#888';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, by, w, 26);
    ctx.fillStyle = on ? '#fff' : '#333';
    ctx.font = `bold 12px ${FONT}`;
    ctx.fillText(`${keyShort(slotAction(i))}  ${o.label}`, x + w / 2, by + 13);
    // A point under attack: say so.
    const k = pts.findIndex(z => z.label === o.key);
    if (k >= 0 && st?.points?.[k]?.c?.[other(me.team) - 1]) {
      ctx.fillStyle = CONTESTED;
      ctx.font = `10px ${FONT}`;
      ctx.fillText('under attack', x + w / 2, by + 36);
    }
  });
}

const other = t => (t === 1 ? 2 : 1);
