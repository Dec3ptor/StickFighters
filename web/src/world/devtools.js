// The dev menu's actions (worlds: devpanel.js shows them, P in dev mode). For a player in dev
// mode (devmode.js): god mode, invisible, flying or walking (and how fast), the lights, the time,
// monsters or none, going places, beasts summoned at the crosshair (against everyone, or on your
// side: they follow you and fight for you), strikes and an earthquake called down, supply crates,
// gear rolled in any rarity, a raid on the nearest town; and, for the host (or playing alone), the
// other players: going to them, bringing them, healing them, dev mode for them. (Sending someone
// away is the network's: main.js.)

import * as K from './blocks.js';
import { TILE, AIR } from './blocks.js';
import { WORLD_H } from './worldgen.js';
import { MONSTERS, spawnMonster, hireMerc, isHostile, DAY_TICKS } from './monsters.js';
import { ANIMALS, spawnAnimal } from './animals.js';
import { devOn, setDev, openSpotNear, moveTo, devKey } from './devmode.js';
import { strikeAt, explode } from '../combat.js';
import { rollGear, RARITY } from './gear.js';
import { startRaid } from './raids.js';
import { townsNear } from './townsfolk.js';
import { progOf, giveXp, xpToNext, MAX_LEVEL } from './progress.js';
import { dropItem } from './worldplay.js';
import { homeOf } from './sleep.js';
import { WEAPONS } from '../weapons.js';

/** What can be summoned (MONSTERS' kinds), and the strikes that can be called down. */
export const SUMMONS = Object.keys(MONSTERS);
/** The animals that can be summoned (animals.js). */
export const ANIMAL_SUMMONS = Object.keys(ANIMALS);
export const STRIKES = { AirStrike: 'Air strike', NapalmStrike: 'Napalm strike', ConcreteDonkey: 'Concrete donkey' };
/** The times of day there are buttons for: [hour, what it's called]. */
export const TIMES = [[7, 'morning'], [12, 'noon'], [19, 'evening'], [0, 'midnight']];
/** Where the menu takes you (devmode.js's keys, and your bed). */
export const PLACES = { start: 'KeyH', surface: 'KeyU', deep: 'KeyO', west: 'Comma', east: 'Period', bed: null };
const CHAMPION_NAMES = ['Gorrath', 'Vex the Hollow', 'Old Bonegrin', 'Murkfang', 'Skarn the Unburied', 'The Pale Warden', 'Grimtusk', 'Ashmaw', 'Mother Rot', 'Kragg'];
let rolls = 0;

/** Back to full health, and not on fire. */
function heal(s) {
  s.health = Math.max(s.health, s.maxHealth || s.health);
  s.burnTicks = 0;
}

/** Where an action happens: the tile asked for (the crosshair's), not too far from s; else where s is. */
function spotOf(s, arg) {
  const tx0 = Math.floor(s.x / TILE), ty0 = Math.floor(s.y / TILE);
  if (!arg || !Number.isInteger(arg.x) || !Number.isInteger(arg.y)) return { tx: tx0 + s.facing * 4, ty: ty0 };
  const near = (v, c) => Math.max(c - 150, Math.min(c + 150, v));
  return { tx: near(arg.x, tx0), ty: Math.max(0, Math.min(WORLD_H - 2, near(arg.y, ty0))) };
}

/**
 * Dev menu action `act` (with `arg`) for player s, in dev mode. gm: they're the host (or playing
 * alone), so the other players are theirs to see to. Returns what to tell them, or null.
 */
export function devAct(game, s, act, arg = null, gm = false) {
  const w = s?.world, dev = w?.dev, world = game.world;
  if (!dev || !devOn(s) || typeof act !== 'string') return null;
  switch (act) {
    // ---- You.
    case 'god': dev.god = !dev.god; if (dev.god) heal(s); return dev.god ? 'God mode: nothing hurts you, and you can\'t die' : 'God mode off: you can be hurt (and die)';
    case 'invisible': dev.invisible = !dev.invisible; return dev.invisible ? 'Invisible: monsters don\'t see you, and nor do other players' : 'Visible again';
    case 'fly': dev.fly = dev.fly === false; s.body.vx = s.body.vy = 0; return dev.fly ? 'Flying: through anything' : 'Walking (still in dev mode)';
    case 'speed': dev.speed = [0.5, 1, 2, 4].includes(+arg) ? +arg : 1; return `Flying speed ×${dev.speed}`;
    case 'lights': dev.lights = !dev.lights; return dev.lights ? 'Everything lit' : 'Lit as it is';
    case 'heal': heal(s); return 'Healed';
    case 'level': {
      const p = progOf(s);
      if (p.level >= MAX_LEVEL) return 'Already at the top level';
      giveXp(game, s, Math.max(1, xpToNext(p.level) - p.xp), 'dev mode');
      return `Level ${progOf(s).level}`;
    }
    case 'coins': { const left = w.inv.add('coins', 999); if (left) dropItem(game, 'coins', left, s.x, s.y - 14, 0, -2, 30); return '999 coins'; }
    // ---- The world.
    case 'time': {
      const at = TIMES.find(t => t[0] === +arg) || TIMES[0], day = Math.floor((world.time || 0) / DAY_TICKS);
      // (World time 0 is six in the morning; always on, never back.)
      let t = day * DAY_TICKS + (((at[0] - 6 + 24) % 24) / 24) * DAY_TICKS;
      if (t <= (world.time || 0)) t += DAY_TICKS;
      world.time = t;
      return `It's ${at[1]}`;
    }
    case 'quiet':
      world.devQuiet = !world.devQuiet;
      if (world.devQuiet) for (const m of game.soldiers.filter(isHostile)) game.removeSoldier(m);
      return world.devQuiet ? 'No monsters' : 'Monsters come out again';
    case 'clear': {
      let n = 0;
      for (const m of [...game.soldiers]) {
        if (!m.alive || !isHostile(m) || Math.abs(m.x - s.x) > 90 * TILE || Math.abs(m.y - s.y) > 60 * TILE) continue;
        game.fx?.ring(m.x, m.y - 6, '#7a4fd0');
        game.removeSoldier(m);
        n++;
      }
      return n ? `${n} monster${n === 1 ? '' : 's'} gone` : 'No monsters near';
    }
    case 'raid': {
      const x = s.x / TILE, t = townsNear(world.gen, x, 600).sort((a, b) => Math.abs((a.x0 + a.x1) / 2 - x) - Math.abs((b.x0 + b.x1) / 2 - x))[0];
      if (!t) return 'No town near enough for a raid';
      startRaid(game, t, 10);
      return `The dead are coming for ${t.name}!`;
    }
    // ---- Going places.
    case 'goto': {
      if (arg === 'bed') {
        const h = homeOf(game, s);
        if (!h) return 'You have no bed (right click one to make it yours)';
        moveTo(s, h.x, h.y);
        return 'At your bed';
      }
      // (devmode.js's keys say where.)
      if (PLACES[arg]) devKey(game, s, PLACES[arg]);
      return null;
    }
    // ---- Summoning, at the crosshair (arg: { type, n, ally, champion, x, y }: x, y its tile).
    case 'summon': {
      // (An animal: a herd of them.)
      if (ANIMALS[arg?.type]) {
        const n = Math.max(1, Math.min(20, arg.n | 0 || 1)), { tx, ty } = spotOf(s, arg), at = openSpotNear(world, tx, ty), def = ANIMALS[arg.type];
        for (let i = 0; i < n; i++) spawnAnimal(game, arg.type, at.x + ((i % 2 ? 1 : -1) * Math.ceil(i / 2)) * 14, at.y);
        game.fx?.ring(at.x, at.y - 6, '#8ad45a');
        const name = def.name.toLowerCase();
        return n > 1 ? `${n} ${['sheep', 'deer', 'fish'].includes(name) ? name : `${name}s`}` : `A ${name}`;
      }
      const a = arg && typeof arg === 'object' ? arg : {}, type = MONSTERS[a.type] ? a.type : SUMMONS[0], def = MONSTERS[type];
      const n = Math.max(1, Math.min(20, a.n | 0 || 1)), { tx, ty } = spotOf(s, a), at = openSpotNear(world, tx, ty);
      let named = null;
      for (let i = 0; i < n; i++) {
        const m = spawnMonster(game, type, at.x + ((i % 2 ? 1 : -1) * Math.ceil(i / 2)) * 14, at.y);
        if (a.ally) { m.npc.ally = s.id; m.name = `${def.name} (${s.name}'s)`; }
        if (a.champion) {
          named = CHAMPION_NAMES[(game.tick + i * 3 + s.id) % CHAMPION_NAMES.length];
          m.name = a.ally ? `${named} (${s.name}'s)` : named;
          m.maxHealth = Math.round(def.health * (type === 'brute' ? 3 : 4));
          m.npc.champion = 'dev';
        }
      }
      game.fx?.ring(at.x, at.y - 6, a.ally ? '#3fb950' : '#c8282e');
      const what = a.champion ? (n > 1 ? `${n} named ${def.name.toLowerCase()}s` : `${named}, a named ${def.name.toLowerCase()}`) : n > 1 ? `${n} ${def.name.toLowerCase()}s` : `A ${def.name.toLowerCase()}`;
      return `${what}${a.ally ? ', on your side' : ''}`;
    }
    case 'merc': hireMerc(game, s); return 'A mercenary, on your side';
    // ---- Strikes and such, at the crosshair.
    case 'strike': {
      const id = STRIKES[arg?.id] ? arg.id : 'AirStrike', { tx, ty } = spotOf(s, arg);
      strikeAt(game, s, id, tx * TILE + TILE / 2, ty * TILE + TILE / 2);
      return `${STRIKES[id]}, on its way`;
    }
    case 'quake': game.quake = { ticks: WEAPONS.Earthquake.duration, owner: s, cfg: WEAPONS.Earthquake }; return 'Earthquake!';
    case 'smite': {
      const { tx, ty } = spotOf(s, arg), x = tx * TILE + TILE / 2, y = ty * TILE + TILE / 2;
      explode(game, x, y, { radius: 70, damage: 300, knock: 14 }, s, 'AirStrike');
      return 'Smitten';
    }
    case 'crate': {
      const { tx, ty } = spotOf(s, arg), at = openSpotNear(world, tx, ty), cx = Math.floor(at.x / TILE), cy = Math.floor(at.y / TILE);
      if (world.tile(cx, cy) !== AIR) return 'No room for a crate there';
      world.setTile(cx, cy, K.LOOT_CRATE);
      return 'A supply crate (break it open)';
    }
    // ---- Gear, rolled in any rarity (arg: { r, weapon }).
    case 'roll': {
      const r = RARITY[arg?.r] ? arg.r : 'legendary', weapon = !!arg?.weapon;
      const it = rollGear((game.tick * 7919 + s.id * 104729 + ++rolls * 31337) | 0, 40, 0, r, null, weapon);
      if (!w.inv.addGear(it.key, it.g)) dropItem(game, it.key, 1, s.x, s.y - 14, s.facing * 2, -2, 30, it.g);
      return `Rolled: ${it.g.name} (${RARITY[it.g.r].name.toLowerCase()})`;
    }
    // ---- The other players (the host's to see to): arg { id, op }.
    case 'gm': {
      if (!gm) return null;
      const o = game.soldiers.find(x => x.id === arg?.id && x.world && !x.npc && x !== s);
      if (!o) return null;
      switch (arg.op) {
        case 'goto': moveTo(s, o.x, o.y); return `With ${o.name}`;
        case 'bring': moveTo(o, s.x, s.y); game.notify(o, `${s.name} brought you to them`); return `${o.name} brought here`;
        case 'heal': heal(o); game.notify(o, `${s.name} healed you`); return `${o.name} healed`;
        case 'dev': setDev(game, o, !o.world.dev); return `${o.name}: dev mode ${o.world.dev ? 'on' : 'off'}`;
        default: return null;
      }
    }
    default: return null;
  }
}

/** What the dev menu shows of player s's dev mode (the switches, as they are). */
export function devState(s) {
  const d = s?.world?.dev || s?.world?.hostDev || null;
  return d ? { god: !!d.god, invisible: !!d.invisible, fly: d.fly !== false, speed: d.speed || 1, lights: d.lights !== false } : null;
}
