// Hand-placed objectives for the 8 original maps (ssdm1..ssdm7, ssteam1), which
// came from the 2003 game without any. Writes each map's "objectives" (placed
// right after "items") into web/data/maps/<name>.json and leaves everything else
// in the file exactly as it was, so running it again gives the same files.
//
// Usage: node tools/maps/originals.mjs [name...]     (no names: all 8 maps)
//
// y points down; a hill/point's bottom and a flag/M-COM's y are the top of the
// floor it stands on. Blue is team 1, red team 2; Rush has blue attacking red.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAPS = fileURLToPath(new URL('../../web/data/maps/', import.meta.url));

const hill = (left, right, floor, h = 90) => ({ type: 'hill', left, top: floor - h, right, bottom: floor });
const flag = (team, x, y) => ({ type: 'flag', team, x, y });
const point = (label, left, right, floor, h = 100) => ({ type: 'point', label, left, top: floor - h, right, bottom: floor });
const mcom = (sector, x, y) => ({ type: 'mcom', sector, x, y });

export const OBJECTIVES = {
  // Fire in the Hole: mirrored about x 0, blue on the left. Hills in the hole
  // and on the centre column (the hole is point B too); the flags sit on the
  // low outer ledges.
  ssdm1: [
    hill(-100, 100, 120),                 // in the hole
    hill(-90, 90, -96, 88),               // the middle step of the centre column
    flag(1, -620, 96),
    flag(2, 620, 96),
    point('A', -350, -160, -40),          // blue's middle tier
    point('B', -100, 100, 120),           // the hole
    point('C', 160, 350, -40),            // red's middle tier
    mcom(1, 0, -96),                      // the middle step of the centre column
    mcom(1, 64, 120),                     // the hole, red half
    mcom(2, 444, -88),                    // red's high outer ledge
    mcom(2, 600, 96),                     // red's low outer ledge
  ],

  // Habitat: mirrored about x 400.5, blue on the RIGHT. Hills on the mound at the
  // bottom and on top of the T in the middle.
  ssdm2: [
    hill(320, 481, 496),                  // the mound
    hill(300, 501, 224),                  // top of the T
    flag(1, 756, 416),
    flag(2, 45, 416),
    point('A', 488, 680, 528),            // blue's half of the bottom floor
    point('B', 300, 501, 224),            // top of the T
    point('C', 121, 313, 528),            // red's half of the bottom floor
    mcom(1, 400, 192),                    // top of the T
    mcom(1, 400, 432),                    // top of the mound
    mcom(2, 270, 416),                    // red's floor, by the tower
    mcom(2, 64, 224),                     // red's high outer ledge
  ],

  // King of the Hill: mirrored about x 400.5, blue on the right. The hill on
  // top of the middle structure, and the mound underneath.
  ssdm3: [
    hill(304, 497, 272, 96),              // the hill (with its two posts and the slab above)
    hill(330, 471, 528, 88),              // the mound below
    flag(1, 760, 384),
    flag(2, 41, 384),
    point('A', 584, 764, 384),            // blue's floor
    point('B', 304, 497, 272, 96),        // the hill
    point('C', 37, 217, 384),             // red's floor
    mcom(1, 360, 272),                    // on the hill, red's side
    mcom(1, 400, 480),                    // top of the mound
    mcom(2, 220, 144),                    // red's upper ledge
    mcom(2, 60, 560),                     // bottom floor, red's corner
  ],

  // Fraghouse: mirrored about x 400, blue on the right. Three hills stacked in
  // the middle (on the roof, under it, and on the ground floor).
  ssdm4: [
    hill(300, 500, 352),                  // under the roof
    hill(300, 500, 232),                  // on the roof
    hill(304, 496, 496, 86),              // ground floor, between the bumps
    flag(1, 720, 400),
    flag(2, 80, 400),
    point('A', 590, 760, 400, 96),        // blue's middle floor
    point('B', 300, 500, 352, 90),        // under the roof
    point('C', 40, 210, 400, 96),         // red's middle floor
    mcom(1, 400, 200),                    // on the roof
    mcom(1, 400, 496),                    // ground floor, in the middle
    mcom(2, 130, 304),                    // red's top floor
    mcom(2, 100, 504),                    // ground floor, red's corner
  ],

  // Sniping Grounds: mirrored about x 0, blue on the right. The hill is the
  // little platform over the gap in the middle; A and C are the two forts and
  // the flags sit on their sniper towers.
  ssdm5: [
    hill(-80, 80, 80),
    flag(1, 380, -96),                    // on the sniper towers
    flag(2, -380, -96),
    point('A', 264, 472, 80, 90),         // blue's fort
    point('B', -90, 90, 80),              // the middle platform
    point('C', -472, -264, 80, 90),       // red's fort
    mcom(1, 0, 80),                       // the middle platform (just one: nowhere else is neutral)
    mcom(2, -340, -96),                   // red's sniper tower
    mcom(2, -590, 112),                   // red's back corner
  ],

  // Fatality Zone: mirrored about x 0, blue on the LEFT. Hills at the top of
  // the middle and across the deadly gap at the bottom.
  ssdm6: [
    hill(-100, 100, -264),                // top of the middle
    hill(-110, 110, 264),                 // over the gap at the bottom
    flag(1, -540, -136),
    flag(2, 540, -136),
    point('A', -270, -100, -56, 94),      // blue's dip
    point('B', -110, 110, -264, 96),      // top of the middle
    point('C', 100, 270, -56, 94),        // red's dip
    mcom(1, 0, -312),                     // the very top of the middle
    mcom(1, 60, 264),                     // the bottom floor, red's side of the gap
    mcom(2, 500, -136),                   // red's block
    mcom(2, 440, 264),                    // the bottom floor, red's side
  ],

  // Hells Steeple: mirrored about x 0, blue on the right. Hills on the ledges
  // inside the steeple; the floor outside it is each team's base.
  ssdm7: [
    hill(-104, 104, 128),                 // the low ledges inside the steeple
    hill(-104, 104, -56),                 // the middle ledges inside the steeple
    flag(1, 480, 416),
    flag(2, -480, 416),
    point('A', 180, 360, 416),            // blue's block
    point('B', -104, 104, 128),           // inside the steeple
    point('C', -360, -180, 416),          // red's block
    mcom(1, -80, 128),                    // inside the steeple, red's low ledge
    mcom(1, -80, -56),                    // inside the steeple, red's middle ledge
    mcom(2, -272, 368),                   // red's block
    mcom(2, -440, 416),                   // red's back corner
  ],

  // Two Towers: mirrored about x 440, blue on the right. Flags on top of the
  // towers; hills at the bottom of the bowl between them and up top.
  ssteam1: [
    hill(350, 530, 592, 92),              // bottom of the bowl
    hill(330, 550, 16, 108),              // the platforms up top
    flag(1, 704, 112),
    flag(2, 176, 112),
    point('A', 620, 790, 176, 92),        // blue's tower top
    point('B', 330, 550, 592, 98),        // bottom of the bowl
    point('C', 90, 260, 176, 92),         // red's tower top
    mcom(1, 440, -16),                    // the top platform in the middle
    mcom(1, 260, 336),                    // red's sniper ledge
    mcom(2, 116, 176),                    // red's tower top, outer corner
    mcom(2, 190, 608),                    // the bottom of red's tower
  ],
};

/** The map with its objectives put in after "items" (replacing any it had). */
export function withObjectives(data, objectives) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'objectives') continue;
    out[k] = v;
    if (k === 'items') out.objectives = objectives;
  }
  if (!out.objectives) out.objectives = objectives;
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const names = process.argv.slice(2);
  for (const name of names.length ? names : Object.keys(OBJECTIVES)) {
    if (!OBJECTIVES[name]) { console.log(`${name}: not an original map (${Object.keys(OBJECTIVES).join(', ')})`); process.exitCode = 1; continue; }
    const file = `${MAPS}${name}.json`;
    const before = readFileSync(file, 'utf8');
    const after = JSON.stringify(withObjectives(JSON.parse(before), OBJECTIVES[name]), null, 2) + '\n';
    if (after === before) { console.log(`${name}: unchanged`); continue; }
    writeFileSync(file, after);
    console.log(`${name}: wrote ${OBJECTIVES[name].length} objectives`);
  }
}
