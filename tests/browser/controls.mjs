// Keeping the controls in the game: while a match is played, the browser's own reactions
// to the mouse (with Shift or Ctrl held too) are blocked. To start with, the system's own
// pointer is the crosshair (a click doesn't lock the mouse). With "Locked to the game"
// chosen, a click locks the mouse to the game (the crosshair, drawn by the game, then moves
// by how far the mouse moves, kept on the screen), Esc or the browser freeing the mouse
// opens the menu (once), and menus let go of the mouse. And the menu's Full screen button works.
// And the keys (Settings, Controls): any action can be given another key or mouse button,
// which then does it (and the old one doesn't), and the menu's list of controls follows.
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
let st, pt;
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
    // Shortcuts: anything with Ctrl, Alt or Cmd held, Alt and F10 (the browser's menu), F7
    // (caret browsing) and / (Firefox's quick find).
    ...Object.fromEntries([
      ['ctrlShiftA', 'keydown', 'KeyA', { ctrlKey: true, shiftKey: true }], ['ctrlH', 'keydown', 'KeyH', { ctrlKey: true }],
      ['ctrlP', 'keydown', 'KeyP', { ctrlKey: true }], ['altBack', 'keydown', 'ArrowLeft', { altKey: true }],
      ['altDown', 'keydown', 'AltLeft', { altKey: true }], ['altUp', 'keyup', 'AltLeft', {}], ['f10Up', 'keyup', 'F10', {}],
      ['caretBrowsing', 'keydown', 'F7', {}], ['quickFind', 'keydown', 'Slash', {}],
    ].map(([what, type, code, o]) => [what, fire(body, new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...o }))])),
  };
});
for (const [what, ok] of Object.entries(blocked)) check(ok, `while playing, blocked: ${what}`);
// ...but not in a text box (online games' chat), where shortcuts are the text's.
const inChat = await page.evaluate(() => {
  const ev = new KeyboardEvent('keydown', { code: 'KeyH', ctrlKey: true, bubbles: true, cancelable: true });
  document.querySelector('#chatInput').dispatchEvent(ev);
  return ev.defaultPrevented;
});
check(!inChat, 'in a text box, shortcuts are left alone');
// (Let go of the mouse buttons pressed above.)
await page.mouse.up();

// 1b. To start with, the system's pointer is the crosshair: a click doesn't lock the mouse,
// the game's canvas shows a picture of the crosshair as its pointer, and the game draws just
// the reload ring round it, not a crosshair of its own.
const rings = () => page.evaluate(() => {
  const r = window.stickSoldiers.renderer, d = r.drawCrosshair.bind(r);
  window.ringOnly = [];
  r.drawCrosshair = (...a) => { window.ringOnly.push(!!a[4]); return d(...a); };
});
const pointer = () => page.evaluate(() => ({ css: window.stickSoldiers.renderer.canvas.style.cursor, ringOnly: [...new Set(window.ringOnly || [])] }));
await page.mouse.move(640, 360);
await page.mouse.down(); await page.mouse.up();
await rings();
await page.waitForTimeout(300);
st = await S();
pt = await pointer();
check(!st.locked && !st.menu, `to start with, a click doesn't lock the mouse: ${JSON.stringify(st)}`);
check(/^(-webkit-)?(image-set\(|url\()/.test(pt.css) && pt.css.endsWith('crosshair'), `the system's pointer is the crosshair (${pt.css.slice(0, 40)})`);
check(pt.ringOnly.length === 1 && pt.ringOnly[0] === true, `the game draws no crosshair of its own (${pt.ringOnly})`);
// Choose "Locked to the game" in Settings.
await page.keyboard.press('Escape');
await page.click('#pauseSettings');
await page.click('#settings .set-tab[data-page="crosshair"]');
check(await page.inputValue('#pointerMode') === 'system', 'the setting starts on the system pointer');
await page.selectOption('#pointerMode', 'locked');
await page.click('#settingsDone');
await page.click('#resume');

// 2. A click locks the mouse to the game; the crosshair moves by how far the mouse moves.
await page.mouse.move(640, 360);
await page.mouse.down(); await page.mouse.up();
await page.waitForFunction(() => window.stickSoldiers.input.locked, null, { timeout: 5000 }).catch(() => {});
st = await S();
check(st.locked && st.element === 'game', `a click locks the mouse to the game: ${JSON.stringify(st)}`);
await rings();
await page.waitForTimeout(200);
pt = await pointer();
check(pt.css === '' && pt.ringOnly.length === 1 && pt.ringOnly[0] === false, `locked, the game draws the crosshair (${JSON.stringify(pt)})`);
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

// 6. Settings: back to the system's pointer, a click doesn't lock it (the guards still work).
await page.click('#pauseSettings');
await page.waitForTimeout(100);
await page.click('#settings .set-tab[data-page="crosshair"]');
check(await page.inputValue('#pointerMode') === 'locked', 'the setting kept "Locked"');
await page.selectOption('#pointerMode', 'system');
await page.click('#settingsDone');
await page.click('#resume');
await page.waitForTimeout(150);
await page.mouse.move(640, 360);
await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(300);
st = await S();
check(!st.locked && !st.menu, `system pointer: a click doesn't lock the mouse: ${JSON.stringify(st)}`);
check(await page.evaluate(() => { const ev = new WheelEvent('wheel', { ctrlKey: true, bubbles: true, cancelable: true }); document.body.dispatchEvent(ev); return ev.defaultPrevented; }), 'system pointer: Ctrl + wheel still doesn\'t zoom');

// 7. Keys (Settings, Controls): jump on J, fire on L, the sledgehammer on the middle button.
await page.keyboard.press('Escape');
await page.click('#pauseSettings');
await page.click('#settings .set-tab[data-page="controls"]');
const keyButton = (id, at = 0) => `#keybinds .kb-row[data-action="${id}"] .kb-key[data-at="${at}"]`;
const saved = () => page.evaluate(() => JSON.parse(JSON.stringify(window.stickSoldiers.prefs.keys)));
check(await page.textContent(keyButton('jump')) === 'W', `jump starts on W (${await page.textContent(keyButton('jump'))})`);
// Esc while it waits for a key: the key stays as it was, and Settings stays open.
await page.click(keyButton('jump'));
check(/Press a key/.test(await page.textContent(keyButton('jump'))), 'clicking a key waits for the new one');
await page.keyboard.press('Escape');
check(await page.textContent(keyButton('jump')) === 'W' && await page.isVisible('#settings'), 'Esc keeps the key, and Settings open');
await page.click(keyButton('jump'));
await page.keyboard.press('KeyJ');
await page.click(keyButton('fire'));
await page.keyboard.press('KeyL');
await page.click(keyButton('melee'));
await page.mouse.down({ button: 'middle' }); await page.mouse.up({ button: 'middle' });
// A key taken from another action leaves it (and says so).
await page.click(keyButton('reload'));
await page.keyboard.press('KeyT');
const note = await page.textContent('#keybinds .kb-note');
const keys1 = await saved();
check(JSON.stringify(keys1.jump) === '["KeyJ","Space","ArrowUp"]' && JSON.stringify(keys1.fire) === '["KeyL"]' && JSON.stringify(keys1.melee) === '["Mouse1"]',
  `keys set and saved (${JSON.stringify(keys1)})`);
check(JSON.stringify(keys1.reload) === '["KeyT"]' && JSON.stringify(keys1.chat) === '["Enter"]' && /taken from Chat/.test(note), `T taken from chat (${note})`);
await page.screenshot({ path: `${outDir}/controls-keys.png` });
await page.click('#settingsDone');
await page.click('#resume');
await page.waitForFunction(() => !window.stickSoldiers.state.menuOpen);
// (Alive, and left alone by the bots while the keys are tried: spawn protection.)
await page.waitForFunction(() => window.stickSoldiers.state.me.alive, null, { timeout: 10000 });
await page.evaluate(() => { window.stickSoldiers.state.me.spawnProtect = 1e6; });
await page.waitForTimeout(300);
const me = () => page.evaluate(() => { const m = window.stickSoldiers.state.me; return { y: m.y, ground: m.body.onGround, cooldown: m.cooldown, current: m.current, alive: m.alive }; });
// W doesn't jump any more; J does. (The fastest the soldier goes up while the key's held: a
// jump takes off at several pixels an update, whatever's overhead.)
const upWhile = async (key, ms) => {
  await page.keyboard.down(key);
  const up = await page.evaluate(ms => new Promise(res => {
    const t0 = performance.now(); let up = 0;
    const tick = () => { up = Math.max(up, -window.stickSoldiers.state.me.body.vy); if (performance.now() - t0 > ms) res(up); else requestAnimationFrame(tick); };
    tick();
  }), ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(1200);
  return up;
};
const upW = await upWhile('KeyW', 500), upJ = await upWhile('KeyJ', 500);
check(upW < 1, `W no longer jumps (up at ${upW.toFixed(2)})`);
check(upJ > 4, `J jumps (up at ${upJ.toFixed(2)})`);
await page.waitForTimeout(800);
// A click doesn't fire any more; L does.
const firedWithin = ms => page.evaluate(ms => new Promise(res => {
  const t0 = performance.now();
  const tick = () => { if (window.stickSoldiers.state.me.cooldown > 0) res(true); else if (performance.now() - t0 > ms) res(false); else requestAnimationFrame(tick); };
  tick();
}), ms);
await page.mouse.move(900, 330);
await page.mouse.down(); const clickFired = await firedWithin(300); await page.mouse.up();
await page.waitForTimeout(300);
await page.keyboard.down('KeyL'); const keyFired = await firedWithin(500); await page.keyboard.up('KeyL');
check(!clickFired && keyFired, `fire moved from the left click to L (click ${clickFired}, L ${keyFired})`);
// The middle button takes out the sledgehammer.
await page.mouse.down({ button: 'middle' }); await page.mouse.up({ button: 'middle' });
await page.waitForTimeout(250);
check((await me()).current === 'Sledgehammer', `the middle button takes out the sledgehammer (${(await me()).current})`);
await page.keyboard.press('Escape');

// 7. Out of the match, nothing's blocked: the menus work as normal.
await page.click('#quit');
await page.waitForSelector('#menu:not(.hidden)');
const free = await page.evaluate(() => {
  const ev = new WheelEvent('wheel', { ctrlKey: true, bubbles: true, cancelable: true });
  document.body.dispatchEvent(ev);
  const menuEv = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  document.body.dispatchEvent(menuEv);
  const keyEv = new KeyboardEvent('keydown', { code: 'KeyH', ctrlKey: true, bubbles: true, cancelable: true });
  document.body.dispatchEvent(keyEv);
  return { zoom: !ev.defaultPrevented, menu: !menuEv.defaultPrevented, selecting: getComputedStyle(document.body).userSelect !== 'none', shortcuts: !keyEv.defaultPrevented };
});
for (const [what, ok] of Object.entries(free)) check(ok, `in the menus, the browser's own ${what} works`);
// The menu's list of controls shows the keys as they're set; Reset puts them all back.
const shown = await page.evaluate(() => ({ jump: document.querySelector('.controls [data-keys="jump"]').textContent, fire: document.querySelector('.controls [data-keys="fire"]').textContent }));
check(shown.jump === 'J or Space or ↑' && shown.fire === 'L', `the menu's controls follow the keys (${JSON.stringify(shown)})`);
await page.click('#openSettings');
await page.click('#settings .set-tab[data-page="controls"]');
await page.click('#keysReset');
const keys2 = await saved();
check(Object.keys(keys2).length === 0 && await page.textContent(keyButton('jump')) === 'W', `Reset all keys (${JSON.stringify(keys2)})`);
await page.keyboard.press('Escape');

// 8. Firefox opens its own menu on Shift + right click whatever a page does (unless the mouse is
// locked to it): the game lets go of everything held (what's let go of while the menu's open
// never reaches it), says once how to stop it, and Settings says so too. (Chromium, saying it's
// Firefox.)
const ff = await browser.newPage({ viewport: { width: 1280, height: 720 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0' });
ff.on('pageerror', e => errors.push(`firefox: ${e}`));
await ff.goto(url.replace('lock=on', 'lock=off'));
await ff.waitForFunction(() => window.stickSoldiers);
const ffNote = await ff.evaluate(() => getComputedStyle(document.querySelector('#settings .firefox-only')).display);
check(ffNote !== 'none' && await page.evaluate(() => getComputedStyle(document.querySelector('#settings .firefox-only')).display) === 'none', `Settings has a note for Firefox's players only (${ffNote})`);
await ff.evaluate(() => { const s = window.stickSoldiers.readMenu(); window.stickSoldiers.startMatch({ ...s, map: 'ssdm1.json', mode: 'ffa', bots: 0 }); });
await ff.waitForFunction(() => window.stickSoldiers.state.game && window.stickSoldiers.state.me.alive, null, { timeout: 15000 });
await ff.mouse.move(640, 360);
await ff.keyboard.down('KeyD');
await ff.keyboard.down('Shift');
await ff.waitForTimeout(100);
const before = await ff.evaluate(() => [...window.stickSoldiers.input.keys]);
await ff.mouse.down({ button: 'right' });
const after = await ff.evaluate(() => ({ keys: [...window.stickSoldiers.input.keys], right: window.stickSoldiers.input.mouse.right, toast: document.querySelector('#toast').classList.contains('hidden') ? '' : document.querySelector('#toast').textContent }));
await ff.mouse.up({ button: 'right' });
await ff.keyboard.up('Shift');
await ff.keyboard.up('KeyD');
check(before.includes('KeyD') && before.includes('Shift'), `keys held before (${before})`);
check(after.keys.length === 0 && !after.right, `Firefox's menu on Shift + right click: everything let go of (${JSON.stringify(after)})`);
check(/about:config/.test(after.toast) && /shift_suppresses_event/.test(after.toast), `and how to stop it (${after.toast.slice(0, 60)})`);
await ff.close();

console.log(JSON.stringify({ blocked, moved, errors }, null, 2));
await browser.close();
server.close();
await relay.close();
if (errors.length) process.exit(1);
