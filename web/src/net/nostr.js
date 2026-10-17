// A small Nostr client (https://github.com/nostr-protocol/nips): keys, signed
// events, sealed messages between two keys, and a pool of relay connections.
// Public Nostr relays are how players find games and connect to each other
// without a game server. Runs in browsers and in Node 22+ (tests, tools).

import { schnorr, getSharedSecret, utils } from '../../vendor/noble-secp256k1.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

export const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export function fromHex(text) {
  if (typeof text !== 'string' || text.length % 2 || /[^0-9a-f]/i.test(text)) throw new Error('bad hex');
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.substr(i * 2, 2), 16);
  return out;
}
const toB64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const fromB64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

export const now = () => Math.floor(Date.now() / 1000);
export const randomId = (bytes = 8) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));

/** A key pair: { secret, pubkey } as hex. Pass a stored secret to reuse it. */
export function makeKeys(secret) {
  const sk = secret ? fromHex(secret) : utils.randomSecretKey();
  return { secret: toHex(sk), pubkey: toHex(schnorr.getPublicKey(sk)) };
}

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/** Sign an event template { kind, tags, content, created_at? } (NIP-01). */
export async function signEvent(template, keys) {
  const ev = {
    pubkey: keys.pubkey,
    created_at: template.created_at ?? now(),
    kind: template.kind,
    tags: template.tags || [],
    content: template.content ?? '',
  };
  const id = await sha256(enc.encode(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content])));
  ev.id = toHex(id);
  ev.sig = toHex(await schnorr.signAsync(id, fromHex(keys.secret)));
  return ev;
}

/** Check an event's id and signature. */
export async function verifyEvent(ev) {
  try {
    const id = await sha256(enc.encode(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content])));
    if (toHex(id) !== ev.id) return false;
    return await schnorr.verifyAsync(fromHex(ev.sig), id, fromHex(ev.pubkey));
  } catch { return false; }
}

// ---- Sealed messages ------------------------------------------------------------
// Connection details (which include IP addresses) travel through public relays,
// so they're encrypted for the one player they're meant for: ECDH between the
// two keys, then AES-GCM.

const sharedKeys = new Map();
async function sharedKey(keys, theirPubkey) {
  const k = keys.secret + theirPubkey;
  if (!sharedKeys.has(k)) {
    const point = getSharedSecret(fromHex(keys.secret), fromHex('02' + theirPubkey), true);
    const raw = await sha256(new Uint8Array([...point.subarray(1), ...enc.encode('stick-soldiers-seal-v1')]));
    sharedKeys.set(k, await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
  }
  return sharedKeys.get(k);
}

export async function seal(keys, theirPubkey, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sharedKey(keys, theirPubkey), enc.encode(text)));
  return toB64(iv) + '.' + toB64(data);
}

export async function unseal(keys, theirPubkey, sealed) {
  const [iv, data] = String(sealed).split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, await sharedKey(keys, theirPubkey), fromB64(data));
  return dec.decode(plain);
}

// ---- Relays -----------------------------------------------------------------------

/**
 * Connections to several relays at once. Events are published to every relay,
 * subscriptions run on every relay, and duplicate events are dropped.
 */
export class RelayPool {
  constructor(urls, { log = () => {}, WebSocketImpl = globalThis.WebSocket } = {}) {
    this.urls = [...new Set(urls)];
    this.log = log;
    this.WS = WebSocketImpl;
    this.relays = new Map(); // url -> { ws, state, retry, queue }
    this.subs = new Map();   // id -> { filters, onEvent, onEose, seen, eosed }
    this.pending = new Map(); // event id -> { results, resolve, timer }
    this.closed = false;
    this.listeners = new Set();
    for (const url of this.urls) this.open(url);
  }

  /** Called with the pool whenever a relay connects or disconnects. */
  onStatus(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emitStatus() { for (const fn of this.listeners) { try { fn(this); } catch {} } }

  /** How many relays are connected right now. */
  get connected() { let n = 0; for (const r of this.relays.values()) if (r.state === 'open') n++; return n; }

  status() { return [...this.relays].map(([url, r]) => ({ url, state: r.state })); }

  /** Resolves once at least `count` relays are connected (or after `ms`). */
  ready(count = 1, ms = 6000) {
    if (this.connected >= count) return Promise.resolve(true);
    return new Promise(resolve => {
      const done = ok => { off(); clearTimeout(t); resolve(ok); };
      const off = this.onStatus(() => { if (this.connected >= count) done(true); });
      const t = setTimeout(() => done(this.connected > 0), ms);
    });
  }

  open(url) {
    const old = this.relays.get(url);
    const r = { ws: null, state: 'connecting', retry: old ? old.retry : 0, queue: old ? old.queue : [] };
    this.relays.set(url, r);
    let ws;
    try { ws = new this.WS(url); }
    catch (e) { r.state = 'failed'; this.log(`relay ${url}: ${e.message}`); this.retry(url); return; }
    r.ws = ws;
    const opened = setTimeout(() => { if (r.state === 'connecting') { try { ws.close(); } catch {} } }, 8000);
    ws.onopen = () => {
      clearTimeout(opened);
      r.state = 'open';
      r.retry = 0;
      for (const [id, s] of this.subs) this.sendTo(r, ['REQ', id, ...s.filters]);
      const q = r.queue.splice(0);
      for (const m of q) this.sendTo(r, m);
      this.emitStatus();
    };
    ws.onmessage = e => this.receive(url, e.data);
    ws.onerror = () => {};
    ws.onclose = () => {
      clearTimeout(opened);
      if (r.state === 'open') this.log(`relay ${url} disconnected`);
      r.state = 'closed';
      this.emitStatus();
      if (!this.closed) this.retry(url);
    };
  }

  retry(url) {
    const r = this.relays.get(url);
    r.retry++;
    const wait = Math.min(60000, 1500 * 2 ** Math.min(r.retry, 6)) * (0.75 + Math.random() * 0.5);
    setTimeout(() => { if (!this.closed && this.relays.get(url) === r) this.open(url); }, wait);
  }

  sendTo(r, msg) {
    try { r.ws.send(JSON.stringify(msg)); return true; } catch { return false; }
  }

  broadcast(msg, { queue = true } = {}) {
    for (const r of this.relays.values()) {
      if (r.state === 'open') this.sendTo(r, msg);
      else if (queue && r.queue.length < 50) r.queue.push(msg);
    }
  }

  receive(url, data) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!Array.isArray(msg)) return;
    const [type, a, b, c] = msg;
    if (type === 'EVENT') {
      const s = this.subs.get(a);
      if (!s || !b || typeof b.id !== 'string' || s.seen.has(b.id)) return;
      s.seen.add(b.id);
      if (s.seen.size > 5000) s.seen = new Set([...s.seen].slice(-2500));
      try { s.onEvent(b, url); } catch (e) { this.log(`subscription handler: ${e.message}`); }
    } else if (type === 'EOSE') {
      const s = this.subs.get(a);
      if (s && !s.eosed.has(url)) { s.eosed.add(url); s.onEose?.(url, s.eosed.size); }
    } else if (type === 'OK') {
      const p = this.pending.get(a);
      if (p) {
        p.results.set(url, { ok: !!b, message: c || '' });
        if (p.results.size >= this.connected) p.finish();
      }
    } else if (type === 'NOTICE') {
      this.log(`relay ${url} notice: ${a}`);
    } else if (type === 'CLOSED') {
      this.log(`relay ${url} closed subscription: ${b}`);
    }
  }

  /** Publish a signed event. Resolves with { ok: [urls], failed: [{ url, message }] } once relays answer (or after `ms`). */
  publish(event, ms = 5000) {
    return new Promise(resolve => {
      const results = new Map();
      const p = {
        results,
        finish: () => {
          clearTimeout(p.timer);
          this.pending.delete(event.id);
          const ok = [], failed = [];
          for (const [url, r] of results) (r.ok ? ok : failed).push(r.ok ? url : { url, message: r.message });
          resolve({ ok, failed });
        },
      };
      p.timer = setTimeout(p.finish, ms);
      this.pending.set(event.id, p);
      this.broadcast(['EVENT', event]);
    });
  }

  /** Subscribe on every relay. Returns { close() }. */
  subscribe(filters, onEvent, { onEose } = {}) {
    const id = randomId(6);
    const s = { filters: Array.isArray(filters) ? filters : [filters], onEvent, onEose, seen: new Set(), eosed: new Set() };
    this.subs.set(id, s);
    this.broadcast(['REQ', id, ...s.filters], { queue: false });
    return { id, close: () => { if (this.subs.delete(id)) this.broadcast(['CLOSE', id], { queue: false }); } };
  }

  /** Collect stored events matching the filters: resolves when every connected relay has sent EOSE (or after `ms`). */
  query(filters, ms = 4000) {
    return new Promise(resolve => {
      const events = [];
      let timer;
      const done = () => { clearTimeout(timer); sub.close(); resolve(events); };
      const sub = this.subscribe(filters, ev => events.push(ev), { onEose: (url, n) => { if (n >= this.connected) done(); } });
      timer = setTimeout(done, ms);
    });
  }

  close() {
    this.closed = true;
    for (const r of this.relays.values()) { try { r.ws?.close(); } catch {} }
    for (const p of this.pending.values()) p.finish();
  }
}
