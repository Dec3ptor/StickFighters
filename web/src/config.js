// Tunable game constants. Distances are in map pixels, times in ticks (60 per second).

export const TICK_RATE = 60;

// Game speed. The game always updates TICK_RATE times a second; a lower speed
// slows the mechanics instead (movement, jumps, bullets, fire rates), keeping
// every jump arc the same shape. See speed.js.
export const SPEEDS = [0.6, 0.75, 0.9, 1];
export const DEFAULT_SPEED = 0.75;     // the game's speed
// The speed picker is hidden and everyone plays at DEFAULT_SPEED.
// Set this to true to show the "Game speed" menu again (its code is all still there).
export const SHOW_SPEED_MENU = false;
// Experimental "low jump" option: jumps reach this share of their usual height.
export const LOW_JUMP = 0.6;

// The original game ran at 800x600 and showed the map at 1:1.
export const VIEW_W = 800;
export const VIEW_H = 600;

// Soldier body box, relative to the soldier's origin (about hip height).
export const BODY = { halfW: 6, top: -22, crouchTop: -10, bottom: 12 };

export const PHYS = {
  gravity: 0.45,
  maxFall: 15,
  runSpeed: 3.4,
  crouchSpeed: 1.4,
  groundAccel: 1.2,
  airAccel: 0.5,
  jumpSpeed: 12.3,      // about 168 px: high enough to climb out of every pit in the original maps
  jumpCut: 3.5,         // letting go of jump early caps upward speed (short hops)
  bounceScale: 2.05,    // jump pad launch speed = map bounce value x this
  stepUp: 10,           // walk up ledges this high without jumping
  maxStep: 6,           // largest move per collision sub-step
  jetAccel: 0.85,
  jetMaxUp: 5.0,
  jetDrain: 0.55,       // fuel per tick of thrust (fuel is 0-100)
  jetRegen: 0.25,       // fuel per tick while standing on the ground
  ropeClimb: 2.5,       // ninja rope: how fast you climb up or slide down it
};

// Other motion values (at full speed), rescaled by speed.js.
export const MOTION = {
  timeScale: 1,          // game time per update: 1 at full speed, 0.75 at 75%
  grenadeGravity: 0.25,
  flameDrag: 0.95,       // flames keep this share of their speed each update
  flameLift: 0.05,
  flameGrow: 0.2,        // flame radius growth per update
  itemGravity: 0.3,      // dropped weapons
  itemMaxFall: 10,
  itemToss: 2,
  flipRate: 1 / 36,      // jump-pad somersault progress per update
  landAnim: 3,           // landing speed that plays the landing squash
  landSound: 7,          // landing speed that plays the landing thud
  crateFall: 1.6,        // supply crates drift down on a parachute this fast
};

export const RULES = {
  maxHealth: 100,
  maxArmour: 100,
  armourAbsorb: 2 / 3,      // share of damage the armour takes
  respawnTicks: 120,
  spawnProtectTicks: 90,
  fallDeathMargin: 160,     // below the map's bottom edge
  ceilingMargin: 300,       // jetpacks can't climb further above the map than this
  creditFallTicks: 300,     // a fall within 5 s of being hurt counts as a frag for the attacker
  droppedWeaponTicks: 900,
  burnTicks: 150,
  burnDamage: 0.22,
};

export const ITEM_RESPAWN = { weapon: 600, health: 1200, armour: 1500, jetpack: 1800 };

// Supply crates drop from the sky every so often (in ticks at full speed), each holding a random weapon.
export const CRATES = { normal: { every: 1500, max: 3 }, lots: { every: 600, max: 6 } };
export const ITEM_SIZE = 14;   // pickup reach around an item's position
