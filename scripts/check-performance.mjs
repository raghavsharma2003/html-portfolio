// PERFORMANCE BUDGET GATE.
//
// WHY THIS EXISTS. Nothing in this repo, before WS-R49, measured what a
// follower on a mid-range Android phone on a busy cell tower actually waits
// for. "India-first" is stated as a product law and nothing checked it. This
// gate renders the REAL built output of the four public entry points in a
// real browser, under CPU and network throttling shaped like a bad Indian 4G
// day, and fails the build by name and by metric when a page misses a budget
// a person would notice.
//
// WHAT IT MEASURES, AND HOW
// ---------------------------------------------------------------------------
// `npx vite build` must already have produced `dist/` (this file does not
// build it — `web build` runs earlier in scripts/verify-release.mjs, and this
// gate is registered after it for exactly that reason; run standalone, it
// fails by prerequisite name rather than silently skipping a release check).
//
// A plain Node static server on 127.0.0.1:8932 (never 8931 — the layout gate
// owns that port, and colliding with a sibling worktree's run of it produces
// an EADDRINUSE that reads exactly like a real regression) serves the built
// tree. Two of the four targets are static, no-build-step marketing pages
// that live in `site/`, not in `vite.config.ts`'s rollup inputs, so this
// server falls back to `site/` for any path `dist/` does not have — this is
// how `site/index.html` reaches `/styles.css` and `/assets/*`, which only
// `scripts/vercel-build.sh`'s production copy step would otherwise place next
// to it. Nothing here mutates `dist/` or `site/` on disk.
//
// Chromium is driven over CDP (`/opt/pw-browsers/chromium-1194/chrome-linux/
// chrome`, resolved the same way check-layout.mjs resolves it — never
// `playwright install`, PLAYWRIGHT_BROWSERS_PATH is set for us). Each of the
// three runs per target gets its OWN browser context, which is what makes
// "cold cache" true of every run rather than only the first: a fresh context
// has never fetched anything.
//
// THE THROTTLING SHAPE, AND WHERE THE NUMBERS COME FROM. CPU: 4x slowdown
// (`Emulation.setCPUThrottlingRate`). Network: 1.6 Mbps down / 750 Kbps up /
// 150 ms RTT (`Network.emulateNetworkConditions`). These three numbers are the
// long-standing Chrome DevTools / Lighthouse "Fast 3G" simulated-throttling
// preset, not a bespoke guess — Lighthouse published it first and WebPageTest
// and web.dev have reused it since as the standard stand-in for a busy,
// contended Indian 4G connection: on a crowded urban tower, achieved 4G
// throughput regularly falls into "fast 3G" territory, which is exactly why a
// named "Fast 3G" number is the honest choice here rather than a clean "4G"
// figure that would understate a real bad day. Anyone's actual phone can, and
// eventually will, disagree with a simulated profile — that disagreement IS
// the reversal condition for the budgets below, logged as a decision in
// context/decisions.md rather than assumed away.
//
// METRICS. LCP and CLS come from buffered PerformanceObserver entries read
// back after the page settles (`largest-contentful-paint`, `layout-shift`
// summed where `!hadRecentInput`) — both injected via `page.addInitScript`,
// which runs before any script on the page, including an inline `<head>`
// script (site/index.html has one). TBT is approximated as the sum of
// `max(0, duration - 50)` over every `longtask` PerformanceObserver entry for
// the whole run — a simplification of the real FCP-to-TTI window (this file
// has no interaction to bound TTI against), named here rather than presented
// as more precise than it is. Transfer bytes per resource type and the
// render-blocking count come from the CDP `Network` domain
// (`encodedDataLength` on `Network.loadingFinished`, matched by requestId,
// which is the actual over-the-wire byte count the throttle above measures
// against — a `content-length` header would read the uncompressed size) and
// from `PerformanceResourceTiming.renderBlockingStatus`, a real Chromium API
// that answers "did this delay first paint" without a hand-rolled heuristic
// for async/defer/media-query guessing.
//
// FONTS. Studio imports local Geist, Instrument Sans and Noto Devanagari
// packages in src/studio/personalMain.tsx. The 120 KB ceiling counts completed
// transfers; zero bytes alone does not prove that no fonts were requested or
// that text finished rendering. Missing LCP is a measurement failure, never
// a fast-paint result. Font transfer remains diagnostic, not a required floor.
//
// THE NEGATIVE SPACE THIS GATE DOES NOT COVER, STATED PLAINLY: it measures
// four representative screens, not the full follower/creator journey; it
// runs on THIS machine's CPU under an emulated 4x slowdown, which is a model
// of a mid-range Android, not a device this session can hold; and "cold
// cache" here means a browser context that has never fetched these exact
// files, not a first-ever visit to a domain with DNS and TLS setup costs a
// real network adds. A real-device measurement that disagrees with any
// number here is exactly what should change the budget, not this script.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { loadavg } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
// WS-R59: the installable Room's own Chromium check — worker registration,
// precache completeness, and no `/api/` URL ever cached — folded into THIS
// gate's pass/fail as one more target rather than a new named gate (see
// `scripts/check-install.mjs`'s own header). It runs on its own server, on
// its own port (8935, never 8931 or 8932), so it neither shares nor
// conflicts with anything below.
import { runInstallCheck } from "./check-install.mjs";
import { installHindiInterfaceProbe } from "./performance-hindi-interface.mjs";
import { createPerformanceNetworkAccounting } from "./performance-network-accounting.mjs";

function rootFromModuleUrl(moduleUrl) {
  return fileURLToPath(new URL("..", moduleUrl));
}

const ROOT = rootFromModuleUrl(import.meta.url);
const DIST = join(ROOT, "dist");
const SITE = join(ROOT, "site");
const PORT = 8932;
const VIEWPORT = { width: 390, height: 844 };
const RUNS = 3;

const THROTTLE = {
  latencyMs: 150,
  downloadBps: (1.6 * 1024 * 1024) / 8, // 1.6 Mbps
  uploadBps: (750 * 1024) / 8, // 750 Kbps
  cpuRate: 4,
};

// One table, named as the gate's own claim. A miss here names the target AND
// the metric — never a bare "FAIL".
const BUDGETS = {
  lcpMs: 2500,
  cls: 0.1,
  tbtMs: 300,
  jsBytes: 180 * 1024,
  fontBytes: 120 * 1024,
};

// WS-R82, narrowed WS-R113. `context/decisions.md#studio-hindi-table-is-its-own-chunk`'s
// own reversal condition, never measured until now: "if a Hindi creator's
// first paint is measured to wait more than one throttled round trip for the
// chunk... preload the chunk... and re-measure; never raise the budget."
// 800ms is that "one throttled round trip" made concrete: the Hindi AUTH
// chunk (dist/assets/hiPersonalAuthCopy-*.js, WS-R113 — the sign-in screen's own
// two sections, `authGate` + `shell`; the whole table was `hiCopy-*.js`
// before this split) is comfortably under 40KB gzipped, and one HTTP round
// trip on this gate's own Fast-3G throttle (150ms RTT, 1.6Mbps down) comes
// to roughly 150ms handshake-equivalent latency plus well under 200ms of
// transfer time for a file this size — 800ms leaves headroom for TCP
// slow-start and JS parse/execute on a throttled CPU without hiding a real
// regression the way a lax budget would.
const HINDI_CHUNK_WAIT_BUDGET_MS = 800;

// WS-R91. The historical firstHindiPaintMs wire key measures the first Hindi
// DOM text mutation relative to first paint, not verified visible text paint.
// Keep that key for retained-result compatibility. Same 800ms budget as
// the chunk-wait metric above, for the same reason -- one throttled round
// trip for a chunk comfortably under 40KB gzipped, with headroom for parse
// and layout on a throttled CPU. Measured ALONGSIDE `hindiChunkWaitMs`,
// never in place of it: the chunk wait proves the CHUNK itself is fast: this
// tracks when Hindi DOM text appears, and the two can now
// diverge (a slow re-render after a fast chunk load would move this one
// without moving that one). Neither this marker nor chunk timing replaces LCP.
//
// 800 again as of WS-R113 (2026-09-05), closing the reversal condition
// `context/decisions.md#ws-r107-first-hindi-paint-budget-left-at-1000-under-session-contention`
// named: "three consecutive `--target studio-hi` batches measure under
// 700ms". Between 1000 (set at the wave-fifteen merge gate, 918ms median
// with the table imported whole) and here: WS-R107's `modulepreload`
// (wave sixteen) halved the wait but still measured 808/572/657ms, one of
// three over 700; WS-R113 (this wave) split the table itself so the
// sign-in screen's own chunk (`hiPersonalAuthCopy.ts`, `authGate` + `shell` only,
// ~40KB gzipped) is the ONE thing preloaded and awaited before paint,
// never the much larger rest of it. Three consecutive batches measured
// 595.8ms, 569.1ms, 533.3ms median — all comfortably under 700ms — and on
// a HEAVILY CONTENDED machine (`uptime` load average 11.6-13.9 across all
// three batches, multiple sibling `verify-release.mjs`/`check-layout.mjs`
// runs and their own Chromium processes concurrently in `ps aux`, never
// the quiet machine the reversal condition asked for because none was
// available in this session's window) — see
// `context/measurements.md#ws-r113-first-hindi-paint-after-the-auth-rest-split-2026-09-05`.
// A budget this far under its own worst single run (974ms, batch 2's own
// outlier, still comfortably under the OLD 1000ms budget) even under
// contention is not a wish; a genuinely idle re-run would be expected to
// measure lower still.
const FIRST_HINDI_PAINT_BUDGET_MS = 800;

/** Finds the built Hindi AUTH chunk (`dist/assets/hiPersonalAuthCopy-<hash>.js`,
 *  WS-R113 — the sign-in screen's own two sections, `authGate` + `shell`)
 *  by filename prefix rather than a hardcoded hash — content hashes change
 *  on every edit to `src/studio/hiPersonalAuthCopy.ts`, and this gate must survive
 *  that without a manual update. This is the chunk `studio-hi`'s own
 *  target (`/studio?lang=hi`, SIGNED OUT) actually fetches — a signed-out
 *  visit never touches `hiCopy.ts`, the much larger rest of the table,
 *  which only loads once a session exists (`context/decisions.md#ws-r113-hindi-chunk-splits-into-an-auth-section-and-a-rest-section`).
 *  Returns the URL PATH the static server below serves it at, or null if
 *  `dist/` was built before the WS-R113 chunk split (an environmental
 *  state the caller reports by name, never silently). */
function findHiPersonalAuthCopyChunkPath() {
  let names;
  try {
    names = readdirSync(join(DIST, "assets"));
  } catch {
    return null;
  }
  const hit = names.find((n) => n.startsWith("hiPersonalAuthCopy-") && n.endsWith(".js"));
  return hit ? `/assets/${hit}` : null;
}

// The four public entry points named in the brief. The Room's real `room.html`
// needs a live, signed-in follower session this gate has no secret for — the
// same wall scripts/check-layout.mjs's own header documents — so, exactly as
// that gate does, `/r/<slug>` is measured through `room-layout-fixture.html`:
// the REAL RoomApp component tree, fixture data, no network. `?screen=join`
// (rather than the fixture's own default of `talk`) is deliberate: cold cache
// models a first-ever visit, and `join` — the disclosure card, the age line,
// the whole memory question — is what a follower's phone actually renders the
// first time, not a conversation that presupposes one already happened.
const TARGETS = [
  { name: "/", path: "/", label: "site landing (site/index.html)" },
  { name: "/vyakti", path: "/vyakti", label: "Vyakti landing (site/vyakti.html)" },
  // WS-R139: the shared 180KB `BUDGETS.jsBytes` ceiling below is set for the
  // WORST target (`index-*.js`'s own review-queue-adjacent weight), and
  // leaving the Room at that same ceiling would hide a real regression on
  // the one screen every follower's phone renders cold, every time. `jsBudget`
  // below is a PER-TARGET override (`evaluateBudgets` reads
  // `result.jsBudget ?? BUDGETS.jsBytes`) — never a global change, so no
  // other target's pass/fail moves. Measured 3 batches of 3 runs, before this
  // workstream's `React.lazy` split and after, same machine, same method
  // (`context/measurements.md#ws-r139-room-secondary-screens-js-bytes-2026-09-05`):
  // BEFORE 90,762 bytes (identical across all 3 batches — this render is
  // deterministic, no data variance); AFTER (English) 80,230 bytes, all 3
  // batches identical; AFTER (Hindi, `room-hi` below) 86,916 bytes, all 3
  // batches identical (the final 13-byte difference from an earlier
  // in-session reading is `switchLocale`'s own WS-R139 fix, below, awaiting
  // the copy chunk before committing a live locale switch). 100KB and 105KB
  // are round numbers roughly 20-25%
  // above each measured figure — enough that ordinary future growth (a new
  // field on an existing screen) does not need a budget PR, while a
  // regression the size of the whole split being reverted (adding back
  // ~10.5KB) still trips the gate by name rather than hiding inside 180KB of
  // headroom no one would notice for months.
  { name: "/r/<slug>", path: "/r/anjali?screen=join", label: "Room join screen (room-layout-fixture.html data)", jsBudget: 100 * 1024 },
  // `studio-hi`'s own reason, restated for the Room. Splitting the Room's
  // Hindi table into its own chunks (`src/room/copy.ts`'s own header —
  // `hiTalkCopy.ts`/`hiCopy.ts`) must cost an ENGLISH follower nothing —
  // `/r/<slug>` above is what proves that — and must not make a HINDI
  // follower's own first paint materially worse than English's, which only
  // a target that actually renders `?lang=hi` can measure.
  // `room-layout-fixture.html`'s own `render()` awaits `loadRoomCopy("hi")`
  // before mounting for a `?lang=hi` request (`layoutFixture.tsx`'s own
  // header), which is the REAL cost this target measures — the same
  // fixture, the same `?screen=join` state, only the locale moves.
  { name: "room-hi", path: "/r/anjali?screen=join&lang=hi", label: "Room join screen, Hindi (room-layout-fixture.html data)", jsBudget: 105 * 1024 },
  // WS-R177: a per-target TBT ceiling, the same override shape WS-R139
  // already established for `jsBudget` above (`result.tbtBudget ?? BUDGETS.tbtMs`
  // in `evaluateBudgets`) — never a change to the SHARED 300ms budget, which
  // still governs the other six targets this workstream did not measure.
  // Set from `context/measurements.md#ws-r177-studio-tbt-on-a-quiet-machine-2026-09-13`:
  // n=12 (4 batches x 3 runs), load average 0.5-2.1 throughout (quiet, per
  // `ws-common.md`'s "load under 4"). `/studio` measured median 104.5ms,
  // p90 126ms, max 176ms — 220ms leaves 25% headroom over the worst
  // observed run, tight enough to catch a real regression long before it
  // reaches the old 300ms ceiling.
  { name: "/studio", path: "/studio", label: "Studio, signed out", tbtBudget: 220 },
  // WS-R82 built this target when the shell (chrome, AuthGate) rendered
  // identically to `/studio` regardless of `?lang=hi` — `StudioApp.tsx`'s
  // `AuthGate` sat BEFORE `StudioLocaleProvider` ever mounted, so no Hindi
  // text existed on the signed-out screen at all
  // (context/rejected.md#ws-r82-studio-hi-signed-out-entry-never-shows-hindi).
  // WS-R91 fixed that (AuthGate.tsx is its own file now, reading `t.` under
  // a provider mounted ABOVE the sign-in gate), so this screen genuinely
  // paints Hindi text today. The LCP/JS budgets below stay the SAME as
  // `/studio` regardless: splitting the Hindi table into its own chunk must
  // still cost the signed-out visitor NOTHING, and this target is what
  // proves that rather than assuming it. `hindiChunkWaitMs` measures how
  // long the Hindi chunk itself takes to become usable once something asks
  // for it; `firstHindiPaintMs` (WS-R91, historical wire key) measures the
  // first Devanagari DOM text mutation relative to first paint —
  // see `measureOnce`'s own comment for exactly what each captures and why
  // both are kept rather than one replacing the other.
  // WS-R177: same override, own number — Hindi DOM text costs `studio-hi`
  // roughly 60ms more TBT than `/studio` in the same measurement (Devanagari
  // layout/paint work `firstHindiPaintMs` already tracks separately). n=12
  // measured median 164.5ms, p90 176ms, max 205ms; 260ms leaves 27% headroom
  // over the worst observed run.
  { name: "studio-hi", path: "/studio?lang=hi", label: "Studio, signed out, Hindi (?lang=hi)", tbtBudget: 260 },
  // WS-R66: the creator's public page — a stranger's search result, cold
  // cache, on the same phone the four targets above already model. Static
  // server-rendered HTML with zero client script, so this target exists
  // mainly to prove that stays true rather than to catch a JS regression a
  // page with no bundle cannot have.
  { name: "/c/<slug>", path: "/c/anjali", label: "Creator public page (creator-page-fixture.html data)" },
  // WS-R97: the follower's transparency page -- server-rendered HTML with
  // zero client script, `/c/<slug>`'s own reason above restated a second
  // time. Measured with a dormancy policy SET on the fixture Room (never the
  // shorter no-policy render), so the budget is checked against the longer
  // of the two paths this page can render.
  { name: "/r/<slug>/about", path: "/r/anjali/about", label: "Follower transparency page (room-about-fixture.html data)" },
  // WS-R117: the Suite admin's transparency page -- server-rendered HTML
  // with zero client script, `/r/<slug>/about`'s own reason above restated
  // a second time.
  { name: "/suites/about", path: "/suites/about", label: "Suite admin transparency page (suites-about-fixture.html data)" },
];

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".woff2": "font/woff2",
  ".woff": "font/woff", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
};

function contentTypeFor(path) {
  return MIME[extname(path).toLowerCase()] || "application/octet-stream";
}

/** Resolves a URL pathname to a file, dist/ first then site/ as a fallback —
 *  this is how a no-build-step page in site/ reaches its own /styles.css and
 *  /assets/* without this gate copying anything onto disk. Special-cased
 *  routes are the ones this gate's own targets need and vercel.json would
 *  otherwise supply via a real rewrite this static server does not run. */
async function resolveFile(pathname) {
  if (pathname.includes("..")) return null; // no path traversal, even off loopback
  if (pathname === "/") return join(SITE, "index.html");
  if (pathname === "/vyakti") return join(SITE, "vyakti.html");
  if (pathname === "/studio") return join(DIST, "studio.html");
  if (pathname === "/suites/about") return join(DIST, "suites-about-fixture.html");
  if (pathname.startsWith("/r/") && pathname.endsWith("/about")) return join(DIST, "room-about-fixture.html");
  if (pathname.startsWith("/r/")) return join(DIST, "room-layout-fixture.html");
  if (pathname.startsWith("/c/")) return join(DIST, "creator-page-fixture.html");
  const rel = normalize(pathname.slice(1)).replace(/^(\.\.(\/|\\|$))+/, "");
  const distPath = join(DIST, rel);
  if (existsSync(distPath)) return distPath;
  const sitePath = join(SITE, rel);
  if (existsSync(sitePath)) return sitePath;
  return null;
}

// Vercel gzip/brotli-compresses every text asset it serves; a static server
// that hands back raw bytes would measure a JS budget against a number no
// phone on a real deployment ever downloads, and the whole point of this gate
// is the number a phone actually waits for. So text assets are gzipped here
// (Chromium always sends `Accept-Encoding: gzip` and decodes it transparently
// — CDP's `encodedDataLength`, which this gate reads, reports the COMPRESSED
// count, the true over-the-wire size the throttle above is shaping) and
// binary assets (images, already-compressed) are served as-is.
const COMPRESSIBLE = new Set([
  "text/html", "text/javascript", "text/css", "application/json",
  "image/svg+xml", "application/manifest+json",
]);

function serveApp() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      const file = await resolveFile(url.pathname);
      if (!file) { res.writeHead(404).end("not found"); return; }
      const type = contentTypeFor(file);
      const raw = await readFile(file);
      if (COMPRESSIBLE.has(type)) {
        const gz = gzipSync(raw, { level: 9 });
        res.writeHead(200, { "content-type": type, "content-encoding": "gzip" });
        res.end(gz);
      } else {
        res.writeHead(200, { "content-type": type });
        res.end(raw);
      }
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) => server.listen(PORT, "127.0.0.1", () => ok(server)));
}

function categorize(cdpType, url) {
  const ext = (url.split("?")[0].split(".").pop() || "").toLowerCase();
  if (cdpType === "Script" || ext === "js" || ext === "mjs") return "js";
  if (cdpType === "Stylesheet" || ext === "css") return "css";
  if (cdpType === "Font" || ["woff2", "woff", "ttf", "otf"].includes(ext)) return "font";
  if (cdpType === "Image" || ["jpg", "jpeg", "png", "svg", "webp", "gif", "ico"].includes(ext)) return "image";
  return "other";
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// A fixed post-network dwell can end before first contentful paint under
// throttling. Wait only for a missing observation, never rewrite its clock.
// This extends the longtask window by at most 2500ms in that case; TBT remains
// the whole-observed-run approximation described above, not a fixed window.
export async function readSettledPerformance(page) {
  let perf = await page.evaluate(() => window.__PERF__);
  if (perf?.lcpObserverSupported === true &&
      !(perf.lcpObserved === true && Number.isFinite(perf.lcp) && perf.lcp > 0)) {
    await page.waitForFunction(() => {
      const value = window.__PERF__;
      return value?.lcpObserved === true && Number.isFinite(value.lcp) && value.lcp > 0;
    }, null, { timeout: 2500 }).catch(() => {});
    perf = await page.evaluate(() => window.__PERF__);
  }
  return perf;
}

async function measureOnce(browser, target, diagnostics = false, profile = false) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: THROTTLE.latencyMs,
    downloadThroughput: THROTTLE.downloadBps,
    uploadThroughput: THROTTLE.uploadBps,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE.cpuRate });

  // WS-R82 built `hiChunkPath` (set ONLY for the `studio-hi` target) as a
  // PROXY, when the studio's signed-out entry never rendered a Hindi text
  // node at all — `StudioApp.tsx`'s `AuthGate` sat BEFORE
  // `StudioLocaleProvider` mounted (`context/rejected.md#ws-r82-studio-hi-signed-out-entry-never-shows-hindi`),
  // so `?lang=hi` on a signed-out visit changed nothing about what painted.
  // WS-R91 fixed that (`AuthGate.tsx` is its own file now, reading `t.`
  // under a provider mounted ABOVE the sign-in gate), so the proxy is no
  // longer the only available measurement — see `firstHindiPaintMs` below
  // for the DOM-text marker. This one still measures a real, useful, DIFFERENT
  // fact: how long the Hindi CHUNK itself takes to become usable once
  // anything asks for it, decoupled from render time. The instant the
  // English shell's own first paint fires, it starts a real `import()` of
  // the ACTUAL built chunk (found by `findHiPersonalAuthCopyChunkPath()`, never a
  // hand-typed filename that would drift from the real content hash) and
  // times how long that import takes to resolve, under the SAME
  // network/CPU throttle already active on this page. `hindiChunkWaitMs` is
  // that duration. WS-R113: the chunk this times is the AUTH chunk
  // (`hiPersonalAuthCopy-*.js`) — the only one a real signed-out `studio-hi` visit
  // ever fetches, the rest of the table (`hiCopy-*.js`) being loaded only
  // once a session exists.
  const hiChunkPath = target.name === "studio-hi" ? findHiPersonalAuthCopyChunkPath() : null;

  const pending = new Map(); // requestId -> { url, type }
  const networkAccounting = createPerformanceNetworkAccounting();
  cdp.on("Network.responseReceived", (e) => {
    pending.set(e.requestId, { url: e.response.url, type: e.type });
    networkAccounting.responseReceived();
  });
  cdp.on("Network.loadingFinished", (e) => {
    const r = pending.get(e.requestId);
    if (!r) return;
    const n = e.encodedDataLength || 0;
    // Hindi41's real signed-out AuthGate loads this chunk. Its separate
    // timing tally is now a subset of actual JS/total, not an exemption.
    const cat = categorize(r.type, r.url);
    networkAccounting.completed(cat, n, !!hiChunkPath && r.url.endsWith(hiChunkPath));
  });

  if (hiChunkPath) await page.addInitScript(installHindiInterfaceProbe);
  await page.addInitScript(({ chunkPath, diagnostics, profile }) => {
    // Public fixture diagnostics only: never retain text, query strings or credentials.
    const resourceName = (value) => {
      if (!value) return null;
      try { const u = new URL(value, location.href); return `${u.origin}${u.pathname.startsWith("/api/") ? "/api/[redacted]" : u.pathname}`; } catch { return null; }
    };
    window.__PERF__ = {
      lcp: null, lcpObserved: false, lcpObserverSupported: false,
      cls: 0, longtasks: [], firstPaintMs: null, hindiChunkWaitMs: null,
      firstHindiPaintMs: null,
      // Retain unavailable/cap/failure reasons even when readiness never fires.
      hindiVisibilityObservation: window.__VYAKTI_HINDI_INTERFACE_STATE__ ?? null,
      ...(diagnostics ? { diagnostic: {
        lcpEntries: [], longtasks: [], paintEntries: [], visibility: [], firstInputs: [], dateFormats: [],
      } } : {}),
    };
    if (diagnostics) {
      const markVisibility = () => window.__PERF__.diagnostic.visibility.push({
        startTime: performance.now(), state: document.visibilityState, focused: document.hasFocus(),
      });
      markVisibility();
      document.addEventListener("visibilitychange", markVisibility);
      for (const type of ["paint", "first-input"]) {
        if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
        new PerformanceObserver((list) => {
          const entries = list.getEntries().map(e => ({ name: e.name, startTime: e.startTime, duration: e.duration }));
          window.__PERF__.diagnostic[type === "paint" ? "paintEntries" : "firstInputs"].push(...entries);
        }).observe({ type, buffered: true });
      }
    }
    if (profile) {
      // Native Intl work is otherwise charged to the calling component in a
      // JS CPU profile. Retain durations only, never dates or formatted text.
      const formatDate = Date.prototype.toLocaleDateString;
      Date.prototype.toLocaleDateString = function (...args) {
        const startTime = performance.now();
        try { return Reflect.apply(formatDate, this, args); }
        finally { window.__PERF__.diagnostic.dateFormats.push({ startTime, duration: performance.now() - startTime }); }
      };
    }
    try {
      if (!PerformanceObserver.supportedEntryTypes.includes("largest-contentful-paint")) {
        throw new Error("LCP observer unsupported");
      }
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__PERF__.lcp = e.startTime;
          window.__PERF__.lcpObserved = true;
          if (diagnostics) window.__PERF__.diagnostic.lcpEntries.push({
            startTime: e.startTime, renderTime: e.renderTime, loadTime: e.loadTime, size: e.size,
            resource: resourceName(e.url),
            element: e.element ? { tag: e.element.tagName, id: e.element.id, classes: Array.from(e.element.classList) } : null,
          });
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
      window.__PERF__.lcpObserverSupported = true;
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__PERF__.cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__PERF__.longtasks.push(e.duration);
          if (diagnostics) window.__PERF__.diagnostic.longtasks.push({
            startTime: e.startTime, duration: e.duration, name: e.name,
            attribution: Array.from(e.attribution || [], a => ({ name: a.name, containerType: a.containerType, containerSrc: resourceName(a.containerSrc) })),
          });
        }
      }).observe({ type: "longtask", buffered: true });
    } catch {}
    if (chunkPath) {
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.name !== "first-paint" || window.__PERF__.firstPaintMs !== null) continue;
            window.__PERF__.firstPaintMs = e.startTime;
            const importStarted = performance.now();
            import(/* @vite-ignore */ chunkPath)
              .then(() => { window.__PERF__.hindiChunkWaitMs = performance.now() - importStarted; })
              .catch(() => { window.__PERF__.hindiChunkWaitMs = -1; }); // -1: the chunk itself failed to load, named rather than left as a silent null
          }
        }).observe({ type: "paint", buffered: true });
      } catch {}
      // Localized sign-in heading AND field label must be rendered. Hidden
      // logo glyphs and loading messages cannot satisfy this interface metric.
      // Renderer visibility arrives asynchronously (tracking minimum100ms).
      // Timestamp the callback now, never subtract that floor or backdate to
      // the entry timestamp. The800ms budget remains. Not a glyph/font test.
      try {
        const markIfHindi = () => {
          if (window.__PERF__.firstHindiPaintMs !== null) return true;
          if (window.__VYAKTI_HINDI_INTERFACE__?.()) {
            window.__PERF__.firstHindiPaintMs = performance.now();
            window.__PERF__.hindiVisibilityObservation = { ...window.__VYAKTI_HINDI_INTERFACE_STATE__ };
            window.__VYAKTI_HINDI_INTERFACE_STOP__?.();
            return true;
          }
          return false;
        };
        window.__VYAKTI_HINDI_INTERFACE_READY__ = markIfHindi;
        markIfHindi();
      } catch {}
    }
  }, { chunkPath: hiChunkPath, diagnostics, profile });

  let crashed = null;
  page.on("pageerror", (e) => { crashed = String(e.message || e).slice(0, 200); });

  // Opt-in attribution only. Profiling adds overhead, so its timings must not
  // be substituted for the ordinary release measurement.
  if (profile) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.start");
  }
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}${target.path}`, { waitUntil: "load", timeout: 45000 });
  // Under throttling, "load" fires well before the observers above have
  // finished settling. networkidle with a bounded timeout, then a fixed
  // dwell, is the same two-step every synthetic LCP tool uses in place of the
  // real finalization signal (a visibility change this headless run never
  // produces).
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const perf = await readSettledPerformance(page);
  // Freeze synchronously before any profile/diagnostic/cleanup await can
  // deliver later CDP events. This is a Node receipt boundary, not an
  // atomic browser/Node instant or proof of pending font completion.
  const networkReceipt = networkAccounting.snapshot();
  const wallMs = Date.now() - t0;
  const cpuProfile = profile ? (await cdp.send("Profiler.stop")).profile : null;
  if (cpuProfile) {
    // Public fixture source locations only; never retain URL query strings.
    for (const node of cpuProfile.nodes) {
      const value = node.callFrame.url;
      if (!value) continue;
      try {
        const url = new URL(value);
        node.callFrame.url = `${url.origin}${url.pathname.startsWith("/api/") ? "/api/[redacted]" : url.pathname}`;
      } catch { node.callFrame.url = ""; }
    }
  }
  const renderBlocking = await page.evaluate(() => {
    const entries = performance.getEntriesByType("resource");
    const blocking = entries.filter((e) => e.renderBlockingStatus === "blocking");
    return {
      count: blocking.length,
      thirdParty: blocking
        .filter((e) => { try { return new URL(e.name).host !== location.host; } catch { return false; } })
        .map((e) => e.name),
    };
  });

  const tbtMs = perf.longtasks.reduce((sum, d) => sum + Math.max(0, d - 50), 0);

  const diagnostic = diagnostics ? await page.evaluate(() => {
    const safeUrl = (value) => {
      try { const u = new URL(value); return `${u.origin}${u.pathname.startsWith("/api/") ? "/api/[redacted]" : u.pathname}`; } catch { return null; }
    };
    const timing = (e) => ({ resource: safeUrl(e.name), initiatorType: e.initiatorType || "navigation",
      startTime: e.startTime, duration: e.duration, fetchStart: e.fetchStart,
      requestStart: e.requestStart, responseStart: e.responseStart, responseEnd: e.responseEnd,
      transferSize: e.transferSize, encodedBodySize: e.encodedBodySize, decodedBodySize: e.decodedBodySize });
    return { ...window.__PERF__.diagnostic,
      navigation: performance.getEntriesByType("navigation").map(timing),
      resources: performance.getEntriesByType("resource").map(timing),
    };
  }) : null;
  if (diagnostic && cpuProfile) diagnostic.cpuProfile = cpuProfile;
  await context.close();

  return {
    ...(diagnostics ? { diagnostic } : {}),
    lcpMs: perf.lcp,
    lcpObserved: perf.lcpObserved,
    lcpObserverSupported: perf.lcpObserverSupported,
    cls: perf.cls,
    tbtMs,
    bytes: networkReceipt.bytes,
    requestCount: networkReceipt.requestCount,
    networkObservation: { boundary: networkReceipt.boundary, nodeReceivedAt: networkReceipt.nodeReceivedAt },
    renderBlocking,
    crashed,
    wallMs,
    hindiChunkBytes: networkReceipt.hindiChunkBytes,
    hindiVisibilityObservation: perf.hindiVisibilityObservation ?? null,
    firstPaintMs: perf.firstPaintMs,
    hindiChunkWaitMs: perf.hindiChunkWaitMs,
    // WS-R91. `null` if no Devanagari DOM text was observed (every target but
    // `studio-hi`, since `hiChunkPath` gates the observer above) or if it
    // appeared without a recorded first-paint entry. DOM mutation is not a
    // visibility or paint guarantee; a null is unavailable timing, not zero.
    firstHindiPaintMs:
      perf.firstHindiPaintMs !== null && perf.firstPaintMs !== null
        ? perf.firstHindiPaintMs - perf.firstPaintMs
        : null,
  };
}

async function measureTarget(browser, target, diagnostics = false, profile = false) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await measureOnce(browser, target, diagnostics, profile));
  const crashes = runs.filter((r) => r.crashed);
  // WS-R82. Only the `studio-hi` target sets this at all (`hiChunkPath` is
  // null everywhere else, so `hindiChunkWaitMs` stays `null` on every run);
  // `-1` on a run means the chunk import itself rejected, named apart from
  // "no measurement was attempted" rather than folded into the same bucket.
  const hindiChunkWaits = runs.map((r) => r.hindiChunkWaitMs).filter((v) => v !== null && v !== undefined);
  const hindiChunkFailed = hindiChunkWaits.some((v) => v === -1);
  // WS-R91. Same shape one metric over: `null` on every target but
  // `studio-hi` (the observer above only ever arms there), so an empty list
  // here means "not applicable", never "regressed to zero".
  const firstHindiPaints = runs.map((r) => r.firstHindiPaintMs).filter((v) => v !== null && v !== undefined);
  return {
    target: target.name,
    label: target.label,
    // WS-R139: per-target override of `BUDGETS.jsBytes`, undefined for
    // every target but the two Room ones — see `TARGETS`'s own comment.
    jsBudget: target.jsBudget,
    // WS-R177: the identical per-target override, threaded through for TBT
    // — undefined for every target but `/studio`/`studio-hi`. Missing this
    // line was a real bug this session's own full gate run caught: the
    // fixture tests in evals/performance-measurements.mjs set
    // `result.tbtBudget` directly on a hand-built object and so never
    // exercised the real `TARGETS` -> `measureTarget` -> `evaluateBudgets`
    // wiring, which silently fell back to the shared 300ms budget for
    // every real run. See `context/rejected.md#ws-r177-tbtbudget-never-reached-evaluatebudgets-through-measuretarget`.
    tbtBudget: target.tbtBudget,
    runs,
    median: {
      lcpMs: runs.every(validLcpMeasurement) ? median(runs.map((r) => r.lcpMs)) : null,
      cls: median(runs.map((r) => r.cls)),
      tbtMs: median(runs.map((r) => r.tbtMs)),
      jsBytes: median(runs.map((r) => r.bytes.js)),
      cssBytes: median(runs.map((r) => r.bytes.css)),
      fontBytes: median(runs.map((r) => r.bytes.font)),
      imageBytes: median(runs.map((r) => r.bytes.image)),
      otherBytes: median(runs.map((r) => r.bytes.other)),
      totalBytes: median(runs.map((r) => r.bytes.total)),
      requestCount: median(runs.map((r) => r.requestCount)),
      renderBlockingCount: median(runs.map((r) => r.renderBlocking.count)),
      hindiChunkWaitMs: hindiChunkWaits.length ? median(hindiChunkWaits.filter((v) => v !== -1)) : null,
      firstHindiPaintMs: firstHindiPaints.length ? median(firstHindiPaints) : null,
    },
    hindiChunkFailed,
    thirdPartyRenderBlocking: [...new Set(runs.flatMap((r) => r.renderBlocking.thirdParty))],
    crashed: crashes.length ? crashes[0].crashed : null,
  };
}

function validLcpMeasurement(run) {
  return run?.lcpObserved === true && run.lcpObserverSupported === true &&
    Number.isFinite(run.lcpMs) && run.lcpMs > 0;
}

function evaluateLcpMeasurements(runs) {
  if (!Array.isArray(runs) || runs.length !== RUNS) {
    return [{ metric: "LCP measurement", detail: `expected ${RUNS} observed runs` }];
  }
  return runs.flatMap((run, index) => validLcpMeasurement(run) ? [] : [{
    metric: "LCP measurement",
    detail: `run ${index + 1}: ${run?.lcpObserverSupported === false ? "observer unavailable" : "finite positive observed LCP missing"}`,
  }]);
}

// WS-R177. `loadAverage` (a single number, the 1-minute `os.loadavg()`
// reading `main()` took around the measurement loop — see its own comment)
// is OPTIONAL and defaults to `null`, so every existing call site and every
// fixture in `evals/performance-measurements.mjs` that calls
// `evaluateBudgets(result)` with one argument is byte-for-byte unaffected.
// When a caller DOES pass it, a TBT finding's `detail` carries it inline —
// "the check records the load average it ran under in its ... finding
// text" — because TBT is the one metric this repo has repeatedly measured
// as load-sensitive (`context/rejected.md`'s "TBT finding under load"
// pattern, named at least four times: WS-R86, WS-R93, WS-R153, the
// wave-22 merge gate) while LCP/JS/font/CLS have not shown the same
// pattern here. This never suppresses or softens the finding — the build
// still fails — it only makes a busy-machine result legible AS busy,
// rather than indistinguishable from a real regression.
function tbtFindingDetail(tbtMs, budget, loadAverage) {
  const base = `${Math.round(tbtMs)}ms > ${budget}ms budget`;
  if (loadAverage === null || loadAverage === undefined) return base;
  return `${base} (1-minute load average ${loadAverage.toFixed(2)} during this run — TBT is the metric this repo has repeatedly measured as load-sensitive; rerun on a quiet machine, load average under 4, before treating this as a regression)`;
}

export function evaluateBudgets(result, { loadAverage = null } = {}) {
  const m = result.median;
  // Validate every run: a good median must never hide an unobserved paint.
  const findings = evaluateLcpMeasurements(result.runs);
  if (result.crashed) {
    findings.push({ metric: "page error", detail: result.crashed });
    return findings;
  }
  if (m.lcpMs > BUDGETS.lcpMs) {
    findings.push({ metric: "LCP", detail: `${Math.round(m.lcpMs)}ms > ${BUDGETS.lcpMs}ms budget` });
  }
  if (m.cls > BUDGETS.cls) {
    findings.push({ metric: "CLS", detail: `${m.cls.toFixed(3)} > ${BUDGETS.cls} budget` });
  }
  // WS-R177: a target-specific ceiling (today only `/studio` and
  // `studio-hi`) wins over the shared one when set — the identical
  // `?? BUDGETS.<x>` override shape WS-R139 already established for
  // `jsBudget` just below, restated for TBT rather than inventing a second
  // pattern. `result.tbtBudget` is `undefined` on every other target, so
  // this is a no-op there.
  const tbtBudget = result.tbtBudget ?? BUDGETS.tbtMs;
  if (m.tbtMs > tbtBudget) {
    findings.push({ metric: "TBT", detail: tbtFindingDetail(m.tbtMs, tbtBudget, loadAverage) });
  }
  // WS-R139: a target-specific ceiling (the two Room targets) wins over the
  // shared one when set — `result.jsBudget` is `undefined` everywhere else,
  // so `?? BUDGETS.jsBytes` is a no-op for every other target.
  const jsBudget = result.jsBudget ?? BUDGETS.jsBytes;
  if (m.jsBytes > jsBudget) {
    findings.push({
      metric: "JS transfer",
      detail: `${(m.jsBytes / 1024).toFixed(1)}KB > ${(jsBudget / 1024).toFixed(0)}KB budget`,
    });
  }
  if (m.fontBytes > BUDGETS.fontBytes) {
    findings.push({
      metric: "font transfer",
      detail: `${(m.fontBytes / 1024).toFixed(1)}KB > ${(BUDGETS.fontBytes / 1024).toFixed(0)}KB budget`,
    });
  }
  if (result.thirdPartyRenderBlocking.length) {
    findings.push({
      metric: "render-blocking third party",
      detail: result.thirdPartyRenderBlocking.join(", "),
    });
  }
  // WS-R82, narrowed WS-R113. `studio-hi` only: three distinct,
  // separately-named outcomes, never folded into one bare pass/fail. A
  // `null` median with no failure means `findHiPersonalAuthCopyChunkPath()` itself
  // found nothing — dist/ built before the WS-R113 chunk split — which is
  // an environmental "run the build first", not a regression this gate
  // should report as a budget miss.
  if (result.target === "studio-hi") {
    if (result.hindiChunkFailed) {
      findings.push({ metric: "Hindi chunk wait", detail: "the chunk import itself rejected (see runs[].hindiChunkWaitMs === -1 with --json)" });
    } else if (result.median.hindiChunkWaitMs === null) {
      findings.push({ metric: "Hindi chunk wait", detail: "no measurement taken — dist/assets/hiPersonalAuthCopy-*.js not found; run npx vite build first" });
    } else if (result.median.hindiChunkWaitMs > HINDI_CHUNK_WAIT_BUDGET_MS) {
      findings.push({
        metric: "Hindi chunk wait",
        detail: `${Math.round(result.median.hindiChunkWaitMs)}ms > ${HINDI_CHUNK_WAIT_BUDGET_MS}ms budget`,
      });
    }
    // WS-R91. Hindi DOM text timing uses the same three-way split as chunk wait,
    // for the identical reason (an environmental "chunk not found" must
    // never read as a regression this gate should fail the build over).
    if (result.median.firstHindiPaintMs === null) {
      findings.push({ metric: "Hindi DOM text", detail: "no Devanagari DOM text in a visible localized sign-in heading and field label; see runs[].firstHindiPaintMs with --json" });
    } else if (result.median.firstHindiPaintMs > FIRST_HINDI_PAINT_BUDGET_MS) {
      findings.push({
        metric: "Hindi DOM text",
        detail: `${Math.round(result.median.firstHindiPaintMs)}ms > ${FIRST_HINDI_PAINT_BUDGET_MS}ms budget`,
      });
    }
  }
  return findings;
}

function printReport(results) {
  console.log(
    `\n  ${"target".padEnd(14)}${"LCP".padStart(8)}${"CLS".padStart(8)}${"TBT".padStart(8)}${"JS".padStart(10)}${"CSS".padStart(9)}${"font".padStart(8)}${"blocking".padStart(10)}`,
  );
  for (const r of results) {
    const m = r.median;
    console.log(
      `  ${r.target.padEnd(14)}` +
        `${m.lcpMs === null ? "n/a".padStart(8) : `${Math.round(m.lcpMs)}ms`.padStart(8)}` +
        `${m.cls.toFixed(3).padStart(8)}` +
        `${Math.round(m.tbtMs).toString().padStart(6)}ms` +
        `${(m.jsBytes / 1024).toFixed(1).padStart(8)}K` +
        `${(m.cssBytes / 1024).toFixed(1).padStart(7)}K` +
        `${(m.fontBytes / 1024).toFixed(1).padStart(6)}K` +
        `${String(Math.round(m.renderBlockingCount)).padStart(9)}` +
        (m.hindiChunkWaitMs !== null && m.hindiChunkWaitMs !== undefined
          ? `   Hindi chunk wait: ${Math.round(m.hindiChunkWaitMs)}ms`
          : r.target === "studio-hi" ? "   Hindi chunk wait: n/a" : "") +
        (m.firstHindiPaintMs !== null && m.firstHindiPaintMs !== undefined
          ? `   Hindi DOM text: ${Math.round(m.firstHindiPaintMs)}ms`
          : r.target === "studio-hi" ? "   Hindi DOM text: n/a" : ""),
    );
  }
  console.log("");
}

// WS-R107. A STATIC proof, string-level, no browser: the built
// `dist/studio.html` carries exactly one `hi-chunk-preload` meta tag
// (`vite.config.ts`'s `studioHindiPreloadPlugin`'s own marker, carrying the
// real content-hashed chunk path) and never a literal, unconditional
// `<link rel="modulepreload">` for the Hindi chunk baked into the raw
// markup. The English studio paying nothing for the Hindi table
// (`context/decisions.md#studio-hindi-table-is-its-own-chunk`) depends on
// the preload staying CONDITIONAL — a static tag would fetch the chunk for
// every visitor, silently, with no CSP violation and no runtime signal this
// gate's own browser-driven checks would ever catch (they only ever
// navigate to `/studio` and `/studio?lang=hi`, both of which would show the
// identical, wrong, "preload present" result if the tag were unconditional).
// This runs regardless of `--target`, the same always-on posture
// `runInstallCheck()` below already has, because it is a different KIND of
// check (a string scan of the built file, not a browser measurement).
function checkHindiPreloadStatic() {
  const findings = [];
  let html;
  try {
    html = readFileSync(join(DIST, "studio.html"), "utf8");
  } catch {
    findings.push({ metric: "Hindi preload wiring", detail: "dist/studio.html missing" });
    return findings;
  }
  const metaCount = (html.match(/<meta\s+name="hi-chunk-preload"/g) || []).length;
  if (metaCount !== 1) {
    findings.push({
      metric: "Hindi preload wiring",
      detail: `expected exactly 1 hi-chunk-preload meta tag in dist/studio.html, found ${metaCount}`,
    });
  }
  // WS-R113: checks BOTH chunk name shapes — `hiPersonalAuthCopy-` (the one this
  // plugin actually preloads today) and `hiCopy-` (the rest of the table,
  // which must never get a literal preload either) — so a future change
  // that starts baking either in unconditionally still fails this check by
  // name, not just the one currently wired.
  if (/<link\s+rel="modulepreload"[^>]*hi(?:PersonalAuth|Auth)?Copy-/.test(html)) {
    findings.push({
      metric: "Hindi preload wiring",
      detail:
        "dist/studio.html carries a literal, unconditional <link rel=modulepreload> for the Hindi chunk — " +
        "it must be created only by the runtime trigger script (?lang=hi or the remembered locale), never baked into the static markup",
    });
  }
  return findings;
}

// A skipped prerequisite is a failed release check, never a measured pass.
export function performanceGateResult({ budgetFindings = [], install = null, staticFindings = [], prerequisiteFindings = [] } = {}) {
  const installFindings = install?.skipped
    ? [{ target: "installable Room", metric: "prerequisite", detail: install.skipped }]
    : (install?.findings || []).map(f => ({ target: "installable Room", metric: f.check, detail: f.detail }));
  const findings = [...prerequisiteFindings, ...budgetFindings, ...installFindings, ...staticFindings];
  return { status: findings.length ? "failed" : "passed", exitCode: findings.length ? 1 : 0, findings };
}

async function main() {
  const args = process.argv.slice(2);
  const profile = args.includes("--profile");
  const diagnostics = args.includes("--diagnostics") || profile;
  const asJson = args.includes("--json") || diagnostics;
  const targetArg = args.includes("--target") ? args[args.indexOf("--target") + 1] : null;
  const prerequisiteFailure = detail => {
    const result = performanceGateResult({ prerequisiteFindings: [{ target: "performance budgets", metric: "prerequisite", detail }] });
    if (asJson) console.log(JSON.stringify({ ...result, results: [] }, null, 2));
    else console.log(`FAIL  performance budgets: ${detail}`);
    return result.exitCode;
  };
  const targets = targetArg ? TARGETS.filter((t) => t.name === targetArg) : TARGETS;
  if (targetArg && !targets.length) {
    return prerequisiteFailure(`unknown --target "${targetArg}". Known: ${TARGETS.map(t => t.name).join(", ")}`);
  }

  if (!existsSync(DIST)) {
    return prerequisiteFailure("dist/ absent, run `npx vite build` first");
  }
  // WS-R117: `/suites/about` needs no vite build step at all
  // (`scripts/build-suites-about-fixture.mjs`'s own header) -- generated
  // fresh here every run rather than folded into the `absent` check below,
  // so it can never go stale against the shipping builder.
  const { buildSuitesAboutFixture } = await import("./build-suites-about-fixture.mjs");
  await buildSuitesAboutFixture();
  const requiredFixtures = ["room-layout-fixture.html", "studio.html", "creator-page-fixture.html", "room-about-fixture.html", "suites-about-fixture.html"];
  const absent = requiredFixtures.filter((f) => !existsSync(join(DIST, f)));
  if (absent.length) {
    return prerequisiteFailure(`dist/${absent.join(", dist/")} missing; restore the required fixtures.`);
  }
  if (!existsSync(join(SITE, "index.html")) || !existsSync(join(SITE, "vyakti.html"))) {
    return prerequisiteFailure("site/index.html or site/vyakti.html missing.");
  }

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return prerequisiteFailure("playwright not installed");
  }
  const executablePath = [
    process.env.CHROMIUM_PATH,
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  ].find((p) => p && existsSync(p));

  const server = await serveApp();
  // --disable-background-networking: Chromium's own component-updater/Safe
  // Browsing/variations pings are unrelated to the page under test but share
  // its CPU and network throttle, so they inject noise into a measurement
  // that already has $0 network to spend (law 5) and no route to a real
  // Google host from this sandbox in the first place.
  const LAUNCH_ARGS = ["--no-sandbox", "--disable-background-networking"];
  const browser = await chromium.launch(
    executablePath ? { executablePath, args: LAUNCH_ARGS } : { args: LAUNCH_ARGS },
  ).catch(() => null);
  if (!browser) {
    server.close();
    return prerequisiteFailure("no chromium binary available");
  }

  // WS-R177: sampled immediately before and after the measurement loop
  // itself (never before browser launch, which is fixed overhead unrelated
  // to CPU contention DURING measurement) so `loadAverage` reflects what
  // this run actually competed against. The 1-minute figure is used
  // (`loadavg()[0]`) rather than 5- or 15-minute, since a sibling worktree's
  // own gate run is usually shorter than 5 minutes and a longer window would
  // wash out real contention. The WORSE (higher) of the two readings is
  // reported: a machine that got busier partway through the loop should
  // read as busy, not as quiet-because-it-started-quiet.
  const loadAverageBefore = loadavg()[0];
  const results = [];
  for (const target of targets) {
    results.push(await measureTarget(browser, target, diagnostics, profile));
  }
  const loadAverageAfter = loadavg()[0];
  const loadAverage = Math.max(loadAverageBefore, loadAverageAfter);

  await browser.close();
  server.close();

  const allFindings = results.flatMap((r) => evaluateBudgets(r, { loadAverage }).map((f) => ({ target: r.target, ...f })));

  // WS-R59: one more target, folded into the SAME pass/fail — not printed
  // as, and not counted as, a second named gate. `--target` above only ever
  // filtered the LCP/CLS/TBT loop; this runs regardless, because it is a
  // different KIND of check (booleans, not a budget table) rather than a
  // fifth entry `targetArg` could ever name.
  const install = await runInstallCheck();
  // WS-R107. Same "always on, folded into the same pass/fail" posture as
  // the install check just above.
  const hindiPreloadFindings = checkHindiPreloadStatic().map((f) => ({ target: "studio.html (static)", ...f }));

  const outcome = performanceGateResult({ budgetFindings: allFindings, install, staticFindings: hindiPreloadFindings });
  if (asJson) {
    console.log(JSON.stringify({
      ...outcome,
      throttle: THROTTLE,
      budgets: { ...BUDGETS, hindiChunkWaitMs: HINDI_CHUNK_WAIT_BUDGET_MS, firstHindiPaintMs: FIRST_HINDI_PAINT_BUDGET_MS },
      viewport: VIEWPORT, runs: RUNS, results, install,
      // WS-R177: always present, pass or fail, so a result read later (or a
      // sibling's CI log) can tell a real regression from this machine
      // having been busy without re-running anything.
      loadAverage: { oneMinuteBeforeRun: loadAverageBefore, oneMinuteAfterRun: loadAverageAfter },
      ...(profile ? { profiling: "CPU sampling enabled; attribution diagnostic, not an ordinary release measurement" } : {}),
      staticFindings: hindiPreloadFindings,
    }, null, 2));
  } else {
    printReport(results);
    if (outcome.findings.length) {
      console.log(`FAIL  performance budgets: ${outcome.findings.length} finding(s) (1-minute load average ${loadAverage.toFixed(2)} around this run)`);
      for (const f of outcome.findings) console.log(`        ${f.target.padEnd(20)} ${f.metric}: ${f.detail}`);
    }
  }
  if (outcome.exitCode) return outcome.exitCode;
  if (!asJson) {
    console.log(`  ok    performance budgets: ${results.length} target(s) x ${RUNS} runs, all within budget (${THROTTLE.cpuRate}x CPU, ${(THROTTLE.downloadBps * 8 / 1024 / 1024).toFixed(1)}Mbps/${(THROTTLE.uploadBps * 8 / 1024).toFixed(0)}Kbps/${THROTTLE.latencyMs}ms; 1-minute load average ${loadAverage.toFixed(2)})${install.skipped ? "" : "; installable Room: worker registers, precache complete, no /api/ URL ever cached"}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main());
