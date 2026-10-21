// How bots aim and shoot: like a person with a mouse (they take a moment to react, flick
// over and settle, lag behind sudden moves), only at someone who'd be on their screen,
// and the difficulty levels in order. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { NavGraph } from '../web/src/nav.js';
import { BotController, BOT_PROFILES, DIFFICULTY } from '../web/src/bot.js';
import { makeRng } from '../web/src/util.js';
import { DEFAULT_SPEED } from '../web/src/config.js';

const RANGE = { name: 'range', bounds: { left: -1600, top: -900, right: 1600, bottom: 200 }, spawns: [], items: [], platforms: [{ left: -1600, top: 0, right: 1600, bottom: 40 }] };

/**
 * A bot standing at x 0 with an M4 (it aims and shoots, but doesn't walk), and a player at
 * x `at` (who strafes about, turning at random, now and then jumping, if `dodge`).
 * Returns { game, bot, ctl, player, shots(), hits }.
 */
function duel(difficulty, at, { dodge = true, profile = BOT_PROFILES[2], seed = 1 } = {}) {
  const game = new Game({ mapData: RANGE, mode: 'ffa', effects: false, seed, speed: DEFAULT_SPEED });
  const nav = game.useNav(new NavGraph(game.map));
  const rng = makeRng(seed + 50);
  let dir = 1, turnAt = 0;
  const out = { hits: 0 };
  const player = game.addSoldier({ name: 'Player', isBot: false }, {
    input: (g, me) => {
      if (!dodge) return { move: 0 };
      if (g.tick >= turnAt) { dir = rng() < 0.5 ? -1 : 1; turnAt = g.tick + 20 + Math.floor(rng() * 70); }
      if (me.x > at + 120) dir = -1;
      if (me.x < at - 120) dir = 1;
      const jump = rng() < 0.02;
      return { move: dir, jump, jumpPressed: jump };
    },
    onHurt: (g, me, by) => { if (by && by.isBot) out.hits++; },
  });
  const ctl = new BotController(nav, difficulty, profile, makeRng(seed + 7));
  const bot = game.addSoldier({ name: 'Bot', isBot: true, profile }, ctl);
  const think = ctl.input.bind(ctl);
  ctl.input = (g, s) => Object.assign(think(g, s), { move: 0, jump: false, jumpPressed: false, sprint: false });
  bot.spawnAt({ x: 0, y: -12 }, 0);
  bot.spawnProtect = 0;
  ctl.onSpawn(game, bot);
  bot.weapons.M4 = { ammo: 5000 };
  bot.current = 'M4';
  player.spawnAt({ x: at, y: -12 }, 0);
  player.spawnProtect = 0;
  out.shots = () => 5000 - bot.weapons.M4.ammo;
  return Object.assign(out, { game, bot, ctl, player });
}

/** Share of shots that hit over `seconds` (the player kept alive, and put back if pushed away). */
function hitRate(difficulty, at, seconds = 20) {
  let hits = 0, shots = 0;
  for (const [i, profile] of BOT_PROFILES.slice(0, 4).entries()) {
    const d = duel(difficulty, at, { profile, seed: 3 + i });
    for (let t = 0; t < seconds * 15; t++) { d.game.update(); d.player.health = 100; d.bot.health = 100; }
    hits += d.hits;
    shots += d.shots();
  }
  return hits / shots;
}

test("bots don't shoot at someone who'd be off a player's screen (unless they're sniping)", () => {
  const far = duel('hard', 760, { dodge: false });
  for (let t = 0; t < 300; t++) far.game.update();
  assert.equal(far.ctl.target, far.player, 'it sees them');
  assert.equal(far.shots(), 0, 'but holds fire');
  const near = duel('hard', 480, { dodge: false });
  for (let t = 0; t < 300; t++) near.game.update();
  assert.ok(near.shots() > 5, `and shoots once they're on screen (${near.shots()} shots)`);
});

test('a bot takes a moment to react before its first shot', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const d = duel(difficulty, 300, { dodge: false });
    let first = null;
    for (let t = 0; t < 240 && first === null; t++) { d.game.update(); if (d.shots()) first = t; }
    const quickest = DIFFICULTY[difficulty].reaction * 0.9;
    assert.ok(first !== null && first >= quickest, `${difficulty}: first shot after ${first} updates (no sooner than ${quickest})`);
  }
});

test('the difficulty levels are in order, and miss a fair bit against a dodging player', () => {
  const rates = Object.fromEntries(['easy', 'normal', 'hard'].map(d => [d, hitRate(d, 300)]));
  const pct = Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, Math.round(v * 100)]));
  assert.ok(rates.easy < rates.normal && rates.normal < rates.hard, `in order: ${JSON.stringify(pct)}`);
  assert.ok(rates.easy > 0.15 && rates.easy < 0.42, `easy at 300 px: ${pct.easy}%`);
  assert.ok(rates.normal > 0.3 && rates.normal < 0.6, `normal at 300 px: ${pct.normal}%`);
  assert.ok(rates.hard > 0.45 && rates.hard < 0.8, `hard at 300 px: ${pct.hard}%`);
  // Further away, they miss more.
  assert.ok(hitRate('normal', 500) < rates.normal - 0.08, 'and further away, more');
});

test("a bot aims where it saw its target a moment ago: when they suddenly turn, it's behind", () => {
  const d = duel('normal', 300, { dodge: false });
  for (let t = 0; t < 120; t++) d.game.update();
  // The player starts running right: the bot's idea of where they are lags behind.
  const seen = d.ctl.remember(d.player, DIFFICULTY.normal.delay);
  assert.ok(Math.abs(seen.x - d.player.x) < 1, 'standing still: where they are (give or take being knocked back)');
  d.player.body.vx = 2.5;
  for (let t = 0; t < 6; t++) { d.player.body.x += 2.5; d.ctl.remember(d.player, DIFFICULTY.normal.delay); }
  const later = d.ctl.remember(d.player, DIFFICULTY.normal.delay);
  assert.ok(later.x < d.player.x - 10, `seen at ${later.x.toFixed(0)}, really at ${d.player.x.toFixed(0)}`);
});
