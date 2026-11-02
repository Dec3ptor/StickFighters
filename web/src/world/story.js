// The story (world mode): "The Ember King". In every world, from the village where everyone
// starts: the ground shakes at night, and the elder sends you down to see why. A lost miner's
// journal speaks of black iron that burns, deep down; the smith makes you a pick fit to find it;
// the elder's letter takes you to the lord of the nearest city, who wants proof, then the city's
// trader, who has the old maps; three ancient seals (one deep in the west, one guarded by the
// Warden in the east, one bought with a diamond at the temple); the Ember key forged from them;
// and down, to the bottom of the world, where the Ember King waits in the fire. Then home.
//
// Thirteen steps, each a quest (quests.js) from someone real in the world: the people and places
// are found from where the world starts, so every world has the same story in its own towns.

import { folkOf } from './townsfolk.js';
import { WORLD_H } from './worldgen.js';

/** The nearest city to region k (either way), or null. */
function cityNear(gen, k) {
  for (let d = 1; d <= 24; d++) for (const dir of [1, -1]) { const t = gen.townIn(k + dir * d); if (t?.kind === 'city') return t; }
  return null;
}

/** The person doing `role` in town t (or the first of `also`, or anyone). */
function personIn(gen, t, role, ...also) {
  const people = folkOf(gen.seed, t);
  for (const r of [role, ...also]) { const p = people.find(x => x.role === r); if (p) return p; }
  return people[0] || null;
}

const at = (p, t) => ({ key: p.key, name: p.name, title: p.title, town: t.name, k: t.k, x: p.at.x, y: p.at.y });
const mid = t => Math.round((t.x0 + t.x1) / 2);
const way = (gen, from, to) => `${Math.round(Math.abs(to - from) / 10) * 10} blocks ${to < from ? 'west' : 'east'}`;

/**
 * Who's who in the story, in world `gen`: { home (the start's village), elder, smith, city,
 * lord, trader, healer }, or null (a world without towns).
 */
export function cast(gen) {
  if (!gen?.towns) return null;
  if (gen.storyCast !== undefined) return gen.storyCast;
  const home = gen.townIn(gen.spawnRegion), city = home && cityNear(gen, home.k);
  if (!home || !city) return (gen.storyCast = null);
  return (gen.storyCast = {
    home, city,
    elder: personIn(gen, home, 'elder', 'villager'), smith: personIn(gen, home, 'smith', 'merchant'),
    lord: personIn(gen, city, 'lord', 'guard'), trader: personIn(gen, city, 'trader', 'merchant'), healer: personIn(gen, city, 'healer', 'innkeeper'),
  });
}

/** How many steps the story has. */
export const STORY_STEPS = 13;

/**
 * Step `n` of the story (0 the first): { giver (who gives it: a townsfolk record), town, title,
 * text, goals, reward, turnIn (who it's handed in to: a key), said (what they say then) }, or null.
 * level: the player's.
 */
export function storyStep(gen, n, level = 1) {
  const c = cast(gen);
  if (!c) return null;
  const { home, city, elder, smith, lord, trader, healer } = c;
  const hx = mid(home), cx = mid(city), surf = x => gen.surfaceAt(x);
  const spot = (x, down) => ({ x, y: Math.min(WORLD_H - 14, surf(x) + down) });
  const westSeal = spot(cx - 70, 150), warden = spot(cx + 90, 160), journal = spot(hx + 45, 95), king = spot(hx - 20, WORLD_H - 40 - surf(hx - 20));
  const steps = [
    {
      giver: elder, town: home, title: 'The tremors',
      text: `The ground's been shaking at night, ${elder.name} says. Something stirs, deep down. Go down sixty blocks and see what you can see.`,
      goals: [{ t: 'depth', n: 60, done: false }], reward: { coins: 40, xp: 120, items: [['torch', 20]] },
      said: 'Warm stone, and a rumbling, you say? Then it\'s worse than I feared.',
    },
    {
      giver: elder, town: home, title: 'The lost miner',
      text: `Years ago a miner went down after the tremors and never came back. His journal is down there, ${way(gen, hx, journal.x)} of here and ${journal.y - surf(journal.x)} down. Find it.`,
      goals: [{ t: 'find', key: 'journal', at: journal }], place: { at: journal, key: 'journal' }, reward: { coins: 60, xp: 180 },
      said: '"Black iron that burns... a king in the fire..." He went mad down there. Or he saw something. Take this to the smith.',
    },
    {
      giver: elder, town: home, title: 'Black iron', turnIn: smith,
      text: `The journal speaks of black iron that burns. ${smith.name} the ${smith.title.toLowerCase()} will know what to make of it, but metal costs metal: take ten iron bars.`,
      goals: [{ t: 'bring', key: 'iron_bar', n: 10 }], reward: { coins: 30, xp: 200, items: [['iron_pickaxe', 1]] },
      said: 'Ember ore, that\'s what he found. Nobody\'s mined it in a hundred years. Here: a pick that won\'t shatter on the deep stone. Now go and tell the elder.',
    },
    {
      giver: elder, town: home, title: `To ${city.name}`, turnIn: lord,
      text: `This is bigger than ${home.name}. Take my letter to ${lord.name}, the ${lord.title.toLowerCase()} of ${city.name}, ${way(gen, hx, cx)} of here.`,
      goals: [{ t: 'deliver', key: 'letter', to: at(lord, city), done: false }], gives: [['letter', 1]], reward: { coins: 60, xp: 220 },
      said: `${elder.name} always did worry. But... the tremors reach us too. Very well. I'll hear more.`,
    },
    {
      giver: lord, town: city, title: 'Proof', turnIn: lord,
      text: level >= 6 ? 'Before I send my people anywhere, I want proof you can fight what lives down there. Kill three brutes.' : 'Before I send my people anywhere, I want proof you can fight what lives down there. Kill eight skeletons.',
      goals: [level >= 6 ? { t: 'kill', what: 'brute', n: 3, have: 0 } : { t: 'kill', what: 'skeleton', n: 8, have: 0 }], reward: { coins: 120, xp: 350, items: [['greater_potion', 1]] },
      said: `You'll do. ${trader.name} at the market keeps the old maps. Tell them I sent you.`,
    },
    {
      giver: lord, town: city, title: 'The old maps', turnIn: trader,
      text: `${trader.name} won't part with anything for nothing. Bring three amethysts to the market.`,
      goals: [{ t: 'bring', key: 'amethyst', n: 3 }], reward: { coins: 40, xp: 260, items: [['map_scrap', 1]] },
      said: 'The maps show three seals, older than the city: one deep to the west, one held by the Warden to the east, and one at the temple. Together, they make a key.',
    },
    {
      giver: trader, town: city, title: 'The first seal', turnIn: lord,
      text: `The first seal lies ${way(gen, cx, westSeal.x)} of ${city.name}, ${westSeal.y - surf(westSeal.x)} down, in a chest no one's opened in a hundred years. Bring it to ${lord.name}.`,
      goals: [{ t: 'find', key: 'seal', at: westSeal }], place: { at: westSeal, key: 'seal' }, reward: { coins: 150, xp: 400 },
      said: 'One seal. Two more.',
    },
    {
      giver: lord, town: city, title: 'The Warden', turnIn: lord,
      text: `The second seal is held by the Warden: something that won't die, ${way(gen, cx, warden.x)} of here and ${warden.y - surf(warden.x)} down. Destroy it.`,
      goals: [{ t: 'hunt', what: level >= 5 ? 'brute' : 'skeleton', name: 'The Warden', at: warden, hp: 6, done: false }], reward: { coins: 220, xp: 600, items: [['seal', 1]] },
      said: 'The Warden is gone, and this was in its bones. Two seals. The last is at the temple.',
    },
    {
      giver: lord, town: city, title: 'The third seal', turnIn: healer,
      text: `${healer.name} at the temple keeps the third seal, and won't give it up for less than a diamond, for the temple's altar.`,
      goals: [{ t: 'bring', key: 'diamond', n: 1 }], reward: { coins: 80, xp: 500, items: [['seal', 1]] },
      said: 'The seal has been on our altar since the temple was built. May it do you more good than it did us.',
    },
    {
      giver: healer, town: city, title: 'The Ember key', turnIn: smith,
      text: `Take the three seals home to ${smith.name} in ${home.name}, with ten gold bars: the seals must be set in gold to make the key.`,
      goals: [{ t: 'bring', key: 'seal', n: 3 }, { t: 'bring', key: 'gold_bar', n: 10 }], reward: { coins: 100, xp: 600, items: [['ember_key', 1]] },
      said: 'Three seals in a ring of gold. It\'s warm to the touch. Whatever door this opens, it\'s at the bottom of the world.',
    },
    {
      giver: smith, town: home, title: 'Into the fire', turnIn: smith,
      text: 'Go down. Right down, three hundred blocks, to where the stone burns. Take potions.',
      goals: [{ t: 'depth', n: 300, done: false }], reward: { coins: 100, xp: 600, items: [['greater_potion', 2]] },
      said: 'You came back up to tell me you heard it breathing? Then go back down and finish it.',
    },
    {
      giver: smith, town: home, title: 'The Ember King', turnIn: elder,
      text: `Under ${home.name}, at the very bottom of the world, the Ember King waits in the fire. Take the key, and end it.`,
      goals: [{ t: 'hunt', what: 'brute', name: 'The Ember King', at: king, hp: 16, done: false }, { t: 'bring', key: 'ember_key', n: 1 }],
      reward: { coins: 1000, xp: 2500, items: [['diamond', 3], ['greater_potion', 5]] },
      said: 'The tremors have stopped. The whole town slept through the night for the first time in a year. You did that.',
    },
    {
      giver: elder, town: home, title: `The hero of ${home.name}`, turnIn: elder,
      text: `Go and tell ${lord.name} in ${city.name} it's over.`,
      goals: [{ t: 'talk', to: at(lord, city), done: false }], reward: { coins: 300, xp: 1000, items: [['ruby', 2]] },
      said: `${home.name} will tell of this for a hundred years. Come back any time: there will always be a bed for you here.`,
    },
  ];
  return steps[n] || null;
}
