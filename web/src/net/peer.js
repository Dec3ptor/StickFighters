// A direct connection between two browsers (WebRTC data channels).
// Two channels: "reliable" (ordered, every message arrives: joining, chat,
// events) and "fast" (unordered, lost messages are dropped: inputs and snapshots).
//
// Connection details are exchanged in one go (no trickle ICE): we wait until
// the browser has found its addresses, then send the whole description through
// the relays. That's one message each way.

import { iceServers, whyNoConnection } from './relays.js';

const GATHER_MS = 2500;   // how long to wait for network addresses
const CONNECT_MS = 15000; // give up on a connection after this long

/** A link to another player. Same interface as the in-memory links used in tests. */
export class PeerLink {
  constructor(pc) {
    this.pc = pc;
    this.reliable = pc.createDataChannel('reliable', { negotiated: true, id: 0, ordered: true });
    this.fast = pc.createDataChannel('fast', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    this.onmessage = () => {};
    this.onclose = () => {};
    this.closed = false;
    // (What this side found of its own network, once it's looked: { host, srflx, relay } addresses.)
    this.kinds = null;
    for (const ch of [this.reliable, this.fast]) {
      ch.binaryType = 'arraybuffer';
      ch.onmessage = e => { if (!this.closed) this.onmessage(typeof e.data === 'string' ? JSON.parse(e.data) : e.data, ch === this.reliable); };
      ch.onclose = () => this.close('channel closed');
    }
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error(whyNoConnection(this.kinds))); this.close('timeout'); }, CONNECT_MS);
      // Closed before connecting (e.g. the game never answered): give up now, not at the timeout.
      this.stopConnecting = () => { clearTimeout(timer); reject(new Error("Couldn't connect (the connection was closed)")); };
      const check = () => {
        if (this.reliable.readyState === 'open' && this.fast.readyState === 'open') { clearTimeout(timer); resolve(this); }
      };
      this.reliable.onopen = check;
      this.fast.onopen = check;
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed') { clearTimeout(timer); reject(new Error(whyNoConnection(this.kinds))); this.close('failed'); }
        if (pc.connectionState === 'disconnected') {
          clearTimeout(this.dropTimer);
          this.dropTimer = setTimeout(() => { if (pc.connectionState !== 'connected') this.close('lost connection'); }, 6000);
        }
        if (pc.connectionState === 'closed') this.close('closed');
      });
    });
    // Nobody may be waiting on a link that was given up on early, so its failure isn't an uncaught error.
    this.ready.catch(() => {});
  }

  static make() {
    return new PeerLink(new RTCPeerConnection({ iceServers: iceServers() }));
  }

  /** Joining player: make an offer. Returns the description to send to the host. */
  async createOffer() {
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await gathered(this.pc);
    this.kinds = addressKinds(this.pc.localDescription.sdp);
    return this.pc.localDescription.sdp;
  }

  /** Host: answer an offer. Returns the description to send back. */
  async answer(offerSdp) {
    await this.pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await gathered(this.pc);
    this.kinds = addressKinds(this.pc.localDescription.sdp);
    return this.pc.localDescription.sdp;
  }

  async accept(answerSdp) {
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  }

  /** Send an object (as JSON, reliably) or bytes (fast, may be dropped). */
  send(data, reliable = typeof data === 'object' && !(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) {
    if (this.closed) return false;
    const ch = reliable ? this.reliable : this.fast;
    if (ch.readyState !== 'open') return false;
    // Don't pile up snapshots on a slow connection: newer ones will follow.
    if (!reliable && ch.bufferedAmount > 256 * 1024) return false;
    const binary = data instanceof Uint8Array || data instanceof ArrayBuffer || typeof data === 'string';
    try { ch.send(binary ? data : JSON.stringify(data)); return true; } catch { return false; }
  }

  /** How much is waiting to go out on the fast channel. */
  get backlog() { return this.fast.bufferedAmount; }

  /**
   * How the two ends are joined, once they are: 'direct', or 'relay' (through a relay server:
   * a little slower). Null if it can't be told.
   */
  async route() {
    try {
      const stats = await this.pc.getStats();
      let pair = null;
      stats.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId) || pair; });
      if (!pair) stats.forEach(r => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = pair || r; });
      const local = pair && stats.get(pair.localCandidateId), remote = pair && stats.get(pair.remoteCandidateId);
      if (!local || !remote) return null;
      return local.candidateType === 'relay' || remote.candidateType === 'relay' ? 'relay' : 'direct';
    } catch { return null; }
  }

  close(reason = 'closed') {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.dropTimer);
    this.stopConnecting();
    try { this.reliable.close(); this.fast.close(); this.pc.close(); } catch { /* already gone */ }
    this.onclose(reason);
  }
}

/** The kinds of address a connection description offers: { host (on the local network), srflx (as the internet sees us), relay }. */
export function addressKinds(sdp) {
  const n = kind => (String(sdp || '').match(new RegExp(`\\styp ${kind}\\b`, 'g')) || []).length;
  return { host: n('host'), srflx: n('srflx') + n('prflx'), relay: n('relay') };
}

function gathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', check); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/**
 * Two links joined in memory (for tests): messages arrive after `latency` ms,
 * and fast messages are dropped with probability `loss`.
 */
export function memoryLinks({ latency = 0, loss = 0, rng = Math.random, schedule = null } = {}) {
  const make = () => ({
    onmessage: () => {}, onclose: () => {}, closed: false, backlog: 0, ready: Promise.resolve(),
    send(data, reliable = typeof data === 'object' && !(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) {
      if (this.closed || this.other.closed) return false;
      if (!reliable && rng() < loss) return true;
      const copy = data instanceof Uint8Array ? data.slice() : data instanceof ArrayBuffer ? data.slice(0) : typeof data === 'object' ? JSON.parse(JSON.stringify(data)) : data;
      const deliver = () => { if (!this.other.closed) this.other.onmessage(copy, reliable); };
      if (schedule) schedule(deliver, latency); else if (latency) setTimeout(deliver, latency); else queueMicrotask(deliver);
      return true;
    },
    close(reason = 'closed') {
      if (this.closed) return;
      this.closed = true;
      this.onclose(reason);
      if (!this.other.closed) this.other.close('closed by the other side');
    },
  });
  const a = make(), b = make();
  a.other = b; b.other = a;
  return [a, b];
}
