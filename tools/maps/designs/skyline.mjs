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
  m.box(-1990, -1330, -1920, -1230);      // stair hut on the roof

  // ---- Brownstone A (x -1680..-1400), roof -450 -----------------------------------------
  plank(-1800, -1680, -450);              // plank from the tower lobby
  m.box(-1680, -450, -1400, BASE);
  m.box(-1570, -530, -1510, -450);        // billboard: base...
  m.box(-1630, -600, -1450, -530);        // ...and panel (a step up to the girders)
  m.box(-1650, -482, -1610, -450);        // AC units
  m.box(-1450, -482, -1410, -450);
  girder(-1800, -1560, -710);             // girders: tower L3 door -> office upper floor
  girder(-1500, -1260, -680);
  m.pad(-1796, -1764, -722, 11);          // express pad up the tower's face to the roof

  // ---- Office B (x -1260..-920): floors at -450 and -680, roof -900 ----------------------
  plank(-1400, -1260, -450);
  m.box(-1260, -450, -920, BASE);
  m.box(-1260, -900, -1236, -770);        // walls with doors on both floors
  m.box(-1260, -680, -1236, -540);
  m.box(-944, -900, -920, -770);
  m.box(-944, -680, -920, -540);
  m.floor(-1236, -1130, -680);            // upper floor, hole in the middle
  m.floor(-1060, -944, -680);
  m.box(-1150, -550, -1110, -450);        // filing cabinet: up through the hole
  m.box(-1020, -482, -980, -450);         // desk
  m.floor(-1260, -1180, -900);            // roof, hatch over the step
  m.floor(-1110, -920, -900);
  m.box(-1200, -780, -1160, -680);        // step up to the hatch
  m.box(-1030, -940, -990, -900);         // water tower: stand...
  m.box(-1060, -1020, -960, -940);        // ...and tank
  plank(-920, -860, -450);                // balcony: hop down to the warehouse
  girder(-920, -640, -680);               // girders over the valley to the hotel
  girder(-560, -340, -560);

  // ---- Warehouse (x -780..-480), roof -350: the valley -----------------------------------
  m.box(-780, -350, -480, BASE);
  m.box(-720, -382, -680, -350);          // AC unit
  m.box(-700, -450, -640, -350);          // rooftop shed: up to the girders
  plank(-480, -340, -350);                // plank into the hotel lobby

  // ---- Hotel (x -340..340): lobby -350, balconies -560, roof -720 -------------------------
  m.box(-340, -350, 340, BASE);
  m.box(-340, -720, -316, -650);          // walls: doors at the lobby and the balcony
  m.box(-340, -560, -316, -440);
  m.floor(-316, -160, -560);              // balcony
  m.box(-150, -450, -110, -350);          // luggage: up to the balcony
  m.pad(-24, 24, -362, 10);               // lobby pad up through the skylight
  m.floor(-340, -280, -720);              // roof (skylight in the middle)...
  m.floor(-280, -140, -690);              // ...a pool sunk into it...
  m.floor(-140, -40, -720);
  m.floor(-380, -340, -640, 12);          // fire escape from the girder to the roof

  // ---- Items, spawns, flag (blue half) -------------------------------------------
  for (const [x, y] of [[-2040, -450], [-1980, -450], [-1920, -450], [-2040, -580], [-1960, -580], [-1960, -710], [-1880, -710],
    [-2040, -840], [-1960, -840], [-1960, -970], [-1880, -970], [-2040, -1100]]) m.spawn(x, y, 1);
  m.flag(1, -1860, -1230);
  m.item('jetpack', -1955, -1330);
  m.item('M4', -1860, -450);
  m.item('health', -2040, -970);
  m.item('Shotgun', -1530, -450);
  m.item('armour', -1540, -600);
  m.item('GrenadeLauncher', -1190, -450);
  m.item('health', -1000, -680);
  m.item('SR', -1010, -1020);
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
