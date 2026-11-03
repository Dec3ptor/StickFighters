// A world's settings (world mode): chosen when it's made (the Worlds tab's New world), kept with
// it, and the same for everyone playing it online (the host's). What each one does:
//
//   vision      everything on the screen, or only what your soldier can see from where they stand
//               (line of sight: what's behind blocks is dark, and monsters there aren't shown)
//   difficulty  how many monsters come, how hard they hit and how much it takes to kill them
//               (peaceful: none, and no raids)
//   mode        survival; hardcore (one life: dying, you only watch); creative (dev mode from
//               the start: fly, build anything, nothing hurts you)
//   death       what's lost on dying, into a grave (worldplay.js)
//   time        day and night, always day, or always night
//   towns       towns and their people, or a wild world (worldgen.js)
//   raids       raids on towns at night (raids.js)
//   kit         what a new character starts with
//   hunger      players get hungry, eat to keep going and to heal (hunger.js), or never do

/** The settings: what each is called, its choices (key: what it says), and the one it starts at. */
export const WORLD_SETTINGS = {
  vision: { label: 'Seeing', options: { all: 'Everything on the screen', sight: 'Only what you can see' }, def: 'all', tip: 'Only what you can see: what\'s behind blocks is dark, and monsters there aren\'t shown (you hear them)' },
  difficulty: { label: 'Monsters', options: { peaceful: 'Peaceful (none)', easy: 'Easy', normal: 'Normal', hard: 'Hard' }, def: 'normal', tip: 'How many come, how hard they hit, and how much it takes to kill them' },
  mode: { label: 'Game', options: { survival: 'Survival', hardcore: 'Hardcore (one life)', creative: 'Creative (dev mode)' }, def: 'survival', tip: 'Hardcore: die once and it\'s over (you can watch). Creative: fly, build with anything, nothing hurts you' },
  death: { label: 'When you die', options: { bag: 'Your bag goes in a grave', coins: 'Only half your coins', all: 'Everything goes in a grave' }, def: 'bag', tip: 'What you lose goes in a grave where you died: right click it to have it all back' },
  time: { label: 'Time', options: { cycle: 'Day and night', day: 'Always day', night: 'Always night' }, def: 'cycle', tip: 'Monsters come out on the surface at night' },
  towns: { label: 'Towns and people', options: { on: 'Yes', off: 'None: a wild world' }, def: 'on', tip: 'Villages and cities, their people, shops and quests' },
  raids: { label: 'Raids on towns', options: { on: 'Yes', off: 'No' }, def: 'on', tip: 'Now and then at night, the dead come for a town you\'re near' },
  kit: { label: 'You start with', options: { full: 'Tools, guns, enough to build', basic: 'A pickaxe, an axe, torches', none: 'Nothing at all' }, def: 'full', tip: 'What a new character has' },
  hunger: { label: 'Hunger', options: { on: 'Yes: eat to keep going', off: 'No: food just heals' }, def: 'on', tip: 'Hungry, you stop healing by yourself; starving, you\'re hurt. Food fills you up (cook meat: it\'s better)' },
};

/** Monsters at each difficulty: how often they come, how hard they hit, how much health they have. */
export const DIFFICULTY = {
  peaceful: { spawn: 0, dmg: 0.5, hp: 1 },
  easy: { spawn: 0.6, dmg: 0.6, hp: 0.8 },
  normal: { spawn: 1, dmg: 1, hp: 1 },
  hard: { spawn: 1.6, dmg: 1.5, hp: 1.4 },
};

/** Settings from a save or the network: only what there is, the rest as they start. */
export function cleanSettings(o) {
  const out = {};
  for (const [k, d] of Object.entries(WORLD_SETTINGS)) out[k] = o && typeof o[k] === 'string' && d.options[o[k]] ? o[k] : d.def;
  return out;
}

/** World `world`'s setting `key`. */
export const settingOf = (world, key) => world?.settings?.[key] ?? WORLD_SETTINGS[key].def;

/** The monsters' numbers in world `world`. */
export const difficultyOf = world => DIFFICULTY[settingOf(world, 'difficulty')] || DIFFICULTY.normal;

/** What's different from the usual, in a few words (the Worlds list says it under a world's name). */
export function settingsSummary(s) {
  const c = cleanSettings(s), out = [];
  for (const [k, d] of Object.entries(WORLD_SETTINGS)) {
    if (c[k] === d.def || k === 'death') continue;
    out.push(k === 'vision' ? 'Line of sight' : k === 'towns' ? 'No towns' : k === 'raids' ? 'No raids' : k === 'hunger' ? 'No hunger' : k === 'kit' ? `Start: ${c[k]}` : d.options[c[k]].replace(/ \(.*\)$/, ''));
  }
  return out.join(' · ');
}

/** What a new character starts with, by the world's `kit` setting ([key, n] pairs; full: items.js's STARTING_KIT). */
export const KITS = {
  basic: [['pickaxe', 1], ['axe', 1], ['torch', 20], ['planks', 20], ['workbench', 1]],
  none: [],
};
/** World `world`'s kit for new characters, or null (the full one). */
export const kitOf = world => KITS[settingOf(world, 'kit')] || null;

/**
 * The time of day kept as the world says: always day (night skipped, from six in the evening to
 * six the next morning), or always night (day skipped). Returns the time to use. (dayTicks: a
 * day's length; hourOf: the hour of a time: monsters.js.)
 */
export function keepTime(world, t, dayTicks, hourOf) {
  const mode = settingOf(world, 'time');
  if (mode === 'cycle') return t;
  const h = hourOf(t), day = Math.floor(t / dayTicks), hour = dayTicks / 24;
  // (Hour h of a world's day d: days start at six in the morning.)
  const at = (d, hh) => d * dayTicks + ((hh - 6 + 24) % 24) * hour;
  // (After six in the evening, or before six the next morning: still the same day of the world's.)
  if (mode === 'day') return h >= 18 || h < 6 ? at(day + 1, 6.01) : t;
  // (From five in the morning to seven in the evening: on to seven that evening, forward always.)
  return h >= 5 && h < 19 ? at(h < 6 ? day + 1 : day, 19) : t;
}
