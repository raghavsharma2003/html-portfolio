// SECURITY HEADERS AND SUPPLY CHAIN GATE. WS-R57.
//
// WHY THIS EXISTS. `vercel.json` carried no `headers` block at all before
// this workstream (`git log` on the untouched tree, verified). A Room keeps
// years of a follower's own words; it shipped with no Content-Security-Policy,
// no HSTS, no frame protection, and nothing proved the dependency tree
// `npm install` actually pulls is the one `package-lock.json` says it is. This
// is TWO gates riding one file because they share the same "prove it against
// the real artifact, not a description of it" posture: §1 loads the REAL
// built pages in a REAL browser and watches for a REAL blocked resource; §2
// runs the REAL `npm ci`/`npm audit`/`npm query` against the REAL lockfile.
//
// ═══════════════════════════════════════════════════════════════════════════
// §1 — HEADERS, PROVEN AGAINST THE BUILT PAGES
// ═══════════════════════════════════════════════════════════════════════════
//
// `vercel.json`'s `headers` array is the single source of truth for what
// ships. This file does not re-decide the policy; it PARSES that array with
// the same `source` matching Vercel itself uses (literal segments, `:param`
// for one path segment, `(.*)` for the rest) and applies it, header for
// header, to a plain Node static server on 127.0.0.1:8934 -- never 8931-8933,
// which the layout/performance/accessibility gates own (see those files'
// own port comments). `npx vite build` runs first if `dist/` is missing or
// stale (the brief's word for this gate is "builds"); when `scripts/
// verify-release.mjs` runs it, the "web build" gate immediately before this
// one has already built it, so this is a cheap freshness check, not a
// second build, on the common path.
//
// SIX TARGETS, the exact list the brief named: the Room (`/r/anjali`, via
// `room-layout-fixture.html` -- the real `room.html` fetches `/api/room` on
// mount and this gate has no secret to answer that for real; see `context/
// decisions.md#ws-r57-room-and-studio-csp-tested-against-layout-fixtures`
// and `context/rejected.md#ws-r57-naive-api-stub-crashes-the-real-room-shell`
// for why, and why the HEADERS under test are still the real `/r/:slug`
// rule -- CSP is a property of the page SHELL, and the fixture's shell is
// byte-identical to the shipping one), the studio (`/studio`, the real
// `dist/studio.html` -- no fixture needed, it fetches nothing signed out),
// and the four static marketing pages `/`, `/vyakti`, `/suites`, `/creators`
// (served straight from `site/*.html`, the same no-build-step files
// `scripts/check-performance.mjs` already reads by name). A seventh check
// hits `/api/*` directly over plain HTTP (no browser needed for two headers
// on a JSON response).
//
// WHAT COUNTS AS A FAILURE, gate for gate, exactly the brief's three:
//   1. ANY CSP violation -- caught two ways at once: a `securitypolicyviolation`
//      event listener installed via `page.addInitScript` (so it is attached
//      before the FIRST script on the page, inline scripts included) and a
//      console-message scan for Chromium's own "Refused to ..." text, because
//      a violation on a resource the init-script listener races (a stylesheet
//      already parsing when the listener attaches) still always reaches the
//      console.
//   2. A missing header per class -- every route's live response headers are
//      checked against a per-class REQUIRED set (`TARGETS` below), by name,
//      so a miss says "studio: Permissions-Policy absent", never a bare
//      failure.
//   3. A CSP "looser than the law" -- the header VALUE itself is parsed
//      (`parseCsp`) and asserted against the law in this workstream's brief:
//      `default-src` is exactly `'self'`, `script-src` carries neither
//      `'unsafe-inline'` nor `'unsafe-eval'` nor a bare `*`, `frame-ancestors`
//      is `'none'` (no iframe exists anywhere in `src/` or `site/` -- grepped,
//      not assumed -- so WS-R46's own escape hatch is unused), and HSTS
//      carries `preload` at a `max-age` at or above the one-year floor the
//      preload list itself requires.
//
// WHAT THIS FILE DELIBERATELY DOES NOT CHECK, so nobody reads coverage into
// it that is not here: it does not check `style-src`'s `'unsafe-inline'` --
// that is not a defect, it is a decision (`context/decisions.md#ws-r57-style-src-unsafe-inline-scoped-to-style-only`)
// -- and it does not check every path `vercel.json` ever rewrites (`/privacy`,
// `/embed.js`, `/sitemap.xml`...). Those are outside this workstream's named
// route list; `evals/ops/run.mjs`'s new §6 keeps that list itself honest
// against `vercel.json` so a route silently added to it later is still
// caught, without this file growing an unscoped page-by-page audit no one
// asked for.
//
// ═══════════════════════════════════════════════════════════════════════════
// §2 — SUPPLY CHAIN
// ═══════════════════════════════════════════════════════════════════════════
//
//   (a) `npm ci --dry-run` -- the same install `npm ci --dry-run` a real
//       Vercel build would refuse to start on: it fails loudly the moment
//       `package-lock.json` cannot resolve every package with a real
//       `integrity` field, which is the actual thing "the lockfile resolves
//       everything it says it does" means. A real network call to the
//       registry (metadata, not code) -- allowed, not a paid one.
//   (b) `npm audit --omit=dev --audit-level=high --json` -- a registry call.
//       "the registry is unreachable" is DETECTED, not inferred from a bare
//       non-zero exit: `npm audit --json`'s own failure shape on a network
//       error is an `error` object with no `metadata.vulnerabilities`, and
//       that shape reports "not run" and FAILS -- the brief's own words,
//       because a swallowed network error that reads as "0 vulnerabilities"
//       is worse than no check at all. A real `high`/`critical` finding also
//       fails, named. Anything under the `--audit-level` floor is reported,
//       not blocking, same posture as `check-accessibility.mjs`'s moderate/
//       minor split.
//   (c) `npm query ':attr(scripts, [preinstall]), :attr(scripts, [postinstall])'`
//       -- every installed package that runs code during `npm install`,
//       matched by exact `name@version` against `scripts/
//       installScriptAllowlist.mjs`. An unlisted hit fails, named; the
//       allowlist file's own header says what a justified entry looks like.
//
//   node scripts/check-headers.mjs         # both sections
//   node scripts/check-headers.mjs --json  # machine-readable report

import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { INSTALL_SCRIPT_ALLOWLIST } from "./installScriptAllowlist.mjs";

const run = promisify(execFile);

function rootFromModuleUrl(moduleUrl) {
  return fileURLToPath(new URL("..", moduleUrl));
}

const ROOT = rootFromModuleUrl(import.meta.url);
const DIST = join(ROOT, "dist");
const SITE = join(ROOT, "site");
const PORT = 8934;

const args = process.argv.slice(2);
const asJson = args.includes("--json");

const findings = []; // { section, target, kind, detail }
const fail = (section, target, kind, detail) => findings.push({ section, target, kind, detail });

// ─────────────────────────────────────────────────────────────────────────
// vercel.json's `headers` array, parsed with the same `source` matching
// Vercel itself uses. Only the three shapes this repo's `headers` and
// `rewrites` entries actually use are supported: a literal path, `:param`
// for exactly one path segment, and a literal `(.*)` group (already valid
// regex, passed through) -- adding a fourth shape to `vercel.json` without
// widening this function is a mismatch this gate cannot see, which is why
// `evals/ops/run.mjs`'s §6 cross-checks the SAME route list a second way.
// ─────────────────────────────────────────────────────────────────────────
function sourceToRegExp(source) {
  const ESCAPE = /[.+?^${}|[\]\\]/g; // deliberately excludes ( ) * : which are meaningful here
  let pattern = "";
  let i = 0;
  while (i < source.length) {
    if (source[i] === ":") {
      let j = i + 1;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j++;
      pattern += "[^/]+";
      i = j;
    } else if (source.startsWith("(.*)", i)) {
      pattern += "(?:.*)";
      i += 4;
    } else {
      pattern += source[i].replace(ESCAPE, "\\$&");
      i += 1;
    }
  }
  return new RegExp(`^${pattern}$`);
}

async function loadVercelHeaders() {
  const raw = JSON.parse(await readFile(join(ROOT, "vercel.json"), "utf8"));
  const rules = (raw.headers || []).map((h) => ({
    source: h.source,
    re: sourceToRegExp(h.source),
    headers: Object.fromEntries(h.headers.map((kv) => [kv.key, kv.value])),
  }));
  return rules;
}

function headersFor(rules, pathname) {
  const matched = rules.filter((r) => r.re.test(pathname));
  const merged = {};
  for (const m of matched) Object.assign(merged, m.headers); // last match wins per key, same as Vercel
  return { merged, matchedSources: matched.map((m) => m.source) };
}

// ─────────────────────────────────────────────────────────────────────────
// The CSP law, parsed. `looser` returns a list of human-readable complaints,
// empty when the header satisfies WS-R57's brief.
// ─────────────────────────────────────────────────────────────────────────
function parseCsp(value) {
  const map = {};
  for (const part of value.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    map[tokens[0]] = tokens.slice(1);
  }
  return map;
}

function looserThanLaw(cspValue) {
  const complaints = [];
  const csp = parseCsp(cspValue);
  if (!csp["default-src"] || csp["default-src"].join(" ") !== "'self'") {
    complaints.push(`default-src is "${(csp["default-src"] || []).join(" ") || "(absent)"}", must be 'self'`);
  }
  const scriptSrc = csp["script-src"] || [];
  if (!scriptSrc.length) complaints.push("script-src is absent");
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "*"]) {
    if (scriptSrc.includes(bad)) complaints.push(`script-src carries ${bad}`);
  }
  if (!scriptSrc.includes("'self'")) complaints.push("script-src does not carry 'self'");
  const connectSrc = csp["connect-src"] || [];
  if (connectSrc.includes("*")) complaints.push("connect-src carries a bare *");
  const frameAncestors = (csp["frame-ancestors"] || []).join(" ");
  if (frameAncestors !== "'none'") {
    complaints.push(`frame-ancestors is "${frameAncestors || "(absent)"}", must be 'none' (no iframe exists in this tree -- see this file's own header)`);
  }
  return complaints;
}

function hstsComplaints(value) {
  const complaints = [];
  if (!value) return ["absent"];
  const maxAgeMatch = /max-age=(\d+)/.exec(value);
  const maxAge = maxAgeMatch ? Number(maxAgeMatch[1]) : 0;
  if (maxAge < 31536000) complaints.push(`max-age is ${maxAge}, below the one-year preload floor (31536000)`);
  if (!/includeSubDomains/i.test(value)) complaints.push("missing includeSubDomains");
  if (!/preload/i.test(value)) complaints.push("missing preload");
  return complaints;
}

// ─────────────────────────────────────────────────────────────────────────
// The six targets. `expect` is per-class: what class does the brief say
// this route belongs to. `pp` is the exact Permissions-Policy string the
// class must carry (Room denies camera/mic/geo; the studio allows camera
// and microphone to itself for identity capture and the Mirror Call, per
// the brief's own line).
// ─────────────────────────────────────────────────────────────────────────
const DENY_PP = "camera=(), microphone=(), geolocation=()";
const STUDIO_PP = "camera=(self), microphone=(self), geolocation=()";

const TARGETS = [
  // The Room's real shell (`dist/room.html`) fetches `/api/room` on mount to
  // resolve who is asking (`RoomApp.tsx`'s own first `useEffect`) -- correct
  // in production, where the real handler always answers with a full
  // `RoomOpen` shape or a proper error, but this gate has no secret and no
  // database to answer that fetch for real. So, exactly as `scripts/
  // check-layout.mjs` and `scripts/check-accessibility.mjs` already do for
  // this identical wall, the CONTENT under test is `room-layout-fixture.html`
  // (the real `RoomApp`, fixture data, `installFetchStub` answering `/api/
  // room` offline) while the HEADERS under test still come from vercel.json's
  // real `/r/:slug` rule, matched on the REQUEST path below, not on which
  // file happens to answer it -- the fixture and the shipping room.html carry
  // byte-identical `<style>`/`<script src>` shells (verified: `diff` on the
  // built dist/ output), so this is the same CSP surface either way.
  { name: "room", path: "/r/anjali?screen=join", label: "Room (room-layout-fixture.html data)", pp: DENY_PP, checkExecuted: null },
  // WS-R107. `hiPreload: "absent"` is the negative half of the preload
  // proof: the plain, signed-out English visit must never get the Hindi
  // chunk's `<link rel="modulepreload">` -- the whole reason the trigger
  // script (`vite.config.ts`'s `studioHindiPreloadPlugin`) is conditional
  // rather than a static tag. See the `studio-hi` row below for the
  // positive half.
  { name: "studio", path: "/studio", label: "Studio (dist/studio.html)", pp: STUDIO_PP, checkExecuted: null, hiPreload: "absent" },
  // WS-R107. Same file (`dist/studio.html` -- one HTML shell serves both
  // languages, `context/decisions.md#ws-r107-hindi-preload-is-a-conditional-inline-script-not-a-second-entry`),
  // requested with `?lang=hi`: `WS-R80`'s own precedent restated for a
  // preload rather than an island -- "no CSP violation" alone would also
  // pass a page where the trigger script silently failed to run, so this
  // proves the actual side effect (`hiPreload: "present"`, checked below)
  // happened under the real CSP, not merely that nothing was blocked.
  {
    name: "studio-hi",
    path: "/studio?lang=hi",
    label: "Studio, signed out, Hindi preload (dist/studio.html, ?lang=hi)",
    pp: STUDIO_PP,
    checkExecuted: null,
    hiPreload: "present",
  },
  {
    name: "/",
    path: "/",
    label: "site landing (site/index.html)",
    pp: DENY_PP,
    // The painting-picker script (hashed into "/"'s script-src) sets this
    // attribute; if the hash ever goes stale this stays false even with zero
    // reported violations racing the listener, which is why it is checked in
    // addition to, not instead of, the violation capture above.
    checkExecuted: () => document.documentElement.hasAttribute("data-sky"),
  },
  {
    name: "/vyakti",
    path: "/vyakti",
    label: "Vyakti landing (site/vyakti.html)",
    pp: DENY_PP,
    checkExecuted: null,
  },
  { name: "/suites", path: "/suites", label: "Suites (site/suites.html)", pp: DENY_PP, checkExecuted: null },
  { name: "/creators", path: "/creators", label: "Creator directory (site/creators.html)", pp: DENY_PP, checkExecuted: null },
  // WS-R66. Server-rendered, no client script at all beyond the exempt
  // application/ld+json block (never gated by script-src in a compliant
  // browser, since it is never executed as script) — the CSP under test is
  // still the real `/c/:slug` rule from vercel.json, matched on the request
  // path exactly as the Room's own row above is.
  {
    name: "/c/:slug",
    path: "/c/anjali",
    label: "Creator public page (creator-page-fixture.html data)",
    pp: DENY_PP,
    // WS-R80: the taste island (`/creator-taste.js`, `script-src 'self'`,
    // no 'unsafe-inline' needed) must actually mount, not merely fail to
    // violate CSP while sitting inert -- it marks its own form
    // `data-enhanced="1"` once its listener is attached.
    checkExecuted: () => document.getElementById("vy-taste-form")?.getAttribute("data-enhanced") === "1",
  },
  // WS-R97: the follower's transparency page. Server-rendered, no client
  // script at all (this page carries no island, unlike `/c/:slug` above) --
  // the CSP under test is still the real `/r/:slug/about` rule from
  // vercel.json, matched on the request path exactly as every other target
  // here is.
  {
    name: "/r/:slug/about",
    path: "/r/anjali/about",
    label: "Follower transparency page (room-about-fixture.html data)",
    pp: DENY_PP,
    checkExecuted: null,
  },
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

// Same dist-first-then-site fallback as `scripts/check-performance.mjs`
// (that file's own comment explains why: two of these targets are
// no-build-step marketing pages that live only in `site/`).
async function resolveFile(pathname) {
  if (pathname.includes("..")) return null;
  if (pathname === "/") return join(SITE, "index.html");
  if (pathname === "/vyakti") return join(SITE, "vyakti.html");
  if (pathname === "/suites") return join(SITE, "suites.html");
  if (pathname === "/creators") return join(SITE, "creators.html");
  if (pathname === "/studio") return join(DIST, "studio.html");
  if (pathname.startsWith("/r/") && pathname.endsWith("/about")) return join(DIST, "room-about-fixture.html");
  if (pathname.startsWith("/r/")) return join(DIST, "room-layout-fixture.html");
  if (pathname.startsWith("/c/")) return join(DIST, "creator-page-fixture.html");
  const rel = pathname.slice(1).replace(/^(\.\.(\/|\\|$))+/, "");
  const distPath = join(DIST, rel);
  if (existsSync(distPath)) return distPath;
  const sitePath = join(SITE, rel);
  if (existsSync(sitePath)) return sitePath;
  return null;
}

function serveApp(rules) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      const { merged } = headersFor(rules, url.pathname);
      if (url.pathname.startsWith("/api/")) {
        // The header layer under test, not the real handler -- api/*.js
        // needs secrets and a database this offline gate has neither of.
        // door/leak/export batteries elsewhere prove handler BEHAVIOUR;
        // this proves the RESPONSE HEADER LAYER every handler ships under.
        for (const [k, v] of Object.entries(merged)) res.setHeader(k, v);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      const file = await resolveFile(url.pathname);
      if (!file || !existsSync(file)) {
        for (const [k, v] of Object.entries(merged)) res.setHeader(k, v);
        res.writeHead(404).end("not found");
        return;
      }
      const raw = await readFile(file);
      for (const [k, v] of Object.entries(merged)) res.setHeader(k, v);
      res.writeHead(200, { "content-type": contentTypeFor(file) });
      res.end(raw);
    } catch (e) {
      res.writeHead(500).end(String(e && e.message));
    }
  });
  return new Promise((ok) => server.listen(PORT, "127.0.0.1", () => ok(server)));
}

// ═════════════════════════════════════════════════════════════════════════
// §1 driver
// ═════════════════════════════════════════════════════════════════════════
async function runHeaderChecks(rules) {
  if (!existsSync(join(DIST, "room-layout-fixture.html")) || !existsSync(join(DIST, "studio.html")) || !existsSync(join(DIST, "creator-page-fixture.html")) || !existsSync(join(DIST, "room-about-fixture.html"))) {
    console.log("  building (dist/ missing or incomplete) ...");
    execFileSync(process.execPath, [fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)), "build"], {
      cwd: ROOT,
      stdio: "inherit",
    });
  }
  if (!existsSync(join(SITE, "index.html")) || !existsSync(join(SITE, "vyakti.html"))) {
    fail("headers", "setup", "missing-fixture", "site/index.html or site/vyakti.html missing");
    return;
  }

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    fail("headers", "setup", "no-playwright", "playwright not installed -- cannot prove header/CSP behaviour offline");
    return;
  }
  const executablePath = [
    process.env.CHROMIUM_PATH,
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  ].find((p) => p && existsSync(p));

  const server = await serveApp(rules);
  const browser = await chromium
    .launch(executablePath ? { executablePath, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] })
    .catch(() => null);
  if (!browser) {
    server.close();
    fail("headers", "setup", "no-chromium", "no chromium binary available");
    return;
  }

  for (const target of TARGETS) {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (e) => {
        window.__cspViolations.push({
          directive: e.violatedDirective,
          blocked: e.blockedURI,
          source: `${e.sourceFile || ""}:${e.lineNumber || ""}`,
        });
      });
    });
    const consoleViolations = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (/Refused to|Content Security Policy/i.test(text)) consoleViolations.push(text);
    });
    let pageError = null;
    page.on("pageerror", (e) => { pageError = String(e && e.message ? e.message : e); });

    let mainResponse = null;
    page.on("response", (r) => {
      if (!mainResponse && r.url() === `http://127.0.0.1:${PORT}${target.path}`) mainResponse = r;
    });

    try {
      await page.goto(`http://127.0.0.1:${PORT}${target.path}`, { waitUntil: "load", timeout: 20000 });
    } catch (e) {
      fail("headers", target.name, "navigation-failed", String(e && e.message));
      await context.close();
      continue;
    }
    await page.waitForTimeout(300);

    // ── missing header per class ──────────────────────────────────────
    const respHeaders = mainResponse ? mainResponse.headers() : {};
    const REQUIRED = ["content-security-policy", "strict-transport-security", "referrer-policy", "permissions-policy", "x-content-type-options"];
    for (const h of REQUIRED) {
      if (!respHeaders[h]) fail("headers", target.name, "missing-header", h);
    }

    // ── CSP looser than the law ───────────────────────────────────────
    if (respHeaders["content-security-policy"]) {
      for (const complaint of looserThanLaw(respHeaders["content-security-policy"])) {
        fail("headers", target.name, "csp-too-loose", complaint);
      }
    }
    if (respHeaders["strict-transport-security"]) {
      for (const complaint of hstsComplaints(respHeaders["strict-transport-security"])) {
        fail("headers", target.name, "hsts-weak", complaint);
      }
    }
    if (respHeaders["referrer-policy"] && respHeaders["referrer-policy"] !== "strict-origin-when-cross-origin") {
      fail("headers", target.name, "referrer-policy-wrong", respHeaders["referrer-policy"]);
    }
    if (respHeaders["x-content-type-options"] && respHeaders["x-content-type-options"] !== "nosniff") {
      fail("headers", target.name, "nosniff-wrong", respHeaders["x-content-type-options"]);
    }
    if (respHeaders["permissions-policy"] && respHeaders["permissions-policy"] !== target.pp) {
      fail(
        "headers",
        target.name,
        "permissions-policy-wrong",
        `got "${respHeaders["permissions-policy"]}", want "${target.pp}"`,
      );
    }

    // ── any CSP violation ──────────────────────────────────────────────
    const violations = await page.evaluate(() => window.__cspViolations || []);
    for (const v of violations) {
      fail("headers", target.name, "csp-violation", `${v.directive} blocked ${v.blocked} (${v.source})`);
    }
    for (const c of consoleViolations) fail("headers", target.name, "csp-console-violation", c);
    if (pageError) fail("headers", target.name, "page-error", pageError);

    // ── the hashed script actually ran, not just "no violation" ───────
    if (target.checkExecuted) {
      const executed = await page.evaluate(target.checkExecuted);
      if (!executed) fail("headers", target.name, "script-did-not-execute", "the hashed inline script's own side effect never happened");
    }

    // ── WS-R107: the Hindi chunk preload, present exactly where it must
    // be and absent everywhere else. Counted, never just tested truthy, so
    // a runaway duplicate (two links instead of one) fails by name rather
    // than reading as "present, fine". ──
    if (target.hiPreload) {
      const count = await page.evaluate(
        () => document.querySelectorAll('link[rel="modulepreload"][href*="hiCopy-"]').length,
      );
      if (target.hiPreload === "present" && count !== 1) {
        fail("headers", target.name, "hi-preload-count", `expected exactly 1 Hindi-chunk modulepreload link, found ${count}`);
      }
      if (target.hiPreload === "absent" && count !== 0) {
        fail("headers", target.name, "hi-preload-count", `expected 0 Hindi-chunk modulepreload links on the English studio, found ${count}`);
      }
    }

    await context.close();
  }

  // ── API routes: nosniff + no-store, over plain HTTP, no browser needed ──
  for (const apiPath of ["/api/chat", "/api/room", "/api/account"]) {
    const r = await fetch(`http://127.0.0.1:${PORT}${apiPath}`);
    const nosniff = r.headers.get("x-content-type-options");
    const cacheControl = r.headers.get("cache-control");
    if (nosniff !== "nosniff") fail("headers", apiPath, "missing-header", `x-content-type-options (got "${nosniff}")`);
    if (cacheControl !== "no-store") fail("headers", apiPath, "missing-header", `cache-control: no-store (got "${cacheControl}")`);
  }

  await browser.close();
  server.close();
}

// ═════════════════════════════════════════════════════════════════════════
// §2 driver — supply chain
// ═════════════════════════════════════════════════════════════════════════
async function runSupplyChainChecks() {
  // (a) lockfile integrity
  try {
    await run("npm", ["ci", "--dry-run"], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    fail("supply-chain", "npm ci --dry-run", "lockfile-integrity", `${e.stdout ?? ""}${e.stderr ?? ""}`.trim().split("\n").slice(-8).join("\n      "));
  }

  // (b) npm audit — a registry call. "unreachable" is DETECTED from the
  // JSON shape, never inferred from a bare exit code, so a swallowed
  // network error cannot read as "clean". `npm audit` exits non-zero both
  // when it finds vulnerabilities at/above --audit-level AND is itself a
  // normal, expected outcome here, so stdout is parsed regardless of exit
  // code rather than treating non-zero as automatically "not run".
  let auditOut = "";
  try {
    const r = await run("npm", ["audit", "--omit=dev", "--audit-level=high", "--json"], {
      cwd: ROOT,
      maxBuffer: 32 * 1024 * 1024,
    });
    auditOut = r.stdout;
  } catch (e) {
    // npm audit's own convention: a real finding at/above --audit-level
    // still prints the JSON report to stdout and exits 1. e.stdout carries
    // it here exactly as a clean run's stdout would on the success path.
    auditOut = e.stdout || "";
  }
  let audit;
  try {
    audit = JSON.parse(auditOut);
  } catch {
    fail("supply-chain", "npm audit", "registry-unreachable", `could not parse npm audit output -- registry call likely failed:\n      ${auditOut.slice(0, 500)}`);
    audit = null;
  }
  if (audit) {
    if (audit.error || !audit.metadata) {
      fail("supply-chain", "npm audit", "registry-unreachable", JSON.stringify(audit.error || audit).slice(0, 500));
    } else {
      const sev = audit.metadata.vulnerabilities || {};
      const highOrAbove = (sev.high || 0) + (sev.critical || 0);
      if (highOrAbove > 0) {
        const names = Object.entries(audit.vulnerabilities || {})
          .filter(([, v]) => v.severity === "high" || v.severity === "critical")
          .map(([name, v]) => `${name} (${v.severity})`);
        fail("supply-chain", "npm audit", "high-or-critical-vuln", names.join(", "));
      }
      const moderateOrBelow = (sev.moderate || 0) + (sev.low || 0);
      if (moderateOrBelow > 0) {
        console.log(`  note  npm audit: ${moderateOrBelow} moderate/low finding(s), below --audit-level=high, not blocking (see context/measurements.md)`);
      }
    }
  }

  // (c) install scripts
  let queryOut = "";
  try {
    const r = await run(
      "npm",
      ["query", ":attr(scripts, [preinstall]), :attr(scripts, [postinstall])"],
      { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 },
    );
    queryOut = r.stdout;
  } catch (e) {
    fail("supply-chain", "npm query", "query-failed", `${e.stdout ?? ""}${e.stderr ?? ""}`.trim().split("\n").slice(-8).join("\n      "));
    return;
  }
  let hits;
  try {
    hits = JSON.parse(queryOut);
  } catch {
    fail("supply-chain", "npm query", "query-unparseable", queryOut.slice(0, 500));
    return;
  }
  const allowedKeys = new Set(INSTALL_SCRIPT_ALLOWLIST.map((e) => `${e.name}@${e.version}`));
  for (const pkg of hits) {
    const key = `${pkg.name}@${pkg.version}`;
    if (!allowedKeys.has(key)) {
      const which = pkg.scripts && pkg.scripts.preinstall ? "preinstall" : "postinstall";
      fail("supply-chain", key, "unallowlisted-install-script", `${which}: ${pkg.scripts?.[which] || "(script)"} -- add to scripts/installScriptAllowlist.mjs with a reason, or remove the dependency`);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════
async function main() {
  const t0 = Date.now();
  const rules = await loadVercelHeaders();

  const ROUTE_CLASSES = ["/r/:slug", "/studio", "/", "/vyakti", "/suites", "/creators", "/api/(.*)"];
  for (const rc of ROUTE_CLASSES) {
    if (!rules.some((r) => r.source === rc)) fail("headers", rc, "route-class-missing-from-vercel-json", "no matching headers[] entry in vercel.json");
  }

  await runHeaderChecks(rules);
  await runSupplyChainChecks();

  const ms = Date.now() - t0;
  if (asJson) {
    console.log(JSON.stringify({ ok: findings.length === 0, ms, findings }, null, 2));
  } else if (findings.length) {
    console.log(`FAIL  security headers: ${findings.length} finding(s), ${ms}ms`);
    for (const f of findings) console.log(`        [${f.section}] ${f.target}: ${f.kind} -- ${f.detail}`);
  } else {
    console.log(`  ok    security headers: 0 findings across ${TARGETS.length} page target(s) + supply chain, ${ms}ms`);
  }
  return findings.length ? 1 : 0;
}

process.exit(await main());
