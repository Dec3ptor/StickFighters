// A small Nostr relay for playing online locally and for tests (NIP-01 basics:
// stored, replaceable, parameterised-replaceable and ephemeral events; filters;
// NIP-40 expiration). Not for public use: everything is kept in memory.
//
//   node tools/relay.mjs            # ws://localhost:7447
//   then open the game with ?relay=ws://localhost:7447
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import { verifyEvent } from '../web/src/net/nostr.js';

const isEphemeral = k => k >= 20000 && k < 30000;
const isReplaceable = k => k === 0 || k === 3 || (k >= 10000 && k < 20000);
const isParamReplaceable = k => k >= 30000 && k < 40000;
const dTag = ev => (ev.tags.find(t => t[0] === 'd') || [])[1] || '';
const expired = (ev, t) => { const e = ev.tags.find(x => x[0] === 'expiration'); return e && +e[1] <= t; };

function matches(f, ev) {
  if (f.ids && !f.ids.includes(ev.id)) return false;
  if (f.authors && !f.authors.includes(ev.pubkey)) return false;
  if (f.kinds && !f.kinds.includes(ev.kind)) return false;
  if (f.since && ev.created_at < f.since) return false;
  if (f.until && ev.created_at > f.until) return false;
  for (const key of Object.keys(f)) {
    if (key[0] !== '#' || key.length !== 2) continue;
    const want = f[key];
    if (!ev.tags.some(t => t[0] === key[1] && want.includes(t[1]))) return false;
  }
  return true;
}

/** Start a relay. Options: { port, verify = true, delay = 0 (ms added to every message, to fake a slow network) }. */
export function startRelay({ port = 0, verify = true, delay = 0 } = {}) {
  const stored = [];
  const wss = new WebSocketServer({ port });
  const stats = { events: 0, rejected: 0 };
  const later = fn => (delay ? setTimeout(fn, delay) : fn());

  wss.on('connection', ws => {
    const subs = new Map();
    const send = msg => later(() => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); });
    ws.on('message', async raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return send(['NOTICE', 'invalid JSON']); }
      const [type, ...rest] = msg;
      if (type === 'EVENT') {
        const ev = rest[0];
        if (!ev || typeof ev.id !== 'string') return;
        if (verify && !(await verifyEvent(ev))) { stats.rejected++; return send(['OK', ev.id, false, 'invalid: bad signature']); }
        const t = Math.floor(Date.now() / 1000);
        if (expired(ev, t)) return send(['OK', ev.id, false, 'invalid: expired']);
        stats.events++;
        if (!isEphemeral(ev.kind)) {
          if (isReplaceable(ev.kind) || isParamReplaceable(ev.kind)) {
            const same = o => o.kind === ev.kind && o.pubkey === ev.pubkey && (!isParamReplaceable(ev.kind) || dTag(o) === dTag(ev));
            const old = stored.findIndex(same);
            if (old >= 0) {
              if (stored[old].created_at > ev.created_at) return send(['OK', ev.id, true, 'duplicate: newer version stored']);
              stored.splice(old, 1);
            }
          }
          if (!stored.some(o => o.id === ev.id)) stored.push(ev);
        }
        send(['OK', ev.id, true, '']);
        for (const client of wss.clients) client.emit('nostr-event', ev);
      } else if (type === 'REQ') {
        const [id, ...filters] = rest;
        subs.set(id, filters);
        const t = Math.floor(Date.now() / 1000);
        for (const f of filters) {
          let found = stored.filter(ev => !expired(ev, t) && matches(f, ev)).sort((a, b) => b.created_at - a.created_at);
          if (f.limit) found = found.slice(0, f.limit);
          for (const ev of found) send(['EVENT', id, ev]);
        }
        send(['EOSE', id]);
      } else if (type === 'CLOSE') {
        subs.delete(rest[0]);
      }
    });
    ws.on('nostr-event', ev => {
      for (const [id, filters] of subs) if (filters.some(f => matches(f, ev))) send(['EVENT', id, ev]);
    });
  });
  return new Promise(resolve => wss.on('listening', () => resolve({
    url: `ws://localhost:${wss.address().port}`,
    stats,
    stored,
    close: () => new Promise(r => { for (const c of wss.clients) c.terminate(); wss.close(r); }),
  })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const relay = await startRelay({ port: +(process.env.PORT || 7447) });
  console.log(`Nostr relay for local play at ${relay.url} (open the game with ?relay=${relay.url})`);
}
