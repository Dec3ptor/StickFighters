// Health: 150 in every mode but Defuse (100, as its weapons and money are made for);
// blasts take the same share of it as before, and one-shot kills stay one shot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { WEAPONS } from '../web/src/weapons.js';
import { RULES, DEFAULT_SPEED } from '../web/src/config.js';
import { explode } from '../web/src/combat.js';
import { MEDKIT_HEAL } from '../web/src/gadgets.js';

const FLOOR = [{ left: -900, top: 0, right: 900, bottom: 40 }];
const arena = mode => new Game({
  mapData: { name: 'arena', bounds: { left: -900, top: -400, right: 900, bottom: 200 }, spawns: [{ x: 0, y: -12, team: 1 }], items: [], platforms: FLOOR },
  mode, effects: false, seed: 2, speed: DEFAULT_SPEED,
});
function put(game, x, team = 0) {
  const s = game.addSoldier({ name: `S${x}`, isBot: true, team }, { input: () => ({ move: 0 }) });
  game.respawn(s);
  s.spawnAt({ x, y: -12 }, 0);
  return s;
}

test('soldiers have 150 health; Defuse keeps 100', () => {
  assert.equal(RULES.maxHealth, 150);
  const ffa = arena('ffa'), s = put(ffa, 0);
  assert.equal(ffa.maxHealth, 150);
  assert.equal(s.maxHealth, 150);
  assert.equal(s.health, 150);
  const def = arena('defuse'), d = def.addSoldier({ name: 'D', isBot: true, team: 1 }, { input: () => ({ move: 0 }) });
  assert.equal(def.maxHealth, 100);
  assert.equal(d.maxHealth, 100);
  d.spawnAt({ x: 0, y: -12 }, 0);
  assert.equal(d.health, 100);
});

test('a sniper or longbow headshot still kills from full health; a medkit heals 60% of it', () => {
  for (const id of ['SR', 'Longbow']) {
    const w = WEAPONS[id];
    assert.ok(w.damage * w.headMultiplier >= RULES.maxHealth, `${id} headshot ${w.damage * w.headMultiplier}`);
    assert.ok(w.damage < RULES.maxHealth, `${id} body shots don't`);
  }
  assert.equal(MEDKIT_HEAL, RULES.maxHealth * 0.6);
});

test('a blast takes the same share of health as it did at 100', () => {
  const game = arena('ffa');
  const a = put(game, -600), b = put(game, 0);
  explode(game, b.body.x, b.body.y - 5, { radius: 80, damage: 40, knock: 0 }, a, 'Bazooka', b);
  assert.equal(Math.round(b.health), 150 - 60, 'a direct hit of 40 (of 100) takes 60 of 150');
  const def = arena('defuse');
  const c = def.addSoldier({ name: 'C', isBot: true, team: 1 }, { input: () => ({ move: 0 }) });
  const e = def.addSoldier({ name: 'E', isBot: true, team: 2 }, { input: () => ({ move: 0 }) });
  c.spawnAt({ x: -600, y: -12 }, 0); e.spawnAt({ x: 0, y: -12 }, 0);
  def.modeState.phase = 'live';
  explode(def, e.body.x, e.body.y - 5, { radius: 80, damage: 40, knock: 0 }, c, 'HEGrenade', e);
  assert.equal(Math.round(e.health), 100 - 40 * (WEAPONS.HEGrenade?.cs?.dmg ?? 1), 'Defuse: as it was');
});
