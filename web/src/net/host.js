// Hosting an online game: the real match runs in the host's browser. Players
// send their inputs here; the host sends back snapshots (20 a second) and the
// events of the match (sounds, effects, the kill feed, messages).

import { encodeWorld, encodeSnapshot, decodeInputs, messageType, PROTOCOL, SNAPSHOT_EVERY } from './protocol.js';

// Effects every player draws for themselves from what they can see (rocket
// smoke, jetpack flames, burning soldiers), so they aren't sent.
const FX_SKIP = new Set(['smoke', 'fire', 'sparkle', 'spark']);
export const FX_METHODS = new Set(['blood', 'sparks', 'muzzle', 'shell', 'explosion', 'trail', 'ring', 'gibs', 'whack', 'plane']);
const MAX_CHAT = 140;

/** Drives a remote player's soldier from the inputs they send. */
export class RemoteController {
  constructor() {
    this.queue = [];
    this.last = { move: 0 };
    this.lastSeq = 0;   // newest input received
    this.ackSeq = 0;    // newest input used (sent back so the player can correct their prediction)
  }

  push(inputs) {
    for (const i of inputs) if (i.seq > this.lastSeq) { this.queue.push(i); this.lastSeq = i.seq; }
    // Keep the delay down: if inputs pile up, fold the oldest into the next one (keeping clicks and key presses).
    while (this.queue.length > 4) {
      const old = this.queue.shift(), next = this.queue[0];
      next.jumpPressed ||= old.jumpPressed;
      next.firePressed ||= old.firePressed;
      next.switchTo ||= old.switchTo;
      next.cycle ||= old.cycle;
    }
  }

  input() {
    const next = this.queue.shift();
    if (next) { this.last = next; this.ackSeq = next.seq; return next; }
    // Nothing new arrived in time: keep doing the same thing (but don't repeat clicks).
    return { ...this.last, jumpPressed: false, firePressed: false, switchTo: null, cycle: 0 };
  }
}

const round = v => (typeof v === 'number' ? Math.round(v * 10) / 10 : Array.isArray(v) ? v.map(round) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v);

export class NetHost {
  /**
   * opts: {
   *   maxPlayers, botCount,
   *   matchInfo(): what players need to set up the match (mode, map, ...),
   *   addBot(game): adds one bot to the game,
   *   onChange(): the player list changed,  onChat(message)
   * }
   */
  constructor(opts) {
    this.opts = opts;
    this.players = new Set();
    this.game = null;
    this.chatLog = [];
    this.resetEvents();
  }

  resetEvents() { this.events = { s: [], fx: [], k: [], n: [], sh: [] }; }

  get humans() { return 1 + this.players.size; }

  /** Host this match. Players already connected get a soldier in it. */
  setGame(game) {
    this.game = game;
    game.recorder = this;
    if (game.fx && !game.fx.recording) game.fx = recordFx(game.fx, this);
    this.resetEvents();
    for (const p of this.players) {
      p.soldier = this.soldierFor(p);
      p.ctl.queue.length = 0;
      p.ready = false;
    }
    // Bots first, so the welcome's roster includes them.
    this.balanceBots();
    for (const p of this.players) this.welcome(p, { fresh: false });
  }

  /** A player has connected: give them a soldier and everything they need to join. */
  addPlayer(link, name) {
    const p = { link, name: cleanName(name), ctl: new RemoteController(), ready: false, joined: Date.now() };
    this.players.add(p);
    link.onmessage = (data, reliable) => this.receive(p, data, reliable);
    link.onclose = () => this.removePlayer(p, 'left');
    p.soldier = this.soldierFor(p);
    this.balanceBots();
    this.welcome(p);
    this.broadcast({ t: 'roster', roster: this.roster() });
    this.system(`${p.soldier.name} joined`);
    this.opts.onChange?.();
    return p;
  }

  soldierFor(p) {
    const g = this.game;
    let team = 0;
    if (g.rules.teams) {
      const n = t => g.soldiers.filter(s => s.team === t && !s.isBot).length;
      team = n(1) <= n(2) ? 1 : 2;
    }
    let name = p.name, k = 2;
    while (g.soldiers.some(s => s.name.toLowerCase() === name.toLowerCase())) name = `${p.name.slice(0, 12)}${k++}`;
    const s = g.addSoldier({ name, isBot: false, team }, p.ctl);
    s.remote = true;
    s.respawnTimer = 20;
    // Joining one in the chamber late: no more lives than the players still in.
    if (g.mode === 'oitc') {
      const others = g.soldiers.filter(o => o !== s && o.lives > 0).map(o => o.lives);
      if (others.length) s.lives = Math.max(1, Math.min(s.lives, ...others));
    }
    return s;
  }

  removePlayer(p, why = 'left') {
    if (!this.players.delete(p)) return;
    if (this.game && p.soldier) this.game.removeSoldier(p.soldier);
    this.balanceBots();
    this.broadcast({ t: 'roster', roster: this.roster() });
    this.system(`${p.soldier?.name || p.name} ${why}`);
    this.opts.onChange?.();
  }

  /** Bots fill the game up to the bot count, and make room when players join. */
  balanceBots() {
    const g = this.game;
    if (!g) return;
    const want = Math.max(0, Math.min(this.opts.botCount, this.opts.maxPlayers - this.humans));
    let bots = g.soldiers.filter(s => s.isBot);
    while (bots.length > want) {
      const worst = [...bots].sort((a, b) => a.frags - b.frags)[0];
      g.removeSoldier(worst);
      bots = bots.filter(b => b !== worst);
    }
    while (bots.length < want) { this.opts.addBot(g); bots = g.soldiers.filter(s => s.isBot); }
  }

  roster() {
    return this.game.soldiers.map(s => ({ id: s.id, name: s.name, team: s.team, isBot: s.isBot, remote: !!s.remote }));
  }

  /** Everything a player needs to set up the match. (The chat so far only goes to players who just joined.) */
  welcome(p, { fresh = true } = {}) {
    p.link.send({
      t: 'welcome', v: PROTOCOL, you: p.soldier.id, tick: this.game.tick,
      match: this.opts.matchInfo(), roster: this.roster(), chat: fresh ? this.chatLog.slice(-8) : [],
    });
  }

  receive(p, data, reliable) {
    if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
      if (messageType(data) === 1) {
        try { p.ctl.push(decodeInputs(data)); } catch { /* garbled: ignore */ }
      }
      return;
    }
    if (!data || typeof data !== 'object') return;
    switch (data.t) {
      case 'ready': p.ready = true; break;
      case 'roster?':
        // The player saw a soldier it doesn't know: send the list again (at most once a second).
        if (Date.now() - (p.rosterAt || 0) > 1000) { p.rosterAt = Date.now(); p.link.send({ t: 'roster', roster: this.roster() }, true); }
        break;
      case 'ping': p.link.send({ t: 'pong', at: data.at }, false); break;
      case 'chat': {
        // At most 5 messages in 5 seconds each.
        const t = Date.now();
        p.said = (p.said || []).filter(x => t - x < 5000);
        if (p.said.length >= 5) break;
        p.said.push(t);
        this.chat(p.soldier?.name || p.name, data.text);
        break;
      }
      case 'bye': p.link.close('left'); break;
    }
  }

  /** Send a chat message from `name` to everyone. */
  chat(name, text) {
    const clean = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_CHAT);
    if (!clean) return;
    const msg = { t: 'chat', name: cleanName(name), text: clean };
    this.chatLog.push(msg);
    if (this.chatLog.length > 30) this.chatLog.shift();
    this.broadcast(msg);
    this.opts.onChat?.(msg);
  }

  system(text) {
    const msg = { t: 'chat', system: true, text };
    this.chatLog.push(msg);
    this.broadcast(msg);
    this.opts.onChat?.(msg);
  }

  broadcast(msg) {
    for (const p of this.players) p.link.send(msg, true);
  }

  // ---- Recording what happens (called by the game) ----------------------------------

  sound(name, x, y, to) { this.events.s.push(to == null ? [name, round(x), round(y)] : [name, round(x), round(y), to]); }
  note(text, to) { this.events.n.push([text, to]); }
  shake(x, y, amount) { this.events.sh.push([round(x), round(y), amount]); }
  feed(e) { this.events.k.push([e.text, e.weapon || null, e.killer?.id ?? null, e.victim?.id ?? null]); }
  fxCall(method, args) { if (!FX_SKIP.has(method) && this.events.fx.length < 300) this.events.fx.push([method, ...round(args)]); }

  /** Call after every game update: sends snapshots and events every few ticks. */
  afterTick() {
    const g = this.game;
    if (!g) return;
    if (g.tick === this.sentTick) {
      // The match is over and the clock has stopped: just refresh now and then.
      if (++this.idle % 30) return;
    } else if (g.tick % SNAPSHOT_EVERY !== 0) return;
    this.sentTick = g.tick;
    const ready = [...this.players].filter(p => p.ready);
    if (ready.length) {
      const world = encodeWorld(g);
      const e = this.events;
      const any = e.s.length || e.fx.length || e.k.length || e.n.length || e.sh.length;
      for (const p of ready) {
        p.link.send(encodeSnapshot(g, p.soldier, p.ctl.ackSeq, world), false);
        if (!any) continue;
        const id = p.soldier.id;
        p.link.send({
          t: 'ev', tick: g.tick,
          s: e.s.filter(x => x[3] == null || x[3] === id).map(x => x.slice(0, 3)),
          fx: e.fx, k: e.k, sh: e.sh,
          n: e.n.filter(x => x[1] === id).map(x => x[0]),
        }, true);
      }
    }
    this.resetEvents();
  }

  /** End the game for everyone. */
  close(reason = 'The host left the game') {
    for (const p of [...this.players]) {
      p.link.send({ t: 'end', reason }, true);
      setTimeout(() => p.link.close('host closed'), 300);
    }
    this.players.clear();
    if (this.game) this.game.recorder = null;
  }
}

/** Wrap the effects so the host records every effect it shows (to send to players). */
function recordFx(fx, host) {
  return new Proxy(fx, {
    get(target, prop) {
      if (prop === 'recording') return true;
      const v = target[prop];
      if (typeof v !== 'function' || prop === 'update' || prop === 'add') return v;
      return (...args) => { host.fxCall(prop, args); return v.apply(target, args); };
    },
  });
}

export function cleanName(name) {
  return String(name ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'Player';
}
