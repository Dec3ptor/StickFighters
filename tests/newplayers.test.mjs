// Playing with a gamepad or on a touch screen (both drive the same actions the keys do), and a
// new player's hints, each shown once when it would help.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readPad, PadDriver, AIM_REACH } from '../web/src/gamepad.js';
import { stick, moveActions, STICK } from '../web/src/touch.js';
import { HINTS, newHints, nextHint, HINT_GAP } from '../web/src/hints.js';
import { Input, PlayerController } from '../web/src/input.js';
import { keysFor } from '../web/src/keys.js';

const pad = (buttons = [], axes = [0, 0, 0, 0]) => ({ connected: true, mapping: 'standard', axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: buttons.includes(i), value: buttons.includes(i) ? 1 : 0 })) });

test('a gamepad: sticks, triggers and buttons as the game\'s actions', () => {
  let r = readPad(pad([0, 7], [-0.9, 0, 0, 0]));
  assert.deepEqual([...r.held].sort(), ['fire', 'jump', 'left']);
  assert.equal(r.aim, null);
  r = readPad(pad([], [0.1, 0.1, 0.05, -0.1]));
  assert.equal(r.held.size, 0, 'a stick at rest isn\'t dead centre: nothing held');
  assert.ok(!r.any);
  r = readPad(pad([6], [0, 0.9, 0.6, -0.8]));
  assert.ok(r.held.has('aim') && r.held.has('crouch'));
  assert.ok(Math.abs(Math.hypot(r.aim.x, r.aim.y) - 1) < 1e-9 && r.aim.x > 0 && r.aim.y < 0);
  // Presses are once each: not again while the button stays down.
  const first = readPad(pad([2, 5, 9]));
  assert.deepEqual(first.pressed.sort(), ['next', 'reload']);
  assert.ok(first.menu);
  const still = readPad(pad([2, 5, 9]), first.buttons);
  assert.deepEqual(still.pressed, []);
  assert.ok(!still.menu);
});

/** The game's input with no page behind it. */
function bareInput() {
  const i = Object.create(Input.prototype);
  Object.assign(i, { keys: new Set(), tapped: new Set(), queue: [], otherHeld: new Set(), otherTapped: new Set(), otherQueue: [], mouse: { x: 0, y: 0 }, enabled: true, activeAt: 0, canvas: { clientWidth: 1000, clientHeight: 600 } });
  return i;
}

test('a gamepad drives the same actions as the keys, and lets go of them', () => {
  const input = bareInput();
  let now = pad([7], [1, 0, 0, -1]), menus = 0;
  const d = new PadDriver(input, { pads: () => [now], onMenu: () => menus++ });
  d.poll({ x: 500, y: 300 });
  assert.ok(input.held('fire') && input.held('right') && !input.held('left'));
  assert.ok(input.tappedAction('fire'), 'a press counts as one too');
  assert.deepEqual([input.mouse.x, input.mouse.y], [500, 300 - AIM_REACH], 'the crosshair out from the soldier, the way the stick points');
  now = pad([5, 9]);
  d.poll({ x: 500, y: 300 });
  assert.ok(!input.held('fire') && !input.held('right'), 'let go');
  assert.equal(input.took('next'), 'Other');
  assert.equal(input.took('next'), null, 'once');
  assert.equal(menus, 1);
  // The keys still work alongside.
  input.keys.add(keysFor('jump')[0]);
  assert.ok(input.held('jump'));
  // Unplugged: nothing left held.
  now = pad([0]);
  d.poll({ x: 500, y: 300 });
  assert.ok(input.otherHeld.has('jump'));
  now = null;
  d.poll(null);
  assert.equal(input.otherHeld.size, 0);
  // A menu open (input off): nothing's held or pressed.
  input.enabled = false;
  now = pad([7, 2]);
  d.poll({ x: 500, y: 300 });
  assert.ok(!input.held('fire'));
  assert.equal(input.took('reload'), null);
});

test('thumbs: a stick from where the thumb went down; up to jump, down to crouch', () => {
  assert.deepEqual(stick(100, 100, 100, 100), { x: 0, y: 0, k: 0 });
  const s = stick(100, 100, 100 + STICK * 2, 100);
  assert.ok(Math.abs(s.x - 1) < 1e-9 && s.k === 1, 'no further than all the way');
  assert.deepEqual([...moveActions(stick(0, 0, -STICK, 0))], ['left']);
  assert.deepEqual([...moveActions(stick(0, 0, STICK * 0.1, 0))], []);
  assert.deepEqual([...moveActions(stick(0, 0, STICK * 0.5, -STICK * 0.8))].sort(), ['jump', 'right']);
  assert.ok(moveActions(stick(0, 0, 0, STICK)).has('crouch'));
});

test('a new player\'s hints: each once, when it would help, not all at once', () => {
  const me = { alive: true, current: 'Platinum', weapons: { Platinum: { ammo: Infinity, mag: 12 } }, has: () => true, body: { onGround: true, vx: 0, sprinting: false, crouching: false, hasJetpack: false } };
  const h = newHints();
  assert.equal(nextHint(h, me, {}, 0), null, 'not the instant the match starts');
  assert.match(nextHint(h, me, {}, 2), /Move with/);
  assert.equal(nextHint(h, me, {}, 3), null, 'one at a time');
  // Low on rounds: how to reload (once the last hint's had its time).
  me.weapons.Platinum.mag = 2;
  assert.equal(nextHint(h, me, {}, 5), null);
  assert.match(nextHint(h, me, {}, 2 + HINT_GAP + 1), /reload/);
  me.weapons.Platinum.mag = 12;
  // Running for a while without sprinting.
  let said = null;
  for (let t = 22; t < 40 && !said; t++) said = nextHint(h, me, { move: true }, t);
  assert.match(said, /sprint/);
  // A second gun; a jetpack.
  me.weapons.M4 = { ammo: 60, mag: 30 };
  assert.match(nextHint(h, me, {}, 60), /change weapon/);
  me.body.hasJetpack = true;
  assert.match(nextHint(h, me, {}, 80), /jetpack/);
  // Seen before (kept from the last visit): not again.
  const again = newHints(['move', 'reload', 'sprint', 'switch', 'jetpack']);
  for (let t = 0; t < 25; t++) assert.equal(nextHint(again, me, { move: true }, t), null);
  assert.ok(HINTS.every(x => /\{key:\w+\}|Esc/.test(x.text)), 'every hint names its key');
  // Dead: nothing.
  assert.equal(nextHint(newHints(), { ...me, alive: false }, {}, 100), null);
});
