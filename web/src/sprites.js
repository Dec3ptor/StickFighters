// Small drawings: weapons (in hand and lying on the map), projectiles, animals,
// crates and pickups. Everything is drawn in code, centred on the origin and
// facing right; callers flip and rotate.

const INK = '#111';

// Shapes drawn as a few circles or lines: [x, y, r] or x positions, flat (made once).
const SHEEP_PUFFS = [-4, 0, 3, -1, -2, 3.2, 2, 0, 3, -1, 1.5, 3];
const SENTRY_PUFFS = [-5, 0, 3.7, -1.2, -2.4, 3.9, 2.6, 0, 3.7, -1.2, 1.9, 3.7];
const SENTRY_LEGS = [-5.2, -2.6, 1.2, 3.6];
const SENTRY_RIVETS = [-5.6, -2.6, 0.6, 3.6];
const COW_LEGS = [-5, -2, 3, 5];
const DONKEY_LEGS = [-10, -5, 1, 5];
const JETPACK_TANKS = [-4, 1];
const AMMO_SHELLS = [-4, -1, 2];

/** Circles (x, y, r triples from `puffs`) filled and outlined one by one. */
function puffs(ctx, list) {
  for (let i = 0; i < list.length; i += 3) { ctx.beginPath(); ctx.arc(list[i], list[i + 1], list[i + 2], 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
}

// A sprite in someone's hand (only read, never changed).
const HELD = { held: true };

// drawSprite's options, filled in again for each call that uses spriteOpts() (no new object each time).
const OPTS = { t: 0, lit: undefined, armed: undefined, collar: undefined, held: undefined };

/** Options for drawSprite: { t, lit, armed, collar } in one object used again (use it straight away). */
export function spriteOpts(t, lit, armed, collar) {
  OPTS.t = t; OPTS.lit = lit; OPTS.armed = armed; OPTS.collar = collar; OPTS.held = undefined;
  return OPTS;
}

/** A weapon drawn along +x from the grip. `lying` = drawn as a pickup (centred). */
export function drawWeapon(ctx, def, lying) {
  const look = def.look;
  const L = look.length || 12;
  if (look.type === 'held' || look.type === 'radio' || look.type === 'glove') {
    ctx.save();
    if (!lying) ctx.translate(6, 0);
    if (look.type === 'radio') drawRadio(ctx, look.color);
    else if (look.type === 'glove') drawGlove(ctx, look.color);
    else drawSprite(ctx, look.sprite, HELD);
    ctx.restore();
    return;
  }
  if (lying) ctx.translate(-L / 2, 0);
  ctx.fillStyle = look.color;
  switch (look.type) {
    case 'pistol':
      ctx.fillRect(4, -1.6, L - 3, 2.8);
      ctx.fillRect(4, 0, 2.2, 3.8);
      break;
    case 'smg':
      ctx.fillRect(-2, -1.3, L + 2, 2.6);
      ctx.fillRect(1, 1.1, 1.8, 3.2);
      ctx.fillRect(6, 1.1, 2, 4.5);
      break;
    case 'rifle':
      ctx.fillRect(-2, -1.3, L + 2, 2.6);
      ctx.fillRect(1, 1.1, 1.8, 3.2);
      ctx.fillRect(8, 1.1, 2, 3.5);
      ctx.fillRect(-5, -1.3, 3, 3.4);
      break;
    case 'ak':
      // A wooden stock and grip, a curved magazine, the gas tube over the barrel.
      ctx.fillRect(-1, -1.3, L + 1, 2.4);
      ctx.fillRect(4, -2.4, L - 9, 1.2);
      ctx.fillStyle = '#7a4a24';
      ctx.fillRect(-6, -1.4, 5, 3.2);
      ctx.fillRect(1, 1, 1.8, 3.2);
      ctx.fillRect(11, -1.2, 4, 2.2);
      ctx.fillStyle = look.color;
      ctx.beginPath();
      ctx.moveTo(6, 1); ctx.lineTo(8.6, 1); ctx.quadraticCurveTo(9.6, 4, 11, 6); ctx.lineTo(8.6, 6.6); ctx.quadraticCurveTo(7.4, 4.2, 6, 1);
      ctx.fill();
      break;
    case 'knife':
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(0, -1.1, 4, 2.2);
      ctx.fillStyle = '#555';
      ctx.fillRect(4, -2, 1, 4);
      ctx.fillStyle = look.color;
      ctx.beginPath();
      ctx.moveTo(5, -1.2); ctx.lineTo(L, -1.2); ctx.lineTo(L + 2.4, 0.2); ctx.lineTo(5, 1.2); ctx.closePath();
      ctx.fill();
      break;
    case 'shotgun':
      ctx.fillRect(-3, -1.3, L + 3, 2.6);
      ctx.fillStyle = '#3a2e22';
      ctx.fillRect(7, 1.1, 6, 1.6);
      ctx.fillRect(-1, 1.1, 1.8, 3);
      break;
    case 'sniper':
      ctx.fillRect(-4, -1.2, L + 4, 2.4);
      ctx.fillStyle = '#222';
      ctx.fillRect(4, -3.6, 8, 2);
      ctx.fillRect(-1, 1.2, 1.8, 3);
      ctx.fillRect(-6, -1.4, 3, 3.6);
      break;
    case 'launcher':
      ctx.fillRect(0, -2, L, 4);
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(4, -2.6, 6, 5.2);
      ctx.fillRect(1, 2, 1.8, 3);
      break;
    case 'tube':
      ctx.fillRect(-6, -2, L + 6, 4);
      ctx.fillStyle = '#2b3d1d';
      ctx.fillRect(-7, -2.8, 2, 5.6);
      ctx.fillRect(L - 2, -2.6, 2.5, 5.2);
      ctx.fillStyle = '#333';
      ctx.fillRect(4, 2, 1.6, 3);
      break;
    case 'flamer':
      ctx.fillRect(0, -1.6, L, 2.6);
      ctx.fillStyle = '#b8321c';
      ctx.fillRect(1, 1, 8, 3.6);
      ctx.fillStyle = '#333';
      ctx.fillRect(L - 2, -2, 2.5, 3.6);
      break;
    case 'minigun':
      ctx.fillRect(-4, -3, 10, 6);
      ctx.fillStyle = '#555';
      ctx.fillRect(6, -2.4, L - 6, 1.2);
      ctx.fillRect(6, -0.6, L - 6, 1.2);
      ctx.fillRect(6, 1.2, L - 6, 1.2);
      ctx.fillStyle = '#222';
      ctx.fillRect(L - 1, -3, 1.6, 6);
      ctx.fillRect(0, 3, 2, 3);
      break;
    case 'bow':
      ctx.strokeStyle = look.color;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(1, 0, 9, -1.25, 1.25); ctx.stroke();
      ctx.strokeStyle = '#bbb';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(1 + Math.cos(-1.25) * 9, Math.sin(-1.25) * 9); ctx.lineTo(1 + Math.cos(1.25) * 9, Math.sin(1.25) * 9); ctx.stroke();
      break;
    case 'wand':
      ctx.fillRect(2, -0.8, L - 2, 1.6);
      ctx.fillStyle = '#e8d24a';
      ctx.beginPath(); ctx.arc(L, 0, 1.8, 0, Math.PI * 2); ctx.fill();
      break;
    case 'sledge':
      // A wooden handle with a heavy steel head across its end.
      ctx.fillRect(0, -0.8, L, 1.6);
      ctx.fillStyle = '#5d6168';
      ctx.fillRect(L - 2, -4.6, 5, 9.2);
      ctx.fillStyle = '#80868e';
      ctx.fillRect(L - 2, -4.6, 1.4, 9.2);
      break;
    case 'bat':
      ctx.beginPath();
      ctx.moveTo(0, -0.9); ctx.lineTo(L, -2.2); ctx.lineTo(L, 2.2); ctx.lineTo(0, 0.9); ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#7a5530'; ctx.lineWidth = 0.5; ctx.stroke();
      break;
    case 'axe':
      ctx.fillRect(0, -0.8, L, 1.6);
      ctx.fillStyle = '#9aa0a6';
      ctx.beginPath(); ctx.moveTo(L - 4, -1); ctx.lineTo(L - 1, -6); ctx.lineTo(L + 2, -5); ctx.lineTo(L + 1, 1); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#555'; ctx.lineWidth = 0.5; ctx.stroke();
      break;
    default:
      ctx.fillRect(0, -1.3, L, 2.6);
  }
}

function drawRadio(ctx, color) {
  ctx.fillStyle = color || '#444';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.rect(-3, -4, 6, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ddd';
  ctx.fillRect(-2, -3, 4, 2);
  ctx.strokeStyle = '#222';
  ctx.beginPath(); ctx.moveTo(2, -4); ctx.lineTo(3, -9); ctx.stroke();
}

function drawGlove(ctx, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.arc(1, 0, 3.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillRect(-3.5, -2, 2.5, 4);
}

/**
 * Projectiles, animals and held items. opts: { t (ticks, for animation), held, armed, lit }.
 */
export function drawSprite(ctx, name, opts = {}) {
  const t = opts.t || 0;
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = INK;
  switch (name) {
    case 'grenade':
      ctx.fillStyle = '#2b2b2b';
      ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, Math.PI * 2); ctx.fill();
      if (opts.lit) { ctx.fillStyle = '#ff3b2f'; ctx.beginPath(); ctx.arc(0, -2.5, 1.2, 0, Math.PI * 2); ctx.fill(); }
      break;
    case 'hegrenade':
      // A frag grenade: olive body, lever and pin.
      ctx.fillStyle = '#4f5a2e';
      ctx.beginPath(); ctx.ellipse(0, 0.5, 2.6, 3.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#9a9a8a';
      ctx.fillRect(-1, -3.8, 2, 1.4);
      ctx.fillRect(1, -3.6, 1.2, 3);
      if (opts.lit) { ctx.fillStyle = '#ff3b2f'; ctx.fillRect(-0.4, -4.4, 0.8, 0.8); }
      break;
    case 'flashbang':
      ctx.fillStyle = '#c9ccd1';
      ctx.beginPath(); ctx.rect(-1.9, -3.6, 3.8, 7.2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#5a6068';
      ctx.fillRect(-1.9, -1.2, 3.8, 0.9);
      ctx.fillRect(-1.9, 1, 3.8, 0.9);
      ctx.fillStyle = '#9a9a8a';
      ctx.fillRect(1.6, -3.4, 1, 3);
      break;
    case 'smokegrenade':
      ctx.fillStyle = '#5d6670';
      ctx.beginPath(); ctx.rect(-2.1, -3.6, 4.2, 7.2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d8dde2';
      ctx.fillRect(-2.1, -0.5, 4.2, 1.2);
      ctx.fillStyle = '#9a9a8a';
      ctx.fillRect(1.8, -3.4, 1, 3);
      break;
    case 'c4':
      // The bomb: a brick of explosive, a keypad with a little screen, wires.
      ctx.fillStyle = '#b8a77a';
      ctx.beginPath(); ctx.rect(-5, -3, 10, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(-3.4, -2.2, 4.4, 4.4);
      ctx.fillStyle = opts.armed && Math.floor(t / 12) % 2 ? '#ff3b2f' : '#7fd36a';
      ctx.fillRect(-2.8, -1.6, 3.2, 1.3);
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(1.4, -2.5); ctx.quadraticCurveTo(3.6, -4.6, 4.4, -1.6); ctx.stroke();
      ctx.strokeStyle = '#2b6fd6';
      ctx.beginPath(); ctx.moveTo(1.4, 2.5); ctx.quadraticCurveTo(3.6, 4.4, 4.4, 1.4); ctx.stroke();
      break;
    case 'bomblet':
      ctx.fillStyle = '#333';
      ctx.beginPath(); ctx.arc(0, 0, 1.9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e33';
      ctx.fillRect(-0.6, -0.6, 1.2, 1.2);
      break;
    case 'cluster':
      ctx.fillStyle = '#5b5b5b';
      ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d22';
      ctx.fillRect(-3.4, -0.8, 6.8, 1.6);
      break;
    case 'banana':
      ctx.strokeStyle = '#e5c21a';
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, -3, 4.5, 0.5, Math.PI - 0.5); ctx.stroke();
      ctx.strokeStyle = '#5a4210';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, -3, 4.5, Math.PI - 0.6, Math.PI - 0.45); ctx.stroke();
      ctx.lineCap = 'butt';
      break;
    case 'holy':
      ctx.fillStyle = '#e2b230';
      ctx.beginPath(); ctx.arc(0, 0.6, 3.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c4921a';
      ctx.fillRect(-0.6, -6.5, 1.2, 4);
      ctx.fillRect(-2, -5.4, 4, 1.1);
      break;
    case 'petrol':
      ctx.fillStyle = 'rgba(80,140,60,0.85)';
      ctx.beginPath(); ctx.rect(-2.2, -2.5, 4.4, 6.5); ctx.fill(); ctx.stroke();
      ctx.fillRect(-0.9, -5, 1.8, 2.6);
      ctx.fillStyle = Math.floor(t / 3) % 2 ? '#ffb31f' : '#ff6a1f';
      ctx.beginPath(); ctx.moveTo(-1, -5); ctx.lineTo(0, -8.5); ctx.lineTo(1, -5); ctx.fill();
      break;
    case 'napalm':
      ctx.fillStyle = '#d2561a';
      ctx.beginPath(); ctx.moveTo(0, 5); ctx.quadraticCurveTo(4, -1, 0, -5); ctx.quadraticCurveTo(-4, -1, 0, 5); ctx.fill(); ctx.stroke();
      break;
    case 'skunk':
      ctx.fillStyle = '#1c1c1c';
      ctx.beginPath(); ctx.ellipse(0, 0, 4.5, 2.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(-4, -1.6, 7, 1.1);
      ctx.fillStyle = '#1c1c1c';
      ctx.beginPath(); ctx.ellipse(-5, -3, 1.6, 3, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(3.4, -1.2, 1, 1);
      break;
    case 'sheep':
    case 'supersheep': {
      const step = opts.held ? 0 : Math.sin(t * 0.5) * 1.6;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-3, 2); ctx.lineTo(-3 + step, 6);
      ctx.moveTo(3, 2); ctx.lineTo(3 - step, 6);
      ctx.stroke();
      if (name === 'supersheep') {
        ctx.fillStyle = '#d22';
        const flap = Math.sin(t * 0.6) * 1.5;
        ctx.beginPath(); ctx.moveTo(-2, -3); ctx.lineTo(-11, -4 + flap); ctx.lineTo(-10, 1 + flap); ctx.lineTo(-2, 1); ctx.fill();
      }
      ctx.fillStyle = '#fff';
      puffs(ctx, SHEEP_PUFFS);
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.ellipse(5.5, -1.5, 2.3, 1.8, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(6, -2.4, 0.9, 0.9);
      break;
    }
    case 'stampede': {
      // A sheep on a rampage (kill streak reward): running flat out, a red headband,
      // an angry glare, and a stick of dynamite on its back with its fuse fizzing.
      const step = opts.held ? 0 : Math.sin(t * 0.9) * 2;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-3, 2); ctx.lineTo(-3 + step, 6);
      ctx.moveTo(3, 2); ctx.lineTo(3 - step, 6);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      puffs(ctx, SHEEP_PUFFS);
      // The dynamite, strapped across its back.
      ctx.fillStyle = '#c82020';
      ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.rect(-4.6, -6.4, 5.4, 2.2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#555';
      ctx.beginPath(); ctx.moveTo(-4.6, -5.3); ctx.quadraticCurveTo(-6.4, -5.6, -6.8, -7.6); ctx.stroke();
      // The spark at the end of the fuse, flickering.
      const r = 1.1 + Math.abs(Math.sin(t * 1.7)) * 0.9;
      ctx.fillStyle = Math.floor(t / 2) % 2 ? '#ffd23a' : '#ff6a1f';
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + t * 0.3, rr = i % 2 ? r * 0.4 : r; ctx.lineTo(-6.8 + Math.cos(a) * rr, -7.6 + Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill();
      // Head, the red headband (its ends streaming out behind), and a red eye under a frown.
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.ellipse(5.5, -1.5, 2.3, 1.8, 0.3, 0, Math.PI * 2); ctx.fill();
      const flap = Math.sin(t * 0.8) * 0.7;
      ctx.strokeStyle = '#e02a20';
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(3.5, -2.3); ctx.quadraticCurveTo(5.4, -3.6, 7.3, -2.6); ctx.stroke();
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(3.6, -2.4); ctx.lineTo(1.2, -3.6 + flap);
      ctx.moveTo(3.6, -2.3); ctx.lineTo(1.6, -2.4 + flap * 0.6);
      ctx.stroke();
      ctx.fillStyle = '#ff3b2f';
      ctx.fillRect(6.3, -1.5, 1, 0.9);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 0.45;
      ctx.beginPath(); ctx.moveTo(5.7, -2); ctx.lineTo(7.4, -1.5); ctx.stroke();
      break;
    }
    case 'sentry': {
      // A Sentry Sheep's body (kill streak reward): a big sheep standing its ground, with
      // a steel helmet, a steel plate over its back, and a collar (opts.collar: its side's
      // colour). The gun turret on its back is drawn on top by the renderer (it aims anywhere).
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let i = 0; i < SENTRY_LEGS.length; i++) { const x = SENTRY_LEGS[i]; ctx.moveTo(x, 2.5); ctx.lineTo(x + (x < 0 ? -0.4 : 0.4), 7.5); }
      ctx.stroke();
      ctx.lineWidth = 0.9;
      ctx.fillStyle = '#fff';
      puffs(ctx, SENTRY_PUFFS);
      // The steel plate over its back, riveted, with a band in its side's colour along the bottom.
      const side = opts.collar || '#e0a020';
      ctx.fillStyle = '#8d949c';
      ctx.beginPath(); ctx.moveTo(-9, 0.6); ctx.quadraticCurveTo(-1, -12.6, 7, 0.6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = side;
      ctx.fillRect(-8, -0.8, 14, 1.4);
      ctx.stroke();
      ctx.strokeStyle = '#c9ced4';
      ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(-6.4, -2); ctx.quadraticCurveTo(-1, -9.6, 4.4, -2); ctx.stroke();
      ctx.fillStyle = '#3a3e44';
      for (let i = 0; i < SENTRY_RIVETS.length; i++) ctx.fillRect(SENTRY_RIVETS[i] - 0.4, -2.2, 0.8, 0.8);
      // The head under its helmet, and the collar round its neck.
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.ellipse(7.2, -1.4, 2.9, 2.2, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(7.9, -1.5, 1, 1);
      ctx.fillStyle = '#8d949c';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(7, -2.1, 3.1, Math.PI * 1.02, Math.PI * 1.98); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#5d636b';
      ctx.fillRect(3.8, -2.4, 6.6, 0.9);
      ctx.strokeStyle = side;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(4.9, -1.4); ctx.lineTo(5.4, 1.2); ctx.stroke();
      break;
    }
    case 'oldwoman': {
      const step = opts.held ? 0 : Math.sin(t * 0.3) * 1.5;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-1, 3); ctx.lineTo(-1 + step, 8); ctx.moveTo(1, 3); ctx.lineTo(1 - step, 8); ctx.stroke();
      ctx.fillStyle = '#8a4fb0';
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(-4, 4); ctx.lineTo(4, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, -7.5, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ccc';
      ctx.beginPath(); ctx.arc(-1.6, -9, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#6b4a2a';
      ctx.beginPath(); ctx.moveTo(3, -2); ctx.lineTo(4.5, 8); ctx.stroke();
      break;
    }
    case 'cow': {
      const step = opts.held ? 0 : Math.sin(t * 0.55) * 1.6;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < COW_LEGS.length; i++) { const x = COW_LEGS[i]; ctx.moveTo(x, 2); ctx.lineTo(x + (x < 0 ? step : -step), 6); }
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.rect(-7, -4, 13, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#222';
      ctx.fillRect(-5, -3, 3, 3); ctx.fillRect(1, -1, 3, 3);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.rect(5, -6, 4.5, 4.5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e8a0a0';
      ctx.fillRect(7.5, -3.2, 2, 1.6);
      ctx.strokeStyle = '#999';
      ctx.beginPath(); ctx.moveTo(6, -6); ctx.lineTo(5, -8); ctx.moveTo(8.5, -6); ctx.lineTo(9.5, -8); ctx.stroke();
      break;
    }
    case 'dynamite':
      ctx.fillStyle = '#c82020';
      ctx.beginPath(); ctx.rect(-2, -5, 4, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#555';
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.quadraticCurveTo(2, -7, 1.5, -8.5); ctx.stroke();
      break;
    case 'mine':
      ctx.fillStyle = '#3d4a2e';
      ctx.beginPath(); ctx.ellipse(0, 1, 4.5, 2.4, 0, Math.PI, 0); ctx.fill(); ctx.stroke();
      ctx.fillStyle = opts.armed ? (Math.floor(t / 15) % 2 ? '#f22' : '#600') : '#9a9a9a';
      ctx.fillRect(-0.8, -1.8, 1.6, 1.4);
      break;
    case 'donkey':
      ctx.fillStyle = '#9a9a9a';
      ctx.strokeStyle = '#444';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.rect(-12, -6, 20, 10); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.rect(6, -14, 8, 10); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(7, -14); ctx.lineTo(6, -20); ctx.lineTo(9, -14); ctx.moveTo(11, -14); ctx.lineTo(12, -20); ctx.lineTo(13, -14); ctx.fill(); ctx.stroke();
      for (let i = 0; i < DONKEY_LEGS.length; i++) ctx.fillRect(DONKEY_LEGS[i], 4, 3, 7);
      ctx.fillStyle = '#333';
      ctx.fillRect(11, -11, 1.4, 1.4);
      break;
    case 'quake':
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(-1, -2, 1.6, 9);
      ctx.fillStyle = '#666';
      ctx.beginPath(); ctx.rect(-4, -5, 8, 4); ctx.fill(); ctx.stroke();
      break;
    case 'teleport':
      ctx.fillStyle = '#5a3f9a';
      ctx.beginPath(); ctx.rect(-2.5, -3.5, 5, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c9b6ff';
      ctx.beginPath(); ctx.arc(0, -1, 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#5a3f9a';
      ctx.beginPath(); ctx.moveTo(0, -3.5); ctx.lineTo(0, -7); ctx.stroke();
      break;
    case 'hammer':
      // The Engineer's Builder: a hammer.
      ctx.fillStyle = '#8a6a3a';
      ctx.fillRect(-4, -0.9, 11, 1.8);
      ctx.fillStyle = '#777';
      ctx.beginPath(); ctx.rect(5, -4.5, 3.4, 9); ctx.fill(); ctx.stroke();
      ctx.fillRect(8.4, -4.5, 1.6, 3);
      break;
    case 'kamikaze':
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.rect(-4, -3, 8, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d22';
      ctx.beginPath(); ctx.arc(0, 0, 1.8, 0, Math.PI * 2); ctx.fill();
      break;
    case 'rope':
      ctx.strokeStyle = '#8a6a3a';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#666';
      ctx.beginPath(); ctx.moveTo(3, -2); ctx.lineTo(6, -5); ctx.lineTo(7.5, -3.5); ctx.stroke();
      break;
    default:
      ctx.fillStyle = '#444';
      ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
  }
}

export function drawHealth(ctx) {
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#c22';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.rect(-6, -6, 12, 12); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#d21f1f';
  ctx.fillRect(-1.6, -4.4, 3.2, 8.8);
  ctx.fillRect(-4.4, -1.6, 8.8, 3.2);
}

export function drawArmour(ctx) {
  ctx.fillStyle = '#7d7d7d';
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-6, -6); ctx.lineTo(-2.5, -6); ctx.lineTo(0, -3.5); ctx.lineTo(2.5, -6); ctx.lineTo(6, -6);
  ctx.lineTo(6.5, 6); ctx.lineTo(-6.5, 6); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#555';
  ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.moveTo(-4, 3); ctx.lineTo(4, 3); ctx.stroke();
}

export function drawJetpack(ctx) {
  ctx.fillStyle = '#5b5b5b';
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < JETPACK_TANKS.length; i++) { ctx.beginPath(); ctx.rect(JETPACK_TANKS[i], -7, 3.5, 11); ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = '#ff8a1f';
  ctx.fillRect(-3.6, 4.5, 2.6, 1.6);
  ctx.fillRect(1.4, 4.5, 2.6, 1.6);
}

/** A supply crate (with a parachute while it's coming down). */
export function drawCrate(ctx, crate, t) {
  if (crate.streak) { drawSupplyDrop(ctx, crate, t); return; }
  if (!crate.landed) {
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(-7, -7); ctx.lineTo(-11, -22); ctx.moveTo(7, -7); ctx.lineTo(11, -22); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    const sway = Math.sin(t * 0.05) * 1.5;
    ctx.beginPath(); ctx.moveTo(-15 + sway, -21); ctx.quadraticCurveTo(sway, -36, 15 + sway, -21); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = crate.health ? '#fff' : '#c9a36b';
  ctx.strokeStyle = crate.health ? '#c22' : '#6b4a2a';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.rect(-7, -7, 14, 14); ctx.fill(); ctx.stroke();
  if (crate.health) {
    ctx.fillStyle = '#d21f1f';
    ctx.fillRect(-1.6, -5, 3.2, 10); ctx.fillRect(-5, -1.6, 10, 3.2);
  } else {
    ctx.beginPath(); ctx.moveTo(-7, -7); ctx.lineTo(7, 7); ctx.moveTo(7, -7); ctx.lineTo(-7, 7); ctx.stroke();
    ctx.fillStyle = '#4a3218';
    ctx.font = 'bold 8px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, 0.5);
  }
}

/**
 * The kill streak badge's flame, centred at (x, y): orange from 3 kills in a row, bigger
 * and redder from 5.
 */
export function drawStreakFlame(ctx, x, y, big) {
  const k = big ? 1.3 : 1;
  ctx.fillStyle = big ? '#ff4a1a' : '#f08a1c';
  ctx.beginPath();
  ctx.moveTo(x + 0.3 * k, y - 3.6 * k);
  ctx.quadraticCurveTo(x + 2.6 * k, y - 0.6 * k, x + 1.8 * k, y + 1.8 * k);
  ctx.quadraticCurveTo(x, y + 3.2 * k, x - 1.8 * k, y + 1.8 * k);
  ctx.quadraticCurveTo(x - 2.4 * k, y - 0.6 * k, x - 0.9 * k, y - 2 * k);
  ctx.quadraticCurveTo(x - 0.6 * k, y - 0.6 * k, x + 0.3 * k, y - 3.6 * k);
  ctx.fill();
  ctx.fillStyle = '#ffd23a';
  ctx.beginPath();
  ctx.moveTo(x, y - 0.4 * k);
  ctx.quadraticCurveTo(x + 1.2 * k, y + 1 * k, x, y + 2.3 * k);
  ctx.quadraticCurveTo(x - 1.2 * k, y + 1 * k, x, y - 0.4 * k);
  ctx.fill();
}

const SUPPLY_TEAM = { 1: '#2f6fdb', 2: '#d33b2f' };
const DROP_GOLD = '#f2c230', DROP_RED = '#d8402c';

/**
 * A Supply Drop (kill streak reward): a gold crate with a star on it, under a striped
 * gold and red parachute while it comes down, and a stripe in its team's colour.
 */
function drawSupplyDrop(ctx, crate, t) {
  if (!crate.landed) {
    ctx.strokeStyle = '#8a7a5a';
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(-7, -7); ctx.lineTo(-11, -22); ctx.moveTo(7, -7); ctx.lineTo(11, -22); ctx.moveTo(0, -7); ctx.lineTo(0, -22); ctx.stroke();
    // The canopy in six panels, gold and red (the curve's top edge: y = -21 - 30u(1 - u)).
    const sway = Math.sin(t * 0.05) * 1.5, n = 6;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? DROP_RED : DROP_GOLD;
      ctx.beginPath();
      ctx.moveTo(sway - 15 + 30 * i / n, -21);
      for (let j = 0; j <= 4; j++) { const u = (i + j / 4) / n; ctx.lineTo(sway - 15 + 30 * u, -21 - 30 * u * (1 - u)); }
      ctx.lineTo(sway - 15 + 30 * (i + 1) / n, -21);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-15 + sway, -21); ctx.quadraticCurveTo(sway, -36, 15 + sway, -21); ctx.closePath(); ctx.stroke();
  }
  ctx.fillStyle = DROP_GOLD;
  ctx.strokeStyle = '#7a4e10';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.rect(-7, -7, 14, 14); ctx.fill(); ctx.stroke();
  // The lid in its team's colour (team games).
  const team = SUPPLY_TEAM[crate.team];
  if (team) {
    ctx.fillStyle = team;
    ctx.fillRect(-6.4, -6.4, 12.8, 2.6);
  }
  // A star.
  ctx.fillStyle = DROP_RED;
  ctx.strokeStyle = '#7a1a10';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 1.9 : 4.4;
    ctx.lineTo(Math.cos(a) * r, (team ? 1.2 : 0.4) + Math.sin(a) * r);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
}

/** Gadget drops (classes on): a medkit or an ammo box, edged in its team's colour. */
export function drawSupply(ctx, type, team) {
  const edge = SUPPLY_TEAM[team] || '#333';
  ctx.lineWidth = 1.2;
  if (type === 'medkit') {
    ctx.fillStyle = '#f4f4f4';
    ctx.strokeStyle = edge;
    ctx.beginPath(); ctx.rect(-6.5, -5, 13, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2e9a3e';
    ctx.fillRect(-1.4, -3.6, 2.8, 7.2);
    ctx.fillRect(-3.6, -1.4, 7.2, 2.8);
    ctx.strokeStyle = '#555';
    ctx.beginPath(); ctx.moveTo(-2.5, -5); ctx.lineTo(-2.5, -7); ctx.lineTo(2.5, -7); ctx.lineTo(2.5, -5); ctx.stroke();
  } else {
    ctx.fillStyle = '#6b6b3a';
    ctx.strokeStyle = edge;
    ctx.beginPath(); ctx.rect(-7, -4.5, 14, 9); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d9b44a';
    for (let i = 0; i < AMMO_SHELLS.length; i++) ctx.fillRect(AMMO_SHELLS[i], -3, 2, 4);
    ctx.fillStyle = '#3d3d20';
    ctx.fillRect(-7, 2, 14, 1.2);
  }
}

/** A spawn beacon: a little tripod with a blinking light in its team's colour (and its health, once hit). */
export function drawBeacon(ctx, b, t, hpFrac = 1) {
  const color = SUPPLY_TEAM[b.team] || '#333';
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-4, 0); ctx.lineTo(0, -9); ctx.lineTo(4, 0);
  ctx.moveTo(0, -9); ctx.lineTo(0, -13);
  ctx.stroke();
  ctx.fillStyle = '#555';
  ctx.fillRect(-2.5, -11, 5, 3);
  const on = Math.floor(t / 20) % 2 === 0;
  ctx.fillStyle = on ? color : '#ccc';
  ctx.beginPath(); ctx.arc(0, -14, 1.8, 0, Math.PI * 2); ctx.fill();
  if (hpFrac < 1) {
    ctx.fillStyle = '#ddd';
    ctx.fillRect(-6, -19, 12, 1.6);
    ctx.fillStyle = hpFrac > 0.4 ? '#555' : '#c22';
    ctx.fillRect(-6, -19, 12 * Math.max(0, hpFrac), 1.6);
  }
}
