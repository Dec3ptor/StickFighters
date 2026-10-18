// Citadel: a hilltop fortress stormed from the sea, built for Rush (blue attacks from the left).
//
//   x    0 -  700  The landing: two landing craft in the shallows (blue's base) and the sand (blue flag)
//      700 - 1700  Sector 1, the beach defences: hedgehogs on the beach (point A), the casemate in the
//                  seawall (M-COM) and the gun bunker on the dune (M-COM), whose roof has a jump pad
//     1700 - 2050  The cliff: the goat path up its face and the smugglers' cave, which climbs inside
//                  it to a well on the glacis
//     2050 - 2880  Sector 2, the outer wall: the glacis (point B), the gatehouse with its portcullis,
//                  guardroom (M-COM), roof and turrets (a hill); the sally tunnel under it; the
//                  armoury (M-COM) in the outer bailey
//     2880 - 4380  Sector 3, the lower town on terraces: a house, the market (point C, a hill), the
//                  town hall (M-COM) and its clock tower, the cathedral (M-COM) with a scaffold bridge
//                  from its roof to the inner wall
//     4380 - 4620  The inner gatehouse (point D in its passage, a hill on its roof)
//     4620 - 6400  Sector 4, the upper ward (barracks, point E, the siege tower against the keep) and
//                  the keep: great hall (M-COM), three floors up to the solar (M-COM), the roof and
//                  turret; red's courtyard and stable behind it (red flag)
//
// The rock is one solid mass (no pits): falling off any tier lands on the one below, and every
// ledge, wall and tower has a way back down and back up.
import { MapBuilder } from '../lib.mjs';

export const info = { modes: ['rush', 'conquest', 'koth', 'ctf', 'team', 'ffa'], size: 'large', players: '16-64' };

const W = 6400;       // the map runs from x 0 to W
const BASE = 330;     // the bottom of the rock
const SEA = 90;       // the floor of the shallows
const GLACIS = -650;  // the cliff top, the outer bailey and the first town terrace
const WARD = -1100;   // the upper ward and the keep

export default function () {
  const m = new MapBuilder('Citadel');

  // ---- Helpers -------------------------------------------------------------------------
  // The rock: a list of [x, top]; each piece runs to the next entry's x, down to BASE.
  const ground = [];
  const g = (x, top) => ground.push([x, top]);
  // Hollows cut out of the rock: [left, top, right, bottom].
  const hollows = [];
  const hollow = (l, t, r, b) => hollows.push([l, t, r, b]);
  /** A slab (floor) with its top at y. */
  const slab = (l, r, y, th = 20) => m.box(l, y, r, y + th);
  /** Cover (sandbags, crates, rubble, battlements) standing on the floor at y. */
  const bags = (l, r, y, h = 24) => m.box(l, y - h, r, y);
  /** A walkable slope (10 px steps) on the rock from (x0, y0) up to (x1, y1), built in layers. */
  const slope = (x0, y0, x1, y1) => {
    g(x0, y0);
    const n = Math.round((y0 - y1) / 10), w = (x1 - x0) / n;
    for (let k = 0; k < n; k++) m.box(Math.round(x0 + (k + 1) * w), y0 - 10 * (k + 1), x1, y0 - 10 * k);
    g(x1, y1);
  };
  /** A jump pad set into the rock (its top level with the ground at y). */
  const groundPad = (l, r, y, strength) => { g(l, y + 12); g(r, y); m.pad(l, r, y, strength); };
  /**
   * A gatehouse from x0 to x1 on the ground at y, facing left: a passage under the guardroom
   * (an arrow slit facing left, a murder hole at `hole`, a balcony and a step up to the roof out
   * the back), the roof with battlements and a turret. The portcullis hangs half raised.
   */
  const gatehouse = (x0, x1, y, hole) => {
    m.box(x0, y - 80, x0 + 12, y - 44);                 // portcullis
    slab(x0, hole, y - 100); slab(hole + 34, x1 + 34, y - 100);   // guardroom floor and balcony
    m.box(x0, y - 250, x0 + 34, y - 156);               // west wall above the slit...
    m.box(x0, y - 130, x0 + 34, y - 100);               // ...and below it
    slab(x0, x1, y - 250, 24);                          // roof
    m.box(x0, y - 350, x0 + 50, y - 250);               // turret
    bags(x0 + 100, x0 + 120, y - 250, 26);              // battlements
    slab(x1 + 20, x1 + 80, y - 180);                    // a step from the balcony up to the roof
  };

  // ---- The rock, left to right -------------------------------------------------------------
  g(0, SEA);                                // the shallows
  slope(520, SEA, 700, 0);                  // up the sand
  g(1250, -120);                            // the seawall and the dune
  // The cliff face: the goat path's ledges.
  g(1700, -250); g(1760, -380); g(1830, -510); g(1900, GLACIS);
  // The casemate in the seawall: a door onto the beach and a stairwell up to the dune at the back.
  hollow(1250, -50, 1290, 0); hollow(1290, -90, 1520, 0); hollow(1450, -120, 1520, -90);
  // The smugglers' cave: in from the bunker at the foot of the cliff, then up a shaft to the glacis.
  hollow(1700, -200, 2040, -120); hollow(1960, GLACIS, 2040, -200);
  // The sally tunnel under the gatehouse, from the glacis to the outer bailey.
  hollow(2190, GLACIS, 2250, -550); hollow(2190, -620, 2700, -550); hollow(2640, GLACIS, 2700, -550);
  groundPad(2290, 2326, GLACIS, 10);        // up onto the gatehouse turret
  g(2326, GLACIS);
  // The town's terraces.
  slope(3200, GLACIS, 3300, -750);
  slope(3750, -750, 3850, -850);
  slope(4150, -850, 4250, -950);
  groundPad(4310, 4346, -950, 10);         // up onto the inner gatehouse turret
  g(4346, -950);
  slope(4900, -950, 5050, WARD);

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
  // The ends of the world: too tall to jump or jetpack over from anywhere near them.
  m.box(-40, -900, 0, BASE);
  m.box(W, -2100, W + 40, BASE);

  // ---- The landing (x 0-700) -----------------------------------------------------------------
  // Landing craft: hull, wheelhouse and the lowered bow.
  m.box(80, 30, 300, SEA);  m.box(80, -20, 120, 30);  bags(284, 300, 30);
  m.box(350, 30, 500, SEA); m.box(350, -20, 390, 30); bags(484, 500, 30);

  // ---- Sector 1: the beach defences (x 700-1700) ---------------------------------------------
  bags(860, 890, 0, 30); bags(1020, 1050, 0, 30); bags(1160, 1190, 0, 30);   // hedgehogs
  m.box(1480, -45, 1520, 0);               // casemate: a step up to the stairwell
  bags(1290, 1310, -120);                  // dune parapet
  // The gun bunker on the dune, against the cliff (the cave opens at its back); a jump pad
  // in its roof flings you up the cliff.
  m.box(1560, -215, 1590, -170);           // west wall over the door
  slab(1560, 1600, -240, 25); m.pad(1600, 1640, -240, 11); m.box(1600, -228, 1640, -215);
  slab(1640, 1700, -240, 25);
  // The smugglers' shaft: ledges to climb.
  slab(1960, 1995, -250); slab(2005, 2040, -380); slab(1960, 1995, -510);

  // ---- Sector 2: the outer wall (x 2050-2880) ----------------------------------------------
  m.box(2190, -600, 2215, -550);           // sally tunnel steps
  m.box(2675, -600, 2700, -550);
  bags(2110, 2130, GLACIS, 26);            // a broken cart on the glacis
  gatehouse(2350, 2560, GLACIS, 2500);
  // The armoury in the outer bailey.
  m.box(2730, -770, 2750, -700);
  slab(2730, 2880, -790);

  // ---- Sector 3: the lower town (x 2880-4380) -------------------------------------------------
  // A house on the first terrace.
  slab(2920, 3070, -780); slab(2980, 3130, -910);
  m.box(2920, -830, 2938, -780);
  bags(3150, 3180, GLACIS, 30);            // cart
  bags(3390, 3420, -750, 26);              // the market fountain
  // The town hall: door, a hole up to the council chamber, roof and clock tower.
  m.box(3530, -860, 3550, -800);
  slab(3530, 3700, -880);
  slab(3560, 3750, -1010);
  m.box(3640, -1090, 3680, -1010);         // clock tower...
  slab(3680, 3770, -1210);                 // ...and its gallery
  // The cathedral: door, gallery, roof with a gable, and the scaffold bridge to the inner wall.
  m.box(3880, -1080, 3906, -900);
  slab(3906, 4020, -980);
  slab(3880, 4150, -1100);
  slab(3950, 4090, -1180);
  slab(4190, 4340, -1150, 14);             // scaffold

  // ---- The inner gatehouse (x 4380-4620) -------------------------------------------------------
  gatehouse(4380, 4620, -950, 4540);

  // ---- Sector 4: the upper ward and the keep (x 4620-6400) -------------------------------------
  slab(4680, 4870, -1080); slab(4710, 4900, -1210);   // barracks
  bags(5150, 5180, WARD, 30);              // a water trough
  // The siege tower against the keep: up to the breach in the keep's third floor.
  slab(5330, 5420, -1230); slab(5290, 5370, -1360); slab(5350, 5450, -1490);
  // The keep: a door and windows facing the town, three floors, the roof and turret.
  m.box(5450, -1250, 5490, -1150);         // over the door
  m.box(5450, -1376, 5490, -1250);         // first floor wall, window above
  m.box(5450, -1550, 5490, -1402);         // second floor wall (the breach is above it)
  m.box(5450, -1700, 5490, -1610);         // third floor wall
  slab(5490, 6060, -1250); slab(6110, 6150, -1250);
  bags(6080, 6130, WARD, 50);              // crate under the first stair hole
  slab(5540, 6150, -1400);
  bags(5495, 5545, -1250, 50);             // crate under the second stair hole
  slab(5490, 6060, -1550); slab(6110, 6190, -1550);
  bags(6075, 6125, -1400, 50);             // crate under the third stair hole
  slab(5450, 6110, -1700);                 // roof
  bags(5450, 5470, -1700, 26); bags(5640, 5660, -1700, 26);   // battlements
  slab(5990, 6110, -1830); slab(6030, 6110, -1960);   // turret
  // Red's courtyard: the stable (red flag underneath).
  slab(6230, 6400, -1230);

  // ---- Objectives ---------------------------------------------------------------------------
  m.flag(1, 760, 0);
  m.flag(2, 6320, WARD);
  m.mcom(1, 1380, 0);
  m.mcom(1, 1650, -120);
  m.mcom(2, 2420, -750);
  m.mcom(2, 2810, GLACIS);
  m.mcom(3, 3620, -750);
  m.mcom(3, 3960, -850);
  m.mcom(4, 5700, WARD);
  m.mcom(4, 5800, -1550);
  m.point('A', 960, 1200, 0, 120);
  m.point('B', 2000, 2190, GLACIS, 120);
  m.point('C', 3300, 3500, -750, 120);
  m.point('D', 4230, 4450, -950, 120);
  m.point('E', 5190, 5410, WARD, 120);
  m.hill(2400, 2560, -900, 100);
  m.hill(3300, 3500, -750, 100);
  m.hill(3920, 4140, -1100, 100);

  // ---- Spawns ---------------------------------------------------------------------------------
  // Bases (every mode but Rush): blue on the landing craft, red in the keep and courtyard.
  for (const x of [140, 180, 220, 260, 410, 440, 470]) m.spawn(x, 30, 1);
  for (const x of [20, 50, 320, 520]) m.spawn(x, SEA, 1);
  for (const x of [100, 370]) m.spawn(x, -20, 1);
  for (const x of [600, 650, 700]) m.spawn(x, x < 640 ? 30 : x < 680 ? 20 : 0, 1);
  for (const x of [6180, 6220, 6260, 6300, 6360]) m.spawn(x, WARD, 2);
  for (const x of [6260, 6320, 6380]) m.spawn(x, -1230, 2);
  for (const x of [5950, 6020]) m.spawn(x, WARD, 2);
  for (const x of [5900, 6000]) m.spawn(x, -1250, 2);
  for (const x of [5900, 6000]) m.spawn(x, -1400, 2);
  m.spawn(6150, -1550, 2);
  // Rush, sector 1: blue on the boats and the sand; red at the top of the cliff.
  for (const x of [400, 450, 600, 650, 700, 740]) m.spawn(x, x < 500 ? 30 : x < 640 ? 30 : x < 680 ? 20 : 0, 1, 1);
  for (const x of [1940, 2060, 2100, 2150, 2170]) m.spawn(x, GLACIS, 2, 1);
  m.spawn(1920, GLACIS, 2, 1);
  // Sector 2: blue on the dune; red on the first terrace of the town.
  for (const x of [1330, 1400, 1550, 1600]) m.spawn(x, -120, 1, 2);
  m.spawn(1730, -250, 1, 2); m.spawn(1790, -380, 1, 2);
  for (const x of [3320, 3360, 3460, 3500]) m.spawn(x, -750, 2, 2);
  for (const x of [3440, 3480]) m.spawn(x, -750, 2, 2);
  // Sector 3: blue in the outer bailey; red behind the inner gate.
  for (const x of [2580, 2620, 2780, 2840]) m.spawn(x, GLACIS, 1, 3);
  for (const x of [2560, 2590]) m.spawn(x, -750, 1, 3);
  for (const x of [4640, 4700, 4760, 4820]) m.spawn(x, -950, 2, 3);
  for (const x of [4730, 4800]) m.spawn(x, -1080, 2, 3);
  // Sector 4: blue in the inner gatehouse and the town; red in the courtyard.
  for (const x of [4280, 4400, 4460, 4580]) m.spawn(x, -950, 1, 4);
  for (const x of [4450, 4600]) m.spawn(x, -1050, 1, 4);
  for (const x of [6180, 6230, 6290, 6350]) m.spawn(x, WARD, 2, 4);
  for (const x of [6290, 6360]) m.spawn(x, -1230, 2, 4);

  // ---- Items ------------------------------------------------------------------------------------
  // The landing.
  m.item('M4', 200, 30); m.item('Shotgun', 250, 30); m.item('health', 420, 30); m.item('armour', 100, -20);
  m.item('jetpack', 370, -20); m.item('jetpack', 30, SEA); m.item('NinjaRope', 540, 80);
  m.item('GrenadeLauncher', 460, 30); m.item('M4', 660, 20);
  // The beach.
  m.item('health', 950, 0); m.item('Bazooka', 1035, -30); m.item('Shotgun', 1180, -30);
  m.item('Flamer', 1330, 0); m.item('health', 1430, 0); m.item('M4', 1340, -120);
  m.item('Minigun', 1620, -240); m.item('health', 1660, -120); m.item('GrenadeLauncher', 1800, -120);
  m.item('M4', 1730, -250); m.item('health', 2020, -120);
  // The glacis and outer wall.
  m.item('SR', 2380, -1000); m.item('health', 2080, GLACIS); m.item('M4', 2150, GLACIS);
  m.item('armour', 2450, -1000); m.item('Shotgun', 2460, -750); m.item('Mortar', 2540, -900);
  m.item('health', 2440, -550); m.item('Dynamite', 2560, -550);
  m.item('M4', 2700, GLACIS); m.item('health', 2850, GLACIS); m.item('armour', 2800, -790);
  // The town.
  m.item('Shotgun', 3000, -780); m.item('health', 3060, -910); m.item('M4', 3150, -680);
  m.item('jetpack', 3405, -776); m.item('HolyHandGrenade', 3460, -750);
  m.item('health', 3620, -880); m.item('M4', 3700, -1010); m.item('SR', 3740, -1210);
  m.item('GrenadeLauncher', 3800, -800); m.item('armour', 3960, -980); m.item('health', 4050, -850);
  m.item('Bazooka', 4020, -1180); m.item('NinjaRope', 4260, -1150); m.item('M4', 4200, -900);
  // The inner gatehouse and the upper ward.
  m.item('health', 4480, -950); m.item('Minigun', 4440, -1200); m.item('Shotgun', 4560, -1050);
  m.item('M4', 4780, -1080); m.item('health', 4800, -1210); m.item('Mine', 4950, -1000);
  m.item('AirStrike', 5170, -1130); m.item('health', 5380, -1230); m.item('Flamer', 5330, -1360);
  // The keep and courtyard.
  m.item('M4', 5600, WARD); m.item('health', 5900, WARD); m.item('Shotgun', 5700, -1250);
  m.item('armour', 5800, -1400); m.item('health', 5600, -1550); m.item('GrenadeLauncher', 6000, -1550);
  m.item('SR', 5550, -1700); m.item('Bazooka', 6070, -1960);
  m.item('M4', 6200, WARD); m.item('health', 6260, WARD); m.item('jetpack', 6380, WARD);
  m.item('jetpack', 6300, -1230); m.item('armour', 6380, -1230); m.item('NinjaRope', 6160, -1550);
  return m;
}
