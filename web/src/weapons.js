// Weapon definitions. The original eight keep the original game's fire delay,
// damage, accuracy and ammo (SSwep.wtb, see reference/ss2/data/weapons.json);
// the rest are new, inspired by the Worms games.
//
// Every number is at full game speed, in ticks (1/60 s) and pixels; speed.js
// rescales them. `kind` picks the behaviour in combat.js:
//   bullet    hitscan-fast bullets (pellets > 1 for shotguns, spinup for the minigun)
//   rail      instant shot (sniper rifle)
//   arrow     a fast shot that drops and sticks in walls
//   seeker    a slow bullet that homes in on the nearest enemy
//   thrown    a bouncing bomb with a fuse (or that bursts on impact), with a payload
//   rocket    a missile that explodes on contact (optionally homing or falling)
//   flame     flamethrower
//   walker    an animal (or old woman) that walks along the ground, then explodes
//   flyer     a flying sheep, steered with the mouse
//   placed    dropped at your feet: dynamite, mines
//   strike    bombs dropped from the sky over where you aim
//   quake     shakes everyone off their feet
//   teleport  moves you to where you aim
//   kamikaze  fly at the enemy and explode
//   rope      a grappling rope to swing on
//   melee     hit whoever is in front of you
//   build     building tools (the Hammer, the Engineer's Builder): put up a block, or repair the map, where you aim (building.js)
//
// Payloads (on thrown/rocket/strike bombs): blast {radius, damage, knock},
// cluster {count, ...bomblet}, fire {count, life}, gas {count, life, dpt},
// flash {radius, duration} (blinds whoever sees it), smoke {radius, life} (a cloud to hide in).
//
// `cs`: the weapon in the Defuse mode's shop (defuse.js): its price and kill reward
// (money), a magazine and spare ammo (mag, reserve, reload: guns reload there, from
// what you carry), dmg (damage times this there), side ('T' or 'CT' only), max (how
// many you can carry: grenades). `shop`: only in that shop (not on maps or in crates).

const deg = d => (d * Math.PI) / 180;

// Number keys pick a slot; pressing it again cycles through what you own in it.
export const SLOTS = [
  { key: '1', name: 'Pistols' },
  { key: '2', name: 'Automatics' },
  { key: '3', name: 'Rifles' },
  { key: '4', name: 'Shotguns' },
  { key: '5', name: 'Precision' },
  { key: '6', name: 'Grenades' },
  { key: '7', name: 'Rockets' },
  { key: '8', name: 'Fire & gas' },
  { key: '9', name: 'Animals & explosives' },
  { key: '0', name: 'Specials' },
  { key: 'F', name: 'Melee' },
];

export const WEAPONS = {
  // ---- 1: Pistols ---------------------------------------------------------------
  Platinum: {
    name: 'Platinum', short: 'Pistol', slot: 0, kind: 'bullet',
    rof: 20, damage: 20, knock: 1.2, spread: deg(3.5), speed: 30, range: 700,
    mag: 8, reload: 70, infinite: true, sound: 'pistol',
    look: { type: 'pistol', length: 10, color: '#666' },
    bot: { near: 0, far: 700, score: 2, value: 0 },
    cs: { price: 200, reward: 300, mag: 12, reserve: 72, reload: 80, dmg: 1.3 },
  },
  // Cut from the original game (an older weapon table has it): a very accurate pistol.
  Beretta: {
    name: 'Beretta', short: 'Beretta', slot: 0, kind: 'bullet',
    rof: 20, damage: 20, knock: 1.2, spread: deg(0.8), speed: 32, range: 760,
    mag: 15, reload: 80, infinite: true, sound: 'pistol',
    look: { type: 'pistol', length: 12, color: '#3c3c3c' },
    bot: { near: 0, far: 720, score: 3, value: 1 },
    cs: { price: 300, reward: 300, mag: 15, reserve: 60, reload: 90, dmg: 1.4 },
  },
  Magnum: {
    name: 'Magnum', short: 'Magnum', slot: 0, kind: 'bullet',
    rof: 34, damage: 42, knock: 3.2, spread: deg(1.2), speed: 36, range: 900,
    ammo: 12, maxAmmo: 24, sound: 'magnum',
    look: { type: 'pistol', length: 14, color: '#9a9a9a' },
    bot: { near: 0, far: 850, score: 5, value: 3 },
    cs: { price: 700, reward: 300, mag: 7, reserve: 35, reload: 110, dmg: 1.4 },
  },

  // ---- 2: Automatics -------------------------------------------------------------
  Uzi: {
    name: 'Uzi', short: 'Uzi', slot: 1, kind: 'bullet',
    rof: 5, damage: 11, knock: 0.5, spread: deg(4), speed: 30, range: 600,
    ammo: 100, maxAmmo: 200, sound: 'uzi',
    look: { type: 'smg', length: 13, color: '#444' },
    bot: { near: 0, far: 450, score: 6, value: 3 },
    cs: { price: 1050, reward: 600, mag: 30, reserve: 100, reload: 110, dmg: 1.35 },
  },
  // Cut from the original game: a quick, steady submachine gun.
  MP5K: {
    name: 'MP5K', short: 'MP5K', slot: 1, kind: 'bullet',
    rof: 6, damage: 10, knock: 0.5, spread: deg(3.2), speed: 31, range: 640,
    ammo: 60, maxAmmo: 150, sound: 'uzi',
    look: { type: 'smg', length: 15, color: '#2c2f33' },
    bot: { near: 0, far: 500, score: 6, value: 3 },
    cs: { price: 1500, reward: 600, mag: 30, reserve: 120, reload: 130, dmg: 1.45 },
  },
  Minigun: {
    name: 'Minigun', short: 'Minigun', slot: 1, kind: 'bullet',
    rof: 2.2, spinup: 36, damage: 6.5, knock: 0.55, spread: deg(7.5), speed: 30, range: 620,
    ammo: 300, maxAmmo: 500, heavy: 0.55, sound: 'minigun',
    look: { type: 'minigun', length: 22, color: '#3a3a3a' },
    bot: { near: 0, far: 500, score: 8, value: 5 },
    cs: { price: 5200, reward: 300, mag: 100, reserve: 200, reload: 300, dmg: 1.3 },
  },

  // ---- 3: Rifles -----------------------------------------------------------------
  M4: {
    name: 'M4 Carbine', short: 'M4', slot: 2, kind: 'bullet',
    rof: 8, damage: 12, knock: 1.0, spread: deg(2.2), speed: 34, range: 850,
    ammo: 60, maxAmmo: 150, sound: 'rifle',
    look: { type: 'rifle', length: 20, color: '#555' },
    bot: { near: 0, far: 800, score: 7, value: 4 },
    cs: { price: 3100, reward: 300, mag: 30, reserve: 90, reload: 160, dmg: 1.6, side: 'CT' },
  },
  // Cut from the original game: hits harder than the M4, fires a little slower and kicks more.
  AK47: {
    name: 'AK-47', short: 'AK-47', slot: 2, kind: 'bullet',
    rof: 11, damage: 15, knock: 1.4, spread: deg(3), speed: 34, range: 850,
    ammo: 40, maxAmmo: 120, sound: 'ak',
    look: { type: 'ak', length: 20, color: '#4a4a4a' },
    bot: { near: 0, far: 800, score: 7, value: 4 },
    cs: { price: 2700, reward: 300, mag: 30, reserve: 90, reload: 150, dmg: 1.65, side: 'T' },
  },
  Longbow: {
    name: 'Longbow', short: 'Bow', slot: 2, kind: 'arrow',
    rof: 42, damage: 55, headMultiplier: 2, knock: 3.5, speed: 17, gravity: 0.16, range: 1400,
    ammo: 12, maxAmmo: 24, sound: 'bow', silent: true,
    look: { type: 'bow', length: 16, color: '#7a5230' },
    bot: { near: 150, far: 900, score: 7, value: 4, lob: true },
  },

  // ---- 4: Shotguns ---------------------------------------------------------------
  Shotgun: {
    name: 'Shotgun', short: 'Shotgun', slot: 3, kind: 'bullet',
    rof: 50, damage: 7.5, pellets: 11, knock: 0.35, spread: deg(12), speed: 26, range: 380,
    ammo: 8, maxAmmo: 24, sound: 'shotgun',
    look: { type: 'shotgun', length: 19, color: '#5a4a3a' },
    bot: { near: 0, far: 280, score: 10, value: 4 },
    cs: { price: 1100, reward: 900, mag: 8, reserve: 32, reload: 170, dmg: 1.3 },
  },

  // ---- 5: Precision --------------------------------------------------------------
  SR: {
    name: 'Sniper Rifle', short: 'Sniper', slot: 4, kind: 'rail',
    rof: 60, damage: 50, headMultiplier: 2.5, knock: 3, spread: 0, range: 2200,
    ammo: 10, maxAmmo: 20, sound: 'sniper', laser: true, zoom: true,
    look: { type: 'sniper', length: 24, color: '#333' },
    bot: { near: 300, far: 2200, score: 9, value: 4 },
    // (In the shop it's a heavy sniper rifle: one shot to the body, armour or not.)
    cs: { price: 4750, reward: 100, mag: 5, reserve: 30, reload: 200, dmg: 3 },
  },
  MagicBullet: {
    name: 'Magic Bullet', short: 'Magic', slot: 4, kind: 'seeker',
    rof: 70, damage: 60, knock: 4, speed: 6.5, turn: 0.075, life: 320, range: 1600,
    ammo: 3, maxAmmo: 6, sound: 'magic',
    look: { type: 'wand', length: 14, color: '#6a3fb5' },
    bot: { near: 150, far: 1200, score: 9, value: 5 },
  },

  // ---- 6: Grenades ---------------------------------------------------------------
  GrenadeLauncher: {
    name: 'Grenade Launcher', short: 'Grenades', slot: 5, kind: 'thrown',
    rof: 50, speed: 8, gravity: 0.25, bounce: 0.45, fuse: 180, spread: deg(1.5), range: 520, contact: true, launcher: true,
    blast: { radius: 80, damage: 95, knock: 9 },
    ammo: 10, maxAmmo: 20, sound: 'thump', sprite: 'grenade',
    look: { type: 'launcher', length: 16, color: '#4a4a4a' },
    bot: { near: 110, far: 450, score: 7, value: 4, lob: true },
  },
  ClusterBomb: {
    name: 'Cluster Bomb', short: 'Cluster', slot: 5, kind: 'thrown',
    rof: 55, speed: 8.5, gravity: 0.25, bounce: 0.45, fuse: 150, spread: deg(1), range: 500,
    blast: { radius: 60, damage: 50, knock: 6 },
    cluster: { count: 5, speed: 3.6, gravity: 0.25, bounce: 0.3, fuse: 0, impact: true, sprite: 'bomblet', blast: { radius: 45, damage: 40, knock: 6 } },
    ammo: 4, maxAmmo: 8, sound: 'throw', sprite: 'cluster',
    look: { type: 'held', sprite: 'cluster' },
    bot: { near: 120, far: 450, score: 8, value: 5, lob: true },
  },
  BananaBomb: {
    name: 'Banana Bomb', short: 'Banana', slot: 5, kind: 'thrown',
    rof: 60, speed: 8.5, gravity: 0.25, bounce: 0.72, fuse: 180, spread: deg(1), range: 500,
    blast: { radius: 75, damage: 70, knock: 9 },
    cluster: { count: 5, speed: 5.5, gravity: 0.25, bounce: 0.65, fuse: 75, sprite: 'banana', blast: { radius: 70, damage: 60, knock: 9 } },
    ammo: 2, maxAmmo: 4, sound: 'throw', sprite: 'banana',
    look: { type: 'held', sprite: 'banana' },
    bot: { near: 150, far: 450, score: 9, value: 7, lob: true },
  },
  HolyHandGrenade: {
    name: 'Holy Hand Grenade', short: 'Holy', slot: 5, kind: 'thrown',
    rof: 80, speed: 10.5, gravity: 0.3, bounce: 0.15, friction: 0.5, roll: 0.85, fuse: 150, holy: 60, spread: 0, range: 420,
    blast: { radius: 170, damage: 150, knock: 18 },
    ammo: 1, maxAmmo: 2, sound: 'throw', sprite: 'holy',
    look: { type: 'held', sprite: 'holy' },
    bot: { near: 200, far: 420, score: 10, value: 9, lob: true },
  },

  // The Defuse mode's grenades (shop only): a frag grenade, a flashbang and a smoke grenade.
  HEGrenade: {
    name: 'HE Grenade', short: 'HE', slot: 5, kind: 'thrown', shop: true,
    rof: 45, speed: 8.5, gravity: 0.25, bounce: 0.4, fuse: 96, spread: deg(1), range: 500,
    blast: { radius: 90, damage: 98, knock: 8 },
    ammo: 1, maxAmmo: 1, sound: 'throw', sprite: 'hegrenade',
    look: { type: 'held', sprite: 'hegrenade' },
    bot: { near: 130, far: 450, score: 7, value: 2, lob: true },
    cs: { price: 300, reward: 300, max: 1 },
  },
  Flashbang: {
    name: 'Flashbang', short: 'Flash', slot: 5, kind: 'thrown', shop: true,
    rof: 40, speed: 8.5, gravity: 0.25, bounce: 0.4, fuse: 90, spread: deg(1), range: 500,
    flash: { radius: 560, duration: 210 },
    ammo: 1, maxAmmo: 2, sound: 'throw', sprite: 'flashbang', burst: 'flashbang',
    look: { type: 'held', sprite: 'flashbang' },
    bot: { score: 0, value: 1 },
    cs: { price: 200, reward: 300, max: 2 },
  },
  SmokeGrenade: {
    name: 'Smoke Grenade', short: 'Smoke', slot: 5, kind: 'thrown', shop: true,
    rof: 40, speed: 8, gravity: 0.25, bounce: 0.3, fuse: 100, spread: deg(1), range: 480,
    smoke: { radius: 100, life: 1080 },
    ammo: 1, maxAmmo: 1, sound: 'throw', sprite: 'smokegrenade', burst: 'smoke',
    look: { type: 'held', sprite: 'smokegrenade' },
    bot: { score: 0, value: 1 },
    cs: { price: 300, reward: 300, max: 1 },
  },

  // ---- 7: Rockets ----------------------------------------------------------------
  Bazooka: {
    name: 'Bazooka', short: 'Bazooka', slot: 6, kind: 'rocket',
    rof: 150, speed: 8.5, spread: deg(1), range: 1000,
    blast: { radius: 95, damage: 115, knock: 11 },
    ammo: 5, maxAmmo: 10, sound: 'rocket', sprite: 'rocket',
    look: { type: 'tube', length: 24, color: '#3d5a2a' },
    bot: { near: 130, far: 800, score: 9, value: 6 },
  },
  HomingMissile: {
    name: 'Homing Missile', short: 'Homing', slot: 6, kind: 'rocket',
    rof: 110, speed: 6.5, spread: 0, range: 1500, homing: { turn: 0.055, delay: 12 },
    blast: { radius: 85, damage: 100, knock: 10 },
    ammo: 3, maxAmmo: 6, sound: 'rocket', sprite: 'homing',
    look: { type: 'tube', length: 22, color: '#7a2222' },
    bot: { near: 150, far: 1200, score: 9, value: 7 },
  },
  Mortar: {
    name: 'Mortar', short: 'Mortar', slot: 6, kind: 'rocket',
    rof: 70, speed: 11, gravity: 0.2, spread: deg(1), range: 900,
    blast: { radius: 55, damage: 60, knock: 7 },
    cluster: { count: 6, speed: 4, gravity: 0.25, bounce: 0.3, fuse: 0, impact: true, sprite: 'bomblet', blast: { radius: 40, damage: 35, knock: 5 } },
    ammo: 5, maxAmmo: 10, sound: 'thump', sprite: 'mortar',
    look: { type: 'tube', length: 18, color: '#4d4d36' },
    bot: { near: 160, far: 700, score: 8, value: 5, lob: true },
  },

  // ---- 8: Fire & gas -------------------------------------------------------------
  Flamer: {
    name: 'Flamethrower', short: 'Flamer', slot: 7, kind: 'flame',
    rof: 3, damage: 1.7, spread: deg(6), speed: 6, life: 36, range: 210,
    ammo: 200, maxAmmo: 300, sound: 'flame',
    look: { type: 'flamer', length: 18, color: '#7a2a1a' },
    bot: { near: 0, far: 170, score: 11, value: 4 },
  },
  PetrolBomb: {
    name: 'Petrol Bomb', short: 'Petrol', slot: 7, kind: 'thrown',
    rof: 55, speed: 8.5, gravity: 0.25, bounce: 0, fuse: 300, impact: true, spread: deg(1), range: 450,
    fire: { count: 12, life: 260, scatter: 3 },
    ammo: 3, maxAmmo: 6, sound: 'throw', sprite: 'petrol', burst: 'smash',
    look: { type: 'held', sprite: 'petrol' },
    bot: { near: 90, far: 420, score: 8, value: 4, lob: true },
    cs: { price: 400, reward: 300, max: 1 },
  },
  Skunk: {
    name: 'Skunk', short: 'Skunk', slot: 7, kind: 'thrown',
    rof: 60, speed: 7.5, gravity: 0.25, bounce: 0.5, fuse: 110, spread: deg(1), range: 420,
    gas: { count: 7, life: 420, dpt: 0.35, radius: 26 },
    ammo: 2, maxAmmo: 4, sound: 'throw', sprite: 'skunk', burst: 'gas',
    look: { type: 'held', sprite: 'skunk' },
    bot: { near: 100, far: 400, score: 6, value: 3, lob: true },
  },

  // ---- 9: Animals & explosives ---------------------------------------------------
  Sheep: {
    name: 'Sheep', short: 'Sheep', slot: 8, kind: 'walker',
    rof: 40, walkSpeed: 2.3, hop: 7.5, fuse: 480, remote: true, contact: true,
    blast: { radius: 100, damage: 110, knock: 12 },
    ammo: 2, maxAmmo: 4, sound: 'baa', sprite: 'sheep',
    look: { type: 'held', sprite: 'sheep' },
    bot: { near: 60, far: 450, score: 8, value: 6, walker: true },
  },
  SuperSheep: {
    name: 'Super Sheep', short: 'Super Sheep', slot: 8, kind: 'flyer',
    rof: 40, speed: 4.6, turn: 0.085, fuse: 420, remote: true,
    blast: { radius: 100, damage: 110, knock: 12 },
    ammo: 1, maxAmmo: 2, sound: 'baa', sprite: 'supersheep',
    look: { type: 'held', sprite: 'supersheep' },
    bot: { near: 80, far: 700, score: 9, value: 8, flyer: true },
  },
  OldWoman: {
    name: 'Old Woman', short: 'Old Woman', slot: 8, kind: 'walker',
    rof: 60, walkSpeed: 1.1, hop: 0, fuse: 300, remote: false, contact: false,
    blast: { radius: 115, damage: 125, knock: 12 },
    ammo: 1, maxAmmo: 2, sound: 'mumble', sprite: 'oldwoman',
    look: { type: 'held', sprite: 'oldwoman' },
    bot: { near: 60, far: 250, score: 6, value: 5, walker: true },
  },
  MadCow: {
    name: 'Mad Cows', short: 'Mad Cows', slot: 8, kind: 'walker',
    rof: 90, count: 3, interval: 22, walkSpeed: 2.7, hop: 5, fuse: 420, remote: false, contact: true,
    blast: { radius: 80, damage: 85, knock: 10 },
    ammo: 1, maxAmmo: 2, sound: 'moo', sprite: 'cow',
    look: { type: 'held', sprite: 'cow' },
    bot: { near: 60, far: 500, score: 8, value: 7, walker: true },
  },
  Dynamite: {
    name: 'Dynamite', short: 'Dynamite', slot: 8, kind: 'placed',
    rof: 60, fuse: 240, throwSpeed: 2.5,
    blast: { radius: 140, damage: 140, knock: 15 },
    ammo: 2, maxAmmo: 4, sound: 'fuse', sprite: 'dynamite',
    look: { type: 'held', sprite: 'dynamite' },
    bot: { score: 0, value: 3 },
  },
  Mine: {
    name: 'Mine', short: 'Mine', slot: 8, kind: 'placed',
    rof: 40, fuse: 3600, throwSpeed: 3.5, mine: { arm: 90, trigger: 26, delay: 4 },
    blast: { radius: 80, damage: 130, knock: 10 },
    ammo: 3, maxAmmo: 6, sound: 'tink', sprite: 'mine',
    look: { type: 'held', sprite: 'mine' },
    bot: { near: 0, far: 220, score: 3, value: 3, mine: true },
  },

  // ---- 0: Specials ---------------------------------------------------------------
  AirStrike: {
    name: 'Air Strike', short: 'Air Strike', slot: 9, kind: 'strike',
    rof: 90, bombs: 5, spacing: 34, interval: 6, payload: 'bomb', speed: 9,
    blast: { radius: 60, damage: 60, knock: 8 },
    ammo: 1, maxAmmo: 2, sound: 'plane', aimAtPoint: true,
    look: { type: 'radio', color: '#3f4d2a' },
    bot: { near: 100, far: 1500, score: 9, value: 8, point: true },
  },
  NapalmStrike: {
    name: 'Napalm Strike', short: 'Napalm', slot: 9, kind: 'strike',
    rof: 90, bombs: 5, spacing: 26, interval: 7, payload: 'napalm', speed: 8,
    fire: { count: 7, life: 240, scatter: 2.6 },
    ammo: 1, maxAmmo: 2, sound: 'plane', aimAtPoint: true,
    look: { type: 'radio', color: '#8a3b12' },
    bot: { near: 100, far: 1500, score: 8, value: 7, point: true },
  },
  ConcreteDonkey: {
    name: 'Concrete Donkey', short: 'Donkey', slot: 9, kind: 'strike',
    rof: 120, bombs: 1, payload: 'donkey', speed: 7, smashes: 5,
    blast: { radius: 95, damage: 110, knock: 15 },
    ammo: 1, maxAmmo: 1, sound: 'heehaw', aimAtPoint: true,
    look: { type: 'radio', color: '#777' },
    bot: { near: 100, far: 1500, score: 10, value: 10, point: true },
  },
  Earthquake: {
    name: 'Earthquake', short: 'Quake', slot: 9, kind: 'quake',
    rof: 120, duration: 240, kick: 2.6, hopChance: 0.04, hop: 4.5,
    ammo: 1, maxAmmo: 1, sound: 'rumble',
    look: { type: 'held', sprite: 'quake' },
    bot: { near: 0, far: 700, score: 6, value: 7 },
  },
  Teleport: {
    name: 'Teleport', short: 'Teleport', slot: 9, kind: 'teleport',
    rof: 50, range: 650, ammo: 3, maxAmmo: 5, sound: 'teleport', aimAtPoint: true, semi: true,
    look: { type: 'held', sprite: 'teleport' },
    bot: { score: 0, value: 2 },
  },
  Kamikaze: {
    name: 'Kamikaze', short: 'Kamikaze', slot: 9, kind: 'kamikaze',
    rof: 60, speed: 9, duration: 55, semi: true,
    blast: { radius: 120, damage: 160, knock: 15 },
    ammo: 1, maxAmmo: 1, sound: 'banzai',
    look: { type: 'held', sprite: 'kamikaze' },
    bot: { near: 0, far: 160, score: 0, value: 3, lastResort: true },
  },
  NinjaRope: {
    name: 'Ninja Rope', short: 'Rope', slot: 9, kind: 'rope',
    rof: 12, range: 340, ammo: Infinity, sound: 'rope', semi: true,
    look: { type: 'held', sprite: 'rope' },
    bot: { score: 0, value: 1 },
  },
  // Anyone's building tool (a pickup): a click puts up a wall (right click: a plank) where
  // you aim, or repairs what explosions broke. A block a click; another hammer adds more.
  Hammer: {
    name: 'Hammer', short: 'Hammer', slot: 9, kind: 'build', tool: true,
    rof: 24, ammo: 8, maxAmmo: 16, sound: 'build', semi: true,
    look: { type: 'held', sprite: 'hammer' },
    bot: { score: 0, value: 2 },
  },

  // ---- F: Melee -------------------------------------------------------------------
  Prod: {
    name: 'Prod', short: 'Prod', slot: 10, kind: 'melee',
    rof: 28, reach: 22, damage: 0, knock: 6, lift: 2.5, ammo: Infinity, sound: 'prod', silent: true,
    look: { type: 'prod', length: 14, color: '#8a6a3a' },
    bot: { near: 0, far: 22, score: 3, value: 0 },
  },
  // The Defuse mode's knife (everyone has one there): a stab in the back does triple damage.
  Knife: {
    name: 'Knife', short: 'Knife', slot: 10, kind: 'melee', shop: true,
    rof: 30, reach: 22, damage: 34, backstab: 3, knock: 1.5, lift: 0.5, ammo: Infinity, sound: 'knife', silent: true,
    look: { type: 'knife', length: 10, color: '#a8adb3' },
    bot: { near: 0, far: 22, score: 9, value: 0 },
    cs: { reward: 1500 },
  },
  BaseballBat: {
    name: 'Baseball Bat', short: 'Bat', slot: 10, kind: 'melee',
    rof: 45, reach: 26, damage: 30, knock: 15, lift: 4, ammo: 4, maxAmmo: 6, sound: 'bat',
    look: { type: 'bat', length: 16, color: '#b5874d' },
    bot: { near: 0, far: 26, score: 14, value: 5 },
  },
  BattleAxe: {
    name: 'Battle Axe', short: 'Axe', slot: 10, kind: 'melee',
    rof: 60, reach: 24, halve: true, damage: 22, knock: 2, lift: 1, ammo: 3, maxAmmo: 6, sound: 'axe',
    look: { type: 'axe', length: 15, color: '#6b4a2a' },
    bot: { near: 0, far: 24, score: 12, value: 5 },
  },
  FirePunch: {
    name: 'Fire Punch', short: 'Fire Punch', slot: 10, kind: 'melee',
    rof: 50, reach: 22, damage: 30, knock: 3, uppercut: 11, selfHop: 8, ammo: 4, maxAmmo: 6, sound: 'punch',
    look: { type: 'glove', color: '#c23a1a' },
    bot: { near: 0, far: 22, score: 12, value: 5 },
  },

  // ---- Not on maps: used by game modes ---------------------------------------------
  Chamber: {
    name: 'Chamber Pistol', short: 'Pistol', slot: 0, kind: 'bullet', hidden: true,
    rof: 20, damage: 1000, knock: 2, spread: deg(1), speed: 34, range: 1200,
    ammo: 1, maxAmmo: 99, sound: 'pistol',
    look: { type: 'pistol', length: 11, color: '#b8962e' },
    bot: { near: 0, far: 900, score: 9, value: 0 },
  },
  // The Defuse mode's bomb: one attacker carries it, and plants it at a bomb site by
  // holding E (or holding fire with it in hand) there (defuse.js does the rest).
  C4: {
    name: 'C4 Bomb', short: 'C4', slot: 8, kind: 'plant', hidden: true,
    rof: 30, ammo: 1, maxAmmo: 1, sound: 'click',
    look: { type: 'held', sprite: 'c4' },
    bot: { score: 0, value: 0 },
  },
  // The Engineer's tool (classes on): ammo is blocks, which come back over time (gadgets.js).
  Builder: {
    name: 'Builder', short: 'Builder', slot: 9, kind: 'build', hidden: true, tool: true,
    rof: 24, ammo: 6, maxAmmo: 6, sound: 'build', semi: true,
    look: { type: 'held', sprite: 'hammer' },
    bot: { score: 0, value: 0 },
  },
};

for (const id in WEAPONS) WEAPONS[id].id = id;

/** Weapons in slot order (and table order within a slot). */
export const WEAPON_ORDER = Object.keys(WEAPONS).filter(id => !WEAPONS[id].hidden).sort((a, b) => WEAPONS[a].slot - WEAPONS[b].slot);

/** Weapons that can be placed on maps, given out at spawn, or found in crates (not the Defuse mode's shop-only ones). */
export const PICKUP_WEAPONS = WEAPON_ORDER.filter(id => id !== 'Platinum' && id !== 'Prod' && !WEAPONS[id].shop);

/** Everyone spawns with these. */
export const STARTING_WEAPONS = ['Platinum', 'Prod'];

/** Weapons that don't take over your hands when you pick them up (tools you choose to use). */
export const NO_AUTO_SWITCH = new Set(['Teleport', 'NinjaRope', 'Kamikaze', 'Dynamite', 'Mine', 'Earthquake', 'Prod', 'BattleAxe', 'BaseballBat', 'FirePunch', 'Builder', 'Hammer',
  'Knife', 'HEGrenade', 'Flashbang', 'SmokeGrenade', 'C4']);

/** Headshots with bullets and shotgun pellets do double damage (the sniper rifle and bow have their own). */
export const HEADSHOT_MULTIPLIER = 2;

/** Weapon ids in a slot (0-10), in order. */
export const slotWeapons = slot => WEAPON_ORDER.filter(id => WEAPONS[id].slot === slot);

/** Supply crates: how likely each weapon is (rarer for the big ones). */
export const CRATE_WEIGHTS = {
  Magnum: 6, Beretta: 4, Uzi: 6, MP5K: 5, Minigun: 4, M4: 6, AK47: 5, Longbow: 5, Shotgun: 6, SR: 4, MagicBullet: 3,
  GrenadeLauncher: 5, ClusterBomb: 5, BananaBomb: 3, HolyHandGrenade: 1.5,
  Bazooka: 4, HomingMissile: 3, Mortar: 4, Flamer: 4, PetrolBomb: 5, Skunk: 4,
  Sheep: 4, SuperSheep: 2, OldWoman: 3, MadCow: 2, Dynamite: 4, Mine: 5,
  AirStrike: 2.5, NapalmStrike: 2, ConcreteDonkey: 1, Earthquake: 1.5, Teleport: 3, Kamikaze: 2, NinjaRope: 3, Hammer: 4,
  BaseballBat: 4, BattleAxe: 3, FirePunch: 3,
};
