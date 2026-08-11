package app.meera.companion;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Hashing and unpacking for an OTA web bundle. Like {@link OtaState} this has no
 * android imports: java.util.zip and java.security are the same classes on the
 * phone as off it, so these checks can be tested against real malicious zips
 * instead of argued about.
 *
 * <p>The order is load-bearing. The sha is verified against the manifest before
 * a single entry is read, so a bundle that is not byte-for-byte the one the
 * build produced never reaches the unzip code at all — a corrupted download and
 * a substituted one look identical here, and both are refused.
 */
final class OtaBundle {

  /** Bigger than the web app by ~10×. A manifest pointing at something huge is
   *  a mistake or an attack; either way we stop before filling the phone. */
  static final long MAX_ZIP_BYTES = 64L * 1024 * 1024;

  static final long MAX_UNPACKED_BYTES = 192L * 1024 * 1024;
  static final int MAX_ENTRIES = 8000;

  /** Refused, with the reason a human needs. Distinct from IOException so the
   *  caller can tell "the network died" from "this bundle is hostile". */
  static final class Rejected extends IOException {
    Rejected(String message) {
      super(message);
    }
  }

  private OtaBundle() {}

  static String sha256(File f) throws IOException {
    MessageDigest md;
    try {
      md = MessageDigest.getInstance("SHA-256");
    } catch (Exception e) {
      throw new IOException("no SHA-256", e);
    }
    InputStream in = new FileInputStream(f);
    try {
      byte[] buf = new byte[64 * 1024];
      int n;
      while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
    } finally {
      close(in);
    }
    byte[] d = md.digest();
    StringBuilder sb = new StringBuilder(d.length * 2);
    for (byte b : d) {
      sb.append(Character.forDigit((b >> 4) & 0xf, 16));
      sb.append(Character.forDigit(b & 0xf, 16));
    }
    return sb.toString();
  }

  /** Constant-time-ish, case-insensitive hex compare. */
  static boolean shaMatches(File f, String expected) throws IOException {
    if (expected == null || expected.length() != 64) return false;
    return sha256(f).equalsIgnoreCase(expected.trim());
  }

  /**
   * Validate one zip entry name against the destination it would be written to.
   *
   * <p>A zip entry name is attacker-controlled text that becomes a filesystem
   * path — {@code ../../../shared_prefs/x.xml} inside a zip is a write into
   * another app directory, and unzip code that just concatenates will perform
   * it. Two independent checks, because each has a known bypass: the textual
   * one catches encodings the canonical check would resolve away, the canonical
   * one catches anything the textual pass did not imagine.
   *
   * @return the file to write to
   * @throws Rejected if the entry would escape {@code destRoot}
   */
  static File resolveEntry(File destRoot, String name) throws IOException {
    if (name == null || name.isEmpty()) throw new Rejected("empty entry name");
    if (name.length() > 512) throw new Rejected("absurd entry name length");
    String n = name.replace('\\', '/');
    if (n.startsWith("/")) throw new Rejected("absolute entry: " + name);
    if (n.contains(":")) throw new Rejected("drive-qualified entry: " + name);
    if (n.indexOf('\0') >= 0) throw new Rejected("nul in entry: " + name);
    for (String seg : n.split("/")) {
      if (seg.equals("..")) throw new Rejected("path traversal in entry: " + name);
    }
    File out = new File(destRoot, n);
    String root = destRoot.getCanonicalPath();
    String path = out.getCanonicalPath();
    if (!path.equals(root) && !path.startsWith(root + File.separator)) {
      throw new Rejected("entry escapes bundle root: " + name);
    }
    return out;
  }

  /**
   * Unpack into a directory that must not already exist. The caller unpacks to a
   * scratch name and renames on success, so a half-written bundle is never a
   * bootable one.
   */
  static void unpack(File zip, File destRoot) throws IOException {
    if (zip.length() > MAX_ZIP_BYTES) throw new Rejected("bundle over size cap");
    if (destRoot.exists()) throw new Rejected("destination already exists");
    if (!destRoot.mkdirs()) throw new IOException("cannot create " + destRoot);

    long total = 0;
    int entries = 0;
    boolean sawIndex = false;
    ZipInputStream zin = new ZipInputStream(new FileInputStream(zip));
    try {
      ZipEntry e;
      while ((e = zin.getNextEntry()) != null) {
        if (++entries > MAX_ENTRIES) throw new Rejected("too many entries");
        File out = resolveEntry(destRoot, e.getName());
        if (e.isDirectory()) {
          if (!out.isDirectory() && !out.mkdirs()) throw new IOException("mkdir " + out);
          continue;
        }
        File parent = out.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
          throw new IOException("mkdir " + parent);
        }
        OutputStream os = new FileOutputStream(out);
        try {
          byte[] buf = new byte[64 * 1024];
          int n;
          while ((n = zin.read(buf)) > 0) {
            total += n;
            // The declared sizes in a zip are a claim, not a fact; only the
            // bytes actually written can bound a decompression bomb.
            if (total > MAX_UNPACKED_BYTES) throw new Rejected("bundle expands past cap");
            os.write(buf, 0, n);
          }
        } finally {
          close(os);
        }
        if (out.getParentFile() != null
            && out.getParentFile().equals(destRoot)
            && out.getName().equals("index.html")) {
          sawIndex = true;
        }
      }
    } finally {
      close(zin);
    }
    // Capacitor serves basePath + "/index.html" for "/". A bundle without one
    // is a white screen that would burn both boot attempts before rolling back,
    // and it costs one stat call to refuse it here instead.
    if (!sawIndex) throw new Rejected("no index.html at bundle root");
  }

  static void deleteTree(File f) {
    if (f == null || !f.exists()) return;
    File[] kids = f.listFiles();
    if (kids != null) for (File k : kids) deleteTree(k);
    // best effort: a file we cannot delete is litter, not a correctness problem
    f.delete();
  }

  private static void close(java.io.Closeable c) {
    if (c == null) return;
    try {
      c.close();
    } catch (IOException ignored) {}
  }
}
