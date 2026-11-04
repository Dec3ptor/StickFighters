// Quests (world mode). Townsfolk have work for whoever asks (talk.js: "Any work?"): each offers
// a couple of quests at a time, by the work they do, changing every couple of days. Twenty kinds
// of quest, each with its own words, things and numbers, given by every townsperson in every town,
// make thousands of different ones: cull the monsters, clear a cave, hunt down a named monster,
// bring ore, gems, food, wood, herbs or goods from another land, make something, dig yourself,
// carry a parcel or a letter to someone in another town, go and see a town, ask someone something,
// dig down to a depth, find something lost underground, an old miner's journal...
//
// A quest has goals (kill, bring, mine, craft, deliver, visit, talk, depth, find, hunt, clear),
// kept up to date as things happen (questEvent: kills, mining, crafting, talking; and every half
// second, where you are). When they're all met, go back to whoever gave it (a delivery: to whoever
// it's for) and hand it in, for coins, experience and sometimes something more.
//
// Quests are kept with each player's things; where you're going for a goal (a cave, a town, a
// chest) shows on the HUD (worldhud.js), and the journal lists them all (questui.js).

import * as K from './blocks.js';
import { TILE, AIR, SOLID } from './blocks.js';
import { itemOf } from './items.js';
import { hash3 } from './noise.js';
import { dayOf, MONSTERS, isMonster, spawnMonster } from './monsters.js';
import { valueOf } from './trade.js';
import { folkOf, ROLES } from './townsfolk.js';
import { giveXp, progOf, countStat, KILL_XP } from './progress.js';
import { WORLD_H } from './worldgen.js';
import { storyStep, STORY_STEPS } from './story.js';
import { missionStep } from './stories.js';
import { gearReward, rollReward } from './gear.js';
import { asleepAny } from './sleepers.js';

/** The most quests a player can have at once. */
export const MAX_QUESTS = 12;
/** How many days a townsperson's quests stay the same. */
const PERIOD = 2;
/** Quests done, remembered (so they aren't offered again): the latest so many. */
const MAX_DONE = 3000;

// ---- Words -----------------------------------------------------------------------------------------------

const MONSTER_WORDS = { zombie: ['zombie', 'zombies'], skeleton: ['skeleton', 'skeletons'], brute: ['brute', 'brutes'] };
const DIRS = x => (x < 0 ? 'west' : 'east');
const plural = (n, one, many) => (n === 1 ? one : many);
const itemName = (key, n = 1) => {
  const name = itemOf(key)?.name ?? key;
  return n === 1 ? name : name.endsWith('s') || /bread|wood|coal|glass|stew|wheat|sand|snow|mud|clay|ice|planks|bricks/.test(name.toLowerCase()) ? name : `${name}s`;
};
const CHAMP_FIRST = ['Gorrak', "Mal'gash", 'Skarn', 'Vexa', 'Durgo', 'Krell', 'Hask', 'Zorbin', 'Mugrot', 'Ulgra', 'Thrask', 'Grimm', 'Bolg', 'Raska'];
const CHAMP_LAST = ['the Hungry', 'the Cruel', 'Ironjaw', 'the Hollow', 'Bonegrinder', 'the Red', 'of the Deep', 'Skullsplitter', 'the Old', 'Blackclaw', 'the Restless'];
const LOST = [
  ['locket', 'my grandmother\'s locket'], ['ring', 'my wedding ring'], ['satchel', 'my satchel'], ['tools', 'my bag of tools'],
  ['map_scrap', 'a piece of my old map'], ['idol', 'the shrine\'s stone idol'], ['relic', 'the family relic'],
];

/** A number from a text (a townsperson's key), the same every time. */
function keyHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h | 0;
}

/** A random number source from a seed (the same quest from the same seed, every time). */
function rngOf(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = list => list[Math.floor(r() * list.length)];
  return r;
}

// ---- Places for quests: other towns and their people, spots underground ---------------------------------------

/** The towns within `reach` regions of town t, either way (not t): [{ town, dir }]. */
function townsAround(gen, t, reach = 4) {
  const out = [];
  for (let d = 1; d <= reach; d++) for (const dir of [-1, 1]) { const o = gen.townIn(t.k + dir * d); if (o) out.push(o); }
  return out;
}

/**
 * A spot underground near column x (within `far` blocks either way, `d0`-`d1` below the surface)
 * with room to stand in a cave, for something to be found or fought there (r: the quest's random
 * numbers). Returns { x, y } (a tile: where feet would be), or a spot to dig a little room at.
 */
function spotBelow(world, x, r, far = [30, 100], depth = [15, 70]) {
  const gen = world.gen;
  for (let tries = 0; tries < 30; tries++) {
    const tx = Math.round(x + (r() < 0.5 ? -1 : 1) * r.int(far[0], far[1]));
    if (gen.townNear(tx, 4)) continue;
    const surf = gen.surfaceAt(tx), ty = Math.min(WORLD_H - 12, surf + r.int(depth[0], depth[1]));
    return { x: tx, y: ty };
  }
  return { x: Math.round(x + far[1]), y: gen.surfaceAt(Math.round(x + far[1])) + depth[0] };
}

/** A little room dug at (x, y) (feet's tile), with a chest in it holding `key` (once: it's in the world now). */
function placeChest(world, at, key) {
  for (let y = at.y - 2; y <= at.y; y++) for (let x = at.x - 2; x <= at.x + 2; x++) world.setTile(x, y, AIR);
  for (let x = at.x - 2; x <= at.x + 2; x++) if (!SOLID[world.tile(x, at.y + 1)]) world.setTile(x, at.y + 1, K.STONE);
  world.setTile(at.x + 1, at.y, K.TORCH);
  world.setTile(at.x, at.y, K.CHEST);
  hooks.chestAt?.(world, at.x, at.y)?.add(key, 1);
}

// ---- The quests -------------------------------------------------------------------------------------------

/** Average coins a monster drops. */
const coinsOf = type => (MONSTERS[type].coins[0] + MONSTERS[type].coins[1]) / 2;
/** The monster a quest for a player at `level` is about (deeper ones as they get on). */
function monsterFor(r, level, under = false) {
  if (level >= 8 && r() < 0.3) return 'brute';
  if (under || level >= 4) return r() < 0.75 ? 'skeleton' : 'zombie';
  return r() < 0.6 ? 'zombie' : 'skeleton';
}
const scale = level => 1 + (level - 1) * 0.06;

/**
 * Each kind of quest: (c) => { title, text, goals, reward, turnIn? } or null (when it can't be:
 * no other town near, say). c: { r (random numbers), f (the giver: townsfolk.js), t (their town),
 * world, level (the player's), id }.
 */
const KINDS = {
  cull(c) {
    const { r, f, t, level } = c, m = monsterFor(r, level), [one, many] = MONSTER_WORDS[m];
    const n = m === 'brute' ? r.int(1, 2 + (level >= 12 ? 1 : 0)) : m === 'skeleton' ? r.int(5, 10) : r.int(6, 14);
    const lines = {
      zombie: [`The dead come up every night, and there's only so many of us. Put down ${n} ${many} and you'll be paid.`, `Zombies at the windows again last night. Kill ${n} of them, would you?`, `${t.name} can't sleep for the groaning. ${n} ${many}, and we'll call it quits.`],
      skeleton: [`Skeletons in the tunnels under ${t.name}, with guns, if you'll believe it. Clear out ${n}.`, `The miners won't go down while the bones walk. Break ${n} ${many} for us.`],
      brute: [`There's ${n === 1 ? 'a brute' : `${n} brutes`} down in the deep, and it's getting bolder. Kill ${n === 1 ? 'it' : 'them'}.`, `Brutes. Big, red, angry. We need ${n} of them gone.`],
    }[m];
    return {
      title: r.pick({ zombie: ['Cull the dead', 'Night watch', 'Too many zombies', 'The groaning'], skeleton: ['Bones below', 'Rattling in the dark', 'Clear the tunnels'], brute: ['The brute problem', 'Big red trouble'] }[m]),
      text: r.pick(lines), goals: [{ t: 'kill', what: m, n, have: 0 }],
      reward: { coins: Math.round((n * coinsOf(m) * 1.6 + 12) * scale(level)), xp: Math.round(n * KILL_XP[m] * 1.6 + 25) },
    };
  },
  clear(c) {
    const { r, t, world, level } = c, mid = (t.x0 + t.x1) / 2, at = spotBelow(world, mid, r, [40, 120], [25, 90]);
    const n = r.int(4, 8) + Math.floor(level / 4);
    const dir = DIRS(at.x - mid);
    return {
      title: r.pick(['Clear the cave', 'Something in the dark', 'The cave to the ' + dir]),
      text: r.pick([`There's a cave ${Math.abs(at.x - Math.round(mid))} blocks ${dir} of here, ${at.y - world.gen.surfaceAt(at.x)} down, full of things that shouldn't be. Kill ${n} of them there.`, `Miners found a cave ${dir} of town and ran. Go down there and kill ${n} of whatever's in it.`]),
      goals: [{ t: 'clear', at, r: 26, n, have: 0 }],
      reward: { coins: Math.round((n * 9 + 20) * scale(level)), xp: Math.round(n * 22 + 40) },
    };
  },
  hunt(c) {
    const { r, t, world, level } = c, mid = (t.x0 + t.x1) / 2;
    const at = spotBelow(world, mid, r, [60, 160], level >= 6 ? [80, 180] : [30, 90]);
    const type = level >= 6 ? 'brute' : 'skeleton', name = `${r.pick(CHAMP_FIRST)} ${r.pick(CHAMP_LAST)}`;
    const dir = DIRS(at.x - mid), dist = Math.abs(at.x - Math.round(mid)), down = at.y - world.gen.surfaceAt(at.x);
    return {
      title: `Bounty: ${name}`,
      text: r.pick([`A ${type} they call ${name} has its lair ${dist} blocks ${dir}, ${down} down. It's killed three of ours. Kill it.`, `There's a price on ${name}'s head: a ${type}, bigger and meaner than most, ${dist} blocks ${dir} and ${down} down. Bring it down.`]),
      goals: [{ t: 'hunt', what: type, name, at, done: false }],
      reward: { coins: Math.round((type === 'brute' ? 140 : 60) * scale(level)), xp: type === 'brute' ? 320 : 160, items: [[r.pick(type === 'brute' ? ['ruby', 'sapphire', 'greater_potion'] : ['healing_potion', 'amethyst', 'topaz']), 1]] },
    };
  },
  ore(c) {
    const { r, f, level } = c;
    const opts = [['copper_ore', 12, 30], ['iron_ore', 10, 25], ['coal', 15, 40], ['copper_bar', 4, 10], ['iron_bar', 4, 10]];
    if (level >= 3) opts.push(['silver_ore', 8, 20], ['silver_bar', 3, 8]);
    if (level >= 5) opts.push(['gold_ore', 6, 15], ['gold_bar', 3, 8]);
    if (level >= 9) opts.push(['crystal_ore', 4, 10]);
    const [key, lo, hi] = r.pick(opts), n = r.int(lo, hi), v = valueOf(key) * n;
    const what = itemName(key, n);
    return {
      title: r.pick([`${itemName(key, 2)} for the forge`, `Short of ${what.toLowerCase()}`, `A load of ${what.toLowerCase()}`]),
      text: r.pick([`I'm out of ${what.toLowerCase()}, and the orders keep coming. Bring me ${n}.`, `${n} ${what.toLowerCase()}. That's what I need, and I'll pay better than the market.`, `If you're going down the mines, bring me back ${n} ${what.toLowerCase()}.`]),
      goals: [{ t: 'bring', key, n }],
      reward: { coins: Math.round(v * 1.8 + 8), xp: Math.round(20 + v * 1.2) },
    };
  },
  mine(c) {
    const { r, level } = c;
    const opts = [['copper_ore', 10, 20], ['iron_ore', 8, 16], ['coal', 12, 24]];
    if (level >= 3) opts.push(['silver_ore', 6, 12]);
    if (level >= 5) opts.push(['gold_ore', 5, 10]);
    if (level >= 8) opts.push(['crystal_ore', 3, 6]);
    const [key, lo, hi] = r.pick(opts), n = r.int(lo, hi), what = itemName(key, n).toLowerCase();
    return {
      title: r.pick(['Dig it yourself', 'A miner\'s work', 'Into the seam']),
      text: r.pick([`Anyone can buy ore. I want to know you can dig it. Mine ${n} ${what} yourself, and come back.`, `Show me you know a seam when you see one: mine ${n} ${what} with your own pick.`]),
      goals: [{ t: 'mine', key, n, have: 0 }],
      reward: { coins: Math.round(valueOf(key) * n * 1.4 + 10), xp: Math.round(30 + valueOf(key) * n * 2) },
    };
  },
  gems(c) {
    const { r, level } = c;
    const opts = [['amethyst', 1, 3], ['topaz', 1, 2]];
    if (level >= 6) opts.push(['emerald', 1, 2], ['sapphire', 1, 2]);
    if (level >= 9) opts.push(['ruby', 1, 2]);
    if (level >= 12) opts.push(['diamond', 1, 1]);
    const [key, lo, hi] = r.pick(opts), n = r.int(lo, hi), what = itemName(key, n).toLowerCase();
    return {
      title: r.pick([`${itemName(key)} wanted`, 'Something that sparkles', 'A buyer for gems']),
      text: r.pick([`I've a buyer for ${what}, and nothing to sell them. Find me ${n}.`, `${n} ${what}. Deep down, they say, where the stone glitters. I'll make it worth your while.`]),
      goals: [{ t: 'bring', key, n }],
      reward: { coins: Math.round(valueOf(key) * n * 1.5), xp: Math.round(40 + valueOf(key) * n) },
    };
  },
  commission(c) {
    const { r, f, level } = c;
    const opts = f.role === 'gunsmith'
      ? [['bullets', 60, 120], ['shells', 20, 40], ['HEGrenade', 2, 4], ['Beretta', 1, 1], ['Shotgun', 1, 1]].concat(level >= 6 ? [['M4', 1, 1], ['rockets', 6, 12]] : [])
      : [['iron_pickaxe', 1, 1], ['axe', 1, 1], ['lantern', 3, 6], ['Knife', 1, 1], ['metal', 6, 12], ['hammer', 1, 1]].concat(level >= 6 ? [['gold_pickaxe', 1, 1], ['BattleAxe', 1, 1]] : []);
    const [key, lo, hi] = r.pick(opts), n = r.int(lo, hi), what = n === 1 ? `a ${itemName(key).toLowerCase()}` : `${n} ${itemName(key, n).toLowerCase()}`;
    return {
      title: r.pick(['A commission', 'Too much work', `Wanted: ${itemName(key, n).toLowerCase()}`]),
      text: r.pick([`I've more orders than hands. Make me ${what}, and you'll have a share of the price.`, `Someone's ordered ${what}, and I haven't the time. Make it, bring it here.`]),
      goals: [{ t: 'bring', key, n }],
      reward: { coins: Math.round(valueOf(key) * n * 1.5 + 10), xp: Math.round(30 + valueOf(key) * n * 0.8) },
    };
  },
  powder(c) {
    const { r } = c, coal = r.int(20, 40), copper = r.int(3, 6);
    return {
      title: 'Powder and brass',
      text: `Bullets don't make themselves. Bring me ${coal} coal and ${copper} copper bars.`,
      goals: [{ t: 'bring', key: 'coal', n: coal }, { t: 'bring', key: 'copper_bar', n: copper }],
      reward: { coins: Math.round((coal * valueOf('coal') + copper * valueOf('copper_bar')) * 1.8 + 10), xp: 60, items: [['bullets', 60]] },
    };
  },
  deliver(c) {
    const { r, f, t, world } = c, gen = world.gen, others = townsAround(gen, t, 4);
    if (!others.length) return null;
    const o = r.pick(others), people = folkOf(gen.seed, o);
    const same = people.filter(p => p.role === f.role), to = r.pick(same.length ? same : people);
    if (!to) return null;
    const what = r.pick(f.role === 'lord' || f.role === 'elder' || f.role === 'guard' ? ['letter'] : ['parcel', 'letter']);
    const dist = Math.round(Math.abs((o.x0 + o.x1) / 2 - (t.x0 + t.x1) / 2) / 10) * 10, dir = DIRS((o.x0 + o.x1) / 2 - (t.x0 + t.x1) / 2);
    return {
      title: what === 'letter' ? `A letter for ${to.name}` : `A parcel for ${o.name}`,
      text: r.pick([
        `Take this ${what} to ${to.name}, the ${to.title.toLowerCase()} in ${o.name}. It's about ${dist} blocks ${dir}. They'll pay you when it's there.`,
        `${to.name} in ${o.name} has been waiting for this ${what}. ${o.name}'s ${dist} blocks ${dir}: you can't miss it.`,
      ]),
      goals: [{ t: 'deliver', key: what, to: { key: to.key, name: to.name, title: to.title, town: o.name, k: o.k, x: to.at.x, y: to.at.y }, done: false }],
      reward: { coins: Math.round(15 + dist / 12), xp: Math.round(30 + dist / 8) },
      turnIn: to.key, gives: [[what, 1]],
    };
  },
  visit(c) {
    const { r, t, world } = c, others = townsAround(world.gen, t, 5);
    if (!others.length) return null;
    const o = r.pick(others), dist = Math.round(Math.abs((o.x0 + o.x1) / 2 - (t.x0 + t.x1) / 2) / 10) * 10, dir = DIRS((o.x0 + o.x1) / 2 - (t.x0 + t.x1) / 2);
    return {
      title: `The road to ${o.name}`,
      text: r.pick([`I've not been past the edge of ${t.name} in forty years. Go to ${o.name}, ${dist} blocks ${dir}, and come back and tell me what it's like.`, `You should see ${o.name}: a ${o.kind}, ${dist} blocks ${dir}. Go, and come back to tell me of it.`]),
      goals: [{ t: 'visit', k: o.k, name: o.name, x: Math.round((o.x0 + o.x1) / 2), y: o.level - 1, done: false }],
      reward: { coins: Math.round(10 + dist / 20), xp: Math.round(40 + dist / 6) },
    };
  },
  talk(c) {
    const { r, f, t, world } = c, others = townsAround(world.gen, t, 3);
    if (!others.length) return null;
    const o = r.pick(others), people = folkOf(world.gen.seed, o), to = r.pick(people.filter(p => ['elder', 'lord', 'healer', 'trader', 'smith'].includes(p.role)).concat(people).slice(0, 6));
    if (!to) return null;
    const topic = r.pick(['the old roads', 'the tremors in the deep', 'what happened to the last caravan', 'a debt they owe me', 'their grandmother\'s recipe', 'the lights under the hills']);
    return {
      title: `A word with ${to.name}`,
      text: `Go to ${o.name} and ask ${to.name}, the ${to.title.toLowerCase()}, about ${topic}. Then come back and tell me what they say.`,
      goals: [{ t: 'talk', to: { key: to.key, name: to.name, title: to.title, town: o.name, k: o.k, x: to.at.x, y: to.at.y }, done: false }],
      reward: { coins: 25, xp: 70 },
    };
  },
  depth(c) {
    const { r, level } = c, n = r.pick(level >= 10 ? [250, 300, 350] : level >= 5 ? [120, 160, 200] : [40, 60, 90]);
    return {
      title: r.pick(['How deep does it go?', 'Down and down', 'The bottom of things']),
      text: r.pick([`Nobody's been ${n} blocks down and come back to tell of it. You could be the first.`, `They say the deep gets hot, and strange. Go ${n} blocks down, and come back.`]),
      goals: [{ t: 'depth', n, done: false }],
      reward: { coins: Math.round(n / 3), xp: Math.round(30 + n * 0.8) },
    };
  },
  find(c) {
    const { r, f, t, world } = c, mid = (t.x0 + t.x1) / 2, at = spotBelow(world, mid, r, [30, 90], [15, 60]);
    const [key, words] = r.pick(LOST), dir = DIRS(at.x - mid), dist = Math.abs(at.x - Math.round(mid)), down = at.y - world.gen.surfaceAt(at.x);
    return {
      title: r.pick([`Lost: ${words.replace(/^my |^the |^a /, '')}`, 'Down a hole', 'Something lost']),
      text: r.pick([`I lost ${words} down a hole ${dir} of town. About ${dist} blocks ${dir}, ${down} down, in an old chest. Please, find it.`, `${words[0].toUpperCase()}${words.slice(1)}: I hid it in a chest underground when the monsters came, ${dist} blocks ${dir} and ${down} down. I daren't go back.`]),
      goals: [{ t: 'find', key, at }],
      reward: { coins: Math.round(20 + dist / 6 + down / 3), xp: Math.round(50 + dist / 4 + down), items: r() < 0.4 ? [['healing_potion', 1]] : [] },
      place: { at, key },
    };
  },
  lore(c) {
    const { r, t, world } = c, mid = (t.x0 + t.x1) / 2, at = spotBelow(world, mid, r, [60, 180], [70, 160]);
    const dir = DIRS(at.x - mid), dist = Math.abs(at.x - Math.round(mid)), down = at.y - world.gen.surfaceAt(at.x);
    return {
      title: 'The old miner\'s journal',
      text: `An old miner went down ${dist} blocks ${dir} of here and never came up. ${down} blocks down, they say. Find his journal: I'd like to know what he saw.`,
      goals: [{ t: 'find', key: 'journal', at }],
      reward: { coins: 60, xp: 180, items: [[r.pick(['amethyst', 'topaz', 'healing_potion']), 1]] },
      place: { at, key: 'journal' },
    };
  },
  tribute(c) {
    const { r, level } = c, key = level >= 5 && r() < 0.6 ? 'gold_bar' : 'silver_bar', n = r.int(3, 8);
    return {
      title: 'Tribute',
      text: `${t0(c)} needs ${n} ${itemName(key, n).toLowerCase()} for the treasury. Bring them, and the city won't forget it.`,
      goals: [{ t: 'bring', key, n }],
      reward: { coins: Math.round(valueOf(key) * n * 1.7 + 20), xp: Math.round(60 + valueOf(key) * n), items: [['greater_potion', 1]] },
    };
  },
  exotic(c) {
    const { r, t } = c;
    const opts = [['snow', 'snow', 20, 40], ['ice', 'snow', 8, 16], ['sand', 'desert', 20, 40], ['cactus', 'desert', 4, 8], ['mud', 'jungle', 15, 30], ['clay', 'badlands', 12, 24], ['red_sand', 'badlands', 15, 30]].filter(o => o[1] !== t.biome);
    const [key, biome, lo, hi] = r.pick(opts), n = r.int(lo, hi), what = itemName(key, n).toLowerCase();
    const place = { snow: 'the snow', desert: 'the desert', jungle: 'the jungle', badlands: 'the badlands' }[biome];
    return {
      title: r.pick(['Goods from far off', `Something from ${place}`]),
      text: `Folk here will pay good money for ${what} from ${place}. Bring me ${n}.`,
      goals: [{ t: 'bring', key, n }],
      reward: { coins: Math.round(30 + n * 1.5), xp: 80 },
    };
  },
  food(c) {
    const { r, f } = c;
    const [key, lo, hi] = r.pick([['bread', 5, 10], ['apple', 4, 8], ['stew', 3, 6], ['wheat', 15, 30]]), n = r.int(lo, hi), what = itemName(key, n).toLowerCase();
    return {
      title: r.pick(['Empty larder', 'Hungry mouths', 'Stock the cellar']),
      text: r.pick([`We're short of food. Bring me ${n} ${what}.`, `${n} ${what}, if you can. There's a lot of mouths to feed.`]),
      goals: [{ t: 'bring', key, n }],
      reward: { coins: Math.round(valueOf(key) * n * 2 + 10), xp: Math.round(25 + n * 3), items: f.role === 'innkeeper' ? [['stew', 2]] : [] },
    };
  },
  firewood(c) {
    const { r } = c, key = r() < 0.7 ? 'wood' : 'planks', n = key === 'wood' ? r.int(20, 50) : r.int(40, 99);
    return {
      title: r.pick(['Firewood', 'Cold nights', 'Timber!']),
      text: r.pick([`The nights are cold and the woodpile's low. Bring me ${n} ${key}.`, `I need ${n} ${key} before the winter. My back's not what it was.`]),
      goals: [{ t: 'bring', key, n }],
      reward: { coins: Math.round(valueOf(key) * n * 2.5 + 8), xp: Math.round(20 + n * 0.6) },
    };
  },
  herbs(c) {
    const { r } = c, key = r() < 0.75 ? 'mushroom' : 'cactus', n = key === 'mushroom' ? r.int(6, 15) : r.int(3, 6);
    return {
      title: r.pick(['Herbs for the sick', 'What grows in the dark']),
      text: key === 'mushroom' ? `The glowing mushrooms in the caves make good medicine. Bring me ${n}.` : `Cactus flesh soothes burns. Bring me ${n} cactus.`,
      goals: [{ t: 'bring', key, n }],
      reward: { coins: Math.round(10 + n * 3), xp: Math.round(30 + n * 4), items: [['healing_potion', 1]] },
    };
  },
  supply(c) {
    const { r } = c;
    const [key, lo, hi] = r.pick([['torch', 20, 40], ['glass', 15, 30], ['stone_bricks', 20, 40], ['bricks', 15, 30], ['planks', 40, 99], ['ladder', 10, 20]]);
    const n = r.int(lo, hi), what = itemName(key, n).toLowerCase();
    return {
      title: r.pick(['Restocking', 'Supplies', 'A big order']),
      text: `I've sold out of ${what}. Bring me ${n} and I'll pay more than I sell them for. Just this once.`,
      goals: [{ t: 'bring', key, n }],
      reward: { coins: Math.round(valueOf(key) * n * 2 + 10), xp: Math.round(25 + valueOf(key) * n) },
    };
  },
};
const t0 = c => (c.f.title === 'Lady' ? 'The lady' : c.f.role === 'lord' ? 'The lord' : c.t.name);

/** Which kinds of quest each kind of townsperson gives. */
const BY_ROLE = {
  guard: ['cull', 'cull', 'clear', 'hunt', 'deliver'],
  lord: ['hunt', 'tribute', 'deliver', 'cull', 'clear'],
  smith: ['ore', 'ore', 'commission', 'mine', 'depth'],
  gunsmith: ['ore', 'commission', 'powder', 'cull'],
  merchant: ['deliver', 'exotic', 'supply', 'find'],
  trader: ['gems', 'exotic', 'deliver', 'mine'],
  innkeeper: ['food', 'firewood', 'deliver', 'find'],
  healer: ['herbs', 'gems', 'find', 'deliver'],
  elder: ['visit', 'depth', 'talk', 'find', 'lore'],
  farmer: ['cull', 'food', 'firewood', 'find'],
  villager: ['find', 'deliver', 'firewood', 'cull', 'visit', 'food'],
};
export const QUEST_KINDS = Object.keys(KINDS);

/**
 * The quest townsperson f (in town t) offers in slot i of `period`, for a player at `level` (or
 * null). kind: one of QUEST_KINDS instead of the one their work picks (for tests).
 */
export function makeQuest(world, f, t, period, i, level = 1, only = null) {
  const seed = world.gen.seed, r = rngOf(hash3(seed, keyHash(f.key), period * 131 + i * 17 + 3));
  const kinds = BY_ROLE[f.role] || BY_ROLE.villager;
  const pick = kinds[Math.floor(r() * kinds.length)], kind = only || pick;
  // (Level bands: what a quest asks for goes by the player's level, in steps, so it's the same quest at nearby levels.)
  const band = Math.max(1, Math.floor((level - 1) / 3) * 3 + 1);
  const q = KINDS[kind]({ r, f, t, world, level: band, id: null });
  if (!q) return null;
  // (Now and then, a piece of gear too: a hunt always. What they deal in, if they deal in it: gear.js.)
  const x = r(), y = r();
  if (kind === 'hunt' || x < 0.22) q.reward = { ...q.reward, gear: gearReward(f.role, kind === 'hunt' ? (x < 0.4 ? 'rare' : 'magic') : x < 0.04 ? 'rare' : 'magic', y, band + 3) };
  return {
    id: `f:${f.key}:${period}:${i}`, kind: 'side', tpl: kind, band, ...q,
    giver: { key: f.key, name: f.name, title: f.title, town: t.name, k: t.k, x: f.at.x, y: f.at.y },
    turnIn: q.turnIn || f.key, ready: false,
  };
}

// ---- A player's quests -------------------------------------------------------------------------------------

/** Player s's quests: { list (active), done (ids), track (the one on the HUD) }. */
export function questsOf(s) {
  const w = s.world;
  return (w.quests ||= { list: [], done: new Set(), track: null, v: 0 });
}

/** The period (of days) it is now, for quest offers. */
export const periodOf = world => Math.floor((dayOf(world.time || 0) - 1) / PERIOD);

/** The step of the story (story.js) player s is on (STORY_STEPS: it's all done). */
export function storyAt(s) {
  const qs = questsOf(s);
  let n = 0;
  while (n < STORY_STEPS && qs.done.has(`s:${n}`)) n++;
  return n;
}

/**
 * A story step's or a mission step's quest (story.js, stories.js), from townsperson f of town t,
 * as quests are. (Handed in to someone else: handTo says who, and where.)
 */
function wrapStep(gen, st, id, kind, f, t) {
  const { giver, town, turnIn: to, steps, want, ...rest } = st;
  const key = typeof to === 'string' ? to : to?.key || f.key;
  let handTo = null;
  if (key !== f.key) {
    const goalTo = st.goals.find(g => g.to?.key === key)?.to;
    if (goalTo) handTo = { name: goalTo.name, town: goalTo.town, x: goalTo.x, y: goalTo.y };
    else if (to && typeof to === 'object') handTo = { name: to.name, town: gen.townIn(to.k)?.name ?? '', x: to.at.x, y: to.at.y };
  }
  return {
    id, kind, tpl: kind, ...rest,
    giver: { key: f.key, name: f.name, title: f.title, town: t.name, k: t.k, x: f.at.x, y: f.at.y },
    turnIn: key, handTo, ready: false,
  };
}

/** The story's next step, if townsperson f is the one to give it to player s. */
function storyOffer(game, s, f, t) {
  const n = storyAt(s), qs = questsOf(s), id = `s:${n}`;
  if (n >= STORY_STEPS || qs.list.some(q => q.id === id)) return null;
  const st = storyStep(game.world.gen, n, progOf(s).level);
  if (!st || st.giver.key !== f.key) return null;
  // (Every step of the story gives a piece of gear, better the further it goes.)
  const q = { ...wrapStep(game.world.gen, st, id, 'story', f, t), step: n };
  q.reward = { ...q.reward, gear: gearReward(f.role, n >= STORY_STEPS - 2 ? 'legendary' : n >= 8 ? 'epic' : n >= 4 ? 'rare' : 'magic', (n * 0.37) % 1, 4 + n * 2) };
  return q;
}

/** The next step of townsperson f's own mission (stories.js) for player s, if there is one and it's not under way. */
function missionOffer(game, s, f, t) {
  const qs = questsOf(s);
  for (let step = 0; step < 3; step++) {
    const id = `p:${f.key}:${step}`;
    if (qs.done.has(id)) continue;
    if (qs.list.some(q => q.id === id)) return null;
    const st = missionStep(game.world.gen, f, t, step, progOf(s).level);
    if (!st) return null;
    const q = { ...wrapStep(game.world.gen, st, id, 'personal', f, t), chain: { key: f.key, k: t.k, step }, steps: st.steps };
    // (The end of their mission: a rare piece of gear, what they'd know about.)
    if (step === (st.steps || 3) - 1) q.reward = { ...q.reward, gear: gearReward(f.role, 'rare', (keyHash(f.key) >>> 4) % 97 / 97, progOf(s).level + 4) };
    return q;
  }
  return null;
}

/**
 * The quests townsperson f (of town t) has for player s now (not taken, not done): the story's
 * next step if it's theirs to give, their own mission's next step, and their work.
 */
export function offersFor(game, s, f, t) {
  const world = game.world, qs = questsOf(s), level = progOf(s).level, period = periodOf(world), out = [];
  const story = storyOffer(game, s, f, t), own = missionOffer(game, s, f, t);
  if (story) out.push(story);
  if (own) out.push(own);
  for (let i = 0; i < 2; i++) {
    const q = makeQuest(world, f, t, period, i, level);
    if (!q || qs.done.has(q.id) || qs.list.some(x => x.id === q.id)) continue;
    out.push(q);
  }
  return out;
}

/** Whether a goal's met (for player s: what they carry, for bring and find). */
export function goalMet(s, g) {
  const inv = s.world.inv;
  switch (g.t) {
    case 'kill': case 'mine': case 'craft': case 'clear': return g.have >= g.n;
    case 'bring': return inv.count(g.key) >= g.n;
    case 'find': return inv.count(g.key) >= 1;
    default: return !!g.done;
  }
}

/** Whether all a quest's goals are met. */
export const questReady = (s, q) => q.goals.every(g => goalMet(s, g));

/** What a goal says, as the journal and the HUD have it ('Kill zombies: 3 / 10'). */
export function goalText(s, g) {
  const inv = s.world?.inv;
  switch (g.t) {
    case 'kill': return `Kill ${MONSTER_WORDS[g.what]?.[1] ?? g.what}: ${Math.min(g.have, g.n)} / ${g.n}`;
    case 'clear': return `Kill monsters in the cave: ${Math.min(g.have, g.n)} / ${g.n}`;
    case 'hunt': return g.done ? `${g.name}: dead` : `Kill ${g.name}`;
    case 'bring': return `${itemOf(g.key)?.name ?? g.key}: ${Math.min(inv?.count(g.key) ?? 0, g.n)} / ${g.n}`;
    case 'mine': return `Mine ${itemOf(g.key)?.name.toLowerCase() ?? g.key}: ${Math.min(g.have, g.n)} / ${g.n}`;
    case 'craft': return `Make ${itemOf(g.key)?.name.toLowerCase() ?? g.key}: ${Math.min(g.have, g.n)} / ${g.n}`;
    case 'deliver': return g.done ? `Delivered to ${g.to.name}` : `Take the ${itemOf(g.key)?.name.toLowerCase() ?? g.key} to ${g.to.name} in ${g.to.town}`;
    case 'visit': return g.done ? `Seen ${g.name}` : `Go to ${g.name}`;
    case 'talk': return g.done ? `Spoken to ${g.to.name}` : `Talk to ${g.to.name} in ${g.to.town}`;
    case 'depth': return g.done ? `Been ${g.n} blocks down` : `Go ${g.n} blocks down`;
    case 'find': return (inv?.count(g.key) ?? 0) >= 1 ? `Found the ${itemOf(g.key)?.name.toLowerCase()}` : `Find the ${itemOf(g.key)?.name.toLowerCase()} (in a chest)`;
    default: return g.t;
  }
}

/** Where a goal is (a tile { x, y }), for the HUD's pointer, or null. */
export function goalPlace(s, g) {
  if (goalMet(s, g)) return null;
  switch (g.t) {
    case 'clear': case 'hunt': case 'find': return g.at;
    case 'deliver': case 'talk': return { x: g.to.x, y: g.to.y };
    case 'visit': return { x: g.x, y: g.y };
    default: return null;
  }
}

/** Whom to go to with quest q when its goals are met (whoever gave it, or handTo): { name, town, x, y }, or null. */
export const turnInTo = q => (q.turnIn === q.giver.key ? { name: q.giver.name, town: q.giver.town, x: q.giver.x, y: q.giver.y } : q.handTo || null);

/** Player s takes on quest q (from townsperson f's offers). Returns what to tell them. */
export function acceptQuest(game, s, q) {
  const qs = questsOf(s);
  if (qs.list.length >= MAX_QUESTS) return `You've ${MAX_QUESTS} quests already. Finish some first (your journal: J).`;
  if (qs.list.some(x => x.id === q.id) || qs.done.has(q.id)) return null;
  const quest = JSON.parse(JSON.stringify(q));
  quest.taken = game.tick;
  // What it puts in your hands (a parcel, a letter), and in the world (a chest with something lost in it).
  for (const [key, n] of quest.gives || []) if (s.world.inv.room(key) < n) return 'You have no room to carry it';
  for (const [key, n] of quest.gives || []) s.world.inv.add(key, n);
  if (quest.place && !game.mirror) placeChest(game.world, quest.place.at, quest.place.key);
  qs.list.push(quest);
  qs.track = quest.id;
  qs.v++;
  game.sound('click', s.x, s.y, s.id);
  return `Quest: ${quest.title}`;
}

/** Player s gives up quest `id`. */
export function dropQuest(s, id) {
  const qs = questsOf(s), i = qs.list.findIndex(q => q.id === id);
  if (i < 0) return;
  qs.list.splice(i, 1);
  if (qs.track === id) qs.track = qs.list.at(-1)?.id ?? null;
  qs.v++;
}

/** The quests player s can hand in to townsperson `key` now. */
export const readyFor = (s, key) => questsOf(s).list.filter(q => q.turnIn === key && questReady(s, q));

/** Player s hands in quest `id` (to whoever it's handed in to): what was asked for is taken, the reward given. */
export function turnIn(game, s, id) {
  const qs = questsOf(s), q = qs.list.find(x => x.id === id);
  if (!q || !questReady(s, q)) return null;
  const inv = s.world.inv;
  for (const g of q.goals) {
    if (g.t === 'bring') inv.remove(g.key, g.n);
    if (g.t === 'find' || g.t === 'deliver') inv.remove(g.key, 1);
  }
  const rw = q.reward || {};
  if (rw.coins) { const left = inv.add('coins', rw.coins); if (left) dropAt(game, s, 'coins', left); }
  for (const [key, n] of rw.items || []) { const left = inv.add(key, n); if (left) dropAt(game, s, key, left); }
  // (A piece of gear: rolled now, for this quest and this player: gear.js.)
  const piece = rw.gear ? rollReward(rw.gear, game.world.gen.seed, q.id, s.name) : null;
  if (piece && !inv.addGear(piece.key, piece.g)) dropAt(game, s, piece.key, 1, piece.g);
  qs.list.splice(qs.list.indexOf(q), 1);
  qs.done.add(q.id);
  if (qs.done.size > MAX_DONE) qs.done.delete(qs.done.values().next().value);
  if (qs.track === q.id) qs.track = qs.list.at(-1)?.id ?? null;
  qs.v++;
  countStat(s, 'quests');
  if (q.kind === 'story') countStat(s, 'story');
  if (rw.xp) giveXp(game, s, rw.xp, q.title);
  game.sound('hallelujah', s.x, s.y, s.id);
  // (Their own mission: on to the next step, straight away.)
  if (q.chain) {
    const t = game.world.gen.townIn(q.chain.k), f = t && folkOf(game.world.gen.seed, t).find(x => x.key === q.chain.key);
    const next = f && missionOffer(game, s, f, t);
    if (next && /^Quest/.test(acceptQuest(game, s, next) || '')) game.notify(s, `Next: ${next.title}`);
  }
  const items = (rw.items || []).map(([k, n]) => `${n > 1 ? `${n} × ` : ''}${itemOf(k)?.name ?? k}`);
  if (piece) items.push(piece.g.name);
  return `Done: ${q.title}. ${[rw.coins ? `${rw.coins} coins` : '', rw.xp ? `${rw.xp} experience` : '', ...items].filter(Boolean).join(', ')}`;
}

/**
 * What quests need from the world mode (worldplay.js gives them as a world's game begins: it
 * can't be imported here, as it imports this): drop(game, key, n, x, y) puts things on the
 * ground (rewards that don't fit); chestAt(world, tx, ty) a chest's things.
 */
let hooks = {};
export function setQuestHooks(h) { hooks = h; }
const dropAt = (game, s, key, n, g = null) => hooks.drop?.(game, key, n, s.x, s.y - 14, g);
/** Things for player s that don't fit: at their feet (raids.js's thanks too). */
export const dropFor = dropAt;

// ---- Keeping quests up to date ---------------------------------------------------------------------------------

/**
 * Something happened that quests count: { type: 'kill', what (a monster type), x, y, champion } |
 * { type: 'mine', key } | { type: 'craft', key, n } | { type: 'talk', key (who) }. For player s.
 */
export function questEvent(game, s, ev) {
  const qs = s?.world?.quests;
  if (!qs?.list.length) return;
  let changed = false;
  for (const q of qs.list) {
    for (const g of q.goals) {
      if (ev.type === 'kill') {
        if (g.t === 'kill' && g.what === ev.what && g.have < g.n) { g.have++; changed = true; }
        if (g.t === 'clear' && g.have < g.n && Math.abs(ev.x / TILE - g.at.x) <= g.r && Math.abs(ev.y / TILE - g.at.y) <= g.r) { g.have++; changed = true; }
        if (g.t === 'hunt' && !g.done && ev.champion === `${q.id}#${q.goals.indexOf(g)}`) { g.done = true; changed = true; }
      } else if (ev.type === 'mine' && g.t === 'mine' && g.key === ev.key && g.have < g.n) { g.have++; changed = true; }
      else if (ev.type === 'craft' && g.t === 'craft' && g.key === ev.key && g.have < g.n) { g.have = Math.min(g.n, g.have + (ev.n || 1)); changed = true; }
      else if (ev.type === 'talk' && (g.t === 'talk' || g.t === 'deliver') && !g.done && g.to.key === ev.key) {
        if (g.t === 'deliver' && s.world.inv.count(g.key) < 1) continue;
        g.done = true;
        changed = true;
      }
    }
  }
  if (changed) {
    qs.v++;
    for (const q of qs.list) {
      if (!q.ready && questReady(s, q)) {
        q.ready = true;
        const to = turnInTo(q);
        game.notify(s, to ? `${q.title}: done. Take it to ${to.name}${to.town ? ` in ${to.town}` : ''}` : `${q.title}: done`);
        game.sound('click', s.x, s.y, s.id);
      }
    }
  }
}

/**
 * Every half second, for each player: goals met by where they are (a town seen, a depth reached),
 * named monsters to fight appearing as they come near, quests whose things are now carried
 * ready to hand in; and experience for finding a new town or biome, or going deeper than before.
 */
export function questsTick(game) {
  if (game.tick % 30 !== 7) return;
  const world = game.world, gen = world.gen;
  for (const s of game.soldiers) {
    if (!s.alive || !s.world) continue;
    const tx = Math.floor(s.x / TILE), ty = Math.floor(s.y / TILE), surf = gen.surfaceAt(tx), depth = ty - surf;
    // Exploring: experience for what's new.
    const p = progOf(s), seen = p.seen;
    const town = depth < 14 ? gen.townNear?.(tx, 2) : null;
    if (town && !seen.towns.includes(town.id)) { seen.towns.push(town.id); giveXp(game, s, 40, `found ${town.name}`); countStat(s, 'towns'); }
    const biome = gen.biomeAt(tx).key;
    if (!seen.biomes.includes(biome)) { seen.biomes.push(biome); if (seen.biomes.length > 1) giveXp(game, s, 30, `the ${gen.biomeAt(tx).name.toLowerCase()}`); }
    if (depth > seen.deepest) {
      const was = Math.floor(seen.deepest / 50), now = Math.floor(depth / 50);
      seen.deepest = depth;
      if (now > was && now > 0) giveXp(game, s, 25 * (now - was), `${now * 50} blocks down`);
    }
    markFolk(game, s);
    const qs = s.world.quests;
    if (!qs?.list.length) continue;
    let changed = false;
    for (const q of qs.list) {
      q.goals.forEach((g, gi) => {
        if (g.t === 'visit' && !g.done && town && town.k === g.k) { g.done = true; changed = true; }
        if (g.t === 'depth' && !g.done && depth >= g.n) { g.done = true; changed = true; }
        if (g.t === 'hunt' && !g.done) {
          // (A named monster: there when a player comes near its lair, gone again if they all leave.)
          // (Asleep out there, sleepers.js, it's still about: not made again.)
          const tag = `${q.id}#${gi}`, alive = game.soldiers.some(o => o.npc?.champion === tag && (o.alive || !o.npc.spawned)) || asleepAny(game.world, r => r.own?.champion === tag);
          if (!alive && Math.abs(tx - g.at.x) < 60 && Math.abs(ty - g.at.y) < 40 && !game.mirror) spawnChampion(game, g, tag);
        }
      });
      const ready = questReady(s, q);
      if (ready !== q.ready) {
        q.ready = ready;
        changed = true;
        const to = turnInTo(q);
        if (ready) game.notify(s, to ? `${q.title}: done. Take it to ${to.name}${to.town ? ` in ${to.town}` : ''}` : `${q.title}: done`);
      }
    }
    if (changed) qs.v++;
  }
}

/**
 * Which of the townsfolk near player s have something for them (w.marks: [[soldier id, '!' (work
 * to offer) or '?' (a quest to hand in)]], and w.marksKey, to tell when it's changed): the HUD
 * puts it over their heads.
 */
function markFolk(game, s) {
  const w = s.world, qs = questsOf(s), full = qs.list.length >= MAX_QUESTS, marks = [];
  for (const o of game.soldiers) {
    if (!o.alive || o.npc?.kind !== 'townsfolk' || Math.abs(o.x - s.x) > 60 * TILE || Math.abs(o.y - s.y) > 30 * TILE) continue;
    const ctl = game.controllers.get(o);
    if (!ctl?.f) continue;
    if (qs.list.some(q => q.turnIn === ctl.f.key && questReady(s, q))) marks.push([o.id, '?']);
    else if (!full) {
      const offers = offersFor(game, s, ctl.f, ctl.t);
      if (offers.length) marks.push([o.id, offers.some(q => q.kind === 'story') ? '★' : '!']);
    }
  }
  w.marks = marks;
  w.marksKey = marks.map(m => m.join('')).join();
}

/** A named monster (a quest's hunt) at its lair: stronger, slower to die, worth more. */
function spawnChampion(game, g, tag) {
  const world = game.world, at = g.at;
  // (Room for it: a little cave dug out if need be.)
  for (let y = at.y - 2; y <= at.y; y++) for (let x = at.x - 2; x <= at.x + 2; x++) if (world.tile(x, y) !== AIR) world.setTile(x, y, AIR);
  if (!SOLID[world.tile(at.x, at.y + 1)]) world.setTile(at.x, at.y + 1, K.STONE);
  const m = spawnMonster(game, g.what, at.x * TILE + TILE / 2, (at.y + 1) * TILE - 14);
  m.name = g.name;
  m.maxHealth = Math.round(MONSTERS[g.what].health * (g.hp || (g.what === 'brute' ? 3 : 4)));
  m.npc.champion = tag;
  return m;
}

// ---- Saving ----------------------------------------------------------------------------------------------------

/** A player's quests as saved. */
export function questsToSave(s) {
  const qs = s.world?.quests;
  return qs ? { list: qs.list, done: [...qs.done].slice(-MAX_DONE), track: qs.track } : null;
}

/** A player's quests from a save. */
export function questsFromSave(w, data) {
  if (!data || typeof data !== 'object') return;
  const list = Array.isArray(data.list) ? data.list.filter(q => q && typeof q.id === 'string' && Array.isArray(q.goals) && q.giver).slice(0, MAX_QUESTS) : [];
  w.quests = { list, done: new Set(Array.isArray(data.done) ? data.done.filter(x => typeof x === 'string') : []), track: typeof data.track === 'string' ? data.track : null, v: 0 };
}

export { ROLES };
