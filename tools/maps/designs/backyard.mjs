// Backyard: a duel map (1 v 1, 2 v 2). Two yards either side of a shed that blocks the view
// along the ground, so nobody's shot from their own spawn: the fight is over the shed roof,
// the porches at each end and the beam across the top.
//
// Levels (y, down is +): ground 0, crates -65, porch -150, shed roof -120, ledges -195,
// top beam -270. Every climb is 85 px or less.
import { MapBuilder, T } from '../lib.mjs';

export const info = { modes: ['ffa', 'team', 'koth'], size: 'duel', players: '2-4' };

export default function () {
  const m = new MapBuilder('Backyard');
  const BASE = 200;
  // ---- Blue (left) half; mirrored for red ----
  m.box(-724, -420, -700, BASE);            // fence at the end
  m.box(-700, 0, 0, BASE);                  // ground
  m.box(-455, -75, -395, 0);                // crate at the porch's end: the way up
  m.floor(-700, -470, -150);                // porch
  m.box(-640, -180, -620, -150);            // a planter on the porch: crouch cover
  m.box(-330, -40, -250, 0);                // low wall in the yard: cover on the ground
  m.box(-140, -65, -60, 0);                 // crate against the shed
  m.floor(-250, -150, -195, 16);            // ledge between porch and roof
  for (const x of [-660, -560, -500]) m.spawn(x, 0, 1);
  m.spawn(-560, -150, 1);
  m.item('Shotgun', -360, 0);
  m.item('M4', -670, -150);
  m.item('health', -200, -195);
  m.item('armour', -180, 0);
  m.item('Hammer', -100, -65);
  m.mirror(0);
  // ---- Centre ----
  m.box(-60, -120, 60, BASE);               // the shed
  m.floor(-90, 90, -270, 16);               // beam over it, a jump up from either ledge
  m.item('SR', 0, -270);
  m.item('jetpack', 0, -120);
  m.hill(-60, 60, -120, 90);
  return m;
}
