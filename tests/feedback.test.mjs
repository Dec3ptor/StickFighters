// What a fight tells the player (web/src/feedback.js, combat.js's damage): a tick and a mark for
// every hit of theirs that lands (a sharper one for a headshot), where hits on them come from,
// a flash as their health drops and a pulse when nearly dead, and who killed them, with what and
// how much health they had left. All of it reaches a player online too.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { WEAPONS } from '../web/src/weapons.js';
import { damage } from '../web/src/combat.js';
import { NetHost } from '../web/src/net/host.js';
import { NetClient } from '../web/src/net/client.js';
import { memoryLinks } from '../web/src/net/peer.js';
import { newFeedback, hearFeedback, watchHealth, seeKills, beatDue, feedbackView, HIT_MARK_MS, HURT_MS, FLASH_MS, RECAP_MS, LOW_HEALTH, BEAT_MS } from '../web/src/feedback.js';

const FLAT = { name: 'flat', bounds: { left: -600, top: -600, right: 1600, bottom: 200 }, items: [],
  spawns: [{ x: 0, y: -12, team: 1 }, { x: 400, y: -12, team: 2 }], platforms: [{ left: -600, top: 0, right: 1600, bottom: 40 }] };

/** Two players and a bot on the flat map, alive and unprotected: a at 0, b at 300, the bot at 600. */
function arena() {
  const g = new Game({ mapData: FLAT, effects: false, seed: 5, speed: DEFAULT_SPEED, mode: 'ffa', fragLimit: 999 });
  const a = g.addSoldier({ name: 'Ann', isBot: false }, { input: () => ({ move: 0 }) });
  const b = g.addSoldier({ name: 'Bob', isBot: false }, { input: () => ({ move: 0 }) });
  const bot = g.addSoldier({ name: 'Bot', isBot: true }, { input: () => ({ move: 0 }) });
  for (let i = 0; i < 400 && !(a.alive && b.alive && bot.alive); i++) g.update();
  for (const [s, x] of [[a, 0], [b, 300], [bot, 600]]) { s.spawnProtect = 0; s.body.x = x; s.body.y = -12; s.body.vx = s.body.vy = 0; }
  g.sounds.length = 0;
  return { g, a, b, bot };
}
const mine = (g, s, name) => g.sounds.filter(x => x.name === name && x.to === s.id);

test('every hit that lands tells the one who hit (a tick; a headshot\'s is sharper) and the one hit (where from): theirs alone', () => {
  const { g, a, b, bot } = arena();
  damage(g, b, 12, a, 'M4', { dirX: 1, dirY: 0 });
  assert.equal(mine(g, a, 'hittick').length, 1, 'a tick for the one who hit');
  assert.equal(mine(g, a, 'hitmarker').length, 0);
  const hurt = mine(g, b, 'hurt');
  assert.equal(hurt.length, 1, 'and the one hit is told');
  assert.ok(Math.abs(hurt[0].x - a.x) < 1, 'where it came from: whoever did it');
  assert.equal(g.sounds.filter(x => (x.name === 'hittick' || x.name === 'hurt') && x.to == null).length, 0, 'nobody else hears either');
  // (A shotgun's pellets in one update: once, and a headshot among them still gets its own.)
  g.sounds.length = 0;
  g.update();
  g.sounds.length = 0;
  b.health = b.maxHealth = 1e6;
  for (let i = 0; i < 5; i++) damage(g, b, 7.5, a, 'Shotgun', {});
  damage(g, b, 7.5, a, 'Shotgun', { headshot: true });
  damage(g, b, 7.5, a, 'Shotgun', { headshot: true });
  assert.equal(mine(g, a, 'hitmarker').length, 1, 'one headshot tick');
  assert.ok(mine(g, a, 'hittick').length <= 1);
  assert.equal(mine(g, b, 'hurt').length, 1, 'told once');
  // (Body hits tick no more than twelve a second: a minigun's stream.)
  let ticks = 0;
  for (let i = 0; i < 60; i++) {
    // (The game's sounds are taken each frame: there's only room for so many.)
    g.update(); g.sounds.length = 0; b.health = 1e6;
    damage(g, b, 6.5, a, 'Minigun', {});
    ticks += mine(g, a, 'hittick').length;
  }
  assert.ok(ticks >= 11 && ticks <= 13, `${ticks} ticks in a second`);
  // (Burning does its work without them; a bot hears nothing; hurting yourself isn't a hit.)
  g.sounds.length = 0;
  g.update();
  damage(g, b, 2, a, 'Flamer', { burn: true });
  damage(g, b, 12, bot, 'M4', {});
  damage(g, a, 30, a, 'Bazooka', { explosive: true });
  assert.equal(mine(g, a, 'hittick').length + mine(g, bot, 'hittick').length + mine(g, bot, 'hitmarker').length, 0);
  assert.equal(mine(g, b, 'hurt').length, 1, 'hit by a bot: still told where from');
  assert.equal(mine(g, a, 'hurt').length, 0);
});

test('the mark at the crosshair, the arcs pointing at who hit you, the flash and the pulse', () => {
  const { g, a, b } = arena();
  const fb = newFeedback();
  let now = 1000;
  watchHealth(fb, b, now);
  let v = feedbackView(fb, b, now, 640, 360, 700, 300);
  assert.equal(v.hit, null);
  assert.equal(v.hurts.length, 0);
  assert.equal(v.flash, 0);
  // (A hit of b's lands.)
  hearFeedback(fb, [{ name: 'hittick', x: 0, y: 0, to: b.id }], b, now);
  v = feedbackView(fb, b, now + 50, 640, 360, 700, 300);
  assert.ok(v.hit && !v.hit.head && v.hit.x === 700 && v.hit.y === 300, 'a mark at the crosshair');
  assert.equal(feedbackView(fb, b, now + HIT_MARK_MS + 1, 640, 360, 700, 300).hit, null, 'gone again');
  hearFeedback(fb, [{ name: 'hitmarker', x: 0, y: 0, to: b.id }, { name: 'hittick', x: 0, y: 0, to: b.id }], b, now + 300);
  assert.ok(feedbackView(fb, b, now + 310, 640, 360, 700, 300).hit.head, 'a headshot\'s mark isn\'t taken over by a body hit with it');
  // (Someone else's aren't b's.)
  const other = newFeedback();
  hearFeedback(other, [{ name: 'hittick', x: 0, y: 0, to: a.id }, { name: 'hurt', x: 0, y: 0, to: a.id }], b, now);
  assert.equal(feedbackView(other, b, now, 0, 0, 0, 0).hit, null);
  assert.equal(other.hurts.length, 0);
  // (b is hit from the left, where a is: an arc that way; again from the same place, the same arc.)
  now = 5000;
  hearFeedback(fb, [{ name: 'hurt', x: a.x, y: a.y - 8, to: b.id }], b, now);
  hearFeedback(fb, [{ name: 'hurt', x: a.x + 20, y: a.y - 8, to: b.id }], b, now + 100);
  v = feedbackView(fb, b, now + 150, 640, 360, 0, 0);
  assert.equal(v.hurts.length, 1);
  assert.ok(Math.abs(Math.abs(v.hurts[0].a) - Math.PI) < 0.1, `pointing left, at them (${v.hurts[0].a})`);
  assert.deepEqual(v.at, { x: 640, y: 360 });
  hearFeedback(fb, [{ name: 'hurt', x: b.x, y: b.y - 400, to: b.id }], b, now + 200);
  v = feedbackView(fb, b, now + 250, 640, 360, 0, 0);
  assert.equal(v.hurts.length, 2, 'and one from above');
  assert.ok(v.hurts[1].a < -1.3 && v.hurts[1].a > -1.8);
  hearFeedback(fb, [], b, now + 250 + HURT_MS);
  assert.equal(feedbackView(fb, b, now + 250 + HURT_MS, 640, 360, 0, 0).hurts.length, 0, 'fading out');
  // (Health dropping: a flash, more for more, gone after a moment; none for health coming back.)
  now = 9000;
  watchHealth(fb, b, now);
  b.health -= 12;
  watchHealth(fb, b, now + 16);
  const small = feedbackView(fb, b, now + 16, 0, 0, 0, 0).flash;
  assert.ok(small > 0.2 && small < 0.7, `a flash (${small})`);
  assert.equal(feedbackView(fb, b, now + 16 + FLASH_MS, 0, 0, 0, 0).flash, 0);
  b.health -= 90;
  watchHealth(fb, b, now + 1000);
  assert.ok(feedbackView(fb, b, now + 1000, 0, 0, 0, 0).flash > small, 'more for more');
  b.health += 50;
  watchHealth(fb, b, now + 3000);
  assert.equal(feedbackView(fb, b, now + 3000, 0, 0, 0, 0).flash, 0);
  // (Nearly dead: the pulse, and a heartbeat every so often.)
  b.health = b.maxHealth * LOW_HEALTH * 0.5;
  assert.ok(feedbackView(fb, b, now + 3000, 0, 0, 0, 0).low > 0.4);
  assert.equal(beatDue(fb, b, now + 3000), true);
  assert.equal(beatDue(fb, b, now + 3100), false, 'not again at once');
  assert.equal(beatDue(fb, b, now + 3000 + BEAT_MS), true);
  b.health = b.maxHealth;
  assert.equal(feedbackView(fb, b, now + 3000, 0, 0, 0, 0).low, 0);
  assert.equal(beatDue(fb, b, now + 9000), false);
});

test('killed: who by, with what, and how much health they had left; gone when you\'re back', () => {
  const { g, a, b } = arena();
  const fb = newFeedback();
  let now = 1000;
  seeKills(fb, g, b, now);
  watchHealth(fb, b, now);
  assert.equal(fb.recap, null);
  a.health = 37;
  damage(g, b, 9999, a, 'SR', { headshot: true });
  assert.ok(!b.alive);
  seeKills(fb, g, b, now + 16);
  watchHealth(fb, b, now + 16);
  const c = fb.recap;
  assert.ok(c, 'a recap');
  assert.equal(c.killer, a);
  assert.equal(c.name, 'Ann');
  assert.equal(c.weapon, WEAPONS.SR.name);
  assert.equal(c.headshot, true);
  assert.equal(c.health, 37, 'how much they had left');
  assert.equal(c.dist, 300);
  assert.equal(feedbackView(fb, b, now + 16, 0, 0, 0, 0).recap, c, 'shown while dead');
  // (Looked at once: not made again by the same line.)
  fb.recap = null;
  seeKills(fb, g, b, now + 32);
  assert.equal(fb.recap, null);
  // (The killer's own feedback: no recap for them; nor for a fall.)
  const fa = newFeedback();
  seeKills(fa, g, a, now);
  assert.equal(fa.recap, null);
  // (Back: nothing left of the last life's.)
  fb.recap = c;
  for (let i = 0; i < 400 && !b.alive; i++) g.update();
  assert.ok(b.alive);
  watchHealth(fb, b, now + 3000);
  assert.equal(fb.recap, null);
  assert.equal(feedbackView(fb, b, now + 3000, 0, 0, 0, 0).recap, null);
  // (And it doesn't stay for ever.)
  fb.recap = { ...c, at: 0 };
  seeKills(fb, g, b, RECAP_MS + 1);
  assert.equal(fb.recap, null);
});

test('online: a player is told of their hits and of hits on them, and the kill feed says who killed whom', async () => {
  const g = new Game({ mapData: FLAT, effects: true, seed: 5, speed: DEFAULT_SPEED, mode: 'ffa', fragLimit: 999 });
  let now = 0;
  const queue = [];
  const host = new NetHost({ maxPlayers: 4, botCount: 0, addBot() {}, matchInfo: () => ({ mode: 'ffa', fragLimit: 999, options: g.options, speed: DEFAULT_SPEED, map: { builtin: 'flat' }, mapName: 'flat' }) });
  const hostMe = g.addSoldier({ name: 'Host', isBot: false }, { input: () => ({ move: 0 }) });
  host.setGame(g);
  const [h, c] = memoryLinks({ latency: 0, schedule: (fn, ms) => queue.push({ at: now + ms, fn }) });
  const client = new NetClient({ link: c, controller: { input: () => ({ move: 0, aim: 0, aimDist: 100 }) }, loadMap: async () => FLAT, clock: () => now });
  const p = host.addPlayer(h, 'Guest');
  const pump = async () => { for (let k = 0; k < 4; k++) { await new Promise(r => setImmediate(r)); for (const q of queue.filter(x => x.at <= now)) { queue.splice(queue.indexOf(q), 1); q.fn(); } } };
  const heard = [];
  const step = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      g.update(); host.afterTick(); client.tick(); now += 1000 / 60;
      await pump();
      client.updateView(now);
      if (client.game) { heard.push(...client.game.sounds.map(s => s.name)); client.game.sounds.length = 0; }
    }
  };
  await pump();
  await step(200);
  const guest = p.soldier;
  assert.ok(guest.alive && hostMe.alive && client.me, 'both in');
  guest.spawnProtect = hostMe.spawnProtect = 0;
  heard.length = 0;
  // (The guest hits the host; then the host hits the guest.)
  damage(g, hostMe, 10, guest, 'M4', {});
  await step(12);
  assert.ok(heard.includes('hittick'), `the guest hears their hit land (${[...new Set(heard)]})`);
  assert.ok(!heard.includes('hurt'));
  heard.length = 0;
  damage(g, guest, 10, hostMe, 'M4', {});
  await step(12);
  assert.ok(heard.includes('hurt'), 'and is told when they\'re hit');
  assert.ok(!heard.includes('hittick'), 'but not of the host\'s own hit landing');
  // (Killed: the feed's line carries who and whom, so the recap can be made.)
  hostMe.health = 55;
  damage(g, guest, 9999, hostMe, 'SR', { headshot: true });
  await step(12);
  const line = client.game.feed.at(-1);
  assert.equal(line.victim, client.me, 'the one killed: us');
  assert.equal(line.killer?.name, 'Host');
  assert.equal(line.headshot, true);
  const fb = newFeedback();
  fb.feedSeen = client.game.feed.at(-2) || null;
  seeKills(fb, client.game, client.me, now);
  assert.equal(fb.recap?.name, 'Host');
  assert.equal(fb.recap.health, 55, 'with the health they had left, as we know it');
  assert.equal(fb.recap.weapon, WEAPONS.SR.name);
});
