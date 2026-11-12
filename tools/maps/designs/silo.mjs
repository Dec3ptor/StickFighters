// Silo: a duel map (1 v 1, 2 v 2) that goes up rather than along. Five floors, each with its gap
// on the other side from the one below, so the way up zigzags and no floor can see the one two
// above it: fights are at the gaps, and whoever holds the top has the rocket and nowhere to hide.
//
// Levels (y, down is +): ground 0, then floors every 85 px: -85 (sides), -170 (middle),
// -255 (sides), -340 (middle). Every climb is one jump.
import { MapBuilder, T } from '../lib.mjs';

export const info = { modes: ['ffa', 'team', 'koth'], size: 'duel', players: '2-4' };

export default function () {
  const m = new MapBuilder('Silo');
  const BASE = 200;
  // ---- Blue (left) half; mirrored for red ----
  m.box(-524, -470, -500, BASE);            // the silo's wall
  m.box(-500, 0, 0, BASE);                  // ground
  m.floor(-500, -150, -85, 16);             // first floor (the gap's in the middle)
  m.floor(-500, -250, -255, 16);            // third floor
  m.box(-330, -30, -290, 0);                // a drum on the ground: cover
  for (const x of [-450, -380]) m.spawn(x, 0, 1);
  m.spawn(-420, -85, 1);
  m.spawn(-400, -255, 1);
  m.item('armour', -300, 0);
  m.item('M4', -330, -85);
  m.item('SR', -420, -255);
  m.item('health', -460, -85);
  m.item('Hammer', -470, 0);
  m.mirror(0);
  // ---- Middle ----
  m.floor(-200, 200, -170, 16);             // second floor
  m.floor(-190, 190, -340, 16);             // top floor
  m.box(-34, -62, 34, 0);                   // a crate in the middle of the ground: no shot from one end to the other
  m.item('Shotgun', 0, -62);
  m.item('jetpack', 0, -340);
  m.item('health', 0, -170);
  m.item('Bazooka', -120, -340);
  m.hill(-120, 120, -170, 80);
  return m;
}
