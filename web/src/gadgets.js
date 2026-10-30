// Gadgets (classes on): G uses your class's gadget.
//   medkit (assault)   drops a medkit: health for you and your team
//   builder (engineer) takes out the Builder (G again puts it away): build walls and
//                      planks, and repair the map (building.js); blocks come back over time
//   ammo (support)     drops an ammo box: ammo for you and your team
//   beacon (recon)     places a spawn beacon where you stand: you and your team can
//                      spawn on it (pick it while waiting to respawn) until an enemy
//                      shoots it or blows it up
// Supplies are pickups (pickups.js) that only their owner's team can take. Beacons
// live in game.beacons, plain data the host sends to online players.

import { BODY, MOTION, RULES } from './config.js';
import { CLASSES, weaponFor } from './classes.js';
import { objectivesOf } from './objectives.js';
import { segmentBox } from './map.js';

/** Recharge times are in updates at full speed, like weapon numbers (game speed stretches them: 900 is 20 s at 75%). */
export const GADGETS = {
  medkit: { name: 'Medkit', item: 'medkit', recharge: 900, blurb: '{key:gadget} drops a medkit: 90 health for you or a teammate.' },
  builder: {
    name: 'Builder', tool: 'Builder', recharge: 0,
    blurb: '{key:gadget} takes out the Builder: click to put up a wall ({key:aim} turns it into a plank) or, where explosions broke the map, repair it. A block comes back every few seconds.',
  },
  ammo: { name: 'Ammo box', item: 'ammo', recharge: 900, blurb: '{key:gadget} drops an ammo box: refills you or a teammate.' },
  beacon: { name: 'Spawn beacon', recharge: 450, blurb: '{key:gadget} places a spawn beacon: you and your team can spawn on it until an enemy destroys it.' },
};

export const MEDKIT_HEAL = 90;
export const BEACON_HP = 60;
export const BLOCK_REGEN = 240; // the Builder gets a block back this often, up to what the kit gives (5.3 s at 75%)
const SUPPLY_LIFE = 1800;   // a dropped supply lasts this long (updates at full speed: 40 s at 75%)
const BEACON_SAFE = 150;    // no spawning on a beacon with an enemy this close
const HOLD_SPAWN = 900;     // choosing a class holds your respawn for at most this long (15 s)
// Huge battles: at most this many supplies and beacons at once (the oldest go first).
const MAX_SUPPLIES = 120, MAX_BEACONS = 64;

const gadgetOf = s => GADGETS[CLASSES[s.cls]?.gadget] || null;

/** How long (in updates) a gadget takes to recharge in this game. */
export const rechargeTicks = (game, g) => g.recharge / (game.speed || 1);

/** True if soldier s may use something owned by soldier `ownerId` of team `team` (theirs, or a teammate's). */
function friendly(game, s, ownerId, team) {
  return s.id === ownerId || (!!game.rules.teams && s.team === team);
}

const byId = (game, id) => game.soldiers.find(o => o.id === id) || null;

// ---- Using gadgets ------------------------------------------------------------------------

/** G: use the soldier's gadget if it's charged. Returns true if it was used. */
export function useGadget(game, s) {
  const g = gadgetOf(s);
  if (!g || !s.alive || s.kamikaze) return false;
  if (g.tool) return toggleTool(game, s, g);
  if (s.gadgetCharge > 0) {
    if (!s.isBot && game.tick - (s.toldCharging ?? -999) > 60) {
      s.toldCharging = game.tick;
      game.notify(s, `${g.name} recharging: ${Math.ceil(s.gadgetCharge / 60)} s`);
    }
    return false;
  }
  if (g.item) dropSupply(game, s, g.item);
  else placeBeacon(game, s);
  s.gadgetCharge = rechargeTicks(game, g);
  return true;
}

/** A gadget that's a weapon (the Builder): take it out, or put it away again (back to what you had). */
function toggleTool(game, s, g) {
  if (s.current === g.tool) {
    const back = s.beforeTool && s.beforeTool !== g.tool && s.has(s.beforeTool) ? s.beforeTool : null;
    if (back) s.select(back); else s.selectBest();
    return true;
  }
  if (!s.has(g.tool)) {
    if (!s.isBot && game.tick - (s.toldCharging ?? -999) > 60) {
      s.toldCharging = game.tick;
      game.notify(s, s.weapons[g.tool] ? `No blocks left: one comes back in ${Math.ceil((blockRegenTicks(game) - (s.blockRegen || 0)) / 60)} s` : `No ${g.name}`);
    }
    return false;
  }
  const was = s.current;
  if (!s.select(g.tool)) return false;
  s.beforeTool = was;
  if (!s.isBot) game.sound('click', s.x, s.y, s.id);
  return true;
}

const blockRegenTicks = game => BLOCK_REGEN / (game.speed || 1);

/** Drop a medkit or ammo box at your feet (your last one goes). */
function dropSupply(game, s, type) {
  for (const it of game.pickups.items) if (it.supply && it.owner === s.id) { it.active = false; it.life = 0; }
  const lying = game.pickups.items.filter(it => it.supply && it.life > 0);
  if (lying.length >= MAX_SUPPLIES) { lying[0].active = false; lying[0].life = 0; }
  game.pickups.items.push({
    type, supply: true, owner: s.id, team: s.team,
    x: s.x + s.facing * 6, y: s.y - 2, vx: s.facing * 1.2 * MOTION.timeScale, vy: -MOTION.itemToss,
    active: true, dropped: true, life: SUPPLY_LIFE / (game.speed || 1), bob: 0,
  });
  game.sound('throw', s.x, s.y);
}

/**
 * Someone touched a supply. Returns true if they took it (the pickup then goes).
 */
export function takeSupply(game, s, it) {
  if (!friendly(game, s, it.owner, it.team)) return false;
  if (it.type === 'medkit') {
    if (s.health >= s.maxHealth && s.burnTicks <= 0) return false;
    s.health = Math.min(s.maxHealth, s.health + MEDKIT_HEAL);
    s.burnTicks = 0;
    game.sound('health', it.x, it.y);
  } else if (it.type === 'ammo') {
    if (!resupply(s)) return false;
    game.sound('pickup', it.x, it.y);
  } else return false;
  const owner = it.owner === s.id ? null : byId(game, it.owner);
  game.notify(s, `${GADGETS[it.type].name}${owner ? ` from ${owner.name}` : ''}`);
  return true;
}

/**
 * An ammo box: every weapon with ammo gets half its kit amount back (or half a
 * pickup's worth, for weapons found on the map), up to that amount. Returns true if anything was added.
 */
export function resupply(s) {
  let any = false;
  for (const id in s.weapons) {
    const inv = s.weapons[id], def = weaponFor(s, id);
    if (!def || def.mag || !Number.isFinite(inv.ammo)) continue;
    const full = s.kitAmmo?.[id] ?? def.ammo ?? 0;
    if (!(full > 0) || inv.ammo >= full) continue;
    inv.ammo = Math.min(full, inv.ammo + Math.max(1, Math.round(full / 2)));
    any = true;
  }
  return any;
}

// ---- Spawn beacons ---------------------------------------------------------------------------

export const beaconKey = b => `b:${b.id}`;

/** Place a spawn beacon at your feet (your old one goes; in the air, it drops to the floor). It becomes where you spawn next. */
function placeBeacon(game, s) {
  removeBeacons(game, s.id);
  if (game.beacons.length >= MAX_BEACONS) game.beacons.shift();
  const b = { id: ++game.nextId, owner: s.id, team: s.team, x: s.x, y: s.y + BODY.bottom - 0.5, vy: 0, hp: BEACON_HP };
  game.beacons.push(b);
  // (Online players choose it on their own screen, which tells the host.)
  if (!s.remote) s.deployAt = beaconKey(b);
  game.sound('tink', b.x, b.y);
  game.fx?.ring(b.x, b.y - 6, s.team === 2 ? '#d33' : '#36c');
  game.notify(s, 'Spawn beacon placed: you and your team can spawn on it');
  return true;
}

function removeBeacons(game, ownerId) {
  if (game.beacons.some(b => b.owner === ownerId)) game.beacons = game.beacons.filter(b => b.owner !== ownerId);
}

/** True if `by` (a soldier, or null for the world) can damage beacon b: anyone but its own side. */
function canHit(game, by, b) {
  if (!by) return true;
  if (by.id === b.owner) return false;
  return !(game.rules.teams && by.team === b.team);
}

/** Hurt a beacon; at no health left, it's destroyed. */
export function damageBeacon(game, b, amount, by) {
  if (b.hp <= 0 || !(amount > 0) || !canHit(game, by, b)) return;
  b.hp -= amount;
  game.fx?.sparks(b.x, b.y - 8, 0, -1);
  if (b.hp > 0) { game.sound('tink', b.x, b.y); return; }
  game.beacons = game.beacons.filter(o => o !== b);
  game.fx?.explosion(b.x, b.y - 6, 14);
  game.sound('explosionSmall', b.x, b.y);
  const owner = byId(game, b.owner);
  if (owner) {
    game.notify(owner, 'Your spawn beacon was destroyed');
    // (Recharges from now, so a new one can't go straight back down.)
    if (owner.cls === 'recon') owner.gadgetCharge = Math.max(owner.gadgetCharge || 0, rechargeTicks(game, GADGETS.beacon));
  }
  if (by) game.notify(by, 'You destroyed a spawn beacon');
}

const beaconBox = b => ({ l: b.x - 4, t: b.y - 14, r: b.x + 4, b: b.y });

/**
 * A shot moving from (x, y) by (dx, dy) this update: if it hits an enemy beacon
 * before `maxT` (the soldier or wall it would hit), the beacon takes the damage
 * and this returns where (so the shot stops there).
 */
export function shotBeacon(game, owner, x, y, dx, dy, maxT, amount) {
  if (!game.beacons?.length) return null;
  let best = null;
  const l = Math.min(x, x + dx), r = Math.max(x, x + dx), t = Math.min(y, y + dy), bt = Math.max(y, y + dy);
  for (const b of game.beacons) {
    if (b.x + 4 < l || b.x - 4 > r || b.y < t || b.y - 14 > bt || !canHit(game, owner, b)) continue;
    const box = beaconBox(b);
    const h = segmentBox(x, y, dx, dy, box.l, box.t, box.r, box.b);
    if (h && h.t < maxT && (!best || h.t < best.t)) best = { t: h.t, b };
  }
  if (!best) return null;
  damageBeacon(game, best.b, amount, owner);
  return { x: x + dx * best.t, y: y + dy * best.t };
}

/** A projectile's sweep this update hit an enemy beacon first: it takes `amount` damage. True if so. */
export function projectileBeacon(game, p, hit, wall, amount) {
  if (!game.beacons?.length) return false;
  const maxT = Math.min(hit ? hit.t : 1, wall ? wall.t : 1);
  const at = shotBeacon(game, p.owner, p.x, p.y, p.vx, p.vy, maxT, amount);
  if (!at) return false;
  p.x = at.x; p.y = at.y;
  return true;
}

/** An explosion at (x, y) hurts enemy beacons in reach (called next to explode()). */
export function blastGadgets(game, x, y, blast, owner) {
  if (!game.beacons?.length || !blast) return;
  const reach = blast.radius + 8;
  for (const b of [...game.beacons]) {
    if (Math.abs(b.x - x) > reach || Math.abs(b.y - 6 - y) > reach) continue;
    const d = Math.hypot(b.x - x, b.y - 6 - y);
    if (d > reach || !canHit(game, owner, b)) continue;
    if (!game.map.clearLine(x, y, b.x, b.y - 6) && !game.map.clearLine(x, y, b.x, b.y - 12)) continue;
    damageBeacon(game, b, blast.damage * Math.max(0.15, 1 - d / reach), owner);
  }
}

/** A melee swing that hit nobody: an enemy beacon right in front gets it. True if one did. */
export function meleeBeacon(game, s, def) {
  if (!game.beacons?.length || !(def.damage > 0)) return false;
  const dx = Math.cos(s.aim), dy = Math.sin(s.aim);
  for (const b of game.beacons) {
    const rx = b.x - s.shoulderX, ry = b.y - 7 - s.shoulderY, d = Math.hypot(rx, ry);
    if (d > def.reach + 10 || (d > 8 && (rx * dx + ry * dy) / d < 0.3) || !canHit(game, s, b)) continue;
    damageBeacon(game, b, def.damage, s);
    return true;
  }
  return false;
}

/** Beacons a soldier can spawn on (their own first, then teammates'), as deploy choices. */
export function beaconOptions(game, s) {
  if (!game.beacons?.length) return [];
  const mine = game.beacons.filter(b => friendly(game, s, b.owner, b.team));
  mine.sort((a, b) => (a.owner === s.id ? -1 : 0) - (b.owner === s.id ? -1 : 0) || a.id - b.id);
  return mine.slice(0, 4).map(b => ({
    key: beaconKey(b), beacon: true,
    label: b.owner === s.id ? 'Beacon' : (byId(game, b.owner)?.name || 'Beacon').slice(0, 6),
  }));
}

/** Where to respawn if the soldier picked a beacon that's still up (and has no enemy right next to it). */
export function beaconSpawn(game, s) {
  if (!s.deployAt || !String(s.deployAt).startsWith('b:') || !game.beacons?.length) return null;
  const b = game.beacons.find(o => beaconKey(o) === s.deployAt);
  if (!b || !friendly(game, s, b.owner, b.team)) return null;
  const r = BEACON_SAFE;
  for (const o of game.near(b.x - r, b.y - r, b.x + r, b.y + r)) {
    if (o.alive && o !== s && (game.rules.teams ? o.team !== s.team : true) && Math.hypot(o.x - b.x, o.y - b.y) < r) {
      game.notify(s, 'Enemies at the beacon: spawning at base');
      return null;
    }
  }
  return { x: b.x, y: b.y - BODY.bottom, beacon: b };
}

/** Someone spawned on a beacon: a teammate's tells its owner. */
export function beaconSpawned(game, s, b) {
  if (b.owner === s.id) return;
  const owner = byId(game, b.owner);
  if (owner) game.notify(owner, `${s.name} spawned on your beacon`);
}

// ---- Every update ------------------------------------------------------------------------------

/** Gadgets recharge (while dead too), the Builder gets its blocks back, and beacons fall if the floor under them goes. */
export function updateGadgets(game) {
  for (const s of game.soldiers) {
    if (s.gadgetCharge > 0) s.gadgetCharge = Math.max(0, s.gadgetCharge - 1);
    if (s.holdSpawn > 0 && s.alive) s.holdSpawn = 0;
    const blocks = s.alive && s.weapons.Builder;
    if (blocks && blocks.ammo < (s.kitAmmo?.Builder ?? 0)) {
      s.blockRegen = (s.blockRegen || 0) + 1;
      if (s.blockRegen >= blockRegenTicks(game)) { s.blockRegen = 0; blocks.ammo++; }
    } else s.blockRegen = 0;
  }
  if (!game.beacons.length) return;
  const map = game.map;
  for (const b of [...game.beacons]) {
    if (map.overlap(b.x - 3, b.y + 0.2, b.x + 3, b.y + 1.5)) { b.vy = 0; continue; }
    b.vy = Math.min((b.vy || 0) + MOTION.itemGravity, MOTION.itemMaxFall);
    const hit = map.raycast(b.x, b.y, b.x, b.y + b.vy + 1);
    if (hit && hit.ny < 0) { b.y = hit.y - 0.5; b.vy = 0; } else b.y += b.vy;
    if (b.y > map.bounds.bottom + RULES.fallDeathMargin) game.beacons = game.beacons.filter(o => o !== b);
  }
}

/** A soldier left the game: their beacon and supplies go with them. */
export function removeGadgets(game, s) {
  removeBeacons(game, s.id);
  for (const it of game.pickups.items) if (it.supply && it.owner === s.id) { it.active = false; it.life = 0; }
}

/** Respawning as another class: a beacon from being recon goes. */
export function classChanged(game, s) {
  if (s.cls !== 'recon') removeBeacons(game, s.id);
}

/** Choosing a class while dead holds your respawn (for at most 15 s). */
export function holdSpawn(s, on) {
  s.holdSpawn = on && !s.alive ? HOLD_SPAWN : 0;
}

// ---- Bots ------------------------------------------------------------------------------------

/** A teammate within r px who `need`s something (not the soldier themselves). */
function mateNear(game, s, r, need) {
  if (!game.rules.teams) return false;
  for (const o of game.near(s.x - r, s.y - r, s.x + r, s.y + r)) {
    if (o !== s && o.alive && o.team === s.team && Math.hypot(o.x - s.x, o.y - s.y) < r && need(o)) return true;
  }
  return false;
}

/** Short of ammo: the gun in hand (or every gun) is down to a third of its kit. */
function lowAmmo(s) {
  const low = id => {
    const inv = s.weapons[id];
    if (!inv || !Number.isFinite(inv.ammo)) return false;
    const full = s.kitAmmo?.[id] ?? 0;
    return full > 0 && inv.ammo < full / 3;
  };
  return low(s.current) || Object.keys(s.kitAmmo || {}).every(low);
}

/** Where the mode's objectives are, for placing beacons near them. */
function objectiveSpots(game) {
  const type = { koth: 'hill', ctf: 'flag', conquest: 'point', rush: 'mcom' }[game.mode];
  if (!type) return null;
  return objectivesOf(game.map, type).map(o => (o.left != null ? { x: (o.left + o.right) / 2, y: o.bottom } : { x: o.x, y: o.y }));
}

/** Should this bot use its gadget now? (Asked every few updates.) */
export function botWantsGadget(game, s, bot) {
  if (!s.alive || s.gadgetCharge > 0 || !s.body.onGround || s.body.rope) return false;
  switch (CLASSES[s.cls]?.gadget) {
    case 'medkit': return s.health < s.maxHealth * 0.6 || s.burnTicks > 0 || mateNear(game, s, 130, o => o.health < o.maxHealth * 0.6 || o.burnTicks > 0);
    case 'ammo': return lowAmmo(s) || mateNear(game, s, 130, lowAmmo);
    case 'beacon': {
      if (bot.target || game.beacons.some(b => b.owner === s.id)) return false;
      const spots = objectiveSpots(game);
      // Deathmatch: somewhere along the way, after a while.
      if (!spots) return game.tick - (s.spawnedAt ?? 0) > 600 && bot.rng() < 0.08;
      // Objective modes: a little way back from an objective.
      return spots.some(p => { const d = Math.hypot(p.x - s.x, p.y - s.y); return d > 160 && d < 480; }) && bot.rng() < 0.5;
    }
  }
  return false;
}

/** Where a bot respawns: its own beacon if it has one, otherwise now and then a teammate's. */
export function botDeploy(game, s, rng) {
  const own = game.beacons.find(b => b.owner === s.id);
  if (own) return beaconKey(own);
  const mates = beaconOptions(game, s);
  return mates.length && rng() < 0.35 ? mates[Math.floor(rng() * mates.length)].key : null;
}
