// Health, armour, jetpacks and weapons lying on the map, weapons dropped by
// the dead, and supply crates that parachute in with a random weapon. With
// classes on, the map's weapons aren't there (everyone has a kit), and medkits,
// armour packs and ammo boxes dropped with gadgets (gadgets.js) lie around too.

import { BODY, ITEM_RESPAWN, ITEM_SIZE, RULES, MOTION, CRATES } from './config.js';
import { WEAPONS, CRATE_WEIGHTS } from './weapons.js';
import { weaponFor } from './classes.js';
import { takeSupply } from './gadgets.js';

const CRATE_LIFE = 2400; // ticks a landed crate waits to be picked up
const MAX_DROPPED = 150;  // dropped weapons lying around at once

export class Pickups {
  constructor(map, game) {
    const rules = game?.rules;
    const kits = !!game?.classesOn;
    this.items = rules && !rules.pickups ? [] : map.items
      .filter(it => it.type !== 'weapon' || (WEAPONS[it.weapon] && !WEAPONS[it.weapon].hidden && !kits))
      .map(it => ({ ...it, active: true, timer: 0, dropped: false, bob: Math.random() * 6 }));
    const crates = game && rules?.crates ? CRATES[game.options.crates] : null;
    this.crates = crates || null;
    this.crateTimer = crates ? crates.every * 0.5 : 0;
    this.spots = crates ? crateSpots(map) : [];
  }

  /** Drop a weapon where a soldier died. */
  drop(id, ammo, x, y, vx) {
    // In huge games, the oldest dropped weapons go first (there'd be thousands).
    let dropped = 0;
    for (const it of this.items) if (it.dropped && it.type === 'weapon') dropped++;
    if (dropped >= MAX_DROPPED) {
      const i = this.items.findIndex(it => it.dropped && it.type === 'weapon');
      this.items.splice(i, 1);
    }
    this.items.push({ type: 'weapon', weapon: id, ammo, x, y, vx, vy: -MOTION.itemToss, active: true, dropped: true, life: RULES.droppedWeaponTicks, bob: 0 });
  }

  update(game) {
    for (const it of this.items) {
      if (it.dropped) {
        it.life--;
        it.px = it.x; it.py = it.y; // (drawn in between this and the new position)
        if (it.vy !== null) {
          const fall = it.type === 'crate' ? MOTION.crateFall : null;
          if (fall) it.vy = fall;
          else it.vy = Math.min(it.vy + MOTION.itemGravity, MOTION.itemMaxFall);
          const hit = game.map.raycast(it.x, it.y, it.x + it.vx, it.y + it.vy + (it.type === 'crate' ? 8 : 4));
          if (hit && hit.ny < 0) {
            it.x = hit.x; it.y = hit.y - (it.type === 'crate' ? 8 : 4);
            it.vx = 0; it.vy = null;
            if (it.type === 'crate') { it.landed = true; it.life = CRATE_LIFE / (game.speed || 1); game.sound('land', it.x, it.y); }
          } else if (hit) { it.vx = 0; }
          else { it.x += it.vx; it.y += it.vy; it.vx *= 0.98; }
          if (it.y > game.map.bounds.bottom + RULES.fallDeathMargin) it.life = 0;
        }
      } else if (!it.active && --it.timer <= 0) {
        it.active = true;
        game.sound('respawnItem', it.x, it.y);
      }
    }
    this.items = this.items.filter(it => !it.dropped || it.life > 0);

    if (this.crates && this.spots.length && --this.crateTimer <= 0) {
      this.crateTimer = this.crates.every / (game.speed || 1) * (0.7 + game.rng() * 0.6);
      if (this.items.filter(it => it.type === 'crate').length < this.crates.max) this.dropCrate(game);
    }
  }

  /** A crate parachutes in over a random spot on the map. */
  dropCrate(game) {
    const spot = this.spots[Math.floor(game.rng() * this.spots.length)];
    const health = game.rng() < 0.18;
    this.items.push({
      type: 'crate', weapon: health ? null : pickCrateWeapon(game.rng), health,
      x: spot.x, y: spot.top, vx: 0, vy: MOTION.crateFall,
      active: true, dropped: true, landed: false, life: 99999, bob: 0,
    });
    game.sound('crate', spot.x, spot.top);
  }

  /** Give the soldier anything they're touching. */
  touch(game, s) {
    const top = s.y + (s.body.crouching ? BODY.crouchTop : BODY.top);
    for (const it of this.items) {
      if (!it.active) continue;
      const size = it.type === 'crate' ? ITEM_SIZE + 4 : ITEM_SIZE;
      if (Math.abs(it.x - s.x) > BODY.halfW + size) continue;
      if (it.y < top - size || it.y > s.y + BODY.bottom + size) continue;
      if (!give(game, s, it)) continue;
      if (it.dropped) it.life = 0;
      else { it.active = false; it.timer = ITEM_RESPAWN[it.type] || 600; }
    }
  }
}

function pickCrateWeapon(rng) {
  const ids = Object.keys(CRATE_WEIGHTS);
  let total = 0;
  for (const id of ids) total += CRATE_WEIGHTS[id];
  let r = rng() * total;
  for (const id of ids) { r -= CRATE_WEIGHTS[id]; if (r <= 0) return id; }
  return ids[0];
}

/**
 * Places a crate can land: next to the map's spawn points and pickups (which
 * map makers put where players can get to), on floors with room to stand.
 * Each spot says how high the crate starts: the sky, or just under the roof indoors.
 */
function crateSpots(map) {
  const spots = [], seen = new Set();
  const sources = [...map.spawns, ...map.items];
  for (const src of sources) {
    for (const off of [0, -40, 40]) {
      const x = src.x + off;
      const hit = map.raycast(x, src.y - 4, x, src.y + 260);
      if (!hit || hit.ny >= 0 || hit.solid.bounce) continue;
      const floor = hit.y;
      if (map.overlap(x - BODY.halfW, floor - 34, x + BODY.halfW, floor - 1)) continue;
      const roof = map.raycast(x, floor - 30, x, map.bounds.top - 60);
      const top = roof ? roof.y + 10 : map.bounds.top - 40;
      if (floor - top < 30) continue;
      const key = `${Math.round(x / 12)},${Math.round(floor / 12)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      spots.push({ x, y: floor, top });
    }
  }
  return spots;
}

function give(game, s, it) {
  switch (it.type) {
    case 'health':
      if (s.health >= RULES.maxHealth && s.burnTicks <= 0) return false;
      s.health = RULES.maxHealth;
      s.burnTicks = 0;
      game.sound('health', it.x, it.y);
      game.notify(s, 'Health restored');
      return true;
    case 'armour':
      if (s.armour >= RULES.maxArmour) return false;
      s.armour = RULES.maxArmour;
      game.sound('armour', it.x, it.y);
      game.notify(s, 'You got the Armour');
      return true;
    case 'jetpack':
      if (s.body.hasJetpack && s.body.fuel >= 100) return false;
      s.body.hasJetpack = true;
      s.body.fuel = 100;
      game.sound('pickup', it.x, it.y);
      game.notify(s, 'You got the Jetpack — hold jump in the air to fly');
      return true;
    case 'crate':
      if (!it.landed && it.y < s.y - 40) return false;
      if (it.health) {
        s.health = RULES.maxHealth;
        s.burnTicks = 0;
        game.sound('health', it.x, it.y);
        game.notify(s, 'Health crate!');
        return true;
      }
      return giveWeapon(game, s, it.weapon, null, it, true);
    case 'weapon':
      return giveWeapon(game, s, it.weapon, it.ammo, it, false);
    case 'medkit': case 'repair': case 'ammo':
      return takeSupply(game, s, it);
  }
  return false;
}

function giveWeapon(game, s, id, ammo, it, crate) {
  // (With the soldier's upgrade: Extended mag carries more.)
  const def = weaponFor(s, id);
  if (!def) return false;
  const inv = s.weapons[id];
  const amount = ammo ?? def.ammo;
  if (!inv) {
    s.weapons[id] = def.mag ? { ammo: Infinity, mag: def.mag } : { ammo: amount };
    // Only take it out if it's an upgrade on the starting pistol (or a melee fallback, or
    // something out of ammo): don't swap out a weapon the player chose to hold.
    const basic = s.current === 'Platinum' || !s.has(s.current) || WEAPONS[s.current]?.kind === 'melee';
    const switched = basic && !NO_SWITCH_KINDS.has(def.kind) && s.select(id);
    game.notify(s, `${crate ? 'Crate: ' : 'You got the '}${def.name}${switched ? '' : ` (key ${KEY[def.slot]})`}`);
  } else {
    if (inv.ammo >= (def.maxAmmo ?? def.ammo ?? 1) && !crate) return false;
    inv.ammo = Math.min(def.maxAmmo ?? Infinity, inv.ammo + amount);
    game.notify(s, `${def.name} ammo`);
  }
  game.sound('pickup', it.x, it.y);
  return true;
}

const NO_SWITCH_KINDS = new Set(['teleport', 'rope', 'kamikaze', 'placed', 'quake']);
const KEY = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'F'];
