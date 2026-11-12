// Finding and joining online games through public Nostr relays.
//
// Hosts list their game every 20 seconds (a stored listing that disappears
// after two minutes, plus a live announcement), and answer "who's hosting?"
// questions from players opening the server browser. To join, a player sends
// the host a connection offer, sealed so only the host can read it; the host
// answers the same way, and the two browsers then talk directly.

import { RelayPool, makeKeys, signEvent, seal, unseal, now, randomId } from './nostr.js';
import { RELAYS, KIND, TAG, relaysFor } from './relays.js';
import { PeerLink } from './peer.js';
import { PROTOCOL } from './protocol.js';

/** The modes a listed game can say it is (the game's modes, modes.js: every one of them, the objective ones too). */
export const GAME_MODES = ['ffa', 'team', 'gungame', 'oitc', 'koth', 'ctf', 'conquest', 'rush', 'defuse', 'world'];

const LISTING_EVERY = 20000;  // ms between listing refreshes
const STALE_AFTER = 75;       // seconds without a refresh before a game drops off the list
const KEY_STORE = 'stick-soldiers-key';
const GAME_ID_STORE = 'stick-soldiers-game-id';
const GAME_ID = /^[0-9a-f]{4,32}$/;

/**
 * This browser's own game id, kept: with its key (below), an invite link to a game hosted from
 * here is the same every time, so friends can keep it.
 */
export function loadGameId() {
  try {
    const saved = localStorage.getItem(GAME_ID_STORE);
    if (GAME_ID.test(saved || '')) return saved;
    const id = randomId(6);
    localStorage.setItem(GAME_ID_STORE, id);
    return id;
  } catch { return randomId(6); }
}

/**
 * A game's id once its host has gone and another player's taken it over: everyone left works
 * it out the same from the old one, so they find the new host without being told.
 */
export const nextGameId = id => `${id.slice(0, -1)}${((parseInt(id.slice(-1), 16) + 1) % 16).toString(16)}`;

/** This browser's time zone, in whole hours from UTC: a rough idea of where a player is, for finding games nearby. */
export function myZone() {
  try { return Math.round(-new Date().getTimezoneOffset() / 60); } catch { return null; }
}

/** Hours between two time zones, the short way round the world. */
const zoneGap = (a, b) => { const d = Math.abs(a - b) % 24; return Math.min(d, 24 - d); };

/**
 * The games a quick match tries, best first: open ones with room (matches, not worlds); the
 * nearest first, as well as can be told (hosts say their time zone: within 3 hours, within 7, or
 * further); then the fullest, one of the mode asked for (if one is) ahead of another about as full.
 */
export function rankGames(list, { mode = null, zone = myZone() } = {}) {
  const far = g => (zone == null || g.zone == null ? 1 : zoneGap(zone, g.zone) <= 3 ? 0 : zoneGap(zone, g.zone) <= 7 ? 1 : 2);
  // (The fullest; the mode asked for counts as a player and a half more.)
  const want = g => g.players + (mode && g.mode === mode ? 1.5 : 0);
  return list.filter(g => g.version === PROTOCOL && !g.closed && g.players < g.max && g.mode !== 'world')
    .sort((a, b) => far(a) - far(b) || want(b) - want(a) || b.seen - a.seen);
}

/** This browser's key (kept, so a host keeps the same identity between visits). */
export function loadKeys() {
  try {
    const saved = localStorage.getItem(KEY_STORE);
    if (saved) return makeKeys(saved);
    const keys = makeKeys();
    localStorage.setItem(KEY_STORE, keys.secret);
    return keys;
  } catch { return makeKeys(); }
}

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

/** Check a game listing from the relays (anyone can post anything there). */
export function parseListing(ev, data) {
  if (!data || typeof data !== 'object' || typeof data.id !== 'string' || !GAME_ID.test(data.id)) return null;
  return {
    key: `${ev.pubkey}:${data.id}`,
    id: data.id,
    host: ev.pubkey,
    name: str(data.name, 40) || 'Online game',
    hostName: str(data.hostName, 14) || 'Someone',
    mapName: str(data.mapName, 40) || 'Unknown map',
    mode: GAME_MODES.includes(data.mode) ? data.mode : 'ffa',
    players: int(data.players, 0, 64),
    max: int(data.max, 1, 64),
    bots: int(data.bots, 0, 64),
    version: int(data.v, 0, 1e6),
    // (The host's time zone, hours from UTC, if it says: roughly how far away it is.)
    zone: Number.isFinite(data.tz) ? int(data.tz, -12, 14) : null,
    closed: !!data.closed,
    seen: ev.created_at,
  };
}

export class Lobby {
  constructor({ relays = relaysFor(RELAYS), keys = loadKeys(), log = () => {}, makeLink = () => PeerLink.make() } = {}) {
    this.keys = keys;
    this.log = log;
    this.makeLink = makeLink;
    this.pool = new RelayPool(relays, { log });
    this.signalHandlers = new Set();
    this.pool.subscribe({ kinds: [KIND.signal], '#p': [keys.pubkey], since: now() - 30 }, ev => this.onSignal(ev));
  }

  /** How many relays we're connected to, out of how many. */
  status() { return { connected: this.pool.connected, total: this.pool.urls.length }; }

  async onSignal(ev) {
    if (ev.created_at < now() - 90) return;
    let msg;
    try { msg = JSON.parse(await unseal(this.keys, ev.pubkey, ev.content)); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    for (const h of this.signalHandlers) h(msg, ev.pubkey);
  }

  async signal(to, msg) {
    const ev = await signEvent({ kind: KIND.signal, tags: [['p', to]], content: await seal(this.keys, to, JSON.stringify(msg)) }, this.keys);
    return this.pool.publish(ev);
  }

  async announce(msg, at = undefined) {
    const ev = await signEvent({ kind: KIND.lobby, tags: [['x', TAG.lobby]], content: JSON.stringify(msg), created_at: at }, this.keys);
    return this.pool.publish(ev);
  }

  // ---- Server browser -------------------------------------------------------------------

  /** Keep an up-to-date list of open games. Calls onChange(list) as it changes. Returns { stop, refresh }. */
  watch(onChange) {
    const games = new Map();
    // Games we've seen close. Relays that haven't heard yet can still send the
    // old listing, so remember when each closed and ignore anything older.
    const closed = new Map();
    const emit = () => {
      const t = now();
      for (const [k, g] of games) if (g.closed || g.seen < t - STALE_AFTER) games.delete(k);
      onChange([...games.values()].sort((a, b) => (b.version === PROTOCOL) - (a.version === PROTOCOL) || b.players - a.players || b.seen - a.seen));
    };
    const close = (key, at) => {
      closed.set(key, Math.max(at, closed.get(key) || 0));
      games.delete(key);
      emit();
    };
    const add = (ev, data) => {
      const g = parseListing(ev, data);
      if (!g) return;
      if (g.closed) { close(g.key, g.seen); return; }
      if (closed.has(g.key) && g.seen <= closed.get(g.key)) return;
      const old = games.get(g.key);
      if (old && old.seen > g.seen) return;
      games.set(g.key, g);
      emit();
    };
    const subs = [
      this.pool.subscribe({ kinds: [KIND.app], '#t': [TAG.game], since: now() - 150 }, ev => { try { add(ev, JSON.parse(ev.content)); } catch { /* not ours */ } }),
      this.pool.subscribe({ kinds: [KIND.lobby], '#x': [TAG.lobby], since: now() - 10 }, ev => {
        try {
          const m = JSON.parse(ev.content);
          if (m.type === 'game') add(ev, m.game);
          else if (m.type === 'closed' && typeof m.id === 'string') close(`${ev.pubkey}:${m.id}`, ev.created_at);
        } catch { /* not ours */ }
      }),
    ];
    const refresh = () => this.pool.ready(1, 4000).then(() => this.announce({ type: 'who' }));
    refresh();
    const timer = setInterval(emit, 5000);
    emit();
    return { stop: () => { clearInterval(timer); for (const s of subs) s.close(); }, refresh, games };
  }

  /** Collect the open games for `ms` milliseconds. */
  listGames(ms = 3000) {
    return new Promise(resolve => {
      let list = [];
      const w = this.watch(l => { list = l; });
      setTimeout(() => { w.stop(); resolve(list); }, ms);
    });
  }

  // ---- Hosting --------------------------------------------------------------------------

  /**
   * List a game and accept players.
   * opts: { id (the game's id: this browser's own, loadGameId, unless one's given),
   *         info(): { name, hostName, mapName, mode, players, max, bots, private },
   *         accept(name, key): null to let them in, or a reason to turn them away (key: who's
   *           asking, the same each time they do),
   *         onPlayer(link, name, key),
   *         onJoinFailed(name, why): someone was let in but couldn't connect }
   */
  host(opts) {
    const id = GAME_ID.test(opts.id || '') ? opts.id : randomId(6);
    let closed = false, lastAnswer = 0;
    const listing = () => ({ ...opts.info(), id, v: PROTOCOL, tz: myZone() });
    // (A game's id is the same each time it's hosted from here, and a listing counts only if
    // it's newer than the last word that the game closed: so what this one says is always dated
    // after the last one's closing, even hosted again in the same second; and its own closing
    // after everything it said.)
    this.closedAt ||= new Map();
    let said = 0;
    const stamp = () => (said = Math.max(now(), (this.closedAt.get(id) || 0) + 1, said));

    const publish = async () => {
      if (closed) return;
      const info = listing();
      if (info.private) return;
      const at = stamp();
      const stored = await signEvent({
        kind: KIND.app, content: JSON.stringify(info), created_at: at,
        tags: [['d', `stick-soldiers/game/${id}`], ['t', TAG.game], ['expiration', String(now() + 150)]],
      }, this.keys);
      this.pool.publish(stored);
      this.announce({ type: 'game', game: info }, at);
    };
    const timer = setInterval(publish, LISTING_EVERY);
    this.pool.ready(1, 5000).then(publish);

    const who = this.pool.subscribe({ kinds: [KIND.lobby], '#x': [TAG.lobby], since: now() }, ev => {
      try {
        if (JSON.parse(ev.content).type !== 'who' || Date.now() - lastAnswer < 2500) return;
        lastAnswer = Date.now();
        if (!listing().private) this.announce({ type: 'game', game: listing() }, stamp());
      } catch { /* not ours */ }
    });

    const seen = new Set();
    const onOffer = async (msg, from) => {
      if (closed || msg.type !== 'offer' || msg.game !== id || typeof msg.sdp !== 'string' || seen.has(msg.nonce)) return;
      seen.add(msg.nonce);
      const reply = extra => this.signal(from, { ...extra, game: id, nonce: msg.nonce });
      if (msg.v !== PROTOCOL) { reply({ type: 'reject', reason: 'That game is running a different version. Refresh the page and try again.' }); return; }
      const reason = opts.accept(str(msg.name, 14), from);
      if (reason) { reply({ type: 'reject', reason }); return; }
      try {
        const link = this.makeLink();
        const sdp = await link.answer(msg.sdp);
        await reply({ type: 'answer', sdp });
        link.ready.then(() => { if (!closed) opts.onPlayer(link, str(msg.name, 14), from); else link.close(); })
          .catch(e => { this.log(`player didn't connect: ${e.message}`); if (!closed) opts.onJoinFailed?.(str(msg.name, 14), e.message); });
      } catch (e) {
        this.log(`couldn't answer: ${e.message}`);
      }
    };
    this.signalHandlers.add(onOffer);

    let soon = null;
    return {
      id,
      invite: { host: this.keys.pubkey, id },
      /** Re-list now (debounced): the player count or settings changed. */
      update: () => { clearTimeout(soon); soon = setTimeout(publish, 1500); },
      close: async () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        clearTimeout(soon);
        who.close();
        this.signalHandlers.delete(onOffer);
        const at = Math.max(now(), said);
        this.closedAt.set(id, at);
        const gone = await signEvent({
          kind: KIND.app, content: JSON.stringify({ id, closed: true, v: PROTOCOL }), created_at: at,
          tags: [['d', `stick-soldiers/game/${id}`], ['t', TAG.game], ['expiration', String(now() + 60)]],
        }, this.keys);
        this.pool.publish(gone);
        this.announce({ type: 'closed', id }, at);
      },
    };
  }

  // ---- Joining ---------------------------------------------------------------------------

  /** Connect to a game ({ host, id }). Resolves with a link once connected, or rejects with a reason. */
  async join(game, name, { timeout = 12000 } = {}) {
    await this.pool.ready(1, 6000);
    if (!this.pool.connected) throw new Error("Couldn't reach the game servers (check your internet connection)");
    const link = this.makeLink();
    const nonce = randomId(6);
    const sdp = await link.createOffer();
    let handler;
    const answer = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No answer from that game (it may have just closed)')), timeout);
      handler = (msg, from) => {
        if (from !== game.host || msg.nonce !== nonce || msg.game !== game.id) return;
        clearTimeout(timer);
        if (msg.type === 'answer' && typeof msg.sdp === 'string') resolve(msg.sdp);
        else reject(new Error(str(msg.reason, 200) || "That game didn't let you in"));
      };
      this.signalHandlers.add(handler);
    });
    try {
      await this.signal(game.host, { type: 'offer', game: game.id, sdp, name: str(name, 14), v: PROTOCOL, nonce });
      await link.accept(await answer);
      await link.ready;
      return link;
    } catch (e) {
      link.close('failed');
      throw e;
    } finally {
      this.signalHandlers.delete(handler);
    }
  }

  /**
   * Quick match: join the best open game that has room (rankGames: the nearest, of the mode
   * asked for if one is, the fullest; trying a few), or resolve null if there isn't one.
   * onStatus(text) reports progress. prefs: { mode }.
   */
  async quickMatch(name, onStatus = () => {}, prefs = {}) {
    onStatus('Looking for games…');
    await this.pool.ready(1, 6000);
    if (!this.pool.connected) throw new Error("Couldn't reach the game servers (check your internet connection)");
    const list = rankGames(await this.listGames(3000), prefs);
    for (const g of list.slice(0, 4)) {
      onStatus(`Joining ${g.name}…`);
      try { return { link: await this.join(g, name), game: g }; }
      catch (e) { this.log(`quick match: ${g.name}: ${e.message}`); }
    }
    return null;
  }

  close() { this.pool.close(); }
}

/** An invite link's part after `#join=`. */
export const inviteCode = ({ host, id }) => `${host}.${id}`;
export function parseInvite(code) {
  const m = /^([0-9a-f]{64})\.([0-9a-f]{4,32})$/.exec(String(code || '').trim());
  return m ? { host: m[1], id: m[2] } : null;
}
