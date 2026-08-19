package app.meera.companion;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * WS-ANDROID-WATCH parity harness. NOT shipped in the APK — it lives in
 * evals/multimodal/java and is compiled only by native-gate.mjs, against the
 * REAL android/app/src/main/java/app/meera/companion/SceneReader.java (which
 * imports nothing from Android and so compiles standalone).
 *
 * <p>It exists because the native watch lane's geometry is a second
 * implementation of src/watch/scene.ts, and the whole recording guarantee on
 * Android rests on that twin refusing exactly what the TypeScript refuses.
 * Reading the two files side by side is not evidence; running the same frames
 * through both and diffing the wake sequences is.
 *
 * <p>Protocol — one tick per stdin line, single-sourced from the JS side so
 * neither implementation gets its own copy of the stimulus:
 *
 * <pre>
 *   R &lt;base64 of 1024 luma bytes&gt;   one detect tick with a new grid
 *   S                                 the screen did not redraw (ImageReader
 *                                     handed back null) -&gt; SceneReader.still()
 * </pre>
 *
 * Ticks are 120 ms apart, matching WatchCaptureService.DETECT_MS. Output is
 * one line per tick:
 *
 * <pre>
 *   &lt;at&gt; &lt;wakeName|none&gt; &lt;blank&gt; &lt;quiet&gt; &lt;preroll&gt; &lt;emit|-&gt;
 * </pre>
 *
 * The last column is what WatchCaptureService.emitShowWake would report to the
 * web layer for recording: the SHOW class name, or "-". It is computed here
 * from SceneReader.isShow and the same blank guard the service applies, and
 * native-gate.mjs additionally asserts against the service's source that those
 * are in fact the guards it applies, in that place.
 *
 * <p>noteWake() is called for every wake, exactly as WatchCaptureService does
 * on a wake that went out — the `wake-dedupe` ring is fed by this and must not
 * be starved, or the harness would measure a looser detector than ships.
 */
public final class SceneParity {

  private static final long DETECT_MS = 120;
  private static final long T0 = 1_000_000;

  public static void main(String[] args) throws Exception {
    SceneReader scene = new SceneReader();
    BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    StringBuilder outBuf = new StringBuilder();
    long at = T0;
    String line;
    while ((line = in.readLine()) != null) {
      line = line.trim();
      if (line.isEmpty()) continue;
      SceneReader.Out s;
      if (line.charAt(0) == 'S') {
        s = scene.still(at);
      } else {
        byte[] sig = Base64.getDecoder().decode(line.substring(2));
        if (sig.length != SceneReader.SIG_LEN) throw new IllegalArgumentException("bad grid");
        s = scene.read(sig, at);
      }
      int wake = s.wake;
      boolean blank = s.blank;
      boolean quiet = s.quiet;
      boolean preroll = s.preroll;
      String emit = "-";
      if (wake != SceneReader.WAKE_NONE) {
        // the service reports the wake only when it actually went out; here
        // every wake "goes out", which is the strictest case for the gate
        if (!blank && SceneReader.isShow(wake)) {
          String n = name(wake);
          if (n != null) emit = n;
        }
        scene.noteWake(wake, at);
      }
      outBuf
          .append(at)
          .append(' ')
          .append(wake == SceneReader.WAKE_NONE ? "none" : name(wake))
          .append(' ')
          .append(blank)
          .append(' ')
          .append(quiet)
          .append(' ')
          .append(preroll)
          .append(' ')
          .append(emit)
          .append('\n');
      at += DETECT_MS;
    }
    System.out.print(outBuf);
  }

  /** The TypeScript WakeClass spellings, so the two logs are directly
   *  comparable strings rather than two numbering schemes. */
  private static String name(int wake) {
    switch (wake) {
      case SceneReader.WAKE_START:
        return "start";
      case SceneReader.WAKE_SETTLE:
        return "settle";
      case SceneReader.WAKE_RESHOW:
        return "reshow";
      case SceneReader.WAKE_POINT:
        return "point";
      case SceneReader.WAKE_SWITCH:
        return "switch";
      case SceneReader.WAKE_ALONG:
        return "along";
      case SceneReader.WAKE_IDLE:
        return "idle";
      default:
        return null;
    }
  }
}
