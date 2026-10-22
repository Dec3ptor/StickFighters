// Keyboard and mouse, and turning them into a soldier's input each tick.

import { WEAPONS } from './weapons.js';

const GAME_KEYS = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyF', 'KeyK', 'KeyG', 'KeyR', 'ShiftLeft', 'ShiftRight',
]);
// Ctrl / Cmd are crouch keys too (as in most shooters). Held with a game key, they'd
// otherwise open browser shortcuts (Ctrl+D bookmarks, Ctrl+S saves...), and the game
// would miss the key being let go and keep moving.
const MODIFIERS = new Set(['ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight']);

// Number keys 1-9 and 0 pick weapon slots 0-9; F picks melee (slot 10).
const SLOT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'KeyF'];
// (G uses your class's gadget, or in Defuse drops your gun: one press, one use. R reloads.)
const QUEUED = new Set([...SLOT_KEYS, 'KeyQ', 'KeyE', 'KeyG', 'KeyR']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.queue = [];          // key presses waiting to be read by the game
    // (clicked / rightClicked: a press not yet seen by the game, so a click quicker than
    // the time between two game updates still counts.)
    this.mouse = { x: 0, y: 0, left: false, right: false, moved: false, clicked: false, rightClicked: false };
    this.wheel = 0;
    this.enabled = false;
    // The mouse locked to the game (the browser's pointer lock): its cursor is hidden and
    // only the game gets the mouse, which moves the crosshair by how far the mouse moves.
    this.locked = false;
    this.lockedAt = 0;
    this.releasing = false;     // (we let go of it ourselves: not the player pressing Esc)
    this.wantsLock = () => false; // main.js: whether the mouse should be locked to the game now
    this.onPress = null;          // main.js: a click on the game (it can lock the mouse, or go full screen, then)
    this.onLockLost = null;       // main.js: the player freed the mouse (Esc), so open the menu

    window.addEventListener('keydown', e => {
      if (!this.enabled) return;
      if (GAME_KEYS.has(e.code) || MODIFIERS.has(e.code) || /^Digit\d$/.test(e.code)) e.preventDefault();
      // Only weapon keys are read as one-off presses; everything else is read as held.
      if (!e.repeat && QUEUED.has(e.code) && this.queue.length < 8) this.queue.push(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', e => {
      this.keys.delete(e.code);
      // (Macs don't report keys let go while Cmd is down: forget them all when it's let go.)
      if (e.code === 'MetaLeft' || e.code === 'MetaRight') this.keys.clear();
    });
    // Leaving the page (a browser dialog, another window or tab): nothing stays held.
    const release = () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; };
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
    window.addEventListener('mousemove', e => {
      if (this.locked) {
        // (Just after locking, browsers can report the cursor being moved into the middle.)
        if (performance.now() - this.lockedAt < 100) return;
        this.mouse.x = Math.max(0, Math.min(this.canvas.clientWidth, this.mouse.x + (e.movementX || 0)));
        this.mouse.y = Math.max(0, Math.min(this.canvas.clientHeight, this.mouse.y + (e.movementY || 0)));
      } else {
        const r = this.canvas.getBoundingClientRect();
        this.mouse.x = e.clientX - r.left;
        this.mouse.y = e.clientY - r.top;
      }
      this.mouse.moved = true;
    });
    document.addEventListener('pointerlockchange', () => {
      const now = !!this.canvas && document.pointerLockElement === this.canvas;
      if (now === this.locked) return;
      this.locked = now;
      if (now) {
        this.lockedAt = performance.now();
        // (Asked for just before a menu opened: let go again.)
        if (!this.wantsLock()) this.unlock();
        return;
      }
      if (!this.releasing) this.onLockLost?.();
      this.releasing = false;
    });
    document.addEventListener('pointerlockerror', () => { this.releasing = false; });
    this.guard();
    window.addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    this.onCanvas = {
      mousedown: e => {
        // (No text selection, Shift + click included, and no middle-click scrolling.)
        e.preventDefault();
        this.onPress?.();
        if (e.button === 0) this.mouse.left = this.mouse.clicked = true;
        if (e.button === 2) this.mouse.right = this.mouse.rightClicked = true;
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
    // (The mouse was locked to the old one: it's let go of with it.)
    if (this.locked) this.unlock();
    this.canvas = canvas;
  }

  /** Lock the mouse to the game (only works from a click or key press; failing that, the next click tries again). */
  lock() {
    if (this.locked || !this.canvas?.requestPointerLock) return;
    try {
      const p = this.canvas.requestPointerLock();
      p?.catch?.(() => {});
    } catch { /* not now */ }
  }

  /** Let go of the mouse (for a menu): this isn't the player pressing Esc. */
  unlock() {
    if (!this.locked) return;
    this.releasing = true;
    document.exitPointerLock?.();
  }

  /**
   * While a match is being played (the page's body has the class 'playing'), the
   * browser's own reactions to the mouse, Shift and Ctrl with it included, stay out
   * of the game: no menu on a right click, no zooming with Ctrl + wheel or scrolling
   * with Shift + wheel, no selecting text, no dragging, no pasting or scrolling with
   * the middle button, and no going back or forward with the mouse's side buttons.
   */
  guard() {
    const playing = () => document.body.classList.contains('playing');
    const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || !!e.target?.isContentEditable;
    window.addEventListener('contextmenu', e => { if (playing() && !typing(e)) e.preventDefault(); });
    window.addEventListener('auxclick', e => { if (playing()) e.preventDefault(); });
    for (const type of ['mousedown', 'mouseup']) {
      window.addEventListener(type, e => { if (playing() && (e.button === 1 || e.button === 3 || e.button === 4)) e.preventDefault(); });
    }
    window.addEventListener('selectstart', e => { if (playing() && !typing(e)) e.preventDefault(); });
    window.addEventListener('dragstart', e => { if (playing()) e.preventDefault(); });
    window.addEventListener('wheel', e => {
      if (playing() && (e.ctrlKey || e.target instanceof HTMLCanvasElement)) e.preventDefault();
    }, { passive: false });
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
    this.mouse.left = this.mouse.right = this.mouse.clicked = this.mouse.rightClicked = false;
    this.wheel = 0;
  }
}

/** Drives the player's soldier from the keyboard and mouse. */
export class PlayerController {
  /**
   * view: the renderer, or a function returning the current one (it can change in Settings).
   * sprintMode: a function returning 'hold' (sprint while Shift is held) or 'toggle' (Shift
   * starts sprinting, until you press it again, stop moving or run out of stamina).
   */
  constructor(input, view, { sprintMode = () => 'hold' } = {}) {
    this.in = input;
    this.view = typeof view === 'function' ? view : () => view;
    this.sprintMode = sprintMode;
    this.prevJump = false;
    this.prevFire = false;
    this.prevShift = false;
    this.sprintOn = false;
    this.jetting = false;
  }

  input(game, s) {
    const k = this.in;
    const jump = k.down('KeyW', 'Space', 'ArrowUp');
    const inp = {
      move: (k.down('KeyD', 'ArrowRight') ? 1 : 0) - (k.down('KeyA', 'ArrowLeft') ? 1 : 0),
      jump,
      jumpPressed: jump && !this.prevJump,
      crouch: k.down('KeyS', 'ArrowDown', 'ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight'),
      // Hold K to self-destruct (to get out of a pit you can't climb out of).
      selfDestruct: k.down('KeyK'),
      fire: k.mouse.left || k.mouse.clicked,
      firePressed: (k.mouse.left && !this.prevFire) || k.mouse.clicked,
      alt: k.mouse.right || k.mouse.rightClicked,
    };
    this.prevJump = jump;
    this.prevFire = k.mouse.left;
    // Building (the Hammer, the Builder): right click turns the block (a wall or a plank).
    if (((k.mouse.right && !this.prevAlt) || k.mouse.rightClicked) && WEAPONS[s.current]?.kind === 'build' && s.alive) this.plank = !this.plank;
    this.prevAlt = k.mouse.right;
    k.mouse.clicked = k.mouse.rightClicked = false;
    inp.plank = !!this.plank;

    // Sprint (Shift): while held, or toggled on and off.
    const shift = k.down('ShiftLeft', 'ShiftRight');
    const b = s.body;
    if (this.sprintMode() === 'toggle') {
      if (shift && !this.prevShift) this.sprintOn = !this.sprintOn;
      // (Stops when you stop moving for a moment, not while switching direction.)
      this.still = inp.move ? 0 : (this.still || 0) + 1;
      if (this.still > 8 || !s.alive || b.winded) this.sprintOn = false;
      inp.sprint = this.sprintOn;
    } else inp.sprint = shift;
    this.prevShift = shift;

    // Jetpack: hold jump in the air once you start falling.
    if (!b.hasJetpack || b.onGround || !jump) this.jetting = false;
    else if (b.vy > -1.5 || this.jetting) this.jetting = true;
    inp.jet = this.jetting;

    const w = this.view().screenToWorld(k.mouse.x, k.mouse.y);
    inp.aim = Math.atan2(w.y - s.shoulderY, w.x - s.shoulderX);
    inp.aimDist = Math.hypot(w.x - s.shoulderX, w.y - s.shoulderY);

    const deploy = s.alive ? null : game.deployOptions(s);
    if (deploy) {
      // Waiting to respawn (conquest's points, spawn beacons): number keys choose where.
      for (let i = 0; i < 9; i++) {
        if (k.took(SLOT_KEYS[i])) { const opt = deploy[i]; if (opt) s.deployAt = opt.key; }
      }
    }
    // G: your class's gadget, or (Defuse) drop the gun in your hands or the bomb.
    if (k.took('KeyG')) { if (game.rules.drop) inp.drop = true; else inp.gadget = true; }
    if (k.took('KeyR')) inp.reload = true;
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      if (k.took(SLOT_KEYS[i])) { const id = s.slotChoice(i); if (id) inp.switchTo = id; }
    }
    // E: plant or defuse Defuse's bomb, held, where you can; otherwise it switches weapons, as Q does.
    const using = !!game.rules.useHere?.(game, s);
    inp.use = k.down('KeyE') && !!game.rules.useHere;
    if (k.took('KeyQ')) inp.cycle = -1;
    else if (k.took('KeyE')) { if (!using) inp.cycle = 1; }
    else if (k.wheel) { inp.cycle = Math.sign(k.wheel); k.wheel = 0; }
    return inp;
  }
}
