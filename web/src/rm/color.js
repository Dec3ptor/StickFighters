// Colour helpers for Remastered's drawing: parse, mix and shade colours once
// (when themes and textures are built), never per frame.

/** '#rgb', '#rrggbb' or 'rgb(a)(...)' as [r, g, b, a] (0-255, alpha 0-1). */
export function rgb(c) {
  if (Array.isArray(c)) return c;
  const s = String(c).trim();
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3) h = [...h].map(x => x + x).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
  }
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (!m) return [0, 0, 0, 1];
  const p = m[1].split(',').map(Number);
  return [p[0], p[1], p[2], p[3] ?? 1];
}

const byte = v => Math.max(0, Math.min(255, Math.round(v)));

/** [r, g, b, a] as a CSS colour. */
export function css(c, alpha) {
  const [r, g, b, a] = rgb(c);
  const al = alpha ?? a;
  return al >= 1 ? `rgb(${byte(r)},${byte(g)},${byte(b)})` : `rgba(${byte(r)},${byte(g)},${byte(b)},${Math.max(0, al).toFixed(3)})`;
}

/** a mixed toward b by t (0: a, 1: b). */
export function mix(a, b, t) {
  const x = rgb(a), y = rgb(b);
  return [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t, x[3] + (y[3] - x[3]) * t];
}

/** Lighter (k > 1) or darker (k < 1). */
export function shade(c, k) {
  const [r, g, b, a] = rgb(c);
  return k >= 1 ? mix([r, g, b, a], [255, 255, 255, a], Math.min(1, k - 1)) : [r * k, g * k, b * k, a];
}

/** A colour's brightness, 0 (black) to 1 (white). */
export function luma(c) {
  const [r, g, b] = rgb(c);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
