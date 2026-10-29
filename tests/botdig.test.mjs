// Bots digging through walls with the sledgehammer to get where they're going: a built
// wall across a corridor (any map), the map's own wall (destructible maps), out of a room
// they've been walled into; never through hard blocks. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { NavGraph } from '../web/src/nav.js';
import { BotController, BOT_PROFILES } from '../web/src/bot.js';
import { makeRng } from '../web/src/util.js';
import { DEFAULT_SPEED } from '../web/src/config.js';

const run = (game, n, until = () => false) => { for (let i = 0; i < n; i++) { game.update(); if (until()) return i + 1; } return n; };
const place = (s, x, y) => { s.body.x = x; s.body.y = y; s.body.vx = s.body.vy = 0; s.prevX = x; s.prevY = y; s.spawnProtect = 0; };
const FLOOR = { left: -900, top: 0, right: 900, bottom: 40 };

/** A game on a made-up map with one bot standing at (x, -12). setup(game): before the route map's made. */
function withBot(map, x, { mode = 'koth', destruction = false, setup } = {}) {
  const game = new Game({ mapData: map, mode, fragLimit: 99, effects: false, seed: 3, speed: DEFAULT_SPEED, options: { destruction } });
  setup?.(game);
  const nav = game.useNav(new NavGraph(game.map));
  const bot = game.addSoldier({ name: 'Bot', isBot: true, team: 0, profile: BOT_PROFILES[0] }, new BotController(nav, 'normal', BOT_PROFILES[0], makeRng(5)));
  game.respawn(bot);
  place(bot, x, -12);
  game.moved(bot);
  return { game, nav, bot, ctl: game.controllers.get(bot) };
}
const chips = game => game.carves.filter(c => c[0] !== '+').length;

/**
 * A hill at the far end of a corridor under a solid mass (no way over it), with `wall`
 * (a block) across the corridor; built: put up by a soldier, rather than part of the map.
 */
function corridor(wall, { built = false, destruction = false } = {}) {
  const platforms = [FLOOR, { left: -300, top: -600, right: 500, bottom: -60 }];
  if (!built) platforms.push(wall);
  const hill = { left: 600, top: -90, right: 800, bottom: 0 };
  const map = {
    name: 'corridor', bounds: { left: -950, top: -700, right: 950, bottom: 200 }, platforms, items: [],
    spawns: [{ x: -600, y: -30 }, { x: -700, y: -30 }], objectives: [{ type: 'hill', ...hill }],
  };
  const t = withBot(map, -500, {
    destruction,
    setup: game => { if (built) game.addBlocks([{ l: wall.left, t: wall.top, r: wall.right, b: wall.bottom }], true); },
  });
  t.onHill = () => t.bot.body.onGround && t.bot.x > hill.left && t.bot.x < hill.right && t.bot.y < hill.bottom;
  const at = t.nav.nearest(700, -12, 90), from = t.nav.nodeAt(-500, -12, 10);
  t.cutOff = t.nav.costsFrom(from).cost[at.id] === Infinity;
  return t;
}

test('a bot digs through a built wall across its way to the hill (any map)', () => {
  const t = corridor({ left: 100, top: -60, right: 112, bottom: 0 }, { built: true });
  assert.ok(t.cutOff, 'no way there to start with');
  const ticks = run(t.game, 60 * 40, t.onHill);
  assert.ok(t.onHill(), `not on the hill (at ${t.bot.x.toFixed(0)},${t.bot.y.toFixed(0)}, ${chips(t.game)} chunks)`);
  assert.ok(ticks < 60 * 30, `took ${(ticks / 60).toFixed(1)} s`);
  assert.ok(chips(t.game) >= 2, 'dug its way');
  assert.equal(t.bot.deaths, 0);
});

test("on a destructible map, a bot digs through the map's own wall; never through a hard one", () => {
  const t = corridor({ left: 100, top: -60, right: 124, bottom: 0 }, { destruction: true });
  assert.ok(t.cutOff, 'no way there to start with');
  const ticks = run(t.game, 60 * 45, t.onHill);
  assert.ok(t.onHill(), `not on the hill (at ${t.bot.x.toFixed(0)},${t.bot.y.toFixed(0)}, ${chips(t.game)} chunks)`);
  assert.ok(ticks < 60 * 40, `took ${(ticks / 60).toFixed(1)} s`);
  // Hard: it doesn't try (and doesn't blow itself up over it).
  const h = corridor({ left: 100, top: -60, right: 124, bottom: 0, hard: true }, { destruction: true });
  run(h.game, 60 * 15);
  assert.ok(!h.onHill() && h.bot.alive, 'stays put');
  assert.equal(chips(h.game), 0, 'no swings at a hard wall');
  // Not destructible: the map's own wall is left alone too.
  const n = corridor({ left: 100, top: -60, right: 124, bottom: 0 });
  run(n.game, 60 * 15);
  assert.ok(!n.onHill() && chips(n.game) === 0, 'no digging through the map where it doesn\'t break');
});

test('a bot walled into a room digs its way out instead of self-destructing', () => {
  // A room under a solid mass, closed off by built walls either side: no way out, nobody about.
  const map = {
    name: 'room', bounds: { left: -950, top: -700, right: 950, bottom: 200 }, items: [],
    platforms: [FLOOR, { left: 150, top: -600, right: 450, bottom: -60 }],
    spawns: [{ x: -600, y: -30 }, { x: -700, y: -30 }],
  };
  const t = withBot(map, 300, {
    mode: 'ffa',
    setup: game => game.addBlocks([{ l: 150, t: -60, r: 162, b: 0 }, { l: 438, t: -60, r: 450, b: 0 }], true),
  });
  assert.equal(t.nav.trapped()[t.nav.nodeAt(300, -12, 10).id], 1, 'trapped to start with');
  const out = () => t.bot.body.onGround && (t.bot.x < 140 || t.bot.x > 460);
  const ticks = run(t.game, 60 * 40, out);
  assert.ok(out(), `still in (at ${t.bot.x.toFixed(0)}, ${chips(t.game)} chunks)`);
  assert.ok(ticks < 60 * 30, `took ${(ticks / 60).toFixed(1)} s`);
  assert.equal(t.bot.deaths, 0, 'no self-destructing');
  assert.ok(!t.ctl.destructing);
});
