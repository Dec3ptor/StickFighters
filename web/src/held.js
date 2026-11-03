// What's in a soldier's hands, drawn (all three renderers): guns and tools as ever (sprites.js),
// a world's things as themselves (a block as it looks in the world, an apple, a potion, a gem:
// worldrender.js paints them), a torch's flame flickering, and what an act shows besides
// (useanim.js; posed by stickman.js): crumbs as they eat, a sparkle as they drink, a scroll
// opened out as they read it, a magazine coming out and going back in.

import { drawWeapon } from './sprites.js';

let painter = null;

/** How a world's things look in a hand: painter(ctx, item, classic), drawn round (0, 0) (worldrender.js gives it). */
export function setItemPainter(fn) { painter = fn; }

/**
 * The things in a soldier's hands (pose: buildPose's, the context in the soldier's own place).
 * base: { k, e, f }, the soldier's own place as a transform to go back to after each thing (no
 * save and restore, with thousands of soldiers); without one, saved and restored.
 */
export function drawHeld(ctx, pose, tick, classic, base = null) {
  const off = pose.off, gun = pose.gun;
  if (off.def && !off.hidden) drawThing(ctx, off, tick, classic, base);
  if (!gun.hidden) drawThing(ctx, gun, tick, classic, base);
  if (pose.fx.kind) drawFx(ctx, pose.fx, tick);
}

function drawThing(ctx, h, tick, classic, base) {
  if (!base) ctx.save();
  ctx.translate(h.x, h.y);
  if (h.angle) ctx.rotate(h.angle);
  const def = h.def;
  if (h.center) {
    if (h.scale !== 1) ctx.scale(h.scale, h.scale);
    if (def.item && painter) painter(ctx, def.item, classic);
  } else {
    if (Math.cos(h.angle) < 0) ctx.scale(1, -1);
    if (h.scale !== 1) ctx.scale(h.scale, h.scale);
    if (def.look.type === 'torch') drawTorch(ctx, tick, h);
    else drawWeapon(ctx, def, false, h.pull);
  }
  if (base) ctx.setTransform(base.k, 0, 0, base.k, base.e, base.f);
  else ctx.restore();
}

/** A torch in hand: its stick, and a flame that flickers and leans up (whichever way it's held). */
function drawTorch(ctx, tick, h) {
  ctx.fillStyle = '#7a5634';
  ctx.fillRect(2, -0.9, 9, 1.8);
  // (Where up is, here: the flame's tongue points that way.)
  const c = Math.cos(h.angle), sn = Math.sin(h.angle), flip = c < 0 ? -1 : 1;
  const ux = -sn, uy = -c * flip;
  const seed = (h.x * 7 + h.y * 3) | 0;
  const fl = Math.sin(tick * 0.7 + seed) * 0.35 + Math.sin(tick * 1.9 + seed * 2) * 0.2;
  const r = 2.3 + fl;
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * 0.28;
  ctx.fillStyle = '#ffb040';
  ctx.beginPath(); ctx.arc(12, 0, r * 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = a;
  ctx.fillStyle = '#ff9a30';
  ctx.beginPath();
  ctx.moveTo(12 - uy * r, ux * r);
  ctx.lineTo(12 + ux * r * (1.8 + fl), uy * r * (1.8 + fl));
  ctx.lineTo(12 + uy * r, -ux * r);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath(); ctx.arc(12, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff2b0';
  ctx.beginPath(); ctx.arc(12 + ux * 0.4, uy * 0.4, r * 0.45, 0, Math.PI * 2); ctx.fill();
}

/** What an act shows besides what's in hand (in the soldier's own place). */
function drawFx(ctx, fx, tick) {
  const a = ctx.globalAlpha, t = fx.t, f = fx.f;
  switch (fx.kind) {
    case 'crumbs':
      // Bits falling from the mouth as they chew.
      ctx.fillStyle = fx.color;
      for (let i = 0; i < 4; i++) {
        const t0 = 0.24 + i * 0.14, age = (t - t0) / 0.3;
        if (age <= 0 || age >= 1) continue;
        ctx.globalAlpha = a * (1 - age);
        ctx.fillRect(fx.x + f * (1.2 + i * 0.7 + age * 1.5), fx.y + 1 + age * age * 8, 0.9, 0.9);
      }
      ctx.globalAlpha = a;
      break;
    case 'sip':
      // A healing sparkle round the head as the swig goes down.
      if (t > 0.45) {
        ctx.fillStyle = '#ffd6ec';
        for (let i = 0; i < 4; i++) {
          const ang = i * 1.6 + tick * 0.08, rise = (t - 0.45) * 14 + i * 1.5;
          ctx.globalAlpha = a * Math.max(0, 1 - (t - 0.45) / 0.55) * 0.9;
          ctx.fillRect(fx.x - f * 2.4 + Math.cos(ang) * 6, fx.y - 4 - rise + Math.sin(ang) * 2, 1.1, 1.1);
        }
        ctx.globalAlpha = a;
      }
      break;
    case 'scroll': drawOpenScroll(ctx, fx, tick); break;
    case 'mag': {
      // A magazine in the hand (out of the gun, or a fresh one going in).
      ctx.save();
      ctx.translate(fx.x, fx.y);
      ctx.rotate(fx.angle + Math.PI / 2 * f * 0.15);
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(-0.9, -2.6, 1.8, 4);
      ctx.fillStyle = '#c8a040';
      ctx.fillRect(-0.6, -2.9, 1.2, 0.5);
      ctx.restore();
      break;
    }
  }
}

/** A recall scroll opened out (k: how far), its runes glowing, motes of its magic rising round it. */
function drawOpenScroll(ctx, fx, tick) {
  const k = fx.k, a = ctx.globalAlpha, x = fx.x, y = fx.y;
  if (k <= 0.05) return;
  const h = 9 * k, w = 7;
  // (Its glow.)
  ctx.globalAlpha = a * 0.22 * k * (0.75 + 0.25 * Math.sin(tick * 0.15));
  ctx.fillStyle = '#9fd8ff';
  ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = a;
  ctx.fillStyle = '#efe3c2';
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.strokeStyle = '#6a5434';
  ctx.lineWidth = 0.4;
  ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  // (The rods at each end.)
  ctx.fillStyle = '#7a5634';
  ctx.fillRect(x - w / 2 - 0.8, y - h / 2 - 0.7, w + 1.6, 1.2);
  ctx.fillRect(x - w / 2 - 0.8, y + h / 2 - 0.5, w + 1.6, 1.2);
  // Runes, glowing.
  if (k > 0.6) {
    ctx.globalAlpha = a * (0.6 + 0.4 * Math.sin(tick * 0.2));
    ctx.fillStyle = '#3a7ad8';
    for (let i = 0; i < 4; i++) ctx.fillRect(x - 2.4 + (i % 2) * 0.6, y - 3 + i * 1.7, 4.2 - (i % 2) * 1.6, 0.5);
    ctx.globalAlpha = a;
  }
  // Motes of its magic, rising round them (more as it nears its end).
  const n = 3 + Math.floor(fx.t * 6);
  ctx.fillStyle = '#bfe8ff';
  for (let i = 0; i < n; i++) {
    const ph = (tick * 0.02 + i * 0.37) % 1, ang = i * 2.39 + tick * 0.03;
    ctx.globalAlpha = a * (1 - ph) * 0.9;
    ctx.fillRect(x - fx.f * 6 + Math.cos(ang) * 9, y + 10 - ph * 26, 0.9, 0.9);
  }
  ctx.globalAlpha = a;
}

/**
 * Wings on a soldier's back (a world's: gear.js), drawn behind them (pose: buildPose's; the
 * context in the soldier's own place): folded down the back, or spread wide behind them while
 * they glide, beating slowly.
 */
export function drawWings(ctx, pose, facing, gliding, tick) {
  const L = pose.lines[0], nx = L[0], ny = L[1], hx = L[2], hy = L[3];
  const bx = nx + (hx - nx) * 0.22, by = ny + (hy - ny) * 0.22, back = -facing, a = ctx.globalAlpha;
  ctx.strokeStyle = '#7a7498';
  ctx.lineWidth = 0.7;
  if (gliding) {
    const beat = Math.sin(tick * 0.16) * 1.6;
    for (const far of [true, false]) {
      const lift = far ? -3.5 : 0, len = far ? 15 : 18;
      ctx.fillStyle = far ? '#cfc8e8' : '#f6f2ff';
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + back * len * 0.4, by - 11 + lift + beat, bx + back * len, by - 8 + lift + beat);
      // (Its feathers' tips, ragged, back to the body.)
      for (let i = 1; i <= 5; i++) { const t = i / 5; ctx.lineTo(bx + back * len * (1 - t * 0.88), by - 8 + lift + beat + t * 10 + (i % 2) * 1.6); }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#f0ecfc';
    ctx.beginPath();
    ctx.moveTo(bx, by - 1.5);
    ctx.quadraticCurveTo(bx + back * 5.5, by, bx + back * 3.6, by + 12);
    ctx.lineTo(bx + back * 2.6, by + 10.5);
    ctx.lineTo(bx + back * 1.6, by + 11.5);
    ctx.lineTo(bx + back * 0.6, by + 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.globalAlpha = a;
}
