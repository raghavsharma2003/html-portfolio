// WS-R94. THE HARNESS: an `http.createServer` that serves the REAL built
// `dist/` and routes `/api/room` and `/c/<slug>` to the REAL handlers in
// `api/room.js` / `api/creator-page.js`, over a fixture database, with the
// model call and Supabase auth call both faked at the module boundary — see
// `loader.mjs`'s header for the redirect mechanism and why it exists.
//
// ── WHY THIS FILE, AND NOT A SECOND FIXTURE-ANSWERING FAKE SERVER ─────────
//
// `evals/probe-live/fakeServer.mjs` (the named precedent in this workstream's
// own brief) answers every route with HAND-WRITTEN expected responses — it
// proves `scripts/probe-live.mjs`'s own checking logic, never the real
// handlers. This file is the other half nothing in this repo has built yet:
// the REAL `api/room.js` (`withDoor(q, "room.js", handler)`, unmodified, not
// even the `deps` it is called with) answering for real, against a fake `db`
// injected at the `./_db.js` module boundary. Every decision a follower's
// journey depends on — rate limiting, session minting/verification, the
// honesty gate, the disclosure card, the referral hash, the export/forget
// SQL — is the shipping code, not a restatement of it.
//
// ── THE THREE REDIRECTS, AND WHY EACH IS THE NARROWEST POSSIBLE ────────────
//
//   ./_db.js      -> stubs/db.mjs                  the fixture database.
//   ./_surface.js -> stubs/surface-with-fake-model.mjs   `think()` only.
//   ./_auth.js    -> stubs/auth-with-fake-user.mjs       `userFromToken()` only.
//
// Nothing else is faked. `api/_teachersheet.js`'s real `loadTeacherAgent`
// runs for real against a fixture `vy_teacher_sheet` row (added to
// `evals/room-doors/fixtures.mjs`, append-only, this workstream's own
// extension — see that file's own WS-R94 comment) and calls the REAL
// `sheetToModule` from the REAL, committed `api/_engine.gen.js` bundle. The
// honesty gate (`guardReply`), the disclosure predicate, the rate limiter,
// the referral hash, the erasure cascade's own SQL text — none of it is
// reimplemented here.
import { register } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { dirname, join, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DIST = join(ROOT, "dist");

// MUST happen before any dynamic import of api/room.js or anything it
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

const { setFixtureDb } = await import("./stubs/db.mjs");
const { setFakeReply } = await import("./stubs/surface-with-fake-model.mjs");
const doorsFixtures = await import(pathToFileURL(join(ROOT, "evals/room-doors/fixtures.mjs")).href);
const {
  freshDoorsState, doorsDb, loadFixtureAgent,
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
  ".txt": "text/plain; charset=utf-8",
};

/** `npx vite build` — this workstream's brief, law 1: "serves `dist/`
 *  (build first)". Cheap (~2s per the release gate's own "web build" line)
 *  and run unconditionally so a stale checkout never serves yesterday's
 *  bundle silently. */
export function ensureBuilt() {
  execSync("npx vite build", { cwd: ROOT, stdio: "inherit" });
}

/**
 * The fixture world every scenario starts from: `evals/room-doors/fixtures.mjs`'s
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
 * Starts the harness server. Returns `{ url, state, stop, setFakeReply }` —
 * `state` is the SAME mutable fixture object the injected `db` reads and
 * writes, so a scenario can assert on real rows after driving the real
 * browser through the real doors (`follower.mjs`'s own pattern).
 */
export async function startHarness({ port = 0, build = true } = {}) {
  if (build) ensureBuilt();
  const state = await buildFixtureState();
  setFixtureDb(doorsDb(state));

  const roomHandler = (await import(pathToFileURL(join(ROOT, "api", "room.js")).href)).default;
  const creatorPageHandler = (await import(pathToFileURL(join(ROOT, "api", "creator-page.js")).href)).default;

  const server = createServer(async (req, res) => {
    withVercelShims(res);
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const pathname = url.pathname;

      if (pathname === "/api/room" && req.method === "POST") {
        req.body = await readJsonBody(req);
        return await roomHandler(req, res);
      }
      if (pathname === "/api/room" && req.method === "OPTIONS") {
        req.body = {};
        return await roomHandler(req, res);
      }

      const creatorMatch = /^\/c\/([^/]+)$/.exec(pathname);
      if (creatorMatch && (req.method === "GET" || req.method === "HEAD")) {
        req.query = { slug: decodeURIComponent(creatorMatch[1]), lang: url.searchParams.get("lang") || "" };
        return await creatorPageHandler(req, res);
      }

      // `/r/:slug` -> the real built room.html (vercel.json's own plain
      // fallback rewrite — this harness does not drive the bot-unfurl branch,
      // which is unrelated to a follower's own journey).
      if (/^\/r\/[^/]+\/?$/.test(pathname) && req.method === "GET") {
        if (await serveDistFile(res, "room.html")) return;
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
    setFakeReply,
    // The fixture's own auth-user-uuid-to-person-uuid bridge (`personForAccount`'s
    // `vy_account_person` mapping, `evals/room/fixtures.mjs`'s own constants):
    // `followerBearer` is what a scenario sends as `Authorization: Bearer`;
    // `followerPerson` is what `state.followers`/`state.referrals` rows are
    // actually KEYED by, and the two are deliberately different uuids so a
    // scenario asserting on `state` never accidentally matches on the
    // bearer by coincidence.
    followerBearer: { A: USER_A, B: USER_B },
    followerPerson: { A: PERSON_A, B: PERSON_B },
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}
