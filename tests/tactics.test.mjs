// Bots that fight better the harder they're set (not only aim better), a flag that always has a
// guard, made-up bomb sites the defenders reach first, and the duel maps.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTY } from '../web/src/bot.js';
import { GameMap } from '../web/src/map.js';
import { objectivesOf } from '../web/src/objectives.js';
import { MODES } from '../web/src/modes.js';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { loadMap, mapIndex } from './helpers.mjs';

test('harder bots hunt, take cover, crouch and dodge more; easy ones do none of it', () => {
  for (const k of ['hunt', 'cover', 'crouch', 'dodge']) {
    assert.ok(DIFFICULTY.easy[k] < DIFFICULTY.normal[k] || (DIFFICULTY.easy[k] === 0 && DIFFICULTY.normal[k] > 0), k);
    assert.ok(DIFFICULTY.normal[k] < DIFFICULTY.hard[k], k);
    assert.ok(DIFFICULTY.hard[k] <= 1);
  }
  assert.equal(DIFFICULTY.easy.cover, 0);
  assert.ok(DIFFICULTY.hard.hunt < 1, 'even the best don\'t always know where someone is');
});

test('made-up bomb sites are on the defenders\' side of a big map, not where the attackers start', () => {
  for (const file of ['citadel.json', 'frontline.json', 'harbor.json', 'valley.json']) {
    const map = new GameMap(loadMap(file));
    const mean = t => { const l = map.spawns.filter(p => p.team === t && !p.sector); return l.reduce((a, p) => a + p.x, 0) / l.length; };
    const from = mean(1), to = mean(2);
    const sites = objectivesOf(map, 'site');
    assert.equal(sites.length, 2);
    for (const s of sites) {
      const f = ((s.left + s.right) / 2 - from) / (to - from);
      assert.ok(f > 0.5 && f < 0.95, `${file} site ${s.label}: ${f.toFixed(2)} of the way to the defenders`);
    }
  }
});

test('capture the flag: one of a side\'s bots always guards its flag', () => {
  const g = new Game({ mapData: loadMap('crossfire.json'), mode: 'ctf', effects: false, seed: 4, speed: DEFAULT_SPEED });
  for (let i = 0; i < 8; i++) g.addSoldier({ name: `B${i}`, isBot: true, team: 1 + (i % 2) }, { input: () => ({ move: 0 }) });
  for (let i = 0; i < 5; i++) g.update();
  const stand = t => objectivesOf(g.map, 'flag')[t - 1];
  for (const team of [1, 2]) {
    const first = g.soldiers.filter(s => s.team === team).sort((a, b) => a.id - b.id)[0];
    const goal = MODES.ctf.botGoal(g, first, {});
    assert.ok(goal?.hold && goal.zone.left < stand(team).x && goal.zone.right > stand(team).x, `team ${team}'s first bot holds its flag`);
  }
});

test('the duel maps: small, the same both sides, with something in the way between the spawn points', () => {
  const duels = mapIndex().filter(m => m.size === 'duel');
  assert.ok(duels.length >= 2);
  for (const m of duels) {
    const data = loadMap(m.file), map = new GameMap(data);
    assert.ok(map.bounds.right - map.bounds.left < 1700, `${m.name} is small`);
    const blue = data.spawns.filter(s => s.team === 1), red = data.spawns.filter(s => s.team === 2);
    assert.equal(blue.length, red.length);
    for (const b of blue) assert.ok(red.some(r => Math.abs(r.x + b.x) < 1 && r.y === b.y), `${m.name}: a red spawn across from each blue one`);
    // Nobody's in sight of the other side from where they start, on the ground.
    const lows = (l) => l.filter(s => s.y === Math.max(...l.map(p => p.y)));
    for (const b of lows(blue)) for (const r of lows(red)) assert.ok(!map.clearLine(b.x, b.y, r.x, r.y), `${m.name}: no clear shot from spawn to spawn`);
  }
});
