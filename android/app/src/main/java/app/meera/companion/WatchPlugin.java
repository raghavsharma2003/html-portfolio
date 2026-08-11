package app.meera.companion;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;

import org.json.JSONObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Watch-together bridge. start() runs the system screen-capture consent
 * dialog (per-session by Android design), then launches the capture
 * foreground service; frames arrive in JS as "frame" events (base64 JPEG,
 * ~768px longest side). stop() tears the session down.
 */
@CapacitorPlugin(name = "Watch")
public class WatchPlugin extends Plugin {

  private static WatchPlugin active;

  @Override
  public void load() {
    active = this;
  }

  static void emitFrame(String base64Jpeg) {
    WatchPlugin p = active;
    if (p == null) return;
    JSObject data = new JSObject();
    data.put("data", base64Jpeg);
    p.notifyListeners("frame", data);
  }

  static void emitEvent(String event, JSONObject data) {
    WatchPlugin p = active;
    if (p == null) return;
    try {
      p.notifyListeners(event, JSObject.fromJSONObject(data));
    } catch (Exception ignored) {}
  }

  static void emitStopped() {
    WatchPlugin p = active;
    if (p == null) return;
    p.notifyListeners("stopped", new JSObject());
  }

  @PluginMethod
  public void start(PluginCall call) {
    // the loop needs API 29+ (mediaProjection FGS type, channel notifications,
    // AudioFocusRequest); minSdk is 24, so gate here instead of crashing there
    if (android.os.Build.VERSION.SDK_INT < 29) {
      call.reject("watch together needs Android 10 or newer");
      return;
    }
    MediaProjectionManager mpm =
        (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
    if (mpm == null) {
      call.reject("screen capture unavailable");
      return;
    }
    startActivityForResult(call, mpm.createScreenCaptureIntent(), "onConsentResult");
  }

  @ActivityCallback
  private void onConsentResult(PluginCall call, ActivityResult result) {
    if (call == null) return;
    if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
      call.reject("consent denied");
      return;
    }
    Intent svc = new Intent(getContext(), WatchCaptureService.class);
    svc.putExtra(WatchCaptureService.EXTRA_RESULT_CODE, result.getResultCode());
    svc.putExtra(WatchCaptureService.EXTRA_RESULT_DATA, result.getData());
    String cfg = call.getString("config");
    if (cfg != null) svc.putExtra(WatchCaptureService.EXTRA_CONFIG, cfg);
    getContext().startForegroundService(svc);
    call.resolve();
  }

  @PluginMethod
  public void ensureOverlay(PluginCall call) {
    boolean granted = android.provider.Settings.canDrawOverlays(getContext());
    boolean prompt = Boolean.TRUE.equals(call.getBoolean("prompt", true));
    if (!granted && prompt) {
      // SAW is a settings toggle, not a runtime dialog — send them there once
      Intent i =
          new Intent(
              android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
              android.net.Uri.parse("package:" + getContext().getPackageName()));
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(i);
    }
    JSObject r = new JSObject();
    r.put("granted", granted);
    call.resolve(r);
  }

  /** Is a capture session running? The service outlives the WebView, so a
   *  reloaded web layer needs a way to find (and kill) an orphaned engine
   *  before it starts a second one on top of it. */
  @PluginMethod
  public void state(PluginCall call) {
    JSObject r = new JSObject();
    r.put("active", WatchCaptureService.isSessionActive());
    call.resolve(r);
  }

  /** The look-away: stop sending frames without ending the share. A person
   *  who needs three seconds of privacy should not have to kill the session
   *  and re-do the whole consent dance — in practice that means they simply
   *  never share again. While this is on, nothing is encoded and nothing
   *  enters the socket, so the existing "no wake without a delivered frame"
   *  rule makes her politely blind for free. USER-INITIATED ONLY. */
  @PluginMethod
  public void setPrivate(PluginCall call) {
    WatchCaptureService.setPrivate(Boolean.TRUE.equals(call.getBoolean("on", false)));
    call.resolve();
  }

  @PluginMethod
  public void stop(PluginCall call) {
    getContext().stopService(new Intent(getContext(), WatchCaptureService.class));
    call.resolve();
  }
}
