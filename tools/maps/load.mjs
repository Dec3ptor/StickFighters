// Finding a map by name for the map tools: a design in tools/maps/designs/,
// a map file in web/data/maps/, or any .json file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeMap } from '../../web/src/custommaps.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');
export const DESIGNS = path.join(here, 'designs');
export const MAPS = path.join(ROOT, 'web/data/maps');

/** Every design: [{ name, file }] (name = the design's file name without .mjs). */
export function designNames() {
  if (!fs.existsSync(DESIGNS)) return [];
  return fs.readdirSync(DESIGNS).filter(f => f.endsWith('.mjs')).map(f => f.slice(0, -4)).sort();
}

/** A design's map data and its menu details ({ data, info }). */
export async function loadDesign(name) {
  const mod = await import(pathToFileURL(path.join(DESIGNS, `${name}.mjs`)).href + `?t=${Date.now()}`);
  const data = mod.default().build();
  return { data, info: { file: `${name}.json`, name: data.name, ...mod.info } };
}

/** Map data for a name: a design, a map in web/data/maps/, or a path to a .json file. */
export async function loadMap(arg) {
  const bare = arg.replace(/\.(json|mjs)$/, '');
  if (fs.existsSync(path.join(DESIGNS, `${path.basename(bare)}.mjs`)) && !arg.includes('/')) return (await loadDesign(path.basename(bare))).data;
  const file = fs.existsSync(arg) ? arg : path.join(MAPS, `${bare}.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  // The game's own maps are used as they are (the originals keep their original bounds).
  return file.startsWith(MAPS) ? raw : normalizeMap(raw);
}
