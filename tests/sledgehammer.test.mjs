// The sledgehammer: everyone's melee weapon. It hits a little further and wider than the
// other melee weapons, and a swing that hits nobody chips away at the block it lands on
// (built blocks anywhere, the map's own on destructible maps; hard blocks never).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { WEAPONS, STARTING_WEAPONS } from '../web/src/weapons.js';
import { DEFAULT_SPEED } from '../web/src/config.js';

const FLOOR = { left: -400, top: 0, right: 400, bottom: 40 };
function arena(platforms = [FLOOR], options = {}) {
  const map = { name: 'arena', bounds: { left: -400, top: -300, right: 400, bottom: 200 }, spawns: [{ x: -300, y: -12, team: 1 }], items: [], platforms };
  return new Game({ mapData: map, effects: false, seed: 3, speed: DEFAULT_SPEED, mode: 'ffa', options });
}
function put(game, name, x, y = -12, ctl = () => ({ move: 0 })) {
  let t = 0;
  const s = game.addSoldier({ name, isBot: true }, { input: (g, me) => ctl(g, me, t++) });
  s.spawnAt({ x, y }, 0);
  return s;
}
const run = (game, n) => { for (let i = 0; i < n; i++) game.update(); };
/** Swing every `every` updates, aiming at `aim`. */
const swinging = (aim = 0, every = 60) => (g, s, t) => ({ move: 0, aim, aimDist: 100, fire: t % every === 0, firePressed: t % every === 0 });
function sledge(s) { s.weapons.Sledgehammer = { ammo: Infinity }; s.current = 'Sledgehammer'; }
/** Whether the way from soldier s, straight ahead at shoulder height, is clear for `far` px. */
const clearAhead = (game, s, far = 80) => !game.map.raycast(s.shoulderX, s.shoulderY, s.shoulderX + far, s.shoulderY);

test('everyone has a sledgehammer, the melee weapon that reaches furthest and widest', () => {
  assert.deepEqual(STARTING_WEAPONS, ['Platinum', 'Sledgehammer']);
  assert.ok(!WEAPONS.Prod, 'the prod is gone');
  const sh = WEAPONS.Sledgehammer;
  assert.equal(sh.kind, 'melee');
  assert.ok(sh.damage > 0 && sh.chip > 0);
  for (const def of Object.values(WEAPONS)) {
    if (def.kind !== 'melee' || def === sh) continue;
    assert.ok(sh.reach > def.reach, `reaches further than the ${def.name}`);
  }
  const game = arena();
  const s = put(game, 'A', 0);
  assert.ok(s.weapons.Sledgehammer, 'given at spawn');
});

test('the sledgehammer hits further than the old prod did, and higher up', () => {
  // Someone 38 px away: beyond the prod's reach (22), within the sledgehammer's (30).
  const game = arena();
  const a = put(game, 'A', 0, -12, swinging(0));
  sledge(a);
  const b = put(game, 'B', 38);
  run(game, 3);
  assert.equal(b.health, b.maxHealth - WEAPONS.Sledgehammer.damage, `hit at 38 px (${b.health})`);
  // Someone standing on a step up, well off to the side of where you aim.
  const g2 = arena([FLOOR, { left: 20, top: -26, right: 60, bottom: 0 }]);
  const c = put(g2, 'C', 0, -12, swinging(0));
  sledge(c);
  const d = put(g2, 'D', 30, -38);
  run(g2, 3);
  assert.ok(d.health < d.maxHealth, `hit up on the step (${d.health})`);
});

test('a swing at a destructible block chips at it; a few break through', () => {
  const game = arena([FLOOR, { left: 22, top: -70, right: 46, bottom: 0 }], { destruction: true });
  const a = put(game, 'A', 0, -12, swinging(0));
  sledge(a);
  assert.ok(!clearAhead(game, a), 'a wall in front');
  // (A swing on the first update, then one every 60.)
  run(game, 2);
  assert.ok(game.carves.length > 0, 'a chunk comes out (and goes to online players)');
  assert.ok(!clearAhead(game, a), 'one swing isn\'t enough');
  let swings = 1;
  while (!clearAhead(game, a) && swings < 10) { run(game, 60); swings++; }
  assert.ok(clearAhead(game, a), 'broken through');
  assert.ok(swings >= 2 && swings <= 5, `broken through in ${swings} swings`);
});

test('built blocks break on any map; the map\'s own and hard blocks don\'t', () => {
  // Destruction off: a built wall breaks, the map's wall doesn't.
  const game = arena([FLOOR, { left: 60, top: -70, right: 84, bottom: 0 }]);
  game.addBlocks([{ l: 22, t: -40, r: 34, b: 0 }], true);
  const a = put(game, 'A', 0, -12, swinging(0));
  sledge(a);
  for (let i = 0; i < 8; i++) run(game, 60);
  const hit = game.map.raycast(a.shoulderX, a.shoulderY, a.shoulderX + 120, a.shoulderY);
  assert.ok(hit && hit.solid.l >= 60, `through the built wall to the map's (${hit && hit.x})`);
  for (let i = 0; i < 8; i++) run(game, 60);
  const still = game.map.raycast(a.shoulderX, a.shoulderY, a.shoulderX + 120, a.shoulderY);
  assert.equal(Math.round(still.x), 60, 'the map\'s wall stands');
  // Destructible map, but a hard block: it stands too.
  const g2 = arena([FLOOR, { left: 22, top: -70, right: 46, bottom: 0, hard: true }], { destruction: true });
  const b = put(g2, 'B', 0, -12, swinging(0));
  sledge(b);
  for (let i = 0; i < 8; i++) run(g2, 60);
  assert.equal(Math.round(g2.map.raycast(b.shoulderX, b.shoulderY, b.shoulderX + 80, b.shoulderY).x), 22, 'hard blocks don\'t break');
  assert.equal(g2.carves.length, 0);
});

test('swinging down digs into the floor (destructible maps)', () => {
  const game = arena([{ left: -400, top: 0, right: -100, bottom: 30 }, { left: -100, top: 0, right: 400, bottom: 30 }], { destruction: true });
  // (Floors under spawn points and objectives never break: this one's made breakable for the test.)
  for (const s of game.map.solids) if (s.l === -100) s.hard = false;
  const a = put(game, 'A', 0, -12, swinging(Math.PI / 2 - 0.4));
  sledge(a);
  for (let i = 0; i < 6; i++) run(game, 60);
  assert.ok(game.carves.length >= 2, `dug (${game.carves.length} chunks)`);
});
