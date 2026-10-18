// A stand-in for the browser's 2D canvas drawing API that draws with PixiJS
// (WebGL). The game's drawing code (render.js, sprites.js, hud.js) uses it just
// like a canvas: shapes become PixiJS graphics, text becomes cached PixiJS text,
// and everything keeps the order it was drawn in. Coordinates are canvas
// pixels, as on a real canvas.
//
// Only what the game uses is supported: transforms, paths (lines, rectangles,
// arcs, ellipses, curves), solid fills and strokes, circles filled with a radial
// gradient, and text.

const TAU = Math.PI * 2;

// ---- Colours --------------------------------------------------------------------------

const colors = new Map();
let probe = null;

/** A CSS colour as [0xRRGGBB, alpha]. */
export function parseColor(str) {
  let c = colors.get(str);
  if (c) return c;
  c = parseFast(String(str)) || parseSlow(String(str));
  if (colors.size > 4000) colors.clear();
  colors.set(str, c);
  return c;
}

const byte = v => Math.max(0, Math.min(255, Math.round(+v)));

function parseFast(s) {
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map(x => x + x).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = parseInt(h.slice(0, 6), 16);
    if (Number.isNaN(n)) return null;
    return [n, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (!m) return null;
  return [(byte(m[1]) << 16) | (byte(m[2]) << 8) | byte(m[3]), m[4] === undefined ? 1 : Math.max(0, Math.min(1, +m[4]))];
}

/** Anything else (colour names and so on): let a canvas work it out. */
function parseSlow(s) {
  probe ||= document.createElement('canvas').getContext('2d');
  probe.fillStyle = '#000';
  probe.fillStyle = s;
  return parseFast(String(probe.fillStyle).replace(/\s+/g, '')) || [0, 1];
}

class RadialGradient {
  constructor(x0, y0, r0, x1, y1, r1) {
    Object.assign(this, { x0, y0, r0, x1, y1, r1 });
    this.stops = [];
  }

  addColorStop(offset, color) { this.stops.push([offset, color]); }
}

// ---- Fonts ----------------------------------------------------------------------------

const FONT_RE = /^\s*((?:(?:italic|oblique|normal|bold|bolder|lighter|small-caps|\d{3})\s+)*)([\d.]+)px(?:\/\S+)?\s+(.+)$/;
// How far the alphabetic baseline sits below each baseline, in ems (used if the browser can't tell us).
const BASELINE_GUESS = { alphabetic: 0, middle: 0.36, top: 0.9, hanging: 0.75, bottom: -0.21, ideographic: -0.21 };

function parseFont(str) {
  const m = FONT_RE.exec(str);
  if (!m) return { style: 'normal', weight: 'normal', size: 10, family: 'sans-serif' };
  const words = m[1].trim().split(/\s+/);
  return {
    style: words.includes('italic') ? 'italic' : words.includes('oblique') ? 'oblique' : 'normal',
    weight: words.find(w => /^(bold|bolder|lighter|\d{3})$/.test(w)) || 'normal',
    size: +m[2],
    family: m[3].trim(),
  };
}

// ---- The context ----------------------------------------------------------------------

export class GLContext {
  /** P: the PixiJS module. root: the container everything is drawn into. */
  constructor(P, root) {
    this.P = P;
    this.root = root;
    // Drawing state, as on a canvas (and like a canvas, it carries over between frames).
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.lineWidth = 1;
    this.lineCap = 'butt';
    this.lineJoin = 'miter';
    this.globalAlpha = 1;
    this.font = '10px sans-serif';
    this.textAlign = 'start';
    this.textBaseline = 'alphabetic';
    this.m = [1, 0, 0, 1, 0, 0];
    this.stack = [];
    this.path = [];
    this.sub = null;
    // This frame's display objects, in drawing order.
    this.order = [];
    this.gfx = null;
    this.gfxPool = [];
    this.gfxUsed = 0;
    this.texts = new Map();      // key -> [Text]
    this.textUsed = new Map();   // key -> how many used this frame
    this.sprites = [];
    this.spriteUsed = 0;
    this.gradients = new Map();
    this.fonts = new Map();
    this.frame = 0;
    this._measurer = null;
  }

  /** A 2D canvas used to measure text. */
  get measurer() {
    return (this._measurer ||= document.createElement('canvas').getContext('2d'));
  }

  // ---- Frames ----

  beginFrame() {
    this.frame++;
    this.order.length = 0;
    this.gfx = null;
    this.gfxUsed = 0;
    this.textUsed.clear();
    this.spriteUsed = 0;
  }

  /** Put this frame's objects on the stage (only touching it if something changed). */
  endFrame() {
    const kids = this.root.children, order = this.order;
    let same = kids.length === order.length;
    for (let i = 0; same && i < order.length; i++) same = kids[i] === order[i];
    if (!same) {
      this.root.removeChildren();
      if (order.length) this.root.addChild(...order);
    }
    // Throw away text that hasn't been drawn for a few seconds.
    if (this.frame % 60 === 0) {
      for (const [key, list] of this.texts) {
        const keep = list.filter(t => {
          if (this.frame - t._used < 180) return true;
          t.destroy();
          return false;
        });
        if (keep.length) this.texts.set(key, keep);
        else this.texts.delete(key);
      }
    }
  }

  /** Add a ready-made display object (a layer of sprites, say) at this point in the drawing order. */
  insert(obj) {
    this.order.push(obj);
    this.gfx = null;
  }

  /** The graphics object shapes go into: a new one after anything that isn't a shape, to keep the order. */
  get g() {
    if (!this.gfx) {
      let g = this.gfxPool[this.gfxUsed];
      if (g) g.clear();
      else this.gfxPool.push(g = new this.P.Graphics());
      this.gfxUsed++;
      this.gfx = g;
      this.order.push(g);
    }
    return this.gfx;
  }

  // ---- State ----

  save() {
    this.stack.push([this.m.slice(), this.fillStyle, this.strokeStyle, this.lineWidth, this.lineCap, this.lineJoin,
      this.globalAlpha, this.font, this.textAlign, this.textBaseline]);
  }

  restore() {
    const s = this.stack.pop();
    if (!s) return;
    [this.m, this.fillStyle, this.strokeStyle, this.lineWidth, this.lineCap, this.lineJoin,
      this.globalAlpha, this.font, this.textAlign, this.textBaseline] = s;
  }

  setTransform(a, b, c, d, e, f) {
    const m = this.m;
    m[0] = a; m[1] = b; m[2] = c; m[3] = d; m[4] = e; m[5] = f;
  }

  resetTransform() { this.setTransform(1, 0, 0, 1, 0, 0); }

  transform(a, b, c, d, e, f) {
    const [A, B, C, D, E, F] = this.m;
    this.setTransform(A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d, A * e + C * f + E, B * e + D * f + F);
  }

  translate(x, y) {
    const m = this.m;
    m[4] += m[0] * x + m[2] * y;
    m[5] += m[1] * x + m[3] * y;
  }

  scale(x, y) {
    const m = this.m;
    m[0] *= x; m[1] *= x; m[2] *= y; m[3] *= y;
  }

  rotate(r) {
    const m = this.m, c = Math.cos(r), s = Math.sin(r);
    const a = m[0], b = m[1], cc = m[2], d = m[3];
    m[0] = a * c + cc * s; m[1] = b * c + d * s;
    m[2] = cc * c - a * s; m[3] = d * c - b * s;
  }

  /** How much the current transform scales lengths. */
  get k() {
    const m = this.m;
    return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  }

  // ---- Paths (kept in canvas pixels, transformed as they're added, like a canvas does) ----

  beginPath() {
    this.path = [];
    this.sub = null;
  }

  moveTo(x, y) {
    const m = this.m;
    this.sub = { pts: [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]], closed: false };
    this.path.push(this.sub);
  }

  lineTo(x, y) {
    if (!this.sub) { this.moveTo(x, y); return; }
    const m = this.m;
    this.sub.pts.push(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
  }

  closePath() {
    const s = this.sub;
    if (!s) return;
    s.closed = true;
    this.sub = { pts: [s.pts[0], s.pts[1]], closed: false };
    this.path.push(this.sub);
  }

  rect(x, y, w, h) {
    this.path.push(this.rectPath(x, y, w, h));
    this.moveTo(x, y);
  }

  rectPath(x, y, w, h) {
    const m = this.m;
    const P = (px, py) => [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]];
    const pts = [...P(x, y), ...P(x + w, y), ...P(x + w, y + h), ...P(x, y + h)];
    return { pts, closed: true, rect: m[1] === 0 && m[2] === 0 };
  }

  arc(x, y, r, a0, a1, ccw = false) { this.ellipse(x, y, r, r, 0, a0, a1, ccw); }

  ellipse(x, y, rx, ry, rot, a0, a1, ccw = false) {
    let sweep = ccw ? a0 - a1 : a1 - a0;
    if (sweep >= TAU) sweep = TAU;
    else { sweep %= TAU; if (sweep < 0) sweep += TAU; }
    if (ccw) sweep = -sweep;
    // Enough segments that the curve looks smooth at its size on screen.
    const rd = Math.max(rx, ry) * this.k;
    const step = rd > 0.3 ? 2 * Math.acos(1 - 0.3 / rd) : Math.PI / 2;
    const n = Math.max(1, Math.min(200, Math.ceil(Math.abs(sweep) / step)));
    const m = this.m, cr = Math.cos(rot), sr = Math.sin(rot);
    const fresh = !this.sub || this.sub.pts.length < 2;
    for (let i = 0; i <= n; i++) {
      const t = a0 + (sweep * i) / n;
      const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
      const px = x + ex * cr - ey * sr, py = y + ex * sr + ey * cr;
      if (i === 0 && fresh) this.moveTo(px, py);
      else this.sub.pts.push(m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]);
    }
    if (Math.abs(sweep) >= TAU && fresh) {
      this.sub.closed = true;
      if (rx === ry && m[1] === -m[2] && m[0] === m[3]) this.sub.circle = { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5], r: rx * this.k };
    }
  }

  quadraticCurveTo(cx, cy, x, y) {
    if (!this.sub) this.moveTo(cx, cy);
    const m = this.m, p = this.sub.pts;
    const x0 = p[p.length - 2], y0 = p[p.length - 1];
    const x1 = m[0] * cx + m[2] * cy + m[4], y1 = m[1] * cx + m[3] * cy + m[5];
    const x2 = m[0] * x + m[2] * y + m[4], y2 = m[1] * x + m[3] * y + m[5];
    const n = Math.max(2, Math.min(40, Math.ceil((Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1)) / 4)));
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      p.push(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
    }
  }

  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
    if (!this.sub) this.moveTo(c1x, c1y);
    const m = this.m, p = this.sub.pts;
    const T = (px, py) => [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]];
    const x0 = p[p.length - 2], y0 = p[p.length - 1];
    const [x1, y1] = T(c1x, c1y), [x2, y2] = T(c2x, c2y), [x3, y3] = T(x, y);
    const len = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
    const n = Math.max(2, Math.min(60, Math.ceil(len / 4)));
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      p.push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
    }
  }

  createRadialGradient(x0, y0, r0, x1, y1, r1) { return new RadialGradient(x0, y0, r0, x1, y1, r1); }

  // ---- Drawing ----

  fill() {
    if (this.fillStyle instanceof RadialGradient) { this.gradientFill(this.fillStyle); return; }
    const [color, a] = parseColor(this.fillStyle);
    const alpha = a * this.globalAlpha;
    if (alpha <= 0) return;
    this.fillPaths(this.path, color, alpha);
  }

  fillPaths(paths, color, alpha) {
    let g = null;
    for (const s of paths) {
      const p = s.pts;
      if (p.length < 6) continue;
      if (!g) { g = this.g; g.beginPath(); }
      if (s.rect) addRect(g, p);
      else g.poly(p.slice(), true);
    }
    if (g) g.fill({ color, alpha });
  }

  stroke() {
    const style = this.strokeStyle instanceof RadialGradient ? this.strokeStyle.stops[0]?.[1] || '#000' : this.strokeStyle;
    const [color, a] = parseColor(style);
    this.strokePaths(this.path, color, a);
  }

  strokePaths(paths, color, a) {
    let alpha = a * this.globalAlpha;
    let width = this.lineWidth * this.k;
    // Lines thinner than a pixel: draw a pixel wide but fainter, as a canvas would.
    if (width < 1) { alpha *= width; width = 1; }
    if (alpha <= 0.002) return;
    let g = null;
    for (const s of paths) {
      const p = s.pts;
      if (p.length < 4) continue;
      if (!g) { g = this.g; g.beginPath(); }
      g.poly(p.slice(), s.closed);
    }
    if (g) g.stroke({ width, color, alpha, cap: this.lineCap, join: this.lineJoin });
  }

  fillRect(x, y, w, h) {
    const [color, a] = parseColor(this.fillStyle instanceof RadialGradient ? '#000' : this.fillStyle);
    const alpha = a * this.globalAlpha;
    if (alpha <= 0 || !w || !h) return;
    this.fillPaths([this.rectPath(x, y, w, h)], color, alpha);
  }

  strokeRect(x, y, w, h) {
    const [color, a] = parseColor(this.strokeStyle);
    this.strokePaths([this.rectPath(x, y, w, h)], color, a);
  }

  clearRect() { /* the stage is cleared every frame */ }

  /** A circle filled with a radial gradient, drawn as a sprite with a gradient texture. */
  gradientFill(gr) {
    let top = 0;
    const stops = gr.stops.map(([o, c]) => {
      const [color, a] = parseColor(c);
      top = Math.max(top, a);
      return [o, color, a];
    });
    if (top <= 0 || !stops.length) return;
    const key = stops.map(([o, c, a]) => `${o}:${c}:${(a / top).toFixed(2)}`).join(',');
    let tex = this.gradients.get(key);
    if (!tex) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const c2 = cv.getContext('2d');
      const grad = c2.createRadialGradient(64, 64, 0, 64, 64, 64);
      for (const [o, c, a] of stops) grad.addColorStop(Math.max(0, Math.min(1, o)), `rgba(${c >> 16},${(c >> 8) & 255},${c & 255},${a / top})`);
      c2.fillStyle = grad;
      c2.fillRect(0, 0, 128, 128);
      tex = this.P.Texture.from(cv);
      this.gradients.set(key, tex);
    }
    const m = this.m, k = this.k;
    const sp = this.sprite(tex);
    sp.anchor.set(0.5);
    sp.position.set(m[0] * gr.x1 + m[2] * gr.y1 + m[4], m[1] * gr.x1 + m[3] * gr.y1 + m[5]);
    sp.width = sp.height = Math.max(0.01, 2 * gr.r1 * k);
    sp.alpha = top * this.globalAlpha;
    this.insert(sp);
  }

  sprite(tex) {
    let sp = this.sprites[this.spriteUsed];
    if (!sp) this.sprites.push(sp = new this.P.Sprite(tex));
    else sp.texture = tex;
    this.spriteUsed++;
    sp.rotation = 0;
    sp.tint = 0xffffff;
    return sp;
  }

  // ---- Text ----

  measureText(text) {
    this.measurer.font = this.font;
    return this.measurer.measureText(String(text));
  }

  fillText(text, x, y) {
    text = String(text);
    if (!text) return;
    const [color, a] = parseColor(this.fillStyle instanceof RadialGradient ? '#000' : this.fillStyle);
    const alpha = a * this.globalAlpha;
    if (alpha <= 0) return;
    const f = this.fontInfo(this.font);
    // Text is drawn at its size on screen, so it stays sharp at any zoom.
    const size = Math.round(f.size * this.k * 4) / 4;
    if (size < 1) return;
    const t = this.textObject(f, size, text);
    const m = this.m;
    const X = m[0] * x + m[2] * y + m[4], Y = m[1] * x + m[3] * y + m[5];
    const al = this.textAlign;
    const ax = al === 'center' ? 0.5 : al === 'right' || al === 'end' ? 1 : 0;
    const metrics = this.fontMetrics(f, size, this.textBaseline);
    t.x = Math.round(X - ax * t.width);
    t.y = Math.round(Y + metrics.shift - metrics.ascent);
    t.tint = color;
    t.alpha = alpha;
    this.insert(t);
  }

  fontInfo(str) {
    let f = this.fonts.get(str);
    if (!f) this.fonts.set(str, f = parseFont(str));
    return f;
  }

  textObject(f, size, text) {
    const key = `${f.style}|${f.weight}|${f.family}|${size}|${text}`;
    let list = this.texts.get(key);
    if (!list) this.texts.set(key, list = []);
    const i = this.textUsed.get(key) || 0;
    this.textUsed.set(key, i + 1);
    let t = list[i];
    if (!t) {
      t = new this.P.Text({
        text,
        style: { fontFamily: f.family, fontSize: size, fontWeight: f.weight, fontStyle: f.style, fill: 0xffffff },
        resolution: 1,
      });
      list.push(t);
    }
    t._used = this.frame;
    return t;
  }

  /** Where PixiJS puts the baseline (ascent), and how far below a given baseline the alphabetic one is. */
  fontMetrics(f, size, baseline) {
    const key = `${f.style}|${f.weight}|${f.family}|${size}|${baseline}`;
    let r = this.fonts.get(key);
    if (r) return r;
    const css = `${f.style} ${f.weight} ${size}px ${f.family}`;
    const style = new this.P.TextStyle({ fontFamily: f.family, fontSize: size, fontWeight: f.weight, fontStyle: f.style });
    const ascent = this.P.CanvasTextMetrics.measureText('M', style).fontProperties.ascent;
    const ctx = this.measurer;
    ctx.font = css;
    ctx.textBaseline = 'alphabetic';
    const base = ctx.measureText('Mg').fontBoundingBoxAscent;
    ctx.textBaseline = baseline;
    const here = ctx.measureText('Mg').fontBoundingBoxAscent;
    ctx.textBaseline = 'alphabetic';
    const shift = Number.isFinite(base) && Number.isFinite(here) ? base - here : (BASELINE_GUESS[baseline] ?? 0) * size;
    r = { ascent, shift };
    this.fonts.set(key, r);
    return r;
  }
}

/** An axis-aligned rectangle path (4 corners) as a PixiJS rect. */
function addRect(g, p) {
  const x0 = Math.min(p[0], p[4]), y0 = Math.min(p[1], p[5]);
  g.rect(x0, y0, Math.abs(p[4] - p[0]), Math.abs(p[5] - p[1]));
}
