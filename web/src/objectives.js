// Where the objective modes are fought: king of the hill's hills, capture the
// flag's flag stands, conquest's capture points, rush's M-COM stations and
// defuse's bomb sites.
//
// Maps can place their own (see custommaps.js for the format). A map without
// them (most custom maps) gets some worked out from its layout, so every map
// plays every mode. Everything here depends only on the map, so the host and
// every online player work out the same objectives.

import { BODY } from './config.js';

// A soldier standing on a floor at y has their origin (hip height) at y - STAND.
export const STAND = BODY.bottom;

// Sizes of the areas made for maps that don't place their own.
const HILL_W = 150, HILL_H = 90;
const POINT_W = 170, POINT_H = 100;
const SITE_W = 200, SITE_H = 110;

/**
 * Places a soldier can stand: { x, y (the floor), solid, width (of that floor) },
 * every `step` px along every floor with room to stand above it.
 */
export function floorSpots(map, step = 12) {
  const out = [];
  const b = map.bounds;
  for (const s of map.solids) {
    if (s.bounce || s.r - s.l < 14 || s.t < b.top || s.t > b.bottom) continue;
    const n = Math.max(1, Math.round((s.r - s.l - 14) / step));
    for (let i = 0; i <= n; i++) {
      const x = s.l + 7 + ((s.r - s.l - 14) * i) / n;
      if (map.overlap(x - BODY.halfW, s.t + BODY.top - BODY.bottom, x + BODY.halfW, s.t - 0.01)) continue;
      out.push({ x, y: s.t, solid: s, width: s.r - s.l });
    }
  }
  return out;
}

/** The floor under (x, y): the top of the first solid below, or null if there's none (a pit). */
export function floorBelow(map, x, y, reach = 2400) {
  const hit = map.raycast(x, y, x, y + reach);
  return hit && hit.ny < 0 ? hit.y : null;
}

/** Floor spots inside an area (where soldiers can spawn on a capture point), remembered. */
export function spotsIn(map, z) {
  const cache = (map.zoneSpots ||= new Map());
  let list = cache.get(z);
  if (!list) {
    list = floorSpots(map, 10).filter(p => p.x >= z.left + 4 && p.x <= z.right - 4 && p.y - STAND >= z.top && p.y - STAND <= z.bottom + 4);
    cache.set(z, list);
  }
  return list;
}

/** True if a soldier is inside an area (a hill or capture point). */
export function inZone(s, z) {
  return s.x >= z.left && s.x <= z.right && s.y >= z.top && s.y <= z.bottom + 4;
}

/** The area around an M-COM where soldiers arm or disarm it. */
export function mcomZone(m) {
  return { left: m.x - 26, right: m.x + 26, top: m.y - 64, bottom: m.y };
}

/** True if a soldier is touching a flag (on its stand, carried or dropped at (x, y)). */
export function touchesFlag(s, f) {
  return Math.abs(s.x - f.x) <= 14 && s.y + BODY.bottom >= f.y - 40 && s.y + BODY.top <= f.y + 2;
}

/**
 * A map's objectives of one type: its own, or ones worked out from its layout.
 * Flags: always one for each team (the first the map has for that team).
 */
export function objectivesOf(map, type) {
  const own = (map.objectives || []).filter(o => o.type === type);
  if (type === 'flag') {
    const flags = [1, 2].map(t => own.find(f => f.team === t));
    if (flags[0] && flags[1]) return flags;
    const made = defaults(map).flag;
    return [flags[0] || made[0], flags[1] || made[1]];
  }
  if (own.length) {
    // M-COMs in sector order, then left to right; bomb sites in letter order; points keep the map's order.
    if (type === 'mcom') return [...own].sort((a, b) => a.sector - b.sector);
    if (type === 'site') return [...own].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    return own;
  }
  if (type === 'site') return defaultSites(map);
  return defaults(map)[type];
}

/**
 * Bomb sites for a map without its own: around the M-COMs Rush's attackers go for
 * first (blue attacks there, as the bomb's carriers do), A and B.
 */
function defaultSites(map) {
  if (map.madeSites) return map.madeSites;
  const mcoms = objectivesOf(map, 'mcom');
  const first = mcoms.filter(m => m.sector === mcoms[0]?.sector);
  const list = (first.length >= 2 ? first : mcoms).slice(0, 2);
  map.madeSites = list.map((m, i) => ({ type: 'site', label: String.fromCharCode(65 + i), left: m.x - SITE_W / 2, top: m.y - SITE_H, right: m.x + SITE_W / 2, bottom: m.y }));
  return map.madeSites;
}

/** Objectives worked out from a map's layout (remembered with the map). */
function defaults(map) {
  if (map.madeObjectives) return map.madeObjectives;
  const b = map.bounds;
  const spots = floorSpots(map, 16);
  const mean = list => (list.length ? { x: avg(list.map(p => p.x)), y: avg(list.map(p => p.y)) } : null);
  const all = mean(map.spawns) || { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
  let blue = mean(map.spawns.filter(s => s.team === 1)), red = mean(map.spawns.filter(s => s.team === 2));
  const w = b.right - b.left;
  if (!blue || !red || Math.abs(blue.x - red.x) < w * 0.15) {
    // No clear sides: blue on the left, red on the right.
    blue = { x: b.left + w * 0.2, y: all.y };
    red = { x: b.right - w * 0.2, y: all.y };
  }
  const dir = Math.sign(red.x - blue.x) || 1;
  const along = f => blue.x + (red.x - blue.x) * f; // 0 = blue's side, 1 = red's
  const ySpread = Math.max(120, ...map.spawns.map(s => Math.abs(s.y - all.y)));

  /** The best spot near (x, y): on a wide floor, level with the action, not too close to `avoid`. */
  const pick = (x, y, avoid = [], minGap = 140) => {
    let best = null, bestScore = Infinity;
    for (const p of spots) {
      if (avoid.some(a => Math.hypot(a.x - p.x, a.y - p.y) < minGap)) continue;
      const score = Math.abs(p.x - x) + Math.abs(p.y - y) * 0.8 + (p.width < 90 ? 120 : 0) +
        (Math.abs(p.y - all.y) > ySpread + 60 ? 300 : 0);
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  };
  const zone = (p, W, H) => {
    const s = p.solid;
    let l = Math.max(p.x - W / 2, s.l - 20), r = Math.min(p.x + W / 2, s.r + 20);
    if (r - l < 70) { l = p.x - 35; r = p.x + 35; }
    return { left: Math.round(l), top: Math.round(p.y - H), right: Math.round(r), bottom: Math.round(p.y) };
  };
  const out = { hill: [], flag: [], point: [], mcom: [] };

  // King of the hill: one hill in the middle.
  const h = pick(along(0.5), all.y);
  if (h) out.hill.push({ type: 'hill', ...zone(h, HILL_W, HILL_H) });

  // Capture the flag: each team's flag at its spawn point furthest from the other team.
  for (const [team, home, away] of [[1, blue, red], [2, red, blue]]) {
    const own = map.spawns.filter(s => s.team === team);
    let at = null;
    if (own.length) {
      const s = own.reduce((a, c) => (Math.abs(c.x - away.x) > Math.abs(a.x - away.x) ? c : a));
      const y = floorBelow(map, s.x, s.y);
      if (y != null) at = { x: s.x, y };
    }
    if (!at) {
      const p = pick(home.x - (team === 1 ? dir : -dir) * w * 0.1, home.y);
      at = p ? { x: p.x, y: p.y } : { x: home.x, y: home.y };
    }
    out.flag.push({ type: 'flag', team, x: Math.round(at.x), y: Math.round(at.y) });
  }

  // Conquest: 3 points across the map (5 on wide maps), A on blue's side.
  const n = w > 2600 ? 5 : 3;
  const taken = [];
  for (let i = 0; i < n; i++) {
    const p = pick(along(-0.1 + 1.2 * (i + 0.5) / n), all.y, taken, 200);
    if (!p) continue;
    taken.push(p);
    out.point.push({ type: 'point', label: String.fromCharCode(65 + out.point.length), ...zone(p, POINT_W, POINT_H) });
  }

  // Rush: blue attacks. Two sectors toward red's side, with two M-COMs each (one on small maps).
  const two = w >= 1500;
  const used = [];
  for (const [sector, f] of [[1, 0.62], [2, 0.95]]) {
    const first = pick(along(f), all.y, used, 160);
    if (!first) continue;
    used.push(first);
    out.mcom.push({ type: 'mcom', sector, x: Math.round(first.x), y: Math.round(first.y) });
    if (!two) continue;
    // The second one somewhere else nearby, preferably at another height.
    let second = null, bestScore = Infinity;
    for (const p of spots) {
      if (used.some(a => Math.hypot(a.x - p.x, a.y - p.y) < 160) || Math.abs(p.x - first.x) > 420) continue;
      if ((p.x - along(f - 0.15)) * dir < 0) continue; // not back toward the attackers
      if (Math.abs(p.y - all.y) > ySpread + 60) continue;
      const score = Math.abs(p.x - along(f)) * 0.5 - Math.min(150, Math.abs(p.y - first.y)) + (p.width < 60 ? 100 : 0);
      if (score < bestScore) { bestScore = score; second = p; }
    }
    if (second) { used.push(second); out.mcom.push({ type: 'mcom', sector, x: Math.round(second.x), y: Math.round(second.y) }); }
  }
  map.madeObjectives = out;
  return out;
}

const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
