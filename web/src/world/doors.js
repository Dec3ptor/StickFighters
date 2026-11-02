// Doors (world mode). A door is three blocks tall: right click opens or shuts it, and it stays
// as you leave it. Walking into a closed door opens it too (for players, their mercenaries and
// townsfolk, never monsters), and a door opened that way shuts again by itself once nobody's
// in it: so a town's houses and a city's gates can be walked through, and still keep monsters
// out at night.

import * as K from './blocks.js';
import { TILE } from './blocks.js';
import { BODY } from '../config.js';

const DOORS = new Set([K.DOOR, K.DOOR_OPEN]);
const SHUT_AFTER = 40; // updates with nobody in it before a door opened by walking into it shuts

/** The door at (tx, ty): { top, bottom } (its rows), or null. */
export function doorAt(world, tx, ty) {
  if (!DOORS.has(world.tile(tx, ty))) return null;
  let top = ty, bottom = ty;
  while (DOORS.has(world.tile(tx, top - 1))) top--;
  while (DOORS.has(world.tile(tx, bottom + 1))) bottom++;
  return { top, bottom };
}

/** True if a living soldier is in tiles (tx, ty0..ty1). */
export function soldierIn(game, tx, ty0, ty1) {
  const l = tx * TILE, r = l + TILE, t = ty0 * TILE, b = (ty1 + 1) * TILE;
  for (const s of game.soldiers) {
    if (!s.alive) continue;
    const bd = s.body, top = bd.crouching ? BODY.crouchTop : BODY.top;
    if (bd.x + BODY.halfW > l && bd.x - BODY.halfW < r && bd.y + BODY.bottom > t && bd.y + top < b) return true;
  }
  return false;
}

/**
 * Open (or, open = false, shut) the door at (tx, ty). auto: opened by walking into it (it
 * shuts by itself again). A door doesn't shut on someone standing in it. Returns true if it moved.
 */
export function setDoor(game, tx, ty, open, auto = false) {
  const world = game.world, d = doorAt(world, tx, ty);
  if (!d) return false;
  const key = `${tx},${d.top}`;
  const autos = (world.autoDoors ||= new Map());
  if (!auto) autos.delete(key);
  const id = open ? K.DOOR_OPEN : K.DOOR;
  if (world.tile(tx, d.top) === id) return false;
  if (!open && soldierIn(game, tx, d.top, d.bottom)) return false;
  for (let y = d.top; y <= d.bottom; y++) world.setTile(tx, y, id);
  if (open && auto) autos.set(key, { tx, top: d.top, bottom: d.bottom, clear: 0 });
  game.sound(open ? 'click' : 'thunk', tx * TILE + 8, (d.top + d.bottom + 1) * TILE / 2);
  return true;
}

/** Soldier s walking toward dir (-1 or 1): a closed door in the way opens. Returns true if one did. */
export function pushDoor(game, s, dir) {
  if (!dir || !s.alive) return false;
  const world = game.world, tx = Math.floor((s.x + dir * (BODY.halfW + 2)) / TILE);
  for (const y of [s.y + BODY.bottom - 3, s.y - 6]) {
    const ty = Math.floor(y / TILE);
    if (world.tile(tx, ty) === K.DOOR) return setDoor(game, tx, ty, true, true);
  }
  return false;
}

/** Each few updates: doors opened by walking into them shut again once nobody's been in them a moment. */
export function doorsTick(game) {
  const world = game.world, autos = world.autoDoors;
  if (!autos?.size || game.tick % 10 !== 0) return;
  for (const [key, d] of autos) {
    if (world.tile(d.tx, d.top) !== K.DOOR_OPEN) { autos.delete(key); continue; }
    if (soldierIn(game, d.tx, d.top, d.bottom)) { d.clear = 0; continue; }
    d.clear += 10;
    if (d.clear >= SHUT_AFTER && setDoor(game, d.tx, d.top, false, true)) autos.delete(key);
  }
}
