# Stick Soldiers

A browser remake of **Stick Soldiers II** (Whitespace Unlimited, 2003): a side-on, black-and-white stick-figure shooter where you grab weapons, armour and jetpacks lying around the map and frag your way to the limit.

**Play it:** <https://dec3ptor.github.io/StickFighters/>

## What's in it

- **All 8 original maps**, decoded from the original game's files: Fire in the Hole, Habitat, King of the Hill, Fraghouse, Sniping Grounds, Fatality Zone, Hells Steeple and Two Towers.
- **8 weapons** using the original's fire rates, damage, accuracy and ammo: Platinum pistol, Uzi, M4, shotgun, sniper rifle (laser sight and zoom), grenade launcher, bazooka and flamethrower.
- **Health, armour, jetpacks and jump pads**, placed where the original had them. Dead soldiers drop their weapon.
- **Stick figures animated with the original game's leg animations**. Arms follow your aim at any angle, and the dead fall apart. No original art is used: everything is drawn in code.
- **Bots** that get around every map, go for weapons and health, and fight with human-like aim and reactions. There are 10 personalities and three skill levels.
- **Free-for-all and team deathmatch**, with 1–9 bots.
- **The original game's sound effects**, from the Stick Soldiers Python fan project (see [`web/sounds/CREDITS.md`](web/sounds/CREDITS.md)). The headshot hitmarker and a few others are generated in code. The original game had no music.
- **Headshots** do double damage (2.5× with the sniper rifle), and you hear a hitmarker tick when you land one.
- **A map maker**: build your own maps in the browser, test-play them against bots, and share them with a link (see below).
- **Game speed fixed at 75%** of the original tuning: movement, jumps, bullets, grenades and fire rates are slowed, while the game keeps updating 60 times a second. Jumps keep their height, so every map stays climbable. A hidden speed picker can be switched back on with `SHOW_SPEED_MENU` in `web/src/config.js`.

## Controls

| Action | Keys |
|---|---|
| Move | `A` `D` (or arrow keys) |
| Jump | `W` or `Space`; hold for a higher jump |
| Jetpack | hold jump in the air, or hold `Shift` |
| Crouch | `S` |
| Aim / fire | mouse / left click |
| Sniper zoom | right click |
| Switch weapon | `1`–`8`, `Q` / `E`, or mouse wheel |
| Scores / pause / mute | `Tab` / `Esc` / `M` |

## Map maker

Click **Map maker** on the main menu, or **+ Make a new map** under the map list.

- **Draw** platforms (`P`) and jump pads (`J`) by dragging. Click to place spawn points (`S`, blue or red team), weapons (`W`), health (`H`), armour (`A`) and jetpacks (`K`). Pickups and spawns drop onto the floor below where you click, unless you turn that off.
- **Edit** with the select tool (`V`): drag things to move them, and drag the corner squares to resize. Right-click or `Del` deletes, `Ctrl+D` duplicates, arrow keys nudge, and `Ctrl+Z` / `Ctrl+Y` undo and redo. The mouse wheel zooms, dragging empty space moves the view, and `F` fits the whole map.
- **Map check** runs the bots' route planner over your map. It flags pits you can't climb out of, areas you can't get to, spawns inside walls or over the void, and pickups nobody can reach. Click a problem to see where it is. Test play won't start while the map has errors.
- **Test play** starts a match on your map with the menu's settings. The pause menu then has **Back to map maker**.
- **Saving** is automatic, in your browser. Your maps appear in the menu's map list with an **Edit** button.
- **Sharing:** **Copy share link** puts the whole map in the link itself, so there's no server involved. Opening the link adds the map to the other player's list and selects it.
- **Files:** export and import maps as `.json`, or as the original game's `.ssm` format. **Open… → Copy & edit** starts a new map from one of the 8 originals.

Falling below the dashed line at the bottom of the map kills you. The map's edges are worked out from what you place.

## Running it locally

Needs [Node.js](https://nodejs.org/) 20 or newer.

```sh
npm start            # serves the game at http://localhost:8080
npm test             # game logic tests: physics, weapons, pickups, bots on every map
npm install && npx playwright install chromium
npm run test:browser # in Chromium: plays two matches, builds and test-plays a map in the map maker,
                     # opens a share link; saves screenshots to test-results/
```

There's no build step: the game is plain JavaScript modules in `web/`, and the browser loads them directly.

## Publishing

Every push runs the tests. Pushes to the repo's default branch then publish `web/` to GitHub Pages (`.github/workflows/pages.yml`). Work happens on `main`, so `main` should be the default branch: **Settings → General → Default branch**.

GitHub Pages has to be switched on once: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Project layout

| Path | What it is |
|---|---|
| `web/index.html`, `web/style.css` | The page: menu, pause and results screens |
| `web/src/game.js` | One match: soldiers, spawning, frags, win conditions (no browser code, so tests can run it) |
| `web/src/physics.js` | Movement and collision, shared by players, bots and the bots' route planner |
| `web/src/combat.js`, `weapons.js` | Firing, projectiles, explosions, damage; weapon stats |
| `web/src/nav.js`, `bot.js` | Bot route planning and bot behaviour |
| `web/src/editor.js` | The map maker |
| `web/src/custommaps.js`, `mapstore.js` | Custom maps: checking them, share links, `.ssm` files, saving in the browser |
| `web/src/stickman.js` | Builds each stick figure from the original animation poses |
| `web/src/render.js`, `hud.js`, `audio.js`, `input.js`, `main.js` | Drawing, HUD, sound, controls and page wiring |
| `web/data/` | The 8 maps and the leg animations, decoded from the original game |
| `web/sounds/` | The original game's sound effects ([credits](web/sounds/CREDITS.md)) |
| `tests/` | Headless tests (`npm test`) and the browser test |
| [`reference/ss2/`](reference/ss2/README.md) | Everything decoded from the original game, with previews |
| [`docs/ss2-file-formats.md`](docs/ss2-file-formats.md) | The original game's file formats |
| `tools/ss2/extract.py` | Rebuilds `reference/ss2/` from the original `ss2.zip` |

## Design notes

- **Jump height.** The original's physics constants are lost, so they were tuned against its maps. A jump reaches about 168 px and jump pads launch 2.05× their stored "bounce" value. Those are the smallest values that let you climb out of every pit and back up every tower in all 8 maps. A test checks that every map stays fully connected.
- **Bots.** The bots' route planner finds every spot a soldier can stand on. It then tries walks, jumps (including mid-air direction changes) and drops from each spot with the same physics code the game uses, so every planned move is one the bot can actually perform.
- **Floating pickups.** Items sit exactly where the original map files put them, which is often 20–50 px above the floor. You may need to hop to grab some.

## Ideas for what's next

- Online multiplayer (peer-to-peer over WebRTC, which works on a static site)
- The 8 weapons cut from the original (AK-47, MP5K, 20mm cannon, Beretta, rocket launcher, C4, blaster, "Shocker"), now that their stats are decoded
- Capture the flag (the original started it but never finished it)
- Touch controls for phones and tablets

## Credits

The original Stick Soldiers and Stick Soldiers II were made by Tim Cowley, Dylan Allison and Andrew Vehlies (Whitespace Unlimited). This remake uses map layouts, weapon numbers, animation poses and sound effects from their game. The sound effects came via the Stick Soldiers Python fan project. All code and art here are new.
