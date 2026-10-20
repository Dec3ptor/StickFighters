// Progression (in matches with classes on): XP, ranks and unlocks.
//
// The game hands out XP (game.xp) for kills, objectives, helping teammates and
// finishing a match; online, the host does and sends each player theirs. Each
// player's browser keeps a profile in localStorage: total XP (your rank), XP
// per class (class ranks unlock other main weapons), and kills per weapon
// (which unlock that weapon's upgrades). Bots don't progress.
//
// Nothing here touches the page, so tests can run it (with a stand-in storage).

import { WEAPONS } from './weapons.js';
import { CLASSES, CLASS_IDS, UPGRADES, upgradesFor, kitWeapons, cleanLoadouts, cleanClass, defaultLoadout } from './classes.js';

/** XP for each thing you do. */
export const XP = {
  kill: 100, headshot: 50,
  capture: 250, neutralise: 100,                                // conquest
  flagTake: 100, flagCapture: 500, flagReturn: 150, carrierKill: 100, // capture the flag
  arm: 250, disarm: 300, destroy: 400,                          // rush
  hill: 10,                                                     // king of the hill: each second on it
  heal: 25, repair: 25, resupply: 25, beaconSpawn: 30, beaconKill: 50, // helping out
  finish: 300, win: 500,                                        // the end of a match
};

/** What each one says in the pop-ups and the match summary. */
export const XP_LABEL = {
  kill: 'Kill', headshot: 'Headshot', capture: 'Point captured', neutralise: 'Point neutralised',
  flagTake: 'Flag taken', flagCapture: 'Flag captured', flagReturn: 'Flag returned', carrierKill: 'Carrier stopped',
  arm: 'M-COM armed', disarm: 'M-COM disarmed', destroy: 'M-COM destroyed', hill: 'Holding the hill',
  heal: 'Heal', repair: 'Armour', resupply: 'Resupply', beaconSpawn: 'Beacon spawn', beaconKill: 'Beacon destroyed',
  finish: 'Match completed', win: 'Victory',
};

// ---- Ranks ------------------------------------------------------------------------------

export const RANKS = [
  'Recruit', 'Private', 'Private First Class', 'Lance Corporal', 'Corporal', 'Sergeant', 'Staff Sergeant',
  'Gunnery Sergeant', 'Master Sergeant', 'First Sergeant', 'Sergeant Major', 'Warrant Officer',
  'Chief Warrant Officer', 'Second Lieutenant', 'First Lieutenant', 'Captain', 'Major',
  'Lieutenant Colonel', 'Colonel', 'Brigadier General', 'Major General', 'Lieutenant General', 'General',
];

/** XP needed for rank r: 1,000 for rank 1, then 1,500 more, 2,000 more... */
export const rankXp = r => (500 * r * (r + 3)) / 2;

/** Class ranks: XP earned playing as the class. Rank 1 and rank 3 unlock main weapons. */
export const CLASS_RANK_XP = [0, 1500, 4000, 8000, 14000, 22000];

/** Kills with a weapon that unlock its upgrades, in order (guns have four, explosives two). */
export const GUN_UNLOCKS = [5, 15, 30, 50];
export const EXPLOSIVE_UNLOCKS = [3, 10];

/** { rank, name, xp, at (XP the rank starts at), next (XP for the next one, or null at the top) } */
export function rankOf(xp) {
  let r = 0;
  while (r < RANKS.length - 1 && xp >= rankXp(r + 1)) r++;
  return { rank: r, name: RANKS[r], xp, at: rankXp(r), next: r < RANKS.length - 1 ? rankXp(r + 1) : null };
}

/** A class rank: { rank, xp, at, next } (next is null at the top). */
export function classRankOf(xp) {
  let r = 0;
  while (r < CLASS_RANK_XP.length - 1 && xp >= CLASS_RANK_XP[r + 1]) r++;
  return { rank: r, xp, at: CLASS_RANK_XP[r], next: r < CLASS_RANK_XP.length - 1 ? CLASS_RANK_XP[r + 1] : null };
}

/** How far through a rank (0-1). */
export const rankProgress = r => (r.next == null ? 1 : (r.xp - r.at) / (r.next - r.at));

// ---- The profile ---------------------------------------------------------------------------

export const PROFILE_KEY = 'stick-soldiers-profile';

/** A fresh profile. */
export function newProfile() {
  return {
    v: 1, xp: 0, matches: 0, wins: 0,
    classXp: Object.fromEntries(CLASS_IDS.map(c => [c, 0])),
    kills: {},                 // weapon id -> kills with it
    cls: 'assault',            // the class you play as
    loadouts: cleanLoadouts(null),
  };
}

const count = v => (Number.isFinite(+v) && +v > 0 ? Math.floor(+v) : 0);

/** A profile read from storage (anything odd in it is dropped). */
export function cleanProfile(raw) {
  const p = newProfile();
  if (!raw || typeof raw !== 'object') return p;
  p.xp = count(raw.xp);
  p.matches = count(raw.matches);
  p.wins = count(raw.wins);
  for (const c of CLASS_IDS) p.classXp[c] = count(raw.classXp?.[c]);
  for (const id in raw.kills || {}) if (WEAPONS[id]) p.kills[id] = count(raw.kills[id]);
  p.cls = cleanClass(raw.cls) || 'assault';
  p.loadouts = cleanLoadouts(raw.loadouts);
  return p;
}

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

/** The profile saved in this browser (a new one if there isn't one). */
export function loadProfile(store = storage()) {
  try { return cleanProfile(JSON.parse(store?.getItem(PROFILE_KEY) || 'null')); } catch { return newProfile(); }
}

export function saveProfile(p, store = storage()) {
  try { store?.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* private mode or full: keep playing */ }
}

// ---- Unlocks ---------------------------------------------------------------------------------

/** True if the profile has unlocked main weapon `id` for class `cls`. */
export function mainUnlocked(p, cls, id) {
  const m = CLASSES[cls]?.mains.find(x => x.id === id);
  return !!m && classRankOf(p.classXp[cls] || 0).rank >= (m.rank || 0);
}

/** Kills needed to unlock upgrade `up` for weapon `id` (Infinity if it doesn't fit). */
export function upgradeKills(id, up) {
  const list = upgradesFor(id), i = list.indexOf(up);
  if (i < 0) return Infinity;
  const isGun = !WEAPONS[id].blast;
  return (isGun ? GUN_UNLOCKS : EXPLOSIVE_UNLOCKS)[i] ?? Infinity;
}

export const upgradeUnlocked = (p, id, up) => (p.kills[id] || 0) >= upgradeKills(id, up);

/**
 * The loadouts to play with: the profile's choices, less anything not (or no
 * longer) unlocked. This is what's sent to the host online.
 */
export function playLoadouts(p) {
  const out = {};
  for (const cls of CLASS_IDS) {
    const lo = p.loadouts[cls] || defaultLoadout(cls);
    const main = mainUnlocked(p, cls, lo.main) ? lo.main : defaultLoadout(cls).main;
    const ups = {};
    for (const { id } of kitWeapons(cls, main)) {
      const up = lo.ups?.[id];
      if (up && upgradeUnlocked(p, id, up)) ups[id] = up;
    }
    out[cls] = { main, ups };
  }
  return out;
}

/** Everything the profile has unlocked: [{ key, text }]. */
export function unlocksOf(p) {
  const out = [];
  for (const cls of CLASS_IDS) {
    for (const m of CLASSES[cls].mains) {
      if (m.rank && mainUnlocked(p, cls, m.id)) out.push({ key: `main:${cls}:${m.id}`, text: `${WEAPONS[m.id].name} for ${CLASSES[cls].name}` });
    }
  }
  for (const id of upgradeWeapons()) {
    for (const up of upgradesFor(id)) {
      if (upgradeUnlocked(p, id, up)) out.push({ key: `up:${id}:${up}`, text: `${UPGRADES[up].name} for the ${WEAPONS[id].name}` });
    }
  }
  return out;
}

/** Weapons in any kit (the ones with upgrades to unlock). */
let kitIds = null;
export function upgradeWeapons() {
  if (!kitIds) {
    const set = new Set();
    for (const cls of CLASS_IDS) for (const m of CLASSES[cls].mains) for (const w of kitWeapons(cls, m.id)) set.add(w.id);
    kitIds = [...set].filter(id => upgradesFor(id).length);
  }
  return kitIds;
}

/** What unlocks next for a class: its next main weapon, { id, rank, xpLeft } or null. */
export function nextMain(p, cls) {
  const xp = p.classXp[cls] || 0;
  const m = CLASSES[cls].mains.find(x => x.rank && !mainUnlocked(p, cls, x.id));
  return m ? { id: m.id, rank: m.rank, xpLeft: CLASS_RANK_XP[m.rank] - xp } : null;
}

/** A weapon's next upgrade: { up, kills (needed in all), left } or null when they're all unlocked. */
export function nextUpgrade(p, id) {
  const have = p.kills[id] || 0;
  const up = upgradesFor(id).find(u => !upgradeUnlocked(p, id, u));
  return up ? { up, kills: upgradeKills(id, up), left: upgradeKills(id, up) - have } : null;
}

// ---- During a match ----------------------------------------------------------------------------

/**
 * One match's XP for the player: adds each award to the profile as it comes
 * (so leaving early keeps it), keeps the pop-ups for the HUD, and sums it all
 * up at the end.
 */
export class MatchXp {
  constructor(profile, { save = p => saveProfile(p), now = () => Date.now() } = {}) {
    this.profile = profile;
    this.save = save;
    this.now = now;
    this.start = { xp: profile.xp, classXp: { ...profile.classXp }, unlocks: new Set(unlocksOf(profile).map(u => u.key)) };
    this.reasons = new Map();   // why -> { n, count }
    this.total = 0;
    this.played = new Set();    // classes that earned XP this match
    this.popups = [];
    this.version = 0;
  }

  /** An award: { n, why, w (weapon, for kills), c (the class it was earned as) }. */
  add(e) {
    const n = Math.max(0, Math.min(5000, Math.round(+e.n || 0)));
    if (!n || !XP_LABEL[e.why]) return;
    const p = this.profile;
    p.xp += n;
    const cls = cleanClass(e.c);
    if (cls) { p.classXp[cls] += n; this.played.add(cls); }
    if (e.why === 'kill' && e.w && WEAPONS[e.w]) p.kills[e.w] = (p.kills[e.w] || 0) + 1;
    if (e.why === 'finish') p.matches++;
    if (e.why === 'win') p.wins++;
    const r = this.reasons.get(e.why) || { n: 0, count: 0 };
    r.n += n; r.count++;
    this.reasons.set(e.why, r);
    this.total += n;
    // Pop-ups: the same kind of award close together adds up in one ("+30 Holding the hill").
    const t = this.now(), last = this.popups[this.popups.length - 1];
    if (last && last.why === e.why && t - last.at < 1200) { last.n += n; last.at = t; }
    else this.popups.push({ why: e.why, n, at: t });
    if (this.popups.length > 6) this.popups.shift();
    this.version++;
    this.save(p);
  }

  /** Pop-ups still showing: [{ text, age (0-1) }], newest last. */
  showing(life = 2200) {
    const t = this.now();
    return this.popups.filter(x => t - x.at < life).map(x => ({ text: `+${x.n} ${XP_LABEL[x.why]}`, age: (t - x.at) / life }));
  }

  /** The match so far: XP by reason, rank and class ranks before and after, and what's newly unlocked. */
  summary() {
    const p = this.profile;
    const order = Object.keys(XP_LABEL);
    return {
      total: this.total,
      reasons: [...this.reasons.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
        .map(([why, r]) => ({ why, label: XP_LABEL[why], count: r.count, n: r.n })),
      rank: { before: rankOf(this.start.xp), after: rankOf(p.xp) },
      classes: [...this.played].map(cls => ({ cls, name: CLASSES[cls].name, before: classRankOf(this.start.classXp[cls]), after: classRankOf(p.classXp[cls]) })),
      unlocked: unlocksOf(p).filter(u => !this.start.unlocks.has(u.key)),
    };
  }
}
