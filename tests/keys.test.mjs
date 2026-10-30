// The keys (Settings, Controls): every action can have its own keys and mouse buttons, a key
// taken from one action leaves it, and the game reads the keys as set. Run with: npm test
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS, MAX_KEYS, keysFor, bindKey, unbindKey, setKeys, savedKeys, resetKeys, keyName, keyLabel, keyShort,
  keyText, keyOf, canBind, useLayout, slotAction,
} from '../web/src/keys.js';
import { Input, PlayerController } from '../web/src/input.js';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED } from '../web/src/config.js';

afterEach(() => { resetKeys(); useLayout(null); });

test('every action starts with its keys, and no key does two things (except E and Space, on purpose)', () => {
  const seen = new Map();
  for (const a of ACTIONS) {
    assert.ok(keysFor(a.id).length > 0, `${a.id} has a key`);
    for (const k of keysFor(a.id)) {
      assert.ok(canBind(k), `${k} can be bound`);
      if (seen.has(k)) {
        const pair = [seen.get(k), a.id].sort().join('+');
        assert.ok(['next+use', 'freeCam+jump'].includes(pair), `${k}: ${pair}`);
      } else seen.set(k, a.id);
    }
  }
  assert.deepEqual(keysFor('jump'), ['KeyW', 'Space', 'ArrowUp']);
  assert.deepEqual(keysFor('fire'), ['Mouse0']);
  assert.deepEqual(savedKeys(), {}, 'nothing to save to start with');
  assert.ok(!canBind('Escape'), 'Esc is the menu\'s');
});

test('a key put on one action leaves the others; shared ones stay shared', () => {
  // T moves from chat to reload.
  assert.deepEqual(bindKey('reload', 0, 'KeyT'), ['chat']);
  assert.deepEqual(keysFor('reload'), ['KeyT']);
  assert.deepEqual(keysFor('chat'), ['Enter']);
  // An extra key, past the last: added.
  bindKey('reload', 5, 'Mouse3');
  assert.deepEqual(keysFor('reload'), ['KeyT', 'Mouse3']);
  // Already one of the action's keys, put in another place: just the once.
  bindKey('reload', 0, 'Mouse3');
  assert.deepEqual(keysFor('reload'), ['Mouse3']);
  // E stays on both Use and Next weapon; Space on both Jump and Free camera.
  assert.deepEqual(bindKey('next', 0, 'KeyE'), []);
  assert.ok(keysFor('use').includes('KeyE'));
  assert.deepEqual(bindKey('freeCam', 0, 'Space'), []);
  assert.ok(keysFor('jump').includes('Space'));
  // No more than MAX_KEYS.
  for (const k of ['KeyU', 'KeyI', 'KeyO', 'KeyP', 'KeyH']) bindKey('melee', 99, k);
  assert.equal(keysFor('melee').length, MAX_KEYS);
  unbindKey('melee', 0);
  assert.equal(keysFor('melee').length, MAX_KEYS - 1);
  // What's saved is what changed; loading it gives the same keys back.
  const saved = savedKeys();
  assert.deepEqual(Object.keys(saved).sort(), ['chat', 'melee', 'reload']);
  resetKeys();
  assert.deepEqual(keysFor('chat'), ['Enter', 'KeyT']);
  setKeys(saved);
  assert.deepEqual(keysFor('reload'), ['Mouse3']);
  // Anything that isn't an action or a key is ignored.
  setKeys({ jump: ['KeyJ', 'Escape', 'Nonsense', 7], nope: ['KeyA'], fire: 'KeyL', __proto__: { x: 1 } });
  assert.deepEqual(keysFor('jump'), ['KeyJ']);
  assert.deepEqual(keysFor('fire'), ['Mouse0']);
});

test('keys are named as they\'re printed, in full and short; text names them as set', () => {
  assert.equal(keyName('KeyW'), 'W');
  assert.equal(keyName('Digit0'), '0');
  assert.equal(keyName('ArrowUp'), '↑');
  assert.equal(keyName('Mouse2'), 'Right click');
  assert.equal(keyName('Numpad5'), 'Num 5');
  assert.equal(keyName(keyOf('ControlLeft')), 'Ctrl');
  assert.equal(keyLabel('selfDestruct'), 'K');
  assert.equal(keyShort(slotAction(0)), '1');
  assert.equal(keyShort(slotAction(10)), 'F');
  bindKey('melee', 0, 'Mouse4');
  assert.equal(keyShort('melee'), 'M5');
  assert.equal(keyText('hold {key:selfDestruct} to self-destruct ({key:melee})'), 'hold K to self-destruct (Mouse 5)');
  unbindKey('streak', 0);
  assert.equal(keyLabel('streak'), 'Unbound');
  assert.equal(keyShort('streak'), '');
  // A keyboard that isn't QWERTY (the browser says what's printed on each key).
  useLayout(new Map([['KeyQ', 'a'], ['KeyA', 'q']]));
  assert.equal(keyName('KeyQ'), 'A');
  assert.equal(keyLabel('left'), 'Q');
});

/** The player's soldier on a floor, a controller reading keys pressed and held. */
function setup() {
  const map = { name: 'arena', bounds: { left: -400, top: -300, right: 400, bottom: 200 }, spawns: [{ x: 0, y: -12 }], items: [], platforms: [{ left: -400, top: 0, right: 400, bottom: 40 }] };
  const game = new Game({ mapData: map, effects: false, seed: 3, speed: DEFAULT_SPEED, mode: 'ffa' });
  // (An Input without a page: the keys held and pressed are set by hand.)
  const input = Object.assign(Object.create(Input.prototype), { keys: new Set(), queue: [], tapped: new Set(), mouse: { x: 0, y: 0 }, wheel: 0, enabled: true });
  const ctl = new PlayerController(input, { screenToWorld: (x, y) => ({ x, y }) });
  const s = game.addSoldier({ name: 'Me' }, ctl);
  s.spawnAt({ x: 0, y: -12 }, 0);
  const press = key => { input.keys.add(key); input.pressed(key); };
  const release = key => input.keys.delete(key);
  return { game, s, input, ctl, press, release, read: () => ctl.input(game, s) };
}

test('the game reads the keys as set: jump on J (not W), fire on L (not a click)', () => {
  const t = setup();
  t.press('KeyW');
  assert.ok(t.read().jump, 'W jumps to start with');
  t.release('KeyW');
  bindKey('jump', 0, 'KeyJ');
  t.press('KeyW');
  assert.ok(!t.read().jump, 'W doesn\'t, once J has its place');
  t.release('KeyW');
  t.press('KeyJ');
  const j = t.read();
  assert.ok(j.jump && j.jumpPressed, 'J jumps');
  t.release('KeyJ');
  bindKey('fire', 0, 'KeyL');
  t.press('Mouse0');
  assert.ok(!t.read().fire, 'a click doesn\'t fire');
  t.release('Mouse0');
  // A tap between two updates still fires (pressed and let go before the game looked).
  t.press('KeyL'); t.release('KeyL');
  const f = t.read();
  assert.ok(f.fire && f.firePressed, 'a quick tap of L fires');
  assert.ok(!t.read().fire, 'once');
});

test('one-press actions on mouse buttons and the wheel; E plants where it can, the wheel still switches', () => {
  const t = setup();
  bindKey('reload', 0, 'Mouse3');
  t.press('Mouse3');
  assert.ok(t.read().reload, 'the back button reloads');
  t.press('WheelDown');
  assert.equal(t.read().cycle, 1, 'wheel down: next weapon');
  t.press('WheelUp');
  assert.equal(t.read().cycle, -1, 'wheel up: previous weapon');
  // Where the bomb can be planted, E (shared by Use and Next weapon) plants rather than switches...
  const rules = t.game.rules, useHere = rules.useHere;
  rules.useHere = () => 'plant';
  try {
    t.press('KeyE');
    const e = t.read();
    assert.ok(e.use && !e.cycle, 'E plants');
    t.release('KeyE');
    // ...but the wheel, Next weapon's other key, still switches.
    t.press('WheelDown');
    assert.equal(t.read().cycle, 1, 'the wheel still switches');
  } finally { rules.useHere = useHere; }
  // The sledgehammer and a weapon slot on rebound keys.
  bindKey('melee', 0, 'Mouse1');
  t.press('Mouse1');
  assert.equal(t.read().switchTo, 'Sledgehammer', 'middle click: the sledgehammer');
});
