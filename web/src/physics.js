// Character movement shared by players, bots and the bots' route planner.
// Keeping one function for all three means a jump the planner tested works the same in play.

import { BODY, PHYS, RULES } from './config.js';

export function makeBody(x, y) {
  return {
    x, y, vx: 0, vy: 0,
    onGround: false, crouching: false, padLaunch: false,
    hasJetpack: false, fuel: 0,
    // Set during each step, for animation and sound:
    jetting: false, bounced: false, jumped: false, landed: 0,
  };
}

export function bodyTop(body) {
  return body.crouching ? BODY.crouchTop : BODY.top;
}

/** The solid directly under the body's feet (touching), or null. */
export function supportUnder(body, map) {
  const l = body.x - BODY.halfW, r = body.x + BODY.halfW, y = body.y + BODY.bottom;
  let best = null;
  map.query(l, y, r, y + 1, s => {
    if (l < s.r && r > s.l && y < s.b && y + 1 > s.t) {
      if (!best || (best.bounce && !s.bounce)) best = s;
    }
    return false;
  });
  return best;
}

/**
 * Advance one tick.
 * input: { move: -1..1, jump: held, jumpPressed: pressed this tick, crouch, jet }
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

  // Horizontal: ease toward the wanted speed, so knockback fades out naturally.
  const target = (input.move || 0) * (body.crouching ? PHYS.crouchSpeed : PHYS.runSpeed);
  const accel = wasGround ? PHYS.groundAccel : PHYS.airAccel;
  const dv = target - body.vx;
  body.vx += dv > accel ? accel : dv < -accel ? -accel : dv;

  // Jumping.
  if (input.jumpPressed && wasGround && !body.crouching) {
    body.vy = -PHYS.jumpSpeed;
    body.onGround = false;
    body.jumped = true;
  }
  if (!input.jump && !body.padLaunch && body.vy < -PHYS.jumpCut) body.vy = -PHYS.jumpCut;

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
}

function overlapAt(body, map, x, y) {
  return map.overlap(x - BODY.halfW, y + bodyTop(body), x + BODY.halfW, y + BODY.bottom);
}

function moveX(body, map, wasGround) {
  let remaining = body.vx;
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

/** Moves vertically; returns true if the body hit a floor, pad or ceiling. */
function moveY(body, map, wasGround) {
  let remaining = body.vy;
  while (remaining !== 0) {
    const dy = Math.abs(remaining) > PHYS.maxStep ? Math.sign(remaining) * PHYS.maxStep : remaining;
    remaining -= dy;
    const ny = body.y + dy;
    const top = bodyTop(body);
    const l = body.x - BODY.halfW, r = body.x + BODY.halfW;
    const hits = [];
    map.query(l, ny + top, r, ny + BODY.bottom, s => {
      if (l < s.r && r > s.l && ny + top < s.b && ny + BODY.bottom > s.t) hits.push(s);
      return false;
    });
    if (hits.length === 0) { body.y = ny; continue; }

    if (dy > 0) {
      let floor = hits[0];
      for (const s of hits) if (s.t < floor.t) floor = s;
      body.y = floor.t - BODY.bottom;
      // Bounce only if a jump pad is under the soldier's middle.
      const pad = hits.find(s => s.bounce && s.l <= body.x && body.x <= s.r && s.t <= floor.t + 0.5);
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
      for (const s of hits) if (s.b > ceil.b) ceil = s;
      body.y = ceil.b - top;
      body.vy = 0;
      body.onGround = false;
    }
    return true;
  }
  return false;
}
