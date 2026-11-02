// Worlds kept in this browser (world mode): each world's name and seed, your things and where
// you were, and every chunk that's been changed from what the seed makes (the rest are made
// from the seed again). Kept in IndexedDB; where a browser has none (some private windows),
// in memory, until the page is closed.
//
// A world can be exported to a file and imported again (here, or in another browser): chunks
// are kept as runs of the same block (most of a chunk is), in base64.

import { CHUNK } from './worldgen.js';

const DB_NAME = 'stickfighters-worlds';
const DB_VERSION = 1;
const SIZE = CHUNK * CHUNK;
/** What an exported world file says it is. */
export const FILE_KIND = 'stick-soldiers-world';
export const FILE_EXT = '.ssworld';
const MAX_NAME = 32;

let dbWait = null;
// (No IndexedDB: kept here.)
const mem = { worlds: new Map(), chunks: new Map() };

/** The database (null where there's none to be had). */
function db() {
  dbWait ||= new Promise(resolve => {
    let req;
    try {
      if (!globalThis.indexedDB) { resolve(null); return; }
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('worlds')) d.createObjectStore('worlds', { keyPath: 'id' });
      // (Chunks by [world id, chunk key].)
      if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbWait;
}

const done = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('Saving was stopped'));
});
const result = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const chunkRange = id => IDBKeyRange.bound([id, -Infinity], [id, Infinity]);

/** A world's name, tidied ('' becomes 'World'). */
export const worldName = name => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) || 'World';

function newId() {
  return globalThis.crypto?.randomUUID?.() || `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Every world kept here, the last played first. */
export async function listWorlds() {
  const d = await db();
  const list = d ? await result(d.transaction('worlds').objectStore('worlds').getAll()) : [...mem.worlds.values()].map(w => structuredClone(w));
  return list.sort((a, b) => (b.played || 0) - (a.played || 0));
}

/** A world kept here, by its id (or null). */
export async function getWorld(id) {
  const d = await db();
  if (!d) return mem.worlds.has(id) ? structuredClone(mem.worlds.get(id)) : null;
  return (await result(d.transaction('worlds').objectStore('worlds').get(id))) || null;
}

/** A new world (kept straight away): { id, name, seed, created, played, player }. */
export async function createWorld({ name, seed }) {
  const now = Date.now();
  const rec = { id: newId(), name: worldName(name), seed: seed | 0, created: now, played: now, player: null, format: 1 };
  await saveWorld(rec, []);
  return rec;
}

/** The chunks changed in world `id`: a Map of chunk key -> { fg, bg, shape }. */
export async function loadChunks(id) {
  const d = await db();
  const out = new Map();
  if (!d) {
    for (const [k, c] of mem.chunks.get(id) || []) out.set(k, { fg: c.fg.slice(), bg: c.bg.slice(), shape: c.shape.slice() });
    return out;
  }
  const store = d.transaction('chunks').objectStore('chunks');
  const range = chunkRange(id);
  const [keys, values] = await Promise.all([result(store.getAllKeys(range)), result(store.getAll(range))]);
  for (let i = 0; i < keys.length; i++) {
    const c = values[i];
    if (okChunk(c)) out.set(keys[i][1], c);
  }
  return out;
}

const okChunk = c => c && [c.fg, c.bg, c.shape].every(a => a instanceof Uint8Array && a.length === SIZE);

/**
 * Keep world `rec` (its record), and `chunks` (TileWorld chunks, or { cx, cy, key, fg, bg, shape }),
 * all in one go.
 */
export async function saveWorld(rec, chunks) {
  const d = await db();
  const copy = c => ({ fg: c.fg.slice(), bg: c.bg.slice(), shape: c.shape.slice() });
  if (!d) {
    mem.worlds.set(rec.id, structuredClone(rec));
    const m = mem.chunks.get(rec.id) || new Map();
    mem.chunks.set(rec.id, m);
    for (const c of chunks) m.set(c.key ?? keyOf(c), copy(c));
    return;
  }
  const tx = d.transaction(['worlds', 'chunks'], 'readwrite');
  tx.objectStore('worlds').put(rec);
  const store = tx.objectStore('chunks');
  // (Copied as they are now: put() takes its copy straight away.)
  for (const c of chunks) store.put({ fg: c.fg, bg: c.bg, shape: c.shape }, [rec.id, c.key ?? keyOf(c)]);
  await done(tx);
}

const keyOf = c => (c.cx + 1048576) * 64 + c.cy;

/** Forget world `id`, and its chunks. */
export async function deleteWorld(id) {
  const d = await db();
  if (!d) { mem.worlds.delete(id); mem.chunks.delete(id); return; }
  const tx = d.transaction(['worlds', 'chunks'], 'readwrite');
  tx.objectStore('worlds').delete(id);
  tx.objectStore('chunks').delete(chunkRange(id));
  await done(tx);
}

// ---- Files -----------------------------------------------------------------------------------------

/** Runs of the same byte: [byte, how many (1-255)]... in base64. */
export function packBytes(a) {
  const out = [];
  for (let i = 0; i < a.length;) {
    const v = a[i];
    let n = 1;
    while (i + n < a.length && a[i + n] === v && n < 255) n++;
    out.push(v, n);
    i += n;
  }
  let s = '';
  for (let i = 0; i < out.length; i += 8192) s += String.fromCharCode(...out.slice(i, i + 8192));
  return btoa(s);
}

/** packBytes undone: `size` bytes, or null if that's not what it holds. */
export function unpackBytes(text, size = SIZE) {
  let s;
  try { s = atob(String(text)); } catch { return null; }
  if (s.length % 2) return null;
  const a = new Uint8Array(size);
  let at = 0;
  for (let i = 0; i < s.length; i += 2) {
    const v = s.charCodeAt(i), n = s.charCodeAt(i + 1);
    if (!n || at + n > size) return null;
    a.fill(v, at, at + n);
    at += n;
  }
  return at === size ? a : null;
}

/** World `id` as a file's text (JSON), and the file's name. */
export async function exportWorld(id) {
  const rec = await getWorld(id);
  if (!rec) throw new Error('That world is gone');
  const chunks = await loadChunks(id);
  const data = {
    kind: FILE_KIND, format: 1, name: rec.name, seed: rec.seed, created: rec.created, played: rec.played, player: rec.player, chests: rec.chests || [], claims: rec.claims || [], players: rec.players || {}, pvp: rec.pvp !== false, time: rec.time || 0,
    chunks: [...chunks].map(([k, c]) => [k, packBytes(c.fg), packBytes(c.bg), packBytes(c.shape)]),
  };
  const file = `${rec.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'world'}${FILE_EXT}`;
  return { text: JSON.stringify(data), file };
}

/** A world from a file's text, kept here as a new world (its name made unique). Returns its record. */
export async function importWorld(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("That file isn't a world"); }
  if (!data || data.kind !== FILE_KIND || !Array.isArray(data.chunks) || !Number.isFinite(data.seed)) throw new Error("That file isn't a world");
  if (data.format > 1) throw new Error('That world is from a newer version of the game');
  const chunks = [];
  for (const row of data.chunks) {
    if (!Array.isArray(row) || !Number.isInteger(row[0]) || row[0] < 0) throw new Error('That world file is damaged');
    const fg = unpackBytes(row[1]), bg = unpackBytes(row[2]), shape = unpackBytes(row[3]);
    if (!fg || !bg || !shape) throw new Error('That world file is damaged');
    chunks.push({ key: row[0], fg, bg, shape });
  }
  const names = new Set((await listWorlds()).map(w => w.name.toLowerCase()));
  let name = worldName(data.name);
  for (let i = 2; names.has(name.toLowerCase()); i++) name = worldName(`${worldName(data.name).slice(0, MAX_NAME - 4)} (${i})`);
  const rec = {
    id: newId(), name, seed: data.seed | 0, created: Number(data.created) || Date.now(), played: Date.now(),
    player: data.player && typeof data.player === 'object' ? data.player : null, chests: Array.isArray(data.chests) ? data.chests : [], claims: Array.isArray(data.claims) ? data.claims : [],
    players: data.players && typeof data.players === 'object' && !Array.isArray(data.players) ? data.players : {}, pvp: data.pvp !== false,
    time: Number.isFinite(data.time) ? data.time : 0, format: 1,
  };
  await saveWorld(rec, chunks);
  return rec;
}
