// Loads the game in headless Chromium, plays a bit, and saves screenshots.
// Usage: node tests/browser/smoke.mjs [outDir]   (serves web/ itself on a free port)
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve } from '../../tools/serve.mjs';
import { startRelay } from '../../tools/relay.mjs';

const outDir = process.argv[2] || 'test-results';
fs.mkdirSync(outDir, { recursive: true });

const server = await serve(0);
// Online features talk to a local relay instead of the public ones.
const relay = await startRelay();
const url = `http://localhost:${server.address().port}/?relay=${encodeURIComponent(relay.url)}`;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(url);
// Wait for the game's script before clicking (on a slow machine the tabs aren't wired up yet).
await page.waitForFunction(() => window.stickSoldiers);
await page.click('#tabOffline');
await page.waitForSelector('.map-card');
await page.screenshot({ path: `${outDir}/menu.png` });

const results = {};
for (const [file, mode] of (process.env.MAPS || 'ssdm1.json:ffa,ssteam1.json:team').split(',').map(x => x.split(':'))) {
  await page.evaluate(([file, mode]) => {
    const s = window.stickSoldiers.readMenu();
    window.stickSoldiers.startMatch({ ...s, map: file, mode, bots: 5 });
  }, [file, mode]);
  await page.waitForFunction(() => window.stickSoldiers.state.game && window.stickSoldiers.state.me.alive, null, { timeout: 15000 });
  // Play: run right, jump, shoot at the middle of the screen.
  await page.mouse.move(900, 330);
  await page.keyboard.down('KeyD');
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.keyboard.press('Space');
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyA');
  // Destructible maps (on by default): blow holes in the blocks nearest the player.
  const holes = await page.evaluate(() => {
    const g = window.stickSoldiers.state.game, me = g.soldiers[0];
    const d = b => Math.hypot((b.l + b.r) / 2 - me.x, (b.t + b.b) / 2 - me.y);
    for (const b of g.map.solids.filter(b => !b.hard).sort((a, c) => d(a) - d(c)).slice(0, 3)) g.carve((b.l + b.r) / 2, (b.t + b.b) / 2, 36);
    return g.carves.length;
  });
  if (!holes) errors.push(`no holes blown in ${file}`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${outDir}/play-${file.replace('.json', '')}.png` });
  results[file] = await page.evaluate(() => {
    const g = window.stickSoldiers.state.game;
    return { tick: g.tick, kills: g.stats.kills, soldiers: g.soldiers.length, shots: g.projectiles.length, me: { x: Math.round(g.soldiers[0].x), alive: g.soldiers[0].alive } };
  });
}
// Sounds: the original recordings load and decode once audio is unlocked by a click.
await page.mouse.click(640, 360);
await page.waitForFunction(() => window.stickSoldiers.audio.buffers.size >= 20, null, { timeout: 10000 });
const audio = await page.evaluate(() => ({ decoded: window.stickSoldiers.audio.buffers.size }));
// The game always updates 60 times a second; game speed slows the mechanics instead.
const speed = await page.evaluate(() => new Promise(res => {
  const g = window.stickSoldiers.state.game, t0 = g.tick, start = performance.now();
  setTimeout(() => res({ ticksPerSecond: Math.round((g.tick - t0) / ((performance.now() - start) / 1000)) }), 2000);
}));
if (Math.abs(speed.ticksPerSecond - 60) > 5) errors.push(`expected ~60 updates per second, got ${speed.ticksPerSecond}`);
results.audio = audio;
results.speed = speed;

const RULES_WAIT = 3500; // longer than a respawn takes

// Pause menu
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.screenshot({ path: `${outDir}/pause.png` });

// Spectate (from the menu): sit out and follow the others, switch with D, a free camera
// with Space, then join again.
const S = () => page.evaluate(() => {
  const { state } = window.stickSoldiers;
  return { spectating: !!state.me.spectating, alive: state.me.alive, follow: state.spec.id, free: state.spec.free, menu: state.menuOpen, deaths: state.me.deaths };
});
// (Spectating just after being hurt counts as a death for whoever hurt you: not that here.)
await page.evaluate(() => { window.stickSoldiers.state.me.lastHurtBy = null; });
const before = await S();
await page.click('#spectate');
await page.waitForTimeout(300);
let sp = await S();
if (!sp.spectating || sp.alive || sp.menu) errors.push(`Spectate: ${JSON.stringify(sp)}`);
if (sp.deaths !== before.deaths) errors.push('Spectate counted as a death');
if (sp.follow == null) errors.push('Spectate: not following anyone');
const first = sp.follow;
// (Read straight after the key: the one switched to may not live long, and then the camera goes back to the leader.)
const watchable = () => page.evaluate(() => window.stickSoldiers.state.game.soldiers.filter(s => s.alive && !s.spectating && s !== window.stickSoldiers.state.me).length);
const choices = await watchable();
await page.keyboard.press('KeyD');
sp = await S();
if (sp.follow === first && choices > 1) errors.push('Spectate: D didn\'t switch who to follow');
await page.waitForTimeout(150);
await page.screenshot({ path: `${outDir}/spectate.png` });
await page.keyboard.press('Space');
await page.keyboard.down('KeyD');
await page.waitForTimeout(400);
await page.keyboard.up('KeyD');
sp = await S();
if (!sp.free) errors.push('Spectate: Space didn\'t give a free camera');
await page.screenshot({ path: `${outDir}/spectate-free.png` });
await page.waitForTimeout(RULES_WAIT);
if ((await S()).alive) errors.push('Spectate: respawned while spectating');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const label = await page.textContent('#spectate');
if (label !== 'Join game') errors.push(`Spectate: the menu says "${label}", not "Join game"`);
await page.click('#spectate');
await page.waitForFunction(() => window.stickSoldiers.state.me.alive, null, { timeout: 8000 }).catch(() => {});
sp = await S();
if (!sp.alive || sp.spectating) errors.push(`Join game: ${JSON.stringify(sp)}`);
results.spectate = { first, label };
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// A huge battle, set up from the menu: 1,000 bots.
await page.click('#quit');
await page.waitForSelector('#menu:not(.hidden)');
await page.click('#tabOffline');
const steps = await page.$eval('#bots', el => +el.max);
await page.$eval('#bots', (el, v) => { el.value = v; el.dispatchEvent(new Event('input')); }, String(steps - 4)); // 1,000
const crowdLabel = await page.textContent('#botsOut');
if (crowdLabel !== '1000') errors.push(`bots slider shows ${crowdLabel}, expected 1000`);
if (!(await page.isVisible('#botsNote'))) errors.push('no slow-motion note for 1,000 bots');
await page.click('#play');
await page.waitForFunction(() => window.stickSoldiers.state.game?.soldiers.length === 1001, null, { timeout: 30000 });
await page.waitForTimeout(5000);
const crowd = await page.evaluate(() => {
  const g = window.stickSoldiers.state.game;
  return { soldiers: g.soldiers.length, alive: g.soldiers.filter(s => s.alive).length, tick: g.tick, kills: g.stats.kills };
});
if (crowd.tick < 60) errors.push(`1,000 bots: the game hardly moved (${crowd.tick} updates in 5 s)`);
if (crowd.alive < 300) errors.push(`1,000 bots: only ${crowd.alive} on the map`);
await page.keyboard.down('Tab');
await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}/crowd-1000.png` });
await page.keyboard.up('Tab');
results.crowd = crowd;

console.log(JSON.stringify({ results, errors }, null, 2));
await browser.close();
server.close();
await relay.close();
if (errors.length) process.exit(1);
