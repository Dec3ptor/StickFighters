// Character movement shared by players, bots and the bots' route planner.
// Keeping one function for all three means a jump the planner tested works the same in play.

import { BODY, PHYS, RULES } from './config.js';
import { hypot } from './map.js';

export function makeBody(x, y) {
  return {
    x, y, vx: 0, vy: 0,
    onGround: false, crouching: false, padLaunch: false,
    hasJetpack: false, fuel: 0,
    stamina: 100, winded: false, sprinting: false, // sprinting: see stepBody
    rope: null,        // ninja rope: { x, y, len } while hanging from one
    momentum: 0,       // ticks of keeping speed in the air (after a rope swing or a big hit)
    // Set during each step, for animation and sound:
    jetting: false, bounced: false, jumped: false, landed: 0,
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

  // Crouch (only on the ground; standing up needs head room).
  if (input.crouch && wasGround) {
    body.crouching = true;
  } else if (body.crouching) {
    const blocked = map.overlap(body.x - BODY.halfW, body.y + BODY.top, body.x + BODY.halfW, body.y + BODY.crouchTop);
    if (!blocked) body.crouching = false;
  }

  // Sprinting: faster on the ground while stamina lasts (run out, and you're winded until
  // it's partly back). The speed carries through a jump, as long as you keep it held.
  const sprint = !!input.sprint && !!input.move && !body.crouching && !body.rope;
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
  } else {
    const target = (input.move || 0) * (body.crouching ? PHYS.crouchSpeed : PHYS.runSpeed * (body.sprinting ? PHYS.sprintSpeed : 1));
    let accel = wasGround ? PHYS.groundAccel : PHYS.airAccel;
    if (!wasGround && body.momentum > 0 && Math.abs(body.vx) > Math.abs(target)) accel *= 0.12;
    const dv = target - body.vx;
    body.vx += dv > accel ? accel : dv < -accel ? -accel : dv;
  }

  // Jumping.
  if (input.jumpPressed && wasGround && !body.crouching) {
    body.vy = -PHYS.jumpSpeed;
    body.onGround = false;
    body.jumped = true;
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

  body.vy = Math.min(body.vy + PHYS.gravity, PHYS.maxFall);
  if (body.y < map.bounds.top - RULES.ceilingMargin && body.vy < 0) body.vy = 0;

  moveX(body, map, wasGround);
  const touched = moveY(body, map, wasGround);

  if (!touched) {
    const under = body.vy >= 0 ? supportUnder(body, map) : null;
    // A jump pad only launches you when it's under your middle; its edge works as floor.
    body.onGround = !!under && !(under.bounce && under.l <= body.x && body.x <= under.r);
    if (body.onGround) body.vy = 0;
  }
  if (body.rope) holdRope(body, input, map);
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

    // Walk up small ledges.
    if (wasGround) {
      let stepped = false;
      for (let up = 1; up <= PHYS.stepUp; up++) {
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
    if (n === 0) { body.y = ny; continue; }

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
