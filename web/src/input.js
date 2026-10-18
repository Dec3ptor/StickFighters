// Keyboard and mouse, and turning them into a soldier's input each tick.


const GAME_KEYS = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyF', 'ShiftLeft', 'ShiftRight',
]);

// Number keys 1-9 and 0 pick weapon slots 0-9; F picks melee (slot 10).
const SLOT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'KeyF'];
const QUEUED = new Set([...SLOT_KEYS, 'KeyQ', 'KeyE']);

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
      if (GAME_KEYS.has(e.code) || /^Digit\d$/.test(e.code)) e.preventDefault();
      // Only weapon keys are read as one-off presses; everything else is read as held.
      if (!e.repeat && QUEUED.has(e.code) && this.queue.length < 8) this.queue.push(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    window.addEventListener('mousemove', e => {
      const r = this.canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.moved = true;
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    this.onCanvas = {
      mousedown: e => {
        if (e.button === 0) this.mouse.left = true;
        if (e.button === 2) this.mouse.right = true;
      },
      contextmenu: e => e.preventDefault(),
      wheel: e => { e.preventDefault(); this.wheel += Math.sign(e.deltaY); },
    };
    this.canvas = null;
    this.attach(canvas);
  }

  /** Listen to a (new) canvas: the game draws on a fresh one when Settings switches graphics. */
  attach(canvas) {
    for (const [type, fn] of Object.entries(this.onCanvas)) {
      this.canvas?.removeEventListener(type, fn);
      canvas.addEventListener(type, fn, type === 'wheel' ? { passive: false } : undefined);
    }
    this.canvas = canvas;
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
  /** view: the renderer, or a function returning the current one (it can change in Settings). */
  constructor(input, view) {
    this.in = input;
    this.view = typeof view === 'function' ? view : () => view;
    this.prevJump = false;
    this.prevFire = false;
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
      firePressed: k.mouse.left && !this.prevFire,
      alt: k.mouse.right,
    };
    this.prevJump = jump;
    this.prevFire = k.mouse.left;

    // Jetpack: hold jump in the air once you start falling (or hold Shift).
    const b = s.body;
    if (!b.hasJetpack || b.onGround || !(jump || k.down('ShiftLeft', 'ShiftRight'))) this.jetting = false;
    else if (k.down('ShiftLeft', 'ShiftRight') || b.vy > -1.5 || this.jetting) this.jetting = true;
    inp.jet = this.jetting;

    const w = this.view().screenToWorld(k.mouse.x, k.mouse.y);
    inp.aim = Math.atan2(w.y - s.shoulderY, w.x - s.shoulderX);
    inp.aimDist = Math.hypot(w.x - s.shoulderX, w.y - s.shoulderY);

    if (!s.alive && game.rules.deployOptions) {
      // Waiting to respawn (conquest): number keys choose where.
      for (let i = 0; i < 9; i++) {
        if (k.took(SLOT_KEYS[i])) { const opt = game.rules.deployOptions(game, s)[i]; if (opt) s.deployAt = opt.key; }
      }
    }
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      if (k.took(SLOT_KEYS[i])) { const id = s.slotChoice(i); if (id) inp.switchTo = id; }
    }
    if (k.took('KeyQ')) inp.cycle = -1;
    else if (k.took('KeyE')) inp.cycle = 1;
    else if (k.wheel) { inp.cycle = Math.sign(k.wheel); k.wheel = 0; }
    return inp;
  }
}
