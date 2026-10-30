// Drawing the world with WebGL, through PixiJS. All the drawing code is shared
// with the canvas renderer (render.js, sprites.js, hud.js), which draws onto a
// GLContext here instead of a canvas. The busiest things get faster paths: the
// map is built once, and blood stains and most particles are drawn as sprites,
// all of them in one go (glctx.js's QuadBatch).
//
// createRenderer() picks WebGL when the graphics card can do it, and the plain
// canvas otherwise (Settings -> Graphics, or ?renderer=canvas / webgl in the address).

import { Renderer, HATCH, HATCH_GAP, BUILT, BUILT_LINE, BUILT_ROW } from './render.js';
import { hasGPU } from './gpu.js';
import { GLContext, QuadBatch, QP } from './glctx.js';
import { drawObjectives, drawCarried } from './objdraw.js';
import { fillSeams, hatch, courses } from './map.js';

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
  probed ??= hasGPU() ? 'webgl' : 'canvas';
  return probed;
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
    // The map, in world coordinates (it follows the camera).
    this.mapLayer = new P.Container();
    this.mapGfx = new P.Graphics();
    this.mapLayer.addChild(this.mapGfx);
    // Stains and particles: sprites in world units, drawn in batches (textures: 0 square, 1 disc, 2 glow).
    const textures = [this.tex.square, this.tex.disc, this.tex.boom];
    this.stainQuads = new QuadBatch(P, textures);
    this.partQuads = new QuadBatch(P, textures);
    this.applySize();
  }

  applySize() {
    // PixiJS sizes the canvas (in device pixels); its size on the page is set in resize().
    this.gl?.resize(this.pw, this.ph, 1);
  }

  destroy() {
    super.destroy();
    // (The sprite batches' shaders listen to PixiJS's shared white texture, which would keep
    // them, and the textures they draw with, alive after this renderer's gone.)
    this.stainQuads?.mesh?.shader.destroy();
    this.partQuads?.mesh?.shader.destroy();
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
    // (At whole screen pixels, as the canvas draws it: crisper, and the same picture.)
    const tx = Math.round(this.pw / 2 - (this.cam.x + sx) * s), ty = Math.round(this.ph / 2 - (this.cam.y + sy) * s);
    this.s = s; this.tx = tx; this.ty = ty; // (for drawing turned things: Renderer.turn())
    ctx.setTransform(s, 0, 0, s, tx, ty);
    this.updateView(s, tx, ty);
    this.mapLayer.position.set(tx, ty);
    this.mapLayer.scale.set(s);
    this.lineW = Math.max(1.1, 1.3 / this.scale);

    const fog = this.startFog(game, alpha, viewer);
    this.drawMap(game);
    this.drawStains(game);
    drawObjectives(this, game);
    this.drawPickups(game);
    this.drawProjectiles(game, false);
    const shown = this.shownSoldiers(game, viewer);
    // (All the soldiers in one go where render.js can, as the canvas draws them.)
    if (this.drawSoldiers) this.drawSoldiers(game, shown.soldiers, alpha, viewer);
    else for (const sol of shown.soldiers) this.drawSoldier(game, sol, alpha, viewer);
    drawCarried(this, game);
    this.drawProjectiles(game, true);
    this.drawEffects(game);
    for (const sol of shown.soldiers) if (sol.current === 'SR') this.drawLaser(game, sol);
    this.drawBuildGhost(game, viewer);
    if (this.drawNames) this.drawNames(game, shown.names, alpha, viewer);
    else for (const sol of shown.names) this.drawName(game, sol, alpha, viewer);
    fog?.drawAlerts(ctx);
  }

  /**
   * Build the map's shapes once (again when blocks are destroyed, or the outline width changes
   * with the zoom). Blocks given Remastered's look (the map maker's Look tool) are drawn
   * each frame, underneath: their sides shift as the camera moves.
   */
  drawMap(game) {
    const e = Math.round(this.lineW * 20) / 20, mixed = game.map.looks?.remastered;
    if (this.mapFor !== game.map || this.mapEdge !== e || this.mapVersion !== game.map.version) {
      this.mapFor = game.map;
      this.mapEdge = e;
      this.mapVersion = game.map.version;
      const g = this.mapGfx, solids = mixed ? game.map.solids.filter(p => p.look !== 'remastered') : game.map.solids;
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
      // Built blocks: sandbag colour, with the rows drawn in.
      if (game.map.builtCount) {
        for (const p of solids) if (p.built) g.rect(p.l, p.t, p.r - p.l, p.b - p.t);
        g.fill(BUILT);
        for (const p of solids) if (p.built) courses(p.l, p.t, p.r, p.b, BUILT_ROW, (x0, y0, x1, y1) => { g.moveTo(x0, y0); g.lineTo(x1, y1); });
        g.stroke({ width: 1, color: BUILT_LINE });
      }
      // Destructible maps: blocks explosions can't break are hatched.
      if (game.options?.destruction && solids.some(p => p.hard && !p.bounce)) {
        for (const p of solids) {
          if (p.hard && !p.bounce) hatch(p.l, p.t, p.r, p.b, HATCH_GAP, (x0, y0, x1, y1) => { g.moveTo(x0, y0); g.lineTo(x1, y1); });
        }
        g.stroke({ width: 1, color: HATCH });
      }
    }
    if (mixed) this.drawRemasteredBlocks(game);
    this.ctx.insert(this.mapLayer);
    this.drawPads(game, false);
  }

  /** Sprites from a batch into the picture at this point (the camera's scale and place set). */
  insertQuads(q) {
    if (!q.n) return;
    q.upload();
    this.ctx.insert(q.mesh);
  }

  drawStains(game) {
    if (!game.fx) return;
    const q = this.stainQuads;
    q.n = 0;
    // (The sprite's numbers go in QP: handed to a function one by one, each could cost a new object.)
    QP[4] = 0; QP[6] = this.s; QP[7] = this.tx; QP[8] = this.ty;
    for (const st of game.fx.stains) {
      QP[0] = st.x; QP[1] = st.y; QP[2] = QP[3] = st.size; QP[5] = Math.min(1, st.life / 200) * 0.8;
      q.add(0, 0xa30d0d);
    }
    this.insertQuads(q);
  }

  /** Blood, sparks, smoke and fire as sprites; everything else as shapes. */
  drawEffects(game) {
    if (!game.fx) return;
    const q = this.partQuads, a = this.alpha ?? 1;
    q.n = 0;
    QP[6] = this.s; QP[7] = this.tx; QP[8] = this.ty;
    for (const p of game.fx.parts) {
      if (!SPRITE_PARTS.has(p.kind)) continue;
      // Drawn between game updates, like everything else.
      QP[0] = p.px == null ? p.x : p.px + (p.x - p.px) * a;
      QP[1] = p.py == null ? p.y : p.py + (p.y - p.py) * a;
      // Each kind's picture: texture (0 square, 1 disc, 2 glow), size (w x h, world units), turn, tint, alpha.
      let tex = 0, tint = 0xffffff;
      QP[2] = QP[3] = 1; QP[4] = 0; QP[5] = 1;
      switch (p.kind) {
        case 'blood': QP[2] = QP[3] = p.size; tint = 0xc40f0f; break;
        case 'spark': tint = 0x444444; break;
        case 'ember': QP[2] = QP[3] = 1.6; tint = p.life > 15 ? 0xffb02e : 0xc4561a; break;
        case 'sparkle': QP[2] = QP[3] = 1.6; tint = 0xaa78ff; QP[5] = p.life / p.max; break;
        case 'shell': QP[2] = 2.4; QP[4] = p.angle; tint = 0xc9a227; break;
        case 'smoke': tex = 1; QP[2] = QP[3] = p.r * 2; tint = 0x8c8c8c; QP[5] = 0.32 * p.life / p.max; break;
        case 'fire': {
          const k = p.life / p.max;
          tex = 1; QP[2] = QP[3] = 2 * p.r * (0.6 + k * 0.4); tint = k > 0.6 ? 0xffdc5a : 0xff6e1e; QP[5] = k;
          break;
        }
        case 'boom': {
          const k = p.life / p.max;
          tex = 2; QP[2] = QP[3] = 2 * p.r * (1.3 - k * 0.6); QP[5] = k;
          break;
        }
      }
      q.add(tex, tint);
    }
    this.insertQuads(q);
    for (const p of game.fx.parts) if (!SPRITE_PARTS.has(p.kind)) this.drawEffect(this.ctx, p);
  }
}

function textureFrom(P, size, draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'));
  // (Not in PixiJS's shared cache, which would keep it, and its canvas, after this renderer's gone.)
  return P.Texture.from(cv, true);
}
