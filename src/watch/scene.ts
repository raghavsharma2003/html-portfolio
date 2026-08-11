// ── What the screen is DOING ────────────────────────────────────────────────
//
// Screen sharing is not one activity. The same 120ms sampler has to serve a
// reel feed that turns over every 3 seconds, a code file that changes every
// 30, and an article that does not change at all while it is being read. One
// cadence cannot serve all three, so this module derives WHAT HAPPENED from
// the 32x32 luma grid the pump already computes, and the caller turns that
// into a wake-up.
//
// THE HARD RULE, and the reason this file is pure geometry:
//   Code may only WAKE her and report WHAT HAPPENED. It must never encode
//   taste. There are no per-app rules here, no content scoring, no keyword
//   triggers and no phrase banks. Nothing in this file knows what is on the
//   screen — it knows only how many cells moved, where, whether the picture
//   translated, and how long it has been standing still. Her judgment decides
//   what, and whether, to say. Silence answers every wake.
//
// The distinction that matters most is DELIBERATE SHOW vs AMBIENT PRESENCE.
// A human "dekh yeh" is not the movement, it is the ARREST of the movement:
// they navigated somewhere and stopped, and the stop is the point. The old
// detector fired on the leading edge of a change — both the wrong moment
// (they are still moving past things) and the wrong picture (a frame captured
// mid-transition is half the old screen and half the new one, which is
// exactly the input that makes her guess at what she is seeing). So the
// new-thing wake moves onto the HOLD, and the hold threshold is measured
// against the user's OWN current rhythm, because "stopped" means nothing in
// absolute terms — it means something relative to the tempo they were just
// moving at.
//
// Every threshold below is justified where it is declared, and every one of
// them is exercised by scratchpad/scenesim.mjs against synthesised versions
// of the real situations (feed, reading, typing, video, game, app switch,
// notification banner, protected-window blackout, going back to something).
// The Android copy in WatchCaptureService.java is kept line-for-line
// parallel, constants included, so the two surfaces cannot drift.

export const SIG_SIDE = 32;
export const SIG_LEN = SIG_SIDE * SIG_SIDE;

/** One wake-up opportunity. SHOW classes mean "they just did something that
 *  asks for you"; AMBIENT classes mean "you have been sitting here a while". */
export type WakeClass = "start" | "settle" | "reshow" | "point" | "switch" | "along" | "idle";

export const isShowClass = (w: WakeClass) =>
  w === "settle" || w === "reshow" || w === "point" || w === "switch";

export interface SceneOut {
  /** Legacy band the frame path already speaks: 0 nothing · 1 activity · 2 a
   *  new thing. Kept so the send path and telemetry are unchanged. */
  motion: 0 | 1 | 2;
  /** Fraction of the grid that moved this tick. */
  coverage: number;
  /** Near-uniform, near-black: an Android FLAG_SECURE window (banking apps and
   *  password managers set it, and the capture stream renders them black), a
   *  locked screen, a display asleep. Nothing to look at, whatever the MAD
   *  says — and the single most privacy-charged instant on the platform. */
  blank: boolean;
  /** The screen is holding still (a caret blinking in place, a clock digit and
   *  a spinner do not break a hold; a caret that is ADVANCING does). */
  quiet: boolean;
  /** Get a still picture of this screen into the socket NOW, ahead of the
   *  cadence, so the hold that is about to confirm is backed by the frame they
   *  are actually looking at instead of a mid-transition blur — and so the
   *  poke itself is a bare socket write with nothing on the critical path.
   *
   *  Deliberately NOT the first still tick. Every micro-pause between two
   *  keystrokes and every glance between two flicks is a still tick, and
   *  paying for a frame at each of them costs MORE than the 600ms baseline it
   *  was meant to sit inside. It fires halfway through the hold this screen
   *  would actually need — early enough that the frame lands before any poke
   *  could, late enough that a pause which was never a stop costs nothing. */
  preroll: boolean;
  /** A wake-up is available. The caller still owns every gate that keeps it
   *  honest: a real frame that entered the socket, never while she is
   *  speaking, never across them, and the per-minute ceiling. */
  wake: WakeClass | null;
}

// ── unchanged, because they were measured on real capture ───────────────────
const NEW_MAD = 12; // levels: most of the grid is different — a page/app/post
const CELL_DELTA = 8; // levels one cell must move to count as "moved"
// A MEAN cannot see typing: one cell covers a slab of screen, so a caret or a
// new word moves ONE cell a little and averages to zero over 1024 — which made
// reading, writing and coding look like a dead screen. Activity is COUNTED,
// not averaged. Screen capture has no sensor noise, so a still image cannot
// self-trigger.
const ACTIVE_CELLS = 1;

// ── a hold tolerates a little life, but only life that STAYS PUT ────────────
// A blinking caret, a clock digit or a spinner moves a couple of cells in the
// same place forever; if that broke the hold, nobody sitting still on a page
// would ever register as sitting still. But a caret that ADVANCES is someone
// typing, and treating typing as stillness is how she ends up talking over
// someone composing a sentence. So the tolerance is bounded in space as well
// as in size: the changed cells have to keep landing in the same spot.
const HOLD_TOLERANCE_CELLS = 4;
const HOLD_TOLERANCE_MAD = 1.5; // levels, mean — a caret cannot reach this
const HOLD_DRIFT = 1; // cells the changed-cell centroid may wander

// Scrolling is a TRANSLATION, not a replacement, and it is the most common
// thing anyone does on a phone. Under the old detector every flick read as "a
// new thing" and woke her: that is the definition of the annoying friend.
// Compare the grid against the previous grid shifted vertically by k rows; if
// some k explains the picture materially better than k=0, they scrolled.
const SHIFT_MAX = 6; // rows of 32, i.e. up to ~19% of the screen per tick
const SHIFT_GAIN = 0.55; // a shift must beat straight-on by this much

// A playing video changes the interior violently and the app chrome barely; a
// swipe, an app switch or a navigation changes both. The outer 4-cell ring is
// the status bar, the nav bar and the app's own frame.
const RING_NEW_MAD = 8; // levels, mean over the border cells only
// Edge-to-edge content has no informative ring, so a near-total turnover is
// accepted as a replacement on coverage alone.
const FULL_TURNOVER = 0.6;

// ── overlays are not new things ─────────────────────────────────────────────
// A notification banner, a toast, the keyboard sliding up, a volume HUD: a
// large change confined to a band anchored at the top or the bottom of the
// screen, with everything else untouched. Waking on those is bad in general
// and worst for the banner, whose content is someone else's private message.
// This is geometry, not content: an edge-anchored band that leaves most of the
// screen alone is structurally an overlay whatever it happens to say.
const OVERLAY_MAX_ROWS = Math.floor(SIG_SIDE * 0.5);

// A cursor is smaller than one grid cell: 1-2 of 1024 cells move by ~60
// levels, a mean of ~0.12 — an order of magnitude below anything the old
// detector could see, so the strongest deictic gesture available on a desktop
// was indistinguishable from a screensaver. Travel in BOTH axes is what
// separates a pointer wandering over a thing from a caret advancing along a
// line, which only ever moves in x.
const POINT_MIN_CELLS = 1;
const POINT_MAX_CELLS = 6;
const POINT_TICKS = 5; // 600ms of it, so a one-off repaint is not a point
const POINT_TRAVEL = 2; // cells, per axis
const POINT_FLOOR_MS = 8000; // a habitual mouse-fidgeter must not become a beat

// Micro-activity: typing, a caret, a field filling, a small edit. Almost
// nothing moves, unlike a scroll or a video. A friend does not talk over
// someone composing a thought, so a hold armed by micro-activity waits much
// longer before it counts as "they stopped and what they made is sitting
// there" — which is also exactly when a typo becomes visible and worth
// mentioning.
const MICRO_COVERAGE = 0.03; // <= ~30 cells

// ── how long a stop has to last before it means "look" ──────────────────────
// Measured against their own tempo, then bounded by what KIND of motion
// preceded the stop. The bounds are the whole situation model:
//   replace — they navigated somewhere and it landed. React fast; this is the
//             deliberate show. Bounded low so a slow session cannot make her
//             sluggish on the one moment that matters.
//   churn   — a video, a game, an animation stopped. Also fast: a pause, a
//             death screen, a loading screen is the moment a friend speaks.
//   micro   — they were typing. Wait for the thought to land.
//   scroll  — they were reading. The gaps between scrolls ARE reading, so the
//             bar is high: only a stop that is far longer than their own
//             page-turn rhythm is a stop at all.
//   overlay — a banner or a keyboard. Not a show at all; never arms one.
// Which rhythm a stop is measured against depends on what kind of stop it is.
// For a landing, the only meaningful tempo is how fast they have been
// REPLACING screens — a reader who scrolls every ten seconds and then opens a
// new app has no landing rhythm at all, and must not inherit the reading one.
// A rhythm from a minute ago is not their current rhythm either, so it goes
// stale.
const HOLD_MULTIPLIER = 1.8;
const REPLACE_MEMORY_MS = 15_000;
const HOLD_REPLACE_MIN = 260;
const HOLD_REPLACE_MAX = 4000;
const HOLD_CHURN_MIN = 260;
const HOLD_CHURN_MAX = 2000;
const HOLD_MICRO_MIN = 2500;
const HOLD_MICRO_MAX = 8000;
const HOLD_SCROLL_MIN = 1200;
const HOLD_SCROLL_MAX = 25_000;
const BURST_RING = 8; // motion bursts remembered, for the median gap
const BURST_MEMORY_MS = 60_000;
const STORM_BURSTS = 3; // this many in STORM_WINDOW_MS = moving past things
const STORM_WINDOW_MS = 8000;
// Even the show lane needs a floor, for the socket and the API — never to
// ration what she says. Whether she speaks on any wake is entirely her call.
const SHOW_FLOOR_MS = 4000;

// A replacement that keeps moving (they opened a video, a game, a live feed)
// can never produce a hold, so it gets the one wake a hold would have given
// it — after it proves it is not a passing overlay.
const SWITCH_CONFIRM_MS = 900;

// ── one reaction per thing ──────────────────────────────────────────────────
// A wake she ANSWERED is different from a wake that merely fired, and the
// difference is only visible over a moving screen. Measured over real captured
// sessions (scratchpad/mf): 26% of everything she said across a session was
// her saying a thing she had already said, and half of those landed on a
// picture that was, at 16x16, the SAME PICTURE she had already spoken about —
// they scrolled away and came back, an app switch returned to where it started,
// a hold broke and re-formed on the same screen. Each of those is a fresh hold
// and a legitimate wake by every rule above, and every one of them is a friend
// saying the same sentence to you twice.
//
// This is geometry, not taste: it knows only that this picture is the picture
// a wake was already spent on. It carries no opinion about what is in it, and
// it cannot be right or wrong about content because it never looks at any.
//
// The window is IDLE_WAKE_MS, deliberately: after a full idle beat has passed,
// coming back to something IS a new moment, and the same screen is fair again.
const SPOKEN_RING = 8;
const SPOKEN_MAD = 5; // levels on the 16x16 reduction, as RESHOW_MAD

// Going back to something you already passed is the clearest showing there is
// — putting the thing back in front of her, with a thumb. One 16x16
// signature per second for 20 seconds is 5KB.
const RESHOW_RING = 20;
const RESHOW_EVERY_MS = 1000;
const RESHOW_MIN_AGE_MS = 2000; // younger is a rubber-band, not a return
const RESHOW_MAX_AGE_MS = 20_000;
const RESHOW_MAD = 4; // levels, on the 16x16 reduction

// Ambient is a BUDGET, not a metronome. Twelve seconds of one static form and
// twelve seconds of six different apps used to earn one wake each. What should
// govern how often she chimes in is how much the world has actually turned
// over since she last spoke — and a regular pulse is the single most
// machine-legible thing a companion can do.
const NOVELTY_BUDGET = 3.0; // ~three screens' worth of change
const NOVELTY_CHURN_PER_TICK = 0.006; // continuous churn (video, a game) → ~60s
const NOVELTY_MICRO_PER_TICK = 0.002; // typing → ~3 minutes
const ALONG_MIN_MS = 12_000;
const IDLE_WAKE_MS = 45_000;
const IDLE_JITTER = 0.15; // the one remaining clock must not read as a clock

type ArmKind = "" | "replace" | "churn" | "micro" | "scroll" | "overlay";

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Mean absolute difference of b against a shifted DOWN by k rows (k may be
 *  negative). Only overlapping rows are compared, so a shift is never
 *  rewarded for the rows it does not have to explain. */
function madShift(a: Uint8Array, b: Uint8Array, k: number): number {
  let sum = 0;
  let n = 0;
  const y0 = k > 0 ? k : 0;
  const y1 = k > 0 ? SIG_SIDE : SIG_SIDE + k;
  for (let y = y0; y < y1; y++) {
    const ra = (y - k) * SIG_SIDE;
    const rb = y * SIG_SIDE;
    for (let x = 0; x < SIG_SIDE; x++) {
      sum += Math.abs(a[ra + x] - b[rb + x]);
      n++;
    }
  }
  return n ? sum / n : 255;
}

/** 32x32 → 16x16 by averaging 2x2 blocks. The reshow ring stores these. */
function reduce(sig: Uint8Array): Uint8Array {
  const out = new Uint8Array(256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const o = 2 * y * SIG_SIDE + 2 * x;
      out[y * 16 + x] = (sig[o] + sig[o + 1] + sig[o + SIG_SIDE] + sig[o + SIG_SIDE + 1]) >> 2;
    }
  }
  return out;
}

function madSmall(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

interface Held {
  sig: Uint8Array;
  at: number;
  hold: number;
}

export class SceneReader {
  private prev: Uint8Array | null = null;
  private prevBig = false;

  // the current hold
  private quietSince = 0; // when the still run began (0 = the screen is moving)
  private holdCx = 0; // where the little bit of remaining life is happening
  private holdCy = 0;
  private armed: ArmKind = ""; // what kind of motion preceded this hold
  private armedReshow = false; // ...and it landed on something they had passed
  private settled = false; // this hold has already produced its one wake
  private checkedRing = false; // reshow lookup done for this hold
  private prerolled = false; // still frame already asked for, for this hold
  private prerollNow = false;

  // their own tempo — all motion bursts, and separately the ones that
  // replaced the screen outright
  private bursts: number[] = new Array(BURST_RING).fill(0);
  private burstIdx = 0;
  private reps: number[] = new Array(BURST_RING).fill(0);
  private repIdx = 0;
  private repBurst = false; // this burst has already been counted as a replace

  // a replacement that has not yet proved itself
  private pendingAt = 0;
  private pendingFired = true;

  // pointing
  private pointTicks = 0;
  private pointFromX = 0;
  private pointFromY = 0;
  private lastPointWakeAt = 0;

  // things they held on, in case they come back to one
  private ring: Held[] = [];
  private ringAt = 0;
  private holdId = 0;

  // pictures a wake was already spent on — see SPOKEN_RING
  private spoken: Held[] = [];

  // pacing
  private novelty = 0;
  private lastAmbientAt = 0;
  private lastShowAt = 0;
  private idleTarget = IDLE_WAKE_MS;
  private startedAt = 0;

  /** Wipe every carried belief. A new share starts genuinely new. */
  reset() {
    this.prev = null;
    this.prevBig = false;
    this.quietSince = 0;
    this.armed = "";
    this.armedReshow = false;
    this.settled = false;
    this.checkedRing = false;
    this.prerolled = false;
    this.prerollNow = false;
    this.bursts.fill(0);
    this.burstIdx = 0;
    this.reps.fill(0);
    this.repIdx = 0;
    this.repBurst = false;
    this.pendingAt = 0;
    this.pendingFired = true;
    this.pointTicks = 0;
    this.lastPointWakeAt = 0;
    this.ring = [];
    this.ringAt = 0;
    this.holdId = 0;
    this.spoken = [];
    this.novelty = 0;
    this.lastAmbientAt = 0;
    this.lastShowAt = 0;
    this.startedAt = 0;
    this.idleTarget = IDLE_WAKE_MS;
  }

  /** Tell the reader a wake actually went out. The caller does this AFTER its
   *  own gates, because a wake the socket, the ceiling or her own voice
   *  refused never happened and must not spend the budget. */
  noteWake(cls: WakeClass, at: number) {
    // Remember the PICTURE this wake was spent on, so nothing can be woken on
    // twice. Only wakes that actually went out reach this method, which is
    // exactly the set that should count.
    if (this.prev) {
      this.spoken.push({ sig: reduce(this.prev), at, hold: this.holdId });
      if (this.spoken.length > SPOKEN_RING) this.spoken.shift();
    }
    if (isShowClass(cls)) {
      this.settled = true;
      this.lastShowAt = at;
      this.armedReshow = false;
    } else {
      this.lastAmbientAt = at;
      this.novelty = 0;
      // re-roll the beat so the one remaining clock never ticks like a clock
      this.idleTarget = Math.round(IDLE_WAKE_MS * (1 + (Math.random() * 2 - 1) * IDLE_JITTER));
    }
    if (cls === "point") this.lastPointWakeAt = at;
  }

  /** The screen did not redraw at all. Android's ImageReader hands back null
   *  on a static screen — and a static screen is exactly a hold, so the old
   *  early-return meant the stiller the screen got, the less the code could
   *  see it. Advance the still run off the last grid instead of going dark. */
  still(at: number): SceneOut {
    if (!this.prev) {
      return { motion: 0, coverage: 0, blank: false, quiet: false, preroll: false, wake: null };
    }
    return this.step(this.prev, at, true);
  }

  /** One detect tick. `sig` is a 32x32 luma grid. */
  read(sig: Uint8Array, at: number): SceneOut {
    return this.step(sig, at, false);
  }

  private step(sig: Uint8Array, at: number, repeat: boolean): SceneOut {
    if (!this.startedAt) this.startedAt = at;
    const prev = this.prev;

    // near-uniform and dark — see `blank` above
    let lo = 255;
    let hi = 0;
    let lum = 0;
    for (let i = 0; i < sig.length; i++) {
      const v = sig[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      lum += v;
    }
    const blank = hi - lo <= 12 && lum / sig.length <= 40;

    if (!prev) {
      this.prev = sig;
      this.quietSince = at;
      // the first thing she is shown is new by definition, but it is the
      // caller's `start` wake that carries it, not a scene change
      return { motion: 2, coverage: 1, blank, quiet: true, preroll: true, wake: null };
    }

    let moved = 0;
    let mad = 0;
    let ringMad = 0;
    let cx = 0;
    let cy = 0;
    let rowLo = SIG_SIDE;
    let rowHi = -1;
    if (!repeat) {
      let dsum = 0;
      let ringSum = 0;
      let ringN = 0;
      for (let y = 0; y < SIG_SIDE; y++) {
        const edgeRow = y < 4 || y >= SIG_SIDE - 4;
        for (let x = 0; x < SIG_SIDE; x++) {
          const i = y * SIG_SIDE + x;
          const d = Math.abs(sig[i] - prev[i]);
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
      mad = dsum / sig.length;
      ringMad = ringN ? ringSum / ringN : 0;
      if (moved) {
        cx /= moved;
        cy /= moved;
      }
    }

    const coverage = moved / SIG_LEN;
    const big = mad >= NEW_MAD;

    // did the picture TRANSLATE? (a scroll is not a new thing)
    let scrolled = false;
    if (big) {
      let best = mad;
      for (let k = -SHIFT_MAX; k <= SHIFT_MAX; k++) {
        if (!k) continue;
        const m = madShift(prev, sig, k);
        if (m < best) best = m;
      }
      scrolled = best < mad * SHIFT_GAIN;
    }
    // an edge-anchored band that leaves most of the screen alone
    const overlay =
      moved > 0 &&
      rowHi - rowLo + 1 <= OVERLAY_MAX_ROWS &&
      (rowLo === 0 || rowHi === SIG_SIDE - 1);
    // a REPLACEMENT: the frame itself changed, not just what plays inside it
    const replaced =
      big &&
      !scrolled &&
      !overlay &&
      !blank &&
      (ringMad >= RING_NEW_MAD || coverage >= FULL_TURNOVER);

    const motion: 0 | 1 | 2 =
      replaced && !this.prevBig ? 2 : moved >= ACTIVE_CELLS || big ? 1 : 0;
    this.prevBig = big;

    // ── is the screen holding? ──────────────────────────────────────────
    let quiet = moved === 0;
    if (!quiet && moved <= HOLD_TOLERANCE_CELLS && mad < HOLD_TOLERANCE_MAD) {
      // a couple of cells flickering: still a hold ONLY if they keep landing
      // in the same place (a caret blinking, a clock, a spinner). A caret
      // that is advancing is someone typing, and that is not a hold.
      quiet =
        this.quietSince > 0 &&
        Math.abs(cx - this.holdCx) <= HOLD_DRIFT &&
        Math.abs(cy - this.holdCy) <= HOLD_DRIFT;
    }
    const micro = !quiet && coverage > 0 && coverage <= MICRO_COVERAGE;

    if (quiet) {
      if (!this.quietSince) {
        this.quietSince = at;
        this.checkedRing = false;
        this.prerolled = false;
        if (moved) {
          this.holdCx = cx;
          this.holdCy = cy;
        }
      }
    } else {
      if (this.quietSince) {
        // a motion BURST began; the gap between bursts is their own tempo
        this.bursts[this.burstIdx] = at;
        this.burstIdx = (this.burstIdx + 1) % BURST_RING;
        this.armed = ""; // a fresh burst re-decides what kind of motion this is
        this.armedReshow = false;
        this.settled = false;
        this.repBurst = false;
        this.prerolled = false;
        this.holdId++;
        this.pointTicks = 0;
        if (!micro && !overlay) this.novelty += Math.min(1, Math.max(coverage, 0.1));
      }
      this.quietSince = 0;
      this.holdCx = cx;
      this.holdCy = cy;
      // the kind of motion sticks to the strongest thing seen in this burst:
      // one real page replacement inside a scroll still makes it a landing
      const kind: ArmKind = replaced
        ? "replace"
        : scrolled
          ? "scroll"
          : overlay
            ? "overlay"
            : micro
              ? "micro"
              : "churn";
      this.armed = strongerArm(this.armed, kind);
      if (replaced && !this.repBurst) {
        this.repBurst = true;
        this.reps[this.repIdx] = at;
        this.repIdx = (this.repIdx + 1) % BURST_RING;
      }
      // continuous churn has no burst boundaries at all, so without this a
      // video or a game would never earn an ambient wake in its own right
      this.novelty += micro ? NOVELTY_MICRO_PER_TICK : NOVELTY_CHURN_PER_TICK;
    }

    if (replaced) {
      this.pendingAt = at;
      this.pendingFired = false;
    }

    // ── did they come back to something they had passed? ────────────────
    // Coming back to something means they NAVIGATED back to it: a hold armed
    // by typing or by a video pausing is the same screen, not a return. And
    // the match has to be to a screen at least two holds ago, or a caret
    // blinking on an otherwise unchanged page would read as a homecoming.
    if (quiet && !this.checkedRing) {
      this.checkedRing = true;
      if (this.armed === "replace" || this.armed === "scroll") {
        const small = reduce(sig);
        for (const h of this.ring) {
          const age = at - h.at;
          if (
            h.hold <= this.holdId - 2 &&
            age >= RESHOW_MIN_AGE_MS &&
            age <= RESHOW_MAX_AGE_MS &&
            madSmall(h.sig, small) <= RESHOW_MAD
          ) {
            this.armedReshow = true;
            break;
          }
        }
      }
    }
    // only screens they actually HELD go into the ring, so transient chrome
    // and half-scrolled frames can never be "something they came back to"
    if (quiet && at - this.ringAt >= RESHOW_EVERY_MS) {
      this.ringAt = at;
      this.ring.push({ sig: reduce(sig), at, hold: this.holdId });
      if (this.ring.length > RESHOW_RING) this.ring.shift();
    }

    this.prev = sig;
    this.prerollNow = false;
    const wake = this.pick(at, quiet, moved, mad, cx, cy, blank);
    return { motion, coverage, blank, quiet, preroll: this.prerollNow, wake };
  }

  /** Median gap between their own motion bursts — the rhythm a stop has to
   *  beat before it means anything — plus whether they are mid-flick-storm. */
  private tempo(at: number): { gap: number; repGap: number; storm: boolean } {
    const ts = this.bursts.filter((t) => t > 0 && at - t <= BURST_MEMORY_MS).sort((a, b) => a - b);
    let recent = 0;
    for (const t of ts) if (at - t <= STORM_WINDOW_MS) recent++;
    const storm = recent >= STORM_BURSTS;
    const rs = this.reps.filter((t) => t > 0 && at - t <= REPLACE_MEMORY_MS).sort((a, b) => a - b);
    return { gap: median(ts), repGap: median(rs), storm };
  }

  private holdFor(gap: number, repGap: number): number {
    let lo: number;
    let hi: number;
    let own = gap;
    if (this.armedReshow) {
      // the highest-confidence show there is: they went back to it on purpose,
      // so it gets the calm floor whatever rhythm they were moving at
      return HOLD_REPLACE_MIN;
    }
    if (this.armed === "micro") {
      lo = HOLD_MICRO_MIN;
      hi = HOLD_MICRO_MAX;
    } else if (this.armed === "scroll") {
      lo = HOLD_SCROLL_MIN;
      hi = HOLD_SCROLL_MAX;
    } else if (this.armed === "churn") {
      lo = HOLD_CHURN_MIN;
      hi = HOLD_CHURN_MAX;
    } else {
      lo = HOLD_REPLACE_MIN;
      hi = HOLD_REPLACE_MAX;
      own = repGap; // a landing is measured against their landing rhythm only
    }
    return clamp(own ? HOLD_MULTIPLIER * own : lo, lo, hi);
  }

  /** Has a wake already been spent on THIS picture, recently? The reduction is
   *  computed at most once per tick and only when a wake is otherwise about to
   *  fire, so the common case — no wake — costs nothing. */
  private answered(at: number, memo: { sig?: Uint8Array }): boolean {
    if (!this.prev || !this.spoken.length) return false;
    if (!memo.sig) memo.sig = reduce(this.prev);
    for (const h of this.spoken) {
      if (at - h.at > IDLE_WAKE_MS) continue;
      if (madSmall(h.sig, memo.sig) <= SPOKEN_MAD) return true;
    }
    return false;
  }

  private pick(
    at: number,
    quiet: boolean,
    moved: number,
    mad: number,
    cx: number,
    cy: number,
    blank: boolean,
  ): WakeClass | null {
    const memo: { sig?: Uint8Array } = {};
    const { gap, repGap, storm } = this.tempo(at);
    // 0 means "never yet", not "at the epoch" — the first show of a session
    // must not be blocked by a floor measured from a timestamp that never was
    const showOk = !this.lastShowAt || at - this.lastShowAt >= SHOW_FLOOR_MS;

    // ── SHOW: they just did something that asks for you ──
    // an overlay (banner, keyboard, toast) never arms one, and neither does a
    // blank screen: nothing was chosen, so there is nothing to be shown.
    if (quiet && this.armed && this.armed !== "overlay" && !this.settled && !blank) {
      const hold = this.holdFor(gap, repGap);
      const held = at - this.quietSince;
      if (!this.prerolled && held >= hold / 2) {
        this.prerolled = true;
        this.prerollNow = true;
      }
      if (showOk && held >= hold && !this.answered(at, memo))
        return this.armedReshow ? "reshow" : "settle";
    }

    // pointing: a cursor circling a thing, or a thumb tapping the same region,
    // on a screen that is otherwise dead still. Travel in BOTH axes is what
    // keeps a typing caret (which only advances in x) out of this branch.
    if (
      !blank &&
      showOk &&
      moved >= POINT_MIN_CELLS &&
      moved <= POINT_MAX_CELLS &&
      mad < HOLD_TOLERANCE_MAD &&
      (!this.lastPointWakeAt || at - this.lastPointWakeAt >= POINT_FLOOR_MS)
    ) {
      if (!this.pointTicks) {
        this.pointFromX = cx;
        this.pointFromY = cy;
      }
      this.pointTicks++;
      if (
        this.pointTicks >= POINT_TICKS &&
        Math.abs(cx - this.pointFromX) >= POINT_TRAVEL &&
        Math.abs(cy - this.pointFromY) >= POINT_TRAVEL &&
        !this.answered(at, memo)
      ) {
        this.pointTicks = 0;
        return "point";
      }
    } else if (moved > POINT_MAX_CELLS) {
      this.pointTicks = 0;
    }

    // a replacement that persisted and is STILL moving: they went into
    // something alive (a video, a game, a live feed). No hold will ever
    // confirm here, so this is the only wake that can — and the delay is what
    // proves it was not a banner passing through.
    if (
      !this.pendingFired &&
      !quiet &&
      !blank &&
      showOk &&
      at - this.pendingAt >= SWITCH_CONFIRM_MS &&
      !this.answered(at, memo)
    ) {
      this.pendingFired = true;
      return "switch";
    }

    // ── AMBIENT: you have been sitting here a while ──
    // never mid-flick-storm: they are moving PAST things and each one was
    // explicitly not chosen. The only thing that may wake her during a storm
    // is them stopping.
    if (storm) return null;

    if (
      this.novelty >= NOVELTY_BUDGET &&
      (!this.lastAmbientAt || at - this.lastAmbientAt >= ALONG_MIN_MS) &&
      at - this.startedAt >= ALONG_MIN_MS &&
      !this.answered(at, memo)
    ) {
      return "along";
    }
    if (
      quiet &&
      this.quietSince &&
      at - this.quietSince >= this.idleTarget &&
      (!this.lastAmbientAt || at - this.lastAmbientAt >= this.idleTarget) &&
      !this.answered(at, memo)
    ) {
      return "idle";
    }
    return null;
  }
}

function median(ts: number[]): number {
  if (ts.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}

const ARM_RANK: Record<string, number> = { "": 0, overlay: 1, micro: 2, churn: 3, scroll: 4, replace: 5 };
function strongerArm(a: ArmKind, b: ArmKind): ArmKind {
  return ARM_RANK[b] > ARM_RANK[a] ? b : a;
}

/** Luma grid from RGBA bytes (canvas getImageData order). */
export function gridFromRGBA(data: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array(SIG_LEN);
  for (let i = 0; i < out.length; i++)
    out[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
  return out;
}
