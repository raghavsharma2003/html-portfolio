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
    registerPlugin(OtaPlugin.class);
    // Which web root this launch uses is decided HERE, before the Bridge is
    // built, because the Bridge reads it exactly once during construction.
    // Deciding afterwards means setServerBasePath, which reloads the WebView
    // out from under a running app — a white screen at best and her session
    // restarting mid-conversation at worst. See OtaUpdater.
    OtaUpdater.selectWebRootForThisBoot(this);
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
    OtaUpdater.attach(this, b);
  }

  @Override
  public void onStart() {
    super.onStart();
    OtaUpdater.onActivityStarted(this);
  }

  @Override
  public void onStop() {
    // A launch dismissed before the render signal is not a vote against the
    // bundle; the updater hands the attempt back rather than counting it.
    OtaUpdater.onActivityStopped(this);
    super.onStop();
  }
}
