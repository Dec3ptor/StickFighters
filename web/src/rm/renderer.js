// Stick Soldiers Remastered's renderer: the same game, drawn in 2.5D. Scenery
// in layers behind the play area, the map as solid blocks with depth and
// materials, shaded stick soldiers with shadows, glowing shots and explosions
// that light up their surroundings, weather, and darkness on night maps.
//
// It draws with the browser's 2D canvas, reusing the original renderer's camera,
// objectives, pickups and the less common projectiles and effects.

import { Renderer, fillSpikes } from '../render.js';
import { drawObjectives, drawCarried } from '../objdraw.js';
import { Fog } from '../fog.js';
import { lerp } from '../util.js';
import { themeFor, THEMES, worldTheme } from './themes.js';
import { Backdrop, dropScreenCopy } from './backdrop.js';
import { Blocks } from './blocks.js';
import { makeMaterials } from './textures.js';
import { drawSoldier, drawLineSoldier, drawShadows, drawName } from './soldiers.js';
import { skinFor } from '../skins.js';
import { Lights, Weather, LIGHT, glowSprite, fireballSprite, smokeSprite, cloudSprite, drawVignette, drawnByCPU, dropVignetteCopies } from './fx.js';
import { styledContext } from './hudstyle.js';
import { css, mix } from './color.js';
import { GameMap } from '../map.js';
import { paintMap } from '../maptiles.js';
import { WorldView, drawDrops, drawTarget } from '../world/worldrender.js';
import { nightness } from '../world/monsters.js';
import { TILE, BLOCKS, MAGMA, FURNACE } from '../world/blocks.js';

export // After a quality or map change, how long (ms) before the frame rate says anything about the quality.
const SETTLE = 2500;
const QUALITIES = ['high', 'medium', 'low'];

/** The bottom of the map's lowest block (world y). */
function lowest(map) {
  let b = -Infinity;
  for (const s of map.solids) if (s.b > b) b = s.b;
  return Number.isFinite(b) ? b : map.bounds.bottom;
}

// Stars in a world's night sky: where each is on the screen (0-1 across and down) and how bright.
const STARS = (() => {
  let r = 12345;
  const rnd = () => ((r = (r * 1103515245 + 12345) >>> 0) / 4294967296);
  return Array.from({ length: 90 }, () => [rnd(), rnd() * 0.6, 0.4 + rnd() * 0.6, rnd() < 0.15 ? 1.6 : 1]);
})();

/** A world at night: the sky darkened (n: 0 by day to 1 at night), and the stars out. */
function drawNight(ctx, r, n) {
  if (n <= 0) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = `rgba(4,7,22,${(0.78 * n).toFixed(3)})`;
  ctx.fillRect(0, 0, r.pw, r.ph);
  ctx.fillStyle = '#ffffff';
  const d = r.dpr || 1;
  for (const [x, y, a, size] of STARS) {
    ctx.globalAlpha = a * n;
    ctx.fillRect(x * r.pw, y * r.ph, size * d, size * d);
  }
  ctx.globalAlpha = 1;
}

// The colour of the light a glowing block gives (its ore's colour, or its own).
const glowOf = id => (id === MAGMA || id === FURNACE ? '#ff7a30' : BLOCKS[id].ore || BLOCKS[id].color);

const seedOf = s => { let h = 7; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 100000; };

// Night maps on lower quality: the plain dimming's colour, for each look.
const dimmings = new WeakMap();
function dimmingOf(theme) {
  let c = dimmings.get(theme);
  if (!c) dimmings.set(theme, c = `rgba(2,4,10,${(theme.dark * 0.6).toFixed(2)})`);
  return c;
}

// A world's scenery turns from one biome's into the next across this many blocks either side
// of where they meet, and eases over about this long (ms) when the camera jumps.
const BLEND_TILES = 48, BLEND_MS = 320;
// The colours between two biomes' looks change in this many steps.
const MIX_STEPS = 16;
const mostFirst = (a, b) => b.w - a.w;
// How far ahead (blocks, either way) the next biomes' scenery is made, while the game's idle.
const WARM_AHEAD = [-170, 170];
// Time a frame may spend making a biome's scenery that's wanted and not made yet (ms; a step at least).
const SCENERY_MS = 2;
// When the page is idle (or soon, where browsers can't say).
const idle = fn => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 500 }) : setTimeout(fn, 30));

/** Theme a with what the soldiers, gibs, vignette and darkness take from it mixed toward theme b's by u. */
function mixedTheme(a, b, u) {
  const c = (x, y) => css(mix(x || '#ffffff', y || '#ffffff', u));
  return {
    ...a,
    ink: c(a.ink, b.ink), haze: c(a.haze, b.haze), rim: c(a.rim, b.rim), halo: c(a.halo, b.halo),
    haloAlpha: lerp(a.haloAlpha ?? 0.3, b.haloAlpha ?? 0.3, u),
    vignette: Math.round(lerp(a.vignette || 0, b.vignette || 0, u) * 50) / 50,
    dark: lerp(a.dark || 0, b.dark || 0, u),
  };
}

export class RemasteredRenderer extends Renderer {
  /**
   * quality: 'high' (everything), 'medium' (plain-coloured block sides, less weather, simpler
   * darkness), 'low' (flat colours, fewer layers, no lights or weather), or 'auto': high,
   * stepping down whenever the frame rate can't keep up (see shed()).
   */
  constructor(canvas, quality = 'auto') {
    super(canvas);
    this.kind = 'remastered';
    this.lights = new Lights();
    this.frameAt = performance.now();
    this.setQuality(quality);
    drawnByCPU(); // (worked out now, while things are loading, not in the middle of a match)
  }

  /** Stop using this renderer: the screen-sized copies kept for drawing by the processor go too. */
  destroy() {
    super.destroy();
    dropScreenCopy();
    dropVignetteCopies();
  }

  setQuality(q) {
    this.auto = !QUALITIES.includes(q);
    this.quality = this.auto ? 'high' : q;
    this.adaptedAt = performance.now();
    this.flat = this.quality === 'low';
  }

  /**
   * Auto quality: the frame pacer asks for lighter drawing when frames can't keep up (for
   * a couple of seconds: a hiccup isn't a slow computer), before it lowers the frame rate:
   * the quality steps down a level. Just after a quality or map change (the scenery being
   * made) it's too soon to tell: the pacer's asked to judge again later. Returns whether
   * the pacer should hold off lowering the rate.
   */
  shed(now = performance.now()) {
    if (!this.auto || this.quality === 'low') return false;
    const made = Math.max(this.look?.at ?? -Infinity, this.worldLooks?.madeAt ?? -Infinity);
    if (now - this.adaptedAt < SETTLE || now - made < SETTLE) return true;
    const next = this.quality === 'high' ? 'medium' : 'low';
    this.quality = next;
    this.flat = next === 'low';
    this.adaptedAt = now;
    return true;
  }

  /**
   * The look for a map at the quality in use: its theme, scenery, materials. Made when the
   * map changes, and for each quality the first time it's used; kept while the map's the
   * same, so switching quality back costs nothing (the materials and the blocks' edges are
   * the same whatever the quality).
   */
  lookFor(map) {
    const q = this.quality;
    if (this.look?.map === map && this.look.quality === q) return this.look;
    if (this.looks?.map !== map) this.looks = { map };
    let look = this.looks[q];
    if (!look) {
      const other = this.looks.high || this.looks.medium || this.looks.low, theme = other?.theme || themeFor(map);
      look = this.looks[q] = {
        map, theme, quality: q, at: performance.now(),
        backdrop: new Backdrop(theme, seedOf(map.name), q),
        mats: other?.mats || makeMaterials(this.ctx, theme),
        blocks: other?.blocks || new Blocks(),
        weather: q === 'low' ? null : new Weather(theme.weather, q),
        ground: map.bounds.bottom,
        floor: lowest(map),
      };
    }
    return (this.look = look);
  }

  /**
   * A world's look: the sky, scenery and weather of the biome under the camera, standing on
   * the land round about. Near where two biomes meet both show, one turning into the other
   * across the land either side of the edge (and over a moment when the camera jumps: a
   * respawn, a teleport): worldLooks.parts, the looks shown and how much of each, the most
   * first; worldLooks.theme, the colours between them. Returns the look with the most.
   */
  worldLookFor(game, dt = 16) {
    const world = game.world, q = this.quality, gen = world.gen, x = this.cam.x / TILE, tx = Math.floor(x);
    let wl = this.worldLooks;
    const fresh = wl?.world !== world;
    if (fresh) {
      wl = this.worldLooks = {
        world, looks: new Map(), weights: new Map(), parts: [], blend: {}, ahead: {}, mixes: new Map(), warming: false, frame: 0,
        theme: null, ground: null, sky: 1, madeAt: 0,
      };
    }
    // How much of each biome's look there is where the camera is; eased (a new world: at once).
    const b = gen.blendAt(x, BLEND_TILES, wl.blend), own = worldTheme(b.own.key), other = worldTheme(b.other.key);
    const k = fresh ? 1 : 1 - Math.exp(-dt / BLEND_MS), W = wl.weights;
    if (!W.has(own)) W.set(own, 0);
    if (!W.has(other)) W.set(other, 0);
    let sum = 0;
    for (const [theme, w] of W) {
      const want = (theme === own ? 1 - b.t : 0) + (theme === other ? b.t : 0), now = w + (want - w) * k;
      if (want === 0 && now < 0.003) W.delete(theme);
      else { W.set(theme, now); sum += now; }
    }
    // (A biome's scenery not made yet, as when going fast: made a step each frame, while what's
    // there now stays; then it comes in. All at once, it stutters. Nothing made at all yet, as
    // in a new world or just after a teleport: the one there's most of, made now.)
    let ready = 0, budget = performance.now() + SCENERY_MS;
    for (const [theme, w] of W) {
      const look = this.worldLook(wl, theme, q, game);
      if (look.backdrop.prepare(this, 0)) { ready++; continue; }
      if (budget && look.backdrop.prepare(this, budget)) { ready++; budget = 0; continue; }
      budget = 0;
      if (W.size > 1) { sum -= w; W.set(theme, 0); }
    }
    if (!ready) {
      let most = null, mw = -1;
      for (const [theme, w] of W) if (w > mw) { mw = w; most = theme; }
      this.worldLook(wl, most, q, game).backdrop.prepare(this, Infinity);
      if (sum <= 0) { W.set(most, 1); sum = 1; }
    }
    const parts = wl.parts;
    let n = 0;
    for (const [theme, w] of W) {
      const look = this.worldLook(wl, theme, q, game);
      if (w <= 0 && W.size > 1) continue;
      const part = parts[n++] ||= { look: null, w: 0 };
      part.look = look;
      part.w = w / sum;
    }
    parts.length = n;
    if (n > 1) parts.sort(mostFirst);
    wl.theme = n > 1 ? this.mixTheme(wl, parts[0].look.theme, parts[1].look.theme, parts[1].w / (parts[0].w + parts[1].w)) : parts[0].look.theme;
    // (The scenery stands a little below the land round about, eased as the land rises and falls.)
    let land = 0;
    for (let i = -6; i <= 6; i++) land += gen.surfaceAt(tx + i * 12);
    land = (land / 13) * TILE + 140;
    wl.ground = wl.ground == null ? land : wl.ground + (land - wl.ground) * 0.04;
    // The weather fades out a few blocks underground.
    const below = this.cam.y / TILE - gen.surfaceAt(tx), sky = Math.min(1, Math.max(0, (15 - below) / 4));
    wl.sky += (sky - wl.sky) * k;
    // (Now and then: the scenery of the biomes either way ahead, made a step at a time while the game's idle.)
    if (++wl.frame % 30 === 0) for (const d of WARM_AHEAD) this.warm(wl, gen.blendAt(x + d, BLEND_TILES, wl.ahead), q, game);
    const look = parts[0].look;
    look.ground = Math.round(wl.ground);
    return (this.look = look);
  }

  /** The scenery of the biomes in blend `b` (either side of an edge ahead), made while the game's idle, before it's wanted. */
  warm(wl, b, q, game) {
    if (wl.warming) return;
    for (const biome of [b.own, b.other]) {
      const look = this.worldLook(wl, worldTheme(biome.key), q, game);
      if (look.backdrop.prepare(this, 0)) continue;
      wl.warming = true;
      const step = deadline => {
        if (this.worldLooks !== wl) return;
        const until = performance.now() + Math.max(2, Math.min(8, deadline?.timeRemaining?.() ?? 4));
        if (!look.backdrop.prepare(this, until)) { idle(step); return; }
        // (Drawn once too, while it's still idle: a graphics card takes its pictures in then, not at the edge.)
        look.backdrop.render(this, Math.round(wl.ground ?? 0), 0, 0);
        wl.warming = false;
      };
      idle(step);
      return;
    }
  }

  /** A world's look in a biome's theme, at quality q: made the first time, then kept. */
  worldLook(wl, theme, q, game) {
    let byQuality = wl.looks.get(theme);
    if (!byQuality) wl.looks.set(theme, byQuality = {});
    let look = byQuality[q];
    if (!look) {
      // (A world's blocks are drawn by worldrender.js: of the materials, only bits of blown-up blocks' colour is wanted.)
      look = byQuality[q] = {
        map: game.map, theme, quality: q, at: performance.now(),
        backdrop: new Backdrop(theme, seedOf(`${wl.world.name}/${theme.id}`), q),
        mats: { main: { frontColor: theme.tint || '#8a8580' } }, blocks: null,
        weather: q === 'low' ? null : new Weather(theme.weather, q),
        ground: 0, floor: Infinity,
      };
      wl.madeAt = look.at;
    }
    return look;
  }

  /**
   * Theme a's colours mixed toward theme b's by t (b's share, up to a half: a has more), in
   * steps, each kept once made: what the soldiers, gibs, vignette and darkness use between
   * two biomes.
   */
  mixTheme(wl, a, b, t) {
    const step = Math.round(t * MIX_STEPS);
    if (step <= 0 || a === b) return a;
    let byB = wl.mixes.get(a);
    if (!byB) wl.mixes.set(a, byB = new Map());
    let steps = byB.get(b);
    if (!steps) byB.set(b, steps = []);
    return (steps[step] ||= mixedTheme(a, b, step / MIX_STEPS));
  }

  /** A world's sky and scenery: the biome's look with the most first, the others faded in over it. */
  drawWorldScenery(ctx, dt) {
    const wl = this.worldLooks, parts = wl.parts, ground = Math.round(wl.ground), low = this.quality !== 'high';
    if (parts.length === 1) { parts[0].look.backdrop.draw(ctx, this, ground, dt, low ? parts[0].look.theme.vignette : 0); return; }
    // Between biomes: each one's picture brought up to date, mixed into one at their size (smaller
    // than the screen), and that stretched over the screen once.
    let same = true, key = 0;
    for (const p of parts) {
      const bd = p.look.backdrop;
      same = bd.render(this, ground, dt, low ? p.look.theme.vignette : 0) && same;
      key = key * 31 + bd.picture + Math.round(p.w * 1000);
    }
    const first = parts[0].look.backdrop.buf, W = first.width, H = first.height;
    let mix = wl.mixed;
    if (!mix || mix.cv.width !== W || mix.cv.height !== H) {
      const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
      mix = wl.mixed = { cv, g: cv.getContext('2d', { alpha: false }), key: NaN };
    }
    if (!same || key !== mix.key) {
      const g = mix.g;
      g.globalCompositeOperation = 'copy';
      g.globalAlpha = 1;
      g.drawImage(first, 0, 0);
      g.globalCompositeOperation = 'source-over';
      let shown = parts[0].w;
      for (let i = 1; i < parts.length; i++) {
        shown += parts[i].w;
        g.globalAlpha = parts[i].w / shown;
        g.drawImage(parts[i].look.backdrop.buf, 0, 0);
      }
      g.globalAlpha = 1;
      mix.key = key;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(mix.cv, 0, 0, this.pw, this.ph);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** A world (world mode): its blocks (worldrender.js), what glows in them lighting up round it, and what's on the ground. */
  drawWorld(game) {
    const v = this.worldView ||= new WorldView('remastered');
    v.drawBlocks(this, game);
    v.drawMagma(this.ctx, game, false);
    if (this.quality !== 'low') {
      // (Magma's light pulses, as it glows.)
      const g = v.glows, t = performance.now() / 1000;
      for (let i = 0; i < g.length; i += 4) {
        const k = g[i + 3] === MAGMA ? 0.8 + 0.35 * Math.sin(t * 1.7 + ((g[i] + g[i + 1]) % 63) / 10) : 1;
        this.lights.add(g[i], g[i + 1], 16 + g[i + 2] * 3.4, glowOf(g[i + 3]), (0.18 + g[i + 2] / 40) * k);
      }
    }
    drawDrops(this.ctx, game, 'remastered', this.alpha ?? 1, this.view);
  }

  /** Behind the menus: the scenery of the map picked (or a sunset city), slowly panning. */
  clear() {
    const now = performance.now(), dt = Math.min(100, now - this.frameAt);
    this.frameAt = now;
    const theme = this.menuTheme || { id: 'dusk', ...THEMES.dusk }, q = this.quality;
    if (this.menuLook?.theme.id !== theme.id || this.menuLook.quality !== q) {
      // (Kept for each quality while the scenery's the same, as for a map's look.)
      if (this.menuLooks?.id !== theme.id) this.menuLooks = { id: theme.id };
      this.menuLook = this.menuLooks[q] ||= { theme, quality: q, backdrop: new Backdrop(theme, 11, q), weather: q === 'low' ? null : new Weather(theme.weather, q) };
    }
    const t = now / 1000;
    this.cam.x = t * 22;
    this.cam.y = 250 + Math.sin(t * 0.13) * 40;
    this.cam.zoom = 1;
    this.menuLook.backdrop.draw(this.ctx, this, 520, dt, 0.55);
    this.menuLook.backdrop.drawFore(this.ctx, this, 330);
    this.menuLook.weather?.draw(this.ctx, this, dt);
    this.blank = false;
  }

  /**
   * What the HUD draws with: this renderer, with its canvas swapping the HUD's colours
   * and font for Remastered's (hudstyle.js).
   */
  get hud() {
    if (this.hudView?.ctx?.canvas !== this.ctx.canvas) {
      this.hudView = Object.create(this, { ctx: { value: styledContext(this.ctx, () => this.dpr) } });
    }
    return this.hudView;
  }

  /** The menus' background: the scenery of this map (mapData: its data, with a name). */
  setMenuMap(mapData) { this.menuTheme = mapData ? themeFor(mapData) : null; }

  render(game, alpha, viewer) {
    const now = performance.now(), dt = Math.min(100, now - this.frameAt);
    this.frameAt = now;
    const world = game.world;
    const look = world ? this.worldLookFor(game, dt) : this.lookFor(game.map);
    const theme = this.theme = world ? this.worldLooks.theme : look.theme;
    const ctx = this.ctx, s = this.scale * this.dpr;
    this.blank = false;
    this.alpha = alpha;
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    const tx = Math.round(this.canvas.width / 2 - (this.cam.x + sx) * s), ty = Math.round(this.canvas.height / 2 - (this.cam.y + sy) * s);
    this.s = s; this.tx = tx; this.ty = ty;
    this.updateView(s, tx, ty);
    this.lineW = Math.max(1.1, 1.3 / this.scale);

    if (world) this.drawWorldScenery(ctx, dt);
    else look.backdrop.draw(ctx, this, look.ground, dt, this.quality === 'high' ? 0 : theme.vignette);
    const allLit = !!viewer?.world?.dev?.lights;
    if (world && !allLit) drawNight(ctx, this, nightness(world.time || 0));
    ctx.setTransform(s, 0, 0, s, tx, ty);
    this.lights.clear();
    // Fog of war: what's out of sight is worked out now, and darkened after the world is drawn.
    this.fogNow = game.options?.fog && !this.noFog && (this.fogFrom || viewer) ? (this.fog ||= new Fog()).update(game, this.fogFrom || viewer, alpha) : null;

    if (world) this.drawWorld(game);
    else look.blocks.draw(this, game.map, look.mats, theme, !!game.options?.destruction);
    // Blocks given the original's look (the map maker's Look tool): paper and ink, as the
    // original draws them, in front of the solid blocks' sides.
    if (game.map.looks?.classic) paintMap(ctx, game.map, this.lineW, this.view, !!game.options?.destruction, 'remastered');
    this.drawPads(game);
    this.drawStains(game);
    drawObjectives(this, game);
    this.drawPickups(game);
    this.drawProjectiles(game, false);
    const shown = this.shownSoldiers(game, viewer);
    if (shown.soldiers.length < 80) drawShadows(this, game, shown.soldiers, alpha);
    for (const sol of shown.soldiers) this.drawSoldier(game, sol, alpha, viewer);
    drawCarried(this, game);
    this.drawProjectiles(game, true);
    this.drawEffects(game);
    for (const sol of shown.soldiers) if (sol.current === 'SR') this.drawLaser(game, sol);
    this.drawBuildGhost(game, viewer);

    // A world: dark underground (the glows and flashes go over it).
    if (world && !allLit) this.worldView.drawLight(this, game, 0.86);
    if (this.quality !== 'low') this.lights.draw(ctx, this.view);
    if (theme.dark && this.quality === 'high') this.lights.drawDarkness(this, theme.dark);
    else if (theme.dark) {
      // (A plain dimming without the lights cut out of it, on lower quality.)
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = dimmingOf(theme);
      ctx.fillRect(0, 0, this.pw, this.ph);
      ctx.setTransform(s, 0, 0, s, tx, ty);
    }
    if (this.fogNow) {
      this.fogNow.drawShadows(ctx, this.view, 'rgba(6,9,16,0.6)');
    }
    look.backdrop.drawFore(ctx, this, look.floor);
    ctx.setTransform(s, 0, 0, s, tx, ty);
    for (const sol of shown.names) this.drawName(game, sol, alpha, viewer);
    // (A world's: each biome's shown as much as its scenery is, fading out underground.)
    if (world) for (const p of this.worldLooks.parts) p.look.weather?.draw(ctx, this, dt, p.w * this.worldLooks.sky);
    else look.weather?.draw(ctx, this, dt);
    if (this.quality === 'high') drawVignette(ctx, this.pw, this.ph, theme.vignette);
    ctx.setTransform(s, 0, 0, s, tx, ty);
    this.fogNow?.drawAlerts(ctx);
    if (world) drawTarget(ctx, game, viewer, 'remastered');
  }

  drawSoldier(game, s, alpha) {
    // Remastered's own soldier, or a stick figure (the classic look, or a skin's: skins.js).
    const skin = skinFor(s, 'soldier');
    const theme = this.theme || this.look.theme;
    if (skin === 'soldier') drawSoldier(this, game, s, alpha, theme);
    else drawLineSoldier(this, game, s, alpha, theme, skin);
    const x = lerp(s.prevX, s.x, alpha), y = lerp(s.prevY, s.y, alpha);
    if (s.body.jetting) this.lights.add(x - s.facing * 3, y - 2, 34, LIGHT.jet, 0.55);
    // A Juggernaut lights up everything round it, pulsing with its glow.
    if (s.jugger > 0) this.lights.add(x, y - 12, 64, LIGHT.jugger, 0.45 + 0.2 * Math.sin(game.tick * 0.2));
  }

  drawName(game, s, alpha, viewer) { drawName(this, game, s, alpha, viewer); }

  /** The pale outline round gibs, in a theme's colours (worked out again only when the theme changes). */
  gibHaloOf(theme) {
    if (this.gibTheme !== theme) {
      this.gibTheme = theme;
      this.gibHalo = css(theme?.halo || '#ffffff', (theme?.haloAlpha ?? 0.3) * 0.8);
    }
    return this.gibHalo;
  }

  /** Jump pads: glowing green, with chevrons rising. */
  drawPads(game) {
    const ctx = this.ctx, pulse = (performance.now() / 400) % 1;
    for (const p of game.map.solids) {
      if (!p.bounce || p.r < this.view.l || p.l > this.view.r || p.b < this.view.t || p.t > this.view.b) continue;
      ctx.fillStyle = '#26302a';
      ctx.fillRect(p.l, p.t, p.r - p.l, p.b - p.t);
      ctx.fillStyle = '#7dff6a';
      ctx.fillRect(p.l + 1, p.t, p.r - p.l - 2, 1.6);
      ctx.strokeStyle = 'rgba(150,255,120,0.9)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let x = p.l + 8; x < p.r - 4; x += 12) {
        const y = p.t + (p.b - p.t) * 0.75 - pulse * 4;
        ctx.moveTo(x - 3.5, y + 2.5); ctx.lineTo(x, y - 1); ctx.lineTo(x + 3.5, y + 2.5);
      }
      ctx.stroke();
      this.lights.add((p.l + p.r) / 2, p.t, Math.max(30, (p.r - p.l) * 0.8), LIGHT.pad, 0.35);
    }
  }

  drawStains(game) {
    if (!game.fx) return;
    const ctx = this.ctx;
    ctx.fillStyle = '#6e0a0a';
    for (const st of game.fx.stains) {
      ctx.globalAlpha = Math.min(1, st.life / 200) * 0.85;
      ctx.beginPath();
      ctx.ellipse(st.x, st.y, st.size * 0.7, st.size * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Pickups, each with a soft glow so they stand out. */
  drawPickups(game) {
    const ctx = this.ctx, a = this.alpha ?? 1, t = performance.now() / 600;
    ctx.globalCompositeOperation = 'lighter';
    for (const it of game.pickups.items) {
      if (!it.active) continue;
      const x = lerp(it.px ?? it.x, it.x, a), y = lerp(it.py ?? it.y, it.y, a);
      if (x < this.view.l || x > this.view.r || y < this.view.t || y > this.view.b) continue;
      // (A Supply Drop, from a kill streak: a bigger, brighter gold glow.)
      if (it.streak) {
        ctx.globalAlpha = 0.5 + 0.15 * Math.sin(t * 2);
        ctx.drawImage(glowSprite('#ffc23a'), x - 26, y - 26, 52, 52);
        continue;
      }
      const color = it.type === 'health' ? '#ff6a6a' : it.type === 'armour' ? '#8ab8ff' : it.type === 'crate' ? '#ffd27a' : '#fff0b0';
      ctx.globalAlpha = 0.28 + 0.1 * Math.sin(t + (it.bob || 0));
      ctx.drawImage(glowSprite(color), x - 16, y - 16, 32, 32);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    super.drawPickups(game);
  }

  /** Bullets as glowing tracers; rockets, flames and magic with their light; the rest as in the original. */
  drawProjectiles(game, top) {
    const ctx = this.ctx, rest = this.rest ||= [], alpha = this.alpha ?? 1;
    rest.length = 0;
    const cull = game.crowded;
    ctx.lineCap = 'round';
    for (const p of game.projectiles) {
      if (p.delay > 0 || (cull && !this.inView(p.x, p.y))) continue;
      const front = p.kind === 'flame' || p.kind === 'gas' || p.kind === 'fire' || p.kind === 'cloud';
      if (front !== top) continue;
      // Where it's drawn: between the last two game updates (as between() works it out).
      const now = p.px == null || alpha >= 1;
      const x = now ? p.x : p.px + (p.x - p.px) * alpha, y = now ? p.y : p.py + (p.y - p.py) * alpha;
      if (this.fogNow && !this.fogNow.sees(x, y)) continue;
      if (p.kind === 'cloud') {
        // A smoke grenade's cloud: soft puffs, thick enough that nobody can be seen inside.
        const r = p.r || 10, fade = Math.min(1, (p.life ?? 99) / 90), spr = cloudSprite(), t = game.tick;
        ctx.globalAlpha = fade;
        for (let i = 0; i < 11; i++) {
          const a = (i / 11) * Math.PI * 2 + (p.id % 7) * 0.7, d = r * (i % 2 ? 0.38 : 0.62);
          const q = r * (0.75 + (i % 3) * 0.12), wob = Math.sin(t * 0.015 + i * 1.9) * r * 0.06;
          ctx.drawImage(spr, x + Math.cos(a) * d + wob - q, y + Math.sin(a) * d * 0.7 - q, q * 2, q * 2);
        }
        ctx.drawImage(spr, x - r, y - r, r * 2, r * 2);
        ctx.globalAlpha = 1;
        continue;
      }
      if (p.kind === 'bullet') {
        const sp = Math.hypot(p.vx, p.vy) || 1;
        const len = Math.min(0.9 * sp, 46, Math.max(0, (p.age ?? 9) - 1 + this.alpha) * sp);
        const x0 = x - (p.vx / sp) * len, y0 = y - (p.vy / sp) * len;
        const g = ctx.createLinearGradient(x0, y0, x, y);
        g.addColorStop(0, 'rgba(255,200,90,0)');
        g.addColorStop(1, 'rgba(255,236,170,0.95)');
        ctx.strokeStyle = g;
        ctx.lineWidth = p.sprite === 'slug' ? 1.8 : 1.2;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
        continue;
      }
      if (p.kind === 'rocket' && p.sprite !== 'bomb' && p.sprite !== 'mortar') this.lights.add(x, y, 46, LIGHT.rocket, 0.6);
      else if (p.kind === 'flame') this.lights.add(x, y, 34, LIGHT.fire, 0.18);
      else if (p.kind === 'fire') this.lights.add(x, y - 4, 44, LIGHT.fire, 0.35);
      else if (p.kind === 'seeker') this.lights.add(x, y, 40, LIGHT.magic, 0.5);
      // A Sentry Sheep's gun: a soft red light (amber while it unfolds). A stampede sheep's fuse.
      else if (p.kind === 'sentry') this.lights.add(x, y - 14, 24, p.armed > 0 ? LIGHT.jet : LIGHT.laser, 0.2);
      else if (p.sprite === 'stampede') this.lights.add(x - 6.8 * (p.dir || 1), y - 13.6, 18, LIGHT.spark, 0.45);
      rest.push(p);
    }
    if (rest.length) {
      // (The original's drawing, given just these: they're already culled and in sight. The
      // game as it sees it is made once a match.)
      if (this.restFor !== game) {
        this.restFor = game;
        this.restGame = Object.create(game, { projectiles: { value: rest }, crowded: { value: false } });
      }
      const fog = this.fogNow;
      this.fogNow = null;
      super.drawProjectiles(this.restGame, top);
      this.fogNow = fog;
    }
  }

  drawEffect(ctx, p) {
    const a = this.alpha ?? 1;
    const x = p.px == null ? p.x : lerp(p.px, p.x, a), y = p.py == null ? p.y : lerp(p.py, p.y, a);
    switch (p.kind) {
      case 'flash': {
        const k = p.life / 3;
        this.lights.add(x, y, 70, LIGHT.muzzle, 0.85 * k);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, 0.6 + k * 0.4);
        const r = p.size * 1.3;
        ctx.drawImage(glowSprite('#fff1c4'), x - r, y - r, r * 2, r * 2);
        this.turn(ctx, x, y, p.angle);
        ctx.fillStyle = '#fff6d8';
        ctx.beginPath();
        ctx.moveTo(0, -p.size * 0.32); ctx.lineTo(p.size * 1.25, 0); ctx.lineTo(0, p.size * 0.32); ctx.lineTo(p.size * 0.25, 0);
        ctx.fill();
        this.endTurn(ctx);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        return;
      }
      case 'boom': {
        const k = p.life / p.max, r = p.r * (1.5 - k * 0.7);
        this.lights.add(x, y, p.r * 4.5, LIGHT.boom, 1.1 * k);
        ctx.globalAlpha = Math.min(1, k * 1.2);
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(fireballSprite(), x - r, y - r, r * 2, r * 2);
        ctx.globalCompositeOperation = 'source-over';
        // The shock wave.
        ctx.globalAlpha = k * 0.5;
        ctx.strokeStyle = '#fff2d0';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, p.r * (1 + (1 - k) * 1.6), 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        return;
      }
      case 'smoke': {
        const k = p.life / p.max, r = p.r * 2.2;
        ctx.globalAlpha = 0.55 * k;
        ctx.drawImage(smokeSprite(), x - r, y - r, r * 2, r * 2);
        ctx.globalAlpha = 1;
        return;
      }
      case 'fire': {
        const k = p.life / p.max, r = p.r * (1.6 + k);
        this.lights.add(x, y, 26, LIGHT.fire, 0.18 * k);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k;
        ctx.drawImage(glowSprite(k > 0.6 ? '#ffd27a' : '#ff7a30'), x - r, y - r, r * 2, r * 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        return;
      }
      case 'ember': case 'spark': {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = p.kind === 'spark' ? '#ffe9a8' : p.life > 15 ? '#ffc04a' : '#ff6a20';
        const r = p.kind === 'spark' ? 0.7 : 0.9;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
        ctx.globalCompositeOperation = 'source-over';
        return;
      }
      case 'blood':
        ctx.fillStyle = '#9a0e0e';
        ctx.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size);
        return;
      case 'chunk': {
        // A bit of a blown-up block, in the map's material.
        const h = p.size / 2, m = this.look?.mats.main;
        this.turn(ctx, x, y, p.angle);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(-h - 0.5, -h - 0.5, p.size + 1, p.size + 1);
        ctx.fillStyle = m ? m.frontColor : '#888';
        ctx.fillRect(-h, -h, p.size, p.size);
        this.endTurn(ctx);
        return;
      }
      case 'gib': {
        // A limb, outlined like the soldiers (so it reads on any background), bloody at one end.
        const theme = this.theme ?? this.look?.theme, ink = theme?.ink || '#111';
        const dx = Math.cos(p.angle) * p.len / 2, dy = Math.sin(p.angle) * p.len / 2;
        ctx.globalAlpha = Math.min(1, p.life / 40);
        ctx.lineCap = 'round';
        ctx.strokeStyle = this.gibHaloOf(theme);
        ctx.lineWidth = 4.6;
        ctx.beginPath(); ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + dx, y + dy); ctx.stroke();
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + dx, y + dy); ctx.stroke();
        ctx.strokeStyle = '#8a0c0c';
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(x + dx * 0.72, y + dy * 0.72); ctx.lineTo(x + dx, y + dy); ctx.stroke();
        ctx.globalAlpha = 1;
        return;
      }
      case 'head': {
        const theme = this.theme ?? this.look?.theme;
        ctx.globalAlpha = Math.min(1, p.life / 40);
        ctx.fillStyle = this.gibHaloOf(theme);
        ctx.beginPath(); ctx.arc(x, y, p.r + 1.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = theme?.ink || '#111';
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
      case 'bang': {
        // A flashbang: a white-hot flash that lights everything around it.
        const k = p.life / p.max, r = 26 + (1 - k) * 60;
        this.lights.add(x, y, 260, '#ffffff', 1.4 * k);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k;
        ctx.drawImage(glowSprite('#ffffff'), x - r, y - r, r * 2, r * 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        return;
      }
      case 'killflash': {
        // A kill confirmed: a white-hot flash with red-tinged spikes, lighting up round it.
        const k = p.life / p.max, r = 2.5 + (1 - k * k) * 8, R = r * 2.2;
        this.lights.add(x, y, 46, LIGHT.kill, 0.5 * k);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k;
        ctx.drawImage(glowSprite('#ff5a40'), x - R, y - R, R * 2, R * 2);
        ctx.drawImage(glowSprite('#ffffff'), x - r * 1.3, y - r * 1.3, r * 2.6, r * 2.6);
        this.turn(ctx, x, y, p.angle || 0);
        ctx.fillStyle = '#ff7a60';
        fillSpikes(ctx, 6, r * 0.6, r * 2 + 2, r * 1.5 + 2, 1.3);
        ctx.fillStyle = '#ffffff';
        fillSpikes(ctx, 6, r * 0.6, r * 1.7 + 1, r * 1.3 + 1, 0.6);
        this.endTurn(ctx);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        return;
      }
      case 'trail': {
        ctx.strokeStyle = 'rgba(200,200,200,0.5)';
        ctx.globalAlpha = p.life / p.max;
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(p.x1, p.y1); ctx.stroke();
        ctx.globalAlpha = 1;
        return;
      }
    }
    super.drawEffect(ctx, p);
  }
}

/**
 * A picture of Remastered for the game picker: a sunset city, a few blocks, two
 * soldiers about to fight. Drawn once, onto canvas `cv`.
 */
export function drawRemasteredPreview(cv) {
  const r = Object.create(RemasteredRenderer.prototype);
  const ctx = cv.getContext('2d');
  const theme = themeFor({ name: 'Fire in the Hole' });
  Object.assign(r, {
    kind: 'remastered', ctx, canvas: cv, quality: 'high', flat: false, lights: new Lights(), alpha: 1, shake: 0,
    w: cv.width, h: cv.height, pw: cv.width, ph: cv.height, dpr: 1, baseScale: 1.15, cam: { x: 210, y: 105, zoom: 1 },
  });
  const map = new GameMap({ name: 'preview', bounds: { left: -200, top: -300, right: 700, bottom: 300 }, spawns: [], items: [],
    platforms: [{ left: 30, top: 200, right: 390, bottom: 250 }, { left: 60, top: 118, right: 170, bottom: 136 }, { left: 255, top: 104, right: 370, bottom: 122 }, { left: 170, top: 160, right: 230, bottom: 200 }] });
  new Backdrop(theme, 3, 'high').draw(ctx, r, 330, 16, 0);
  const s = r.scale;
  r.s = s; r.tx = Math.round(cv.width / 2 - r.cam.x * s); r.ty = Math.round(cv.height / 2 - r.cam.y * s);
  r.updateView(s, r.tx, r.ty);
  ctx.setTransform(s, 0, 0, s, r.tx, r.ty);
  new Blocks().draw(r, map, makeMaterials(ctx, theme), theme, false);
  const game = { rules: { teams: true }, tick: 0, map };
  const soldier = (id, x, y, team, facing, aim) => ({
    id, team, x, y, prevX: x, prevY: y, facing, aim, current: 'M4', armour: 50, health: 100, spawnProtect: 0, name: '',
    body: { onGround: true, vx: 0, vy: 0, crouching: false, jetting: false, hasJetpack: id === 2 },
    anim: { run: 0, idle: 0, flip: 0, land: 0, recoil: 0, swing: 0 },
  });
  drawShadows(r, game, [soldier(1, 115, 106, 1, 1, -0.1), soldier(2, 312, 92, 2, -1, Math.PI + 0.12)], 1);
  drawSoldier(r, game, soldier(1, 115, 106, 1, 1, -0.1), 1, theme);
  drawSoldier(r, game, soldier(2, 312, 92, 2, -1, Math.PI + 0.12), 1, theme);
  // A shot in the air between them, glowing.
  r.lights.add(150, 102, 70, LIGHT.muzzle, 0.9);
  r.lights.draw(ctx, r.view);
  ctx.strokeStyle = 'rgba(255,236,170,0.95)';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(170, 101); ctx.lineTo(205, 99); ctx.stroke();
  drawVignette(ctx, cv.width, cv.height, 0.5);
}
