# Stick Soldiers

A browser remake of **Stick Soldiers II** (Whitespace Unlimited, 2003): a side-on, black-and-white stick-figure shooter where you grab weapons, armour and jetpacks lying around the map and frag your way to the limit. Now with online multiplayer, four game modes and 35 weapons, many of them borrowed from the Worms games.

**Play it:** <https://dec3ptor.github.io/StickFighters/>

## What's in it

- **Online multiplayer**: quick match, a server browser, hosting your own game (public, or invite-link only), chat, and bots that fill empty slots and make room as people join. No game server: players connect directly to each other (see [Online play](#online-play)).
- **Four modes**: free-for-all, team deathmatch, **gun game** and **one in the chamber**.
- **35 weapons**: the original eight with their original numbers, plus Worms-style ones like sheep, the Holy Hand Grenade, air strikes and the ninja rope (full list below). **Supply crates** parachute in with random weapons.
- **All 8 original maps**, decoded from the original game's files: Fire in the Hole, Habitat, King of the Hill, Fraghouse, Sniping Grounds, Fatality Zone, Hells Steeple and Two Towers.
- **A map maker** with mirror editing, spawn loadouts, test play, share links and **community maps** anyone can browse and play.
- **Health, armour, jetpacks and jump pads**, placed where the original had them. Dead soldiers drop their weapon.
- **Stick figures animated with the original game's leg animations**. Arms follow your aim at any angle, and the dead fall apart. No original art is used: everything is drawn in code.
- **Bots** that get around every map, go for weapons, health and crates, and fight with human-like aim and reactions. They use every weapon: they lob grenades, call air strikes on you, steer super sheep and set them off next to you. There are 10 personalities and three skill levels.
- **The original game's sound effects**, from the Stick Soldiers Python fan project (see [`web/sounds/CREDITS.md`](web/sounds/CREDITS.md)). The new weapons' sounds (sheep included) are generated in code. The original game had no music.
- **Headshots** do double damage (2.5× with the sniper rifle, 2× with the bow), and you hear a hitmarker tick when you land one.
- **Game speed fixed at 75%** of the original tuning: movement, jumps, bullets, grenades and fire rates are slowed, while the game keeps updating 60 times a second. Jumps keep their height, so every map stays climbable. A hidden speed picker can be switched back on with `SHOW_SPEED_MENU` in `web/src/config.js`.

## Game modes

| Mode | How it works |
|---|---|
| Free-for-all | Everyone for themselves. First to the frag limit wins. |
| Team deathmatch | Blue against red, no friendly fire. First team to the frag limit wins. |
| Gun game | Everyone starts with the pistol, and every kill moves you to the next of 16 weapons (pistol, magnum, Uzi, minigun … super sheep, baseball bat). The first kill with the bat wins. Get knocked off by a prod and you go back a weapon; so does killing yourself. Unlimited ammo, no pickups. |
| One in the chamber | A pistol with one bullet that kills in one hit, and a baseball bat that does too. Every kill gives you a bullet. Everyone has 3 lives (1–5 in the setup); the last one standing wins. No pickups. |

Modes live in [`web/src/modes.js`](web/src/modes.js): each one decides what you spawn with, which pickups are around, how damage, kills and scores work, and who wins. Adding a mode means adding an entry there.

## Weapons

Number keys pick a slot; press the same key again to cycle through what you own in that slot. **The further the mouse is from you, the harder you throw.** Click again to set off a sheep or let go of the rope.

| Key | Weapons |
|---|---|
| `1` Pistols | Platinum (infinite, reloads), Magnum |
| `2` Automatics | Uzi, Minigun (spins up first, slows you down while firing) |
| `3` Rifles | M4 Carbine, Longbow (arrows drop with distance and stick in walls) |
| `4` Shotguns | Shotgun |
| `5` Precision | Sniper Rifle (laser, zoom), Magic Bullet (homes in on the nearest enemy) |
| `6` Grenades | Grenade Launcher, Cluster Bomb, Banana Bomb (very bouncy, bursts into more bananas), Holy Hand Grenade (sings, then a huge blast) |
| `7` Rockets | Bazooka, Homing Missile, Mortar (falls, then bursts) |
| `8` Fire & gas | Flamethrower, Petrol Bomb (leaves burning petrol), Skunk (poison gas) |
| `9` Animals & explosives | Sheep (walks, hops walls, click to explode), Super Sheep (flies where you point), Old Woman, Mad Cows, Dynamite, Mines |
| `0` Specials | Air Strike, Napalm Strike, Concrete Donkey (smashes through every floor it falls through), Earthquake, Teleport, Kamikaze, Ninja Rope |
| `F` Melee | Prod (everyone has one: no damage, but great for pushing people off ledges), Baseball Bat (home runs), Battle Axe (halves their health), Fire Punch (uppercut) |

Air strikes, napalm, the donkey and teleports go where your mouse is. Weapons are defined as data in [`web/src/weapons.js`](web/src/weapons.js), with their behaviour in [`web/src/combat.js`](web/src/combat.js).

## Controls

| Action | Keys |
|---|---|
| Move | `A` `D` (or arrow keys) |
| Jump | `W` or `Space`; hold for a higher jump |
| Jetpack | hold jump in the air, or hold `Shift` |
| Crouch | `S` |
| Aim / fire | mouse / left click |
| Sniper zoom | right click |
| Switch weapon | `1`–`0`, melee `F` (press again to cycle), `Q` / `E`, or mouse wheel |
| Ninja rope | click to fire, `W` / `S` to climb, `A` / `D` to swing, click again to let go |
| Chat (online) | `Enter` or `T` |
| Scores / menu / mute | `Tab` / `Esc` / `M` |

## Online play

- **Quick match** joins the fullest open game that has room. If there isn't one, it starts a game for others to find.
- **Host a game** uses the same setup as offline play (any map: originals, your own, or community maps), plus a name, a player limit, and whether it's listed or invite-only. Press `Esc` in the game to copy an **invite link**.
- The **server browser** lists open games as they're hosted, with their map, mode and players.

How it works, with no game server:

- **The host's browser runs the match.** Everyone else sends their inputs to the host 60 times a second, and gets back a snapshot of the whole game 20 times a second (about 1–2 KB in binary), plus the sounds, effects and kill feed. Your own soldier moves the instant you press a key (client-side prediction) and is corrected smoothly if the host disagrees. Other players are drawn about 100 ms in the past, so they move smoothly between snapshots.
- **Players connect directly** with WebRTC data channels. To find each other they use **public [Nostr](https://nostr.com/) relays**: hosts post a listing every 20 seconds, and a player who wants to join sends the host a connection offer, encrypted so only the host can read it. The relays used are in [`web/src/net/relays.js`](web/src/net/relays.js), picked by [`tools/probe-relays.mjs`](tools/probe-relays.mjs), which tests public relays from GitHub Actions (the *Probe Nostr relays* workflow).
- **Limits.** If the host leaves, the game ends for everyone. A few networks (some mobile and office networks) block direct connections; joining then fails with a message saying so. Fixing that would need a TURN relay server, which you can add to `ICE_SERVERS` in `relays.js`.
- **Hosting in the background works.** When the host switches tabs, a worker keeps the game running.

## Map maker

Click **Map maker** on the main menu, or **+ Make a new map** under **Your maps**.

- **Draw** platforms (`P`) and jump pads (`J`) by dragging. Click to place spawn points (`S`, blue or red team), weapons (`W`), health (`H`), armour (`A`) and jetpacks (`K`). Pickups and spawns drop onto the floor below where you click, unless you turn that off.
- **Edit** with the select tool (`V`): drag things to move them, and drag the corner squares to resize. Right-click or `Del` deletes, `Ctrl+D` duplicates, arrow keys nudge, and `Ctrl+Z` / `Ctrl+Y` undo and redo. The mouse wheel zooms, dragging empty space moves the view, and `F` fits the whole map.
- **Mirror editing** (`M`): anything you add, move, resize or delete is copied to the other side of a mirror line (purple; you can move it). Spawns can swap blue and red on the other side. **Copy left → right** and **Copy right → left** rebuild one half from the other, and **Mirror to other side** copies one thing.
- **Everyone spawns with**: pick weapons, armour and a jetpack that every player starts with on your map (in free-for-all and team games).
- **Map check** runs the bots' route planner over your map. It flags pits you can't climb out of, areas you can't get to, spawns inside walls or over the void, and pickups nobody can reach. Click a problem to see where it is. Test play won't start while the map has errors.
- **Test play** starts a match on your map with the menu's settings. The menu (`Esc`) then has **Back to map maker**.
- **Saving** is automatic, in your browser. Your maps are under **Your maps** in the setup, with an **Edit** button.
- **Sharing:** **Copy share link** puts the whole map in the link itself. Opening the link adds the map to the other player's list and selects it. **Upload to community** publishes it (on the same public relays) for everyone to find under **Community**; uploading again replaces it, and you can remove your own.
- **Files:** export and import maps as `.json`, or as the original game's `.ssm` format. **Open… → Copy & edit** starts a new map from one of the 8 originals.

Falling below the dashed line at the bottom of the map kills you. The map's edges are worked out from what you place.

## Running it locally

Needs [Node.js](https://nodejs.org/) 20 or newer.

```sh
npm install
npm start            # serves the game at http://localhost:8080
npm run relay        # optional: a local Nostr relay at ws://localhost:7447, for online play without the internet:
                     # open http://localhost:8080/?relay=ws://localhost:7447 in two windows, host in one, join in the other
npm test             # game logic: physics, bots, weapons, modes, netcode, lobby (through a local relay)
npx playwright install chromium
npm run test:browser # in Chromium: plays matches, uses the map maker, and plays online between three browsers
```

There's no build step: the game is plain JavaScript modules in `web/`, and the browser loads them directly. The only library is [noble-secp256k1](https://github.com/paulmillr/noble-secp256k1) (in `web/vendor/`), for signing relay messages.

## Publishing

Every push runs the tests. Pushes to the repo's default branch then publish `web/` to GitHub Pages (`.github/workflows/pages.yml`). Work happens on `main`, so `main` should be the default branch: **Settings → General → Default branch**.

GitHub Pages has to be switched on once: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Project layout

| Path | What it is |
|---|---|
| `web/index.html`, `web/style.css` | The page: menus, pause and results screens, chat |
| `web/src/game.js` | One match: soldiers, spawning, frags, win conditions (no browser code, so tests can run it) |
| `web/src/modes.js` | Game modes: free-for-all, team, gun game, one in the chamber |
| `web/src/physics.js` | Movement, collision and the ninja rope, shared by players, bots and the bots' route planner |
| `web/src/combat.js`, `weapons.js` | Firing, projectiles, payloads, explosions, damage; weapon data |
| `web/src/pickups.js` | Items on the map, dropped weapons, supply crates |
| `web/src/nav.js`, `bot.js` | Bot route planning and bot behaviour |
| `web/src/net/` | Online play: `protocol.js` (snapshots and inputs), `host.js`, `client.js` (prediction, interpolation), `peer.js` (WebRTC), `lobby.js` (finding and joining games), `community.js` (community maps), `nostr.js` (relay client), `relays.js` |
| `web/src/editor.js` | The map maker |
| `web/src/custommaps.js`, `mapstore.js` | Custom maps: checking them, share links, `.ssm` files, saving in the browser |
| `web/src/stickman.js`, `sprites.js` | The stick figures, and drawings of weapons, animals and crates |
| `web/src/render.js`, `hud.js`, `audio.js`, `input.js`, `main.js` | Drawing, HUD, sound, controls and page wiring |
| `web/data/` | The 8 maps and the leg animations, decoded from the original game |
| `web/sounds/` | The original game's sound effects ([credits](web/sounds/CREDITS.md)) |
| `tests/` | Headless tests (`npm test`) and browser tests (`tests/browser/`) |
| `tools/` | Local web server, local Nostr relay, relay probe, and `ss2/extract.py` (rebuilds `reference/ss2/` from the original `ss2.zip`) |
| [`reference/ss2/`](reference/ss2/README.md) | Everything decoded from the original game, with previews |
| [`docs/ss2-file-formats.md`](docs/ss2-file-formats.md) | The original game's file formats |

## Design notes

- **Jump height.** The original's physics constants are lost, so they were tuned against its maps. A jump reaches about 168 px and jump pads launch 2.05× their stored "bounce" value. Those are the smallest values that let you climb out of every pit and back up every tower in all 8 maps. A test checks that every map stays fully connected.
- **Bots.** The bots' route planner finds every spot a soldier can stand on. It then tries walks, jumps (including mid-air direction changes) and drops from each spot with the same physics code the game uses, so every planned move is one the bot can actually perform.
- **Floating pickups.** Items sit exactly where the original map files put them, which is often 20–50 px above the floor. You may need to hop to grab some.
- **Same game everywhere.** Offline, hosting and joining all run the same `Game` code. The host records every sound and effect as it happens and sends them on, and players draw trails (rocket smoke, jetpack flames) themselves, from what's in the snapshots.

## Ideas for what's next

- More modes: capture the flag (the original started it but never finished it), king of the hill
- The rest of the weapons cut from the original (AK-47, MP5K, 20 mm cannon, Beretta, C4, blaster, "Shocker")
- Host migration, so a game survives the host leaving
- Touch controls for phones and tablets

## Credits

The original Stick Soldiers and Stick Soldiers II were made by Tim Cowley, Dylan Allison and Andrew Vehlies (Whitespace Unlimited). This remake uses map layouts, weapon numbers, animation poses and sound effects from their game. The sound effects came via the Stick Soldiers Python fan project. The Worms-style weapons are affectionate nods to Team17's Worms series; all code and art here are new.
