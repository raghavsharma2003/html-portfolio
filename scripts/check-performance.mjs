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
// prints a named skip rather than silently measuring a stale tree, the same
// convention scripts/check-layout.mjs uses).
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
// FONTS. The budget table below carries a 120 KB font ceiling because the
// brief asked for one; the honest number for every target this gate measures
// is zero. `grep -rl "@font-face\|fonts.googleapis\|\.woff2\?" site/ *.html
// src/room src/studio` finds nothing outside archived research docs — this
// repo loads no web font anywhere, Devanagari included (src/room/room.css's
// own comment: "this repo loads no web fonts anywhere... names the SYSTEM
// face by name"). So "font subsetting or font-display: swap for the
// Devanagari face" (the brief's fix menu) is not a fix this tree needs; the
// budget stays as a floor in case that ever changes, and this comment is the
// record that it was checked, not skipped.
//
// THE NEGATIVE SPACE THIS GATE DOES NOT COVER, STATED PLAINLY: it measures
// four representative screens, not the full follower/creator journey; it
// runs on THIS machine's CPU under an emulated 4x slowdown, which is a model
// of a mid-range Android, not a device this session can hold; and "cold
// cache" here means a browser context that has never fetched these exact
// files, not a first-ever visit to a domain with DNS and TLS setup costs a
// real network adds. A real-device measurement that disagrees with any
// number here is exactly what should change the budget, not this script.

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

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
  { name: "/r/<slug>", path: "/r/anjali?screen=join", label: "Room join screen (room-layout-fixture.html data)" },
  { name: "/studio", path: "/studio", label: "Studio, signed out" },
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
  if (pathname.startsWith("/r/")) return join(DIST, "room-layout-fixture.html");
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

async function measureOnce(browser, target) {
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

  const pending = new Map(); // requestId -> { url, type }
  const bytes = { js: 0, css: 0, font: 0, image: 0, other: 0, total: 0 };
  let requestCount = 0;
  cdp.on("Network.responseReceived", (e) => {
    pending.set(e.requestId, { url: e.response.url, type: e.type });
    requestCount++;
  });
  cdp.on("Network.loadingFinished", (e) => {
    const r = pending.get(e.requestId);
    if (!r) return;
    const n = e.encodedDataLength || 0;
    const cat = categorize(r.type, r.url);
    bytes[cat] += n;
    bytes.total += n;
  });

  await page.addInitScript(() => {
    window.__PERF__ = { lcp: 0, cls: 0, longtasks: [] };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__PERF__.lcp = e.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__PERF__.cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__PERF__.longtasks.push(e.duration);
      }).observe({ type: "longtask", buffered: true });
    } catch {}
  });

  let crashed = null;
  page.on("pageerror", (e) => { crashed = String(e.message || e).slice(0, 200); });

  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}${target.path}`, { waitUntil: "load", timeout: 45000 });
  // Under throttling, "load" fires well before the observers above have
  // finished settling. networkidle with a bounded timeout, then a fixed
  // dwell, is the same two-step every synthetic LCP tool uses in place of the
  // real finalization signal (a visibility change this headless run never
  // produces).
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const wallMs = Date.now() - t0;

  const perf = await page.evaluate(() => window.__PERF__);
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

  await context.close();

  return {
    lcpMs: perf.lcp,
    cls: perf.cls,
    tbtMs,
    bytes,
    requestCount,
    renderBlocking,
    crashed,
    wallMs,
  };
}

async function measureTarget(browser, target) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await measureOnce(browser, target));
  const crashes = runs.filter((r) => r.crashed);
  return {
    target: target.name,
    label: target.label,
    runs,
    median: {
      lcpMs: median(runs.map((r) => r.lcpMs)),
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
    },
    thirdPartyRenderBlocking: [...new Set(runs.flatMap((r) => r.renderBlocking.thirdParty))],
    crashed: crashes.length ? crashes[0].crashed : null,
  };
}

function evaluateBudgets(result) {
  const m = result.median;
  const findings = [];
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
  if (m.tbtMs > BUDGETS.tbtMs) {
    findings.push({ metric: "TBT", detail: `${Math.round(m.tbtMs)}ms > ${BUDGETS.tbtMs}ms budget` });
  }
  if (m.jsBytes > BUDGETS.jsBytes) {
    findings.push({
      metric: "JS transfer",
      detail: `${(m.jsBytes / 1024).toFixed(1)}KB > ${(BUDGETS.jsBytes / 1024).toFixed(0)}KB budget`,
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
        `${Math.round(m.lcpMs).toString().padStart(6)}ms` +
        `${m.cls.toFixed(3).padStart(8)}` +
        `${Math.round(m.tbtMs).toString().padStart(6)}ms` +
        `${(m.jsBytes / 1024).toFixed(1).padStart(8)}K` +
        `${(m.cssBytes / 1024).toFixed(1).padStart(7)}K` +
        `${(m.fontBytes / 1024).toFixed(1).padStart(6)}K` +
        `${String(Math.round(m.renderBlockingCount)).padStart(9)}`,
    );
  }
  console.log("");
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const targetArg = args.includes("--target") ? args[args.indexOf("--target") + 1] : null;
  const targets = targetArg ? TARGETS.filter((t) => t.name === targetArg) : TARGETS;
  if (targetArg && !targets.length) {
    console.log(`FAIL  performance budgets: unknown --target "${targetArg}". Known: ${TARGETS.map((t) => t.name).join(", ")}`);
    return 1;
  }

  if (!existsSync(DIST)) {
    console.log("  skip  performance budgets: dist/ absent, run `npx vite build` first");
    return 0;
  }
  const requiredFixtures = ["room-layout-fixture.html", "studio.html"];
  const absent = requiredFixtures.filter((f) => !existsSync(join(DIST, f)));
  if (absent.length) {
    console.log(`FAIL  performance budgets: dist/${absent.join(", dist/")} missing — vite inputs, restore rather than skip.`);
    return 1;
  }
  if (!existsSync(join(SITE, "index.html")) || !existsSync(join(SITE, "vyakti.html"))) {
    console.log("FAIL  performance budgets: site/index.html or site/vyakti.html missing.");
    return 1;
  }

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log("  skip  performance budgets: playwright not installed");
    return 0;
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
    console.log("  skip  performance budgets: no chromium binary available");
    return 0;
  }

  const results = [];
  for (const target of targets) {
    results.push(await measureTarget(browser, target));
  }

  await browser.close();
  server.close();

  if (asJson) {
    console.log(JSON.stringify({ throttle: THROTTLE, budgets: BUDGETS, viewport: VIEWPORT, runs: RUNS, results }, null, 2));
  } else {
    printReport(results);
  }

  const allFindings = results.flatMap((r) => evaluateBudgets(r).map((f) => ({ target: r.target, ...f })));
  if (allFindings.length) {
    if (!asJson) {
      console.log(`FAIL  performance budgets: ${allFindings.length} budget miss(es)`);
      for (const f of allFindings) {
        console.log(`        ${f.target.padEnd(14)} ${f.metric}: ${f.detail}`);
      }
    }
    return 1;
  }
  if (!asJson) {
    console.log(`  ok    performance budgets: ${results.length} target(s) x ${RUNS} runs, all within budget (${THROTTLE.cpuRate}x CPU, ${(THROTTLE.downloadBps * 8 / 1024 / 1024).toFixed(1)}Mbps/${(THROTTLE.uploadBps * 8 / 1024).toFixed(0)}Kbps/${THROTTLE.latencyMs}ms)`);
  }
  return 0;
}

process.exit(await main());
