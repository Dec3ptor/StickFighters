// Fairer fights: coming back out of the enemy's sight; a starting pistol that doesn't need its
// whole magazine for a kill; the sniper rifle true only down its scope with feet on the ground;
// the strongest weapons back after half a minute, not ten seconds; each weapon its own wait
// between shots; and a jump pressed a moment early or late still counting.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED, RULES, ITEM_RESPAWN, POWER_WEAPONS, respawnTicks, PHYS } from '../web/src/config.js';
import { WEAPONS } from '../web/src/weapons.js';
import { scopeSway, shotDelay } from '../web/src/combat.js';
import { DRAW_TICKS } from '../web/src/soldier.js';
import { makeBody, stepBody, JUMP_BUFFER, JUMP_COYOTE } from '../web/src/physics.js';
import { GameMap } from '../web/src/map.js';

const flat = (extra = {}) => ({ name: 'flat', bounds: { left: -600, top: -600, right: 1600, bottom: 200 }, items: [],
  spawns: [{ x: 0, y: -12, team: 1 }, { x: 400, y: -12, team: 2 }], platforms: [{ left: -600, top: 0, right: 1600, bottom: 40 }], ...extra });

function arena(mapData = flat(), n = 2, mode = 'ffa') {
  const g = new Game({ mapData, effects: false, seed: 5, speed: DEFAULT_SPEED, mode, fragLimit: 999 });
  const inputs = Array.from({ length: n }, () => ({ move: 0, aim: 0 }));
  const all = inputs.map((inp, i) => g.addSoldier({ name: `S${i}`, isBot: false }, { input: () => ({ ...inp }) }));
  for (let i = 0; i < 400 && !all.every(s => s.alive); i++) g.update();
  for (const s of all) s.spawnProtect = 0;
  return { g, all, inputs, a: all[0], b: all[1] };
}

test('coming back: somewhere the enemy can\'t see, before somewhere further off that they can', () => {
  // Two places to come back at: one in the open, far from the enemy; one nearer, behind a wall.
  const map = flat({
    spawns: [{ x: 900, y: -12, team: 0 }, { x: 250, y: -12, team: 0 }],
    platforms: [{ left: -600, top: 0, right: 1600, bottom: 40 }, { left: 320, top: -200, right: 350, bottom: 0 }],
  });
  const { g, a, b } = arena(map);
  // (The enemy stands in the open, right of the wall: sees the far place, not the near one.)
  b.body.x = 500; b.body.y = -12;
  const picks = { open: 0, hidden: 0 };
  for (let i = 0; i < 40; i++) { const p = g.pickSpawn(a); if (p.x === 900) picks.open++; else picks.hidden++; }
  assert.equal(picks.open, 0, `never in their sight while there's somewhere out of it (${JSON.stringify(picks)})`);
  // (Nobody about: either, as before.)
  b.alive = false;
  const both = new Set();
  for (let i = 0; i < 60; i++) both.add(g.pickSpawn(a).x);
  assert.equal(both.size, 2, 'no enemy: any of them');
  // (Both seen: the further from them.)
  b.alive = true;
  b.body.x = 330; b.body.y = -260;
  const far = { open: 0, hidden: 0 };
  for (let i = 0; i < 40; i++) { const p = g.pickSpawn(a); if (p.x === 900) far.open++; else far.hidden++; }
  assert.ok(far.open > far.hidden, `both in sight: mostly the further one (${JSON.stringify(far)})`);
});

test('the starting pistol: seven body shots of its twelve to a kill, not all eight of eight', () => {
  const p = WEAPONS.Platinum;
  assert.equal(p.mag, 12);
  assert.equal(Math.ceil(RULES.maxHealth / p.damage), 7, 'seven to the body');
  assert.ok(Math.ceil(RULES.maxHealth / p.damage) < p.mag, 'with rounds to spare for a miss');
  assert.equal(Math.ceil(RULES.maxHealth / (p.damage * RULES.headshotMultiplier)), 4, 'four to the head');
  assert.ok(WEAPONS.Beretta.damage >= p.damage, 'a pistol picked up is no worse');
  // (Still the weakest way to kill: the guns picked up are quicker.)
  const ttk = d => (Math.ceil(RULES.maxHealth / d.damage) - 1) * d.rof;
  for (const id of ['M4', 'AK47', 'Uzi', 'MP5K']) assert.ok(ttk(WEAPONS[id]) < ttk(p), `${id} is quicker`);
});

test('the sniper rifle goes just where it\'s aimed down its scope with feet on the ground; from the hip or in the air it strays', () => {
  const { g, a } = arena();
  const sr = WEAPONS.SR, sway = (n = 300) => Array.from({ length: n }, () => scopeSway(g, a, sr));
  a.body.onGround = true;
  a.scoped = true;
  assert.ok(sway().every(x => x === 0), 'down the scope, standing: true');
  a.body.crouching = true;
  assert.ok(sway().every(x => x === 0));
  a.body.crouching = false;
  a.scoped = false;
  const hip = sway();
  assert.ok(hip.some(x => Math.abs(x) > sr.hip * 0.3) && hip.every(x => Math.abs(x) <= sr.hip / 2 + 1e-9), 'from the hip: up to half its hip spread either way');
  a.body.crouching = true;
  assert.ok(sway().every(x => Math.abs(x) <= sr.hip / 4 + 1e-9), 'crouched: half of that');
  a.body.crouching = false;
  a.scoped = true;
  a.body.onGround = false;
  const air = sway();
  assert.ok(air.some(x => Math.abs(x) > sr.hip / 2) && air.every(x => Math.abs(x) <= sr.air / 2 + 1e-9), 'in the air: more, scope or no scope');
  // (A bot standing is taken to look down it; other guns have no scope to stray without.)
  a.body.onGround = true; a.scoped = false; a.isBot = true;
  assert.ok(sway().every(x => x === 0));
  a.isBot = false;
  assert.equal(scopeSway(g, a, WEAPONS.M4), 0);
});

test('right click with the sniper rifle is looking down its scope: shots at a far target all land; from the hip some miss', () => {
  const hits = scoped => {
    const m = arena();
    m.b.body.x = 1100; m.b.body.y = -12; m.a.body.x = 0; m.a.body.y = -12;
    m.b.maxHealth = m.b.health = 1e6;
    m.a.weapons.SR = { ammo: 500 }; m.a.select('SR');
    Object.assign(m.inputs[0], { fire: true, firePressed: true, alt: scoped, aim: 0 });
    let n = 0, last = m.b.health;
    for (let i = 0; i < 60 * 40; i++) {
      m.g.update();
      m.b.body.x = 1100; m.b.body.vx = 0; m.a.body.x = 0; m.a.body.vx = 0; m.b.spawnProtect = 0;
      if (m.b.health < last) { n++; last = m.b.health; }
    }
    return { n, shots: 500 - m.a.weapons.SR.ammo };
  };
  const down = hits(true), hip = hits(false);
  assert.ok(down.shots >= 20, `${down.shots} shots`);
  assert.equal(down.n, down.shots, 'down the scope: every one lands');
  assert.ok(hip.n < hip.shots, `from the hip at that range: some stray (${hip.n} of ${hip.shots})`);
});

test('the strongest weapons are back after half a minute, the rest after ten seconds; what\'s taken counts down', () => {
  assert.equal(respawnTicks({ type: 'weapon', weapon: 'M4' }), ITEM_RESPAWN.weapon);
  assert.equal(respawnTicks({ type: 'weapon', weapon: 'SR' }), ITEM_RESPAWN.power);
  assert.equal(respawnTicks({ type: 'weapon', weapon: 'Bazooka' }), ITEM_RESPAWN.power);
  assert.equal(respawnTicks({ type: 'armour' }), ITEM_RESPAWN.armour);
  assert.ok(ITEM_RESPAWN.power >= ITEM_RESPAWN.weapon * 3);
  for (const id of POWER_WEAPONS) assert.ok(WEAPONS[id], id);
  const map = flat({ items: [{ type: 'weapon', weapon: 'SR', x: 100, y: -12 }, { type: 'weapon', weapon: 'M4', x: -100, y: -12 }] });
  const { g, a } = arena(map);
  const item = w => g.pickups.items.find(it => it.weapon === w);
  a.body.x = 100; a.body.y = -12;
  for (let i = 0; i < 5; i++) g.update();
  assert.ok(!item('SR').active && a.weapons.SR, 'taken');
  assert.equal(item('SR').total, ITEM_RESPAWN.power);
  assert.ok(item('SR').timer > ITEM_RESPAWN.power - 10 && item('SR').timer < item('SR').total, 'counting down');
  a.body.x = -100;
  for (let i = 0; i < 5; i++) g.update();
  assert.equal(item('M4').total, ITEM_RESPAWN.weapon);
  a.body.x = 600;
  for (let i = 0; i < ITEM_RESPAWN.weapon + 5; i++) g.update();
  assert.ok(item('M4').active && !item('SR').active, 'the rifle back, the sniper rifle not yet');
});

test('each weapon has its own wait: a rocket and then the shotgun; not the same slow gun sooner by putting it away', () => {
  const m = arena();
  const { g, a, inputs } = m;
  m.b.body.x = 1500;
  a.weapons.Bazooka = { ammo: 5 }; a.weapons.Shotgun = { ammo: 8 };
  a.select('Bazooka');
  for (let i = 0; i < DRAW_TICKS + 2; i++) g.update();
  const fireOnce = () => { inputs[0].fire = true; inputs[0].firePressed = true; g.update(); inputs[0].fire = false; inputs[0].firePressed = false; };
  fireOnce();
  assert.equal(a.weapons.Bazooka.ammo, 4, 'a rocket away');
  const wait = shotDelay(g, WEAPONS.Bazooka);
  assert.ok(a.cooldown > wait - 3);
  // (The shotgun out: ready after the moment it takes to draw, not after the rocket's wait.)
  inputs[0].switchTo = 'Shotgun'; g.update(); inputs[0].switchTo = null;
  assert.equal(a.current, 'Shotgun');
  assert.ok(a.cooldown <= DRAW_TICKS, `its own wait (${a.cooldown})`);
  for (let i = 0; i < DRAW_TICKS + 1; i++) g.update();
  fireOnce();
  assert.equal(a.weapons.Shotgun.ammo, 7, 'and fired, long before the bazooka\'s ready');
  // (Back to the bazooka: still waiting for what's left of its own.)
  inputs[0].switchTo = 'Bazooka'; g.update(); inputs[0].switchTo = null;
  assert.equal(a.current, 'Bazooka');
  assert.ok(a.cooldown > wait - (DRAW_TICKS + 12), `still waiting (${a.cooldown} of ${wait})`);
  fireOnce();
  assert.equal(a.weapons.Bazooka.ammo, 4, 'no sooner for having been put away');
  for (let i = 0; i < wait; i++) g.update();
  fireOnce();
  assert.equal(a.weapons.Bazooka.ammo, 3, 'ready when its own wait is over');
});

test('a jump pressed just before landing, or just after running off an edge, still counts; never twice', () => {
  const map = new GameMap({ name: 'ledge', bounds: { left: -400, top: -600, right: 800, bottom: 400 }, spawns: [], items: [],
    platforms: [{ left: -400, top: 0, right: 100, bottom: 40 }, { left: 100, top: 200, right: 800, bottom: 240 }] });
  const stand = () => { const b = makeBody(0, -12); for (let i = 0; i < 20; i++) stepBody(b, { move: 0 }, map); return b; };
  // Falling: pressed a few updates before the ground, it jumps on landing.
  let b = stand();
  b.y = -60; b.onGround = false; b.vy = 0;
  let pressed = false, jumped = false;
  for (let i = 0; i < 60 && !jumped; i++) {
    const near = !pressed && b.vy > 0 && b.y > -12 - b.vy * (JUMP_BUFFER - 1);
    stepBody(b, { move: 0, jump: true, jumpPressed: near }, map);
    if (near) pressed = true;
    if (b.jumped) jumped = true;
  }
  assert.ok(pressed && jumped, 'pressed just before landing: jumped as it landed');
  // (Pressed long before: forgotten.)
  b = stand();
  b.y = -200; b.onGround = false; b.vy = 0;
  stepBody(b, { move: 0, jump: true, jumpPressed: true }, map);
  jumped = false;
  for (let i = 0; i < 80; i++) { stepBody(b, { move: 0, jump: true }, map); if (b.jumped) jumped = true; }
  assert.ok(!jumped && b.onGround, 'pressed too early: just lands');
  // Running off an edge: pressed within a few updates of leaving it, a full jump; later, nothing.
  const offEdge = late => {
    const c = stand();
    c.x = 60;
    let left = -1, did = false, top = c.y;
    for (let i = 0; i < 120; i++) {
      const press = left >= 0 && i - left === late;
      stepBody(c, { move: 1, jump: press, jumpPressed: press }, map);
      if (left < 0 && !c.onGround) left = i;
      if (c.jumped) did = true;
      top = Math.min(top, c.y);
    }
    return { did, rose: -12 - top };
  };
  const soon = offEdge(JUMP_COYOTE - 2), late = offEdge(JUMP_COYOTE + 3);
  assert.ok(soon.did && soon.rose > 15, `just off the edge: a jump (${Math.round(soon.rose)} px up)`);
  assert.ok(!late.did, 'too late: falling');
  // No second jump in the air.
  b = stand();
  stepBody(b, { move: 0, jump: true, jumpPressed: true }, map);
  assert.ok(b.jumped);
  let again = false;
  for (let i = 0; i < 12; i++) { stepBody(b, { move: 0, jump: true, jumpPressed: i % 2 === 0 }, map); if (b.jumped && !b.onGround && i < 10) again = true; }
  assert.ok(!again, 'no second jump on the way up');
  assert.ok(PHYS.jumpSpeed > 0);
});
