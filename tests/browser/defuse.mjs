// Defuse in a browser: picked in the menu, the buy menu (B, number keys, clicks),
// planting the bomb with E, the round's result and the scoreboard; then a round in
// Remastered (its buy menu, smoke and a flashbang, planting, the bomb going off).
// Usage: node tests/browser/defuse.mjs [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve } from '../../tools/serve.mjs';
import { startRelay } from '../../tools/relay.mjs';

const outDir = process.argv[2] || 'test-results';
fs.mkdirSync(outDir, { recursive: true });
const server = await serve(0);
const relay = await startRelay();
const base = `http://localhost:${server.address().port}/?relay=${encodeURIComponent(relay.url)}`;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const check = (ok, what) => { if (!ok) errors.push(what); };
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${base}&game=original`);
await page.waitForFunction(() => window.stickSoldiers);
await page.click('#tabOffline');
await page.waitForSelector('.map-card');
// The menu: Defuse is a mode, with rounds to win.
const modes = await page.$$eval('#mode option', os => os.map(o => [o.value, o.textContent]));
check(modes.some(([v, t]) => v === 'defuse' && /Defuse/.test(t)), `Defuse in the mode list: ${JSON.stringify(modes)}`);
await page.selectOption('#mode', 'defuse');
await page.waitForTimeout(100);
const goal = await page.evaluate(() => ({ shown: !document.getElementById('goalField').classList.contains('hidden'), label: document.getElementById('goalLabel').textContent, value: document.getElementById('goal').value }));
check(goal.shown && /Rounds/i.test(goal.label) && goal.value === '7', `the setup asks for rounds to win: ${JSON.stringify(goal)}`);
// (The map made for it, Kasbah.)
const map = await page.evaluate(async () => (await (await fetch('data/maps/index.json')).json()).find(m => /kasbah/i.test(m.file))?.file || 'crossfire.json');
await page.evaluate(([map]) => {
  const s = window.stickSoldiers.readMenu();
  window.stickSoldiers.startMatch({ ...s, map, mode: 'defuse', bots: 5, goal: 5 });
}, [map]);
await page.waitForFunction(() => window.stickSoldiers.state.game?.modeState?.phase === 'freeze', null, { timeout: 30000 });
const info = () => page.evaluate(() => {
  const { state } = window.stickSoldiers, g = state.game, me = state.me, st = g.modeState;
  return { phase: st.phase, round: st.round, money: st.money[me.id], weapons: Object.keys(me.weapons), armour: me.armour, side: st.t === me.team ? 'T' : 'CT', bomb: st.bomb.s, alive: me.alive, menu: !document.getElementById('buyMenu').classList.contains('hidden') };
});
let i = await info();
check(i.money === 800 && i.weapons.includes('Knife') && i.weapons.includes('Platinum'), `the first round: ${JSON.stringify(i)}`);

// The buy menu: B opens it; 5 then 1 buys a vest; what you can't afford is greyed out; Close shuts it.
await page.keyboard.press('KeyB');
await page.waitForTimeout(150);
i = await info();
check(i.menu, 'B opens the buy menu');
check((await page.textContent('#buyMenu [data-money]')) === '$800', 'the menu shows your money');
await page.keyboard.press('Digit5');
await page.keyboard.press('Digit1');
await page.waitForTimeout(150);
i = await info();
check(i.armour === 100 && i.money === 150, `bought a vest: ${JSON.stringify(i)}`);
const rifle = i.side === 'T' ? 'AK47' : 'M4', other = i.side === 'T' ? 'M4' : 'AK47';
check(await page.$eval(`#buyMenu [data-item="${rifle}"]`, b => b.disabled && b.classList.contains('poor')), 'a rifle you can\'t afford is greyed out');
check(await page.$eval(`#buyMenu [data-item="${other}"]`, b => b.classList.contains('other-side')), 'the other side\'s rifle is marked');
await page.evaluate(() => { const { state } = window.stickSoldiers; state.game.modeState.money[state.me.id] = 6000; });
await page.waitForTimeout(100);
await page.click(`#buyMenu [data-item="${rifle}"]`);
await page.waitForTimeout(150);
i = await info();
check(i.weapons.includes(rifle) && i.money === 6000 - (rifle === 'AK47' ? 2700 : 3100), `clicked to buy the ${rifle}: ${JSON.stringify(i)}`);
await page.screenshot({ path: `${outDir}/defuse-buy.png` });
await page.click('#buyMenu [data-close]');
await page.waitForTimeout(100);
check(!(await info()).menu, 'Close shuts the buy menu');

// The round: the bomb to us (as an attacker), planted at site A by holding E.
await page.waitForFunction(() => window.stickSoldiers.state.game.modeState.phase === 'live', null, { timeout: 30000 });
await page.screenshot({ path: `${outDir}/defuse-live.png` });
const planted = await page.evaluate(async () => {
  const { state } = window.stickSoldiers, g = state.game, me = state.me, st = g.modeState;
  if (st.t !== me.team) return 'defending';
  const { objectivesOf } = await import('./src/objectives.js');
  const z = objectivesOf(g.map, 'site')[0];
  if (st.bomb.s === 'carried' && st.bomb.by !== me.id) delete g.soldiers.find(s => s.id === st.bomb.by).weapons.C4;
  g.rules.carry(g, me);
  me.spawnProtect = 1e6;
  const floor = (await import('./src/objectives.js')).floorBelow(g.map, (z.left + z.right) / 2, z.bottom - 40) ?? z.bottom;
  me.body.x = (z.left + z.right) / 2; me.body.y = floor - 12; me.body.vx = me.body.vy = 0; me.prevX = me.x; me.prevY = me.y;
  g.moved(me);
  return 'attacking';
});
if (planted === 'attacking') {
  await page.waitForTimeout(300);
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${outDir}/defuse-planting.png` });
  await page.waitForFunction(() => window.stickSoldiers.state.game.modeState.bomb.s === 'planted', null, { timeout: 8000 }).catch(() => {});
  await page.keyboard.up('KeyE');
  i = await info();
  check(i.bomb === 'planted', `held E at site A: the bomb is ${i.bomb}`);
  await page.screenshot({ path: `${outDir}/defuse-planted.png` });
  await page.evaluate(() => { const st = window.stickSoldiers.state.game.modeState; if (st.bomb.s === 'planted') st.bomb.fuse = 90; });
}
await page.waitForFunction(() => window.stickSoldiers.state.game.modeState.phase === 'over', null, { timeout: 150000 });
await page.waitForTimeout(300);
const result = await page.evaluate(() => window.stickSoldiers.state.game.modeState.result);
check(result && result.team && result.why, `a round result: ${JSON.stringify(result)}`);
if (planted === 'attacking') check(result.why === 'bomb' || result.why === 'elimination' || result.why === 'defused', `bomb round: ${result.why}`);
await page.screenshot({ path: `${outDir}/defuse-result.png` });
await page.keyboard.down('Tab');
await page.waitForTimeout(200);
await page.screenshot({ path: `${outDir}/defuse-scores.png` });
await page.keyboard.up('Tab');
// The next round starts frozen again.
await page.waitForFunction(() => window.stickSoldiers.state.game.modeState.round === 2, null, { timeout: 20000 });
i = await info();
check(i.alive && i.phase === 'freeze', `round 2: ${JSON.stringify(i)}`);

// Remastered: a round in its look. The other soldiers stand still, so nothing gets in the way.
await page.goto('about:blank');
await page.goto(`${base}&game=remastered`);
await page.waitForFunction(() => window.stickSoldiers);
await page.evaluate(([map]) => {
  const s = window.stickSoldiers.readMenu();
  window.stickSoldiers.startMatch({ ...s, map, mode: 'defuse', bots: 3, goal: 3, side: 1 });
}, [map]);
await page.waitForFunction(() => window.stickSoldiers.state.game?.modeState?.phase === 'freeze', null, { timeout: 30000 });
check(await page.evaluate(() => window.stickSoldiers.renderer.kind === 'remastered'), 'Remastered draws it');
await page.evaluate(() => {
  const { state } = window.stickSoldiers, g = state.game, me = state.me;
  for (const s of g.soldiers) if (s !== me) g.controllers.set(s, { input: () => ({ move: 0, aim: 0, aimDist: 200 }) });
});
await page.keyboard.press('KeyB');
await page.waitForTimeout(300);
check((await info()).menu, 'Remastered: B opens the buy menu');
// A smoke grenade (6, 3) and a flashbang (6, 2): $300 and $200 of our $800.
for (const k of ['Digit6', 'Digit3', 'Digit6', 'Digit2']) await page.keyboard.press(k);
await page.waitForTimeout(200);
i = await info();
check(i.weapons.includes('SmokeGrenade') && i.weapons.includes('Flashbang') && i.money === 300, `Remastered: bought grenades with the keys: ${JSON.stringify(i)}`);
await page.screenshot({ path: `${outDir}/defuse-buy-remastered.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
check(!(await info()).menu, 'Esc closes the buy menu');
await page.waitForFunction(() => window.stickSoldiers.state.game.modeState.phase === 'live', null, { timeout: 30000 });
/** Throw grenade `id` at our own feet (the mouse straight below us). */
const throwDown = async id => {
  await page.evaluate(id => window.stickSoldiers.state.me.select(id), id);
  await page.waitForTimeout(200);
  const at = await page.evaluate(() => {
    const { renderer: r, state } = window.stickSoldiers, me = state.me;
    return { x: (me.x - r.cam.x) * r.scale + r.w / 2, y: (me.y - r.cam.y) * r.scale + r.h / 2 };
  });
  await page.mouse.move(at.x + 4, Math.min(700, at.y + 160));
  await page.waitForTimeout(150);
  await page.mouse.down(); await page.waitForTimeout(50); await page.mouse.up();
};
await throwDown('SmokeGrenade');
await page.waitForFunction(() => window.stickSoldiers.state.game.projectiles.some(p => p.kind === 'cloud' && p.r > 40), null, { timeout: 10000 })
  .catch(() => check(false, 'Remastered: the smoke grenade made a cloud'));
await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}/defuse-smoke-remastered.png` });
await page.mouse.move(640, 300);
await page.waitForTimeout(400);
await throwDown('Flashbang');
await page.waitForFunction(() => window.stickSoldiers.state.me.flashTicks > 30, null, { timeout: 10000 })
  .catch(() => check(false, 'Remastered: the flashbang at our feet blinded us'));
await page.screenshot({ path: `${outDir}/defuse-flashed-remastered.png` });
// The bomb to us, planted at a site by holding E; then it goes off.
await page.evaluate(async () => {
  const { state } = window.stickSoldiers, g = state.game, me = state.me, st = g.modeState;
  const { objectivesOf, floorBelow } = await import('./src/objectives.js');
  const z = objectivesOf(g.map, 'site')[0];
  if (st.bomb.s === 'carried' && st.bomb.by !== me.id) delete g.soldiers.find(s => s.id === st.bomb.by).weapons.C4;
  g.rules.carry(g, me);
  me.flashTicks = 0;
  const floor = floorBelow(g.map, (z.left + z.right) / 2, z.bottom - 40) ?? z.bottom;
  me.body.x = (z.left + z.right) / 2; me.body.y = floor - 12; me.body.vx = me.body.vy = 0; me.prevX = me.x; me.prevY = me.y;
  g.moved(me);
});
await page.waitForTimeout(300);
await page.keyboard.down('KeyE');
await page.waitForFunction(() => window.stickSoldiers.state.game.modeState.bomb.s === 'planted', null, { timeout: 8000 }).catch(() => {});
await page.keyboard.up('KeyE');
check((await info()).bomb === 'planted', 'Remastered: held E at a site and planted the bomb');
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/defuse-planted-remastered.png` });
const lit = await page.evaluate(() => window.stickSoldiers.renderer.lights?.list.some(l => l.color === '#ff3a26'));
check(lit, 'Remastered: the planted bomb glows');
await page.evaluate(() => {
  const { state } = window.stickSoldiers, g = state.game, me = state.me, st = g.modeState;
  // (Out of the blast, to see the result.)
  me.body.x = st.bomb.x + (st.bomb.x > 0 ? -900 : 900); g.moved(me);
  st.bomb.fuse = 60;
});
await page.waitForFunction(() => window.stickSoldiers.state.game.modeState.phase === 'over', null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(400);
const rmResult = await page.evaluate(() => window.stickSoldiers.state.game.modeState.result);
check(rmResult?.why === 'bomb' || rmResult?.why === 'elimination', `Remastered: the round ended with the bomb: ${JSON.stringify(rmResult)}`);
await page.screenshot({ path: `${outDir}/defuse-result-remastered.png` });
const drawn = await page.evaluate(() => {
  const src = document.querySelector('canvas'), c = document.createElement('canvas');
  c.width = 160; c.height = 90;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0, src.width, src.height, 0, 0, 160, 90);
  const d = g.getImageData(0, 0, 160, 90).data, seen = new Set();
  for (let k = 0; k < d.length; k += 4) seen.add(((d[k] >> 4) << 8) | ((d[k + 1] >> 4) << 4) | (d[k + 2] >> 4));
  return seen.size;
});
check(drawn > 40, `Remastered: the scene is drawn (${drawn} colours)`);

console.log(JSON.stringify({ map, goal, result, rmResult, errors }, null, 2));
await browser.close();
server.close();
await relay.close();
if (errors.length) process.exit(1);
