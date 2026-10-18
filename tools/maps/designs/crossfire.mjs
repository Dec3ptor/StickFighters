// Crossfire: two bunkers facing each other across three lanes, built for capture the flag.
// Each bunker (blue left, red right) keeps its flag inside and has two ways in: a door at
// floor level and a hatch in the roof. Between them: a high sniper bridge on two piers, an
// open field with crouch-cover blocks (you walk under the piers through archways), and a low
// tunnel underneath. Jump pads link the lanes: beside each pier one throws you up its face
// onto the bridge, and in the tunnel they throw you up through holes into the field.
// Mirror-symmetric about x = 0.
import { MapBuilder, T } from '../lib.mjs';

export const info = { modes: ['ctf', 'koth', 'conquest', 'team', 'ffa', 'rush'], size: 'small', players: '4-12' };

export default function () {
  const m = new MapBuilder('Crossfire');

  // Floor heights: the field (and the bunkers' ground floors) 0, the tunnel 170 below it,
  // the bunker roofs 280 above and the bridge 500 above.
  const F = 0, TN = 170, BR = -500, ROOF = -280, MEZ = -140, ARCH = -84;

  // ---- Blue half (x < 0) ----------------------------------------------------------------
  // Bunker (x -1096..-802): back wall, bedrock floor, roof with a hatch, front wall with a door.
  m.box(-1120, ROOF + T, -1096, F);                 // back wall
  m.box(-1120, F, -730, TN + T);                    // bunker floor and the field outside it (bedrock)
  m.floor(-1120, -960, ROOF);                       // roof...
  m.floor(-910, -802, ROOF);                        // ...with a hatch at x -960..-910
  m.box(-1120, ROOF - 36, -1100, ROOF);             // parapet at the roof's back edge
  m.box(-826, ROOF + T, -802, ARCH);                // front wall, over the door
  m.floor(-1000, -880, MEZ);                        // mezzanine under the hatch

  // A step from the roof up to the bridge.
  m.floor(-800, -730, (ROOF + BR) / 2);

  // The bridge (high lane): an outer span from the step to a gap, then the pier.
  m.floor(-730, -470, BR);
  m.box(-660, BR - 28, -636, BR);                   // sniper's parapet near the bridge's end
  m.box(-420, BR + T, -380, ARCH);                  // pier, with an archway under it

  // The field (middle lane): a stairwell down to the tunnel by the door, crouch-cover blocks,
  // a jump pad against the pier (step off the block onto it), a hole over a pad in the tunnel.
  m.box(-730, 85, -700, 85 + T);                    // stairwell (x -730..-670): a step to climb out
  m.floor(-670, -275, F);                           // (hole at x -275..-225)
  m.box(-620, F - 30, -584, F);
  m.box(-494, F - 30, -458, F);                     // (step off it onto the pad)
  m.pad(-458, -426, F - 12, 11);                    // up the pier's face onto the bridge
  m.box(-160, F - 30, -124, F);

  // The tunnel (low lane).
  m.pad(-262, -238, TN - 12, 7);                    // up through the field's hole
  m.box(-630, TN - 30, -600, TN);
  m.box(-420, TN - 30, -390, TN);
  m.box(-130, TN - 30, -100, TN);

  // Spawns: mostly on the roof (defenders drop in through the hatch), one on the mezzanine.
  for (const x of [-1085, -1055, -1025, -990, -885, -845]) m.spawn(x, ROOF, 1);
  m.spawn(-985, MEZ, 1);

  // Items.
  m.item('health', -1080, F);
  m.item('M4', -930, F);
  m.item('armour', -935, MEZ);
  m.item('Shotgun', -1050, ROOF);
  m.item('M4', -560, BR);
  m.item('GrenadeLauncher', -250, BR);
  m.item('health', -545, F);
  m.item('Shotgun', -330, F);
  m.item('Shotgun', -680, TN);
  m.item('Flamer', -330, TN);
  m.item('health', -180, TN);

  m.flag(1, -1050, F);

  m.mirror(0);

  // ---- Centre pieces (symmetric already) ------------------------------------------------
  m.floor(-420, 420, BR);                           // the bridge's main span, pier to pier
  m.box(-18, BR - 28, 18, BR);                      // cover on the bridge
  m.floor(-225, 225, F);                            // the field's middle
  m.box(-30, F - 30, 30, F);                        // cover in the field
  m.floor(-730, 730, TN);                           // the tunnel floor
  m.item('SR', 0, BR - 28);
  m.item('Bazooka', 0, F - 30);
  m.item('Minigun', 0, TN);

  // ---- Objectives -------------------------------------------------------------------------
  // King of the hill: the middle of each lane in turn (field, bridge, tunnel).
  m.hill(-110, 110, F, 90);
  m.hill(-110, 110, BR, 90);
  m.hill(-110, 110, TN, 90);

  // Conquest: A at blue's pier, B the middle of the field, C at red's pier.
  m.point('A', -600, -380, F, 120);
  m.point('B', -130, 130, F, 120);
  m.point('C', 380, 600, F, 120);

  // Rush (blue attacks left to right): sector 1 the bridge and the tunnel on red's side of the
  // middle, sector 2 red's bunker.
  m.mcom(1, 290, BR);
  m.mcom(1, 365, TN);
  m.mcom(2, 970, F);
  m.mcom(2, 1040, ROOF);
  // Sector 1: blue from its half of the field and bridge, red from its own half.
  for (const x of [-640, -560]) m.spawn(x, F, 1, 1);
  m.spawn(-600, BR, 1, 1);
  m.spawn(-860, F, 1, 1);
  m.spawn(-985, MEZ, 1, 1);
  for (const x of [650, 710]) m.spawn(x, F, 2, 1);
  m.spawn(860, F, 2, 1);
  for (const x of [845, 885]) m.spawn(x, ROOF, 2, 1);
  // Sector 2: blue from the middle, red from its bunker.
  for (const x of [300, 340]) m.spawn(x, F, 1, 2);
  m.spawn(200, BR, 1, 2);
  m.spawn(300, TN, 1, 2);
  for (const x of [1060, 1090]) m.spawn(x, ROOF, 2, 2);
  for (const x of [895, 985]) m.spawn(x, MEZ, 2, 2);
  m.spawn(1080, F, 2, 2);

  return m;
}
