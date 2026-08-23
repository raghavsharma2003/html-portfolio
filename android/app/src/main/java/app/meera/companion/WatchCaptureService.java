package app.meera.companion;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.util.DisplayMetrics;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * Watch-together capture: a mediaProjection foreground service that samples
 * the screen every few seconds, downscales the frame (longest side ~768px —
 * exactly one vision tile), JPEG-compresses it and hands the base64 to
 * WatchPlugin, which emits it to the web layer. Consent is per-session by
 * Android design; the service dies with the session.
 */
public class WatchCaptureService extends Service {
  public static final String EXTRA_RESULT_CODE = "resultCode";
  public static final String EXTRA_RESULT_DATA = "resultData";
  public static final String EXTRA_CONFIG = "config";
  /** Stop the whole watch session — sent by the bubble menu + the
   *  notification's Stop action, the two controls reachable from OUTSIDE
   *  the app. */
  public static final String ACTION_STOP = "app.meera.companion.watch.STOP";
  private static final String CHANNEL_ID = "meera_watch";
  private static final int NOTIF_ID = 4207;
  // reels scroll in seconds — she has to see what they see NOW, not 3s ago.
  // The live session streams video into an already-open socket, so a faster
  // rate costs only bandwidth; the cascade pays a vision request per frame,
  // hence the slower fallback tick.
  //
  // ONE quality, always the best one. There is deliberately NO adaptive
  // tiering here any more: degrading the picture to protect a link made her
  // worse at the only thing this feature is for. At the bottom tier she saw
  // the screen once every 2.5s, which is not watching — it is a slideshow she
  // then guesses about. Frames go out at full rate and quality and the link
  // carries it or drops individual frames; she is never fed a worse picture
  // on purpose.
  //
  // WS-WATCHPERF: the CADENCE half of these constants now lives in
  // WatchPacer, which is pure Java and can therefore be compiled and RUN by
  // evals/watchlat/. The quality half stays here, next to the encoder that
  // uses it.
  private static final int LIVE_JPEG_Q = 68;
  private static final int LIVE_MAX_SIDE = 768;

  // ── waking her up, fast ────────────────────────────────────────────────
  // The Live API never generates from video on its own, so nothing she sees
  // can make her speak unless something asks her to look — which makes the
  // delay between "the screen changed" and "she is looking at it" the whole
  // latency budget. DETECTION IS THEREFORE DECOUPLED FROM TRANSMISSION: this
  // service samples the screen every DETECT_MS by reading a 32x32 luma grid
  // straight out of the capture plane (1024 sparse reads, no Bitmap, no
  // allocation), while full JPEG frames go up at the bandwidth-appropriate
  // cadence.
  //
  // WHAT the screen is doing is worked out by SceneReader, a line-for-line
  // port of src/watch/scene.ts: pure geometry, carrying NO taste. It says how
  // many cells moved, where, whether the picture translated instead of being
  // replaced, and how long it has been standing still — never what any of it
  // means. Her own brain decides what, and whether, to say, and silence
  // answers every wake.
  private static final long DETECT_MS = WatchPacer.DETECT_MS; // screen sampled this often
  private static final int SIG_SIDE = SceneReader.SIG_SIDE;
  private static final int SIG_LEN = SceneReader.SIG_LEN;
  // A screen that has not moved since the last frame we sent carries no new
  // information: the identical picture costs a full vision tile every 600ms
  // and shows her nothing she is not already looking at. tick() already
  // skipped a screen that never redrew, but not one that redraws WITHOUT
  // changing — a video paused under a UI overlay, a blinking caret on an
  // otherwise still page, an app that repaints on a timer. This is NOT a
  // quality change: same picture, same size, same cadence the instant
  // anything moves. Only a provably identical screen gets the slow beat.
  //
  // The keep-alive is LOAD-BEARING and must stay under LiveWatchEngine's
  // FRAME_FRESH_MS (3000): no picture that new, no wake-up at all, so a
  // slower beat would blind her on exactly the still screens this saves on.
  //
  // Both of those numbers, the 600/1400 baselines and the 250ms encode floor
  // are WatchPacer's now — see that file's header for why, and for the
  // delivery-accounting bug it was extracted to fix.
  private final SceneReader scene = new SceneReader();
  private final WatchPacer pacer = new WatchPacer();
  private String lastB64; // the last picture we encoded, for the keep-alive
  private boolean lastB64Held; // ...and whether it caught the screen standing still
  private boolean startedWake = false;
  /** Refusal records are rate-limited to this — see deliver(). */
  private static final long REFUSAL_DIAG_MS = 400;
  private long lastRefusalDiagAt = 0;
  /** When the last wake ACTUALLY went out — the start of her reaction leg.
   *  Correlated with onSpeaking(true) to produce the one number the owner's
   *  complaint is about: nudge sent -> her voice starts. */
  private long lastNudgeAt = 0;
  /** THE LOOK-AWAY. User-initiated only: while this is set nothing is encoded
   *  and nothing enters the socket, so the existing "no wake without a
   *  delivered frame" rule makes her politely blind for free. Nothing may
   *  ever set it from a heuristic about what is on the screen. */
  private static volatile boolean privateMode = false;

  static void setPrivate(boolean on) {
    privateMode = on;
  }

  // EXACTLY ONE lane may speak. Every lane switch stops the other lane's
  // audio synchronously before the new one starts, and every engine callback
  // carries the session generation it was born in — an older engine's
  // deferred callback must never touch the lane that replaced it.
  private static final int LANE_NONE = 0;
  private static final int LANE_LIVE = 1;
  private static final int LANE_CASCADE = 2;

  private LiveWatchEngine live; // realtime lane (Gemini Live) — tried first
  private WatchEngine engine; // cascade lane — built lazily if live gives up
  private int lane = LANE_NONE; // main-thread confined
  private int sessionGen = 0; // bumped by every teardown
  /** A capture session is running. Static so WatchPlugin.state() can answer a
   *  reloaded WebView that has lost track of the engine it started. */
  private static volatile boolean sessionActive = false;

  static boolean isSessionActive() {
    return sessionActive;
  }
  private final Runnable unmuteTail = () -> {
    LiveWatchEngine l = live;
    if (l != null) l.setMuted(false);
  };
  private String config;
  private MediaProjection projection;
  private VirtualDisplay display;
  private ImageReader reader;
  private Handler handler;
  private boolean running = false;

  // ── WS-WATCHPERF: the encoder does not run on the UI thread ───────────
  // The expensive half of a frame — a full-resolution pixel copy, a filtered
  // downscale, a JPEG compress and a base64 — used to run inside tick(), on
  // the MAIN LOOPER, with the next detect tick posted only AFTER it returned.
  // Two costs, both paid on every single frame at 1.67 fps:
  //
  //   1. the detect loop's own period became 120ms + encode, so the 120ms
  //      luma tick that the whole wake latency is measured in was not 120ms
  //      on the ticks that mattered most — the ones where something changed;
  //   2. it was the app's UI thread, shared with the hovering bubble and the
  //      WebView, during a session whose entire premise is that the user is
  //      in some OTHER app.
  //
  // Encoding now happens on its own thread and reports delivery back. Exactly
  // ONE encode is ever in flight (WatchPacer.WHY_BUSY), so a slow device
  // queues nothing and the reusable capture Bitmap below cannot be overwritten
  // while the encoder is reading it.
  private android.os.HandlerThread encThread;
  private Handler enc;
  private Bitmap capBitmap; // reused: a 2.6MB ARGB allocation per frame was
  private int capBitmapW, capBitmapH; // pure GC pressure at 1.67fps
  private boolean encodeBusy = false; // capture-thread confined
  private final ByteArrayOutputStream jpegOut = new ByteArrayOutputStream(96 * 1024);

  // ── WS-WATCHPERF part 2: the phone's own audio, behind a setting ──────
  /** OFF unless the user turns it on, per share. See MediaAudioCapture. */
  private static volatile boolean mediaAudioOn = false;
  private MediaAudioCapture mediaAudio;
  /** The running service, so the chip can turn device audio on and off DURING
   *  a share without tearing the projection down and re-running consent. */
  private static volatile WatchCaptureService instance;

  static void setMediaAudio(boolean on) {
    mediaAudioOn = on;
    WatchCaptureService svc = instance;
    if (svc == null) return;
    Handler h = svc.handler;
    if (h != null) h.post(() -> { if (on) svc.startMediaAudio(); else svc.stopMediaAudio(); });
  }

  static boolean isMediaAudioOn() {
    return mediaAudioOn;
  }

  /**
   * Start AudioPlaybackCapture on THIS share's MediaProjection.
   *
   * <p>Everything about the lifetime here is Android's own, deliberately: the
   * capture is constructed from the same {@link MediaProjection} the screen
   * share holds, so it cannot start without a live share, cannot outlive one,
   * and dies at the same instant the user revokes it from the system UI. There
   * is no second consent surface to get wrong and no way to be recording
   * device audio with the screen share stopped.
   */
  private void startMediaAudio() {
    if (!running || !mediaAudioOn || mediaAudio != null) return;
    if (projection == null || Build.VERSION.SDK_INT < 29) return;
    LiveWatchEngine l = live;
    if (l == null) return; // cascade lane has no PCM uplink to mix into
    MediaAudioCapture m = MediaAudioCapture.start(projection);
    if (m == null) {
      watchDiag("media_audio", "on", false, "why", "unavailable");
      return;
    }
    mediaAudio = m;
    l.setMediaSource(m);
    watchDiag("media_audio", "on", true, "why", "");
  }

  private void stopMediaAudio() {
    MediaAudioCapture m = mediaAudio;
    mediaAudio = null;
    LiveWatchEngine l = live;
    // the engine's reference goes first: the mic thread must never read a
    // source that is being released underneath it
    if (l != null) l.setMediaSource(null);
    if (m != null) m.stop();
    if (m != null) watchDiag("media_audio", "on", false, "why", "stopped");
  }

  private final Runnable sampler = new Runnable() {
    @Override
    public void run() {
      if (!running) return;
      try {
        tick();
      } catch (Exception ignored) {
        // a dropped frame is fine; the next tick retries
      }
      if (running && handler != null) handler.postDelayed(this, DETECT_MS);
    }
  };

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent == null) {
      stopSelf();
      return START_NOT_STICKY;
    }
    if (ACTION_STOP.equals(intent.getAction())) {
      stopEverything(); // bubble menu / notification action ended the session
      return START_NOT_STICKY;
    }
    startAsForeground();
    // a second start() must not leak the old session (double engines would
    // talk over each other and double the frame traffic) — tear down first
    if (running || projection != null || engine != null || live != null) teardownSession();
    int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
    Intent data = intent.getParcelableExtra(EXTRA_RESULT_DATA);
    MediaProjectionManager mpm =
        (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
    if (data == null || resultCode == 0 || mpm == null) {
      stopSelf();
      return START_NOT_STICKY;
    }
    projection = mpm.getMediaProjection(resultCode, data);
    if (projection == null) {
      stopSelf();
      return START_NOT_STICKY;
    }
    // required on API 34+: register a callback before creating the display
    projection.registerCallback(
        new MediaProjection.Callback() {
          @Override
          public void onStop() {
            stopEverything();
          }
        },
        null);

    DisplayMetrics metrics = getResources().getDisplayMetrics();
    int w = metrics.widthPixels;
    int h = metrics.heightPixels;
    // capture at half resolution — plenty for a 768px vision frame
    int cw = Math.max(320, w / 2);
    int ch = Math.max(320, h / 2);
    reader = ImageReader.newInstance(cw, ch, PixelFormat.RGBA_8888, 2);
    display =
        projection.createVirtualDisplay(
            "meera-watch",
            cw,
            ch,
            metrics.densityDpi / 2,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.getSurface(),
            null,
            null);
    running = true;
    sessionActive = true;
    instance = this;
    // the native brain loop — lives HERE because Android freezes the WebView
    // (timers and fetch) while another app is foreground. Realtime first:
    // the Gemini Live session co-watches with ~zero latency and real barge-in;
    // the snapshot→think→speak cascade is the fallback rung underneath it.
    config = intent.getStringExtra(EXTRA_CONFIG);
    if (!startLive()) startCascade();
    // WS-WATCHPERF: the phone's own audio, if and only if the user asked for
    // it on this share. Scoped to THIS MediaProjection by Android's own API —
    // when the projection dies the capture dies with it, so there is no path
    // where device audio outlives the screen share it was consented to.
    startMediaAudio();
    BubbleService.startBubble(this); // she hovers over the screen (needs SAW)
    BubbleService.setState(this, BubbleService.STATE_WATCHING);
    handler = new Handler(Looper.getMainLooper());
    android.os.HandlerThread et = new android.os.HandlerThread("meera-watch-enc");
    et.start();
    encThread = et;
    enc = new Handler(et.getLooper());
    handler.postDelayed(sampler, 400);
    return START_NOT_STICKY;
  }

  /** A callback from an engine whose session is gone must change nothing. */
  private boolean stale(int gen) {
    return gen != sessionGen || !running;
  }

  /** Realtime lane. Returns false if this device/build can't run it at all. */
  private boolean startLive() {
    if (!LiveWatchEngine.supported()) return false;
    stopCascade(); // one lane at a time, and its audio dies before this starts
    final int gen = sessionGen;
    LiveWatchEngine e =
        new LiveWatchEngine(
            this,
            new LiveWatchEngine.Callbacks() {
              @Override
              public void onReady() {
                if (stale(gen) || lane != LANE_LIVE) return;
                BubbleService.setState(
                    WatchCaptureService.this, BubbleService.STATE_WATCHING);
              }

              @Override
              public void onTurn(String who, String text) {
                // no lane check: a turn cut off by the handoff is still real
                // conversation the chat log must keep
                if (gen != sessionGen) return;
                try {
                  // exactly the shape WatchEngine.emitTurn uses, so the JS
                  // "watchturn" listener stays untouched
                  WatchPlugin.emitEvent(
                      "watchturn", new org.json.JSONObject().put("who", who).put("text", text));
                } catch (Exception ignored) {
                }
              }

              @Override
              public void onSpeaking(boolean speaking) {
                if (stale(gen) || lane != LANE_LIVE) return;
                // THE NUMBER THE OWNER REPORTED. Everything else in this
                // trace is a leg of it: her voice starting, measured from the
                // wake that asked her to look. Stamped once per wake — a
                // second onSpeaking inside the same reaction (she pauses and
                // resumes) must not report a second, shorter latency.
                if (speaking && lastNudgeAt != 0) {
                  watchDiag(
                      "reaction",
                      "ms", SystemClock.elapsedRealtime() - lastNudgeAt,
                      "seq", pacer.seq());
                  lastNudgeAt = 0;
                }
                // HALF-DUPLEX ON SPEAKER: without this, the phone's mic feeds
                // her own voice straight back to the server VAD — she'd
                // interrupt herself mid-syllable in an endless loop. Mute the
                // uplink while she talks (silence keeps the stream alive),
                // unmute with a short tail so her trailing audio can't leak.
                LiveWatchEngine l = live;
                if (l != null) {
                  if (speaking) {
                    if (handler != null) handler.removeCallbacks(unmuteTail);
                    l.setMuted(true);
                  } else if (handler != null) {
                    handler.postDelayed(unmuteTail, 350);
                  } else {
                    l.setMuted(false);
                  }
                }
                BubbleService.setState(
                    WatchCaptureService.this,
                    speaking ? BubbleService.STATE_SPEAKING : BubbleService.STATE_WATCHING);
              }

              @Override
              public void onDown(boolean fatal) {
                // live gave up (no mic grant, or the socket kept dying) — the
                // engine has already released the mic, so the cascade can grab it
                if (stale(gen) || lane != LANE_LIVE) return;
                stopLive();
                startCascade();
              }
            });
    if (config != null) e.configure(config);
    live = e;
    lane = LANE_LIVE;
    e.start();
    return true;
  }

  /** The original snapshot→think→speak brain: fallback, built only if needed. */
  private void startCascade() {
    if (!running) return;
    stopLive(); // its socket, mic and AudioTrack are gone before this speaks
    if (engine != null) return;
    WatchEngine e = new WatchEngine(this, WatchPlugin::emitEvent);
    if (config != null) e.configure(config);
    engine = e;
    lane = LANE_CASCADE;
    e.start();
    BubbleService.setState(this, BubbleService.STATE_WATCHING);
  }

  /** Synchronous: returns only once the live lane can no longer make sound. */
  private void stopLive() {
    LiveWatchEngine l = live;
    live = null;
    if (lane == LANE_LIVE) lane = LANE_NONE;
    if (l != null) l.stop(); // idempotent: socket, mic, AudioTrack, focus
  }

  private void stopCascade() {
    WatchEngine e = engine;
    engine = null;
    if (lane == LANE_CASCADE) lane = LANE_NONE;
    if (e != null) e.stop();
  }

  private void startAsForeground() {
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
      NotificationChannel ch =
          new NotificationChannel(CHANNEL_ID, "Watching together", NotificationManager.IMPORTANCE_LOW);
      nm.createNotificationChannel(ch);
    }
    Intent open = new Intent(this, MainActivity.class);
    PendingIntent pi =
        PendingIntent.getActivity(
            this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    PendingIntent stopPi =
        PendingIntent.getService(
            this,
            1,
            new Intent(this, WatchCaptureService.class).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    Notification notif =
        new Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Meera is watching with you")
            .setContentText("Screen sharing is on — tap the bubble or here to stop.")
            .setSmallIcon(getApplicationInfo().icon)
            .setContentIntent(pi)
            .addAction(
                new Notification.Action.Builder(
                        null, "Stop sharing", stopPi)
                    .build())
            .setOngoing(true)
            .build();
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      // BOTH types, and microphone especially: without the mic type actively
      // passed to startForeground, Android silently starves SpeechRecognizer
      // the moment the user switches to YouTube — she'd go deaf, the error
      // streak would latch micDead, and the whole talk lane would die
      startForeground(
          NOTIF_ID,
          notif,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
              | ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
    } else {
      startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
    }
  }

  /** One detect tick. Cheap by design: the signature is read straight out of
   *  the ImageReader plane (1024 sparse pixel reads, no allocation), and the
   *  expensive path — full-res copy, downscale, JPEG, base64 — runs only when
   *  there is actually a frame worth sending. */
  private void tick() {
    if (reader == null) return;
    long now = SystemClock.elapsedRealtime();
    long t0 = now;
    Image image = reader.acquireLatestImage();
    // NO NEW IMAGE IS NOT NOTHING. A virtual display only produces a buffer
    // when the screen composites something, so a static screen delivers
    // nothing at all — and a static screen is exactly what a deliberate show
    // looks like. The old early return meant the stiller the screen got, the
    // less code ran: detect never fired, the still run never advanced, and
    // the one moment that matters most in this whole feature executed nothing.
    // It also meant her newest picture aged past FRAME_FRESH_MS and she went
    // blind and unwakeable for as long as they held.
    LiveWatchEngine l0 = live;
    long baseline = l0 != null ? WatchPacer.LIVE_FRAME_MS : WatchPacer.CASCADE_FRAME_MS;
    if (image == null) {
      SceneReader.Out s = scene.still(now);
      // the keep-alive re-sends the LAST ENCODED picture — no plane read, no
      // Bitmap, no JPEG: this is a socket write of a string we already have
      if (pacer.decide(false, s.quiet, s.preroll, encodeBusy, privateMode, baseline, now)
              == WatchPacer.KEEPALIVE
          && lastB64 != null) {
        // it only counts as a picture of the HELD screen if it actually caught
        // the screen standing still — re-sending a mid-transition frame must
        // not let a show wake claim she is looking at what they stopped on
        deliver(lastB64, 0, lastB64Held, now, pacer.seq(), 0, 0, true);
      }
      dispatch(s, now);
      return;
    }
    try {
      byte[] sig = signature(image);
      // an unreadable plane is not a still screen: advance the hold off the
      // last grid rather than pretending the picture changed to nothing
      SceneReader.Out s = sig != null ? scene.read(sig, now) : scene.still(now);
      // Full cadence whenever anything moved; the slow keep-alive beat only on
      // a screen the detector says is genuinely identical. A redraw that
      // changed nothing is not worth a vision tile — and it tells her nothing
      // she is not already looking at. Never a quality change, only a
      // frequency one, and only on a screen that is standing still. The whole
      // decision — including the sticky pre-roll, the idle-exit re-phase and
      // the one-in-flight backpressure — is WatchPacer's, so it can be run
      // against a clock in evals/watchlat/ instead of only on a phone.
      if (pacer.decide(true, s.quiet, s.preroll, encodeBusy, privateMode, baseline, now)
          == WatchPacer.ENCODE) {
        // The full-resolution pixel copy is the last thing that needs the
        // Image alive, so it happens here and the rest — crop, downscale,
        // JPEG, base64, socket — happens on the encoder thread.
        Bitmap raw = grab(image);
        long capMs = SystemClock.elapsedRealtime() - t0;
        if (raw != null) {
          final int seq = pacer.onEncodeStart(now);
          final int motion = s.motion;
          final boolean held = s.quiet;
          final int w = image.getWidth();
          final int h = image.getHeight();
          final long capturedMs = capMs;
          encodeBusy = true;
          Handler e = enc;
          if (e == null || !e.post(() -> encodeAndSend(raw, w, h, motion, held, seq, capturedMs))) {
            encodeBusy = false;
          }
        }
      }
      dispatch(s, now);
    } finally {
      image.close();
    }
  }

  /** ENCODER THREAD. Crop, downscale, JPEG, base64, then hand the result back
   *  to the capture thread — which is the only thread allowed to decide
   *  whether the cadence slot was spent. */
  private void encodeAndSend(
      Bitmap raw, int w, int h, int motion, boolean held, int seq, long capturedMs) {
    long e0 = SystemClock.elapsedRealtime();
    String b64 = null;
    try {
      b64 = compress(raw, w, h);
    } catch (Exception ignored) {
      // a dropped frame is fine; the next tick retries — and because the
      // pacer credits nothing until delivery, "the next tick" is 120ms
    }
    final String out = b64;
    final long encMs = SystemClock.elapsedRealtime() - e0;
    Handler c = handler;
    if (c == null) return;
    c.post(() -> {
      encodeBusy = false;
      // the share may have ended while this frame was being encoded; a frame
      // for a dead session must reach neither the socket nor the trace
      if (!running) return;
      if (out == null) {
        pacer.onRefused();
        watchDiag(
            "frame",
            "seq", seq, "delivered", false, "refused_by", "encode",
            "encode_ms", encMs, "capture_ms", capturedMs);
        return;
      }
      deliver(out, motion, held, SystemClock.elapsedRealtime(), seq, capturedMs, encMs, false);
    });
  }

  /**
   * Put a frame on the wire and account for it HONESTLY.
   *
   * <p>The engines report whether the socket actually took the frame.
   * {@link LiveWatchEngine#onFrame} refuses whenever the uplink is behind on
   * her audio — video yields to her ears, which is right — and the old code
   * credited that refusal as a send. See WatchPacer's header for the 2.5s of
   * blindness that bought. Only {@link WatchPacer#onDelivered} spends a
   * cadence slot, and only a real delivery reaches it.
   */
  private void deliver(
      String b64, int motion, boolean held, long now, int seq, long capMs, long encMs, boolean keepAlive) {
    // THE LOOK-AWAY: nothing is encoded and nothing enters the socket while
    // they have the curtain closed, so no wake can fire and she cannot invent
    // a word about what she missed.
    if (privateMode) return;
    boolean sent;
    String why = null;
    LiveWatchEngine l = live;
    if (l != null) {
      if (l.isReady()) {
        sent = l.onFrame(b64, motion);
        if (!sent) why = "uplink";
      } else {
        sent = false;
        why = "not_ready";
      }
    } else if (engine != null) {
      sent = engine.onFrame(b64, motion);
      if (!sent) why = "cascade";
    } else {
      sent = false;
      why = "no_lane";
    }
    if (sent) {
      lastB64 = b64;
      lastB64Held = held;
      pacer.onDelivered(now, held);
      WatchPlugin.emitFrame(b64); // UI chip liveness (when the app is visible)
    } else {
      pacer.onRefused();
    }
    // SAMPLED, deliberately — one record per frame would be a bigger stream
    // than the thing it describes. A REFUSAL is never sampled AWAY, because a
    // frame that did not reach her is the whole reason this trace exists, but
    // it is rate-limited: refusals arrive in bursts that all share one cause
    // (the radio stalled), and 2.5 records a second is more resolution than
    // any question about them needs. This ships permanently, not for one
    // debugging session, so the stream has to have a ceiling.
    boolean tellRefusal = false;
    if (!sent) {
      if (now - lastRefusalDiagAt >= REFUSAL_DIAG_MS) {
        lastRefusalDiagAt = now;
        tellRefusal = true;
      }
    }
    if (tellRefusal || (sent && (seq % 10 == 1 || keepAlive)))
      watchDiag(
          "frame",
          "seq", seq,
          "delivered", sent,
          "refused_by", why == null ? "" : why,
          "keep_alive", keepAlive,
          "held", held,
          "motion", motion,
          "bytes", b64.length(),
          "capture_ms", capMs,
          "encode_ms", encMs);
  }

  /** Hand the wake-up to whichever lane is live. Every honesty gate still
   *  lives downstream: a real frame in the socket, never while she speaks,
   *  never across them, and the per-minute ceiling. Nothing here says what to
   *  think — silence answers all of them. */
  private void dispatch(SceneReader.Out s, long now) {
    if (privateMode) return;
    LiveWatchEngine l = live;
    int wake = s.wake;
    if (!startedWake) {
      if (!pacer.anyDelivered()) return;
      wake = SceneReader.WAKE_START;
    } else if (wake == SceneReader.WAKE_NONE) {
      return;
    }
    // a SHOW must ride behind a picture of the HELD screen, not one captured
    // mid-transition; the ambient beat is happy with any delivered frame
    boolean show = SceneReader.isShow(wake);
    if (!pacer.fresh(show, now)) {
      watchDiag(
          "wake", "class", wakeLabel(wake), "sent", false, "refused_by", "stale_frame",
          "frame_age_ms", pacer.frameAge(now), "still_age_ms", pacer.stillAge(now));
      return;
    }
    boolean sent;
    if (l != null) {
      sent = l.nudge(wake);
    } else if (engine != null) {
      sent = engine.nudge(wake);
    } else {
      return;
    }
    // The wake is the START of her reaction leg — reaction_started is
    // correlated to it by onSpeaking, so it is stamped here and nowhere else.
    if (sent) lastNudgeAt = now;
    watchDiag(
        "wake",
        "class", wakeLabel(wake),
        "sent", sent,
        "refused_by", sent ? "" : "engine",
        "seq", pacer.seq(),
        "frame_age_ms", pacer.frameAge(now),
        "still_age_ms", pacer.stillAge(now));
    if (sent) {
      scene.noteWake(wake, now);
      if (wake == SceneReader.WAKE_START) startedWake = true;
      // ONLY here — past every gate above and past the engine's own — may a
      // wake be reported to the web layer for recording. See emitShowWake.
      emitShowWake(wake, s.blank);
    }
  }

  /** Every wake class by name, INCLUDING the ambient ones. Distinct from
   *  wakeName() below on purpose: wakeName is the recording contract (only
   *  SHOW classes may be armed, so an ambient class deliberately has no name
   *  there), while this is the trace, which must be able to say what was
   *  refused. A label that cannot name a suppressed ambient wake cannot tell
   *  "she was never asked to look" from "she was asked and refused". */
  private static String wakeLabel(int wake) {
    switch (wake) {
      case SceneReader.WAKE_START:
        return "start";
      case SceneReader.WAKE_SETTLE:
        return "settle";
      case SceneReader.WAKE_RESHOW:
        return "reshow";
      case SceneReader.WAKE_POINT:
        return "point";
      case SceneReader.WAKE_SWITCH:
        return "switch";
      case SceneReader.WAKE_ALONG:
        return "along";
      case SceneReader.WAKE_IDLE:
        return "idle";
      default:
        return "none";
    }
  }

  /**
   * WS-WATCHPERF — the frame lifecycle, out of the service process and into
   * the ONE diag stream, so the owner's next real share is readable by
   * {@code scripts/pull-trace.mjs} instead of guessed at from source.
   *
   * <p>Content-free by the same contract every other diag record obeys:
   * timings, counts, sizes, class names and refusal reasons. No picture, no
   * pixel, no text, and nothing about what was on the screen beyond the
   * geometry's own class name — which is what the "watchwake" bridge event
   * already carries.
   *
   * <p>Fire-and-forget through the existing plugin bridge: a failed record is
   * a missing line in a trace, never a broken call. Nothing on the capture,
   * speech or wake path reads it back.
   */
  private void watchDiag(String event, Object... kv) {
    try {
      org.json.JSONObject d = new org.json.JSONObject();
      d.put("ev", event);
      for (int i = 0; i + 1 < kv.length; i += 2) d.put(String.valueOf(kv[i]), kv[i + 1]);
      d.put("lane", live != null ? "live" : engine != null ? "cascade" : "none");
      WatchPlugin.emitEvent("watchdiag", d);
    } catch (Exception ignored) {
    }
  }

  /**
   * WS-ANDROID-WATCH: tell the web layer that a SHOW-class wake ACTUALLY WENT
   * OUT, so useCallEngine.ts can arm the very same `vy_shared_moment` window
   * the web screen-share lane arms (armMomentWindow / consumeMomentWindow /
   * postWatchMoment). The native lane deliberately does NOT post to
   * /api/episodes itself: one recording gate, one implementation, already
   * shipped and covered by evals/multimodal — a second copy in Java is a
   * second thing to drift.
   *
   * <p>This is a REPORT, not a decision, and its position is the mechanism.
   * It sits inside {@code if (sent)}, which is reached only after: the
   * look-away ({@code privateMode}, checked at the top of dispatch and again
   * here), a frame that actually entered the socket and — for a SHOW — one
   * captured while the screen was HELD ({@code FRAME_FRESH_MS} against
   * {@code lastStillFrameAt}), and then the engine's own nudge() gates: her
   * own voice ({@code speaking}), the quiet floor after theirs
   * ({@code SHOW_QUIET_MS}/{@code IDLE_QUIET_MS}), the show floor
   * ({@code SHOW_FLOOR_MS}), the ambient share and the hard per-minute
   * ceiling. Upstream of all of it, SceneReader has already refused the wake
   * for a scroll (translation, not a replacement), for an edge-anchored
   * overlay (notification banner, keyboard, toast) and for a picture a wake
   * was already spent on (`wake-dedupe`, which is NOT loosened here or
   * anywhere: the "duplicate" pictures measure 0.00–0.77 MAD at 16x16 and no
   * threshold separates them). A wake any of those refused never reaches this
   * line, so a suppressed wake writes nothing — by construction, not by a
   * second opinion.
   *
   * <p>The {@code blank} guard is EXPLICIT and deliberate. SceneReader's
   * blank test (FLAG_SECURE window, lock screen, display asleep) guards every
   * SHOW branch of pick() but NOT its ambient branches — an `idle`/`along`
   * wake can still fire during a blackout, in the Java exactly as in
   * scene.ts. Nothing recordable comes of that either way, because only SHOW
   * classes are emitted and armed; but "safe because the other branch happens
   * not to reach it" is luck, and the one instant on this platform where a
   * stored row is least forgivable is the one the user protected. So blackout
   * is refused by name, here, where the recording decision is made.
   */
  private void emitShowWake(int wake, boolean blank) {
    if (privateMode) return; // the look-away, re-checked at the write decision
    if (blank) return; // FLAG_SECURE / lock screen / display asleep — see above
    if (!SceneReader.isShow(wake)) return; // ambient is never a shared moment
    String cls = wakeName(wake);
    if (cls == null) return;
    try {
      WatchPlugin.emitEvent("watchwake", new org.json.JSONObject().put("class", cls));
    } catch (Exception ignored) {
      // fire-and-forget: a failed report is a missed memory, never a broken
      // call. Nothing on the capture or speech path depends on this line.
    }
  }

  /** The SHOW classes, named exactly as src/watch/scene.ts's WakeClass union
   *  spells them — the web layer narrows on these strings. Ambient classes
   *  deliberately have no name here: an unnamed class cannot be armed, so a
   *  future ambient emit would be inert rather than wrong. */
  private static String wakeName(int wake) {
    switch (wake) {
      case SceneReader.WAKE_SETTLE:
        return "settle";
      case SceneReader.WAKE_RESHOW:
        return "reshow";
      case SceneReader.WAKE_POINT:
        return "point";
      case SceneReader.WAKE_SWITCH:
        return "switch";
      default:
        return null;
    }
  }

  /**
   * CAPTURE THREAD — the only half that needs the {@link Image} alive: a
   * full-resolution pixel copy out of the capture plane.
   *
   * <p>The destination Bitmap is REUSED. A 1080-tall half-res capture is
   * ~2.6MB of ARGB_8888, and allocating one per frame at 1.67 fps was ~4.4
   * MB/s of pure garbage on the app's main heap for the length of a film.
   * Reuse is safe because exactly one encode is ever in flight
   * ({@link WatchPacer#WHY_BUSY}) — the capture thread cannot start writing
   * frame N+1 into it until the encoder has reported frame N back.
   */
  private Bitmap grab(Image image) {
    try {
      Image.Plane plane = image.getPlanes()[0];
      ByteBuffer buffer = plane.getBuffer();
      int pixelStride = plane.getPixelStride();
      int rowStride = plane.getRowStride();
      int rowPadding = rowStride - pixelStride * image.getWidth();
      int w = image.getWidth() + rowPadding / pixelStride;
      int h = image.getHeight();
      if (w <= 0 || h <= 0) return null;
      Bitmap b = capBitmap;
      if (b == null || capBitmapW != w || capBitmapH != h) {
        if (b != null) b.recycle();
        b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        capBitmap = b;
        capBitmapW = w;
        capBitmapH = h;
      }
      buffer.rewind();
      b.copyPixelsFromBuffer(buffer);
      return b;
    } catch (Exception e) {
      return null;
    }
  }

  /** ENCODER THREAD — crop the row padding, downscale so the longest side is
   *  ~768 (one vision tile, the same full quality on every link), JPEG,
   *  base64. This is the expensive half and it no longer runs on the looper
   *  that also owns the detect tick. */
  private String compress(Bitmap raw, int w, int h) {
    // ONE quality, always the best one — so this thread needs to know nothing
    // about which lane is up, and deliberately reads no field the main thread
    // writes. (It used to branch on `live` for a maxSide and a quality that
    // were the same number on both sides of the branch.)
    final int maxSide = LIVE_MAX_SIDE;
    final int quality = LIVE_JPEG_Q;
    Bitmap cropped = raw.getWidth() == w ? raw : Bitmap.createBitmap(raw, 0, 0, w, h);
    float scale = maxSide / (float) Math.max(cropped.getWidth(), cropped.getHeight());
    Bitmap frame =
        scale < 1f
            ? Bitmap.createScaledBitmap(
                cropped,
                Math.round(cropped.getWidth() * scale),
                Math.round(cropped.getHeight() * scale),
                true)
            : cropped;
    jpegOut.reset();
    frame.compress(Bitmap.CompressFormat.JPEG, quality, jpegOut);
    if (frame != cropped) frame.recycle();
    if (cropped != raw) cropped.recycle();
    return Base64.encodeToString(jpegOut.toByteArray(), Base64.NO_WRAP);
  }

  /** Luma thumbnail sampled straight from the capture plane — no Bitmap, no
   *  allocation beyond the signature itself, so it can run every tick. */
  private byte[] signature(Image image) {
    try {
      Image.Plane plane = image.getPlanes()[0];
      ByteBuffer buf = plane.getBuffer();
      int ps = plane.getPixelStride();
      int rs = plane.getRowStride();
      int w = image.getWidth();
      int h = image.getHeight();
      if (w <= 0 || h <= 0) return null;
      byte[] sig = new byte[SIG_LEN];
      for (int y = 0; y < SIG_SIDE; y++) {
        int py = Math.min(h - 1, (2 * y + 1) * h / (2 * SIG_SIDE));
        int row = py * rs;
        for (int x = 0; x < SIG_SIDE; x++) {
          int px = Math.min(w - 1, (2 * x + 1) * w / (2 * SIG_SIDE));
          int off = row + px * ps; // absolute gets: the buffer position stays put
          int r = buf.get(off) & 0xFF;
          int g = buf.get(off + 1) & 0xFF;
          int b = buf.get(off + 2) & 0xFF;
          sig[y * SIG_SIDE + x] = (byte) ((r * 77 + g * 150 + b * 29) >> 8);
        }
      }
      return sig;
    } catch (Exception e) {
      return null;
    }
  }

  /** Release one capture session (projection, reader, display, engines). */
  private void teardownSession() {
    running = false;
    sessionActive = false;
    scene.reset(); // a new share's first frame is new content again
    pacer.reset();
    lastB64 = null;
    lastB64Held = false;
    startedWake = false;
    lastNudgeAt = 0;
    lastRefusalDiagAt = 0;
    encodeBusy = false;
    privateMode = false; // a look-away never survives the session it was in
    // Device audio is per-share by the same rule the look-away is per-session:
    // a consent given for one share may not be inherited by the next one.
    mediaAudioOn = false;
    stopMediaAudio();
    BubbleService.stopBubble(this);
    stopLive();
    stopCascade();
    lane = LANE_NONE;
    // both engines are silent: anything they still have posted is stale
    sessionGen++;
    config = null;
    if (handler != null) handler.removeCallbacksAndMessages(null);
    if (enc != null) enc.removeCallbacksAndMessages(null);
    if (encThread != null) encThread.quitSafely();
    encThread = null;
    enc = null;
    // NOT recycled: quitSafely() lets a message that is ALREADY RUNNING
    // finish, and that message is the encoder reading exactly this bitmap.
    // A recycled bitmap in use throws; a dropped reference is collected.
    capBitmap = null;
    capBitmapW = 0;
    capBitmapH = 0;
    if (display != null) display.release();
    if (reader != null) reader.close();
    if (projection != null) projection.stop();
    display = null;
    reader = null;
    projection = null;
    if (instance == this) instance = null;
  }

  private void stopEverything() {
    boolean wasActive = sessionActive;
    teardownSession();
    stopForeground(STOP_FOREGROUND_REMOVE);
    stopSelf();
    // teardown's projection.stop() re-enters here through
    // MediaProjection.Callback — the web layer must see exactly ONE stop per
    // session, or it tears down (and re-arms) its own lane twice
    if (wasActive) WatchPlugin.emitStopped();
  }

  @Override
  public void onTaskRemoved(Intent rootIntent) {
    // the user swiped the app away — the screen share must die with it, not
    // keep broadcasting their screen from an ownerless service
    stopEverything();
    super.onTaskRemoved(rootIntent);
  }

  @Override
  public void onDestroy() {
    teardownSession();
    super.onDestroy();
  }
}
