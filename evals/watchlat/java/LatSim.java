package app.meera.companion;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * WS-WATCHPERF — the frame-latency simulator.
 *
 * <p>WHAT IS REAL HERE, stated first because a simulation that does not say so
 * is a simulation nobody should believe:
 *
 * <ul>
 *   <li><b>SceneReader.java is the real, shipping file</b>, compiled from
 *       {@code android/app/src/main/java/} and run tick for tick. Every hold
 *       threshold, every pre-roll, every wake class and every dedupe is the
 *       geometry that runs on the phone. This is the same trick
 *       {@code evals/multimodal/native-gate.mjs} uses, for the same reason.</li>
 *   <li><b>WatchPacer.java is the real, shipping pacing policy</b> — that is
 *       the entire point of having extracted it. The control arm is
 *       {@code PacerBaseline}, a photograph of what the service did before.</li>
 * </ul>
 *
 * <p>WHAT IS A MODEL, with its parameters named so a future run can disagree
 * with this one:
 *
 * <ul>
 *   <li><b>The clock.</b> Discrete, 1 ms, event-driven.</li>
 *   <li><b>The capture loop's period.</b> BEFORE, the encoder ran inside
 *       {@code tick()} on the main looper and the next tick was posted only
 *       after it returned, so the period is {@code DETECT_MS + captureMs +
 *       encodeMs} on any tick that sent a frame. AFTER, the encoder is a
 *       separate thread, so the period is {@code DETECT_MS + captureMs} always.
 *       This is structural, not estimated: it is what the two code shapes
 *       do.</li>
 *   <li><b>Encode cost</b> ({@code --encode}) and <b>capture cost</b>
 *       ({@code --capture}). NOT measured — no device here. Swept, so the
 *       conclusion can be read as a function of them rather than asserted at
 *       one value. On-device numbers land in the trace as
 *       {@code encode_ms}/{@code capture_ms}, which is exactly why those
 *       fields exist.</li>
 *   <li><b>The uplink.</b> okhttp's queueSize, modelled as: the mic adds 4,300
 *       bytes every 100 ms (one base64'd 3,200-byte PCM16 chunk plus its JSON),
 *       a frame adds its own base64 length, and the socket drains at
 *       {@code --kbps}. {@link LiveWatchEngine#onFrame}'s real gate —
 *       {@code queueSize > FRAME_GATE (8000)} — is then applied to it. 8,000
 *       bytes is under two mic chunks, which is why this matters at all.</li>
 *   <li><b>The screen.</b> Deterministic synthetic 32x32 luma grids per
 *       scenario. Not a screenshot corpus; a scenario script.</li>
 * </ul>
 *
 * <p>WHAT IS NOT MODELLED AND WHY: her voice, the quiet floors, the ambient
 * ceiling and the show floor. Those are {@code nudge()}'s gates and they are
 * about conversation, not about frame latency — including them would let a
 * rate limit masquerade as a pipeline win. The one nudge gate that IS modelled
 * is {@code lastFrameAt}, the grounding invariant, because the whole defect
 * being measured is the two accountings of it disagreeing.
 *
 * <p>Output is one JSON object per line, for run.mjs to table up.
 */
public final class LatSim {

  static final int SIG = SceneReader.SIG_SIDE;
  static final int LEN = SceneReader.SIG_LEN;

  /* ── the modelled uplink ────────────────────────────────────────────── */

  static final long FRAME_GATE = 8_000; // LiveWatchEngine.FRAME_GATE, verbatim
  static final int MIC_BYTES = 4_300; // one base64'd 100ms PCM16 chunk + JSON
  static final int MIC_EVERY_MS = 100;

  static final class Uplink {
    final double bytesPerMs;
    long queue = 0;
    long lastAt = 0;
    long nextMic = 0;
    /** A stall window: the radio wakes up / hands over and nothing drains. */
    final long stallEveryMs, stallForMs;

    Uplink(double kbps, long stallEveryMs, long stallForMs) {
      this.bytesPerMs = kbps * 1000.0 / 8.0 / 1000.0;
      this.stallEveryMs = stallEveryMs;
      this.stallForMs = stallForMs;
    }

    private boolean stalled(long t) {
      return stallEveryMs > 0 && (t % stallEveryMs) < stallForMs;
    }

    void advance(long to) {
      for (long t = lastAt; t < to; t++) {
        if (nextMic <= t) {
          queue += MIC_BYTES;
          nextMic = t + MIC_EVERY_MS;
        }
        if (!stalled(t)) queue = Math.max(0, queue - Math.round(bytesPerMs));
      }
      lastAt = to;
    }

    /** The real gate, on the modelled queue. */
    boolean offerFrame(long at, int bytes) {
      advance(at);
      if (queue > FRAME_GATE) return false;
      queue += bytes;
      return true;
    }
  }

  /* ── the modelled screen ────────────────────────────────────────────── */

  /** A deterministic "page": a field of luma the detector will call a
   *  replacement when it swaps for another one. */
  static byte[] page(int id) {
    byte[] g = new byte[LEN];
    Random r = new Random(1000L + id * 7919L);
    for (int i = 0; i < LEN; i++) g[i] = (byte) (30 + r.nextInt(200));
    return g;
  }

  static byte[] jitter(byte[] base, int amount, long seed) {
    byte[] g = base.clone();
    Random r = new Random(seed);
    for (int i = 0; i < LEN; i++) {
      int v = (g[i] & 0xFF) + r.nextInt(amount * 2 + 1) - amount;
      g[i] = (byte) Math.max(0, Math.min(255, v));
    }
    return g;
  }

  static byte[] shift(byte[] base, int rows) {
    byte[] g = new byte[LEN];
    for (int y = 0; y < SIG; y++) {
      int sy = Math.floorMod(y + rows, SIG);
      System.arraycopy(base, sy * SIG, g, y * SIG, SIG);
    }
    return g;
  }

  /** One scenario is a list of (untilMs, grid-supplier) phases. `null` means
   *  the compositor produced NO buffer at all — a screen so still nothing
   *  redraws, which is the case the ImageReader-null path exists for. */
  interface Phase {
    byte[] at(long t);
  }

  static final class Step {
    final long until;
    final Phase p;

    Step(long until, Phase p) {
      this.until = until;
      this.p = p;
    }
  }

  /** The stop this whole feature is about: when the screen came to rest on the
   *  thing the person meant to show. Every latency below is measured from it. */
  static final class Scenario {
    String name;
    final List<Step> steps = new ArrayList<>();
    long stopAt;
    long endAt;
  }

  static Scenario scrollThenLand() {
    // Browsing: a scroll for 2s, then a page replacement, then they hold it.
    Scenario s = new Scenario();
    s.name = "scroll-then-land";
    byte[] a = page(1), b = page(2);
    s.steps.add(new Step(2000, t -> shift(a, (int) (t / 150))));
    s.steps.add(new Step(2400, t -> jitter(b, 22, t / 120)));
    s.steps.add(new Step(9000, t -> jitter(b, 0, 0)));
    s.stopAt = 2400;
    s.endAt = 9000;
    return s;
  }

  static Scenario idleThenShow() {
    // The case the idle keep-alive owns: a still screen for 8s (no buffers
    // produced at all), then they switch to the thing they want her to see.
    Scenario s = new Scenario();
    s.name = "idle-then-show";
    byte[] a = page(3), b = page(4);
    s.steps.add(new Step(1200, t -> jitter(a, 0, 0)));
    s.steps.add(new Step(8000, t -> null)); // nothing redraws: no buffer
    s.steps.add(new Step(8500, t -> jitter(b, 25, t / 120)));
    s.steps.add(new Step(15000, t -> jitter(b, 0, 0)));
    s.stopAt = 8500;
    s.endAt = 15000;
    return s;
  }

  static Scenario quickSwitch() {
    // "dekh yeh": they flick to a new app and hold it almost immediately.
    Scenario s = new Scenario();
    s.name = "quick-switch";
    byte[] a = page(5), b = page(6);
    s.steps.add(new Step(1500, t -> jitter(a, 0, 0)));
    s.steps.add(new Step(1800, t -> jitter(b, 30, t / 120)));
    s.steps.add(new Step(8000, t -> jitter(b, 0, 0)));
    s.stopAt = 1800;
    s.endAt = 8000;
    return s;
  }

  static Scenario videoThenPause() {
    // A reel playing, then paused. The screen keeps REDRAWING (a paused frame
    // under a UI overlay) so the ImageReader-null path never fires and the
    // detector's own hold test is the only thing that can see the stop.
    Scenario s = new Scenario();
    s.name = "video-then-pause";
    byte[] a = page(7);
    s.steps.add(new Step(3000, t -> jitter(a, 40, t / 120)));
    s.steps.add(new Step(10000, t -> jitter(a, 1, 0)));
    s.stopAt = 3000;
    s.endAt = 10000;
    return s;
  }

  static List<Scenario> scenarios() {
    List<Scenario> l = new ArrayList<>();
    l.add(scrollThenLand());
    l.add(idleThenShow());
    l.add(quickSwitch());
    l.add(videoThenPause());
    return l;
  }

  static byte[] gridAt(Scenario sc, long t) {
    for (Step st : sc.steps) if (t < st.until) return st.p.at(t);
    return null;
  }

  /* ── one run ────────────────────────────────────────────────────────── */

  static final class Result {
    long firstHeldFrameMs = -1; // stop -> a HELD frame actually delivered
    long wakeMs = -1; // stop -> the wake actually went out
    int delivered = 0;
    int refused = 0;
    int encodes = 0; // encodes STARTED — wasted ones included
    long bytes = 0;
    int wakesLost = 0; // the pacer said fresh and the engine refused: no wake
    /** THE HONESTY METRIC, and the one that is not about speed. A SHOW wake
     *  that went out while the service believed a still frame had been
     *  delivered and one had NOT. She is being told to look at a screen she
     *  was never actually shown — the exact instruction the whole
     *  frame-freshness apparatus exists to make impossible, walked straight
     *  past by an accounting error. Zero is the only acceptable value. */
    int ungrounded = 0;
  }

  /** @param after true = the shipping WatchPacer, false = PacerBaseline. */
  /** @param arm 0 = PacerBaseline (before), 1 = the shipping WatchPacer,
   *      2 = the shipping WatchPacer PLUS the REJECTED uplink pre-check —
   *      skip the encode entirely when the queue is already over FRAME_GATE,
   *      instead of encoding and letting the socket refuse. It is arm 2 and
   *      not the default because it is measurably slower: see WatchPacer's
   *      note. Kept so the number stays a record rather than a memory, and so
   *      that anyone who proposes it again finds it already answered. */
  static Result run(
      Scenario sc, int arm, long encodeMs, long captureMs, Uplink up, int frameBytes, long phase) {
    boolean after = arm != 0;
    SceneReader scene = new SceneReader();
    WatchPacer pacer = after ? new WatchPacer() : null;
    PacerBaseline base = after ? null : new PacerBaseline();
    Result r = new Result();

    // the engine's own honest record: set only by a frame the socket TOOK
    long engineLastFrameAt = 0;
    boolean startedWake = false;
    boolean busy = false;
    long encodeDoneAt = -1;
    boolean encHeld = false;
    // the service's own first postDelayed, plus a phase offset: which 120ms
    // tick a stop lands between is luck, and at n=1 that luck reads as signal
    long t = 400 + phase;
    long lastRealStillDeliveredAt = 0;

    while (t <= sc.endAt) {
      // an encode that finished before this tick reports its delivery first
      if (encodeDoneAt >= 0 && encodeDoneAt <= t) {
        boolean ok = up.offerFrame(encodeDoneAt, frameBytes);
        r.encodes++;
        if (ok) {
          r.delivered++;
          r.bytes += frameBytes;
          engineLastFrameAt = encodeDoneAt;
          if (encHeld) lastRealStillDeliveredAt = encodeDoneAt;
          if (after) pacer.onDelivered(encodeDoneAt, encHeld);
          if (encHeld && r.firstHeldFrameMs < 0 && encodeDoneAt >= sc.stopAt)
            r.firstHeldFrameMs = encodeDoneAt - sc.stopAt;
        } else {
          r.refused++;
          if (after) pacer.onRefused();
          // BASELINE: nothing here. onSend() already ran at hand-off.
        }
        encodeDoneAt = -1;
        busy = false;
      }

      byte[] g = gridAt(sc, t);
      SceneReader.Out s = g != null ? scene.read(g, t) : scene.still(t);

      int what;
      if (after) {
        // the link-ready pre-check: the same gate the engine applies at the
        // socket, asked before a downscale+JPEG+base64 is spent on a frame it
        // is about to refuse. Advisory — offerFrame() below still decides.
        up.advance(t);
        what = pacer.decide(g != null, s.quiet, s.preroll, busy, false, WatchPacer.LIVE_FRAME_MS, t);
        if (arm == 2 && what == WatchPacer.ENCODE && up.queue > FRAME_GATE) what = WatchPacer.NOTHING;
      } else {
        what = base.decide(g != null, s.quiet, s.preroll, PacerBaseline.LIVE_FRAME_MS, t);
      }

      long tickCost = captureMs;
      if (what == WatchPacer.KEEPALIVE) {
        // a socket write of a string already in hand — no encode either way
        boolean ok = up.offerFrame(t, frameBytes);
        r.encodes++;
        if (ok) {
          r.delivered++;
          r.bytes += frameBytes;
          engineLastFrameAt = t;
          if (after) pacer.onDelivered(t, true);
          else base.onSend(t, true);
        } else {
          r.refused++;
          if (after) pacer.onRefused();
          else base.onSend(t, true); // THE BUG
        }
      } else if (what == WatchPacer.ENCODE) {
        if (after) {
          pacer.onEncodeStart(t);
          busy = true;
          encHeld = s.quiet;
          encodeDoneAt = t + captureMs + encodeMs; // concurrent
        } else {
          // BEFORE: encode ran INSIDE tick(), on the looper, synchronously —
          // and the send was accounted for whatever the socket said.
          long doneAt = t + captureMs + encodeMs;
          boolean ok = up.offerFrame(doneAt, frameBytes);
          r.encodes++;
          if (ok) {
            r.delivered++;
            r.bytes += frameBytes;
            engineLastFrameAt = doneAt;
            if (s.quiet) lastRealStillDeliveredAt = doneAt;
            if (r.firstHeldFrameMs < 0 && s.quiet && doneAt >= sc.stopAt)
              r.firstHeldFrameMs = doneAt - sc.stopAt;
          } else {
            r.refused++;
          }
          base.onSend(doneAt, s.quiet); // spent regardless — THE BUG
          tickCost = captureMs + encodeMs; // ...and the detect loop paid for it
        }
      }

      // ── the wake path, exactly as dispatch() runs it ──
      int wake = s.wake;
      boolean anyDelivered = after ? pacer.anyDelivered() : base.anyDelivered();
      if (!startedWake) {
        wake = anyDelivered ? SceneReader.WAKE_START : SceneReader.WAKE_NONE;
      }
      if (wake != SceneReader.WAKE_NONE) {
        boolean show = SceneReader.isShow(wake);
        boolean freshBySvc = after ? pacer.fresh(show, t) : base.fresh(show, t);
        if (freshBySvc) {
          // the engine's own grounding invariant, off the HONEST record
          boolean freshByEngine =
              engineLastFrameAt != 0 && t - engineLastFrameAt <= WatchPacer.FRAME_FRESH_MS;
          if (freshByEngine) {
            scene.noteWake(wake, t);
            if (wake == SceneReader.WAKE_START) startedWake = true;
            else if (show && r.wakeMs < 0 && t >= sc.stopAt) r.wakeMs = t - sc.stopAt;
            // the service said a still frame backed this; did one exist?
            if (show
                && (lastRealStillDeliveredAt == 0
                    || t - lastRealStillDeliveredAt > WatchPacer.FRAME_FRESH_MS)) r.ungrounded++;
          } else {
            // the service said yes and the engine said no: the wake is lost,
            // uncharged, and re-fires into the same refusal next tick
            r.wakesLost++;
          }
        }
      }

      t += WatchPacer.DETECT_MS + tickCost;
    }
    return r;
  }

  static String j(String k, Object v) {
    return "\"" + k + "\":" + (v instanceof String ? "\"" + v + "\"" : v);
  }

  /** Median of the values that HAPPENED. A -1 means the thing never happened
   *  at all inside the scenario, which is categorically different from a slow
   *  one and is reported separately as `never` rather than averaged in — a
   *  wake that never fires must never improve a median. */
  static long med(List<Long> xs) {
    List<Long> v = new ArrayList<>();
    for (long x : xs) if (x >= 0) v.add(x);
    if (v.isEmpty()) return -1;
    java.util.Collections.sort(v);
    return v.get(v.size() / 2);
  }

  static long worst(List<Long> xs) {
    long m = -1;
    for (long x : xs) if (x > m) m = x;
    return m;
  }

  public static void main(String[] args) {
    long[] encodes = {30, 80};
    // good: an easy uplink. jittery: a phone radio that stops draining for
    // 400ms out of every 3s — one handover, one doze exit, one lift-to-wake.
    Object[][] links = {
      {"good", 3000.0, 0L, 0L},
      {"jittery", 1200.0, 3000L, 400L},
    };
    int frameBytes = 45_000; // 768px q68 base64, the measured working size
    // WHICH 120ms tick a stop lands between is luck. At n=1 that luck is
    // several hundred milliseconds wide and reads exactly like a result, so
    // every cell is run at 8 phase offsets across one whole detect period and
    // reported as a median with its worst case.
    long[] phases = {0, 15, 30, 45, 60, 75, 90, 105};
    for (String name : names()) {
      for (long e : encodes) {
        for (Object[] lk : links) {
          for (int arm = 0; arm < 3; arm++) {
            List<Long> held = new ArrayList<>();
            List<Long> wake = new ArrayList<>();
            int delivered = 0, refused = 0, lost = 0, ungrounded = 0, neverHeld = 0, neverWake = 0;
            for (long ph : phases) {
              Scenario sc = freshLike(name);
              // a fresh uplink per run — the arms must not inherit each
              // other's queue, and neither may two phases of the same arm
              Uplink up = new Uplink((Double) lk[1], (Long) lk[2], (Long) lk[3]);
              Result r = run(sc, arm, e, 6, up, frameBytes, ph);
              held.add(r.firstHeldFrameMs);
              wake.add(r.wakeMs);
              if (r.firstHeldFrameMs < 0) neverHeld++;
              if (r.wakeMs < 0) neverWake++;
              delivered += r.delivered;
              refused += r.refused;
              lost += r.wakesLost;
              ungrounded += r.ungrounded;
            }
            System.out.println(
                "{"
                    + j("scenario", name) + ","
                    + j("arm", arm == 0 ? "before" : arm == 1 ? "after" : "after-linkgate") + ","
                    + j("encodeMs", e) + ","
                    + j("link", (String) lk[0]) + ","
                    + j("heldMed", med(held)) + ","
                    + j("heldWorst", worst(held)) + ","
                    + j("heldNever", neverHeld) + ","
                    + j("wakeMed", med(wake)) + ","
                    + j("wakeWorst", worst(wake)) + ","
                    + j("wakeNever", neverWake) + ","
                    + j("delivered", delivered) + ","
                    + j("refused", refused) + ","
                    + j("wakesLost", lost) + ","
                    + j("ungrounded", ungrounded) + ","
                    + j("runs", phases.length)
                    + "}");
          }
        }
      }
    }
  }

  static List<String> names() {
    List<String> l = new ArrayList<>();
    for (Scenario s : scenarios()) l.add(s.name);
    return l;
  }

  static Scenario freshLike(String name) {
    for (Scenario s : scenarios()) if (s.name.equals(name)) return s;
    throw new IllegalArgumentException(name);
  }
}
