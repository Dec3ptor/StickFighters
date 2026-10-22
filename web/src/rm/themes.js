// Remastered's looks: each map is drawn in a theme (a sky, layers of scenery
// behind the play area that scroll slower the further away they are, haze,
// weather, the blocks' materials and the soldiers' colours). Pure data: the
// drawing is in backdrop.js, blocks.js and soldiers.js.
//
// Layer `p`: how far it scrolls with the camera (0 = not at all, like the sky;
// 1 = with the play area). `gen` picks a generator in backdrop.js; `height` is
// the tallest it gets (world units above its ground line); `haze` mixes its
// colour toward the theme's haze colour (further = hazier). `fore`: dark shapes
// close up in front, below the play area (`gen` picks one in backdrop.js's FORE).

export const THEMES = {
  dusk: {
    name: 'Sunset city',
    sky: [[0, '#151536'], [0.42, '#4a2a5e'], [0.7, '#b8506c'], [0.86, '#ee8a5c'], [1, '#ffc27c']],
    sun: { x: 0.7, y: 0.66, r: 40, color: '#fff0c4', glow: '#ff9d5c', glowR: 360 },
    clouds: { color: '#ffb3a0', alpha: 0.32, count: 9, top: 0.12, bottom: 0.5 },
    haze: '#ee8a5c',
    layers: [
      { p: 0.08, gen: 'ridge', height: 230, color: '#7a4470', haze: 0.45, rough: 0.5 },
      { p: 0.2, gen: 'skyline', height: 380, color: '#47284f', haze: 0.32, windows: '#ffd28a', lit: 0.18 },
      { p: 0.42, gen: 'skyline', height: 300, color: '#2a1733', haze: 0.16, windows: '#ffbd62', lit: 0.1, gap: 0.6, roof: true },
    ],
    ground: '#1a0f20',
    fore: { gen: 'rooftop', height: 60, color: '#0d0810' },
    mist: { color: '#f29a6a', alpha: 0.22 },
    weather: null,
    material: 'concrete', top: 'tiles', tint: '#9a8790',
    light: { x: 0.55, y: -0.85, color: '#ffc58a', strength: 0.5 },
    ink: '#17111d', halo: '#ffd9b0', haloAlpha: 0.32, rim: '#ffb27a',
    vignette: 0.45, dark: 0,
  },
  night: {
    name: 'Night ops',
    sky: [[0, '#03050c'], [0.55, '#0a1430'], [0.85, '#15284a'], [1, '#22385c']],
    sun: { x: 0.24, y: 0.22, r: 22, color: '#eef3ff', glow: '#5d7fc0', glowR: 220, moon: true },
    stars: 0.0009,
    haze: '#1f3557',
    layers: [
      { p: 0.07, gen: 'ridge', height: 200, color: '#14223f', haze: 0.35, rough: 0.6 },
      { p: 0.18, gen: 'base', height: 260, color: '#0d1830', haze: 0.22, beacons: '#ff3b30' },
      { p: 0.38, gen: 'fence', height: 160, color: '#070d1c', haze: 0.08 },
    ],
    ground: '#050913',
    fore: { gen: 'crates', height: 60, color: '#03060c' },
    mist: { color: '#2a4a7a', alpha: 0.25 },
    weather: 'rain',
    material: 'metal', top: 'grating', tint: '#3e4756',
    light: { x: -0.4, y: -0.9, color: '#9fb8e8', strength: 0.35 },
    ink: '#dfe7f3', halo: '#0a1020', haloAlpha: 0.5, rim: '#9fc4ff',
    vignette: 0.6, dark: 0.42,
  },
  arctic: {
    name: 'Frozen ridge',
    sky: [[0, '#5d97cf'], [0.55, '#a9d1ef'], [1, '#eaf5fc']],
    sun: { x: 0.78, y: 0.2, r: 30, color: '#ffffff', glow: '#d8ecff', glowR: 300 },
    clouds: { color: '#ffffff', alpha: 0.5, count: 8, top: 0.08, bottom: 0.4 },
    haze: '#dbeaf6',
    layers: [
      { p: 0.07, gen: 'peaks', height: 340, color: '#9fbad6', haze: 0.45, snow: '#f4f9ff' },
      { p: 0.18, gen: 'peaks', height: 260, color: '#6f8fae', haze: 0.28, snow: '#eef6fd' },
      { p: 0.4, gen: 'pines', height: 190, color: '#2f4d60', haze: 0.12, snow: '#e8f2f8' },
    ],
    ground: '#20384a',
    fore: { gen: 'rocks', height: 70, color: '#16232e', snow: '#c9d9e6' },
    mist: { color: '#ffffff', alpha: 0.35 },
    weather: 'snow',
    material: 'rock', top: 'snow', tint: '#7a8794',
    light: { x: 0.5, y: -0.85, color: '#ffffff', strength: 0.45 },
    ink: '#18212c', halo: '#ffffff', haloAlpha: 0.3, rim: '#ffffff',
    vignette: 0.32, dark: 0,
  },
  desert: {
    name: 'Desert outpost',
    sky: [[0, '#2f73b6'], [0.55, '#8fc0de'], [0.82, '#f0d6a6'], [1, '#f6c07e']],
    sun: { x: 0.3, y: 0.18, r: 34, color: '#fffbe8', glow: '#ffe8b0', glowR: 340 },
    clouds: { color: '#fff4e0', alpha: 0.28, count: 5, top: 0.08, bottom: 0.3 },
    haze: '#f0d2a0',
    layers: [
      { p: 0.07, gen: 'mesas', height: 230, color: '#c79a76', haze: 0.45 },
      { p: 0.2, gen: 'dunes', height: 140, color: '#c98a55', haze: 0.25 },
      { p: 0.42, gen: 'rocks', height: 170, color: '#7a4b2c', haze: 0.1, cacti: true },
    ],
    ground: '#5e3820',
    fore: { gen: 'rocks', height: 64, color: '#2a170b', scrub: true, cacti: true },
    mist: { color: '#f3d29c', alpha: 0.28 },
    weather: 'dust',
    material: 'sandstone', top: 'sand', tint: '#c49468',
    light: { x: -0.45, y: -0.9, color: '#fff2cc', strength: 0.55 },
    ink: '#24160c', halo: '#fff3d8', haloAlpha: 0.32, rim: '#fff0c8',
    vignette: 0.35, dark: 0,
  },
  jungle: {
    name: 'Overgrown',
    sky: [[0, '#4f93bd'], [0.55, '#9ccdc5'], [1, '#e2efcd']],
    sun: { x: 0.62, y: 0.16, r: 30, color: '#fffbe0', glow: '#fff2b8', glowR: 320 },
    clouds: { color: '#ffffff', alpha: 0.35, count: 7, top: 0.06, bottom: 0.35 },
    haze: '#cfe6d2',
    layers: [
      { p: 0.07, gen: 'hills', height: 220, color: '#79a894', haze: 0.45 },
      { p: 0.2, gen: 'canopy', height: 260, color: '#3f7653', haze: 0.25 },
      { p: 0.42, gen: 'canopy', height: 230, color: '#1d4430', haze: 0.08, tall: true },
    ],
    ground: '#0f2a1c',
    fore: { gen: 'grass', height: 90, color: '#07150d' },
    mist: { color: '#e4f4e6', alpha: 0.38 },
    weather: 'motes',
    material: 'mossrock', top: 'grass', tint: '#6f735c',
    light: { x: 0.35, y: -0.9, color: '#fff6d0', strength: 0.45 },
    ink: '#13201a', halo: '#f2ffe8', haloAlpha: 0.28, rim: '#fff6c0',
    vignette: 0.38, dark: 0,
  },
  foundry: {
    name: 'Foundry',
    sky: [[0, '#140707'], [0.45, '#3d140e'], [0.78, '#94371a'], [1, '#e2782e']],
    sun: { x: 0.5, y: 1.05, r: 0, color: '#ffb060', glow: '#ff6a1c', glowR: 520 },
    haze: '#b2481e',
    layers: [
      { p: 0.07, gen: 'industry', height: 300, color: '#4a1c12', haze: 0.4, smoke: true },
      { p: 0.2, gen: 'industry', height: 250, color: '#2a100b', haze: 0.22, tanks: true },
      { p: 0.42, gen: 'girders', height: 220, color: '#130705', haze: 0.06 },
    ],
    ground: '#0d0403',
    fore: { gen: 'crates', height: 60, color: '#080302' },
    mist: { color: '#ff7a2c', alpha: 0.26 },
    weather: 'embers',
    material: 'rust', top: 'grating', tint: '#7a5a48', hazard: true,
    light: { x: 0, y: 0.8, color: '#ff9a50', strength: 0.5 },
    ink: '#120806', halo: '#ffcf9e', haloAlpha: 0.32, rim: '#ff9a4c',
    vignette: 0.55, dark: 0.12,
  },
  castle: {
    name: 'Twilight keep',
    sky: [[0, '#1b2246'], [0.5, '#474b83'], [0.8, '#a985a6'], [1, '#e6b6a2']],
    sun: { x: 0.18, y: 0.3, r: 26, color: '#fdf3e6', glow: '#b9a2d8', glowR: 260, moon: true },
    stars: 0.0003,
    clouds: { color: '#d7b7d4', alpha: 0.28, count: 6, top: 0.1, bottom: 0.45 },
    haze: '#a98aa8',
    layers: [
      { p: 0.07, gen: 'ridge', height: 240, color: '#4d5182', haze: 0.4, rough: 0.35 },
      { p: 0.2, gen: 'castles', height: 330, color: '#2c2e57', haze: 0.22, windows: '#ffcf7a' },
      { p: 0.42, gen: 'pines', height: 210, color: '#15172f', haze: 0.06 },
    ],
    ground: '#0c0d1c',
    fore: { gen: 'grass', height: 70, color: '#07081a' },
    mist: { color: '#c7a5c4', alpha: 0.25 },
    weather: null,
    material: 'stone', top: 'moss', tint: '#7d7c8c',
    light: { x: -0.6, y: -0.75, color: '#d8c8ff', strength: 0.4 },
    ink: '#12142a', halo: '#f2e8ff', haloAlpha: 0.32, rim: '#e0d0ff',
    vignette: 0.48, dark: 0.08,
  },
  warzone: {
    name: 'Frontline',
    sky: [[0, '#2d2a28'], [0.5, '#5f554b'], [0.85, '#a8876a'], [1, '#c99c74']],
    sun: { x: 0.65, y: 0.42, r: 26, color: '#ffe0b8', glow: '#e09a60', glowR: 300 },
    clouds: { color: '#3a3430', alpha: 0.4, count: 10, top: 0.05, bottom: 0.4 },
    haze: '#a38468',
    layers: [
      { p: 0.07, gen: 'ruins', height: 260, color: '#5d5148', haze: 0.4, fires: '#ff8a3a' },
      { p: 0.2, gen: 'ruins', height: 220, color: '#3a312b', haze: 0.22, fires: '#ff7a2a' },
      { p: 0.42, gen: 'wire', height: 120, color: '#1c1815', haze: 0.06 },
    ],
    ground: '#14110e',
    fore: { gen: 'rubble', height: 64, color: '#0b0907' },
    mist: { color: '#b89a7c', alpha: 0.3 },
    weather: 'ash',
    material: 'concrete', top: 'dirt', tint: '#837a6e',
    light: { x: 0.5, y: -0.8, color: '#ffd8a8', strength: 0.4 },
    ink: '#15120e', halo: '#fff0dc', haloAlpha: 0.3, rim: '#ffcf98',
    vignette: 0.5, dark: 0,
  },
  harbor: {
    name: 'Harbor',
    sky: [[0, '#2a67a3'], [0.6, '#86b9dc'], [1, '#e4eef2']],
    sun: { x: 0.8, y: 0.24, r: 30, color: '#ffffff', glow: '#fff3d0', glowR: 300 },
    clouds: { color: '#ffffff', alpha: 0.42, count: 8, top: 0.06, bottom: 0.38 },
    haze: '#d6e6ee',
    layers: [
      { p: 0.06, gen: 'sea', height: 120, color: '#7f9fb4', haze: 0.35, water: '#4f86ad' },
      { p: 0.18, gen: 'ships', height: 230, color: '#4b6378', haze: 0.22 },
      { p: 0.4, gen: 'docks', height: 260, color: '#24323f', haze: 0.08 },
    ],
    ground: '#132029',
    fore: { gen: 'quay', height: 60, color: '#0a1218' },
    mist: { color: '#eef6fa', alpha: 0.3 },
    weather: null,
    material: 'concrete', top: 'planks', tint: '#8a8a82', hazard: true,
    light: { x: -0.5, y: -0.85, color: '#ffffff', strength: 0.45 },
    ink: '#121a22', halo: '#ffffff', haloAlpha: 0.3, rim: '#ffffff',
    vignette: 0.32, dark: 0,
  },
  hangar: {
    name: 'Hangar',
    indoor: true,
    sky: [[0, '#0e1116'], [0.6, '#1a2029'], [1, '#262e39']],
    haze: '#3a4452',
    layers: [
      { p: 0.25, gen: 'wall', height: 900, color: '#232a34', haze: 0.1, windows: '#f2a35e' },
      { p: 0.45, gen: 'beams', height: 900, color: '#12161c', haze: 0.04 },
    ],
    ground: '#0b0e12',
    fore: { gen: 'crates', height: 60, color: '#06080b' },
    mist: { color: '#5a6676', alpha: 0.18 },
    weather: 'motes',
    material: 'steel', top: 'diamond', tint: '#66707c', hazard: true,
    light: { x: 0, y: -1, color: '#ffe6c0', strength: 0.4 },
    ink: '#e6ebf2', halo: '#0b0e12', haloAlpha: 0.45, rim: '#ffd9a0',
    vignette: 0.55, dark: 0.18, lamps: '#ffd9a0',
  },
};

// Which theme each of the game's maps is drawn in (by name: a copy of one in the
// map maker keeps its look until it's renamed).
export const MAP_THEMES = {
  'Fire in the Hole': 'dusk', 'Habitat': 'jungle', 'King of the Hill': 'desert', 'Fraghouse': 'hangar',
  'Sniping Grounds': 'arctic', 'Fatality Zone': 'night', 'Hells Steeple': 'foundry', 'Two Towers': 'castle',
  'Crossfire': 'desert', 'Pit Stop': 'hangar', 'Summit': 'arctic', 'Twin Keeps': 'castle', 'Foundry': 'foundry',
  'Skyline': 'dusk', 'Citadel': 'castle', 'Frontline': 'warzone', 'Harbor': 'harbor', 'Valley': 'jungle',
  'Kasbah': 'desert',
};

export const THEME_IDS = Object.keys(THEMES);

/**
 * The theme for a map: its own (`map.theme`, from the map maker), the game map's,
 * or one picked from its name (so a custom map always looks the same).
 */
export function themeFor(map) {
  const id = map?.theme && THEMES[map.theme] ? map.theme
    : MAP_THEMES[map?.name] || THEME_IDS[hash(map?.name || '') % THEME_IDS.length];
  return { id, ...THEMES[id] };
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
