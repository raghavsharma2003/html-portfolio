// Packs the built web app into an OTA bundle the Android app can fetch.
//
// Runs from scripts/vercel-build.sh straight after `vite build` and BEFORE the
// landing-page shuffle, because the shuffle renames dist/index.html to
// chat.html — and the phone's WebView loads "/" from the bundle root, so the
// app's own index.html has to still be sitting there when we zip.
//
// Emits, into the deployed site:
//   ota/meera-<version>.zip   the web root, exactly as assets/public looks
//   ota/latest.json           { version, sha256, url, min_native }
//
// The manifest is deliberately NOT inside the zip. It describes the zip — a
// document that contained its own hash could not be checked, and the phone has
// to be able to reject a bundle before it opens it.
//
//   node scripts/ota-bundle.mjs [--web dist] [--out dist/ota] [--base-url https://…]
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const WEB = path.resolve(ROOT, arg("web", "dist"));
const OUT = path.resolve(ROOT, arg("out", path.join(WEB, "ota")));
const BASE_URL = (
  arg("base-url", process.env.OTA_BASE_URL || "https://meera-silk.vercel.app")
).replace(/\/$/, "");

// Already-compressed bytes: deflating them costs time and gains nothing, and
// storing them keeps the zip byte-identical across zlib versions.
const STORE = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".woff", ".woff2", ".mp3", ".m4a", ".mp4", ".zip"]);

/* ── the number that decides whether a phone may run this bundle ────────── */

// Parsed from the same line the Java reads through BuildConfig. Two copies of
// this number would drift, and the failure mode of drift is a bundle applied to
// an APK that cannot run it — a crash on a device with no way back except a
// reinstall. One source, and a hard failure if it cannot be found.
function nativeContract() {
  const gradle = path.join(ROOT, "android/app/build.gradle");
  let text;
  try {
    text = fs.readFileSync(gradle, "utf8");
  } catch {
    throw new Error(
      `cannot read ${gradle}. The OTA manifest cannot be written without the native ` +
        `contract number, and guessing it is how a bundle reaches an APK that cannot run it.`,
    );
  }
  const m = text.match(/buildConfigField\s+"int"\s*,\s*"OTA_NATIVE_CONTRACT"\s*,\s*"(\d+)"/);
  if (!m) throw new Error(`OTA_NATIVE_CONTRACT not found in ${gradle}`);
  return Number(m[1]);
}

/* ── version ────────────────────────────────────────────────────────────── */

// <utc timestamp>-<first 7 of the bundle's own sha256>. The timestamp orders
// versions (the Android side compares the leading digit run numerically); the
// hash makes the name say what is in it, so two builds of the same tree are
// visibly the same bundle even when their timestamps differ. Commit time is
// preferred over build time so rebuilding a commit does not invent a new
// version out of nothing.
function stamp() {
  const fromEnv = process.env.SOURCE_DATE_EPOCH && Number(process.env.SOURCE_DATE_EPOCH);
  let epoch = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : null;
  if (epoch === null) {
    try {
      epoch = Number(execFileSync("git", ["show", "-s", "--format=%ct", "HEAD"], {
        cwd: ROOT,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString().trim());
    } catch {
      epoch = null;
    }
  }
  if (!Number.isFinite(epoch) || !epoch) epoch = Math.floor(Date.now() / 1000);
  const d = new Date(epoch * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

/* ── zip, written by hand ───────────────────────────────────────────────── */

// No zip library, and no shelling out to `zip` (not guaranteed on a build
// image). Writing the format directly also buys determinism: entries sorted,
// timestamps pinned, so identical input produces an identical sha256 and the
// phone can skip a bundle it is already running.

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const DOS_DATE = ((1980 - 1980) << 9) | (1 << 5) | 1; // 1980-01-01, the epoch zip understands
const DOS_TIME = 0;

function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const store = STORE.has(path.extname(e.name).toLowerCase());
    let method = 0;
    let body = e.data;
    if (!store) {
      const deflated = zlib.deflateRawSync(e.data, { level: 9 });
      if (deflated.length < e.data.length) {
        method = 8;
        body = deflated;
      }
    }
    const crc = crc32(e.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // utf-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by (MS-DOS/FAT, so no unix mode bits)
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += 30 + name.length + body.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

/* ── collect ────────────────────────────────────────────────────────────── */

function walk(dir, prefix, out, skip) {
  for (const name of fs.readdirSync(dir).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (skip.has(rel)) continue;
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);
    if (st.isDirectory()) walk(full, rel, out, skip);
    // Symlinks are followed by nobody here: a zip entry is a file's bytes, and
    // a link that resolves outside the web root would smuggle them in.
    else if (st.isFile()) out.push({ name: rel, data: fs.readFileSync(full) });
  }
  return out;
}

function main() {
  if (!fs.existsSync(path.join(WEB, "index.html"))) {
    throw new Error(
      `${WEB}/index.html is missing — run this straight after vite build, before ` +
        `index.html is renamed to chat.html for the website.`,
    );
  }
  const minNative = nativeContract();

  const skip = new Set([path.relative(WEB, OUT).split(path.sep).join("/")]);
  const entries = walk(WEB, "", [], skip);

  // `cap sync` puts these two beside the web files in assets/public, so a
  // faithful web root has them. Both are empty in this app (no Cordova plugins)
  // and the local server special-cases /cordova.js anyway, but a bundle that is
  // not a faithful copy of assets/public is a bundle whose differences nobody
  // is tracking.
  const capSrc = path.join(ROOT, "android/app/src/main/assets/public");
  for (const shim of ["cordova.js", "cordova_plugins.js"]) {
    if (entries.some((e) => e.name === shim)) continue;
    const from = path.join(capSrc, shim);
    entries.push({ name: shim, data: fs.existsSync(from) ? fs.readFileSync(from) : Buffer.alloc(0) });
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const zip = buildZip(entries);
  const sha256 = createHash("sha256").update(zip).digest("hex");
  const version = `${stamp()}-${sha256.slice(0, 7)}`;
  const file = `meera-${version}.zip`;

  fs.mkdirSync(OUT, { recursive: true });
  // Only one bundle per deploy is reachable anyway — each Vercel deployment has
  // its own files — so stale zips from a local run are just litter.
  for (const old of fs.readdirSync(OUT)) {
    if (/^meera-.*\.zip$/.test(old) && old !== file) fs.rmSync(path.join(OUT, old));
  }
  fs.writeFileSync(path.join(OUT, file), zip);

  const manifest = {
    version,
    sha256,
    url: `${BASE_URL}/ota/${file}`,
    min_native: minNative,
    bytes: zip.length,
    built_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(OUT, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");

  console.log(
    `ota: ${entries.length} files → ${file} (${(zip.length / 1e6).toFixed(2)} MB), ` +
      `min_native=${minNative}\nota: sha256 ${sha256}`,
  );
}

main();
