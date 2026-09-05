// scripts/check-install.mjs — WS-R59, the installable Room's own Chromium
// check: the service worker registers, its precache holds every shell asset
// `dist/room.html` actually references, and no `/api/` URL is EVER found in
// Cache Storage after a scripted turn.
//
// NOT a new named gate. `scripts/check-performance.mjs`'s own `main()`
// imports `runInstallCheck` and folds any finding into the SAME
// "performance budgets" pass/fail, after its four LCP/CLS/TBT targets — the
// workstream brief's own law: "wire it inside the existing performance gate
// as one more target rather than a new named gate (the count stays 20)".
// This file also runs standalone (`node scripts/check-install.mjs`) for a
// fast iteration loop that does not pay the full performance suite's cost.
//
// PORT 8935, never 8931 (the layout gate) or 8932 (the performance gate) —
// this workstream's own instruction, so three gates that each drive
// Chromium can run in sibling worktrees without an EADDRINUSE that reads
// like a real regression.
//
// ── WHY THE REAL room.html, NEVER room-layout-fixture.html ─────────────────
//
// `scripts/check-performance.mjs`'s own `/r/<slug>` target measures through
// `room-layout-fixture.html` — the right choice for LCP/CLS/TBT, since that
// gate needs a signed-in screen with no live backend. But that fixture
// SKIPS the service-worker registration effect entirely by construction
// (`RoomApp.tsx`'s own `fixtureOpen` guard on every effect this workstream
// added), so it structurally cannot prove this file's own claim. This check
// serves the REAL built `dist/room.html`, unfixtured, and stubs only the
// `/api/room` shapes it needs to reach "talking" — a real backend is not
// reachable in this environment (no `NEON_URL`) and is not needed either:
// the property under test is what the SERVICE WORKER does with a request,
// which is decided by the request's URL and the worker's own code, not by
// whether a real database answered it.
//
// ── WHAT "A SCRIPTED TURN" MEANS HERE, PRECISELY ────────────────────────────
//
// This check does not additionally drive the composer/keyboard to send a
// message through the UI. It calls `fetch("/api/room", {... op: "say" ...})`
// FROM INSIDE THE PAGE — the exact same same-origin URL and method a real
// send hits, so `public/room-sw.js`'s real `fetch` handler runs its real
// code path against it, identically to how it would for a real message
// (its blanket `pathname.startsWith("/api/")` guard makes the two paths
// equivalent — see that file's own header). This is stated plainly rather
// than presented as a fuller UI-automation test it is not.
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const PORT = 8935;
const SLUG = "anjali";

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".webmanifest": "application/manifest+json",
};
function contentTypeFor(path) {
  return MIME[extname(path).toLowerCase()] || "application/octet-stream";
}

/** `RoomOpen`-shaped (`src/room/roomApi.ts`), byte-similar to
 *  `layoutFixture.tsx`'s own `FIXTURE_OPEN` — a joined follower, so the real
 *  app reaches "talking" (and therefore registers no MORE than production
 *  does) without a real join flow this check has no reason to also drive. */
const OPEN_RESPONSE = {
  room: { slug: SLUG, display_name: "Anjali", name: "Anjali", handoff_enabled: false },
  disclosure: [
    "You are talking with Anjali AI. It is not Anjali.",
    "Anjali built it from their own material and published it here. Anjali does not read these conversations.",
    "What you say stays in your own thread. Nobody else who talks to Anjali AI can see any of it.",
  ].join("\n"),
  locale: "en",
  joined: true,
  follower: {
    joined_at: "2026-08-14T09:00:00.000Z", tier: "free", remembers: true,
    messages_used: 1, messages_included: 20, messages_left: 19,
    voice_seconds_used: 0, voice_seconds_included: 0, voice_seconds_left: 0,
    settings_reviewed_at: null,
  },
  threads: [],
  session: "r1.check-install.fixture",
};

/** Serves `dist/` verbatim, plus the two things a real deploy's
 *  `vercel.json` would otherwise supply that this check actually exercises:
 *  `/` and `/r/<slug>` both resolve to the real built `room.html`
 *  (`resolveFile`'s own `/r/:slug` rewrite, restated for a plain Node
 *  server), and every `/api/room` POST is answered from the fixed table
 *  above rather than a live function this environment cannot run. */
function serveApp() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      if (req.method === "POST" && url.pathname === "/api/room") {
        let body = "";
        for await (const chunk of req) body += chunk;
        let op = "";
        try {
          op = JSON.parse(body || "{}").op || "";
        } catch {
          op = "";
        }
        const json = (payload) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(payload));
        };
        if (op === "open" || op === "join") return json(OPEN_RESPONSE);
        if (op === "say") {
          return json({ reply: "Test reply, never cached.", quota: OPEN_RESPONSE.follower, upgrade_prompt: false });
        }
        if (op === "history") return json({ turns: [] });
        return json({});
      }
      let pathname = url.pathname;
      if (pathname === "/" || pathname.startsWith(`/r/${SLUG}`)) pathname = "/room.html";
      const rel = normalize(pathname.slice(1)).replace(/^(\.\.(\/|\\|$))+/, "");
      const file = join(DIST, rel);
      if (!existsSync(file)) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": contentTypeFor(file) });
      res.end(await readFile(file));
    } catch (err) {
      res.writeHead(500).end(String(err?.message || err));
    }
  });
  return new Promise((resolveReady) => server.listen(PORT, "127.0.0.1", () => resolveReady(server)));
}

/** Every shell asset `dist/room.html` itself references — the SAME
 *  same-origin `src=`/`href=` scan `public/room-sw.js`'s own
 *  `derivePrecacheList` runs against the real page at install time, restated
 *  here so this check can assert the precache actually HOLDS every one of
 *  them, rather than trusting that the two independent scans agree by
 *  construction. */
function shellAssetsFromHtml(html) {
  const urls = new Set(["/room.html", "/favicon.svg"]);
  const re = /\b(?:src|href)="(\/[^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1].startsWith("/api/")) continue;
    urls.add(m[1]);
  }
  return [...urls];
}

export async function runInstallCheck() {
  const findings = [];
  if (!existsSync(join(DIST, "room.html")) || !existsSync(join(DIST, "room-sw.js"))) {
    return { skipped: "dist/room.html or dist/room-sw.js absent, run `npx vite build` first" };
  }
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return { skipped: "playwright not installed" };
  }
  const executablePath = [
    process.env.CHROMIUM_PATH,
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/opt/pw-browsers/chromium/chrome-linux/chrome",
  ].find((p) => p && existsSync(p));

  const server = await serveApp();
  const browser = await chromium
    .launch(executablePath ? { executablePath, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] })
    .catch(() => null);
  if (!browser) {
    server.close();
    return { skipped: "no chromium binary available" };
  }

  try {
    const context = await browser.newContext({ serviceWorkers: "allow" });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/r/${SLUG}`, { waitUntil: "load" });

    // 1. THE WORKER REGISTERS.
    const registered = await page
      .waitForFunction(
        () => navigator.serviceWorker.getRegistration("/room-sw.js").then((r) => !!r),
        null,
        { timeout: 10_000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!registered) {
      findings.push({
        check: "worker registers",
        detail: 'navigator.serviceWorker.getRegistration("/room-sw.js") never resolved to a registration within 10s',
      });
    }

    // Give the worker's own `install` handler (which itself fetches
    // `room.html` again and opens a cache) a moment to finish —
    // `navigator.serviceWorker.ready` resolves once an ACTIVE worker
    // controls the page, which for a first-ever registration is after
    // `install` has already run to completion.
    await page.evaluate(() => navigator.serviceWorker.ready).catch(() => {});
    await page.waitForTimeout(500);

    // 2. THE PRECACHE LISTS EVERY SHELL ASSET.
    const html = await readFile(join(DIST, "room.html"), "utf8");
    const expected = shellAssetsFromHtml(html);
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls = new Set();
      for (const name of names) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) urls.add(new URL(req.url).pathname);
      }
      return [...urls];
    });
    const missing = expected.filter((u) => !cached.includes(u));
    if (missing.length) {
      findings.push({ check: "precache completeness", detail: `not found in any cache: ${missing.join(", ")}` });
    }

    // 3. A SCRIPTED TURN, THEN: NO /api/ URL WAS EVER CACHED.
    await page.evaluate(async () => {
      await fetch("/api/room", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "say",
          session: "r1.check-install.fixture",
          message: "hello",
          thread: null,
          transcript: [],
        }),
      }).catch(() => {});
    });
    await page.waitForTimeout(300);
    const apiCached = await page.evaluate(async () => {
      const names = await caches.keys();
      const hits = [];
      for (const name of names) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) {
          if (new URL(req.url).pathname.startsWith("/api/")) hits.push(req.url);
        }
      }
      return hits;
    });
    if (apiCached.length) {
      findings.push({ check: "no /api/ caching", detail: `found in Cache Storage after a scripted turn: ${apiCached.join(", ")}` });
    }

    await context.close();
  } finally {
    await browser.close();
    server.close();
  }

  return { findings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runInstallCheck();
  if (result.skipped) {
    console.log(`  skip  installable Room: ${result.skipped}`);
    process.exit(0);
  }
  if (result.findings.length) {
    console.log(`FAIL  installable Room: ${result.findings.length} finding(s)`);
    for (const f of result.findings) console.log(`        ${f.check}: ${f.detail}`);
    process.exit(1);
  }
  console.log("  ok    installable Room: worker registers, precache complete, no /api/ URL ever cached");
  process.exit(0);
}
