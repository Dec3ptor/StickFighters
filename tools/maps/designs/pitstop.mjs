// Pit Stop: a small industrial garage built for king of the hill.
//
// Three hills rotate: one on each team's raised mezzanine (left- and right-centre)
// and one down in the sunken inspection pit in the middle. The pit has steps down
// on both sides and a jump pad in the middle that throws you up through the gap
// between the overhead catwalks. Each team spawns low on the garage floor at its
// own end, under a loft (its flag) with tool shelves and a crane beam above.
//
// Levels (y, down is +): pit floor 210, garage floor 0, mezzanine -165,
// loft -260, hook -255, catwalk -340, crane beam -385, top shelf -400.
import { MapBuilder, T } from '../lib.mjs';

export const info = { modes: ['koth', 'ctf', 'conquest', 'team', 'ffa', 'rush'], size: 'small', players: '4-12' };

export default function () {
  const m = new MapBuilder('Pit Stop');
  const BASE = 300; // bottom of the solid ground

  // ---- Blue (left) half; mirrored for red ----------------------------------------
  // Outer wall, with a perch on top reachable from the top shelf.
  m.box(-1054, -540, -1030, BASE);
  // Garage floor, and the steps down into the pit.
  m.box(-1030, 0, -380, BASE);
  m.box(-380, 70, -320, BASE);
  m.box(-320, 140, -260, BASE);
  m.box(-260, 210, -20, BASE); // pit floor (the pad sits in the middle)
  // Low cover in the pit (a trolley jack).
  m.box(-200, 180, -160, 210);

  // Outer end: a stack of crates up to the loft (flag) and the shelves above it.
  m.box(-875, -65, -805, 0);
  m.box(-865, -130, -815, -65);
  m.floor(-1030, -900, -260);          // loft (flag)
  m.floor(-1030, -970, -400, 16);      // top tool shelf
  m.floor(-880, -640, -385, 16);       // crane beam over the mezzanine

  // Mezzanine (hill), with a tool cabinet and a hanging hook beside it toward the pit.
  m.floor(-760, -500, -165);
  m.box(-530, -195, -510, -165);       // railing at the pit end: crouch cover
  m.box(-470, -75, -410, 0);           // tool cabinet
  m.floor(-470, -410, -255, 16);       // hook block
  m.floor(-380, -60, -340, 16);        // catwalk over the pit

  // A car parked under the mezzanine: cover on the low route.
  m.box(-700, -34, -560, 0);
  m.box(-670, -66, -600, -34);

  // Spawns: on the garage floor at the outer end, under the loft and the mezzanine.
  for (const x of [-1000, -950, -775, -730, -520]) m.spawn(x, 0, 1);
  m.spawn(-635, -66, 1);
  m.spawn(-950, -260, 1);
  m.flag(1, -995, -260);

  // Items.
  m.item('M4', -920, 0);
  m.item('Shotgun', -500, 0);
  m.item('health', -840, -130);
  m.item('armour', -1000, -400);
  m.item('GrenadeLauncher', -630, -165);
  m.item('health', -440, -75);
  m.item('Flamer', -300, 70);
  m.item('Shotgun', -230, 210);
  m.item('SR', -110, -340);
  m.item('M4', -760, -385);

  m.mirror(0);

  // ---- Centre --------------------------------------------------------------------
  m.pad(-20, 20, 210, 11.5);            // launches through the catwalk gap
  m.box(-20, 222, 20, BASE);
  m.item('Bazooka', 0, 210);            // floats over the pad: grab it on the way up
  m.floor(-50, 50, -465, 16);           // crane trolley high over the pit
  m.item('HolyHandGrenade', 0, -465);

  // ---- Objectives ----------------------------------------------------------------
  // King of the hill, rotating every minute: the pit (neutral) first, then the
  // blue mezzanine, then the red one.
  m.hill(-120, 120, 210, 95);
  m.hill(-720, -540, -165, 90);
  m.hill(540, 720, -165, 90);

  // Conquest.
  m.point('A', -755, -505, -165, 120);
  m.point('B', -150, 150, 210, 120);
  m.point('C', 505, 755, -165, 120);

  // Rush: blue attacks left to right.
  m.mcom(1, 200, 210);                  // pit, right side
  m.mcom(1, 250, -340);                 // right catwalk
  m.mcom(2, 600, -165);                 // red mezzanine
  m.mcom(2, 960, -260);                 // red loft
  // Sector 1: blue from its base, red from its mezzanine/garage floor.
  for (const x of [-775, -730, -540, -500]) m.spawn(x, 0, 1, 1);
  for (const x of [520, 730, 775]) m.spawn(x, 0, 2, 1);
  m.spawn(635, -66, 2, 1);
  // Sector 2: blue pushed up to the pit's left edge, red back at its outer end.
  for (const x of [-540, -500]) m.spawn(x, 0, 1, 2);
  m.spawn(-440, -75, 1, 2);
  m.spawn(-680, -165, 1, 2);
  for (const x of [930, 980, 1005]) m.spawn(x, 0, 2, 2);
  m.spawn(1000, -400, 2, 2);
  return m;
}
