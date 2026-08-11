package app.meera.companion;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.webkit.PermissionRequest;

import androidx.core.content.ContextCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

import java.util.ArrayList;
import java.util.List;

/**
 * The live call's microphone is the WEBVIEW's own getUserMedia — not the
 * native CallMic pipe, which only serves the cascade fallback. So the one
 * piece of native code on the realtime answer path is this: the WebView's
 * capture-permission callback.
 *
 * Capacitor's default routes EVERY capture request through an
 * ActivityResultLauncher, including the overwhelmingly common case where
 * RECORD_AUDIO is already held. RequestMultiplePermissions returns a
 * synchronous result there, but ActivityResultRegistry still delivers it via
 * a Handler post — so the WebView cannot begin opening the capture device
 * until the main thread drains one more message. At call start that thread is
 * the busiest it ever is (React mount, the ring animation, the greet/recall/
 * backchannel fetches all landing), so the hop is not free.
 *
 * When every Android permission the request implies is ALREADY granted, this
 * grants inline on the callback itself. Nothing about WHAT is granted
 * changes: the same resources, gated on the same checkSelfPermission calls,
 * in the same order. A request that would need a real prompt falls straight
 * through to Capacitor untouched — the permission UX is not ours to own.
 *
 * It also stamps the handshake, because `micMs` in the connect telemetry is
 * one number covering three unrelated things (browser IPC, this permission
 * round trip, and the audio device open) and there was no way to tell which
 * one was slow. Timestamps are System.currentTimeMillis so JS can subtract
 * its own Date.now() directly. Nothing about the audio itself is recorded.
 */
public class MicPermissionFastPath extends BridgeWebChromeClient {

  // Written on the main thread (onPermissionRequest), read from the plugin
  // bridge thread — volatile is enough for three independent scalars that are
  // only ever read as a best-effort snapshot.
  private static volatile long reqAt = 0;
  private static volatile long grantAt = 0;
  private static volatile boolean fast = false;
  private static volatile int count = 0;

  private final Context ctx;

  public MicPermissionFastPath(Bridge bridge) {
    super(bridge);
    // BridgeWebChromeClient keeps its Bridge private, and this runs before
    // any WebView callback, so hold the context we need for the checks.
    this.ctx = bridge.getContext();
  }

  @Override
  public void onPermissionRequest(final PermissionRequest request) {
    final long t0 = System.currentTimeMillis();
    final String[] resources = request.getResources();
    final List<String> needed = new ArrayList<>();
    boolean audio = false;
    for (String r : resources) {
      if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
        // exactly the pair Capacitor maps this resource to
        needed.add(Manifest.permission.MODIFY_AUDIO_SETTINGS);
        needed.add(Manifest.permission.RECORD_AUDIO);
        audio = true;
      } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) {
        needed.add(Manifest.permission.CAMERA);
      }
    }
    if (audio) {
      reqAt = t0;
      grantAt = 0;
      fast = false;
      count++;
    }
    for (String p : needed) {
      if (ContextCompat.checkSelfPermission(ctx, p) != PackageManager.PERMISSION_GRANTED) {
        // a real prompt is owed — Capacitor owns that flow, untouched
        super.onPermissionRequest(request);
        return;
      }
    }
    try {
      request.grant(resources);
    } catch (Exception e) {
      // grant() can throw if the request was already answered or the frame
      // went away; falling back would double-answer it, so just drop
      return;
    }
    if (audio) {
      fast = true;
      grantAt = System.currentTimeMillis();
    }
  }

  /** Best-effort snapshot of the last AUDIO capture handshake. */
  static long lastRequestAt() {
    return reqAt;
  }

  static long lastGrantAt() {
    return grantAt;
  }

  static boolean lastWasFast() {
    return fast;
  }

  /** How many audio capture requests this process has served — a second one
   *  inside a call means the numbers above belong to a different grab. */
  static int requestCount() {
    return count;
  }
}
