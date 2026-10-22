// How often frames are drawn. The browser calls the game once per screen refresh
// (60, 120, 144 Hz...), so that's the most it can draw. A frame rate cap draws
// less often. "Auto" draws at the screen's rate, or at an even fraction of it
// (144 -> 72 -> 48) when the computer can't keep up for a few seconds, since evenly
// spaced frames look smoother than a ragged higher rate. It tries the higher rate
// again a few seconds later (and later still each time that fails).
//
// The game itself always updates 60 times a second; this only paces drawing.

export const FRAME_RATES = [30, 60, 90, 120, 144, 165, 240];
const COMMON_HZ = [30, 48, 50, 60, 72, 75, 85, 90, 100, 120, 144, 165, 170, 175, 180, 200, 240, 280, 300, 360];
const MIN_FPS = 30;
const WINDOW = 2000;      // ms of drawing judged at a time
const PROBATION = 1000;   // ms a try at a higher rate gets before it's judged
const GRACE = 2500;       // ms after a fresh start (a match beginning, the graphics changing) before windows are judged
const BACKOFF = 4000;     // ms before the first try at a higher rate again (doubles each time a try fails)
const BACKOFF_MAX = 60000;
const RETRY_SOON = 2000;  // ms before trying a higher rate after Remastered's quality steps down
const SAMPLES = 90;       // browser frames used to measure the screen's rate

export class FramePacer {
  constructor() {
    this.mode = 'auto';      // 'auto' or a number (fps cap)
    this.refresh = 60;       // the screen's refresh rate, as measured
    this.gaps = [];          // recent gaps between browser frames (ms)
    this.prev = null;        // time of the last browser frame
    this.lastDraw = -Infinity;
    this.divisor = 1;        // auto: draw every n-th refresh
    this.win = null;         // current judging window { start, drawn, work }
    this.retryAt = 0;        // auto: when to next try a higher rate
    this.backoff = BACKOFF;
    this.trying = false;     // auto: just stepped up, and on probation
    this.slow = 0;           // auto: windows in a row that fell short (two step the rate down: one is a hiccup)
    this.graceUntil = 0;     // windows ending before this aren't judged (see restart())
    this.stepped = 0;        // times the rate's been stepped down (Remastered's auto quality watches this)
  }

  setMode(mode) {
    const n = Number(mode);
    this.mode = mode === 'auto' || !Number.isFinite(n) ? 'auto' : Math.max(MIN_FPS, n);
    this.restart(this.prev ?? 0, true);
  }

  /**
   * A fresh start: a match beginning (the route map being built, every bot thinking at
   * once), or the graphics or quality changing. The next couple of seconds aren't judged
   * (they're no measure of how it plays); `fresh`: the full rate is tried again too.
   */
  restart(now, fresh = false) {
    this.win = null;
    this.slow = 0;
    this.trying = false;
    this.graceUntil = now + GRACE;
    if (fresh) {
      this.divisor = 1;
      this.backoff = BACKOFF;
      this.retryAt = 0;
      this.lastDraw = -Infinity;
    }
  }

  /** After a change for the better (Remastered's quality stepped down): try the next rate up soon. */
  tryAgainSoon(now) {
    this.slow = 0;
    this.trying = false;
    this.backoff = BACKOFF;
    this.retryAt = now + RETRY_SOON;
  }

  /** Frames a second being aimed for now. */
  get target() {
    if (this.mode === 'auto') return this.refresh / this.divisor;
    return Math.min(this.mode, this.refresh);
  }

  /**
   * Call on every browser frame. `playing`: a match is being drawn (menus are
   * cheap, so they're when the screen's real rate is measured). Returns whether
   * to draw this frame.
   */
  frame(now, playing) {
    this.measure(now, playing);
    if (!playing) { this.win = null; return true; }
    const target = this.target;
    if (target >= this.refresh * 0.98) { this.lastDraw = now; return true; }
    const interval = 1000 / target, slack = 500 / this.refresh;
    const since = now - this.lastDraw;
    if (since < interval - slack) return false;
    // Keep to an even rhythm, unless we've fallen well behind it.
    this.lastDraw = since > interval * 2 ? now : this.lastDraw + interval;
    return true;
  }

  /**
   * After drawing a frame: how long the frame's work took (ms). Auto mode adjusts here:
   * falling well short of the rate, or a little short for two windows running (one is a
   * hiccup: a big explosion), steps the rate down; a window that took far longer than it
   * should (a tab switched away from, a stall) isn't judged; with time to spare it tries
   * the next rate up again, after a while (longer each time that fails).
   */
  drawn(now, workMs) {
    if (!this.win) { this.win = { start: now, drawn: 0, work: 0 }; return; }
    const w = this.win;
    w.drawn++;
    w.work += workMs;
    const len = this.trying ? PROBATION : WINDOW;
    if (now - w.start < len) return;
    this.win = { start: now, drawn: 0, work: 0 };
    if (this.mode !== 'auto' || now < this.graceUntil || now - w.start > len * 1.5) return;
    const fps = (w.drawn * 1000) / (now - w.start);
    const work = w.work / Math.max(1, w.drawn);
    if (fps < this.target * 0.9) {
      if (!this.trying && fps >= this.target * 0.7 && ++this.slow < 2) return;
      // Can't keep up: draw every other refresh (or every third...).
      this.slow = 0;
      if (this.refresh / (this.divisor + 1) >= MIN_FPS) { this.divisor++; this.stepped++; }
      if (this.trying) this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX);
      this.trying = false;
      this.retryAt = now + this.backoff;
      return;
    }
    this.slow = 0;
    if (this.trying) { this.trying = false; this.backoff = BACKOFF; return; }
    if (this.divisor > 1 && now >= this.retryAt && work < 0.5 * (1000 / (this.refresh / (this.divisor - 1)))) {
      // Plenty of time to spare: try the next rate up.
      this.divisor--;
      this.trying = true;
    }
  }

  /** Measure the screen's refresh rate from the gaps between browser frames. */
  measure(now, playing) {
    const gap = this.prev == null ? null : now - this.prev;
    this.prev = now;
    if (gap == null || gap <= 0 || gap > 250) return; // first frame, or back from a hidden tab
    this.gaps.push(gap);
    if (this.gaps.length > SAMPLES) this.gaps.shift();
    if (this.gaps.length < 30) return;
    // A low percentile: most frames arrive on time even when some are late.
    const sorted = [...this.gaps].sort((a, b) => a - b);
    const hz = snapHz(1000 / sorted[Math.floor(sorted.length * 0.2)]);
    // In menus the measurement is reliable; while playing, a slow computer can
    // make frames arrive late, so only ever raise it then.
    if (!playing) this.refresh = hz;
    else if (hz > this.refresh) this.refresh = hz;
  }
}

/** Round a measured rate to the nearest usual screen rate, if it's close to one. */
export function snapHz(hz) {
  let best = Math.round(hz), d = Infinity;
  for (const c of COMMON_HZ) {
    const e = Math.abs(c - hz) / c;
    if (e < 0.04 && e < d) { d = e; best = c; }
  }
  return best;
}
