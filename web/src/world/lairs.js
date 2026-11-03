// Lairs (worlds made since towers: worldgen.js's gen 7), where monsters are worse.
//
// Monster towers fill with monsters as players climb them: on the floor they're on and the ones
// over it, more and worse the higher, the top floors' now and then named champions; and on the
// top floor, the tower's lord, who comes once (again after a long while) and drops its treasure.
// The dangerous lands (the blight, the ashen wastes) have their own monsters out by day as well as
// by night, and more of them: the blight its wraiths, the wastes their fiends.

import * as K from './blocks.js';
import { TILE, SOLID } from './blocks.js';
import { FLOOR_H } from './worldgen.js';
import { spawnMonster, spawnSpot, isMonster, MONSTERS } from './monsters.js';
import { difficultyOf } from './worldrules.js';
import { BODY } from '../config.js';

const LOOK_EVERY = 40;      // updates between looks at who's where
const TOWER_MOST = 7;       // monsters at once in a tower
const DANGER_MOST = 6;      // monsters at once round a player in a dangerous land
const LORD_AGAIN = 60 * 60 * 20; // updates before a tower's lord comes again
const NAMES = ['Gorgath', 'Vexmora', 'the Hollow King', 'Skarn', 'Malgrith', 'the Pale Warden', 'Ulvar', 'Morrag', 'the Ashen Duke', 'Nythra'];

/** The tower's monsters and lord, and the dangerous lands' (the world mode's tick; the host's). */
export function lairsTick(game) {
  const world = game.world, g = world.gen;
  if (!g?.wilds || game.mirror || game.tick % LOOK_EVERY !== 7) return;
  const diff = difficultyOf(world);
  if (world.devQuiet || !diff.spawn) return;
  const lords = world.lords ||= new Map(); // tower region -> when its lord last came
  for (const p of game.soldiers) {
    if (!p.alive || !p.world || p.npc || p.world.dev) continue;
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    const T = g.towerNear(tx, 4);
    if (T && ty >= T.y0 - 4 && ty <= T.base + 2) towerSpawns(game, T, p, ty, lords, diff);
    else dangerSpawns(game, p, tx, ty, diff);
  }
}

/** Which of tower T's floors row ty is on (0: the ground floor). */
export const floorOf = (T, ty) => Math.max(0, Math.min(T.floors - 1, Math.floor((T.base - 1 - ty) / FLOOR_H)));

/** A spot on floor i of tower T for a monster's feet (a tile's middle x, its feet's row), away from the ladders. */
function floorSpot(game, T, i) {
  const world = game.world, row = T.base - i * FLOOR_H - 1;
  for (let attempt = 0; attempt < 8; attempt++) {
    const x = T.x0 + 3 + Math.floor(game.rng() * (T.x1 - T.x0 - 5));
    if (world.tile(x, row) !== K.AIR || world.tile(x, row - 1) !== K.AIR || world.tile(x, row - 2) !== K.AIR || !SOLID[world.tile(x, row + 1)]) continue;
    return { x: x * TILE + TILE / 2, y: (row + 1) * TILE - BODY.bottom - 1 };
  }
  return null;
}

function towerSpawns(game, T, p, ty, lords, diff) {
  const rng = game.rng, inside = o => isMonster(o) && o.alive && o.x >= T.x0 * TILE && o.x <= (T.x1 + 1) * TILE && o.y >= T.top * TILE && o.y <= (T.base + 1) * TILE;
  const here = floorOf(T, ty);
  // The lord: on the top floor, once someone's near the top (and again, long after).
  const last = lords.get(T.k);
  if (here >= T.floors - 3 && (last == null || game.tick - last > LORD_AGAIN) && !game.soldiers.some(o => o.npc?.lord === T.k && o.alive)) {
    const at = floorSpot(game, T, T.floors - 1);
    if (at) {
      lords.set(T.k, game.tick);
      const m = spawnMonster(game, 'tyrant', at.x, at.y);
      m.name = `${NAMES[(T.k % NAMES.length + NAMES.length) % NAMES.length]}, lord of ${T.name}`;
      m.maxHealth = Math.round(MONSTERS.tyrant.health * diff.hp * (T.danger ? 1.4 : 1));
      m.npc.lord = T.k;
      m.npc.champion = 'lord';
      for (const o of game.soldiers) if (o.world && !o.npc && o.x >= (T.x0 - 30) * TILE && o.x <= (T.x1 + 30) * TILE) game.notify(o, `${m.name} stirs at the top of ${T.name}...`);
    }
  }
  let n = 0;
  for (const o of game.soldiers) if (inside(o)) n++;
  if (n >= Math.round(TOWER_MOST * Math.max(1, diff.spawn)) || rng() > 0.55) return;
  // On their floor, or one or two over it: worse the higher up.
  const i = Math.min(T.floors - 1, here + Math.floor(rng() * 3));
  const at = floorSpot(game, T, i);
  if (!at) return;
  const high = i / Math.max(1, T.floors - 1), r = rng();
  const own = T.danger === 2 ? 'fiend' : T.danger === 1 ? 'wraith' : 'skeleton';
  const type = high > 0.6 && r < 0.35 ? 'brute' : r < 0.4 + high * 0.3 ? own : r < 0.75 ? 'skeleton' : 'zombie';
  const m = spawnMonster(game, type, at.x, at.y);
  m.npc.lair = T.k;
  // (The top floors: now and then a named one.)
  if (high > 0.5 && rng() < 0.12) {
    m.name = `${NAMES[Math.floor(rng() * NAMES.length)]} the ${MONSTERS[type].name.toLowerCase()}`;
    m.maxHealth = Math.round(MONSTERS[type].health * (type === 'brute' ? 3 : 4));
    m.npc.champion = 'tower';
  }
}

function dangerSpawns(game, p, tx, ty, diff) {
  const world = game.world, g = world.gen, b = g.column(tx).biome;
  if (!b.danger || ty > world.gen.surfaceAt(tx) + 12) return;
  let n = 0;
  for (const o of game.soldiers) if (isMonster(o) && o.alive && Math.abs(o.x - p.x) < 60 * TILE && Math.abs(o.y - p.y) < 40 * TILE) n++;
  if (n >= Math.round(DANGER_MOST * Math.max(1, diff.spawn)) || game.rng() > 0.35 * Math.max(0.5, diff.spawn)) return;
  const spot = spawnSpot(game, tx, ty, false);
  if (!spot) return;
  const r = game.rng(), own = b.danger === 2 ? 'fiend' : 'wraith';
  const type = r < 0.5 ? own : r < 0.75 ? (b.danger === 2 ? 'brute' : 'zombie') : 'skeleton';
  const m = spawnMonster(game, type, spot.tx * TILE + TILE / 2, (spot.ty + 1) * TILE - BODY.bottom - 1);
  if (game.rng() < 0.06) {
    m.name = `${NAMES[Math.floor(game.rng() * NAMES.length)]} the ${MONSTERS[type].name.toLowerCase()}`;
    m.maxHealth = Math.round(MONSTERS[type].health * 3);
    m.npc.champion = 'wild';
  }
}
