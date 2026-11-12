// Hosting an online game: the real match runs in the host's browser. Players
// send their inputs here; the host sends back snapshots (20 a second) and the
// events of the match (sounds, effects, the kill feed, messages).

import { encodeWorld, encodeSnapshot, decodeInputs, messageType, PROTOCOL, SNAPSHOT_EVERY, SNAPSHOT_BUDGET, SNAPSHOT_FAST_PLAYERS } from './protocol.js';
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

/** Updates of nothing at all from a player (no key, no mouse) before they're sat out: a minute. */
export const IDLE_TICKS = 60 * 60;

export class NetHost {
  /**
   * opts: {
   *   maxPlayers, botCount,
   *   matchInfo(): what players need to set up the match (mode, map, ...),
   *   addBot(game): adds one bot to the game,
   *   setup(): the game as it's set up (bots, limits, who can join...), for whoever takes it
   *     over if the host goes (takeOver, main.js),
   *   onChange(): the player list changed,  onChat(message)
   * }
   */
  constructor(opts) {
    this.opts = opts;
    this.players = new Set();
    // (Those sent away by the host, by who they are to the game servers: not let back in.)
    this.sentAway = new Set();
    this.game = null;
    this.chatLog = [];
    this.matchNo = 0; // (each match is numbered, in its welcome and snapshots: see setGame)
    // (Updates between snapshots, 1 to 3, and how big they've been of late: pace.)
    this.every = SNAPSHOT_EVERY;
    this.snapBytes = 0;
    // (Who'd take the game over if the host went: pickHeir. And what those who've gone had to
    // their names, to give back if they come back: by who they are, this match; or by name, in a
    // game carried on from a host who left: keep, recall.)
    this.heir = null;
    this.kept = new Map();
    this.carried = null;
    this.resetEvents();
  }

  /**
   * How often snapshots go out: every update (60 a second), every other (30) or every third (20).
   * As often as the host's upload can take, by how many players there are and how big the
   * snapshots have been: a duel is shown 60 times a second, a full server 20. (Going faster
   * waits till there's room to spare, so it doesn't flip back and forth.) A world: 20.
   */
  pace() {
    const n = [...this.players].filter(p => p.ready).length;
    if (!n || this.opts.world) { this.every = SNAPSHOT_EVERY; return this.every; }
    const each = n * (this.snapBytes || 700);   // (bytes a second for each snapshot a second)
    const fits = every => each * (60 / every) <= SNAPSHOT_BUDGET * (every < this.every ? 0.8 : 1);
    this.every = n <= SNAPSHOT_FAST_PLAYERS && fits(1) ? 1 : fits(2) ? 2 : SNAPSHOT_EVERY;
    return this.every;
  }

  resetEvents() { this.events = { s: [], fx: [], ft: [], k: [], n: [], sh: [], c: [] }; }

  get humans() { return 1 + this.players.size; }

  /** How many players are playing now (not sitting out). */
  get playing() {
    const g = this.game;
    return g ? g.soldiers.filter(s => !s.isBot && !s.npc && !s.spectating).length : this.humans;
  }

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
    this.sentTick = -1;
    this.sentOver = false;
    this.carvesSent = 0; // (destructible maps: holes sent to everyone so far)
    // (A new match: what anyone had in the last is done with. What's carried on from another
    // host is for the first match here only.)
    this.kept.clear();
    if (this.carried && this.carried.match == null) this.carried.match = this.matchNo;
    else this.carried = null;
    for (const p of this.players) {
      p.soldier = this.soldierFor(p);
      p.ctl.queue.length = 0;
      p.ready = false;
    }
    // Bots first, so the welcome's roster includes them.
    this.balanceBots();
    // (Carried on from a host who left: the host's own soldier and the bots have what theirs
    // had, the bots on the sides theirs were on; they're evened up as the players arrive.)
    if (this.carried) {
      for (const s of game.soldiers) {
        if (s.remote) continue;
        const rec = this.carriedFor(s.name);
        if (rec && s.isBot && game.rules.teams && (rec.team === 1 || rec.team === 2) && !s.alive) s.team = rec.team;
        this.giveBack(s, rec);
      }
    }
    for (const p of this.players) this.welcome(p, { fresh: false });
  }

  /** A player has connected: give them a soldier and everything they need to join. */
  addPlayer(link, name, key = null) {
    // (key: who they are to the game servers, the same each time they join: for sending someone away for good.)
    const p = { link, name: cleanName(name), key, ctl: new RemoteController(), ready: false, joined: Date.now() };
    this.players.add(p);
    link.onmessage = (data, reliable) => this.receive(p, data, reliable);
    link.onclose = () => this.removePlayer(p, 'left');
    p.soldier = this.soldierFor(p);
    // (A world: their things, if they've been in it before.)
    this.opts.world?.join(p);
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
      // (The side with fewer players; the same, the one with fewer in all. The side they chose
      // last match, if they changed: carried on, while it doesn't put two more on it than the other.
      // Or the side this match gives them: shuffled, or Rush's sides swapped: planSides.)
      const n = t => g.soldiers.filter(s => s.team === t && !s.isBot && !s.spectating).length;
      const all = t => g.soldiers.filter(s => s.team === t && !s.spectating).length;
      team = n(1) !== n(2) ? (n(1) < n(2) ? 1 : 2) : all(1) <= all(2) ? 1 : 2;
      if (p.team && n(p.team) - n(3 - p.team) < 1) team = p.team;
      if (p.nextTeam) { team = p.team = p.nextTeam; p.nextTeam = 0; }
    }
    // (Back after dropping out of this match, or here from a game whose host left: the side
    // they were on, and what they had to their name: recall.)
    const back = this.recall(p);
    if (back && g.rules.teams && (back.team === 1 || back.team === 2)) team = p.team = back.team;
    let name = p.name, k = 2;
    while (g.soldiers.some(s => s.name.toLowerCase() === name.toLowerCase())) name = `${p.name.slice(0, 12)}${k++}`;
    const s = g.addSoldier({ name, isBot: false, team, skin: p.skin || 'auto' }, p.ctl);
    s.remote = true;
    s.respawnTimer = 20;
    this.giveBack(s, back);
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
    // Spectating carries on into the next match (and so does being away: sat out till they're back).
    if (p.spectating || p.afk) g.spectate(s, true, { quiet: true });
    // (Still away: nothing from them yet, as far as this match knows.)
    if (p.afk && !p.spectating) { s.afk = true; s.activeTick = -1e9; }
    return s;
  }

  removePlayer(p, why = 'left') {
    if (!this.players.delete(p)) return;
    this.opts.world?.leave(p);
    // (What they had, kept a while: a dropped connection that comes back carries on where it was.)
    if (this.game && p.soldier && p.key && !this.game.world && !this.sentAway.has(p.key)) this.kept.set(p.key, { ...NetHost.record(p.soldier), match: this.matchNo, at: Date.now() });
    if (this.game && p.soldier) this.game.removeSoldier(p.soldier);
    this.balanceBots();
    this.broadcast({ t: 'roster', roster: this.roster() });
    this.system(`${p.soldier?.name || p.name} ${why}`);
    this.pickHeir();
    this.opts.onChange?.();
  }

  /** What a soldier has to their name in a match: their side and their scores. */
  static record(s) {
    return { name: s.name, team: s.team, frags: s.frags | 0, deaths: s.deaths | 0, points: s.points | 0, level: s.level, lives: s.lives };
  }

  /**
   * The game's carried on from a host who left (takeOver, main.js): what everyone had there, by
   * name ([{ name, team, frags, deaths, points, level, lives }]), is given to whoever turns up
   * here under that name in the first match, while it's fresh. scores: false for a mode that
   * starts again (only the sides are kept).
   */
  carryOver(list, { scores = true, now = Date.now() } = {}) {
    const by = new Map();
    for (const r of list || []) if (r && typeof r.name === 'string') by.set(r.name.toLowerCase(), scores ? r : { name: r.name, team: r.team });
    this.carried = { by, match: null, until: now + 180000 };
  }

  /** What's carried on for the soldier named `name`, if anything is (once: it's theirs now). */
  carriedFor(name, now = Date.now()) {
    const c = this.carried;
    if (!c || now > c.until) return null;
    const key = String(name || '').toLowerCase(), rec = c.by.get(key);
    if (rec) c.by.delete(key);
    return rec || null;
  }

  /** What player p had before, if they're back: in this match (by who they are), or in the game this one carries on (by name). */
  recall(p, now = Date.now()) {
    const k = p.key && this.kept.get(p.key);
    if (k) {
      this.kept.delete(p.key);
      if (k.match === this.matchNo && now - k.at < 300000) return k;
    }
    return this.carried && this.carried.match === this.matchNo ? this.carriedFor(p.name, now) : null;
  }

  /** Soldier s has what `rec` says they had (their scores; their side's chosen before they're made). */
  giveBack(s, rec) {
    if (!rec || rec.frags == null) return;
    const n = (v, hi) => Math.max(0, Math.min(hi, v | 0));
    s.frags = Math.max(-999, Math.min(9999, rec.frags | 0));
    s.deaths = n(rec.deaths, 9999);
    s.points = n(rec.points, 99999);
    if (s.level !== undefined && rec.level != null) s.level = n(rec.level, 99);
    if (s.lives !== undefined && rec.lives != null) s.lives = n(rec.lives, 9);
  }

  /**
   * Who'd take the game over if the host went: of the players connected (and not away), the one
   * with a good connection who's been here longest. Everyone's told who, whenever it changes
   * (and in their welcome), so they all know where to go.
   */
  pickHeir() {
    let best = null;
    for (const p of this.players) {
      if (!p.ready || !p.key || p.afk || !p.soldier) continue;
      const slow = p.ping > 250 ? 1 : 0;
      if (!best || slow < best.slow || (slow === best.slow && p.joined < best.p.joined)) best = { p, slow };
    }
    const heir = best && !this.game?.world ? { key: best.p.key, name: best.p.soldier.name } : null;
    if (heir?.key !== this.heir?.key || heir?.name !== this.heir?.name) {
      this.heir = heir;
      this.broadcast({ t: 'heir', heir });
    }
    return heir;
  }

  /**
   * Bots fill the game up to the bot count, and make room when players join: the one that goes is
   * from the side with more on it (the one of its bots with the fewest frags), and the sides are
   * evened up with bots after (game.js's evenTeams), so a player joining doesn't leave them lopsided.
   */
  balanceBots() {
    const g = this.game;
    if (!g) return;
    // (Room for the players playing: someone sitting out, by choice or for being away, leaves theirs to a bot.)
    const want = Math.max(0, Math.min(this.opts.botCount, this.opts.maxPlayers - this.playing));
    // (Bots only: not a world's monsters or mercenaries.)
    let bots = g.soldiers.filter(s => s.isBot && !s.npc);
    while (bots.length > want) {
      let from = bots;
      if (g.rules.teams) {
        const big = g.teamSize(1) === g.teamSize(2) ? 0 : g.teamSize(1) > g.teamSize(2) ? 1 : 2;
        const theirs = bots.filter(b => b.team === big);
        if (theirs.length) from = theirs;
      }
      const worst = [...from].sort((a, b) => a.frags - b.frags)[0];
      g.removeSoldier(worst);
      bots = bots.filter(b => b !== worst);
    }
    while (bots.length < want) { this.opts.addBot(g); bots = g.soldiers.filter(s => s.isBot && !s.npc); }
    g.evenTeams?.();
  }

  /**
   * Whether the player whose soldier is `s` may go over to the other side now: in a team game,
   * while it wouldn't leave that side with two more players than theirs (bots even the rest up).
   * The host may always (it's their game: playing alongside a friend against bots, say).
   * Returns why not, or null.
   */
  cantSwitch(s, isHost = false) {
    const g = this.game;
    if (!g?.rules.teams || g.over) return "There are no sides to change in this game";
    if (!s || s.spectating) return "You're watching: join the game first";
    if (isHost) return null;
    const n = t => g.soldiers.filter(o => o.team === t && !o.isBot && !o.spectating).length;
    const to = 3 - s.team;
    return n(to) + 1 - (n(s.team) - 1) > 1 ? 'That side has enough players already' : null;
  }

  /** The player whose soldier is `s` over to the other side (if they may), the bots evened up after. Returns why not, or null. */
  switchTeam(s, isHost = false) {
    const why = this.cantSwitch(s, isHost);
    if (why) return why;
    const g = this.game;
    if (!g.switchTeam(s, 3 - s.team)) return 'Not now';
    for (const p of this.players) if (p.soldier === s) p.team = s.team;
    if (isHost) this.hostTeam = s.team;
    g.evenTeams();
    return null;
  }

  roster() {
    return this.game.soldiers.map(s => ({ id: s.id, name: s.name, team: s.team, isBot: s.isBot, remote: !!s.remote, spec: !!s.spectating, skin: s.skin, npc: s.npc?.guard ? 'guard' : s.npc?.kind || null, hidden: !!s.world?.dev?.invisible }));
  }

  /** The host sends the player whose soldier is `id` away (a world's dev menu). Returns whether there was one. */
  kick(id) {
    const p = [...this.players].find(q => q.soldier?.id === id);
    if (!p) return false;
    // (And not let back in, while this game's hosted.)
    if (p.key) this.sentAway.add(p.key);
    p.link.send({ t: 'chat', system: true, text: 'The host sent you away' }, true);
    this.removePlayer(p, 'was sent away by the host');
    try { p.link.close?.(); } catch { /* already gone */ }
    return true;
  }

  /**
   * The sides for the next match (called before it's made): 'shuffle', everyone on a side at
   * random, as even as can be; 'swap', everyone on the other side from now (Rush: attackers and
   * defenders change over). `hostTeam`: the host's side now. Returns the host's side for it.
   */
  planSides(how, hostTeam, rng = Math.random) {
    const ps = [...this.players];
    if (how === 'swap') {
      for (const p of ps) p.nextTeam = 3 - (p.soldier?.team || p.team || 1);
      return 3 - (hostTeam === 2 ? 2 : 1);
    }
    if (how !== 'shuffle') return hostTeam;
    // (Everyone, the host among them, in a new order; then turn about, from a side at random.)
    const all = [null, ...ps];
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    const first = rng() < 0.5 ? 1 : 2;
    let mine = hostTeam;
    all.forEach((p, i) => { const t = i % 2 ? 3 - first : first; if (p) p.nextTeam = t; else mine = t; });
    return mine;
  }

  /**
   * Players who've done nothing at all for a long while (no key, no mouse) are sat out, so their
   * side isn't a soldier short: a bot takes their place while there's room, and the sides are
   * evened up. The moment they do anything, they're back in. (Called every half second.)
   */
  benchIdle() {
    const g = this.game, limit = this.opts.idleTicks ?? IDLE_TICKS;
    if (!g || g.over || g.world || !(limit > 0)) return;
    let changed = false;
    for (const s of g.soldiers) {
      if (s.isBot || s.npc) continue;
      const idle = g.tick - s.activeTick, p = [...this.players].find(q => q.soldier === s);
      if (!s.spectating && !s.afk && idle > limit) {
        s.afk = true;
        if (p) p.afk = true;
        g.spectate(s, true, { quiet: true });
        this.system(`${s.name} is away, and sits out till they're back`);
        changed = true;
      } else if (s.afk && (idle < 90 || !s.spectating)) {
        // (Back: anything at all from them. Or they've joined again themselves.)
        s.afk = false;
        if (p) p.afk = false;
        if (s.spectating && !(p && p.spectating)) { g.spectate(s, false, { quiet: true }); this.system(`${s.name} is back`); }
        changed = true;
      }
    }
    if (changed) this.balanceBots();
  }

  /** Someone started or stopped spectating (called by the game): everyone's list of players changes. */
  rosterChanged() {
    if (this.players.size) this.broadcast({ t: 'roster', roster: this.roster() });
  }

  /** Everything a player needs to set up the match. (The chat so far only goes to players who just joined.) */
  welcome(p, { fresh = true } = {}) {
    // (A world: the chunks changed so far go first.)
    this.opts.world?.sendChunks(p);
    p.link.send({
      t: 'welcome', v: PROTOCOL, n: this.matchNo, you: p.soldier.id, tick: this.game.tick,
      match: this.opts.matchInfo(), roster: this.roster(), chat: fresh ? this.chatLog.slice(-8) : [],
      carves: this.game.carves,
      // (Who takes over if the host goes, and the game as it's set up, for them to carry on with.)
      heir: this.heir, setup: this.opts.setup?.() || null,
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
      case 'ready': p.ready = true; this.pickHeir(); break;
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
        if (p.soldier) { this.game?.spectate(p.soldier, p.spectating); this.game?.evenTeams?.(); }
        break;
      case 'team': {
        // They want to change sides (at most once every couple of seconds).
        if (!p.soldier || !this.game || Date.now() - (p.teamAt || 0) < 2000) break;
        p.teamAt = Date.now();
        const why = this.switchTeam(p.soldier);
        if (why) this.game.notify(p.soldier, why);
        break;
      }
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
      case 'wop': this.opts.world?.op(p, data); break;
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
  feed(e) { this.events.k.push([e.text, e.weapon || null, e.killer?.id ?? null, e.victim?.id ?? null, e.headshot ? 1 : 0]); }
  // Kill streak callouts ('Double kill'): to one player (a soldier id), or everyone (null).
  callout(c) { if (this.events.c.length < 60) this.events.c.push([c.text, c.sub || '', c.kind || '', c.to, c.about]); }
  // (Each effect with the update it happened in: a batch goes out every few, and players show
  // each at its own, so a gun's flash comes with its shot.)
  fxCall(method, args) {
    if (FX_SKIP.has(method) || this.events.fx.length >= 300) return;
    this.events.fx.push([method, ...round(args)]);
    this.events.ft.push(this.game?.tick ?? 0);
  }

  /** Call after every game update: sends snapshots and events every few ticks. */
  afterTick() {
    const g = this.game;
    if (!g) return;
    this.opts.world?.tick();
    this.sharePings();
    if (g.tick % 30 === 11) this.benchIdle();
    // (Soldiers come and go besides players: a world's monsters, mercenaries and townsfolk.
    // Everyone's told. An id can be given to someone new: their name and look count too.)
    if (g.tick % 15 === 0 && this.players.size) {
      let sig = '';
      for (const s of g.soldiers) sig += `${s.id}${s.name}${s.skin}${s.world?.dev?.invisible ? 'h' : ''},`;
      if (sig !== this.rosterSig) {
        const first = this.rosterSig == null;
        this.rosterSig = sig;
        if (!first) this.broadcast({ t: 'roster', roster: this.roster() });
      }
    }
    if (g.tick === this.sentTick && (!g.over || this.sentOver)) {
      // The match is over and the clock has stopped: just refresh now and then.
      if (++this.idle % 30) return;
    } else {
      if (g.tick % 60 === 7) this.pace();
      if (g.tick - this.sentTick < this.every && !g.over) return; // (the moment it ends goes out at once)
    }
    this.sentTick = g.tick;
    // (Its ending said: it can end after this update's snapshot has gone, with them going every update.)
    this.sentOver = !!g.over;
    const ready = [...this.players].filter(p => p.ready);
    if (ready.length) {
      const world = encodeWorld(g);
      const e = this.events;
      // New holes in the map (destructible maps), numbered so players can tell if they missed any.
      const cv = g.carves.length > this.carvesSent ? { from: this.carvesSent, list: g.carves.slice(this.carvesSent) } : null;
      this.carvesSent = g.carves.length;
      const any = e.s.length || e.fx.length || e.k.length || e.n.length || e.sh.length || e.c.length || cv;
      const ft = e.ft.map(t => g.tick - t); // (how many updates before this one each effect was)
      for (const p of ready) {
        const snap = encodeSnapshot(g, p.soldier, p.ctl.ackSeq, world);
        this.snapBytes += (snap.length - this.snapBytes) * (this.snapBytes ? 0.05 : 1);
        // (Not onto a pile of them still waiting to go: a newer one follows.)
        if (!(p.link.backlog > 24000)) p.link.send(snap, false);
        // (A world: their things and their chest when they change, and the blocks changed.)
        this.opts.world?.sync(p);
        const wx = this.opts.world?.events(p);
        if (!any && !wx) continue;
        const id = p.soldier.id;
        p.link.send({
          t: 'ev', tick: g.tick,
          // (A sound to one player, or to a team: a negative number. Soldier 0 is a player,
          // not team 0: in free-for-all everyone's on team 0, and 0 === -0.)
          s: e.s.filter(x => x[3] == null || x[3] === id || (x[3] < 0 && -x[3] === p.soldier.team)).map(x => x.slice(0, 3)),
          fx: e.fx, ft, k: e.k, sh: e.sh, cv,
          n: e.n.filter(x => x[1] === id).map(x => x[0]),
          // ([text, sub, kind, mine (1: to this player, 0: everyone), about])
          c: e.c.filter(x => x[3] == null || x[3] === id).map(x => [x[0], x[1], x[2], x[3] == null ? 0 : 1, x[4]]),
          ...wx,
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
    this.pickHeir();
  }

  /**
   * The host's going. over: the game ends for everyone (the host chose to end it); otherwise
   * it carries on without them: whoever's next in line hosts it (pickHeir), and the rest follow.
   */
  close(reason = 'The host left the game', { over = false } = {}) {
    for (const p of [...this.players]) {
      p.link.send({ t: 'end', reason, over: !!over }, true);
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
