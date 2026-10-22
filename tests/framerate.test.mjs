// Frame pacing (web/src/framerate.js), with a pretend screen and computer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FramePacer, snapHz, evenRate, isEven } from '../web/src/framerate.js';

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

test('a cap is drawn at an even fraction of the screen rate when one is close; "half" is every other refresh', () => {
  assert.equal(evenRate(60, 165), 55, 'every third refresh');
  assert.equal(evenRate(30, 144), 28.8);
  assert.equal(evenRate(60, 144), 60, '72 and 48 are too far from 60');
  assert.equal(evenRate(60, 120), 60);
  assert.equal(evenRate(240, 144), 144, 'no more than the screen');
  assert.ok(isEven(55, 165) && isEven(72, 144) && !isEven(60, 144));
  const p = onScreen(165);
  p.setMode(60);
  assert.equal(p.target, 55);
  const { drawn } = run(p, { hz: 165, ms: 2000, start: 1000 });
  assert.ok(Math.abs(drawn - 110) <= 3, `${drawn} frames in 2 s`);
  const h = onScreen(144);
  h.setMode('half');
  assert.equal(h.target, 72);
  const half = run(h, { hz: 144, ms: 2000, start: 1000 });
  assert.ok(Math.abs(half.drawn - 144) <= 3, `${half.drawn} frames in 2 s`);
});

test('before lowering the rate, the pacer asks for lighter drawing (Remastered\'s auto quality)', () => {
  // Two levels of lighter drawing; frames only keep up at the lightest.
  const p = onScreen(60);
  let level = 2;
  const asked = [];
  p.shed = now => { asked.push(now); if (level > 0) { level--; return true; } return false; };
  run(p, { hz: 60, ms: 12000, start: 1000, work: () => (level > 0 ? 25 : 8) });
  assert.equal(level, 0, 'both levels used');
  assert.equal(asked.length, 2);
  assert.equal(p.target, 60, '...and the rate kept');
  // When lighter drawing isn't enough (or there's none), the rate comes down.
  const q = onScreen(60);
  q.shed = () => false;
  run(q, { hz: 60, ms: 5000, start: 1000, work: () => 25 });
  assert.equal(q.target, 30);
  // A capped rate asks too (it doesn't lower the rate itself).
  const c = onScreen(144);
  c.setMode(120);
  let calls = 0;
  c.shed = () => { calls++; return true; };
  run(c, { hz: 144, ms: 5000, start: 1000, work: () => 12 });
  assert.ok(calls >= 1, 'asked for lighter drawing');
  assert.equal(c.target, 120);
});

test('auto keeps a steady rate when some frames are slow, and gives up trying a rate that keeps failing', () => {
  // Every fourth frame takes 9 ms (too long at 144 fps): 72, and no tries at 144 that would judder.
  const p = onScreen(144);
  let i = 0, changes = 0, last = p.target;
  run(p, { hz: 144, ms: 60000, start: 1000, work: () => {
    if (p.target !== last) { changes++; last = p.target; }
    return ++i % 4 === 0 ? 9 : 1;
  } });
  assert.equal(p.target, 72);
  assert.equal(changes, 1, 'one step down, no flickering back and forth');
  // Quick at 72 but too slow at 144 (as if drawing more often costs more): a few tries, then no more.
  const q = onScreen(144);
  let tries = 0, prev = q.target;
  run(q, { hz: 144, ms: 180000, start: 1000, work: () => {
    if (q.target > prev) tries++;
    prev = q.target;
    return q.target > 100 ? 9 : 2;
  } });
  assert.equal(q.target, 72);
  assert.equal(tries, 3);
});

test('the screen getting slower or faster while playing (another monitor) is noticed after a few seconds', () => {
  const p = onScreen(144);
  run(p, { hz: 60, ms: 8000, start: 1000, work: () => 2 });
  assert.equal(p.refresh, 60);
  assert.equal(p.target, 60);
  run(p, { hz: 144, ms: 8000, start: 9000, work: () => 2 });
  assert.equal(p.refresh, 144);
  // A slow computer makes frames late too: that's not the screen.
  const q = onScreen(144);
  run(q, { hz: 144, ms: 15000, start: 1000, work: () => 14 });
  assert.equal(q.refresh, 144);
  // Nor are the frames after a long one in the menus.
  const m = new FramePacer();
  let t = 0;
  for (let k = 0; k < 200; k++) { m.frame(t, false); m.worked(25); t += 1000 / 30; }
  assert.equal(m.refresh, 60, 'unmeasured: menus that slow the browser\'s frames down say nothing about the screen');
});

test('a menu that\'s slow to show doesn\'t fool it for long: a faster rate while playing is believed at once', () => {
  // A pause menu the browser takes long to show: 30 frames a second on a 60 Hz screen, for a while.
  const p = onScreen(60);
  run(p, { hz: 30, ms: 7000, start: 1000, playing: false });
  assert.equal(p.refresh, 30, 'a slower rate, seen for a few seconds, is believed');
  p.setMode(30);
  // Back to the game: the screen's real rate is seen within a few frames, and the cap kept to.
  const { drawn } = run(p, { hz: 60, ms: 2000, start: 8000 });
  assert.equal(p.refresh, 60);
  assert.ok(Math.abs(drawn - 60) <= 5, `${drawn} frames in 2 s`);
  // A moment of slow frames doesn't lower it.
  run(p, { hz: 30, ms: 2000, start: 10000, playing: false });
  assert.equal(p.refresh, 60);
});
