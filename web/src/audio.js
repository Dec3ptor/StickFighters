// Sound effects. Most use the original Stick Soldiers II sounds (web/sounds/);
// anything without a recording is synthesized with the Web Audio API.

// Game sound name -> [file in web/sounds/, volume]. Volumes even out the
// original recordings, which vary a lot in loudness.
export const SAMPLES = {
  pistol: ['platinum', 1.0],
  reload: ['platrld', 2.0],
  rifle: ['m4', 0.5],
  uzi: ['uzi', 0.6],
  shotgun: ['shotgun', 0.7],
  sniper: ['sr1', 0.95],
  thump: ['grenfire', 1.0],
  explosion: ['rlboom', 1.35],
  explosionSmall: ['explode', 0.75],
  flame: ['flamer', 0.6],
  jet: ['jetpack', 0.5],
  hit: ['hitman', 1.4],
  death: ['die', 0.65],
  gib: ['gib', 2.2],
  ricochet: ['ricochet', 0.8],
  pickup: ['pickup', 1.6],
  armour: ['pickup', 1.6],
  health: ['pwrhealth', 0.7],
  spawn: ['pop', 0.8],
  click: ['click', 1.2],
  menuMove: ['menu1', 1.4],
  menuSelect: ['menu3', 1.4],
};

// The loudest everything's played (volume 100%); the volume setting starts at 60% of it.
const FULL = 0.5;

// Sounds that aren't placed in the world (always full volume, centred).
const UI_SOUNDS = new Set(['hitmarker', 'gameover', 'click', 'menuMove', 'menuSelect', 'levelUp', 'chat',
  'objGood', 'objBad', 'flagTaken', 'flagReturned', 'captured', 'alarm', 'pointTaken', 'pointLost', 'hillMoved', 'armed', 'disarmed', 'destroyed', 'sector',
  'buy', 'planted', 'defused', 'roundStart', 'roundStartFreeze', 'roundWin', 'roundLose', 'flashRing',
  // Kill streaks, the kill confirm, and the end of the match (yours alone).
  'killConfirm', 'doubleKill', 'tripleKill', 'multiKill', 'spree', 'rampage', 'unstoppable', 'firstBlood', 'shutdown',
  'rewardReady', 'awards', 'replay']);

export class SoundSystem {
  constructor(base = 'sounds/') {
    this.base = base;
    this.ctx = null;
    this.muted = false;
    this.level = 0.6;         // the volume setting: 0-1 of the loudest (FULL)
    this.playing = new Map(); // name -> count playing right now
    this.raw = new Map();     // file -> ArrayBuffer, waiting to be decoded
    this.buffers = new Map(); // file -> decoded AudioBuffer
  }

  /** Download the recordings (they're decoded once audio is allowed to start). */
  preload() {
    const files = [...new Set(Object.values(SAMPLES).map(([f]) => f))];
    return Promise.all(files.map(f => fetch(`${this.base}${f}.wav`)
      .then(r => (r.ok ? r.arrayBuffer() : null))
      .then(b => { if (b) { this.raw.set(f, b); this.decode(); } })
      .catch(() => { /* fall back to the synthesized sound */ })));
  }

  decode() {
    if (!this.ctx) return;
    for (const [f, b] of this.raw) {
      this.raw.delete(f);
      this.ctx.decodeAudioData(b).then(buf => this.buffers.set(f, buf)).catch(() => {});
    }
  }

  /** Browsers only allow audio after a click or key press. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.gain;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.decode();
  }

  /** What everything's played at: the volume setting, or nothing when muted. */
  get gain() { return this.muted ? 0 : FULL * this.level; }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = this.gain;
  }

  /** The volume setting, 0 to 1 (1: as loud as the game's sounds go). */
  setVolume(v) {
    this.level = Math.min(1, Math.max(0, +v || 0));
    if (this.master) this.master.gain.setTargetAtTime(this.gain, this.ctx.currentTime, 0.02);
  }

  /**
   * Play the game's queued sounds, louder when close to the listener. `me` = the
   * listener's soldier id, `team` their team (a sound's `to` is a soldier id, or
   * minus a team number for a sound only that team hears).
   */
  playQueue(queue, lx, ly, me = null, team = 0) {
    if (!this.ctx || this.muted) return;
    const seen = new Set();
    for (const s of queue) {
      if (s.to != null && s.to !== me && !(s.to < 0 && -s.to === team)) continue;
      const key = s.name + Math.round((s.x ?? 0) / 64);
      if (seen.has(key)) continue;
      seen.add(key);
      const ui = UI_SOUNDS.has(s.name) || s.x == null;
      const d = ui ? 0 : Math.hypot(s.x - lx, s.y - ly);
      const vol = Math.pow(Math.max(0, 1 - d / 1300), 1.6);
      if (vol < 0.03) continue;
      const pan = ui ? 0 : Math.max(-1, Math.min(1, (s.x - lx) / 550));
      this.play(s.name, vol, pan);
    }
  }

  play(name, vol = 1, pan = 0) {
    const sample = SAMPLES[name];
    const buffer = sample && this.buffers.get(sample[0]);
    const fn = SOUNDS[name];
    if ((!buffer && !fn) || !this.ctx || this.muted) return;
    if ((this.playing.get(name) || 0) >= 4) return;
    const out = this.ctx.createGain();
    out.gain.value = vol;
    const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (panner) { panner.pan.value = pan; out.connect(panner).connect(this.master); }
    else out.connect(this.master);
    this.playing.set(name, (this.playing.get(name) || 0) + 1);
    let dur;
    if (buffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = 0.96 + Math.random() * 0.08; // slight variety
      out.gain.value = vol * sample[1];
      src.connect(out);
      src.start();
      dur = buffer.duration;
    } else {
      dur = fn(this, out, this.ctx.currentTime) || 0.3;
    }
    setTimeout(() => this.playing.set(name, this.playing.get(name) - 1), dur * 1000);
  }

  // Building blocks -----------------------------------------------------------

  noiseBurst(out, t, { dur, freq = 2000, q = 0.8, type = 'bandpass', gain = 1, attack = 0.002, sweepTo = null }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    // (The noise is a second long, started part way in: it loops so long bursts, like a
    // stampede's rumble, play to the end instead of stopping short.)
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tone(out, t, { dur, from, to = from, type = 'sine', gain = 0.5, attack = 0.005 }) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

const SOUNDS = {
  pistol: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.12, freq: 1800, gain: 0.9 }); a.tone(o, t, { dur: 0.08, from: 180, to: 60, gain: 0.5 }); return 0.15; },
  uzi: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.06, freq: 2600, gain: 0.6 }); return 0.08; },
  rifle: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.09, freq: 2000, q: 0.6, gain: 0.8 }); a.tone(o, t, { dur: 0.06, from: 140, to: 50, gain: 0.4 }); return 0.1; },
  shotgun: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.32, freq: 900, type: 'lowpass', q: 0.4, gain: 1.2 }); a.tone(o, t, { dur: 0.2, from: 120, to: 40, gain: 0.7 }); return 0.35; },
  sniper: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.35, freq: 3000, q: 0.5, gain: 1 }); a.tone(o, t, { dur: 0.25, from: 900, to: 90, type: 'triangle', gain: 0.4 }); return 0.4; },
  rocket: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.5, freq: 400, sweepTo: 1600, q: 1.2, gain: 0.8, attack: 0.03 }); return 0.5; },
  thump: (a, o, t) => { a.tone(o, t, { dur: 0.16, from: 220, to: 70, gain: 0.8 }); a.noiseBurst(o, t, { dur: 0.08, freq: 600, gain: 0.4 }); return 0.2; },
  flame: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.16, freq: 700, q: 0.4, gain: 0.35, attack: 0.03 }); return 0.17; },
  // A crisp, short "tick" like a shooter's hitmarker: played when you land a headshot.
  hitmarker: (a, o, t) => {
    a.noiseBurst(o, t, { dur: 0.035, freq: 5200, q: 1.2, gain: 0.9, attack: 0.001 });
    a.tone(o, t, { dur: 0.05, from: 2600, to: 2300, type: 'triangle', gain: 0.35, attack: 0.001 });
    a.tone(o, t, { dur: 0.04, from: 3900, to: 3600, gain: 0.2, attack: 0.001 });
    return 0.08;
  },
  explosionSmall: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.6, freq: 900, type: 'lowpass', q: 0.3, gain: 1.2, sweepTo: 150 }); return 0.6; },
  gib: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.3, freq: 350, type: 'lowpass', gain: 0.8 }); return 0.3; },
  menuMove: (a, o, t) => { a.tone(o, t, { dur: 0.04, from: 900, type: 'square', gain: 0.06 }); return 0.05; },
  menuSelect: (a, o, t) => { a.tone(o, t, { dur: 0.06, from: 1200, type: 'square', gain: 0.08 }); return 0.07; },
  explosion: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.9, freq: 700, type: 'lowpass', q: 0.3, gain: 1.5, sweepTo: 120 }); a.tone(o, t, { dur: 0.6, from: 90, to: 30, gain: 0.9 }); return 0.9; },
  ricochet: (a, o, t) => { a.tone(o, t, { dur: 0.18, from: 2400 + Math.random() * 800, to: 1300, type: 'triangle', gain: 0.12 }); return 0.2; },
  hit: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.07, freq: 500, type: 'lowpass', gain: 0.7 }); return 0.08; },
  headshot: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.09, freq: 600, type: 'lowpass', gain: 0.9 }); a.tone(o, t, { dur: 0.1, from: 1400, to: 900, type: 'square', gain: 0.08 }); return 0.12; },
  death: (a, o, t) => { a.tone(o, t, { dur: 0.35, from: 320, to: 70, type: 'sawtooth', gain: 0.18 }); a.noiseBurst(o, t, { dur: 0.25, freq: 400, type: 'lowpass', gain: 0.6 }); return 0.4; },
  fall: (a, o, t) => { a.tone(o, t, { dur: 0.7, from: 700, to: 120, type: 'triangle', gain: 0.25 }); return 0.7; },
  bounce: (a, o, t) => { a.tone(o, t, { dur: 0.22, from: 160, to: 640, gain: 0.5 }); return 0.25; },
  land: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.06, freq: 300, type: 'lowpass', gain: 0.4 }); return 0.07; },
  jet: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.12, freq: 900, q: 0.3, gain: 0.25, attack: 0.02 }); return 0.12; },
  pickup: (a, o, t) => { a.tone(o, t, { dur: 0.08, from: 660, type: 'square', gain: 0.12 }); a.tone(o, t + 0.07, { dur: 0.12, from: 990, type: 'square', gain: 0.12 }); return 0.2; },
  health: (a, o, t) => { [523, 659, 784].forEach((f, i) => a.tone(o, t + i * 0.06, { dur: 0.12, from: f, type: 'triangle', gain: 0.25 })); return 0.3; },
  armour: (a, o, t) => { a.tone(o, t, { dur: 0.2, from: 300, to: 600, type: 'square', gain: 0.1 }); a.noiseBurst(o, t, { dur: 0.1, freq: 3000, gain: 0.2 }); return 0.22; },
  reload: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.04, freq: 3000, q: 4, gain: 0.4 }); a.noiseBurst(o, t + 0.12, { dur: 0.05, freq: 2200, q: 4, gain: 0.5 }); return 0.2; },
  tink: (a, o, t) => { a.tone(o, t, { dur: 0.06, from: 2200, type: 'triangle', gain: 0.1 }); return 0.07; },
  spawn: (a, o, t) => { a.tone(o, t, { dur: 0.3, from: 300, to: 900, type: 'sine', gain: 0.15 }); return 0.3; },
  respawnItem: (a, o, t) => { a.tone(o, t, { dur: 0.15, from: 1200, to: 1600, type: 'sine', gain: 0.05 }); return 0.15; },
  gameover: (a, o, t) => { [392, 523, 659, 784].forEach((f, i) => a.tone(o, t + i * 0.15, { dur: 0.3, from: f, type: 'triangle', gain: 0.3 })); return 0.9; },
  click: (a, o, t) => { a.tone(o, t, { dur: 0.04, from: 1000, type: 'square', gain: 0.08 }); return 0.05; },
  chat: (a, o, t) => { a.tone(o, t, { dur: 0.06, from: 1300, type: 'sine', gain: 0.08 }); a.tone(o, t + 0.07, { dur: 0.08, from: 1700, type: 'sine', gain: 0.08 }); return 0.16; },

  // ---- New weapons (all synthesized) ----
  magnum: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.2, freq: 1300, q: 0.5, gain: 1.1 }); a.tone(o, t, { dur: 0.14, from: 150, to: 45, gain: 0.7 }); return 0.22; },
  minigun: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.045, freq: 2900, gain: 0.45 }); a.tone(o, t, { dur: 0.03, from: 90, to: 60, gain: 0.25 }); return 0.05; },
  spin: (a, o, t) => { a.tone(o, t, { dur: 0.14, from: 180, to: 520, type: 'triangle', gain: 0.07 }); return 0.14; },
  bow: (a, o, t) => { a.tone(o, t, { dur: 0.16, from: 230, to: 150, type: 'triangle', gain: 0.3 }); a.noiseBurst(o, t, { dur: 0.06, freq: 4000, gain: 0.15 }); return 0.17; },
  thunk: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.06, freq: 450, type: 'lowpass', gain: 0.5 }); a.tone(o, t, { dur: 0.08, from: 260, to: 180, type: 'triangle', gain: 0.12 }); return 0.09; },
  magic: (a, o, t) => { a.tone(o, t, { dur: 0.45, from: 500, to: 1500, gain: 0.13 }); a.tone(o, t + 0.05, { dur: 0.4, from: 900, to: 2200, gain: 0.08 }); return 0.5; },
  throw: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.16, freq: 900, sweepTo: 300, q: 1.2, gain: 0.3, attack: 0.02 }); return 0.17; },
  boing: (a, o, t) => { a.tone(o, t, { dur: 0.13, from: 280, to: 900, gain: 0.14 }); return 0.14; },
  hallelujah: (a, o, t) => {
    const chords = [[440, 554, 659], [494, 622, 740], [554, 698, 831], [659, 831, 988]];
    chords.forEach((c, i) => c.forEach(f => {
      a.tone(o, t + i * 0.32, { dur: i === 3 ? 0.7 : 0.34, from: f, type: 'triangle', gain: 0.1, attack: 0.08 });
      a.tone(o, t + i * 0.32, { dur: i === 3 ? 0.7 : 0.34, from: f * 1.003, type: 'sine', gain: 0.06, attack: 0.08 });
    }));
    return 1.7;
  },
  smash: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.25, freq: 4000, type: 'highpass', gain: 0.6 }); [2600, 3300, 2900].forEach((f, i) => a.tone(o, t + 0.03 * i, { dur: 0.08, from: f, type: 'triangle', gain: 0.06 })); return 0.3; },
  gas: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.7, freq: 600, type: 'lowpass', gain: 0.35, attack: 0.08 }); return 0.7; },
  cough: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.1, freq: 500, gain: 0.35 }); a.noiseBurst(o, t + 0.16, { dur: 0.09, freq: 450, gain: 0.3 }); return 0.28; },
  baa: (a, o, t) => bleat(a, o, t),
  mumble: (a, o, t) => { for (let i = 0; i < 5; i++) a.tone(o, t + i * 0.09, { dur: 0.08, from: 200 + Math.random() * 120, type: 'triangle', gain: 0.08 }); return 0.5; },
  moo: (a, o, t) => { a.tone(o, t, { dur: 0.7, from: 150, to: 110, type: 'sawtooth', gain: 0.09, attack: 0.08 }); return 0.7; },
  fuse: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.6, freq: 5000, type: 'highpass', gain: 0.1 }); return 0.6; },
  beep: (a, o, t) => { a.tone(o, t, { dur: 0.06, from: 1900, type: 'square', gain: 0.07 }); a.tone(o, t + 0.1, { dur: 0.06, from: 1900, type: 'square', gain: 0.07 }); return 0.17; },
  plane: (a, o, t) => { a.noiseBurst(o, t, { dur: 1.6, freq: 300, sweepTo: 900, type: 'lowpass', gain: 0.5, attack: 0.5 }); a.tone(o, t, { dur: 1.5, from: 90, to: 110, type: 'sawtooth', gain: 0.03, attack: 0.4 }); return 1.6; },
  heehaw: (a, o, t) => { a.tone(o, t, { dur: 0.28, from: 650, to: 950, type: 'sawtooth', gain: 0.07 }); a.tone(o, t + 0.3, { dur: 0.35, from: 330, to: 250, type: 'sawtooth', gain: 0.08 }); return 0.7; },
  rumble: (a, o, t) => { a.noiseBurst(o, t, { dur: 1.0, freq: 140, type: 'lowpass', gain: 1.1, attack: 0.1 }); a.tone(o, t, { dur: 0.9, from: 45, to: 35, gain: 0.5 }); return 1.0; },
  // The Engineer's Builder: a block knocked into place, or a repair ratcheted in.
  build: (a, o, t) => {
    a.noiseBurst(o, t, { dur: 0.09, freq: 380, type: 'lowpass', gain: 0.7 });
    a.tone(o, t, { dur: 0.06, from: 560, to: 420, type: 'triangle', gain: 0.14 });
    a.tone(o, t + 0.1, { dur: 0.05, from: 620, to: 470, type: 'triangle', gain: 0.1 });
    return 0.17;
  },
  repair: (a, o, t) => { for (let i = 0; i < 3; i++) a.noiseBurst(o, t + i * 0.06, { dur: 0.035, freq: 2600 - i * 300, q: 3, gain: 0.35 }); return 0.2; },
  teleport: (a, o, t) => { a.tone(o, t, { dur: 0.3, from: 300, to: 1800, gain: 0.13 }); a.tone(o, t + 0.12, { dur: 0.3, from: 1800, to: 400, gain: 0.1 }); return 0.45; },
  banzai: (a, o, t) => { a.tone(o, t, { dur: 0.6, from: 480, to: 720, type: 'sawtooth', gain: 0.07, attack: 0.05 }); return 0.6; },
  rope: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.12, freq: 2400, sweepTo: 600, q: 2, gain: 0.3 }); return 0.13; },
  prod: (a, o, t) => { a.tone(o, t, { dur: 0.09, from: 520, to: 260, type: 'square', gain: 0.07 }); return 0.1; },
  bat: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.08, freq: 1400, type: 'lowpass', gain: 1.1 }); a.tone(o, t, { dur: 0.14, from: 950, to: 620, type: 'triangle', gain: 0.25 }); return 0.15; },
  axe: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.12, freq: 3200, q: 1.5, gain: 0.6 }); a.tone(o, t, { dur: 0.12, from: 220, to: 80, gain: 0.5 }); return 0.13; },
  punch: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.12, freq: 700, type: 'lowpass', gain: 1 }); a.tone(o, t, { dur: 0.15, from: 170, to: 55, gain: 0.6 }); a.noiseBurst(o, t + 0.05, { dur: 0.3, freq: 900, sweepTo: 2500, q: 0.6, gain: 0.25 }); return 0.35; },
  swing: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.12, freq: 1600, sweepTo: 500, q: 1.4, gain: 0.15 }); return 0.13; },
  crate: (a, o, t) => { a.tone(o, t, { dur: 0.1, from: 523, type: 'square', gain: 0.05 }); a.tone(o, t + 0.12, { dur: 0.16, from: 659, type: 'square', gain: 0.05 }); return 0.3; },
  levelUp: (a, o, t) => { [523, 784, 1046].forEach((f, i) => a.tone(o, t + i * 0.07, { dur: 0.12, from: f, type: 'square', gain: 0.07 })); return 0.3; },

  // ---- Objective modes (good news for one team, bad news for the other) ----
  objGood: (a, o, t) => { [587, 784].forEach((f, i) => a.tone(o, t + i * 0.09, { dur: 0.16, from: f, type: 'triangle', gain: 0.22 })); return 0.3; },
  objBad: (a, o, t) => { [523, 392].forEach((f, i) => a.tone(o, t + i * 0.11, { dur: 0.2, from: f, type: 'triangle', gain: 0.22 })); return 0.35; },
  flagTaken: (a, o, t) => { [659, 880, 1046].forEach((f, i) => a.tone(o, t + i * 0.07, { dur: 0.12, from: f, type: 'square', gain: 0.06 })); return 0.3; },
  flagReturned: (a, o, t) => { [784, 659, 784].forEach((f, i) => a.tone(o, t + i * 0.08, { dur: 0.12, from: f, type: 'triangle', gain: 0.2 })); return 0.3; },
  captured: (a, o, t) => {
    [523, 659, 784, 1046].forEach((f, i) => a.tone(o, t + i * 0.12, { dur: i === 3 ? 0.5 : 0.16, from: f, type: 'triangle', gain: 0.26 }));
    [262, 330, 392].forEach(f => a.tone(o, t + 0.36, { dur: 0.6, from: f, type: 'sine', gain: 0.1 }));
    return 1;
  },
  alarm: (a, o, t) => { for (let i = 0; i < 3; i++) a.tone(o, t + i * 0.18, { dur: 0.12, from: 880, to: 660, type: 'square', gain: 0.07 }); return 0.55; },
  pointTaken: (a, o, t) => { [440, 554, 659].forEach((f, i) => a.tone(o, t + i * 0.08, { dur: 0.18, from: f, type: 'triangle', gain: 0.22 })); return 0.4; },
  pointLost: (a, o, t) => { a.tone(o, t, { dur: 0.35, from: 520, to: 300, type: 'triangle', gain: 0.2 }); return 0.4; },
  hillMoved: (a, o, t) => { a.tone(o, t, { dur: 0.25, from: 300, to: 900, type: 'triangle', gain: 0.18 }); a.tone(o, t + 0.25, { dur: 0.25, from: 900, to: 600, type: 'triangle', gain: 0.15 }); return 0.5; },
  armed: (a, o, t) => { for (let i = 0; i < 4; i++) a.tone(o, t + i * 0.1, { dur: 0.07, from: 1500, type: 'square', gain: 0.06 }); return 0.45; },
  disarmed: (a, o, t) => { a.tone(o, t, { dur: 0.3, from: 1200, to: 400, type: 'triangle', gain: 0.2 }); return 0.3; },
  destroyed: (a, o, t) => { [392, 523, 659].forEach((f, i) => a.tone(o, t + i * 0.1, { dur: 0.2, from: f, type: 'square', gain: 0.07 })); return 0.4; },
  sector: (a, o, t) => { [392, 494, 587, 784].forEach((f, i) => a.tone(o, t + i * 0.14, { dur: 0.22, from: f, type: 'triangle', gain: 0.2 })); return 0.8; },

  // ---- Defuse (Counter-Strike style) ----
  ak: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.11, freq: 1500, q: 0.5, gain: 1 }); a.tone(o, t, { dur: 0.08, from: 120, to: 45, gain: 0.55 }); return 0.12; },
  knife: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.1, freq: 5200, sweepTo: 2600, q: 2, gain: 0.35 }); return 0.11; },
  // A flashbang: a sharp bang. Anyone it blinds hears a ringing (flashRing).
  flashbang: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.35, freq: 2600, q: 0.4, gain: 1.4, attack: 0.001 }); a.tone(o, t, { dur: 0.2, from: 140, to: 50, gain: 0.8 }); return 0.4; },
  flashRing: (a, o, t) => { a.tone(o, t, { dur: 2.6, from: 3500, to: 3300, gain: 0.07, attack: 0.02 }); return 2.6; },
  smoke: (a, o, t) => { a.noiseBurst(o, t, { dur: 1.6, freq: 3200, type: 'highpass', gain: 0.35, attack: 0.1 }); return 1.6; },
  buy: (a, o, t) => { a.tone(o, t, { dur: 0.05, from: 1600, type: 'square', gain: 0.05 }); a.noiseBurst(o, t + 0.05, { dur: 0.05, freq: 3500, q: 3, gain: 0.25 }); return 0.12; },
  planting: (a, o, t) => { for (let i = 0; i < 6; i++) a.tone(o, t + i * 0.12, { dur: 0.05, from: [1200, 1500, 1100, 1400, 1250, 1600][i], type: 'square', gain: 0.04 }); return 0.75; },
  planted: (a, o, t) => {
    a.tone(o, t, { dur: 0.12, from: 2000, type: 'square', gain: 0.05 });
    [330, 247].forEach((f, i) => a.tone(o, t + 0.2 + i * 0.25, { dur: 0.32, from: f, type: 'sawtooth', gain: 0.07 }));
    return 0.8;
  },
  bombBeep: (a, o, t) => { a.tone(o, t, { dur: 0.08, from: 2600, type: 'square', gain: 0.06 }); return 0.09; },
  defusing: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.06, freq: 2500, q: 5, gain: 0.35 }); a.noiseBurst(o, t + 0.1, { dur: 0.05, freq: 1900, q: 5, gain: 0.3 }); return 0.17; },
  defused: (a, o, t) => { [784, 988, 1175].forEach((f, i) => a.tone(o, t + i * 0.1, { dur: 0.2, from: f, type: 'triangle', gain: 0.22 })); return 0.5; },
  bombBlast: (a, o, t) => {
    a.noiseBurst(o, t, { dur: 2.2, freq: 500, type: 'lowpass', q: 0.3, gain: 2, sweepTo: 60 });
    a.tone(o, t, { dur: 1.6, from: 70, to: 22, gain: 1 });
    return 2.2;
  },
  roundStartFreeze: (a, o, t) => { a.tone(o, t, { dur: 0.25, from: 523, type: 'triangle', gain: 0.12 }); return 0.25; },
  roundStart: (a, o, t) => { [523, 659, 784].forEach((f, i) => a.tone(o, t + i * 0.07, { dur: 0.14, from: f, type: 'square', gain: 0.06 })); return 0.3; },
  roundWin: (a, o, t) => {
    [523, 659, 784, 1046].forEach((f, i) => a.tone(o, t + i * 0.11, { dur: i === 3 ? 0.55 : 0.15, from: f, type: 'triangle', gain: 0.24 }));
    return 0.9;
  },
  roundLose: (a, o, t) => { [523, 466, 392].forEach((f, i) => a.tone(o, t + i * 0.16, { dur: i === 2 ? 0.5 : 0.18, from: f, type: 'triangle', gain: 0.22 })); return 0.8; },

  // ---- Kill streaks (yours: not placed in the world) ----
  // A kill: a bright metallic tick (two clashing partials) over a low punchy thump. (The hitmarker is a plain tick.)
  killConfirm: (a, o, t) => {
    a.tone(o, t, { dur: 0.13, from: 150, to: 52, gain: 0.75, attack: 0.002 });
    a.noiseBurst(o, t, { dur: 0.05, freq: 320, type: 'lowpass', gain: 0.55, attack: 0.001 });
    a.noiseBurst(o, t, { dur: 0.025, freq: 6500, q: 2, gain: 0.5, attack: 0.001 });
    a.tone(o, t, { dur: 0.07, from: 2950, to: 2880, type: 'triangle', gain: 0.16, attack: 0.001 });
    a.tone(o, t, { dur: 0.05, from: 4130, to: 4050, gain: 0.08, attack: 0.001 });
    return 0.14;
  },
  // Multi-kills: quick rising arpeggios, a step higher and longer each time.
  doubleKill: (a, o, t) => arpeggio(a, o, t, [659, 988], 0.07, 0.16),
  tripleKill: (a, o, t) => arpeggio(a, o, t, [698, 880, 1175], 0.065, 0.22),
  multiKill: (a, o, t) => arpeggio(a, o, t, [784, 988, 1175, 1568], 0.06, 0.32),
  // Killing spree: a power chord sting.
  spree: (a, o, t) => {
    drum(a, o, t, 0.5);
    brass(a, o, t, [147, 220, 294], 0.32, 0.05);
    a.tone(o, t, { dur: 0.3, from: 587, type: 'square', gain: 0.03, attack: 0.01 });
    return 0.4;
  },
  // Rampage: a bigger brass stab, then a rising slide into a held chord.
  rampage: (a, o, t) => {
    drum(a, o, t, 0.6);
    brass(a, o, t, [165, 247, 330], 0.16, 0.055);
    a.tone(o, t + 0.14, { dur: 0.26, from: 247, to: 494, type: 'sawtooth', gain: 0.05, attack: 0.03 });
    drum(a, o, t + 0.36, 0.55);
    brass(a, o, t + 0.36, [196, 294, 392, 494], 0.45, 0.05);
    return 0.85;
  },
  // Unstoppable (and Godlike...): a low brass swell under a high fanfare.
  unstoppable: (a, o, t) => {
    brass(a, o, t, [73, 110, 147], 1.25, 0.06, 0.35);
    drum(a, o, t, 0.6);
    [523, 659, 784, 1046].forEach((f, i) => {
      a.tone(o, t + 0.3 + i * 0.1, { dur: i === 3 ? 0.65 : 0.12, from: f, type: 'square', gain: 0.045 });
      a.tone(o, t + 0.3 + i * 0.1, { dur: i === 3 ? 0.7 : 0.14, from: f, type: 'triangle', gain: 0.14 });
    });
    drum(a, o, t + 0.6, 0.7);
    return 1.35;
  },
  // First blood: two big brass chords, a half step apart.
  firstBlood: (a, o, t) => {
    drum(a, o, t, 0.7);
    brass(a, o, t, [104, 208, 262, 311], 0.24, 0.05);
    drum(a, o, t + 0.3, 0.75);
    brass(a, o, t + 0.3, [98, 196, 247, 294], 0.6, 0.055);
    return 0.95;
  },
  // Shutdown: someone's streak powering down, then a triumphant stab.
  shutdown: (a, o, t) => {
    a.tone(o, t, { dur: 0.42, from: 880, to: 90, type: 'sawtooth', gain: 0.06 });
    a.tone(o, t, { dur: 0.42, from: 440, to: 45, type: 'square', gain: 0.03 });
    a.noiseBurst(o, t, { dur: 0.4, freq: 3000, sweepTo: 200, q: 1, gain: 0.15 });
    drum(a, o, t + 0.45, 0.6);
    brass(a, o, t + 0.45, [196, 247, 294, 392], 0.4, 0.05);
    return 0.9;
  },
  // A reward to use: a bright chime, three bell notes (with the bell's clashing overtone).
  rewardReady: (a, o, t) => {
    [1319, 1568, 2093].forEach((f, i) => {
      a.tone(o, t + i * 0.08, { dur: i === 2 ? 0.5 : 0.3, from: f, type: 'triangle', gain: 0.16, attack: 0.002 });
      a.tone(o, t + i * 0.08, { dur: 0.18, from: f * 2.76, gain: 0.035, attack: 0.002 });
    });
    return 0.66;
  },
  // The results: a short fanfare.
  awards: (a, o, t) => {
    [523, 523, 523, 659].forEach((f, i) => a.tone(o, t + i * 0.1, { dur: 0.09, from: f, type: 'square', gain: 0.05 }));
    [523, 659, 784, 1046].forEach(f => a.tone(o, t + 0.42, { dur: 0.75, from: f, type: 'triangle', gain: 0.1, attack: 0.02 }));
    brass(a, o, t + 0.42, [131, 196, 262], 0.7, 0.035, 0.03);
    drum(a, o, t + 0.42, 0.5);
    return 1.2;
  },
  // Into slow motion: a whoosh falling away.
  replay: (a, o, t) => {
    a.noiseBurst(o, t, { dur: 0.75, freq: 3500, sweepTo: 250, q: 1.4, gain: 0.55, attack: 0.12 });
    a.tone(o, t, { dur: 0.7, from: 320, to: 70, gain: 0.18, attack: 0.08 });
    return 0.8;
  },

  // ---- Kill streak rewards (placed in the world) ----
  // The Sentry Sheep's gun: like the minigun, punchier and a little quieter.
  sentry: (a, o, t) => {
    a.noiseBurst(o, t, { dur: 0.05, freq: 2200, q: 0.7, gain: 0.35 });
    a.tone(o, t, { dur: 0.045, from: 130, to: 55, gain: 0.3 });
    return 0.06;
  },
  // Setting the sentry down: a clunk, its gun whirring up, and a baa.
  sentryDeploy: (a, o, t) => {
    a.noiseBurst(o, t, { dur: 0.09, freq: 420, type: 'lowpass', gain: 0.8 });
    a.tone(o, t, { dur: 0.1, from: 210, to: 90, type: 'triangle', gain: 0.3 });
    a.noiseBurst(o, t + 0.12, { dur: 0.05, freq: 2600, q: 4, gain: 0.35 });
    a.tone(o, t + 0.16, { dur: 0.42, from: 110, to: 520, type: 'sawtooth', gain: 0.035, attack: 0.05 });
    a.noiseBurst(o, t + 0.16, { dur: 0.4, freq: 1200, sweepTo: 3200, q: 3, gain: 0.12, attack: 0.05 });
    bleat(a, o, t + 0.62);
    return 1.05;
  },
  // A stampede: a chorus of baas over a low rumble of hooves.
  stampede: (a, o, t) => {
    a.noiseBurst(o, t, { dur: 1.2, freq: 160, type: 'lowpass', gain: 0.9, attack: 0.15 });
    a.tone(o, t, { dur: 1.1, from: 52, to: 40, gain: 0.35, attack: 0.1 });
    for (let i = 0; i < 9; i++) a.noiseBurst(o, t + 0.1 + i * 0.11, { dur: 0.05, freq: 380, type: 'lowpass', gain: 0.35 });
    [[0, 1], [0.12, 1.14], [0.27, 0.88], [0.41, 1.26], [0.58, 1.05], [0.72, 0.94]].forEach(([at, k]) => bleat(a, o, t + at, k, 0.8));
    return 1.25;
  },
  // A supply drop: the plane going over, then the parachute popping open.
  supplyDrop: (a, o, t) => {
    SOUNDS.plane(a, o, t);
    a.noiseBurst(o, t + 1.05, { dur: 0.12, freq: 1700, q: 0.9, gain: 0.6, attack: 0.002 });
    a.tone(o, t + 1.05, { dur: 0.09, from: 620, to: 300, type: 'triangle', gain: 0.1 });
    a.noiseBurst(o, t + 1.12, { dur: 0.5, freq: 2600, type: 'highpass', gain: 0.08, attack: 0.05 });
    return 1.65;
  },
  // Becoming a Juggernaut: a heavy low swell and a metallic clang.
  juggernaut: (a, o, t) => {
    a.tone(o, t, { dur: 1.0, from: 55, to: 82, type: 'sawtooth', gain: 0.12, attack: 0.35 });
    a.tone(o, t, { dur: 1.0, from: 82.5, to: 123, type: 'sawtooth', gain: 0.07, attack: 0.35 });
    a.tone(o, t + 0.32, { dur: 0.45, from: 95, to: 35, gain: 0.7 });
    a.noiseBurst(o, t + 0.32, { dur: 0.15, freq: 3000, q: 3, gain: 0.4, attack: 0.001 });
    [523, 1347, 2153, 3011].forEach((f, i) => a.tone(o, t + 0.32, { dur: 0.65 - i * 0.1, from: f, type: i ? 'sine' : 'triangle', gain: 0.08 - i * 0.015, attack: 0.001 }));
    return 1.05;
  },
};

// Pieces the sounds above share.

/** A sheep's baa (k: higher or lower, gain: louder or quieter). */
function bleat(a, o, t, k = 1, gain = 1) {
  a.tone(o, t, { dur: 0.09, from: 300 * k, to: 420 * k, type: 'sawtooth', gain: 0.06 * gain });
  for (let i = 0; i < 5; i++) a.tone(o, t + 0.08 + i * 0.06, { dur: 0.07, from: (420 - i * 8) * k, to: (400 - i * 8) * k, type: 'sawtooth', gain: 0.07 * gain });
  return 0.42;
}

/** Notes one after another (gap s apart), square with a triangle under it, the last held a little. */
function arpeggio(a, o, t, notes, gap, last) {
  notes.forEach((f, i) => {
    const end = i === notes.length - 1, dur = end ? last : gap * 1.4;
    a.tone(o, t + i * gap, { dur, from: f, type: 'square', gain: 0.05 });
    a.tone(o, t + i * gap, { dur, from: f, type: 'triangle', gain: 0.14 });
  });
  return (notes.length - 1) * gap + last + 0.02;
}

/** A brass chord: sawtooths with a quick swell (attack), slightly detuned for body. */
function brass(a, o, t, notes, dur, gain, attack = 0.025) {
  for (const f of notes) {
    a.tone(o, t, { dur, from: f, type: 'sawtooth', gain, attack });
    a.tone(o, t, { dur, from: f * 1.004, type: 'sawtooth', gain: gain * 0.5, attack });
  }
}

/** A drum hit under a sting: a low thump and a little noise. */
function drum(a, o, t, gain) {
  a.tone(o, t, { dur: 0.22, from: 130, to: 45, gain });
  a.noiseBurst(o, t, { dur: 0.08, freq: 500, type: 'lowpass', gain: gain * 0.6 });
}
