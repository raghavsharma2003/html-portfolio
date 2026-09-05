// WS-R94, folded onto ONE contract by WS-R109 (wave sixteen, per this
// workstream's own law 1: "fold harness-creator.mjs's fetch-intercept seam
// and harness.mjs's module-resolution seam onto ONE contract... if the
// fetch seam is not load-bearing for the studio's own NEON_URL/SUPABASE_URL
// reads"). It was not: every one of the five creator doors this fold now
// also routes (`api/replica.js`, `api/context-items.js`,
// `api/review-queue.js`, `api/readiness.js`, `api/room-publish.js`) and
// their transitive module graph resolve `./_db.js`/`./_auth.js` the SAME
// relative way `api/room.js` always has (confirmed by grep before this
// fold, not assumed), so `../loader.mjs`'s existing module-resolution
// redirect already reaches every one of them — the ONE piece that did not
// already work is `requireUser`'s own internal call to the REAL
// `_auth.js`'s `userFromToken` (a same-module lexical reference re-exporting
// cannot override), fixed by giving the auth stub its OWN `requireUser`
// rather than re-exporting the real one (`stubs/auth-with-fake-user.mjs`'s
// own header). `evals/rehearsal/harness-creator.mjs` is retired — its own
// fetch-intercept-over-fake-Neon-host mechanism is no longer needed by
// anything in this repo, and keeping it around as a second, unused copy of
// the Vercel req/res shim is exactly what this workstream's law 1 forbids.
//
// ── WHY THIS FILE, AND NOT A SECOND FIXTURE-ANSWERING FAKE SERVER ─────────
//
// `evals/probe-live/fakeServer.mjs` (the named precedent in this workstream's
// own brief) answers every route with HAND-WRITTEN expected responses — it
// proves `scripts/probe-live.mjs`'s own checking logic, never the real
// handlers. This file is the other half nothing in this repo had built
// before WS-R94: the REAL `api/room.js` (`withDoor(q, "room.js", handler)`,
// unmodified, not even the `deps` it is called with) and now the REAL
// `api/creator-page.js`, `api/room-about.js`, `api/replica.js`,
// `api/context-items.js`, `api/review-queue.js`, `api/readiness.js`, and
// `api/room-publish.js` answering for real, against a fake `db` injected at
// the `./_db.js` module boundary. Every decision either rehearsal's journey
// depends on — rate limiting, session minting/verification, the honesty
// gate, the disclosure card, the referral hash, the export/forget SQL, the
// Readiness floor, the never-rule bite — is the shipping code, not a
// restatement of it.
//
// ── THE THREE REDIRECTS, AND WHY EACH IS THE NARROWEST POSSIBLE ────────────
//
//   ./_db.js      -> stubs/db.mjs                  the fixture database.
//   ./_surface.js -> stubs/surface-with-fake-model.mjs   `think()` only.
//   ./_auth.js    -> stubs/auth-with-fake-user.mjs       `userFromToken()`/`requireUser()`.
//
// Nothing else is faked. `api/_teachersheet.js`'s real `loadTeacherAgent`
// runs for real against a fixture `vy_teacher_sheet` row (added to
// `evals/room-doors/fixtures.mjs`, append-only, WS-R94's own extension) and
// calls the REAL `sheetToModule` from the REAL, committed `api/_engine.gen.js`
// bundle. The honesty gate (`guardReply`), the disclosure predicate, the
// rate limiter, the referral hash, the erasure cascade's own SQL text, the
// Readiness computation, the review queue's decision predicates — none of
// it is reimplemented here.
//
// ── THE NETWORK GUARD (WS-R109) ────────────────────────────────────────────
//
// `evals/rehearsal/harness-creator.mjs`'s own fetch interceptor threw a
// loud, named error on any fetch target it did not recognise — a real
// safety property (`ws-common.md`'s own "no network beyond 127.0.0.1")
// that the module-redirect mechanism alone does not provide, since it only
// covers `_db.js`/`_surface.js`/`_auth.js`'s OWN fetches, not a fetch some
// other module in either walk's call graph might make. `installNetworkGuard`
// below restores that property for BOTH rehearsals without reintroducing
// the fake-Neon-host mechanism it used to require it: loopback passes
// through, everything else throws by name.
import { register } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { dirname, join, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DIST = join(ROOT, "dist");

// MUST happen before any dynamic import of api/*.js or anything it
// transitively imports — `loader.mjs`'s redirect only catches resolutions
// that happen AFTER `register()` runs.
register("./loader.mjs", import.meta.url);

// `api/_room-surface.js`'s `sessionSecret()`: unset means the Room is OFF,
// everywhere, immediately (`RoomError("room_unconfigured", 503)`) — the
// correct posture in production, and exactly the wall this harness would
// otherwise hit on `join`/`say`/every session-consuming op. `evals/room-taste/
// run.mjs`/`evals/room-locale/run.mjs`'s own precedent (a 48-char fixture
// secret), never overwriting a real value if one is somehow already set.
process.env.ROOM_SESSION_SECRET = process.env.ROOM_SESSION_SECRET || "r".repeat(48);
// WS-R109. `api/checkins.js`'s `designs` op reads `ROOM_PUSH_VAPID_PUBLIC`
// straight off `process.env` on every call (never cached) and hands it back
// as `push_public_key` — a null/unset key is what makes the account page's
// own push-enable control render nothing at all (`AccountPage.tsx`'s own
// "renders nothing when unset" law). `follower.mjs`'s own push-subscription
// step needs the control to render; the exact bytes never matter because
// that step also installs a page-level fake `PushManager` (real browser
// push subscription creation reaches a real push service over the real
// internet, which this harness's own network guard and `ws-common.md`'s "no
// network beyond 127.0.0.1" both forbid) — any syntactically valid
// base64url string decodes fine through `b64uToUint8Array` on the way into
// that fake.
process.env.ROOM_PUSH_VAPID_PUBLIC = process.env.ROOM_PUSH_VAPID_PUBLIC || "B".repeat(87);

const { setFixtureDb } = await import("./stubs/db.mjs");
const { setFakeReply } = await import("./stubs/surface-with-fake-model.mjs");
const { REHEARSAL_OWNER_TOKEN, REHEARSAL_OWNER } = await import("./stubs/auth-with-fake-user.mjs");
export { REHEARSAL_OWNER_TOKEN, REHEARSAL_OWNER };
const doorsFixtures = await import(pathToFileURL(join(ROOT, "evals/room-doors/fixtures.mjs")).href);
const {
  freshDoorsState, doorsDb, loadFixtureAgent,
  freshRehearsalCreatorState, rehearsalCreatorDb,
  SLUG, AGENT_ID, USER_A, USER_B, PERSON_A, PERSON_B,
} = doorsFixtures;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

// WS-R109. The five creator doors `evals/rehearsal/harness-creator.mjs` used
// to serve on its OWN separate server — folded in here so ONE server answers
// both rehearsals' routes. Loaded once at server start (same style as the
// room/creator-page/room-about handlers below): a missing or broken door
// fails the harness loudly at startup, never on the first request that
// happens to reach it.
const CREATOR_DOOR_MODULES = {
  "/api/replica": "../../api/replica.js",
  "/api/context-items": "../../api/context-items.js",
  "/api/review-queue": "../../api/review-queue.js",
  "/api/readiness": "../../api/readiness.js",
  "/api/room-publish": "../../api/room-publish.js",
  // WS-R109. `api/checkins.js` is not creator-only (its own header: FOLLOWER
  // ops — `designs`/`opt_in`/`stop`/`list_mine`/`telegram_status`/
  // `telegram_set` — are session-verified through `_room-surface.js`
  // directly, never `requireUser`, so the auth stub's own reimplementation
  // above is not even reached on that path), routed here regardless of
  // `kind` for `evals/rehearsal/follower.mjs`'s own check-in opt-in and push
  // subscription step. It shadows the same-named entry `FALLBACK_JSON_ROUTES`
  // below still carries (folded from `harness-creator.mjs`, left in place
  // rather than pruned so that table stays byte-identical to what that file
  // used to answer for every OTHER route it names) — the real-door check
  // below always wins.
  "/api/checkins": "../../api/checkins.js",
};

/**
 * WS-R109, folded verbatim from `evals/rehearsal/harness-creator.mjs`'s own
 * table (unchanged): the REAL `StudioApp` reads several dozen `/api/*`
 * routes on mount, not only the five routed for real above — the same fact
 * `src/studio/layoutFixture.tsx`'s own `ROUTES` table exists to answer for
 * the layout gate. Every one of those routes gets its own safe empty shape
 * here, the same shapes that file already uses. Anything genuinely new to
 * both files gets `{}`, which is what an unguarded reader crashes on —
 * named as a gap rather than guessed at.
 */
const FALLBACK_JSON_ROUTES = {
  "/api/replica-source": { sources: [] },
  "/api/replica-review": { review: null, items: [] },
  "/api/replica-activity": { replica_id: null, generated_at: new Date(0).toISOString(), jobs: [], lanes: [], in_flight: false, next_poll_ms: null },
  "/api/replica-runtime": { status: null, blockers: [] },
  "/api/clone-channel": { channels: [] },
  "/api/room-cohorts": { cohorts: [], verdict: { verdict: "not_measurable_yet", cohort_week: null, week6_return_share: null } },
  "/api/invites": { invites: [], quota: { max: 3, used: 0, remaining: 3 } },
  "/api/handoff": { enabled: false, monthly_cap: 0, counts: { drafted: 0, sent: 0, answered: 0, withdrawn: 0 }, next: null },
  "/api/checkins": { designs: [] },
  "/api/org": { org: null },
  "/api/channel-watch": { attestations: [], watches: [], statements: [], statement_set: "channel-ownership-v1", extraction_available: false },
  "/api/teacher-sheet": { sheet: null, draft: null },
  "/api/replica-claims": { claims: [] },
  "/api/replica-voice": { versions: [] },
  "/api/replica-consent": { consent: null },
  "/api/replica-identity": { identity: null },
  "/api/replica-liveness": { liveness: null },
  "/api/replica-person-model": { model: null, blockers: [] },
  "/api/replica-calibration": { calibration: null },
  "/api/replica-dialogue": { turns: [] },
  "/api/replica-feedback": { feedback: [] },
  "/api/replica-candidate-eval": { candidates: [] },
  "/api/replica-speech": { speech: null },
  "/api/replica-voice-preference": { comparison: null },
  "/api/replica-voice-delivery-policy": { policy: null },
  "/api/replica-voice-trial": { trial: null },
  "/api/replica-voice-preview": { preview: null },
  "/api/replica-provider-consent": { consents: [] },
  "/api/voice-preview": { preview: null },
  "/api/video-enroll": {
    enrollments: [], extraction_configured: false,
    limits: { perOwnerPerDay: 4, maxDurationMs: 7_200_000, maxAudioBytes: 536_870_912, globalPerDay: 20 },
  },
  "/api/mirror-call": { contract: null, call: null },
};

/** WS-R109. Loopback passes through untouched (this harness's own origin,
 *  or `follower.mjs`/`creator.mjs` driving a step with plain `fetch` rather
 *  than the browser); everything else throws by name rather than reaching a
 *  real network — folded from `evals/rehearsal/harness-creator.mjs`'s own
 *  fetch interceptor, generalised from "answer two fixed fake hosts" to
 *  "never leave 127.0.0.1", since nothing in either rehearsal's own scope
 *  needs a SECOND fake host any more (the module-redirect above already
 *  answers Neon/Supabase without a network round trip at all). */
function installNetworkGuard() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
      return realFetch(input, init);
    }
    throw new Error(`rehearsal harness: unmodelled fetch target ${url} — no network beyond 127.0.0.1 (ws-common.md's own law)`);
  };
  return () => { globalThis.fetch = realFetch; };
}

/** `npx vite build` — this workstream's brief, law 1: "serves `dist/`
 *  (build first)". Cheap (~2s per the release gate's own "web build" line)
 *  and run unconditionally so a stale checkout never serves yesterday's
 *  bundle silently. */
export function ensureBuilt() {
  execSync("npx vite build", { cwd: ROOT, stdio: "inherit" });
}

/**
 * The follower rehearsal's own fixture world: `evals/room-doors/fixtures.mjs`'s
 * own `freshDoorsState()`, plus the ONE row this harness needs that no other
 * suite in this repo has ever needed — a published `vy_teacher_sheet` for
 * SLUG, built from the SAME `DEMO_TEACHER`-derived `SHEET` object
 * `evals/room/fixtures.mjs`'s own `loadFixtureAgent` already bundles for
 * every direct-call Room suite, so this is not a second, divergent sheet.
 */
export async function buildFixtureState() {
  const state = freshDoorsState();
  state.rooms[0].taste_enabled = true;
  // WS-R94: `api/_creator-page.js`'s own listing gate — `/c/<slug>` (the
  // taste island) requires `listed_at is not null`, which no OTHER suite
  // sharing this fixture had a reason to set.
  state.rooms[0].listed_at = "2026-08-01T00:00:00.000Z";
  state.rooms[0].one_line_bio = "JEE physics, eleven years at the board.";
  const { SHEET } = await loadFixtureAgent(ROOT);
  state.teacherSheets.push({
    sheet_id: "f1e10000-0000-4000-8000-000000000001",
    agent_id: AGENT_ID,
    version: SHEET.version,
    sheet: SHEET,
    status: "published",
    consent_artifact_id: "f1e10000-0000-4000-8000-000000000002",
    published_at: "2026-08-01T00:00:00.000Z",
    slug: SLUG,
  });
  return state;
}

function withVercelShims(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    if (!res.hasHeader("content-type")) res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
    return res;
  };
  res.send = (body) => {
    if (Buffer.isBuffer(body) || typeof body === "string") {
      res.end(body);
    } else {
      if (!res.hasHeader("content-type")) res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(body));
    }
    return res;
  };
  return res;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function serveDistFile(res, relPath) {
  const filePath = join(DIST, relPath);
  try {
    const bytes = await readFile(filePath);
    res.writeHead(200, { "content-type": CONTENT_TYPES[extname(filePath)] || "application/octet-stream" });
    res.end(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Starts the harness server. `kind: "follower"` (default) builds the
 * follower fixture world (`buildFixtureState()`/`doorsDb`, one published
 * Room, two known followers); `kind: "creator"` builds the creator-journey
 * fixture world (`freshRehearsalCreatorState()`/`rehearsalCreatorDb`, a
 * brand-new owner with nothing yet) — the SAME server code routes both,
 * this workstream's own fold. Returns `{ url, state, stop, setFakeReply,
 * followerBearer, followerPerson }` — `state` is the SAME mutable fixture
 * object the injected `db` reads and writes, so a scenario can assert on
 * real rows after driving the real browser through the real doors, and can
 * seed further rows into it before a step that needs a fixture shortcut
 * (`follower.mjs`'s own receipts/session-worked steps, `creator.mjs`'s own
 * showcase seed).
 */
export async function startHarness({ port = 0, build = true, kind = "follower" } = {}) {
  if (build) ensureBuilt();
  const restoreFetch = installNetworkGuard();
  const state = kind === "creator" ? freshRehearsalCreatorState() : await buildFixtureState();
  const db = kind === "creator" ? rehearsalCreatorDb(state) : doorsDb(state);
  setFixtureDb(db);

  const roomHandler = (await import(pathToFileURL(join(ROOT, "api", "room.js")).href)).default;
  const creatorPageHandler = (await import(pathToFileURL(join(ROOT, "api", "creator-page.js")).href)).default;
  const roomAboutHandler = (await import(pathToFileURL(join(ROOT, "api", "room-about.js")).href)).default;
  const creatorDoors = {};
  for (const [route, relPath] of Object.entries(CREATOR_DOOR_MODULES)) {
    creatorDoors[route] = (await import(pathToFileURL(join(HERE, relPath)).href)).default;
  }

  const server = createServer(async (req, res) => {
    withVercelShims(res);
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const pathname = url.pathname;
      req.query = Object.fromEntries(url.searchParams);
      if (req.method !== "GET" && req.method !== "HEAD") {
        req.body = await readJsonBody(req);
      }

      if (pathname === "/api/room" && (req.method === "POST" || req.method === "OPTIONS")) {
        return await roomHandler(req, res);
      }

      const creatorDoor = creatorDoors[pathname];
      if (creatorDoor) {
        return await creatorDoor(req, res);
      }

      const creatorMatch = /^\/c\/([^/]+)$/.exec(pathname);
      if (creatorMatch && (req.method === "GET" || req.method === "HEAD")) {
        req.query = { slug: decodeURIComponent(creatorMatch[1]), lang: url.searchParams.get("lang") || "" };
        return await creatorPageHandler(req, res);
      }

      // `/r/:slug/about` — the transparency page (WS-R97, `api/room-about.js`
      // over `api/_room-about.js`). Checked BEFORE the plain `/r/:slug` room
      // fallback below (though the two regexes never actually collide: the
      // generic one requires nothing after the slug but an optional trailing
      // slash, so `/r/anjali/about` never matches it either way).
      const aboutMatch = /^\/r\/([^/]+)\/about\/?$/.exec(pathname);
      if (aboutMatch && (req.method === "GET" || req.method === "HEAD")) {
        req.query = { slug: decodeURIComponent(aboutMatch[1]), lang: url.searchParams.get("lang") || "" };
        return await roomAboutHandler(req, res);
      }

      // `/r/:slug` -> the real built room.html (vercel.json's own plain
      // fallback rewrite — this harness does not drive the bot-unfurl branch,
      // which is unrelated to a follower's own journey).
      if (/^\/r\/[^/]+\/?$/.test(pathname) && req.method === "GET") {
        if (await serveDistFile(res, "room.html")) return;
      }

      // Every unrecognised `/api/*` route: the studio's own fixture-safe
      // empty shape (WS-R109, folded from `harness-creator.mjs`) — the
      // creator walk's own `StudioApp` reads several dozen routes on mount
      // that this harness has no real door for.
      if (pathname.startsWith("/api/")) {
        res.status(200).json(FALLBACK_JSON_ROUTES[pathname] ?? {});
        return;
      }

      // Every other GET: a literal file under dist/, or dist/index.html for
      // an unknown top-level path (mirrors Vite's own dev-server fallback;
      // this harness never needs SPA client-side routing outside /r/:slug).
      if (req.method === "GET" || req.method === "HEAD") {
        const rel = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
        if (await serveDistFile(res, rel)) return;
      }

      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(error && error.stack ? error.stack : error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const bound = server.address();
  return {
    server,
    url: `http://127.0.0.1:${bound.port}`,
    state,
    // WS-R109. The real fixture `db` function itself (`doorsDb(state)` or
    // `rehearsalCreatorDb(state)`, whichever `kind` built) — the SAME one
    // `setFixtureDb` handed the `_db.js` redirect, so a scenario can drive a
    // function-level-DI module directly (`api/_payments.js`'s `applyWebhook`
    // takes `db` as its own first argument, never through `./_db.js` at
    // all) against the identical fixture world the browser's own requests
    // are mutating, rather than a second, disconnected one.
    db,
    setFakeReply,
    // The fixture's own auth-user-uuid-to-person-uuid bridge (`personForAccount`'s
    // `vy_account_person` mapping, `evals/room/fixtures.mjs`'s own constants):
    // `followerBearer` is what a scenario sends as `Authorization: Bearer`;
    // `followerPerson` is what `state.followers`/`state.referrals` rows are
    // actually KEYED by, and the two are deliberately different uuids so a
    // scenario asserting on `state` never accidentally matches on the
    // bearer by coincidence. Meaningless for `kind: "creator"` (no follower
    // ever joins in that walk) but harmless to return either way.
    followerBearer: { A: USER_A, B: USER_B },
    followerPerson: { A: PERSON_A, B: PERSON_B },
    stop: async () => {
      restoreFetch();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
