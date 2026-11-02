// Seeded noise for making worlds (worldgen.js). The same seed makes the same world on any
// machine: only + - * /, Math.floor, Math.imul and Math.sqrt are used, which every browser
// works out exactly the same (unlike Math.sin or Math.exp, which can differ in the last bit).

/** A well-mixed 32-bit hash of three integers (a seed and a position). */
export function hash3(seed, x, y) {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** hash3 as a number from 0 up to (not including) 1. */
export const rand3 = (seed, x, y) => hash3(seed, x, y) / 4294967296;

// Quintic easing (Perlin's): smooth at the lattice points.
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

// Eight gradient directions (no sines needed).
const GX = [1, -1, 0, 0, 0.7071067811865476, -0.7071067811865476, 0.7071067811865476, -0.7071067811865476];
const GY = [0, 0, 1, -1, 0.7071067811865476, 0.7071067811865476, -0.7071067811865476, -0.7071067811865476];

/** 2D gradient noise, about -0.7 to 0.7 (0 at whole-number points). */
export function noise2(seed, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  let h = hash3(seed, x0, y0) & 7;
  const n00 = GX[h] * fx + GY[h] * fy;
  h = hash3(seed, x0 + 1, y0) & 7;
  const n10 = GX[h] * (fx - 1) + GY[h] * fy;
  h = hash3(seed, x0, y0 + 1) & 7;
  const n01 = GX[h] * fx + GY[h] * (fy - 1);
  h = hash3(seed, x0 + 1, y0 + 1) & 7;
  const n11 = GX[h] * (fx - 1) + GY[h] * (fy - 1);
  const u = fade(fx), v = fade(fy);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

/** 1D gradient noise, about -0.5 to 0.5. */
export function noise1(seed, x) {
  const x0 = Math.floor(x), f = x - x0;
  const g0 = (hash3(seed, x0, 0x51ed) / 2147483648) - 1, g1 = (hash3(seed, x0 + 1, 0x51ed) / 2147483648) - 1;
  return lerp(g0 * f, g1 * (f - 1), fade(f));
}

/** Fractal 1D noise: `octaves` layers, each twice as fine and half as strong. About -1 to 1. */
export function fbm1(seed, x, octaves = 4) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise1(seed + i * 1013, x * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return (sum / norm) * 2;
}

/** Fractal 2D noise, about -1 to 1. */
export function fbm2(seed, x, y, octaves = 3) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(seed + i * 7919, x * f, y * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return (sum / norm) * 1.45;
}

/** A seed from text (a world's seed as typed), or a number as it is. */
export function seedOf(text) {
  const t = String(text ?? '').trim();
  if (/^-?\d{1,9}$/.test(t)) return Number(t) | 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193);
  return h | 0;
}
