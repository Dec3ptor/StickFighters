// The sky over a world, and the life in it (world mode; all three renderers draw it): clouds
// drifting by far off behind everything (the original's and WebGL's: Remastered's scenery has
// its own), a layer of clouds high above the land, over the highest mountains, that you can
// climb or fly up into (inside one, everything goes soft and white), birds (gulls over the sea,
// songbirds over woods and meadows, crows, parrots in the jungle, an eagle circling the
// mountains, vultures over the desert, herons in the swamps, bats at dusk and in the night),
// leaves drifting down from the trees, fireflies at night, and motes of dust in caves.
//
// It all comes from the world's seed and its time (world.time), so everyone online sees the same
// clouds and the same birds going over, with nothing sent; only birds scattering when someone
// comes near (or at a bang) is each player's own. Nothing here touches the world or the game,
// and only tiles already made are looked at (none made for it).

import { TILE, SOLID, LEAVES_ALL, BLOCKS, AIR } from './blocks.js';
import { WORLD_H, SURFACE, SEA_ROW } from './worldgen.js';
import { rand3 } from './noise.js';
import { nightness } from './monsters.js';

// ---- The cloud layer -----------------------------------------------------------------------------

/** The rows (tiles from the top of the sky) the cloud layer's clouds keep between: over the highest mountains (about row 92), under the top. */
export const CLOUD_TOP = 34;
export const CLOUD_BOTTOM = 64;
const CELL = 1400;            // the layer's clouds come one to three to each stretch this wide (as the wind has them)
const SHAPES = 24;            // how many shapes of cloud there are (each cloud's one of them, scaled)

/** How fast the wind blows the clouds along (pixels an update; east is +). The same for every world with that seed. */
export function windOf(seed) {
  return (rand3(seed, 7, 7) < 0.5 ? -1 : 1) * (0.1 + 0.12 * rand3(seed, 8, 8));
}

/**
 * Cloud shape i: puffs (in threes: x, y and radius) in a box 1 wide and h high, lying along a
 * flat bottom, tallest in the middle. The same for everyone.
 */
const shapes = [];
function shapeOf(i) {
  let s = shapes[i];
  if (s) return s;
  const h = 1 / (2.4 + 1.2 * rand3(911, i, 1)), n = 9 + Math.floor(rand3(911, i, 2) * 6), puffs = [];
  for (let k = 0; k < n; k++) {
    const x = 0.14 + 0.72 * (k + rand3(911, i, 10 + k)) / n;
    const bump = 1 - Math.abs(x - 0.5) * 2;
    const r = h * (0.2 + 0.2 * bump + 0.1 * rand3(911, i, 40 + k));
    const y = Math.max(r + 0.02 * h, h * 0.66 - r * 0.6 - h * 0.08 * rand3(911, i, 70 + k));
    puffs.push(Math.min(Math.max(x, r + 0.02), 0.98 - r), y, r);
  }
  return (shapes[i] = { h, puffs });
}

// The layer's clouds in each stretch (as the wind has them: u, a place in the moving air), kept a
// while (for each seed: by the stretch's number).
const cellsBySeed = new Map();
function cellClouds(seed, ci) {
  let cells = cellsBySeed.get(seed);
  if (!cells) { if (cellsBySeed.size > 8) cellsBySeed.clear(); cellsBySeed.set(seed, cells = new Map()); }
  let list = cells.get(ci);
  if (list) return list;
  list = [];
  const n = rand3(seed, ci, 901) < 0.12 ? 1 : rand3(seed, ci, 902) < 0.55 ? 2 : 3;
  for (let j = 0; j < n; j++) {
    const shape = Math.floor(rand3(seed, ci, 920 + j) * SHAPES), sh = shapeOf(shape);
    const w = 200 + 360 * rand3(seed, ci, 930 + j), h = w * sh.h;
    const y = (CLOUD_TOP + 2) * TILE + h / 2 + rand3(seed, ci, 940 + j) * Math.max(0, (CLOUD_BOTTOM - CLOUD_TOP - 4) * TILE - h);
    list.push({ u: ci * CELL + (j + 0.1 + 0.8 * rand3(seed, ci, 910 + j)) * CELL / n, y, w, h, shape, front: rand3(seed, ci, 950 + j) < 0.5 });
  }
  if (cells.size > 400) cells.delete(cells.keys().next().value);
  cells.set(ci, list);
  return list;
}

/**
 * The cloud layer's clouds overlapping world x from x0 to x1 at time t: each one's x (its middle)
 * and its record { y (its middle), w, h, shape, front }, into xs and out (filled again).
 */
export function layerClouds(seed, t, x0, x1, out = [], xs = []) {
  out.length = 0;
  xs.length = 0;
  const wind = windOf(seed), shift = wind * t;
  for (let ci = Math.floor((x0 - shift - 300) / CELL); ci <= Math.floor((x1 - shift + 300) / CELL); ci++) {
    for (const c of cellClouds(seed, ci)) {
      const x = c.u + shift;
      if (x + c.w / 2 >= x0 && x - c.w / 2 <= x1) { out.push(c); xs.push(x); }
    }
  }
  return out;
}

const NEAR = [], NEAR_X = [];
/** How deep in the cloud layer's clouds (0 out of them, 1 deep in) the point (x, y) is at time t. */
export function cloudAt(seed, t, x, y) {
  if (y < CLOUD_TOP * TILE - 40 || y > CLOUD_BOTTOM * TILE + 40) return 0;
  layerClouds(seed, t, x - 1, x + 1, NEAR, NEAR_X);
  let most = 0;
  for (let i = 0; i < NEAR.length; i++) {
    const c = NEAR[i], s = shapeOf(c.shape), w = c.w;
    const lx = (x - NEAR_X[i]) / w + 0.5, ly = (y - c.y) / w + s.h / 2;
    const p = s.puffs;
    for (let k = 0; k < p.length; k += 3) {
      const d = Math.hypot(lx - p[k], ly - p[k + 1]) / p[k + 2];
      if (d < 1) most = Math.max(most, Math.min(1, (1 - d) * 1.6));
    }
  }
  return most;
}

// ---- Birds ---------------------------------------------------------------------------------------

// Kinds of bird: how many to a flock, how fast (pixels an update), how high over the ground (tiles),
// how big (wing to wing / 2), their colour (Remastered's; the original's are ink), how they fly.
const BIRDS = {
  gull: { n: [2, 5], speed: [0.9, 1.4], height: [5, 13], size: 4.2, color: '#f6f6f2', edge: '#5f6e78', flap: 0.17, glide: 0.55 },
  song: { n: [5, 11], speed: [1.6, 2.2], height: [9, 17], size: 2.1, color: '#4e3c2e', flap: 0.6, glide: 0.1, flutter: 1 },
  crow: { n: [3, 7], speed: [1.2, 1.6], height: [8, 16], size: 3.3, color: '#18181e', flap: 0.3, glide: 0.25 },
  parrot: { n: [3, 6], speed: [1.4, 1.9], height: [12, 20], size: 3, colors: ['#e3342c', '#2f8fe0', '#2fb44a', '#f2c230'], flap: 0.45, glide: 0.15 },
  eagle: { n: [1, 1], speed: [0.9, 1.1], height: [26, 36], size: 6.6, color: '#4a3220', flap: 0.12, glide: 0.88, circle: [80, 140] },
  vulture: { n: [1, 3], speed: [0.8, 1], height: [18, 28], size: 5.6, color: '#2a2420', flap: 0.1, glide: 0.92, circle: [60, 110] },
  heron: { n: [1, 2], speed: [0.7, 0.9], height: [4, 8], size: 5, color: '#e6eaec', edge: '#6a7680', flap: 0.13, glide: 0.25 },
  bat: { n: [4, 10], speed: [1.4, 2], height: [5, 13], size: 2.5, color: '#1c1622', edge: '#6a6680', flap: 0.95, glide: 0, erratic: 1 },
};
export const BIRD_KINDS = Object.keys(BIRDS);

const FLOCK_CELL = 1600;   // flocks set out across each stretch this wide...
const SLOT = 1500;         // ...now and then, this many updates apart (25 seconds)...
const LIFE = 2700;         // ...and cross the sky in this many (45 seconds)
const FLOCKS = 0.7;        // how likely a flock sets out each time

/** What kind of bird a flock over biome `b` is at time t (r: a roll, 0 to 1), or null for none. */
function kindFor(b, t, r) {
  const n = nightness(t), key = b?.key || 'plains';
  if (n > 0.75) return r < 0.45 && !b?.sea ? 'bat' : null;
  if (n > 0.15) return b?.sea ? (r < 0.3 ? 'gull' : null) : r < 0.55 ? 'bat' : r < 0.75 ? 'crow' : null;
  if (b?.sea) return r < (b.frozen ? 0.4 : 0.75) ? 'gull' : null;
  switch (key) {
    case 'swamp': return r < 0.35 ? 'heron' : r < 0.55 ? 'crow' : r < 0.8 ? 'song' : null;
    case 'jungle': case 'bamboo_jungle': return r < 0.55 ? 'parrot' : r < 0.8 ? 'song' : null;
    case 'mountains': case 'snow': return r < 0.45 ? 'eagle' : r < 0.62 ? 'crow' : null;
    case 'desert': case 'badlands': return r < 0.5 ? 'vulture' : r < 0.62 ? 'crow' : null;
    case 'savanna': return r < 0.3 ? 'vulture' : r < 0.55 ? 'crow' : r < 0.8 ? 'song' : null;
    case 'plains': case 'meadow': return r < 0.35 ? 'crow' : r < 0.82 ? 'song' : null;
    case 'taiga': case 'snowy_taiga': case 'giant_taiga': return r < 0.4 ? 'crow' : r < 0.7 ? 'song' : null;
    case 'mushroom_fields': return r < 0.2 ? 'crow' : null;
    default: return r < 0.75 ? 'song' : r < 0.85 ? 'crow' : null;
  }
}

/** The top of the ground at column tx (rows): its land, or the sea's (or a lake's) surface. */
function groundRow(gen, tx) {
  const c = gen.column(tx);
  return Math.min(c.surf, c.biome?.sea || c.lake ? SEA_ROW : WORLD_H);
}

// Flocks worked out (where they go, and how high, kept: and which of their birds have been scared
// off), for each world (its seed and generator: the land they fly over) by their stretch and time.
const flocksOf = new Map();
function flocksFor(world, seed) {
  const id = `${seed}:${world.genVersion ?? 0}`;
  let m = flocksOf.get(id);
  if (!m) { if (flocksOf.size > 8) flocksOf.clear(); flocksOf.set(id, m = new Map()); }
  return m;
}

/** Flock (ci, k) of world `world` (its seed: seed; its flocks: flocks), or null if none sets out then. */
function flockOf(world, seed, ci, k, flocks) {
  const key = ci * 4294967296 + k;
  let f = flocks.get(key);
  if (f !== undefined) return f;
  f = null;
  if (rand3(seed, ci * 31 + 7, k) < FLOCKS) {
    const t0 = k * SLOT + rand3(seed, ci, k * 3 + 1) * SLOT * 0.5, gen = world.gen;
    const cx = (ci + 0.5) * FLOCK_CELL, tx = Math.floor(cx / TILE);
    const kind = gen ? kindFor(gen.biomeAt(tx), t0, rand3(seed, ci, k * 3 + 2)) : null;
    if (kind) {
      const B = BIRDS[kind], roll = i => rand3(seed, ci * 977 + i, k);
      const n = B.n[0] + Math.floor(roll(1) * (B.n[1] - B.n[0] + 1));
      const speed = B.speed[0] + roll(2) * (B.speed[1] - B.speed[0]);
      const height = (B.height[0] + roll(3) * (B.height[1] - B.height[0])) * TILE;
      const dir = roll(4) < 0.5 ? -1 : 1;
      f = { key, kind, n, speed, dir, t0, cx, height, birds: [], ground: null, x0: 0, circle: 0, phase: roll(5) * Math.PI * 2 };
      if (B.circle) {
        // Circling (on rising air, over one spot), as long as the flock's about.
        f.circle = B.circle[0] + roll(6) * (B.circle[1] - B.circle[0]);
        f.cx = cx + (roll(7) - 0.5) * FLOCK_CELL * 0.5;
        f.top = groundRow(gen, Math.floor(f.cx / TILE)) * TILE;
        for (let d = -2; d <= 2; d++) f.top = Math.min(f.top, groundRow(gen, Math.floor((f.cx + d * f.circle) / TILE)) * TILE);
      } else {
        // Across: how high the ground is along the way (the highest within a stretch either side), so it
        // flies over hills and mountains, rising before them and coming down after.
        f.x0 = cx - dir * LIFE * speed / 2;
        const len = LIFE * speed, step = 48, m = Math.ceil(len / step) + 1, raw = new Float32Array(m), g = f.ground = new Float32Array(m);
        f.from = Math.min(f.x0, f.x0 + dir * len);
        for (let i = 0; i < m; i++) raw[i] = groundRow(gen, Math.floor((f.from + i * step) / TILE)) * TILE;
        for (let i = 0; i < m; i++) { let top = raw[i]; for (let j = Math.max(0, i - 10); j <= Math.min(m - 1, i + 10); j++) top = Math.min(top, raw[j]); g[i] = top; }
        f.step = step;
      }
      for (let i = 0; i < n; i++) {
        f.birds.push({
          // (Where in the flock: loose, the first ahead.)
          dx: kind === 'gull' || kind === 'heron' ? -dir * i * 16 + (roll(20 + i) - 0.5) * 10 : (roll(20 + i) - 0.5) * (kind === 'bat' ? 70 : 64) - dir * i * 4,
          dy: (roll(40 + i) - 0.5) * (kind === 'song' ? 26 : 18) + (kind === 'gull' ? Math.abs(i - n / 2) * 3 : 0),
          ph: roll(60 + i) * Math.PI * 2,
          color: B.colors ? B.colors[Math.floor(roll(80 + i) * B.colors.length)] : B.color,
          scared: null,
        });
      }
    }
  }
  if (flocks.size > 160) flocks.delete(flocks.keys().next().value);
  flocks.set(key, f);
  return f;
}

/** Flock f's middle at time t: [x, y, dir] into `at`, or false when it isn't in the sky then. */
function flockAt(f, t, at) {
  const age = t - f.t0;
  if (age < 0 || age > LIFE) return false;
  if (f.circle) {
    const a = f.phase + age * f.speed / f.circle * f.dir;
    at[0] = f.cx + Math.cos(a) * f.circle;
    at[1] = f.top - f.height + Math.sin(a) * f.circle * 0.22;
    at[2] = -Math.sin(a) * f.dir < 0 ? -1 : 1;
    return true;
  }
  const x = f.x0 + f.dir * f.speed * age, g = f.ground, u = (x - f.from) / f.step;
  const i = Math.max(0, Math.min(g.length - 2, Math.floor(u))), k = Math.max(0, Math.min(1, u - i));
  at[0] = x;
  at[1] = g[i] + (g[i + 1] - g[i]) * k * k * (3 - 2 * k) - f.height + Math.sin(age * 0.012 + f.phase) * 6;
  at[2] = f.dir;
  return true;
}

/**
 * Birds over world x from x0 to x1 at time t (where they'd be in their flock, whether or not
 * they've been scared off since): [{ kind, x, y, scared }] into `out`. For the tests, and
 * anything wanting to know.
 */
export function birdsIn(world, t, x0, x1, out = []) {
  out.length = 0;
  const seed = world.gen?.seed ?? world.seed ?? 1, at = [0, 0, 0];
  eachFlock(world, seed, t, x0, x1, f => {
    if (!flockAt(f, t, at)) return;
    for (const b of f.birds) out.push({ kind: f.kind, x: at[0] + b.dx, y: at[1] + b.dy, scared: !!b.scared });
  });
  return out;
}

/** Each flock that may be over world x from x0 to x1 at time t. */
function eachFlock(world, seed, t, x0, x1, fn) {
  const reach = LIFE * 2.2 / 2 + 300, flocks = flocksFor(world, seed);
  const k1 = Math.floor(t / SLOT), k0 = Math.floor((t - LIFE - SLOT) / SLOT);
  for (let ci = Math.floor((x0 - reach) / FLOCK_CELL); ci <= Math.floor((x1 + reach) / FLOCK_CELL); ci++) {
    for (let k = k0; k <= k1; k++) {
      // (Quick: is it about, and anywhere near?)
      if (rand3(seed, ci * 31 + 7, k) >= FLOCKS) continue;
      const f = flockOf(world, seed, ci, k, flocks);
      if (f) fn(f);
    }
  }
}

// ---- What each player sees (birds scared off), and the bangs that scare them -------------------

const skies = new WeakMap();
function skyOf(world) {
  let s = skies.get(world);
  if (!s) skies.set(world, s = { bangs: [], fog: 0 });
  return s;
}

// Sounds loud enough to scare birds (and how far off).
const LOUD = {
  explosion: 640, explosionSmall: 420, bombBlast: 800, rocket: 380, gib: 380, rumble: 640, plane: 500, flashbang: 500,
  pistol: 300, magnum: 340, uzi: 300, rifle: 340, ak: 340, shotgun: 360, sniper: 420, minigun: 380, thump: 300, smash: 220, sledge: 220,
};

/** Sounds played this frame (main.js): bangs near birds scare them off. */
export function skyHears(game, sounds) {
  const world = game.world;
  if (!world || !sounds?.length) return;
  const sky = skyOf(world), t = world.time || 0;
  for (const s of sounds) {
    const r = LOUD[s.name];
    if (r && Number.isFinite(s.x) && Number.isFinite(s.y)) sky.bangs.push(s.x, s.y, r, t);
  }
  // (Only the last couple of seconds' are kept.)
  let i = 0;
  while (i < sky.bangs.length && t - sky.bangs[i + 3] > 120) i += 4;
  if (i) sky.bangs.splice(0, i);
}

// ---- Drawing -----------------------------------------------------------------------------------

/** How much of each was drawn last frame (for the tests: it stays small however much is on screen). */
export const skyDrawn = { clouds: 0, far: 0, birds: 0, leaves: 0, motes: 0, fireflies: 0 };

/** World time now, between updates (smooth). */
const timeOf = (r, world) => (world.time || 0) + (r.alpha ?? 1);
const seedOf = world => world.gen?.seed ?? world.seed ?? 1;

/** A picture drawn in world units at (x, y), w x h (WebGL's stand-in canvas draws pictures its own way). */
function blit(ctx, cv, x, y, w, h) {
  if (ctx.drawImage) ctx.drawImage(cv, x, y, w, h);
  else ctx.image?.(cv, x, y, w, h);
}

const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.ceil(w)), height: Math.max(1, Math.ceil(h)) });

// The cloud shapes' pictures, made once for each look: 'rm' (soft, Remastered's), 'grey' (the same,
// stormy), 'ink' (the original's: white, a pencil line round them), 'far' (the original's, far off:
// just the faint line).
const pictures = { rm: [], grey: [], ink: [], far: [] };
function cloudPicture(look, i) {
  const list = pictures[look];
  if (list[i]) return list[i];
  const s = shapeOf(i), W = look === 'rm' || look === 'grey' ? 192 : 256, H = Math.ceil(W * s.h), p = s.puffs;
  const cv = canvas(W, H), g = cv.getContext('2d');
  if (look === 'rm' || look === 'grey') {
    const c = look === 'grey' ? [214, 220, 228] : [255, 255, 255];
    for (let k = 0; k < p.length; k += 3) {
      const x = p[k] * W, y = p[k + 1] * W, r = p[k + 2] * W;
      const gr = g.createRadialGradient(x, y - r * 0.15, 0, x, y, r);
      gr.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.95)`);
      gr.addColorStop(0.6, `rgba(${c[0]},${c[1]},${c[2]},0.7)`);
      gr.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Shaded underneath.
    g.globalCompositeOperation = 'source-atop';
    const sh = g.createLinearGradient(0, H * 0.25, 0, H);
    sh.addColorStop(0, 'rgba(120,140,170,0)');
    sh.addColorStop(1, look === 'grey' ? 'rgba(80,90,105,0.45)' : 'rgba(120,140,170,0.32)');
    g.fillStyle = sh;
    g.fillRect(0, 0, W, H);
  } else {
    // The outline round the outside of the puffs (each ringed, then all filled over).
    g.lineWidth = look === 'far' ? 2.2 : 3.2;
    g.strokeStyle = look === 'far' ? '#d2d2d2' : '#a9a9a9';
    for (let k = 0; k < p.length; k += 3) { g.beginPath(); g.arc(p[k] * W, p[k + 1] * W, p[k + 2] * W - 2, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#ffffff';
    for (let k = 0; k < p.length; k += 3) { g.beginPath(); g.arc(p[k] * W, p[k + 1] * W, p[k + 2] * W - 2, 0, Math.PI * 2); g.fill(); }
    if (look === 'far') {
      // (Far off, only the line shows: the white's cut away.)
      g.globalCompositeOperation = 'destination-out';
      for (let k = 0; k < p.length; k += 3) { g.beginPath(); g.arc(p[k] * W, p[k + 1] * W, p[k + 2] * W - 3.4, 0, Math.PI * 2); g.fill(); }
    }
  }
  g.globalCompositeOperation = 'source-over';
  return (list[i] = cv);
}

const CL = [], CLX = [];

/** The cloud layer's clouds on screen: those behind (front false) or in front of everything in the world. */
function drawLayer(ctx, r, game, classic, front) {
  const world = game.world, v = r.view;
  if (v.t > CLOUD_BOTTOM * TILE + 40 || v.b < CLOUD_TOP * TILE - 40) return;
  const seed = seedOf(world), t = timeOf(r, world), gen = world.gen;
  layerClouds(seed, t, v.l, v.r, CL, CLX);
  const a0 = ctx.globalAlpha;
  for (let i = 0; i < CL.length; i++) {
    const c = CL[i];
    if (c.front !== front) continue;
    const x = CLX[i];
    // (Greyer where it's snowing below, and over the swamps.)
    const b = gen?.biomeAt(Math.floor(x / TILE));
    const grey = !classic && !!b && (b.climate === 0 || b.key === 'swamp' || b.key === 'dark_forest');
    const cv = cloudPicture(classic ? 'ink' : grey ? 'grey' : 'rm', c.shape);
    ctx.globalAlpha = a0 * (front ? (classic ? 0.72 : 0.66) : (classic ? 0.95 : 0.9));
    blit(ctx, cv, x - c.w / 2, c.y - c.h / 2, c.w, c.h);
    skyDrawn.clouds++;
  }
  ctx.globalAlpha = a0;
}

/**
 * Clouds far off behind everything (the original's and WebGL's: Remastered's scenery has its own),
 * drifting slowly with the wind, moving a little as the camera does; up over the land as seen from
 * near the ground (out of sight from deep down).
 */
function drawFarClouds(ctx, r, game) {
  const world = game.world, seed = seedOf(world), t = timeOf(r, world), S = r.s;
  const PX = 0.12, PY = 0.28, W = r.pw, H = r.ph;
  // (Where the band of them is: high over the usual ground.)
  const band = (SURFACE - 34) * TILE;
  const top = H / 2 + (band - 200 - r.cam.y) * PY * S, bottom = H / 2 + (band + 200 - r.cam.y) * PY * S;
  if (bottom < -60 || top > H + 60) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const shift = windOf(seed) * 0.35 * t, span = 900, k = S * 0.85;
  const u0 = (r.cam.x * PX - W / 2 / k) - shift, u1 = (r.cam.x * PX + W / 2 / k) - shift;
  for (let ci = Math.floor((u0 - 300) / span); ci <= Math.floor((u1 + 300) / span); ci++) {
    if (rand3(seed, ci, 1501) < 0.3) continue;
    const shape = Math.floor(rand3(seed, ci, 1502) * SHAPES), sh = shapeOf(shape);
    const w = (150 + 230 * rand3(seed, ci, 1503)), h = w * sh.h;
    const u = ci * span + rand3(seed, ci, 1504) * span * 0.7;
    const y = band + (rand3(seed, ci, 1505) - 0.5) * 340;
    const sx = W / 2 + (u + shift - r.cam.x * PX) * k, sy = H / 2 + (y - r.cam.y) * PY * S;
    blit(ctx, cloudPicture('far', shape), sx - w * k / 2, sy - h * k / 2, w * k, h * k);
    skyDrawn.far++;
  }
  ctx.setTransform(r.s, 0, 0, r.s, r.tx, r.ty);
}

const AT = [0, 0, 0];

/** Birds on screen (behind the world's blocks: hidden behind hills and trees), and scaring them off. */
function drawBirds(ctx, r, game, classic) {
  const world = game.world, v = r.view, seed = seedOf(world), t = timeOf(r, world);
  // (Deep underground: none.)
  if (v.t > (SURFACE + 40) * TILE) return;
  const sky = skyOf(world), bangs = sky.bangs, soldiers = game.soldiers;
  eachFlock(world, seed, t, v.l, v.r, f => {
    if (!flockAt(f, t, AT)) return;
    const fx = AT[0], fy = AT[1], dir = AT[2];
    if (fx < v.l - 260 || fx > v.r + 260 || fy < v.t - 200 || fy > v.b + 200) return;
    const B = BIRDS[f.kind], age = t - f.t0;
    // Scared: by anyone close, or a bang near; the rest of the flock goes too, a moment after.
    let scare = null;
    for (const b of f.birds) {
      if (b.scared) continue;
      const bx = fx + b.dx, by = fy + b.dy;
      for (const s of soldiers) {
        if (!s.alive || s.npc?.kind === 'animal' || s.npc?.kind === 'townsfolk') continue;
        const dx = bx - s.x, dy = by - (s.y - 12);
        if (dx * dx + dy * dy < 80 * 80) { scare = [s.x, s.y - 12]; break; }
      }
      if (!scare) for (let i = 0; i < bangs.length; i += 4) {
        const dx = bx - bangs[i], dy = by - bangs[i + 1];
        if (dx * dx + dy * dy < bangs[i + 2] * bangs[i + 2]) { scare = [bangs[i], bangs[i + 1]]; break; }
      }
      if (scare) break;
    }
    if (scare) {
      for (let i = 0; i < f.birds.length; i++) {
        const b = f.birds[i];
        if (b.scared) continue;
        const bx = fx + b.dx, by = fy + b.dy, away = Math.sign(bx - scare[0]) || dir;
        b.scared = { at: t + i * 3, x: bx, y: by, vx: away * (1.6 + (i % 3) * 0.4), vy: -1.3 - (i % 2) * 0.5 };
      }
    }
    // Draw them: a stroke each, wings up and down.
    const size = B.size, a0 = ctx.globalAlpha;
    let color = classic ? '#262626' : f.birds[0].color;
    ctx.lineWidth = Math.max(0.55, size * (classic ? 0.24 : 0.3));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const pass = (edge) => {
      ctx.beginPath();
      for (let i = 0; i < f.birds.length; i++) {
        const b = f.birds[i];
        if (!classic && !edge && B.colors && b.color !== color) continue;
        let x = fx + b.dx, y = fy + b.dy, flap = B.flap;
        if (b.scared) {
          const st = t - b.scared.at;
          if (st > 260) continue;
          if (st > 0) { x = b.scared.x + b.scared.vx * st * (1 + st / 90); y = b.scared.y + b.scared.vy * st * (1 + st / 120); flap = Math.max(flap, 0.7); }
        } else {
          // (Each wanders a little in the flock; bats flit about.)
          x += Math.sin(age * 0.021 + b.ph) * (B.erratic ? 16 : 5) + (B.erratic ? Math.sin(age * 0.11 + b.ph * 2) * 7 : 0);
          y += Math.sin(age * 0.033 + b.ph * 1.7) * (B.erratic ? 10 : 3);
        }
        if (x < v.l - 20 || x > v.r + 20 || y < v.t - 20 || y > v.b + 20) continue;
        if (!edge) skyDrawn.birds++;
        // Gliding a while, then flapping (wings: 1 up, -0.6 down).
        const gliding = B.glide > 0 && Math.sin(age * 0.004 + b.ph) > 1 - 2 * B.glide && !b.scared;
        const w = gliding ? 0.25 + Math.sin(age * 0.02 + b.ph) * 0.1 : Math.sin(age * flap + b.ph) * 0.8 + 0.2;
        const s = size, tipY = -s * w * 0.85, midY = -s * (0.15 + w * 0.45);
        if (f.kind === 'bat') {
          ctx.moveTo(x - s, y + tipY); ctx.lineTo(x - s * 0.55, y + midY + s * 0.25); ctx.lineTo(x - s * 0.3, y + midY); ctx.lineTo(x, y);
          ctx.lineTo(x + s * 0.3, y + midY); ctx.lineTo(x + s * 0.55, y + midY + s * 0.25); ctx.lineTo(x + s, y + tipY);
        } else {
          ctx.moveTo(x - s, y + tipY);
          ctx.quadraticCurveTo(x - s * 0.45, y + midY, x, y);
          ctx.quadraticCurveTo(x + s * 0.45, y + midY, x + s, y + tipY);
        }
      }
    };
    if (!classic && B.edge) {
      // (Pale birds: a darker line under them, so they show against a pale sky.)
      ctx.globalAlpha = a0 * 0.55;
      ctx.strokeStyle = B.edge;
      ctx.lineWidth = Math.max(0.8, size * 0.42);
      pass(true);
      ctx.stroke();
      ctx.globalAlpha = a0;
      ctx.lineWidth = Math.max(0.55, size * 0.3);
    }
    if (!classic && B.colors) {
      // (Colourful ones: each colour in its own go.)
      for (const c of B.colors) { color = c; ctx.strokeStyle = c; pass(false); ctx.stroke(); }
    } else {
      ctx.strokeStyle = color;
      pass(false);
      ctx.stroke();
    }
  });
}

// Each kind of leaf's colour as it falls (a little lighter than the tree's, to show against it).
const leafColors = new Map();
function leafColor(id) {
  let c = leafColors.get(id);
  if (!c) {
    const h = (BLOCKS[id]?.color || '#4f8a34').replace('#', ''), n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h.slice(0, 6), 16);
    const up = v => Math.min(255, Math.round(v + (255 - v) * 0.28));
    c = `rgb(${up(n >> 16 & 255)},${up(n >> 8 & 255)},${up(n & 255)})`;
    leafColors.set(id, c);
  }
  return c;
}

/** Leaves drifting down from the trees on screen (and petals from the cherry trees). */
function drawLeaves(ctx, r, game, classic) {
  const world = game.world, v = r.view, seed = seedOf(world), t = timeOf(r, world);
  if (v.t > (SURFACE + 30) * TILE) return;
  const C = 48, LEAF_LIFE = 420, slot = Math.floor(t / LEAF_LIFE), wind = windOf(seed) * 1.5;
  const a0 = ctx.globalAlpha;
  let n = 0;
  for (let cy = Math.floor((v.t - 120) / C); cy <= Math.floor(v.b / C); cy++) {
    if (cy * C > (SURFACE + 20) * TILE) break;
    for (let cx = Math.floor(v.l / C); cx <= Math.floor(v.r / C); cx++) {
      for (let k = slot - 1; k <= slot; k++) {
        if (rand3(seed, cx * 7919 + cy, k) > 0.3) continue;
        const x0 = cx * C + rand3(seed, cx, cy * 31 + k) * C, y0 = cy * C + rand3(seed, cy, cx * 17 + k) * C;
        const tx = Math.floor(x0 / TILE), ty = Math.floor(y0 / TILE);
        if (!world.has(tx >> 5, ty >> 5)) continue;
        const id = world.tile(tx, ty);
        if (!LEAVES_ALL.has(id)) continue;
        const age = t - (k * LEAF_LIFE + rand3(seed, cx + 5, cy + k) * LEAF_LIFE * 0.6);
        if (age < 0 || age > LEAF_LIFE) continue;
        const ph = rand3(seed, cx, cy + 999) * 6.28;
        const x = x0 + Math.sin(age * 0.045 + ph) * 9 + wind * age * 0.4, y = y0 + age * 0.32;
        const ttx = Math.floor(x / TILE), tty = Math.floor(y / TILE);
        // (Landed: gone.)
        if (world.has(ttx >> 5, tty >> 5) && SOLID[world.tile(ttx, tty)] && !LEAVES_ALL.has(world.tile(ttx, tty))) continue;
        if (y > v.b || x < v.l || x > v.r) continue;
        const fade = age > LEAF_LIFE - 60 ? (LEAF_LIFE - age) / 60 : age < 20 ? age / 20 : 1;
        ctx.globalAlpha = a0 * fade * (classic ? 0.8 : 0.95);
        ctx.fillStyle = classic ? '#6f7d66' : leafColor(id);
        // (Turning over as it falls: wide, then edge on.)
        const turn = Math.abs(Math.cos(age * 0.07 + ph));
        ctx.fillRect(x - 1.3 * turn - 0.3, y - 0.7, 2.6 * turn + 0.6, 1.4);
        skyDrawn.leaves++;
        if (++n > 90) { ctx.globalAlpha = a0; return; }
      }
    }
  }
  ctx.globalAlpha = a0;
}

/** Motes of dust hanging in the air of caves (dark where it's dark: drawn under the light). */
function drawMotes(ctx, r, game, classic) {
  const world = game.world, v = r.view, seed = seedOf(world), t = timeOf(r, world), gen = world.gen;
  const C = 72, a0 = ctx.globalAlpha;
  ctx.fillStyle = classic ? '#8a8a8a' : '#e8dcbc';
  for (let cy = Math.floor(v.t / C); cy <= Math.floor(v.b / C); cy++) {
    for (let cx = Math.floor(v.l / C); cx <= Math.floor(v.r / C); cx++) {
      if (rand3(seed, cx * 131 + 3, cy) > 0.3) continue;
      const x = cx * C + rand3(seed, cx, cy * 7 + 1) * C + Math.sin(t * 0.004 + cx) * 10;
      const y = cy * C + rand3(seed, cy, cx * 5 + 2) * C + Math.sin(t * 0.003 + cy * 1.3) * 8;
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      // (Only underground, in the open air of a cave.)
      if (!gen || ty < gen.surfaceAt(tx) + 6 || !world.has(tx >> 5, ty >> 5) || world.tile(tx, ty) !== AIR) continue;
      ctx.globalAlpha = a0 * (0.25 + 0.2 * Math.sin(t * 0.02 + cx * 3 + cy));
      ctx.fillRect(x, y, 0.8, 0.8);
      skyDrawn.motes++;
    }
  }
  ctx.globalAlpha = a0;
}

/** Fireflies over the grass on summer nights (glowing: drawn over the dark). */
function drawFireflies(ctx, r, game, classic) {
  const world = game.world, v = r.view, seed = seedOf(world), t = timeOf(r, world), gen = world.gen;
  const night = nightness(world.time || 0);
  if (night < 0.45 || !gen || v.t > (SURFACE + 40) * TILE || v.r - v.l > 3600) return;
  const C = 56, a0 = ctx.globalAlpha;
  for (let cx = Math.floor(v.l / C); cx <= Math.floor(v.r / C); cx++) {
    const tx = Math.floor((cx + 0.5) * C / TILE), col = gen.column(tx), b = col.biome;
    if (!b || b.sea || !FIREFLY_LANDS.has(b.key) || col.lake) continue;
    for (let j = 0; j < 2; j++) {
      if (rand3(seed, cx * 59 + j, 77) > 0.42) continue;
      const ph = rand3(seed, cx, 300 + j) * 6.28;
      const x = cx * C + rand3(seed, cx, 400 + j) * C + Math.sin(t * 0.011 + ph) * 22 + Math.sin(t * 0.027 + ph * 2) * 8;
      const y = col.surf * TILE - 10 - rand3(seed, cx, 500 + j) * 46 + Math.sin(t * 0.017 + ph * 3) * 10;
      if (x < v.l || x > v.r || y < v.t || y > v.b) continue;
      const ftx = Math.floor(x / TILE), fty = Math.floor(y / TILE);
      if (!world.has(ftx >> 5, fty >> 5) || SOLID[world.tile(ftx, fty)]) continue;
      const blink = Math.max(0, Math.sin(t * 0.045 + ph * 5));
      const a = blink * blink * Math.min(1, (night - 0.45) * 3);
      if (a < 0.03) continue;
      ctx.globalAlpha = a0 * a * 0.3;
      ctx.fillStyle = classic ? '#f0e860' : '#d9ff6a';
      ctx.beginPath(); ctx.arc(x, y, 4.6, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = a0 * a * 0.6;
      ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = a0 * a;
      ctx.fillStyle = '#fdffe0';
      ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
      skyDrawn.fireflies++;
    }
  }
  ctx.globalAlpha = a0;
}
const FIREFLY_LANDS = new Set(['plains', 'meadow', 'forest', 'birch_forest', 'swamp', 'jungle', 'cherry_grove', 'dark_forest', 'bamboo_jungle', 'savanna']);

/**
 * Behind the world's blocks (the world's transform set): far clouds (the original's and WebGL's),
 * the cloud layer's further clouds, and the birds.
 */
export function drawSkyBehind(ctx, r, game, classic) {
  if (!game.world || !r.view) return;
  for (const k in skyDrawn) skyDrawn[k] = 0;
  if (classic) drawFarClouds(ctx, r, game);
  drawLayer(ctx, r, game, classic, false);
  drawBirds(ctx, r, game, classic);
}

/** Over what's in the world, under its light (the dark hides them where it's dark): the cloud layer's nearer clouds, leaves falling, motes in caves. */
export function drawSkyFront(ctx, r, game, classic) {
  if (!game.world || !r.view) return;
  // (Zoomed a long way out, dev mode: too small to see, and too many to go through.)
  const near = r.view.r - r.view.l < 3600;
  if (near) drawLeaves(ctx, r, game, classic);
  if (near && r.quality !== 'low') drawMotes(ctx, r, game, classic);
  drawLayer(ctx, r, game, classic, true);
}

/**
 * Over the light: fireflies glowing, and, up in a cloud, everything soft and white (the eye: who
 * the view's from, or the camera).
 */
export function drawSkyGlow(ctx, r, game, classic, eye = null) {
  const world = game.world;
  if (!world || !r.view) return;
  ctx.setTransform(r.s, 0, 0, r.s, r.tx, r.ty);
  drawFireflies(ctx, r, game, classic);
  const ex = eye?.alive ? eye.x : r.cam.x, ey = eye?.alive ? eye.y - 14 : r.cam.y;
  const sky = skyOf(world), want = cloudAt(seedOf(world), timeOf(r, world), ex, ey);
  // (Easing in and out of it.)
  sky.fog += (want - sky.fog) * 0.08;
  if (sky.fog < 0.01) return;
  const night = nightness(world.time || 0), k = sky.fog * 0.62;
  const c = Math.round(255 - 190 * night), b = Math.round(255 - 170 * night);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = `rgba(${c},${c},${b},${k.toFixed(3)})`;
  ctx.fillRect(0, 0, r.pw, r.ph);
  ctx.setTransform(r.s, 0, 0, r.s, r.tx, r.ty);
}
