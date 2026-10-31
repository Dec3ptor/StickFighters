// Settings, Developer: the game's numbers (tuning.js), section by section, changed live; a
// search across all of them; the defaults for the choices players make (Settings, the game
// setup: main.js and gamedefaults.js), changed here or pulled from the current game; and boxes
// to copy all of it out (to paste to whoever makes them the game's defaults) and to paste it back in.

import {
  tuningSections, tuningField, setTuning, resetTuning, resetAllTuning, changedCount, exportTuning, importTuning, usingHostTuning,
} from './tuning.js';
import { parts, describe, differences, equal } from './gamedefaults.js';
import { canBind, keyFromText, sharedKeys, MAX_KEYS } from './keys.js';

const fmt = v => String(Math.round(v * 1e4) / 1e4);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// (The section of players' choices, after the numbers' sections.)
const CHOICES = { id: 'choices', name: 'Settings & setup' };

/** A control for a choice (or for a part of one: sub), as its editor (spec) has it. */
function control(spec, v, label, sub = '') {
  const a = `class="dev-ctl"${sub ? ` data-sub="${esc(sub)}"` : ''} aria-label="${esc(label)}"`;
  switch (spec?.type) {
    case 'select': {
      const known = spec.options.some(o => equal(o.value, v));
      return `<select ${a}>${known ? '' : `<option value="" selected disabled>${esc(describe('', v))}</option>`}${spec.options.map(o =>
        `<option value="${esc(String(o.value))}"${equal(o.value, v) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    }
    case 'bool': return `<input type="checkbox" ${a}${v ? ' checked' : ''}>`;
    case 'number': return `<input type="number" ${a} min="${spec.min}" max="${spec.max}" step="${spec.step || 'any'}" value="${esc(String(v))}">`;
    case 'color': return `<input type="color" ${a} value="${esc(v)}">`;
    case 'keyList': return `<input type="text" ${a} value="${esc(v.join(' '))}" spellcheck="false" autocomplete="off">`;
    default: return `<span class="dev-value">${esc(describe('', v))}</span>`;
  }
}

/** What's in a control, as its editor has it (undefined: nothing it can be). Keys: as typed, where they aren't keys. */
function readControl(el, spec) {
  switch (spec.type) {
    case 'select': return spec.options.find(o => String(o.value) === el.value)?.value;
    case 'bool': return el.checked;
    case 'number': return el.value.trim() === '' ? undefined : Number(el.value);
    case 'keyList': return el.value.split(/[\s,/]+/).filter(Boolean).map(t => keyFromText(t) ?? t);
    default: return el.value;
  }
}

/** Show a value in its control (left as it is if it shows it already: the caret stays put). */
function fillControl(el, spec, v) {
  if (spec.type === 'bool') { el.checked = !!v; return; }
  const text = spec.type === 'keyList' ? v.join(' ') : String(v);
  if (el.value !== text) el.value = text;
}

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
    this.rowsByKey = new Map(); // (the choices' rows, as last shown)
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
      <p class="muted-note">Every number the game plays by, changed as you type, and kept in this browser. Most changes show straight away; health, the bots' reactions and their route maps change from the next match. Numbers are at full speed: the game plays at 75%, so in play speeds are &times;0.75 and times &divide;0.75. In games you host, everyone plays by your numbers (from the next match). <b>Settings &amp; setup</b> has the defaults for everything players choose (in Settings and the game setup), to change, or to pull from the current game: what you copy out carries those too, so it can all become the game's defaults.</p>
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
    // (A number typed in: used when it's done, Enter or leaving the box. A default: the same.)
    this.el.addEventListener('change', e => {
      const row = e.target.closest?.('.dev-row');
      if (row?.dataset.choice) return this.editChoice(row, e.target);
      const input = e.target.closest?.('.dev-row input');
      if (!input) return;
      const path = row.dataset.key.split('.');
      const kept = setTuning(path, Number(input.value));
      if (kept == null) { this.say(`${row.querySelector('b').textContent}: that isn't a number it can be.`); input.value = fmt(tuningField(path).value); return; }
      input.value = fmt(kept);
      this.changed(row, path);
    });
    this.el.addEventListener('click', e => {
      const all = e.target.closest?.('[data-choices]');
      if (all) return this.allChoices(all.dataset.choices);
      const b = e.target.closest?.('.dev-reset, .dev-pull');
      if (!b) return;
      const row = b.closest('.dev-row');
      if (row.dataset.choice) return this.oneChoice(row.dataset.choice, b.classList.contains('dev-pull') ? 'pull' : 'reset');
      const path = row.dataset.key.split('.');
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

  /**
   * The defaults for players' choices: each with its control, how it compares with the game's
   * own and yours (marked where it isn't the game's own), and buttons to pull yours in or put
   * the game's own back.
   */
  showChoices(box) {
    this.el.querySelector('.dev-weapon').classList.add('hidden');
    const groups = this.choices.rows();
    this.rowsByKey = new Map(groups.flatMap(g => g.rows.map(r => [r.key, r])));
    box.innerHTML = `<p class="muted-note">The defaults for everything players choose: what a new player starts with. They're kept here apart from your own choices: change them here, or pull them from the current game (yours as they are now: Settings, and the game setup, or the match you're in). Copied out with the numbers; pasted in, they come here. <b>Use in my game</b> sets yours to them, to try them out.</p>
      <div class="dev-choice-bar">
        <button type="button" class="small" data-choices="pull">Pull from current game</button>
        <button type="button" class="small" data-choices="use">Use in my game</button>
        <button type="button" class="small" data-choices="reset">Put them all back</button>
      </div>
      ${groups.map(g => `<h4 class="dev-group">${esc(g.name)}</h4>${g.rows.map(r => this.choiceRow(r)).join('')}`).join('')}`;
  }

  /** A default's row: its label and note, its control (or a part's control each: the crosshair, the keys...), Pull and reset. */
  choiceRow(r) {
    const ps = parts(r.spec);
    const edit = ps
      ? `<div class="dev-subs${r.spec.type === 'keys' ? ' dev-keys' : ''}">${ps.map(p => {
        const v = r.value?.[p.key] ?? p.def;
        return `<label class="dev-sub${equal(v, p.def) ? '' : ' changed'}" data-part="${esc(p.key)}"><span>${esc(p.label)} <small>${esc(describe(p.key, p.def, p.spec))}</small></span>${control(p.spec, v, `${r.label}: ${p.label}`, p.key)}</label>`;
      }).join('')}</div>`
      : control(r.spec, r.value, r.label);
    return `<div class="dev-row dev-choice${ps ? ' dev-wide' : ''}${r.changed ? ' changed' : ''}" data-choice="${esc(r.key)}">
      <div class="dev-label"><b>${esc(r.label)}</b><small>${esc(this.choiceNote(r))}</small></div>
      <div class="dev-edit">${edit}</div>
      <button type="button" class="dev-pull small" title="Pull from current game: the default becomes what you have now"${r.same ? ' disabled' : ''}>Pull</button>
      <button type="button" class="dev-reset small" title="Back to the game's own" aria-label="Back to the game's own"${r.changed ? '' : ' disabled'}>&#8634;</button>
    </div>`;
  }

  /** Where it's from, and the game's own and yours (those parts that differ, for the crosshair, the keys...). */
  choiceNote(r) {
    const ps = parts(r.spec);
    const words = list => list.map(p => `${r.spec.type === 'keys' ? p.key : p.label.toLowerCase()} ${describe(p.key, p.value, p.spec)}`).join(', ');
    const own = !ps ? describe(r.key, r.def, r.spec) : r.changed ? words(differences(r.spec, r.value, r.def)) : 'as here';
    const yours = r.same ? 'the same' : ps ? words(differences(r.spec, r.value, r.mine)) : describe(r.key, r.mine, r.spec);
    return `${r.page} · ${r.key} · game's own: ${own} · yours: ${yours}`;
  }

  /** A default changed in its control (or in one of its parts'). */
  editChoice(row, el) {
    const r = this.rowsByKey.get(row.dataset.choice);
    if (!r || !el.classList.contains('dev-ctl')) return;
    const p = el.dataset.sub ? parts(r.spec).find(x => x.key === el.dataset.sub) : null;
    const spec = p ? p.spec : r.spec, v = readControl(el, spec), name = p ? `${r.label}: ${p.label}` : r.label;
    const bad = spec.type === 'keyList' ? v.filter(k => !canBind(k)) : [];
    const kept = bad.length || v === undefined ? undefined : this.choices.set(r.key, p ? { ...(r.value || {}), [p.key]: v } : v);
    if (bad.length) this.say(`${name}: ${bad.map(k => `“${k}”`).join(', ')} ${bad.length === 1 ? 'isn\'t a key' : 'aren\'t keys'}. Name keys as W, Space, Up, Shift, Mouse0 (the left button), WheelUp…, with spaces between.`);
    else if (kept === undefined) this.say(`${name}: that isn't one it can be.`);
    else if (spec.type === 'keyList') {
      // (Kept as typed, but said: a key that's another action's too, as Settings' Controls never has it.)
      const all = Object.fromEntries(parts(r.spec).map(x => [x.key, kept[x.key] ?? x.def]));
      const short = id => parts(r.spec).find(x => x.key === id).label.replace(/ \(.*$/, '');
      const clash = sharedKeys(all, p.key).map(([k, others]) => `${k} is ${others.map(o => `${short(o)}'s`).join(' and ')} too`);
      this.say([v.length > MAX_KEYS ? `${MAX_KEYS} keys at most: the first ${MAX_KEYS} kept` : '', ...clash].filter(Boolean).map(t => `${name}: ${t}.`).join(' '));
    } else this.say('');
    this.choicesChanged();
  }

  /** One default pulled from the current game, or put back to the game's own. */
  oneChoice(key, what) {
    const r = this.rowsByKey.get(key);
    if (what === 'reset') {
      this.choices.reset(key);
      this.say('');
    } else {
      const { skipped } = this.choices.pull(key);
      this.say(skipped.length ? `${r.label}: yours (${describe(key, r.mine, r.spec)}) can't be a default.` : `${r.label}: pulled from the current game (the default is what you have now).`);
    }
    this.choicesChanged();
  }

  /** Every default pulled from the current game, tried out (made yours), or put back to the game's own. */
  allChoices(what) {
    const win = this.el.ownerDocument.defaultView, n = this.choices.changed();
    if (what === 'pull') {
      if (n && !win.confirm('Pull everything from the current game: every default becomes what you have now (Settings, and the game setup)? The defaults changed here are replaced.')) return;
      const { changed, skipped } = this.choices.pull();
      const names = skipped.map(k => this.rowsByKey.get(k)?.label || k), one = names.length === 1;
      this.say(`Pulled from the current game: ${changed} default${changed === 1 ? '' : 's'} changed.${names.length ? ` (${names.join(', ')}: yours can't be ${one ? 'a default' : 'defaults'}, so ${one ? 'it stays' : 'they stay'} as before.)` : ''}`);
    } else if (what === 'use') {
      if (!win.confirm('Set your own Settings and game setup to these defaults (every one, as a new player starts)? Your own choices are replaced: to keep them, pull them in first.')) return;
      this.choices.use();
      this.say('Your Settings and game setup are these defaults now (the game setup from the next match).');
    } else {
      if (!n) return this.say('Nothing to put back: every default is the game\'s own.');
      if (!win.confirm(`Put all ${n} changed default${n === 1 ? '' : 's'} (Settings and the game setup) back to the game's own? Your own choices stay as they are.`)) return;
      this.choices.reset();
      this.say('Every default is back to the game\'s own.');
    }
    this.choicesChanged();
  }

  /** The defaults changed: show them (in place, so whatever's being typed in keeps its place), and what's copied out. */
  choicesChanged() {
    for (const g of this.choices.rows()) {
      for (const r of g.rows) {
        this.rowsByKey.set(r.key, r);
        const row = this.el.querySelector(`.dev-choice[data-choice="${r.key}"]`);
        if (!row) continue;
        row.classList.toggle('changed', r.changed);
        row.querySelector('.dev-label small').textContent = this.choiceNote(r);
        row.querySelector('.dev-pull').disabled = r.same;
        row.querySelector('.dev-reset').disabled = !r.changed;
        const ps = parts(r.spec);
        if (!ps) {
          const c = row.querySelector('.dev-ctl');
          if (c && r.spec) fillControl(c, r.spec, r.value);
          continue;
        }
        for (const p of ps) {
          const part = row.querySelector(`.dev-sub[data-part="${p.key}"]`), v = r.value?.[p.key] ?? p.def;
          part.classList.toggle('changed', !equal(v, p.def));
          fillControl(part.querySelector('.dev-ctl'), p.spec, v);
        }
      }
    }
    this.showSections();
    this.showExport();
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
