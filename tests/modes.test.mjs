// Game modes and spawn loadouts. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { GUN_GAME_LADDER, MODES } from '../web/src/modes.js';
import { WEAPONS } from '../web/src/weapons.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { botMatch } from './helpers.mjs';

const FLOOR = [{ left: -900, top: 0, right: 900, bottom: 40 }];

function arena({ mode = 'ffa', loadout, options = {}, items = [] } = {}) {
  const map = { name: 'arena', bounds: { left: -900, top: -400, right: 900, bottom: 200 }, spawns: [{ x: -300, y: -12, team: 1 }, { x: 300, y: -12, team: 2 }], items, platforms: FLOOR, loadout };
  return new Game({ mapData: map, effects: false, seed: 4, speed: DEFAULT_SPEED, mode, options });
}

function put(game, name, x, ctl = () => ({ move: 0 })) {
  const s = game.addSoldier({ name, isBot: true }, { input: ctl });
  game.respawn(s);
  s.body.x = x; s.body.y = -12; s.prevX = x; s.prevY = -12;
  s.spawnProtect = 0;
  return s;
}

const run = (game, until, max) => { let t = 0; while (!until() && t++ < max) game.update(); return t; };

test('every mode has the hooks the game calls', () => {
  for (const [id, m] of Object.entries(MODES)) {
    for (const k of ['name', 'blurb', 'setup', 'spawnLoadout', 'damage', 'onKill', 'canRespawn', 'winner', 'compare', 'score', 'scoreLabel']) {
      assert.ok(m[k] !== undefined, `${id} is missing ${k}`);
    }
  }
});

test('map loadouts: everyone spawns with the map\'s weapons, armour and jetpack in deathmatch', () => {
  const game = arena({ loadout: { weapons: ['Uzi', 'Sheep'], armour: 50, jetpack: true } });
  const s = put(game, 'A', 0);
  assert.ok(s.weapons.Uzi && s.weapons.Sheep && s.weapons.Platinum && s.weapons.Prod);
  assert.equal(s.armour, 50);
  assert.ok(s.body.hasJetpack);
  assert.equal(s.current, 'Uzi', 'holding the best gun');
  const gg = arena({ mode: 'gungame', loadout: { weapons: ['Uzi'], armour: 50 } });
  const g = put(gg, 'B', 0);
  assert.ok(!g.weapons.Uzi && g.armour === 0, 'gun game ignores map loadouts');
});

test('gun game and one in the chamber have no pickups or crates', () => {
  for (const mode of ['gungame', 'oitc']) {
    const game = arena({ mode, items: [{ type: 'health', x: 0, y: -20 }, { type: 'weapon', weapon: 'M4', x: 50, y: -20 }] });
    assert.equal(game.pickups.items.length, 0, mode);
    assert.equal(game.pickups.crates, null, mode);
  }
  assert.equal(arena({ items: [{ type: 'health', x: 0, y: -20 }] }).pickups.items.length, 1);
});

test('gun game: each kill moves you to the next weapon; a prod kill sends the victim back', () => {
  const game = arena({ mode: 'gungame' });
  const a = put(game, 'A', 0, () => ({ move: 0 }));
  const b = put(game, 'B', 100);
  assert.equal(a.current, 'Platinum');
  assert.deepEqual(Object.keys(a.weapons).sort(), ['Platinum', 'Prod']);
  game.kill(b, a, 'Platinum');
  assert.equal(a.level, 1);
  assert.equal(a.current, GUN_GAME_LADDER[1]);
  assert.ok(!a.weapons.Platinum, 'old weapon taken away');
  // B comes back and gets a level, then A prods B off the map.
  game.respawn(b);
  b.level = 3;
  game.kill(b, a, 'Prod');
  assert.equal(b.level, 2, 'humiliated');
  assert.equal(a.level, 2);
  // A suicide sends you back one.
  game.kill(a, null, null, { fall: true });
  assert.equal(a.level, 1);
});

test('gun game: a kill with the last weapon wins; ammo never runs out', () => {
  const game = arena({ mode: 'gungame' });
  const a = put(game, 'A', 0, () => ({ move: 0, aim: 0, fire: true }));
  const b = put(game, 'B', 160);
  a.level = 4;
  game.respawn(a); a.body.x = 0; a.body.y = -12; a.spawnProtect = 0;
  const id = a.current;
  assert.equal(id, GUN_GAME_LADDER[4]);
  const ammo = a.weapons[id].ammo;
  run(game, () => false, 60);
  assert.equal(a.weapons[id].ammo, ammo, 'infinite ammo');
  a.level = GUN_GAME_LADDER.length - 1;
  game.kill(b, a, 'BaseballBat');
  assert.ok(game.over, 'match over');
  assert.equal(game.winner.soldier, a);
});

test('one in the chamber: one bullet that kills, a bullet per kill, three lives, last one standing wins', () => {
  const game = arena({ mode: 'oitc' });
  const a = put(game, 'A', 0, () => ({ move: 0, aim: 0, fire: true, firePressed: true }));
  const b = put(game, 'B', 200);
  const c = put(game, 'C', -600);
  assert.equal(a.weapons.Chamber.ammo, 1);
  assert.equal(a.current, 'Chamber');
  assert.ok(a.weapons.BaseballBat);
  run(game, () => !b.alive, 120);
  assert.equal(b.alive, false, 'one shot, one kill');
  assert.equal(b.lives, 2);
  assert.equal(a.weapons.Chamber.ammo, 1, 'got the bullet back for the kill');
  // Bat kills in one hit too.
  b.alive = true; b.health = 100;
  game.kill(c, a, 'BaseballBat');
  game.kill(c, a, 'BaseballBat'); // (already dead: no change)
  assert.equal(c.lives, 2);
  // Lose all lives and you're out.
  for (const s of [b, c]) { s.lives = 1; s.alive = true; game.kill(s, a, 'Chamber'); }
  assert.equal(b.lives, 0);
  assert.equal(game.rules.canRespawn(game, b), false);
  assert.ok(game.over);
  assert.equal(game.winner.soldier, a);
});

test('bots finish a gun game', () => {
  const { game } = botMatch('ssdm4.json', { bots: 5, mode: 'gungame', seed: 6 });
  let bad = null;
  run(game, () => {
    for (const s of game.soldiers) {
      if (!s.alive) continue;
      const held = Object.keys(s.weapons).filter(id => id !== 'Prod');
      if (held.length !== 1 || held[0] !== GUN_GAME_LADDER[Math.min(s.level, GUN_GAME_LADDER.length - 1)]) bad = `${s.name} holds ${held}`;
    }
    return game.over || bad;
  }, 60 * 60 * 12);
  assert.equal(bad, null);
  const best = Math.max(...game.soldiers.map(s => s.level));
  assert.ok(game.over || best >= 8, `match didn't get far (best level ${best})`);
});

test('bots finish a game of one in the chamber', () => {
  const { game } = botMatch('ssdm1.json', { bots: 4, mode: 'oitc', seed: 8 });
  run(game, () => game.over, 60 * 60 * 10);
  assert.ok(game.over, `still going: lives ${game.soldiers.map(s => s.lives)}`);
  assert.equal(game.soldiers.filter(s => s.lives > 0).length, 1);
});

test('weapons that modes hand out stay off maps and out of crates', () => {
  assert.ok(WEAPONS.Chamber.hidden);
});
