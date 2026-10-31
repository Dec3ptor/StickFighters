// The developer menu's Settings & setup (gamedefaults.js): the choices players make, compared
// with the game's own, copied out (changed, or everything) and pasted back in, each checked.
// (tests/browser/settings.mjs uses it in the page.) Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_GROUPS, gameDefaults, changedDefaults, readDefaults, defaultRows, describe, equal } from '../web/src/gamedefaults.js';
import { ACTIONS, keysFor } from '../web/src/keys.js';

// The game's own, as main.js has them (a few).
const BASE = {
  volume: 60, muted: false, sprint: 'hold', graphics: 'canvas', camera: { follow: 330, look: 100, glide: 0 }, keys: {}, skin: 'auto',
  mode: 'ffa', map: 'ssdm1.json', bots: 5, goals: {}, destruction: 'on', side: 1,
};

test('every choice listed is one the game saves (main.js: DEFAULTS), in one group', () => {
  const main = fs.readFileSync(new URL('../web/src/main.js', import.meta.url), 'utf8');
  const defaults = main.slice(main.indexOf('const DEFAULTS = {'), main.indexOf('function loadSettings'));
  const keys = DEFAULT_GROUPS.flatMap(g => g.fields.map(([k]) => k));
  assert.equal(new Set(keys).size, keys.length, 'each once');
  for (const k of keys) assert.match(defaults, new RegExp(`\\b${k}:`), `${k} is saved`);
  assert.deepEqual(DEFAULT_GROUPS.map(g => g.id), ['settings', 'setup']);
  // (Not your name, nor the game speed: fixed.)
  for (const k of ['name', 'gameName', 'speed', 'edition', 'graphicsPicked']) assert.ok(!keys.includes(k), `${k} isn't one`);
});

test('what differs from the game\'s own, or everything (every action\'s keys, then)', () => {
  const saved = { ...BASE, volume: 35, camera: { look: 100, glide: 0, follow: 200 }, keys: { jump: ['Space'] }, bots: 5, goals: { koth: 200 } };
  assert.deepEqual(gameDefaults(saved, BASE), {
    settings: { volume: 35, keys: { jump: ['Space'] }, camera: { look: 100, glide: 0, follow: 200 } },
    setup: { goals: { koth: 200 } },
  });
  assert.equal(changedDefaults(saved, BASE), 4);
  assert.equal(changedDefaults(BASE, BASE), 0);
  assert.deepEqual(gameDefaults(BASE, BASE), { settings: {}, setup: {} }, 'nothing changed: nothing to copy');
  const all = gameDefaults(saved, BASE, { all: true });
  assert.equal(all.settings.volume, 35);
  assert.equal(all.setup.mode, 'ffa');
  assert.deepEqual(Object.keys(all.settings.keys), ACTIONS.map(a => a.id), 'every action\'s keys');
  assert.deepEqual(all.settings.keys.fire, keysFor('fire'));
  // (Objects are the same whatever order their keys are in.)
  assert.ok(equal({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }) && !equal({ a: 1 }, { a: 1, b: 2 }) && !equal([1], { 0: 1 }));
});

test('pasted in: only choices there are, of the right kind, in the right group', () => {
  const { values, skipped } = readDefaults({
    settings: { volume: 70, muted: 'yes', nope: 1, bots: 3, camera: { follow: 200 } },
    setup: { bots: 8, mode: 'team', destruction: 'sideways' },
    PHYS: { runSpeed: 4 },
  }, BASE, (k, v) => !(k === 'destruction' && !['on', 'off'].includes(v)));
  assert.deepEqual(values, { volume: 70, camera: { follow: 200 }, bots: 8, mode: 'team' });
  assert.deepEqual(skipped.sort(), ['settings.bots', 'settings.muted', 'settings.nope', 'setup.destruction']);
  assert.deepEqual(readDefaults({ PHYS: { runSpeed: 4 } }, BASE), { values: {}, skipped: [] }, 'just numbers: no choices');
  assert.deepEqual(readDefaults(null, BASE), { values: {}, skipped: [] });
  assert.deepEqual(readDefaults({ settings: [1, 2] }, BASE), { values: {}, skipped: [] });
});

test('shown in the developer menu: each choice as chosen and as the game has it', () => {
  const rows = defaultRows({ ...BASE, muted: true, keys: { jump: ['Space', 'KeyW'] } }, BASE);
  assert.deepEqual(rows.map(g => g.name), ['Settings', 'Game setup']);
  const muted = rows[0].rows.find(r => r.key === 'muted');
  assert.deepEqual([muted.value, muted.def, muted.changed, muted.page], ['On', 'Off', true, 'Audio']);
  assert.equal(rows[0].rows.find(r => r.key === 'keys').value, '1 action changed: jump Space/KeyW');
  assert.equal(rows[1].rows.find(r => r.key === 'bots').changed, false);
  assert.equal(describe('camera', { follow: 330, look: 100 }), 'follow 330, look 100');
  assert.equal(describe('keys', {}), 'As they come');
});
