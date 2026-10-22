// Kasbah: a sandstone desert town seen from the side, built for Defuse (a Counter-Strike
// style bomb map). The attackers (T, blue's spawn points) start on the citadel terrace at
// the far left; the defenders (CT, red's) in a plaza at the far right.
//
//   y -330  LONG A   __long doors__/long ramp/ house roof = bridge = house roof == hall roof _
//   y -260                                                       catwalk/ [ A SITE ]==palace gate==\ CT
//   y -200  [T SPAWN]\ grand                                            /  the palace              \ stairs  minaret
//   y    0            \staircase_ mid street: arcades, xbox courtyard _/mid doors_ CT mid ____|  [CT SPAWN] |
//   y  220              \___________ B tunnels (a cellar) ___________ [ B SITE ] B doors __/B stairs
//
// T spawn: the grand staircase falls from the terrace past the street (mid, a hop across
// the stairwell) down into the B tunnels; Long A starts across the stairwell, through the
// long doors gatehouse and up the long ramp onto the house roofs.
// Long A: a long, open sniper lane over the town (a plank bridge over the courtyard, a few
// low walls for cover), ending in a drop onto A from above.
// Mid: the street, through covered arcades under the houses and the open xbox courtyard to
// the catwalk hall, where the catwalk climbs to A ("short A") and the mid doors lead into
// CT mid under the palace, on to the CT spawn (a hop across the B stairwell).
// B tunnels: low and tight, with arches and crates (and a cellar to breathe in under the
// courtyard), into the cistern under the palace.
// Site A: the palace roof (crates for cover). Ways in: Long A (dropping in from above),
// the catwalk (alongside), and the CTs' walkway from the CT stairs, under the palace gate.
// Site B: the old cistern (a column, crates). Ways in: the tunnels, the B doors corridor
// from the CT side's B stairs, and a hatch in CT mid's floor (the crates under it climb out).
// CT spawn: from the plaza's edge the CT stairs climb to A and the B stairs go down to B,
// so CTs reach either site in 6-8 seconds; rotating between them takes 11-13.
//
// Physics to design around: a jump climbs about 97 px; the stairs have 10 px risers (walked,
// not jumped); soldiers are 34 px tall and 12 wide, so a floor passing over a staircase
// leaves 58 px plus a tread's width of headroom (see clearOver).
import { MapBuilder } from '../lib.mjs';

export const info = { modes: ['defuse', 'team', 'ffa', 'koth'], size: 'medium', players: '6-12' };

// Floor heights (y grows downward).
const SKY = -600;     // top of the outer walls
const LONG = -330;    // Long A: the house roofs
const ASITE = -260;   // A site: the palace roof (also the catwalk's top and the CT walkway)
const TSP = -200;     // T spawn: the citadel terrace (and outside long)
const CEIL = -110;    // the arcades' ceiling (the houses' and the palace's undersides)
const ST = 0;         // the street: mid, CT mid and the CT spawn plaza
const ROCK = 120;     // the tunnels' ceiling (rock under the street)
const TUN = 220;      // the tunnels and the cistern (B site): the bedrock's top
const BED = 280;      // the bedrock's bottom

// Across: the outer walls' inner faces and the main landmarks.
const L = 0, R = 3660;
const TS_R = 440;                            // edge of the citadel terrace, top of the grand staircase
const H1 = [940, 1250], H2 = [1500, 1750];   // the houses over the street (their roofs are Long A)
const PAL = [2300, 3014];                    // the palace (A site on the left of its roof)
const B_IN = [2300, 2600];                   // the cistern (B site), under the palace
const J = 3300;                              // the CT spawn plaza's edge

export default function () {
  const m = new MapBuilder('Kasbah');
  // Indestructible: the shell, the walls and floors that shape the routes, and the stairs
  // and floors a route depends on (so grenades can't cut Long A or the catwalk, say).
  const hard = (l, t, r, b) => { m.platforms.push({ left: l, top: t, right: r, bottom: b, hard: true }); };
  const hardFloor = (l, r, y, thick = 24) => hard(l, y, r, y + thick);

  /**
   * Walkable stairs (10 px risers) between an upper floor whose edge is at x = xu (top yu)
   * and a lower floor whose edge is at x = xl (top yl); xl > xu goes down to the right.
   * Treads are solid down to `base` (stone stairs) or slabs `th` thick (indestructible if
   * `solid`: a route's only way up). Returns clearOver(y):
   * how close to the top of the stairs a floor whose underside is at y can come (its edge's x),
   * leaving headroom over every tread a soldier walks on.
   */
  const stairs = (xu, yu, xl, yl, { base = null, th = 12, solid = false } = {}) => {
    const n = Math.ceil((yl - yu) / 10) - 1;
    const rise = (yl - yu) / (n + 1), run = (xl - xu) / n;
    for (let k = 1; k <= n; k++) {
      const a = Math.round(xu + run * (k - 1)), b = Math.round(xu + run * k), top = Math.round(yu + rise * k);
      (solid ? hard : m.box.bind(m))(Math.min(a, b), top, Math.max(a, b), base ?? top + th);
    }
    // (A soldier stays on a tread until their 12 px wide feet are off it: past its far edge + 12.)
    return y => {
      const k = Math.ceil((y + 34 - yu) / rise) - 1;   // the lowest tread a soldier's head would hit
      const x = xu + run * k + Math.sign(run) * 12;
      return run > 0 ? Math.ceil(x) : Math.floor(x);
    };
  };

  // ---- Shell: the kasbah's outer walls and the bedrock (indestructible) ------------------------
  hard(L - 24, SKY, L, BED);
  hard(R, SKY, R + 24, BED);
  hard(L - 24, TUN, R + 24, BED);

  // ---- T spawn: the citadel terrace and the grand staircase down into town ---------------------
  hard(L, TSP, TS_R, TUN);                          // the citadel's rock
  hard(L, -470, L + 56, TSP);                       // its keep, against the outer wall
  const grand = stairs(TS_R, TSP, 1000, TUN, { base: TUN });   // past the street (y 0 at x 707) to the tunnels

  // ---- Long A: across the stairwell, through the long doors, up the long ramp, over the roofs --
  hardFloor(grand(TSP + 24), 760, TSP);             // outside long
  hard(620, -430, 700, TSP - 90);                   // the long doors gatehouse (a 90 px doorway)
  stairs(H1[0], LONG, 760, TSP, { solid: true });   // the long ramp
  hard(H1[0], LONG, H1[1], CEIL);                   // house 1 (the street's arcade runs under it)
  hardFloor(H1[1], H2[0], LONG, 12);                // plank bridge over the xbox courtyard
  hard(H2[0], LONG, H2[1], CEIL);                   // house 2
  hardFloor(H2[1], 2280, LONG);                     // the catwalk hall's roof, to the drop onto A
  m.box(1150, LONG - 28, 1170, LONG);               // cover: a parapet,
  m.box(1580, LONG - 22, 1670, LONG);               // a dome on house 2,
  m.box(1598, LONG - 42, 1652, LONG - 22);
  m.box(2140, LONG - 30, 2160, LONG);               // and a low wall at the end

  // ---- Mid: the street, the xbox courtyard, the catwalk hall --------------------------------
  hardFloor(grand(ST + 24), 2520, ST);              // the street, on through the mid doors into CT mid
  m.box(1400, ST - 40, 1445, ST);                   // the xbox
  hardFloor(1850, 1880, ST - 60, 12);               // the catwalk: a step up at its foot (the street goes on under it),
  stairs(2165, ASITE, 1880, ST - 60, { solid: true });  // up to the right,
  hardFloor(2165, PAL[0], ASITE);                   // to its top beside A (under the end of Long A)
  hard(PAL[0], CEIL, PAL[0] + 24, CEIL + 20);       // the mid doors' lintel
  m.box(2195, ST - 30, 2245, ST);                   // cover by the mid doors

  // ---- B tunnels --------------------------------------------------------------------------
  hard(grand(ROCK), 24, H1[1], ROCK);              // the rock between the street and the tunnels,
  hard(H1[1], 24, H2[0], 40);                       // with a cellar under the xbox courtyard
  hard(H2[0], 24, B_IN[0] - 24, ROCK);
  m.box(1600, ROCK, 1630, ROCK + 30);               // low arches (no jumping under them)
  m.box(1950, ROCK, 1980, ROCK + 30);
  m.box(1450, TUN - 35, 1490, TUN);                 // crates
  m.box(1800, TUN - 40, 1840, TUN);

  // ---- B site: the cistern under the palace -------------------------------------------------
  hard(B_IN[0] - 24, 24, B_IN[0], 140);             // its walls, over the way in from the tunnels...
  hard(B_IN[1], 24, B_IN[1] + 24, 140);             // ...and over the B doors
  m.box(2410, 24, 2430, ROCK);                      // a column holding up the vault
  m.box(2340, TUN - 45, 2390, TUN);                 // cover
  m.box(2470, TUN - 70, 2590, TUN);                 // crates, up to the hatch
  m.box(2516, TUN - 140, 2570, TUN - 70);
  hard(B_IN[1] + 24, 24, 2986, ROCK);               // rock over the B doors corridor

  // ---- A site: the palace roof, the walkway and the minaret gate ------------------------------
  hard(PAL[0], ASITE, PAL[1], CEIL);                // the palace (CT mid runs under it)
  m.box(2700, ST - 32, 2750, ST);                   // cover in CT mid
  m.box(2340, ASITE - 40, 2390, ASITE);             // cover on A: a crate,
  m.box(2480, ASITE - 60, 2540, ASITE);             // a stack of two (the middle of the site stays clear),
  m.box(2495, ASITE - 95, 2530, ASITE - 60);
  m.box(2580, ASITE - 30, 2600, ASITE);             // and a low wall on the CT side
  hard(2820, -430, 2920, ASITE - 100);              // the palace gate over the walkway (100 px under it)

  // ---- CT side: the stairs to A and to B, and the spawn plaza ------------------------------
  stairs(PAL[1], ASITE, 3286, ST - 60, { solid: true });  // the CT stairs up to the walkway...
  hardFloor(3286, 3330, ST - 60, 12);               // ...from a step over the plaza's edge
  const bStairs = stairs(J, ST, 2986, TUN, { base: TUN });   // the B stairs, down to the B doors corridor
  m.floor(2564, bStairs(ST + 24), ST);              // CT mid's floor: from the hatch (x 2520..2564) to the B stairwell
  hard(J, ST, R, TUN);                              // the plaza's ground
  hard(R - 60, -560, R, ST);                        // the minaret in the plaza's corner,
  m.box(R - 70, -470, R, -460);                     // its balcony,
  m.box(R - 45, -640, R - 15, -560);                // and its lantern

  // ---- Spawn points ---------------------------------------------------------------------------
  for (let i = 0; i < 11; i++) m.spawn(70 + 34 * i, TSP, 1);    // T: the terrace
  for (let i = 0; i < 10; i++) m.spawn(J + 36 + 28 * i, ST, 2); // CT: the plaza

  // ---- Items (for the other modes; Defuse has its own) ---------------------------------------
  m.item('armour', 90, TSP).item('Magnum', 250, TSP);
  m.item('SR', 1000, LONG).item('health', 1700, LONG);
  m.item('Uzi', 860, ST).item('M4', 1300, ST).item('Shotgun', 2000, ST);
  m.item('GrenadeLauncher', 1150, TUN).item('Shotgun', 1700, TUN).item('health', 2150, TUN);
  m.item('health', 2550, ASITE).item('armour', 2320, TUN);
  m.item('M4', 2800, ST);
  m.item('armour', 3450, ST).item('health', 3550, ST);

  // ---- Objectives -----------------------------------------------------------------------------
  m.site('A', PAL[0], 2600, ASITE);
  m.site('B', B_IN[0], B_IN[1], TUN);
  // King of the hill, moving each minute: the mid doors (about as far for both teams), the
  // xbox courtyard (mid, nearer T), the tunnels by B (about even), then A (nearer CT).
  m.hill(1760, 1990, ST);
  m.hill(1255, 1495, ST);
  m.hill(1800, 2050, TUN);
  m.hill(PAL[0], 2600, ASITE);
  return m;
}
