// Dev mode (worlds: your own, played alone or hosted): for exploring and trying things out. You
// fly anywhere, through anything, fast; the wheel zooms a long way out (and back in); everything's
// lit; left click wipes out blocks (any: bedrock, towns, bases), a brush's worth at a time, and
// right click builds with the block in hand (nothing's used up); nothing hurts you. Keys (main.js)
// change the brush, the time of day, the lights and monsters, and take you places: back to the
// start, up to the surface, down to the deep, and to the next town either way.

import * as K from './blocks.js';
import { TILE, AIR, NO_WALL, SOLID } from './blocks.js';
import { WORLD_H } from './worldgen.js';
import { DAY_TICKS, hourOf, isMonster } from './monsters.js';
import { MOTION, BODY } from '../config.js';

/** How far the crosshair reaches (tiles), and the biggest brush (tiles each way from the middle). */
export const DEV_REACH = 70, DEV_BRUSH_MAX = 6;

export const devOn = s => !!s?.world?.dev;

/** Dev mode on or off for soldier s (a player). */
export function setDev(game, s, on) {
  const w = s.world;
  if (!w) return;
  w.dev = on ? { brush: 1, lights: true } : null;
  if (!on) { s.body.vx = s.body.vy = 0; }
  game.notify(s, on ? 'Dev mode: fly with the movement keys (sprint: faster), wheel: zoom, left click: wipe out, right click: build' : 'Dev mode off');
}

/**
 * Flying (the world mode's moveSoldier hook): through anything, in any direction (jump: up,
 * crouch: down), faster sprinting. Returns true if it moved the soldier (else the game does).
 */
export function devFly(game, s, inp) {
  if (!devOn(s)) return false;
  const b = s.body, speed = (inp.sprint ? 30 : 10) * MOTION.timeScale;
  const dx = Math.sign(inp.move || 0), dy = (inp.jump ? -1 : 0) + (inp.crouch ? 1 : 0);
  b.vx = dx * speed;
  b.vy = dy * speed;
  b.x += b.vx;
  b.y = Math.max(-BODY.top, Math.min(WORLD_H * TILE - BODY.bottom - 1, b.y + b.vy));
  b.onGround = false;
  b.jetting = false;
  b.crouching = false;
  b.rope = null;
  return true;
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
 * builds with the block (or wall) in hand. Returns the input for the rest of the update.
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
        else if (world.tile(x, y) === AIR && !(SOLID[held.block] && soldierAt(game, x, y))) world.setTile(x, y, held.block);
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
function moveTo(s, x, y) {
  s.body.x = x;
  s.body.y = y;
  s.body.vx = s.body.vy = 0;
}

/**
 * A dev mode key (a key code): changes something and says what, or false if it isn't one of
 * them. The keys: [ ] the brush, L the lights, N the time, V monsters, H the start, U the
 * surface, J the deep, comma and full stop the next town west and east.
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
      if (world.devQuiet) for (const m of game.soldiers.filter(isMonster)) game.removeSoldier(m);
      return say(world.devQuiet ? 'No monsters' : 'Monsters come out again');
    case 'KeyH': { const p = world.spawns[0]; moveTo(s, p.x, p.y); return say('Back at the start'); }
    case 'KeyU': moveTo(s, s.x, (world.gen.surfaceAt(tx) - 3) * TILE); return say('Up on the surface');
    case 'KeyJ': moveTo(s, s.x, (WORLD_H - 40) * TILE); return say('Down in the deep');
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
    `DEV MODE  ·  brush ${dev.brush * 2 - 1}×${dev.brush * 2 - 1}  ·  zoom ${zoom.toFixed(2)}×  ·  ${dev.lights ? 'all lit' : 'lit as it is'}`,
    'Fly: move keys, jump/crouch up/down, sprint fast  ·  wheel or + -: zoom  ·  [ ]: brush',
    'L: lights  ·  N: time  ·  V: monsters  ·  H: start  ·  U: surface  ·  J: deep  ·  , .: next town',
  ];
}

