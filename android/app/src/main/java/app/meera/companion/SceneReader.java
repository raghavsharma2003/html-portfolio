package app.meera.companion;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * What the screen is DOING. A LINE-FOR-LINE PORT of src/watch/scene.ts —
 * every constant, every threshold and every branch is the same, so the two
 * surfaces cannot drift. Read the TypeScript for the full reasoning; the
 * short version:
 *
 * <p>Screen sharing is not one activity. The same 120ms sampler has to serve
 * a reel feed that turns over every 3 seconds, a code file that changes every
 * 30, and an article that does not change at all while it is being read. So
 * this class derives WHAT HAPPENED from the 32x32 luma grid the capture
 * service already reads out of the plane, and the caller turns that into a
 * wake-up.
 *
 * <p>THE HARD RULE: code may only WAKE her and report WHAT HAPPENED. There
 * are no per-app rules here, no content scoring, no keyword triggers and no
 * phrase banks. Nothing in this class knows what is on the screen — only how
 * many cells moved, where, whether the picture translated rather than being
 * replaced, and how long it has been standing still. Her judgment decides
 * what, and whether, to say; silence answers every wake.
 *
 * <p>The distinction that matters most is DELIBERATE SHOW vs AMBIENT
 * PRESENCE. A human "dekh yeh" is not the movement, it is the ARREST of the
 * movement. So the new-thing wake sits on the HOLD, and the hold threshold is
 * measured against the user's own current rhythm — "stopped" means nothing in
 * absolute terms.
 *
 * <p>Handler-thread confined, exactly like the grid it reads.
 */
final class SceneReader {

  static final int SIG_SIDE = 32;
  static final int SIG_LEN = SIG_SIDE * SIG_SIDE;

  // wake classes — SHOW means "they just did something that asks for you",
  // AMBIENT means "you have been sitting here a while"
  static final int WAKE_NONE = 0;
  static final int WAKE_START = 1;
  static final int WAKE_SETTLE = 2;
  static final int WAKE_RESHOW = 3;
  static final int WAKE_POINT = 4;
  static final int WAKE_SWITCH = 5;
  static final int WAKE_ALONG = 6;
  static final int WAKE_IDLE = 7;

  static boolean isShow(int wake) {
    return wake == WAKE_SETTLE || wake == WAKE_RESHOW || wake == WAKE_POINT || wake == WAKE_SWITCH;
  }

  // ── unchanged, because they were measured on real capture ──
  private static final double NEW_MAD = 12;
  private static final int CELL_DELTA = 8;
  private static final int ACTIVE_CELLS = 1;

  // a hold tolerates a little life, but only life that STAYS PUT: a blinking
  // caret or a clock digit does not break a hold, an ADVANCING caret does
  private static final int HOLD_TOLERANCE_CELLS = 4;
  private static final double HOLD_TOLERANCE_MAD = 1.5;
  private static final double HOLD_DRIFT = 1;

  // a scroll is a TRANSLATION, not a replacement
  private static final int SHIFT_MAX = 6;
  private static final double SHIFT_GAIN = 0.55;

  // a playing video changes the interior violently and the chrome barely
  private static final double RING_NEW_MAD = 8;
  private static final double FULL_TURNOVER = 0.6;

  // an edge-anchored band that leaves most of the screen alone is
  // structurally an overlay — a banner, a toast, the keyboard, a volume HUD
  private static final int OVERLAY_MAX_ROWS = SIG_SIDE / 2;

  // a cursor is smaller than one grid cell; travel in BOTH axes is what keeps
  // a typing caret (which only advances in x) out of this branch
  private static final int POINT_MIN_CELLS = 1;
  private static final int POINT_MAX_CELLS = 6;
  private static final int POINT_TICKS = 5;
  private static final double POINT_TRAVEL = 2;
  private static final long POINT_FLOOR_MS = 8000L;

  private static final double MICRO_COVERAGE = 0.03;

  private static final double HOLD_MULTIPLIER = 1.8;
  private static final long REPLACE_MEMORY_MS = 15_000L;
  private static final long HOLD_REPLACE_MIN = 260L;
  private static final long HOLD_REPLACE_MAX = 4000L;
  private static final long HOLD_CHURN_MIN = 260L;
  private static final long HOLD_CHURN_MAX = 2000L;
  private static final long HOLD_MICRO_MIN = 2500L;
  private static final long HOLD_MICRO_MAX = 8000L;
  private static final long HOLD_SCROLL_MIN = 1200L;
  private static final long HOLD_SCROLL_MAX = 25_000L;
  private static final int BURST_RING = 8;
  private static final long BURST_MEMORY_MS = 60_000L;
  private static final int STORM_BURSTS = 3;
  private static final long STORM_WINDOW_MS = 8000L;
  private static final long SHOW_FLOOR_MS = 4000L;

  private static final long SWITCH_CONFIRM_MS = 900L;

  private static final int RESHOW_RING = 20;
  private static final long RESHOW_EVERY_MS = 1000L;
  private static final long RESHOW_MIN_AGE_MS = 2000L;
  private static final long RESHOW_MAX_AGE_MS = 20_000L;
  private static final double RESHOW_MAD = 4;

  private static final double NOVELTY_BUDGET = 3.0;
  private static final double NOVELTY_CHURN_PER_TICK = 0.006;
  private static final double NOVELTY_MICRO_PER_TICK = 0.002;
  private static final long ALONG_MIN_MS = 12_000L;
  private static final long IDLE_WAKE_MS = 45_000L;
  private static final double IDLE_JITTER = 0.15;

  // Everything above is computed in DOUBLE, exactly as the TypeScript twin
  // does. In float, the novelty accumulator tipped its budget one 120ms tick
  // early on a long churn and produced an ambient wake the web lane did not —
  // caught by scratchpad/parity, which replays the same synthesised situations
  // through both implementations and diffs the wake sequences.

  // arm kinds, ranked: a stronger kind seen anywhere in a burst wins
  private static final int ARM_NONE = 0;
  private static final int ARM_OVERLAY = 1;
  private static final int ARM_MICRO = 2;
  private static final int ARM_CHURN = 3;
  private static final int ARM_SCROLL = 4;
  private static final int ARM_REPLACE = 5;

  /** Result of one tick. Reused in place: the caller reads it and drops it. */
  static final class Out {
    int motion; // 0 nothing · 1 activity · 2 a new thing (the legacy band)
    double coverage;
    boolean blank; // FLAG_SECURE window, locked screen, display asleep
    boolean quiet; // the screen is holding still
    /** Get a still picture of this screen into the socket NOW, ahead of the
     *  cadence. Deliberately NOT the first still tick: every micro-pause
     *  between two keystrokes and every glance between two flicks is a still
     *  tick, and paying for a frame at each of them costs MORE than the
     *  baseline it was meant to sit inside. It fires halfway through the hold
     *  this screen would actually need. */
    boolean preroll;
    int wake = WAKE_NONE;
  }

  private final Out out = new Out();

  private byte[] prev;
  private boolean prevBig = false;

  private long quietSince = 0;
  private double holdCx = 0;
  private double holdCy = 0;
  private int armed = ARM_NONE;
  private boolean armedReshow = false;
  private boolean settled = false;
  private boolean checkedRing = false;
  private boolean prerolled = false;
  private boolean prerollNow = false;

  private final long[] bursts = new long[BURST_RING];
  private int burstIdx = 0;
  private final long[] reps = new long[BURST_RING];
  private int repIdx = 0;
  private boolean repBurst = false;

  private long pendingAt = 0;
  private boolean pendingFired = true;

  private int pointTicks = 0;
  private double pointFromX = 0;
  private double pointFromY = 0;
  private long lastPointWakeAt = 0;

  private final List<byte[]> ringSig = new ArrayList<>();
  private final List<Long> ringAtList = new ArrayList<>();
  private final List<Integer> ringHold = new ArrayList<>();
  private long ringAt = 0;
  private int holdId = 0;

  private double novelty = 0;
  private long lastAmbientAt = 0;
  private long lastShowAt = 0;
  private long idleTarget = IDLE_WAKE_MS;
  private long startedAt = 0;

  /** Wipe every carried belief. A new share starts genuinely new. */
  void reset() {
    prev = null;
    prevBig = false;
    quietSince = 0;
    armed = ARM_NONE;
    armedReshow = false;
    settled = false;
    checkedRing = false;
    prerolled = false;
    prerollNow = false;
    Arrays.fill(bursts, 0);
    burstIdx = 0;
    Arrays.fill(reps, 0);
    repIdx = 0;
    repBurst = false;
    pendingAt = 0;
    pendingFired = true;
    pointTicks = 0;
    lastPointWakeAt = 0;
    ringSig.clear();
    ringAtList.clear();
    ringHold.clear();
    ringAt = 0;
    holdId = 0;
    novelty = 0;
    lastAmbientAt = 0;
    lastShowAt = 0;
    startedAt = 0;
    idleTarget = IDLE_WAKE_MS;
  }

  /**
   * Tell the reader a wake actually went out. The caller does this AFTER its
   * own gates, because a wake the socket, the ceiling or her own voice refused
   * never happened and must not spend the budget.
   */
  void noteWake(int wake, long at) {
    if (isShow(wake)) {
      settled = true;
      lastShowAt = at;
      armedReshow = false;
    } else {
      lastAmbientAt = at;
      novelty = 0;
      idleTarget = (long) (IDLE_WAKE_MS * (1 + (Math.random() * 2 - 1) * IDLE_JITTER));
    }
    if (wake == WAKE_POINT) lastPointWakeAt = at;
  }

  /**
   * The screen did not redraw at all. MediaProjection only produces a buffer
   * when something composites, so acquireLatestImage() returns null on a
   * static screen — and a static screen is exactly a hold. The old early
   * return meant the stiller the screen got, the less the code could see it,
   * and the single most important moment in the product (they stopped on
   * something and waited) executed no code at all.
   */
  Out still(long at) {
    if (prev == null) {
      out.motion = 0;
      out.coverage = 0;
      out.blank = false;
      out.quiet = false;
      out.preroll = false;
      out.wake = WAKE_NONE;
      return out;
    }
    return step(prev, at, true);
  }

  /** One detect tick. {@code sig} is a 32x32 luma grid. */
  Out read(byte[] sig, long at) {
    return step(sig, at, false);
  }

  private Out step(byte[] sig, long at, boolean repeat) {
    if (startedAt == 0) startedAt = at;
    byte[] p = prev;

    int lo = 255;
    int hi = 0;
    long lum = 0;
    for (int i = 0; i < SIG_LEN; i++) {
      int v = sig[i] & 0xFF;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      lum += v;
    }
    boolean blank = hi - lo <= 12 && lum / (double) SIG_LEN <= 40;

    if (p == null) {
      prev = sig;
      quietSince = at;
      out.motion = 2;
      out.coverage = 1;
      out.blank = blank;
      out.quiet = true;
      out.preroll = true;
      out.wake = WAKE_NONE;
      return out;
    }

    int moved = 0;
    double mad = 0;
    double ringMad = 0;
    double cx = 0;
    double cy = 0;
    int rowLo = SIG_SIDE;
    int rowHi = -1;
    if (!repeat) {
      long dsum = 0;
      long ringSum = 0;
      int ringN = 0;
      for (int y = 0; y < SIG_SIDE; y++) {
        boolean edgeRow = y < 4 || y >= SIG_SIDE - 4;
        for (int x = 0; x < SIG_SIDE; x++) {
          int i = y * SIG_SIDE + x;
          int d = Math.abs((sig[i] & 0xFF) - (p[i] & 0xFF));
          dsum += d;
          if (d >= CELL_DELTA) {
            moved++;
            cx += x;
            cy += y;
            if (y < rowLo) rowLo = y;
            if (y > rowHi) rowHi = y;
          }
          if (edgeRow || x < 4 || x >= SIG_SIDE - 4) {
            ringSum += d;
            ringN++;
          }
        }
      }
      mad = dsum / (double) SIG_LEN;
      ringMad = ringN > 0 ? ringSum / (double) ringN : 0;
      if (moved > 0) {
        cx /= moved;
        cy /= moved;
      }
    }

    double coverage = moved / (double) SIG_LEN;
    boolean big = mad >= NEW_MAD;

    boolean scrolled = false;
    if (big) {
      double best = mad;
      for (int k = -SHIFT_MAX; k <= SHIFT_MAX; k++) {
        if (k == 0) continue;
        double m = madShift(p, sig, k);
        if (m < best) best = m;
      }
      scrolled = best < mad * SHIFT_GAIN;
    }
    boolean overlay =
        moved > 0 && rowHi - rowLo + 1 <= OVERLAY_MAX_ROWS && (rowLo == 0 || rowHi == SIG_SIDE - 1);
    boolean replaced =
        big && !scrolled && !overlay && !blank && (ringMad >= RING_NEW_MAD || coverage >= FULL_TURNOVER);

    int motion = replaced && !prevBig ? 2 : (moved >= ACTIVE_CELLS || big ? 1 : 0);
    prevBig = big;

    boolean quiet = moved == 0;
    if (!quiet && moved <= HOLD_TOLERANCE_CELLS && mad < HOLD_TOLERANCE_MAD) {
      quiet =
          quietSince > 0
              && Math.abs(cx - holdCx) <= HOLD_DRIFT
              && Math.abs(cy - holdCy) <= HOLD_DRIFT;
    }
    boolean micro = !quiet && coverage > 0 && coverage <= MICRO_COVERAGE;

    if (quiet) {
      if (quietSince == 0) {
        quietSince = at;
        checkedRing = false;
        prerolled = false;
        if (moved > 0) {
          holdCx = cx;
          holdCy = cy;
        }
      }
    } else {
      if (quietSince != 0) {
        bursts[burstIdx] = at;
        burstIdx = (burstIdx + 1) % BURST_RING;
        armed = ARM_NONE;
        armedReshow = false;
        settled = false;
        repBurst = false;
        prerolled = false;
        holdId++;
        pointTicks = 0;
        if (!micro && !overlay) novelty += Math.min(1, Math.max(coverage, 0.1));
      }
      quietSince = 0;
      holdCx = cx;
      holdCy = cy;
      int kind =
          replaced
              ? ARM_REPLACE
              : scrolled ? ARM_SCROLL : overlay ? ARM_OVERLAY : micro ? ARM_MICRO : ARM_CHURN;
      if (kind > armed) armed = kind;
      if (replaced && !repBurst) {
        repBurst = true;
        reps[repIdx] = at;
        repIdx = (repIdx + 1) % BURST_RING;
      }
      novelty += micro ? NOVELTY_MICRO_PER_TICK : NOVELTY_CHURN_PER_TICK;
    }

    if (replaced) {
      pendingAt = at;
      pendingFired = false;
    }

    // Coming back to something means they NAVIGATED back to it: a hold armed
    // by typing or by a video pausing is the same screen, not a return. The
    // match must also be to a screen at least two holds ago.
    if (quiet && !checkedRing) {
      checkedRing = true;
      if (armed == ARM_REPLACE || armed == ARM_SCROLL) {
        byte[] small = reduce(sig);
        for (int i = 0; i < ringSig.size(); i++) {
          long age = at - ringAtList.get(i);
          if (ringHold.get(i) <= holdId - 2
              && age >= RESHOW_MIN_AGE_MS
              && age <= RESHOW_MAX_AGE_MS
              && madSmall(ringSig.get(i), small) <= RESHOW_MAD) {
            armedReshow = true;
            break;
          }
        }
      }
    }
    if (quiet && at - ringAt >= RESHOW_EVERY_MS) {
      ringAt = at;
      ringSig.add(reduce(sig));
      ringAtList.add(at);
      ringHold.add(holdId);
      if (ringSig.size() > RESHOW_RING) {
        ringSig.remove(0);
        ringAtList.remove(0);
        ringHold.remove(0);
      }
    }

    prev = sig;

    out.motion = motion;
    out.coverage = coverage;
    out.blank = blank;
    out.quiet = quiet;
    prerollNow = false;
    out.wake = pick(at, quiet, moved, mad, cx, cy, blank);
    out.preroll = prerollNow;
    return out;
  }

  private int pick(long at, boolean quiet, int moved, double mad, double cx, double cy, boolean blank) {
    long[] tempo = tempo(at);
    long gap = tempo[0];
    long repGap = tempo[1];
    boolean storm = tempo[2] == 1;
    // 0 means "never yet", not "at the epoch"
    boolean showOk = lastShowAt == 0 || at - lastShowAt >= SHOW_FLOOR_MS;

    // ── SHOW ──
    if (quiet && armed != ARM_NONE && armed != ARM_OVERLAY && !settled && !blank) {
      long hold = holdFor(gap, repGap);
      long held = at - quietSince;
      if (!prerolled && held >= hold / 2) {
        prerolled = true;
        prerollNow = true;
      }
      if (showOk && held >= hold) return armedReshow ? WAKE_RESHOW : WAKE_SETTLE;
    }

    if (!blank
        && showOk
        && moved >= POINT_MIN_CELLS
        && moved <= POINT_MAX_CELLS
        && mad < HOLD_TOLERANCE_MAD
        && (lastPointWakeAt == 0 || at - lastPointWakeAt >= POINT_FLOOR_MS)) {
      if (pointTicks == 0) {
        pointFromX = cx;
        pointFromY = cy;
      }
      pointTicks++;
      if (pointTicks >= POINT_TICKS
          && Math.abs(cx - pointFromX) >= POINT_TRAVEL
          && Math.abs(cy - pointFromY) >= POINT_TRAVEL) {
        pointTicks = 0;
        return WAKE_POINT;
      }
    } else if (moved > POINT_MAX_CELLS) {
      pointTicks = 0;
    }

    if (!pendingFired && !quiet && !blank && showOk && at - pendingAt >= SWITCH_CONFIRM_MS) {
      pendingFired = true;
      return WAKE_SWITCH;
    }

    // ── AMBIENT ──
    // never mid-flick-storm: they are moving PAST things, and each one was
    // explicitly not chosen
    if (storm) return WAKE_NONE;

    if (novelty >= NOVELTY_BUDGET
        && (lastAmbientAt == 0 || at - lastAmbientAt >= ALONG_MIN_MS)
        && at - startedAt >= ALONG_MIN_MS) {
      return WAKE_ALONG;
    }
    if (quiet
        && quietSince != 0
        && at - quietSince >= idleTarget
        && (lastAmbientAt == 0 || at - lastAmbientAt >= idleTarget)) {
      return WAKE_IDLE;
    }
    return WAKE_NONE;
  }

  /** {gap, repGap, storm} — their own rhythm, and their landing rhythm. */
  private long[] tempo(long at) {
    long[] ts = recent(bursts, at, BURST_MEMORY_MS);
    int recentCount = 0;
    for (long t : ts) if (at - t <= STORM_WINDOW_MS) recentCount++;
    long[] rs = recent(reps, at, REPLACE_MEMORY_MS);
    return new long[] {median(ts), median(rs), recentCount >= STORM_BURSTS ? 1 : 0};
  }

  private static long[] recent(long[] ring, long at, long window) {
    int n = 0;
    for (long t : ring) if (t > 0 && at - t <= window) n++;
    long[] o = new long[n];
    int i = 0;
    for (long t : ring) if (t > 0 && at - t <= window) o[i++] = t;
    Arrays.sort(o);
    return o;
  }

  private static long median(long[] sortedTimes) {
    if (sortedTimes.length < 2) return 0;
    long[] gaps = new long[sortedTimes.length - 1];
    for (int i = 1; i < sortedTimes.length; i++) gaps[i - 1] = sortedTimes[i] - sortedTimes[i - 1];
    Arrays.sort(gaps);
    return gaps[gaps.length >> 1];
  }

  private long holdFor(long gap, long repGap) {
    if (armedReshow) return HOLD_REPLACE_MIN; // they went back to it on purpose
    long lo;
    long hi;
    long own = gap;
    if (armed == ARM_MICRO) {
      lo = HOLD_MICRO_MIN;
      hi = HOLD_MICRO_MAX;
    } else if (armed == ARM_SCROLL) {
      lo = HOLD_SCROLL_MIN;
      hi = HOLD_SCROLL_MAX;
    } else if (armed == ARM_CHURN) {
      lo = HOLD_CHURN_MIN;
      hi = HOLD_CHURN_MAX;
    } else {
      lo = HOLD_REPLACE_MIN;
      hi = HOLD_REPLACE_MAX;
      own = repGap; // a landing is measured against their landing rhythm only
    }
    long v = own > 0 ? (long) (HOLD_MULTIPLIER * own) : lo;
    return v < lo ? lo : (v > hi ? hi : v);
  }

  /** MAD of b against a shifted DOWN by k rows; overlapping rows only. */
  private static double madShift(byte[] a, byte[] b, int k) {
    long sum = 0;
    int n = 0;
    int y0 = k > 0 ? k : 0;
    int y1 = k > 0 ? SIG_SIDE : SIG_SIDE + k;
    for (int y = y0; y < y1; y++) {
      int ra = (y - k) * SIG_SIDE;
      int rb = y * SIG_SIDE;
      for (int x = 0; x < SIG_SIDE; x++) {
        sum += Math.abs((a[ra + x] & 0xFF) - (b[rb + x] & 0xFF));
        n++;
      }
    }
    return n > 0 ? sum / (double) n : 255;
  }

  /** 32x32 -> 16x16 by averaging 2x2 blocks. */
  private static byte[] reduce(byte[] sig) {
    byte[] o = new byte[256];
    for (int y = 0; y < 16; y++) {
      for (int x = 0; x < 16; x++) {
        int i = 2 * y * SIG_SIDE + 2 * x;
        int v =
            ((sig[i] & 0xFF)
                    + (sig[i + 1] & 0xFF)
                    + (sig[i + SIG_SIDE] & 0xFF)
                    + (sig[i + SIG_SIDE + 1] & 0xFF))
                >> 2;
        o[y * 16 + x] = (byte) v;
      }
    }
    return o;
  }

  private static double madSmall(byte[] a, byte[] b) {
    long sum = 0;
    for (int i = 0; i < a.length; i++) sum += Math.abs((a[i] & 0xFF) - (b[i] & 0xFF));
    return sum / (double) a.length;
  }
}
