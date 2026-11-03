// Drawing a world's pictures (web/src/world/worldrender.js: 16 tiles across each): what a tile
// just outside a picture spills into it is drawn in it too (a tree's bumps, grass blades, the
// outline along the edge), so nothing is cut off flat where two pictures meet.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { TileWorld, TILE } from '../web/src/world/tileworld.js';
import * as K from '../web/src/world/blocks.js';
import { paintPatch, PATCH } from '../web/src/world/worldrender.js';

/** A 2D context that keeps what's drawn: [method, ...arguments]. */
function recorder() {
  const calls = [];
  const g = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); }),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return { g, calls };
}

/** Picture (px, py) of `world`, drawn: what was drawn. */
function paint(world, px, py, look = 'classic') {
  const { g, calls } = recorder();
  paintPatch(g, world, px, py, look, []);
  return calls;
}

test('a picture draws what spills into it from just outside: crown bumps, the outline on its edge, grass blades', () => {
  const world = new TileWorld({ seed: 77, name: 'Paint', gen: 3 });
  // Up in the sky: everything clear, then a leaf, a block and grass by the edge between pictures 0 and 1.
  const ty = 4, edge = PATCH; // (tile column 16: the first of picture 1)
  for (let y = 0; y < PATCH + 2; y++) for (let x = 0; x < PATCH * 2; x++) world.setTile(x, y, K.AIR);
  world.setTile(edge - 1, ty, K.LEAVES);    // a crown's edge, the last column of picture 0
  world.setTile(edge - 1, ty + 4, K.STONE); // a block there, open to its right
  world.setTile(edge + 3, PATCH, K.GRASS);  // grass just below picture (1, 0), open above
  for (const look of ['classic', 'remastered']) {
    const own = paint(world, 0, 0, look), next = paint(world, 1, 0, look);
    const bumpsAt = calls => calls.filter(c => c[0] === 'arc' && c[1] === edge * TILE && c[2] > ty * TILE && c[2] < (ty + 1) * TILE);
    assert.equal(bumpsAt(own).length, 4, `${look}: the leaf's own picture draws its bumps (two, filled and outlined)`);
    assert.equal(bumpsAt(next).length, 4, `${look}: so does the next, where they spill over (not cut off flat)`);
    // The block's edge: drawn in both, each half of the line.
    const lineAt = calls => calls.some((c, i) => c[0] === 'moveTo' && c[1] === edge * TILE && c[2] === (ty + 4) * TILE && calls[i + 1]?.[0] === 'lineTo' && calls[i + 1][1] === edge * TILE && calls[i + 1][2] === (ty + 5) * TILE);
    assert.ok(lineAt(own) && lineAt(next), `${look}: the outline on the edge, in both pictures`);
    // The grass's blades, sticking up into the picture above.
    const blades = paint(world, 1, 0, look).filter(c => c[0] === 'fillRect' && c[1] > (edge + 3) * TILE && c[1] < (edge + 4) * TILE && c[2] < PATCH * TILE && c[2] >= PATCH * TILE - 2);
    assert.ok(blades.length >= 4, `${look}: grass blades from below (${blades.length})`);
  }
});

test('a picture far from anything spilling over draws no more than before', () => {
  const world = new TileWorld({ seed: 77, name: 'Paint', gen: 3 });
  for (let y = 0; y < PATCH + 2; y++) for (let x = -2; x < PATCH * 3; x++) world.setTile(x, y, K.AIR);
  assert.equal(paint(world, 1, 0).length, 0, 'empty sky: nothing at all');
});
