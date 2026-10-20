// The Engineer's Builder (classes on): walls, planks and repairs. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { GameMap } from '../web/src/map.js';
import { NavGraph } from '../web/src/nav.js';
import { explode } from '../web/src/combat.js';
import { buildPlan, BUILD } from '../web/src/building.js';
import { BLOCK_REGEN } from '../web/src/gadgets.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { setGameSpeed } from '../web/src/speed.js';
import { makeRng } from '../web/src/util.js';
import { loadMap } from './helpers.mjs';

// A floor in three pieces, a tall wall standing on it, and a ledge.
const YARD = {
  name: 'yard', bounds: { left: -800, top: -600, right: 800, bottom: 200 }, items: [],
  spawns: [{ x: -700, y: -12, team: 1 }, { x: 700, y: -12, team: 2 }],
  platforms: [
    { left: -800, top: 0, right: -400, bottom: 40 },
    { left: -400, top: 0, right: 400, bottom: 40 },
    { left: 400, top: 0, right: 800, bottom: 40 },
    { left: 100, top: -200, right: 124, bottom: 0 },
    { left: -300, top: -140, right: -150, bottom: -120 },
  ],
};

function yard(destruction = false) {
  return new Game({ mapData: YARD, mode: 'team', effects: false, seed: 3, speed: DEFAULT_SPEED, options: { classes: true, destruction } });
}

/**
 * An Engineer standing at x, and what they do: keys.at (where they aim), keys.click,
 * keys.g (one press each), keys.plank, keys.move.
 */
function engineer(game, x, keys = {}) {
  const s = game.addSoldier({ name: 'Eng', isBot: false, team: 1 }, {
    input: (g, me) => {
      const at = keys.at || { x: me.x + 100, y: me.y };
      const inp = {
        move: keys.move || 0, aim: Math.atan2(at.y - me.shoulderY, at.x - me.shoulderX), aimDist: Math.hypot(at.x - me.shoulderX, at.y - me.shoulderY),
        fire: !!keys.click, firePressed: !!keys.click, gadget: !!keys.g, plank: !!keys.plank,
      };
      keys.click = keys.g = false;
      return inp;
    },
  });
  s.pickCls = 'engineer';
  game.respawn(s);
  place(s, x);
  return { s, keys };
}
function place(s, x, y = -12) {
  s.body.x = x; s.body.y = y; s.body.vx = s.body.vy = 0; s.prevX = x; s.prevY = y;
  s.spawnProtect = 0;
}
const run = (game, n) => { for (let i = 0; i < n; i++) game.update(); };

/** Take out the Builder (G) and click at (x, y). Returns the blocks it added. */
function buildAt(game, eng, x, y) {
  const { s, keys } = eng;
  if (s.current !== 'Builder') { keys.g = true; game.update(); }
  keys.at = { x, y };
  s.cooldown = 0;
  const before = new Set(game.map.solids);
  keys.click = true;
  game.update();
  return game.map.solids.filter(p => !before.has(p));
}
const box = p => [p.l, p.t, p.r, p.b];

test('G takes out the Builder and puts it away again; a click puts up a wall standing on the floor', () => {
  const game = yard();
  const eng = engineer(game, -200);
  const { s, keys } = eng;
  assert.equal(s.current, 'Uzi');
  keys.g = true;
  game.update();
  assert.equal(s.current, 'Builder');
  keys.g = true;
  game.update();
  assert.equal(s.current, 'Uzi', 'back to what you had');
  assert.equal(s.slotChoice(9), 'Builder', 'or 0 picks it');
  const added = buildAt(game, eng, -120, -4);
  assert.deepEqual(added.map(box), [[-126, -40, -114, 0]], 'a 12 x 40 wall on the floor where you aim');
  assert.ok(added[0].built);
  assert.equal(s.weapons.Builder.ammo, 5, 'it used a block');
  // It's a wall: you can't walk through it, and it stops bullets.
  keys.move = 1;
  run(game, 120);
  assert.ok(s.x < -126 && s.x > -150, `stopped at the wall (${s.x})`);
  assert.ok(!game.map.clearLine(-200, -20, -50, -20), 'cover');
});

test('a right click turns it into a plank you can stand on; it reaches 150 px, and not through walls', () => {
  const game = yard();
  const eng = engineer(game, -200, { plank: true });
  const added = buildAt(game, eng, -100, -60);
  assert.deepEqual(added.map(box), [[-132, -65, -68, -55]], 'a 64 x 10 plank where you aim');
  const other = engineer(game, -100);
  place(other.s, -100, -80);
  run(game, 30);
  assert.ok(other.s.body.onGround && Math.abs(other.s.y - (-55 - 12 - 10)) < 1, 'standing on it');
  // Further than it reaches: as far as it goes, towards where you aim.
  const far = yard();
  const e2 = engineer(far, -300);
  const [w] = buildAt(far, e2, 300, -4);
  assert.ok(Math.abs((w.l + w.r) / 2 - e2.s.shoulderX) <= BUILD.reach + 1, `within reach (${w.l})`);
  // Through a wall: it goes against the near side of it.
  const e3 = engineer(far, 60, { plank: true });
  const pieces = buildAt(far, e3, 200, -30);
  assert.ok(pieces.length && pieces.every(p => p.r <= 100), `this side of the wall: ${JSON.stringify(pieces.map(box))}`);
});

test("you can't build in someone, by a spawn point, or outside the map", () => {
  const game = yard();
  const eng = engineer(game, -200);
  const other = engineer(game, -120);
  eng.keys.g = true;
  game.update();
  eng.keys.at = { x: -120, y: -4 };
  game.update();
  assert.match(buildPlan(game, eng.s).why, /in the way/);
  place(eng.s, -640);
  place(other.s, 300);
  eng.keys.at = { x: -690, y: -4 };
  game.update();
  assert.match(buildPlan(game, eng.s).why, /spawn/);
  place(eng.s, -760);
  eng.keys.at = { x: -900, y: -30 };
  eng.keys.plank = true;
  game.update();
  assert.match(buildPlan(game, eng.s).why, /bounds/);
  const before = game.map.solids.length;
  eng.s.cooldown = 0;
  eng.keys.click = true;
  game.update();
  assert.equal(game.map.solids.length, before, 'nothing built');
  assert.equal(eng.s.weapons.Builder.ammo, 6, 'no block used');
  assert.ok(game.notes.some(n => /Can't build there/.test(n.text)));
});

test('blocks come back over time (up to six); out of them, the Builder goes away until one does', () => {
  const game = yard();
  const eng = engineer(game, -200);
  const { s, keys } = eng;
  for (let i = 0; i < 6; i++) buildAt(game, eng, -150 + i * 40, -4);
  assert.equal(game.map.builtCount, 6);
  assert.equal(s.weapons.Builder.ammo, 0);
  assert.notEqual(s.current, 'Builder', 'out of blocks: back to a gun');
  keys.g = true;
  game.update();
  assert.notEqual(s.current, 'Builder');
  assert.ok(game.notes.some(n => /No blocks left/.test(n.text)));
  const every = BLOCK_REGEN / DEFAULT_SPEED;
  run(game, Math.ceil(every) + 1);
  assert.equal(s.weapons.Builder.ammo, 1, `one back after ${every / 60} s`);
  run(game, Math.ceil(every * 8));
  assert.equal(s.weapons.Builder.ammo, 6, 'no more than the kit gives');
});

test('explosions break built blocks, even on maps that otherwise don\'t break', () => {
  const game = yard(false);
  const eng = engineer(game, -200);
  buildAt(game, eng, -120, -4);
  place(eng.s, -300);
  const map = () => game.map.solids.filter(p => !p.built).map(box);
  const before = map();
  explode(game, -120, -20, { radius: 60, damage: 0, knock: 0 }, null, 'Bazooka');
  assert.equal(game.map.builtCount, 0, 'the wall is gone');
  assert.deepEqual(map(), before, 'the map itself is untouched');
});

test('on a destructible map, the Builder repairs what explosions broke (as it was), but not into anyone', () => {
  const game = yard(true);
  const ledge = game.map.solids.find(p => p.t === -140);
  assert.ok(!ledge.hard);
  game.carve(-225, -130, 24);
  const covered = (x, y) => !!game.map.overlap(x - 0.25, y - 0.25, x + 0.25, y + 0.25);
  assert.ok(!covered(-225, -130), 'a hole in the ledge');
  const eng = engineer(game, -225);
  // Someone in the way: the repair leaves room for them.
  const other = engineer(game, -100);
  place(other.s, -240, -125);
  eng.keys.g = true;
  game.update();
  place(other.s, -240, -125);
  eng.keys.at = { x: -225, y: -130 };
  game.update();
  place(other.s, -240, -125);
  const plan = buildPlan(game, eng.s);
  assert.equal(plan.kind, 'repair');
  assert.ok(plan.ok);
  const ob = { l: -246, t: -148, r: -234, b: -112 };
  assert.ok(plan.boxes.every(b => b.r <= ob.l || b.l >= ob.r || b.b <= ob.t || b.t >= ob.b), 'not into the soldier there');
  // Nobody there: it's put back just as it was.
  place(other.s, 300);
  eng.s.cooldown = 0;
  eng.keys.click = true;
  game.update();
  for (let x = ledge.l + 0.5; x < ledge.r; x += 3) for (let y = ledge.t + 0.5; y < ledge.b; y += 3) assert.ok(covered(x, y), `repaired at ${x},${y}`);
  assert.ok(game.map.solids.every(p => !p.built), 'repairs are the map again (not built blocks)');
  assert.equal(eng.s.weapons.Builder.ammo, 5);
});

test("the bots' route map, patched after building, gets everywhere a fresh one would", () => {
  setGameSpeed(DEFAULT_SPEED);
  for (const file of ['ssdm4.json', 'crossfire.json']) {
    const map = new GameMap(loadMap(file));
    const nav = new NavGraph(map);
    const rng = makeRng(5);
    for (let i = 0; i < 10; i++) {
      const s = map.solids[Math.floor(rng() * map.solids.length)];
      const x = Math.round(s.l + rng() * (s.r - s.l));
      // Walls on floors, and planks in the air.
      const area = i % 2 ? map.add(x - 6, s.t - 40, x + 6, s.t, true) : map.add(x - 32, s.t - 70, x + 32, s.t - 60, true);
      if (area) nav.patch(area);
    }
    const fresh = new NavGraph(map);
    for (const p of map.spawns) {
      const reach = g => { const st = g.landing(p.x, p.y); if (!st) return []; const c = g.costsFrom(st).cost; return g.nodes.filter((n, i) => c[i] < Infinity); };
      const a = reach(nav), b = reach(fresh);
      const near = (n, list) => list.some(o => Math.abs(o.y - n.y) < 1 && Math.abs(o.x - n.x) <= 14);
      assert.ok(a.every(n => near(n, b)) && b.every(n => near(n, a)), `${file}: reach from ${p.x},${p.y}`);
    }
  }
});
