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
  // On the live lane those frames share ONE socket with her ears, so the
  // rate/quality/size are indexed by LiveWatchEngine.getCongestion(): on a
  // struggling uplink we send fewer, cheaper, smaller frames and the voice
  // stream keeps the bandwidth. Voice is never the thing that degrades.
  private static final long[] LIVE_FRAME_MS = {600L, 1200L, 2500L};
  private static final int[] LIVE_JPEG_Q = {68, 55, 45};
  private static final int[] LIVE_MAX_SIDE = {768, 768, 560};
  // Congestion drops the tier at once; the climb back is one step per CLEAR
  // WINDOW, where "clear" means congestion BELOW the tier we sit at — not
  // congestion zero. A link that settles at level 1 must still be able to
  // climb from tier 2 to tier 1; requiring zero pinned it at the worst tier
  // for the rest of the session.
  //
  // The window is exponential for marginal links: 5s to start, doubling (to
  // 40s) whenever a recovery step is undone by a fall within 10s, and back
  // to 5s after a full minute with no fall at all. A link that can only
  // carry tier 1 therefore stops re-testing tier 0 every 5s — that
  // oscillation was itself visible as the picture pulsing.
  private static final long TIER_RECOVER_MS = 5000;
  private static final long TIER_RECOVER_MAX_MS = 40_000;
  private static final long TIER_UNDONE_MS = 10_000; // a fall this soon after a climb
  private static final long TIER_STABLE_MS = 60_000; // this long with no fall = reset
  private static final long FRAME_INTERVAL_MS = 1400;

  // ── waking her up ──────────────────────────────────────────────────────
  // The Live API never generates from video on its own, so nothing she sees
  // can make her speak unless something asks her to look. What it looks at is
  // what the screen is DOING: every frame becomes a 16x16 grayscale thumb,
  // compared to the previous one by mean absolute difference (in TENTHS of a
  // 0-255 level, so a caret or one new line of text isn't rounded away).
  //
  // A screen is often interesting without changing fast — reading, typing,
  // filling a form, comparing two things — so there are three bands, not two:
  // most of the frame different (a new page, app, post, photo), a little
  // different (they're busy doing something), and identical (nothing at all).
  // The bands carry NO taste; they say what happened, and her own brain
  // decides what — and whether — to say about it.
  private static final int SIG_SIDE = 16;
  private static final int SIG_LEN = SIG_SIDE * SIG_SIDE;
  private static final int NEW_MAD = 140; // 14.0 levels: most of the frame moved
  private static final int ACTIVE_MAD = 12; // 1.2 levels: a caret, an edit, a hover
  private final int[] sigPx = new int[SIG_LEN];
  private byte[] sceneSig; // previous frame's thumb (handler-thread confined)
  private boolean prevBig = false;

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
  // capture tier, handler-thread confined (sampler + captureFrame +
  // teardownSession, all on the main looper) — no other thread reads or
  // writes any of it
  private int liveTier = 0;
  private long tierClearSince = 0; // SystemClock.elapsedRealtime
  private long tierRecoverMs = TIER_RECOVER_MS; // current clear window
  private long tierRecoveredAt = 0; // last climb, for the "undone" test
  private long tierFellAt = 0; // last fall, for the stability reset

  private final Runnable sampler = new Runnable() {
    @Override
    public void run() {
      if (!running) return;
      try {
        captureFrame();
      } catch (Exception ignored) {
        // a dropped frame is fine; the next tick retries
      }
      adaptTier();
      if (running && handler != null) {
        handler.postDelayed(this, live != null ? LIVE_FRAME_MS[liveTier] : FRAME_INTERVAL_MS);
      }
    }
  };

  /** One step per frame tick: fall to the reported congestion immediately,
   *  recover a single step per clear window. elapsedRealtime, not wall clock:
   *  an NTP/DST jump must not hand out a free recovery or freeze one. */
  private void adaptTier() {
    LiveWatchEngine l = live;
    if (l == null) {
      liveTier = 0; // cascade lane: no shared socket to protect
      return;
    }
    int c = l.getCongestion();
    long now = SystemClock.elapsedRealtime();
    if (c > liveTier) {
      liveTier = c; // falling is instant — the link is already hurting
      if (tierRecoveredAt != 0 && now - tierRecoveredAt <= TIER_UNDONE_MS) {
        // we climbed and the link threw it straight back: wait longer
        tierRecoverMs = Math.min(TIER_RECOVER_MAX_MS, tierRecoverMs * 2);
      }
      tierRecoveredAt = 0;
      tierFellAt = now;
      tierClearSince = now;
    } else if (c >= liveTier) {
      // still as congested as the tier we are on — the clear run restarts.
      // (Only c >= liveTier restarts it: a residual level 1 no longer blocks
      // the climb down from tier 2.)
      tierClearSince = now;
    } else if (now - tierClearSince >= tierRecoverMs) {
      liveTier--;
      tierClearSince = now;
      tierRecoveredAt = now;
    }
    if (tierFellAt != 0 && now - tierFellAt >= TIER_STABLE_MS) {
      tierRecoverMs = TIER_RECOVER_MS; // link has been stable for a minute
      tierFellAt = 0;
    }
  }

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
    handler.postDelayed(sampler, 800);
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

  private void captureFrame() {
    if (reader == null) return;
    Image image = reader.acquireLatestImage();
    if (image == null) return;
    try {
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
      // crop padding, downscale so the longest side is ~768 (one vision
      // tile) — or smaller on the live lane's heaviest congestion tier
      LiveWatchEngine l = live;
      int maxSide = l != null ? LIVE_MAX_SIDE[liveTier] : 768;
      int quality = l != null ? LIVE_JPEG_Q[liveTier] : 68;
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
      String b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
      WatchPlugin.emitFrame(b64); // UI chip liveness (when the app is visible)
      // 0 nothing moved · 1 they're doing something · 2 a new thing to look at
      byte[] sig = signature(frame);
      int motion = 0;
      if (sig != null) {
        if (sceneSig == null) {
          motion = 2; // the first thing she is ever shown is new by definition
        } else {
          int d = madTenths(sceneSig, sig);
          boolean big = d >= NEW_MAD;
          // only the LEADING EDGE of a big change is a new thing: the middle
          // of a scroll or a page transition is them being busy, not a thing
          motion = big ? (prevBig ? 1 : 2) : d >= ACTIVE_MAD ? 1 : 0;
          prevBig = big;
        }
        sceneSig = sig;
      }
      // the brain lives natively — realtime lane while its socket is up,
      // cascade otherwise (frames before setupComplete are simply skipped)
      if (l != null) {
        if (l.isReady()) l.onFrame(b64, motion);
      } else if (engine != null) {
        engine.onFrame(b64, motion);
      }
    } finally {
      image.close();
    }
  }

  /** 16x16 luma thumbnail of a frame, or null if it can't be built. */
  private byte[] signature(Bitmap src) {
    try {
      Bitmap t = Bitmap.createScaledBitmap(src, SIG_SIDE, SIG_SIDE, true);
      t.getPixels(sigPx, 0, SIG_SIDE, 0, 0, SIG_SIDE, SIG_SIDE);
      byte[] sig = new byte[SIG_LEN];
      for (int i = 0; i < SIG_LEN; i++) {
        int p = sigPx[i];
        sig[i] =
            (byte)
                ((((p >> 16) & 0xFF) * 77 + ((p >> 8) & 0xFF) * 150 + (p & 0xFF) * 29) >> 8);
      }
      if (t != src) t.recycle();
      return sig;
    } catch (Exception e) {
      return null;
    }
  }

  /** Mean absolute difference in tenths of a level (max 2550). */
  private static int madTenths(byte[] a, byte[] b) {
    int sum = 0;
    for (int i = 0; i < a.length; i++) sum += Math.abs((a[i] & 0xFF) - (b[i] & 0xFF));
    return sum * 10 / a.length;
  }

  /** Release one capture session (projection, reader, display, engines). */
  private void teardownSession() {
    running = false;
    sessionActive = false;
    // a new session starts at full rate and the FAST clear window — never
    // inheriting the old link's tier or its accumulated backoff
    liveTier = 0;
    tierClearSince = 0;
    tierRecoverMs = TIER_RECOVER_MS;
    tierRecoveredAt = 0;
    tierFellAt = 0;
    sceneSig = null; // a new share's first frame is new content again
    prevBig = false;
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
