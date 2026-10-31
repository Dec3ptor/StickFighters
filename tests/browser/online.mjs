// Online play in real browsers: one page hosts, others join through the server
// browser and quick match. They find each other through a local Nostr relay and
// connect directly with WebRTC, exactly as on the live site.
// Usage: node tests/browser/online.mjs [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve } from '../../tools/serve.mjs';
import { startRelay } from '../../tools/relay.mjs';

const outDir = process.argv[2] || 'test-results';
fs.mkdirSync(outDir, { recursive: true });

const server = await serve(0);
// PUBLIC_RELAYS=1 uses the real public relays (as on the live site) instead of a local one.
const publicRelays = !!process.env.PUBLIC_RELAYS;
const relay = publicRelays ? null : await startRelay();
const url = `http://localhost:${server.address().port}/?game=original${relay ? `&relay=${encodeURIComponent(relay.url)}` : ''}`;
const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  // Use plain local addresses for WebRTC (headless browsers can't resolve the private .local names).
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
});
const errors = [];
const expect = (ok, what) => { if (!ok) errors.push(what); };

async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  page.on('dialog', d => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => window.stickSoldiers);
  await page.fill('#name', name);
  await page.dispatchEvent('#name', 'change');
  return page;
}
const S = page => page.evaluate(() => {
  const { state } = window.stickSoldiers;
  const g = state.game;
  return {
    mode: state.mode, playing: !!g, tick: g?.tick, over: g?.over,
    soldiers: g ? g.soldiers.map(s => ({ id: s.id, name: s.name, x: Math.round(s.x), y: Math.round(s.y), alive: s.alive, bot: s.isBot })) : [],
    me: state.me && { id: state.me.id, x: Math.round(state.me.x), alive: state.me.alive },
    chat: state.chat.map(c => c.text),
  };
});

// 1. Host a game.
const host = await player('Hosty');
await page_click(host, '#hostGame');
const GAME = `Playwright Party ${Math.random().toString(36).slice(2, 6)}`;
await host.fill('#gameName', GAME);
await host.selectOption('#mode', 'ffa');
await host.fill('#bots', '2');
await host.click('#play');
await host.waitForFunction(() => window.stickSoldiers.state.mode === 'host' && window.stickSoldiers.state.me?.alive, null, { timeout: 20000 });

// 2. Someone finds it in the server browser and joins.
const joiner = await player('Joiner');
const row = joiner.locator('.game-row', { hasText: GAME });
await row.waitFor({ timeout: publicRelays ? 40000 : 15000 });
const listed = await joiner.$$eval('.game-row b', els => els.map(e => e.textContent));
expect(listed.includes(GAME), `server browser lists the game (${listed})`);
await joiner.screenshot({ path: `${outDir}/online-browser.png` });
await row.locator('button').click();
await joiner.waitForFunction(() => window.stickSoldiers.state.mode === 'client' && window.stickSoldiers.state.game, null, { timeout: 30000 });
await joiner.waitForFunction(() => window.stickSoldiers.state.me?.alive, null, { timeout: 15000 });

// 3. Play: the joiner runs and shoots; both sides should see it.
await joiner.mouse.move(800, 300);
await joiner.keyboard.down('KeyD');
await joiner.mouse.down();
await joiner.waitForTimeout(1200);
await joiner.keyboard.up('KeyD');
await joiner.keyboard.down('KeyA');
await joiner.waitForTimeout(900);
await joiner.keyboard.up('KeyA');
await joiner.mouse.up();
await joiner.waitForTimeout(600);
const h1 = await S(host), j1 = await S(joiner);
const remote = h1.soldiers.find(s => s.name === 'Joiner');
expect(remote, 'host has the joiner\'s soldier');
expect(j1.soldiers.length === h1.soldiers.length, `same soldiers on both screens (${j1.soldiers.length} vs ${h1.soldiers.length})`);
expect(remote && Math.abs(remote.x - j1.me.x) < 60, `joiner is where the host thinks (${remote?.x} vs ${j1.me?.x})`);
// (The host stands still, but bots can knock them about, or kill them and they respawn,
// between one screen being read and the other: both read at once, a few times.)
let hostOnJoiner = null, hostX = h1.me.x;
for (let i = 0; i < 6; i++) {
  const [h, j] = await Promise.all([S(host), S(joiner)]);
  hostOnJoiner = j.soldiers.find(s => s.name === 'Hosty');
  hostX = h.me.x;
  if (hostOnJoiner && Math.abs(hostOnJoiner.x - hostX) < 60) break;
  await host.waitForTimeout(300);
}
expect(hostOnJoiner && Math.abs(hostOnJoiner.x - hostX) < 60, `host is where the joiner sees them (${hostOnJoiner?.x} vs ${hostX})`);
expect(h1.soldiers.filter(s => s.bot).length === 2, 'bots kept at 2 (room for players)');

// 4. Chat.
await joiner.keyboard.press('Enter');
await joiner.keyboard.type('gg no re');
await joiner.keyboard.press('Enter');
await host.waitForFunction(() => window.stickSoldiers.state.chat.some(c => c.text === 'gg no re'), null, { timeout: 5000 }).catch(() => {});
expect((await S(host)).chat.includes('gg no re'), 'host got the chat message');

await host.screenshot({ path: `${outDir}/online-host.png` });
await joiner.screenshot({ path: `${outDir}/online-joiner.png` });

// 4b. The host changes its numbers (run speed up to 5: 3.75 a frame at 75%), camera and aiming
// zoom mid-match: everyone in the game goes by them straight away, with their own kept.
await host.keyboard.press('Escape');
await host.click('#pauseSettings');
await host.click('#settings .set-tab[data-page="dev"]');
await host.fill('#devMenu .dev-row[data-key="PHYS.runSpeed"] input', '5');
await host.press('#devMenu .dev-row[data-key="PHYS.runSpeed"] input', 'Enter');
await host.click('#settings .set-tab[data-page="camera"]');
await host.$eval('#camLook', el => { el.value = '40'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
await host.click('#settings .set-tab[data-page="controls"]');
await host.selectOption('#aimZoom', 'more');
await host.click('#settingsDone');
await host.keyboard.press('Escape');
await joiner.waitForFunction(() => window.stickSoldiers.feelNow().camera.look === 40, null, { timeout: 5000 }).catch(() => {});
const feel = await joiner.evaluate(() => ({ ...window.stickSoldiers.feelNow(), own: window.stickSoldiers.prefs.camera.look, ownZoom: window.stickSoldiers.prefs.aimZoom }));
expect(feel.host && feel.camera.look === 40 && feel.aimZoom === 'more' && feel.own === 100 && feel.ownZoom === 'slight', `the joiner sees it with the host's camera and aiming zoom, theirs kept (${JSON.stringify(feel)})`);
// (The speed it runs at most often, on the ground: bots can knock it about now and then. Right,
// then left: one way may be into a wall.)
await joiner.bringToFront();
const runs = async page => {
  const counts = new Map();
  for (const key of ['KeyD', 'KeyA']) {
    await page.waitForFunction(() => window.stickSoldiers.state.me?.alive, null, { timeout: 10000 }).catch(() => {});
    await page.keyboard.down(key);
    const seen = await page.evaluate(() => new Promise(res => {
      const counts = {}, t0 = performance.now();
      const tick = () => {
        const b = window.stickSoldiers.state.me?.body;
        if (window.stickSoldiers.state.me?.alive && b?.onGround && Math.abs(b.vx) > 0.5) { const k = Math.abs(b.vx).toFixed(2); counts[k] = (counts[k] || 0) + 1; }
        if (performance.now() - t0 < 800) requestAnimationFrame(tick); else res(counts);
      };
      tick();
    }));
    await page.keyboard.up(key);
    for (const [k, n] of Object.entries(seen)) counts.set(k, (counts.get(k) || 0) + n);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
};
const joinerRuns = await runs(joiner);
expect(joinerRuns === '3.75', `the joiner runs at the host's new speed (${joinerRuns}; 3.75 expected)`);
// (Back as they were, for the rest.)
await host.bringToFront();
await host.keyboard.press('Escape');
await host.click('#pauseSettings');
await host.click('#settings .set-tab[data-page="dev"]');
await host.click('#devMenu .dev-row[data-key="PHYS.runSpeed"] .dev-reset');
await host.click('#settingsDone');
await host.keyboard.press('Escape');
await joiner.bringToFront();
await joiner.waitForTimeout(400);
const joinerRunsAgain = await runs(joiner);
expect(joinerRunsAgain === '2.55', `and back to the game's own when the host puts it back (${joinerRunsAgain}; 2.55 expected)`);

// 5. The host starts the next match: the joiner sees everyone again, bots included.
const firstTick = (await S(host)).tick;
await host.keyboard.press('Escape');
await host.click('#restart');
await host.waitForFunction(t => window.stickSoldiers.state.game && window.stickSoldiers.state.game.tick < t, firstTick, { timeout: 20000 });
await joiner.waitForTimeout(2500);
const h2 = await S(host), j2 = await S(joiner);
expect(h2.soldiers.filter(s => s.bot).length === 2, `host has its bots in the new match (${h2.soldiers.length})`);
expect(j2.soldiers.length === h2.soldiers.length, `joiner sees everyone in the new match (${j2.soldiers.map(s => s.name)} vs ${h2.soldiers.map(s => s.name)})`);
expect(j2.soldiers.filter(s => s.bot).length === 2, 'joiner sees the bots');
await joiner.screenshot({ path: `${outDir}/online-next-match.png` });

// 5b. An objective mode: the next match is conquest, and the joiner sees the points and tickets as the host does.
// (Classes are switched off for now: asking for them doesn't turn them on.)
await host.evaluate(() => { Object.assign(window.stickSoldiers.state.settings, { mode: 'conquest', classes: 'on' }); });
await host.keyboard.press('Escape');
await host.click('#restart');
await host.waitForFunction(() => window.stickSoldiers.state.game?.mode === 'conquest', null, { timeout: 20000 });
await joiner.waitForFunction(() => window.stickSoldiers.state.game?.mode === 'conquest' && window.stickSoldiers.state.game.modeState?.start > 0, null, { timeout: 20000 }).catch(() => {});
await joiner.waitForTimeout(1500);
const cq = await Promise.all([host, joiner].map(p => p.evaluate(() => {
  const g = window.stickSoldiers.state.game;
  return { mode: g.mode, team: window.stickSoldiers.state.me?.team, tickets: [g.teamScore[1], g.teamScore[2]], start: g.modeState?.start, points: g.modeState?.points?.length };
})));
expect(cq[1].mode === 'conquest' && cq[1].start === cq[0].start && cq[1].points === cq[0].points && cq[1].points >= 3, `joiner plays conquest with the host's points and tickets (${JSON.stringify(cq)})`);
expect(Math.abs(cq[1].tickets[0] - cq[0].tickets[0]) <= 3 && Math.abs(cq[1].tickets[1] - cq[0].tickets[1]) <= 3, `same tickets on both screens (${JSON.stringify(cq)})`);
expect(cq[0].team && cq[1].team && cq[0].team !== cq[1].team, `host and joiner on opposite teams (${cq[0].team}, ${cq[1].team})`);
await joiner.waitForFunction(() => window.stickSoldiers.state.me?.alive, null, { timeout: 10000 }).catch(() => {});
const classes = {
  host: await host.evaluate(() => window.stickSoldiers.state.game.classesOn),
  joiner: await joiner.evaluate(() => window.stickSoldiers.state.game.classesOn),
};
expect(!classes.host && !classes.joiner, `classes stay off for both (${JSON.stringify(classes)})`);
await joiner.screenshot({ path: `${outDir}/online-conquest.png` });

// Pings: the joiner measures theirs, and the host shares it for everyone's scoreboard.
await host.waitForFunction(() => Number.isFinite(window.stickSoldiers.state.game.soldiers.find(s => s.name === 'Joiner')?.ping), null, { timeout: 15000 }).catch(() => {});
const pings = {
  host: await host.evaluate(() => window.stickSoldiers.state.game.soldiers.find(s => s.name === 'Joiner')?.ping),
  joiner: await joiner.evaluate(() => window.stickSoldiers.state.me?.ping),
};
expect(Number.isFinite(pings.host), `host's scoreboard has the joiner's ping (${pings.host})`);
expect(Number.isFinite(pings.joiner), `joiner knows their ping (${pings.joiner})`);
await joiner.keyboard.down('Tab');
await joiner.waitForTimeout(200);
await joiner.screenshot({ path: `${outDir}/online-scores-ping.png` });
await joiner.keyboard.up('Tab');

// 6. Quick match finds the same game.
const third = await player('Quicky');
await third.click('#quickMatch');
await third.waitForFunction(() => window.stickSoldiers.state.mode === 'client' && window.stickSoldiers.state.game, null, { timeout: 30000 }).catch(() => {});
const t1 = await S(third);
expect(t1.mode === 'client', `quick match joined the open game (mode ${t1.mode})`);
await third.waitForTimeout(1500);
// (On the public relays quick match may pick someone else's game, so only check this locally.)
if (!publicRelays) expect((await S(host)).soldiers.some(s => s.name === 'Quicky'), 'host sees the quick-match player');

// 7. The host ends the game: everyone is told and goes back to the menu.
await host.keyboard.press('Escape');
await host.click('#quit');
await joiner.waitForSelector('#menu:not(.hidden)', { timeout: 10000 }).catch(() => {});
const toast = await joiner.textContent('#toast');
expect(/host/i.test(toast), `joiner told the host left ("${toast}")`);
expect((await S(joiner)).mode === 'offline' && !(await S(joiner)).playing, 'joiner back at the menu');
const feelAfter = await joiner.evaluate(() => window.stickSoldiers.feelNow());
expect(!feelAfter.host && feelAfter.camera.look === 100 && feelAfter.aimZoom === 'slight', `the joiner's own camera and aiming zoom back (${JSON.stringify(feelAfter)})`);
// (Through public relays the "closed" update can take a few seconds to reach them all.)
await joiner.waitForFunction(name => ![...document.querySelectorAll('.game-row b')].some(b => b.textContent === name), GAME, { timeout: publicRelays ? 15000 : 5000 }).catch(() => {});
const after = await joiner.$$eval('.game-row b', els => els.map(e => e.textContent));
expect(!after.includes(GAME), 'closed game is gone from the list');

console.log(JSON.stringify({ listed, feel, joinerRuns, joinerRunsAgain, cq, classes, pings, host: h1.soldiers.length, joinerMe: j1.me, chat: (await S(host)).chat, quick: t1.mode, toast, errors }, null, 2));
await browser.close();
server.close();
await relay?.close();
if (errors.length) process.exit(1);

async function page_click(page, sel) { await page.click(sel); }
