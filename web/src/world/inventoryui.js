// World mode's inventory screen (I, over the game, which carries on): the hotbar and the bag,
// ten across. Click a stack to pick it up and click a slot to put it there (swapping with
// what's there, or onto a stack of the same thing); right click splits a stack in two;
// shift-click sends it between the hotbar and the bag. Drop throws the stack picked up; Sort
// puts the bag in order. Hover over anything to see what it is.

import { HOTBAR, BAG, itemOf } from './items.js';
import { WEAPONS } from '../weapons.js';
import { drawWeapon } from '../sprites.js';
import { drawIcon } from './worldrender.js';
import { keyLabel, isKey, keyOf } from '../keys.js';

export class InventoryScreen {
  /** root: the screen's element; drop(i): throw slot i's stack; close(): it was closed. */
  constructor(root, { drop, close }) {
    this.root = root;
    this.onDrop = drop;
    this.onClose = close;
    this.me = null;
    this.picked = null;   // the slot whose stack is picked up
    this.version = -1;
    this.build();
  }

  get open() { return !this.root.classList.contains('hidden'); }

  build() {
    const slot = i => `<button type="button" class="inv-slot${i < HOTBAR ? ' hot' : ''}" data-slot="${i}"><canvas width="64" height="40" aria-hidden="true"></canvas><span class="inv-n"></span>${i < HOTBAR ? `<kbd>${(i + 1) % 10}</kbd>` : ''}</button>`;
    this.root.innerHTML = `
      <div class="buy-head">
        <h2>Your things</h2>
        <span class="inv-what" data-what></span>
        <button type="button" class="buy-close" data-close>Close <kbd data-inv-key>I</kbd></button>
      </div>
      <h3 class="inv-label">Hotbar</h3>
      <div class="inv-grid">${Array.from({ length: HOTBAR }, (_, i) => slot(i)).join('')}</div>
      <h3 class="inv-label">Bag</h3>
      <div class="inv-grid">${Array.from({ length: BAG }, (_, i) => slot(HOTBAR + i)).join('')}</div>
      <div class="inv-actions">
        <button type="button" data-act="drop">Drop</button>
        <button type="button" data-act="sort">Sort the bag</button>
        <span class="buy-foot">Click a stack, then where it goes &middot; right click: split it &middot; shift-click: to or from the hotbar</span>
      </div>`;
    this.slots = [...this.root.querySelectorAll('.inv-slot')];
    for (const b of this.slots) {
      const i = +b.dataset.slot;
      b.addEventListener('click', e => this.click(i, e.shiftKey));
      b.addEventListener('contextmenu', e => { e.preventDefault(); this.split(i); });
      b.addEventListener('mouseenter', () => this.describe(i));
      b.addEventListener('focus', () => this.describe(i));
    }
    this.root.querySelector('[data-close]').addEventListener('click', () => this.onClose());
    this.root.querySelector('[data-act="drop"]').addEventListener('click', () => {
      if (this.picked == null) return;
      const i = this.picked;
      this.picked = null;
      this.onDrop(i);
      this.refresh(true);
    });
    this.root.querySelector('[data-act="sort"]').addEventListener('click', () => {
      this.picked = null;
      this.me?.world.inv.sortBag();
      this.refresh(true);
    });
    this.whatEl = this.root.querySelector('[data-what]');
  }

  show(me) {
    this.me = me;
    this.picked = null;
    for (const k of this.root.querySelectorAll('[data-inv-key]')) k.textContent = keyLabel('inventory');
    this.root.classList.remove('hidden');
    this.refresh(true);
  }

  hide() {
    this.root.classList.add('hidden');
    this.picked = null;
  }

  get inv() { return this.me?.world?.inv; }

  click(i, shift) {
    const inv = this.inv;
    if (!inv) return;
    if (shift) { this.picked = null; inv.quickMove(i); }
    else if (this.picked == null) { if (inv.slots[i]) this.picked = i; }
    else if (this.picked === i) this.picked = null;
    else { inv.move(this.picked, i); this.picked = null; }
    this.refresh(true);
  }

  split(i) {
    this.picked = null;
    this.inv?.split(i);
    this.refresh(true);
  }

  describe(i) {
    const s = this.inv?.slots[i], it = s && itemOf(s.key);
    this.whatEl.textContent = it ? `${it.name}${s.n > 1 ? ` × ${s.n}` : ''}${whatFor(it)}` : '';
  }

  /** Bring the slots up to date (only when the things have changed, unless `force`). */
  refresh(force = false) {
    const inv = this.inv;
    if (!inv || (!force && inv.version === this.version)) return;
    this.version = inv.version;
    const w = this.me.world;
    for (const b of this.slots) {
      const i = +b.dataset.slot, s = inv.slots[i], it = s && itemOf(s.key);
      const look = s ? `${s.key}|${s.n}|${s.mag ?? ''}` : '';
      b.classList.toggle('picked', this.picked === i);
      b.classList.toggle('in-hand', i === w.slot);
      b.classList.toggle('empty', !s);
      if (b.dataset.look === look) continue;
      b.dataset.look = look;
      b.title = it ? `${it.name}${whatFor(it)}` : '';
      b.querySelector('.inv-n').textContent = s && (s.n > 1 || it?.kind === 'block') ? String(s.n) : s?.mag != null ? `${s.mag}` : '';
      const cv = b.querySelector('canvas');
      cv.classList.toggle('ink', it?.kind === 'weapon');
      paint(cv, it);
    }
  }

  /** A key while the screen is open: true if it was the screen's. */
  key(code) {
    if (code === 'Escape' || isKey('inventory', keyOf(code))) { this.onClose(); return true; }
    return false;
  }
}

/** What an item is for, after its name. */
function whatFor(it) {
  switch (it.kind) {
    case 'tool': return it.tool === 'hammer' ? ': shapes blocks into halves and ramps, takes down walls' : it.tool === 'axe' ? ': fells trees, breaks wooden things' : `: mines blocks (tier ${it.tier})`;
    case 'block': return ': a block to build with';
    case 'wall': return ': a wall, built behind';
    case 'ammo': return ': ammunition';
    case 'weapon': return it.ammo === 'self' ? '' : it.ammo ? ` (uses ${itemOf(it.ammo)?.name.toLowerCase() || it.ammo})` : '';
    default: return '';
  }
}

/** An item's picture in its slot. */
function paint(cv, it) {
  const ctx = cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!it) return;
  if (it.kind === 'weapon') {
    const def = WEAPONS[it.weapon], L = def.look.length || 12;
    const k = def.look.type === 'held' ? 2 : Math.min(2.2, 50 / (L + 8));
    ctx.translate(cv.width / 2, cv.height / 2);
    ctx.scale(k, k);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawWeapon(ctx, def, true);
    return;
  }
  drawIcon(ctx, it, cv.width / 2 - 14, cv.height / 2 - 14, 28, false, true);
}
