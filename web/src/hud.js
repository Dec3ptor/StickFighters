// Heads-up display, drawn in screen pixels on top of the world.

import { WEAPONS, SLOTS } from './weapons.js';
import { RULES } from './config.js';
import { GUN_GAME_LADDER } from './modes.js';
import { drawObjectiveHud, drawMinimap, bigMap, drawDeploy } from './objdraw.js';

const FONT = 'Arial, Helvetica, sans-serif';
const TEAM = { 1: '#2f6fdb', 2: '#d33b2f' };

/**
 * opts: { showScores, watching (soldier the camera follows when you're out), chat: [{ text, tick }],
 *   online (show everyone's ping on the scoreboard), hostId (the host's soldier),
 *   ping (your ping in ms, or a label like 'Host'), perf (frame rate text) }
 */
export function drawHud(r, game, me, opts = {}) {
  const ctx = r.ctx, d = r.dpr, W = r.w, H = r.h;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.textBaseline = 'middle';

  if (me.alive) {
    drawStatus(ctx, game, me, W, H);
    drawWeaponBar(ctx, me, W, H);
  }

  const standings = game.standings();
  drawScores(ctx, game, me, H, standings);
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

  if (!me.alive && !game.over) {
    ctx.textAlign = 'center';
    ctx.font = `bold 20px ${FONT}`;
    ctx.fillStyle = '#222';
    if (game.rules.canRespawn(game, me)) {
      ctx.fillText(`Respawning in ${Math.max(1, Math.ceil(me.respawnTimer / game.tickRate))}...`, W / 2, H / 2 - 60);
      if (game.rules.deployOptions) drawDeploy(ctx, game, me, W, H / 2 - 30);
    } else {
      ctx.fillText("You're out", W / 2, H / 2 - 70);
      if (opts.watching) {
        ctx.font = `14px ${FONT}`;
        ctx.fillText(`Watching ${opts.watching.name}`, W / 2, H / 2 - 46);
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
  const def = WEAPONS[me.current], inv = me.weapons[me.current];
  if (def && inv) {
    let frac = 1, label = def.name;
    if (def.mag) {
      frac = me.reloadTimer > 0 ? 1 - me.reloadTimer / def.reload : inv.mag / def.mag;
      label = me.reloadTimer > 0 ? `${def.name}: reloading` : `${def.name}  ${inv.mag}/${def.mag}`;
    } else if (inv.ammo !== Infinity && !game.rules.infiniteAmmo) {
      frac = inv.ammo / (def.maxAmmo || def.ammo || 1);
      label = `${def.name}  ${inv.ammo}`;
    }
    bar(ctx, gap / 2, y, half, h, frac, 'ammo', label, true);
  }
  // Anything else, in pairs above it: armour, jet fuel, the minigun spinning up.
  const extra = [];
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
      const def = WEAPONS[show], inv = me.weapons[show];
      ctx.font = `${def.short.length > 8 ? 8 : 10}px ${FONT}`;
      ctx.fillText(def.short, x + size / 2, 24);
      ctx.font = `9px ${FONT}`;
      ctx.fillText(def.mag ? '∞' : inv.ammo === Infinity ? '' : String(inv.ammo), x + size / 2, 37);
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
    const left = game.soldiers.filter(s => (s.lives ?? 1) > 0).length;
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
  list.forEach((s, i) => {
    const ry = y + 70 + i * rowH;
    ctx.font = `${s === me ? 'bold ' : ''}13px ${FONT}`;
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
  });
  if (more) {
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = '#888';
    ctx.textAlign = 'left';
    ctx.fillText(`…and ${more} more`, x + 20, y + 70 + list.length * rowH);
  }
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
