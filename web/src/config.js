// Tunable game constants. Distances are in map pixels, times in ticks (60 per second).

export const TICK_RATE = 60;

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
export const ITEM_SIZE = 14;   // pickup reach around an item's position
