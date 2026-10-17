// Finding games, joining, and community maps, through a real (local) Nostr relay.
// WebRTC isn't available in Node, so links are faked; everything that goes
// through the relays (listings, sealed offers and answers) is real.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startRelay } from '../tools/relay.mjs';
import { Lobby, parseInvite, inviteCode } from '../web/src/net/lobby.js';
import { Community } from '../web/src/net/community.js';
import { makeKeys, randomId } from '../web/src/net/nostr.js';
import { PROTOCOL } from '../web/src/net/protocol.js';
import { KIND } from '../web/src/net/relays.js';
import { loadMap } from './helpers.mjs';

const registry = new Map();
class FakeLink {
  constructor() {
    this.onmessage = () => {}; this.onclose = () => {}; this.closed = false;
    this.ready = new Promise((resolve, reject) => { this.connected = resolve; this.failed = reject; });
    this.ready.catch(() => {});
  }
  async createOffer() { const id = randomId(); registry.set(id, this); return `offer:${id}`; }
  async answer(sdp) { this.peer = registry.get(sdp.slice(6)); const id = randomId(); registry.set(id, this); return `answer:${id}`; }
  async accept(sdp) { const other = registry.get(sdp.slice(7)); this.peer = other; other.peer = this; this.connected(this); other.connected(other); }
  send(data, reliable = true) { if (this.closed || !this.peer) return false; const copy = JSON.parse(JSON.stringify(data)); queueMicrotask(() => this.peer.onmessage(copy, reliable)); return true; }
  close(reason) { if (this.closed) return; this.closed = true; this.onclose(reason); this.peer?.close('closed by the other side'); }
}

let relay;
before(async () => { relay = await startRelay(); });
after(async () => { await relay.close(); });

const wait = ms => new Promise(r => setTimeout(r, ms));
const lobby = () => new Lobby({ relays: [relay.url], keys: makeKeys(), makeLink: () => new FakeLink() });

function hostGame(l, { full = false, players = 1 } = {}) {
  const joined = [];
  const handle = l.host({
    info: () => ({ name: 'Friday frags', hostName: 'Hosty', mapName: 'Fire in the Hole', mode: 'ffa', players, max: 8, bots: 4 }),
    accept: name => (full ? 'That game is full' : null),
    onPlayer: (link, name) => { joined.push({ link, name }); link.onmessage = m => { if (m.t === 'hi') link.send({ t: 'hello back', to: name }); }; },
  });
  return { handle, joined };
}

test('hosted games show up in the server browser, and vanish when closed', async () => {
  const host = lobby(), browser = lobby();
  const { handle } = hostGame(host);
  let list = [];
  const w = browser.watch(l => { list = l; });
  for (let i = 0; i < 40 && !list.length; i++) await wait(100);
  assert.equal(list.length, 1, 'game listed');
  assert.equal(list[0].name, 'Friday frags');
  assert.equal(list[0].hostName, 'Hosty');
  assert.equal(list[0].version, PROTOCOL);
  assert.equal(list[0].host, host.keys.pubkey);
  await handle.close();
  for (let i = 0; i < 40 && list.length; i++) await wait(100);
  assert.equal(list.length, 0, 'gone after closing');
  w.stop(); host.close(); browser.close();
});

test('an old listing arriving after a game closed does not bring it back', async () => {
  const host = lobby(), browser = lobby();
  const { handle } = hostGame(host);
  let list = [];
  const w = browser.watch(l => { list = l; });
  for (let i = 0; i < 40 && !list.length; i++) await wait(100);
  assert.equal(list.length, 1);
  // Grab the open listing as a relay that hasn't heard about the close would have it.
  const stale = relay.stored.find(e => e.kind === KIND.app && e.pubkey === host.keys.pubkey);
  await handle.close();
  for (let i = 0; i < 40 && list.length; i++) await wait(100);
  assert.equal(list.length, 0);
  // A second relay (simulated) sends the old listing again.
  const fake = await startRelay();
  fake.stored.push(stale);
  const late = new Lobby({ relays: [relay.url, fake.url], keys: makeKeys(), makeLink: () => new FakeLink() });
  let list2 = [];
  const w2 = late.watch(l => { list2 = l; });
  await wait(1500);
  assert.equal(list2.length, 0, 'stale listing ignored');
  w.stop(); w2.stop(); host.close(); browser.close(); late.close(); await fake.close();
});

test('a player can join through the relay: sealed offer, answer, connected', async () => {
  const host = lobby(), player = lobby();
  const { handle, joined } = hostGame(host);
  await wait(300);
  const link = await player.join(handle.invite, 'Joiner');
  for (let i = 0; i < 20 && !joined.length; i++) await wait(50);
  assert.equal(joined.length, 1);
  assert.equal(joined[0].name, 'Joiner');
  const reply = new Promise(r => { link.onmessage = m => r(m); });
  link.send({ t: 'hi' });
  assert.deepEqual(await reply, { t: 'hello back', to: 'Joiner' });
  // The offer travelled through the relay sealed: nobody else can read it.
  const offers = relay.stored.filter(e => e.kind === KIND.signal);
  assert.equal(offers.length, 0, 'connection offers are not stored by the relay');
  await handle.close(); host.close(); player.close();
});

test('a full game turns players away with a reason', async () => {
  const host = lobby(), player = lobby();
  const { handle } = hostGame(host, { full: true });
  await wait(300);
  await assert.rejects(player.join(handle.invite, 'Late'), /full/);
  await handle.close(); host.close(); player.close();
});

test('quick match finds an open game, or says there is none', async () => {
  const empty = lobby();
  assert.equal(await empty.quickMatch('Solo'), null);
  empty.close();
  const host = lobby(), player = lobby();
  const { handle, joined } = hostGame(host);
  await wait(500);
  const res = await player.quickMatch('Quick');
  assert.ok(res && res.link, 'joined');
  assert.equal(res.game.name, 'Friday frags');
  for (let i = 0; i < 20 && !joined.length; i++) await wait(50);
  assert.equal(joined.length, 1);
  await handle.close(); host.close(); player.close();
});

test('invite links name the host and the game', () => {
  const inv = { host: 'a'.repeat(64), id: 'abc123' };
  assert.deepEqual(parseInvite(inviteCode(inv)), inv);
  assert.equal(parseInvite('nonsense'), null);
  assert.equal(parseInvite(`${'g'.repeat(64)}.abc`), null);
});

test('community maps: upload, browse, load, and take down your own', async () => {
  const me = new Community({ relays: [relay.url], keys: makeKeys() });
  const someoneElse = new Community({ relays: [relay.url], keys: makeKeys() });
  const map = { ...loadMap('ssdm2.json'), name: 'Community Habitat' };
  const { slot, relays } = await me.publish(map, 'Mapper');
  assert.equal(relays, 1);
  const list = await someoneElse.list();
  const entry = list.find(e => e.name === 'Community Habitat');
  assert.ok(entry, 'listed for others');
  assert.equal(entry.author, 'Mapper');
  assert.equal(entry.mine, false);
  const loaded = await someoneElse.load(entry);
  assert.equal(loaded.platforms.length, map.platforms.length);
  await assert.rejects(someoneElse.remove(entry), /own maps/);
  // Uploading again with the same slot replaces it.
  await me.publish({ ...map, name: 'Community Habitat v2' }, 'Mapper', slot);
  const again = await someoneElse.list();
  assert.ok(again.some(e => e.name === 'Community Habitat v2') && !again.some(e => e.name === 'Community Habitat'));
  const mine = (await me.list()).find(e => e.mine);
  await me.remove(mine);
  assert.ok(!(await someoneElse.list()).some(e => e.name.startsWith('Community Habitat')), 'taken down');
  me.close(); someoneElse.close();
});
