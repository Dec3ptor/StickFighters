// Tests public Nostr relays for what online play needs, so the game can use the ones that work.
// Usage: node tools/probe-relays.mjs [relay ...]   (writes a table to $GITHUB_STEP_SUMMARY when set)
//
// For each relay it checks:
//   connect   - opens a WebSocket
//   live      - a temporary (ephemeral) event reaches another connection, matched by tag (finding games, connecting)
//   direct    - same, matched by recipient key (#p) (connection offers between two players)
//   stored    - a stored, replaceable event can be read back later (game listings, community maps)
//   big       - a 24 KB stored event is accepted (large community maps)
import fs from 'node:fs';
import { RelayPool, makeKeys, signEvent, now, randomId } from '../web/src/net/nostr.js';
import { RELAYS, COMMUNITY_RELAYS, KIND } from '../web/src/net/relays.js';

const CANDIDATES = [...new Set([
  ...RELAYS, ...COMMUNITY_RELAYS,
  // From the Trystero library's tested list, plus large general relays.
  'wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.primal.net', 'wss://relay.nostr.band', 'wss://nostr.mom',
  'wss://relay.snort.social', 'wss://offchain.pub', 'wss://nostr.oxtr.dev', 'wss://relay.nostr.bg', 'wss://nostr-pub.wellorder.net',
  'wss://relay.mostr.pub', 'wss://relay.nos.social', 'wss://nostr.bitcoiner.social', 'wss://relay.0xchat.com', 'wss://nostr21.com',
  'wss://yabu.me', 'wss://nostr.data.haus', 'wss://relay.nostr.wirednet.jp', 'wss://nostr.einundzwanzig.space', 'wss://relay.lexingtonbitcoin.org',
  'wss://0x-nostr-relay.fly.dev', 'wss://cdn.satellite.earth', 'wss://nostr.chaima.info', 'wss://nostr.christiansass.de', 'wss://nostr.rblb.it',
  'wss://nostr.red5d.dev', 'wss://nostr.robosats.org', 'wss://nostr.stakey.net', 'wss://nostrcity-club.fly.dev', 'wss://relay-dev.gulugulu.moe',
  'wss://relay.aarpia.com', 'wss://relay.agentry.com', 'wss://relay.bitmacro.cloud', 'wss://relay.bullishbounty.com', 'wss://relay.degmods.com',
  'wss://relay.flashapp.me', 'wss://relay.grigic.org', 'wss://relay.hackshed.dev', 'wss://relay.kaleidoswap.com', 'wss://relay.layer.systems',
  'wss://relay.nostr.blockhenge.com', 'wss://relay.nostr.dev.br', 'wss://relay.nostrmap.net', 'wss://relay.novospes.com', 'wss://relay.piazza.today',
  'wss://relay.routstr.com', 'wss://testr.nymble.world', 'wss://bendernostur.duckdns.org:8443',
])];

const urls = process.argv.slice(2).length ? process.argv.slice(2) : CANDIDATES;
const wait = ms => new Promise(r => setTimeout(r, ms));
const timed = (p, ms) => Promise.race([p, wait(ms).then(() => null)]);

async function probe(url) {
  const r = { url, connect: null, live: null, direct: null, stored: null, big: null, notes: [] };
  const log = m => r.notes.push(m.replace(/^relay \S+ /, ''));
  const a = new RelayPool([url], { log }), b = new RelayPool([url], { log });
  const ka = makeKeys(), kb = makeKeys();
  try {
    const t0 = Date.now();
    if (!(await a.ready(1, 8000)) || !(await b.ready(1, 8000))) { r.notes.push('could not connect'); return r; }
    r.connect = Date.now() - t0;

    // Live (ephemeral) event matched by #x tag.
    const tag = 'stick-soldiers-probe-' + randomId(4);
    let got = null, t1 = 0;
    const sub = a.subscribe({ kinds: [KIND.lobby], '#x': [tag], since: now() - 10 }, () => { got ??= Date.now() - t1; });
    await wait(600);
    t1 = Date.now();
    const ev = await signEvent({ kind: KIND.lobby, tags: [['x', tag]], content: 'probe' }, kb);
    const pub = await b.publish(ev);
    for (let i = 0; i < 40 && got === null; i++) await wait(100);
    sub.close();
    r.live = got;
    if (pub.failed.length) log('live rejected: ' + pub.failed[0].message);

    // Live event to a recipient key (#p).
    got = null;
    let t2 = 0;
    const sub2 = a.subscribe({ kinds: [KIND.signal], '#p': [ka.pubkey], since: now() - 10 }, () => { got ??= Date.now() - t2; });
    await wait(600);
    t2 = Date.now();
    const pub2 = await b.publish(await signEvent({ kind: KIND.signal, tags: [['p', ka.pubkey]], content: 'probe' }, kb));
    for (let i = 0; i < 40 && got === null; i++) await wait(100);
    sub2.close();
    r.direct = got;
    if (pub2.failed.length) log('direct rejected: ' + pub2.failed[0].message);

    // Stored replaceable event, read back on a fresh connection by #t and #d.
    const d = 'stick-soldiers/probe/' + randomId(4);
    const stored = await signEvent({ kind: KIND.app, tags: [['d', d], ['t', 'stick-soldiers-probe'], ['expiration', String(now() + 3600)]], content: JSON.stringify({ probe: true }) }, kb);
    const pub3 = await b.publish(stored);
    if (pub3.failed.length) log('stored rejected: ' + pub3.failed[0].message);
    await wait(800);
    const c = new RelayPool([url], { log });
    if (await c.ready(1, 8000)) {
      const t3 = Date.now();
      const found = await c.query({ kinds: [KIND.app], '#t': ['stick-soldiers-probe'], '#d': [d] }, 5000);
      r.stored = found.some(e => e.id === stored.id) ? Date.now() - t3 : null;
    }
    c.close();

    // A big stored event.
    const big = await signEvent({ kind: KIND.app, tags: [['d', d + '-big'], ['t', 'stick-soldiers-probe'], ['expiration', String(now() + 3600)]], content: 'x'.repeat(24000) }, kb);
    const pub4 = await b.publish(big);
    r.big = pub4.ok.length > 0;
    if (pub4.failed.length) log('big rejected: ' + pub4.failed[0].message);
  } catch (e) {
    r.notes.push('error: ' + e.message);
  } finally {
    a.close(); b.close();
  }
  return r;
}

const results = await Promise.all(urls.map(u => timed(probe(u), 45000).then(r => r || { url: u, notes: ['timed out'] })));
const score = r => (r.live != null) * 4 + (r.direct != null) * 4 + (r.stored != null) * 2 + (r.big ? 1 : 0) - (r.live ?? 3000) / 3000;
results.sort((x, y) => score(y) - score(x));

const cell = v => v == null ? '✗' : v === true ? '✓' : v === false ? '✗' : `${v} ms`;
const lines = ['| Relay | Connect | Live | Direct | Stored | 24 KB | Notes |', '|---|---|---|---|---|---|---|'];
for (const r of results) lines.push(`| ${r.url} | ${cell(r.connect)} | ${cell(r.live)} | ${cell(r.direct)} | ${cell(r.stored)} | ${cell(r.big)} | ${(r.notes || []).slice(0, 2).join('; ').replace(/\|/g, '/').slice(0, 120)} |`);
const table = lines.join('\n');
console.log(table);
console.log('\nJSON ' + JSON.stringify(results));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Nostr relay probe\n\n' + table + '\n');
process.exit(0);
