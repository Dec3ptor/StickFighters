// Harbor: a container port seen from the side. Each team's ro-ro ship is
// moored at its end of the map (vehicle deck, hold, main deck, a bridge tower
// with a funnel), a warehouse with two upper floors stands on the quay in
// front of it, then a container yard, a water slip (deadly) crossed by a
// broken pontoon and a high catwalk, and a big gantry crane straddles the
// middle yard with its boom high overhead (sniper perch, reached by the leg
// ladders, the machinery house and jump pads).
//
// Built for Conquest first (A blue ship, B blue containers, C crane yard,
// D red containers, E red ship); mirror-symmetric, so every mode is fair
// except Rush, where blue attacks from its ship towards the red one.
import { MapBuilder, T } from '../lib.mjs';

export const info = { modes: ['conquest', 'rush', 'ctf', 'koth', 'team', 'ffa'], size: 'large', players: '16-64' };

const BOT = 200;      // bottom of the quays and hulls (the lowest content)
const CH = 70;        // a shipping container's height

export default function () {
  const m = new MapBuilder('Harbor');

  // A solid container (or a stack of n) standing on floorY.
  const stack = (l, r, floorY, n = 1) => {
    for (let i = 0; i < n; i++) m.box(l, floorY - CH * (i + 1), r, floorY - CH * i);
  };
  // An open-ended container you can walk through (floor plate, roof, door lintels).
  const tunnel = (l, r, floorY) => {
    m.box(l, floorY - 8, r, floorY);
    m.box(l, floorY - CH, r, floorY - CH + 14);
    // (Lintels thin enough to leave a soldier stepping onto the floor plate some headroom.)
    m.box(l, floorY - CH + 14, l + 10, floorY - CH + 20);
    m.box(r - 10, floorY - CH + 14, r, floorY - CH + 20);
  };

  // ---- Blue's ship (x -3700 .. -2400) ----------------------------------------------
  const SH = { stern: -3700, bow: -2400 };
  const VD = -40, MD = -180, FC = -260, HOLD = 110;     // vehicle deck, main deck, forecastle, hold floor
  m.box(SH.stern, -600, SH.stern + 40, 130);           // stern plate, up to the bridge roof
  // The hull's underside rises towards the stern and the raked bow.
  m.box(-3660, HOLD, -2620, 150);                      // hold floor
  m.box(-3630, 150, -2660, 180).box(-3560, 180, -2740, BOT);
  m.box(-2620, VD + T, -2540, 150).box(-2540, VD + T, -2480, 100).box(-2480, VD + T, -2440, 40);
  // Vehicle deck, with two hatches down into the hold.
  m.floor(-3660, -3240, VD).floor(-3170, -2860, VD).floor(-2790, -2440, VD);
  // Crates in the hold under the hatches (climb back out), and some cover.
  m.box(-3230, HOLD - 70, -3180, HOLD).box(-2850, HOLD - 70, -2800, HOLD);
  m.box(-3520, HOLD - 32, -3470, HOLD).box(-2680, HOLD - 32, -2630, HOLD);
  // Bow ramp (ro-ro door) down onto the quay, over the water.
  for (let i = 0; i < 4; i++) m.floor(-2440 + i * 45, -2395 + i * 45, VD + 10 * (i + 1), 12);
  // Main deck, the forecastle and the bow plate over the bow door.
  m.floor(-3660, -3610, MD).floor(-3550, -3010, MD).floor(-2940, -2440, MD);
  m.box(-3020, MD + 70, -2960, MD + 82);               // landing under the midship hatch
  m.floor(-2720, -2400, FC);
  m.box(-2440, FC + T, -2400, VD - 70);
  // Cargo on deck: cover.
  m.box(-3180, MD - 32, -3120, MD).box(-2860, MD - 32, -2800, MD);
  // Bridge tower at the stern: its levels are 140 apart, so each has a 70 px step
  // up to the next (a jump climbs about 97).
  const L1 = -320, L2 = -460, RF = -600;
  m.box(-3650, MD + 70, -3590, MD + 82);               // landing under the tower hatch
  m.floor(-3660, -3430, L1);
  m.floor(-3580, -3290, L2);
  m.floor(-3660, -3430, RF);
  m.box(-3364, L1, -3340, MD - 70);                    // lintel over the bridge door
  m.box(-3364, RF, -3340, L2 - 70);                    // wheelhouse wall above the windows
  m.box(-3425, MD - 70, -3395, MD);                    // step: main deck up to L1 (inside the door)
  m.box(-3660, L1 - 70, -3630, L1);                    // step: L1 up to L2 (by the stern plate)
  m.box(-3425, L2 - 70, -3400, L2);                    // chart table: L2 up to the wheelhouse roof
  m.box(-3600, RF - 140, -3500, RF);                   // funnel (sniper perch)
  m.box(-3630, RF - 70, -3600, RF).box(-3500, RF - 70, -3470, RF); // and steps up to it on each side
  m.box(-3330, L2 + T + 16, -3250, L2 + T + 46);       // lifeboat under the bridge wing
  m.box(-2620, FC - 140, -2530, FC - 124);             // crow's nest over the forecastle
  m.box(-2700, FC - 70, -2670, FC);                    // a ventilator to climb up to it
  m.box(-2579, FC - 220, -2571, FC - 140);             // and its mast

  // ---- The water at the bow and the warehouse (x -2260 .. -1700) --------------------
  const W = { l: -2260, r: -1700 };
  const F1 = -130, F2 = FC, ROOF = -400;
  m.box(W.l, 0, -1020, BOT);                           // quay
  m.floor(-2400, W.l, F2, 16);                         // high gangway from the forecastle
  m.box(W.l, F2 + T, W.l + 24, -90);                   // left wall (doors below and above)
  m.box(W.l, ROOF, W.l + 24, F2 - 70);
  // Floors are 130-140 apart, so a crate or step halfway up leads to each.
  m.floor(W.l + 24, -1800, F1);                        // first floor (gap on the right)
  m.box(-1790, -65, -1750, 0);                         // crate in the gap: up to the first floor
  m.floor(W.l + 24, -2140, F2).floor(-2060, W.r, F2);  // second floor (gap for the stairs)
  m.box(-2120, F1 - 65, -2080, F1);                    // stair landing under the gap
  m.floor(W.l, -1810, ROOF).floor(-1750, W.r, ROOF);   // roof (gap on the right)
  m.box(-1800, F2 - 70, -1760, F2);                    // step under the roof gap
  m.box(-2080, ROOF - 60, -1880, ROOF);                // roof ridge
  m.box(W.r - 24, ROOF + T, W.r, F2 - 70);             // right wall: windows on each floor
  m.box(W.r - 24, F2 + T, W.r, F1 - 70);
  m.box(-2200, -32, -2140, 0).box(-1900, F1 - 32, -1850, F1); // crates inside

  // ---- Container yard (x -1700 .. -1020) ----------------------------------------------
  stack(-1690, -1550, 0, 2);
  tunnel(-1500, -1300, 0);
  stack(-1460, -1260, -CH, 1);
  m.box(-1250, -32, -1200, 0);
  tunnel(-1160, -1020, 0);                             // a stack you can walk under, at the water
  stack(-1160, -1020, -CH, 2);

  // ---- The slip (x -1020 .. -820): water, a broken pontoon and a high catwalk -------
  m.floor(-1000, -840, 40, 12);                        // a pontoon (one piece: two left bots stranded at some game speeds)
  m.floor(-1020, -740, -3 * CH, 12);

  // ---- Crane yard (x -820 .. 0) --------------------------------------------------------
  m.box(-820, 0, 0, BOT);                              // quay (to the middle; mirrored)
  // Two walk-through containers from the slip into the crane yard, two more stacked
  // on the first (level with the catwalk), and a crate on the second as a step
  // between them (the yard is a pit otherwise).
  tunnel(-740, -600, 0);
  stack(-740, -600, -CH, 2);
  tunnel(-600, -520, 0);
  m.box(-600, -2 * CH, -575, -CH);
  // Left leg of the gantry crane: a column with ladder rungs on its outer side,
  // zig-zagging 80 px apart from the quay up to the portal beam.
  const BEAM = -640, HOUSE = -780, BOOM = -920;
  m.box(-380, BEAM + 32, -350, -60);
  for (let i = 1; i <= 7; i++) {
    if (i % 2) m.floor(-440, -380, -80 * i, 16);
    else m.floor(-520, -450, -80 * i, 16);
  }
  m.floor(-400, 400, BEAM, 32);                        // portal beam
  m.box(-180, HOUSE, 180, BEAM);                       // machinery house
  // Steps up its side to the hole in the boom (70 px each).
  m.box(-260, BEAM - 70, -230, BEAM).box(-230, HOUSE, -180, BEAM).box(-200, HOUSE - 70, -170, HOUSE);
  // Boom, with holes over the house and over the hanging container.
  m.floor(-1000, -820, BOOM).floor(-760, -260, BOOM).floor(-140, 140, BOOM);
  m.box(-60, BOOM - 140, 60, BOOM);                    // lookout on the boom
  m.box(-90, BOOM - 70, -60, BOOM);                    // a step up to it
  m.box(-30, BOOM - 210, 30, BOOM - 140);              // apex of the A-frame
  m.box(-560, BOOM + T, -470, BOOM + 70);              // operator's cab
  stack(-860, -720, HOUSE + CH, 1);                    // container hanging from the spreader
  m.box(-805, HOUSE - 70, -775, HOUSE);                // the spreader (a step up through the boom's hole)
  m.pad(-720, -684, -3 * CH, 12, 12);                  // pad on the stack, up to the container
  // Centre: a walk-through container and crates.
  tunnel(-90, 90, 0);
  stack(-260, -140, 0, 1);

  // ---- Spawns, items, flags (blue; mirrored for red) -----------------------------------
  for (const x of [-3620, -3540, -3460, -3380, -3300, -3080, -3000, -2920]) m.spawn(x, VD, 1);
  for (const x of [-3600, -3400, -3000, -2700]) m.spawn(x, HOLD, 1);
  for (const x of [-3620, -3460, -3280, -3060]) m.spawn(x, MD, 1);
  for (const x of [-3620, -3500]) m.spawn(x, L1, 1);
  for (const x of [-3480, -3380]) m.spawn(x, L2, 1);
  m.flag(1, -2600, FC);
  m.item('M4', -3400, VD).item('Shotgun', -3350, HOLD).item('health', -2950, HOLD).item('armour', -3550, L2);
  m.item('jetpack', -3550, MD).item('health', -2600, VD).item('SR', -3550, RF - 140);
  m.item('M4', -2000, 0).item('GrenadeLauncher', -1950, F1).item('health', -2200, F2).item('Flamer', -1950, ROOF - 60);
  m.item('NinjaRope', -2300, 0);
  m.item('Shotgun', -1400, 0).item('health', -1150, -3 * CH).item('armour', -1620, -2 * CH).item('M4', -1360, -2 * CH);
  m.item('health', -630, -3 * CH).item('Bazooka', -300, BEAM).item('Uzi', -600, 0).item('jetpack', -940, 40);
  m.item('Minigun', 0, 0).item('SR', 0, BOOM - 210).item('HolyHandGrenade', -700, BOOM);

  m.mirror(0);

  // ---- Objectives -------------------------------------------------------------------------
  m.point('A', -2900, -2660, MD, 130);
  m.point('B', -1540, -1300, 0, 130);
  m.point('C', -130, 130, 0, 130);
  m.point('D', 1300, 1540, 0, 130);
  m.point('E', 2660, 2900, MD, 130);
  m.hill(-110, 110, 0, 100);
  m.hill(-1010, -830, -3 * CH, 100);
  m.hill(830, 1010, -3 * CH, 100);

  // Rush: blue attacks from the left.
  m.mcom(1, -1950, 0).mcom(1, -1400, -8);
  m.mcom(2, 300, 0).mcom(2, 670, -8);
  m.mcom(3, 2000, 0).mcom(3, 2880, VD);
  for (const x of [-3100, -3000, -2900, -2800, -2700, -2600]) m.spawn(x, VD, 1, 1);
  for (const [x, y] of [[-560, -CH], [-540, -CH], [-490, 0], [-430, 0], [-330, 0], [-300, 0]]) m.spawn(x, y, 2, 1);
  for (const [x, y] of [[-800, 0], [-780, 0], [-560, -CH], [-540, -CH], [-490, 0], [-430, 0]]) m.spawn(x, y, 1, 2);
  for (const x of [1960, 2020, 2050, 2140, 2180, 2220]) m.spawn(x, F1, 2, 2); // (clear of the stair landing)
  for (const [x, y] of [[1280, -2 * CH], [1330, -2 * CH], [1400, -2 * CH], [1580, -2 * CH], [1620, -2 * CH], [1660, -2 * CH]]) m.spawn(x, y, 1, 3);
  for (const x of [3620, 3540, 3460, 3380, 3300, 3220]) m.spawn(x, VD, 2, 3);
  // Hammers and jetpacks, for getting past what's in the way (a hole blown in a floor, a
  // ledge too high to jump to): one a few seconds from anywhere.
  m.item('Hammer', -47, -70).item('Hammer', 47, -70);
  m.item('Hammer', -1808, 0).item('Hammer', 1808, 0);
  m.item('Hammer', -2990, -110).item('Hammer', 2990, -110);
  m.item('jetpack', -491, -160).item('jetpack', 491, -160);
  return m;
}
