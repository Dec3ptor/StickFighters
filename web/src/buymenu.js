// The Defuse mode's buy menu (B): weapons and gear in columns, as Counter-Strike's
// is laid out. Click, or press a column's number then an item's. What you can't buy
// says why (not enough money, the other side's, buy time over...). The game checks
// again when you buy (online, the host does).

import { SHOP, GEAR, whyNot, moneyOf, sideOf, sideOnly, costOf, canShop, kindOf, SIDE_NAME } from './defuse.js';
import { WEAPONS } from './weapons.js';
import { drawWeapon } from './sprites.js';
import { isKey, keyOf, keyLabel } from './keys.js';

const money = n => `$${Math.round(n).toLocaleString('en-US')}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class BuyMenu {
  /** root: the menu's element; buy(id): buy item id; close(): it was closed. */
  constructor(root, { buy, close }) {
    this.root = root;
    this.onBuy = buy;
    this.onClose = close;
    this.col = null;      // the column picked with a number key, waiting for the item's number
    this.items = new Map();
    this.build();
  }

  get open() { return !this.root.classList.contains('hidden'); }

  build() {
    const r = this.root;
    r.innerHTML = `
      <div class="buy-head">
        <h2>Buy menu</h2>
        <span class="buy-money" data-money></span>
        <span class="buy-time" data-time></span>
        <button type="button" class="buy-close" data-close>Close <kbd data-buy-key>B</kbd></button>
      </div>
      <div class="buy-cols">${SHOP.map((col, i) => `
        <section class="buy-col" data-col="${i}">
          <h3><kbd>${i + 1}</kbd> ${esc(col.name)}</h3>
          ${col.items.map((id, j) => {
            const name = GEAR[id]?.name ?? WEAPONS[id]?.name ?? id;
            return `<button type="button" class="buy-item" data-item="${id}">
              <kbd>${j + 1}</kbd><canvas width="72" height="30" aria-hidden="true"></canvas>
              <span class="buy-name">${esc(name)}</span><span class="buy-price"></span><span class="buy-note"></span>
            </button>`;
          }).join('')}
        </section>`).join('')}
      </div>
      <p class="buy-foot">Number keys: a column, then an item &middot; buying a gun drops the one of that sort you had &middot; <kbd data-buy-key>B</kbd> or <kbd>Esc</kbd> to close</p>`;
    for (const b of r.querySelectorAll('.buy-item')) {
      this.items.set(b.dataset.item, b);
      drawIcon(b.querySelector('canvas'), b.dataset.item);
      b.addEventListener('click', () => this.onBuy(b.dataset.item));
    }
    r.querySelector('[data-close]').addEventListener('click', () => this.onClose());
    this.moneyEl = r.querySelector('[data-money]');
    this.timeEl = r.querySelector('[data-time]');
  }

  show(game, me) {
    this.col = null;
    // (The key that closes it, as set in Settings.)
    for (const k of this.root.querySelectorAll('[data-buy-key]')) k.textContent = keyLabel('buy');
    this.root.classList.remove('hidden');
    this.last = '';
    this.refresh(game, me);
  }

  hide() {
    this.root.classList.add('hidden');
    this.col = null;
  }

  /** Bring the money, buy time and what can be bought up to date (cheap: only what changed). */
  refresh(game, me) {
    const st = game.modeState;
    const key = [moneyOf(game, me), Math.ceil((st?.buy || 0) / 60), me.armour, Object.keys(me.weapons).join(), JSON.stringify(st?.gear?.[me.id] ?? 0), sideOf(game, me.team), this.col, canShop(game, me)].join('|');
    if (key === this.last) return;
    this.last = key;
    this.moneyEl.textContent = money(moneyOf(game, me));
    const left = Math.ceil((st?.buy || 0) / 60);
    this.timeEl.textContent = left > 0 ? `Buy time ${left}s` : 'Buy time is over';
    this.root.dataset.side = sideOf(game, me.team);
    for (const [id, b] of this.items) {
      const why = whyNot(game, me, id);
      const owned = kindOf(id) !== 'grenade' && kindOf(id) !== 'gear' ? me.has(id) : false;
      b.disabled = !!why;
      b.classList.toggle('owned', owned);
      b.classList.toggle('poor', why === 'Not enough money');
      b.classList.toggle('other-side', !!sideOnly(id) && sideOnly(id) !== sideOf(game, me.team));
      b.querySelector('.buy-price').textContent = money(costOf(game, me, id));
      b.querySelector('.buy-note').textContent = owned ? 'Owned' : why && why !== 'Not enough money' ? why : sideOnly(id) ? SIDE_NAME[sideOnly(id)] : '';
      b.title = why || `Buy the ${GEAR[id]?.name ?? WEAPONS[id]?.name}`;
    }
    for (const sec of this.root.querySelectorAll('.buy-col')) sec.classList.toggle('picked', +sec.dataset.col === this.col);
  }

  /** A key while the menu is open: true if it was the menu's. */
  key(code, game, me) {
    if (code === 'Escape' || isKey('buy', keyOf(code))) { this.onClose(); return true; }
    const n = /^(?:Digit|Numpad)([0-9])$/.exec(code);
    if (!n) return false;
    const k = +n[1] - 1;
    if (this.col == null) {
      if (k >= 0 && k < SHOP.length) this.col = k;
    } else {
      const id = SHOP[this.col].items[k];
      this.col = null;
      if (id) this.onBuy(id);
    }
    this.last = '';
    this.refresh(game, me);
    return true;
  }
}

/** A little picture of an item for its button. */
function drawIcon(cv, id) {
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.save();
  ctx.translate(cv.width / 2, cv.height / 2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const def = WEAPONS[id];
  if (def) {
    const L = def.look.length || 12;
    const k = def.look.type === 'held' ? 2.6 : Math.min(2.4, 56 / (L + 8));
    ctx.scale(k, k);
    drawWeapon(ctx, def, true);
  } else {
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.6;
    if (id === 'kevlar' || id === 'helmet') {
      // A vest (and a helmet over it).
      ctx.fillStyle = '#5b6b47';
      ctx.beginPath();
      ctx.moveTo(-10, -9); ctx.lineTo(-4, -11); ctx.quadraticCurveTo(0, -6, 4, -11); ctx.lineTo(10, -9); ctx.lineTo(9, 11); ctx.lineTo(-9, 11); ctx.closePath();
      ctx.fill(); ctx.stroke();
      if (id === 'helmet') {
        ctx.fillStyle = '#4c5a3c';
        ctx.beginPath(); ctx.arc(19, 2, 8, Math.PI, 0); ctx.lineTo(28, 4); ctx.lineTo(10, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    } else if (id === 'kit') {
      // A defuse kit: a pouch with pliers.
      ctx.fillStyle = '#2f3a52';
      ctx.beginPath(); ctx.rect(-11, -6, 22, 14); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#c9ccd1';
      ctx.beginPath(); ctx.moveTo(-4, -12); ctx.lineTo(2, -2); ctx.moveTo(4, -12); ctx.lineTo(-2, -2); ctx.stroke();
    }
  }
  ctx.restore();
}
