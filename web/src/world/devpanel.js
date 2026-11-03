// The dev menu (worlds, in dev mode: P, main.js): a screen over the game (which carries on) with
// what devtools.js can do. You: god mode, invisible, flying or walking (and how fast), the
// lights, healing, a level, coins. The world: the time of day, monsters or none, clearing them
// away, a raid, going places. Summoning, where the crosshair was when it was opened: beasts (one,
// five or ten; named champions; on your side, to follow you and fight for you), a mercenary,
// strikes from the sky, an earthquake, a smiting, a supply crate. Gear rolled in any rarity. And
// for the host (or playing alone) the other players: going to them, bringing them here, healing
// them, dev mode for them, sending them away.

import { MONSTERS } from './monsters.js';
import { RARITY, RARITIES } from './gear.js';
import { SUMMONS, STRIKES, TIMES, devState } from './devtools.js';
import { keyLabel } from '../keys.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const btn = (act, label, extra = '', title = '') => `<button type="button" class="small" data-act="${act}"${extra}${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;

export class DevPanel {
  /**
   * root: the screen's element. act(act, arg): do it (here, or online, the host does);
   * kick(id): send a player away (the host); close(): it was closed.
   */
  constructor(root, { act, kick, close }) {
    this.root = root;
    this.onAct = act;
    this.onKick = kick;
    this.onClose = close;
    this.me = null;
    this.game = null;
    this.at = null;      // the crosshair's tile when it was opened: { x, y }
    this.n = 1;          // how many to summon
    this.ally = false;   // summoned on your side
    this.champ = false;  // named champions
    this.rarity = 'legendary';
    this.seen = '';
    this.build();
  }

  get open() { return !this.root.classList.contains('hidden'); }

  build() {
    this.root.innerHTML = `
      <div class="buy-head">
        <h2>Dev menu</h2>
        <span class="inv-what" data-say></span>
        <button type="button" class="buy-close" data-close>Close <kbd data-dev-key>P</kbd></button>
      </div>
      <div class="dp-grid">
        <section class="dp-box">
          <h3 class="inv-label">You</h3>
          <div class="dp-row">
            ${btn('god', 'God mode', ' data-on="god"', 'Nothing hurts you, and you can\'t die')}
            ${btn('invisible', 'Invisible', ' data-on="invisible"', 'Monsters don\'t see you, and nor do other players')}
            ${btn('fly', 'Flying', ' data-on="fly"', 'Through anything (off: walking, still in dev mode)')}
            ${btn('lights', 'Everything lit', ' data-on="lights"')}
          </div>
          <div class="dp-row"><span class="dp-sub">Flying speed</span>${[0.5, 1, 2, 4].map(v => btn('speed', `×${v === 0.5 ? '½' : v}`, ` data-arg="${v}" data-speed="${v}"`)).join('')}</div>
          <div class="dp-row">${btn('heal', 'Heal')}${btn('level', 'Level up')}${btn('coins', '999 coins')}</div>
        </section>
        <section class="dp-box">
          <h3 class="inv-label">The world</h3>
          <div class="dp-row"><span class="dp-sub">Time</span>${TIMES.map(([h, name]) => btn('time', name[0].toUpperCase() + name.slice(1), ` data-arg="${h}"`)).join('')}</div>
          <div class="dp-row">${btn('quiet', 'No monsters', ' data-on="quiet"')}${btn('clear', 'Clear monsters near')}${btn('raid', 'Raid the nearest town')}</div>
          <div class="dp-row"><span class="dp-sub">Go to</span>${[['start', 'Start'], ['surface', 'Surface'], ['deep', 'The deep'], ['west', 'Town west'], ['east', 'Town east'], ['bed', 'Your bed']].map(([p, l]) => btn('goto', l, ` data-arg="${p}"`)).join('')}</div>
        </section>
        <section class="dp-box">
          <h3 class="inv-label">Summon <span class="dp-where" data-where></span></h3>
          <div class="dp-row">${SUMMONS.map(t => btn('summon', esc(MONSTERS[t].name), ` data-type="${t}"`)).join('')}${btn('merc', 'Mercenary', '', 'A soldier who follows you and shoots monsters')}</div>
          <div class="dp-row">
            <span class="dp-sub">How many</span>${[1, 5, 10].map(n => `<button type="button" class="small" data-n="${n}">${n}</button>`).join('')}
            <label class="dp-check"><input type="checkbox" data-champ> Named champions</label>
            <label class="dp-check"><input type="checkbox" data-ally> On your side</label>
          </div>
          <div class="dp-row">${Object.entries(STRIKES).map(([id, l]) => btn('strike', esc(l), ` data-strike="${id}"`)).join('')}${btn('quake', 'Earthquake')}${btn('smite', 'Smite', '', 'A great blast, right there')}${btn('crate', 'Supply crate')}</div>
        </section>
        <section class="dp-box">
          <h3 class="inv-label">Gear</h3>
          <div class="dp-row">${RARITIES.filter(r => r !== 'basic').map(r => `<button type="button" class="small dp-rar" data-rar="${r}" style="--c:${RARITY[r].color}">${esc(RARITY[r].name)}</button>`).join('')}</div>
          <div class="dp-row">${btn('roll', 'Roll a piece of gear', ' data-weapon="0"')}${btn('roll', 'Roll a weapon', ' data-weapon="1"')}</div>
        </section>
        <section class="dp-box dp-wide" data-gm>
          <h3 class="inv-label">Players <span class="dp-where">(yours to see to)</span></h3>
          <div class="dp-players" data-players></div>
        </section>
      </div>`;
    this.sayEl = this.root.querySelector('[data-say]');
    this.whereEl = this.root.querySelector('[data-where]');
    this.playersEl = this.root.querySelector('[data-players]');
    this.gmEl = this.root.querySelector('[data-gm]');
    this.root.querySelector('[data-close]').addEventListener('click', () => this.onClose());
    this.root.querySelector('[data-champ]').addEventListener('change', e => { this.champ = e.target.checked; });
    this.root.querySelector('[data-ally]').addEventListener('change', e => { this.ally = e.target.checked; });
    this.root.addEventListener('click', e => {
      const n = e.target.closest('[data-n]');
      if (n) { this.n = +n.dataset.n; this.refresh(true); return; }
      const r = e.target.closest('[data-rar]');
      if (r) { this.rarity = r.dataset.rar; this.refresh(true); return; }
      const g = e.target.closest('[data-gm-op]');
      if (g) {
        const id = +g.dataset.id;
        if (g.dataset.gmOp === 'kick') this.onKick(id);
        else this.act('gm', { id, op: g.dataset.gmOp });
        return;
      }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act, at = this.at || {};
      let arg = b.dataset.arg ?? null;
      if (act === 'summon') arg = { type: b.dataset.type, n: this.n, ally: this.ally, champion: this.champ, ...at };
      else if (act === 'strike') arg = { id: b.dataset.strike, ...at };
      else if (act === 'smite' || act === 'crate') arg = { ...at };
      else if (act === 'roll') arg = { r: this.rarity, weapon: b.dataset.weapon === '1' };
      else if (act === 'time' || act === 'speed') arg = +arg;
      this.act(act, arg);
    });
  }

  act(act, arg) {
    this.onAct(act, arg);
    // (Online, the host's answer comes back a little later: refresh() each frame shows it then.)
    this.refresh(true);
  }

  /** Open, for soldier `me` in `game` (gm: the other players are theirs to see to): summoning goes where the crosshair is now. */
  show(me, game, gm = true) {
    this.me = me;
    this.game = game;
    this.gm = gm;
    const t = me.world?.target;
    this.at = t && Number.isInteger(t.tx) && Number.isInteger(t.ty) ? { x: t.tx, y: t.ty } : null;
    for (const k of this.root.querySelectorAll('[data-dev-key]')) k.textContent = keyLabel('devMenu');
    this.say('');
    this.root.classList.remove('hidden');
    this.refresh(true);
  }

  hide() { this.root.classList.add('hidden'); }

  /** Something to tell them, at the top. */
  say(text) { if (this.sayEl) this.sayEl.textContent = text || ''; }

  /** Brought up to date (only when something's changed, unless `force`). */
  refresh(force = false) {
    const me = this.me, g = this.game, st = devState(me);
    if (!me || !g) return;
    const others = g.soldiers.filter(o => o.world && !o.npc && o !== me);
    const seen = `${JSON.stringify(st)}|${g.world?.devQuiet ? 1 : 0}|${this.n}|${this.rarity}|${others.map(o => `${o.id}:${o.name}:${o.world?.dev ? 1 : 0}`).join()}|${this.gm}`;
    if (!force && seen === this.seen) return;
    this.seen = seen;
    const on = { ...st, quiet: !!g.world?.devQuiet };
    for (const b of this.root.querySelectorAll('[data-on]')) b.classList.toggle('on', !!on[b.dataset.on]);
    for (const b of this.root.querySelectorAll('[data-speed]')) b.classList.toggle('on', +b.dataset.speed === (st?.speed || 1));
    for (const b of this.root.querySelectorAll('[data-n]')) b.classList.toggle('on', +b.dataset.n === this.n);
    for (const b of this.root.querySelectorAll('[data-rar]')) b.classList.toggle('on', b.dataset.rar === this.rarity);
    this.whereEl.textContent = this.at ? '(where the crosshair was)' : '(next to you)';
    // The other players: the host's (or one playing alone's: nobody, then) to see to.
    this.gmEl.classList.toggle('hidden', !this.gm);
    this.playersEl.innerHTML = others.length ? others.map(o => `<div class="dp-player"><span class="dp-name">${esc(o.name)}${o.world?.dev ? ' <small>(dev mode)</small>' : ''}</span>
      ${['goto:Go to', 'bring:Bring here', 'heal:Heal', `dev:${o.world?.dev ? 'Dev mode off' : 'Dev mode on'}`, 'kick:Send away'].map(p => { const [op, l] = p.split(':'); return `<button type="button" class="small" data-gm-op="${op}" data-id="${o.id}">${l}</button>`; }).join('')}</div>`).join('')
      : '<p class="muted-note">Nobody else is here. (Host your world, Worlds tab, and what other players do is yours to see to.)</p>';
  }

  /** A key while it's open: true if it was the screen's. */
  key(code, isDevKey) {
    if (code === 'Escape' || isDevKey) { this.onClose(); return true; }
    return false;
  }
}
