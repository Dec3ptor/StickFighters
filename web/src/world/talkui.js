// The talk screen (world mode): who you're talking to (their face, name, work and town), what
// they say, and what they'll do for you (talk.js): buttons for each (or the number keys), and,
// with a shopkeeper, their shop: what they have for sale today (click to buy a lot) and the
// things you have that they'd buy (click to sell one, shift-click the whole stack). The game
// carries on while it's open; your soldier stands and talks.

import { itemOf } from './items.js';
import { WEAPONS } from '../weapons.js';
import { drawWeapon } from '../sprites.js';
import { drawIcon } from './worldrender.js';
import { offerForSlot, buysAny } from './trade.js';
import { itemColor, itemDetails } from './iteminfo.js';
import { sellScale } from './progress.js';
import { rewardText } from './questui.js';
import { drawSkinHead, TUNICS } from '../skins.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class TalkScreen {
  /** root: the screen's element. act(d): something done in the talk (talk.js's talkDo); close(): it was closed. */
  constructor(root, { act, close }) {
    this.root = root;
    this.onAct = act;
    this.onClose = close;
    this.view = null;
    this.me = null;
    this.trading = false;
    this.seen = '';
    this.build();
  }

  get open() { return !this.root.classList.contains('hidden'); }

  build() {
    this.root.innerHTML = `
      <div class="buy-head talk-head">
        <canvas class="talk-face" width="72" height="72" aria-hidden="true"></canvas>
        <div class="talk-who">
          <h2 data-name></h2>
          <div class="talk-title" data-title></div>
        </div>
        <button type="button" class="buy-close" data-close>Goodbye <kbd>Esc</kbd></button>
      </div>
      <p class="talk-said" data-said></p>
      <ul class="talk-news hidden" data-news></ul>
      <div class="talk-options" data-options></div>
      <div class="talk-work hidden" data-work></div>
      <div class="talk-shop hidden" data-shop>
        <div class="talk-cols">
          <div>
            <h3 class="inv-label"><span data-shop-name></span> <span class="talk-coins" data-coins></span></h3>
            <div class="talk-list" data-stock></div>
          </div>
          <div>
            <h3 class="inv-label">Sell to them</h3>
            <div class="talk-list" data-sell></div>
          </div>
        </div>
        <p class="buy-foot">Click something for sale to buy it (a lot at a time) &middot; your things: click sells one, shift-click the whole stack &middot; the stock changes every day</p>
      </div>`;
    this.root.querySelector('[data-close]').addEventListener('click', () => this.onClose());
    this.face = this.root.querySelector('.talk-face');
    this.nameEl = this.root.querySelector('[data-name]');
    this.titleEl = this.root.querySelector('[data-title]');
    this.saidEl = this.root.querySelector('[data-said]');
    this.newsEl = this.root.querySelector('[data-news]');
    this.optionsEl = this.root.querySelector('[data-options]');
    this.shopEl = this.root.querySelector('[data-shop]');
    this.stockEl = this.root.querySelector('[data-stock]');
    this.sellEl = this.root.querySelector('[data-sell]');
    this.coinsEl = this.root.querySelector('[data-coins]');
    this.shopNameEl = this.root.querySelector('[data-shop-name]');
    this.workEl = this.root.querySelector('[data-work]');
    this.workEl.addEventListener('click', e => {
      const b = e.target.closest('[data-accept]');
      if (b) this.onAct({ op: 'accept', id: b.dataset.accept });
    });
  }

  /** Open (or bring up to date) for `view` (talk.js's talkView), `me`: our soldier (our things). */
  show(view, me) {
    const fresh = !this.open || this.view?.id !== view.id;
    this.view = view;
    this.me = me;
    if (fresh) {
      this.trading = false;
      this.working = false;
      this.paintFace(view.skin);
      this.root.classList.remove('hidden');
    }
    this.refresh(fresh);
  }

  hide() {
    this.root.classList.add('hidden');
    this.view = null;
    this.trading = false;
  }

  paintFace(skin) {
    const ctx = this.face.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.face.width, this.face.height);
    ctx.setTransform(6, 0, 0, 6, this.face.width / 2, this.face.height / 2 + 4);
    // (Shoulders in their tunic, then the head.)
    ctx.strokeStyle = TUNICS[skin] || '#888';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-4.5, 7); ctx.quadraticCurveTo(0, 3.5, 4.5, 7); ctx.stroke();
    drawSkinHead(ctx, { x: 0, y: -1, r: 4.2 }, skin, 1, { ink: '#1a1a1a', lw: 0.7, fill: '#fff', accent: TUNICS[skin] || '#888', tick: 0 });
  }

  /** Bring it up to date (only if something's changed, unless `force`). */
  refresh(force = false) {
    const v = this.view, inv = this.me?.world?.inv;
    if (!v || !inv) return;
    const key = `${v.v}|${v.coins}|${inv.version}|${this.trading}|${this.working}|${JSON.stringify(v.shop?.stock || null)}|${(v.news || []).length}|${v.options.map(o => `${o.op}${o.id || ''}${o.price || 0}`).join()}|${v.quests?.offers.map(q => q.id).join()}`;
    if (!force && key === this.seen) return;
    this.seen = key;
    this.nameEl.textContent = v.name;
    this.titleEl.textContent = `${v.title} of ${v.town}${v.kind === 'city' ? ' (a city)' : ''}`;
    this.saidEl.textContent = `“${v.said}”`;
    this.newsEl.classList.toggle('hidden', !v.news?.length);
    this.newsEl.innerHTML = (v.news || []).map(n => `<li>${esc(n)}</li>`).join('');
    // What they'll do: the number keys pick them too.
    this.optionsEl.innerHTML = v.options.map((o, i) => `<button type="button" class="talk-opt${(o.op === 'trade' && this.trading) || (o.op === 'work' && this.working) ? ' on' : ''}${o.op === 'turnin' ? ' turnin' : ''}" data-op="${o.op}" data-id="${esc(o.id || '')}"><kbd>${i + 1}</kbd> ${esc(o.label)}${o.price ? ` <span class="talk-price">${o.price} coins</span>` : ''}</button>`).join('');
    for (const b of this.optionsEl.querySelectorAll('[data-op]')) b.addEventListener('click', () => this.pick(b.dataset.op, b.dataset.id));
    // Their work (quests.js): what each asks, and what it pays.
    const offers = v.quests?.offers || [];
    this.workEl.classList.toggle('hidden', !this.working || !offers.length);
    if (this.working && offers.length) {
      this.workEl.innerHTML = offers.map(q => `<div class="talk-quest${q.kind === 'story' ? ' story' : q.kind === 'personal' ? ' personal' : ''}">
        <div class="tq-title">${q.kind === 'story' ? `<span class="tq-badge">★ The story${q.step ? `, part ${q.step}` : ''}</span> ` : q.kind === 'personal' ? `<span class="tq-badge">${esc(v.name)}'s own${q.of ? `, ${q.step} of ${q.of}` : ''}</span> ` : ''}${esc(q.title)}</div>
        <p class="tq-text">“${esc(q.text)}”</p>
        <ul class="tq-goals">${q.goals.map(g => `<li>${esc(g)}</li>`).join('')}</ul>
        <div class="tq-foot"><span class="jq-reward">${esc(rewardText(q.reward))}</span>
        <button type="button" data-accept="${esc(q.id)}" ${v.quests.full ? 'disabled title="Your journal is full: finish or give up a quest first"' : ''}>Accept</button></div>
      </div>`).join('');
    }
    // The shop.
    const shop = v.shop;
    this.shopEl.classList.toggle('hidden', !shop || !this.trading);
    if (!shop || !this.trading) return;
    const coins = inv.count('coins');
    this.shopNameEl.textContent = shop.name;
    this.coinsEl.textContent = `You have ${coins} coin${coins === 1 ? '' : 's'}`;
    this.stockEl.innerHTML = shop.stock.length ? shop.stock.map((o, i) => {
      const it = itemOf(o.key);
      if (!it) return '';
      const can = o.left > 0 && coins >= o.price, d = o.g ? itemDetails(it, 1, o.g) : null;
      return `<button type="button" class="talk-row${o.rare ? ' rare' : ''}" data-buy="${i}" ${o.left > 0 ? '' : 'disabled'} title="${esc(d ? `${d.name}\n${d.lines.join('\n')}` : `${it.name}${o.rare ? ' (rare)' : ''}`)}">
        <canvas width="40" height="28" aria-hidden="true"></canvas>
        <span class="talk-item"${o.g ? ` style="color:${itemColor(it, o.g)}"` : ''}>${esc(o.g?.name || it.name)}${o.n > 1 ? ` <small>× ${o.n}</small>` : ''}${o.rare ? ' <small class="talk-rare">rare</small>' : ''}</span>
        <span class="talk-price${can ? '' : ' short'}">${o.price}</span>
        <span class="talk-left">${o.left > 0 ? `${o.left} left` : 'sold out'}</span>
      </button>`;
    }).join('') : '<p class="muted-note">Nothing for sale today.</p>';
    for (const b of this.stockEl.querySelectorAll('[data-buy]')) {
      const o = shop.stock[+b.dataset.buy];
      paint(b.querySelector('canvas'), itemOf(o.key));
      b.addEventListener('click', () => this.onAct(o.slot ? { op: 'buy', key: o.key, slot: o.slot } : { op: 'buy', key: o.key }));
    }
    // Our things they'd buy (each stack: what one, or the lot, fetches).
    const rows = [];
    const haggle = sellScale(this.me);
    inv.slots.forEach((s, i) => {
      if (!s || !buysAny(shop.role, s.key)) return;
      const one = offerForSlot(shop.role, s, 1, haggle), all = offerForSlot(shop.role, s, s.n, haggle);
      rows.push({ i, s, one, all });
    });
    this.sellEl.innerHTML = rows.length ? rows.map(r => {
      const it = itemOf(r.s.key);
      return `<button type="button" class="talk-row" data-sell="${r.i}" ${r.all > 0 ? '' : 'disabled'} title="Click: sell one · shift-click: sell all ${r.s.n}">
        <canvas width="40" height="28" aria-hidden="true"></canvas>
        <span class="talk-item"${r.s.g ? ` style="color:${itemColor(it, r.s.g)}"` : ''}>${esc(r.s.g?.name || it.name)}${r.s.n > 1 ? ` <small>× ${r.s.n}</small>` : ''}</span>
        <span class="talk-price">${r.one > 0 ? r.one : '–'}</span>
        <span class="talk-left">${r.s.n > 1 ? `all: ${r.all}` : ''}</span>
      </button>`;
    }).join('') : '<p class="muted-note">You have nothing they\'d buy.</p>';
    for (const b of this.sellEl.querySelectorAll('[data-sell]')) {
      const i = +b.dataset.sell;
      paint(b.querySelector('canvas'), itemOf(inv.slots[i].key));
      b.addEventListener('click', e => this.onAct({ op: 'sell', i, all: e.shiftKey }));
    }
  }

  /** One of their options picked (a button, or its number key). id: the quest, for a hand-in. */
  pick(op, id = '') {
    if (op === 'bye') { this.onClose(); return; }
    if (op === 'trade') { this.trading = !this.trading; this.working = false; this.refresh(true); return; }
    if (op === 'work') { this.working = !this.working; this.trading = false; this.refresh(true); return; }
    this.onAct(id ? { op, id } : { op });
  }

  /** A key while the screen is open: true if it was the screen's. */
  key(code) {
    if (code === 'Escape') { this.onClose(); return true; }
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    if (m && this.view) {
      const o = this.view.options[+m[1] - 1];
      if (o) { this.pick(o.op, o.id); return true; }
    }
    return false;
  }
}

/** An item's picture. */
function paint(cv, it) {
  const ctx = cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!it) return;
  if (it.kind === 'weapon') {
    const def = WEAPONS[it.weapon], L = def.look.length || 12;
    const k = def.look.type === 'held' ? cv.height / 20 : Math.min(cv.height / 18, (cv.width - 10) / (L + 8));
    ctx.translate(cv.width / 2, cv.height / 2);
    ctx.scale(k, k);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawWeapon(ctx, def, true);
    cv.classList.add('ink');
    return;
  }
  cv.classList.remove('ink');
  const w = Math.min(cv.width, cv.height) * 0.8;
  drawIcon(ctx, it, cv.width / 2 - w / 2, cv.height / 2 - w / 2, w, false, true);
}
