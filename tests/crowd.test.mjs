// Huge battles (up to 4,000 bots). Big games look soldiers up by area instead
// of checking everyone; these tests check the shortcuts give the same answers
// as checking everyone, and that a big battle keeps up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { botMatch } from './helpers.mjs';
import { hitSoldier } from '../web/src/combat.js';
import { BotController } from '../web/src/bot.js';
import { makeRng } from '../web/src/util.js';

/** A big game, run until everyone has arrived and spread out. */
function bigGame(bots = 300, ticks = 240) {
  const m = botMatch('ssdm1.json', { bots, mode: 'ffa', seed: 5 });
  for (let i = 0; i < ticks; i++) m.game.update();
  assert.ok(m.game.crowded);
  return m;
}

/** The same game, pretending to be small (so everything checks everyone). */
function asSmall(game, fn) {
  Object.defineProperty(game, 'crowded', { value: false, configurable: true });
  try { return fn(); } finally { delete game.crowded; }
}

test('looking soldiers up by area never misses one', () => {
  const { game } = bigGame();
  const rng = makeRng(3);
  const b = game.map.bounds;
  for (let i = 0; i < 300; i++) {
    const x = b.left + rng() * (b.right - b.left), y = b.top + rng() * (b.bottom - b.top);
    const w = 5 + rng() * 300, h = 5 + rng() * 300;
    const found = new Set(game.near(x, y, x + w, y + h));
    for (const s of game.soldiers) {
      if (s.alive && s.x >= x && s.x <= x + w && s.y >= y && s.y <= y + h) assert.ok(found.has(s), `missed ${s.name}`);
    }
  }
});

test('shots hit the same soldier as checking everyone, long sniper shots included', () => {
  const { game } = bigGame();
  const rng = makeRng(8);
  const alive = game.soldiers.filter(s => s.alive);
  let hits = 0;
  for (let i = 0; i < 400; i++) {
    const from = alive[Math.floor(rng() * alive.length)];
    const a = rng() * Math.PI * 2, len = rng() < 0.5 ? 30 : 1500;
    const args = [game, from.x, from.y - 15, Math.cos(a) * len, Math.sin(a) * len, from, from];
    const fast = hitSoldier(...args);
    const all = asSmall(game, () => hitSoldier(...args));
    assert.equal(fast?.soldier?.name ?? null, all?.soldier?.name ?? null, `shot ${i}`);
    if (all) hits++;
  }
  assert.ok(hits > 100, `the test shots hit people (${hits})`);
});

test('finding route map spots by area gives the same spots', () => {
  const { nav } = botMatch('ssdm1.json', { bots: 0 });
  const rng = makeRng(4);
  for (let i = 0; i < 500; i++) {
    const x = -200 + rng() * 1600, y = -300 + rng() * 1200, r = [90, 200, 400][i % 3];
    let best = null, bd = r * r;
    for (const n of nav.nodes) {
      const dy = (n.y - y) * 1.6, d = (n.x - x) ** 2 + dy * dy;
      if (d < bd) { bd = d; best = n; }
    }
    assert.equal(nav.nearest(x, y, r), best);
    const near = nav.nodes.filter(n => Math.abs(n.x - x) < 140 && Math.abs(n.y - y) < 120);
    assert.deepEqual(nav.nodesNear(x, y, 140, 120), near);
  }
});

test('soldier ids stay unique, and freed ids are reused', () => {
  const { game, nav } = botMatch('ssdm1.json', { bots: 60 });
  const ids = game.soldiers.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort((a, b) => a - b), ids.map((_, i) => i));
  game.removeSoldier(game.soldiers[10]);
  game.removeSoldier(game.soldiers[20]);
  const a = game.addSoldier({ name: 'A', isBot: true }, new BotController(nav, 'normal', { name: 'A', acc: 10, camp: 10, skill: 1 }, makeRng(1)));
  const b = game.addSoldier({ name: 'B', isBot: true }, null);
  assert.deepEqual([a.id, b.id], [10, 21]);
  assert.equal(new Set(game.soldiers.map(s => s.id)).size, game.soldiers.length);
});

test('in a big game, bots still find someone nearby to fight', () => {
  // (Bots only check sight lines to the nearest few, so very rarely, when those
  // are all behind walls, a bot misses someone further away: allow 2%.)
  const { game } = bigGame();
  let cases = 0, missed = 0;
  for (const s of game.soldiers) {
    if (!s.alive) continue;
    const bot = game.controllers.get(s);
    const all = asSmall(game, () => bot.lookAtAll(game, s));
    if (!all) continue;
    cases++;
    const fast = bot.lookAround(game, s);
    if (!fast) { missed++; continue; }
    assert.ok(bot.canSee(game, s, fast), 'in sight');
    const d = o => Math.hypot(o.x - s.x, o.y - s.y);
    assert.ok(d(fast) <= d(all) + 2 * 64, `${s.name} picks someone nearby (${d(fast).toFixed(0)} vs ${d(all).toFixed(0)} px)`);
  }
  assert.ok(cases > 100, `checked ${cases} bots`);
  assert.ok(missed <= cases * 0.02, `missed someone in sight ${missed} times out of ${cases}`);
});

test('1,000 bots: everyone arrives within 2 seconds, and the game keeps up', () => {
  const { game } = botMatch('ssdm1.json', { bots: 1000, mode: 'ffa', seed: 9 });
  for (let i = 0; i < 125; i++) game.update();
  assert.equal(game.soldiers.filter(s => s.alive || s.deaths > 0).length, 1000, 'all arrived');
  const t0 = performance.now();
  for (let i = 0; i < 120; i++) game.update();
  const ms = (performance.now() - t0) / 120;
  assert.ok(ms < 16.7, `${ms.toFixed(1)} ms per update (needs under 16.7 for 60 a second)`);
  assert.ok(game.stats.kills > 100, `they fight (${game.stats.kills} kills)`);
  for (const s of game.soldiers) assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y), 'positions are numbers');
});
