// Weapon definitions. Fire delay, damage, accuracy and ammo come from the original
// SSwep.wtb (see reference/ss2/data/weapons.json); explosives and flames were
// coded in the original exe, so those numbers are new.

const deg = d => (d * Math.PI) / 180;

export const WEAPONS = {
  Platinum: {
    name: 'Platinum', slot: 1, kind: 'bullet',
    rof: 20, damage: 20, knock: 1.2, spread: deg(3.5), speed: 30, range: 700,
    mag: 8, reload: 70, infinite: true, sound: 'pistol',
    look: { length: 10, color: '#666', grip: 0 },
  },
  Uzi: {
    name: 'Uzi', slot: 2, kind: 'bullet',
    rof: 5, damage: 11, knock: 0.5, spread: deg(4), speed: 30, range: 600,
    ammo: 100, maxAmmo: 200, sound: 'uzi',
    look: { length: 13, color: '#444', grip: 1 },
  },
  M4: {
    name: 'M4 Carbine', slot: 3, kind: 'bullet',
    rof: 8, damage: 12, knock: 1.0, spread: deg(2.2), speed: 34, range: 850,
    ammo: 60, maxAmmo: 150, sound: 'rifle',
    look: { length: 20, color: '#555', grip: 2 },
  },
  Shotgun: {
    name: 'Shotgun', slot: 4, kind: 'pellets',
    rof: 50, damage: 7.5, pellets: 11, knock: 0.35, spread: deg(12), speed: 26, range: 380,
    ammo: 8, maxAmmo: 24, sound: 'shotgun',
    look: { length: 19, color: '#5a4a3a', grip: 2 },
  },
  SR: {
    name: 'Sniper Rifle', slot: 5, kind: 'rail',
    rof: 60, damage: 50, headMultiplier: 2, knock: 3, spread: 0, range: 2200,
    ammo: 10, maxAmmo: 20, sound: 'sniper', laser: true, zoom: true,
    look: { length: 24, color: '#333', grip: 2 },
  },
  GrenadeLauncher: {
    name: 'Grenade Launcher', slot: 6, kind: 'grenade',
    rof: 50, speed: 8, fuse: 180, spread: deg(1.5), range: 520,
    blast: { radius: 80, damage: 95, knock: 9 },
    ammo: 10, maxAmmo: 20, sound: 'thump',
    look: { length: 16, color: '#4a4a4a', grip: 2, fat: true },
  },
  Bazooka: {
    name: 'Bazooka', slot: 7, kind: 'rocket',
    rof: 150, speed: 8.5, spread: deg(1), range: 1000,
    blast: { radius: 95, damage: 115, knock: 11 },
    ammo: 5, maxAmmo: 10, sound: 'rocket',
    look: { length: 24, color: '#3d5a2a', grip: 1, fat: true },
  },
  Flamer: {
    name: 'Flamethrower', slot: 8, kind: 'flame',
    rof: 3, damage: 1.7, spread: deg(6), speed: 6, life: 36, range: 210,
    ammo: 200, maxAmmo: 300, sound: 'flame',
    look: { length: 18, color: '#7a2a1a', grip: 2, fat: true },
  },
};

export const WEAPON_ORDER = Object.keys(WEAPONS).sort((a, b) => WEAPONS[a].slot - WEAPONS[b].slot);

/** Headshots on bullets (not just the sniper) do this much extra. */
export const HEADSHOT_MULTIPLIER = 1.5;
