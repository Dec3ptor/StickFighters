// The WebGL renderer in a real browser: it starts, plays, survives resizing,
// and draws the same picture as the canvas renderer (pixel for pixel, nearly).
// Usage: node tests/browser/webgl.mjs [outDir]
//
// The test browser has no graphics card, so WebGL runs in software here. That's
// why "auto" should pick the canvas, and why ?renderer=webgl forces WebGL.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve } from '../../tools/serve.mjs';
import { startRelay } from '../../tools/relay.mjs';

const outDir = process.argv[2] || 'test-results';
fs.mkdirSync(outDir, { recursive: true });

const server = await serve(0);
const relay = await startRelay();
const base = `http://localhost:${server.address().port}/?relay=${encodeURIComponent(relay.url)}`;
const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ['--enable-unsafe-swiftshader'],
});
const errors = [];
const expect = (ok, what) => { if (!ok) errors.push(what); };

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(`${query}: ${e}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${query}: ${m.text()}`); });
  await page.goto(base + query);
  await page.waitForFunction(() => window.stickSoldiers);
  return page;
}

async function play(page, map, mode) {
  await page.evaluate(([map, mode]) => {
    const s = window.stickSoldiers.readMenu();
    window.stickSoldiers.startMatch({ ...s, map, mode, bots: 7 });
  }, [map, mode]);
  await page.waitForFunction(() => window.stickSoldiers.state.game?.tick > 300, null, { timeout: 30000 });
}

// 1. Without a graphics card, "auto" draws with the canvas.
const auto = await open('');
expect(await auto.evaluate(() => window.stickSoldiers.renderer.kind) === 'canvas', 'auto picks the canvas when WebGL is software-only');
await auto.close();

// 2. Forced WebGL: play, and compare frames with the canvas renderer.
const page = await open('&renderer=webgl');
expect(await page.evaluate(() => window.stickSoldiers.renderer.kind) === 'webgl', 'renderer=webgl uses WebGL');
const results = [];
for (const [map, mode] of [['ssteam1.json', 'team'], ['ssdm1.json', 'ffa']]) {
  await play(page, map, mode);
  await page.mouse.move(900, 300);
  await page.keyboard.down('KeyD');
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyD');
  await page.mouse.up();
  await page.screenshot({ path: `${outDir}/webgl-${map.replace('.json', '')}.png` });
  const r = await page.evaluate(compareFrames);
  for (const k of ['gl', 'canvas']) fs.writeFileSync(`${outDir}/compare-${map.replace('.json', '')}-${k}.png`, Buffer.from(r[k].split(',')[1], 'base64'));
  results.push({ map, differentPixels: `${(r.big * 100).toFixed(2)}%`, meanDiff: +r.mean.toFixed(2) });
  expect(r.big < 0.01, `${map}: WebGL frame differs from the canvas in ${(r.big * 100).toFixed(2)}% of pixels`);
  await page.evaluate(() => { window.stickSoldiers.state.paused = false; });
}

// 3. Everything at once: every weapon, projectile, animal, crate and effect.
await page.evaluate(() => { window.stickSoldiers.state.paused = true; });
await page.evaluate(stageEverything);
{
  const r = await page.evaluate(compareFrames);
  for (const k of ['gl', 'canvas']) fs.writeFileSync(`${outDir}/compare-everything-${k}.png`, Buffer.from(r[k].split(',')[1], 'base64'));
  results.push({ map: 'everything', differentPixels: `${(r.big * 100).toFixed(2)}%`, meanDiff: +r.mean.toFixed(2) });
  expect(r.big < 0.015, `everything: WebGL frame differs from the canvas in ${(r.big * 100).toFixed(2)}% of pixels`);
}
// (The staged things aren't real game objects, so the game stays paused from here on.)

// 4. Resizing the window resizes the drawing.
await page.setViewportSize({ width: 900, height: 500 });
await page.waitForTimeout(500);
const size = await page.evaluate(() => { const r = window.stickSoldiers.renderer; return [r.canvas.width, r.canvas.height]; });
expect(size[0] === 900 && size[1] === 500, `canvas follows the window size (${size})`);
await page.screenshot({ path: `${outDir}/webgl-resized.png` });

// 5. Back at the menu: a blank page, drawn once.
await page.keyboard.press('Escape');
await page.click('#quit');
await page.waitForFunction(() => !window.stickSoldiers.state.game);
await page.waitForTimeout(300);
expect(await page.evaluate(() => window.stickSoldiers.renderer.blank), 'menu shows a blank page');

console.log(JSON.stringify({ results, size, errors }, null, 2));
await browser.close();
server.close();
await relay.close();
if (errors.length) process.exit(1);

/** In the page: fill the screen with one of everything the game can draw. */
async function stageEverything() {
  const { state, renderer } = window.stickSoldiers;
  const { WEAPONS } = await import('/src/weapons.js');
  const g = state.game, fx = g.fx, X = renderer.cam.x, Y = renderer.cam.y;
  const ids = Object.keys(WEAPONS).filter(id => !WEAPONS[id].hidden);
  // Soldiers hold different weapons, one with a jetpack, armour and a rope.
  g.soldiers.forEach((s, i) => {
    if (!s.alive) return;
    const id = ids[(i * 5) % ids.length];
    s.weapons[id] = { ammo: 3 };
    s.current = id;
    s.spawnProtect = 0;
    if (i === 1) { s.body.hasJetpack = true; s.body.jetting = true; s.armour = 50; }
    if (i === 2) s.body.rope = { x: s.x + 40, y: s.y - 90 };
  });
  // Every weapon lying on the floor, and crates (falling, landed, health).
  ids.forEach((id, i) => g.pickups.items.push({ type: 'weapon', weapon: id, x: X - 380 + (i % 14) * 55, y: Y + 120 + Math.floor(i / 14) * 30, active: true, dropped: true, life: 999, bob: 0 }));
  for (const [dx, extra] of [[-60, { landed: false }], [-20, { landed: true }], [20, { landed: true, health: true, weapon: null }]]) {
    g.pickups.items.push({ type: 'crate', weapon: 'Bazooka', x: X + dx, y: Y - 230, active: true, dropped: true, life: 999, bob: 0, ...extra });
  }
  for (const [i, type] of ['health', 'armour', 'jetpack'].entries()) g.pickups.items.push({ type, x: X + 80 + i * 30, y: Y - 230, active: true, bob: 0 });
  // Projectiles of every kind.
  let id = 9000;
  const P = o => g.projectiles.push({ id: id++, age: 30, life: 200, vx: 3, vy: -1, delay: 0, ...o });
  ['grenade', 'bomblet', 'cluster', 'banana', 'holy', 'petrol', 'napalm', 'skunk', 'dynamite'].forEach((sprite, i) => P({ kind: 'thrown', sprite, x: X - 380 + i * 30, y: Y - 170, angle: 0.4, life: i % 2 ? 40 : 200 }));
  ['sheep', 'oldwoman', 'cow'].forEach((sprite, i) => P({ kind: 'walker', sprite, x: X - 100 + i * 40, y: Y - 170, dir: i % 2 ? -1 : 1 }));
  P({ kind: 'flyer', sprite: 'supersheep', x: X + 30, y: Y - 170, angle: 2.5 });
  P({ kind: 'placed', sprite: 'mine', x: X + 70, y: Y - 170, armed: 0 });
  P({ kind: 'placed', sprite: 'mine', x: X + 90, y: Y - 170, armed: 5 });
  P({ kind: 'donkey', sprite: 'donkey', x: X + 130, y: Y - 170 });
  ['rocket', 'homing', 'bomb', 'mortar'].forEach((sprite, i) => P({ kind: 'rocket', sprite, x: X + 180 + i * 30, y: Y - 170 }));
  P({ kind: 'seeker', sprite: 'magic', x: X + 310, y: Y - 170 });
  P({ kind: 'arrow', sprite: 'arrow', x: X + 340, y: Y - 170, angle: 0.3 });
  P({ kind: 'bullet', sprite: 'bullet', x: X + 370, y: Y - 170, vx: 12, vy: 2 });
  P({ kind: 'bullet', sprite: 'slug', x: X + 370, y: Y - 150, vx: 12, vy: -2 });
  P({ kind: 'flame', x: X - 300, y: Y - 110, age: 10, life: 20 });
  P({ kind: 'fire', x: X - 260, y: Y - 110 });
  P({ kind: 'gas', x: X - 220, y: Y - 110, r: 14, life: 100 });
  // Effects of every kind.
  fx.explosion(X - 150, Y - 110, 40);
  fx.ring(X - 80, Y - 110, '#7c4dff');
  fx.whack(X - 40, Y - 110);
  fx.plane(X, Y - 110, 1);
  fx.parts[fx.parts.length - 1].x = X + 20;
  fx.gibs([[X + 60, Y - 120, X + 70, Y - 105], [X + 75, Y - 120, X + 85, Y - 110]], { x: X + 90, y: Y - 115, r: 4.2 }, 0, 0, 1);
  fx.sparks(X + 120, Y - 110, 0, -1);
  fx.smoke(X + 150, Y - 110, 6);
  fx.fire(X + 180, Y - 110);
  fx.trail(X + 200, Y - 110, X + 240, Y - 100);
  fx.shell(X + 260, Y - 110, 1);
  fx.muzzle(X + 280, Y - 110, 0.2, true);
  fx.sparkle(X + 300, Y - 110);
  fx.blood(X + 330, Y - 110, 1, 0, 20);
  fx.stains.push({ x: X + 360, y: Y - 110, size: 3, life: 900 });
}

/** In the page: draw the paused game with WebGL and with a canvas renderer, and compare. */
async function compareFrames() {
  const { state, renderer } = window.stickSoldiers;
  state.paused = true;
  await new Promise(r => setTimeout(r, 100));
  const { Renderer } = await import('/src/render.js');
  const { drawHud } = await import('/src/hud.js');
  const g = state.game, me = state.me;
  // Drawing uses a little randomness (flame flicker): make it repeat.
  const random = Math.random;
  let seed = 1;
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const grab = r => {
    seed = 1;
    r.shake = 0;
    r.render(g, 1, me);
    drawHud(r, g, me, { chat: [{ name: 'Bob', text: 'gg', time: performance.now() }], ping: 42, showScores: true });
    r.drawCrosshair(640, 360, false);
    r.present();
    const c = document.createElement('canvas');
    c.width = r.canvas.width;
    c.height = r.canvas.height;
    c.getContext('2d').drawImage(r.canvas, 0, 0);
    return c;
  };
  const a = grab(renderer);
  const other = new Renderer(document.createElement('canvas'));
  other.cam = { ...renderer.cam };
  const b = grab(other);
  Math.random = random;
  const da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
  const db = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
  let big = 0, sum = 0;
  for (let i = 0; i < da.length; i += 4) {
    const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
    sum += d;
    if (d > 64) big++;
  }
  const n = da.length / 4;
  return { big: big / n, mean: sum / n, gl: a.toDataURL(), canvas: b.toDataURL() };
}
