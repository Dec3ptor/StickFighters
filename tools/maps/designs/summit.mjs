// Summit: a stepped mountain in the middle of a small map, built for king of the hill.
// The hill is the summit plateau. Ways up: the stepped ledges on each flank (with a step
// halfway up each tier's face, so every climb is a 60 px hop), jump pads at the mountain's
// foot that throw you up the slope, and a tunnel under the whole map whose lift shaft
// (a strong jump pad) shoots you up to a window just under the summit.
// Low bases at the far left (blue) and right (red), each with a stairwell at the front and
// a back hatch down to its flag, kept in the vault at the tunnel's end under the base, so
// flag runners can take the tunnel or the mountain. Mirror-symmetric about x = 0.
import { MapBuilder, T } from '../lib.mjs';

export const info = { modes: ['koth', 'ctf', 'conquest', 'team', 'ffa', 'rush'], size: 'small', players: '4-12' };

export default function () {
  const m = new MapBuilder('Summit');

  // Floor heights: ground 0, the tunnel 124 below it, mountain tiers every 120 px up to the summit.
  // A jump only climbs about 97 px, so each tier's face has a step block halfway up (HALF).
  const G = 0, TUN = 124, T1 = -120, T2 = -240, T3 = -360, T4 = -480, TOP = -600, DECK = -110;
  const HALF = 60;

  // ---- Blue half (x < 0) ----------------------------------------------------------------
  // Base: outer wall, a floor over the tunnel between the back hatch and the front stairwell,
  // and a deck (with a parapet) over the hatch.
  m.box(-1000, -240, -976, TUN + T);                // outer wall (130 px over the deck: too tall to climb or jump over)
  m.floor(-920, -760, G);                           // base floor
  m.floor(-976, -850, DECK);                        // deck
  m.box(-874, DECK - 28, -850, DECK);               // parapet (crouch cover)
  m.box(-976, 62, -948, 62 + T);                    // back hatch (x -976..-920): a step to climb out
  m.box(-760, 62, -722, 62 + T);                    // front stairwell (x -760..-680): a step to climb out

  // The mountain's foot: a ledge over the tunnel, ending in a jump pad set into the floor
  // against the mountain: steer right to fly up the slope (as far as tier 3), left to fly back
  // over the stairwell onto the deck (the way back up to the deck: it's too tall to jump to).
  m.floor(-680, -636, G);
  m.pad(-636, -590, G, 11, T);

  // The mountain: solid tiers, split down the middle by the lift shaft (x -40..40).
  m.box(-590, T1, -40, T);                          // tier 1 (its underside is the tunnel's ceiling)
  m.box(-470, T2, -40, T1);                         // tier 2
  m.box(-350, T3, -40, T3 + T);                     // tier 3, overhanging tier 2...
  m.box(-300, T3 + T, -40, T2);                     // ...to leave a sheltered alcove at x -350..-300
  m.box(-230, T4, -40, T3);                         // tier 4 (inner part: the window under the summit)
  m.box(-56, T4 - 20, -40, T4);                     // a curb at the shaft's lip, so nobody walks into it

  // Steps halfway up each tier's face (solid blocks, 40 wide), so the flank climbs in 60 px hops.
  m.box(-510, T1 - HALF, -470, T1);                 // tier 1 -> tier 2
  m.box(-390, T2 - HALF, -350, T2);                 // tier 2 -> tier 3 (beside the alcove)
  m.box(-270, T3 - HALF, -230, T3);                 // tier 3 -> tier 4
  m.box(-165, T4 - HALF, -125, T4);                 // tier 4 -> the summit's edge (x -110)

  // Tunnel cover.
  m.box(-560, TUN - 30, -530, TUN);
  m.box(-300, TUN - 30, -270, TUN);

  // Eagle perch beside the summit: a sniper spot over the hill, a hop (85 px up, 40 across)
  // from the summit's edge.
  m.floor(-260, -150, TOP - 85);

  // Spawns: on the deck and the base floor (the flag is in the vault below).
  for (const x of [-964, -938, -912, -888]) m.spawn(x, DECK, 1);
  for (const x of [-836, -806, -776]) m.spawn(x, G, 1);

  // Items.
  m.item('M4', -820, G);
  m.item('Shotgun', -930, DECK);
  m.item('health', -962, 62);
  m.item('health', -742, 62);
  m.item('M4', -530, T1);
  m.item('GrenadeLauncher', -420, T2);
  m.item('armour', -322, T2);
  m.item('Shotgun', -450, TUN);
  m.item('Flamer', -150, TUN);
  m.item('SR', -215, TOP - 85);

  m.flag(1, -925, TUN);                             // in the vault under the base, below the hatch

  m.mirror(0);

  // ---- Centre pieces (symmetric already) ------------------------------------------------
  m.floor(-976, 976, TUN);                          // tunnel floor, base to base
  m.pad(-22, 22, TUN - 12, 12);                     // the lift: up the shaft to the summit window
  m.floor(-110, 110, TOP);                          // summit plateau (roof of the shaft)
  m.box(-20, TOP - 30, 20, TOP);                    // cover in the middle of the summit
  m.item('Bazooka', 0, TOP - 30);
  m.item('health', 0, TUN);

  // ---- Objectives -------------------------------------------------------------------------
  // King of the hill: the summit, then the lift chamber in the tunnel (they take turns).
  m.hill(-110, 110, TOP, 90);
  m.hill(-110, 110, TUN, 90);

  // Conquest: A on blue's lower slopes, B the summit, C on red's lower slopes.
  m.point('A', -590, -400, T1, 140);
  m.point('B', -110, 110, TOP, 110);
  m.point('C', 400, 590, T1, 140);

  // Rush (blue attacks left to right): sector 1 the summit and the tunnel's middle,
  // sector 2 red's slope and red's end of the tunnel.
  m.mcom(1, 60, TOP);
  m.mcom(1, 140, TUN);
  m.mcom(2, 385, T2);
  m.mcom(2, 380, TUN);
  // Sector 1: blue from its lower slopes and deck, red from its base.
  for (const x of [-565, -525]) m.spawn(x, T1, 1, 1);
  for (const x of [-445, -410]) m.spawn(x, T2, 1, 1);
  m.spawn(-938, DECK, 1, 1);
  for (const x of [806, 836]) m.spawn(x, G, 2, 1);
  for (const x of [912, 938, 964]) m.spawn(x, DECK, 2, 1);
  // Sector 2: blue from the summit, its upper slope and the tunnel's middle; red from its base.
  for (const x of [-80, -40]) m.spawn(x, TOP, 1, 2);
  for (const x of [-210, -185]) m.spawn(x, T4, 1, 2);
  m.spawn(-150, TUN, 1, 2);
  for (const x of [776, 806, 836]) m.spawn(x, G, 2, 2);
  for (const x of [912, 938, 964]) m.spawn(x, DECK, 2, 2);

  // A hammer for anyone to build with (near the middle).
  m.item('Hammer', -48, -500);
  return m;
}
