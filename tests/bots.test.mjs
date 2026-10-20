// Bots choosing what to do: not racing for items they won't get to first,
// and walking where walking does (not hopping along flat floors).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { NavGraph } from '../web/src/nav.js';
import { BotController, BOT_PROFILES } from '../web/src/bot.js';
import { makeRng } from '../web/src/util.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { WEAPONS } from '../web/src/weapons.js';
import { botMatch } from './helpers.mjs';
import { SELF_DESTRUCT_TICKS } from '../web/src/game.js';

// A long floor with a Shotgun lying on it at x 0.
function arena(mode = 'ffa', options = {}) {
  const map = {
    name: 'range', bounds: { left: -1500, top: -900, right: 1500, bottom: 200 }, spawns: [],
    items: [{ type: 'weapon', weapon: 'Shotgun', x: 0, y: -10 }],
    platforms: [{ left: -1500, top: 0, right: 1500, bottom: 40 }],
  };
  const game = new Game({ mapData: map, mode, effects: false, seed: 3, speed: DEFAULT_SPEED, options });
  return { game, nav: new NavGraph(game.map), item: game.pickups.items[0] };
}

function bot(game, nav, name, x, team = 0) {
  const ctl = new BotController(nav, 'normal', BOT_PROFILES[1], makeRng(x + 2000));
  const s = game.addSoldier({ name, isBot: true, team }, ctl);
  s.spawnAt({ x, y: -12 }, 0);
  s.spawnProtect = 0;
  ctl.onSpawn(game, s);
  return { s, ctl };
}

const think = (game, ...bots) => { for (const { s, ctl } of bots) ctl.think(game, s); };

test("bots don't race for an item another bot will get to first", () => {
  for (const [mode, team] of [['ffa', [0, 0]], ['team', [1, 1]], ['team', [1, 2]]]) {
    const { game, nav, item } = arena(mode);
    const near = bot(game, nav, 'Near', 150, team[0]);
    const far = bot(game, nav, 'Far', 700, team[1]);
    think(game, near, far);
    assert.equal(near.ctl.goalItem, item, `${mode}: the nearer bot goes for it`);
    assert.notEqual(far.ctl.goalItem, item, `${mode}: the further one finds something else to do`);
  }
});

test('a bot on its way to an item gives up when someone closer goes for it', () => {
  const { game, nav, item } = arena();
  const far = bot(game, nav, 'Far', 900);
  think(game, far);
  assert.equal(far.ctl.goalItem, item, 'on its own, it goes for it');
  const near = bot(game, nav, 'Near', -120);
  think(game, near);
  assert.equal(near.ctl.goalItem, item, 'a bot much closer goes for it too');
  for (let i = 0; i < 15; i++) game.update();
  assert.notEqual(far.ctl.goalItem, item, "the further one realises it won't get there first");
  assert.equal(near.ctl.goalItem, item);
});

test('an even race goes to one bot, not both', () => {
  const { game, nav, item } = arena('team');
  const a = bot(game, nav, 'A', -300, 1), b = bot(game, nav, 'B', 300, 1);
  think(game, a, b);
  for (let i = 0; i < 15; i++) game.update();
  assert.equal([a, b].filter(o => o.ctl.goalItem === item).length, 1);
});

test('bots leave an item to a player standing right next to it', () => {
  const { game, nav, item } = arena();
  const you = game.addSoldier({ name: 'You', isBot: false, team: 0 }, { input: () => ({ move: 0 }) });
  you.spawnAt({ x: 40, y: -12 }, 0);
  const b = bot(game, nav, 'Bot', 600);
  think(game, b);
  assert.notEqual(b.ctl.goalItem, item, 'the player will get it first');
  // A player who doesn't want it (already has a full Shotgun) doesn't count.
  const def = WEAPONS.Shotgun;
  you.weapons.Shotgun = { ammo: def.maxAmmo ?? def.ammo };
  think(game, b);
  assert.equal(b.ctl.goalItem, item);
});

test('bots walk along flat floors instead of hopping', () => {
  const { game, nav } = arena();
  const from = nav.nodeAt(-1200, -12, 12), to = nav.nodeAt(1200, -12, 12);
  const path = nav.pathTo(nav.costsFrom(from), to);
  assert.ok(path.length > 100);
  assert.deepEqual([...new Set(path.map(l => l.type))], ['walk']);
  assert.ok(game.map);
});

test("King of the Hill's pit is a trap: nobody spawns in it, bots keep out, and a bot stuck in it self-destructs", () => {
  const { game, nav } = botMatch('ssdm3.json', { bots: 6, mode: 'ffa', seed: 3 });
  const trapped = nav.trapped();
  // Its two spawn points down there aren't used.
  assert.equal(game.map.spawns.length - game.spawns.length, 2);
  const fresh = game.addSoldier({ name: 'Fresh', isBot: false }, { input: () => ({ move: 0 }) });
  for (let i = 0; i < 100; i++) {
    const p = game.pickSpawn(fresh);
    const n = nav.landing(p.x, p.y);
    assert.ok(n && !trapped[n.id], `spawned in the pit at ${p.x},${p.y}`);
  }
  game.removeSoldier(fresh);
  // A bot dropped into the pit with nothing to do there blows itself up and respawns up top.
  const feed = [];
  const add = game.addFeed.bind(game);
  game.addFeed = e => { feed.push(e.text); add(e); };
  const stuck = game.soldiers[0];
  for (const o of game.soldiers) if (o !== stuck) game.kill(o, stuck); // nobody to fight for a while
  stuck.spawnAt({ x: 164, y: 528 }, 0);
  game.controllers.get(stuck).onSpawn(game, stuck);
  let t = 0;
  while (stuck.alive && t++ < 900) game.update();
  assert.ok(!stuck.alive && t < 600, `still in the pit after ${t} updates`);
  assert.ok(feed.some(f => f === `${stuck.name} self-destructed`), feed.join('; '));
  // Bots playing normally only end up down there by accident, and don't stay.
  let inPit = 0;
  for (let i = 0; i < 3600; i++) {
    game.update();
    if (i % 30 === 0) inPit += game.soldiers.filter(o => o.alive && game.trapped(o)).length;
  }
  assert.ok(inPit < 40, `bots spent ${inPit / 2} bot-seconds in the pit`);
});

test('holding self-destruct for a second blows you up (a suicide, or a kill for whoever just hurt you)', () => {
  const { game } = arena();
  let held = true;
  const you = game.addSoldier({ name: 'You', isBot: false }, { input: () => ({ move: 0, selfDestruct: held }) });
  you.spawnAt({ x: 0, y: -12 }, 0);
  for (let i = 0; i < SELF_DESTRUCT_TICKS - 5; i++) game.update();
  held = false;
  game.update();
  held = true;
  for (let i = 0; i < SELF_DESTRUCT_TICKS - 5; i++) game.update();
  assert.ok(you.alive, 'letting go starts the count again');
  for (let i = 0; i < 10; i++) game.update();
  assert.ok(!you.alive);
  assert.equal(you.frags, -1, 'counts as a suicide');
  // Hurt by someone just before: it's their kill.
  const other = game.addSoldier({ name: 'Other', isBot: false }, { input: () => ({ move: 0 }) });
  other.spawnAt({ x: 300, y: -12 }, 0);
  you.spawnAt({ x: 0, y: -12 }, 0);
  you.lastHurtBy = other;
  you.lastHurtTick = game.tick;
  for (let i = 0; i < SELF_DESTRUCT_TICKS + 2; i++) game.update();
  assert.ok(!you.alive);
  assert.equal(other.frags, 1);
});

test("a team walled into its own part of the map doesn't self-destruct over and over", () => {
  // Two closed rooms, one per team (a broken map): dying wouldn't get anyone out.
  const room = x => [
    { left: x, top: 0, right: x + 400, bottom: 40 }, { left: x - 40, top: -300, right: x, bottom: 40 },
    { left: x + 400, top: -300, right: x + 440, bottom: 40 }, { left: x - 40, top: -340, right: x + 440, bottom: -300 },
  ];
  const map = {
    name: 'rooms', bounds: { left: -1200, top: -600, right: 1200, bottom: 200 }, items: [],
    platforms: [...room(-900), ...room(500)],
    spawns: [{ x: -700, y: -30, team: 1 }, { x: -600, y: -30, team: 1 }, { x: 700, y: -30, team: 2 }],
  };
  const game = new Game({ mapData: map, mode: 'team', effects: false, seed: 2, speed: DEFAULT_SPEED });
  const nav = new NavGraph(game.map);
  game.useNav(nav);
  const feed = [];
  const add = game.addFeed.bind(game);
  game.addFeed = e => { feed.push(e.text); add(e); };
  for (let i = 0; i < 4; i++) game.addSoldier({ name: `B${i}`, isBot: true, team: 1 + (i % 2) }, new BotController(nav, 'normal', BOT_PROFILES[i], makeRng(i + 1)));
  for (let i = 0; i < 1800; i++) game.update();
  assert.deepEqual(feed.filter(t => /self-destructed/.test(t)), []);
});
