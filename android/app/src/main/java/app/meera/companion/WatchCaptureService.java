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
  private static final String CHANNEL_ID = "meera_watch";
  private static final int NOTIF_ID = 4207;
  private static final long FRAME_INTERVAL_MS = 3000;

  private WatchEngine engine;
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
        captureFrame();
      } catch (Exception ignored) {
        // a dropped frame is fine; the next tick retries
      }
      if (running && handler != null) handler.postDelayed(this, FRAME_INTERVAL_MS);
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
    startAsForeground();
    // a second start() must not leak the old session (double engines would
    // talk over each other and double the frame traffic) — tear down first
    if (projection != null || engine != null) teardownSession();
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
    // the native brain loop — lives HERE because Android freezes the WebView
    // (timers and fetch) while another app is foreground
    engine = new WatchEngine(this, WatchPlugin::emitEvent);
    String cfg = intent.getStringExtra(EXTRA_CONFIG);
    if (cfg != null) engine.configure(cfg);
    engine.start();
    BubbleService.startBubble(this); // she hovers over the screen (needs SAW)
    BubbleService.setState(this, BubbleService.STATE_WATCHING);
    handler = new Handler(Looper.getMainLooper());
    handler.postDelayed(sampler, 800);
    return START_NOT_STICKY;
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
    Notification notif =
        new Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Meera is watching with you")
            .setContentText("Screen sharing is on — tap to open, stop from the call.")
            .setSmallIcon(getApplicationInfo().icon)
            .setContentIntent(pi)
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
      // crop padding, downscale so the longest side is ~768 (one vision tile)
      Bitmap cropped = Bitmap.createBitmap(bitmap, 0, 0, image.getWidth(), image.getHeight());
      float scale = 768f / Math.max(cropped.getWidth(), cropped.getHeight());
      Bitmap frame =
          scale < 1f
              ? Bitmap.createScaledBitmap(
                  cropped,
                  Math.round(cropped.getWidth() * scale),
                  Math.round(cropped.getHeight() * scale),
                  true)
              : cropped;
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      frame.compress(Bitmap.CompressFormat.JPEG, 68, out);
      String b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
      WatchPlugin.emitFrame(b64); // UI chip liveness (when the app is visible)
      if (engine != null) engine.onFrame(b64); // the brain lives natively
    } finally {
      image.close();
    }
  }

  /** Release one capture session (projection, reader, display, engine). */
  private void teardownSession() {
    running = false;
    BubbleService.stopBubble(this);
    if (engine != null) {
      engine.stop();
      engine = null;
    }
    if (handler != null) handler.removeCallbacksAndMessages(null);
    if (display != null) display.release();
    if (reader != null) reader.close();
    if (projection != null) projection.stop();
    display = null;
    reader = null;
    projection = null;
  }

  private void stopEverything() {
    teardownSession();
    stopForeground(STOP_FOREGROUND_REMOVE);
    stopSelf();
    WatchPlugin.emitStopped();
  }

  @Override
  public void onDestroy() {
    teardownSession();
    super.onDestroy();
  }
}
