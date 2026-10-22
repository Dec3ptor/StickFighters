// Frame pacing (web/src/framerate.js), with a pretend screen and computer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FramePacer, snapHz } from '../web/src/framerate.js';

/**
 * Run the pacer against a screen refreshing `hz` times a second for `ms`.
 * work(t): how long drawing a frame takes at time t; a slow frame makes the
 * next browser frame wait for the next refresh after it's done.
 */
function run(p, { hz, ms, start = 0, work = () => 1, playing = true }) {
  const v = 1000 / hz;
  let t = start, drawn = 0;
  while (t < start + ms) {
    if (p.frame(t, playing)) {
      drawn++;
      const w = work(t);
      if (playing) p.drawn(t + w, w);
      t = Math.ceil((t + w) / v - 1e-9) * v;
      if (t <= 0) t = v;
    } else t += v;
    t = Math.round(t * 1000) / 1000;
  }
  return { drawn, end: t };
}

/** A pacer that has seen the menu on this screen for a second (to measure it). */
function onScreen(hz) {
  const p = new FramePacer();
  run(p, { hz, ms: 1000, playing: false });
  return p;
}

test('the screen refresh rate is measured from the browser frames', () => {
  for (const hz of [60, 75, 120, 144, 240]) assert.equal(onScreen(hz).refresh, hz);
  assert.equal(snapHz(143.7), 144);
  assert.equal(snapHz(59.94), 60);
});

test('a frame rate cap draws that many frames a second', () => {
  const p = onScreen(144);
  p.setMode(60);
  const { drawn } = run(p, { hz: 144, ms: 2000, start: 1000 });
  assert.ok(Math.abs(drawn - 120) <= 3, `${drawn} frames in 2 s`);
});

test('a cap above the screen rate just draws every refresh', () => {
  const p = onScreen(144);
  p.setMode(240);
  const { drawn } = run(p, { hz: 144, ms: 1000, start: 1000 });
  assert.ok(Math.abs(drawn - 144) <= 2, `${drawn} frames in 1 s`);
});

test('auto draws at the screen rate when the computer keeps up', () => {
  const p = onScreen(144);
  const { drawn } = run(p, { hz: 144, ms: 5000, start: 1000 });
  assert.equal(p.target, 144);
  assert.ok(drawn > 144 * 5 * 0.97, `${drawn} frames in 5 s`);
});

test("auto drops to an even fraction when the computer can't keep up, and goes back up when it can", () => {
  const p = onScreen(144);
  // Frames take 10 ms to draw: too slow for 144 fps (6.9 ms each).
  let slow = true;
  run(p, { hz: 144, ms: 6000, start: 1000, work: () => (slow ? 10 : 1.5) });
  assert.equal(p.target, 72, 'every other refresh');
  // Then it gets fast again: after a while, auto tries 144 again and keeps it.
  slow = false;
  run(p, { hz: 144, ms: 40000, start: 7000, work: () => (slow ? 10 : 1.5) });
  assert.equal(p.target, 144);
});

test('auto lets one slow window go (a hiccup), and gives a fresh start a couple of seconds', () => {
  const p = onScreen(144);
  // One slow spell (a big explosion: 30 ms frames for half a second), then fine: no step down.
  run(p, { hz: 144, ms: 600, start: 1000, work: () => 30 });
  run(p, { hz: 144, ms: 5400, start: 1600, work: () => 1.5 });
  assert.equal(p.target, 144, 'one slow spell is a hiccup');
  // A match starting: its first seconds (the route map being built, every bot thinking) aren't judged.
  p.restart(7000);
  run(p, { hz: 144, ms: 3000, start: 7000, work: () => 10 });
  assert.equal(p.target, 144, 'the start of a match isn\'t judged');
  run(p, { hz: 144, ms: 5000, start: 10000, work: () => 10 });
  assert.equal(p.target, 72, 'still slow after that: stepped down');
  assert.equal(p.stepped, 1);
  // A fresh start (new graphics): the full rate is tried again.
  p.restart(15000, true);
  assert.equal(p.target, 144);
});

test('auto steps down at once when it falls well short, and ignores a window that stalled (a hidden tab)', () => {
  const p = onScreen(60);
  // Frames of 30 ms: 30 fps at best, half the rate. One window is enough.
  run(p, { hz: 60, ms: 2500, start: 1000, work: () => 30 });
  assert.equal(p.target, 30);
  const q = onScreen(60);
  // A window that lasted far longer than it should (the tab was hidden): not judged.
  q.drawn(1000, 2); q.drawn(1016, 2); q.drawn(1033, 2);
  q.drawn(9000, 2);
  assert.equal(q.target, 60);
  assert.equal(q.slow, 0);
});

test('auto never goes below 30 fps', () => {
  const p = onScreen(60);
  run(p, { hz: 60, ms: 30000, start: 1000, work: () => 80 });
  assert.equal(p.target, 30);
});
