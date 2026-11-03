// World mode in the page: a world made from the Worlds tab (a name and a seed), played (dug
// into and built on, the inventory screen used), saved and quit from the menu, played again
// just as it was left, exported to a file and imported back, drawn by each renderer (the
// original on the canvas and with WebGL, and Remastered), and deleted.
// Usage: node tests/browser/world.mjs [outDir]
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
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
const errors = [];
const check = (ok, what) => { if (!ok) errors.push(what); };
const report = {};

async function open(query) {
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`${query}: ${e}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${query}: ${m.text()}`); });
  page.on('dialog', d => d.accept());
  await page.goto(`${base}&${query}`);
  await page.waitForFunction(() => window.stickSoldiers);
  return page;
}
const alive = page => page.waitForFunction(() => window.stickSoldiers.state.me?.alive && window.stickSoldiers.state.game?.world, null, { timeout: 30000 });
/**
 * Point the mouse at tile (dx, dy) from the one under the soldier's feet (again, until the game
 * says that's the tile aimed at: the camera looks a little toward the mouse as it moves).
 */
async function aimAt(page, dx, dy) {
  const want = await page.evaluate(([dx, dy]) => {
    const me = window.stickSoldiers.state.me;
    return { tx: Math.floor(me.x / 16) + dx, ty: Math.floor((me.y + 12) / 16) + dy };
  }, [dx, dy]);
  for (let i = 0; i < 12; i++) {
    const p = await page.evaluate(({ tx, ty }) => {
      const { renderer: r } = window.stickSoldiers, s = r.scale;
      return { x: r.w / 2 + (tx * 16 + 8 - r.cam.x) * s, y: r.h / 2 + (ty * 16 + 8 - r.cam.y) * s };
    }, want);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(60);
    const t = await page.evaluate(() => window.stickSoldiers.state.me.world.target);
    if (t && t.tx === want.tx && t.ty === want.ty) break;
  }
  return want;
}
const tileAt = (page, tx, ty) => page.evaluate(([tx, ty]) => window.stickSoldiers.state.game.world.tile(tx, ty), [tx, ty]);
/** Of the spots (dx, dy from the tile under the soldier's feet) given, the first that's empty with a floor under it (furniture goes there). */
const floorSpot = (page, spots) => page.evaluate(async spots => {
  const K = await import('./src/world/blocks.js');
  const { state } = window.stickSoldiers, w = state.game.world, me = state.me;
  const fx = Math.floor(me.x / 16), fy = Math.floor((me.y + 12) / 16);
  // (Plants are built over; furniture needs a solid floor.)
  const empty = id => id === K.AIR || id === K.TALL_GRASS || id === K.FLOWER || id === K.DEAD_BUSH;
  return spots.find(([dx, dy]) => empty(w.tile(fx + dx, fy + dy)) && K.SOLID[w.tile(fx + dx, fy + dy + 1)]) || spots[0];
}, spots);

// 1. A new world, from the Worlds tab.
const page = await open('game=original&renderer=canvas');
await page.click('#tabWorlds');
await page.waitForFunction(() => document.querySelector('#worldList').textContent.trim(), null, { timeout: 5000 }).catch(() => {});
check(/No worlds yet/.test(await page.textContent('#worldList')), 'no worlds to start with');
await page.fill('#worldName', 'Test world');
await page.fill('#worldSeed', 'stick');
await page.click('#newWorldForm button[type=submit]');
await alive(page);
await page.waitForTimeout(1200);
const started = await page.evaluate(() => {
  const { state, renderer } = window.stickSoldiers, g = state.game;
  return { mode: g.mode, name: g.world.name, seed: g.world.seed, pictures: renderer.worldView?.pics.size || 0, hotbar: state.me.world.inv.slots.slice(0, 10).map(s => s?.key) };
});
report.started = started;
check(started.mode === 'world' && started.name === 'Test world', `a world game (${JSON.stringify(started)})`);
check(started.pictures > 4, `its blocks drawn (${started.pictures} pictures)`);
check(started.hotbar[0] === 'pickaxe' && started.hotbar.includes('planks'), 'a new character\'s things');
await page.screenshot({ path: `${outDir}/world-start.png` });

// 2. Dig the block under your feet (the pickaxe: 1), then build a plank beside you (planks).
await page.keyboard.press('Digit1');
const dug = await aimAt(page, 0, 0);
const was = await tileAt(page, dug.tx, dug.ty);
await page.mouse.down();
await page.waitForFunction(([tx, ty]) => window.stickSoldiers.state.game.world.tile(tx, ty) === 0, [dug.tx, dug.ty], { timeout: 10000 }).catch(() => {});
await page.mouse.up();
await page.waitForTimeout(800);
const afterDig = await page.evaluate(() => window.stickSoldiers.state.me.world.inv.count('dirt'));
check(was !== 0 && (await tileAt(page, dug.tx, dug.ty)) === 0, `dug the block under the soldier (${was})`);
check(afterDig >= 1, `and picked up what it gave (${afterDig} dirt)`);
const plankSlot = await page.evaluate(() => window.stickSoldiers.state.me.world.inv.slots.findIndex(s => s?.key === 'planks'));
await page.keyboard.press(`Digit${(plankSlot + 1) % 10}`);
await page.waitForTimeout(100);
// (Standing in the hole now: two blocks over, on top of the ground.)
const put = await aimAt(page, 2, -2);
await page.mouse.down();
await page.waitForTimeout(80);
await page.mouse.up();
await page.waitForTimeout(200);
const plank = await tileAt(page, put.tx, put.ty);
const PLANKS = await page.evaluate(async () => (await import('./src/world/blocks.js')).BLOCK_BY_KEY.get('planks').id);
check(plank === PLANKS, `a plank built (${plank})`);
report.built = { at: [put.tx, put.ty], block: plank };

// 3. The inventory screen (I): a stack moved from the hotbar to the bag, and back.
await page.keyboard.press('KeyI');
await page.waitForSelector('#inventory:not(.hidden)');
const slots = await page.locator('#inventory .inv-slot[data-box="me"]').count();
check(slots === 40, `40 slots (${slots})`);
await page.click('#inventory .inv-slot[data-box="me"][data-slot="9"]');
await page.click('#inventory .inv-slot[data-box="me"][data-slot="39"]');
const moved = await page.evaluate(() => { const s = window.stickSoldiers.state.me.world.inv.slots; return [s[9]?.key ?? null, s[39]?.key ?? null]; });
await page.screenshot({ path: `${outDir}/world-inventory.png` });
await page.click('#inventory .inv-slot[data-box="me"][data-slot="39"]', { modifiers: ['Shift'] });
const back = await page.evaluate(() => window.stickSoldiers.state.me.world.inv.slots[9]?.key ?? null);
check(moved[0] === null && moved[1] && back === moved[1], `moved to the bag and back (${JSON.stringify(moved)}, ${back})`);
await page.keyboard.press('KeyI');
check(await page.locator('#inventory').evaluate(el => el.classList.contains('hidden')), 'I closes it');

// 3b. Crafting: a chest made at the workbench (the starting kit has one: put down beside you),
// put down, opened with a right click, and something put in it.
const bench = await page.evaluate(() => window.stickSoldiers.state.me.world.inv.slots.findIndex(s => s?.key === 'workbench'));
await page.evaluate(i => window.stickSoldiers.state.me.world.inv.move(i, 9), bench);
await page.keyboard.press('Digit0');
await page.waitForTimeout(100);
const benchAt = await aimAt(page, ...await floorSpot(page, [[-2, -1], [-2, -2], [-2, 0], [-1, -2]]));
await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
await page.waitForTimeout(150);
const WORKBENCH = await page.evaluate(async () => (await import('./src/world/blocks.js')).WORKBENCH);
check(await tileAt(page, benchAt.tx, benchAt.ty) === WORKBENCH, 'a workbench put down');
await page.keyboard.press('KeyI');
await page.waitForSelector('#inventory:not(.hidden)');
const chestRow = page.locator('#inventory .craft-row', { hasText: 'Chest' }).first();
check(!(await chestRow.isDisabled()), 'a chest can be made at the workbench');
await chestRow.click();
check(await page.evaluate(() => window.stickSoldiers.state.me.world.inv.count('chest')) === 1, 'a chest made');
await page.screenshot({ path: `${outDir}/world-crafting.png` });
await page.keyboard.press('KeyI');
const chestSlot = await page.evaluate(() => window.stickSoldiers.state.me.world.inv.slots.findIndex(s => s?.key === 'chest'));
await page.evaluate(i => window.stickSoldiers.state.me.world.inv.move(i, 9), chestSlot);
await page.keyboard.press('Digit0');
await page.waitForTimeout(100);
const chestSpot = await floorSpot(page, [[-3, -1], [-3, -2], [-3, 0], [-4, -1], [-4, -2]]);
const chestAtTile = await aimAt(page, ...chestSpot);
await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
await page.waitForTimeout(150);
await aimAt(page, ...chestSpot);
await page.mouse.down({ button: 'right' }); await page.waitForTimeout(80); await page.mouse.up({ button: 'right' });
await page.waitForFunction(() => window.stickSoldiers.inventory?.open && window.stickSoldiers.inventory.chest, null, { timeout: 5000 }).catch(() => {});
check(await page.evaluate(() => !!window.stickSoldiers.inventory?.chest), 'the chest opened with a right click');
// Shift-click the glass in the bag into the chest.
const glass = await page.evaluate(() => window.stickSoldiers.state.me.world.inv.slots.findIndex(s => s?.key === 'glass'));
await page.click(`#inventory .inv-slot[data-box="me"][data-slot="${glass}"]`, { modifiers: ['Shift'] });
const inChest = await page.evaluate(() => window.stickSoldiers.inventory.chest.inv.count('glass'));
check(inChest === 30, `the glass put in the chest (${inChest})`);
await page.keyboard.press('KeyI');
report.chest = { at: [chestAtTile.tx, chestAtTile.ty], glass: inChest };

// 3c. Dev mode (the key under Escape): anything made for free from the bag (found by typing:
// here a diamond, which has no recipe), and anything taken from the codex (a unique). Then off.
await page.keyboard.press('Backquote');
await page.waitForFunction(() => !!window.stickSoldiers.state.me.world.dev);
// Flying fast, the camera stays right with you (rather than trailing behind); then back where you were.
const flyFrom = await page.evaluate(() => ({ x: window.stickSoldiers.state.me.body.x, y: window.stickSoldiers.state.me.body.y }));
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
await page.waitForTimeout(700);
const trail = await page.evaluate(() => {
  const { state, renderer } = window.stickSoldiers, me = state.me, c = renderer.cam;
  return { x: Math.round(me.x - c.x + c.lx * c.look), y: Math.round(me.y - 20 - c.y + c.ly * c.look), up: Math.round(me.body.vy) };
});
await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
await page.waitForTimeout(300);
await page.evaluate(p => { const b = window.stickSoldiers.state.me.body; b.x = p.x; b.y = p.y; b.vx = b.vy = 0; }, flyFrom);
check(trail.up < -10 && Math.abs(trail.x) < 40 && Math.abs(trail.y) < 40, `dev mode: the camera keeps up with flying (${JSON.stringify(trail)})`);
await page.keyboard.press('KeyI');
await page.waitForSelector('#inventory:not(.hidden)');
await page.fill('#inventory [data-find]', 'diamond');
const devRow = page.locator('#inventory .craft-row.dev:not(.hidden)', { hasText: 'Diamond' }).first();
check(await devRow.count() === 1 && !(await devRow.isDisabled()), 'dev mode: a diamond to be had from the bag');
const enderRow = page.locator('#inventory .craft-row:not(.dev)', { hasText: 'Ender chest' }).first();
await page.fill('#inventory [data-find]', 'ender');
check(!(await enderRow.isDisabled()), 'an ender chest, with nothing it takes and no anvil');
await enderRow.click();
await page.fill('#inventory [data-find]', 'diamond');
await devRow.click();
const freebies = await page.evaluate(() => ({ diamond: window.stickSoldiers.state.me.world.inv.count('diamond'), ender: window.stickSoldiers.state.me.world.inv.count('ender_chest') }));
check(freebies.diamond === 99 && freebies.ender === 1, `made for free (${JSON.stringify(freebies)})`);
await page.screenshot({ path: `${outDir}/world-dev-crafting.png` });
// (Escape in the box: emptied, and the keys are the game's again.)
await page.locator('#inventory [data-find]').press('Escape');
await page.keyboard.press('KeyI');
await page.waitForSelector('#inventory.hidden', { state: 'attached' });
await page.keyboard.press('KeyJ');
await page.waitForSelector('#journal:not(.hidden)');
await page.click('#journal [data-tab="codex"]');
await page.click('#journal [data-cat="unique"]');
await page.locator('#journal .codex-take').first().click();
await page.waitForTimeout(100);
const unique = await page.evaluate(() => window.stickSoldiers.state.me.world.inv.slots.find(s => s?.g?.unique)?.g.name || null);
check(!!unique, 'dev mode: a unique from the codex');
await page.keyboard.press('KeyJ');
// The dev menu (P): a zombie summoned where the crosshair is, and invisible (then visible again).
await page.keyboard.press('KeyP');
await page.waitForSelector('#devPanel:not(.hidden)');
const zombies = () => page.evaluate(() => window.stickSoldiers.state.game.soldiers.filter(s => s.npc?.type === 'zombie').length);
const z0 = await zombies();
await page.click('#devPanel [data-act="summon"][data-type="zombie"]');
await page.click('#devPanel [data-act="invisible"]');
const devMenu = await page.evaluate(() => ({ invisible: !!window.stickSoldiers.state.me.world.dev?.invisible, on: document.querySelector('#devPanel [data-on="invisible"]').classList.contains('on') }));
await page.click('#devPanel [data-act="invisible"]');
await page.keyboard.press('KeyP');
await page.waitForSelector('#devPanel.hidden', { state: 'attached' });
check((await zombies()) === z0 + 1 && devMenu.invisible && devMenu.on, `dev menu: summoned, invisible (${JSON.stringify({ ...devMenu, zombies: (await zombies()) - z0 })})`);
await page.keyboard.press('Backquote');
await page.waitForFunction(() => !window.stickSoldiers.state.me.world.dev);
await page.keyboard.press('KeyI');
await page.waitForSelector('#inventory:not(.hidden)');
check(await page.locator('#inventory .craft-row.dev:not(.hidden)').count() === 0, 'dev mode off: none of its own in the list');
await page.keyboard.press('KeyI');
report.dev = { ...freebies, unique, trail };

// 4. Save and quit (the menu), then play it again: just as it was left.
await page.keyboard.press('Escape');
await page.waitForSelector('#pause:not(.hidden)');
check((await page.textContent('#quit')) === 'Save and quit', 'the menu saves and quits');
check(await page.locator('#restart').evaluate(el => el.classList.contains('hidden')), 'no restarting a world');
const where = await page.evaluate(() => ({ x: Math.round(window.stickSoldiers.state.me.x), y: Math.round(window.stickSoldiers.state.me.y) }));
await page.click('#quit');
await page.waitForSelector('#menu:not(.hidden)');
await page.waitForSelector('#worldList .world-card');
check(/Test world/.test(await page.textContent('#worldList')) && /Seed/.test(await page.textContent('#worldList')), 'listed in the Worlds tab');
await page.click('#worldList .world-card button[data-act="play"]');
await alive(page);
await page.waitForTimeout(400);
const again = await page.evaluate(([dug, put]) => {
  const { state } = window.stickSoldiers, w = state.game.world;
  return { hole: w.tile(dug.tx, dug.ty), plank: w.tile(put.tx, put.ty), dirt: state.me.world.inv.count('dirt'), x: Math.round(state.me.x), y: Math.round(state.me.y) };
}, [dug, put]);
report.again = again;
check(again.hole === 0 && again.plank === plank, `the hole and the plank still there (${JSON.stringify(again)})`);
check(again.dirt === afterDig, 'your things kept');
check(Math.abs(again.x - where.x) < 2 && Math.abs(again.y - where.y) < 20, `back where you were (${JSON.stringify(where)} -> ${again.x},${again.y})`);
const keptChest = await page.evaluate(async ([tx, ty]) => (await import('./src/world/worldplay.js')).chestAt(window.stickSoldiers.state.game.world, tx, ty)?.count('glass') ?? -1, report.chest.at);
check(keptChest === 30, `the chest kept its things (${keptChest})`);

// 4a. The village beside the start (towns.js): into one of its houses (its door opens as you
// walk into it, and shuts behind you), where nobody can dig.
const town = await page.evaluate(() => {
  const g = window.stickSoldiers.state.game.world.gen, t = g.townIn(g.spawnRegion);
  const b = t?.buildings.find(b => ['house', 'elder', 'shop'].includes(b.kind) && b.base === t.level);
  return t && b && { name: t.name, level: t.level, door: [b.x0, b.base - 1], from: b.x0 - 3 };
});
check(!!town, 'a village beside the start');
if (town) {
  await page.evaluate(t => { const me = window.stickSoldiers.state.me; me.body.x = t.from * 16 + 8; me.body.y = (t.door[1] + 1) * 16 - 13; me.body.vx = me.body.vy = 0; }, town);
  await page.waitForTimeout(800);
  // (The townsfolk walk through doors too: they're held still, out of the doorway, and the door shut.)
  await page.evaluate(async t => {
    const D = await import('./src/world/doors.js');
    const g = window.stickSoldiers.state.game;
    for (const s of g.soldiers.filter(o => o.npc?.kind === 'townsfolk')) {
      g.controllers.get(s).wait = 1e6;
      if (Math.abs(s.x - (t.door[0] * 16 + 8)) < 40) { s.body.x = (t.door[0] + 4) * 16 + 8; s.body.vx = 0; }
    }
    await new Promise(r => setTimeout(r, 200));
    D.setDoor(g, t.door[0], t.door[1], false);
  }, town);
  await page.waitForTimeout(300);
  const doorNow = () => page.evaluate(d => window.stickSoldiers.state.game.world.tile(d[0], d[1]), town.door);
  const shut = await doorNow();
  await page.keyboard.down('KeyD');
  await page.waitForFunction(d => window.stickSoldiers.state.me.x > (d[0] + 2) * 16, town.door, { timeout: 5000 }).catch(() => {});
  await page.keyboard.up('KeyD');
  const inside = await page.evaluate(d => window.stickSoldiers.state.me.x > (d[0] + 1) * 16, town.door);
  await page.waitForTimeout(1500);
  const shutAgain = await doorNow();
  const safe = await page.evaluate(async t => {
    const W = await import('./src/world/worldplay.js');
    const { state } = window.stickSoldiers;
    return !W.mayChange(state.game.world, state.me, t.door[0] + 2, t.level);
  }, town);
  report.town = { ...town, shut, inside, shutAgain, safe };
  check(inside && shut === shutAgain && shut !== 0, `walked into a house in ${town.name} through its door, which shut behind (${JSON.stringify(report.town)})`);
  check(safe, 'no digging in a town');
  await page.screenshot({ path: `${outDir}/world-town.png` });
}

// 4a2. Talking to the townsfolk (talk.js): right click on someone in the village, and the talk
// screen opens; their shop; buying something; goodbye.
const folk = await page.evaluate(async () => {
  const T = await import('./src/world/townsfolk.js');
  const { state } = window.stickSoldiers, g = state.game, me = state.me;
  const all = g.soldiers.filter(s => s.npc?.kind === 'townsfolk' && s.alive);
  const npc = all.find(s => ['merchant', 'smith', 'farmer'].includes(s.npc.role)) || all[0];
  if (!npc) return null;
  g.controllers.get(npc).wait = 5000;
  // (Beside them, where they could walk: not inside a wall.)
  const nx = Math.floor(npc.x / 16), ny = Math.floor((npc.y + 12) / 16), [lo, hi] = T.walkSpan(g.world, nx, ny, 6);
  const x = nx - 2 >= lo ? nx - 2 : Math.min(hi, nx + 2);
  me.body.x = x * 16 + 8; me.body.y = npc.y; me.body.vx = me.body.vy = 0;
  me.world.inv.add('coins', 500);
  return { id: npc.id, name: npc.name, role: npc.npc.role, count: all.length };
});
check(!!folk, 'townsfolk in the village');
if (folk) {
  await page.waitForTimeout(500);
  // (They walk about: aimed at again, and asked again, if they'd stepped away as we clicked.)
  for (let tries = 0; tries < 3; tries++) {
    for (let i = 0; i < 12; i++) {
      const p = await page.evaluate(id => {
        const { renderer: r, state } = window.stickSoldiers, npc = state.game.soldiers.find(s => s.id === id);
        return { x: r.w / 2 + (npc.x - r.cam.x) * r.scale, y: r.h / 2 + (npc.y - 8 - r.cam.y) * r.scale };
      }, folk.id);
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(60);
      const on = await page.evaluate(async id => {
        const T = await import('./src/world/talk.js');
        const { state } = window.stickSoldiers, t = state.me.world.target;
        return t && T.folkAt(state.game, state.me, t.x, t.y)?.id === id;
      }, folk.id);
      if (on) break;
    }
    await page.mouse.down({ button: 'right' });
    await page.waitForTimeout(80);
    await page.mouse.up({ button: 'right' });
    if (await page.waitForSelector('#talk:not(.hidden)', { timeout: 4000 }).then(() => true, () => false)) break;
  }
  const opened = await page.evaluate(() => ({ open: !document.getElementById('talk').classList.contains('hidden'), name: document.querySelector('#talk [data-name]')?.textContent, said: document.querySelector('#talk [data-said]')?.textContent, options: [...document.querySelectorAll('#talk [data-op]')].map(b => b.dataset.op) }));
  report.talk = { ...folk, ...opened };
  check(opened.open && folk.name.startsWith(opened.name), `the talk screen opened for ${folk.name} (${JSON.stringify(opened)})`);
  if (opened.options.includes('trade')) {
    await page.keyboard.press(`Digit${opened.options.indexOf('trade') + 1}`);
    await page.waitForSelector('#talk [data-buy]:not([disabled])', { timeout: 3000 }).catch(() => {});
    const before = await page.evaluate(() => window.stickSoldiers.state.me.world.inv.count('coins'));
    await page.click('#talk [data-buy]:not([disabled])').catch(() => {});
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.stickSoldiers.state.me.world.inv.count('coins'));
    report.talk.bought = before - after;
    check(after < before, `bought something (${before} -> ${after} coins)`);
  }
  await page.screenshot({ path: `${outDir}/world-talk.png` });
  if (opened.open) await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const ended = await page.evaluate(() => document.getElementById('talk').classList.contains('hidden') && !window.stickSoldiers.state.me.world.talk);
  check(ended, 'goodbye: the talk screen closed and the talk ended');
}

// 4b. Night falls: the light dims, a monster comes for you and a mercenary is hired.
await page.evaluate(async () => {
  const M = await import('./src/world/monsters.js');
  const { state } = window.stickSoldiers, g = state.game, me = state.me;
  g.world.time = M.DAY_TICKS * 0.75;
  me.health = me.maxHealth = 100000;
  const tx = Math.floor(me.x / 16) + 10;
  M.spawnMonster(g, 'skeleton', tx * 16 + 8, g.world.surface(tx) * 16 - 13);
  M.hireMerc(g, me);
});
await page.waitForTimeout(2500);
const night = await page.evaluate(() => {
  const { state, renderer } = window.stickSoldiers, g = state.game;
  return { sky: renderer.worldView?.lit?.sky, npcs: g.soldiers.filter(s => s.npc).map(s => `${s.npc.kind}:${s.alive}`) };
});
report.night = night;
check(night.sky === 4, `moonlight at night (${night.sky})`);
check(night.npcs.includes('merc:true'), `a mercenary with you (${night.npcs})`);
await page.screenshot({ path: `${outDir}/world-night.png` });

await page.keyboard.press('Escape');
await page.click('#quit');
await page.waitForSelector('#worldList .world-card');

// 5. Exported to a file, and imported again (a second world, its name made unique).
const [download] = await Promise.all([page.waitForEvent('download'), page.click('#worldList .world-card button[data-act="export"]')]);
const file = `${outDir}/${download.suggestedFilename()}`;
await download.saveAs(file);
check(/\.ssworld$/.test(file) && JSON.parse(fs.readFileSync(file, 'utf8')).kind === 'stick-soldiers-world', `a world file (${file})`);
await page.setInputFiles('#importWorldFile', file);
await page.waitForFunction(() => document.querySelectorAll('#worldList .world-card').length === 2, null, { timeout: 5000 }).catch(() => {});
check(/Test world \(2\)/.test(await page.textContent('#worldList')), 'imported as a second world');

// 6. Drawn by WebGL, and by Remastered (the same world, kept in this browser).
const others = {};
for (const q of ['game=original&renderer=webgl', 'game=remastered']) {
  const p = await open(q);
  await p.click('#tabWorlds');
  await p.waitForSelector('#worldList .world-card');
  await p.click('#worldList .world-card button[data-act="play"]');
  await alive(p);
  await p.waitForTimeout(1500);
  others[q] = await p.evaluate(() => {
    const { renderer, state } = window.stickSoldiers;
    return { kind: renderer.kind, pictures: renderer.worldView?.pics.size || 0, textures: renderer.worldTex?.size ?? null, theme: renderer.look?.theme?.id ?? null, world: state.game.world.name };
  });
  await p.screenshot({ path: `${outDir}/world-${q.includes('remastered') ? 'remastered' : 'webgl'}.png` });
  await p.keyboard.press('Escape');
  await p.click('#quit');
  await p.close();
}
report.others = others;
check(others['game=original&renderer=webgl'].kind === 'webgl' && others['game=original&renderer=webgl'].textures > 4, `WebGL draws it (${JSON.stringify(others['game=original&renderer=webgl'])})`);
check(others['game=remastered'].kind === 'remastered' && others['game=remastered'].pictures > 4 && others['game=remastered'].theme === 'meadow', `Remastered draws it, in the plains' scenery (${JSON.stringify(others['game=remastered'])})`);

// 7. Deleted.
await page.reload();
await page.waitForFunction(() => window.stickSoldiers);
await page.click('#tabWorlds');
await page.waitForSelector('#worldList .world-card');
const n0 = await page.locator('#worldList .world-card').count();
await page.click('#worldList .world-card button[data-act="delete"]');
await page.waitForFunction(n => document.querySelectorAll('#worldList .world-card').length === n - 1, n0, { timeout: 5000 }).catch(() => {});
check(await page.locator('#worldList .world-card').count() === n0 - 1, 'deleted');

console.log(JSON.stringify({ report, errors }, null, 2));
await browser.close();
server.close();
await relay.close();
if (errors.length) process.exit(1);
