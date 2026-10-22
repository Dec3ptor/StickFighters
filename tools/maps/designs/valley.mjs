// Valley: rolling farmland on both sides of a river gorge. From each team's
// hilltop outpost (a bunker, a watchtower and a garage dug into the hill) the
// ground steps down past a farmhouse, over a windmill hill with a cave through
// it, across a meadow and over a long ridge with a cavern under it, to the
// river bank. The gorge in the middle is crossed by a hump-backed bridge under
// a tall radio tower, or lower down on stepping stones (miss one and you
// drown). No slopes: hills are terraces of 10 px steps you walk up, plus
// rock ledges you jump.
//
// Built for Conquest first (A farmhouse, B windmill, C cavern, D bridge,
// E cavern, F windmill, G farmhouse); mirror-symmetric, so every mode is fair
// except Rush, where blue attacks across the river towards red's outpost.
import { MapBuilder } from '../lib.mjs';

export const info = { modes: ['conquest', 'rush', 'koth', 'ctf', 'team', 'ffa'], size: 'large', players: '16-64' };

const BED = 700;      // bottom of the ground
const GORGE = 700;    // bottom of the gorge walls (the lowest content)

export default function () {
  const m = new MapBuilder('Valley');

  // Ground from a list of [x, y] points (left to right): flat where y stays the
  // same, 10 px steps where it changes, a cliff where x repeats. A third value
  // sets the bottom of the ground from that point on (to leave a cave below).
  const ground = (pts, bottom = BED) => {
    let bot = bottom;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0, b] = pts[i], [x1, y1] = pts[i + 1];
      if (b !== undefined) bot = b;
      if (x0 === x1) continue;
      if (y0 === y1) { m.box(x0, y0, x1, bot); continue; }
      const n = Math.max(1, Math.round(Math.abs(y1 - y0) / 10)), w = (x1 - x0) / n;
      for (let k = 0; k < n; k++) m.box(x0 + k * w, y0 + ((y1 - y0) * (k + 1)) / n, x0 + (k + 1) * w, bot);
    }
  };
  const ledge = (l, r, y, t = 20) => { m.box(l, y, r, y + t); };

  // ---- Blue's outpost on the hilltop (x -3930 .. -3330) ----------------------------------
  // A garage dug into the hill at farm level, the plateau on top of it with a
  // bunker and a watchtower. Every climb up here is about 70 px: a jump.
  const BASE = -300, FARM = -180;
  m.box(-3960, BASE - 140, -3930, BED);                 // the valley's end
  m.box(-3930, BASE, -3500, BASE + 24).box(-3440, BASE, -3330, BASE + 24); // plateau (hatch in it)
  ledge(-3330, -3270, FARM - 75, 16);                    // a step up from the farm onto the plateau
  // Bunker: two storeys, each reached by a jump to a shelf and another off it.
  const B2 = BASE - 140, BR = BASE - 280;
  m.box(-3850, BR + 20, -3826, BASE - 70).box(-3624, BR + 20, -3600, BASE - 70);
  ledge(-3660, -3624, BASE - 70, 16);                    // shelf up to the first floor
  m.floor(-3826, -3680, B2);
  ledge(-3826, -3790, B2 - 70, 16);                      // shelf up to the roof
  m.floor(-3760, -3590, BR);
  m.box(-3610, BR - 30, -3590, BR);                     // sandbags on the roof
  // Watchtower: four ledges in a zig-zag.
  ledge(-3380, -3340, BASE - 70, 16);
  ledge(-3480, -3380, BASE - 140);
  ledge(-3500, -3460, BASE - 210, 16);
  ledge(-3430, -3360, BASE - 280);

  // ---- Farm (x -3330 .. -2640) and the farmhouse (A) ------------------------------------
  ground([[-3930, FARM], [-2640, FARM], [-2480, -80], [-2400, -80]]);
  const H2 = FARM - 140, EAVES = FARM - 280;
  m.box(-3060, EAVES, -3040, H2 - 70).box(-3060, H2, -3040, FARM - 70);   // left wall, window upstairs
  m.box(-2800, EAVES, -2780, H2 - 70).box(-2800, H2, -2780, FARM - 70);   // right wall
  m.floor(-3040, -2880, H2);
  ledge(-2860, -2800, FARM - 75, 16);                    // shelves inside: up to the first floor...
  ledge(-3040, -3000, H2 - 70, 16);                      // ...and from it up to the eaves
  m.floor(-2980, -2760, EAVES, 16);
  m.box(-2960, EAVES - 40, -2800, EAVES).box(-2920, EAVES - 80, -2840, EAVES - 40);
  m.box(-2900, EAVES - 120, -2876, EAVES - 80);          // chimney
  m.box(-3220, FARM - 30, -3170, FARM).box(-2720, FARM - 30, -2670, FARM); // hay bales

  // ---- Windmill hill (B), with a cave through it (x -2400 .. -1800) ----------------------
  const CV = -20, HILL = -330;
  m.box(-2400, CV, -1560, BED);                          // cave floor, on to the meadow
  m.box(-2400, CV - 40, -2370, CV);                      // a rock to climb out of the sinkhole
  // From the sinkhole: a jump onto the hill's lip, steps, then an 80 px rock face.
  // Towards the meadow the steps go all the way down to the ledge over the cave mouth.
  ground([[-2330, -150, -140], [-2250, -250], [-2230, -250], [-2230, HILL], [-1960, HILL], [-1800, -170]]);
  ledge(-1800, -1730, -95);                              // rock ledge over the cave mouth
  // The windmill.
  const W2 = HILL - 140, W3 = HILL - 280;
  m.box(-2195, W2, -2160, HILL - 70).box(-2020, W2, -1985, HILL - 70);   // walls, narrower upstairs
  m.box(-2175, W3, -2150, W2).box(-2030, W3, -2005, W2);
  ledge(-2080, -2050, HILL - 70, 16);                    // shelves up to each floor
  m.floor(-2150, -2080, W2);
  ledge(-2150, -2110, W2 - 70, 16);
  m.floor(-2100, -2020, W3);
  m.floor(-2410, -2180, W3, 12).floor(-2000, -1770, W3, 12);   // the sails
  ledge(-2260, -2210, W3 - 70, 16); ledge(-1970, -1920, W3 - 70, 16); // ledges off the sails up to the cap
  m.box(-2200, W3 - 130, -1980, W3 - 110).box(-2150, W3 - 160, -2030, W3 - 130); // cap
  m.box(-2096, W3 - 300, -2084, W3 - 160);               // the upper sail
  m.pad(-2470, -2430, -80, 12, 12);                      // jump pads up to the sails
  m.pad(-1700, -1670, CV, 12, 12);

  // ---- Meadow (x -1800 .. -1560) and the ridge with the cavern (C) under it --------------
  const CH = 60, RIDGE = -380;
  m.box(-1560, CV, -1440, BED);
  ground([[-1440, CV], [-1360, CH], [-960, CH], [-880, CV], [-760, CV], [-560, 40]]);
  ground([[-1560, -170, -160], [-1440, -320], [-1360, -320], [-1300, RIDGE], [-1170, RIDGE]]);
  ground([[-1080, RIDGE, -160], [-960, RIDGE], [-900, -320], [-760, -180]]);
  ledge(-1630, -1560, -100);                             // rock ledges up the ridge's ends (80 px jumps)
  ledge(-760, -690, -100);
  // The shaft from the ridge top down into the cavern: ledges 70-75 px apart.
  ledge(-1170, -1130, -15); ledge(-1120, -1080, -90); ledge(-1170, -1130, -160);
  ledge(-1120, -1080, -235); ledge(-1170, -1130, -305);
  m.box(-1240, CH - 50, -1200, CH).box(-1060, CH - 30, -1020, CH);  // rocks in the cavern

  // ---- River bank and the gorge (x -560 .. 0) ----------------------------------------------
  const DECK = -100;
  m.box(-560, 40, -400, GORGE);
  // Stepping down into the gorge, 75 px at a time, so you can climb back out.
  m.box(-400, 115, -340, 139);                           // a ledge on the bank...
  m.box(-280, 190, -220, GORGE);                         // ...rocks in the river...
  m.box(-150, 265, -90, GORGE);
  m.box(-40, 340, 40, GORGE);
  // The bridge, high over the gorge, and a rock to climb up to it.
  m.box(-460, DECK, 460, DECK + 24);
  m.box(-470, DECK + 24, -440, DECK + 60).box(-440, DECK + 24, -420, DECK + 44); // its ends
  ledge(-560, -490, -30);
  m.box(-400, DECK + 24, -330, DECK + 50).box(-400, DECK + 50, -370, DECK + 80); // the arch's springing
  // The radio tower over the bridge: ledges 80 px apart in a zig-zag (pairs, then
  // one in the middle), a top platform and an aerial; mirror() adds the right-hand ledges.
  for (let i = 0; i < 11; i++) {
    const y = DECK - 80 * (i + 1);
    if (i % 2 === 0) ledge(-120, -50, y, 16);
    else ledge(-35, 35, y, 16);
  }
  const TOP = DECK - 960;
  ledge(-70, 70, TOP, 20);
  m.box(-4, TOP - 140, 4, TOP);
  m.box(-148, TOP + 80, -140, DECK - 100);                // the tower's frame

  // ---- Spawns, items, flags (blue; mirrored for red) -----------------------------------
  for (const x of [-3900, -3860, -3810, -3760, -3710, -3660, -3610, -3560, -3420, -3380]) m.spawn(x, FARM, 1);
  for (const x of [-3900, -3870, -3560, -3540]) m.spawn(x, BASE, 1);
  for (const x of [-3790, -3700]) m.spawn(x, BASE, 1);
  for (const x of [-3770, -3720]) m.spawn(x, B2, 1);
  for (const x of [-3700, -3650]) m.spawn(x, BR, 1);
  m.flag(1, -3520, BASE);
  m.item('M4', -3640, FARM).item('health', -3880, FARM).item('jetpack', -3480, FARM).item('Shotgun', -3740, BASE);
  m.item('armour', -3720, BR).item('GrenadeLauncher', -3400, BASE - 280).item('jetpack', -3700, B2);
  m.item('Shotgun', -2920, FARM).item('M4', -2960, H2).item('health', -3250, FARM).item('armour', -2880, EAVES - 80);
  m.item('health', -2300, CV).item('Flamer', -2000, CV).item('SR', -2120, W3 - 160).item('health', -2090, HILL);
  m.item('Bazooka', -1630, CV).item('jetpack', -1600, CV).item('M4', -2120, W2);
  m.item('HolyHandGrenade', -1100, CH).item('health', -1300, CH).item('Shotgun', -820, CV).item('NinjaRope', -1230, RIDGE);
  m.item('health', -450, 40).item('M4', -520, -30).item('jetpack', -620, 40 - 10);
  m.item('Minigun', 0, DECK).item('AirStrike', 0, TOP).item('armour', 0, 340);

  m.mirror(0);

  // ---- Objectives -------------------------------------------------------------------------
  m.point('A', -3040, -2800, FARM, 155);
  m.point('B', -2230, -1960, HILL, 140);
  m.point('C', -1290, -1030, CH, 140);
  m.point('D', -130, 130, DECK, 120);
  m.point('E', 1030, 1290, CH, 140);
  m.point('F', 1960, 2230, HILL, 140);
  m.point('G', 2800, 3040, FARM, 155);
  m.hill(-110, 110, DECK, 100);
  m.hill(-1330, -1180, RIDGE, 100);
  m.hill(1180, 1330, RIDGE, 100);

  // Rush: blue attacks from the left, four sectors.
  m.mcom(1, -1250, CH).mcom(1, -1000, RIDGE);
  m.mcom(2, 0, DECK).mcom(2, 480, 40);
  m.mcom(3, 2090, HILL).mcom(3, 1680, CV);
  m.mcom(4, 2920, FARM).mcom(4, 3420, FARM);
  const rush = (team, sector, list) => { for (const [x, y] of list) m.spawn(x, y, team, sector); };
  rush(1, 1, [[-2215, HILL], [-2195, HILL], [-2140, HILL], [-2040, HILL], [-1975, HILL]]);
  rush(2, 1, [[-480, 40], [-460, 40], [-440, 40], [-425, 40], [-410, 40]]);
  rush(1, 2, [[-880, CV], [-840, CV], [-800, CV], [-780, CV], [-775, -200]]);
  rush(2, 2, [[1100, -380], [1140, -380], [1300, -380], [1330, -380], [1380, -320]]);
  rush(1, 3, [[765, -180], [795, -220], [800, CV], [840, CV], [880, CV]]);
  rush(2, 3, [[2740, FARM], [2760, FARM], [3100, FARM], [3130, FARM], [3150, FARM]]);
  rush(1, 4, [[2240, -250], [2260, -250], [2250, CV], [2300, CV], [2350, CV]]);
  rush(2, 4, [[3600, BASE], [3640, BASE], [3860, BASE], [3900, BASE], [3880, FARM]]);
  // A hammer for anyone to build with (near the middle).
  m.item('Hammer', -6, -260);
  return m;
}
