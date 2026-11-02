// The journal (world mode, J): your quests (quests.js), each with who gave it, what they said, its
// goals and how far along they are, and what it pays; follow one (the HUD shows its goals and
// which way to go) or give it up. And your character (progress.js): your level, experience, perk
// points to spend on perks, and what you've done. The game carries on while it's open.

import { itemOf } from './items.js';
import { goalText, goalMet, questReady, MAX_QUESTS } from './quests.js';
import { PERKS, xpToNext, MAX_LEVEL, maxHealthOf } from './progress.js';
import { keyLabel } from '../keys.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** A quest's reward, in words. */
export function rewardText(rw = {}) {
  return [rw.coins ? `${rw.coins} coins` : '', rw.xp ? `${rw.xp} XP` : '', ...(rw.items || []).map(([k, n]) => `${n > 1 ? `${n} × ` : ''}${itemOf(k)?.name ?? k}`)].filter(Boolean).join(' · ');
}

export class JournalScreen {
  /** root: the screen's element. act(d): { op: 'qtrack' | 'qdrop' | 'perk', id }; close(): it was closed. */
  constructor(root, { act, close }) {
    this.root = root;
    this.onAct = act;
    this.onClose = close;
    this.tab = 'quests';
    this.me = null;
    this.seen = '';
    this.root.innerHTML = `
      <div class="buy-head">
        <h2>Journal</h2>
        <div class="journal-tabs">
          <button type="button" class="journal-tab" data-tab="quests">Quests</button>
          <button type="button" class="journal-tab" data-tab="character">Character</button>
        </div>
        <button type="button" class="buy-close" data-close>Close <kbd data-journal-key>J</kbd></button>
      </div>
      <div class="journal-body" data-body></div>`;
    this.body = this.root.querySelector('[data-body]');
    this.root.querySelector('[data-close]').addEventListener('click', () => this.onClose());
    for (const b of this.root.querySelectorAll('[data-tab]')) b.addEventListener('click', () => { this.tab = b.dataset.tab; this.refresh(true); });
    this.body.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      this.onAct({ op: b.dataset.act, id: b.dataset.id });
      setTimeout(() => this.refresh(true), 0);
    });
  }

  get open() { return !this.root.classList.contains('hidden'); }

  /** Open (tab: 'quests' or 'character'), for soldier `me`. */
  show(me, tab = null) {
    this.me = me;
    if (tab) this.tab = tab;
    for (const k of this.root.querySelectorAll('[data-journal-key]')) k.textContent = keyLabel('journal');
    this.root.classList.remove('hidden');
    this.refresh(true);
  }

  hide() { this.root.classList.add('hidden'); }

  refresh(force = false) {
    const w = this.me?.world;
    if (!w) return;
    const p = w.prog, qs = w.quests;
    const key = `${this.tab}|${qs?.v}|${qs?.track}|${qs?.list.length}|${p?.level}|${p?.xp}|${p?.points}|${JSON.stringify(p?.perks || {})}|${w.inv.version}|${w.partyList?.length || 0}`;
    if (!force && key === this.seen) return;
    this.seen = key;
    for (const b of this.root.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === this.tab);
    this.body.innerHTML = this.tab === 'character' ? this.character() : this.quests();
  }

  quests() {
    const me = this.me, qs = me.world.quests, list = qs?.list || [];
    if (!list.length) {
      return `<p class="journal-empty">No quests yet. Townsfolk with a gold <b class="mark">!</b> over them have work for you: right click on them, and ask <i>Any work?</i></p>
        <p class="muted-note">${qs?.done?.size || qs?.doneCount ? `Quests done: ${qs.done?.size || qs.doneCount}` : ''}</p>`;
    }
    const cards = [...list].reverse().map(q => {
      const ready = questReady(me, q), on = q.id === (qs.track || list.at(-1).id);
      const badge = q.kind === 'story' ? '<span class="tq-badge" style="background:#a052ea">★ The story</span> ' : q.kind === 'personal' ? `<span class="tq-badge">${esc(q.giver.name)}'s own</span> ` : '';
      return `<div class="journal-quest${on ? ' on' : ''}${ready ? ' ready' : ''}${q.kind === 'story' ? ' story' : q.kind === 'personal' ? ' personal' : ''}">
        <div class="jq-head"><span class="jq-title">${badge}${esc(q.title)}</span>${ready ? '<span class="jq-ready">Done: hand it in</span>' : ''}</div>
        <div class="jq-from">From ${esc(q.giver.name)}, the ${esc(q.giver.title.toLowerCase())} of ${esc(q.giver.town)}</div>
        <p class="jq-text">“${esc(q.text)}”</p>
        <ul class="jq-goals">${q.goals.map(g => `<li class="${goalMet(me, g) ? 'met' : ''}">${esc(goalText(me, g))}</li>`).join('')}
          ${ready && q.turnIn === q.giver.key ? `<li class="back">Go back to ${esc(q.giver.name)} in ${esc(q.giver.town)}</li>` : ''}
          ${ready && q.turnIn !== q.giver.key && q.handTo ? `<li class="back">Take it to ${esc(q.handTo.name)}${q.handTo.town ? ` in ${esc(q.handTo.town)}` : ''}</li>` : ''}</ul>
        <div class="jq-foot"><span class="jq-reward">${esc(rewardText(q.reward))}</span>
          <span class="jq-acts">${on ? '<span class="jq-following">Following</span>' : `<button type="button" class="small" data-act="qtrack" data-id="${esc(q.id)}">Follow</button>`}
          ${q.kind === 'side' && me.world.partyList?.length ? `<button type="button" class="small" data-act="qshare" data-id="${esc(q.id)}">Share</button>` : ''}
          <button type="button" class="small" data-act="qdrop" data-id="${esc(q.id)}">Give up</button></span></div>
      </div>`;
    }).join('');
    return `<p class="muted-note">${list.length} of ${MAX_QUESTS} quests · the one you follow shows on the screen, with which way to go</p>${cards}`;
  }

  character() {
    const me = this.me, p = me.world.prog || { level: 1, xp: 0, points: 0, perks: {}, stats: {}, seen: { towns: [], deepest: 0 } };
    const need = xpToNext(p.level), st = p.stats || {};
    const perks = Object.entries(PERKS).map(([id, d]) => {
      const r = p.perks[id] | 0, can = p.points > 0 && r < d.max;
      return `<div class="journal-perk${r ? ' has' : ''}">
        <div class="jp-name">${esc(d.name)} <span class="jp-rank">${'●'.repeat(r)}${'○'.repeat(d.max - r)}</span></div>
        <div class="jp-text">${r ? esc(d.text(r)) : '—'}${r < d.max ? `<span class="jp-next">Next: ${esc(d.text(r + 1))}</span>` : ''}</div>
        <button type="button" class="small" data-act="perk" data-id="${id}" ${can ? '' : 'disabled'}>+</button>
      </div>`;
    }).join('');
    const stat = (label, v) => `<div class="journal-stat"><span>${esc(label)}</span><b>${v ?? 0}</b></div>`;
    return `<div class="journal-char">
      <div class="jc-level">Level ${p.level}${p.level >= MAX_LEVEL ? ' (the highest)' : ''}</div>
      <div class="jc-xp"><div class="jc-xpfill" style="width:${p.level >= MAX_LEVEL ? 100 : Math.min(100, (p.xp / need) * 100).toFixed(1)}%"></div></div>
      <div class="muted-note">${p.level >= MAX_LEVEL ? 'As far as it goes.' : `${Math.floor(p.xp)} / ${need} experience to level ${p.level + 1}`} · health ${maxHealthOf(me)}</div>
      <h3 class="inv-label">Perks ${p.points ? `<span class="jc-points">${p.points} point${p.points > 1 ? 's' : ''} to spend</span>` : '<span class="muted-note">(a point with each level)</span>'}</h3>
      <div class="journal-perks">${perks}</div>
      <h3 class="inv-label">What you've done</h3>
      <div class="journal-stats">
        ${stat('Monsters killed', st.kills)}${stat('Ore and gems mined', st.mined)}${stat('Things made', st.crafted)}${stat('Quests done', st.quests)}
        ${stat('Towns found', p.seen?.towns?.length)}${stat('Deepest (blocks down)', p.seen?.deepest)}${stat('Raids beaten back', st.raids)}
        ${stat('The story', `${st.story || 0} of 13`)}
      </div>
    </div>`;
  }

  /** A key while it's open: true if it was the screen's. */
  key(code, isJournalKey) {
    if (code === 'Escape' || isJournalKey) { this.onClose(); return true; }
    return false;
  }
}
