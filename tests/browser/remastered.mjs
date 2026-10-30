// Stick Soldiers Remastered in a real browser, on the site as it's published (a copy
// stamped by tools/stamp.mjs): the game picker, switching between the two games,
// matches on maps in several looks (night, the foundry, a big team map), the Quality
// setting, and every module loading once, by its stamped address.
// Usage: node tests/browser/remastered.mjs [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampSite } from '../../tools/stamp.mjs';
import { startRelay } from '../../tools/relay.mjs';

const outDir = process.argv[2] || 'test-results';
fs.mkdirSync(outDir, { recursive: true });

// The site as CI publishes it.
const site = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-site-'));
fs.cpSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web'), site, { recursive: true });
const RELEASE = 'test1234';
stampSite(site, RELEASE);
process.env.WEB_ROOT = site;
const { serve } = await import('../../tools/serve.mjs');

const server = await serve(0);
const relay = await startRelay();
const origin = `http://localhost:${server.address().port}`;
const relayQ = `relay=${encodeURIComponent(relay.url)}`;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors = [];
const expect = (ok, what) => { if (!ok) errors.push(what); };
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
// Every module, by the address it was asked for.
const modules = new Map();
page.on('request', req => {
  const u = new URL(req.url());
  if (!u.pathname.endsWith('.js')) return;
  if (!modules.has(u.pathname)) modules.set(u.pathname, new Set());
  modules.get(u.pathname).add(u.search);
});

const S = () => page.evaluate(() => {
  const ss = window.stickSoldiers, r = ss.renderer;
  return { edition: ss.edition, kind: r.kind, quality: r.quality, auto: r.auto, game: document.documentElement.dataset.game, url: location.search, title: document.title, theme: r.look?.theme.id };
});
const visible = sel => page.isVisible(sel);
/** How many different colours a part of the screen has (a blank or one-colour picture has few). */
const colours = (sel, x = 0, y = 0, w = 1280, h = 720) => page.evaluate(([sel, x, y, w, h]) => {
  const src = document.querySelector(sel);
  const c = document.createElement('canvas');
  c.width = 160; c.height = 90;
  const g = c.getContext('2d');
  g.drawImage(src, x, y, Math.min(w, src.width - x), Math.min(h, src.height - y), 0, 0, 160, 90);
  const d = g.getImageData(0, 0, 160, 90).data, seen = new Set();
  for (let i = 0; i < d.length; i += 4) seen.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
  return seen.size;
}, [sel, x, y, w, h]);

// 1. The plain address: the picker, both games on it.
await page.goto(`${origin}/?${relayQ}`);
await page.waitForFunction(() => window.stickSoldiers);
expect(await visible('#gamePicker'), 'the game picker shows at the plain address');
await page.waitForTimeout(300);
const ogArt = await colours('[data-edition="original"] canvas'), rmArt = await colours('[data-edition="remastered"] canvas');
expect(ogArt >= 2 && rmArt > 40, `both pictures on the picker are drawn (${ogArt} and ${rmArt} colours)`);
await page.screenshot({ path: `${outDir}/rm-picker.png` });

// 2. Pick Remastered.
await page.click('[data-edition="remastered"]');
await page.waitForFunction(() => window.stickSoldiers.renderer.kind === 'remastered');
let st = await S();
expect(st.edition === 'remastered' && st.game === 'remastered' && /game=remastered/.test(st.url), `Remastered picked: ${JSON.stringify(st)}`);
expect(st.title === 'Stick Soldiers Remastered', `the tab says Remastered (${st.title})`);
expect(!(await visible('#gamePicker')) && await visible('#menu'), 'the picker closes onto the menu');
await page.waitForTimeout(600);
expect(await colours('#game') > 30, 'scenery behind the menu');
await page.screenshot({ path: `${outDir}/rm-menu.png` });

// 3. Settings: Quality (not Graphics) for Remastered.
await page.click('#openSettings');
expect(await visible('#quality') && !(await visible('#graphics')), 'Settings has Quality, not Graphics');
expect(await page.inputValue('#quality') === 'auto' && st.auto, 'quality is Auto to start with');
await page.selectOption('#quality', 'medium');
st = await S();
expect(st.quality === 'medium' && !st.auto, `quality set to medium (${st.quality})`);
await page.selectOption('#quality', 'auto');
await page.keyboard.press('Escape');

// 4. Matches: run, jump and shoot, blow holes; the HUD on top.
const results = {};
const play = async (file, mode, bots, look) => {
  await page.evaluate(([file, mode, bots]) => {
    const s = window.stickSoldiers.readMenu();
    window.stickSoldiers.startMatch({ ...s, map: file, mode, bots, fragLimit: 99 });
  }, [file, mode, bots]);
  await page.waitForFunction(() => window.stickSoldiers.state.game && window.stickSoldiers.state.me.alive, null, { timeout: 30000 });
  await page.mouse.move(900, 330);
  await page.keyboard.down('KeyD');
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.keyboard.press('Space');
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.keyboard.up('KeyD');
  await page.evaluate(() => {
    const g = window.stickSoldiers.state.game, me = g.soldiers[0];
    const d = b => Math.hypot((b.l + b.r) / 2 - me.x, (b.t + b.b) / 2 - me.y);
    for (const b of g.map.solids.filter(b => !b.hard).sort((a, c) => d(a) - d(c)).slice(0, 2)) g.carve((b.l + b.r) / 2, (b.t + b.b) / 2, 30);
  });
  const t0 = await page.evaluate(() => window.stickSoldiers.state.game.tick);
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const ss = window.stickSoldiers, g = ss.state.game, r = ss.renderer;
    return { tick: g.tick, theme: r.look?.theme.id, quality: r.quality, hud: !!r.hudView, soldiers: g.soldiers.length };
  });
  expect(info.tick - t0 > 100, `${file}: the game runs (${info.tick - t0} updates)`);
  expect(info.theme === look, `${file}: drawn in the ${look} look (${info.theme})`);
  expect(info.hud, `${file}: the HUD is drawn in Remastered's style`);
  expect(await colours('#game') > 60, `${file}: a full picture`);
  await page.screenshot({ path: `${outDir}/rm-play-${file.replace('.json', '')}.png` });
  results[file] = info;
};
await play('ssdm1.json', 'ffa', 5, 'dusk');
await play('ssdm6.json', 'ffa', 5, 'night');
// Scores and the pause menu over Remastered.
await page.keyboard.down('Tab');
await page.waitForTimeout(150);
await page.screenshot({ path: `${outDir}/rm-scores.png` });
await page.keyboard.up('Tab');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
expect(await visible('#pause'), 'the pause menu opens');
await page.screenshot({ path: `${outDir}/rm-pause.png` });
await page.keyboard.press('Escape');
await play('foundry.json', 'conquest', 11, 'foundry');

// A map half in the original's look (the map maker's Look tool): those blocks on paper, the rest solid.
await page.evaluate(() => {
  const ss = window.stickSoldiers;
  const rec = ss.editor.createRecord({
    name: 'Half and half', theme: 'dusk', spawns: [{ x: -500, y: 176, team: 1 }, { x: 500, y: 176, team: 2 }], items: [],
    platforms: [{ left: -900, top: 200, right: -100, bottom: 260, look: 'classic' }, { left: -100, top: 200, right: 900, bottom: 260 }, { left: -600, top: 60, right: -380, bottom: 80, look: 'classic' }],
  });
  ss.startMatch({ ...ss.readMenu(), map: `custom:${rec.id}`, mode: 'ffa', bots: 1, fragLimit: 99 });
});
await page.waitForFunction(() => window.stickSoldiers.state.game?.map.name === 'Half and half' && window.stickSoldiers.state.me.alive, null, { timeout: 30000 });
await page.evaluate(() => { const me = window.stickSoldiers.state.me; me.body.x = me.prevX = -100; me.body.y = me.prevY = 199; me.spawnProtect = 1e6; });
await page.waitForTimeout(1200);
const halves = await page.evaluate(() => {
  const r = window.stickSoldiers.renderer, ctx = document.querySelector('#game').getContext('2d');
  // (A few pixels in a row on each side of where the two floors meet: there may be hatching on the paper.)
  const at = (x, y) => [...ctx.getImageData(Math.round(x * r.s + r.tx), Math.round(y * r.s + r.ty), 1, 1).data.slice(0, 3)];
  const row = x0 => Array.from({ length: 9 }, (_, i) => at(x0 + i * 2, 236));
  return { paper: row(-150), solid: row(-84), looks: window.stickSoldiers.state.game.map.looks };
});
const whiteish = c => Math.min(...c) > 232 && Math.max(...c) - Math.min(...c) < 12;
expect(halves.looks.classic && !halves.looks.remastered, `the map has blocks in the original's look: ${JSON.stringify(halves.looks)}`);
expect(halves.paper.some(whiteish) && !halves.solid.some(whiteish), `those on paper, the rest solid: ${JSON.stringify(halves)}`);
await page.screenshot({ path: `${outDir}/rm-half-and-half.png` });
results.halves = halves;

// 5. Low quality: flat colours, no lights or weather; still everything works.
await page.evaluate(() => { window.stickSoldiers.prefs.quality = 'low'; window.stickSoldiers.renderer.setQuality('low'); });
await page.waitForTimeout(800);
expect((await S()).quality === 'low', 'quality low');
await page.screenshot({ path: `${outDir}/rm-low.png` });
await page.evaluate(() => window.stickSoldiers.renderer.setQuality('auto'));

// 6. Back to the menu, and straight over to the original with the menu's button.
await page.evaluate(() => window.stickSoldiers.endMatch());
await page.waitForSelector('#menu:not(.hidden)');
expect(await page.textContent('#switchGame') === 'Play the original', 'the menu offers the original');
await page.click('#switchGame');
await page.waitForFunction(() => window.stickSoldiers.renderer.kind !== 'remastered');
st = await S();
expect(st.edition === 'original' && st.game === 'original' && /game=original/.test(st.url) && st.title === 'Stick Soldiers', `the original: ${JSON.stringify(st)}`);
expect(!(await visible('#gamePicker')) && await page.textContent('#switchGame') === 'Play Remastered', 'switched without the picker, and the button offers Remastered');
await page.screenshot({ path: `${outDir}/rm-back-to-original.png` });

// 7. Next visit (the plain address): straight into the game played last.
await page.goto(`${origin}/?${relayQ}`);
await page.waitForFunction(() => window.stickSoldiers?.renderer);
st = await S();
expect(!(await visible('#gamePicker')) && st.edition === 'original' && st.kind !== 'remastered', `the original, as played last: ${JSON.stringify(st)}`);
await page.click('#switchGame');
await page.waitForFunction(() => window.stickSoldiers.renderer.kind === 'remastered');
await page.goto(`${origin}/?${relayQ}`);
await page.waitForFunction(() => window.stickSoldiers?.renderer);
st = await S();
expect(!(await visible('#gamePicker')) && st.kind === 'remastered' && st.game === 'remastered', `Remastered, as played last: ${JSON.stringify(st)}`);
// A link to a map or a game without the game in it opens in the original. (A fresh page:
// only the # part changing would stay on the same page.)
await page.goto('about:blank');
await page.goto(`${origin}/?${relayQ}#map=not-a-real-map`);
await page.waitForFunction(() => window.stickSoldiers?.renderer);
st = await S();
expect(st.edition === 'original' && st.kind !== 'remastered' && !(await visible('#gamePicker')), `a map link opens in the original: ${JSON.stringify(st)}`);

// 8. /remastered/ goes straight to Remastered.
await page.goto(`${origin}/remastered/`);
await page.waitForFunction(() => window.stickSoldiers?.renderer?.kind === 'remastered', null, { timeout: 15000 });
expect(!(await visible('#gamePicker')), '/remastered/ skips the picker');

// 9. Every module loaded once, by its stamped address (vendor libraries aside).
for (const [file, queries] of modules) {
  if (file.includes('/vendor/')) continue;
  expect(queries.size === 1 && queries.has(`?v=${RELEASE}`), `${file} loaded as ${[...queries].join(', ') || 'unstamped'}`);
}
expect([...modules.keys()].some(f => f.endsWith('/rm/renderer.js')), 'Remastered\'s modules loaded');

const report = { results, modules: modules.size, errors };
fs.writeFileSync(`${outDir}/remastered.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
server.close();
relay.close();
fs.rmSync(site, { recursive: true, force: true });
if (errors.length) process.exit(1);
