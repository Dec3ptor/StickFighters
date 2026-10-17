// Heads-up display, drawn in screen pixels on top of the world.

import { WEAPONS, WEAPON_ORDER } from './weapons.js';
import { RULES } from './config.js';

const FONT = 'Arial, Helvetica, sans-serif';

export function drawHud(r, game, me, opts = {}) {
  const ctx = r.ctx, d = r.dpr, W = r.w, H = r.h;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.textBaseline = 'middle';

  if (me.alive) {
    let y = 12;
    bar(ctx, 12, y, 150, 15, me.health / RULES.maxHealth, 'health', `Health: ${Math.max(0, Math.ceil(me.health))}%`);
    y += 19;
    if (me.armour > 0) { bar(ctx, 12, y, 150, 15, me.armour / RULES.maxArmour, 'armour', `Armour: ${Math.ceil(me.armour)}%`); y += 19; }
    const def = WEAPONS[me.current], inv = me.weapons[me.current];
    if (def.mag) {
      const label = me.reloadTimer > 0 ? `${def.name}: reloading` : `${def.name}: ${inv.mag}/${def.mag}`;
      bar(ctx, 12, y, 150, 15, me.reloadTimer > 0 ? 1 - me.reloadTimer / def.reload : inv.mag / def.mag, 'ammo', label);
    } else {
      bar(ctx, 12, y, 150, 15, inv.ammo / def.maxAmmo, 'ammo', `${def.name}: ${inv.ammo}`);
    }
    y += 19;
    if (me.body.hasJetpack) { bar(ctx, 12, y, 150, 15, me.body.fuel / 100, 'fuel', `Jet fuel: ${Math.round(me.body.fuel)}%`); y += 19; }
    if (me.burnTicks > 0) {
      ctx.font = `bold 13px ${FONT}`;
      ctx.fillStyle = '#e5641a';
      ctx.textAlign = 'left';
      ctx.fillText('On fire! Find health', 12, y + 8);
    }
    drawWeaponBar(ctx, me, W, H);
  }

  drawScores(ctx, game, me, H);
  drawFeed(ctx, game, W);
  drawTop(ctx, game, me, W);

  // Messages for the player ("You got the Sniper Rifle").
  const notes = game.over ? [] : game.notes.filter(n => game.tick - n.tick < 150).slice(-3);
  ctx.textAlign = 'center';
  notes.forEach((n, i) => {
    const age = game.tick - n.tick;
    ctx.globalAlpha = Math.min(1, (150 - age) / 30);
    ctx.font = `14px ${FONT}`;
    ctx.fillStyle = '#222';
    ctx.fillText(n.text, W / 2, H * 0.3 + i * 20);
  });
  ctx.globalAlpha = 1;

  if (!me.alive && !game.over) {
    ctx.textAlign = 'center';
    ctx.font = `bold 20px ${FONT}`;
    ctx.fillStyle = '#222';
    ctx.fillText(`Respawning in ${Math.max(1, Math.ceil(me.respawnTimer / game.tickRate))}...`, W / 2, H / 2 - 60);
  }

  if (opts.showScores || game.over) drawScoreboard(ctx, game, me, W, H);
}

const BAR_COLORS = {
  health: ['#e02020', '#5c0f0f'],
  armour: ['#3f9a3a', '#1c4a1a'],
  ammo: ['#a39a1f', '#4a4510'],
  fuel: ['#2f74d0', '#163a6b'],
};

/** A bar like the original's: bright fill on a dark track, white label on top. */
function bar(ctx, x, y, w, h, frac, kind, label) {
  const [fg, bg] = BAR_COLORS[kind];
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fg;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  ctx.font = `11px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  ctx.fillText(label, x + 6, y + h / 2 + 1);
}

function drawWeaponBar(ctx, me, W, H) {
  const size = 42, gap = 4, n = WEAPON_ORDER.length;
  const x0 = W / 2 - (n * size + (n - 1) * gap) / 2, y = H - size - 10;
  WEAPON_ORDER.forEach((id, i) => {
    const def = WEAPONS[id], x = x0 + i * (size + gap);
    const owned = me.has(id), current = me.current === id;
    ctx.fillStyle = current ? 'rgba(30,30,30,0.88)' : owned ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)';
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = owned ? '#333' : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    ctx.textAlign = 'left';
    ctx.font = `bold 10px ${FONT}`;
    ctx.fillStyle = current ? '#fff' : owned ? '#333' : 'rgba(0,0,0,0.25)';
    ctx.fillText(String(i + 1), x + 4, y + 9);
    ctx.textAlign = 'center';
    ctx.font = `10px ${FONT}`;
    ctx.fillText(SHORT[id], x + size / 2, y + 22);
    if (owned) {
      const inv = me.weapons[id];
      ctx.font = `9px ${FONT}`;
      ctx.fillText(def.mag ? '∞' : String(inv.ammo), x + size / 2, y + 34);
    }
  });
}

const SHORT = { Platinum: 'Pistol', Uzi: 'Uzi', M4: 'M4', Shotgun: 'Shotgun', SR: 'Sniper', GrenadeLauncher: 'Grenades', Bazooka: 'Bazooka', Flamer: 'Flamer' };

function drawScores(ctx, game, me, H) {
  const list = game.standings().slice(0, 8);
  ctx.textAlign = 'left';
  list.forEach((s, i) => {
    ctx.font = `${s === me ? 'bold ' : ''}12px ${FONT}`;
    ctx.fillStyle = game.mode === 'team' ? (s.team === 1 ? '#2f6fdb' : '#d33b2f') : '#333';
    ctx.fillText(`${s.name}: ${s.frags}`, 12, H - 16 - (list.length - 1 - i) * 15);
  });
}

function drawFeed(ctx, game, W) {
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
}

function drawTop(ctx, game, me, W) {
  ctx.textAlign = 'center';
  ctx.font = `bold 14px ${FONT}`;
  if (game.mode === 'team') {
    ctx.fillStyle = '#2f6fdb';
    ctx.fillText(`Blue ${game.teamScore[1]}`, W / 2 - 50, 16);
    ctx.fillStyle = '#999';
    ctx.fillText(`/ ${game.fragLimit}`, W / 2, 16);
    ctx.fillStyle = '#d33b2f';
    ctx.fillText(`Red ${game.teamScore[2]}`, W / 2 + 50, 16);
  } else {
    const rank = game.standings().indexOf(me) + 1;
    ctx.fillStyle = '#333';
    ctx.fillText(`${me.frags} / ${game.fragLimit} frags  ·  ${ordinal(rank)} place`, W / 2, 16);
  }
}

function drawScoreboard(ctx, game, me, W, H) {
  const list = game.standings();
  const w = 360, rowH = 22, h = 70 + list.length * rowH;
  const x = W / 2 - w / 2, y = Math.max(40, H / 2 - h / 2 - 40);
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
  ctx.textAlign = 'center';
  ctx.font = `bold 16px ${FONT}`;
  ctx.fillStyle = '#111';
  let title = 'Scores';
  if (game.over) {
    title = game.winner.team ? `${game.winner.team === 1 ? 'Blue' : 'Red'} team wins!` : `${game.winner.soldier === me ? 'You win!' : game.winner.soldier.name + ' wins!'}`;
  }
  ctx.fillText(title, W / 2, y + 22);
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = '#888';
  ctx.textAlign = 'left';
  ctx.fillText('Name', x + 20, y + 48);
  ctx.textAlign = 'right';
  ctx.fillText('Frags', x + w - 90, y + 48);
  ctx.fillText('Deaths', x + w - 20, y + 48);
  list.forEach((s, i) => {
    const ry = y + 70 + i * rowH;
    ctx.font = `${s === me ? 'bold ' : ''}13px ${FONT}`;
    ctx.fillStyle = game.mode === 'team' ? (s.team === 1 ? '#2f6fdb' : '#d33b2f') : '#222';
    ctx.textAlign = 'left';
    ctx.fillText(s.name, x + 20, ry);
    ctx.textAlign = 'right';
    ctx.fillText(String(s.frags), x + w - 90, ry);
    ctx.fillText(String(s.deaths), x + w - 20, ry);
  });
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
