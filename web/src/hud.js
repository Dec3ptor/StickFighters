// Heads-up display, drawn in screen pixels on top of the world.

import { WEAPONS, SLOTS } from './weapons.js';
import { RULES } from './config.js';
import { GUN_GAME_LADDER } from './modes.js';
import { drawObjectiveHud, drawMinimap, bigMap, drawDeploy, drawMoney } from './objdraw.js';
import { moneyOf } from './defuse.js';
import { CLASSES, weaponFor } from './classes.js';
import { GADGETS, rechargeTicks } from './gadgets.js';

const FONT = 'Arial, Helvetica, sans-serif';
const TEAM = { 1: '#2f6fdb', 2: '#d33b2f' };

/**
 * opts: { showScores, watching (soldier the camera follows when you're out), chat: [{ text, tick }],
 *   online (show everyone's ping on the scoreboard), hostId (the host's soldier),
 *   ping (your ping in ms, or a label like 'Host'), perf (frame rate text),
 *   picking (the class picker is open), spectating ({ free (the free camera), target (who it follows) }) }
 * With classes on, while you wait to respawn this sets r.classButton (screen px) to the
 * "change class" box, so a click on it can open the class picker.
 */
export function drawHud(r, game, me, opts = {}) {
  const ctx = r.ctx, d = r.dpr, W = r.w, H = r.h;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.textBaseline = 'middle';

  // Blinded by a flashbang: the screen goes white, and clears as it wears off.
  if (me.alive && me.flashTicks > 0) {
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = Math.min(1, me.flashTicks / 75);
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  if (me.alive) {
    drawStatus(ctx, game, me, W, H);
    drawWeaponBar(ctx, me, W, H);
  }

  const standings = game.standings();
  // (Defuse: your money where the scores go; Tab shows everyone.)
  if (game.mode === 'defuse' && game.modeState) drawMoney(ctx, game, me, W, H);
  else drawScores(ctx, game, me, H, standings);
  drawFeed(ctx, game, W, opts.chat);
  drawTop(ctx, game, me, W, standings, r, H);
  if (bigMap(game.map) && !game.over) drawMinimap(r, ctx, game, me, W);
  // Fog of war: sounds from out of sight, off screen.
  r.fogNow?.drawEdgeAlerts(ctx, r, W, H);

  // Messages for the player ("You got the Sniper Rifle").
  const notes = game.over ? [] : game.notes.filter(n => (n.to == null || n.to === me.id) && game.tick - n.tick < 150).slice(-3);
  ctx.textAlign = 'center';
  notes.forEach((n, i) => {
    const age = game.tick - n.tick;
    ctx.globalAlpha = Math.min(1, (150 - age) / 30);
    ctx.font = `14px ${FONT}`;
    ctx.fillStyle = '#222';
    ctx.fillText(n.text, W / 2, H * 0.3 + i * 20);
  });
  ctx.globalAlpha = 1;

  if (me.alive && opts.selfDestruct > 0) {
    // Holding K: how long until it goes off.
    const w = 160, x = W / 2 - w / 2, y = H / 2 - 70;
    ctx.textAlign = 'center';
    ctx.font = `bold 14px ${FONT}`;
    ctx.fillStyle = '#c22';
    ctx.fillText('Self-destructing...', W / 2, y - 8);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(x, y, w, 6);
    ctx.fillStyle = '#c22';
    ctx.fillRect(x, y, w * Math.min(1, opts.selfDestruct), 6);
  }

  r.classButton = null;
  if (opts.spectating && !game.over) drawSpectating(ctx, game, opts.spectating, W, H);
  else if (!me.alive && !game.over) {
    ctx.textAlign = 'center';
    ctx.font = `bold 20px ${FONT}`;
    ctx.fillStyle = '#222';
    if (game.rules.canRespawn(game, me)) {
      const waiting = me.holdSpawn > 0 || opts.picking;
      ctx.fillText(waiting ? 'Choosing a class…' : `Respawning in ${Math.max(1, Math.ceil(me.respawnTimer / game.tickRate))}...`, W / 2, H / 2 - 60);
      const deploy = game.deployOptions(me);
      if (deploy) drawDeploy(ctx, game, me, W, H / 2 - 30);
      if (game.classesOn) r.classButton = drawClassChoice(ctx, me, W, deploy ? H / 2 + 34 : H / 2 - 30);
    } else {
      ctx.fillText(game.rules.outText?.(game, me) ?? "You're out", W / 2, H / 2 - 70);
      if (opts.watching) {
        ctx.font = `14px ${FONT}`;
        ctx.fillText(`Watching ${opts.watching.name}`, W / 2, H / 2 - 46);
        ctx.font = `12px ${FONT}`;
        ctx.fillStyle = '#777';
        ctx.fillText('A / D or click: watch someone else', W / 2, H / 2 - 26);
      }
    }
  }

  if (opts.ping != null) {
    const ms = typeof opts.ping === 'number';
    ctx.textAlign = 'right';
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = ms && opts.ping > 200 ? '#c22' : '#999';
    ctx.fillText(ms ? `Ping ${Math.round(opts.ping)} ms` : String(opts.ping), W - 12, H - 12);
  }
  if (opts.perf) {
    ctx.textAlign = 'right';
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = '#999';
    ctx.fillText(opts.perf, W - 12, H - (opts.ping != null ? 26 : 12));
  }

  if (opts.showScores || game.over) drawScoreboard(ctx, game, me, W, H, opts, standings);
}

const BAR_COLORS = {
  health: ['#e02020', '#5c0f0f'],
  armour: ['#3f9a3a', '#1c4a1a'],
  ammo: ['#a39a1f', '#4a4510'],
  fuel: ['#2f74d0', '#163a6b'],
  stamina: ['#2fb3a0', 'rgba(0,0,0,0.18)'],
  winded: ['#d8862a', 'rgba(0,0,0,0.18)'],
  gadget: ['#6d4fc2', '#2e2352'],
  gadgetReady: ['#8c62e8', '#2e2352'],
};

// The weapon bar's boxes (drawWeaponBar), and where it sits: centred at the bottom,
// shrunk to fit narrow screens.
const SLOT_SIZE = 46, SLOT_GAP = 4;
function weaponBarScale(W) {
  const total = SLOTS.length * SLOT_SIZE + (SLOTS.length - 1) * SLOT_GAP;
  return Math.min(1, (W - 24) / total);
}

/**
 * Health, armour, ammo, jet fuel and stamina: just above the weapon bar, in the
 * middle at the bottom of the screen, where your eyes are anyway.
 */
function drawStatus(ctx, game, me, W, H) {
  const k = weaponBarScale(W);
  const half = 172, gap = 8, h = 20;
  ctx.save();
  ctx.translate(W / 2, H - (SLOT_SIZE + 10) * k - 6 * k);
  ctx.scale(k, k);
  // Stamina: a thin strip right above the weapon bar, shown while it isn't full.
  const b = me.body;
  if (b.stamina < 100 || b.sprinting) {
    bar(ctx, -half - gap / 2, -5, half * 2 + gap, 5, b.stamina / 100, b.winded ? 'winded' : 'stamina', '');
  }
  // The main row: health on the left, the weapon in hand on the right.
  let y = -11 - h;
  bar(ctx, -half - gap / 2, y, half, h, me.health / RULES.maxHealth, 'health', `Health ${Math.max(0, Math.ceil(me.health))}%`, true);
  // (With the soldier's upgrade: Extended mag holds more.)
  const def = weaponFor(me, me.current), inv = me.weapons[me.current];
  if (def && inv) {
    let frac = 1, label = def.name;
    if (def.mag) {
      // (With spare ammo: what's in the magazine, then what's left to reload with.)
      const spare = inv.ammo === Infinity ? '' : `  ·  ${inv.ammo}`;
      frac = me.reloadTimer > 0 ? 1 - me.reloadTimer / def.reload : inv.mag / def.mag;
      label = me.reloadTimer > 0 ? `${def.name}: reloading${spare}` : `${def.name}  ${inv.mag}/${def.mag}${spare}`;
    } else if (def.tool) {
      // The Builder: blocks left.
      frac = inv.ammo / (me.kitAmmo?.[me.current] || def.maxAmmo || 1);
      label = `${def.name}  ${inv.ammo} block${inv.ammo === 1 ? '' : 's'}`;
    } else if (inv.ammo !== Infinity && !game.rules.infiniteAmmo) {
      frac = inv.ammo / (def.maxAmmo || def.ammo || 1);
      label = `${def.name}  ${inv.ammo}`;
    }
    bar(ctx, gap / 2, y, half, h, frac, 'ammo', label, true);
  }
  // Anything else, in pairs above it: your class and gadget (classes on), armour, jet fuel, the minigun spinning up.
  const extra = [];
  const gadget = game.classesOn && gadgetBar(game, me);
  if (gadget) extra.push(gadget);
  if (me.armour > 0) extra.push([me.armour / RULES.maxArmour, 'armour', `Armour ${Math.ceil(me.armour)}%`]);
  if (b.hasJetpack) extra.push([b.fuel / 100, 'fuel', `Jet fuel ${Math.round(b.fuel)}%`]);
  if (def?.spinup && me.spin > 0 && me.spin < def.spinup) extra.push([me.spin / def.spinup, 'fuel', 'Spinning up…']);
  for (let i = 0; i < extra.length; i++) {
    if (i % 2 === 0) y -= 18;
    const [frac, kind, label] = extra[i];
    bar(ctx, i % 2 === 0 ? -half - gap / 2 : gap / 2, y, half, 15, frac, kind, label);
  }
  if (me.burnTicks > 0) {
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillStyle = '#e5641a';
    ctx.textAlign = 'center';
    ctx.fillText('On fire! Find health', 0, y - 12);
  }
  ctx.restore();
}

/** Classes on: your class, and your gadget's charge ("Assault · Medkit (G)" when it's ready). */
function gadgetBar(game, me) {
  const c = CLASSES[me.cls];
  const g = c && GADGETS[c.gadget];
  if (!g) return null;
  if (g.tool) {
    // The Builder: blocks left, and (in hand) what a click puts up.
    const n = me.weapons[g.tool]?.ammo || 0, full = me.kitAmmo?.[g.tool] || WEAPONS[g.tool].maxAmmo || 1;
    const text = me.current === g.tool ? `${me.buildPlank ? 'Plank · right click: wall' : 'Wall · right click: plank'}` : `${c.name} · ${g.name} (G)`;
    return [n / full, n > 0 ? 'gadgetReady' : 'gadget', text];
  }
  const total = rechargeTicks(game, g), left = Math.max(0, me.gadgetCharge || 0);
  if (left > 0) return [1 - left / total, 'gadget', `${c.name} · ${g.name} ${Math.floor(100 * (1 - left / total))}%`];
  const up = c.gadget === 'beacon' && game.beacons?.some(b => b.owner === me.id);
  return [1, 'gadgetReady', `${c.name} · ${up ? 'Move beacon' : g.name} (G)`];
}

/** Waiting to respawn with classes on: your class, and how to change it (a box you can click). */
function drawClassChoice(ctx, me, W, y) {
  const now = CLASSES[me.cls]?.name, next = CLASSES[me.pickCls]?.name;
  const text = next && next !== now ? `Next life: ${next}` : `Class: ${now || next || '?'}`;
  ctx.font = `bold 13px ${FONT}`;
  const label = `${text}   ·   C to change`;
  const w = ctx.measureText(label).width + 28, h = 26, x = W / 2 - w / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#222';
  ctx.textAlign = 'center';
  ctx.fillText(label, W / 2, y + h / 2 + 1);
  return { x, y, w, h };
}

/**
 * Spectating: who the camera follows (their health and weapon), or the free
 * camera, and how to switch, at the bottom of the screen.
 */
function drawSpectating(ctx, game, sp, W, H) {
  const t = sp.free ? null : sp.target;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(W / 2 - 250, H - 86, 500, 74);
  ctx.font = `bold 16px ${FONT}`;
  ctx.fillStyle = t && game.rules.teams ? TEAM[t.team] : '#222';
  ctx.fillText(sp.free ? 'Spectating · free camera' : t ? `Spectating ${t.name}` : 'Spectating · nobody to watch right now', W / 2, H - 70);
  if (t) {
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = '#444';
    const gun = WEAPONS[t.current];
    ctx.fillText(`${Math.max(0, Math.ceil(t.health))} health${t.armour > 0 ? ` · ${Math.ceil(t.armour)} armour` : ''}${gun ? ` · ${gun.name}` : ''}`, W / 2, H - 50);
  }
  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = '#777';
  ctx.fillText(sp.free
    ? 'WASD or arrows: move (Shift: faster)  ·  Space or click: follow a player  ·  Esc: join game'
    : 'A / D or click: switch player  ·  Space: free camera  ·  Esc: join game', W / 2, H - 28);
}

/** A bar like the original's: bright fill on a dark track, white label on top (bold: bigger). */
function bar(ctx, x, y, w, h, frac, kind, label, bold = false) {
  const [fg, bg] = BAR_COLORS[kind];
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fg;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  if (!label) return;
  ctx.font = bold ? `bold 12px ${FONT}` : `11px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  ctx.fillText(label, x + 6, y + h / 2 + 1);
}

/** One box per slot (1-9, 0, F): what you hold from it, and how many weapons you have there. */
function drawWeaponBar(ctx, me, W, H) {
  const size = SLOT_SIZE, gap = SLOT_GAP, n = SLOTS.length;
  const total = n * size + (n - 1) * gap;
  const scale = weaponBarScale(W);
  ctx.save();
  ctx.translate(W / 2 - (total * scale) / 2, H - (size + 10) * scale);
  ctx.scale(scale, scale);
  const owned = Object.keys(me.weapons).filter(id => WEAPONS[id] && me.has(id));
  SLOTS.forEach((slot, i) => {
    const x = i * (size + gap);
    const mine = owned.filter(id => WEAPONS[id].slot === i);
    const current = WEAPONS[me.current]?.slot === i;
    const show = current ? me.current : mine.includes(me.lastInSlot[i]) ? me.lastInSlot[i] : mine[0];
    ctx.fillStyle = current ? 'rgba(30,30,30,0.88)' : mine.length ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)';
    ctx.fillRect(x, 0, size, size);
    ctx.strokeStyle = mine.length ? '#333' : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, 0.5, size - 1, size - 1);
    ctx.textAlign = 'left';
    ctx.font = `bold 10px ${FONT}`;
    ctx.fillStyle = current ? '#fff' : mine.length ? '#333' : 'rgba(0,0,0,0.25)';
    ctx.fillText(slot.key, x + 4, 9);
    if (mine.length > 1) {
      ctx.textAlign = 'right';
      ctx.font = `9px ${FONT}`;
      ctx.fillText(`${mine.length}`, x + size - 4, 9);
    }
    ctx.textAlign = 'center';
    if (show) {
      const def = weaponFor(me, show), inv = me.weapons[show];
      ctx.font = `${def.short.length > 8 ? 8 : 10}px ${FONT}`;
      ctx.fillText(def.short, x + size / 2, 24);
      ctx.font = `9px ${FONT}`;
      ctx.fillText(def.mag ? (inv.ammo === Infinity ? '∞' : `${inv.mag}/${inv.ammo}`) : inv.ammo === Infinity ? '' : String(inv.ammo), x + size / 2, 37);
    } else {
      ctx.font = `9px ${FONT}`;
      ctx.fillText(slot.name.split(' ')[0], x + size / 2, 26);
    }
  });
  ctx.restore();
}

function drawScores(ctx, game, me, H, standings) {
  const list = standings.slice(0, 8);
  const rules = game.rules;
  ctx.textAlign = 'left';
  list.forEach((s, i) => {
    ctx.font = `${s === me ? 'bold ' : ''}12px ${FONT}`;
    ctx.fillStyle = rules.teams ? TEAM[s.team] : '#333';
    const extra = rules.scoreLabel === 'Frags' ? s.frags : `${rules.scoreLabel.toLowerCase()} ${rules.score(s)}`;
    ctx.fillText(`${s.name}: ${extra}`, 12, H - 70 - (list.length - 1 - i) * 15);
  });
}

function drawFeed(ctx, game, W, chat = []) {
  const items = game.feed.filter(f => game.tick - f.tick < 360).slice(-5);
  ctx.textAlign = 'right';
  ctx.font = `12px ${FONT}`;
  items.forEach((f, i) => {
    const age = game.tick - f.tick;
    ctx.globalAlpha = Math.min(1, (360 - age) / 60);
    ctx.fillStyle = '#c21b1b';
    ctx.fillText(f.text + (f.weapon ? ` (${f.weapon})` : ''), W - 12, 16 + i * 16);
  });
  ctx.globalAlpha = 1;
  const now = performance.now();
  const lines = chat.filter(c => now - c.time < 12000).slice(-6);
  ctx.textAlign = 'left';
  lines.forEach((c, i) => {
    ctx.globalAlpha = Math.min(1, (12000 - (now - c.time)) / 1500);
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = c.system ? '#777' : '#1a1a1a';
    ctx.fillText(c.system ? c.text : `${c.name}: ${c.text}`, 180, 20 + i * 16);
  });
  ctx.globalAlpha = 1;
}

function drawTop(ctx, game, me, W, standings, r, H) {
  const rules = game.rules;
  if (rules.objective) { drawObjectiveHud(r, ctx, game, me, W, H); return; }
  ctx.textAlign = 'center';
  ctx.font = `bold 14px ${FONT}`;
  if (rules.teams) {
    ctx.fillStyle = TEAM[1];
    ctx.fillText(`Blue ${game.teamScore[1]}`, W / 2 - 50, 16);
    ctx.fillStyle = '#999';
    ctx.fillText(`/ ${game.fragLimit}`, W / 2, 16);
    ctx.fillStyle = TEAM[2];
    ctx.fillText(`Red ${game.teamScore[2]}`, W / 2 + 50, 16);
    return;
  }
  const rank = standings.indexOf(me) + 1;
  ctx.fillStyle = '#333';
  if (game.mode === 'gungame') {
    const lvl = Math.min(me.level || 0, GUN_GAME_LADDER.length - 1);
    const next = GUN_GAME_LADDER[lvl + 1];
    ctx.fillText(`Weapon ${lvl + 1} of ${GUN_GAME_LADDER.length}: ${WEAPONS[GUN_GAME_LADDER[lvl]].name}  ·  ${ordinal(rank)} place`, W / 2, 16);
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = '#777';
    ctx.fillText(next ? `Next: ${WEAPONS[next].name}` : 'Get a kill to win!', W / 2, 34);
  } else if (game.mode === 'oitc') {
    const left = game.soldiers.filter(s => !s.spectating && (s.lives ?? 1) > 0).length;
    const bullets = me.weapons.Chamber?.ammo ?? 0;
    ctx.fillText(`Lives: ${me.lives ?? 0}  ·  Bullets: ${me.alive ? bullets : '-'}  ·  ${left} still in`, W / 2, 16);
  } else {
    ctx.fillText(`${me.frags} / ${game.fragLimit} frags  ·  ${ordinal(rank)} place`, W / 2, 16);
  }
}

function drawScoreboard(ctx, game, me, W, H, opts, standings) {
  // Huge games: the top 20, then you (if you're further down).
  const TOP = 20;
  let list = standings, more = 0;
  if (list.length > TOP + 2) {
    more = list.length - TOP;
    list = list.slice(0, TOP);
    if (!list.includes(me) && me) { list.push(me); more--; }
  }
  const rules = game.rules;
  const extra = rules.scoreLabel !== 'Frags';
  // Columns from the right: [heading, value(soldier), colour(soldier)?]
  const cols = [];
  if (opts.online) cols.push(['Ping', pingText, s => (s.ping > 200 && !s.isBot && s.id !== opts.hostId ? '#c22' : null)]);
  cols.push(['Deaths', s => String(s.deaths)], ['Frags', s => String(s.frags)]);
  if (extra) cols.push([rules.scoreLabel, s => String(rules.score(s))]);
  if (game.classesOn) cols.push(['Class', s => CLASSES[s.cls]?.name ?? '']);
  // Defuse: your teammates' money (not the other team's).
  if (game.mode === 'defuse' && game.modeState) cols.push(['Money', s => (s.team === me.team ? `$${moneyOf(game, s)}` : '')]);
  function pingText(s) {
    if (s.isBot) return '';
    if (s.id === opts.hostId) return 'host';
    return s.ping == null ? '–' : String(Math.round(s.ping));
  }
  const w = 300 + cols.length * 65, rowH = 22, h = 70 + list.length * rowH + (more ? rowH : 0);
  const colX = i => x + w - 20 - i * 65;
  const x = W / 2 - w / 2, y = Math.max(40, H / 2 - h / 2 - 40);
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
  ctx.textAlign = 'center';
  ctx.font = `bold 16px ${FONT}`;
  ctx.fillStyle = '#111';
  let title = opts.title || 'Scores';
  if (game.over && game.winner) {
    title = game.winner.team ? `${game.winner.team === 1 ? 'Blue' : 'Red'} team wins!` : `${game.winner.soldier === me ? 'You win!' : game.winner.soldier.name + ' wins!'}`;
  }
  ctx.fillText(title, W / 2, y + 22);
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = '#888';
  ctx.textAlign = 'left';
  ctx.fillText('Name', x + 20, y + 48);
  ctx.textAlign = 'right';
  cols.forEach(([head], i) => ctx.fillText(head, colX(i), y + 48));
  // (Round by round: the dead are greyed out until the next round.)
  const rounds = game.mode === 'defuse' && !game.over;
  list.forEach((s, i) => {
    const ry = y + 70 + i * rowH;
    ctx.font = `${s === me ? 'bold ' : ''}13px ${FONT}`;
    ctx.globalAlpha = rounds && !s.alive && !s.spectating ? 0.45 : 1;
    const color = rules.teams ? TEAM[s.team] : '#222';
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(s.name, x + 20, ry);
    const nameW = ctx.measureText(s.name).width;
    ctx.textAlign = 'right';
    cols.forEach(([, value, tint], c) => {
      ctx.fillStyle = tint?.(s) || color;
      ctx.fillText(value(s), colX(c), ry);
    });
    if (s.isBot) { ctx.fillStyle = '#aaa'; ctx.font = `10px ${FONT}`; ctx.textAlign = 'left'; ctx.fillText('bot', x + 26 + nameW, ry); }
    else if (s.spectating) { ctx.fillStyle = '#999'; ctx.font = `10px ${FONT}`; ctx.textAlign = 'left'; ctx.fillText('spectating', x + 26 + nameW, ry); }
  });
  ctx.globalAlpha = 1;
  if (more) {
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = '#888';
    ctx.textAlign = 'left';
    ctx.fillText(`…and ${more} more`, x + 20, y + 70 + list.length * rowH);
  }
  if (game.mode === 'defuse') drawRounds(ctx, game, W / 2, y + h + 8);
}

/**
 * Defuse: the rounds so far, under the scores (as Counter-Strike shows them): who won
 * each, and how (wiped out, bomb, defused, time).
 */
function drawRounds(ctx, game, cx, y) {
  const list = game.modeState?.history || [];
  if (!list.length) return;
  const size = 16, gap = 3, n = Math.min(list.length, 30), shown = list.slice(-n);
  const w = n * (size + gap) - gap;
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillRect(cx - w / 2 - 8, y, w + 16, size + 30);
  ctx.textAlign = 'center';
  ctx.font = `10px ${FONT}`;
  ctx.fillStyle = '#888';
  ctx.fillText('Rounds', cx, y + 9);
  shown.forEach((h, i) => {
    const team = +h[0], how = h[2];
    const x = cx - w / 2 + i * (size + gap), by = y + 18, mx = x + size / 2, my = by + size / 2;
    ctx.fillStyle = TEAM[team] || '#888';
    ctx.fillRect(x, by, size, size);
    ctx.fillStyle = ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    if (how === 't') {
      // Time ran out: a little clock.
      ctx.beginPath(); ctx.arc(mx, my, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx, my - 3.5); ctx.lineTo(mx, my); ctx.lineTo(mx + 2.5, my); ctx.stroke();
    } else {
      // Wiped out (×), the bomb went off (B), or it was defused (D).
      ctx.font = `bold ${how === 'e' ? 13 : 10}px ${FONT}`;
      ctx.fillText(how === 'e' ? '×' : how === 'b' ? 'B' : 'D', mx, my + 1);
    }
  });
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
