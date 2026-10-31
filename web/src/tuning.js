// The developer menu's numbers: the game's tuning (movement, health and rules, every weapon,
// bots, pickups, kill streaks) as changed from its defaults.
//
// Changes apply at once: most straight away, a few from the next spawn or match (health is
// given out at spawn; bots' reaction times and route maps are worked out at the start of a
// match). They're kept in this browser, and can be copied out as JSON (to be made the game's
// defaults) or pasted back in. Online, everyone in a game uses its host's numbers, sent with
// each match: a player's own come back when they play their own games again.
//
// Movement, rules and weapons are kept at full speed: speed.js scales them for the game's
// speed (75%: speeds x0.75, accelerations x0.5625, times /0.75) into the numbers the game reads.

import { BASE_VALUES, rescale } from './speed.js';
import { ITEM_RESPAWN, CRATES } from './config.js';
import { DIFFICULTY, BOT_PROFILES, BOT_VIEW } from './bot.js';
import { REWARDS } from './streaks.js';

const PROFILES = Object.fromEntries(BOT_PROFILES.map(p => [p.name, p]));
// Where each part's numbers live (the ones speed.js scales: its full-speed copies).
const ROOTS = {
  PHYS: () => BASE_VALUES.PHYS,
  MOTION: () => BASE_VALUES.MOTION,
  RULES: () => BASE_VALUES.RULES,
  WEAPONS: () => BASE_VALUES.WEAPONS,
  ITEM_RESPAWN: () => ITEM_RESPAWN,
  CRATES: () => CRATES,
  REWARDS: () => REWARDS,
  BOTS: () => DIFFICULTY,
  BOT_VIEW: () => BOT_VIEW,
  BOT_PROFILES: () => PROFILES,
};
// Numbers that aren't tuning: how things are drawn, the weapon bar's slot, the engine's collision step.
const SKIP = { PHYS: new Set(['maxStep']), MOTION: new Set(['timeScale']), WEAPONS: new Set(['slot', 'look']) };
const KEEP = { REWARDS: new Set(['kills']), BOT_PROFILES: new Set(['acc', 'camp', 'skill']) };

const clone = v => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
// The game's own numbers, as they were before anything changed them.
const PRISTINE = Object.fromEntries(Object.keys(ROOTS).map(k => [k, clone(ROOTS[k]())]));

const STORE = 'stick-soldiers-dev';
let own = new Map();      // this browser's changes: 'PHYS.runSpeed' -> 3.8
let host = null;          // in someone else's online game: theirs (a Map), in use instead
let version = 0;          // goes up with every change (route maps are made again for new numbers)

/** Goes up with every change to the numbers in use. */
export const tuningVersion = () => version;
/** Whether another player's (the host's) numbers are in use. */
export const usingHostTuning = () => !!host;

const get = (obj, path) => path.reduce((o, k) => (o != null && Object.hasOwn(o, k) ? o[k] : undefined), obj);
function put(obj, path, v) {
  const last = path.length - 1;
  let o = obj;
  for (let i = 0; i < last; i++) { if (o == null || !Object.hasOwn(o, path[i])) return false; o = o[path[i]]; }
  if (o == null || !Object.hasOwn(o, path[last]) || typeof o[path[last]] !== 'number') return false;
  o[path[last]] = v;
  return true;
}

/** Whether a path (['WEAPONS', 'M4', 'damage']) is one of the numbers that can be tuned. */
function tunable(path) {
  const [root, ...rest] = path;
  // (Only the parts' own names: nothing pasted in reaches the objects' insides, like 'constructor'.)
  if (!Object.hasOwn(ROOTS, root) || !rest.length) return false;
  const skip = Object.hasOwn(SKIP, root) ? SKIP[root] : null, keep = Object.hasOwn(KEEP, root) ? KEEP[root] : null;
  if (root === 'WEAPONS') { if (rest.length < 2 || skip.has(rest[1])) return false; }
  else if (skip?.has(rest[0])) return false;
  if (keep && !keep.has(rest[rest.length - 1])) return false;
  const v = get(PRISTINE[root], rest);
  return typeof v === 'number' && Number.isFinite(v);
}

// ---- What each number is ----------------------------------------------------------------

const TICKS = 'ticks (60 a second)';
const LABELS = {
  PHYS: {
    runSpeed: ['Run speed', 'px per update'], crouchSpeed: ['Crouch-walk speed', 'px per update'],
    groundAccel: ['Grip: speeding up and stopping on the ground'], airAccel: ['Air control'],
    gravity: ['Gravity'], maxFall: ['Fastest fall'], jumpSpeed: ['Jump strength', 'take-off speed: 9.53 jumps about 97 px'],
    jumpCut: ['Short hop: letting go of jump caps the climb at', 'smaller: shorter hops'], bounceScale: ['Jump pad launch'],
    stepUp: ['Walks up steps this high', 'px'], jetAccel: ['Jetpack thrust'], jetMaxUp: ['Jetpack: fastest climb'],
    jetDrain: ['Jetpack: fuel used each update', 'fuel is 0-100'], jetRegen: ['Jetpack: fuel back each update on the ground'],
    ropeClimb: ['Ninja rope: climbing speed'], sprintSpeed: ['Sprint: times faster'], sprintDrain: ['Sprint: stamina used each update', 'stamina is 0-100'],
    sprintRegen: ['Sprint: stamina back each update'], sprintRecover: ['Sprint: winded until stamina is back to'],
  },
  MOTION: {
    grenadeGravity: ['Grenades: gravity (thrown weapons without their own)'], flameDrag: ['Flames: speed kept each update'],
    flameLift: ['Flames: rising'], flameGrow: ['Flames: growing'], itemGravity: ['Dropped weapons: gravity'],
    itemMaxFall: ['Dropped weapons: fastest fall'], itemToss: ['Dropped weapons: tossed this fast'],
    flipRate: ['Jump pad somersault speed'], landAnim: ['Landing this fast: the landing squash'], landSound: ['Landing this fast: the landing thud'],
    crateFall: ['Supply crates: parachute speed'],
  },
  RULES: {
    maxHealth: ['Health', 'Defuse keeps 100; at most 255'], maxArmour: ['Most armour', 'at most 255'], armourAbsorb: ['Share of damage armour takes', '0-1'],
    respawnTicks: ['Respawn wait', TICKS], spawnProtectTicks: ['Spawn protection', TICKS], fallDeathMargin: ['Falls die this far below the map', 'px'],
    ceilingMargin: ['Jetpacks stop this far above the map', 'px'], creditFallTicks: ['A fall this soon after being hurt is a kill', TICKS],
    droppedWeaponTicks: ['Dropped weapons last', TICKS], burnTicks: ['Burning lasts', TICKS], burnDamage: ['Burning: damage each update'],
    juggerDamage: ['Juggernaut: share of damage taken', '0-1'], headshotMultiplier: ['Headshots: times the damage (bullets)', 'the sniper rifle and longbow have their own'],
  },
  ITEM_RESPAWN: { weapon: ['Weapons come back after', TICKS], health: ['Health comes back after', TICKS], armour: ['Armour comes back after', TICKS], jetpack: ['Jetpacks come back after', TICKS] },
  BOT_VIEW: { sight: ['How far bots look for enemies', 'px'] },
};
const BOT_FIELDS = {
  reaction: ['Reaction time', `${TICKS}, before a bot fires at someone new`], delay: ['Aim delay: aims where the target was this long ago', TICKS],
  extrap: ['Leading moving targets', '0-1'], flick: ['Aim off by this much on someone new', 'radians'],
  flickPct: ['…plus this share of how far it turned'], settle: ['Aim settling: share of the way each update'],
  tremor: ['Aim wobble', 'radians'], turn: ['Fastest aim turn', 'radians per update'], fireCone: ['Fires when its aim is this close', 'radians'],
  trigger: ['Chance it fires when it can', '0-1'],
  acc: ['Aim error', 'the original game\'s numbers: higher misses more'], camp: ['Camping', 'higher waits about more'], skill: ['Skill', '0-3: leading shots, aiming at heads'],
  hw: ['Half width', 'px'], hh: ['Half height', 'px'],
};
const WEAPON_FIELDS = {
  damage: ['Damage'], rof: ['Time between shots', TICKS], speed: ['Speed', 'px per update'], spread: ['Spread', 'degrees'],
  range: ['Range', 'px'], ammo: ['Ammo when picked up'], maxAmmo: ['Most ammo'], mag: ['Magazine'], reload: ['Reload time', TICKS],
  knock: ['Knockback'], pellets: ['Pellets'], headMultiplier: ['Headshots: times the damage'], reach: ['Reach', 'px'],
  arc: ['Swing arc', 'radians'], chip: ['Breaks blocks this much a swing'], gravity: ['Gravity'], bounce: ['Bounciness', '0-1'],
  friction: ['Friction', '0-1'], roll: ['Rolling', '0-1'], fuse: ['Fuse', TICKS], life: ['Lasts', TICKS], spinup: ['Spin-up', TICKS],
  heavy: ['Walking speed while held', 'share'], turn: ['Turning'], throwSpeed: ['Throw speed'], walkSpeed: ['Walking speed'],
  hop: ['Hop'], count: ['How many'], interval: ['Between each', TICKS], radius: ['Radius', 'px'], duration: ['Lasts', TICKS],
  delay: ['Delay', TICKS], arm: ['Arms after', TICKS], trigger: ['Triggers within', 'px'], hp: ['Health'], price: ['Defuse: price', '$'],
  reward: ['Defuse: kill reward', '$'], reserve: ['Defuse: spare ammo'], dmg: ['Defuse: times the damage'], max: ['Defuse: most you can carry'],
  near: ['Bots: use it from', 'px'], far: ['Bots: use it up to', 'px'], score: ['Bots: how much they want it'], value: ['Bots: how much they keep it'],
  lift: ['Lift'], uppercut: ['Uppercut'], selfHop: ['Hop for the swinger'], kick: ['Kick'], hopChance: ['Hop chance'], scatter: ['Scatter'],
  dpt: ['Damage each update'], holy: ['Hallelujah wait', TICKS], bombs: ['Bombs'], spacing: ['Spacing', 'px'], smashes: ['Smashes'],
};
const PARTS = { blast: 'Blast', cluster: 'Cluster bomblets', fire: 'Fire', gas: 'Gas', flash: 'Flash', smoke: 'Smoke', mine: 'Mine', homing: 'Homing', cs: 'Defuse', bot: 'Bots' };
const DEG = 180 / Math.PI;
// Shown in degrees, kept in radians.
const inDegrees = path => path[0] === 'WEAPONS' && path[path.length - 1] === 'spread';
const INTS = new Set(['ammo', 'maxAmmo', 'mag', 'pellets', 'count', 'reserve', 'price', 'reward', 'max', 'kills', 'every', 'bombs', 'smashes', 'hp', 'maxHealth', 'maxArmour', 'skill']);
const MAXES = { maxHealth: 255, maxArmour: 255, mag: 254, ammo: 65534, maxAmmo: 65534, reserve: 65534, armourAbsorb: 1, juggerDamage: 1, trigger: 1 };

/** What a number is: { label, help, unit, int, min, max, step, scale } for the menu. */
function about(path) {
  const [root, ...rest] = path, field = rest[rest.length - 1];
  let label, help = '';
  if (root === 'WEAPONS') {
    const part = rest.length > 2 ? PARTS[rest[1]] || rest[1] : '';
    [label, help = ''] = WEAPON_FIELDS[field] || [field];
    if (part) label = `${part}: ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
    if (rest[1] === 'bot' && WEAPON_FIELDS[field]) label = WEAPON_FIELDS[field][0];
  } else if (root === 'BOTS' || root === 'BOT_PROFILES') [label, help = ''] = BOT_FIELDS[field] || [field];
  else if (root === 'BOT_VIEW') {
    [label, help = ''] = rest.length > 1 ? [`${rest[0] === 'fire' ? 'Shoot at people this close' : 'With a scope: this close'}: ${BOT_FIELDS[field]?.[0].toLowerCase() || field}`, 'px'] : LABELS.BOT_VIEW[field] || [field];
  } else if (root === 'CRATES') [label, help = ''] = [`${rest[0] === 'lots' ? 'Lots of crates' : 'Crates'}: ${field === 'every' ? 'one every' : 'at most'}`, field === 'every' ? TICKS : 'at once'];
  else if (root === 'REWARDS') [label, help = ''] = [`${REWARDS[rest[0]]?.name || rest[0]}: kills in a row`];
  else [label, help = ''] = LABELS[root]?.[field] || [field];
  const def = get(PRISTINE[root], rest);
  const int = INTS.has(field) || (root === 'ITEM_RESPAWN') || /Ticks$/.test(field);
  const scale = inDegrees(path) ? DEG : 1;
  const max = MAXES[field] ?? 1e6;
  const step = int ? 1 : Math.abs(def) >= 50 ? 1 : Math.abs(def) >= 5 ? 0.1 : Math.abs(def) >= 0.5 ? 0.01 : 0.001;
  return { label, help, int, min: def < 0 ? -1e6 : 0, max, step, scale };
}

/** A number for a path, as allowed (in range, whole where it should be), or null if it isn't one. */
function fit(path, v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const a = about(path);
  v = Math.min(a.max, Math.max(a.min, v));
  return a.int ? Math.round(v) : v;
}

// ---- The parts of the menu --------------------------------------------------------------

/** Every tunable path under an object (as found in the game's own numbers). */
function pathsUnder(root, prefix = []) {
  const out = [];
  const walk = (o, p) => {
    for (const k of Object.keys(o)) {
      const v = o[k], q = [...p, k];
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, q);
      else if (tunable([root, ...q])) out.push([root, ...q]);
    }
  };
  const start = get(PRISTINE[root], prefix);
  if (start && typeof start === 'object') walk(start, prefix);
  return out;
}

/**
 * The menu's sections, each a list of groups of numbers: { id, name, groups: [{ name, paths }] }.
 * Weapons: one group per weapon.
 */
export function tuningSections() {
  const bots = Object.keys(PRISTINE.BOTS).map(d => ({ name: `Bots, ${d}`, paths: pathsUnder('BOTS', [d]) }));
  return [
    { id: 'movement', name: 'Movement', groups: [{ name: 'Moving', paths: pathsUnder('PHYS') }, { name: 'Other motion', paths: pathsUnder('MOTION') }] },
    { id: 'rules', name: 'Health & rules', groups: [{ name: 'Rules', paths: pathsUnder('RULES') }] },
    { id: 'weapons', name: 'Weapons', groups: Object.keys(PRISTINE.WEAPONS).map(id => ({ id, name: BASE_VALUES.WEAPONS[id]?.name || id, paths: pathsUnder('WEAPONS', [id]) })) },
    { id: 'bots', name: 'Bots', groups: [...bots, { name: 'What bots see', paths: pathsUnder('BOT_VIEW') }, ...Object.keys(PRISTINE.BOT_PROFILES).map(n => ({ name: `Bot: ${n}`, paths: pathsUnder('BOT_PROFILES', [n]) }))] },
    { id: 'pickups', name: 'Pickups & streaks', groups: [{ name: 'Pickups', paths: pathsUnder('ITEM_RESPAWN') }, { name: 'Supply crates', paths: pathsUnder('CRATES') }, { name: 'Kill streak rewards', paths: pathsUnder('REWARDS') }] },
  ];
}

const keyOf = path => path.join('.');
const pathOf = key => key.split('.');

/** One number, for the menu: its value now (as shown), default, and what it is. */
export function tuningField(path) {
  const a = about(path), key = keyOf(path);
  const def = get(PRISTINE[path[0]], path.slice(1));
  const value = own.has(key) ? own.get(key) : def;
  return { key, path, ...a, value: value * a.scale, def: def * a.scale, changed: own.has(key) };
}

// ---- Changing them ---------------------------------------------------------------------------

/** Put every number back as the game has it, then these changes, and rescale for the game's speed. */
function apply(changes) {
  for (const root of Object.keys(ROOTS)) restore(ROOTS[root](), PRISTINE[root]);
  for (const [key, v] of changes) put(ROOTS[pathOf(key)[0]](), pathOf(key).slice(1), v);
  rescale();
  version++;
}
// (In place: the game keeps references to these objects.)
function restore(live, base) {
  for (const k of Object.keys(base)) {
    const b = base[k];
    if (b && typeof b === 'object' && !Array.isArray(b)) { if (live[k] && typeof live[k] === 'object') restore(live[k], b); }
    else if (typeof b === 'number' && Object.hasOwn(live, k)) live[k] = b;
  }
}

/**
 * Set a number (as the menu shows it: spread in degrees). Returns the value as kept (in range),
 * or null if it isn't a number that can be tuned.
 */
export function setTuning(path, shown) {
  if (!tunable(path)) return null;
  const a = about(path);
  const v = fit(path, shown / a.scale);
  if (v == null) return null;
  const def = get(PRISTINE[path[0]], path.slice(1));
  if (Math.abs(v - def) < 1e-12) own.delete(keyOf(path)); else own.set(keyOf(path), v);
  save();
  if (!host) apply(own);
  return v * a.scale;
}

/** Back to the game's own number. */
export function resetTuning(path) {
  own.delete(keyOf(path));
  save();
  if (!host) apply(own);
}

/** Every number back to the game's own. */
export function resetAllTuning() {
  own = new Map();
  save();
  if (!host) apply(own);
}

/** How many numbers are changed (all of them, or under a path: ['WEAPONS', 'M4']). */
export function changedCount(prefix = []) {
  const p = prefix.length ? `${keyOf(prefix)}.` : '';
  let n = 0;
  for (const k of own.keys()) if (!p || k.startsWith(p)) n++;
  return n;
}

// ---- Copying out and pasting in ---------------------------------------------------------------

/** Changes as nested objects ({ PHYS: { runSpeed: 3.8 }, WEAPONS: { M4: { damage: 14 } } }). */
function nest(entries) {
  const out = {};
  for (const [key, v] of entries) {
    const p = pathOf(key);
    let o = out;
    for (let i = 0; i < p.length - 1; i++) o = o[p[i]] ??= {};
    o[p[p.length - 1]] = Math.round(v * 1e6) / 1e6;
  }
  return out;
}

/** This browser's changes, as JSON to copy (and paste back in, or make the game's defaults). */
export function exportTuning({ all = false } = {}) {
  let entries;
  if (all) {
    entries = [];
    for (const s of tuningSections()) for (const g of s.groups) for (const p of g.paths) entries.push([keyOf(p), own.get(keyOf(p)) ?? get(PRISTINE[p[0]], p.slice(1))]);
  } else entries = [...own].sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({ stickSoldiersTuning: 1, note: all ? 'every number (at full speed)' : 'changed from the defaults (at full speed)', ...nest(entries) }, null, 2);
}

/** Flatten pasted changes into [key, value] pairs (only the numbers that can be tuned; the rest are counted). */
function flatten(obj) {
  const ok = [], skipped = [];
  const walk = (o, p) => {
    for (const k of Object.keys(o)) {
      // (Not numbers: the header, and players' choices, pasted in apart: gamedefaults.js.)
      if (!p.length && (k === 'stickSoldiersTuning' || k === 'note' || k === 'settings' || k === 'setup')) continue;
      const v = o[k], q = [...p, k];
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, q);
      else if (tunable(q) && fit(q, v) != null) ok.push([keyOf(q), fit(q, v)]);
      else skipped.push(keyOf(q));
    }
  };
  if (obj && typeof obj === 'object') walk(obj, []);
  return { ok, skipped };
}

/**
 * Paste in numbers (JSON text or an object, as exportTuning gives): they're added to this
 * browser's changes (replace: in place of them). Returns { applied, skipped: [paths] }, or
 * { error } for text that isn't JSON.
 */
export function importTuning(input, { replace = false } = {}) {
  let obj = input;
  if (typeof input === 'string') {
    try { obj = JSON.parse(input); } catch { return { error: 'That isn\'t JSON: paste what Copy changes gives.' }; }
  }
  const { ok, skipped } = flatten(obj);
  if (replace) own = new Map();
  for (const [key, v] of ok) {
    const def = get(PRISTINE[pathOf(key)[0]], pathOf(key).slice(1));
    if (Math.abs(v - def) < 1e-12) own.delete(key); else own.set(key, v);
  }
  save();
  if (!host) apply(own);
  return { applied: ok.length, skipped };
}

// ---- Online: the host's numbers ---------------------------------------------------------------

/** The changes to send to players joining a game we host (nested, as exportTuning has them). */
export function tuningToShare() { return own.size ? nest(own) : null; }

/** In someone else's game: use their numbers (null: the game's own), not this browser's. */
export function useHostTuning(changes) {
  const { ok } = flatten(changes || {});
  host = new Map(ok);
  apply(host);
}

/** Back to this browser's own numbers (our own games). */
export function useOwnTuning() {
  if (!host) return;
  host = null;
  apply(own);
}

// ---- Kept in this browser --------------------------------------------------------------------

function save() {
  try {
    if (own.size) localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(own)));
    else localStorage.removeItem(STORE);
  } catch { /* private mode, or no page (tests) */ }
}

/** Load this browser's changes (at start-up) and use them. */
export function loadTuning() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { saved = {}; }
  own = new Map();
  for (const [key, v] of Object.entries(saved)) {
    const p = pathOf(key), f = tunable(p) ? fit(p, v) : null;
    if (f != null) own.set(key, f);
  }
  host = null;
  apply(own);
}
