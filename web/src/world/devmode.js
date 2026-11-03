// Dev mode (worlds: your own, played alone or hosted): for exploring and trying things out. You
// fly anywhere, through anything, fast; the wheel zooms a long way out (and back in); everything's
// lit; left click wipes out blocks (any: bedrock, towns, bases), a brush's worth at a time, and
// right click builds with the block in hand (nothing's used up); god mode: nothing hurts you and
// you can't die. Keys (main.js) change the brush, the time of day, the lights and monsters, and
// take you places: back to the start, up to the surface, down to the deep, and to the next town
// either way. The dev menu (P: devtools.js, devpanel.js) has the rest: invisible, flying or
// walking, summoning beasts (on your side, or not), strikes, gear, and other players (the host's).

import * as K from './blocks.js';
import { TILE, AIR, NO_WALL, SOLID } from './blocks.js';
import { WORLD_H } from './worldgen.js';
import { DAY_TICKS, hourOf, isHostile } from './monsters.js';
import { MOTION, BODY } from '../config.js';
import { afterPlace } from './decor.js';

/** How far the crosshair reaches (tiles), and the biggest brush (tiles each way from the middle). */
export const DEV_REACH = 70, DEV_BRUSH_MAX = 6;
/** Flying: how fast (pixels an update at full game speed; sprinting), and how much of the way to that each update goes (it speeds up and slows down over a tenth of a second or so). */
export const FLY_SPEED = 10, FLY_SPRINT = 30, FLY_EASE = 0.35;

export const devOn = s => !!s?.world?.dev;
/** God mode (dev mode's, to start with): nothing hurts them, and they can't die. */
export const godOn = s => !!s?.world?.dev?.god;
/** Invisible (dev mode's): monsters don't see them, and neither do other players (online: hidden, roster's). */
export const unseen = s => !!(s?.world?.dev?.invisible || s?.hidden);
/**
 * Dev mode as our own screen has it: ours, or (in someone else's world) the host's say-so, ours
 * in a creative world (worldnet.js's hostDev): flying, the camera, crafting and the codex.
 */
export const devView = s => !!(s?.world?.dev || s?.world?.hostDev);

/** Dev mode on or off for soldier s (a player). Off inside the ground: out to the nearest place there's room for them. */
export function setDev(game, s, on) {
  const w = s.world;
  if (!w) return;
  // (god: can't be hurt or die; invisible: not seen; fly: through anything, else walking; speed: flying's.)
  w.dev = on ? { brush: 1, lights: true, god: true, invisible: false, fly: true, speed: 1 } : null;
  let out = false;
  if (!on) { s.body.vx = s.body.vy = 0; out = outOfBlocks(game.world, s); }
  game.notify(s, on ? 'Dev mode: fly with the movement keys (sprint: faster), wheel: zoom, left click: wipe out, right click: build' : `Dev mode off${out ? ' (out of the ground, to the nearest place with room for you)' : ''}`);
}

// (Out of the ground: the tiles round about, nearest first, as far as this many each way.)
const OUT_REACH = 24;
const OUT_STEPS = [];
for (let dy = -OUT_REACH; dy <= OUT_REACH; dy++) for (let dx = -OUT_REACH; dx <= OUT_REACH; dx++) OUT_STEPS.push([dx, dy]);
OUT_STEPS.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));

/**
 * Soldier s, if they're in the ground (blocks where they are): out to the nearest spot with room
 * for them, standing in a tile (none near: up on the surface). Returns true if they were moved.
 */
export function outOfBlocks(world, s) {
  const b = s.body;
  const fits = (x, y) => y + BODY.top >= 0 && y + BODY.bottom < WORLD_H * TILE && !world.overlap(x - BODY.halfW, y + BODY.top, x + BODY.halfW, y + BODY.bottom);
  if (fits(b.x, b.y)) return false;
  const tx = Math.floor(b.x / TILE), ty = Math.floor((b.y + BODY.bottom) / TILE);
  for (const [dx, dy] of OUT_STEPS) {
    // (Feet at the bottom of tile (tx + dx, ty + dy), in the middle of it.)
    const x = (tx + dx) * TILE + TILE / 2, y = (ty + dy + 1) * TILE - BODY.bottom - 1;
    if (fits(x, y)) { moveTo(s, x, y); return true; }
  }
  moveTo(s, tx * TILE + TILE / 2, world.surface(tx) * TILE - BODY.bottom - 1);
  return true;
}

/**
 * The nearest spot to tile (tx, ty) with room for someone to stand (on a floor if there's one
 * near): { x, y } (their middle), or the surface above it.
 */
export function openSpotNear(world, tx, ty) {
  const fits = (x, y) => y + BODY.top >= 0 && y + BODY.bottom < WORLD_H * TILE && !world.overlap(x - BODY.halfW, y + BODY.top, x + BODY.halfW, y + BODY.bottom);
  let open = null;
  for (const [dx, dy] of OUT_STEPS) {
    const x = (tx + dx) * TILE + TILE / 2, y = (ty + dy + 1) * TILE - BODY.bottom - 1;
    if (!fits(x, y)) continue;
    // (Standing on something, best; the first with room, else.)
    if (SOLID[world.tile(tx + dx, ty + dy + 1)]) return { x, y };
    open ||= { x, y };
    if (dx * dx + dy * dy > 36) break;
  }
  return open || { x: tx * TILE + TILE / 2, y: world.surface(tx) * TILE - BODY.bottom - 1 };
}

/**
 * Flying (the world mode's moveSoldier hook): through anything, in any direction (jump: up,
 * crouch: down; across and up at once, no faster), faster sprinting, speeding up and slowing
 * down smoothly. Returns true if it moved the soldier (else the game does).
 */
export function devFly(game, s, inp) {
  if (!devOn(s) || s.world.dev.fly === false) return false;
  // (Where it was, its aim and animation, as walking keeps them: without them it's drawn, and the
  // camera follows it, somewhere between where it is and where dev mode began.)
  s.beginMove(inp);
  flyBody(s.body, inp, s.world.dev.speed || 1);
  s.animate();
  return true;
}

/**
 * A flying body's update (dev mode's: here, and online, where a guest's own screen moves them
 * straight away, net/client.js, as the host does).
 */
export function flyBody(b, inp, mult = 1) {
  const dx = Math.sign(inp.move || 0), dy = (inp.jump ? -1 : 0) + (inp.crouch ? 1 : 0);
  const speed = (inp.sprint ? FLY_SPRINT : FLY_SPEED) * MOTION.timeScale * mult * (dx && dy ? Math.SQRT1_2 : 1);
  b.vx = toward(b.vx, dx * speed);
  b.vy = toward(b.vy, dy * speed);
  b.x += b.vx;
  // (The top and bottom of the world: stopped there.)
  const y = b.y + b.vy;
  b.y = Math.max(-BODY.top, Math.min(WORLD_H * TILE - BODY.bottom - 1, y));
  if (b.y !== y) b.vy = 0;
  b.onGround = false;
  b.jetting = false;
  b.crouching = false;
  b.rope = null;
  // (Flying through water isn't swimming in it: no splashes or bubbles.)
  b.swimming = b.under = b.leaping = false;
}

/** A flying speed (v) on its way to another (to): there, once it's next to it (stopped, or at full speed). */
function toward(v, to) {
  const n = v + (to - v) * FLY_EASE;
  return Math.abs(to - n) < 0.05 ? to : n;
}

/** The tile under the crosshair, as far as dev mode reaches. */
function devTarget(s, inp) {
  const d = Math.min(inp.aimDist ?? 0, DEV_REACH * TILE), a = inp.aim ?? s.aim;
  const x = s.shoulderX + Math.cos(a) * d, y = s.shoulderY + Math.sin(a) * d;
  return { tx: Math.floor(x / TILE), ty: Math.floor(y / TILE), near: true };
}

/**
 * Dev mode's part in a soldier's update (worldplay.js's input hook calls it first): left click
 * wipes out the blocks in the brush (where there are none, the walls behind), right click
 * builds with the block (or wall) in hand; with a bucket, pours water out (a full one: sources,
 * into the open and flowing water) or takes it away (an empty one: any water). Nothing's used up.
 * Returns the input for the rest of the update.
 */
export function devInput(game, s, inp, held) {
  const w = s.world, dev = w.dev, world = game.world;
  w.target = devTarget(s, inp);
  const { tx, ty } = w.target, r = dev.brush - 1;
  if (inp.fire) {
    let blocks = false;
    for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) if (y >= 0 && y < WORLD_H && world.tile(x, y) !== AIR) { world.setTile(x, y, AIR); blocks = true; }
    if (!blocks) for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) if (y >= 0 && y < WORLD_H) world.setWall(x, y, NO_WALL);
    if (game.tick % 6 === 0) game.sound(blocks ? 'smash' : 'thunk', tx * TILE + 8, ty * TILE + 8);
  } else if (inp.alt && held && (held.kind === 'block' || held.kind === 'wall')) {
    for (let y = ty - r; y <= ty + r; y++) {
      for (let x = tx - r; x <= tx + r; x++) {
        if (y < 0 || y >= WORLD_H) continue;
        if (held.kind === 'wall') { if (world.wall(x, y) === NO_WALL) world.setWall(x, y, held.wall); }
        // (Its variant and shape too: decor.js.)
        else if (world.tile(x, y) === AIR && !(SOLID[held.block] && soldierAt(game, x, y))) { world.setTile(x, y, held.block); afterPlace(world, held, x, y, s); }
      }
    }
  } else if (inp.alt && held?.kind === 'bucket') {
    const F = K.FLUIDS[K.FLUID[K.BLOCK_BY_KEY.get(held.fluid)?.id] || 0];
    for (let y = Math.max(1, ty - r); y <= Math.min(WORLD_H - 2, ty + r); y++) {
      for (let x = tx - r; x <= tx + r; x++) {
        const id = world.tile(x, y);
        if (F ? K.WASH[id] || (K.FLUID[id] && !K.SOURCE[id]) : K.PURE[id]) world.setTile(x, y, F ? F.source : AIR);
      }
    }
  }
  return { ...inp, fire: false, firePressed: false, alt: false };
}

/** True if a soldier stands in tile (x, y) (blocks don't go in on top of anyone). */
function soldierAt(game, x, y) {
  const l = x * TILE, t = y * TILE;
  for (const s of game.soldiers) if (s.alive && s.x + BODY.halfW > l && s.x - BODY.halfW < l + TILE && s.y + BODY.bottom > t && s.y + BODY.top < t + TILE) return true;
  return false;
}

// ---- The keys (main.js passes them on, in dev mode) ------------------------------------------------

/** The next quarter of the day: morning, noon, evening, midnight. */
function nextQuarter(world) {
  const h = hourOf(world.time || 0), hours = [7, 12, 19, 0], next = hours.find(x => x > h + 0.5 && x !== 0) ?? 0;
  const day = Math.floor((world.time || 0) / DAY_TICKS);
  // (World time 0 is six in the morning.)
  world.time = (day + (next === 0 ? 1 : 0)) * DAY_TICKS + (((next - 6 + 24) % 24) / 24) * DAY_TICKS;
  return next;
}

/** Soldier s to world point (x, y) (their middle), stopped. */
export function moveTo(s, x, y) {
  s.body.x = x;
  s.body.y = y;
  s.body.vx = s.body.vy = 0;
}

/**
 * A dev mode key (a key code): changes something and says what, or false if it isn't one of
 * them. The keys: [ ] the brush, L the lights, N the time, V monsters, H the start, U the
 * surface, O the deep, comma and full stop the next town west and east. (None of them a key the
 * game's actions have: J, the journal, the codex with it, is still the journal: main.js.)
 */
export function devKey(game, s, code) {
  const dev = s.world?.dev, world = game.world;
  if (!dev) return false;
  const tx = Math.floor(s.x / TILE), say = text => { game.notify(s, text); return true; };
  switch (code) {
    case 'BracketLeft': dev.brush = Math.max(1, dev.brush - 1); return say(`Brush: ${dev.brush * 2 - 1} × ${dev.brush * 2 - 1}`);
    case 'BracketRight': dev.brush = Math.min(DEV_BRUSH_MAX, dev.brush + 1); return say(`Brush: ${dev.brush * 2 - 1} × ${dev.brush * 2 - 1}`);
    case 'KeyL': dev.lights = !dev.lights; return say(dev.lights ? 'Everything lit' : 'Lit as it is');
    case 'KeyN': { const h = nextQuarter(world); return say(`It's ${h === 0 ? 'midnight' : h === 12 ? 'noon' : h === 7 ? 'morning' : 'evening'}`); }
    case 'KeyV':
      world.devQuiet = !world.devQuiet;
      // (Not the ones on someone's side: summoned allies stay.)
      if (world.devQuiet) for (const m of game.soldiers.filter(isHostile)) game.removeSoldier(m);
      return say(world.devQuiet ? 'No monsters' : 'Monsters come out again');
    case 'KeyH': { const p = world.spawns[0]; moveTo(s, p.x, p.y); return say('Back at the start'); }
    case 'KeyU': moveTo(s, s.x, (world.gen.surfaceAt(tx) - 3) * TILE); return say('Up on the surface');
    case 'KeyO': moveTo(s, s.x, (WORLD_H - 40) * TILE); return say('Down in the deep');
    case 'Comma': case 'Period': {
      const dir = code === 'Comma' ? -1 : 1, g = world.gen;
      for (let k = g.regionAt(tx) + dir, n = 0; n < 60; k += dir, n++) {
        const t = g.townIn(k);
        if (!t) continue;
        const x = ((t.x0 + t.x1) >> 1) * TILE + TILE / 2;
        moveTo(s, x, (t.level - 3) * TILE);
        return say(`${t.name} (${t.kind})`);
      }
      return say(g.towns ? 'No town that way for a long way' : 'This world has no towns (it was made before them)');
    }
    default: return false;
  }
}

/** What the HUD shows in dev mode: the settings, and the keys. */
export function devLines(s, zoom) {
  const dev = s.world.dev;
  return [
    `DEV MODE  ·  P: dev menu  ·  ${dev.god ? 'god mode' : 'mortal'}${dev.invisible ? '  ·  invisible' : ''}${dev.fly === false ? '  ·  walking' : ''}  ·  brush ${dev.brush * 2 - 1}×${dev.brush * 2 - 1}  ·  zoom ${zoom.toFixed(2)}×  ·  ${dev.lights ? 'all lit' : 'lit as it is'}`,
    'Fly: move keys, jump/crouch up/down, sprint fast  ·  wheel or + -: zoom  ·  [ ]: brush',
    'L: lights  ·  N: time  ·  V: monsters  ·  H: start  ·  U: surface  ·  O: deep  ·  , .: next town  ·  bag, codex: anything, free',
  ];
}

