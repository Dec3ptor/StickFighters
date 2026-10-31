// Settings, Developer: the game's numbers (tuning.js), section by section, changed live; a
// search across all of them; the choices players make (Settings, the game setup: main.js and
// gamedefaults.js), as chosen here; and boxes to copy all of it out (to paste to whoever makes
// them the game's defaults) and to paste it back in.

import {
  tuningSections, tuningField, setTuning, resetTuning, resetAllTuning, changedCount, exportTuning, importTuning, usingHostTuning,
} from './tuning.js';

const fmt = v => String(Math.round(v * 1e4) / 1e4);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// (The section of players' choices, after the numbers' sections.)
const CHOICES = { id: 'choices', name: 'Settings & setup' };

export class DevMenu {
  /**
   * el: the element to fill (Settings' Developer page). onChange(): a number changed. choices:
   * the choices players make (main.js): { rows(), changed(), read({ all }), apply(obj, { reset }) }.
   */
  constructor(el, { onChange = () => {}, choices = null } = {}) {
    this.el = el;
    this.onChange = onChange;
    this.choices = choices;
    this.section = 'movement';
    this.weapon = null;
    this.find = '';
    this.sections = null;
    this.built = false;
  }

  /** Draw it (again, with the numbers as they are now). */
  render() {
    this.sections ??= tuningSections();
    this.weapon ??= this.sections.find(s => s.id === 'weapons').groups[0].id;
    if (!this.built) this.build();
    this.showSections();
    this.showRows();
    this.showExport();
    const host = this.el.querySelector('.dev-host');
    host.classList.toggle('hidden', !usingHostTuning());
  }

  build() {
    this.built = true;
    this.el.innerHTML = `
      <p class="muted-note">Every number the game plays by, changed as you type, and kept in this browser. Most changes show straight away; health, the bots' reactions and their route maps change from the next match. Numbers are at full speed: the game plays at 75%, so in play speeds are &times;0.75 and times &divide;0.75. In games you host, everyone plays by your numbers (from the next match). <b>Settings &amp; setup</b> lists everything players choose, in Settings and the game setup, as you've chosen it: what you copy out carries those too, so it can all become the game's defaults.</p>
      <p class="dev-host note hidden">You're in someone else's game, so everyone's using the host's numbers. Yours are kept for your own games.</p>
      <div class="dev-bar">
        <div class="dev-sections" role="tablist" aria-label="Developer sections"></div>
        <input type="search" class="dev-find" placeholder="Find a number…" aria-label="Find a number" autocomplete="off" spellcheck="false">
      </div>
      <label class="dev-weapon">Weapon <select class="dev-weapon-pick" aria-label="Weapon"></select></label>
      <div class="dev-rows"></div>
      <h3 class="set-title">Copy out, paste in</h3>
      <div class="dev-io">
        <div class="dev-io-col">
          <div class="dev-io-head"><b>Your changes</b><span><button type="button" class="small" data-copy="changes">Copy changes</button> <button type="button" class="small" data-copy="all">Copy everything</button></span></div>
          <textarea class="dev-export" readonly spellcheck="false" aria-label="Your changes, as JSON"></textarea>
        </div>
        <div class="dev-io-col">
          <div class="dev-io-head"><b>Paste in</b><span><button type="button" class="small" data-import>Import</button></span></div>
          <textarea class="dev-import" spellcheck="false" placeholder="Paste what Copy changes gave…" aria-label="Numbers and choices to import, as JSON"></textarea>
        </div>
      </div>
      <div class="dev-foot"><p class="dev-msg muted-note" aria-live="polite"></p><button type="button" class="small danger" data-reset-all>Reset every number</button></div>`;
    const q = s => this.el.querySelector(s);
    q('.dev-find').addEventListener('input', e => { this.find = e.target.value.trim().toLowerCase(); this.showRows(); });
    q('.dev-weapon-pick').addEventListener('change', e => { this.weapon = e.target.value; this.showRows(); });
    for (const b of this.el.querySelectorAll('[data-copy]')) b.addEventListener('click', () => this.copy(b.dataset.copy === 'all'));
    q('[data-import]').addEventListener('click', () => {
      let obj;
      try { obj = JSON.parse(q('.dev-import').value); } catch { return this.say('That isn\'t JSON: paste what Copy changes gives.'); }
      const r = importTuning(obj);
      const c = this.choices ? this.choices.apply(obj) : { applied: 0, skipped: [] };
      const all = [...c.skipped, ...r.skipped];
      const skipped = all.length ? ` (${all.length} skipped: ${all.slice(0, 4).join(', ')}${all.length > 4 ? '…' : ''})` : '';
      const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
      this.say(`Imported ${n(r.applied, 'number')}${this.choices ? ` and ${n(c.applied, 'choice')}` : ''}${skipped}.`);
      q('.dev-import').value = '';
      this.changed();
    });
    q('[data-reset-all]').addEventListener('click', () => {
      if (!changedCount()) return this.say('Nothing to reset: every number is the game\'s own.');
      if (!this.el.ownerDocument.defaultView.confirm(`Put all ${changedCount()} changed numbers back to the game's own?`)) return;
      resetAllTuning();
      this.say('Every number is back to the game\'s own.');
      this.changed();
    });
    // (A number typed in: used when it's done, Enter or leaving the box.)
    this.el.addEventListener('change', e => {
      const input = e.target.closest?.('.dev-row input');
      if (!input) return;
      const row = input.closest('.dev-row'), path = row.dataset.key.split('.');
      const kept = setTuning(path, Number(input.value));
      if (kept == null) { this.say(`${row.querySelector('b').textContent}: that isn't a number it can be.`); input.value = fmt(tuningField(path).value); return; }
      input.value = fmt(kept);
      this.changed(row, path);
    });
    this.el.addEventListener('click', e => {
      const b = e.target.closest?.('.dev-reset');
      if (!b) return;
      const row = b.closest('.dev-row'), path = row.dataset.key.split('.');
      resetTuning(path);
      row.querySelector('input').value = fmt(tuningField(path).value);
      this.changed(row, path);
    });
  }

  /** A number (or all of them) changed: show it. */
  changed(row, path) {
    if (row) {
      const f = tuningField(path);
      row.classList.toggle('changed', f.changed);
      row.querySelector('.dev-reset').disabled = !f.changed;
    } else this.showRows();
    this.showSections();
    this.showExport();
    this.onChange();
  }

  showSections() {
    const box = this.el.querySelector('.dev-sections');
    box.replaceChildren(...[...this.sections, ...(this.choices ? [CHOICES] : [])].map(s => {
      const n = s === CHOICES ? this.choices.changed() : s.groups.reduce((sum, g) => sum + g.paths.filter(p => tuningField(p).changed).length, 0);
      const b = this.el.ownerDocument.createElement('button');
      b.type = 'button';
      b.className = 'dev-section';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(s.id === this.section && !this.find));
      b.dataset.section = s.id;
      b.innerHTML = `${esc(s.name)}${n ? ` <span class="dev-count">${n}</span>` : ''}`;
      b.addEventListener('click', () => {
        this.section = s.id;
        this.find = '';
        this.el.querySelector('.dev-find').value = '';
        this.showSections();
        this.showRows();
      });
      return b;
    }));
    // The weapon picker: each weapon, marked where it's changed.
    const pick = this.el.querySelector('.dev-weapon-pick');
    const weapons = this.sections.find(s => s.id === 'weapons').groups;
    pick.innerHTML = weapons.map(g => {
      const n = changedCount(['WEAPONS', g.id]);
      return `<option value="${esc(g.id)}"${g.id === this.weapon ? ' selected' : ''}>${esc(g.name)}${n ? ` (${n} changed)` : ''}</option>`;
    }).join('');
  }

  /** The rows: the section's numbers (one weapon's, for Weapons), or everything matching the search. */
  showRows() {
    const box = this.el.querySelector('.dev-rows');
    if (this.section === CHOICES.id && !this.find) return this.showChoices(box);
    let groups;
    if (this.find) {
      groups = [];
      for (const s of this.sections) {
        for (const g of s.groups) {
          const paths = g.paths.filter(p => {
            const f = tuningField(p);
            return `${f.label} ${f.key} ${g.name}`.toLowerCase().includes(this.find);
          });
          if (paths.length) groups.push({ name: s.id === 'weapons' ? `Weapon: ${g.name}` : g.name, paths });
        }
      }
    } else {
      const s = this.sections.find(x => x.id === this.section);
      groups = s.id === 'weapons' ? s.groups.filter(g => g.id === this.weapon) : s.groups;
    }
    this.el.querySelector('.dev-weapon').classList.toggle('hidden', !!this.find || this.section !== 'weapons');
    box.innerHTML = groups.length ? groups.map(g => `
      <h4 class="dev-group">${esc(g.name)}</h4>
      ${g.paths.map(p => {
        const f = tuningField(p);
        return `<div class="dev-row${f.changed ? ' changed' : ''}" data-key="${esc(f.key)}">
          <div class="dev-label"><b>${esc(f.label)}</b><small>${f.help ? `${esc(f.help)} · ` : ''}${esc(f.key)} · default ${fmt(f.def)}</small></div>
          <input type="number" value="${fmt(f.value)}" step="${f.step}" aria-label="${esc(f.label)}">
          <button type="button" class="dev-reset small" title="Back to ${fmt(f.def)}" aria-label="Back to ${fmt(f.def)}"${f.changed ? '' : ' disabled'}>&#8634;</button>
        </div>`;
      }).join('')}`).join('') : '<p class="muted-note">Nothing matches.</p>';
  }

  /** Players' choices: each as chosen here, and the game's own (changed where they differ). Changed where they're chosen. */
  showChoices(box) {
    this.el.querySelector('.dev-weapon').classList.add('hidden');
    box.innerHTML = `<p class="muted-note">Change these where they are: Settings' other sections, and the game setup on the main menu. Copied out with the numbers; pasted in, they're used here.</p>
      ${this.choices.rows().map(g => `<h4 class="dev-group">${esc(g.name)}</h4>
        ${g.rows.map(r => `<div class="dev-row dev-choice${r.changed ? ' changed' : ''}" data-choice="${esc(r.key)}">
          <div class="dev-label"><b>${esc(r.label)}</b><small>${esc(r.page)} · ${esc(r.key)} · default ${esc(r.def)}</small></div>
          <span class="dev-value">${esc(r.value)}</span>
        </div>`).join('')}`).join('')}
      <div class="dev-row-end"><button type="button" class="small" data-choices-reset>Put them all back</button></div>`;
    box.querySelector('[data-choices-reset]').addEventListener('click', () => {
      const n = this.choices.changed();
      if (!n) return this.say('Nothing to put back: every choice is the game\'s own.');
      if (!this.el.ownerDocument.defaultView.confirm(`Put all ${n} changed choice${n === 1 ? '' : 's'} (Settings and the game setup) back to the game's own?`)) return;
      this.choices.apply(null, { reset: true });
      this.say('Every choice is back to the game\'s own.');
      this.changed();
    });
  }

  /** How many numbers and choices are changed. */
  total() { return changedCount() + (this.choices?.changed() || 0); }

  /** Everything changed (or all of it), as JSON: the choices, then the numbers. */
  exportText(all = false) {
    const numbers = JSON.parse(exportTuning({ all }));
    delete numbers.stickSoldiersTuning;
    delete numbers.note;
    const out = { stickSoldiersTuning: 1, note: all ? 'everything: Settings, the game setup and every number (at full speed)' : 'changed from the defaults (numbers at full speed)' };
    if (this.choices) {
      const { settings, setup } = this.choices.read({ all });
      if (all || Object.keys(settings).length) out.settings = settings;
      if (all || Object.keys(setup).length) out.setup = setup;
    }
    return JSON.stringify({ ...out, ...numbers }, null, 2);
  }

  showExport() {
    this.el.querySelector('.dev-export').value = this.total() ? this.exportText() : '';
    this.el.querySelector('.dev-export').placeholder = 'No changes yet: everything is the game\'s own.';
  }

  async copy(all) {
    const text = this.exportText(all);
    const box = this.el.querySelector('.dev-export');
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {
      // (No clipboard here: select the text instead, to copy by hand.)
      box.value = text;
      box.focus();
      box.select();
      try { ok = this.el.ownerDocument.execCommand('copy'); } catch { ok = false; }
    }
    const n = this.total();
    this.say(ok ? `Copied ${all ? 'everything' : `your ${n} change${n === 1 ? '' : 's'}`}: paste it to make ${all ? 'it' : 'them'} the game's defaults.` : 'Select the text in the box and copy it.');
  }

  say(text) {
    const m = this.el.querySelector('.dev-msg');
    m.textContent = text;
  }
}
