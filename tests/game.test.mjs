// Headless tests for the game logic. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapIndex, loadMap, botMatch } from './helpers.mjs';
import { GameMap } from '../web/src/map.js';
import { makeBody, stepBody } from '../web/src/physics.js';
import { NavGraph } from '../web/src/nav.js';
import { Game } from '../web/src/game.js';
import { WEAPONS } from '../web/src/weapons.js';
import { BODY, PHYS } from '../web/src/config.js';

const MAPS = mapIndex();

/** Let a body fall until it lands. */
function settle(body, map) {
  for (let i = 0; i < 300 && !body.onGround; i++) stepBody(body, { move: 0 }, map);
  return body;
}

test('all 8 original maps load, with spawn points in open space', () => {
  assert.equal(MAPS.length, 8);
  for (const m of MAPS) {
    const map = new GameMap(loadMap(m.file));
    assert.ok(map.solids.length > 10, m.name);
    for (const s of map.spawns) {
      const inside = map.overlap(s.x - BODY.halfW, s.y + BODY.top, s.x + BODY.halfW, s.y + BODY.bottom);
      assert.equal(inside, null, `${m.name}: spawn at ${s.x},${s.y} is inside a wall`);
    }
  }
});

test('soldiers land on floors, jump about 168 px, and jump pads launch higher', () => {
  const map = new GameMap(loadMap('ssteam1.json'));
  const body = settle(makeBody(map.spawns[0].x, map.spawns[0].y), map);
  assert.ok(body.onGround);
  const floorY = body.y;
  stepBody(body, { move: 0, jump: true, jumpPressed: true }, map);
  let top = body.y;
  for (let i = 0; i < 200 && !body.onGround; i++) { stepBody(body, { move: 0, jump: true }, map); top = Math.min(top, body.y); }
  const height = floorY - top;
  assert.ok(height > 160 && height < 175, `jump height ${height}`);
  assert.ok(Math.abs(body.y - floorY) < 0.01, 'lands back on the same floor');

  const steeple = new GameMap(loadMap('ssdm7.json'));
  const pad = steeple.solids.find(s => s.bounce && s.t > 300);
  const b2 = makeBody((pad.l + pad.r) / 2, pad.t - 40);
  let launched = false, low = 0, high = Infinity;
  for (let i = 0; i < 200; i++) {
    stepBody(b2, { move: 0 }, steeple);
    if (b2.bounced && !launched) { launched = true; low = b2.y; }
    if (launched) high = Math.min(high, b2.y);
  }
  assert.ok(launched, 'pad launched the soldier');
  assert.ok(low - high > height, `pad launch ${low - high} should beat a normal jump`);
});

test('walls stop soldiers', () => {
  const map = new GameMap({ name: 'box', bounds: { left: 0, top: 0, right: 400, bottom: 200 }, spawns: [], items: [],
    platforms: [{ left: 0, top: 100, right: 400, bottom: 120 }, { left: 200, top: 0, right: 220, bottom: 100 }] });
  const body = settle(makeBody(100, 50), map);
  for (let i = 0; i < 120; i++) stepBody(body, { move: 1 }, map);
  assert.ok(Math.abs(body.x - (200 - BODY.halfW)) < 0.01, `stopped at ${body.x}`);
});

test('bots can get everywhere they can reach and back, on every map', () => {
  for (const m of MAPS) {
    const map = new GameMap(loadMap(m.file));
    const nav = new NavGraph(map);
    // Every spot reachable from a spawn must be able to get back to that spawn.
    const spawnNodes = map.spawns.map(s => {
      const b = settle(makeBody(s.x, s.y), map);
      return nav.nodeAt(b.x, b.y, 12);
    });
    assert.ok(spawnNodes.every(Boolean), `${m.name}: every spawn lands on a route spot`);
    const home = spawnNodes[0];
    const fromHome = nav.costsFrom(home).cost;
    for (const n of nav.nodes) {
      if (fromHome[n.id] === Infinity) continue;
      assert.ok(nav.costsFrom(n).cost[home.id] < Infinity, `${m.name}: stuck at ${n.x},${n.y}`);
    }
    for (const sn of spawnNodes) assert.ok(fromHome[sn.id] < Infinity, `${m.name}: spawn ${sn.x},${sn.y} unreachable`);
  }
});

/** Two soldiers on a flat floor, `gap` apart; the first fires `weapon` until the second dies. */
function duel(weapon, gap = 160) {
  const map = { name: 'range', bounds: { left: -600, top: -300, right: 600, bottom: 200 }, spawns: [], items: [],
    platforms: [{ left: -600, top: 0, right: 600, bottom: 40 }] };
  const game = new Game({ mapData: map, effects: false, seed: 3 });
  const shooter = game.addSoldier({ name: 'A', isBot: true }, { input: () => ({ move: 0, aim: 0, fire: true }) });
  const target = game.addSoldier({ name: 'B', isBot: true }, { input: () => ({ move: 0 }) });
  shooter.spawnAt({ x: 0, y: -12 }, 0);
  target.spawnAt({ x: gap, y: -12 }, 0);
  shooter.weapons[weapon] = { ammo: 999 };
  shooter.current = weapon;
  let t = 0;
  while (target.alive && t++ < 1200) game.update();
  return { game, shooter, target, ticks: t };
}

for (const id of Object.keys(WEAPONS)) {
  test(`${WEAPONS[id].name} can frag someone`, () => {
    const gap = id === 'Flamer' ? 70 : id === 'Shotgun' ? 90 : 160;
    const { shooter, target, ticks } = duel(id, gap);
    assert.equal(target.alive, false, `target survived ${ticks} ticks`);
    assert.equal(shooter.frags, 1);
    assert.ok(shooter.alive, 'shooter survived');
  });
}

/** One M4 shot from x=0 at a target 160 px away, aimed at height `aimY` (target stands at y=-12). */
function singleShot(aimY, shooterIsBot) {
  const map = { name: 'range', bounds: { left: -600, top: -300, right: 600, bottom: 200 }, spawns: [], items: [],
    platforms: [{ left: -600, top: 0, right: 600, bottom: 40 }] };
  const game = new Game({ mapData: map, effects: false, seed: 3 });
  let fired = false;
  const shooter = game.addSoldier({ name: 'A', isBot: shooterIsBot }, {
    input: (g, s) => { const fire = !fired; fired = true; return { move: 0, aim: Math.atan2(aimY - s.shoulderY, 160 - s.shoulderX), fire }; },
  });
  const target = game.addSoldier({ name: 'B', isBot: true }, { input: () => ({ move: 0 }) });
  shooter.spawnAt({ x: 0, y: -12 }, 0);
  target.spawnAt({ x: 160, y: -12 }, 0);
  shooter.weapons.M4 = { ammo: 10 };
  shooter.current = 'M4';
  for (let i = 0; i < 30; i++) game.update();
  return { damage: 100 - target.health, sounds: game.sounds.map(s => s.name) };
}

test('headshots do double damage, and the player hears a hitmarker', () => {
  const head = singleShot(-12 + BODY.top + 4, false);
  assert.equal(head.damage, WEAPONS.M4.damage * 2);
  assert.ok(head.sounds.includes('hitmarker'), 'player headshot plays the hitmarker');

  const body = singleShot(-12, false);
  assert.equal(body.damage, WEAPONS.M4.damage);
  assert.ok(!body.sounds.includes('hitmarker'), 'no hitmarker for a body shot');

  const botHead = singleShot(-12 + BODY.top + 4, true);
  assert.equal(botHead.damage, WEAPONS.M4.damage * 2);
  assert.ok(!botHead.sounds.includes('hitmarker'), 'bots landing headshots do not tick for the player');
});

test('rockets and grenades make different explosion sounds', () => {
  const rocket = duel('Bazooka');
  const grenade = duel('GrenadeLauncher');
  assert.ok(rocket.game.sounds.some(s => s.name === 'explosion'));
  assert.ok(grenade.game.sounds.some(s => s.name === 'explosionSmall'));
});

test('game speed only changes how many ticks run per second', () => {
  const slow = new Game({ mapData: loadMap('ssdm1.json'), effects: false, speed: 0.75 });
  assert.equal(slow.tickRate, 45);
  assert.equal(new Game({ mapData: loadMap('ssdm1.json'), effects: false }).tickRate, 60);
});

test('armour soaks up damage', () => {
  const plain = duel('M4');
  const armoured = (() => {
    const map = { name: 'range', bounds: { left: -600, top: -300, right: 600, bottom: 200 }, spawns: [], items: [],
      platforms: [{ left: -600, top: 0, right: 600, bottom: 40 }] };
    const game = new Game({ mapData: map, effects: false, seed: 3 });
    const a = game.addSoldier({ name: 'A', isBot: true }, { input: () => ({ move: 0, aim: 0, fire: true }) });
    const b = game.addSoldier({ name: 'B', isBot: true }, { input: () => ({ move: 0 }) });
    a.spawnAt({ x: 0, y: -12 }, 0); b.spawnAt({ x: 160, y: -12 }, 0);
    b.armour = 100;
    a.weapons.M4 = { ammo: 999 }; a.current = 'M4';
    let t = 0;
    while (b.alive && t++ < 1200) game.update();
    return t;
  })();
  assert.ok(armoured > plain.ticks * 1.3, `armour should make it take longer (${armoured} vs ${plain.ticks})`);
});

test('walking over items picks them up', () => {
  const map = { name: 'shop', bounds: { left: -300, top: -300, right: 300, bottom: 200 }, spawns: [],
    platforms: [{ left: -300, top: 0, right: 300, bottom: 40 }],
    items: [{ type: 'weapon', weapon: 'SR', x: 60, y: -24 }, { type: 'armour', x: 120, y: -24 }, { type: 'jetpack', x: 180, y: -30 }] };
  const game = new Game({ mapData: map, effects: false });
  const s = game.addSoldier({ name: 'Me', isBot: false }, { input: () => ({ move: 1, aim: 0 }) });
  s.spawnAt({ x: 0, y: -12 }, 0);
  for (let i = 0; i < 90; i++) game.update();
  assert.ok(s.weapons.SR, 'got the sniper rifle');
  assert.equal(s.current, 'SR', 'switched to the new weapon');
  assert.equal(s.armour, 100);
  assert.ok(s.body.hasJetpack);
  assert.ok(game.notes.some(n => n.text.includes('Sniper Rifle')));
  assert.ok(game.pickups.items.every(it => !it.active), 'items wait to respawn');
});

test('rocketing yourself costs a frag; falling off after a hit credits the attacker', () => {
  const map = { name: 'ledge', bounds: { left: -400, top: -300, right: 400, bottom: 100 }, spawns: [{ x: 0, y: -40, team: 1 }], items: [],
    platforms: [{ left: -400, top: 0, right: 0, bottom: 20 }, { left: -40, top: -60, right: -30, bottom: 0 }] };
  const game = new Game({ mapData: map, effects: false });
  const s = game.addSoldier({ name: 'Oops', isBot: true }, { input: () => ({ move: 0, aim: Math.PI, fire: true }) });
  s.spawnAt({ x: -10, y: -12 }, 0);
  s.weapons.Bazooka = { ammo: 5 }; s.current = 'Bazooka';
  for (let i = 0; i < 300 && s.deaths === 0; i++) game.update();
  assert.equal(s.deaths, 1);
  assert.ok(s.frags < 0, 'self-kill loses a frag');

  const g2 = new Game({ mapData: map, effects: false });
  const a = g2.addSoldier({ name: 'A', isBot: true }, { input: () => ({ move: 0 }) });
  const b = g2.addSoldier({ name: 'B', isBot: true }, { input: () => ({ move: 1 }) });
  a.spawnAt({ x: -300, y: -12 }, 0); b.spawnAt({ x: -20, y: -12 }, 0);
  b.health = 100; b.lastHurtBy = a; b.lastHurtTick = 0; b.lastHurtWeapon = 'M4';
  for (let i = 0; i < 200 && b.alive; i++) g2.update();
  assert.equal(b.alive, false, 'walked off the edge');
  assert.equal(a.frags, 1, 'attacker gets the frag for the fall');
});

test('first to the frag limit wins', () => {
  const { game } = botMatch('ssdm4.json', { bots: 4, fragLimit: 3, seed: 5 });
  for (let i = 0; i < 20000 && !game.over; i++) game.update();
  assert.ok(game.over, 'match ended');
  assert.ok(game.winner.soldier.frags >= 3);
});

for (const m of MAPS) {
  test(`bots play a full minute on ${m.name}`, () => {
    const { game } = botMatch(m.file, { bots: 6, mode: m.mode, seed: 11 });
    const moved = new Map();
    for (let i = 0; i < 3600; i++) {
      game.update();
      for (const s of game.soldiers) {
        assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.health), `bad numbers for ${s.name}`);
        if (s.alive) moved.set(s, (moved.get(s) || 0) + Math.abs(s.x - s.prevX) + Math.abs(s.y - s.prevY));
      }
    }
    assert.ok(game.stats.kills >= 10, `only ${game.stats.kills} frags`);
    for (const s of game.soldiers) assert.ok(moved.get(s) > 1500, `${s.name} barely moved (${Math.round(moved.get(s))} px)`);
  });
}

test('team matches keep teams apart: no friendly fire', () => {
  const { game } = botMatch('ssteam1.json', { bots: 6, mode: 'team', seed: 2 });
  for (let i = 0; i < 3600; i++) game.update();
  assert.equal(game.teamScore[1] + game.teamScore[2], game.soldiers.reduce((n, s) => n + s.frags, 0));
  for (const f of game.feed) if (f.killer && f.victim && f.killer !== f.victim) assert.notEqual(f.killer.team, f.victim.team);
});

test('physics constants still match the tuned values the route planner was tested with', () => {
  assert.equal(PHYS.jumpSpeed, 12.3);
  assert.equal(PHYS.gravity, 0.45);
});
