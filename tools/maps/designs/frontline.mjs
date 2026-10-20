// Frontline: a big WW1/WW2-style front, built for Rush (blue attacks from the left, red defends).
//
//   x    0 - 1100  Blue's rear lines: the command bunker (blue flag), supply dump, rear trench,
//                  field gun and observation post
//     1100 - 1960  The jump-off trench (point A) and no-man's land: shell craters and a knocked-out tank
//     1960 - 3060  Sector 1, red's forward line: front trench, the pillbox (M-COM, point B, a hill on
//                  its roof), MG nest, the covered support trench (M-COM)
//     3060 - 4400  The ruined village: two broken houses, the square (point C), the church (a hill in
//                  the nave) with its bell tower (sniper's belfry) and the crypt underneath
//     4400 - 5460  Sector 2, the ridge: a walkable slope, the trench on the crest with the gun pit
//                  (M-COM), the blockhouse (M-COM, point D, a hill on its roof)
//     5460 - 6040  The farm in the dip behind the ridge
//     6040 - 7400  Sector 3, the HQ plateau: outer trench (point E) with a jump pad up to the chateau
//                  roof, the chateau with its cellar war room (M-COM) and radio room (M-COM), and
//                  red's courtyard with the arsenal (red flag)
//
// The ground is one thick slab of earth with no pits anywhere: trenches, craters, the crypt and the
// chateau's cellar are cut into it. Ground level is y = 0 as far as the village, -180 on the ridge
// and -340 on the HQ plateau, so the attackers fight their way uphill.
import { MapBuilder } from '../lib.mjs';

export const info = { modes: ['rush', 'conquest', 'ctf', 'koth', 'team', 'ffa'], size: 'large', players: '16-64' };

const W = 7400;       // the map runs from x 0 to W
const BASE = 320;     // the bottom of the earth
const TOP = -1300;    // the top of the end walls
const RIDGE = -180;   // ground on the ridge
const PLAT = -340;    // ground on the HQ plateau

export default function () {
  const m = new MapBuilder('Frontline');

  // ---- Helpers -------------------------------------------------------------------------
  // The ground is a list of [x, top]; each piece runs to the next entry's x, down to BASE.
  const ground = [];
  const g = (x, top) => ground.push([x, top]);
  /** A slab (floor) with its top at y. */
  const slab = (l, r, y, th = 20) => m.box(l, y, r, y + th);
  /** Sandbags (or crates): cover standing on the floor at y. 24 px: crouch behind, shoot over standing. */
  const bags = (l, r, y, h = 24) => m.box(l, y - h, r, y);
  /** A walkable slope (10 px steps) on the ground from (x0, y0) up to (x1, y1), built in layers. */
  const slope = (x0, y0, x1, y1) => {
    const n = Math.round((y0 - y1) / 10), w = (x1 - x0) / n;
    for (let k = 0; k < n; k++) m.box(Math.round(x0 + (k + 1) * w), y0 - 10 * (k + 1), x1, y0 - 10 * k);
    g(x1, y1);
  };
  /**
   * A trench in ground at height y0 from l to r: a step halfway down at each end and the floor
   * `depth` below. face -1: the parapet (sandbags) is on the left, with a fire step (a strip of
   * ground) between it and the trench, so the trench faces an enemy on the left; +1 the right.
   */
  const trench = (l, r, y0, depth, face, step = 34) => {
    g(l, y0 + Math.round(depth / 2));
    g(l + step, y0 + depth);
    g(r - step, y0 + Math.round(depth / 2));
    g(r, y0);
    if (face < 0) bags(l - 70, l - 34, y0);
    if (face > 0) bags(r + 34, r + 70, y0);
  };
  /** A jump pad set into the ground (its top level with the ground at y). */
  const groundPad = (l, r, y, strength) => { g(l, y + 12); g(r, y); m.pad(l, r, y, strength); };

  // ---- The ground, left to right --------------------------------------------------------
  g(0, 0);
  trench(560, 780, 0, 70, 1);              // blue's rear trench
  trench(1150, 1460, 0, 80, 1);            // the jump-off trench (point A)
  // No-man's land: two shell craters either side of the tank.
  g(1560, 18); g(1585, 40); g(1640, 18); g(1665, 0);
  g(1830, 18); g(1855, 38); g(1890, 18); g(1915, 0);
  trench(2030, 2270, 0, 80, -1);           // red's front trench (covered in the middle: M-COM 1a)
  trench(2790, 3040, 0, 100, -1);          // the support trench (covered in the middle)
  // The crypt under the church: a stairwell down at each end.
  g(3860, 45); g(3895, 95); g(3930, 150);
  g(4170, 95); g(4205, 45); g(4240, 0);
  slope(4400, 0, 4670, RIDGE);             // the slope up to the ridge
  trench(4790, 5000, RIDGE, 90, -1);       // the ridge trench and gun pit (M-COM 2a)
  g(5460, RIDGE + 40); g(5500, RIDGE + 80); // down into the farm dip (y -100)
  g(5880, RIDGE + 40); g(5920, RIDGE);
  slope(6040, RIDGE, 6232, PLAT);          // up to the plateau
  trench(6410, 6580, PLAT, 80, -1);        // HQ outer trench...
  groundPad(6510, 6546, PLAT + 80, 11);    // ...with a jump pad up to the chateau roof
  // The chateau's cellar (the war room): stairwells down at each end.
  g(6680, PLAT + 45); g(6715, PLAT + 95); g(6750, PLAT + 160);
  g(6930, PLAT + 95); g(6965, PLAT + 45); g(7000, PLAT);

  // Hollows dug out of the ground: [left, top, right, bottom].
  const hollows = [
    // The mine gallery under no-man's land, from a shaft in the jump-off trench, up through
    // the floor of the first crater, to a shaft in red's front trench.
    [1386, 80, 1426, 170], [1585, 40, 1640, 104], [2064, 80, 2110, 170], [1386, 104, 2110, 170],
  ];
  ground.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < ground.length; i++) {
    const [x, top] = ground[i];
    const r = i + 1 < ground.length ? ground[i + 1][0] : W;
    if (r <= x) continue;
    let pieces = [[x, top, r, BASE]];
    for (const [hl, ht, hr, hb] of hollows) {
      const next = [];
      for (const [l, t, rr, b] of pieces) {
        if (hl >= rr || hr <= l || ht >= b || hb <= t) { next.push([l, t, rr, b]); continue; }
        if (hl > l) next.push([l, t, hl, b]);
        if (hr < rr) next.push([hr, t, rr, b]);
        const cl = Math.max(l, hl), cr = Math.min(rr, hr);
        if (ht > t) next.push([cl, t, cr, ht]);
        if (hb < b) next.push([cl, hb, cr, b]);
      }
      pieces = next;
    }
    for (const [l, t, rr, b] of pieces) m.box(l, t, rr, b);
  }
  m.box(1600, 140, 1625, 170);         // a crate to climb out of the gallery into the crater
  // The ends of the world: too tall to jump or jetpack over.
  m.box(-40, TOP, 0, BASE);
  m.box(W, TOP, W + 40, BASE);

  // ---- Blue's rear lines (x 0-1100) -------------------------------------------------------
  // Command bunker (blue flag): roof with a hatch (a way down, too high to climb), door on the
  // right opening onto a strip of clear ground, then a crate to climb (64 high, 76 more to the roof).
  slab(0, 170, -140, 24); slab(240, 420, -140, 24);
  m.box(396, -116, 420, -46);
  bags(450, 486, 0, 64);
  bags(486, 526, 0, 40);                // supply dump: a step up to the crate
  // Field gun: carriage, shield and barrel; the observation post above it, with a ladder rung
  // on its right (barrel 76 high, rung 115, post 200).
  bags(880, 960, 0, 40);
  m.box(940, -86, 956, -40);
  slab(956, 1040, -76, 14);
  slab(980, 1080, -200);
  slab(1088, 1128, -115, 12);           // the observation post's ladder rung
  bags(1080, 1116, 0);                  // the jump-off trench's back wall

  // ---- No-man's land (x 1100-1960) -----------------------------------------------------------
  // The knocked-out tank: hull and turret.
  m.box(1700, -50, 1800, 0);
  m.box(1725, -80, 1780, -50);

  // ---- Sector 1: red's forward line (x 1960-3060) -------------------------------------------
  // The pillbox: concrete, a shell-broken doorway facing blue, open at the back.
  m.box(2330, -130, 2580, -100);       // roof
  m.box(2330, -100, 2370, -60);        // wall over the breach
  m.box(2330, -10, 2370, 0);           // rubble
  bags(2600, 2640, 0, 56);              // crates: a step up to the roof at the back
  m.box(2120, 0, 2200, 24);            // front trench: timber cover over the M-COM
  m.box(2880, 0, 2990, 24);            // support trench: timber cover

  // ---- The village (x 3060-4400) ----------------------------------------------------------
  // Floors are 130 apart, more than a jump, so each storey has a step halfway: a fallen beam
  // (high enough to walk under, so the street stays clear) or the top of a broken wall.
  // House A: two floors, the west end of the roof fallen in. A fallen beam (66 up) is the way to
  // the first floor; the broken west wall (80 above it) is the way on up to the roof.
  slab(3090, 3250, -130); slab(3170, 3330, -260);
  slab(3252, 3288, -66, 12);           // a fallen beam: a step up to the first floor
  m.box(3090, -210, 3114, -130);       // what's left of the west wall
  m.box(3310, -300, 3330, -260);       // chimney
  bags(3380, 3430, 0, 30);              // a wrecked cart in the street
  // House B: three floors, half collapsed. A beam under the stair hole, the broken east wall
  // (80 above the first floor) up to the second, and the top floor sagging to 85 above that.
  slab(3460, 3540, -130); slab(3590, 3650, -130);
  slab(3460, 3570, -260);
  slab(3460, 3520, -345);
  slab(3548, 3582, -66, 12);           // a beam under the stair hole
  m.box(3460, -110, 3480, -46);        // west wall over the door
  m.box(3460, -200, 3480, -130);       // west wall, first floor
  m.box(3626, -210, 3650, -130);       // a stub of the east wall
  bags(3710, 3750, 0, 26);              // the well in the square
  // The church: nave with a gallery and a shell-holed roof (the way to both is up the tower:
  // its fourth floor steps out onto the roof, and the hole drops onto the gallery).
  m.box(3810, -280, 3836, -50);        // west wall over the door
  slab(3836, 3950, -150);              // gallery
  slab(3810, 3880, -300); slab(3940, 4040, -300);
  m.box(3940, 0, 4160, 40);            // crypt ceiling (the church floor)
  // Bell tower: floors climbing in a zigzag (about 87 apart) up to the belfry, then the spire.
  slab(4090, 4140, -87); slab(4040, 4090, -173); slab(4090, 4140, -260);
  slab(4040, 4090, -347); slab(4100, 4140, -433);
  m.box(4140, -450, 4160, -60);        // east wall (open underneath)
  slab(4020, 4100, -520);              // belfry floor
  slab(4050, 4120, -605);              // belfry roof
  m.box(4078, -675, 4092, -605);       // spire
  // The barn: hayloft and roof. A ladder rung (72 up, walk under it) up to the loft; the broken
  // west gable (65 above the loft) up to the roof.
  slab(4250, 4360, -150); slab(4290, 4420, -280);
  slab(4368, 4400, -72, 12);           // the hayloft ladder's rung
  m.box(4226, -215, 4250, -130);       // the west gable
  slab(4520, 4600, -320);              // a shell-shattered tree on the slope (from the barn roof): a way over the parapet

  // ---- Sector 2: the ridge (x 4400-5460) ----------------------------------------------------
  m.box(4870, RIDGE, 4950, RIDGE + 24); // gun pit cover
  // Blockhouse: doors front and back, two storeys and a roof. A crate (70 high) under the stair
  // hole leads up to the first floor (80 more); sandbags on its east end (60) lead up to the
  // roof (80 more).
  m.box(5040, -310, 5070, -240);       // west wall over the door
  bags(5110, 5135, RIDGE);              // sandbags inside
  bags(5250, 5300, RIDGE, 70);          // crate under the stair hole
  slab(5040, 5230, -330); slab(5280, 5370, -330);
  m.box(5340, -310, 5370, -240);       // east wall over the back door
  bags(5345, 5370, -330, 60);           // sandbags on the first floor: a step up to the roof
  slab(5070, 5320, -470, 26);          // roof (a hill)
  bags(5390, 5440, RIDGE, 60);          // crates by the back

  // ---- The farm (x 5460-6040) ----------------------------------------------------------------
  // The farmhouse: haystack (50) up to the first floor (80 more), then the second floor and the
  // roof, 85 apart (the first floor is also a bridge over the dip, from the east).
  bags(5520, 5560, -100, 50);           // haystack
  slab(5590, 5810, -230);
  m.box(5590, -210, 5608, -150);       // walls over the doors
  m.box(5792, -210, 5810, -150);
  slab(5620, 5780, -315); slab(5660, 5740, -400);

  // ---- Sector 3: HQ (x 6040-7400) ----------------------------------------------------------
  // Chateau: west wall with a door and windows, three floors, roof with battlements, radio mast.
  // Floors are 150 apart; crates (70 high, then 80 more) are the stairs from floor to floor and
  // up to the roof, and a ladder rung (65, then 65 more) leads up to the radio mast's platform.
  m.box(6630, -770, 6660, -690);
  m.box(6630, -664, 6660, -540);
  m.box(6630, -514, 6660, -390);
  m.box(6760, PLAT, 6920, PLAT + 40);   // cellar ceiling (the ground floor)
  bags(7060, 7110, PLAT, 70);           // crate under the first stair hole
  slab(6660, 7040, -490); slab(7090, 7160, -490);
  bags(6780, 6830, -490, 70);           // crate under the second stair hole
  slab(6660, 6760, -640); slab(6810, 7110, -640);
  bags(7084, 7110, -640, 70);           // crate up to the roof
  slab(6630, 7060, -790);              // roof
  bags(6630, 6650, -790, 26); bags(6780, 6800, -790, 26);  // battlements
  slab(6914, 6948, -855, 12);          // the mast's ladder rung (walk under it)
  slab(6960, 7030, -920);              // radio mast platform
  m.box(6990, -1060, 7000, -920);
  // The arsenal in red's courtyard (red flag underneath).
  slab(7240, 7400, -480);

  // ---- Objectives ---------------------------------------------------------------------------
  m.flag(1, 110, 0);
  m.flag(2, 7330, PLAT);
  m.mcom(1, 2160, 80);
  m.mcom(1, 2470, 0);
  m.mcom(2, 4910, RIDGE + 90);
  m.mcom(2, 5185, RIDGE);
  m.mcom(3, 6840, PLAT + 160);
  m.mcom(3, 6900, -640);
  m.point('A', 1180, 1430, 80, 150);
  m.point('B', 2370, 2600, 0, 120);
  m.point('C', 3640, 3810, 0, 120);
  m.point('D', 5070, 5300, RIDGE, 120);
  m.point('E', 6230, 6400, PLAT, 120);
  m.hill(2370, 2580, -130, 100);
  m.hill(3836, 4040, 0, 100);
  m.hill(5090, 5300, -470, 100);

  // ---- Spawns ---------------------------------------------------------------------------------
  // Bases (every mode but Rush).
  for (const x of [40, 160, 220, 280, 340]) m.spawn(x, 0, 1);
  for (const x of [30, 120, 270, 330, 390]) m.spawn(x, -140, 1);
  for (const x of [545, 865]) m.spawn(x, 0, 1);
  for (const x of [130, 200]) m.spawn(x, -140, 1);
  for (const x of [610, 680, 730]) m.spawn(x, 70, 1);
  for (const x of [7160, 7200, 7240, 7290, 7370]) m.spawn(x, PLAT, 2);
  for (const x of [7260, 7320, 7380]) m.spawn(x, -480, 2);
  for (const x of [6700, 6990, 7120]) m.spawn(x, -490, 2);
  for (const x of [6700, 6950]) m.spawn(x, -640, 2);
  for (const x of [7020, 7130]) m.spawn(x, PLAT, 2);
  for (const x of [6800, 6880]) m.spawn(x, PLAT, 2);
  // Rush: sector 1 (blue in the jump-off trench and the gallery; red in the village).
  for (const x of [1200, 1240, 1280, 1320, 1360]) m.spawn(x, 80, 1, 1);
  m.spawn(1445, 40, 1, 1);
  m.spawn(1166, 40, 1, 1); m.spawn(1132, 0, 1, 1); m.spawn(1700, 170, 1, 1);
  for (const x of [3300, 3500, 3560, 3610, 3660]) m.spawn(x, 0, 2, 1);
  for (const x of [3200, 3290]) m.spawn(x, -260, 2, 1); m.spawn(3500, -130, 2, 1);
  // Sector 2 (blue in the church and barn; red at the farm).
  for (const x of [3845, 3980, 4020, 4110, 4130, 4270, 4320]) m.spawn(x, 0, 1, 2);
  m.spawn(4300, -150, 1, 2);
  for (const x of [5760, 5850]) m.spawn(x, -100, 2, 2);
  for (const x of [5940, 5990, 6030]) m.spawn(x, RIDGE, 2, 2);
  for (const x of [5700, 5770]) m.spawn(x, -230, 2, 2); m.spawn(5700, -315, 2, 2);
  // Sector 3 (blue at the farm; red in the courtyard).
  for (const x of [5580, 5620, 5680, 5740, 5860]) m.spawn(x, -100, 1, 3);
  for (const x of [5960, 6000]) m.spawn(x, RIDGE, 1, 3); m.spawn(5610, -230, 1, 3);
  for (const x of [7250, 7300, 7350, 7390]) m.spawn(x, PLAT, 2, 3);
  for (const x of [7270, 7320, 7370]) m.spawn(x, -480, 2, 3);
  m.spawn(7200, PLAT, 2, 3);

  // ---- Items ------------------------------------------------------------------------------------
  // Blue's rear lines.
  m.item('M4', 200, 0); m.item('health', 300, 0); m.item('armour', 60, -140);
  m.item('jetpack', 300, -140); m.item('Shotgun', 545, 0); m.item('GrenadeLauncher', 660, 70);
  m.item('NinjaRope', 920, -40); m.item('jetpack', 1030, -200); m.item('M4', 1000, -76);
  // The jump-off trench and no-man's land.
  m.item('M4', 1220, 80); m.item('health', 1300, 80); m.item('Mortar', 1350, 80); m.item('health', 1800, 170);
  m.item('health', 1612, 40); m.item('Bazooka', 1752, -80); m.item('Shotgun', 1870, 38);
  // Sector 1.
  m.item('M4', 2120, 80); m.item('health', 2200, 80); m.item('Flamer', 2420, 0);
  m.item('Minigun', 2460, -130); m.item('Shotgun', 2680, 0);
  m.item('health', 2850, 100); m.item('armour', 2960, 100); m.item('GrenadeLauncher', 3010, 50);
  // The village.
  m.item('Shotgun', 3200, -130); m.item('health', 3250, -260); m.item('M4', 3400, -30);
  m.item('NinjaRope', 3490, -345); m.item('health', 3610, -130);
  m.item('jetpack', 3680, 0); m.item('armour', 3900, -150); m.item('M4', 3990, 0);
  m.item('HolyHandGrenade', 4050, 150); m.item('health', 4120, 150);
  m.item('SR', 4040, -520); m.item('Dynamite', 4300, -150); m.item('M4', 4340, -280);
  // Sector 2.
  m.item('health', 4560, -110); m.item('M4', 4860, -90); m.item('Mortar', 4940, -90);
  m.item('Shotgun', 5160, -180); m.item('armour', 5100, -330); m.item('AirStrike', 5200, -470);
  m.item('health', 5410, -240);
  // The farm.
  m.item('M4', 5540, -150); m.item('health', 5700, -100); m.item('jetpack', 5700, -400);
  m.item('Mine', 5640, -230); m.item('Shotgun', 5850, -100);
  // Sector 3.
  m.item('health', 6300, PLAT); m.item('M4', 6480, PLAT + 80);
  m.item('health', 6840, PLAT + 160); m.item('Flamer', 6800, PLAT + 160);
  m.item('Shotgun', 6720, -490); m.item('armour', 7000, -490); m.item('health', 6700, -640);
  m.item('SR', 6720, -790); m.item('Bazooka', 6995, -920);
  // Red's courtyard.
  m.item('M4', 7180, PLAT); m.item('health', 7260, PLAT); m.item('jetpack', 7380, PLAT);
  m.item('armour', 7300, -480); m.item('jetpack', 7360, -480); m.item('NinjaRope', 7150, -490);
  m.item('GrenadeLauncher', 6960, -490); m.item('M4', 7000, -640);
  return m;
}
