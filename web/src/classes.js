// Classes, kits and weapon upgrades (the "Classes" match option).
//
// With classes on, every soldier is one of four classes and spawns with that
// class's kit instead of the usual pistol: a main weapon (the player's choice,
// see kitchoice.js), the class's other weapons, the pistol and the prod, and a
// gadget used with G (gadgets.js).
//
// Each kit weapon can carry one upgrade. Upgrades are per-soldier modifiers:
// weaponFor(s, id) gives the weapon's numbers with the soldier's upgrade
// applied, and the weapon definitions themselves never change.

import { WEAPONS } from './weapons.js';
import { RULES } from './config.js';

/**
 * The classes. mains: the main weapons to choose from, with the ammo the kit
 * gives; kit: the class's other weapons; hold: what's in your hands at spawn
 * (the main weapon, if not given).
 */
export const CLASSES = {
  assault: {
    name: 'Assault', gadget: 'medkit', mainLabel: 'Primary',
    blurb: 'A rifleman with grenades, who keeps the team on its feet with medkits.',
    mains: [{ id: 'M4', ammo: 120 }, { id: 'Shotgun', ammo: 16 }, { id: 'Uzi', ammo: 150 }],
    kit: [{ id: 'GrenadeLauncher', ammo: 2 }],
  },
  engineer: {
    name: 'Engineer', gadget: 'builder', mainLabel: 'Launcher', hold: 'Uzi',
    blurb: 'Rockets and mines, and a Builder to put up cover and repair what explosions broke.',
    mains: [{ id: 'Bazooka', ammo: 3 }, { id: 'HomingMissile', ammo: 3 }, { id: 'Mortar', ammo: 4 }],
    kit: [{ id: 'Uzi', ammo: 150 }, { id: 'Mine', ammo: 2 }, { id: 'Builder', ammo: 6 }],
  },
  support: {
    name: 'Support', gadget: 'ammo', mainLabel: 'Primary',
    blurb: 'Heavy guns and dynamite, and ammo boxes to keep everyone shooting.',
    mains: [{ id: 'Shotgun', ammo: 16 }, { id: 'Minigun', ammo: 300 }, { id: 'Flamer', ammo: 200 }],
    kit: [{ id: 'Dynamite', ammo: 2 }],
  },
  recon: {
    name: 'Recon', gadget: 'beacon', mainLabel: 'Primary',
    blurb: 'A long-range shooter, who places spawn beacons for the team.',
    mains: [{ id: 'SR', ammo: 15 }, { id: 'Longbow', ammo: 16 }, { id: 'MagicBullet', ammo: 4 }],
    kit: [],
  },
};
export const CLASS_IDS = Object.keys(CLASSES);

// Everyone carries these too.
const SIDEARMS = [{ id: 'Platinum' }, { id: 'Sledgehammer' }];

/** Bots' favourite class, by personality (bot.js BOT_PROFILES); they spread out over the team if too many like the same. */
const BOT_CLASS = {
  Grunt: 'assault', Ranger: 'recon', Sarge: 'assault', Ghost: 'recon', Viper: 'engineer',
  Sunny: 'support', Slim: 'engineer', Hyper: 'assault', Scope: 'recon', Ninja: 'support',
};

// ---- Upgrades --------------------------------------------------------------------------

const GUN_KINDS = new Set(['bullet', 'rail', 'arrow', 'seeker', 'flame']);
const isGun = def => GUN_KINDS.has(def.kind);
const isExplosive = def => !!def.blast && ['thrown', 'rocket', 'placed'].includes(def.kind);

/**
 * Weapon upgrades. scale: numbers in the weapon's definition multiplied by
 * this much; extra: added to its ammo; blast: its blast radius multiplied by this.
 */
export const UPGRADES = {
  steady: { name: 'Steady grip', blurb: 'Shots spread 40% less', fits: def => isGun(def) && def.spread > 0, scale: { spread: 0.6 } },
  extmag: { name: 'Extended mag', blurb: '50% more ammo (and a bigger magazine)', fits: isGun, scale: { ammo: 1.5, maxAmmo: 1.5, mag: 1.5 } },
  hollow: { name: 'Hollow points', blurb: '25% more damage, 30% less range', fits: def => isGun(def) && def.kind !== 'flame', scale: { damage: 1.25, range: 0.7, life: 0.7 } },
  quick: { name: 'Quick hands', blurb: '20% less time between shots and reloading', fits: isGun, scale: { rof: 0.8, reload: 0.8, spinup: 0.8 } },
  charge: { name: 'Bigger charge', blurb: '30% bigger blast', fits: isExplosive, blast: 1.3 },
  extra: { name: 'Extra round', blurb: 'One more round', fits: isExplosive, extra: 1 },
};
export const UPGRADE_IDS = Object.keys(UPGRADES);

// Numbers that are counts, so stay whole.
const WHOLE = new Set(['ammo', 'maxAmmo', 'mag']);

/** The upgrades a weapon can carry. */
export function upgradesFor(id) {
  const def = WEAPONS[id];
  if (!def || def.kind === 'melee') return [];
  return UPGRADE_IDS.filter(u => UPGRADES[u].fits(def));
}

const made = new Map();

/**
 * A weapon's numbers with an upgrade applied. It reads through to the real
 * definition, so it follows game speed changes (speed.js rescales weapons in place).
 */
function upgraded(def, up) {
  const key = `${def.id}:${up}`;
  let m = made.get(key);
  if (m) return m;
  const u = UPGRADES[up];
  m = Object.create(def);
  const props = {};
  for (const [k, f] of Object.entries(u.scale || {})) {
    if (typeof def[k] !== 'number' || !Number.isFinite(def[k])) continue;
    props[k] = { get: WHOLE.has(k) ? () => Math.round(def[k] * f) : () => def[k] * f };
  }
  if (u.extra) {
    for (const k of ['ammo', 'maxAmmo']) if (Number.isFinite(def[k])) props[k] = { get: () => def[k] + u.extra };
  }
  // (A new blast each time, so explode() gets the right numbers at any game speed.)
  if (u.blast && def.blast) props.blast = { get: () => ({ ...def.blast, radius: def.blast.radius * u.blast }) };
  Object.defineProperties(m, props);
  made.set(key, m);
  return m;
}

/**
 * The weapon `id` as soldier s has it: with their upgrade on it, if any, or as the
 * Defuse mode's shop sells it (s.shop: a magazine and spare ammo, weapons.js `cs`).
 */
export function weaponFor(s, id) {
  const def = WEAPONS[id];
  if (s?.shop && def?.cs) return shopWeapon(def);
  const up = s?.mods?.[id];
  return up && def ? upgraded(def, up) : def;
}

const shopMade = new Map();

/**
 * A weapon as the Defuse mode's shop has it: guns with a magazine and spare ammo
 * (`ammo` is the spare ammo it comes with), grenades one at a time. It reads
 * through to the real definition, so it follows game speed changes.
 */
function shopWeapon(def) {
  let m = shopMade.get(def.id);
  if (m) return m;
  const cs = def.cs;
  m = Object.create(def);
  const props = {};
  if (cs.mag) {
    props.mag = { get: () => cs.mag };
    props.reload = { get: () => cs.reload ?? def.reload };
    props.ammo = { get: () => cs.reserve ?? 0 };
    props.maxAmmo = { get: () => cs.reserve ?? 0 };
    props.infinite = { value: false };
  } else if (cs.max) {
    props.ammo = { get: () => 1 };
    props.maxAmmo = { get: () => cs.max };
  }
  Object.defineProperties(m, props);
  shopMade.set(def.id, m);
  return m;
}

// ---- Kits ------------------------------------------------------------------------------

/** The main weapon entry for a class (the given id, if it's one of the class's). */
export function mainOf(cls, id) {
  const c = CLASSES[cls] || CLASSES.assault;
  return c.mains.find(m => m.id === id) || c.mains[0];
}

/** Every weapon in a class's kit with that main weapon: [{ id, ammo }], main first. */
export function kitWeapons(cls, main) {
  const c = CLASSES[cls] || CLASSES.assault;
  return [mainOf(cls, main), ...c.kit, ...SIDEARMS];
}

/** The default loadout for a class: its first main weapon, no upgrades. */
export function defaultLoadout(cls) {
  return { main: (CLASSES[cls] || CLASSES.assault).mains[0].id, ups: {} };
}

/** Loadouts for every class, all defaults. */
export function defaultLoadouts() {
  return Object.fromEntries(CLASS_IDS.map(c => [c, defaultLoadout(c)]));
}

/**
 * Loadouts as sent by a player (or saved in a profile), made safe: known
 * classes, a main weapon the class has, and upgrades that fit their weapons.
 */
export function cleanLoadouts(raw) {
  const out = defaultLoadouts();
  if (!raw || typeof raw !== 'object') return out;
  for (const cls of CLASS_IDS) {
    const lo = raw[cls];
    if (!lo || typeof lo !== 'object') continue;
    const main = mainOf(cls, String(lo.main)).id;
    const ups = {};
    for (const { id } of kitWeapons(cls, main)) {
      const up = lo.ups?.[id];
      if (typeof up === 'string' && upgradesFor(id).includes(up)) ups[id] = up;
    }
    out[cls] = { main, ups };
  }
  return out;
}

/** A class id, if it's a real one (otherwise null). */
export const cleanClass = cls => (typeof cls === 'string' && CLASSES[cls] ? cls : null);

/** Ammo a kit gives for a weapon, with its upgrade (more with Extended mag or Extra round). */
export function kitAmmo(id, base, up) {
  const def = WEAPONS[id];
  let n = base ?? def.ammo ?? Infinity;
  if (!Number.isFinite(n)) return n;
  if (up === 'extmag') n = Math.round(n * 1.5);
  if (up === 'extra') n += 1;
  return n;
}

/** A soldier joins a match with classes on: their class (bots pick one), loadouts and gadget. */
export function setupClass(game, s) {
  if (s.isBot) {
    s.pickCls = botClass(game, s);
    s.loadouts = botLoadouts(game);
  } else {
    s.pickCls = cleanClass(s.pickCls) || 'assault';
    s.loadouts = cleanLoadouts(s.loadouts);
  }
  s.cls = s.pickCls;
  s.gadgetCharge = 0;
}

/** A bot's class: its favourite, unless the team already has its share of those; otherwise the least taken. */
function botClass(game, s) {
  const count = Object.fromEntries(CLASS_IDS.map(c => [c, 0]));
  let mates = 0;
  for (const o of game.soldiers) {
    if (o === s || !o.cls || (game.rules.teams && o.team !== s.team)) continue;
    count[o.cls]++;
    mates++;
  }
  const fair = Math.ceil((mates + 1) / CLASS_IDS.length);
  const fav = BOT_CLASS[s.profile?.name];
  if (fav && count[fav] < fair) return fav;
  return CLASS_IDS.reduce((a, b) => (count[b] < count[a] ? b : a));
}

/** Bots: any main weapon, and now and then an upgrade. */
function botLoadouts(game) {
  const out = {};
  for (const cls of CLASS_IDS) {
    const mains = CLASSES[cls].mains;
    const main = mains[Math.floor(game.rng() * mains.length)].id;
    const ups = {};
    for (const { id } of kitWeapons(cls, main)) {
      const list = upgradesFor(id);
      if (list.length && game.rng() < 0.5) ups[id] = list[Math.floor(game.rng() * list.length)];
    }
    out[cls] = { main, ups };
  }
  return out;
}

/**
 * Spawning with classes on: the chosen class's kit (instead of the usual
 * loadout). A map's "everyone spawns with" armour and jetpack still apply.
 */
export function applyKit(game, s) {
  s.cls = cleanClass(s.pickCls) || cleanClass(s.cls) || 'assault';
  const c = CLASSES[s.cls];
  const lo = s.loadouts?.[s.cls] || defaultLoadout(s.cls);
  const kit = kitWeapons(s.cls, lo.main);
  s.weapons = {};
  s.mods = {};
  s.kitAmmo = {};
  for (const { id, ammo } of kit) {
    const up = lo.ups?.[id];
    if (up && upgradesFor(id).includes(up)) s.mods[id] = up;
    const def = weaponFor(s, id);
    if (def.mag) { s.weapons[id] = { ammo: Infinity, mag: def.mag }; continue; }
    const n = kitAmmo(id, ammo, s.mods[id]);
    s.weapons[id] = { ammo: n };
    if (Number.isFinite(n)) s.kitAmmo[id] = n;
  }
  const lo2 = game.map.loadout;
  if (lo2 && game.rules.mapLoadout) {
    if (lo2.armour) s.armour = Math.min(RULES.maxArmour, lo2.armour);
    if (lo2.jetpack) { s.body.hasJetpack = true; s.body.fuel = 100; }
  }
  const hold = c.hold && s.weapons[c.hold] ? c.hold : kit[0].id;
  s.current = hold;
  s.lastInSlot = { [WEAPONS[hold].slot]: hold };
}

/** What a class's kit holds, in words ("M4 Carbine, Grenade Launcher ×2, Pistol"). (The gadget is shown on its own.) */
export function kitText(cls, main) {
  return kitWeapons(cls, main)
    .filter(w => w.id !== 'Sledgehammer' && !WEAPONS[w.id].tool)
    .map(w => (w.ammo && w.ammo <= 4 ? `${WEAPONS[w.id].name} ×${w.ammo}` : WEAPONS[w.id].id === 'Platinum' ? 'Pistol' : WEAPONS[w.id].name))
    .join(', ');
}
