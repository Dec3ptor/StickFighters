// The special weapons: throws, animals, strikes, melee, tools. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { WEAPONS, WEAPON_ORDER, SLOTS, CRATE_WEIGHTS, PICKUP_WEAPONS } from '../web/src/weapons.js';
import { lobAngle } from '../web/src/bot.js';
import { fire } from '../web/src/combat.js';
import { DEFAULT_SPEED } from '../web/src/config.js';

const FLOOR = [{ left: -900, top: 0, right: 900, bottom: 40 }];

function arena({ platforms = FLOOR, mode = 'ffa', seed = 3, options = {}, bounds } = {}) {
  const map = { name: 'arena', bounds: bounds || { left: -900, top: -400, right: 900, bottom: 200 }, spawns: [{ x: 0, y: -12, team: 1 }], items: [], platforms };
  return new Game({ mapData: map, effects: false, seed, speed: DEFAULT_SPEED, mode, options });
}

/** A soldier standing at (x, y) that does whatever `ctl(game, s, tick)` says each tick. */
function put(game, name, x, y, ctl = () => ({ move: 0 })) {
  let t = 0;
  const s = game.addSoldier({ name, isBot: true }, { input: (g, me) => ctl(g, me, t++) });
  s.spawnAt({ x, y }, 0);
  return s;
}

/** Fire once (on the first tick), aiming with `aim` and `aimDist`, then stand still (or do `after`). */
const fireOnce = (aim, aimDist = 200, after = () => ({ move: 0 })) => (g, s, t) =>
  t === 0 ? { move: 0, aim, aimDist, fire: true, firePressed: true } : { aim, aimDist, ...after(g, s, t) };

const run = (game, until, max = 2000) => { let t = 0; while (!until() && t++ < max) game.update(); return t; };

function arm(s, id, ammo = 5) {
  s.weapons[id] = WEAPONS[id].mag ? { ammo: Infinity, mag: WEAPONS[id].mag } : { ammo };
  s.current = id;
}

/** Angle to lob a throw from soldier s onto (x, y). */
const lob = (s, id, x, y) => lobAngle(x - s.shoulderX, y - s.shoulderY, WEAPONS[id].speed, WEAPONS[id].gravity);

test('every weapon has a name, slot, look and bot numbers, and every slot key has a weapon', () => {
  for (const id of Object.keys(WEAPONS)) {
    const w = WEAPONS[id];
    assert.ok(w.name && w.short && w.look && w.bot, `${id} is missing fields`);
    assert.ok(w.slot >= 0 && w.slot < SLOTS.length, `${id} slot`);
  }
  for (let i = 0; i < SLOTS.length; i++) assert.ok(WEAPON_ORDER.some(id => WEAPONS[id].slot === i), `slot ${SLOTS[i].key} is empty`);
  for (const id of Object.keys(CRATE_WEIGHTS)) assert.ok(PICKUP_WEAPONS.includes(id), `crate weapon ${id}`);
  assert.ok(WEAPON_ORDER.length >= 35, `only ${WEAPON_ORDER.length} weapons`);
});

for (const [id, gap] of [['ClusterBomb', 260], ['BananaBomb', 280], ['HolyHandGrenade', 330], ['PetrolBomb', 240], ['Mortar', 300]]) {
  test(`${WEAPONS[id].name}: lobbed onto someone, it frags them`, () => {
    const game = arena();
    const a = put(game, 'A', 0, -12);
    arm(a, id);
    const angle = WEAPONS[id].kind === 'thrown' ? lob(a, id, gap, -8) : lobAngle(gap - a.shoulderX, -8 - a.shoulderY, WEAPONS[id].speed, WEAPONS[id].gravity);
    a.controller = null;
    game.controllers.set(a, { input: fireOnceTicker(angle) });
    const b = put(game, 'B', gap, -12);
    run(game, () => !b.alive, 1500);
    assert.equal(b.alive, false, `${id} didn't frag the target (health ${b.health.toFixed(0)})`);
    assert.ok(a.alive, 'thrower survived');
    assert.equal(a.frags, 1);
  });
}

function fireOnceTicker(angle) {
  let t = 0;
  return () => (t++ === 0 ? { move: 0, aim: angle, aimDist: 9999, fire: true, firePressed: true } : { move: 0, aim: angle, aimDist: 9999 });
}

test('Cluster bombs and mortars burst into bomblets', () => {
  for (const [id, n] of [['ClusterBomb', 5], ['Mortar', 6]]) {
    const game = arena();
    const a = put(game, 'A', 0, -12, fireOnce(-Math.PI / 3, 9999));
    arm(a, id);
    let most = 0;
    run(game, () => { most = Math.max(most, game.projectiles.filter(p => p.sprite === 'bomblet').length); return false; }, 500);
    assert.equal(most, n, `${id} bomblets`);
  }
});

test('Holy Hand Grenade sings before it goes off', () => {
  const game = arena();
  const a = put(game, 'A', 0, -12, fireOnce(-0.6, 9999));
  arm(a, 'HolyHandGrenade');
  run(game, () => game.sounds.some(s => s.name === 'hallelujah'), 600);
  assert.ok(game.sounds.some(s => s.name === 'hallelujah'));
});

test('Skunk gas poisons whoever stands in it', () => {
  const game = arena();
  const a = put(game, 'A', 0, -12);
  arm(a, 'Skunk');
  game.controllers.set(a, { input: fireOnceTicker(lob(a, 'Skunk', 200, -8)) });
  const b = put(game, 'B', 200, -12);
  let lowest = 100;
  run(game, () => { lowest = Math.min(lowest, b.health); return b.deaths > 0; }, 900);
  assert.ok(lowest < 60, `gas did only ${100 - lowest} damage`);
});

test('Sheep walks to the enemy and explodes; mad cows too', () => {
  for (const id of ['Sheep', 'MadCow']) {
    const game = arena();
    const a = put(game, 'A', 0, -12, fireOnce(0));
    arm(a, id);
    const b = put(game, 'B', 260, -12);
    run(game, () => !b.alive, 900);
    assert.equal(b.alive, false, `${id} didn't get them`);
    assert.equal(a.frags, 1);
  }
});

test('Sheep can be set off early with a second click', () => {
  const game = arena();
  const a = put(game, 'A', 0, -12, (g, s, t) => ({ move: 0, aim: 0, fire: t === 0 || t === 60, firePressed: t === 0 || t === 60 }));
  arm(a, 'Sheep');
  run(game, () => game.projectiles.length > 0, 10);
  const sheep = game.projectiles[0];
  run(game, () => sheep.dead, 120);
  assert.ok(sheep.dead, 'sheep went off');
  assert.ok(game.tick < 100, `went off at tick ${game.tick}`);
});

test('Sheep hop over small walls and turn round at big ones', () => {
  const game = arena({ platforms: [...FLOOR, { left: 100, top: -14, right: 120, bottom: 0 }, { left: 300, top: -200, right: 320, bottom: 0 }] });
  const a = put(game, 'A', 0, -12, fireOnce(0));
  arm(a, 'Sheep');
  let furthest = 0, turned = false;
  run(game, () => {
    const p = game.projectiles.find(q => q.kind === 'walker');
    if (p) { furthest = Math.max(furthest, p.x); if (p.dir < 0) turned = true; }
    return !p && game.tick > 5;
  }, 700);
  assert.ok(furthest > 130, `got past the small wall (furthest ${furthest.toFixed(0)})`);
  assert.ok(furthest < 300, 'stopped at the big wall');
  assert.ok(turned, 'turned around');
});

test('Super sheep flies where its owner aims', () => {
  const game = arena();
  const a = put(game, 'A', 0, -12);
  const b = put(game, 'B', 320, -12);
  arm(a, 'SuperSheep');
  // Aim up and away first, then at the target: the sheep follows the aim.
  game.controllers.set(a, { input: (g, s) => {
    const t = g.tick;
    const aim = t < 40 ? -1.2 : Math.atan2(b.y - 8 - s.shoulderY, b.x - s.shoulderX);
    const aimDist = t < 40 ? 200 : Math.hypot(b.x - s.shoulderX, b.y - 8 - s.shoulderY);
    return { move: 0, aim, aimDist, fire: t === 1, firePressed: t === 1 };
  } });
  let highest = 0;
  run(game, () => { const p = game.projectiles.find(q => q.kind === 'flyer'); if (p) highest = Math.min(highest, p.y); return !b.alive; }, 600);
  assert.ok(highest < -60, 'went up first');
  assert.equal(b.alive, false, 'then came down on the target');
});

test('Old woman wanders off and explodes when her time is up', () => {
  const game = arena();
  const a = put(game, 'A', 0, -12, fireOnce(0, 200, () => ({ move: -1 })));
  arm(a, 'OldWoman');
  const b = put(game, 'B', 330, -12);
  run(game, () => !b.alive, 900);
  assert.equal(b.alive, false);
});

test('Dynamite: drop it and run', () => {
  const game = arena();
  const a = put(game, 'A', 0, -12, fireOnce(0, 200, (g, s, t) => ({ move: t > 2 ? -1 : 0 })));
  arm(a, 'Dynamite');
  const b = put(game, 'B', 40, -12);
  run(game, () => !b.alive, 700);
  assert.equal(b.alive, false);
  assert.ok(a.alive, 'got away');
});

test('Mines arm, then go off when an enemy walks over them', () => {
  const game = arena();
  const a = put(game, 'A', 0, -12, fireOnce(0, 200, (g, s, t) => ({ move: t < 60 ? -1 : 0 })));
  arm(a, 'Mine');
  const b = put(game, 'B', 400, -12, (g, s, t) => ({ move: t > 200 ? -1 : 0 }));
  run(game, () => !b.alive, 900);
  assert.equal(b.alive, false);
  assert.equal(a.frags, 1);
});

test('Air strikes, napalm and the concrete donkey fall where you aim', () => {
  for (const id of ['AirStrike', 'NapalmStrike', 'ConcreteDonkey']) {
    const game = arena();
    const a = put(game, 'A', 0, -12);
    const b = put(game, 'B', 350, -12);
    arm(a, id);
    game.controllers.set(a, { input: fireOnceTicker2(Math.atan2(-12 - a.shoulderY, 350 - a.shoulderX), Math.hypot(350 - a.shoulderX, -12 - a.shoulderY)) });
    run(game, () => !b.alive, 1500);
    assert.equal(b.alive, false, `${id}: target health ${b.health.toFixed(0)}`);
    assert.ok(a.alive, `${id}: caller survived`);
  }
});

function fireOnceTicker2(angle, dist) {
  let t = 0;
  return () => (t++ === 0 ? { move: 0, aim: angle, aimDist: dist, fire: true, firePressed: true } : { move: 0, aim: angle, aimDist: dist });
}

test('Earthquake shakes enemies off ledges, and the frag is yours', () => {
  const game = arena({ seed: 9, platforms: [{ left: -400, top: 0, right: 0, bottom: 40 }, { left: 200, top: 0, right: 230, bottom: 40 }] });
  const a = put(game, 'A', -200, -12, fireOnce(0));
  arm(a, 'Earthquake');
  const b = put(game, 'B', 215, -12);
  run(game, () => !b.alive, 900);
  assert.equal(b.alive, false, 'shaken off');
  assert.equal(a.frags, 1);
});

test('Teleport moves you to where you aim, but not into walls', () => {
  const game = arena({ platforms: [...FLOOR, { left: 150, top: -300, right: 250, bottom: 0 }] });
  const a = put(game, 'A', 0, -12);
  arm(a, 'Teleport', 3);
  // Into the wall: refused, ammo kept.
  game.controllers.set(a, { input: fireOnceTicker2(0, 200 - 0) });
  run(game, () => false, 5);
  assert.ok(Math.abs(a.x) < 5, 'stayed put');
  assert.equal(a.weapons.Teleport.ammo, 3);
  // Up into open air: works.
  const g2 = arena();
  const b = put(g2, 'B', 0, -12);
  arm(b, 'Teleport', 3);
  g2.controllers.set(b, { input: fireOnceTicker2(-Math.PI / 2, 150) });
  run(g2, () => false, 3);
  assert.ok(b.y < -120, `teleported up (y ${b.y.toFixed(0)})`);
  assert.equal(b.weapons.Teleport.ammo, 2);
});

test('Kamikaze: fly into the enemy and take them with you, without losing a frag', () => {
  const game = arena();
  const a = put(game, 'A', 0, -12, fireOnce(-0.05));
  arm(a, 'Kamikaze', 1);
  const b = put(game, 'B', 180, -12);
  run(game, () => !b.alive && !a.alive, 300);
  assert.equal(b.alive, false);
  assert.equal(a.alive, false);
  assert.equal(a.frags, 1, 'kamikaze kill counts, the suicide does not cost a frag');
});

test('Ninja rope: grab the ceiling, swing, let go', () => {
  const game = arena({ platforms: [...FLOOR, { left: -300, top: -260, right: 300, bottom: -240 }] });
  const a = put(game, 'A', 0, -12, (g, s, t) => ({ move: t < 60 ? 1 : 0, jump: t > 1 && t < 40, aim: -Math.PI / 2 + 0.4, fire: t === 0 || t === 90, firePressed: t === 0 || t === 90 }));
  arm(a, 'NinjaRope', Infinity);
  run(game, () => false, 2);
  assert.ok(a.body.rope, 'rope attached');
  run(game, () => false, 40);
  assert.ok(a.y < -40, `climbed the rope (y ${a.y.toFixed(0)})`);
  run(game, () => false, 60);
  assert.equal(a.body.rope, null, 'let go');
});

test('Melee: prod and bat knock people off ledges (your frag); the axe halves health; fire punch launches', () => {
  for (const id of ['Prod', 'BaseballBat']) {
    const game = arena({ platforms: [{ left: -300, top: 0, right: 40, bottom: 40 }] });
    const a = put(game, 'A', 0, -12, (g, s, t) => ({ move: 0, aim: 0, fire: t % 30 === 0, firePressed: t % 30 === 0 }));
    arm(a, id, Infinity);
    const b = put(game, 'B', 16, -12);
    run(game, () => !b.alive, 600);
    assert.equal(b.alive, false, `${id} didn't knock them off`);
    assert.equal(a.frags, 1, `${id} frag`);
  }
  const g = arena();
  const a = put(g, 'A', 0, -12, fireOnce(0));
  arm(a, 'BattleAxe');
  const b = put(g, 'B', 16, -12);
  run(g, () => false, 3);
  assert.equal(Math.round(b.health), 50);

  const g2 = arena();
  const c = put(g2, 'C', 0, -12, fireOnce(0));
  arm(c, 'FirePunch');
  const d = put(g2, 'D', 16, -12);
  run(g2, () => false, 2);
  assert.ok(d.body.vy < -5, 'launched upward');
  assert.ok(d.health <= 70);
});

test('The minigun spins up before it fires, and slows you down', () => {
  const game = arena();
  const a = put(game, 'A', 0, -12, () => ({ move: 1, aim: 0, fire: true }));
  arm(a, 'Minigun', 300);
  run(game, () => false, 10);
  assert.equal(a.weapons.Minigun.ammo, 300, 'no shots while spinning up');
  run(game, () => false, 60);
  assert.ok(a.weapons.Minigun.ammo < 290, 'firing once spun up');
  assert.ok(Math.abs(a.body.vx) < 2.5 * DEFAULT_SPEED, 'walks slowly while firing');
});

test('Homing missile and magic bullet find targets you are not aiming at', () => {
  for (const [id, aim] of [['HomingMissile', -0.5], ['MagicBullet', -1.2]]) {
    const game = arena();
    const a = put(game, 'A', 0, -12, fireOnce(aim));
    arm(a, id);
    const b = put(game, 'B', 350, -12);
    run(game, () => b.health < 100 || !b.alive, 600);
    assert.ok(b.health < 100 || !b.alive, `${id} missed`);
  }
});

test('Arrows drop over distance and stick in walls', () => {
  const game = arena({ platforms: [...FLOOR, { left: 500, top: -300, right: 520, bottom: 0 }] });
  const a = put(game, 'A', 0, -12, fireOnce(-0.02));
  arm(a, 'Longbow');
  let stuck = null;
  run(game, () => (stuck = game.projectiles.find(p => p.stuck)), 300);
  assert.ok(stuck, 'arrow stuck in the wall');
  assert.ok(stuck.y > a.shoulderY + 5, 'arrow dropped on the way');
});

test('Supply crates parachute in, land, and give a weapon', () => {
  const game = arena({ options: { crates: 'lots' } });
  const a = put(game, 'A', 0, -12);
  run(game, () => game.pickups.items.some(it => it.type === 'crate' && it.landed), 6000);
  const crate = game.pickups.items.find(it => it.type === 'crate' && it.landed);
  assert.ok(crate, 'a crate landed');
  const before = Object.keys(a.weapons).length;
  a.body.x = crate.x; a.body.y = crate.y - 4;
  game.update();
  assert.ok(!game.pickups.items.includes(crate) || crate.life <= 0, 'crate taken');
  assert.ok(crate.health || Object.keys(a.weapons).length > before || a.weapons[crate.weapon], 'got its contents');
});

test('Game speed rescales the new weapons too: speeds and fuses, not sizes or damage', () => {
  arena();
  assert.equal(WEAPONS.Sheep.blast.radius, 100);
  assert.equal(WEAPONS.Sheep.blast.damage, 110);
  assert.ok(Math.abs(WEAPONS.Sheep.walkSpeed - 2.3 * DEFAULT_SPEED) < 1e-9);
  assert.ok(Math.abs(WEAPONS.Sheep.fuse - 480 / DEFAULT_SPEED) < 1e-9);
  assert.ok(Math.abs(WEAPONS.ClusterBomb.cluster.blast.knock - 6 * DEFAULT_SPEED) < 1e-9);
  assert.ok(Math.abs(WEAPONS.Longbow.gravity - 0.16 * DEFAULT_SPEED ** 2) < 1e-9);
});

test('crouching on the ground makes guns more accurate (shotguns a bit, flamethrowers not)', () => {
  // How far shots stray from the aim: the spread of their angles over many shots.
  const spreadOf = (id, crouch) => {
    const game = arena({ seed: 5 });
    const s = put(game, 'A', 0, -12, () => ({ move: 0, crouch, aim: 0 }));
    for (let i = 0; i < 5; i++) game.update(); // settle, crouch down
    arm(s, id, 999);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 40; i++) {
      game.projectiles.length = 0;
      s.cooldown = 0;
      s.reloadTimer = 0;
      s.spin = 99;
      s.aim = 0;
      if (s.weapons[id].mag !== undefined) s.weapons[id].mag = 99;
      fire(game, s);
      for (const p of game.projectiles) { const a = Math.atan2(p.vy, p.vx); lo = Math.min(lo, a); hi = Math.max(hi, a); }
    }
    return hi - lo;
  };
  for (const [id, share] of [['M4', 0.5], ['Shotgun', 0.75], ['Flamer', 1]]) {
    const stand = spreadOf(id, false), crouch = spreadOf(id, true);
    assert.ok(stand > 0, `${id} spreads`);
    assert.ok(Math.abs(crouch / stand - share) < 0.12, `${id}: crouched ${crouch.toFixed(3)} vs standing ${stand.toFixed(3)}`);
  }
});
