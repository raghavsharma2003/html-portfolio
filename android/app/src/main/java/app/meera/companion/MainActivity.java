package app.meera.companion;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(WatchPlugin.class);
    registerPlugin(CallMicPlugin.class);
    super.onCreate(savedInstanceState);
    // Capacitor installs its own WebChromeClient inside super.onCreate. Swap
    // in the one that grants an already-held mic without a trip through the
    // ActivityResult machinery — see MicPermissionFastPath for why that hop
    // costs the live call. It MUST happen here, still inside onCreate: the
    // parent class registers an ActivityResultLauncher in its constructor,
    // and that is only legal before the activity reaches STARTED.
    Bridge b = getBridge();
    WebView wv = b != null ? b.getWebView() : null;
    if (wv != null) {
      wv.setWebChromeClient(new MicPermissionFastPath(b));
    }
  }
}
