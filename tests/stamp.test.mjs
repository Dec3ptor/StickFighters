// The release stamp the publish step puts on the site's files (tools/stamp.mjs).
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampSource, stampPage, stampSite } from '../tools/stamp.mjs';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

test('stampSource: relative imports from any folder get the release; others stay', () => {
  const src = [
    "import { a } from './a.js';",
    'import { b } from "../b.js";',
    "export { c } from './rm/c.js';",
    "import './side.js';",
    "const m = await import('./late.js');",
    "const P = await import('../vendor/pixi.min.js');",
    "import { x } from '../../vendor/noble-secp256k1.js';",
    "import fs from 'node:fs';",
    "const s = 'from ./not-an-import.js';",
  ].join('\n');
  const out = stampSource(src, 'abc123').split('\n');
  assert.equal(out[0], "import { a } from './a.js?v=abc123';");
  assert.equal(out[1], 'import { b } from "../b.js?v=abc123";');
  assert.equal(out[2], "export { c } from './rm/c.js?v=abc123';");
  assert.equal(out[3], "import './side.js?v=abc123';");
  assert.equal(out[4], "const m = await import('./late.js?v=abc123');");
  assert.equal(out[5], "const P = await import('../vendor/pixi.min.js');");
  assert.equal(out[6], "import { x } from '../../vendor/noble-secp256k1.js';");
  assert.equal(out[7], "import fs from 'node:fs';");
  assert.equal(out[8], "const s = 'from ./not-an-import.js';");
  // Stamping twice changes nothing more.
  assert.equal(stampSource(out.join('\n'), 'abc123'), out.join('\n'));
});

test('stampPage: the module script and the stylesheet', () => {
  const html = '<link rel="stylesheet" href="style.css">\n<script type="module" src="src/main.js"></script>';
  assert.equal(stampPage(html, 'v1'), '<link rel="stylesheet" href="style.css?v=v1">\n<script type="module" src="src/main.js?v=v1"></script>');
});

test('the stamped site: every module is always loaded by one address (so it runs once)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
  try {
    fs.cpSync(WEB, dir, { recursive: true });
    const n = stampSite(dir, 'r42');
    assert.ok(n > 50, `stamped ${n}`);
    const page = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.match(page, /src="src\/main\.js\?v=r42"/);
    assert.match(page, /href="style\.css\?v=r42"/);

    // Follow every import from main.js, as a browser would, noting each address each file is loaded by.
    const seen = new Map(); // file -> addresses
    const visit = (file, query) => {
      const addrs = seen.get(file) || new Set();
      const again = seen.has(file);
      addrs.add(query);
      seen.set(file, addrs);
      if (again) return;
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.\.?\/[^'"]+)\1/g)) {
        const [rel, q = ''] = m[2].split('?');
        visit(path.join(path.dirname(file), rel), q);
      }
    };
    visit(path.join(dir, 'src', 'main.js'), 'v=r42');
    for (const [file, addrs] of seen) {
      const name = path.relative(dir, file);
      assert.equal(addrs.size, 1, `${name} is loaded by ${[...addrs].join(' and ')}`);
      if (!name.includes('vendor')) assert.deepEqual([...addrs], ['v=r42'], name);
    }
    // Remastered's modules are among them.
    assert.ok([...seen.keys()].some(f => f.includes(`${path.sep}rm${path.sep}renderer.js`)));
    assert.ok([...seen.keys()].some(f => f.includes(`${path.sep}net${path.sep}`)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
