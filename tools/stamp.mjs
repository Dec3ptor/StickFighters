// Give the game's files per-release addresses before publishing, so a browser
// holding cached files from the last release never mixes old and new code: every
// relative import in web/src (any folder, './' or '../'), the page's script and
// its stylesheet get "?v=<release>". Every module is then always loaded by the
// same address, wherever it's imported from (so it only ever runs once).
// The vendor libraries keep their plain addresses (they don't change between releases).
//
//   node tools/stamp.mjs <release> [web folder]

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// from './x.js' / from "../y/z.js", import('./x.js'), and import './x.js'.
const IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.\.?\/[^'"?#]+?\.m?js)\2/g;

/** JavaScript source src with its relative imports stamped with release v. */
export function stampSource(src, v) {
  return src.replace(IMPORT, (m, pre, q, path) => (/(^|\/)vendor\//.test(path) ? m : `${pre}${q}${path}?v=${v}${q}`));
}

/** The page's HTML with its module script and stylesheet stamped with release v. */
export function stampPage(html, v) {
  return html
    .replace(/(<script\b[^>]*\bsrc=")(src\/[^"?]+\.js)"/g, `$1$2?v=${v}"`)
    .replace(/(<link\b[^>]*\bhref=")(style\.css)"/g, `$1$2?v=${v}"`);
}

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (/\.m?js$/.test(name)) out.push(p);
  }
  return out;
}

/** Stamp the web folder in place; returns how many addresses were stamped. */
export function stampSite(web, v) {
  let count = 0;
  const tally = (before, after) => { count += (after.match(new RegExp(`\\?v=${v}`, 'g')) || []).length - (before.match(new RegExp(`\\?v=${v}`, 'g')) || []).length; };
  for (const file of jsFiles(join(web, 'src'))) {
    const src = readFileSync(file, 'utf8'), out = stampSource(src, v);
    if (out !== src) { writeFileSync(file, out); tally(src, out); }
  }
  const page = join(web, 'index.html');
  const html = readFileSync(page, 'utf8'), out = stampPage(html, v);
  if (!/src\/main\.js\?v=/.test(out) || !/style\.css\?v=/.test(out)) throw new Error('index.html: the script or stylesheet was not stamped');
  writeFileSync(page, out);
  tally(html, out);
  return count;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [v, web = 'web'] = process.argv.slice(2);
  if (!v || !/^[\w.-]+$/.test(v)) {
    console.error('usage: node tools/stamp.mjs <release> [web folder]');
    process.exit(2);
  }
  console.log(`stamped ${stampSite(web, v)} addresses with ?v=${v}`);
}
