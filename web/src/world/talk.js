// Talking to townsfolk (world mode). Right click on someone (worldplay.js's interact) and they
// say something: by the work they do, the time of day and the town they live in. Then whatever
// they can do for you: trade (trade.js), heal you (a healer), a bed for the night (an innkeeper),
// a guard to come along with you (a city's barracks), and news of the world (other towns, and
// what's to be found deep down).
//
// While you talk, they stop and face you. The talk ends when you say goodbye, walk away, or one
// of you dies. What's said, and what's for sale, is worked out where the world is played (the
// host, online: worldnet.js sends it to whoever's talking) as a "view" of the talk (talkView);
// what's done in it (talkDo) is done there too.

import { TILE } from './blocks.js';
import { ROLES, isFolk, townsNear } from './townsfolk.js';
import { stockOf, buy, sell, SHOPS, priceFor } from './trade.js';
import { offersFor, acceptQuest, readyFor, turnIn, questEvent, questsOf, goalText, MAX_QUESTS } from './quests.js';
import { progOf } from './progress.js';
import { tellAbout } from './stories.js';
import { hourOf, dayOf, DAY_TICKS, hireMerc, mercsOf, MERC } from './monsters.js';
import { hash3 } from './noise.js';
import { BODY } from '../config.js';

/** How near (px, from them) a player has to be to start talking to someone, and to keep talking. */
export const TALK_REACH = 5 * TILE, TALK_KEEP = 9 * TILE;
/** What a guard costs to take along (city barracks only), what resting at an inn costs. */
const GUARD_FEE = { village: 0, city: 110, capital: 140 }, REST_FEE = { village: 6, city: 12, capital: 16 };

// ---- What they say -------------------------------------------------------------------------------------

/** What each kind of person says (one picked each day): {town}, {me} (the player's name), {time}. */
const LINES = {
  villager: [
    'Lovely {time} in {town}, isn\'t it?', 'Mind the zombies after dark. We bar our doors.', 'You\'re not from {town}, are you?',
    'If it\'s work you want, try the elder.', 'The smith\'s fire has been going since dawn.', 'Have you seen the market in the city? Gems everywhere!',
    'My cousin went digging for diamonds. Never came back up.', 'Nothing much happens in {town}. I like it that way.',
    'They say there\'s gold under the hills, if you dig deep enough.', 'Keep a torch about you. The dark has teeth.',
  ],
  farmer: [
    'The wheat\'s coming up nicely this year.', 'Crows, moles, and now zombies. Farming\'s hard work.', 'Fresh bread and apples, if you\'re hungry.',
    'Rain\'s coming. I can feel it in my knees.', 'You can bake bread from wheat, you know. Three sheaves a loaf, in a furnace.',
  ],
  elder: [
    '{town} has stood a long time, stranger. Longer than anyone remembers.', 'Sit, sit. The young never sit.',
    'There\'s more under this land than above it. Mark me.', 'I\'ve seen a hundred winters. The nights get longer, I swear it.',
    'Ask me what you will. I may even know the answer.',
  ],
  merchant: [
    'Come in, come in! Best prices in {town}.', 'Need torches? Everyone needs torches.', 'Buying and selling, friend. Whatever you\'ve got.',
    'New stock every morning!', 'I\'ll take anything off your hands. For a price, of course.',
  ],
  smith: [
    'Iron\'s what keeps the dark out.', 'Bring me ore and bars, and I\'ll pay fair for them.', 'Mind the anvil. It\'s hot.',
    'A good pickaxe is worth more than a good sword, down there.', 'Gold\'s soft. Iron\'s honest.',
  ],
  gunsmith: [
    'Looking for something with a bit more bang?', 'Don\'t point that at me.', 'Bullets, shells, the odd rocket. What\'ll it be?',
    'I get the strange ones in now and then. Ask again tomorrow.', 'Guns don\'t fix themselves. Neither do I.',
  ],
  innkeeper: [
    'A bed, a meal, a roof over your head.', 'Rough night? Sleep here, and wake up a new soldier.', 'The stew\'s good. Mostly mushrooms.',
    'Everyone passes through {town} sooner or later. And they all end up here.', 'Rest a while. The road will still be there tomorrow.',
  ],
  healer: [
    'You look hurt. Let me see.', 'Be well, traveller.', 'A potion for the road?', 'Mushrooms and prayers. That\'s all medicine is.',
    'I\'ve patched up worse than you. Not by much.',
  ],
  guard: [
    'Move along.', 'We keep the monsters out. Mostly.', 'Trouble? Not in {town}, there isn\'t.', 'Keep your nose clean, stranger.',
    'Long watch tonight.', 'Zombies don\'t open doors. Remember that.',
  ],
  lord: [
    'Welcome to {town}, traveller. My city is at peace, for now.', 'The roads are not safe these days. Not after dark.',
    'Serve {town} well, and {town} will remember it.', 'My guards are the best in the land. Most of them.',
  ],
  trader: [
    'Gems! Silver! Wonders from far-off lands!', 'I pay the best price for gems. Better than anyone.', 'I\'ve come a long way to sell these.',
    'Something rare today? Perhaps. Perhaps not.', 'Diamonds, friend. I\'d give a lot for diamonds.',
  ],
};
/** At night (the shops are still open, mind). */
const NIGHT = ['It\'s late. What do you want?', 'Couldn\'t sleep either?', 'Quick, inside, before the dark gets in.', 'Late visitors... always trouble.'];

/** What old folk (and anyone, asked for news) know about what's deep down. */
const LORE = [
  'Diamonds come from deep down, in pipes of blue-grey kimberlite. Dig deep, and keep digging.',
  'Miners talk of hollow stones lined with amethyst, deep underground. Geodes, they call them.',
  'Ore runs in veins. Find one bit of iron and there\'ll be more beside it.',
  'The deeper you go, the meaner what lives there. Brutes, down in the deep. Big, red, and they hit hard.',
  'Skeletons carry pistols underground. Don\'t ask me where they get them.',
  'Gold lies deeper than iron, and gems deeper than gold. Rubies, sapphires, emeralds, the lot.',
  'Magma burns. Obviously. People still walk into it.',
  'Monsters keep away from torchlight. Light your way, and your home.',
  'The traders at the city markets pay the best for gems and silver.',
  'Silver comes in veins, not far below the iron.',
];

const BIOME_WORDS = { plains: 'the plains', forest: 'the forest', desert: 'the desert', badlands: 'the badlands', snow: 'the snow', jungle: 'the jungle' };

/** Fill in a line's {town}, {me}, {time}. */
function fill(line, t, me, time) {
  const h = hourOf(time), when = h < 12 ? 'morning' : h < 18 ? 'afternoon' : h < 21 ? 'evening' : 'night';
  return line.replaceAll('{town}', t.name).replaceAll('{me}', me?.name || 'friend').replaceAll('{time}', when);
}

/** News of the world, from where someone lives: the next towns either way, and something about what's deep down. */
export function newsFrom(game, f, t) {
  const gen = game.world.gen, out = [];
  for (const dir of [-1, 1]) {
    for (let k = t.k + dir, n = 0; n < 10; k += dir, n++) {
      const o = gen.townIn(k);
      if (!o) continue;
      const dist = Math.round(Math.abs((o.x0 + o.x1) / 2 - (t.x0 + t.x1) / 2) / 10) * 10;
      out.push(`${o.name}, a ${o.kind} in ${BIOME_WORDS[o.biome] || 'the wilds'}, is about ${dist} blocks ${dir < 0 ? 'west' : 'east'} of here.`);
      break;
    }
  }
  const day = dayOf(game.world.time || 0), h = hash3(gen.seed, f.k * 97 + f.bi, day * 31 + 7);
  out.push(LORE[h % LORE.length]);
  if (f.role === 'elder' || f.role === 'lord') out.push(LORE[(h >>> 5) % LORE.length]);
  return [...new Set(out)];
}

/** What someone says when you start talking to them. */
function greeting(game, f, t, me) {
  const time = game.world.time || 0, h = hourOf(time), day = dayOf(time);
  const seed = game.world.gen.seed, r = hash3(seed, f.k * 97 + f.bi, day * 53 + (me?.id || 0));
  if ((h >= 22 || h < 5) && r % 3 === 0) return NIGHT[(r >>> 3) % NIGHT.length];
  const lines = LINES[f.role] || LINES.villager;
  return fill(lines[(r >>> 2) % lines.length], t, me, time);
}

// ---- Talking --------------------------------------------------------------------------------------------

/** The person (townsfolk soldier) s is talking to, with who they are (f) and their town (t), or null. */
export function talkingTo(game, s) {
  const talk = s.world?.talk;
  if (!talk) return null;
  const npc = game.soldiers.find(o => o.id === talk.id);
  const ctl = npc && game.controllers.get(npc);
  return npc && ctl?.f ? { npc, f: ctl.f, t: ctl.t } : null;
}

/** The townsfolk under (or very near) the point (x, y), nearest first, within TALK_REACH of s; or null. */
export function folkAt(game, s, x, y) {
  let best = null, bd = Infinity;
  for (const o of game.soldiers) {
    if (!o.alive || !isFolk(o)) continue;
    if (Math.abs(o.x - s.x) > TALK_REACH || Math.abs(o.y - s.y) > TALK_REACH) continue;
    const dx = Math.max(0, Math.abs(x - o.x) - BODY.halfW), dy = y < o.y + BODY.top ? o.y + BODY.top - y : y > o.y + BODY.bottom ? y - o.y - BODY.bottom : 0;
    const d = dx * dx + dy * dy;
    if (d < bd && d <= 10 * 10) { bd = d; best = o; }
  }
  return best;
}

/** Player s starts talking to `npc` (one of the townsfolk). */
export function startTalk(game, s, npc) {
  const ctl = game.controllers.get(npc);
  if (!ctl?.f) return false;
  const w = s.world;
  w.talk = { id: npc.id, key: ctl.f.key, said: greeting(game, ctl.f, ctl.t, s), news: null, v: 1, at: game.tick };
  npc.npc.talkTo = s.id;
  npc.npc.talkUntil = game.tick + 60 * 60;
  game.sound('mumble', npc.x, npc.y - 10);
  // (Quests that wanted you to talk to them, or bring them something: quests.js.)
  questEvent(game, s, { type: 'talk', key: ctl.f.key });
  return true;
}

/** The talk ends (said goodbye, walked off...). */
export function endTalk(game, s) {
  const w = s.world;
  if (!w?.talk) return;
  const found = talkingTo(game, s);
  if (found && found.npc.npc.talkTo === s.id) found.npc.npc.talkTo = null;
  w.talk = null;
}

/** Each update (worldplay.js), for a player who's talking: the talk ends if they've gone off, or the person has. */
export function talkTick(game, s) {
  const w = s.world;
  if (!w?.talk) return;
  const found = talkingTo(game, s);
  if (!s.alive || !found || !found.npc.alive || Math.abs(found.npc.x - s.x) > TALK_KEEP || Math.abs(found.npc.y - s.y) > TALK_KEEP) { endTalk(game, s); return; }
  // (They keep facing you while you talk.)
  found.npc.npc.talkTo = s.id;
  found.npc.npc.talkUntil = game.tick + 120;
}

/** What a stay at the inn, healing or a guard costs here. */
function fees(game, s, f, t) {
  const max = s.maxHealth || 150, missing = Math.max(0, max - s.health), city = t.kind !== 'village';
  return {
    heal: missing < 1 && !(s.burnTicks > 0) ? 0 : Math.max(2, Math.ceil(missing * 0.2 * (city ? 1.15 : 1))),
    rest: REST_FEE[t.kind] || REST_FEE.village,
    hire: GUARD_FEE[t.kind] || 0,
  };
}

/**
 * Player s's talk as their screen shows it (talk.js's talkui.js): { id, name, title, town, kind,
 * role, said (what was last said), news (lines, once asked), options: [{ op, label, price }],
 * shop: { name, role, stock: [{ key, n, price, left, rare }] } | null, coins }. Null: not talking.
 */
export function talkView(game, s) {
  const talk = s.world?.talk, found = talkingTo(game, s);
  if (!talk || !found) return null;
  const { f, t } = found, fee = fees(game, s, f, t), options = [];
  // (Prices as this player pays them: the Haggler perk.)
  const stock = SHOPS[f.role] ? stockOf(game.world, f, t.kind !== 'village').map(o => ({ ...o, price: priceFor(o.price, s) })) : null;
  const shop = stock ? { name: SHOPS[f.role].name, role: f.role, stock } : null;
  // Quests: what they've work for (quests.js), and what you can hand in to them.
  const offers = offersFor(game, s, f, t).map(q => ({ id: q.id, kind: q.kind, title: q.title, text: q.text, reward: q.reward, goals: q.goals.map(g => goalText(s, g)), step: q.chain ? q.chain.step + 1 : q.kind === 'story' ? q.step + 1 : 0, of: q.steps || 0 }));
  const ready = readyFor(s, f.key).map(q => ({ id: q.id, title: q.title, reward: q.reward }));
  for (const q of readyFor(s, f.key)) options.push({ op: 'turnin', id: q.id, label: q.turnIn === q.giver.key ? `Done: ${q.title}` : `I've brought this for you: ${q.title}` });
  if (offers.length) options.push({ op: 'work', label: `Any work? (${offers.length})` });
  if (shop) options.push({ op: 'trade', label: 'Trade' });
  if (f.role === 'healer') options.push({ op: 'heal', label: fee.heal ? 'Heal me' : 'Heal me (you\'re well)', price: fee.heal });
  if (f.role === 'innkeeper') options.push({ op: 'rest', label: 'Rest here (and come back here)', price: fee.rest });
  if (f.role === 'guard' && f.home.kind === 'barracks' && fee.hire) options.push({ op: 'hire', label: 'Hire a guard to come with you', price: fee.hire });
  options.push({ op: 'about', label: 'Tell me about yourself' });
  options.push({ op: 'news', label: 'Any news?' });
  options.push({ op: 'bye', label: 'Goodbye' });
  return {
    id: found.npc.id, name: f.name, title: f.title, town: t.name, kind: t.kind, role: f.role, skin: ROLES[f.role].skin,
    said: talk.said, news: talk.news, options, shop, coins: s.world.inv.count('coins'), v: talk.v,
    quests: { offers, ready, full: questsOf(s).list.length >= MAX_QUESTS, level: progOf(s).level },
  };
}

/**
 * Something done in a talk (from the talk screen; online, sent to the host): { op: 'buy', key } |
 * { op: 'sell', i, all } | { op: 'heal' } | { op: 'rest' } | { op: 'hire' } | { op: 'news' } |
 * { op: 'bye' }. What's said back goes in the talk (and the HUD's notices).
 */
export function talkDo(game, s, d) {
  const w = s.world, found = talkingTo(game, s);
  if (!w?.talk || !found || !s.alive || !d || typeof d.op !== 'string') return;
  const { f, t } = found, fee = fees(game, s, f, t), inv = w.inv, city = t.kind !== 'village';
  const pay = n => {
    if (inv.count('coins') < n) { say(`That's ${n} coins. You haven't got it.`); return false; }
    inv.remove('coins', n);
    return true;
  };
  const say = text => { if (text) { w.talk.said = text; w.talk.v++; } };
  switch (d.op) {
    case 'buy': {
      if (typeof d.key !== 'string') return;
      const text = buy(game.world, s, f, d.key, city, typeof d.slot === 'string' ? d.slot : null);
      say(text);
      if (text.startsWith('Bought')) game.sound('pickup', s.x, s.y, s.id);
      break;
    }
    case 'sell': {
      if (!Number.isInteger(d.i) || d.i < 0 || d.i >= inv.slots.length) return;
      const text = sell(game.world, s, f, d.i, !!d.all);
      say(text);
      if (text?.startsWith('Sold')) game.sound('pickup', s.x, s.y, s.id);
      break;
    }
    case 'heal':
      if (f.role !== 'healer') return;
      if (!fee.heal) { say('You\'re well already. Go on with you.'); break; }
      if (!pay(fee.heal)) break;
      s.health = s.maxHealth || 150;
      s.burnTicks = 0;
      game.sound('health', s.x, s.y, s.id);
      say('There. Good as new.');
      break;
    case 'rest': {
      if (f.role !== 'innkeeper') return;
      if (!pay(fee.rest)) break;
      s.health = s.maxHealth || 150;
      s.burnTicks = 0;
      // (You'll come back here, if you die.)
      w.home = { x: f.at.x * TILE + TILE / 2, y: (f.at.y + 1) * TILE - BODY.bottom - 1, inn: true };
      // (Playing alone at night: you sleep till morning.)
      const h = hourOf(game.world.time || 0), alone = game.soldiers.filter(o => o.world && !o.npc).length <= 1;
      if (alone && (h >= 19 || h < 6)) {
        // (A world's days start at six in the morning: the next seven o'clock is in the next one.)
        game.world.time = (Math.floor((game.world.time || 0) / DAY_TICKS) + 1) * DAY_TICKS + DAY_TICKS / 24;
        say('You sleep like a log, and wake to the morning. You\'ll come back here if you fall.');
      } else say('You rest a while, and feel much better. You\'ll come back here if you fall.');
      game.sound('health', s.x, s.y, s.id);
      break;
    }
    case 'hire': {
      if (f.role !== 'guard' || f.home.kind !== 'barracks' || !fee.hire) return;
      if (mercsOf(game, s).length >= MERC.most) { say(`You've ${MERC.most} with you already. That's plenty.`); break; }
      if (!pay(fee.hire)) break;
      const m = hireMerc(game, s);
      game.sound('spawn', s.x, s.y, s.id);
      say(`${m.name} will go with you. Keep them fed.`);
      break;
    }
    case 'news':
      w.talk.news = newsFrom(game, f, t);
      say(w.talk.news[0]);
      break;
    case 'about':
      // (Their story: stories.js.)
      say(tellAbout(game.world.gen, f, t));
      break;
    case 'accept': {
      const q = offersFor(game, s, f, t).find(x => x.id === d.id);
      if (!q) return;
      const text = acceptQuest(game, s, q);
      if (text) { say(text.startsWith('Quest') ? `${q.text.split('. ')[0]}. Good luck.` : text); game.notify(s, text); }
      break;
    }
    case 'turnin': {
      const q = readyFor(s, f.key).find(x => x.id === d.id);
      if (!q) return;
      const text = turnIn(game, s, q.id);
      if (text) { say(q.said || `Thank you. ${text.replace(/^Done: [^.]*\. /, 'Here: ')}.`); game.notify(s, text); }
      break;
    }
    case 'bye':
      endTalk(game, s);
      break;
  }
}

/** The townsfolk near a point (for tests and the HUD): those within r tiles. */
export function folkNear(game, x, y, r) {
  return game.soldiers.filter(o => o.alive && isFolk(o) && Math.abs(o.x - x) <= r * TILE && Math.abs(o.y - y) <= r * TILE);
}

export { townsNear };
