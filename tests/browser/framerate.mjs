// High refresh rates: with the browser's frame rate uncapped (like a 120/144/240 Hz
// screen, only more so), the game should draw well over 60 frames a second, and
// moving things should move on every frame, not just on the 60 game updates.
// Usage: node tests/browser/framerate.mjs [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve } from '../../tools/serve.mjs';
import { startRelay } from '../../tools/relay.mjs';

const outDir = process.argv[2] || 'test-results';
fs.mkdirSync(outDir, { recursive: true });

const server = await serve(0);
const relay = await startRelay();
const url = `http://localhost:${server.address().port}/?relay=${encodeURIComponent(relay.url)}&renderer=canvas`;
const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ['--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
const errors = [];
const expect = (ok, what) => { if (!ok) errors.push(what); };
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForFunction(() => window.stickSoldiers);
await page.evaluate(() => {
  const s = window.stickSoldiers.readMenu();
  window.stickSoldiers.startMatch({ ...s, map: 'ssdm1.json', mode: 'ffa', bots: 3 });
});
await page.waitForFunction(() => window.stickSoldiers.state.me?.alive && window.stickSoldiers.state.game.tick > 60, null, { timeout: 20000 });

// Run right while a rocket flies past, and record where both are drawn on each frame.
await page.keyboard.down('KeyD');
const r = await page.evaluate(async () => {
  const { state, renderer } = window.stickSoldiers;
  const { between } = await import('/src/render.js');
  const { lerp } = await import('/src/util.js');
  const g = state.game, me = state.me;
  const rocket = { id: 99999, kind: 'rocket', sprite: 'rocket', x: me.x - 300, y: me.y - 120, vx: 3, vy: 0, life: 1e9, age: 0, delay: 0 };
  rocket.px = rocket.x; rocket.py = rocket.y;
  const update = g.update.bind(g);
  // (Not a real projectile: moved here, at a steady speed, once per game update.)
  g.update = () => {
    g.projectiles = g.projectiles.filter(p => p !== rocket);
    update();
    g.projectiles.push(rocket);
    rocket.px = rocket.x;
    rocket.x += rocket.vx;
  };
  const frames = [];
  const render = renderer.render.bind(renderer);
  renderer.render = (game, alpha, viewer) => {
    const p = game.projectiles.find(q => q.id === 99999);
    if (p) frames.push({ t: performance.now(), tick: game.tick, rocket: between(p, alpha).x, me: lerp(me.prevX, me.x, alpha), moving: Math.abs(me.body.vx) > 1 });
    return render(game, alpha, viewer);
  };
  await new Promise(res => setTimeout(res, 2000));
  renderer.render = render;
  g.update = update;
  g.projectiles = g.projectiles.filter(p => p !== rocket);
  const fps = ((frames.length - 1) * 1000) / (frames[frames.length - 1].t - frames[0].t);
  let rocketStill = 0, meStill = 0, runFrames = 0;
  for (let i = 1; i < frames.length; i++) {
    if (Math.abs(frames[i].rocket - frames[i - 1].rocket) < 1e-9) rocketStill++;
    if (frames[i].moving && frames[i - 1].moving) {
      runFrames++;
      if (Math.abs(frames[i].me - frames[i - 1].me) < 1e-9) meStill++;
    }
  }
  return { fps: Math.round(fps), frames: frames.length, updates: frames[frames.length - 1].tick - frames[0].tick, rocketStill, runFrames, meStill };
});
await page.keyboard.up('KeyD');

expect(r.fps > 90, `draws faster than 60 frames a second when the screen allows (${r.fps} fps)`);
expect(Math.abs(r.updates - 120) <= 6, `still 60 game updates a second (${r.updates} in 2 s)`);
expect(r.rocketStill === 0, `a flying rocket moves on every frame (stood still on ${r.rocketStill})`);
expect(r.runFrames > 20 && r.meStill === 0, `a running soldier moves on every frame (stood still on ${r.meStill} of ${r.runFrames})`);

console.log(JSON.stringify({ ...r, errors }, null, 2));
await browser.close();
server.close();
await relay.close();
if (errors.length) process.exit(1);
