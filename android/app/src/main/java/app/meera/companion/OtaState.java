package app.meera.companion;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The rollback state machine, and nothing else.
 *
 * <p>Every android import is deliberately absent here. This class decides which
 * web root the app boots from, which makes it the one piece of the updater that
 * can brick the product on someone's phone, and the only honest way to test
 * that is to run it — which means it has to compile and run without a device.
 * State arrives and leaves as a plain string map: SharedPreferences on the
 * phone, a HashMap in the test.
 *
 * <p>The model is a chain of slots, head first:
 *
 * <pre>   trial → current → previous → (built-in assets)</pre>
 *
 * The assets floor is not a slot. It is what is left when the chain empties, it
 * shipped inside the APK, and it is therefore always bootable — that is the
 * whole safety argument and nothing in here is allowed to weaken it.
 *
 * <p>Every boot of a non-floor root spends an attempt. A launch that signals it
 * rendered clears the count and promotes the trial. A head that spends
 * {@link #MAX_BOOT_ATTEMPTS} without signalling is dropped, blacklisted, and
 * the next slot down gets its own two attempts. Nothing here ever writes into
 * the assets floor, so the worst reachable outcome is the app the APK shipped
 * with.
 */
final class OtaState {

  /** Two, not one: the first failure could be an OOM kill or a flat battery. */
  static final int MAX_BOOT_ATTEMPTS = 2;

  /** How many failed versions we remember, so a bad bundle is not re-downloaded
   *  forever. Small on purpose — it is a bounded pref string, not a database. */
  private static final int BAD_MEMORY = 8;

  /** A version string becomes a directory name under filesDir and is compared
   *  with string ordering. It arrives from the network, so it is validated to
   *  the character rather than trusted: no separators, no dots-only names. */
  static boolean validVersion(String v) {
    if (v == null || v.isEmpty() || v.length() > 64) return false;
    for (int i = 0; i < v.length(); i++) {
      char c = v.charAt(i);
      boolean ok =
          (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
              || c == '.' || c == '_' || c == '-';
      if (!ok) return false;
    }
    return !v.equals(".") && !v.equals("..");
  }

  /**
   * Versions are {@code <utc-timestamp>-<sha7>} (see scripts/ota-bundle.mjs), so
   * the leading digit run orders them chronologically and the rest only breaks
   * ties. Comparing the digit run numerically rather than the whole string
   * keeps the ordering correct if the timestamp ever changes width.
   */
  static boolean isNewer(String candidate, String incumbent) {
    if (incumbent == null || incumbent.isEmpty()) return true;
    if (candidate == null || candidate.isEmpty()) return false;
    long a = leadingNumber(candidate);
    long b = leadingNumber(incumbent);
    if (a != b) return a > b;
    return candidate.compareTo(incumbent) > 0;
  }

  private static long leadingNumber(String s) {
    int i = 0;
    while (i < s.length() && s.charAt(i) >= '0' && s.charAt(i) <= '9') i++;
    if (i == 0) return -1L;
    // 19 digits would overflow a long; a timestamp is 14. Clamp rather than throw.
    if (i > 18) i = 18;
    return Long.parseLong(s.substring(0, i));
  }

  /** One installed-or-pending web bundle. */
  static final class Slot {
    final String version;
    final String path;
    final String sha;

    Slot(String version, String path, String sha) {
      this.version = version == null ? "" : version;
      this.path = path == null ? "" : path;
      this.sha = sha == null ? "" : sha;
    }
  }

  /** What a boot decided, including the directories it is now safe to delete. */
  static final class Boot {
    /** null means the built-in assets floor. */
    final String rootPath;
    final String version;
    final List<String> discard;
    final String reason;

    Boot(String rootPath, String version, List<String> discard, String reason) {
      this.rootPath = rootPath;
      this.version = version;
      this.discard = discard;
      this.reason = reason;
    }
  }

  Slot trial;
  Slot current;
  Slot previous;
  Slot staged;
  int attempts;
  String nativeVersion = "";
  final List<String> bad = new ArrayList<String>();

  /* ── persistence ───────────────────────────────────────────────────── */

  static OtaState load(Map<String, String> m) {
    OtaState s = new OtaState();
    s.trial = readSlot(m, "trial");
    s.current = readSlot(m, "current");
    s.previous = readSlot(m, "previous");
    s.staged = readSlot(m, "staged");
    s.nativeVersion = str(m, "native");
    String a = str(m, "attempts");
    try {
      s.attempts = a.isEmpty() ? 0 : Integer.parseInt(a);
    } catch (NumberFormatException e) {
      s.attempts = 0;
    }
    String badList = str(m, "bad");
    if (!badList.isEmpty()) {
      for (String v : badList.split(",")) if (!v.isEmpty()) s.bad.add(v);
    }
    return s;
  }

  Map<String, String> save() {
    Map<String, String> m = new HashMap<String, String>();
    writeSlot(m, "trial", trial);
    writeSlot(m, "current", current);
    writeSlot(m, "previous", previous);
    writeSlot(m, "staged", staged);
    m.put("native", nativeVersion);
    m.put("attempts", Integer.toString(attempts));
    StringBuilder sb = new StringBuilder();
    for (String v : bad) {
      if (sb.length() > 0) sb.append(',');
      sb.append(v);
    }
    m.put("bad", sb.toString());
    return m;
  }

  private static String str(Map<String, String> m, String k) {
    String v = m.get(k);
    return v == null ? "" : v;
  }

  private static Slot readSlot(Map<String, String> m, String prefix) {
    String v = str(m, prefix + ".v");
    String p = str(m, prefix + ".p");
    if (v.isEmpty() || p.isEmpty()) return null;
    return new Slot(v, p, str(m, prefix + ".s"));
  }

  private static void writeSlot(Map<String, String> m, String prefix, Slot s) {
    m.put(prefix + ".v", s == null ? "" : s.version);
    m.put(prefix + ".p", s == null ? "" : s.path);
    m.put(prefix + ".s", s == null ? "" : s.sha);
  }

  /* ── the machine ───────────────────────────────────────────────────── */

  Slot head() {
    if (trial != null) return trial;
    if (current != null) return current;
    return previous;
  }

  /**
   * Forget slots whose directory is no longer on disk.
   *
   * <p>This app has {@code allowBackup="true"}, so Android can restore these
   * preferences onto a phone where filesDir was never written — a chain
   * pointing at bundles that do not exist. Storage pressure can also delete
   * them. Without this the boot would hand Capacitor a dead path, the local
   * server would 404 every request, and two launches later a perfectly good
   * version would be blacklisted for a failure that was never its fault.
   */
  void pruneMissing(java.util.function.Predicate<String> exists) {
    boolean lostHead = head() != null && !exists.test(head().path);
    if (trial != null && !exists.test(trial.path)) trial = null;
    if (current != null && !exists.test(current.path)) current = null;
    if (previous != null && !exists.test(previous.path)) previous = null;
    if (staged != null && !exists.test(staged.path)) staged = null;
    if (current == null && previous != null) {
      current = previous;
      previous = null;
    }
    if (lostHead) attempts = 0;
  }

  /**
   * Decide this boot's web root. Call once, before the WebView exists.
   *
   * @param nativeVersion versionCode:versionName of the installed APK. A change
   *     means a reinstall, and a reinstall re-couples web and native: every
   *     bundle on disk was built against Java that is no longer here, so the
   *     chain is dropped and the floor — which shipped with this APK — wins.
   *     Capacitor's own Bridge clears its serverBasePath on the same condition,
   *     so this keeps our bookkeeping and its behaviour telling the same story.
   */
  Boot boot(String nativeVersion) {
    List<String> discard = new ArrayList<String>();
    String reason;

    if (!nativeVersion.equals(this.nativeVersion)) {
      addPath(discard, trial);
      addPath(discard, current);
      addPath(discard, previous);
      addPath(discard, staged);
      trial = current = previous = staged = null;
      attempts = 0;
      this.nativeVersion = nativeVersion;
      reason = "new native binary — back to built-in assets";
      return new Boot(null, "", discard, reason);
    }

    if (trial == null && staged != null) {
      trial = staged;
      staged = null;
      attempts = 0;
    }

    reason = "boot";
    while (head() != null && attempts >= MAX_BOOT_ATTEMPTS) {
      Slot dead = head();
      blacklist(dead.version);
      addPath(discard, dead);
      demote();
      attempts = 0;
      reason = "rolled back " + dead.version + " after " + MAX_BOOT_ATTEMPTS + " silent boots";
    }

    Slot h = head();
    if (h == null) return new Boot(null, "", discard, reason);
    attempts++;
    return new Boot(h.path, h.version, discard, reason);
  }

  private void demote() {
    if (trial != null) {
      trial = null;
      return;
    }
    if (current != null) {
      current = previous;
      previous = null;
      return;
    }
    previous = null;
  }

  /**
   * The web layer rendered. Clears the attempt count and, if this boot was a
   * trial, makes it the current bundle. The bundle it replaces is kept as the
   * one to fall back to; the one before that is deleted, so at most two OTA
   * trees plus the floor ever sit on disk.
   */
  List<String> confirm() {
    List<String> discard = new ArrayList<String>();
    if (trial != null) {
      addPath(discard, previous);
      previous = current;
      current = trial;
      trial = null;
    }
    attempts = 0;
    return discard;
  }

  /**
   * The launch ended before it could be judged — opened and dismissed inside the
   * confirm window. Without this, two impatient taps in a row look exactly like
   * two crashes and blacklist a bundle that was never broken. Give the attempt
   * back; a real failure still has every subsequent launch to show itself.
   */
  void abandon() {
    if (attempts > 0) attempts--;
  }

  /** Coming back to an unresolved launch: the attempt {@link #abandon()} gave
   *  back is spent again, so a bundle cannot dodge judgement by being paused. */
  void spendAttempt() {
    attempts++;
  }

  /** Refusal reason, or null if this bundle may be staged. */
  String refuseStage(String version, String sha, int minNative, int nativeContract) {
    if (!validVersion(version)) return "version is not a safe name";
    if (minNative > nativeContract) {
      return "needs native contract " + minNative + ", this APK is " + nativeContract;
    }
    if (bad.contains(version)) return "version already rolled back once";
    Slot h = head();
    if (h != null && !sha.isEmpty() && sha.equalsIgnoreCase(h.sha)) return "already running this bundle";
    if (staged != null && staged.version.equals(version)) return "already staged";
    if (h != null && !isNewer(version, h.version)) return "not newer than " + h.version;
    return null;
  }

  /** Park a verified, unpacked bundle for the next launch. Returns dirs to bin. */
  List<String> stage(Slot s) {
    List<String> discard = new ArrayList<String>();
    if (staged != null && !staged.path.equals(s.path)) addPath(discard, staged);
    staged = s;
    return discard;
  }

  private void blacklist(String version) {
    bad.remove(version);
    bad.add(version);
    while (bad.size() > BAD_MEMORY) bad.remove(0);
  }

  private static void addPath(List<String> out, Slot s) {
    if (s != null && !s.path.isEmpty() && !out.contains(s.path)) out.add(s.path);
  }

  /** Paths still referenced by the chain — anything else under the OTA dir is litter. */
  List<String> livePaths() {
    List<String> live = new ArrayList<String>();
    for (Slot s : Arrays.asList(trial, current, previous, staged)) addPath(live, s);
    return live;
  }
}
