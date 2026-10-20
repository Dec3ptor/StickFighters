// Classes online: the host runs the match, players send their class and loadout,
// and what Engineers build reaches everyone. (In-memory links, no network.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { NavGraph } from '../web/src/nav.js';
import { BotController, BOT_PROFILES } from '../web/src/bot.js';
import { NetHost } from '../web/src/net/host.js';
import { NetClient } from '../web/src/net/client.js';
import { memoryLinks } from '../web/src/net/peer.js';
import { encodeInputs, decodeInputs, encodeWorld, encodeSnapshot, decodeSnapshot } from '../web/src/net/protocol.js';
import { damage } from '../web/src/combat.js';
import { useGadget, beaconKey } from '../web/src/gadgets.js';
import { defaultLoadouts } from '../web/src/classes.js';
import { DEFAULT_SPEED, RULES } from '../web/src/config.js';
import { makeRng } from '../web/src/util.js';
import { loadMap } from './helpers.mjs';

const idle = { input: () => ({ move: 0, aim: 0, aimDist: 200 }) };

/** A host (classes on) with `bots` bots, and `players` remote players over in-memory links on a simulated clock. */
async function onlineMatch({ players = 1, bots = 2, mode = 'team', file = 'ssdm1.json', mapData = loadMap(file), controllers = [], fragLimit = 999 } = {}) {
  const game = new Game({ mapData, mode, fragLimit, seed: 5, effects: true, speed: DEFAULT_SPEED, options: { classes: true } });
  const nav = new NavGraph(game.map);
  const rng = makeRng(5);
  const addBot = g => {
    const profile = BOT_PROFILES[g.soldiers.length % BOT_PROFILES.length];
    g.addSoldier({ name: profile.name + g.soldiers.length, isBot: true, profile, team: g.rules.teams ? 1 + (g.soldiers.length % 2) : 0 }, new BotController(nav, 'normal', profile, rng));
  };
  let now = 0;
  const queue = [];
  const schedule = (fn, ms) => queue.push({ at: now + ms, fn });
  const host = new NetHost({
    maxPlayers: 8, botCount: bots,
    matchInfo: () => ({ mode, fragLimit, options: game.options, speed: DEFAULT_SPEED, map: { builtin: file }, mapName: 'test' }),
    addBot,
  });
  const me = game.addSoldier({ name: 'Host', isBot: false, team: 1 }, idle);
  host.setGame(game);
  const clients = [];
  const add = i => {
    const [h, c] = memoryLinks({ schedule, rng: makeRng(9 + i) });
    const client = new NetClient({ link: c, controller: controllers[i] || idle, loadMap: async () => mapData, clock: () => now });
    clients.push(client);
    host.addPlayer(h, `Guest${i}`);
    return client;
  };
  for (let i = 0; i < players; i++) add(i);
  const pump = async () => {
    for (let k = 0; k < 4; k++) {
      await new Promise(r => setImmediate(r));
      const due = queue.filter(q => q.at <= now);
      for (const q of due) { queue.splice(queue.indexOf(q), 1); q.fn(); }
    }
  };
  await pump();
  const step = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      game.update();
      host.afterTick();
      for (const c of clients) c.tick();
      now += 1000 / 60;
      await pump();
      for (const c of clients) c.updateView(now);
    }
  };
  /** The host's soldier for a client. */
  const soldierOf = c => game.soldiers.find(s => s.id === c.me.id);
  /** Another player joins (mid-match). */
  const join = async () => { const c = add(clients.length); await pump(); return c; };
  return { game, host, clients, step, me, soldierOf, join };
}

test('inputs carry the gadget key, and wall or plank for the Builder', () => {
  const [a, b] = decodeInputs(encodeInputs([{ seq: 1, gadget: true, sprint: true, plank: true }, { seq: 2, move: 1 }]));
  assert.ok(a.gadget && a.sprint && a.plank);
  assert.ok(!b.gadget && !b.plank);
});

test('snapshots carry classes, beacons, supplies and our gadget\'s charge and upgrades', async () => {
  const { game, step, me } = await onlineMatch({ players: 0, bots: 3 });
  me.pickCls = 'recon';
  me.loadouts = { ...defaultLoadouts(), recon: { main: 'SR', ups: { SR: 'hollow', Platinum: 'extmag' } } };
  await step(80);
  assert.ok(me.alive && me.cls === 'recon');
  game.nextId = 70000; // (a long match: beacon ids go past 16 bits)
  assert.ok(useGadget(game, me), 'placed a beacon');
  const medic = game.soldiers.find(s => s.isBot);
  medic.pickCls = 'assault';
  game.kill(medic, null, null);
  await step(RULES.respawnTicks + 5);
  medic.gadgetCharge = 0;
  assert.ok(useGadget(game, medic), 'dropped a medkit');
  const snap = decodeSnapshot(encodeSnapshot(game, me, 1, encodeWorld(game)));
  assert.deepEqual(snap.me.mods, { SR: 'hollow', Platinum: 'extmag' });
  assert.ok(snap.me.gadgetCharge > 0, 'recharging');
  assert.equal(snap.soldiers.find(s => s.id === me.id).cls, 'recon');
  assert.equal(snap.soldiers.find(s => s.id === medic.id).cls, 'assault');
  assert.deepEqual(snap.beacons.map(b => [b.id, b.owner, b.team]), game.beacons.map(b => [b.id, b.owner, b.team]));
  const kit = snap.looseItems.find(it => it.type === 'medkit');
  assert.ok(kit && kit.team === medic.team, 'the medkit and its team');
});

test('online: a player\'s class and loadout reach the host, which spawns them with it', async () => {
  const { game, clients, step, soldierOf } = await onlineMatch({ players: 1 });
  const c = clients[0];
  assert.ok(c.game.classesOn, 'the host\'s Classes option applies');
  await step(60);
  assert.equal(soldierOf(c).alive, false, 'waits for the player\'s kit before spawning');
  c.sendKit({ cls: 'engineer', loadouts: { ...defaultLoadouts(), engineer: { main: 'HomingMissile', ups: { HomingMissile: 'extra', Uzi: 'nonsense' } } } });
  await step(60);
  const s = soldierOf(c);
  assert.ok(s.alive, 'spawned once the kit arrived');
  assert.equal(s.cls, 'engineer');
  assert.equal(s.weapons.HomingMissile.ammo, 4, 'extra round');
  assert.deepEqual(s.mods, { HomingMissile: 'extra' }, 'nonsense dropped');
  await step(10);
  assert.equal(c.me.cls, 'engineer', 'the player sees their class');
  assert.deepEqual(c.me.mods, { HomingMissile: 'extra' });
  assert.ok(c.me.weapons.HomingMissile && c.me.weapons.Uzi, 'and their kit');
  assert.ok(c.game.pickups.items.every(it => it.type !== 'weapon' || it.dropped), 'no map weapons on their screen either');
  // Changing class: from the next spawn.
  c.sendKit({ cls: 'recon', loadouts: defaultLoadouts() });
  await step(5);
  assert.equal(s.cls, 'engineer');
  game.kill(s, null, null);
  await step(RULES.respawnTicks + 10);
  assert.equal(s.cls, 'recon');
  assert.ok(s.weapons.SR);
});

test('online: the end of a match reaches every player (on any update)', async () => {
  const { game, clients, step, soldierOf } = await onlineMatch({ players: 2, mode: 'ffa', bots: 0, fragLimit: 1 });
  for (const c of clients) c.sendKit({ cls: 'assault', loadouts: defaultLoadouts() });
  await step(90);
  const [a, b] = clients;
  // (Snapshots go out every third update: end it on one in between.)
  while (game.tick % 3 !== 1) await step(1);
  soldierOf(b).spawnProtect = 0;
  damage(game, soldierOf(b), 1000, soldierOf(a), 'M4');
  assert.ok(game.over);
  await step(30);
  for (const c of clients) assert.ok(c.game.over, 'the player sees the match end');
});

test('online: choosing a class while dead holds the respawn', async () => {
  const { game, clients, step, soldierOf } = await onlineMatch({ players: 1 });
  const c = clients[0];
  c.sendKit({ cls: 'assault', loadouts: defaultLoadouts() });
  await step(90);
  const s = soldierOf(c);
  assert.ok(s.alive);
  game.kill(s, null, null);
  await step(10);
  c.sendKit({ cls: 'support', loadouts: defaultLoadouts(), hold: true });
  await step(RULES.respawnTicks + 60);
  assert.equal(s.alive, false, 'waiting while the player chooses');
  assert.equal(c.me.holdSpawn, 1, 'their screen knows');
  c.sendKit({ cls: 'support', loadouts: defaultLoadouts(), hold: false });
  await step(RULES.respawnTicks);
  assert.ok(s.alive && s.cls === 'support');
});

test('online: a player\'s spawn beacon becomes their spawn choice, and the host spawns them on it', async () => {
  let pressG = false;
  const ctl = { input: () => { const g = pressG; pressG = false; return { move: 0, aim: 0, aimDist: 200, gadget: g }; } };
  const { game, clients, step, soldierOf } = await onlineMatch({ players: 1, controllers: [ctl], bots: 0 });
  const c = clients[0];
  c.sendKit({ cls: 'recon', loadouts: defaultLoadouts() });
  await step(120);
  const s = soldierOf(c);
  assert.ok(s.alive && s.cls === 'recon');
  pressG = true;
  await step(30);
  assert.equal(game.beacons.length, 1, 'the host placed it');
  const b = game.beacons[0];
  assert.equal(c.game.beacons.length, 1, 'the player sees it');
  assert.equal(c.me.deployAt, beaconKey(b), 'and picks it to spawn on');
  assert.equal(s.deployAt, beaconKey(b), 'which the host is told');
  assert.deepEqual(c.game.deployOptions(c.me).map(o => o.key), ['auto', beaconKey(b)]);
  // Away from it, die, and come back on it.
  s.body.x += 150;
  game.kill(s, null, null);
  await step(RULES.respawnTicks + 5);
  assert.ok(s.alive && Math.abs(s.x - b.x) < 1, `respawned on the beacon (${s.x} vs ${b.x})`);
});

// A long flat floor, in three pieces, with a spawn point at each end.
const FLAT = {
  name: 'flat', bounds: { left: -1000, top: -600, right: 1000, bottom: 200 }, items: [],
  spawns: [{ x: -900, y: -12, team: 1 }, { x: 900, y: -12, team: 2 }],
  platforms: [{ left: -1000, top: 0, right: -500, bottom: 40 }, { left: -500, top: 0, right: 500, bottom: 40 }, { left: 500, top: 0, right: 1000, bottom: 40 }],
};
const blocks = g => g.map.solids.map(p => [p.l, p.t, p.r, p.b, !!p.built].join(',')).sort();

test("online: an Engineer's Builder builds on the host, and everyone (players joining later too) gets the block", async () => {
  const keys = { g: false, click: false, plank: false };
  // Aims at the floor 90 px in front.
  const ctl = {
    input: (g, me) => {
      const tx = me.x + 90, ty = me.y + 8;
      const inp = {
        move: 0, aim: Math.atan2(ty - me.shoulderY, tx - me.shoulderX), aimDist: Math.hypot(tx - me.shoulderX, ty - me.shoulderY),
        gadget: keys.g, fire: keys.click, firePressed: keys.click, plank: keys.plank,
      };
      keys.g = keys.click = false;
      return inp;
    },
  };
  const { game, clients, step, soldierOf, join } = await onlineMatch({ players: 1, controllers: [ctl], bots: 0, mapData: FLAT });
  const c = clients[0];
  c.sendKit({ cls: 'engineer', loadouts: defaultLoadouts() });
  await step(120);
  const s = soldierOf(c);
  assert.ok(s.alive && s.cls === 'engineer' && s.weapons.Builder);
  keys.g = true;
  await step(30);
  assert.equal(s.current, 'Builder', 'G takes out the Builder');
  assert.equal(c.me.current, 'Builder');
  keys.click = true;
  await step(30);
  assert.equal(game.map.builtCount, 1, 'a wall went up');
  assert.equal(s.weapons.Builder.ammo, 5, 'using a block');
  const wall = game.map.solids.find(p => p.built);
  assert.deepEqual([wall.r - wall.l, wall.b - wall.t, wall.b], [12, 40, 0], 'a wall standing on the floor');
  assert.deepEqual(blocks(c.game), blocks(game), 'the player has it too');
  // A plank (as the player chose it).
  keys.plank = true;
  await step(5);
  assert.ok(s.buildPlank && c.me.buildPlank);
  s.body.x += s.x > 0 ? -300 : 300; // (somewhere else along the floor)
  await step(10);
  keys.click = true;
  await step(30);
  assert.equal(game.map.builtCount, 2);
  assert.ok(game.map.solids.some(p => p.built && p.r - p.l === 64 && p.b - p.t === 10), 'a plank');
  assert.deepEqual(blocks(c.game), blocks(game));
  // Someone joining now gets the blocks with the map.
  const late = await join();
  await step(30);
  assert.deepEqual(blocks(late.game), blocks(game), 'a player joining later');
  // A rocket breaks the wall (Destruction is off: the rest of the map doesn't break) for everyone.
  game.carve(Math.round((wall.l + wall.r) / 2), wall.t + 20, 30);
  await step(10);
  assert.equal(game.map.solids.filter(p => !p.built).length, 3, 'the floor is still whole');
  assert.ok(!game.map.solids.some(p => p.built && p.b - p.t === 40), 'the wall is broken');
  for (const cl of [c, late]) assert.deepEqual(blocks(cl.game), blocks(game));
});
