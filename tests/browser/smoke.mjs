// Loads the game in headless Chromium, plays a bit, and saves screenshots.
// Usage: node tests/browser/smoke.mjs [outDir]   (serves web/ itself on a free port)
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve } from '../../tools/serve.mjs';

const outDir = process.argv[2] || 'test-results';
fs.mkdirSync(outDir, { recursive: true });

const server = await serve(0);
const url = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(url);
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
// Pause menu
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.screenshot({ path: `${outDir}/pause.png` });

console.log(JSON.stringify({ results, errors }, null, 2));
await browser.close();
server.close();
if (errors.length) process.exit(1);
