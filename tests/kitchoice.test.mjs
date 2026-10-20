// The class and loadouts you play with (classes on), saved in the browser: every
// main weapon and upgrade can be chosen from the start. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLASSES, CLASS_IDS, upgradesFor, kitWeapons } from '../web/src/classes.js';
import { newKit, cleanKit, loadKit, saveKit, KIT_KEY } from '../web/src/kitchoice.js';

/** A stand-in for localStorage. */
function memoryStore() {
  const data = new Map();
  return { data, getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
}

test('every main weapon and upgrade can be chosen from the start', () => {
  for (const cls of CLASS_IDS) {
    for (const m of CLASSES[cls].mains) {
      assert.equal(m.rank, undefined, `${cls}: ${m.id} isn't locked behind a rank`);
      const ups = {};
      for (const { id } of kitWeapons(cls, m.id)) if (upgradesFor(id).length) ups[id] = upgradesFor(id).at(-1);
      const kit = cleanKit({ cls, loadouts: { [cls]: { main: m.id, ups } } });
      assert.equal(kit.cls, cls);
      assert.equal(kit.loadouts[cls].main, m.id);
      assert.deepEqual(kit.loadouts[cls].ups, ups);
    }
  }
});

test('the choices are saved in the browser, apart from the settings, and load safely', () => {
  const store = memoryStore();
  store.setItem('stick-soldiers', '{"name":"Me"}');
  assert.deepEqual(loadKit(store), newKit(), 'Assault and the first weapons to start with');
  const kit = loadKit(store);
  kit.cls = 'engineer';
  kit.loadouts.engineer = { main: 'Mortar', ups: { Mortar: 'charge' } };
  saveKit(kit, store);
  assert.equal(store.getItem('stick-soldiers'), '{"name":"Me"}', 'the settings are left alone');
  const back = loadKit(store);
  assert.equal(back.cls, 'engineer');
  assert.deepEqual(back.loadouts.engineer, { main: 'Mortar', ups: { Mortar: 'charge' } });
  // A profile saved before (with XP and kills in it) keeps its class and loadouts.
  store.setItem(KIT_KEY, JSON.stringify({ v: 1, xp: 5000, kills: { M4: 9 }, cls: 'recon', loadouts: { recon: { main: 'Longbow' } } }));
  assert.deepEqual(loadKit(store), { cls: 'recon', loadouts: { ...newKit().loadouts, recon: { main: 'Longbow', ups: {} } } });
  saveKit(loadKit(store), store);
  assert.deepEqual(Object.keys(JSON.parse(store.getItem(KIT_KEY))).sort(), ['cls', 'loadouts'], 'the old XP goes');
  // Rubbish in storage: the defaults (or tidied choices).
  store.setItem(KIT_KEY, '{not json');
  assert.deepEqual(loadKit(store), newKit());
  const odd = cleanKit({ cls: 'wizard', loadouts: { recon: { main: 'Nope', ups: { SR: 'charge' } } } });
  assert.equal(odd.cls, 'assault');
  assert.deepEqual(odd.loadouts.recon, { main: 'SR', ups: {} });
  assert.deepEqual(Object.keys(odd.loadouts).sort(), [...CLASS_IDS].sort());
  // No storage at all (private browsing): still works.
  assert.deepEqual(loadKit(null), newKit());
  saveKit(newKit(), { setItem() { throw new Error('full'); } });
});
