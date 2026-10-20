// Skyline: city rooftops, built for Capture the Flag. Each team's flag sits on the
// roof of its skyscraper at the far end. Between them: a low brownstone, a tall
// office block (two floors you can run through, a water tower on top), a low
// warehouse in the "valley", and the hotel in the middle (a lobby with a jump pad
// up through the skylight, balconies, rooftop pools). The gaps between buildings
// drop to a street you never reach: falls kill. Some gaps have planks or girders,
// others take a jump. Blue's half is built, then mirrored for red.
import { MapBuilder, T } from '../lib.mjs';

export const info = { modes: ['ctf', 'conquest', 'koth', 'team', 'ffa', 'rush'], size: 'medium', players: '8-24' };

const BASE = 200; // buildings run down out of sight; there is no street

export default function () {
  const m = new MapBuilder('Skyline');
  const plank = (l, r, y) => m.floor(l, r, y, 12);
  const girder = (l, r, y) => m.floor(l, r, y, 16);

  // ---- Blue tower (x -2100..-1800): zigzag floors inside, flag on the roof -------------
  m.box(-2100, -450, -1800, BASE);        // lobby L1 at -450
  m.box(-2100, -1270, -2076, -450);       // outer wall (a parapet above the roof)
  m.box(-1824, -1230, -1800, -800);       // city-side wall: door at L3 (-710)...
  m.box(-1824, -710, -1800, -540);        // ...and at the lobby
  m.floor(-2076, -1894, -580);            // L2, gap on the right
  m.floor(-2006, -1824, -710);            // L3, gap on the left
  m.floor(-2076, -1894, -840);            // L4
  m.floor(-2006, -1824, -970);            // L5
  m.floor(-2076, -1894, -1100);           // L6
  m.floor(-2006, -1800, -1230);           // roof, hatch on the left
  m.box(-1990, -1310, -1920, -1230);      // stair hut on the roof
  // Half-landings: a ledge in each gap, halfway between floors (each climb is 65).
  for (const y of [-515, -775, -1035]) m.floor(-1864, -1824, y, 12);  // under L2, L4, L6's gaps
  for (const y of [-645, -905, -1165]) m.floor(-2076, -2036, y, 12);  // under L3, L5 and the hatch

  // ---- Brownstone A (x -1680..-1400), roof -450 -----------------------------------------
  plank(-1800, -1680, -450);              // plank from the tower lobby
  m.box(-1680, -450, -1400, BASE);
  m.box(-1570, -530, -1510, -450);        // billboard: base...
  m.box(-1610, -600, -1470, -530);        // ...and panel (a step up to the girders)
  m.box(-1670, -520, -1640, -450);        // AC units: steps up to the panel (with a gap
  m.box(-1440, -520, -1410, -450);        // to climb out from under it)
  girder(-1800, -1560, -710);             // girders: tower L3 door -> office upper floor
  girder(-1500, -1260, -680);
  m.pad(-1796, -1764, -722, 11);          // express pad up the tower's face to the roof,
  m.box(-1764, -722, -1748, -710);        // with a kerb beside it (so its edge isn't a ledge)

  // ---- Office B (x -1260..-920): floors at -450 and -680, roof -900 ----------------------
  plank(-1400, -1260, -450);
  m.box(-1260, -450, -920, BASE);
  m.box(-1260, -900, -1236, -770);        // walls with doors on both floors
  m.box(-1260, -680, -1236, -540);
  m.box(-944, -900, -920, -770);
  m.box(-944, -680, -920, -540);
  m.floor(-1236, -1130, -680);            // upper floor, hole in the middle
  m.floor(-1060, -944, -680);
  m.box(-1150, -530, -1110, -450);        // filing cabinet...
  m.floor(-1110, -1070, -610, 12);        // ...a shelf under the hole: up through it
  m.box(-1020, -482, -980, -450);         // desk
  m.floor(-1260, -1180, -900);            // roof, hatch over the step
  m.floor(-1110, -920, -900);
  m.box(-1190, -760, -1150, -680);        // step and a shelf up to the hatch
  m.floor(-1150, -1112, -830, 12);
  m.box(-1030, -935, -990, -900);         // water tower: stand...
  m.box(-1060, -980, -960, -935);         // ...and tank
  plank(-920, -860, -410);                // balcony, a step below the door: hop down to the warehouse and back
  girder(-920, -640, -680);               // girders over the valley to the hotel,
  girder(-620, -580, -620);               // a crossbeam between them,
  girder(-560, -340, -560);

  // ---- Warehouse (x -780..-480), roof -350: the valley -----------------------------------
  m.box(-780, -350, -480, BASE);
  m.box(-720, -382, -680, -350);          // AC unit
  m.box(-700, -430, -640, -350);          // rooftop shed

  // ---- Hotel (x -340..340): lobby -350, balconies -560, roof -720 -------------------------
  m.box(-340, -350, 340, BASE);
  plank(-480, -340, -350);                // plank from the warehouse into the lobby (placed after the
                                          // lobby, as on the mirrored side, so bots route both the same)
  m.box(-340, -720, -316, -650);          // walls: doors at the lobby and the balcony
  m.box(-340, -560, -316, -440);
  m.floor(-316, -160, -560);              // balcony
  m.box(-150, -430, -110, -350);          // luggage (hop over it; the pad leads up)
  m.pad(-24, 24, -362, 10);               // lobby pad up through the skylight
  m.floor(-340, -280, -720);              // roof (skylight in the middle)...
  m.floor(-280, -140, -690);              // ...a pool sunk into it...
  m.floor(-140, -40, -720);
  m.floor(-380, -340, -640, 12);          // fire escape from the girder to the roof

  // ---- Items, spawns, flag (blue half) -------------------------------------------
  for (const [x, y] of [[-2040, -450], [-1980, -450], [-1920, -450], [-2016, -580], [-1960, -580], [-1960, -710], [-1880, -710],
    [-2016, -840], [-1960, -840], [-1960, -970], [-1880, -970], [-2016, -1100]]) m.spawn(x, y, 1);
  m.flag(1, -1860, -1230);
  m.item('jetpack', -1955, -1310);
  m.item('M4', -1860, -450);
  m.item('health', -1990, -970);
  m.item('Shotgun', -1480, -450);
  m.item('armour', -1540, -600);
  m.item('GrenadeLauncher', -1190, -450);
  m.item('health', -1000, -680);
  m.item('SR', -1010, -980);
  m.item('Bazooka', -780, -680);
  m.item('M4', -540, -350);
  m.item('NinjaRope', -740, -350);
  m.item('health', -240, -560);
  m.item('Minigun', 0, -720);
  m.item('HolyHandGrenade', 0, -350);

  m.mirror(0);

  // ---- Objectives ---------------------------------------------------------------
  m.point('A', -1680, -1400, -450, 130);
  m.point('B', -1236, -944, -450, 110);
  m.point('C', -200, 200, -720, 120);
  m.point('D', 944, 1236, -450, 110);
  m.point('E', 1400, 1680, -450, 130);
  m.hill(-110, 110, -350, 100);
  m.hill(-780, -580, -350, 100);
  m.hill(580, 780, -350, 100);
  // Rush: blue attacks left to right.
  m.mcom(1, -1080, -450); m.mcom(1, -1000, -680);
  m.mcom(2, -230, -350); m.mcom(2, 90, -720);
  m.mcom(3, 1460, -450); m.mcom(3, 1960, -450);
  for (const [x, y] of [[-2040, -450], [-1980, -450], [-1960, -580], [-1960, -710]]) m.spawn(x, y, 1, 1);
  for (const x of [-760, -620, -560, -500]) m.spawn(x, -350, 2, 1);
  for (const x of [-1220, -1180, -1080, -1050]) m.spawn(x, -450, 1, 2);
  for (const x of [500, 560, 620, 750]) m.spawn(x, -350, 2, 2);
  for (const x of [510, 560, 620, 760]) m.spawn(x, -350, 1, 3);
  for (const [x, y] of [[2040, -450], [1980, -450], [1960, -580], [1960, -710]]) m.spawn(x, y, 2, 3);
  return m;
}
