// Bases (web/src/world/bases.js): a base flag claims the blocks round it for its owner and their
// party; it's safe from everyone else unless the world lets bases be raided (PvP on, and its
// raiding setting: while their owners are on, at night, any time, or never). Open to a raid, its
// walls dig slowly (reinforced bricks and iron doors only to siege tools), its flag can be hit,
// blasts break its blocks; once the flag falls, anyone can take what's in it till it's mended.
// Defences only in your own base: turrets (shooting monsters, and with PvP on, other players who
// come in), spikes, pressure mines, iron doors, an alarm bell. Siege charges and a battering ram.
// The dead come for a base at night. Bases are kept in saves, and sent to everyone online.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED, BODY } from '../web/src/config.js';
import { TileWorld, TILE } from '../web/src/world/tileworld.js';
import * as K from '../web/src/world/blocks.js';
import { AIR } from '../web/src/world/blocks.js';
import { Inventory, itemOf } from '../web/src/world/items.js';
import { claimAt, mayChange, claimsToSave, claimsFromSave, chestAt, breakBlock } from '../web/src/world/worldplay.js';
import { hitCore, onSide, digShare, levelOf, radiusOf, maxHpOf, startBaseRaid, siegeBlocked, BASE_LEVELS, CLAIM_R } from '../web/src/world/bases.js';
import { spawnMonster, DAY_TICKS } from '../web/src/world/monsters.js';
import { pushDoor } from '../web/src/world/doors.js';
import { damage, canHurt } from '../web/src/combat.js';
import { WORLD_SETTINGS, cleanSettings, settingsSummary } from '../web/src/world/worldrules.js';
import { RECIPES } from '../web/src/world/crafting.js';
import { codexEntries } from '../web/src/world/codex.js';
import { NetHost } from '../web/src/net/host.js';
import { NetClient } from '../web/src/net/client.js';
import { memoryLinks } from '../web/src/net/peer.js';
import { WorldHost, WorldClient } from '../web/src/world/worldnet.js';

const Y = 40;                     // the floor's row
const FX = 2, FY = Y - 1;         // where the owner's flag goes

/** A world with a flat stone floor at row Y, open above, no towns, no monsters by themselves; an owner at x 0 and a raider at x 6. */
function playOn({ pvp = true, raiding = 'anytime', baseRaids = 'off', width = 70 } = {}) {
  const world = new TileWorld({ seed: 4242, name: 'Bases', noTowns: true });
  world.pvp = pvp;
  world.settings = cleanSettings({ raiding, baseRaids, hunger: 'off' });
  world.devQuiet = true;
  for (let x = -width; x <= width; x++) for (let y = Y - 16; y <= Y + 3; y++) { world.setTile(x, y, y >= Y ? K.STONE : AIR); world.setWall(x, y, K.NO_WALL); }
  world.flowing?.clear();
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const add = (name, tx) => {
    const ctl = { script: { move: 0 }, input() { return this.script; } };
    const s = game.addSoldier({ name, isBot: false }, ctl);
    for (let i = 0; i < 300 && !s.alive; i++) game.update();
    put(s, tx);
    s.spawnProtect = 0;
    s.world.inv = new Inventory();
    return { s, ctl };
  };
  const o = add('Owner', 0), r = add('Raider', 6);
  return { world, game, owner: o.s, oc: o.ctl, raider: r.s, rc: r.ctl, add };
}
const put = (s, tx, ty = Y) => { s.body.x = tx * TILE + 8; s.body.y = ty * TILE - BODY.bottom - 0.5; s.body.vx = s.body.vy = 0; };
const run = (game, n) => { for (let i = 0; i < n; i++) game.update(); };
const give = (s, key, n = 1) => { s.world.inv.slots[0] = { key, n }; s.world.slot = 0; s.world.inv.version++; };
const aimAt = (s, tx, ty) => { const x = tx * TILE + 8, y = ty * TILE + 8; return { aim: Math.atan2(y - s.shoulderY, x - s.shoulderX), aimDist: Math.hypot(x - s.shoulderX, y - s.shoulderY) }; };
/** A click (the use button, down and up) at (tx, ty). */
const click = (game, s, ctl, tx, ty) => { ctl.script = { move: 0, fire: true, firePressed: true, ...aimAt(s, tx, ty) }; game.update(); ctl.script = { move: 0, ...aimAt(s, tx, ty) }; run(game, 8); };
/** The use button held at (tx, ty) for n updates. */
const hold = (game, s, ctl, tx, ty, n) => { for (let i = 0; i < n; i++) { ctl.script = { move: 0, fire: true, firePressed: i === 0, ...aimAt(s, tx, ty) }; game.update(); } ctl.script = { move: 0 }; game.update(); };
/** A right click at (tx, ty), with nothing in hand. */
const rightClick = (game, s, ctl, tx, ty) => { s.world.inv.slots[0] = null; s.world.inv.version++; ctl.script = { move: 0, alt: true, ...aimAt(s, tx, ty) }; game.update(); ctl.script = { move: 0, ...aimAt(s, tx, ty) }; run(game, 2); };
const toldTo = (game, s, re) => game.notes.some(n => n.to === s.id && re.test(n.text));
/** The owner's flag put up at (FX, FY), the way a player does: their base. */
function baseUp(m) {
  give(m.owner, 'claim_flag');
  click(m.game, m.owner, m.oc, FX, FY);
  const c = claimAt(m.world, FX + 5, FY);
  assert.ok(c && c.owner === 'Owner' && m.world.tile(FX, FY) === K.CLAIM_FLAG, 'the base is up');
  run(m.game, 31); // (whether it's open to a raid: worked out every half second)
  return c;
}

test('a base: safe from others where it can\'t be raided, its owner\'s and their party\'s to change; nothing outside it', () => {
  const m = playOn({ raiding: 'off' });
  const c = baseUp(m);
  assert.equal(levelOf(c), 1);
  assert.equal(radiusOf(c), CLAIM_R);
  assert.equal(c.hp, maxHpOf(c));
  assert.ok(mayChange(m.world, m.owner, FX + 5, FY), 'its owner\'s');
  assert.ok(!mayChange(m.world, m.raider, FX + 5, FY), 'not someone else\'s');
  assert.ok(mayChange(m.world, m.raider, FX + CLAIM_R + 1, FY), 'outside it, anyone\'s');
  assert.ok(!c.open, 'raiding off: never open');
  // Their party counts as owners.
  const friend = m.add('Friend', 4).s;
  assert.ok(!mayChange(m.world, friend, FX + 5, FY));
  m.world.parties = new Map([['p1', { id: 'p1', members: ['Owner', 'Friend'] }]]);
  assert.ok(mayChange(m.world, friend, FX + 5, FY) && onSide(m.world, c, 'friend'), 'a party member\'s too');
  // Someone else digging: nothing happens.
  m.world.setTile(5, FY, K.PLANKS);
  give(m.raider, 'diamond_pickaxe');
  hold(m.game, m.raider, m.rc, 5, FY, 120);
  assert.equal(m.world.tile(5, FY), K.PLANKS, 'not dug');
  assert.ok(toldTo(m.game, m.raider, /Owner's base/), 'and told whose it is');
  // Nor building, nor a blast.
  give(m.raider, 'planks', 10);
  click(m.game, m.raider, m.rc, 7, FY);
  assert.equal(m.world.tile(7, FY), AIR, 'not built');
  m.world.carve(5 * TILE + 8, FY * TILE + 8, 40);
  assert.equal(m.world.tile(5, FY), K.PLANKS, 'blast-proof');
  // Another flag too near it: no.
  give(m.raider, 'claim_flag');
  put(m.raider, FX + 2 * CLAIM_R - 2);
  run(m.game, 2);
  click(m.game, m.raider, m.rc, FX + 2 * CLAIM_R, FY);
  assert.equal(m.world.tile(FX + 2 * CLAIM_R, FY), AIR, 'too near');
});

test('raiding, by the world\'s setting: never with PvP off; while its owners are on; at night; any time', () => {
  const check = (opts, then = () => {}) => { const m = playOn(opts); const c = baseUp(m); then(m, c); run(m.game, 31); return { m, c }; };
  assert.ok(!check({ pvp: false, raiding: 'anytime' }).c.open, 'PvP off: bases are always safe');
  assert.ok(!check({ pvp: true, raiding: 'off' }).c.open, 'raiding off');
  assert.ok(check({ raiding: 'anytime' }).c.open, 'any time');
  const on = check({ raiding: 'online' });
  assert.ok(on.c.open, 'its owner\'s on: open');
  on.m.game.removeSoldier(on.m.owner);
  run(on.m.game, 31);
  assert.ok(!on.c.open, 'its owner gone: safe');
  const night = check({ raiding: 'night' });
  assert.ok(!night.c.open, 'day: safe');
  night.m.world.time = DAY_TICKS * 16 / 24; // (ten at night)
  run(night.m.game, 31);
  assert.ok(night.c.open, 'night: open');
  // PvE: nothing gets in, whatever happens to its flag.
  const pve = playOn({ pvp: false, raiding: 'anytime' });
  const c = baseUp(pve);
  hitCore(pve.game, c, 99999, null);
  assert.ok(c.down && pve.world.tile(FX, FY) === K.FLAG_DOWN, 'its flag can fall (to monsters)');
  assert.ok(!mayChange(pve.world, pve.raider, FX + 5, FY), 'but it\'s still nobody else\'s');
  assert.match(siegeBlocked(pve.world, pve.raider, FX + 5, FY), /PvP is off/);
});

test('a base open to a raid: its walls dig slowly, reinforced bricks and chests not at all, its flag can be hit; blasts break its blocks (not its flag or chests)', () => {
  const m = playOn({ raiding: 'anytime' });
  const c = baseUp(m);
  assert.ok(c.open);
  assert.equal(digShare(m.world, m.raider, 5, FY, K.PLANKS), 1 / 3, 'built: a third');
  assert.equal(digShare(m.world, m.raider, 5, Y, K.STONE), 1, 'the land: as anywhere');
  assert.equal(digShare(m.world, m.raider, 5, FY, K.REINFORCED), 0, 'reinforced: no');
  assert.equal(digShare(m.world, m.raider, 5, FY, K.CHEST), 0, 'a chest: locked');
  assert.equal(digShare(m.world, m.raider, 5, FY, K.CABINET), 0, 'a cabinet: locked like a chest');
  assert.equal(digShare(m.world, m.owner, 5, FY, K.REINFORCED), 1, 'its owner: as they please');
  // Digging a wall: slower than outside a base, but it goes.
  m.world.setTile(5, FY, K.STONE_BRICKS);
  give(m.raider, 'pickaxe');
  hold(m.game, m.raider, m.rc, 5, FY, 14);
  assert.ok(Math.abs(m.raider.world.mine.dmg - 1 / 3) < 1e-6, `a third of a hit (${m.raider.world.mine.dmg})`);
  hold(m.game, m.raider, m.rc, 5, FY, 600);
  assert.equal(m.world.tile(5, FY), AIR, 'broken through');
  // Reinforced bricks: not with a pickaxe.
  m.world.setTile(5, FY, K.REINFORCED);
  give(m.raider, 'diamond_pickaxe');
  hold(m.game, m.raider, m.rc, 5, FY, 200);
  assert.equal(m.world.tile(5, FY), K.REINFORCED, 'reinforced holds');
  // Its flag, hit with a pickaxe: its health goes down.
  const hp = c.hp;
  give(m.raider, 'pickaxe');
  put(m.raider, FX + 3);
  run(m.game, 2);
  hold(m.game, m.raider, m.rc, FX, FY, 40);
  assert.ok(c.hp < hp && c.hp > 0, `its flag hit (${hp} -> ${c.hp})`);
  assert.equal(m.world.tile(FX, FY), K.CLAIM_FLAG, 'not dug up');
  // Its chests stay shut.
  m.world.setTile(FX + 1, FY, K.CHEST);
  chestAt(m.world, FX + 1, FY).add('gold_bar', 5);
  m.raider.world.toldClaim = -1e9;
  rightClick(m.game, m.raider, m.rc, FX + 1, FY);
  assert.ok(toldTo(m.game, m.raider, /locked/), 'locked till its flag falls');
  // Blasts: its blocks break, not its flag or chests; reinforced bricks hold.
  m.world.setTile(-4, FY, K.PLANKS);
  m.world.setTile(-6, FY, K.REINFORCED);
  m.world.carve(-5 * TILE + 8, FY * TILE + 8, 40);
  assert.equal(m.world.tile(-4, FY), AIR, 'planks blown away');
  assert.equal(m.world.tile(-6, FY), K.REINFORCED, 'reinforced bricks hold');
  m.world.carve(FX * TILE + 8, FY * TILE + 8, 40);
  assert.equal(m.world.tile(FX, FY), K.CLAIM_FLAG, 'its flag stays');
  assert.equal(m.world.tile(FX + 1, FY), K.CHEST, 'its chest stays');
});

test('its flag brought down: the base is anyone\'s (its chests too); mended with a builder\'s hammer, it\'s raised again', () => {
  const m = playOn({ raiding: 'anytime' });
  const c = baseUp(m);
  m.world.setTile(FX + 1, FY, K.CHEST);
  chestAt(m.world, FX + 1, FY).add('gold_bar', 5);
  hitCore(m.game, c, c.hp + 10, m.raider);
  assert.ok(c.down && c.hp === 0 && !c.open, 'fallen');
  assert.equal(m.world.tile(FX, FY), K.FLAG_DOWN, 'its flag, down');
  assert.ok(toldTo(m.game, m.owner, /Your base has fallen/), 'its owner told');
  assert.ok(toldTo(m.game, m.raider, /You brought down Owner's base/), 'and whoever did it');
  assert.ok(mayChange(m.world, m.raider, FX + 5, FY), 'anyone can change it now');
  rightClick(m.game, m.raider, m.rc, FX + 1, FY);
  assert.ok(m.raider.world.openChest || m.game.notes.every(n => !/locked/.test(n.text)), 'its chest opens');
  // Its owner mends it: not while it's under attack; then a stone a hit, raised at a quarter.
  give(m.owner, 'hammer');
  m.owner.world.inv.slots[1] = { key: 'stone', n: 99 };
  hold(m.game, m.owner, m.oc, FX, FY, 30);
  assert.equal(c.hp, 0, 'no time to mend it (just attacked)');
  m.world.time += 60 * 20;
  hold(m.game, m.owner, m.oc, FX, FY, 12 * 4 + 2);
  assert.ok(c.hp > 0 && c.down, `mending (${c.hp})`);
  assert.ok(m.owner.world.inv.count('stone') < 99, 'using up stone');
  hold(m.game, m.owner, m.oc, FX, FY, 12 * 12);
  assert.ok(!c.down && c.hp >= maxHpOf(c) * 0.25, `raised again (${c.hp})`);
  assert.equal(m.world.tile(FX, FY), K.CLAIM_FLAG);
  assert.ok(!mayChange(m.world, m.raider, FX + 5, FY), 'theirs again');
});

test('a stronghold charter raises a base a level: a wider claim, a tougher flag (not where it would take in another base)', () => {
  const m = playOn({ raiding: 'off' });
  const c = baseUp(m);
  give(m.owner, 'charter', 3);
  click(m.game, m.owner, m.oc, FX, FY);
  assert.equal(levelOf(c), 2);
  assert.equal(radiusOf(c), BASE_LEVELS[2].r);
  assert.equal(c.hp, BASE_LEVELS[2].hp);
  assert.equal(claimAt(m.world, FX + BASE_LEVELS[2].r, FY), c, 'it claims further');
  // Another base just beyond its next reach: it can't grow over it.
  m.world.claims.set('200,39', { tx: FX + BASE_LEVELS[3].r + CLAIM_R - 2, ty: FY, owner: 'Neighbour', level: 1, hp: 1000 });
  click(m.game, m.owner, m.oc, FX, FY);
  assert.equal(levelOf(c), 2, 'too near its neighbour');
  assert.ok(toldTo(m.game, m.owner, /Too near Neighbour's base/));
  m.world.claims.delete('200,39');
  m.owner.world.toldClaim = -1e9;
  click(m.game, m.owner, m.oc, FX, FY);
  assert.equal(levelOf(c), 3);
  m.owner.world.toldClaim = -1e9;
  click(m.game, m.owner, m.oc, FX, FY);
  assert.equal(levelOf(c), 3, 'as strong as a base gets');
  assert.equal(m.owner.world.inv.count('charter'), 1, 'two used');
});

test('turrets: only in your own base; loaded by hand or from a chest beside them; they shoot monsters and (PvP) intruders, never their own side', () => {
  const m = playOn({ raiding: 'off' });
  baseUp(m);
  // Outside a base: no.
  give(m.raider, 'gun_turret');
  put(m.raider, 60);
  run(m.game, 2);
  click(m.game, m.raider, m.rc, 62, FY);
  assert.equal(m.world.tile(62, FY), AIR, 'not outside your base');
  put(m.raider, 40);
  // In it: loaded.
  give(m.owner, 'gun_turret');
  click(m.game, m.owner, m.oc, -2, FY);
  assert.equal(m.world.tile(-2, FY), K.GUN_TURRET);
  const t = m.world.turrets.get(`-2,${FY}`);
  assert.ok(t && t.ammo === 0, 'empty');
  give(m.owner, 'bullets', 100);
  click(m.game, m.owner, m.oc, -2, FY);
  assert.equal(t.ammo, 100, 'loaded');
  assert.equal(m.owner.world.inv.count('bullets'), 0);
  // Friends about, nothing to shoot: it doesn't.
  const friend = m.add('Friend', -6).s;
  m.world.parties = new Map([['p1', { id: 'p1', members: ['Owner', 'Friend'] }]]);
  run(m.game, 60);
  assert.equal(t.ammo, 100, 'no shots at its own side');
  // A zombie comes: shot.
  const z = spawnMonster(m.game, 'zombie', -14 * TILE + 8, Y * TILE - BODY.bottom - 1);
  run(m.game, 2);
  const zh = z.health;
  run(m.game, 90);
  assert.ok(t.ammo < 100, `it fired (${100 - t.ammo} rounds)`);
  assert.ok(!z.alive || z.health < zh, 'the zombie shot');
  assert.ok(friend.lastHurtBy?.npc?.kind !== 'turret', 'the friend not');
  // An intruder (PvP on): shot, once in the base; not outside it.
  m.game.removeSoldier(z);
  run(m.game, 20);
  put(m.raider, -14);
  const rh = m.raider.health, before = t.ammo;
  run(m.game, 60);
  assert.ok(t.ammo < before && m.raider.health < rh, 'an intruder shot');
  // (The turret's shots can't hurt its own side.)
  const shot = m.game.projectiles.find(p => p.owner?.npc?.kind === 'turret');
  if (shot) assert.ok(!canHurt(m.game, shot.owner, friend) && canHurt(m.game, shot.owner, m.raider));
  m.raider.health = m.raider.maxHealth;
  put(m.raider, FX + CLAIM_R + 6);
  run(m.game, 30);
  const out = t.ammo;
  run(m.game, 60);
  assert.equal(t.ammo, out, 'not outside the base');
  // PvP off: players never.
  m.world.pvp = false;
  put(m.raider, -14);
  run(m.game, 60);
  assert.equal(t.ammo, out, 'PvP off: never at players');
  // Empty: it takes what it shoots from a chest beside it.
  m.world.pvp = true;
  t.ammo = 0;
  m.world.setTile(-3, FY, K.CHEST);
  chestAt(m.world, -3, FY).add('bullets', 50);
  run(m.game, 20);
  assert.ok(t.ammo > 0 && chestAt(m.world, -3, FY).count('bullets') < 50, `restocked (${t.ammo})`);
  // An arrow turret: arrows.
  put(m.raider, 60);
  give(m.owner, 'arrow_turret');
  click(m.game, m.owner, m.oc, 3, FY);
  give(m.owner, 'bullets', 10);
  click(m.game, m.owner, m.oc, 3, FY);
  assert.equal(m.world.turrets.get(`3,${FY}`).ammo, 0, 'not bullets');
  give(m.owner, 'arrows', 30);
  click(m.game, m.owner, m.oc, 3, FY);
  assert.equal(m.world.turrets.get(`3,${FY}`).ammo, 30, 'arrows');
  // Broken: what's left in it drops.
  const left = t.ammo;
  assert.ok(left > 0);
  put(m.owner, 30);
  breakBlock(m.game, -2, FY, m.owner);
  assert.ok(!m.world.turrets.has(`-2,${FY}`), 'gone');
  assert.ok(m.world.drops.some(d => d.key === 'bullets' && d.n === left), 'its bullets dropped');
});

test('traps: spikes hurt and slow whoever walks through them, a pressure mine blows up under them; never the base\'s own side', () => {
  const m = playOn({ raiding: 'off' });
  baseUp(m);
  give(m.owner, 'spikes', 4);
  click(m.game, m.owner, m.oc, -3, FY);
  give(m.owner, 'pressure_mine', 2);
  click(m.game, m.owner, m.oc, 4, FY);
  assert.equal(m.world.tile(-3, FY), K.SPIKES);
  assert.equal(m.world.tile(4, FY), K.PRESSURE_MINE);
  // Its owner walks over them: nothing.
  put(m.owner, -3);
  run(m.game, 40);
  put(m.owner, 4);
  run(m.game, 20);
  assert.equal(m.owner.health, m.owner.maxHealth, 'its owner: unhurt');
  assert.equal(m.world.tile(4, FY), K.PRESSURE_MINE, 'the mine: still there');
  put(m.owner, 0);
  // A zombie in the spikes: hurt.
  const z = spawnMonster(m.game, 'zombie', -3 * TILE + 8, Y * TILE - BODY.bottom - 1);
  run(m.game, 2);
  put(z, -3);
  z.spawnProtect = 0;
  const zh = z.health;
  run(m.game, 30);
  assert.ok(z.health < zh, `spiked (${zh} -> ${z.health})`);
  m.game.removeSoldier(z);
  // An intruder on the mine: it goes off (breaking no blocks).
  m.world.setTile(6, FY, K.PLANKS);
  put(m.raider, 4);
  const rh = m.raider.health;
  run(m.game, 8);
  assert.equal(m.world.tile(4, FY), AIR, 'the mine went off');
  assert.ok(m.raider.health < rh, 'the intruder hurt');
  assert.equal(m.world.tile(6, FY), K.PLANKS, 'no blocks broken');
});

test('iron doors: in a base, only its side opens them (walking into them, or a right click); a fallen base\'s open for anyone', () => {
  const m = playOn({ raiding: 'anytime' });
  const c = baseUp(m);
  give(m.owner, 'iron_door');
  click(m.game, m.owner, m.oc, 5, FY);
  assert.equal(m.world.tile(5, FY), K.IRON_DOOR);
  assert.equal(m.world.tile(5, FY - 2), K.IRON_DOOR, 'three tall');
  // The raider walks into it from outside: it stays shut.
  put(m.raider, 6);
  m.raider.body.x = 6 * TILE + 7;
  run(m.game, 1);
  assert.ok(!pushDoor(m.game, m.raider, -1) && m.world.tile(5, FY) === K.IRON_DOOR, 'locked to them');
  rightClick(m.game, m.raider, m.rc, 5, FY);
  assert.equal(m.world.tile(5, FY), K.IRON_DOOR, 'a right click: still shut');
  assert.ok(toldTo(m.game, m.raider, /Locked/));
  // Its owner: it opens.
  put(m.owner, 4);
  m.owner.body.x = 4 * TILE + 9;
  run(m.game, 1);
  assert.ok(pushDoor(m.game, m.owner, 1), 'opens for its owner');
  assert.equal(m.world.tile(5, FY), K.IRON_DOOR_OPEN);
  put(m.owner, 0);
  run(m.game, 80);
  assert.equal(m.world.tile(5, FY), K.IRON_DOOR, 'and shuts behind them');
  // A raid can't dig it.
  assert.equal(digShare(m.world, m.raider, 5, FY, K.IRON_DOOR), 0);
  // Its base fallen: anyone's.
  hitCore(m.game, c, 1e6, m.raider);
  put(m.raider, 6);
  m.raider.body.x = 6 * TILE + 7;
  run(m.game, 1);
  assert.ok(pushDoor(m.game, m.raider, -1), 'fallen: it opens for anyone');
  // Broken: an iron door back.
  put(m.raider, 60);
  m.world.setTile(5, FY, K.IRON_DOOR);
  m.world.setTile(5, FY - 1, K.IRON_DOOR);
  m.world.setTile(5, FY - 2, K.IRON_DOOR);
  give(m.owner, 'iron_pickaxe');
  put(m.owner, 3);
  run(m.game, 2);
  hold(m.game, m.owner, m.oc, 5, FY, 900);
  assert.equal(m.world.tile(5, FY), AIR);
  run(m.game, 60);
  assert.ok(m.world.drops.some(d => d.key === 'iron_door') || m.owner.world.inv.count('iron_door') === 1, 'dropped whole');
});

test('siege tools: a breaching charge breaks what\'s round it (reinforced bricks too) and hits a flag hard; a battering ram; neither where a base can\'t be raided', () => {
  const m = playOn({ raiding: 'anytime' });
  const c = baseUp(m);
  for (let y = FY - 2; y <= FY; y++) m.world.setTile(4, y, K.REINFORCED);
  give(m.raider, 'breach_charge', 2);
  put(m.raider, 6);
  run(m.game, 2);
  click(m.game, m.raider, m.rc, 4, FY);
  const charge = m.game.projectiles.find(p => p.cfg?.siege === 'breach_charge');
  assert.ok(charge, 'the charge is set');
  assert.equal(m.raider.world.inv.count('breach_charge'), 1);
  put(m.raider, 14);
  const hp = c.hp;
  run(m.game, 200);
  for (let y = FY - 2; y <= FY; y++) assert.equal(m.world.tile(4, y), AIR, `reinforced bricks broken (${y})`);
  assert.ok(c.hp <= hp - 250, `the flag hit hard (${hp} -> ${c.hp})`);
  assert.equal(m.world.tile(FX, FY), K.CLAIM_FLAG, 'the flag itself isn\'t blown away');
  // A battering ram: reinforced bricks in a few swings.
  m.world.setTile(8, FY, K.REINFORCED);
  give(m.raider, 'battering_ram');
  put(m.raider, 10);
  run(m.game, 2);
  hold(m.game, m.raider, m.rc, 8, FY, 30 * 6);
  assert.equal(m.world.tile(8, FY), AIR, 'rammed through');
  // Where a base can't be raided: neither.
  const safe = playOn({ raiding: 'off' });
  baseUp(safe);
  safe.world.setTile(4, FY, K.REINFORCED);
  give(safe.raider, 'breach_charge', 2);
  click(safe.game, safe.raider, safe.rc, 4, FY);
  assert.equal(safe.raider.world.inv.count('breach_charge'), 2, 'not set');
  assert.ok(!safe.game.projectiles.some(p => p.cfg?.siege));
  give(safe.raider, 'battering_ram');
  hold(safe.game, safe.raider, safe.rc, 4, FY, 30 * 6);
  assert.equal(safe.world.tile(4, FY), K.REINFORCED, 'not rammed');
});

test('an alarm bell: its side hears the base is attacked wherever they are (without one, only near it)', () => {
  const m = playOn({ raiding: 'anytime', width: 260 });
  const c = baseUp(m);
  put(m.owner, 220);
  run(m.game, 2);
  give(m.raider, 'pickaxe');
  put(m.raider, FX + 3);
  run(m.game, 2);
  hold(m.game, m.raider, m.rc, FX, FY, 20);
  assert.ok(c.hp < maxHpOf(c), 'hit');
  assert.ok(!toldTo(m.game, m.owner, /attacking your base/), 'far off, no bell: not heard');
  // With a bell.
  m.world.setTile(FX - 3, FY, K.ALARM_BELL);
  c.alarmAt = -1e9;
  hold(m.game, m.raider, m.rc, FX, FY, 20);
  assert.ok(toldTo(m.game, m.owner, /Raider is attacking your base!.*alarm bell/), 'heard, far off');
  const row = claimsToSave(m.world)[0];
  assert.ok(row[5] & 4 && row[5] & 8, 'and every screen\'s told it\'s under attack, its bell ringing');
  // Near it: heard without one.
  m.world.setTile(FX - 3, FY, AIR);
  c.alarmAt = -1e9;
  put(m.owner, 0);
  run(m.game, 2);
  m.game.notes.length = 0;
  hold(m.game, m.raider, m.rc, FX, FY, 20);
  assert.ok(toldTo(m.game, m.owner, /attacking your base/), 'near it: heard');
});

test('the dead come for a base: they break through to its flag; beaten, they\'re worth coins; dawn sends them back; a setting turns it off', () => {
  const m = playOn({ raiding: 'off', baseRaids: 'on' });
  const c = baseUp(m);
  // Walled in, its owner can't be got at.
  for (const x of [-6, 9]) for (let y = FY - 2; y <= FY; y++) m.world.setTile(x, y, K.PLANKS);
  for (let x = -6; x <= 9; x++) m.world.setTile(x, FY - 3, K.PLANKS);
  m.game.removeSoldier(m.raider);
  m.owner.spawnProtect = 1e9;
  m.world.time = DAY_TICKS * 16 / 24;
  const raid = startBaseRaid(m.game, c, 4);
  assert.equal(raid.total, 4);
  assert.ok(toldTo(m.game, m.owner, /The dead are coming for your base/));
  run(m.game, 60 * 30);
  const walls = [...[-6, 9].flatMap(x => [FY - 2, FY - 1, FY].map(y => [x, y])), ...Array.from({ length: 16 }, (_, i) => [i - 6, FY - 3])];
  assert.ok(walls.some(([x, y]) => m.world.tile(x, y) !== K.PLANKS), 'they broke through (a wall, or the roof)');
  assert.ok(raid.monsters.some(id => { const z = m.game.soldiers.find(s => s.id === id); return z && z.x > -6 * TILE && z.x < 9 * TILE && z.y > (FY - 3) * TILE; }), 'and got in');
  // Beaten: coins for whoever killed them.
  const coins = m.owner.world.inv.count('coins');
  for (const id of raid.monsters) { const z = m.game.soldiers.find(s => s.id === id); if (z?.alive) damage(m.game, z, 1e4, m.owner, 'Knife'); }
  run(m.game, 40);
  assert.equal(m.world.baseRaid, null, 'over');
  assert.ok(m.owner.world.inv.count('coins') > coins, 'thanked');
  assert.ok(toldTo(m.game, m.owner, /Your base held!/));
  // Dawn: the dead go back.
  const r2 = startBaseRaid(m.game, c, 3);
  run(m.game, 31);
  m.world.time = DAY_TICKS * 2;
  run(m.game, 31);
  assert.equal(m.world.baseRaid, null);
  assert.ok(!r2.monsters.some(id => m.game.soldiers.some(s => s.id === id)), 'gone');
  // Starting by itself: at night, someone in their base; not with the setting off.
  const rng = m.game.rng;
  m.game.rng = () => 0;
  m.world.devQuiet = false;
  m.world.lastBaseRaid = -1e9;
  m.world.time = DAY_TICKS + DAY_TICKS * 16 / 24;
  m.world.settings.baseRaids = 'off';
  m.game.tick = 60 * 30 * 10 - 1;
  run(m.game, 2);
  assert.equal(m.world.baseRaid, null, 'off: none');
  m.world.settings.baseRaids = 'on';
  m.game.tick = 60 * 30 * 11 - 1;
  run(m.game, 2);
  m.game.rng = rng;
  assert.ok(m.world.baseRaid, 'on: one came');
});

test('kept in saves: level, health, a fallen flag, turrets\' ammo (older saves\' bases whole, level 1)', () => {
  const m = playOn({ raiding: 'off' });
  m.game.removeSoldier(m.raider);
  const c = baseUp(m);
  give(m.owner, 'charter');
  click(m.game, m.owner, m.oc, FX, FY);
  hitCore(m.game, c, 300, null);
  give(m.owner, 'gun_turret');
  click(m.game, m.owner, m.oc, -2, FY);
  give(m.owner, 'bullets', 77);
  click(m.game, m.owner, m.oc, -2, FY);
  const rows = JSON.parse(JSON.stringify(claimsToSave(m.world)));
  const w2 = new TileWorld({ seed: 4242, name: 'Back', noTowns: true });
  claimsFromSave(w2, rows);
  const b = claimAt(w2, FX, FY);
  assert.equal(b.owner, 'Owner');
  assert.equal(levelOf(b), 2);
  assert.equal(b.hp, BASE_LEVELS[2].hp - 300);
  assert.equal(w2.turrets.get(`-2,${FY}`)?.ammo, 77);
  c.down = true;
  claimsFromSave(w2, JSON.parse(JSON.stringify(claimsToSave(m.world))));
  assert.ok(claimAt(w2, FX, FY).down, 'fallen, kept');
  claimsFromSave(w2, [[5, 6, 'Old'], ['nonsense'], [1, 2, 3]]);
  assert.equal(w2.claims.size, 1);
  const old = claimAt(w2, 5, 6);
  assert.ok(old.owner === 'Old' && levelOf(old) === 1 && old.hp === BASE_LEVELS[1].hp && !old.down, 'an older save\'s');
});

test('settings, things to make, the codex: raiding and base raids; every defence and siege tool made somewhere, and in the codex', () => {
  assert.equal(WORLD_SETTINGS.raiding.def, 'online');
  assert.equal(WORLD_SETTINGS.baseRaids.def, 'on');
  assert.match(settingsSummary({ raiding: 'anytime', baseRaids: 'off' }), /Raiding: any time · No base raids/);
  assert.match(settingsSummary({ raiding: 'off' }), /Bases safe/);
  const keys = ['reinforced_bricks', 'iron_door', 'arrow_turret', 'gun_turret', 'spikes', 'pressure_mine', 'alarm_bell', 'breach_charge', 'demo_charge', 'battering_ram', 'charter'];
  const codex = codexEntries();
  for (const k of keys) {
    assert.ok(itemOf(k), `${k} is a thing`);
    assert.ok(RECIPES.some(r => r.key === k), `${k} is made somewhere`);
    assert.ok(codex.some(e => e.key === k && /Made at/.test(e.where)), `${k} in the codex`);
  }
  assert.ok(!itemOf('flag_down') && !itemOf('iron_door_open'), 'a fallen flag and an open iron door aren\'t things to carry');
});

/** A host's world with a player joined (as worldnet.test.mjs's). */
async function onlineWorld() {
  const world = new TileWorld({ seed: 4242, name: 'Shared', noTowns: true });
  world.pvp = true;
  world.settings = cleanSettings({ raiding: 'anytime' });
  world.devQuiet = true;
  const sp = world.spawns[0], fx = Math.floor(sp.x / TILE), fy = Math.floor((sp.y + 13) / TILE);
  for (let y = fy - 14; y <= fy + 2; y++) for (let x = fx - 40; x <= fx + 40; x++) { world.setTile(x, y, y >= fy ? K.STONE : AIR); world.setWall(x, y, K.NO_WALL); }
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, effects: true, seed: 1, options: { destruction: true } });
  game.online = true;
  const me = game.addSoldier({ name: 'Host', isBot: false }, { script: { move: 0 }, input() { return this.script; } });
  const sync = new WorldHost(game, {});
  const host = new NetHost({ maxPlayers: 8, botCount: 0, world: sync, matchInfo: () => ({ mode: 'world', mapName: world.name, speed: DEFAULT_SPEED, options: game.options, world: sync.info() }), addBot: () => {} });
  host.setGame(game);
  let now = 0;
  const queue = [];
  const [h, c] = memoryLinks({ latency: 20, schedule: (fn, ms) => queue.push({ fn, at: now + ms }) });
  const ctl = { script: { move: 0 }, input() { return this.script; } };
  const client = new NetClient({ link: c, controller: ctl, loadMap: async () => null, clock: () => now, world: new WorldClient({}) });
  host.addPlayer(h, 'Guest');
  const pump = async () => {
    for (let k = 0; k < 4; k++) {
      await new Promise(r => setImmediate(r));
      const due = queue.filter(q => q.at <= now);
      for (const q of due) { queue.splice(queue.indexOf(q), 1); q.fn(); }
    }
  };
  const step = async (n = 1) => { for (let i = 0; i < n; i++) { game.update(); host.afterTick(); client.tick(); now += 1000 / 60; await pump(); client.updateView(now); } };
  await pump();
  return { world, game, me, client, step, fx, fy };
}

test('online: everyone sees the bases as the host has them (level, health, open to a raid, fallen, under attack)', async () => {
  const o = await onlineWorld();
  await o.step(120);
  const fy = o.fy - 1, fx = o.fx + 2;
  o.world.setTile(fx, fy, K.CLAIM_FLAG);
  const { newBase } = await import('../web/src/world/bases.js');
  const c = newBase(o.game, o.me, fx, fy);
  await o.step(40);
  const seen = () => o.client.game.world.claims.get(`${fx},${fy}`);
  assert.ok(seen() && seen().owner === 'Host', 'the base, on the guest\'s screen');
  assert.ok(seen().open, 'open to a raid (as the host says)');
  hitCore(o.game, c, 400, o.game.soldiers.find(s => s.remote));
  await o.step(40);
  assert.equal(seen().hp, c.hp, 'its health');
  assert.ok(seen().alarm, 'under attack');
  hitCore(o.game, c, 1e6, null);
  await o.step(40);
  assert.ok(seen().down, 'fallen');
  assert.equal(o.client.game.world.tile(fx, fy), K.FLAG_DOWN, 'its flag, down, on their screen');
});
