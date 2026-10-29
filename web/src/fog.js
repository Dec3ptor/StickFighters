// Fog of war (an experimental match option): you only see what your soldier
// could see from where they stand. Places hidden behind walls are greyed
// out, and soldiers (and what they fire) there aren't drawn. Sounds from
// places you can't see show up as ripples where they came from, or as
// arrows at the screen's edge, so you know where to look.
//
// Used by both renderers (only drawing calls the WebGL layer supports).

import { lerp } from './util.js';

const FOG = '#dadada';
const REACH = 6000;    // how far shadows are drawn past what casts them
const HEAR = 1400;     // how far away a sound shows an alert
const ALERT_MS = 1300; // how long an alert shows
// Sounds that give someone away (not pickups, menu clicks and the like).
const HEARD = new Set([
  'pistol', 'rifle', 'uzi', 'shotgun', 'sniper', 'minigun', 'magnum', 'thump', 'rocket', 'flame', 'explosion', 'explosionSmall',
  'jet', 'land', 'bow', 'throw', 'bat', 'axe', 'punch', 'swing', 'sledge', 'chip', 'spin', 'rope', 'teleport', 'banzai', 'baa', 'moo',
  'mumble', 'heehaw', 'beep', 'gas', 'death', 'gib', 'hit', 'headshot', 'reload', 'smash', 'rumble', 'plane',
]);
const LOUD = new Set(['explosion', 'explosionSmall', 'sniper', 'rocket', 'thump', 'rumble', 'plane', 'minigun', 'shotgun']);

export class Fog {
  constructor() {
    this.alerts = [];
    this.seen = new Map();   // soldier -> visible this frame (worked out when first asked)
    this.eye = null;
  }

  /** Where `viewer` sees from this frame: their shoulder, where they're drawn. */
  update(game, viewer, alpha = 1) {
    this.map = game.map;
    this.game = game;
    this.viewer = viewer;
    this.eye = {
      x: lerp(viewer.prevX, viewer.x, alpha) + (viewer.drawDX || 0),
      y: lerp(viewer.prevY, viewer.y, alpha) + (viewer.drawDY || 0) - 12,
    };
    this.seen.clear();
    return this;
  }

  /** True if the point is in plain sight from the eye. */
  sees(x, y) {
    return this.map.clearLine(this.eye.x, this.eye.y, x, y);
  }

  /**
   * Should soldier `o` be drawn? You, and anyone you can see some of: teammates
   * out of sight are hidden too (the minimap still shows them).
   */
  shows(o) {
    const v = this.viewer;
    if (o === v) return true;
    let r = this.seen.get(o);
    if (r === undefined) {
      r = this.sees(o.x, o.y - 18) || this.sees(o.x, o.y - 4) || this.sees(o.x, o.y + 10);
      this.seen.set(o, r);
    }
    return r;
  }

  /**
   * The shadows: behind every block (as seen from the eye) out of sight, drawn
   * under the map (the blocks themselves are drawn over them; Remastered darkens
   * over everything instead, with `fill`). view: the part of the world on screen;
   * only blocks there can hide anything on screen.
   */
  drawShadows(ctx, view, fill = FOG) {
    const { x: ex, y: ey } = this.eye;
    ctx.fillStyle = fill;
    ctx.beginPath();
    this.map.query(view.l, view.t, view.r, view.b, s => {
      if (ex >= s.l && ex <= s.r && ey >= s.t && ey <= s.b) return false;
      // The two corners at the edges of the block, as seen from the eye.
      const mid = Math.atan2((s.t + s.b) / 2 - ey, (s.l + s.r) / 2 - ex);
      let lo = null, hi = null, alo = Infinity, ahi = -Infinity;
      for (const [cx, cy] of [[s.l, s.t], [s.r, s.t], [s.r, s.b], [s.l, s.b]]) {
        let a = Math.atan2(cy - ey, cx - ex) - mid;
        if (a > Math.PI) a -= 2 * Math.PI; else if (a < -Math.PI) a += 2 * Math.PI;
        if (a < alo) { alo = a; lo = [cx, cy]; }
        if (a > ahi) { ahi = a; hi = [cx, cy]; }
      }
      const far = ([cx, cy]) => {
        const dx = cx - ex, dy = cy - ey, k = REACH / Math.max(1, Math.hypot(dx, dy));
        return [cx + dx * k, cy + dy * k];
      };
      const f1 = far(lo), f2 = far(hi);
      ctx.moveTo(lo[0], lo[1]);
      ctx.lineTo(hi[0], hi[1]);
      ctx.lineTo(f2[0], f2[1]);
      ctx.lineTo(f1[0], f1[1]);
      ctx.closePath();
      return false;
    });
    ctx.fill();
  }

  /**
   * The match's sounds this frame: ones from places you can't see (and not your own)
   * become alerts. sounds: [{ name, x, y, to }].
   */
  hear(sounds, viewer, now = performance.now()) {
    if (this.eye) {
      for (const s of sounds) {
        if (s.x == null || s.to != null || !HEARD.has(s.name)) continue;
        if (Math.hypot(s.x - viewer.x, s.y - viewer.y) < 40) continue;            // you
        if (Math.hypot(s.x - this.eye.x, s.y - this.eye.y) > HEAR) continue;     // too far to hear
        if (this.sees(s.x, s.y - 6)) continue;                                   // you can see it
        if (this.alerts.some(a => Math.hypot(a.x - s.x, a.y - s.y) < 70 && now - a.at < 450)) continue;
        this.alerts.push({ x: s.x, y: s.y, at: now, loud: LOUD.has(s.name) });
      }
    }
    if (this.alerts.length > 40) this.alerts.splice(0, this.alerts.length - 40);
    this.alerts = this.alerts.filter(a => now - a.at < ALERT_MS);
  }

  /** Ripples where the unseen sounds came from (in the world, over everything else). */
  drawAlerts(ctx, now = performance.now()) {
    for (const a of this.alerts) {
      const k = (now - a.at) / ALERT_MS;
      ctx.strokeStyle = '#e0701b';
      ctx.lineWidth = a.loud ? 2.2 : 1.5;
      for (const d of [0, 0.25]) {
        const t = k - d;
        if (t < 0 || t > 1) continue;
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.beginPath();
        ctx.arc(a.x, a.y - 6, 5 + t * (a.loud ? 34 : 22), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Alerts off screen: an arrow at the screen's edge pointing their way (screen space). */
  drawEdgeAlerts(ctx, r, W, H, now = performance.now()) {
    for (const a of this.alerts) {
      const sx = (a.x - r.cam.x) * r.scale + W / 2, sy = (a.y - r.cam.y) * r.scale + H / 2;
      const pad = 18;
      if (sx > pad && sx < W - pad && sy > pad && sy < H - pad) continue;
      const cx = W / 2, cy = H / 2, dx = sx - cx, dy = sy - cy;
      const k = Math.min(Math.abs((W / 2 - pad) / (dx || 1e-9)), Math.abs((H / 2 - pad) / (dy || 1e-9)), 1);
      ctx.save();
      ctx.globalAlpha = 1 - (now - a.at) / ALERT_MS;
      ctx.translate(cx + dx * k, cy + dy * k);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.fillStyle = '#e0701b';
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -8); ctx.lineTo(-3, 0); ctx.lineTo(-6, 8); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
}
