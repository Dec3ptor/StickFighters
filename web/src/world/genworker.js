// Making a world's chunks off the game's thread (a worker: tileworld.js starts it). The same
// generator as the game's own, from the same seed, so what it makes is just what the game would
// have made (it's handed back, and taken unless the game's had to make it first, or has it kept).

import { WorldGen, CHUNK } from './worldgen.js';

let gen = null;

self.onmessage = e => {
  const d = e.data;
  if (d?.init) { gen = new WorldGen(d.seed | 0, { gen: d.gen | 0, noTowns: !!d.noTowns }); return; }
  if (!gen || !Array.isArray(d?.want)) return;
  for (const [cx, cy] of d.want) {
    const n = CHUNK * CHUNK, fg = new Uint8Array(n), bg = new Uint8Array(n), shape = new Uint8Array(n);
    gen.fillChunk(cx, cy, fg, bg, shape);
    self.postMessage({ cx, cy, fg, bg, shape }, [fg.buffer, bg.buffer, shape.buffer]);
  }
};
