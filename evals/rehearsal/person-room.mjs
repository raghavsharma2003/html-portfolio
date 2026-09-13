// WS-R174 (wave twenty-three) — a personal AI's Room walked in Chromium.
//
//   node evals/rehearsal/person-room.mjs
//
// WS-R162 proved, at the door level, that a PERSON sheet clears the SAME
// `_room-publish.js` predicate a teacher's Room always used
// (`evals/person-room/run.mjs`). WS-R152 mounted the real `RoomStudio`
// (creator studio component) inside the personal studio's own Deploy screen
// (`DeployStudio.tsx`). Neither ever drove a real signed-in person clicking
// "Set up your Room" — WS-R162's own STATE.md entry says plainly a real
// published personal-AI Room "cannot exist yet" on this tree. This file is
// that walk: sign in as a text-ready person, open Deploy, publish a Room
// through the REAL `RoomStudio` controls, then a SECOND browser context
// visits `/r/<slug>` as a stranger, joins, asks a question, and gets a real
// reply — in English and Hindi.
//
// ── THE REAL BREAK THIS WALK FOUND, FIXED AT ITS CAUSE ─────────────────────
//
// `ExpertSharePanel.tsx` (the screen `CloneExperience.tsx` mounts for the
// bottom nav's "Share" tab) only ever rendered `DeployStudio` when
// `voiceWorkspaceReady` was true — a completed VOICE pipeline. A text-ready
// person (an approved HumanOS sheet, no voice recorded at all — WS-R161/167's
// own `textReady`) had NO route to Deploy/RoomStudio through the real UI: the
// tab bar showed (`RoomNav`'s own `voiceWorkspaceReady || textReady` gate),
// the Share tab was clickable, but it always rendered the pre-voice
// `MaterialSharePanel` instead — regardless of how ready the person's own
// sheet was. `RoomStudio`'s own publish predicate
// (`api/_room-publish.js#publishBlockers`) has never depended on voice at
// all (an active runtime capability, Readiness, and an approved disclosure —
// none of the three is a voice fact), so nothing about the DOOR this screen
// calls needed to change; only the CLIENT gate deciding whether to mount it
// did. Fixed: `ExpertSharePanel` now renders `DeployStudio` on
// `voiceWorkspaceReady || textReady`, and the sibling "back to knowledge"
// button above it is suppressed on the same widened condition (it read
// `!voiceWorkspaceReady` alone, which would have put a redundant button
// above Deploy for a text-ready person now that this screen is reachable).
// See `context/rejected.md#ws-r174-expertsharepanel-showed-deploy-only-for-
// voiceworkspaceready-never-textready`.
//
// ── WHAT IS DRIVEN THROUGH THE BROWSER, AND WHAT THROUGH A FIXTURE SHORTCUT
//    (named here rather than left to be inferred) ──────────────────────────
//
// Real, through the browser, against the REAL built `studio.html`/`room.html`
// and the REAL `api/replica.js`, `api/replica-runtime.js`,
// `api/room-publish.js`, `api/room.js` and `api/room-about.js` handlers over
// a fixture `db`: the personal studio discovering the seeded, text-ready
// replica on a fresh load; the "Share" tab opening `DeployStudio`; "Set up
// your Room" (`createOwnedRoom`); a FIRST "Publish your Room" click refused
// with the real, named `room_disclosure_not_approved` blocker on screen; a
// SECOND click, after the person's own sheet is (fixture-)published,
// succeeding for real (`publishRoom` really sets `published_at`); a second
// browser context opening `/r/<slug>`, joining (age attestation, memory
// consent — `evals/rehearsal/follower.mjs`'s own proven `joinFresh` shape,
// restated here), reading `/r/<slug>/about` and finding the person's own
// disclosure line and never the word "teacher", asking one question and
// receiving the fake reply seam's real text on a real bubble; the identical
// walk a second time in Hindi.
//
// A FIXTURE SHORTCUT, named rather than silently taken (the SAME "out of
// this rehearsal's scope" shortcuts `evals/rehearsal/personal.mjs`'s own
// Deploy section already takes for the identical reason): the sign-in itself
// is a fixture-seeded session (`REHEARSAL_OWNER_TOKEN`/`REHEARSAL_OWNER`,
// `stubs/auth-with-fake-user.mjs`), never a real OTP — `personal.mjs` is
// already the suite that proves that ceremony for real, and re-proving it
// here would not add coverage. The replica itself is created through the
// REAL `/api/replica {op:"create"}` door (the same one the agreement screen
// calls), but the enrollment/inference consent grants, the account-person
// identity bind, and the APPROVED HumanOS profile that makes `text_ready`
// true are all seeded directly onto the fixture — the Evolve ceremony that
// produces them for real is `personal.mjs`'s own, already-proven job, and
// this walk's own subject is the screen one step past it. Readiness and the
// runtime-active capability are the SAME two "out of this rehearsal's scope"
// booleans `evals/room-doors/fixtures.mjs`'s own `freshRehearsalCreatorState`
// already pre-seeds passing for every rehearsal that touches Room publish.
//
// NEGATIVE CONTROLS: an unpublished person sheet keeps Deploy's honest
// blocker, named on screen, never a silent success; a signed-out visitor's
// attempt to speak in the Room is refused (`room_session_invalid`) before
// any reply logic runs; the about page a stranger reads never says "teacher".
import { createServer } from "node:http";
import { execSync } from "node:child_process";
import { dirname, join, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import { readFile } from "node:fs/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DIST = join(ROOT, "dist");
const FULL = process.env.REHEARSAL_FULL === "1" || process.argv.includes("--full");

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok  ${name}${extra ? `   ${extra}` : ""}`); }
  else { fail++; failures.push(name); console.log(`FAIL  ${name}${extra ? `   ${extra}` : ""}`); }
}

// The one launch every rehearsal in this repo shares — a named binary, else
// Playwright's full build by channel, else a SKIP by name and exit 0 (the
// release gate, which does carry a browser, runs this same registry).
const { launchRehearsalBrowser } = await import(pathToFileURL(join(ROOT, "evals/rehearsal/browser.mjs")).href);
{
  const probe = await launchRehearsalBrowser();
  if (!probe.browser) {
    console.log(`SKIP: ${probe.reason} — the release gate runs this walk with a real Chromium`);
    process.exit(0);
  }
  await probe.browser.close();
}

// MUST happen before any dynamic import of api/*.js or anything it
// transitively imports — every sibling rehearsal's own law, repeated here.
register("./loader.mjs", import.meta.url);
process.env.ROOM_SESSION_SECRET = process.env.ROOM_SESSION_SECRET || "y".repeat(48);

const { setFixtureDb } = await import("./stubs/db.mjs");
const { setFakeReply } = await import("./stubs/surface-with-fake-model.mjs");
const { REHEARSAL_OWNER_TOKEN, REHEARSAL_OWNER } = await import("./stubs/auth-with-fake-user.mjs");
const { freshRehearsalCreatorState, rehearsalCreatorDb, loadFixtureAgent } = await import(
  pathToFileURL(join(ROOT, "evals/room-doors/fixtures.mjs")).href
);
const { USER_A, USER_B, PERSON_A, PERSON_B } = await import(pathToFileURL(join(ROOT, "evals/room/fixtures.mjs")).href);
const { READINESS_OVERALL_FLOOR, READINESS_PART_FLOOR } = await import(pathToFileURL(join(ROOT, "api/_readiness.js")).href);
const { OWNED_TEXT_PROFILE_SQL } = await import(pathToFileURL(join(ROOT, "api/_replica-runtime.js")).href);

let builtOnce = false;
function ensureBuilt() {
  if (builtOnce) return;
  execSync("npx vite build", { cwd: ROOT, stdio: "inherit" });
  builtOnce = true;
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

function withVercelShims(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { if (!res.hasHeader("content-type")) res.setHeader("content-type", "application/json; charset=utf-8"); res.end(JSON.stringify(body)); return res; };
  res.send = (body) => {
    if (Buffer.isBuffer(body) || typeof body === "string") res.end(body);
    else { if (!res.hasHeader("content-type")) res.setHeader("content-type", "application/json; charset=utf-8"); res.end(JSON.stringify(body)); }
    return res;
  };
  return res;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function serveDistFile(res, relPath) {
  try {
    const bytes = await readFile(join(DIST, relPath));
    res.writeHead(200, { "content-type": CONTENT_TYPES[extname(relPath)] || "application/octet-stream" });
    res.end(bytes);
    return true;
  } catch { return false; }
}

// The studio's own fixture-safe empty shapes for every OTHER `/api/*` route
// `StudioApp`/`CloneExperience` read on mount — restated from
// `evals/rehearsal/personal.mjs`'s own `FALLBACK_JSON_ROUTES` (a closure
// private to that file, so this is a copy of proven-correct entries for the
// SAME app, not a guess) since this file mounts a different, narrower door
// set (no voice/context/consent ceremony — this walk's own header explains
// why).
const FALLBACK_JSON_ROUTES = {
  "/api/replica-activity": { replica_id: null, generated_at: new Date(0).toISOString(), jobs: [], lanes: [], in_flight: false, next_poll_ms: null },
  "/api/clone-channel": { channels: [] },
  "/api/invites": { invites: [], quota: { max: 3, used: 0, remaining: 3 } },
  "/api/handoff": { enabled: false, monthly_cap: 0, counts: { drafted: 0, sent: 0, answered: 0, withdrawn: 0 }, next: null },
  "/api/checkins": { designs: [] },
  "/api/org": { org: null },
  "/api/channel-watch": { attestations: [], watches: [], statements: [], statement_set: "channel-ownership-v1", extraction_available: false },
  "/api/teacher-sheet": { sheet: null, draft: null },
  "/api/replica-claims": { claims: [] },
  "/api/replica-voice": { versions: [] },
  "/api/replica-identity": { identity: null },
  "/api/replica-liveness": { liveness: null },
  "/api/replica-calibration": { calibration: null },
  "/api/replica-dialogue-history": { turns: [] },
  "/api/replica-feedback": { feedback: [] },
  "/api/replica-candidate-eval": { candidates: [] },
  "/api/replica-speech": { speech: null },
  "/api/replica-voice-preference": { comparison: null },
  "/api/replica-voice-delivery-policy": { policy: null },
  "/api/replica-voice-trial": { trial: null },
  "/api/replica-voice-preview": { preview: null },
  "/api/replica-provider-consent": { consents: [] },
  "/api/voice-preview": { preview: null },
  "/api/mirror-call": { contract: null, call: null },
  "/api/replica-source": { sources: [] },
  "/api/replica-review": { review: null, items: [] },
  "/api/replica-person-model": { model: null, blockers: [] },
  "/api/video-enroll": { enrollments: [], extraction_configured: false, limits: { perOwnerPerDay: 4, maxDurationMs: 7_200_000, maxAudioBytes: 536_870_912, globalPerDay: 20 } },
  "/api/room-cohorts": { cohorts: [], verdict: { verdict: "not_measurable_yet", cohort_week: null, week6_return_share: null }, relstate_stage_counts: [] },
};

// ── WS-R174's own two SQL matchers, restated (not imported — private to
//    that file) from `evals/rehearsal/personal.mjs`'s own `personalPatterns`:
//    `/api/replica-runtime`'s `RUNTIME_STATUS_SQL` ("account_person_matches"
//    is the one substring unique to that exact select in the whole repo) and
//    `OWNED_TEXT_PROFILE_SQL` (matched by exact reference, the same
//    discipline that file already uses for a query this precise). Nothing
//    else this walk needs is new: replica create/list, the room-publish
//    three-gate predicate, and every follower-lane statement (join/say/
//    about) are already answered by `rehearsalCreatorDb`'s own base
//    `doorsDb`, proven by `evals/rehearsal/creator.mjs` and `follower.mjs`
//    driving the identical patterns today. ─────────────────────────────────
function personRuntimePatterns(state, sql, params, has) {
  if (has("account_person_matches")) {
    const [rid, ownerUserId] = params.map(String);
    const replica = state.replicas.find((r) => r.replica_id === rid && r.owner_user_id === ownerUserId);
    if (!replica) return [];
    const inferenceConsent = (state.consents || []).some((c) =>
      c.replica_id === rid && c.owner_user_id === ownerUserId && c.scope === "inference" && !c.revoked_at);
    const approvedProfile = (state.personProfiles || [])
      .filter((p) => p.replica_id === rid && p.status === "approved")
      .sort((a, b) => b.version - a.version)[0];
    return [{
      replica_id: replica.replica_id, subject_mode: replica.subject_mode, lifecycle: replica.lifecycle,
      subject_person_id: replica.subject_person_id || null, age_verified_at: null, identity_verified_at: null, liveness_verified_at: null,
      identity_expires_at: null, person_age_tier: null,
      account_person_matches: Boolean(replica.subject_person_id), inference_consent: inferenceConsent,
      profile_version: approvedProfile ? approvedProfile.version : null, profile_approved: Boolean(approvedProfile),
      calibration_version: null, calibration_approved: false,
      genome_version: null, genome_approved: false, genome_latest_version: null, genome_latest_status: null,
      voice_profile_id: null, voice_ready: false, test_voice: false, qualification_passed: 0,
      fidelity_status: null, candidate_binding_required: false,
    }];
  }
  if (sql === OWNED_TEXT_PROFILE_SQL) {
    const [rid, ownerUserId] = params.map(String);
    const approved = (state.personProfiles || [])
      .filter((p) => p.replica_id === rid && p.status === "approved")
      .sort((a, b) => b.version - a.version)[0];
    return approved ? [{ version: approved.version, definition: approved.definition }] : [];
  }
  // `api/_replica-consent.js#listOwnedConsent` — the studio's own agreement
  // gate (`activeEnrollmentConsent`, `CloneExperience.tsx`) reads this
  // through the real `/api/replica-consent {op:"list"}` door, so the
  // enrollment consent rows seeded directly onto the fixture (this walk's
  // own header) must answer here too, or the studio never leaves the
  // agreement screen at all — found by running this walk for real, not
  // assumed.
  if (has("from vy_replica_consent") && has("order by granted_at desc limit 100")) {
    const [rid, ownerUserId] = params.map(String);
    return (state.consents || []).filter((c) => c.replica_id === rid && c.owner_user_id === ownerUserId)
      .sort((a, b) => b.granted_at.localeCompare(a.granted_at));
  }
  return undefined;
}

function personRoomDb(state) {
  const inner = rehearsalCreatorDb(state);
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    const hit = personRuntimePatterns(state, sql, params, has);
    if (hit !== undefined) return hit;
    return inner(sql, params);
  };
}

/** One combined loopback server per locale gate, sharing ONE fixture `state`
 *  across BOTH the personal studio's own doors (`/api/replica`,
 *  `/api/replica-runtime`, `/api/room-publish`) and the Room's visitor doors
 *  (`/api/room`, `/api/room-about`, `dist/room.html`) — this walk's own
 *  subject is exactly the seam between the two, which no existing rehearsal
 *  server routes both halves of. */
async function startServer(state) {
  const db = personRoomDb(state);
  setFixtureDb(db);

  const replicaHandler = (await import(pathToFileURL(join(ROOT, "api/replica.js")).href)).default;
  const replicaRuntimeHandler = (await import(pathToFileURL(join(ROOT, "api/replica-runtime.js")).href)).default;
  const replicaConsentHandler = (await import(pathToFileURL(join(ROOT, "api/replica-consent.js")).href)).default;
  const roomPublishHandler = (await import(pathToFileURL(join(ROOT, "api/room-publish.js")).href)).default;
  const roomHandler = (await import(pathToFileURL(join(ROOT, "api/room.js")).href)).default;
  const roomAboutHandler = (await import(pathToFileURL(join(ROOT, "api/room-about.js")).href)).default;

  const doors = {
    "/api/replica": replicaHandler,
    "/api/replica-runtime": replicaRuntimeHandler,
    "/api/replica-consent": replicaConsentHandler,
    "/api/room-publish": roomPublishHandler,
  };

  const server = createServer(async (req, res) => {
    withVercelShims(res);
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const pathname = url.pathname;
      req.query = Object.fromEntries(url.searchParams);
      if (req.method !== "GET" && req.method !== "HEAD") req.body = await readJsonBody(req);

      const door = doors[pathname];
      if (door) { await door(req, res); return; }

      if (pathname === "/api/room" && (req.method === "POST" || req.method === "OPTIONS")) {
        return await roomHandler(req, res);
      }

      const aboutMatch = /^\/r\/([^/]+)\/about\/?$/.exec(pathname);
      if (aboutMatch && (req.method === "GET" || req.method === "HEAD")) {
        req.query = { slug: decodeURIComponent(aboutMatch[1]), lang: url.searchParams.get("lang") || "" };
        return await roomAboutHandler(req, res);
      }

      if (/^\/r\/[^/]+\/?$/.test(pathname) && req.method === "GET") {
        if (await serveDistFile(res, "room.html")) return;
      }

      if (pathname.startsWith("/api/")) {
        res.status(200).json(FALLBACK_JSON_ROUTES[pathname] ?? {});
        return;
      }

      if ((req.method === "GET" || req.method === "HEAD") && pathname === "/studio") {
        if (await serveDistFile(res, "studio.html")) return;
      }
      if (req.method === "GET" || req.method === "HEAD") {
        const rel = pathname === "/" ? "studio.html" : pathname.replace(/^\//, "");
        if (await serveDistFile(res, rel)) return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(error && error.stack ? error.stack : error));
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const bound = server.address();
  return { server, url: `http://127.0.0.1:${bound.port}`, stop: async () => new Promise((r) => server.close(r)) };
}

const FOLLOWER_COPY = {
  en: {
    tasteJoin: "Join to keep talking", memoryYes: "Yes, remember me", age: "I am 18 or older.",
    aboutHeading: "What this AI knows about you",
  },
  hi: {
    tasteJoin: "बात जारी रखने के लिए जुड़ें", memoryYes: "हां, मुझे याद रखें", age: "मेरी उम्र 18 साल या उससे ज़्यादा है।",
    aboutHeading: "यह AI आपके बारे में क्या जानता है",
  },
};

const PERSON_LINE = "Product designer. Bad puns. Worse badminton.";
const PERSON_DISPLAY_NAME = "Priya Menon";

/** One locale's whole walk, over its own fresh fixture world and its own
 *  fresh server — never shared with the other locale (`creator.mjs`'s own
 *  precedent: "a bug in one cannot leave a stray row the other reads as its
 *  own"). Returns nothing; every assertion runs through the module-level
 *  `ok()`. */
async function walkLocale(locale) {
  console.log(`\n── a personal AI's Room, Deploy to a visitor's reply (${locale}) ──`);
  const gateOffset = locale === "hi" ? 100 : 0;
  const followerBearer = locale === "hi" ? USER_B : USER_A;
  const followerPerson = locale === "hi" ? PERSON_B : PERSON_A;
  const c = FOLLOWER_COPY[locale];

  const state = freshRehearsalCreatorState();
  const { url, stop } = await startServer(state);

  // ── seed the person: created through the REAL door, everything past it
  //    (consent, identity bind, an APPROVED profile) a fixture shortcut —
  //    this walk's own header names why. ─────────────────────────────────
  const created = await fetch(`${url}/api/replica`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${REHEARSAL_OWNER_TOKEN}` },
    body: JSON.stringify({ op: "create", display_name: PERSON_DISPLAY_NAME }),
  });
  const createdBody = await created.json().catch(() => ({}));
  ok(`${locale}: the real /api/replica door creates a self-mode replica for the person`,
    created.status === 201, JSON.stringify(createdBody).slice(0, 160));
  const rid = createdBody?.replica?.replica_id;
  const replica = state.replicas.find((r) => r.replica_id === rid);
  ok(`${locale}: the created replica is self-mode (never a teacher's)`, replica?.subject_mode === "self");

  // The identity bind and enrollment/inference consent `grantVerifiedModelConsent`
  // would normally require live identity verification to reach — seeded
  // directly, the same shortcut `personal.mjs`'s own Deploy section takes.
  replica.subject_person_id = replica.subject_person_id || randomUUID();
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 365 * 86_400_000).toISOString();
  state.consents = ["capture", "transcription", "storage", "training", "inference"].map((scope) => ({
    consent_id: randomUUID(), replica_id: rid, owner_user_id: REHEARSAL_OWNER, scope,
    method: scope === "inference" ? "live_challenge" : "account_attestation",
    policy_version: replica.policy_version, receipt_hash: "seed",
    granted_at: now, expires_at: expires, revoked_at: null, metadata: {},
  }));
  // The APPROVED HumanOS profile — `personal.mjs`'s own Evolve section is
  // what proves the real `build_profile`/`approve_profile` doors reach this
  // state; this walk seeds the RESULT directly, its own subject being the
  // screen one step past it (this file's own header).
  state.personProfiles = [{ replica_id: rid, version: 1, source_set_hash: "seed", definition: {}, status: "approved", created_at: now }];
  // Room create needs an agent — minted opaquely at real runtime activation
  // in production (out of scope here, `evals/rehearsal/personal.mjs`'s own
  // Deploy section takes the identical shortcut for the identical reason).
  replica.agent_id = replica.agent_id || randomUUID();

  const runtimeCheck = await fetch(`${url}/api/replica-runtime?replica_id=${rid}`, {
    headers: { authorization: `Bearer ${REHEARSAL_OWNER_TOKEN}` },
  });
  const runtimeBody = await runtimeCheck.json().catch(() => ({}));
  ok(`${locale}: the real /api/replica-runtime door reports text_ready true for the seeded person`,
    runtimeCheck.status === 200 && runtimeBody?.runtime?.text_ready === true, JSON.stringify(runtimeBody?.runtime));

  const fakeMicArgs = [];
  const launched = await launchRehearsalBrowser(fakeMicArgs);
  if (!launched.browser) { await stop(); throw new Error(`chromium launched for the probe above but not for the ${locale} walk: ${launched.reason}`); }
  const browser = launched.browser;
  try {
    // ── SIGN IN AS THE PERSON, open Deploy through the real Share tab ─────
    const personContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await personContext.addInitScript(({ token, ownerId }) => {
      window.localStorage.setItem("meera.state.v1", JSON.stringify({
        auth: { userId: ownerId, accessToken: token, refreshToken: token, expiresAt: Date.now() + 3_600_000, email: "person-rehearsal@example.test" },
      }));
    }, { token: REHEARSAL_OWNER_TOKEN, ownerId: REHEARSAL_OWNER });
    const page = await personContext.newPage();
    page.on("pageerror", (error) => console.log(`  [person, ${locale}] page error: ${error.message}`));

    await page.goto(`${url}/studio.html${locale === "hi" ? "?lang=hi" : ""}`, { waitUntil: "networkidle" });
    const rootText = await page.locator("#studio-root").innerText().catch(() => "");
    ok(`${locale}: the personal studio renders signed in, the seeded replica visible (no sign-in prompt)`,
      rootText.length > 0 && !/sign in with google/i.test(rootText), rootText.slice(0, 80));

    const shareLabel = locale === "hi" ? "शेयर करें" : "Share";
    await page.getByText(new RegExp(`^${shareLabel}$`)).first().click({ timeout: 15_000 });

    const setupLabel = locale === "hi" ? "अपना रूम बनाएं" : "Set up your Room";
    const setupButton = page.getByRole("button", { name: setupLabel });
    await setupButton.waitFor({ state: "visible", timeout: 15_000 });
    ok(`${locale}: the real Share tab opened Deploy (RoomStudio's "Set up your Room" is reachable for a TEXT-ready person, the break this walk found and fixed)`, true);

    const [createResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/room-publish") && r.request().postDataJSON()?.op === "create", { timeout: 15_000 }),
      setupButton.click(),
    ]);
    ok(`${locale}: "Set up your Room" posts a real create through RoomStudio's own controls`, createResponse.status() === 201);
    const room = state.rooms.find((r) => r.owner_user_id === REHEARSAL_OWNER && r.replica_id === rid);
    ok(`${locale}: the fixture's own vy_room row was written by the real door`, Boolean(room?.slug));
    // `doorsPatterns`' own `insert into vy_room` matcher (`evals/room-doors/
    // fixtures.mjs`) mints a non-UUID-shaped `room_id` for a truly NEW room
    // ("f0" + zeros) — a real gap for its own callers named in its own
    // comment ("createRoom's own INSERT never fires in this battery"), but
    // this walk's own follower "say" step DOES reach it, and `_room-
    // surface.js#publicKnowledgeScope`'s real UUID validator refuses it
    // (`room_knowledge_scope_invalid`) — found by running this walk for
    // real, not assumed. Fixed here, on this walk's own fixture state,
    // rather than in the shared fixture file nine sibling workstreams also
    // touch this wave.
    room.room_id = randomUUID();

    // ── NEGATIVE CONTROL: an unpublished person sheet keeps Deploy's honest
    //    blocker, on screen, never a silent success. ──────────────────────
    state.rehearsalReadinessLast = { unmeasured_count: 0, overall: READINESS_OVERALL_FLOOR, min_part: READINESS_PART_FLOOR };
    state.rehearsalDisclosureApproved = false;
    const publishButtonLabel = locale === "hi" ? "अपना रूम पब्लिश करें" : "Publish your Room";
    const publishButton = page.getByRole("button", { name: publishButtonLabel });
    await publishButton.waitFor({ state: "visible", timeout: 15_000 });
    const [blockedResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/room-publish") && r.request().postDataJSON()?.op === "publish", { timeout: 15_000 }),
      publishButton.click(),
    ]);
    ok(`${locale}: NEGATIVE CONTROL — publishing with no published person sheet is refused (409, room_publish_locked)`, blockedResponse.status() === 409);
    const blockerList = page.locator(".vy-room__blockers");
    await blockerList.waitFor({ state: "visible", timeout: 10_000 });
    const blockerText = await blockerList.innerText();
    // The blocker's own headline text (`api/_room-publish.js#publishBlockers`'s
    // own `room_disclosure_not_approved` copy) is server-authored ENGLISH
    // regardless of locale — `publishBlockers` never localizes it, a real,
    // separate, pre-existing gap this walk did not create and is not this
    // brief's scope to close — so the English phrase is what BOTH locales
    // actually render; asserted literally rather than loosely, so a future
    // wording change trips this control rather than silently drifting.
    ok(`${locale}: Deploy's own honest blocker names room_disclosure_not_approved on screen, never a silent success`,
      blockerText.includes("Your sheet is not published, so there is no approved disclosure to show a follower."),
      blockerText.slice(0, 200));

    // ── the person's own sheet publishes (fixture shortcut, this walk's own
    //    header): the SAME compiled-agent seam `creator.mjs` already proves,
    //    a person-shaped sheet this time, its own `.slug` matching the ROOM's
    //    real slug — `roomBySlug`'s fixture answer sets `agent_slug: row.slug`
    //    and `publishedRow` matches on it, found by reading both, not
    //    assumed. ────────────────────────────────────────────────────────
    // `validateTeacherSheet` re-runs at LOAD, not merely at publish
    // (`api/_teachersheet.js`'s own comment) — a real gap this walk found by
    // driving the FULL door pipeline for a person sheet for the first time
    // (`evals/person-room/run.mjs`'s own suite only ever exercises
    // `sheetToModule` directly, never `loadTeacherAgent`'s validation): a
    // person sheet needs `personValues` (3-7 short items),
    // `personNeverSay` (>=3 rules) and `personTalk` (register/script) beyond
    // `PERSON_ALWAYS_REQUIRED_STRING_FIELDS`, and the sheet's OWN internal
    // `slug` must match the row it is loaded by (`teacher_sheet_slug_
    // mismatch`) — `SHEET.slug` inherited from `loadFixtureAgent` is
    // "anjali", never this Room's own slug, so it is overridden here.
    const { SHEET } = await loadFixtureAgent(ROOT);
    const personSheet = {
      ...SHEET, sheetKind: "person", slug: room.slug, name: PERSON_DISPLAY_NAME, personLine: PERSON_LINE,
      boundaryParagraph: "", stageEarly: "", stageGettingClose: "", stageEstablished: "",
      personValues: ["directness", "curiosity", "loyalty to friends", "dry humor", "punctuality"],
      personNeverSay: ["never discusses others medical details", "no unsolicited advice on money", "never claims expertise it lacks"],
      personTalk: { register: "mixed", scriptBaseline: "roman-hinglish" },
    };
    state.teacherSheets.push({
      sheet_id: randomUUID(), agent_id: replica.agent_id, version: SHEET.version, sheet: personSheet,
      status: "published", consent_artifact_id: randomUUID(), published_at: now, created_at: now,
      slug: room.slug,
    });
    state.rehearsalDisclosureApproved = true;

    const [publishedResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/room-publish") && r.request().postDataJSON()?.op === "publish", { timeout: 15_000 }),
      publishButton.click(),
    ]);
    ok(`${locale}: publish succeeds once the person's own sheet is published (the real predicate clears)`, publishedResponse.status() === 200);
    ok(`${locale}: publishRoom really set published_at`, Boolean(room.published_at));

    await personContext.close();

    // ── the fake reply seam: `think(engine, compiled, turns)`'s own real
    //    call shape (`stubs/surface-with-fake-model.mjs`'s own header) —
    //    a plain string, `creator.mjs`'s own proven contract, never the
    //    object shape the PERSONAL dialogue door's separate
    //    `setFakeDialogueReply` seam uses (a different door, this walk
    //    never drives it). A recognizable string a follower's own bubble
    //    can be matched against. ───────────────────────────────────────────
    setFakeReply(() => `Hi, I am ${PERSON_DISPLAY_NAME}'s AI. Rehearsal reply, standing in for a real model call.`);

    // ── A STRANGER: signed-out visitor speaking is refused before any reply
    //    logic runs (negative control). ────────────────────────────────────
    const unauth = await fetch(`${url}/api/room`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "say", session: "", message: "hello" }),
    });
    const unauthBody = await unauth.json().catch(() => ({}));
    ok(`${locale}: NEGATIVE CONTROL — a signed-out attempt to speak in the Room is refused (401, room_session_invalid)`,
      unauth.status === 401 && unauthBody.error === "room_session_invalid", JSON.stringify(unauthBody));

    // ── THE VISITOR: a second, independent browser context. ───────────────
    const visitorContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { "x-real-ip": `10.97.${gateOffset + 1}.1` },
    });
    await visitorContext.addInitScript(({ token }) => {
      window.localStorage.setItem("meera.state.v1", JSON.stringify({
        auth: { userId: token, accessToken: token, refreshToken: "fixture-refresh-token", expiresAt: Date.now() + 6 * 3_600_000 },
      }));
    }, { token: followerBearer });
    const visitorPage = await visitorContext.newPage();
    visitorPage.on("pageerror", (error) => console.log(`  [visitor, ${locale}] page error: ${error.message}`));
    if (process.env.RH_DEBUG === "1") {
      visitorPage.on("console", (msg) => console.log(`  [visitor console.${msg.type()}] ${msg.text()}`));
      visitorPage.on("requestfailed", (req) => console.log(`  [visitor request failed] ${req.method()} ${req.url()} ${req.failure()?.errorText}`));
      visitorPage.on("response", async (r) => {
        if (r.status() >= 400) {
          console.log(`  [visitor response] ${r.status()} ${r.url()} ${(await r.text().catch(() => "")).slice(0, 300)}`);
        }
      });
    }

    await visitorPage.goto(`${url}/r/${room.slug}${locale === "hi" ? "" : "?via=search"}`, { waitUntil: "networkidle" });
    if (process.env.RH_DEBUG === "1") {
      console.log(`  [visitor, ${locale}] body after goto:`, (await visitorPage.locator("body").innerText().catch(() => "")).slice(0, 500));
    }
    if (locale === "hi") {
      await visitorPage.locator('.room-lang-switch button[lang="hi"]').click();
      await visitorPage.waitForFunction(
        () => document.querySelector('.room-lang-switch button[lang="hi"]')?.getAttribute("aria-pressed") === "true",
        null, { timeout: 10_000 },
      );
    }
    await visitorPage.getByRole("button", { name: c.tasteJoin }).click({ timeout: 15_000 });

    // The about link, checked from the join screen before ever answering the
    // memory question (`follower.mjs`'s own step order restated) — a SEPARATE
    // tab, `follower.mjs`'s own precedent for a scratch tab proving one thing
    // without disturbing the join screen's own state.
    await visitorPage.waitForSelector(".room-join", { timeout: 10_000 });
    const aboutHref = await visitorPage.locator(".room-about-link").getAttribute("href");
    const aboutPage = await visitorContext.newPage();
    await aboutPage.goto(`${url}${aboutHref}`, { waitUntil: "networkidle" });
    const aboutHeading = await aboutPage.locator("h1").first().innerText().catch(() => "");
    ok(`${locale}: the about page opens for real and shows the standard heading`, aboutHeading === c.aboutHeading, aboutHeading);
    const aboutBodyText = await aboutPage.locator("body").innerText().catch(() => "");
    ok(`${locale}: the about page carries the PERSON's own disclosure line`, aboutBodyText.includes(PERSON_LINE));
    ok(`${locale}: NEGATIVE CONTROL — the visitor never sees the teacher wording on a person's own Room`,
      !aboutBodyText.toLowerCase().includes("teacher"));
    await aboutPage.close();

    await visitorPage.locator('input[type="checkbox"]').check();
    const [joinResponse] = await Promise.all([
      visitorPage.waitForResponse((r) => r.url().endsWith("/api/room") && r.request().postDataJSON()?.op === "join", { timeout: 15_000 }),
      visitorPage.getByRole("button", { name: c.memoryYes }).click(),
    ]);
    const joinBody = await joinResponse.json().catch(() => ({}));
    ok(`${locale}: the visitor joins for real, a real session minted`, joinResponse.status() === 200 && typeof joinBody.session === "string" && joinBody.session.length > 20);
    ok(`${locale}: the fixture's own follower row was written`, state.followers.some((f) => f.person_id === followerPerson));

    await visitorPage.waitForSelector(".room-composer textarea", { timeout: 15_000 });
    const beforeCount = await visitorPage.locator(".room-bubble.from-them").count();
    await visitorPage.locator(".room-composer textarea").fill(locale === "hi" ? "आप कौन हैं?" : "Who are you?");
    const [sayResponse] = await Promise.all([
      visitorPage.waitForResponse((r) => r.url().endsWith("/api/room") && r.request().postDataJSON()?.op === "say", { timeout: 15_000 }),
      visitorPage.locator(".room-send").click(),
    ]);
    const sayBody = await sayResponse.json().catch(() => ({}));
    ok(`${locale}: the visitor's question gets a real reply through the fake seam`,
      sayResponse.status() === 200 && sayBody?.reply?.includes(PERSON_DISPLAY_NAME), JSON.stringify(sayBody?.reply).slice(0, 120));
    await visitorPage.waitForFunction((n) => document.querySelectorAll(".room-bubble.from-them").length > n, beforeCount, { timeout: 15_000 });
    const bubbleText = await visitorPage.locator(".room-bubble.from-them").last().innerText();
    ok(`${locale}: the real reply rendered on a real bubble, the person's AI, never the teacher's`, bubbleText.includes(PERSON_DISPLAY_NAME));

    setFakeReply(null);
    await visitorContext.close();
  } finally {
    await browser.close();
    await stop();
  }
}

ensureBuilt();

const started = Date.now();
const clocks = {};
{
  const t = Date.now();
  await walkLocale("en");
  clocks.walkEnMs = Date.now() - t;
}
if (FULL) {
  const t = Date.now();
  await walkLocale("hi");
  clocks.walkHiMs = Date.now() - t;
} else {
  console.log("\n(Hindi walk skipped — set REHEARSAL_FULL=1 or pass --full to run it too. The English walk alone is what evals/run.mjs registers.)");
}
const wallMs = Date.now() - started;
console.log(`\nwall clocks (ms): ${JSON.stringify(clocks)}, total ${wallMs}ms`);

console.log(`\n${pass + fail} checks, ${pass} passed, ${fail} failed`);
if (fail) {
  console.error(`failed: ${failures.join(", ")}`);
  process.exit(1);
}
