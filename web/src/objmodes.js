// The objective modes: king of the hill, capture the flag, conquest and rush.
// Blue and red fight over places on the map (objectives.js says where they
// are). What's going on lives in game.modeState: plain data that the host
// sends to online players with every snapshot (so it only holds numbers,
// strings and soldier ids, never soldiers themselves).
//
// Hooks these modes add to the ones in modes.js (the game and bots call them):
//   begin(game)              set up game.modeState at the start of a match
//   tick(game)               every update (on the host, or offline)
//   spawnPoint(game, s)      where to respawn (null: the usual pick from spawnPoints)
//   spawnPoints(game, s)     the spawn points to pick from
//   onRemove(game, s)        a soldier left the game
//   botGoal(game, s, bot)    where a bot should be: { zone, hold, urgent } or null
//   goal                     the menu's "points to win" / tickets choice

import { objectivesOf, spotsIn, inZone, mcomZone, touchesFlag, floorBelow, STAND } from './objectives.js';
import { explode } from './combat.js';

const SEC = 60;                // the game always updates 60 times a second
const HILL_MOVES = 60 * SEC;   // king of the hill: the hill moves every minute (maps with several)
const FLAG_RETURN = 20 * SEC;  // a dropped flag goes home by itself after this
const CAPTURE = 7 * SEC;       // conquest: one soldier takes a neutral point in 7 s
const BLEED_EVERY = 5 * SEC;   // conquest: the team holding fewer points loses tickets this often
const ARM = 2 * SEC;           // rush: standing at an M-COM this long arms it...
const DISARM = 7 * SEC;        // ...and this long disarms it
const FUSE = 14 * SEC;         // rush: an armed M-COM blows up after this
const MCOM_BLAST = { radius: 150, damage: 260, knock: 12 };

export const TEAM_NAME = { 1: 'Blue', 2: 'Red' };
const other = t => (t === 1 ? 2 : 1);

/** A number from a soldier's id (and a salt): spreads bots across objectives the same way every time. */
const hash = (id, salt = 0) => {
  let h = (id * 2654435761 + salt * 40503) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

const byId = (game, id) => (id < 0 ? null : game.soldiers.find(s => s.id === id) || null);

/** Living soldiers of each team in an area: [_, blue, red]. */
function countIn(game, z) {
  const n = [0, 0, 0];
  for (const s of game.near(z.left, z.top, z.right, z.bottom)) if (s.alive && s.team && inZone(s, z)) n[s.team]++;
  return n;
}

function enemiesNear(game, z, team, margin) {
  for (const s of game.near(z.left - margin, z.top - margin, z.right + margin, z.bottom + margin)) {
    if (s.alive && s.team && s.team !== team && s.x > z.left - margin && s.x < z.right + margin && s.y > z.top - margin && s.y < z.bottom + margin) return true;
  }
  return false;
}

/** True if an enemy of `team` is within `r` px of a spawn point. */
function spawnUnsafe(game, p, team, r = 250) {
  for (const o of game.near(p.x - r, p.y - r, p.x + r, p.y + r)) {
    if (o.alive && o.team && o.team !== team && Math.abs(o.x - p.x) < r && Math.abs(o.y - p.y) < r) return true;
  }
  return false;
}

/** A message for everyone on a team (players only; bots don't read). */
function tell(game, team, text) {
  for (const s of game.soldiers) if (!s.isBot && s.team === team) game.notify(s, text);
}

/** A sound for one team (good news) and another for the other (bad news). */
function news(game, team, good = 'objGood', bad = 'objBad') {
  game.sound(good, null, null, -team);
  game.sound(bad, null, null, -other(team));
}

const award = (s, n) => { if (s) s.points = (s.points || 0) + n; };

/** The menu's goal: 0 picks the mode's own (tickets scaled to how many are playing). */
function goalOf(game, mode) {
  if (game.fragLimit > 0) return game.fragLimit;
  if (mode.goal.auto) {
    const perTeam = Math.max(1, Math.ceil(game.soldiers.filter(s => s.team).length / 2));
    return Math.min(30000, Math.round((mode.goal.auto[0] + mode.goal.auto[1] * perTeam) / 10) * 10);
  }
  return mode.goal.value;
}

/** A spot to stand on inside an area (spawning on a capture point). */
function spotIn(game, z) {
  const list = spotsIn(game.map, z);
  if (!list.length) return null;
  const p = list[Math.floor(game.rng() * list.length)];
  return { x: p.x, y: p.y - STAND - 8 };
}

export function objectiveModes(base) {
  const common = {
    ...base,
    teams: true,
    objective: true,
    killScore: false,   // kills don't move the team score; the objective does
    limit: 'goal',
    setup(game, s) { s.points = 0; },
    compare: (a, b) => ((b.points || 0) + b.frags) - ((a.points || 0) + a.frags) || b.frags - a.frags || a.deaths - b.deaths,
    score: s => (s.points || 0) + s.frags,
    scoreLabel: 'Score',
    /** Team spawn points: the ones without a Rush sector, if the map has any. */
    spawnPoints(game, s) {
      const sets = (game.spawnSets ||= new Map());
      const key = `base${s.team}`;
      if (!sets.has(key)) {
        const mine = game.spawns.filter(p => p.team === s.team);
        const base = mine.filter(p => !p.sector);
        sets.set(key, base.length ? base : mine.length ? mine : game.spawns);
      }
      return sets.get(key);
    },
    winner(game) {
      const goal = goalOf(game, this);
      for (const t of [1, 2]) if (game.teamScore[t] >= goal) return { team: t };
      return null;
    },
  };

  // ---- King of the hill ------------------------------------------------------------------

  const koth = {
    ...common,
    name: 'King of the hill',
    blurb: 'Hold the hill: your team scores a point every second it has the hill to itself. First to the score wins. If the map has more than one hill, it moves every minute.',
    goal: { label: 'Points to win', options: [50, 100, 150, 250], value: 100 },

    begin(game) {
      const hills = objectivesOf(game.map, 'hill');
      game.modeState = { hill: 0, owner: 0, acc: 0, moves: hills.length > 1 ? HILL_MOVES : 0, count: [0, 0, 0] };
    },

    tick(game) {
      const st = game.modeState, hills = objectivesOf(game.map, 'hill');
      if (!hills.length) return;
      if (st.moves > 0 && --st.moves <= 0) {
        st.hill = (st.hill + 1) % hills.length;
        st.moves = HILL_MOVES;
        st.owner = 0;
        st.acc = 0;
        game.addFeed({ text: 'The hill has moved!', tick: game.tick });
        game.sound('hillMoved', null, null);
      }
      const z = hills[st.hill];
      const n = st.count = countIn(game, z);
      const owner = n[1] && !n[2] ? 1 : n[2] && !n[1] ? 2 : 0;
      if (owner !== st.owner) {
        if (owner) {
          news(game, owner);
          tell(game, owner, 'Your team has the hill');
          tell(game, other(owner), `${TEAM_NAME[owner]} has the hill!`);
        }
        st.owner = owner;
        st.acc = 0;
      }
      if (owner && ++st.acc >= SEC) {
        st.acc = 0;
        game.teamScore[owner]++;
        for (const s of game.near(z.left, z.top, z.right, z.bottom)) if (s.alive && s.team === owner && inZone(s, z)) award(s, 1);
        game.checkWin();
      }
    },

    botGoal(game, s) {
      const hills = objectivesOf(game.map, 'hill');
      const z = hills[game.modeState.hill];
      return z ? { zone: z, hold: true } : null;
    },
  };

  // ---- Capture the flag ------------------------------------------------------------------

  const ctf = {
    ...common,
    name: 'Capture the flag',
    blurb: "Take the other team's flag from their base and bring it to yours. You can only score while your own flag is at home. Kill a carrier to make them drop it; touch your dropped flag to send it home.",
    goal: { label: 'Captures to win', options: [1, 3, 5, 10], value: 3 },

    begin(game) {
      game.modeState = { flags: objectivesOf(game.map, 'flag').map(f => ({ team: f.team, x: f.x, y: f.y, home: true, carrier: -1, timer: 0, vy: 0 })) };
    },

    tick(game) {
      const st = game.modeState;
      for (const f of st.flags) {
        if (f.carrier >= 0) {
          const c = byId(game, f.carrier);
          if (!c || !c.alive) { this.drop(game, f); continue; }
          // Teleported (moved too far in one update): the flag stays behind.
          if (Math.abs(c.x - f.x) > 120 || Math.abs(c.y + STAND - f.y) > 120) { this.drop(game, f); continue; }
          f.x = c.x;
          f.y = c.y + STAND;
          const mine = st.flags[c.team - 1];
          if (mine.home && touchesFlag(c, mine)) this.capture(game, f, c);
          continue;
        }
        if (!f.home) {
          this.fall(game, f);
          if (--f.timer <= 0 || f.y > game.map.bounds.bottom + 100) { this.goHome(game, f, null); continue; }
        }
        for (const s of game.near(f.x - 30, f.y - 60, f.x + 30, f.y + 20)) {
          if (!s.alive || !s.team || !touchesFlag(s, f)) continue;
          if (s.team === f.team) {
            if (!f.home) { this.goHome(game, f, s); break; }
          } else if (!s.kamikaze && !st.flags.some(o => o.carrier === s.id)) {
            this.take(game, f, s);
            break;
          }
        }
      }
    },

    /** A dropped flag falls to the floor. */
    fall(game, f) {
      const floor = floorBelow(game.map, f.x, f.y - 4);
      if (floor != null && f.y >= floor - 0.5) { f.y = floor; f.vy = 0; return; }
      f.vy = Math.min(f.vy + 0.35, 9);
      f.y += f.vy;
      if (floor != null && f.y >= floor) { f.y = floor; f.vy = 0; }
    },

    take(game, f, s) {
      f.carrier = s.id;
      f.home = false;
      award(s, 2);
      game.addFeed({ text: `${s.name} took the ${TEAM_NAME[f.team].toLowerCase()} flag`, tick: game.tick });
      news(game, s.team, 'flagTaken', 'alarm');
      game.notify(s, 'You have the flag! Bring it back to your base');
      tell(game, f.team, 'Your flag has been taken!');
    },

    drop(game, f, fell = false) {
      const c = byId(game, f.carrier);
      f.carrier = -1;
      if (fell) { this.goHome(game, f, null); return; }
      f.home = false;
      f.timer = FLAG_RETURN;
      f.vy = 0;
      game.addFeed({ text: `${c ? c.name : 'The carrier'} dropped the ${TEAM_NAME[f.team].toLowerCase()} flag`, tick: game.tick });
    },

    goHome(game, f, by) {
      const stand = objectivesOf(game.map, 'flag')[f.team - 1];
      Object.assign(f, { home: true, carrier: -1, timer: 0, vy: 0, x: stand.x, y: stand.y });
      if (by) {
        award(by, 3);
        game.addFeed({ text: `${by.name} returned the ${TEAM_NAME[f.team].toLowerCase()} flag`, tick: game.tick });
      } else game.addFeed({ text: `The ${TEAM_NAME[f.team].toLowerCase()} flag went back to base`, tick: game.tick });
      news(game, f.team, 'flagReturned', 'flagReturned');
    },

    capture(game, f, c) {
      game.teamScore[c.team]++;
      award(c, 10);
      game.addFeed({ text: `${c.name} captured the ${TEAM_NAME[f.team].toLowerCase()} flag!`, tick: game.tick });
      const stand = objectivesOf(game.map, 'flag')[f.team - 1];
      Object.assign(f, { home: true, carrier: -1, timer: 0, vy: 0, x: stand.x, y: stand.y });
      news(game, c.team, 'captured', 'objBad');
      game.checkWin();
    },

    onKill(game, victim, killer, weapon, opts) {
      const f = game.modeState.flags?.find(o => o.carrier === victim.id);
      if (!f) return;
      if (killer && killer !== victim) { award(killer, 2); game.notify(killer, 'You stopped the flag carrier'); }
      f.x = victim.x;
      f.y = victim.y + STAND;
      this.drop(game, f, !!opts.fall);
    },

    onRemove(game, s) {
      const f = game.modeState.flags?.find(o => o.carrier === s.id);
      if (f) this.drop(game, f);
    },

    botGoal(game, s, bot) {
      const st = game.modeState;
      const mine = st.flags[s.team - 1], theirs = st.flags[other(s.team) - 1];
      const stand = objectivesOf(game.map, 'flag')[s.team - 1];
      const at = (x, y, w = 10) => ({ left: x - w, top: y - 46, right: x + w, bottom: y + 2 });
      // Carrying their flag: home (and wait there if ours is gone).
      if (theirs.carrier === s.id) return { zone: at(stand.x, stand.y), hold: true, urgent: true };
      // Our flag is lying around: go and send it home.
      if (!mine.home && mine.carrier < 0 && Math.hypot(mine.x - s.x, mine.y - s.y) < 1600) return { zone: at(mine.x, mine.y), urgent: true, moving: true };
      const role = hash(s.id, 1);
      // Our flag's been taken: most go after the carrier.
      if (mine.carrier >= 0 && role < 0.7) {
        const c = byId(game, mine.carrier);
        if (c) return { zone: at(c.x, c.y + STAND, 40), urgent: true, moving: true };
      }
      // A teammate has their flag: escort them home, or defend.
      if (theirs.carrier >= 0 && role < 0.5) {
        const c = byId(game, theirs.carrier);
        if (c && c !== s) return { zone: at(c.x, c.y + STAND, 90), moving: true };
      }
      // Defenders stay around our flag; everyone else goes for theirs (most of them without stopping to fight).
      if (role < 0.3) return { zone: { left: stand.x - 260, top: stand.y - 220, right: stand.x + 260, bottom: stand.y + 4 }, hold: true };
      if (theirs.carrier < 0) return { zone: at(theirs.x, theirs.y), moving: !theirs.home, urgent: role < 0.75 };
      return null;
    },
  };

  // ---- Conquest ----------------------------------------------------------------------------

  const conquest = {
    ...common,
    name: 'Conquest',
    blurb: 'Capture the lettered points by standing in them, and spawn on the ones your team holds. Every death costs a ticket, and the team holding fewer points keeps losing tickets. Out of tickets, out of the fight.',
    goal: { label: 'Tickets', options: [0, 100, 200, 300, 500, 1000], value: 0, auto: [60, 12] },

    begin(game) {
      const pts = objectivesOf(game.map, 'point');
      game.modeState = { points: pts.map(() => ({ own: 0, v: 0, c: [0, 0] })), bleed: 0, start: 0 };
    },

    tick(game) {
      const st = game.modeState, pts = objectivesOf(game.map, 'point');
      if (!st.start) {
        st.start = goalOf(game, this);
        game.teamScore[1] = game.teamScore[2] = st.start;
      }
      const rate = 1 / CAPTURE;
      pts.forEach((z, i) => {
        const p = st.points[i];
        const n = countIn(game, z);
        p.c = [n[1], n[2]];
        const d = n[1] - n[2];
        if (d) {
          // Blue pulls the point toward -1, red toward +1; more soldiers capture faster.
          const k = rate * (1 + 0.5 * (Math.min(5, Math.abs(d)) - 1));
          p.v = d > 0 ? Math.max(-1, p.v - k) : Math.min(1, p.v + k);
        } else if (!n[1] && !n[2]) {
          // Nobody here: it drifts back to whoever holds it.
          const home = p.own === 1 ? -1 : p.own === 2 ? 1 : 0;
          p.v += Math.max(-rate / 2, Math.min(rate / 2, home - p.v));
        }
        const label = z.label;
        if (p.own && (p.own === 1 ? p.v >= 0 : p.v <= 0)) {
          // Neutralised.
          const lost = p.own;
          p.own = 0;
          game.addFeed({ text: `${TEAM_NAME[lost]} lost ${label}`, tick: game.tick });
          news(game, other(lost), 'pointLost', 'pointLost');
          tell(game, lost, `We've lost ${label}!`);
          for (const s of game.near(z.left, z.top, z.right, z.bottom)) if (s.alive && s.team === other(lost) && inZone(s, z)) award(s, 2);
        }
        const taker = p.v <= -1 ? 1 : p.v >= 1 ? 2 : 0;
        if (taker && p.own !== taker) {
          p.own = taker;
          game.addFeed({ text: `${TEAM_NAME[taker]} captured ${label}`, tick: game.tick });
          news(game, taker, 'pointTaken', 'objBad');
          tell(game, taker, `We've captured ${label}`);
          for (const s of game.near(z.left, z.top, z.right, z.bottom)) if (s.alive && s.team === taker && inZone(s, z)) award(s, 5);
        }
      });
      // The team holding fewer points bleeds tickets.
      const held = [0, 0, 0];
      for (const p of st.points) held[p.own]++;
      if (held[1] !== held[2]) {
        if (++st.bleed >= BLEED_EVERY) {
          st.bleed = 0;
          const loser = held[1] < held[2] ? 1 : 2;
          game.teamScore[loser] = Math.max(0, game.teamScore[loser] - Math.abs(held[1] - held[2]) * Math.max(1, Math.round(st.start / 150)));
          game.checkWin();
        }
      } else st.bleed = 0;
    },

    onKill(game, victim) {
      if (!victim.team || !game.modeState.start) return;
      game.teamScore[victim.team] = Math.max(0, game.teamScore[victim.team] - 1);
    },

    winner(game) {
      if (!game.modeState?.start) return null;
      for (const t of [1, 2]) if (game.teamScore[t] <= 0) return { team: other(t) };
      return null;
    },

    /**
     * Where a player can choose to spawn (number keys while waiting): 'auto' (near
     * the fighting), 'base', or a point their team holds.
     */
    deployOptions(game, s) {
      const st = game.modeState, pts = objectivesOf(game.map, 'point');
      const held = pts.filter((z, i) => st?.points?.[i]?.own === s.team).map(z => ({ key: z.label, label: z.label }));
      return [{ key: 'auto', label: 'Auto' }, { key: 'base', label: 'Base' }, ...held];
    },

    /** Where to respawn: the player's choice, or the nearest usable place to where they died. */
    spawnPoint(game, s) {
      const st = game.modeState, pts = objectivesOf(game.map, 'point');
      const safe = pts.filter((z, i) => st.points[i].own === s.team && !enemiesNear(game, z, s.team, 220));
      // A player's choice, while it's still possible.
      if (s.deployAt === 'base') return null;
      const chosen = s.deployAt && safe.find(z => z.label === s.deployAt);
      if (chosen) return spotIn(game, chosen);
      // Auto: the usable spot closest to where they died: a point we hold (with no enemies on
      // it), or one of our base spawn points (without enemies right there).
      if (s.deathX == null) return null;
      const far = (x, y) => Math.hypot(x - s.deathX, y - s.deathY);
      let best = null, bestD = Infinity;
      for (const z of safe) {
        const d = far((z.left + z.right) / 2, z.bottom);
        if (d < bestD) { bestD = d; best = z; }
      }
      let base = null;
      for (const p of this.spawnPoints(game, s)) {
        const d = far(p.x, p.y);
        if (d < bestD && !spawnUnsafe(game, p, s.team)) { bestD = d; base = p; }
      }
      if (base) return base;
      return best ? spotIn(game, best) : null;
    },

    botGoal(game, s, bot) {
      const st = game.modeState, pts = objectivesOf(game.map, 'point');
      if (!pts.length) return null;
      const settled = j => st.points[j].own === s.team && Math.abs(st.points[j].v) > 0.99 && !st.points[j].c[other(s.team) - 1];
      let j = bot.objPick;
      if (j == null || j >= pts.length || game.tick > (bot.objPickUntil || 0) || (settled(j) && !inZone(s, pts[j]))) {
        // Pick the point to go for: close ones, ones we don't hold, ones under attack, and some spread.
        let best = Infinity;
        j = null;
        pts.forEach((z, i) => {
          const p = st.points[i];
          const dist = Math.hypot((z.left + z.right) / 2 - s.x, (z.top + z.bottom) / 2 - s.y) / 150;
          let v = dist + hash(s.id, i + 7) * 12;
          if (settled(i)) v += 40;
          else if (p.own === s.team) v -= 4; // ours, but under attack
          else if (p.own) v += 2;
          if (v < best) { best = v; j = i; }
        });
        bot.objPick = j;
        bot.objPickUntil = game.tick + 25 * SEC;
      }
      if (j == null) return null;
      // Hold it until it's fully ours and nobody's contesting it.
      if (settled(j) && inZone(s, pts[j])) { bot.objPickUntil = 0; return null; }
      return { zone: pts[j], hold: true };
    },
  };

  // ---- Rush ----------------------------------------------------------------------------------

  const rush = {
    ...common,
    name: 'Rush',
    blurb: 'Blue attacks, red defends. Blue arms the M-COM stations by standing at them; red disarms them the same way. Destroy every M-COM in a sector to push on to the next. Blue loses a ticket for every death and gets more with each sector taken.',
    goal: { label: 'Attacker tickets', options: [0, 50, 75, 100, 150, 250], value: 0, auto: [60, 14] },

    begin(game) {
      const mcoms = objectivesOf(game.map, 'mcom');
      const sectors = [...new Set(mcoms.map(m => m.sector))].sort((a, b) => a - b);
      game.modeState = { sector: 0, sectors, mcoms: mcoms.map(() => ({ s: 0, p: 0, fuse: 0, by: -1 })), start: 0, won: 0 };
    },

    current(game) {
      const st = game.modeState;
      return st.sectors[Math.min(st.sector, st.sectors.length - 1)];
    },

    tick(game) {
      const st = game.modeState, mcoms = objectivesOf(game.map, 'mcom');
      if (!st.start) {
        st.start = goalOf(game, this);
        game.teamScore[1] = st.start;
      }
      if (st.won || !mcoms.length) return;
      const sector = this.current(game);
      let left = 0;
      const blasts = [];
      mcoms.forEach((m, i) => {
        const o = st.mcoms[i];
        if (m.sector !== sector || o.s === 2) return;
        left++;
        const n = countIn(game, mcomZone(m));
        if (o.s === 0) {
          // Standing: attackers arm it (with no defenders there).
          if (n[1] && !n[2]) {
            o.p = Math.min(1, o.p + 1 / ARM);
            if (o.p >= 1) {
              const by = game.soldiers.find(s => s.alive && s.team === 1 && inZone(s, mcomZone(m)));
              Object.assign(o, { s: 1, p: 0, fuse: FUSE, by: by ? by.id : -1 });
              award(by, 5);
              game.addFeed({ text: `${by ? by.name : 'Blue'} armed an M-COM!`, tick: game.tick });
              news(game, 1, 'armed', 'alarm');
              tell(game, 2, 'An M-COM has been armed! Disarm it');
            }
          } else if (!n[1]) o.p = Math.max(0, o.p - 1 / ARM);
        } else {
          // Armed: defenders disarm it, or it blows.
          if (n[2] && !n[1]) {
            o.p = Math.min(1, o.p + 1 / DISARM);
            if (o.p >= 1) {
              const by = game.soldiers.find(s => s.alive && s.team === 2 && inZone(s, mcomZone(m)));
              Object.assign(o, { s: 0, p: 0, fuse: 0, by: -1 });
              award(by, 8);
              game.addFeed({ text: `${by ? by.name : 'Red'} disarmed the M-COM`, tick: game.tick });
              news(game, 2, 'disarmed', 'objBad');
              game.checkWin();
              return;
            }
          } else if (!n[2]) o.p = Math.max(0, o.p - 1 / DISARM);
          o.fuse--;
          if (o.fuse % (o.fuse < 5 * SEC ? 20 : 60) === 0) game.sound('beep', m.x, m.y - 10);
          if (o.fuse <= 0) {
            o.s = 2;
            o.p = 0;
            blasts.push({ m, by: byId(game, o.by) });
            left--;
          }
        }
      });
      for (const { by } of blasts) {
        award(by, 10);
        game.addFeed({ text: 'An M-COM was destroyed!', tick: game.tick });
        news(game, 1, 'destroyed', 'objBad');
      }
      if (left === 0) {
        if (st.sector >= st.sectors.length - 1) {
          st.won = 1;
          game.addFeed({ text: 'Every M-COM is destroyed: blue wins!', tick: game.tick });
        } else {
          st.sector++;
          game.teamScore[1] = st.start;
          game.addFeed({ text: `Sector ${st.sector + 1}: the attack moves on`, tick: game.tick });
          game.sound('sector', null, null);
          tell(game, 1, `Sector taken! On to sector ${st.sector + 1}`);
          tell(game, 2, `Sector lost! Fall back to sector ${st.sector + 1}`);
        }
      }
      game.teamScore[2] = mcoms.filter((m, i) => st.mcoms[i].s !== 2).length;
      // The blasts go off once the sector's moved on (so they can't end the round on tickets the new sector refills).
      for (const { m, by } of blasts) {
        explode(game, m.x, m.y - 14, MCOM_BLAST, by, 'M-COM');
        game.fx?.explosion(m.x, m.y - 30, 70);
      }
      if (st.won) game.checkWin();
    },

    onKill(game, victim) {
      if (victim.team !== 1 || !game.modeState.start) return;
      game.teamScore[1] = Math.max(0, game.teamScore[1] - 1);
    },

    /** Attackers out of tickets don't come back. */
    canRespawn(game, s) {
      return !(s.team === 1 && game.modeState?.start && game.teamScore[1] <= 0);
    },

    winner(game) {
      const st = game.modeState;
      if (!st?.start) return null;
      if (st.won) return { team: 1 };
      if (game.teamScore[1] > 0) return null;
      // Out of tickets: red wins, unless an M-COM is still ticking.
      if (st.mcoms.some(o => o.s === 1)) return null;
      return { team: 2 };
    },

    /**
     * Respawn as far forward as possible: at the team's spawn point (for the sector being
     * fought over) closest to the M-COMs still standing, unless enemies are right there.
     */
    spawnPoint(game, s) {
      const st = game.modeState, mcoms = objectivesOf(game.map, 'mcom');
      const sector = this.current(game);
      const front = mcoms.filter((m, i) => m.sector === sector && st.mcoms[i]?.s !== 2);
      const list = this.spawnPoints(game, s);
      if (!front.length || !list.length) return null;
      const dist = p => Math.min(...front.map(m => Math.hypot(m.x - p.x, m.y - p.y)));
      const safe = list.filter(p => !spawnUnsafe(game, p, s.team));
      const pool = safe.length ? safe : list;
      // The most forward ones (a few, so everyone doesn't land on the same spot).
      const best = Math.min(...pool.map(dist));
      const near = pool.filter(p => dist(p) <= best + 120);
      return near[Math.floor(game.rng() * near.length)];
    },

    /** Spawn points for the sector being fought over (falling back to the team's other spawns). */
    spawnPoints(game, s) {
      const sector = this.current(game);
      const sets = (game.spawnSets ||= new Map());
      const key = `${s.team}:${sector}`;
      if (!sets.has(key)) {
        const here = game.spawns.filter(p => p.team === s.team && p.sector === sector);
        sets.set(key, here.length ? here : common.spawnPoints(game, s));
      }
      return sets.get(key);
    },

    botGoal(game, s) {
      const st = game.modeState, mcoms = objectivesOf(game.map, 'mcom');
      const sector = this.current(game);
      const live = mcoms.map((m, i) => ({ m, o: st.mcoms[i] })).filter(x => x.m.sector === sector && x.o.s !== 2);
      if (!live.length || st.won) return null;
      const armed = live.filter(x => x.o.s === 1);
      const role = hash(s.id, 3);
      const near = x => Math.hypot(x.m.x - s.x, x.m.y - s.y);
      const wide = (m, w, h) => ({ left: m.x - w, top: m.y - h, right: m.x + w, bottom: m.y + 4 });
      if (s.team === 2) {
        // Defenders: disarm what's ticking; otherwise guard the stations (some push forward).
        if (armed.length) {
          const x = armed.reduce((a, b) => (near(b) < near(a) ? b : a));
          return { zone: mcomZone(x.m), hold: true, urgent: true };
        }
        if (role < 0.25) return null;
        const x = live[Math.floor(hash(s.id, 5) * live.length)];
        // (Guarding from a few steps away: standing on the station would stop it being armed, which isn't fair.)
        return { zone: wide(x.m, 240, 160), avoid: wide(x.m, 50, 80), hold: true };
      }
      // Attackers: guard a ticking station, or arm one.
      if (armed.length && role < 0.6) {
        const x = armed.reduce((a, b) => (near(b) < near(a) ? b : a));
        return { zone: wide(x.m, 170, 120), hold: true };
      }
      const ready = live.filter(x => x.o.s === 0);
      if (!ready.length) return null;
      const x = ready[Math.floor(hash(s.id, 4) * ready.length)];
      return { zone: mcomZone(x.m), hold: true };
    },
  };

  return { koth, ctf, conquest, rush };
}
