// Playing on a touch screen (a phone or tablet). Two thumbs: the left half of the screen is a
// stick that moves you (push up to jump, down to crouch); the right half aims where you drag,
// out from your soldier, and fires while you hold it there past half way. Buttons along the
// right edge jump, reload and change weapon; one at the top opens the menu. They show up the
// first time the screen's touched, and only while a match is being played. Like a gamepad
// (gamepad.js), it holds and presses the game's actions (input.js), so nothing else changes.

/** How far a thumb travels for a stick pushed all the way (px), and how far for it to count. */
export const STICK = 56, STICK_DEAD = 0.3;
/** How far out from the soldier the crosshair sits with the aiming thumb pushed all the way (px). */
export const TOUCH_REACH = 220;

/** A stick pushed from where the thumb went down to where it is now: { x, y } each -1 to 1, and how far (0 to 1). */
export function stick(x0, y0, x, y) {
  const dx = x - x0, dy = y - y0, d = Math.hypot(dx, dy), k = Math.min(1, d / STICK);
  return d ? { x: dx / d * k, y: dy / d * k, k } : { x: 0, y: 0, k: 0 };
}

/** The actions a move stick at (x, y) holds. */
export function moveActions(s) {
  const out = new Set();
  if (s.x < -STICK_DEAD) out.add('left');
  if (s.x > STICK_DEAD) out.add('right');
  if (s.y < -0.6) out.add('jump');
  if (s.y > 0.6) out.add('crouch');
  return out;
}

export class TouchControls {
  /** root: the element the controls are put in. from(): where the player's soldier is on the screen. */
  constructor(input, { root, from = () => null, onMenu = () => {}, playing = () => true } = {}) {
    this.input = input;
    this.from = from;
    this.playing = playing;
    this.used = false;
    this.move = null;   // { id, x0, y0 } the thumb that's the move stick
    this.aim = null;    // the one aiming
    this.held = new Set();
    this.dir = { x: 1, y: 0, k: 0 };
    const el = this.el = document.createElement('div');
    el.className = 'touch hidden';
    el.innerHTML = `<div class="touch-half touch-move"><i class="touch-ring"></i><i class="touch-knob"></i></div>
      <div class="touch-half touch-aim"><i class="touch-ring"></i><i class="touch-knob"></i></div>
      <button type="button" class="touch-btn touch-menu" data-menu="1" aria-label="Menu">≡</button>
      <div class="touch-btns">
        <button type="button" class="touch-btn" data-hold="jump">Jump</button>
        <button type="button" class="touch-btn" data-press="next">Weapon</button>
        <button type="button" class="touch-btn" data-press="reload">Reload</button>
        <button type="button" class="touch-btn" data-hold="sprint">Sprint</button>
      </div>`;
    root.appendChild(el);
    const [moveEl, aimEl] = el.querySelectorAll('.touch-half');
    this.moveEl = moveEl; this.aimEl = aimEl;
    const opts = { passive: false };
    // (Shown the first time the screen's touched anywhere.)
    window.addEventListener('touchstart', () => { if (!this.used) { this.used = true; this.show(); } }, { passive: true });
    for (const [half, which] of [[moveEl, 'move'], [aimEl, 'aim']]) {
      half.addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0]; if (!this[which]) { this[which] = { id: t.identifier, x0: t.clientX, y0: t.clientY }; this.place(half, t.clientX, t.clientY, t.clientX, t.clientY); this.drag(which, t); } }, opts);
      half.addEventListener('touchmove', e => { e.preventDefault(); for (const t of e.changedTouches) if (this[which]?.id === t.identifier) this.drag(which, t); }, opts);
      const end = e => { e.preventDefault(); for (const t of e.changedTouches) if (this[which]?.id === t.identifier) this.lift(which); };
      half.addEventListener('touchend', end, opts);
      half.addEventListener('touchcancel', end, opts);
    }
    for (const b of el.querySelectorAll('.touch-btn')) {
      const { hold, press, menu } = b.dataset;
      b.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); b.classList.add('on'); if (menu) onMenu(); else if (press) input.press(press); else input.hold(hold, true); }, opts);
      const up = e => { e.preventDefault(); e.stopPropagation(); b.classList.remove('on'); if (hold) input.hold(hold, false); };
      b.addEventListener('touchend', up, opts);
      b.addEventListener('touchcancel', up, opts);
    }
  }

  /** Shown while a match is being played (once the screen's been touched); hidden behind menus. */
  show() { this.el.classList.toggle('hidden', !(this.used && this.playing())); if (this.el.classList.contains('hidden')) { this.lift('move'); this.lift('aim'); } }

  place(half, x0, y0, x, y) {
    const r = half.getBoundingClientRect(), ring = half.querySelector('.touch-ring'), knob = half.querySelector('.touch-knob');
    half.classList.add('on');
    ring.style.left = `${x0 - r.left}px`; ring.style.top = `${y0 - r.top}px`;
    knob.style.left = `${x - r.left}px`; knob.style.top = `${y - r.top}px`;
  }

  drag(which, t) {
    const st = this[which], s = stick(st.x0, st.y0, t.clientX, t.clientY);
    this.place(which === 'move' ? this.moveEl : this.aimEl, st.x0, st.y0, st.x0 + s.x * STICK, st.y0 + s.y * STICK);
    if (which === 'move') {
      const now = moveActions(s);
      for (const a of this.held) if (!now.has(a)) this.input.hold(a, false);
      for (const a of now) this.input.hold(a, true);
      this.held = now;
    } else {
      if (s.k > 0.15) this.dir = s;
      // (Past half way: firing.)
      this.input.hold('fire', s.k > 0.5);
      this.point();
    }
  }

  lift(which) {
    if (!this[which]) return;
    this[which] = null;
    (which === 'move' ? this.moveEl : this.aimEl).classList.remove('on');
    if (which === 'move') { for (const a of this.held) this.input.hold(a, false); this.held = new Set(); }
    else this.input.hold('fire', false);
  }

  /** The crosshair, out from the soldier the way the aiming thumb last pointed. Once a frame (it moves with the soldier). */
  point() {
    const f = this.from();
    if (!this.used || !f || !(this.aim || this.move)) return;
    const k = Math.max(0.45, this.dir.k) / Math.max(0.001, this.dir.k || 1);
    this.input.aimAt(f.x + this.dir.x * k * TOUCH_REACH, f.y + this.dir.y * k * TOUCH_REACH);
  }
}
