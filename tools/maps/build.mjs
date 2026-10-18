// Write every map design (tools/maps/designs/*.mjs) to web/data/maps/ and list
// it in web/data/maps/index.json (the original maps stay first).
//
// Usage: node tools/maps/build.mjs [design...]   (no names: all of them)
import fs from 'node:fs';
import path from 'node:path';
import { designNames, loadDesign, MAPS } from './load.mjs';

const ORDER = { small: 0, medium: 1, large: 2 };
const names = process.argv.length > 2 ? process.argv.slice(2) : designNames();
const indexFile = path.join(MAPS, 'index.json');
const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
for (const name of names) {
  const { data, info } = await loadDesign(name);
  fs.writeFileSync(path.join(MAPS, info.file), `${JSON.stringify(data)}\n`);
  const entry = { file: info.file, name: data.name, mode: info.modes?.[0] || 'ffa', modes: info.modes || [], size: info.size, players: info.players };
  const i = index.findIndex(e => e.file === info.file);
  if (i >= 0) index[i] = entry; else index.push(entry);
  console.log(`${info.file}: ${data.name} (${info.size}, ${info.players} players, ${(info.modes || []).join(', ')})`);
}
// Originals first (in their order), then the new maps from small to large.
const originals = index.filter(e => !e.size || e.original);
const made = index.filter(e => e.size && !e.original).sort((a, b) => ORDER[a.size] - ORDER[b.size] || a.name.localeCompare(b.name));
fs.writeFileSync(indexFile, `${JSON.stringify([...originals, ...made], null, 2)}\n`);
