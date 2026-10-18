// Visual-only particles. The game runs fine without them (tests turn them off).

const MAX_PARTICLES = 900;
const MAX_STAINS = 260;

export class Effects {
  constructor() {
    this.parts = [];
    this.stains = [];
  }

  add(p) {
    // (Over the limit, the oldest go at the end of the update: dropping them one
    // at a time is slow when a huge battle adds thousands.)
    this.parts.push(p);
    if (this.parts.length > MAX_PARTICLES * 4) this.trim();
  }

  trim() {
    if (this.parts.length > MAX_PARTICLES) this.parts.splice(0, this.parts.length - MAX_PARTICLES);
  }

  blood(x, y, dirX, dirY, amount) {
    const n = Math.min(14, 2 + Math.round(amount / 4));
    for (let i = 0; i < n; i++) {
      const sp = 1 + Math.random() * 3;
      this.add({
        kind: 'blood', x, y,
        vx: dirX * sp + (Math.random() - 0.5) * 2.2,
        vy: dirY * sp + (Math.random() - 0.5) * 2.2 - 1,
        life: 50 + Math.random() * 30, size: 1 + Math.random() * 1.4,
      });
    }
  }

  sparks(x, y, nx, ny) {
    for (let i = 0; i < 4; i++) {
      this.add({
        kind: 'spark', x, y,
        vx: nx * (1 + Math.random() * 2) + (Math.random() - 0.5) * 2,
        vy: ny * (1 + Math.random() * 2) + (Math.random() - 0.5) * 2,
        life: 10 + Math.random() * 8,
      });
    }
    this.add({ kind: 'puff', x, y, r: 2, life: 16, max: 16 });
  }

  muzzle(x, y, angle, big) {
    this.add({ kind: 'flash', x, y, angle, size: big ? 9 : 6, life: 3 });
  }

  shell(x, y, facing) {
    this.add({
      kind: 'shell', x, y, vx: -facing * (0.8 + Math.random()), vy: -1.5 - Math.random() * 1.5,
      angle: Math.random() * 6, va: (Math.random() - 0.5) * 0.6, life: 70,
    });
  }

  smoke(x, y, r = 3, life = 40) {
    this.add({ kind: 'smoke', x, y, vx: (Math.random() - 0.5) * 0.4, vy: -0.3 - Math.random() * 0.3, r, life, max: life });
  }

  explosion(x, y, radius) {
    this.add({ kind: 'boom', x, y, r: radius, life: 18, max: 18 });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, sp = Math.random() * 2.5;
      this.add({
        kind: 'smoke', x: x + Math.cos(a) * radius * 0.3, y: y + Math.sin(a) * radius * 0.3,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.5, r: 6 + Math.random() * 8, life: 50 + Math.random() * 30, max: 80,
      });
    }
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
      this.add({ kind: 'ember', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, life: 20 + Math.random() * 20 });
    }
  }

  fire(x, y) {
    this.add({ kind: 'fire', x, y, vx: (Math.random() - 0.5) * 0.6, vy: -0.6 - Math.random() * 0.8, r: 2 + Math.random() * 3, life: 18, max: 18 });
  }

  trail(x0, y0, x1, y1) {
    this.add({ kind: 'trail', x: x0, y: y0, x1, y1, life: 22, max: 22 });
  }

  ring(x, y, color) {
    this.add({ kind: 'ring', x, y, color, life: 30, max: 30 });
  }

  /** A cartoon "whack" star where a melee hit lands. */
  whack(x, y) {
    this.add({ kind: 'whack', x, y, life: 12, max: 12, angle: Math.random() });
  }

  /** The magic bullet's trail. */
  sparkle(x, y) {
    this.add({ kind: 'sparkle', x: x + (Math.random() - 0.5) * 3, y: y + (Math.random() - 0.5) * 3, vx: 0, vy: -0.2, life: 22, max: 22 });
  }

  /** One spark (a lit fuse). */
  spark(x, y) {
    this.add({ kind: 'ember', x, y, vx: (Math.random() - 0.5) * 1.2, vy: -0.6 - Math.random(), life: 10 + Math.random() * 6 });
  }

  /** The plane that drops an air strike, flying across above the map. */
  plane(x, y, dir = 1) {
    this.add({ kind: 'plane', x: x - dir * 700, y, vx: dir * 10, life: 140, max: 140 });
  }

  /** Throw the pieces of a dead stick figure around. segs are [x0,y0,x1,y1] in world space. */
  gibs(segs, head, vx, vy, force) {
    for (const [x0, y0, x1, y1] of segs) {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const len = Math.hypot(x1 - x0, y1 - y0);
      this.add({
        kind: 'gib', x: cx, y: cy, len, angle: Math.atan2(y1 - y0, x1 - x0),
        vx: vx + (Math.random() - 0.5) * (2 + force), vy: vy - Math.random() * (1.5 + force),
        va: (Math.random() - 0.5) * 0.5, life: 240, max: 240,
      });
    }
    if (head) {
      this.add({
        kind: 'head', x: head.x, y: head.y, r: head.r,
        vx: vx + (Math.random() - 0.5) * (2 + force), vy: vy - 1 - Math.random() * (2 + force),
        life: 240, max: 240,
      });
    }
  }

  /** dt = game time per update (less than 1 when the game speed is turned down). */
  update(map, dt = 1) {
    const keep = [], drips = [];
    for (const p of this.parts) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.px = p.x; p.py = p.y; // (drawn in between this and the new position)
      switch (p.kind) {
        case 'blood': {
          p.vy += 0.25 * dt;
          const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
          const hit = map.raycast(p.x, p.y, nx, ny);
          if (hit) {
            if (this.stains.length >= MAX_STAINS) this.stains.shift();
            this.stains.push({ x: hit.x, y: hit.y, size: p.size + Math.random(), life: 900 });
            continue;
          }
          p.x = nx; p.y = ny;
          break;
        }
        case 'spark': case 'ember':
          p.vy += 0.15 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.95 ** dt;
          break;
        case 'shell': case 'gib': case 'head': {
          p.vy += 0.3 * dt;
          const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
          const hit = map.raycast(p.x, p.y, nx, ny);
          if (hit) {
            p.x = hit.x + hit.nx * 0.5; p.y = hit.y + hit.ny * 0.5;
            if (hit.nx) p.vx = -p.vx * 0.4; else { p.vy = -p.vy * 0.35; p.vx *= 0.7; }
            if (p.va) p.va *= 0.6;
          } else { p.x = nx; p.y = ny; }
          if (p.va) p.angle += p.va * dt;
          if (p.kind !== 'shell' && Math.random() < 0.05 * dt && p.life > 150) drips.push({ kind: 'blood', x: p.x, y: p.y, vx: 0, vy: 0, life: 40, size: 1 });
          break;
        }
        case 'smoke': case 'fire':
          p.x += p.vx * dt; p.y += p.vy * dt; p.r += 0.12 * dt;
          break;
        case 'puff':
          p.r += 0.4 * dt;
          break;
        case 'plane':
          p.x += p.vx * dt;
          break;
        case 'sparkle':
          p.y += p.vy * dt;
          break;
      }
      keep.push(p);
    }
    this.parts = keep;
    for (const d of drips) this.add(d);
    this.trim();
    for (const s of this.stains) s.life--;
    if (this.stains.length && this.stains[0].life <= 0) this.stains = this.stains.filter(s => s.life > 0);
  }
}
