// Kill streaks: kills in a row (without dying) earn rewards in the modes where they make
// sense (not gun game, one in the chamber or Defuse), banked until you use them (X; Z
// picks which). Every mode gets the callouts: multi-kills, sprees, first blood, and a
// shutdown for ending someone's streak. Also the end-of-match awards.
//
//   3 in a row  Supply Drop     a crate with a strong weapon parachutes in beside you
//   5           Sentry Sheep    an armoured sheep with a gun on its back, for 20 seconds
//   7           Sheep Stampede  a flock of exploding sheep runs at the nearest enemies
//   10          Juggernaut      30 seconds of armour, a minigun and no knockback
//
// Kills made by the sentry or the stampede count as frags, not toward the next reward.

import { BODY, MOTION, RULES } from './config.js';
import { WEAPONS } from './weapons.js';
import { spawn, canHurt } from './combat.js';

export const REWARDS = {
  supply: { kills: 3, name: 'Supply Drop', blurb: 'a crate with a strong weapon parachutes in beside you' },
  sentry: { kills: 5, name: 'Sentry Sheep', blurb: 'an armoured sheep with a gun: it shoots enemies near it for 20 s' },
  stampede: { kills: 7, name: 'Sheep Stampede', blurb: 'a flock of exploding sheep runs at the nearest enemies' },
  juggernaut: { kills: 10, name: 'Juggernaut', blurb: '30 s of armour, a minigun and no knockback' },
};
export const REWARD_IDS = ['supply', 'sentry', 'stampede', 'juggernaut'];

// Weapons only rewards use: their kills don't count toward the next reward.
export const REWARD_WEAPONS = new Set(['SentrySheep', 'Stampede']);

// How long things last, in updates (60 a second, whatever the game speed).
export const SENTRY_TICKS = 20 * 60;
export const JUGGER_TICKS = 30 * 60;
// Supply drops: only the caller (and their team) can open one for this long; then anyone can.
export const SUPPLY_LOCK = 10 * 60;
// Ending a streak this long (or longer) is a shutdown.
export const SHUTDOWN_AT = 5;

// Kills this close together (game time) make a multi-kill.
const multiWindow = () => 165 / MOTION.timeScale;

const MULTI = ['', '', 'Double kill', 'Triple kill', 'Multi kill', 'Mega kill', 'Monster kill'];
const MULTI_SOUND = ['', '', 'doubleKill', 'tripleKill', 'multiKill'];
const SPREES = { 3: ['Killing spree', 'spree'], 5: ['Rampage', 'rampage'], 10: ['Unstoppable', 'unstoppable'], 15: ['Godlike', 'unstoppable'], 20: ['Legendary', 'unstoppable'] };

// What a supply drop holds (the big guns), and how likely each is.
const SUPPLY_WEAPONS = {
  Minigun: 4, Bazooka: 4, HomingMissile: 4, SuperSheep: 3, HolyHandGrenade: 3, BananaBomb: 3, AirStrike: 3,
  MadCow: 3, Shotgun: 3, SR: 3, Flamer: 2, MagicBullet: 2, ConcreteDonkey: 1.5,
};

/** Kills in a row this soldier needs for its next reward (null: none left to earn this life). */
export function nextReward(s) {
  return REWARD_IDS.find(id => REWARDS[id].kills > (s.streak || 0)) || null;
}

// ---- Kills ------------------------------------------------------------------------------------

/**
 * Called by Game.kill, after the frag's been counted (killer: whoever gets the credit, or
 * null). The victim's streak ends (a shutdown if it was long), and the killer's goes on:
 * multi-kills, sprees, rewards earned. Messages are collected and the loudest news gets
 * the sound.
 */
export function onStreakKill(game, victim, killer, weapon, opts = {}) {
  const ended = victim.streak || 0;
  victim.streak = 0;
  victim.multi = 0;
  if (victim.jugger > 0) endJugger(game, victim, false);
  if (!killer || killer === victim) return;

  const news = []; // [priority, sound]
  const t = game.tick;
  const own = !REWARD_WEAPONS.has(weapon);

  if (game.firstBlood == null) {
    game.firstBlood = killer.id;
    game.callout(killer, 'First blood', `You got the first kill of the match`, 'first');
    game.callout(null, `${killer.name} drew first blood`, '', 'first', killer);
    news.push([5, 'firstBlood']);
  }
  if (ended >= SHUTDOWN_AT) {
    // A bonus for ending a long streak (where streaks earn rewards): a frag.
    let sub = `You ended ${victim.name}'s ${ended}-kill streak`;
    if (game.streaksOn) {
      killer.frags++;
      if (game.rules.teams && game.rules.killScore !== false) game.teamScore[killer.team]++;
      sub += ' · +1 frag';
    }
    game.callout(killer, 'Shutdown', sub, 'shutdown');
    game.callout(null, `${killer.name} ended ${victim.name}'s ${ended}-kill streak`, '', 'shutdown', killer);
    news.push([6, 'shutdown']);
  }

  // For the awards: headshots (with your own guns) and explosive kills.
  if (opts.headshot && own) killer.headshots = (killer.headshots || 0) + 1;
  if (opts.explosive && !opts.selfDestruct && !opts.world) killer.blasts = (killer.blasts || 0) + 1;

  // Kills close together.
  killer.multi = t - (killer.multiAt ?? -1e9) <= multiWindow() ? (killer.multi || 0) + 1 : 1;
  killer.multiAt = t;
  if (killer.multi >= 2) {
    const n = Math.min(killer.multi, MULTI.length - 1);
    game.callout(killer, MULTI[n], `${killer.multi} kills`, 'multi');
    news.push([2, MULTI_SOUND[Math.min(killer.multi, MULTI_SOUND.length - 1)]]);
  }

  // Kills in a row: only your own, while you're alive (not a grenade's after you died).
  if (own && killer.alive) {
    killer.streak = (killer.streak || 0) + 1;
    killer.bestStreak = Math.max(killer.bestStreak || 0, killer.streak);
    const spree = SPREES[killer.streak];
    if (spree) {
      game.callout(killer, spree[0], `${killer.streak} kills in a row`, 'spree');
      if (killer.streak >= 5) game.callout(null, `${killer.name}: ${spree[0].toLowerCase()} (${killer.streak} in a row)`, '', 'spree', killer);
      news.push([3, spree[1]]);
    }
    if (game.streaksOn) {
      const id = REWARD_IDS.find(r => REWARDS[r].kills === killer.streak);
      if (id && bank(game, killer, id)) news.push([1, 'rewardReady']);
    }
  }

  if (news.length && !killer.isBot) {
    news.sort((a, b) => b[0] - a[0]);
    game.sound(news[0][1], killer.x, killer.y, killer.id);
  }
}

/** Put reward `id` in the soldier's bank (one of each at most). True if it went in. */
export function bank(game, s, id) {
  s.bank ||= [];
  if (s.bank.includes(id)) return false;
  s.bank.push(id);
  s.bankedAt = game.tick;
  game.callout(s, `${REWARDS[id].name} ready`, `Press {key:streak} to use it: ${REWARDS[id].blurb}`, 'reward');
  return true;
}

/**
 * A soldier left play without dying (spectating): their streak and Juggernaut end, and their
 * sentry and stampede go with them (no kills for someone sitting out).
 */
export function streakOff(game, s) {
  s.streak = 0;
  s.multi = 0;
  if (s.jugger > 0) endJugger(game, s, false);
  for (const p of game.projectiles) if (p.owner === s && (p.kind === 'sentry' || p.cfg?.seek)) p.owner = null;
}

// ---- Using rewards -----------------------------------------------------------------------------

/** Use banked reward `id` (X). True if it was used (it can't be: dead, or no room for it here). */
export function useReward(game, s, id) {
  if (!game.streaksOn || !s.alive || !s.bank?.includes(id) || s.kamikaze) return false;
  if (!USE[id](game, s)) return false;
  s.bank.splice(s.bank.indexOf(id), 1);
  return true;
}

const USE = {
  supply(game, s) {
    const at = dropSpot(game, s);
    // (Nowhere for it to land: over a pit, say. It stays banked.)
    if (!at) { game.notify(s, 'No floor for a supply drop here'); return false; }
    const id = supplyWeapon(game, s);
    const def = WEAPONS[id];
    game.pickups.items.push({
      type: 'crate', weapon: id, health: false, ammo: def.maxAmmo ?? def.ammo,
      x: at.x, y: at.y, vx: 0, vy: MOTION.crateFall, fast: 2.4,
      active: true, dropped: true, landed: false, life: 99999, bob: 0,
      streak: true, owner: s.id, team: s.team, lock: SUPPLY_LOCK,
    });
    game.fx?.plane(at.x, Math.max(game.map.bounds.top - 60, at.y - 40), s.facing);
    game.sound('supplyDrop', at.x, at.y);
    game.notify(s, `Supply Drop incoming: ${def.name}`);
    return true;
  },

  sentry(game, s) {
    const cfg = WEAPONS.SentrySheep;
    let x = s.x + s.facing * 12;
    if (game.map.overlap(x - 7, s.y - 16, x + 7, s.y + BODY.bottom - 1)) x = s.x;
    // One at a time: an old one still out there folds up.
    for (const p of game.sentries || []) {
      if (p.owner === s && !p.dead) { p.dead = true; game.fx?.explosion(p.x, p.y - 8, 10); }
    }
    const p = spawn(game, {
      kind: 'sentry', sprite: 'sentry', cfg, x, y: s.y + BODY.bottom - 0.5, vx: s.body.vx * 0.3, vy: 0,
      dir: s.facing, angle: s.facing > 0 ? 0 : Math.PI, owner: s, team: s.team, weapon: 'SentrySheep',
      life: SENTRY_TICKS, hp: cfg.hp, r: 100, armed: cfg.arm, cool: 0, onGround: false,
    });
    (game.sentries ||= []).push(p);
    game.sound('sentryDeploy', x, s.y);
    game.notify(s, 'Sentry Sheep down: it shoots enemies near it for 20 seconds');
    return true;
  },

  stampede(game, s) {
    const cfg = WEAPONS.Stampede;
    // Sent after the nearest enemies, a few sheep each.
    const enemies = game.near(s.x - 1600, s.y - 600, s.x + 1600, s.y + 600).filter(o => o !== s && o.alive && canHurt(game, s, o))
      .sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y)).slice(0, 3);
    for (let i = 0; i < cfg.count; i++) {
      const target = enemies.length ? enemies[i % enemies.length] : null;
      const dir = target ? Math.sign(target.x - s.x) || s.facing : (i % 2 ? -s.facing : s.facing);
      let x = s.x + dir * 8;
      if (game.map.overlap(x - 5, s.y, x + 5, s.y + BODY.bottom - 1)) x = s.x;
      spawn(game, {
        kind: 'walker', sprite: cfg.sprite, cfg, x, y: s.y + BODY.bottom - 0.5, vx: 0, vy: -1.5 * MOTION.timeScale, dir,
        owner: s, weapon: 'Stampede', life: cfg.fuse, remote: false, delay: i * cfg.interval, onGround: false,
        target, speed: cfg.walkSpeed * (0.85 + game.rng() * 0.3),
      });
    }
    game.sound('stampede', s.x, s.y);
    game.shake(s.x, s.y, 6);
    game.callout(null, `${s.name} let loose a Sheep Stampede`, '', 'use', s);
    return true;
  },

  juggernaut(game, s) {
    s.jugger = JUGGER_TICKS;
    s.health = s.maxHealth;
    s.armour = RULES.maxArmour;
    s.burnTicks = 0;
    s.weapons.JuggerGun = { ammo: Infinity };
    s.current = 'JuggerGun';
    s.lastInSlot[WEAPONS.JuggerGun.slot] = 'JuggerGun';
    s.spin = 0;
    s.reloadTimer = 0;
    s.reloading = null;
    s.cooldown = Math.max(s.cooldown, 10);
    s.body.rope = null;
    game.fx?.ring(s.x, s.y - 10, '#ff9a1f');
    game.sound('juggernaut', s.x, s.y);
    game.shake(s.x, s.y, 8);
    game.callout(s, 'Juggernaut', '30 seconds of armour, a minigun and no knockback', 'jugger');
    game.callout(null, `${s.name} is a Juggernaut: run!`, '', 'jugger', s);
    return true;
  },
};

/**
 * Where a supply drop lands: beside the soldier (in front, else behind, else at their
 * feet), on a floor with room for the crate. It starts not far above (under a roof indoors).
 * Null when there's no floor below (in the air over a pit).
 */
function dropSpot(game, s) {
  const map = game.map;
  for (const off of [34, -34, 60, -60, 0]) {
    const x = s.x + off * s.facing;
    const hit = map.raycast(x, s.y - 20, x, s.y + 600);
    if (!hit || hit.ny >= 0 || hit.solid.bounce) continue;
    const floor = hit.y;
    if (map.overlap(x - 8, floor - 18, x + 8, floor - 1)) continue;
    // Nothing between the soldier and the spot (no dropping it the other side of a wall).
    if (!map.clearLine(s.x, s.y - 10, x, floor - 10)) continue;
    const roof = map.raycast(x, floor - 20, x, map.bounds.top - 60);
    const top = roof ? roof.y + 10 : map.bounds.top - 40;
    if (floor - top < 24) continue;
    return { x, y: Math.max(top, floor - 300) };
  }
  // (No room beside them: at their feet, if there's a floor under them.)
  const under = map.raycast(s.x, s.y - 10, s.x, s.y + 600);
  return under && under.ny < 0 ? { x: s.x, y: s.y - 20 } : null;
}

/** A strong weapon for a supply drop (one the soldier hasn't got, if it comes up). */
function supplyWeapon(game, s) {
  const ids = Object.keys(SUPPLY_WEAPONS).filter(id => WEAPONS[id] && !WEAPONS[id].hidden);
  let pick = ids[0];
  for (let tries = 0; tries < 3; tries++) {
    let total = 0;
    for (const id of ids) total += SUPPLY_WEAPONS[id];
    let r = game.rng() * total;
    for (const id of ids) { r -= SUPPLY_WEAPONS[id]; if (r <= 0) { pick = id; break; } }
    if (!s.has(pick)) break;
  }
  return pick;
}

/** True if soldier s may open crate `it` (a supply drop is the caller's, or their team's, for a while). */
export function canOpen(game, s, it) {
  if (!it.streak || it.owner === s.id || !(it.lock > 0)) return true;
  return !!game.rules.teams && it.team === s.team;
}

// ---- Every update ---------------------------------------------------------------------------

/** Juggernauts' time running out. */
export function updateStreaks(game) {
  for (const s of game.soldiers) {
    if (s.jugger > 0 && s.alive && --s.jugger <= 0) endJugger(game, s, true);
  }
}

/** The Juggernaut ends: its minigun goes (alive: they're told, and take out their best weapon). */
export function endJugger(game, s, alive) {
  s.jugger = 0;
  delete s.weapons.JuggerGun;
  if (s.current === 'JuggerGun') {
    s.current = 'Platinum';
    if (alive) s.selectBest(true);
  }
  if (alive) {
    game.notify(s, 'The Juggernaut wore off');
    game.fx?.ring(s.x, s.y - 10, '#999');
  }
}

// ---- Bots ---------------------------------------------------------------------------------------

/**
 * A banked reward a bot should use now, or null: the Juggernaut and supply drops straight
 * away, the sentry with an enemy or objective near (or after a while), the stampede with
 * enemies on the ground not far off (or after a while).
 */
export function botReward(game, s, bot) {
  if (!game.streaksOn || !s.alive || !s.bank?.length || !s.body.onGround || s.kamikaze) return null;
  const held = game.tick - (s.bankedAt ?? 0);
  const fighting = !!bot?.target;
  for (const id of [...s.bank].reverse()) {
    if (id === 'juggernaut' && !(s.jugger > 0)) return id;
    if (id === 'supply' && held > 30) return id;
    if (id === 'sentry' && (fighting || bot?.goalKind === 'hold' || held > 600)) return id;
    if (id === 'stampede') {
      // (With bot vision 'sight', only an enemy it knows about.)
      const near = game.options.botVision === 'sight' ? fighting && Math.abs(bot.target.y - s.y) < 220
        : game.near(s.x - 900, s.y - 220, s.x + 900, s.y + 220).some(o => o !== s && o.alive && canHurt(game, s, o) && Math.abs(o.x - s.x) < 900 && Math.abs(o.y - s.y) < 220);
      if (near || held > 900) return id;
    }
  }
  return null;
}

// ---- End of the match --------------------------------------------------------------------------

/**
 * The end-of-match awards, as plain data (sent to online players): MVP, best streak, most
 * headshots, demolition expert. Each: { id, title, soldier (id), name, team, text }.
 * Awards nobody earned (no headshots all match) are left out.
 */
export function matchAwards(game) {
  const order = game.standings();
  const w = game.winner;
  const pool = w?.team ? order.filter(s => s.team === w.team) : order;
  const mvp = w?.soldier || pool[0] || order[0];
  const award = (id, title, s, text) => s && { id, title, soldier: s.id, name: s.name, team: s.team, text };
  const most = key => {
    let best = null;
    for (const s of order) if ((s[key] || 0) > (best?.[key] || 0)) best = s;
    return best;
  };
  const out = [];
  if (mvp) {
    const label = game.rules.scoreLabel;
    const score = label && label !== 'Frags' ? ` · ${label.toLowerCase()} ${game.rules.score(mvp)}` : '';
    out.push(award('mvp', 'MVP', mvp, `${mvp.frags} frag${mvp.frags === 1 ? '' : 's'}, ${mvp.deaths} death${mvp.deaths === 1 ? '' : 's'}${score}`));
  }
  const streak = most('bestStreak');
  if (streak && streak.bestStreak >= 2) out.push(award('streak', 'Best streak', streak, `${streak.bestStreak} kills in a row`));
  const heads = most('headshots');
  if (heads) out.push(award('headshots', 'Most headshots', heads, `${heads.headshots} headshot${heads.headshots === 1 ? '' : 's'}`));
  const blasts = most('blasts');
  if (blasts) out.push(award('demolition', 'Demolition expert', blasts, `${blasts.blasts} explosive kill${blasts.blasts === 1 ? '' : 's'}`));
  return out.filter(Boolean);
}
