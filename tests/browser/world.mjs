// World mode in the page: a world made from the Worlds tab (a name and a seed), played (dug
// into and built on, the inventory screen used), saved and quit from the menu, played again
// just as it was left, exported to a file and imported back, drawn by each renderer (the
// original on the canvas and with WebGL, and Remastered), and deleted.
// Usage: node tests/browser/world.mjs [outDir]
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
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
const errors = [];
const check = (ok, what) => { if (!ok) errors.push(what); };
const report = {};

async function open(query) {
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`${query}: ${e}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${query}: ${m.text()}`); });
  page.on('dialog', d => d.accept());
  await page.goto(`${base}&${query}`);
  await page.waitForFunction(() => window.stickSoldiers);
  return page;
}
const alive = page => page.waitForFunction(() => window.stickSoldiers.state.me?.alive && window.stickSoldiers.state.game?.world, null, { timeout: 30000 });
/**
 * Point the mouse at tile (dx, dy) from the one under the soldier's feet (again, until the game
 * says that's the tile aimed at: the camera looks a little toward the mouse as it moves).
 */
async function aimAt(page, dx, dy) {
  const want = await page.evaluate(([dx, dy]) => {
    const me = window.stickSoldiers.state.me;
    return { tx: Math.floor(me.x / 16) + dx, ty: Math.floor((me.y + 12) / 16) + dy };
  }, [dx, dy]);
  for (let i = 0; i < 12; i++) {
    const p = await page.evaluate(({ tx, ty }) => {
      const { renderer: r } = window.stickSoldiers, s = r.scale;
      return { x: r.w / 2 + (tx * 16 + 8 - r.cam.x) * s, y: r.h / 2 + (ty * 16 + 8 - r.cam.y) * s };
    }, want);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(60);
    const t = await page.evaluate(() => window.stickSoldiers.state.me.world.target);
    if (t && t.tx === want.tx && t.ty === want.ty) break;
  }
  return want;
}
const tileAt = (page, tx, ty) => page.evaluate(([tx, ty]) => window.stickSoldiers.state.game.world.tile(tx, ty), [tx, ty]);

// 1. A new world, from the Worlds tab.
const page = await open('game=original&renderer=canvas');
await page.click('#tabWorlds');
await page.waitForFunction(() => document.querySelector('#worldList').textContent.trim(), null, { timeout: 5000 }).catch(() => {});
check(/No worlds yet/.test(await page.textContent('#worldList')), 'no worlds to start with');
await page.fill('#worldName', 'Test world');
await page.fill('#worldSeed', 'stick');
await page.click('#newWorldForm button[type=submit]');
await alive(page);
await page.waitForTimeout(1200);
const started = await page.evaluate(() => {
  const { state, renderer } = window.stickSoldiers, g = state.game;
  return { mode: g.mode, name: g.world.name, seed: g.world.seed, pictures: renderer.worldView?.pics.size || 0, hotbar: state.me.world.inv.slots.slice(0, 10).map(s => s?.key) };
});
report.started = started;
check(started.mode === 'world' && started.name === 'Test world', `a world game (${JSON.stringify(started)})`);
check(started.pictures > 4, `its blocks drawn (${started.pictures} pictures)`);
check(started.hotbar[0] === 'pickaxe' && started.hotbar.includes('planks'), 'a new character\'s things');
await page.screenshot({ path: `${outDir}/world-start.png` });

// 2. Dig the block under your feet (the pickaxe: 1), then build a plank beside you (planks).
await page.keyboard.press('Digit1');
const dug = await aimAt(page, 0, 0);
const was = await tileAt(page, dug.tx, dug.ty);
await page.mouse.down();
await page.waitForFunction(([tx, ty]) => window.stickSoldiers.state.game.world.tile(tx, ty) === 0, [dug.tx, dug.ty], { timeout: 10000 }).catch(() => {});
await page.mouse.up();
await page.waitForTimeout(800);
const afterDig = await page.evaluate(() => window.stickSoldiers.state.me.world.inv.count('dirt'));
check(was !== 0 && (await tileAt(page, dug.tx, dug.ty)) === 0, `dug the block under the soldier (${was})`);
check(afterDig >= 1, `and picked up what it gave (${afterDig} dirt)`);
const plankSlot = await page.evaluate(() => window.stickSoldiers.state.me.world.inv.slots.findIndex(s => s?.key === 'planks'));
await page.keyboard.press(`Digit${(plankSlot + 1) % 10}`);
await page.waitForTimeout(100);
// (Standing in the hole now: two blocks over, on top of the ground.)
const put = await aimAt(page, 2, -2);
await page.mouse.down();
await page.waitForTimeout(80);
await page.mouse.up();
await page.waitForTimeout(200);
const plank = await tileAt(page, put.tx, put.ty);
const PLANKS = await page.evaluate(async () => (await import('./src/world/blocks.js')).BLOCK_BY_KEY.get('planks').id);
check(plank === PLANKS, `a plank built (${plank})`);
report.built = { at: [put.tx, put.ty], block: plank };

// 3. The inventory screen (I): a stack moved from the hotbar to the bag, and back.
await page.keyboard.press('KeyI');
await page.waitForSelector('#inventory:not(.hidden)');
const slots = await page.locator('#inventory .inv-slot').count();
check(slots === 40, `40 slots (${slots})`);
await page.click('#inventory .inv-slot[data-slot="9"]');
await page.click('#inventory .inv-slot[data-slot="39"]');
const moved = await page.evaluate(() => { const s = window.stickSoldiers.state.me.world.inv.slots; return [s[9]?.key ?? null, s[39]?.key ?? null]; });
await page.screenshot({ path: `${outDir}/world-inventory.png` });
await page.click('#inventory .inv-slot[data-slot="39"]', { modifiers: ['Shift'] });
const back = await page.evaluate(() => window.stickSoldiers.state.me.world.inv.slots[9]?.key ?? null);
check(moved[0] === null && moved[1] && back === moved[1], `moved to the bag and back (${JSON.stringify(moved)}, ${back})`);
await page.keyboard.press('KeyI');
check(await page.locator('#inventory').evaluate(el => el.classList.contains('hidden')), 'I closes it');

// 4. Save and quit (the menu), then play it again: just as it was left.
await page.keyboard.press('Escape');
await page.waitForSelector('#pause:not(.hidden)');
check((await page.textContent('#quit')) === 'Save and quit', 'the menu saves and quits');
check(await page.locator('#restart').evaluate(el => el.classList.contains('hidden')), 'no restarting a world');
const where = await page.evaluate(() => ({ x: Math.round(window.stickSoldiers.state.me.x), y: Math.round(window.stickSoldiers.state.me.y) }));
await page.click('#quit');
await page.waitForSelector('#menu:not(.hidden)');
await page.waitForSelector('#worldList .world-card');
check(/Test world/.test(await page.textContent('#worldList')) && /Seed/.test(await page.textContent('#worldList')), 'listed in the Worlds tab');
await page.click('#worldList .world-card button[data-act="play"]');
await alive(page);
await page.waitForTimeout(400);
const again = await page.evaluate(([dug, put]) => {
  const { state } = window.stickSoldiers, w = state.game.world;
  return { hole: w.tile(dug.tx, dug.ty), plank: w.tile(put.tx, put.ty), dirt: state.me.world.inv.count('dirt'), x: Math.round(state.me.x), y: Math.round(state.me.y) };
}, [dug, put]);
report.again = again;
check(again.hole === 0 && again.plank === plank, `the hole and the plank still there (${JSON.stringify(again)})`);
check(again.dirt === afterDig, 'your things kept');
check(Math.abs(again.x - where.x) < 2 && Math.abs(again.y - where.y) < 20, `back where you were (${JSON.stringify(where)} -> ${again.x},${again.y})`);
await page.keyboard.press('Escape');
await page.click('#quit');
await page.waitForSelector('#worldList .world-card');

// 5. Exported to a file, and imported again (a second world, its name made unique).
const [download] = await Promise.all([page.waitForEvent('download'), page.click('#worldList .world-card button[data-act="export"]')]);
const file = `${outDir}/${download.suggestedFilename()}`;
await download.saveAs(file);
check(/\.ssworld$/.test(file) && JSON.parse(fs.readFileSync(file, 'utf8')).kind === 'stick-soldiers-world', `a world file (${file})`);
await page.setInputFiles('#importWorldFile', file);
await page.waitForFunction(() => document.querySelectorAll('#worldList .world-card').length === 2, null, { timeout: 5000 }).catch(() => {});
check(/Test world \(2\)/.test(await page.textContent('#worldList')), 'imported as a second world');

// 6. Drawn by WebGL, and by Remastered (the same world, kept in this browser).
const others = {};
for (const q of ['game=original&renderer=webgl', 'game=remastered']) {
  const p = await open(q);
  await p.click('#tabWorlds');
  await p.waitForSelector('#worldList .world-card');
  await p.click('#worldList .world-card button[data-act="play"]');
  await alive(p);
  await p.waitForTimeout(1500);
  others[q] = await p.evaluate(() => {
    const { renderer, state } = window.stickSoldiers;
    return { kind: renderer.kind, pictures: renderer.worldView?.pics.size || 0, textures: renderer.worldTex?.size ?? null, theme: renderer.look?.theme?.id ?? null, world: state.game.world.name };
  });
  await p.screenshot({ path: `${outDir}/world-${q.includes('remastered') ? 'remastered' : 'webgl'}.png` });
  await p.keyboard.press('Escape');
  await p.click('#quit');
  await p.close();
}
report.others = others;
check(others['game=original&renderer=webgl'].kind === 'webgl' && others['game=original&renderer=webgl'].textures > 4, `WebGL draws it (${JSON.stringify(others['game=original&renderer=webgl'])})`);
check(others['game=remastered'].kind === 'remastered' && others['game=remastered'].pictures > 4 && others['game=remastered'].theme === 'meadow', `Remastered draws it, in the plains' scenery (${JSON.stringify(others['game=remastered'])})`);

// 7. Deleted.
await page.reload();
await page.waitForFunction(() => window.stickSoldiers);
await page.click('#tabWorlds');
await page.waitForSelector('#worldList .world-card');
const n0 = await page.locator('#worldList .world-card').count();
await page.click('#worldList .world-card button[data-act="delete"]');
await page.waitForFunction(n => document.querySelectorAll('#worldList .world-card').length === n - 1, n0, { timeout: 5000 }).catch(() => {});
check(await page.locator('#worldList .world-card').count() === n0 - 1, 'deleted');

console.log(JSON.stringify({ report, errors }, null, 2));
await browser.close();
server.close();
await relay.close();
if (errors.length) process.exit(1);
