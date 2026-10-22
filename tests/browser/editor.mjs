// Drives the map maker in headless Chromium: builds a small map with the mouse
// and keyboard, checks it, test-plays it, and opens it from a share link.
// Usage: node tests/browser/editor.mjs [outDir]   (serves web/ itself on a free port)
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve } from '../../tools/serve.mjs';
import { startRelay } from '../../tools/relay.mjs';

const outDir = process.argv[2] || 'test-results';
fs.mkdirSync(outDir, { recursive: true });

const server = await serve(0);
// Online features talk to a local relay instead of the public ones.
const relay = await startRelay();
const url = `http://localhost:${server.address().port}/?game=original&relay=${encodeURIComponent(relay.url)}`;
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
// Wait for the game's script before clicking (on a slow machine the tabs aren't wired up yet).
await page.waitForFunction(() => window.stickSoldiers);
await page.click('#tabOffline');
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

// Indestructible platforms: drawn that way (the Platform tool's option), clicked with
// the Indestructible tool (I), or marked by dragging a box (Shift: unmarked).
const hardFlags = () => page.evaluate(() => window.stickSoldiers.editor.map.platforms.map(p => !!p.hard).join());
await page.keyboard.press('KeyP');
await page.check('#toolHard');
await drag([-56, 104], [56, 120]);
const drawnHard = await hardFlags();
expect(drawnHard === 'false,false,false,false,true', `drawn indestructible: ${drawnHard}`);
await page.uncheck('#toolHard');
await page.click('#selDel');
const ledge = await page.evaluate(() => { const p = window.stickSoldiers.editor.map.platforms[1]; return [(p.left + p.right) / 2, (p.top + p.bottom) / 2]; });
await page.keyboard.press('KeyI');
await clickAt(...ledge);
const clickedHard = await hardFlags();
await clickAt(...ledge);
const clickedBack = await hardFlags();
await drag([-290, 20], [290, 130]);
const boxHard = await hardFlags();
await page.keyboard.down('Shift');
await drag([-290, 20], [-40, 130]);
await page.keyboard.up('Shift');
const unmarked = await hardFlags();
await page.click('#hardAll');
const allHard = await hardFlags();
await page.keyboard.press('Control+KeyZ');
const hardUndone = await hardFlags();
const marking = { drawnHard, clickedHard, clickedBack, boxHard, unmarked, allHard, hardUndone };
expect(clickedHard === 'false,true,false,false' && clickedBack === 'false,false,false,false', `click to mark and unmark: ${JSON.stringify(marking)}`);
expect(boxHard === 'false,true,true,false' && unmarked === 'false,false,true,false', `box to mark, Shift-box to unmark: ${JSON.stringify(marking)}`);
expect(allHard === 'true,true,true,false' && hardUndone === unmarked, `all indestructible (not the jump pad), then undo: ${JSON.stringify(marking)}`);
await page.keyboard.press('KeyV');

// The map's look in Remastered (in the map's own settings, with nothing selected).
await page.evaluate(() => { const e = window.stickSoldiers.editor; e.sel = null; e.refreshPanel(); });
await page.selectOption('#mapTheme', 'arctic');
expect(await page.evaluate(() => window.stickSoldiers.editor.map.theme) === 'arctic', 'a look picked for Remastered');

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
const playing = await page.evaluate(() => {
  const g = window.stickSoldiers.state.game;
  return { map: g.map.name, tick: g.tick, destruction: !!g.options.destruction, saved: window.stickSoldiers.editor.record.data.platforms.map(p => !!p.hard).join(), theme: g.map.theme };
});
expect(playing.map === 'Playwright Arena' && playing.tick > 60, `test play: ${JSON.stringify(playing)}`);
expect(playing.theme === 'arctic', `the map's look goes with it (${playing.theme})`);
expect(playing.destruction && playing.saved === 'false,false,true,false', `played with Destruction on, the indestructible ledge saved: ${JSON.stringify(playing)}`);
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
const sharedTheme = await friend.evaluate(async () => (await import('./src/mapstore.js')).listMaps().find(m => m.name === 'Playwright Arena')?.data.theme);
expect(sharedTheme === 'arctic', `the share link keeps the map's look (${sharedTheme})`);
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

// Mirror editing and the spawn loadout, on a fresh map.
await page.bringToFront();
await page.click('#openEditor');
await page.waitForSelector('#editor:not(.hidden)');
await page.click('#edNew');
await page.waitForTimeout(200);
await page.click('#edCanvas');
await page.keyboard.press('KeyM');
await page.keyboard.press('KeyP');
await drag([-300, 40], [-200, 64]);
await page.keyboard.press('KeyH');
await clickAt(-250, 150);
const mirrored = await page.evaluate(() => {
  const e = window.stickSoldiers.editor, m = e.map;
  return { line: e.mirror.x, plats: m.platforms.map(p => [p.left, p.right]), items: m.items.map(i => [i.type, i.x]) };
});
expect(mirrored.line === 0, `mirror line in the middle (${mirrored.line})`);
const left = mirrored.plats.find(([l, r]) => r <= 0 && l > -400);
expect(left && mirrored.plats.some(([l, r]) => l === -left[1] && r === -left[0]), `platform mirrored: ${JSON.stringify(mirrored.plats)}`);
expect(mirrored.items.length === 2 && mirrored.items[0][1] === -mirrored.items[1][1] && mirrored.items[0][1] < 0, `pickup mirrored: ${JSON.stringify(mirrored.items)}`);
// Moving one side moves the other.
await page.keyboard.press('KeyV');
await drag([-250, 50], [-250, 10]);
const moved2 = await page.evaluate(() => window.stickSoldiers.editor.map.platforms.filter(p => p.right - p.left < 200).map(p => p.top));
expect(moved2.length === 2 && moved2[0] === moved2[1] && moved2[0] < 40, `both sides moved: ${moved2}`);
await page.screenshot({ path: `${outDir}/editor-mirror.png` });
// Marking a platform indestructible marks its twin too.
await page.keyboard.press('KeyI');
const small = await page.evaluate(() => window.stickSoldiers.editor.map.platforms.find(p => p.right - p.left < 200 && p.right <= 0));
await clickAt((small.left + small.right) / 2, (small.top + small.bottom) / 2);
const twinsHard = await page.evaluate(() => window.stickSoldiers.editor.map.platforms.map(p => !!p.hard).join());
expect(twinsHard === 'false,true,true', `both sides marked indestructible: ${twinsHard}`);
// Everyone spawns with an Uzi and full armour.
await page.keyboard.press('Escape');
await page.click('#loDetails summary');
await page.check('input[name=loWeapon][value=Uzi]');
await page.selectOption('#loArmour', '100');
await page.waitForTimeout(600);
const loadout = await page.evaluate(() => window.stickSoldiers.editor.record.data.loadout);
expect(loadout && loadout.weapons.includes('Uzi') && loadout.armour === 100, `loadout saved: ${JSON.stringify(loadout)}`);

// Objectives, with mirror editing still on: a flag for each team, a hill, capture points, an M-COM.
await page.click('#edCanvas');
await page.keyboard.press('KeyB');
await page.click('#edProps label:has(input[name=toolTeam][value="1"])');
await clickAt(-352, 150);
await page.keyboard.press('KeyL');
await drag([-64, 120], [64, 190]);
await page.keyboard.press('KeyC');
await clickAt(-250, 150);
await page.keyboard.press('KeyR');
await clickAt(150, 150);
await page.waitForTimeout(600);
const objectives = await page.evaluate(() => ({ editing: window.stickSoldiers.editor.map.objectives, saved: window.stickSoldiers.editor.record.data.objectives }));
const ob = type => objectives.editing.filter(o => o.type === type);
expect(ob('flag').length === 2 && ob('flag').some(f => f.team === 1 && f.x === -352 && f.y === 200) && ob('flag').some(f => f.team === 2 && f.x === 352), `flags, mirrored: ${JSON.stringify(ob('flag'))}`);
expect(ob('hill').length === 1 && ob('hill')[0].left === -64 && ob('hill')[0].right === 64 && ob('hill')[0].bottom === 200, `hill on the floor: ${JSON.stringify(ob('hill'))}`);
expect(ob('point').map(p => p.label).join() === 'A,B' && ob('point')[0].left === -ob('point')[1].right, `capture points, mirrored: ${JSON.stringify(ob('point'))}`);
expect(ob('mcom').length === 1 && ob('mcom')[0].sector === 1 && ob('mcom')[0].y === 200, `one M-COM (not mirrored): ${JSON.stringify(ob('mcom'))}`);
expect(objectives.saved?.length === 6, `objectives saved with the map: ${JSON.stringify(objectives.saved)}`);
await page.screenshot({ path: `${outDir}/editor-objectives.png` });
// Test play it as capture the flag.
await page.selectOption('#edMode', 'ctf');
await page.click('#edTest');
await page.waitForFunction(() => window.stickSoldiers.state.game?.mode === 'ctf' && window.stickSoldiers.state.me.alive, null, { timeout: 15000 });
await page.waitForTimeout(1500);
const ctf = await page.evaluate(() => { const g = window.stickSoldiers.state.game; return { mode: g.mode, flags: g.map.objectives.filter(o => o.type === 'flag').map(f => [f.team, f.x]).sort() }; });
expect(ctf.mode === 'ctf' && ctf.flags[0][1] === -352 && ctf.flags[1][1] === 352, `test play as CTF uses the map's flags: ${JSON.stringify(ctf)}`);
await page.screenshot({ path: `${outDir}/editor-ctf.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.click('#toEditor');
await page.waitForSelector('#editor:not(.hidden)');

// Upload it to the community maps, then find it in the menu's Community tab.
await page.fill('#edName', 'Mirror Test Arena');
await page.waitForTimeout(500);
await page.click('#edUpload');
await page.waitForFunction(() => /Uploaded/.test(document.querySelector('#edStatus').textContent), null, { timeout: 15000 }).catch(() => {});
const uploadStatus = await page.textContent('#edStatus');
expect(/Uploaded/.test(uploadStatus), `upload status: ${uploadStatus}`);
await page.click('#edBack');
await page.waitForSelector('#menu:not(.hidden)');
await page.click('#setup label:has(input[name=mapSource][value=community])');
await page.waitForSelector('.map-card:has-text("Mirror Test Arena")', { timeout: 10000 }).catch(() => {});
const communityCards = await page.$$eval('.map-card span', els => els.map(e => e.textContent));
expect(communityCards.includes('Mirror Test Arena'), `community tab lists the upload (${communityCards})`);
await page.screenshot({ path: `${outDir}/menu-community.png` });

console.log(JSON.stringify({ marking, objectives, ctf, uploadStatus, communityCards, mirrored, loadout, built, moves: { before, moved, undone, redone }, report, playing, shared, again, broken, errors }, null, 2));
await browser.close();
server.close();
await relay.close();
if (errors.length) process.exit(1);
