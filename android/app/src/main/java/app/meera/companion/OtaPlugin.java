package app.meera.companion;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The web half's side of the updater.
 *
 * <p>{@link #markLaunchOk} is the one that matters: it is how a bundle earns
 * the right to keep running. Call it from the app as soon as the chat surface
 * has actually painted — not from a module top level, not from a effect that
 * runs before render, because the whole point is that it cannot fire in a
 * bundle that is broken. Until it arrives, every launch is provisional and two
 * silent ones roll the bundle back.
 *
 * <pre>
 *   import { Capacitor, registerPlugin } from "@capacitor/core";
 *   const Updater = registerPlugin("MeeraUpdater");
 *   // after first paint of the real UI
 *   if (Capacitor.isNativePlatform()) Updater.markLaunchOk().catch(() =&gt; {});
 * </pre>
 *
 * <p>There is a native fallback that confirms a launch if the page loaded and
 * something mounted (see OtaUpdater), so OTA works before the web app is
 * changed. It is weaker evidence than this call and is not the intended path.
 */
@CapacitorPlugin(name = "MeeraUpdater")
public class OtaPlugin extends Plugin {

  /** "I rendered." Idempotent; extra calls cost nothing. */
  @PluginMethod
  public void markLaunchOk(PluginCall call) {
    OtaUpdater.markLaunchOk(getContext());
    call.resolve();
  }

  /** What is running, what is staged, and why anything was refused. */
  @PluginMethod
  public void status(PluginCall call) {
    try {
      call.resolve(JSObject.fromJSONObject(OtaUpdater.status(getContext())));
    } catch (Exception e) {
      call.reject("status unavailable");
    }
  }

  /**
   * Check now instead of at the next cold start. {@code force: true} skips the
   * "is it newer / was it rolled back" refusals — it does NOT skip the sha256
   * check, the https requirement or min_native, which are not policy.
   */
  @PluginMethod
  public void check(PluginCall call) {
    if (getActivity() == null) {
      call.reject("no activity");
      return;
    }
    OtaUpdater.checkForUpdate(getActivity(), Boolean.TRUE.equals(call.getBoolean("force", false)));
    call.resolve();
  }
}
