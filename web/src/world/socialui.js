// Playing together's screens (world mode, online: social.js): the menu for another player you've
// right clicked on (party, trade), and the trade: what you're offering (click your things to put
// them on the table or take them off; coins), what they're offering, and accepting it.

import { itemOf } from './items.js';
import { drawIcon } from './worldrender.js';
import { WEAPONS } from '../weapons.js';
import { drawWeapon } from '../sprites.js';
import { itemColor, itemDetails } from './iteminfo.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** A player's menu: { id, name, level, options: [{ op, label }] } shown; pick(op) when one's picked. */
export class PlayerMenu {
  constructor(root, { pick, close }) {
    this.root = root;
    this.onPick = pick;
    this.onClose = close;
    this.view = null;
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-op]');
      if (b) this.onPick(this.view, b.dataset.op);
      else if (e.target.closest('[data-close]')) this.onClose();
    });
  }

  get open() { return !this.root.classList.contains('hidden'); }

  show(view) {
    this.view = view;
    this.root.innerHTML = `<div class="buy-head"><h2>${esc(view.name)}</h2><span class="muted-note">Level ${view.level}</span>
      <button type="button" class="buy-close" data-close>Close <kbd>Esc</kbd></button></div>
      <div class="talk-options">${view.options.map((o, i) => `<button type="button" class="talk-opt" data-op="${o.op}"><kbd>${i + 1}</kbd> ${esc(o.label)}</button>`).join('')}</div>`;
    this.root.classList.remove('hidden');
  }

  hide() { this.root.classList.add('hidden'); this.view = null; }

  key(code) {
    if (code === 'Escape') { this.onClose(); return true; }
    const m = /^Digit([1-9])$/.exec(code), o = m && this.view?.options[+m[1] - 1];
    if (o) { this.onPick(this.view, o.op); return true; }
    return false;
  }
}

/** The trade screen: offer(slots, coins), accept(), cancel(). */
export class TradeScreen {
  constructor(root, { offer, accept, cancel }) {
    this.root = root;
    this.onOffer = offer;
    this.onAccept = accept;
    this.onCancel = cancel;
    this.view = null;
    this.me = null;
    this.seen = '';
    root.innerHTML = `
      <div class="buy-head"><h2 data-title>Trading</h2>
        <button type="button" class="buy-close" data-cancel>Call it off <kbd>Esc</kbd></button></div>
      <div class="trade-cols">
        <div><h3 class="inv-label">You offer <span class="trade-ok" data-my-ok></span></h3><div class="trade-table" data-mine></div>
          <label class="trade-coins">Coins <input type="number" min="0" step="1" value="0" data-coins></label></div>
        <div><h3 class="inv-label"><span data-them>They</span> offer <span class="trade-ok" data-their-ok></span></h3><div class="trade-table" data-theirs></div>
          <div class="trade-coins" data-their-coins></div></div>
      </div>
      <h3 class="inv-label">Your things (click to put on the table, or take off)</h3>
      <div class="trade-bag" data-bag></div>
      <div class="inv-actions"><button type="button" data-accept>Accept</button><span class="buy-foot">When you've both accepted, it's done. Anything changed, and you both accept again.</span></div>`;
    this.mineEl = root.querySelector('[data-mine]');
    this.theirsEl = root.querySelector('[data-theirs]');
    this.bagEl = root.querySelector('[data-bag]');
    this.coinsEl = root.querySelector('[data-coins]');
    root.querySelector('[data-cancel]').addEventListener('click', () => this.onCancel());
    root.querySelector('[data-accept]').addEventListener('click', () => this.onAccept());
    this.coinsEl.addEventListener('change', () => this.send());
    this.coinsEl.addEventListener('keydown', e => e.stopPropagation());
    this.bagEl.addEventListener('click', e => {
      const b = e.target.closest('[data-slot]');
      if (!b) return;
      const i = +b.dataset.slot, mine = this.offered();
      const at = mine.findIndex(([j]) => j === i);
      if (at >= 0) mine.splice(at, 1); else mine.push([i, this.me.world.inv.slots[i]?.n || 1]);
      this.send(mine);
    });
  }

  get open() { return !this.root.classList.contains('hidden'); }

  /** What I'm offering now: [[slot, n]]. */
  offered() { return (this.view?.mine.items || []).map(([, n, i]) => [i, n]); }

  send(slots = this.offered()) { this.onOffer(slots, Math.max(0, this.coinsEl.value | 0)); }

  show(view, me) {
    const fresh = !this.open;
    this.view = view;
    this.me = me;
    if (fresh) { this.coinsEl.value = String(view.mine.coins || 0); this.root.classList.remove('hidden'); }
    this.refresh(true);
  }

  hide() { this.root.classList.add('hidden'); this.view = null; }

  refresh(force = false) {
    const v = this.view, inv = this.me?.world?.inv;
    if (!v || !inv) return;
    const key = `${v.v}|${inv.version}`;
    if (!force && key === this.seen) return;
    this.seen = key;
    this.root.querySelector('[data-title]').textContent = `Trading with ${v.with}`;
    this.root.querySelector('[data-them]').textContent = v.with;
    this.root.querySelector('[data-my-ok]').textContent = v.mine.ok ? '✓ accepted' : '';
    this.root.querySelector('[data-their-ok]').textContent = v.theirs.ok ? '✓ accepted' : '';
    if (document.activeElement !== this.coinsEl) this.coinsEl.value = String(v.mine.coins || 0);
    this.root.querySelector('[data-their-coins]').textContent = v.theirs.coins ? `and ${v.theirs.coins} coins` : '';
    // (Gear shows what it is: its own name in its rarity's colour, and its card when pointed at.)
    const tip = (it, g) => { const d = it && g ? itemDetails(it, 1, g) : null; return d ? `${d.name}\n${d.lines.join('\n')}` : it?.name ?? ''; };
    const row = ([key, n, , g]) => { const it = itemOf(key); return `<div class="trade-item" title="${esc(tip(it, g))}"><canvas width="32" height="22" data-key="${esc(key)}"></canvas><span style="color:${itemColor(it, g)}">${esc(g?.name ?? it?.name ?? key)}</span>${n > 1 ? ` <small>× ${n}</small>` : ''}</div>`; };
    this.mineEl.innerHTML = v.mine.items.length ? v.mine.items.map(row).join('') : '<p class="muted-note">Nothing yet</p>';
    this.theirsEl.innerHTML = v.theirs.items.length ? v.theirs.items.map(row).join('') : '<p class="muted-note">Nothing yet</p>';
    const on = new Set(v.mine.items.map(x => x[2]));
    this.bagEl.innerHTML = inv.slots.map((s, i) => (s && itemOf(s.key)?.kind !== 'quest' && s.key !== 'coins' ? `<button type="button" class="trade-slot${on.has(i) ? ' on' : ''}" data-slot="${i}" title="${esc(tip(itemOf(s.key), s.g))}"${s.g ? ` style="border-color:${itemColor(itemOf(s.key), s.g)}"` : ''}><canvas width="32" height="22" data-key="${esc(s.key)}"></canvas><small>${s.n > 1 ? s.n : ''}</small></button>` : '')).join('');
    for (const cv of this.root.querySelectorAll('canvas[data-key]')) paint(cv, itemOf(cv.dataset.key));
  }

  key(code) {
    if (code === 'Escape') { this.onCancel(); return true; }
    return false;
  }
}

function paint(cv, it) {
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!it) return;
  if (it.kind === 'weapon') {
    const def = WEAPONS[it.weapon], L = def.look.length || 12, k = Math.min(cv.height / 18, (cv.width - 6) / (L + 8));
    ctx.save(); ctx.translate(cv.width / 2, cv.height / 2); ctx.scale(k, k); drawWeapon(ctx, def, true); ctx.restore();
    return;
  }
  const w = Math.min(cv.width, cv.height) * 0.85;
  drawIcon(ctx, it, cv.width / 2 - w / 2, cv.height / 2 - w / 2, w, false, true);
}
