// Bots not getting stuck: in nooks holes leave, bouncing on the edge of a jump pad,
// chasing someone they can't get to, or waiting where they last saw someone. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { NavGraph } from '../web/src/nav.js';
import { BotController, BOT_PROFILES } from '../web/src/bot.js';
import { makeRng } from '../web/src/util.js';
import { DEFAULT_SPEED } from '../web/src/config.js';

function world(platforms, items = []) {
  const map = { name: 'nook', bounds: { left: -800, top: -700, right: 800, bottom: 200 }, spawns: [], items, platforms };
  const game = new Game({ mapData: map, mode: 'ffa', effects: false, seed: 3, speed: DEFAULT_SPEED });
  return { game, nav: game.useNav(new NavGraph(game.map)) };
}

function bot(game, nav, x, y = -12) {
  const ctl = new BotController(nav, 'normal', BOT_PROFILES[1], makeRng(7));
  const s = game.addSoldier({ name: 'Bot', isBot: true }, ctl);
  s.spawnAt({ x, y }, 0);
  s.spawnProtect = 0;
  ctl.onSpawn(game, s);
  return { s, ctl };
}

const run = (game, n, until = () => false) => { let t = 0; while (t < n && !until()) { game.update(); t++; } return t; };

// A floor, an 18 px step on it, and a wall: between them, a nook 4 px wide (x 123 to 127)
// that the route map's spots, 12 px apart, used to miss.
const FLOOR = { left: -600, top: 0, right: 400, bottom: 40 };
const STEP = { left: 60, top: -18, right: 117, bottom: 0 };

test('a nook a few pixels wide has a route map spot, and a bot that ends up in it gets out', () => {
  const { game, nav } = world([FLOOR, STEP, { left: 133, top: -300, right: 400, bottom: 0, hard: true }],
    [{ type: 'weapon', weapon: 'Shotgun', x: -400, y: -20 }]);
  const n = nav.nodeAt(125, -12, 3);
  assert.ok(n && n.x >= 123 && n.x <= 127, 'a spot in the nook');
  assert.ok(n.links.some(l => l.to.y < -20), 'with a way up onto the step');
  const { s } = bot(game, nav, 125);
  const t = run(game, 900, () => !!s.weapons.Shotgun);
  assert.ok(s.weapons.Shotgun, `got out and fetched the Shotgun (at ${s.x.toFixed(0)},${s.y.toFixed(0)})`);
  assert.ok(t < 600, `in ${t} updates`);
});

test('a soldier wedged in exactly (room for the body and not a pixel more) has a spot', () => {
  const { nav } = world([FLOOR, STEP, { left: 129, top: -300, right: 400, bottom: 0, hard: true }]);
  const n = nav.nodeAt(123, -12, 0.5);
  assert.ok(n && Math.abs(n.x - 123) < 0.01, 'a spot right at 123');
});

test('off the route map, a bot finds a jump, drop or walk from where it is that lands on a spot', () => {
  const { game, nav } = world([FLOOR, STEP, { left: 133, top: -300, right: 400, bottom: 0, hard: true }]);
  // (As if the route map hadn't caught up with the holes yet: the nook's spot taken away.)
  nav.nodes = nav.nodes.filter(n => !(n.x > 120 && n.x < 130 && n.y === -12));
  nav._reindex();
  nav._flatLinks = null;
  const way = nav.escape(125, -12);
  assert.ok(way, 'a way out');
  assert.ok(nav.nodes[way.to.id] === way.to);
  const { s } = bot(game, nav, 125);
  run(game, 300, () => s.x < 117);
  assert.ok(s.x < 117, `out of the nook (at ${s.x.toFixed(0)},${s.y.toFixed(0)})`);
});

test('a bot bouncing on the edge of a jump pad with nothing planned steps off it', () => {
  const pad = { left: 0, top: -12, right: 36, bottom: 0, bounce: -12 };
  const { game, nav } = world([FLOOR, pad]);
  const { s, ctl } = bot(game, nav, 35.5, -200);
  ctl.thinkIn = 9999; // (nothing planned)
  let bounces = 0;
  const t = run(game, 900, () => {
    if (s.body.bounced) bounces++;
    return s.body.onGround && (s.x < pad.left - 6 || s.x > pad.right + 6);
  });
  assert.ok(t < 400, `off the pad after ${t} updates and ${bounces} bounces (at ${s.x.toFixed(0)})`);
});

test("chasing an enemy it can't get to, a bot goes as near as it can instead of standing still", () => {
  // The enemy is across a gap too wide to jump.
  const { game, nav } = world([{ left: -600, top: 0, right: 0, bottom: 40 }, { left: 400, top: 0, right: 700, bottom: 40 }]);
  const foe = game.addSoldier({ name: 'Foe', isBot: false }, { input: () => ({ move: 0 }) });
  foe.spawnAt({ x: 550, y: -12 }, 0);
  foe.spawnProtect = 0;
  const { s, ctl } = bot(game, nav, -500);
  // (Just a shotgun: it has to get close.)
  s.weapons = { Shotgun: { ammo: 99 } };
  s.current = 'Shotgun';
  run(game, 240);
  assert.equal(ctl.target, foe, 'sees the enemy');
  assert.ok(s.x > -100, `moved towards them (at ${s.x.toFixed(0)})`);
});

test("a bot that gets to where it last saw someone, and finds nobody there, doesn't wait about", () => {
  const { game, nav } = world([FLOOR]);
  const { s, ctl } = bot(game, nav, -300);
  run(game, 20);
  const seen = game.tick;
  ctl.lastSeen = { x: 0, y: -12, tick: seen };
  ctl.thinkIn = 0;
  run(game, 400, () => Math.abs(s.x) < 8);
  const arrived = game.tick;
  assert.ok(Math.abs(s.x) < 8, `went to have a look (at ${s.x.toFixed(0)})`);
  run(game, 300, () => Math.abs(s.x) > 60);
  assert.ok(Math.abs(s.x) > 60 && game.tick - arrived < 120, `moved on after ${game.tick - arrived} updates (it would have waited until ${seen + 300 - arrived})`);
});
