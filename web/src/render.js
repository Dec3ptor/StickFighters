// Drawing the world: white paper, black outlines, stick figures.

import { VIEW_W, VIEW_H, MOTION } from './config.js';
import { buildPose } from './stickman.js';
import { laserEnd } from './combat.js';
import { WEAPONS } from './weapons.js';
import { clamp, lerp } from './util.js';
import { drawWeapon, drawHealth, drawArmour, drawJetpack, drawSprite, drawCrate, drawSupply, drawBeacon } from './sprites.js';
import { BEACON_HP } from './gadgets.js';
import { drawObjectives, drawCarried } from './objdraw.js';
import { fillSeams, hatch, courses } from './map.js';
import { buildPlan } from './building.js';
import { Fog } from './fog.js';

export { drawWeapon, drawHealth, drawArmour, drawJetpack, drawSprite, drawCrate };

const INK = '#111';
// Destructible maps: the hatching on blocks that can't be destroyed.
export const HATCH = '#dcdcdc', HATCH_GAP = 10;
// Blocks soldiers built (the Engineer's Builder): rows of sandbags.
export const BUILT = '#efe5cf', BUILT_LINE = '#c4ae86', BUILT_ROW = 6;
const TEAM_COLORS = { 1: '#2f6fdb', 2: '#d33b2f' };
const TEAM_HEAD = { 1: '#d9e6ff', 2: '#ffdcd8' };

/** Draws with the browser's 2D canvas. (glrender.js draws the same things with WebGL.) */
export class Renderer {
  constructor(canvas, ctx = canvas.getContext('2d')) {
    this.kind = 'canvas';
    this.canvas = canvas;
    this.ctx = ctx;
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.shake = 0;
    this.resize();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
  }

  /** Stop using this renderer (Settings switched to another). */
  destroy() {
    window.removeEventListener('resize', this.onResize);
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.pw = Math.round(this.w * this.dpr);
    this.ph = Math.round(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.applySize();
    this.blank = false;
    // Show at least the original 800x600 view, scaled to fit the window.
    this.baseScale = Math.min(this.w / VIEW_W, this.h / VIEW_H);
  }

  applySize() {
    this.canvas.width = this.pw;
    this.canvas.height = this.ph;
  }

  /** Nothing playing: a blank page behind the menus (drawn once, not every frame). */
  clear() {
    if (this.blank) return;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.blank = true;
  }

  /** Show the frame (a canvas shows what's drawn straight away). */
  present() {}

  get scale() { return this.baseScale * this.cam.zoom; }

  screenToWorld(sx, sy) {
    return { x: this.cam.x + (sx - this.w / 2) / this.scale, y: this.cam.y + (sy - this.h / 2) / this.scale };
  }

  /** Jump straight to a point (used at match start). */
  snapCamera(x, y) { this.cam.x = x; this.cam.y = y; }

  /**
   * Follow a point, looking a little toward the mouse; zoomed out while sniping.
   * dt: milliseconds since the last frame (the camera moves the same at any frame rate).
   */
  updateCamera(game, fx, fy, mouse, sniping, dt = 1000 / 60) {
    const f = dt / (1000 / 60);
    const ease = k => 1 - Math.pow(1 - k, f);
    const zoomTarget = sniping ? 0.72 : 1;
    this.cam.zoom = lerp(this.cam.zoom, zoomTarget, ease(0.12));
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
    this.cam.x = lerp(this.cam.x, tx, ease(0.14));
    this.cam.y = lerp(this.cam.y, ty, ease(0.14));
    for (const s of game.shakes) {
      const d = s.x == null ? 0 : Math.hypot(s.x - fx, s.y - fy);
      this.shake = Math.max(this.shake, s.amount * Math.max(0, 1 - d / 700));
    }
    game.shakes.length = 0;
    this.shake *= Math.pow(0.85, f);
  }

  render(game, alpha, viewer) {
    const ctx = this.ctx, s = this.scale * this.dpr;
    this.blank = false;
    this.alpha = alpha;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    ctx.setTransform(s, 0, 0, s, this.canvas.width / 2 - (this.cam.x + sx) * s, this.canvas.height / 2 - (this.cam.y + sy) * s);
    this.updateView(s, this.canvas.width / 2 - (this.cam.x + sx) * s, this.canvas.height / 2 - (this.cam.y + sy) * s);
    this.lineW = Math.max(1.1, 1.3 / (this.scale));

    const fog = this.startFog(game, alpha, viewer);
    this.drawMap(game);
    this.drawStains(game);
    drawObjectives(this, game);
    this.drawPickups(game);
    this.drawProjectiles(game, false);
    const shown = this.shownSoldiers(game, viewer);
    for (const sol of shown.soldiers) this.drawSoldier(game, sol, alpha, viewer);
    drawCarried(this, game);
    this.drawProjectiles(game, true);
    this.drawEffects(game);
    for (const sol of shown.soldiers) if (sol.current === 'SR') this.drawLaser(game, sol);
    this.drawBuildGhost(game, viewer);
    for (const sol of shown.names) this.drawName(game, sol, alpha, viewer);
    fog?.drawAlerts(this.ctx);
  }

  /**
   * Fog of war (a match option): work out what the player can see, and grey out the rest
   * (drawn first, under the map). `fogFrom` is who the camera follows, if not the viewer.
   */
  startFog(game, alpha, viewer) {
    this.fogNow = game.options?.fog && (this.fogFrom || viewer) ? (this.fog ||= new Fog()).update(game, this.fogFrom || viewer, alpha) : null;
    this.fogNow?.drawShadows(this.ctx, this.view);
    return this.fogNow;
  }

  /** The part of the world on screen (plus a margin), for skipping what's off it in big games. */
  updateView(s, tx, ty) {
    const m = 80;
    this.view = { l: -tx / s - m, t: -ty / s - m, r: (this.pw - tx) / s + m, b: (this.ph - ty) / s + m };
  }

  inView(x, y) {
    const v = this.view;
    return !v || (x > v.l && x < v.r && y > v.t && y < v.b);
  }

  /**
   * Soldiers to draw, and whose names to show. Small games: everyone alive.
   * Big games: only those on screen, and in a crowd, only human players' names.
   */
  shownSoldiers(game, viewer) {
    const fog = this.fogNow;
    if (!game.crowded) {
      const alive = game.soldiers.filter(o => o.alive && (!fog || fog.shows(o)));
      return { soldiers: alive, names: alive };
    }
    const soldiers = game.soldiers.filter(o => o.alive && this.inView(o.x, o.y) && (!fog || fog.shows(o)));
    return { soldiers, names: soldiers.length > 60 ? soldiers.filter(o => o === viewer || !o.isBot) : soldiers };
  }

  drawMap(game) {
    const ctx = this.ctx, e = this.lineW;
    ctx.fillStyle = INK;
    for (const p of game.map.solids) ctx.fillRect(p.l - e, p.t - e, p.r - p.l + 2 * e, p.b - p.t + 2 * e);
    ctx.fillStyle = '#fff';
    for (const p of game.map.solids) ctx.fillRect(p.l, p.t, p.r - p.l, p.b - p.t);
    // No hairlines where blocks just meet.
    fillSeams(game.map.getSeams(), e, (x, y, w, h) => ctx.fillRect(x, y, w, h));
    if (game.map.builtCount) this.drawBuilt(game);
    // Destructible maps: blocks explosions can't break are hatched.
    if (game.options?.destruction) {
      const v = this.view;
      ctx.strokeStyle = HATCH;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const p of game.map.solids) {
        if (!p.hard || p.bounce || (v && (p.r < v.l || p.l > v.r || p.b < v.t || p.t > v.b))) continue;
        hatch(p.l, p.t, p.r, p.b, HATCH_GAP, (x0, y0, x1, y1) => { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); });
      }
      ctx.stroke();
    }
    this.drawPads(game, true);
  }

  /** Built blocks: sandbag colour, with the rows drawn in. */
  drawBuilt(game) {
    const ctx = this.ctx, v = this.view;
    const shown = game.map.solids.filter(p => p.built && !(v && (p.r < v.l || p.l > v.r || p.b < v.t || p.t > v.b)));
    ctx.fillStyle = BUILT;
    for (const p of shown) ctx.fillRect(p.l, p.t, p.r - p.l, p.b - p.t);
    ctx.strokeStyle = BUILT_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const p of shown) courses(p.l, p.t, p.r, p.b, BUILT_ROW, (x0, y0, x1, y1) => { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); });
    ctx.stroke();
  }

  /**
   * Holding the Builder: what a click would do (the block, or the repair), drawn
   * where it would go: green if it can, red if not.
   */
  drawBuildGhost(game, s) {
    const inv = s?.alive && s.current === 'Builder' && s.weapons.Builder;
    if (!inv) return;
    const plan = buildPlan(game, s);
    const ok = plan.ok && inv.ammo > 0;
    const ctx = this.ctx;
    ctx.fillStyle = ok ? 'rgba(70,170,90,0.3)' : 'rgba(215,60,45,0.22)';
    ctx.strokeStyle = ok ? 'rgba(40,135,60,0.9)' : 'rgba(200,45,35,0.8)';
    ctx.lineWidth = 1;
    for (const b of plan.boxes) {
      ctx.fillRect(b.l, b.t, b.r - b.l, b.b - b.t);
      ctx.strokeRect(b.l, b.t, b.r - b.l, b.b - b.t);
    }
  }

  /** Jump pads: light fill with upward chevrons that move. */
  drawPads(game, fill) {
    const ctx = this.ctx;
    for (const p of game.map.solids) {
      if (!p.bounce) continue;
      if (fill) {
        ctx.fillStyle = '#eef3e2';
        ctx.fillRect(p.l, p.t, p.r - p.l, p.b - p.t);
      }
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
    const ctx = this.ctx, t = game.tick, a = this.alpha ?? 1;
    for (const it of game.pickups.items) {
      if (!it.active) continue;
      if (it.dropped && it.life < 120 && Math.floor(it.life / 6) % 2) continue;
      const bob = it.dropped ? 0 : Math.sin((t + a) * 0.06 + it.bob) * 1.5;
      if (it.type === 'crate' && it.landed && it.life < 120 && Math.floor(it.life / 6) % 2) continue;
      ctx.save();
      ctx.translate(lerp(it.px ?? it.x, it.x, a), lerp(it.py ?? it.y, it.y, a) + bob);
      switch (it.type) {
        case 'crate': drawCrate(ctx, it, t); break;
        case 'health': drawHealth(ctx); break;
        case 'armour': drawArmour(ctx); break;
        case 'jetpack': drawJetpack(ctx); break;
        case 'weapon': drawWeapon(ctx, WEAPONS[it.weapon], true); break;
        case 'medkit': case 'ammo': drawSupply(ctx, it.type, it.team); break;
      }
      ctx.restore();
    }
    // Spawn beacons (classes on).
    for (const b of game.beacons || []) {
      ctx.save();
      ctx.translate(b.x, b.y);
      drawBeacon(ctx, b, t, b.hp / BEACON_HP);
      ctx.restore();
    }
  }

  drawProjectiles(game, top) {
    const ctx = this.ctx, t = game.tick;
    const cull = game.crowded;
    for (const p0 of game.projectiles) {
      if (p0.delay > 0 || (cull && !this.inView(p0.x, p0.y))) continue;
      const front = p0.kind === 'flame' || p0.kind === 'gas' || p0.kind === 'fire';
      if (front !== top) continue;
      const p = between(p0, this.alpha);
      if (this.fogNow && !this.fogNow.sees(p.x, p.y)) continue; // (fog of war: out of sight)
      switch (p.kind) {
        case 'flame': drawFlame(ctx, p); break;
        case 'fire': drawFirePatch(ctx, p, t); break;
        case 'gas': drawGas(ctx, p); break;
        case 'bullet':
          ctx.strokeStyle = 'rgba(40,40,40,0.75)';
          ctx.lineWidth = p.sprite === 'slug' ? 1.6 : 1;
          ctx.beginPath();
          ctx.moveTo(p.x - p.vx * 0.7, p.y - p.vy * 0.7);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          break;
        case 'arrow': {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle ?? Math.atan2(p.vy, p.vx));
          ctx.strokeStyle = '#5a3d1e'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(0, 0); ctx.stroke();
          ctx.fillStyle = '#555';
          ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(-1.5, -1.6); ctx.lineTo(-1.5, 1.6); ctx.fill();
          ctx.strokeStyle = '#c33';
          ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-14, -2); ctx.moveTo(-12, 0); ctx.lineTo(-14, 2); ctx.stroke();
          ctx.restore();
          break;
        }
        case 'seeker': {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 5);
          g.addColorStop(0, 'rgba(255,255,255,1)');
          g.addColorStop(0.4, 'rgba(170,120,255,0.9)');
          g.addColorStop(1, 'rgba(120,60,220,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'rocket': {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.atan2(p.vy, p.vx));
          if (p.sprite === 'bomb') {
            ctx.fillStyle = '#333';
            ctx.beginPath(); ctx.ellipse(0, 0, 5, 2.6, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillRect(-7, -2.5, 2, 5);
          } else if (p.sprite === 'mortar') {
            ctx.fillStyle = '#4d4d36';
            ctx.beginPath(); ctx.ellipse(0, 0, 4, 2.2, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#222'; ctx.fillRect(-5, -1.5, 2, 3);
          } else {
            ctx.fillStyle = '#ff9a1f';
            ctx.beginPath(); ctx.moveTo(-5, -1.5); ctx.lineTo(-10 - Math.random() * 4, 0); ctx.lineTo(-5, 1.5); ctx.fill();
            ctx.fillStyle = p.sprite === 'homing' ? '#7a2222' : '#3d5a2a';
            ctx.fillRect(-5, -1.8, 9, 3.6);
            ctx.fillStyle = p.sprite === 'homing' ? '#e33' : '#222';
            ctx.beginPath(); ctx.moveTo(4, -1.8); ctx.lineTo(7, 0); ctx.lineTo(4, 1.8); ctx.fill();
          }
          ctx.restore();
          break;
        }
        case 'thrown': {
          ctx.save();
          ctx.translate(p.x, p.y);
          const round = p.sprite === 'grenade' || p.sprite === 'bomblet' || p.sprite === 'cluster' || p.sprite === 'holy';
          if (p.sprite === 'napalm') ctx.rotate(Math.atan2(p.vy, p.vx) - Math.PI / 2);
          else if (!round) ctx.rotate(p.angle || 0);
          drawSprite(ctx, p.sprite, { t, lit: p.life < 60 && Math.floor(p.life / 5) % 2 === 1 });
          ctx.restore();
          break;
        }
        case 'walker':
          ctx.save();
          ctx.translate(p.x, p.y - (p.sprite === 'oldwoman' ? 8 : 6));
          ctx.scale(p.dir || 1, 1);
          drawSprite(ctx, p.sprite, { t: p.age });
          ctx.restore();
          break;
        case 'flyer':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle || 0);
          if (Math.cos(p.angle || 0) < 0) ctx.scale(1, -1);
          drawSprite(ctx, p.sprite, { t: p.age });
          ctx.restore();
          break;
        case 'placed':
          ctx.save();
          ctx.translate(p.x, p.y - (p.sprite === 'mine' ? 1 : 4));
          drawSprite(ctx, p.sprite, { t, armed: p.armed <= 0 });
          ctx.restore();
          break;
        case 'donkey':
          ctx.save();
          ctx.translate(p.x, p.y);
          drawSprite(ctx, 'donkey', { t });
          ctx.restore();
          break;
      }
    }
  }

  drawSoldier(game, s, alpha, viewer) {
    const ctx = this.ctx;
    const x = lerp(s.prevX, s.x, alpha) + (s.drawDX || 0), y = lerp(s.prevY, s.y, alpha) + (s.drawDY || 0);
    const v = this.animated(s);
    const pose = buildPose(v);
    if (s.body.rope) {
      ctx.strokeStyle = '#8a6a3a';
      ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(x + pose.shoulder[0], y + pose.shoulder[1]); ctx.lineTo(s.body.rope.x, s.body.rope.y); ctx.stroke();
      ctx.fillStyle = '#555';
      ctx.fillRect(s.body.rope.x - 1.5, s.body.rope.y - 1.5, 3, 3);
    }
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
    let angle = pose.gun.angle;
    if ((pose.gun.def.kind === 'melee' || pose.gun.def.kind === 'build') && v.anim.swing > 0) angle -= Math.sin(v.anim.swing * Math.PI) * 1.7 * (Math.cos(angle) < 0 ? -1 : 1);
    ctx.rotate(angle);
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
    ctx.fillStyle = game.rules.teams ? TEAM_HEAD[s.team] : '#fff';
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

  /**
   * The soldier with its animation (running legs, flips, recoil, swings) part
   * way between the last two game updates. Things that start suddenly (a flip,
   * a shot's kick) show at once; things winding down ease out.
   */
  animated(s) {
    const a = this.alpha ?? 1, prev = s.animPrev, cur = s.anim;
    if (!prev || a >= 1) return s;
    let d = cur.run - prev.run;
    if (d > 0.5) d -= 1; else if (d < -0.5) d += 1;
    const ease = k => (cur[k] < prev[k] ? prev[k] + (cur[k] - prev[k]) * a : cur[k]);
    const v = Object.create(s);
    v.anim = {
      run: (((prev.run + d * a) % 1) + 1) % 1,
      idle: prev.idle + (cur.idle - prev.idle) * a,
      land: ease('land'), flip: ease('flip'), recoil: ease('recoil'), swing: ease('swing'),
    };
    return v;
  }

  drawName(game, s, alpha, viewer) {
    const ctx = this.ctx;
    const x = lerp(s.prevX, s.x, alpha) + (s.drawDX || 0), y = lerp(s.prevY, s.y, alpha) + (s.drawDY || 0);
    ctx.font = `${s === viewer ? 'bold ' : ''}8px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = game.rules.teams ? TEAM_COLORS[s.team] : s === viewer ? '#333' : '#999';
    ctx.fillText(s.name, x, y - 30);
    if (s !== viewer && s.health < 100) {
      ctx.fillStyle = '#ddd';
      ctx.fillRect(x - 8, y - 28, 16, 1.6);
      ctx.fillStyle = s.health > 40 ? '#555' : '#c22';
      ctx.fillRect(x - 8, y - 28, 16 * Math.max(0, s.health) / 100, 1.6);
    }
  }

  drawLaser(game, s) {
    const ctx = this.ctx, a = this.alpha ?? 1;
    const l = laserEnd(game, s);
    // Start from where the soldier is drawn (between game updates).
    l.x0 += lerp(s.prevX, s.x, a) + (s.drawDX || 0) - s.x;
    l.y0 += lerp(s.prevY, s.y, a) + (s.drawDY || 0) - s.y;
    ctx.strokeStyle = 'rgba(255,0,0,0.35)';
    ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(l.x0, l.y0); ctx.lineTo(l.x, l.y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,30,30,0.9)';
    ctx.fillRect(l.x - 1.2, l.y - 1.2, 2.4, 2.4);
  }

  drawEffects(game) {
    if (!game.fx) return;
    for (const p of game.fx.parts) this.drawEffect(this.ctx, p);
  }

  drawEffect(ctx, p) {
    // Particles are drawn between game updates too.
    const a = this.alpha ?? 1;
    const x = p.px == null ? p.x : lerp(p.px, p.x, a), y = p.py == null ? p.y : lerp(p.py, p.y, a);
    switch (p.kind) {
      case 'blood':
        ctx.fillStyle = '#c40f0f';
        ctx.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size);
        break;
      case 'spark':
        ctx.fillStyle = '#444';
        ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
        break;
      case 'ember':
        ctx.fillStyle = p.life > 15 ? '#ffb02e' : '#c4561a';
        ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
        break;
      case 'puff':
        ctx.strokeStyle = `rgba(120,120,120,${0.5 * p.life / p.max})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, Math.PI * 2); ctx.stroke();
        break;
      case 'flash': {
        ctx.save();
        ctx.translate(x, y);
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
        ctx.translate(x, y); ctx.rotate(p.angle);
        ctx.fillStyle = '#c9a227';
        ctx.fillRect(-1.2, -0.5, 2.4, 1);
        ctx.restore();
        break;
      case 'chunk': {
        // A bit of a blown-up block: white with an outline, like the map.
        const h = p.size / 2;
        ctx.save();
        ctx.translate(x, y); ctx.rotate(p.angle);
        ctx.fillStyle = INK;
        ctx.fillRect(-h - 0.7, -h - 0.7, p.size + 1.4, p.size + 1.4);
        ctx.fillStyle = '#fff';
        ctx.fillRect(-h, -h, p.size, p.size);
        ctx.restore();
        break;
      }
      case 'smoke':
        ctx.fillStyle = `rgba(140,140,140,${0.32 * p.life / p.max})`;
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, Math.PI * 2); ctx.fill();
        break;
      case 'fire': {
        const k = p.life / p.max;
        ctx.fillStyle = k > 0.6 ? `rgba(255,220,90,${k})` : `rgba(255,110,30,${k})`;
        ctx.beginPath(); ctx.arc(x, y, p.r * (0.6 + k * 0.4), 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'boom': {
        const k = p.life / p.max;
        const r = p.r * (1.3 - k * 0.6);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255,255,220,${k})`);
        g.addColorStop(0.4, `rgba(255,170,40,${k})`);
        g.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'trail':
        ctx.strokeStyle = `rgba(90,90,90,${0.7 * p.life / p.max})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(p.x1, p.y1); ctx.stroke();
        break;
      case 'ring': {
        const k = p.life / p.max;
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = k;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 6 + (1 - k) * 22, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 2 + (1 - k) * 12, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
      case 'whack': {
        const k = p.life / p.max;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.angle);
        ctx.fillStyle = `rgba(255,214,60,${k})`;
        ctx.strokeStyle = `rgba(30,30,30,${k})`;
        ctx.lineWidth = 0.7;
        const r = 7 + (1 - k) * 4;
        ctx.beginPath();
        for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
        break;
      }
      case 'sparkle':
        ctx.fillStyle = `rgba(170,120,255,${p.life / p.max})`;
        ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
        break;
      case 'plane':
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(Math.sign(p.vx) || 1, 1);
        ctx.fillStyle = '#555';
        ctx.beginPath(); ctx.ellipse(0, 0, 22, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(-10, 12); ctx.lineTo(-2, 12); ctx.lineTo(6, 0); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(-24, -9); ctx.lineTo(-19, -9); ctx.lineTo(-12, 0); ctx.fill();
        ctx.restore();
        break;
      case 'gib':
        ctx.globalAlpha = Math.min(1, p.life / 40);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(p.angle) * p.len / 2, y - Math.sin(p.angle) * p.len / 2);
        ctx.lineTo(x + Math.cos(p.angle) * p.len / 2, y + Math.sin(p.angle) * p.len / 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      case 'head':
        ctx.globalAlpha = Math.min(1, p.life / 40);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.globalAlpha = 1;
        break;
    }
  }

  /** Crosshair in screen space. */
  /** The crosshair at the mouse. reload: how far through a reload (0-1), drawn as a ring filling up. */
  drawCrosshair(mx, my, red, reload = null) {
    const ctx = this.ctx, d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    if (reload != null) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath();
      ctx.arc(mx, my, 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#111';
      ctx.beginPath();
      ctx.arc(mx, my, 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, reload)));
      ctx.stroke();
    }
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

/**
 * Where something is drawn between two game updates: `alpha` of the way from
 * where it was (px, py) to where it is. (Things with no earlier position are
 * drawn where they are.)
 */
export function between(p, alpha = 1) {
  if (p.px == null || alpha >= 1) return p;
  const v = Object.create(p);
  v.x = p.px + (p.x - p.px) * alpha;
  v.y = p.py + (p.y - p.py) * alpha;
  return v;
}

function drawFirePatch(ctx, p, t) {
  const flick = Math.sin(t * 0.7 + p.id) * 1.2;
  ctx.fillStyle = 'rgba(255,120,30,0.85)';
  ctx.beginPath(); ctx.moveTo(p.x - 4, p.y); ctx.quadraticCurveTo(p.x - 2, p.y - 6 - flick, p.x, p.y - 9 - flick); ctx.quadraticCurveTo(p.x + 2, p.y - 6, p.x + 4, p.y); ctx.fill();
  ctx.fillStyle = 'rgba(255,225,110,0.9)';
  ctx.beginPath(); ctx.moveTo(p.x - 2, p.y); ctx.quadraticCurveTo(p.x, p.y - 5 - flick, p.x + 2, p.y); ctx.fill();
}

function drawGas(ctx, p) {
  const k = Math.min(1, p.life / 60);
  ctx.fillStyle = `rgba(120,170,40,${0.22 * k})`;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r || 10, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `rgba(150,200,60,${0.18 * k})`;
  ctx.beginPath(); ctx.arc(p.x + 3, p.y - 2, (p.r || 10) * 0.6, 0, Math.PI * 2); ctx.fill();
}

function drawFlame(ctx, p) {
  const k = p.age / (p.age + p.life);
  const r = 2.5 + p.age * MOTION.flameGrow;
  ctx.fillStyle = k < 0.35 ? `rgba(255,225,110,0.9)` : k < 0.7 ? `rgba(255,130,30,${0.85 - k * 0.4})` : `rgba(150,60,30,${0.6 - k * 0.5})`;
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
}
