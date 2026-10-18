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
  const placed = [];
  for (const m of marks) edgeMarker(ctx, r, m, W, H, placed);
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

/** A marker at the edge of the screen pointing at something off it (moved along a bit if it would cover another). */
function edgeMarker(ctx, r, m, W, H, placed) {
  const sx = (m.x - r.cam.x) * r.scale + W / 2, sy = (m.y - r.cam.y) * r.scale + H / 2;
  const pad = 22, top = 70, bottom = 80;
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
  ctx.fillStyle = '#9a9a9a';
  for (const p of game.map.solids) ctx.fillRect(X(p.l), Y(p.t), Math.max(1, (p.r - p.l) * k), Math.max(1, (p.b - p.t) * k));
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

/** Conquest, while waiting to respawn: where you'll spawn, and the number keys to change it. */
export function drawDeploy(ctx, game, me, W, y) {
  const opts = game.rules.deployOptions(game, me);
  const chosen = opts.some(o => o.key === me.deployAt) ? me.deployAt : 'auto';
  const st = game.modeState, pts = objectivesOf(game.map, 'point');
  const w = 58, gap = 8, total = opts.length * w + (opts.length - 1) * gap;
  ctx.font = `12px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#555';
  ctx.fillText('Spawn at (press a number):', W / 2, y);
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
    ctx.fillText(`${i + 1}  ${o.label}`, x + w / 2, by + 13);
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
