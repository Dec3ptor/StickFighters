// Hosting an online game: the real match runs in the host's browser. Players
// send their inputs here; the host sends back snapshots (20 a second) and the
// events of the match (sounds, effects, the kill feed, messages).

import { encodeWorld, encodeSnapshot, decodeInputs, messageType, PROTOCOL, SNAPSHOT_EVERY } from './protocol.js';
import { cleanClass, cleanLoadouts } from '../classes.js';
import { holdSpawn } from '../gadgets.js';
import { isSkin } from '../skins.js';

// Effects every player draws for themselves from what they can see (rocket
// smoke, jetpack flames, burning soldiers), so they aren't sent.
const FX_SKIP = new Set(['smoke', 'fire', 'sparkle', 'spark']);
export const FX_METHODS = new Set(['blood', 'sparks', 'muzzle', 'shell', 'explosion', 'trail', 'ring', 'gibs', 'whack', 'plane', 'rubble', 'built', 'bang', 'killFlash']);
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
      next.gadget ||= old.gadget;
      next.drop ||= old.drop;
      next.reload ||= old.reload;
      next.streak ||= old.streak;
    }
  }

  input() {
    const next = this.queue.shift();
    if (next) { this.last = next; this.ackSeq = next.seq; return next; }
    // Nothing new arrived in time: keep doing the same thing (but don't repeat clicks).
    return { ...this.last, jumpPressed: false, firePressed: false, switchTo: null, cycle: 0, gadget: false, drop: false, reload: false, streak: null };
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
    this.matchNo = 0; // (each match is numbered, in its welcome and snapshots: see setGame)
    this.resetEvents();
  }

  resetEvents() { this.events = { s: [], fx: [], k: [], n: [], sh: [], c: [] }; }

  get humans() { return 1 + this.players.size; }

  /** Host this match. Players already connected get a soldier in it. */
  setGame(game) {
    this.game = game;
    // (The last match's snapshots can still be on their way: players tell them apart by this.)
    this.matchNo = (this.matchNo + 1) & 255;
    game.matchNo = this.matchNo;
    game.recorder = this;
    if (game.fx && !game.fx.recording) game.fx = recordFx(game.fx, this);
    this.resetEvents();
    this.idle = 0;
    this.carvesSent = 0; // (destructible maps: holes sent to everyone so far)
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
    const s = g.addSoldier({ name, isBot: false, team, skin: p.skin || 'auto' }, p.ctl);
    s.remote = true;
    s.respawnTimer = 20;
    // Classes on: their class and loadouts (sent by their browser). Until those arrive,
    // a new player waits to spawn (for at most a few seconds).
    if (g.classesOn) {
      if (p.kit) this.useKit(s, p.kit);
      else s.holdSpawn = 300;
    }
    // Joining one in the chamber late: no more lives than the players still in.
    if (g.mode === 'oitc') {
      const others = g.soldiers.filter(o => o !== s && o.lives > 0).map(o => o.lives);
      if (others.length) s.lives = Math.max(1, Math.min(s.lives, ...others));
    }
    // Spectating carries on into the next match.
    if (p.spectating) g.spectate(s, true, { quiet: true });
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
    return this.game.soldiers.map(s => ({ id: s.id, name: s.name, team: s.team, isBot: s.isBot, remote: !!s.remote, spec: !!s.spectating, skin: s.skin }));
  }

  /** Someone started or stopped spectating (called by the game): everyone's list of players changes. */
  rosterChanged() {
    if (this.players.size) this.broadcast({ t: 'roster', roster: this.roster() });
  }

  /** Everything a player needs to set up the match. (The chat so far only goes to players who just joined.) */
  welcome(p, { fresh = true } = {}) {
    p.link.send({
      t: 'welcome', v: PROTOCOL, n: this.matchNo, you: p.soldier.id, tick: this.game.tick,
      match: this.opts.matchInfo(), roster: this.roster(), chat: fresh ? this.chatLog.slice(-8) : [],
      carves: this.game.carves,
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
      case 'deploy': if (p.soldier) p.soldier.deployAt = data.at == null ? null : String(data.at).slice(0, 8); break;
      case 'carves?': {
        // The player is missing some of the holes blown in the map: send them (at most once a second).
        const from = Math.max(0, Math.floor(Number(data.from) || 0));
        if (Date.now() - (p.carvesAt || 0) > 1000) { p.carvesAt = Date.now(); p.link.send({ t: 'carves', from, list: this.game.carves.slice(from) }, true); }
        break;
      }
      case 'skin':
        // How they look (Settings, Character): everyone's told.
        if (!isSkin(data.skin) || p.skin === data.skin) break;
        p.skin = data.skin;
        if (p.soldier) p.soldier.skin = p.skin;
        this.rosterChanged();
        break;
      case 'kit':
        // Their class (for their next spawn) and loadouts. (Unlocks are kept in the player's own
        // browser, so the host can only check the choices make sense, not that they're earned.)
        p.kit = { cls: cleanClass(data.cls) || 'assault', loadouts: cleanLoadouts(data.loadouts) };
        if (p.soldier && this.game?.classesOn) {
          this.useKit(p.soldier, p.kit);
          holdSpawn(p.soldier, !!data.hold);
        }
        break;
      case 'buy': {
        // Defuse: buying (the host checks they can: buy zone, buy time, money, side).
        const g = this.game, s = p.soldier;
        if (!g?.rules.buyItem || !s) break;
        const t = Date.now();
        p.buys = (p.buys || []).filter(x => t - x < 1000);
        if (p.buys.length >= 12) break;
        p.buys.push(t);
        const why = g.rules.buyItem(g, s, String(data.item ?? '').slice(0, 24));
        if (why) g.notify(s, why);
        break;
      }
      case 'spectate':
        // They want to sit out and watch (or join again).
        p.spectating = !!data.on;
        if (p.soldier) this.game?.spectate(p.soldier, p.spectating);
        break;
      case 'roster?':
        // The player saw a soldier it doesn't know: send the list again (at most once a second).
        if (Date.now() - (p.rosterAt || 0) > 1000) { p.rosterAt = Date.now(); p.link.send({ t: 'roster', roster: this.roster() }, true); }
        break;
      case 'ping':
        p.link.send({ t: 'pong', at: data.at }, false);
        if (Number.isFinite(data.ms)) p.ping = Math.max(0, Math.min(9999, Math.round(data.ms)));
        break;
      case 'chat': {
        // At most 5 messages in 5 seconds each.
        const t = Date.now();
        p.said = (p.said || []).filter(x => t - x < 5000);
        if (p.said.length >= 5) break;
        p.said.push(t);
        this.chat(p.soldier?.name || p.name, data.text, p.soldier?.team);
        break;
      }
      case 'bye': p.link.close('left'); break;
    }
  }

  /** A player's class and loadouts on their soldier (used from their next spawn). */
  useKit(s, kit) {
    s.pickCls = kit.cls;
    s.loadouts = kit.loadouts;
  }

  /** Send a chat message from `name` (on `team`, in team modes: their name's shown in its colour) to everyone. */
  chat(name, text, team = 0) {
    const clean = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_CHAT);
    if (!clean) return;
    const msg = { t: 'chat', name: cleanName(name), text: clean };
    if (this.game?.rules.teams && (team === 1 || team === 2)) msg.team = team;
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
  // Kill streak callouts ('Double kill'): to one player (a soldier id), or everyone (null).
  callout(c) { if (this.events.c.length < 60) this.events.c.push([c.text, c.sub || '', c.kind || '', c.to, c.about]); }
  fxCall(method, args) { if (!FX_SKIP.has(method) && this.events.fx.length < 300) this.events.fx.push([method, ...round(args)]); }

  /** Call after every game update: sends snapshots and events every few ticks. */
  afterTick() {
    const g = this.game;
    if (!g) return;
    this.sharePings();
    if (g.tick === this.sentTick) {
      // The match is over and the clock has stopped: just refresh now and then.
      if (++this.idle % 30) return;
    } else if (g.tick % SNAPSHOT_EVERY !== 0 && !g.over) return; // (the moment it ends goes out at once)
    this.sentTick = g.tick;
    const ready = [...this.players].filter(p => p.ready);
    if (ready.length) {
      const world = encodeWorld(g);
      const e = this.events;
      // New holes in the map (destructible maps), numbered so players can tell if they missed any.
      const cv = g.carves.length > this.carvesSent ? { from: this.carvesSent, list: g.carves.slice(this.carvesSent) } : null;
      this.carvesSent = g.carves.length;
      const any = e.s.length || e.fx.length || e.k.length || e.n.length || e.sh.length || e.c.length || cv;
      for (const p of ready) {
        p.link.send(encodeSnapshot(g, p.soldier, p.ctl.ackSeq, world), false);
        if (!any) continue;
        const id = p.soldier.id;
        p.link.send({
          t: 'ev', tick: g.tick,
          // (A sound to one player, or to a team: a negative number. Soldier 0 is a player,
          // not team 0: in free-for-all everyone's on team 0, and 0 === -0.)
          s: e.s.filter(x => x[3] == null || x[3] === id || (x[3] < 0 && -x[3] === p.soldier.team)).map(x => x.slice(0, 3)),
          fx: e.fx, k: e.k, sh: e.sh, cv,
          n: e.n.filter(x => x[1] === id).map(x => x[0]),
          // ([text, sub, kind, mine (1: to this player, 0: everyone), about])
          c: e.c.filter(x => x[3] == null || x[3] === id).map(x => [x[0], x[1], x[2], x[3] == null ? 0 : 1, x[4]]),
        }, true);
      }
    }
    this.resetEvents();
  }

  /** Every couple of seconds: everyone's ping, for the scoreboard. */
  sharePings(now = Date.now()) {
    if (now - (this.pingsAt || 0) < 2000 || !this.players.size) return;
    this.pingsAt = now;
    const list = [];
    for (const p of this.players) {
      if (p.soldier && p.ping != null) { p.soldier.ping = p.ping; list.push([p.soldier.id, p.ping]); }
    }
    if (list.length) this.broadcast({ t: 'pings', list });
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
