// The Settings screen: switching graphics mid-match (WebGL and back), the frame
// rate cap, the frame rate readout, the volume (here and in the game's menu), the
// dropdowns left alone while it's open, the crosshair's look, aiming down the sights,
// the camera, the developer menu's numbers, the skins, and everything being remembered next visit.
// Usage: node tests/browser/settings.mjs [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve } from '../../tools/serve.mjs';
import { startRelay } from '../../tools/relay.mjs';

const outDir = process.argv[2] || 'test-results';
fs.mkdirSync(outDir, { recursive: true });

const server = await serve(0);
const relay = await startRelay();
const url = `http://localhost:${server.address().port}/?game=original&relay=${encodeURIComponent(relay.url)}`;
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
// Settings has sections down the side: show one.
const tab = name => page.click(`#settings .set-tab[data-page="${name}"]`);

// 1. From the main menu.
await page.click('#openSettings');
expect(await visible('#settings'), 'settings open from the menu');
// A proper screen on a computer, not a narrow column: wide, with its sections down the side.
const panelSize = await page.evaluate(() => { const b = document.querySelector('#settings .panel').getBoundingClientRect(); return [b.width, b.height]; });
expect(panelSize[0] > 900 && panelSize[1] > 600, `settings fill the screen (${panelSize})`);
expect(await visible('#graphics') && !(await visible('#setFog')), 'one section at a time: Video first');
const autoLabel = await page.$eval('#graphics option[value=auto]', o => o.textContent);
expect(autoLabel === 'Auto (Canvas)', `auto says what it picks (${autoLabel})`);
expect(/canvas/i.test(await page.textContent('#graphicsNote')), 'note says it draws with the canvas');
expect(/refreshes \d+ times a second/.test(await page.textContent('#fpsNote')), 'note gives the screen refresh rate');
await page.screenshot({ path: `${outDir}/settings-menu.png` });
// Left open, the dropdowns aren't touched (changing an open dropdown's options closes it, losing the choice).
const rewrites = await page.evaluate(() => new Promise(res => {
  let n = 0;
  const obs = new MutationObserver(list => { n += list.length; });
  for (const id of ['graphics', 'fpsCap']) obs.observe(document.getElementById(id), { subtree: true, childList: true, characterData: true });
  setTimeout(() => { obs.disconnect(); res(n); }, 2000);
}));
expect(rewrites === 0, `the dropdowns were rewritten ${rewrites} times while the screen sat open`);
// Volume: 60% to start with (the game was a bit loud).
const vol0 = await page.evaluate(() => ({ slider: document.getElementById('setVolume').value, out: document.getElementById('setVolumeOut').textContent, level: window.stickSoldiers.audio.level }));
expect(vol0.slider === '60' && vol0.out === '60%' && Math.abs(vol0.level - 0.6) < 1e-9, `volume starts at 60% (${JSON.stringify(vol0)})`);
expect(await page.inputValue('#graphics') === 'canvas', 'draws with the canvas by default');
expect(await kind() === 'canvas', 'the canvas is in use');
// Experimental options: the same as the game setup's.
await tab('game');
expect(await visible('#setBotVision') && await visible('#setFog') && !(await visible('#graphics')), 'experimental options in settings, under Gameplay');
await page.selectOption('#setFog', 'on');
expect(await page.inputValue('#fog') === 'on', 'fog of war chosen in settings shows in the game setup');
await page.selectOption('#setFog', 'off');
// Bullet speed and time between shots are the original's: no sliders for them anywhere.
expect(await page.evaluate(() => ['bulletSpeed', 'fireDelay', 'setBulletSpeed', 'setFireDelay'].every(id => !document.getElementById(id))), 'no bullet speed or between-shots sliders');
// Sprint: hold (the default) or toggle.
await tab('controls');
expect(await page.inputValue('#sprintMode') === 'hold', 'sprint is hold-to-sprint by default');
await page.selectOption('#sprintMode', 'toggle');
expect(await page.evaluate(() => window.stickSoldiers.prefs.sprint) === 'toggle', 'sprint toggle chosen');
await page.selectOption('#sprintMode', 'hold');
// The panel is taller than the window: it scrolls, and its top isn't cut off.
const top = await page.evaluate(() => { const s = document.getElementById('settings'); s.scrollTop = 0; return s.querySelector('.panel').getBoundingClientRect().top; });
expect(top >= 0, `the top of settings shows (${top})`);
// The mouse: the system's own pointer as the crosshair, to start with.
expect(await page.inputValue('#pointerMode') === 'system', 'the mouse pointer: the system\'s, as the crosshair, to start with');
// Aiming down the sights (right click): slight to start with.
expect(await page.inputValue('#aimZoom') === 'slight', 'aim down sights: slight by default');
await page.selectOption('#aimZoom', 'more');
// The crosshair: its picture, on a light and a dark background, follows the settings.
await tab('crosshair');
const pixel = (x, y) => page.evaluate(([x, y]) => [...document.getElementById('xhPreview').getContext('2d').getImageData(x, y, 1, 1).data], [x, y]);
expect(await page.inputValue('#xhStyle') === 'crossDot' && await page.inputValue('#xhColor') === 'default', 'the crosshair starts as it was');
const dot0 = await pixel(120, 72);
expect(dot0[0] < 60 && dot0[1] < 60 && dot0[2] < 60, `the default crosshair is dark in the original (${dot0})`);
expect(!(await visible('#xhCustom')), 'no colour picker until Custom is chosen');
await page.selectOption('#xhColor', '#3dff5a');
const green = await pixel(120, 72), greenDark = await pixel(360, 72);
expect(green[1] > 200 && green[0] < 120 && greenDark[1] > 200, `green crosshair in the picture, on both backgrounds (${green} / ${greenDark})`);
await page.selectOption('#xhColor', 'custom');
expect(await visible('#xhCustom'), 'Custom shows the colour picker');
await page.$eval('#xhCustom', el => { el.value = '#ff00ff'; el.dispatchEvent(new Event('input', { bubbles: true })); });
const pink = await pixel(120, 72);
expect(pink[0] > 200 && pink[2] > 200 && pink[1] < 80, `custom colour (${pink})`);
const slide = (id, v) => page.$eval(id, (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
await page.selectOption('#xhStyle', 'circle');
await slide('#xhSize', 12); await slide('#xhThickness', 3); await slide('#xhGap', 2); await slide('#xhOpacity', 80);
expect(await page.textContent('#xhThicknessOut') === '3' && await page.textContent('#xhOpacityOut') === '80%', 'the sliders show their values');
const ring = await pixel(120 + 2 * 8, 72), middle = await pixel(120, 72);
expect(ring[0] > 150 && ring[2] > 150 && !(middle[0] > 150 && middle[1] < 80), `a circle, nothing in the middle (${ring} / ${middle})`);
const xh = await page.evaluate(() => ({ ...window.stickSoldiers.prefs.crosshair }));
expect(xh.style === 'circle' && xh.color === 'custom' && xh.custom === '#ff00ff' && xh.size === 12 && xh.thickness === 3 && xh.gap === 2 && xh.opacity === 80, `crosshair settings kept (${JSON.stringify(xh)})`);
await page.screenshot({ path: `${outDir}/settings-crosshair.png` });
// The camera: how far the view leans toward the mouse, how long it glides after the mouse, how
// long it takes to catch up with you. As it was to start with.
const cam0 = await page.evaluate(() => ['camLook', 'camGlide', 'camFollow'].map(id => [document.getElementById(id).value, document.getElementById(`${id}Out`).textContent]));
expect(JSON.stringify(cam0) === JSON.stringify([['100', '100%'], ['0', 'Off'], ['330', '330 ms']]), `the camera starts as it was (${JSON.stringify(cam0)})`);
await slide('#camGlide', 120);
expect(await page.textContent('#camGlideOut') === '120 ms' && await page.evaluate(() => window.stickSoldiers.prefs.camera.glide) === 120, 'look smoothing set');
await page.keyboard.press('Escape');
expect(!(await visible('#settings')), 'Esc closes settings');

// 2. Mid-match, from the pause menu: switch to WebGL, and keep playing.
await page.evaluate(() => {
  const s = window.stickSoldiers.readMenu();
  // (No bots: nothing here needs them, and one killing the player mid-check makes it fail.)
  window.stickSoldiers.startMatch({ ...s, map: 'ssdm1.json', mode: 'ffa', bots: 0 });
});
await page.waitForFunction(() => window.stickSoldiers.state.me?.alive && window.stickSoldiers.state.game.tick > 60, null, { timeout: 20000 });
const shotOptions = await page.evaluate(() => { const o = window.stickSoldiers.state.game.options; return [o.bulletSpeed, o.fireDelay]; });
// The system's pointer is the crosshair (as set up above: the picture changes with the settings).
const ptrA = await page.evaluate(() => window.stickSoldiers.renderer.canvas.style.cursor);
expect(/url\(/.test(ptrA) && ptrA.endsWith('crosshair'), `the system's pointer is the crosshair (${ptrA.slice(0, 40)})`);
expect(shotOptions[0] === 1 && shotOptions[1] === 1, `bullets and time between shots as in the original (${shotOptions})`);
// The view leans toward the mouse (Settings: Camera)...
const camAt = async x => { await page.mouse.move(x, 350); await page.waitForTimeout(400); return page.evaluate(() => window.stickSoldiers.renderer.cam.x); };
const lean = (await camAt(1050)) - (await camAt(50));
await page.keyboard.press('Escape');
await page.click('#pauseSettings');
await tab('video');
await page.selectOption('#graphics', 'webgl');
await page.waitForFunction(() => window.stickSoldiers.renderer.kind === 'webgl', null, { timeout: 15000 });
// (...and with Look toward the mouse at 0, it doesn't: below.)
await slide('#camLook', 0);
expect(await page.evaluate(() => document.querySelectorAll('canvas#game').length === 1 && document.querySelector('canvas#game') === window.stickSoldiers.renderer.canvas), 'one game canvas, the new one');
await page.click('#settingsDone');
await page.keyboard.press('Escape'); // resume
await page.waitForFunction(() => !window.stickSoldiers.state.menuOpen);
const leanOff = (await camAt(1050)) - (await camAt(50));
expect(lean > 20 && Math.abs(leanOff) < 1, `the view leans toward the mouse, and not at all with it set to 0, straight away (${lean.toFixed(1)}, ${leanOff.toFixed(1)})`);
// The mouse still aims (it's listening to the new canvas), and the keys still move.
const aimAt = async x => { await page.mouse.move(x, 350); await page.waitForTimeout(150); return page.evaluate(() => Math.cos(window.stickSoldiers.state.me.aim)); };
const right = await aimAt(1050), left = await aimAt(50);
expect(right > 0 && left < 0, `aiming follows the mouse after switching (${right.toFixed(2)}, ${left.toFixed(2)})`);
const x0 = await page.evaluate(() => window.stickSoldiers.state.me.x);
const zoomIdle = await page.evaluate(() => window.stickSoldiers.renderer.cam.zoom);
await page.keyboard.down('KeyD');
await page.mouse.down();
await page.waitForTimeout(800);
const zoomFiring = await page.evaluate(() => window.stickSoldiers.renderer.cam.zoom);
await page.mouse.up();
await page.keyboard.up('KeyD');
const x1 = await page.evaluate(() => window.stickSoldiers.state.me.x);
expect(Math.abs(x1 - x0) > 20, `still moves after switching (${x0} -> ${x1})`);
expect(zoomIdle === 1 && zoomFiring === 1, `firing doesn't zoom (${zoomIdle} -> ${zoomFiring})`);
// Aiming down the sights: hold right click with a gun (the pistol here).
await page.evaluate(() => { const me = window.stickSoldiers.state.me; me.current = 'Platinum'; });
await page.mouse.down({ button: 'right' });
await page.waitForTimeout(800);
const zoomSights = await page.evaluate(() => [window.stickSoldiers.renderer.cam.zoom, window.stickSoldiers.state.me.current]);
await page.mouse.up({ button: 'right' });
expect(Math.abs(zoomSights[0] - 1.2) < 0.02, `right click aims down the sights ("More": ${zoomSights})`);
await page.waitForTimeout(800);
expect(await page.evaluate(() => window.stickSoldiers.renderer.cam.zoom) === 1, 'and back out when you let go');
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
await tab('video');
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

// 5. The volume, from the game's menu: Settings shows the same.
await page.keyboard.press('Escape');
await page.$eval('#volume', el => { el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
const vol1 = await page.evaluate(() => ({ out: document.getElementById('volumeOut').textContent, other: document.getElementById('setVolume').value, level: window.stickSoldiers.audio.level }));
expect(vol1.out === '30%' && vol1.other === '30' && Math.abs(vol1.level - 0.3) < 1e-9, `the menu's volume slider (${JSON.stringify(vol1)})`);
await page.screenshot({ path: `${outDir}/settings-pause-volume.png` });

// 6. Choices are remembered next time.
await page.click('#pauseSettings');
await page.selectOption('#graphics', 'webgl');
await page.waitForFunction(() => window.stickSoldiers.renderer.kind === 'webgl', null, { timeout: 15000 });
await tab('game');
await page.uncheck('#showPing');
await page.reload();
await page.waitForFunction(() => window.stickSoldiers);
const saved = await page.evaluate(() => ({ kind: window.stickSoldiers.renderer.kind, prefs: { ...window.stickSoldiers.prefs } }));
expect(saved.kind === 'webgl' && saved.prefs.graphics === 'webgl', `graphics remembered (${saved.kind})`);
expect(saved.prefs.showFps === true && saved.prefs.showPing === false && saved.prefs.fpsCap === 'auto' && saved.prefs.volume === 30, `other settings remembered (${JSON.stringify(saved.prefs)})`);
expect(Math.abs(await page.evaluate(() => window.stickSoldiers.audio.level) - 0.3) < 1e-9, 'the volume remembered');
expect(saved.prefs.aimZoom === 'more' && saved.prefs.crosshair?.style === 'circle' && saved.prefs.crosshair?.custom === '#ff00ff', `zoom and crosshair remembered (${JSON.stringify(saved.prefs.crosshair)})`);
await page.click('#openSettings');
expect(await page.inputValue('#xhStyle') === 'circle' && await page.inputValue('#xhSize') === '12', 'and shown in settings');
await tab('crosshair');
await page.click('#xhReset');
expect(await page.evaluate(() => window.stickSoldiers.prefs.crosshair.style) === 'crossDot', 'Reset puts the crosshair back');
const cam1 = saved.prefs.camera;
expect(cam1?.look === 0 && cam1?.glide === 120 && cam1?.follow === 330, `the camera remembered (${JSON.stringify(cam1)})`);
expect(await page.inputValue('#camLook') === '0' && await page.inputValue('#camGlide') === '120', 'and shown in settings');
await tab('camera');
await page.click('#camReset');
const cam2 = await page.evaluate(() => ({ ...window.stickSoldiers.prefs.camera, out: document.getElementById('camGlideOut').textContent }));
expect(cam2.look === 100 && cam2.glide === 0 && cam2.follow === 330 && cam2.out === 'Off', `Reset puts the camera back (${JSON.stringify(cam2)})`);

// 7. Developer: the game's numbers. Run speed up to 5 (at full speed): saved, copied out, used
// in a match (at 75%: 3.75 a frame), and still there next visit.
await tab('dev');
const devRow = key => `#devMenu .dev-row[data-key="${key}"]`;
expect(await page.inputValue(`${devRow('PHYS.runSpeed')} input`) === '3.4', 'run speed starts at 3.4');
await page.fill(`${devRow('PHYS.runSpeed')} input`, '5');
await page.press(`${devRow('PHYS.runSpeed')} input`, 'Enter');
expect(await page.getAttribute(devRow('PHYS.runSpeed'), 'class').then(c => c.includes('changed')), 'the changed number is marked');
const exported = JSON.parse(await page.inputValue('#devMenu .dev-export'));
expect(exported.PHYS?.runSpeed === 5, `copied out (${JSON.stringify(exported)})`);
// Weapons: one gun at a time.
await page.click('#devMenu .dev-section[data-section="weapons"]');
await page.selectOption('#devMenu .dev-weapon-pick', 'M4');
await page.fill(`${devRow('WEAPONS.M4.damage')} input`, '30');
await page.press(`${devRow('WEAPONS.M4.damage')} input`, 'Enter');
expect(/M4 Carbine \(1 changed\)/.test(await page.textContent('#devMenu .dev-weapon-pick option[value="M4"]')), 'the gun is marked as changed');
// Search across everything.
await page.fill('#devMenu .dev-find', 'jetpack thrust');
const found = await page.$$eval('#devMenu .dev-row', rows => rows.map(r => r.dataset.key));
expect(found.length === 1 && found[0] === 'PHYS.jetAccel', `search finds it (${found})`);
await page.fill('#devMenu .dev-find', '');
// Paste numbers in.
await page.fill('#devMenu .dev-import', '{"RULES": {"respawnTicks": 60}, "NOPE": {"x": 1}}');
await page.click('#devMenu [data-import]');
expect(/Imported 1 number and 0 choices \(1 skipped/.test(await page.textContent('#devMenu .dev-msg')), `imported (${await page.textContent('#devMenu .dev-msg')})`);
await page.screenshot({ path: `${outDir}/settings-developer.png` });
// Settings & setup: the choices players make, as chosen here (marked where they're not the
// game's own), copied out with the numbers, pasted in (each checked: one that isn't a choice
// there is is skipped), and all put back.
await tab('controls');
await page.selectOption('#sprintMode', 'toggle');
await tab('dev');
await page.click('#devMenu .dev-section[data-section="choices"]');
const sprintRow = '#devMenu .dev-choice[data-choice="sprint"]';
expect(await page.getAttribute(sprintRow, 'class').then(c => c.includes('changed')) && (await page.textContent(`${sprintRow} .dev-value`)) === 'toggle', 'a changed choice is marked');
const withChoices = JSON.parse(await page.inputValue('#devMenu .dev-export'));
expect(withChoices.settings?.sprint === 'toggle' && withChoices.PHYS?.runSpeed === 5, `copied out with the numbers (${JSON.stringify(withChoices.settings)})`);
const everything = await page.evaluate(() => window.stickSoldiers.devExport?.(true));
expect(!everything || (everything.setup?.mode && everything.settings?.keys?.jump), 'Copy everything has every choice (every action\'s keys too)');
const graphicsBefore = await page.evaluate(() => window.stickSoldiers.prefs.graphics);
await page.fill('#devMenu .dev-import', JSON.stringify({ settings: { camera: { follow: 200, look: 80, glide: 50 }, graphics: 'potato' }, setup: { bots: 8, difficulty: 'hard', destruction: 'off' } }));
await page.click('#devMenu [data-import]');
const pasted = await page.evaluate(() => ({ camera: window.stickSoldiers.prefs.camera, menu: window.stickSoldiers.readMenu(), graphics: window.stickSoldiers.prefs.graphics, msg: document.querySelector('#devMenu .dev-msg').textContent }));
expect(pasted.camera.follow === 200 && pasted.camera.glide === 50 && pasted.menu.bots === 8 && pasted.menu.difficulty === 'hard' && pasted.menu.destruction === 'off',
  `choices pasted in are used (${JSON.stringify({ ...pasted, menu: undefined })})`);
expect(pasted.graphics === graphicsBefore && /0 numbers and 4 choices \(1 skipped: settings\.graphics/.test(pasted.msg), `one that isn't a choice there is is skipped (${pasted.msg})`);
page.once('dialog', d => d.accept());
await page.click('#devMenu [data-choices-reset]');
const back = await page.evaluate(() => ({ camera: window.stickSoldiers.prefs.camera, menu: window.stickSoldiers.readMenu(), sprint: window.stickSoldiers.prefs.sprint, exported: document.querySelector('#devMenu .dev-export').value }));
expect(back.camera.follow === 330 && back.menu.bots === 5 && back.menu.destruction === 'on' && back.sprint === 'hold' && !/"settings"|"setup"/.test(back.exported),
  `Put them all back (${JSON.stringify({ camera: back.camera, bots: back.menu.bots, sprint: back.sprint })})`);
await page.reload();
await page.waitForFunction(() => window.stickSoldiers);
await page.click('#openSettings');
await tab('dev');
expect(await page.inputValue(`${devRow('PHYS.runSpeed')} input`) === '5', 'remembered next visit');
await page.keyboard.press('Escape');
await page.evaluate(() => {
  const s = window.stickSoldiers.readMenu();
  window.stickSoldiers.startMatch({ ...s, map: 'ssdm1.json', mode: 'ffa', bots: 0 });
});
await page.waitForFunction(() => window.stickSoldiers.state.me?.alive && window.stickSoldiers.state.game.tick > 60, null, { timeout: 20000 });
await page.keyboard.down('KeyD');
const fastest = await page.evaluate(() => new Promise(res => {
  let top = 0; const t0 = performance.now();
  const tick = () => { top = Math.max(top, Math.abs(window.stickSoldiers.state.me.body.vx)); if (performance.now() - t0 > 900) res(top); else requestAnimationFrame(tick); };
  tick();
}));
await page.keyboard.up('KeyD');
expect(Math.abs(fastest - 3.75) < 0.05, `the match runs at the new speed (${fastest.toFixed(3)}; 3.75 expected)`);
// Reset everything (after asking).
await page.keyboard.press('Escape');
await page.click('#pauseSettings');
await tab('dev');
page.once('dialog', d => d.accept());
await page.click('#devMenu [data-reset-all]');
await page.waitForFunction(() => document.querySelector('#devMenu .dev-row[data-key="PHYS.runSpeed"] input')?.value === '3.4');
expect(await page.evaluate(() => localStorage.getItem('stick-soldiers-dev')) === null, 'nothing left to remember');

// 8. Character: the skins, each pictured. Picked mid-match, it's worn at once, and remembered.
await tab('character');
const cards = await page.$$eval('#skinCards .skin-card', bs => bs.map(b => [b.dataset.skin, b.getAttribute('aria-checked')]));
expect(cards.length === 7 && cards.find(c => c[0] === 'auto')[1] === 'true', `the skins, the game's own picked to start with (${JSON.stringify(cards)})`);
await page.click('#skinCards .skin-card[data-skin="ninja"]');
const worn = await page.evaluate(() => ({ pref: window.stickSoldiers.prefs.skin, me: window.stickSoldiers.state.me.skin, checked: document.querySelector('#skinCards [data-skin="ninja"]').getAttribute('aria-checked') }));
expect(worn.pref === 'ninja' && worn.me === 'ninja' && worn.checked === 'true', `the ninja, worn at once (${JSON.stringify(worn)})`);
const inked = await page.evaluate(() => {
  const c = document.getElementById('skinPreview'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let dark = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i] < 80 && d[i + 1] < 80 && d[i + 2] < 80) dark++;
  return dark;
});
expect(inked > 200, `the big picture shows the soldiers (${inked} dark pixels)`);
await page.screenshot({ path: `${outDir}/settings-character.png` });
await page.reload();
await page.waitForFunction(() => window.stickSoldiers);
expect(await page.evaluate(() => window.stickSoldiers.prefs.skin) === 'ninja', 'the skin remembered');

console.log(JSON.stringify({ autoLabel, rewrites, vol0, vol1, capped, full, hz, readout, saved, zoomIdle, zoomFiring, zoomSights, lean, leanOff, fastest, errors }, null, 2));
await browser.close();
server.close();
await relay.close();
if (errors.length) process.exit(1);
