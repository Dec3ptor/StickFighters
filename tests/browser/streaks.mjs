// Kill streaks in a browser: the setup option, callouts and the rewards bar on the HUD,
// X and Z using rewards (supply drop, sentry sheep, stampede, Juggernaut), hit-stop and the
// kill-confirm mark, then the slow-motion replay of the winning kill (skipped with a key)
// and the results with awards; then the same rewards and replay in Remastered.
// Usage: node tests/browser/streaks.mjs [outDir]
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
const errors = [];
const check = (ok, what) => { if (!ok) errors.push(what); };

async function play(edition) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(`${edition}: ${e}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${edition}: ${m.text()}`); });
  await page.goto(`${base}&game=${edition}`);
  await page.waitForFunction(() => window.stickSoldiers);
  await page.click('#tabOffline');
  await page.waitForSelector('.map-card');
  // The setup: the Kill streaks option, shown where the mode has rewards.
  const field = mode => page.evaluate(m => {
    const el = document.getElementById('mode');
    el.value = m;
    el.dispatchEvent(new Event('change'));
    return !document.getElementById('streakField').classList.contains('hidden');
  }, mode);
  check(await field('ffa'), `${edition}: Kill streaks option in free-for-all`);
  check(!(await field('gungame')), `${edition}: no Kill streaks option in gun game`);
  check(await page.$eval('#streaks', s => s.value) === 'on', `${edition}: on to start with`);
  await field('ffa');
  await page.evaluate(() => {
    const s = window.stickSoldiers.readMenu();
    window.stickSoldiers.startMatch({ ...s, map: 'ssdm1.json', mode: 'ffa', bots: 3, fragLimit: 10, difficulty: 'easy' });
  });
  await page.waitForFunction(() => window.stickSoldiers.state.me?.alive, null, { timeout: 30000 });
  // (The bots stand still: nothing here should depend on how a fight goes.)
  await page.evaluate(() => {
    const g = window.stickSoldiers.state.game;
    for (const s of g.soldiers) if (s.isBot) g.controllers.set(s, { input: () => ({ move: 0 }) });
  });
  await page.mouse.click(640, 360);

  // Three kills in a row: callouts and a supply drop banked.
  await page.evaluate(() => {
    const { state } = window.stickSoldiers, g = state.game, me = state.me;
    const bots = g.soldiers.filter(s => s.isBot);
    for (let i = 0; i < 3; i++) {
      const b = bots[i % bots.length];
      if (!b.alive) b.spawnAt({ x: me.x + 200, y: me.y }, 0);
      g.kill(b, me, 'M4', { headshot: i === 0 });
    }
  });
  await page.waitForTimeout(200);
  const after3 = await page.evaluate(() => {
    const { state } = window.stickSoldiers, g = state.game, me = state.me;
    return { bank: [...me.bank], streak: me.streak, callouts: g.callouts.filter(c => c.to === me.id).map(c => c.text), killAt: state.killAt };
  });
  check(after3.bank.join() === 'supply' && after3.streak === 3, `${edition}: three in a row banks a supply drop: ${JSON.stringify(after3)}`);
  check(['First blood', 'Triple kill', 'Supply Drop ready'].every(t => after3.callouts.includes(t)), `${edition}: callouts ${JSON.stringify(after3.callouts)}`);
  check(after3.killAt > 0, `${edition}: the kill-confirm mark`);
  await page.screenshot({ path: `${outDir}/streaks-${edition}-callouts.png` });

  // Hit-stop: offline, the game holds still for a moment after a kill of ours.
  await page.waitForTimeout(600);
  const stop = await page.evaluate(async () => {
    const { state } = window.stickSoldiers, g = state.game, me = state.me;
    const b = g.soldiers.find(s => s.isBot);
    if (!b.alive) b.spawnAt({ x: me.x + 200, y: me.y }, 0);
    await new Promise(r => requestAnimationFrame(r));
    g.kill(b, me, 'M4');
    // (Seen on the next frame drawn: then the game holds still until hitStopUntil.)
    const start = performance.now();
    while (!(state.hitStopUntil > performance.now()) && performance.now() - start < 1000) await new Promise(r => requestAnimationFrame(r));
    const t0 = g.tick, left = state.hitStopUntil - performance.now();
    await new Promise(r => setTimeout(r, Math.max(0, left - 15)));
    const held = g.tick - t0;
    await new Promise(r => setTimeout(r, 250));
    return { held, after: g.tick - t0, until: left > 0 };
  });
  check(stop.until && stop.held <= 1 && stop.after > 5, `${edition}: hit-stop holds the game a moment, then it goes on: ${JSON.stringify(stop)}`);

  // X: the supply drop comes down beside us.
  await page.keyboard.press('KeyX');
  await page.waitForTimeout(300);
  const crate = await page.evaluate(() => {
    const { state } = window.stickSoldiers, g = state.game, me = state.me;
    const c = g.pickups.items.find(it => it.streak);
    return c ? { dx: Math.abs(c.x - me.x), bank: me.bank.length } : null;
  });
  check(crate && crate.dx < 80 && crate.bank === 0, `${edition}: X calls in the supply drop: ${JSON.stringify(crate)}`);

  // Z picks, X uses: a sentry sheep, then the stampede; then the Juggernaut.
  await page.evaluate(() => { const me = window.stickSoldiers.state.me; me.bank = ['sentry', 'stampede']; });
  await page.keyboard.press('KeyZ');
  await page.keyboard.press('KeyX');
  await page.waitForTimeout(200);
  const used = await page.evaluate(() => {
    const { state } = window.stickSoldiers, g = state.game;
    return { sentries: g.sentries.length, bank: [...state.me.bank] };
  });
  check(used.sentries === 1 && used.bank.join() === 'stampede', `${edition}: Z then X put the sentry down: ${JSON.stringify(used)}`);
  await page.keyboard.press('KeyX');
  await page.waitForTimeout(400);
  check(await page.evaluate(() => window.stickSoldiers.state.game.projectiles.some(p => p.weapon === 'Stampede')), `${edition}: then the stampede`);
  await page.evaluate(() => { window.stickSoldiers.state.me.bank = ['juggernaut']; });
  await page.keyboard.press('KeyX');
  await page.waitForTimeout(400);
  const jug = await page.evaluate(() => { const me = window.stickSoldiers.state.me; return { jugger: me.jugger, current: me.current }; });
  check(jug.jugger > 0 && jug.current === 'JuggerGun', `${edition}: the Juggernaut: ${JSON.stringify(jug)}`);
  await page.screenshot({ path: `${outDir}/streaks-${edition}-rewards.png` });

  // The winning kill (made during an update, as in play): the replay, skipped with a key, then the results.
  await page.evaluate(() => {
    const { state } = window.stickSoldiers, g = state.game, me = state.me;
    me.frags = g.fragLimit - 1;
    const b = g.soldiers.find(s => s.isBot && s.alive) || g.soldiers.find(s => s.isBot);
    if (!b.alive) b.spawnAt({ x: me.x + 150, y: me.y }, 0);
    const ctl = g.controllers.get(b), input = ctl.input.bind(ctl);
    let done = false;
    ctl.input = (game, s) => { if (!done) { done = true; game.kill(s, me, 'Shotgun'); } return input(game, s); };
  });
  await page.waitForFunction(() => window.stickSoldiers.state.game.over, null, { timeout: 10000 });
  const fk = await page.evaluate(() => window.stickSoldiers.state.game.finalKill);
  check(fk && fk.killer === (await page.evaluate(() => window.stickSoldiers.state.me.id)), `${edition}: the winning kill: ${JSON.stringify(fk)}`);
  await page.waitForFunction(() => !!window.stickSoldiers.state.replay, null, { timeout: 5000 }).catch(() => check(false, `${edition}: the replay starts`));
  check(await page.$eval('#over', el => el.classList.contains('hidden')), `${edition}: no results during the replay`);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${outDir}/streaks-${edition}-replay.png` });
  const mid = await page.evaluate(() => { const r = window.stickSoldiers.state.replay; return r && { progress: r.progress, slow: r.slow }; });
  check(mid && mid.progress > 0 && mid.progress < 1, `${edition}: the replay plays: ${JSON.stringify(mid)}`);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => !window.stickSoldiers.state.replay, null, { timeout: 3000 }).catch(() => check(false, `${edition}: a key skips the replay`));
  await page.waitForSelector('#over:not(.hidden)', { timeout: 5000 }).catch(() => check(false, `${edition}: results after the replay`));
  const awards = await page.evaluate(() => window.stickSoldiers.state.game.awards.map(a => a.id));
  check(awards.includes('mvp') && awards.includes('streak'), `${edition}: awards ${JSON.stringify(awards)}`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/streaks-${edition}-results.png` });
  await page.close();
}

await play('original');
await play('remastered');

console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
server.close();
await relay.close();
if (errors.length) process.exit(1);
