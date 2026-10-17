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
const url = `http://localhost:${server.address().port}/${relay ? `?relay=${encodeURIComponent(relay.url)}` : ''}`;
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
const hostOnJoiner = j1.soldiers.find(s => s.name === 'Hosty');
expect(hostOnJoiner && Math.abs(hostOnJoiner.x - h1.me.x) < 60, `host is where the joiner sees them (${hostOnJoiner?.x} vs ${h1.me.x})`);
expect(h1.soldiers.filter(s => s.bot).length === 2, 'bots kept at 2 (room for players)');

// 4. Chat.
await joiner.keyboard.press('Enter');
await joiner.keyboard.type('gg no re');
await joiner.keyboard.press('Enter');
await host.waitForFunction(() => window.stickSoldiers.state.chat.some(c => c.text === 'gg no re'), null, { timeout: 5000 }).catch(() => {});
expect((await S(host)).chat.includes('gg no re'), 'host got the chat message');

await host.screenshot({ path: `${outDir}/online-host.png` });
await joiner.screenshot({ path: `${outDir}/online-joiner.png` });

// 5. Quick match finds the same game.
const third = await player('Quicky');
await third.click('#quickMatch');
await third.waitForFunction(() => window.stickSoldiers.state.mode === 'client' && window.stickSoldiers.state.game, null, { timeout: 30000 }).catch(() => {});
const t1 = await S(third);
expect(t1.mode === 'client', `quick match joined the open game (mode ${t1.mode})`);
await third.waitForTimeout(1500);
// (On the public relays quick match may pick someone else's game, so only check this locally.)
if (!publicRelays) expect((await S(host)).soldiers.some(s => s.name === 'Quicky'), 'host sees the quick-match player');

// 6. The host ends the game: everyone is told and goes back to the menu.
await host.keyboard.press('Escape');
await host.click('#quit');
await joiner.waitForSelector('#menu:not(.hidden)', { timeout: 10000 }).catch(() => {});
const toast = await joiner.textContent('#toast');
expect(/host/i.test(toast), `joiner told the host left ("${toast}")`);
expect((await S(joiner)).mode === 'offline' && !(await S(joiner)).playing, 'joiner back at the menu');
await joiner.waitForTimeout(1500);
const after = await joiner.$$eval('.game-row b', els => els.map(e => e.textContent));
expect(!after.includes(GAME), 'closed game is gone from the list');

console.log(JSON.stringify({ listed, host: h1.soldiers.length, joinerMe: j1.me, chat: (await S(host)).chat, quick: t1.mode, toast, errors }, null, 2));
await browser.close();
server.close();
await relay?.close();
if (errors.length) process.exit(1);

async function page_click(page, sel) { await page.click(sel); }
