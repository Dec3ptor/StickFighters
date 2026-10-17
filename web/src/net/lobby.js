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

const LISTING_EVERY = 20000;  // ms between listing refreshes
const STALE_AFTER = 75;       // seconds without a refresh before a game drops off the list
const KEY_STORE = 'stick-soldiers-key';

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
  if (!data || typeof data !== 'object' || typeof data.id !== 'string' || !/^[0-9a-f]{4,32}$/.test(data.id)) return null;
  return {
    key: `${ev.pubkey}:${data.id}`,
    id: data.id,
    host: ev.pubkey,
    name: str(data.name, 40) || 'Online game',
    hostName: str(data.hostName, 14) || 'Someone',
    mapName: str(data.mapName, 40) || 'Unknown map',
    mode: ['ffa', 'team', 'gungame', 'oitc'].includes(data.mode) ? data.mode : 'ffa',
    players: int(data.players, 0, 64),
    max: int(data.max, 1, 64),
    bots: int(data.bots, 0, 64),
    version: int(data.v, 0, 1e6),
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

  async announce(msg) {
    const ev = await signEvent({ kind: KIND.lobby, tags: [['x', TAG.lobby]], content: JSON.stringify(msg) }, this.keys);
    return this.pool.publish(ev);
  }

  // ---- Server browser -------------------------------------------------------------------

  /** Keep an up-to-date list of open games. Calls onChange(list) as it changes. Returns { stop, refresh }. */
  watch(onChange) {
    const games = new Map();
    const emit = () => {
      const t = now();
      for (const [k, g] of games) if (g.closed || g.seen < t - STALE_AFTER) games.delete(k);
      onChange([...games.values()].sort((a, b) => (b.version === PROTOCOL) - (a.version === PROTOCOL) || b.players - a.players || b.seen - a.seen));
    };
    const add = (ev, data) => {
      const g = parseListing(ev, data);
      if (!g) return;
      const old = games.get(g.key);
      if (old && old.seen > g.seen) return;
      games.set(g.key, g);
      emit();
    };
    const subs = [
      this.pool.subscribe({ kinds: [KIND.app], '#t': [TAG.game], since: now() - 150 }, ev => { try { add(ev, JSON.parse(ev.content)); } catch { /* not ours */ } }),
      this.pool.subscribe({ kinds: [KIND.lobby], '#x': [TAG.lobby], since: now() - 10 }, ev => {
        try { const m = JSON.parse(ev.content); if (m.type === 'game') add(ev, m.game); else if (m.type === 'closed') { games.delete(`${ev.pubkey}:${m.id}`); emit(); } } catch { /* not ours */ }
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
   * opts: { info(): { name, hostName, mapName, mode, players, max, bots, private },
   *         accept(name): null to let them in, or a reason to turn them away,
   *         onPlayer(link, name) }
   */
  host(opts) {
    const id = randomId(6);
    let closed = false, lastAnswer = 0;
    const listing = () => ({ ...opts.info(), id, v: PROTOCOL });

    const publish = async () => {
      if (closed) return;
      const info = listing();
      if (info.private) return;
      const stored = await signEvent({
        kind: KIND.app, content: JSON.stringify(info),
        tags: [['d', `stick-soldiers/game/${id}`], ['t', TAG.game], ['expiration', String(now() + 150)]],
      }, this.keys);
      this.pool.publish(stored);
      this.announce({ type: 'game', game: info });
    };
    const timer = setInterval(publish, LISTING_EVERY);
    this.pool.ready(1, 5000).then(publish);

    const who = this.pool.subscribe({ kinds: [KIND.lobby], '#x': [TAG.lobby], since: now() }, ev => {
      try {
        if (JSON.parse(ev.content).type !== 'who' || Date.now() - lastAnswer < 2500) return;
        lastAnswer = Date.now();
        if (!listing().private) this.announce({ type: 'game', game: listing() });
      } catch { /* not ours */ }
    });

    const seen = new Set();
    const onOffer = async (msg, from) => {
      if (closed || msg.type !== 'offer' || msg.game !== id || typeof msg.sdp !== 'string' || seen.has(msg.nonce)) return;
      seen.add(msg.nonce);
      const reply = extra => this.signal(from, { ...extra, game: id, nonce: msg.nonce });
      if (msg.v !== PROTOCOL) { reply({ type: 'reject', reason: 'That game is running a different version. Refresh the page and try again.' }); return; }
      const reason = opts.accept(str(msg.name, 14));
      if (reason) { reply({ type: 'reject', reason }); return; }
      try {
        const link = this.makeLink();
        const sdp = await link.answer(msg.sdp);
        await reply({ type: 'answer', sdp });
        link.ready.then(() => { if (!closed) opts.onPlayer(link, str(msg.name, 14)); else link.close(); }).catch(e => this.log(`player didn't connect: ${e.message}`));
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
        const gone = await signEvent({
          kind: KIND.app, content: JSON.stringify({ id, closed: true, v: PROTOCOL }),
          tags: [['d', `stick-soldiers/game/${id}`], ['t', TAG.game], ['expiration', String(now() + 60)]],
        }, this.keys);
        this.pool.publish(gone);
        this.announce({ type: 'closed', id });
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
   * Quick match: join the fullest open game that has room (trying a few), or
   * resolve null if there isn't one. onStatus(text) reports progress.
   */
  async quickMatch(name, onStatus = () => {}) {
    onStatus('Looking for games…');
    await this.pool.ready(1, 6000);
    if (!this.pool.connected) throw new Error("Couldn't reach the game servers (check your internet connection)");
    const list = (await this.listGames(3000)).filter(g => g.version === PROTOCOL && !g.closed && g.players < g.max);
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
