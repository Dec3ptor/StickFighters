// Classes on: the class and loadouts you play with, saved in this browser.
// Every main weapon and upgrade can be chosen from the start.
//
// Nothing here touches the page, so tests can run it (with a stand-in storage).

import { cleanLoadouts, cleanClass } from './classes.js';

// (The old name, so choices made before carry over.)
export const KIT_KEY = 'stick-soldiers-profile';

/** The choices before any are made: Assault, each class's first main weapon, no upgrades. */
export function newKit() {
  return { cls: 'assault', loadouts: cleanLoadouts(null) };
}

/** Choices read from storage (anything odd in them is dropped). */
export function cleanKit(raw) {
  if (!raw || typeof raw !== 'object') return newKit();
  return { cls: cleanClass(raw.cls) || 'assault', loadouts: cleanLoadouts(raw.loadouts) };
}

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

/** The choices saved in this browser. */
export function loadKit(store = storage()) {
  try { return cleanKit(JSON.parse(store?.getItem(KIT_KEY) || 'null')); } catch { return newKit(); }
}

export function saveKit(k, store = storage()) {
  try { store?.setItem(KIT_KEY, JSON.stringify(cleanKit(k))); } catch { /* private mode or full: keep playing */ }
}
