// Keyboard and mouse, and turning them into a soldier's input each tick.

import { WEAPON_ORDER } from './weapons.js';

const GAME_KEYS = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight',
]);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.queue = [];          // key presses waiting to be read by the game
    this.mouse = { x: 0, y: 0, left: false, right: false, moved: false };
    this.wheel = 0;
    this.enabled = false;

    window.addEventListener('keydown', e => {
      if (!this.enabled) return;
      if (GAME_KEYS.has(e.code) || /^Digit[1-8]$/.test(e.code)) e.preventDefault();
      // Only weapon keys are read as one-off presses; everything else is read as held.
      if (!e.repeat && /^(Digit[1-8]|KeyQ|KeyE)$/.test(e.code) && this.queue.length < 8) this.queue.push(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    window.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.moved = true;
    });
    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => { e.preventDefault(); this.wheel += Math.sign(e.deltaY); }, { passive: false });
  }

  down(...codes) { return codes.some(c => this.keys.has(c)); }

  /** Take (and forget) any queued presses of these keys. */
  took(...codes) {
    const i = this.queue.findIndex(c => codes.includes(c));
    if (i < 0) return false;
    this.queue.splice(i, 1);
    return true;
  }

  clear() {
    this.keys.clear();
    this.queue.length = 0;
    this.mouse.left = this.mouse.right = false;
    this.wheel = 0;
  }
}

/** Drives the player's soldier from the keyboard and mouse. */
export class PlayerController {
  constructor(input, renderer) {
    this.in = input;
    this.renderer = renderer;
    this.prevJump = false;
    this.jetting = false;
  }

  input(game, s) {
    const k = this.in;
    const jump = k.down('KeyW', 'Space', 'ArrowUp');
    const inp = {
      move: (k.down('KeyD', 'ArrowRight') ? 1 : 0) - (k.down('KeyA', 'ArrowLeft') ? 1 : 0),
      jump,
      jumpPressed: jump && !this.prevJump,
      crouch: k.down('KeyS', 'ArrowDown'),
      fire: k.mouse.left,
      alt: k.mouse.right,
    };
    this.prevJump = jump;

    // Jetpack: hold jump in the air once you start falling (or hold Shift).
    const b = s.body;
    if (!b.hasJetpack || b.onGround || !(jump || k.down('ShiftLeft', 'ShiftRight'))) this.jetting = false;
    else if (k.down('ShiftLeft', 'ShiftRight') || b.vy > -1.5 || this.jetting) this.jetting = true;
    inp.jet = this.jetting;

    const w = this.renderer.screenToWorld(k.mouse.x, k.mouse.y);
    inp.aim = Math.atan2(w.y - s.shoulderY, w.x - s.shoulderX);

    for (let i = 0; i < WEAPON_ORDER.length; i++) {
      if (k.took('Digit' + (i + 1))) inp.switchTo = WEAPON_ORDER[i];
    }
    if (k.took('KeyQ')) inp.cycle = -1;
    else if (k.took('KeyE')) inp.cycle = 1;
    else if (k.wheel) { inp.cycle = Math.sign(k.wheel); k.wheel = 0; }
    return inp;
  }
}
