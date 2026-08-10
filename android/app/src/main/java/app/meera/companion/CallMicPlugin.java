package app.meera.companion;

import android.Manifest;
import android.content.pm.PackageManager;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS bridge for the beep-free continuous mic (PipedRecognizer). One session
 * spans the whole call: partials stream up as "micpartial", recognizer
 * segment boundaries as "micsegment", and a fatal downgrade as "micerror" —
 * the web layer then falls back to its legacy recognizer path.
 */
@CapacitorPlugin(name = "CallMic")
public class CallMicPlugin extends Plugin {

  private PipedRecognizer piped;

  @PluginMethod
  public void available(PluginCall call) {
    JSObject r = new JSObject();
    boolean mic =
        ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED;
    r.put("supported", PipedRecognizer.supported(getContext()));
    r.put("micGranted", mic);
    call.resolve(r);
  }

  @PluginMethod
  public void start(PluginCall call) {
    if (!PipedRecognizer.supported(getContext())) {
      call.reject("piped recognition unsupported");
      return;
    }
    if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
        != PackageManager.PERMISSION_GRANTED) {
      // the web layer's legacy path owns the permission prompt UX
      call.reject("mic permission missing");
      return;
    }
    if (piped != null) {
      call.resolve(); // already live — one session per call is the contract
      return;
    }
    piped =
        new PipedRecognizer(
            getContext(),
            new PipedRecognizer.Callbacks() {
              @Override
              public void onPartial(String cumulativeText) {
                JSObject d = new JSObject();
                d.put("text", cumulativeText);
                notifyListeners("micpartial", d);
              }

              @Override
              public void onSegment(String text) {
                JSObject d = new JSObject();
                d.put("text", text);
                notifyListeners("micsegment", d);
              }

              @Override
              public void onDown(boolean fatal) {
                JSObject d = new JSObject();
                d.put("fatal", fatal);
                notifyListeners("micerror", d);
                if (fatal) piped = null;
              }
            });
    piped.start();
    call.resolve();
  }

  @PluginMethod
  public void setMuted(PluginCall call) {
    PipedRecognizer p = piped; // onDown nulls the field asynchronously
    if (p != null) p.setMuted(Boolean.TRUE.equals(call.getBoolean("muted", false)));
    call.resolve();
  }

  @PluginMethod
  public void stop(PluginCall call) {
    if (piped != null) {
      piped.stop();
      piped = null;
    }
    call.resolve();
  }

  @Override
  protected void handleOnDestroy() {
    if (piped != null) {
      piped.stop();
      piped = null;
    }
  }
}
