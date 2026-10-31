// The developer menu's Settings & setup (gamedefaults.js): the defaults for the choices players
// make, each picked and checked by its editor, compared with the game's own and the player's,
// copied out (changed, or everything) and pasted back in. (tests/browser/settings.mjs uses it
// in the page.) Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_GROUPS, CHOICE_KEYS, gameDefaults, changedDefaults, readDefaults, defaultRows, describe, equal, tidy, parts, differences,
} from '../web/src/gamedefaults.js';
import { ACTIONS, keysFor, keyFromText, sharedKeys, MAX_KEYS } from '../web/src/keys.js';

// The game's own, as main.js has them (a few).
const BASE = {
  volume: 60, muted: false, sprint: 'hold', graphics: 'canvas', camera: { follow: 330, look: 100, glide: 0 }, keys: {}, skin: 'auto',
  mode: 'ffa', map: 'ssdm1.json', bots: 5, goals: {}, destruction: 'on', side: 1,
};
// Their editors, as main.js makes them (a few).
const list = (...values) => ({ type: 'select', options: values.map(v => ({ value: v, label: String(v).toUpperCase() })) });
const SPECS = {
  volume: { type: 'number', min: 0, max: 100, step: 1 }, muted: { type: 'bool' }, sprint: list('hold', 'toggle'), destruction: list('on', 'off'),
  side: list(1, 2), keys: { type: 'keys' },
  camera: {
    type: 'fields', fields: [
      { key: 'look', label: 'Look', def: 100, spec: { type: 'number', min: 0, max: 200, step: 5 } },
      { key: 'glide', label: 'Glide', def: 0, spec: { type: 'number', min: 0, max: 1000, step: 10 } },
      { key: 'follow', label: 'Follow', def: 330, spec: { type: 'number', min: 0, max: 1000, step: 10 } },
    ],
  },
  goals: { type: 'fields', sparse: true, fields: [{ key: 'koth', label: 'King of the hill', def: 100, spec: list(50, 100, 150) }] },
};

test('every choice listed is one the game saves (main.js: DEFAULTS), in one group', () => {
  const main = fs.readFileSync(new URL('../web/src/main.js', import.meta.url), 'utf8');
  const defaults = main.slice(main.indexOf('const DEFAULTS = {'), main.indexOf('function loadSettings'));
  const keys = DEFAULT_GROUPS.flatMap(g => g.fields.map(([k]) => k));
  assert.equal(new Set(keys).size, keys.length, 'each once');
  assert.deepEqual(CHOICE_KEYS, keys);
  for (const k of keys) assert.match(defaults, new RegExp(`\\b${k}:`), `${k} is saved`);
  assert.deepEqual(DEFAULT_GROUPS.map(g => g.id), ['settings', 'setup']);
  // (Not your name, nor the game speed: fixed.)
  for (const k of ['name', 'gameName', 'speed', 'edition', 'graphicsPicked']) assert.ok(!keys.includes(k), `${k} isn't one`);
});

test('what differs from the game\'s own, or everything (every action\'s keys, then)', () => {
  const values = { ...BASE, volume: 35, camera: { look: 100, glide: 0, follow: 200 }, keys: { jump: ['Space'] }, bots: 5, goals: { koth: 200 } };
  assert.deepEqual(gameDefaults(values, BASE), {
    settings: { volume: 35, keys: { jump: ['Space'] }, camera: { look: 100, glide: 0, follow: 200 } },
    setup: { goals: { koth: 200 } },
  });
  assert.equal(changedDefaults(values, BASE), 4);
  assert.equal(changedDefaults(BASE, BASE), 0);
  assert.deepEqual(gameDefaults(BASE, BASE), { settings: {}, setup: {} }, 'nothing changed: nothing to copy');
  const all = gameDefaults(values, BASE, { all: true });
  assert.equal(all.settings.volume, 35);
  assert.equal(all.setup.mode, 'ffa');
  assert.deepEqual(Object.keys(all.settings.keys), ACTIONS.map(a => a.id), 'every action\'s keys');
  assert.deepEqual(all.settings.keys.fire, keysFor('fire'));
  assert.deepEqual(all.settings.keys.jump, ['Space'], 'as the defaults have them (not as you do)');
  // (Objects are the same whatever order their keys are in.)
  assert.ok(equal({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }) && !equal({ a: 1 }, { a: 1, b: 2 }) && !equal([1], { 0: 1 }));
});

test('each default checked and tidied up by its editor', () => {
  // One of a list: just those (and as the list has them: 1, not '1').
  assert.equal(tidy(SPECS.sprint, 'toggle'), 'toggle');
  assert.equal(tidy(SPECS.sprint, 'sideways'), undefined);
  assert.equal(tidy(SPECS.side, 2), 2);
  assert.equal(tidy(SPECS.side, '2'), undefined);
  assert.equal(tidy(SPECS.muted, true), true);
  assert.equal(tidy(SPECS.muted, 'yes'), undefined);
  // Numbers: in range, and to the step.
  assert.equal(tidy(SPECS.volume, 140), 100);
  assert.equal(tidy(SPECS.volume, 33.4), 33);
  assert.equal(tidy(SPECS.volume, NaN), undefined);
  assert.equal(tidy({ type: 'number', min: 1, max: 5, step: 0.5 }, 1.7), 1.5);
  assert.equal(tidy({ type: 'number', min: 20, max: 100, step: 5 }, 37), 35);
  assert.equal(tidy({ type: 'color' }, '#FF00aa'), '#ff00aa');
  assert.equal(tidy({ type: 'color' }, 'red'), undefined);
  // Objects of choices: each part checked; those missing (or not ones they can be) the part's own.
  assert.deepEqual(tidy(SPECS.camera, { follow: 203, look: 'far', nope: 1 }), { look: 100, glide: 0, follow: 200 });
  assert.equal(tidy(SPECS.camera, [1, 2]), undefined);
  // Sparse ones (the goals): just those not at their own.
  assert.deepEqual(tidy(SPECS.goals, { koth: 150, ctf: 3 }), { koth: 150 });
  assert.deepEqual(tidy(SPECS.goals, { koth: 100 }), {});
  // The keys: just the actions changed, each a list of keys there can be (as many as an action has).
  assert.deepEqual(tidy(SPECS.keys, { jump: ['Space', 'Space', 'Escape', 'KeyW'], left: ['KeyA', 'ArrowLeft'], nope: ['KeyQ'], fire: 'Mouse0' }), { jump: ['Space', 'KeyW'] });
  assert.deepEqual(tidy(SPECS.keys, { reload: ['KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI'] }).reload.length, MAX_KEYS);
  assert.deepEqual(tidy(SPECS.keys, { reload: [] }), { reload: [] }, 'none at all: unbound');
  assert.equal(tidy(undefined, 7), 7, 'no editor: as it is');
  assert.equal(parts(SPECS.keys).length, ACTIONS.length);
  assert.deepEqual(parts(SPECS.keys).find(p => p.key === 'left').def, ['KeyA', 'ArrowLeft']);
});

test('keys typed in by name', () => {
  for (const [typed, key] of [['W', 'KeyW'], ['w', 'KeyW'], ['keyw', 'KeyW'], ['KeyW', 'KeyW'], ['7', 'Digit7'], ['space', 'Space'], ['Up', 'ArrowUp'],
    ['ctrl', 'Control'], ['ShiftLeft', 'Shift'], ['mouse2', 'Mouse2'], ['RMB', 'Mouse2'], ['wheeldown', 'WheelDown'], ['f5', 'F5'], ['numpadenter', 'NumpadEnter'], ['pageup', 'PageUp']]) {
    assert.equal(keyFromText(typed), key, typed);
  }
  for (const typed of ['Escape', 'esc', 'Spcae', '', 'mouse9']) assert.equal(keyFromText(typed), null, typed);
  // A key another action has too (but for those that may share: E plants or defuses, and switches weapons).
  const all = Object.fromEntries(ACTIONS.map(a => [a.id, a.keys]));
  assert.deepEqual(sharedKeys(all, 'use'), [], 'as they come: only those that may share');
  assert.deepEqual(sharedKeys({ ...all, reload: ['KeyE', 'KeyR'] }, 'reload'), [['KeyE', ['next', 'use']]]);
});

test('pasted in: only choices there are, ones they can be, in the right group', () => {
  const { values, skipped } = readDefaults({
    settings: { volume: 70, muted: 'yes', nope: 1, bots: 3, camera: { follow: 200 } },
    setup: { bots: 8, mode: 'team', destruction: 'sideways', side: 2 },
    PHYS: { runSpeed: 4 },
  }, BASE, SPECS);
  assert.deepEqual(values, { volume: 70, camera: { look: 100, glide: 0, follow: 200 }, bots: 8, mode: 'team', side: 2 });
  assert.deepEqual(skipped.sort(), ['settings.bots', 'settings.muted', 'settings.nope', 'setup.destruction']);
  assert.deepEqual(readDefaults({ settings: { volume: '70', graphics: 3 } }, BASE).skipped, ['settings.volume', 'settings.graphics'], 'no editor: the same kind as the game\'s own');
  assert.deepEqual(readDefaults({ PHYS: { runSpeed: 4 } }, BASE), { values: {}, skipped: [] }, 'just numbers: no choices');
  assert.deepEqual(readDefaults(null, BASE), { values: {}, skipped: [] });
  assert.deepEqual(readDefaults({ settings: [1, 2] }, BASE), { values: {}, skipped: [] });
});

test('shown in the developer menu: each default, against the game\'s own and the player\'s', () => {
  const values = { ...BASE, muted: true, sprint: 'toggle', keys: { jump: ['Space', 'KeyW'] } };
  const mine = { ...BASE, sprint: 'toggle', camera: { follow: 330, look: 40, glide: 0 } };
  const rows = defaultRows(values, BASE, mine, SPECS);
  assert.deepEqual(rows.map(g => g.name), ['Settings', 'Game setup']);
  const row = key => rows.flatMap(g => g.rows).find(r => r.key === key);
  assert.deepEqual([row('muted').changed, row('muted').same, row('muted').page, row('muted').spec], [true, false, 'Audio', SPECS.muted]);
  assert.deepEqual([row('sprint').changed, row('sprint').same], [true, true], 'changed, and as the player has it');
  assert.deepEqual([row('camera').changed, row('camera').same, row('camera').mine.look], [false, false, 40]);
  assert.equal(row('bots').changed, false);
  assert.equal(row('bots').page, 'Game setup');
  // As words: what's picked from a list by its name; objects, the parts that differ.
  assert.equal(describe('sprint', 'toggle', SPECS.sprint), 'TOGGLE');
  assert.equal(describe('muted', true), 'On');
  assert.equal(describe('keys', { jump: ['Space', 'KeyW'] }), '1 action changed: jump Space/KeyW');
  assert.equal(describe('keys', {}), 'As they come');
  assert.equal(describe('jump', ['Space', 'KeyW']), 'Space/KeyW');
  assert.equal(describe('camera', { follow: 330, look: 100 }), 'follow 330, look 100');
  assert.equal(describe('camera', { follow: 330, look: 100 }, SPECS.camera), 'look 100, follow 330');
  assert.deepEqual(differences(SPECS.camera, values.camera, mine.camera).map(p => [p.key, p.value]), [['look', 40]]);
  assert.deepEqual(differences(SPECS.keys, values.keys, {}).map(p => [p.key, p.value]), [['jump', ['KeyW', 'Space', 'ArrowUp']]], 'the player\'s keys: as they come');
  assert.deepEqual(differences(SPECS.goals, {}, { koth: 100 }), [], 'a goal at its own is the same as none');
});
