package app.meera.companion;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(WatchPlugin.class);
    registerPlugin(CallMicPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
