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
import { recipeById } from './crafting.js';
import { worldState, worldFromSave, playerToSave, rehire, dropItem, chestAt, boxFor, boxKind, claimsToSave, claimsFromSave, REACH, setRightHand, makeRecipe, devTake, equip, unequip, stackToChests } from './worldplay.js';
import { warp } from './waystones.js';
import { SLOTS } from './gear.js';
import { cleanGear } from './items.js';
import { mercsOf } from './monsters.js';
import { talkView, talkDo } from './talk.js';
import { progOf, spendPoint, applyProgress } from './progress.js';
import { questsOf, dropQuest } from './quests.js';
import { socialOptions, socialDo, tradeView, offerTrade, acceptTrade, cancelTrade, shareQuest } from './social.js';
import { cleanFound } from './codex.js';
import { cleanSettings, kitOf } from './worldrules.js';

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
    p.wsync = { tiles: [], inv: '', chest: null, chestV: -1, talk: '', trade: '', party: '', overflow: false, ops: [] };
    s.world = worldFromSave(this.load?.(s.name) || null, kitOf(this.game.world));
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
    return { seed: w.seed, name: w.name, gen: w.genVersion || 1, towns: !!w.towns, time: Math.floor(w.time || 0), pvp: w.pvp !== false, claims: claimsToSave(w), settings: w.settings || null };
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
    // (Their level and quests too: progress.js, quests.js. And who has work for them.)
    const pr = progOf(s), qs = questsOf(s), xg = w.xpGot?.at(-1);
    const key = `${w.inv.version}|${w.slot}|${w.slot2}|${w.brush}|${m ? `${m.tx},${m.ty},${m.dmg},${m.of}` : ''}|${w.got.length}:${last ? `${last.n}@${last.tick}` : ''}|${w.home ? `${w.home.x},${w.home.y}` : ''}|${pr.level}.${pr.xp}.${pr.points}.${JSON.stringify(pr.perks)}|${qs.v}.${qs.track}|${w.marksKey || ''}|${xg ? xg.tick : ''}|${w.levelUp?.tick ?? ''}|${w.raidInfo ? `${w.raidInfo.name}${w.raidInfo.left}` : ''}|${w.gearV || 0}|${(w.graves || []).join(';')}|${w.foundV || 0}|${w.sleep ? `z${this.game.world.asleep?.n}/${this.game.world.asleep?.of}` : ''}|${w.dev ? 'dev' : ''}`;
    if (key !== ws.inv) {
      ws.inv = key;
      p.link.send({
        t: 'inv', slots: w.inv.toJSON(), slot: w.slot, slot2: w.slot2, brush: w.brush, home: w.home || null,
        mine: m ? { tx: m.tx, ty: m.ty, dmg: m.dmg, of: m.of } : null,
        got: w.got.map(g => [g.key, g.n, g.tick]),
        prog: { xp: pr.xp, level: pr.level, points: pr.points, perks: pr.perks, stats: pr.stats, deepest: pr.seen.deepest, towns: pr.seen.towns.length },
        quests: { list: qs.list, track: qs.track, done: qs.done.size }, marks: w.marks || [],
        xpGot: (w.xpGot || []).map(x => [x.n, x.why, x.tick]), levelUp: w.levelUp || null, raid: w.raidInfo || null,
        gear: Object.fromEntries(SLOTS.map(k => [k, w.gear?.[k] ? [w.gear[k].key, w.gear[k].g] : null])),
        got2: w.got.map(g => [g.r || null, g.name || null]), graves: w.graves || [],
        sleep: w.sleep ? { since: w.sleep.since, n: this.game.world.asleep?.n || 1, of: this.game.world.asleep?.of || 1 } : null,
        // (What they've found, for the codex: only when it's more.)
        found: ws.foundV !== (w.foundV || 0) ? w.found || [] : undefined,
        // (In dev mode, theirs in a creative world: crafting's free, and the codex gives anything.)
        dev: w.dev ? 1 : 0,
      }, true);
      ws.foundV = w.foundV || 0;
    }
    // Playing together (social.js): another player right clicked on (what you can do with them),
    // a trade (when it changes, or ends), their party (as it changes).
    // (A waystone right clicked: where it can take them, as a player's menu is shown.)
    if (w.wayMenu) { p.link.send({ t: 'social', view: w.wayMenu }, true); w.wayMenu = null; }
    if (w.social) {
      const o = this.game.soldiers.find(x => x.id === w.social.id);
      if (o?.world) p.link.send({ t: 'social', view: { id: o.id, name: o.name, level: progOf(o).level, options: socialOptions(this.game, s, o) } }, true);
      w.social = null;
    }
    const tv = tradeView(this.game, s), tk = tv ? JSON.stringify(tv) : '';
    if (tk !== ws.trade) { p.link.send(tv ? { t: 'trade', view: tv } : { t: 'trade', close: true }, true); ws.trade = tk; }
    const pk = JSON.stringify(w.partyList || []);
    if (pk !== ws.party) { p.link.send({ t: 'party', list: w.partyList || [] }, true); ws.party = pk; }
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
      const inv = boxFor(this.game, s, ws.chest.tx, ws.chest.ty);
      const far = !s.alive || Math.hypot(ws.chest.tx * 16 + 8 - s.x, ws.chest.ty * 16 + 8 - s.y) > REACH * 1.5;
      if (!inv || far) { p.link.send({ t: 'chest', close: true }, true); ws.chest = null; }
      else if (inv.version !== ws.chestV) {
        ws.chestV = inv.version;
        p.link.send({ t: 'chest', tx: ws.chest.tx, ty: ws.chest.ty, slots: inv.toJSON(), ...boxKind(this.game.world, ws.chest.tx, ws.chest.ty) }, true);
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
    const chest = ws.chest && boxFor(g, s, ws.chest.tx, ws.chest.ty);
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
      case 'stack': g.notify(s, stackToChests(g, s)); break;
      case 'warp': { const text = warp(g, s, d.from, d.to); if (text) g.notify(s, text); break; }
      case 'take-all': if (chest) Inventory.sendAll(chest, w.inv, 0, HOTBAR); break;
      case 'put-all': if (chest) Inventory.sendAll(w.inv, chest, HOTBAR, 0); break;
      case 'drop': {
        const a = at(['me', d.i]);
        const t = a && w.inv.take(a[1]);
        if (t) dropItem(g, t.key, t.n, s.x + s.facing * 8, s.y - 14, s.facing * 3, -2, 60, t.g || null);
        break;
      }
      case 'craft': {
        // (Free in dev mode: theirs, in a creative world.)
        const r = recipeById(d.r), made = makeRecipe(g, s, r, Math.max(1, Math.min(5, d.times | 0)));
        if (made) g.notify(s, `Made ${made * r.n} × ${itemOf(r.key).name}`);
        break;
      }
      // (Dev mode: something from the codex, free.)
      case 'devtake': { const t = devTake(g, s, d.id); if (t) g.notify(s, t); break; }
      case 'close': ws.chest = null; break;
      // (In a talk: talk.js checks it all.)
      case 'talk': if (d.d && typeof d.d === 'object') talkDo(g, s, d.d); break;
      // (The journal: which quest's on the HUD, giving one up, spending a perk point.)
      case 'qtrack': if (typeof d.id === 'string' && questsOf(s).list.some(q => q.id === d.id)) { questsOf(s).track = d.id; questsOf(s).v++; } break;
      case 'qdrop': if (typeof d.id === 'string') dropQuest(s, d.id); break;
      case 'perk': if (typeof d.id === 'string') { const text = spendPoint(s, d.id); if (text) g.notify(s, text); } break;
      // (Playing together: social.js.)
      case 'social': {
        const o = g.soldiers.find(x => x.id === d.id);
        const text = o && typeof d.act === 'string' && Math.hypot(o.x - s.x, o.y - s.y) < 12 * 16 ? socialDo(g, s, o, d.act) : null;
        if (text) g.notify(s, text);
        break;
      }
      case 'toffer': offerTrade(g, s, d.slots, d.coins); break;
      case 'taccept': { const text = acceptTrade(g, s); if (text && text !== 'Traded') g.notify(s, text); break; }
      case 'tcancel': cancelTrade(g, s); break;
      case 'qshare': if (typeof d.id === 'string') { const text = shareQuest(g, s, d.id); if (text) g.notify(s, text); } break;
      // (Gear: worn, or taken off. gear.js.)
      case 'equip': if (Number.isInteger(d.i)) equip(g, s, d.i); break;
      case 'unequip': if (SLOTS.includes(d.slot)) { const text = unequip(g, s, d.slot); if (text && !text.startsWith('Took')) g.notify(s, text); } break;
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
  constructor({ onInv = null, onChest = null, onTalk = null, onSocial = null, onTrade = null } = {}) {
    this.onInv = onInv;
    this.onChest = onChest;
    this.onTalk = onTalk;
    this.onSocial = onSocial;
    this.onTrade = onTrade;
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
    // (The world's settings: the host's, the same for everyone: worldrules.js.)
    const settings = cleanSettings(info.settings);
    const world = new TileWorld({ seed: info.seed | 0, name: String(info.name || 'World').slice(0, 32), saved: this.saved, gen: info.gen ? Math.max(1, Math.min(3, info.gen | 0)) : info.towns === true ? 2 : 1, noTowns: settings.towns === 'off' });
    world.settings = settings;
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
      next.push({ key: d.key, n: d.n, x: d.x, y: d.y, px: from ? from.x : d.x, py: from ? from.y : d.y, rest: d.rest, r: d.r || null });
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
        if (Array.isArray(d.found)) w.found = cleanFound(d.found);
        w.devCraft = d.dev === 1;
        // (Asleep: the host keeps them in bed; here, the screen goes dark.)
        w.sleep = d.sleep && typeof d.sleep === 'object' ? { since: w.sleep?.since ?? Date.now(), n: d.sleep.n | 0, of: d.sleep.of | 0 } : null;
        w.graves = Array.isArray(d.graves) ? d.graves.filter(g => Array.isArray(g) && Number.isInteger(g[0]) && Number.isInteger(g[1])).slice(-8) : [];
        w.mine = d.mine && Number.isFinite(d.mine.dmg) ? d.mine : null;
        if (d.mine) w.mine.at = game.tick;
        w.got = (Array.isArray(d.got) ? d.got : []).map((g, i) => [g, d.got2?.[i]]).filter(([g]) => Array.isArray(g) && itemOf(g[0])).map(([[key, n, tick], extra]) => ({ key, n: n | 0, tick: Number(tick) || 0, ...(extra?.[0] ? { r: String(extra[0]), name: String(extra[1] || '') } : {}) }));
        // What we wear (gear.js), as the host has it.
        if (d.gear && typeof d.gear === 'object') {
          w.gear = Object.fromEntries(SLOTS.map(k => { const it = d.gear[k]; return [k, Array.isArray(it) && itemOf(it[0])?.kind === 'gear' ? { key: it[0], n: 1, g: cleanGear(it[1]) } : null]; }));
          w.gearV = (w.gearV || 0) + 1;
          applyProgress(me);
        }
        // Our level and quests, as the host has them (and our health by them).
        if (d.prog && typeof d.prog === 'object') {
          const p = d.prog;
          w.prog = { xp: Number(p.xp) || 0, level: Math.max(1, p.level | 0), points: p.points | 0, perks: p.perks && typeof p.perks === 'object' ? p.perks : {}, stats: p.stats && typeof p.stats === 'object' ? p.stats : {}, seen: { towns: new Array(p.towns | 0).fill(''), biomes: [], deepest: p.deepest | 0 } };
          applyProgress(me);
        }
        if (d.quests && Array.isArray(d.quests.list)) w.quests = { list: d.quests.list, track: typeof d.quests.track === 'string' ? d.quests.track : null, done: new Set(), doneCount: d.quests.done | 0, v: (w.quests?.v || 0) + 1 };
        w.marks = Array.isArray(d.marks) ? d.marks.filter(m => Array.isArray(m) && Number.isInteger(m[0])) : [];
        w.xpGot = Array.isArray(d.xpGot) ? d.xpGot.map(([n, why, tick]) => ({ n: n | 0, why: String(why || ''), tick: Number(tick) || 0 })) : [];
        if (d.levelUp && Number.isFinite(d.levelUp.tick)) w.levelUp = { level: d.levelUp.level | 0, tick: d.levelUp.tick };
        w.raidInfo = d.raid && typeof d.raid === 'object' ? { name: String(d.raid.name), left: d.raid.left | 0, total: d.raid.total | 0 } : null;
        this.onInv?.();
        break;
      }
      case 'chest':
        if (d.close) { this.onChest?.(null); break; }
        // (What it is, from the block there: a chest, a shulker box (which won't take one), an ender chest.)
        this.onChest?.({ inv: Object.assign(Inventory.from(d.slots, 30), { version: ++this.version }), tx: d.tx | 0, ty: d.ty | 0, kind: ['chest', 'shulker', 'ender'].includes(d.kind) ? d.kind : 'chest', name: String(d.name || 'Chest').slice(0, 40) });
        break;
      case 'claims': if (game.world) claimsFromSave(game.world, d.list); break;
      case 'talk': this.onTalk?.(d.close || !d.view || typeof d.view !== 'object' ? null : d.view); break;
      case 'social': if (d.view && typeof d.view === 'object') this.onSocial?.(d.view); break;
      case 'trade': this.onTrade?.(d.close || !d.view ? null : d.view); break;
      case 'party': if (me?.world) me.world.partyList = Array.isArray(d.list) ? d.list : []; break;
    }
  }
}
