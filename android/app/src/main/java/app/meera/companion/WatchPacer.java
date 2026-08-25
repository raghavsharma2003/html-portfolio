package app.meera.companion;

/**
 * WS-WATCHPERF — the frame-pacing POLICY of watch-together, extracted whole
 * out of {@link WatchCaptureService} so it can be RUN off-device.
 *
 * <p>This class is pure: it imports nothing from Android, allocates nothing per
 * tick, and touches no clock of its own — every method is handed the time. That
 * is deliberate and it is the same discipline {@link SceneReader} follows, for
 * the same reason: the geometry could be proved against the web twin only
 * because it could be compiled and run, and the PACING had exactly the opposite
 * property. It lived inside a foreground service that needs a MediaProjection,
 * a VirtualDisplay and an ImageReader to exist at all, so the one thing nobody
 * could ever measure was the thing the owner actually complained about — how
 * long it takes her to see what is on the screen.
 * {@code evals/watchlat/} compiles and drives this file directly.
 *
 * <p>THE ONE RULE THIS FILE EXISTS TO ENFORCE: <b>a frame that did not reach
 * the socket has not been sent.</b> The old service spent the cadence slot, the
 * still-frame debt and the moved-since-sent flag at the moment it handed the
 * base64 to the engine — before the engine had said whether the socket took it.
 * {@link LiveWatchEngine#onFrame} refuses a frame whenever the uplink queue is
 * behind on her AUDIO ({@code FRAME_GATE}, 8 KB — under two mic chunks), which
 * on a phone happens on any radio hiccup. The consequences of crediting that
 * refusal as a send, in order:
 *
 * <ol>
 *   <li>{@code movedSinceSent} went false, so on a HELD screen — a screen that
 *       by definition is not moving, i.e. exactly the deliberate show this
 *       whole feature is for — the cadence immediately became the 2500 ms idle
 *       keep-alive beat. The next attempt to send anything at all was 2.5 s
 *       away. That is the "up to 2.5 s of dead wait" this workstream was sent
 *       to find, and it is not the beat interacting with the keep-alive: it is
 *       one refused frame turning the fast beat off.</li>
 *   <li>{@code lastStillFrameAt} was stamped for a picture she never got, so
 *       the service's own freshness gate passed a wake that
 *       {@link LiveWatchEngine#nudge} then refused on its own (honest)
 *       {@code lastFrameAt} check — the wake evaporated, and with
 *       {@code scene.noteWake} never called it re-fired every 120 ms into the
 *       same refusal until the 2.5 s beat came round.</li>
 * </ol>
 *
 * <p>The web lane never had this bug — {@code startWebWatch}'s {@code push()}
 * has always been {@code if (sent) { lastSentAt = at; … }} with the comment
 * "a frame the socket refused must be retried on the next tick, not treated as
 * delivered and waited out for another full period". This is that rule, made
 * the native lane's rule too, in a file that can be tested.
 */
final class WatchPacer {

  /* ── the cadence constants, unchanged in value ─────────────────────── */

  /** Screen sampled this often — detection, decoupled from transmission. */
  static final long DETECT_MS = 120;
  /** Floor between two encodes, so a burst cannot melt the phone. */
  static final long CHANGE_SEND_MS = 250;
  /** The slow beat for a screen the detector says is genuinely identical.
   *  LOAD-BEARING: it must stay under {@link #FRAME_FRESH_MS} or a held screen
   *  ages out of the window every wake-up depends on. */
  static final long IDLE_FRAME_MS = 2500;
  /** Full cadence with the realtime lane up (video into an open socket). */
  static final long LIVE_FRAME_MS = 600;
  /** Full cadence on the cascade fallback (a vision request per frame). */
  static final long CASCADE_FRAME_MS = 1400;
  /** Mirrors LiveWatchEngine.FRAME_FRESH_MS: no picture this new, no wake. */
  static final long FRAME_FRESH_MS = 3000;

  /* ── what one tick decided ─────────────────────────────────────────── */

  /** Nothing to do this tick. */
  static final int NOTHING = 0;
  /** Encode the image we are holding and try to put it on the wire. */
  static final int ENCODE = 1;
  /** Re-send the picture already encoded — no plane read, no Bitmap, no JPEG.
   *  Only ever reached when the compositor produced no new buffer at all. */
  static final int KEEPALIVE = 2;

  /** Why an encode did not happen — carried into the trace, never guessed. */
  static final int WHY_NONE = 0;
  static final int WHY_CADENCE = 1; // the beat has not come round
  static final int WHY_FLOOR = 2; // inside CHANGE_SEND_MS of the last encode
  static final int WHY_BUSY = 3; // the previous encode is still in flight
  static final int WHY_PRIVATE = 4; // the look-away

  /* ── state, confined to the capture thread ─────────────────────────── */

  private boolean movedSinceSent = true; // the first frame always goes
  private boolean wasIdle = false; // the previous tick was on the slow beat
  private boolean idleExit = false; // ...and this one is not: promote NOW
  private boolean wantStill = false; // the screen stopped and we owe a still
  private long lastGrabAt = 0; // last ENCODE started (bounds re-encode cost)
  private long lastSentAt = 0; // last frame that ACTUALLY entered the socket
  private long lastStillFrameAt = 0; // ...captured while the screen was HELD
  private int why = WHY_NONE;
  private int seq = 0; // frame lifecycle id, for the trace correlation

  /** Reset for a new capture session. A new share's first frame is new. */
  void reset() {
    movedSinceSent = true;
    wasIdle = false;
    idleExit = false;
    wantStill = false;
    lastGrabAt = 0;
    lastSentAt = 0;
    lastStillFrameAt = 0;
    why = WHY_NONE;
    seq = 0;
  }

  /**
   * One detect tick, after the geometry has spoken.
   *
   * @param haveImage the compositor produced a new buffer (a screen that never
   *     redraws produces nothing at all, and that is not nothing — see the
   *     still-path note in WatchCaptureService.tick)
   * @param quiet the detector's own hold test — NOT byte equality
   * @param preroll the screen just stopped and owes a legible still picture
   * @param busy an encode from an earlier tick has not reported back yet
   * @param privateMode the look-away: nothing is encoded, nothing goes out
   * @param baseline LIVE_FRAME_MS or CASCADE_FRAME_MS, per the lane that is up
   */
  int decide(
      boolean haveImage,
      boolean quiet,
      boolean preroll,
      boolean busy,
      boolean privateMode,
      long baseline,
      long now) {
    why = WHY_NONE;
    if (privateMode) {
      why = WHY_PRIVATE;
      return NOTHING;
    }
    if (!haveImage) {
      // The keep-alive re-sends the LAST ENCODED picture so a held screen
      // never ages past the freshness window. Cheap by construction: a socket
      // write of a string we already have.
      if (lastSentAt != 0 && now - lastSentAt >= IDLE_FRAME_MS) return KEEPALIVE;
      why = WHY_CADENCE;
      return NOTHING;
    }

    // "identical" is the detector's hold test: a blinking caret, a clock digit
    // or a paused video under an overlay is a screen standing still.
    if (!quiet) movedSinceSent = true;

    // ── THE IDLE EXIT ──────────────────────────────────────────────────
    // Promotion out of the slow beat was already immediate in one sense —
    // movedSinceSent flips on the very tick the screen moves, so the CADENCE
    // is 600 ms again straight away. What was not immediate is the PHASE: the
    // beat is measured from lastSentAt, and lastSentAt on a still screen is
    // whenever the 2500 ms keep-alive last fired. A change 100 ms after a
    // keep-alive therefore waited the full 500 ms remainder before any pixel
    // of it moved, on the one transition where the picture is most out of
    // date — she was looking at the OLD screen for half a second after it
    // stopped existing.
    //
    // So the edge itself re-phases the beat: the first moving tick after a
    // still stretch sends now, subject only to the 250 ms encode floor.
    //
    // COST, stated rather than hidden (`callcost-2026-08-23`: frames are
    // 47–65% of a share minute and the 1 fps billing ambiguity stands): this
    // adds AT MOST one frame per idle→motion edge, and nothing at all in
    // steady state — during active browsing movedSinceSent never goes false,
    // so the edge never occurs. The steady-state cadence is untouched at 600
    // ms; this only stops a change from waiting out a beat it did not start.
    // evals/watchlat/ reports the frame-count delta per scenario.
    if (movedSinceSent && wasIdle) idleExit = true;
    wasIdle = !movedSinceSent;

    // The pre-roll is STICKY: if the 250 ms floor swallows the tick the screen
    // stopped on, the debt carries to the next tick that can pay it, so a hold
    // is never left backed by a mid-transition picture — which is half the old
    // screen and half the new one, and is exactly what makes her guess.
    if (preroll) wantStill = true;

    long cadence = movedSinceSent ? baseline : Math.max(baseline, IDLE_FRAME_MS);
    boolean want = wantStill || idleExit || lastSentAt == 0 || now - lastSentAt >= cadence;
    if (!want) {
      why = WHY_CADENCE;
      return NOTHING;
    }
    if (lastGrabAt != 0 && now - lastGrabAt < CHANGE_SEND_MS) {
      why = WHY_FLOOR;
      return NOTHING;
    }
    // NO UPLINK PRE-CHECK HERE, and that is a measured decision rather than an
    // omission. The engine can answer "the queue is already behind on her
    // audio" BEFORE a downscale + JPEG + base64 is spent on a frame the socket
    // is going to refuse. Measured as `after-linkgate` in evals/watchlat:
    // refusals (i.e. wasted encodes) fall roughly 40x — 43-63 per 8 runs to
    // 0-1 — and the stop→held-frame medians move BOTH WAYS by less than the
    // harness's own tick-grid noise (one cell 445 vs 394 in its favour, one
    // 979 vs 772 against). So it buys battery and buys no speed.
    //
    // It is not shipped because its failure mode is the wrong one. Not
    // encoding during a stall means there is nothing ready the instant the
    // stall clears; encoding into a refusal costs a background thread some
    // work it throws away. This lane's whole rule is that going momentarily
    // blind is recoverable and being slow to look is what the owner
    // complained about, and speed is the thing this product does not trade.
    //
    // REVERSAL CONDITION, stated so it is not re-litigated from memory: if the
    // on-device trace shows encode CPU is a battery or thermal problem — the
    // `encode_ms` and `refused_by:"uplink"` fields exist to answer exactly
    // that — the arm is already built and already measured. Turn it on then,
    // with that number in hand.
    if (busy) {
      // Backpressure, not a drop: exactly one frame is ever in flight through
      // the encoder, so a slow device cannot queue three seconds of stale
      // pictures behind itself. The want survives — wantStill and idleExit are
      // both still set — so the next tick 120 ms later pays the same debt.
      why = WHY_BUSY;
      return NOTHING;
    }
    return ENCODE;
  }

  /** Why the last {@link #decide} returned NOTHING. */
  int why() {
    return why;
  }

  /** An encode is starting. Spends the re-encode floor (which bounds CPU) and
   *  nothing else — the cadence slot belongs to delivery, not to effort. */
  int onEncodeStart(long now) {
    lastGrabAt = now;
    return ++seq;
  }

  /**
   * The socket TOOK it. This is the only place a cadence slot is spent, the
   * only place the still-frame debt is cleared, and the only place the fast
   * beat is allowed to lapse into the keep-alive beat.
   *
   * @param held the frame caught the screen actually standing still — a
   *     re-sent mid-transition picture must never let a show wake claim she is
   *     looking at what they stopped on
   */
  void onDelivered(long now, boolean held) {
    lastSentAt = now;
    movedSinceSent = false;
    idleExit = false;
    if (held) {
      lastStillFrameAt = now;
      wantStill = false;
    }
  }

  /**
   * The socket REFUSED it (uplink behind on her audio, pathological encode, no
   * live session yet). Nothing is spent: the next tick retries 120 ms later
   * rather than 600 — or, before this class existed, 2500.
   */
  void onRefused() {
    /* deliberately empty, and deliberately a named method rather than an
     * absent else-branch: "we did not credit this" is the whole fix, and a
     * silent fallthrough is how it was lost the first time. */
  }

  /** The dispatch-side grounding gate: a SHOW must ride behind a picture of
   *  the HELD screen; the ambient beat is happy with any delivered frame. */
  boolean fresh(boolean show, long now) {
    long backing = show ? lastStillFrameAt : lastSentAt;
    return backing != 0 && now - backing <= FRAME_FRESH_MS;
  }

  /** Has anything at all reached her yet this session? */
  boolean anyDelivered() {
    return lastSentAt != 0;
  }

  /** Age of the newest delivered frame, or -1 if there is none. For the trace
   *  only — no decision reads this. */
  long frameAge(long now) {
    return lastSentAt == 0 ? -1 : now - lastSentAt;
  }

  long stillAge(long now) {
    return lastStillFrameAt == 0 ? -1 : now - lastStillFrameAt;
  }

  int seq() {
    return seq;
  }
}
