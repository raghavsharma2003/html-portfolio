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
  private static final long LIVE_FRAME_MS = 600L;
  private static final int LIVE_JPEG_Q = 68;
  private static final int LIVE_MAX_SIDE = 768;
  private static final long FRAME_INTERVAL_MS = 1400;

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
  private static final long DETECT_MS = 120; // screen sampled this often
  private static final long CHANGE_SEND_MS = 250; // floor between reaction frames
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
  private static final long IDLE_FRAME_MS = 2500L;
  /** Mirrors LiveWatchEngine.FRAME_FRESH_MS: no picture this new, no wake-up.
   *  This is THE grounding invariant of the whole feature — she is never told
   *  to look at a screen she was not actually shown. */
  private static final long FRAME_FRESH_MS = 3000L;
  private final SceneReader scene = new SceneReader();
  private boolean movedSinceSent = true; // the first frame always goes
  private String lastB64; // the last picture we encoded, for the keep-alive
  private boolean lastB64Held; // ...and whether it caught the screen standing still
  private boolean wantStill; // the screen stopped and we still owe a still frame
  private long lastSentAt = 0; // elapsedRealtime of the last frame that went out
  private long lastStillFrameAt = 0; // ...captured while the screen was HELD
  private boolean startedWake = false;
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
    // the native brain loop — lives HERE because Android freezes the WebView
    // (timers and fetch) while another app is foreground. Realtime first:
    // the Gemini Live session co-watches with ~zero latency and real barge-in;
    // the snapshot→think→speak cascade is the fallback rung underneath it.
    config = intent.getStringExtra(EXTRA_CONFIG);
    if (!startLive()) startCascade();
    BubbleService.startBubble(this); // she hovers over the screen (needs SAW)
    BubbleService.setState(this, BubbleService.STATE_WATCHING);
    handler = new Handler(Looper.getMainLooper());
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
    Image image = reader.acquireLatestImage();
    // NO NEW IMAGE IS NOT NOTHING. A virtual display only produces a buffer
    // when the screen composites something, so a static screen delivers
    // nothing at all — and a static screen is exactly what a deliberate show
    // looks like. The old early return meant the stiller the screen got, the
    // less code ran: detect never fired, the still run never advanced, and
    // the one moment that matters most in this whole feature executed nothing.
    // It also meant her newest picture aged past FRAME_FRESH_MS and she went
    // blind and unwakeable for as long as they held.
    if (image == null) {
      SceneReader.Out s = scene.still(now);
      // the keep-alive re-sends the LAST ENCODED picture — no plane read, no
      // Bitmap, no JPEG: this is a socket write of a string we already have
      keepAlive(now);
      dispatch(s, now);
      return;
    }
    try {
      byte[] sig = signature(image);
      // an unreadable plane is not a still screen: advance the hold off the
      // last grid rather than pretending the picture changed to nothing
      SceneReader.Out s = sig != null ? scene.read(sig, now) : scene.still(now);
      // "identical" is the detector's own hold test, not byte equality: a
      // blinking caret, a clock digit or a spinner is a screen standing still,
      // and a paused video under a UI overlay redraws without changing —
      // exactly the case acquireLatestImage()'s null check never covered.
      if (!s.quiet) movedSinceSent = true;
      LiveWatchEngine l = live;
      long baseline = l != null ? LIVE_FRAME_MS : FRAME_INTERVAL_MS;
      // Full cadence whenever anything moved; the slow keep-alive beat only on
      // a screen the detector says is genuinely identical. A redraw that
      // changed nothing is not worth a vision tile — and it tells her nothing
      // she is not already looking at. Never a quality change, only a
      // frequency one, and only on a screen that is standing still.
      long cadence = movedSinceSent ? baseline : Math.max(baseline, IDLE_FRAME_MS);
      // The screen just STOPPED: get a legible still picture up now, ahead of
      // the cadence, so the hold that confirms a moment later is backed by the
      // frame they are actually looking at — and the poke itself is a bare
      // socket write with nothing on the critical path. A frame captured
      // mid-transition is half the old screen and half the new one, which is
      // precisely the input that makes her guess at what she is seeing.
      // the pre-roll is STICKY: if the 250ms re-encode floor swallows the tick
      // the screen stopped on, the debt carries to the next tick that can pay
      // it, so a hold is never left backed by a mid-transition picture
      if (s.preroll) wantStill = true;
      boolean want = wantStill || now - lastSentAt >= cadence;
      if (want && now - lastSentAt >= CHANGE_SEND_MS) {
        String b64 = encode(image);
        if (b64 != null) send(b64, s.motion, s.quiet, now);
      }
      dispatch(s, now);
    } finally {
      image.close();
    }
  }

  /** Re-send the picture we already have, so a held screen never ages past
   *  the freshness window that every wake-up depends on. No encode, no plane
   *  read — the cost is the vision tile and nothing else. */
  private void keepAlive(long now) {
    if (lastB64 == null || now - lastSentAt < IDLE_FRAME_MS) return;
    // it only counts as a picture of the HELD screen if it actually caught the
    // screen standing still — re-sending a mid-transition frame must not let a
    // show wake claim she is looking at what they stopped on
    send(lastB64, 0, lastB64Held, now);
  }

  private void send(String b64, int motion, boolean held, long now) {
    // THE LOOK-AWAY: nothing is encoded and nothing enters the socket while
    // they have the curtain closed, so no wake can fire and she cannot invent
    // a word about what she missed.
    if (privateMode) return;
    lastSentAt = now;
    lastB64 = b64;
    lastB64Held = held;
    movedSinceSent = false;
    if (held) {
      lastStillFrameAt = now;
      wantStill = false;
    }
    WatchPlugin.emitFrame(b64); // UI chip liveness (when the app is visible)
    // the brain lives natively — realtime lane while its socket is up,
    // cascade otherwise (frames before setupComplete are simply skipped)
    LiveWatchEngine l = live;
    if (l != null) {
      if (l.isReady()) l.onFrame(b64, motion);
    } else if (engine != null) {
      engine.onFrame(b64, motion);
    }
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
      if (lastSentAt == 0) return;
      wake = SceneReader.WAKE_START;
    } else if (wake == SceneReader.WAKE_NONE) {
      return;
    }
    // a SHOW must ride behind a picture of the HELD screen, not one captured
    // mid-transition; the ambient beat is happy with any delivered frame
    long backing = SceneReader.isShow(wake) ? lastStillFrameAt : lastSentAt;
    if (backing == 0 || now - backing > FRAME_FRESH_MS) return;
    boolean sent;
    if (l != null) {
      sent = l.nudge(wake);
    } else if (engine != null) {
      sent = engine.nudge(wake);
    } else {
      return;
    }
    if (sent) {
      scene.noteWake(wake, now);
      if (wake == SceneReader.WAKE_START) startedWake = true;
    }
  }

  /** Full-res copy -> crop -> downscale -> JPEG -> base64. The expensive
   *  half, run only for frames that are actually going out. */
  private String encode(Image image) {
    Image.Plane plane = image.getPlanes()[0];
    ByteBuffer buffer = plane.getBuffer();
    int pixelStride = plane.getPixelStride();
    int rowStride = plane.getRowStride();
    int rowPadding = rowStride - pixelStride * image.getWidth();
    Bitmap bitmap =
        Bitmap.createBitmap(
            image.getWidth() + rowPadding / pixelStride,
            image.getHeight(),
            Bitmap.Config.ARGB_8888);
    bitmap.copyPixelsFromBuffer(buffer);
    // crop padding, downscale so the longest side is ~768 — one vision tile,
    // the same full quality on every link
    LiveWatchEngine l = live;
    int maxSide = l != null ? LIVE_MAX_SIDE : 768;
    int quality = l != null ? LIVE_JPEG_Q : 68;
    Bitmap cropped = Bitmap.createBitmap(bitmap, 0, 0, image.getWidth(), image.getHeight());
    float scale = maxSide / (float) Math.max(cropped.getWidth(), cropped.getHeight());
    Bitmap frame =
        scale < 1f
            ? Bitmap.createScaledBitmap(
                cropped,
                Math.round(cropped.getWidth() * scale),
                Math.round(cropped.getHeight() * scale),
                true)
            : cropped;
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    frame.compress(Bitmap.CompressFormat.JPEG, quality, out);
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
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
    movedSinceSent = true;
    lastB64 = null;
    lastB64Held = false;
    wantStill = false;
    lastSentAt = 0;
    lastStillFrameAt = 0;
    startedWake = false;
    privateMode = false; // a look-away never survives the session it was in
    BubbleService.stopBubble(this);
    stopLive();
    stopCascade();
    lane = LANE_NONE;
    // both engines are silent: anything they still have posted is stale
    sessionGen++;
    config = null;
    if (handler != null) handler.removeCallbacksAndMessages(null);
    if (display != null) display.release();
    if (reader != null) reader.close();
    if (projection != null) projection.stop();
    display = null;
    reader = null;
    projection = null;
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
