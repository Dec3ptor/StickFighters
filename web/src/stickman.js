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
const TWO_HANDED = new Set(['smg', 'rifle', 'shotgun', 'sniper', 'launcher', 'tube', 'flamer', 'minigun', 'bat', 'axe', 'prod']);

/**
 * Math.hypot(x, y), worked out just as V8 does it (each larger one scaled to 1, then the
 * squares added and the root taken): the same number, without the garbage Math.hypot
 * makes on every call. (tests/render.test.mjs checks they agree.)
 */
export function hypot(x, y) {
  const ax = Math.abs(x), ay = Math.abs(y);
  if (ax === Infinity || ay === Infinity) return Infinity;
  if (ax !== ax || ay !== ay) return NaN;
  const m = ax > ay ? ax : ay;
  if (m === 0) return 0;
  const a = ax / m, b = ay / m;
  return Math.sqrt(a * a + b * b) * m;
}

export function setLegAnimations(data) {
  LEGS = data.map(a => a.poses.map(p => ({
    neck: p.neck, hip: p.hip,
    fk: p.front_knee, bk: p.back_knee, ff: p.front_foot, bf: p.back_foot,
  })));
}

// Leg poses are worked out into this one, used straight away by buildPose (no new
// object every frame for every soldier).
const pair = () => [0.5, 0.5];
const MIXED = { neck: pair(), hip: pair(), fk: pair(), bk: pair(), ff: pair(), bf: pair() };

function mixPoint(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
}

/** Pose a, part way (t) to pose b: in MIXED. */
function mix(a, b, t) {
  mixPoint(MIXED.neck, a.neck, b.neck, t);
  mixPoint(MIXED.hip, a.hip, b.hip, t);
  mixPoint(MIXED.fk, a.fk, b.fk, t);
  mixPoint(MIXED.bk, a.bk, b.bk, t);
  mixPoint(MIXED.ff, a.ff, b.ff, t);
  mixPoint(MIXED.bf, a.bf, b.bf, t);
  return MIXED;
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

/**
 * Two-bone reach from shoulder (sx,sy) toward (tx,ty); bends toward (bx,by). The upper
 * arm goes into `upper` ([sx, sy, elbow x, elbow y]) and the forearm into `fore`
 * ([elbow x, elbow y, hand x, hand y]).
 */
function reach(sx, sy, tx, ty, bx, by, upper, fore) {
  let dx = tx - sx, dy = ty - sy;
  let d = hypot(dx, dy) || 0.001;
  const max = UPPER_ARM + FOREARM - 0.01;
  if (d > max) { tx = sx + (dx / d) * max; ty = sy + (dy / d) * max; dx = tx - sx; dy = ty - sy; d = max; }
  const cos = (UPPER_ARM * UPPER_ARM + d * d - FOREARM * FOREARM) / (2 * UPPER_ARM * d);
  const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
  const base = Math.atan2(dy, dx);
  const e1x = sx + Math.cos(base + ang) * UPPER_ARM, e1y = sy + Math.sin(base + ang) * UPPER_ARM;
  const e2x = sx + Math.cos(base - ang) * UPPER_ARM, e2y = sy + Math.sin(base - ang) * UPPER_ARM;
  const first = (e1x - sx) * bx + (e1y - sy) * by >= (e2x - sx) * bx + (e2y - sy) * by;
  const ex = first ? e1x : e2x, ey = first ? e1y : e2y;
  upper[0] = sx; upper[1] = sy; upper[2] = ex; upper[3] = ey;
  fore[0] = ex; fore[1] = ey; fore[2] = tx; fore[3] = ty;
}

// Each soldier's figure is kept (in this map, not on the soldier) and filled in again each
// time: drawing it every frame makes no garbage.
const poses = new WeakMap();
const quad = () => [0.5, 0.5, 0.5, 0.5];

function newPose() {
  return {
    lines: [quad(), quad(), quad(), quad(), quad(), quad(), quad(), quad(), quad()],
    head: { x: 0.5, y: 0.5, r: HEAD_R },
    gun: { x: 0.5, y: 0.5, angle: 0.5, def: null },
    shoulder: [0.5, 0.5],
  };
}

function line(l, x0, y0, x1, y1) { l[0] = x0; l[1] = y0; l[2] = x1; l[3] = y1; }

/**
 * The figure relative to the soldier's origin.
 * Returns { lines: [[x0,y0,x1,y1]...], head: {x,y,r}, gun: {x,y,angle,def}, shoulder: [x,y] }.
 * The lines are the body, front thigh and shin, back thigh and shin, back upper arm and
 * forearm, front upper arm and forearm. It's the same object for the same soldier every
 * time, filled in again: use it before building that soldier's pose again (copy what's kept).
 */
export function buildPose(s) {
  let pose = poses.get(s);
  if (!pose) poses.set(s, pose = newPose());
  const p = legPose(s);
  const m = -s.facing; // poses face left; mirror when facing right
  const nx = p.neck[0] * m, ny = p.neck[1], hx = p.hip[0] * m, hy = p.hip[1];
  const fkx = p.fk[0] * m, fky = p.fk[1], ffx = p.ff[0] * m, ffy = p.ff[1];
  const bkx = p.bk[0] * m, bky = p.bk[1], bfx = p.bf[0] * m, bfy = p.bf[1];
  const L = pose.lines;
  line(L[0], nx, ny, hx, hy);
  line(L[1], hx, hy, fkx, fky);
  line(L[2], fkx, fky, ffx, ffy);
  line(L[3], hx, hy, bkx, bky);
  line(L[4], bkx, bky, bfx, bfy);

  // Head sits on the line from hip through neck (so it follows flips).
  let ux = nx - hx, uy = ny - hy;
  const ul = hypot(ux, uy) || 1;
  ux /= ul; uy /= ul;
  const head = pose.head;
  head.x = nx + ux * HEAD_R; head.y = ny + uy * HEAD_R; head.r = HEAD_R;

  // Arms hold the weapon along the aim.
  const sx = nx - ux * 2, sy = ny - uy * 2;
  const def = WEAPONS[s.current] || WEAPONS.Platinum;
  const dx = Math.cos(s.aim), dy = Math.sin(s.aim);
  const kick = s.anim.recoil;
  const twoHanded = TWO_HANDED.has(def.look.type);
  const backDist = twoHanded ? 5 - kick : 11 - kick;
  const frontDist = twoHanded ? 12 - kick : 12.5 - kick;
  // Bend elbows downward, and backward when aiming straight up or down.
  const bx = -s.facing * 0.6, by = 1;
  reach(sx, sy, sx + dx * backDist, sy + dy * backDist + (twoHanded ? 1.5 : 0), bx, by, L[5], L[6]);
  reach(sx, sy, sx + dx * frontDist, sy + dy * frontDist, bx, by, L[7], L[8]);

  const gunBack = twoHanded ? 1 - kick : 9 - kick;
  const gun = pose.gun;
  gun.x = sx + dx * gunBack; gun.y = sy + dy * gunBack; gun.angle = s.aim; gun.def = def;
  pose.shoulder[0] = sx; pose.shoulder[1] = sy;
  return pose;
}
