// Progress (world mode): experience, levels and perks. Players earn experience fighting monsters,
// mining ore and gems, crafting, finding new towns and biomes, going deeper than before, and
// above all doing quests (quests.js). Each level gives a little more health and a perk point to
// spend on a perk: tougher, faster digging, harder hitting, better prices, more loot, healing
// over time, more ore. What each player's done is counted too (their stats), for the journal.
//
// Kept with the player's things (worldplay.js's playerToSave); online, the host keeps it and
// sends it with their things.

import { WEAPONS } from '../weapons.js';
import { gearStats } from './gear.js';
import { tooHungry } from './hunger.js';

/** The highest level there is. */
export const MAX_LEVEL = 50;
/** Experience to go from `level` to the next. */
export const xpToNext = level => Math.round(80 * level ** 1.55);
/** Health: what everyone has, and what each level adds. */
export const BASE_HEALTH = 150, HEALTH_PER_LEVEL = 3;

/** The perks, and what each rank of them does. */
export const PERKS = {
  tough: { name: 'Tough', max: 5, text: r => `+${r * 12} health` },
  miner: { name: 'Miner', max: 5, text: r => `Dig ${r * 12}% faster` },
  marksman: { name: 'Marksman', max: 5, text: r => `Guns do ${r * 6}% more damage` },
  brawler: { name: 'Brawler', max: 5, text: r => `Melee does ${r * 10}% more damage` },
  haggler: { name: 'Haggler', max: 5, text: r => `Shops sell ${r * 4}% cheaper, and pay ${r * 4}% more` },
  scavenger: { name: 'Scavenger', max: 5, text: r => `Monsters drop ${r * 15}% more coins, and loot more often` },
  regen: { name: 'Second wind', max: 5, text: r => `Heal ${r} health every two seconds (not in a fight)` },
  prospector: { name: 'Prospector', max: 5, text: r => `${r * 8}% chance of twice the ore and gems` },
};

/** Experience for killing each kind of monster. */
export const KILL_XP = { zombie: 10, skeleton: 15, brute: 60, champion: 250 };
/** Experience for mining each kind of block (by the item it drops): ores and gems only. */
export const MINE_XP = {
  coal: 1, copper_ore: 2, iron_ore: 3, silver_ore: 4, gold_ore: 6, crystal_ore: 8, ember_ore: 10, kimberlite: 2,
  amethyst: 12, topaz: 14, emerald: 18, sapphire: 20, ruby: 24, diamond: 40, obsidian: 3,
};
/** Experience for going deeper than ever before (every DEPTH_STEP blocks), a new town, a new biome. */
export const DEPTH_STEP = 50, DEPTH_XP = 25, TOWN_XP = 40, BIOME_XP = 30;

/** A player's progress (made the first time it's asked for). */
export function progOf(s) {
  const w = s.world;
  return (w.prog ||= { xp: 0, level: 1, points: 0, perks: {}, stats: {}, seen: { towns: [], biomes: [], deepest: 0 } });
}

/** A perk's rank for player s (0: none). */
export const perkRank = (s, id) => (s?.world?.prog?.perks?.[id] | 0);

/** Player s's full health, by their level, perks and gear (gear.js). */
export const maxHealthOf = s => BASE_HEALTH + (progOf(s).level - 1) * HEALTH_PER_LEVEL + perkRank(s, 'tough') * 12 + (gearStats(s).hp || 0);

/** Player s's health as their level and perks say (a level up heals the difference). */
export function applyProgress(s) {
  const was = s.maxHealth, now = maxHealthOf(s);
  s.maxHealth = now;
  if (s.alive && now > was) s.health = Math.min(now, s.health + (now - was));
}

/** Count something player s did (their stats: 'kills', 'mined', 'crafted', 'quests', ...). */
export function countStat(s, key, n = 1) {
  const st = progOf(s).stats;
  st[key] = (st[key] || 0) + n;
}

/**
 * Experience for player s (why: what for, said with it). Levels up as it adds up: each level a
 * perk point and more health (told on screen: w.levelUp, for the HUD's banner).
 */
export function giveXp(game, s, n, why = '') {
  if (!s?.world || n <= 0) return;
  const p = progOf(s);
  if (p.level >= MAX_LEVEL) return;
  // (More with gear "of the Fox": gear.js.)
  n *= 1 + (gearStats(s).xp || 0) / 100;
  p.xp += Math.round(n);
  let up = 0;
  while (p.level < MAX_LEVEL && p.xp >= xpToNext(p.level)) {
    p.xp -= xpToNext(p.level);
    p.level++;
    p.points++;
    up++;
  }
  if (p.level >= MAX_LEVEL) p.xp = 0;
  (s.world.xpGot ||= []).push({ n: Math.round(n), why, tick: game.tick });
  if (s.world.xpGot.length > 6) s.world.xpGot.shift();
  if (up) {
    applyProgress(s);
    // (Said across the screen: worldhud.js.)
    s.world.levelUp = { level: p.level, tick: game.tick };
    game.sound('hallelujah', s.x, s.y, s.id);
  }
}

/** Spend a perk point of player s's on perk `id`. Returns what to tell them. */
export function spendPoint(s, id) {
  const p = progOf(s), def = PERKS[id];
  if (!def) return null;
  if (p.points <= 0) return 'No perk points to spend: they come with each level';
  const r = p.perks[id] | 0;
  if (r >= def.max) return `${def.name} is as good as it gets`;
  p.perks[id] = r + 1;
  p.points--;
  applyProgress(s);
  return `${def.name} ${r + 1}: ${def.text(r + 1)}`;
}

// ---- What perks do (worldplay.js and trade.js ask) ----------------------------------------------------

/** How much more damage attacker s does with `weapon` (their perks: 1 is none). */
export function damageScale(s, weapon) {
  if (!s?.world) return 1;
  const melee = WEAPONS[weapon]?.kind === 'melee', g = gearStats(s);
  return melee ? 1 + perkRank(s, 'brawler') * 0.1 + (g.melee || 0) / 100 : 1 + perkRank(s, 'marksman') * 0.06 + (g.gun || 0) / 100;
}
/** How much faster player s digs (perks and gear). */
export const digScale = s => 1 + perkRank(s, 'miner') * 0.12 + (gearStats(s).dig || 0) / 100;
/** What shops' prices are for player s (buying: less, selling: more). */
export const buyScale = s => 1 - perkRank(s, 'haggler') * 0.04;
export const sellScale = s => 1 + perkRank(s, 'haggler') * 0.04;
/** More coins (and loot) from monsters killed by player s (perks and gear). */
export const lootScale = s => 1 + perkRank(s, 'scavenger') * 0.15 + (gearStats(s).coin || 0) / 100;
/** The chance of twice the ore or gem from a block. */
export const doubleOreChance = s => perkRank(s, 'prospector') * 0.08;

/** Each update (worldplay.js): the Second wind perk heals a player out of a fight (not when they're hungry: hunger.js). */
export function regenTick(game, s) {
  const r = perkRank(s, 'regen') + (s.world?.gear ? gearStats(s).regen || 0 : 0);
  if (!r || !s.alive || game.tick % 120 !== s.id % 120 || tooHungry(game, s)) return;
  if (game.tick - (s.lastHurtTick ?? -1e9) < 300 || s.health >= s.maxHealth) return;
  s.health = Math.min(s.maxHealth, s.health + r);
}

// ---- Saving --------------------------------------------------------------------------------------------

/** A player's progress as saved. */
export function progToSave(s) {
  const p = s.world?.prog;
  return p ? { xp: p.xp, level: p.level, points: p.points, perks: p.perks, stats: p.stats, seen: p.seen } : null;
}

/** A player's progress from a save (tidied: only what there is). */
export function progFromSave(w, data) {
  if (!data || typeof data !== 'object') return;
  const p = { xp: 0, level: 1, points: 0, perks: {}, stats: {}, seen: { towns: [], biomes: [], deepest: 0 } };
  p.level = Math.max(1, Math.min(MAX_LEVEL, data.level | 0 || 1));
  p.xp = Math.max(0, Math.min(xpToNext(p.level), Number(data.xp) || 0));
  p.points = Math.max(0, Math.min(MAX_LEVEL, data.points | 0));
  for (const [id, r] of Object.entries(data.perks || {})) if (PERKS[id]) p.perks[id] = Math.max(0, Math.min(PERKS[id].max, r | 0));
  for (const [k, v] of Object.entries(data.stats || {})) if (Number.isFinite(v) && v > 0) p.stats[k] = Math.floor(v);
  const seen = data.seen || {};
  p.seen.towns = Array.isArray(seen.towns) ? seen.towns.filter(x => typeof x === 'string').slice(-400) : [];
  p.seen.biomes = Array.isArray(seen.biomes) ? seen.biomes.filter(x => typeof x === 'string').slice(0, 40) : [];
  p.seen.deepest = Math.max(0, seen.deepest | 0);
  w.prog = p;
}
