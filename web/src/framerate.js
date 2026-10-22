// How often frames are drawn. The browser calls the game once per screen refresh
// (60, 120, 144 Hz...), so that's the most it can draw. A frame rate cap draws
// less often: at an even fraction of the screen's rate when there's one close to the
// cap (60 on a 165 Hz screen is drawn at 55, every third refresh, rather than every
// second then third), since evenly spaced frames look smoother than a ragged rate;
// "half" draws every other refresh, whatever the screen. "Auto"
// draws at the screen's rate, or at an even fraction of it (144 -> 72 -> 48) when the
// computer can't keep up for a few seconds. Before lowering the rate it asks the
// renderer to draw lighter (Remastered's auto quality steps down a level); it tries
// the higher rate again a few seconds later (and later still each time that fails,
// and after a few failures not again until something changes).
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
const TRIES = 3;          // failed tries at a higher rate before the rate's left alone (a try that fails is a second of judder)
const SAMPLES = 90;       // browser frames used to measure the screen's rate
const RECENT = 30;        // the latest few: enough to see a faster rate
const LOWER_AFTER = 3000; // ms the screen has to measure slower before that's believed
const SORT = new Float64Array(SAMPLES); // (scratch for measuring, so it makes no garbage)

export class FramePacer {
  constructor() {
    this.mode = 'auto';      // 'auto', 'half' (every other refresh) or a number (fps cap)
    this.refresh = 60;       // the screen's refresh rate, as measured
    this.gaps = new Float64Array(SAMPLES); // recent gaps between browser frames (ms), a ring
    this.gapCount = 0;
    this.gapAt = 0;          // where the next gap goes in the ring
    this.prev = null;        // time of the last browser frame
    this.lastDraw = -Infinity;
    this.divisor = 1;        // auto: draw every n-th refresh
    this.win = null;         // current judging window (see window())
    this.retryAt = 0;        // auto: when to next try a higher rate
    this.backoff = BACKOFF;
    this.trying = false;     // auto: just stepped up, and on probation
    this.tries = 0;          // auto: tries at a higher rate that failed since the last fresh start
    this.slow = 0;           // windows in a row that fell short (two step down: one is a hiccup)
    this.graceUntil = 0;     // windows ending before this aren't judged (see restart())
    this.lowerSince = null;  // since when the screen has measured slower than this.refresh
    this.lastWork = 0;       // ms the last frame's work took (a gap after a long frame says nothing about the screen)
    this.avgWork = 0;        // ms a drawn frame's work takes, lately
    this.shed = null;        // function(now): draw lighter if possible, returning whether it did; asked before the rate's lowered
  }

  setMode(mode) {
    const n = Number(mode);
    this.mode = mode === 'half' ? 'half' : mode === 'auto' || !Number.isFinite(n) ? 'auto' : Math.max(MIN_FPS, n);
    this.restart(this.prev ?? 0, true);
  }

  /**
   * A fresh start: a match beginning (the route map being built, every bot thinking at
   * once), the drawing getting lighter, or the graphics or quality changing. The next
   * couple of seconds aren't judged (they're no measure of how it plays), and the higher
   * rates are worth trying again; `fresh`: the full rate is tried again at once.
   */
  restart(now, fresh = false) {
    this.win = null;
    this.slow = 0;
    this.trying = false;
    this.tries = 0;
    this.backoff = BACKOFF;
    this.graceUntil = now + GRACE;
    if (fresh) {
      this.divisor = 1;
      this.retryAt = 0;
      this.lastDraw = -Infinity;
    }
  }

  /** Frames a second being aimed for now. */
  get target() {
    if (this.mode === 'auto') return this.refresh / this.divisor;
    if (this.mode === 'half') return this.refresh / 2;
    return evenRate(this.mode, this.refresh);
  }

  /**
   * Call on every browser frame. `playing`: a match is being drawn (only then are
   * frames judged, and capped). Returns whether to draw this frame.
   */
  frame(now, playing) {
    this.measure(now);
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
   * After drawing a frame: how long the frame's work took (ms). The rate's adjusted here,
   * a window of frames at a time: falling well short of the rate, or a little short for
   * two windows running (one is a hiccup: a big explosion), first asks for lighter drawing
   * (see `shed`), then in auto mode steps the rate down; a window that took far longer
   * than it should (a tab switched away from, a stall) isn't judged; with time to spare,
   * and few frames that would've been late at the next rate up, auto tries that rate
   * again after a while (longer each time that fails).
   */
  drawn(now, workMs) {
    this.lastWork = workMs;
    this.avgWork += (workMs - this.avgWork) * 0.1;
    if (!this.win) { this.win = this.window(now); return; }
    const w = this.win;
    w.drawn++;
    w.work += workMs;
    if (workMs > w.late) w.heavy++;
    const len = this.trying ? PROBATION : WINDOW;
    if (now - w.start < len) return;
    this.win = this.window(now);
    if (now < this.graceUntil || now - w.start > len * 1.5) return;
    const target = this.target;
    const fps = (w.drawn * 1000) / (now - w.start);
    if (fps < target * 0.9) {
      if (!this.trying && fps >= target * 0.7 && ++this.slow < 2) return;
      this.slow = 0;
      if (this.trying) {
        // The try at the higher rate failed: back down, and longer before the next.
        this.trying = false;
        this.divisor++;
        this.tries++;
        this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX);
        this.retryAt = now + this.backoff;
        return;
      }
      // Can't keep up: lighter drawing first, then every other refresh (or every third...).
      if (this.shed?.(now)) { this.restart(now); return; }
      if (this.mode !== 'auto') return;
      if (this.refresh / (this.divisor + 1) >= MIN_FPS) this.divisor++;
      this.retryAt = now + this.backoff;
      return;
    }
    this.slow = 0;
    if (this.trying) { this.trying = false; this.backoff = BACKOFF; this.tries = 0; return; }
    if (this.mode !== 'auto' || this.divisor === 1 || now < this.retryAt || this.tries >= TRIES) return;
    // Plenty of time to spare, and hardly a frame that would've been late at the next rate up: try it.
    const work = w.work / Math.max(1, w.drawn);
    if (work < 0.5 * w.up && w.heavy < w.drawn * 0.1) { this.divisor--; this.trying = true; }
  }

  /** A judging window. `up`: a frame's time at the next rate up; `late`: a frame taking longer would've been late at it. */
  window(now) {
    const up = this.mode === 'auto' && this.divisor > 1 ? 1000 / (this.refresh / (this.divisor - 1)) : Infinity;
    return { start: now, drawn: 0, work: 0, heavy: 0, up, late: up * 0.85 };
  }

  /** After a frame that wasn't judged (a menu drawn): how long its work took (ms). */
  worked(workMs) {
    this.lastWork = workMs;
    this.avgWork += (workMs - this.avgWork) * 0.1;
  }

  /**
   * Measure the screen's refresh rate from the gaps between browser frames: a low
   * percentile, since most frames arrive on time even when some are late. A faster rate is
   * believed at once, from the latest frames (frames can't come faster than the screen
   * shows them: the first measurement, or a menu that was slow to show); a slower one (the
   * window moved to another monitor, the browser saving power) after a few seconds of it,
   * and only while frames are quick to draw, since a slow computer makes frames late too.
   * A change is a fresh start.
   */
  measure(now) {
    const gap = this.prev == null ? null : now - this.prev;
    const work = this.lastWork;
    this.prev = now;
    this.lastWork = 0;
    if (gap == null || gap <= 0 || gap > 250) return; // first frame, or back from a hidden tab
    if (work > gap * 0.5) return; // (the frame before took most of the gap: it was late, the screen wasn't)
    this.gaps[this.gapAt] = gap;
    this.gapAt = (this.gapAt + 1) % SAMPLES;
    if (this.gapCount < SAMPLES) this.gapCount++;
    if (this.gapCount < RECENT) return;
    const recent = snapHz(1000 / this.lowGap(RECENT));
    if (recent > this.refresh) { this.setRefresh(recent, now); return; }
    const hz = snapHz(1000 / this.lowGap(SAMPLES));
    if (hz >= this.refresh || !(this.avgWork < 0.5 * (1000 / hz))) { this.lowerSince = null; return; }
    if (this.lowerSince == null) this.lowerSince = now;
    else if (now - this.lowerSince >= LOWER_AFTER) this.setRefresh(hz, now);
  }

  /** The 20th percentile of the last n gaps (fewer if there aren't n yet). */
  lowGap(n) {
    n = Math.min(n, this.gapCount);
    for (let i = 0; i < n; i++) SORT[i] = this.gaps[(this.gapAt - 1 - i + SAMPLES) % SAMPLES];
    const sorted = SORT.subarray(0, n).sort();
    return sorted[Math.floor(n * 0.2)];
  }

  setRefresh(hz, now) {
    this.refresh = hz;
    this.lowerSince = null;
    this.restart(now, true);
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

/**
 * A frame rate cap as drawn on a screen refreshing `refresh` times a second: the even
 * fraction of the screen's rate nearest the cap if there's one within a tenth of it
 * (60 on 165 Hz: 55, every third refresh), for an even rhythm; else the cap itself (or
 * the screen's rate, if that's lower).
 */
export function evenRate(cap, refresh) {
  if (cap >= refresh) return refresh;
  let best = cap, dist = cap * 0.1;
  for (const n of [Math.floor(refresh / cap), Math.ceil(refresh / cap)]) {
    const rate = refresh / n, e = Math.abs(rate - cap);
    if (n >= 1 && e <= dist) { best = rate; dist = e; }
  }
  return best;
}

/** Whether frames at `fps` come evenly on a screen refreshing `refresh` times a second (every n-th refresh). */
export function isEven(fps, refresh) {
  const n = refresh / fps;
  return Math.abs(n - Math.round(n)) < 0.02;
}
