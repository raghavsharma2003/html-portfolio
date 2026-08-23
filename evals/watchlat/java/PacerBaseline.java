package app.meera.companion;

/**
 * THE CONTROL ARM, AND NOTHING ELSE.
 *
 * <p>A verbatim transcription of the frame-pacing policy that lived inside
 * {@code WatchCaptureService.tick()/send()} before WS-WATCHPERF, kept here so
 * the "after" numbers have a "before" to be compared against. It is
 * transcription rather than reference on purpose: the shipping policy is
 * {@code WatchPacer} and there is only one of those.
 *
 * <p><b>THIS IS NOT A GATE AND IT IS NOT SHIPPING CODE.</b> Nothing under
 * {@code android/} or {@code src/} may import it, ever. It exists for exactly
 * one reason — a measured before/after — and the moment it is treated as
 * anything else it becomes the frozen-snapshot failure this repo already has a
 * name for (`gates-that-live-nowhere`: two harnesses that imported a months-old
 * persona bundle and reported a pass on today's tree). If the shipping policy
 * changes again, this file does not follow it. It is a photograph.
 *
 * <p>The whole difference is in {@link #onSend}: it spends the cadence slot,
 * the still-frame debt and the moved-since-sent flag at the moment the base64
 * was HANDED to the engine, with no idea whether the socket took it.
 */
final class PacerBaseline {
  static final long DETECT_MS = 120;
  static final long CHANGE_SEND_MS = 250;
  static final long IDLE_FRAME_MS = 2500;
  static final long LIVE_FRAME_MS = 600;
  static final long FRAME_FRESH_MS = 3000;

  static final int NOTHING = 0;
  static final int ENCODE = 1;
  static final int KEEPALIVE = 2;

  private boolean movedSinceSent = true;
  private boolean wantStill = false;
  private long lastSentAt = 0;
  private long lastStillFrameAt = 0;
  private boolean haveEncoded = false;
  private int seq = 0;

  int decide(boolean haveImage, boolean quiet, boolean preroll, long baseline, long now) {
    if (!haveImage) {
      // keepAlive(): `if (lastB64 == null || now - lastSentAt < IDLE_FRAME_MS) return;`
      if (haveEncoded && now - lastSentAt >= IDLE_FRAME_MS) return KEEPALIVE;
      return NOTHING;
    }
    if (!quiet) movedSinceSent = true;
    long cadence = movedSinceSent ? baseline : Math.max(baseline, IDLE_FRAME_MS);
    if (preroll) wantStill = true;
    boolean want = wantStill || now - lastSentAt >= cadence;
    if (want && now - lastSentAt >= CHANGE_SEND_MS) return ENCODE;
    return NOTHING;
  }

  int nextSeq() {
    return ++seq;
  }

  /** THE BUG, preserved: called whether or not the socket accepted anything. */
  void onSend(long now, boolean held) {
    lastSentAt = now;
    haveEncoded = true;
    movedSinceSent = false;
    if (held) {
      lastStillFrameAt = now;
      wantStill = false;
    }
  }

  boolean fresh(boolean show, long now) {
    long backing = show ? lastStillFrameAt : lastSentAt;
    return backing != 0 && now - backing <= FRAME_FRESH_MS;
  }

  boolean anyDelivered() {
    return lastSentAt != 0;
  }

  int seq() {
    return seq;
  }
}
