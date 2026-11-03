// Character movement shared by players, bots and the bots' route planner.
// Keeping one function for all three means a jump the planner tested works the same in play.

import { BODY, PHYS, RULES } from './config.js';
import { hypot } from './map.js';

// Gliding (worlds' wings): how fast across (of the running speed), in a dive, and how fast down (of the fastest fall).
const GLIDE_SPEED = 1.8, GLIDE_DIVE = 2.6, GLIDE_FALL = 0.13;

export function makeBody(x, y) {
  return {
    x, y, vx: 0, vy: 0,
    onGround: false, crouching: false, padLaunch: false,
    hasJetpack: false, fuel: 0,
    stamina: 100, winded: false, sprinting: false, // sprinting: see stepBody
    rope: null,        // ninja rope: { x, y, len } while hanging from one
    momentum: 0,       // ticks of keeping speed in the air (after a rope swing, a big hit, a sprint-jump off ice)
    // Set during each step, for animation and sound:
    jetting: false, bounced: false, jumped: false, landed: 0,
    // Worlds: standing on a one-way platform; dropping through one (updates left); on a ladder;
    // in water (its middle), and with the head under it.
    onPlatform: false, dropping: 0, climbing: false, swimming: false, under: false, leaping: false,
    // (Worlds: in a boat, { id, kind, seat }: world/boats.js.)
    boat: null,
  };
}

export function bodyTop(body) {
  return body.crouching ? BODY.crouchTop : BODY.top;
}

/** The solid directly under the body's feet (touching), or null. (Floor rather than a jump pad, where there's both.) */
export function supportUnder(body, map) {
  const y = body.y + BODY.bottom;
  return map.support(body.x - BODY.halfW, y, body.x + BODY.halfW, y + 1);
}

/**
 * Advance one tick.
 * input: { move: -1..1, jump: held, jumpPressed: pressed this tick, crouch, jet, sprint }
 */
export function stepBody(body, input, map) {
  const wasGround = body.onGround;
  body.jetting = false;
  body.bounced = false;
  body.jumped = false;
  body.landed = 0;
  // Worlds' boats: in one, the body goes as the boat does (world/boats.js).
  if (body.boat && map.rideBoat) { map.rideBoat(body, input); return; }

  // Worlds' ladders: hold jump to climb, crouch to go down (no falling while on one).
  const ladder = !!map.climbable && map.climbable(body.x - BODY.halfW, body.y + bodyTop(body), body.x + BODY.halfW, body.y + BODY.bottom);
  body.climbing = ladder && (body.climbing || !!input.jump || !!input.crouch);
  if (body.dropping > 0) body.dropping--;
  // Worlds' water: swimming, where the body's middle is in it (and floating, with the head out,
  // where the chest is: see swim()).
  const wet = !!map.liquidAt && map.liquidAt(body.x, body.y + SWIM_MID);
  body.swimming = wet;
  body.under = wet && map.liquidAt(body.x, body.y + BODY.top + 3);
  // Worlds' flowing water: it carries the body along the way it runs (where the feet are, else the
  // middle), and falling water pushes it down: -1 or 1 across, 2 down, 0 none.
  const current = map.currentAt ? map.currentAt(body.x, body.y + BODY.bottom - 3) || map.currentAt(body.x, body.y + SWIM_MID) : 0;
  const push = current === 1 || current === -1 ? current * PHYS.runSpeed * CURRENT : 0;
  // Worlds' ice: how slippery the ground under the feet is (0 to 1). (From the blocks there, not
  // kept: a player's own steps, worked out again online from the host's, come out the same.)
  const ice = wasGround && map.slipAt ? map.slipAt(body.x, body.x - BODY.halfW, body.x + BODY.halfW, body.y + BODY.bottom + 1) : 0;

  // Crouch (only on the ground; standing up needs head room; not swimming: crouch dives).
  if (input.crouch && wasGround && !body.climbing && !wet) {
    body.crouching = true;
  } else if (body.crouching) {
    const blocked = map.overlap(body.x - BODY.halfW, body.y + BODY.top, body.x + BODY.halfW, body.y + BODY.crouchTop);
    if (!blocked) body.crouching = false;
  }

  // Sprinting: faster on the ground while stamina lasts (run out, and you're winded until
  // it's partly back). The speed carries through a jump, as long as you keep it held.
  const sprint = !!input.sprint && !!input.move && !body.crouching && !body.rope && !wet;
  if (wasGround) {
    if (body.winded && body.stamina >= PHYS.sprintRecover) body.winded = false;
    body.sprinting = sprint && !body.winded;
    if (body.sprinting) {
      body.stamina = Math.max(0, body.stamina - PHYS.sprintDrain);
      if (body.stamina <= 0) body.winded = true;
    } else body.stamina = Math.min(100, body.stamina + PHYS.sprintRegen);
  } else body.sprinting = body.sprinting && sprint;

  // Horizontal: ease toward the wanted speed, so knockback fades out naturally.
  if (body.momentum > 0) body.momentum--;
  if (body.rope && !wasGround) {
    // Swinging: left and right pump the swing instead of steering.
    body.vx += (input.move || 0) * PHYS.airAccel * 0.25;
  } else if (body.glide && !wasGround && !wet) {
    // Gliding (a world's wings: body.glide, worldplay.js): steered left and right, and faster in a
    // dive (crouch).
    const target = (input.move || 0) * PHYS.runSpeed * (input.crouch ? GLIDE_DIVE : GLIDE_SPEED + 0.25 * (body.glide - 1));
    const dv = target - body.vx, accel = PHYS.airAccel * 1.2;
    body.vx += dv > accel ? accel : dv < -accel ? -accel : dv;
  } else if (wet) {
    // Swimming: slower, and the water slows whatever comes into it fast (a blast, a run and a dive).
    const target = (input.move || 0) * PHYS.runSpeed * PHYS.swimSpeed + push;
    if (Math.abs(body.vx - target) > PHYS.runSpeed) body.vx = target + (body.vx - target) * WATER_DRAG;
    const dv = target - body.vx, accel = PHYS.swimAccel;
    body.vx += dv > accel ? accel : dv < -accel ? -accel : dv;
  } else {
    // (On ice, worlds': slippery. Slow to get going, slower to stop or turn round; sprinting, a little faster.)
    let target = (input.move || 0) * (body.crouching ? PHYS.crouchSpeed : PHYS.runSpeed * (body.sprinting ? PHYS.sprintSpeed * (1 + ICE_SPRINT * ice) : 1)) + push;
    let accel = wasGround ? PHYS.groundAccel : PHYS.airAccel;
    if (ice) accel *= 1 - ice * (1 - iceGrip(body.vx, target));
    if (!wasGround && body.momentum > 0 && Math.abs(body.vx) > Math.abs(target)) accel *= 0.12;
    const dv = target - body.vx;
    body.vx += dv > accel ? accel : dv < -accel ? -accel : dv;
  }

  // Worlds: crouch and jump on a one-way platform drops through it.
  if (input.jumpPressed && wasGround && input.crouch && body.onPlatform) {
    body.dropping = 12;
    body.onGround = false;
    body.onPlatform = false;
    body.crouching = false;
    body.y += 1;
  }
  // Jumping (and out of the water from its top, the head out: onto the bank. Held, swimming up,
  // it leaps out as soon as the head's out).
  else if (!body.crouching && !body.climbing && ((input.jumpPressed && wasGround) || (wet && !body.under && !wasGround && (input.jumpPressed || (input.jump && body.vy < 0))))) {
    body.vy = -PHYS.jumpSpeed * (wasGround ? 1 : SWIM_LEAP);
    body.onGround = false;
    body.jumped = true;
    body.leaping = wet && !wasGround;
    // (A sprint-jump off ice keeps its speed through the air.)
    if (ice && body.sprinting) body.momentum = Math.max(body.momentum, ICE_AIR);
  }
  if (!input.jump && !body.padLaunch && !body.rope && body.momentum <= 0 && body.vy < -PHYS.jumpCut) body.vy = -PHYS.jumpCut;

  // Jetpack.
  if (body.hasJetpack && input.jet && !body.onGround && body.fuel > 0) {
    if (body.vy > -PHYS.jetMaxUp) body.vy = Math.max(body.vy - PHYS.jetAccel, -PHYS.jetMaxUp);
    body.fuel = Math.max(0, body.fuel - PHYS.jetDrain);
    body.jetting = true;
    body.padLaunch = false;
  } else if (wasGround && body.hasJetpack) {
    body.fuel = Math.min(100, body.fuel + PHYS.jetRegen);
  }

  if (body.climbing) body.vy = input.jump ? -PHYS.climbSpeed : input.crouch ? PHYS.climbSpeed : 0;
  else if (wet && !body.leaping) swim(body, input, map, current === 2);
  // (Gliding: falling slowly; diving, faster.)
  else if (body.glide && !wasGround) body.vy = Math.min(body.vy + PHYS.gravity * (input.crouch ? 0.6 : 0.18), PHYS.maxFall * (input.crouch ? 0.65 : GLIDE_FALL));
  else body.vy = Math.min(body.vy + PHYS.gravity, PHYS.maxFall);
  // (A leap out of the water goes on until it's on the way down again.)
  if (body.leaping && body.vy >= 0) body.leaping = false;
  if (body.y < map.bounds.top - RULES.ceilingMargin && body.vy < 0) body.vy = 0;

  moveX(body, map, wasGround);
  const touched = moveY(body, map, wasGround);

  if (!touched) {
    let under = body.vy >= 0 ? supportUnder(body, map) : null;
    // (Dropping through a platform: not stood on.)
    if (under?.platform && body.dropping > 0) under = null;
    // A jump pad only launches you when it's under your middle; its edge works as floor.
    body.onGround = !!under && !(under.bounce && under.l <= body.x && body.x <= under.r);
    body.onPlatform = !!under?.platform;
    if (body.onGround && !body.climbing) body.vy = 0;
  }
  if (body.rope) holdRope(body, input, map);
}

// Swimming: the body's middle (from its origin), where it counts as in the water; its chest,
// what floats at the top; how much speed water leaves (each update) from a fast way in; a leap
// out of the water, as much of a jump.
const SWIM_MID = -5, SWIM_CHEST = -11, WATER_DRAG = 0.8, SWIM_LEAP = 0.85;
// Flowing water: how fast it carries a body along (of the run speed); falling water, how hard
// it pushes down (of floating's speed).
const CURRENT = 0.3, FALL_PUSH = 2.2;
// Ice (worlds' slippery blocks, as much as they are: their slip): how much of the ground's grip
// is left getting going, slowing to a stop (let go), turning round, and going faster than wanted
// (it keeps its speed); how much faster sprinting gets; and how long a sprint-jump off it keeps
// its speed in the air (updates: as a rope swing's does).
const ICE_GO = 0.15, ICE_STOP = 0.05, ICE_TURN = 0.1, ICE_KEEP = 0.04, ICE_SPRINT = 0.15, ICE_AIR = 40;

/**
 * For whatever steers a body (monsters, mercenaries, townsfolk): sliding on ice with nowhere to go,
 * which way to push to stop (-1 or 1), else 0. (Let go on ice, it would slide on a long way.)
 */
export function iceBrake(body, map) {
  if (!body.onGround || Math.abs(body.vx) < 0.3 || !map.slipAt) return 0;
  return map.slipAt(body.x, body.x - BODY.halfW, body.x + BODY.halfW, body.y + BODY.bottom + 1) > 0 ? -Math.sign(body.vx) : 0;
}

/** How much of the ground's grip ice leaves, going at vx and wanting to go at target. */
function iceGrip(vx, target) {
  if (target === 0) return ICE_STOP;
  if (vx !== 0 && vx * target < 0) return ICE_TURN;
  return Math.abs(target) >= Math.abs(vx) ? ICE_GO : ICE_KEEP;
}

/**
 * Up and down in water: jump swims up, crouch dives, and left alone the body floats with its
 * head out (sinking a little when the chest's out, rising when it's under), bobbing at the top.
 * Fast into it (a fall, a jump), the water slows it. In falling water (`falls`), pushed down.
 */
function swim(body, input, map, falls = false) {
  const want = (input.jump ? -PHYS.swimUp : input.crouch ? PHYS.swimDive
    : map.liquidAt(body.x, body.y + SWIM_CHEST) ? -PHYS.swimFloat : PHYS.swimFloat) + (falls ? PHYS.swimFloat * FALL_PUSH : 0);
  if (Math.abs(body.vy - want) > PHYS.swimUp * 1.5) body.vy = want + (body.vy - want) * WATER_DRAG;
  const a = PHYS.swimAccel, dv = want - body.vy;
  body.vy += dv > a ? a : dv < -a ? -a : dv;
}

const ROPE_MIN = 18, ROPE_MAX = 420;

/** Keep a soldier on a ninja rope within its length; jump climbs up, crouch slides down. */
function holdRope(body, input, map) {
  const r = body.rope;
  if (input.jump) r.len = Math.max(ROPE_MIN, r.len - PHYS.ropeClimb);
  if (input.crouch) r.len = Math.min(ROPE_MAX, r.len + PHYS.ropeClimb);
  const cy = body.y - 6;
  const dx = body.x - r.x, dy = cy - r.y, d = hypot(dx, dy);
  if (d <= r.len || d === 0) return;
  const ux = dx / d, uy = dy / d;
  // Pull back onto the circle, as far as walls allow.
  const tx = r.x + ux * r.len, ty = r.y + uy * r.len + 6;
  if (!overlapAt(body, map, tx, ty)) { body.x = tx; body.y = ty; }
  else if (!overlapAt(body, map, tx, body.y)) body.x = tx;
  else if (!overlapAt(body, map, body.x, ty)) body.y = ty;
  // Remove the speed pulling away from the anchor; the rest becomes the swing.
  const out = body.vx * ux + body.vy * uy;
  if (out > 0) { body.vx -= out * ux; body.vy -= out * uy; }
  if (uy < 0.2 || !body.onGround) body.onGround = false;
}

function overlapAt(body, map, x, y) {
  return map.overlap(x - BODY.halfW, y + bodyTop(body), x + BODY.halfW, y + BODY.bottom);
}

function moveX(body, map, wasGround) {
  let remaining = body.vx;
  // (A speed that isn't a number, from a bug elsewhere, would never be used up: the page would hang.)
  if (!Number.isFinite(remaining)) { body.vx = 0; return; }
  while (remaining !== 0) {
    const dx = Math.abs(remaining) > PHYS.maxStep ? Math.sign(remaining) * PHYS.maxStep : remaining;
    remaining -= dx;
    const nx = body.x + dx;
    let hit = overlapAt(body, map, nx, body.y);
    if (!hit) { body.x = nx; continue; }

    // Walk up small ledges (in a world, a block high).
    if (wasGround) {
      let stepped = false;
      const most = map.stepUp ?? PHYS.stepUp;
      for (let up = 1; up <= most; up++) {
        if (!overlapAt(body, map, nx, body.y - up)) {
          body.x = nx;
          body.y -= up;
          stepped = true;
          break;
        }
      }
      if (stepped) continue;
    }

    // Blocked: slide up against the wall.
    let x = nx;
    for (let guard = 0; hit && guard < 8; guard++) {
      x = dx > 0 ? hit.l - BODY.halfW : hit.r + BODY.halfW;
      hit = overlapAt(body, map, x, body.y);
    }
    if (!hit) body.x = x;
    body.vx = 0;
    break;
  }
}

// The blocks a step of moveY() runs into (one list, used again every step: see map.overlapAll).
const HITS = [];

/** Moves vertically; returns true if the body hit a floor, pad or ceiling. */
function moveY(body, map, wasGround) {
  let remaining = body.vy;
  if (!Number.isFinite(remaining)) { body.vy = 0; return false; }
  while (remaining !== 0) {
    const dy = Math.abs(remaining) > PHYS.maxStep ? Math.sign(remaining) * PHYS.maxStep : remaining;
    remaining -= dy;
    const ny = body.y + dy;
    const top = bodyTop(body);
    const hits = HITS, n = map.overlapAll(body.x - BODY.halfW, ny + top, body.x + BODY.halfW, ny + BODY.bottom, hits);
    if (n === 0) {
      // Worlds: landing on a one-way platform from above (unless dropping through one, or climbing).
      if (dy > 0 && map.landing && !(body.dropping > 0) && !body.climbing) {
        const at = map.landing(body.x - BODY.halfW, body.x + BODY.halfW, body.y + BODY.bottom, ny + BODY.bottom);
        if (at != null) {
          body.y = at - BODY.bottom;
          if (!wasGround) body.landed = body.vy;
          body.vy = 0;
          body.onGround = true;
          body.onPlatform = true;
          body.padLaunch = false;
          return true;
        }
      }
      body.y = ny;
      continue;
    }

    if (dy > 0) {
      let floor = hits[0];
      for (let i = 0; i < n; i++) if (hits[i].t < floor.t) floor = hits[i];
      body.y = floor.t - BODY.bottom;
      // Bounce only if a jump pad is under the soldier's middle.
      let pad = null;
      for (let i = 0; i < n && !pad; i++) {
        const s = hits[i];
        if (s.bounce && s.l <= body.x && body.x <= s.r && s.t <= floor.t + 0.5) pad = s;
      }
      if (pad) {
        body.vy = pad.bounce * PHYS.bounceScale;
        body.bounced = true;
        body.padLaunch = true;
        body.onGround = false;
      } else {
        if (!wasGround) body.landed = body.vy;
        body.vy = 0;
        body.onGround = true;
        body.onPlatform = false;
        body.padLaunch = false;
      }
    } else {
      let ceil = hits[0];
      for (let i = 0; i < n; i++) if (hits[i].b > ceil.b) ceil = hits[i];
      body.y = ceil.b - top;
      body.vy = 0;
      body.onGround = false;
    }
    return true;
  }
  return false;
}
