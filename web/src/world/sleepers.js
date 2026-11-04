// Creatures out of everyone's way sleep where they are (worlds; the host's). A monster or an animal
// far from every player (and from where a sniper's far view looks: main.js's world.lookAt) is kept,
// where it stood, as hurt as it was, with its name, its kind and what's its own (a tower's
// monster, a quest's quarry or a champion; an animal's age, colour, wool and whose it is), rather
// than let go; and it wakes there, as it was, when someone comes back near. Time stands still for
// it meanwhile (a young animal grows no older asleep). The townsfolk keep their places their own
// way (townsfolk.js). All of it is kept in the world's save, those awake too: what was out there
// is there when you come back, whenever that is.
//
// Not kept: monsters raiding a town or a base (they come and go with the raid), and those
// summoned to someone's side (they keep up with them).

import { TILE } from './blocks.js';
import { CHUNK } from './worldgen.js';
import { spawnMonster, isMonster, MONSTERS } from './monsters.js';
import { spawnAnimal, isAnimal, ANIMALS } from './animals.js';

/** Tiles (the larger way) from everyone that a creature sleeps at (short of where they'd have gone: monsters.js, animals.js). */
export const SLEEP_AT = 100;
/** And nearer than this, it wakes (a little nearer: not asleep and awake by turns). */
export const WAKE_AT = 90;
const EVERY = 15;             // updates between looks
const MOST_HERE = 64;         // asleep in one chunk, at most (the longest asleep let go first, but for those that are someone's or named)
const MOST = 2000;            // asleep in all
const R = CHUNK * TILE;       // a chunk across, px
// (An animal's own that are counted in updates: kept as how long before it slept, so time stands still.)
const TICKED = ['baby', 'shorn', 'eggAt', 'love', 'bredAt'];
// (What's its own of a monster, and of an animal, to keep.)
const MONSTER_KEEP = ['champion', 'lair', 'lord'];
const ANIMAL_KEEP = ['baby', 'variant', 'kept', 'shorn', 'eggAt', 'love', 'bredAt'];

const chunkOf = (x, y) => `${Math.floor(x / R)},${Math.floor(y / R)}`;
/** Whether a record's one to keep before others, when there are too many: an animal that's someone's (fed, bred), or a named monster (a champion, a lord). */
const dear = r => !!(r.own?.kept || r.own?.champion || r.own?.lord);

/** Whether soldier s sleeps when far from everyone (rather than going as before). */
export function sleeps(s) {
  const n = s?.npc;
  if (!n || !s.alive || !n.spawned) return false;
  if (n.kind === 'animal') return true;
  return n.kind === 'monster' && n.raid == null && n.baseRaid == null && n.ally == null && !!MONSTERS[n.type];
}

/** Soldier s as kept asleep (or saved): what it is, where, how hurt, what's its own. tick: the game's now. */
export function recordOf(s, tick) {
  const n = s.npc, keep = n.kind === 'animal' ? ANIMAL_KEEP : MONSTER_KEEP, own = {};
  for (const k of keep) {
    if (n[k] == null) continue;
    own[k] = TICKED.includes(k) && n.kind === 'animal' && typeof n[k] === 'number' ? n[k] - tick : n[k];
  }
  return { kind: n.kind, type: n.type, name: s.name, x: Math.round(s.x), y: Math.round(s.y), hp: Math.round(s.health), max: Math.round(s.maxHealth), own };
}

/** A creature kept asleep (or saved), awake again at the next update, where it was. tick: the game's now. */
export function wakeRecord(game, r, tick) {
  let s;
  if (r.kind === 'animal') {
    if (!ANIMALS[r.type]) return null;
    const own = {};
    for (const [k, v] of Object.entries(r.own || {})) own[k] = TICKED.includes(k) && typeof v === 'number' ? v + tick : v;
    s = spawnAnimal(game, r.type, r.x, r.y, own);
  } else if (r.kind === 'monster') {
    if (!MONSTERS[r.type]) return null;
    s = spawnMonster(game, r.type, r.x, r.y);
    for (const [k, v] of Object.entries(r.own || {})) s.npc[k] = v;
  } else return null;
  if (typeof r.name === 'string' && r.name) s.name = r.name.slice(0, 60);
  if (r.max > 0) s.maxHealth = r.max;
  // (As hurt as it was: worldplay.js's spawnLoadout.)
  if (r.hp > 0) s.npc.wakeHealth = r.hp;
  return s;
}

/** Where they sleep: the world's, by chunk. */
function asleep(world) { return world.sleepers ||= new Map(); }

/** Creature s, asleep where it is (out of the game till someone comes back). */
export function lull(game, s) {
  const world = game.world, all = asleep(world), key = chunkOf(s.x, s.y);
  const r = recordOf(s, game.tick);
  r.at = game.tick;
  let list = all.get(key);
  if (!list) all.set(key, list = []);
  list.push(r);
  world.sleeperCount = (world.sleeperCount || 0) + 1;
  // (Too many in one place: the longest asleep let go, those that are someone's or named last.)
  if (list.length > MOST_HERE) {
    const i = list.findIndex(o => !dear(o));
    list.splice(i >= 0 ? i : 0, 1);
    world.sleeperCount--;
  }
  game.removeSoldier(s);
}

/** How many are asleep within (rx, ry) px of (x, y) that `ok` agrees to (spawning counts them: no more crowding in than there'd be awake). */
export function asleepNear(world, x, y, rx, ry, ok = null) {
  const all = world.sleepers;
  if (!all?.size) return 0;
  let n = 0;
  for (let cx = Math.floor((x - rx) / R); cx <= Math.floor((x + rx) / R); cx++) {
    for (let cy = Math.floor((y - ry) / R); cy <= Math.floor((y + ry) / R); cy++) {
      for (const r of all.get(`${cx},${cy}`) || []) if (Math.abs(r.x - x) <= rx && Math.abs(r.y - y) <= ry && (!ok || ok(r))) n++;
    }
  }
  return n;
}

/** Whether any creature asleep anywhere is one `ok` agrees to (a quest's quarry, say: not made again). */
export function asleepAny(world, ok) {
  for (const list of world.sleepers?.values() || []) if (list.some(ok)) return true;
  return false;
}

/**
 * Each update (the world mode's tick; the host's): those far from everyone sleep, and those asleep
 * near someone (where the land's made, for them to stand on) wake.
 */
export function sleepersTick(game) {
  const world = game.world;
  if (game.mirror || game.tick % EVERY !== 5) return;
  const players = game.soldiers.filter(s => s.alive && s.world && !s.npc);
  if (world.lookAt) players.push({ x: world.lookAt.x, y: world.lookAt.y });
  // (Nobody about at all, as when the world's just begun: nothing changes.)
  if (!players.length) return;
  const far = (x, y, d) => players.every(p => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) > d * TILE);
  for (const s of game.soldiers) if (sleeps(s) && far(s.x, s.y, SLEEP_AT)) lull(game, s);
  const all = world.sleepers;
  if (!all?.size) return;
  const reach = WAKE_AT * TILE;
  for (const p of players) {
    for (let cx = Math.floor((p.x - reach) / R); cx <= Math.floor((p.x + reach) / R); cx++) {
      for (let cy = Math.floor((p.y - reach) / R); cy <= Math.floor((p.y + reach) / R); cy++) {
        const key = `${cx},${cy}`, list = all.get(key);
        if (!list || !world.has(cx, cy)) continue;
        for (let i = list.length - 1; i >= 0; i--) {
          const r = list[i];
          if (Math.max(Math.abs(r.x - p.x), Math.abs(r.y - p.y)) > reach) continue;
          list.splice(i, 1);
          world.sleeperCount = Math.max(0, (world.sleeperCount || 1) - 1);
          wakeRecord(game, r, game.tick);
        }
        if (!list.length) all.delete(key);
      }
    }
  }
  // (Too many asleep in all: the longest asleep let go.)
  if ((world.sleeperCount || 0) > MOST) trim(world);
}

/** Down to the most kept asleep, the longest asleep let go first (those that are someone's or named, last). */
function trim(world) {
  const all = [...world.sleepers.entries()].flatMap(([key, list]) => list.map(r => [key, r]));
  all.sort((a, b) => dear(a[1]) - dear(b[1]) || (a[1].at ?? 0) - (b[1].at ?? 0));
  for (const [key, r] of all.slice(0, all.length - MOST)) {
    const list = world.sleepers.get(key);
    list.splice(list.indexOf(r), 1);
    if (!list.length) world.sleepers.delete(key);
  }
  world.sleeperCount = Math.min(all.length, MOST);
}

// ---- Saving ------------------------------------------------------------------------------------------

/** The world's creatures as saved: those asleep, and those awake (that would sleep), as they are now. */
export function sleepersToSave(game) {
  const out = [];
  for (const list of game.world.sleepers?.values() || []) for (const r of list) out.push(clean(r));
  for (const s of game.soldiers) if (sleeps(s)) out.push(recordOf(s, game.tick));
  return out;
}

/** The world's creatures from a save: all asleep, till someone comes near. */
export function sleepersFromSave(world, data) {
  world.sleepers = new Map();
  world.sleeperCount = 0;
  if (!Array.isArray(data)) return;
  for (const raw of data.slice(0, MOST)) {
    const r = cleanRecord(raw);
    if (!r) continue;
    const key = chunkOf(r.x, r.y);
    let list = world.sleepers.get(key);
    if (!list) world.sleepers.set(key, list = []);
    if (list.length >= MOST_HERE) continue;
    r.at = 0;
    list.push(r);
    world.sleeperCount++;
  }
}

/** A record as saved (without when it fell asleep: another game's counting). */
function clean(r) { const { at, ...rest } = r; return rest; }

/** A record from a save, only as it should be (or null). */
function cleanRecord(r) {
  if (!r || typeof r !== 'object' || (r.kind !== 'monster' && r.kind !== 'animal')) return null;
  if (r.kind === 'monster' ? !MONSTERS[r.type] : !ANIMALS[r.type]) return null;
  if (![r.x, r.y].every(Number.isFinite)) return null;
  const keep = r.kind === 'animal' ? ANIMAL_KEEP : MONSTER_KEEP, own = {};
  for (const k of keep) {
    const v = r.own?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) own[k] = v;
    else if ((typeof v === 'string' && v.length < 80) || typeof v === 'boolean') own[k] = v;
  }
  return {
    kind: r.kind, type: r.type, name: typeof r.name === 'string' ? r.name.slice(0, 60) : '',
    x: r.x, y: r.y, hp: Number.isFinite(r.hp) ? r.hp : 0, max: Number.isFinite(r.max) ? r.max : 0, own,
  };
}
