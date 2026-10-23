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
import { encodeInputs, decodeSnapshot, messageType, PROTOCOL, SNAPSHOT_EVERY } from './protocol.js';
import { FX_METHODS } from './host.js';
import { beaconKey } from '../gadgets.js';
import { Tape } from '../replay.js';

const NONE = [];
const INPUT_REPEAT = 4;     // each input packet carries the last few inputs, in case some are lost
const VIEW_DELAY = 7;       // ticks behind the host's clock that others are shown at first (room for late snapshots)...
const MIN_DELAY = 5, MAX_DELAY = 10; // ...then as many as late snapshots need, within these
const CLOCK_SNAPS = 48;     // snapshots the host's clock is worked out from (about 2.4 seconds of them)
const LATEST_SNAPS = 6;     // ...and where it's up to now, from the quickest of the last few
const FAR_BEHIND = 12;      // ticks later than it should be past which the view jumps on rather than catch up (after a gap in snapshots)

const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * A snapshot list's entries by id (ids in snapshots are 8 or 16 bits; the last of any with the
 * same id, as a Map would have it). Refilled for each list, never reallocated: no garbage.
 */
class IdIndex {
  constructor(size) { this.at = new Int16Array(size).fill(-1); this.list = []; }
  fill(list) {
    const at = this.at, old = this.list;
    for (let i = 0; i < old.length; i++) at[old[i].id] = -1;
    for (let i = 0; i < list.length; i++) at[list[i].id] = i;
    this.list = list;
  }
  get(id) { const i = this.at[id]; return i >= 0 ? this.list[i] : undefined; }
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
    this.matchNo = -1; // (the host's number for the match being played: snapshots from another are ignored)
    this.welcomes = 0; // (welcomes so far: only the newest is set up, if two maps load at once)
    this.seq = 0;
    this.pending = [];
    this.recent = [];
    this.snaps = [];
    this.events = [];
    this.ping = null;
    this.chat = [];
    this.inputEnabled = true;
    this.ended = false;
    this.step = 1000 / TICK_RATE;
    this.clock = opts.clock || (() => performance.now());
    this.resetClock();
    this.resetView();
    this.pingTimer = setInterval(() => this.sendPing(), 2000);
    this.pingTimer.unref?.(); // (in Node tests, don't keep the process alive)
  }

  /** Measure our ping (the host answers with 'pong'), and tell the host the last one, for everyone's scoreboard. */
  sendPing() {
    this.link.send({ t: 'ping', at: this.clock(), ms: this.ping == null ? null : Math.round(this.ping) }, false);
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
      case 'pings':
        // Everyone's ping, for the scoreboard: [[soldier id, ms], ...]
        if (this.game && Array.isArray(data.list)) {
          for (const [id, ms] of data.list) {
            const s = this.game.soldiers.find(x => x.id === id);
            if (s && s !== this.me && Number.isFinite(ms)) s.ping = Math.max(0, Math.min(9999, ms));
          }
        }
        break;
      case 'carves': if (this.game) this.applyCarves(data.from, data.list); break;
      case 'ev':
        if (!this.game) break;
        // Holes in the map change how everything moves: blown straight away, not when the effects show.
        if (data.cv) this.applyCarves(data.cv.from, data.cv.list);
        this.events.push(data);
        this.tape?.addEvents(data);
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
    const m = w.match, mine = ++this.welcomes;
    const mapData = await this.opts.loadMap(m);
    if (mine !== this.welcomes) return; // (a newer welcome came while this map loaded: that one's the match)
    const game = new Game({ mapData, mode: m.mode, fragLimit: m.fragLimit, options: m.options, speed: m.speed, effects: true, seed: 1 });
    game.online = true;
    this.game = game;
    this.me = null;
    this.matchNo = w.n & 255;
    this.snaps = [];
    this.events = [];
    this.pending = [];
    this.recent = [];
    this.resetClock();
    this.fixed = null;       // the new match's pickups
    this.switchSeq = 0;
    this.myBeacon = null;    // our newest spawn beacon (classes on)
    this.resetView();
    this.tape = new Tape();  // the last few seconds, for the replay of the winning kill (replay.js)
    this.applyRoster(w.roster);
    this.applyCarves(0, w.carves);
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
      // (Our own: unless we've just asked to change it, and the host hasn't caught up yet.)
      if (s !== this.me || this.clock() - (this.spectateAt ?? -1e9) > 1500) s.spectating = !!r.spec;
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
    // Where to respawn (conquest), when the player changes it.
    if (me.deployAt !== this.sentDeploy) { this.sentDeploy = me.deployAt; this.link.send({ t: 'deploy', at: me.deployAt || null }, true); }

    if (me.alive && !me.kamikaze) {
      if (inp.aimDist != null) me.aimDist = inp.aimDist;
      me.buildPlank = !!inp.plank; // (the Builder: for our own screen)
      // (A Juggernaut keeps its minigun in hand, as on the host.)
      if (inp.switchTo && me.has(inp.switchTo) && !(me.jugger > 0)) { me.current = inp.switchTo; this.switchSeq = inp.seq; }
      me.move(this.heavy(this.allowed(inp)), g.map);
      if (me.body.jetting && g.tick % 2 === 0) g.fx?.fire(me.x + me.facing * 3, me.y - 4);
    }
    this.trails();
    g.fx?.update(g.map, MOTION.timeScale);
    this.decay();
  }

  /** What the mode lets us do (Defuse: held still while frozen, planting or defusing), as the host works it out. */
  allowed(inp) {
    const g = this.game;
    return g.rules.input ? g.rules.input(g, this.me, inp) : inp;
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
    // (From another match: the last one's, overtaken on the way by the welcome to this one.)
    if (snap.match !== this.matchNo) return;
    const last = this.snaps[this.snaps.length - 1];
    if (last && snap.tick <= last.tick) return; // late or repeated
    snap.arrival = this.clock();
    this.snaps.push(snap);
    if (this.snaps.length > 40) this.snaps.shift();
    this.tape?.addSnapshot(snap);
    // Destructible maps: missing holes the host has blown? (They usually arrive just
    // after this; ask only if they still haven't half a second later.)
    if (snap.carves > this.game.carves.length) {
      this.carvesBehind ??= snap.arrival;
      if (snap.arrival - this.carvesBehind > 500) this.askCarves();
    } else this.carvesBehind = null;
    this.timeSnapshot(snap.tick, snap.arrival);

    const g = this.game;
    // Someone in the snapshot we don't know about: ask for the player list again.
    const known = this.soldiersById();
    let stranger = false;
    for (let i = 0; i < snap.soldiers.length && !stranger; i++) stranger = !known.has(snap.soldiers[i].id);
    if (stranger && snap.arrival - (this.rosterAsked || -1e9) > 1000) {
      this.rosterAsked = snap.arrival;
      this.link.send({ t: 'roster?' }, true);
    }
    g.teamScore = snap.teamScore;
    if (snap.mode) g.modeState = snap.mode;
    g.over = snap.over;
    if (snap.winner) g.winner = snap.winner >= 100 ? { team: snap.winner - 100 } : { soldier: g.soldiers.find(s => s.id === snap.winner - 1) || this.me };
    else g.winner = null;
    // The match is over: the awards, and the kill that won it (for its replay).
    if (snap.end) { g.awards = snap.end.awards; g.finalKill = snap.end.finalKill; }
    else if (!snap.over) { g.awards = null; g.finalKill = null; }
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
    me.frags = s.frags; me.deaths = s.deaths; me.points = s.points; me.level = s.level; me.lives = s.lives;
    me.respawnTimer = s.respawnTimer;
    me.spawnProtect = s.protected ? 1 : 0;
    me.burnTicks = a.burnTicks;
    me.kamikaze = s.kamikaze ? { remote: true } : null;
    me.weapons = a.weapons;
    if (!this.switchSeq || snap.ack >= this.switchSeq || !me.has(me.current)) me.current = s.current;
    me.reloadTimer = a.reloadTimer; me.cooldown = a.cooldown; me.spin = a.spin;
    me.cls = s.cls; me.gadgetCharge = a.gadgetCharge; me.mods = a.mods; me.holdSpawn = a.holdSpawn;
    me.flashTicks = a.flashTicks; me.flashFull = a.flashFull;
    me.streak = s.streak; me.jugger = a.jugger; me.bank = a.bank;

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
      stamina: a.stamina, winded: a.winded, sprinting: a.sprinting,
    });
    for (const inp of this.pending) stepBody(b, this.heavy(this.allowed(inp)), this.game.map);
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

  /**
   * What's drawn of the host's match, kept and refilled every frame so drawing makes no garbage:
   * the lists given to the game, the objects in them (copies of a snapshot's, and which one each
   * was copied `from`), and the earlier snapshot's soldiers and projectiles by id.
   */
  resetView() {
    this.shots = []; this.shotPool = []; this.shotFrom = [];
    this.items = []; this.itemPool = []; this.itemFrom = [];
    this.beacons = []; this.beaconPool = []; this.beaconFrom = [];
    this.soldiersBefore = new IdIndex(256);
    this.shotsBefore = new IdIndex(65536);
    this.pairA = this.pairB = null;
    this.smooth = new Uint8Array(64);
    this.indexed = null;
  }

  /** The game's soldiers by id (the first of any with the same id); worked out again when the list changes. */
  soldiersById() {
    const list = this.game.soldiers;
    if (list !== this.indexed || list.length !== this.indexedCount) {
      const m = this.byId = new Map();
      for (let i = 0; i < list.length; i++) if (!m.has(list[i].id)) m.set(list[i].id, list[i]);
      this.indexed = list;
      this.indexedCount = list.length;
    }
    return this.byId;
  }

  /** Before drawing: put everyone else where they were a moment ago, between two snapshots. */
  updateView(now = this.clock()) {
    if (!this.game || !this.snaps.length) return;
    this.showAt(this.viewTime(now));
  }

  /** The host's clock, worked out from when snapshots arrive (timeSnapshot), and the tick shown (viewTime). */
  resetClock() {
    this.arrivals = new Float64Array(CLOCK_SNAPS);     // when each of the last snapshots arrived,
    this.arrivalTicks = new Float64Array(CLOCK_SNAPS); // its tick,
    this.lateness = new Float64Array(CLOCK_SNAPS);     // and how many ticks later than the quickest it was
    this.clockHead = 0; this.clockCount = 0; this.lateCount = 0;
    this.hostRate = 1;   // host ticks per tick of ours (a slow host drops some)
    this.hostTick = 0;   // where the host was up to at hostAt
    this.hostAt = 0;
    this.delay = VIEW_DELAY; this.shrink = 0;
    this.viewTick = null; this.viewAt = 0;
  }

  /**
   * A snapshot arrived: work out the host's clock. How fast its ticks come (a slow host drops
   * some, so not always 60 a second) and where it's up to now, as the quickest snapshots show
   * it (the rest were held up on the way). And how far behind to show others: room for all but
   * the latest snapshots.
   */
  timeSnapshot(tick, at) {
    const N = CLOCK_SNAPS, times = this.arrivals, ticks = this.arrivalTicks, step = this.step;
    // After a long gap (the host stalled, or the connection did), start again.
    if (this.clockCount && at - times[(this.clockHead + N - 1) % N] > 250) this.clockCount = 0;
    const head = this.clockHead;
    times[head] = at; ticks[head] = tick;
    this.clockHead = (head + 1) % N;
    const n = this.clockCount = Math.min(this.clockCount + 1, N), first = this.clockHead + N - n;
    // Its pace: the quickest snapshot early in the window against the quickest late in it. (Far
    // from 60 a second is a stall or a jump in the window, not a pace: left out.)
    if (n >= 18) {
      const third = Math.floor(n / 3), i = this.quickest(first, third), j = this.quickest(first + n - third, third);
      const span = times[j] - times[i], rate = (ticks[j] - ticks[i]) * step / span;
      if (span > 400 && rate >= 0.5 && rate <= 1.1) this.hostRate += (rate - this.hostRate) * 0.1;
    }
    // Where it's up to: the furthest on of the last few, carried forward to now at that pace.
    let host = -Infinity;
    for (let k = Math.max(0, n - LATEST_SNAPS); k < n; k++) {
      const i = (first + k) % N;
      host = Math.max(host, ticks[i] + (at - times[i]) * this.hostRate / step);
    }
    this.hostTick = host; this.hostAt = at;
    // How far behind to show others: the gap between snapshots, the second latest of the last
    // few seconds, and 2 ticks to spare. Up at once; down a tick at a time, after 5 seconds.
    this.lateness[head] = host - tick;
    this.lateCount = Math.min(this.lateCount + 1, N);
    if (this.lateCount < 20) return;
    let late = 0, latest = 0;
    for (let k = 0; k < this.lateCount; k++) {
      const v = this.lateness[k];
      if (v > latest) { late = latest; latest = v; } else if (v > late) late = v;
    }
    const want = Math.max(MIN_DELAY, Math.min(MAX_DELAY, Math.ceil(SNAPSHOT_EVERY + late + 2)));
    if (want > this.delay) { this.delay = want; this.shrink = 0; }
    else if (want === this.delay) this.shrink = 0;
    else if (++this.shrink >= 100) { this.delay--; this.shrink = 0; }
  }

  /** Of `count` snapshots in the window from `from` on, the one that arrived soonest for its tick. */
  quickest(from, count) {
    const N = CLOCK_SNAPS, pace = this.hostRate / this.step;
    let best = from % N, most = -Infinity;
    for (let k = 0; k < count; k++) {
      const i = (from + k) % N, v = this.arrivalTicks[i] - this.arrivals[i] * pace;
      if (v > most) { most = v; best = i; }
    }
    return best;
  }

  /**
   * The host tick to show everyone else at: `delay` ticks behind the host's clock. It moves on
   * at the host's pace, up to a tenth faster or slower to close any gap, so it never goes back;
   * and at the newest snapshot it waits for the next rather than run on past it. Only after a
   * long wait (no snapshots for a fifth of a second or so, the host carrying on) does it jump on,
   * as catching up a tenth faster would show everyone late for seconds.
   */
  viewTime(now) {
    const newest = this.snaps[this.snaps.length - 1].tick;
    const target = this.hostTick + (now - this.hostAt) * this.hostRate / this.step - this.delay;
    let rt = this.viewTick;
    if (rt == null || target - rt > FAR_BEHIND) rt = target; // (just started, or far behind: straight there)
    else {
      const move = Math.max(0, now - this.viewAt) * this.hostRate / this.step;
      rt += move * Math.max(0.9, Math.min(1.1, 1 + 0.04 * (target - rt - move)));
    }
    this.viewAt = now;
    return this.viewTick = Math.min(rt, newest);
  }

  /** Everyone else as they were at host tick `rt`: part way between the two snapshots around it. */
  showAt(rt) {
    const g = this.game, snaps = this.snaps;
    rt = Math.min(rt, snaps[snaps.length - 1].tick + 6);
    let a = snaps[0], b = a;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].tick <= rt) { a = snaps[i]; b = snaps[i + 1] || a; break; }
    }
    if (rt < a.tick) rt = a.tick;
    const t = b.tick > a.tick ? Math.min(1.25, (rt - a.tick) / (b.tick - a.tick)) : 0;
    g.tick = Math.floor(rt);
    if (a !== this.pairA || b !== this.pairB) this.pair(a, b);
    this.showSoldiers(b, t);
    this.showProjectiles(a, b, t);
    this.showItems(b);
    while (this.events.length && this.events[0].tick <= rt + 0.5) this.applyEvents(this.events.shift());
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
  }

  /** Two new snapshots to show between: the first's soldiers and projectiles by id, and who moves smoothly from one to the other. */
  pair(a, b) {
    this.pairA = a; this.pairB = b;
    this.soldiersBefore.fill(a.soldiers);
    this.shotsBefore.fill(a.projectiles);
    const list = b.soldiers;
    if (this.smooth.length < list.length) this.smooth = new Uint8Array(list.length * 2);
    // (How far is too far depends on how long between the two: longer after lost snapshots.)
    const far = 150 * Math.max(1, (b.tick - a.tick) / SNAPSHOT_EVERY);
    for (let i = 0; i < list.length; i++) {
      const sb = list[i], sa = this.soldiersBefore.get(sb.id) || sb;
      // (Alive in both and not far apart: anything else, a respawn or a teleport, jumps.)
      this.smooth[i] = sa.alive && sb.alive && Math.hypot(sb.x - sa.x, sb.y - sa.y) < far ? 1 : 0;
    }
  }

  showSoldiers(b, t) {
    const g = this.game, list = b.soldiers, ours = this.soldiersById();
    for (let i = 0; i < list.length; i++) {
      const sb = list[i], s = ours.get(sb.id);
      if (!s) continue;
      if (s === this.me) {
        // Firing animations come from the host.
        s.anim.swing = sb.anim.swing; s.anim.recoil = Math.max(s.anim.recoil, sb.anim.recoil);
        s.body.jetting = s.body.jetting || false;
        continue;
      }
      const sa = this.soldiersBefore.get(sb.id) || sb;
      const smooth = this.smooth[i] === 1;
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
      s.frags = sb.frags; s.deaths = sb.deaths; s.points = sb.points; s.level = sb.level; s.lives = sb.lives;
      s.cls = sb.cls;
      s.streak = sb.streak; s.jugger = sb.jugger;
      s.respawnTimer = sb.respawnTimer;
      s.spawnProtect = sb.protected ? 1 : 0;
      s.burnTicks = sb.burning ? 1 : 0;
      s.kamikaze = sb.kamikaze ? s.kamikaze || { remote: true } : null;
      s.anim.run = smooth && Math.abs(sb.anim.run - sa.anim.run) < 0.5 ? lerp(sa.anim.run, sb.anim.run, t) : sb.anim.run;
      s.anim.flip = sb.anim.flip; s.anim.land = sb.anim.land; s.anim.recoil = sb.anim.recoil; s.anim.swing = sb.anim.swing;
      s.anim.idle = g.tick;
    }
  }

  showProjectiles(a, b, t) {
    const list = b.projectiles, shown = this.shots, pool = this.shotPool, from = this.shotFrom;
    for (let i = 0; i < list.length; i++) {
      const pb = list[i], pa = this.shotsBefore.get(pb.id);
      // (A copy of the snapshot's, made again only when that changes: the snapshot's own are kept for the replay.)
      const p = pool[i] ||= {};
      if (from[i] !== pb) { Object.assign(p, pb); from[i] = pb; }
      if (pa && t <= 1) {
        p.x = lerp(pa.x, pb.x, t); p.y = lerp(pa.y, pb.y, t);
        p.angle = lerpAngle(pa.angle, pb.angle, t);
      } else if (!pa) {
        // New this snapshot: work back along its path so it doesn't pop in ahead.
        const back = Math.max(0, 1 - t) * (b.tick - a.tick || 3);
        p.x = pb.x - pb.vx * back; p.y = pb.y - pb.vy * back; p.angle = pb.angle;
      } else { p.x = pb.x; p.y = pb.y; p.angle = pb.angle; }
      shown[i] = p;
    }
    shown.length = list.length;
    this.game.projectiles = shown;
  }

  /** Pickups (the map's on or off, dropped ones as sent) and spawn beacons, as in snapshot b. */
  showItems(b) {
    const g = this.game;
    if (!this.fixed) this.fixed = g.pickups.items.filter(it => !it.dropped);
    const fixed = this.fixed, on = b.fixedItems, loose = b.looseItems, items = this.items;
    for (let i = 0; i < on.length; i++) if (fixed[i]) fixed[i].active = on[i];
    let n = 0;
    for (let i = 0; i < fixed.length; i++) items[n++] = fixed[i];
    for (let i = 0; i < loose.length; i++) {
      const it = this.itemPool[i] ||= {};
      if (this.itemFrom[i] !== loose[i]) { Object.assign(it, loose[i]); this.itemFrom[i] = loose[i]; }
      it.active = true; it.dropped = true; it.bob = 0;
      items[n++] = it;
    }
    items.length = n;
    g.pickups.items = items;
    const sent = b.beacons, beacons = this.beacons;
    for (let i = 0; i < sent.length; i++) {
      const x = beacons[i] = this.beaconPool[i] ||= {};
      if (this.beaconFrom[i] !== sent[i]) { Object.assign(x, sent[i]); this.beaconFrom[i] = sent[i]; }
    }
    beacons.length = sent.length;
    g.beacons = beacons;
    // A spawn beacon we've just placed: spawn on it next time (the host is told, as for any choice).
    const me = this.me;
    for (let i = sent.length - 1; me && i >= 0; i--) {
      if (sent[i].owner !== me.id) continue;
      if (sent[i].id !== this.myBeacon) { this.myBeacon = sent[i].id; me.deployAt = beaconKey(sent[i]); }
      break;
    }
  }

  applyEvents(e) {
    const g = this.game, me = this.me;
    // (Sounds and effects by index: a batch can hold hundreds, and taking each apart made garbage.)
    const sounds = Array.isArray(e.s) ? e.s : NONE, fx = g.fx && Array.isArray(e.fx) ? e.fx : NONE;
    for (let i = 0; i < sounds.length; i++) { const s = sounds[i]; g.sounds.push({ name: String(s[0]), x: s[1], y: s[2] }); }
    for (let i = 0; i < fx.length; i++) {
      const f = fx[i];
      if (FX_METHODS.has(f[0])) { try { g.fx[f[0]](...f.slice(1)); } catch { /* bad args */ } }
    }
    for (const [text, weapon] of e.k || []) g.feed.push({ text: String(text), weapon: weapon && String(weapon), tick: g.tick });
    if (g.feed.length > 6) g.feed.splice(0, g.feed.length - 6);
    for (const text of e.n || []) g.notes.push({ text: String(text), tick: g.tick, to: me?.id });
    // Kill streak callouts: [text, sub, kind, mine (to us: 1; to everyone: 0), about (a soldier id)].
    for (const c of Array.isArray(e.c) ? e.c : []) {
      if (!Array.isArray(c)) continue;
      const [text, sub, kind, mine, about] = c;
      g.callouts.push({ text: String(text ?? '').slice(0, 80), sub: String(sub ?? '').slice(0, 140), kind: String(kind ?? ''), tick: g.tick, to: mine ? me?.id ?? null : null, about: Number.isFinite(about) ? about : null });
    }
    if (g.callouts.length > 16) g.callouts.splice(0, g.callouts.length - 16);
    for (const [x, y, amount] of e.sh || []) g.shakes.push({ x, y, amount });
  }

  /**
   * Changes to the map: holes the host blew and blocks built, numbered from `from`.
   * Ones already made here are skipped; if some are missing before them, ask for them.
   */
  applyCarves(from, list) {
    const g = this.game;
    if (!g || !Array.isArray(list)) return;
    from = Math.floor(Number(from) || 0);
    if (from > g.carves.length) { this.askCarves(); return; }
    // (The projectiles shown are copies of the host's, kept and refilled every frame: a hole
    // mustn't knock them down or kill them here, or that would stick to the next one shown in
    // their place. The host's own are knocked down there, and its snapshots show it.)
    const shown = g.projectiles;
    g.projectiles = [];
    try {
      for (let i = g.carves.length - from; i < list.length; i++) {
        const e = Array.isArray(list[i]) ? list[i] : [];
        if (e[0] === '+') {
          // A block built: ['+', l, t, r, b, built].
          const [l, t, r, b] = e.slice(1, 5).map(v => Number(v) || 0);
          g.applyBuild(l, t, Math.min(r, l + 400), Math.min(b, t + 400), !!e[5]);
          continue;
        }
        const [x, y, r] = e.map(v => Math.round(Number(v) || 0));
        g.applyCarve(x, y, Math.max(0, Math.min(400, r)));
      }
    } finally {
      g.projectiles = shown;
    }
  }

  askCarves() {
    const now = this.clock();
    if (now - (this.carvesAsked ?? -1e9) < 1000) return;
    this.carvesAsked = now;
    this.link.send({ t: 'carves?', from: this.game.carves.length }, true);
  }

  /** Sit out and watch (on), or join the game again. */
  sendSpectate(on) {
    this.spectateAt = this.clock();
    if (this.me) this.me.spectating = !!on;
    this.link.send({ t: 'spectate', on: !!on }, true);
  }

  sendChat(text) { this.link.send({ t: 'chat', text: String(text).slice(0, 140) }, true); }

  /** Defuse: buy something (the host checks we can, and takes the money). */
  sendBuy(item) { this.link.send({ t: 'buy', item: String(item) }, true); }

  /** Classes on: our class (for our next spawn) and loadouts; hold: we're choosing a class, so wait to respawn. */
  sendKit({ cls, loadouts, hold = false }) { this.link.send({ t: 'kit', cls, loadouts, hold }, true); }

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
