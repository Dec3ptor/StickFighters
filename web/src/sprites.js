// Small drawings: weapons (in hand and lying on the map), projectiles, animals,
// crates and pickups. Everything is drawn in code, centred on the origin and
// facing right; callers flip and rotate.

const INK = '#111';

/** A weapon drawn along +x from the grip. `lying` = drawn as a pickup (centred). */
export function drawWeapon(ctx, def, lying) {
  const look = def.look;
  const L = look.length || 12;
  if (look.type === 'held' || look.type === 'radio' || look.type === 'glove') {
    ctx.save();
    if (!lying) ctx.translate(6, 0);
    if (look.type === 'radio') drawRadio(ctx, look.color);
    else if (look.type === 'glove') drawGlove(ctx, look.color);
    else drawSprite(ctx, look.sprite, { held: true });
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
    case 'prod':
      ctx.fillRect(0, -0.7, L, 1.4);
      ctx.fillStyle = '#c33';
      ctx.fillRect(L - 1, -1.4, 2.5, 2.8);
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
      for (const [x, y, r] of [[-4, 0, 3], [-1, -2, 3.2], [2, 0, 3], [-1, 1.5, 3]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.ellipse(5.5, -1.5, 2.3, 1.8, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(6, -2.4, 0.9, 0.9);
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
      for (const x of [-5, -2, 3, 5]) { ctx.moveTo(x, 2); ctx.lineTo(x + (x < 0 ? step : -step), 6); }
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
      for (const x of [-10, -5, 1, 5]) ctx.fillRect(x, 4, 3, 7);
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
  for (const x of [-4, 1]) { ctx.beginPath(); ctx.rect(x, -7, 3.5, 11); ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = '#ff8a1f';
  ctx.fillRect(-3.6, 4.5, 2.6, 1.6);
  ctx.fillRect(1.4, 4.5, 2.6, 1.6);
}

/** A supply crate (with a parachute while it's coming down). */
export function drawCrate(ctx, crate, t) {
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

const SUPPLY_TEAM = { 1: '#2f6fdb', 2: '#d33b2f' };

/** Gadget drops (classes on): a medkit, an armour pack or an ammo box, edged in its team's colour. */
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
  } else if (type === 'repair') {
    ctx.fillStyle = '#8d8d8d';
    ctx.strokeStyle = edge;
    ctx.beginPath();
    ctx.moveTo(-6, -5); ctx.lineTo(6, -5); ctx.lineTo(5, 3); ctx.lineTo(0, 6); ctx.lineTo(-5, 3); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-3, -1); ctx.lineTo(3, -1); ctx.moveTo(0, -3.5); ctx.lineTo(0, 2); ctx.stroke();
  } else {
    ctx.fillStyle = '#6b6b3a';
    ctx.strokeStyle = edge;
    ctx.beginPath(); ctx.rect(-7, -4.5, 14, 9); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d9b44a';
    for (const x of [-4, -1, 2]) ctx.fillRect(x, -3, 2, 4);
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
