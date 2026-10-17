// Builds the stick figure for a soldier: legs from the original game's animation
// poses (web/data/animations/legs.json), arms solved toward the weapon so they
// follow the aim at any angle.

import { WEAPONS } from './weapons.js';

let LEGS = null;

// Which original leg animation to use for each state (indices into legs.json).
const ANIM = { stance: 0, run: 1, crouch: 2, flip: 3, land: 4, crouchWalk: 5, air: 6 };

const UPPER_ARM = 7.5;
const FOREARM = 7;
const HEAD_R = 4.2;

export function setLegAnimations(data) {
  LEGS = data.map(a => a.poses.map(p => ({
    neck: p.neck, hip: p.hip,
    fk: p.front_knee, bk: p.back_knee, ff: p.front_foot, bf: p.back_foot,
  })));
}

function mix(a, b, t) {
  const out = {};
  for (const k in a) out[k] = [a[k][0] + (b[k][0] - a[k][0]) * t, a[k][1] + (b[k][1] - a[k][1]) * t];
  return out;
}

/** Sample animation `i` at position t (0..1 across all its poses; loops if `loop`). */
function sample(i, t, loop) {
  const poses = LEGS[i];
  const n = poses.length;
  if (n === 1) return poses[0];
  const f = loop ? (((t % 1) + 1) % 1) * n : Math.max(0, Math.min(1, t)) * (n - 1);
  const k = Math.floor(f);
  const a = poses[k % n], b = poses[loop ? (k + 1) % n : Math.min(k + 1, n - 1)];
  return mix(a, b, f - k);
}

const STANDING = {
  neck: [0, -14], hip: [0, -2], fk: [-5, 5], bk: [5, 5], ff: [-5, 12], bf: [5, 12],
};

function legPose(s) {
  if (!LEGS) return STANDING;
  const b = s.body, a = s.anim;
  if (!b.onGround) {
    if (a.flip > 0) return sample(ANIM.flip, 1 - a.flip, true);
    if (b.jetting) return LEGS[ANIM.air][0];
    return mix(LEGS[ANIM.air][0], LEGS[ANIM.air][1], Math.max(0, Math.min(1, (b.vy + 3) / 8)));
  }
  if (b.crouching) {
    return Math.abs(b.vx) > 0.3 ? sample(ANIM.crouchWalk, a.run * 2, true) : LEGS[ANIM.crouch][0];
  }
  if (Math.abs(b.vx) > 0.3) return sample(ANIM.run, a.run, true);
  if (a.land > 0) return mix(LEGS[ANIM.land][0], LEGS[ANIM.land][1], Math.sin(Math.PI * (1 - a.land / 10)) * 0.8);
  return mix(LEGS[ANIM.stance][0], LEGS[ANIM.stance][1], 0.12 * (0.5 - 0.5 * Math.cos(a.idle * 0.05)));
}

/** Two-bone reach from shoulder (sx,sy) toward (tx,ty); bends toward (bx,by). Returns [elbow, hand]. */
function reach(sx, sy, tx, ty, bx, by) {
  let dx = tx - sx, dy = ty - sy;
  let d = Math.hypot(dx, dy) || 0.001;
  const max = UPPER_ARM + FOREARM - 0.01;
  if (d > max) { tx = sx + (dx / d) * max; ty = sy + (dy / d) * max; dx = tx - sx; dy = ty - sy; d = max; }
  const cos = (UPPER_ARM * UPPER_ARM + d * d - FOREARM * FOREARM) / (2 * UPPER_ARM * d);
  const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
  const base = Math.atan2(dy, dx);
  const e1 = [sx + Math.cos(base + ang) * UPPER_ARM, sy + Math.sin(base + ang) * UPPER_ARM];
  const e2 = [sx + Math.cos(base - ang) * UPPER_ARM, sy + Math.sin(base - ang) * UPPER_ARM];
  const pick = (e1[0] - sx) * bx + (e1[1] - sy) * by >= (e2[0] - sx) * bx + (e2[1] - sy) * by ? e1 : e2;
  return [pick, [tx, ty]];
}

/**
 * The figure relative to the soldier's origin.
 * Returns { lines: [[x0,y0,x1,y1]...], head: {x,y,r}, gun: {x,y,angle,def}, shoulder: [x,y] }.
 */
export function buildPose(s) {
  const p = legPose(s);
  const m = -s.facing; // poses face left; mirror when facing right
  const P = k => [p[k][0] * m, p[k][1]];
  const neck = P('neck'), hip = P('hip');
  const lines = [
    [...neck, ...hip],
    [...hip, ...P('fk')], [...P('fk'), ...P('ff')],
    [...hip, ...P('bk')], [...P('bk'), ...P('bf')],
  ];

  // Head sits on the line from hip through neck (so it follows flips).
  let ux = neck[0] - hip[0], uy = neck[1] - hip[1];
  const ul = Math.hypot(ux, uy) || 1;
  ux /= ul; uy /= ul;
  const head = { x: neck[0] + ux * HEAD_R, y: neck[1] + uy * HEAD_R, r: HEAD_R };

  // Arms hold the weapon along the aim.
  const sx = neck[0] - ux * 2, sy = neck[1] - uy * 2;
  const def = WEAPONS[s.current] || WEAPONS.Platinum;
  const dx = Math.cos(s.aim), dy = Math.sin(s.aim);
  const kick = s.anim.recoil;
  const twoHanded = def.look.grip > 0;
  const backDist = twoHanded ? 5 - kick : 11 - kick;
  const frontDist = twoHanded ? 12 - kick : 12.5 - kick;
  // Bend elbows downward, and backward when aiming straight up or down.
  const bx = -s.facing * 0.6, by = 1;
  const back = reach(sx, sy, sx + dx * backDist, sy + dy * backDist + (twoHanded ? 1.5 : 0), bx, by);
  const front = reach(sx, sy, sx + dx * frontDist, sy + dy * frontDist, bx, by);
  lines.push([sx, sy, ...back[0]], [...back[0], ...back[1]], [sx, sy, ...front[0]], [...front[0], ...front[1]]);

  const gunBack = twoHanded ? 1 - kick : 9 - kick;
  const gun = { x: sx + dx * gunBack, y: sy + dy * gunBack, angle: s.aim, def };
  return { lines, head, gun, shoulder: [sx, sy] };
}
