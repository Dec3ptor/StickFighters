// Spectating (from the in-game menu): sitting out to watch, and joining again. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { NavGraph } from '../web/src/nav.js';
import { BotController, BOT_PROFILES } from '../web/src/bot.js';
import { NetHost } from '../web/src/net/host.js';
import { NetClient } from '../web/src/net/client.js';
import { memoryLinks } from '../web/src/net/peer.js';
import { damage } from '../web/src/combat.js';
import { DEFAULT_SPEED, RULES } from '../web/src/config.js';
import { makeRng } from '../web/src/util.js';
import { loadMap } from './helpers.mjs';

const FLOOR = {
  name: 'floor', bounds: { left: -900, top: -400, right: 900, bottom: 200 }, items: [],
  platforms: [{ left: -900, top: 0, right: 900, bottom: 40 }],
  spawns: [{ x: -800, y: -12, team: 1 }, { x: 800, y: -12, team: 2 }],
};
const idle = { input: () => ({ move: 0 }) };
const run = (game, n) => { for (let i = 0; i < n; i++) game.update(); };

function match(mode = 'ffa', options = {}) {
  return new Game({ mapData: FLOOR, mode, fragLimit: 99, effects: false, seed: 2, speed: DEFAULT_SPEED, options });
}
function put(game, name, x, team = 0) {
  const s = game.addSoldier({ name, isBot: false, team }, idle);
  game.respawn(s);
  s.body.x = x; s.prevX = x;
  s.spawnProtect = 0;
  return s;
}

test("spectating: you sit out (it isn't a death) and don't respawn until you join again", () => {
  const game = match();
  const me = put(game, 'Me', 0);
  put(game, 'Other', 400);
  assert.ok(game.spectate(me, true));
  assert.ok(!me.alive && me.spectating);
  assert.deepEqual([me.frags, me.deaths], [0, 0], 'no frag lost, no death');
  assert.ok(game.feed.some(f => f.text === 'Me is spectating'));
  run(game, RULES.respawnTicks * 4);
  assert.ok(!me.alive, 'still sitting out');
  assert.equal(game.spectate(me, true), false, 'already spectating');
  game.spectate(me, false);
  assert.ok(game.feed.some(f => f.text === 'Me joined the game'));
  run(game, RULES.respawnTicks + 2);
  assert.ok(me.alive && !me.spectating, 'back in the game');
});

test('spectating just after being hurt counts for whoever hurt you', () => {
  const game = match();
  const me = put(game, 'Me', 0), foe = put(game, 'Foe', 300);
  damage(game, me, 30, foe, 'M4');
  game.spectate(me, true);
  assert.equal(foe.frags, 1);
  assert.equal(me.deaths, 1);
  assert.ok(me.spectating && !me.alive);
});

test('capture the flag: a carrier who starts spectating drops the flag', () => {
  const game = match('ctf');
  const me = put(game, 'Me', 0, 1);
  const flag = game.modeState.flags[1];
  me.body.x = flag.x; me.prevX = flag.x;
  run(game, 3);
  assert.equal(flag.carrier, me.id, 'took the flag');
  game.spectate(me, true);
  run(game, 2);
  assert.equal(flag.carrier, -1, 'dropped');
});

test('one in the chamber: spectating uses no life, and the last one playing wins', () => {
  const game = match('oitc');
  const me = put(game, 'Me', 0), a = put(game, 'A', -300), b = put(game, 'B', 300);
  game.spectate(me, true);
  assert.equal(me.lives, 3, 'no life used');
  assert.ok(!game.over);
  for (let i = 0; i < 3; i++) { a.spawnProtect = 0; damage(game, a, 1000, b, 'Chamber'); run(game, RULES.respawnTicks + 2); }
  assert.ok(game.over, 'over once only B is left playing');
  assert.equal(game.winner.soldier, b);
});

/** A host with bots, and one remote player, over in-memory links on a simulated clock. */
async function online() {
  const mapData = loadMap('ssdm1.json');
  const make = () => new Game({ mapData, mode: 'team', fragLimit: 999, seed: 5, effects: true, speed: DEFAULT_SPEED });
  let game = make();
  const nav = new NavGraph(game.map);
  const rng = makeRng(5);
  const addBot = g => {
    const profile = BOT_PROFILES[g.soldiers.length % BOT_PROFILES.length];
    g.addSoldier({ name: profile.name + g.soldiers.length, isBot: true, profile, team: 1 + (g.soldiers.length % 2) }, new BotController(nav, 'normal', profile, rng));
  };
  let now = 0;
  const queue = [];
  const schedule = (fn, ms) => queue.push({ at: now + ms, fn });
  const host = new NetHost({ maxPlayers: 8, botCount: 2, matchInfo: () => ({ mode: 'team', fragLimit: 999, options: game.options, speed: DEFAULT_SPEED, map: { builtin: 'ssdm1.json' }, mapName: 'test' }), addBot });
  game.addSoldier({ name: 'Host', isBot: false, team: 1 }, idle);
  host.setGame(game);
  const [h, c] = memoryLinks({ schedule, rng: makeRng(9) });
  const client = new NetClient({ link: c, controller: { input: () => ({ move: 0, aim: 0, aimDist: 200 }) }, loadMap: async () => mapData, clock: () => now });
  host.addPlayer(h, 'Guest');
  const pump = async () => {
    for (let k = 0; k < 4; k++) {
      await new Promise(r => setImmediate(r));
      const due = queue.filter(q => q.at <= now);
      for (const q of due) { queue.splice(queue.indexOf(q), 1); q.fn(); }
    }
  };
  const step = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      game.update();
      host.afterTick();
      client.tick();
      now += 1000 / 60;
      await pump();
      client.updateView(now);
    }
  };
  /** The host starts the next match. */
  const next = async () => { game = make(); game.addSoldier({ name: 'Host', isBot: false, team: 1 }, idle); host.setGame(game); await pump(); };
  await pump();
  return { get game() { return game; }, host, client, step, next };
}

test('online: a player spectates (the host sits them out and tells everyone), carries on into the next match, and joins again', async () => {
  const o = await online();
  await o.step(90);
  const mine = () => o.game.soldiers.find(s => s.name === 'Guest');
  assert.ok(mine().alive);
  o.client.sendSpectate(true);
  assert.ok(o.client.me.spectating, 'our own screen shows it straight away');
  await o.step(30);
  assert.ok(mine().spectating && !mine().alive, 'the host sits them out');
  await o.step(RULES.respawnTicks * 3);
  assert.ok(!mine().alive, 'and doesn\'t respawn them');
  assert.ok(o.client.me.spectating && !o.client.me.alive);
  // The host's own scoreboard, and the list of players everyone gets, say so.
  assert.ok(o.host.roster().find(r => r.name === 'Guest').spec);
  // The next match: still spectating.
  await o.next();
  await o.step(120);
  assert.ok(mine().spectating && !mine().alive, 'still spectating in the next match');
  assert.ok(o.client.me.spectating, 'the player knows');
  assert.ok(!o.game.feed.some(f => /spectating/.test(f.text)), 'without a message about it');
  // Joining again.
  o.client.sendSpectate(false);
  await o.step(RULES.respawnTicks + 30);
  assert.ok(mine().alive && !mine().spectating, 'back in');
  assert.ok(!o.client.me.spectating && o.client.me.alive);
});
