// Boats (world mode): rafts, rowing boats and sailboats. Made at a workbench (crafting.js) and put
// on water with a click (either hand, on the water's top, in reach), they float there: bobbing,
// carried along by flowing water (tileworld.js's currentAt), drifting slowly with nobody in them,
// run aground on a shore. Right click one to get in (a rowing boat or a sailboat has room for two:
// the first in rows), left and right row it, and a jump gets you out; whoever's in one can still
// shoot and use what's in their hands. A boat stops at the shore: it isn't rowed up onto land. Hit
// one a few times (with no gun in hand) and it breaks, back into the thing it was made as. Only
// players get in: monsters and animals don't, and fish swim under.
//
// Boats are in world.boats (by number): { id, kind, x (its middle), y (its waterline: where the
// water's top meets the hull), vx, vy, rider (who's rowing: a soldier's id, or -1), passenger
// (or -1), hp }. They're kept with the world (main.js, worldsave.js). Online, the host's boats go
// to each player with the events (worldnet.js), and a player rowing one moves it on their own
// screen as the host does: physics.js hands a body in a boat to rideBoat (world.rideBoat, set by
// worldplay.js), on both.

import { TILE, SOLID, LIQUID, fluidHeight } from './blocks.js';
import { BODY, PHYS, MOTION } from '../config.js';
import { WEAPONS } from '../weapons.js';
import { startAct } from '../useanim.js';
import { CHUNK } from './worldgen.js';
import { windOf } from './sky.js';

/**
 * Each kind: its name; how fast it goes (of the running speed) and how soon it gets there; its
 * seats (across from its middle: whoever's in the first rows); its length; how deep its hull goes
 * under the waterline (keel) and how high it stands over it (rim); how high over the waterline
 * whoever's in it is (their middle); how many hits break it; and what it's for, in words.
 */
export const BOATS = {
  raft: { name: 'Raft', speed: 0.8, accel: 0.05, seats: [0], len: 38, keel: 4, rim: 7, sit: 17, hp: 3, about: 'Slow, and holds one' },
  rowboat: { name: 'Rowing boat', speed: 1.2, accel: 0.06, seats: [-10, 10], len: 44, keel: 6, rim: 7, sit: 11, hp: 4, about: 'Quicker than running, and holds two' },
  sailboat: { name: 'Sailboat', speed: 0.85, accel: 0.045, seats: [-13, 13], len: 54, keel: 6, rim: 7, sit: 11, hp: 5, sail: true, about: 'Quickest with the wind behind it (slower into it), and holds two' },
};
/** The kinds by number (online). */
export const BOAT_KINDS = Object.keys(BOATS);

// Flowing water: how fast it carries a boat along (of the running speed). Not rowed: how soon a
// boat slows (of the ground's grip), and how soon one with nobody in it drifts as the water and
// wind take it; how fast the wind takes one (a sail: more). A sail: how much faster with the wind
// behind it, and slower into it (of the running speed, at the strongest wind).
const CARRY = 0.28, COAST = 0.025, DRIFT = 0.015, WIND_DRIFT = 0.03, SAIL_DRIFT = 0.12, SAIL_WITH = 1, SAIL_INTO = 0.3;
// The strongest wind there is (sky.js's windOf: pixels an update).
const WIND_MOST = 0.22;
// Getting out: a hop (of a jump). How much the water's top can change under the bow (px) and still
// be rowed on (more: the shore, or a waterfall's top). How far a rider can be from their seat and
// still be in it (px: further, they were taken away). Online: how long after getting out a player's
// own screen waits for the host to see it (updates).
const HOP = 0.7, STEP = 7, GONE = 40, REBOARD = 40;
/** The most boats a world holds. */
export const MOST_BOATS = 400;
// How long after the last hit a boat's whole again (updates).
const MEND = 300;

const water = id => LIQUID[id] === 1;

/**
 * The water's top under x, near height y (px): from y up through water to its top (a tile or two at
 * most: deeper down isn't floating), or down through the open to it (a few tiles). null: no water
 * there (land, or a long way down).
 */
export function waterTop(world, x, y) {
  const tx = Math.floor(x / TILE), y0 = Math.floor(y / TILE);
  let ty = y0;
  if (water(world.tile(tx, ty))) {
    while (ty > y0 - 2 && water(world.tile(tx, ty - 1))) ty--;
    if (water(world.tile(tx, ty - 1))) return null;
  } else {
    for (let n = 0; ; n++) {
      if (n >= 3 || SOLID[world.tile(tx, ty)]) return null;
      ty++;
      if (water(world.tile(tx, ty))) break;
    }
  }
  return ty * TILE + TILE * (1 - fluidHeight(world.tile(tx, ty), world.tile(tx, ty - 1)));
}

/** A boat's gentle bob (px) at time t. */
export const bobOf = (t, id) => Math.sin(t * 0.06 + id * 2.3) * 1.1;

/** The wind (sky.js: the same all over a world), from -1 (west, the strongest) to 1. */
export const windIn = world => Math.max(-1, Math.min(1, windOf(world.seed ?? world.gen?.seed ?? 0) / WIND_MOST));

/**
 * How fast (px an update) a boat of kind `def` wants to go, rowed `move` (-1, 0 or 1): its speed
 * (a sail's with or into the wind), and the flow of the water it's on.
 */
function wantSpeed(world, def, x, top, move) {
  let v = 0;
  if (def.sail) {
    const w = windIn(world);
    if (move) v = move * PHYS.runSpeed * (def.speed + (move * w > 0 ? SAIL_WITH * Math.abs(w) : -SAIL_INTO * Math.abs(w)));
  } else v = move * PHYS.runSpeed * def.speed;
  const cur = world.currentAt(x, top + 3);
  if (cur === 1 || cur === -1) v += cur * PHYS.runSpeed * CARRY;
  return v;
}

/**
 * How far a boat (middle hx, waterline top) can go across by dx: none if its bow would run onto
 * the shore (no water under it, or water much higher or lower: a bank, a waterfall's top), into
 * something solid in the water, or under something too low for whoever's in it.
 */
export function clearWay(world, def, hx, top, dx) {
  if (!dx) return 0;
  const dir = dx > 0 ? 1 : -1, half = def.len / 2, bow = hx + dx + dir * half;
  const t = waterTop(world, bow, top);
  if (t === null || Math.abs(t - top) > STEP) return 0;
  const a = Math.min(hx + dir * half, bow), b = Math.max(hx + dir * half, bow);
  if (world.overlap(a, top - def.rim, b, top + def.keel - 1)) return 0;
  // (Heads: whoever's in it, crouched down.)
  for (const sx of def.seats) {
    const x = hx + dx + sx;
    if (world.overlap(x - BODY.halfW, top - def.sit + BODY.crouchTop, x + BODY.halfW, top - def.rim - 1)) return 0;
  }
  return dx;
}

/** Whether there's world loaded round x, y (a far boat waits: it doesn't make the land round it). */
function loaded(world, x, y, half) {
  if (!world.has) return true;
  const R = CHUNK * TILE, cy = Math.floor(y / R);
  return world.has(Math.floor((x - half - 8) / R), cy) && world.has(Math.floor((x + half + 8) / R), cy);
}

// ---- Putting one on the water ------------------------------------------------------------------------

/**
 * Where a boat of kind `kind` would go, put on the water at (x, y) (a click there): { x, y (its
 * waterline) }, or a reason it can't ('water': there's none; 'room': something's in the way).
 */
export function launchSpot(world, kind, x, y) {
  const def = BOATS[kind];
  if (!def) return { why: 'water' };
  // (Clicked on the water, or just over its top.)
  const top = waterTop(world, x, y) ?? waterTop(world, x, y + TILE);
  if (top === null) return { why: 'water' };
  const half = def.len / 2;
  // Water under both ends, at much the same height (a shore within it: moved off it, a little).
  let hx = x;
  for (let tries = 0; tries < 12; tries++) {
    const l = waterTop(world, hx - half + 2, top), r = waterTop(world, hx + half - 2, top);
    const okL = l !== null && Math.abs(l - top) <= STEP, okR = r !== null && Math.abs(r - top) <= STEP;
    if (okL && okR) break;
    if (!okL && !okR) return { why: 'water' };
    hx += okL ? -2 : 2;
    if (tries === 11) return { why: 'water' };
  }
  if (world.overlap(hx - half, top - def.rim - 6, hx + half, top + def.keel - 1)) return { why: 'room' };
  return { x: hx, y: top };
}

/** A new boat of kind `kind` in the world, at (x, its waterline y). Returns it (null: too many). */
export function addBoat(world, kind, x, y) {
  const boats = world.boats ||= new Map();
  if (!BOATS[kind] || boats.size >= MOST_BOATS) return null;
  world.boatSeq = Math.max(world.boatSeq || 1, 1);
  while (boats.has(world.boatSeq)) world.boatSeq++;
  const b = { id: world.boatSeq++, kind, x, y, px: x, py: y, vx: 0, vy: 0, rider: -1, passenger: -1, hp: BOATS[kind].hp, hitAt: -1e9 };
  boats.set(b.id, b);
  return b;
}

/** The boat whose hull is at (x, y), or null. */
export function boatAt(world, x, y) {
  const boats = world.boats;
  if (!boats?.size) return null;
  for (const b of boats.values()) {
    const def = BOATS[b.kind];
    if (Math.abs(x - b.x) <= def.len / 2 + 2 && y >= b.y - def.rim - 6 && y <= b.y + def.keel + 3) return b;
  }
  return null;
}

// ---- Getting in and out ------------------------------------------------------------------------------

/** The soldier with id `id`, or null. */
const soldierById = (game, id) => (id >= 0 ? game.soldiers.find(o => o.id === id) || null : null);

/** Body put in its seat (sx: across; top: the waterline under it). */
function sitIn(body, def, sx, top, bob) {
  body.x = sx;
  body.y = top + bob - def.sit;
  body.vy = 0;
  body.onGround = true;
  body.crouching = true;
}

/**
 * Player s gets in boat b (a right click on it): at the oars if there's nobody there, else in the
 * other seat. Monsters, animals and townsfolk don't. Returns whether they did.
 */
export function board(game, s, b) {
  const def = BOATS[b?.kind];
  if (!def || !s?.alive || !s.world || s.npc || s.body.boat || s.world.dev) return false;
  const seat = b.rider < 0 ? 0 : def.seats.length > 1 && b.passenger < 0 ? 1 : -1;
  if (seat < 0) { game.notify(s, `The ${def.name.toLowerCase()} is full`); return false; }
  if (seat === 0) b.rider = s.id; else b.passenger = s.id;
  const body = s.body;
  body.boat = { id: b.id, kind: b.kind, seat };
  body.vx = seat === 0 ? b.vx : 0;
  body.rope = null; body.climbing = false; body.glide = 0; body.momentum = 0;
  sitIn(body, def, b.x + def.seats[seat], b.y, bobOf(game.world.time || 0, b.id));
  if (!s.world.toldBoat) { s.world.toldBoat = true; game.notify(s, `In the ${def.name.toLowerCase()}: left and right ${seat === 0 ? 'row it' : 'are the rower\'s'}, jump to get out`); }
  game.sound('splash', b.x, b.y);
  return true;
}

/** Body gets out of its boat (hop: with a hop up, as a jump does). Online, its own screen remembers when. */
export function getOut(game, body, hop = true) {
  body.boat = null;
  body.leftBoat = game.tick;
  body.onGround = false;
  if (!game.world.overlap(body.x - BODY.halfW, body.y + BODY.top, body.x + BODY.halfW, body.y + BODY.crouchTop)) body.crouching = false;
  if (hop) { body.vy = -PHYS.jumpSpeed * HOP; body.jumped = true; }
}

/**
 * A body in a boat (body.boat: { id, kind, seat }), one update (physics.js's world.rideBoat): sat
 * in its seat, the rower steering with left and right (input.move), a jump getting out. The same
 * steps on the host and, for a player's own, on their screen online (where it goes is the
 * rower's own: it's the boat's).
 */
export function rideBoat(game, body, input) {
  const world = game.world, at = body.boat, def = BOATS[at.kind];
  body.climbing = false; body.swimming = false; body.under = false; body.rope = null;
  body.glide = 0; body.leaping = false; body.sprinting = false; body.momentum = 0;
  if (!def) { body.boat = null; return; }
  if (input.jumpPressed) { getOut(game, body); return; }
  const b = world.boats?.get(at.id) || null, seat = def.seats[at.seat] ?? 0, bob = bobOf(world.time || 0, at.id);
  // (Taken away from it, by a recall scroll or a waystone, say: out of it. The host's say: on a
  // player's own screen online, the boat's where the host last had it, a moment behind.)
  if (b && !game.mirror && Math.abs(body.x - seat - b.x) > GONE) { getOut(game, body, false); return; }
  if (at.seat === 0) {
    const hx = body.x - seat, top = waterTop(world, hx, body.y + def.sit - bob);
    if (top === null) {
      // Aground (the water gone from under it): it goes nowhere, as it lies.
      body.vx = 0;
      if (b) sitIn(body, def, b.x + seat, b.y, 0);
      else sitIn(body, def, body.x, body.y + def.sit, 0);
      return;
    }
    const want = wantSpeed(world, def, hx, top, Math.sign(input.move || 0));
    const accel = PHYS.groundAccel * (input.move ? def.accel : COAST), dv = want - body.vx;
    body.vx += dv > accel ? accel : dv < -accel ? -accel : dv;
    const dx = clearWay(world, def, hx, top, body.vx);
    if (dx !== body.vx) body.vx = 0;
    const nx = hx + dx, t2 = waterTop(world, nx, top) ?? top;
    sitIn(body, def, nx + seat, t2, bob);
    return;
  }
  // The other seat: where the boat is (with whoever's rowing it, as they're shown).
  if (!b) { getOut(game, body, false); return; }
  const d = soldierById(game, b.rider), rowed = d?.body.boat?.id === b.id && d.body.boat.seat === 0;
  const hx = rowed ? d.body.x - def.seats[0] : b.x, afloat = rowed || waterTop(world, hx, b.y) !== null;
  body.vx = rowed ? d.body.vx : b.vx;
  sitIn(body, def, hx + seat, rowed ? d.body.y + def.sit - bob : b.y, afloat ? bob : 0);
}

// ---- Hitting ----------------------------------------------------------------------------------------

/**
 * Player s hits boat b (the use button on it, with no gun in hand: `axe`, an axe). A few hits and
 * it breaks: whoever's in it is out, and it's back as the thing it was (give(game, s, key): into
 * their hands, worldplay.js). With PvP off, nobody breaks a boat someone else is in. Returns whether it was hit.
 */
export function hitBoat(game, s, b, axe, give) {
  const others = [b.rider, b.passenger].some(id => id >= 0 && id !== s.id);
  if (others && game.world.pvp === false) { game.notify(s, 'Someone\'s in that boat'); return false; }
  b.hp -= axe ? 2 : 1;
  b.hitAt = game.tick;
  game.sound('thunk', b.x, b.y);
  if (b.hp > 0) return true;
  breakBoat(game, b);
  give(game, s, b.kind);
  game.sound('smash', b.x, b.y);
  return true;
}

/** Boat b breaks (or is taken away): whoever's in it is out, in the water. */
export function breakBoat(game, b) {
  for (const id of [b.rider, b.passenger]) {
    const o = soldierById(game, id);
    if (o?.body.boat?.id === b.id) getOut(game, o.body, false);
  }
  game.world.boats?.delete(b.id);
  game.fx?.splash?.(b.x, b.y, 3);
}

// ---- A player's clicks ----------------------------------------------------------------------------------

const isGun = it => it?.kind === 'weapon' && WEAPONS[it.weapon]?.kind !== 'melee';
const inReach = (s, t, reach) => Math.hypot(t.x - s.shoulderX, t.y - s.shoulderY) <= reach;

/**
 * Player s puts boat `item` (in either hand) on the water where they clicked, if it's in reach
 * (hooks.reach: px). Returns whether it went in.
 */
export function launch(game, s, item, hooks) {
  const t = s.world?.target, world = game.world;
  if (!t || !inReach(s, t, hooks.reach)) return false;
  const at = launchSpot(world, item.boat, t.x, t.y);
  if (at.why) { game.notify(s, at.why === 'water' ? 'A boat goes on water: click the water\'s top' : 'There\'s no room for it there'); return false; }
  const b = addBoat(world, item.boat, at.x, at.y);
  if (!b) { game.notify(s, 'There are too many boats in this world'); return false; }
  s.world.inv.remove(item.key, 1);
  startAct(s, 'place', 14);
  game.sound('splash', at.x, at.y);
  game.fx?.splash?.(at.x, at.y, 2);
  return true;
}

/**
 * A player's clicks on a boat in reach (worldplay.js's worldInput: the host's): right click gets
 * in (not crouching: that's for what's in the right hand); the use button, with no gun in hand,
 * hits it. Returns 'alt' or 'fire' (the click that was taken), else null. hooks: { reach (px),
 * give(game, s, key): a boat broken, back to whoever broke it }.
 */
export function boatInput(game, s, inp, item, altPressed, firePressed, hooks) {
  const w = s.world, t = w?.target, world = game.world;
  if (!t || !world.boats?.size || !(altPressed || firePressed) || !inReach(s, t, hooks.reach)) return null;
  const b = boatAt(world, t.x, t.y);
  if (!b) return null;
  // (A click on a boat is the boat's: even full, or between hits, it puts nothing in the water there.)
  if (altPressed && !inp.crouch && !s.body.boat) { board(game, s, b); return 'alt'; }
  if (firePressed && !isGun(item)) {
    if ((w.cool || 0) <= 0 && hitBoat(game, s, b, item?.tool === 'axe', hooks.give)) {
      w.cool = 12 / MOTION.timeScale;
      startAct(s, item?.tool === 'axe' ? 'chop' : 'punch', 12);
    }
    return 'fire';
  }
  return null;
}

// ---- Each update -------------------------------------------------------------------------------------

/** Whoever's in seat `seat` of boat b, still (alive, in it, and with it): else the seat's emptied. */
function seated(game, b, def, seat) {
  const key = seat === 0 ? 'rider' : 'passenger', s = soldierById(game, b[key]);
  if (!s) { b[key] = -1; return null; }
  const at = s.body.boat, x = b.x + def.seats[seat];
  if (s.alive && at?.id === b.id && at.seat === seat && !s.world?.dev && Math.abs(s.body.x - x) < GONE && Math.abs(s.body.y + def.sit - b.y) < GONE) return s;
  if (at?.id === b.id) getOut(game, s.body, false);
  b[key] = -1;
  return null;
}

/**
 * Every boat, each update (the host's; offline, the game's): the rowed ones where their rowers
 * have them, the rest floating (on the water's top, carried by its flow and drifting with the
 * wind), aground, or falling; and the passengers with them.
 */
export function boatsTick(game) {
  const world = game.world, boats = world.boats;
  if (!boats?.size || game.mirror) return;
  const g = PHYS.gravity, ts = MOTION.timeScale;
  for (const b of boats.values()) {
    const def = BOATS[b.kind], half = def.len / 2;
    b.px = b.x; b.py = b.y;
    if (b.hp < def.hp && game.tick - b.hitAt > MEND / ts) b.hp = def.hp;
    const d = seated(game, b, def, 0), p = seated(game, b, def, 1);
    if (!d && !p && !loaded(world, b.x, b.y, half)) continue;
    const top = waterTop(world, d ? d.body.x - def.seats[0] : b.x, b.y);
    if (d && top !== null) {
      // Rowed: where its rower has it.
      b.x = d.body.x - def.seats[0];
      b.y = top;
      b.vx = d.body.vx;
      b.vy = 0;
    } else if (top !== null && top - b.y <= 2) {
      // Floating: on the water's top, carried by its flow, drifting with the wind.
      b.y += (top - b.y) * 0.5;
      b.vy = 0;
      const w = windIn(world) * PHYS.runSpeed * (def.sail ? SAIL_DRIFT : WIND_DRIFT), want = wantSpeed(world, def, b.x, top, 0) + w;
      const ease = PHYS.groundAccel * DRIFT, dv = want - b.vx;
      b.vx += dv > ease ? ease : dv < -ease ? -ease : dv;
      const dx = clearWay(world, def, b.x, top, b.vx);
      if (dx !== b.vx) b.vx = 0;
      b.x += dx;
      const t2 = waterTop(world, b.x, top);
      if (t2 !== null) b.y = t2;
    } else if (top === null && water(world.tileAt(b.x, b.y))) {
      // Deep under water (more poured over it): floating up.
      b.y -= 1.2 * ts;
      b.vy = 0;
      b.vx *= 0.9;
    } else {
      // Falling (onto the water, or the land), or aground: resting on what's under its hull.
      b.vy = Math.min(b.vy + g, PHYS.maxFall);
      let ny = b.y + b.vy;
      const t = top !== null && top > b.y ? top : null;
      if (t !== null && ny >= t) { ny = t; if (b.vy > 3 * ts) game.fx?.splash?.(b.x, t, b.vy); b.vy = 0; }
      const under = world.overlap(b.x - half + 3, ny + def.keel - 1, b.x + half - 3, ny + def.keel + 1);
      if (under && b.vy >= 0) { ny = Math.min(ny, under.t - def.keel); b.vy = 0; b.vx *= 0.6; }
      b.y = ny;
      if (Math.abs(b.vx) < 0.05) b.vx = 0;
      else if (world.overlap(b.x + b.vx - half, b.y - def.rim, b.x + b.vx + half, b.y + def.keel - 2)) b.vx = 0;
      else b.x += b.vx;
    }
    // Whoever's in the other seat, with it.
    if (p) {
      sitIn(p.body, def, b.x + def.seats[1], b.y, waterTop(world, b.x, b.y) !== null ? bobOf(world.time || 0, b.id) : 0);
      p.body.vx = b.vx;
    }
    if (d && top === null) sitIn(d.body, def, b.x + def.seats[0], b.y, 0);
  }
  if (boats.size > 1) bump(world, boats);
}

// (Boats in order across, for bumping: kept, not made again each update.)
const ORDER = [];

/**
 * Boats that run into each other: one with nobody in it is pushed aside (and along) by the other;
 * two empty ones push each other apart. One with someone in it isn't pushed (its rower has it).
 */
function bump(world, boats) {
  ORDER.length = 0;
  for (const b of boats.values()) ORDER.push(b);
  ORDER.sort((a, b) => a.x - b.x);
  for (let i = 0; i < ORDER.length; i++) {
    const a = ORDER[i], da = BOATS[a.kind];
    for (let j = i + 1; j < ORDER.length && ORDER[j].x - a.x < 60; j++) {
      const o = ORDER[j], dq = BOATS[o.kind], over = (da.len + dq.len) / 2 - 2 - (o.x - a.x);
      if (over <= 0 || Math.abs(a.y - o.y) > 10) continue;
      const freeA = a.rider < 0 && a.passenger < 0, freeB = o.rider < 0 && o.passenger < 0;
      if ((!freeA && !freeB) || !loaded(world, a.x, a.y, da.len / 2) || !loaded(world, o.x, o.y, dq.len / 2)) continue;
      const share = freeA && freeB ? 0.5 : 1, mid = (a.vx + o.vx) / 2;
      if (freeA) { a.x += clearWay(world, da, a.x, a.y, -Math.min(3, over * share)); a.vx = Math.min(a.vx, freeB ? mid : o.vx); }
      if (freeB) { o.x += clearWay(world, dq, o.x, o.y, Math.min(3, over * share)); o.vx = Math.max(o.vx, freeA ? mid : a.vx); }
    }
  }
}

// ---- Kept with the world, and online -------------------------------------------------------------------

/** The world's boats, to keep: [[kind, x, y], ...]. */
export function boatsToSave(world) {
  return [...(world.boats?.values() || [])].map(b => [b.kind, Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10]);
}

/** The world's boats, from what was kept. */
export function boatsFromSave(world, list) {
  world.boats = new Map();
  world.boatSeq = 1;
  if (!Array.isArray(list)) return;
  for (const e of list) {
    if (!Array.isArray(e) || !BOATS[e[0]] || !Number.isFinite(e[1]) || !Number.isFinite(e[2])) continue;
    addBoat(world, e[0], e[1], e[2]);
  }
}

// (Online: what's sent of each boat near a player, and how far round them; how many of the host's
// places for each boat are kept here, to draw it moving between; how often boats going along are
// sent, at most (updates).)
const NEAR_X = 2400, NEAR_Y = 1600, HIST = 6, MOVING_EVERY = 6;

/**
 * The boats near player s, as the host sends them ([[id, kind's number, x, y, vx, rider, passenger,
 * hp], ...]), if they've changed since what's in `sent` (the player's: what was sent, kept there);
 * else null. A boat put on the water or taken away, someone getting in or out, a hit: straight
 * away; boats just going along: ten times a second at most (drawn moving between).
 */
export function boatsFor(game, s, sent) {
  const boats = game.world?.boats;
  const list = [];
  let what = '';
  if (boats?.size) {
    for (const b of boats.values()) {
      if (s && (Math.abs(b.x - s.x) > NEAR_X || Math.abs(b.y - s.y) > NEAR_Y)) continue;
      list.push([b.id, BOAT_KINDS.indexOf(b.kind), Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10, Math.round(b.vx * 100) / 100, b.rider, b.passenger, b.hp]);
      what += `${b.id},${b.kind},${b.rider},${b.passenger},${b.hp};`;
    }
  }
  const key = JSON.stringify(list);
  if (key === sent.boats || (what === sent.boatsWhat && game.tick - (sent.boatsAt ?? -1e9) < MOVING_EVERY)) return null;
  sent.boats = key;
  sent.boatsWhat = what;
  sent.boatsAt = game.tick;
  return list;
}

/**
 * The host's boats (boatsFor's list, as of its update `tick`), here (a player who joined: game.mirror).
 * Who's in each is marked on their bodies (drawn sat down); our own soldier (`me`) is put in or
 * taken out as the host has them, unless we've just got out ourselves (the host will soon see it).
 */
export function boatsFromNet(game, list, tick, me) {
  const world = game.world;
  if (!world || !Array.isArray(list)) return;
  const old = world.boats || new Map(), next = new Map(), seats = new Map();
  for (const e of list) {
    if (!Array.isArray(e)) continue;
    const kind = BOAT_KINDS[e[1] | 0], x = Number(e[2]), y = Number(e[3]);
    if (!kind || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const id = e[0] | 0;
    const b = old.get(id) || { id, kind, x, y, px: x, py: y, vx: 0, vy: 0, hist: [], hitAt: -1e9 };
    // (Where it's been, and when, lately: drawn moving between them, as the host's soldiers are.)
    (b.hist ||= []).push([tick, x, y]);
    if (b.hist.length > HIST) b.hist.shift();
    b.x = x; b.y = y;
    b.kind = kind; b.vx = Number(e[4]) || 0;
    b.rider = Number.isInteger(e[5]) ? e[5] : -1; b.passenger = Number.isInteger(e[6]) ? e[6] : -1;
    const hp = e[7] | 0;
    if (b.hp !== undefined && hp < b.hp) b.hitAt = game.tick;
    b.hp = hp;
    next.set(id, b);
    if (b.rider >= 0) seats.set(b.rider, { id, kind, seat: 0 });
    if (b.passenger >= 0) seats.set(b.passenger, { id, kind, seat: 1 });
  }
  world.boats = next;
  for (const s of game.soldiers) {
    const want = seats.get(s.id) || null, body = s.body, have = body.boat;
    if (s !== me) { body.boat = want; continue; }
    if (want && (!have || have.id !== want.id || have.seat !== want.seat)) {
      // (Just out of it here: the host hasn't seen that yet.)
      if (!have && game.tick - (body.leftBoat ?? -1e9) < REBOARD) continue;
      body.boat = want;
    } else if (!want && have) body.boat = null;
  }
}

/**
 * A boat's place as it's drawn, into out ({ x, y }; alpha: how far between updates): on the host,
 * between its last two updates; online, where the host had it at the moment shown (game.tick),
 * between the places it sent (past the last, on as it was going, a little way).
 */
export function boatPlace(game, b, alpha, out) {
  const h = b.hist;
  if (!h?.length) {
    out.x = b.px + (b.x - b.px) * alpha;
    out.y = b.py + (b.y - b.py) * alpha;
    return out;
  }
  const t = game.tick + alpha;
  let i = h.length - 1;
  while (i > 0 && h[i][0] > t) i--;
  const a = h[i], n = h[i + 1];
  if (n && t >= a[0]) {
    const k = (t - a[0]) / Math.max(1, n[0] - a[0]);
    out.x = a[1] + (n[1] - a[1]) * k;
    out.y = a[2] + (n[2] - a[2]) * k;
  } else if (!n && t > a[0]) {
    out.x = a[1] + b.vx * Math.min(6, t - a[0]);
    out.y = a[2];
  } else { out.x = a[1]; out.y = a[2]; }
  return out;
}
