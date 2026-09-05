#!/usr/bin/env node
// WS-R64. THE LIVE PROBE — checks, for free, that a real deployment actually
// serves what the tree promised. `verify-release.mjs --live` exists and
// costs money (it probes the model); this never does. Every expectation
// below comes from `scripts/probeLiveExpectations.mjs`, which reads this
// repo's OWN source — vercel.json's headers/crons arrays, the room-page/
// room-card/room-manifest/room-embed literals, the room.js op list, the
// per-cron auth failure line — so a finding never argues with a second,
// hand-typed copy of the same fact.
//
//   node scripts/probe-live.mjs <base-url> [--json]
//                                [--cookie-jar <file>] [--share <url>]
//                                [--creator-slug <slug>]
//
// WS-R90: `--creator-slug` names a REAL, listed, published Room's slug on
// the deployment being probed, and checks `/c/<slug>`'s canonical, hreflang
// alternates and JSON-LD (Person always, FAQPage when the Room has a
// showcase). Every other check in this file needs only an UNKNOWN slug --
// this is the one exception, because an unknown slug's `/c/<slug>` is
// deliberately the platform-only fallback with no Person block at all
// (`api/_creator-page.js`'s own "nobody may learn whether a slug exists
// from this page's shape" law). Omitted, this section is SKIPPED with a
// printed note, never a failure -- see `usage()` below for why a probe must
// never invent a listed slug to check against.
//
// WS-R97: the SAME `--creator-slug` also checks `/r/<slug>/about`'s
// canonical and hreflang alternates -- `api/_room-about.js`'s own predicate
// is published+unpaused, never `listed_at`-gated, so any Room that flag
// already names is guaranteed to answer for this page too.
//
// NETWORK: exactly one base URL's origin, GET and HEAD, plus the two
// specific `POST /api/room` bodies this file's own source names below —
// both refused before either could ever reach a model or a provider. THE
// STATIC SELF-SCAN just past the imports proves that in a way a reviewer
// does not have to trust: it reads THIS FILE'S OWN BYTES back off disk and
// refuses to run at all if any `op:` literal in them names anything outside
// `POST_OP_ALLOWLIST` -- so a future edit that adds a third POST body fails
// closed, before the first network call, rather than shipping a probe that
// quietly grew a new door.
//
// A PROTECTED PREVIEW (Vercel deployment protection) answers every request
// with a 30x toward `vercel.com/sso-api` until a bypass cookie is set. Visit
// the share link ONCE with `--share <url>` (following redirects, cookie jar
// on) to set it; the cookie then rides every later request via
// `--cookie-jar <file>`. The share TOKEN is never written to disk by this
// script (nothing here logs it or the jar's own cookie value) and the jar
// file belongs wherever the caller points it -- never inside this repo, a
// context file, or a commit. It expires in about 23 hours; a run that still
// sees the SSO redirect after priming needs a fresh share link.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  loadVercelConfig,
  loadHeaderRules,
  headersFor,
  routeTargetsFromHeaderRules,
  cronPaths,
  cronAuthExpectation,
  roomPageFacts,
  roomCardSizes,
  pngDimensions,
  platformManifestBytes,
  roomSwBytes,
  robotsTxtBytes,
  roomEmbedJs,
  roomKnownOps,
  roomUnknownOpExpectation,
  roomNoSessionExpectation,
  roomEmbedUnknownExpectation,
  unknownSlug,
  creatorPageHeadFacts,
  roomAboutHeadFacts,
  validatePersonJsonLd,
  validateFaqPageJsonLd,
} from "./probeLiveExpectations.mjs";

const SELF_PATH = fileURLToPath(import.meta.url);

// ═══════════════════════════════════════════════════════════════════════════
// THE STATIC SELF-SCAN — provably no path to a model or a provider.
// ═══════════════════════════════════════════════════════════════════════════
//
// The ONLY two `op` values this file may ever hand to `POST /api/room`, and
// why neither can reach a model: `__vyakti_probe_unknown_op__` matches none
// of `api/room.js`'s own `op === "..."` branches (asserted below against
// the real file, not assumed), so it falls straight to the closing
// `unknown_op` 400. `say` is sent with NO `session` field, and
// `api/room.js`'s "say" branch calls `readRoomSession(body.session)` FIRST,
// before touching the compiler or any provider -- an absent session throws
// `room_session_invalid` synchronously, off pure string/HMAC checks, before
// a single row is read. Neither body ever reaches `roomSay`'s own model
// call. `speak` (the other op capable of a provider call) never appears in
// this file at all -- checked by the scan below, not merely asserted here.
const POST_OP_ALLOWLIST = Object.freeze(["__vyakti_probe_unknown_op__", "say"]);

function assertOwnSourceOnlyPostsSafeOps() {
  const ownSource = readFileSync(SELF_PATH, "utf8");
  // Every occurrence, anywhere in this file's own bytes, of the object key
  // named op followed by a colon and a single- or double-quoted string on
  // one line (never a backtick, which this file's own comments use as
  // inline-code markup and would otherwise let ordinary prose swallow the
  // rest of a comment as a fake match). Scoped this way on purpose: narrow
  // enough not to trip on its own documentation, wide enough that the two
  // real POST bodies below are exactly what it finds.
  const found = [...ownSource.matchAll(/\bop\s*:\s*(["'])([^"'\n]*)\1/g)].map((m) => m[2]);
  const unique = [...new Set(found)];
  const disallowed = unique.filter((op) => !POST_OP_ALLOWLIST.includes(op));
  if (disallowed.length) {
    console.error(
      `probe-live: REFUSING TO RUN -- this file's own source mentions op(s) outside POST_OP_ALLOWLIST: ${disallowed.join(", ")}`,
    );
    process.exit(1);
  }
  // The allowlist itself must still be exactly the two ops the header above
  // promises -- a THIRD safe-looking addition to the allowlist without a
  // matching code review is exactly the drift this scan exists to catch.
  if (POST_OP_ALLOWLIST.length !== 2 || !POST_OP_ALLOWLIST.includes("say") || !POST_OP_ALLOWLIST.includes("__vyakti_probe_unknown_op__")) {
    console.error("probe-live: REFUSING TO RUN -- POST_OP_ALLOWLIST no longer matches the two documented ops");
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════
function parseArgs(argv) {
  const out = { baseUrl: null, json: false, cookieJar: null, share: null, creatorSlug: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--cookie-jar") out.cookieJar = argv[++i];
    else if (a === "--share") out.share = argv[++i];
    else if (a === "--creator-slug") out.creatorSlug = argv[++i];
    else rest.push(a);
  }
  out.baseUrl = rest[0] || null;
  return out;
}

function usage() {
  console.error(
    [
      "usage: node scripts/probe-live.mjs <base-url> [--json] [--cookie-jar <file>] [--share <url>] [--creator-slug <slug>]",
      "",
      "  <base-url>            the ONE origin this run is allowed to touch",
      "  --cookie-jar <file>   read/write a small JSON cookie jar here (never inside this repo)",
      "  --share <url>         visit once to prime the jar past Vercel deployment protection",
      "                        (a protected preview needs this -- see docs/gurukul/DEPLOY.md)",
      "  --creator-slug <slug> a REAL, listed, published Room's slug on this deployment --",
      "                        checks /c/<slug>'s canonical, hreflang alternates and JSON-LD.",
      "                        Omit to skip this section: no live listed Room can be assumed",
      "                        to exist (context/STATE.md's own LIVE table -- 'no real vy_room",
      "                        row has ever been inserted anywhere outside a fake db'), and a",
      "                        probe must never invent one to check against.",
    ].join("\n"),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// A TINY COOKIE JAR — name/value only, one origin, no domain/path/expiry
// logic: everything this script ever talks to is the single base origin, so
// none of that matters here. Values are never logged.
// ═══════════════════════════════════════════════════════════════════════════
function loadJar(path) {
  if (!path || !existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && parsed.cookies ? parsed.cookies : {};
  } catch {
    return {};
  }
}
function saveJar(path, cookies) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ cookies, savedAt: new Date().toISOString() }, null, 2));
}
function cookieHeader(cookies) {
  const pairs = Object.entries(cookies);
  return pairs.length ? pairs.map(([k, v]) => `${k}=${v}`).join("; ") : null;
}
function absorbSetCookie(cookies, headers) {
  const raw = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  let changed = false;
  for (const line of raw) {
    const first = line.split(";")[0];
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (cookies[name] !== value) changed = true;
    cookies[name] = value;
  }
  return changed;
}

// ═══════════════════════════════════════════════════════════════════════════
// HTTP — one timeout, one retry, and a hard same-origin guard so a bug here
// can never turn into a request to some third address.
// ═══════════════════════════════════════════════════════════════════════════
const TIMEOUT_MS = 10_000;

function makeClient({ baseUrl, cookies, cookieJarPath }) {
  const base = new URL(baseUrl);
  function assertSameOrigin(url) {
    const u = new URL(url, base);
    if (u.origin !== base.origin) {
      throw new Error(`probe-live: refusing to reach off-origin URL ${u.origin} (base is ${base.origin})`);
    }
    return u;
  }
  async function once(method, path, { headers = {}, body } = {}) {
    const url = assertSameOrigin(path.startsWith("http") ? path : `${base.origin}${path}`);
    const ck = cookieHeader(cookies);
    const finalHeaders = { ...headers };
    if (ck) finalHeaders.Cookie = ck;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { method, headers: finalHeaders, body, redirect: "manual", signal: controller.signal });
      if (absorbSetCookie(cookies, res.headers)) saveJar(cookieJarPath, cookies);
      return res;
    } finally {
      clearTimeout(timer);
    }
  }
  async function request(method, path, opts) {
    try {
      return await once(method, path, opts);
    } catch (e) {
      // ONE retry, per the brief -- a cold Vercel function or a flaky proxy
      // hop should not turn into a false finding.
      return await once(method, path, opts);
    }
  }
  // Manual redirect following, capped, so a Set-Cookie on an INTERMEDIATE
  // hop (the SSO bounce) is never silently dropped the way `redirect:
  // "follow"` would drop it -- fetch only exposes the FINAL response's own
  // headers in follow mode, and Vercel's bypass-token flow sets the cookie
  // on an early hop, not necessarily the last one.
  async function requestFollowing(method, path, opts, maxRedirects = 5) {
    let current = path;
    let res = await request(method, current, opts);
    let hops = 0;
    while (res.status >= 300 && res.status < 400 && res.headers.get("location") && hops < maxRedirects) {
      const next = assertSameOrigin(new URL(res.headers.get("location"), new URL(current, base)).toString());
      current = next.toString();
      res = await request(method, current, opts);
      hops++;
    }
    return res;
  }
  return { request, requestFollowing, base };
}

// ═══════════════════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════════════════
const findings = [];
const surfaces = [];
const notes = [];
function fail(surface, expectation, observed, promisedBy) {
  findings.push({ surface, expectation, observed, promisedBy });
}
function recordSurface(name, res, bytes) {
  surfaces.push({
    surface: name,
    status: res.status,
    contentType: res.headers.get("content-type") || null,
    bytes: bytes == null ? null : bytes.length,
  });
}

async function bufferOf(res) {
  return Buffer.from(await res.arrayBuffer());
}

function checkHeaderPromise(surfaceName, path, promisedHeaders, actualHeaders) {
  const label = `${surfaceName} (${path})`;
  for (const [key, value] of Object.entries(promisedHeaders)) {
    const observed = actualHeaders.get(key.toLowerCase());
    if (observed == null) {
      fail(label, `header "${key}": "${value}"`, "(absent)", "vercel.json headers[]");
    } else if (observed !== value) {
      fail(label, `header "${key}": "${value}"`, observed, "vercel.json headers[]");
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  assertOwnSourceOnlyPostsSafeOps();

  const { baseUrl, json, cookieJar: cookieJarPath, share, creatorSlug } = parseArgs(process.argv.slice(2));
  if (!baseUrl) {
    usage();
    process.exit(2);
  }

  const cookies = loadJar(cookieJarPath);
  const client = makeClient({ baseUrl, cookies, cookieJarPath });

  if (share) {
    const shareRes = await client.requestFollowing("GET", share);
    saveJar(cookieJarPath, cookies);
    if (!json) {
      console.log(`primed cookie jar via --share: final status ${shareRes.status}${cookieJarPath ? `, saved to ${cookieJarPath}` : " (no --cookie-jar given, so nothing persists past this run)"}`);
    }
  }

  // A protected preview with no usable cookie answers EVERYTHING with a
  // redirect toward vercel.com's SSO gate. Detect that up front with one
  // cheap request and stop with one clear message rather than reporting
  // forty confusing individual findings.
  const probe = await client.request("GET", "/");
  if (probe.status >= 300 && probe.status < 400) {
    const loc = probe.headers.get("location") || "";
    if (/vercel\.com\/sso-api/i.test(loc)) {
      console.error(
        "probe-live: this preview is behind Vercel deployment protection and no valid bypass cookie is set.\n" +
          "  Re-run with --share <the share link> (optionally with --cookie-jar <file> to persist it) -- see docs/gurukul/DEPLOY.md.",
      );
      process.exit(2);
    }
  }

  const config = loadVercelConfig();
  const headerRules = loadHeaderRules(config);
  const slug = unknownSlug("a");
  const slugB = unknownSlug("b");

  // ── 1. every header-promised route class ──────────────────────────────
  const targets = routeTargetsFromHeaderRules(headerRules, slug);
  let personRes = null;
  let personBytes = null;
  for (const t of targets) {
    if (t.unsupported || !t.path) {
      fail("vercel.json headers[]", `a concrete probe path for "${t.source}"`, "(no rule known for this source shape)", "vercel.json");
      continue;
    }
    const res = await client.request("GET", t.path);
    const bytes = await bufferOf(res);
    recordSurface(`route-class ${t.source} (${t.path})`, res, bytes);
    checkHeaderPromise(`route-class ${t.source}`, t.path, t.rule.headers, res.headers, "vercel.json");
    // `/r/:slug` with the plain default UA IS "a person" (no bot pattern
    // matches it, so vercel.json falls through to the static room.html
    // rewrite) -- reuse this response rather than fetching it twice.
    if (t.source === "/r/:slug") {
      personRes = res;
      personBytes = bytes;
    }
  }

  // ── 2. /r/<unknown-slug> as a person vs as three bots ──────────────────
  if (personRes && personRes.status !== 200) {
    fail("/r/:slug (person)", "status 200 (static room.html rewrite)", personRes.status, "vercel.json rewrites[]");
  }

  const facts = roomPageFacts();
  const BOT_UAS = [
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "TelegramBot (like TwitterBot)",
    "WhatsApp/2.24.1.78 A",
  ];
  for (const ua of BOT_UAS) {
    const res = await client.request("GET", `/r/${slug}`, { headers: { "user-agent": ua } });
    const bytes = await bufferOf(res);
    const html = bytes.toString("utf8");
    recordSurface(`/r/:slug as bot (${ua.split("/")[0]})`, res, bytes);
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) fail(`/r/:slug bot ${ua.split("/")[0]}`, "content-type text/html", ct, "api/room-page.js");
    if (!html.includes(`<title>${facts.title}</title>`)) {
      fail(`/r/:slug bot ${ua.split("/")[0]}`, `<title>${facts.title}</title>`, "(not found in body)", "api/_room-page.js PLATFORM_TITLE");
    }
    if (!html.includes(`og:title" content="${facts.title}"`)) {
      fail(`/r/:slug bot ${ua.split("/")[0]}`, `og:title="${facts.title}"`, "(not found in body)", "api/_room-page.js");
    }
    const imgMatch = /og:image" content="([^"]+)"/.exec(html);
    if (!imgMatch || !imgMatch[1].endsWith(`/r/${slug}/og.png`)) {
      fail(`/r/:slug bot ${ua.split("/")[0]}`, `og:image ending in /r/${slug}/og.png`, imgMatch?.[1] || "(absent)", "api/_room-page.js");
    }
    if (!html.includes(`og:image:width" content="${facts.ogWidth}"`) || !html.includes(`og:image:height" content="${facts.ogHeight}"`)) {
      fail(`/r/:slug bot ${ua.split("/")[0]}`, `og:image ${facts.ogWidth}x${facts.ogHeight}`, "(mismatch or absent)", "api/_room-page.js OG_IMAGE_WIDTH/HEIGHT");
    }
  }

  // ── 3. og.png / story.png ──────────────────────────────────────────────
  const cardSizes = roomCardSizes();
  for (const [kind, expectedSize] of Object.entries(cardSizes)) {
    const suffix = kind === "og" ? "og.png" : "story.png";
    const resA = await client.request("GET", `/r/${slug}/${suffix}`);
    const bufA = await bufferOf(resA);
    recordSurface(`/r/:slug/${suffix} (slug A)`, resA, bufA);
    if (!bufA.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      fail(`/r/:slug/${suffix}`, "PNG magic bytes", bufA.subarray(0, 8).toString("hex"), "api/_room-card.js rasterizeRoomCard");
    }
    const dims = pngDimensions(bufA);
    if (!dims || dims.width !== expectedSize.width || dims.height !== expectedSize.height) {
      fail(`/r/:slug/${suffix}`, `${expectedSize.width}x${expectedSize.height} (IHDR)`, dims ? `${dims.width}x${dims.height}` : "(unparseable)", "api/_room-card.js ROOM_CARD_SIZES");
    }
    const resB = await client.request("GET", `/r/${slugB}/${suffix}`);
    const bufB = await bufferOf(resB);
    if (!bufA.equals(bufB)) {
      fail(`/r/:slug/${suffix}`, "byte-identical for two unknown slugs", `${bufA.length} vs ${bufB.length} bytes, differ`, "api/_room-card.js cardInputFor(null, kind)");
    }
  }

  // ── 4. /r/<unknown-slug>/manifest.webmanifest ──────────────────────────
  const manifestRes = await client.request("GET", `/r/${slug}/manifest.webmanifest`);
  const manifestBytes = await bufferOf(manifestRes);
  recordSurface("/r/:slug/manifest.webmanifest", manifestRes, manifestBytes);
  const expectedManifest = platformManifestBytes();
  if (!manifestBytes.equals(expectedManifest)) {
    fail("/r/:slug/manifest.webmanifest", "byte-identical to public/room.webmanifest", `${manifestBytes.length} bytes, differs`, "api/_room-manifest.js PLATFORM_ROOM_MANIFEST_JSON");
  }

  // ── 5. /room-sw.js ──────────────────────────────────────────────────────
  const swRes = await client.request("GET", "/room-sw.js");
  const swBytes = await bufferOf(swRes);
  recordSurface("/room-sw.js", swRes, swBytes);
  const expectedSw = roomSwBytes();
  if (!swBytes.equals(expectedSw)) {
    fail("/room-sw.js", "byte-identical to public/room-sw.js", `${swBytes.length} bytes, differs`, "public/room-sw.js (Vite public/ passthrough)");
  }

  // ── 6. /room-embed.js ───────────────────────────────────────────────────
  const embedRes = await client.request("GET", "/room-embed.js");
  const embedBytes = await bufferOf(embedRes);
  recordSurface("/room-embed.js", embedRes, embedBytes);
  const expectedEmbedJs = roomEmbedJs();
  if (embedBytes.toString("utf8") !== expectedEmbedJs) {
    fail("/room-embed.js", "byte-identical to ROOM_EMBED_JS", `${embedBytes.length} bytes, differs`, "api/_room-embed.js ROOM_EMBED_JS");
  }

  // ── 7. the static/marketing surfaces ────────────────────────────────────
  for (const path of ["/creators", "/suites", "/sitemap.xml", "/robots.txt", "/privacy", "/delete-account"]) {
    const res = await client.request("GET", path);
    const bytes = await bufferOf(res);
    recordSurface(path, res, bytes);
    if (res.status !== 200) fail(path, "status 200", res.status, "vercel.json rewrites[] / scripts/vercel-build.sh");
    if (bytes.length === 0) fail(path, "non-empty body", "0 bytes", "vercel.json rewrites[] / scripts/vercel-build.sh");
    // robots.txt is copied unconditionally, byte for byte, on every build
    // (scripts/vercel-build.sh's own comment) -- the one static page here
    // with no branch-dependent variant, so an exact-bytes check is safe.
    if (path === "/robots.txt" && !bytes.equals(robotsTxtBytes())) {
      fail("/robots.txt", "byte-identical to site/robots.txt", `${bytes.length} bytes, differs`, "scripts/vercel-build.sh (cp site/robots.txt)");
    }
  }

  // ── 8. the three refused doors ───────────────────────────────────────────
  const knownOps = roomKnownOps();
  if (knownOps.includes("__vyakti_probe_unknown_op__")) {
    // Would mean api/room.js grew an op with this exact literal name -- the
    // sentinel would then no longer BE unknown, and this file's own "unknown
    // op" check would be testing nothing. Fail loudly rather than silently.
    fail("POST /api/room unknown op", "a sentinel op absent from api/room.js's known op list", "sentinel now collides with a real op", "api/room.js");
  } else {
    const res = await client.request("POST", "/api/room", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "__vyakti_probe_unknown_op__" }),
    });
    const bytes = await bufferOf(res);
    recordSurface("POST /api/room (unknown op)", res, bytes);
    const expected = roomUnknownOpExpectation();
    let body = null;
    try { body = JSON.parse(bytes.toString("utf8")); } catch {}
    if (res.status !== expected.status || JSON.stringify(body) !== JSON.stringify(expected.body)) {
      fail("POST /api/room (unknown op)", `${expected.status} ${JSON.stringify(expected.body)}`, `${res.status} ${JSON.stringify(body)}`, "api/room.js");
    }
  }

  {
    const res = await client.request("POST", "/api/room", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "say" }),
    });
    const bytes = await bufferOf(res);
    recordSurface("POST /api/room (say, no session)", res, bytes);
    const expected = roomNoSessionExpectation();
    let body = null;
    try { body = JSON.parse(bytes.toString("utf8")); } catch {}
    if (res.status !== expected.status || JSON.stringify(body) !== JSON.stringify(expected.body)) {
      fail("POST /api/room (say, no session)", `${expected.status} ${JSON.stringify(expected.body)}`, `${res.status} ${JSON.stringify(body)}`, "api/_room-surface.js readRoomSession");
    }
  }

  {
    const res = await client.request("GET", `/api/room-embed?slug=${encodeURIComponent(slug)}`);
    const bytes = await bufferOf(res);
    recordSurface("GET /api/room-embed?slug=<unknown>", res, bytes);
    const expected = roomEmbedUnknownExpectation();
    let body = null;
    try { body = JSON.parse(bytes.toString("utf8")); } catch {}
    if (res.status !== expected.status || JSON.stringify(body) !== JSON.stringify(expected.body)) {
      fail("GET /api/room-embed?slug=<unknown>", `${expected.status} ${JSON.stringify(expected.body)}`, `${res.status} ${JSON.stringify(body)}`, "api/_room-embed.js buildRoomEmbedJson");
    }
  }

  // ── 9. the thirteen cron endpoints, no secret ───────────────────────────
  for (const path of cronPaths(config)) {
    const expected = cronAuthExpectation(path);
    const res = await client.request("GET", path);
    const bytes = await bufferOf(res);
    recordSurface(`GET ${path} (no secret)`, res, bytes);
    if (!expected) {
      fail(path, "a parseable authorized(req) failure line in its api/*.js source", "(could not statically locate one)", `api${path.replace(/^\/api/, "")}.js`);
      continue;
    }
    let body = null;
    try { body = JSON.parse(bytes.toString("utf8")); } catch {}
    if (res.status !== expected.status || JSON.stringify(body) !== JSON.stringify(expected.body)) {
      fail(path, `${expected.status} ${JSON.stringify(expected.body)}`, `${res.status} ${JSON.stringify(body)}`, `api${path.replace(/^\/api/, "")}.js`);
    }
  }

  // ── 10. /c/<slug> for a REAL listed fixture slug ────────────────────────
  // Unlike every check above, this one needs a slug that actually exists,
  // is published, listed and unpaused on THIS deployment -- something a
  // probe can never invent (an unknown slug renders the platform-only
  // fallback, `jsonLd: ""`, no Person block at all). Skipped, never failed,
  // when the caller has no such slug to give -- `evals/probe-live/run.mjs`
  // proves both the checking half (against a fixture server that DOES
  // serve real builder output for a named slug) and this honest-skip half.
  if (creatorSlug) {
    const headFacts = creatorPageHeadFacts();
    const res = await client.request("GET", `/c/${encodeURIComponent(creatorSlug)}`, {
      headers: { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" },
    });
    const bytes = await bufferOf(res);
    const html = bytes.toString("utf8");
    recordSurface(`/c/:slug (--creator-slug, Googlebot)`, res, bytes);

    if (res.status !== 200) {
      fail("/c/:slug", "status 200", res.status, "api/_creator-page.js");
    }

    const canonicalMatch = /<link rel="canonical" href="([^"]+)" \/>/.exec(html);
    if (!canonicalMatch) {
      fail("/c/:slug", 'a <link rel="canonical"> tag', "(absent)", "api/_creator-page.js renderPage");
    }

    for (const code of headFacts.hreflangCodes) {
      const escapedCode = code.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const re = new RegExp(`<link rel="alternate" hreflang="${escapedCode}" href="([^"]+)" \\/>`);
      const m = re.exec(html);
      if (!m) {
        fail("/c/:slug", `a hreflang="${code}" alternate link`, "(absent)", "api/_creator-page.js HREFLANG_CODES");
        continue;
      }
      if (code === "hi" && !m[1].includes(headFacts.hiQuery)) {
        fail("/c/:slug", `hreflang="hi" href containing "${headFacts.hiQuery}"`, m[1], "api/_creator-page.js HI_LANG_QUERY");
      }
    }

    const jsonLdBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((m) => {
        try { return JSON.parse(m[1]); } catch { return null; }
      });
    const person = jsonLdBlocks.find((b) => b && b["@type"] === "Person");
    if (!person) {
      fail("/c/:slug", "a Person JSON-LD block", "(absent or unparseable)", "api/_creator-page.js buildCreatorPageJsonLd");
    } else {
      const errors = validatePersonJsonLd(person);
      if (errors.length) fail("/c/:slug", "a schema-valid Person JSON-LD block", errors.join("; "), "api/_creator-page.js buildCreatorPageJsonLd");
    }
    const faq = jsonLdBlocks.find((b) => b && b["@type"] === "FAQPage");
    if (faq) {
      const errors = validateFaqPageJsonLd(faq);
      if (errors.length) fail("/c/:slug", "a schema-valid FAQPage JSON-LD block", errors.join("; "), "api/_creator-page.js buildCreatorPageJsonLd");
    }
  } else {
    notes.push("/c/:slug checks SKIPPED: no --creator-slug given (no live listed Room can be assumed to exist)");
  }

  // ── 11. WS-R97: /r/<slug>/about for the SAME --creator-slug fixture ────
  // `publicRoomAboutBySlug` is never `listed_at`-gated (this page's own law,
  // `api/_room-about.js`'s header), so any Room `--creator-slug` names is
  // guaranteed published-and-unpaused already and this page must answer for
  // it too — no second flag needed.
  if (creatorSlug) {
    const aboutFacts = roomAboutHeadFacts();
    const res = await client.request("GET", `/r/${encodeURIComponent(creatorSlug)}/about`);
    const bytes = await bufferOf(res);
    const html = bytes.toString("utf8");
    recordSurface(`/r/:slug/about (--creator-slug)`, res, bytes);

    if (res.status !== 200) {
      fail("/r/:slug/about", "status 200", res.status, "api/_room-about.js");
    }

    const canonicalMatch = /<link rel="canonical" href="([^"]+)" \/>/.exec(html);
    if (!canonicalMatch) {
      fail("/r/:slug/about", 'a <link rel="canonical"> tag', "(absent)", "api/_room-about.js renderPage");
    }

    for (const code of aboutFacts.hreflangCodes) {
      const escapedCode = code.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const re = new RegExp(`<link rel="alternate" hreflang="${escapedCode}" href="([^"]+)" \\/>`);
      const m = re.exec(html);
      if (!m) {
        fail("/r/:slug/about", `a hreflang="${code}" alternate link`, "(absent)", "api/_room-about.js HREFLANG_CODES");
        continue;
      }
      if (code === "hi" && !m[1].includes(aboutFacts.hiQuery)) {
        fail("/r/:slug/about", `hreflang="hi" href containing "${aboutFacts.hiQuery}"`, m[1], "api/_room-about.js HI_LANG_QUERY");
      }
    }
  } else {
    notes.push("/r/:slug/about checks SKIPPED: no --creator-slug given (no live published Room can be assumed to exist)");
  }

  // ═════════════════════════════════════════════════════════════════════
  if (json) {
    console.log(JSON.stringify({ ok: findings.length === 0, baseUrl, surfaces, findings, notes }, null, 2));
  } else {
    console.log(`probe-live: ${surfaces.length} surface(s) checked against ${baseUrl}`);
    for (const s of surfaces) {
      console.log(`  ${String(s.status).padEnd(4)} ${(s.contentType || "-").padEnd(42)} ${s.bytes ?? "-"}B  ${s.surface}`);
    }
    if (findings.length) {
      console.log(`\nFAIL  ${findings.length} finding(s):`);
      for (const f of findings) {
        console.log(`  [${f.surface}] expected ${f.expectation}\n        got      ${JSON.stringify(f.observed)}\n        promised by ${f.promisedBy}`);
      }
    } else {
      console.log("\n  ok    0 findings");
    }
    for (const n of notes) console.log(`note: ${n}`);
  }
  process.exit(findings.length ? 1 : 0);
}

main().catch((e) => {
  console.error("probe-live: fatal:", e && e.stack ? e.stack : e);
  process.exit(1);
});
