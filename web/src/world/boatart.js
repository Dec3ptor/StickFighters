// How boats look (boats.js), in each game's look: the original's (pale, outlined in ink, as its
// stick figures are) and Remastered's (in their colours, shaded, softly outlined). A raft of logs
// lashed together with a paddle, a rowing boat of planks with its oars, a sailboat with its mast
// and its sails filling with the wind; bobbing on the water and rocking a little, with a wake
// behind and spray at the bow as they go, the paddle and oars going as they're rowed.
//
// Each boat's drawn in two parts, so whoever's in it sits in it: what's behind them (a mast and
// its sails, the far oar, a raft's deck) with the world, before the soldiers; the rest (the hull,
// the near oar, the wake) after them, before the water (render.js, glrender.js, rm/renderer.js),
// so the water's over what's under its top. On the renderer's canvas or WebGL's stand-in (paths,
// arcs, ellipses and curves; no clipping, no linear gradients).

import { BOATS, bobOf, windIn, boatPlace } from './boats.js';
import { shade } from './blocks.js';

const INK = '#111111';
const TAU = Math.PI * 2;
const AT = { x: 0, y: 0 };
// (Each look's colours, worked out once.)
const PALETTES = {};

/** The colours of a boat's parts, in a look. */
function paletteOf(classic) {
  const c = (hex, k = 1) => (classic ? shade(hex, 1.6) : k === 1 ? hex : shade(hex, k));
  return {
    classic,
    ink: classic ? INK : 'rgba(22,16,12,0.88)',
    lw: classic ? 1.1 : 0.85,
    log: c('#7a5230'), logEnd: c('#d8b47c'), ring: classic ? '#9a9a9a' : '#a8804e', deck: c('#9a6c40'),
    rope: c('#d8c08a'), ropeDark: classic ? '#8a8a8a' : '#9a8050',
    plank: c('#9a6a3c'), plankDark: classic ? shade('#9a6a3c', 1.25) : '#6a4426', rail: c('#6a4426'),
    seam: classic ? '#a0a0a0' : 'rgba(40,24,12,0.55)', under: classic ? null : 'rgba(30,18,8,0.35)',
    oar: c('#b8905a'), blade: c('#a87c48'),
    mast: c('#7a5634'), sail: classic ? '#ffffff' : '#f4eee0', sailShade: classic ? '#e4e4e4' : '#d8cfba', stripe: classic ? '#c8c8c8' : '#c8423a',
    pennant: classic ? '#bdbdbd' : '#d83a2a',
    foam: classic ? 'rgba(110,110,110,0.6)' : 'rgba(255,255,255,0.85)',
  };
}
const palette = classic => (classic ? (PALETTES.classic ||= paletteOf(true)) : (PALETTES.remastered ||= paletteOf(false)));

/**
 * Whoever's sat in boat b as it's shown, the one rowing first (their place is the boat's: it's
 * drawn with them, bob and all), else null.
 */
function sitterOf(game, b) {
  for (let seat = 0; seat < 2; seat++) {
    const id = seat ? b.passenger : b.rider;
    if (id < 0) continue;
    const d = game.soldiers.find(o => o.id === id);
    if (d?.alive && d.body.boat?.id === b.id && d.body.boat.seat === seat) return d;
  }
  return null;
}

/**
 * Every boat in view (view: { l, t, r, b }, or null for all), on the renderer's canvas in world
 * units; look: 'classic' or 'remastered'; alpha: how far between updates. back: the parts behind
 * whoever's in them (drawn before the soldiers); else the rest (after them).
 */
export function drawBoats(ctx, game, look, alpha = 1, view = null, back = false) {
  const boats = game.world?.boats;
  if (!boats?.size) return;
  const world = game.world, classic = look === 'classic', t = game.tick + alpha, wind = windIn(world), c = palette(classic);
  for (const b of boats.values()) {
    const def = BOATS[b.kind];
    if (!def) continue;
    const d = sitterOf(game, b);
    let x, y, vx, afloat = true;
    if (d) {
      // (Where they're sat: the bob is theirs too.)
      x = d.prevX + (d.x - d.prevX) * alpha + (d.drawDX || 0) - def.seats[d.body.boat.seat];
      y = d.prevY + (d.y - d.prevY) * alpha + (d.drawDY || 0) + def.sit;
      vx = d.body.vx;
    } else {
      boatPlace(game, b, alpha, AT);
      x = AT.x; vx = b.vx;
      afloat = !!world.liquidAt?.(x, AT.y + 2);
      y = AT.y + (afloat ? bobOf(t, b.id) : 0);
    }
    if (view && (x + 60 < view.l || x - 60 > view.r || y + 20 < view.t || y - 80 > view.b)) continue;
    if (!back && Math.abs(vx) > 0.2) b.face = vx > 0 ? 1 : -1;
    const dir = b.face || (wind < 0 ? -1 : 1);
    // (Hit: it shakes a moment.)
    const hit = game.tick - (b.hitAt ?? -1e9), shake = hit >= 0 && hit < 10 ? Math.sin(hit * 2.2) * 1.4 * (1 - hit / 10) : 0;
    const rock = afloat ? Math.sin(t * 0.045 + b.id * 1.3) * 0.03 + Math.max(-0.05, Math.min(0.05, -vx * 0.012)) : 0;
    ctx.save();
    ctx.translate(x + shake, y);
    if (!back && afloat && Math.abs(vx) > 0.4) drawWake(ctx, def, vx, dir, t, c);
    ctx.rotate(rock);
    drawBoat(ctx, b.kind, def, vx, dir, t, c, wind, d?.body.boat.seat === 0, back);
    ctx.restore();
  }
}

/** One boat at (0, 0) (its middle, at its waterline): its back or its front. */
function drawBoat(ctx, kind, def, vx, dir, t, c, wind, rowed, back) {
  if (kind === 'raft') drawRaft(ctx, def, vx, dir, t, c, rowed, back);
  else if (back) drawHullBack(ctx, def, vx, dir, t, c, kind === 'sailboat', wind, rowed);
  else drawHull(ctx, def, vx, dir, t, c, kind === 'sailboat', rowed);
}

/** Foam behind the stern and spray off the bow, going (on the water's top: y 0). */
function drawWake(ctx, def, vx, dir, t, c) {
  const half = def.len / 2, speed = Math.min(1, Math.abs(vx) / 4);
  ctx.strokeStyle = c.foam;
  ctx.fillStyle = c.foam;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  // Streaks trailing behind, falling back along the water.
  for (let i = 0; i < 4; i++) {
    const k = (t * 0.05 + i * 0.25) % 1, len = (7 + 12 * speed) * (1 - k * 0.5);
    const x0 = -dir * (half - 2 + k * (16 + 20 * speed)), y0 = -0.6 + (i % 2) * 0.9;
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 - dir * len, y0);
  }
  // The bow wave: a curl at the front.
  ctx.moveTo(dir * (half - 5), -0.8);
  ctx.quadraticCurveTo(dir * (half + 2), -2.6 - speed * 2.4, dir * (half + 6 + speed * 3), -0.4);
  ctx.stroke();
  // Spray: drops flung up off the bow, and falling back.
  for (let i = 0; i < 6; i++) {
    const k = (t * 0.07 + i * 0.17) % 1, sx = dir * (half - 2 + k * (7 + 7 * speed) + i * 0.6), sy = -1 - Math.sin(k * Math.PI) * (3 + 5 * speed);
    ctx.beginPath(); ctx.arc(sx, sy, 0.75, 0, TAU); ctx.fill();
  }
}

/**
 * A raft: logs side by side, lashed with rope (their cut ends to us; behind them, their tops, the
 * deck, going back), and its paddle: lying on the deck, or going in the water as it's rowed.
 */
function drawRaft(ctx, def, vx, dir, t, c, rowed, back) {
  const n = 5, r = 4.2, step = (def.len - r * 2) / (n - 1), cy = 0.4, half = def.len / 2;
  // The deck: the logs' tops going back (up and across a little), and the rope over them.
  const yf = cy - r + 0.8, D = 4.2, S = 3, x0 = -half + 0.8, x1 = half - 0.8;
  const going = rowed && Math.abs(vx) > 0.3;
  ctx.lineWidth = c.lw;
  if (back) {
    ctx.fillStyle = c.deck;
    ctx.strokeStyle = c.ink;
    ctx.beginPath(); ctx.moveTo(x0, yf); ctx.lineTo(x1, yf); ctx.lineTo(x1 + S, yf - D); ctx.lineTo(x0 + S, yf - D); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = c.seam;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let i = 0; i < n - 1; i++) { const sx = -half + r + (i + 0.5) * step; ctx.moveTo(sx, yf); ctx.lineTo(sx + S, yf - D); }
    ctx.stroke();
    ctx.strokeStyle = c.rope;
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(x0 + S * 0.5 + 0.5, yf - D * 0.5); ctx.lineTo(x1 + S * 0.5 - 0.5, yf - D * 0.5); ctx.stroke();
    // (The paddle, not rowed: lying on the deck.)
    if (!going) drawOar(ctx, x0 + 4, yf - D * 0.5 - 0.6, x1 - 6, yf - D * 0.5 - 2, c, 1.4);
    return;
  }
  // The logs' cut ends.
  for (let i = 0; i < n; i++) {
    const lx = -half + r + i * step;
    ctx.fillStyle = c.log;
    ctx.beginPath(); ctx.arc(lx, cy, r, 0, TAU); ctx.fill();
    ctx.fillStyle = c.logEnd;
    ctx.beginPath(); ctx.arc(lx, cy, r * 0.72, 0, TAU); ctx.fill();
    ctx.strokeStyle = c.ring;
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(lx, cy, r * 0.38, 0, TAU); ctx.stroke();
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = c.lw;
    ctx.beginPath(); ctx.arc(lx, cy, r, 0, TAU); ctx.stroke();
  }
  // Rope lashed round them: along their tops, and tied down between them.
  ctx.strokeStyle = c.rope;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-half + 1.5, cy - r + 1); ctx.lineTo(half - 1.5, cy - r + 1);
  for (const k of [0.5, n - 1.5]) {
    const lx = -half + r + k * step;
    ctx.moveTo(lx - 1.4, cy - r + 1); ctx.lineTo(lx + 1.4, cy + r - 0.8);
    ctx.moveTo(lx + 1.4, cy - r + 1); ctx.lineTo(lx - 1.4, cy + r - 0.8);
  }
  ctx.stroke();
  ctx.strokeStyle = c.ropeDark;
  ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(-half + 1.5, cy - r + 1.7); ctx.lineTo(half - 1.5, cy - r + 1.7); ctx.stroke();
  // The paddle as it's rowed: held across in front, its blade dug in ahead and pulled back past
  // the raft's end, then lifted out and brought forward again.
  if (going) {
    const o = stroke(dir, t * 1.1, -dir * 1, -19, half - 8, half + 6, 0, OAR);
    drawOar(ctx, o[0], o[1], o[2], o[3] + 1, c, 1.7);
  }
}

/** An oar (or paddle) from (x0, y0), its blade at (x1, y1) (shaft: its colour). */
function drawOar(ctx, x0, y0, x1, y1, c, w, shaft = c.oar) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
  ctx.lineCap = 'round';
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w + c.lw;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - ux * 3, y1 - uy * 3); ctx.stroke();
  ctx.strokeStyle = shaft;
  ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - ux * 3, y1 - uy * 3); ctx.stroke();
  ctx.lineCap = 'butt';
  // The blade: a long flat oval at its end.
  ctx.fillStyle = c.blade;
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = c.lw * 0.8;
  ctx.beginPath(); ctx.ellipse(x1 - ux * 2, y1 - uy * 2, 3.8, 1.6, Math.atan2(uy, ux), 0, TAU); ctx.fill(); ctx.stroke();
}

const smooth = k => k * k * (3 - 2 * k);

/**
 * An oar's (or a paddle's) stroke, as it's rowed going `dir`: from (ox, oy) (its oarlock, or the
 * hands) to its blade, now (into out). The blade goes in ahead (reach: how far, across), is pulled
 * back through the water (just under its top) to behind (back), then lifted out and brought
 * forward again over it. lag: how far behind in the stroke (the far oar, a moment after the near one).
 */
function stroke(dir, t, ox, oy, reach, back, lag, out) {
  const ph = (t * 0.1 + lag) % 1;
  let bx, by;
  if (ph < 0.55) { const k = smooth(ph / 0.55); bx = reach - (reach + back) * k; by = 4.5; }
  else { const k = (ph - 0.55) / 0.45; bx = -back + (reach + back) * smooth(k); by = 2 - Math.sin(k * Math.PI) * 6; }
  out[0] = ox; out[1] = oy; out[2] = ox + dir * bx; out[3] = by;
  return out;
}
const OAR = [0, 0, 0, 0];

/** What's behind whoever's in a boat of planks: a sailboat's mast and sails; a rowing boat's far oar. */
function drawHullBack(ctx, def, vx, dir, t, c, sail, wind, rowed) {
  if (sail) { drawSails(ctx, def, vx, dir, t, c, wind); return; }
  const top = -def.rim, ox = def.seats[0] + 5;
  const o = rowed && Math.abs(vx) > 0.3 ? stroke(dir, t, ox + 1.5, top - 0.5, 15, 12, 0.04, OAR) : null;
  if (o) drawOar(ctx, o[0], o[1], o[2], o[3] - 1, c, 1.4, c.blade);
  else drawOar(ctx, ox - 15, top - 1.2, ox + 13, top - 2.6, c, 1.4, c.blade);
}

/**
 * A boat of planks (a rowing boat; a sailboat: longer, with a fin under it): its hull curving up to
 * bow and stern, its strakes, its rail; a rowing boat's near oar going as it's rowed.
 */
function drawHull(ctx, def, vx, dir, t, c, sail, rowed) {
  const h = def.len / 2, top = -def.rim, keel = def.keel, tip = top - 3, sag = 1.5;
  // The hull: up to a point at each end, the rail sagging a little between.
  const hull = () => {
    ctx.beginPath();
    ctx.moveTo(-h, tip);
    ctx.quadraticCurveTo(-h * 0.8, keel, 0, keel);
    ctx.quadraticCurveTo(h * 0.8, keel, h, tip);
    ctx.quadraticCurveTo(0, top + sag, -h, tip);
    ctx.closePath();
  };
  ctx.lineWidth = c.lw;
  ctx.fillStyle = c.plank;
  hull();
  ctx.fill();
  // (Remastered: darker low down, where it's wet.)
  if (c.under) {
    ctx.fillStyle = c.under;
    ctx.beginPath();
    ctx.moveTo(-h * 0.88, 0.5);
    ctx.quadraticCurveTo(-h * 0.7, keel, 0, keel);
    ctx.quadraticCurveTo(h * 0.7, keel, h * 0.88, 0.5);
    ctx.closePath();
    ctx.fill();
  }
  // Strakes: the planks' seams, following its curve.
  ctx.strokeStyle = c.seam;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (const k of [0.34, 0.68]) {
    const yy = top + (keel - top) * k, ex = h * (1 - k * 0.45);
    ctx.moveTo(-ex, yy - 2 * (1 - k)); ctx.quadraticCurveTo(0, yy + 1.6, ex, yy - 2 * (1 - k));
  }
  ctx.stroke();
  // Its rail along the top.
  ctx.strokeStyle = c.rail;
  ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(-h + 1.2, tip + 0.9); ctx.quadraticCurveTo(0, top + sag + 0.9, h - 1.2, tip + 0.9); ctx.stroke();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = c.lw;
  hull();
  ctx.stroke();
  // (A sailboat's fin under it.)
  if (sail) {
    ctx.fillStyle = c.plankDark;
    ctx.beginPath(); ctx.moveTo(-6, keel - 0.6); ctx.lineTo(-2.5, keel + 5); ctx.lineTo(4.5, keel + 5); ctx.lineTo(7, keel - 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
    return;
  }
  // The oarlock, and the near oar going (shipped, it's behind: drawHullBack).
  const ox = def.seats[0] + 5;
  ctx.fillStyle = c.rail;
  ctx.fillRect(ox - 1, top - 3, 2, 2.6);
  if (rowed && Math.abs(vx) > 0.3) { const o = stroke(dir, t, ox, top - 0.5, 15, 12, 0, OAR); drawOar(ctx, o[0], o[1], o[2], o[3], c, 1.7); }
}

/** A sailboat's mast and its sails: the mainsail on its boom, behind the mast as it goes, and the jib to the bow, filling with the wind. */
function drawSails(ctx, def, vx, dir, t, c, wind) {
  const h = def.len / 2, mx = 0.5, foot = -27, peak = -68, top = -def.rim;
  // How full the sails are: the wind behind it fills them; into it they're slack, and flutter.
  const behind = dir * wind > 0, fill = Math.abs(wind) * (behind ? 1 : 0.35), flap = behind ? 0 : Math.sin(t * 0.5) * 1.3;
  const boom = mx - dir * (h * 0.85), belly = dir * (2 + 7 * fill);
  // The jib: from near the masthead to the bow, filling out ahead.
  const bow = dir * (h - 1.5);
  ctx.lineWidth = c.lw;
  ctx.fillStyle = c.sail;
  ctx.strokeStyle = c.ink;
  ctx.beginPath();
  ctx.moveTo(mx, peak + 5);
  ctx.lineTo(bow, top - 3);
  ctx.lineTo(mx + dir * 2, top - 6);
  ctx.quadraticCurveTo(mx + dir * (5 + 6 * fill) + flap * 0.6, (peak + top) / 2, mx, peak + 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // The mast.
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = 2.8 + c.lw;
  ctx.beginPath(); ctx.moveTo(mx, top + 1); ctx.lineTo(mx, peak - 2); ctx.stroke();
  ctx.strokeStyle = c.mast;
  ctx.lineWidth = 2.8;
  ctx.beginPath(); ctx.moveTo(mx, top + 1); ctx.lineTo(mx, peak - 2); ctx.stroke();
  // The mainsail: from the masthead down the mast to the boom, its back edge curving out.
  const leech = () => ctx.quadraticCurveTo((mx + boom) / 2 - belly * 0.4 + flap, (peak + foot) / 2 + 3, mx, peak);
  ctx.fillStyle = c.sail;
  ctx.beginPath(); ctx.moveTo(mx, peak); ctx.lineTo(mx, foot); ctx.lineTo(boom, foot); leech(); ctx.closePath(); ctx.fill();
  // (Its shade low down, and a stripe across it.)
  ctx.fillStyle = c.sailShade;
  ctx.beginPath(); ctx.moveTo(mx, foot); ctx.lineTo(boom, foot); ctx.lineTo(mx + (boom - mx) * 0.55, foot - 10); ctx.lineTo(mx, foot - 12); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = c.stripe;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(mx, foot - 17); ctx.lineTo(mx + (boom - mx) * 0.62, foot - 15); ctx.stroke();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = c.lw;
  ctx.beginPath(); ctx.moveTo(mx, peak); ctx.lineTo(mx, foot); ctx.lineTo(boom, foot); leech(); ctx.stroke();
  // The boom.
  ctx.strokeStyle = c.mast;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(mx, foot + 0.6); ctx.lineTo(boom, foot + 0.6); ctx.stroke();
  // The forestay down to the bow, and a pennant at the masthead, blowing with the wind.
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(mx, peak); ctx.lineTo(bow, top - 3); ctx.stroke();
  const wd = wind < 0 ? -1 : 1, fl = Math.sin(t * 0.3) * 1.2;
  ctx.fillStyle = c.pennant;
  ctx.beginPath(); ctx.moveTo(mx, peak - 2.5); ctx.lineTo(mx + wd * 9, peak - 0.6 + fl); ctx.lineTo(mx, peak + 1.6); ctx.closePath(); ctx.fill();
}

/** A boat's icon (an item: worldrender.js's drawIcon), w square at (x, y): the boat, side on, fitted to it. */
export function drawBoatIcon(ctx, it, x, y, w, classic) {
  const def = BOATS[it.boat];
  if (!def) return;
  const c = palette(classic), sail = it.boat === 'sailboat', k = w / (sail ? 72 : def.len - 2);
  ctx.save();
  ctx.translate(x + w / 2, y + w * (sail ? 0.86 : 0.62));
  ctx.scale(k, k);
  drawBoat(ctx, it.boat, def, 0, 1, 0, c, 1, false, true);
  drawBoat(ctx, it.boat, def, 0, 1, 0, c, 1, false, false);
  ctx.restore();
}
