// Foundry: an industrial hall, built for Conquest. Steel catwalks on four tiers
// (ground 0, mid -260, high -520, crane -780), furnaces as cover, molten pits you
// jump (or fall into), and a central crucible pit crossed only by the catwalk
// junction (point C), with updraft pads up to the crane cab.
// A jump climbs about 97 px, so the half-tier climbs (130 px) go by way of
// freight crates 60-70 px high, set where there's headroom to jump from them.
// Blue's half is built, then mirrored for red.
import { MapBuilder, T } from '../lib.mjs';

export const info = { modes: ['conquest', 'ctf', 'koth', 'rush', 'team', 'ffa'], size: 'medium', players: '8-24' };

export default function () {
  const m = new MapBuilder('Foundry');

  // ---- Frame -----------------------------------------------------------------
  m.box(-1940, -780, -1900, 40);          // the hall's end wall
  m.floor(-1900, -880, 0, 40);            // ground: base, furnace room A
  m.floor(-760, -220, 0, 40);             // ground between the side pit and the crucible
  m.box(-904, -32, -880, 0);              // curbs at the side pit (-880..-760: a running jump across)
  m.box(-760, -32, -736, 0);
  m.box(-470, -40, -220, 0);              // conveyor feeding the crucible (-220..220)

  // ---- Blue base: a loading-dock tower (x -1900..-1580) ---------------------------------
  m.pad(-1896, -1860, -12, 12);           // freight lift up the back wall (to b1-b4)
  m.floor(-1856, -1600, -130);            // b1
  m.floor(-1856, -1660, -260);            // b2 (flag), level with the mid tier
  m.floor(-1856, -1660, -520);            // b4, level with the high tier
  m.floor(-1856, -1720, -390);            // b3
  m.floor(-1640, -1580, -390);            // stair landings up the front
  m.floor(-1640, -1580, -650);
  // freight crates, a jump (60-70 px) each, up the front of the tower:
  m.box(-1590, -70, -1550, 0);            // ground -> b1, and on over the furnace to room A
  m.box(-1530, -325, -1500, -260);        // room roof -> landing (-390)
  m.box(-1640, -455, -1615, -390);        // landing -> b4 / the high catwalk
  m.box(-1720, -585, -1690, -520);        // b4 -> landing (-650)
  m.box(-1610, -715, -1580, -650);        // landing -> the roof / the furnace house's roof
  m.floor(-1900, -1660, -780);            // roof
  m.box(-1940, -1300, -1800, -780);       // smokestack
  m.pad(-1796, -1756, -792, 11);          // pad up to the top of the stack
  m.box(-1940, -1330, -1916, -1300);      // lip at the top of the stack
  m.box(-1860, -10, -1620, 0);            // loading-dock conveyor (low enough to walk onto), on up to the lift

  // ---- Furnace room A (x -1560..-980) -------------------------------------------------
  m.floor(-1580, -1300, -260);            // room roof (mid tier), hole over the point
  m.floor(-1160, -620, -260);             // ...and on over the side pit
  m.box(-1500, -130, -1400, 0);           // furnace
  m.box(-1510, -236, -1390, -200);        // ...and its hood
  m.box(-1300, -130, -1240, 0);           // furnace under the roof hole
  m.box(-1400, -65, -1300, 0);            // charging bed between the furnaces (a step up onto either)
  m.box(-1240, -65, -1210, 0);            // ingot stack: ground -> the furnace under the hole
  m.floor(-1190, -1160, -195);            // ledge in the roof hole: that furnace -> the room roof
  m.box(-1080, -32, -1040, 0);            // low crate (cover)
  m.box(-1000, -236, -976, -100);         // doorway lintel on the pit side
  m.box(-800, -292, -770, -260);          // crates on the catwalks (cover)
  m.box(-1460, -585, -1430, -520);        // ...this one a step up to the skylight ledge
  // the furnace house's roof (top tier), with a skylight to climb through
  m.floor(-1560, -1400, -780);
  m.floor(-1300, -900, -780);
  m.floor(-1380, -1320, -650);            // ledge up to the skylight
  m.box(-1350, -715, -1320, -650);        // ...and a crate on it, up through the skylight
  m.box(-1180, -812, -1140, -780);        // roof vents (cover)
  m.box(-1000, -812, -960, -780);

  // ---- High tier (-520) and B (crane control) -----------------------------------
  m.floor(-1580, -1020, -520);            // high catwalk over A
  m.floor(-1440, -1380, -390);            // perch under the high catwalk...
  m.box(-1380, -325, -1350, -260);        // ...up from a crate on the room roof
  m.floor(-980, -900, -390);              // valve ledge: mid <-> high, and on to B
  m.box(-1010, -325, -985, -260);         // crate on the room roof: up to the valve ledge
  m.box(-930, -455, -900, -390);          // valve: up to B (and the end of the high catwalk)
  m.floor(-880, -580, -520);              // B: crane control cabin floor
  m.floor(-840, -620, -650);              // cabin roof (dropped onto from the crane rail)
  m.box(-800, -715, -775, -650);          // crate: from the cabin roof back up to the crane rail

  // ---- Centre -----------------------------------------------------------------------
  m.steps(-660, -65, 3, 50, -65, 50);     // stairs from the ground up toward C
  m.floor(-470, 470, -260);               // C: catwalk junction over the crucible
  m.floor(-540, -440, -390);              // ledge from C up to the high tier...
  m.box(-440, -325, -410, -260);          // ...by a crate on C
  m.box(-540, -455, -510, -390);          // ...and a crate on the ledge, up to B
  m.floor(-760, -280, -780);              // crane rail
  m.box(-344, -756, -336, -690);          // crane hook over C: chain...
  m.box(-344, -690, -264, -674);          // ...and hook (a perch to drop onto C from)
  m.box(-170, -292, -140, -260);          // crates on C (cover)
  m.box(-160, -900, 160, -840);           // crane cab (top)
  m.pad(-240, -200, -272, 12);            // updraft from C to the crane

  // ---- Items, spawns, flag (blue half) -------------------------------------------
  for (const [x, y] of [[-1820, 0], [-1760, 0], [-1700, 0], [-1640, 0], [-1800, -130], [-1700, -130],
    [-1780, -260], [-1700, -260], [-1800, -390], [-1760, -520], [-1810, -520], [-1720, -780]]) m.spawn(x, y, 1);
  m.flag(1, -1830, -260);
  m.item('M4', -1660, -130);
  m.item('health', -1760, -390);
  m.item('Shotgun', -1200, 0);
  m.item('armour', -1450, -130);
  m.item('GrenadeLauncher', -1400, -260);
  m.item('health', -940, -390);
  m.item('SR', -730, -650);
  m.item('Flamer', -500, 0);
  m.item('M4', -1200, -520);
  m.item('jetpack', -1870, -1300);
  m.item('Bazooka', 0, -900);
  m.item('Minigun', 0, -260);

  m.mirror(0);

  // ---- Objectives ---------------------------------------------------------------
  m.point('A', -1380, -1140, 0, 130);
  m.point('B', -840, -620, -520, 120);
  m.point('C', -130, 130, -260, 120);
  m.point('D', 620, 840, -520, 120);
  m.point('E', 1140, 1380, 0, 130);
  m.hill(-110, 110, -900, 90);
  m.hill(-560, -380, 0, 90);              // by the conveyors at the crucible's edge
  m.hill(380, 560, 0, 90);
  // Rush: blue attacks left to right.
  m.mcom(1, -720, -520); m.mcom(1, -560, 0);
  m.mcom(2, 300, -260); m.mcom(2, 560, 0);
  m.mcom(3, 1200, 0); m.mcom(3, 1700, -520);
  for (const x of [-1820, -1760, -1700, -1640]) m.spawn(x, 0, 1, 1);
  for (const x of [-100, -40, 40, 100]) m.spawn(x, -260, 2, 1);
  for (const x of [-760, -700, -640, -600]) m.spawn(x, -520, 1, 2);
  for (const x of [1080, 1320, 1420, 1490]) m.spawn(x, -260, 2, 2);
  for (const x of [250, 300, 350, 390]) m.spawn(x, -260, 1, 3);
  for (const x of [1820, 1760, 1700, 1640]) m.spawn(x, 0, 2, 3);
  // Hammers and jetpacks, for getting past what's in the way (a hole blown in a floor, a
  // ledge too high to jump to): one a few seconds from anywhere.
  m.item('Hammer', -194, -260).item('Hammer', 194, -260);
  m.item('Hammer', -1121, 0).item('Hammer', 1121, 0);
  m.item('jetpack', -730, 0).item('jetpack', 730, 0);
  m.item('Hammer', -1531, 0).item('Hammer', 1531, 0);
  return m;
}
