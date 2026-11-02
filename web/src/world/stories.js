// The townsfolk's own stories (world mode): everyone in every town has a life of their own, from
// the world's seed. Where they're from, what they did before, who their family are (a husband,
// wife or sister in the same town, a brother in another, by name: real people you can go and
// meet), what kind of person they are, what they want most, and what they're afraid of. Ask them
// ("Tell me about yourself") and they'll tell you, in their own way.
//
// And what they want is a mission of their own (personal: three steps, one after another): carry
// a letter to their brother in another town and bring back his answer, find what was lost, bring
// down the brute that killed their father, fetch what they need to make their masterpiece, go to
// the bottom of the world for them... Each step a quest (quests.js), with what they say as it goes.

import { hash3 } from './noise.js';
import { folkOf, ROLES } from './townsfolk.js';
import { WORLD_H } from './worldgen.js';

/** A number from a text (a townsperson's key), the same every time. */
function keyHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
const pick = (list, h, salt = 0) => list[(Math.imul(h ^ (salt * 0x9e3779b9), 2654435761) >>> 0) % list.length];

const TRAITS = [
  ['cheerful', 'always smiling, whatever the weather'], ['gruff', 'short with words, and shorter with fools'], ['nervous', 'jumpy at every sound after dark'],
  ['proud', 'proud of their work, and not shy about it'], ['kind', 'the first to help when someone\'s in trouble'], ['suspicious', 'slow to trust a stranger'],
  ['dreamy', 'always half somewhere else'], ['practical', 'all common sense and no nonsense'], ['superstitious', 'full of charms and old sayings'],
  ['stubborn', 'never one to change their mind'], ['curious', 'full of questions about everywhere else'], ['quiet', 'a person of few words'],
];
const PASTS = {
  any: ['was a soldier, once, in the border wars', 'sailed with the river traders as a youngster', 'worked the deep mines until the cave-in', 'ran away from home at fourteen', 'was a baker\'s apprentice', 'drove caravans across the desert', 'trapped furs in the far north', 'was a guard on the city walls'],
  smith: ['learned the trade from their grandmother', 'forged blades for the old lord\'s army'],
  gunsmith: ['made fireworks before they made guns', 'lost two fingers to a bad batch of powder'],
  healer: ['nursed the sick through the grey fever', 'studied the old herbals at the temple school'],
  guard: ['fought brutes in the deep tunnels', 'was the youngest guard the town ever had'],
  merchant: ['lost a fortune and made another', 'traded salt for silver along the coast'],
  trader: ['has crossed every desert there is', 'sold gems to kings, or says they have'],
  innkeeper: ['brewed ale in a monastery', 'won the inn in a game of cards'],
  elder: ['remembers when there were wolves in the hills', 'led the town through the long winter'],
  lord: ['inherited the city from an uncle nobody liked', 'won the city\'s favour by fighting off a siege'],
  farmer: ['brought the first wheat seed to the valley', 'has farmed the same field for thirty years'],
  villager: ['carved the sign over the inn', 'once walked all the way to the snow and back'],
};
const KIN = ['cousin', 'twin', 'child', 'oldest friend', 'old comrade', 'kin'];
const FEARS = ['the dark', 'the deep places', 'brutes', 'fire', 'being forgotten', 'the long winter nights', 'zombies at the window', 'heights', 'the sound of digging under the house'];
const AGE = { elder: 'old', lord: 'middle-aged' };

/**
 * Townsperson f's story (of town t): { trait, past, from (a town's name, or null: born here),
 * partner (someone in the same town, or null), kin: { word ('brother'...), name, key, town, k,
 * x, y } (someone in another town, or null), fear, want (their wish: a key into WANTS), age }.
 * The same for the same seed.
 */
export function storyOf(gen, f, t) {
  const h = keyHash(f.key) ^ (gen.seed | 0);
  const people = folkOf(gen.seed, t);
  // (Someone to share a house or a life with: the other person in the same house, or someone else in town.)
  const housemate = people.find(p => p.bi === f.bi && p.key !== f.key);
  const partner = housemate || (pick([0, 1, 2], h, 3) === 0 ? pick(people.filter(p => p.key !== f.key && p.role !== 'guard'), h, 4) || null : null);
  // (Kin in another town: someone real, who'll know of them.)
  let kin = null;
  for (let d = 1; d <= 4 && !kin; d++) {
    const k = t.k + (pick([-1, 1], h, 5 + d)) * d, o = gen.townIn(k);
    if (!o) continue;
    const there = folkOf(gen.seed, o);
    if (!there.length) continue;
    const p = pick(there, h, 9 + d);
    kin = { word: pick(KIN, h, 11), name: p.name, key: p.key, town: o.name, k: o.k, x: p.at.x, y: p.at.y, title: p.title };
  }
  const roleWants = { smith: ['masterpiece', 'masterpiece', 'kin'], gunsmith: ['masterpiece', 'kin'], guard: ['revenge', 'revenge', 'kin'], elder: ['bottom', 'history', 'kin'], lord: ['revenge', 'history'], healer: ['herbs', 'kin', 'heirloom'], trader: ['fortune', 'bottom'], merchant: ['fortune', 'kin', 'heirloom'], innkeeper: ['kin', 'heirloom', 'fortune'] };
  const want = pick(roleWants[f.role] || ['kin', 'heirloom', 'revenge', 'bottom', 'kin'], h, 13);
  const fromTown = pick([null, null, 'other'], h, 14) && kin ? kin.town : null;
  return {
    trait: pick(TRAITS, h, 15), past: pick([...(PASTS[f.role] || []), ...PASTS.any], h, 16), from: fromTown,
    partner: partner ? { name: partner.name, title: partner.title } : null, kin: want === 'kin' && !kin ? null : kin,
    fear: pick(FEARS, h, 17), want: want === 'kin' && !kin ? 'heirloom' : want, age: AGE[f.role] || pick(['young', 'middle-aged', 'getting on'], h, 18),
    lostWho: pick(['father', 'mother', 'brother', 'sister', 'best friend', 'husband', 'wife'], h, 19),
    heirloom: pick([['locket', 'my mother\'s silver locket'], ['ring', 'my grandfather\'s gold ring'], ['relic', 'our family relic'], ['idol', 'the little stone idol my family has kept for generations']], h, 20),
  };
}

/** What townsperson f says about themselves (asked "Tell me about yourself"): a few sentences, in their voice. */
export function tellAbout(gen, f, t) {
  const s = storyOf(gen, f, t), out = [];
  out.push(s.from ? `I'm ${f.name}. I came to ${t.name} from ${s.from}, years ago now.` : `I'm ${f.name}. Born and raised in ${t.name}, and never left.`);
  out.push(`I ${s.past}. Now I'm ${f.role === 'villager' ? 'just one of the folk here' : `the ${f.title.toLowerCase()}`}.`);
  if (s.partner) out.push(`${s.partner.name} and I share a roof${s.partner.title && s.partner.title !== 'Villager' ? `: you'll know them, the ${s.partner.title.toLowerCase()}` : ''}.`);
  if (s.kin && s.want !== 'kin') out.push(`My ${s.kin.word}, ${s.kin.name}, lives in ${s.kin.town}.`);
  out.push(`People say I'm ${s.trait[0]}: ${s.trait[1]}. I'm afraid of ${s.fear}, if you must know.`);
  out.push(WANT_WORDS[s.want](s, f, t));
  return out.join(' ');
}

const WANT_WORDS = {
  kin: (s) => `What I want most? To hear from my ${s.kin.word}, ${s.kin.name}, in ${s.kin.town}. We haven't spoken since the quarrel.`,
  heirloom: (s) => `I lost ${s.heirloom[1]} when the monsters came. I'd give anything to have it back.`,
  revenge: (s) => `A brute killed my ${s.lostWho}, down in the deep. I want it dead.`,
  bottom: () => 'I want to know what\'s at the bottom of the world. Someone has to go and see.',
  masterpiece: (s, f) => `I want to make one thing in my life that people will remember: a masterpiece. I just need the right ${f.role === 'gunsmith' ? 'parts' : 'metal'}.`,
  history: (s, f, t) => `I'm writing the history of ${t.name}, and the towns round about. There's so much nobody's written down.`,
  herbs: () => 'There\'s a sickness coming every winter, and I\'ve no cure for it. Not yet.',
  fortune: () => 'One more good season and I could buy a place in a city. One more.',
};

// ---- Their missions: three steps each --------------------------------------------------------------------

/**
 * The step-th quest of townsperson f's own mission (0, 1, 2), or null when it's done (or they
 * have none). Quests in the same shape as quests.js's (it gives them the rest: the id, the giver).
 * level: the player's.
 */
export function missionStep(gen, f, t, step, level = 1) {
  const s = storyOf(gen, f, t), steps = MISSIONS[s.want]?.(s, f, t, gen, level);
  const q = steps?.[step];
  if (!q) return null;
  return { ...q, steps: steps.length, want: s.want };
}

/** A spot deep under column x (for things to find, and monsters to hunt). */
function deepSpot(gen, x, h, far, depth) {
  const tx = Math.round(x + ((h & 1) ? -1 : 1) * (far[0] + (h >>> 3) % (far[1] - far[0] + 1)));
  const surf = gen.surfaceAt(tx);
  return { x: tx, y: Math.min(WORLD_H - 14, surf + depth[0] + (h >>> 9) % (depth[1] - depth[0] + 1)) };
}

const MISSIONS = {
  kin: (s, f, t) => {
    const to = { key: s.kin.key, name: s.kin.name, title: s.kin.title, town: s.kin.town, k: s.kin.k, x: s.kin.x, y: s.kin.y };
    return [
      {
        title: `A letter for ${s.kin.name}`, text: `Would you take a letter to my ${s.kin.word}, ${s.kin.name}, in ${s.kin.town}? I've written it a hundred times. This time I'll send it.`,
        goals: [{ t: 'deliver', key: 'letter', to, done: false }], reward: { coins: 30, xp: 90, items: [['reply', 1]] }, turnIn: s.kin.key, gives: [['letter', 1]],
        said: `${f.name} wrote to me? After all this time... Here: take my answer back to them.`,
      },
      {
        title: `${s.kin.name}'s answer`, text: `Take ${s.kin.name}'s answer back to ${f.name} in ${t.name}.`,
        goals: [{ t: 'bring', key: 'reply', n: 1 }], reward: { coins: 50, xp: 140 },
        said: `They wrote back! I... thank you. One more thing: take them this, from me.`,
      },
      {
        title: 'A gift', text: `Take this parcel to ${s.kin.name} in ${s.kin.town}: something of our mother's. They should have it.`,
        goals: [{ t: 'deliver', key: 'parcel', to, done: false }], reward: { coins: 80, xp: 220, items: [['greater_potion', 1]] }, turnIn: s.kin.key, gives: [['parcel', 1]],
        said: `Mother's brooch... ${f.name} kept it all these years. Tell them I'll visit, come spring. And take this, for all your walking.`,
      },
    ];
  },
  heirloom: (s, f, t, gen) => {
    const at = deepSpot(gen, (t.x0 + t.x1) / 2, keyHash(f.key), [40, 110], [25, 70]);
    return [
      {
        title: `${f.name}'s ${s.heirloom[0] === 'relic' ? 'relic' : s.heirloom[0]}`, text: `${s.heirloom[1][0].toUpperCase()}${s.heirloom[1].slice(1)}: I hid it in a chest when the monsters came, in a hollow ${Math.abs(at.x - Math.round((t.x0 + t.x1) / 2))} blocks ${at.x < (t.x0 + t.x1) / 2 ? 'west' : 'east'} of town, ${at.y - gen.surfaceAt(at.x)} down. I've never dared go back.`,
        goals: [{ t: 'find', key: s.heirloom[0], at }], reward: { coins: 60, xp: 160 }, place: { at, key: s.heirloom[0] },
        said: 'You found it! I thought it was gone forever.',
      },
      {
        title: 'The ones who took it', text: `The skeletons that drove me off are still down there. Make sure they never drive anyone else off: kill eight of them.`,
        goals: [{ t: 'kill', what: 'skeleton', n: 8, have: 0 }], reward: { coins: 70, xp: 180 }, said: 'I can sleep at night again.',
      },
      {
        title: 'A gift', text: `I want to give you something for all this, but I need to have it made. Bring me two amethysts, and I'll have the smith set them.`,
        goals: [{ t: 'bring', key: 'amethyst', n: 2 }], reward: { coins: 40, xp: 200, items: [['topaz', 1], ['healing_potion', 2]] }, said: 'There. Something to remember me by.',
      },
    ];
  },
  revenge: (s, f, t, gen, level) => {
    const h = keyHash(f.key), at = deepSpot(gen, (t.x0 + t.x1) / 2, h, [60, 160], level >= 6 ? [90, 180] : [40, 100]);
    const name = `${['Gnasher', 'Old Scar', 'Redmaw', 'Bonebreaker', 'the Butcher', 'Ironhide'][h % 6]}`;
    return [
      {
        title: 'The one that did it', text: `The brute that killed my ${s.lostWho} has a scar across its face. Folk call it ${name}. First, show me you can fight: kill five skeletons.`,
        goals: [{ t: 'kill', what: 'skeleton', n: 5, have: 0 }], reward: { coins: 40, xp: 120 }, said: 'Good. You can handle yourself.',
      },
      {
        title: `Hunting ${name}`, text: `${name}'s lair is ${Math.abs(at.x - Math.round((t.x0 + t.x1) / 2))} blocks ${at.x < (t.x0 + t.x1) / 2 ? 'west' : 'east'}, ${at.y - gen.surfaceAt(at.x)} down. Kill it. For my ${s.lostWho}.`,
        goals: [{ t: 'hunt', what: level >= 4 ? 'brute' : 'skeleton', name, at, done: false }], reward: { coins: 150, xp: 400, items: [['ruby', 1]] },
        said: `It's dead? Truly? My ${s.lostWho} can rest now. Thank you.`,
      },
      {
        title: 'Never again', text: `I want ${t.name} to be ready the next time. Bring the guards ten iron bars for new blades.`,
        goals: [{ t: 'bring', key: 'iron_bar', n: 10 }], reward: { coins: 90, xp: 220, items: [['greater_potion', 1]] }, said: `${t.name} owes you. I owe you.`,
      },
    ];
  },
  bottom: (s, f, t, gen) => {
    const at = deepSpot(gen, (t.x0 + t.x1) / 2, keyHash(f.key) ^ 77, [20, 80], [WORLD_H - 220, WORLD_H - 160]);
    return [
      { title: 'Halfway down', text: 'Go down a hundred and fifty blocks, and tell me what you see.', goals: [{ t: 'depth', n: 150, done: false }], reward: { coins: 50, xp: 160 }, said: 'Hot, you say? And red light below? Then the stories are true.' },
      { title: 'The fire below', text: 'Now go further. Three hundred blocks down, to where the stone burns.', goals: [{ t: 'depth', n: 300, done: false }], reward: { coins: 90, xp: 300 }, said: 'You stood by the fire at the bottom of the world. Remarkable.' },
      {
        title: 'Proof', text: `They say there's an old idol at the very bottom, ${at.y - gen.surfaceAt(at.x)} blocks down, left by whoever was here before us. Bring it to me.`,
        goals: [{ t: 'find', key: 'idol', at }], reward: { coins: 200, xp: 600, items: [['diamond', 1]] }, place: { at, key: 'idol' }, said: 'So someone was here before us. Everything I believed is true.',
      },
    ];
  },
  masterpiece: (s, f) => [
    { title: 'Good metal', text: `My masterpiece needs the best metal: bring me eight gold bars.`, goals: [{ t: 'bring', key: 'gold_bar', n: 8 }], reward: { coins: 120, xp: 220 }, said: 'Fine gold. This will do.' },
    { title: 'A heart of stone', text: 'And for its heart, a sapphire. A perfect one.', goals: [{ t: 'bring', key: 'sapphire', n: 1 }], reward: { coins: 80, xp: 260 }, said: 'Blue as deep water. Perfect.' },
    {
      title: 'The masterpiece', text: `Now the fire: twenty coal, and three silver bars to finish it. Then it's yours: you've earned it.`,
      goals: [{ t: 'bring', key: 'coal', n: 20 }, { t: 'bring', key: 'silver_bar', n: 3 }],
      reward: { coins: 50, xp: 400, items: [[f.role === 'gunsmith' ? 'MagicBullet' : 'BattleAxe', 1]] }, said: 'There. My life\'s work. Take it, use it well.',
    },
  ],
  history: (s, f, t, gen) => {
    const towns = [];
    for (let d = 1; d <= 6 && towns.length < 3; d++) for (const dir of [-1, 1]) { const o = gen.townIn(t.k + dir * d); if (o && towns.length < 3) towns.push(o); }
    if (!towns.length) return null;
    return towns.map((o, i) => ({
      title: `The history: ${o.name}`, text: `Go to ${o.name} and ask their oldest folk about how it began. ${i === towns.length - 1 ? 'That will finish my book.' : 'Then come back to me.'}`,
      goals: [{ t: 'visit', k: o.k, name: o.name, x: Math.round((o.x0 + o.x1) / 2), y: o.level - 1, done: false }],
      reward: { coins: 40 + i * 30, xp: 150 + i * 80, items: i === towns.length - 1 ? [['greater_potion', 2]] : [] },
      said: i === towns.length - 1 ? 'My book is finished. Your name is in it, you know.' : `${o.name}, founded by miners... Write that down. Next!`,
    }));
  },
  herbs: () => [
    { title: 'Glowing caps', text: 'The glowing mushrooms in the caves: bring me twelve.', goals: [{ t: 'bring', key: 'mushroom', n: 12 }], reward: { coins: 40, xp: 120, items: [['healing_potion', 1]] }, said: 'Good, good. Now the hard part.' },
    { title: 'Crystal dust', text: 'Crystal ore, ground fine, holds the cure. Bring me six.', goals: [{ t: 'bring', key: 'crystal_ore', n: 6 }], reward: { coins: 60, xp: 200 }, said: 'Nearly there.' },
    { title: 'The cure', text: 'And an emerald, to bind it. Then no one dies of the winter sickness again.', goals: [{ t: 'bring', key: 'emerald', n: 1 }], reward: { coins: 100, xp: 350, items: [['greater_potion', 3]] }, said: 'The cure. After all these years. Take these: you\'ll need them more than anyone.' },
  ],
  fortune: () => [
    { title: 'A good investment', text: 'Bring me twenty iron ore. I have a buyer, and you\'ll have a cut.', goals: [{ t: 'bring', key: 'iron_ore', n: 20 }], reward: { coins: 60, xp: 100 }, said: 'Sold already. You\'ve a head for business.' },
    { title: 'Silver lining', text: 'Now silver: ten bars.', goals: [{ t: 'bring', key: 'silver_bar', n: 10 }], reward: { coins: 120, xp: 180 }, said: 'The city merchants will pay double for this.' },
    { title: 'The big deal', text: 'One last thing: a diamond. Then I can buy that place in the city.', goals: [{ t: 'bring', key: 'diamond', n: 1 }], reward: { coins: 400, xp: 400 }, said: 'I\'m going to the city! And you, my friend, are rich too.' },
  ],
};

export { ROLES };
