// Drawing the objective modes: hills, flags, capture points and M-COMs in the
// world, and how things stand at the top of the screen, with markers at the
// screen's edge pointing to objectives out of sight. Used by both renderers
// (only drawing calls the WebGL layer supports: no dashes or clipping).

import { objectivesOf, mcomZone } from './objectives.js';
import { lerp } from './util.js';

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
  }
  ctx.globalAlpha = 1;
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

/** Flags being carried: on their carriers' backs (drawn over the soldiers). */
export function drawCarried(r, game) {
  const st = game.modeState;
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
  }
  for (const m of marks) edgeMarker(ctx, r, m, W, H);
}

/** A progress bar above the weapon bar (capturing, arming). */
function progress(ctx, W, H, text, frac, color) {
  const w = 220, x = W / 2 - w / 2, y = H - 96;
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

/** A marker at the edge of the screen pointing at something off it. */
function edgeMarker(ctx, r, m, W, H) {
  const sx = (m.x - r.cam.x) * r.scale + W / 2, sy = (m.y - r.cam.y) * r.scale + H / 2;
  const pad = 22, top = 70, bottom = 80;
  if (sx > pad && sx < W - pad && sy > top && sy < H - bottom) return;
  const cx = W / 2, cy = (top + H - bottom) / 2, dx = sx - cx, dy = sy - cy;
  const k = Math.min(Math.abs((W / 2 - pad) / (dx || 1e-9)), Math.abs(((H - top - bottom) / 2) / (dy || 1e-9)), 1);
  const ex = cx + dx * k, ey = cy + dy * k;
  const a = Math.atan2(dy, dx);
  ctx.save();
  ctx.translate(ex, ey);
  ctx.rotate(a);
  ctx.fillStyle = m.color;
  ctx.beginPath(); ctx.moveTo(19, 0); ctx.lineTo(11, -6); ctx.lineTo(11, 6); ctx.closePath(); ctx.fill();
  ctx.restore();
  badge(ctx, ex, ey, 10, m.label, m.color);
}
