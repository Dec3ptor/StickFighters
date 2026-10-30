// Character skins: how a soldier looks, picked in Settings (Character). Everyone sees everyone's
// own skin (online too), and in team modes every skin wears its team's colour.
//
// Two kinds of figure: the stick figure (thin lines, a round head: the 2003 game's, and the
// skins that give it a hat or a helmet of some kind), and Remastered's soldier (thicker, shaded,
// with a helmet, vest and backpack). Each game draws its own unless a skin says otherwise, so
// the classic stick figure can run about in Remastered, and Remastered's soldier in the original.

export const SKINS = [
  { id: 'auto', name: 'The game\'s own', blurb: 'The stick figure in the original, the soldier in Remastered.' },
  { id: 'classic', name: 'Classic', blurb: 'The 2003 stick figure: thin lines and a round head.' },
  { id: 'soldier', name: 'Remastered soldier', blurb: 'Helmet in your colour, a vest with armour, a backpack, shading.' },
  { id: 'ninja', name: 'Ninja', blurb: 'A mask, and a headband in your colour, its ends flying behind.' },
  { id: 'robot', name: 'Robot', blurb: 'A boxy metal head, an aerial, and a visor in your colour.' },
  { id: 'cowboy', name: 'Cowboy', blurb: 'A wide-brimmed hat with a band in your colour.' },
  { id: 'knight', name: 'Knight', blurb: 'A steel helm with a plume in your colour.' },
];
const IDS = new Set(SKINS.map(s => s.id));

/** Whether a skin id is one of them. */
export const isSkin = id => typeof id === 'string' && IDS.has(id);

/** The skin to draw a soldier with, in a game whose own is `own` ('classic' or 'soldier'). */
export const skinFor = (s, own) => (s.skin && s.skin !== 'auto' && IDS.has(s.skin) ? s.skin : own);

/** Each skin's own colour, in free-for-all in the original (no team colours there). */
export const SKIN_ACCENT = { classic: '#111111', soldier: '#3d7ff0', ninja: '#c8282e', robot: '#25b8e0', cowboy: '#c8282e', knight: '#c8282e' };

const HAT = '#6b4423', HAT_DARK = '#4a2e17', STEEL = '#b9c2cb', METAL = '#9aa4ae', SKIN_TONE = '#f0d2b0';

/**
 * A stick figure's head, as its skin has it, at the head's place (in the soldier's own units).
 * o: { ink, lw (outline width), fill (the face: the head's colour in the classic look), accent
 * (the team's colour, or the skin's own), tick (for the ninja's flying headband) }.
 * Leaves the line ends round (as the body has them).
 */
export function drawSkinHead(ctx, h, skin, facing, o) {
  const r = h.r, f = facing < 0 ? -1 : 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = o.ink;
  ctx.lineWidth = o.lw;
  switch (skin) {
    case 'ninja': {
      // A mask over the whole head, the eyes showing through a slit, a headband with its ends flying.
      ctx.fillStyle = o.mask || o.ink;
      ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = SKIN_TONE;
      ctx.fillRect(f > 0 ? h.x + 0.2 : h.x - r + 0.6, h.y - 0.9, r - 0.8, 1.5);
      const by = h.y - r * 0.45, half = r * 0.9;
      ctx.strokeStyle = o.accent;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(h.x - half, by); ctx.lineTo(h.x + half, by); ctx.stroke();
      const wave = Math.sin((o.tick || 0) * 0.3);
      const bx = h.x - f * half;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx - f * 2.5, by + 0.5 + wave, bx - f * 5.5, by + 1.6 + wave * 1.2);
      ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx - f * 2, by + 1.5 - wave * 0.6, bx - f * 4.6, by + 3.4 - wave);
      ctx.stroke();
      break;
    }
    case 'robot': {
      // A boxy head, an aerial with a light on top, and a visor where it's looking.
      const s = r + 0.3;
      ctx.beginPath();
      ctx.moveTo(h.x, h.y - s); ctx.lineTo(h.x - f * 1.4, h.y - s - 3.2);
      ctx.stroke();
      ctx.fillStyle = o.metal || METAL;
      ctx.beginPath(); ctx.rect(h.x - s, h.y - s, s * 2, s * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = o.accent;
      ctx.fillRect(f > 0 ? h.x + 0.1 : h.x - s + 0.6, h.y - 1.3, s - 0.7, 2);
      ctx.beginPath(); ctx.arc(h.x - f * 1.4, h.y - s - 3.4, 0.95, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'cowboy': {
      // The face, then a hat: a wide brim and a crown with a band.
      ctx.fillStyle = o.fill;
      ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const brim = h.y - r * 0.45, cw = r * 0.85;
      ctx.fillStyle = HAT;
      ctx.lineWidth = Math.min(o.lw, 0.9);
      // (The crown: dented on top.)
      ctx.beginPath();
      ctx.moveTo(h.x - cw, brim);
      ctx.lineTo(h.x - cw * 0.9, brim - 5);
      ctx.quadraticCurveTo(h.x, brim - 3.8, h.x + cw * 0.9, brim - 5);
      ctx.lineTo(h.x + cw, brim);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = o.accent;
      ctx.fillRect(h.x - cw * 0.97, brim - 1.6, cw * 1.94, 1.2);
      ctx.fillStyle = HAT_DARK;
      ctx.beginPath();
      ctx.moveTo(h.x - r - 3.4, brim - 0.6);
      ctx.quadraticCurveTo(h.x, brim + 1.6, h.x + r + 3.4, brim - 0.6);
      ctx.lineTo(h.x + r + 3, brim + 0.6);
      ctx.quadraticCurveTo(h.x, brim + 2.6, h.x - r - 3, brim + 0.6);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'knight': {
      // A steel helm with a slit to look out of, and a plume in the team's colour.
      ctx.strokeStyle = o.accent;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(h.x - f * 0.4, h.y - r + 0.4);
      ctx.quadraticCurveTo(h.x - f * 1.5, h.y - r - 4.6, h.x - f * (r + 4.2), h.y - r + 1.2);
      ctx.stroke();
      ctx.strokeStyle = o.ink;
      ctx.lineWidth = o.lw;
      ctx.fillStyle = o.steel || STEEL;
      ctx.beginPath(); ctx.arc(h.x, h.y, r + 0.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // (A T-shaped visor, looking the way they face.)
      const vx = h.x + f * r * 0.42;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(h.x - f * 0.6, h.y - 0.6); ctx.lineTo(h.x + f * (r - 0.3), h.y - 0.6);
      ctx.moveTo(vx, h.y - 0.6); ctx.lineTo(vx, h.y + r - 0.6);
      ctx.stroke();
      break;
    }
    default: {
      // The classic round head.
      ctx.fillStyle = o.fill;
      ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

/**
 * The soft outline under a stick figure's head (Remastered draws one round each figure, so it
 * reads against any background): close round the head's own shape, `grow` out from it, in
 * `color`. (Not round a hat, a plume or a headband: that read as a glow.)
 */
export function drawHeadHalo(ctx, h, skin, color, grow) {
  ctx.fillStyle = color;
  ctx.beginPath();
  if (skin === 'robot') {
    const s = h.r + 0.3 + grow;
    ctx.rect(h.x - s, h.y - s, s * 2, s * 2);
  } else ctx.arc(h.x, h.y, h.r + (skin === 'knight' ? 0.2 : 0) + grow, 0, Math.PI * 2);
  ctx.fill();
}

/** Armour on a stick figure with a skin of its own (no room for the classic look's little helmet): a vest. */
export function drawVest(ctx, torso, color, width) {
  const [x0, y0, x1, y1] = torso;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0 + (x1 - x0) * 0.15, y0 + (y1 - y0) * 0.15);
  ctx.lineTo(x0 + (x1 - x0) * 0.62, y0 + (y1 - y0) * 0.62);
  ctx.stroke();
}
