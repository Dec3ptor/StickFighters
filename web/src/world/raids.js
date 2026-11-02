// Raids (world mode): now and then at night, the dead come for a town where players are. A horde
// gathers at the town's edges (zombies, skeletons, and brutes for the strong) and comes for the
// guards and anyone outside; the townsfolk shut themselves in. Everyone near the town is told
// ("Raid on Oakford!", and how many are left), and when the last raider falls, everyone who fought
// is thanked: coins and experience by how many they killed, and a piece of gear (gear.js: the more
// killed, the better its chances of being good). A raid not beaten by dawn is over too
// (the dead go back into the ground), with nothing for anyone.
//
// For one player or many (online, the host runs it: everyone near sees the same raid).

import { TILE } from './blocks.js';
import { hourOf, isNight, spawnMonster } from './monsters.js';
import { townsNear } from './townsfolk.js';
import { giveXp, progOf, countStat } from './progress.js';
import { hash3 } from './noise.js';
import { rollGear } from './gear.js';
import { dropFor } from './quests.js';

const CHECK_EVERY = 60 * 30;   // updates between chances of a raid starting (half a minute)
const CHANCE = 0.18;           // the chance each time (at night, a town with a player near)
const NEAR = 90;               // tiles from a town a player has to be (to bring one on, and to share in it)
const QUIET = 60 * 60 * 6;     // updates after a raid before the next can start

/** The raid going on in `world` ({ k (the town), name, monsters (soldier ids), kills: { player id: n }, ... }), or null. */
export const raidOf = world => world.raid || null;

/** A raid on town t starts: the horde at its edges. size: how many (by how strong the players near are). */
export function startRaid(game, t, size = 8) {
  const world = game.world, gen = world.gen;
  const players = game.soldiers.filter(s => s.alive && s.world && nearTown(s, t));
  const level = players.length ? Math.max(...players.map(s => progOf(s).level)) : 1;
  const ids = [];
  for (let i = 0; i < size; i++) {
    const side = i % 2 ? 1 : -1, x = side < 0 ? t.x0 - 6 - (i % 5) * 3 : t.x1 + 6 + (i % 5) * 3;
    const r = (hash3(gen.seed, t.k, world.time + i) % 100) / 100;
    const type = level >= 8 && r < 0.18 ? 'brute' : level >= 3 && r < 0.45 ? 'skeleton' : 'zombie';
    const m = spawnMonster(game, type, x * TILE + TILE / 2, (gen.surfaceAt(x) - 1) * TILE - 13);
    m.npc.raid = t.k;
    ids.push(m.id);
  }
  world.raid = { k: t.k, name: t.name, monsters: ids, total: ids.length, kills: {}, started: world.time, endsAt: null };
  for (const p of players) game.notify(p, `Raid on ${t.name}! The dead are coming: hold the town`);
  game.sound('rumble', (t.x0 + t.x1) / 2 * TILE, t.level * TILE);
  return world.raid;
}

/** True if player s is near town t (across, and not far below it). */
function nearTown(s, t) {
  const tx = s.x / TILE, ty = s.y / TILE;
  return tx > t.x0 - NEAR && tx < t.x1 + NEAR && ty < t.level + 40;
}

/** A raider killed (worldplay.js's onKill): counted for whoever killed it. */
export function raidKill(game, victim, by) {
  const raid = game.world.raid;
  if (!raid || victim.npc?.raid !== raid.k) return;
  if (by) raid.kills[by.id] = (raid.kills[by.id] || 0) + 1;
}

/** How many raiders are left (alive, or still to appear). */
export function raidersLeft(game) {
  const raid = game.world.raid;
  if (!raid) return 0;
  let n = 0;
  for (const id of raid.monsters) { const m = game.soldiers.find(s => s.id === id); if (m && (m.alive || !m.npc.spawned)) n++; }
  return n;
}

/** Each update (worldplay.js): raids start, go on, and end. */
export function raidsTick(game) {
  const world = game.world, gen = world.gen;
  if (!gen?.towns || game.mirror) return;
  const raid = world.raid;
  if (raid) {
    if (game.tick % 30) return;
    const t = gen.townIn(raid.k), left = raidersLeft(game);
    // Beaten: everyone who fought is thanked.
    if (left === 0) { endRaid(game, t, true); return; }
    // Dawn: the dead go back into the ground.
    if (!isNight(world.time)) {
      for (const id of raid.monsters) { const m = game.soldiers.find(s => s.id === id); if (m) game.removeSoldier(m); }
      endRaid(game, t, false);
    }
    return;
  }
  if (game.tick % CHECK_EVERY || !isNight(world.time) || hourOf(world.time) < 21 && hourOf(world.time) > 4) return;
  if (world.devQuiet || game.tick - (world.lastRaid ?? -1e9) < QUIET) return;
  // (A town with a player near it, and the dice.)
  for (const p of game.soldiers) {
    if (!p.alive || !p.world) continue;
    const t = townsNear(gen, p.x / TILE, NEAR)[0];
    if (!t || !nearTown(p, t)) continue;
    if (game.rng() >= CHANCE) return;
    const players = game.soldiers.filter(s => s.alive && s.world && nearTown(s, t)).length;
    startRaid(game, t, Math.min(20, 6 + players * 3 + (t.kind === 'city' ? 4 : 0)));
    return;
  }
}

/** A raid's over (won: beaten, rewards for whoever fought). */
function endRaid(game, t, won) {
  const world = game.world, raid = world.raid;
  world.raid = null;
  world.lastRaid = game.tick;
  for (const s of game.soldiers) {
    if (!s.world || !t || !nearTown(s, t)) continue;
    const kills = raid.kills[s.id] || 0;
    if (!won) { game.notify(s, `The dead have gone back into the ground. ${raid.name} is quiet again.`); continue; }
    if (!kills) { game.notify(s, `${raid.name} held! (Fight next time, for a share of the thanks.)`); continue; }
    const coins = 20 + kills * 8, xp = 60 + kills * 25;
    s.world.inv.add('coins', coins);
    giveXp(game, s, xp, `defending ${raid.name}`);
    countStat(s, 'raids');
    // (And a piece of gear: magic at least.)
    const seed = hash3(world.gen.seed, game.tick, s.id), ilvl = Math.min(30, progOf(s).level + 4);
    let piece = rollGear(seed, ilvl, 100 + kills * 15, null, null, (seed >>> 5) % 4 === 0);
    if (piece.g.r === 'basic') piece = rollGear(seed + 1, ilvl, 0, 'magic', null, (seed >>> 5) % 4 === 0);
    if (!s.world.inv.addGear(piece.key, piece.g)) dropFor(game, s, piece.key, 1, piece.g);
    game.notify(s, `${raid.name} held! The town thanks you: ${coins} coins and ${piece.g.name} (${kills} killed)`);
    game.sound('hallelujah', s.x, s.y, s.id);
  }
}
