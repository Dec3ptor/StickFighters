// A world's settings (web/src/world/worldrules.js): chosen when it's made, and what each does —
// seeing only what can be seen, monsters by difficulty (peaceful: none), hardcore (one life) and
// creative, the time (always day or night), towns or none, raids, and what you start with.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { TileWorld, TILE } from '../web/src/world/tileworld.js';
import { WORLD_SETTINGS, cleanSettings, settingsSummary, keepTime, KITS, kitOf, difficultyOf } from '../web/src/world/worldrules.js';
import { worldFromSave, playerToSave } from '../web/src/world/worldplay.js';
import { DAY_TICKS, hourOf, isNight, isMonster, spawnMonster, MONSTERS } from '../web/src/world/monsters.js';
import { sightBox } from '../web/src/world/worldrender.js';
import { townsNear } from '../web/src/world/townsfolk.js';
import { damage } from '../web/src/combat.js';

function play(settings = {}, seed = 4242) {
  const s = cleanSettings(settings);
  const world = new TileWorld({ seed, name: 'Rules', gen: 3, noTowns: s.towns === 'off' });
  world.settings = s;
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true, fog: s.vision === 'sight' }, effects: false, seed: 1 });
  const me = game.addSoldier({ name: 'Ruler', isBot: false }, { input: () => ({ move: 0 }) });
  me.world = worldFromSave(null, kitOf(world));
  for (let i = 0; i < 300 && !me.alive; i++) game.update();
  return { world, game, me };
}
const run = (game, n) => { for (let i = 0; i < n; i++) game.update(); };

test('settings: each has its choices and a default; only what there is is kept; what\'s different, in a few words', () => {
  const c = cleanSettings(null);
  for (const [k, d] of Object.entries(WORLD_SETTINGS)) {
    assert.ok(d.options[d.def], `${k}'s default is one of its choices`);
    assert.equal(c[k], d.def);
  }
  assert.deepEqual(cleanSettings({ vision: 'sight', difficulty: 'nonsense', mode: 42 }), { ...c, vision: 'sight' });
  assert.equal(settingsSummary(null), '');
  assert.match(settingsSummary({ vision: 'sight', difficulty: 'hard', mode: 'hardcore', towns: 'off' }), /Line of sight · Hard · Hardcore · No towns/);
});

test('seeing only what can be seen: a wall hides what\'s behind it, the open\'s all seen', () => {
  const w = 21, h = 9, solid = new Uint8Array(w * h), out = new Uint8Array(w * h);
  // A wall at x = 12, from top to bottom but for a gap.
  for (let y = 0; y < h; y++) if (y !== 4) solid[y * w + 12] = 1;
  sightBox(solid, w, h, 5.5, 4.5, out);
  const at = (x, y) => out[y * w + x];
  assert.equal(at(8, 1), 1, 'open: seen');
  assert.equal(at(12, 1), 1, 'the wall\'s face: seen');
  assert.equal(at(16, 0), 0, 'behind it: not seen');
  assert.equal(at(18, 4), 1, 'through the gap: seen');
  // Fog of war comes on with it (soldiers out of sight hidden, sounds shown).
  assert.equal(play({ vision: 'sight' }).game.options.fog, true);
  assert.ok(!play().game.options.fog);
});

test('monsters: none in a peaceful world; harder ones in a hard world', () => {
  const calm = play({ difficulty: 'peaceful' });
  calm.world.time = DAY_TICKS * 0.75;
  run(calm.game, 60 * 40);
  assert.equal(calm.game.soldiers.filter(isMonster).length, 0, 'none at night');
  const hard = play({ difficulty: 'hard' });
  const z = spawnMonster(hard.game, 'zombie', hard.me.x + 80, hard.me.y);
  run(hard.game, 3);
  assert.equal(z.maxHealth, Math.round(MONSTERS.zombie.health * difficultyOf(hard.world).hp), 'tougher');
  hard.me.spawnProtect = 0;
  hard.me.health = 150;
  damage(hard.game, hard.me, 10, z, 'Claws');
  assert.ok(Math.abs(150 - hard.me.health - 10 * difficultyOf(hard.world).dmg) < 1e-6, `harder hitting (${150 - hard.me.health})`);
});

test('time: always day skips the night, always night the day; days still go by', () => {
  const day = play({ time: 'day' });
  for (let i = 0; i < 60; i++) { day.world.time += DAY_TICKS / 30; run(day.game, 31); assert.ok(!isNight(day.world.time), `day (${hourOf(day.world.time).toFixed(1)})`); }
  const night = play({ time: 'night' });
  for (let i = 0; i < 60; i++) { night.world.time += DAY_TICKS / 30; run(night.game, 31); const h = hourOf(night.world.time); assert.ok(h >= 19 || h < 5.1, `night (${h.toFixed(1)})`); }
  // (Forward only.)
  let t = 0;
  for (let i = 0; i < 2000; i++) { const n = keepTime({ settings: { time: 'night' } }, t + DAY_TICKS / 200, DAY_TICKS, hourOf); assert.ok(n >= t); t = n; }
});

test('towns: none in a wild world; what you start with; hardcore: one life; creative: dev mode', () => {
  const wild = play({ towns: 'off' });
  assert.equal(wild.world.gen.townIn(wild.world.gen.spawnRegion), null);
  assert.deepEqual(townsNear(wild.world.gen, 0, 2000), []);
  assert.ok(townsNear(play().world.gen, 0, 2000).length > 0, 'a world with towns has them');
  // Kits.
  assert.equal(play({ kit: 'none' }).me.world.inv.slots.filter(Boolean).length, 0, 'nothing');
  const basic = play({ kit: 'basic' }).me.world.inv;
  assert.ok(basic.count('pickaxe') === 1 && basic.count('torch') === KITS.basic.find(k => k[0] === 'torch')[1] && basic.count('Platinum') === 0, 'the basics');
  assert.ok(play().me.world.inv.count('Platinum') === 1, 'the full kit: a pistol too');
  // Hardcore.
  const hc = play({ mode: 'hardcore' });
  hc.me.spawnProtect = 0;
  hc.game.kill(hc.me, null, 'Fall');
  run(hc.game, 400);
  assert.equal(hc.me.alive, false, 'no coming back');
  assert.match(hc.game.rules.outText(hc.game, hc.me), /one life/);
  assert.equal(worldFromSave(JSON.parse(JSON.stringify(playerToSave(hc.me, hc.game)))).over, true, 'kept so');
  // Creative.
  const cr = play({ mode: 'creative' });
  run(cr.game, 30);
  assert.ok(cr.me.world.dev, 'dev mode on');
});

test('online: someone joining has the host\'s settings (no towns, seeing only what can be seen)', async () => {
  const { NetHost } = await import('../web/src/net/host.js');
  const { NetClient } = await import('../web/src/net/client.js');
  const { memoryLinks } = await import('../web/src/net/peer.js');
  const { WorldHost, WorldClient } = await import('../web/src/world/worldnet.js');
  const m = play({ towns: 'off', vision: 'sight', difficulty: 'hard' });
  m.game.online = true;
  const sync = new WorldHost(m.game, {});
  const net = new NetHost({ maxPlayers: 8, botCount: 0, world: sync, matchInfo: () => ({ mode: 'world', mapName: m.world.name, speed: DEFAULT_SPEED, options: m.game.options, world: sync.info() }), addBot: () => {} });
  net.setGame(m.game);
  let now = 0;
  const queue = [], schedule = (fn, ms) => queue.push({ fn, at: now + ms });
  const [h, c] = memoryLinks({ latency: 20, schedule });
  const client = new NetClient({ link: c, controller: { input: () => ({ move: 0 }) }, loadMap: async () => null, clock: () => now, world: new WorldClient({}) });
  net.addPlayer(h, 'Guest');
  const pump = async () => { for (let k = 0; k < 4; k++) { await new Promise(r => setImmediate(r)); for (const q of queue.filter(q => q.at <= now)) { queue.splice(queue.indexOf(q), 1); q.fn(); } } };
  await pump();
  for (let i = 0; i < 60; i++) { m.game.update(); net.afterTick(); client.tick(); now += 1000 / 60; await pump(); }
  const cw = client.game.world;
  assert.equal(cw.settings.difficulty, 'hard');
  assert.equal(cw.gen.towns, false, 'no towns there either');
  assert.equal(client.game.options.fog, true, 'and only what can be seen');
});
