// Drawing the world with WebGL, through PixiJS. All the drawing code is shared
// with the canvas renderer (render.js, sprites.js, hud.js), which draws onto a
// GLContext here instead of a canvas. The busiest things get faster paths: the
// map is built once, and blood stains and most particles are sprites.
//
// createRenderer() picks WebGL when the graphics card can do it, and the plain
// canvas otherwise (or with ?renderer=canvas / ?renderer=webgl in the address).

import { Renderer } from './render.js';
import { GLContext } from './glctx.js';

const INK = 0x111111;
// Particles drawn as sprites (the rest are drawn as shapes, like on the canvas).
const SPRITE_PARTS = new Set(['blood', 'spark', 'ember', 'sparkle', 'shell', 'smoke', 'fire', 'boom']);

/** The best renderer this browser can run: WebGL if the graphics card can do it, otherwise the canvas. */
export async function createRenderer(canvas) {
  const want = new URLSearchParams(location.search).get('renderer');
  if (want !== 'canvas' && (want === 'webgl' || hardwareWebGL())) {
    try {
      return await GLRenderer.create(canvas);
    } catch (err) {
      console.warn('WebGL unavailable, drawing with the canvas instead:', err);
      // A canvas that has tried WebGL can't switch to 2D: use a fresh one.
      const fresh = canvas.cloneNode(false);
      canvas.replaceWith(fresh);
      canvas = fresh;
    }
  }
  return new Renderer(canvas);
}

/**
 * True if WebGL runs on a graphics card. Without one, browsers draw WebGL on
 * the processor, which is slower than the plain canvas.
 */
function hardwareWebGL() {
  try {
    const c = document.createElement('canvas');
    const opts = { failIfMajorPerformanceCaveat: true };
    const gl = c.getContext('webgl2', opts) || c.getContext('webgl', opts);
    if (!gl) return false;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return !/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

export class GLRenderer extends Renderer {
  static async create(canvas) {
    const P = await import('../vendor/pixi.min.js');
    const r = new GLRenderer(canvas, P);
    await r.init();
    return r;
  }

  constructor(canvas, P) {
    super(canvas, null);
    this.kind = 'webgl';
    this.P = P;
  }

  async init() {
    const P = this.P;
    this.gl = await P.autoDetectRenderer({
      preference: ['webgl'],
      canvas: this.canvas,
      width: this.pw,
      height: this.ph,
      resolution: 1,
      autoDensity: false,
      antialias: true,
      background: 0xffffff,
      powerPreference: 'high-performance',
      hello: false,
    });
    this.stage = new P.Container();
    this.ctx = new GLContext(P, this.stage);
    this.ctx.canvas = this.canvas;

    // Textures for sprites: a white square, a white disc, and an explosion's glow.
    this.tex = {
      square: P.Texture.WHITE,
      disc: textureFrom(P, 128, c => { c.fillStyle = '#fff'; c.beginPath(); c.arc(64, 64, 63, 0, Math.PI * 2); c.fill(); }),
      boom: textureFrom(P, 128, c => {
        const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, 'rgba(255,255,220,1)');
        g.addColorStop(0.4, 'rgba(255,170,40,1)');
        g.addColorStop(1, 'rgba(255,90,20,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, 128, 128);
      }),
    };
    // Layers in world coordinates (they follow the camera).
    this.mapLayer = new P.Container();
    this.mapGfx = new P.Graphics();
    this.mapLayer.addChild(this.mapGfx);
    this.stainLayer = new P.Container();
    this.stainSprites = [];
    this.partLayer = new P.Container();
    this.partSprites = [];
    this.applySize();
  }

  applySize() {
    // PixiJS sizes the canvas (in device pixels); its size on the page is set in resize().
    this.gl?.resize(this.pw, this.ph, 1);
  }

  clear() {
    if (this.blank) return;
    this.stage.removeChildren();
    this.gl.render(this.stage);
    this.blank = true;
  }

  present() {
    this.ctx.endFrame();
    this.gl.render(this.stage);
  }

  render(game, alpha, viewer) {
    const ctx = this.ctx, s = this.scale * this.dpr;
    this.blank = false;
    ctx.beginFrame();
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    const tx = this.pw / 2 - (this.cam.x + sx) * s, ty = this.ph / 2 - (this.cam.y + sy) * s;
    ctx.setTransform(s, 0, 0, s, tx, ty);
    for (const layer of [this.mapLayer, this.stainLayer, this.partLayer]) {
      layer.position.set(tx, ty);
      layer.scale.set(s);
    }
    this.lineW = Math.max(1.1, 1.3 / this.scale);

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

  /** The map doesn't change: build it once (again only if the outline width changes with the zoom). */
  drawMap(game) {
    const e = Math.round(this.lineW * 20) / 20;
    if (this.mapFor !== game.map || this.mapEdge !== e) {
      this.mapFor = game.map;
      this.mapEdge = e;
      const g = this.mapGfx, solids = game.map.solids;
      g.clear();
      for (const p of solids) g.rect(p.l - e, p.t - e, p.r - p.l + 2 * e, p.b - p.t + 2 * e);
      g.fill(INK);
      for (const p of solids) g.rect(p.l, p.t, p.r - p.l, p.b - p.t);
      g.fill(0xffffff);
      if (solids.some(p => p.bounce)) {
        for (const p of solids) if (p.bounce) g.rect(p.l, p.t, p.r - p.l, p.b - p.t);
        g.fill(0xeef3e2);
      }
    }
    this.ctx.insert(this.mapLayer);
    this.drawPads(game, false);
  }

  drawStains(game) {
    if (!game.fx) return;
    const pool = this.stainSprites;
    let i = 0;
    for (const st of game.fx.stains) {
      const sp = this.spriteFrom(pool, i++, this.stainLayer, this.tex.square);
      put(sp, st.x, st.y, st.size, st.size, 0, 0xa30d0d, Math.min(1, st.life / 200) * 0.8);
    }
    hideFrom(pool, i);
    this.ctx.insert(this.stainLayer);
  }

  /** Blood, sparks, smoke and fire as sprites; everything else as shapes. */
  drawEffects(game) {
    if (!game.fx) return;
    const pool = this.partSprites, { square, disc, boom } = this.tex;
    let i = 0;
    for (const p of game.fx.parts) {
      if (!SPRITE_PARTS.has(p.kind)) continue;
      switch (p.kind) {
        case 'blood':
          put(this.spriteFrom(pool, i++, this.partLayer, square), p.x, p.y, p.size, p.size, 0, 0xc40f0f, 1);
          break;
        case 'spark':
          put(this.spriteFrom(pool, i++, this.partLayer, square), p.x, p.y, 1, 1, 0, 0x444444, 1);
          break;
        case 'ember':
          put(this.spriteFrom(pool, i++, this.partLayer, square), p.x, p.y, 1.6, 1.6, 0, p.life > 15 ? 0xffb02e : 0xc4561a, 1);
          break;
        case 'sparkle':
          put(this.spriteFrom(pool, i++, this.partLayer, square), p.x, p.y, 1.6, 1.6, 0, 0xaa78ff, p.life / p.max);
          break;
        case 'shell':
          put(this.spriteFrom(pool, i++, this.partLayer, square), p.x, p.y, 2.4, 1, p.angle, 0xc9a227, 1);
          break;
        case 'smoke':
          put(this.spriteFrom(pool, i++, this.partLayer, disc), p.x, p.y, p.r * 2, p.r * 2, 0, 0x8c8c8c, 0.32 * p.life / p.max);
          break;
        case 'fire': {
          const k = p.life / p.max, d = 2 * p.r * (0.6 + k * 0.4);
          put(this.spriteFrom(pool, i++, this.partLayer, disc), p.x, p.y, d, d, 0, k > 0.6 ? 0xffdc5a : 0xff6e1e, k);
          break;
        }
        case 'boom': {
          const k = p.life / p.max, d = 2 * p.r * (1.3 - k * 0.6);
          put(this.spriteFrom(pool, i++, this.partLayer, boom), p.x, p.y, d, d, 0, 0xffffff, k);
          break;
        }
      }
    }
    hideFrom(pool, i);
    this.ctx.insert(this.partLayer);
    for (const p of game.fx.parts) if (!SPRITE_PARTS.has(p.kind)) this.drawEffect(this.ctx, p);
  }

  /** Sprite number i of a pool, made (and added to the layer) the first time. */
  spriteFrom(pool, i, layer, tex) {
    let sp = pool[i];
    if (!sp) {
      sp = new this.P.Sprite(tex);
      sp.anchor.set(0.5);
      pool.push(sp);
      layer.addChild(sp);
    } else if (sp.texture !== tex) sp.texture = tex;
    sp.visible = true;
    return sp;
  }
}

/** Place a centred sprite: size w x h (world units), turned by `angle`, tinted. */
function put(sp, x, y, w, h, angle, tint, alpha) {
  sp.position.set(x, y);
  sp.rotation = angle;
  sp.scale.set(w / sp.texture.width, h / sp.texture.height);
  sp.tint = tint;
  sp.alpha = alpha;
}

function hideFrom(pool, i) {
  for (; i < pool.length; i++) {
    if (!pool[i].visible) break;
    pool[i].visible = false;
  }
}

function textureFrom(P, size, draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'));
  return P.Texture.from(cv);
}
