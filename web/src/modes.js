// Game modes: who scores, what everyone spawns with, which pickups are around,
// and how a match is won. The game calls these hooks; adding a mode means
// adding an entry here (and it shows up in the menus).

import { WEAPONS, STARTING_WEAPONS } from './weapons.js';
import { objectiveModes } from './objmodes.js';
import { defuseMode } from './defuse.js';

/** Gun game: every kill moves you one weapon along. A kill with the last one wins. */
export const GUN_GAME_LADDER = [
  'Platinum', 'Magnum', 'Uzi', 'Minigun', 'M4', 'Shotgun', 'Longbow', 'SR', 'MagicBullet',
  'GrenadeLauncher', 'ClusterBomb', 'Bazooka', 'HomingMissile', 'Flamer', 'SuperSheep', 'BaseballBat',
];

/** Put a weapon in a soldier's hands (full magazine or the usual pickup amount of ammo). */
export function giveWeapon(s, id, ammo) {
  const def = WEAPONS[id];
  if (!def) return;
  if (def.mag) s.weapons[id] = { ammo: Infinity, mag: def.mag };
  else s.weapons[id] = { ammo: ammo ?? def.ammo ?? Infinity };
}

const byFrags = (a, b) => b.frags - a.frags || a.deaths - b.deaths;

const deathmatch = {
  name: 'Free-for-all',
  blurb: 'Everyone for themselves. First to the frag limit wins.',
  teams: false,
  pickups: true,       // weapons, health, armour and jetpacks on the map
  crates: true,        // supply crates from the sky
  dropWeapons: true,   // the dead drop the weapon in their hands
  infiniteAmmo: false,
  mapLoadout: true,    // the map's "everyone spawns with" items apply
  limit: 'frags',      // what the match limit counts (frags or lives)
  streaks: true,       // kills in a row earn rewards (streaks.js)
  // classes: false     the Classes option isn't offered (this mode hands out its own weapons)
  // classesDefault     the setup's Classes option starts on (Battlefield's own modes)

  setup(game, s) {},

  spawnLoadout(game, s) {
    for (const id of STARTING_WEAPONS) giveWeapon(s, id);
    const lo = game.map.loadout;
    if (lo && this.mapLoadout) {
      for (const id of lo.weapons || []) if (WEAPONS[id] && !WEAPONS[id].hidden) giveWeapon(s, id);
      if (lo.armour) s.armour = Math.min(100, lo.armour);
      if (lo.jetpack) { s.body.hasJetpack = true; s.body.fuel = 100; }
    }
    s.current = 'Platinum';
    s.selectBest(true);
  },

  /** Change the damage a hit does (one-hit kills and so on). */
  damage(game, amount) { return amount; },

  onKill(game, victim, killer, weapon, opts) {},

  canRespawn(game, s) { return true; },

  winner(game) {
    const top = game.soldiers.find(s => s.frags >= game.fragLimit);
    return top ? { soldier: top } : null;
  },

  compare: byFrags,
  score: s => s.frags,
  scoreLabel: 'Frags',
};

const team = {
  ...deathmatch,
  name: 'Team deathmatch',
  blurb: 'Blue against red. First team to the frag limit wins.',
  teams: true,
  winner(game) {
    for (const t of [1, 2]) if (game.teamScore[t] >= game.fragLimit) return { team: t };
    return null;
  },
};

const gungame = {
  ...deathmatch,
  name: 'Gun game',
  blurb: `Every kill moves you to the next weapon, through all ${GUN_GAME_LADDER.length}. The first kill with the last one (the bat) wins. Get knocked off by a prod and you go back one.`,
  pickups: false,
  crates: false,
  dropWeapons: false,
  infiniteAmmo: true,
  mapLoadout: false,
  limit: 'none',
  classes: false,
  streaks: false,      // (rewards would skip the ladder)

  setup(game, s) { s.level = 0; s.levelKills = 0; },

  spawnLoadout(game, s) {
    s.weapons = {};
    giveWeapon(s, 'Sledgehammer');
    const id = GUN_GAME_LADDER[Math.min(s.level || 0, GUN_GAME_LADDER.length - 1)];
    giveWeapon(s, id);
    s.current = id;
  },

  onKill(game, victim, killer, weapon, opts) {
    const need = game.options.gunGameKills || 1;
    if (!killer || killer === victim) {
      // Suicide or an uncredited fall: back one weapon.
      if (victim.level > 0) { victim.level--; victim.levelKills = 0; game.notify(victim, `Back to the ${WEAPONS[GUN_GAME_LADDER[victim.level]].name}`); }
      return;
    }
    if (weapon === 'Sledgehammer' && victim.level > 0) {
      victim.level--;
      victim.levelKills = 0;
      game.notify(victim, `Humiliated! Back to the ${WEAPONS[GUN_GAME_LADDER[victim.level]].name}`);
      game.notify(killer, `You humiliated ${victim.name}`);
    }
    if (++killer.levelKills < need) return;
    killer.levelKills = 0;
    if (killer.level >= GUN_GAME_LADDER.length - 1) { killer.level = GUN_GAME_LADDER.length; return; }
    killer.level++;
    const id = GUN_GAME_LADDER[killer.level];
    if (killer.alive) {
      killer.weapons = {};
      giveWeapon(killer, 'Sledgehammer');
      giveWeapon(killer, id);
      killer.current = id;
      killer.cooldown = Math.max(killer.cooldown, 10);
      killer.reloadTimer = 0;
    }
    game.sound('levelUp', killer.x, killer.y);
    game.notify(killer, `Level ${killer.level + 1}: ${WEAPONS[id].name}`);
  },

  winner(game) {
    const top = game.soldiers.find(s => s.level >= GUN_GAME_LADDER.length);
    return top ? { soldier: top } : null;
  },

  compare: (a, b) => (b.level || 0) - (a.level || 0) || byFrags(a, b),
  score: s => Math.min(s.level || 0, GUN_GAME_LADDER.length - 1) + 1,
  scoreLabel: 'Level',
};

const oitc = {
  ...deathmatch,
  name: 'One in the chamber',
  blurb: 'A pistol with one bullet that kills in one shot, and a bat that does too. Every kill gives you a bullet. Everyone has 3 lives: the last one standing wins.',
  pickups: false,
  crates: false,
  dropWeapons: false,
  mapLoadout: false,
  limit: 'lives',
  classes: false,
  streaks: false,      // (one bullet is the point)

  setup(game, s) { s.lives = game.options.lives || 3; },

  spawnLoadout(game, s) {
    s.weapons = {};
    giveWeapon(s, 'Chamber', s.bullets ?? 1);
    giveWeapon(s, 'BaseballBat', Infinity);
    s.current = s.weapons.Chamber.ammo > 0 ? 'Chamber' : 'BaseballBat';
  },

  damage(game, amount, attacker, target, weapon) {
    const def = WEAPONS[weapon];
    if (def && def.kind === 'melee' && weapon !== 'Sledgehammer' && attacker && attacker !== target) return 1000;
    return amount;
  },

  onKill(game, victim, killer, weapon, opts) {
    victim.lives = Math.max(0, (victim.lives ?? 1) - 1);
    victim.bullets = 1;
    if (victim.lives <= 0) game.notify(victim, "You're out of lives");
    if (killer && killer !== victim && killer.alive) {
      const ch = killer.weapons.Chamber;
      if (ch) {
        ch.ammo++;
        if (killer.current !== 'Chamber') killer.select('Chamber');
        game.notify(killer, '+1 bullet');
      }
    }
  },

  canRespawn(game, s) { return (s.lives ?? 1) > 0; },

  winner(game) {
    // (Players spectating are sitting this one out.)
    const playing = game.soldiers.filter(s => !s.spectating);
    if (playing.length < 2) return null;
    const left = playing.filter(s => (s.lives ?? 1) > 0);
    if (left.length === 1) return { soldier: left[0] };
    if (left.length === 0) return { soldier: game.standings()[0] };
    return null;
  },

  compare: (a, b) => (b.lives ?? 0) - (a.lives ?? 0) || byFrags(a, b),
  score: s => s.lives ?? 0,
  scoreLabel: 'Lives',
};

const { koth, ctf, conquest, rush } = objectiveModes(team);
const defuse = defuseMode(team);

export const MODES = { ffa: deathmatch, team, gungame, oitc, koth, ctf, conquest, rush, defuse };
export const MODE_IDS = Object.keys(MODES);

export const modeOf = id => MODES[id] || MODES.ffa;
