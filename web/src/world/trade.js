// Trading (world mode): what things are worth, what each shop in a town has for sale today, and
// buying and selling. Coins are what monsters drop; shops pay for what's brought to them (less
// than they sell it for, and each only for what it deals in), and their stock changes every day:
// what's bought from it stays bought till the next. Which things a shop has on a given day comes
// from the world's seed (the same on every computer); what's been bought is kept with the world.

import { itemOf } from './items.js';
import { RECIPES } from './crafting.js';
import { hash3 } from './noise.js';
import { dayOf } from './monsters.js';
import { WEAPONS } from '../weapons.js';
import { buyScale, sellScale } from './progress.js';
import { gearValue, rollGear, rarityOf } from './gear.js';

// ---- What things are worth -----------------------------------------------------------------------------

/**
 * What raw things are worth (coins): what's dug, chopped, gathered or found. Anything made is
 * worth what it's made of (the cheapest way to make it) and a bit more, for the work.
 */
const RAW = {
  dirt: 0.05, sand: 0.05, gravel: 0.05, red_sand: 0.05, snow: 0.05, mud: 0.05, stone: 0.1, slate: 0.15, sandstone: 0.15,
  ice: 0.2, clay: 0.2, clay_pale: 0.2, basalt: 0.2, cactus: 0.3, mushroom: 0.5, wood: 0.3, wheat: 0.3,
  magma: 1, obsidian: 2, kimberlite: 1, coal: 0.8, copper_ore: 1, iron_ore: 1.5, silver_ore: 2.5, gold_ore: 3.5,
  crystal_ore: 6, ember_ore: 8,
  amethyst: 20, topaz: 28, emerald: 40, sapphire: 48, ruby: 60, diamond: 150,
  apple: 1.5, healing_potion: 18, greater_potion: 45, recall_scroll: 30,
  // (Hunted, grown, gathered: animals.js, farming.js.)
  raw_beef: 1, raw_pork: 1, raw_mutton: 0.8, raw_chicken: 0.6, raw_venison: 1.2, raw_rabbit: 0.8, raw_fish: 0.6, crab_meat: 0.6,
  leather: 1.5, wool: 0.8, feather: 0.3, bone: 0.4, egg: 0.5, flint: 0.3, wheat_seeds: 0.1, carrot: 0.6, potato: 0.4, berries: 0.4,
  // (Weapons nobody can make: found in crates.)
  BananaBomb: 12, HolyHandGrenade: 60, Skunk: 10, Sheep: 12, SuperSheep: 25, OldWoman: 15, MadCow: 25, AirStrike: 60,
  NapalmStrike: 70, ConcreteDonkey: 150, Earthquake: 100, Kamikaze: 15, FirePunch: 40,
  coins: 1,
};
// (The work in making something, by where it's made.)
const WORK = { hand: 1.1, workbench: 1.15, furnace: 1.2, anvil: 1.3, gunsmith: 1.3, campfire: 1.2 };

let VALUES = null;

/** Every item's worth, worked out once: the raw ones', then (over and over, till nothing changes) what's made from them. */
function values() {
  if (VALUES) return VALUES;
  const v = new Map(Object.entries(RAW));
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    for (const r of RECIPES) {
      if (r.key in RAW) continue;
      let sum = 0;
      for (const [k, n] of r.of) {
        const x = v.get(k);
        if (x == null) { sum = NaN; break; }
        sum += x * n;
      }
      if (!(sum >= 0)) continue;
      const val = (sum / r.n) * WORK[r.at || 'hand'];
      const had = v.get(r.key);
      if (had == null || val < had - 1e-9) { v.set(r.key, val); changed = true; }
    }
    if (!changed) break;
  }
  return (VALUES = v);
}

/** What one `key` is worth (coins: 0 if nothing). */
export const valueOf = key => values().get(key) ?? 0;

/** How many come at once in a shop (cheap things in bundles worth a few coins). */
export function bundleOf(key) {
  const it = itemOf(key);
  if (!it || it.stack <= 1) return 1;
  const want = Math.ceil(3 / Math.max(0.01, valueOf(key)));
  for (const n of [1, 2, 3, 5, 10, 20, 30, 50, 99]) if (n >= want) return Math.min(n, it.stack);
  return Math.min(99, it.stack);
}

// ---- Shops -----------------------------------------------------------------------------------------------

const BAR = new Set(['copper_bar', 'iron_bar', 'silver_bar', 'gold_bar']);
const ORE = new Set(['coal', 'copper_ore', 'iron_ore', 'silver_ore', 'gold_ore', 'crystal_ore', 'ember_ore', 'kimberlite', 'obsidian']);
const isMelee = it => it.kind === 'weapon' && WEAPONS[it.weapon]?.kind === 'melee';
const isGun = it => (it.kind === 'weapon' && !isMelee(it)) || it.kind === 'ammo' || it.key === 'merc_contract';
const isFood = it => it.kind === 'food';

/**
 * The shops (by the work their keeper does: townsfolk.js's roles): what they're called, what
 * they sell ([key, the chance it's there on a day, the most bundles], and `rare`: one or two of
 * these now and then), what they buy (and for what share of its worth), and their mark-up.
 */
export const SHOPS = {
  merchant: {
    name: 'General store', markup: 1.25, rate: 0.35, buys: () => true,
    sells: [
      ['torch', 1, 8], ['planks', 1, 6], ['bread', 1, 6], ['apple', 0.8, 6], ['ladder', 0.8, 4], ['platform', 0.8, 4], ['glass', 0.7, 4],
      ['door', 0.7, 3], ['chest', 0.7, 2], ['bed', 0.5, 1], ['lantern', 0.5, 3], ['workbench', 0.6, 1], ['furnace', 0.5, 1],
      ['coal', 0.8, 5], ['copper_bar', 0.5, 4], ['iron_bar', 0.4, 3], ['arrows', 0.6, 3], ['bullets', 0.6, 3], ['claim_flag', 0.4, 1],
      ['wheat', 0.5, 4], ['cobblestone', 0.5, 4], ['stone_bricks', 0.5, 4], ['plank_wall', 0.6, 4], ['healing_potion', 0.3, 2],
      ['wheat_seeds', 0.5, 4], ['campfire', 0.5, 2],
    ],
    rare: [['merc_contract', 1], ['iron_pickaxe', 1], ['stained_glass', 3]],
  },
  smith: {
    name: 'Smithy', markup: 1.2, rate: 0.5, buys: it => it.kind === 'tool' || BAR.has(it.key) || ORE.has(it.key) || isMelee(it) || it.key === 'metal' || (it.kind === 'gear' && it.wear !== 'ring' && it.wear !== 'amulet'),
    sells: [
      ['copper_bar', 1, 6], ['iron_bar', 1, 6], ['silver_bar', 0.6, 3], ['gold_bar', 0.5, 3], ['pickaxe', 0.6, 1], ['iron_pickaxe', 0.7, 1],
      ['gold_pickaxe', 0.3, 1], ['axe', 0.6, 1], ['hammer', 0.6, 1], ['anvil', 0.5, 1], ['furnace', 0.6, 1], ['Knife', 0.6, 1],
      ['BattleAxe', 0.4, 1], ['Sledgehammer', 0.4, 1], ['BaseballBat', 0.4, 1], ['metal', 0.6, 4], ['blast_bricks', 0.4, 3],
      ['lantern', 0.5, 3], ['NinjaRope', 0.4, 1], ['coal', 0.7, 6],
    ],
    rare: [['crystal_pickaxe', 1], ['diamond_pickaxe', 1], ['FirePunch', 1]],
  },
  gunsmith: {
    name: "Gunsmith's", markup: 1.2, rate: 0.5, buys: isGun,
    sells: [
      ['bullets', 1, 6], ['shells', 1, 5], ['arrows', 0.8, 4], ['rockets', 0.5, 3], ['fuel', 0.4, 2], ['Platinum', 0.8, 1], ['Beretta', 0.7, 1],
      ['Magnum', 0.5, 1], ['Uzi', 0.5, 1], ['MP5K', 0.4, 1], ['Shotgun', 0.7, 1], ['M4', 0.4, 1], ['AK47', 0.4, 1], ['Longbow', 0.5, 1],
      ['SR', 0.25, 1], ['HEGrenade', 0.6, 3], ['Flashbang', 0.5, 3], ['SmokeGrenade', 0.5, 3], ['Dynamite', 0.5, 3], ['Mine', 0.4, 2],
      ['GrenadeLauncher', 0.3, 2], ['PetrolBomb', 0.4, 2], ['Bazooka', 0.2, 1], ['Flamer', 0.2, 1], ['merc_contract', 0.5, 2],
      // (Attachments: attachments.js.)
      ['red_dot', 0.5, 1], ['scope2', 0.5, 1], ['scope4', 0.3, 1], ['foregrip', 0.5, 1], ['compensator', 0.3, 1], ['ext_mag', 0.4, 1],
      ['quick_mag', 0.3, 1], ['hollow_points', 0.4, 4], ['laser', 0.3, 1], ['suppressor', 0.25, 1],
    ],
    rare: [['Minigun', 1], ['MagicBullet', 1], ['HolyHandGrenade', 1], ['BananaBomb', 2], ['Mortar', 1], ['HomingMissile', 2], ['scope8', 1], ['scope16', 1], ['drum_mag', 1], ['long_barrel', 1]],
  },
  trader: {
    name: 'Market stall', markup: 1.3, rate: 0.45, buys: () => true,
    // (Gems, ores and bars: a good price.)
    rateFor: it => (it.gem || ORE.has(it.key) || BAR.has(it.key) ? 0.6 : null),
    sells: [
      ['amethyst', 0.6, 2], ['topaz', 0.5, 2], ['emerald', 0.4, 1], ['sapphire', 0.35, 1], ['ruby', 0.3, 1], ['diamond', 0.15, 1],
      ['silver_bar', 0.6, 4], ['gold_bar', 0.6, 4], ['crystal_ore', 0.4, 4], ['ember_ore', 0.3, 3], ['stained_glass', 0.5, 4],
      ['roof_tiles', 0.4, 4], ['snow_bricks', 0.3, 4], ['sandstone_bricks', 0.3, 4], ['obsidian', 0.3, 3], ['Teleport', 0.2, 1],
      ['Sheep', 0.2, 2], ['greater_potion', 0.25, 1], ['recall_scroll', 0.4, 2],
    ],
    rare: [['crystal_pickaxe', 1], ['MagicBullet', 1], ['Minigun', 1], ['HolyHandGrenade', 1], ['SuperSheep', 1], ['MadCow', 1], ['diamond', 1], ['ConcreteDonkey', 1]],
  },
  innkeeper: {
    name: 'Inn', markup: 1.2, rate: 0.4, buys: isFood,
    sells: [['bread', 1, 8], ['apple', 1, 6], ['stew', 1, 5], ['torch', 0.6, 4], ['bed', 0.3, 1], ['healing_potion', 0.2, 1],
      ['steak', 0.6, 4], ['cooked_chicken', 0.6, 4], ['cooked_fish', 0.5, 4], ['baked_potato', 0.5, 4], ['berry_pie', 0.3, 2], ['rabbit_stew', 0.2, 2]],
  },
  healer: {
    name: 'Temple', markup: 1.15, rate: 0.5, buys: it => it.key === 'mushroom' || it.key === 'cactus' || it.look === 'potion',
    sells: [['healing_potion', 1, 5], ['greater_potion', 0.6, 2], ['apple', 0.6, 4], ['stew', 0.5, 3], ['recall_scroll', 0.8, 3]],
  },
  // A farm (a village's farmers): its crops and seeds, eggs, wool and leather, and what a farm needs.
  farmer: {
    name: 'Farm', markup: 1.15, rate: 0.5,
    buys: it => isFood(it) || ['wheat', 'wheat_seeds', 'mushroom', 'cactus', 'wood', 'egg', 'wool', 'leather', 'feather', 'bone', 'bone_meal'].includes(it.key),
    sells: [
      ['wheat', 1, 8], ['bread', 1, 6], ['apple', 1, 6], ['thatch', 0.6, 4], ['stew', 0.4, 3], ['wheat_seeds', 1, 4], ['carrot', 0.8, 4], ['potato', 0.8, 4],
      ['egg', 0.7, 3], ['hoe', 0.5, 1], ['bone_meal', 0.5, 3], ['wool', 0.5, 4], ['leather', 0.4, 3], ['raw_beef', 0.4, 3], ['raw_chicken', 0.4, 3], ['campfire', 0.3, 1],
    ],
    rare: [['shears', 1], ['golden_apple', 1]],
  },
};

/** What the town's people (and the bundles bought today) remember: kept with the world. */
export function townState(world, town) {
  const all = world.townState ||= {};
  return all[town] ||= { day: 0, bought: {} };
}

/** A whole-number random in [0, 1) for shop `f` (one of the townsfolk) on `day`. */
const roll = (seed, f, day, i, salt) => (hash3(seed, f.k * 97 + f.bi, day * 977 + i * 13 + salt) % 100000) / 100000;

/**
 * What one of the townsfolk (folkOf's f) has for sale today: [{ key, n (in a bundle), price
 * (coins a bundle), left (bundles) }], or null if they don't keep a shop. city: a city's prices
 * are higher, and its shops have more.
 */
export function stockOf(world, f, city = false) {
  const shop = SHOPS[f.role];
  if (!shop) return null;
  const seed = world.gen.seed, day = dayOf(world.time || 0), st = townState(world, f.town);
  if (st.day !== day) { st.day = day; st.bought = {}; }
  const bought = st.bought[f.key] || {};
  const out = [], markup = shop.markup * (city ? 1.15 : 1);
  shop.sells.forEach(([key, chance, most], i) => {
    if (!itemOf(key) || roll(seed, f, day, i, 1) >= Math.min(1, chance * (city ? 1.2 : 1))) return;
    const n = bundleOf(key), have = 1 + Math.floor(roll(seed, f, day, i, 2) * most) + (city ? 1 : 0);
    out.push({ key, n, price: Math.max(1, Math.round(valueOf(key) * n * markup)), left: Math.max(0, have - (bought[key] || 0)) });
  });
  // (Gear, rolled for the day: gear.js. The smith sells armour, the gunsmith weapons with affixes
  // of their own, the market rings and amulets, the general store a piece of anything. Never
  // legendary, set or unique: those are found.)
  const gearKinds = { smith: ['head', 'body', 'hands', 'waist', 'feet'], gunsmith: ['weapon'], trader: ['ring', 'amulet'], merchant: [null] }[f.role];
  if (gearKinds) {
    const n = { smith: 3, gunsmith: 2, trader: 2, merchant: 1 }[f.role] + (city ? 1 : 0), ilvl = (city ? 10 : 4) + (day % 5);
    for (let i = 0; i < n; i++) {
      const h = hash3(seed, f.k * 97 + f.bi, day * 31 + i * 7 + 900), x = (h >>> 8) / 16777216;
      const rar = x < 0.3 ? 'basic' : x < 0.75 ? 'magic' : x < 0.95 ? 'rare' : 'epic';
      const p = rollGear(h, ilvl, 0, rar, null, false, gearKinds[(h >>> 3) % gearKinds.length]), key = `gear${i}`;
      out.push({ key: p.key, n: 1, price: Math.max(1, Math.round(gearWorth(p.key, p.g) * markup * 1.2)), left: (bought[key] || 0) ? 0 : 1, g: p.g, slot: key });
    }
  }
  // (Now and then, something rare: dearer.)
  if (shop.rare) {
    shop.rare.forEach(([key, most], i) => {
      if (!itemOf(key) || out.some(o => o.key === key) || roll(seed, f, day, i, 3) >= (city ? 0.16 : 0.08)) return;
      const n = bundleOf(key);
      out.push({ key, n, price: Math.max(1, Math.round(valueOf(key) * n * markup * 1.4)), left: Math.max(0, most - (bought[key] || 0)), rare: true });
    });
  }
  return out;
}

/**
 * What a shop (by its keeper's role) pays for n of `key`, or 0 if it doesn't buy it (or it's worth
 * nothing to them). scale: the seller's (progress.js's Haggler perk: more).
 */
export function offerFor(role, key, n = 1, scale = 1) {
  if (!buysAny(role, key)) return 0;
  const shop = SHOPS[role], it = itemOf(key), rate = shop.rateFor?.(it) ?? shop.rate;
  return Math.floor(valueOf(key) * n * rate * scale);
}

/** Whether shop `role` deals in `key` at all (never coins, nor what's carried for a quest). */
export const buysAny = (role, key) => { const shop = SHOPS[role], it = itemOf(key); return !!(shop && it && key !== 'coins' && it.kind !== 'quest' && shop.buys(it)); };

/** What a piece of gear (gear.js), or a weapon with affixes (worth what the weapon is, more the rarer), is worth. */
export function gearWorth(key, g) {
  if (itemOf(key)?.kind !== 'weapon') return gearValue(key, g);
  return Math.round(Math.max(20, valueOf(key)) * ({ basic: 1, magic: 1.5, rare: 2.2, epic: 3, legendary: 4.5, set: 3, unique: 6 }[rarityOf(g?.r)] || 1));
}

/** What a shop pays for what's in a slot (n of it; a piece of gear by what it is: gear.js). */
export function offerForSlot(role, slot, n = slot?.n || 1, scale = 1) {
  if (!slot || !buysAny(role, slot.key)) return 0;
  if (!slot.g) return offerFor(role, slot.key, n, scale);
  const shop = SHOPS[role], it = itemOf(slot.key), rate = shop.rateFor?.(it) ?? shop.rate;
  return Math.floor(gearWorth(slot.key, slot.g) * rate * scale);
}

/** A price as player s pays it (progress.js's Haggler perk: less). */
export const priceFor = (price, s) => Math.max(1, Math.round(price * buyScale(s)));

/**
 * Buy a bundle of `key` from one of the townsfolk (f), for player s (their things: s.world.inv).
 * Returns what to tell them.
 */
export function buy(world, s, f, key, city = false, slot = null) {
  const inv = s.world.inv, stock = stockOf(world, f, city), o = stock?.find(x => (slot ? x.slot === slot : x.key === key && !x.g));
  if (!o) return "They don't have that";
  if (o.left <= 0) return 'Sold out (till tomorrow)';
  const price = priceFor(o.price, s);
  if (inv.count('coins') < price) return `You need ${price} coins`;
  if (o.g ? !inv.slots.includes(null) : inv.room(key) < o.n) return 'You have no room for it';
  inv.remove('coins', price);
  const was = inv.slots.slice();
  // (A piece of gear: that very piece.)
  if (o.g) inv.addGear(o.key, o.g); else inv.add(key, o.n);
  // (A gun comes loaded.)
  const def = WEAPONS[key];
  if (def?.mag) inv.slots.forEach((sl, j) => { if (sl && !was[j] && sl.key === key) sl.mag = def.mag; });
  const st = townState(world, f.town), b = st.bought[f.key] ||= {};
  b[o.slot || key] = (b[o.slot || key] || 0) + 1;
  return `Bought ${o.n > 1 ? `${o.n} × ` : ''}${o.g?.name || itemOf(key).name} for ${price} coins`;
}

/** Sell what's in slot i (all: the whole stack, else one) to one of the townsfolk (f). Returns what to tell them. */
export function sell(world, s, f, i, all = false) {
  const inv = s.world.inv, sl = inv.slots[i];
  if (!sl) return null;
  const it = itemOf(sl.key);
  if (!buysAny(f.role, sl.key)) return `${f.name} doesn't buy ${it?.name ?? 'that'}`;
  // (Cheap things: as many as make a coin, at least.)
  let n = all ? sl.n : 1;
  const k = sellScale(s);
  if (!all) while (n < sl.n && offerForSlot(f.role, sl, n, k) < 1) n++;
  const pay = offerForSlot(f.role, sl, n, k);
  if (pay < 1) return `Not worth anything to them${all ? '' : ' (sell the whole stack: shift-click)'}`;
  if (inv.room('coins') < pay && n < sl.n) return 'You have no room for the coins';
  inv.take(i, n);
  inv.add('coins', pay);
  return `Sold ${n > 1 ? `${n} × ` : ''}${sl.g?.name || it.name} for ${pay} coin${pay === 1 ? '' : 's'}`;
}
