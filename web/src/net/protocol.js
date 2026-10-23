// What host and players send each other during an online game.
//
// Fast, unreliable channel (binary, lost packets don't matter):
//   player -> host: inputs, 60 a second (each packet repeats the last few, in case one is lost)
//   host -> player: snapshots, 20 a second: every soldier, projectile and pickup
// Reliable channel (JSON): joining, the roster, sounds and effects, kill feed, chat,
// and class and loadout choices (player -> host).

import { WEAPONS } from '../weapons.js';
import { CLASS_IDS, UPGRADE_IDS } from '../classes.js';
import { REWARD_IDS } from '../streaks.js';

export const PROTOCOL = 14;           // bump when the messages change; older versions can't join
export const SNAPSHOT_EVERY = 3;      // ticks between snapshots (20 a second)

const WEAPON_IDS = Object.keys(WEAPONS);
const WEAPON_INDEX = new Map(WEAPON_IDS.map((id, i) => [id, i]));
const KINDS = ['bullet', 'rail', 'arrow', 'seeker', 'thrown', 'rocket', 'flame', 'fire', 'gas', 'walker', 'flyer', 'placed', 'donkey', 'cloud', 'sentry'];
const SPRITES = ['', 'bullet', 'slug', 'arrow', 'magic', 'grenade', 'bomblet', 'cluster', 'banana', 'holy', 'petrol', 'napalm', 'skunk',
  'rocket', 'homing', 'mortar', 'bomb', 'flame', 'fire', 'gas', 'sheep', 'supersheep', 'oldwoman', 'cow', 'dynamite', 'mine', 'donkey',
  'hegrenade', 'flashbang', 'smokegrenade', 'cloud', 'sentry', 'stampede'];
const ITEM_TYPES = ['health', 'armour', 'jetpack', 'weapon', 'crate', 'medkit', 'ammo'];

export const weaponIndex = id => WEAPON_INDEX.get(id) ?? 255;
export const weaponAt = i => WEAPON_IDS[i] || null;
// Classes (0: none) and weapon upgrades, as numbers.
const classIndex = cls => CLASS_IDS.indexOf(cls) + 1;
const classAt = i => CLASS_IDS[i - 1] || null;

const MSG = { input: 1, snapshot: 2 };
const NO_AMMO = 65535; // "infinite" in a u16
const TAU = Math.PI * 2;
const angleToU16 = a => Math.round((((a % TAU) + TAU) % TAU) / TAU * 65535);
const u16ToAngle = v => (v / 65535) * TAU;
const clampI16 = v => Math.max(-32768, Math.min(32767, Math.round(v)));
const clampU16 = v => Math.max(0, Math.min(65535, Math.round(v)));
const clampU8 = v => Math.max(0, Math.min(255, Math.round(v)));
const TEXT = new TextEncoder(), UNTEXT = new TextDecoder(), NONE = new Uint8Array(0);
// Mode state numbers to 3 decimal places (they're progress bars and positions).
const short = (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v);

// The end-of-match results from the host, checked (whatever arrives, the results screen must draw).
const num = v => (Number.isFinite(v) ? v : null);
const str = (v, n) => String(v ?? '').slice(0, n);
function cleanAwards(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(a => a && typeof a === 'object').slice(0, 8).map(a => ({
    id: str(a.id, 16), title: str(a.title, 32), soldier: num(a.soldier), name: str(a.name, 14), team: num(a.team) ?? 0, text: str(a.text, 60),
  }));
}
function cleanKill(k) {
  if (!k || typeof k !== 'object' || !Number.isFinite(k.tick)) return null;
  return {
    tick: k.tick, killer: num(k.killer), victim: num(k.victim), weapon: k.weapon == null ? null : str(k.weapon, 24),
    headshot: !!k.headshot, x: num(k.x) ?? 0, y: num(k.y) ?? 0,
  };
}

// ---- Byte writer / reader -------------------------------------------------------------

export class Writer {
  constructor(size = 2048) { this.buf = new ArrayBuffer(size); this.view = new DataView(this.buf); this.o = 0; }
  need(n) {
    if (this.o + n <= this.buf.byteLength) return;
    const bigger = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.o + n));
    new Uint8Array(bigger).set(new Uint8Array(this.buf, 0, this.o));
    this.buf = bigger; this.view = new DataView(bigger);
  }
  u8(v) { this.need(1); this.view.setUint8(this.o, v); this.o += 1; }
  i8(v) { this.need(1); this.view.setInt8(this.o, Math.max(-128, Math.min(127, Math.round(v)))); this.o += 1; }
  u16(v) { this.need(2); this.view.setUint16(this.o, v, true); this.o += 2; }
  i16(v) { this.need(2); this.view.setInt16(this.o, clampI16(v), true); this.o += 2; }
  u32(v) { this.need(4); this.view.setUint32(this.o, v >>> 0, true); this.o += 4; }
  f32(v) { this.need(4); this.view.setFloat32(this.o, v, true); this.o += 4; }
  bytes(u8) { this.need(u8.length); new Uint8Array(this.buf, this.o, u8.length).set(u8); this.o += u8.length; }
  done() { return new Uint8Array(this.buf, 0, this.o); }
}

export class Reader {
  constructor(data) {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    this.o = 0;
  }
  get left() { return this.view.byteLength - this.o; }
  u8() { const v = this.view.getUint8(this.o); this.o += 1; return v; }
  i8() { const v = this.view.getInt8(this.o); this.o += 1; return v; }
  u16() { const v = this.view.getUint16(this.o, true); this.o += 2; return v; }
  i16() { const v = this.view.getInt16(this.o, true); this.o += 2; return v; }
  u32() { const v = this.view.getUint32(this.o, true); this.o += 4; return v; }
  f32() { const v = this.view.getFloat32(this.o, true); this.o += 4; return v; }
}

export const messageType = data => (data instanceof Uint8Array ? data : new Uint8Array(data))[0];

// ---- Inputs ----------------------------------------------------------------------------

/**
 * A player's inputs: the newest last. Each is { seq, move, jump, jumpPressed, crouch, jet, fire, firePressed, alt,
 * selfDestruct, sprint, gadget, plank, use, drop, reload, aim, aimDist, switchTo, cycle, streak (a kill streak reward to use) }.
 */
export function encodeInputs(inputs) {
  const w = new Writer(16 + inputs.length * 14);
  w.u8(MSG.input);
  w.u32(inputs.length ? inputs[inputs.length - 1].seq : 0);
  w.u8(inputs.length);
  for (const i of inputs) {
    w.i8(Math.round((i.move || 0) * 100));
    w.u8((i.jump ? 1 : 0) | (i.jumpPressed ? 2 : 0) | (i.crouch ? 4 : 0) | (i.jet ? 8 : 0) | (i.fire ? 16 : 0) | (i.firePressed ? 32 : 0) | (i.alt ? 64 : 0) | (i.selfDestruct ? 128 : 0));
    w.u8((i.sprint ? 1 : 0) | (i.gadget ? 2 : 0) | (i.plank ? 4 : 0) | (i.use ? 8 : 0) | (i.drop ? 16 : 0) | (i.reload ? 32 : 0));
    w.u16(angleToU16(i.aim ?? 0));
    w.u16(clampU16(i.aimDist ?? 200));
    w.u8(i.switchTo ? weaponIndex(i.switchTo) + 1 : 0);
    w.i8(i.cycle || 0);
    w.u8(REWARD_IDS.indexOf(i.streak) + 1);
  }
  return w.done();
}

/** Returns [{ seq, ...input }], oldest first. Values are clamped, so anything a player sends is safe to use. */
export function decodeInputs(data) {
  const r = new Reader(data);
  if (r.u8() !== MSG.input) return [];
  const last = r.u32(), n = Math.min(r.u8(), 8);
  const out = [];
  for (let k = 0; k < n && r.left >= 10; k++) {
    const move = Math.max(-1, Math.min(1, r.i8() / 100));
    const f = r.u8(), f2 = r.u8();
    const aim = u16ToAngle(r.u16());
    const aimDist = r.u16();
    const sw = r.u8();
    const cycle = Math.sign(r.i8());
    const streak = REWARD_IDS[r.u8() - 1] || null;
    out.push({
      seq: last - (n - 1 - k), move, jump: !!(f & 1), jumpPressed: !!(f & 2), crouch: !!(f & 4), jet: !!(f & 8),
      fire: !!(f & 16), firePressed: !!(f & 32), alt: !!(f & 64), selfDestruct: !!(f & 128), sprint: !!(f2 & 1), gadget: !!(f2 & 2), plank: !!(f2 & 4),
      use: !!(f2 & 8), drop: !!(f2 & 16), reload: !!(f2 & 32), aim, aimDist,
      switchTo: sw ? weaponAt(sw - 1) : null, cycle: cycle || 0, streak,
    });
  }
  return out;
}

// ---- Snapshots ---------------------------------------------------------------------------

/** The part of a snapshot that's the same for every player. */
export function encodeWorld(game) {
  const w = new Writer(4096);
  w.u8(game.over ? 1 : 0);
  w.i16(game.teamScore[1]); w.i16(game.teamScore[2]);
  w.u8(game.quake ? 1 : 0);
  // Who won (soldier id + 1, or team + 100), 0 if nobody yet.
  w.u8(game.winner ? (game.winner.team ? 100 + game.winner.team : game.winner.soldier.id + 1) : 0);
  // How many holes have been blown in the map (destructible maps): players missing some ask for them.
  w.u16(Math.min(game.carves?.length || 0, 65535));
  // The objective modes' state (flags, capture points, M-COMs), as JSON.
  const mode = game.modeState ? TEXT.encode(JSON.stringify(game.modeState, short)) : NONE;
  w.u16(mode.length);
  w.bytes(mode);

  w.u8(game.soldiers.length);
  for (const s of game.soldiers) {
    const b = s.body;
    w.u8(s.id);
    w.u8((s.alive ? 1 : 0) | (b.crouching ? 2 : 0) | (b.onGround ? 4 : 0) | (b.jetting ? 8 : 0) | (b.hasJetpack ? 16 : 0) |
      (s.burnTicks > 0 ? 32 : 0) | (s.spawnProtect > 0 ? 64 : 0) | (s.kamikaze ? 128 : 0));
    w.u8((s.facing > 0 ? 1 : 0) | (b.rope ? 2 : 0) | (b.padLaunch ? 4 : 0) | (s.jugger > 0 ? 8 : 0));
    w.f32(b.x); w.f32(b.y);
    w.i16(b.vx * 100); w.i16(b.vy * 100);
    w.u16(angleToU16(s.aim));
    w.u8(clampU8(Math.ceil(Math.max(0, s.health)))); w.u8(clampU8(Math.ceil(s.armour)));
    w.u8(weaponIndex(s.current));
    const a = s.anim;
    w.u8(clampU8(a.run * 255)); w.u8(clampU8(a.flip * 255)); w.u8(clampU8(a.land * 20)); w.u8(clampU8(a.recoil * 40)); w.u8(clampU8(a.swing * 255));
    w.i16(s.frags); w.u16(clampU16(s.deaths)); w.i16(s.points || 0);
    w.u8(clampU8(s.level ?? 0)); w.u8(clampU8(s.lives ?? 0));
    w.u8(classIndex(s.cls));
    w.u16(clampU16(s.respawnTimer));
    w.u8(clampU8(b.fuel));
    w.u8(clampU8(s.streak || 0)); // (kills in a row: everyone sees who's on a streak)
    if (b.rope) { w.f32(b.rope.x); w.f32(b.rope.y); w.u16(clampU16(b.rope.len)); }
  }

  const live = game.projectiles.filter(p => !p.dead);
  w.u16(Math.min(live.length, 600));
  for (const p of live.slice(0, 600)) {
    w.u16(p.id & 0xffff);
    w.u8(Math.max(0, KINDS.indexOf(p.kind)));
    w.u8(Math.max(0, SPRITES.indexOf(p.sprite || '')));
    w.f32(p.x); w.f32(p.y);
    w.i16((p.vx || 0) * 50); w.i16((p.vy || 0) * 50);
    w.u16(angleToU16(p.angle || 0));
    // (A Sentry Sheep's team, in the last two bits: its colour.)
    w.u8(((p.dir ?? 1) < 0 ? 1 : 0) | (p.armed > 0 ? 0 : 2) | (p.stuck ? 4 : 0) | (p.delay > 0 ? 8 : 0) | (p.onGround ? 16 : 0) | (p.praying ? 32 : 0) |
      (p.team === 1 ? 64 : p.team === 2 ? 128 : 0));
    w.u16(clampU16(p.age || 0)); w.u16(clampU16(p.life || 0));
    w.u8(clampU8(p.r || 0));
  }

  const items = game.pickups.items;
  const fixed = items.filter(it => !it.dropped);
  w.u16(fixed.length);
  for (let i = 0; i < fixed.length; i += 8) {
    let bits = 0;
    for (let k = 0; k < 8 && i + k < fixed.length; k++) if (fixed[i + k].active) bits |= 1 << k;
    w.u8(bits);
  }
  const loose = items.filter(it => it.dropped);
  w.u8(Math.min(loose.length, 255));
  for (const it of loose.slice(0, 255)) {
    w.u8(ITEM_TYPES.indexOf(it.type));
    w.u8(it.weapon ? weaponIndex(it.weapon) : 255);
    w.f32(it.x); w.f32(it.y);
    w.u8((it.landed ? 1 : 0) | (it.health ? 2 : 0) | ((it.team & 3) << 2) | (it.streak ? 16 : 0));
    w.u16(clampU16(Math.min(it.life, 65000)));
  }
  // Spawn beacons (classes on).
  const beacons = game.beacons || [];
  w.u8(Math.min(beacons.length, 255));
  for (const b of beacons.slice(0, 255)) {
    w.u32(b.id); w.u8(b.owner & 255); w.u8(b.team & 3); // (the whole id: players pick beacons by it)
    w.f32(b.x); w.f32(b.y); w.u8(clampU8(Math.ceil(b.hp)));
  }
  // The match is over: the awards, and the kill that won it (for its replay), as JSON.
  const end = game.over && (game.awards || game.finalKill) ? TEXT.encode(JSON.stringify({ awards: game.awards || [], finalKill: game.finalKill || null })) : NONE;
  w.u16(end.length);
  w.bytes(end);
  return w.done();
}

/** One player's snapshot: their own details (weapons, exact movement state, last input used), then the world. */
export function encodeSnapshot(game, me, ackSeq, world) {
  const w = new Writer(256 + world.length);
  w.u8(MSG.snapshot);
  // (Which of the host's matches it's from: one from the last match can turn up after the welcome to the next.)
  w.u8((game.matchNo ?? 0) & 255);
  w.u32(game.tick);
  w.u32(ackSeq >>> 0);
  w.u8(me ? me.id : 255);
  if (me) {
    const b = me.body;
    w.f32(b.x); w.f32(b.y); w.f32(b.vx); w.f32(b.vy);
    w.u8((b.onGround ? 1 : 0) | (b.crouching ? 2 : 0) | (b.padLaunch ? 4 : 0) | (b.hasJetpack ? 8 : 0) | (b.winded ? 16 : 0) | (b.sprinting ? 32 : 0));
    w.f32(b.fuel); w.u8(clampU8(b.momentum)); w.f32(b.stamina);
    if (b.rope) { w.u8(1); w.f32(b.rope.x); w.f32(b.rope.y); w.f32(b.rope.len); } else w.u8(0);
    const owned = Object.keys(me.weapons).filter(id => WEAPON_INDEX.has(id));
    w.u8(owned.length);
    for (const id of owned) {
      const inv = me.weapons[id];
      w.u8(weaponIndex(id));
      w.u16(inv.ammo === Infinity ? NO_AMMO : clampU16(Math.min(inv.ammo, 65000)));
      // (The magazine plus one; 0 for a weapon without one.)
      w.u8(inv.mag == null ? 0 : clampU8(inv.mag + 1));
    }
    w.u16(clampU16(me.reloadTimer)); w.u16(clampU16(me.cooldown)); w.u8(clampU8(me.spin)); w.u16(clampU16(me.burnTicks));
    // Classes on: the gadget's recharge, and the upgrades on our weapons (for the HUD).
    w.u16(clampU16(me.gadgetCharge || 0));
    const mods = Object.entries(me.mods || {}).filter(([id, up]) => WEAPON_INDEX.has(id) && UPGRADE_IDS.includes(up));
    w.u8(mods.length);
    for (const [id, up] of mods) { w.u8(weaponIndex(id)); w.u8(UPGRADE_IDS.indexOf(up)); }
    w.u8(me.holdSpawn > 0 ? 1 : 0);
    // Blinded by a flashbang: for how long (in pairs of updates), and how long it was at first.
    w.u8(clampU8((me.flashTicks || 0) / 2)); w.u8(clampU8((me.flashFull || 0) / 2));
    // Kill streak rewards: Juggernaut time left, and the rewards banked (oldest first).
    w.u16(clampU16(me.jugger || 0));
    const bank = (me.bank || []).filter(id => REWARD_IDS.includes(id)).slice(0, 8);
    w.u8(bank.length);
    for (const id of bank) w.u8(REWARD_IDS.indexOf(id));
  }
  w.bytes(world);
  return w.done();
}

export function decodeSnapshot(data) {
  const r = new Reader(data);
  if (r.u8() !== MSG.snapshot) return null;
  const snap = { match: r.u8(), tick: r.u32(), ack: r.u32(), myId: r.u8(), me: null };
  if (snap.myId !== 255) {
    const me = { x: r.f32(), y: r.f32(), vx: r.f32(), vy: r.f32() };
    const f = r.u8();
    me.onGround = !!(f & 1); me.crouching = !!(f & 2); me.padLaunch = !!(f & 4); me.hasJetpack = !!(f & 8);
    me.winded = !!(f & 16); me.sprinting = !!(f & 32);
    me.fuel = r.f32(); me.momentum = r.u8(); me.stamina = r.f32();
    me.rope = r.u8() ? { x: r.f32(), y: r.f32(), len: r.f32() } : null;
    me.weapons = {};
    const n = r.u8();
    for (let i = 0; i < n; i++) {
      const id = weaponAt(r.u8()), ammo = r.u16(), mag = r.u8();
      if (!id) continue;
      me.weapons[id] = { ammo: ammo === NO_AMMO ? Infinity : ammo };
      if (mag) me.weapons[id].mag = mag - 1;
    }
    me.reloadTimer = r.u16(); me.cooldown = r.u16(); me.spin = r.u8(); me.burnTicks = r.u16();
    me.gadgetCharge = r.u16();
    me.mods = {};
    const nm = r.u8();
    for (let i = 0; i < nm; i++) {
      const id = weaponAt(r.u8()), up = UPGRADE_IDS[r.u8()];
      if (id && up) me.mods[id] = up;
    }
    me.holdSpawn = r.u8() ? 1 : 0;
    me.flashTicks = r.u8() * 2; me.flashFull = r.u8() * 2;
    me.jugger = r.u16();
    me.bank = [];
    const nb = r.u8();
    for (let i = 0; i < nb; i++) { const id = REWARD_IDS[r.u8()]; if (id && !me.bank.includes(id)) me.bank.push(id); }
    snap.me = me;
  }
  snap.over = !!r.u8();
  snap.teamScore = { 1: r.i16(), 2: r.i16() };
  snap.quake = !!r.u8();
  snap.winner = r.u8();
  snap.carves = r.u16();
  const ml = r.u16();
  snap.mode = null;
  if (ml) {
    try { snap.mode = JSON.parse(UNTEXT.decode(new Uint8Array(r.view.buffer, r.view.byteOffset + r.o, ml))); } catch { /* ignore a bad one */ }
    r.o += ml;
  }
  const ns = r.u8();
  snap.soldiers = [];
  for (let i = 0; i < ns; i++) {
    const s = { id: r.u8() };
    const f = r.u8(), g = r.u8();
    s.alive = !!(f & 1); s.crouching = !!(f & 2); s.onGround = !!(f & 4); s.jetting = !!(f & 8); s.hasJetpack = !!(f & 16);
    s.burning = !!(f & 32); s.protected = !!(f & 64); s.kamikaze = !!(f & 128);
    s.facing = g & 1 ? 1 : -1; const roped = !!(g & 2); s.padLaunch = !!(g & 4); s.jugger = g & 8 ? 1 : 0;
    s.x = r.f32(); s.y = r.f32(); s.vx = r.i16() / 100; s.vy = r.i16() / 100;
    s.aim = u16ToAngle(r.u16());
    s.health = r.u8(); s.armour = r.u8();
    s.current = weaponAt(r.u8()) || 'Platinum';
    s.anim = { run: r.u8() / 255, flip: r.u8() / 255, land: r.u8() / 20, recoil: r.u8() / 40, swing: r.u8() / 255 };
    s.frags = r.i16(); s.deaths = r.u16(); s.points = r.i16();
    s.level = r.u8(); s.lives = r.u8();
    s.cls = classAt(r.u8());
    s.respawnTimer = r.u16();
    s.fuel = r.u8();
    s.streak = r.u8();
    s.rope = roped ? { x: r.f32(), y: r.f32(), len: r.u16() } : null;
    snap.soldiers.push(s);
  }
  const np = r.u16();
  snap.projectiles = [];
  for (let i = 0; i < np; i++) {
    const p = { id: r.u16(), kind: KINDS[r.u8()], sprite: SPRITES[r.u8()] || undefined, x: r.f32(), y: r.f32(), vx: r.i16() / 50, vy: r.i16() / 50, angle: u16ToAngle(r.u16()) };
    const f = r.u8();
    p.dir = f & 1 ? -1 : 1; p.armed = f & 2 ? 0 : 1; p.stuck = !!(f & 4); p.delay = f & 8 ? 1 : 0; p.onGround = !!(f & 16); p.praying = !!(f & 32);
    p.team = f & 64 ? 1 : f & 128 ? 2 : 0;
    p.age = r.u16(); p.life = r.u16(); p.r = r.u8();
    snap.projectiles.push(p);
  }
  const nf = r.u16();
  snap.fixedItems = [];
  for (let i = 0; i < nf; i += 8) {
    const bits = r.u8();
    for (let k = 0; k < 8 && i + k < nf; k++) snap.fixedItems.push(!!(bits & (1 << k)));
  }
  const nl = r.u8();
  snap.looseItems = [];
  for (let i = 0; i < nl; i++) {
    const it = { type: ITEM_TYPES[r.u8()] };
    const wi = r.u8();
    it.weapon = wi === 255 ? null : weaponAt(wi);
    it.x = r.f32(); it.y = r.f32();
    const f = r.u8();
    it.landed = !!(f & 1); it.health = !!(f & 2); it.team = (f >> 2) & 3; it.streak = !!(f & 16);
    it.life = r.u16();
    snap.looseItems.push(it);
  }
  const nb = r.u8();
  snap.beacons = [];
  for (let i = 0; i < nb; i++) {
    snap.beacons.push({ id: r.u32(), owner: r.u8(), team: r.u8(), x: r.f32(), y: r.f32(), hp: r.u8() });
  }
  snap.end = null;
  const el = r.u16();
  if (el) {
    try {
      const e = JSON.parse(UNTEXT.decode(new Uint8Array(r.view.buffer, r.view.byteOffset + r.o, el)));
      snap.end = { awards: cleanAwards(e.awards), finalKill: cleanKill(e.finalKill) };
    } catch { /* ignore a bad one */ }
    r.o += el;
  }
  return snap;
}
