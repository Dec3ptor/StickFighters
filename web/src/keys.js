// The keys (and mouse buttons) for everything you do in a match, as set in Settings (Controls).
//
// A key is one of:
// - a KeyboardEvent.code: where the key is on the keyboard, whatever's printed on it
//   ('KeyW', 'Space', 'Digit1', 'ArrowUp'...);
// - 'Shift', 'Control', 'Alt' or 'Meta': that key on either side of the keyboard;
// - a mouse button: 'Mouse0' (left), 'Mouse1' (middle), 'Mouse2' (right), 'Mouse3' (back), 'Mouse4' (forward);
// - the wheel: 'WheelUp' or 'WheelDown'.
// Esc is kept for the menu, so it can't be bound.

/**
 * Everything that can be bound, in the order Settings lists them. press: read by the game as
 * one press at a time (queued, so a quick tap between two game updates still counts), rather
 * than held. (The menus' keys, like Buy and Chat, are read by main.js as they're pressed.)
 * classes: only while classes are switched on.
 */
export const ACTIONS = [
  { id: 'left', name: 'Move left', group: 'Movement', keys: ['KeyA', 'ArrowLeft'] },
  { id: 'right', name: 'Move right', group: 'Movement', keys: ['KeyD', 'ArrowRight'] },
  { id: 'jump', name: 'Jump (hold in the air for the jetpack)', group: 'Movement', keys: ['KeyW', 'Space', 'ArrowUp'] },
  { id: 'crouch', name: 'Crouch (steadier aim)', group: 'Movement', keys: ['KeyS', 'ArrowDown', 'Control', 'Meta'] },
  { id: 'sprint', name: 'Sprint', group: 'Movement', keys: ['Shift'] },
  { id: 'fire', name: 'Fire', group: 'Weapons', keys: ['Mouse0'] },
  { id: 'aim', name: 'Aim down the sights, sniper scope (building: turn the block)', group: 'Weapons', keys: ['Mouse2'] },
  { id: 'reload', name: 'Reload', group: 'Weapons', keys: ['KeyR'], press: true },
  { id: 'prev', name: 'Previous weapon', group: 'Weapons', keys: ['KeyQ', 'WheelUp'], press: true },
  { id: 'next', name: 'Next weapon', group: 'Weapons', keys: ['KeyE', 'WheelDown'], press: true },
  { id: 'melee', name: 'Sledgehammer', group: 'Weapons', keys: ['KeyF'], press: true },
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `slot${i + 1}`, name: `Weapon ${i + 1}`, group: 'Weapon slots (and where to respawn)',
    keys: [`Digit${(i + 1) % 10}`], press: true,
  })),
  { id: 'use', name: 'Plant or defuse the bomb (hold, Defuse)', group: 'Actions', keys: ['KeyE'] },
  { id: 'buy', name: 'Buy menu (Defuse)', group: 'Actions', keys: ['KeyB'] },
  { id: 'gadget', name: 'Gadget, or drop your gun or the bomb (Defuse)', group: 'Actions', keys: ['KeyG'], press: true },
  { id: 'streak', name: 'Use a kill streak reward', group: 'Actions', keys: ['KeyX'], press: true },
  { id: 'streakPick', name: 'Pick which kill streak reward', group: 'Actions', keys: ['KeyZ'], press: true },
  { id: 'selfDestruct', name: 'Self-destruct (hold)', group: 'Actions', keys: ['KeyK'] },
  { id: 'changeClass', name: 'Change class', group: 'Actions', keys: ['KeyC'], classes: true },
  { id: 'scores', name: 'Scoreboard (hold)', group: 'Interface', keys: ['Tab'] },
  { id: 'chat', name: 'Chat (online)', group: 'Interface', keys: ['Enter', 'KeyT'] },
  { id: 'mute', name: 'Mute sound', group: 'Interface', keys: ['KeyM'] },
  { id: 'freeCam', name: 'Spectating: free camera, or back to following', group: 'Interface', keys: ['Space'] },
];
const BY_ID = new Map(ACTIONS.map(a => [a.id, a]));
/** The most keys one action can have. */
export const MAX_KEYS = 4;
// Actions that may share a key: E plants or defuses where you can, and switches weapons anywhere
// else; Space jumps, and spectating, switches to the free camera.
const SHARED = [['use', 'next'], ['freeCam', 'jump']];
const shares = (a, b) => SHARED.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

// Keys on both sides of the keyboard count as one.
const SIDES = {
  ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Control', ControlRight: 'Control',
  AltLeft: 'Alt', AltRight: 'Alt', MetaLeft: 'Meta', MetaRight: 'Meta', OSLeft: 'Meta', OSRight: 'Meta',
};
/** A key event's key, as bindings have it ('ShiftLeft' -> 'Shift'). */
export const keyOf = code => SIDES[code] || code;
/** A mouse button's key. */
export const mouseKey = button => `Mouse${button}`;

const VALID = /^(Key[A-Z]|Digit\d|Numpad\w+|Arrow(Up|Down|Left|Right)|F\d{1,2}|Shift|Control|Alt|Meta|Mouse[0-4]|Wheel(Up|Down)|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|CapsLock|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|IntlBackslash|IntlRo|IntlYen|ContextMenu)$/;
/** Whether a key can be bound (Esc can't: it's the menu's). */
export const canBind = key => typeof key === 'string' && VALID.test(key);

const defaults = () => new Map(ACTIONS.map(a => [a.id, [...a.keys]]));
let binds = defaults();
let version = 0; // (goes up with every change, so anything worked out from the keys can be worked out again)

/** The keys bound to an action. */
export const keysFor = id => binds.get(id) || [];
/** Whether a key (as keyOf gives it) is one of an action's. */
export const isKey = (id, key) => keysFor(id).includes(key);
/** Goes up with every change of keys. */
export const keysVersion = () => version;

/**
 * Use the keys saved in Settings: { action: [keys] } for the actions changed from their
 * defaults (anything unknown or not a key is ignored). Returns the keys as they now are.
 */
export function setKeys(saved = {}) {
  binds = defaults();
  if (saved && typeof saved === 'object') {
    for (const [id, keys] of Object.entries(saved)) {
      if (!BY_ID.has(id) || !Array.isArray(keys)) continue;
      binds.set(id, [...new Set(keys.filter(canBind))].slice(0, MAX_KEYS));
    }
  }
  version++;
  return savedKeys();
}

/** The keys to save: just the actions changed from their defaults. */
export function savedKeys() {
  const out = {};
  for (const a of ACTIONS) {
    const now = keysFor(a.id);
    if (now.length !== a.keys.length || now.some((k, i) => k !== a.keys[i])) out[a.id] = [...now];
  }
  return out;
}

/**
 * Bind a key to an action, in place of its key number `at` (or as an extra one, past its
 * last). The key leaves any other action it was bound to (except ones that share keys).
 * Returns the ids of the actions it was taken from.
 */
export function bindKey(id, at, key) {
  if (!BY_ID.has(id) || !canBind(key)) return [];
  const keys = [...keysFor(id)];
  let pos = at;
  if (pos >= 0 && pos < keys.length) keys[pos] = key;
  else if (keys.length < MAX_KEYS) { keys.push(key); pos = keys.length - 1; }
  else return [];
  const taken = [];
  for (const [other, list] of binds) {
    if (other === id || shares(id, other) || !list.includes(key)) continue;
    binds.set(other, list.filter(k => k !== key));
    taken.push(other);
  }
  // (Already one of this action's keys elsewhere: just the once, where it's been put.)
  binds.set(id, keys.filter((k, i) => k !== key || i === pos));
  version++;
  return taken;
}

/** Take an action's key number `at` off it. */
export function unbindKey(id, at) {
  const keys = keysFor(id);
  if (at < 0 || at >= keys.length) return;
  binds.set(id, keys.filter((_, i) => i !== at));
  version++;
}

/** Back to the keys the game starts with. */
export function resetKeys() { return setKeys({}); }

/** The actions read as presses, and the keys of theirs (worked out again when the keys change). */
let pressCache = { version: -1, keys: new Set() };
export function pressKeys() {
  if (pressCache.version !== version) {
    const keys = new Set();
    for (const a of ACTIONS) if (a.press) for (const k of keysFor(a.id)) keys.add(k);
    pressCache = { version, keys };
  }
  return pressCache.keys;
}

/** Every key bound to anything (the browser's own use of them is kept out of the game while it's played). */
let boundCache = { version: -1, keys: new Set() };
export function boundKeys() {
  if (boundCache.version !== version) {
    const keys = new Set();
    for (const list of binds.values()) for (const k of list) keys.add(k);
    boundCache = { version, keys };
  }
  return boundCache.keys;
}

// ---- Names, for Settings and the HUD -----------------------------------------------------

const NAMES = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down', CapsLock: 'Caps Lock', ContextMenu: 'Menu',
  Shift: 'Shift', Control: 'Ctrl', Alt: 'Alt', Meta: 'Cmd',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
  WheelUp: 'Wheel up', WheelDown: 'Wheel down',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', IntlBackslash: '\\',
};
// (Where the browser can say what's printed on each key, for keyboards other than QWERTY.)
let layout = null;
/** What's printed on the keys of this keyboard (Chrome and Edge can say): names follow it. */
export function useLayout(map) { layout = map || null; version++; }

/** A key's name, as printed on the keyboard ('KeyW' -> 'W'). */
export function keyName(key) {
  if (!key) return '';
  if (/^(Key[A-Z]|Digit\d|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|IntlBackslash)$/.test(key) && layout?.get) {
    const printed = layout.get(key);
    if (printed && printed.trim()) return printed.toUpperCase();
  }
  if (NAMES[key]) return NAMES[key];
  let m = /^Key([A-Z])$/.exec(key) || /^Digit(\d)$/.exec(key);
  if (m) return m[1];
  if ((m = /^Numpad(.+)$/.exec(key))) return `Num ${{ Add: '+', Subtract: '-', Multiply: '*', Divide: '/', Decimal: '.', Enter: 'Enter', Equal: '=' }[m[1]] ?? m[1]}`;
  return key;
}

/**
 * Text naming keys, as each player has them: '{key:selfDestruct}' becomes that action's key's
 * name. (The game writes its notes this way, so online, where the host writes them, everyone
 * still sees their own keys.)
 */
export const keyText = text => typeof text === 'string' && text.includes('{key:') ? text.replace(/\{key:(\w+)\}/g, (_, id) => keyLabel(id)) : text;

/** An action's (first) key's name, for hints on the screen ('Unbound' if it has none). */
const labels = new Map();
let labelsVersion = -1;
export function keyLabel(id) {
  // (Kept until the keys change: the HUD asks every frame.)
  if (labelsVersion !== version) { labels.clear(); labelsVersion = version; }
  let l = labels.get(id);
  if (l == null) { l = keyName(keysFor(id)[0]) || 'Unbound'; labels.set(id, l); }
  return l;
}

/** An action's (first) key, named in at most 4 letters (for the weapon bar's slots), or '' if it has none. */
const SHORT = { Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'M4', Mouse4: 'M5', WheelUp: 'WhUp', WheelDown: 'WhDn', Space: 'Spc', Enter: 'Ent', Backspace: 'Bksp', Delete: 'Del', Insert: 'Ins', PageUp: 'PgUp', PageDown: 'PgDn', CapsLock: 'Caps', Control: 'Ctrl', Shift: 'Shft' };
const shorts = new Map();
let shortsVersion = -1;
export function keyShort(id) {
  if (shortsVersion !== version) { shorts.clear(); shortsVersion = version; }
  let l = shorts.get(id);
  if (l == null) {
    const key = keysFor(id)[0];
    const m = key && /^Numpad(\d)$/.exec(key);
    l = !key ? '' : SHORT[key] || (m ? `N${m[1]}` : keyName(key).slice(0, 4));
    shorts.set(id, l);
  }
  return l;
}

/** The action for weapon slot i (0-9: Weapon 1-10; 10: the sledgehammer). */
export const slotAction = i => (i >= 10 ? 'melee' : `slot${i + 1}`);
/** All an action's keys' names ('W / Space / ↑'). */
export const keyLabels = (id, sep = ' / ') => keysFor(id).map(keyName).join(sep) || 'Unbound';
