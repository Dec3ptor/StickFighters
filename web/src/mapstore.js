// Custom maps saved in this browser (localStorage). Falls back to memory if
// storage is blocked (private browsing), so the editor still works for the visit.

const KEY = 'stick-soldiers-maps';
let memory = [];

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : memory;
  } catch { return memory; }
}

function writeAll(list) {
  memory = list;
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}

/** All saved maps, most recently changed first: [{ id, name, updated, data }]. */
export function listMaps() {
  return readAll().filter(m => m && m.id && m.data).sort((a, b) => b.updated - a.updated);
}

export function getMap(id) {
  return readAll().find(m => m.id === id) || null;
}

/**
 * Save (or update, if it has an id) a map. Extra fields (like `communitySlot`) are kept between saves.
 * Returns the stored record, or null if storage is full.
 */
export function saveMap({ id, name, data, ...extra }) {
  const all = readAll();
  const old = id ? all.find(m => m.id === id) : null;
  const list = all.filter(m => m.id !== id);
  const rec = { ...old, ...extra, id: id || `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, updated: Date.now(), data };
  list.push(rec);
  return writeAll(list) || memory.includes(rec) ? rec : null;
}

export function deleteMap(id) {
  writeAll(readAll().filter(m => m.id !== id));
}
