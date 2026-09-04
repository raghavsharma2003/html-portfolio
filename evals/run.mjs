// The eval suite, runnable from a clean checkout: bundles the REAL source
// first, then runs every suite against the bundle. This exists because the
// suites lived only in a session scratchpad for two days — core IP protecting
// the crisis helplines and the parser, discoverable by exactly nobody, and one
// container reap away from gone. An eval that is not in version control
// protects nothing.
//
//   node evals/run.mjs           # all suites
//   node evals/run.mjs parse     # one suite
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BUNDLE = join(HERE, ".bundle.mjs");

// parsetest.v2 taught this the hard way: a frozen bundle passes forever while
// the source rots. Rebuild from source on every run, no cache.
execSync(
  `npx esbuild ${join(HERE, ".entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(HERE, "stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);

const suites = {
  parse: "parse.mjs",
  // WS-BURST. The multi-message wait policy — pure, offline, no model call,
  // wired here under the same `dead-writers` test as the suites below.
  burst: "burst.mjs",
  // WS-BREATH. The scenario GRID — first-message shape × follow-up timing ×
  // device shape × his rhythm, ~480 cells, each driven through the real surface
  // clock in virtual time and checked against the seven properties the human
  // model is made of (never cut him off, liveness, the floor, no dead air,
  // handoff stays fast, the think-pause is not a cliff, web/Android parity).
  //
  // It exists because this defect has now been reported three times. Each wave
  // fixed the shapes it could think of, and the shape that came back — a
  // complete-LOOKING sentence followed by a think-pause — is the most ordinary
  // cell in the space and had no test anywhere in the repo. The answer to
  // "there will be thousands of cases" is a grid, not another patch.
  //
  // Pure, offline, deterministic, $0, ~1s.
  burstgrid: "burstgrid.mjs",
  // WS-AWAY. T9 session.clock — the overnight-gap facts, and the negative
  // control that keeps them from becoming a greeting she recites.
  away: "away.mjs",
  // WS-REPEAT. T14 rel.raised — repetition seen, his reception carried
  // alongside it, and the control that keeps her own sentences out of it.
  repeat: "repeat.mjs",
  // WS-HANGUP. "cut the call" read off HIS words — the half of the ask that is
  // structurally decidable, since a voice-lane marker of hers can be spoken.
  hangup: "hangup.mjs",
  // WS-SEARCH. The frequency cap behind the widened (curiosity, not doubt)
  // search trigger — capped in code because a brief cannot enforce a budget.
  search: "search.mjs",
  // WS-CHESS. Rules, her move selection, and the structured move assessment.
  // Standalone, offline, $0, ~17s. Wired the moment it landed, because the
  // workstream that wrote it could not wire it (file ownership) and flagged
  // that `dead-writers` applied to it until someone did — a suite nothing
  // invokes is indistinguishable from a suite that does not exist.
  chess: "chess.mjs",
  // WS-GAMES: the chess→words layer — opening book, threat facts, shapelint.
  chesstalk: "chesstalk.mjs",
  // WS-C (Gurukul pedagogy). The practice stack: the JEE Advanced syllabus
  // taxonomy, the grading state machine, and the practice→words adapter.
  //
  // Wired the moment it landed rather than left standalone, because
  // `dead-writers` bites hardest here: this suite is the only thing that
  // checks the JEE Advanced partial-marking scheme, and a marking bug is
  // SILENT — it does not crash, it moves a mastery track by the wrong amount
  // and chooses a sixteen-year-old's next problem on the strength of it. It
  // also carries the ability-label ban's negative control, which is the one
  // check in the practice stack that guards a promise made to a minor rather
  // than a number.
  //
  // Standalone, offline, deterministic, $0, ~2s. Re-bundles from the real
  // source on every run.
  practice: "practice.mjs",
  // WS-B (Gurukul). The teacher-sheet seam: the publish-time validator, the
  // runtime AgentModule constructor, and the consent gate.
  //
  // Wired here on the same `dead-writers` test as the suites around it, and
  // for a sharper reason than most: this suite is the only thing that checks
  // the PUBLISH GATE, and every way that gate fails is silent. A sheet with a
  // helpline the honesty allowlist does not carry publishes fine and ships a
  // clone that cannot say the child helpline. A sheet missing an arc override
  // publishes fine and ships a clone of a real named teacher, talking to a
  // sixteen-year-old, wearing the companion arc. Neither throws.
  //
  // It also carries the consent gate's negative control — the predicate
  // re-run with its consent clause struck, which must go quiet — because a
  // gate that passes against the bug it exists to catch is not a gate.
  //
  // Standalone, offline, deterministic, $0, no DB. Re-bundles from the real
  // source on every run.
  teachersheet: "teachersheet.mjs",
  // WS-F (Gurukul ingestion). The statistical pass, the phrase-bank rule, the
  // draft assembler's honesty, and the studio endpoint's dispatch.
  //
  // Three of its assertions are the ones worth naming here, because each would
  // go quiet under an ordinary-looking simplification:
  //
  //  - THE HELD-OUT CONTROL. The fixture contains a fragment that occurs 8
  //    times in the half a draft is mined from and 2 times in the half it is
  //    checked against. An in-sample check passes it; the suite asserts it is
  //    rejected. That is the only thing standing between "a habit this teacher
  //    has" and "a memorable line he said once", which is the difference
  //    teacher-sheet-spec.md §4.3 exists to draw, on the field the core
  //    deliberately licenses for REPETITION.
  //  - THE SPLIT'S OWN NEGATIVE CONTROL. Global-index parity is the obvious
  //    implementation and it hands one half every teacher turn of an
  //    alternating doubt session and the other half a corpus of a student's
  //    words. Both copies run here; the wrong one must be visibly wrong.
  //  - THE DRAFTER'S HONESTY, WITH A DISHONEST TWIN. `draft` ∪ `gaps` must be
  //    exactly the sheet contract, and a deliberately faking copy of the
  //    assembler — one field filled with something plausible and quietly
  //    dropped from the gap list — must fail the same predicate. That is the
  //    `silent-truncation` failure in miniature, and the shape
  //    teacher-sheet-spec.md §0 says a pipeline sized for the wrong number of
  //    fields produces: a sheet that looks complete and speaks with nothing in
  //    fifteen of its slots.
  //
  // The endpoint's logic runs against a FAKE db (api/replica-claims.js's split
  // is what makes that possible), so this suite stays offline, deterministic,
  // $0 and DB-free like everything else here.
  ingest: "ingest.mjs",
  // Evaluation-only Hinglish scoring. Raw Unicode WER/CER stays visible while
  // a bounded reviewed alias layer compares Roman Hindi with Devanagari ASR.
  // Unknown words and English confusables remain errors; coverage is explicit.
  hinglishscore: "speech/hinglish-script-score.test.mjs",
  hinditextfrontend: "speech/hindi-text-frontend.test.mjs",
  voicefrontier: "voice-bakeoff/frontier-plan.mjs",
  indicf5: "indicf5-runtime/run.mjs",
  indicf5pronunciation: "indicf5-pronunciation/run.mjs",
  openvoiceconverter: "openvoice-converter/run.mjs",
  voxcpm2: "voxcpm2-runtime/run.mjs",
  moss_tts: "moss-tts-runtime/run.mjs",
  zonos2: "zonos2-runtime/run.mjs",
  // WS-Y (Gurukul Mirror Call). The Call tab's state machine and the one
  // property the whole ambient-approval design rests on: an un-accepted delta
  // chip is never rendered as applied.
  //
  // Wired here rather than left as a studio harness because the studio's
  // existing checks (`evals/studio-*/harness.tsx`) are browser pages a human
  // opens, and nothing runs them. This half is pure — `mirrorCallMachine.ts`
  // has no React and no DOM in it precisely so the property could be fuzzed
  // by a node process instead of reviewed by eye.
  //
  // What it would catch: an optimistic accept (the obvious, friendly
  // implementation — show it applied, reconcile later) makes the UI claim a
  // change landed on the sheet that the server may have refused. That is
  // SPEC-GURUKUL §8 item 3's silent self-update wearing a checkmark. The fuzz
  // carries its own negative control: a reducer that trusts the tap must fail
  // the same property, and the suite asserts that it does.
  //
  // Offline, deterministic, $0, no DB, no browser, ~2s.
  mirrorcall: "mirrorcall.mjs",
  // WS-I (Gurukul stays-current loop). The re-ingestion worker end to end:
  // a new video on a watched channel becomes a PROPOSED delta on a
  // `vy_ingest_run` row, and stops there.
  //
  // Four of its assertions are the ones worth naming, because each would go
  // quiet under an ordinary-looking simplification:
  //
  //  - THE NEVER-SILENT-UPDATE NEGATIVE CONTROL. SPEC-GURUKUL.md §8 item 3
  //    is "never silent self-update of a live persona", and the suite writes
  //    the violating code itself: the approval op's UPDATE with the approver
  //    and the decision time struck out. The fake db enforces migration 053's
  //    `vy_ingest_run_approval_gate` exactly as Postgres does, so the twin is
  //    REFUSED. A fake that ignored the constraint would report an approval
  //    the database would have rejected.
  //  - THE SHEET IS NEVER NAMED. Not written, not READ. Asserted over every
  //    SQL string the sweep issued, because a worker that reads the published
  //    sheet to "compare" is one edit away from a worker that writes it, and
  //    that diff looks like a query which was already there.
  //  - IDEMPOTENCE THROUGH THE INDEX, NOT ONLY THE CURSOR. The suite resets
  //    `last_seen_video_id` by hand and sweeps again: the unique index on
  //    (replica_id, video_ref) must swallow every re-open. Reaching that
  //    point in production means an ASR bill would otherwise be paid twice,
  //    so a cursor-only check is a check of the cheap half.
  //  - A REVOKED WATCH PRODUCES ZERO CALLS. Counted, not filtered — the only
  //    honest way to assert an absence, and a revoked watch is a teacher who
  //    withdrew permission for their channel to be read.
  //
  // Offline, deterministic, $0, no DB and no network: the real worker driven
  // through a fake `db` and the fixture channel/ASR providers.
  channel: "channel.mjs",
  // WS-S (Gurukul in-house YouTube extraction). The lane that made the
  // stays-current loop able to reach a teacher's actual back catalogue —
  // `api/_channel/providers/youtube-oauth.js`'s `fetchAudio` was an honest
  // refusal, because the Data API has no download endpoint, and the answer is
  // a self-hosted `services/media-extract` wrapping a pinned yt-dlp.
  //
  // This lane is different in kind from every other consent lane in the repo
  // and the suite is shaped around that difference: the others gate what the
  // platform does with what a teacher HANDED IT, while this one reaches out
  // and reads media sitting on somebody else's platform. The only thing
  // between "a teacher's own lectures" and "a general-purpose YouTube
  // downloader" is a predicate, so the suite checks the predicate four ways:
  //
  //  - THE ATTESTATION GATE. No live `vy_channel_attestation` → refused, with
  //    a typed code, and the transport is never reached. Asserted by counting
  //    the fetches that must be ZERO, and the upload targets that must never
  //    be signed — the absence, not the branch.
  //  - THE BINDING GATE. A live attestation belonging to the SAME owner but
  //    naming a DIFFERENT channel must not authorize this watch. This is
  //    precisely the case an "is there an attestation?" check passes, and the
  //    difference between that check and "is there one FOR THIS CHANNEL?" is
  //    the entire design. A pre-057 row with a NULL `attestation_id` is
  //    asserted to read as UNATTESTED rather than grandfathered.
  //  - TYPED FAILURES, NEVER A CRASH. `extractor_bot_check`,
  //    `extractor_signature_failed`, `channel_binding_mismatch` and the
  //    duration ceiling each land as a DISTINCT `vy_ingest_run.failure_code`,
  //    because an operator must tell "the teacher withdrew permission" from
  //    "the yt-dlp pin is stale" from "this lecture is nine hours long"
  //    without opening a log.
  //  - THE NEGATIVE CONTROL. The attestation predicate is struck out and the
  //    suite asserts an unattested video then DOES extract. A gate nobody has
  //    watched fail is a gate nobody knows works, and this is the check that
  //    turns the three above from claims into evidence.
  //
  // Offline, deterministic, $0: the real provider, the real HMAC transport
  // client and the real worker, driven through a fake network that VERIFIES
  // the signature the client produced — a fake network, not a fake contract.
  mediaextract: "mediaextract.mjs",
  // WS-AI (Gurukul extraction routes). The seam that makes the choice of HOW
  // we reach YouTube one environment variable instead of a rewrite.
  //
  // Wired here rather than left as a script because the property it protects is
  // invisible on the happy path and expensive when it breaks: a residential
  // proxy costs money per gigabyte, and an extraction that quietly went out
  // direct returns exactly the same WAV as one that went through the proxy that
  // was paid for. The only moment the difference exists is the moment something
  // asserts the route the service reports against the route we asked for, so
  // that assertion has a negative control run in both directions.
  //
  //  - ROUTE SELECTION. Explicit beats inferred; nothing is silently upgraded.
  //  - NAMED REFUSALS. Every route without its credential refuses as ITSELF,
  //    with a distinct code, and every one of those codes reaches the owner's
  //    Activity surface as a written sentence AND a next action, because the
  //    fix is a thing only the owner can do.
  //  - PROVENANCE. The route that served the bytes is the route recorded, or
  //    the extraction is refused.
  //  - THE TWO HALVES. A working transcript route must never be able to hide a
  //    blocked audio route, which is what one combined readiness answer does.
  //
  // Offline, deterministic, $0, no network. The measurements that motivate it
  // are `measurements.md#youtube-extraction-blocked-from-azure` (WS-AD) and
  // `measurements.md#po-token-helps-until-the-ip-is-burned` (WS-AI).
  extractroutes: "extractroutes.mjs",
  // WS-N (Gurukul deployment). "Deploy the clone anywhere": the clone↔surface
  // binding (migration 055), the generalized surface resolution, and the
  // embeddable web widget.
  //
  // Wired here on the same `dead-writers` test as everything around it, and
  // for a sharper reason than most: every way this seam fails is silent AND
  // it fails in front of a student.
  //
  //  - THE WRONG CLONE ANSWERS. A mis-resolved binding replies just as
  //    promptly as a correct one and every log line looks healthy — the
  //    student asked their physics teacher and reached a persona built for
  //    consenting adults. So the suite asserts the resolution by AGENT ID and
  //    by the COMPILED CORE, not by "it replied".
  //  - THE FAIL-CLOSED SET IS INDISTINGUISHABLE. Unbound, paused, revoked and
  //    consent-withdrawn must be four situations and one error code, or a
  //    caller can enumerate which teachers took their clone down.
  //  - THE DISCLOSURE IS BOUND, NOT REQUESTED. The widget runs on somebody
  //    else's website, so "it renders the card" cannot be the mechanism. The
  //    session token carries the card's digest and a stale one cannot buy a
  //    turn — safety-floor-teacher.md §1's P1 as a predicate.
  //  - THE NEGATIVE CONTROL. The resolution predicate is re-run with its
  //    `status = 'connected'` clause struck, and the suite FAILS unless the
  //    struck copy answers the revoked binding.
  //
  // Offline, deterministic, $0, no DB, no network, no model call.
  clonechannel: "clonechannel.mjs",
  // WS-R1, the Room: the follower's side of a published replica, at /r/<slug>.
  //
  // Wired here on the same `dead-writers` test as the suite above, and for the
  // sharpest version of its reason yet: this is the first lane in the repo
  // where two DIFFERENT members of a creator's audience hold rows in the same
  // tables at the same time, so every failure here is a follower seeing
  // another follower, and every one of them returns 200.
  //
  //  - ONE FOLLOWER CANNOT SEE ANOTHER. Two followers, one room, one thread
  //    each. The suite asserts B is refused A's thread AND re-runs the same
  //    shipping call with the person clause STRUCK out of the SQL, failing
  //    unless the struck copy leaks. A check that passes against the bug it
  //    exists to catch is not a check.
  //  - THE CAP IS A PREDICATE. Twenty free messages a month, and the
  //    twenty-first is refused by the UPDATE's own WHERE clause BEFORE any
  //    work happens. The suite counts to 21, asserts the refusal is not
  //    mid-turn, and rolls the month over to prove the allowance returns
  //    through the same statement rather than through a second code path.
  //  - MEMORY IS GATED, NOT FILTERED. A follower who declined the memory
  //    question produces ZERO calls to the episode opener, the turn logger and
  //    the recall path, asserted by call COUNT: a filter applied later is a
  //    filter a later edit removes.
  //  - THE DISCLOSURE IS BOUND. A session minted against a different card
  //    cannot buy a turn, so a page cannot opt out of the card by not
  //    rendering it.
  //  - FORGET IS SCOPED AND REAL. It deletes over PERSON_TABLES, agent-scoped,
  //    leaves the other follower's rows and the room itself standing, and
  //    appends a withdrawal to the consent ledger rather than erasing a grant.
  //
  // Offline, deterministic, $0, no DB, no network, no model call.
  room: "room/run.mjs",
  // WS-R8. THE LEAK BATTERY — Phase 1's hard rule for Vyakti Rooms, made a
  // gate: "The leak battery runs clean before a second follower joins any
  // Room. No exception for a launch date." Built to `evals/mp/gate0.mjs`'s
  // shape (context/measurements.md#gate0-structural): a scenario generator (N
  // followers in {2,5,20} x 4 turns, each with unique tokens), the REAL
  // follower lane and the REAL compiler driving every turn, a printed
  // row-by-scenario count (16,080 retrieval checks + 441 boundary checks,
  // 0 leaks), and two negative controls that MUST fail — a struck person
  // clause and a "helpful" reply that pastes another follower's words in as
  // an example — proving the scanner is not vacuous
  // (`sound-gate-proved-by-silence`, context/rejected.md).
  //
  // Also asserts, statically, what no execution can: the follower lane's
  // import graph never reaches a WRITE-shaped symbol from a creator-material
  // file (the sheet, the person model, claims, mirror conditioning), and the
  // only creator-facing read of the Room's own tables is a count. What it
  // does NOT prove — `dmRecall`'s real SQL executing — is proven live,
  // elsewhere, at `evals/mp/gate0.mjs` (0/31,122 violations); this suite
  // checks that the exact predicate function is wired into `dmRecall`'s real
  // query text rather than re-deriving a weaker offline copy of that proof.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, ~6s.
  "room-leak": "room-leak/run.mjs",
  // WS-R7, the Room's creator side. WS-R1 built /r/<slug> and the tables it
  // reads (migration 071) but nothing INSERTED a `vy_room` row — until this
  // landed no Room could ever be opened by anyone, the sharpest shape of
  // `dead-writers` this repo has shipped. `api/_room-publish.js` is the
  // writer; this is its suite.
  //
  //  - THE PUBLISH LOCK IS THE WRITE, NEVER A BRANCH ABOVE IT. `published_at`
  //    only ever becomes non-null inside the UPDATE's own CASE, gated on
  //    three conditions: an active runtime capability, the readiness lock
  //    (its SQL fragment IMPORTED from `api/_clonechannel.js`, not re-typed,
  //    so "same three conditions" is true by construction), and an approved
  //    disclosure (the agent's `vy_teacher_sheet` published with a consent
  //    artifact — the same gate `resolveRoom` already requires of every
  //    follower, so `published_at` can never say "open" over a room nobody
  //    can actually reach).
  //  - THE NEGATIVE CONTROL. The readiness clause is struck out of the REAL
  //    statement text captured off the fake's own call log — not a
  //    hand-written approximation of the query, the query — and the suite
  //    fails unless the struck copy leaks the write.
  //  - A TAKEN SLUG IS A NAMED REFUSAL. `create` and `rename` both hit
  //    `vy_room_slug_ix`; the suite asserts a code, never a 500.
  //  - THE BLOCKER LIST IS CLASSED. A runtime held shut ONLY by
  //    platform-owned gates reports `waiting_on_us`; anything else reports
  //    `waiting_on_you` — `context/rejected.md#a-step-is-never-silently-blocked`.
  //  - STATS ARE REAL COUNTS, NEVER INVENTED. A room with no followers gets
  //    three real zeros from `count`/`sum` over an empty set, never a
  //    placeholder.
  //
  // Offline, deterministic, $0, no DB, no network, no model call.
  "room-publish": "room-publish/run.mjs",
  // WS-R11, the Room's money. The durable ledger and the provider seam:
  // price band enforcement, subscribe through the fake provider, webhook
  // signature verification (byte-exact, bad signature refused), idempotent
  // replay, the state machine, the tier flip (paid ONLY on 'active'), the
  // 25% split's arithmetic, the payout roll-up, PAYMENTS_PROVIDER=none
  // refusing every write, and the required negative control naming exactly
  // what would need to change in api/_payments.js for a skipped
  // verification to slip through.
  payments: "payments/run.mjs",
  // WS-R18, the Room on Telegram. A transport, never a tenant: every update
  // that reaches a reply goes through the SAME follower lane
  // (api/_room-surface.js) the web Room uses, with a Telegram-shaped
  // identity bridge (`personForSurfaceUser`/`linkSurfacePerson`,
  // `vy_surface_identity`) standing in for the web's Supabase bearer token.
  // Webhook secret fail-closed (unconfigured is a named 503, wrong secret a
  // 401, both before any db read), age attestation and the disclosure card
  // sent before any reply, the free cap spent through the identical
  // conditional UPDATE, `/forget` `/export` `/stop`, a group chat refused by
  // name, and a two-follower run through the real follower lane proving zero
  // cross-follower tokens (evals/room-leak's own scenario shape, reused).
  //
  // Offline, deterministic, $0, no DB, no network, no Telegram call.
  "room-telegram": "room-telegram/run.mjs",
  // WS-AB (the universal "bring your context" lane). The Context Locker end to
  // end: many files and many links become owned, hashed, quota-capped items,
  // and the ones this platform can honestly read become CITED proposals on the
  // review surface the channel lane already uses.
  //
  //  - THE ITEM-TYPE MATRIX. Every accepted format extracts, every refused one
  //    refuses BY NAME (including a corrupted file, an encrypted PDF and a
  //    scan with no text layer), and audio/YouTube are ROUTED to the lanes that
  //    already carry their permissions. A format silently stored-and-ignored is
  //    the failure this half exists to catch.
  //  - CITATION INTEGRITY, WITH TWO NEGATIVE CONTROLS. Every proposed addition
  //    names an item and a span and `body.slice(span)` really contains the
  //    fragment; a FABRICATED citation and an UNCITED addition must both fail.
  //    Without them, "cited" is a word the pipeline prints.
  //  - SPEAKER ATTRIBUTION, WITH ITS WRONG-SPEAKER CONTROL. A chat export is
  //    mined only for the declared owner; the control re-mines it declaring the
  //    other party and asserts not one citation lands on the owner's messages.
  //    A lane that got this wrong would still return confident, well-formed,
  //    resolvable citations — and a person's clone would talk like their mother.
  //  - The caps are REFUSALS with their numbers, never trims (`silent-
  //    truncation`), ownership is a predicate rather than a filter, and NO
  //    statement the lane issues names `vy_teacher_sheet`.
  //
  // Offline, deterministic, $0, no DB, no network, no model call.
  contextlocker: "contextlocker.mjs",
  // WS-D (Gurukul student surface). The mastery fold: thresholds, no
  // decay-by-absence, order-independence/monotonicity, and XP strictly from
  // graded outcomes — the properties `src/engine/practice/mastery.ts`'s
  // header names. UI correctness (PracticeActivity, MasteryMap) is carried by
  // typecheck + the web build, not by an eval — neither screen computes
  // anything this suite does not already cover at the engine layer.
  mastery: "mastery.mjs",
  // WS-ACTIVITY. The generic "what we are doing together" seam and its chess
  // adapter — plus the control that keeps dialogue out of it, since a line she
  // could say in this block is a line she would say every single game.
  activity: "activity.mjs",
  // Light/dark. Structural, because every way a theme breaks is silent — a
  // dark block reachable one way and not the other looks perfect to whoever
  // happened to have the matching OS setting.
  theme: "theme.mjs",
  // WS-GAMES: would-you-rather — deck lint, her-pick determinism, shapelint.
  wyr: "wyr.mjs",
  // WS-GAMES: tic-tac-toe — exhaustive legality + bounded imperfection.
  ttt: "ttt.mjs",
  // WS-TTT. CHESS PARITY for tic-tac-toe, which is a different question from
  // the one `ttt.mjs` answers: that suite proves she plays the game legally
  // and imperfectly, and this one proves the REST OF THE PRODUCT reaches it.
  //
  //   "tic tac also has so many issues she dont know whats up, dont talk
  //    clearly and intresting about it, memory issue also, and many other
  //    which chess also had."
  //
  // Chess got a correction ladder over two waves; ttt rode the same generic
  // seams the whole time and was reached by almost none of them. That is
  // `dead-writers` in its purest form — every seam "supported" ttt, so nothing
  // read as missing — which is why this battery asserts against COMPILED
  // PROMPTS and real played-out games rather than against the adapter: the
  // board state and its two-in-a-rows reaching a compile, a real game walked
  // turn by turn through the think table and the staleness seam, the lifecycle
  // facts saying "tic tac toe" instead of the union key she would read aloud,
  // the episode writer firing with a ttt-shaped record, the early-end
  // distinction that was chess-only, and nine negative controls that each
  // re-run a claim against the input that should break it.
  //
  // Hermetic (pinned clock and TZ, no ambient config), offline, deterministic,
  // $0, ~5s. Re-bundles from the real source on every run.
  tttparity: "ttt/parity.mjs",
  relleak: "relational/leak.mjs",
  // WS-K (ROADMAP-100X item 1). The disclosure-reciprocity ledger and its T17
  // wiring. Wired here on the same `dead-writers` test as everything else, and
  // for a specific reason: this block TOUCHES THE COMPILER, and the property
  // that makes that safe — an absent state moves zero bytes — is one nothing
  // else in the tree checks except by proxy. The suite also carries the
  // classifier's precision negatives, which are the half that keeps a
  // disclosure measure from quietly becoming a usage metric (inner.ts G1).
  // Offline, deterministic, $0, no DB, no model call, ~1s.
  reciprocity: "reciprocity.mjs",
  // WS-K (ROADMAP-100X item 2). The WITHIN-SESSION drift probe suite: a 44-turn
  // session compiled turn by turn on both lanes, with the anchors, the safety
  // floor, the register bullets, the stage band and the drop order asserted at
  // EVERY turn rather than at one convenient one.
  //
  // Every other eval in this tree tests a TURN. The external literature this
  // was built from (Identity Drift, ContextEcho) measures drift as a function
  // of SESSION LENGTH, and its named mechanism — persona instructions occupying
  // a shrinking fraction of context — is invisible to a single-turn suite by
  // construction: the existing gates would pass identically on a build whose
  // anchors survive turn one and are shouldered out by turn forty.
  //
  // It is STRUCTURAL only and says so in its own output: the behavioural half
  // (does her register actually hold) needs a judge and money, and plugs in
  // behind the provider seam in §5 rather than being faked into a number here.
  // Carries three negative controls, including the literal `prompt-position`
  // defect (the appended-last rules moved mid-brief).
  //
  // Offline, deterministic, $0, no DB, ZERO model calls, ~4s.
  drift: "drift.mjs",
  // WS-K (ROADMAP-100X item 3). The MEMORY RECALL BENCHMARK: 3 authored dyads
  // (190 Hinglish turns, 50 ground-truth questions across nine question
  // classes) driven through the REAL api/memory.js opRecall, with the database
  // mocked at api/_db.js's own module boundary.
  //
  // It exists because "does she remember correctly" was judged informally and
  // measured nowhere, which contradicts the house ethos in the one place it
  // matters most. It is a GATE rather than a report because everything it
  // asserts is silent when it breaks: a retrieval leg that reads zero rows
  // looks exactly like an empty store (`realtime-recall-never`), which is why
  // the router refuses to answer a statement it does not recognise.
  //
  // Honest about its own coverage, in the run header and not only in a
  // comment: the LLM EXTRACTOR and the SEMANTIC LEG are NOT exercised, so
  // every score is a lower bound and no number from it is written to
  // measurements.md. Offline, deterministic, $0, no DB, no network, ~1s.
  recallbench: "recallbench/run.mjs",
  // WS-Q. THE CLONE ALIVENESS GATE — a published clone's own life, and its
  // right to speak first.
  //
  // Wired here on the same `dead-writers` test as everything around it, and
  // for one specific reason worth naming: this suite carries the negative
  // control for the ONE mechanic `persona.ts` deleted on ethical grounds
  // ("do not re-add a silence-triggered ping in any form") and that
  // `teacher-arc.md` §7 rows 8/9 ban outright for minors. Every way that ban
  // fails is silent — a clone that pings a sixteen-year-old because they went
  // quiet looks like a working product from every log line — so the suite
  // sweeps an empty record across gaps from one minute to one year and asserts
  // zero verdicts, then rebuilds the deleted idle nudge and asserts the rebuilt
  // copy IS caught firing on the same input.
  //
  // It also carries gate Q1: with no clone fields present the compiled prompt
  // is byte-identical, which is the property that keeps the 83-fixture battery
  // meaningful after a seam is added to the compiler.
  //
  // Offline, deterministic, $0, no DB, no network, ZERO model calls, ~1s.
  clonelife: "clonelife/run.mjs",
  // WS-O (ROADMAP-100X item 4). BI-TEMPORAL FACT EDGES: the fact's own
  // validity interval (migration 056), the deriver over timeline.ts's real
  // date table, and the two consumers that replace a row-age guess with a
  // comparison — `staleNote`'s staleness and consolidation's contradiction
  // rule.
  //
  // It is a GATE and not a report because the property it protects is silent
  // in both directions. A lost fix reintroduces `stale-note-keys-on-row-age`:
  // she asks how a November exam went, in August, in a fluent sentence that
  // nothing about the output marks as wrong. A deriver that gets LOOSE is
  // worse and equally silent: it asserts a specific horizon where the old rule
  // merely shrugged, so §3's negatives outnumber §2's positives.
  //
  // Carries the defect itself as a fixture (dyad-b's `neet pg`, verbatim), the
  // one-parser assertion that fails if somebody inlines a regex into
  // validity.ts, and the absent-is-byte-identical property that lets 056 land
  // with no backfill. Offline, deterministic, $0, no DB, no clock, ~1s.
  validity: "validity.mjs",
  // WS-O (ROADMAP-100X item 5). The EXAMPLE-DIALOGUE FORMAT EXPERIMENT: the
  // one place where an outside consensus ("example dialogues are the single
  // most powerful tool") and a measured in-house result (`recited-prompt`:
  // example quotes recited 4/5, 0 after removal) point opposite ways.
  //
  // Three arms — no examples, quotable lines, micro-scenes — compiled through
  // the REAL compiler by wrapping the real agent module, matched on situation
  // set, order and byte count so FORMAT is the only variable.
  //
  // It measures the recitation SURFACE (emittable spans, liftable ratio,
  // n-gram overlap with a corpus of her own turns) and says in its own output
  // that a surface is not a rate. The decisive arm needs generation and a
  // judge and sits behind a provider seam that reports `judged: false`.
  //
  // Wired here rather than left standing alone because §0 is a real gate on a
  // real risk: it asserts the quotable arm's text reaches NO shipping prompt,
  // which is the property that makes it safe for a phrase bank to exist in
  // this repo at all. §4 reports a live gap — shapelint's sentence-shape rule
  // is anchored on English orthography and cannot see a Hinglish phrase bank.
  //
  // Offline, deterministic, $0, no keys, no DB, no model call, ~2s.
  exdialog: "exdialog/run.mjs",
  // WS-MOVEVOICE: her hand and her mouth on ONE timeline. The owner played
  // chess on a call, she moved milliseconds after him, and then her voice said
  // she SHOULD play the move already on the board. Gates the three halves of
  // the fix — the seeded think-time table, the composed note that states the
  // CHOICE as closed, and the send seam that drops a note whose position has
  // moved. Carries the owner's exact case as a permanent fixture and its own
  // negative control (the pre-fix note shape, which MUST be rejected).
  // Offline, deterministic, $0, ~3s.
  movevoice: "movevoice.mjs",
  // WS-GAMEPLAY: the chat-initiated game invite (src/engine/gameInvite.ts).
  // Deliberately lopsided toward NEGATIVE cases — a missed invite costs one
  // trip to the games menu, a spurious one is the app interrupting a
  // conversation to sell a board.
  gameinvite: "game-invite.mjs",
  // WS-GAMIFY: moments fire once, largest-tier-only, charter-clean.
  milestones: "milestones.mjs",
  // WS-SYNC: the push list, merge semantics and account-switch reset agree.
  sync: "sync.mjs",
  // WS-STATE: the boundary cluster. Move-record validation at the game
  // boundary, user coercion at every adopt, the cross-tab merge, and THE
  // CLASS CHECK: every optional AppState field is either wiped by the
  // teardown or exempted in writing. Offline, $0, ~2s.
  teardown: "teardown.mjs",
  // Human-replica control plane: consent capability, verified self-only live
  // challenge, versioned eval verdicts, lifecycle, private object paths and
  // content-free audit. Offline and provider-free.
  replica: "replica/run.mjs",
  // Owner enrollment: account consent cannot mint biometric/inference rights;
  // evidence is MIME/size/hash bounded, stored under opaque owner paths and
  // uploaded only through a short-lived capability into a verified private
  // bucket. Offline, deterministic, no DB or storage call.
  replicaenrollment: "replica-enrollment/run.mjs",
  // Azure Blob large-media seam: create-only browser SAS, durable provider
  // locators, deterministic checksummed blocks, mixed-provider processing and
  // exact erasure. Every provider response is an offline fixture.
  azureblob: "azure-blob-storage/run.mjs",
  // Studio enrollment truth: owner-labeled language coverage never becomes
  // automatic detection, and a selected or processing calibration never reads
  // as a ready Hindi/Hinglish reference. Offline, deterministic, no media call.
  studioenrollmentquality: "studio-enrollment-quality/run.mjs",
  // Explicit owner-only test builds remove verification and publishing
  // ceremony from the mounted UI while production remains the default. The
  // suite carries the naive "hide Deploy only" negative control so old
  // identity/liveness blockers cannot leak back into the simplified rail.
  studioselftestui: "studio-self-test-ui/run.mjs",
  // Noisy-evidence processing: immutable derivatives, composite ownership,
  // retry-safe leases, provenance-carrying ASR/diarization/analysis evidence
  // and draft-only VoiceGenome builds. Fake adapters prove contracts only;
  // there is no network, model call or quality claim in this gate.
  replicaprocessing: "replica-processing/run.mjs",
  // Replica delivery safety: active verified self-only capability, approved
  // version bindings, audible disclosure before playback, streaming watermark,
  // C2PA asset binding and a signed content-free public receipt. Production
  // refuses the deterministic adapters used by this offline gate.
  replicaprovenance: "replica-provenance/run.mjs",
  // Deployable protection plane: official AudioSeal streaming watermark,
  // C2PA Python sidecar, Azure Key Vault signatures, authenticated transport,
  // exact-byte binding and a content-free public verification endpoint.
  productionprotection: "production-protection/run.mjs",
  // Real noisy-audio evidence plane: exact-pinned public models, private
  // authenticated transport, dual speaker embeddings, non-destructive
  // separation/enhancement candidates and deliberately unknown target
  // identity until a verified anchor or owner review exists.
  voiceevidence: "voice-evidence/run.mjs",
  // Permission-independent zero-shot synthesis: immutable MIT Chatterbox V3,
  // private HMAC transport, exact disclosure, verified PerTh watermark,
  // Hindi support and a digest-pinned scale-to-zero Azure GPU deployment.
  openvoice: "open-voice/run.mjs",
  // Blinded owner A/B calibration: exact protected generations, constant
  // prompt/identity/model controls, server-owned delivery conditions and an
  // append-only content-free preference ledger for future model updates.
  voicepreference: "voice-preference/run.mjs",
  voicecurriculum: "voice-curriculum/run.mjs",
  voicedeliverypolicy: "voice-delivery-policy/run.mjs",
  voicedeliveryholdout: "voice-delivery-holdout/run.mjs",
  // Deployable scale-to-zero consumer: composite-tenant leasing, real private
  // byte verification, current ClamAV, ffprobe, exact evidence adapters,
  // immutable persistence and one-step DAG settlement.
  processingworker: "processing-worker/run.mjs",
  // WS-AH. The CALLER for the above. `runNextProcessingJob` was a complete
  // runner that nothing invoked, so one real 32.9 MB upload sat at
  // integrity/queued and never moved. This suite holds the sweep's auth
  // refusal, its job bound, its legible degradation when a credential or a
  // binary is absent, and the property that matters most: a step we cannot
  // perform NEVER yields a clean verdict. That last one carries its own
  // negative control, because an assertion that a scanner refuses is worthless
  // unless something proves the scanner could have said yes.
  processingsweep: "processing-sweep/run.mjs",
  // Owner processing review: strict tenant binding, append-only controlled
  // decisions, privacy-safe summaries, real-evidence readiness and an
  // idempotent draft-only VoiceGenome queue.
  replicareview: "replica-review/run.mjs",
  // Internal owner testing can auto-grant enrollment ceremony gates only when
  // an exact three-part environment guard and the authenticated/leased owner
  // UUID all match. The legacy one-flag form stays fail-closed.
  replicaselftestmode: "replica-self-test-mode/run.mjs",
  // Crash-recoverable, consent-fenced VoiceGenome materialization: one exact
  // owner-accepted evidence set becomes a draft only, never an active voice.
  modelbuild: "model-build/run.mjs",
  // Private replica runtime: immutable qualified version bindings, owner-only
  // agent/person resolution, RelationalOS isolation, protected cascade speech
  // and revocation fencing at the signed segment boundary.
  replicaruntime: "replica-runtime/run.mjs",
  // WS-J. The fidelity guarantee (SPEC-GURUKUL §8.2): "still sounds like them"
  // as a number that gates activation rather than a claim in a brief.
  //
  // Score math over fixture ECAPA vectors (identical -> 1, orthogonal -> 0,
  // known-similarity fixtures per verdict tier, and the one-bad-window case
  // that the mean cannot see and `worst`/`p10` can), the thresholds proved to
  // be DATA (one changed floor moves the verdict with no code edit), the
  // activation gate's negative controls in BOTH directions (no fidelity row
  // and a 'fail' row each fail closed, with ONE indistinguishable blocker code
  // so "never benched" cannot be told from "benched and failed"), and the
  // recompute-on-update law that stops a stale pass covering a new voice.
  //
  // It is wired here rather than left standalone for the `dead-writers`
  // reason, and because the thing it guards is a gate: a fidelity gate nothing
  // runs is a fidelity gate that silently stops gating. Offline,
  // deterministic, $0, no GPU, no model, no network — every embedding is a
  // fixture vector, which is exactly what the audio/vectors seam buys.
  fidelity: "fidelity/run.mjs",
  // WS-V. earbench — the MECHANICAL half of the blind listening bench that the
  // fidelity law above depends on and that did not exist until now. The ECAPA
  // number is a regression monitor by decision; activation quality is decided
  // by a blind owner pass, on the precedent of `rejected.md#azure-tts` where
  // every measured axis said switch and the ear said no.
  //
  // What is wired here is the INSTRUMENT, never the listening: blinding (opaque
  // ids, one file size, one wire length, no arm anywhere a listener can reach),
  // counterbalance, the disclosure trim and its fail-closed refusals, the local
  // server's inability to serve its own answer key, and the scorer's three
  // verdicts — distinguishable / indistinguishable-from-chance / under-powered.
  // That third one is the point: "not significant" is not evidence of sameness,
  // and a bench that conflates them would license a claim nobody measured.
  //
  // Offline, deterministic, $0, loopback only, ~3s. The listening pass itself
  // is deliberately NOT reachable from here — a gate that waits for a human to
  // put headphones on would wedge CI until they did.
  earbench: "earbench/run.mjs",
  // The cross-candidate owner listening pack. This is the mechanical half only:
  // exact source and transformed-audio binding, opaque ids, one WAV geometry,
  // a private whitelist server, attention checks, hidden repeats, the explicit
  // unseal latch, and the rule that only equal language plus equal text hash
  // cells may be compared. Human listening remains outside CI by construction.
  voicelistening: "voice-listening-benchmark/run.mjs",
  // The fair successor to the consolidated listening pack: every provider in
  // a language receives the same owner window, exact text, disclosure, seed
  // and consent binding. The suite is synthetic and offline; cloud execution
  // stays behind a separate explicit confirmation and a USD 5 ledger stop.
  voicematched: "voice-matched-pack/run.mjs",
  // WS-R6. The vendor bench arms. `decisions.md#platform-north-star` names the
  // evidence that would make a vendor primary again and no vendor arm had ever
  // been benched, so the reversal condition was unfalsifiable. This suite is
  // the mechanical half: an absent key is a named unavailability rather than a
  // clip, vendor audio arrives as the platform's one format or fails by name,
  // the per-day character budget refuses before a paid call, a 402 keeps its
  // own blocker, and erasure reaches the vendor through the existing sweep.
  // The negative control is the point: an arm that fabricates a clip with no
  // key fails it. Offline, deterministic, $0, no network.
  voicevendor: "voice-vendor/run.mjs",
  // Evidence-backed personality: append-only owner claim decisions,
  // contradiction-preserving typed Person Models, deterministic source-set
  // builds and explicit exact-version approval.
  personmodel: "person-model/run.mjs",
  // Typed owner calibration: server-owned behavioral contrast pairs,
  // append-only revisions, deterministic calibration policies and exact
  // Person Model/runtime version binding without free-text prompt accretion.
  replicacalibration: "replica-calibration/run.mjs",
  // Privacy-bounded claim extraction: reviewed target-speaker spans only,
  // character-preserving direct-identifier redaction, strict Azure Foundry
  // structured output, exact quote citations and proposal-only persistence.
  replicaextract: "replica-claim-extraction/run.mjs",
  // Version-frozen private dialogue: typed Person Model + calibration,
  // agent/person-scoped relationship context, erasable raw logs, strict
  // structured output and server-bound protected speech.
  replicadialogue: "replica-dialogue/run.mjs",
  // Atomic finite-grant control: conservative reservation before paid network
  // calls, measured settlement, crash/unknown reconciliation and content-free
  // accounting under one hard Azure application ceiling.
  providerbudget: "provider-budget/run.mjs",
  // Approval-gated Azure Personal Voice lifecycle: consent, verified private
  // audio, native-unit spend fencing, pinned synthesis, status and deletion.
  personalvoice: "azure-personal-voice/run.mjs",
  // Azure voice-talent consent is a second, challenge-bound capability: the
  // exact provider statement, encrypted legal name, private audio artifact,
  // verified self-only eligibility and a non-generic finalization path.
  providerconsent: "provider-consent/run.mjs",
  // The exact approved VoiceGenome and provider-consent artifact become one
  // deterministic metered profile through short-lived private reads. Status,
  // tenant binding and deletion remain server-only and provider-neutral.
  voiceenrollment: "voice-enrollment/run.mjs",
  // Replay-resistant self-verification: exact randomized phrase, face
  // liveness+identity, single-speaker continuity, synthetic-media risk,
  // capture binding, one-way leases and evidence-bound biometric consent.
  livenessverify: "liveness-verification/run.mjs",
  identityproof: "identity-proofing/run.mjs",
  // WS-R2. Owner identity by SPEAKER VERIFICATION: the path that ships now,
  // beside the never-deployed Azure stack the two suites above cover.
  //
  // The score math over fixture ECAPA vectors at each of the three measured
  // bands (accept 0.78, review 0.70-0.78, reject below 0.70, all citing
  // measurements.md#first-real-clone), the thresholds proved to be DATA, the
  // anti-replay half (a replayed recording of the owner scores HIGH on voice
  // and is still refused, because it cannot contain a nonce generated after
  // it was made), expiry, cancellation, crash recovery, and the settlement
  // writing the SAME three vy_replica columns under the SAME age guard that
  // the Azure liveness settlement writes.
  //
  // Wired here rather than left standalone for the `dead-writers` reason and
  // because the thing it guards is THE identity gate: this is the only path
  // by which anyone can satisfy identity_verification_required on a deployed
  // tree, so a suite nothing runs is an identity gate that silently stops
  // gating.
  //
  // Its load-bearing case is a NEGATIVE CONTROL that removes the transcript
  // check and watches the identical replay be accepted, which is the only way
  // to show the transcript half is what stops a replay rather than decoration
  // beside the speaker score. Offline, deterministic, $0, no GPU, no model,
  // no network.
  identitychallenge: "identity-challenge/run.mjs",
  // Deployable Azure identity broker: exact private-byte binding, pinned
  // Document Intelligence and Face calls, independently signed authenticity
  // review, content-free results, tamper/replay fencing, official Face
  // liveness-with-verify quick links, sealed handles and provider deletion.
  azureverify: "azure-verifier/run.mjs",
  // Owner-only consumption of the official Face session contract: narrow
  // pre-processing consent, pseudonymous device binding, sealed handles,
  // crash-safe issue/poll/delete states and provider deletion before pass.
  facesession: "face-session/run.mjs",
  // Crash-safe biometric deletion: disable-first semantics, one-way leases,
  // idempotent Azure voice+consent deletion, bounded backoff and a scheduled
  // reconciler that keeps working even when new cloning has been disabled.
  voiceerasure: "voice-erasure/run.mjs",
  // Raw-source deletion is a complete lineage operation: exact private
  // original+derivative removal, external-voice fencing, claim deletion and
  // conservative scrubbing/retirement of models that cannot prove exclusion.
  sourceerasure: "source-erasure/run.mjs",
  // Full replica deletion: child provider/storage fencing, exact synthetic
  // agent memory purge, encrypted private-row cascade and an unlinkable
  // content-free receipt with explicit backup-policy expiry.
  replicaerasure: "replica-erasure/run.mjs",
  // Exact-version, multidimensional owner adjudication of a private turn,
  // including encrypted correction exemplars and sealed-audio lineage.
  replicafeedback: "replica-feedback/run.mjs",
  // Content-free, conversation-locked feedback datasets with immutable split
  // assignments, depth/coverage gates and exact latest-revision rechecks.
  feedbackdataset: "feedback-dataset/run.mjs",
  // Blinded paired target-improvement plus cross-layer noninferiority and
  // zero-tolerance safety gates; qualification never activates a candidate.
  candidatequal: "candidate-qualification/run.mjs",
  // Replay-safe owner A/B evaluation: encrypted private assets, server-held
  // candidate mapping, balanced assignments and all-layer atomic judgments.
  candidateeval: "candidate-owner-eval/run.mjs",
  // Second-agent readiness: every shipping insert names agent_id, every
  // relational/natural-key arbiter is composite, and compatibility defaults
  // have explicit strict migrations with a working negative control.
  agentstrict: "agent/strict-readiness.mjs",
  agentroom: "agentroom.mjs",
  persona: "persona-invariants.mjs",
  fixtures: "fixtures.mjs",
  // WS-HONESTY. Offline and deterministic (no judge, no model call, no cost),
  // so it belongs in CI by the same test the D0/D1 note below applies. Wired
  // here rather than left as a standalone script because `dead-writers` is
  // this repo's law and it does not stop being true for evals: a suite
  // nothing invokes is indistinguishable from a suite that does not exist.
  honesty: "honesty/run.mjs",
  // T-H3 (docs/HONESTY.md). The chat tail that rides the call's ONE assembly,
  // its shape-lint, its budget arithmetic, and the source assertion that every
  // frozen-at-connect compile site carries it. Offline, deterministic, $0,
  // ~2s — wired here rather than left standalone for the reason T-H4 gives:
  // `dead-writers` does not stop applying to evals.
  chattail: "chattail/run.mjs",
  // WS-CALLMEM. The four voice-call defects the first external tester found:
  // the call lane never carried what was said on the PREVIOUS call (chat did,
  // as turns), a long call loses its own beginning to the server's sliding
  // window, "bye" never ended anything, and a failed lookup was silent so she
  // announced a check and then invented. Offline, deterministic, $0, ~3s —
  // wired here rather than left standalone because `dead-writers` does not
  // stop applying to evals.
  callmem: "callmem/run.mjs",
  // WS-SHARENOW. The share he had one minute before he called back: he
  // screen-shared, hung up, called again sixty seconds later, asked what they
  // had watched, and she did not know. The shared-history block DID carry
  // share commentary — as the last three turns before the callmark, under a
  // heading that calls it "BEFORE TODAY" and forbids reading it back — so the
  // freshest thing that ever happens between them was the one thing the brief
  // could not say. This drives the whole flow from the real source (her lines
  // → the share-end mirror → the just-happened block → the real compiler) and
  // carries the owner's exact scenario as a permanent fixture, plus its honest
  // half: a share she was quiet through says so instead of inventing.
  // Offline, deterministic, $0, ~3s.
  sharenow: "sharenow/run.mjs",
  surface: "surface.mjs",
  // WS-MEMORY: finished games become graph episodes; the laundering predicate;
  // photo-forget path round-trips. Offline, db-free (config stub), ~2s.
  gamemem: "gamemem.mjs",
  // T-H2 (docs/HONESTY.md). An activity is a fact with an expiry: the
  // write-time classifier on SelfFact, the min(3h, next night) render window,
  // and the legacy byte-identity fixture proving a kind-less ledger still
  // renders exactly as it did. Offline, $0, ~2s.
  herlife: "herlife.mjs",
  // WS-HERNOW. Her present moment as a LEDGER with one row rather than a
  // fresh improvisation per pickup: he called and she was reading; he called
  // back one minute later and she was setting fairy lights, which are two
  // nouns from the same story picture and nothing in the app held the answer
  // she had already given. The suite carries BOTH fixtures — the one-minute
  // re-call that must not change the activity, and the ninety-minute one that
  // must — plus its own negative control (the pre-fix scene, seen going empty
  // on exactly the pickup that broke). Offline, deterministic, $0, ~3s, and
  // it re-bundles from the real source like everything else here.
  hernow: "hernow.mjs",
  // WS-AFFECT: one rupture, every channel — the T2 stance block compiles
  // byte-identical across chat/cascade/live/watch, lapses cross all four
  // together, the record never moves, and G2 holds in both directions on
  // both lanes. Offline, $0.
  rupturechannel: "rupture-channel/run.mjs",
  // WS-BURST. The greet-once predicate (src/engine/greeting.ts) and the
  // structural proof that a burst reaches the model as ONE user turn.
  greeting: "greeting.mjs",
  // WS-BURST. The wiring itself: the policy stays in the engine, and the
  // reply chain's flags are taken once and released in a finally — the
  // busy-held-across-recursion class made impossible rather than avoided.
  burstwiring: "burstwiring.mjs",
  // WS-WORLD. The sky-is-the-clock table: five states, their boundaries to
  // the minute, the away.ts dark-window invariant, the moon, and the ?sky=
  // seam the screenshot battery drives. Offline, deterministic, $0, ~2s.
  sky: "sky.mjs",
  // WS-TIME. The two clocks (src/engine/timeline.ts) — her day as a pure
  // function of the hour, and what has moved in HIS world since they last
  // spoke. DB-free, network-free, model-free and ~11s, including its own
  // negative control (7 injected defects, 7 caught), so it belongs here by
  // the same `dead-writers` test the honesty suite is wired in under.
  time: "time/run.mjs",
  // WS-BATTERY (SPEC §13/§14): D0/D1 are offline and deterministic — no
  // judge, no model call, no cost — so they run here, in CI, on every build,
  // same as the suites above. D2 and up are judged/generative (real money)
  // and are DELIBERATELY NOT in this map: run them by hand via
  // `node evals/dbattery/d2.mjs` (gated internally behind
  // WSBAT_RUN_JUDGED=1 — see that file's header). Keeping them out of this
  // object, rather than adding an in-loop skip, is the mechanism that makes
  // "D2+ never runs in CI" true by construction instead of by remembering.
  d0: "dbattery/d0.mjs",
  d1: "dbattery/d1.mjs",
  // The judged suites' PLUMBING, not the judged suites: dryrun-check drives
  // judge-backtest and d2 end to end against a deterministic mock — no
  // network, $0, ~0.2s — so a pipeline regression is caught in CI while the
  // by-construction exclusion of real judged runs above stays intact.
  judgedryrun: "dbattery/dryrun-check.mjs",
  // WS-SELFBUNDLE (T-H1). Its OFFLINE half only: manifest declaration, drop
  // priorities and the tail-budget arithmetic for T11/T12/T13. Wired here
  // under the same `dead-writers` test as the two suites above.
  //
  // The suite's ACTUAL gate is `--live`, and it is deliberately NOT reachable
  // from this map: it seeds and tears down rows in the real database under the
  // real agent id, which is not a thing CI may do on every build (and the APK
  // workflow has no NEON_URL at all). Same by-construction exclusion the D2
  // note above describes — run it by hand:
  //     node evals/self/wiring.mjs --live
  selfwiring: "self/wiring.mjs",
  // WS-TRACE (docs/TRACE.md). The OFFLINE half: the content firewall, the
  // correlator replayed over two REAL production turns, the tap's cost, and a
  // structural check that no trace write sits on any reply path. No database,
  // no network, no money, ~2s — so it belongs here by the same test the
  // honesty and time suites are wired in under, and `dead-writers` does not
  // stop being true for evals.
  //
  // Its LIVE half (evals/trace/roundtrip.mjs) is deliberately not in this map,
  // for the same by-construction reason d2 and selfwiring --live are not: it
  // needs NEON_URL and it WRITES. Run it by hand:
  //     node evals/trace/roundtrip.mjs
  trace: "trace/run.mjs",
  // WS-DEPTH's own drift check — api/consolidate.js's plain-JS mirrors of
  // relstate.ts's clampTrustDelta/moveTrust/ruptureRepairShift/ruptureStance
  // (+ mapEpisodeCitations/tokenizePhrase, WS-DEPTH-only) against the REAL
  // relstate.ts, bundled fresh via esbuild. Existed already, wired nowhere
  // (`dead-writers`) — no workflow, no npm script, not this file — until
  // now. Offline, $0, no network, no DB.
  wsdepthpure: "wsdepth-test-pure.mjs",
  // #86 rupture_open record-vs-stance split (context/rejected.md
  // `rupture-never-closes`): proves the record survives a lapse untouched,
  // the stance actually lapses on the chosen time/warm-interaction
  // condition, and an explicit new rupture re-opens — including the exact
  // stuck-open-forever gap the ticket was filed for. Offline, fixture-based,
  // $0, bundled fresh from relstate.ts on every run.
  rupturelapse: "rupture-lapse.mjs",
  // WS-SPINE. The consolidation spine: the watch contract's negative test
  // (screen-derived turns can never become durable facts), kin precision
  // including the friend's-mother trap, watch-episode finalization, the
  // grounding checks for rel-state/phrase/pattern/life-told derivation,
  // change-over-time, second-agent parity, and the enablement rails.
  //
  // Wired here specifically because this is the suite that guards the change
  // which turns REAL SPEND ON: the hourly cron has been dry-run since it
  // shipped, and the run that flips it is the first one ever to derive from
  // months of backlog. Offline, deterministic, $0, ~3s — it costs CI nothing
  // and it is the only thing standing between a flipped flag and a fabricated
  // fact about somebody's mother.
  consolidation: "consolidation/run.mjs",
  // Migration 018 and the raw RelationalOS boundary: schema parity, explicit
  // writers, pre-rank readers, per-agent consolidation cursors/leases and
  // cross-agent negative controls. Offline, deterministic, no DB/network.
  rawisolation: "agent/raw-isolation.mjs",
  // WS-RECALL. The retrieval cluster (the Hinglish tokenizer's 19-query
  // battery and its precision negatives, the two dead stores' new readers,
  // RRF fusion, the co-citation hop, and the structural proof that spaced
  // resurfacing is a rank modifier and never a trigger) plus the FATE walk
  // that asks every SERVER store what a forget does to it — the question
  // evals/teardown.mjs asks of every AppState field, one layer down, and the
  // one nobody was asking of the database. Offline, $0, no network, no DB.
  recall: "recall/run.mjs",
  // WS-MEMEVAL. THE LANE-PARITY GATE: one row per context block, one column
  // per lane (chat/cascade/live/watch), a verdict in every cell, and an
  // exemption that must state its reason in writing. It mechanises the rule
  // `rejected.md#call-opens-with-amnesia-by-construction` ends with and left
  // as prose — "every context block that exists must be asserted PRESENT on
  // every lane that claims it" — so the next dark block is caught at commit
  // time instead of by a paying tester. Carries its own negative control
  // (the pre-fix live lane must be seen going dark). Offline, $0, ~3s.
  lanes: "lanes/run.mjs",
  // WS-LIFECYCLE. THE OVERLAP MATRIX: 10 lifecycle events x 5 concurrent
  // contexts, a verdict in every one of the 50 cells, and the carrier named —
  // `assembly`, `direct`, `state` or `silent` — with a written reason.
  //
  // It exists because the owner should never have to enumerate an overlap
  // case again. Every previous wave fixed the pair he happened to hit (a board
  // open at pickup, a move mid-call, a share mid-call, a call that dropped
  // mid-sentence); the set of pairs is finite and this walks all of it. Same
  // idiom as `lanes` directly above, applied to PROPAGATIONS instead of
  // context blocks, and the same two failure modes: a cell that claims
  // `direct` with no sender in useCallEngine.ts is a propagation DECLARED AND
  // DEAD, and a cell that claims `silent` while something can reach her is the
  // table lying. The `assembly` cells are driven through the real compile()
  // and the real CALL_OPEN_DIRECTIVE off real board sessions, never a model of
  // them. Carries seven negative controls, including the pre-fix tree going
  // dark. Offline, $0, ~3s.
  lifecycle: "lifecycle/run.mjs",
  // WS-MEMEVAL / survey A4. The adversarial Hinglish forget battery. NOT a
  // gate: it reports a measured baseline against the CURRENT lexical matcher,
  // which is known to be poor on cross-lingual referents — a gate that fails
  // on a known-unfixed thing is noise, and noise is how a suite stops being
  // read. It fails only if the battery itself breaks or the baseline moves
  // DOWN, which is the direction nobody intends. See its header.
  forgetlex: "forget/a4.mjs",
  // WS-FORGET-A1 (survey §Q5). The mutation-time forget matcher. THIS half IS
  // a gate, unlike a4.mjs next door, because everything it asserts is offline
  // and decided: the shipped prompt's schema and its lack of a voice, the
  // parser's id closure (the anti-fabrication property — the resolver cannot
  // name a row it was not shown), the union-not-replace composition, the
  // two-lane call cap and fuse, the receipt gate, and the FAIL-SAFE proof —
  // a hook that fails on every case is byte-identical to the old lexical
  // matcher and never yields an unhedged receipt.
  //
  // It also re-derives A4's pre-registered headline (5.9% / 100% / 2 wrong
  // rows) from its own emulation, so the two files agreeing is a check rather
  // than a coincidence.
  //
  // Offline, $0, ZERO model calls — the live arm needs `--live` and an
  // explicit lane, and is deliberately not reachable from here
  // (`dryrun-still-spends`).
  forgethook: "forget/a1.mjs",
  // WS-FORGET-XS (`legacy-forget-is-device-scoped`, closed 2026-08-26). The
  // structural half of the cross-surface forget gate: every legacy-lane
  // device predicate reachable from opForget must be written over the
  // person's device SET, resolved exactly once, failing closed to the asking
  // device. The functional half — seed two surfaces, wipe through the real
  // handler, both empty, another person and a group room SURVIVE — needs a
  // live database and runs with `--live`; it is deliberately not reachable
  // from here. Offline, $0, ~1s.
  forgetxs: "forget/crosssurface.mjs",
  // WS-FELTBATTERY (docs/MEMORY-FELT.md §9). The OFFLINE half of the
  // felt-memory acceptance battery: 14 long-horizon dyads compiled through the
  // REAL engine, the pre-registration hash checked against the committed
  // manifest, every one of the eight behavioral laws covered by at least two
  // probes, the named adversarial twins paired, every rubric linted as a
  // rubric, and every context block a probe leans on asserted present on that
  // probe's lane. Carries its own two negative controls. Offline, $0, ~2s.
  //
  // The JUDGED half (evals/feltmem/run.mjs --live) is deliberately NOT in this
  // map, for exactly the reason the d0/d1 note above gives for D2: it spends
  // money, and keeping it out of this object rather than skipping it in-loop is
  // what makes that true by construction instead of by remembering.
  feltmem: "feltmem/gate.mjs",
  // WS-KNOWS. The "what she remembers" surface: the three pure selectors
  // behind it, and the two ways it can fail that no layout review catches —
  // offering a delete the item-scope cascade cannot actually perform (asserted
  // against the real SQL in api/memory.js, ritual rows included as the
  // negative), and drifting into a surveillance dashboard (no count rendered,
  // no clock stamp anywhere, decided on the component's bytes). Offline, $0.
  knows: "knows.mjs",
  // WS-SOUND. The sound layer (src/sound/): the vocabulary is closed and every
  // cue declares its haptic level, its mix and its span; there is exactly one
  // path from a component to the speaker and it is downstream of every gate;
  // nothing sounds before the first user gesture, with the toggle off, in a
  // backgrounded tab, or while a call is live, connecting or sharing a screen.
  //
  // That last one is why this is a GATE and not a note. A cue during a call
  // leaves the speaker, enters the mic and lands in the echo coefficient that
  // evals/echosim/ measures the entire audio floor against, so a defect in
  // this layer would be diagnosed in that one. It carries its own in-run
  // negative control (the same fixture re-bundled with the in-call clause cut
  // out, which MUST leak), because an assertion whose evidence is silence
  // passes just as happily on a dead feature as on a working gate.
  //
  // Offline, deterministic, $0, no browser, no network, ~2s. It re-bundles
  // from the REAL source on every run, same as this file does.
  sound: "sound.mjs",
  // WS-NOTIFY. The notification lane (src/notify/): a lock screen may only ever
  // carry text she actually sent, which is asserted by the ABSENCE of any
  // constructor that could produce a generic line rather than by grepping for
  // one; the single permission ask is unrepeatable in both directions; the
  // exact schedule payload is checked against a plugin recorder, emulator-free;
  // and docs/PRODUCT-SUPERIORITY.md §5(c)'s lint is here — no notification call
  // site takes a delay or an interval, enforced over the SOURCE because the
  // failure it prevents is a future edit and no test that runs today's code can
  // see one. Offline, deterministic, $0, ~3s.
  notify: "notify.mjs",
  // WS-RESILIENCE. The upstream failure ladder. On 2026-08-24 three of the
  // owner's turns died on a SINGLE Google 502 with `retries:0`, `fallbacks:[]`
  // and eight healthy keys untried, because api/chat.js folded every non-quota
  // status into "every key would reject it identically" — true for 4xx, false
  // for 5xx. The same turns then came back with the SAME canned connectivity
  // pair three times in ninety minutes, because the draw was uniform with
  // nothing forbidding a repeat.
  //
  // Every other gate here asks "does the code do the right thing when
  // invoked", and none of them can invoke a 502. This one can: the upstream,
  // the clock and the randomness are all functions, so the ladder is driven
  // through 502-then-200, rotation, deterministic abort, pool-exhausted →
  // grant lane, and everything-dead. Four cases carry an explicit negative
  // control that re-runs them against the reverted classifier and asserts the
  // battery FAILS — a green suite that would also be green against the bug is
  // not a suite.
  //
  // It also lints the SOURCE for the folding coming back, which no test that
  // runs today's code can see. Offline, deterministic, $0, ~4s.
  resilience: "resilience/run.mjs",
  // The labeled key pool: an owner-tag travels with each key so RCA can name
  // WHICH account 429s, and a label can never reconstruct a secret. Hermetic.
  keyring: "keyring/run.mjs",
  // WS-COMPOSER. Sending more than one picture, with something written on it:
  // the five-cap and its partial-accept behaviour, the total-byte rail, the
  // collage a count resolves to, the `images` + `caption` wire shape and the
  // legacy body it deliberately keeps for one uncaptioned picture, the caption
  // threaded through screen and transcript and reply cycle, the proof that
  // exactly one JPEG encoder sits on the picture-send path, and the two pieces
  // of teardown state that evals/teardown.mjs's AppState walker structurally
  // cannot see (the compose tray, and photoUrls riding inside messages).
  //
  // Wired here rather than left standalone because `dead-writers` does not stop
  // applying to evals: a suite nothing invokes is indistinguishable from a suite
  // that does not exist. Its BROWSER half (evals/composer-browser.mjs) is
  // deliberately not in this map, for the by-construction reason the d0/d1 note
  // above gives: it needs a built app and a server on a port, and a gate that
  // skips looks exactly like a gate that passed.
  //
  // Offline, deterministic, $0, ~2s. Re-bundles from the real source on every
  // run, like everything else here.
  composer: "composer/run.mjs",
  // WS-ASSETWIRE. Fifty-one generated files landed at their final paths
  // referenced by NOTHING, and this suite is what stops that being true again
  // in either direction: every path the app can request resolves on disk, and
  // every file that ships is named by something.
  //
  // It is here rather than left standalone for the reason `dead-writers`
  // gives, and it is a GATE rather than a note because everything it asserts
  // is silent when it breaks. A wrong asset path renders an empty box that
  // looks like spacing. An asset path written into `Message.reaction` instead
  // of the emoji would stop reactions syncing and stop them reaching her while
  // the thread carried on looking perfect. And the reduced-motion answer for
  // an animated WebP is a BRANCH IN CODE rather than a stylesheet rule,
  // because `animation: none` does nothing to a WebP — so it is the kind of
  // thing a later edit deletes without any test noticing. That last one
  // carries its own negative control: the reduce assertions are re-run against
  // a component that ignores the query and MUST fail.
  //
  // It renders the real components through react-dom/server rather than
  // grepping them, re-bundling from source on every run. Offline,
  // deterministic, $0, ~2s. Its BROWSER half (evals/assetwire-browser.mjs) is
  // deliberately not in this map, same by-construction reason the composer
  // note above gives: it needs a built app on a port.
  assetwire: "assetwire/run.mjs",
  // WS-M. The SQL parameter-type gate for the replica/gurukul API.
  //
  // Wired here rather than left standalone for the reason that matters most in
  // this particular case: it is the ONLY gate in the repo that can see the bug
  // class it covers. Every other suite mocks the database, and a mock resolves
  // no operators, so `operator does not exist: uuid = text` is invisible to all
  // of them — the studio's first live "create replica" click was the test.
  //
  // Reads the checked-in DDL (db/schema.sql + db/migrations/*.sql) into a
  // column→type map, then reads every SQL template literal under api/ the way
  // Postgres will. Carries seven negative controls and six positive ones, plus
  // floors on the parsed table/column counts — because the failure mode of a
  // static gate is parsing nothing and passing everything.
  //
  // Offline, deterministic, $0, ~1s. No database, by design: a gate that needs
  // credentials is a gate CI skips.
  sqlcast: "sqlcast.mjs",

  // WS-R. PERSON_TABLES completeness against the checked-in DDL.
  //
  // scripts/relcheck.mjs asks the same question of the LIVE database and is
  // the better place to ask it — but it needs NEON_URL and skips without one,
  // so every credential-free CI run said nothing at all about the one list
  // whose omission is a privacy failure. A table missing from PERSON_TABLES is
  // invisible to BOTH the forget cascade and the DSAR export: a person who
  // asked to be forgotten keeps rows in it. Three such tables were live when
  // this was written.
  //
  // Offline, deterministic, $0. It cannot see a table created straight against
  // the database (relcheck is what catches that); it can see every table this
  // repo wrote a migration for, on a laptop with no secrets.
  persontables: "persontables.mjs",

  // WS-W. The studio's "Preview my voice" panel — the first surface where an
  // owner interacts with their own clone, and the first one that has to tell
  // the truth about a GPU runtime that scales to zero.
  //
  // Wired here rather than left standalone for the ordinary `dead-writers`
  // reason and one specific to this panel: two of the things it checks are
  // ABSENCES, and an absence has no other witness. A caller who does not own
  // the replica must not cause a read of the private bucket or a second of
  // GPU; the suite counts both as zeros, with a positive control proving the
  // counters can move and a negative control (the owner predicate struck out
  // of the fence) proving the refusal comes from the owner binding.
  //
  // It also holds the third outcome. Audio-or-error is the shape every future
  // refactor will want to collapse this back into, and the measured facts in
  // AZURE-DEPLOY-STATE.md §8 say that shape cannot be honest: the runtime is
  // ready at 161 s and the request that woke it dies at 242 s. And it keeps
  // `rejected.md#hmac-skew-shorter-than-cold-start` from being re-learned —
  // nothing may be signed until the unauthenticated /healthz answers 200, and
  // a wrong key must never be reported as a cold start.
  //
  // Offline, deterministic, $0, no DB and no network: the real fence, the real
  // warm-up module and the real handler on a virtual clock.
  voicepanel: "voicepanel.mjs",
  // Owner-facing Meet UI: three visible language choices bound to the two
  // real synthesis language ids, honest warm-up timing, correction, mobile
  // layout and self-test ceremony removal. Protected receipts stay required.
  voicepreviewui: "voice-preview-ui.mjs",

  // WS-X. The Mirror Call — the calibration call where a clone learns from its
  // own human.
  //
  // Wired here on the `dead-writers` test, and it earns the slot on a sharper
  // argument than most: this is the one lane in the product where a machine
  // edits the persona of a REAL, NAMED, LIVING PERSON while they are on the
  // phone with it, and every way it fails is silent.
  //
  //  - AN UNAPPROVED DELTA LANDS. The whole "never a silent self-update" law is
  //    one SQL clause. The suite strikes that clause out of the SHIPPING
  //    statement and FAILS unless the struck copy lets an already-rejected chip
  //    write the sheet — with a positive control beside it, because "nothing
  //    was written" is also true of a pipeline that never writes at all.
  //  - THE LEARNING LOOP DROPS ITS INPUT AND LOOKS FINE. A dropped window is a
  //    ROW, counted in an audio-weighted coverage ratio, and the arithmetic is
  //    checked on a deliberately dropped 20 s window.
  //  - THE VOICE LOOP LOOKS LIKE IT IS WORKING. Chatterbox truncates its
  //    reference at 10 s, so a growing pool changes nothing; the suite asserts
  //    that pool size and SELECTABLE candidates are different numbers, that an
  //    equal-scoring candidate does not replace the standing selection, and
  //    that the two fidelity meters cannot be collapsed into one.
  //  - SOMEONE ELSE'S VOICE, OR THE CLONE'S OWN, GETS INTO THE POOL. Both are
  //    negative controls: a clone-overlapping window and a foreign speaker each
  //    fail admission, with the measured owner admitted beside them so the
  //    refusals are not vacuous.
  //  - A PHONE NUMBER SAID ALOUD REACHES A PROMPT. The PII scrub is asserted at
  //    the store seam, on the stored bytes.
  //
  // It also checks the payload against the rules WS-Y's own client normalizer
  // enforces (every chip carries a citation; `applied` is never true without
  // `accepted`), so a shape the studio would throw on fails here instead of
  // failing a live call.
  //
  // Offline, deterministic, $0, no database, no network, no model call. What it
  // CANNOT see is SQL types and referential integrity — `evals/sqlcast`'s
  // strict surface covers the first and `scripts/relcheck.mjs` the second, and
  // NEITHER has run against a real database for these tables.
  //
  // Renamed at merge: WS-Y's UI suite already owns `mirrorcall` above; this is
  // WS-X's backend suite for the same feature, and the two gate different
  // halves of the same wire contract.
  mirrorcallapi: "mirrorcallapi.mjs",

  // WS-AC. The CLONE'S REPLY inside a Mirror Call — the half `mirrorcallapi`
  // above explicitly did not have, back when `turn_voice` answered 501 and
  // every window returned a null turn.
  //
  // Three things it gates that nothing else can:
  //  - the reply is assembled from the OWNER'S OWN sheet through the ONE door
  //    (`gatedReply`), with no fallback persona: a replica with no sheet
  //    produces no turn and a named reason, and the negative control drives
  //    exactly that;
  //  - the no-published-sheet case answers from the DRAFT and SAYS SO on the
  //    wire, so `plausible-return-hides-a-dead-pipeline` cannot happen quietly;
  //  - synthesis goes through WS-W's admission-broker path UNFORKED, and a
  //    deliberately forked path that skips the watermark check is kept beside
  //    it and must FAIL. That last one is the whole reason this file exists as
  //    a gate rather than as a comment: the disclosure prefix and the watermark
  //    are the two things a well-meaning refactor removes first.
  //
  // Offline, deterministic, $0, no database, no network, no model call, no
  // credential. Same blindness as its sibling: it cannot see SQL types.
  mirrorcallreply: "mirrorcallreply.mjs",
  // WS-AD. One link, one clone — the single-video enrollment lane.
  //
  // The suite exists for one assertion above all others, and it is a
  // MEASUREMENT rather than a smoke test: on a fixture lecture built to have
  // exactly the defect the owner described — a noisy, clipped, half-silent
  // opening and the clean teaching voice three minutes in — the chosen
  // conditioning window must NOT be the head of the file, and the ranking must
  // report by how much it beat the head.
  // `context/measurements.md#reference-window-beats-the-finetune` is why that
  // matters more than it looks: window choice moved fidelity 0.0625 on the
  // owner's own voice, three times the measured fine-tune delta, at zero
  // training cost. A lane that silently took the first ten seconds would pass
  // any test that merely checked a window came back.
  //
  // Alongside it: byte-identical determinism including tie-breaks, the consent
  // gate refusing before a quota slot is spent, the four caps refusing BY NAME
  // with their numbers, the not-your-video control (`channel_binding_mismatch`
  // carried through verbatim), and honest-state coverage for
  // `channel_extract_extractor_bot_check` — which per
  // `context/measurements.md#youtube-extraction-blocked-from-azure` is the
  // state this deploy is actually in, so it is the state that most needs to
  // stay legible rather than collapsing into "failed".
  //
  // Offline, deterministic, $0, no DB and no network — the four service seams
  // are injected. What it CANNOT see is SQL types and referential integrity:
  // migration 060 is UNAPPLIED and no statement in this lane has ever executed
  // against a database (`offline-mocks-cannot-type-check-sql`).
  videoenroll: "videoenroll.mjs",
  // WS-AE. The three-step wizard's state machine, run over its whole input
  // space (6 912 combinations) rather than over the one path a demo takes.
  //
  // It exists because the restructure's real risk is not a wrong layout, it is
  // a rail of confident green ticks over a runtime that is still refusing to
  // activate. `PRODUCT-JOURNEY.md` §3.2's rule is the suite's spine: no rail
  // row may render a status that is not derived from data. BREAK 8 (a literal
  // "0 / No model trained") and BREAK 11 (a hardcoded class that made a 3-step
  // checklist structurally unable to reach 3/3) were that defect twice, in two
  // files, both written by people who knew better.
  //
  // Four properties are the ones worth naming: at most ONE ember on the rail
  // (with a stated negative control, since a per-row implementation lights two
  // on the normal input); `null` means UNKNOWN and never becomes "you have
  // none"; a blocker code this build has no copy for is RENDERED rather than
  // filtered out, which is how the retired QuickStartPath could read clear
  // while Activate stayed disabled; and no step reports done while it still
  // lists something missing.
  //
  // WS-AJ added the honesty split as a fifth property, and it is the one with
  // the sharpest negative control in the file: the exact sentence the owner was
  // shown on a phone ("9 things on Meet it are still waiting on you") is
  // asserted to FAIL both detectors. It rendered while their uploaded audio sat
  // at `quarantined` behind a queue nothing drained, so every one of those nine
  // was ours. A blocker is now typed `you` or `us`, a gate that needs processed
  // material reclassifies to `us` while we are still holding that work, and no
  // `us` prose may blame the reader anywhere in the input space. Section 9
  // covers the navigation copy, where a step NAME had been standing in a
  // sentence slot ("Next: Deploy it").
  //
  // Offline, deterministic, $0, no DB, no browser, ~4s.
  studiowizard: "studiowizard.mjs",
  // WS-AF. The activity surface — the owner's ask that they be able to see
  // whether the YouTube video arrived, whether processing finished, and what
  // everything else is doing.
  //
  // It gates the properties that make that report HONEST rather than merely
  // present: one normalised shape across all seven lanes, ownership as a SQL
  // predicate with a stranger's refusal, the no-fake-progress rule with a
  // negative control (a fabricated fraction on a lane that has none must be
  // caught), a lane that is not deployed rendering as a NAMED absence rather
  // than an empty success, a lane with no runner saying so, and the poll
  // backoff and its stop rule read off both halves of the wire.
  //
  // It also holds migration 060 to the splitter's rules and to the erasure
  // reach, both layers.
  //
  // Offline, deterministic, $0, no database, no network, no model call. What it
  // CANNOT see is SQL types and referential integrity: `evals/sqlcast`'s strict
  // surface covers the first and `scripts/relcheck.mjs` the second, and
  // migration 060 has never been applied to any database.
  replicaactivity: "replicaactivity.mjs",
  // WS-R4, the review queue. The card generator's dedupe and cap, each
  // decision's writes read off the REAL SQL, the clause that stops a fix
  // landing without its correction source, the invalidation request, and the
  // never-rule predicate driven through the REAL `gateReply` with the negative
  // control the brief asks for by name: remove the predicate and the forbidden
  // reply travels, so the suite fails.
  //
  // Offline, deterministic, $0, no database, no network, no model call. What it
  // CANNOT see is SQL types and referential integrity: `evals/sqlcast`'s strict
  // surface covers the first and `scripts/relcheck.mjs` the second, and
  // migration 074 has never been applied to any database.
  reviewqueue: "review-queue/run.mjs",
  // WS-R3. The one creator screen: one number, five parts, one action, one
  // publish lock. What it exists to hold is DESIGN-LAW §1's hardest clause —
  // the overall is UNDEFINED until every part has a value — against the very
  // reasonable future request to "just average what we have", which would turn
  // this screen into `plausible-return-hides-a-dead-pipeline` with a score
  // attached. §4 of the suite removes that guard from a copy of the real
  // module and requires the assertions to fail.
  //
  // It also holds the two lock predicates (runtime activation, channel
  // connect) to their SQL shape, migration 073 to the splitter's rules, and
  // the readiness history to the erasure reach.
  //
  // Offline, deterministic, $0, no database, no network, no model call. What
  // it CANNOT see is SQL types and referential integrity: `evals/sqlcast`
  // covers the first and `scripts/relcheck.mjs` the second, and migration 073
  // has never been applied to any database.
  readiness: "readiness/run.mjs",
  // WS-R5. The interview — the Mirror Call re-pointed at the gaps in the
  // archive, and the only lane in this product where the AI decides what to
  // ASK.
  //
  // Three properties nothing else can gate:
  //  - THE RANKING, which IS the feature: five questions and twenty minutes
  //    means which five is the whole product, so the three orderings are
  //    asserted directly (a contradiction outranks everything; a sheet field
  //    with no evidence outranks one with some; a thin topic produces a gap
  //    where a covered one produces none).
  //  - NO QUOTABLE SENTENCE REACHES THE PROMPT. Every line of every ask block
  //    the model can generate is run through `src/engine/shapelint.ts`'s OWN
  //    `lintLine`, bundled from the real TypeScript on every run — including
  //    the blocks built out of the owner's own claim bodies, which is the one
  //    place their words ride into a prompt. The assertion was mutation-tested:
  //    raising all four fragment caps makes it fail, raising any one does not.
  //  - THE DETECTOR THAT COULD NOT RUN SAYS SO. §5 is the negative control and
  //    it is the file's spine: the same assertion that passes with the
  //    contradiction predicate wired MUST FAIL with it disabled, and the
  //    payload must report `detectors.contradiction === false` rather than an
  //    empty list a studio would read as "no contradictions".
  //
  // Plus: the answer write stamps a source and NO statement in the lane names
  // `vy_teacher_sheet` or `vy_mirror_conditioning`
  // (`mirror-reference-accumulation-was-inert`: answers grow the SOURCE set and
  // change no voice), the ask block splices BEFORE the appended-last set or is
  // refused outright (`prompt-position`), and the person-model register input
  // is driven both ways so a builder ignoring it fails.
  //
  // Offline, deterministic, $0, no DB, no network, no model call. What it
  // CANNOT see is SQL types and referential integrity: migration 075 is
  // unapplied and no statement in this lane has executed against a database.
  interview: "interview/run.mjs",
  // WS-R9, drift watch. "It notices drift" — the two independent signals
  // (a swap walked off `vy_replica_generation.preview_model_commitment`, a
  // score drop against the SAME `genome_version` only), the 0.02 threshold
  // held to the three measurements that justify it (6e-6 run noise, 0.0625
  // window-choice spread, 0.0206 a genuine trained delta), the recency
  // window that keeps "moved" answering "the day the score moved" rather
  // than staying tripped forever, the prosody anchor reused rather than
  // re-derived from `scripts/prosody-baseline.mjs`'s own verdict, and the
  // negative control the brief asks for by name: a report that says
  // "steady" across a swap must fail this suite.
  //
  // Also holds: the deliberate divergence from readiness's "a read that
  // writes" (drift watch gates nothing, so the owner GET never writes;
  // api/drift-watch-sweep.js is the sole writer), migration 076 to the
  // splitter's rules, and the drift history to the erasure reach.
  //
  // Offline, deterministic, $0, no database, no network, no model call. What
  // it CANNOT see is SQL types and referential integrity: `evals/sqlcast`
  // covers the first and `scripts/relcheck.mjs` the second, and migration
  // 076 has never been applied to any database.
  driftwatch: "drift-watch/run.mjs",
  // WS-R15, Phase 0's own proof: the first Room, in one command
  // (`scripts/first-room.mjs`, `scripts/first-clone.mjs`'s sibling). This
  // suite spawns the REAL script as a subprocess against a fake HTTP server
  // (node:http, a random loopback port) replaying recorded response shapes —
  // it never imports the script's internals, so a rewrite that keeps the
  // words but breaks the contract is caught the same way a human running it
  // would notice: by reading its own stdout.
  //
  //  - THE HAPPY PATH, owner and follower, every one of fourteen steps ok:
  //    replica, consent, upload, the processing DAG polled to done, the five
  //    readiness parts, the review queue filled without ever deciding a card,
  //    the Room created and published, then open/join/say/history/forget on
  //    a SECOND session.
  //  - TWO NAMED REFUSALS. Publish locked by readiness (the blocker list
  //    printed and split waiting-on-you/waiting-on-us, and the follower side
  //    proven NEVER to run even though a follower token was supplied) and the
  //    slug taken (stops at room-create; room-publish never appears as a
  //    step).
  //  - THE NEGATIVE CONTROL. A 200 with an empty body, struck mid-chain on the
  //    consent grant, must fail that step by name (`empty_response`) and must
  //    never let the upload step that follows it run — the exact rule the
  //    script's own header names as its second law.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, ~2s.
  firstroom: "first-room/run.mjs",
  // WS-R12. The number that decides the company: week-six retention of
  // followers who arrived in week one. Nothing measured this before migration
  // 077 and api/_room-cohorts.js. Five sections: THE WRITE (roomSay upserts
  // vy_room_follower_day once per accepted turn, gated on the migration
  // having landed, skipped rather than a 500 when it has not), THE FORGET
  // (roomForget's own explicit delete, gated the same way), THE MATH
  // (cohortRow/verdictFor, pure, driven with the workstream brief's own
  // numbers - a 2-week cohort, 3/10 at 7 weeks, 5/10 at 8 weeks), THE READ
  // (roomFollowerCohorts/readOwnedRoomCohorts against a fake db, structurally
  // aggregate-only), and a content-free negative control on the migration's
  // own column list that MUST catch an injected text column.
  //
  // Offline, deterministic, $0, no DB, no network, no model call.
  "room-cohorts": "room-cohorts/run.mjs",
  // WS-R16. Check-ins: follower-scheduled, task-bound, migration 079. Five
  // sections: THE MATH (computeNextDue, pure, across a DST-free IST fixture
  // and one real DST zone), THE HAPPY PATH (a paid follower's due row
  // delivered once through gatedReply, next_due_at advanced, a `delivered`
  // ledger row written), IDEMPOTENCY (the same due timestamp swept twice
  // yields one delivery, the unique constraint doing the work), and three
  // NEGATIVE CONTROLS: a free follower's due row is skipped and the ledger
  // says so; a stopped check-in is never selected (no delivery, no ledger
  // row); and a static proof that the sweep's own SQL never names another
  // follower's person_id — modelled on evals/room-leak's import-graph layer.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  checkins: "checkins/run.mjs",
  // WS-R17. Pulse v0: counts over the opt-in shared subgraph, n>=5, never
  // verbatim. Drives the real `api/_pulse.js` through a fake `db`
  // (`evals/pulse/fixtures.mjs`) and a small world generator: (a) 4
  // opted-in followers yields zero rows (room-total floor), (b) 5 yields
  // one row with 5, (c) a non-opted-in follower with matching text
  // contributes nothing, (d) revocation drops a bucket back below the
  // floor on recompute (recomputed, never patched), a NEGATIVE CONTROL
  // that calls the raw unguarded per-topic count directly and proves it
  // DOES show a leaky 4 while `computeSnapshot`'s own floor refuses to
  // emit it, a static check that the snapshot table's INSERT names only
  // its six content-free columns, and `readPulse`'s two honest empty
  // states (not enough opt-ins vs. no topic at floor).
  //
  // Offline, deterministic, $0, no DB, no network, no model call.
  pulse: "pulse/run.mjs",
  // WS-R19. The paid tier's fair-use ceilings as predicates, plus voice
  // minutes metered (migration 081). A paid follower's message spend against
  // `paid_monthly_messages` in the SAME conditional-UPDATE shape the free cap
  // already uses; `roomSpeak`'s voice cap, spent before any synthesis;
  // negative controls proving a free follower gets a named refusal and zero
  // audio bytes, that a copy with the watermark read struck is caught, and
  // that the ledger row `roomSpeak` writes matches the shape drift watch's
  // sweep reads.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "room-paid-tier": "room-paid-tier/run.mjs",
  // WS-R21. The ops board: `api/_ops.js` (per-Room aggregate counts, never a
  // follower's words, admitted to evals/room-leak's AGGREGATE_ONLY class),
  // `api/_sweep-run.js` (the heartbeat every cron in vercel.json now writes,
  // migration 084's `vy_sweep_run`) and `api/_sweep-schedule.js` (the
  // staleness math, read from vercel.json's own schedule table rather than
  // guessed). Five sections: the platform-operator allowlist (pure, no db);
  // the schedule table against every real cron in this repo; withSweepRun's
  // start/finish heartbeat and its content-free digest; opsOverview's real
  // counts and honest empty states over two Rooms (one populated, one
  // empty); and NEGATIVE CONTROLS (a) a non-allowlisted user is refused
  // before any db read, (b) an unset allowlist refuses everyone, (c) a
  // select list with a follower text column appended fails the SAME
  // aggregate-only parser evals/room-leak/run.mjs runs, (d) a sweep whose
  // function throws still writes finished_at with outcome 'failed'.
  //
  // Offline, deterministic, $0, no DB, no network, no model call.
  ops: "ops/run.mjs",
  // WS-R22. Web push for check-ins (migration 085): RFC 8291 aes128gcm
  // encryption round-tripped against an independently-written decoder (real
  // key material, not RFC 8291 Appendix A's own — see api/_push/webpush.js's
  // header for exactly why), the VAPID JWT's ES256 header/claims/signature
  // shape, subscribe/unsubscribe session scoping, the delivery ledger's
  // states (delivered/failed/not_configured), and quiet-hours math (a plain
  // window, a wraparound one, and the "no window" default). Three NEGATIVE
  // CONTROLS: (a) a static source scan of `checkinPushPayload` refuses any
  // check-in-text identifier in its own body; (b) a 410 from a fake push
  // service revokes the subscription and a second sweep sends nothing to it;
  // (c) a world check — another follower's active subscription never
  // receives this follower's check-in payload.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "room-push": "room-push/run.mjs",
  // WS-R23. Creator applications and invites, migration 086: the front door
  // that has a lock in SQL. Applications (the happy path, the daily
  // per-contact refusal proven against a fake unique index, the next-day
  // clear, the operator's list/erase-by-contact), invites (issue returns
  // the code exactly once, list's three status filters, revoke and erase's
  // refusal on an already-redeemed invite), and the replica-create
  // predicate itself: `createSelfReplica`'s own CTE, exercised through a
  // fake db, with three negative controls (a redeemed code cannot be
  // redeemed twice, an expired code refuses by name, and with
  // INVITES_REQUIRED unset the predicate is structurally absent) plus a
  // static proof that the gate lives inside the INSERT rather than a JS
  // check around it.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  invites: "invites/run.mjs",
  // WS-R20. Handoff v0 (migration 083): a follower asks for the human, and
  // nothing moves without a verbatim payload screen. Drives the real
  // api/_handoff.js through a fake `db` (evals/handoff/fixtures.mjs, wrapping
  // evals/room/fixtures.mjs's own fakeDb): draft returns the exact bytes and
  // a hash that matches them, both from a fresh note and from the follower's
  // own picked messages (never the AI's); send is refused by name when the
  // Room has handoff off, when a follower is over their monthly cap, when the
  // stored hash does not match the submitted text, and when a thread_id
  // belongs to a different follower; the owner's queue returns counts first
  // and then only the oldest hash-matched 'sent' row, one at a time; answer
  // lands once, only in the answering follower's own read, never another
  // follower's; withdraw frees the follower's own row and does not count
  // against their cap. Two NEGATIVE CONTROLS: (a) a copy of a sent row with
  // its text tampered (hash untouched) is refused by the SAME predicate on
  // both the queue read and the answer write; (b) a chat message a follower
  // never submitted through send() is proven absent from every creator-facing
  // read, evals/room-leak's own leakedTokens technique applied to this table.
  //
  // Offline, deterministic, $0, no DB, no network, no model call.
  handoff: "handoff/run.mjs",
};
const pick = process.argv[2];
let failed = 0;
const failedSuites = [];
for (const [name, file] of Object.entries(suites)) {
  if (pick && pick !== name) continue;
  console.log(`\n── ${name} ──`);
  try {
    execSync(`node ${join(HERE, file)}`, { stdio: "inherit", cwd: ROOT });
  } catch {
    failed++;
    failedSuites.push(name);
  }
}
if (failedSuites.length) console.error(`\nfailed suites: ${failedSuites.join(", ")}`);
process.exit(failed ? 1 : 0);
