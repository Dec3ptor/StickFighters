// Community maps: maps players upload for everyone, kept on public Nostr relays.
// Each upload is a replaceable event, so uploading the same map again updates
// it, and its owner can take it down.

import { RelayPool, signEvent, now, randomId } from './nostr.js';
import { COMMUNITY_RELAYS, KIND, TAG, relaysFor } from './relays.js';
import { encodeShare, decodeShare } from '../custommaps.js';
import { loadKeys } from './lobby.js';

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);

export class Community {
  constructor({ relays = relaysFor(COMMUNITY_RELAYS), keys = loadKeys(), log = () => {} } = {}) {
    this.keys = keys;
    this.pool = new RelayPool(relays, { log });
  }

  /** The latest community maps: [{ key, d, author, name, code, pubkey, created, mine }], newest first. */
  async list(limit = 300) {
    await this.pool.ready(1, 6000);
    const events = await this.pool.query({ kinds: [KIND.app], '#t': [TAG.map], limit }, 6000);
    const newest = new Map();
    for (const ev of events) {
      const d = (ev.tags.find(t => t[0] === 'd') || [])[1];
      if (!d) continue;
      const key = `${ev.pubkey}:${d}`;
      if (!newest.has(key) || newest.get(key).created_at < ev.created_at) newest.set(key, ev);
    }
    const out = [];
    for (const [key, ev] of newest) {
      let c;
      try { c = JSON.parse(ev.content); } catch { continue; }
      if (!c || c.deleted || typeof c.code !== 'string' || c.code.length > 60000) continue;
      out.push({
        key, d: (ev.tags.find(t => t[0] === 'd') || [])[1], pubkey: ev.pubkey, created: ev.created_at,
        name: str(c.name, 32) || 'Untitled map', author: str(c.author, 14) || 'Someone', code: c.code,
        mine: ev.pubkey === this.keys.pubkey,
      });
    }
    return out.sort((a, b) => b.created - a.created);
  }

  /** Decode a listed map (checks it the same way as any shared map). */
  load(entry) { return decodeShare(entry.code); }

  /**
   * Upload a map. `slot` is the id this browser uses for it (uploading again with the same slot replaces it).
   * Resolves with { slot, relays: number that accepted it }.
   */
  async publish(map, author, slot = randomId(8)) {
    await this.pool.ready(1, 6000);
    if (!this.pool.connected) throw new Error("Couldn't reach the map servers (check your internet connection)");
    const code = await encodeShare(map);
    const ev = await signEvent({
      kind: KIND.app,
      tags: [['d', `stick-soldiers/map/${slot}`], ['t', TAG.map]],
      content: JSON.stringify({ v: 1, name: str(map.name, 32), author: str(author, 14), code }),
    }, this.keys);
    const res = await this.pool.publish(ev, 6000);
    if (!res.ok.length) throw new Error(res.failed[0]?.message || 'No server accepted the map');
    return { slot, relays: res.ok.length };
  }

  /** Take down one of your uploads. */
  async remove(entry) {
    if (entry.pubkey !== this.keys.pubkey) throw new Error('You can only remove your own maps');
    const ev = await signEvent({ kind: KIND.app, tags: [['d', entry.d], ['t', TAG.map]], content: JSON.stringify({ v: 1, deleted: true }), created_at: now() }, this.keys);
    return this.pool.publish(ev);
  }

  close() { this.pool.close(); }
}
