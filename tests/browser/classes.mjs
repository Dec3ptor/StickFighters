// Classes and progression in the browser: the Loadout screen, the setup's Classes
// option, playing with a kit (gadget, XP pop-ups), the class picker while dead and
// from the pause menu (without taking conquest-style spawn keys), and the XP summary.
// Usage: node tests/browser/classes.mjs [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve } from '../../tools/serve.mjs';
import { startRelay } from '../../tools/relay.mjs';

const outDir = process.argv[2] || 'test-results';
fs.mkdirSync(outDir, { recursive: true });

const server = await serve(0);
const relay = await startRelay();
const url = `http://localhost:${server.address().port}/?relay=${encodeURIComponent(relay.url)}`;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
const expect = (ok, what) => { if (!ok) errors.push(what); };
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

// A profile with a little progress: assault class rank 1 (the shotgun) and 5 M4 kills (steady grip).
await page.addInitScript(() => {
  if (localStorage.getItem('stick-soldiers-profile')) return;
  localStorage.setItem('stick-soldiers-profile', JSON.stringify({ v: 1, xp: 2600, classXp: { assault: 1600 }, kills: { M4: 5 }, cls: 'assault' }));
});
await page.goto(url);
await page.waitForFunction(() => window.stickSoldiers);
const visible = sel => page.isVisible(sel);
const profile = () => page.evaluate(() => JSON.parse(JSON.stringify(window.stickSoldiers.profile)));

// 1. The Loadout screen, from the main menu.
await page.click('#openLoadout');
expect(await visible('#loadout'), 'loadout screen opens');
expect(await page.locator('.lo-class').count() === 4, 'four classes');
expect(/Rank 2 · Private First Class/.test(await page.textContent('.lo-top')), `overall rank shown (${await page.textContent('.lo-top b')})`);
const assaultMains = await page.$$eval('select[data-main=assault] option', os => os.map(o => [o.value, o.disabled]));
expect(JSON.stringify(assaultMains) === JSON.stringify([['M4', false], ['Shotgun', false], ['Uzi', true]]), `assault mains: shotgun unlocked, uzi not (${JSON.stringify(assaultMains)})`);
const m4Ups = await page.$$eval('select[data-up="assault:M4"] option', os => os.map(o => [o.value, o.disabled]));
expect(m4Ups.find(([v]) => v === 'steady')?.[1] === false && m4Ups.find(([v]) => v === 'extmag')?.[1] === true, `M4: steady grip unlocked, extended mag locked (${JSON.stringify(m4Ups)})`);
await page.selectOption('select[data-up="assault:M4"]', 'steady');
await page.check('input[name=loClass][value=recon]');
await page.screenshot({ path: `${outDir}/classes-loadout.png` });
let p = await profile();
expect(p.loadouts.assault.ups.M4 === 'steady', 'upgrade chosen');
expect(p.cls === 'recon', 'class chosen');
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('stick-soldiers-profile')));
expect(saved.loadouts.assault.ups.M4 === 'steady' && saved.cls === 'recon', 'saved in its own place');
expect(!JSON.parse(await page.evaluate(() => localStorage.getItem('stick-soldiers') || '{}')).loadouts, 'not in the settings');
await page.selectOption('select[data-main=assault]', 'Shotgun');
expect((await profile()).loadouts.assault.main === 'Shotgun', 'main weapon chosen');
expect(!(await page.$('select[data-up="assault:M4"]')), 'the kit shows the shotgun now, not the M4');
await page.keyboard.press('Escape');
expect(!(await visible('#loadout')), 'Esc closes it');

// 2. The setup's Classes option: on for conquest and rush, off for the rest, not offered in gun game.
await page.click('#tabOffline');
await page.waitForSelector('.map-card');
const classesFor = async mode => {
  await page.selectOption('#mode', mode);
  return (await visible('#classesField')) ? await page.inputValue('#classes') : 'hidden';
};
const defaults = {};
for (const mode of ['ffa', 'team', 'gungame', 'oitc', 'koth', 'ctf', 'conquest', 'rush']) defaults[mode] = await classesFor(mode);
expect(JSON.stringify(defaults) === JSON.stringify({ ffa: 'off', team: 'off', gungame: 'hidden', oitc: 'hidden', koth: 'off', ctf: 'off', conquest: 'on', rush: 'on' }), `Classes defaults: ${JSON.stringify(defaults)}`);
expect(await page.inputValue('#playClass') === 'recon', 'your class shows the profile\'s');
await page.selectOption('#mode', 'team');
await page.selectOption('#classes', 'on');
expect(await visible('#classField'), 'class choice shown with classes on');
await page.selectOption('#mode', 'ffa');
await page.selectOption('#mode', 'team');
expect(await page.inputValue('#classes') === 'on', 'the choice is remembered for the mode');
await page.screenshot({ path: `${outDir}/classes-setup.png` });

// 3. Play: team deathmatch with classes on, as recon.
await page.evaluate(() => {
  const s = window.stickSoldiers.readMenu();
  window.stickSoldiers.startMatch({ ...s, map: 'ssteam1.json', mode: 'team', bots: 3, fragLimit: 50 });
});
await page.waitForFunction(() => window.stickSoldiers.state.me?.alive, null, { timeout: 20000 });
let me = await page.evaluate(() => { const m = window.stickSoldiers.state.me; return { cls: m.cls, weapons: Object.keys(m.weapons), current: m.current, on: window.stickSoldiers.state.game.classesOn }; });
expect(me.on && me.cls === 'recon' && me.current === 'SR', `spawned as recon with the sniper rifle (${JSON.stringify(me)})`);
expect(await page.evaluate(() => window.stickSoldiers.state.game.pickups.items.every(it => it.type !== 'weapon')), 'no weapons on the map');
// G places a spawn beacon.
await page.mouse.move(700, 380);
await page.waitForTimeout(300);
await page.keyboard.press('KeyG');
await page.waitForFunction(() => window.stickSoldiers.state.game.beacons.some(b => b.owner === window.stickSoldiers.state.me.id), null, { timeout: 3000 }).catch(() => {});
const beacon = await page.evaluate(() => { const { state } = window.stickSoldiers; const b = state.game.beacons.find(x => x.owner === state.me.id); return b && { key: `b:${b.id}`, deploy: state.me.deployAt }; });
expect(beacon && beacon.deploy === beacon.key, `G placed a beacon to spawn on (${JSON.stringify(beacon)})`);
// XP pop-up.
await page.evaluate(() => { const { state } = window.stickSoldiers; state.game.xp(state.me, 100, 'kill', 'SR'); });
await page.waitForFunction(() => window.stickSoldiers.state.xp?.total === 100, null, { timeout: 3000 }).catch(() => {});
expect(await page.evaluate(() => window.stickSoldiers.state.xp.showing().some(x => x.text === '+100 Kill')), 'XP pop-up');
await page.screenshot({ path: `${outDir}/classes-play.png` });

// 4. Die (hold K), then C opens the class picker; 2 picks engineer, without changing where you spawn.
await page.keyboard.down('KeyK');
await page.waitForFunction(() => !window.stickSoldiers.state.me.alive, null, { timeout: 4000 }).catch(() => {});
await page.keyboard.up('KeyK');
expect(!(await page.evaluate(() => window.stickSoldiers.state.me.alive)), 'self-destructed');
await page.keyboard.press('KeyC');
expect(await visible('#classPicker'), 'C opens the class picker while dead');
expect(await page.locator('.class-card').count() === 4, 'four class cards');
await page.waitForTimeout(400);
expect(!(await page.evaluate(() => window.stickSoldiers.state.me.alive)), 'the respawn waits while choosing');
await page.screenshot({ path: `${outDir}/classes-picker.png` });
await page.keyboard.press('Digit2');
expect(!(await visible('#classPicker')), 'picking closes it');
const after = await page.evaluate(() => ({ pick: window.stickSoldiers.state.me.pickCls, deploy: window.stickSoldiers.state.me.deployAt, cls: window.stickSoldiers.profile.cls }));
expect(after.pick === 'engineer' && after.cls === 'engineer', `2 picked engineer (${JSON.stringify(after)})`);
expect(after.deploy === beacon?.key, 'the number key didn\'t change where you spawn');
await page.waitForFunction(() => window.stickSoldiers.state.me.alive, null, { timeout: 8000 }).catch(() => {});
me = await page.evaluate(() => ({ cls: window.stickSoldiers.state.me.cls, weapons: Object.keys(window.stickSoldiers.state.me.weapons) }));
expect(me.cls === 'engineer' && me.weapons.includes('Bazooka') && me.weapons.includes('Mine'), `respawned as engineer (${JSON.stringify(me)})`);

// 5. From the pause menu.
await page.keyboard.press('Escape');
expect(await visible('#changeClass'), 'pause menu has Change class');
await page.click('#changeClass');
expect(await visible('#classPicker'), 'picker from the pause menu');
await page.click('.class-card[data-cls=support]');
expect(await page.evaluate(() => window.stickSoldiers.state.me.pickCls) === 'support', 'clicked support');
await page.keyboard.press('Escape');

// 6. Dead again: a click on "C to change" opens the picker.
await page.evaluate(() => { const { state } = window.stickSoldiers; state.game.kill(state.me, null, null); });
await page.waitForTimeout(200);
const box = await page.evaluate(() => window.stickSoldiers.renderer.classButton);
expect(box, 'the class box is drawn while dead');
if (box) {
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
  expect(await visible('#classPicker'), 'clicking it opens the picker');
  await page.click('#pickerClose');
}
await page.screenshot({ path: `${outDir}/classes-dead.png` });

// 7. The end of the match: an XP summary.
await page.evaluate(() => { const g = window.stickSoldiers.state.game; g.teamScore[1] = 999; g.checkWin(); });
await page.waitForSelector('#xpSummary:not(.hidden)', { timeout: 5000 }).catch(() => {});
const summary = await page.textContent('#xpSummary').catch(() => '');
expect(/Match XP/.test(summary) && /Match completed/.test(summary) && /Kill/.test(summary), `summary shown (${summary})`);
await page.screenshot({ path: `${outDir}/classes-summary.png` });
p = await profile();
expect(p.xp >= 2600 + 100 + 300, `XP saved (${p.xp})`);
await page.reload();
await page.waitForFunction(() => window.stickSoldiers);
const reloaded = await profile();
expect(reloaded.xp === p.xp && reloaded.cls === 'support', `profile kept on reload (${reloaded.xp}, ${reloaded.cls})`);

console.log(JSON.stringify({ defaults, beacon, after, summary: summary.slice(0, 200), xp: reloaded.xp, errors }, null, 2));
await browser.close();
server.close();
await relay.close();
if (errors.length) process.exit(1);
