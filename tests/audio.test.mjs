// Sound effects without a browser: a stand-in for the Web Audio API records what's made.
// Audio starts once (on the first click or key) and then stops listening; sounds in the
// middle go out without a panner at the level a centred panner gives them; and the four-at-once
// limit for each sound is kept without a timer for every sound.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundSystem } from '../web/src/audio.js';

/** A fake AudioContext: nodes are plain records, and its clock is set by the test. */
class FakeAudio {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 100;
    this.destination = { name: 'out' };
    this.made = { gain: 0, panner: 0, source: 0 };
    this.resumed = 0;
  }
  node(kind, extra = {}) { return { kind, connect(n) { this.to = n; return n; }, ...extra }; }
  param(v = 0) { return { value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }; }
  createGain() { this.made.gain++; return this.node('gain', { gain: this.param(1) }); }
  createStereoPanner() { this.made.panner++; return this.node('panner', { pan: this.param(0) }); }
  createBufferSource() { this.made.source++; return this.node('source', { playbackRate: this.param(1), start() {}, stop() {} }); }
  createBuffer(channels, length) { return { numberOfChannels: channels, length, getChannelData: () => new Float32Array(length) }; }
  createBiquadFilter() { return this.node('filter', { frequency: this.param(), Q: this.param() }); }
  createOscillator() { return this.node('osc', { frequency: this.param(), start() {}, stop() {} }); }
  decodeAudioData() { return new Promise(() => {}); }
  resume() { this.resumed++; this.state = 'running'; this.onstatechange?.(); return Promise.resolve(); }
}

function withAudio(fn) {
  const old = globalThis.window;
  const listeners = new Map();
  globalThis.window = {
    AudioContext: FakeAudio,
    addEventListener: (type, f) => listeners.set(type, f),
    removeEventListener: type => listeners.delete(type),
  };
  try { return fn(listeners); } finally { globalThis.window = old; }
}

test('audio is started once: after that a click or key costs nothing, and nothing listens', () => withAudio(listeners => {
  const a = new SoundSystem();
  a.listen(window);
  assert.deepEqual([...listeners.keys()].sort(), ['keydown', 'pointerdown', 'pointerup', 'touchend']);
  listeners.get('pointerdown')();
  assert.ok(a.ctx, 'the first click starts it');
  assert.equal(a.live, true);
  assert.equal(listeners.size, 0, 'running: no more listening');
  const ctx = a.ctx;
  a.unlock(); a.unlock();
  assert.equal(a.ctx, ctx, 'the same audio');
  // The browser stops it (a phone call, say): listening again until a click starts it.
  ctx.state = 'suspended';
  ctx.onstatechange();
  assert.equal(a.live, false);
  assert.equal(listeners.size, 4);
  listeners.get('keydown')();
  assert.equal(ctx.resumed, 1);
  assert.equal(a.live, true);
  assert.equal(listeners.size, 0);
}));

test('a sound in the middle goes out without a panner, as loud as a centred panner made it', () => withAudio(() => {
  const a = new SoundSystem();
  a.unlock();
  const ctx = a.ctx;
  // Synthesized sounds are one channel: a centred equal-power panner sent each side cos 45°.
  const levels = [];
  const gain = ctx.createGain.bind(ctx);
  ctx.createGain = () => { const g = gain(); levels.push(g); return g; };
  a.play('click', 0.8, 0);
  assert.equal(ctx.made.panner, 0);
  assert.ok(Math.abs(levels[0].gain.value - 0.8 * Math.SQRT1_2) < 1e-12, `synthesized: ${levels[0].gain.value}`);
  a.play('click', 0.8, 0.5);
  assert.equal(ctx.made.panner, 1, 'off to one side: panned as before');
  ctx.createGain = gain;
  // Recordings: one channel gets the same cos 45°; two channels go through as they are.
  const out = [];
  ctx.createGain = () => { const g = FakeAudio.prototype.createGain.call(ctx); out.push(g); return g; };
  a.buffers.set('platinum', { numberOfChannels: 1, duration: 0.2 }); // (the pistol's recording)
  a.buffers.set('m4', { numberOfChannels: 2, duration: 0.2 }); // (the rifle's)
  a.play('pistol', 0.5, 0);
  a.play('rifle', 0.5, 0);
  assert.ok(Math.abs(out[0].gain.value - 0.5 * 1.0 * Math.SQRT1_2) < 1e-12, `mono: ${out[0].gain.value}`);
  assert.ok(Math.abs(out[1].gain.value - 0.5 * 0.5) < 1e-12, `stereo: ${out[1].gain.value}`);
  assert.equal(ctx.made.panner, 1, 'no panners for either');
}));

test('at most four of a sound at once, counted off as they end (no timer for each)', () => withAudio(() => {
  const a = new SoundSystem();
  a.unlock();
  const ctx = a.ctx;
  for (let i = 0; i < 6; i++) a.play('click');
  assert.equal(a.playing.get('click'), 4);
  const made = ctx.made.gain;
  a.play('click');
  assert.equal(ctx.made.gain, made, 'a fifth: not played');
  ctx.currentTime = 1; // (click's sound lasts 0.05 s)
  a.play('click');
  assert.equal(a.playing.get('click'), 1, 'the four ended, and this one started');
  assert.equal(a.endAt.length, 1);
}));

test('the queue plays each sound once per spot, the same Set used every frame', () => withAudio(() => {
  const a = new SoundSystem();
  a.unlock();
  const played = [];
  a.play = (name, vol, pan) => played.push([name, +vol.toFixed(3), +pan.toFixed(3)]);
  const seen = a.seen;
  a.playQueue([{ name: 'hit', x: 100, y: 0 }, { name: 'hit', x: 110, y: 0 }, { name: 'hit', x: 400, y: 0 }, { name: 'click' }], 100, 0);
  assert.deepEqual(played.map(p => p[0]), ['hit', 'hit', 'click']);
  assert.equal(played[0][2], 0, 'at the listener: in the middle');
  a.playQueue([{ name: 'hit', x: 100, y: 0 }], 100, 0);
  assert.equal(a.seen, seen);
  assert.equal(played.length, 4, 'a new frame: played again');
}));
