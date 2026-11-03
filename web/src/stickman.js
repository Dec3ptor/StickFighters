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
const TWO_HANDED = new Set(['smg', 'rifle', 'shotgun', 'sniper', 'launcher', 'tube', 'flamer', 'minigun', 'bat', 'axe', 'sledge']);
// Guns whose magazine comes out to reload (the rest: loaded where they're held).
const MAGAZINES = new Set(['pistol', 'smg', 'rifle', 'ak', 'sniper']);

// Easing (0 to 1, onto 0 to 1).
const easeOut = t => 1 - (1 - t) * (1 - t);
const easeIn = t => t * t;
const smooth = t => t * t * (3 - 2 * t);
const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);
/** Up quickly to 1 by `peak`, then eased back down to 0 by the end. */
const pulse = (t, peak) => (t < peak ? easeOut(t / peak) : 1 - smooth((t - peak) / (1 - peak)));
/** In by `a`, held, out from `b`: how far into an act's special pose. */
const inOut = (t, a, b) => (t < a ? smooth(t / a) : t > b ? 1 - smooth((t - b) / (1 - b)) : 1);

// How far up (radians) each kind of swing lifts what's in hand.
const LIFT = { mine: 1.9, chop: 1.6, smash: 2.3, hammer: 1.05 };

/** A swing's lift at t: struck at the start (a jolt past the mark), lifted, brought down again by the end. */
function swingLift(t, lift) {
  if (t < 0.08) return -0.16 * lift * (1 - t / 0.08);
  if (t < 0.62) return lift * easeOut((t - 0.08) / 0.54);
  return lift * (1 - easeIn((t - 0.62) / 0.38));
}

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
// Sitting in a chair (worlds: decor.js): the hips down on its seat, thighs forward, shins down.
const SITTING = {
  neck: [1.5, -9], hip: [2.5, 3], fk: [-4.5, 3], bk: [-3.5, 4], ff: [-5, 12], bf: [-3, 12],
};

function legPose(s) {
  if (s.sitting) return SITTING;
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
function reach(sx, sy, tx, ty, bx, by, upper, fore, stretch = 1) {
  // (stretch: the arm a little longer, at the height of a thrust.)
  const UA = UPPER_ARM * stretch, FA = FOREARM * stretch;
  let dx = tx - sx, dy = ty - sy;
  let d = hypot(dx, dy) || 0.001;
  const max = UA + FA - 0.01;
  if (d > max) { tx = sx + (dx / d) * max; ty = sy + (dy / d) * max; dx = tx - sx; dy = ty - sy; d = max; }
  const cos = (UA * UA + d * d - FA * FA) / (2 * UA * d);
  const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
  const base = Math.atan2(dy, dx);
  const e1x = sx + Math.cos(base + ang) * UA, e1y = sy + Math.sin(base + ang) * UA;
  const e2x = sx + Math.cos(base - ang) * UA, e2y = sy + Math.sin(base - ang) * UA;
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
    // What's in hand: where, its turn, how it looks (a weapon's def, or held look: worldplay.js).
    // center: a world thing drawn round its middle (not from a grip); scale; hidden (just thrown);
    // pull: a bow's string drawn back (0 to 1).
    gun: { x: 0.5, y: 0.5, angle: 0.5, def: null, center: false, scale: 1, hidden: false, pull: 0 },
    // The other hand's thing (a world's right hand: s.held2), or def null.
    off: { x: 0.5, y: 0.5, angle: 0.5, def: null, center: false, scale: 1, hidden: false, pull: 0 },
    shoulder: [0.5, 0.5],
    // What an act shows besides (held.js): kind '' (nothing), 'crumbs', 'sip', 'scroll', 'mag';
    // where (x, y), how far in (k), t (how far through the act), its turn, the thing's colour.
    fx: { kind: '', x: 0.5, y: 0.5, k: 0.5, t: 0.5, angle: 0.5, f: 1, color: '' },
  };
}

/** A world thing held out ahead of the hand at (hx, hy) (dx, dy: along the arm), upright, leaning a little the way it's held. */
function holdOut(gun, hx, hy, dx, dy, f) {
  gun.center = true;
  gun.x = hx + dx * 2.4;
  gun.y = hy + dy * 2.4 - 0.6;
  gun.angle = Math.atan2(dy, dx * f) * 0.28 * f;
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
  // (Poses face left; mirror when facing right. Sat in a chair: as it faces, whichever way they look.)
  const m = s.sitting ? -1 : -s.facing;
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

  // Arms hold the weapon along the aim; what they're doing with it (s.anim.act: useanim.js)
  // moves them: a swing lifts it and brings it down, a thrust pushes it out, food goes to the
  // mouth, a scroll's opened out in front, a magazine comes out and goes back in...
  const sx = nx - ux * 2, sy = ny - uy * 2;
  // (In a world, what's in hand may be a tool, a block, food...: s.held says how it looks.)
  const def = s.held || WEAPONS[s.current] || WEAPONS.Platinum;
  const type = def.look.type, f = s.facing;
  const an = s.anim, act = an.act || '', t = an.use || 0;
  const kick = an.recoil;
  const twoHanded = TWO_HANDED.has(type);
  const gun = pose.gun, off = pose.off, fx = pose.fx;
  gun.def = def; gun.center = false; gun.scale = 1; gun.hidden = false; gun.pull = 0;
  off.def = null;
  fx.kind = '';
  // (The way along which it's held, a turn of the wrist besides, a push out along it, the arm stretched.)
  let hold = s.aim, turn = 0, thrust = 0, stretch = 1;
  switch (act) {
    case 'mine': case 'chop': case 'smash': case 'hammer': {
      const r = swingLift(t, LIFT[act]);
      hold -= f * r * 0.8;
      turn = -f * r * 0.3;
      break;
    }
    case 'place': { const p = pulse(t, 0.3); thrust = 3.5 * p; stretch = 1 + 0.16 * p; gun.scale = 1 - 0.35 * p; break; }
    case 'stab': { const p = pulse(t, 0.2); thrust = 5 * p; stretch = 1 + 0.22 * p; break; }
    case 'punch': {
      // (Drawn back, then a jab.)
      thrust = t < 0.12 ? -3.5 * easeOut(t / 0.12) : t < 0.3 ? -3.5 + 6 * easeOut((t - 0.12) / 0.18) : 2.5 * (1 - smooth((t - 0.3) / 0.7));
      stretch = 1 + 0.12 * clamp01(thrust / 2.5);
      break;
    }
    case 'throw': { const p = pulse(t, 0.22); hold += f * 0.95 * p; thrust = 2.5 * p; stretch = 1 + 0.15 * p; gun.hidden = t < 0.55; break; }
    case 'reach': { const p = Math.sin(Math.PI * t); thrust = 3.5 * p; stretch = 1 + 0.15 * p; break; }
    case 'show': { const p = pulse(t, 0.25); hold -= f * 0.85 * p; gun.scale = 1 + 0.2 * p; break; }
    case 'reload': hold += f * 0.45 * inOut(t, 0.15, 0.85); break;
  }
  const dx = Math.cos(hold), dy = Math.sin(hold);
  const bow = type === 'bow' && !act;
  const backDist = twoHanded ? 5 - kick : 11 - kick;
  const frontDist = (bow ? 14.4 : twoHanded ? 12 - kick : 12.5 - kick) + thrust;
  // Bend elbows downward, and backward when aiming straight up or down.
  const bx = -f * 0.6, by = 1;
  const gunBack = (bow ? 4.5 - kick : twoHanded ? 1 - kick : 9 - kick) + thrust;
  gun.x = sx + dx * gunBack; gun.y = sy + dy * gunBack; gun.angle = hold + turn;
  // The other hand: a world's right hand's thing, down at the side (when this hand's free).
  const other = s.held2 && !twoHanded && !bow && act !== 'read' && act !== 'reload' ? s.held2 : null;
  if (bow) {
    // A bow: held out at arm's length, its string drawn back to the cheek (let go just as it's loosed).
    const pull = kick > 0.4 ? 0 : 1;
    gun.pull = pull;
    const back = 2 + (1 - pull) * 6.35 - kick;
    reach(sx, sy, sx + dx * back, sy + dy * back, bx, by, L[5], L[6]);
  } else if (other) {
    reach(sx, sy, sx + f * 3.2, sy + 9.6, bx, by, L[5], L[6]);
    const hx = L[6][2], hy = L[6][3];
    off.def = other; off.scale = 0.85; off.hidden = false; off.pull = 0;
    if (other.item) { off.center = true; off.x = hx + f * 1.4; off.y = hy - 2.2; off.angle = 0; }
    else {
      // (A torch held up, the rest hanging down ahead: by the end of the handle.)
      off.center = false;
      off.angle = other.look.type === 'torch' ? -Math.PI / 2 + f * 0.3 : f > 0 ? 1.1 : Math.PI - 1.1;
      off.x = hx - Math.cos(off.angle) * 2; off.y = hy - Math.sin(off.angle) * 2;
    }
  } else reach(sx, sy, sx + dx * backDist, sy + dy * backDist + (twoHanded ? 1.5 : 0), bx, by, L[5], L[6]);
  reach(sx, sy, sx + dx * frontDist, sy + dy * frontDist, bx, by, L[7], L[8], stretch);
  // A world thing (food, a block, a gem...) held out ahead of the hand.
  if (def.item) holdOut(gun, L[8][2], L[8][3], dx, dy, f);

  if (act === 'eat' || act === 'drink') {
    // To the mouth and back: a few bites (or a long swig, the bottle tipped up).
    const k = inOut(t, 0.2, 0.84);
    const chew = t > 0.2 && t < 0.84 ? Math.sin((t - 0.2) / 0.64 * Math.PI * 6) : 0;
    const mx = head.x + f * 2.4, my = head.y + 1.8;
    const ix = mx + f * 2.2, iy = my + 0.4 + (act === 'eat' ? chew * 0.7 : 0);
    const hx = L[8][2], hy = L[8][3];
    reach(sx, sy, hx + (ix + f * 0.4 - hx) * k, hy + (iy + 2.6 - hy) * k, bx, by, L[7], L[8]);
    if (def.item) {
      const cx = gun.x, cy = gun.y;
      gun.x = cx + (ix - cx) * k; gun.y = cy + (iy - cy) * k;
      gun.angle = act === 'drink' ? gun.angle * (1 - k) - f * 2.05 * k : gun.angle * (1 - k);
      if (act === 'eat') gun.scale = 1 - 0.3 * clamp01((t - 0.2) / 0.64);
      fx.kind = act === 'eat' ? 'crumbs' : 'sip'; fx.x = mx; fx.y = my; fx.k = k; fx.t = t; fx.f = f; fx.color = def.item.color || '#c88a3a';
    }
  } else if (act === 'read') {
    // A scroll opened out in front, a hand at each end, read till its magic takes them home.
    const k = inOut(t, 0.06, 0.97);
    const cx = sx + f * 7.5, cy = sy + 1.5;
    const fx0 = L[8][2], fy0 = L[8][3], bx0 = L[6][2], by0 = L[6][3];
    reach(sx, sy, fx0 + (cx - f * 2.6 - fx0) * k, fy0 + (cy + 4.6 - fy0) * k, bx, by, L[7], L[8]);
    reach(sx, sy, bx0 + (cx - f * 2.6 - bx0) * k, by0 + (cy - 4.6 - by0) * k, bx, by, L[5], L[6]);
    gun.hidden = k > 0.3;
    fx.kind = 'scroll'; fx.x = cx; fx.y = cy; fx.k = k; fx.t = t; fx.f = f; fx.color = '';
  } else if (act === 'reload') {
    // The front hand goes to the magazine: out, a fresh one, in (a shotgun: pumped; the rest:
    // loaded where they're held).
    const k = inOut(t, 0.15, 0.85);
    const flip = Math.cos(hold) < 0, downX = flip ? dy : -dy, downY = flip ? -dx : dx;
    const along = twoHanded ? 8 : 5.5;
    const wx = gun.x + dx * along + downX * 3.5, wy = gun.y + dy * along + downY * 3.5;
    let drop = 0, slide = 0, mag = false;
    if (MAGAZINES.has(type)) {
      if (t < 0.18) drop = 0;
      else if (t < 0.38) { drop = 6 * smooth((t - 0.18) / 0.2); mag = true; }
      else if (t < 0.5) drop = 6 + 3 * Math.sin(Math.PI * (t - 0.38) / 0.12);
      else if (t < 0.62) { drop = 6; mag = true; }
      else if (t < 0.78) { drop = 6 * (1 - smooth((t - 0.62) / 0.16)); mag = true; }
    } else if (type === 'shotgun') slide = t > 0.15 && t < 0.85 ? -3.5 * Math.abs(Math.sin((t - 0.15) / 0.7 * Math.PI * 2)) : 0;
    const tx = wx + downX * drop + dx * slide, ty = wy + downY * drop + dy * slide;
    const hx = L[8][2], hy = L[8][3];
    reach(sx, sy, hx + (tx - hx) * k, hy + (ty - hy) * k, bx, by, L[7], L[8]);
    if (mag && k > 0.5) { fx.kind = 'mag'; fx.x = L[8][2]; fx.y = L[8][3]; fx.k = k; fx.t = t; fx.angle = hold; fx.f = f; fx.color = def.look.color || '#333'; }
  }
  pose.shoulder[0] = sx; pose.shoulder[1] = sy;
  return pose;
}
