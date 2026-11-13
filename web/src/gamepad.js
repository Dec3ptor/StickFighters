// Playing with a gamepad (the browser's standard layout: an Xbox or PlayStation pad, or one like
// them). The left stick moves (and crouches, pushed down); the right stick aims, the crosshair
// out from your soldier the way it points; the triggers fire and aim down the sights; the face
// buttons jump, reload, crouch and use; the bumpers change weapon; a click of the left stick
// sprints; Start opens the menu. Read once each frame (main.js), it holds and presses the
// game's actions (input.js's hold and press), so everything bound to an action works the same.

/** How far a stick has to be pushed to count (they don't rest dead centre). */
export const DEAD = 0.28;
/** How far out from the soldier the crosshair sits with the right stick pushed all the way (px on screen). */
export const AIM_REACH = 230;

/** Buttons that hold an action while they're down, and ones that press it once: [button index, action]. */
export const PAD_HOLD = [[0, 'jump'], [7, 'fire'], [6, 'aim'], [1, 'crouch'], [13, 'crouch'], [10, 'sprint'], [3, 'use'], [12, 'jump']];
export const PAD_PRESS = [[2, 'reload'], [5, 'next'], [4, 'prev'], [15, 'next'], [14, 'prev'], [3, 'gadget'], [11, 'streak']];

const down = b => !!b && (b.pressed || b.value > 0.5);

/**
 * What a pad says now: { held (the actions held), pressed (actions pressed since `before`, the
 * buttons down last time), aim ({ x, y } each -1 to 1, or null with the stick at rest), menu
 * (Start pressed), buttons (those down now, to pass back as `before`), any }.
 */
export function readPad(pad, before = new Set()) {
  const held = new Set(), pressed = [], buttons = new Set();
  const btn = pad.buttons || [], ax = pad.axes || [];
  btn.forEach((b, i) => { if (down(b)) buttons.add(i); });
  for (const [i, action] of PAD_HOLD) if (buttons.has(i)) held.add(action);
  for (const [i, action] of PAD_PRESS) if (buttons.has(i) && !before.has(i)) pressed.push(action);
  const lx = ax[0] || 0, ly = ax[1] || 0;
  if (lx < -DEAD) held.add('left');
  if (lx > DEAD) held.add('right');
  if (ly > 0.6 && Math.abs(lx) < 0.5) held.add('crouch');
  const rx = ax[2] || 0, ry = ax[3] || 0, mag = Math.hypot(rx, ry);
  const aim = mag > DEAD ? { x: rx / Math.max(1, mag), y: ry / Math.max(1, mag) } : null;
  return { held, pressed, aim, menu: buttons.has(9) && !before.has(9), buttons, any: buttons.size > 0 || !!aim || held.size > 0 };
}

/** Keeps a pad's state from one frame to the next, and drives the game's input with it. */
export class PadDriver {
  constructor(input, { pads = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []), onMenu = () => {} } = {}) {
    this.input = input;
    this.pads = pads;
    this.onMenu = onMenu;
    this.before = new Set();
    this.held = new Set();
    this.dir = { x: 1, y: 0 };  // (the way the crosshair last pointed)
    this.used = false;          // (a pad's been used: main.js shows its buttons in the help)
  }

  /** Once a frame. from: where the player's soldier is on the screen ({ x, y }): the crosshair goes out from there. */
  poll(from) {
    let pad = null;
    try { for (const p of this.pads() || []) if (p && p.connected !== false && (!pad || p.mapping === 'standard')) pad = p; } catch { /* not allowed here */ }
    if (!pad) { if (this.held.size) { for (const a of this.held) this.input.hold(a, false); this.held.clear(); } this.before.clear(); return false; }
    const r = readPad(pad, this.before);
    this.before = r.buttons;
    if (r.any) this.used = true;
    if (r.menu) this.onMenu();
    for (const a of this.held) if (!r.held.has(a)) this.input.hold(a, false);
    for (const a of r.held) this.input.hold(a, true);
    this.held = r.held;
    for (const a of r.pressed) this.input.press(a);
    if (r.aim) this.dir = r.aim;
    // (The crosshair stays out where it was pointed, moving with the soldier; only while the pad's in use.)
    if (this.used && from && (r.aim || r.held.size)) this.input.aimAt(from.x + this.dir.x * AIM_REACH, from.y + this.dir.y * AIM_REACH);
    return true;
  }
}
