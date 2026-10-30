// Pictures of the skins for Settings (Character): soldiers standing as each game draws them,
// with the skin given, on paper (the original) or under a sunset sky (Remastered).

import { Renderer } from './render.js';
import { RemasteredRenderer } from './rm/renderer.js';
import { THEMES } from './rm/themes.js';

const THEME = THEMES.dusk;

/** A soldier standing still, for a picture: just what the drawing reads. */
function stand(id, team, x, facing, skin, extra = {}) {
  return {
    id, team, x, y: 0, prevX: x, prevY: 0, facing, aim: facing > 0 ? -0.12 : Math.PI + 0.12, current: 'M4', armour: 0, health: 150,
    spawnProtect: 0, jugger: 0, name: '', skin,
    body: { onGround: true, vx: 0, vy: 0, crouching: false, jetting: false, hasJetpack: false, rope: null },
    anim: { run: 0, idle: 0, flip: 0, land: 0, recoil: 0, swing: 0 },
    ...extra,
  };
}

/**
 * Draw soldiers with skin `skin` onto canvas `cv`, as `edition` ('original' or 'remastered')
 * draws them: two facing each other in their teams' colours (pair), or one (team 1).
 */
export function drawSkinPreview(cv, skin, edition, { pair = true } = {}) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, rm = edition === 'remastered';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (rm) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    for (const [at, color] of THEME.sky) g.addColorStop(at, color);
    ctx.fillStyle = g;
  } else ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  // (About a soldier and a half tall: 40 map units fill most of the height.)
  const k = H / 58, floor = H * 0.78;
  // The ground they stand on.
  ctx.fillStyle = rm ? THEME.ground : '#ffffff';
  ctx.fillRect(0, floor + 12 * k, W, H);
  ctx.strokeStyle = rm ? 'rgba(255,190,140,0.35)' : '#111';
  ctx.lineWidth = Math.max(1, k * 0.6);
  ctx.beginPath(); ctx.moveTo(0, floor + 12 * k); ctx.lineTo(W, floor + 12 * k); ctx.stroke();
  const r = Object.create((rm ? RemasteredRenderer : Renderer).prototype);
  Object.assign(r, { ctx, canvas: cv, alpha: 1, s: k, tx: W / 2, ty: floor, look: { theme: THEME }, lights: { add() {} }, figure: null });
  const game = { rules: { teams: true }, tick: 0 };
  const gap = Math.min(30, (W / k) * 0.22);
  const list = pair
    ? [stand(1, 1, -gap, 1, skin), stand(2, 2, gap, -1, skin, { armour: 50, body: { onGround: true, vx: 0, vy: 0, crouching: false, jetting: false, hasJetpack: true, rope: null } })]
    : [stand(1, 1, 0, 1, skin)];
  ctx.setTransform(k, 0, 0, k, W / 2, floor);
  if (rm) for (const s of list) r.drawSoldier(game, s, 1);
  else r.drawFigures(game, list, 1);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
