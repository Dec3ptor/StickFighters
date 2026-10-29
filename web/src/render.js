// Drawing the world: white paper, black outlines, stick figures.

import { VIEW_W, VIEW_H, MOTION } from './config.js';
import { buildPose, hypot } from './stickman.js';
import { laserEnd } from './combat.js';
import { WEAPONS } from './weapons.js';
import { clamp, lerp } from './util.js';
import { drawWeapon, drawHealth, drawArmour, drawJetpack, drawSprite, drawCrate, drawSupply, drawBeacon, drawStreakFlame, spriteOpts } from './sprites.js';
import { BEACON_HP } from './gadgets.js';
import { drawObjectives, drawCarried } from './objdraw.js';
import { MapTiles, paintMap, HATCH, HATCH_GAP, BUILT, BUILT_LINE, BUILT_ROW } from './maptiles.js';
import { buildPlan } from './building.js';
import { Fog } from './fog.js';
import { drawCrosshair as drawCrosshairAt } from './crosshair.js';

export { drawWeapon, drawHealth, drawArmour, drawJetpack, drawSprite, drawCrate };

const INK = '#111';
// (The map's colours: maptiles.js.)
export { HATCH, HATCH_GAP, BUILT, BUILT_LINE, BUILT_ROW };
const TEAM_COLORS = { 1: '#2f6fdb', 2: '#d33b2f' };

// Colours of soft round things (smoke, fire): fixed, faded with globalAlpha (no new colour string per particle).
const GLOW_COLORS = { smoke: 'rgb(140,140,140)', fireHot: 'rgb(255,220,90)', fireCool: 'rgb(255,110,30)' };
const TEAM_HEAD = { 1: '#d9e6ff', 2: '#ffdcd8' };

// Name tags' fonts (made once, not for every name every frame).
const NAME_FONT = '8px Arial, sans-serif', NAME_FONT_ME = 'bold 8px Arial, sans-serif';
const STREAK_FONT = 'bold 6px Arial, sans-serif', STREAK_FONT_BIG = 'bold 7px Arial, sans-serif';

// Weapons drawn with fills only (no lines, so the line ends set don't matter to them).
const FILLED_WEAPONS = new Set(['pistol', 'smg', 'rifle', 'ak', 'knife', 'shotgun', 'sniper', 'launcher', 'tube', 'flamer', 'minigun', 'wand', 'sledge']);

// Particles small enough to skip when they're off screen (the view's margin is far
// bigger than any of them, wherever they are between two updates).
const SMALL = new Set(['blood', 'spark', 'ember', 'sparkle', 'shell', 'chunk', 'flash', 'puff', 'smoke', 'fire', 'gib', 'head']);
// Of those, the ones that leave the canvas's opacity at 1 once drawn.
const SETS_ALPHA = new Set(['sparkle', 'puff', 'smoke', 'fire', 'gib', 'head']);

// Each soldier's animation part way between updates: kept per soldier and filled in each frame.
const views = new WeakMap();

// ---- How the camera moves (Settings: Camera), for every renderer ----------------------
// follow: how long the view takes to catch up with your soldier, in ms (95% of the way; 0: fixed on them).
// look: how far it leans toward the mouse, in percent of the usual (100: 22% of the way to the
//   pointer, 40% down the sights, 55% down a scope; 0: not at all).
// glide: how long it takes to catch up with the mouse, in ms (0: it moves with the mouse and
//   stops the moment the mouse stops; 330: how it used to be, going on sliding after it stopped).
export const CAMERA_DEFAULTS = Object.freeze({ follow: 330, look: 100, glide: 0 });
export const CAMERA_LIMITS = { follow: [0, 1000], look: [0, 200], glide: [0, 1000] };
const feel = { ...CAMERA_DEFAULTS };

/** Use these camera settings (anything missing or out of range is left at its default). */
export function setCamera(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  for (const k of Object.keys(CAMERA_LIMITS)) {
    const [lo, hi] = CAMERA_LIMITS[k], n = o[k];
    feel[k] = typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : CAMERA_DEFAULTS[k];
  }
  return { ...feel };
}

/** How much of the way to go in a frame of dt ms, to be 95% of the way there after `ms` (0: all of it). */
const catchUp = (ms, dt) => ms > 0 ? 1 - Math.pow(0.05, dt / ms) : 1;

/** Draws with the browser's 2D canvas. (glrender.js draws the same things with WebGL.) */
export class Renderer {
  // Keep the map in tiles (maptiles.js): off unless ?tiles=on is in the address. With the
  // canvas drawn by a graphics card, copying the tiles turned out slower than drawing the map.
  static tiles = 'off';

  // (alpha: false: the canvas is opaque (it's always filled in), so the page doesn't blend it with what's behind.)
  constructor(canvas, ctx = canvas.getContext('2d', { alpha: false })) {
    this.kind = 'canvas';
    this.canvas = canvas;
    this.ctx = ctx;
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.shake = 0;
    this.resize();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    // The screen's pixel ratio can change with no change of size (browser zoom, a window
    // moved to another screen): that sends no resize event, so it's watched for itself.
    this.onDpr = () => { this.resize(); this.watchDpr(); };
    this.watchDpr();
  }

  /** Listen for the pixel ratio changing from what it is now (and again after each change). */
  watchDpr() {
    this.dprQuery?.removeEventListener?.('change', this.onDpr);
    this.dprQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) || null;
    this.dprQuery?.addEventListener?.('change', this.onDpr);
  }

  /** Stop using this renderer (Settings switched to another). */
  destroy() {
    window.removeEventListener('resize', this.onResize);
    this.dprQuery?.removeEventListener?.('change', this.onDpr);
    this.dprQuery = null;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = window.innerWidth, h = window.innerHeight;
    // (Nothing changed, as when a zoom sends both a resize event and a pixel ratio change:
    // the canvas is left alone. Giving it a size clears it.)
    if (dpr === this.dpr && w === this.w && h === this.h) return;
    this.dpr = dpr;
    this.w = w;
    this.h = h;
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
  snapCamera(x, y) {
    const c = this.cam;
    c.x = c.fx = x; c.y = c.fy = y;
    c.lx = c.ly = 0;
  }

  /**
   * Follow a point, looking a little toward the mouse; zoomed out and looking far ahead
   * while sniping. `sights` above 1: aiming down a gun's sights, that much closer and
   * looking further toward the mouse (see main.js).
   * dt: milliseconds since the last frame (the camera moves the same at any frame rate).
   * follow: how long following the point takes (ms; the replay keeps its own).
   *
   * Following the point eases (smooth over jumps and landings); looking toward the mouse eases
   * as set in Settings (Camera: CAMERA_DEFAULTS), not at all to start with: the view moves with
   * the mouse and stops when it stops. (Eased, the world goes on sliding under the crosshair
   * after the hand stops.) How far it looks eases too: further down a scope or the sights, not
   * at all with the menu open.
   */
  updateCamera(game, fx, fy, mouse, sniping, dt = 1000 / 60, sights = 1, follow = feel.follow) {
    const f = dt / (1000 / 60);
    const ease = k => 1 - Math.pow(1 - k, f);
    const c = this.cam;
    const zoomTarget = sniping ? 0.72 : sights;
    c.zoom = lerp(c.zoom, zoomTarget, ease(0.12));
    // (Settled: exactly there, so the map's tiles can be made for it.)
    if (Math.abs(c.zoom - zoomTarget) < 0.001) c.zoom = zoomTarget;
    // (The point followed, and the mouse's offset from the middle of the screen, in the map's units:
    // kept with the camera, so a new renderer (Settings) carries on from them.)
    if (c.fx == null) { c.fx = c.x; c.fy = c.y; c.lx = c.ly = 0; }
    const k = catchUp(follow, dt);
    c.fx = lerp(c.fx, fx, k);
    c.fy = lerp(c.fy, fy - 20, k);
    if (mouse) {
      const g = catchUp(feel.glide, dt);
      c.lx = lerp(c.lx, clamp((mouse.x - this.w / 2) / this.scale, -400, 400), g);
      c.ly = lerp(c.ly, clamp((mouse.y - this.h / 2) / this.scale, -300, 300), g);
    }
    const look = mouse ? (sniping ? 0.55 : sights > 1 ? 0.4 : 0.22) * feel.look / 100 : 0;
    c.look = c.look == null ? look : lerp(c.look, look, ease(0.12));
    let tx = c.fx + c.lx * c.look, ty = c.fy + c.ly * c.look;
    // Keep the camera over the map.
    const b = game.map.bounds, hw = this.w / 2 / this.scale, hh = this.h / 2 / this.scale;
    const pad = 60;
    tx = b.right - b.left + pad * 2 < hw * 2 ? (b.left + b.right) / 2 : clamp(tx, b.left - pad + hw, b.right + pad - hw);
    ty = b.bottom - b.top + pad * 2 < hh * 2 ? (b.top + b.bottom) / 2 : clamp(ty, b.top - pad + hh, b.bottom + pad - hh);
    c.x = tx;
    c.y = ty;
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
    // (Without fog of war, the map's tiles bring the white background: drawMap().)
    this.cleared = !!game.options?.fog;
    if (this.cleared) this.clearWhite();
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    // (The world goes at whole screen pixels: crisper, and the map's tiles fit exactly.)
    const tx = Math.round(this.canvas.width / 2 - (this.cam.x + sx) * s), ty = Math.round(this.canvas.height / 2 - (this.cam.y + sy) * s);
    this.s = s; this.tx = tx; this.ty = ty;
    ctx.setTransform(s, 0, 0, s, tx, ty);
    this.updateView(s, tx, ty);
    this.lineW = Math.max(1.1, 1.3 / (this.scale));

    const fog = this.startFog(game, alpha, viewer);
    this.drawMap(game);
    this.drawStains(game);
    drawObjectives(this, game);
    this.drawPickups(game);
    this.drawProjectiles(game, false);
    const shown = this.shownSoldiers(game, viewer), list = shown.soldiers;
    this.drawSoldiers(game, list, alpha, viewer);
    drawCarried(this, game);
    this.drawProjectiles(game, true);
    this.drawEffects(game);
    for (let i = 0; i < list.length; i++) if (list[i].current === 'SR') this.drawLaser(game, list[i]);
    this.drawBuildGhost(game, viewer);
    this.drawNames(game, shown.names, alpha, viewer);
    fog?.drawAlerts(this.ctx);
  }

  /**
   * Fog of war (a match option): work out what the player can see, and grey out the rest
   * (drawn first, under the map). `fogFrom` is who the camera follows, if not the viewer.
   */
  startFog(game, alpha, viewer) {
    // (Spectating with the free camera: no fog.)
    this.fogNow = game.options?.fog && !this.noFog && (this.fogFrom || viewer) ? (this.fog ||= new Fog()).update(game, this.fogFrom || viewer, alpha) : null;
    this.fogNow?.drawShadows(this.ctx, this.view);
    return this.fogNow;
  }

  /** The part of the world on screen (plus a margin), for skipping what's off it in big games. */
  updateView(s, tx, ty) {
    const m = 80, v = this.view ||= { l: 0, t: 0, r: 0, b: 0 };
    v.l = -tx / s - m;
    v.t = -ty / s - m;
    v.r = (this.pw - tx) / s + m;
    v.b = (this.ph - ty) / s + m;
  }

  inView(x, y) {
    const v = this.view;
    return !v || (x > v.l && x < v.r && y > v.t && y < v.b);
  }

  /**
   * Soldiers to draw, and whose names to show. Small games: everyone alive.
   * Big games: only those on screen, and in a crowd, only human players' names.
   * (The same lists are filled in every frame: use them before the next frame.)
   */
  /** The match is over and gone: let go of its soldiers (the lists below are kept for the next). */
  forgetMatch() {
    const out = this.shown;
    if (!out) return;
    out.soldiers.length = 0;
    out.humans.length = 0;
    out.names = out.soldiers;
  }

  shownSoldiers(game, viewer) {
    const fog = this.fogNow, crowded = game.crowded, all = game.soldiers;
    const out = this.shown ||= { soldiers: [], names: [], humans: [] };
    const list = out.soldiers;
    list.length = 0;
    for (let i = 0; i < all.length; i++) {
      const o = all[i];
      if (o.alive && (!crowded || this.inView(o.x, o.y)) && (!fog || fog.shows(o))) list.push(o);
    }
    out.names = list;
    if (crowded && list.length > 60) {
      const names = out.names = out.humans;
      names.length = 0;
      for (let i = 0; i < list.length; i++) if (list[i] === viewer || !list[i].isBot) names.push(list[i]);
    }
    return out;
  }

  /**
   * The map: drawn directly (only what's on screen), or with ?tiles=on, copied from
   * tiles drawn before (maptiles.js). Then the jump pads' moving chevrons.
   */
  drawMap(game) {
    this.tiled ??= Renderer.tiles === 'on';
    if (!this.tiled || !(this.mapTiles ||= new MapTiles()).draw(this, game, !this.cleared)) {
      if (!this.cleared) this.clearWhite();
      paintMap(this.ctx, game.map, this.lineW, this.view, !!game.options?.destruction);
    }
    this.drawPads(game, false);
  }

  /** The whole canvas white (then back to the world transform). */
  clearWhite() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.s) ctx.setTransform(this.s, 0, 0, this.s, this.tx, this.ty);
  }

  /**
   * Holding the Builder: what a click would do (the block, or the repair), drawn
   * where it would go: green if it can, red if not.
   */
  drawBuildGhost(game, s) {
    const inv = s?.alive && WEAPONS[s.current]?.kind === 'build' && s.weapons[s.current];
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
    const ctx = this.ctx, solids = game.map.solids;
    for (let i = 0; i < solids.length; i++) {
      const p = solids[i];
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

  /** Blood on the walls. (Off screen: skipped. The opacity is only set when it changes: most are at 0.8.) */
  drawStains(game) {
    if (!game.fx) return;
    const ctx = this.ctx, v = this.view, list = game.fx.stains;
    ctx.fillStyle = '#a30d0d';
    let alpha = -1;
    for (let i = 0; i < list.length; i++) {
      const st = list[i];
      if (v && (st.x < v.l || st.x > v.r || st.y < v.t || st.y > v.b)) continue;
      const a = Math.min(1, st.life / 200) * 0.8, h = st.size / 2;
      if (a !== alpha) { ctx.globalAlpha = a; alpha = a; }
      ctx.fillRect(st.x - h, st.y - h, st.size, st.size);
    }
    ctx.globalAlpha = 1;
  }

  drawPickups(game) {
    const ctx = this.ctx, t = game.tick, a = this.alpha ?? 1, items = game.pickups.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
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
    const beacons = game.beacons || NONE;
    for (let i = 0; i < beacons.length; i++) {
      const b = beacons[i];
      ctx.save();
      ctx.translate(b.x, b.y);
      drawBeacon(ctx, b, t, b.hp / BEACON_HP);
      ctx.restore();
    }
  }

  drawProjectiles(game, top) {
    const ctx = this.ctx, t = game.tick, a = this.alpha ?? 1, list = game.projectiles;
    const cull = game.crowded;
    for (let i = 0; i < list.length; i++) {
      // (Each position read once: projectiles come in many shapes, and reading a number from
      // one of those makes a new one each time.)
      const p = list[i], nx = p.x, ny = p.y;
      if (p.delay > 0 || (cull && !this.inView(nx, ny))) continue;
      const kind = p.kind, front = kind === 'flame' || kind === 'gas' || kind === 'fire' || kind === 'cloud';
      if (front !== top) continue;
      // Drawn part way between updates, as between() works it out (with no new object).
      const ox = p.px, oy = p.py, mid = ox != null && a < 1;
      const x = mid ? ox + (nx - ox) * a : nx, y = mid ? oy + (ny - oy) * a : ny;
      if (this.fogNow && !this.fogNow.sees(x, y)) continue; // (fog of war: out of sight)
      switch (kind) {
        case 'flame': drawFlame(ctx, p, x, y); break;
        case 'fire': drawFirePatch(ctx, p, t, x, y); break;
        case 'gas': drawGas(ctx, p, x, y); break;
        case 'cloud': drawCloud(ctx, p, t, x, y); break;
        case 'bullet': {
          // A streak behind it: how far it goes in 0.7 updates, but no more than 40 px (fast
          // bullets), and not back past the gun it came from.
          const sp = hypot(p.vx, p.vy) || 1;
          const len = Math.min(0.7 * sp, 40, Math.max(0, (p.age ?? 9) - 1 + this.alpha) * sp);
          ctx.strokeStyle = 'rgba(40,40,40,0.75)';
          ctx.lineWidth = p.sprite === 'slug' ? 1.6 : 1;
          ctx.beginPath();
          ctx.moveTo(x - (p.vx / sp) * len, y - (p.vy / sp) * len);
          ctx.lineTo(x, y);
          ctx.stroke();
          break;
        }
        case 'arrow': {
          ctx.save();
          ctx.translate(x, y);
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
          const g = ctx.createRadialGradient(x, y, 0, x, y, 5);
          g.addColorStop(0, 'rgba(255,255,255,1)');
          g.addColorStop(0.4, 'rgba(170,120,255,0.9)');
          g.addColorStop(1, 'rgba(120,60,220,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'rocket': {
          ctx.save();
          ctx.translate(x, y);
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
          ctx.translate(x, y);
          const round = p.sprite === 'grenade' || p.sprite === 'bomblet' || p.sprite === 'cluster' || p.sprite === 'holy';
          if (p.sprite === 'napalm') ctx.rotate(Math.atan2(p.vy, p.vx) - Math.PI / 2);
          else if (!round) ctx.rotate(p.angle || 0);
          drawSprite(ctx, p.sprite, spriteOpts(t, p.life < 60 && Math.floor(p.life / 5) % 2 === 1));
          ctx.restore();
          break;
        }
        case 'walker':
          ctx.save();
          ctx.translate(x, y - (p.sprite === 'oldwoman' ? 8 : 6));
          ctx.scale(p.dir || 1, 1);
          drawSprite(ctx, p.sprite, spriteOpts(p.age));
          ctx.restore();
          break;
        case 'flyer':
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(p.angle || 0);
          if (Math.cos(p.angle || 0) < 0) ctx.scale(1, -1);
          drawSprite(ctx, p.sprite, spriteOpts(p.age));
          ctx.restore();
          break;
        case 'placed':
          ctx.save();
          ctx.translate(x, y - (p.sprite === 'mine' ? 1 : 4));
          drawSprite(ctx, p.sprite, spriteOpts(t, undefined, p.armed <= 0));
          ctx.restore();
          break;
        case 'donkey':
          ctx.save();
          ctx.translate(x, y);
          drawSprite(ctx, 'donkey', spriteOpts(t));
          ctx.restore();
          break;
        case 'sentry': drawSentry(ctx, p, t, x, y); break;
      }
    }
  }

  /** One soldier (see drawSoldiers). */
  drawSoldier(game, s, alpha, viewer) {
    ONE[0] = s;
    this.drawFigures(game, ONE, alpha);
    ONE[0] = null;
  }

  /** Soldiers, each part way between the last two game updates (see drawFigures). */
  drawSoldiers(game, list, alpha, viewer) {
    // (A renderer with soldiers of its own: each one its own way.)
    if (this.drawSoldier !== Renderer.prototype.drawSoldier) {
      for (let i = 0; i < list.length; i++) this.drawSoldier(game, list[i], alpha, viewer);
      return;
    }
    this.drawFigures(game, list, alpha);
  }

  /**
   * The canvas's state is kept once for the lot (not twice per soldier): each one sets
   * what it draws with, and everything's as it was afterwards. Ropes and weapons are
   * drawn with the line ends the canvas had (round ones are only for the body), as ever.
   */
  drawFigures(game, list, alpha) {
    if (!list.length) return;
    const ctx = this.ctx, st = this.figure ||= { cap0: 'butt', join0: 'miter', alpha0: 1, cap: 'butt', join: 'miter', rope: false };
    ctx.save();
    st.cap0 = st.cap = ctx.lineCap;
    st.join0 = st.join = ctx.lineJoin;
    st.alpha0 = ctx.globalAlpha;
    st.rope = false;
    for (let i = 0; i < list.length; i++) this.drawFigure(game, list[i], alpha, st);
    ctx.restore();
    // (A rope's colours were set before each soldier's own state, so they stayed set after it.)
    if (st.rope) {
      ctx.strokeStyle = '#8a6a3a';
      ctx.lineWidth = 0.9;
      ctx.fillStyle = '#555';
    }
  }

  /** Set the line ends (only if they aren't already). */
  lineEnds(st, cap, join) {
    const ctx = this.ctx;
    if (st.cap !== cap) { ctx.lineCap = cap; st.cap = cap; }
    if (st.join !== join) { ctx.lineJoin = join; st.join = join; }
  }

  /** One soldier, inside drawFigures (st: the line ends and opacity it started with, and the ones set now). */
  drawFigure(game, s, alpha, st) {
    const ctx = this.ctx, k = this.s;
    const x = lerp(s.prevX, s.x, alpha) + (s.drawDX || 0), y = lerp(s.prevY, s.y, alpha) + (s.drawDY || 0);
    const v = this.animated(s);
    const pose = buildPose(v);
    // (The world's transform, then the soldier's place: the same sums as saving and restoring would give.)
    ctx.setTransform(k, 0, 0, k, this.tx, this.ty);
    if (s.body.rope) {
      this.lineEnds(st, st.cap0, st.join0);
      ctx.strokeStyle = '#8a6a3a';
      ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(x + pose.shoulder[0], y + pose.shoulder[1]); ctx.lineTo(s.body.rope.x, s.body.rope.y); ctx.stroke();
      ctx.fillStyle = '#555';
      ctx.fillRect(s.body.rope.x - 1.5, s.body.rope.y - 1.5, 3, 3);
      st.rope = true;
    }
    ctx.translate(x, y);
    const faded = s.spawnProtect > 0;
    if (faded) ctx.globalAlpha = 0.35 + 0.35 * Math.abs(Math.sin(game.tick * 0.25));
    // A Juggernaut glows, so everyone knows to run.
    if (s.jugger > 0) drawJuggerGlow(ctx, pose, game.tick);

    // Jetpack on the back.
    if (s.body.hasJetpack) {
      ctx.fillStyle = '#555';
      const bx = -s.facing * 3.5 + (s.facing > 0 ? -2.5 : 0);
      ctx.fillRect(bx, -14, 2.5, 8);
    }

    // Weapon first, so the front hand overlaps it. (Then back to the soldier's own place.)
    const gun = pose.gun, def = gun.def;
    ctx.translate(gun.x, gun.y);
    let angle = gun.angle;
    if ((def.kind === 'melee' || def.kind === 'build') && v.anim.swing > 0) angle -= Math.sin(v.anim.swing * Math.PI) * 1.7 * (Math.cos(angle) < 0 ? -1 : 1);
    ctx.rotate(angle);
    if (Math.cos(gun.angle) < 0) ctx.scale(1, -1);
    if (!FILLED_WEAPONS.has(def.look.type)) this.lineEnds(st, st.cap0, st.join0);
    drawWeapon(ctx, def, false);
    ctx.setTransform(k, 0, 0, k, this.tx, this.ty);
    ctx.translate(x, y);

    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    this.lineEnds(st, 'round', 'round');
    const L = pose.lines;
    ctx.beginPath();
    for (let i = 0; i < L.length; i++) { const l = L[i]; ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); }
    ctx.stroke();
    const head = pose.head;
    ctx.fillStyle = game.rules.teams ? TEAM_HEAD[s.team] : '#fff';
    ctx.beginPath();
    ctx.arc(head.x, head.y, head.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (s.armour > 0) {
      // A little helmet shows the soldier has armour.
      ctx.fillStyle = '#4a4a4a';
      ctx.beginPath();
      ctx.arc(head.x, head.y - 0.5, head.r + 0.6, Math.PI * 1.05, Math.PI * 1.95);
      ctx.fill();
    }
    if (s.body.jetting) {
      ctx.fillStyle = Math.random() < 0.5 ? '#ffb31f' : '#ff6a1f';
      const bx = -s.facing * 3.5 + (s.facing > 0 ? -1.2 : 1.2);
      ctx.beginPath(); ctx.moveTo(bx - 2, -6); ctx.lineTo(bx, 2 + Math.random() * 5); ctx.lineTo(bx + 2, -6); ctx.fill();
    }
    if (faded) ctx.globalAlpha = st.alpha0;
  }

  /**
   * The soldier's animation (running legs, flips, recoil, swings) part way between the
   * last two game updates, for drawing it: { body, facing, aim, current, anim }, all
   * buildPose() needs. Things that start suddenly (a flip, a shot's kick) show at once;
   * things winding down ease out. (Kept per soldier and filled in again each time, so
   * no new objects every frame; at an update itself, it's just the soldier.)
   */
  animated(s) {
    const a = this.alpha ?? 1, prev = s.animPrev, cur = s.anim;
    if (!prev || a >= 1) return s;
    let d = cur.run - prev.run;
    if (d > 0.5) d -= 1; else if (d < -0.5) d += 1;
    let v = views.get(s);
    if (!v) views.set(s, v = { body: null, facing: 0, aim: 0, current: null, anim: { run: 0, idle: 0, land: 0, flip: 0, recoil: 0, swing: 0 } });
    v.body = s.body;
    v.facing = s.facing;
    v.aim = s.aim;
    v.current = s.current;
    const an = v.anim;
    an.run = (((prev.run + d * a) % 1) + 1) % 1;
    an.idle = prev.idle + (cur.idle - prev.idle) * a;
    an.land = easeOut(cur.land, prev.land, a);
    an.flip = easeOut(cur.flip, prev.flip, a);
    an.recoil = easeOut(cur.recoil, prev.recoil, a);
    an.swing = easeOut(cur.swing, prev.swing, a);
    return v;
  }

  /** One name tag (see drawNames). */
  drawName(game, s, alpha, viewer) {
    const st = this.nameState ||= { font: null, align: null, fill: null };
    st.font = st.align = st.fill = null;
    this.drawTag(game, s, alpha, viewer, st);
  }

  /**
   * Names over soldiers, in the same order as ever (where they overlap, the same one's on
   * top), with the font, alignment and colour only set when they change: most names share them.
   */
  drawNames(game, list, alpha, viewer) {
    // (A renderer with name tags of its own: each one its own way.)
    if (this.drawName !== Renderer.prototype.drawName) {
      for (let i = 0; i < list.length; i++) this.drawName(game, list[i], alpha, viewer);
      return;
    }
    const st = this.nameState ||= { font: null, align: null, fill: null };
    st.font = st.align = st.fill = null;
    for (let i = 0; i < list.length; i++) this.drawTag(game, list[i], alpha, viewer, st);
  }

  drawTag(game, s, alpha, viewer, st) {
    const ctx = this.ctx;
    const x = lerp(s.prevX, s.x, alpha) + (s.drawDX || 0), y = lerp(s.prevY, s.y, alpha) + (s.drawDY || 0);
    const font = s === viewer ? NAME_FONT_ME : NAME_FONT;
    if (st.font !== font) { ctx.font = font; st.font = font; }
    if (st.align !== 'center') { ctx.textAlign = 'center'; st.align = 'center'; }
    const color = game.rules.teams ? TEAM_COLORS[s.team] : s === viewer ? '#333' : '#999';
    if (st.fill !== color) { ctx.fillStyle = color; st.fill = color; }
    ctx.fillText(s.name, x, y - 30);
    // Kill streaks: a flame and the count after the name (3 or more in a row), and a Juggernaut's tag over it.
    if (s.streak >= 3) {
      const big = s.streak >= 5, bx = x + ctx.measureText(s.name).width / 2 + (big ? 4 : 3.4);
      drawStreakFlame(ctx, bx, y - 33, big);
      ctx.font = st.font = big ? STREAK_FONT_BIG : STREAK_FONT;
      ctx.textAlign = 'left';
      ctx.fillStyle = st.fill = big ? '#d8340c' : '#d0700c';
      ctx.fillText(String(s.streak), bx + (big ? 2.8 : 2.4), y - 30);
      ctx.textAlign = 'center';
    }
    if (s.jugger > 0) {
      ctx.font = st.font = STREAK_FONT;
      ctx.fillStyle = st.fill = '#e8740c';
      ctx.fillText('JUGGERNAUT', x, y - 38);
    }
    if (s !== viewer && s.health < s.maxHealth) {
      ctx.fillStyle = '#ddd';
      ctx.fillRect(x - 8, y - 28, 16, 1.6);
      ctx.fillStyle = st.fill = s.health > s.maxHealth * 0.4 ? '#555' : '#c22';
      ctx.fillRect(x - 8, y - 28, 16 * Math.max(0, s.health) / s.maxHealth, 1.6);
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

  /**
   * Particles, in the order they were made (where they overlap, the same one's on top).
   * Small ones off screen are skipped, leaving the canvas as drawing them would have (its
   * opacity back at 1, and a limb's round line ends: what's drawn after goes by those).
   */
  drawEffects(game) {
    if (!game.fx) return;
    const ctx = this.ctx, parts = game.fx.parts, v = this.view;
    // (A renderer drawing some kinds its own way: each one through its drawEffect.)
    const own = this.drawEffect !== Renderer.prototype.drawEffect;
    let one = false, round = false;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!own && v && SMALL.has(p.kind) && (p.x < v.l || p.x > v.r || p.y < v.t || p.y > v.b)) {
        if (SETS_ALPHA.has(p.kind)) one = true;
        if (p.kind === 'gib' && !round) { ctx.lineCap = 'round'; round = true; }
        continue;
      }
      if (one) { ctx.globalAlpha = 1; one = false; }
      this.drawEffect(ctx, p);
    }
    if (one) ctx.globalAlpha = 1;
  }

  /** A soft round thing (smoke, fire) of radius r at (x, y), faded to `alpha`. */
  drawGlow(ctx, kind, x, y, r, alpha) {
    if (!(r > 0) || !(alpha > 0)) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = GLOW_COLORS[kind];
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** Draw turned by `angle` about (x, y) (back to the world transform with endTurn()). Quicker than save() and restore(). */
  turn(ctx, x, y, angle) {
    const s = this.s, c = Math.cos(angle) * s, n = Math.sin(angle) * s;
    ctx.setTransform(c, n, -n, c, this.tx + x * s, this.ty + y * s);
  }

  endTurn(ctx) { ctx.setTransform(this.s, 0, 0, this.s, this.tx, this.ty); }

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
        ctx.strokeStyle = 'rgb(120,120,120)';
        ctx.globalAlpha = 0.5 * p.life / p.max;
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
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
        this.turn(ctx, x, y, p.angle);
        ctx.fillStyle = '#c9a227';
        ctx.fillRect(-1.2, -0.5, 2.4, 1);
        this.endTurn(ctx);
        break;
      case 'chunk': {
        // A bit of a blown-up block: white with an outline, like the map.
        const h = p.size / 2;
        this.turn(ctx, x, y, p.angle);
        ctx.fillStyle = INK;
        ctx.fillRect(-h - 0.7, -h - 0.7, p.size + 1.4, p.size + 1.4);
        ctx.fillStyle = '#fff';
        ctx.fillRect(-h, -h, p.size, p.size);
        this.endTurn(ctx);
        break;
      }
      case 'smoke':
        this.drawGlow(ctx, 'smoke', x, y, p.r, 0.32 * p.life / p.max);
        break;
      case 'fire': {
        const k = p.life / p.max;
        this.drawGlow(ctx, k > 0.6 ? 'fireHot' : 'fireCool', x, y, p.r * (0.6 + k * 0.4), k);
        break;
      }
      case 'boom': {
        // (Fading with globalAlpha is the same as fading every stop of the gradient.)
        const k = p.life / p.max;
        const r = p.r * (1.3 - k * 0.6);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgb(255,255,220)');
        g.addColorStop(0.4, 'rgb(255,170,40)');
        g.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.globalAlpha = k;
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'trail':
        ctx.strokeStyle = 'rgb(90,90,90)';
        ctx.globalAlpha = 0.7 * p.life / p.max;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(p.x1, p.y1); ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      case 'bang': {
        // A flashbang: a white burst.
        const k = p.life / p.max;
        ctx.fillStyle = '#fff';
        ctx.globalAlpha = k * 0.9;
        ctx.beginPath(); ctx.arc(x, y, 10 + (1 - k) * 40, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 12 + (1 - k) * 46, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
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
        this.turn(ctx, x, y, p.angle);
        ctx.globalAlpha = k;
        ctx.fillStyle = 'rgb(255,214,60)';
        ctx.strokeStyle = 'rgb(30,30,30)';
        ctx.lineWidth = 0.7;
        const r = 7 + (1 - k) * 4;
        ctx.beginPath();
        for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.globalAlpha = 1;
        this.endTurn(ctx);
        break;
      }
      case 'sparkle':
        ctx.fillStyle = 'rgb(170,120,255)';
        ctx.globalAlpha = p.life / p.max;
        ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
        ctx.globalAlpha = 1;
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
      case 'gib': {
        const dx = Math.cos(p.angle) * p.len / 2, dy = Math.sin(p.angle) * p.len / 2;
        ctx.globalAlpha = Math.min(1, p.life / 40);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x - dx, y - dy);
        ctx.lineTo(x + dx, y + dy);
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
      case 'head':
        ctx.globalAlpha = Math.min(1, p.life / 40);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      case 'killflash': {
        // A kill confirmed: a white flash bursting out fast, ringed in red, with sharp spikes.
        const k = p.life / p.max, r = 2.5 + (1 - k * k) * 8;
        ctx.globalAlpha = Math.min(1, k * 1.5);
        this.turn(ctx, x, y, p.angle || 0);
        ctx.fillStyle = '#ff4a3a';
        fillSpikes(ctx, 6, r * 0.6, r * 2 + 2, r * 1.5 + 2, 1.3);
        ctx.fillStyle = '#fff';
        fillSpikes(ctx, 6, r * 0.6, r * 1.7 + 1, r * 1.3 + 1, 0.6);
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#e8402f';
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
        this.endTurn(ctx);
        ctx.globalAlpha = 1;
        break;
      }
    }
  }

  /**
   * The crosshair at the mouse, as set up in Settings (crosshair.js). reload: how far through a
   * reload (0-1), drawn as a ring filling up. ringOnly: the system's pointer is the crosshair (it
   * isn't locked to the game), so just the ring round it.
   */
  drawCrosshair(mx, my, red, reload = null, ringOnly = false) {
    const d = this.dpr;
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
    drawCrosshairAt(this.ctx, mx, my, { edition: this.kind === 'remastered' ? 'remastered' : 'classic', red, reload, ringOnly });
  }
}

// drawSoldier() draws a list of one.
const ONE = [null];
// (No spawn beacons.)
const NONE = [];
// The crosshair's four arms (x, y pairs).

/** Part way (a) from prev to cur when it's winding down; straight to cur when it's starting up. */
function easeOut(cur, prev, a) {
  return cur < prev ? prev + (cur - prev) * a : cur;
}

// ---- Shapes -----------------------------------------------------------------

/**
 * Where something is drawn between two game updates: `alpha` of the way from
 * where it was (px, py) to where it is. (Things with no earlier position are
 * drawn where they are.) With `out`, just the position is written into it
 * (out.x, out.y) and out is returned: no new object. Without, it's a view of p
 * with x and y moved (made new each time).
 */
export function between(p, alpha = 1, out = null) {
  if (out) {
    const mid = p.px != null && alpha < 1;
    out.x = mid ? p.px + (p.x - p.px) * alpha : p.x;
    out.y = mid ? p.py + (p.y - p.py) * alpha : p.y;
    return out;
  }
  if (p.px == null || alpha >= 1) return p;
  const v = Object.create(p);
  v.x = p.px + (p.x - p.px) * alpha;
  v.y = p.py + (p.y - p.py) * alpha;
  return v;
}

/**
 * A burst of n sharp spikes round the origin, filled in the current colour: thin diamonds
 * from r0 out to r1 (every other one out to r2), w wide. (The kill flash.)
 */
export function fillSpikes(ctx, n, r0, r1, r2, w) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = i * Math.PI * 2 / n, c = Math.cos(a), s = Math.sin(a), r = i % 2 ? r2 : r1, m = r0 + (r - r0) * 0.3;
    ctx.moveTo(c * r0, s * r0);
    ctx.lineTo(c * m - s * w, s * m + c * w);
    ctx.lineTo(c * r, s * r);
    ctx.lineTo(c * m + s * w, s * m - c * w);
    ctx.closePath();
  }
  ctx.fill();
}

// A Sentry Sheep's collar: its team's colour, gold in free-for-all.
const SENTRY_COLLAR = { 0: '#e0a020', ...TEAM_COLORS };
// How high a Sentry Sheep's gun turns (above its feet), as in combat.js.
const SENTRY_GUN = 13;

/**
 * A Sentry Sheep (kill streak reward): its body facing its way, the gun on its back aimed
 * at the true angle (folded up while it unfolds), its armour left once it's been hit, and
 * blinking in its last 3 seconds. (x, y: where it's drawn.)
 */
function drawSentry(ctx, p, t, x = p.x, y = p.y) {
  const dim = p.life < 180 && Math.floor(p.life / 6) % 2 === 1;
  ctx.save();
  if (dim) ctx.globalAlpha *= 0.35;
  ctx.translate(x, y - 7.5);
  ctx.save();
  ctx.scale(p.dir || 1, 1);
  drawSprite(ctx, 'sentry', spriteOpts(t, undefined, undefined, SENTRY_COLLAR[p.team] || SENTRY_COLLAR[0]));
  ctx.restore();
  // The turret: a mount on the plate, and the gun turning on it.
  ctx.translate(0, 7.5 - SENTRY_GUN);
  ctx.fillStyle = '#3a3e44';
  ctx.fillRect(-2.8, -0.2, 5.6, 1.8);
  const deploying = p.armed > 0, angle = deploying ? -Math.PI / 2 : p.angle || 0;
  ctx.rotate(angle);
  if (Math.cos(angle) < 0) ctx.scale(1, -1);
  ctx.fillStyle = '#2a2c30';
  ctx.fillRect(2.5, -0.8, 8, 1.6);
  ctx.fillRect(9.8, -1.3, 1.8, 2.6);
  ctx.fillStyle = '#5d636b';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.rect(-2.8, -2.1, 5.8, 4.2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#2a2c30';
  ctx.fillRect(-1.2, -3.2, 2.6, 1.1);
  // Its light: blinking amber while it unfolds, red once it's watching.
  ctx.fillStyle = deploying ? (Math.floor(t / 8) % 2 ? '#ffb31f' : '#7a5a1a') : '#ff3b2f';
  ctx.fillRect(1.2, -0.7, 1.4, 1.4);
  ctx.restore();
  if (p.r < 100) {
    ctx.save();
    if (dim) ctx.globalAlpha *= 0.35;
    ctx.fillStyle = '#ddd';
    ctx.fillRect(x - 7, y - 23, 14, 1.6);
    ctx.fillStyle = p.r > 40 ? '#555' : '#c22';
    ctx.fillRect(x - 7, y - 23, 14 * Math.max(0, p.r) / 100, 1.6);
    ctx.restore();
  }
}

/** A Juggernaut's glow: fat soft orange strokes round its body and head, pulsing (soldier's transform set). */
function drawJuggerGlow(ctx, pose, tick) {
  const pulse = 0.5 + 0.5 * Math.sin(tick * 0.2), base = ctx.globalAlpha;
  const cap = ctx.lineCap, join = ctx.lineJoin;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  glowPass(ctx, pose, base, 6.5 + pulse * 2, 0.2 + 0.15 * pulse, '#ff8a1f');
  glowPass(ctx, pose, base, 3.8 + pulse, 0.45 + 0.2 * pulse, '#ffb02e');
  // (Back as they were, so the gun drawn next looks the same as anyone else's.)
  ctx.globalAlpha = base;
  ctx.lineCap = cap;
  ctx.lineJoin = join;
}

/** One stroke of the Juggernaut's glow: w wide, at opacity a (of base), in `color`. */
function glowPass(ctx, pose, base, w, a, color) {
  const L = pose.lines, h = pose.head;
  ctx.globalAlpha = base * a;
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  for (let i = 0; i < L.length; i++) { const l = L[i]; ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); }
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(h.x, h.y, h.r + w / 2, 0, Math.PI * 2); ctx.fill();
}

function drawFirePatch(ctx, p, t, x = p.x, y = p.y) {
  const flick = Math.sin(t * 0.7 + p.id) * 1.2;
  ctx.fillStyle = 'rgba(255,120,30,0.85)';
  ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.quadraticCurveTo(x - 2, y - 6 - flick, x, y - 9 - flick); ctx.quadraticCurveTo(x + 2, y - 6, x + 4, y); ctx.fill();
  ctx.fillStyle = 'rgba(255,225,110,0.9)';
  ctx.beginPath(); ctx.moveTo(x - 2, y); ctx.quadraticCurveTo(x, y - 5 - flick, x + 2, y); ctx.fill();
}

// A smoke cloud's colours (strings made from its opacity): each made once, then looked up.
const fades = new Map();
function faded(prefix, n) {
  let m = fades.get(prefix);
  if (!m) fades.set(prefix, m = new Map());
  let s = m.get(n);
  if (s === undefined) {
    if (m.size > 600) m.clear();
    m.set(n, s = `${prefix}${n})`);
  }
  return s;
}

const CLOUD_PUFFS = ['rgba(196,196,200,', 'rgba(182,182,186,', 'rgba(168,168,172,'];

/** A smoke grenade's cloud: thick grey puffs you can't see through. (x, y: where it's drawn.) */
export function drawCloud(ctx, p, t, x = p.x, y = p.y) {
  const r = p.r || 10, fade = Math.min(1, (p.life ?? 99) / 90);
  const a = (0.92 * fade).toFixed(3);
  for (let i = 0; i < 9; i++) {
    const ang = (i / 9) * Math.PI * 2 + (p.id % 7) * 0.7;
    const d = r * (i % 2 ? 0.42 : 0.6);
    const wob = Math.sin(t * 0.02 + i * 1.7) * r * 0.05;
    ctx.fillStyle = faded(CLOUD_PUFFS[i % 3], a);
    ctx.beginPath(); ctx.arc(x + Math.cos(ang) * d + wob, y + Math.sin(ang) * d * 0.72, r * 0.56, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = faded('rgba(212,212,216,', (0.96 * fade).toFixed(3));
  ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, Math.PI * 2); ctx.fill();
}

// Fading things (gas, flames) are drawn in a fixed colour at an opacity: the same as an
// rgba() colour with that opacity, with no new colour string for every one every frame.
function fadedFill(ctx, color, a) {
  const base = ctx.globalAlpha;
  ctx.fillStyle = color;
  ctx.globalAlpha = base * a;
  ctx.fill();
  ctx.globalAlpha = base;
}

function drawGas(ctx, p, x = p.x, y = p.y) {
  const k = Math.min(1, p.life / 60);
  ctx.beginPath(); ctx.arc(x, y, p.r || 10, 0, Math.PI * 2);
  fadedFill(ctx, 'rgb(120,170,40)', 0.22 * k);
  ctx.beginPath(); ctx.arc(x + 3, y - 2, (p.r || 10) * 0.6, 0, Math.PI * 2);
  fadedFill(ctx, 'rgb(150,200,60)', 0.18 * k);
}

function drawFlame(ctx, p, x = p.x, y = p.y) {
  const k = p.age / (p.age + p.life);
  const r = 2.5 + p.age * MOTION.flameGrow;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  if (k < 0.35) { ctx.fillStyle = 'rgba(255,225,110,0.9)'; ctx.fill(); }
  else if (k < 0.7) fadedFill(ctx, 'rgb(255,130,30)', 0.85 - k * 0.4);
  else fadedFill(ctx, 'rgb(150,60,30)', 0.6 - k * 0.5);
}
