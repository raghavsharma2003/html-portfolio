package app.meera.companion;

import android.animation.ValueAnimator;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Shader;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.view.animation.OvershootInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;

import java.io.InputStream;

/**
 * Floating chat-head bubble for "Meera watches your screen with you". While the
 * mediaProjection capture runs (see WatchCaptureService) the user is usually in
 * some OTHER app, so this overlay is the only visible sign that Meera is along
 * for the ride — and the one-tap way back into the conversation.
 *
 * Deliberately NOT a foreground service: the capture service already holds the
 * required FGS + notification, and doubling up would mean a second persistent
 * notification for what is purely cosmetic UI. If the process dies the bubble
 * dies with it, which is the correct behavior (no capture -> no bubble).
 *
 * Driven by other components via intents:
 *   startBubble(ctx) / stopBubble(ctx) / setState(ctx, "watching"|"speaking"|"idle")
 */
public class BubbleService extends Service {
  public static final String ACTION_SHOW = "app.meera.companion.bubble.SHOW";
  public static final String ACTION_HIDE = "app.meera.companion.bubble.HIDE";
  public static final String ACTION_STATE = "app.meera.companion.bubble.STATE";
  public static final String EXTRA_STATE = "state";

  public static final String STATE_WATCHING = "watching";
  public static final String STATE_SPEAKING = "speaking";
  public static final String STATE_IDLE = "idle";

  private static final int BUBBLE_DP = 64;
  private static final int RING_DP = 2;
  private static final int DOT_DP = 10;
  // movement below this (in dp) counts as a tap, not a drag
  private static final int TAP_SLOP_DP = 10;

  private static final int COLOR_ROSE = 0xFFE0356B;
  private static final int COLOR_AMBER = 0xFFF77737;
  private static final int COLOR_GREEN = 0xFF2ECC71;
  private static final int COLOR_IDLE = 0xFF9AA0A6;

  private WindowManager windowManager;
  private WindowManager.LayoutParams layoutParams;
  private FrameLayout bubble;
  private View statusDot;
  private ValueAnimator pulseAnimator;
  private ValueAnimator snapAnimator;
  // state is remembered so a STATE intent that arrives before SHOW isn't lost
  private String currentState = STATE_WATCHING;

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  // ---- control surface (other services drive the bubble through these) ----

  // startService throws IllegalStateException once the process drops to
  // background (e.g. a stop racing an in-flight TTS request) — a missed
  // bubble update must never crash the app, so every entry point swallows
  public static void startBubble(Context context) {
    try {
      context.startService(new Intent(context, BubbleService.class).setAction(ACTION_SHOW));
    } catch (Exception ignored) {}
  }

  public static void stopBubble(Context context) {
    try {
      context.startService(new Intent(context, BubbleService.class).setAction(ACTION_HIDE));
    } catch (Exception ignored) {}
  }

  public static void setState(Context context, String state) {
    try {
      context.startService(
          new Intent(context, BubbleService.class)
              .setAction(ACTION_STATE)
              .putExtra(EXTRA_STATE, state));
    } catch (Exception ignored) {}
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    String action = intent != null ? intent.getAction() : null;
    if (action == null || ACTION_HIDE.equals(action)) {
      // null intent = restart we never asked for (START_NOT_STICKY should
      // prevent it, but belt and braces); treat it like HIDE
      stopSelf();
      return START_NOT_STICKY;
    }
    if (ACTION_SHOW.equals(action)) {
      if (!canOverlay()) {
        // no permission -> vanish quietly; the web layer is responsible for
        // sending the user to Settings, crashing here would kill the session
        stopSelf();
        return START_NOT_STICKY;
      }
      showBubble();
      applyState(currentState);
    } else if (ACTION_STATE.equals(action)) {
      String state = intent.getStringExtra(EXTRA_STATE);
      if (state != null) {
        currentState = state;
        applyState(state);
      }
    }
    return START_NOT_STICKY;
  }

  private boolean canOverlay() {
    // canDrawOverlays exists since M; minSdk is 24 so no reflection needed
    return Settings.canDrawOverlays(this);
  }

  // ---- view construction (all in code — no XML so the integrator only has to
  // register the service in the manifest) ----

  private void showBubble() {
    if (bubble != null) return; // guard double-add: SHOW may arrive repeatedly
    windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
    if (windowManager == null) {
      stopSelf();
      return;
    }

    int size = dp(BUBBLE_DP);
    bubble = new FrameLayout(this);

    ImageView avatar = new ImageView(this);
    Bitmap face = loadCircularAvatar(size);
    if (face != null) {
      avatar.setImageBitmap(face);
    } else {
      // fallback: Meera's brand gradient as a circle
      GradientDrawable gradient =
          new GradientDrawable(
              GradientDrawable.Orientation.TL_BR, new int[] {COLOR_ROSE, COLOR_AMBER});
      gradient.setShape(GradientDrawable.OVAL);
      avatar.setImageDrawable(gradient);
    }
    bubble.addView(
        avatar, new FrameLayout.LayoutParams(size, size, Gravity.TOP | Gravity.START));

    // white ring drawn OVER the avatar so it stays crisp regardless of image
    GradientDrawable ring = new GradientDrawable();
    ring.setShape(GradientDrawable.OVAL);
    ring.setColor(Color.TRANSPARENT);
    ring.setStroke(dp(RING_DP), Color.WHITE);
    View ringView = new View(this);
    ringView.setBackground(ring);
    bubble.addView(
        ringView, new FrameLayout.LayoutParams(size, size, Gravity.TOP | Gravity.START));

    // status dot, bottom-right, color driven by applyState()
    statusDot = new View(this);
    GradientDrawable dot = new GradientDrawable();
    dot.setShape(GradientDrawable.OVAL);
    dot.setColor(COLOR_GREEN);
    dot.setStroke(dp(1), Color.WHITE); // thin outline so it reads on any app underneath
    statusDot.setBackground(dot);
    FrameLayout.LayoutParams dotLp =
        new FrameLayout.LayoutParams(dp(DOT_DP), dp(DOT_DP), Gravity.BOTTOM | Gravity.END);
    int inset = dp(2);
    dotLp.setMargins(0, 0, inset, inset);
    bubble.addView(statusDot, dotLp);

    // TYPE_APPLICATION_OVERLAY is O+; TYPE_PHONE is the legacy SAW type below
    int windowType =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
    layoutParams =
        new WindowManager.LayoutParams(
            size,
            size,
            windowType,
            // NOT_FOCUSABLE so the bubble never steals keys/IME from the app under it
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT);
    layoutParams.gravity = Gravity.TOP | Gravity.START;
    DisplayMetrics metrics = getResources().getDisplayMetrics();
    // start docked on the right edge, upper third — thumb-reachable, out of the
    // way of most apps' top bars
    layoutParams.x = metrics.widthPixels - size;
    layoutParams.y = metrics.heightPixels / 3;

    attachDragHandler();

    try {
      windowManager.addView(bubble, layoutParams);
    } catch (Exception e) {
      // e.g. permission revoked between our check and addView — fail quietly
      bubble = null;
      stopSelf();
    }
  }

  /**
   * Tries to load Meera's avatar from the bundled web assets. The Vite build
   * hashes filenames (meera-XXXX.jpg) so we scan the folder instead of
   * hardcoding a name; any failure falls back to the gradient.
   */
  private Bitmap loadCircularAvatar(int sizePx) {
    try {
      String dir = "public/assets";
      String[] files = getAssets().list(dir);
      if (files == null) return null;
      String match = null;
      for (String f : files) {
        String lower = f.toLowerCase();
        if (lower.startsWith("meera")
            && (lower.endsWith(".jpg") || lower.endsWith(".png") || lower.endsWith(".webp"))) {
          match = dir + "/" + f;
          break;
        }
      }
      if (match == null) return null;
      InputStream in = getAssets().open(match);
      Bitmap raw;
      try {
        raw = BitmapFactory.decodeStream(in);
      } finally {
        in.close();
      }
      if (raw == null) return null;
      // center-crop to square, scale to bubble size, then clip to a circle
      int side = Math.min(raw.getWidth(), raw.getHeight());
      Bitmap square =
          Bitmap.createBitmap(
              raw, (raw.getWidth() - side) / 2, (raw.getHeight() - side) / 2, side, side);
      Bitmap scaled = Bitmap.createScaledBitmap(square, sizePx, sizePx, true);
      Bitmap circle = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888);
      Canvas canvas = new Canvas(circle);
      Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
      paint.setShader(new BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
      float r = sizePx / 2f;
      canvas.drawCircle(r, r, r, paint);
      return circle;
    } catch (Exception e) {
      return null; // asset layout changed or OOM on a tiny device — gradient is fine
    }
  }

  // ---- drag / tap ----

  private void attachDragHandler() {
    final int tapSlop = dp(TAP_SLOP_DP);
    final int tapTimeout = ViewConfiguration.getTapTimeout() + 150; // a forgiving tap window
    bubble.setOnTouchListener(
        new View.OnTouchListener() {
          private float downRawX, downRawY;
          private int startX, startY;
          private long downTime;
          private boolean dragging;

          @Override
          public boolean onTouch(View v, MotionEvent event) {
            switch (event.getActionMasked()) {
              case MotionEvent.ACTION_DOWN:
                // a new touch takes over from any in-flight snap animation
                if (snapAnimator != null) snapAnimator.cancel();
                downRawX = event.getRawX();
                downRawY = event.getRawY();
                startX = layoutParams.x;
                startY = layoutParams.y;
                downTime = event.getEventTime();
                dragging = false;
                return true;
              case MotionEvent.ACTION_MOVE:
                float dx = event.getRawX() - downRawX;
                float dy = event.getRawY() - downRawY;
                if (!dragging && (Math.abs(dx) > tapSlop || Math.abs(dy) > tapSlop)) {
                  dragging = true;
                }
                if (dragging) {
                  layoutParams.x = startX + Math.round(dx);
                  layoutParams.y = startY + Math.round(dy);
                  clampToScreen();
                  safeUpdateLayout();
                }
                return true;
              case MotionEvent.ACTION_UP:
                if (!dragging && event.getEventTime() - downTime <= tapTimeout) {
                  openApp();
                } else {
                  snapToEdge();
                }
                return true;
              case MotionEvent.ACTION_CANCEL:
                if (dragging) snapToEdge();
                return true;
              default:
                return false;
            }
          }
        });
  }

  private void clampToScreen() {
    DisplayMetrics metrics = getResources().getDisplayMetrics();
    int size = dp(BUBBLE_DP);
    layoutParams.x = Math.max(0, Math.min(layoutParams.x, metrics.widthPixels - size));
    layoutParams.y = Math.max(0, Math.min(layoutParams.y, metrics.heightPixels - size));
  }

  /** Animates the bubble to whichever horizontal edge is nearer (chat-head feel). */
  private void snapToEdge() {
    if (bubble == null) return;
    DisplayMetrics metrics = getResources().getDisplayMetrics();
    int size = dp(BUBBLE_DP);
    int fromX = layoutParams.x;
    int toX = (fromX + size / 2 < metrics.widthPixels / 2) ? 0 : metrics.widthPixels - size;
    snapAnimator = ValueAnimator.ofInt(fromX, toX);
    snapAnimator.setDuration(220);
    // slight overshoot sells the "magnetic edge" without needing physics libs
    snapAnimator.setInterpolator(new OvershootInterpolator(1.2f));
    snapAnimator.addUpdateListener(
        new ValueAnimator.AnimatorUpdateListener() {
          @Override
          public void onAnimationUpdate(ValueAnimator animation) {
            if (bubble == null) return;
            layoutParams.x = (Integer) animation.getAnimatedValue();
            safeUpdateLayout();
          }
        });
    snapAnimator.start();
  }

  private void safeUpdateLayout() {
    // the view can be removed (HIDE intent) mid-gesture or mid-animation
    if (bubble != null && bubble.isAttachedToWindow() && windowManager != null) {
      try {
        windowManager.updateViewLayout(bubble, layoutParams);
      } catch (Exception ignored) {
        // detached between check and call — nothing to do
      }
    }
  }

  private void openApp() {
    Intent open =
        new Intent(this, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    // PendingIntent.send() instead of raw startActivity: with SAW granted this
    // is exempt from background-activity-launch restrictions on Q+
    PendingIntent pi =
        PendingIntent.getActivity(
            this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    try {
      pi.send();
    } catch (PendingIntent.CanceledException ignored) {
      // cancelled between creation and send — a dead tap, not worth surfacing
    }
  }

  // ---- state ----

  private void applyState(String state) {
    if (statusDot == null) return;
    stopPulse();
    GradientDrawable dot = (GradientDrawable) statusDot.getBackground();
    if (STATE_SPEAKING.equals(state)) {
      dot.setColor(COLOR_ROSE);
      startPulse();
    } else if (STATE_IDLE.equals(state)) {
      dot.setColor(COLOR_IDLE);
    } else {
      // default/unknown states read as "watching" — the bubble only exists
      // while a watch session runs, so green is the safe assumption
      dot.setColor(COLOR_GREEN);
    }
  }

  private void startPulse() {
    pulseAnimator = ValueAnimator.ofFloat(1f, 0.25f);
    pulseAnimator.setDuration(600);
    pulseAnimator.setRepeatCount(ValueAnimator.INFINITE);
    pulseAnimator.setRepeatMode(ValueAnimator.REVERSE);
    pulseAnimator.addUpdateListener(
        new ValueAnimator.AnimatorUpdateListener() {
          @Override
          public void onAnimationUpdate(ValueAnimator animation) {
            if (statusDot != null) statusDot.setAlpha((Float) animation.getAnimatedValue());
          }
        });
    pulseAnimator.start();
  }

  private void stopPulse() {
    if (pulseAnimator != null) {
      pulseAnimator.cancel();
      pulseAnimator = null;
    }
    if (statusDot != null) statusDot.setAlpha(1f);
  }

  private int dp(int dps) {
    return Math.round(dps * getResources().getDisplayMetrics().density);
  }

  // ---- teardown ----

  private void removeBubble() {
    stopPulse();
    if (snapAnimator != null) {
      snapAnimator.cancel();
      snapAnimator = null;
    }
    if (bubble != null && windowManager != null) {
      try {
        windowManager.removeView(bubble);
      } catch (Exception ignored) {
        // already gone (permission revoked kills overlays) — that's fine
      }
    }
    bubble = null;
    statusDot = null;
  }

  @Override
  public void onDestroy() {
    removeBubble();
    super.onDestroy();
  }
}
