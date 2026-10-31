// Visual-only particles. The game runs fine without them (tests turn them off).

const MAX_PARTICLES = 900;
const MAX_STAINS = 260;
const MAX_SPARE = MAX_PARTICLES * 2; // particles kept to use again

/**
 * A particle. Every one has all these fields, made in this order, so they all share one
 * shape (going through hundreds of them every update and every frame stays quick): what
 * it is (kind: how it moves and is drawn), where it is (x, y) and was at the last update
 * (px, py), its speed (vx, vy), the life it has left and started with (life, max), and
 * what some kinds use: r (radius), size, len (a limb's length), angle and va (its spin),
 * color (a ring's) and x1, y1 (where a trail ends).
 */
export class Particle {
  constructor(kind, x, y) {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.px = x;
    this.py = y;
    this.vx = 0;
    this.vy = 0;
    this.life = 0;
    this.max = 0;
    this.r = 0;
    this.size = 0;
    this.len = 0;
    this.angle = 0;
    this.va = 0;
    this.color = null;
    this.x1 = 0;
    this.y1 = 0;
  }
}

export class Effects {
  constructor() {
    this.parts = [];
    this.stains = [];   // blood on the walls: { x, y, size, life }, oldest first
    this.spare = [];    // particles that are gone, to use again
    this.spareStains = [];
    this.drips = [];    // (blood dripping off the pieces, added after each update)
  }

  /** A new particle of `kind` at (x, y): one that's gone, used again, when there is one. */
  make(kind, x, y) {
    return makeParticle(this.spare, kind, x, y);
  }

  add(p) {
    // (A particle made elsewhere, as a plain object, is copied into one of ours.)
    if (!(p instanceof Particle)) p = Object.assign(this.make(p.kind, p.x, p.y), p);
    // (Over the limit, the oldest go at the end of the update: dropping them one
    // at a time is slow when a huge battle adds thousands.)
    this.parts.push(p);
    if (this.parts.length > MAX_PARTICLES * 4) this.trim();
  }

  trim() {
    trimParts(this.parts, this.spare);
  }

  blood(x, y, dirX, dirY, amount) {
    const n = Math.min(14, 2 + Math.round(amount / 4));
    for (let i = 0; i < n; i++) {
      const sp = 1 + Math.random() * 3;
      const p = this.make('blood', x, y);
      p.vx = dirX * sp + (Math.random() - 0.5) * 2.2;
      p.vy = dirY * sp + (Math.random() - 0.5) * 2.2 - 1;
      p.life = 50 + Math.random() * 30;
      p.size = 1 + Math.random() * 1.4;
      this.add(p);
    }
  }

  sparks(x, y, nx, ny) {
    for (let i = 0; i < 4; i++) {
      const p = this.make('spark', x, y);
      p.vx = nx * (1 + Math.random() * 2) + (Math.random() - 0.5) * 2;
      p.vy = ny * (1 + Math.random() * 2) + (Math.random() - 0.5) * 2;
      p.life = 10 + Math.random() * 8;
      this.add(p);
    }
    const p = this.make('puff', x, y);
    p.r = 2; p.life = 16; p.max = 16;
    this.add(p);
  }

  // (A gun's flash, shell and beam are called with one more: who fired, a soldier's id. Online,
  // players draw their own from their gun as it's drawn: net/client.js. Not needed here.)
  muzzle(x, y, angle, big) {
    const p = this.make('flash', x, y);
    p.angle = angle; p.size = big ? 9 : 6; p.life = 3;
    this.add(p);
  }

  shell(x, y, facing) {
    const p = this.make('shell', x, y);
    p.vx = -facing * (0.8 + Math.random());
    p.vy = -1.5 - Math.random() * 1.5;
    p.angle = Math.random() * 6;
    p.va = (Math.random() - 0.5) * 0.6;
    p.life = 70;
    this.add(p);
  }

  smoke(x, y, r = 3, life = 40) {
    const p = this.make('smoke', x, y);
    p.vx = (Math.random() - 0.5) * 0.4;
    p.vy = -0.3 - Math.random() * 0.3;
    p.r = r; p.life = life; p.max = life;
    this.add(p);
  }

  explosion(x, y, radius) {
    const b = this.make('boom', x, y);
    b.r = radius; b.life = 18; b.max = 18;
    this.add(b);
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, sp = Math.random() * 2.5;
      const p = this.make('smoke', x + Math.cos(a) * radius * 0.3, y + Math.sin(a) * radius * 0.3);
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 0.5;
      p.r = 6 + Math.random() * 8;
      p.life = 50 + Math.random() * 30;
      p.max = 80;
      this.add(p);
    }
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
      const p = this.make('ember', x, y);
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 1;
      p.life = 20 + Math.random() * 20;
      this.add(p);
    }
  }

  /** A flashbang going off: a blinding white flash. */
  bang(x, y) {
    const b = this.make('bang', x, y);
    b.life = 16; b.max = 16;
    this.add(b);
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 3;
      const p = this.make('spark', x, y);
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 0.5;
      p.life = 10 + Math.random() * 8;
      this.add(p);
    }
  }

  /** A hole blown in the map (destructible maps): chunks and dust, and any stains there go. */
  rubble(x, y, r) {
    this.stains = this.stains.filter(s => Math.hypot(s.x - x, s.y - y) > r + 2);
    const n = Math.min(14, 4 + Math.round(r / 5));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * r, sp = 1 + Math.random() * 3.5;
      const p = this.make('chunk', x + Math.cos(a) * d, y + Math.sin(a) * d);
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 2;
      p.angle = Math.random() * 6;
      p.va = (Math.random() - 0.5) * 0.5;
      p.size = 2 + Math.random() * 3.5;
      p.life = 90 + Math.random() * 60;
      this.add(p);
    }
    for (let i = 0; i < 5; i++) this.smoke(x + (Math.random() - 0.5) * r, y + (Math.random() - 0.5) * r, 5 + Math.random() * 6, 60);
  }

  /** A block built or repaired (the Engineer's Builder): a puff of dust around it, and stains under it go. */
  built(l, t, r, b) {
    this.stains = this.stains.filter(s => s.x < l - 1 || s.x > r + 1 || s.y < t - 1 || s.y > b + 1);
    const n = Math.min(8, 3 + Math.round((r - l + b - t) / 24));
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? l : r;
      this.smoke(i < 2 ? side : l + Math.random() * (r - l), i < 2 ? t + Math.random() * (b - t) : b, 3 + Math.random() * 3, 35);
    }
  }

  fire(x, y) {
    const p = this.make('fire', x, y);
    p.vx = (Math.random() - 0.5) * 0.6;
    p.vy = -0.6 - Math.random() * 0.8;
    p.r = 2 + Math.random() * 3;
    p.life = 18; p.max = 18;
    this.add(p);
  }

  trail(x0, y0, x1, y1) {
    const p = this.make('trail', x0, y0);
    p.x1 = x1; p.y1 = y1; p.life = 22; p.max = 22;
    this.add(p);
  }

  ring(x, y, color) {
    const p = this.make('ring', x, y);
    p.color = color; p.life = 30; p.max = 30;
    this.add(p);
  }

  /** A kill confirmed: a sharp bright flash where the victim fell (angle: which way its spikes point). */
  killFlash(x, y) {
    const p = this.make('killflash', x, y);
    p.life = 12; p.max = 12; p.angle = Math.random() * Math.PI;
    this.add(p);
  }

  /** A cartoon "whack" star where a melee hit lands. */
  whack(x, y) {
    const p = this.make('whack', x, y);
    p.life = 12; p.max = 12; p.angle = Math.random();
    this.add(p);
  }

  /** The magic bullet's trail. */
  sparkle(x, y) {
    const p = this.make('sparkle', x + (Math.random() - 0.5) * 3, y + (Math.random() - 0.5) * 3);
    p.vx = 0; p.vy = -0.2; p.life = 22; p.max = 22;
    this.add(p);
  }

  /** One spark (a lit fuse). */
  spark(x, y) {
    const p = this.make('ember', x, y);
    p.vx = (Math.random() - 0.5) * 1.2;
    p.vy = -0.6 - Math.random();
    p.life = 10 + Math.random() * 6;
    this.add(p);
  }

  /** The plane that drops an air strike, flying across above the map. */
  plane(x, y, dir = 1) {
    const p = this.make('plane', x - dir * 700, y);
    p.vx = dir * 10; p.life = 140; p.max = 140;
    this.add(p);
  }

  /** Throw the pieces of a dead stick figure around. segs are [x0,y0,x1,y1] in world space. */
  gibs(segs, head, vx, vy, force) {
    for (const [x0, y0, x1, y1] of segs) {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const p = this.make('gib', cx, cy);
      p.len = Math.hypot(x1 - x0, y1 - y0);
      p.angle = Math.atan2(y1 - y0, x1 - x0);
      p.vx = vx + (Math.random() - 0.5) * (2 + force);
      p.vy = vy - Math.random() * (1.5 + force);
      p.va = (Math.random() - 0.5) * 0.5;
      p.life = 240; p.max = 240;
      this.add(p);
    }
    if (head) {
      const p = this.make('head', head.x, head.y);
      p.r = head.r;
      p.vx = vx + (Math.random() - 0.5) * (2 + force);
      p.vy = vy - 1 - Math.random() * (2 + force);
      p.life = 240; p.max = 240;
      this.add(p);
    }
  }

  /** dt = game time per update (less than 1 when the game speed is turned down). */
  update(map, dt = 1) {
    // (Everything in locals: `this` can be a wrapper that records effects for the replay and online players.)
    const parts = this.parts, drips = this.drips, stains = this.stains, spare = this.spare, spareStains = this.spareStains;
    const stainsBefore = stains.length;
    // (Where a piece's move this update stays inside one empty cell of the map, it can't hit anything.)
    const open = typeof map.emptyBetween === 'function';
    let n = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { if (spare.length < MAX_SPARE) spare.push(p); continue; }
      p.px = p.x; p.py = p.y; // (drawn in between this and the new position)
      switch (p.kind) {
        case 'blood': {
          p.vy += 0.25 * dt;
          const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
          const hit = open && map.emptyBetween(p.x, p.y, nx, ny) ? null : map.raycast(p.x, p.y, nx, ny);
          if (hit) {
            const size = p.size + Math.random(), st = spareStains.pop();
            if (st) { st.x = hit.x; st.y = hit.y; st.size = size; st.life = 900; stains.push(st); }
            else stains.push({ x: hit.x, y: hit.y, size, life: 900 });
            if (spare.length < MAX_SPARE) spare.push(p);
            continue;
          }
          p.x = nx; p.y = ny;
          break;
        }
        case 'spark': case 'ember':
          p.vy += 0.15 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.95 ** dt;
          break;
        case 'shell': case 'gib': case 'head': case 'chunk': {
          p.vy += 0.3 * dt;
          const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
          const hit = open && map.emptyBetween(p.x, p.y, nx, ny) ? null : map.raycast(p.x, p.y, nx, ny);
          if (hit) {
            p.x = hit.x + hit.nx * 0.5; p.y = hit.y + hit.ny * 0.5;
            if (hit.nx) p.vx = -p.vx * 0.4; else { p.vy = -p.vy * 0.35; p.vx *= 0.7; }
            if (p.va) p.va *= 0.6;
          } else { p.x = nx; p.y = ny; }
          if (p.va) p.angle += p.va * dt;
          if (p.kind !== 'shell' && p.kind !== 'chunk' && Math.random() < 0.05 * dt && p.life > 150) {
            const d = makeParticle(spare, 'blood', p.x, p.y);
            d.life = 40; d.size = 1;
            drips.push(d);
          }
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
      parts[n++] = p;
    }
    parts.length = n;
    for (let i = 0; i < drips.length; i++) {
      parts.push(drips[i]);
      if (parts.length > MAX_PARTICLES * 4) trimParts(parts, spare);
    }
    drips.length = 0;
    trimParts(parts, spare);

    // Stains: past the limit, the oldest go (as many as were added, at most: as if each new
    // one pushed the oldest out once there were enough), then they all dry up a little.
    const excess = Math.min(stains.length - stainsBefore, Math.max(0, stains.length - MAX_STAINS));
    if (excess > 0) dropFront(stains, excess, spareStains, MAX_STAINS);
    for (let i = 0; i < stains.length; i++) stains[i].life--;
    if (stains.length && stains[0].life <= 0) {
      let k = 0;
      for (let i = 0; i < stains.length; i++) {
        const s = stains[i];
        if (s.life > 0) stains[k++] = s;
        else if (spareStains.length < MAX_STAINS) spareStains.push(s);
      }
      stains.length = k;
    }
  }
}

/** A particle of `kind` at (x, y), every other field as new: one from `spare` if there is one. */
function makeParticle(spare, kind, x, y) {
  const p = spare.pop();
  if (!p) return new Particle(kind, x, y);
  p.kind = kind; p.x = x; p.y = y; p.px = x; p.py = y; p.vx = 0; p.vy = 0; p.life = 0; p.max = 0;
  p.r = 0; p.size = 0; p.len = 0; p.angle = 0; p.va = 0; p.color = null; p.x1 = 0; p.y1 = 0;
  return p;
}

/** Over the limit: the oldest particles go (kept to use again). */
function trimParts(parts, spare) {
  const extra = parts.length - MAX_PARTICLES;
  if (extra > 0) dropFront(parts, extra, spare, MAX_SPARE);
}

/** Take the first n things off a list (moving the rest up), keeping up to `max` of them in `spare` to use again. */
function dropFront(list, n, spare, max) {
  for (let i = 0; i < n; i++) if (spare.length < max) spare.push(list[i]);
  const left = list.length - n;
  for (let i = 0; i < left; i++) list[i] = list[i + n];
  list.length = left;
}
