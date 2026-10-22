// The Hammer (a pickup anyone can build with), and bots getting themselves out of trouble
// with it or a jetpack before self-destructing: out of pits, up to ledges, across gaps,
// and a wall for cover in a fight. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { NavGraph } from '../web/src/nav.js';
import { BotController, BOT_PROFILES } from '../web/src/bot.js';
import { WEAPONS, NO_AUTO_SWITCH } from '../web/src/weapons.js';
import { makeRng } from '../web/src/util.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { loadMap, mapIndex } from './helpers.mjs';

const run = (game, n, until = () => false) => { for (let i = 0; i < n; i++) { game.update(); if (until()) return i + 1; } return n; };
const place = (s, x, y) => { s.body.x = x; s.body.y = y; s.body.vx = s.body.vy = 0; s.prevX = x; s.prevY = y; s.spawnProtect = 0; };

/** A game on a made-up map with one bot standing at (x, y), carrying `kit`. */
function withBot(map, x, y, kit = {}, { mode = 'ffa', destruction = false, setup } = {}) {
  const game = new Game({ mapData: map, mode, fragLimit: 99, effects: false, seed: 3, speed: DEFAULT_SPEED, options: { destruction } });
  setup?.(game);
  const nav = game.useNav(new NavGraph(game.map));
  const bot = game.addSoldier({ name: 'Bot', isBot: true, team: 0, profile: BOT_PROFILES[0] }, new BotController(nav, 'normal', BOT_PROFILES[0], makeRng(5)));
  game.respawn(bot);
  place(bot, x, y);
  game.moved(bot);
  if (kit.hammer) bot.weapons.Hammer = { ammo: kit.hammer };
  if (kit.fuel != null) { bot.body.hasJetpack = true; bot.body.fuel = kit.fuel; }
  const feed = [];
  const add = game.addFeed.bind(game);
  game.addFeed = e => { feed.push(e.text); add(e); };
  return { game, nav, bot, feed, ctl: game.controllers.get(bot) };
}

/** A pickup lying on the floor at floorY. */
const item = (what, x, floorY) => what === 'jetpack' ? { type: 'jetpack', x, y: floorY - 26 } : { type: 'weapon', weapon: what, x, y: floorY - 26 };

/** A pit `depth` deep and `width` across in a floor, with the bot standing at the bottom. */
function pit(depth, width, kit, items = []) {
  const W = width / 2;
  const map = {
    name: 'pit', bounds: { left: -950, top: -400, right: 950, bottom: depth + 150 }, items,
    platforms: [
      { left: -900, top: 0, right: -W, bottom: depth + 40 },
      { left: W, top: 0, right: 900, bottom: depth + 40 },
      { left: -W, top: depth, right: W, bottom: depth + 40 },
    ],
    spawns: [{ x: -600, y: -30 }, { x: 600, y: -30 }],
  };
  const t = withBot(map, 0, depth - 12, kit);
  // Out: standing up on the floor either side, or on a block with a way there.
  t.out = () => {
    const b = t.bot;
    if (!b.alive || !b.body.onGround || t.ctl.escape) return false;
    if (b.y < -5 && Math.abs(b.x) > W) return true;
    const n = t.nav.nodeAt(b.x, b.y, 10);
    return !!n && b.y < depth - 100 && !t.nav.trapped()[n.id];
  };
  return t;
}

test('on every map, a jetpack or a hammer is a few seconds from anywhere anyone can get to', () => {
  for (const m of mapIndex()) {
    const mapData = loadMap(m.file);
    const game = new Game({ mapData, mode: 'ffa', effects: false, seed: 1, speed: DEFAULT_SPEED });
    const nav = new NavGraph(game.map);
    // Travel time from every spot to the nearest one (the links turned round, cheapest first).
    const n = nav.nodes.length, into = Array.from({ length: n }, () => []);
    for (const a of nav.nodes) for (const l of a.links) into[l.to.id].push([a.id, l.cost]);
    const cost = new Float64Array(n).fill(Infinity), done = new Uint8Array(n), open = [];
    for (const it of mapData.items) {
      if (it.type !== 'jetpack' && it.weapon !== 'Hammer') continue;
      const at = nav.landing(it.x, it.y);
      if (at) { cost[at.id] = 0; open.push(at.id); }
    }
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (cost[open[i]] < cost[open[bi]]) bi = i;
      const v = open.splice(bi, 1)[0];
      if (done[v]) continue;
      done[v] = 1;
      for (const [u, w] of into[v]) if (cost[v] + w < cost[u]) { cost[u] = cost[v] + w; open.push(u); }
    }
    // (Spots anyone can get to: from where they spawn.)
    const from = nav.costsFrom(game.map.spawns.map(p => nav.landing(p.x, p.y)).find(Boolean)).cost;
    let worst = 0;
    for (let v = 0; v < n; v++) if (from[v] < Infinity) worst = Math.max(worst, cost[v]);
    assert.ok(worst < 10 * 60, `${m.file}: ${(worst / 60).toFixed(1)} s from a jetpack or hammer`);
  }
});

test('the Hammer is on every map, and anyone can pick it up and build with it', () => {
  for (const m of mapIndex()) {
    const items = loadMap(m.file).items.filter(it => it.weapon === 'Hammer');
    assert.ok(items.length >= 1, `${m.file}: no hammer`);
  }
  const def = WEAPONS.Hammer;
  assert.equal(def.kind, 'build');
  assert.ok(NO_AUTO_SWITCH.has('Hammer'), "picking it up doesn't swap out your gun");

  const map = {
    name: 'yard', bounds: { left: -800, top: -600, right: 800, bottom: 200 },
    platforms: [{ left: -800, top: 0, right: 800, bottom: 40 }],
    spawns: [{ x: -700, y: -12 }, { x: 700, y: -12 }],
    items: [{ type: 'weapon', weapon: 'Hammer', x: 0, y: -26 }, { type: 'weapon', weapon: 'Hammer', x: 200, y: -26 }],
  };
  const game = new Game({ mapData: map, mode: 'ffa', fragLimit: 99, effects: false, seed: 1, speed: DEFAULT_SPEED });
  const keys = {};
  const you = game.addSoldier({ name: 'You', isBot: false }, {
    input: (g, me) => {
      const at = keys.at || { x: me.x + 100, y: me.y };
      const inp = { move: keys.move || 0, aim: Math.atan2(at.y - me.shoulderY, at.x - me.shoulderX), aimDist: Math.hypot(at.x - me.shoulderX, at.y - me.shoulderY),
        fire: !!keys.click, firePressed: !!keys.click, plank: keys.plank, switchTo: keys.switchTo };
      keys.click = false; keys.switchTo = undefined;
      return inp;
    },
  });
  game.respawn(you);
  place(you, -100, -12);
  const gun = you.current;
  keys.move = 1;
  run(game, 200, () => you.weapons.Hammer);
  keys.move = 0;
  assert.equal(you.weapons.Hammer?.ammo, 8, 'a hammer: 8 blocks');
  assert.equal(you.current, gun, 'still holding the gun');
  // Another hammer: more blocks (up to 16).
  place(you, 190, -12);
  run(game, 30);
  assert.equal(you.weapons.Hammer.ammo, 16);

  // Out with it: a click puts up a wall where you aim, standing on the floor; a right click turns it to a plank.
  keys.switchTo = 'Hammer';
  run(game, 2);
  assert.equal(you.current, 'Hammer');
  place(you, -300, -12);
  const added = (x, y, plank) => {
    keys.at = { x, y }; keys.plank = plank; keys.click = true;
    you.cooldown = 0;
    const before = new Set(game.map.solids);
    game.update();
    return game.map.solids.filter(p => !before.has(p));
  };
  const wall = added(-200, -30, false);
  assert.equal(wall.length, 1);
  assert.deepEqual([wall[0].r - wall[0].l, wall[0].b], [12, 0], 'a wall, standing on the floor');
  assert.equal(you.weapons.Hammer.ammo, 15, 'a block a click');
  const plank = added(-260, -90, true);
  assert.equal(plank.length, 1);
  assert.deepEqual([plank[0].r - plank[0].l, plank[0].b - plank[0].t], [64, 10], 'a plank');
  assert.ok(game.map.builtCount >= 2);
  // Out of blocks: nothing more goes up.
  you.weapons.Hammer.ammo = 0;
  assert.equal(added(-150, -200, true).length, 0);
});

test('bots climb out of a pit with a hammer: steps up, or in a narrow shaft, blocks under their feet', () => {
  for (const [depth, width, limit] of [[300, 200, 600], [500, 200, 900], [300, 60, 600], [300, 30, 600]]) {
    const t = pit(depth, width, { hammer: 8 });
    const ticks = run(t.game, 1800, t.out);
    assert.ok(t.out(), `${depth} deep, ${width} across: still in at ${t.bot.x.toFixed(0)},${t.bot.y.toFixed(0)}`);
    assert.ok(ticks < limit, `${depth} deep, ${width} across: out after ${(ticks / 60).toFixed(1)} s`);
    assert.equal(t.bot.deaths, 0);
    assert.ok(t.game.map.builtCount >= 2, 'built its way out');
  }
});

test('bots fly out of a pit with a jetpack, waiting for the fuel if it needs more', () => {
  for (const [depth, width, fuel] of [[300, 200, 100], [600, 90, 100], [400, 200, 15]]) {
    const t = pit(depth, width, { fuel });
    const ticks = run(t.game, 1800, t.out);
    assert.ok(t.out(), `${depth} deep (fuel ${fuel}): still in at ${t.bot.x.toFixed(0)},${t.bot.y.toFixed(0)}`);
    assert.ok(ticks < 600, `${depth} deep (fuel ${fuel}): out after ${(ticks / 60).toFixed(1)} s`);
    assert.equal(t.bot.deaths, 0, 'no self-destructing while the jetpack fills up');
  }
});

test('with no way out of its own, a bot self-destructs: the last resort, after a few seconds', () => {
  for (const kit of [{}, { fuel: 100 }]) {
    // (A jetpack can't fly 900 px up.)
    const t = pit(kit.fuel ? 900 : 300, 200, kit);
    const ticks = run(t.game, 900, () => t.ctl.destructing);
    assert.ok(t.ctl.destructing, `${JSON.stringify(kit)}: never self-destructed`);
    assert.ok(ticks > 200, `${JSON.stringify(kit)}: self-destructed after only ${(ticks / 60).toFixed(1)} s`);
    run(t.game, 120);
    assert.ok(t.feed.includes('Bot self-destructed'), t.feed.join('; '));
  }
});

// A hill a bot can't get to: on a ledge too high to jump to, on top of a tall block, or across a chasm.
const SCENES = {
  ledge: { platforms: [{ left: -900, top: 0, right: 900, bottom: 40 }, { left: 300, top: -220, right: 700, bottom: -180 }], hill: { left: 420, top: -310, right: 580, bottom: -220 } },
  block: { platforms: [{ left: -900, top: 0, right: 900, bottom: 40 }, { left: 300, top: -330, right: 900, bottom: 0 }], hill: { left: 500, top: -420, right: 700, bottom: -330 } },
  chasm: {
    platforms: [{ left: -900, top: 0, right: -100, bottom: 640 }, { left: 150, top: 0, right: 900, bottom: 640 }, { left: -100, top: 600, right: 150, bottom: 640 }],
    hill: { left: 300, top: -90, right: 500, bottom: 0 },
  },
  // (Destructible: a hole blown right through the floor in the middle.)
  crater: {
    platforms: [{ left: -900, top: 0, right: 0, bottom: 40 }, { left: 0, top: 0, right: 360, bottom: 40 }, { left: 360, top: 0, right: 900, bottom: 40 }],
    hill: { left: 400, top: -90, right: 600, bottom: 0 }, holes: [[100, 20, 60], [180, 20, 60], [260, 20, 60]],
  },
};

function hillScene(name, kit, items = []) {
  const sc = SCENES[name];
  const map = {
    name, bounds: { left: -950, top: -700, right: 950, bottom: 760 }, platforms: sc.platforms, items,
    spawns: [{ x: -600, y: -30 }, { x: -700, y: -30 }], objectives: [{ type: 'hill', ...sc.hill }],
  };
  const t = withBot(map, -500, -12, kit, {
    mode: 'koth', destruction: !!sc.holes,
    setup: game => {
      if (!sc.holes) return;
      game.map.solids[1].hard = false;   // (every floor here holds some mode's objective, so it's kept from breaking)
      for (const [x, y, r] of sc.holes) game.carve(x, y, r);
    },
  });
  t.onHill = () => t.bot.body.onGround && t.bot.x > sc.hill.left && t.bot.x < sc.hill.right && t.bot.y < sc.hill.bottom && t.bot.y > sc.hill.top;
  return t;
}

test("bots build (or fly) their way to an objective they can't get to: up to a ledge, onto a block, across a gap", () => {
  for (const [name, kit] of [['ledge', { hammer: 8 }], ['block', { hammer: 8 }], ['chasm', { hammer: 8 }], ['crater', { hammer: 8 }], ['ledge', { fuel: 100 }], ['chasm', { fuel: 100 }]]) {
    const t = hillScene(name, kit);
    assert.equal(t.nav.costsFrom(t.nav.nodeAt(-500, -12, 10)).cost[t.nav.nearest((SCENES[name].hill.left + SCENES[name].hill.right) / 2, SCENES[name].hill.bottom - 12, 90).id], Infinity, `${name}: no way there to start with`);
    const ticks = run(t.game, 60 * 30, t.onHill);
    assert.ok(t.onHill(), `${name} ${JSON.stringify(kit)}: not on the hill (at ${t.bot.x.toFixed(0)},${t.bot.y.toFixed(0)})`);
    assert.ok(ticks < 60 * 20, `${name} ${JSON.stringify(kit)}: took ${(ticks / 60).toFixed(1)} s`);
    assert.equal(t.bot.deaths, 0);
  }
  // Without a hammer or a jetpack, it doesn't get there (and doesn't blow itself up over it).
  const t = hillScene('ledge', {});
  run(t.game, 60 * 15);
  assert.ok(!t.onHill() && t.bot.alive && t.game.map.builtCount === 0);
});

test('a bot cut off with no way past of its own goes and gets a jetpack or hammer it can reach, then uses it', () => {
  const kinds = t => { const seen = new Set(); const think = t.ctl.think.bind(t.ctl); t.ctl.think = (g, so) => { think(g, so); seen.add(t.ctl.goalKind); }; return seen; };
  // In a pit, with one lying at the bottom.
  for (const what of ['jetpack', 'Hammer']) {
    const t = pit(300, 300, {}, [item(what, 100, 300)]);
    const seen = kinds(t);
    const ticks = run(t.game, 1800, t.out);
    assert.ok(t.out(), `${what} in the pit: still in at ${t.bot.x.toFixed(0)},${t.bot.y.toFixed(0)}`);
    // (A hammer is a weapon too: a bot with just a pistol may well want it anyway.)
    const got = what === 'jetpack' ? t.bot.body.hasJetpack : t.game.map.builtCount > 0;
    assert.ok(ticks < 900 && t.bot.deaths === 0 && got, `${what} in the pit: out after ${(ticks / 60).toFixed(1)} s, ${[...seen]}`);
  }
  // A hill up on a ledge or across a chasm, with one lying back the other way.
  for (const [name, what, x] of [['ledge', 'jetpack', -800], ['block', 'Hammer', -800], ['chasm', 'Hammer', -800], ['chasm', 'jetpack', -300]]) {
    const t = hillScene(name, {}, [item(what, x, 0)]);
    const seen = kinds(t);
    const ticks = run(t.game, 60 * 30, t.onHill);
    assert.ok(t.onHill(), `${name}, ${what} at ${x}: not on the hill (at ${t.bot.x.toFixed(0)},${t.bot.y.toFixed(0)})`);
    const got = what === 'jetpack' ? t.bot.body.hasJetpack : t.game.map.builtCount > 0;
    assert.ok(ticks < 60 * 20 && got, `${name}, ${what}: took ${(ticks / 60).toFixed(1)} s, ${[...seen]}`);
  }
  // Nothing in the way: no detour for one.
  const map = {
    name: 'open', bounds: { left: -950, top: -700, right: 950, bottom: 200 }, platforms: [{ left: -900, top: 0, right: 900, bottom: 40 }],
    items: [item('jetpack', -850, 0)], spawns: [{ x: -600, y: -30 }, { x: -700, y: -30 }], objectives: [{ type: 'hill', left: 400, top: -90, right: 600, bottom: 0 }],
  };
  const t = withBot(map, -500, -12, {}, { mode: 'koth' });
  const seen = kinds(t);
  run(t.game, 60 * 10);
  assert.ok(!seen.has('tool') && !t.bot.body.hasJetpack, [...seen].join(', '));
});

test('a bot hurt in a fight at range puts up a wall between itself and the enemy', () => {
  const map = {
    name: 'range', bounds: { left: -950, top: -400, right: 950, bottom: 200 }, items: [],
    platforms: [{ left: -900, top: 0, right: 900, bottom: 40 }],
    spawns: [{ x: -800, y: -30 }, { x: 800, y: -30 }],
  };
  const t = withBot(map, -200, -12, { hammer: 8 });
  const foe = t.game.addSoldier({ name: 'Foe', isBot: false }, { input: () => ({ move: 0 }) });
  t.game.respawn(foe);
  place(foe, 250, -12);
  foe.health = 1e6;   // (a dummy that takes the shots)
  t.bot.health = 40;
  const built = [];
  const add = t.game.addBlocks.bind(t.game);
  t.game.addBlocks = (boxes, b) => { built.push(...boxes); return add(boxes, b); };
  run(t.game, 400, () => built.length > 0);
  assert.equal(built.length, 1, 'a wall');
  const w = built[0];
  assert.ok(w.l > t.bot.x && w.r < foe.x, `between them: ${JSON.stringify(w)}, bot at ${t.bot.x.toFixed(0)}`);
  assert.ok(w.b === 0 && w.b - w.t >= 34, 'on the floor, tall enough to stand behind');
  assert.ok(w.l - t.bot.x < 60, 'right in front of the bot');
});
