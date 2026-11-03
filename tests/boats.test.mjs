// Boats (web/src/world/boats.js): rafts, rowing boats and sailboats, made at a workbench, put on
// water with a click, floating there (bobbing, carried by flowing water, drifting slowly empty,
// aground on a shore), got into with a right click and rowed left and right (faster than swimming;
// a rowing boat faster than running; nowhere on land), got out of with a jump; two in a rowing
// boat; broken by hitting it, back into the thing it was; kept with the world; online, everyone
// sees them, and whoever rows one moves it on their own screen as the host does.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED, PHYS, BODY } from '../web/src/config.js';
import { TileWorld } from '../web/src/world/tileworld.js';
import * as K from '../web/src/world/blocks.js';
import { TILE } from '../web/src/world/blocks.js';
import { Inventory, itemOf, ITEMS } from '../web/src/world/items.js';
import { RECIPES, craft } from '../web/src/world/crafting.js';
import { itemDetails, categoryOf } from '../web/src/world/iteminfo.js';
import { heldLook } from '../web/src/world/hands.js';
import { drawIcon } from '../web/src/world/worldrender.js';
import { drawBoats } from '../web/src/world/boatart.js';
import { BOATS, addBoat, board, breakBoat, boatsTick, boatsToSave, boatsFromSave, windIn } from '../web/src/world/boats.js';
import { createWorld, saveWorld, exportWorld, importWorld, getWorld } from '../web/src/world/worldsave.js';
import { NetHost } from '../web/src/net/host.js';
import { NetClient } from '../web/src/net/client.js';
import { memoryLinks } from '../web/src/net/peer.js';
import { WorldHost, WorldClient } from '../web/src/world/worldnet.js';

/**
 * A world cleared round where it starts, floored with stone, and a pond in it: four tiles deep,
 * from `p0` to `p1` (tiles across), its top level with the land either side (the shores).
 */
function carve(world) {
  const sp = world.spawns[0], fx = Math.floor(sp.x / TILE), fy = Math.floor((sp.y + 13) / TILE);
  for (let y = fy - 16; y <= fy + 6; y++) {
    for (let x = fx - 40; x <= fx + 110; x++) { world.setTile(x, y, y >= fy ? K.STONE : K.AIR); world.setWall(x, y, K.NO_WALL); }
  }
  const p0 = fx + 10, p1 = fx + 50;
  for (let y = fy; y < fy + 4; y++) for (let x = p0; x <= p1; x++) world.setTile(x, y, K.WATER);
  return { fx, fy, p0, p1, top: fy * TILE };
}

function play() {
  const world = new TileWorld({ seed: 4242, name: 'Pond' });
  const at = carve(world);
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const inp = { move: 0 };
  const me = game.addSoldier({ name: 'Sailor', isBot: false }, { input: () => inp });
  for (let i = 0; i < 300 && !me.alive; i++) game.update();
  me.world.inv = new Inventory();
  me.spawnProtect = 0;
  standAt(me, at.p0 - 2, at.fy);
  return { world, game, me, inp, ...at };
}

/** Soldier s stood on the ground at tile column tx (the ground's top at row fy). */
function standAt(s, tx, fy) {
  Object.assign(s.body, { x: tx * TILE + 8, y: fy * TILE - BODY.bottom - 0.5, vx: 0, vy: 0, onGround: true });
  s.prevX = s.body.x; s.prevY = s.body.y;
}

/** Aim at (x, y) (px). */
function aimAt(s, inp, x, y) {
  inp.aim = Math.atan2(y - s.shoulderY, x - s.shoulderX);
  inp.aimDist = Math.hypot(x - s.shoulderX, y - s.shoulderY);
  s.aim = inp.aim; s.aimDist = inp.aimDist;
}

/** One click of the left (or right: alt) button. */
function click(game, inp, alt = false) {
  if (alt) { inp.alt = true; game.update(); inp.alt = false; game.update(); }
  else { inp.fire = true; inp.firePressed = true; game.update(); inp.fire = false; inp.firePressed = false; game.update(); }
}

/** A jump pressed (one update). */
function jump(game, inp) {
  inp.jump = true; inp.jumpPressed = true; game.update();
  inp.jump = false; inp.jumpPressed = false;
}

/** Hold `key` in hotbar slot 0. */
function give(me, key, n = 1) {
  me.world.inv.slots[0] = { key, n };
  me.world.slot = 0;
}

/** Put a boat on the water at tile column tx, from where `me` stands. Returns it. */
function launchAt(t, key, tx) {
  give(t.me, key);
  aimAt(t.me, t.inp, tx * TILE + 8, t.top + 6);
  click(t.game, t.inp);
  return [...t.world.boats.values()].at(-1);
}

/** Get into boat b (a right click on it). */
function getIn(t, b) {
  aimAt(t.me, t.inp, b.x, b.y + 1);
  click(t.game, t.inp, true);
}

test('boats are made at a workbench: a raft of logs lashed with leather or wool, a rowing boat of planks, a sailboat from one', () => {
  const near = new Set(['workbench']);
  for (const key of ['raft', 'rowboat', 'sailboat']) {
    const it = itemOf(key);
    assert.equal(it.kind, 'boat', key);
    assert.equal(it.stack, 1, `${key}: one to a slot`);
    assert.equal(it.boat, key);
    assert.ok(RECIPES.some(r => r.key === key && r.at === 'workbench'), `${key}: made at a workbench`);
    // What it is, for the inventory's card; held in hand as itself.
    assert.equal(categoryOf(it), 'boat');
    const d = itemDetails(it);
    assert.ok(d.lines.some(l => /water/.test(l)) && d.lines.some(l => /Right click/.test(l)), d.lines.join(' | '));
    assert.equal(heldLook(it).item, it);
  }
  const inv = new Inventory();
  inv.add('wood', 5); inv.add('leather', 2);
  const raft = RECIPES.find(r => r.key === 'raft' && r.of.some(([k]) => k === 'leather'));
  assert.equal(craft(inv, raft, new Set()).made, 0, 'not by hand');
  assert.equal(craft(inv, raft, near).made, 1);
  assert.equal(inv.count('raft'), 1);
  assert.ok(RECIPES.some(r => r.key === 'raft' && r.of.some(([k]) => k === 'wool')), 'or with wool');
  inv.add('planks', 20);
  assert.equal(craft(inv, RECIPES.find(r => r.key === 'rowboat'), near).made, 1);
  inv.add('wood', 2); inv.add('wool', 6);
  assert.equal(craft(inv, RECIPES.find(r => r.key === 'sailboat'), near).made, 1);
  assert.equal(inv.count('sailboat'), 1);
  assert.equal(inv.count('rowboat'), 0, 'the rowing boat went into it');
  // Their pictures, in either look (on a stand-in canvas).
  let calls = 0;
  const ctx = new Proxy({}, { get(o, k) { if (k in o) return o[k]; return () => { calls++; }; }, set(o, k, v) { o[k] = v; return true; } });
  for (const key of ['raft', 'rowboat', 'sailboat']) for (const classic of [true, false]) drawIcon(ctx, itemOf(key), 0, 0, 32, classic);
  assert.ok(calls > 100, 'drawn');
  assert.ok([...ITEMS.values()].filter(it => it.kind === 'boat').length === 3);
});

test('a boat goes on water: clicked on the water it floats at its top; on land, it doesn\'t go', () => {
  const t = play();
  give(t.me, 'raft');
  // On land: nothing.
  aimAt(t.me, t.inp, (t.p0 - 4) * TILE + 8, t.top + 4);
  click(t.game, t.inp);
  assert.equal(t.world.boats.size, 0, 'not on land');
  assert.equal(t.me.world.inv.count('raft'), 1, 'still in hand');
  assert.ok(t.game.notes.some(n => /water/.test(n.text)), 'told why');
  // Out of reach: nothing.
  aimAt(t.me, t.inp, (t.fx + 40) * TILE, t.top + 4);
  click(t.game, t.inp);
  assert.equal(t.world.boats.size, 0, 'not out of reach');
  // On the water, in reach: there it is, at the water's top, and the raft's used.
  const b = launchAt(t, 'raft', t.p0 + 2);
  assert.ok(b, 'a boat');
  assert.equal(b.kind, 'raft');
  assert.equal(t.me.world.inv.count('raft'), 0, 'out of the hand');
  assert.ok(Math.abs(b.y - t.top) < 2, `at the water's top (${b.y} vs ${t.top})`);
  assert.ok(b.x - BOATS.raft.len / 2 >= t.p0 * TILE - 0.5, 'all of it on the water');
  // (Next to the shore, it's moved out onto the water.)
  const c = launchAt(t, 'rowboat', t.p0);
  assert.ok(c && c.x - BOATS.rowboat.len / 2 >= t.p0 * TILE - 0.5, 'moved off the shore');
});

test('it floats, bobbing on the top; empty, it drifts slowly with the wind, and stops at the shore', () => {
  const t = play();
  const b = addBoat(t.world, 'raft', (t.p0 + 20) * TILE, t.top - 12);
  // Dropped just above the water: it falls onto it, and stays at its top.
  for (let i = 0; i < 30; i++) boatsTick(t.game);
  assert.ok(Math.abs(b.y - t.top) < 1, `on the water's top (${b.y})`);
  const x0 = b.x;
  for (let i = 0; i < 300; i++) { boatsTick(t.game); assert.ok(Math.abs(b.y - t.top) < 1.5, 'still on top'); }
  const moved = b.x - x0;
  assert.ok(Math.abs(moved) > 2 && Math.abs(moved) < 40, `drifting slowly (${moved.toFixed(1)} px in five seconds)`);
  assert.equal(Math.sign(moved), Math.sign(windIn(t.world)), 'with the wind');
  // Left long enough, it comes to the shore and stops there, not on the land.
  for (let i = 0; i < 6000; i++) boatsTick(t.game);
  const half = BOATS.raft.len / 2;
  assert.ok(b.x - half >= t.p0 * TILE - 1 && b.x + half <= (t.p1 + 1) * TILE + 1, `still on the water (${b.x})`);
  assert.ok(Math.abs(b.y - t.top) < 1.5);
  // Its bob, as it's drawn: up and down a little.
  let lo = Infinity, hi = -Infinity;
  const ys = [];
  const ctx = new Proxy({}, { get(o, k) { if (k === 'translate') return (x, y) => ys.push(y); if (k in o) return o[k]; return () => {}; }, set(o, k, v) { o[k] = v; return true; } });
  for (let i = 0; i < 120; i++) { t.game.tick++; drawBoats(ctx, t.game, 'remastered', 0); }
  for (const y of ys) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
  assert.ok(hi - lo > 1 && hi - lo < 4, `bobbing (${(hi - lo).toFixed(2)} px)`);
});

test('flowing water carries a boat along the way it runs', () => {
  const t = play();
  // A channel off to the side: its water flowing east (each tile a level lower), over still water.
  const c0 = t.fx + 60;
  const levels = [7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2];
  for (let i = 0; i < levels.length; i++) {
    t.world.setTile(c0 + i, t.fy, K.WATER_FLOW[levels[i]]);
    for (let y = t.fy + 1; y < t.fy + 3; y++) t.world.setTile(c0 + i, y, K.WATER);
  }
  assert.equal(t.world.currentAt((c0 + 3) * TILE + 8, t.top + 10), 1, 'it runs east');
  const b = addBoat(t.world, 'raft', (c0 + 1) * TILE + 8, t.top + 2);
  const x0 = b.x;
  for (let i = 0; i < 200; i++) boatsTick(t.game);
  assert.ok(b.x - x0 > 25, `carried east (${(b.x - x0).toFixed(1)} px)`);
  assert.ok(b.x + BOATS.raft.len / 2 <= (c0 + levels.length) * TILE + 1, 'not past the water\'s end');
});

test('in a boat: rowed left and right, faster than swimming (a rowing boat faster than running), stopped by the shore; stuck on land', () => {
  const t = play();
  const b = launchAt(t, 'raft', t.p0 + 2);
  getIn(t, b);
  assert.deepEqual(t.me.body.boat, { id: b.id, kind: 'raft', seat: 0 }, 'in it, rowing');
  assert.equal(b.rider, t.me.id);
  assert.ok(t.me.body.crouching, 'sat down');
  // Rowed east: up to its speed, the boat and its rower going together.
  t.inp.move = 1;
  for (let i = 0; i < 150; i++) t.game.update();
  const raftSpeed = t.me.body.vx;
  assert.ok(raftSpeed > PHYS.runSpeed * PHYS.swimSpeed * 1.2 && raftSpeed < PHYS.runSpeed, `a raft: faster than swimming, slower than running (${raftSpeed.toFixed(2)})`);
  assert.ok(Math.abs(b.x + BOATS.raft.seats[0] - t.me.x) < 0.01, 'the boat with them');
  assert.ok(Math.abs(t.me.y - (b.y - BOATS.raft.sit)) < 2, 'sat on it');
  // Shooting from it, as anywhere (and still in it after).
  t.me.world.inv.slots[1] = { key: 'Platinum', n: 1, mag: 8 };
  t.me.world.inv.add('bullets', 40);
  t.me.world.slot = 1;
  t.game.update();
  assert.equal(t.me.current, 'Platinum');
  for (let i = 0; i < 60 && t.me.weapons.Platinum.mag > 5; i++) {
    Object.assign(t.inp, { fire: true, firePressed: i % 2 === 0, aim: -Math.PI / 2, aimDist: 200 });
    t.game.update();
  }
  Object.assign(t.inp, { fire: false, firePressed: false });
  assert.ok(t.me.weapons.Platinum.mag <= 5, `shots fired from it (${t.me.weapons.Platinum.mag} left)`);
  assert.equal(t.me.body.boat?.id, b.id, 'still in it');
  t.me.world.slot = 0;
  // Rowed west, to the shore: it stops there.
  t.inp.move = -1;
  for (let i = 0; i < 400; i++) t.game.update();
  assert.ok(Math.abs(b.vx) < 0.01, 'stopped');
  assert.ok(b.x - BOATS.raft.len / 2 >= t.p0 * TILE - 1 && b.x - BOATS.raft.len / 2 < t.p0 * TILE + 6, `at the shore (${b.x - BOATS.raft.len / 2} vs ${t.p0 * TILE})`);
  assert.ok(t.me.body.boat, 'still in it');
  // Out (a jump): up out of it, and it stays.
  t.inp.move = 0;
  const bx = b.x;
  jump(t.game, t.inp);
  assert.equal(t.me.body.boat, null, 'out');
  assert.ok(t.me.body.vy < 0, 'with a hop');
  for (let i = 0; i < 5; i++) t.game.update();
  assert.equal(b.rider, -1, 'nobody rowing');
  assert.ok(Math.abs(b.x - bx) < 2, 'the boat where it was');

  // A rowing boat: faster than running.
  const r = addBoat(t.world, 'rowboat', (t.p0 + 4) * TILE, t.top);
  standAt(t.me, t.p0 - 1, t.fy);
  for (let i = 0; i < 3; i++) t.game.update();
  getIn(t, r);
  assert.equal(t.me.body.boat?.id, r.id);
  t.inp.move = 1;
  for (let i = 0; i < 150; i++) t.game.update();
  assert.ok(t.me.body.vx > PHYS.runSpeed, `faster than running (${t.me.body.vx.toFixed(2)})`);
  t.inp.move = 0;
  jump(t.game, t.inp);

  // On land: in it, but going nowhere.
  const land = addBoat(t.world, 'raft', (t.fx - 10) * TILE, t.top - BOATS.raft.keel);
  for (let i = 0; i < 20; i++) boatsTick(t.game);
  standAt(t.me, t.fx - 13, t.fy);
  for (let i = 0; i < 3; i++) t.game.update();
  getIn(t, land);
  assert.equal(t.me.body.boat?.id, land.id, 'in it');
  const lx = land.x;
  t.inp.move = 1;
  for (let i = 0; i < 60; i++) t.game.update();
  assert.ok(Math.abs(land.x - lx) < 0.5, 'not rowed over land');
  assert.ok(Math.abs(t.me.x - (land.x + BOATS.raft.seats[0])) < 0.5, 'sat in it');
});

test('two in a rowing boat: the first rows, the other rides along; a raft holds one; monsters and animals never get in', () => {
  const t = play();
  const b = launchAt(t, 'rowboat', t.p0 + 2);
  getIn(t, b);
  // A second player.
  const inp2 = { move: 0 };
  const you = t.game.addSoldier({ name: 'Mate', isBot: false }, { input: () => inp2 });
  for (let i = 0; i < 300 && !you.alive; i++) t.game.update();
  you.world.inv = new Inventory();
  standAt(you, t.p0 - 2, t.fy);
  for (let i = 0; i < 2; i++) t.game.update();
  aimAt(you, inp2, b.x + 6, b.y + 1);
  inp2.alt = true; t.game.update(); inp2.alt = false; t.game.update();
  assert.deepEqual(you.body.boat, { id: b.id, kind: 'rowboat', seat: 1 }, 'in the other seat');
  assert.equal(b.passenger, you.id);
  // Rowed: both go with it, each in their seat.
  t.inp.move = 1;
  for (let i = 0; i < 90; i++) t.game.update();
  const def = BOATS.rowboat;
  assert.ok(b.x > (t.p0 + 8) * TILE, 'rowed');
  assert.ok(Math.abs(you.x - (b.x + def.seats[1])) < 0.5 && Math.abs(t.me.x - (b.x + def.seats[0])) < 0.5, 'both in their seats');
  assert.ok(Math.abs(you.y - t.me.y) < 0.5, 'side by side');
  // The passenger's left and right don't row it.
  t.inp.move = 0;
  inp2.move = -1;
  for (let i = 0; i < 200; i++) t.game.update();
  assert.ok(Math.abs(b.vx) < 0.05, 'only the rower rows');
  // A third: no room.
  const third = t.game.addSoldier({ name: 'Third', isBot: false }, { input: () => ({ move: 0 }) });
  for (let i = 0; i < 300 && !third.alive; i++) t.game.update();
  assert.equal(board(t.game, third, b), false, 'full');
  // The rower gets out: the passenger stays in, and the boat drifts.
  inp2.move = 0;
  jump(t.game, t.inp);
  for (let i = 0; i < 5; i++) t.game.update();
  assert.equal(b.rider, -1);
  assert.equal(you.body.boat?.id, b.id, 'the passenger still in');
  // A raft: one only.
  const r = addBoat(t.world, 'raft', (t.p0 + 30) * TILE, t.top);
  assert.equal(board(t.game, third, r), true);
  assert.equal(board(t.game, t.me, r), false, 'a raft holds one');
  // Monsters, animals and townsfolk don't get in.
  const r2 = addBoat(t.world, 'raft', (t.p0 + 36) * TILE, t.top);
  for (const npc of [{ kind: 'monster', type: 'zombie' }, { kind: 'animal', look: 'fish' }, { kind: 'townsfolk' }]) {
    const m = t.game.addSoldier({ name: 'Npc', isBot: true }, null);
    m.npc = npc;
    m.alive = true;
    assert.equal(board(t.game, m, r2), false, `${npc.kind}: not in a boat`);
  }
  assert.equal(r2.rider, -1);
});

test('hit a few times, a boat breaks: whoever\'s in it is out, and it\'s back in the hands of whoever broke it', () => {
  const t = play();
  const b = launchAt(t, 'rowboat', t.p0 + 3);
  give(t.me, 'stone', 5);
  const hits = BOATS.rowboat.hp;
  for (let i = 0; i < hits - 1; i++) {
    aimAt(t.me, t.inp, b.x, b.y - 2);
    click(t.game, t.inp);
    for (let k = 0; k < 14; k++) t.game.update();
  }
  assert.ok(t.world.boats.has(b.id), 'not broken yet');
  assert.ok(b.hp === 1, `hurt (${b.hp})`);
  assert.equal(t.me.world.inv.count('stone'), 5, 'the stone in hand wasn\'t put down');
  aimAt(t.me, t.inp, b.x, b.y - 2);
  click(t.game, t.inp);
  assert.ok(!t.world.boats.has(b.id), 'broken');
  assert.equal(t.me.world.inv.count('rowboat'), 1, 'back as a rowing boat');
  // A gun in hand shoots, and doesn't break it.
  const c = launchAt(t, 'raft', t.p0 + 3);
  give(t.me, 'Platinum');
  t.me.world.inv.add('bullets', 50);
  for (let i = 0; i < 6; i++) { aimAt(t.me, t.inp, c.x, c.y - 2); click(t.game, t.inp); for (let k = 0; k < 14; k++) t.game.update(); }
  assert.ok(t.world.boats.has(c.id), 'not with a gun');
  // Left alone a while, a hurt boat mends.
  give(t.me, null);
  t.me.world.inv.slots[0] = null;
  aimAt(t.me, t.inp, c.x, c.y - 2);
  click(t.game, t.inp);
  assert.equal(c.hp, BOATS.raft.hp - 1);
  for (let i = 0; i < 600; i++) t.game.update();
  assert.equal(c.hp, BOATS.raft.hp, 'mended');
  // Broken with someone in it: they're out, in the water. (It's drifted a little: back in reach.)
  c.x = c.px = (t.p0 + 2) * TILE;
  getIn(t, c);
  assert.equal(t.me.body.boat?.id, c.id);
  for (let i = 0; i < BOATS.raft.hp; i++) {
    aimAt(t.me, t.inp, c.x - 8, c.y - 1);
    click(t.game, t.inp);
    for (let k = 0; k < 14; k++) t.game.update();
  }
  assert.ok(!t.world.boats.has(c.id), 'broken');
  assert.equal(t.me.body.boat, null, 'out of it');
  assert.equal(t.me.world.inv.count('raft'), 1);
});

test('boats are kept with the world: saved, loaded, exported and imported', async () => {
  const t = play();
  addBoat(t.world, 'raft', (t.p0 + 5) * TILE, t.top);
  addBoat(t.world, 'sailboat', (t.p0 + 25) * TILE, t.top);
  const kept = boatsToSave(t.world);
  assert.equal(kept.length, 2);
  const again = new TileWorld({ seed: 4242, name: 'Pond' });
  boatsFromSave(again, JSON.parse(JSON.stringify(kept)));
  assert.deepEqual([...again.boats.values()].map(b => [b.kind, b.x, b.y]), kept);
  assert.ok([...again.boats.values()].every(b => b.rider === -1 && b.passenger === -1 && b.hp === BOATS[b.kind].hp), 'empty, whole');
  // (Rubbish in a save is left out.)
  boatsFromSave(again, [['ship', 1, 2], ['raft', 'x', 3], null, ['raft', 10, 20]]);
  assert.equal(again.boats.size, 1);
  // To a file and back.
  const rec = await createWorld({ name: 'Boating', seed: 4242 });
  rec.boats = kept;
  await saveWorld(rec, []);
  const { text } = await exportWorld(rec.id);
  assert.deepEqual(JSON.parse(text).boats, kept);
  const back = await importWorld(text);
  assert.deepEqual((await getWorld(back.id)).boats, kept);
});

/** A host's world with the pond, and a player joined (worldnet.test.mjs's way). */
async function onlinePond() {
  const world = new TileWorld({ seed: 4242, name: 'Shared' });
  const at = carve(world);
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, effects: true, seed: 1, options: { destruction: true } });
  game.online = true;
  const hostInp = { move: 0 };
  const me = game.addSoldier({ name: 'Host', isBot: false }, { input: () => hostInp });
  const sync = new WorldHost(game, {});
  const host = new NetHost({
    maxPlayers: 8, botCount: 0, world: sync,
    matchInfo: () => ({ mode: 'world', mapName: world.name, speed: DEFAULT_SPEED, options: game.options, world: sync.info() }),
    addBot: () => {},
  });
  host.setGame(game);
  let now = 0;
  const queue = [];
  const schedule = (fn, ms) => queue.push({ fn, at: now + ms });
  const joinerCtl = { script: { move: 0 }, input() { const s = this.script; this.script = { ...s, firePressed: false, jumpPressed: false, alt: false, switchTo: null, cycle: 0 }; return s; } };
  const [h, c] = memoryLinks({ latency: 20, schedule });
  const client = new NetClient({ link: c, controller: joinerCtl, loadMap: async () => null, clock: () => now, world: new WorldClient({}) });
  host.addPlayer(h, 'Guest');
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
      client.tick();
      now += 1000 / 60;
      await pump();
      client.updateView(now);
    }
  };
  return { world, game, me, hostInp, client, joinerCtl, step, ...at };
}

test('online: everyone sees the boats; a player who joined gets in, rows on their own screen as the host has it, and gets out', async () => {
  const m = await onlinePond();
  await m.step(60);
  const guest = m.game.soldiers.find(s => s.remote), cme = m.client.me, cworld = m.client.game.world;
  assert.ok(guest && cme, 'joined');
  // The host puts a boat on the pond: the player sees it.
  const b = addBoat(m.world, 'rowboat', (m.p0 + 3) * TILE, m.top);
  await m.step(20);
  assert.equal(cworld.boats.size, 1, 'seen');
  const cb = cworld.boats.get(b.id);
  assert.equal(cb.kind, 'rowboat');
  assert.ok(Math.abs(cb.x - b.x) < 1 && Math.abs(cb.y - b.y) < 1, 'where it is');
  // The player walks to the shore and gets in (a right click on it).
  standAt(guest, m.p0 - 1, m.fy);
  await m.step(30);
  const aim = { aim: Math.atan2(b.y - guest.shoulderY, b.x - guest.shoulderX), aimDist: Math.hypot(b.x - guest.shoulderX, b.y - guest.shoulderY) };
  m.joinerCtl.script = { move: 0, ...aim, alt: true };
  await m.step(2);
  m.joinerCtl.script = { move: 0, ...aim };
  await m.step(20);
  assert.deepEqual(guest.body.boat, { id: b.id, kind: 'rowboat', seat: 0 }, 'in it, on the host');
  assert.deepEqual(cme.body.boat, { id: b.id, kind: 'rowboat', seat: 0 }, 'and on their screen');
  // Rowed east: on their own screen as on the host's.
  m.joinerCtl.script = { move: 1, ...aim };
  await m.step(120);
  assert.ok(b.x > (m.p0 + 12) * TILE, `rowed on the host (${b.x})`);
  assert.ok(Math.abs(cme.body.x - guest.body.x) < 40, `their screen keeps up (${cme.body.x.toFixed(1)} vs ${guest.body.x.toFixed(1)})`);
  m.joinerCtl.script = { move: 0, ...aim };
  await m.step(260);
  assert.ok(Math.abs(b.vx) < 0.01, 'coasted to a stop');
  assert.ok(Math.abs(cme.body.x - guest.body.x) < 2, `the same place, once stopped (${cme.body.x.toFixed(1)} vs ${guest.body.x.toFixed(1)})`);
  assert.ok(Math.abs(cme.body.y - guest.body.y) < 2);
  assert.ok(Math.abs(cworld.boats.get(b.id).x - b.x) < 3, 'the boat where the host has it');
  // The host gets in beside them: the player sees them sat in the other seat.
  assert.ok(board(m.game, m.me, b), 'the host in too');
  await m.step(10);
  const hostThere = m.client.game.soldiers.find(s => s.id === m.me.id);
  assert.deepEqual(hostThere.body.boat, { id: b.id, kind: 'rowboat', seat: 1 }, 'sat in it, as the player sees them');
  assert.equal(cworld.boats.get(b.id).passenger, m.me.id);
  // Out: a jump.
  m.joinerCtl.script = { move: 0, ...aim, jump: true, jumpPressed: true };
  await m.step(1);
  m.joinerCtl.script = { move: 0, ...aim };
  assert.equal(cme.body.boat, null, 'out on their screen at once');
  await m.step(30);
  assert.equal(guest.body.boat, null, 'and on the host');
  assert.equal(b.rider, -1);
  assert.equal(cme.body.boat, null, 'not put back in');
  assert.equal(cworld.boats.get(b.id).rider, -1);
  assert.equal(b.passenger, m.me.id, 'the host still in it');
  // Broken on the host: gone for everyone, and the host's out of it.
  breakBoat(m.game, b);
  await m.step(10);
  assert.equal(cworld.boats.size, 0, 'gone');
  assert.equal(m.me.body.boat, null);
  assert.equal(hostThere.body.boat, null, 'out of it, as the player sees them');
});
