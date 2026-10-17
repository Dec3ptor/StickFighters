# Stick Soldiers II file formats

How the original game (Whitespace Unlimited, 2003) stores its data, worked out from the shipped files. `tools/ss2/extract.py` reads all of these.

**Confidence:** the layouts of every format below are confirmed: every shipped file parses to its last byte, and the decoded maps match in-game screenshots. Where a field's *meaning* is a guess, it says so.

## Common rules

- Binary files are little-endian. Numbers are 32-bit (`u32` = unsigned int, `f32` = float).
- A `string` is a `u32` length followed by that many bytes, with no terminator.
- Positions are in pixels, with **y pointing down** (screen space). The game ran at 800×600.
- Sprites face **left**: negative x is "forward" (see weapon `Fire` offsets). Mirror them for a soldier facing right.
- Text files use Windows line endings (CRLF). `;` starts a comment in `.wtb` and `.cfg` files.

## Maps: `Data/Maps/*.ssm` (binary)

```
string   name                        e.g. "Fire in the Hole"
f32 x4   bounds                      left, top, right, bottom
u32      platform count
  per platform (24 bytes):
    f32 x4  left, top, right, bottom   always left < right and top < bottom
    f32     unknown                    0 in every shipped map
    f32     bounce                     0 = normal solid block; negative = jump pad
u32      spawn count
  per spawn (12 bytes):
    f32 x2  x, y
    u32     team                       1 or 2 (every map has both, even free-for-all maps)
u32      item count
  per item:
    u32     type                       1 health, 2 armour, 3 weapon, 4 jetpack
    f32 x2  x, y
    string  weapon id                  a section name from SSwep.wtb, or "None" for non-weapons
```

- **Platforms** are solid axis-aligned boxes. The game draws them as one merged black outline on white: all boxes 1px larger in black, then all boxes in white on top. The map previews do the same thing.
- **Bounce** values from -6.5 to -9.5 appear on jump pads (Hells Steeple has 8 in a chain). Since y points down, negative means "launch upward"; the number is probably the launch speed.
- **Team numbers:** the map editor lists "Spawn Point (Blue Team)" before "Spawn Point (Red Team)", so 1 is probably Blue and 2 Red. This is a guess.
- **Item types 2 (armour), 3 (weapon) and 4 (jetpack)** were checked against screenshots. Type 1 is health by elimination.
- An empty map saved by the editor (`new.ssm`) is: name `"Noname"`, bounds `-1,-1,1,1`, and three zero counts.

## Animations: `Data/LDefault.ssv` (legs) and `Data/UDefault.ssv` (arms) (binary)

The soldier is drawn from lines between a few points, animated by blending between key poses. Legs and arms are separate files, so the soldier can run while aiming.

```
repeat until end of file:          one animation each time round
  f32   speed                      how fast it plays (the in-game animator shows "Speed: %f")
  u32   pose count
  per pose: N points of (f32 x, f32 y)
```

| File | N | Points, in order | Lines drawn |
|---|---|---|---|
| `LDefault.ssv` | 6 | neck, hip, front knee, back knee, front foot, back foot | neck→hip, hip→each knee, each knee→its foot; head circle above the neck |
| `UDefault.ssv` | 5 | shoulder, front elbow, back elbow, front hand, back hand | shoulder→each elbow, each elbow→its hand |

- Both files hold 10 animations. Names aren't stored; the game picks them by index. `reference/ss2/data/animations/legs.png` and `arms.png` draw every pose so you can tell them apart. In the legs file, animation 1 is a 7-pose run cycle and animation 3 is a flip. In the arms file, most animations hold a weapon forward and animation 3 has both arms up.
- Points are relative to the soldier's position. On the legs, the hip sits at about (0, -2) and the neck at (0, -14). The arms' shoulder is always (0, 0); presumably it's attached near the neck.
- The `speed` values range from 0.008 to 0.43. A likely reading is "fraction of the way to the next pose per game tick".
- `old_LDefault.ssv` is an older legs file in the same format. `Default.ssv` uses an older layout that the shipped game doesn't load.

## Weapons: `Data/SSwep.wtb` (text)

INI-style blocks: `[Id]`, then `Key=Value` lines, then `[End]`. Maps refer to weapons by `Id`.

| Key | Meaning |
|---|---|
| `Name` | Display name |
| `Template` | Built-in behaviour the weapon uses: `Platinum` (semi-auto pistol), `M4` (automatic bullets), `SG` (shotgun), `SR` (sniper: laser sight and zoom), `RL` (rocket), `GL` (grenade that explodes after 3 seconds), `Flamer`. Cut weapons also use `C4`, `Blaster` and `Shocker`. The file only tunes these behaviours; they're coded in the exe. |
| `ROF` | Delay between shots. Lower is faster (Uzi 5, Bazooka 150), probably in game ticks. |
| `Power` | Two numbers, e.g. `12,9`. Probably damage and knockback (guess). The Flamer has one number. |
| `Accuracy` | Random aim error. 0 is perfect (sniper); higher is wider. |
| `NumPellets`, `Spread` | Shotgun only: pellets per shot and the spread angle. |
| `Ammo` | Rounds in a pickup. The Platinum's 8 reloads automatically. |
| `Sprite` | Sprite name from `SSgfx.gtb`. |
| `Hand` | Where the hand grips the weapon sprite (x, y). |
| `Fire` | Muzzle position relative to the hand (x, y). Negative x is forward. |
| `FireSound` | File in `Data/Sound/`. `None` means none, or a sound played from code. |
| `RPG`, `RPGFireSound`, `Cannon` | Flags on `M4`-type weapons. `RPG=True` on the M4 probably gives it a secondary-fire grenade (there's an `rpg` projectile sprite). `Cannon` meaning unknown. |

`Copy of SSwep.wtb` and `Copy (2) of SSwep.wtb` are older weapon tables. They include eight weapons that were cut from the release; the extractor saves them under `cut_weapons`.

## Sprite atlas: `Data/SSgfx.gtb` (text)

```
[file.tga]
spritename left,top,right,bottom
spritename left,top,right,bottom
[nextfile.tga]
...
```

One image can hold several sprites (e.g. `Nums.tga` holds the digits 0–9). The same image can appear under more than one header. `SSMenu.tga` (the menu background) is listed but missing from the game files.

Images are 32-bit TGA, mostly with alpha. The extractor converts them to PNG.

## Sounds: `Data/SSsnd.stb` (text)

One `file.wav N` per line. `N` is probably how many copies of that sound can play at once (Uzi 12, M4 10, most others 1–3). `Platinum.wav` is listed twice.

## Other files

| File | What it is |
|---|---|
| `Data/binds.cfg` | Controls, `Action=Key`. Defaults: arrows to move/aim, Right Alt jump, Numpad 0 jetpack, Space fire, B secondary fire (sniper zoom), N/M previous/next weapon, Z drop jetpack. |
| `Data/BotFiles/Bots.cfg` | Bot personalities in `bot { key=value }` blocks: `acc` (aim error, lower is better), `camp` (tendency to stay put), `skill` (0–3), `chat` (which chat set), `chatty_event`/`chatty_respond`/`chatty_misc` (chance to talk, probably a percentage). `ctfbot` blocks add a `class` (sniper, soldier, engineer) for a capture-the-flag mode that was never finished. |
| `Data/BotFiles/Chat.cfg` | Bot chat lines grouped by event (`kill`, `death`, `suicide`, `hello`, `misc`). Placeholders: `#killer#`, `#killed#`, `#killerweap#`, `#random#`. |
| `Data/BotFiles/Response.cfg` | Trigger words (`hi,hello,hey`) and the replies bots give, with `#from#` for the speaker. |
| `Data/SSents.etb` | Empty (0 bytes). Probably a planned entity table. |
| `Data/Prefs.dat` | 36 bytes: the player name in a fixed-size buffer, then option bytes. |
| `Data/Card.cfg` | `0 0 0 0`. Unknown, probably graphics card settings. |

## What the exe reveals (text only, never run)

- **Engine:** C++, Direct3D 8 or OpenGL (`-d3d` / `-ogl` command-line flags), DirectInput, DirectSound, libpng and libjpeg.
- **Modes:** free-for-all and team deathmatch. Capture the flag was started but shows "Game type not supported". There's also an Arcade/Normal option.
- **Built-in tools:** a map editor (places platforms, spawn points, pickups; sets bounce) and an animator (Add Frame, Delete Frame, Speed), both opened from the console.
- **Console commands:** `map`, `maplist`, `fraglimit`, `maxclients`, `god`, `give`, `editor`, `animator`, `import`, `save`, `mute`, `quit`.
- **HUD:** health %, armour %, ammo, jet fuel % (jetpacks run on fuel), frag scores, team scores.
- **Files the game expects but this copy lacks:** `SSMenu.tga`, `MenuMusic.wav`, `GameMusic01.wav`, `GameMusicEnd.wav`, and a `Data/MapObjects/` folder.
