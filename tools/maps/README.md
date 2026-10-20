# Map tools

The maps that come with the game (beyond the 8 originals) are built in code:
each is a script in `designs/` that lays out boxes with the helpers in `lib.mjs`.

    node tools/maps/build.mjs [name...]      write designs to web/data/maps/ and list them in index.json
    node tools/maps/check.mjs <name>         reachability, objectives, travel times (exit code 1 on errors)
    node tools/maps/check.mjs <name> --play ctf,conquest --bots 16 --seconds 120
                                             bots-only matches: kills, captures, stuck bots
    node tools/maps/preview.mjs <name> [out.png] [--nav] [--scale 0.5]
                                             a picture of the map (--nav marks where bots can stand)

`<name>` is a design (`summit`), a map file in `web/data/maps/` (`ssdm1`), or a path to a `.json` map.

A design exports `info` (`{ modes, size, players }`; the first mode is the one the
menu picks with the map) and a default function returning a `MapBuilder`:

```js
import { MapBuilder } from '../lib.mjs';
export const info = { modes: ['ctf', 'koth', 'team'], size: 'small', players: '4-12' };
export default function () {
  const m = new MapBuilder('Crossfire');
  m.floor(-1100, -200, 0);          // a floor from x -1100 to -200, its top at y 0
  m.spawn(-1000, 0, 1);             // a blue spawn point standing on it
  m.flag(1, -1050, 0);              // blue's flag stand
  m.mirror(0);                      // the same on the right, for red
  m.hill(-80, 80, -200);            // king of the hill
  m.point('A', -700, -500, 0);      // conquest
  m.mcom(1, 300, 0);                // rush: sector 1 (blue attacks)
  return m;
}
```

Physics to design around: a jump climbs about 97 px and carries about 137 px
across; soldiers step up 10 px without jumping; they're 34 px tall and 12 wide;
jump pads launch about 40 px (strength 3), 110 (5), 220 (7), 370 (9) or 660 (12). Soldiers run
about 150 px a second, so a 7,000 px map takes 45 seconds to cross on foot.
