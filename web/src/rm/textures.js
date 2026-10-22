// Remastered's materials for the map's blocks: small procedural pictures that
// repeat (concrete, brick, metal plate, rock, grass, snow...), made once per theme.
// Each comes in shades for the block's faces (the front, the sides and top facing
// the light, the side away from it, the underside), and is laid in world units from
// the world's origin, so neighbouring blocks of the same material join up seamlessly.

import { makeRng } from '../util.js';
import { css, mix, rgb, shade } from './color.js';

export const TEX_UNITS = 64;  // a texture covers this many world units each way
const TEX_PX = 256;           // ...at this many pixels

const canvas = (w, h = w) => Object.assign(document.createElement('canvas'), { width: w, height: h });

/** Speckle: n random small marks, lighter or darker than `base`. */
function speckle(ctx, rng, base, n, size, spread = 0.12) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = css(shade(base, 1 + rng.range(-spread, spread)), rng.range(0.25, 0.7));
    const s = size * rng.range(0.5, 1.5);
    ctx.fillRect(rng() * TEX_PX, rng() * TEX_PX, s, s);
  }
}

/** Soft blotches of `color` (moss, rust, stains). */
function blotch(ctx, rng, color, n, r0, r1, alpha) {
  for (let i = 0; i < n; i++) {
    const x = rng() * TEX_PX, y = rng() * TEX_PX, r = rng.range(r0, r1);
    for (const dx of [-TEX_PX, 0, TEX_PX]) for (const dy of [-TEX_PX, 0, TEX_PX]) {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      g.addColorStop(0, css(color, alpha));
      g.addColorStop(1, css(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    }
  }
}

function lines(ctx, color, alpha, width, segs) {
  ctx.strokeStyle = css(color, alpha);
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const [x0, y0, x1, y1] of segs) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
  ctx.stroke();
}

/** A crack wandering across from (x, y). */
function crack(ctx, rng, x, y, color) {
  ctx.strokeStyle = css(color, 0.45);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  let a = rng.range(0, Math.PI * 2);
  for (let i = 0; i < 8; i++) {
    a += rng.range(-0.8, 0.8);
    x += Math.cos(a) * 10; y += Math.sin(a) * 10;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// Each material paints a TEX_PX square (TEX_UNITS world units; 4 px per unit).
export const MATERIALS = {
  concrete(ctx, rng, base) {
    ctx.fillStyle = css(base); ctx.fillRect(0, 0, TEX_PX, TEX_PX);
    blotch(ctx, rng, shade(base, 0.85), 6, 30, 80, 0.25);
    speckle(ctx, rng, base, 1600, 2, 0.18);
    // Panel joints every 32 units.
    lines(ctx, shade(base, 0.6), 0.55, 2, [[0, 0.5, TEX_PX, 0.5], [0, 128.5, TEX_PX, 128.5], [0.5, 0, 0.5, TEX_PX], [128.5, 0, 128.5, TEX_PX]]);
    lines(ctx, shade(base, 1.25), 0.3, 1, [[0, 2.5, TEX_PX, 2.5], [0, 130.5, TEX_PX, 130.5]]);
    for (let i = 0; i < 2; i++) crack(ctx, rng, rng() * TEX_PX, rng() * TEX_PX, shade(base, 0.5));
  },
  tiles(ctx, rng, base) {
    ctx.fillStyle = css(base); ctx.fillRect(0, 0, TEX_PX, TEX_PX);
    for (let y = 0; y < TEX_PX; y += 32) for (let x = 0; x < TEX_PX; x += 32) {
      ctx.fillStyle = css(shade(base, rng.range(0.88, 1.1)));
      ctx.fillRect(x + 1, y + 1, 30, 30);
    }
    speckle(ctx, rng, base, 600, 2);
  },
  metal(ctx, rng, base) {
    ctx.fillStyle = css(base); ctx.fillRect(0, 0, TEX_PX, TEX_PX);
    for (let y = 0; y < TEX_PX; y += 128) for (let x = 0; x < TEX_PX; x += 128) {
      const g = ctx.createLinearGradient(x, y, x + 128, y + 128);
      g.addColorStop(0, css(shade(base, 1.12)));
      g.addColorStop(1, css(shade(base, 0.9)));
      ctx.fillStyle = g;
      ctx.fillRect(x + 2, y + 2, 124, 124);
      ctx.fillStyle = css(shade(base, 0.55));
      for (const [rx, ry] of [[8, 8], [118, 8], [8, 118], [118, 118]]) { ctx.beginPath(); ctx.arc(x + rx, y + ry, 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = css(shade(base, 1.4), 0.6);
      for (const [rx, ry] of [[7, 7], [117, 7], [7, 117], [117, 117]]) ctx.fillRect(x + rx, y + ry, 1.5, 1.5);
    }
    speckle(ctx, rng, base, 500, 1.5, 0.1);
    blotch(ctx, rng, shade(base, 0.7), 4, 20, 50, 0.2);
  },
  steel(ctx, rng, base) { MATERIALS.metal(ctx, rng, base); },
  grating(ctx, rng, base) {
    ctx.fillStyle = css(shade(base, 0.45)); ctx.fillRect(0, 0, TEX_PX, TEX_PX);
    ctx.fillStyle = css(base);
    for (let k = 0; k < TEX_PX; k += 16) { ctx.fillRect(k, 0, 5, TEX_PX); ctx.fillRect(0, k, TEX_PX, 5); }
    ctx.fillStyle = css(shade(base, 1.3), 0.5);
    for (let k = 0; k < TEX_PX; k += 16) ctx.fillRect(k, 0, 1.5, TEX_PX);
  },
  diamond(ctx, rng, base) {
    ctx.fillStyle = css(base); ctx.fillRect(0, 0, TEX_PX, TEX_PX);
    for (let y = 0; y < TEX_PX; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < TEX_PX; x += 16) {
      ctx.fillStyle = css(shade(base, 1.3), 0.7);
      ctx.beginPath(); ctx.ellipse(x + 4, y + 4, 5, 1.6, Math.PI / 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = css(shade(base, 0.7), 0.6);
      ctx.beginPath(); ctx.ellipse(x + 5, y + 5, 5, 1.6, Math.PI / 4, 0, Math.PI * 2); ctx.fill();
    }
  },
  rust(ctx, rng, base) {
    MATERIALS.metal(ctx, rng, base);
    blotch(ctx, rng, '#8a3f1a', 10, 15, 60, 0.4);
    blotch(ctx, rng, '#4a2614', 6, 10, 30, 0.35);
    speckle(ctx, rng, '#a0522a', 700, 2, 0.2);
  },
  rock(ctx, rng, base) {
    ctx.fillStyle = css(base); ctx.fillRect(0, 0, TEX_PX, TEX_PX);
    blotch(ctx, rng, shade(base, 1.18), 10, 20, 70, 0.3);
    blotch(ctx, rng, shade(base, 0.78), 10, 20, 70, 0.3);
    speckle(ctx, rng, base, 1800, 2.2, 0.22);
    for (let i = 0; i < 5; i++) crack(ctx, rng, rng() * TEX_PX, rng() * TEX_PX, shade(base, 0.45));
  },
  mossrock(ctx, rng, base) {
    MATERIALS.rock(ctx, rng, base);
    blotch(ctx, rng, '#4f7a2e', 8, 16, 50, 0.35);
  },
  sandstone(ctx, rng, base) {
    ctx.fillStyle = css(base); ctx.fillRect(0, 0, TEX_PX, TEX_PX);
    for (let y = 0; y < TEX_PX; y += rng.range(10, 26)) {
      ctx.fillStyle = css(shade(base, rng.range(0.9, 1.1)), 0.6);
      ctx.fillRect(0, y, TEX_PX, rng.range(4, 12));
    }
    speckle(ctx, rng, base, 1500, 1.8, 0.15);
    for (let i = 0; i < 3; i++) crack(ctx, rng, rng() * TEX_PX, rng() * TEX_PX, shade(base, 0.6));
  },
  sand(ctx, rng, base) {
    ctx.fillStyle = css(base); ctx.fillRect(0, 0, TEX_PX, TEX_PX);
    speckle(ctx, rng, base, 2600, 1.5, 0.12);
    lines(ctx, shade(base, 1.12), 0.4, 2, Array.from({ length: 10 }, (_, i) => [0, i * 26 + 6, TEX_PX, i * 26 + 10]));
  },
  snow(ctx, rng, base) {
    ctx.fillStyle = css(base); ctx.fillRect(0, 0, TEX_PX, TEX_PX);
    blotch(ctx, rng, '#c9dcef', 8, 20, 60, 0.35);
    speckle(ctx, rng, '#ffffff', 900, 1.5, 0.05);
  },
  grass(ctx, rng, base) {
    ctx.fillStyle = css(base); ctx.fillRect(0, 0, TEX_PX, TEX_PX);
    blotch(ctx, rng, shade(base, 1.2), 8, 20, 60, 0.3);
    for (let i = 0; i < 1400; i++) {
      const x = rng() * TEX_PX, y = rng() * TEX_PX;
      ctx.strokeStyle = css(shade(base, rng.range(0.7, 1.35)), 0.7);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rng.range(-2, 2), y - rng.range(3, 7)); ctx.stroke();
    }
  },
  moss(ctx, rng, base) {
    MATERIALS.stone(ctx, rng, mix(base, '#6c7a5c', 0.5));
    blotch(ctx, rng, '#5f8a3a', 12, 16, 50, 0.4);
  },
  dirt(ctx, rng, base) {
    ctx.fillStyle = css(base); ctx.fillRect(0, 0, TEX_PX, TEX_PX);
    blotch(ctx, rng, shade(base, 0.8), 10, 15, 50, 0.3);
    speckle(ctx, rng, base, 1600, 2.5, 0.25);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = css(shade(base, rng.range(0.6, 1.3)));
      ctx.beginPath(); ctx.ellipse(rng() * TEX_PX, rng() * TEX_PX, rng.range(2, 5), rng.range(1.5, 3.5), rng() * 3, 0, Math.PI * 2); ctx.fill();
    }
  },
  stone(ctx, rng, base) {
    ctx.fillStyle = css(shade(base, 0.6)); ctx.fillRect(0, 0, TEX_PX, TEX_PX);
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? 32 : 0;
      for (let x = -off; x < TEX_PX; x += 64) {
        const g = shade(base, rng.range(0.85, 1.12));
        ctx.fillStyle = css(g);
        ctx.fillRect(x + 2, row * 32 + 2, 60, 28);
        ctx.fillStyle = css(shade(g, 1.15), 0.6);
        ctx.fillRect(x + 2, row * 32 + 2, 60, 3);
        if (x < 0) { ctx.fillStyle = css(g); ctx.fillRect(x + TEX_PX + 2, row * 32 + 2, 60, 28); }
      }
    }
    speckle(ctx, rng, base, 900, 1.8, 0.15);
  },
  planks(ctx, rng, base) {
    ctx.fillStyle = css(shade(base, 0.55)); ctx.fillRect(0, 0, TEX_PX, TEX_PX);
    for (let y = 0; y < TEX_PX; y += 32) {
      ctx.fillStyle = css(shade(base, rng.range(0.85, 1.12)));
      ctx.fillRect(0, y + 1, TEX_PX, 30);
      lines(ctx, shade(base, 0.7), 0.35, 1, Array.from({ length: 6 }, () => { const yy = y + rng.range(4, 28); return [0, yy, TEX_PX, yy + rng.range(-2, 2)]; }));
      const nx = rng() * TEX_PX;
      lines(ctx, shade(base, 0.5), 0.8, 2, [[nx, y + 1, nx, y + 31]]);
    }
  },
  sandbag(ctx, rng, base) {
    ctx.fillStyle = css(shade(base, 0.6)); ctx.fillRect(0, 0, TEX_PX, TEX_PX);
    for (let row = 0; row < 11; row++) {
      const off = row % 2 ? 24 : 0;
      for (let x = -off; x < TEX_PX + 48; x += 48) {
        const g = shade(base, rng.range(0.9, 1.08));
        ctx.fillStyle = css(g);
        ctx.beginPath(); ctx.ellipse(x + 24, row * 24 + 12, 23, 11, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = css(shade(g, 1.18), 0.6);
        ctx.beginPath(); ctx.ellipse(x + 22, row * 24 + 8, 16, 4, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  },
};

// Base colours for materials that don't take the theme's tint.
const OWN_COLOR = {
  grass: '#5d9a3a', snow: '#eef5fb', sand: '#e2bf89', moss: '#6e7b5c', dirt: '#6d5843', planks: '#9a7a52',
  grating: '#7a8088', diamond: '#8a929c', tiles: '#5a4f58', sandbag: '#c9b48a',
};

export const SHADES = { front: 1, lit: 0.88, side: 0.7, under: 0.48, top: 1.06 };

/**
 * The materials for a theme, as patterns for ctx: { main: { front, lit, side, under },
 * top: {...}, built: {...}, base: [r,g,b], topBase }. Made once per theme.
 */
export function makeMaterials(ctx, theme) {
  const rng = makeRng(7);
  const make = (name, base) => {
    const src = canvas(TEX_PX);
    MATERIALS[name](src.getContext('2d'), rng, base);
    const out = { base: rgb(base) };
    for (const [face, k] of Object.entries(SHADES)) {
      let cv = src;
      if (k !== 1) {
        cv = canvas(TEX_PX);
        const c = cv.getContext('2d');
        c.drawImage(src, 0, 0);
        c.fillStyle = k < 1 ? `rgba(0,0,0,${(1 - k).toFixed(3)})` : `rgba(255,255,255,${(k - 1).toFixed(3)})`;
        c.fillRect(0, 0, TEX_PX, TEX_PX);
      }
      const pat = ctx.createPattern(cv, 'repeat');
      pat.setTransform?.(new DOMMatrix([TEX_UNITS / TEX_PX, 0, 0, TEX_UNITS / TEX_PX, 0, 0]));
      out[face] = pat;
      out[face + 'Color'] = css(shade(base, k));
    }
    return out;
  };
  const tint = theme.tint || '#888888';
  return {
    main: make(theme.material, OWN_COLOR[theme.material] || tint),
    top: make(theme.top, OWN_COLOR[theme.top] || shade(tint, 1.1)),
    built: make('sandbag', OWN_COLOR.sandbag),
  };
}
