// What's in hand, and using it (hands.js, useanim.js, stickman.js, held.js): every world thing is
// shown in hand as itself (a block as it looks in the world, an apple, a potion, a scroll), the
// right hand's thing in the other hand, and each use has its own motion: a pickaxe's swing, an
// axe's chop, a block pushed into place, food to the mouth, a potion tipped up, a scroll opened
// out, a reach for a chest, a knife's stab, a punch, a throw, a magazine out and in, a bow drawn.
// Online, what's in hand and what's being done with it go out with each soldier.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED, BODY } from '../web/src/config.js';
import { WEAPONS } from '../web/src/weapons.js';
import { buildPose } from '../web/src/stickman.js';
import { drawHeld } from '../web/src/held.js';
import { ACTS } from '../web/src/useanim.js';
import { TileWorld } from '../web/src/world/tileworld.js';
import * as K from '../web/src/world/blocks.js';
import { TILE, AIR } from '../web/src/world/blocks.js';
import { Inventory, ITEMS, itemOf } from '../web/src/world/items.js';
import { heldLook, lookOfKey } from '../web/src/world/hands.js';
import { setRightHand } from '../web/src/world/worldplay.js';
import { moveTo } from '../web/src/world/devmode.js';
import { folkOf, ROLES } from '../web/src/world/townsfolk.js';
import { encodeWorld, encodeSnapshot, decodeSnapshot } from '../web/src/net/protocol.js';
import '../web/src/world/worldrender.js';

const SEED = 777;
// (A grenade: the first thrown weapon.)
const NADE = Object.keys(WEAPONS).find(id => WEAPONS[id].kind === 'thrown');

/** A world, a player, and a little stage of their own away from any town: a stone floor, air over it. */
function stage() {
  const world = new TileWorld({ seed: SEED, name: 'Hands', gen: 6 });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const inp = { move: 0, aim: 0, aimDist: 40 };
  const me = game.addSoldier({ name: 'Hands', isBot: false }, { input: () => inp });
  for (let i = 0; i < 300 && !me.alive; i++) game.update();
  me.world.inv = new Inventory();
  me.spawnProtect = 0;
  const g = world.gen;
  let tx = g.edge(g.spawnRegion + 1) + 30;
  const free = x => { for (let d = -8; d <= 12; d++) if (g.townProtecting(x + d, world.surface(x + d) - 30)) return false; return true; };
  while (!free(tx)) tx++;
  const y0 = world.surface(tx) - 30;
  for (let x = tx - 8; x <= tx + 12; x++) {
    world.setTile(x, y0, K.STONE);
    for (let y = y0 - 8; y < y0; y++) world.setTile(x, y, AIR);
  }
  moveTo(me, tx * TILE + TILE / 2, y0 * TILE - BODY.bottom - 1);
  for (let i = 0; i < 20; i++) game.update();
  return { world, game, me, inp, tx, y0 };
}

/** Aim at tile (tx, ty)'s middle. */
function aimAt(me, inp, tx, ty) {
  const x = tx * TILE + TILE / 2, y = ty * TILE + TILE / 2;
  inp.aim = Math.atan2(y - me.shoulderY, x - me.shoulderX);
  inp.aimDist = Math.hypot(x - me.shoulderX, y - me.shoulderY);
}

/** Put n of `key` in hotbar slot i (and pick it). */
function give(me, key, n = 1, i = 0) {
  me.world.inv.slots[i] = { key, n };
  me.world.slot = i;
}

/** One click of the left (or right: alt) button. */
function click(game, inp, alt = false) {
  if (alt) { inp.alt = true; game.update(); inp.alt = false; }
  else { inp.fire = true; inp.firePressed = true; game.update(); inp.fire = false; inp.firePressed = false; }
}

test('everything a world has shows in hand: tools as tools, a torch with its flame, the rest as themselves', () => {
  for (const it of ITEMS.values()) {
    const l = heldLook(it);
    if (it.kind === 'weapon') { assert.equal(l, WEAPONS[it.weapon], it.key); continue; }
    assert.ok(l?.look, `${it.key}: a look`);
    if (it.kind === 'tool' && ['pick', 'axe', 'hammer'].includes(it.tool)) assert.ok(['pickaxe', 'axe', 'mallet'].includes(l.look.type), it.key);
    else if (it.key === 'torch') assert.equal(l.look.type, 'torch');
    else assert.equal(l.item, it, `${it.key}: held as itself`);
    assert.equal(heldLook(it), l, 'the same look each time');
  }
  assert.equal(lookOfKey(null), null);
  assert.equal(lookOfKey('no such thing'), null);
});

test('using things: a pickaxe swings, an axe chops, a hammer taps, a block is pushed into place', () => {
  const { world, game, me, inp, tx, y0 } = stage();
  give(me, 'pickaxe');
  aimAt(me, inp, tx + 1, y0);
  click(game, inp);
  assert.equal(me.anim.act, 'mine');
  assert.equal(me.held.look.type, 'pickaxe');
  for (let i = 0; i < 40; i++) game.update();
  assert.equal(me.anim.act, '', 'over, once the swing is');
  world.setTile(tx + 2, y0 - 1, K.PLANKS);
  give(me, 'axe');
  aimAt(me, inp, tx + 2, y0 - 1);
  click(game, inp);
  assert.equal(me.anim.act, 'chop');
  for (let i = 0; i < 40; i++) game.update();
  give(me, 'hammer');
  click(game, inp);
  assert.equal(me.anim.act, 'hammer');
  world.setTile(tx + 2, y0 - 1, AIR);
  give(me, 'stone_bricks', 5);
  for (let i = 0; i < 30; i++) game.update();
  click(game, inp);
  assert.equal(world.tile(tx + 2, y0 - 1), K.STONE_BRICKS, 'built');
  assert.equal(me.anim.act, 'place');
});

test('eating and drinking: to the mouth, and what\'s eaten stays in hand till it\'s gone, the last one too', () => {
  const { game, me, inp, tx, y0 } = stage();
  aimAt(me, inp, tx + 3, y0 - 2);
  me.health = 40;
  give(me, 'apple', 1);
  click(game, inp);
  assert.equal(me.anim.act, 'eat');
  assert.equal(me.world.inv.count('apple'), 0, 'eaten');
  game.update();
  assert.equal(me.held?.item?.key, 'apple', 'still in hand, being eaten');
  assert.deepEqual(me.hands, ['apple', null]);
  for (let i = 0; i < 80; i++) game.update();
  assert.equal(me.anim.act, '');
  assert.equal(me.held, null, 'gone');
  me.health = 40;
  give(me, 'healing_potion', 2);
  click(game, inp);
  assert.equal(me.anim.act, 'drink');
});

test('a scroll\'s opened out and read (moving stops it); a contract\'s shown; a chest is reached for; a plant\'s punched', () => {
  const { world, game, me, inp, tx, y0 } = stage();
  aimAt(me, inp, tx + 3, y0 - 2);
  give(me, 'recall_scroll', 1);
  click(game, inp);
  assert.equal(me.anim.act, 'read');
  for (let i = 0; i < 20; i++) game.update();
  assert.equal(me.anim.act, 'read', 'still reading');
  inp.move = 1;
  for (let i = 0; i < 40; i++) game.update();
  inp.move = 0;
  assert.equal(me.anim.act, '', 'moved: its magic fades');
  for (let i = 0; i < 30; i++) game.update();
  give(me, 'merc_contract', 1);
  click(game, inp);
  assert.equal(me.anim.act, 'show');
  for (let i = 0; i < 60; i++) game.update();
  const cx = Math.floor(me.x / TILE) + 2;
  world.setTile(cx, y0 - 1, K.CHEST);
  give(me, 'stone_bricks', 1);
  aimAt(me, inp, cx, y0 - 1);
  click(game, inp, true);
  assert.ok(me.world.openChest, 'opened');
  assert.equal(me.anim.act, 'reach');
  for (let i = 0; i < 30; i++) game.update();
  world.setTile(cx, y0 - 1, K.TALL_GRASS);
  me.world.inv.slots[0] = null;
  click(game, inp);
  assert.equal(world.tile(cx, y0 - 1), AIR, 'picked');
  assert.equal(me.anim.act, 'punch');
});

test('the other hand: what right click uses is held in it, and in front while it\'s used', () => {
  const { game, me, inp, tx, y0 } = stage();
  give(me, 'pickaxe', 1, 0);
  me.world.inv.slots[1] = { key: 'torch', n: 10 };
  setRightHand(game, me, '1', true);
  aimAt(me, inp, tx + 4, y0 - 3);
  game.update();
  assert.equal(me.held.look.type, 'pickaxe');
  assert.equal(me.held2.look.type, 'torch');
  assert.deepEqual(me.hands, ['pickaxe', 'torch']);
  const pose = buildPose(me);
  assert.equal(pose.off.def, me.held2, 'drawn in the other hand');
  assert.ok(pose.lines[6][3] > pose.shoulder[1] + 6, 'down at the side');
  // (Used: in front, the pickaxe in the other hand.)
  inp.alt = true;
  game.update();
  game.update();
  assert.equal(me.held.look.type, 'torch');
  assert.equal(me.held2.look.type, 'pickaxe');
  inp.alt = false;
  game.update();
  // A two-handed thing (the axe) leaves no hand free.
  give(me, 'axe', 1, 0);
  game.update();
  assert.equal(buildPose(me).off.def, null);
});

/** A soldier, posed for drawing (not in a game): `over` sets what's in hand and what's being done. */
function figure(over = {}) {
  return {
    facing: 1, aim: 0, current: 'Hands', held: null, held2: null,
    body: { onGround: true, vx: 0, vy: 0 }, anim: { run: 0, idle: 0, land: 0, flip: 0, recoil: 0, act: '', use: 0 }, ...over,
  };
}
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

test('the motions: a swing lifts and brings it down, food goes to the mouth, a scroll\'s held open, a magazine comes out', () => {
  // A pickaxe's swing: lifted over the shoulder part way, at the mark at the start and end.
  const pick = heldLook(itemOf('pickaxe'));
  const swing = figure({ held: pick });
  const rest = { ...buildPose(swing).gun };
  const restHand = buildPose(swing).lines[8].slice();
  Object.assign(swing.anim, { act: 'mine', use: 0.6 });
  let p = buildPose(swing);
  assert.ok(p.gun.angle < -1.5, `lifted (${p.gun.angle.toFixed(2)})`);
  assert.ok(p.lines[8][3] < restHand[3] - 4, 'the arm lifts it');
  swing.anim.use = 0.99;
  assert.ok(Math.abs(buildPose(swing).gun.angle - rest.angle) < 0.15, 'brought down again');
  // An apple: to the mouth and back, with crumbs; a potion tipped up.
  const apple = figure({ held: heldLook(itemOf('apple')) });
  p = buildPose(apple);
  const away = dist(p.gun.x, p.gun.y, p.head.x, p.head.y);
  Object.assign(apple.anim, { act: 'eat', use: 0.5 });
  p = buildPose(apple);
  assert.ok(dist(p.gun.x, p.gun.y, p.head.x, p.head.y) < 6 && away > 9, 'at the mouth');
  assert.equal(p.fx.kind, 'crumbs');
  assert.ok(p.gun.scale < 1, 'bitten');
  apple.held = heldLook(itemOf('healing_potion'));
  apple.anim.act = 'drink';
  p = buildPose(apple);
  assert.ok(p.gun.angle < -1.8, 'tipped up');
  // A scroll: held open in front, a hand at each end.
  const scroll = figure({ held: heldLook(itemOf('recall_scroll')), anim: { run: 0, idle: 0, land: 0, flip: 0, recoil: 0, act: 'read', use: 0.5 } });
  p = buildPose(scroll);
  assert.equal(p.fx.kind, 'scroll');
  assert.ok(p.gun.hidden, 'the rolled one, put away');
  assert.ok(dist(p.lines[8][2], p.lines[8][3], p.fx.x - 2.6, p.fx.y + 4.6) < 1.5, 'one hand at the bottom');
  assert.ok(dist(p.lines[6][2], p.lines[6][3], p.fx.x - 2.6, p.fx.y - 4.6) < 1.5, 'the other at the top');
  // A rifle's reload: the magazine out, the hand down with it.
  const gun = figure({ current: 'M4' });
  const hand = buildPose(gun).lines[8][3];
  Object.assign(gun.anim, { act: 'reload', use: 0.33 });
  p = buildPose(gun);
  assert.equal(p.fx.kind, 'mag');
  assert.ok(p.lines[8][3] > hand + 3, 'down to the magazine');
  // A throw: it's gone from the hand at first, then the next is there.
  const nade = figure({ current: NADE, anim: { run: 0, idle: 0, land: 0, flip: 0, recoil: 0, act: 'throw', use: 0.2 } });
  assert.ok(buildPose(nade).gun.hidden);
  nade.anim.use = 0.8;
  assert.ok(!buildPose(nade).gun.hidden);
  // A knife's stab: pushed out.
  const knife = Object.keys(WEAPONS).find(id => WEAPONS[id].look.type === 'knife');
  const stab = figure({ current: knife });
  const x0 = buildPose(stab).gun.x;
  Object.assign(stab.anim, { act: 'stab', use: 0.2 });
  assert.ok(buildPose(stab).gun.x > x0 + 3, 'stabbed out');
  // A bow: drawn back to the cheek, let go as it's loosed.
  const bow = figure({ current: 'Longbow' });
  p = buildPose(bow);
  assert.equal(p.gun.pull, 1);
  assert.ok(dist(p.lines[6][2], p.lines[6][3], p.shoulder[0], p.shoulder[1]) < 3.5, 'drawn to the cheek');
  bow.anim.recoil = 1.5;
  assert.equal(buildPose(bow).gun.pull, 0, 'loosed');
});

test('fighting: a knife stabs, fists punch, a sledgehammer swings, a grenade\'s thrown', () => {
  const map = { name: 'arena', bounds: { left: -400, top: -300, right: 400, bottom: 200 }, spawns: [{ x: -300, y: -12, team: 1 }], items: [], platforms: [{ left: -400, top: 0, right: 400, bottom: 40 }] };
  const game = new Game({ mapData: map, effects: false, seed: 3, speed: DEFAULT_SPEED, mode: 'ffa', options: {} });
  const inp = { move: 0, aim: 0, aimDist: 100 };
  const s = game.addSoldier({ name: 'A', isBot: true }, { input: () => inp });
  s.spawnAt({ x: 0, y: -12 }, 0);
  const knife = Object.keys(WEAPONS).find(id => WEAPONS[id].look.type === 'knife');
  const use = (id, want) => {
    for (let i = 0; i < 60; i++) game.update();
    s.weapons[id] = { ammo: id === NADE ? 3 : Infinity };
    s.current = id;
    s.cooldown = 0;
    inp.fire = inp.firePressed = true;
    game.update();
    inp.fire = inp.firePressed = false;
    assert.equal(s.anim.act, want, id);
  };
  use(knife, 'stab');
  use('Hands', 'punch');
  use('Sledgehammer', 'smash');
  use(NADE, 'throw');
});

test('a gun\'s reload: the magazine out and a fresh one in, along with the reload', () => {
  const { game, me, inp } = stage();
  // (The pistol: a gun with a magazine.)
  give(me, 'Platinum', 1, 0);
  me.world.inv.slots[1] = { key: 'bullets', n: 200 };
  game.update();
  inp.reload = true;
  game.update();
  inp.reload = false;
  assert.equal(me.anim.act, 'reload');
  const u0 = me.anim.use;
  for (let i = 0; i < 10; i++) game.update();
  assert.ok(me.anim.use > u0, 'along with the reload');
  for (let i = 0; i < 600 && me.reloadTimer > 0; i++) game.update();
  game.update();
  assert.equal(me.anim.act, '', 'done');
});

test('online: what\'s in hand and what\'s being done with it go out with each soldier', () => {
  const { game, me, inp, tx, y0 } = stage();
  give(me, 'pickaxe', 1, 0);
  me.world.inv.slots[1] = { key: 'torch', n: 4 };
  setRightHand(game, me, '1', true);
  aimAt(me, inp, tx + 1, y0);
  click(game, inp);
  const snap = decodeSnapshot(encodeSnapshot(game, me, 1, encodeWorld(game)));
  const got = snap.soldiers.find(o => o.id === me.id);
  assert.deepEqual(got.hands, ['pickaxe', 'torch']);
  assert.equal(got.anim.act, 'mine');
  assert.ok(Math.abs(got.anim.use - me.anim.use) < 0.01);
  for (const a of ACTS) assert.ok(a === '' || ['mine', 'chop', 'hammer', 'place', 'eat', 'drink', 'read', 'throw', 'stab', 'punch', 'smash', 'reload', 'reach', 'show'].includes(a));
});

test('townsfolk have their work in hand: the smith a hammer (and hammers away), the healer a potion', () => {
  const world = new TileWorld({ seed: SEED, gen: 6 }), g = world.gen;
  let smith = null;
  for (let k = g.spawnRegion - 20; k <= g.spawnRegion + 20 && !smith; k++) {
    const t = g.townIn(k);
    if (t) smith = folkOf(g.seed, t).find(f => f.role === 'smith') && t;
  }
  assert.ok(smith, 'a town with a smith');
  assert.equal(ROLES.smith.held, 'hammer');
  assert.equal(lookOfKey(ROLES.smith.held).look.type, 'mallet');
  assert.equal(lookOfKey(ROLES.healer.held).item.key, 'healing_potion');
});

test('drawing what\'s in hand: every thing, every act, both looks, without a slip', () => {
  const calls = { n: 0 };
  const ctx = new Proxy({ globalAlpha: 1 }, {
    get(o, k) { if (k in o) return o[k]; return (..._a) => { calls.n++; return { addColorStop() {} }; }; },
    set(o, k, v) { o[k] = v; return true; },
  });
  const items = [...ITEMS.values()];
  let i = 0;
  for (const act of ACTS) {
    for (const classic of [true, false]) {
      for (let j = 0; j < 12; j++, i++) {
        const it = items[i % items.length];
        const s = figure({ held: heldLook(it), held2: heldLook(itemOf('torch')), current: it.kind === 'weapon' ? it.weapon : 'Hands' });
        if (it.kind === 'weapon') s.held = null;
        s.anim.act = act;
        s.anim.use = (j + 0.5) / 12;
        drawHeld(ctx, buildPose(s), i, classic);
      }
    }
  }
  assert.ok(calls.n > 1000, 'drawn');
});
