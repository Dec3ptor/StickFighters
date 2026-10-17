#!/usr/bin/env python3
"""Pull the useful data out of the original Stick Soldiers II (2003) game files.

Usage:
    python3 tools/ss2/extract.py path/to/ss2.zip
    python3 tools/ss2/extract.py path/to/extracted/game/folder   # the folder that holds Data/

What it writes (paths relative to the repo root):
    reference/ss2/original/  raw game files copied out of the zip       (git-ignored)
    reference/ss2/assets/    original art and sounds as PNG / WAV       (git-ignored)
    reference/ss2/data/      decoded gameplay data: maps, weapons,
                             animations, sprite atlas, bots, controls   (committed)

The game's .exe is never extracted or run. Pillow is needed for the PNG
output (pip install Pillow); without it only the JSON data is written.
The file formats are documented in docs/ss2-file-formats.md.
"""

import json
import os
import re
import shutil
import struct
import sys
import zipfile

try:
    from PIL import Image, ImageDraw
except ImportError:  # JSON output still works without Pillow
    Image = ImageDraw = None

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(REPO, "reference", "ss2")

# Item type numbers used in .ssm map files. 2 and 3 and 4 were checked against
# in-game screenshots; 1 (health) is the only remaining pickup type.
ITEM_TYPES = {1: "health", 2: "armour", 3: "weapon", 4: "jetpack"}

# Files in the zip that are not game data.
SKIP_FILES = {"hanel.bmp"}  # an unused joke drawing


def num(v):
    """Float -> int when it is a whole number, to keep the JSON readable."""
    return int(v) if float(v).is_integer() else round(v, 4)


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)
        f.write("\n")


def read_text(path):
    with open(path, "rb") as f:
        return f.read().decode("latin-1").replace("\r\n", "\n").replace("\r", "\n")


# --------------------------------------------------------------------------
# Getting the game files

def find_game_root(names):
    """Return the zip prefix of the cleanest copy of the game (the one holding Data/SSwep.wtb)."""
    roots = [n[: -len("Data/SSwep.wtb")] for n in names if n.endswith("Data/SSwep.wtb")]
    if not roots:
        sys.exit("This zip does not look like Stick Soldiers II (no Data/SSwep.wtb inside).")
    return min(roots, key=len)


def extract_zip(zip_path, dest):
    """Copy the game's data files out of the zip. Never writes outside dest, never extracts .exe files."""
    with zipfile.ZipFile(zip_path) as z:
        names = [i.filename for i in z.infolist() if not i.is_dir()]
        root = find_game_root(names)
        # Screenshots only exist in copies of the game that someone has played.
        shots = sorted(n for n in names if re.search(r"(^|/)Screenshots/[^/]+\.tga$", n, re.I))
        if os.path.isdir(dest):
            shutil.rmtree(dest)
        dest_real = os.path.realpath(dest)
        for name in names:
            if name in shots:
                rel = "Screenshots/" + os.path.basename(name)
            elif name.startswith(root):
                rel = name[len(root):]
                if not (rel.startswith("Data/") or rel == "Manual.txt"):
                    continue
            else:
                continue
            if os.path.basename(rel) in SKIP_FILES or rel.lower().endswith(".exe"):
                continue
            target = os.path.realpath(os.path.join(dest, rel))
            if not target.startswith(dest_real + os.sep):
                sys.exit("Refusing unsafe path in zip: %r" % name)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with z.open(name) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out)
    print("Extracted game files to", os.path.relpath(dest, REPO))


# --------------------------------------------------------------------------
# Text formats

def parse_value(v):
    v = v.strip()
    if v.lower() in ("true", "false"):
        return v.lower() == "true"
    parts = [p.strip() for p in v.split(",")]
    try:
        nums = [num(float(p)) for p in parts]
        return nums[0] if len(nums) == 1 else nums
    except ValueError:
        return v


def parse_wtb(path):
    """Weapon table: [Id] blocks of Key=Value lines, closed by [End]. ';' starts a comment."""
    weapons, cur = [], None
    for line in read_text(path).split("\n"):
        line = line.split(";", 1)[0].strip()
        if not line:
            continue
        m = re.fullmatch(r"\[(.+)\]", line)
        if m:
            if m.group(1).lower() == "end":
                cur = None
            else:
                cur = {"id": m.group(1)}
                weapons.append(cur)
        elif cur is not None and "=" in line:
            k, v = line.split("=", 1)
            cur[k.strip()] = parse_value(v)
    return weapons


def parse_gtb(path):
    """Sprite atlas: a [file.tga] header, then 'name left,top,right,bottom' lines."""
    sprites, cur = [], None
    for line in read_text(path).split("\n"):
        line = line.strip()
        if not line:
            continue
        m = re.fullmatch(r"\[(.+)\]", line)
        if m:
            cur = m.group(1)
            continue
        name, rect = line.rsplit(" ", 1)
        l, t, r, b = (int(x) for x in rect.split(","))
        sprites.append({"name": name, "file": cur, "left": l, "top": t, "right": r, "bottom": b})
    return sprites


def parse_stb(path):
    """Sound table: 'file.wav N' per line (N is probably how many copies can play at once)."""
    out = []
    for line in read_text(path).split("\n"):
        if line.strip():
            f, n = line.split()
            out.append({"file": f, "channels": int(n)})
    return out


def parse_binds(path):
    return dict(line.split("=", 1) for line in read_text(path).split("\n") if "=" in line)


def parse_bots(path):
    """bots.cfg: 'bot { key=value ... }' and 'ctfbot { ... }' blocks. ';' starts a comment."""
    bots, cur = [], None
    for line in read_text(path).split("\n"):
        line = line.split(";", 1)[0].strip()
        if not line:
            continue
        if line in ("bot", "ctfbot"):
            cur = {"kind": line}
        elif line == "{":
            pass
        elif line == "}":
            if cur:
                bots.append(cur)
            cur = None
        elif cur is not None and "=" in line:
            k, v = line.split("=", 1)
            k = k.strip()
            if k == "nick":
                cur[k] = [n.strip().strip('"') for n in v.split(",")]
            else:
                cur[k] = parse_value(v)
    return bots


# --------------------------------------------------------------------------
# Binary formats (all little-endian)

class Reader:
    def __init__(self, data):
        self.b, self.o = data, 0

    def u32(self):
        v = struct.unpack_from("<I", self.b, self.o)[0]
        self.o += 4
        return v

    def f32(self, n=1):
        v = struct.unpack_from("<%df" % n, self.b, self.o)
        self.o += 4 * n
        return v if n > 1 else v[0]

    def string(self):
        n = self.u32()
        s = self.b[self.o:self.o + n].decode("latin-1")
        self.o += n
        return s

    def done(self):
        return self.o == len(self.b)


def parse_ssm(path):
    """Map file. Coordinates are pixels with y pointing down (screen space)."""
    with open(path, "rb") as f:
        r = Reader(f.read())
    m = {"source": os.path.basename(path), "name": r.string()}
    l, t, rt, b = r.f32(4)
    m["bounds"] = {"left": num(l), "top": num(t), "right": num(rt), "bottom": num(b)}
    m["platforms"] = []
    for _ in range(r.u32()):
        l, t, rt, b = r.f32(4)
        unknown, bounce = r.f32(2)
        p = {"left": num(l), "top": num(t), "right": num(rt), "bottom": num(b)}
        if bounce:
            p["bounce"] = num(bounce)
        if unknown:
            p["unknown"] = num(unknown)
        m["platforms"].append(p)
    m["spawns"] = []
    for _ in range(r.u32()):
        x, y = r.f32(2)
        m["spawns"].append({"x": num(x), "y": num(y), "team": r.u32()})
    m["items"] = []
    for _ in range(r.u32()):
        kind = r.u32()
        x, y = r.f32(2)
        weapon = r.string()
        item = {"type": ITEM_TYPES.get(kind, "unknown_%d" % kind), "x": num(x), "y": num(y)}
        if weapon != "None":
            item["weapon"] = weapon
        m["items"].append(item)
    if not r.done():
        raise ValueError("%s: %d unexpected bytes at the end" % (path, len(r.b) - r.o))
    return m


# Point names for the two halves of the stick figure (see docs/ss2-file-formats.md).
LEG_POINTS = ["neck", "hip", "front_knee", "back_knee", "front_foot", "back_foot"]
ARM_POINTS = ["shoulder", "front_elbow", "back_elbow", "front_hand", "back_hand"]


def parse_ssv(path, point_names):
    """Animation file: a list of animations, each = speed + key poses, each pose = N (x, y) points."""
    with open(path, "rb") as f:
        r = Reader(f.read())
    anims = []
    while not r.done():
        speed = r.f32()
        poses = []
        for _ in range(r.u32()):
            v = r.f32(2 * len(point_names))
            poses.append({n: [num(v[2 * i]), num(v[2 * i + 1])] for i, n in enumerate(point_names)})
        anims.append({"index": len(anims), "speed": num(speed), "poses": poses})
    return anims


# --------------------------------------------------------------------------
# Images

def render_map(m, path):
    b = m["bounds"]
    pad = 20
    w, h = int(b["right"] - b["left"]) + 2 * pad, int(b["bottom"] - b["top"]) + 2 * pad
    im = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(im)
    X = lambda x: x - b["left"] + pad
    Y = lambda y: y - b["top"] + pad
    d.rectangle([X(b["left"]), Y(b["top"]), X(b["right"]), Y(b["bottom"])], outline=(210, 210, 210))
    # Black boxes 1px larger, then white boxes on top: this leaves only the outline
    # of the combined shape, the same look the original game has.
    for p in m["platforms"]:
        d.rectangle([X(p["left"]) - 1, Y(p["top"]) - 1, X(p["right"]) + 1, Y(p["bottom"]) + 1], fill="black")
    for p in m["platforms"]:
        fill = (255, 214, 110) if p.get("bounce") else "white"
        d.rectangle([X(p["left"]), Y(p["top"]), X(p["right"]), Y(p["bottom"])], fill=fill)
    for s in m["spawns"]:
        c = (40, 90, 220) if s["team"] == 1 else (220, 50, 50)
        d.ellipse([X(s["x"]) - 4, Y(s["y"]) - 4, X(s["x"]) + 4, Y(s["y"]) + 4], outline=c, width=2)
    colours = {"health": (200, 30, 30), "armour": (90, 90, 90), "jetpack": (130, 60, 200), "weapon": (0, 140, 0)}
    for it in m["items"]:
        c = colours.get(it["type"], (0, 0, 0))
        d.rectangle([X(it["x"]) - 3, Y(it["y"]) - 3, X(it["x"]) + 3, Y(it["y"]) + 3], fill=c)
        d.text((X(it["x"]) + 6, Y(it["y"]) - 6), it.get("weapon", it["type"]), fill=c)
    d.text((pad, 4), "%s  (%s)" % (m["name"], m["source"]), fill="black")
    im.save(path)


def render_poses(anims, path, legs):
    scale, cell = 4, 160
    cols = max(len(a["poses"]) for a in anims)
    im = Image.new("RGB", (cell * cols, cell * len(anims)), "white")
    d = ImageDraw.Draw(im)
    for row, a in enumerate(anims):
        for col, pose in enumerate(a["poses"]):
            ox, oy = col * cell + cell // 2, row * cell + cell // 2
            P = lambda k: (ox + pose[k][0] * scale, oy + pose[k][1] * scale)
            if legs:
                segs = [("neck", "hip"), ("hip", "front_knee"), ("hip", "back_knee"),
                        ("front_knee", "front_foot"), ("back_knee", "back_foot")]
                hx, hy = P("neck")
                d.ellipse([hx - 16, hy - 32, hx + 16, hy], outline="black", width=2)
            else:
                segs = [("shoulder", "front_elbow"), ("shoulder", "back_elbow"),
                        ("front_elbow", "front_hand"), ("back_elbow", "back_hand")]
            for a1, a2 in segs:
                d.line([P(a1), P(a2)], fill="black", width=3)
            d.rectangle([col * cell, row * cell, (col + 1) * cell - 1, (row + 1) * cell - 1], outline=(225, 225, 225))
            d.text((col * cell + 4, row * cell + 3), "anim %d, pose %d" % (row, col), fill=(140, 140, 140))
    im.save(path)


# --------------------------------------------------------------------------

def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = os.path.abspath(sys.argv[1])
    raw = os.path.join(OUT, "original")
    if zipfile.is_zipfile(src):
        extract_zip(src, raw)
    elif os.path.isdir(os.path.join(src, "Data")):
        raw = src
    else:
        sys.exit("Give the path to ss2.zip, or to the game folder that contains Data/.")

    data_in = os.path.join(raw, "Data")
    data_out = os.path.join(OUT, "data")
    assets = os.path.join(OUT, "assets")
    for d in (data_out, assets):
        if os.path.isdir(d):
            shutil.rmtree(d)

    # Weapons: the live table, plus two older tables that hold weapons cut from the game.
    live = parse_wtb(os.path.join(data_in, "SSwep.wtb"))
    live_ids = {w["id"] for w in live}
    cut = {}
    for backup in ("Copy of SSwep.wtb", "Copy (2) of SSwep.wtb"):
        p = os.path.join(data_in, backup)
        if os.path.exists(p):
            for w in parse_wtb(p):
                if w["id"] not in live_ids and w["id"] not in cut:
                    cut[w["id"]] = dict(w, found_in=backup)
    write_json(os.path.join(data_out, "weapons.json"), {"weapons": live, "cut_weapons": list(cut.values())})

    write_json(os.path.join(data_out, "sprite-atlas.json"), parse_gtb(os.path.join(data_in, "SSgfx.gtb")))
    write_json(os.path.join(data_out, "sounds.json"), parse_stb(os.path.join(data_in, "SSsnd.stb")))
    write_json(os.path.join(data_out, "controls.json"), parse_binds(os.path.join(data_in, "binds.cfg")))
    write_json(os.path.join(data_out, "bots.json"), parse_bots(os.path.join(data_in, "BotFiles", "Bots.cfg")))

    maps_dir = os.path.join(data_in, "Maps")
    for f in sorted(os.listdir(maps_dir)):
        if f.lower().endswith(".ssm"):
            m = parse_ssm(os.path.join(maps_dir, f))
            base = os.path.splitext(f)[0]
            write_json(os.path.join(data_out, "maps", base + ".json"), m)
            if Image:
                render_map(m, os.path.join(data_out, "maps", base + ".png"))
            print("Map %-12s %-18s %2d platforms, %2d spawns, %2d items"
                  % (f, m["name"], len(m["platforms"]), len(m["spawns"]), len(m["items"])))

    for f, names, legs in (("LDefault.ssv", LEG_POINTS, True), ("UDefault.ssv", ARM_POINTS, False)):
        anims = parse_ssv(os.path.join(data_in, f), names)
        part = "legs" if legs else "arms"
        write_json(os.path.join(data_out, "animations", part + ".json"), anims)
        if Image:
            render_poses(anims, os.path.join(data_out, "animations", part + ".png"), legs)

    # Original art and sounds, in formats any engine opens. Git-ignored: they are
    # Whitespace Unlimited's work, not ours.
    if Image:
        os.makedirs(os.path.join(assets, "sprites"), exist_ok=True)
        for f in sorted(os.listdir(data_in)):
            if f.lower().endswith(".tga"):
                Image.open(os.path.join(data_in, f)).convert("RGBA").save(
                    os.path.join(assets, "sprites", os.path.splitext(f)[0] + ".png"))
        shots = os.path.join(raw, "Screenshots")
        if os.path.isdir(shots):
            os.makedirs(os.path.join(assets, "screenshots"), exist_ok=True)
            for f in sorted(os.listdir(shots)):
                Image.open(os.path.join(shots, f)).convert("RGB").save(
                    os.path.join(assets, "screenshots", os.path.splitext(f)[0] + ".png"))
    else:
        print("Pillow is not installed: skipped PNG output (pip install Pillow).")
    shutil.copytree(os.path.join(data_in, "Sound"), os.path.join(assets, "sounds"))

    print("Decoded data written to", os.path.relpath(data_out, REPO))
    print("Original art and sounds written to", os.path.relpath(assets, REPO))


if __name__ == "__main__":
    main()
