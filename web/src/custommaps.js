// Custom maps: checking and cleaning map data, share links, the original
// game's .ssm format, and the "check map" report. No browser APIs beyond
// compression streams, so it all runs in tests too.
//
// Map format (same as the decoded originals in web/data/maps/):
//   { name, bounds: {left, top, right, bottom},
//     platforms: [{ left, top, right, bottom, bounce? }],   bounce < 0 makes a jump pad
//     spawns: [{ x, y, team, sector? }],                     team 1 = blue, 2 = red; sector: Rush (see below)
//     items: [{ type: 'health'|'armour'|'jetpack'|'weapon', x, y, weapon? }],
//     loadout?: { weapons: [ids], armour: 0-100, jetpack: bool },      what everyone spawns with
//     objectives?: [                                         for the objective modes (see modes.js)
//       { type: 'hill', left, top, right, bottom },           King of the hill: an area to hold
//       { type: 'flag', team, x, y },                         Capture the flag: a team's flag stand (y = the floor)
//       { type: 'point', label, left, top, right, bottom },   Conquest: an area to capture, labelled A, B, C...
//       { type: 'mcom', sector, x, y } ] }                    Rush: a station to blow up (y = the floor); sectors
//                                                            1, 2, 3... fall in order, and spawns with a sector
//                                                            are used while that sector is being fought over

import { GameMap } from './map.js';
import { NavGraph } from './nav.js';
import { makeBody, stepBody } from './physics.js';
import { BODY, RULES, DEFAULT_SPEED } from './config.js';
import { WEAPONS, PICKUP_WEAPONS } from './weapons.js';
import { setGameSpeed } from './speed.js';
import { inZone, mcomZone, STAND } from './objectives.js';

export const ITEM_TYPES = ['health', 'armour', 'jetpack', 'weapon'];
export const OBJECTIVE_TYPES = ['hill', 'flag', 'point', 'mcom'];
export const LIMITS = { maxSize: 8000, maxPlatforms: 600, maxSpawns: 96, maxItems: 200, maxObjectives: 32, maxSectors: 8, minSize: 4, nameLength: 32, loadoutWeapons: 12 };
export const BOUNCE = { min: 2, max: 12, standard: 7 }; // jump pad strength (stored as a negative bounce)
const MARGIN = 40;

const round = v => Math.round(v * 10) / 10;

function number(v, what) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${what} isn't a number`);
  if (Math.abs(n) > 100000) throw new Error(`${what} is too far out`);
  return round(n);
}

/** The area a map takes up, with a margin, as the game expects in `bounds`. */
export function computeBounds(platforms, spawns, items, margin = MARGIN, objectives = []) {
  const xs = [], ys = [];
  for (const p of platforms) { xs.push(p.left, p.right); ys.push(p.top, p.bottom); }
  for (const s of spawns) { xs.push(s.x - 10, s.x + 10); ys.push(s.y - 30, s.y + 15); }
  for (const i of items) { xs.push(i.x - 10, i.x + 10); ys.push(i.y - 10, i.y + 10); }
  for (const o of Array.isArray(objectives) ? objectives : []) {
    const x = Number(o.x ?? o.left), y = Number(o.y ?? o.top);
    if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y - 40); }
  }
  if (!xs.length) return { left: -400, top: -300, right: 400, bottom: 300 };
  return {
    left: Math.floor(Math.min(...xs) - margin), top: Math.floor(Math.min(...ys) - margin),
    right: Math.ceil(Math.max(...xs) + margin), bottom: Math.ceil(Math.max(...ys) + margin),
  };
}

/** Clean up map data from anywhere (editor, file, link). Throws an Error with a readable message if it's unusable. */
export function normalizeMap(raw) {
  if (!raw || typeof raw !== 'object') throw new Error("That isn't a map");
  if (!Array.isArray(raw.platforms)) throw new Error("That isn't a map (no platforms list)");
  const platforms = [];
  for (const [i, p] of raw.platforms.slice(0, LIMITS.maxPlatforms).entries()) {
    let l = number(p.left, `Platform ${i + 1} left`), t = number(p.top, `Platform ${i + 1} top`);
    let r = number(p.right, `Platform ${i + 1} right`), b = number(p.bottom, `Platform ${i + 1} bottom`);
    if (l > r) [l, r] = [r, l];
    if (t > b) [t, b] = [b, t];
    if (r - l < LIMITS.minSize || b - t < LIMITS.minSize) continue;
    const out = { left: l, top: t, right: r, bottom: b };
    const bounce = Number(p.bounce) || 0;
    if (bounce) out.bounce = -Math.min(BOUNCE.max, Math.max(BOUNCE.min, Math.abs(round(bounce))));
    platforms.push(out);
  }
  const spawns = (Array.isArray(raw.spawns) ? raw.spawns : []).slice(0, LIMITS.maxSpawns).map((s, i) => {
    const out = { x: number(s.x, `Spawn ${i + 1} x`), y: number(s.y, `Spawn ${i + 1} y`), team: Number(s.team) === 2 ? 2 : 1 };
    const sector = Math.round(Number(s.sector));
    if (sector >= 1 && sector <= LIMITS.maxSectors) out.sector = sector;
    return out;
  });
  const items = [];
  for (const [i, it] of (Array.isArray(raw.items) ? raw.items : []).slice(0, LIMITS.maxItems).entries()) {
    if (!ITEM_TYPES.includes(it.type)) continue;
    if (it.type === 'weapon' && !WEAPONS[it.weapon]) continue;
    const out = { type: it.type, x: number(it.x, `Item ${i + 1} x`), y: number(it.y, `Item ${i + 1} y`) };
    if (it.type === 'weapon') out.weapon = it.weapon;
    items.push(out);
  }
  const name = String(raw.name ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.nameLength) || 'Untitled map';
  const bounds = computeBounds(platforms, spawns, items, MARGIN, raw.objectives);
  if (bounds.right - bounds.left > LIMITS.maxSize || bounds.bottom - bounds.top > LIMITS.maxSize) {
    throw new Error(`The map is too big (over ${LIMITS.maxSize} px across)`);
  }
  const out = { name, bounds, platforms, spawns, items };
  const loadout = normalizeLoadout(raw.loadout);
  if (loadout) out.loadout = loadout;
  const objectives = normalizeObjectives(raw.objectives);
  if (objectives.length) out.objectives = objectives;
  return out;
}

/** Objectives for the objective modes: known types only, areas the right way round, labels and sectors tidied. */
export function normalizeObjectives(raw) {
  const out = [];
  for (const [i, o] of (Array.isArray(raw) ? raw : []).slice(0, LIMITS.maxObjectives).entries()) {
    if (!o || !OBJECTIVE_TYPES.includes(o.type)) continue;
    const what = `Objective ${i + 1}`;
    if (o.type === 'hill' || o.type === 'point') {
      let l = number(o.left, `${what} left`), t = number(o.top, `${what} top`), r = number(o.right, `${what} right`), b = number(o.bottom, `${what} bottom`);
      if (l > r) [l, r] = [r, l];
      if (t > b) [t, b] = [b, t];
      if (r - l < 16 || b - t < 16) continue;
      const z = { type: o.type, left: l, top: t, right: r, bottom: b };
      if (o.type === 'point') z.label = String(o.label ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
      out.push(z);
    } else if (o.type === 'flag') {
      out.push({ type: 'flag', team: Number(o.team) === 2 ? 2 : 1, x: number(o.x, `${what} x`), y: number(o.y, `${what} y`) });
    } else {
      const sector = Math.max(1, Math.min(LIMITS.maxSectors, Math.round(Number(o.sector)) || 1));
      out.push({ type: 'mcom', sector, x: number(o.x, `${what} x`), y: number(o.y, `${what} y`) });
    }
  }
  // Capture points get letters in order where they have none (A, B, C...).
  let n = 0;
  for (const o of out) if (o.type === 'point') { if (!o.label) o.label = String.fromCharCode(65 + n); n++; }
  return out;
}

/** What everyone spawns with: known weapons only, armour 0-100. Null if it adds nothing. */
export function normalizeLoadout(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const weapons = [...new Set(Array.isArray(raw.weapons) ? raw.weapons : [])].filter(id => PICKUP_WEAPONS.includes(id)).slice(0, LIMITS.loadoutWeapons);
  const armour = Math.max(0, Math.min(100, Math.round(Number(raw.armour) || 0)));
  const jetpack = !!raw.jetpack;
  if (!weapons.length && !armour && !jetpack) return null;
  return { weapons, armour, jetpack };
}

// ---- Share links ---------------------------------------------------------------
// A map packed into a URL: compact arrays, deflated, base64url. About 1 KB for a typical map.

function pack(map) {
  return {
    v: 1,
    n: map.name,
    p: map.platforms.map(p => (p.bounce ? [p.left, p.top, p.right, p.bottom, p.bounce] : [p.left, p.top, p.right, p.bottom])),
    s: map.spawns.map(s => (s.sector ? [s.x, s.y, s.team, s.sector] : [s.x, s.y, s.team])),
    ...(map.objectives ? { o: map.objectives.map(o => (o.type === 'flag' ? ['f', o.x, o.y, o.team] : o.type === 'mcom' ? ['m', o.x, o.y, o.sector]
      : [o.type === 'hill' ? 'h' : 'p', o.left, o.top, o.right, o.bottom, ...(o.label ? [o.label] : [])])) } : {}),
    i: map.items.map(it => (it.type === 'weapon' ? [it.type, it.x, it.y, it.weapon] : [it.type, it.x, it.y])),
    ...(map.loadout ? { l: [map.loadout.weapons, map.loadout.armour, map.loadout.jetpack ? 1 : 0] } : {}),
  };
}

function unpack(o) {
  if (!o || o.v !== 1) throw new Error("That link isn't a map from this game");
  return normalizeMap({
    name: o.n,
    platforms: (o.p || []).map(([left, top, right, bottom, bounce]) => ({ left, top, right, bottom, bounce })),
    spawns: (o.s || []).map(([x, y, team, sector]) => ({ x, y, team, sector })),
    objectives: (o.o || []).map(([k, ...a]) => (k === 'f' ? { type: 'flag', x: a[0], y: a[1], team: a[2] } : k === 'm' ? { type: 'mcom', x: a[0], y: a[1], sector: a[2] }
      : { type: k === 'h' ? 'hill' : 'point', left: a[0], top: a[1], right: a[2], bottom: a[3], label: a[4] })),
    items: (o.i || []).map(([type, x, y, weapon]) => ({ type, x, y, weapon })),
    loadout: Array.isArray(o.l) ? { weapons: o.l[0], armour: o.l[1], jetpack: !!o.l[2] } : null,
  });
}

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function squeeze(text, compress) {
  const stream = new Blob([text]).stream().pipeThrough(compress ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The part after `#map=` in a share link. */
export async function encodeShare(map) {
  return toBase64Url(await squeeze(JSON.stringify(pack(normalizeMap(map))), true));
}

export async function decodeShare(code) {
  let bytes;
  try { bytes = await squeeze(fromBase64Url(code.trim()), false); }
  catch { throw new Error('That map link is damaged or incomplete'); }
  return unpack(JSON.parse(new TextDecoder().decode(bytes)));
}

// ---- The original game's .ssm map files (see docs/ss2-file-formats.md) -----------

const SSM_ITEM = { 1: 'health', 2: 'armour', 3: 'weapon', 4: 'jetpack' };
const SSM_ITEM_ID = { health: 1, armour: 2, weapon: 3, jetpack: 4 };

/** Read an original Stick Soldiers II .ssm file (ArrayBuffer or Uint8Array). */
export function decodeSSM(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const need = n => { if (o + n > bytes.length) throw new Error("That .ssm file is cut short or isn't a map"); };
  const u32 = () => { need(4); const v = view.getUint32(o, true); o += 4; return v; };
  const f32 = () => { need(4); const v = view.getFloat32(o, true); o += 4; return v; };
  const str = () => {
    const n = u32();
    if (n > 4096) throw new Error("That file isn't a Stick Soldiers II map");
    need(n);
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[o + i]);
    o += n;
    return s;
  };
  const name = str();
  f32(); f32(); f32(); f32(); // bounds (recomputed)
  const count = (what, max) => { const n = u32(); if (n > max) throw new Error(`That map has too many ${what}`); return n; };
  const platforms = [];
  for (let i = count('platforms', 10000); i > 0; i--) {
    const left = f32(), top = f32(), right = f32(), bottom = f32();
    f32(); // unused field
    const bounce = f32();
    platforms.push({ left, top, right, bottom, bounce });
  }
  const spawns = [];
  for (let i = count('spawn points', 10000); i > 0; i--) spawns.push({ x: f32(), y: f32(), team: u32() });
  const items = [];
  for (let i = count('items', 10000); i > 0; i--) {
    const type = SSM_ITEM[u32()] || 'unknown';
    const x = f32(), y = f32();
    const weapon = str();
    items.push({ type, x, y, weapon: weapon === 'None' ? undefined : weapon });
  }
  return normalizeMap({ name, platforms, spawns, items });
}

/** Write a map as an original-format .ssm file (playable in the 2003 game, weapons permitting). */
export function encodeSSM(map) {
  const m = normalizeMap(map);
  const parts = [];
  const u32 = v => { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, v, true); parts.push(new Uint8Array(b.buffer)); };
  const f32 = v => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, v, true); parts.push(new Uint8Array(b.buffer)); };
  const str = s => { const bytes = Uint8Array.from(s, c => c.charCodeAt(0) & 0xff); u32(bytes.length); parts.push(bytes); };
  str(m.name);
  [m.bounds.left, m.bounds.top, m.bounds.right, m.bounds.bottom].forEach(f32);
  u32(m.platforms.length);
  for (const p of m.platforms) { f32(p.left); f32(p.top); f32(p.right); f32(p.bottom); f32(0); f32(p.bounce || 0); }
  u32(m.spawns.length);
  for (const s of m.spawns) { f32(s.x); f32(s.y); u32(s.team); }
  u32(m.items.length);
  for (const it of m.items) { u32(SSM_ITEM_ID[it.type]); f32(it.x); f32(it.y); str(it.weapon || 'None'); }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---- Checking a map ---------------------------------------------------------------

/** Where a soldier dropped at (x, y) ends up standing, or null if they fall off the map. */
function settle(map, x, y) {
  const body = makeBody(x, y);
  for (let i = 0; i < 600; i++) {
    stepBody(body, { move: 0 }, map);
    if (body.onGround) return body;
    if (body.y > map.bounds.bottom + RULES.fallDeathMargin) return null;
  }
  return null;
}

/**
 * Look for problems players would hit. Returns
 * { problems: [{ level: 'error'|'warning'|'ok', text, x?, y? }], spots: [{ x, y, kind }] }
 * where spots are places a soldier can stand: kind 'ok', 'trap' (can't get back out) or 'cutoff' (can't get to).
 */
export function checkMap(raw) {
  const data = normalizeMap(raw);
  const problems = [];
  const add = (level, text, at) => problems.push({ level, text, ...(at || {}) });
  if (!data.platforms.length) add('error', 'Add some platforms to stand on.');
  if (!data.spawns.length) add('error', 'Add at least one spawn point.');
  else if (data.spawns.length < 4) add('warning', `Only ${data.spawns.length} spawn point${data.spawns.length === 1 ? '' : 's'}: 4 or more keep fights fair.`);
  const blue = data.spawns.filter(s => s.team === 1).length, red = data.spawns.length - blue;
  if (data.spawns.length && (!blue || !red)) add('warning', `Team games need both blue and red spawn points (this map has ${blue} blue, ${red} red).`);
  if (!data.items.some(i => i.type === 'weapon') && !data.loadout?.weapons.length) add('warning', 'No weapons on the map: everyone starts with just the pistol (supply crates still drop in).');
  if (!data.platforms.length || !data.spawns.length) return { data, problems, spots: [] };

  setGameSpeed(DEFAULT_SPEED);
  const map = new GameMap(data);
  const nav = new NavGraph(map);
  const { comp, sizes } = nav.groups();

  // Where each spawn point puts a soldier.
  const spawnNodes = [];
  for (const s of data.spawns) {
    if (map.overlap(s.x - BODY.halfW, s.y + BODY.top, s.x + BODY.halfW, s.y + BODY.bottom)) {
      add('error', 'A spawn point is inside a wall.', { x: s.x, y: s.y });
      continue;
    }
    const body = settle(map, s.x, s.y);
    if (!body) { add('error', 'A spawn point drops players off the map.', { x: s.x, y: s.y }); continue; }
    const node = nav.nodeAt(body.x, body.y, 12);
    if (node) spawnNodes.push({ node, spawn: s });
  }
  if (!spawnNodes.length) return { data, problems, spots: [] };

  // The main area: the group of mutually reachable spots holding the most spawn points.
  const votes = new Map();
  for (const { node } of spawnNodes) votes.set(comp[node.id], (votes.get(comp[node.id]) || 0) + 1);
  const main = [...votes].sort((a, b) => b[1] - a[1] || sizes.get(b[0]) - sizes.get(a[0]))[0][0];
  const home = nav.nodes.find(n => comp[n.id] === main);
  const fromMain = nav.costsFrom(home).cost;

  const spots = nav.nodes.map(n => ({
    x: n.x, y: n.y,
    kind: comp[n.id] === main ? 'ok' : fromMain[n.id] < Infinity ? 'trap' : 'cutoff',
  }));
  const traps = spots.filter(s => s.kind === 'trap').length;
  if (traps) add('warning', `${traps} spot${traps === 1 ? ' is a trap' : 's are traps'} (red): players can get in but can't climb back out. Add ledges or a jump pad.`);
  for (const { node, spawn } of spawnNodes) {
    if (comp[node.id] !== main) add('warning', 'A spawn point is cut off from the rest of the map.', { x: spawn.x, y: spawn.y });
  }
  for (const it of data.items) {
    const n = nav.nearest(it.x, it.y + 12, 120);
    if (!n || fromMain[n.id] === Infinity) { add('warning', `This ${it.type === 'weapon' ? WEAPONS[it.weapon].name : it.type} can't be reached by walking or jumping.`, { x: it.x, y: it.y }); }
  }
  // Objectives: somewhere players can get to, to stand at each one.
  const NAMES = { hill: 'hill', point: 'capture point', flag: 'flag', mcom: 'M-COM' };
  for (const o of data.objectives || []) {
    const at = o.type === 'hill' || o.type === 'point' ? n => inZone(n, o) : o.type === 'mcom' ? n => inZone(n, mcomZone(o))
      : n => Math.abs(n.x - o.x) <= 14 && Math.abs(n.y - (o.y - STAND)) < 3;
    if (!nav.nodes.some(n => comp[n.id] === main && at(n))) {
      const x = o.x ?? (o.left + o.right) / 2, y = o.y ?? o.bottom;
      add('warning', `Players can't get to this ${NAMES[o.type]}${o.type === 'point' ? ` (${o.label})` : ''}: it needs a floor to stand on that they can reach.`, { x, y: y - 20 });
    }
  }
  const flags = (data.objectives || []).filter(o => o.type === 'flag');
  if (flags.length === 1) add('warning', `Capture the flag needs a flag for each team (this map only has ${flags[0].team === 1 ? 'blue' : 'red'}'s; the game will place the other).`);
  const sectors = new Set((data.objectives || []).filter(o => o.type === 'mcom').map(o => o.sector));
  for (const sec of new Set(data.spawns.filter(s => s.sector).map(s => s.sector))) {
    if (!sectors.has(sec)) add('warning', `Some spawn points are for Rush sector ${sec}, but there are no M-COMs in sector ${sec}.`);
  }
  if (!problems.some(p => p.level !== 'ok')) add('ok', 'Looks good: every spot can be reached and left again.');
  return { data, problems, spots };
}
