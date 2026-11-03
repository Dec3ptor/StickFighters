// Worlds online (web/src/world/worldnet.js): a host's world and a player who joins it. The player
// gets the world (its seed, and the chunks changed), every block changed as it happens, their own
// things, the chest they open; what they do goes to the host (digging, the hotbar, crafting,
// chests). The host keeps their things by name. PvP off keeps players off each other; a base flag
// keeps others out of a base. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { NetHost } from '../web/src/net/host.js';
import { NetClient } from '../web/src/net/client.js';
import { memoryLinks } from '../web/src/net/peer.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { TileWorld, TILE } from '../web/src/world/tileworld.js';
import * as K from '../web/src/world/blocks.js';
import { WorldHost, WorldClient } from '../web/src/world/worldnet.js';
import { chestAt, mayChange, claimAt } from '../web/src/world/worldplay.js';
import { RECIPES } from '../web/src/world/crafting.js';
import { canHurt } from '../web/src/combat.js';

/** A host's world with one player joined (`script`: their input each update). */
async function onlineWorld({ seed = 4242, pvp = true, players = {} } = {}) {
  const world = new TileWorld({ seed, name: 'Shared' });
  world.pvp = pvp;
  // Cleared and floored round the start, so tests know what's where.
  const sp = world.spawns[0], fx = Math.floor(sp.x / TILE), fy = Math.floor((sp.y + 13) / TILE);
  for (let y = fy - 14; y <= fy + 2; y++) for (let x = fx - 30; x <= fx + 30; x++) { world.setTile(x, y, y >= fy ? K.STONE : K.AIR); world.setWall(x, y, K.NO_WALL); }
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, effects: true, seed: 1, options: { destruction: true } });
  game.online = true;
  const hostCtl = { script: { move: 0 }, input() { return this.script; } };
  const me = game.addSoldier({ name: 'Host', isBot: false }, hostCtl);
  const saved = players;
  const sync = new WorldHost(game, { load: name => saved[name.toLowerCase()] || null, save: (name, data) => { saved[name.toLowerCase()] = data; } });
  const host = new NetHost({
    maxPlayers: 8, botCount: 0, world: sync,
    matchInfo: () => ({ mode: 'world', mapName: world.name, speed: DEFAULT_SPEED, options: game.options, world: sync.info() }),
    addBot: () => {},
  });
  host.setGame(game);
  let now = 0;
  const queue = [];
  const schedule = (fn, ms) => queue.push({ fn, at: now + ms });
  const chests = [];
  const joinerCtl = { script: { move: 0 }, input() { const s = this.script; this.script = { ...s, firePressed: false, jumpPressed: false, switchTo: null, cycle: 0, reload: false, drop: false }; return s; } };
  const join = name => {
    const [h, c] = memoryLinks({ latency: 20, schedule });
    const wc = new WorldClient({ onChest: ch => chests.push(ch) });
    const client = new NetClient({ link: c, controller: joinerCtl, loadMap: async () => null, clock: () => now, world: wc });
    host.addPlayer(h, name);
    return { client, link: h };
  };
  const pump = async () => {
    for (let k = 0; k < 4; k++) {
      await new Promise(r => setImmediate(r));
      const due = queue.filter(q => q.at <= now);
      for (const q of due) { queue.splice(queue.indexOf(q), 1); q.fn(); }
    }
  };
  let joined = join('Guest');
  await pump();
  const step = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      game.update();
      host.afterTick();
      joined.client.tick();
      now += 1000 / 60;
      await pump();
      joined.client.updateView(now);
    }
  };
  const rejoin = async name => { joined = join(name); await pump(); return joined; };
  return { world, game, me, hostCtl, host, sync, joinerCtl, get client() { return joined.client; }, get link() { return joined.link; }, step, rejoin, chests, saved, fx, fy };
}

const guestOf = m => m.game.soldiers.find(s => s.remote);
const aimAt = (s, tx, ty) => { const x = tx * TILE + 8, y = ty * TILE + 8; return { aim: Math.atan2(y - s.shoulderY, x - s.shoulderX), aimDist: Math.hypot(x - s.shoulderX, y - s.shoulderY) }; };

test('a player joining a world gets it, blocks changed before and after, and the time', async () => {
  const m = await onlineWorld();
  await m.step(90);
  const cw = m.client.game.world;
  assert.ok(cw && cw !== m.world, 'their own copy of the world');
  assert.equal(cw.seed, m.world.seed);
  assert.ok(m.client.game.mirror, 'a copy: the host does it all');
  // Changed before they joined (the chunks sent with the welcome).
  for (let x = m.fx - 30; x <= m.fx + 30; x += 7) assert.equal(cw.tile(x, m.fy), K.STONE, `the floor at ${x}`);
  // Changed while they're in.
  m.world.setTile(m.fx + 5, m.fy - 3, K.GOLD);
  m.world.setWall(m.fx + 6, m.fy - 3, K.BRICK_WALL);
  await m.step(10);
  assert.equal(cw.tile(m.fx + 5, m.fy - 3), K.GOLD, 'a block put there');
  assert.equal(cw.wall(m.fx + 6, m.fy - 3), K.BRICK_WALL, 'a wall');
  // Further off, untouched: the same from the seed.
  assert.equal(cw.tile(m.fx + 400, m.fy + 40), m.world.tile(m.fx + 400, m.fy + 40));
  assert.ok(Math.abs(cw.time - m.world.time) < 30, 'the same time of day');
  // Things on the ground show for them too.
  m.world.drops.push({ key: 'coins', n: 7, x: (m.fx + 3) * TILE, y: m.fy * TILE - 3, px: 0, py: 0, vx: 0, vy: 0, age: 0, delay: 9999, rest: true });
  await m.step(6);
  assert.ok(cw.drops.some(d => d.key === 'coins' && d.n === 7), 'coins on the ground');
});

test('what a player does goes to the host: the hotbar, digging, crafting; their things come back', async () => {
  const m = await onlineWorld();
  await m.step(120);
  const guest = guestOf(m), mine = m.client.me;
  assert.ok(guest.alive && mine.alive, 'in the world');
  assert.equal(mine.world.inv.count('pickaxe'), 1, 'their things (a new character\'s)');
  // The hotbar: slot 2 (the hammer), by number.
  m.joinerCtl.script = { move: 0, switchTo: '#2' };
  await m.step(12);
  assert.equal(guest.world.slot, 2, 'the host has them holding slot 2');
  assert.equal(mine.world.slot, 2, 'and so do they');
  // Digging the floor beside them with the pickaxe (slot 0). (The host's soldier out of the way:
  // what's dug flies to whoever's nearest.)
  m.me.body.x += 40 * TILE;
  m.joinerCtl.script = { move: 0, switchTo: '#0' };
  await m.step(12);
  const tx = Math.floor(guest.x / TILE) + 1, ty = Math.floor((guest.y + 12) / TILE);
  m.world.setTile(tx, ty - 1, K.DIRT);
  await m.step(4);
  for (let i = 0; i < 200 && m.world.tile(tx, ty - 1) !== K.AIR; i++) {
    m.joinerCtl.script = { move: 0, fire: true, ...aimAt(mine, tx, ty - 1) };
    await m.step(1);
  }
  m.joinerCtl.script = { move: 0 };
  assert.equal(m.world.tile(tx, ty - 1), K.AIR, 'dug out on the host');
  await m.step(90);
  assert.equal(m.client.game.world.tile(tx, ty - 1), K.AIR, 'and in their copy');
  assert.ok(mine.world.inv.count('dirt') >= 1, 'the dirt in their things');
  // Crafting: planks from wood, asked of the host.
  guest.world.inv.add('wood', 3);
  await m.step(6);
  const before = mine.world.inv.count('planks');
  m.client.link.send({ t: 'wop', op: 'craft', r: RECIPES.find(r => r.key === 'planks').id, times: 2 }, true);
  await m.step(12);
  assert.equal(mine.world.inv.count('planks'), before + 8, 'eight planks made');
  // Moving a stack (the inventory screen): the host does it.
  m.client.link.send({ t: 'wop', op: 'move', a: ['me', 0], b: ['me', 39] }, true);
  await m.step(12);
  assert.equal(mine.world.inv.slots[39]?.key, 'pickaxe');
  // Nonsense is ignored.
  m.client.link.send({ t: 'wop', op: 'move', a: ['me', -4], b: ['chest', 99] }, true);
  m.client.link.send({ t: 'wop', op: 'craft', r: 99999 }, true);
  await m.step(6);
  assert.equal(guest.world.inv.slots[39]?.key, 'pickaxe');
});

test('a chest opened by a player who joined: its things shown, and taken', async () => {
  const m = await onlineWorld();
  await m.step(120);
  const guest = guestOf(m), mine = m.client.me;
  const tx = Math.floor(guest.x / TILE) + 2, ty = Math.floor((guest.y + 12) / TILE) - 1;
  m.world.setTile(tx, ty, K.CHEST);
  chestAt(m.world, tx, ty).add('gold_bar', 9);
  await m.step(6);
  m.joinerCtl.script = { move: 0, alt: true, ...aimAt(mine, tx, ty) };
  await m.step(2);
  m.joinerCtl.script = { move: 0, ...aimAt(mine, tx, ty) };
  await m.step(12);
  const open = m.chests.filter(Boolean).pop();
  assert.ok(open && open.tx === tx && open.ty === ty, 'the chest opened for them');
  assert.equal(open.inv.count('gold_bar'), 9, 'its things');
  m.client.link.send({ t: 'wop', op: 'take-all' }, true);
  await m.step(12);
  assert.equal(chestAt(m.world, tx, ty).count('gold_bar'), 0, 'emptied');
  assert.equal(mine.world.inv.count('gold_bar'), 9, 'into their things');
});

test('the host keeps a player\'s things by name: they leave, and come back to them', async () => {
  const m = await onlineWorld();
  await m.step(120);
  const guest = guestOf(m);
  guest.world.inv.add('gold_bar', 42);
  m.link.close('left');
  await m.step(4);
  assert.ok(m.saved.guest, 'kept when they left');
  assert.ok(!m.game.soldiers.some(s => s.remote), 'gone from the world');
  await m.rejoin('Guest');
  await m.step(120);
  assert.equal(guestOf(m).world.inv.count('gold_bar'), 42, 'their things back on the host');
  assert.equal(m.client.me.world.inv.count('gold_bar'), 42, 'and on their screen');
});

test('PvP off: players can\'t hurt each other (monsters still can); a base flag keeps others out', async () => {
  const off = await onlineWorld({ pvp: false });
  await off.step(120);
  const g1 = guestOf(off);
  assert.ok(!canHurt(off.game, off.me, g1) && !canHurt(off.game, g1, off.me), 'PvP off');
  const on = await onlineWorld({ pvp: true });
  await on.step(120);
  const g2 = guestOf(on);
  assert.ok(canHurt(on.game, on.me, g2), 'PvP on');
  // The guest puts up a base flag: the host can't dig or build there.
  const tx = Math.floor(g2.x / TILE) + 1, ty = Math.floor((g2.y + 12) / TILE) - 1;
  g2.world.inv.add('claim_flag', 1);
  g2.world.inv.move(g2.world.inv.slots.findIndex(s => s?.key === 'claim_flag'), 9);
  on.joinerCtl.script = { move: 0, switchTo: '#9' };
  await on.step(6);
  on.joinerCtl.script = { move: 0, fire: true, firePressed: true, ...aimAt(on.client.me, tx, ty) };
  await on.step(3);
  on.joinerCtl.script = { move: 0 };
  await on.step(40);
  assert.equal(on.world.tile(tx, ty), K.CLAIM_FLAG, 'the flag is up');
  assert.equal(claimAt(on.world, tx + 5, ty)?.owner, g2.name, 'their base');
  assert.ok(!mayChange(on.world, on.me, tx + 5, ty) && mayChange(on.world, g2, tx + 5, ty), 'theirs to change, not the host\'s');
  assert.equal(claimAt(on.client.game.world, tx + 5, ty)?.owner, g2.name, 'the guest sees it as theirs too');
  // Blasts don't break it (where bases can't be raided: bases.js; the world's raiding setting, off).
  on.world.settings = { ...(on.world.settings || {}), raiding: 'off' };
  await on.step(31);
  on.world.setTile(tx + 3, ty, K.PLANKS);
  on.world.carve((tx + 3) * TILE + 8, ty * TILE + 8, 40);
  assert.equal(on.world.tile(tx + 3, ty), K.PLANKS, 'blast-proof');
});

test('monsters and mercenaries show for players who joined, and go when they go', async () => {
  const m = await onlineWorld();
  await m.step(120);
  const { spawnMonster } = await import('../web/src/world/monsters.js');
  const z = spawnMonster(m.game, 'zombie', m.me.x + 200, m.me.y);
  await m.step(40);
  const seen = m.client.game.soldiers.find(s => s.id === z.id);
  assert.ok(seen && seen.npc?.kind === 'monster' && seen.alive, 'the zombie shows, as a monster');
  m.game.removeSoldier(z);
  await m.step(40);
  assert.ok(!m.client.game.soldiers.some(s => s.id === z.id && s.npc), 'and goes');
});
