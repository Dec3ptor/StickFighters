// Experimental match options: bots that only know what they see and hear
// (botVision: 'sight'), and fog of war for players.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { NavGraph } from '../web/src/nav.js';
import { BotController, BOT_PROFILES } from '../web/src/bot.js';
import { Fog } from '../web/src/fog.js';
import { makeRng } from '../web/src/util.js';
import { DEFAULT_SPEED } from '../web/src/config.js';

// A long floor with a wall at x 400.
function arena(options = {}) {
  const map = {
    name: 'range', bounds: { left: -1200, top: -900, right: 1200, bottom: 200 }, spawns: [], items: [],
    platforms: [{ left: -1200, top: 0, right: 1200, bottom: 40 }, { left: 400, top: -300, right: 440, bottom: 0 }],
  };
  return new Game({ mapData: map, mode: 'team', effects: false, seed: 3, speed: DEFAULT_SPEED, options });
}

function soldier(game, name, team, x, y = -12, ctl = { input: () => ({ move: 0 }) }) {
  const s = game.addSoldier({ name, isBot: !!ctl.nav, team }, ctl);
  s.spawnAt({ x, y }, 0);
  s.spawnProtect = 0;
  return s;
}

function botAt(game, x) {
  const ctl = new BotController(new NavGraph(game.map), 'normal', BOT_PROFILES[2], makeRng(1));
  const s = soldier(game, 'Bot', 1, x, -12, ctl);
  ctl.aim = 0; // facing right
  return { s, bot: ctl };
}

test('classic bots notice everyone nearby in a clear line, whichever way they face', () => {
  const game = arena();
  const { s, bot } = botAt(game, 0);
  for (const [x, y] of [[200, -12], [-200, -12], [100, -512]]) {
    const e = soldier(game, 'E', 2, x, y);
    assert.equal(bot.lookAtAll(game, s), e, `sees the enemy at ${x},${y}`);
    game.removeSoldier(e);
  }
});

test("with bot vision 'sight', bots only see what's on their screen, in front of them, in a clear line", () => {
  const game = arena({ botVision: 'sight' });
  const { s, bot } = botAt(game, 0);
  const seen = (x, y) => { const e = soldier(game, 'E', 2, x, y); const r = bot.lookAtAll(game, s) === e; game.removeSoldier(e); return r; };
  assert.ok(seen(200, -12), 'in front');
  assert.ok(!seen(-200, -12), 'behind');
  assert.ok(!seen(100, -512), 'jetpacking high above (off its screen)');
  assert.ok(!seen(700, -12), 'in front, but behind the wall');
  assert.ok(seen(-15, -12), 'right up against it');
  bot.aim = Math.PI;
  assert.ok(seen(-200, -12), 'behind it, once it turns round');
  assert.ok(seen(-480, -12), 'near the edge of its screen');
  assert.ok(!seen(-900, -12), 'in a clear line, but further than its screen reaches');
});

test("with bot vision 'sight', a bot hears a shot behind it, turns round and sees who fired", () => {
  const game = arena({ botVision: 'sight' });
  const { s, bot } = botAt(game, 0);
  const e = soldier(game, 'E', 2, -250);
  bot.perceive(game, s);
  assert.equal(bot.target, null, "doesn't know they're there");
  // A shot (it could be anything loud: a jetpack, an explosion...).
  game.noise(e.x, e.y, 950, e);
  bot.perceive(game, s);
  assert.ok(bot.lastSeen?.heard && Math.abs(bot.lastSeen.x - e.x) < 1, 'heard where it came from');
  // It turns that way (a little each update) and then sees them.
  for (let i = 0; i < 60 && !bot.target; i++) {
    bot.fight(game, s, {});
    s.aim = bot.aim;
    bot.perceive(game, s);
  }
  assert.equal(bot.target, e, 'turned round and spotted them');
  // Teammates' noises don't count.
  game.noises.length = 0;
  const { s: s2, bot: bot2 } = botAt(game, 600);
  const mate = soldier(game, 'Mate', 1, 550);
  game.noise(mate.x, mate.y, 950, mate);
  bot2.perceive(game, s2);
  assert.ok(!bot2.lastSeen, "a teammate's shot isn't something to check out");
});

test('running is heard close by, creeping along crouched is silent (bot vision sight only)', () => {
  const heard = (options, crouch) => {
    const game = arena(options);
    let n = 0;
    const noise = game.noise.bind(game);
    game.noise = (...a) => { if (game.options.botVision === 'sight') n++; noise(...a); };
    soldier(game, 'Runner', 2, -600, -12, { input: () => ({ move: 1, crouch }) });
    for (let i = 0; i < 120; i++) game.update();
    return n;
  };
  assert.ok(heard({ botVision: 'sight' }, false) > 3, 'footsteps');
  assert.equal(heard({ botVision: 'sight' }, true), 0, 'crouched: silent');
  assert.equal(heard({}, false), 0, 'classic bots: no noises needed');
});

test('fog of war: you see what your soldier can see (teammates too), and hear the rest', () => {
  const game = arena({ fog: true });
  const me = soldier(game, 'Me', 1, 0);
  const mate = soldier(game, 'Mate', 1, 700), nearMate = soldier(game, 'Near', 1, 200);
  const front = soldier(game, 'Front', 2, 300), hidden = soldier(game, 'Hidden', 2, 700);
  const fog = new Fog().update(game, me, 1);
  assert.ok(fog.shows(me) && fog.shows(nearMate), 'you, and a teammate in sight');
  assert.ok(!fog.shows(mate), 'a teammate behind the wall');
  assert.ok(fog.shows(front), 'an enemy in plain sight');
  assert.ok(!fog.shows(hidden), 'an enemy behind the wall');
  assert.ok(!fog.sees(700, -50) && fog.sees(300, -50));
  // Sounds: from behind the wall, an alert; in plain sight, or your own, none.
  fog.hear([{ name: 'pistol', x: 700, y: -20 }, { name: 'pistol', x: 300, y: -20 }, { name: 'pistol', x: 0, y: -20 }, { name: 'pickup', x: 650, y: -20 }], me, 1000);
  assert.deepEqual(fog.alerts.map(a => a.x), [700]);
  fog.hear([], me, 1000 + 2000);
  assert.equal(fog.alerts.length, 0, 'alerts fade');
  // Shadows: one shape behind each block on screen.
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => (...a) => calls.push(k), set: () => true });
  fog.drawShadows(ctx, { l: -900, t: -600, r: 900, b: 300 });
  assert.equal(calls.filter(c => c === 'moveTo').length, 2, 'the floor and the wall');
  assert.equal(calls.filter(c => c === 'fill').length, 1, 'filled in one go');
});
