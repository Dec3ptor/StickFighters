// Drawing the world: white paper, black outlines, stick figures.

import { VIEW_W, VIEW_H, MOTION } from './config.js';
import { buildPose } from './stickman.js';
import { laserEnd } from './combat.js';
import { WEAPONS } from './weapons.js';
import { clamp, lerp } from './util.js';

const INK = '#111';
const TEAM_COLORS = { 1: '#2f6fdb', 2: '#d33b2f' };
const TEAM_HEAD = { 1: '#d9e6ff', 2: '#ffdcd8' };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.shake = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    // Show at least the original 800x600 view, scaled to fit the window.
    this.baseScale = Math.min(this.w / VIEW_W, this.h / VIEW_H);
  }

  get scale() { return this.baseScale * this.cam.zoom; }

  screenToWorld(sx, sy) {
    return { x: this.cam.x + (sx - this.w / 2) / this.scale, y: this.cam.y + (sy - this.h / 2) / this.scale };
  }

  /** Jump straight to a point (used at match start). */
  snapCamera(x, y) { this.cam.x = x; this.cam.y = y; }

  /** Follow a point, looking a little toward the mouse; zoomed out while sniping. */
  updateCamera(game, fx, fy, mouse, sniping) {
    const zoomTarget = sniping ? 0.72 : 1;
    this.cam.zoom = lerp(this.cam.zoom, zoomTarget, 0.12);
    let tx = fx, ty = fy - 20;
    if (mouse) {
      const look = sniping ? 0.55 : 0.22;
      tx += clamp((mouse.x - this.w / 2) / this.scale, -400, 400) * look;
      ty += clamp((mouse.y - this.h / 2) / this.scale, -300, 300) * look;
    }
    // Keep the camera over the map.
    const b = game.map.bounds, hw = this.w / 2 / this.scale, hh = this.h / 2 / this.scale;
    const pad = 60;
    tx = b.right - b.left + pad * 2 < hw * 2 ? (b.left + b.right) / 2 : clamp(tx, b.left - pad + hw, b.right + pad - hw);
    ty = b.bottom - b.top + pad * 2 < hh * 2 ? (b.top + b.bottom) / 2 : clamp(ty, b.top - pad + hh, b.bottom + pad - hh);
    this.cam.x = lerp(this.cam.x, tx, 0.14);
    this.cam.y = lerp(this.cam.y, ty, 0.14);
    for (const s of game.shakes) {
      const d = Math.hypot(s.x - fx, s.y - fy);
      this.shake = Math.max(this.shake, s.amount * Math.max(0, 1 - d / 700));
    }
    game.shakes.length = 0;
    this.shake *= 0.85;
  }

  render(game, alpha, viewer) {
    const ctx = this.ctx, s = this.scale * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    ctx.setTransform(s, 0, 0, s, this.canvas.width / 2 - (this.cam.x + sx) * s, this.canvas.height / 2 - (this.cam.y + sy) * s);
    this.lineW = Math.max(1.1, 1.3 / (this.scale));

    this.drawMap(game);
    this.drawStains(game);
    this.drawPickups(game);
    this.drawProjectiles(game, false);
    for (const sol of game.soldiers) if (sol.alive) this.drawSoldier(game, sol, alpha, viewer);
    this.drawProjectiles(game, true);
    this.drawEffects(game);
    for (const sol of game.soldiers) if (sol.alive && sol.current === 'SR') this.drawLaser(game, sol);
    for (const sol of game.soldiers) if (sol.alive) this.drawName(game, sol, alpha, viewer);
  }

  drawMap(game) {
    const ctx = this.ctx, e = this.lineW;
    ctx.fillStyle = INK;
    for (const p of game.map.solids) ctx.fillRect(p.l - e, p.t - e, p.r - p.l + 2 * e, p.b - p.t + 2 * e);
    ctx.fillStyle = '#fff';
    for (const p of game.map.solids) ctx.fillRect(p.l, p.t, p.r - p.l, p.b - p.t);
    // Jump pads: light fill with upward chevrons.
    for (const p of game.map.solids) {
      if (!p.bounce) continue;
      ctx.fillStyle = '#eef3e2';
      ctx.fillRect(p.l, p.t, p.r - p.l, p.b - p.t);
      ctx.strokeStyle = '#7c9a3d';
      ctx.lineWidth = 1.5;
      const pulse = (Date.now() / 400) % 1;
      for (let x = p.l + 10; x < p.r - 4; x += 14) {
        const y = p.t + (p.b - p.t) * 0.65 - pulse * 4;
        ctx.beginPath();
        ctx.moveTo(x - 4, y + 3);
        ctx.lineTo(x, y - 1);
        ctx.lineTo(x + 4, y + 3);
        ctx.stroke();
      }
    }
  }

  drawStains(game) {
    if (!game.fx) return;
    const ctx = this.ctx;
    for (const st of game.fx.stains) {
      ctx.globalAlpha = Math.min(1, st.life / 200) * 0.8;
      ctx.fillStyle = '#a30d0d';
      ctx.fillRect(st.x - st.size / 2, st.y - st.size / 2, st.size, st.size);
    }
    ctx.globalAlpha = 1;
  }

  drawPickups(game) {
    const ctx = this.ctx, t = game.tick;
    for (const it of game.pickups.items) {
      if (!it.active) continue;
      if (it.dropped && it.life < 120 && Math.floor(it.life / 6) % 2) continue;
      const bob = it.dropped ? 0 : Math.sin(t * 0.06 + it.bob) * 1.5;
      ctx.save();
      ctx.translate(it.x, it.y + bob);
      switch (it.type) {
        case 'health': drawHealth(ctx); break;
        case 'armour': drawArmour(ctx); break;
        case 'jetpack': drawJetpack(ctx); break;
        case 'weapon': drawWeapon(ctx, WEAPONS[it.weapon], true); break;
      }
      ctx.restore();
    }
  }

  drawProjectiles(game, top) {
    const ctx = this.ctx;
    for (const p of game.projectiles) {
      if (p.kind === 'flame') { if (top) drawFlame(ctx, p); continue; }
      if (top) continue;
      switch (p.kind) {
        case 'bullet':
          ctx.strokeStyle = 'rgba(40,40,40,0.75)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x - p.vx * 0.7, p.y - p.vy * 0.7);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          break;
        case 'rocket': {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.atan2(p.vy, p.vx));
          ctx.fillStyle = '#ff9a1f';
          ctx.beginPath(); ctx.moveTo(-5, -1.5); ctx.lineTo(-10 - Math.random() * 4, 0); ctx.lineTo(-5, 1.5); ctx.fill();
          ctx.fillStyle = '#3d5a2a';
          ctx.fillRect(-5, -1.8, 9, 3.6);
          ctx.fillStyle = '#222';
          ctx.beginPath(); ctx.moveTo(4, -1.8); ctx.lineTo(7, 0); ctx.lineTo(4, 1.8); ctx.fill();
          ctx.restore();
          break;
        }
        case 'grenade':
          ctx.fillStyle = '#2b2b2b';
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); ctx.fill();
          if (p.life < 60 && Math.floor(p.life / 5) % 2) {
            ctx.fillStyle = '#ff3b2f';
            ctx.beginPath(); ctx.arc(p.x, p.y - 2.5, 1.2, 0, Math.PI * 2); ctx.fill();
          }
          break;
      }
    }
  }

  drawSoldier(game, s, alpha, viewer) {
    const ctx = this.ctx;
    const x = lerp(s.prevX, s.x, alpha), y = lerp(s.prevY, s.y, alpha);
    const pose = buildPose(s);
    ctx.save();
    ctx.translate(x, y);
    if (s.spawnProtect > 0) ctx.globalAlpha = 0.35 + 0.35 * Math.abs(Math.sin(game.tick * 0.25));

    // Jetpack on the back.
    if (s.body.hasJetpack) {
      ctx.fillStyle = '#555';
      const bx = -s.facing * 3.5 + (s.facing > 0 ? -2.5 : 0);
      ctx.fillRect(bx, -14, 2.5, 8);
    }

    // Weapon first, so the front hand overlaps it.
    ctx.save();
    ctx.translate(pose.gun.x, pose.gun.y);
    ctx.rotate(pose.gun.angle);
    if (Math.cos(pose.gun.angle) < 0) ctx.scale(1, -1);
    drawWeapon(ctx, pose.gun.def, false);
    ctx.restore();

    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const [a, b, c, d] of pose.lines) { ctx.moveTo(a, b); ctx.lineTo(c, d); }
    ctx.stroke();
    ctx.fillStyle = game.mode === 'team' ? TEAM_HEAD[s.team] : '#fff';
    ctx.beginPath();
    ctx.arc(pose.head.x, pose.head.y, pose.head.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (s.armour > 0) {
      // A little helmet shows the soldier has armour.
      ctx.fillStyle = '#4a4a4a';
      ctx.beginPath();
      ctx.arc(pose.head.x, pose.head.y - 0.5, pose.head.r + 0.6, Math.PI * 1.05, Math.PI * 1.95);
      ctx.fill();
    }
    if (s.body.jetting) {
      ctx.fillStyle = Math.random() < 0.5 ? '#ffb31f' : '#ff6a1f';
      const bx = -s.facing * 3.5 + (s.facing > 0 ? -1.2 : 1.2);
      ctx.beginPath(); ctx.moveTo(bx - 2, -6); ctx.lineTo(bx, 2 + Math.random() * 5); ctx.lineTo(bx + 2, -6); ctx.fill();
    }
    ctx.restore();
  }

  drawName(game, s, alpha, viewer) {
    const ctx = this.ctx;
    const x = lerp(s.prevX, s.x, alpha), y = lerp(s.prevY, s.y, alpha);
    ctx.font = `${s === viewer ? 'bold ' : ''}8px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = game.mode === 'team' ? TEAM_COLORS[s.team] : s === viewer ? '#333' : '#999';
    ctx.fillText(s.name, x, y - 30);
    if (s !== viewer && s.health < 100) {
      ctx.fillStyle = '#ddd';
      ctx.fillRect(x - 8, y - 28, 16, 1.6);
      ctx.fillStyle = s.health > 40 ? '#555' : '#c22';
      ctx.fillRect(x - 8, y - 28, 16 * Math.max(0, s.health) / 100, 1.6);
    }
  }

  drawLaser(game, s) {
    const ctx = this.ctx;
    const l = laserEnd(game, s);
    ctx.strokeStyle = 'rgba(255,0,0,0.35)';
    ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(l.x0, l.y0); ctx.lineTo(l.x, l.y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,30,30,0.9)';
    ctx.fillRect(l.x - 1.2, l.y - 1.2, 2.4, 2.4);
  }

  drawEffects(game) {
    if (!game.fx) return;
    const ctx = this.ctx;
    for (const p of game.fx.parts) {
      switch (p.kind) {
        case 'blood':
          ctx.fillStyle = '#c40f0f';
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
          break;
        case 'spark':
          ctx.fillStyle = '#444';
          ctx.fillRect(p.x - 0.5, p.y - 0.5, 1, 1);
          break;
        case 'ember':
          ctx.fillStyle = p.life > 15 ? '#ffb02e' : '#c4561a';
          ctx.fillRect(p.x - 0.8, p.y - 0.8, 1.6, 1.6);
          break;
        case 'puff':
          ctx.strokeStyle = `rgba(120,120,120,${0.5 * p.life / p.max})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
          break;
        case 'flash': {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.fillStyle = p.life > 1 ? '#fff3a0' : '#ffb02e';
          ctx.beginPath();
          ctx.moveTo(0, -p.size * 0.35); ctx.lineTo(p.size, 0); ctx.lineTo(0, p.size * 0.35); ctx.lineTo(p.size * 0.3, 0);
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'shell':
          ctx.save();
          ctx.translate(p.x, p.y); ctx.rotate(p.angle);
          ctx.fillStyle = '#c9a227';
          ctx.fillRect(-1.2, -0.5, 2.4, 1);
          ctx.restore();
          break;
        case 'smoke':
          ctx.fillStyle = `rgba(140,140,140,${0.32 * p.life / p.max})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
          break;
        case 'fire': {
          const k = p.life / p.max;
          ctx.fillStyle = k > 0.6 ? `rgba(255,220,90,${k})` : `rgba(255,110,30,${k})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.6 + k * 0.4), 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'boom': {
          const k = p.life / p.max;
          const r = p.r * (1.3 - k * 0.6);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0, `rgba(255,255,220,${k})`);
          g.addColorStop(0.4, `rgba(255,170,40,${k})`);
          g.addColorStop(1, 'rgba(255,90,20,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'trail':
          ctx.strokeStyle = `rgba(90,90,90,${0.7 * p.life / p.max})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x1, p.y1); ctx.stroke();
          break;
        case 'ring': {
          const k = p.life / p.max;
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = k;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, 6 + (1 - k) * 22, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.arc(p.x, p.y, 2 + (1 - k) * 12, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
        case 'gib':
          ctx.globalAlpha = Math.min(1, p.life / 40);
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x - Math.cos(p.angle) * p.len / 2, p.y - Math.sin(p.angle) * p.len / 2);
          ctx.lineTo(p.x + Math.cos(p.angle) * p.len / 2, p.y + Math.sin(p.angle) * p.len / 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        case 'head':
          ctx.globalAlpha = Math.min(1, p.life / 40);
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.globalAlpha = 1;
          break;
      }
    }
  }

  /** Crosshair in screen space. */
  drawCrosshair(mx, my, red) {
    const ctx = this.ctx, d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.strokeStyle = red ? '#e22' : '#111';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(mx + dx * 4, my + dy * 4);
      ctx.lineTo(mx + dx * 10, my + dy * 10);
    }
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fillRect(mx - 1, my - 1, 2, 2);
  }
}

// ---- Shapes -----------------------------------------------------------------

/** A weapon drawn along +x from the grip. `lying` = drawn as a pickup (centred). */
export function drawWeapon(ctx, def, lying) {
  const L = def.look.length, fat = def.look.fat ? 4 : 2.6;
  if (lying) ctx.translate(-L / 2, 0);
  ctx.fillStyle = def.look.color;
  switch (def.kind) {
    case 'rocket':
      ctx.fillRect(-6, -fat / 2, L + 6, fat);
      ctx.fillStyle = '#2b3d1d';
      ctx.fillRect(-7, -fat / 2 - 0.8, 2, fat + 1.6);
      ctx.fillRect(L - 2, -fat / 2 - 0.6, 2.5, fat + 1.2);
      ctx.fillStyle = '#333';
      ctx.fillRect(4, fat / 2, 1.6, 3);
      break;
    case 'flame':
      ctx.fillRect(0, -1.6, L, 2.6);
      ctx.fillStyle = '#b8321c';
      ctx.fillRect(1, 1, 8, 3.6);
      ctx.fillStyle = '#333';
      ctx.fillRect(L - 2, -2, 2.5, 3.6);
      break;
    case 'grenade':
      ctx.fillRect(0, -2, L, 4);
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(4, -2.6, 6, 5.2);
      ctx.fillRect(1, 2, 1.8, 3);
      break;
    case 'rail':
      ctx.fillRect(-4, -1.2, L + 4, 2.4);
      ctx.fillStyle = '#222';
      ctx.fillRect(4, -3.6, 8, 2);
      ctx.fillRect(-1, 1.2, 1.8, 3);
      ctx.fillRect(-6, -1.4, 3, 3.6);
      break;
    case 'pellets':
      ctx.fillRect(-3, -1.3, L + 3, 2.6);
      ctx.fillStyle = '#3a2e22';
      ctx.fillRect(7, 1.1, 6, 1.6);
      ctx.fillRect(-1, 1.1, 1.8, 3);
      break;
    default:
      if (def.look.grip === 0) {
        // Pistol
        ctx.fillRect(4, -1.6, L - 3, 2.8);
        ctx.fillRect(4, 0, 2.2, 3.8);
      } else {
        ctx.fillRect(-2, -1.3, L + 2, 2.6);
        ctx.fillRect(1, 1.1, 1.8, 3.2);
        ctx.fillRect(def.look.grip === 1 ? 6 : 8, 1.1, 2, def.look.grip === 1 ? 4.5 : 3.5);
        if (def.look.grip === 2) ctx.fillRect(-5, -1.3, 3, 3.4);
      }
  }
}

export function drawHealth(ctx) {
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#c22';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.rect(-6, -6, 12, 12); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#d21f1f';
  ctx.fillRect(-1.6, -4.4, 3.2, 8.8);
  ctx.fillRect(-4.4, -1.6, 8.8, 3.2);
}

export function drawArmour(ctx) {
  ctx.fillStyle = '#7d7d7d';
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-6, -6); ctx.lineTo(-2.5, -6); ctx.lineTo(0, -3.5); ctx.lineTo(2.5, -6); ctx.lineTo(6, -6);
  ctx.lineTo(6.5, 6); ctx.lineTo(-6.5, 6); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#555';
  ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.moveTo(-4, 3); ctx.lineTo(4, 3); ctx.stroke();
}

export function drawJetpack(ctx) {
  ctx.fillStyle = '#5b5b5b';
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 0.8;
  for (const x of [-4, 1]) { ctx.beginPath(); ctx.rect(x, -7, 3.5, 11); ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = '#ff8a1f';
  ctx.fillRect(-3.6, 4.5, 2.6, 1.6);
  ctx.fillRect(1.4, 4.5, 2.6, 1.6);
}

function drawFlame(ctx, p) {
  const k = p.age / (p.age + p.life);
  const r = 2.5 + p.age * MOTION.flameGrow;
  ctx.fillStyle = k < 0.35 ? `rgba(255,225,110,0.9)` : k < 0.7 ? `rgba(255,130,30,${0.85 - k * 0.4})` : `rgba(150,60,30,${0.6 - k * 0.5})`;
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
}
