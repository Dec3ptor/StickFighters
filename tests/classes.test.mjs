// Classes and kits, weapon upgrades and gadgets (the "Classes" match option). Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { WEAPONS } from '../web/src/weapons.js';
import { CLASSES, CLASS_IDS, weaponFor, upgradesFor, kitWeapons, cleanLoadouts, defaultLoadouts } from '../web/src/classes.js';
import { GADGETS, MEDKIT_HEAL, BEACON_HP, useGadget, beaconKey } from '../web/src/gadgets.js';
import { fire } from '../web/src/combat.js';
import { DEFAULT_SPEED, RULES } from '../web/src/config.js';
import { setGameSpeed } from '../web/src/speed.js';
import { NavGraph } from '../web/src/nav.js';
import { BotController, BOT_PROFILES } from '../web/src/bot.js';
import { makeRng } from '../web/src/util.js';
import { loadMap } from './helpers.mjs';

const FLOOR = [{ left: -900, top: 0, right: 900, bottom: 40 }];
const ITEMS = [
  { type: 'weapon', weapon: 'M4', x: 100, y: -20 }, { type: 'health', x: 200, y: -20 },
  { type: 'armour', x: 300, y: -20 }, { type: 'jetpack', x: 400, y: -20 },
];

function arena({ mode = 'team', options = { classes: true }, items = ITEMS, loadout } = {}) {
  const map = {
    name: 'arena', bounds: { left: -900, top: -400, right: 900, bottom: 200 }, platforms: FLOOR, items, loadout,
    spawns: [{ x: -800, y: -12, team: 1 }, { x: 800, y: -12, team: 2 }],
  };
  return new Game({ mapData: map, mode, fragLimit: 999, effects: false, seed: 4, speed: DEFAULT_SPEED, options });
}

/** A soldier of class `cls` (with `loadout` for it, if given), spawned and standing at x. */
function put(game, name, { cls = 'assault', team = 1, x = 0, bot = false, loadout = null, ctl = () => ({ move: 0 }) } = {}) {
  const s = game.addSoldier({ name, isBot: bot, team }, { input: ctl });
  s.pickCls = cls;
  if (loadout) s.loadouts = cleanLoadouts({ ...defaultLoadouts(), [cls]: loadout });
  game.respawn(s);
  place(s, x);
  return s;
}
function place(s, x, y = -12) {
  s.body.x = x; s.body.y = y; s.body.vx = s.body.vy = 0; s.prevX = x; s.prevY = y;
  s.spawnProtect = 0;
}
const run = (game, ticks) => { for (let i = 0; i < ticks; i++) game.update(); };
/** Fire the gun in hand once, straight away. */
function shoot(game, s) {
  s.cooldown = 0;
  return fire(game, s, { firePressed: true });
}

test('classes off (the default): the classic game, with the usual loadout and the map\'s weapons', () => {
  const game = arena({ options: {} });
  assert.equal(game.options.classes, false);
  assert.equal(game.classesOn, false);
  const s = put(game, 'A');
  assert.deepEqual(Object.keys(s.weapons).sort(), ['Platinum', 'Prod']);
  assert.equal(s.cls, undefined, 'no class');
  assert.ok(game.pickups.items.some(it => it.type === 'weapon'), 'weapons on the map');
  assert.equal(weaponFor(s, 'M4'), WEAPONS.M4, 'no upgrades');
});

test('classes on: every class spawns with its kit, holding its main gun', () => {
  const game = arena();
  const expect = {
    assault: { M4: 120, GrenadeLauncher: 2, hold: 'M4' },
    engineer: { Bazooka: 3, Uzi: 150, Mine: 2, Builder: 6, hold: 'Uzi' },
    support: { Shotgun: 16, Dynamite: 2, hold: 'Shotgun' },
    recon: { SR: 15, hold: 'SR' },
  };
  CLASS_IDS.forEach((cls, i) => {
    const s = put(game, cls, { cls, x: -300 + i * 100 });
    const { hold, ...ammo } = expect[cls];
    assert.equal(s.cls, cls);
    assert.deepEqual(Object.keys(s.weapons).sort(), [...Object.keys(ammo), 'Platinum', 'Prod'].sort(), `${cls} kit`);
    for (const [id, n] of Object.entries(ammo)) assert.equal(s.weapons[id].ammo, n, `${cls}: ${id} ammo`);
    assert.equal(s.weapons.Platinum.mag, WEAPONS.Platinum.mag, 'a full pistol');
    assert.equal(s.current, hold, `${cls} holds the ${hold}`);
    assert.equal(s.gadgetCharge, 0, 'gadget ready at the start');
    assert.ok(GADGETS[CLASSES[cls].gadget], `${cls} has a gadget`);
  });
});

test('classes on: the map\'s weapons are gone, but health, armour and jetpacks stay', () => {
  const game = arena();
  assert.deepEqual(game.pickups.items.map(it => it.type).sort(), ['armour', 'health', 'jetpack']);
  // A map's "everyone spawns with" armour and jetpack still apply; its weapons don't.
  const lo = arena({ loadout: { weapons: ['Sheep'], armour: 50, jetpack: true } });
  const s = put(lo, 'A');
  assert.ok(!s.weapons.Sheep && s.armour === 50 && s.body.hasJetpack);
});

test('classes are not offered in gun game or one in the chamber', () => {
  for (const mode of ['gungame', 'oitc']) {
    const game = arena({ mode });
    assert.equal(game.classesOn, false, mode);
    const s = put(game, 'A');
    assert.equal(s.cls, undefined, mode);
  }
});

test('the class you pick applies from your next spawn, with your loadout\'s main weapon and upgrades', () => {
  const game = arena();
  const s = put(game, 'A', { cls: 'engineer', loadout: { main: 'HomingMissile', ups: { HomingMissile: 'extra', Uzi: 'extmag' } } });
  assert.equal(s.weapons.HomingMissile.ammo, 4, '3 rockets and an extra round');
  assert.equal(s.weapons.Uzi.ammo, 225, 'extended mag: 150 x 1.5');
  assert.ok(!s.weapons.Bazooka);
  s.pickCls = 'recon';
  assert.equal(s.cls, 'engineer', 'still an engineer until respawning');
  game.kill(s, null, null);
  run(game, RULES.respawnTicks + 2);
  assert.ok(s.alive);
  assert.equal(s.cls, 'recon');
  assert.ok(s.weapons.SR && !s.weapons.Uzi);
});

test('loadouts sent by a player are checked: unknown weapons, classes and misfit upgrades are dropped', () => {
  const lo = cleanLoadouts({ assault: { main: 'HolyHandGrenade', ups: { M4: 'charge', Platinum: 'hollow', GrenadeLauncher: 'bogus' } }, wizard: { main: 'x' } });
  assert.equal(lo.assault.main, 'M4');
  assert.deepEqual(lo.assault.ups, { Platinum: 'hollow' }, 'explosive upgrades don\'t fit guns');
  assert.ok(!lo.wizard);
  assert.deepEqual(Object.keys(lo).sort(), [...CLASS_IDS].sort());
  assert.deepEqual(upgradesFor('SR'), ['extmag', 'hollow', 'quick'], 'no steady grip for a rifle with no spread');
  assert.deepEqual(upgradesFor('Bazooka'), ['charge', 'extra']);
  assert.deepEqual(upgradesFor('Prod'), []);
});

test('upgrades: steady grip narrows the spread, the weapon itself unchanged', () => {
  const spreadOf = ups => {
    const game = arena();
    const s = put(game, 'A', { loadout: { main: 'M4', ups } });
    s.aim = 0;
    let worst = 0;
    for (let i = 0; i < 300; i++) {
      shoot(game, s);
      const p = game.projectiles[game.projectiles.length - 1];
      worst = Math.max(worst, Math.abs(Math.atan2(p.vy, p.vx)));
      s.weapons.M4.ammo = 100;
    }
    return worst;
  };
  const base = WEAPONS.M4.spread;
  const plain = spreadOf({}), steady = spreadOf({ M4: 'steady' });
  assert.ok(plain > base * 0.3 && plain <= base / 2 + 1e-9, `plain spread ${plain}`);
  assert.ok(steady <= base * 0.6 / 2 + 1e-9, `steady grip: ${steady} vs ${plain}`);
  assert.equal(WEAPONS.M4.spread, base, 'the weapon definition never changes');
});

test('upgrades: hollow points hit harder over a shorter range; quick hands fire sooner', () => {
  const game = arena();
  const plain = put(game, 'A', { x: -200 });
  const hollow = put(game, 'B', { x: 0, loadout: { main: 'M4', ups: { M4: 'hollow' } } });
  const quick = put(game, 'C', { x: 200, loadout: { main: 'M4', ups: { M4: 'quick' } } });
  for (const s of [plain, hollow, quick]) s.aim = -Math.PI / 2;
  shoot(game, plain);
  const p0 = game.projectiles.at(-1);
  shoot(game, hollow);
  const p1 = game.projectiles.at(-1);
  assert.equal(p0.damage, WEAPONS.M4.damage);
  assert.equal(p1.damage, WEAPONS.M4.damage * 1.25);
  assert.ok(Math.abs(p1.life - p0.life * 0.7) < 1e-6, 'shorter range');
  shoot(game, quick);
  assert.ok(Math.abs(quick.cooldown - WEAPONS.M4.rof * 0.8) < 1e-6, `quick hands: ${quick.cooldown} vs ${WEAPONS.M4.rof}`);
  assert.ok(Math.abs(plain.cooldown - WEAPONS.M4.rof) < 1e-6);
});

test('upgrades: an extended mag holds 12 pistol rounds and reloads to 12', () => {
  const game = arena();
  const s = put(game, 'A', { loadout: { main: 'M4', ups: { Platinum: 'extmag' } } });
  s.select('Platinum');
  assert.equal(s.weapons.Platinum.mag, 12);
  s.aim = -Math.PI / 2;
  for (let i = 0; i < 12; i++) assert.ok(shoot(game, s), `shot ${i + 1}`);
  assert.equal(s.weapons.Platinum.mag, 0);
  assert.ok(s.reloadTimer > 0, 'reloading');
  run(game, Math.ceil(s.reloadTimer) + 2);
  assert.equal(s.weapons.Platinum.mag, 12);
  assert.equal(weaponFor(s, 'Platinum').mag, 12);
  assert.equal(WEAPONS.Platinum.mag, 8, 'the weapon itself still holds 8');
});

test('upgrades: a bigger charge blasts further; an extra round is one more grenade', () => {
  const hurtAt = (ups, gap) => {
    const game = arena();
    const s = put(game, 'A', { cls: 'support', x: -400, loadout: { main: 'Shotgun', ups } });
    const target = put(game, 'T', { team: 2, x: 0, bot: true });
    s.select('Dynamite');
    s.facing = 1; s.aim = 0;
    shoot(game, s);
    run(game, 30);
    const dyn = game.projectiles.find(p => p.weapon === 'Dynamite');
    place(target, dyn.x + gap);
    place(s, -850);
    run(game, 400);
    return { hurt: target.health < target.maxHealth || !target.alive, left: game.projectiles.some(p => p.weapon === 'Dynamite') };
  };
  const r = WEAPONS.Dynamite.blast.radius;
  const plain = hurtAt({}, r * 1.2), big = hurtAt({ Dynamite: 'charge' }, r * 1.2);
  assert.ok(!plain.left && !big.left, 'the dynamite went off');
  assert.equal(plain.hurt, false, 'out of reach of a normal blast');
  assert.equal(big.hurt, true, 'a bigger charge reaches');
  assert.equal(WEAPONS.Dynamite.blast.radius, r, 'the weapon itself is unchanged');
  const game = arena();
  const s = put(game, 'A', { loadout: { main: 'M4', ups: { GrenadeLauncher: 'extra' } } });
  assert.equal(s.weapons.GrenadeLauncher.ammo, 3);
});

test('upgraded weapons follow the game speed (speed.js rescales weapons in place)', () => {
  const s = { mods: { M4: 'quick' } };
  try {
    setGameSpeed(1);
    const full = WEAPONS.M4.rof;
    assert.ok(Math.abs(weaponFor(s, 'M4').rof - full * 0.8) < 1e-9);
    setGameSpeed(0.75);
    assert.ok(Math.abs(weaponFor(s, 'M4').rof - (full / 0.75) * 0.8) < 1e-9);
  } finally { setGameSpeed(DEFAULT_SPEED); }
});

test('medkit: heals you and your team (not the enemy), and recharges in about 20 s', () => {
  const game = arena();
  let g = false;
  const medic = put(game, 'Medic', { x: 0, ctl: () => (g ? (g = false, { move: 0, gadget: true }) : { move: 0 }) });
  const mate = put(game, 'Mate', { x: -300, bot: true });
  const foe = put(game, 'Foe', { team: 2, x: 300, bot: true });
  mate.health = 30; foe.health = 30;
  g = true;
  run(game, 1);
  const kit = game.pickups.items.find(it => it.type === 'medkit');
  assert.ok(kit && kit.owner === medic.id && kit.team === 1, 'dropped a medkit');
  const total = GADGETS.medkit.recharge / DEFAULT_SPEED;
  assert.ok(Math.abs(total - 1200) < 1e-9, '20 seconds at 75% speed');
  assert.ok(medic.gadgetCharge > total - 3, 'recharging');
  place(medic, -600);
  run(game, 40);
  place(foe, kit.x);
  run(game, 3);
  assert.equal(foe.health, 30, 'enemies can\'t use it');
  place(foe, 300);
  place(mate, kit.x);
  run(game, 3);
  assert.equal(mate.health, 30 + MEDKIT_HEAL, 'a teammate is healed');
  assert.ok(!game.pickups.items.some(it => it.type === 'medkit' && it.active && it.life > 0), 'used up');
  // Not ready again until it's recharged.
  assert.equal(useGadget(game, medic), false);
  run(game, Math.ceil(medic.gadgetCharge));
  assert.equal(useGadget(game, medic), true);
});

test('ammo box: refills your team\'s ammo (and an Engineer\'s blocks)', () => {
  const game = arena();
  const support = put(game, 'Support', { cls: 'support', x: 0 });
  const eng = put(game, 'Eng', { cls: 'engineer', x: 300 });
  const mate = put(game, 'Mate', { x: -300, bot: true });
  mate.weapons.M4.ammo = 10;
  mate.weapons.GrenadeLauncher.ammo = 0;
  assert.ok(useGadget(game, support));
  run(game, 40);
  const box = game.pickups.items.find(it => it.type === 'ammo');
  place(support, -700);
  place(mate, box.x);
  run(game, 3);
  assert.equal(mate.weapons.M4.ammo, 70, 'half the kit\'s 120 back');
  assert.equal(mate.weapons.GrenadeLauncher.ammo, 1);
  place(mate, -300);
  run(game, Math.ceil(support.gadgetCharge) + 2);
  place(support, 0);
  assert.ok(useGadget(game, support));
  run(game, 40);
  place(support, -700);
  eng.weapons.Builder.ammo = 0; // (blocks come back over time too)
  place(eng, game.pickups.items.find(it => it.type === 'ammo' && it.active).x);
  run(game, 3);
  assert.equal(eng.weapons.Builder.ammo, 3, 'half the Builder\'s 6 blocks back');
  // A soldier with everything full leaves a box where it is.
  const game2 = arena();
  const s2 = put(game2, 'S', { cls: 'support', x: 0 });
  useGadget(game2, s2);
  run(game2, 40);
  assert.ok(game2.pickups.items.some(it => it.type === 'ammo' && it.active), 'still there');
});

test('spawn beacon: you and your team spawn on it; enemies shoot it or blow it up, teammates can\'t', () => {
  const game = arena();
  const recon = put(game, 'Recon', { cls: 'recon', x: 0 });
  const mate = put(game, 'Mate', { x: -500, bot: true });
  assert.ok(useGadget(game, recon));
  const b = game.beacons[0];
  assert.ok(b && b.owner === recon.id && b.hp === BEACON_HP);
  assert.equal(recon.deployAt, beaconKey(b), 'it becomes where you spawn');
  assert.deepEqual(game.deployOptions(recon).map(o => o.label), ['Base', 'Beacon']);
  assert.deepEqual(game.deployOptions(mate).map(o => o.label), ['Base', 'Recon']);
  const foe = put(game, 'Foe', { team: 2, x: 400 });
  assert.equal(game.deployOptions(foe), null, 'enemies can\'t use it');

  // Spawning on it.
  game.kill(recon, null, null);
  game.kill(mate, null, null);
  mate.deployAt = beaconKey(b);
  run(game, RULES.respawnTicks + 2);
  assert.ok(recon.alive && Math.abs(recon.x - b.x) < 1, `recon spawned on the beacon (${recon.x})`);
  assert.ok(mate.alive && Math.abs(mate.x - b.x) < 1, 'a teammate spawned on it');

  // A teammate's shots don't hurt it; an enemy's do.
  place(recon, -700); place(mate, 300);
  const toBeacon = s => Math.atan2(b.y - 7 - s.shoulderY, b.x - s.shoulderX);
  mate.aim = toBeacon(mate);
  for (let i = 0; i < 10; i++) { shoot(game, mate); run(game, 20); }
  assert.equal(b.hp, BEACON_HP, 'friendly fire does nothing');
  place(mate, -650);
  foe.aim = toBeacon(foe);
  for (let i = 0; i < 20 && game.beacons.length; i++) { foe.weapons.M4.ammo = 100; shoot(game, foe); run(game, 20); }
  assert.equal(game.beacons.length, 0, 'shot to pieces');
  // Gone: back to spawning at base.
  game.kill(recon, null, null);
  run(game, RULES.respawnTicks + 2);
  assert.ok(recon.x < -700, 'back at base');

  // A rocket next to one blows it up.
  run(game, Math.ceil(recon.gadgetCharge));
  place(recon, 0);
  assert.ok(useGadget(game, recon));
  place(recon, -700);
  foe.weapons.Bazooka = { ammo: 3 };
  foe.select('Bazooka');
  place(foe, 300);
  foe.cooldown = 0;
  foe.aim = Math.atan2(-2 - foe.shoulderY, 30 - foe.shoulderX);
  shoot(game, foe);
  run(game, 120);
  assert.equal(game.beacons.length, 0, 'blown up');
});

test('bots spread over the classes and use their gadgets', () => {
  const mapData = loadMap('crossfire.json');
  const game = new Game({ mapData, mode: 'conquest', fragLimit: 0, seed: 11, effects: false, speed: DEFAULT_SPEED, options: { classes: true } });
  // (The match's own route map: the one that's kept up to date as blocks go up or get blown away.)
  const nav = game.useNav(new NavGraph(game.map));
  const rng = makeRng(3);
  for (let i = 0; i < 12; i++) {
    const p = BOT_PROFILES[i % BOT_PROFILES.length];
    game.addSoldier({ name: `${p.name}${i}`, isBot: true, team: 1 + (i % 2), profile: p }, new BotController(nav, 'normal', p, rng));
  }
  for (const team of [1, 2]) {
    const counts = CLASS_IDS.map(c => game.soldiers.filter(s => s.team === team && s.cls === c).length);
    assert.ok(counts.every(n => n >= 1 && n <= 2), `team ${team} classes: ${counts}`);
  }
  const used = new Set(), prev = new Map();
  for (let t = 0; t < 90 * 60; t++) {
    game.update();
    for (const s of game.soldiers) {
      if ((s.gadgetCharge || 0) > (prev.get(s) ?? 0)) used.add(CLASSES[s.cls].gadget);
      prev.set(s, s.gadgetCharge || 0);
    }
  }
  assert.ok(used.size >= 3, `gadgets used: ${[...used]}`);
  // (Bots build only for a reason, and not much: a wall for cover when hurt in a fight, a way up or across.)
  assert.ok(game.map.builtCount <= 10, `bots built ${game.map.builtCount} blocks`);
  // Kits: every bot has its class's weapons (or what it picked up since).
  for (const s of game.soldiers) {
    if (!s.alive) continue;
    const kit = kitWeapons(s.cls, s.loadouts[s.cls].main).map(w => w.id);
    assert.ok(kit.some(id => s.weapons[id]), `${s.name} has its ${s.cls} kit`);
  }
});
