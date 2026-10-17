// Playing in someone else's online game. The host runs the match; this side:
//   - sends our inputs 60 times a second,
//   - moves our own soldier straight away (prediction), then corrects it
//     when the host's snapshot says where we really are,
//   - shows everyone else slightly in the past, smoothly between snapshots,
//   - replays the host's sounds and effects at the moment they happened.

import { Game } from '../game.js';
import { stepBody } from '../physics.js';
import { WEAPONS } from '../weapons.js';
import { MOTION, TICK_RATE } from '../config.js';
import { encodeInputs, decodeSnapshot, messageType, PROTOCOL } from './protocol.js';
import { FX_METHODS } from './host.js';

const INPUT_REPEAT = 4;     // each input packet carries the last few inputs, in case some are lost
const VIEW_DELAY = 7;       // ticks behind the newest snapshot that others are shown (smooths out late packets)

const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class NetClient {
  /**
   * opts: {
   *   link, controller (our PlayerController),
   *   loadMap(match) -> Promise<map data>,
   *   onStart(game, me), onEnd(reason), onChat(message), onRoster()
   * }
   */
  constructor(opts) {
    this.opts = opts;
    this.link = opts.link;
    this.link.onmessage = (data, reliable) => this.receive(data, reliable);
    this.link.onclose = () => this.end('Lost the connection to the host');
    this.game = null;
    this.me = null;
    this.seq = 0;
    this.pending = [];
    this.recent = [];
    this.snaps = [];
    this.events = [];
    this.offsets = [];
    this.offset = 0;
    this.ping = null;
    this.chat = [];
    this.inputEnabled = true;
    this.ended = false;
    this.step = 1000 / TICK_RATE;
    this.clock = opts.clock || (() => performance.now());
    this.pingTimer = setInterval(() => this.link.send({ t: 'ping', at: this.clock() }, false), 2000);
    this.pingTimer.unref?.(); // (in Node tests, don't keep the process alive)
  }

  receive(data, reliable) {
    if (this.ended) return;
    if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
      if (this.game && messageType(data) === 2) {
        let snap;
        try { snap = decodeSnapshot(data); } catch { return; }
        if (snap) this.onSnapshot(snap);
      }
      return;
    }
    if (!data || typeof data !== 'object') return;
    switch (data.t) {
      case 'welcome': this.start(data).catch(e => this.end(`Couldn't load the match: ${e.message}`)); break;
      case 'roster': if (this.game) { this.applyRoster(data.roster); this.opts.onRoster?.(); } break;
      case 'ev':
        if (!this.game) break;
        this.events.push(data);
        // (In a background tab nothing is drawn, so don't let events pile up.)
        if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
        break;
      case 'chat': this.addChat(data); break;
      case 'pong': { const rtt = this.clock() - data.at; this.ping = this.ping == null ? rtt : this.ping * 0.7 + rtt * 0.3; break; }
      case 'end': this.end(data.reason || 'The game ended'); break;
    }
  }

  addChat(m) {
    const msg = { name: String(m.name || ''), text: String(m.text || '').slice(0, 140), system: !!m.system, time: this.clock() };
    this.chat.push(msg);
    if (this.chat.length > 30) this.chat.shift();
    this.opts.onChat?.(msg);
  }

  async start(w) {
    if (w.v !== PROTOCOL) { this.end('That game is running a different version. Refresh the page and try again.'); return; }
    const m = w.match;
    const mapData = await this.opts.loadMap(m);
    const game = new Game({ mapData, mode: m.mode, fragLimit: m.fragLimit, options: m.options, speed: m.speed, effects: true, seed: 1 });
    game.online = true;
    this.game = game;
    this.me = null;
    this.snaps = [];
    this.events = [];
    this.pending = [];
    this.recent = [];
    this.offsets = [];
    this.applyRoster(w.roster);
    this.me = game.soldiers.find(s => s.id === w.you) || null;
    for (const c of w.chat || []) this.addChat(c);
    this.link.send({ t: 'ready' });
    this.opts.onStart?.(game, this.me, m);
  }

  applyRoster(list) {
    const g = this.game;
    const ids = new Set(list.map(r => r.id));
    for (const s of [...g.soldiers]) if (!ids.has(s.id)) g.removeSoldier(s);
    for (const r of list) {
      let s = g.soldiers.find(x => x.id === r.id);
      if (!s) {
        s = g.addSoldier({ id: r.id, name: String(r.name).slice(0, 14), team: r.team, isBot: !!r.isBot }, null);
        s.alive = false;
      }
      s.name = String(r.name).slice(0, 14);
      s.team = r.team;
      s.remote = !!r.remote;
    }
  }

  /** One update (60 a second): send our input, move our soldier, animate effects. */
  tick() {
    const g = this.game, me = this.me;
    if (!g || !me || this.ended) return;
    const inp = this.inputEnabled ? this.opts.controller.input(g, me) : { move: 0, aim: me.aim, aimDist: me.aimDist };
    inp.seq = ++this.seq;
    this.pending.push(inp);
    if (this.pending.length > 180) this.pending.shift();
    this.recent.push(inp);
    if (this.recent.length > INPUT_REPEAT) this.recent.shift();
    this.link.send(encodeInputs(this.recent), false);

    if (me.alive && !me.kamikaze) {
      if (inp.aimDist != null) me.aimDist = inp.aimDist;
      if (inp.switchTo && me.has(inp.switchTo)) { me.current = inp.switchTo; this.switchSeq = inp.seq; }
      me.move(this.heavy(inp), g.map);
      if (me.body.jetting && g.tick % 2 === 0) g.fx?.fire(me.x + me.facing * 3, me.y - 4);
    }
    this.trails();
    g.fx?.update(g.map, MOTION.timeScale);
    this.decay();
  }

  /** The minigun slows you down while it spins (same rule as the host). */
  heavy(inp) {
    const def = WEAPONS[this.me.current];
    return def?.heavy && this.me.spin > 0 ? { ...inp, move: (inp.move || 0) * def.heavy } : inp;
  }

  /** Smoke trails, jetpack flames and fires: drawn locally from what's on screen. */
  trails() {
    const g = this.game, fx = g.fx;
    if (!fx) return;
    const t = this.localTick = (this.localTick || 0) + 1;
    for (const p of g.projectiles) {
      if (p.delay > 0) continue;
      if (p.kind === 'rocket' && p.sprite !== 'bomb' && t % 2 === 0) fx.smoke(p.x - p.vx, p.y - p.vy, 2.5, 30);
      else if (p.kind === 'seeker' && t % 2 === 0) fx.sparkle(p.x, p.y);
      else if (p.kind === 'placed' && p.sprite === 'dynamite' && t % 3 === 0) fx.spark(p.x + 2, p.y - 6);
      else if (p.kind === 'fire' && t % 4 === p.id % 4) fx.fire(p.x + (Math.random() - 0.5) * 6, p.y - 2);
    }
    for (const s of g.soldiers) {
      if (!s.alive || s === this.me) continue;
      if (s.body.jetting && t % 2 === 0) fx.fire(s.x + s.facing * 3, s.y - 4);
      if ((s.burnTicks > 0 || s.kamikaze) && t % 2 === 0) fx.fire(s.x + (Math.random() - 0.5) * 8, s.y - 4 - Math.random() * 16);
    }
    if (this.me?.alive && (this.me.burnTicks > 0 || this.me.kamikaze) && t % 2 === 0) fx.fire(this.me.x + (Math.random() - 0.5) * 8, this.me.y - 4 - Math.random() * 16);
  }

  onSnapshot(snap) {
    const last = this.snaps[this.snaps.length - 1];
    if (last && snap.tick <= last.tick) return; // late or repeated
    snap.arrival = this.clock();
    this.snaps.push(snap);
    if (this.snaps.length > 40) this.snaps.shift();
    // The host's clock: the least-delayed snapshot says best when each tick happened.
    this.offsets.push(snap.arrival - snap.tick * this.step);
    if (this.offsets.length > 60) this.offsets.shift();
    this.offset = Math.min(...this.offsets);

    const g = this.game;
    g.teamScore = snap.teamScore;
    g.over = snap.over;
    if (snap.winner) g.winner = snap.winner >= 100 ? { team: snap.winner - 100 } : { soldier: g.soldiers.find(s => s.id === snap.winner - 1) || this.me };
    else g.winner = null;
    this.reconcile(snap);
  }

  /** Line our soldier up with the host: take the host's position, then replay the inputs it hasn't seen yet. */
  reconcile(snap) {
    const me = this.me, a = snap.me;
    const s = me && snap.soldiers.find(x => x.id === me.id);
    if (!s || !a) return;
    this.pending = this.pending.filter(i => i.seq > snap.ack);
    const wasAlive = me.alive;
    me.alive = s.alive;
    me.health = s.health; me.armour = s.armour;
    me.frags = s.frags; me.deaths = s.deaths; me.level = s.level; me.lives = s.lives;
    me.respawnTimer = s.respawnTimer;
    me.spawnProtect = s.protected ? 1 : 0;
    me.burnTicks = a.burnTicks;
    me.kamikaze = s.kamikaze ? { remote: true } : null;
    me.weapons = a.weapons;
    if (!this.switchSeq || snap.ack >= this.switchSeq || !me.has(me.current)) me.current = s.current;
    me.reloadTimer = a.reloadTimer; me.cooldown = a.cooldown; me.spin = a.spin;

    const b = me.body;
    if (!s.alive || s.kamikaze) {
      Object.assign(b, { x: s.x, y: s.y, vx: s.vx, vy: s.vy, rope: null });
      me.prevX = s.x; me.prevY = s.y;
      me.drawDX = me.drawDY = 0;
      return;
    }
    const oldX = b.x, oldY = b.y;
    Object.assign(b, {
      x: a.x, y: a.y, vx: a.vx, vy: a.vy, onGround: a.onGround, crouching: a.crouching, padLaunch: a.padLaunch,
      hasJetpack: a.hasJetpack, fuel: a.fuel, momentum: a.momentum, rope: a.rope ? { ...a.rope } : null,
    });
    for (const inp of this.pending) stepBody(b, this.heavy(inp), this.game.map);
    if (!wasAlive) { me.prevX = b.x; me.prevY = b.y; me.drawDX = me.drawDY = 0; return; }
    // Small differences are smoothed out over a few frames; big ones (a teleport, a respawn) jump.
    const ex = oldX - b.x, ey = oldY - b.y;
    if (Math.hypot(ex, ey) > 80) { me.prevX = b.x; me.prevY = b.y; me.drawDX = me.drawDY = 0; }
    else { me.drawDX = (me.drawDX || 0) + ex; me.drawDY = (me.drawDY || 0) + ey; me.prevX -= ex; me.prevY -= ey; }
  }

  decay() {
    const me = this.me;
    if (!me) return;
    me.drawDX = (me.drawDX || 0) * 0.8;
    me.drawDY = (me.drawDY || 0) * 0.8;
    if (Math.abs(me.drawDX) < 0.05) me.drawDX = 0;
    if (Math.abs(me.drawDY) < 0.05) me.drawDY = 0;
  }

  /** Before drawing: put everyone else where they were a moment ago, between two snapshots. */
  updateView(now = this.clock()) {
    const g = this.game;
    if (!g || !this.snaps.length) return;
    const newest = this.snaps[this.snaps.length - 1];
    let rt = (now - this.offset) / this.step - VIEW_DELAY;
    rt = Math.min(rt, newest.tick + 6);
    let a = this.snaps[0], b = a;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].tick <= rt) { a = this.snaps[i]; b = this.snaps[i + 1] || a; break; }
    }
    if (rt < a.tick) rt = a.tick;
    const t = b.tick > a.tick ? Math.min(1.25, (rt - a.tick) / (b.tick - a.tick)) : 0;
    g.tick = Math.floor(rt);

    const before = new Map(a.soldiers.map(s => [s.id, s]));
    for (const sb of b.soldiers) {
      const s = g.soldiers.find(x => x.id === sb.id);
      if (!s) continue;
      if (s === this.me) {
        // Firing animations come from the host.
        s.anim.swing = sb.anim.swing; s.anim.recoil = Math.max(s.anim.recoil, sb.anim.recoil);
        s.body.jetting = s.body.jetting || false;
        continue;
      }
      const sa = before.get(sb.id) || sb;
      const smooth = sa.alive && sb.alive && Math.hypot(sb.x - sa.x, sb.y - sa.y) < 150;
      const k = smooth ? t : 1;
      const src = t < 0.5 && smooth ? sa : sb;
      const body = s.body;
      body.x = lerp(sa.x, sb.x, k); body.y = lerp(sa.y, sb.y, k);
      body.vx = sb.vx; body.vy = sb.vy;
      body.crouching = src.crouching; body.onGround = src.onGround; body.jetting = src.jetting; body.hasJetpack = sb.hasJetpack;
      body.fuel = sb.fuel; body.padLaunch = src.padLaunch;
      body.rope = sb.rope;
      s.prevX = body.x; s.prevY = body.y;
      s.alive = sb.alive;
      s.aim = smooth ? lerpAngle(sa.aim, sb.aim, t) : sb.aim;
      s.facing = src.facing;
      s.health = sb.health; s.armour = sb.armour;
      s.current = sb.current;
      s.frags = sb.frags; s.deaths = sb.deaths; s.level = sb.level; s.lives = sb.lives;
      s.respawnTimer = sb.respawnTimer;
      s.spawnProtect = sb.protected ? 1 : 0;
      s.burnTicks = sb.burning ? 1 : 0;
      s.kamikaze = sb.kamikaze ? { remote: true } : null;
      s.anim.run = smooth && Math.abs(sb.anim.run - sa.anim.run) < 0.5 ? lerp(sa.anim.run, sb.anim.run, t) : sb.anim.run;
      s.anim.flip = sb.anim.flip; s.anim.land = sb.anim.land; s.anim.recoil = sb.anim.recoil; s.anim.swing = sb.anim.swing;
      s.anim.idle = g.tick;
    }

    const prev = new Map(a.projectiles.map(p => [p.id, p]));
    g.projectiles = b.projectiles.map(pb => {
      const pa = prev.get(pb.id);
      const p = { ...pb };
      if (pa && t <= 1) {
        p.x = lerp(pa.x, pb.x, t); p.y = lerp(pa.y, pb.y, t);
        p.angle = lerpAngle(pa.angle, pb.angle, t);
      } else if (!pa) {
        // New this snapshot: work back along its path so it doesn't pop in ahead.
        const back = Math.max(0, 1 - t) * (b.tick - a.tick || 3);
        p.x -= pb.vx * back; p.y -= pb.vy * back;
      }
      p.px = p.x - p.vx; p.py = p.y - p.vy;
      return p;
    });

    if (!this.fixed) this.fixed = g.pickups.items.filter(it => !it.dropped);
    b.fixedItems.forEach((on, i) => { if (this.fixed[i]) this.fixed[i].active = on; });
    g.pickups.items = this.fixed.concat(b.looseItems.map(it => ({ ...it, active: true, dropped: true, bob: 0 })));

    while (this.events.length && this.events[0].tick <= rt + 0.5) this.applyEvents(this.events.shift());
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
  }

  applyEvents(e) {
    const g = this.game, me = this.me;
    for (const [name, x, y] of e.s || []) g.sounds.push({ name: String(name), x, y });
    if (g.fx) for (const [m, ...args] of e.fx || []) { if (FX_METHODS.has(m)) { try { g.fx[m](...args); } catch { /* bad args */ } } }
    for (const [text, weapon] of e.k || []) g.feed.push({ text: String(text), weapon: weapon && String(weapon), tick: g.tick });
    if (g.feed.length > 6) g.feed.splice(0, g.feed.length - 6);
    for (const text of e.n || []) g.notes.push({ text: String(text), tick: g.tick, to: me?.id });
    for (const [x, y, amount] of e.sh || []) g.shakes.push({ x, y, amount });
  }

  sendChat(text) { this.link.send({ t: 'chat', text: String(text).slice(0, 140) }, true); }

  /** Leave the game. */
  leave() {
    this.link.send({ t: 'bye' }, true);
    setTimeout(() => this.link.close('left'), 100);
    this.end(null);
  }

  end(reason) {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.pingTimer);
    try { this.link.close('ended'); } catch { /* already closed */ }
    this.opts.onEnd?.(reason);
  }
}
