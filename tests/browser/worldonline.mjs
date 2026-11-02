// A world played online, in real browsers: one hosts a world from the Worlds tab (Host online),
// a friend finds it in the list of open games and joins: they see the host's world (and what the
// host changed in it), dig in it (the host sees the hole), and open the inventory screen and
// craft (the host makes it). They find each other through a local Nostr relay and connect
// directly with WebRTC, as on the live site.
// Usage: node tests/browser/worldonline.mjs [outDir]
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
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
});
const errors = [];
const check = (ok, what) => { if (!ok) errors.push(what); };
const report = {};

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
/** Point the mouse at tile (tx, ty) until the game agrees that's what's aimed at. */
async function aimAt(page, tx, ty) {
  for (let i = 0; i < 15; i++) {
    const p = await page.evaluate(([tx, ty]) => {
      const { renderer: r } = window.stickSoldiers, s = r.scale;
      return { x: r.w / 2 + (tx * 16 + 8 - r.cam.x) * s, y: r.h / 2 + (ty * 16 + 8 - r.cam.y) * s };
    }, [tx, ty]);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(60);
    const t = await page.evaluate(() => window.stickSoldiers.state.me.world?.target);
    if (t && t.tx === tx && t.ty === ty) return;
  }
}

// 1. The host makes a world and hosts it, PvP off.
const host = await player('Hosty');
await host.click('#tabWorlds');
await host.fill('#worldName', 'Shared world');
await host.fill('#worldSeed', 'friends');
await host.click('#newWorldForm button[type=submit]');
await host.waitForFunction(() => window.stickSoldiers.state.me?.alive, null, { timeout: 30000 });
await host.keyboard.press('Escape');
await host.click('#quit');
await host.waitForSelector('#worldList .world-card');
await host.selectOption('#worldPvp', 'off');
await host.click('#worldList .world-card button[data-act="host"]');
await host.waitForFunction(() => window.stickSoldiers.state.mode === 'host' && window.stickSoldiers.state.me?.alive, null, { timeout: 30000 });
// Something changed in the world before the friend joins: a gold block beside the host.
const gold = await host.evaluate(async () => {
  const K = await import('./src/world/blocks.js');
  const { state } = window.stickSoldiers, me = state.me, w = state.game.world;
  const tx = Math.floor(me.x / 16) + 3, ty = Math.floor((me.y + 12) / 16) - 1;
  w.setTile(tx, ty, K.GOLD);
  return { tx, ty, id: K.GOLD };
});

// 2. The friend finds it in the list of open games, and joins.
const friend = await player('Friendo');
const row = friend.locator('.game-row', { hasText: 'Shared world' });
await row.waitFor({ timeout: 20000 });
check(/World/.test(await row.textContent()), 'listed as a world');
await row.locator('button').click();
await friend.waitForFunction(() => window.stickSoldiers.state.mode === 'client' && window.stickSoldiers.state.me?.alive && window.stickSoldiers.state.game?.world, null, { timeout: 40000 });
await friend.waitForTimeout(800);
const seen = await friend.evaluate(g => {
  const { state } = window.stickSoldiers, w = state.game.world;
  return { name: w.name, seed: w.seed, gold: w.tile(g.tx, g.ty), pvp: w.pvp, things: state.me.world.inv.count('pickaxe') };
}, gold);
report.seen = seen;
check(seen.name === 'Shared world' && seen.gold === gold.id, `the friend sees the host's world, gold block and all (${JSON.stringify(seen)})`);
check(seen.pvp === false, 'PvP off');
check(seen.things === 1, 'their own things (a new character\'s)');
await friend.screenshot({ path: `${outDir}/worldonline-friend.png` });

// 3. The friend digs the block beside them: the host sees it gone.
await friend.keyboard.press('Digit1');
const hole = await friend.evaluate(async () => {
  const K = await import('./src/world/blocks.js');
  const { state } = window.stickSoldiers, me = state.me;
  return { tx: Math.floor(me.x / 16) - 1, ty: Math.floor((me.y + 12) / 16), K: K.AIR };
});
await aimAt(friend, hole.tx, hole.ty);
await friend.mouse.down();
await host.waitForFunction(h => window.stickSoldiers.state.game.world.tile(h.tx, h.ty) === 0, hole, { timeout: 15000 }).catch(() => {});
await friend.mouse.up();
check(await host.evaluate(h => window.stickSoldiers.state.game.world.tile(h.tx, h.ty), hole) === 0, 'the friend dug a hole the host can see');
await friend.waitForTimeout(1500);
const dirt = await friend.evaluate(() => window.stickSoldiers.state.me.world.inv.count('dirt') + window.stickSoldiers.state.me.world.inv.count('stone'));
report.dug = dirt;

// 4. Crafting from the friend's inventory screen: planks from wood (the host makes them).
await host.evaluate(() => {
  const { state } = window.stickSoldiers;
  const guest = state.game.soldiers.find(s => s.remote);
  guest.world.inv.add('wood', 2);
});
await friend.waitForTimeout(500);
await friend.keyboard.press('KeyI');
await friend.waitForSelector('#inventory:not(.hidden)');
const planksBefore = await friend.evaluate(() => window.stickSoldiers.state.me.world.inv.count('planks'));
await friend.locator('#inventory .craft-row', { hasText: 'Planks' }).first().click();
await friend.waitForFunction(n => window.stickSoldiers.state.me.world.inv.count('planks') > n, planksBefore, { timeout: 5000 }).catch(() => {});
const planksAfter = await friend.evaluate(() => window.stickSoldiers.state.me.world.inv.count('planks'));
check(planksAfter === planksBefore + 4, `four planks made by the host for the friend (${planksBefore} -> ${planksAfter})`);
await friend.screenshot({ path: `${outDir}/worldonline-inventory.png` });
await friend.keyboard.press('KeyI');

// 5. The host saves and ends it: the friend's things are kept in the host's world.
await host.keyboard.press('Escape');
await host.click('#quit');
await host.waitForSelector('#worldList .world-card');
await host.waitForTimeout(500);
const kept = await host.evaluate(async () => {
  const list = await (await import('./src/world/worldsave.js')).listWorlds();
  const w = list.find(x => x.name === 'Shared world');
  return { players: Object.keys(w?.players || {}), pvp: w?.pvp };
});
report.kept = kept;
check(kept.players.includes('friendo'), `the friend's things kept in the host's world (${JSON.stringify(kept)})`);
await friend.waitForFunction(() => !window.stickSoldiers.state.game, null, { timeout: 10000 }).catch(() => {});

console.log(JSON.stringify({ report, errors }, null, 2));
await browser.close();
server.close();
await relay.close();
if (errors.length) process.exit(1);
