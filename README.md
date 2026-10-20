# Stick Soldiers

A browser remake of **Stick Soldiers II** (Whitespace Unlimited, 2003): a side-on, black-and-white stick-figure shooter where you grab weapons, armour and jetpacks lying around the map and frag your way to the limit. Now with online multiplayer, eight game modes (Battlefield-style Conquest and Rush among them) and 35 weapons, many of them borrowed from the Worms games.

**Play it:** <https://dec3ptor.github.io/StickFighters/>

## What's in it

- **Online multiplayer**: quick match, a server browser, hosting your own game (public, or invite-link only), chat, and bots that fill empty slots and make room as people join. No game server: players connect directly to each other (see [Online play](#online-play)).
- **Eight modes**: free-for-all, team deathmatch, **gun game** and **one in the chamber**, plus four objective modes for two teams: **king of the hill**, **capture the flag**, and Battlefield-style **Conquest** and **Rush**.
- **Battlefield-style classes** (switched off for now: add `?classes` to the address to try them): **Assault**, **Engineer**, **Support** and **Recon**, each spawning with its own kit and a gadget on `G` (medkits, ammo boxes, spawn beacons, and the Engineer's **Builder**, which puts up walls and planks and repairs what explosions broke), with a **Loadout** screen for each class's weapons and upgrades (see [Classes](#classes)).
- **35 weapons**: the original eight with their original numbers, plus Worms-style ones like sheep, the Holy Hand Grenade, air strikes and the ninja rope (full list below). **Supply crates** parachute in with random weapons.
- **All 8 original maps**, decoded from the original game's files: Fire in the Hole, Habitat, King of the Hill, Fraghouse, Sniping Grounds, Fatality Zone, Hells Steeple and Two Towers.
- **10 new maps**, from small to huge:
  - **Small** (4–16 players): **Summit** (a stepped mountain, made for king of the hill) and **Pit Stop** (a garage with three rotating hills), and **Crossfire** (bunkers and three lanes) and **Twin Keeps** (two castles across a moat), made for capture the flag.
  - **Medium** (8–24 players): **Foundry** (catwalks over molten pits) and **Skyline** (rooftops with deadly gaps).
  - **Large** (16–64 players, up to 8,000 px wide): **Frontline** (trenches, a ruined village and the defenders' HQ) and **Citadel** (from the beach up to a hilltop keep), made for Rush, and **Harbor** (ships, container stacks and a gantry crane) and **Valley** (hills, caves and a river gorge, with 7 capture points), made for Conquest.
  - Every map, the originals included, has hills, flags, capture points and M-COMs for all four objective modes. Picking a map in the setup switches to the mode it's made for and raises the bots to its smallest player count.
- **Destructible maps** (setup → **Destruction**, on by default): explosions blow holes in walls, floors and platforms, so you can blast a way through a wall, drop enemies through the floor, or dig into a hill. The bigger the blast, the bigger the hole (a bazooka goes through a wall; the Holy Hand Grenade takes a big bite out of anything). Floors that spawn points, flags, M-COMs, hills and capture points stand on can't be destroyed, so every mode keeps working; neither can jump pads, or platforms a map maker marks indestructible. Blocks that can't be destroyed are lightly hatched. Bots find their way through new holes, and in online games everyone sees the same holes, including players who join late.
- **A map maker** with mirror editing, spawn loadouts, test play, share links and **community maps** anyone can browse and play.
- **Health, armour, jetpacks and jump pads**, placed where the original had them. Dead soldiers drop their weapon. Picking up a new weapon only takes it out if you're holding the starting pistol; otherwise it goes in your inventory (the message says which key selects it).
- **Experimental options** (in the game setup and in **Settings**, under **Experimental**):
  - **Bot vision: only what they see or hear.** Bots spot enemies only on their own screen (a view about as big as yours), in front of them and in a clear line. Behind them, they can only hear you: gunfire, explosions, jetpacks, hard landings and running close by. Creeping along crouched is silent. A bot that hears something turns round and goes to have a look, and a bot standing still looks over its shoulder now and then. The default is the classic bots, which notice anyone nearby in a clear line.
  - **Fog of war.** You only see what your soldier can see from where they stand. Everything out of their line of sight is greyed out, and soldiers there (and what they fire) aren't drawn, teammates included; on big maps the minimap still shows where your team is. Sounds from places you can't see show as orange ripples where they came from, or as arrows at the screen's edge. In online games the host's choice applies to everyone.
- **Stick figures animated with the original game's leg animations**. Arms follow your aim at any angle, and the dead fall apart. No original art is used: everything is drawn in code.
- **Bots** that get around every map, go for weapons, health and crates (but not ones someone else will get to first), and fight with human-like aim and reactions. They use every weapon: they lob grenades, call air strikes on you, steer super sheep and set them off next to you. There are 10 personalities and three skill levels. For huge battles, the bots slider goes up to **4,000** (see [Design notes](#design-notes)).
- **The original game's sound effects**, from the Stick Soldiers Python fan project (see [`web/sounds/CREDITS.md`](web/sounds/CREDITS.md)). The new weapons' sounds (sheep included) are generated in code. The original game had no music.
- **The HUD**: health, armour, ammo and jet fuel sit just above the weapon bar at the bottom, with stamina in a thin strip under them. A ring round the crosshair fills up while you reload (the pistol's magazine, or the wait between shots of slow guns like the sniper rifle and rocket launchers): when it's full, you can fire.
- **Headshots** do double damage (2.5× with the sniper rifle, 2× with the bow), and you hear a hitmarker tick when you land one.
- **Smooth on high refresh rate screens**: the game draws a frame every time your screen refreshes (60, 120, 144, 240 Hz...). It still updates 60 times a second, and everything moving (soldiers, bullets, rockets, particles, falling crates, running legs) is drawn part way between updates, while your gun follows the mouse on every frame.
- **Drawn with the plain 2D canvas** by default, or with **WebGL** (through [PixiJS](https://pixijs.com/)) if you pick it in Settings. Both draw exactly the same picture. **Auto** picks WebGL on computers with a graphics card and the canvas on ones without, where it's faster.
- **Settings** (on the main menu and the pause menu):
  - **Graphics**: Canvas (the default), WebGL or Auto. Switches straight away, even mid-match.
  - **Experimental**: the same bot vision and fog of war choices as the game setup, for the next game you start or host.
  - **Frame rate**: Auto, or a cap from 30 to 240 fps. Auto draws at your screen's refresh rate; if your computer can't keep up, it drops to an even fraction of it (144 → 72) so frames stay evenly spaced, and tries the full rate again later.
  - **Show frame rate** and **show ping in online games**.
  - **Sprint**: hold `Shift` to sprint, or press it to start and stop. The scoreboard (`Tab`) shows everyone's ping in online games.
  - They're remembered between visits. `?renderer=webgl` / `?renderer=canvas` and `?fps` in the address override them.
- **Game speed fixed at 75%** of the original tuning: movement, jumps, bullets, grenades and fire rates are slowed, while the game keeps updating 60 times a second. Jumps keep their height, so every map stays climbable. A hidden speed picker can be switched back on with `SHOW_SPEED_MENU` in `web/src/config.js`.

## Game modes

| Mode | How it works |
|---|---|
| Free-for-all | Everyone for themselves. First to the frag limit wins. |
| Team deathmatch | Blue against red, no friendly fire. First team to the frag limit wins. |
| Gun game | Everyone starts with the pistol, and every kill moves you to the next of 16 weapons (pistol, magnum, Uzi, minigun … super sheep, baseball bat). The first kill with the bat wins. Get knocked off by a prod and you go back a weapon; so does killing yourself. Unlimited ammo, no pickups. |
| One in the chamber | A pistol with one bullet that kills in one hit, and a baseball bat that does too. Every kill gives you a bullet. Everyone has 3 lives (1–5 in the setup); the last one standing wins. No pickups. |
| King of the hill | Blue against red over a hill. Your team scores a point every second it has the hill to itself (nothing while both teams are on it). First to the score wins (50–250). On maps with several hills, the hill moves every minute. |
| Capture the flag | Take the other team's flag from their base and bring it to yours; you can only score while your own flag is at home. Kill a carrier and they drop it; touch your own dropped flag to send it home (it goes home by itself after 20 s, or straight away if it falls off the map). First to 1–10 captures wins. |
| Conquest | Like Battlefield: stand in a lettered capture point to take it (about 7 s alone, faster with more of your team, and an enemy point has to be neutralised first). Every death costs your team a ticket, and the team holding fewer points loses tickets every few seconds. Run out and you lose. You can spawn on points your team holds: while you wait, number keys pick **Auto** (the usable place nearest where you died: a point your team holds with no enemies on it, or your base), **Base**, or a point. |
| Rush | Like Battlefield: blue attacks and red defends. Blue arms an M-COM station by standing at it for 2 seconds with no defenders there; red disarms it the same way (7 s). An armed M-COM blows after 14 s, taking anyone close with it. Destroy every M-COM in a sector and the fight moves to the next sector, spawn points move up, and blue's tickets refill. Both teams respawn at their most forward spawn point (nearest the M-COMs still standing), unless enemies are right there. Blue loses a ticket per death; out of tickets with nothing ticking, blue loses. |

In the objective modes, kills don't change the team score; your place on the scoreboard is your score (objective points plus frags). Tickets and points to win are set in the setup (Auto tickets scale with the number of players), and **Your team** picks blue or red (attack or defend, in Rush). The HUD shows how things stand, with markers at the screen's edge pointing to objectives you can't see, and big maps get a minimap.

Modes live in [`web/src/modes.js`](web/src/modes.js) and [`objmodes.js`](web/src/objmodes.js): each one decides what you spawn with, which pickups are around, how damage, kills and scores work, where you spawn, and who wins. Adding a mode means adding an entry there. Where the objectives are comes from the map (see [Map maker](#map-maker)); maps without them get some worked out from their layout ([`objectives.js`](web/src/objectives.js)), so every map plays every mode.

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
| Sprint | `Shift`: about 40% faster, using up stamina (the thin bar over the weapon bar). It lasts about 4 seconds and refills in about 7; run it out and you're winded until it's back to 30%. Hold it, or set it to toggle in Settings |
| Jetpack | hold jump in the air |
| Crouch | `S` or `Ctrl`; your shots spread half as much while crouched (a shotgun's a quarter less) |
| Aim / fire | mouse / left click |
| Sniper zoom | right click |
| Switch weapon | `1`–`0`, melee `F` (press again to cycle), `Q` / `E`, or mouse wheel |
| Ninja rope | click to fire, `W` / `S` to climb, `A` / `D` to swing, click again to let go |
| Self-destruct | hold `K` for a second (the way out of a pit you can't climb out of; counts as a suicide) |
| Spectate | **Spectate** in the menu (`Esc`): sit out and watch (it isn't a death, unless you'd just been hurt; a flag you carry drops). `A` / `D` (or the arrows, or a click) switch who you follow; `Space` gives a free camera (`WASD` or arrows to move, `Shift` faster; `Space` or a click follows whoever's nearest). **Join game** in the menu to play again |
| Gadget (classes, switched off for now) | `G`: drop a medkit or ammo box, place a spawn beacon, or take out the Engineer's Builder (`G` again puts it away) |
| Builder (Engineer, classes) | click to put up a wall, or repair what explosions broke; right click switches between a wall and a plank |
| Change class (classes) | `C` (or click the class box) while waiting to respawn, then `1`–`4` or click a class; or **Change class** in the menu (`Esc`). It applies when you next spawn |
| Chat (online) | `Enter` or `T` |
| Scores / menu / mute | `Tab` / `Esc` / `M` |

During a match the browser's own `Ctrl` shortcuts (bookmark, save, select all...) are blocked, so holding `Ctrl` to crouch never opens one, and closing or leaving the page asks first.

## Classes

**Classes are switched off for now**: nothing about them shows in the menus, and every match is played without them. Add `?classes` to the game's address (for example `https://…/StickFighters/?classes`) to turn them back on and try them. The rest of this section describes them as they are then.

**Classes** is a match option in the game setup: **Off** is the classic game (weapons from pickups and crates), **On** gives everyone a class. It starts on for Conquest and Rush and off for the other modes (your choice is remembered for each mode), and isn't offered in gun game or one in the chamber, which hand out their own weapons. Online, the host's choice applies to everyone. With classes on, the map's weapons aren't there (health, armour and jetpacks are), supply crates still drop, and the dead still drop the weapon in their hands.

| Class | Kit | Gadget (`G`) | Other main weapons |
|---|---|---|---|
| Assault | M4 (120 rounds), Grenade Launcher ×2 | **Medkit**: 60 health for you or a teammate | Shotgun / Uzi |
| Engineer | Bazooka ×3, Uzi (150), Mines ×2 | **Builder**: walls, planks and repairs (below) | Homing Missile / Mortar (instead of the bazooka) |
| Support | Shotgun (16), Dynamite ×2 | **Ammo box**: half a kit's ammo back for you or a teammate | Minigun / Flamethrower |
| Recon | Sniper Rifle (15) | **Spawn beacon**: you and your team can spawn on it | Longbow / Magic Bullet |

Everyone also has the pistol and the prod. Medkits and ammo boxes drop at your feet, only your team can take them (one each lying around at a time, for 40 seconds), and they recharge in 20 seconds. A spawn beacon goes where you stand (it drops to the floor if you're in the air); it becomes your spawn choice, and your team can pick it too, with the number keys while waiting to respawn (Conquest's points are still there; the beacons come after them). Enemies destroy it by shooting it (60 health) or blowing it up; if one's right next to it, you spawn at base instead. Your old beacon goes when you place a new one or respawn as another class.

Pick your class in the setup, with `C` while waiting to respawn (your respawn waits while you choose, for up to 15 seconds), or from the menu (`Esc`). Bots pick a class to suit their personality while spreading out over their team, and use their gadgets: medkits when they or a teammate nearby is hurt, ammo when they're low, and beacons near the objectives (they don't build).

**The Builder.** `G` takes it out (or `0`), and a green outline shows what a click will do (red: it can't, and why if you click). On a destructible map, aiming where an explosion broke the map repairs it: what was there at the start comes back in a 64 px square around where you aim, leaving room for anyone standing in it. Anywhere else, a click puts up a **wall** (12 × 40, standing on the floor below where you aim: cover for a soldier) or, after a right click, a **plank** (64 × 10: a step up, a ledge, a bridge over a hole). It reaches 150 px, not through walls, and a block that would overlap the map fits around it. Not inside anyone, nor next to a spawn point (or, in capture the flag and rush, a flag or M-COM), so nobody can be walled in. Each click uses one of six blocks; one comes back every 5 seconds or so, and ammo boxes give half of them back. Built blocks look like sandbags, and explosions break them even on maps that don't otherwise break.

**Upgrades.** Each kit weapon can carry one upgrade:

| Weapons | Upgrades |
|---|---|
| Guns | **Steady grip**: 40% less spread · **Extended mag**: 50% more ammo and a bigger pistol magazine (12) · **Hollow points**: 25% more damage, 30% less range · **Quick hands**: 20% less time between shots and reloading. (Guns without spread can't take steady grip, nor the flamethrower hollow points.) |
| Explosives | **Bigger charge**: 30% bigger blast · **Extra round**: one more |

The **Loadout** screen (main menu, or *Weapons and upgrades…* in the class picker) lets you pick each class's main weapon and an upgrade for each of its weapons, all available from the start. Your choices are saved in your browser (`localStorage`, apart from the settings). Bots play random kits.

## Online play

- **Quick match** joins the fullest open game that has room. If there isn't one, it starts a game for others to find.
- **Host a game** uses the same setup as offline play (any map: originals, your own, or community maps), plus a name, a player limit, and whether it's listed or invite-only. Press `Esc` in the game to copy an **invite link**.
- The **server browser** lists open games as they're hosted, with their map, mode and players.

How it works, with no game server:

- **The host's browser runs the match.** Everyone else sends their inputs to the host 60 times a second, and gets back a snapshot of the whole game 20 times a second (about 1–2 KB in binary), plus the sounds, effects and kill feed. Your own soldier moves the instant you press a key (client-side prediction) and is corrected smoothly if the host disagrees. Other players are drawn about 100 ms in the past, so they move smoothly between snapshots.
- **Players connect directly** with WebRTC data channels. To find each other they use **public [Nostr](https://nostr.com/) relays**: hosts post a listing every 20 seconds, and a player who wants to join sends the host a connection offer, encrypted so only the host can read it. The relays used are in [`web/src/net/relays.js`](web/src/net/relays.js), picked by [`tools/probe-relays.mjs`](tools/probe-relays.mjs), which tests public relays from GitHub Actions (the *Probe Nostr relays* workflow).
- **Limits.** If the host leaves, the game ends for everyone. A few networks (some mobile and office networks) block direct connections; joining then fails with a message saying so. Fixing that would need a TURN relay server, which you can add to `ICE_SERVERS` in `relays.js`.
- **Hosting in the background works.** When the host switches tabs, a worker keeps the game running.
- **Ping.** Each player measures their round trip to the host every 2 seconds and tells the host, which shares everyone's for the scoreboard.
- **Spectating.** A player who chooses Spectate tells the host, which sits their soldier out (no respawning) and marks them on everyone's scoreboard; they stay a spectator in the following matches until they join again.
- **Classes and building.** Each player's browser sends the host their class and loadouts (when they join and when they change them); the host checks they make sense and uses them from the player's next spawn. Engineers build on the host, and new blocks go out with the holes, in one list of changes to the map in order, so everyone ends up with the same map (players who join later get the whole list).

## Map maker

Click **Map maker** on the main menu, or **+ Make a new map** under **Your maps**.

- **Draw** platforms (`P`) and jump pads (`J`) by dragging. Click to place spawn points (`S`, blue or red team), weapons (`W`), health (`H`), armour (`A`) and jetpacks (`K`). Pickups and spawns drop onto the floor below where you click, unless you turn that off.
- **Indestructible platforms** (explosions can't break them when Destruction is on; they're hatched): tick **Indestructible** under **Drawing platforms** to draw them that way, or use the Indestructible tool (`I`) on platforms you've drawn: click one to mark it (click again to unmark), or drag a box to mark every platform inside it (hold `Shift` to unmark). **All indestructible** and **All breakable** do the whole map. A selected platform has its own **Indestructible** box too.
- **Edit** with the select tool (`V`): drag things to move them, and drag the corner squares to resize. Right-click or `Del` deletes, `Ctrl+D` duplicates, arrow keys nudge, and `Ctrl+Z` / `Ctrl+Y` undo and redo. The mouse wheel zooms, dragging empty space moves the view, and `F` fits the whole map.
- **Mirror editing** (`M`): anything you add, move, resize or delete is copied to the other side of a mirror line (purple; you can move it). Spawns can swap blue and red on the other side. **Copy left → right** and **Copy right → left** rebuild one half from the other, and **Mirror to other side** copies one thing.
- **Objectives**: draw hills (`L`) and capture points (`C`) by dragging (or click for a standard size), and click to place each team's flag stand (`B`) and Rush M-COM stations (`R`, with a sector: sector 1 falls first). Capture points get letters A, B, C… (change them on the right). Spawn points can belong to a Rush sector, so the attack and the defence move up as sectors fall. Leave a mode's objectives out and the game works some out from the layout.
- **Everyone spawns with**: pick weapons, armour and a jetpack that every player starts with on your map (in free-for-all and team games).
- **Map check** runs the bots' route planner over your map. It flags pits you can't climb out of, areas you can't get to, spawns inside walls or over the void, and pickups and objectives nobody can reach. Click a problem to see where it is. Test play won't start while the map has errors.
- **Test play** starts a match on your map with the menu's settings, in the mode picked next to the button. The menu (`Esc`) then has **Back to map maker**.
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
npm run test:browser # in Chromium: plays matches, uses the map maker, checks WebGL draws the same as the canvas,
                     # checks smooth drawing above 60 fps, the settings screen, classes (the Loadout screen, the class
                     # picker, building in both renderers), and plays online between three browsers
```

There's no build step: the game is plain JavaScript modules in `web/`, and the browser loads them directly. Two libraries are copied into `web/vendor/`: [PixiJS](https://pixijs.com/) 8.22 (`pixi.min.js`, MIT licence), for WebGL drawing, and [noble-secp256k1](https://github.com/paulmillr/noble-secp256k1), for signing relay messages. PixiJS is only downloaded on computers that draw with WebGL.

## Publishing

Every push runs the tests. Pushes to the repo's default branch then publish `web/` to GitHub Pages (`.github/workflows/pages.yml`). Work happens on `main`, so `main` should be the default branch: **Settings → General → Default branch**.

GitHub Pages has to be switched on once: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Project layout

| Path | What it is |
|---|---|
| `web/index.html`, `web/style.css` | The page: menus, pause and results screens, chat |
| `web/src/game.js` | One match: soldiers, spawning, frags, win conditions (no browser code, so tests can run it) |
| `web/src/modes.js` | Game modes: free-for-all, team, gun game, one in the chamber |
| `web/src/objmodes.js`, `objectives.js`, `objdraw.js` | The objective modes (king of the hill, capture the flag, conquest, rush); where their objectives are (or worked out from a map's layout); drawing them, their HUD and the minimap |
| `web/src/physics.js` | Movement, collision and the ninja rope, shared by players, bots and the bots' route planner |
| `web/src/combat.js`, `weapons.js` | Firing, projectiles, payloads, explosions, damage; weapon data |
| `web/src/classes.js`, `gadgets.js` | Classes, kits and weapon upgrades; gadgets (medkits, ammo boxes, spawn beacons, the Builder) |
| `web/src/building.js` | The Engineer's Builder: walls, planks and repairs |
| `web/src/kitchoice.js`, `loadout.js` | The class and loadouts you play with (saved in the browser); the Loadout screen and class picker |
| `web/src/pickups.js` | Items on the map, dropped weapons, supply crates |
| `web/src/nav.js`, `bot.js` | Bot route planning and bot behaviour |
| `web/src/grid.js` | Where the soldiers are, by area, for big battles |
| `web/src/net/` | Online play: `protocol.js` (snapshots and inputs), `host.js`, `client.js` (prediction, interpolation), `peer.js` (WebRTC), `lobby.js` (finding and joining games), `community.js` (community maps), `nostr.js` (relay client), `relays.js` |
| `web/src/editor.js` | The map maker |
| `web/src/custommaps.js`, `mapstore.js` | Custom maps: checking them, share links, `.ssm` files, saving in the browser |
| `web/src/stickman.js`, `sprites.js` | The stick figures, and drawings of weapons, animals and crates |
| `web/src/render.js`, `hud.js`, `maptiles.js` | Drawing the world and the HUD (with a 2D canvas, or anything that draws like one); the map kept in tiles (`?tiles=on`) |
| `web/src/glrender.js`, `glctx.js` | WebGL drawing: picks WebGL or the canvas, and lets the drawing code above draw through PixiJS |
| `web/src/framerate.js` | Frame rate: measures the screen's refresh rate, caps, and the auto setting |
| `web/src/audio.js`, `input.js`, `main.js` | Sound, controls and page wiring |
| `web/data/` | The 8 maps and the leg animations, decoded from the original game |
| `web/sounds/` | The original game's sound effects ([credits](web/sounds/CREDITS.md)) |
| `tests/` | Headless tests (`npm test`) and browser tests (`tests/browser/`) |
| `tools/` | Local web server, local Nostr relay, relay probe, and `ss2/extract.py` (rebuilds `reference/ss2/` from the original `ss2.zip`) |
| [`tools/maps/`](tools/maps/README.md) | The new maps, built in code (`designs/`), with a checker (reachability, objectives, travel times, bot matches) and a picture tool |
| [`reference/ss2/`](reference/ss2/README.md) | Everything decoded from the original game, with previews |
| [`docs/ss2-file-formats.md`](docs/ss2-file-formats.md) | The original game's file formats |

## Design notes

- **Destruction.** The map stays a set of boxes. An explosion cuts a rounded hole (a wide box, a tall box and a square between them, 40% of the blast's radius) out of every block it touches, and each block hit is replaced by the boxes left around the hole. Holes that would leave a sliver along a block's edge go to the edge instead. Collision, sight lines, fog of war and drawing all keep working on boxes, unchanged. The bots' route map isn't rebuilt (that takes up to half a second on big maps): every standing spot remembers where each move it tried went, and a moment after a hole only the moves that went near it are simulated again (a few ms in all). That's done a few spots per game update, so a hole never holds up the game; bots carry on along their old routes meanwhile, then plan again, a few at a time. A test checks the patched route map gets everywhere a fresh one would. Online, the host sends each hole (position and size) in order, and players blow the same holes, which come out the same everywhere; players who join late or miss one get them all.

- **Jump height.** The original's physics constants are compiled into its program, which this project doesn't touch. Jumps were first tuned against its maps (about 162 px, the least that let you climb out of every pit in all 8), then lowered to 60% of that, about 97 px (a soldier is 34 px tall), which plays better. Seven of the original maps work with it. On King of the Hill the pit at the bottom becomes a deliberate trap: you can drop in but not climb out, so nobody spawns there, nothing anyone needs is down there, bots only go in by accident, and the way out is to die (hold `K` to self-destruct; stuck bots do the same once there's nothing left to do). The new maps were reshaped for the lower jump. Jump pads launch 2.05× their stored "bounce" value. A test checks that every map is fully connected (apart from that pit).
- **Bots.** The bots' route planner finds every spot a soldier can stand on. It then tries walks, jumps (including mid-air direction changes) and drops from each spot with the same physics code the game uses, so every planned move is one the bot can actually perform. In a real match a move can still go wrong (a bot lines up a jump slightly off, or lands on a jump pad), so a move that fails costs more to plan with next time and the bots find another way. A bot that hasn't got anywhere for a few seconds gives up on what it was doing and goes somewhere else. Before going for a pickup, a bot works out how long it'll take to get there and compares that with the other bots already on their way (by what's left of their routes) and anyone standing right next to it. If someone will clearly get there first, it finds something else to do, and a bot on its way gives up as soon as someone faster heads for the same thing. A bot that gives way leaves that item alone for a few seconds, and a bot already on its way to an item sticks with it, rather than dithering between it and its objective. Jumps cost a little extra when planning routes, so bots walk wherever walking is about as quick, rather than hopping along flat floors.
- **Floating pickups.** Items sit exactly where the original map files put them, which is often 20–50 px above the floor. You may need to hop to grab some.
- **Huge battles.** Up to about 1,000 bots run at full speed on a typical computer, and 2,000 on a fast one. Beyond that the game runs in slow motion instead of freezing (`?fps` or Settings → Show frame rate shows the game speed). Games with more than 32 soldiers keep a grid of who's where (`grid.js`), so bots, bullets, flames and explosions only check soldiers nearby. Bots look at the nearest few soldiers instead of everyone, and route searches, spawn safety and similar work are shared between bots. Only on-screen soldiers are drawn, bots' names are hidden in a crowd, and the scoreboard shows the top 20. Smaller games don't use any of this, so they play exactly as before. `tests/crowd.test.mjs` checks the shortcuts give the same answers as checking everyone.
- **Smoothness.** Nothing big happens in a single update: route map patches are spread over several updates, bots re-plan a few at a time, and route searches run on flat number arrays without making garbage (2× quicker, with exactly the same answers). The canvas draws only the part of the map that's on screen. (Keeping the map in 512-pixel tiles and copying them each frame, `maptiles.js`, was tried: quicker without a graphics card, but about 20% slower with one, so it's only used with `?tiles=on` in the address.) The minimap's blocks are kept in a picture too, the world is drawn at whole screen pixels, and the canvas is opaque, so the browser doesn't blend it with the page.
- **Frame rate.** The game itself always updates 60 times a second (so physics, bots and online play are the same for everyone), and frames are drawn as often as the screen refreshes. Each thing remembers where it was at the last update, and frames draw it the right fraction of the way to where it is now. The camera eases by elapsed time, so it moves the same at 60 or 240 frames a second.
- **WebGL.** All drawing code is written for the browser's 2D canvas. `glctx.js` takes the same drawing calls and turns them into PixiJS shapes and cached text, in the same order, so the WebGL renderer reuses every drawing (soldiers, weapons, animals, the HUD) unchanged. The map is built once, and blood and most particles are sprites, as they're the most numerous. A browser test draws the same frames both ways and checks they match. Computers without a graphics card run WebGL on the processor, which is slower than the canvas, so those get the canvas.
- **Objective modes.** Everything a mode tracks (flags, capture progress, M-COM fuses) is plain data in `game.modeState`, which the host sends in every snapshot, so players see the same thing without any extra messages. Bots ask the mode where they should be (a hill, a flag, the point they've picked, an M-COM), then go there and hold it: they move about inside the area and fight from there, and on the way they sometimes stop to fight. Roles come from each bot's id, so some defend and some attack, and they spread over several objectives instead of crowding one. Rush defenders guard an M-COM from a few steps away rather than standing on it, so it can still be armed.
- **Classes.** Kits replace the mode's loadout at spawn (`applyKit`), so with classes off nothing changes. Weapon upgrades never touch the weapon definitions: `weaponFor(s, id)` gives a view of the weapon with the soldier's upgrade applied (a bigger magazine, a scaled blast...), which firing, reloading, pickups and the HUD use; it reads through to the real numbers, so it follows the game speed. Gadget timers are written like weapon numbers, in updates at full speed, and stretched by the game speed (a 15 s recharge is 20 s at 75%). Spawn beacons are plain data in `game.beacons`, sent in snapshots; shots and blasts reach them through small calls next to the hit checks and `explode()`, which is left as it is.
- **Building.** Built blocks are ordinary map boxes, marked as built (drawn as sandbags, and breakable on any map). Repairs fill in what's missing of the map as it was at the start (a copy is kept) around where you aim, less whatever's there now and anyone standing there; repaired blocks are plain map again. Each new block patches the bots' route map just as a hole does, and online it goes in the same ordered list as the holes, so block numbers line up for everyone. Bots walk on, around and over built blocks but don't build themselves.
- **Same game everywhere.** Offline, hosting and joining all run the same `Game` code. The host records every sound and effect as it happens and sends them on, and players draw trails (rocket smoke, jetpack flames) themselves, from what's in the snapshots.

## Ideas for what's next

- The rest of the weapons cut from the original (AK-47, MP5K, 20 mm cannon, Beretta, C4, blaster, "Shocker")
- Host migration, so a game survives the host leaving
- Touch controls for phones and tablets

## Credits

The original Stick Soldiers and Stick Soldiers II were made by Tim Cowley, Dylan Allison and Andrew Vehlies (Whitespace Unlimited). This remake uses map layouts, weapon numbers, animation poses and sound effects from their game. The sound effects came via the Stick Soldiers Python fan project. The Worms-style weapons are affectionate nods to Team17's Worms series; all code and art here are new.
