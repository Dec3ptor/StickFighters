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
