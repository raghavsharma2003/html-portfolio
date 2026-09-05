// The installable Room (WS-R59) — offline, deterministic, $0, no DB, no
// network, no model call, no GPU, no browser.
//
//   node evals/room-install/run.mjs
//
// Drives the REAL modules a follower's install path goes through:
// `api/_room-manifest.js` (the per-Room manifest builder, over
// `api/_room-publish.js`'s `publicRoomBySlug`), the REAL
// `public/room-sw.js` source (statically scanned, never executed — this
// suite has no browser), and `src/room/installPrompt.ts` (the second-visit
// rule, bundled from source with esbuild exactly like
// `evals/persona-invariants.mjs` bundles its own TS entry, so this is the
// real, currently-shipping predicate, not a hand-copied restatement of it).
//
// ── WHAT THIS SUITE IS ACTUALLY GUARDING ────────────────────────────────
//
// 1. THE MANIFEST BUILDER, EN AND HI. A published Room's manifest carries
//    `<Name> AI`, `?via=install` on `start_url`, the Room's one icon, and
//    `--paper` as both colours; an unpublished/paused Room and an UNKNOWN
//    slug all answer with the platform manifest — never a shape that lets
//    an installer learn which of the three a slug is.
// 2. IDENTICAL BYTES. The platform manifest this file serves is proven,
//    by SHA-256, to be the exact bytes of `public/room.webmanifest` on
//    disk — not a re-serialized copy that could drift from it silently.
// 3. THE WORKER'S STATIC SCAN. `public/room-sw.js`'s real `fetch` handler
//    checks `pathname.startsWith("/api/")` and returns before any cache
//    write is reachable; the file contains no `cache.put(`/`cache.add(`
//    call anywhere that could touch an `/api/` request. NEGATIVE CONTROL:
//    a synthetic worker source that DOES write an `/api/` response to a
//    cache fails this same scan.
// 4. THE SECOND-VISIT RULE, AS A PURE FUNCTION. `noteInstallVisit` never
//    shows on visit 1, does on visit 2; a dismissal (`markInstallDismissed`)
//    goes quiet for 30 days and reopens after; `shouldShowInstallCard`
//    never fires signed-out, never once already installed, and only ever
//    fires without a captured prompt event on iOS.
// 5. THE COPY GATE. The manifest builder's real output for an ordinary
//    creator name trips nothing; a manifest-shaped string carrying a
//    banned word (NEGATIVE CONTROL) fails `scripts/check-copy.mjs`'s
//    rooms-vocabulary rule exactly as any other user-visible string would.
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const {
  resolveRoomManifest,
  buildRoomManifestJson,
  PLATFORM_ROOM_MANIFEST_JSON,
  ROOM_THEME_COLOR,
} = await import(pathToFileURL(join(REPO, "api/_room-manifest.js")).href);
const { scanSource } = await import(pathToFileURL(join(REPO, "scripts/check-copy.mjs")).href);

// ═══ FIXTURE: a tiny, dedicated fake `vy_room` world ═══════════════════════
// `publicRoomBySlug` (api/_room-publish.js) is a single, standalone SELECT
// over `vy_room` — `evals/room-share/run.mjs`'s own minimal-fixture
// precedent, restated here rather than imported, since this suite tests a
// DIFFERENT reader of the same table and owes it no coupling.
const SLUG_EN = "anjali";
const SLUG_HI = "priya";
function freshRooms() {
  return [
    {
      room_id: "d0000000-0000-4000-8000-000000000001",
      slug: SLUG_EN,
      display_name: "Anjali",
      one_line_bio: "JEE physics, one doubt at a time.",
      default_locale: "en",
      published_at: "2026-09-01T00:00:00.000Z",
      paused_at: null,
    },
    {
      room_id: "d0000000-0000-4000-8000-000000000004",
      slug: SLUG_HI,
      display_name: "Priya",
      one_line_bio: "",
      default_locale: "hi",
      published_at: "2026-09-01T00:00:00.000Z",
      paused_at: null,
    },
    {
      room_id: "d0000000-0000-4000-8000-000000000002",
      slug: "paused-room",
      display_name: "Paused Creator",
      one_line_bio: "",
      default_locale: "en",
      published_at: "2026-09-01T00:00:00.000Z",
      paused_at: "2026-09-02T00:00:00.000Z",
    },
    {
      room_id: "d0000000-0000-4000-8000-000000000003",
      slug: "never-published",
      display_name: "Draft Creator",
      one_line_bio: "",
      default_locale: "en",
      published_at: null,
      paused_at: null,
    },
  ];
}

function fakeDb(rooms) {
  return async (sql, params = []) => {
    if (/from vy_room\b/i.test(sql) && /select slug, display_name, one_line_bio, default_locale/i.test(sql)) {
      const slug = String(params[0] || "").toLowerCase();
      const row = rooms.find((r) => r.slug.toLowerCase() === slug && r.published_at != null && r.paused_at == null);
      return row
        ? [{ slug: row.slug, display_name: row.display_name, one_line_bio: row.one_line_bio, default_locale: row.default_locale }]
        : [];
    }
    throw new Error(`fakeDb: unexpected query in evals/room-install: ${sql.slice(0, 80)}`);
  };
}

// ═══ 1. THE MANIFEST BUILDER, EN AND HI ════════════════════════════════════
console.log("\n── 1. the manifest builder ──");
{
  const db = fakeDb(freshRooms());

  const enRow = await resolveRoomManifest(db, SLUG_EN);
  ok("the English room resolves a real row", enRow?.slug === SLUG_EN);
  const enManifest = JSON.parse(buildRoomManifestJson(enRow, { slug: SLUG_EN }));
  ok("name is '<Name> AI'", enManifest.name === "Anjali AI");
  ok("short_name is the creator's own name", enManifest.short_name === "Anjali");
  ok("start_url carries exactly ?via=install", enManifest.start_url === "/r/anjali?via=install");
  ok("display is standalone", enManifest.display === "standalone");
  ok("background_color and theme_color are both --paper", enManifest.background_color === ROOM_THEME_COLOR && enManifest.theme_color === ROOM_THEME_COLOR);
  ok("icons carries exactly the Room's one favicon.svg entry",
    JSON.stringify(enManifest.icons) === JSON.stringify([{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }]));
  ok("description is a non-empty first sentence, never the whole disclosure card",
    typeof enManifest.description === "string" && enManifest.description.length > 0 && !enManifest.description.includes("\n"));

  const hiRow = await resolveRoomManifest(db, SLUG_HI);
  const hiManifest = JSON.parse(buildRoomManifestJson(hiRow, { slug: SLUG_HI }));
  ok("a Hindi-default Room's description is real Hindi, not English carried over",
    /[ऀ-ॿ]/.test(hiManifest.description));
  ok("a Hindi-default Room's name/start_url are unaffected by locale (both are Latin-script by construction)",
    hiManifest.name === "Priya AI" && hiManifest.start_url === "/r/priya?via=install");

  // Unpublished, paused, and unknown all collapse to the SAME platform
  // manifest — never a shape that could tell an installer which of the
  // three a slug is.
  const pausedRow = await resolveRoomManifest(db, "paused-room");
  const draftRow = await resolveRoomManifest(db, "never-published");
  const unknownRow = await resolveRoomManifest(db, "does-not-exist-at-all");
  ok("an unpublished Room resolves null", pausedRow === null && draftRow === null);
  ok("an unknown slug resolves null", unknownRow === null);
  ok("paused/unpublished/unknown all serve the IDENTICAL platform manifest bytes",
    buildRoomManifestJson(pausedRow) === PLATFORM_ROOM_MANIFEST_JSON &&
      buildRoomManifestJson(draftRow) === PLATFORM_ROOM_MANIFEST_JSON &&
      buildRoomManifestJson(unknownRow) === PLATFORM_ROOM_MANIFEST_JSON);
}

// ═══ 2. IDENTICAL BYTES ═════════════════════════════════════════════════════
console.log("\n── 2. the platform manifest is byte-identical to public/room.webmanifest ──");
{
  const onDisk = readFileSync(join(REPO, "public/room.webmanifest"), "utf8");
  const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
  ok("PLATFORM_ROOM_MANIFEST_JSON's SHA-256 matches public/room.webmanifest's own bytes on disk",
    sha(PLATFORM_ROOM_MANIFEST_JSON) === sha(onDisk),
    `built=${sha(PLATFORM_ROOM_MANIFEST_JSON).slice(0, 12)} disk=${sha(onDisk).slice(0, 12)}`);
  ok("...and the two are literally string-equal, not just same-hash by coincidence",
    PLATFORM_ROOM_MANIFEST_JSON === onDisk);
  // Confirms it is actually valid JSON too, not merely byte-equal text.
  ok("public/room.webmanifest itself parses as JSON", (() => {
    try { JSON.parse(onDisk); return true; } catch { return false; }
  })());
}

// ═══ 3. THE WORKER'S STATIC SCAN ════════════════════════════════════════════
console.log("\n── 3. public/room-sw.js: the fetch handler never caches /api/ ──");

/** Brace-depth walk from the first `{` after `marker` to its matching `}` —
 *  robust to whatever surrounds the listener, unlike a single regex trying
 *  to match the whole block. Returns the body text between the braces, or
 *  null if `marker` (or a `{`) is not found. */
function listenerBody(source, eventName) {
  const marker = new RegExp(`self\\.addEventListener\\(\\s*["']${eventName}["']\\s*,`);
  const startMatch = marker.exec(source);
  if (!startMatch) return null;
  const openIdx = source.indexOf("{", startMatch.index);
  if (openIdx === -1) return null;
  let depth = 0;
  for (let j = openIdx; j < source.length; j++) {
    if (source[j] === "{") depth++;
    else if (source[j] === "}") {
      depth--;
      if (depth === 0) return source.slice(openIdx + 1, j);
    }
  }
  return null;
}

/** PURE, and the real check `evals/room-install/run.mjs` guards the shipped
 *  worker with: the `fetch` listener must contain an unconditional
 *  `pathname.startsWith("/api/")` guard that returns, and no cache-writing
 *  call (`.put(`) anywhere in that listener may be reachable before it. */
function scanWorkerApiCaching(source) {
  const body = listenerBody(source, "fetch");
  if (body === null) return { ok: false, reason: "no fetch listener found" };
  const guardRe = /pathname\.startsWith\(\s*["']\/api\/["']\s*\)\s*\)\s*return;/;
  const guardMatch = guardRe.exec(body);
  const putRe = /\.put\(/g;
  const putOffsets = [];
  let m;
  while ((m = putRe.exec(body))) putOffsets.push(m.index);
  if (!guardMatch) {
    return putOffsets.length === 0
      ? { ok: true }
      : { ok: false, reason: "cache write present with no /api/ guard in the fetch listener at all" };
  }
  const unsafe = putOffsets.filter((idx) => idx < guardMatch.index);
  return unsafe.length === 0
    ? { ok: true }
    : { ok: false, reason: `cache write at offset ${unsafe[0]} is reachable before the /api/ guard (offset ${guardMatch.index})` };
}

{
  const swSource = readFileSync(join(REPO, "public/room-sw.js"), "utf8");
  const real = scanWorkerApiCaching(swSource);
  ok("the real public/room-sw.js fetch handler passes the scan", real.ok, real.reason || "");
  ok("the real worker's fetch listener contains the /api/ guard as an unconditional early return",
    /pathname\.startsWith\(\s*["']\/api\/["']\s*\)\s*\)\s*return;/.test(listenerBody(swSource, "fetch") || ""));
  ok("the whole file never calls cache.put/cache.add anywhere (precache uses cache.addAll during install only)",
    !/cache\.put\(|cache\.add\(/.test(swSource));
  ok("derivePrecacheList itself skips any discovered URL under /api/",
    /if\s*\(\s*url\.startsWith\(\s*["']\/api\/["']\s*\)\s*\)\s*continue;/.test(swSource));

  // NEGATIVE CONTROL: a worker whose fetch handler DOES write an /api/
  // response to a cache must fail this exact scan.
  const brokenWorker = `
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  event.respondWith(
    caches.open("bad-cache").then((cache) =>
      fetch(event.request).then((res) => {
        cache.put(event.request, res.clone());
        return res;
      }),
    ),
  );
  if (url.pathname.startsWith("/api/")) return;
});
`;
  const broken = scanWorkerApiCaching(brokenWorker);
  ok("NEGATIVE CONTROL: a worker that caches /api/ (guard after the write) fails the scan", broken.ok === false, broken.reason);

  const noGuardWorker = `
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.open("bad-cache").then((cache) =>
      fetch(event.request).then((res) => {
        cache.put(event.request, res.clone());
        return res;
      }),
    ),
  );
});
`;
  const noGuard = scanWorkerApiCaching(noGuardWorker);
  ok("NEGATIVE CONTROL: a worker with a cache write and NO /api/ guard at all fails the scan", noGuard.ok === false, noGuard.reason);
}

// ═══ 4. THE SECOND-VISIT RULE, AS A PURE FUNCTION ══════════════════════════
console.log("\n── 4. src/room/installPrompt.ts, bundled and run for real ──");
{
  const OUT = mkdtempSync(join(tmpdir(), "room-install-eval-"));
  const BUNDLE = join(OUT, "installPrompt.bundle.mjs");
  execSync(
    `npx esbuild ${join(REPO, "src/room/installPrompt.ts")} --bundle --format=esm --platform=node ` +
      `--outfile=${BUNDLE} --log-level=error`,
    { stdio: "inherit", cwd: REPO },
  );
  const { noteInstallVisit, markInstallDismissed, shouldShowInstallCard } =
    await import(pathToFileURL(BUNDLE).href);

  /** A tiny in-memory `InstallStorage` — never real `localStorage`, so this
   *  runs with no browser at all. */
  function fakeStorage() {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => void map.set(k, String(v)),
      __map: map,
    };
  }

  const DAY = 24 * 60 * 60 * 1000;
  {
    const storage = fakeStorage();
    const now = 1_000_000_000_000;
    const first = noteInstallVisit(storage, "anjali", now);
    ok("visit 1: not ready yet", first.visits === 1 && first.readyBySecondVisit === false);
    const second = noteInstallVisit(storage, "anjali", now + DAY);
    ok("visit 2: ready", second.visits === 2 && second.readyBySecondVisit === true);
    const third = noteInstallVisit(storage, "anjali", now + 2 * DAY);
    ok("visit 3: still ready (not a one-shot)", third.readyBySecondVisit === true);

    // A second SLUG on the same storage starts its own count at zero.
    const otherRoom = noteInstallVisit(storage, "priya", now);
    ok("visits are counted PER SLUG: a second Room's first visit is still visit 1", otherRoom.visits === 1);
  }

  {
    const storage = fakeStorage();
    const now = 1_000_000_000_000;
    noteInstallVisit(storage, "anjali", now);
    noteInstallVisit(storage, "anjali", now + DAY);
    markInstallDismissed(storage, "anjali", now + DAY);
    const soonAfter = noteInstallVisit(storage, "anjali", now + DAY + 60_000);
    ok("dismissed a minute ago: still quiet", soonAfter.dismissed === true);
    const justUnder30 = noteInstallVisit(storage, "anjali", now + DAY + 29 * DAY);
    ok("dismissed 29 days ago: still quiet", justUnder30.dismissed === true);
    const past30 = noteInstallVisit(storage, "anjali", now + DAY + 31 * DAY);
    ok("dismissed 31 days ago: quiet period over", past30.dismissed === false);
  }

  {
    // A storage that throws (private browsing, a blocked site setting) never
    // crashes — it answers "not ready" instead, `noteInstallVisit`'s own
    // best-effort law.
    const throwing = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    };
    const state = noteInstallVisit(throwing, "anjali", Date.now());
    ok("NEGATIVE CONTROL: a throwing storage answers 'not ready' rather than throwing",
      state.readyBySecondVisit === false && state.dismissed === false);
    ok("a null/absent storage is equally safe", noteInstallVisit(null, "anjali", Date.now()).readyBySecondVisit === false);
  }

  {
    const base = { signedIn: true, talking: true, readyBySecondVisit: true, dismissed: false, alreadyInstalled: false, hasPromptEvent: true, isIOS: false };
    ok("shows: signed in, talking, ready, not dismissed, not installed, prompt captured", shouldShowInstallCard(base));
    ok("never signed out", shouldShowInstallCard({ ...base, signedIn: false }) === false);
    ok("never off the talking screen", shouldShowInstallCard({ ...base, talking: false }) === false);
    ok("never before the second visit", shouldShowInstallCard({ ...base, readyBySecondVisit: false }) === false);
    ok("never inside a live dismissal", shouldShowInstallCard({ ...base, dismissed: true }) === false);
    ok("never once already installed", shouldShowInstallCard({ ...base, alreadyInstalled: true }) === false);
    ok("a non-iOS browser with no captured prompt event never shows (nothing to trigger)",
      shouldShowInstallCard({ ...base, hasPromptEvent: false, isIOS: false }) === false);
    ok("iOS shows even with NO captured prompt event (it never fires one) — the one exception",
      shouldShowInstallCard({ ...base, hasPromptEvent: false, isIOS: true }) === true);
  }
}

// ═══ 5. THE COPY GATE ═══════════════════════════════════════════════════════
console.log("\n── 5. the manifest builder's copy, real and negative-controlled ──");
{
  const db = fakeDb(freshRooms());
  const enRow = await resolveRoomManifest(db, SLUG_EN);
  const realManifest = buildRoomManifestJson(enRow, { slug: SLUG_EN });
  const realHits = scanSource("room-manifest-copy.ts", realManifest, { rules: "full", codename: true, roomsVocab: true });
  ok("the real manifest builder's output for an ordinary creator name trips nothing", realHits.length === 0, JSON.stringify(realHits));

  const hiRow = await resolveRoomManifest(db, SLUG_HI);
  const hiManifest = buildRoomManifestJson(hiRow, { slug: SLUG_HI });
  const hiHits = scanSource("room-manifest-copy.ts", hiManifest, { rules: "full", codename: true, roomsVocab: true });
  ok("the real Hindi manifest's output trips nothing either", hiHits.length === 0, JSON.stringify(hiHits));

  // NEGATIVE CONTROL: a manifest-shaped string carrying a banned word fails
  // the same rooms-vocabulary rule `evals/room-locale/run.mjs` already
  // proves against Hindi copy — the same rule, an English manifest string
  // this time.
  const badManifestSnippet = 'const m = { description: "This AI clone learns from your archive." };';
  const badHits = scanSource("bad-manifest-copy.ts", badManifestSnippet, { rules: "full", codename: true, roomsVocab: true });
  ok("NEGATIVE CONTROL: a manifest-shaped string with a banned word fails the rooms-vocabulary rule",
    badHits.some((o) => o.rule === "rooms-vocabulary"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
