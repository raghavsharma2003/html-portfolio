// WS-R95 (wave fifteen) — the creator journey rehearsal's harness.
//
// A real `http.createServer` that serves the real build (`dist/`, built by
// `npx vite build` before this runs) and routes `/api/<name>` to the REAL
// handler in `api/<name>.js`, with a Vercel-shaped `req`/`res` (read
// `api/_surface.js` and `api/room-publish.js` to get the shape right;
// `scripts/probe-live.mjs`'s fake server and `evals/probe-live/fakeServer.mjs`
// are the precedents named in this workstream's brief, though neither of
// them routes to a REAL handler — every route in both is a canned response,
// which is why this file exists rather than extending either).
//
// This is `evals/rehearsal/harness-creator.mjs` because, at the time this
// workstream ran, its wave-fifteen sibling WS-R94 (which builds the shared
// contract, `evals/rehearsal/harness.mjs`) had not yet landed in THIS
// worktree — siblings in the same wave do not see each other's uncommitted
// work (ws-common.md's own note). This file follows the SAME shape WS-R94's
// brief describes so the main loop can fold the two into one at the merge:
// a local server over `dist/`, real `api/*.js` handlers, the door-battery
// fixture db, a fake model call. If `evals/rehearsal/harness.mjs` exists by
// the time this is read, prefer it and delete this file's duplication.
//
// ── THE TWO SEAMS THIS FILE OWNS, AND WHY THEY ARE FETCH INTERCEPTS ────────
//
// A door handler imports `q` from `./_db.js` and `requireUser` from
// `./_auth.js` AT MODULE LOAD TIME — neither is passed in as an argument, so
// there is no dependency-injection seam at the HTTP layer the way there is
// one function layer down (`api/_room-publish.js`'s own functions all take
// `db` as their first argument, which is what lets `evals/room-doors`
// attack them with a fake `db` directly). The only seam left for a caller
// that insists on running the REAL `api/<name>.js` file is the network call
// each of those two modules makes: `_db.js`'s `q()` does one `fetch()` to
// `https://<NEON HOST>/sql`, and `_auth.js`'s `requireUser()` does one
// `fetch()` to `<SUPABASE_URL>/auth/v1/user`. This file points `NEON_URL`
// and `SUPABASE_URL` at fixed, fake hosts, and intercepts `globalThis.fetch`
// itself to answer BOTH — Neon's SQL-over-HTTP body routed into the fixture
// db (`rehearsalCreatorDb`, evals/room-doors/fixtures.mjs), Supabase's user
// lookup answered from one fixed bearer token this file mints. Anything
// this interceptor does not recognise THROWS rather than reaching the real
// network — the whole point is that nothing here can cost money or touch a
// real service, and a silent pass-through would be the failure mode that
// defeats that.
//
// No model call is intercepted: this rehearsal's own walk never reaches one
// (review-queue's `generate` runs with `include_questions: false`, and the
// walk drives no room "say" turn — see `evals/rehearsal/creator.mjs`'s own
// header for why). Named here so the next reader does not go looking for a
// seam that was never needed.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DIST = join(ROOT, "dist");

const REHEARSAL_NEON_HOST = "fixture.neon-rehearsal.internal";
const REHEARSAL_SUPABASE_URL = "https://fixture.supabase-rehearsal.internal";
export const REHEARSAL_OWNER_TOKEN = "fixture-owner-bearer-token-0000000000";
export const REHEARSAL_OWNER = "f1000000-0000-4000-8000-000000000001";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".woff2": "font/woff2", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
};

/** The doors this rehearsal routes to. Each entry is the door's own default
 *  export — imported dynamically, once, at server start, so a missing or
 *  broken door fails the harness loudly at startup rather than on the first
 *  request that happens to reach it. */
const DOOR_MODULES = {
  "/api/replica": "../../api/replica.js",
  "/api/context-items": "../../api/context-items.js",
  "/api/review-queue": "../../api/review-queue.js",
  "/api/readiness": "../../api/readiness.js",
  "/api/room-publish": "../../api/room-publish.js",
};

/**
 * The REAL `StudioApp` reads several dozen `/api/*` routes on mount, not
 * only the five this rehearsal drives through a real door — the same fact
 * `src/studio/layoutFixture.tsx`'s own `ROUTES` table exists to answer for
 * the layout gate. Every one of those routes not in `DOOR_MODULES` above
 * gets ITS OWN safe empty shape here, the SAME shapes that file already
 * uses (copied, not re-derived — a second guess at "empty but not
 * undefined" is exactly how `Cannot read properties of undefined` finds a
 * NEW field the first guess missed). Anything genuinely new to both files
 * gets `{}`, which is what an unguarded reader crashes on — named as a gap
 * rather than guessed at, the same as `layoutFixture.tsx`'s own header
 * states its intent to be complete rather than merely permissive.
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

/**
 * Installs the fetch interceptor. Returns a restore function. `db` is the
 * fixture db function (`rehearsalCreatorDb(state)`'s own return value) —
 * every Neon-shaped POST is routed through it, `{query, params}` in,
 * `{rows}` out, the exact envelope `api/_db.js`'s own `q()` expects back.
 */
function installFetchInterceptor(db) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);

    // Loopback passes through untouched — this is the harness's OWN origin
    // (a caller driving it with plain `fetch`, as `evals/rehearsal/creator.mjs`
    // does for the steps it does not drive through the browser), never a
    // real external service.
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
      return realFetch(input, init);
    }

    if (url === `https://${REHEARSAL_NEON_HOST}/sql`) {
      const body = JSON.parse(String(init.body || "{}"));
      try {
        const rows = await db(body.query, body.params || []);
        return new Response(JSON.stringify({ rows }), { status: 200, headers: { "content-type": "application/json" } });
      } catch (error) {
        // `_db.js`'s own `q()` treats a non-ok response as the failure
        // signal, reading `code`/`message` off the JSON body — mirrored
        // here so a genuine fixture refusal (a duplicate slug, a locked
        // publish) surfaces through the SAME path a real Neon 400 would,
        // rather than as an unrelated fetch-layer throw.
        return new Response(
          JSON.stringify({ code: error?.code || "rehearsal_fixture_error", message: error?.message || String(error) }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
    }

    if (url.startsWith(`${REHEARSAL_SUPABASE_URL}/auth/v1/user`)) {
      const headers = init.headers || {};
      const auth = typeof headers.get === "function" ? headers.get("authorization") : headers.Authorization || headers.authorization;
      const token = /^Bearer\s+(.+)$/i.exec(String(auth || ""))?.[1];
      if (token === REHEARSAL_OWNER_TOKEN) {
        return new Response(JSON.stringify({ id: REHEARSAL_OWNER, email: "creator@fixture.test" }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401, headers: { "content-type": "application/json" } });
    }

    // Never a silent pass-through to the real network — see this file's own
    // header. A caller of the harness that reaches an unmodelled fetch
    // target gets a loud, named failure instead of an accidental real call.
    throw new Error(`rehearsal harness: unmodelled fetch target ${url}`);
  };
  return () => { globalThis.fetch = realFetch; };
}

function vercelize(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => {
    if (!res.getHeader("content-type")) res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(Buffer.from(JSON.stringify(body)));
    return res;
  };
  return res;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

async function serveStatic(pathname, res) {
  let filePath = join(DIST, pathname === "/" ? "index.html" : pathname);
  if (!existsSync(filePath) || pathname.endsWith("/")) filePath = join(DIST, "index.html");
  if (!existsSync(filePath)) { res.writeHead(404).end("not found"); return; }
  const bytes = await readFile(filePath);
  res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream" });
  res.end(bytes);
}

/**
 * Starts the harness. `state` is the fixture world (pass
 * `freshRehearsalCreatorState()`'s own return value, or a mutated copy of
 * it — the SAME object the caller keeps a reference to, so a test can seed
 * it further between requests, e.g. crossing the Readiness floor mid-walk).
 * `db` is the fixture db built over it (`rehearsalCreatorDb(state)`).
 *
 * Returns `{url, stop}`. `stop()` restores `globalThis.fetch` and closes
 * the server — always call it, even on a failing walk, or a later suite in
 * the SAME `node evals/run.mjs` process inherits a patched `fetch`.
 */
export async function startCreatorHarness({ port = 0, db } = {}) {
  if (!existsSync(DIST)) {
    throw new Error("rehearsal harness: dist/ does not exist — run `npx vite build` first");
  }
  if (typeof db !== "function") throw new Error("rehearsal harness: db is required");

  process.env.NEON_URL = `postgres://fixture:fixture@${REHEARSAL_NEON_HOST}/fixturedb`;
  process.env.SUPABASE_URL = REHEARSAL_SUPABASE_URL;
  process.env.SUPABASE_KEY = "fixture-anon-key";

  const restoreFetch = installFetchInterceptor(db);

  const doors = {};
  for (const [route, relPath] of Object.entries(DOOR_MODULES)) {
    const mod = await import(pathToFileURL(join(HERE, relPath)).href);
    doors[route] = mod.default;
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      req.query = Object.fromEntries(url.searchParams);
      if (req.method === "POST" || req.method === "DELETE") req.body = await readJsonBody(req);
      vercelize(res);

      const door = doors[url.pathname];
      if (door) {
        await door(req, res);
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        res.status(200).json(FALLBACK_JSON_ROUTES[url.pathname] ?? {});
        return;
      }
      await serveStatic(url.pathname, res);
    } catch (error) {
      console.error("[rehearsal-creator harness] request failure:", error?.stack || error);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(error?.message || error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const actualPort = server.address().port;

  return {
    url: `http://127.0.0.1:${actualPort}`,
    stop: async () => {
      restoreFetch();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
