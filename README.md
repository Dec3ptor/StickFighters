# Stick Soldiers

A from-scratch remake of **Stick Soldiers II** (Whitespace Unlimited, 2003): a side-on, black-and-white stick-figure shooter where soldiers grab weapons, armour and jetpacks lying around the map and fight to a frag limit.

## Status

Research stage. The original source code is lost, so we've decoded the original game's data files to use as the blueprint. No engine has been picked yet.

## What's here

| Path | What it is |
|---|---|
| [`reference/ss2/`](reference/ss2/README.md) | Everything pulled from the original game: all 8 maps, weapon stats (plus 8 cut weapons), stick-figure animations, bots and controls, as JSON with previews |
| [`docs/ss2-file-formats.md`](docs/ss2-file-formats.md) | How the original game's map, animation, weapon and sprite files are laid out |
| [`tools/ss2/extract.py`](tools/ss2/extract.py) | Rebuilds `reference/ss2/` from the original `ss2.zip` |

## Credits

The original Stick Soldiers and Stick Soldiers II were made by Tim Cowley, Dylan Allison and Andrew Vehlies (Whitespace Unlimited).
