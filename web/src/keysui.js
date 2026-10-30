// Settings, Controls: every action and its keys. Click a key to change it, then press the new
// key or mouse button (or turn the wheel): Esc keeps it as it was, Backspace or Delete clears it.
// + adds another key (up to MAX_KEYS). A key taken from another action leaves that one.

import { ACTIONS, MAX_KEYS, keysFor, keyName, bindKey, unbindKey, keyOf, mouseKey, canBind } from './keys.js';

export class KeybindList {
  /**
   * el: the element to fill. onChange(): the keys changed (to be saved). classes(): whether
   * classes are on (their action is only listed then).
   */
  constructor(el, { onChange = () => {}, classes = () => false } = {}) {
    this.el = el;
    this.onChange = onChange;
    this.classes = classes;
    this.listening = null; // { id, at } while waiting for a key
    this.note = '';
    this.noteTimer = 0;
    this.stop = null;
  }

  /** Whether it's waiting for a key (Esc then belongs to it, not to closing Settings). */
  get capturing() { return !!this.listening; }

  /** Draw the list (again). */
  render() {
    const doc = this.el.ownerDocument;
    const frag = doc.createDocumentFragment();
    let group = null, box = null;
    for (const a of ACTIONS) {
      if (a.classes && !this.classes()) continue;
      if (a.group !== group) {
        group = a.group;
        const h = doc.createElement('h4');
        h.className = 'kb-group';
        h.textContent = group;
        frag.append(h);
        box = doc.createElement('div');
        box.className = 'kb-rows';
        frag.append(box);
      }
      const row = doc.createElement('div');
      row.className = 'kb-row';
      row.dataset.action = a.id;
      const name = doc.createElement('span');
      name.className = 'kb-name';
      name.textContent = a.name;
      const keys = doc.createElement('span');
      keys.className = 'kb-keys';
      const list = keysFor(a.id);
      list.forEach((k, i) => keys.append(this.keyButton(a, i, keyName(k))));
      if (this.listening?.id === a.id && this.listening.at >= list.length) keys.append(this.keyButton(a, list.length, null));
      else if (list.length < MAX_KEYS) {
        const add = doc.createElement('button');
        add.type = 'button';
        add.className = 'kb-add';
        add.textContent = '+';
        add.title = `Add a key for ${a.name}`;
        add.setAttribute('aria-label', `Add a key for ${a.name}`);
        add.addEventListener('click', () => this.listen(a.id, list.length));
        keys.append(add);
      }
      if (!list.length && this.listening?.id !== a.id) {
        const none = doc.createElement('span');
        none.className = 'kb-none';
        none.textContent = 'Unbound';
        keys.prepend(none);
      }
      row.append(name, keys);
      box.append(row);
    }
    const note = doc.createElement('p');
    note.className = 'kb-note muted-note';
    note.setAttribute('aria-live', 'polite');
    note.textContent = this.note;
    this.el.replaceChildren(frag, note);
  }

  keyButton(a, at, label) {
    const b = this.el.ownerDocument.createElement('button');
    b.type = 'button';
    b.className = 'kb-key';
    b.dataset.at = String(at);
    const waiting = this.listening?.id === a.id && this.listening.at === at;
    if (waiting) {
      b.classList.add('listening');
      b.textContent = 'Press a key…';
    } else {
      b.textContent = label;
      b.title = `${a.name}: ${label}. Click to change it.`;
    }
    b.addEventListener('click', () => { if (!waiting) this.listen(a.id, at); });
    return b;
  }

  /** Wait for the key for action `id`'s key number `at` (past its last: an extra one). */
  listen(id, at) {
    this.cancel();
    this.listening = { id, at };
    this.render();
    const win = this.el.ownerDocument.defaultView;
    const done = key => {
      this.cancel();
      if (key === 'clear') unbindKey(id, at);
      else if (key) {
        const taken = bindKey(id, at, key);
        if (taken.length) {
          const names = taken.map(t => ACTIONS.find(x => x.id === t)?.name || t);
          this.say(`${keyName(key)} was taken from ${names.join(', ')}.`);
        }
      }
      if (key) this.onChange();
      this.render();
      // (Back on the key just set, for the keyboard.)
      this.el.querySelector(`.kb-row[data-action="${id}"] .kb-key[data-at="${Math.min(at, keysFor(id).length - 1)}"]`)?.focus();
    };
    const swallow = e => { e.preventDefault(); e.stopImmediatePropagation(); };
    const onKey = e => {
      swallow(e);
      if (e.repeat) return;
      if (e.code === 'Escape') done(null);
      else if (e.code === 'Backspace' || e.code === 'Delete') done(at < keysFor(id).length ? 'clear' : null);
      else if (canBind(keyOf(e.code))) done(keyOf(e.code));
    };
    const onMouse = e => {
      swallow(e);
      // (The click and menu that come with this press of this button aren't for the page:
      // they're kept from it until just after the button's let go.)
      const button = e.button, types = ['click', 'contextmenu', 'auxclick'];
      const block = ev => { if (ev.button === button) { ev.preventDefault(); ev.stopImmediatePropagation(); } };
      let cleared = false;
      const clear = () => {
        if (cleared) return;
        cleared = true;
        for (const type of types) win.removeEventListener(type, block, true);
        win.removeEventListener('mouseup', up, true);
      };
      const up = ev => { if (ev.button === button) { ev.preventDefault(); win.setTimeout(clear, 0); } };
      for (const type of types) win.addEventListener(type, block, true);
      win.addEventListener('mouseup', up, true);
      win.setTimeout(clear, 1500);
      done(mouseKey(button));
    };
    const onWheel = e => { swallow(e); if (e.deltaY) done(e.deltaY > 0 ? 'WheelDown' : 'WheelUp'); };
    win.addEventListener('keydown', onKey, true);
    win.addEventListener('mousedown', onMouse, true);
    win.addEventListener('wheel', onWheel, { capture: true, passive: false });
    this.stop = () => {
      win.removeEventListener('keydown', onKey, true);
      win.removeEventListener('mousedown', onMouse, true);
      win.removeEventListener('wheel', onWheel, { capture: true });
    };
  }

  /** Stop waiting for a key (nothing changes). */
  cancel() {
    this.stop?.();
    this.stop = null;
    if (!this.listening) return;
    this.listening = null;
  }

  say(text) {
    this.note = text;
    const win = this.el.ownerDocument.defaultView;
    win.clearTimeout(this.noteTimer);
    this.noteTimer = win.setTimeout(() => { this.note = ''; const n = this.el.querySelector('.kb-note'); if (n) n.textContent = ''; }, 5000);
  }
}
