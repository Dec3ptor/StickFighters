// How animals look (animals.js), in each game's look: the original's (pale, outlined in ink, as
// its stick figures are) and Remastered's (in their colours, shaded, softly outlined). Each is
// drawn in code, facing the way it's going, its legs going as it walks (a hop in the air for the
// hoppers), its head down now and then to graze; young ones smaller, a sheared sheep thin, a fish
// in the water with its tail going. Hurt, it flashes red, and its health shows a while.
//
// Drawn in place of a soldier (render.js and rm/soldiers.js hand animals here first): the
// renderer's canvas (or WebGL's stand-in, which has paths, arcs, ellipses and curves, but no
// clipping or patterns), the soldier, how far between updates, and which look.

import { BODY } from '../config.js';
import { shade } from './blocks.js';
import { parseLook } from './animals.js';

const INK = '#111111';
const TAU = Math.PI * 2;

/** Each animal's shape: quadrupeds by their measures (world px: body length and height, legs, head, neck), the rest their own. */
const KINDS = {
  cow: { shape: 'quad', len: 22, h: 11, leg: 7, legW: 2.6, stride: 2.4, headW: 7, headH: 6, neck: 3, neckX: 1, neckW: 4.5, color: '#f2efe8', spots: '#3a2e28', muzzle: '#e8b4ac', horns: '#e8e0c8', tail: 'long' },
  pig: { shape: 'quad', len: 17, h: 9.5, leg: 4, legW: 2.6, stride: 1.6, headW: 7, headH: 6.5, neck: 0.5, neckX: 0, neckW: 6, color: '#f0a8a8', snout: '#e47c84', ears: 'flop', tail: 'curl' },
  sheep: { shape: 'quad', len: 18, h: 10, leg: 6, legW: 2.1, stride: 2, headW: 5.5, headH: 5, neck: 2.5, neckX: 1, neckW: 3.5, color: '#f4f2ec', face: '#4a403a', wool: true, tail: 'stub' },
  deer: { shape: 'quad', len: 18, h: 8.5, leg: 10, legW: 1.8, stride: 2.8, headW: 6, headH: 4.2, neck: 7, neckX: 2, neckW: 3, color: '#a8723e', belly: '#ecdcc4', antlers: '#d8c8a8', ears: 'up', tail: 'stub' },
  goat: { shape: 'quad', len: 15, h: 9, leg: 7, legW: 1.9, stride: 2.2, headW: 5.5, headH: 4.6, neck: 4, neckX: 1, neckW: 3, color: '#e8e4dc', horns: '#8a7a6a', curl: true, beard: true, tail: 'stub' },
  camel: { shape: 'quad', len: 22, h: 10, leg: 13, legW: 2.4, stride: 2.8, headW: 6.5, headH: 4.2, neck: 10, neckX: 4, neckW: 3.5, color: '#d8b07a', hump: true, tail: 'long' },
  polar_bear: { shape: 'quad', len: 24, h: 13, leg: 7, legW: 3.6, stride: 2.2, headW: 8, headH: 7, neck: 2, neckX: 2, neckW: 7, color: '#f2f0ea', nose: '#222222', ears: 'round', tail: 'stub' },
  chicken: { shape: 'bird', color: '#f4f2ec', comb: '#d83a2a', beak: '#f2b030' },
  parrot: { shape: 'bird', color: '#d8302a', beak: '#e8d8b8', parrot: true },
  rabbit: { shape: 'rabbit', color: '#b89a7a' },
  frog: { shape: 'frog', color: '#5a9a3a' },
  fish: { shape: 'fish', color: '#8aa4b8' },
  crab: { shape: 'crab', color: '#d8502a' },
};
/** Parrots' and fish's colours (their variant: animals.js). */
const PARROTS = ['#d8302a', '#2f6fd8', '#3aa83a'];
const FISH = ['#8a9a88', '#d87a6a', '#f08a2a', '#4ab0d8'];

/** Lighter (the original's pale animals: most of the way to white) or as it is. */
const tone = (hex, classic) => (classic ? shade(hex, 1.65) : hex);

/**
 * Animal s, part way (alpha) between the last two updates, on renderer r's canvas: `look` is
 * 'classic' (the original's: the transform's the renderer's own, set here) or 'remastered'
 * (the canvas is already in world units).
 */
export function drawAnimal(r, game, s, alpha, look) {
  const ctx = r.ctx, classic = look === 'classic';
  const x = s.prevX + (s.x - s.prevX) * alpha + (s.drawDX || 0), y = s.prevY + (s.y - s.prevY) * alpha + (s.drawDY || 0);
  const lk = parseLook(s.npc?.look ?? s.skin), K = KINDS[lk.type] || KINDS.cow, t = game.tick;
  const hurtAgo = t - (s.lastHurtTick ?? -1e9);
  const b = s.body, moving = Math.abs(b.vx) > 0.12;
  // (Its head down to graze now and then, standing still.)
  const g = (t + s.id * 131) % 420, graze = moving || K.shape !== 'quad' ? 0 : g < 20 ? g / 20 : g < 170 ? 1 : g < 190 ? (190 - g) / 20 : 0;
  const a = { phase: (s.anim?.run || 0) * TAU, moving, graze, air: !b.onGround && !b.swimming, t: t + s.id * 17, shorn: lk.shorn };
  const color = lk.type === 'parrot' ? PARROTS[lk.variant % 3] : lk.type === 'fish' ? FISH[lk.variant % 4] : K.color;
  const c = {
    classic, ink: classic ? INK : 'rgba(20,16,14,0.88)', lw: classic ? 1.1 : 0.85,
    body: hurtAgo < 8 ? '#ff8a80' : tone(color, classic), far: hurtAgo < 8 ? '#d86a60' : classic ? shade(tone(color, true), 0.9) : shade(color, 0.78),
    dark: classic ? '#9a9a9a' : shade(color, 0.7), color,
  };
  ctx.save();
  if (classic) ctx.setTransform(r.s, 0, 0, r.s, r.tx, r.ty);
  // (Faint, if invisible: never, for an animal; but as soldiers are drawn with what they're given.)
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const k = lk.baby ? 0.62 : 1;
  if (K.shape === 'fish') ctx.translate(x, y - 4);
  else ctx.translate(x, y + BODY.bottom);
  ctx.scale((K.shape === 'crab' ? 1 : s.facing || 1) * k, k);
  switch (K.shape) {
    case 'quad': quad(ctx, K, c, a); break;
    case 'bird': bird(ctx, K, c, a); break;
    case 'rabbit': rabbit(ctx, K, c, a); break;
    case 'frog': frog(ctx, K, c, a); break;
    case 'fish': fish(ctx, K, c, a); break;
    case 'crab': crab(ctx, K, c, a); break;
  }
  ctx.restore();
  // Hurt a while ago: its health, over it.
  if (hurtAgo < 300 && s.alive && s.health < s.maxHealth) {
    ctx.save();
    if (classic) ctx.setTransform(r.s, 0, 0, r.s, r.tx, r.ty);
    const top = K.shape === 'fish' ? y - 16 : y + BODY.bottom - heightOf(K) * k - 7;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x - 7, top, 14, 1.8);
    ctx.fillStyle = s.health > s.maxHealth * 0.4 ? '#7ee07a' : '#ff5a4a';
    ctx.fillRect(x - 7, top, 14 * Math.max(0, s.health) / s.maxHealth, 1.8);
    ctx.restore();
  }
}

/** How tall an animal stands (px). */
const heightOf = K => (K.shape === 'quad' ? K.leg + K.h + K.neck + K.headH * 0.6 : K.shape === 'bird' ? 12 : K.shape === 'rabbit' ? 11 : K.shape === 'crab' ? 7 : 6);

/** Fill the path in `fill`, outlined. */
function fillOut(ctx, c, fill) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = c.lw;
  ctx.stroke();
}

/** A limb from (x0, y0) to (x1, y1), w thick, outlined. */
function limb(ctx, c, x0, y0, x1, y1, w, fill) {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
  ctx.strokeStyle = c.ink; ctx.lineWidth = w + c.lw * 2; ctx.stroke();
  ctx.strokeStyle = fill; ctx.lineWidth = w; ctx.stroke();
}

/** A four-legged animal: far legs, tail, body (wool, a hump, spots), near legs, then its neck and head. */
function quad(ctx, K, c, a) {
  const L = K.len, H = K.h, G = K.leg, by = -G - H / 2;
  const sw = a.moving ? Math.sin(a.phase) * K.stride : 0, lift = a.moving ? Math.max(0, Math.cos(a.phase)) * 1.2 : 0;
  const bx = -L / 2 + K.legW + 1.5, fx = L / 2 - K.legW - 1.5;
  // Far legs (darker), swinging the other way.
  limb(ctx, c, bx + 1.5, by + H * 0.2, bx + 1.5 + sw, -0.6, K.legW, c.far);
  limb(ctx, c, fx - 1.5, by + H * 0.2, fx - 1.5 - sw, -0.6 - lift, K.legW, c.far);
  // The tail.
  if (K.tail === 'long') { ctx.beginPath(); ctx.moveTo(-L / 2 + 1, by - H * 0.25); ctx.quadraticCurveTo(-L / 2 - 2, by + 1, -L / 2 - 1.5 + Math.sin(a.t * 0.08) * 0.8, by + H * 0.6); ctx.strokeStyle = c.ink; ctx.lineWidth = 1.1; ctx.stroke(); }
  else if (K.tail === 'curl') { ctx.beginPath(); ctx.arc(-L / 2 - 0.5, by - 1.5, 1.6, 0, Math.PI * 1.6); ctx.strokeStyle = c.ink; ctx.lineWidth = 0.9; ctx.stroke(); }
  // The body.
  if (K.wool && !a.shorn) {
    // A fleece: puffs round a body (gone when it's sheared).
    ctx.beginPath();
    for (let i = 0; i < 5; i++) { const px = -L / 2 + 2.5 + i * (L - 5) / 4; ctx.moveTo(px + 3.6, by - H * 0.15); ctx.arc(px, by - H * 0.15, 3.6, 0, TAU); }
    for (let i = 0; i < 4; i++) { const px = -L / 2 + 4.5 + i * (L - 9) / 3; ctx.moveTo(px + 3.4, by + H * 0.22); ctx.arc(px, by + H * 0.22, 3.4, 0, TAU); }
    // (Outlined round the outside only: the puffs' fill covers where they overlap.)
    ctx.strokeStyle = c.ink; ctx.lineWidth = c.lw * 2; ctx.stroke();
    ctx.fillStyle = c.body; ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, by, L / 2 - 1, H / 2 - 0.5, 0, 0, TAU); ctx.fill();
    if (!c.classic) { ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.beginPath(); ctx.ellipse(0, by + H * 0.3, L / 2 - 2, H * 0.2, 0, 0, TAU); ctx.fill(); }
  } else {
    ctx.beginPath();
    if (K.wool) ctx.ellipse(0, by + 1, L / 2 - 1.5, H / 2 - 1.5, 0, 0, TAU);
    else ctx.ellipse(0, by, L / 2, H / 2, 0, 0, TAU);
    fillOut(ctx, c, K.wool ? (c.classic ? '#fff' : '#e8d8cc') : c.body);
  }
  if (K.hump) { ctx.beginPath(); ctx.ellipse(-1, by - H / 2 + 0.5, 5, 4, 0, Math.PI, TAU); fillOut(ctx, c, c.body); }
  if (!c.classic && !(K.wool && !a.shorn)) {
    // (Remastered: lit from above, a shadow under.)
    ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.beginPath(); ctx.ellipse(0, by + H * 0.22, L / 2 - 2, H * 0.24, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.ellipse(-1, by - H * 0.26, L / 2 - 4, H * 0.14, 0, 0, TAU); ctx.fill();
  }
  if (K.belly) { ctx.fillStyle = c.classic ? '#fff' : K.belly; ctx.beginPath(); ctx.ellipse(1, by + H * 0.25, L / 2 - 4, H * 0.2, 0, 0, TAU); ctx.fill(); }
  if (K.spots) {
    ctx.fillStyle = c.classic ? '#555' : K.spots;
    ctx.beginPath(); ctx.ellipse(-4, by - 1.5, 3.2, 2.4, 0.3, 0, TAU); ctx.ellipse(4.5, by + 1.5, 2.6, 2, -0.4, 0, TAU); ctx.ellipse(-8, by + 2.5, 1.6, 1.3, 0, 0, TAU); ctx.fill();
  }
  // Near legs.
  limb(ctx, c, bx, by + H * 0.25, bx - sw, -lift, K.legW, c.body);
  limb(ctx, c, fx, by + H * 0.25, fx + sw, 0, K.legW, c.body);
  if (!c.classic) {
    // (Hooves.)
    ctx.fillStyle = shade(K.color, 0.45);
    ctx.fillRect(bx - sw - K.legW / 2, -1.3 - lift, K.legW, 1.3);
    ctx.fillRect(fx + sw - K.legW / 2, -1.3, K.legW, 1.3);
  }
  // The neck and head: up, or down to the grass.
  const nx = L / 2 - 2.5, ny = by - H * 0.15;
  const ux = nx + K.neckX + K.headW * 0.35, uy = ny - K.neck - K.headH * 0.3;
  const dx = nx + K.neckX + K.headW * 0.55 + 1, dy = -K.headH * 0.55 + Math.sin(a.t * 0.3) * 0.4 * a.graze;
  const hx = ux + (dx - ux) * a.graze, hy = uy + (dy - uy) * a.graze, tilt = a.graze * 0.7;
  limb(ctx, c, nx - 1, ny, hx - K.headW * 0.2, hy, K.neckW, c.body);
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(tilt);
  head(ctx, K, c, a);
  ctx.restore();
}

/** A four-legged animal's head (at its middle, facing right): its face, then horns, ears, eye, nose. */
function head(ctx, K, c, a) {
  const w = K.headW, h = K.headH;
  // Ears and horns behind the face.
  if (K.horns && !K.curl) { ctx.beginPath(); ctx.moveTo(-w * 0.15, -h * 0.4); ctx.quadraticCurveTo(-w * 0.3, -h * 0.95, w * 0.1, -h * 1.05); ctx.strokeStyle = c.ink; ctx.lineWidth = 2.2; ctx.stroke(); ctx.strokeStyle = c.classic ? '#fff' : K.horns; ctx.lineWidth = 1.2; ctx.stroke(); }
  if (K.curl) { ctx.beginPath(); ctx.arc(-w * 0.2, -h * 0.55, 2.4, Math.PI * 0.9, Math.PI * 2.2); ctx.strokeStyle = c.ink; ctx.lineWidth = 2.2; ctx.stroke(); ctx.strokeStyle = c.classic ? '#ddd' : K.horns; ctx.lineWidth = 1.2; ctx.stroke(); }
  if (K.antlers) {
    ctx.strokeStyle = c.classic ? INK : K.antlers; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-w * 0.1, -h * 0.45); ctx.lineTo(-w * 0.3, -h * 1.6); ctx.moveTo(-w * 0.22, -h * 1.05); ctx.lineTo(-w * 0.62, -h * 1.45); ctx.moveTo(-w * 0.27, -h * 1.35); ctx.lineTo(w * 0.05, -h * 1.75); ctx.stroke();
  }
  if (K.ears === 'up') { ctx.beginPath(); ctx.ellipse(-w * 0.3, -h * 0.6, 1.1, 2.4, -0.5, 0, TAU); fillOut(ctx, c, c.body); }
  if (K.ears === 'round') { ctx.beginPath(); ctx.arc(-w * 0.2, -h * 0.5, 1.6, 0, TAU); fillOut(ctx, c, c.body); }
  // The face.
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, TAU);
  fillOut(ctx, c, K.face && !c.classic ? K.face : c.body);
  if (K.face && c.classic) { ctx.fillStyle = '#777'; ctx.beginPath(); ctx.ellipse(w * 0.1, 0.2, w * 0.36, h * 0.38, 0, 0, TAU); ctx.fill(); }
  if (K.ears === 'flop') { ctx.beginPath(); ctx.moveTo(-w * 0.15, -h * 0.4); ctx.lineTo(w * 0.15, -h * 0.75); ctx.lineTo(w * 0.22, -h * 0.25); ctx.closePath(); fillOut(ctx, c, c.body); }
  // A muzzle, a snout, a nose.
  if (K.muzzle) { ctx.beginPath(); ctx.ellipse(w * 0.36, h * 0.18, w * 0.22, h * 0.28, 0, 0, TAU); fillOut(ctx, c, c.classic ? '#fff' : K.muzzle); }
  if (K.snout) { ctx.beginPath(); ctx.ellipse(w * 0.48, h * 0.1, 1.4, 1.9, 0, 0, TAU); fillOut(ctx, c, c.classic ? '#fff' : K.snout); ctx.fillStyle = c.ink; ctx.fillRect(w * 0.45, h * 0.0, 0.5, 0.7); }
  if (K.nose) { ctx.fillStyle = K.nose; ctx.beginPath(); ctx.arc(w * 0.48, -h * 0.02, 1, 0, TAU); ctx.fill(); }
  if (K.beard) { ctx.beginPath(); ctx.moveTo(w * 0.15, h * 0.4); ctx.lineTo(w * 0.05, h * 0.95); ctx.lineTo(w * 0.32, h * 0.45); ctx.closePath(); fillOut(ctx, c, c.classic ? '#fff' : '#d8d4cc'); }
  // An eye.
  ctx.fillStyle = K.face && !c.classic ? '#f4f0e8' : INK;
  ctx.beginPath(); ctx.arc(w * 0.12, -h * 0.12, 0.75, 0, TAU); ctx.fill();
}

/** A bird on the ground (a chicken, a parrot): legs, body, wing, head, beak (and a hen's comb). */
function bird(ctx, K, c, a) {
  const step = a.moving ? Math.sin(a.phase) * 1.6 : 0, peck = a.moving ? 0 : Math.max(0, Math.sin(a.t * 0.05)) ** 8 * 3;
  ctx.strokeStyle = c.classic ? INK : '#d89a30'; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(-1, -4); ctx.lineTo(-1 + step, 0); ctx.moveTo(1, -4); ctx.lineTo(1 - step, 0); ctx.stroke();
  // (A parrot's long tail; a hen's short one.)
  ctx.beginPath();
  if (K.parrot) { ctx.moveTo(-3, -6); ctx.lineTo(-8, -1.5); ctx.lineTo(-6.5, -0.5); ctx.lineTo(-2, -4.5); }
  else { ctx.moveTo(-3.5, -8); ctx.lineTo(-6.5, -11); ctx.lineTo(-5, -6); }
  ctx.closePath(); fillOut(ctx, c, K.parrot ? (c.classic ? '#ddd' : '#2f6fd8') : c.body);
  ctx.beginPath(); ctx.ellipse(0, -7, 4.5, 3.6, -0.15, 0, TAU); fillOut(ctx, c, c.body);
  // The wing.
  ctx.beginPath(); ctx.ellipse(-0.8, -7, 2.8, 1.8, 0.2, 0, TAU); fillOut(ctx, c, c.classic ? '#eee' : shade(c.color, K.parrot ? 0.7 : 0.88));
  // The head (down to peck now and then).
  const hx = 3.4, hy = -10.5 + peck;
  ctx.beginPath(); ctx.arc(hx, hy, 2.4, 0, TAU); fillOut(ctx, c, c.body);
  if (K.comb) { ctx.fillStyle = c.classic ? '#aaa' : K.comb; ctx.beginPath(); ctx.ellipse(hx - 0.4, hy - 2.4, 1.3, 0.9, 0, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.ellipse(hx + 1.8, hy + 1.6, 0.6, 0.9, 0, 0, TAU); ctx.fill(); }
  ctx.beginPath(); ctx.moveTo(hx + 2, hy - 0.8); ctx.lineTo(hx + (K.parrot ? 4 : 4.4), hy + (K.parrot ? 0.8 : 0)); ctx.lineTo(hx + 2, hy + 0.8); ctx.closePath();
  fillOut(ctx, c, c.classic ? '#fff' : K.beak);
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(hx + 0.6, hy - 0.5, 0.55, 0, TAU); ctx.fill();
}

/** A rabbit: crouched, or stretched out in a hop. */
function rabbit(ctx, K, c, a) {
  const st = a.air ? 1 : 0;
  ctx.beginPath(); ctx.ellipse(-0.5, -3.6 + st, 4.5 + st * 1.5, 3.4 - st * 0.6, -0.1 * st, 0, TAU); fillOut(ctx, c, c.body);
  ctx.beginPath(); ctx.arc(-4.8, -4.4, 1.4, 0, TAU); fillOut(ctx, c, c.classic ? '#fff' : '#f4f0ea');
  // Back legs (out behind in a hop), a front paw.
  limb(ctx, c, -2, -1.5, -2 - st * 3, -0.3 + st * 0.5, 1.6, c.body);
  limb(ctx, c, 2.6, -2, 3.2 + st * 1.5, -0.2, 1.1, c.body);
  // The head, the ears.
  ctx.beginPath(); ctx.ellipse(4.5, -6.6, 2.2, 1.9, 0, 0, TAU); fillOut(ctx, c, c.body);
  for (const e of [-0.15, 0.25]) { ctx.beginPath(); ctx.ellipse(3.6 + e * 3, -10.2, 0.9, 2.8, e - 0.2, 0, TAU); fillOut(ctx, c, c.body); }
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(5.4, -7, 0.5, 0, TAU); ctx.fill();
}

/** A frog: squat, its legs folded (stretched in a hop), big eyes. */
function frog(ctx, K, c, a) {
  const st = a.air ? 1 : 0;
  limb(ctx, c, -2.5, -1.5, -4.5 - st * 3, -0.2 + st, 1.4, c.far);
  ctx.beginPath(); ctx.ellipse(0, -2.6, 4, 2.4, -0.15, 0, TAU); fillOut(ctx, c, c.body);
  limb(ctx, c, 2, -1.5, 3, 0, 1.1, c.body);
  for (const ex of [1.6, 3.2]) { ctx.beginPath(); ctx.arc(ex, -4.8, 1.2, 0, TAU); fillOut(ctx, c, c.classic ? '#fff' : '#f2e8a0'); ctx.fillStyle = INK; ctx.fillRect(ex - 0.3, -5.1, 0.7, 0.7); }
  if (!c.classic) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(-0.8, -2.2, 1.2, 0.7, 0, 0, TAU); ctx.ellipse(1.6, -1.6, 0.8, 0.5, 0, 0, TAU); ctx.fill(); }
}

/** A fish, swimming: its body, its tail going, a fin, an eye (and a tropical one's stripes). */
function fish(ctx, K, c, a) {
  const wag = Math.sin(a.t * (a.moving ? 0.45 : 0.15)) * 1.8;
  ctx.beginPath(); ctx.moveTo(-4.5, 0); ctx.lineTo(-8.5, -3 + wag * 0.4); ctx.lineTo(-8.5 + wag * 0.3, 3 + wag * 0.4); ctx.closePath(); fillOut(ctx, c, c.far);
  ctx.beginPath(); ctx.ellipse(0, 0, 5.5, 2.8, 0, 0, TAU); fillOut(ctx, c, c.body);
  ctx.beginPath(); ctx.moveTo(-1.5, -2.4); ctx.lineTo(0.5, -4.2); ctx.lineTo(1.8, -2.5); ctx.closePath(); fillOut(ctx, c, c.far);
  if (!c.classic && FISH.indexOf(c.color) >= 2) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(-1.6, -2.6, 1.2, 5.2); ctx.fillRect(1.6, -2.4, 1, 4.8); }
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(3.2, -0.6, 0.6, 0, TAU); ctx.fill();
}

/** A crab, facing out: its shell, legs either side (scuttling), its claws up, eyes on stalks. */
function crab(ctx, K, c, a) {
  const sc = a.moving ? Math.sin(a.phase * 2) * 0.8 : 0;
  ctx.strokeStyle = c.ink; ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) for (const d of [-1, 1]) { ctx.moveTo(d * 3, -2.5 + i * 0.6); ctx.lineTo(d * (5.5 + i * 0.6), -1.5 + i * 0.4 + (i % 2 ? sc : -sc)); ctx.lineTo(d * (6.2 + i * 0.6), 0); }
  ctx.stroke();
  for (const d of [-1, 1]) { ctx.beginPath(); ctx.arc(d * 5.6, -6, 1.8, 0, TAU); fillOut(ctx, c, c.body); limb(ctx, c, d * 3, -3.5, d * 5, -5.2, 0.9, c.body); }
  ctx.beginPath(); ctx.ellipse(0, -3, 4.2, 2.6, 0, Math.PI, TAU); ctx.lineTo(4.2, -2); ctx.lineTo(-4.2, -2); ctx.closePath(); fillOut(ctx, c, c.body);
  ctx.strokeStyle = c.ink; ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.moveTo(-1.2, -5); ctx.lineTo(-1.4, -7); ctx.moveTo(1.2, -5); ctx.lineTo(1.4, -7); ctx.stroke();
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(-1.4, -7.3, 0.6, 0, TAU); ctx.arc(1.4, -7.3, 0.6, 0, TAU); ctx.fill();
}
