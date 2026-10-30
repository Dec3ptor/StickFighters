// Bots climbing: doing the route map's jumps up onto ledges as it tried them (from the very
// spot, standing still), braking in time not to run past where a jump starts or off a ledge,
// and the route map knowing where moves really end. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { GameMap } from '../web/src/map.js';
import { NavGraph } from '../web/src/nav.js';
import { BotController, BOT_PROFILES } from '../web/src/bot.js';
import { makeRng } from '../web/src/util.js';
import { BODY, DEFAULT_SPEED } from '../web/src/config.js';
import { makeBody } from '../web/src/physics.js';
import { setGameSpeed } from '../web/src/speed.js';
import { loadMap } from './helpers.mjs';

/** A game on map `file` with one bot, whose planning is left to the test. */
function climber(file) {
  const game = new Game({ mapData: loadMap(file), mode: 'ffa', fragLimit: 9999, seed: 1, effects: false, speed: DEFAULT_SPEED });
  const nav = game.useNav(new NavGraph(game.map));
  const ctl = new BotController(nav, 'normal', BOT_PROFILES[0], makeRng(1));
  const s = game.addSoldier({ name: 'Climber', isBot: true, team: 0, profile: BOT_PROFILES[0] }, ctl);
  for (let i = 0; i < 400 && !s.alive; i++) game.update();
  return { game, nav, ctl, s };
}

/** Put the bot at spot `from`, standing, to follow `path` (no planning of its own meanwhile). */
function place({ ctl, s }, from, path) {
  Object.assign(s.body, makeBody(from.x, from.y));
  s.body.onGround = true;
  s.prevX = from.x; s.prevY = from.y;
  s.health = s.maxHealth; s.spawnProtect = 1e6;
  ctl.reset();
  ctl.path = path; ctl.li = 0; ctl.start = from; ctl.goalKind = 'roam';
}

test('bots walk up to where a jump starts, and land the jumps up onto ledges', () => {
  for (const file of ['ssdm1.json', 'ssteam1.json', 'kasbah.json']) {
    const c = climber(file), { game, nav, ctl, s } = c;
    // Jumps up (over 24 px), each from a spot beside where it starts, walking up to it first.
    const ups = [];
    for (const a of nav.nodes) for (const l of a.links) if (l.type === 'jump' && l.to.y < a.y - 24) ups.push([a, l]);
    const step = Math.max(1, Math.floor(ups.length / 40));
    let made = 0, tried = 0;
    const missed = [];
    for (let k = 0; k < ups.length; k += step) {
      const [a, l] = ups[k];
      let side = null, walk = null;
      for (const o of nav.nodes) for (const w of o.links) if (!walk && w.type === 'walk' && w.to === a) { side = o; walk = w; }
      const path = walk ? [walk, l] : [l];
      place(c, side || a, path);
      let done = false;
      for (let t = 0; t < 600 && !done; t++) {
        ctl.thinkIn = 1e9;
        game.update();
        done = ctl.li === path.length && !ctl.exec;
      }
      tried++;
      // (Where the bot itself judged it landed where the jump goes; it may have slid on a little since.)
      if (done && s.body.onGround && Math.abs(s.y - l.to.y) < 1) made++;
      else missed.push(`(${Math.round(a.x)},${a.y}) -> (${Math.round(l.to.x)},${l.to.y}): at (${Math.round(s.x)},${Math.round(s.y)})`);
    }
    assert.ok(tried >= 20, `${file}: enough jumps tried (${tried})`);
    assert.equal(made, tried, `${file}: every jump up made (${made}/${tried}); missed ${missed.slice(0, 4).join('; ')}`);
  }
});

test('a bot on its way to a jump stops right on the spot (not past it, off the ledge)', () => {
  const c = climber('ssteam1.json'), { game, nav, ctl, s } = c;
  // Jumps up from the end of a floor, run up to at full speed along it from four spots back.
  let checked = 0;
  for (const a of nav.nodes) {
    for (const l of a.links) {
      if (l.type !== 'jump' || l.to.y > a.y - 24 || checked >= 12) continue;
      const dir = Math.sign(l.to.x - a.x) || 1;
      if (a.links.some(w => w.type === 'walk' && w.dir === dir)) continue; // (not the end of the floor)
      const run = [];
      let at = a;
      for (let i = 0; i < 4; i++) {
        const back = nav.nodes.find(o => Math.abs(o.y - a.y) < 0.5 && o.links.some(w => w.type === 'walk' && w.to === at && w.dir === dir));
        if (!back) break;
        run.unshift(back.links.find(w => w.type === 'walk' && w.to === at && w.dir === dir));
        at = back;
      }
      if (run.length < 4) continue;
      place(c, at, [...run, l]);
      let before = null, started = null;
      for (let t = 0; t < 400 && !started; t++) {
        before = { x: s.body.x, vx: s.body.vx };
        ctl.thinkIn = 1e9;
        game.update();
        if (ctl.exec) started = before;
        else assert.ok(s.body.onGround, `ran off the end of the floor before the jump at (${Math.round(a.x)},${a.y})`);
      }
      assert.ok(started, `the jump at (${Math.round(a.x)},${a.y}) started`);
      assert.ok(Math.abs(started.x - a.x) < 1e-6 && started.vx === 0, `from right on its spot, standing (${started.x}, going ${started.vx}, for ${a.x})`);
      checked++;
    }
  }
  assert.ok(checked >= 3, `enough runs up to the end of a floor tried (${checked})`);
});

test("no spots on a jump pad set into the floor (it launches whoever's middle is over it)", () => {
  setGameSpeed(DEFAULT_SPEED);
  const pad = { left: -20, top: 0, right: 20, bottom: 10, bounce: -8 };
  const nav = new NavGraph(new GameMap({
    name: 'pad', bounds: { left: -400, top: -600, right: 400, bottom: 200 }, spawns: [], items: [],
    // (A ledge up beside it to be launched onto.)
    platforms: [{ left: -300, top: 0, right: 300, bottom: 40 }, pad, { left: 40, top: -200, right: 200, bottom: -180 }],
  }));
  const floor = nav.nodes.filter(n => n.y === -BODY.bottom);
  assert.ok(floor.length > 20, 'spots along the floor');
  assert.ok(floor.every(n => n.x < pad.left || n.x > pad.right), `none over the pad (${floor.filter(n => n.x >= pad.left && n.x <= pad.right).map(n => n.x)})`);
  // Spots right by its edges, and a way up from there: onto the pad, launched onto the ledge.
  for (const side of [-1, 1]) {
    const edge = floor.find(n => side > 0 ? n.x > pad.right && n.x - pad.right < 0.1 : n.x < pad.left && pad.left - n.x < 0.1);
    assert.ok(edge, `a spot right beside its ${side > 0 ? 'right' : 'left'} edge`);
    assert.ok(edge.links.some(l => l.to.y === -200 - BODY.bottom), 'and from there, a launch up onto the ledge');
  }
});

// Ssdm7: pillars, with a block jutting out 16 px below each one's inner edge. Landing on a
// pillar's inner edge at speed, braking carries a soldier off it, down onto the block.
const PILLAR = 112 - BODY.bottom, BLOCK = 128 - BODY.bottom;

test('a move that lands at speed by the end of a ledge goes where braking carries it (off the end and down)', () => {
  setGameSpeed(DEFAULT_SPEED);
  const nav = new NavGraph(new GameMap(loadMap('ssdm7.json')));
  const onPillar = n => n.y === PILLAR && n.x > -160 && n.x < -95;
  const offEdge = [];
  for (const a of nav.nodes) for (const l of a.links) if (l.type !== 'walk' && l.to.y === BLOCK && l.to.x > -112 && l.to.x < -80 && (onPillar(a) || a.y < 0)) offEdge.push(l);
  assert.ok(offEdge.length >= 4, `moves onto the pillar's edge that end on the block below it (${offEdge.length})`);
  // (So everywhere a soldier can get to, the route map knows a way down from there.)
  const from = nav.nodes.find(n => onPillar(n));
  const costs = nav.costsFrom(from).cost;
  assert.ok(nav.nodes.filter(n => n.y === BLOCK && n.x > -112 && n.x < -48).every(n => costs[n.id] < Infinity), 'the block below can be got to from the pillar');
});

test('a bot doing a move that slides on after landing (off the end of a ledge) ends up where it goes', () => {
  const c = climber('ssdm7.json'), { game, nav, ctl, s } = c;
  const slides = [];
  for (const a of nav.nodes) {
    if (a.y !== PILLAR || a.x < -160 || a.x > -95) continue;
    for (const l of a.links) if (l.type !== 'walk' && l.to.y === BLOCK && l.to.x > -112 && l.to.x < -80) slides.push([a, l]);
  }
  assert.ok(slides.length > 0, 'moves from the pillar that slide off it onto the block');
  for (const [a, l] of slides.slice(0, 6)) {
    place(c, a, [l]);
    for (let t = 0; t < 400 && !(ctl.li === 1 && !ctl.exec); t++) { ctl.thinkIn = 1e9; game.update(); }
    assert.equal(ctl.li, 1, `the move from (${Math.round(a.x)},${a.y}) went where it goes (at ${Math.round(s.x)},${Math.round(s.y)})`);
    assert.ok(s.body.onGround && s.y === BLOCK, `on the block (${Math.round(s.x)},${s.y})`);
  }
});
