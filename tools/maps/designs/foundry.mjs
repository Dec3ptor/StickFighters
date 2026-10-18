// Foundry: an industrial hall, built for Conquest. Steel catwalks on four tiers
// (ground 0, mid -260, high -520, crane -780), furnaces as cover, molten pits you
// jump (or fall into), and a central crucible pit crossed only by the catwalk
// junction (point C), with updraft pads up to the crane cab.
// Blue's half is built, then mirrored for red.
import { MapBuilder, T } from '../lib.mjs';

export const info = { modes: ['conquest', 'ctf', 'koth', 'rush', 'team', 'ffa'], size: 'medium', players: '8-24' };

export default function () {
  const m = new MapBuilder('Foundry');

  // ---- Frame -----------------------------------------------------------------
  m.box(-1940, -780, -1900, 40);          // the hall's end wall
  m.floor(-1900, -900, 0, 40);            // ground: base, furnace room A
  m.floor(-740, -220, 0, 40);             // ground between the side pit and the crucible
  m.box(-924, -32, -900, 0);              // curbs at the side pit (-900..-740)
  m.box(-740, -32, -716, 0);
  m.box(-470, -40, -220, 0);              // conveyor feeding the crucible (-220..220)

  // ---- Blue base: a loading-dock tower (x -1900..-1580) ---------------------------------
  m.pad(-1896, -1860, -12, 12);           // freight lift up the back wall
  m.floor(-1856, -1600, -130);            // b1
  m.floor(-1856, -1660, -260);            // b2 (flag), level with the mid tier
  m.floor(-1856, -1660, -520);            // b4, level with the high tier
  m.floor(-1856, -1720, -390);            // b3
  m.floor(-1640, -1580, -390);            // stair landings up the front
  m.floor(-1640, -1580, -650);
  m.floor(-1900, -1660, -780);            // roof
  m.box(-1940, -1300, -1800, -780);       // smokestack
  m.pad(-1796, -1756, -792, 11);          // pad up to the top of the stack
  m.box(-1940, -1330, -1916, -1300);      // lip at the top of the stack
  m.box(-1840, -10, -1620, 0);            // loading-dock conveyor (low enough to walk onto)

  // ---- Furnace room A (x -1560..-980) -------------------------------------------------
  m.floor(-1580, -1300, -260);            // room roof (mid tier), hole over the point
  m.floor(-1160, -620, -260);             // ...and on over the side pit
  m.box(-1500, -130, -1400, 0);           // furnace
  m.box(-1510, -236, -1390, -200);        // ...and its hood
  m.box(-1300, -130, -1240, 0);           // furnace under the roof hole
  m.box(-1400, -10, -1300, 0);            // conveyor between the furnaces
  m.box(-1080, -32, -1040, 0);            // low crate (cover)
  m.box(-1000, -236, -976, -100);         // doorway lintel on the pit side
  m.box(-800, -292, -770, -260);          // crates on the catwalks (cover)
  m.box(-1460, -552, -1430, -520);
  // the furnace house's roof (top tier), with a skylight to climb through
  m.floor(-1560, -1400, -780);
  m.floor(-1300, -900, -780);
  m.floor(-1380, -1320, -650);            // ledge up to the skylight
  m.box(-1180, -812, -1140, -780);        // roof vents (cover)
  m.box(-1000, -812, -960, -780);

  // ---- High tier (-520) and B (crane control) -----------------------------------
  m.floor(-1580, -1020, -520);            // high catwalk over A
  m.floor(-1440, -1380, -390);            // ledge: mid <-> high over A
  m.floor(-980, -900, -390);              // valve ledge: mid <-> high, and on to B
  m.floor(-880, -580, -520);              // B: crane control cabin floor
  m.floor(-840, -620, -650);              // cabin roof

  // ---- Centre -----------------------------------------------------------------------
  m.steps(-660, -65, 3, 50, -65, 50);     // stairs from the ground up toward C
  m.floor(-470, 470, -260);               // C: catwalk junction over the crucible
  m.floor(-540, -440, -390);              // ledge from C up to the high tier
  m.floor(-760, -280, -780);              // crane rail
  m.box(-344, -756, -336, -690);          // crane hook over C: chain...
  m.box(-344, -690, -264, -674);          // ...and hook (a perch to drop onto C from)
  m.box(-170, -292, -140, -260);          // crates on C (cover)
  m.box(-160, -900, 160, -840);           // crane cab (top)
  m.pad(-240, -200, -272, 12);            // updraft from C to the crane

  // ---- Items, spawns, flag (blue half) -------------------------------------------
  for (const [x, y] of [[-1820, 0], [-1760, 0], [-1700, 0], [-1640, 0], [-1800, -130], [-1700, -130],
    [-1780, -260], [-1700, -260], [-1800, -390], [-1760, -520], [-1700, -520], [-1720, -780]]) m.spawn(x, y, 1);
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
  for (const x of [-700, -640, -580, -520]) m.spawn(x, -520, 1, 2);
  for (const x of [1080, 1340, 1420, 1500]) m.spawn(x, -260, 2, 2);
  for (const x of [280, 340, 400, 450]) m.spawn(x, -260, 1, 3);
  for (const x of [1820, 1760, 1700, 1640]) m.spawn(x, 0, 2, 3);
  return m;
}
