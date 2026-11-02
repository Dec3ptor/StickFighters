// World mode's inventory screen (I, over the game, which carries on): the hotbar and the bag,
// ten across; a chest's things too, when one's opened (right click on it); and crafting: what
// can be made, by hand or at the crafting stations near you (crafting.js).
//
// Click a stack to pick it up and click a slot to put it there (swapping with what's there, or
// onto a stack of the same thing); right click splits a stack in two; shift-click sends it
// across (between the hotbar and the bag, or between you and the chest); a number key puts what
// the mouse is over in that hotbar slot. Drop throws the stack picked up; Sort puts the bag in
// order. Click a recipe to make it (shift-click: five times); type to find one. Hover over
// anything for a card of what it is: what it does, what it's worth, what it's made from.

import { HOTBAR, BAG, itemOf, Inventory } from './items.js';
import { WEAPONS } from '../weapons.js';
import { drawWeapon } from '../sprites.js';
import { drawIcon } from './worldrender.js';
import { RECIPES, STATIONS, STATION_NAMES, stationsNear, timesCanMake, madeFrom } from './crafting.js';
import { keyLabel, isKey, keyOf } from '../keys.js';
import { setRightHand } from './worldplay.js';
import { itemDetails, categoryOf } from './iteminfo.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// The order recipes are listed in: by hand first, then by station.
const AT_ORDER = [null, ...STATIONS];

export class InventoryScreen {
  /**
   * root: the screen's element. drop(i): throw slot i's stack; craft(recipe, times): make it;
   * close(): it was closed.
   */
  constructor(root, { drop, craft, close }) {
    this.root = root;
    this.onDrop = drop;
    this.onCraft = craft;
    this.onClose = close;
    this.me = null;
    this.game = null;
    this.chest = null;     // a chest opened: { inv, tx, ty }
    this.picked = null;    // the stack picked up: { box: 'me' | 'chest', i }
    this.seen = '';        // (what the slots and recipes were last drawn for)
    this.near = new Set();
    // In someone else's world: what's done here goes to the host (fn({ op, ... })), which sends
    // our things back changed (worldnet.js). Null: done here.
    this.remote = null;
    this.build();
  }

  get open() { return !this.root.classList.contains('hidden'); }

  build() {
    const slot = (box, i) => `<button type="button" class="inv-slot${box === 'me' && i < HOTBAR ? ' hot' : ''}" data-box="${box}" data-slot="${i}"><canvas width="64" height="40" aria-hidden="true"></canvas><span class="inv-n"></span>${box === 'me' && i < HOTBAR ? `<kbd>${(i + 1) % 10}</kbd>` : ''}</button>`;
    const grid = (box, from, n) => `<div class="inv-grid">${Array.from({ length: n }, (_, i) => slot(box, from + i)).join('')}</div>`;
    this.root.innerHTML = `
      <div class="buy-head">
        <h2>Your things</h2>
        <span class="inv-coins" data-coins></span>
        <span class="inv-what" data-what></span>
        <button type="button" class="buy-close" data-close>Close <kbd data-inv-key>I</kbd></button>
      </div>
      <div class="inv-cols">
        <div class="inv-main">
          <h3 class="inv-label">Hotbar</h3>
          ${grid('me', 0, HOTBAR)}
          <div class="inv-grid inv-hands" data-hands>${Array.from({ length: HOTBAR }, (_, i) => `<button type="button" class="inv-hand" data-hand="${i}" title="Right click uses this (click again: nothing)">R</button>`).join('')}</div>
          <h3 class="inv-label">Bag</h3>
          ${grid('me', HOTBAR, BAG)}
          <div class="inv-chest hidden" data-chest>
            <h3 class="inv-label">Chest
              <button type="button" class="small" data-act="take-all">Take all</button>
              <button type="button" class="small" data-act="put-all">Put all in</button>
            </h3>
            ${grid('chest', 0, 30)}
          </div>
          <div class="inv-actions">
            <button type="button" data-act="drop">Drop</button>
            <button type="button" data-act="sort">Sort the bag</button>
            <span class="buy-foot">Click a stack, then where it goes &middot; right click: split it &middot; shift-click: send it across &middot; a number key: into that hotbar slot &middot; R under the hotbar: what right click uses (or hold <kbd data-hand-key>X</kbd> and press its number)</span>
          </div>
        </div>
        <div class="inv-tip hidden" data-tip></div>
        <div class="inv-craft">
          <h3 class="inv-label">Crafting <span class="craft-near" data-near></span></h3>
          <div class="craft-find"><input type="search" data-find placeholder="Find a recipe…" spellcheck="false" aria-label="Find a recipe"><label class="craft-only"><input type="checkbox" data-only> Only what I can make now</label></div>
          <div class="craft-list" data-recipes>${RECIPES.map(r => this.recipeRow(r)).join('')}</div>
        </div>
      </div>`;
    this.slots = [...this.root.querySelectorAll('.inv-slot')];
    for (const b of this.slots) {
      const box = b.dataset.box, i = +b.dataset.slot;
      b.addEventListener('click', e => this.click(box, i, e.shiftKey));
      b.addEventListener('contextmenu', e => { e.preventDefault(); this.split(box, i); });
      b.addEventListener('mouseenter', e => { this.hover = { box, i }; this.describe(box, i); this.tipFor(this.box(box)?.slots[i], e); });
      b.addEventListener('mousemove', e => this.moveTip(e));
      b.addEventListener('mouseleave', () => { this.hover = null; this.hideTip(); });
      b.addEventListener('focus', () => this.describe(box, i));
    }
    this.rows = new Map();
    for (const row of this.root.querySelectorAll('.craft-row')) {
      const r = RECIPES[+row.dataset.recipe];
      this.rows.set(r, row);
      const cv = row.querySelector('canvas');
      cv.classList.toggle('ink', itemOf(r.key).kind === 'weapon');
      paint(cv, itemOf(r.key));
      row.addEventListener('click', e => { this.onCraft(r, e.shiftKey ? 5 : 1); this.refresh(true); });
      row.addEventListener('mouseenter', e => { this.whatEl.textContent = `${itemOf(r.key).name}${r.n > 1 ? ` × ${r.n}` : ''}: ${madeFrom(r)}${r.at ? `, at a ${STATION_NAMES[r.at].toLowerCase()}` : ', by hand'}`; this.tipFor({ key: r.key, n: r.n }, e); });
      row.addEventListener('mousemove', e => this.moveTip(e));
      row.addEventListener('mouseleave', () => this.hideTip());
    }
    this.root.querySelector('[data-close]').addEventListener('click', () => this.onClose());
    this.root.querySelector('[data-act="drop"]').addEventListener('click', () => {
      const p = this.picked;
      this.picked = null;
      if (p?.box === 'me') this.onDrop(p.i);
      this.refresh(true);
    });
    this.root.querySelector('[data-act="sort"]').addEventListener('click', () => {
      this.picked = null;
      if (this.remote) this.remote({ op: 'sort' }); else this.inv?.sortBag();
      this.refresh(true);
    });
    this.root.querySelector('[data-act="take-all"]').addEventListener('click', () => { if (this.remote) this.remote({ op: 'take-all' }); else this.everything(this.chest?.inv, this.inv); });
    this.root.querySelector('[data-act="put-all"]').addEventListener('click', () => { if (this.remote) this.remote({ op: 'put-all' }); else this.everything(this.inv, this.chest?.inv, HOTBAR); });
    this.root.querySelector('[data-only]').addEventListener('change', () => this.refresh(true));
    this.findEl = this.root.querySelector('[data-find]');
    this.findEl.addEventListener('input', () => this.refresh(true));
    // (Typing in it: the keys are its own, not the game's or the screen's.)
    this.findEl.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { this.findEl.value = ''; this.findEl.blur(); this.refresh(true); } });
    this.tipEl = this.root.querySelector('[data-tip]');
    this.coinsEl = this.root.querySelector('[data-coins]');
    this.hands = [...this.root.querySelectorAll('[data-hand]')];
    for (const b of this.hands) b.addEventListener('click', () => this.setHand(+b.dataset.hand));
    this.whatEl = this.root.querySelector('[data-what]');
    this.nearEl = this.root.querySelector('[data-near]');
    this.chestEl = this.root.querySelector('[data-chest]');
    this.listEl = this.root.querySelector('[data-recipes]');
    this.onlyEl = this.root.querySelector('[data-only]');
  }

  recipeRow(r) {
    const it = itemOf(r.key);
    return `<button type="button" class="craft-row" data-recipe="${r.id}">
      <canvas width="48" height="32" aria-hidden="true"></canvas>
      <span class="craft-name">${esc(it.name)}${r.n > 1 ? ` <small>× ${r.n}</small>` : ''}</span>
      <span class="craft-of">${esc(madeFrom(r))}</span>
      <span class="craft-at">${r.at ? esc(STATION_NAMES[r.at]) : 'By hand'}</span>
    </button>`;
  }

  /** Open, for soldier `me` in `game` (chest: { inv, tx, ty }, one opened with a right click). */
  show(me, game, chest = null) {
    this.me = me;
    this.game = game;
    this.chest = chest;
    this.picked = null;
    this.chestEl.classList.toggle('hidden', !chest);
    this.root.querySelector('h2').textContent = chest ? 'Your things, and the chest' : 'Your things';
    for (const k of this.root.querySelectorAll('[data-inv-key]')) k.textContent = keyLabel('inventory');
    for (const k of this.root.querySelectorAll('[data-hand-key]')) k.textContent = keyLabel('hand2');
    this.root.classList.remove('hidden');
    this.refresh(true);
  }

  hide() {
    this.root.classList.add('hidden');
    this.picked = null;
    this.chest = null;
    this.hover = null;
    this.hideTip();
  }

  get inv() { return this.me?.world?.inv; }
  box(name) { return name === 'chest' ? this.chest?.inv : this.inv; }

  click(box, i, shift) {
    const inv = this.box(box);
    if (!inv) return;
    if (shift) {
      this.picked = null;
      if (this.remote) this.remote({ op: 'send', a: [box, i] });
      else if (this.chest) send(inv, i, box === 'me' ? this.chest.inv : this.inv, box === 'me' ? 0 : HOTBAR);
      else inv.quickMove(i);
    } else if (!this.picked) { if (inv.slots[i]) this.picked = { box, i }; }
    else if (this.picked.box === box && this.picked.i === i) this.picked = null;
    else {
      if (this.remote) this.remote({ op: 'move', a: [this.picked.box, this.picked.i], b: [box, i] });
      else moveBetween(this.box(this.picked.box), this.picked.i, inv, i);
      this.picked = null;
    }
    this.refresh(true);
  }

  /** Right click uses hotbar slot i (or, if it already does, nothing). */
  setHand(i) {
    const w = this.me?.world;
    if (!w) return;
    const want = w.slot2 === i ? -1 : i;
    if (this.remote) this.remote({ op: 'hand', slot: want });
    else if (this.game) setRightHand(this.game, this.me, want < 0 ? 'x' : String(want), true);
    this.refresh(true);
  }

  split(box, i) {
    this.picked = null;
    if (this.remote) this.remote({ op: 'split', a: [box, i] }); else this.box(box)?.split(i);
    this.refresh(true);
  }

  /** Everything from one to the other (as much as fits). from: the first slot to send things into. */
  everything(a, b, from = 0) {
    if (!a || !b) return;
    for (let i = a === this.inv ? HOTBAR : 0; i < a.slots.length; i++) send(a, i, b, from);
    this.picked = null;
    this.refresh(true);
  }

  describe(box, i) {
    const s = this.box(box)?.slots[i], it = s && itemOf(s.key);
    this.whatEl.textContent = it ? `${it.name}${s.n > 1 ? ` × ${s.n}` : ''}${whatFor(it)}` : '';
  }

  /** The card for a stack ({ key, n }) the mouse is over (e: the mouse event, for where). */
  tipFor(stack, e) {
    const it = stack && itemOf(stack.key);
    if (!it) { this.hideTip(); return; }
    const d = itemDetails(it, stack.n || 1);
    this.tipEl.innerHTML = `<div class="tip-name" style="color:${d.color}">${esc(d.name)}${stack.n > 1 ? ` <small>× ${stack.n}</small>` : ''}</div>
      <div class="tip-kind">${esc(d.kind)}</div>
      ${d.lines.map(l => `<div class="tip-line">${esc(l)}</div>`).join('')}
      ${d.worth ? `<div class="tip-worth">${esc(d.worth)}</div>` : ''}
      ${d.made ? `<div class="tip-made">${esc(d.made)}</div>` : ''}`;
    this.tipEl.classList.remove('hidden');
    this.moveTip(e);
  }

  /** The card beside the mouse (inside the screen). */
  moveTip(e) {
    if (!e || this.tipEl.classList.contains('hidden')) return;
    const box = this.root.getBoundingClientRect(), w = this.tipEl.offsetWidth, h = this.tipEl.offsetHeight;
    let x = e.clientX - box.left + 18, y = e.clientY - box.top + 14;
    if (x + w > box.width - 6) x = e.clientX - box.left - w - 14;
    if (y + h > this.root.scrollHeight - 6) y = Math.max(6, e.clientY - box.top - h - 10);
    this.tipEl.style.left = `${Math.max(6, x)}px`;
    this.tipEl.style.top = `${y + this.root.scrollTop}px`;
  }

  hideTip() { this.tipEl?.classList.add('hidden'); }

  /** Bring the slots and the recipes up to date (only when something's changed, unless `force`). */
  refresh(force = false) {
    const inv = this.inv, me = this.me;
    if (!inv || !this.game?.world) return;
    const near = stationsNear(this.game.world, me.x, me.y - 8, this.near);
    const seen = `${inv.version}|${this.chest?.inv.version ?? ''}|${[...near].join()}|${me.world.slot}|${me.world.slot2}|${this.picked ? `${this.picked.box}${this.picked.i}` : ''}|${this.onlyEl.checked}|${this.findEl.value}`;
    if (!force && seen === this.seen) return;
    this.seen = seen;
    for (const b of this.slots) {
      const box = b.dataset.box, i = +b.dataset.slot, from = this.box(box);
      if (!from) continue;
      const s = from.slots[i], it = s && itemOf(s.key);
      const look = s ? `${s.key}|${s.n}|${s.mag ?? ''}` : '';
      b.classList.toggle('picked', this.picked?.box === box && this.picked.i === i);
      b.classList.toggle('in-hand', box === 'me' && i === me.world.slot);
      b.classList.toggle('in-right', box === 'me' && i === me.world.slot2);
      b.classList.toggle('empty', !s);
      if (b.dataset.look === look) continue;
      b.dataset.look = look;
      b.dataset.cat = it ? categoryOf(it) : '';
      b.querySelector('.inv-n').textContent = s && (s.n > 1 || it?.kind === 'block') ? String(s.n) : s?.mag != null ? `${s.mag}` : '';
      const cv = b.querySelector('canvas');
      cv.classList.toggle('ink', it?.kind === 'weapon');
      paint(cv, it);
    }
    for (const h of this.hands) {
      const i = +h.dataset.hand;
      h.classList.toggle('on', i === me.world.slot2);
      h.disabled = itemOf(inv.slots[i]?.key)?.kind === 'weapon';
    }
    // The recipes: what can be made now first, then what's short of something, then what needs a station not here.
    this.nearEl.textContent = near.size ? `at ${[...near].map(n => STATION_NAMES[n]).join(', ')}` : 'by hand (stand near a crafting station for more)';
    const coins = inv.count('coins');
    this.coinsEl.textContent = `${coins} coin${coins === 1 ? '' : 's'}`;
    const only = this.onlyEl.checked, find = this.findEl.value.trim().toLowerCase(), order = [];
    for (const r of RECIPES) {
      const row = this.rows.get(r), times = timesCanMake(inv, r, near), here = !r.at || near.has(r.at);
      row.classList.toggle('can', times > 0);
      row.classList.toggle('away', !here);
      const found = !find || itemOf(r.key).name.toLowerCase().includes(find) || r.of.some(([k]) => itemOf(k)?.name.toLowerCase().includes(find));
      row.classList.toggle('hidden', (only && times === 0) || !found);
      row.disabled = times === 0;
      row.title = times > 0 ? `Make ${times > 1 ? `(up to ${times} times; shift-click: five)` : ''}` : !here ? `Needs a ${STATION_NAMES[r.at].toLowerCase()} near you` : `Needs ${madeFrom(r)}`;
      order.push([times > 0 ? 0 : here ? 1 : 2, AT_ORDER.indexOf(r.at), r.id, row]);
    }
    order.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const want = order.map(o => o[3]);
    const kids = this.listEl.children;
    let same = kids.length === want.length;
    for (let i = 0; same && i < want.length; i++) same = kids[i] === want[i];
    if (!same) this.listEl.append(...want);
  }

  /** A key while the screen is open: true if it was the screen's. */
  key(code) {
    if (code === 'Escape' || isKey('inventory', keyOf(code))) { this.onClose(); return true; }
    // A number: what the mouse is over, into that hotbar slot (swapped with what's there).
    const m = /^Digit(\d)$/.exec(code);
    if (m && this.hover && this.box(this.hover.box)?.slots[this.hover.i]) {
      const to = (+m[1] + 9) % 10;
      const { box, i } = this.hover;
      if (box === 'me' && i === to) return true;
      if (this.remote) this.remote({ op: 'move', a: [box, i], b: ['me', to] });
      else moveBetween(this.box(box), i, this.inv, to);
      this.picked = null;
      this.refresh(true);
      this.tipFor(this.box(box)?.slots[i], null);
      return true;
    }
    return false;
  }
}

// (Moving stacks between inventories: items.js.)
export const moveBetween = (a, i, b, j) => Inventory.moveBetween(a, i, b, j);
export const send = (a, i, b, from = 0) => Inventory.send(a, i, b, from);

/** What an item is for, after its name. */
function whatFor(it) {
  switch (it.kind) {
    case 'tool': return it.tool === 'hammer' ? ': shapes blocks into halves and ramps, takes down walls' : it.tool === 'axe' ? ': fells trees, breaks wooden things' : `: mines blocks (tier ${it.tier})`;
    case 'block': return ': a block to build with';
    case 'wall': return ': a wall, built behind';
    case 'ammo': return ': ammunition';
    case 'material': return ': for crafting';
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
    const k = def.look.type === 'held' ? cv.height / 20 : Math.min(cv.height / 18, (cv.width - 14) / (L + 8));
    ctx.translate(cv.width / 2, cv.height / 2);
    ctx.scale(k, k);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawWeapon(ctx, def, true);
    return;
  }
  const w = Math.min(cv.width, cv.height) * 0.7;
  drawIcon(ctx, it, cv.width / 2 - w / 2, cv.height / 2 - w / 2, w, false, true);
}
