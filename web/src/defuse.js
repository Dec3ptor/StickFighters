// Defuse: a Counter-Strike-style mode. Two teams take turns at attacking ("T": plant
// the bomb at bomb site A or B) and defending ("CT": stop them, or defuse it), in
// rounds with no respawning. Each round starts with a few seconds' freeze while
// everyone buys weapons and gear with money earned in earlier rounds (kills, round
// wins, a growing bonus for rounds lost in a row, and the plant). Teams swap sides at
// half time; the first team to win the set number of rounds wins, with overtime if
// it's level at the end.
//
// Everything that's going on lives in game.modeState: plain data the host sends to
// online players with every snapshot (money, gear, the bomb, the clock). The rules
// here run on the host (or offline); online players only draw what it says.
//
// Map side: blue's spawn points (team 1) are the attackers' and red's (team 2) the
// defenders', whichever team is playing them; bomb sites are the map's 'site'
// objectives (or worked out from its Rush M-COMs: objectives.js).

import { WEAPONS } from './weapons.js';
import { objectivesOf, inZone, floorBelow, STAND } from './objectives.js';
import { damage } from './combat.js';
import { weaponFor } from './classes.js';
import { BODY } from './config.js';
import { hypot } from './map.js';

const SEC = 60; // the game always updates 60 times a second

/** The mode's numbers (money in dollars, times in updates). */
export const DEFUSE = {
  startMoney: 800, maxMoney: 16000, overtimeMoney: 10000,
  freeze: 7 * SEC,           // held still at the start of a round: time to buy
  buyTime: 20 * SEC,         // buying allowed this long from the start of a round (freeze included)
  roundTime: 105 * SEC,      // then this long to plant the bomb
  bombTime: 40 * SEC,        // planted: it goes off after this
  plantTime: 3.2 * SEC,      // holding E (or fire, bomb in hand) at a site this long plants it
  defuseTime: 10 * SEC,      // holding E at the bomb this long defuses it...
  kitTime: 5 * SEC,          // ...or this long with a defuse kit
  roundEnd: 6 * SEC,         // the result shows this long before the next round
  halfEnd: 8 * SEC,          // (longer at half time)
  // Round rewards (each player on the team).
  winElimination: 3250, winTime: 3250, winBomb: 3500, winDefuse: 3500,
  lossBonus: 1400, lossStep: 500, lossMax: 4,   // 1400, 1900, 2400, 2900, 3400 for rounds lost in a row
  plantBonus: 800,           // each attacker, when they planted but lost
  planterBonus: 300, defuserBonus: 300,
  killReward: 300,           // weapons without their own (weapons.js `cs.reward`)
  // The bomb: everyone near it dies (walls don't help); further off, it hurts.
  blast: { radius: 520, damage: 520, knock: 22, hole: 120 },
  bombReach: 24,             // how close to the bomb a defender must be to defuse it
  maxGrenades: 4,
};

/** Gear in the shop that isn't a weapon. */
export const GEAR = {
  kevlar: { name: 'Kevlar Vest', short: 'Kevlar', price: 650 },
  helmet: { name: 'Kevlar + Helmet', short: 'Kevlar + Helmet', price: 1000 },
  kit: { name: 'Defuse Kit', short: 'Defuse Kit', price: 400, side: 'CT' },
};

/** The shop, in columns (as Counter-Strike's buy menu has them). */
export const SHOP = [
  { name: 'Pistols', items: ['Platinum', 'Beretta', 'Magnum'] },
  { name: 'SMGs', items: ['Uzi', 'MP5K'] },
  { name: 'Heavy', items: ['Shotgun', 'Minigun'] },
  { name: 'Rifles', items: ['AK47', 'M4', 'SR'] },
  { name: 'Gear', items: ['kevlar', 'helmet', 'kit'] },
  { name: 'Grenades', items: ['HEGrenade', 'Flashbang', 'SmokeGrenade', 'PetrolBomb'] },
];

export const SIDE_NAME = { T: 'Terrorists', CT: 'Counter-Terrorists' };
const other = t => (t === 1 ? 2 : 1);
const byId = (game, id) => (id == null || id < 0 ? null : game.soldiers.find(s => s.id === id) || null);
const clampMoney = m => Math.max(0, Math.min(DEFUSE.maxMoney, Math.round(m)));

// ---- Who's who -------------------------------------------------------------------------

/** 'T' or 'CT': the side team `team` is playing now. */
export function sideOf(game, team) {
  const st = game.modeState;
  return st && team === st.t ? 'T' : 'CT';
}

/** The team (1 or 2) playing a side. */
export const teamOf = (game, side) => (side === 'T' ? game.modeState.t : other(game.modeState.t));

/** A soldier's money (anyone's, online too). */
export const moneyOf = (game, s) => game.modeState?.money?.[s.id] ?? 0;

/** A soldier's gear: { helmet, kit } (anyone's, online too). */
export function gearOf(game, s) {
  const g = game.modeState?.gear?.[s.id] || 0;
  return { helmet: !!(g & 1), kit: !!(g & 2) };
}

/** What sort of thing an item is: 'pistol', 'primary', 'grenade', 'melee', 'bomb' or 'gear'. */
export function kindOf(id) {
  if (GEAR[id]) return 'gear';
  const def = WEAPONS[id];
  if (!def) return null;
  if (id === 'C4') return 'bomb';
  if (def.kind === 'melee') return 'melee';
  if (def.cs?.max) return 'grenade';
  return def.slot === 0 ? 'pistol' : 'primary';
}

/** The price of an item in the shop (0: not for sale). */
export const priceOf = id => GEAR[id]?.price ?? WEAPONS[id]?.cs?.price ?? 0;

/** The side that can buy an item ('T', 'CT', or null for both). */
export const sideOnly = id => GEAR[id]?.side ?? WEAPONS[id]?.cs?.side ?? null;

// ---- Places ------------------------------------------------------------------------------

/** The spawn points for a side: the attackers use blue's, the defenders red's (without a Rush sector, if there are some). */
export function sideSpawns(game, side) {
  const team = side === 'T' ? 1 : 2;
  const sets = (game.spawnSets ||= new Map());
  const key = `defuse:${side}`;
  if (!sets.has(key)) {
    const mine = game.spawns.filter(p => p.team === team);
    const base = mine.filter(p => !p.sector);
    sets.set(key, base.length ? base : mine.length ? mine : game.spawns);
  }
  return sets.get(key);
}

/** The area a side can buy in: around its spawn points. */
export function buyZone(game, side) {
  const zones = (game.map.buyZones ||= {});
  if (!zones[side]) {
    const team = side === 'T' ? 1 : 2;
    let list = game.map.spawns.filter(p => p.team === team && !p.sector);
    if (!list.length) list = game.map.spawns.filter(p => p.team === team);
    if (!list.length) list = game.map.spawns;
    const xs = list.map(p => p.x), ys = list.map(p => p.y);
    zones[side] = list.length
      ? { left: Math.min(...xs) - 170, right: Math.max(...xs) + 170, top: Math.min(...ys) - 160, bottom: Math.max(...ys) + 90 }
      : { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity };
  }
  return zones[side];
}

export const inBuyZone = (game, s) => inZone(s, buyZone(game, sideOf(game, s.team)));

/** The bomb site a soldier is standing in, or null. */
export function siteAt(game, s) {
  return objectivesOf(game.map, 'site').find(z => inZone(s, z)) || null;
}

/** True if soldier s is right by the planted bomb (close enough to defuse it). */
export function atBomb(game, s) {
  const b = game.modeState?.bomb;
  return !!b && b.s === 'planted' && Math.abs(s.x - b.x) <= DEFUSE.bombReach && Math.abs(s.y + BODY.bottom - b.y) <= 30;
}

/** What holding E would do for soldier s right now: 'plant', 'defuse' or null. */
export function useHere(game, s) {
  const st = game.modeState, b = st?.bomb;
  if (!st || !b || !s.alive || st.phase !== 'live') return null;
  if (b.s === 'carried' && b.by === s.id && siteAt(game, s)) return 'plant';
  if (b.s === 'planted' && sideOf(game, s.team) === 'CT' && atBomb(game, s)) return 'defuse';
  return null;
}

// ---- Buying ---------------------------------------------------------------------------------

/** True while soldier s can buy (alive, in their buy zone, in buy time). */
export function canShop(game, s) {
  const st = game.modeState;
  if (!st || !s.alive || st.buy <= 0 || game.over) return false;
  if (st.phase !== 'freeze' && st.phase !== 'live') return false;
  return inBuyZone(game, s);
}

/** How many grenades soldier s carries (all kinds), and of kind `id`. */
function grenades(s, id) {
  let all = 0;
  for (const g in s.weapons) if (kindOf(g) === 'grenade') all += s.weapons[g].ammo || 0;
  return { all, mine: s.weapons[id]?.ammo || 0 };
}

/**
 * Why soldier s can't buy item `id` right now, or null if they can. (The shop
 * shows these; online, the host checks with this too.)
 */
export function whyNot(game, s, id) {
  const price = priceOf(id);
  if (!price) return 'Not for sale';
  if (!canShop(game, s)) return game.modeState?.buy > 0 ? 'Go back to your buy zone' : 'Buy time is over';
  const side = sideOnly(id);
  if (side && side !== sideOf(game, s.team)) return `${SIDE_NAME[side]} only`;
  const gear = gearOf(game, s);
  if (id === 'kevlar' && s.armour >= 100) return 'You have a vest';
  if (id === 'helmet' && s.armour >= 100 && gear.helmet) return 'You have them';
  if (id === 'kit' && gear.kit) return 'You have one';
  const kind = kindOf(id);
  if (kind === 'grenade') {
    const n = grenades(s, id);
    if (n.mine >= WEAPONS[id].cs.max) return 'You can\'t carry more';
    if (n.all >= DEFUSE.maxGrenades) return `${DEFUSE.maxGrenades} grenades at most`;
  } else if (kind !== 'gear' && s.weapons[id] && s.has(id)) return 'You have one';
  if (costOf(game, s, id) > moneyOf(game, s)) return 'Not enough money';
  return null;
}

/** What item `id` costs soldier s (a helmet on top of a full vest is less). */
export function costOf(game, s, id) {
  if (id === 'helmet' && s.armour >= 100) return GEAR.helmet.price - GEAR.kevlar.price;
  return priceOf(id);
}

/** Buy item `id` for soldier s, if they can. Returns null if bought, or why not. */
export function buy(game, s, id) {
  const no = whyNot(game, s, id);
  if (no) return no;
  pay(game, s, -costOf(game, s, id));
  const kind = kindOf(id);
  if (kind === 'gear') {
    if (id === 'kevlar' || id === 'helmet') s.armour = 100;
    if (id === 'helmet') s.helmet = true;
    if (id === 'kit') s.kit = true;
    syncGear(game, s);
  } else if (kind === 'grenade') {
    const inv = s.weapons[id];
    if (inv) inv.ammo = (inv.ammo || 0) + 1;
    else s.weapons[id] = { ammo: 1 };
  } else {
    // One gun of each sort: buying another drops the one you had (for a teammate to pick up).
    for (const other of Object.keys(s.weapons)) {
      if (other !== id && kindOf(other) === kind) dropWeapon(game, s, other);
    }
    const def = weaponFor(s, id);
    s.weapons[id] = def.mag ? { ammo: def.ammo, mag: def.mag } : { ammo: def.ammo };
    if (!s.select(id)) s.current = id;
  }
  game.sound('buy', s.x, s.y, s.id);
  return null;
}

/** Add (or take away) money. */
function pay(game, s, amount) {
  const st = game.modeState;
  const before = st.money[s.id] ?? 0;
  st.money[s.id] = clampMoney(before + amount);
  const got = st.money[s.id] - before;
  if (got > 0) st.paid[s.id] = [got, game.tick];
}

function syncGear(game, s) {
  game.modeState.gear[s.id] = (s.helmet ? 1 : 0) | (s.kit ? 2 : 0);
}

// ---- Dropping and picking up ------------------------------------------------------------------

/** Drop weapon `id` at soldier s's feet (with what's left in it). */
function dropWeapon(game, s, id, throwIt = false) {
  const inv = s.weapons[id];
  delete s.weapons[id];
  if (s.reloading === id) { s.reloading = null; s.reloadTimer = 0; }
  if (!inv || !(inv.ammo > 0 || inv.mag > 0)) return;
  const vx = throwIt ? s.facing * 3.2 + s.body.vx * 0.5 : s.body.vx * 0.5;
  // (Whoever drops it can't pick it straight back up.)
  game.pickups.drop(id, inv.ammo, s.x + (throwIt ? s.facing * 8 : 0), s.y - 8, vx, { mag: inv.mag, life: 30 * 60 * 60, shop: true, droppedBy: s.id, droppedAt: game.tick });
  // (Not too many lying about: the oldest go first.)
  const dropped = game.pickups.items.filter(it => it.dropped && it.type === 'weapon');
  if (dropped.length > 40) game.pickups.items.splice(game.pickups.items.indexOf(dropped[0]), 1);
}

/** The bomb falls from the carrier (where they are now). */
function dropBomb(game, s, throwIt = false) {
  const b = game.modeState.bomb;
  if (b.s !== 'carried' || b.by !== s.id) return;
  delete s.weapons.C4;
  Object.assign(b, { s: 'dropped', by: -1, x: s.x + (throwIt ? s.facing * 30 : 0), y: s.y + STAND - 6, vy: throwIt ? -2 : 0, plant: 0 });
  game.addFeed({ text: `${s.name} dropped the bomb`, tick: game.tick });
  tellSide(game, 'T', 'The bomb has been dropped!');
}

/** G: drop the weapon in hand (not the knife), or the bomb. */
function dropHeld(game, s) {
  if (!s.alive) return;
  const id = s.current;
  if (id === 'C4') dropBomb(game, s, true);
  else if (kindOf(id) === 'primary' || kindOf(id) === 'pistol') dropWeapon(game, s, id, true);
  else return;
  s.selectBest(true);
}

/** Soldiers only pick up a gun if they have nothing of that sort (one gun of each sort), or a grenade if they've room. */
function canPickUp(game, s, it) {
  if (it.type !== 'weapon') return false;
  if (it.droppedBy === s.id && game.tick - it.droppedAt < 90) return false;
  const kind = kindOf(it.weapon);
  if (kind === 'grenade') {
    const n = grenades(s, it.weapon);
    return n.mine < WEAPONS[it.weapon].cs.max && n.all < DEFUSE.maxGrenades;
  }
  if (kind !== 'primary' && kind !== 'pistol') return false;
  return !Object.keys(s.weapons).some(id => kindOf(id) === kind && s.has(id));
}

// ---- Messages ----------------------------------------------------------------------------------

function tellSide(game, side, text) {
  const team = teamOf(game, side);
  for (const s of game.soldiers) if (!s.isBot && s.team === team) game.notify(s, text);
}

/** A sound for the winners and another for the losers. */
function cheer(game, winner) {
  game.sound('roundWin', null, null, -winner);
  game.sound('roundLose', null, null, -other(winner));
}

// ---- The mode ----------------------------------------------------------------------------------

export function defuseMode(base) {
  return {
    ...base,
    name: 'Defuse',
    blurb: 'Counter-Strike style. Attackers (T) plant the bomb at site A or B; defenders (CT) stop them or defuse it. No respawns in a round. Buy weapons and gear at the start of each round ({key:buy}) with money from kills, wins and losses in a row. Teams swap sides at half time; first to the rounds wins.',
    teams: true,
    objective: true,
    killScore: false,
    pickups: false,       // no weapons lying on the map: you buy them
    crates: false,
    dropWeapons: true,
    classes: false,
    streaks: false,      // (rounds and money instead: no kill streak rewards)
    mapLoadout: false,
    limit: 'goal',
    helmets: true,        // armour covers the head only with a helmet
    armourAbsorb: 0.35,   // and soaks up less than elsewhere (as kevlar does)
    maxHealth: 100,       // (less than elsewhere: the weapons and money are made for it)
    teamWatch: true,      // the dead watch their teammates
    goal: { label: 'Rounds to win', options: [3, 5, 7, 9, 13], value: 7 },
    scoreLabel: 'Score',
    outText: (game) => (game.modeState?.phase === 'over' ? 'Next round soon' : "You're dead: back next round"),
    score: s => s.frags * 2 + (s.points || 0),
    compare: (a, b) => (b.frags * 2 + (b.points || 0)) - (a.frags * 2 + (a.points || 0)) || b.frags - a.frags || a.deaths - b.deaths,

    setup(game, s) {
      s.points = 0;
      s.shop = true;      // weapons as the shop has them: magazines and spare ammo (classes.js weaponFor)
      s.helmet = false;
      s.kit = false;
      const st = game.modeState;
      if (st && st.money[s.id] == null) st.money[s.id] = st.ot ? DEFUSE.overtimeMoney : DEFUSE.startMoney;
      if (st) syncGear(game, s);
    },

    begin(game) {
      game.modeState = {
        phase: 'start', timer: 30, round: 0, t: 1, buy: 0,
        money: {}, gear: {}, paid: {}, loss: { 1: 1, 2: 1 },
        bomb: { s: 'none', by: -1, x: 0, y: 0, vy: 0, plant: 0, site: null, fuse: 0, defuse: 0, defuser: -1, planter: -1 },
        result: null, history: [], ot: 0, target: 'A', alive0: { 1: 0, 2: 0 },
      };
    },

    /** Rounds a team needs to win now (more in overtime: four of the next six). */
    needed(game) {
      return goalOf(game) + 3 * (game.modeState.ot || 0);
    },

    // Nobody respawns during a round: the round's start puts everyone in place.
    canRespawn() { return false; },

    spawnLoadout(game, s) { defaultLoadout(s); },

    damage(game, amount, attacker, target, weapon) {
      return amount * (WEAPONS[weapon]?.cs?.dmg ?? 1);
    },

    /**
     * What soldiers can do: nothing but look about and switch weapons during the freeze
     * at the start of a round; and planting or defusing holds you still.
     */
    input(game, s, inp) {
      const st = game.modeState;
      if (!st) return inp;
      const frozen = st.phase === 'freeze' || st.phase === 'start';
      const wants = inp.use || (inp.fire && s.current === 'C4');
      const busy = wants && !frozen && !!useHere(game, s);
      if (!frozen && !busy) return inp;
      return {
        move: 0, aim: inp.aim, aimDist: inp.aimDist, switchTo: inp.switchTo, cycle: inp.cycle, reload: inp.reload,
        crouch: busy ? false : inp.crouch, use: busy ? true : inp.use, fire: busy && s.current === 'C4',
      };
    },

    /** Planting or defusing: what E does here (the controls don't cycle weapons with E then). */
    useHere,

    /** True while the round hasn't started (bots don't think they're stuck). */
    frozen(game) {
      const p = game.modeState?.phase;
      return p === 'freeze' || p === 'start';
    },

    drop: dropHeld,
    canPickUp,
    /** Buying (from the buy menu, or online players' requests): null if bought, or why not. */
    buyItem: buy,

    dropOnDeath(game, s, opts) {
      if (game.modeState?.bomb?.by === s.id && game.modeState.bomb.s === 'carried') dropBomb(game, s);
      if (opts.fall) return;
      // Your best gun falls where you die (the rest go with you).
      const ids = Object.keys(s.weapons).filter(id => s.has(id));
      const best = ids.find(id => kindOf(id) === 'primary') || ids.find(id => kindOf(id) === 'pistol' && id !== 'Platinum');
      if (best) dropWeapon(game, s, best);
    },

    onKill(game, victim, killer, weapon, opts) {
      const st = game.modeState;
      victim.helmet = false;
      victim.kit = false;
      syncGear(game, victim);
      if (st.phase !== 'live' && st.phase !== 'over') return;
      if (killer && killer !== victim && killer.team !== victim.team) {
        pay(game, killer, WEAPONS[weapon]?.cs?.reward ?? DEFUSE.killReward);
      }
    },

    onRemove(game, s) {
      const b = game.modeState?.bomb;
      if (b && b.s === 'carried' && b.by === s.id) dropBomb(game, s);
    },

    tick(game) {
      const st = game.modeState;
      if (!st || st.winner) return;
      for (const id in st.paid) if (game.tick - st.paid[id][1] > 150) delete st.paid[id];
      if (st.buy > 0) st.buy--;
      switch (st.phase) {
        case 'start':
          if (--st.timer <= 0) this.startRound(game);
          return;
        case 'freeze':
          // Players who join while everyone's still frozen get a place this round.
          for (const s of game.soldiers) if (!s.alive && !s.spectating && s.team && st.joined?.[s.id] !== st.round) this.place(game, s, false);
          if (--st.timer <= 0) {
            st.phase = 'live';
            st.timer = DEFUSE.roundTime;
            game.sound('roundStart', null, null);
          }
          return;
        case 'live':
          this.liveTick(game);
          return;
        case 'over':
          if (--st.timer <= 0) this.nextRound(game);
          return;
      }
    },

    /** A round being fought: the clock, the bomb, and whether it's over. */
    liveTick(game) {
      const st = game.modeState, b = st.bomb;
      if (b.s !== 'planted') st.timer--;
      this.bombTick(game);
      if (st.phase !== 'live') return;
      const alive = { 1: 0, 2: 0 };
      for (const s of game.soldiers) if (s.alive && s.team) alive[s.team]++;
      const T = st.t, CT = other(st.t);
      // (A side nobody was playing at the start can't be wiped out.)
      if (st.alive0[CT] && !alive[CT]) return this.endRound(game, T, 'elimination');
      if (st.alive0[T] && !alive[T] && b.s !== 'planted') return this.endRound(game, CT, 'elimination');
      if (st.timer <= 0 && b.s !== 'planted') return this.endRound(game, CT, 'time');
    },

    /** The bomb: carried, dropped (and picked up again), planted, defused or gone off. */
    bombTick(game) {
      const st = game.modeState, b = st.bomb;
      if (b.s === 'carried') {
        const c = byId(game, b.by);
        if (!c || !c.alive || !c.weapons.C4) { if (c) dropBomb(game, c); else Object.assign(b, { s: 'dropped', by: -1 }); return; }
        b.x = c.x; b.y = c.y + STAND;
        const site = siteAt(game, c);
        if (site && c.using && c.body.onGround) {
          if (b.plant === 0) game.sound('planting', c.x, c.y);
          b.plant = Math.min(1, b.plant + 1 / DEFUSE.plantTime);
          c.current = 'C4';
          if (b.plant >= 1) this.planted(game, c, site);
        } else b.plant = 0;
        return;
      }
      if (b.s === 'dropped') {
        fall(game, b);
        if (b.y > game.map.bounds.bottom + 100) { b.s = 'none'; return; }
        for (const s of game.near(b.x - 16, b.y - 50, b.x + 16, b.y + 10)) {
          if (!s.alive || sideOf(game, s.team) !== 'T' || Math.abs(s.x - b.x) > 14 || Math.abs(s.y + STAND - b.y) > 30) continue;
          this.carry(game, s);
          break;
        }
        return;
      }
      if (b.s === 'planted') {
        b.fuse--;
        const left = b.fuse / SEC;
        const every = left > 20 ? 60 : left > 10 ? 40 : left > 5 ? 22 : left > 2 ? 12 : 6;
        if (Math.floor(b.fuse) % every === 0) game.sound('bombBeep', b.x, b.y - 6);
        // Defusing: a defender right by it, holding E (letting go starts it again).
        let d = byId(game, b.defuser);
        if (!d || !d.alive || !d.using || !atBomb(game, d)) {
          d = game.soldiers.find(s => s.alive && sideOf(game, s.team) === 'CT' && s.using && atBomb(game, s)) || null;
          if ((d?.id ?? -1) !== b.defuser) {
            b.defuse = 0;
            if (d) game.sound('defusing', b.x, b.y - 6);
          }
          b.defuser = d ? d.id : -1;
        }
        if (d) {
          b.defuse = Math.min(1, b.defuse + 1 / (gearOf(game, d).kit ? DEFUSE.kitTime : DEFUSE.defuseTime));
          if (b.defuse >= 1) { this.defused(game, d); return; }
        }
        if (b.fuse <= 0) this.blowUp(game);
      }
    },

    /** Soldier s picks up the bomb. */
    carry(game, s) {
      const b = game.modeState.bomb;
      Object.assign(b, { s: 'carried', by: s.id, plant: 0 });
      s.weapons.C4 = { ammo: 1 };
      game.notify(s, 'You have the bomb! Plant it at A or B: hold {key:use} there');
      game.sound('pickup', s.x, s.y, s.id);
    },

    planted(game, s, site) {
      const st = game.modeState, b = st.bomb;
      const floor = floorBelow(game.map, s.x, s.y) ?? s.y + STAND;
      Object.assign(b, { s: 'planted', by: -1, planter: s.id, x: s.x, y: floor, site: site.label, fuse: DEFUSE.bombTime, plant: 0, defuse: 0, defuser: -1 });
      delete s.weapons.C4;
      s.selectBest(true);
      s.points = (s.points || 0) + 3;
      pay(game, s, DEFUSE.planterBonus);
      game.addFeed({ text: `The bomb has been planted at ${site.label}!`, tick: game.tick });
      game.sound('planted', null, null);
      tellSide(game, 'CT', `The bomb has been planted at ${site.label}! Defuse it: hold {key:use} by it`);
    },

    defused(game, s) {
      const st = game.modeState, b = st.bomb;
      b.s = 'defused';
      s.points = (s.points || 0) + 3;
      pay(game, s, DEFUSE.defuserBonus);
      game.addFeed({ text: `${s.name} defused the bomb`, tick: game.tick });
      game.sound('defused', null, null);
      this.endRound(game, s.team, 'defused');
    },

    /** The bomb goes off: everyone near dies, walls or not; the attackers win the round. */
    blowUp(game) {
      const st = game.modeState, b = st.bomb, k = DEFUSE.blast;
      b.s = 'exploded';
      const x = b.x, y = b.y - 12;
      game.fx?.explosion(x, y, 120);
      game.fx?.explosion(x - 60, y - 20, 70);
      game.fx?.explosion(x + 60, y - 10, 70);
      game.sound('bombBlast', x, y);
      game.shake(x, y, 24);
      game.noise(x, y, 2000, null);
      for (const s of game.near(x - k.radius, y - k.radius, x + k.radius, y + k.radius)) {
        if (!s.alive) continue;
        const d = hypot(s.x - x, s.y - 8 - y);
        if (d > k.radius) continue;
        const f = 1 - d / k.radius;
        s.body.vx += Math.sign(s.x - x || 1) * k.knock * f;
        s.body.vy -= k.knock * f * 0.6;
        s.body.onGround = false;
        damage(game, s, k.damage * f * f + (f > 0.5 ? 200 : 0), null, 'C4', { explosive: true, world: true });
      }
      game.carve?.(x, y, k.hole);
      this.endRound(game, st.t, 'bomb');
    },

    /**
     * The round is over: `team` won it (why: 'elimination', 'time', 'bomb' or 'defused').
     * Money for everyone, and the result on screen for a few seconds.
     */
    endRound(game, team, why) {
      const st = game.modeState, b = st.bomb;
      if (st.phase !== 'live') return;
      const T = st.t, loser = other(team);
      st.phase = 'over';
      game.teamScore[team]++;
      // (The kill that won the round, if one did: the match's winning kill, if this was the last round.)
      st.winKill = why === 'elimination' && game.lastKill ? { ...game.lastKill } : null;
      const side = sideOf(game, team);
      const text = why === 'bomb' ? 'The bomb went off: Terrorists win'
        : why === 'defused' ? 'The bomb has been defused: Counter-Terrorists win'
        : why === 'time' ? 'Target saved: Counter-Terrorists win'
        : `${SIDE_NAME[side]} win`;
      st.result = { team, side, why, text, round: st.round };
      st.history.push(`${team}${side === 'T' ? 't' : 'c'}${why[0]}`);
      if (st.history.length > 60) st.history.shift();
      game.addFeed({ text, tick: game.tick });
      cheer(game, team);
      // Money: the winners by how they won; the losers their bonus for rounds lost in a row
      // (attackers still alive when time runs out get none), plus the plant bonus.
      const win = why === 'bomb' ? DEFUSE.winBomb : why === 'defused' ? DEFUSE.winDefuse : why === 'time' ? DEFUSE.winTime : DEFUSE.winElimination;
      const bonus = DEFUSE.lossBonus + DEFUSE.lossStep * Math.min(st.loss[loser], DEFUSE.lossMax);
      const plantedLost = loser === T && (b.s === 'planted' || b.s === 'defused');
      for (const s of game.soldiers) {
        if (!s.team) continue;
        if (s.team === team) pay(game, s, win);
        else if (!(why === 'time' && s.team === T && s.alive)) pay(game, s, bonus + (plantedLost ? DEFUSE.plantBonus : 0));
      }
      st.loss[loser] = Math.min(DEFUSE.lossMax, st.loss[loser] + 1);
      st.loss[team] = Math.max(0, st.loss[team] - 1);
      // Won the match? (Overtime: four of six; level after six, another six.)
      const need = this.needed(game);
      if (game.teamScore[team] >= need) st.matchWinner = team;
      st.timer = this.switchAfter(game) ? DEFUSE.halfEnd : DEFUSE.roundEnd;
      if (st.matchWinner) st.timer = Math.round(DEFUSE.roundEnd * 0.5);
    },

    /** True if the teams swap sides after the round just played (half time, and overtime's halves). */
    switchAfter(game) {
      const st = game.modeState, half = goalOf(game) - 1, r = st.round;
      if (r === half) return true;
      return r >= 2 * half && (r - 2 * half) % 3 === 0;
    },

    /** After the result: the match is won, or teams swap sides (half time), then the next round. */
    nextRound(game) {
      const st = game.modeState;
      if (st.matchWinner) { st.winner = st.matchWinner; game.checkWin(); return; }
      if (this.switchAfter(game)) {
        const half = goalOf(game) - 1;
        // Level at the end of regulation (or an overtime): overtime.
        const intoOt = st.round >= 2 * half && (st.round - 2 * half) % 6 === 0;
        if (intoOt) st.ot++;
        st.t = other(st.t);
        const money = st.ot ? DEFUSE.overtimeMoney : DEFUSE.startMoney;
        for (const s of game.soldiers) {
          st.money[s.id] = money;
          s.helmet = false; s.kit = false; s.armour = 0;
          syncGear(game, s);
          s.fresh = true;  // (a new half: everyone starts with just the basics)
        }
        st.loss = { 1: 1, 2: 1 };
        game.pickups.items = game.pickups.items.filter(it => !it.dropped);
        game.addFeed({ text: intoOt ? `Overtime${st.ot > 1 ? ` ${st.ot}` : ''}: teams switch sides` : 'Half time: teams switch sides', tick: game.tick });
        for (const s of game.soldiers) if (!s.isBot) game.notify(s, `You're now ${sideOf(game, s.team) === 'T' ? 'a Terrorist: plant the bomb' : 'a Counter-Terrorist: stop the bomb'}`);
      }
      this.startRound(game);
    },

    /** A new round: everyone back to their spawn, the bomb to an attacker, then the freeze. */
    startRound(game) {
      const st = game.modeState;
      st.round++;
      st.phase = 'freeze';
      st.timer = DEFUSE.freeze;
      st.buy = DEFUSE.buyTime;
      st.result = null;
      st.joined = {};
      st.bomb = { s: 'none', by: -1, x: 0, y: 0, vy: 0, plant: 0, site: null, fuse: 0, defuse: 0, defuser: -1, planter: -1 };
      // Where the attackers will go this round (bots; players choose for themselves).
      const sites = objectivesOf(game.map, 'site');
      st.target = sites.length ? sites[Math.floor(game.rng() * sites.length)].label : null;
      for (const side of ['T', 'CT']) {
        const team = teamOf(game, side);
        const list = game.soldiers.filter(s => s.team === team && !s.spectating);
        const points = shuffle(game, [...sideSpawns(game, side)]);
        list.forEach((s, i) => this.place(game, s, s.alive && !s.fresh, points[i % points.length]));
      }
      st.alive0 = { 1: 0, 2: 0 };
      for (const s of game.soldiers) if (s.alive && s.team) st.alive0[s.team]++;
      // The bomb, to a random attacker (a player if there's just one... no: anyone).
      const Ts = game.soldiers.filter(s => s.alive && sideOf(game, s.team) === 'T');
      if (Ts.length) this.carry(game, Ts[Math.floor(game.rng() * Ts.length)]);
      // Bots shop now.
      for (const s of game.soldiers) if (s.isBot && s.alive) botBuy(game, s);
      game.sound('roundStartFreeze', null, null);
    },

    /**
     * Put soldier s at a spawn point for this round (keep: survivors keep their
     * weapons and armour; everyone gets full health).
     */
    place(game, s, keep, p = null) {
      const st = game.modeState;
      const side = sideOf(game, s.team);
      if (!p) {
        const list = sideSpawns(game, side);
        p = list[Math.floor(game.rng() * list.length)] || { x: 0, y: 0 };
      }
      const kept = keep ? { weapons: s.weapons, armour: s.armour, current: s.current, lastInSlot: s.lastInSlot } : null;
      s.spawnAt(p, 0);
      s.fresh = false;
      if (kept) {
        s.weapons = kept.weapons;
        s.armour = kept.armour;
        s.lastInSlot = kept.lastInSlot;
        delete s.weapons.C4;
        if (!s.weapons.Knife) s.weapons.Knife = { ammo: Infinity };
        s.current = s.has(kept.current) ? kept.current : s.current;
        if (!s.has(s.current)) s.selectBest(true);
      } else {
        s.helmet = false;
        s.kit = false;
        defaultLoadout(s);
      }
      // (Defence kits are for the defenders: an attacker's is no use.)
      if (side === 'T') s.kit = false;
      syncGear(game, s);
      if (st.money[s.id] == null) st.money[s.id] = st.ot ? DEFUSE.overtimeMoney : DEFUSE.startMoney;
      (st.joined ||= {})[s.id] = st.round;
      game.moved(s);
      game.controllers.get(s)?.onSpawn?.(game, s);
    },

    /** The match is won when a team has won enough rounds. */
    winner(game) {
      const st = game.modeState;
      return st?.winner ? { team: st.winner } : null;
    },

    /** The match's winning kill: the one that won the last round, if one did. */
    finalKill(game) {
      return game.modeState?.winKill ?? null;
    },

    botGoal,
    botUse,
    botThrow,
  };
}

/** The basics everyone starts a half with (and anyone who died): a knife and a pistol. */
function defaultLoadout(s) {
  const pistol = weaponFor(s, 'Platinum');
  s.weapons = { Knife: { ammo: Infinity }, Platinum: { ammo: pistol.ammo, mag: pistol.mag } };
  s.current = 'Platinum';
  s.lastInSlot = {};
}

/** The rounds to win, from the menu (0 or nothing: the mode's usual). */
function goalOf(game) {
  return Math.max(1, game.fragLimit > 0 ? game.fragLimit : 7);
}

/** A dropped bomb falls to the floor. */
function fall(game, b) {
  const floor = floorBelow(game.map, b.x, b.y - 4);
  if (floor != null && b.y >= floor - 0.5) { b.y = floor; b.vy = 0; return; }
  b.vy = Math.min((b.vy || 0) + 0.35, 9);
  b.y += b.vy;
  if (floor != null && b.y >= floor) { b.y = floor; b.vy = 0; }
}

function shuffle(game, list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(game.rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// ---- Bots ---------------------------------------------------------------------------------------

/** A number from a soldier's id (and a salt): spreads bots across the sites the same way every round. */
const hash = (id, salt = 0) => {
  let h = (id * 2654435761 + salt * 40503) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

/**
 * What a bot buys at the start of a round, Counter-Strike style: on a pistol round
 * a vest or a better pistol; with enough money a rifle (or the sniper rifle, for the
 * campers), armour and grenades; short of that, it saves (an "eco" round) unless
 * the team is losing anyway, when it buys a cheap gun ("force buy").
 */
export function botBuy(game, s) {
  const st = game.modeState, side = sideOf(game, s.team);
  const money = () => moneyOf(game, s);
  const get = id => !whyNot(game, s, id) && !buy(game, s, id);
  const hasPrimary = Object.keys(s.weapons).some(id => kindOf(id) === 'primary' && s.has(id));
  const pistolRound = money() <= DEFUSE.startMoney && !hasPrimary;
  const team = game.soldiers.filter(o => o.team === s.team);
  const avg = team.reduce((a, o) => a + moneyOf(game, o), 0) / Math.max(1, team.length);
  const camper = (s.profile?.camp ?? 10) >= 25;
  const rifle = side === 'T' ? 'AK47' : 'M4';
  if (pistolRound) {
    if (side === 'CT' && hash(s.id, st.round) < 0.3) get('kit');
    if (hash(s.id, st.round + 1) < 0.55) get('kevlar');
    else { get('Beretta'); get('Flashbang'); }
    return;
  }
  if (!hasPrimary) {
    const full = priceOf(rifle) + GEAR.helmet.price;
    if (camper && money() >= priceOf('SR') + GEAR.kevlar.price) get('SR');
    else if (money() >= full) get(rifle);
    else if (money() >= 2000 && (avg < 3000 || st.loss[s.team] >= 3 || hash(s.id, st.round) < 0.25)) get(hash(s.id, 7) < 0.5 ? 'MP5K' : 'Uzi');
    else if (money() >= 1600 && st.loss[s.team] >= 2) get('Shotgun');
  }
  const armed = Object.keys(s.weapons).some(id => kindOf(id) === 'primary' && s.has(id));
  if (armed || money() >= 1000) {
    if (money() >= GEAR.helmet.price + 300) get('helmet');
    else if (money() >= GEAR.kevlar.price) get('kevlar');
  }
  if (!armed && money() >= 700 && !s.weapons.Magnum && hash(s.id, st.round + 3) < 0.4) get('Magnum');
  if (side === 'CT' && money() >= 600) get('kit');
  if (money() >= 500) get('HEGrenade');
  if (money() >= 400 && hash(s.id, st.round + 5) < 0.5) get('Flashbang');
  if (money() >= 600 && hash(s.id, st.round + 9) < 0.35) get(side === 'T' ? 'SmokeGrenade' : 'PetrolBomb');
}

/** The area around a point (a bot standing there counts as "there"). */
const around = (x, y, w, h = 90) => ({ left: x - w, top: y - h, right: x + w, bottom: y + 4 });

/**
 * Where a bot should be. Attackers: the bomb carrier heads for this round's site
 * (most of the team with it, one or two elsewhere); a dropped bomb gets picked up;
 * once it's planted they guard it. Defenders: split between the sites; once it's
 * planted, everyone goes to defuse it.
 */
function botGoal(game, s, bot) {
  const st = game.modeState;
  if (!st || st.phase !== 'live' && st.phase !== 'freeze') return null;
  const b = st.bomb, sites = objectivesOf(game.map, 'site');
  if (!sites.length) return null;
  const side = sideOf(game, s.team);
  const site = label => sites.find(z => z.label === label) || sites[0];
  const role = hash(s.id, st.round);
  if (side === 'T') {
    if (b.s === 'carried' && b.by === s.id) return { zone: site(st.target), hold: true, urgent: true };
    if (b.s === 'dropped' && (role < 0.6 || hypot(b.x - s.x, b.y - s.y) < 500)) return { zone: around(b.x, b.y, 10, 46), urgent: true, moving: true };
    if (b.s === 'planted') {
      // Guard it from a few steps away, somewhere with a view of it (standing right on it
      // would give away where it is, and behind cover there'd be no stopping a defuse).
      return { zone: around(b.x, b.y, 240, 150), avoid: around(b.x, b.y, 40, 60), hold: true, see: { x: b.x, y: b.y - 8 } };
    }
    const target = site(st.target);
    if (role < 0.2 && sites.length > 1) return { zone: sites.find(z => z !== target), hold: true };
    // With the carrier: a step behind or ahead of them.
    const c = b.s === 'carried' ? byId(game, b.by) : null;
    if (c && role < 0.55 && hypot(c.x - s.x, c.y - s.y) > 260) return { zone: around(c.x, c.y + STAND, 120), moving: true };
    return { zone: target, hold: true };
  }
  if (b.s === 'planted') {
    // Retaking the site: clear it from somewhere with a view of the bomb, then defuse
    // (straight for the bomb when nobody's in sight, or when time's running out).
    const need = (gearOf(game, s).kit ? DEFUSE.kitTime : DEFUSE.defuseTime) + 3 * SEC + hypot(b.x - s.x, b.y - s.y) / 2;
    if (!bot?.target || b.fuse < need) return { zone: around(b.x, b.y, 14, 50), hold: true, urgent: true };
    return { zone: around(b.x, b.y, 260, 160), avoid: around(b.x, b.y, 30, 60), hold: true, see: { x: b.x, y: b.y - 8 } };
  }
  if (b.s === 'dropped' && hypot(b.x - s.x, b.y - s.y) < 700) {
    // Defenders keep an eye on a dropped bomb.
    return { zone: around(b.x, b.y, 200, 140), hold: true };
  }
  const pick = sites[Math.floor(hash(s.id, 11) * sites.length)];
  return { zone: pick, hold: true };
}

/**
 * Whether a bot should hold E now: planting at a site with the bomb, or defusing
 * (once nobody it can see is left to shoot at it, or when time's too short to wait).
 */
function botUse(game, s, bot) {
  const what = useHere(game, s);
  if (!what) return false;
  if (what === 'plant') return !bot.target || game.modeState.timer < DEFUSE.plantTime + 3 * SEC;
  const b = game.modeState.bomb;
  const need = gearOf(game, s).kit ? DEFUSE.kitTime : DEFUSE.defuseTime;
  return !bot.target || b.fuse < need + 30;
}

/**
 * A flashbang or smoke grenade for a bot to throw now ({ id, x, y }: what, and where),
 * or null (bot.js throws it). A flashbang goes where an enemy was just seen or heard
 * and is out of sight now, or ahead of a retake of the planted bomb; attackers on
 * their way into a site throw one in first, and smoke off its far side to cut the
 * defenders' view across it.
 */
function botThrow(game, s, bot) {
  const st = game.modeState;
  if (!st || st.phase !== 'live' || useHere(game, s)) return null;
  const has = id => s.weapons[id]?.ammo > 0;
  const side = sideOf(game, s.team), b = st.bomb;
  const seen = bot.lastSeen, ago = seen ? game.tick - seen.tick : Infinity;
  // (A grenade lobbed as hard as it goes lands about 250 pixels off, on the flat.)
  const within = (x, y, near, far) => { const d = hypot(x - s.x, y - s.y); return d >= near && d <= far; };
  if (has('Flashbang') && ago > 20 && ago < 150 && within(seen.x, seen.y, 110, 280) && hash(s.id, game.tick >> 7) < 0.6) {
    return { id: 'Flashbang', x: seen.x, y: seen.y - 30 };
  }
  if (side === 'CT') {
    // Retaking the site: a flashbang over the bomb first.
    if (b.s !== 'planted' || !has('Flashbang')) return null;
    return within(b.x, b.y, 130, 270) && hash(s.id, st.round * 3) < 0.7 ? { id: 'Flashbang', x: b.x, y: b.y - 60 } : null;
  }
  if (b.s === 'planted') return null;
  const site = objectivesOf(game.map, 'site').find(z => z.label === st.target);
  if (!site || inZone(s, site)) return null;
  const cx = (site.left + site.right) / 2, dir = Math.sign(cx - s.x) || 1;
  // Smoke off the far side of the site (where the defenders come from), then a flashbang into it.
  const sx = dir > 0 ? site.right + 30 : site.left - 30;
  if (has('SmokeGrenade') && within(sx, site.bottom, 120, 250)) return { id: 'SmokeGrenade', x: sx, y: site.bottom - 30 };
  if (has('Flashbang') && within(cx, site.bottom, 100, 270) && hash(s.id, st.round * 5) < 0.75) return { id: 'Flashbang', x: cx, y: site.bottom - 70 };
  return null;
}
