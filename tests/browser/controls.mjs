// Keeping the controls in the game: while a match is played, the browser's own reactions
// to the mouse (with Shift or Ctrl held too) are blocked, a click locks the mouse to the
// game (the crosshair then moves by how far the mouse moves, kept on the screen), Esc or
// the browser freeing the mouse opens the menu (once), menus let go of the mouse, the
// setting turns locking off, and the menu's Full screen button works.
// Usage: node tests/browser/controls.mjs [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve } from '../../tools/serve.mjs';
import { startRelay } from '../../tools/relay.mjs';

const outDir = process.argv[2] || 'test-results';
fs.mkdirSync(outDir, { recursive: true });
const server = await serve(0);
const relay = await startRelay();
// (?lock=on: browsers driven by tests don't lock the mouse unless the address asks.)
const url = `http://localhost:${server.address().port}/?game=original&lock=on&relay=${encodeURIComponent(relay.url)}`;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const check = (ok, what) => { if (!ok) errors.push(what); };
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(url);
await page.waitForFunction(() => window.stickSoldiers);
await page.evaluate(() => {
  const s = window.stickSoldiers.readMenu();
  window.stickSoldiers.startMatch({ ...s, map: 'ssdm1.json', mode: 'ffa', bots: 2 });
});
await page.waitForFunction(() => window.stickSoldiers.state.game && window.stickSoldiers.state.me.alive, null, { timeout: 15000 });
const S = () => page.evaluate(() => {
  const { state, input } = window.stickSoldiers;
  return { menu: state.menuOpen, locked: input.locked, element: document.pointerLockElement?.id ?? null, x: input.mouse.x, y: input.mouse.y, left: input.mouse.left, playing: document.body.classList.contains('playing') };
});

// 1. The browser's own mouse actions, with Shift or Ctrl held too, are blocked while playing.
const blocked = await page.evaluate(() => {
  const canvas = document.querySelector('canvas#game'), body = document.body;
  const fire = (target, ev) => { target.dispatchEvent(ev); return ev.defaultPrevented; };
  const mouse = (type, o = {}) => new MouseEvent(type, { bubbles: true, cancelable: true, ...o });
  return {
    noSelecting: getComputedStyle(body).userSelect === 'none',
    ctrlWheelOnGame: fire(canvas, new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true })),
    ctrlWheelElsewhere: fire(body, new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true })),
    shiftWheel: fire(canvas, new WheelEvent('wheel', { deltaY: 120, shiftKey: true, bubbles: true, cancelable: true })),
    shiftRightClickMenu: fire(canvas, mouse('contextmenu', { button: 2, shiftKey: true })),
    ctrlClickMenu: fire(body, mouse('contextmenu', { button: 0, ctrlKey: true })),
    shiftClick: fire(canvas, mouse('mousedown', { button: 0, shiftKey: true })),
    ctrlClick: fire(canvas, mouse('mousedown', { button: 0, ctrlKey: true })),
    middleClick: fire(body, mouse('mousedown', { button: 1 })),
    middlePaste: fire(body, mouse('auxclick', { button: 1 })),
    backButton: fire(body, mouse('mouseup', { button: 3 })),
    forwardButton: fire(body, mouse('mousedown', { button: 4 })),
    selecting: fire(body, new Event('selectstart', { bubbles: true, cancelable: true })),
    dragging: fire(body, new Event('dragstart', { bubbles: true, cancelable: true })),
  };
});
for (const [what, ok] of Object.entries(blocked)) check(ok, `while playing, blocked: ${what}`);
// (Let go of the mouse buttons pressed above.)
await page.mouse.up();

// 2. A click locks the mouse to the game; the crosshair moves by how far the mouse moves.
await page.mouse.move(640, 360);
await page.mouse.down(); await page.mouse.up();
await page.waitForFunction(() => window.stickSoldiers.input.locked, null, { timeout: 5000 }).catch(() => {});
let st = await S();
check(st.locked && st.element === 'game', `a click locks the mouse to the game: ${JSON.stringify(st)}`);
await page.waitForTimeout(150);
const moved = await page.evaluate(() => {
  const { input } = window.stickSoldiers;
  input.mouse.x = 600; input.mouse.y = 300;
  window.dispatchEvent(new MouseEvent('mousemove', { movementX: 40, movementY: -25, bubbles: true }));
  const a = { x: input.mouse.x, y: input.mouse.y };
  window.dispatchEvent(new MouseEvent('mousemove', { movementX: 5000, movementY: 5000, bubbles: true }));
  return { a, b: { x: input.mouse.x, y: input.mouse.y }, w: input.canvas.clientWidth, h: input.canvas.clientHeight };
});
check(moved.a.x === 640 && moved.a.y === 275, `the crosshair moves with the mouse: ${JSON.stringify(moved.a)}`);
check(moved.b.x === moved.w && moved.b.y === moved.h, `and stays on the screen: ${JSON.stringify(moved)}`);
await page.evaluate(() => { const { input } = window.stickSoldiers; input.mouse.x = 900; input.mouse.y = 330; });
await page.mouse.down();
await page.waitForTimeout(100);
check((await S()).left, 'locked, the mouse button still fires');
await page.mouse.up();
await page.screenshot({ path: `${outDir}/controls-locked.png` });

// 3. Esc opens the menu and frees the mouse; the menu's Resume locks it again.
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
st = await S();
check(st.menu && !st.locked && st.element === null, `Esc: the menu, the mouse free: ${JSON.stringify(st)}`);
await page.click('#resume');
await page.waitForFunction(() => window.stickSoldiers.input.locked, null, { timeout: 5000 }).catch(() => {});
st = await S();
check(!st.menu && st.locked, `Resume: back to playing, the mouse locked again: ${JSON.stringify(st)}`);

// 4. The browser freeing the mouse (as its Esc does) opens the menu, once: the Esc key press
//    that comes with it doesn't close it again.
await page.evaluate(() => document.exitPointerLock());
await page.waitForFunction(() => window.stickSoldiers.state.menuOpen, null, { timeout: 3000 }).catch(() => {});
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
st = await S();
check(st.menu && !st.locked, `freed by the browser: the menu stays open: ${JSON.stringify(st)}`);
check(!st.playing, 'in the menu, the page is usable again (not "playing")');

// 5. Full screen from the menu, and back.
const fsOk = await page.evaluate(() => !!document.documentElement.requestFullscreen);
if (fsOk) {
  await page.click('#fullscreen');
  // (The button's label follows the browser's fullscreenchange event, a frame after the switch.)
  await page.waitForFunction(() => !!document.fullscreenElement && document.getElementById('fullscreen').textContent === 'Leave full screen', null, { timeout: 3000 }).catch(() => {});
  const on = await page.evaluate(() => ({ full: !!document.fullscreenElement, label: document.getElementById('fullscreen').textContent }));
  check(on.full && on.label === 'Leave full screen', `the menu's Full screen button: ${JSON.stringify(on)}`);
  await page.click('#fullscreen');
  await page.waitForFunction(() => !document.fullscreenElement && document.getElementById('fullscreen').textContent === 'Full screen', null, { timeout: 3000 }).catch(() => {});
  const off = await page.evaluate(() => ({ full: !!document.fullscreenElement, label: document.getElementById('fullscreen').textContent }));
  check(!off.full && off.label === 'Full screen', `and Leave full screen: ${JSON.stringify(off)}`);
}

// 6. Settings: with "Lock the mouse" off, a click doesn't lock it (the guards still work).
await page.click('#pauseSettings');
await page.waitForTimeout(100);
check(await page.isChecked('#lockMouse'), 'the setting is on to start with');
await page.uncheck('#lockMouse');
await page.click('#settingsDone');
await page.click('#resume');
await page.waitForTimeout(150);
await page.mouse.move(640, 360);
await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(300);
st = await S();
check(!st.locked && !st.menu, `lock off: a click doesn't lock the mouse: ${JSON.stringify(st)}`);
check(await page.evaluate(() => { const ev = new WheelEvent('wheel', { ctrlKey: true, bubbles: true, cancelable: true }); document.body.dispatchEvent(ev); return ev.defaultPrevented; }), 'lock off: Ctrl + wheel still doesn\'t zoom');
// (Back on, for the next visit.)
await page.keyboard.press('Escape');
await page.click('#pauseSettings');
await page.check('#lockMouse');
await page.click('#settingsDone');

// 7. Out of the match, nothing's blocked: the menus work as normal.
await page.click('#quit');
await page.waitForSelector('#menu:not(.hidden)');
const free = await page.evaluate(() => {
  const ev = new WheelEvent('wheel', { ctrlKey: true, bubbles: true, cancelable: true });
  document.body.dispatchEvent(ev);
  const menuEv = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  document.body.dispatchEvent(menuEv);
  return { zoom: !ev.defaultPrevented, menu: !menuEv.defaultPrevented, selecting: getComputedStyle(document.body).userSelect !== 'none' };
});
for (const [what, ok] of Object.entries(free)) check(ok, `in the menus, the browser's own ${what} works`);

console.log(JSON.stringify({ blocked, moved, errors }, null, 2));
await browser.close();
server.close();
await relay.close();
if (errors.length) process.exit(1);
