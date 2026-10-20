// The Settings screen: switching graphics mid-match (WebGL and back), the frame
// rate cap, the frame rate readout, and everything being remembered next visit.
// Usage: node tests/browser/settings.mjs [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve } from '../../tools/serve.mjs';
import { startRelay } from '../../tools/relay.mjs';

const outDir = process.argv[2] || 'test-results';
fs.mkdirSync(outDir, { recursive: true });

const server = await serve(0);
const relay = await startRelay();
const url = `http://localhost:${server.address().port}/?relay=${encodeURIComponent(relay.url)}`;
const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  // (No graphics card here: WebGL runs in software, so "auto" means the canvas.)
  args: ['--enable-unsafe-swiftshader'],
});
const errors = [];
const expect = (ok, what) => { if (!ok) errors.push(what); };
const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForFunction(() => window.stickSoldiers);
const kind = () => page.evaluate(() => window.stickSoldiers.renderer.kind);
const visible = sel => page.isVisible(sel);

// 1. From the main menu.
await page.click('#openSettings');
expect(await visible('#settings'), 'settings open from the menu');
const autoLabel = await page.$eval('#graphics option[value=auto]', o => o.textContent);
expect(autoLabel === 'Auto (Canvas)', `auto says what it picks (${autoLabel})`);
expect(/canvas/i.test(await page.textContent('#graphicsNote')), 'note says it draws with the canvas');
expect(/refreshes \d+ times a second/.test(await page.textContent('#fpsNote')), 'note gives the screen refresh rate');
await page.screenshot({ path: `${outDir}/settings-menu.png` });
expect(await page.inputValue('#graphics') === 'canvas', 'draws with the canvas by default');
expect(await kind() === 'canvas', 'the canvas is in use');
// Experimental options: the same as the game setup's.
expect(await visible('#setBotVision') && await visible('#setFog'), 'experimental options in settings');
await page.selectOption('#setFog', 'on');
expect(await page.inputValue('#fog') === 'on', 'fog of war chosen in settings shows in the game setup');
await page.selectOption('#setFog', 'off');
await page.keyboard.press('Escape');
expect(!(await visible('#settings')), 'Esc closes settings');

// 2. Mid-match, from the pause menu: switch to WebGL, and keep playing.
await page.evaluate(() => {
  const s = window.stickSoldiers.readMenu();
  window.stickSoldiers.startMatch({ ...s, map: 'ssdm1.json', mode: 'ffa', bots: 3 });
});
await page.waitForFunction(() => window.stickSoldiers.state.me?.alive && window.stickSoldiers.state.game.tick > 60, null, { timeout: 20000 });
await page.keyboard.press('Escape');
await page.click('#pauseSettings');
await page.selectOption('#graphics', 'webgl');
await page.waitForFunction(() => window.stickSoldiers.renderer.kind === 'webgl', null, { timeout: 15000 });
expect(await page.evaluate(() => document.querySelectorAll('canvas#game').length === 1 && document.querySelector('canvas#game') === window.stickSoldiers.renderer.canvas), 'one game canvas, the new one');
await page.click('#settingsDone');
await page.keyboard.press('Escape'); // resume
await page.waitForFunction(() => !window.stickSoldiers.state.menuOpen);
// The mouse still aims (it's listening to the new canvas), and the keys still move.
const aimAt = async x => { await page.mouse.move(x, 350); await page.waitForTimeout(150); return page.evaluate(() => Math.cos(window.stickSoldiers.state.me.aim)); };
const right = await aimAt(1050), left = await aimAt(50);
expect(right > 0 && left < 0, `aiming follows the mouse after switching (${right.toFixed(2)}, ${left.toFixed(2)})`);
const x0 = await page.evaluate(() => window.stickSoldiers.state.me.x);
await page.keyboard.down('KeyD');
await page.mouse.down();
await page.waitForTimeout(800);
await page.mouse.up();
await page.keyboard.up('KeyD');
const x1 = await page.evaluate(() => window.stickSoldiers.state.me.x);
expect(Math.abs(x1 - x0) > 20, `still moves after switching (${x0} -> ${x1})`);
await page.screenshot({ path: `${outDir}/settings-webgl-match.png` });

// 3. Back to the canvas, then cap the frame rate at 30, and back to auto.
const drawsIn = async ms => page.evaluate(async ms => {
  const r = window.stickSoldiers.renderer;
  let n = 0;
  const present = r.present.bind(r);
  r.present = () => { n++; present(); };
  await new Promise(res => setTimeout(res, ms));
  r.present = present;
  return n;
}, ms);
await page.keyboard.press('Escape');
await page.click('#pauseSettings');
await page.selectOption('#graphics', 'canvas');
await page.waitForFunction(() => window.stickSoldiers.renderer.kind === 'canvas', null, { timeout: 15000 });
await page.selectOption('#fpsCap', '30');
await page.click('#settingsDone');
await page.keyboard.press('Escape');
const capped = await drawsIn(2000);
const hz = await page.evaluate(() => window.stickSoldiers.pacer.refresh);
expect(Math.abs(capped - 60) <= 8, `30 fps cap: ${capped} frames in 2 s (screen ${hz} Hz)`);
await page.keyboard.press('Escape');
await page.click('#pauseSettings');
await page.selectOption('#fpsCap', 'auto');
expect(/^Auto \(\d+ fps\)$/.test(await page.$eval('#fpsCap option[value=auto]', o => o.textContent)), 'auto shows the frame rate it uses');
// 4. Show the frame rate.
await page.check('#showFps');
await page.click('#settingsDone');
await page.keyboard.press('Escape');
const full = await drawsIn(2000);
expect(full > capped * 1.6, `auto draws at the screen rate again (${full} frames in 2 s)`);
const readout = await page.evaluate(() => window.stickSoldiers.perf.text);
expect(/^Canvas · \d+ fps · [\d.]+ ms drawing$/.test(readout || ''), `frame rate shown (${readout})`);
await page.screenshot({ path: `${outDir}/settings-fps.png` });

// 5. Choices are remembered next time.
await page.keyboard.press('Escape');
await page.click('#pauseSettings');
await page.selectOption('#graphics', 'webgl');
await page.waitForFunction(() => window.stickSoldiers.renderer.kind === 'webgl', null, { timeout: 15000 });
await page.uncheck('#showPing');
await page.reload();
await page.waitForFunction(() => window.stickSoldiers);
const saved = await page.evaluate(() => ({ kind: window.stickSoldiers.renderer.kind, prefs: { ...window.stickSoldiers.prefs } }));
expect(saved.kind === 'webgl' && saved.prefs.graphics === 'webgl', `graphics remembered (${saved.kind})`);
expect(saved.prefs.showFps === true && saved.prefs.showPing === false && saved.prefs.fpsCap === 'auto', `other settings remembered (${JSON.stringify(saved.prefs)})`);

console.log(JSON.stringify({ autoLabel, capped, full, hz, readout, saved, errors }, null, 2));
await browser.close();
server.close();
await relay.close();
if (errors.length) process.exit(1);
