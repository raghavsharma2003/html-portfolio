package app.meera.companion;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
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

  static void emitStopped() {
    WatchPlugin p = active;
    if (p == null) return;
    p.notifyListeners("stopped", new JSObject());
  }

  @PluginMethod
  public void start(PluginCall call) {
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
    getContext().startForegroundService(svc);
    call.resolve();
  }

  @PluginMethod
  public void stop(PluginCall call) {
    getContext().stopService(new Intent(getContext(), WatchCaptureService.class));
    call.resolve();
  }
}
