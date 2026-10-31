// The game's defaults for what players choose (Settings, and the game setup on the main menu),
// for the developer menu (devmenu.js): each shown with whether it's been changed, copied out
// with the numbers (tuning.js) to be made the game's own, and pasted back in.

import { ACTIONS, keysFor } from './keys.js';

/**
 * What's copied out, by group, as the settings save them (main.js: DEFAULTS): [key, label, the
 * Settings page it's on]. (Not your name or your online game's, the game you played last, nor
 * the game speed: fixed at 75%. Classes are switched off.)
 */
export const DEFAULT_GROUPS = [
  {
    id: 'settings', name: 'Settings', fields: [
      ['graphics', 'Graphics', 'Video'], ['quality', 'Quality (Remastered)', 'Video'], ['fpsCap', 'Frame rate', 'Video'],
      ['showFps', 'Frames per second shown', 'Video'], ['fullscreen', 'Full screen while playing', 'Video'],
      ['volume', 'Volume', 'Audio'], ['muted', 'Sound muted', 'Audio'],
      ['sprint', 'Sprint', 'Controls'], ['aimZoom', 'Aiming down the sights', 'Controls'], ['keys', 'Keys', 'Controls'],
      ['pointer', 'Mouse pointer', 'Mouse & crosshair'], ['crosshair', 'Crosshair', 'Mouse & crosshair'],
      ['camera', 'Camera', 'Camera'], ['skin', 'Skin', 'Character'], ['showPing', 'Ping shown', 'Gameplay'],
    ],
  },
  {
    id: 'setup', name: 'Game setup', fields: [
      ['mode', 'Mode'], ['map', 'Map'], ['bots', 'Bots'], ['difficulty', 'Bot difficulty'], ['fragLimit', 'Frag limit'],
      ['goals', 'Objective modes\' goals'], ['side', 'Your team'], ['lives', 'Lives (one in the chamber)'], ['gunKills', 'Kills per gun (gun game)'],
      ['crates', 'Supply crates'], ['destruction', 'Destruction'], ['streaks', 'Kill streaks'],
      ['botVision', 'Bot vision'], ['fog', 'Fog of war'], ['maxPlayers', 'Most players (hosting)'], ['visibility', 'Who can join (hosting)'],
    ],
  },
];
const FIELDS = new Map(DEFAULT_GROUPS.flatMap(g => g.fields.map(([key, label, page]) => [key, { group: g.id, label, page }])));

/** Whether two saved values are the same (objects key by key, in any order). */
export function equal(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
}

/** A value in full: the keys are saved as just those changed, so in full, every action's. */
const full = (key, v) => (key === 'keys' ? Object.fromEntries(ACTIONS.map(a => [a.id, keysFor(a.id)])) : v);

/**
 * What's chosen, from the saved settings (`saved`) against the game's own (`base`): those that
 * differ, or (all) everything. { settings: {...}, setup: {...} }.
 */
export function gameDefaults(saved, base, { all = false } = {}) {
  const out = {};
  for (const g of DEFAULT_GROUPS) {
    const part = out[g.id] = {};
    for (const [key] of g.fields) {
      const v = saved[key];
      if (v === undefined) continue;
      if (all) part[key] = full(key, v);
      else if (!equal(v, base[key])) part[key] = v;
    }
  }
  return out;
}

/** How many differ from the game's own. */
export const changedDefaults = (saved, base) => Object.values(gameDefaults(saved, base)).reduce((n, part) => n + Object.keys(part).length, 0);

/** A value as words, for the developer menu. */
export function describe(key, v) {
  if (v === true) return 'On';
  if (v === false) return 'Off';
  if (key === 'keys') {
    const n = Object.keys(v || {}).length;
    return n ? `${n} action${n === 1 ? '' : 's'} changed: ${Object.entries(v).map(([id, ks]) => `${id} ${ks.join('/') || '(none)'}`).join(', ')}` : 'As they come';
  }
  if (v && typeof v === 'object') {
    const parts = Object.entries(v).map(([k, x]) => `${k} ${typeof x === 'boolean' ? (x ? 'on' : 'off') : x}`);
    return parts.length ? parts.join(', ') : 'As they come';
  }
  return String(v);
}

/** Rows for the developer menu: each group's choices, as chosen and as the game has them. */
export function defaultRows(saved, base) {
  return DEFAULT_GROUPS.map(g => ({
    id: g.id, name: g.name,
    rows: g.fields.map(([key, label, page]) => ({
      key, label, page: page || 'Game setup',
      value: describe(key, saved[key]), def: describe(key, base[key]), changed: !equal(saved[key], base[key]),
    })),
  }));
}

const kind = v => (Array.isArray(v) ? 'list' : v === null ? 'null' : typeof v);

/**
 * Choices pasted in (what Copy changes gave: its `settings` and `setup`), each checked against
 * the game's own (`base`: the same kind of value) and by `check(key, v)` (one of the choices
 * there are). Returns { values: { key: value }, skipped: [names] }.
 */
export function readDefaults(obj, base, check = () => true) {
  const values = {}, skipped = [];
  for (const g of DEFAULT_GROUPS) {
    const part = obj?.[g.id];
    if (!part || typeof part !== 'object' || Array.isArray(part)) continue;
    for (const [key, v] of Object.entries(part)) {
      const f = FIELDS.get(key);
      if (!f || f.group !== g.id || kind(v) !== kind(base[key]) || !check(key, v)) skipped.push(`${g.id}.${key}`);
      else values[key] = v;
    }
  }
  return { values, skipped };
}
