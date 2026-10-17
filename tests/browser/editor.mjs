// Drives the map maker in headless Chromium: builds a small map with the mouse
// and keyboard, checks it, test-plays it, and opens it from a share link.
// Usage: node tests/browser/editor.mjs [outDir]   (serves web/ itself on a free port)
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve } from '../../tools/serve.mjs';

const outDir = process.argv[2] || 'test-results';
fs.mkdirSync(outDir, { recursive: true });

const server = await serve(0);
const url = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
const expect = (ok, what) => { if (!ok) errors.push(what); };

function watch(page) {
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  return page;
}

const page = watch(await browser.newPage({ viewport: { width: 1400, height: 820 } }));
await page.goto(url);
await page.waitForSelector('.map-card');
await page.click('#openEditor');
await page.waitForSelector('#editor:not(.hidden)');
await page.waitForTimeout(300);

const box = await page.locator('#edCanvas').boundingBox();
// Page coordinates of a point on the map.
const at = async (wx, wy) => {
  const [sx, sy] = await page.evaluate(([x, y]) => window.stickSoldiers.editor.toScreen(x, y), [wx, wy]);
  return [box.x + sx, box.y + sy];
};
const drag = async (from, to) => {
  await page.mouse.move(...await at(...from));
  await page.mouse.down();
  await page.mouse.move(...await at(...to), { steps: 5 });
  await page.mouse.up();
};
const clickAt = async (wx, wy) => page.mouse.click(...await at(wx, wy));
const editorMap = () => page.evaluate(() => {
  const m = window.stickSoldiers.editor.map;
  return { name: m.name, platforms: m.platforms.map(p => ({ top: p.top, bounce: p.bounce })), spawns: m.spawns.map(s => s.team), items: m.items.map(i => i.weapon || i.type) };
});

// A new map starts with a floor and two spawns. Build on it.
await page.fill('#edName', 'Playwright Arena');
await page.click('#edCanvas');
await page.keyboard.press('KeyP');
await drag([-250, 60], [-100, 80]);
await drag([100, 60], [250, 80]);
await page.keyboard.press('KeyJ');
await drag([-24, 184], [24, 200]);
await page.keyboard.press('KeyS');
await clickAt(-180, 20);
await page.keyboard.press('Escape');
await page.keyboard.press('KeyS');
await page.click('#edProps label:has(input[name=toolTeam][value="2"])');
await clickAt(180, 20);
await page.keyboard.press('Escape');
await page.keyboard.press('KeyW');
await page.selectOption('#toolWeapon', 'Bazooka');
await clickAt(0, 150);
await page.keyboard.press('KeyH');
await clickAt(-300, 150);

const built = await editorMap();
expect(built.platforms.length === 4, `expected 4 platforms, got ${built.platforms.length}`);
expect(built.platforms.filter(p => p.bounce).length === 1, 'expected one jump pad');
expect(built.spawns.length === 4 && built.spawns.includes(1) && built.spawns.includes(2), `expected blue and red spawns, got ${built.spawns}`);
expect(built.items.includes('Bazooka') && built.items.includes('health'), `expected a bazooka and health, got ${built.items}`);

// Move the left ledge, then undo and redo.
await page.keyboard.press('KeyV');
const before = built.platforms[1].top;
await drag([-170, 70], [-170, 100]);
const moved = (await editorMap()).platforms[1].top;
await page.keyboard.press('Control+KeyZ');
const undone = (await editorMap()).platforms[1].top;
await page.keyboard.press('Control+KeyY');
const redone = (await editorMap()).platforms[1].top;
expect(moved !== before && undone === before && redone === moved, `move/undo/redo: ${before} -> ${moved} -> ${undone} -> ${redone}`);

await page.click('#edCheck');
await page.waitForTimeout(300);
const report = await page.$$eval('.ed-problem', els => els.map(e => e.textContent));
expect(report.length === 1 && report[0].startsWith('Looks good'), `map check: ${JSON.stringify(report)}`);
expect(await page.textContent('#edStatus') === 'Saved', 'the map should autosave');
await page.screenshot({ path: `${outDir}/editor.png` });

// Test play, then back to the map maker and out to the menu.
await page.click('#edTest');
await page.waitForFunction(() => window.stickSoldiers.state.game && window.stickSoldiers.state.me.alive, null, { timeout: 15000 });
await page.waitForTimeout(2500);
const playing = await page.evaluate(() => ({ map: window.stickSoldiers.state.game.map.name, tick: window.stickSoldiers.state.game.tick }));
expect(playing.map === 'Playwright Arena' && playing.tick > 60, `test play: ${JSON.stringify(playing)}`);
await page.screenshot({ path: `${outDir}/editor-testplay.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
expect(await page.isVisible('#toEditor'), 'pause menu should offer "Back to map maker"');
await page.click('#toEditor');
await page.waitForSelector('#editor:not(.hidden)');
await page.click('#edBack');
await page.waitForSelector('#menu:not(.hidden)');
const cards = await page.$$eval('.map-card span', els => els.map(e => e.textContent));
expect(cards.includes('Playwright Arena'), 'the new map should be listed in the menu');

// Share links: opening one in a fresh browser adds the map and selects it...
const link = await page.evaluate(async () => {
  const { encodeShare } = await import('./src/custommaps.js');
  return encodeShare(window.stickSoldiers.editor.map);
});
const friend = watch(await (await browser.newContext({ viewport: { width: 1400, height: 820 } })).newPage());
await friend.goto(`${url}#map=${link}`);
await friend.waitForSelector('.map-card');
await friend.waitForTimeout(300);
const shared = {
  toast: await friend.textContent('#toast'),
  selected: await friend.$eval('.map-card[aria-checked="true"] span', e => e.textContent),
  hash: await friend.evaluate(() => location.hash),
};
expect(shared.toast.startsWith('Added to your maps: "Playwright Arena"'), `share link toast: ${shared.toast}`);
expect(shared.selected === 'Playwright Arena', `share link should select the map, selected ${shared.selected}`);
expect(shared.hash === '', 'the share code should be removed from the address bar');
await friend.screenshot({ path: `${outDir}/menu-shared.png` });

// ...pasting a link into a tab that's already open works too, and the same link twice doesn't duplicate it.
await friend.evaluate(l => { location.hash = 'map=' + l; }, link);
await friend.waitForFunction(() => document.querySelector('#toast').textContent.startsWith('Already'), null, { timeout: 5000 }).catch(() => {});
const again = { toast: await friend.textContent('#toast'), copies: await friend.$$eval('.map-card span', els => els.filter(e => e.textContent === 'Playwright Arena').length) };
expect(again.toast.startsWith('Already in your maps'), `second open of the same link: ${again.toast}`);
expect(again.copies === 1, `expected one copy of the shared map, got ${again.copies}`);
await friend.evaluate(() => { location.hash = 'map=not-a-real-map'; });
await friend.waitForFunction(() => document.querySelector('#toast').textContent.startsWith("Couldn't"), null, { timeout: 5000 }).catch(() => {});
const broken = await friend.textContent('#toast');
expect(broken.startsWith("Couldn't open the shared map"), `broken link: ${broken}`);

console.log(JSON.stringify({ built, moves: { before, moved, undone, redone }, report, playing, shared, again, broken, errors }, null, 2));
await browser.close();
server.close();
if (errors.length) process.exit(1);
