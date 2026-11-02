// Quests and progress (world mode): quests from every townsperson (from the seed: the same ones
// on every computer, thousands of different ones), each kind of goal kept up to date as it's done
// (killing, bringing, mining, delivering, finding, going places, hunting a named monster), handed
// in for coins, experience and things; experience from fighting, mining and crafting, levels with
// more health and perk points, perks that do what they say; all of it kept with your things, and
// online through the host. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { NetHost } from '../web/src/net/host.js';
import { NetClient } from '../web/src/net/client.js';
import { memoryLinks } from '../web/src/net/peer.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { TileWorld, TILE } from '../web/src/world/tileworld.js';
import * as K from '../web/src/world/blocks.js';
import { folkOf, isFolk } from '../web/src/world/townsfolk.js';
import { talkView, talkDo, startTalk } from '../web/src/world/talk.js';
import { makeQuest, QUEST_KINDS, questsOf, offersFor, acceptQuest, turnIn, questReady, goalText, MAX_QUESTS } from '../web/src/world/quests.js';
import { progOf, giveXp, xpToNext, spendPoint, maxHealthOf, digScale, damageScale, PERKS, BASE_HEALTH } from '../web/src/world/progress.js';
import { breakBlock, playerToSave, worldFromSave, chestAt, crafted } from '../web/src/world/worldplay.js';
import { spawnMonster, DAY_TICKS } from '../web/src/world/monsters.js';
import { damage } from '../web/src/combat.js';
import { RECIPES } from '../web/src/world/crafting.js';
import { stockOf, priceFor } from '../web/src/world/trade.js';
import { WorldHost, WorldClient } from '../web/src/world/worldnet.js';
import { itemOf } from '../web/src/world/items.js';

const SEED = 777;

function play(seed = SEED) {
  const world = new TileWorld({ seed, name: 'Quests', towns: true });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const me = game.addSoldier({ name: 'Walker', isBot: false }, { input: () => ({ move: 0 }) });
  for (let i = 0; i < 300 && !me.alive; i++) game.update();
  world.devQuiet = true; // (no monsters coming of their own accord)
  return { world, game, me, town: world.gen.townIn(world.gen.spawnRegion) };
}
const run = (game, n) => { for (let i = 0; i < n; i++) game.update(); };
const put = (s, tx, ty) => { s.body.x = tx * TILE + 8; s.body.y = (ty + 1) * TILE - 14; s.body.vx = s.body.vy = 0; };
const mid = t => (t.x0 + t.x1) >> 1;
/** Into town t, until its people have come; returns them. */
function visit(m, t) {
  put(m.me, mid(t), t.level - 1);
  run(m.game, 150);
  return m.game.soldiers.filter(s => isFolk(s) && s.alive);
}
/** A quest of `kind` from townsperson f of town t, taken by player me (each its own: a period of its own). */
let taken = 0;
function take(m, kind, f, t, level = 1) {
  const q = makeQuest(m.world, f, t, 100 + taken++, 0, level, kind);
  assert.ok(q, `a ${kind} quest`);
  assert.match(acceptQuest(m.game, m.me, q) || '', /^Quest/, `${kind}: taken`);
  return questsOf(m.me).list.find(x => x.id === q.id);
}
/** Kill monster z as player me would. */
function kill(m, z) {
  run(m.game, 2);
  z.spawnProtect = 0;
  damage(m.game, z, 1e6, m.me, 'M4');
  assert.ok(!z.alive, 'killed');
}

test('quests come from the seed: the same from the same person, thousands of different ones, every kind', () => {
  const m = play(), g = m.world.gen, texts = new Set(), kinds = new Set();
  for (let k = g.spawnRegion - 6; k <= g.spawnRegion + 6; k++) {
    const t = g.townIn(k);
    if (!t) continue;
    for (const f of folkOf(SEED, t)) {
      for (let period = 0; period < 12; period++) for (let i = 0; i < 2; i++) for (const lvl of [1, 7, 13]) {
        const q = makeQuest(m.world, f, t, period, i, lvl);
        if (!q) continue;
        assert.deepEqual(makeQuest(m.world, f, t, period, i, lvl), q, 'the same again');
        for (const words of [q.title, q.text, ...q.goals.map(gl => goalText(m.me, gl))]) assert.ok(!/undefined|NaN|null|\{|\}/.test(words), `${q.tpl}: "${words}"`);
        assert.ok(q.reward.xp > 0 && (q.reward.coins > 0 || q.reward.items?.length), `${q.tpl}: a reward`);
        texts.add(`${q.title}|${q.text}`);
        kinds.add(q.tpl);
      }
    }
  }
  assert.ok(texts.size > 1000, `thousands of different quests (${texts.size} round the start alone)`);
  assert.deepEqual([...kinds].sort(), [...QUEST_KINDS].sort(), 'every kind of quest given somewhere');
});

test('ask for work: two quests from someone, taken, shown in the talk, not offered again; a full journal stops more', () => {
  const m = play();
  visit(m, m.town);
  const npc = m.game.soldiers.find(s => isFolk(s) && s.npc.role === 'merchant');
  startTalk(m.game, m.me, npc);
  const v = talkView(m.game, m.me);
  assert.equal(v.quests.offers.length, 2, 'two to choose from');
  assert.ok(v.options.some(o => o.op === 'work'), '"Any work?"');
  talkDo(m.game, m.me, { op: 'accept', id: v.quests.offers[0].id });
  assert.equal(questsOf(m.me).list.length, 1, 'taken');
  assert.equal(talkView(m.game, m.me).quests.offers.length, 1, 'and not offered again');
  // (In the HUD's marks: they've still work, so a !.)
  run(m.game, 31);
  assert.ok(m.me.world.marks.some(([id, mk]) => id === npc.id && mk === '!'), 'a ! over them');
  // A full journal.
  const qs = questsOf(m.me);
  while (qs.list.length < MAX_QUESTS) qs.list.push({ ...qs.list[0], id: `x${qs.list.length}` });
  assert.match(acceptQuest(m.game, m.me, makeQuest(m.world, m.game.controllers.get(npc).f, m.town, 5, 1)) || '', /quests already/);
});

test('kill and bring: counted as it\'s done, handed in for coins, experience and things', () => {
  const m = play();
  const here = visit(m, m.town), npc = here.find(s => s.npc.role === 'merchant'), f = m.game.controllers.get(npc).f;
  const cull = take(m, 'cull', f, m.town), goal = cull.goals[0];
  for (let i = 0; i < goal.n; i++) kill(m, spawnMonster(m.game, goal.what, m.me.x + 40, m.me.y - 6));
  assert.equal(goal.have, goal.n, 'every kill counted');
  assert.ok(questReady(m.me, cull) && cull.ready, 'ready to hand in');
  // Handed in to whoever gave it.
  startTalk(m.game, m.me, npc);
  const coins = m.me.world.inv.count('coins'), xp = progOf(m.me).xp + (progOf(m.me).level - 1) * 1e6;
  const opt = talkView(m.game, m.me).options.find(o => o.op === 'turnin' && o.id === cull.id);
  assert.ok(opt, 'a "Done" option in the talk');
  talkDo(m.game, m.me, { op: 'turnin', id: cull.id });
  assert.equal(m.me.world.inv.count('coins'), coins + cull.reward.coins, 'paid');
  assert.ok(progOf(m.me).xp + (progOf(m.me).level - 1) * 1e6 > xp, 'experience');
  assert.ok(questsOf(m.me).done.has(cull.id) && !questsOf(m.me).list.length, 'done');
  // Bring: what's asked for is taken when it's handed in.
  const ore = take(m, 'ore', f, m.town), want = ore.goals[0];
  assert.ok(!questReady(m.me, ore));
  m.me.world.inv.add(want.key, want.n + 3);
  assert.ok(questReady(m.me, ore), 'carrying enough');
  assert.match(turnIn(m.game, m.me, ore.id), /^Done/);
  assert.equal(m.me.world.inv.count(want.key), 3, 'what was asked for, taken');
});

test('mine, find, visit, depth: digging it yourself, a chest underground, going places', () => {
  const m = play();
  const here = visit(m, m.town), f = m.game.controllers.get(here.find(s => s.npc.role === 'merchant')).f;
  // Mine: blocks broken by the player count (not ore picked up).
  const mine = take(m, 'mine', f, m.town), mg = mine.goals[0];
  const block = K.BLOCKS.find(b => b.drop === mg.key && b.key.endsWith('_ore'))?.id ?? K.BLOCK_BY_KEY.get(mg.key)?.id;
  const tx = Math.floor(m.me.x / TILE) + 3, ty = Math.floor(m.me.y / TILE) - 6;
  for (let i = 0; i < mg.n; i++) { m.world.setTile(tx, ty, block); breakBlock(m.game, tx, ty, m.me); }
  assert.equal(mg.have, mg.n, `mined ${mg.n} ${mg.key}`);
  // Find: a chest put underground with the thing in it.
  const find = take(m, 'find', f, m.town), at = find.goals[0].at;
  assert.equal(m.world.tile(at.x, at.y), K.CHEST, 'a chest where it says');
  const chest = chestAt(m.world, at.x, at.y);
  assert.equal(chest.count(find.goals[0].key), 1, `the ${find.goals[0].key} in it`);
  chest.remove(find.goals[0].key, 1);
  m.me.world.inv.add(find.goals[0].key, 1);
  assert.ok(questReady(m.me, find), 'found');
  // Visit: another town.
  const go = take(m, 'visit', f, m.town), vg = go.goals[0];
  const other = m.world.gen.townIn(vg.k);
  put(m.me, mid(other), other.level - 1);
  run(m.game, 40);
  assert.ok(vg.done, `been to ${vg.name}`);
  // Depth: deep enough.
  const deep = take(m, 'depth', f, m.town), dg = deep.goals[0];
  const x = Math.floor(m.me.x / TILE), y = m.world.gen.surfaceAt(x) + dg.n + 2;
  for (let yy = y - 3; yy <= y; yy++) m.world.setTile(x, yy, K.AIR);
  m.world.setTile(x, y + 1, K.STONE);
  put(m.me, x, y);
  run(m.game, 40);
  assert.ok(dg.done, `${dg.n} blocks down`);
});

test('deliver and talk: a parcel carried to someone in another town, a word with someone there', () => {
  const m = play();
  const here = visit(m, m.town), f = m.game.controllers.get(here.find(s => s.npc.role === 'merchant')).f;
  const del = take(m, 'deliver', f, m.town), dg = del.goals[0];
  assert.equal(m.me.world.inv.count(dg.key), 1, `given the ${dg.key} to carry`);
  const other = m.world.gen.townIn(dg.to.k);
  put(m.me, dg.to.x, dg.to.y);
  run(m.game, 150);
  const them = m.game.soldiers.find(s => s.npc?.key === dg.to.key && s.alive);
  assert.ok(them, `${dg.to.name} in ${other.name}`);
  startTalk(m.game, m.me, them);
  assert.ok(dg.done, 'delivered (talking to them with it)');
  const opt = talkView(m.game, m.me).options.find(o => o.op === 'turnin');
  assert.ok(opt, 'handed in to whoever it was for');
  const coins = m.me.world.inv.count('coins');
  talkDo(m.game, m.me, { op: 'turnin', id: del.id });
  assert.equal(m.me.world.inv.count(dg.key), 0, 'the parcel handed over');
  assert.equal(m.me.world.inv.count('coins'), coins + del.reward.coins, 'and paid for it');
});

test('hunt: a named monster at its lair, there when you come near, worth a lot dead', () => {
  const m = play();
  const here = visit(m, m.town), f = m.game.controllers.get(here.find(s => s.npc.role === 'merchant')).f;
  const hunt = take(m, 'hunt', f, m.town), hg = hunt.goals[0];
  assert.ok(hg.name.length > 4 && hunt.title.includes(hg.name), `a bounty on ${hg.name}`);
  put(m.me, hg.at.x - 6, hg.at.y);
  for (let x = hg.at.x - 8; x <= hg.at.x - 4; x++) for (let y = hg.at.y - 2; y <= hg.at.y; y++) m.world.setTile(x, y, K.AIR);
  m.world.setTile(hg.at.x - 6, hg.at.y + 1, K.STONE);
  run(m.game, 40);
  const champ = m.game.soldiers.find(s => s.npc?.champion);
  assert.ok(champ && champ.name === hg.name, 'it\'s there');
  run(m.game, 3);
  assert.ok(champ.maxHealth >= 3 * 80, `tougher than most (${champ.maxHealth})`);
  kill(m, champ);
  assert.ok(hg.done && questReady(m.me, hunt), 'the bounty done');
});

test('experience and levels: from kills, mining and making things; each level more health and a perk point; perks work', () => {
  const m = play(), p = progOf(m.me);
  assert.equal(p.level, 1);
  const before = p.xp;
  kill(m, spawnMonster(m.game, 'skeleton', m.me.x + 40, m.me.y - 6));
  assert.equal(p.xp - before, 15, 'a skeleton: 15');
  const tx = Math.floor(m.me.x / TILE) + 3, ty = Math.floor(m.me.y / TILE) - 6;
  m.world.setTile(tx, ty, K.GOLD);
  breakBlock(m.game, tx, ty, m.me);
  assert.equal(p.xp - before, 15 + 6, 'gold ore: 6 more');
  const pick = RECIPES.find(r => r.key === 'iron_pickaxe');
  crafted(m.game, m.me, pick, 1);
  assert.ok(p.xp - before > 21, 'making something worth something');
  // Up a level: more health, a point.
  giveXp(m.game, m.me, xpToNext(1) - p.xp);
  assert.equal(p.level, 2);
  assert.equal(p.points, 1);
  assert.equal(m.me.maxHealth, BASE_HEALTH + 3, 'more health');
  assert.equal(m.me.world.levelUp.level, 2, 'said on the screen');
  // Perks.
  assert.match(spendPoint(m.me, 'tough'), /^Tough 1/);
  assert.equal(m.me.maxHealth, maxHealthOf(m.me));
  assert.equal(m.me.maxHealth, BASE_HEALTH + 3 + 12);
  assert.match(spendPoint(m.me, 'miner'), /No perk points/);
  p.points = 10;
  spendPoint(m.me, 'miner'); spendPoint(m.me, 'marksman'); spendPoint(m.me, 'haggler');
  assert.ok(digScale(m.me) > 1 && damageScale(m.me, 'M4') > 1 && damageScale(m.me, 'Knife') === 1, 'faster digging, harder shooting');
  const t = m.town, merchant = folkOf(SEED, t).find(x => x.role === 'merchant');
  const o = stockOf(m.world, merchant, false)[0];
  assert.ok(priceFor(o.price * 10, m.me) < o.price * 10, 'cheaper with Haggler');
  for (const id of Object.keys(PERKS)) assert.ok(PERKS[id].text(1).length > 5);
});

test('kept with your things: your level, perks and quests saved and loaded', () => {
  const m = play();
  const here = visit(m, m.town), f = m.game.controllers.get(here.find(s => s.npc.role === 'merchant')).f;
  const q = take(m, 'cull', f, m.town);
  q.goals[0].have = 2;
  giveXp(m.game, m.me, 500);
  progOf(m.me).perks.tough = 1;
  const saved = JSON.parse(JSON.stringify(playerToSave(m.me, m.game)));
  const w = worldFromSave(saved);
  assert.equal(w.prog.level, progOf(m.me).level);
  assert.equal(w.prog.perks.tough, 1);
  assert.equal(w.quests.list[0].id, q.id);
  assert.equal(w.quests.list[0].goals[0].have, 2, 'how far along');
  assert.equal(w.quests.track, q.id);
});

test('online: a joining player takes work, sees their level and quests, and spends a perk point through the host', async () => {
  const world = new TileWorld({ seed: SEED, name: 'Shared', towns: true });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, effects: true, seed: 1, options: { destruction: true } });
  game.online = true;
  const host = game.addSoldier({ name: 'Host', isBot: false }, { input: () => ({ move: 0 }) });
  const sync = new WorldHost(game, {});
  const net = new NetHost({ maxPlayers: 8, botCount: 0, world: sync, matchInfo: () => ({ mode: 'world', mapName: world.name, speed: DEFAULT_SPEED, options: game.options, world: sync.info() }), addBot: () => {} });
  net.setGame(game);
  let now = 0;
  const queue = [], talks = [];
  const schedule = (fn, ms) => queue.push({ fn, at: now + ms });
  const [h, c] = memoryLinks({ latency: 20, schedule });
  const wc = new WorldClient({ onTalk: v => talks.push(v) });
  const client = new NetClient({ link: c, controller: { input: () => ({ move: 0 }) }, loadMap: async () => null, clock: () => now, world: wc });
  net.addPlayer(h, 'Guest');
  const pump = async () => {
    for (let k = 0; k < 4; k++) {
      await new Promise(r => setImmediate(r));
      const due = queue.filter(q => q.at <= now);
      for (const q of due) { queue.splice(queue.indexOf(q), 1); q.fn(); }
    }
  };
  const step = async (n = 1) => { for (let i = 0; i < n; i++) { game.update(); net.afterTick(); client.tick(); now += 1000 / 60; await pump(); client.updateView(now); } };
  await pump();
  await step(120);
  world.devQuiet = true;
  const t = world.gen.townIn(world.gen.spawnRegion), guest = game.soldiers.find(s => s.remote);
  put(host, mid(t), t.level - 1);
  put(guest, mid(t), t.level - 1);
  let npc = null;
  for (let i = 0; i < 400 && !npc; i++) { await step(1); npc = game.soldiers.find(s => isFolk(s) && s.alive && s.npc.role === 'merchant'); }
  assert.ok(npc, 'the merchant about');
  game.controllers.get(npc).wait = 2000;
  put(guest, Math.floor(npc.x / TILE) - 2, Math.floor((npc.y + 13) / TILE));
  await step(4);
  assert.ok(startTalk(game, guest, npc), 'talking to them');
  await step(10);
  const offer = talks.at(-1)?.quests?.offers?.[0];
  assert.ok(offer, `their work, in the talk (${JSON.stringify(talks.at(-1)?.quests)}, ${talks.length} talks)`);
  c.send({ t: 'wop', op: 'talk', d: { op: 'accept', id: offer.id } }, true);
  await step(12);
  assert.equal(questsOf(guest).list[0]?.id, offer.id, 'taken, on the host');
  assert.equal(client.me.world.quests.list[0]?.id, offer.id, 'and they see it');
  // Their level: from the host.
  giveXp(game, guest, xpToNext(1) + 5);
  await step(10);
  assert.equal(client.me.world.prog.level, 2, 'they see their new level');
  assert.equal(client.me.maxHealth, BASE_HEALTH + 3, 'and their health');
  c.send({ t: 'wop', op: 'perk', id: 'tough' }, true);
  await step(10);
  assert.equal(progOf(guest).perks.tough, 1, 'a perk point spent, on the host');
  assert.equal(client.me.world.prog.perks.tough, 1, 'and they see it');
  c.send({ t: 'wop', op: 'qdrop', id: offer.id }, true);
  await step(10);
  assert.equal(questsOf(guest).list.length, 0, 'given up');
  assert.ok(itemOf('parcel') && itemOf('parcel').kind === 'quest');
});
