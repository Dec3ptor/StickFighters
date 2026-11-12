// Knowing where everyone is: other soldiers' footsteps (web/src/footsteps.js), the small map
// whenever the whole map doesn't fit on the screen (objdraw.js's wantsMinimap), and the two sides'
// colours kept in one place, with a pair that's easier to tell apart (teamcolors.js).
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../web/src/game.js';
import { DEFAULT_SPEED, PHYS, MOTION } from '../web/src/config.js';
import { footsteps, STRIDE, STEP_RANGE, MATE_RANGE } from '../web/src/footsteps.js';
import { wantsMinimap } from '../web/src/objdraw.js';
import { TEAM, TEAM_HEAD, TEAM_BRIGHT, TEAM_NAME, TEAM_PALETTES, setTeamPalette, teamPalette, teamPaletteVersion } from '../web/src/teamcolors.js';

const FLAT = { name: 'flat', bounds: { left: -600, top: -600, right: 1600, bottom: 200 }, items: [],
  spawns: [{ x: 0, y: -12, team: 1 }, { x: 400, y: -12, team: 2 }], platforms: [{ left: -600, top: 0, right: 1600, bottom: 40 }] };

function arena(mode = 'ffa', teams = [0, 0]) {
  const g = new Game({ mapData: FLAT, effects: false, seed: 5, speed: DEFAULT_SPEED, mode, fragLimit: 999 });
  const inputs = teams.map(() => ({ move: 0 }));
  const all = teams.map((team, i) => g.addSoldier({ name: `S${i}`, isBot: false, team }, { input: () => ({ ...inputs[i] }) }));
  for (let i = 0; i < 400 && !all.every(s => s.alive); i++) g.update();
  for (const [i, s] of all.entries()) { s.spawnProtect = 1e9; s.body.x = i * 200; s.body.y = -12; s.body.vx = s.body.vy = 0; }
  for (let i = 0; i < 30; i++) g.update();
  return { g, all, inputs };
}
/** Run the game n updates, listening from soldier `me`'s place: the steps heard. */
function listen(m, me, n) {
  const heard = [];
  for (let i = 0; i < n; i++) { m.g.update(); footsteps(m.g, me, me.x, me.y, heard); }
  return heard;
}

test('someone running near you is heard, a step a stride; not creeping crouched, not standing, not yourself', () => {
  const m = arena(), [me, other] = m.all;
  assert.equal(listen(m, me, 60).length, 0, 'nobody moving: silence');
  // (They run toward us.)
  m.inputs[1].move = -1;
  const from = other.x;
  let heard = listen(m, me, 40);
  const ran = Math.abs(other.x - from);
  assert.ok(heard.length >= Math.floor(ran / STRIDE) - 1 && heard.length <= Math.ceil(ran / STRIDE) + 1, `${heard.length} steps in ${Math.round(ran)} px`);
  assert.ok(heard.every(s => s.name === 'step' && s.to == null && s.range === STEP_RANGE), 'a step, heard so far');
  assert.ok(Math.abs(heard.at(-1).x - other.x) < 30, 'where they are');
  // (Crouched: silent. Our own: not played.)
  m.inputs[1].move = 1; m.inputs[1].crouch = true;
  listen(m, me, 10);
  assert.equal(listen(m, me, 40).length, 0, 'creeping along crouched is silent');
  m.inputs[1] = { move: 0 };
  m.inputs[0].move = 1;
  listen(m, me, 10);
  assert.equal(listen(m, me, 30).filter(s => Math.abs(s.x - me.x) < 20).length, 0, 'your own aren\'t played');
  assert.ok(PHYS.runSpeed * MOTION.timeScale > 1);
});

test('too far off to hear; a team-mate\'s carry less far than an enemy\'s', () => {
  const far = arena(), [me, other] = far.all;
  other.body.x = me.x + STEP_RANGE + 400;
  far.inputs[1].move = 1;
  assert.equal(listen(far, me, 60).length, 0, 'out of earshot');
  const t = arena('team', [1, 1, 2]), [a, mate, foe] = t.all;
  mate.body.x = a.x + MATE_RANGE + 60; foe.body.x = a.x - MATE_RANGE - 60;
  t.inputs[1].move = 1; t.inputs[2].move = -1;
  const heard = listen(t, a, 30);
  assert.ok(heard.length > 0 && heard.every(s => s.x < a.x && s.range === STEP_RANGE), 'the enemy at that distance is heard, the team-mate isn\'t');
  // (Nearer, the team-mate's are heard too.)
  mate.body.x = a.x + 120;
  t.inputs[2].move = 0;
  const near = listen(t, a, 40);
  assert.ok(near.some(s => s.x > a.x && s.range === MATE_RANGE));
});

test('the small map shows whenever the whole map doesn\'t fit on the screen', () => {
  const r = { w: 1280, h: 720, scale: 1.2, cam: { zoom: 1 } };
  const map = (w, h) => ({ bounds: { left: 0, top: 0, right: w, bottom: h } });
  assert.equal(wantsMinimap(map(900, 500), r), false, 'all on screen: no need');
  assert.equal(wantsMinimap(map(1500, 500), r), true, 'wider than the screen');
  assert.equal(wantsMinimap(map(900, 900), r), true, 'taller than it');
  assert.equal(wantsMinimap(map(4000, 900), r), true, 'big anyway');
  // (Zoomed out down a scope: the same answer as at the usual zoom.)
  assert.equal(wantsMinimap(map(900, 500), { ...r, scale: 1.2 * 0.72, cam: { zoom: 0.72 } }), false);
  // (A bigger screen fits more.)
  assert.equal(wantsMinimap(map(1500, 500), { w: 2560, h: 1440, scale: 1.2, cam: { zoom: 1 } }), false);
});

test('the sides\' colours: one place, changed in place; a pair that\'s told apart more easily; still Blue and Red', () => {
  assert.equal(teamPalette(), 'standard');
  const team = TEAM, v = teamPaletteVersion(), was = { ...TEAM };
  assert.equal(setTeamPalette('strong'), 'strong');
  assert.equal(TEAM, team, 'the same object, for everything that reads from it');
  assert.deepEqual({ ...TEAM }, TEAM_PALETTES.strong.team);
  assert.deepEqual({ ...TEAM_HEAD }, TEAM_PALETTES.strong.head);
  assert.deepEqual({ ...TEAM_BRIGHT }, TEAM_PALETTES.strong.bright);
  assert.notDeepEqual({ ...TEAM }, was);
  assert.ok(teamPaletteVersion() > v, 'anything keeping pictures made with them knows');
  assert.deepEqual({ ...TEAM_NAME }, { 1: 'Blue', 2: 'Red' });
  assert.equal(setTeamPalette('nonsense'), 'standard', 'anything else: the usual');
  assert.deepEqual({ ...TEAM }, was);
  for (const p of Object.values(TEAM_PALETTES)) for (const k of ['team', 'head', 'bright']) assert.ok(/^#[0-9a-f]{6}$/.test(p[k][1]) && /^#[0-9a-f]{6}$/.test(p[k][2]) && p[k][1] !== p[k][2], p.label);
});
