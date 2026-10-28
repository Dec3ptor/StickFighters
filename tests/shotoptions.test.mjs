// The experimental bullet speed and time between shots options. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { WEAPONS } from '../web/src/weapons.js';
import { fire, shotSpeed, shotDelay } from '../web/src/combat.js';
import { DEFAULT_SPEED } from '../web/src/config.js';

function arena(options = {}) {
  const map = { name: 'arena', bounds: { left: -900, top: -400, right: 900, bottom: 200 }, spawns: [{ x: 0, y: -12, team: 1 }], items: [], platforms: [{ left: -900, top: 0, right: 900, bottom: 40 }] };
  const game = new Game({ mapData: map, effects: false, seed: 3, speed: DEFAULT_SPEED, options });
  const s = game.addSoldier({ name: 'Shooter', isBot: true }, { input: () => ({ move: 0 }) });
  s.spawnAt({ x: -800, y: -12 }, 0);
  s.aim = 0;
  return { game, s };
}

/** Fire weapon id once; returns what it fired and the wait before the next shot. */
function shoot(options, id) {
  const { game, s } = arena(options);
  s.weapons[id] = WEAPONS[id].mag ? { ammo: Infinity, mag: WEAPONS[id].mag } : { ammo: 5 };
  s.current = id;
  assert.ok(fire(game, s, { firePressed: true }), `${id} fired`);
  return { shots: game.projectiles, cooldown: s.cooldown, game };
}

test('bullet speed: bullets fly that many times as fast, and still go as far', () => {
  const plain = shoot({}, 'M4').shots[0], fast = shoot({ bulletSpeed: 3 }, 'M4').shots[0];
  const speed = p => Math.hypot(p.vx, p.vy);
  assert.ok(Math.abs(speed(fast) - 3 * speed(plain)) < 1e-6, `${speed(fast)} vs ${speed(plain)}`);
  assert.ok(Math.abs(fast.life * speed(fast) - plain.life * speed(plain)) < 1e-6, 'the same range');
  // Shotgun pellets too; rockets, grenades and arrows aren't bullets.
  assert.ok(speed(shoot({ bulletSpeed: 2 }, 'Shotgun').shots[0]) > WEAPONS.Shotgun.speed * 1.6);
  for (const id of ['Bazooka', 'GrenadeLauncher', 'Longbow']) {
    const g = shoot({ bulletSpeed: 3 }, id);
    assert.equal(shotSpeed(g.game, WEAPONS[id]), WEAPONS[id].speed, id);
  }
});

test("time between shots: every weapon's wait is that share of what it was", () => {
  for (const id of ['Platinum', 'M4', 'Shotgun', 'SR', 'Bazooka', 'GrenadeLauncher']) {
    const plain = shoot({}, id).cooldown, quick = shoot({ fireDelay: 0.5 }, id).cooldown;
    assert.equal(plain, WEAPONS[id].rof, id);
    assert.ok(Math.abs(quick - plain / 2) < 1e-9, `${id}: ${quick} vs ${plain}`);
  }
  const { game } = arena({ fireDelay: 0.75 });
  assert.equal(shotDelay(game, WEAPONS.M4), WEAPONS.M4.rof * 0.75);
});

test('a fast bullet still hits someone in the way (and not through a wall)', () => {
  const { game, s } = arena({ bulletSpeed: 6 });
  const target = game.addSoldier({ name: 'Target', isBot: true }, { input: () => ({ move: 0 }) });
  target.spawnAt({ x: -650, y: -12 }, 0);
  target.spawnProtect = 0;
  s.weapons.M4 = { ammo: 5 };
  s.current = 'M4';
  fire(game, s, { firePressed: true });
  for (let t = 0; t < 10; t++) game.update();
  assert.ok(target.health < target.maxHealth, 'hit');
});
