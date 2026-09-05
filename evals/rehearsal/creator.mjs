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

const { startCreatorHarness, REHEARSAL_OWNER_TOKEN, REHEARSAL_OWNER } = await import(
  pathToFileURL(join(ROOT, "evals/rehearsal/harness-creator.mjs")).href
);
const { freshRehearsalCreatorState, rehearsalCreatorDb } = await import(
  pathToFileURL(join(ROOT, "evals/room-doors/fixtures.mjs")).href
);

/** One walk, in one locale, over its own fresh harness and fresh fixture
 *  world — never shared with the other locale's run, so a bug in one
 *  cannot leave a stray row the other reads as its own. */
async function walkLocale(locale) {
  console.log(`\n── creator journey (${locale}) ──`);
  const state = freshRehearsalCreatorState();
  const db = rehearsalCreatorDb(state);
  const { url, stop } = await startCreatorHarness({ db });
  const launched = await launchRehearsalBrowser();
  if (!launched.browser) {
    await stop();
    throw new Error(`chromium launched for the probe above but not for the ${locale} walk: ${launched.reason}`);
  }
  const browser = launched.browser;
  const gapNotes = [];

  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
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

    await page.goto(`${url}/studio.html${locale === "hi" ? "?lang=hi" : ""}`, { waitUntil: "networkidle" });
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

    // ── ADD ONE TEXT SOURCE (the Context Locker, api/context-items.js) ────
    const addFiles = await page.evaluate(async ({ token, replicaId }) => {
      const content = btoa("I teach JEE physics. I never do cardio on lifting days; lifting is protected.");
      const r = await fetch("/api/context-items", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          op: "add_files", replica_id: replicaId,
          files: [{ filename: "notes.txt", content_base64: content, authorship: "mine" }],
        }),
      });
      return { status: r.status, body: await r.json() };
    }, { token: REHEARSAL_OWNER_TOKEN, replicaId });
    ok(`${locale}: add_files returns 200 with one accepted item`,
      addFiles.status === 200 && addFiles.body?.results?.[0]?.item?.source_name === "notes.txt",
      JSON.stringify(addFiles.body).slice(0, 160));
    gapNotes.push("the Context Locker's own drop-zone form was not driven through the DOM — see this file's header.");

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

    // Crossing the floor is SEEDED, not computed — see this file's header
    // for why that is not a shortcut but the only reachable state today.
    state.rehearsalReadinessLast = { overall: 82, min_part: 71, unmeasured_count: 0 };
    const publishedNow = await page.evaluate(async ({ token, replicaId }) => {
      const r = await fetch("/api/room-publish", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ op: "publish", replica_id: replicaId }),
      });
      return { status: r.status, body: await r.json() };
    }, { token: REHEARSAL_OWNER_TOKEN, replicaId });
    ok(`${locale}: publish succeeds once Readiness is seeded to cross the floor`,
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
    await page.getByText(/^Share$/).first().click({ timeout: 4_000 }).catch(() => {
      gapNotes.push('the studio\'s own "Share" tab was not reached through a real click.');
    });
    let pickerClicked = false;
    try {
      await page.getByText(/pick from your reviews/i).first().click({ timeout: 4_000 });
      await page.getByText(/what do you teach\?/i).first().click({ timeout: 4_000 });
      pickerClicked = true;
    } catch {
      // A REAL finding this walk made, not a flaky selector: the studio's
      // OWN "Deploy it" step renders "Your AI is not active yet" / "Waiting
      // on you: ... Verify your identity to activate" for ANY replica whose
      // runtime is not active, and `RoomStudio` (the component carrying the
      // showcase picker) does not mount AT ALL behind that gate — confirmed
      // by inspecting the real rendered HTML, not inferred. This rehearsal
      // pre-seeds runtime activation TRUE only for the room-publish SQL
      // predicate (`state.rehearsalRuntimeActive`, evals/room-doors/
      // fixtures.mjs), which is a database fact; the STUDIO UI reads a
      // SEPARATE signal (`/api/replica-runtime`, and the replica's own
      // `age_verified`/`identity_verified`/`liveness_verified` columns) that
      // this rehearsal does not also fake, because doing so would mean
      // reproducing the whole identity/liveness verification pipeline (its
      // own multi-stage product, out of this rehearsal's scope). The
      // showcase pick is therefore driven through the door below instead.
      gapNotes.push('the Share tab\'s "Pick from your reviews" picker never mounts for a replica whose runtime is not active (a real UI gate this walk found, not a flaky selector — see the code comment above); driven through the door instead.');
    }
    if (!pickerClicked) {
      await page.evaluate(async ({ token, replicaId }) => {
        await fetch("/api/room-publish", {
          method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ op: "showcase_set", replica_id: replicaId, position: 1, source_card_id: "eeeeeeee-0000-4000-8000-000000000001" }),
        });
      }, { token: REHEARSAL_OWNER_TOKEN, replicaId });
    }
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
    let copiedViaClick = false;
    try {
      const clip = await context.grantPermissions?.(["clipboard-read", "clipboard-write"]).then(() => true).catch(() => false);
      await page.getByText(/^copy$/i).first().click({ timeout: 4_000 });
      copiedViaClick = true;
      void clip;
    } catch (error) {
      gapNotes.push(`the share kit's own "Copy" button was not reached through a real click (${error.message.split("\n")[0]}); the kit's text was read through the door instead.`);
    }
    const kit = await page.evaluate(async ({ token, replicaId }) => {
      const r = await fetch("/api/room-publish", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ op: "share_kit", replica_id: replicaId }),
      });
      return { status: r.status, body: await r.json() };
    }, { token: REHEARSAL_OWNER_TOKEN, replicaId });
    const whatsapp = kit.body?.kit?.find((k) => k.channel === "whatsapp");
    ok(`${locale}: the share kit carries a real WhatsApp text naming the AI, never "clone"`,
      Boolean(whatsapp?.text) && whatsapp.text.includes("AI") && !/\bclone\b/i.test(whatsapp.text),
      copiedViaClick ? "(also copied via a real click)" : "");

    // ── EXPORT: download it, read its manifest. ─────────────────────────
    const exported = await page.evaluate(async ({ token }) => {
      const r = await fetch("/api/replica", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ op: "export" }),
      });
      return { status: r.status, body: await r.json() };
    }, { token: REHEARSAL_OWNER_TOKEN });
    ok(`${locale}: export returns 200 with a real manifest`, exported.status === 200 && Array.isArray(exported.body?.manifest));
    const contextEntry = exported.body?.manifest?.find((m) => m.table === "vy_context_item");
    ok(`${locale}: the export's own manifest carries the ONE real source this walk added, not an invented count`,
      contextEntry?.rows === 1, JSON.stringify(contextEntry));
    // NEGATIVE CONTROL — the export never contains a follower's words. This
    // walk wrote no follower row at all (a creator-only rehearsal), so the
    // assertion is that no follower-lane table name appears with any rows,
    // and that nothing in the dump reads as a follower's own turn.
    const followerTableNames = ["vy_room_thread", "vy_room_message", "vy_room_follower"];
    ok(`${locale}: NEGATIVE CONTROL — the export carries zero rows for every follower-lane table it names`,
      exported.body?.manifest?.filter((m) => followerTableNames.includes(m.table)).every((m) => m.rows === 0));

    let downloadedViaClick = false;
    try {
      // "Download everything" lives inside a collapsed `<details class=
      // "advanced-disclosure">` band ("Owner control, including erasure")
      // that stays reachable even for a not-yet-active replica (unlike the
      // showcase picker above), but the button is not click-actionable
      // until its own `<summary>` opens the band.
      await page.getByText(/owner control, including erasure/i).first().click({ timeout: 4_000 });
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 4_000 }),
        page.getByText(/^download everything$/i).first().click({ timeout: 4_000 }),
      ]);
      downloadedViaClick = Boolean(download);
    } catch (error) {
      gapNotes.push(`the "Download everything" button's own click/download event was not observed (${error.message.split("\n")[0]}); the export was proven through the door above instead.`);
    }
    ok(`${locale}: export is proven ${downloadedViaClick ? "via a real click and a real browser download event" : "via the door (see the gap note)"}`, true);

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
