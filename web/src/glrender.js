// Drawing the world with WebGL, through PixiJS. All the drawing code is shared
// with the canvas renderer (render.js, sprites.js, hud.js), which draws onto a
// GLContext here instead of a canvas. The busiest things get faster paths: the
// map is built once, and blood stains and most particles are sprites.
//
// createRenderer() picks WebGL when the graphics card can do it, and the plain
// canvas otherwise (Settings -> Graphics, or ?renderer=canvas / webgl in the address).

import { Renderer, HATCH, HATCH_GAP } from './render.js';
import { GLContext } from './glctx.js';
import { drawObjectives, drawCarried } from './objdraw.js';
import { fillSeams, hatch } from './map.js';

const INK = 0x111111;
// Particles drawn as sprites (the rest are drawn as shapes, like on the canvas).
const SPRITE_PARTS = new Set(['blood', 'spark', 'ember', 'sparkle', 'shell', 'smoke', 'fire', 'boom']);

/**
 * A renderer for `canvas`. choice: 'webgl', 'canvas', or 'auto' (WebGL if the
 * graphics card can run it). If WebGL fails, it draws with the canvas instead,
 * on a new canvas element (one that has tried WebGL can't switch to 2D), which
 * takes the old one's place in the page: use the renderer's `canvas`.
 */
export async function createRenderer(canvas, choice = 'auto') {
  if (choice === 'webgl' || (choice === 'auto' && autoGraphics() === 'webgl')) {
    try {
      return await GLRenderer.create(canvas);
    } catch (err) {
      console.warn('WebGL unavailable, drawing with the canvas instead:', err);
      const fresh = canvas.cloneNode(false);
      canvas.replaceWith(fresh);
      canvas = fresh;
    }
  }
  return new Renderer(canvas);
}

let probed = null;

/** What "auto" picks here: 'webgl' if WebGL runs on a graphics card, otherwise 'canvas'. */
export function autoGraphics() {
  probed ??= hardwareWebGL() ? 'webgl' : 'canvas';
  return probed;
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

  destroy() {
    super.destroy();
    this.gl?.destroy(false);
    this.gl = null;
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
    this.alpha = alpha;
    ctx.beginFrame();
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    const tx = this.pw / 2 - (this.cam.x + sx) * s, ty = this.ph / 2 - (this.cam.y + sy) * s;
    ctx.setTransform(s, 0, 0, s, tx, ty);
    this.updateView(s, tx, ty);
    for (const layer of [this.mapLayer, this.stainLayer, this.partLayer]) {
      layer.position.set(tx, ty);
      layer.scale.set(s);
    }
    this.lineW = Math.max(1.1, 1.3 / this.scale);

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
    for (const sol of shown.names) this.drawName(game, sol, alpha, viewer);
    fog?.drawAlerts(ctx);
  }

  /** Build the map's shapes once (again when blocks are destroyed, or the outline width changes with the zoom). */
  drawMap(game) {
    const e = Math.round(this.lineW * 20) / 20;
    if (this.mapFor !== game.map || this.mapEdge !== e || this.mapVersion !== game.map.version) {
      this.mapFor = game.map;
      this.mapEdge = e;
      this.mapVersion = game.map.version;
      const g = this.mapGfx, solids = game.map.solids;
      g.clear();
      for (const p of solids) g.rect(p.l - e, p.t - e, p.r - p.l + 2 * e, p.b - p.t + 2 * e);
      g.fill(INK);
      for (const p of solids) g.rect(p.l, p.t, p.r - p.l, p.b - p.t);
      // No hairlines where blocks just meet.
      fillSeams(game.map.getSeams(), e, (x, y, w, h) => g.rect(x, y, w, h));
      g.fill(0xffffff);
      if (solids.some(p => p.bounce)) {
        for (const p of solids) if (p.bounce) g.rect(p.l, p.t, p.r - p.l, p.b - p.t);
        g.fill(0xeef3e2);
      }
      // Destructible maps: blocks explosions can't break are hatched.
      if (game.options?.destruction && solids.some(p => p.hard && !p.bounce)) {
        for (const p of solids) {
          if (p.hard && !p.bounce) hatch(p.l, p.t, p.r, p.b, HATCH_GAP, (x0, y0, x1, y1) => { g.moveTo(x0, y0); g.lineTo(x1, y1); });
        }
        g.stroke({ width: 1, color: HATCH });
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
    const pool = this.partSprites, { square, disc, boom } = this.tex, a = this.alpha ?? 1;
    let i = 0;
    for (const p of game.fx.parts) {
      if (!SPRITE_PARTS.has(p.kind)) continue;
      // Drawn between game updates, like everything else.
      const x = p.px == null ? p.x : p.px + (p.x - p.px) * a, y = p.py == null ? p.y : p.py + (p.y - p.py) * a;
      switch (p.kind) {
        case 'blood':
          put(this.spriteFrom(pool, i++, this.partLayer, square), x, y, p.size, p.size, 0, 0xc40f0f, 1);
          break;
        case 'spark':
          put(this.spriteFrom(pool, i++, this.partLayer, square), x, y, 1, 1, 0, 0x444444, 1);
          break;
        case 'ember':
          put(this.spriteFrom(pool, i++, this.partLayer, square), x, y, 1.6, 1.6, 0, p.life > 15 ? 0xffb02e : 0xc4561a, 1);
          break;
        case 'sparkle':
          put(this.spriteFrom(pool, i++, this.partLayer, square), x, y, 1.6, 1.6, 0, 0xaa78ff, p.life / p.max);
          break;
        case 'shell':
          put(this.spriteFrom(pool, i++, this.partLayer, square), x, y, 2.4, 1, p.angle, 0xc9a227, 1);
          break;
        case 'smoke':
          put(this.spriteFrom(pool, i++, this.partLayer, disc), x, y, p.r * 2, p.r * 2, 0, 0x8c8c8c, 0.32 * p.life / p.max);
          break;
        case 'fire': {
          const k = p.life / p.max, d = 2 * p.r * (0.6 + k * 0.4);
          put(this.spriteFrom(pool, i++, this.partLayer, disc), x, y, d, d, 0, k > 0.6 ? 0xffdc5a : 0xff6e1e, k);
          break;
        }
        case 'boom': {
          const k = p.life / p.max, d = 2 * p.r * (1.3 - k * 0.6);
          put(this.spriteFrom(pool, i++, this.partLayer, boom), x, y, d, d, 0, 0xffffff, k);
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
