// Twin Keeps: capture the flag between two castles across a deadly moat.
//
// Each castle (blue left, red right) has a tall keep at its outer end (climb the
// ledges inside; snipe from the battlement on top), a courtyard with the flag,
// and a gatehouse with a gate below and a rampart on top. Between the gates is
// the moat, a bottomless pit, with three ways over it:
//   - the stone bridge in the middle (the hill sits on its crown),
//   - stepping stones down in the moat, under the bridge (miss a jump and you fall),
//   - the rope line, sagging from one keep's battlement to the other's.
//
// Levels (y, down is +): stones 150, ground 0, bridge -90 (crown -130),
// rampart -330, rope -440 (middle) to -700 (keeps), keep battlement -700.
import { MapBuilder, T } from '../lib.mjs';

export const info = { modes: ['ctf', 'conquest', 'koth', 'team', 'ffa', 'rush'], size: 'small', players: '6-16' };

// The rope line: a catenary-ish curve from (-ROPE_X, ROPE_END) down to (0, ROPE_MID),
// cut into short pieces that each drop STEP px, so it can be walked like stairs.
const ROPE_X = 1100, ROPE_END = -700, ROPE_MID = -440, STEP = 8, ROPE_T = 8;
const ropeY = x => ROPE_MID - (ROPE_MID - ROPE_END) * (x / ROPE_X) ** 2;

export default function () {
  const m = new MapBuilder('Twin Keeps');
  const BOTTOM = 320; // bottom of the foundations (the moat has no floor)

  // ---- Blue castle (left); mirrored for red ---------------------------------------
  // Foundations: the courtyard, the gate passage and the bank all stand at y = 0.
  // Under the gate runs a postern tunnel from the moat up into the courtyard
  // (through a hole in the courtyard floor).
  m.box(-1348, 0, -930, BOTTOM);
  m.floor(-890, -440, 0);                 // courtyard, gate passage and bank (the tunnel's roof)
  m.box(-930, 80, -405, BOTTOM);          // tunnel floor; its end sticks out into the moat as a ledge

  // The keep: an outer wall (its top a lookout over the battlement), an inner wall
  // with a door at the bottom, ledges zig-zagging up inside, and the battlement on top.
  m.box(-1348, -780, -1324, 0);           // outer wall
  m.box(-1124, -676, -1100, -150);        // inner wall (door below)
  m.floor(-1324, -1244, -125);            // L1
  m.floor(-1204, -1124, -250);            // R1
  m.floor(-1324, -1244, -375);            // L2
  m.floor(-1204, -1124, -500);            // R2
  m.floor(-1324, -1262, -610);            // L3
  m.floor(-1250, -1100, -700);            // battlement (the gap to its left is the hatch)
  m.box(-1196, -730, -1176, -700);        // merlon: crouch behind it to snipe

  // Courtyard: the flag, a cart for cover, scaffolding up to the rampart.
  m.box(-990, -30, -930, 0);              // cart
  m.floor(-880, -810, -110);              // scaffold
  m.floor(-810, -762, -220);
  // Gatehouse: the gate passage below, the rampart on top with merlons facing the moat.
  m.box(-740, -330, -520, -140);
  m.box(-544, -360, -520, -330);
  m.box(-640, -356, -620, -330);
  m.box(-552, -140, -536, -64);           // the portcullis, half raised: cover in the gate

  // The moat: stepping stones (pillars rising out of the deep) under the bridge.
  m.box(-355, 150, -305, BOTTOM);          // stones
  m.box(-190, 150, -140, BOTTOM);

  // Spawns: in the keep and the courtyard.
  for (const x of [-1300, -1260, -1180, -1150]) m.spawn(x, 0, 1);
  for (const x of [-1070, -880, -800]) m.spawn(x, 0, 1);
  m.flag(1, -1040, 0);

  // Items.
  m.item('M4', -1225, -700);
  m.item('Longbow', -1160, -700);
  m.item('health', -1290, -375);
  m.item('Uzi', -1160, -250);
  m.item('armour', -1295, -610);
  m.item('Shotgun', -960, -30);
  m.item('health', -845, -110);
  m.item('Flamer', -660, 80);            // in the tunnel
  m.item('M4', -630, 0);
  m.item('NinjaRope', -590, -330);
  m.item('GrenadeLauncher', -700, -330);
  m.item('health', -330, 150);
  m.item('Shotgun', -380, -90);
  m.item('armour', -165, 150);

  m.mirror(0);

  // ---- The middle -----------------------------------------------------------------
  m.floor(-440, 440, -90, 16);            // the bridge deck
  m.box(-130, -130, 130, -90);            // its crown
  m.box(-25, 150, 25, BOTTOM);            // the middle stone
  m.box(-300, -118, -280, -90);           // parapet blocks: crouch cover on the bridge
  m.box(280, -118, 300, -90);
  m.item('Bazooka', 0, -130);
  m.item('HolyHandGrenade', 0, 150);

  // The rope line, keep to keep.
  const pieces = [];
  let x0 = -ROPE_X, y = ROPE_END;
  for (let x = -ROPE_X; x <= 0; x += 1) {
    const want = Math.min(ROPE_MID, ROPE_END + STEP * Math.round((ropeY(x) - ROPE_END) / STEP));
    if (want !== y) { pieces.push([x0, x, y]); x0 = x; y = want; }
  }
  pieces.push([x0, 0, y]);
  // Join the two middle pieces into one centred piece.
  const [mx0, , my] = pieces.pop();
  for (const [l, r, py] of pieces) { m.floor(l, r, py, ROPE_T); m.floor(-r, -l, py, ROPE_T); }
  m.floor(mx0, -mx0, my, ROPE_T);
  m.item('SR', 0, my);

  // ---- Objectives -------------------------------------------------------------------
  m.hill(-110, 110, -130, 90);            // on the bridge's crown

  m.point('A', -700, -450, 0, 120);       // blue's gate and bank
  m.point('B', -130, 130, -130, 120);     // the bridge's crown
  m.point('C', 450, 700, 0, 120);         // red's gate and bank

  // Rush: blue attacks. Sector 1: the bridge and red's bank. Sector 2: inside red's castle.
  m.mcom(1, 330, -90);                    // the bridge, behind the parapet
  m.mcom(1, 490, 0);                      // red's bank, under the rampart
  m.mcom(2, 960, 0);                      // red courtyard
  m.mcom(2, 690, -330);                   // red rampart
  for (const x of [-560, -510, -480, -455]) m.spawn(x, 0, 1, 1);   // blue gate and bank
  for (const x of [1070, 1150, 1180, 1260]) m.spawn(x, 0, 2, 1);  // red keep and courtyard
  for (const x of [160, 240, 360]) m.spawn(x, -90, 1, 2);          // the bridge
  m.spawn(60, -130, 1, 2);
  for (const x of [1150, 1180, 1260, 1300]) m.spawn(x, 0, 2, 2);   // red keep
  return m;
}
