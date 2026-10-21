// Destructible maps: explosions blow holes in blocks, the bots' route map keeps up,
// and the floors spawn points and objectives stand on can't be destroyed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { GameMap, seamsOf } from '../web/src/map.js';
import { NavGraph } from '../web/src/nav.js';
import { BotController, BOT_PROFILES } from '../web/src/bot.js';
import { explode } from '../web/src/combat.js';
import { makeRng } from '../web/src/util.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { setGameSpeed } from '../web/src/speed.js';
import { mapIndex, loadMap } from './helpers.mjs';

// A floor with a wall standing on it at x 200..224, and a ledge on the left.
const ROOM = {
  name: 'room', bounds: { left: -600, top: -500, right: 600, bottom: 200 }, items: [],
  spawns: [{ x: -400, y: -40, team: 1 }, { x: 400, y: -40, team: 2 }],
  platforms: [
    { left: -600, top: 0, right: 600, bottom: 24 },
    { left: 200, top: -200, right: 224, bottom: 0 },
    { left: -300, top: -120, right: -150, bottom: -100, hard: true },
    { left: -60, top: -80, right: 0, bottom: -70, bounce: -7 },
  ],
};

test('a hole: blocks hit are split around it, hard blocks and jump pads stay whole', () => {
  const map = new GameMap(ROOM);
  const wall = map.solids[1];
  const area = map.carve(212, -60, 30);
  assert.ok(area && area.l <= 200 && area.r >= 224, 'the wall changed');
  assert.ok(!map.solids.includes(wall), 'the old wall block is gone');
  assert.equal(map.overlap(205, -70, 219, -50), null, "there's a hole through it");
  assert.ok(map.overlap(205, -190, 219, -180) && map.overlap(205, -10, 219, -2), 'above and below it are still there');
  assert.ok(map.version > 0);
  // Hard blocks and jump pads don't break.
  const before = map.solids.length;
  assert.equal(map.carve(-225, -110, 40), null);
  assert.equal(map.carve(-30, -75, 20), null);
  assert.equal(map.solids.length, before);
  // Nothing there: no change.
  assert.equal(map.carve(0, -400, 30), null);
});

test('after lots of holes, lookups still match checking every block', () => {
  const map = new GameMap(loadMap('ssdm2.json'));
  const rng = makeRng(4);
  const b = map.bounds;
  for (let i = 0; i < 60; i++) map.carve(Math.round(b.left + rng() * (b.right - b.left)), Math.round(b.top + rng() * (b.bottom - b.top)), 15 + Math.floor(rng() * 40));
  const brute = (l, t, r, bt) => map.solids.find(s => l < s.r && r > s.l && t < s.b && bt > s.t) || null;
  for (let i = 0; i < 2000; i++) {
    const x = b.left + rng() * (b.right - b.left), y = b.top + rng() * (b.bottom - b.top);
    assert.equal(!!map.overlap(x - 6, y - 22, x + 6, y + 12), !!brute(x - 6, y - 22, x + 6, y + 12));
  }
  // No slivers, and the seams found by area are the same as checking every pair.
  assert.ok(map.solids.every(s => s.r - s.l >= 4 && s.b - s.t >= 4));
  const key = s => (s.x !== undefined ? `x${s.x}:${s.t}-${s.b}` : `y${s.y}:${s.l}-${s.r}`);
  assert.deepEqual(map.getSeams().map(key).sort(), seamsOf(map.solids).map(key).sort());
});

function room(destruction = true) {
  return new Game({ mapData: ROOM, mode: 'team', effects: false, seed: 2, speed: DEFAULT_SPEED, options: { destruction } });
}

test('an explosion blows a hole in a wall, and you can walk through it (only with Destruction on)', () => {
  for (const on of [true, false]) {
    const game = room(on);
    const s = game.addSoldier({ name: 'Walker', isBot: false, team: 1 }, { input: () => ({ move: 1 }) });
    s.spawnAt({ x: 120, y: -12 }, 0);
    explode(game, 200, -20, { radius: 95, damage: 0, knock: 0 }, null, 'Bazooka');
    for (let i = 0; i < 180; i++) game.update();
    assert.equal(s.x > 240, on, on ? 'walked through the hole' : 'the wall stopped them');
    assert.equal(game.carves.length, on ? 1 : 0);
  }
});

test("floors under spawn points and objectives can't be destroyed; others can, and you fall through", () => {
  const game = room();
  assert.ok(game.map.solids[0].hard, 'the floor with the spawn points on it');
  const data = { ...ROOM, platforms: [...ROOM.platforms, { left: -500, top: -260, right: -100, bottom: -240 }] };
  const g2 = new Game({ mapData: data, mode: 'koth', effects: false, seed: 2, speed: DEFAULT_SPEED, options: { destruction: true } });
  const ledge = g2.map.solids.find(p => p.t === -260);
  assert.ok(!ledge.hard, 'a ledge with nothing on it');
  const s = g2.addSoldier({ name: 'Stander', isBot: false, team: 1 }, { input: () => ({ move: 0 }) });
  s.spawnAt({ x: -300, y: -272 }, 0);
  for (let i = 0; i < 10; i++) g2.update();
  assert.ok(s.body.onGround);
  g2.carve(-300, -250, 30);
  for (let i = 0; i < 60; i++) g2.update();
  assert.ok(s.y > -200, 'fell through the hole');
});

test("the bots' route map, patched after holes, gets everywhere a fresh one would", () => {
  setGameSpeed(DEFAULT_SPEED);
  for (const file of ['ssdm4.json', 'crossfire.json']) {
    const map = new GameMap(loadMap(file));
    const nav = new NavGraph(map);
    const rng = makeRng(11);
    for (let i = 0; i < 8; i++) {
      const breakable = map.solids.filter(s => !s.hard);
      const s = breakable[Math.floor(rng() * breakable.length)];
      const area = map.carve(Math.round(s.l + rng() * (s.r - s.l)), Math.round(s.t + rng() * (s.b - s.t)), 20 + Math.floor(rng() * 30));
      if (area) nav.patch(area);
    }
    const fresh = new NavGraph(map);
    // From each spawn: every spot one reaches, the other reaches a spot within a step of it.
    for (const p of map.spawns) {
      const reach = g => { const st = g.landing(p.x, p.y); const c = g.costsFrom(st).cost; return g.nodes.filter((n, i) => c[i] < Infinity); };
      const a = reach(nav), b = reach(fresh);
      const covered = (n, list) => list.some(o => Math.abs(o.y - n.y) < 1 && Math.abs(o.x - n.x) <= 14);
      assert.ok(a.every(n => covered(n, b)) && b.every(n => covered(n, a)), `${file}: reach from ${p.x},${p.y}`);
    }
  }
});

test('bots use a hole blown in a wall', () => {
  // The bot is boxed in on the left by a tall wall; a Shotgun lies beyond it.
  const data = {
    name: 'boxed', bounds: { left: -600, top: -600, right: 600, bottom: 200 }, spawns: [{ x: -400, y: -40, team: 1 }],
    items: [{ type: 'weapon', weapon: 'Shotgun', x: 400, y: -10 }],
    platforms: [{ left: -600, top: 0, right: 600, bottom: 24 }, { left: 0, top: -500, right: 24, bottom: 0 }],
  };
  const game = new Game({ mapData: data, mode: 'ffa', effects: false, seed: 3, speed: DEFAULT_SPEED, options: { destruction: true } });
  const nav = game.useNav(new NavGraph(game.map));
  const bot = game.addSoldier({ name: 'Bot', isBot: true }, new BotController(nav, 'normal', BOT_PROFILES[0], makeRng(2)));
  bot.spawnAt({ x: -300, y: -12 }, 0);
  for (let i = 0; i < 300; i++) game.update();
  assert.ok(bot.x < 0, "can't get past the wall");
  explode(game, 12, -20, { radius: 95, damage: 0, knock: 0 }, null, 'Bazooka');
  let t = 0;
  while (!bot.weapons.Shotgun && t++ < 900) game.update();
  assert.ok(bot.weapons.Shotgun, `went through the hole for the Shotgun (at ${bot.x.toFixed(0)})`);
});

test('bot matches on destructible maps: holes get blown and everything keeps working', () => {
  for (const m of mapIndex().filter(m => ['ssdm2.json', 'citadel.json'].includes(m.file))) {
    const game = new Game({ mapData: loadMap(m.file), mode: m.size ? 'rush' : 'team', fragLimit: 999, effects: false, seed: 6, speed: DEFAULT_SPEED, options: { destruction: true } });
    const nav = game.useNav(new NavGraph(game.map));
    const rng = makeRng(5);
    for (let i = 0; i < 12; i++) {
      const p = BOT_PROFILES[i % BOT_PROFILES.length];
      game.addSoldier({ name: p.name + i, isBot: true, team: 1 + (i % 2), profile: p }, new BotController(nav, 'normal', p, rng));
    }
    for (let i = 0; i < 2400; i++) {
      game.update();
      // Bazookas for everyone (from time to time: respawning starts them with the usual kit).
      if (i % 300 === 1) for (const s of game.soldiers) if (s.alive) s.weapons.Bazooka = { ammo: 20 };
    }
    assert.ok(game.carves.length >= 2, `${m.name}: ${game.carves.length} holes`);
    assert.ok(game.stats.kills > 10, `${m.name}: ${game.stats.kills} kills`);
    assert.ok(game.soldiers.every(s => Number.isFinite(s.x) && Number.isFinite(s.y)));
  }
});

test("a hole's route map patch is spread over several updates (a few spots each), and ends up as one done all at once", () => {
  setGameSpeed(DEFAULT_SPEED);
  const data = loadMap('frontline.json');
  const game = new Game({ mapData: data, mode: 'team', effects: false, seed: 2, speed: DEFAULT_SPEED, options: { destruction: true } });
  game.useNav(new NavGraph(new GameMap(data)));
  const nav = game.nav;
  let relinked = 0;
  const link = nav._linkNode.bind(nav);
  nav._linkNode = (...a) => { relinked++; return link(...a); };
  const breakable = game.map.solids.filter(s => !s.hard && s.r - s.l > 100);
  const s = breakable[3];
  game.carve(Math.round((s.l + s.r) / 2), s.t, 30);
  let most = 0, updates = 0;
  for (let i = 0; i < 400 && (game.navDirty || game.navJob || !updates); i++) {
    relinked = 0;
    game.update();
    if (game.navJob || relinked) updates++;
    most = Math.max(most, relinked);
  }
  assert.ok(!game.navDirty && !game.navJob, 'finished');
  assert.ok(most <= 6, `at most 6 spots in one update (${most})`);
  assert.ok(updates > 1, `spread over ${updates} updates`);
  // The same as patching it all at once.
  const map2 = new GameMap(data), all = new NavGraph(map2);
  all.patch(map2.carve(Math.round((s.l + s.r) / 2), s.t, 30));
  const sig = g => g.nodes.map(a => `${a.x.toFixed(3)},${a.y}:` + a.links.map(l => `${l.type}>${l.to.id}@${l.cost.toFixed(4)}`).join('|')).join('\n');
  assert.equal(sig(nav), sig(all));
});

test('patching only re-simulates the jumps and drops that went near the change, with the same result as redoing them all', () => {
  setGameSpeed(DEFAULT_SPEED);
  const sig = g => g.nodes.map(a => `${a.x.toFixed(3)},${a.y}:` + a.links.map(l => `${l.type}>${l.to.id}@${l.cost.toFixed(4)}`).join('|')).join('\n');
  for (const file of ['ssteam1.json', 'citadel.json']) {
    const m1 = new GameMap(loadMap(file)), m2 = new GameMap(loadMap(file));
    const quick = new NavGraph(m1), full = new NavGraph(m2);
    const rng = makeRng(17);
    for (let i = 0; i < 8; i++) {
      const breakable = m1.solids.filter(s => !s.hard);
      const s = breakable[Math.floor(rng() * breakable.length)];
      const x = Math.round(s.l + rng() * (s.r - s.l)), y = Math.round(s.t + rng() * (s.b - s.t)), r = 20 + Math.floor(rng() * 30);
      const a1 = i % 3 === 2 ? m1.add(x - 6, s.t - 40, x + 6, s.t, true) : m1.carve(x, y, r);
      const a2 = i % 3 === 2 ? m2.add(x - 6, s.t - 40, x + 6, s.t, true) : m2.carve(x, y, r);
      if (!a1) continue;
      quick.patch(a1);
      for (const n of full.nodes) n.tries = null; // (nothing remembered: every try simulated again)
      full.patch(a2);
      assert.equal(sig(quick), sig(full), `${file}, change ${i}`);
    }
  }
});
