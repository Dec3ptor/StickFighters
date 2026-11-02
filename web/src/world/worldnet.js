// Worlds online: what the host of a world and the players in it send each other, on top of the
// game's own messages (protocol.js, host.js, client.js).
//
//   host -> player, as they join: the chunks changed so far ('chunks': each player makes the rest
//     from the seed), then the welcome (the seed, the time, PvP, the bases).
//   host -> player, with the events: every block changed since ('tc': [tx, ty, layer, value]).
//   host -> one player: their own things ('inv', when they change), the chest they've opened
//     ('chest') and who they're talking to ('talk': talk.js's view of it, when it changes); to
//     everyone, the bases when they change ('claims').
//   player -> host: what they do in their inventory screen ('wop': moving stacks, crafting, the
//     chest...) and in a talk ('wop' 'talk': buying, selling...), checked and done by the host.
//
// The host keeps each player's things in its world, by name: next time they join, they have them.

import { TileWorld } from './tileworld.js';
import { Inventory, HOTBAR, itemOf } from './items.js';
import { packBytes, unpackBytes } from './worldsave.js';
import { RECIPES, craft, stationsNear } from './crafting.js';
import { worldState, worldFromSave, playerToSave, rehire, dropItem, chestAt, claimsToSave, claimsFromSave, REACH, setRightHand } from './worldplay.js';
import { mercsOf } from './monsters.js';
import { talkView, talkDo } from './talk.js';

const LAYERS = ['fg', 'bg', 'shape'];
const CHUNKS_PER_MESSAGE = 40;
const MAX_BACKLOG = 50000;   // blocks changed waiting for one player (past it: the chunks again)
const OPS_PER_SECOND = 30;

const chunkKeyOf = c => (c.cx + 1048576) * 64 + c.cy;

// ---- The host -------------------------------------------------------------------------------------

export class WorldHost {
  /**
   * game: the world's game. load(name) / save(name, data): a player's things in the host's world
   * (by name).
   */
  constructor(game, { load = null, save = null } = {}) {
    this.game = game;
    this.load = load;
    this.save = save;
    this.changes = [];
    this.players = new Set();
    this.claimsKey = '';
    const world = game.world;
    world.listeners.push((tx, ty, layer) => {
      const v = layer === 'fg' ? world.tile(tx, ty) : layer === 'bg' ? world.wall(tx, ty) : world.shape(tx, ty);
      this.changes.push([tx, ty, LAYERS.indexOf(layer), v]);
    });
  }

  /** A player's joined (their soldier made): their things (if they've been here before). */
  join(p) {
    const s = p.soldier;
    p.wsync = { tiles: [], inv: '', chest: null, chestV: -1, talk: '', overflow: false, ops: [] };
    s.world = worldFromSave(this.load?.(s.name) || null);
    rehire(this.game, s);
    this.players.add(p);
  }

  /** A player's leaving: their things kept, their mercenaries gone with them. */
  leave(p) {
    const s = p.soldier;
    if (s?.world) this.save?.(s.name, playerToSave(s, this.game));
    if (s) for (const m of mercsOf(this.game, s)) this.game.removeSoldier(m);
    this.players.delete(p);
  }

  /** Everyone's things kept (when the host's world is saved). */
  saveAll() {
    for (const p of this.players) if (p.soldier?.world) this.save?.(p.soldier.name, playerToSave(p.soldier, this.game));
  }

  /** The chunks changed so far, to a player (before their welcome, or to catch them up). */
  sendChunks(p) {
    const world = this.game.world, list = [], seen = new Set();
    for (const c of world.chunks.values()) {
      if (!c.edited) continue;
      const k = chunkKeyOf(c);
      seen.add(k);
      list.push([k, packBytes(c.fg), packBytes(c.bg), packBytes(c.shape)]);
    }
    for (const [k, c] of world.saved) if (!seen.has(k)) list.push([k, packBytes(c.fg), packBytes(c.bg), packBytes(c.shape)]);
    for (let i = 0; i < list.length; i += CHUNKS_PER_MESSAGE) p.link.send({ t: 'chunks', list: list.slice(i, i + CHUNKS_PER_MESSAGE) }, true);
    p.wsync.tiles = [];
    p.wsync.overflow = false;
  }

  /** What the welcome says about the world. */
  info() {
    const w = this.game.world;
    return { seed: w.seed, name: w.name, gen: w.genVersion || 1, towns: !!w.towns, time: Math.floor(w.time || 0), pvp: w.pvp !== false, claims: claimsToSave(w) };
  }

  /** Each update: the blocks changed go to every player's backlog; the bases, when they change, to everyone. */
  tick() {
    if (this.changes.length) {
      for (const p of this.players) {
        const b = p.wsync.tiles;
        if (b.length + this.changes.length <= MAX_BACKLOG) for (const c of this.changes) b.push(c);
        else p.wsync.overflow = true;
      }
      this.changes.length = 0;
    }
    if (this.game.tick % 30 === 0) {
      const claims = claimsToSave(this.game.world), key = JSON.stringify(claims);
      if (key !== this.claimsKey) {
        this.claimsKey = key;
        for (const p of this.players) p.link.send({ t: 'claims', list: claims }, true);
      }
    }
  }

  /** For a ready player's next events: the blocks changed since the last. */
  events(p) {
    const w = p.wsync;
    if (!w) return null;
    if (w.overflow) this.sendChunks(p);
    if (!w.tiles.length) return null;
    const tc = w.tiles;
    w.tiles = [];
    return { tc };
  }

  /** A ready player's own things, and the chest they have open, when they've changed. */
  sync(p) {
    const s = p.soldier, w = s?.world, ws = p.wsync;
    if (!w || !ws) return;
    const m = w.mine, last = w.got[w.got.length - 1];
    const key = `${w.inv.version}|${w.slot}|${w.slot2}|${w.brush}|${m ? `${m.tx},${m.ty},${m.dmg},${m.of}` : ''}|${w.got.length}:${last ? `${last.n}@${last.tick}` : ''}|${w.home ? `${w.home.x},${w.home.y}` : ''}`;
    if (key !== ws.inv) {
      ws.inv = key;
      p.link.send({
        t: 'inv', slots: w.inv.toJSON(), slot: w.slot, slot2: w.slot2, brush: w.brush, home: w.home || null,
        mine: m ? { tx: m.tx, ty: m.ty, dmg: m.dmg, of: m.of } : null,
        got: w.got.map(g => [g.key, g.n, g.tick]),
      }, true);
    }
    // A chest opened with a right click (worldplay.js's interact): shown to them, and kept up to
    // date while it's open (closed if it goes, or they walk off).
    if (w.openChest) { ws.chest = w.openChest; ws.chestV = -1; w.openChest = null; }
    // Who they're talking to (talk.js), when anything in it changes (what's said, the shop's
    // stock, their coins), or it ends.
    const view = w.talk ? talkView(this.game, s) : null;
    const tkey = view ? `${view.id}|${view.v}|${view.coins}|${w.inv.version}|${JSON.stringify(view.shop?.stock || null)}|${view.options.map(o => o.price || 0).join()}` : '';
    if (tkey !== ws.talk) {
      if (view) p.link.send({ t: 'talk', view }, true);
      else if (ws.talk) p.link.send({ t: 'talk', close: true }, true);
      ws.talk = tkey;
    }
    if (ws.chest) {
      const inv = chestAt(this.game.world, ws.chest.tx, ws.chest.ty);
      const far = !s.alive || Math.hypot(ws.chest.tx * 16 + 8 - s.x, ws.chest.ty * 16 + 8 - s.y) > REACH * 1.5;
      if (!inv || far) { p.link.send({ t: 'chest', close: true }, true); ws.chest = null; }
      else if (inv.version !== ws.chestV) {
        ws.chestV = inv.version;
        p.link.send({ t: 'chest', tx: ws.chest.tx, ty: ws.chest.ty, slots: inv.toJSON() }, true);
      }
    }
  }

  /** What a player does in their inventory screen ({ op, ... }): checked, and done. */
  op(p, d) {
    const g = this.game, s = p.soldier, w = s?.world, ws = p.wsync;
    if (!w || !ws || !s.alive || !d || typeof d.op !== 'string') return;
    const now = Date.now();
    ws.ops = ws.ops.filter(t => now - t < 1000);
    if (ws.ops.length >= OPS_PER_SECOND) return;
    ws.ops.push(now);
    const chest = ws.chest && chestAt(g.world, ws.chest.tx, ws.chest.ty);
    const box = b => (b === 'chest' ? chest : b === 'me' ? w.inv : null);
    const at = a => (Array.isArray(a) && box(a[0]) && Number.isInteger(a[1]) && a[1] >= 0 && a[1] < box(a[0]).slots.length ? [box(a[0]), a[1]] : null);
    switch (d.op) {
      case 'move': { const a = at(d.a), b = at(d.b); if (a && b) Inventory.moveBetween(a[0], a[1], b[0], b[1]); break; }
      case 'split': { const a = at(d.a); if (a) a[0].split(a[1]); break; }
      case 'send': {
        const a = at(d.a);
        if (!a) break;
        if (chest) Inventory.send(a[0], a[1], a[0] === chest ? w.inv : chest, a[0] === chest ? HOTBAR : 0);
        else a[0].quickMove(a[1]);
        break;
      }
      case 'sort': w.inv.sortBag(); break;
      case 'take-all': if (chest) Inventory.sendAll(chest, w.inv, 0, HOTBAR); break;
      case 'put-all': if (chest) Inventory.sendAll(w.inv, chest, HOTBAR, 0); break;
      case 'drop': {
        const a = at(['me', d.i]);
        const t = a && w.inv.take(a[1]);
        if (t) dropItem(g, t.key, t.n, s.x + s.facing * 8, s.y - 14, s.facing * 3, -2, 60);
        break;
      }
      case 'craft': {
        const r = RECIPES[d.r];
        if (!r) break;
        const { made, left } = craft(w.inv, r, stationsNear(g.world, s.x, s.y - 8), Math.max(1, Math.min(5, d.times | 0)));
        if (left) dropItem(g, r.key, left, s.x, s.y - 14, s.facing * 2, -2, 30);
        if (made) g.notify(s, `Made ${made * r.n} × ${itemOf(r.key).name}`);
        break;
      }
      case 'close': ws.chest = null; break;
      // (In a talk: talk.js checks it all.)
      case 'talk': if (d.d && typeof d.d === 'object') talkDo(g, s, d.d); break;
      // (The inventory screen's right hand buttons: what right click uses.)
      case 'hand': {
        const i = d.slot;
        if (i === -1) w.slot2 = -1;
        else if (Number.isInteger(i) && i >= 0 && i < HOTBAR && w.slot2 !== i) setRightHand(g, s, String(i), true);
        break;
      }
    }
  }
}

// ---- A player in someone else's world -----------------------------------------------------------------

export class WorldClient {
  /**
   * onInv(): our things changed; onChest(chest | null): a chest opened ({ inv, tx, ty }), changed,
   * or closed; onTalk(view | null): a talk began, changed (talk.js's view), or ended.
   */
  constructor({ onInv = null, onChest = null, onTalk = null } = {}) {
    this.onInv = onInv;
    this.onChest = onChest;
    this.onTalk = onTalk;
    this.saved = new Map();
    this.game = null;
    this.me = null;
    this.version = 0;
  }

  /** Chunks from the host: kept for the world (before the welcome), or put straight in it. */
  chunks(list) {
    for (const row of Array.isArray(list) ? list : []) {
      if (!Array.isArray(row) || !Number.isInteger(row[0]) || row[0] < 0) continue;
      const fg = unpackBytes(row[1]), bg = unpackBytes(row[2]), shape = unpackBytes(row[3]);
      if (!fg || !bg || !shape) continue;
      if (this.game?.world) this.game.world.loadChunk(row[0], { fg, bg, shape });
      else this.saved.set(row[0], { fg, bg, shape });
    }
  }

  /** The host's world (from its welcome), made here from its seed and the chunks it's sent. */
  makeWorld(m) {
    const info = m.world || {};
    const world = new TileWorld({ seed: info.seed | 0, name: String(info.name || 'World').slice(0, 32), saved: this.saved, gen: info.gen ? Math.max(1, Math.min(3, info.gen | 0)) : info.towns === true ? 2 : 1 });
    world.time = Number(info.time) || 0;
    world.pvp = info.pvp !== false;
    claimsFromSave(world, info.claims);
    this.saved = new Map();
    return world;
  }

  /** The game's started (this is a copy of the host's: game.mirror). */
  attach(game, me) {
    this.game = game;
    this.me = me;
    game.mirror = true;
    // (Our things as the host has them: they come with its first message.)
    if (me) me.world = worldState(new Inventory());
  }

  /** Blocks changed on the host. */
  tiles(tc) {
    const world = this.game?.world;
    if (!world || !Array.isArray(tc)) return;
    for (const c of tc) {
      if (!Array.isArray(c) || c.length !== 4) continue;
      const layer = LAYERS[c[2]];
      if (layer) world.set(layer, c[0] | 0, c[1] | 0, c[3] | 0);
    }
  }

  /** A snapshot's world part: the time, and what's lying on the ground. */
  snapshot(sw) {
    const world = this.game?.world;
    if (!world) return;
    world.time = sw.time;
    const old = world.drops || [], next = [];
    for (const d of sw.drops) {
      // (Where it was: the nearest of the same thing last time, so it moves smoothly.)
      let from = null, best = 40 * 40;
      for (const o of old) {
        if (o.key !== d.key) continue;
        const dd = (o.x - d.x) ** 2 + (o.y - d.y) ** 2;
        if (dd < best) { best = dd; from = o; }
      }
      next.push({ key: d.key, n: d.n, x: d.x, y: d.y, px: from ? from.x : d.x, py: from ? from.y : d.y, rest: d.rest });
    }
    world.drops = next;
  }

  /** The host's messages about our things, our chest, and the bases. */
  message(d) {
    const me = this.me, game = this.game;
    if (!game) return;
    switch (d.t) {
      case 'inv': {
        if (!me) break;
        const w = me.world ||= worldState(new Inventory());
        w.inv = Inventory.from(d.slots);
        w.inv.version = ++this.version;
        w.slot = Math.max(0, Math.min(HOTBAR - 1, d.slot | 0));
        w.slot2 = Number.isInteger(d.slot2) && d.slot2 >= 0 && d.slot2 < HOTBAR ? d.slot2 : -1;
        if (typeof d.brush === 'string') w.brush = d.brush;
        w.home = d.home || null;
        w.mine = d.mine && Number.isFinite(d.mine.dmg) ? d.mine : null;
        if (d.mine) w.mine.at = game.tick;
        w.got = (Array.isArray(d.got) ? d.got : []).filter(g => Array.isArray(g) && itemOf(g[0])).map(([key, n, tick]) => ({ key, n: n | 0, tick: Number(tick) || 0 }));
        this.onInv?.();
        break;
      }
      case 'chest':
        if (d.close) { this.onChest?.(null); break; }
        this.onChest?.({ inv: Object.assign(Inventory.from(d.slots, 30), { version: ++this.version }), tx: d.tx | 0, ty: d.ty | 0 });
        break;
      case 'claims': if (game.world) claimsFromSave(game.world, d.list); break;
      case 'talk': this.onTalk?.(d.close || !d.view || typeof d.view !== 'object' ? null : d.view); break;
    }
  }
}
