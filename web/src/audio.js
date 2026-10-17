// Sound effects, synthesized with the Web Audio API (no sound files needed).

export class SoundSystem {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.5;
    this.playing = new Map(); // name -> count playing right now
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
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  /** Play the game's queued sounds, louder when close to the listener. */
  playQueue(queue, lx, ly) {
    if (!this.ctx || this.muted) return;
    const seen = new Set();
    for (const s of queue) {
      const key = s.name + Math.round(s.x / 64);
      if (seen.has(key)) continue;
      seen.add(key);
      const d = s.name === 'gameover' ? 0 : Math.hypot(s.x - lx, s.y - ly);
      const vol = Math.pow(Math.max(0, 1 - d / 1300), 1.6);
      if (vol < 0.03) continue;
      const pan = s.name === 'gameover' ? 0 : Math.max(-1, Math.min(1, (s.x - lx) / 550));
      this.play(s.name, vol, pan);
    }
  }

  play(name, vol = 1, pan = 0) {
    const fn = SOUNDS[name];
    if (!fn || !this.ctx) return;
    if ((this.playing.get(name) || 0) >= 4) return;
    const out = this.ctx.createGain();
    out.gain.value = vol;
    const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (panner) { panner.pan.value = pan; out.connect(panner).connect(this.master); }
    else out.connect(this.master);
    this.playing.set(name, (this.playing.get(name) || 0) + 1);
    const dur = fn(this, out, this.ctx.currentTime) || 0.3;
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
};
