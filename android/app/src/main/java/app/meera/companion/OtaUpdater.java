package app.meera.companion;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.CapConfig;
import com.getcapacitor.PluginConfig;
import com.getcapacitor.WebViewListener;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

import org.json.JSONObject;

/**
 * Over-the-air updates for the web half of the app.
 *
 * <p>The WebView is served by Capacitor's local server, which can host either
 * the APK's own assets or a directory under filesDir ({@code hostFiles}). An OTA
 * update is therefore nothing more exotic than: fetch a zip, verify it, unpack
 * it, and point the server at it on the NEXT launch. No third-party plugin is
 * involved — the Bridge already exposes everything this needs.
 *
 * <p>Two rules shape the whole file:
 *
 * <ol>
 *   <li><b>Never swap the web root under a running app.</b>
 *       {@code setServerBasePath} calls {@code loadUrl} immediately, which tears
 *       down a live session mid-sentence and reboots her state machine on top of
 *       itself. The choice is therefore made before the Bridge exists, by
 *       writing the same SharedPreference the Bridge reads during construction,
 *       and it takes effect on the next cold start.
 *   <li><b>The built-in assets are a floor that nothing can remove.</b> Every
 *       failure path in here ends at the APK's own web app, which is the one
 *       thing on the device that cannot have been fetched from the network.
 * </ol>
 *
 * @see OtaState for the rollback machine, which is pure and separately tested.
 */
final class OtaUpdater {

  private static final String TAG = "MeeraOTA";

  /** Our own prefs. Capacitor's serverBasePath is derived from this, never the
   *  other way round: it is a mechanism, this is the record. */
  private static final String PREFS = "meera_ota";

  private static final String DEFAULT_MANIFEST = "https://meera-silk.vercel.app/ota/latest.json";

  /** How long after page load the native fallback waits before deciding the app
   *  rendered. The real signal is the web app calling markLaunchOk(); this is
   *  the floor for a bundle whose JS never does. */
  private static final long CONFIRM_FALLBACK_MS = 3_500;

  private static final ExecutorService IO = Executors.newSingleThreadExecutor();
  private static final AtomicBoolean checking = new AtomicBoolean(false);

  /** Every read-modify-write of the stored state goes through this. The boot
   *  decision, the render signal and the download thread all touch the same
   *  prefs, and a lost update here means an attempt that was never counted or a
   *  confirmation that was silently undone. */
  private static final Object LOCK = new Object();

  private static volatile OtaState.Boot booted;
  private static final AtomicBoolean resolved = new AtomicBoolean(false);
  private static volatile boolean attemptReturned;
  private static Handler main;
  private static Runnable pendingProbe;
  private static volatile String lastError = "";

  private OtaUpdater() {}

  /* ── boot ──────────────────────────────────────────────────────────── */

  /**
   * Choose this launch's web root. MUST be called from MainActivity.onCreate
   * BEFORE super.onCreate: the Bridge reads the base path once, while it is
   * being constructed, and there is no second chance that does not cost a
   * reload.
   */
  static void selectWebRootForThisBoot(Activity activity) {
    // A recreated activity in a live process must not spend a second attempt on
    // the same launch — and it does not need to: the Bridge it builds reads the
    // same pref and lands on the same root.
    if (booted != null) return;
    try {
      SharedPreferences prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
      OtaState.Boot boot;
      OtaState state;
      synchronized (LOCK) {
        state = OtaState.load(toMap(prefs));
        state.pruneMissing(path -> new File(path, "index.html").isFile());
        boot = state.boot(nativeVersion(activity));
        SharedPreferences.Editor e = prefs.edit();
        for (Map.Entry<String, String> kv : state.save().entrySet()) e.putString(kv.getKey(), kv.getValue());
        // commit, not apply: if the process dies between here and the render, the
        // attempt this launch just spent has to have been counted. An uncounted
        // attempt is an infinite retry loop on a bundle that kills the app.
        e.commit();
      }
      booted = boot;

      SharedPreferences cap =
          activity.getSharedPreferences(
              com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, Context.MODE_PRIVATE);
      cap.edit()
          .putString(
              com.getcapacitor.plugin.WebView.CAP_SERVER_PATH,
              boot.rootPath == null ? "" : boot.rootPath)
          .commit();

      Log.i(TAG, "boot: " + boot.reason + " root=" + (boot.rootPath == null ? "assets" : boot.version));
      final List<String> bin = boot.discard;
      final File otaRoot = otaRoot(activity);
      final List<String> live = state.livePaths();
      IO.execute(
          new Runnable() {
            @Override
            public void run() {
              for (String p : bin) OtaBundle.deleteTree(new File(p));
              sweep(otaRoot, live);
            }
          });
    } catch (Throwable t) {
      // A crash in the updater must never be a crash in the app. Leave the
      // Capacitor pref untouched on the way out only if we never wrote it; the
      // floor is still reachable by clearing it, which is what this does.
      Log.e(TAG, "boot selection failed — falling back to built-in assets", t);
      try {
        activity
            .getSharedPreferences(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, "")
            .commit();
      } catch (Throwable ignored) {}
    }
  }

  /**
   * Wire the render signal and kick off the background check. Call after
   * super.onCreate, once the Bridge exists.
   */
  static void attach(final Activity activity, Bridge bridge) {
    main = new Handler(Looper.getMainLooper());
    // Did the Bridge actually take the root we chose? It reads our preference
    // but skips it under conditions of its own (a binary it thinks is new, a
    // path it cannot see), and a launch serving the built-in assets must not
    // credit a trial bundle that never ran — nor be counted against it. Give
    // the attempt back and let the next launch decide honestly.
    boolean tookOurRoot =
        bridge != null && bootedOntoBundle() && booted.rootPath.equals(bridge.getServerBasePath());
    if (bridge != null && bootedOntoBundle() && !tookOurRoot) {
      Log.w(TAG, "bridge is serving " + bridge.getServerBasePath() + ", not " + booted.rootPath);
      resolved.set(true);
      editState(activity, s -> s.abandon());
    }
    if (tookOurRoot) {
      bridge.addWebViewListener(
          new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
              armFallback(activity, webView);
            }

            @Override
            public void onReceivedError(WebView webView) {
              // A failed main resource is not a rendered app. Say nothing and
              // let the attempt lapse — the rollback is the reaction.
              cancelFallback();
            }

            @Override
            public boolean onRenderProcessGone(WebView webView, android.webkit.RenderProcessGoneDetail detail) {
              cancelFallback();
              return false;
            }
          });
    }
    checkForUpdate(activity, false);
  }

  private static boolean bootedOntoBundle() {
    return booted != null && booted.rootPath != null;
  }

  /* ── the render signal ─────────────────────────────────────────────── */

  /**
   * The web layer says it is alive. Idempotent, and safe to call on every
   * launch — on a bundle that is already current it just resets the counter,
   * which is exactly what "it still works" should mean.
   */
  static void markLaunchOk(Context ctx) {
    if (!resolved.compareAndSet(false, true)) return;
    cancelFallback();
    try {
      SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
      final List<String> bin;
      synchronized (LOCK) {
        OtaState state = OtaState.load(toMap(prefs));
        bin = state.confirm();
        SharedPreferences.Editor e = prefs.edit();
        for (Map.Entry<String, String> kv : state.save().entrySet()) e.putString(kv.getKey(), kv.getValue());
        e.commit();
      }
      Log.i(TAG, "launch confirmed");
      IO.execute(
          new Runnable() {
            @Override
            public void run() {
              for (String p : bin) OtaBundle.deleteTree(new File(p));
            }
          });
    } catch (Throwable t) {
      Log.e(TAG, "confirm failed", t);
    }
  }

  /**
   * The native fallback. The web app calling markLaunchOk() is the signal this
   * was designed around; this exists so that a bundle whose JS does not call it
   * is not condemned by silence alone. It is deliberately weak evidence —
   * "something mounted and the page did not error" — and it is checked late.
   */
  private static void armFallback(final Activity activity, final WebView webView) {
    if (main == null || resolved.get()) return;
    cancelFallback();
    pendingProbe =
        new Runnable() {
          @Override
          public void run() {
            if (resolved.get()) return;
            try {
              webView.evaluateJavascript(
                  "(function(){try{var r=document.getElementById('root');"
                      + "return !!(r&&r.childElementCount>0);}catch(e){return false;}})()",
                  value -> {
                    if ("true".equals(value)) markLaunchOk(activity);
                    else Log.w(TAG, "fallback probe: nothing rendered");
                  });
            } catch (Throwable t) {
              Log.w(TAG, "fallback probe failed", t);
            }
          }
        };
    main.postDelayed(pendingProbe, CONFIRM_FALLBACK_MS);
  }

  private static void cancelFallback() {
    if (main != null && pendingProbe != null) main.removeCallbacks(pendingProbe);
    pendingProbe = null;
  }

  /**
   * The launch is going away before it could be judged. An app opened and
   * dismissed inside the confirm window is not evidence against a bundle, and
   * without this two impatient taps look identical to two crashes and blacklist
   * a version that was never broken.
   */
  static void onActivityStopped(Context ctx) {
    if (resolved.get() || !bootedOntoBundle() || attemptReturned) return;
    cancelFallback();
    attemptReturned = true;
    editState(ctx, s -> s.abandon());
  }

  /** Coming back to an unresolved launch re-spends the attempt it gave back. */
  static void onActivityStarted(final Activity activity) {
    if (resolved.get() || !bootedOntoBundle() || !attemptReturned) return;
    attemptReturned = false;
    editState(activity, s -> s.spendAttempt());
    Bridge b = activity instanceof com.getcapacitor.BridgeActivity
        ? ((com.getcapacitor.BridgeActivity) activity).getBridge()
        : null;
    WebView wv = b != null ? b.getWebView() : null;
    if (wv != null) armFallback(activity, wv);
  }

  /* ── the check ─────────────────────────────────────────────────────── */

  /**
   * Fetch the manifest and, if it describes a bundle this APK may run, download
   * it, verify it and stage it for the next launch. Everything here happens off
   * the main thread and every failure is silent to the user: an update that
   * does not arrive is the app they already have.
   */
  static void checkForUpdate(final Activity activity, final boolean force) {
    final Context app = activity.getApplicationContext();
    if (!checking.compareAndSet(false, true)) return;
    IO.execute(
        new Runnable() {
          @Override
          public void run() {
            try {
              // Reading capacitor.config.json is file I/O, and this is called
              // from onCreate — it belongs on this thread, not that one.
              if (!enabled(app)) return;
              runCheck(app, manifestUrl(app), force);
            } catch (Throwable t) {
              lastError = String.valueOf(t.getMessage());
              Log.w(TAG, "update check failed", t);
            } finally {
              checking.set(false);
            }
          }
        });
  }

  private static void runCheck(Context ctx, String manifestUrl, boolean force) throws Exception {
    if (!manifestUrl.startsWith("https://")) throw new SecurityException("manifest must be https");
    OkHttpClient client =
        new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            // A redirect that changes protocol is the one thing an update path
            // must not follow: it is how https://…/latest.json becomes a plain
            // http fetch that anyone on the wifi can rewrite.
            .followSslRedirects(false)
            .build();

    JSONObject manifest;
    Response r = client.newCall(new Request.Builder().url(manifestUrl).get().build()).execute();
    try {
      if (!r.isSuccessful()) throw new java.io.IOException("manifest http " + r.code());
      ResponseBody body = r.body();
      manifest = new JSONObject(body == null ? "" : body.string());
    } finally {
      r.close();
    }

    String version = manifest.optString("version", "");
    String sha = manifest.optString("sha256", "").trim();
    String url = manifest.optString("url", "");
    int minNative = manifest.optInt("min_native", 0);

    // Mandatory gates. `force` skips policy — "is it newer", "was it rolled back
    // before" — and nothing below, because none of these are policy: the version
    // becomes a directory name, min_native is the only thing standing between an
    // old APK and a bundle that calls Java it does not have, and a bundle fetched
    // over plaintext is a bundle chosen by whoever owns the wifi.
    if (!OtaState.validVersion(version)) throw new SecurityException("unsafe version name");
    if (sha.length() != 64) throw new SecurityException("manifest has no usable sha256");
    if (!url.startsWith("https://")) throw new SecurityException("bundle url must be https");
    if (minNative > BuildConfig.OTA_NATIVE_CONTRACT) {
      // The one refusal the owner has to act on, and invisible otherwise.
      Log.i(TAG, "bundle " + version + " needs native contract " + minNative + " — reinstall required");
      lastError = "needs a newer APK (native contract " + minNative + ")";
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
          .edit()
          .putString("blocked.v", version)
          .putString("blocked.min", Integer.toString(minNative))
          .apply();
      return;
    }

    SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    OtaState state;
    synchronized (LOCK) {
      state = OtaState.load(toMap(prefs));
    }
    String refusal = state.refuseStage(version, sha, minNative, BuildConfig.OTA_NATIVE_CONTRACT);
    if (refusal != null && !force) {
      Log.i(TAG, "not staging " + version + ": " + refusal);
      lastError = refusal;
      return;
    }

    File cache = new File(ctx.getCacheDir(), "ota");
    if (!cache.isDirectory() && !cache.mkdirs()) throw new java.io.IOException("no cache dir");
    File zip = new File(cache, version + ".zip");
    OtaBundle.deleteTree(zip);

    Response dl = client.newCall(new Request.Builder().url(url).get().build()).execute();
    try {
      if (!dl.isSuccessful()) throw new java.io.IOException("bundle http " + dl.code());
      ResponseBody body = dl.body();
      if (body == null) throw new java.io.IOException("empty bundle body");
      InputStream in = body.byteStream();
      OutputStream out = new FileOutputStream(zip);
      try {
        byte[] buf = new byte[64 * 1024];
        long total = 0;
        int n;
        while ((n = in.read(buf)) > 0) {
          total += n;
          if (total > OtaBundle.MAX_ZIP_BYTES) throw new OtaBundle.Rejected("bundle over size cap");
          out.write(buf, 0, n);
        }
      } finally {
        out.close();
      }
    } finally {
      dl.close();
    }

    // Before unpacking, not after: an unpacked bundle has already written
    // hundreds of attacker-chosen files by the time a later check could object.
    if (!OtaBundle.shaMatches(zip, sha)) {
      OtaBundle.deleteTree(zip);
      throw new SecurityException("sha256 mismatch for " + version);
    }

    File dest = new File(otaRoot(ctx), version);
    if (state.livePaths().contains(dest.getAbsolutePath())) {
      // Reachable only through force: the directory about to be cleared is the
      // one the WebView is serving from right now, and emptying it is a white
      // screen in the middle of a conversation.
      OtaBundle.deleteTree(zip);
      lastError = "version " + version + " is already installed";
      Log.i(TAG, "refusing to re-unpack a bundle that is in use: " + version);
      return;
    }
    File scratch = new File(otaRoot(ctx), version + ".unpacking");
    OtaBundle.deleteTree(scratch);
    OtaBundle.deleteTree(dest);
    try {
      OtaBundle.unpack(zip, scratch);
      if (!scratch.renameTo(dest)) throw new java.io.IOException("cannot publish bundle dir");
    } catch (Throwable t) {
      OtaBundle.deleteTree(scratch);
      throw t instanceof Exception ? (Exception) t : new Exception(t);
    } finally {
      OtaBundle.deleteTree(zip);
    }

    final List<String> bin;
    synchronized (LOCK) {
      // Re-read. The download took seconds, and in that time the launch may have
      // confirmed or been abandoned; writing back the state we captured before
      // it would quietly undo that.
      state = OtaState.load(toMap(prefs));
      String late = state.refuseStage(version, sha, minNative, BuildConfig.OTA_NATIVE_CONTRACT);
      if (late != null && !force) {
        Log.i(TAG, "not staging " + version + " after download: " + late);
        OtaBundle.deleteTree(dest);
        lastError = late;
        return;
      }
      bin = state.stage(new OtaState.Slot(version, dest.getAbsolutePath(), sha));
      SharedPreferences.Editor e = prefs.edit();
      for (Map.Entry<String, String> kv : state.save().entrySet()) e.putString(kv.getKey(), kv.getValue());
      e.putString("blocked.v", "").commit();
    }
    for (String p : bin) OtaBundle.deleteTree(new File(p));
    lastError = "";
    Log.i(TAG, "staged " + version + " — applies on next launch");
  }

  /* ── status ────────────────────────────────────────────────────────── */

  static JSONObject status(Context ctx) {
    JSONObject o = new JSONObject();
    try {
      SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
      OtaState state = OtaState.load(toMap(prefs));
      OtaState.Slot h = state.head();
      o.put("running", booted == null || booted.rootPath == null ? "builtin" : booted.version);
      o.put("current", state.current == null ? "" : state.current.version);
      o.put("trial", state.trial == null ? "" : state.trial.version);
      o.put("staged", state.staged == null ? "" : state.staged.version);
      o.put("previous", state.previous == null ? "" : state.previous.version);
      o.put("attempts", state.attempts);
      o.put("confirmed", resolved.get());
      o.put("nativeContract", BuildConfig.OTA_NATIVE_CONTRACT);
      o.put("blockedByNative", prefs.getString("blocked.v", ""));
      o.put("head", h == null ? "" : h.version);
      o.put("lastError", lastError);
    } catch (Exception ignored) {}
    return o;
  }

  /* ── plumbing ──────────────────────────────────────────────────────── */

  private interface Mutation {
    void apply(OtaState s);
  }

  private static void editState(Context ctx, Mutation m) {
    try {
      SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
      synchronized (LOCK) {
        OtaState state = OtaState.load(toMap(prefs));
        m.apply(state);
        SharedPreferences.Editor e = prefs.edit();
        for (Map.Entry<String, String> kv : state.save().entrySet()) e.putString(kv.getKey(), kv.getValue());
        e.commit();
      }
    } catch (Throwable t) {
      Log.w(TAG, "state edit failed", t);
    }
  }

  private static Map<String, String> toMap(SharedPreferences prefs) {
    Map<String, String> m = new HashMap<String, String>();
    for (Map.Entry<String, ?> e : prefs.getAll().entrySet()) {
      Object v = e.getValue();
      if (v instanceof String) m.put(e.getKey(), (String) v);
    }
    return m;
  }

  private static File otaRoot(Context ctx) {
    return new File(ctx.getFilesDir(), "ota");
  }

  /** Delete bundle dirs the chain no longer references — an interrupted unpack
   *  or a version demoted while its files were in use leaves one behind. */
  private static void sweep(File root, List<String> live) {
    File[] kids = root.listFiles();
    if (kids == null) return;
    for (File k : kids) {
      if (!live.contains(k.getAbsolutePath())) OtaBundle.deleteTree(k);
    }
  }

  private static String nativeVersion(Context ctx) {
    try {
      PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
      return pi.versionCode + ":" + (pi.versionName == null ? "" : pi.versionName);
    } catch (Exception e) {
      return "unknown";
    }
  }

  /**
   * The manifest URL lives in capacitor.config.json, which is read from the
   * APK's assets and is NOT part of an OTA bundle. That is deliberate: an
   * update must not be able to repoint the updater at a different origin.
   */
  private static PluginConfig config(Context ctx) {
    return CapConfig.loadDefault(ctx).getPluginConfiguration("MeeraUpdater");
  }

  private static String manifestUrl(Context ctx) {
    try {
      return config(ctx).getString("manifestUrl", DEFAULT_MANIFEST);
    } catch (Throwable t) {
      return DEFAULT_MANIFEST;
    }
  }

  private static boolean enabled(Context ctx) {
    try {
      return config(ctx).getBoolean("enabled", true);
    } catch (Throwable t) {
      return true;
    }
  }
}
