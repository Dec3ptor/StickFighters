// The townsfolk's own stories and missions (stories.js), and the story of every world (story.js):
// everyone has a life of their own (family in town and further off, a past, a wish), told when
// asked; their wish is a mission of three steps, each following on; and the Ember King's story
// plays through from the starting village to the bottom of the world and home. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { TileWorld, TILE } from '../web/src/world/tileworld.js';
import * as K from '../web/src/world/blocks.js';
import { WorldGen } from '../web/src/world/worldgen.js';
import { folkOf } from '../web/src/world/townsfolk.js';
import { talkView, talkDo, startTalk, endTalk } from '../web/src/world/talk.js';
import { questsOf, storyAt, questReady } from '../web/src/world/quests.js';
import { storyStep, cast, STORY_STEPS } from '../web/src/world/story.js';
import { tellAbout, storyOf, missionStep } from '../web/src/world/stories.js';
import { progOf } from '../web/src/world/progress.js';
import { chestAt } from '../web/src/world/worldplay.js';
import { damage } from '../web/src/combat.js';

const SEED = 777;

function play(seed = SEED) {
  const world = new TileWorld({ seed, name: 'Story', towns: true });
  const game = new Game({ world, mode: 'world', speed: DEFAULT_SPEED, options: { destruction: true }, effects: false, seed: 1 });
  const me = game.addSoldier({ name: 'Hero', isBot: false }, { input: () => ({ move: 0 }) });
  for (let i = 0; i < 300 && !me.alive; i++) game.update();
  world.devQuiet = true;
  me.maxHealth = me.health = 1e9;
  return { world, game, me, gen: world.gen };
}
const run = (game, n) => { for (let i = 0; i < n; i++) game.update(); };
const goTo = (me, x, y) => { me.body.x = x * TILE + 8; me.body.y = (y + 1) * TILE - 14; me.body.vx = me.body.vy = 0; };
/** Go to townsperson p, wait till they're about, and start talking to them. */
function meet(m, p) {
  goTo(m.me, p.at.x - 2, p.at.y);
  let s = null;
  for (let i = 0; i < 400 && !(s = m.game.soldiers.find(o => o.npc?.key === p.key && o.alive)); i++) m.game.update();
  assert.ok(s, `${p.label} about`);
  goTo(m.me, Math.floor(s.x / TILE) - 2, Math.floor((s.y + 13) / TILE));
  run(m.game, 3);
  assert.ok(startTalk(m.game, m.me, s), `talking to ${p.label}`);
  return s;
}
/** Do a quest's goals (as quickly as can be: the tests elsewhere do them the long way). */
function doGoals(m, q) {
  const { world, game, me, gen } = m;
  for (const g of q.goals) {
    if (g.t === 'depth') { const x = Math.floor(me.x / TILE), y = gen.surfaceAt(x) + g.n + 2; for (let yy = y - 3; yy <= y; yy++) world.setTile(x, yy, K.AIR); world.setTile(x, y + 1, K.STONE); goTo(me, x, y); run(game, 40); }
    if (g.t === 'find') { chestAt(world, g.at.x, g.at.y).remove(g.key, 1); me.world.inv.add(g.key, 1); }
    if (g.t === 'bring') me.world.inv.add(g.key, Math.max(0, g.n - me.world.inv.count(g.key)));
    if (g.t === 'kill') g.have = g.n;
    if (g.t === 'hunt') {
      goTo(me, g.at.x - 4, g.at.y);
      for (let x = g.at.x - 6; x <= g.at.x - 2; x++) for (let y = g.at.y - 2; y <= g.at.y; y++) world.setTile(x, y, K.AIR);
      world.setTile(g.at.x - 4, g.at.y + 1, K.STONE);
      run(game, 40);
      const boss = game.soldiers.find(s => s.npc?.champion && s.name === g.name);
      assert.ok(boss, `${g.name} at its lair`);
      run(game, 3);
      boss.spawnProtect = 0;
      damage(game, boss, 1e9, me, 'M4');
    }
    if (g.t === 'deliver' || g.t === 'talk') { meet(m, folkOf(SEED, gen.townIn(g.to.k)).find(p => p.key === g.to.key)); endTalk(game, me); }
  }
  run(game, 31);
}
/** Hand quest q in to whoever it goes to. */
function handIn(m, q) {
  let p = null;
  for (let k = m.gen.spawnRegion - 12; k <= m.gen.spawnRegion + 12 && !p; k++) { const t = m.gen.townIn(k); if (t) p = folkOf(SEED, t).find(x => x.key === q.turnIn); }
  meet(m, p);
  assert.ok(talkView(m.game, m.me).options.some(o => o.op === 'turnin' && o.id === q.id), `${q.title}: handed in to ${p.label}`);
  talkDo(m.game, m.me, { op: 'turnin', id: q.id });
  const said = talkView(m.game, m.me)?.said;
  endTalk(m.game, m.me);
  return said;
}

test('everyone has a story of their own: a past, family by name (real people), a wish, told when asked', () => {
  const g = new WorldGen(SEED, { towns: true }), seen = new Set();
  let kin = 0, partners = 0, people = 0;
  for (let k = g.spawnRegion - 6; k <= g.spawnRegion + 6; k++) {
    const t = g.townIn(k);
    if (!t) continue;
    for (const f of folkOf(SEED, t)) {
      const s = storyOf(g, f, t), text = tellAbout(g, f, t);
      assert.deepEqual(storyOf(new WorldGen(SEED, { towns: true }), f, t), s, 'the same story every time');
      assert.ok(text.startsWith(`I'm ${f.name}.`) && text.length > 120 && !/undefined|null|NaN|\{/.test(text), `${f.label}: "${text}"`);
      if (s.kin) {
        kin++;
        const there = g.townIn(s.kin.k);
        assert.ok(there && there.k !== t.k && folkOf(SEED, there).some(p => p.key === s.kin.key && p.name === s.kin.name), `${f.label}'s ${s.kin.word} ${s.kin.name} lives in ${s.kin.town}`);
      }
      if (s.partner) partners++;
      seen.add(text);
      people++;
    }
  }
  assert.equal(seen.size, people, `everyone's story is their own (${people} people)`);
  assert.ok(kin > people / 3 && partners > people / 6, `family in other towns (${kin}) and at home (${partners})`);
});

test('a townsperson\'s own mission: three steps, one following on from the next, each with what they say', () => {
  const m = play(), home = m.gen.townIn(m.gen.spawnRegion);
  // Someone whose wish is to hear from their family far off.
  let f = null, t = null;
  for (let k = m.gen.spawnRegion - 4; k <= m.gen.spawnRegion + 4 && !f; k++) { const o = m.gen.townIn(k); if (o) { f = folkOf(SEED, o).find(p => storyOf(m.gen, p, o).want === 'kin'); t = o; } }
  assert.ok(f, 'someone missing their family');
  for (let i = 0; i < 3; i++) assert.ok(missionStep(m.gen, f, t, i), `step ${i + 1}`);
  assert.equal(missionStep(m.gen, f, t, 3), null, 'three steps');
  meet(m, f);
  const offer = talkView(m.game, m.me).quests.offers.find(q => q.kind === 'personal');
  assert.ok(offer && offer.step === 1 && offer.of === 3, 'their own, step 1 of 3');
  talkDo(m.game, m.me, { op: 'accept', id: offer.id });
  endTalk(m.game, m.me);
  let q = questsOf(m.me).list.find(x => x.id === offer.id);
  for (let step = 0; step < 3; step++) {
    assert.ok(q, `step ${step + 1} under way`);
    doGoals(m, q);
    assert.ok(questReady(m.me, q), `step ${step + 1} done`);
    const said = handIn(m, q);
    assert.ok(said && said.length > 10, `what they say: "${said}"`);
    q = questsOf(m.me).list.find(x => x.id === `p:${f.key}:${step + 1}`);
    if (step < 2) assert.ok(q, `step ${step + 2} follows on, straight away`);
  }
  assert.ok(questsOf(m.me).done.has(`p:${f.key}:2`), 'the mission done');
  void home;
});

test('the story: thirteen steps from the starting village, to the city, to the bottom of the world and back', () => {
  const m = play(), c = cast(m.gen);
  assert.ok(c && c.home.k === m.gen.spawnRegion && c.city.kind === 'city', 'the starting village, and the nearest city');
  for (let n = 0; n < STORY_STEPS; n++) {
    const st = storyStep(m.gen, n, progOf(m.me).level);
    assert.ok(st, `step ${n + 1}`);
    assert.ok(!/undefined|NaN|null|\{/.test(st.title + st.text + st.said), `step ${n + 1}'s words`);
    meet(m, st.giver);
    const offer = talkView(m.game, m.me).quests.offers.find(q => q.kind === 'story');
    assert.ok(offer, `step ${n + 1} (${st.title}) offered by ${st.giver.label}`);
    if (n === 0) { run(m.game, 31); assert.ok(m.me.world.marks.some(([, mk]) => mk === '★'), 'a ★ over them'); }
    talkDo(m.game, m.me, { op: 'accept', id: offer.id });
    endTalk(m.game, m.me);
    const q = questsOf(m.me).list.find(x => x.id === `s:${n}`);
    doGoals(m, q);
    assert.ok(questReady(m.me, q), `${q.title}: done`);
    handIn(m, q);
    assert.equal(storyAt(m.me), n + 1, `on to step ${n + 2}`);
  }
  assert.equal(storyAt(m.me), STORY_STEPS, 'the story told');
  assert.ok(progOf(m.me).level >= 5, `well on in levels (${progOf(m.me).level})`);
});
