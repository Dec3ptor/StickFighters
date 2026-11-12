// Getting into games and staying in them: which game a quick match picks, a game id that stays
// the same (and what it becomes when the game changes hands), relay servers read from turn.json,
// why a connection couldn't be made; and what happens when a connection drops or the host goes:
// back in with what you had, or on under another player with the scores where they were.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { NetHost } from '../web/src/net/host.js';
import { NetClient } from '../web/src/net/client.js';
import { rankGames, nextGameId, loadGameId, parseListing, parseInvite, inviteCode } from '../web/src/net/lobby.js';
import { readIceConfig, loadIceServers, iceServers, hasRelay, whyNoConnection, ICE_SERVERS } from '../web/src/net/relays.js';
import { addressKinds } from '../web/src/net/peer.js';
import { PROTOCOL } from '../web/src/net/protocol.js';

// ---- Finding a game ------------------------------------------------------------------------------------

const listed = (over = {}) => ({ key: Math.random().toString(16), id: 'abc123', host: 'h', name: 'Game', mode: 'ffa', players: 2, max: 8, bots: 0, version: PROTOCOL, zone: 0, closed: false, seen: 100, ...over });

test('quick match: open matches only, the nearest first, then the fullest (the mode asked for a little ahead)', () => {
  const games = [
    listed({ name: 'world', mode: 'world', players: 5 }),
    listed({ name: 'full', players: 8 }),
    listed({ name: 'old', version: PROTOCOL - 1, players: 6 }),
    listed({ name: 'closed', closed: true }),
    listed({ name: 'far-full', zone: 10, players: 7 }),
    listed({ name: 'near-small', zone: 1, players: 1 }),
    listed({ name: 'near-big', zone: -2, players: 4, mode: 'team' }),
    listed({ name: 'mid', zone: 6, players: 6 }),
    listed({ name: 'unknown', zone: null, players: 7 }),
  ];
  const names = prefs => rankGames(games, { zone: 0, ...prefs }).map(g => g.name);
  assert.deepEqual(names({}), ['near-big', 'near-small', 'unknown', 'mid', 'far-full']);
  // (The mode asked for: ahead of another about as full, not of one much fuller.)
  const two = [listed({ name: 'a', players: 3, mode: 'team' }), listed({ name: 'b', players: 2, mode: 'ctf' }), listed({ name: 'c', players: 6, mode: 'ffa' })];
  assert.deepEqual(rankGames(two, { zone: 0, mode: 'ctf' }).map(g => g.name), ['c', 'b', 'a']);
  // (Half the world away is still the far side whichever way round: UTC+11 and UTC-11 are 2 hours apart.)
  assert.deepEqual(rankGames([listed({ name: 'x', zone: -11, players: 1 }), listed({ name: 'y', zone: 3, players: 6 })], { zone: 11 }).map(g => g.name), ['x', 'y']);
  // (Where we are not known: the fullest.)
  assert.equal(rankGames(games, { zone: null })[0].name, 'far-full');
});

test('a listing says roughly where its host is (if it does), within reason', () => {
  const ev = { pubkey: 'p'.repeat(64), created_at: 5 };
  assert.equal(parseListing(ev, { id: 'abc123', tz: -5 }).zone, -5);
  assert.equal(parseListing(ev, { id: 'abc123' }).zone, null);
  assert.equal(parseListing(ev, { id: 'abc123', tz: 99 }).zone, 14);
  assert.equal(parseListing(ev, { id: 'abc123', tz: 'x' }).zone, null);
});

test('a game\'s id: one of this browser\'s own; the next one along when the game changes hands; still an invite', () => {
  assert.match(loadGameId(), /^[0-9a-f]{4,32}$/);
  assert.equal(nextGameId('abc123'), 'abc124');
  assert.equal(nextGameId('abc12f'), 'abc120');
  assert.notEqual(nextGameId('0000'), '0000');
  const host = 'a'.repeat(64);
  assert.deepEqual(parseInvite(inviteCode({ host, id: nextGameId('abc12f') })), { host, id: 'abc120' });
});

// ---- Relay servers ---------------------------------------------------------------------------------------

test('turn.json: relay servers as their provider gives them; anything else left out', async () => {
  assert.deepEqual(readIceConfig([]), []);
  assert.deepEqual(readIceConfig(null), []);
  assert.deepEqual(readIceConfig('turn:evil'), []);
  const one = { urls: 'turn:relay.example.com:3478', username: 'u', credential: 'c' };
  assert.deepEqual(readIceConfig([one]), [one]);
  assert.deepEqual(readIceConfig({ servers: [one] }), [one]);
  assert.deepEqual(readIceConfig({ iceServers: [{ urls: ['turns:a.example:443?transport=tcp', 'http://nope', 5], username: 'u', credential: 'c', extra: 1 }] }),
    [{ urls: 'turns:a.example:443?transport=tcp', username: 'u', credential: 'c' }]);
  assert.deepEqual(readIceConfig([{ urls: 'javascript:alert(1)' }, { url: 'stun:s.example:3478' }, 7, null]), [{ urls: 'stun:s.example:3478' }]);

  // None set up: the public servers only, and no relay.
  assert.deepEqual(await loadIceServers(async () => []), ICE_SERVERS);
  assert.equal(hasRelay(), false);
  // The file's own, and those an address in it gives (a provider's short-lived passwords).
  const asked = [];
  const get = async url => { asked.push(url); return url === 'turn.json' ? { servers: [one], fetch: 'https://api.example/creds' } : [{ urls: 'turn:b.example:80', username: 'x', credential: 'y' }]; };
  const all = await loadIceServers(get);
  assert.deepEqual(asked, ['turn.json', 'https://api.example/creds']);
  assert.equal(all.length, ICE_SERVERS.length + 2);
  assert.deepEqual(iceServers().slice(-2).map(s => s.urls), ['turn:relay.example.com:3478', 'turn:b.example:80']);
  assert.equal(hasRelay(), true);
  // (An address that isn't https isn't asked. The file missing: as before.)
  asked.length = 0;
  await loadIceServers(async url => { asked.push(url); return { fetch: 'http://plain.example/creds' }; });
  assert.deepEqual(asked, ['turn.json']);
  assert.equal(hasRelay(), false);
  await loadIceServers(async () => { throw new Error('404'); });
  assert.deepEqual(iceServers(), ICE_SERVERS);
});

test('why a connection couldn\'t be made, as well as this side can tell', () => {
  const sdp = 'a=candidate:1 1 udp 2113937151 192.168.1.2 5000 typ host generation 0\r\na=candidate:2 1 udp 1677729535 1.2.3.4 5000 typ srflx raddr 0.0.0.0 rport 0\r\n';
  assert.deepEqual(addressKinds(sdp), { host: 1, srflx: 1, relay: 0 });
  assert.deepEqual(addressKinds('a=candidate:3 1 udp 1 5.6.7.8 9 typ relay raddr 1.2.3.4 rport 5\r\n'), { host: 0, srflx: 0, relay: 1 });
  assert.deepEqual(addressKinds(''), { host: 0, srflx: 0, relay: 0 });
  // This network lets nothing out: say so, and what to try.
  assert.match(whyNoConnection({ host: 2, srflx: 0, relay: 0 }, false), /this network blocks/);
  // It did its part: the two couldn't meet.
  assert.match(whyNoConnection({ host: 1, srflx: 1, relay: 0 }, false), /couldn't reach each other directly/);
  assert.match(whyNoConnection({ host: 1, srflx: 1, relay: 1 }, true), /even through the relay server/);
});

// ---- Dropping out and coming back; the host going ---------------------------------------------------------

const FLAT = { name: 'flat', bounds: { left: -600, top: -600, right: 1600, bottom: 200 }, items: [],
  spawns: [{ x: 0, y: -12, team: 1 }, { x: 400, y: -12, team: 2 }, { x: 800, y: -12, team: 1 }, { x: 1200, y: -12, team: 2 }], platforms: [{ left: -600, top: 0, right: 1600, bottom: 40 }] };
const STILL = { input: () => ({ move: 0 }) };
const fakeLink = () => ({ sent: [], closed: false, send(d) { this.sent.push(d); return true; }, close() { this.closed = true; this.onclose?.(); } });
const newGame = (mode = 'team', seed = 9) => new Game({ mapData: FLAT, effects: false, seed, speed: DEFAULT_SPEED, mode, fragLimit: 999 });
function hosted({ mode = 'team', botCount = 2, maxPlayers = 8, setup = null } = {}) {
  const g = newGame(mode);
  const addBot = game => {
    const n = t => game.soldiers.filter(s => s.team === t && !s.spectating).length;
    const names = ['Grunt', 'Sarge', 'Ranger', 'Ghost', 'Viper'], used = new Set(game.soldiers.map(s => s.name));
    game.addSoldier({ name: names.find(x => !used.has(x)) || `Bot${game.soldiers.length}`, isBot: true, team: game.rules.teams ? (n(1) <= n(2) ? 1 : 2) : 0 }, STILL);
  };
  const host = new NetHost({ maxPlayers, botCount, addBot, setup: setup ? () => setup : undefined, matchInfo: () => ({ mode, fragLimit: 999, options: g.options, speed: DEFAULT_SPEED, map: { builtin: 'x' }, mapName: 'flat' }) });
  const me = g.addSoldier({ name: 'Host', isBot: false, team: g.rules.teams ? 1 : 0 }, STILL);
  host.setGame(g);
  return { g, host, me, addBot };
}
const join = (h, name, key) => { const link = fakeLink(); const p = h.host.addPlayer(link, name, key); link.onmessage({ t: 'ready' }, true); return { link, p }; };
const last = (link, t) => link.sent.filter(m => m && m.t === t).at(-1);

test('a player who drops out and comes back in the same match has what they had: their side and their scores', () => {
  const h = hosted();
  const a = join(h, 'Ann', 'key-a');
  a.p.soldier.frags = 7; a.p.soldier.deaths = 3; a.p.soldier.points = 40;
  const side = a.p.soldier.team;
  a.link.close();
  assert.ok(!h.g.soldiers.some(s => s.name === 'Ann'));
  // (Someone else, meanwhile, takes nothing of theirs.)
  const b = join(h, 'Bob', 'key-b');
  assert.equal(b.p.soldier.frags, 0);
  const again = join(h, 'Ann', 'key-a');
  assert.equal(again.p.soldier.frags, 7);
  assert.equal(again.p.soldier.deaths, 3);
  assert.equal(again.p.soldier.points, 40);
  assert.equal(again.p.soldier.team, side);
  // (Once: leaving and coming back again starts from what they have then.)
  again.p.soldier.frags = 9;
  again.link.close();
  assert.equal(join(h, 'Ann', 'key-a').p.soldier.frags, 9);
});

test('not into the next match; not someone the host sent away; not by name alone', () => {
  const h = hosted();
  const a = join(h, 'Ann', 'key-a');
  a.p.soldier.frags = 7;
  a.link.close();
  // (The same name from someone else: not theirs.)
  assert.equal(join(h, 'Ann', 'key-z').p.soldier.frags, 0);
  const g2 = newGame('team', 10);
  g2.addSoldier({ name: 'Host', isBot: false, team: 1 }, STILL);
  h.host.setGame(g2);
  assert.equal(join(h, 'Ann', 'key-a').p.soldier.frags, 0, 'a new match: from nothing');
  const c = join(h, 'Cat', 'key-c');
  c.p.soldier.frags = 4;
  h.host.kick(c.p.soldier.id);
  assert.ok(!h.host.kept.has('key-c'), 'nothing kept for someone sent away');
});

test('who takes over if the host goes: the player with a good connection who\'s been here longest; everyone\'s told', () => {
  const h = hosted({ setup: { bots: 2, maxPlayers: 8 } });
  assert.equal(h.host.pickHeir(), null, 'nobody there: nobody');
  const a = join(h, 'Ann', 'key-a');
  a.p.joined = 1000;
  assert.deepEqual(h.host.heir, { key: 'key-a', name: 'Ann' });
  assert.deepEqual(last(a.link, 'heir').heir, { key: 'key-a', name: 'Ann' });
  const b = join(h, 'Bob', 'key-b');
  b.p.joined = 2000;
  // (Told in their welcome, with the game as it's set up.)
  const w = b.link.sent.find(m => m && m.t === 'welcome');
  assert.deepEqual(w.heir, { key: 'key-a', name: 'Ann' });
  assert.deepEqual(w.setup, { bots: 2, maxPlayers: 8 });
  assert.equal(h.host.pickHeir().key, 'key-a', 'here longest');
  // A bad connection: the next one.
  a.p.ping = 400; b.p.ping = 60;
  assert.equal(h.host.pickHeir().key, 'key-b');
  assert.deepEqual(last(a.link, 'heir').heir, { key: 'key-b', name: 'Bob' });
  // Away, or gone: not them.
  a.p.ping = 50; b.p.ping = 60;
  assert.equal(h.host.pickHeir().key, 'key-a');
  a.p.afk = true;
  assert.equal(h.host.pickHeir().key, 'key-b');
  b.link.close();
  assert.equal(h.host.heir, null, 'only someone away left: nobody');
  // (Not said again while it's the same.)
  const n = a.link.sent.filter(m => m && m.t === 'heir').length;
  h.host.pickHeir(); h.host.pickHeir();
  assert.equal(a.link.sent.filter(m => m && m.t === 'heir').length, n);
});

test('the host going: ended for everyone, or left to carry on; a player hears which', () => {
  const h = hosted();
  const a = join(h, 'Ann', 'key-a'), b = join(h, 'Bob', 'key-b');
  h.host.close();
  assert.deepEqual(last(a.link, 'end'), { t: 'end', reason: 'The host left the game', over: false });
  const h2 = hosted();
  const c = join(h2, 'Cat', 'key-c');
  h2.host.close('The host ended the game', { over: true });
  assert.equal(last(c.link, 'end').over, true);
  assert.ok(b);

  // A player's side of it: how it ended.
  const ends = [];
  const client = () => { const link = fakeLink(); const c2 = new NetClient({ link, controller: STILL, loadMap: async () => FLAT, onEnd: (reason, how) => ends.push({ reason, how }) }); return { link, c: c2 }; };
  const x = client();
  x.c.receive({ t: 'heir', heir: { key: 'k', name: 'Ann' } }, true);
  assert.deepEqual(x.c.heir, { key: 'k', name: 'Ann' });
  x.c.receive({ t: 'heir', heir: null }, true);
  assert.equal(x.c.heir, null);
  x.c.receive({ t: 'end', reason: 'The host left the game', over: false }, true);
  const y = client();
  y.c.receive({ t: 'end', reason: 'The host ended the game', over: true }, true);
  const z = client();
  z.link.onclose();
  const w = client();
  w.c.leave();
  assert.deepEqual(ends.map(e => e.how), [{ over: false, left: true }, { over: true, left: true }, { lost: true }, null]);
});

test('a game taken over from a host who left: everyone has what they had, as they arrive; the bots and the new host too', () => {
  const standing = [
    { name: 'Ann', team: 2, frags: 6, deaths: 2, points: 10, isBot: false },
    { name: 'Bob', team: 1, frags: 3, deaths: 5, points: 0, isBot: false },
    { name: 'Grunt', team: 2, frags: 4, deaths: 4, points: 0, isBot: true },
    { name: 'Host', team: 1, frags: 9, deaths: 1, points: 5, isBot: false },   // (the new host, under the name they had)
  ];
  const g = newGame('team');
  const names = ['Grunt', 'Sarge'];
  const host = new NetHost({ maxPlayers: 8, botCount: 2, addBot: game => { const used = new Set(game.soldiers.map(s => s.name)); const n = t => game.soldiers.filter(s => s.team === t).length; game.addSoldier({ name: names.find(x => !used.has(x)), isBot: true, team: n(1) <= n(2) ? 1 : 2 }, STILL); },
    matchInfo: () => ({ mode: 'team', fragLimit: 999, options: g.options, speed: DEFAULT_SPEED, map: { builtin: 'x' }, mapName: 'flat' }) });
  const me = g.addSoldier({ name: 'Host', isBot: false, team: 1 }, STILL);
  host.carryOver(standing);
  host.setGame(g);
  assert.equal(me.frags, 9);
  assert.equal(me.deaths, 1);
  assert.equal(g.soldiers.find(s => s.name === 'Grunt').frags, 4, 'the bot of that name');
  assert.equal(g.soldiers.find(s => s.name === 'Sarge').frags, 0);
  const h = { host };
  const ann = join(h, 'Ann', 'new-key-a');
  assert.equal(ann.p.soldier.team, 2, 'on the side they were on');
  assert.equal(ann.p.soldier.frags, 6);
  assert.equal(ann.p.soldier.points, 10);
  // (Once each: a second Ann is someone new.)
  assert.equal(join(h, 'Ann', 'other').p.soldier.frags, 0);
  const bob = join(h, 'bob', 'new-key-b');
  assert.equal(bob.p.soldier.frags, 3, 'whatever the capitals');
  assert.equal(bob.p.soldier.team, 1);
  // The next match: nothing carried.
  const g2 = newGame('team', 11);
  g2.addSoldier({ name: 'Host', isBot: false, team: 1 }, STILL);
  host.setGame(g2);
  assert.ok(g2.soldiers.every(s => s.frags === 0));
  assert.equal(host.carried, null);
});

test('carried on in a mode that starts again: the sides kept, the scores not; gun game\'s weapons and lives kept', () => {
  const g = newGame('team');
  const host = new NetHost({ maxPlayers: 8, botCount: 0, addBot: () => {}, matchInfo: () => ({ mode: 'team', fragLimit: 999, options: g.options, speed: DEFAULT_SPEED, map: { builtin: 'x' }, mapName: 'flat' }) });
  g.addSoldier({ name: 'Host', isBot: false, team: 1 }, STILL);
  host.carryOver([{ name: 'Ann', team: 2, frags: 6, deaths: 2 }, { name: 'Bob', team: 2, frags: 1, deaths: 1 }], { scores: false });
  host.setGame(g);
  const a = join({ host }, 'Ann', 'k1'), b = join({ host }, 'Bob', 'k2');
  assert.deepEqual([a.p.soldier.team, a.p.soldier.frags, b.p.soldier.team, b.p.soldier.frags], [2, 0, 2, 0]);

  const gg = newGame('gungame');
  const h2 = new NetHost({ maxPlayers: 8, botCount: 0, addBot: () => {}, matchInfo: () => ({ mode: 'gungame', fragLimit: 0, options: gg.options, speed: DEFAULT_SPEED, map: { builtin: 'x' }, mapName: 'flat' }) });
  gg.addSoldier({ name: 'Host', isBot: false, team: 0 }, STILL);
  h2.carryOver([{ name: 'Ann', team: 0, frags: 6, deaths: 2, level: 5 }, { name: 'Host', team: 0, frags: 2, deaths: 2, level: 3 }]);
  h2.setGame(gg);
  assert.equal(gg.soldiers[0].level, 3);
  const ann = join({ host: h2 }, 'Ann', 'k1');
  assert.equal(ann.p.soldier.level, 5);
  // (Too late: what was carried doesn't wait for ever.)
  const g3 = newGame('ffa');
  const h3 = new NetHost({ maxPlayers: 8, botCount: 0, addBot: () => {}, matchInfo: () => ({ mode: 'ffa', fragLimit: 99, options: g3.options, speed: DEFAULT_SPEED, map: { builtin: 'x' }, mapName: 'flat' }) });
  g3.addSoldier({ name: 'Host', isBot: false, team: 0 }, STILL);
  h3.carryOver([{ name: 'Ann', team: 0, frags: 6, deaths: 2 }], { now: Date.now() - 200000 });
  h3.setGame(g3);
  assert.equal(join({ host: h3 }, 'Ann', 'k1').p.soldier.frags, 0);
});

test('a player\'s own record of how the match stands, for carrying it on', async () => {
  const link = fakeLink();
  const c = new NetClient({ link, controller: STILL, loadMap: async () => FLAT });
  assert.equal(c.standing(), null);
  const h = hosted({ setup: { bots: 2 } });
  const a = join(h, 'Ann', 'key-a');
  const w = a.link.sent.find(m => m && m.t === 'welcome');
  await c.start(w);
  assert.deepEqual(c.setup, { bots: 2 });
  assert.equal(c.matchInfo.mode, 'team');
  assert.equal(c.mapData, FLAT);
  const s = c.game.soldiers.find(x => x.name === 'Host');
  s.frags = 5; c.game.teamScore[1] = 5; c.game.tick = 777;
  const st = c.standing();
  assert.equal(st.tick, 777);
  assert.deepEqual(st.teamScore, [0, 5, 0]);
  assert.deepEqual(st.soldiers.find(x => x.name === 'Host'), { name: 'Host', team: 1, frags: 5, deaths: 0, points: 0, level: undefined, lives: undefined, isBot: false });
  assert.equal(st.soldiers.length, c.game.soldiers.length);
  c.end(null);
});
