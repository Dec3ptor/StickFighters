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

// Pause menu
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.screenshot({ path: `${outDir}/pause.png` });

console.log(JSON.stringify({ results, errors }, null, 2));
await browser.close();
server.close();
await relay.close();
if (errors.length) process.exit(1);
