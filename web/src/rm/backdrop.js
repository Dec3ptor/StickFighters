// Remastered's scenery behind the play area: a sky (gradient, sun or moon, stars,
// clouds), then layers of scenery that scroll slower the further away they are
// (parallax), each hazier than the one in front of it.
//
// Each layer is drawn once, procedurally, into a strip that repeats sideways (a
// "tile"), at a modest resolution (distant things are soft anyway); every frame
// just copies the strips into place. Layers are in world units as they appear on
// screen; `p` sets how far each moves with the camera.

import { makeRng } from '../util.js';
import { css, mix, rgb, shade } from './color.js';
import { drawVignette } from './fx.js';

const TILE_W = 1800;           // a layer's strip repeats every this many world units
const MAX_STRIP = 4096;        // biggest strip, in pixels
const VERTICAL = 0.6;          // layers move up and down this much less than sideways

const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.ceil(w)), height: Math.max(1, Math.ceil(h)) });

// ---- Noise -------------------------------------------------------------------------------

/** Smooth noise that repeats every `period` steps (0..1). */
function noise(rng, period) {
  const v = Array.from({ length: period }, () => rng());
  return x => {
    const i = Math.floor(x), f = x - i, t = f * f * (3 - 2 * f);
    const a = v[((i % period) + period) % period], b = v[(((i + 1) % period) + period) % period];
    return a + (b - a) * t;
  };
}

/** Layered noise (big shapes, then finer detail at `rough` strength), repeating every `period` steps. */
function fbm(rng, period, octaves = 4, rough = 0.5) {
  const n = Array.from({ length: octaves }, (_, o) => noise(rng, period << o));
  let norm = 0;
  for (let o = 0; o < octaves; o++) norm += rough ** o;
  return x => {
    let s = 0;
    for (let o = 0; o < octaves; o++) s += n[o](x * (1 << o)) * rough ** o;
    return s / norm;
  };
}

// ---- Layer generators -----------------------------------------------------------------------
// Each draws in world units onto a context whose ground line is y = 0 (up is negative),
// over x from 0 to TILE_W; anything crossing the ends is drawn again on the other side,
// so the strip repeats seamlessly. `c` is the layer's colour (haze already mixed in).

/** Draw fn(x) at x, and again a strip's width over if it crosses the end. */
function wrap(x, w, fn) {
  fn(x);
  if (x + w > TILE_W) fn(x - TILE_W);
  if (x < 0) fn(x + TILE_W);
}

/** A filled outline y(x) from left to right, down to the ground. */
function profile(ctx, y, step = 6) {
  ctx.beginPath();
  ctx.moveTo(0, 2);
  for (let x = 0; x <= TILE_W; x += step) ctx.lineTo(x, y(x));
  ctx.lineTo(TILE_W, 2);
  ctx.closePath();
  ctx.fill();
}

const GEN = {
  ridge(ctx, L, c, rng) {
    const n = fbm(rng, 6, 5, L.rough ?? 0.5);
    const y = x => -L.height * (0.25 + 0.75 * n((x / TILE_W) * 6));
    ctx.fillStyle = css(c);
    profile(ctx, y, 5);
    // A faint lit edge along the top.
    ctx.strokeStyle = css(shade(c, 1.25), 0.5);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let x = 0; x <= TILE_W; x += 5) ctx[x ? 'lineTo' : 'moveTo'](x, y(x));
    ctx.stroke();
  },

  hills(ctx, L, c, rng) {
    const n = fbm(rng, 5, 3, 0.35);
    ctx.fillStyle = css(c);
    profile(ctx, x => -L.height * (0.3 + 0.7 * n((x / TILE_W) * 5)), 8);
  },

  peaks(ctx, L, c, rng) {
    // Sharp peaks: noise folded into ridges.
    const n = fbm(rng, 7, 5, 0.55);
    const y = x => {
      const v = n((x / TILE_W) * 7);
      return -L.height * (0.15 + 0.85 * (1 - Math.abs(v - 0.5) * 2) ** 1.6);
    };
    ctx.fillStyle = css(c);
    profile(ctx, y, 4);
    // Snow on the tops (inside the mountains' outline).
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 2);
    for (let x = 0; x <= TILE_W; x += 4) ctx.lineTo(x, y(x));
    ctx.lineTo(TILE_W, 2);
    ctx.closePath();
    ctx.clip();
    const jag = noise(rng, 90);
    ctx.fillStyle = css(L.snow);
    ctx.beginPath();
    ctx.moveTo(0, -L.height * 2);
    for (let x = 0; x <= TILE_W; x += 4) {
      const top = y(x), line = -L.height * 0.74 + (jag((x / TILE_W) * 90) - 0.5) * L.height * 0.14;
      ctx.lineTo(x, Math.max(top, line));
    }
    ctx.lineTo(TILE_W, -L.height * 2);
    ctx.closePath();
    ctx.fill();
    // The side of each peak away from the light, a shade darker.
    ctx.fillStyle = css(shade(c, 0.82), 0.5);
    ctx.beginPath();
    let down = false;
    for (let x = 0; x <= TILE_W; x += 4) {
      const falling = y(x + 4) > y(x);
      if (falling && !down) { ctx.moveTo(x, y(x)); down = true; }
      if (down) ctx.lineTo(x, y(x));
      if (!falling && down) { ctx.lineTo(x, 2); ctx.lineTo(x - 1, 2); down = false; }
    }
    ctx.fill();
    ctx.restore();
  },

  mesas(ctx, L, c, rng) {
    const n = fbm(rng, 5, 2, 0.4), step = noise(rng, 12);
    const y = x => {
      const t = (x / TILE_W) * 12;
      const s = step(t);
      const flat = s > 0.55 ? 1 : s > 0.45 ? (s - 0.45) * 10 : 0;
      return -L.height * (0.2 + 0.25 * n((x / TILE_W) * 5) + 0.55 * flat);
    };
    ctx.fillStyle = css(c);
    profile(ctx, y, 3);
    // Strata: lighter bands across the cliffs.
    ctx.globalCompositeOperation = 'source-atop';
    for (let k = 1; k < 6; k++) {
      ctx.fillStyle = css(shade(c, k % 2 ? 1.08 : 0.94), 0.6);
      ctx.fillRect(0, -L.height * (0.15 + k * 0.13), TILE_W, L.height * 0.05);
    }
    ctx.globalCompositeOperation = 'source-over';
  },

  dunes(ctx, L, c, rng) {
    const n = fbm(rng, 4, 3, 0.3);
    const y = x => -L.height * (0.25 + 0.75 * n((x / TILE_W) * 4));
    ctx.fillStyle = css(c);
    profile(ctx, y, 6);
    // Lit crests.
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = css(shade(c, 1.15), 0.5);
    ctx.beginPath();
    for (let x = 0; x <= TILE_W; x += 6) ctx[x ? 'lineTo' : 'moveTo'](x, y(x) + 6);
    for (let x = TILE_W; x >= 0; x -= 6) ctx.lineTo(x, y(x) - 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  },

  rocks(ctx, L, c, rng) {
    ctx.fillStyle = css(c);
    for (let x = 0; x < TILE_W; x += rng.range(60, 200)) {
      const w = rng.range(30, 110), h = rng.range(20, L.height * 0.55);
      wrap(x, w, X => {
        ctx.beginPath();
        ctx.moveTo(X, 2);
        const k = 7;
        for (let i = 0; i <= k; i++) {
          const a = Math.PI * (1 - i / k);
          ctx.lineTo(X + w / 2 + Math.cos(a) * w / 2 * rng.range(0.85, 1.05), -Math.sin(a) * h * rng.range(0.8, 1.05));
        }
        ctx.lineTo(X + w, 2);
        ctx.fill();
      });
    }
    if (L.cacti) {
      for (let x = 30; x < TILE_W; x += rng.range(140, 320)) {
        const h = rng.range(L.height * 0.5, L.height), w = 7;
        wrap(x, 40, X => {
          ctx.fillRect(X, -h, w, h + 2);
          const arm = (dx, y0, len) => {
            ctx.fillRect(X + (dx < 0 ? -12 : w), y0, 12, 5);
            ctx.fillRect(X + (dx < 0 ? -12 : w + 7), y0 - len, 5, len + 5);
          };
          arm(-1, -h * 0.55, h * 0.22);
          if (rng() < 0.7) arm(1, -h * 0.4, h * 0.18);
        });
      }
    }
  },

  skyline(ctx, L, c, rng) {
    const win = L.windows && rgb(L.windows);
    for (let x = 0; x < TILE_W;) {
      const w = rng.range(36, 120);
      if (L.gap && rng() < L.gap * 0.4) { x += w * rng.range(0.3, 1); continue; }
      const h = L.height * rng.range(0.3, 1) * (rng() < 0.15 ? 1 : 0.8);
      const body = shade(c, rng.range(0.92, 1.06));
      wrap(x, w + 20, X => {
        ctx.fillStyle = css(body);
        ctx.fillRect(X, -h, w, h + 2);
        // Roofs: setbacks, a water tower, antennas.
        if (rng() < 0.35) ctx.fillRect(X + w * 0.2, -h - h * 0.08, w * 0.6, h * 0.08 + 1);
        if (L.roof && rng() < 0.3) {
          ctx.fillRect(X + w * 0.6, -h - 18, 14, 12);
          ctx.fillRect(X + w * 0.6 + 2, -h - 6, 2, 6);
          ctx.fillRect(X + w * 0.6 + 10, -h - 6, 2, 6);
        }
        if (rng() < 0.3) ctx.fillRect(X + w * rng.range(0.2, 0.8), -h - rng.range(20, 50), 1.5, 50);
        if (win) {
          for (let wy = -h + 8; wy < -6; wy += 9) {
            for (let wx = X + 5; wx < X + w - 7; wx += 7) {
              if (rng() > L.lit) continue;
              ctx.fillStyle = css(win, rng.range(0.45, 1));
              ctx.fillRect(wx, wy, 3, 4);
            }
          }
        }
      });
      x += w + rng.range(0, 14);
    }
  },

  base(ctx, L, c, rng) {
    ctx.fillStyle = css(c);
    ctx.strokeStyle = css(c);
    for (let x = 0; x < TILE_W; x += rng.range(120, 260)) {
      const kind = rng.int(4);
      wrap(x, 200, X => {
        ctx.fillStyle = css(c);
        if (kind === 0) {
          // A hangar with a curved roof.
          const w = rng.range(90, 160), h = rng.range(40, 70);
          ctx.beginPath();
          ctx.moveTo(X, 2);
          ctx.lineTo(X, -h * 0.5);
          ctx.quadraticCurveTo(X + w / 2, -h * 1.5, X + w, -h * 0.5);
          ctx.lineTo(X + w, 2);
          ctx.fill();
        } else if (kind === 1) {
          // A radar dish on a stand.
          const h = rng.range(60, 110);
          ctx.fillRect(X + 18, -h, 5, h + 2);
          ctx.beginPath();
          ctx.ellipse(X + 20, -h - 10, 26, 14, -0.5, Math.PI * 0.95, Math.PI * 1.95);
          ctx.fill();
        } else if (kind === 2) {
          // A control tower.
          const h = rng.range(L.height * 0.6, L.height);
          ctx.fillRect(X + 10, -h, 16, h + 2);
          ctx.fillRect(X, -h - 18, 36, 18);
          ctx.fillStyle = css(mix(c, '#7fb0ff', 0.35));
          ctx.fillRect(X + 3, -h - 14, 30, 8);
        } else {
          // A mast with a beacon.
          const h = rng.range(L.height * 0.7, L.height * 1.1);
          ctx.fillRect(X, -h, 2, h + 2);
          for (let y = -h; y < 0; y += 22) { ctx.beginPath(); ctx.moveTo(X - 6, y + 22); ctx.lineTo(X + 1, y); ctx.lineTo(X + 8, y + 22); ctx.lineWidth = 0.8; ctx.stroke(); }
          if (L.beacons) {
            const g = ctx.createRadialGradient(X + 1, -h, 0, X + 1, -h, 10);
            g.addColorStop(0, css(L.beacons, 0.9));
            g.addColorStop(1, css(L.beacons, 0));
            ctx.fillStyle = g;
            ctx.fillRect(X - 9, -h - 10, 20, 20);
          }
        }
      });
    }
    ctx.fillStyle = css(c);
    ctx.fillRect(0, -12, TILE_W, 14);
  },

  fence(ctx, L, c, rng) {
    ctx.fillStyle = css(c);
    ctx.strokeStyle = css(c, 0.5);
    ctx.lineWidth = 0.7;
    const top = -L.height * 0.45;
    for (let x = 0; x < TILE_W; x += 70) {
      ctx.fillRect(x, top - 6, 3, -top + 8);
      ctx.beginPath();
      for (let k = 0; k < 70; k += 7) { ctx.moveTo(x + k, top); ctx.lineTo(x + k + 7, 0); ctx.moveTo(x + k + 7, top); ctx.lineTo(x + k, 0); }
      ctx.stroke();
    }
    ctx.fillRect(0, top - 2, TILE_W, 2);
    // Watchtowers and floodlights now and then.
    for (let x = rng.range(100, 300); x < TILE_W; x += rng.range(380, 700)) {
      const h = L.height;
      wrap(x, 50, X => {
        ctx.fillRect(X, -h, 3, h);
        ctx.fillRect(X + 34, -h, 3, h);
        ctx.fillRect(X - 6, -h - 20, 50, 20);
        ctx.fillRect(X - 10, -h - 26, 58, 6);
      });
    }
  },

  pines(ctx, L, c, rng) {
    for (let x = 0; x < TILE_W; x += rng.range(8, 26)) {
      const h = rng.range(L.height * 0.45, L.height), w = h * rng.range(0.32, 0.42);
      const col = shade(c, rng.range(0.85, 1.1));
      wrap(x, w, X => {
        ctx.fillStyle = css(col);
        ctx.fillRect(X + w / 2 - 1.5, -h * 0.25, 3, h * 0.25 + 2);
        for (let k = 0; k < 3; k++) {
          const ty = -h * (0.25 + k * 0.25), tw = w * (1 - k * 0.25);
          ctx.beginPath();
          ctx.moveTo(X + w / 2 - tw / 2, ty + h * 0.08);
          ctx.lineTo(X + w / 2, ty - h * 0.42);
          ctx.lineTo(X + w / 2 + tw / 2, ty + h * 0.08);
          ctx.fill();
          if (L.snow) {
            ctx.fillStyle = css(L.snow, 0.85);
            ctx.beginPath();
            ctx.moveTo(X + w / 2 - tw * 0.2, ty - h * 0.2);
            ctx.lineTo(X + w / 2, ty - h * 0.42);
            ctx.lineTo(X + w / 2 + tw * 0.25, ty - h * 0.17);
            ctx.fill();
            ctx.fillStyle = css(col);
          }
        }
      });
    }
  },

  canopy(ctx, L, c, rng) {
    for (let x = 0; x < TILE_W; x += rng.range(18, 50)) {
      const h = rng.range(L.height * 0.4, L.height) * (L.tall && rng() < 0.3 ? 1.15 : 1);
      const r = rng.range(16, 36), col = shade(c, rng.range(0.85, 1.12));
      wrap(x, r * 2.5, X => {
        ctx.fillStyle = css(shade(col, 0.8));
        ctx.fillRect(X - 2, -h + r, 4, h - r + 2);
        ctx.fillStyle = css(col);
        for (let k = 0; k < 5; k++) {
          ctx.beginPath();
          ctx.arc(X + rng.range(-r, r) * 0.9, -h + rng.range(-r, r) * 0.5, r * rng.range(0.5, 0.85), 0, Math.PI * 2);
          ctx.fill();
        }
        if (L.tall && rng() < 0.4) {
          // Hanging vines.
          ctx.strokeStyle = css(col, 0.8);
          ctx.lineWidth = 1;
          for (let v = 0; v < 3; v++) {
            const vx = X + rng.range(-r, r);
            ctx.beginPath(); ctx.moveTo(vx, -h); ctx.quadraticCurveTo(vx + 4, -h + r * 1.5, vx - 2, -h + r * rng.range(1.5, 3)); ctx.stroke();
          }
        }
      });
    }
    // A thick base of undergrowth.
    const n = fbm(rng, 30, 3, 0.5);
    ctx.fillStyle = css(c);
    profile(ctx, x => -L.height * (0.2 + 0.25 * n((x / TILE_W) * 30)), 6);
  },

  industry(ctx, L, c, rng) {
    for (let x = 0; x < TILE_W;) {
      const kind = rng.int(L.tanks ? 4 : 3), w = rng.range(50, 140);
      wrap(x, w + 40, X => {
        ctx.fillStyle = css(shade(c, rng.range(0.9, 1.08)));
        if (kind === 0) {
          // A hall with a sawtooth roof.
          const h = rng.range(L.height * 0.3, L.height * 0.5);
          ctx.fillRect(X, -h, w, h + 2);
          for (let k = X; k < X + w - 4; k += 18) {
            ctx.beginPath(); ctx.moveTo(k, -h); ctx.lineTo(k + 18, -h - 12); ctx.lineTo(k + 18, -h); ctx.fill();
          }
        } else if (kind === 1) {
          // Chimneys.
          for (let k = 0; k < rng.int(3) + 1; k++) {
            const h = rng.range(L.height * 0.6, L.height), cx = X + k * 22;
            ctx.beginPath();
            ctx.moveTo(cx, 2); ctx.lineTo(cx + 2, -h); ctx.lineTo(cx + 12, -h); ctx.lineTo(cx + 14, 2);
            ctx.fill();
            ctx.fillRect(cx, -h - 3, 14, 4);
            if (L.smoke) {
              const g = ctx.createRadialGradient(cx + 7, -h - 30, 0, cx + 7, -h - 30, 40);
              g.addColorStop(0, css(shade(c, 1.6), 0.35));
              g.addColorStop(1, css(shade(c, 1.6), 0));
              ctx.fillStyle = g;
              ctx.beginPath(); ctx.ellipse(cx + 18, -h - 40, 46, 34, -0.4, 0, Math.PI * 2); ctx.fill();
              ctx.fillStyle = css(shade(c, rng.range(0.9, 1.08)));
            }
          }
        } else if (kind === 2) {
          // A crane.
          const h = rng.range(L.height * 0.7, L.height);
          ctx.fillRect(X + 10, -h, 6, h + 2);
          ctx.fillRect(X - 30, -h, 110, 5);
          ctx.strokeStyle = css(c);
          ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.moveTo(X + 13, -h - 18); ctx.lineTo(X - 30, -h); ctx.moveTo(X + 13, -h - 18); ctx.lineTo(X + 80, -h); ctx.stroke();
          ctx.fillRect(X + 11, -h - 18, 4, 18);
          ctx.fillRect(X + 60, -h + 5, 1, h * 0.3);
        } else {
          // Tanks.
          const r = rng.range(20, 36);
          ctx.beginPath();
          ctx.ellipse(X + r, -r * 1.2, r, r * 1.2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillRect(X, -r * 1.2, r * 2, r * 1.2 + 2);
        }
      });
      x += w + rng.range(0, 30);
    }
    // Pipes along the bottom.
    ctx.fillStyle = css(c);
    ctx.fillRect(0, -L.height * 0.12, TILE_W, 5);
    ctx.fillRect(0, 0, TILE_W, 2);
  },

  girders(ctx, L, c, rng) {
    ctx.fillStyle = css(c);
    ctx.strokeStyle = css(c);
    for (let x = 0; x < TILE_W; x += rng.range(150, 320)) {
      const h = rng.range(L.height * 0.6, L.height);
      wrap(x, 30, X => {
        ctx.fillRect(X, -h, 4, h + 2);
        ctx.fillRect(X + 22, -h, 4, h + 2);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let y = -h; y < 0; y += 26) { ctx.moveTo(X, y); ctx.lineTo(X + 26, y + 26); ctx.moveTo(X + 26, y); ctx.lineTo(X, y + 26); }
        ctx.stroke();
        if (rng() < 0.6) ctx.fillRect(X - 60, -h, 150, 5);
      });
    }
  },

  castles(ctx, L, c, rng) {
    const win = L.windows && rgb(L.windows);
    for (let x = rng.range(0, 100); x < TILE_W; x += rng.range(260, 520)) {
      const w = rng.range(140, 240), wallH = L.height * rng.range(0.3, 0.45);
      wrap(x, w + 60, X => {
        ctx.fillStyle = css(c);
        ctx.fillRect(X, -wallH, w, wallH + 2);
        for (let k = X; k < X + w; k += 12) ctx.fillRect(k, -wallH - 7, 7, 7);
        // Towers with pointed roofs.
        for (const tx of [X - 12, X + w - 12, X + w * 0.45]) {
          const th = L.height * rng.range(0.55, 1), tw = 26;
          ctx.fillRect(tx, -th, tw, th + 2);
          ctx.beginPath(); ctx.moveTo(tx - 4, -th); ctx.lineTo(tx + tw / 2, -th - 34); ctx.lineTo(tx + tw + 4, -th); ctx.fill();
          ctx.fillRect(tx + tw / 2 - 0.5, -th - 50, 1, 16);
          ctx.beginPath(); ctx.moveTo(tx + tw / 2 + 0.5, -th - 50); ctx.lineTo(tx + tw / 2 + 10, -th - 46); ctx.lineTo(tx + tw / 2 + 0.5, -th - 42); ctx.fill();
          if (win) {
            for (let wy = -th + 14; wy < -wallH; wy += 22) {
              if (rng() < 0.5) continue;
              ctx.fillStyle = css(win, rng.range(0.5, 1));
              ctx.fillRect(tx + tw / 2 - 2, wy, 4, 7);
              ctx.fillStyle = css(c);
            }
          }
        }
      });
    }
    const n = fbm(rng, 8, 3, 0.4);
    ctx.fillStyle = css(c);
    profile(ctx, x => -L.height * 0.1 * n((x / TILE_W) * 8), 8);
  },

  ruins(ctx, L, c, rng) {
    const fire = L.fires && rgb(L.fires);
    for (let x = 0; x < TILE_W;) {
      const w = rng.range(40, 120), h = L.height * rng.range(0.25, 0.9);
      wrap(x, w + 10, X => {
        ctx.fillStyle = css(shade(c, rng.range(0.9, 1.08)));
        ctx.beginPath();
        ctx.moveTo(X, 2);
        ctx.lineTo(X, -h * rng.range(0.6, 1));
        for (let k = 1; k <= 5; k++) ctx.lineTo(X + (w * k) / 5, -h * rng.range(0.45, 1));
        ctx.lineTo(X + w, 2);
        ctx.fill();
        // Blown-out windows.
        ctx.fillStyle = css(shade(c, 0.6));
        for (let wy = -h * 0.4; wy < -10; wy += 16) for (let wx = X + 6; wx < X + w - 10; wx += 14) if (rng() < 0.5) ctx.fillRect(wx, wy, 6, 8);
        if (fire && rng() < 0.25) {
          const fx = X + rng.range(0, w);
          const g = ctx.createRadialGradient(fx, -6, 0, fx, -6, 44);
          g.addColorStop(0, css(fire, 0.75));
          g.addColorStop(1, css(fire, 0));
          ctx.fillStyle = g;
          ctx.fillRect(fx - 44, -50, 88, 52);
        }
      });
      x += w + rng.range(10, 60);
    }
  },

  wire(ctx, L, c, rng) {
    ctx.fillStyle = css(c);
    ctx.strokeStyle = css(c);
    // Sandbag walls, tank traps and barbed wire.
    for (let x = 0; x < TILE_W; x += rng.range(80, 220)) {
      const kind = rng.int(3);
      wrap(x, 120, X => {
        if (kind === 0) {
          for (let row = 0; row < 3; row++) for (let k = 0; k < 6 - row; k++) {
            ctx.beginPath(); ctx.ellipse(X + k * 14 + row * 7, -6 - row * 9, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
          }
        } else if (kind === 1) {
          ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(X, 0); ctx.lineTo(X + 30, -30); ctx.moveTo(X + 30, 0); ctx.lineTo(X, -30); ctx.moveTo(X + 15, 0); ctx.lineTo(X + 15, -34); ctx.stroke();
        } else {
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          for (let k = 0; k < 100; k += 4) ctx.ellipse(X + k, -16, 10, 12, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillRect(X - 2, -40, 3, 40);
          ctx.fillRect(X + 98, -40, 3, 40);
        }
      });
    }
    ctx.fillRect(0, -3, TILE_W, 5);
  },

  sea(ctx, L, c, rng) {
    // Distant islands on the horizon, then the sea.
    const n = fbm(rng, 6, 3, 0.5);
    ctx.fillStyle = css(c);
    profile(ctx, x => {
      const v = n((x / TILE_W) * 6);
      return v > 0.55 ? -L.height * (v - 0.55) * 2.2 - L.height * 0.35 : -L.height * 0.35;
    }, 6);
    ctx.fillStyle = css(L.water);
    ctx.fillRect(0, -L.height * 0.35, TILE_W, L.height * 0.35 + 2);
    ctx.fillStyle = css(shade(L.water, 1.35), 0.5);
    for (let k = 0; k < 160; k++) ctx.fillRect(rng.range(0, TILE_W), -rng.range(2, L.height * 0.34), rng.range(6, 30), 1);
  },

  ships(ctx, L, c, rng) {
    for (let x = rng.range(0, 200); x < TILE_W; x += rng.range(300, 600)) {
      const w = rng.range(160, 260);
      wrap(x, w, X => {
        ctx.fillStyle = css(c);
        ctx.beginPath();
        ctx.moveTo(X, -30); ctx.lineTo(X + w, -30); ctx.lineTo(X + w - 18, 2); ctx.lineTo(X + 10, 2);
        ctx.fill();
        ctx.fillRect(X + w * 0.72, -78, 34, 48);
        ctx.fillRect(X + w * 0.75, -100, 6, 22);
        for (let k = X + 14; k < X + w * 0.68; k += 18) {
          const stack = rng.int(3) + 1;
          for (let s = 0; s < stack; s++) {
            ctx.fillStyle = css(shade(c, rng.range(0.85, 1.2)));
            ctx.fillRect(k, -30 - (s + 1) * 10, 16, 9);
          }
        }
      });
    }
    // Harbour cranes.
    ctx.fillStyle = css(c);
    for (let x = rng.range(50, 200); x < TILE_W; x += rng.range(400, 700)) {
      const h = L.height;
      wrap(x, 120, X => {
        ctx.fillRect(X, -h, 5, h + 2); ctx.fillRect(X + 40, -h, 5, h + 2);
        ctx.fillRect(X - 20, -h - 6, 130, 7);
        ctx.fillRect(X + 80, -h, 2, h * 0.4);
      });
    }
  },

  docks(ctx, L, c, rng) {
    ctx.fillStyle = css(c);
    for (let x = 0; x < TILE_W; x += rng.range(90, 240)) {
      const kind = rng.int(3);
      wrap(x, 200, X => {
        if (kind === 0) {
          // Container stacks.
          const cols = rng.int(3) + 2;
          for (let k = 0; k < cols; k++) {
            const stack = rng.int(4) + 1;
            for (let s = 0; s < stack; s++) {
              ctx.fillStyle = css(shade(c, rng.range(0.8, 1.25)));
              ctx.fillRect(X + k * 42, -(s + 1) * 18, 40, 17);
            }
          }
        } else if (kind === 1) {
          // A gantry crane.
          const h = L.height * rng.range(0.7, 1);
          ctx.fillStyle = css(c);
          ctx.beginPath(); ctx.moveTo(X, 2); ctx.lineTo(X + 12, -h); ctx.lineTo(X + 18, -h); ctx.lineTo(X + 8, 2); ctx.fill();
          ctx.beginPath(); ctx.moveTo(X + 70, 2); ctx.lineTo(X + 58, -h); ctx.lineTo(X + 52, -h); ctx.lineTo(X + 62, 2); ctx.fill();
          ctx.fillRect(X - 30, -h - 8, 160, 8);
        } else {
          ctx.fillStyle = css(c);
          ctx.fillRect(X, -8, 8, 10);
          ctx.fillRect(X - 2, -10, 12, 3);
        }
      });
    }
    ctx.fillStyle = css(c);
    ctx.fillRect(0, -4, TILE_W, 6);
  },

  wall(ctx, L, c, rng) {
    // A hangar's back wall: panels, high windows with the evening outside, a stripe, numbers.
    const h = L.height;
    ctx.fillStyle = css(c);
    ctx.fillRect(0, -h, TILE_W, h + 2);
    ctx.fillStyle = css(shade(c, 0.85));
    for (let x = 0; x < TILE_W; x += 60) ctx.fillRect(x, -h, 2, h);
    for (let y = -h; y < 0; y += 90) ctx.fillRect(0, y, TILE_W, 2);
    const win = rgb(L.windows || '#f2a35e');
    for (let x = 30; x < TILE_W - 100; x += 300) {
      const g = ctx.createLinearGradient(0, -h * 0.85, 0, -h * 0.55);
      g.addColorStop(0, css(mix(win, '#3a2a50', 0.6)));
      g.addColorStop(1, css(win, 0.95));
      ctx.fillStyle = g;
      ctx.fillRect(x, -h * 0.85, 220, h * 0.3);
      ctx.fillStyle = css(shade(c, 0.6));
      for (let k = x; k <= x + 220; k += 44) ctx.fillRect(k - 2, -h * 0.85, 4, h * 0.3);
      ctx.fillRect(x, -h * 0.71, 220, 3);
    }
    ctx.fillStyle = css(mix(c, '#e8b84a', 0.35));
    ctx.fillRect(0, -h * 0.22, TILE_W, 10);
    ctx.font = 'bold 70px Arial, sans-serif';
    ctx.fillStyle = css(shade(c, 1.35), 0.5);
    for (let x = 140; x < TILE_W; x += 600) ctx.fillText(`${'ABCD'[rng.int(4)]}${rng.int(9) + 1}`, x, -h * 0.3);
  },

  beams(ctx, L, c, rng) {
    const h = L.height;
    ctx.fillStyle = css(c);
    ctx.strokeStyle = css(c);
    for (let x = 0; x < TILE_W; x += 360) {
      ctx.fillRect(x, -h, 14, h + 2);
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let y = -h; y < -40; y += 60) { ctx.moveTo(x + 14, y); ctx.lineTo(x + 60, y + 60); }
      ctx.stroke();
    }
    // Roof trusses.
    ctx.fillRect(0, -h, TILE_W, 12);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < TILE_W; x += 45) { ctx.moveTo(x, -h + 12); ctx.lineTo(x + 22, -h + 45); ctx.lineTo(x + 45, -h + 12); }
    ctx.stroke();
    ctx.fillRect(0, -h + 44, TILE_W, 4);
    // Hanging lamps.
    for (let x = 180; x < TILE_W; x += 360) {
      ctx.fillRect(x, -h + 48, 1.5, 70);
      ctx.beginPath(); ctx.moveTo(x - 12, -h + 128); ctx.lineTo(x + 13, -h + 128); ctx.lineTo(x + 6, -h + 116); ctx.lineTo(x - 5, -h + 116); ctx.fill();
    }
  },
};

// ---- Foreground ------------------------------------------------------------------------------
// Dark shapes right in front of the camera, below the play area, sliding past faster
// than it: depth in front of the fight as well as behind it. Same rules as the layers
// (ground line y = 0, a strip TILE_W wide that repeats), drawn in one dark colour;
// shading and blur are added afterwards.

/** A low, uneven bank for the foreground to stand on. */
function bank(ctx, rng, lo, hi) {
  const n = fbm(rng, 9, 3, 0.5);
  profile(ctx, x => -(lo + (hi - lo) * n((x / TILE_W) * 9)), 8);
}

/** A lumpy rock w wide and h tall at x (snow on top if snow is set). */
function rock(ctx, rng, x, w, h, snow) {
  const pts = [];
  const k = 8;
  for (let i = 0; i <= k; i++) {
    const a = Math.PI * (1 - i / k);
    pts.push([x + w / 2 + Math.cos(a) * w / 2 * rng.range(0.8, 1.05), -Math.sin(a) * h * rng.range(0.75, 1.05)]);
  }
  wrap(x, w, X => {
    const dx = X - x;
    ctx.beginPath();
    ctx.moveTo(X, 4);
    for (const [px, py] of pts) ctx.lineTo(px + dx, py);
    ctx.lineTo(X + w, 4);
    ctx.fill();
    if (snow) {
      const keep = ctx.fillStyle;
      ctx.fillStyle = snow;
      ctx.beginPath();
      ctx.moveTo(pts[1][0] + dx, pts[1][1]);
      for (let i = 2; i < k; i++) ctx.lineTo(pts[i][0] + dx, pts[i][1]);
      for (let i = k - 1; i >= 1; i--) ctx.lineTo(pts[i][0] + dx, pts[i][1] * 0.72 + 1);
      ctx.fill();
      ctx.fillStyle = keep;
    }
  });
}

/** A blade of grass or a reed: a thin curved spike from (x, 0), leaning `lean`. */
function blade(ctx, x, h, lean, w) {
  ctx.moveTo(x - w, 2);
  ctx.quadraticCurveTo(x + lean * 0.3, -h * 0.6, x + lean, -h);
  ctx.quadraticCurveTo(x + lean * 0.3 + w * 0.6, -h * 0.55, x + w, 2);
}

const FORE = {
  /** Tall grass, ferns and broad leaves (jungle, the keep's grounds). */
  grass(ctx, F, c, rng) {
    ctx.fillStyle = css(c);
    bank(ctx, rng, 8, 26);
    ctx.beginPath();
    for (let x = 0; x < TILE_W; x += rng.range(2, 7)) {
      const h = rng.range(F.height * 0.25, F.height * (rng() < 0.12 ? 1 : 0.7));
      const lean = rng.range(-0.35, 0.35) * h, w = rng.range(1.2, 2.6);
      wrap(x, Math.abs(lean) + w * 2, X => blade(ctx, X, h, lean, w));
    }
    ctx.fill();
    // Ferns: arching fronds of leaflets.
    for (let x = rng.range(20, 120); x < TILE_W; x += rng.range(110, 260)) {
      const fronds = 3 + rng.int(4), size = rng.range(F.height * 0.45, F.height * 0.85);
      wrap(x, size * 2.2, X => {
        for (let f = 0; f < fronds; f++) {
          const a = -Math.PI / 2 + rng.range(-1.1, 1.1), len = size * rng.range(0.7, 1.1);
          ctx.beginPath();
          for (let i = 0; i <= 10; i++) {
            const t = i / 10, droop = t * t * len * 0.45;
            const px = X + Math.cos(a) * len * t, py = -8 + Math.sin(a) * len * t + droop;
            const leaf = (1 - t) * len * 0.16 + 1.5;
            ctx.moveTo(px, py);
            ctx.ellipse(px, py, leaf, 1.6, a + 1.2, 0, Math.PI * 2);
            ctx.moveTo(px, py);
            ctx.ellipse(px, py, leaf, 1.6, a - 1.2, 0, Math.PI * 2);
          }
          ctx.fill();
        }
      });
    }
    // Broad leaves now and then.
    for (let x = rng.range(60, 200); x < TILE_W; x += rng.range(160, 380)) {
      const n = 2 + rng.int(3);
      wrap(x, 90, X => {
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 + rng.range(-0.9, 0.9), len = rng.range(30, 55);
          ctx.beginPath();
          ctx.ellipse(X + Math.cos(a) * len * 0.6, -10 + Math.sin(a) * len * 0.6, len * 0.55, len * 0.2, a, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  },

  /** Boulders and stones (snow-capped on frozen maps; scrub and cacti in the desert). */
  rocks(ctx, F, c, rng) {
    ctx.fillStyle = css(c);
    bank(ctx, rng, 6, 20);
    const snow = F.snow ? css(F.snow) : null;
    for (let x = 0; x < TILE_W; x += rng.range(40, 150)) {
      const w = rng.range(30, 120), h = rng.range(F.height * 0.3, F.height * 0.85);
      rock(ctx, rng, x, w, h, snow);
      if (rng() < 0.5) rock(ctx, rng, x + w * rng.range(0.6, 0.9), w * 0.4, h * 0.45, snow);
    }
    if (F.scrub) {
      ctx.strokeStyle = css(c);
      ctx.lineWidth = 1.4;
      for (let x = rng.range(30, 100); x < TILE_W; x += rng.range(70, 200)) {
        const h = rng.range(14, 34);
        wrap(x, 50, X => {
          ctx.beginPath();
          for (let i = 0; i < 9; i++) {
            const a = -Math.PI / 2 + rng.range(-1.2, 1.2);
            ctx.moveTo(X, 0); ctx.lineTo(X + Math.cos(a) * h, Math.sin(a) * h);
          }
          ctx.stroke();
        });
      }
    }
    if (F.cacti) GEN.rocks(ctx, { height: F.height * 1.1, cacti: true }, c, rng);
  },

  /** Broken concrete, rebar and junk (the frontline). */
  rubble(ctx, F, c, rng) {
    ctx.fillStyle = css(c);
    ctx.strokeStyle = css(c);
    bank(ctx, rng, 8, 24);
    for (let x = 0; x < TILE_W; x += rng.range(24, 90)) {
      const w = rng.range(18, 70), h = rng.range(10, F.height * 0.6), tilt = rng.range(-0.5, 0.5);
      wrap(x, w + 20, X => {
        ctx.beginPath();
        ctx.moveTo(X, 2);
        ctx.lineTo(X + w * 0.1, -h * rng.range(0.6, 1));
        ctx.lineTo(X + w * (0.45 + tilt * 0.3), -h);
        ctx.lineTo(X + w * 0.9, -h * rng.range(0.4, 0.9));
        ctx.lineTo(X + w, 2);
        ctx.fill();
        if (rng() < 0.45) {
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          for (let i = 0; i < 3; i++) {
            const bx = X + w * rng.range(0.2, 0.8), by = -h * rng.range(0.5, 0.9);
            ctx.moveTo(bx, by); ctx.lineTo(bx + rng.range(-14, 14), by - rng.range(10, 26));
          }
          ctx.stroke();
        }
      });
    }
    // Tyres and a bent sign post here and there.
    for (let x = rng.range(80, 300); x < TILE_W; x += rng.range(260, 520)) {
      wrap(x, 60, X => {
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.ellipse(X + 14, -12, 12, 11, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(X + 40, 2); ctx.lineTo(X + 44, -F.height * 0.9); ctx.stroke();
        ctx.fillRect(X + 30, -F.height * 0.9 - 14, 26, 14);
      });
    }
  },

  /** A rooftop's edge: parapet, air-conditioning units, vents and aerials (the city). */
  rooftop(ctx, F, c, rng) {
    ctx.fillStyle = css(c);
    ctx.strokeStyle = css(c);
    ctx.fillRect(0, -16, TILE_W, 20);
    for (let x = 0; x < TILE_W; x += rng.range(50, 160)) {
      const kind = rng.int(4);
      wrap(x, 90, X => {
        if (kind === 0) {
          const w = rng.range(34, 60), h = rng.range(24, 38);
          ctx.fillRect(X, -16 - h, w, h);
          ctx.fillRect(X + w * 0.15, -16 - h - 3, w * 0.7, 3);
        } else if (kind === 1) {
          ctx.fillRect(X, -16 - 30, 9, 30);
          ctx.fillRect(X - 3, -16 - 34, 15, 5);
        } else if (kind === 2) {
          const h = rng.range(F.height * 0.8, F.height * 1.3);
          ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(X, -16); ctx.lineTo(X, -16 - h);
          for (let k = 1; k <= 3; k++) { ctx.moveTo(X - 9 + k * 2, -16 - h * (0.55 + k * 0.12)); ctx.lineTo(X + 9 - k * 2, -16 - h * (0.55 + k * 0.12)); }
          ctx.stroke();
        } else {
          ctx.beginPath(); ctx.ellipse(X + 18, -16, 22, 14, 0, Math.PI, 0); ctx.fill();
        }
      });
    }
  },

  /** Crates, barrels and gas bottles (the hangar, the foundry, the base). */
  crates(ctx, F, c, rng) {
    ctx.fillStyle = css(c);
    ctx.fillRect(0, -6, TILE_W, 10);
    for (let x = rng.range(0, 60); x < TILE_W; x += rng.range(70, 210)) {
      const kind = rng.int(3);
      wrap(x, 110, X => {
        if (kind === 0) {
          const s = rng.range(30, 48);
          ctx.fillRect(X, -6 - s, s, s);
          if (rng() < 0.6) { const t = s * rng.range(0.55, 0.8); ctx.fillRect(X + s * 0.15, -6 - s - t, t, t); }
        } else if (kind === 1) {
          for (let i = 0; i < 1 + rng.int(3); i++) {
            const bx = X + i * 24;
            ctx.beginPath();
            ctx.moveTo(bx, -6); ctx.lineTo(bx, -40); ctx.quadraticCurveTo(bx + 10, -44, bx + 20, -40); ctx.lineTo(bx + 20, -6);
            ctx.fill();
          }
        } else {
          for (let i = 0; i < 2 + rng.int(3); i++) {
            const bx = X + i * 10;
            ctx.fillRect(bx, -6 - 46, 8, 46);
            ctx.beginPath(); ctx.arc(bx + 4, -6 - 46, 4, Math.PI, 0); ctx.fill();
          }
        }
      });
    }
  },

  /** A quayside: bollards, a chain rail on posts, coiled rope (the harbour). */
  quay(ctx, F, c, rng) {
    ctx.fillStyle = css(c);
    ctx.strokeStyle = css(c);
    ctx.fillRect(0, -10, TILE_W, 14);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let x = 0; x < TILE_W; x += 90) {
      ctx.moveTo(x, -10); ctx.lineTo(x, -F.height * 0.7);
      ctx.moveTo(x, -F.height * 0.66);
      ctx.quadraticCurveTo(x + 45, -F.height * 0.4, x + 90, -F.height * 0.66);
    }
    ctx.stroke();
    for (let x = rng.range(20, 80); x < TILE_W; x += rng.range(120, 300)) {
      wrap(x, 30, X => {
        ctx.fillRect(X, -10 - 18, 14, 18);
        ctx.fillRect(X - 3, -10 - 22, 20, 5);
      });
    }
  },
};

/** The kinds of scenery layer and of foreground there are (a theme's `gen`). */
export const LAYER_KINDS = Object.keys(GEN);
export const FORE_KINDS = Object.keys(FORE);

// ---- Backdrop --------------------------------------------------------------------------------

// The scenery is put together in a picture smaller than the screen (this much of
// its resolution), then stretched over it in one go: quicker, and distant scenery
// is soft anyway.
const BUFFER = { high: 0.75, medium: 0.55, low: 0.45 };

export class Backdrop {
  /** theme: from themes.js; seed: the map (so a map always gets the same scenery). */
  constructor(theme, seed = 1, quality = 'high') {
    this.theme = theme;
    this.seed = seed;
    this.quality = quality;
    this.built = null;
    this.drift = 0;
    this.buf = null;
  }

  /**
   * Make what doesn't change from frame to frame, for a picture bw x bh pixels at S
   * pixels per world unit: the sky (gradient, sun or moon, stars) and the layers' strips.
   */
  build(S, bw, bh) {
    const t = this.theme, q = this.quality;
    const density = Math.min(S, MAX_STRIP / TILE_W);
    const layers = (q === 'low' ? t.layers.slice(-2) : t.layers).map((L, i) => {
      const rng = makeRng(this.seed * 7919 + i * 104729 + 13);
      const c = mix(L.color, t.haze, L.haze ?? 0);
      const pad = 70; // room above the tallest thing (masts, smoke)
      const H = (L.height + pad) * density;
      const cv = canvas(TILE_W * density, H);
      const ctx = cv.getContext('2d');
      ctx.setTransform(density, 0, 0, density, 0, H);
      GEN[L.gen](ctx, L, c, rng);
      // Mist at the bottom of each layer (more on the further ones).
      if (t.mist) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-atop';
        const g = ctx.createLinearGradient(0, H * 0.35, 0, H);
        g.addColorStop(0, css(t.mist.color, 0));
        g.addColorStop(1, css(t.mist.color, Math.min(0.8, t.mist.alpha * (1.4 - L.p))));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, cv.width, H);
        ctx.globalCompositeOperation = 'source-over';
      }
      // What's below the ground line: the layer's colour at its foot, misted.
      const foot = t.mist ? mix(c, t.mist.color, Math.min(0.8, t.mist.alpha * (1.4 - L.p))) : c;
      return { ...L, canvas: cv, density, H, foot: css(foot) };
    });
    this.built = { S, bw, bh, layers, clouds: q === 'low' ? null : this.makeClouds(Math.min(density, 0.8)), sky: this.makeSky(bw, bh, S) };
  }

  /** The sky: its gradient, stars, and the sun or moon with its glow (fixed on screen). */
  makeSky(w, h, S) {
    const t = this.theme;
    const cv = canvas(w, h), ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, h);
    for (const [o, c] of t.sky) g.addColorStop(o, c);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (t.stars) {
      const rng = makeRng(this.seed * 17 + 3);
      const n = Math.round(w * h * t.stars);
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = `rgba(255,255,255,${rng.range(0.25, 0.95).toFixed(2)})`;
        const r = rng() < 0.08 ? 1.6 : 1;
        ctx.fillRect(rng.range(0, w), rng.range(0, h * 0.8), r, r);
      }
    }
    if (t.sun) {
      const sx = w * t.sun.x, sy = h * t.sun.y, gr = t.sun.glowR * S * 0.55;
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, gr);
      glow.addColorStop(0, css(t.sun.glow, 0.55));
      glow.addColorStop(0.35, css(t.sun.glow, 0.2));
      glow.addColorStop(1, css(t.sun.glow, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(sx - gr, sy - gr, gr * 2, gr * 2);
      if (t.sun.r) {
        const mr = t.sun.r * S * 0.55;
        ctx.fillStyle = t.sun.color;
        ctx.beginPath(); ctx.arc(sx, sy, mr, 0, Math.PI * 2); ctx.fill();
        if (t.sun.moon) {
          ctx.fillStyle = css(t.sun.glow, 0.25);
          for (const [dx, dy, k] of [[-0.3, -0.2, 0.28], [0.25, 0.15, 0.2], [-0.05, 0.4, 0.15]]) {
            ctx.beginPath(); ctx.arc(sx + dx * mr, sy + dy * mr, k * mr, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
    }
    return cv;
  }

  makeClouds(d) {
    const c = this.theme.clouds;
    if (!c) return null;
    const rng = makeRng(this.seed * 31 + 5);
    const W = TILE_W * 1.5, H = 500;
    const cv = canvas(W * d, H * d);
    const ctx = cv.getContext('2d');
    ctx.scale(d, d);
    // Long, flat clouds: lots of soft puffs, squashed, thickest in the middle.
    for (let k = 0; k < c.count; k++) {
      const x = rng.range(0, W), y = rng.range(40, 460), w = rng.range(220, 520);
      const puffs = Array.from({ length: 16 }, () => {
        const u = rng.range(-0.5, 0.5);
        return { dx: u * w, dy: rng.range(-8, 8) - (1 - Math.abs(u) * 2) * 14, r: rng.range(w * 0.08, w * 0.16) * (1.2 - Math.abs(u)) };
      });
      for (const X of [x, x - W, x + W]) {
        if (X + w < 0 || X - w > W) continue;
        for (const p of puffs) {
          ctx.save();
          ctx.translate(X + p.dx, y + p.dy);
          ctx.scale(1, 0.45);
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.r);
          g.addColorStop(0, css(c.color, c.alpha * 0.55));
          g.addColorStop(1, css(c.color, 0));
          ctx.fillStyle = g;
          ctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 2);
          ctx.restore();
        }
      }
    }
    return { canvas: cv, W, H, d };
  }

  /**
   * Draw the sky and scenery for renderer r (its camera, size and scale), filling
   * the canvas. ground: the world y the scenery stands on (the map's bottom).
   */
  draw(ctx, r, ground, dt = 16, vignette = 0) {
    const res = BUFFER[this.quality] || 0.6;
    const W = Math.max(1, Math.round(r.pw * res)), H = Math.max(1, Math.round(r.ph * res));
    const S0 = r.baseScale * r.dpr * res;
    const b0 = this.built;
    if (!b0 || b0.bw !== W || b0.bh !== H || Math.abs(b0.S - S0) > 1e-3) this.build(S0, W, H);
    if (!this.buf || this.buf.width !== W || this.buf.height !== H) {
      this.buf = canvas(W, H);
      this.bctx = this.buf.getContext('2d', { alpha: false });
    }
    const t = this.theme, b = this.built, bc = this.bctx, S = r.scale * r.dpr * res;
    const cx = r.cam.x, cy = r.cam.y;
    if (b.clouds) this.drift += dt * 0.004;
    // Nothing has moved by as much as a third of a pixel since last time: the picture's still good.
    const last = this.last, maxP = b.layers.length ? b.layers[b.layers.length - 1].p : 0;
    if (last && last.S === S && last.ground === ground && last.vignette === vignette &&
      Math.max(Math.abs(cx - last.cx) * maxP, Math.abs(cy - last.cy) * maxP * VERTICAL, Math.abs(this.drift - last.drift) * 0.5) * S < 0.33) {
      this.present(ctx, r);
      return;
    }
    this.last = { cx, cy, S, ground, vignette, drift: this.drift };
    bc.globalCompositeOperation = 'copy';
    bc.drawImage(b.sky, 0, 0);
    bc.globalCompositeOperation = 'source-over';
    // Clouds, drifting.
    if (b.clouds) {
      const c = b.clouds, w = c.W * S * 0.5, h = c.H * S * 0.5;
      const ox = (((-(cx * 0.03 * S) - this.drift * S) % w) + w) % w - w;
      const oy = H * t.clouds.top - cy * 0.02 * S;
      for (let x = ox; x < W; x += w) bc.drawImage(c.canvas, x, oy, w, h);
    }
    // The layers, furthest first.
    let lastGround = H;
    for (const L of b.layers) {
      const k = S / L.density;
      const w = TILE_W * S, h = L.H * k;
      const gy = H / 2 + (ground - cy) * L.p * VERTICAL * S;
      const top = gy - h;
      if (top > H) continue;
      let ox = -(cx * L.p * S) % w;
      if (ox > 0) ox -= w;
      for (let x = ox; x < W; x += w) bc.drawImage(L.canvas, x, top, w, h);
      if (gy < H) {
        bc.fillStyle = L.foot;
        bc.fillRect(0, gy - 1, W, H - gy + 1);
      }
      lastGround = gy;
    }
    // Below the scenery, down into the dark.
    if (lastGround < H && t.ground) {
      const key = `${lastGround | 0}|${H}`;
      if (this.deepKey !== key) {
        const g = bc.createLinearGradient(0, lastGround, 0, Math.max(lastGround + 1, H));
        g.addColorStop(0, css(t.ground, 0));
        g.addColorStop(1, css(t.ground, 0.9));
        this.deep = g;
        this.deepKey = key;
      }
      bc.fillStyle = this.deep;
      bc.fillRect(0, lastGround, W, H - lastGround);
    }
    // (Lower quality: the edges darkened here, not over the whole picture afterwards.)
    if (vignette > 0) drawVignette(bc, W, H, vignette);
    this.present(ctx, r);
  }

  /** Onto the screen, in one go (it covers everything: no blending needed). */
  present(ctx, r) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(this.buf, 0, 0, r.pw, r.ph);
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * The foreground's strip, at S pixels per world unit: the shapes in the theme's
   * foreground colour, lit a little from above, and softened (out of focus, close up).
   */
  buildFore(S) {
    const t = this.theme, F = t.fore;
    const density = Math.min(S, MAX_STRIP / TILE_W);
    const pad = 40, H = (F.height + pad) * density, W = TILE_W * density;
    const shapes = canvas(W, H), sc = shapes.getContext('2d');
    sc.setTransform(density, 0, 0, density, 0, H);
    const c = rgb(F.color);
    FORE[F.gen](sc, F, c, makeRng(this.seed * 104723 + 977));
    sc.setTransform(1, 0, 0, 1, 0, 0);
    // Light from above along the tops, fading down into the dark.
    sc.globalCompositeOperation = 'source-atop';
    const g = sc.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, css(t.light?.color || '#ffffff', 0.16));
    g.addColorStop(0.55, css(t.light?.color || '#ffffff', 0.04));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    sc.fillStyle = g;
    sc.fillRect(0, 0, W, H);
    sc.globalCompositeOperation = 'source-over';
    // Out of focus. (Browsers without canvas filters just draw it sharp.)
    const cv = canvas(W, H), ctx = cv.getContext('2d');
    const blur = Math.max(0, (F.blur ?? 1.6) * density);
    if (blur > 0.3 && 'filter' in ctx) ctx.filter = `blur(${blur.toFixed(1)}px)`;
    ctx.drawImage(shapes, 0, 0);
    ctx.filter = 'none';
    return { canvas: cv, S, density, H, below: css(c) };
  }

  /**
   * Draw the foreground across the bottom of the screen (no transform), under the
   * play area: floor is the world y of the bottom of the map's lowest block. It moves
   * more than the play area does (it's nearer), but never rises over it.
   */
  drawFore(ctx, r, floor) {
    const F = this.theme.fore;
    if (!F || this.quality === 'low') return;
    const S0 = r.baseScale * r.dpr;
    if (!this.fore || Math.abs(this.fore.S - S0) > 1e-3) this.fore = this.buildFore(S0);
    const f = this.fore, S = r.scale * r.dpr, k = S / f.density;
    const w = TILE_W * S, h = f.H * k;
    const p = F.p ?? 1.35;
    const floorY = r.ph / 2 + (floor - r.cam.y) * S;
    const gy = Math.max(r.ph / 2 + (floor + (F.below ?? 70) - r.cam.y) * p * S, floorY + (F.height + 12) * S);
    if (gy - h >= r.ph) return;
    let ox = -(r.cam.x * p * S) % w;
    if (ox > 0) ox -= w;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let x = ox; x < r.pw; x += w) ctx.drawImage(f.canvas, x, gy - h, w, h);
    if (gy < r.ph) {
      ctx.fillStyle = f.below;
      ctx.fillRect(0, gy - 1, r.pw, r.ph - gy + 1);
    }
  }
}
