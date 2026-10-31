// The game's defaults for what players choose (Settings, and the game setup on the main menu),
// for the developer menu (devmenu.js): kept there apart from the player's own choices, changed
// there or pulled from the current game, copied out with the numbers (tuning.js) to be made the
// game's own, and pasted back in.

import { ACTIONS, canBind, MAX_KEYS } from './keys.js';

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
/** Every choice's key, in order. */
export const CHOICE_KEYS = [...FIELDS.keys()];

/** Whether two saved values are the same (objects key by key, in any order). */
export function equal(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
}

const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

/*
 * How each choice is picked in the developer menu, and checked (its editor; main.js has them):
 *   { type: 'select', options: [{ value, label }] }  one of a list
 *   { type: 'bool' }                                 on or off
 *   { type: 'number', min, max, step }               a number, kept in range (and to the step)
 *   { type: 'color' }                                a colour, '#rrggbb'
 *   { type: 'fields', fields: [{ key, label, spec, def }], sparse }
 *                                                    an object of choices (sparse: just those not at their def)
 *   { type: 'keys' }                                 the keys: the actions changed from their own (keys.js)
 */

/** The parts of an object choice's editor (fields, or each action's keys): [{ key, label, spec, def }], or null. */
export function parts(spec) {
  if (spec?.type === 'keys') return ACTIONS.map(a => ({ key: a.id, label: a.name, spec: { type: 'keyList' }, def: a.keys }));
  return spec?.type === 'fields' ? spec.fields : null;
}

const onStep = (n, { min, max, step }) => (step ? Math.min(max, Math.max(min, +(min + Math.round((n - min) / step) * step).toFixed(6))) : n);

/** A value checked against its editor: tidied up, or undefined if it isn't one. (No editor: as it is.) */
export function tidy(spec, v) {
  switch (spec?.type) {
    case 'select': return spec.options.find(o => o.value === v)?.value;
    case 'bool': return typeof v === 'boolean' ? v : undefined;
    case 'number': return typeof v === 'number' && Number.isFinite(v) ? onStep(Math.min(spec.max, Math.max(spec.min, v)), spec) : undefined;
    case 'color': return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined;
    case 'keyList': return Array.isArray(v) ? [...new Set(v.filter(canBind))].slice(0, MAX_KEYS) : undefined;
    case 'fields': case 'keys': {
      if (!isObject(v)) return undefined;
      const out = {}, sparse = spec.type === 'keys' || spec.sparse;
      for (const p of parts(spec)) {
        const x = Object.hasOwn(v, p.key) ? tidy(p.spec, v[p.key]) : undefined;
        if (!sparse) out[p.key] = x === undefined ? p.def : x;
        else if (x !== undefined && !equal(x, p.def)) out[p.key] = x;
      }
      return out;
    }
    default: return v;
  }
}

/** The keys in full: every action's (`keys` has those changed). */
const allKeys = keys => Object.fromEntries(ACTIONS.map(a => [a.id, [...(keys?.[a.id] ?? a.keys)]]));

/**
 * The defaults (`values`: every choice) against the game's own (`base`): those that differ, or
 * (all) everything. { settings: {...}, setup: {...} }.
 */
export function gameDefaults(values, base, { all = false } = {}) {
  const out = {};
  for (const g of DEFAULT_GROUPS) {
    const part = out[g.id] = {};
    for (const [key] of g.fields) {
      const v = values[key];
      if (v === undefined) continue;
      if (all) part[key] = key === 'keys' ? allKeys(v) : v;
      else if (!equal(v, base[key])) part[key] = v;
    }
  }
  return out;
}

/** How many differ from the game's own. */
export const changedDefaults = (values, base) => Object.values(gameDefaults(values, base)).reduce((n, part) => n + Object.keys(part).length, 0);

/** A value as words, for the developer menu (spec: its editor, for the names of those picked from a list). */
export function describe(key, v, spec = null) {
  if (spec?.type === 'select') {
    const o = spec.options.find(x => equal(x.value, v));
    if (o) return o.label;
  }
  if (v === true) return 'On';
  if (v === false) return 'Off';
  if (Array.isArray(v)) return v.join('/') || '(none)';
  if (key === 'keys') {
    const n = Object.keys(v || {}).length;
    return n ? `${n} action${n === 1 ? '' : 's'} changed: ${Object.entries(v).map(([id, ks]) => `${id} ${ks.join('/') || '(none)'}`).join(', ')}` : 'As they come';
  }
  if (v && typeof v === 'object') {
    const ps = parts(spec);
    const words = ps ? ps.filter(p => Object.hasOwn(v, p.key)).map(p => `${p.label.toLowerCase()} ${describe(p.key, v[p.key], p.spec)}`)
      : Object.entries(v).map(([k, x]) => `${k} ${typeof x === 'boolean' ? (x ? 'on' : 'off') : x}`);
    return words.length ? words.join(', ') : 'As they come';
  }
  return String(v);
}

/** Where an object choice's `b` isn't its `a`, part by part: [{ key, label, spec, value: b's }]. */
export function differences(spec, a, b) {
  return (parts(spec) || []).filter(p => !equal(a?.[p.key] ?? p.def, b?.[p.key] ?? p.def)).map(p => ({ ...p, value: b?.[p.key] ?? p.def }));
}

/**
 * Rows for the developer menu: each group's choices, with the default being made (`values`), the
 * game's own (`base`), the player's own as they are now (`mine`), and each one's editor (`specs`).
 */
export function defaultRows(values, base, mine = {}, specs = {}) {
  return DEFAULT_GROUPS.map(g => ({
    id: g.id, name: g.name,
    rows: g.fields.map(([key, label, page]) => ({
      key, label, page: page || 'Game setup', spec: specs[key] || null,
      value: values[key], def: base[key], mine: mine[key],
      changed: !equal(values[key], base[key]), same: equal(values[key], mine[key]),
    })),
  }));
}

const kind = v => (Array.isArray(v) ? 'list' : v === null ? 'null' : typeof v);

/**
 * Choices pasted in (what Copy changes gave: its `settings` and `setup`), each checked by its
 * editor (`specs`; one without: the same kind of value as the game's own, `base`). Returns
 * { values: { key: value }, skipped: [names] }.
 */
export function readDefaults(obj, base, specs = {}) {
  const values = {}, skipped = [];
  for (const g of DEFAULT_GROUPS) {
    const part = obj?.[g.id];
    if (!isObject(part)) continue;
    for (const [key, v] of Object.entries(part)) {
      const f = FIELDS.get(key);
      const x = !f || f.group !== g.id ? undefined : specs[key] ? tidy(specs[key], v) : kind(v) === kind(base[key]) ? v : undefined;
      if (x === undefined) skipped.push(`${g.id}.${key}`);
      else values[key] = x;
    }
  }
  return { values, skipped };
}
