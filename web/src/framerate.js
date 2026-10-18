// How often frames are drawn. The browser calls the game once per screen refresh
// (60, 120, 144 Hz...), so that's the most it can draw. A frame rate cap draws
// less often. "Auto" draws at the screen's rate, or at an even fraction of it
// (144 -> 72 -> 48) when the computer can't keep up, since evenly spaced frames
// look smoother than a ragged higher rate. It tries the higher rate again later.
//
// The game itself always updates 60 times a second; this only paces drawing.

export const FRAME_RATES = [30, 60, 90, 120, 144, 165, 240];
const COMMON_HZ = [30, 48, 50, 60, 72, 75, 85, 90, 100, 120, 144, 165, 170, 175, 180, 200, 240, 280, 300, 360];
const MIN_FPS = 30;
const WINDOW = 2000;   // ms of drawing judged at a time
const SAMPLES = 90;    // browser frames used to measure the screen's rate

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
    this.backoff = 15000;
    this.trying = false;     // auto: just stepped up, and on probation
  }

  setMode(mode) {
    const n = Number(mode);
    this.mode = mode === 'auto' || !Number.isFinite(n) ? 'auto' : Math.max(MIN_FPS, n);
    this.divisor = 1;
    this.trying = false;
    this.win = null;
    this.lastDraw = -Infinity;
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

  /** After drawing a frame: how long the frame's work took (ms). Auto mode adjusts here. */
  drawn(now, workMs) {
    if (!this.win) { this.win = { start: now, drawn: 0, work: 0 }; return; }
    const w = this.win;
    w.drawn++;
    w.work += workMs;
    if (now - w.start < WINDOW) return;
    this.win = { start: now, drawn: 0, work: 0 };
    if (this.mode !== 'auto') return;
    const fps = (w.drawn * 1000) / (now - w.start);
    const work = w.work / Math.max(1, w.drawn);
    if (fps < this.target * 0.9) {
      // Can't keep up: draw every other refresh (or every third...).
      if (this.refresh / (this.divisor + 1) >= MIN_FPS) this.divisor++;
      if (this.trying) this.backoff = Math.min(this.backoff * 2, 120000);
      this.trying = false;
      this.retryAt = now + this.backoff;
    } else if (this.trying) {
      this.trying = false;
      this.backoff = 15000;
    } else if (this.divisor > 1 && now >= this.retryAt && work < 0.5 * (1000 / (this.refresh / (this.divisor - 1)))) {
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
