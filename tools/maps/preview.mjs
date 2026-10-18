// A picture of a map, to check a design by eye: platforms, jump pads, spawn
// points (blue/red, with their Rush sector), items, and the objectives
// (hill, flags, capture points, M-COMs), on a grid with coordinates.
//
// Usage: node tools/maps/preview.mjs <design or map> [out.png] [--scale 0.5] [--nav]
//   --nav also marks every spot bots can stand on: grey = fine, red = a trap
//   (can't get back out), orange = can't be reached.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { loadMap } from './load.mjs';
import { checkMap } from '../../web/src/custommaps.js';
import { GameMap } from '../../web/src/map.js';
import { objectivesOf } from '../../web/src/objectives.js';

// ---- A tiny raster with a 3x5 font, written out as a PNG -----------------------------

const FONT = {
  A: '.#. #.# ### #.# #.#', B: '##. #.# ##. #.# ##.', C: '.## #.. #.. #.. .##', D: '##. #.# #.# #.# ##.', E: '### #.. ##. #.. ###',
  F: '### #.. ##. #.. #..', G: '.## #.. #.# #.# .##', H: '#.# #.# ### #.# #.#', I: '### .#. .#. .#. ###', J: '..# ..# ..# #.# .#.',
  K: '#.# #.# ##. #.# #.#', L: '#.. #.. #.. #.. ###', M: '#.# ### ### #.# #.#', N: '##. #.# #.# #.# #.#', O: '.#. #.# #.# #.# .#.',
  P: '##. #.# ##. #.. #..', Q: '.#. #.# #.# ##. .##', R: '##. #.# ##. #.# #.#', S: '.## #.. .#. ..# ##.', T: '### .#. .#. .#. .#.',
  U: '#.# #.# #.# #.# ###', V: '#.# #.# #.# #.# .#.', W: '#.# #.# ### ### #.#', X: '#.# #.# .#. #.# #.#', Y: '#.# #.# .#. .#. .#.',
  Z: '### ..# .#. #.. ###', '0': '### #.# #.# #.# ###', '1': '.#. ##. .#. .#. ###', '2': '##. ..# .#. #.. ###', '3': '##. ..# .#. ..# ##.',
  '4': '#.# #.# ### ..# ..#', '5': '### #.. ##. ..# ##.', '6': '.## #.. ### #.# ###', '7': '### ..# .#. .#. .#.', '8': '### #.# ### #.# ###',
  '9': '### #.# ### ..# ##.', '-': '... ... ### ... ...', '.': '... ... ... ... .#.', ':': '... .#. ... .#. ...', '/': '..# ..# .#. #.. #..',
  '(': '.#. #.. #.. #.. .#.', ')': '.#. ..# ..# ..# .#.', ',': '... ... ... .#. #..', '+': '... .#. ### .#. ...', '%': '#.# ..# .#. #.. #.#',
  '=': '... ### ... ### ...', '?': '##. ..# .#. ... .#.', ' ': '... ... ... ... ...',
};
for (const k in FONT) FONT[k] = FONT[k].replace(/ /g, '');

class Picture {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.px = new Uint8Array(w * h * 3).fill(255);
  }
  dot(x, y, [r, g, b], a = 1) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3, p = this.px;
    p[i] = p[i] * (1 - a) + r * a; p[i + 1] = p[i + 1] * (1 - a) + g * a; p[i + 2] = p[i + 2] * (1 - a) + b * a;
  }
  rect(l, t, r, b, color, a = 1) {
    for (let y = Math.max(0, Math.floor(t)); y < Math.min(this.h, Math.ceil(b)); y++)
      for (let x = Math.max(0, Math.floor(l)); x < Math.min(this.w, Math.ceil(r)); x++) this.dot(x, y, color, a);
  }
  outline(l, t, r, b, color, a = 1) {
    this.rect(l, t, r, t + 1, color, a); this.rect(l, b - 1, r, b, color, a);
    this.rect(l, t + 1, l + 1, b - 1, color, a); this.rect(r - 1, t + 1, r, b - 1, color, a);
  }
  disc(x, y, rad, color, a = 1) {
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) if (dx * dx + dy * dy <= rad * rad) this.dot(x + dx, y + dy, color, a);
  }
  text(s, x, y, color, size = 2) {
    for (const ch of String(s).toUpperCase()) {
      const g = FONT[ch] || FONT[' '];
      for (let i = 0; i < 15; i++) if (g[i] === '#') this.rect(x + (i % 3) * size, y + Math.floor(i / 3) * size, x + (i % 3 + 1) * size, y + (Math.floor(i / 3) + 1) * size, color);
      x += 4 * size;
    }
  }
  png() {
    const raw = Buffer.alloc((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) Buffer.from(this.px.buffer, y * this.w * 3, this.w * 3).copy(raw, y * (this.w * 3 + 1) + 1);
    const chunk = (type, data) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      const td = Buffer.concat([Buffer.from(type), data]);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
      return Buffer.concat([len, td, crc]);
    };
    const head = Buffer.alloc(13);
    head.writeUInt32BE(this.w, 0); head.writeUInt32BE(this.h, 4); head[8] = 8; head[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  }
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// ---- Drawing a map -----------------------------------------------------------------------

const C = {
  ink: [17, 17, 17], floor: [236, 236, 236], pad: [205, 225, 160], grid: [230, 230, 238], gridText: [150, 150, 170],
  blue: [47, 111, 219], red: [211, 59, 47], item: [230, 140, 20], hill: [150, 70, 200], point: [215, 170, 20], mcom: [70, 70, 70],
  ok: [160, 160, 160], trap: [230, 30, 30], cutoff: [255, 140, 0],
};
const TEAM = { 1: C.blue, 2: C.red };

export function drawMap(data, { scale = null, nav = false } = {}) {
  const b = data.bounds;
  const s = scale ?? Math.min(1, 3000 / (b.right - b.left));
  const pad = 30;
  const W = Math.ceil((b.right - b.left) * s) + pad * 2, H = Math.ceil((b.bottom - b.top) * s) + pad * 2 + 20;
  const pic = new Picture(W, H);
  const X = x => (x - b.left) * s + pad, Y = y => (y - b.top) * s + pad + 20;
  // Grid every 200 px, labelled.
  for (let x = Math.ceil(b.left / 200) * 200; x <= b.right; x += 200) { pic.rect(X(x), Y(b.top), X(x) + 1, Y(b.bottom), C.grid); pic.text(x, X(x) + 2, Y(b.top) - 8, C.gridText, 1); }
  for (let y = Math.ceil(b.top / 200) * 200; y <= b.bottom; y += 200) { pic.rect(X(b.left), Y(y), X(b.right), Y(y) + 1, C.grid); pic.text(y, X(b.left) - 26, Y(y) + 2, C.gridText, 1); }
  pic.outline(X(b.left), Y(b.top), X(b.right), Y(b.bottom), C.gridText);
  const map = new GameMap(data);
  const own = new Set(data.objectives?.map(o => o.type) || []);
  // Objective areas first (under the platforms' outlines).
  for (const h of objectivesOf(map, 'hill')) {
    pic.rect(X(h.left), Y(h.top), X(h.right), Y(h.bottom), C.hill, 0.18);
    pic.outline(X(h.left), Y(h.top), X(h.right), Y(h.bottom), C.hill);
    pic.text(own.has('hill') ? 'HILL' : 'HILL?', X(h.left) + 3, Y(h.top) + 3, C.hill);
  }
  for (const p of objectivesOf(map, 'point')) {
    pic.rect(X(p.left), Y(p.top), X(p.right), Y(p.bottom), C.point, 0.2);
    pic.outline(X(p.left), Y(p.top), X(p.right), Y(p.bottom), C.point);
    pic.text(p.label + (own.has('point') ? '' : '?'), X(p.left) + 3, Y(p.top) + 3, [150, 110, 0], 3);
  }
  for (const p of data.platforms) {
    pic.rect(X(p.left), Y(p.top), X(p.right), Y(p.bottom), p.bounce ? C.pad : C.floor);
    pic.outline(X(p.left), Y(p.top), X(p.right) + 1, Y(p.bottom) + 1, C.ink);
    if (p.bounce) pic.text(String(-p.bounce), X(p.left) + 2, Y(p.top) + 2, [80, 110, 30], 1);
  }
  if (nav) {
    const { spots } = checkMap(data);
    for (const sp of spots) pic.disc(X(sp.x), Y(sp.y), 1, C[sp.kind]);
  }
  for (const it of data.items) {
    pic.rect(X(it.x) - 3, Y(it.y) - 3, X(it.x) + 3, Y(it.y) + 3, C.item);
    const label = it.type === 'weapon' ? it.weapon.slice(0, 3) : it.type[0];
    pic.text(label, X(it.x) + 5, Y(it.y) - 2, C.item, 1);
  }
  for (const sp of data.spawns) {
    pic.disc(X(sp.x), Y(sp.y), 4, TEAM[sp.team]);
    if (sp.sector) pic.text(sp.sector, X(sp.x) + 6, Y(sp.y) - 3, TEAM[sp.team], 1);
  }
  for (const f of objectivesOf(map, 'flag')) {
    const x = X(f.x), y = Y(f.y);
    pic.rect(x, y - 40 * s - 6, x + 2, y, C.ink);
    for (let i = 0; i < 12; i++) pic.rect(x + 2, y - 40 * s - 6 + i / 2, x + 2 + 14 - i, y - 40 * s - 6 + 12 - i / 2, TEAM[f.team]);
    if (!own.has('flag')) pic.text('?', x + 6, y - 40 * s + 8, TEAM[f.team]);
  }
  for (const m of objectivesOf(map, 'mcom')) {
    const x = X(m.x), y = Y(m.y);
    pic.rect(x - 6, y - 16, x + 6, y, C.mcom);
    pic.text(`M${m.sector}${own.has('mcom') ? '' : '?'}`, x - 8, y - 30, C.mcom);
  }
  const w = b.right - b.left, h = b.bottom - b.top;
  pic.text(`${data.name}  ${w}X${h}  ${data.platforms.length} PLATFORMS  ${data.spawns.length} SPAWNS  ${data.items.length} ITEMS`, 8, 6, C.ink);
  return pic;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const flag = k => { const i = args.indexOf(k); if (i >= 0) args.splice(i, 1); return i >= 0; };
  const scale = opt('--scale'), nav = flag('--nav');
  const [name, out] = args;
  if (!name) { console.log('Usage: node tools/maps/preview.mjs <design or map> [out.png] [--scale 0.5] [--nav]'); process.exit(1); }
  const data = await loadMap(name);
  const file = out || `${name.replace(/^.*\//, '').replace(/\.(json|mjs)$/, '')}.png`;
  fs.writeFileSync(file, drawMap(data, { scale: scale ? +scale : null, nav }).png());
  console.log(`Wrote ${file}`);
}
