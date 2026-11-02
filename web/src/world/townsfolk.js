// Townsfolk (world mode): the people who live and work in towns (towns.js). Each building with
// work in it has someone there: villagers in the houses, an elder, a merchant in the shop, a
// blacksmith at the smithy, a gunsmith, an innkeeper, a healer at the temple, guards in the
// barracks, gatehouses and watchtowers, a lord or lady in a city's keep, a trader at the market,
// a farmer at the farm. Who they are (their names and looks, and what they sell: trade.js) comes
// from the world's seed, so they're the same people whenever you come back.
//
// They're soldiers like any other (the same bodies, drawn the same way), each run by a simple
// controller. By day they go about their town, in and out of their doors (the doors shut behind
// them); at night they're at home. Guards walk the streets day and night, and fight monsters that
// come into town. Only guards and monsters fight: nothing else hurts townsfolk (players' shots go
// through them), and they hurt nobody else.
//
// A town's people come when a player comes near it, and go again when everyone's gone far away
// (a guard killed by monsters is back a few hours later). Right click on someone to talk to them
// (talk.js).

import * as K from './blocks.js';
import { TILE, SOLID, PLATFORMS } from './blocks.js';
import { hash3 } from './noise.js';
import { CHUNK } from './worldgen.js';
import { hourOf, isMonster, DAY_TICKS } from './monsters.js';
import { pushDoor } from './doors.js';
import { BODY } from '../config.js';

/** The work people do in towns: what they're called, how they look, how far they go from home. */
export const ROLES = {
  villager: { title: 'Villager', tag: '', skin: 'villager', roam: 34 },
  farmer: { title: 'Farmer', tag: 'Farmer', skin: 'farmer', roam: 14 },
  elder: { title: 'Elder', tag: 'Elder', skin: 'elder', roam: 10 },
  merchant: { title: 'Merchant', tag: 'Merchant', skin: 'merchant', roam: 0 },
  smith: { title: 'Blacksmith', tag: 'Smith', skin: 'smith', roam: 0, held: { kind: 'melee', look: { type: 'mallet', length: 13, color: '#7a5634', head: '#8a8f96' } } },
  gunsmith: { title: 'Gunsmith', tag: 'Gunsmith', skin: 'gunsmith', roam: 0, weapon: 'Beretta' },
  innkeeper: { title: 'Innkeeper', tag: 'Innkeeper', skin: 'innkeeper', roam: 0 },
  healer: { title: 'Healer', tag: 'Healer', skin: 'healer', roam: 6 },
  guard: { title: 'Guard', tag: 'Guard', skin: 'guard', guard: true, health: 220 },
  lord: { title: 'Lord', tag: 'Lord', skin: 'lord', roam: 8 },
  trader: { title: 'Trader', tag: 'Trader', skin: 'trader', roam: 2 },
};

/** First names, by the town's style (towns.js: its names). */
const NAMES = {
  timber: ['Alden', 'Bess', 'Cedric', 'Doran', 'Edith', 'Finn', 'Greta', 'Hal', 'Ida', 'Jory', 'Kit', 'Lena', 'Mabel', 'Ned', 'Orin', 'Pip', 'Rowan', 'Sable', 'Tam', 'Una', 'Wren', 'Agnes', 'Bram', 'Cora', 'Dell', 'Elsie', 'Gil', 'Hester', 'Jem', 'Maud', 'Nell', 'Osric', 'Perrin', 'Quill', 'Rosa', 'Silas', 'Tobin', 'Ada', 'Godwin', 'Linnet'],
  adobe: ['Amir', 'Basma', 'Dalia', 'Farid', 'Hana', 'Idris', 'Jamal', 'Karim', 'Layla', 'Malik', 'Nadia', 'Omar', 'Rania', 'Samir', 'Tariq', 'Yasmin', 'Zahra', 'Aziz', 'Faisal', 'Leila', 'Nasir', 'Salma', 'Yusuf', 'Zaid', 'Mina', 'Rashid', 'Soraya', 'Hadi'],
  cabin: ['Astrid', 'Bjorn', 'Dagny', 'Einar', 'Frida', 'Gunnar', 'Hilde', 'Ingrid', 'Leif', 'Magnus', 'Nils', 'Olga', 'Ragna', 'Sigrid', 'Sven', 'Tora', 'Ulf', 'Vidar', 'Yrsa', 'Erik', 'Freya', 'Halvar', 'Kari', 'Solveig', 'Arne', 'Brynja', 'Torvald', 'Liv'],
  stilt: ['Ahau', 'Chalchi', 'Itzel', 'Kinich', 'Nicte', 'Pakal', 'Tecun', 'Xochi', 'Yaretzi', 'Zyanya', 'Ixchel', 'Balam', 'Citlali', 'Ehecatl', 'Itzli', 'Malinal', 'Nayeli', 'Tlaloc', 'Yolotl', 'Coatl', 'Atl', 'Ichtaca', 'Tonal', 'Xiadani'],
};

/** How many people each kind of building has (a house: one or two). */
const HOW_MANY = { barracks: 2, inn: 1, house: h => 1 + (h % 2) };

/**
 * The people of town t (the same for the same seed): [{ key (who they are: '<town>:<building>:<n>'),
 * town (its id), bi (their building), role, name, title ('Blacksmith', 'Lady'), label (their name
 * tag), home: { x0, x1, base, ground (true: on the town's ground, not up on stilts) }, at: { x, y }
 * (where they come, in tiles: their feet's tile), weapon, guard }]. Worked out once per town plan.
 */
export function folkOf(seed, t) {
  if (t.folk) return t.folk;
  const names = NAMES[t.style.names] || NAMES.timber, used = new Set(), out = [];
  t.buildings.forEach((b, bi) => {
    if (!b.role) return;
    const many = HOW_MANY[b.kind] || 1, n = typeof many === 'function' ? many(hash3(seed, t.k * 97 + bi, 519)) : many;
    for (let j = 0; j < n; j++) {
      const h = hash3(seed, t.k * 97 + bi, 520 + j);
      // (A village's households: some of them farm.)
      const role = b.kind === 'house' && t.kind === 'village' && h % 3 === 0 ? 'farmer' : b.role, def = ROLES[role];
      let i = h % names.length;
      while (used.has(names[i]) && used.size < names.length) i = (i + 1) % names.length;
      used.add(names[i]);
      const name = names[i];
      let title = def.title;
      if (role === 'lord' && (h >>> 8) % 2) title = 'Lady';
      if (role === 'guard' && b.kind === 'tower') title = 'Watchman';
      const tag = role === 'lord' ? title : role === 'guard' && b.kind === 'tower' ? 'Watch' : def.tag;
      // (Guards in a watchtower or at a gate keep near it; the barracks' walk the streets. A gate's
      // guard stands just inside the city, where they can see the street.)
      const post = role === 'guard' && b.kind !== 'barracks';
      let home = { x0: b.x0 + 1, x1: b.x1 - 1, base: b.base, ground: b.base === t.level, kind: b.kind };
      let at = { x: Math.max(b.x0 + 1, Math.min(b.x1 - 1, b.spots[0].x + j * 2)), y: b.spots[0].y };
      if (b.kind === 'gate') {
        const x = b.x0 <= t.x0 + 1 ? b.x1 + 2 : b.x0 - 2;
        at = { x, y: t.level - 1 };
        home = { x0: x - 3, x1: x + 3, base: t.level, ground: true, kind: 'gate' };
      }
      out.push({
        key: `${t.id}:${bi}:${j}`, town: t.id, k: t.k, bi, role, name, title,
        label: tag ? `${name} · ${tag}` : name, home, at,
        weapon: def.guard ? (b.kind === 'tower' ? 'Longbow' : t.kind === 'city' ? 'M4' : 'Beretta') : def.weapon || null,
        guard: !!def.guard, post,
      });
    }
  });
  t.folk = out;
  return out;
}

/** True if s is one of the townsfolk. */
export const isFolk = s => s?.npc?.kind === 'townsfolk';

/** The towns within r tiles (across) of column x. */
export function townsNear(gen, x, r) {
  const out = [];
  if (!gen?.towns) return out;
  for (let k = gen.regionAt(Math.floor(x - r)), last = gen.regionAt(Math.floor(x + r)); k <= last; k++) {
    const t = gen.townIn(k);
    if (t && t.x1 >= x - r && t.x0 <= x + r) out.push(t);
  }
  return out;
}

// ---- Coming and going ------------------------------------------------------------------------------------

const FOLK_EVERY = 30;       // updates between looks round (offset from the monsters')
const COME = 60;             // tiles (across) from where someone lives at which a player brings them
const GO = 110;              // and how far everyone has to be from them for them to go again
const DEEP = 90;             // rows under a town's ground a player can be, and still bring its people
const BACK_AFTER = DAY_TICKS / 6; // a guard killed by monsters is back after this long (four hours)

/** One of the townsfolk, at their place (they appear at the next update). */
export function spawnFolk(game, f, t) {
  const def = ROLES[f.role];
  const npc = { kind: 'townsfolk', role: f.role, key: f.key, town: f.town, guard: f.guard, weapon: f.weapon, held: def.held || null };
  const s = game.addSoldier({ name: f.label, isBot: true, team: 0, skin: def.skin, maxHealth: def.health || 100, profile: { npc } }, new FolkController(f, t));
  s.respawnTimer = 1;
  s.npc.spawnAt = { x: f.at.x * TILE + TILE / 2, y: (f.at.y + 1) * TILE - BODY.bottom - 1 };
  return s;
}

/**
 * Townsfolk come and go (the world mode's tick): each comes when a player comes near where they
 * live (where the land's already made: making it all at once would stutter), and goes when
 * everyone's gone far from them.
 */
export function townsfolkTick(game) {
  const world = game.world, gen = world.gen;
  if (!gen?.towns || game.tick % FOLK_EVERY !== 15) return;
  const folk = world.folk ||= new Map(), gone = world.folkGone ||= new Map(), time = world.time || 0;
  const players = game.soldiers.filter(s => s.alive && s.world);
  // Gone: the dead (a while after: guards come back later), and those everyone's gone far from.
  for (const [key, s] of folk) {
    if (!s.alive && s.npc?.spawned) {
      if (game.tick - (s.npc.diedAt ?? game.tick) > 180) { game.removeSoldier(s); folk.delete(key); gone.set(key, time + BACK_AFTER); }
      continue;
    }
    const x = s.alive ? s.x : s.npc.spawnAt.x, y = s.alive ? s.y : s.npc.spawnAt.y;
    if (!players.some(p => Math.abs(p.x - x) < GO * TILE && Math.abs(p.y - y) < (DEEP + 30) * TILE)) { game.removeSoldier(s); folk.delete(key); }
  }
  // Come: the people near each player.
  for (const p of players) {
    const px = p.x / TILE, py = p.y / TILE;
    for (const t of townsNear(gen, px, COME)) {
      if (py > t.level + DEEP || py < t.top - 60) continue;
      for (const f of folkOf(gen.seed, t)) {
        if (folk.has(f.key) || Math.abs(f.at.x - px) > COME || !world.has(Math.floor(f.at.x / CHUNK), Math.floor(f.at.y / CHUNK))) continue;
        const back = gone.get(f.key);
        if (back != null) { if (time < back) continue; gone.delete(f.key); }
        folk.set(f.key, spawnFolk(game, f, t));
      }
    }
  }
}

/** All the townsfolk gone (a test starting over, say). */
export function clearFolk(game) {
  for (const s of game.soldiers.filter(isFolk)) game.removeSoldier(s);
  game.world.folk?.clear();
}

// ---- How they behave --------------------------------------------------------------------------------------

// (Doors open as they're walked into: they're no wall to townsfolk.)
const DOORS = new Set([K.DOOR, K.DOOR_OPEN]);
const open = (world, x, y) => !SOLID[world.tile(x, y)] || DOORS.has(world.tile(x, y));
const floorAt = (world, x, y) => { const id = world.tile(x, y); return (!!SOLID[id] && !DOORS.has(id)) || !!PLATFORMS?.has?.(id) || id === K.LADDER; };
/** Room to stand with feet in tile (x, y): three blocks of room, and a floor. */
const standsAt = (world, x, y) => open(world, x, y) && open(world, x, y - 1) && open(world, x, y - 2) && floorAt(world, x, y + 1);

/**
 * How far someone can walk either way from column x (feet in row y), in tiles: [lo, hi]. Steps
 * of a block up or down are fine, and doors; a wall, a drop (a well, the edge of a porch on
 * stilts) or `limit` blocks is as far as they go.
 */
export function walkSpan(world, x, y, limit = 80) {
  const span = [x, x];
  for (const dir of [-1, 1]) {
    let cx = x, cy = y;
    for (let n = 0; n < limit; n++) {
      const nx = cx + dir;
      let ny = null;
      if (standsAt(world, nx, cy)) ny = cy;
      else if (standsAt(world, nx, cy - 1) && open(world, cx, cy - 3)) ny = cy - 1;
      else if (standsAt(world, nx, cy + 1)) ny = cy + 1;
      if (ny == null) break;
      cx = nx;
      cy = ny;
    }
    span[dir < 0 ? 0 : 1] = cx;
  }
  return span;
}

/** Whether it's time to be at home: from nine at night to six in the morning. */
export const bedtime = time => { const h = hourOf(time || 0); return h >= 21 || h < 6; };

/** The nearest living monster within (rx, ry) px of s that s can see, or null. */
function nearestMonster(game, s, rx, ry) {
  let best = null, bd = Infinity;
  for (const o of game.soldiers) {
    if (!o.alive || !isMonster(o)) continue;
    const dx = o.x - s.x, dy = o.y - s.y;
    if (Math.abs(dx) > rx || Math.abs(dy) > ry) continue;
    const d = dx * dx + dy * dy;
    if (d < bd && game.world.clearLine(s.shoulderX, s.shoulderY, o.x, o.y - 14)) { bd = d; best = o; }
  }
  return best;
}

export class FolkController {
  /** f: who they are (folkOf), t: their town. */
  constructor(f, t) {
    this.f = f;
    this.t = t;
    this.goal = null;      // the column (px) they're walking to
    this.wait = 0;         // updates to stand where they are
    this.face = 1;
    this.stuck = 0;
    this.lastX = 0;
    this.patrol = 1;
  }

  input(game, s) {
    const inp = { move: 0, jump: false, jumpPressed: false, crouch: false, fire: false, firePressed: false, aim: s.aim, aimDist: 120 };
    const f = this.f, t = this.t, rng = game.rng;
    // Talking to someone (talk.js): they stand and face them.
    const n = s.npc;
    if (n.talkTo != null) {
      const p = game.soldiers.find(o => o.id === n.talkTo);
      if (p && p.alive && game.tick < (n.talkUntil || 0) && Math.abs(p.x - s.x) < 12 * TILE) {
        inp.aim = p.x < s.x ? Math.PI : 0;
        return inp;
      }
      n.talkTo = null;
    }
    // Guards: monsters near are shot at (they close in, to a point).
    if (f.guard) {
      const foe = nearestMonster(game, s, 36 * TILE, 14 * TILE);
      if (foe) {
        const dx = foe.x - s.x, dist = Math.hypot(dx, foe.y - s.y);
        inp.aim = Math.atan2(foe.y - 14 - s.shoulderY, foe.x - s.shoulderX);
        inp.aimDist = dist;
        inp.fire = true;
        inp.firePressed = game.tick % (f.weapon === 'Longbow' ? 40 : 10) === 0;
        this.walk(game, s, inp, dist > 220 ? Math.sign(dx) : dist < 70 ? -Math.sign(dx) : 0, 1);
        this.goal = null;
        return inp;
      }
    }
    if (this.wait > 0) {
      this.wait--;
      inp.aim = this.face < 0 ? Math.PI : 0;
      this.walk(game, s, inp, 0, 0);
      return inp;
    }
    if (this.goal == null) this.goal = this.nextGoal(game, s);
    const dx = this.goal - s.x;
    if (Math.abs(dx) < 6 || this.stuck > 40) {
      // There (or no getting there): a while standing about.
      this.goal = null;
      this.stuck = 0;
      this.face = rng() < 0.5 ? -1 : 1;
      this.wait = Math.floor((f.guard ? 120 : 90) + rng() * (f.guard ? 360 : 420));
      return inp;
    }
    inp.aim = dx < 0 ? Math.PI : 0;
    this.walk(game, s, inp, Math.sign(dx), f.guard ? 0.75 : 0.55);
    return inp;
  }

  /** Where to go next (a column, px): about the town by day, home at night; guards on their rounds. */
  nextGoal(game, s) {
    const f = this.f, t = this.t, h = f.home, rng = game.rng;
    // (Only as far as they can walk from home.)
    const span = this.span ||= walkSpan(game.world, f.at.x, f.at.y, 90);
    const px = x => Math.max(span[0], Math.min(span[1], x)) * TILE + TILE / 2;
    const inside = () => px(h.x0 + 1 + rng() * Math.max(0, h.x1 - h.x0 - 2));
    if (f.guard) {
      if (f.post) return px(Math.max(t.x0 + 2, Math.min(t.x1 - 2, (h.x0 + h.x1) / 2 + (rng() - 0.5) * 16)));
      // (The barracks' guards: from one end of town to the other.)
      this.patrol = -this.patrol;
      return px(this.patrol < 0 ? t.x0 + 4 + rng() * 10 : t.x1 - 4 - rng() * 10);
    }
    const role = ROLES[f.role];
    if (bedtime(game.world.time) || !h.ground || !role.roam || rng() < 0.45) return inside();
    // Out and about: somewhere along the town's street, not too far from home.
    const mid = (h.x0 + h.x1) / 2, x = mid + (rng() * 2 - 1) * role.roam;
    return px(Math.max(t.x0 + 2, Math.min(t.x1 - 2, x)));
  }

  /** Walking toward dir (-1, 0, 1): doors in the way open, and it jumps when it's stopped by something low. */
  walk(game, s, inp, dir, speed) {
    inp.move = dir * speed;
    if (!dir) { this.stuck = 0; return; }
    pushDoor(game, s, dir);
    if (s.body.onGround) {
      this.stuck = Math.abs(s.x - this.lastX) < 0.1 ? this.stuck + 1 : 0;
      // (A step up: jumped. Anything higher, they give up on: stuck.)
      if (this.stuck > 6 && this.stuck < 30 && this.stuck % 12 === 7) {
        const ahead = Math.floor((s.x + dir * (BODY.halfW + 3)) / TILE), feet = Math.floor((s.y + BODY.bottom - 2) / TILE);
        if (!SOLID[game.world.tile(ahead, feet - 1)] && !SOLID[game.world.tile(ahead, feet - 2)]) { inp.jump = true; inp.jumpPressed = true; }
      }
    } else inp.jump = s.body.vy < 0;
    this.lastX = s.x;
  }

  onDeath(game, s) { s.npc.diedAt = game.tick; }
}
