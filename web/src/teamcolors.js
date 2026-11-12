// The two sides' colours, wherever they're drawn (soldiers and their name tags, the HUD, objectives,
// the map, supply drops), in both games. One place for them, so they can be changed together: a
// player's own choice (Settings, Video), kept in their browser.
//   - standard: the game's blue and red;
//   - strong: a blue and a vermilion picked to be told apart by people who don't see colours the
//     usual way (the Okabe-Ito pair), for the common kinds of colour blindness. The sides are
//     still called Blue and Red.
// The objects below are changed in place when the choice changes, so everything that reads from
// them (each frame) follows; anything that keeps a picture made with them asks teamPaletteVersion().

/** The sides' colours on the original's paper and in the HUD: [1] Blue's, [2] Red's. */
export const TEAM = { 1: '#2f6fdb', 2: '#d33b2f' };
/** Paler: a soldier's head filled with their side's (the original's stick figures). */
export const TEAM_HEAD = { 1: '#bcd4ff', 2: '#ffc2ba' };
/** Brighter: on Remastered's dark scenes (helmets, name tags). */
export const TEAM_BRIGHT = { 1: '#3d7ff0', 2: '#e8483a' };
/** The sides' names. */
export const TEAM_NAME = { 1: 'Blue', 2: 'Red' };

/** The choices: what each is called in Settings, and its colours. */
export const TEAM_PALETTES = {
  standard: { label: 'Blue and red', team: { 1: '#2f6fdb', 2: '#d33b2f' }, head: { 1: '#bcd4ff', 2: '#ffc2ba' }, bright: { 1: '#3d7ff0', 2: '#e8483a' } },
  strong: { label: 'Blue and orange-red (colour-blind friendly)', team: { 1: '#0072b2', 2: '#d55e00' }, head: { 1: '#a9dcff', 2: '#ffc890' }, bright: { 1: '#35a6f2', 2: '#ff7a1a' } },
};

let current = 'standard', version = 0;

/** Which palette is in use. */
export const teamPalette = () => current;
/** Goes up each time the colours change (for pictures kept with them in). */
export const teamPaletteVersion = () => version;

/** Use palette `id` ('standard' or 'strong'; anything else: standard). Returns the one now in use. */
export function setTeamPalette(id) {
  const next = TEAM_PALETTES[id] ? id : 'standard';
  if (next === current) return current;
  current = next;
  const p = TEAM_PALETTES[next];
  for (const t of [1, 2]) { TEAM[t] = p.team[t]; TEAM_HEAD[t] = p.head[t]; TEAM_BRIGHT[t] = p.bright[t]; }
  version++;
  return current;
}
