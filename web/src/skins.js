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
// Worlds' monsters' looks (world/monsters.js: not ones to pick in Settings).
export const MONSTER_SKINS = ['zombie', 'skeleton', 'brute'];
// Worlds' townsfolk (world/townsfolk.js), one look for each kind of work, each with a tunic in
// its own colour (also their name tag's colour in Remastered).
export const TOWN_SKINS = ['villager', 'farmer', 'elder', 'merchant', 'smith', 'gunsmith', 'innkeeper', 'healer', 'guard', 'lord', 'trader'];
export const TUNICS = {
  villager: '#8a6a4a', farmer: '#6f8a3a', elder: '#6a5a8a', merchant: '#2e8b57', smith: '#5a4636', gunsmith: '#4f5a46',
  innkeeper: '#a0522d', healer: '#e8e0c8', guard: '#3a5fa8', lord: '#8e1f3a', trader: '#c07a1a',
};
const IDS = new Set([...SKINS.map(s => s.id), ...MONSTER_SKINS, ...TOWN_SKINS]);

/** Whether a skin id is one of them. */
export const isSkin = id => typeof id === 'string' && IDS.has(id);

/** The skin to draw a soldier with, in a game whose own is `own` ('classic' or 'soldier'). */
export const skinFor = (s, own) => (s.skin && s.skin !== 'auto' && IDS.has(s.skin) ? s.skin : own);

/** Each skin's own colour, in free-for-all in the original (no team colours there). */
export const SKIN_ACCENT = { classic: '#111111', soldier: '#3d7ff0', ninja: '#c8282e', robot: '#25b8e0', cowboy: '#c8282e', knight: '#c8282e', zombie: '#4f7a34', skeleton: '#d8d4c8', brute: '#8a2a1a', ...TUNICS };

const HAT = '#6b4423', HAT_DARK = '#4a2e17', STEEL = '#b9c2cb', METAL = '#9aa4ae', SKIN_TONE = '#f0d2b0';
const HAIR = '#5a3a22', GREY = '#e8e6e0', GOLD = '#f2c230', STRAW = '#e2c25a';

/** A face (the townsfolk's: skin-coloured), outlined. */
function face(ctx, h, r) {
  ctx.fillStyle = SKIN_TONE;
  ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}

/** Hair over the top of the head (and down the back, the way they're not facing). */
function hair(ctx, h, r, f, color, long = false) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(h.x, h.y, r, Math.PI * 1.08, Math.PI * 1.92);
  ctx.lineTo(h.x + f * r * 0.2, h.y - r * 0.55);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  if (long) {
    ctx.beginPath();
    ctx.moveTo(h.x - f * r * 0.7, h.y - r * 0.7);
    ctx.quadraticCurveTo(h.x - f * (r + 1.6), h.y + 0.5, h.x - f * r * 0.6, h.y + r + 1.2);
    ctx.lineTo(h.x - f * r * 0.2, h.y + r * 0.4);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
}

/** A beard under the chin, on the side they're facing. */
function beard(ctx, h, r, f, color, long = false) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(h.x - f * r * 0.2, h.y + r * 0.35);
  ctx.quadraticCurveTo(h.x + f * r * 0.6, h.y + r * (long ? 1.9 : 1.25), h.x + f * r * 0.95, h.y + r * 0.2);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
}

/** A townsperson's head, by the work they do (TOWN_SKINS). */
function drawTownHead(ctx, h, skin, f, o) {
  const r = h.r, lw = o.lw;
  switch (skin) {
    case 'villager': {
      face(ctx, h, r);
      ctx.lineWidth = Math.min(lw, 0.9);
      hair(ctx, h, r, f, HAIR);
      break;
    }
    case 'farmer': {
      // A straw hat: a low crown and a wide, drooping brim.
      face(ctx, h, r);
      ctx.lineWidth = Math.min(lw, 0.9);
      const brim = h.y - r * 0.5;
      ctx.fillStyle = STRAW;
      ctx.beginPath(); ctx.ellipse(h.x, brim - 1.4, r * 0.7, 2.4, 0, Math.PI, 0); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(h.x - r - 3.2, brim + 0.8); ctx.quadraticCurveTo(h.x, brim - 1.8, h.x + r + 3.2, brim + 0.8);
      ctx.quadraticCurveTo(h.x, brim + 0.4, h.x - r - 3.2, brim + 0.8);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#a0522d';
      ctx.fillRect(h.x - r * 0.68, brim - 1.3, r * 1.36, 0.9);
      break;
    }
    case 'elder': {
      // White hair down the back, and a long white beard.
      face(ctx, h, r);
      ctx.lineWidth = Math.min(lw, 0.9);
      hair(ctx, h, r, f, GREY, true);
      beard(ctx, h, r, f, GREY, true);
      break;
    }
    case 'merchant': {
      // A soft cap with a feather.
      face(ctx, h, r);
      ctx.lineWidth = Math.min(lw, 0.9);
      ctx.fillStyle = '#2e8b57';
      ctx.beginPath();
      ctx.moveTo(h.x - r * 1.05, h.y - r * 0.35);
      ctx.quadraticCurveTo(h.x - r * 0.9, h.y - r * 1.75, h.x + f * r * 0.4, h.y - r * 1.45);
      ctx.quadraticCurveTo(h.x + r * 1.2, h.y - r * 1.2, h.x + r * 1.05, h.y - r * 0.35);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#d8342c';
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(h.x - f * r * 0.5, h.y - r * 1.3); ctx.quadraticCurveTo(h.x - f * (r + 1), h.y - r * 2.4, h.x - f * (r + 3), h.y - r * 2.1); ctx.stroke();
      break;
    }
    case 'smith': {
      // A headband over short dark hair, and a short dark beard.
      face(ctx, h, r);
      ctx.lineWidth = Math.min(lw, 0.9);
      hair(ctx, h, r, f, '#2a1e16');
      beard(ctx, h, r, f, '#2a1e16');
      ctx.strokeStyle = '#b8302a';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(h.x - r * 0.95, h.y - r * 0.38); ctx.lineTo(h.x + r * 0.95, h.y - r * 0.38); ctx.stroke();
      break;
    }
    case 'gunsmith': {
      // Goggles pushed up on the forehead.
      face(ctx, h, r);
      ctx.lineWidth = Math.min(lw, 0.9);
      hair(ctx, h, r, f, '#6b4a2a');
      ctx.strokeStyle = '#2a2a2a';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(h.x - r * 0.98, h.y - r * 0.5); ctx.lineTo(h.x + r * 0.98, h.y - r * 0.5); ctx.stroke();
      ctx.fillStyle = '#7fc8e8';
      ctx.lineWidth = 0.7;
      for (const dx of [0.15, 0.75]) { ctx.beginPath(); ctx.arc(h.x + f * r * dx, h.y - r * 0.55, 1.25, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      break;
    }
    case 'innkeeper': {
      // Bald, with a big moustache.
      face(ctx, h, r);
      ctx.fillStyle = '#6b3a1e';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(h.x + f * r * 0.05, h.y + r * 0.2);
      ctx.quadraticCurveTo(h.x + f * r * 0.6, h.y + r * 0.62, h.x + f * r * 1.15, h.y + r * 0.25);
      ctx.quadraticCurveTo(h.x + f * r * 0.6, h.y + r * 0.12, h.x + f * r * 0.05, h.y + r * 0.2);
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'healer': {
      // A pale hood round the face.
      ctx.fillStyle = '#efe8d4';
      ctx.lineWidth = Math.min(lw, 0.9);
      ctx.beginPath(); ctx.arc(h.x - f * 0.6, h.y - 0.4, r + 1.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = SKIN_TONE;
      ctx.beginPath(); ctx.arc(h.x + f * 0.7, h.y + 0.3, r * 0.68, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c83c3c';
      ctx.fillRect(h.x - f * 2.2 - 0.5, h.y - r - 0.6, 1, 2.6);
      ctx.fillRect(h.x - f * 2.2 - 1.3, h.y - r + 0.2, 2.6, 1);
      break;
    }
    case 'guard': {
      // A steel kettle helmet: a dome and a wide brim.
      face(ctx, h, r);
      ctx.lineWidth = Math.min(lw, 0.9);
      ctx.fillStyle = STEEL;
      ctx.beginPath(); ctx.arc(h.x, h.y - r * 0.35, r * 0.95, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(h.x - r - 2.6, h.y - r * 0.2); ctx.lineTo(h.x + r + 2.6, h.y - r * 0.2);
      ctx.lineTo(h.x + r + 1.8, h.y - r * 0.2 + 1.3); ctx.lineTo(h.x - r - 1.8, h.y - r * 0.2 + 1.3);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#3a5fa8';
      ctx.fillRect(h.x - r * 0.9, h.y - r * 0.62, r * 1.8, 0.9);
      break;
    }
    case 'lord': {
      // A gold crown on dark hair, and a neat beard.
      face(ctx, h, r);
      ctx.lineWidth = Math.min(lw, 0.9);
      hair(ctx, h, r, f, '#3a2a1a');
      beard(ctx, h, r, f, '#3a2a1a');
      const by = h.y - r * 0.55, w = r * 0.9;
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.moveTo(h.x - w, by); ctx.lineTo(h.x - w, by - 3.4); ctx.lineTo(h.x - w * 0.5, by - 1.8); ctx.lineTo(h.x, by - 4); ctx.lineTo(h.x + w * 0.5, by - 1.8); ctx.lineTo(h.x + w, by - 3.4); ctx.lineTo(h.x + w, by);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d8342c';
      ctx.fillRect(h.x - 0.6, by - 1.6, 1.2, 1.2);
      break;
    }
    case 'trader': {
      // A wrapped turban with a jewel at the front.
      face(ctx, h, r);
      ctx.lineWidth = Math.min(lw, 0.9);
      ctx.fillStyle = '#e8dcc0';
      ctx.beginPath(); ctx.ellipse(h.x - f * 0.3, h.y - r * 0.7, r * 1.15, r * 0.75, 0, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(h.x - f * 0.3, h.y - r * 0.55, r * 1.1, r * 0.32, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2f62ee';
      ctx.beginPath(); ctx.arc(h.x + f * r * 0.55, h.y - r * 0.62, 0.9, 0, Math.PI * 2); ctx.fill();
      break;
    }
  }
}

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
    case 'zombie': {
      // Green, with dark eyes and a slack mouth.
      ctx.fillStyle = '#8db36a';
      ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = o.ink;
      ctx.fillRect(h.x + f * 0.4 - 0.7, h.y - 1.6, 1.4, 1.4);
      ctx.fillRect(h.x + f * 2.4 - 0.7, h.y - 1.3, 1.4, 1.4);
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(h.x + f * 0.2, h.y + 1.6); ctx.lineTo(h.x + f * 2.9, h.y + 1.1); ctx.stroke();
      break;
    }
    case 'skeleton': {
      // A skull: pale, with dark eye sockets and teeth.
      ctx.fillStyle = '#f2efe6';
      ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = o.ink;
      ctx.beginPath(); ctx.arc(h.x + f * 0.5, h.y - 0.8, 1.1, 0, Math.PI * 2); ctx.arc(h.x + f * 2.6, h.y - 0.6, 1, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) { const tx = h.x + f * (0.6 + i * 0.9); ctx.moveTo(tx, h.y + 1.4); ctx.lineTo(tx, h.y + 2.6); }
      ctx.stroke();
      break;
    }
    case 'brute': {
      // Big, red, horned, scowling.
      const R = r * 1.25;
      ctx.fillStyle = '#b5523a';
      ctx.beginPath();
      ctx.moveTo(h.x - R * 0.6, h.y - R * 0.6); ctx.lineTo(h.x - R * 0.9, h.y - R * 1.5); ctx.lineTo(h.x - R * 0.15, h.y - R * 0.9);
      ctx.moveTo(h.x + R * 0.6, h.y - R * 0.6); ctx.lineTo(h.x + R * 0.9, h.y - R * 1.5); ctx.lineTo(h.x + R * 0.15, h.y - R * 0.9);
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(h.x, h.y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = o.ink;
      ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(h.x + f * 0.2, h.y - 2.2); ctx.lineTo(h.x + f * 2.6, h.y - 1.2); ctx.stroke();
      ctx.fillStyle = '#ffd040';
      ctx.fillRect(h.x + f * 1.6 - 0.6, h.y - 1, 1.2, 1.2);
      break;
    }
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
    case 'villager': case 'farmer': case 'elder': case 'merchant': case 'smith': case 'gunsmith':
    case 'innkeeper': case 'healer': case 'guard': case 'lord': case 'trader':
      drawTownHead(ctx, h, skin, f, o);
      break;
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

/** A townsperson's tunic (TUNICS): the torso drawn thick in their colour, neck to waist. */
export function drawTunic(ctx, torso, color, width) {
  const [x0, y0, x1, y1] = torso;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0 + (x1 - x0) * 0.1, y0 + (y1 - y0) * 0.1);
  ctx.lineTo(x0 + (x1 - x0) * 0.92, y0 + (y1 - y0) * 0.92);
  ctx.stroke();
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
