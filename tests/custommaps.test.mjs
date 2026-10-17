// Tests for custom map data: cleaning, share links, .ssm files and the map check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapIndex, loadMap } from './helpers.mjs';
import { normalizeMap, encodeShare, decodeShare, encodeSSM, decodeSSM, checkMap, computeBounds } from '../web/src/custommaps.js';
import { Game } from '../web/src/game.js';
import { NavGraph } from '../web/src/nav.js';
import { BotController, BOT_PROFILES } from '../web/src/bot.js';
import { makeRng } from '../web/src/util.js';
import { DEFAULT_SPEED } from '../web/src/config.js';

/** A small but complete map like one made in the editor. */
const SIMPLE = {
  name: 'Test Arena',
  platforms: [
    { left: -400, top: 200, right: 400, bottom: 240 },
    { left: -250, top: 80, right: -120, bottom: 100 },
    { left: 120, top: 80, right: 250, bottom: 100 },
    { left: -30, top: 180, right: 30, bottom: 200, bounce: -7 },
    { left: -60, top: -60, right: 60, bottom: -40 },
  ],
  spawns: [{ x: -300, y: 160, team: 1 }, { x: 300, y: 160, team: 2 }, { x: -180, y: 40, team: 1 }, { x: 180, y: 40, team: 2 }],
  items: [{ type: 'weapon', x: 0, y: -80, weapon: 'SR' }, { type: 'health', x: -330, y: 176 }, { type: 'weapon', x: 330, y: 176, weapon: 'Shotgun' }],
};

test('normalizeMap cleans up messy data and works out the bounds', () => {
  const m = normalizeMap({
    name: '  My   map  ',
    platforms: [{ left: 100, top: 50, right: 0, bottom: 0 }, { left: 0, top: 0, right: 2, bottom: 2 }, { left: 0, top: 100, right: 50, bottom: 120, bounce: 30 }],
    spawns: [{ x: '10', y: 20, team: 7 }],
    items: [{ type: 'weapon', weapon: 'Nope', x: 0, y: 0 }, { type: 'health', x: 5.55555, y: 1 }, { type: 'rubbish', x: 0, y: 0 }],
  });
  assert.equal(m.name, 'My map');
  assert.deepEqual(m.platforms[0], { left: 0, top: 0, right: 100, bottom: 50 }, 'corners put in order');
  assert.equal(m.platforms.length, 2, 'tiny platform dropped');
  assert.equal(m.platforms[1].bounce, -12, 'pad strength clamped and stored negative');
  assert.deepEqual(m.spawns, [{ x: 10, y: 20, team: 1 }]);
  assert.deepEqual(m.items, [{ type: 'health', x: 5.6, y: 1 }], 'bad items dropped, numbers rounded');
  assert.ok(m.bounds.left < 0 && m.bounds.right > 100 && m.bounds.top < 0 && m.bounds.bottom > 120);
  assert.throws(() => normalizeMap({ name: 'x' }), /no platforms/);
  assert.throws(() => normalizeMap({ platforms: [{ left: 0, top: 0, right: 'a', bottom: 9 }] }), /isn't a number/);
  assert.throws(() => normalizeMap({ platforms: [{ left: 0, top: 0, right: 9000, bottom: 9 }] }), /too big/);
  assert.deepEqual(computeBounds([], [], []), { left: -400, top: -300, right: 400, bottom: 300 });
});

test('share links round-trip every original map', async () => {
  for (const m of mapIndex()) {
    const original = normalizeMap(loadMap(m.file));
    const code = await encodeShare(original);
    assert.match(code, /^[A-Za-z0-9_-]+$/, 'URL-safe');
    assert.ok(code.length < 3000, `${m.name} link is ${code.length} characters`);
    assert.deepEqual(await decodeShare(code), original);
  }
  await assert.rejects(decodeShare('not-a-map'), /damaged/);
});

test('.ssm files round-trip, matching the original game format', () => {
  for (const m of mapIndex()) {
    const original = normalizeMap(loadMap(m.file));
    const bytes = encodeSSM(original);
    assert.deepEqual(decodeSSM(bytes), original, m.name);
  }
  // A known layout: name, then 4 floats of bounds.
  const bytes = encodeSSM(SIMPLE);
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 'Test Arena'.length);
  assert.throws(() => decodeSSM(new Uint8Array([1, 2, 3])), /cut short|isn't/);
});

test('the map check passes good maps and catches broken ones', () => {
  const good = checkMap(SIMPLE);
  assert.deepEqual(good.problems.filter(p => p.level !== 'ok'), [], JSON.stringify(good.problems));
  assert.ok(good.spots.length > 20 && good.spots.every(s => s.kind === 'ok'));

  // A pit too deep to climb out of, a spawn inside a wall, one over the void, and nothing else.
  const bad = checkMap({
    name: 'Broken',
    platforms: [
      { left: -400, top: 200, right: 400, bottom: 240 },
      { left: -400, top: 600, right: 400, bottom: 640 },   // pit floor, 400 px down
      { left: -440, top: 200, right: -400, bottom: 640 },
      { left: 400, top: 200, right: 440, bottom: 640 },
    ],
    spawns: [{ x: 0, y: 160, team: 1 }, { x: 0, y: 220, team: 1 }, { x: 900, y: 0, team: 1 }],
    items: [],
  });
  const texts = bad.problems.map(p => p.text).join('\n');
  assert.match(texts, /inside a wall/);
  assert.match(texts, /drops players off the map/);
  assert.match(texts, /Team games need both/);
  assert.match(texts, /No weapons/);
  assert.equal(checkMap({ platforms: [] }).problems[0].level, 'error');

  // A gap in the floor drops you into a pit 400 px deep: those spots are traps.
  const pit = checkMap({
    name: 'Pit',
    platforms: [
      { left: -400, top: 200, right: -60, bottom: 240 }, { left: 60, top: 200, right: 400, bottom: 240 },
      { left: -400, top: 600, right: 400, bottom: 640 },
      { left: -440, top: 0, right: -400, bottom: 640 }, { left: 400, top: 0, right: 440, bottom: 640 },
    ],
    spawns: [{ x: -300, y: 160, team: 1 }, { x: 300, y: 160, team: 2 }, { x: -200, y: 160, team: 1 }, { x: 200, y: 160, team: 2 }],
    items: [{ type: 'weapon', x: -250, y: 176, weapon: 'M4' }],
  });
  assert.match(pit.problems.map(p => p.text).join('\n'), /traps/);
  assert.ok(pit.spots.some(s => s.kind === 'trap' && s.y > 500), 'pit floor marked as a trap');
  assert.ok(pit.spots.some(s => s.kind === 'ok' && s.y < 200), 'upper floor is fine');
});

test('every original map passes the map check', () => {
  for (const m of mapIndex()) {
    const r = checkMap(loadMap(m.file));
    const serious = r.problems.filter(p => p.level === 'error' || /trap|cut off/.test(p.text));
    assert.deepEqual(serious, [], `${m.name}: ${JSON.stringify(serious)}`);
  }
});

test('bots play a custom map', () => {
  const game = new Game({ mapData: normalizeMap(SIMPLE), effects: false, seed: 4, speed: DEFAULT_SPEED });
  const nav = new NavGraph(game.map);
  const rng = makeRng(9);
  for (let i = 0; i < 4; i++) {
    const p = BOT_PROFILES[i];
    game.addSoldier({ name: p.name, isBot: true, profile: p }, new BotController(nav, 'normal', p, rng));
  }
  for (let i = 0; i < 3600; i++) game.update();
  assert.ok(game.stats.kills >= 5, `only ${game.stats.kills} frags`);
  for (const s of game.soldiers) assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y));
});
