// WS-R95 (wave fifteen) — the creator's journey rehearsed end to end.
//
//   node evals/rehearsal/creator.mjs           # English walk (the gate's own budget)
//   REHEARSAL_FULL=1 node evals/rehearsal/creator.mjs   # + the Hindi walk
//
// A real Chromium (launched the same way `scripts/check-layout.mjs` does —
// `/opt/pw-browsers/chromium-1194`, never `playwright install`) drives the
// REAL built studio (`dist/studio.html`) against `evals/rehearsal/
// harness-creator.mjs`'s real HTTP server, which routes to the REAL
// `api/replica.js`, `api/context-items.js`, `api/review-queue.js`,
// `api/readiness.js` and `api/room-publish.js` handlers over the fixture db
// (`evals/room-doors/fixtures.mjs`'s `rehearsalCreatorDb`).
//
// ── WHAT IS DRIVEN THROUGH THE BROWSER, AND WHAT THROUGH THE HARNESS'S OWN
//    HTTP DOOR DIRECTLY (both go through the SAME real handler; only the
//    calling side differs) — named here rather than left to be inferred:
//
//   Browser DOM interaction: sign-in (localStorage seed, never a real OTP),
//   the replica rail showing a created replica, the Share tab's showcase
//   picker (a real click on "Pick from your reviews"), the share kit's
//   "Copy" button, the export's "Download everything" button and the file
//   it hands the browser.
//
//   `page.evaluate(fetch(...))` against the harness (still the real door,
//   still the real fixture — "through the harness" either way): creating
//   the replica, adding the one text source, filling and deciding the
//   review queue, creating and publishing the Room. These are FORM-HEAVY
//   multi-field flows (a file drop zone, a review card's three buttons in
//   an unknown exact DOM shape) this workstream did not have the budget to
//   reverse-engineer blind against a React tree with no `data-testid`
//   convention (`grep -r data-testid src/studio` finds none); driving them
//   by the same HTTP contract `scripts/first-room.mjs` already proves a
//   human would use is a truthful rehearsal of the CONTRACT even where it
//   is not a rehearsal of the FORM. Every one of these steps is followed by
//   a page reload and a REAL DOM assertion that the resulting state
//   actually rendered, which is what makes it a rehearsal of the screen and
//   not only of the API.
//
// ── THE READINESS FINDING THIS WALK MADE (2026-09-05, WS-R95) ─────────────
//
// `readinessScreen`'s "knows_your_material" part can NEVER be measured
// today: it only renders a value when `readRecallRun()` returns a scored
// run, and that function is a committed STUB (`api/_readiness.js`'s own
// `readRecallRun(_db, _ownerUserId, _rid)`, unused params, `return recall`
// where `recall` is always its input's own null default — no writer for a
// recall run exists anywhere in this tree, confirmed by grep). Because
// `readinessScreen`'s own `overall`/`min_part` are `null` whenever ANY part
// is unmeasured (never a partial mean — that file's own §"THE UNDEFINED
// OVERALL" comment), **no replica can cross the publish floor through a
// real `GET /api/readiness` computation as this tree stands, for any
// creator, ever** — not a rehearsal shortcut, a structural fact this walk
// discovered by trying to drive the other four parts to genuinely measured,
// passing values and finding the fifth permanently absent. This is why
// `evals/room-publish/run.mjs`'s own fixture seeds `vy_replica_readiness`
// directly rather than computing it — not a convenience, the ONLY way to
// reach a passing screen today — and why this walk does the same, crossing
// the floor is SEEDED (see the "crosses the floor" step below), never
// computed. Logged to context/rejected.md and context/decisions.md.
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const FULL = process.env.REHEARSAL_FULL === "1";

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok  ${name}${extra ? `   ${extra}` : ""}`); }
  else { fail++; failures.push(name); console.log(`FAIL  ${name}${extra ? `   ${extra}` : ""}`); }
}

// The one launch both rehearsals share (`./browser.mjs`): a named binary,
// else Playwright's full build by channel, else a SKIP by name — probed
// BEFORE any harness builds `dist/`, so a runner with no browser (the build
// workflow, which installs none) spends nothing on a walk it cannot take.
// The release gate carries a real Chromium and runs this same registry.
const { launchRehearsalBrowser } = await import(pathToFileURL(join(ROOT, "evals/rehearsal/browser.mjs")).href);
{
  const probe = await launchRehearsalBrowser();
  if (!probe.browser) {
    console.log(`SKIP: ${probe.reason} — the release gate runs this walk with a real Chromium`);
    process.exit(0);
  }
  await probe.browser.close();
}

// WS-R109 (wave sixteen): the separate `harness-creator.mjs` this file used
// to import is retired — `evals/rehearsal/harness.mjs`'s own `startHarness`
// now routes this walk's five doors too (`kind: "creator"`), the fold that
// workstream's own law 1 asked for. `build` re-runs `npx vite build` only
// for the FIRST locale walked; the second (Hindi, under `--full`) reuses the
// same `dist/` — `follower.mjs`'s own precedent for the identical reason.
const { startHarness, REHEARSAL_OWNER_TOKEN, REHEARSAL_OWNER } = await import(
  pathToFileURL(join(ROOT, "evals/rehearsal/harness.mjs")).href
);

let builtOnce = false;

/** One walk, in one locale, over its own fresh harness and fresh fixture
 *  world — never shared with the other locale's run, so a bug in one
 *  cannot leave a stray row the other reads as its own. */
async function walkLocale(locale) {
  console.log(`\n── creator journey (${locale}) ──`);
  const harness = await startHarness({ kind: "creator", build: !builtOnce });
  builtOnce = true;
  const { url, state, stop, setFakeReply } = harness;
  const launched = await launchRehearsalBrowser();
  if (!launched.browser) {
    await stop();
    throw new Error(`chromium launched for the probe above but not for the ${locale} walk: ${launched.reason}`);
  }
  const browser = launched.browser;
  const gapNotes = [];

  try {
    // WS-R109. A distinct synthetic `x-real-ip` per locale gate —
    // `evals/rehearsal/follower.mjs`'s own precedent for the identical
    // reason (`context/rejected.md#ws-r94-shared-unknown-ip-bucket-
    // exhausted-the-90-per-minute-room-ip-gate-across-both-locale-gates`):
    // this harness has no reverse proxy in front of it, so every request
    // otherwise carries NO forwarded-for header and every rate limiter
    // keyed by IP (`api/room-publish.js`'s own included) collapses BOTH
    // locale gates in the same process onto the single bucket "unknown",
    // found the hard way (a real 429 on the Hindi gate's own showcase_set,
    // after the English gate had already spent that bucket's budget) once
    // `--full` actually reached this code path for the first time. A real
    // deployment never does this (every visitor has a real, distinct IP),
    // so this restores realism the harness silently removed.
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { "x-real-ip": locale === "hi" ? "10.95.2.1" : "10.95.1.1" },
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error(`  [browser error, ${locale}]`, error.message));

    // ── SIGN-IN: the fixture's seeded session, never a real OTP ───────────
    // `src/studio/session.ts`'s own `isSession` shape — the SAME localStorage
    // key `src/studio/layoutFixture.tsx`'s own `seedAuth()` uses.
    await context.addInitScript(({ token, ownerId }) => {
      localStorage.setItem("meera.state.v1", JSON.stringify({
        auth: {
          userId: ownerId, accessToken: token, refreshToken: token,
          expiresAt: Date.now() + 3_600_000, email: "creator@fixture.test",
        },
      }));
    }, { token: REHEARSAL_OWNER_TOKEN, ownerId: REHEARSAL_OWNER });

    // WS-R109. `?mode=teacher` (`StudioApp.tsx`'s own `readStudioMode()`,
    // read once from the URL at mount) is what actually gates `RoomStudio`
    // — the Share tab, its showcase picker, and the share kit — never a
    // runtime-activation signal at all. Without it `mode` stays "generic"
    // and `RoomStudio` never mounts, which is the REAL reason the picker
    // and the share kit's own "Copy" button were unreachable through the
    // DOM before this workstream, not the runtime-activation gate this
    // file used to attribute it to (`context/rejected.md
    // #ws-r95-share-tab-mount-blamed-on-runtime-not-on-the-missing-mode-teacher-param`).
    await page.goto(`${url}/studio.html?mode=teacher${locale === "hi" ? "&lang=hi" : ""}`, { waitUntil: "networkidle" });
    const rootText = await page.locator("#studio-root").innerText().catch(() => "");
    ok(`${locale}: studio shell renders signed in (no sign-in prompt)`, rootText.length > 0 && !/sign in with google/i.test(rootText));
    ok(`${locale}: document.documentElement.lang reflects the chosen locale`,
      await page.evaluate(() => document.documentElement.lang) === locale);

    // ── CREATE A REPLICA, through the real door, via the harness's own
    //    fetch — see this file's header for why. ──────────────────────────
    const created = await page.evaluate(async ({ token }) => {
      const r = await fetch("/api/replica", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ op: "create", display_name: "Anjali Physics" }),
      });
      return { status: r.status, body: await r.json() };
    }, { token: REHEARSAL_OWNER_TOKEN });
    ok(`${locale}: create replica returns 201`, created.status === 201, JSON.stringify(created.body).slice(0, 120));
    const replicaId = created.body?.replica?.replica_id;
    ok(`${locale}: created replica row exists in the fixture db`,
      state.replicas.some((r) => r.replica_id === replicaId));
    // Runtime activation is out of this rehearsal's scope (its own
    // multi-stage pipeline) — see evals/room-doors/fixtures.mjs's own
    // header on `freshRehearsalCreatorState`. `agent_id` is assigned here,
    // the SAME shortcut `evals/room-publish/run.mjs`'s own fixture takes,
    // because `createRoom` refuses an agent-less replica by design.
    const replicaRow = state.replicas.find((r) => r.replica_id === replicaId);
    replicaRow.agent_id = "a1000000-0000-4000-8000-000000000001";

    await page.reload({ waitUntil: "networkidle" });
    // `textContent()`, not `innerText()`: on a fresh, single-replica
    // studio the rail sits inside a collapsed `<details>` band and
    // `innerText()` (which respects Chromium's own layout/visibility)
    // reports it empty even though the markup and the name are really
    // there — `textContent()` does not care, and the assertion below is
    // about the row EXISTING, not about it being on-screen unscrolled.
    const railText = await page.locator('[aria-label="Your AIs"]').textContent().catch(() => "");
    ok(`${locale}: the created replica renders in the studio's own "Your AIs" rail`, railText.includes("Anjali Physics"), railText.slice(0, 80));

    // ── ADD ONE TEXT SOURCE, through the Context Locker's REAL drop zone
    //    (WS-R109) — `ContextLockerPanel.tsx`'s own `<input type="file"
    //    class="context-file-input">`, driven with Playwright's own
    //    `setInputFiles` rather than a body-shaped `fetch`, closing the gap
    //    WS-R95's own header named ("the Context Locker's own drop-zone
    //    form was not driven through the DOM"). The Band wrapping it is
    //    collapsible on this walk's own 390px viewport and starts closed
    //    (`WizardRail.tsx`'s own `Band`), so its `<summary>` is opened
    //    first, the same real tap a follower on a phone would make. ──────
    await page.getByText(/^(Files, links, videos, channels|Add files and links)$/).first().click();
    const fileInput = page.locator("input.context-file-input");
    await fileInput.waitFor({ state: "attached", timeout: 10_000 });
    const [addFilesResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/context-items") && r.request().method() === "POST",
        { timeout: 15_000 },
      ),
      fileInput.setInputFiles({
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("I teach JEE physics. I never do cardio on lifting days; lifting is protected."),
      }),
    ]);
    const addFilesBody = await addFilesResponse.json().catch(() => ({}));
    ok(`${locale}: the drop zone's own file input posts a real add_files request that returns 200 with one accepted item`,
      addFilesResponse.status() === 200 && addFilesBody?.results?.[0]?.item?.source_name === "notes.txt",
      JSON.stringify(addFilesBody).slice(0, 160));
    // The result row the write response drove onto the screen, AND the
    // real row in the fixture the panel's own follow-up GET (`load()`,
    // `ContextLockerPanel.tsx`'s own `send()`) had to read back for that
    // screen to be honest — never one without the other,
    // `evals/rehearsal/follower.mjs`'s own rule restated here.
    const resultName = await page.locator(".context-results .context-result-name").first().innerText().catch(() => "");
    ok(`${locale}: the drop zone's own result row names the real file`, resultName.includes("notes.txt"), resultName);
    ok(`${locale}: the fixture's own vy_context_item row was written by the real add_files call`,
      state.contextItems.some((i) => i.replica_id === replicaId && i.source_name === "notes.txt"));

    // ── READINESS: locked below the floor. Real computation, real six
    //    inputs, all but one honestly unmeasured — see this file's header
    //    for the "knows_your_material" finding. ────────────────────────────
    const readiness1 = await page.evaluate(async ({ token, replicaId }) => {
      const r = await fetch(`/api/readiness?replica_id=${replicaId}`, { headers: { authorization: `Bearer ${token}` } });
      return { status: r.status, body: await r.json() };
    }, { token: REHEARSAL_OWNER_TOKEN, replicaId });
    ok(`${locale}: readiness reads locked for a brand-new replica`,
      readiness1.status === 200 && readiness1.body?.readiness?.publish_locked === true,
      `overall=${readiness1.body?.readiness?.overall}`);

    // ── REVIEW QUEUE: fill it from three follower questions the AI would
    //    have declined (no model call — the synthetic generator is
    //    deliberately not invoked, `include_questions` left false), then
    //    decide all three: Sounds right, Close fix it, Never say this. ────
    const generated = await page.evaluate(async ({ token, replicaId }) => {
      const r = await fetch("/api/review-queue", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          op: "generate", replica_id: replicaId,
          follower_events: [
            { question: "Do you take beginners?", declined: true, answer: "Yes, I take beginners who commit to daily practice." },
            { question: "Is the exam on the 12th?", declined: true, answer: "The exam is on the 14th, not the 12th." },
            { question: "Can I skip mock tests?", declined: true, answer: "You can skip a mock test if you are recovering from illness." },
          ],
        }),
      });
      return { status: r.status, body: await r.json() };
    }, { token: REHEARSAL_OWNER_TOKEN, replicaId });
    ok(`${locale}: review-queue generate writes three cards`,
      generated.status === 200 && generated.body?.written === 3, JSON.stringify(generated.body?.dropped));
    const cards = generated.body?.queue?.cards || [];

    async function decide(card, decision, extra = {}) {
      return page.evaluate(async ({ token, replicaId, cardId, decision, extra }) => {
        const r = await fetch("/api/review-queue", {
          method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ op: "decide", replica_id: replicaId, card_id: cardId, decision, ...extra }),
        });
        return { status: r.status, body: await r.json() };
      }, { token: REHEARSAL_OWNER_TOKEN, replicaId, cardId: card.card_id, decision, extra });
    }
    const soundsRight = cards[0] ? await decide(cards[0], "sounds_right") : null;
    ok(`${locale}: "Sounds right" decides a card`, soundsRight?.status === 200 && soundsRight.body?.card?.state === "sounds_right");
    const fixedIt = cards[1]
      ? await decide(cards[1], "fixed", { correction_source_id: "11111111-1111-4111-8111-111111111111" })
      : null;
    ok(`${locale}: "Close, fix it" decides a card`, fixedIt?.status === 200 && fixedIt.body?.card?.state === "fixed");
    const neverSay = cards[2]
      ? await decide(cards[2], "never", { answer_text: cards[2].answer_text, reason: "not accurate" })
      : null;
    ok(`${locale}: "Never say this" decides a card and mints a never-rule`,
      neverSay?.status === 200 && neverSay.body?.card?.state === "never");

    // ── THE NEVER-RULE BITE, verified directly against the REAL predicate
    //    function `gateReply` calls (`api/_never-rules.js`'s
    //    `replyViolatesNeverRule`), fed the never-rule row the door above
    //    JUST wrote through the fixture db. This is NOT the Room's own
    //    follower "say" lane (`api/_room-surface.js`'s `roomSay`) — that
    //    lane does not currently pass `neverRules` into `gatedReply` at
    //    all (confirmed by grep: only `api/_clonechat.js`'s widget lane and
    //    `api/_mirrorcall-reply.js` do). Demonstrating the bite on a lane
    //    that does not check it would be a FALSE positive rehearsal; this
    //    is the honest substitute, and the roomSay gap is logged as its own
    //    finding rather than silently worked around. ───────────────────────
    const neverMod = await import(pathToFileURL(join(ROOT, "api/_never-rules.js")).href);
    const mintedRule = state.rehearsalNeverRules.find((n) => n.replica_id === replicaId);
    ok(`${locale}: a never-rule row exists after the "Never say this" decision`, Boolean(mintedRule));
    const compiled = neverMod.compileNeverRules(mintedRule ? [mintedRule] : []);
    const candidateReply = `Sure — ${cards[2]?.answer_text ?? "you can skip a mock test if you are recovering from illness"}`;
    const violated = neverMod.replyViolatesNeverRule(candidateReply, compiled);
    ok(`${locale}: a reply containing the forbidden pattern is caught by the real predicate`, Boolean(violated));
    const cleanReply = "Physics is best learned one topic a day, with daily practice.";
    const clean = neverMod.replyViolatesNeverRule(cleanReply, compiled);
    ok(`${locale}: NEGATIVE CONTROL — an unrelated reply is NOT caught`, clean === "");

    // ── ROOM: create, then publish refused below the floor (on screen and
    //    in the API), then seed the floor and publish for real. ───────────
    const roomCreated = await page.evaluate(async ({ token, replicaId }) => {
      const r = await fetch("/api/room-publish", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ op: "create", replica_id: replicaId }),
      });
      return { status: r.status, body: await r.json() };
    }, { token: REHEARSAL_OWNER_TOKEN, replicaId });
    ok(`${locale}: room create returns 201`, roomCreated.status === 201, roomCreated.body?.room?.slug);

    const publishLocked = await page.evaluate(async ({ token, replicaId }) => {
      const r = await fetch("/api/room-publish", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ op: "publish", replica_id: replicaId }),
      });
      return { status: r.status, body: await r.json() };
    }, { token: REHEARSAL_OWNER_TOKEN, replicaId });
    ok(`${locale}: NEGATIVE CONTROL — publish below the floor is refused (409, room_publish_locked)`,
      publishLocked.status === 409 && publishLocked.body?.error === "room_publish_locked");
    ok(`${locale}: the refusal names Readiness by code, not a generic 500`,
      publishLocked.body?.details?.waiting_on_you?.some((b) => b.code === "room_readiness_locked"));

    // ── WS-R119: crossing the floor through a REAL Readiness computation.
    //    `knows_your_material` is measured for real — a real "Measure now"
    //    click on the real ReadinessPanel card, driving the real recall run
    //    (api/_recall-run.js, WS-R101, landed on this worktree's base —
    //    `readRecallRun` no longer the committed stub the header above once
    //    described). The other four parts have no owner-triggered instrument
    //    at all (§4's own table: they are LIVE against real rows, but no
    //    door in EITHER rehearsal drives a Mirror Call, a voice enrollment or
    //    a person-model claim review — each is its own multi-stage pipeline
    //    with dedicated suites of its own, out of this rehearsal's scope
    //    exactly as runtime activation and disclosure approval already are,
    //    per this file's own header). So their RAW INPUT ROWS are seeded
    //    directly — never the computed screen, never `state.
    //    rehearsalReadinessLast` — and `GET /api/readiness` computes the
    //    real overall from them, the same honest distinction the "crosses
    //    the floor" step used to blur. Named here rather than left to be
    //    inferred: `sounds_like_you` (voice fidelity + the owner's own
    //    ceiling), `thinks_like_you` (Mirror Call taps) and
    //    `knows_what_not_to_say`/`up_to_date` (approved person-model claims)
    //    are the four seeded parts.
    gapNotes.push("Four of five Readiness parts (sounds_like_you, thinks_like_you, knows_what_not_to_say, up_to_date) are crossed by seeding their RAW INPUT ROWS, not the computed screen — each has its own owner-triggered instrument (a voice enrollment, a Mirror Call, a person-model claim review) that is its own multi-stage pipeline with dedicated suites elsewhere, out of this rehearsal's scope exactly as runtime activation and disclosure approval already are. Only knows_your_material (the recall run) is driven end to end by this walk.");

    // The recall run's own held-out question set: RECALL_SET_MIN (20) short,
    // single-sentence, distinct passages, each one whole sentence so
    // `firstSentence()` quotes it VERBATIM in the question text — which is
    // what lets the fake reply below echo it back for a clean, real,
    // deterministic 100 rather than an invented number.
    const RECALL_PASSAGE_COUNT = 22;
    state.rehearsalRecallPassages = Array.from({ length: RECALL_PASSAGE_COUNT }, (_, i) => ({
      source_id: `99990000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      replica_id: replicaId,
      owner_user_id: REHEARSAL_OWNER,
      body: `Point ${i + 1} is that JEE physics students improve fastest when they solve one full problem a day instead of skimming many problems without finishing any.`,
      created_at: new Date(Date.now() + i * 1000).toISOString(),
    }));

    // The four seeded parts' own raw rows — see the gap note above for why
    // these are seeded rather than driven.
    state.rehearsalClaims = [
      ...Array.from({ length: 3 }, (_, i) => ({
        replica_id: replicaId, owner_user_id: REHEARSAL_OWNER, status: "approved", domain: "boundary",
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        replica_id: replicaId, owner_user_id: REHEARSAL_OWNER, status: "approved", domain: "fact",
      })),
    ];
    state.rehearsalMirror = { sounds_right: 18, fix_it: 4, latest_at: new Date().toISOString() };
    state.rehearsalFidelity = { mean: 0.7, windows: 12, status: "measured", computed_at: new Date().toISOString() };
    state.rehearsalGenome = { ceiling: 0.85, windows: 10, measured_at: new Date().toISOString() };
    state.rehearsalTeacherSheet = {
      person_model_approved_at: new Date().toISOString(), person_model_approved: true, escalation_route: true,
    };
    // The FULL published teacher-sheet row `mirrorReplyAgent` (the recall
    // run's own "which compiled agent answers" read) needs — a DIFFERENT
    // shape from `state.rehearsalTeacherSheet` above (that one is the
    // Readiness SAFETY_SQL summary; this one carries the real compiled
    // `sheet` module `evals/room-doors/fixtures.mjs`'s own `loadFixtureAgent`
    // already builds for the follower harness). `slug` is left empty on
    // purpose: `mirrorReplyModule`'s own wrong-agent guard only fires when a
    // ROW carries a non-empty slug that disagrees with the sheet's own —
    // this rehearsal's replica has no published `/c/<slug>` island of its
    // own sharing this exact agent_id, so there is no real slug to assert.
    const { loadFixtureAgent } = await import(pathToFileURL(join(ROOT, "evals/room-doors/fixtures.mjs")).href);
    const { SHEET } = await loadFixtureAgent(ROOT);
    state.teacherSheets = state.teacherSheets || [];
    state.teacherSheets.push({
      sheet_id: "99990000-0000-4000-8000-000000000099",
      agent_id: replicaRow.agent_id,
      version: SHEET.version,
      sheet: SHEET,
      status: "published",
      consent_artifact_id: "99990000-0000-4000-8000-000000000098",
      published_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      slug: "",
    });

    // The fake reply seam (WS-R94's own stub, `stubs/surface-with-fake-model.mjs`):
    // echoes the passage a recall question quotes back VERBATIM, rather than
    // the stub's own bland default — a real scorer (`scoreAnswer`,
    // `api/_recall-run.js`) run for real over a real echo, never a hand-typed
    // score. Cleared after the run so nothing else in this walk (which
    // never calls `think()` again) is affected either way.
    setFakeReply((_engine, _compiled, turns) => {
      const content = String(turns?.[turns.length - 1]?.content || "");
      const match = content.match(/"([^"]+)"/);
      return match ? match[1] : content;
    });

    // ── the real "Measure now" click, on the real Readiness card ──────────
    // A real client-side tab click (`goStep("meet")`), never a fresh
    // `?step=meet` navigation: driving one was tried first and found a real
    // bug this walk is not in scope to fix — a full reload straight to
    // `step=meet` races ReadinessPanel's own mount against the studio's own
    // still-in-flight replica list load, and something in that window keeps
    // remounting/re-firing the panel's `load()` effect fast enough to trip
    // its own IP rate limit within about two seconds (measured: 40+ real
    // `GET /api/readiness` calls, all against the SAME replica, all logged
    // consecutively with 20-90ms gaps — a genuine loop, not a slow poll).
    // Named in this workstream's report and `context/rejected.md` rather
    // than silently worked around. Clicking the real "Meet" tab, the same
    // way this file's own "Share" tab click already works, reaches the
    // identical screen without the race, because by this point in the walk
    // the replica list has long since settled.
    await page.getByText(/^Meet$/).first().click({ timeout: 10_000 });
    const knowsMaterialCard = page.locator(".vy-readiness__part", { hasText: "Knows your material" });
    // Generous and retried: the churn this file's own header names below can
    // make even PRESENCE flap for a few seconds after the tab switch.
    await knowsMaterialCard.first().waitFor({ timeout: 10_000 }).catch(async () => {
      await page.waitForFunction(() => Array.from(document.querySelectorAll(".vy-readiness__part"))
        .some((el) => el.textContent?.includes("Knows your material")), null, { timeout: 30_000, polling: 200 });
    });
    // ReadinessPanel keeps RE-FETCHING on this screen — measured: it swaps
    // to its own loading skeleton and back on a cadence of a few seconds
    // even once the replica list has long since settled, which unmounts and
    // remounts this exact `<details>` out from under a multi-step Playwright
    // interaction (open it, THEN find the button, THEN click it) faster than
    // three separate round trips can land. Not this walk's bug to fix (its
    // own files are outside this workstream's scope — logged to
    // `context/rejected.md`); the workaround is doing "open the details AND
    // click Measure now" as ONE synchronous DOM pass, polled until a cycle
    // catches both the element open and the click landing in the same tick,
    // so no re-render has a window to intervene between the two actions.
    const measureLabel = locale === "hi" ? "अभी मापें" : "Measure now";
    const [measureResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/readiness") && r.request().postDataJSON()?.op === "measure_now",
        { timeout: 25_000 },
      ),
      page.waitForFunction((label) => {
        const card = Array.from(document.querySelectorAll(".vy-readiness__part"))
          .find((el) => el.textContent?.includes("Knows your material"));
        if (!card) return false;
        if (!card.open) card.querySelector("summary")?.click();
        const btn = Array.from(card.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
        if (btn && !btn.disabled) { btn.click(); return true; }
        return false;
      }, measureLabel, { timeout: 25_000, polling: 50 }),
    ]);
    const measureBody = await measureResponse.json().catch(() => ({}));
    ok(`${locale}: the real "Measure now" click runs a real recall run and scores it (n=${RECALL_PASSAGE_COUNT}, echoed answers)`,
      measureResponse.status() === 200 && measureBody?.recall_run?.score === 100 && measureBody?.recall_run?.n === RECALL_PASSAGE_COUNT,
      JSON.stringify(measureBody?.recall_run));
    setFakeReply(null);

    // The panel's own `load()` re-read after the run lands. A single atomic
    // `waitForFunction`, never a `.waitFor()` then a separate `.innerText()`
    // — this file's own header on the readiness screen's re-render churn:
    // two Playwright round trips give a re-render a window to detach the
    // element between them, the same defect shape the "Measure now" click
    // above already worked around.
    const knowsMaterialHandle = await page.waitForFunction(() => {
      const card = Array.from(document.querySelectorAll(".vy-readiness__part"))
        .find((el) => el.textContent?.includes("Knows your material"));
      const val = card?.querySelector(".vy-readiness__part-value");
      return val ? val.textContent.trim() : false;
    }, null, { timeout: 20_000, polling: 100 });
    const knowsMaterialValue = await knowsMaterialHandle.jsonValue();
    ok(`${locale}: the "Knows your material" card shows measured on screen (server-given, never client-computed)`,
      knowsMaterialValue === "100", knowsMaterialValue);

    // ── the real GET /api/readiness this same screen just re-read: overall
    //    computed from five real parts, none of them a fixture seed of the
    //    OVERALL itself. A short retry against a transient 429: the SAME
    //    ReadinessPanel re-render churn this file's own header names
    //    (`context/rejected.md#ws-r119-full-page-reload-to-step-meet-races-
    //    readiness-panels-mount`) can still fire a few background reads in
    //    the seconds after the "Measure now" click, and under load (this
    //    suite run alongside the rest of `evals/run.mjs`'s own registry,
    //    never in isolation) that occasionally lands one request on the
    //    IP-scoped rate limiter's last slot — found by running inside the
    //    full registry, not assumed. The retry reads the REAL door again
    //    rather than papering over a real refusal: a 200 on any attempt is
    //    the real screen, and running out of attempts still fails loudly. ──
    let readiness2 = { status: 0, body: {} };
    for (let attempt = 0; attempt < 4; attempt++) {
      readiness2 = await page.evaluate(async ({ token, replicaId }) => {
        const r = await fetch(`/api/readiness?replica_id=${replicaId}`, { headers: { authorization: `Bearer ${token}` } });
        return { status: r.status, body: await r.json().catch(() => ({})) };
      }, { token: REHEARSAL_OWNER_TOKEN, replicaId });
      if (readiness2.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    ok(`${locale}: readiness now reads open (all five parts real, none seeded on the screen itself)`,
      readiness2.body?.readiness?.publish_locked === false && readiness2.body?.readiness?.unmeasured_count === 0,
      `status=${readiness2.status} overall=${readiness2.body?.readiness?.overall} min_part=${readiness2.body?.readiness?.min_part}`);

    const publishedNow = await page.evaluate(async ({ token, replicaId }) => {
      const r = await fetch("/api/room-publish", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ op: "publish", replica_id: replicaId }),
      });
      return { status: r.status, body: await r.json() };
    }, { token: REHEARSAL_OWNER_TOKEN, replicaId });
    ok(`${locale}: publish succeeds once Readiness is computed for real to cross the floor`,
      publishedNow.status === 200 && publishedNow.body?.room?.published === true);

    // ── SHOWCASE: seed one non-follower-sourced, already-decided card
    //    (standing in for the paid synthetic-question generator, which this
    //    rehearsal does not invoke — see this file's header), then pick it
    //    for real through the Share tab's own picker. ─────────────────────
    state.reviewCards.push({
      card_id: "eeeeeeee-0000-4000-8000-000000000001", replica_id: replicaId, owner_user_id: REHEARSAL_OWNER,
      kind: "question", prompt_text: "What do you teach?", answer_text: "JEE physics, one topic a day.",
      source_refs: [], origin_ref: "", dedupe_hash: "seeded-eligible-card",
      state: "sounds_right", decided_at: new Date().toISOString(), correction_source_id: null, created_at: new Date().toISOString(),
    });

    await page.reload({ waitUntil: "networkidle" });
    // WS-R109. `?mode=teacher` on the page's OWN url (set once, at
    // navigation, above) is what mounts `RoomStudio` — the earlier
    // "runtime not active" explanation this file carried was wrong about
    // the mechanism (see the navigation step's own comment); with the real
    // mount condition met, the Share tab, its showcase picker, and the
    // share kit below are all driven through real clicks, no HTTP fallback.
    // `SHARE_COPY` below (`src/studio/copy.ts`/`hiCopy.ts`'s own
    // `tabTitle`/`showcasePicker`/`shareKit` strings, read off both files
    // directly): WS-R95's original strings here were English-only
    // regardless of `locale`, never noticed because the `?mode=teacher` gap
    // meant this whole section had never actually run for `hi` before —
    // found by running `--full` for real, not assumed.
    const shareCopy = locale === "hi"
      ? { tab: "शेयर", pick: "अपनी समीक्षाओं में से चुनें", pickTitle: /वे कार्ड जिन्हें आपने पहले ही सही कहा है/, use: "इसे इस्तेमाल करें", copy: "कॉपी करें", download: "सब कुछ डाउनलोड करें" }
      : { tab: "Share", pick: "Pick from your reviews", pickTitle: /cards you already marked sounds right/i, use: "Use this", copy: "Copy", download: "Download everything" };
    await page.getByText(new RegExp(`^${shareCopy.tab}$`)).first().click({ timeout: 10_000 });
    await page.getByRole("button", { name: shareCopy.pick }).first().click({ timeout: 10_000 });
    await page.getByText(shareCopy.pickTitle).waitFor({ timeout: 10_000 });
    const pickerItem = page.locator(".vy-room__showcase-picker-item", { hasText: "What do you teach?" });
    // Main-loop fix at 6fe96da's own CI run: `ShowcaseCard.tsx` renders the
    // picker's TITLE while `pickerLoading` is still true and the list only
    // after `showcase_eligible` answers, so counting the item at the instant
    // the title appears loses the race on a slow runner. Wait for the item
    // itself (bounded, never fatal if it never shows — the assertion below
    // still fails honestly) before counting.
    await pickerItem.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
    ok(`${locale}: the picker's own list shows the seeded, decided card`, await pickerItem.count() === 1);
    const [showcaseSetResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/room-publish") && r.request().postDataJSON()?.op === "showcase_set",
        { timeout: 10_000 },
      ),
      pickerItem.getByRole("button", { name: shareCopy.use }).click(),
    ]);
    ok(`${locale}: "Use this" in the real picker posts a real showcase_set that returns 200`,
      showcaseSetResponse.status() === 200);
    const showcaseRead = await page.evaluate(async ({ token, replicaId }) => {
      const r = await fetch(`/api/room-publish?replica_id=${replicaId}`, { headers: { authorization: `Bearer ${token}` } });
      return { status: r.status, body: await r.json() };
    }, { token: REHEARSAL_OWNER_TOKEN, replicaId });
    ok(`${locale}: the showcase now carries the picked card`,
      showcaseRead.body?.showcase?.some((s) => s.question === "What do you teach?"));

    // NEGATIVE CONTROL — a showcase pick of a follower-sourced card is
    // refused. `readEligibleShowcaseCards` already excludes
    // `kind = 'follower_declined'` by its own WHERE clause; this asserts
    // the picker's OWN read never offers one, and that a direct attempt to
    // set one through the door is refused.
    const eligible = await page.evaluate(async ({ token, replicaId }) => {
      const r = await fetch("/api/review-queue", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ op: "showcase_eligible", replica_id: replicaId }),
      });
      return { status: r.status, body: await r.json() };
    }, { token: REHEARSAL_OWNER_TOKEN, replicaId });
    ok(`${locale}: NEGATIVE CONTROL — the eligible-cards read never offers a follower-sourced card`,
      Array.isArray(eligible.body?.cards) && !eligible.body.cards.some((c) => c.kind === "follower_declined"));
    const forcedFollowerPick = await page.evaluate(async ({ token, replicaId, cardId }) => {
      const r = await fetch("/api/room-publish", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ op: "showcase_set", replica_id: replicaId, position: 2, source_card_id: cardId }),
      });
      return { status: r.status, body: await r.json() };
    }, { token: REHEARSAL_OWNER_TOKEN, replicaId, cardId: cards[2]?.card_id });
    ok(`${locale}: NEGATIVE CONTROL — setting a follower-sourced card as showcase is refused, not silently accepted`,
      forcedFollowerPick.status >= 400 || forcedFollowerPick.body?.showcase?.every((s) => s.answer !== cards[2]?.answer_text));

    // ── SHARE KIT: open it, copy the WhatsApp text — a real click where a
    //    real button exists (`shareKit.copy`, src/studio/copy.ts). ────────
    // WS-R109: `?mode=teacher` mounts `ShareKitCard` for real (this file's
    // own navigation-step comment), so "Copy" is now a real click, waited
    // on against the real network round trip its own `load()` effect makes
    // rather than a fixed timeout guessing when the kit finished fetching.
    await context.grantPermissions?.(["clipboard-read", "clipboard-write"]).catch(() => {});
    const [kitResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/room-publish") && r.request().postDataJSON()?.op === "share_kit",
        { timeout: 10_000 },
      ),
      page.reload({ waitUntil: "networkidle" }),
    ]);
    const kitBody = await kitResponse.json().catch(() => ({}));
    const whatsapp = kitBody?.kit?.find((k) => k.channel === "whatsapp");
    ok(`${locale}: the share kit carries a real WhatsApp text naming the AI, never "clone"`,
      Boolean(whatsapp?.text) && whatsapp.text.includes("AI") && !/\bclone\b/i.test(whatsapp.text));
    await page.getByText(new RegExp(`^${shareCopy.copy}$`)).first().click({ timeout: 10_000 });
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
    ok(`${locale}: the share kit's own "Copy" button wrote real kit text to the clipboard`,
      clipboardText.length > 0 && clipboardText.includes("AI"), clipboardText.slice(0, 80));

    // ── EXPORT: through the real "Download everything" button, one real
    //    click driving both the manifest assertion and the download event
    //    (WS-R109: `/api/replica {op:"export"}` is rate-limited to once a
    //    day per owner — `handleExport`'s own code comment, "A 429 here is
    //    ALWAYS the once-a-day scope" — so WS-R95's original TWO calls, one
    //    via `page.evaluate(fetch(...))` and a SECOND through this real
    //    click, collided the moment `?mode=teacher` made the click
    //    reachable for the first time: a real 429 on the second call, found
    //    the hard way by driving it, not assumed). "Download everything"
    //    lives inside a collapsed `<details>` band ("Owner control,
    //    including erasure") that stays reachable regardless of mode or
    //    runtime activation (unlike the showcase picker above, it is NOT
    //    inside `{mode === "teacher" && (...)}` — confirmed by reading
    //    `StudioApp.tsx`'s own JSX), so only its own `<summary>` needs
    //    opening first. ────────────────────────────────────────────────
    await page.getByText(/owner control, including erasure/i).first().click({ timeout: 10_000 });
    // `t.creatorExport.title` (the section's own `<h2>`) and
    // `t.creatorExport.button` are the SAME string, "Download everything"
    // (`copy.ts`), and the heading renders BEFORE the button in this
    // section's own JSX — `getByText(...)` would match the heading, not
    // the button, and clicking a heading does nothing, found the hard way
    // rather than assumed. `getByRole("button", ...)` is unambiguous.
    const [download, exportResponse] = await Promise.all([
      page.waitForEvent("download", { timeout: 15_000 }),
      page.waitForResponse(
        (r) => r.url().endsWith("/api/replica") && r.request().postDataJSON()?.op === "export",
        { timeout: 15_000 },
      ),
      page.getByRole("button", { name: new RegExp(`^${shareCopy.download}$`, "i") }).click({ timeout: 10_000 }),
    ]);
    ok(`${locale}: "Download everything" triggers a real browser download event`, Boolean(download));
    const exported = await exportResponse.json().catch(() => ({}));
    ok(`${locale}: the same real click's own response carries a real manifest`,
      exportResponse.status() === 200 && Array.isArray(exported?.manifest));
    const contextEntry = exported?.manifest?.find((m) => m.table === "vy_context_item");
    ok(`${locale}: the export's own manifest carries the ONE real source this walk added, not an invented count`,
      contextEntry?.rows === 1, JSON.stringify(contextEntry));
    // NEGATIVE CONTROL — the export never contains a follower's words. This
    // walk wrote no follower row at all (a creator-only rehearsal), so the
    // assertion is that no follower-lane table name appears with any rows,
    // and that nothing in the dump reads as a follower's own turn.
    const followerTableNames = ["vy_room_thread", "vy_room_message", "vy_room_follower"];
    ok(`${locale}: NEGATIVE CONTROL — the export carries zero rows for every follower-lane table it names`,
      exported?.manifest?.filter((m) => followerTableNames.includes(m.table)).every((m) => m.rows === 0));

    if (gapNotes.length) {
      console.log(`  fixture/UI gaps named for ${locale}:`);
      for (const note of gapNotes) console.log(`    - ${note}`);
    }
  } finally {
    await browser.close();
    await stop();
  }
}

const started = Date.now();
await walkLocale("en");
if (FULL) await walkLocale("hi");
else console.log("\n(Hindi walk skipped — set REHEARSAL_FULL=1 to run it too. The English walk alone is what evals/run.mjs registers.)");
const wallSeconds = ((Date.now() - started) / 1000).toFixed(1);

console.log(`\n${pass + fail} checks, ${pass} passed, ${fail} failed, ${wallSeconds}s wall clock`);
if (fail) {
  console.error(`failed: ${failures.join(", ")}`);
  process.exit(1);
}
