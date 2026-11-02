// Playing together (world mode, online): parties and trading. Right click on another player in
// reach for what you can do with them: invite them into your party (or join theirs), leave it,
// trade with them.
//
// A party (up to six) shares its fights: a monster killed near a party member counts for their
// quests too (kill, clear the cave, hunt), and they get half its experience; a quest can be shared
// with the party (the journal: Share), each getting it fresh; and the HUD shows each other's
// health, and where they are on the map.
//
// A trade: each puts up things from their bag and coins; when both have accepted what's on the
// table (anything changed, and both have to accept again), the host swaps them over.
//
// The host does it all (worldnet.js passes on what players ask for, and sends each their party
// and their trade); the parties last as long as the world's open.

import { TILE } from './blocks.js';
import { itemOf, Inventory } from './items.js';
import { questEvent, questsOf, acceptQuest, MAX_QUESTS } from './quests.js';
import { giveXp, progOf } from './progress.js';

/** The most in a party; how near (tiles) a party member must be to share a fight. */
export const PARTY_MAX = 6, SHARE_NEAR = 60;
/** How near (px) another player has to be to right click on them. */
export const SOCIAL_REACH = 7 * TILE;

const players = game => game.soldiers.filter(s => s.world && !s.npc);
const byName = (game, name) => players(game).find(s => s.name.toLowerCase() === String(name).toLowerCase());

// ---- Parties ---------------------------------------------------------------------------------------------

/** The party player s is in ({ id, members: [names] }), or null. */
export function partyOf(game, s) {
  const parties = game.world.parties;
  if (!parties || !s?.world) return null;
  for (const p of parties.values()) if (p.members.some(n => n.toLowerCase() === s.name.toLowerCase())) return p;
  return null;
}

/** The other players in player s's party (those in the world now). */
export function partyMates(game, s) {
  const p = partyOf(game, s);
  return p ? p.members.map(n => byName(game, n)).filter(o => o && o !== s) : [];
}

/** Player `from` invites player `to` into their party. Returns what to tell `from`. */
export function invite(game, from, to) {
  if (!to?.world || to === from) return null;
  const mine = partyOf(game, from), theirs = partyOf(game, to);
  if (theirs && theirs === mine) return `${to.name} is in your party already`;
  if (theirs) return `${to.name} is in another party`;
  if (mine && mine.members.length >= PARTY_MAX) return `A party can be ${PARTY_MAX} at most`;
  to.world.invite = { from: from.name, at: game.tick };
  game.notify(to, `${from.name} asks you to join their party (right click on them to say yes)`);
  return `You asked ${to.name} to join your party`;
}

/** Player s says yes to `from`'s invitation. Returns what to tell them. */
export function joinParty(game, s, from) {
  if (!s.world.invite || s.world.invite.from.toLowerCase() !== from?.name.toLowerCase()) return null;
  s.world.invite = null;
  if (partyOf(game, s)) leaveParty(game, s);
  const parties = game.world.parties ||= new Map();
  let p = partyOf(game, from);
  if (!p) { p = { id: `party${game.tick}${from.id}`, members: [from.name] }; parties.set(p.id, p); }
  if (p.members.length >= PARTY_MAX) return 'That party is full';
  p.members.push(s.name);
  for (const o of partyMates(game, s)) game.notify(o, `${s.name} has joined the party`);
  return `You've joined ${from.name}'s party`;
}

/** Player s leaves their party (a party of one is no party). */
export function leaveParty(game, s) {
  const p = partyOf(game, s);
  if (!p) return null;
  p.members = p.members.filter(n => n.toLowerCase() !== s.name.toLowerCase());
  for (const o of p.members.map(n => byName(game, n)).filter(Boolean)) game.notify(o, `${s.name} has left the party`);
  if (p.members.length < 2) game.world.parties.delete(p.id);
  return 'You\'ve left the party';
}

/**
 * A monster killed by player `by` (worldplay.js's onKill): their party members near it count it
 * for their quests too, and get half its experience.
 */
export function shareKill(game, by, victim, xp) {
  for (const o of partyMates(game, by)) {
    if (!o.alive || Math.abs(o.x - victim.x) > SHARE_NEAR * TILE || Math.abs(o.y - victim.y) > SHARE_NEAR * TILE) continue;
    if (xp > 0) giveXp(game, o, Math.round(xp / 2), `${by.name}'s kill`);
    questEvent(game, o, { type: 'kill', what: victim.npc.type, x: victim.x, y: victim.y, champion: victim.npc.champion });
  }
}

/** Player s shares quest `id` with their party: each gets it, fresh (if they've room, and haven't done it). Returns what to tell s. */
export function shareQuest(game, s, id) {
  const q = questsOf(s).list.find(x => x.id === id);
  if (!q) return null;
  if (q.kind !== 'side') return 'Only townsfolk\'s work can be shared (not the story, nor someone\'s own mission)';
  const mates = partyMates(game, s);
  if (!mates.length) return 'You\'re not in a party';
  let n = 0;
  for (const o of mates) {
    const qs = questsOf(o);
    if (qs.list.length >= MAX_QUESTS || qs.list.some(x => x.id === id) || qs.done.has(id)) continue;
    const fresh = JSON.parse(JSON.stringify(q));
    for (const g of fresh.goals) { if ('have' in g) g.have = 0; if ('done' in g) g.done = false; }
    fresh.ready = false;
    // (What it gives to carry, they get too; what it puts in the world is there already.)
    delete fresh.place;
    if (/^Quest/.test(acceptQuest(game, o, fresh) || '')) { n++; game.notify(o, `${s.name} shared a quest: ${q.title}`); }
  }
  return n ? `Shared with ${n} of your party` : 'Nobody in your party could take it';
}

/** A player's party as their HUD shows it: [{ id, name, level, health, max, x, y }] (not them). */
export function partyView(game, s) {
  return partyMates(game, s).map(o => ({ id: o.id, name: o.name, level: progOf(o).level, health: Math.max(0, Math.round(o.health)), max: o.maxHealth, x: Math.round(o.x), y: Math.round(o.y), alive: o.alive }));
}

// ---- Trading ---------------------------------------------------------------------------------------------

/** The trade player s is in (world.trades: { a, b (names), offers: { name: { slots: [[i, n]], coins, ok } }, v }), or null. */
export function tradeOf(game, s) {
  for (const t of game.world.trades?.values() || []) if ([t.a, t.b].some(n => n.toLowerCase() === s.name.toLowerCase())) return t;
  return null;
}

const otherIn = (t, s) => (t.a.toLowerCase() === s.name.toLowerCase() ? t.b : t.a);

/** Player a asks player b to trade (b has to ask back, or accept: right click on a). Returns what to tell a. */
export function askTrade(game, a, b) {
  if (!b?.world || b === a) return null;
  if (tradeOf(game, a) || tradeOf(game, b)) return 'One of you is trading already';
  // (Asked both ways: it starts.)
  if (a.world.tradeAsk?.from?.toLowerCase() === b.name.toLowerCase()) {
    a.world.tradeAsk = null;
    const trades = game.world.trades ||= new Map(), id = `trade${game.tick}${a.id}`;
    trades.set(id, { id, a: a.name, b: b.name, offers: { [a.name]: { slots: [], coins: 0, ok: false }, [b.name]: { slots: [], coins: 0, ok: false } }, v: 1 });
    game.notify(b, `Trading with ${a.name}`);
    return `Trading with ${b.name}`;
  }
  b.world.tradeAsk = { from: a.name, at: game.tick };
  game.notify(b, `${a.name} wants to trade (right click on them, and Trade)`);
  return `You asked ${b.name} to trade`;
}

/**
 * Player s changes what they offer: slots ([[slot, n], ...] of their things), coins. Both have
 * to accept again.
 */
export function offerTrade(game, s, slots, coins) {
  const t = tradeOf(game, s);
  if (!t) return;
  const inv = s.world.inv, seen = new Set(), clean = [];
  for (const [i, n] of Array.isArray(slots) ? slots.slice(0, 12) : []) {
    const sl = inv.slots[i | 0];
    if (!sl || seen.has(i | 0) || itemOf(sl.key)?.kind === 'quest') continue;
    seen.add(i | 0);
    clean.push([i | 0, Math.max(1, Math.min(sl.n, n | 0 || sl.n))]);
  }
  const o = t.offers[s.name] || t.offers[Object.keys(t.offers).find(k => k.toLowerCase() === s.name.toLowerCase())];
  o.slots = clean;
  o.coins = Math.max(0, Math.min(inv.count('coins'), coins | 0));
  for (const k of Object.keys(t.offers)) t.offers[k].ok = false;
  t.v++;
}

/** Player s accepts what's on the table; both accepted, it's done. Returns what to tell them (or null). */
export function acceptTrade(game, s) {
  const t = tradeOf(game, s);
  if (!t) return null;
  const mineKey = Object.keys(t.offers).find(k => k.toLowerCase() === s.name.toLowerCase());
  t.offers[mineKey].ok = true;
  t.v++;
  if (!Object.values(t.offers).every(o => o.ok)) return 'Waiting for them to accept';
  const a = byName(game, t.a), b = byName(game, t.b);
  if (!a || !b) { cancelTrade(game, s); return 'They\'ve gone'; }
  const oa = t.offers[Object.keys(t.offers).find(k => k.toLowerCase() === a.name.toLowerCase())];
  const ob = t.offers[Object.keys(t.offers).find(k => k.toLowerCase() === b.name.toLowerCase())];
  // (Each side's things taken out first, checked, then each given the other's; anything off, nothing happens.)
  const take = (who, o) => {
    const inv = who.world.inv, out = [];
    for (const [i, n] of o.slots) { const sl = inv.slots[i]; if (!sl || sl.n < n) return null; out.push({ key: sl.key, n, mag: sl.mag }); }
    if (inv.count('coins') < o.coins) return null;
    return out;
  };
  const ga = take(a, oa), gb = take(b, ob);
  if (!ga || !gb) { for (const o of Object.values(t.offers)) o.ok = false; t.v++; return 'Something changed: look again, and accept'; }
  // Room: each side's things, after giving theirs away.
  const after = (who, give, get, coinsOut, coinsIn) => {
    const inv = Inventory.from(who.world.inv.toJSON(), who.world.inv.slots.length);
    for (const g of give) inv.remove(g.key, g.n);
    inv.remove('coins', coinsOut);
    for (const g of get) if (inv.add(g.key, g.n)) return false;
    return !inv.add('coins', coinsIn);
  };
  if (!after(a, ga, gb, oa.coins, ob.coins) || !after(b, gb, ga, ob.coins, oa.coins)) { for (const o of Object.values(t.offers)) o.ok = false; t.v++; return 'One of you hasn\'t the room'; }
  const swap = (from, to, give, coins) => {
    for (const [i, n] of (from === a ? oa : ob).slots) from.world.inv.take(i, n);
    from.world.inv.remove('coins', coins);
    for (const g of give) to.world.inv.add(g.key, g.n);
    to.world.inv.add('coins', coins);
  };
  swap(a, b, ga, oa.coins);
  swap(b, a, gb, ob.coins);
  game.world.trades.delete(t.id);
  for (const p of [a, b]) { game.notify(p, 'Traded'); game.sound('pickup', p.x, p.y, p.id); }
  return 'Traded';
}

/** Player s calls off their trade. */
export function cancelTrade(game, s) {
  const t = tradeOf(game, s);
  if (!t) return;
  game.world.trades.delete(t.id);
  const other = byName(game, otherIn(t, s));
  if (other) game.notify(other, `${s.name} called off the trade`);
}

/** Player s's trade as their screen shows it: { with, mine: { items: [[key, n, slot]], coins, ok }, theirs: { items, coins, ok }, v }, or null. */
export function tradeView(game, s) {
  const t = tradeOf(game, s);
  if (!t) return null;
  const other = otherIn(t, s), them = byName(game, other);
  const side = (who, name) => {
    const o = t.offers[Object.keys(t.offers).find(k => k.toLowerCase() === name.toLowerCase())];
    return { items: o.slots.map(([i, n]) => [who?.world.inv.slots[i]?.key ?? '', n, i]).filter(x => x[0]), coins: o.coins, ok: o.ok };
  };
  return { with: other, mine: side(s, s.name), theirs: side(them, other), v: t.v };
}

// ---- Right click on another player ------------------------------------------------------------------------

/** The other player under (or very near) the point (x, y), in reach of s; or null. */
export function playerAt(game, s, x, y) {
  for (const o of players(game)) {
    if (o === s || !o.alive || Math.abs(o.x - s.x) > SOCIAL_REACH || Math.abs(o.y - s.y) > SOCIAL_REACH) continue;
    if (Math.abs(x - o.x) < 10 && y > o.y - 30 && y < o.y + 16) return o;
  }
  return null;
}

/** What player s can do with player o, for the menu: [{ op, label }]. */
export function socialOptions(game, s, o) {
  const out = [], mine = partyOf(game, s), theirs = partyOf(game, o);
  if (s.world.invite?.from.toLowerCase() === o.name.toLowerCase()) out.push({ op: 'pjoin', label: `Join ${o.name}'s party` });
  else if (!theirs || theirs !== mine) out.push({ op: 'pinvite', label: `Invite ${o.name} into your party` });
  if (mine) out.push({ op: 'pleave', label: 'Leave your party' });
  out.push({ op: 'trade', label: s.world.tradeAsk?.from.toLowerCase() === o.name.toLowerCase() ? `Trade with ${o.name} (they asked)` : `Trade with ${o.name}` });
  return out;
}

/** Player s does `op` with player o (from the menu). Returns what to tell them. */
export function socialDo(game, s, o, op) {
  if (!o?.world || o === s) return null;
  switch (op) {
    case 'pinvite': return invite(game, s, o);
    case 'pjoin': return joinParty(game, s, o);
    case 'pleave': return leaveParty(game, s);
    case 'trade': return askTrade(game, s, o);
    default: return null;
  }
}
