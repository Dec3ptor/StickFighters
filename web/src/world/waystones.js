// Waystones (world mode): standing stones that take you between each other. Put one down (made at
// an anvil) and it's named for where it is (the town near it, or the land: "Raventon waystone",
// "Desert waystone 2"); right click one for the list of all the others in the world, nearest
// first, and pick one to go there at once, your mercenaries with you. Anyone can use anyone's:
// they're the world's. (Online: the host has the list, and the journey.)

import * as K from './blocks.js';
import { TILE } from './blocks.js';
import { BODY } from '../config.js';
import { townsNear } from './townsfolk.js';

/** Updates between journeys (a waystone needs a while to gather itself again). */
export const WARP_COOL = 60 * 15;
// How near a waystone you have to be to use it (px).
const NEAR = 6 * TILE + 24;

const keyOf = (tx, ty) => `${tx},${ty}`;
const BIOME_NAMES = { plains: 'Plains', forest: 'Forest', mountains: 'Mountain', desert: 'Desert', badlands: 'Badlands', jungle: 'Jungle', tundra: 'Tundra' };

/** A world's waystones: key -> { tx, ty, name, owner }. */
const all = world => (world.waystones ||= new Map());

/** A waystone at (tx, ty) put down by `owner`: named, and kept. */
export function addWaystone(world, tx, ty, owner = '') {
  const near = townsNear(world.gen, tx, 140).sort((a, b) => Math.abs((a.x0 + a.x1) / 2 - tx) - Math.abs((b.x0 + b.x1) / 2 - tx))[0];
  const deep = ty - world.gen.surfaceAt(tx) > 20;
  const base = near ? near.name : `${BIOME_NAMES[world.gen.biomeAt(tx)?.key] || 'Wild'}${deep ? ' Deep' : ''}`;
  const taken = new Set([...all(world).values()].map(w => w.name));
  let name = `${base} waystone`;
  for (let i = 2; taken.has(name); i++) name = `${base} waystone ${i}`;
  const w = { tx, ty, name, owner: String(owner).slice(0, 24) };
  all(world).set(keyOf(tx, ty), w);
  return w;
}

/** The waystone at (tx, ty) is gone. */
export function removeWaystone(world, tx, ty) { all(world).delete(keyOf(tx, ty)); }

/** The waystone at (tx, ty), if there's one there (one found without a record, from before: given one). */
export function waystoneAt(world, tx, ty) {
  if (world.tile(tx, ty) !== K.WAYSTONE) return null;
  return all(world).get(keyOf(tx, ty)) || addWaystone(world, tx, ty);
}

/** Which way, and how far, (tx, ty) is from (fx, fy): '240 east, 30 down'. */
function way(fx, fy, tx, ty) {
  const dx = tx - fx, dy = ty - fy, out = [];
  if (Math.abs(dx) >= 1) out.push(`${Math.abs(dx)} ${dx > 0 ? 'east' : 'west'}`);
  if (Math.abs(dy) >= 3) out.push(`${Math.abs(dy)} ${dy > 0 ? 'down' : 'up'}`);
  return out.join(', ') || 'here';
}

/**
 * The menu player s sees at the waystone at (tx, ty) (socialui.js's PlayerMenu shows it): where
 * it is, and every other waystone, nearest first.
 */
export function waystoneMenu(game, s, tx, ty) {
  const here = waystoneAt(game.world, tx, ty);
  if (!here) return null;
  const others = [...all(game.world).values()].filter(w => w !== here && game.world.tile(w.tx, w.ty) === K.WAYSTONE);
  others.sort((a, b) => Math.hypot(a.tx - tx, a.ty - ty) - Math.hypot(b.tx - tx, b.ty - ty));
  return {
    kind: 'waystone', id: keyOf(tx, ty), name: here.name,
    sub: others.length ? `Where to? (${others.length} other waystone${others.length > 1 ? 's' : ''})` : 'No other waystones yet: put one down somewhere else',
    options: others.slice(0, 9).map(w => ({ op: keyOf(w.tx, w.ty), label: `${w.name} · ${way(tx, ty, w.tx, w.ty)}` })),
  };
}

/** Player s goes from the waystone `from` to the waystone `to` (keys 'tx,ty'). Returns what to tell them. */
export function warp(game, s, from, to) {
  const world = game.world, w = s.world;
  const a = typeof from === 'string' ? all(world).get(from) : null, b = typeof to === 'string' ? all(world).get(to) : null;
  if (!w || !s.alive || !a || !b || a === b) return null;
  if (world.tile(a.tx, a.ty) !== K.WAYSTONE || world.tile(b.tx, b.ty) !== K.WAYSTONE) return 'That waystone is gone';
  if (Math.hypot(a.tx * TILE + 8 - s.x, a.ty * TILE + 8 - s.y) > NEAR) return 'Stand by the waystone to use it';
  if (w.warpAt != null && game.tick - w.warpAt < WARP_COOL && game.tick >= w.warpAt) return `The waystone is still gathering itself (${Math.ceil((WARP_COOL - (game.tick - w.warpAt)) / 60)} s)`;
  w.warpAt = game.tick;
  game.fx?.sparks?.(s.x, s.y - 14, 0, -1);
  game.sound('respawnItem', s.x, s.y);
  const x = b.tx * TILE + TILE / 2, y = (b.ty + 1) * TILE - BODY.bottom - 1;
  s.body.x = x; s.body.y = y; s.body.vx = 0; s.body.vy = 0;
  // (Their mercenaries come too.)
  for (const m of game.soldiers) {
    if (m.alive && m.npc?.kind === 'merc' && m.npc.owner === s.id) { m.body.x = x - s.facing * 20; m.body.y = y; m.body.vx = m.body.vy = 0; }
  }
  game.sound('respawnItem', x, y);
  game.fx?.sparks?.(x, y - 14, 0, -1);
  return `You step through to ${b.name}`;
}

/** A world's waystones as saved: [[tx, ty, name, owner]]. */
export const waystonesToSave = world => [...all(world).values()].filter(w => world.tile(w.tx, w.ty) === K.WAYSTONE).map(w => [w.tx, w.ty, w.name, w.owner]);

/** A world's waystones from a save. */
export function waystonesFromSave(world, list) {
  world.waystones = new Map();
  if (!Array.isArray(list)) return;
  for (const r of list) if (Array.isArray(r) && Number.isInteger(r[0]) && Number.isInteger(r[1])) world.waystones.set(keyOf(r[0], r[1]), { tx: r[0], ty: r[1], name: String(r[2] || 'Waystone').slice(0, 40), owner: String(r[3] || '').slice(0, 24) });
}
