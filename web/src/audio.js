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

// Sounds that aren't placed in the world (always full volume, centred).
const UI_SOUNDS = new Set(['hitmarker', 'gameover', 'click', 'menuMove', 'menuSelect', 'levelUp', 'chat',
  'objGood', 'objBad', 'flagTaken', 'flagReturned', 'captured', 'alarm', 'pointTaken', 'pointLost', 'hillMoved', 'armed', 'disarmed', 'destroyed', 'sector']);

export class SoundSystem {
  constructor(base = 'sounds/') {
    this.base = base;
    this.ctx = null;
    this.muted = false;
    this.volume = 0.5;
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
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.decode();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
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
  baa: (a, o, t) => {
    a.tone(o, t, { dur: 0.09, from: 300, to: 420, type: 'sawtooth', gain: 0.06 });
    for (let i = 0; i < 5; i++) a.tone(o, t + 0.08 + i * 0.06, { dur: 0.07, from: 420 - i * 8, to: 400 - i * 8, type: 'sawtooth', gain: 0.07 });
    return 0.42;
  },
  mumble: (a, o, t) => { for (let i = 0; i < 5; i++) a.tone(o, t + i * 0.09, { dur: 0.08, from: 200 + Math.random() * 120, type: 'triangle', gain: 0.08 }); return 0.5; },
  moo: (a, o, t) => { a.tone(o, t, { dur: 0.7, from: 150, to: 110, type: 'sawtooth', gain: 0.09, attack: 0.08 }); return 0.7; },
  fuse: (a, o, t) => { a.noiseBurst(o, t, { dur: 0.6, freq: 5000, type: 'highpass', gain: 0.1 }); return 0.6; },
  beep: (a, o, t) => { a.tone(o, t, { dur: 0.06, from: 1900, type: 'square', gain: 0.07 }); a.tone(o, t + 0.1, { dur: 0.06, from: 1900, type: 'square', gain: 0.07 }); return 0.17; },
  plane: (a, o, t) => { a.noiseBurst(o, t, { dur: 1.6, freq: 300, sweepTo: 900, type: 'lowpass', gain: 0.5, attack: 0.5 }); a.tone(o, t, { dur: 1.5, from: 90, to: 110, type: 'sawtooth', gain: 0.03, attack: 0.4 }); return 1.6; },
  heehaw: (a, o, t) => { a.tone(o, t, { dur: 0.28, from: 650, to: 950, type: 'sawtooth', gain: 0.07 }); a.tone(o, t + 0.3, { dur: 0.35, from: 330, to: 250, type: 'sawtooth', gain: 0.08 }); return 0.7; },
  rumble: (a, o, t) => { a.noiseBurst(o, t, { dur: 1.0, freq: 140, type: 'lowpass', gain: 1.1, attack: 0.1 }); a.tone(o, t, { dur: 0.9, from: 45, to: 35, gain: 0.5 }); return 1.0; },
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
};
