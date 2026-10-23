// A stand-in for the browser's 2D canvas drawing API that draws with PixiJS
// (WebGL). The game's drawing code (render.js, sprites.js, hud.js) uses it just
// like a canvas: shapes become triangles, text becomes cached PixiJS text, and
// everything keeps the order it was drawn in. Coordinates are canvas pixels, as
// on a real canvas.
//
// Shapes are turned into triangles here, into arrays kept from frame to frame,
// and each run of shapes between other things (text, sprites, layers) is drawn in
// one go: PixiJS's own shapes would be rebuilt from scratch every frame. The
// triangles are the ones PixiJS would make (the same arithmetic: its line builder
// copied below, its earcut for polygons, its colour packing and shader maths), so
// the picture is the same.
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

/** A colour and alpha as a triangle corner's colour, packed as PixiJS packs it (ABGR, alpha cut to a byte). */
export function packColor(rgb, alpha) {
  const bgr = (rgb >> 16) | (rgb & 0xff00) | ((rgb & 0xff) << 16);
  return (bgr + ((alpha * 255) << 24)) >>> 0;
}

// The colour being drawn with, packed. (Kept in a typed array: as a plain number it's too
// big to be a small integer, and would be boxed into a new object each time it's passed on.)
const COLOR = new Uint32Array(1);
function setColor(rgb, alpha) {
  COLOR[0] = ((rgb >> 16) | (rgb & 0xff00) | ((rgb & 0xff) << 16)) + ((alpha * 255) << 24);
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

// ---- Triangles ------------------------------------------------------------------------

// PixiJS's batch shader, the parts a plain colour uses: the same sums, so the same pixels.
const SHAPE_VERTEX = `
    in vec2 aPosition;
    in vec4 aColor;
    out vec4 vColor;
    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;
    uniform vec4 uWorldColorAlpha;

    void main(void){
        mat3 worldTransformMatrix = uWorldTransformMatrix;
        mat3 modelMatrix = mat3(
            1.0, 0.0, 0.0,
            0.0, 1.0, 0.0,
            0.0, 0.0, 1.0
          );
        vec2 position = aPosition;
        vColor = vec4(1.);
        vColor *= vec4(aColor.rgb * aColor.a, aColor.a);
        mat3 modelViewProjectionMatrix = uProjectionMatrix * worldTransformMatrix * modelMatrix;
        gl_Position = vec4((modelViewProjectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
        vColor *= uWorldColorAlpha;
    }
`;
const SHAPE_FRAGMENT = `
    in vec4 vColor;

    void main(void) {
        finalColor = vColor;
    }
`;

/**
 * A run of shapes drawn in one go: corners (x, y and a colour each) and the triangles
 * between them, in arrays kept from frame to frame, shown by a PixiJS mesh.
 */
export class ShapeBatch {
  constructor(P, shader) {
    this.nv = 0; // corners used
    this.ni = 0; // triangle corners (indices) used
    this.alloc(256, 768);
    if (!P.Mesh) return; // (no PixiJS: just the arrays, as the tests use it)
    const usage = P.BufferUsage;
    this.vbuf = new P.Buffer({ data: this.f32, usage: usage.VERTEX | usage.COPY_DST, shrinkToFit: false });
    this.ibuf = new P.Buffer({ data: this.idx, usage: usage.INDEX | usage.COPY_DST, shrinkToFit: false });
    this.geometry = new P.Geometry({
      attributes: {
        aPosition: { buffer: this.vbuf, format: 'float32x2', stride: 12, offset: 0 },
        aColor: { buffer: this.vbuf, format: 'unorm8x4', stride: 12, offset: 8 },
      },
      indexBuffer: this.ibuf,
    });
    this.mesh = new P.Mesh({ geometry: this.geometry, shader });
  }

  alloc(nv, ni) {
    const ab = new ArrayBuffer(nv * 12), f32 = new Float32Array(ab), idx = new Uint32Array(ni);
    if (this.f32) { f32.set(this.f32.subarray(0, this.nv * 3)); idx.set(this.idx.subarray(0, this.ni)); }
    this.f32 = f32;
    this.u32 = new Uint32Array(ab);
    this.idx = idx;
  }

  /** Room for n more corners and k more indices. */
  room(n, k) {
    const nv = this.f32.length / 3, ni = this.idx.length;
    if (this.nv + n > nv || this.ni + k > ni) this.alloc(Math.max(nv * 2, this.nv + n), Math.max(ni * 2, this.ni + k));
  }

  /** Hand this frame's triangles to the graphics card (only the part in use). */
  upload() {
    if (!this.vbuf) return;
    // No triangles (a shape with no area): hidden. Told to draw none, PixiJS would draw the
    // whole buffer, and with it whatever an earlier frame left there.
    this.mesh.visible = this.ni > 0;
    if (!this.ni) return;
    this.vbuf.setDataWithSize(this.f32, this.nv * 3, true);
    this.ibuf.setDataWithSize(this.idx, this.ni, true);
    this.geometry.indexCount = this.ni;
  }
}

// PixiJS's batch shader again, for sprites: the same sums, with the texture looked up as it does.
const QUAD_VERTEX = `
    in vec2 aPosition;
    in vec2 aUV;
    in vec4 aColor;
    in float aTexture;
    out vec4 vColor;
    out vec2 vUV;
    out float vTextureId;
    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;
    uniform vec4 uWorldColorAlpha;

    void main(void){
        mat3 worldTransformMatrix = uWorldTransformMatrix;
        mat3 modelMatrix = mat3(
            1.0, 0.0, 0.0,
            0.0, 1.0, 0.0,
            0.0, 0.0, 1.0
          );
        vec2 position = aPosition;
        vec2 uv = aUV;
        vColor = vec4(1.);
        vColor *= vec4(aColor.rgb * aColor.a, aColor.a);
        vTextureId = aTexture;
        vUV = uv;
        mat3 modelViewProjectionMatrix = uProjectionMatrix * worldTransformMatrix * modelMatrix;
        gl_Position = vec4((modelViewProjectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
        vColor *= uWorldColorAlpha;
    }
`;
const QUAD_FRAGMENT = `
    in vec4 vColor;
    in vec2 vUV;
    in float vTextureId;
    uniform sampler2D uTexture0;
    uniform sampler2D uTexture1;
    uniform sampler2D uTexture2;

    void main(void) {
        vec4 outColor;
        if(vTextureId < 0.5)
        {
            outColor = texture(uTexture0, vUV);
        }
        else
        if(vTextureId < 1.5)
        {
            outColor = texture(uTexture1, vUV);
        }
        else
        {
            outColor = texture(uTexture2, vUV);
        }
        finalColor = outColor * vColor;
    }
`;

// A sprite to add to a QuadBatch: x, y (its centre), w, h (its size), angle, alpha, and its
// layer's scale and position (s, tx, ty). (In an array: see RP below.)
export const QP = new Float64Array(9);

/**
 * Sprites drawn in one go, without PixiJS sprites: each one's corners placed as PixiJS places
 * a centred sprite's (in a layer with a scale and a position, on the stage), with the same
 * colour, texture and sums, so the same pixels. textures: up to three (the sprites pick by number).
 */
export class QuadBatch {
  constructor(P, textures) {
    this.n = 0; // sprites used
    this.textures = textures;
    this.alloc(128);
    if (!P.Mesh) return; // (no PixiJS: just the arrays, as the tests use it)
    const usage = P.BufferUsage;
    this.vbuf = new P.Buffer({ data: this.f32, usage: usage.VERTEX | usage.COPY_DST, shrinkToFit: false });
    this.ibuf = new P.Buffer({ data: this.idx, usage: usage.INDEX | usage.COPY_DST, shrinkToFit: false });
    this.geometry = new P.Geometry({
      attributes: {
        aPosition: { buffer: this.vbuf, format: 'float32x2', stride: 24, offset: 0 },
        aUV: { buffer: this.vbuf, format: 'float32x2', stride: 24, offset: 8 },
        aColor: { buffer: this.vbuf, format: 'unorm8x4', stride: 24, offset: 16 },
        aTexture: { buffer: this.vbuf, format: 'float32', stride: 24, offset: 20 },
      },
      indexBuffer: this.ibuf,
    });
    const t = i => (textures[i] || textures[0]).source;
    const shader = new P.Shader({ glProgram: new P.GlProgram({ vertex: QUAD_VERTEX, fragment: QUAD_FRAGMENT, name: 'quads' }), resources: { uTexture0: t(0), uTexture1: t(1), uTexture2: t(2) } });
    this.mesh = new P.Mesh({ geometry: this.geometry, shader });
  }

  alloc(n) {
    const ab = new ArrayBuffer(n * 4 * 24), f32 = new Float32Array(ab), idx = new Uint32Array(n * 6);
    if (this.f32) f32.set(this.f32.subarray(0, this.n * 24));
    // (The same two triangles for every sprite, as PixiJS splits a quad.)
    for (let i = 0; i < n; i++) {
      const a = i * 4;
      idx.set([a, a + 1, a + 2, a, a + 2, a + 3], i * 6);
    }
    this.f32 = f32;
    this.u32 = new Uint32Array(ab);
    this.idx = idx;
  }

  /** Add the sprite in QP, with texture number t and tint (0xRRGGBB), as PixiJS would draw it. */
  add(t, tint) {
    if (this.n * 24 + 24 > this.f32.length) this.alloc(this.n * 2);
    const tex = this.textures[t];
    const x = QP[0], y = QP[1], angle = QP[4], alpha = QP[5], s = QP[6];
    // Its scale (as glrender sets it), and its own transform (Container.updateLocalTransform:
    // no pivot, no origin, no skew; their zeros are kept in the sums, so they come out the same
    // to the last bit).
    const sx = QP[2] / tex.width, sy = QP[3] / tex.height;
    const la = Math.cos(angle + 0) * sx, lb = Math.sin(angle + 0) * sx, lc = -Math.sin(angle - 0) * sy, ld = Math.cos(angle - 0) * sy;
    const ltx = x - (0 * la + 0 * lc) + (-0 * la + -0 * lc) - -0, lty = y - (0 * lb + 0 * ld) + (-0 * lb + -0 * ld) - -0;
    // The layer's transform (scale s, at tx, ty), the same way.
    const ga = Math.cos(0 + 0) * s, gb = Math.sin(0 + 0) * s, gc = -Math.sin(0 - 0) * s, gd = Math.cos(0 - 0) * s;
    const gtx = QP[7] - (0 * ga + 0 * gc) + (-0 * ga + -0 * gc) - -0, gty = QP[8] - (0 * gb + 0 * gd) + (-0 * gb + -0 * gd) - -0;
    // The sprite's transform on the stage (Matrix.appendFrom).
    const a = la * ga + lb * gc, b = la * gb + lb * gd, c = lc * ga + ld * gc, d = lc * gb + ld * gd;
    const tx = ltx * ga + lty * gc + gtx, ty = ltx * gb + lty * gd + gty;
    // Its corners round its centre (Sprite.updateBounds, anchor 0.5), packed as the batcher packs a quad.
    const W = tex.orig.width, H = tex.orig.height;
    const minX = -0.5 * W, maxX = minX + W, minY = -0.5 * H, maxY = minY + H;
    const uv = tex.uvs, f32 = this.f32, u32 = this.u32;
    const color = ((tint >> 16) & 255 | (tint & 0xff00) | (tint & 255) << 16) + ((Math.min(1, Math.max(0, alpha)) * 255 | 0) << 24);
    let i = this.n * 24;
    f32[i] = a * minX + c * minY + tx; f32[i + 1] = d * minY + b * minX + ty; f32[i + 2] = uv.x0; f32[i + 3] = uv.y0; u32[i + 4] = color; f32[i + 5] = t; i += 6;
    f32[i] = a * maxX + c * minY + tx; f32[i + 1] = d * minY + b * maxX + ty; f32[i + 2] = uv.x1; f32[i + 3] = uv.y1; u32[i + 4] = color; f32[i + 5] = t; i += 6;
    f32[i] = a * maxX + c * maxY + tx; f32[i + 1] = d * maxY + b * maxX + ty; f32[i + 2] = uv.x2; f32[i + 3] = uv.y2; u32[i + 4] = color; f32[i + 5] = t; i += 6;
    f32[i] = a * minX + c * maxY + tx; f32[i + 1] = d * maxY + b * minX + ty; f32[i + 2] = uv.x3; f32[i + 3] = uv.y3; u32[i + 4] = color; f32[i + 5] = t;
    this.n++;
  }

  /** Hand this frame's sprites to the graphics card (only the part in use). */
  upload() {
    if (!this.vbuf) return;
    this.vbuf.setDataWithSize(this.f32, this.n * 24, true);
    this.ibuf.setDataWithSize(this.idx, this.n * 6, true);
    this.geometry.indexCount = this.n * 6;
  }
}

// Corners of the line being built, as PixiJS's builder makes them (in full precision:
// which of its triangles are kept depends on the exact numbers), and its triangles.
let lv = new Float64Array(512), ln = 0;
let lineIdx = new Uint32Array(768), lineN = 0;
// (Growing is kept out of the small functions below, so they're built into their callers:
// otherwise the numbers handed to them are each boxed into a new object.)
function lgrow() { const a = new Float64Array(lv.length * 2); a.set(lv); lv = a; }
function lpush(x, y) {
  if (ln + 2 > lv.length) lgrow();
  lv[ln++] = x; lv[ln++] = y;
}
function igrow() { const t = new Uint32Array(lineIdx.length * 2); t.set(lineIdx); lineIdx = t; }
function ltri(a, b, c) {
  if (lineN + 3 > lineIdx.length) igrow();
  lineIdx[lineN++] = a; lineIdx[lineN++] = b; lineIdx[lineN++] = c;
}

// The round builder's centre and end points (passed in an array: numbers handed to a
// function one by one are each boxed into a new object when it isn't inlined).
const RP = new Float64Array(6);

/** PixiJS's round cap and join builder (its arithmetic exactly), into lv: round RP's centre from one end to the other. */
function round(clockwise) {
  const cx = RP[0], cy = RP[1], x0 = RP[2], y0 = RP[3], x1 = RP[4], y1 = RP[5];
  const dx = x0 - cx, dy = y0 - cy;
  let a0 = Math.atan2(dx, dy), a1 = Math.atan2(x1 - cx, y1 - cy);
  if (clockwise && a0 < a1) a0 += Math.PI * 2;
  else if (!clockwise && a0 > a1) a1 += Math.PI * 2;
  let start = a0;
  const sweep = a1 - a0, abs = Math.abs(sweep), r = Math.sqrt(dx * dx + dy * dy), n = (15 * abs * Math.sqrt(r) / Math.PI >> 0) + 1, step = sweep / n;
  start += step;
  if (clockwise) {
    lpush(cx, cy); lpush(x0, y0);
    for (let i = 1, a = start; i < n; i++, a += step) { lpush(cx, cy); lpush(cx + Math.sin(a) * r, cy + Math.cos(a) * r); }
    lpush(cx, cy); lpush(x1, y1);
  } else {
    lpush(x0, y0); lpush(cx, cy);
    for (let i = 1, a = start; i < n; i++, a += step) { lpush(cx + Math.sin(a) * r, cy + Math.cos(a) * r); lpush(cx, cy); }
    lpush(x1, y1); lpush(cx, cy);
  }
  return n * 2;
}

/** PixiJS's square cap builder, into lv: at RP's point, across RP's normal, RP's widths in and out. */
function square(clockwise) {
  const x = RP[0], y = RP[1], nx = RP[2], ny = RP[3], inner = RP[4], outer = RP[5];
  const x0 = x - nx * inner, y0 = y - ny * inner, x1 = x + nx * outer, y1 = y + ny * outer;
  let ex, ey;
  if (clockwise) { ex = ny; ey = -nx; } else { ex = -ny; ey = nx; }
  lpush(x0 + ex, y0 + ey); lpush(x1 + ex, y1 + ey);
  return 2;
}

let closedPts = new Float64Array(256);

/**
 * PixiJS's line builder (buildLine), its arithmetic exactly: a line through the first
 * `count` numbers of `pts` (x, y, x, y...), line.width wide, with its caps and joins, as a
 * strip of triangles. The corners go into lv (from 0) and the triangles into lineIdx;
 * returns how many corners. (The width comes in an object: a number handed to a function
 * this big is boxed into a new object each call.)
 */
function buildLine(pts, count, line, cap, join, closed) {
  const width = line.width;
  ln = 0;
  lineN = 0;
  let r = pts, len = count;
  if (len === 0) return 0;
  const eps = 1e-4, miterLimit = 10;
  const l = 0.5; // (alignment: the middle)
  const ux = r[0], uy = r[1];
  let hx = r[len - 2], hy = r[len - 1];
  const same = Math.abs(ux - hx) < eps && Math.abs(uy - hy) < eps;
  if (closed) {
    // (Starting and ending half way along the closing side.)
    const n = same ? len - 2 : len;
    if (same) { hx = r[n - 2]; hy = r[n - 1]; }
    if (n + 4 > closedPts.length) closedPts = new Float64Array((n + 4) * 2);
    const c = closedPts, X = (ux + hx) * 0.5, Q = (hy + uy) * 0.5;
    c[0] = X; c[1] = Q;
    for (let i = 0; i < n; i++) c[i + 2] = r[i];
    c[n + 2] = X; c[n + 3] = Q;
    r = c;
    len = n + 4;
  }
  const f = len / 2;
  let m = len;
  const g = 0;
  const _ = width / 2, x = _ * _, y = miterLimit * miterLimit;
  let v = r[0], S = r[1], b = r[2], w = r[3], E = 0, P = 0, A = -(S - w), C = v - b, O = 0, F = 0, R = Math.sqrt(A * A + C * C);
  A /= R; C /= R; A *= _; C *= _;
  const I = l, M = (1 - I) * 2, G = I * 2;
  if (!closed) {
    if (cap === 'round') {
      RP[0] = v - A * (M - G) * 0.5; RP[1] = S - C * (M - G) * 0.5; RP[2] = v - A * M; RP[3] = S - C * M; RP[4] = v + A * G; RP[5] = S + C * G;
      m += round(true) + 2;
    } else if (cap === 'square') {
      RP[0] = v; RP[1] = S; RP[2] = A; RP[3] = C; RP[4] = M; RP[5] = G;
      m += square(true);
    }
  }
  lpush(v - A * M, S - C * M); lpush(v + A * G, S + C * G);
  for (let X = 1; X < f - 1; ++X) {
    v = r[(X - 1) * 2]; S = r[(X - 1) * 2 + 1]; b = r[X * 2]; w = r[X * 2 + 1]; E = r[(X + 1) * 2]; P = r[(X + 1) * 2 + 1];
    A = -(S - w); C = v - b; R = Math.sqrt(A * A + C * C); A /= R; C /= R; A *= _; C *= _;
    O = -(w - P); F = b - E; R = Math.sqrt(O * O + F * F); O /= R; F /= R; O *= _; F *= _;
    const Q = b - v, K = S - w, N = b - E, k = P - w, U = Q * N + K * k, z = K * N - k * Q, rt = z < 0;
    if (Math.abs(z) < 0.001 * Math.abs(U)) {
      lpush(b - A * M, w - C * M); lpush(b + A * G, w + C * G);
      if (U >= 0) {
        if (join === 'round') {
          RP[0] = b; RP[1] = w; RP[2] = b - A * M; RP[3] = w - C * M; RP[4] = b - O * M; RP[5] = w - F * M;
          m += round(false) + 4;
        } else m += 2;
        lpush(b - O * G, w - F * G); lpush(b + O * M, w + F * M);
      }
      continue;
    }
    const mt = (-A + v) * (-C + w) - (-A + b) * (-C + S), J = (-O + E) * (-F + w) - (-O + b) * (-F + P);
    const ot = (Q * J - N * mt) / z, nt = (k * mt - K * J) / z, ct = (ot - b) * (ot - b) + (nt - w) * (nt - w);
    const St = b + (ot - b) * M, At = w + (nt - w) * M, _t = b - (ot - b) * G, q = w - (nt - w) * G;
    const Wt = Math.min(Q * Q + K * K, N * N + k * k), Gt = rt ? M : G, Me = Wt + Gt * Gt * x;
    if (ct <= Me) {
      if (join === 'bevel' || ct / x > y) {
        if (rt) { lpush(St, At); lpush(b + A * G, w + C * G); lpush(St, At); lpush(b + O * G, w + F * G); }
        else { lpush(b - A * M, w - C * M); lpush(_t, q); lpush(b - O * M, w - F * M); lpush(_t, q); }
        m += 2;
      } else if (join === 'round') {
        if (rt) {
          lpush(St, At); lpush(b + A * G, w + C * G);
          RP[0] = b; RP[1] = w; RP[2] = b + A * G; RP[3] = w + C * G; RP[4] = b + O * G; RP[5] = w + F * G;
          m += round(true) + 4;
          lpush(St, At); lpush(b + O * G, w + F * G);
        } else {
          lpush(b - A * M, w - C * M); lpush(_t, q);
          RP[0] = b; RP[1] = w; RP[2] = b - A * M; RP[3] = w - C * M; RP[4] = b - O * M; RP[5] = w - F * M;
          m += round(false) + 4;
          lpush(b - O * M, w - F * M); lpush(_t, q);
        }
      } else {
        lpush(St, At); lpush(_t, q);
      }
    } else {
      lpush(b - A * M, w - C * M); lpush(b + A * G, w + C * G);
      if (join === 'round') {
        if (rt) { RP[0] = b; RP[1] = w; RP[2] = b + A * G; RP[3] = w + C * G; RP[4] = b + O * G; RP[5] = w + F * G; }
        else { RP[0] = b; RP[1] = w; RP[2] = b - A * M; RP[3] = w - C * M; RP[4] = b - O * M; RP[5] = w - F * M; }
        m += round(rt) + 2;
      } else if (join === 'miter' && ct / x <= y) {
        if (rt) { lpush(_t, q); lpush(_t, q); } else { lpush(St, At); lpush(St, At); }
        m += 2;
      }
      lpush(b - O * M, w - F * M); lpush(b + O * G, w + F * G);
      m += 2;
    }
  }
  v = r[(f - 2) * 2]; S = r[(f - 2) * 2 + 1]; b = r[(f - 1) * 2]; w = r[(f - 1) * 2 + 1];
  A = -(S - w); C = v - b; R = Math.sqrt(A * A + C * C); A /= R; C /= R; A *= _; C *= _;
  lpush(b - A * M, w - C * M); lpush(b + A * G, w + C * G);
  if (!closed) {
    if (cap === 'round') {
      RP[0] = b - A * (M - G) * 0.5; RP[1] = w - C * (M - G) * 0.5; RP[2] = b - A * M; RP[3] = w - C * M; RP[4] = b + A * G; RP[5] = w + C * G;
      m += round(false) + 2;
    } else if (cap === 'square') {
      RP[0] = b; RP[1] = w; RP[2] = A; RP[3] = C; RP[4] = M; RP[5] = G;
      m += square(false);
    }
  }
  // The strip's triangles, leaving out those with no area.
  const D = 1e-4 * 1e-4;
  for (let X = g; X < m + g - 2; ++X) {
    v = lv[X * 2]; S = lv[X * 2 + 1]; b = lv[(X + 1) * 2]; w = lv[(X + 1) * 2 + 1]; E = lv[(X + 2) * 2]; P = lv[(X + 2) * 2 + 1];
    if (!(Math.abs(v * (w - P) + b * (P - S) + E * (S - w)) < D)) ltri(X, X + 1, X + 2);
  }
  return ln / 2;
}

/** A line's triangles, as PixiJS's builder makes them: { corners: [x, y...], triangles: [i...] } (for the tests). */
export function lineTriangles(pts, width, cap, join, closed) {
  const n = buildLine(Float64Array.from(pts), pts.length, { width }, cap, join, closed);
  return { corners: Array.from(lv.subarray(0, n * 2)), triangles: Array.from(lineIdx.subarray(0, lineN)) };
}

/** A part of a path: its points (x, y, x, y... in an array kept for reuse), and what shape it is. */
class Part {
  constructor() {
    this.a = new Float64Array(64);
    this.n = 0; // numbers used
    this.closed = false;
    this.rect = false;   // an upright rectangle
    this.convex = false; // a whole ellipse, or a turned rectangle: a fan of triangles fills it
  }

  push(x, y) {
    if (this.n + 2 > this.a.length) this.grow();
    this.a[this.n++] = x;
    this.a[this.n++] = y;
  }

  grow() { const a = new Float64Array(this.a.length * 2); a.set(this.a); this.a = a; }

  /** The points as a plain list (for the tests). */
  get pts() { return Array.from(this.a.subarray(0, this.n)); }
}

// ---- The context ----------------------------------------------------------------------

const NO_HOLES = [];

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
    this.stack = [];    // saved states (objects reused)
    this.depth = 0;
    // The path: its parts (objects reused frame after frame), and the one being added to.
    this.subs = [];
    this.nsub = 0;
    this.sub = null;
    // This frame's display objects, in drawing order.
    this.order = [];
    this.batch = null;
    this.batches = [];
    this.batchUsed = 0;
    // (Text objects are kept on each font's info, by size and text: see textObject.)
    this.sprites = [];
    this.spriteUsed = 0;
    this.gradients = new Map();
    this.fonts = new Map();
    this.frame = 0;
    this._measurer = null;
    this.shader = null;
  }

  /** A 2D canvas used to measure text. */
  get measurer() {
    return (this._measurer ||= document.createElement('canvas').getContext('2d'));
  }

  // ---- Frames ----

  beginFrame() {
    this.frame++;
    this.order.length = 0;
    this.batch = null;
    this.batchUsed = 0;
    this.spriteUsed = 0;
  }

  /** Put this frame's objects on the stage (only touching it if something changed). */
  endFrame() {
    for (let i = 0; i < this.batchUsed; i++) this.batches[i].upload();
    const kids = this.root.children, order = this.order;
    let same = kids.length === order.length;
    for (let i = 0; same && i < order.length; i++) same = kids[i] === order[i];
    if (!same) {
      this.root.removeChildren();
      if (order.length) this.root.addChild(...order);
    }
    // Throw away text that hasn't been drawn for a few seconds.
    if (this.frame % 60 === 0) {
      for (const f of this.fonts.values()) {
        if (!f.texts) continue;
        for (const [size, byText] of f.texts) {
          for (const [text, e] of byText) {
            e.list = e.list.filter(t => {
              if (this.frame - t._used < 180) return true;
              t.destroy();
              return false;
            });
            if (!e.list.length) byText.delete(text);
          }
          if (!byText.size) f.texts.delete(size);
        }
      }
    }
  }

  /** Add a ready-made display object (a layer of sprites, say) at this point in the drawing order. */
  insert(obj) {
    this.order.push(obj);
    this.batch = null;
  }

  /** The batch shapes go into: a new one after anything that isn't a shape, to keep the order. */
  get g() {
    if (!this.batch) {
      let b = this.batches[this.batchUsed];
      if (!b) {
        const P = this.P;
        if (P.Shader && !this.shader) this.shader = new P.Shader({ glProgram: new P.GlProgram({ vertex: SHAPE_VERTEX, fragment: SHAPE_FRAGMENT, name: 'shapes' }), resources: {} });
        this.batches.push(b = new ShapeBatch(P, this.shader));
      }
      b.nv = b.ni = 0;
      this.batchUsed++;
      this.batch = b;
      this.order.push(b.mesh || b);
    }
    return this.batch;
  }

  // ---- State ----

  save() {
    let s = this.stack[this.depth];
    if (!s) this.stack[this.depth] = s = { m: [1, 0, 0, 1, 0, 0] };
    this.depth++;
    const m = this.m, sm = s.m;
    sm[0] = m[0]; sm[1] = m[1]; sm[2] = m[2]; sm[3] = m[3]; sm[4] = m[4]; sm[5] = m[5];
    s.fillStyle = this.fillStyle; s.strokeStyle = this.strokeStyle; s.lineWidth = this.lineWidth;
    s.lineCap = this.lineCap; s.lineJoin = this.lineJoin; s.globalAlpha = this.globalAlpha;
    s.font = this.font; s.textAlign = this.textAlign; s.textBaseline = this.textBaseline;
  }

  restore() {
    if (!this.depth) return;
    const s = this.stack[--this.depth], m = this.m, sm = s.m;
    m[0] = sm[0]; m[1] = sm[1]; m[2] = sm[2]; m[3] = sm[3]; m[4] = sm[4]; m[5] = sm[5];
    this.fillStyle = s.fillStyle; this.strokeStyle = s.strokeStyle; this.lineWidth = s.lineWidth;
    this.lineCap = s.lineCap; this.lineJoin = s.lineJoin; this.globalAlpha = s.globalAlpha;
    this.font = s.font; this.textAlign = s.textAlign; this.textBaseline = s.textBaseline;
    // (Styles held by a saved state let go of, so they can be collected.)
    s.fillStyle = s.strokeStyle = null;
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

  /** The path's parts so far (for the tests, and anything that wants to look). */
  get path() { return this.subs.slice(0, this.nsub); }

  beginPath() {
    this.nsub = 0;
    this.sub = null;
  }

  /** A new part of the path (an object reused from earlier paths). */
  newSub() {
    let s = this.subs[this.nsub];
    if (!s) this.subs[this.nsub] = s = new Part();
    this.nsub++;
    s.n = 0;
    s.closed = s.rect = s.convex = false;
    return s;
  }

  moveTo(x, y) {
    const m = this.m;
    this.sub = this.newSub();
    this.sub.push(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
  }

  lineTo(x, y) {
    if (!this.sub) { this.moveTo(x, y); return; }
    const m = this.m;
    this.sub.convex = false; // (more added to a whole ellipse: maybe not convex any more)
    this.sub.push(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
  }

  closePath() {
    const s = this.sub;
    if (!s) return;
    s.closed = true;
    const x = s.a[0], y = s.a[1];
    this.sub = this.newSub();
    this.sub.push(x, y);
  }

  rect(x, y, w, h) {
    this.rectPath(this.newSub(), x, y, w, h);
    this.moveTo(x, y);
  }

  /** Sub-path s as the rectangle (x, y, w, h), transformed. */
  rectPath(s, x, y, w, h) {
    const m = this.m;
    s.n = 0;
    s.push(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
    s.push(m[0] * (x + w) + m[2] * y + m[4], m[1] * (x + w) + m[3] * y + m[5]);
    s.push(m[0] * (x + w) + m[2] * (y + h) + m[4], m[1] * (x + w) + m[3] * (y + h) + m[5]);
    s.push(m[0] * x + m[2] * (y + h) + m[4], m[1] * x + m[3] * (y + h) + m[5]);
    s.closed = true;
    s.rect = m[1] === 0 && m[2] === 0;
    s.convex = !s.rect;
    return s;
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
    const fresh = !this.sub || this.sub.n < 2;
    if (!fresh) this.sub.convex = false; // (added to what's there: maybe not convex any more)
    for (let i = 0; i <= n; i++) {
      const t = a0 + (sweep * i) / n;
      const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
      const px = x + ex * cr - ey * sr, py = y + ex * sr + ey * cr;
      if (i === 0 && fresh) this.moveTo(px, py);
      else this.sub.push(m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]);
    }
    if (Math.abs(sweep) >= TAU && fresh) {
      this.sub.closed = true;
      this.sub.convex = true;
    }
  }

  quadraticCurveTo(cx, cy, x, y) {
    if (!this.sub) this.moveTo(cx, cy);
    const m = this.m, p = this.sub;
    p.convex = false; // (more added to it: see lineTo)
    const x0 = p.a[p.n - 2], y0 = p.a[p.n - 1];
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
    const m = this.m, p = this.sub;
    p.convex = false; // (more added to it: see lineTo)
    const x0 = p.a[p.n - 2], y0 = p.a[p.n - 1];
    const x1 = m[0] * c1x + m[2] * c1y + m[4], y1 = m[1] * c1x + m[3] * c1y + m[5];
    const x2 = m[0] * c2x + m[2] * c2y + m[4], y2 = m[1] * c2x + m[3] * c2y + m[5];
    const x3 = m[0] * x + m[2] * y + m[4], y3 = m[1] * x + m[3] * y + m[5];
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
    const c = parseColor(this.fillStyle), alpha = c[1] * this.globalAlpha;
    if (alpha <= 0) return;
    setColor(c[0], alpha);
    for (let i = 0; i < this.nsub; i++) this.fillSub(this.subs[i]);
  }

  /** One part of a path, filled with the colour set (COLOR), into the batch. */
  fillSub(s) {
    const p = s.a, len = s.n, color = COLOR[0];
    if (len < 6) return;
    if (s.rect) {
      // An upright rectangle, as PixiJS makes one: from its corner and size, in two triangles.
      const x = Math.min(p[0], p[4]), y = Math.min(p[1], p[5]), w = Math.abs(p[4] - p[0]), h = Math.abs(p[5] - p[1]);
      if (!(w > 0 && h > 0)) return;
      const B = this.g;
      B.room(4, 6);
      const a = B.nv, f32 = B.f32, u32 = B.u32, idx = B.idx;
      let j = a * 3;
      f32[j] = x; f32[j + 1] = y; u32[j + 2] = color; j += 3;
      f32[j] = x + w; f32[j + 1] = y; u32[j + 2] = color; j += 3;
      f32[j] = x; f32[j + 1] = y + h; u32[j + 2] = color; j += 3;
      f32[j] = x + w; f32[j + 1] = y + h; u32[j + 2] = color;
      let k = B.ni;
      idx[k++] = a; idx[k++] = a + 1; idx[k++] = a + 2; idx[k++] = a + 1; idx[k++] = a + 3; idx[k++] = a + 2;
      B.ni = k;
      B.nv = a + 4;
      return;
    }
    const B = this.g, n = len / 2;
    let tri = null;
    if (s.convex) {
      // A shape with no dents (a whole ellipse, a turned rectangle): a fan of triangles from its
      // first point. (They cover exactly what earcut's triangles would, so the same pixels,
      // without earcut's garbage.)
      B.room(n, (n - 2) * 3);
      const base = B.nv, idx = B.idx;
      for (let i = 1; i + 1 < n; i++) { idx[B.ni++] = base; idx[B.ni++] = base + i; idx[B.ni++] = base + i + 1; }
    } else {
      // Any other shape: PixiJS's earcut makes the triangles.
      tri = this.P.earcut(p.subarray(0, len), NO_HOLES, 2);
      if (!tri) return;
      B.room(n, tri.length);
      const base = B.nv, idx = B.idx;
      for (let i = 0; i < tri.length; i++) idx[B.ni++] = tri[i] + base;
    }
    const f32 = B.f32, u32 = B.u32;
    for (let i = 0, j = B.nv * 3; i < len; i += 2, j += 3) { f32[j] = p[i]; f32[j + 1] = p[i + 1]; u32[j + 2] = color; }
    B.nv += n;
  }

  stroke() {
    const style = this.strokeStyle instanceof RadialGradient ? this.strokeStyle.stops[0]?.[1] || '#000' : this.strokeStyle;
    const line = this.lineStyle(parseColor(style));
    if (!line) return;
    for (let i = 0; i < this.nsub; i++) {
      const s = this.subs[i];
      if (s.n >= 4) this.strokeSub(s, s.closed, line);
    }
  }

  /**
   * The line's width on screen for colour c ([rgb, alpha]), with the colour set (COLOR), or
   * null if it wouldn't show.
   */
  lineStyle(c) {
    const line = this.line ||= { width: 0 }, m = this.m;
    let alpha = c[1] * this.globalAlpha;
    let width = this.lineWidth * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    // Lines thinner than a pixel: draw a pixel wide but fainter, as a canvas would.
    if (width < 1) { alpha *= width; width = 1; }
    if (alpha <= 0.002) return null;
    line.width = width;
    setColor(c[0], alpha);
    return line;
  }

  /** A line through part s's points, closed or not, in the colour set (COLOR), into the batch. */
  strokeSub(s, closed, line) {
    const n = buildLine(s.a, s.n, line, this.lineCap, this.lineJoin, closed), color = COLOR[0];
    const B = this.g;
    B.room(n, lineN);
    const base = B.nv, f32 = B.f32, u32 = B.u32, idx = B.idx;
    for (let i = 0, j = base * 3; i < n; i++, j += 3) { f32[j] = lv[i * 2]; f32[j + 1] = lv[i * 2 + 1]; u32[j + 2] = color; }
    for (let i = 0; i < lineN; i++) idx[B.ni++] = lineIdx[i] + base;
    B.nv += n;
  }

  fillRect(x, y, w, h) {
    const c = parseColor(this.fillStyle instanceof RadialGradient ? '#000' : this.fillStyle);
    const alpha = c[1] * this.globalAlpha;
    if (alpha <= 0 || !w || !h) return;
    const s = this.rectPath(this.scratch ||= new Part(), x, y, w, h);
    setColor(c[0], alpha);
    this.fillSub(s);
  }

  strokeRect(x, y, w, h) {
    const line = this.lineStyle(parseColor(this.strokeStyle));
    if (!line) return;
    const s = this.rectPath(this.scratch ||= new Part(), x, y, w, h);
    this.strokeSub(s, true, line);
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
      tex = this.P.Texture.from(cv, true); // (kept here only: see glrender.js's textureFrom)
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

  /**
   * A text object for this text, font and size: the next one not yet used this frame (the
   * same text can show more than once). Kept on the font's info, by size and text.
   */
  textObject(f, size, text) {
    const bySize = f.texts ||= new Map();
    let byText = bySize.get(size);
    if (!byText) bySize.set(size, byText = new Map());
    let e = byText.get(text);
    if (!e) byText.set(text, e = { list: [], used: 0, frame: -1 });
    if (e.frame !== this.frame) { e.frame = this.frame; e.used = 0; }
    let t = e.list[e.used++];
    if (!t) {
      t = new this.P.Text({
        text,
        style: { fontFamily: f.family, fontSize: size, fontWeight: f.weight, fontStyle: f.style, fill: 0xffffff },
        resolution: 1,
      });
      e.list.push(t);
    }
    t._used = this.frame;
    return t;
  }

  /** Where PixiJS puts the baseline (ascent), and how far below a given baseline the alphabetic one is. */
  fontMetrics(f, size, baseline) {
    // (Kept on the font's info, by size and baseline: no key to build each time.)
    const bySize = f.metrics ||= new Map();
    let byBase = bySize.get(size);
    if (!byBase) bySize.set(size, byBase = new Map());
    let r = byBase.get(baseline);
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
    byBase.set(baseline, r);
    return r;
  }
}
