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
  // WS-R58. The incident ledger (migration 109): `recordIncident`'s upsert
  // and its four negative controls (unrecognised kind, empty door,
  // out-of-range/non-integer status, a db that throws); `withDoor`'s own
  // proof that a thrown door still answers with the SAME body as before and
  // that a masked-200 door (tg.js/whatsapp.js's own posture) records
  // nothing; `claimNewKindNotification`/`notifyNewIncidentKinds`'s
  // at-most-once-per-kind-per-day guarantee end to end with an injected
  // fake subscription, plus the "kind seen in the previous 7 days is never
  // new" control; `pruneOldIncidents`'s 90-day bound; and a static scan of
  // this file's own INSERT column list with two negative-control fixtures
  // that add a message-shaped column and correctly fail it.
  //
  // Offline, deterministic, $0, no DB, no network, no model call.
  incidents: "incidents/run.mjs",
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
  // WS-R25. The creator funnel (migration 088): "minutes to first Room" and
  // "where creators stop", plus the sweep heartbeat's own retention delete
  // (closing WS-R21's own open item). Drives `api/_funnel.js` through a
  // dedicated fake db - two replicas (one published in 23 minutes, one
  // stalled at readiness, 10 days old), `markStep`'s first-write-wins and
  // ownership gate, `replicaFunnel`'s full ordered read, `funnelSummary`'s
  // pure median/p90/stall math, and `opsFunnel`'s own board read - plus
  // `api/_sweep-run.js`'s new bounded retention delete. Three NEGATIVE
  // CONTROLS: (a) a mark from another owner is refused before any write,
  // proven both by the thrown error and by the marks table being untouched;
  // (b) evals/room-leak/run.mjs's own aggregate-only parser (copied, that
  // file has no exported entry point, by design) catches a mutated select
  // list carrying a bare follower column; (c) the retention delete removes
  // an old row for the sweep that just finished while leaving an equally
  // old row belonging to a DIFFERENT sweep untouched.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  funnel: "funnel/run.mjs",

  // WS-R24, migration 087: the Room in Hindi. Every ROOM_COPY_TABLE key
  // present in both locales; the disclosure card's three facts present in
  // both languages; setLocale scoped to the caller's own session (B cannot
  // set A's locale); the Telegram language_code -> locale mapping; three
  // NEGATIVE CONTROLS: (a) a Hindi string with an em dash fails
  // scripts/check-copy.mjs's dash rule, (b) a Hindi string containing क्लोन
  // fails its rooms-vocabulary rule, (c) the AI's own reply text is
  // byte-identical whatever the follower's chrome locale is (only chrome
  // moves, never the model's own words). Offline, deterministic, $0.
  "room-locale": "room-locale/run.mjs",
  // WS-R27. Forget receipts (migration 090, `vy_room_forget_receipt`) and the
  // export completeness battery: STATIC (every PERSON_TABLES entry carrying
  // both room_id and person_id in the checked-in DDL is named by
  // `roomExportManifest()`) and DYNAMIC (one follower through the real
  // follower lane touches every surface - thread, check-in, opt-in,
  // subscription, push subscription, handoff, voice usage, the Telegram
  // pointer - `roomExport` carries a row/count from each, `roomForget` leaves
  // zero, and the receipt's counts equal what was deleted). Two NEGATIVE
  // CONTROLS: (a) a fake person-lane table added to a COPY of the manifest is
  // caught as uncovered by the static check; (b) a struck copy of
  // `roomForget` with one delete removed is caught by the same survivor scan
  // the real run passes. See evals/room-export/run.mjs's own header.
  //
  // Offline, deterministic, $0, no DB, no network, no model call.
  "room-export": "room-export/run.mjs",
  // WS-R26. Abuse limits on the public doors, migration 089
  // (`vy_public_rate`): the upsert's own boundary (under the limit admits,
  // AT the limit returns zero rows - never a read then a separate write),
  // the fixed-window rollover, Retry-After math against a clock, the key
  // being a sha256 hash rather than a raw IP/contact, `limitsFor()`'s
  // `RATE_LIMITS_JSON` operator override, and the retention sweep. THREE
  // NEGATIVE CONTROLS: (a) an unknown scope is refused before any database
  // write; (b) driven through the REAL api/_payments.js `applyWebhook`, five
  // unsigned webhook attempts write zero rows to the rate table, proving the
  // HMAC check really does run before the counter; (c) two different IPs
  // never hash to the same key or share a counter. §7 is a static proof
  // (evals/invites/run.mjs's own shape) that every named door - api/room.js's
  // open/join/say/push_subscribe, api/apply.js's submit, api/room-tg.js and
  // api/_payments.js's webhooks - really calls through this module, with the
  // Telegram/payment signature checks proven to run strictly before the
  // gate.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "rate-limit": "rate-limit/run.mjs",
  // WS-R31. The studio collapsed to Feed/Meet/Share: bundles the REAL
  // `src/studio/studioShellModel.ts` (`evals/mirrorcall.mjs`'s pattern) and
  // asserts every existing panel is reachable from `StudioShell.tsx` or
  // `StudioApp.tsx`'s "All panels" view (a static text scan against the
  // real `src/studio/` listing), the headline state for each tab under
  // empty / partial / complete fixtures, and that the primary control always
  // equals the blocker list's own next thing. THREE NEGATIVE CONTROLS: (a) a
  // panel struck from both files' text is caught as orphaned; (b) a
  // hand-built headline with two primary controls is refused; (c) a string
  // with "train"/"model" fails scripts/check-copy.mjs's own scanner.
  //
  // Offline, deterministic, $0, no DB, no network, no browser, no model call.
  "studio-shell": "studio-shell/run.mjs",
  // WS-R28. Suites v0 (migration 091, `vy_org`/`vy_org_member`/
  // `vy_org_subscription`): createOrg's atomic admin-membership CTE,
  // inviteMember's own no-write refusal and acceptMembership's self-consent
  // write, attachRoom's law-2 single-predicate UPDATE (every named refusal -
  // not_admin, no_seat at the exact boundary, creator_not_member - plus the
  // two structural ones), detachRoom's owner-or-admin self-service exit,
  // orgBoard's law-3 aggregate-only per-Suite board (imports and reuses
  // api/_ops.js's own proven `roomOverview`, never re-derives it),
  // orgSubscriptionStatus/listMyOrgs/listOrgMembers/roomSuiteStatus, and
  // seatCoversCreatorTier (law 4's exemption predicate - built and proven
  // even though nothing calls it yet, since no creator tier charge exists
  // anywhere in this codebase). THREE NEGATIVE CONTROLS: (a) a non-admin
  // attach writes nothing (the room's org_id is proven still null after);
  // (b) the same aggregate-only parser evals/room-leak/run.mjs runs would
  // catch a follower-leaking select list, copied inline exactly as
  // evals/funnel/run.mjs's own §5 does; (c) a Room attached to org A is
  // proven invisible to org B's board, and the reverse. §8 statically
  // confirms the erasure job deletes the MEMBERSHIP row by name and never
  // the Suite itself (the org survives its last admin's own erasure, by
  // migration 091's own law).
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  org: "org/run.mjs",
  // WS-R29. Check-ins over WhatsApp utility templates, migration 092
  // (`vy_room_follower_whatsapp`). Opt-in/stop/status scoped to the
  // caller's own follower row, paid-tier gated, structurally absent when
  // `ROOM_WHATSAPP_TEMPLATE_APPROVED` is unset; `buildTemplatePayload`'s
  // own source scanned for any message-table identifier;
  // `deliverers.whatsappTemplate` (api/_checkins.js) driven through every
  // real outcome (not_configured, skipped_stopped, delivered, a 4xx revoke,
  // a 429 that writes no row at all); the webhook door (api/room-wa.js +
  // api/_room-whatsapp.js) reusing api/whatsapp.js's own HMAC/GET-handshake
  // verify() rather than a second implementation, a signed status callback
  // writing nothing, a signed inbound message producing exactly one
  // deterministic app-voiced reply and persisting nothing, and an unsigned
  // request refused before either. Export/forget for this table: a count,
  // a state and a MASKED number, never the number in full. THREE NEGATIVE
  // CONTROLS named in the workstream brief, each proven to actually bite:
  // (a) a poisoned payload builder reading a message identifier IS caught
  // by the same static scan that passes the real one; (b) an unsigned
  // webhook request is refused before the handler is ever called, so it
  // sends and writes nothing; (c) a stopped opt-in is never sent to.
  //
  // Offline, deterministic, $0, no DB, no network, no Meta, no model call.
  "room-whatsapp": "room-whatsapp/run.mjs",
  // WS-R30, migration 093 (`vy_room_upgrade_offer`). The conversion moment:
  // `sessionWorked`'s three clauses (each tested to fail alone), the 14-day
  // cooldown as a write not a read-then-write, `markOfferOutcome`'s "most
  // recent OPEN offer only", `conversionReport`'s ratio and funnel,
  // `renewedUnasked`'s honest zero (no creator-subscription table exists
  // yet), `phaseGate`'s three-way composition (below/at_or_above/
  // not_enough_data) and its one sentence, a real turn through `roomSay`
  // carrying an offer, the cap-reached refusal ALSO recording an offer, and
  // the payments webhook's inline `offer_update` CTE marking 'paid' in the
  // same statement as the tier flip. THREE NEGATIVE CONTROLS: (a) a
  // sessionWorked-shaped select reading a message-body column is caught by
  // room-leak's own aggregate-only parser, copied inline; (b) a second offer
  // inside 14 days never inserts; (c) the reply bytes are byte-identical
  // whether or not an offer is attached.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "phase-gate": "phase-gate/run.mjs",
  // WS-R34, migration 096. Check-ins over Telegram: the channel that already
  // works (WS-R18's one-Room-per-chat pointer, `vy_room_follower_channel`)
  // carries the thing itself, since the pointer IS the opt-in — no new
  // person table. `/checkins on|off`, the toggle's own SQL predicate
  // (`activeTelegramChannelFor` et al.), the reply-to-thread mapping
  // (`resolveReplyThreadId`, an honest seam that resolves to the Room's
  // default thread today because `vy_room_checkin` names no thread of its
  // own), `deliverers.telegram` (not_configured/delivered/failed+revoke on
  // 403 or 400/transient-on-429-or-5xx), the Room panel's own toggle, and a
  // NEGATIVE CONTROL proving `deliverers.telegram` can reach no model call
  // and carries the SAME `said` the in-app delivery already produced —
  // never a second assembler. Two more NEGATIVE CONTROLS: (a) checkins_
  // enabled:false never sends, (b) a stopped pointer never sends.
  //
  // Offline, deterministic, $0, no DB, no network, no Telegram call, no
  // model call.
  "room-telegram-checkins": "room-telegram-checkins/run.mjs",
  // WS-R33, migration 095 (`vy_creator_subscription`, `vy_payment_event`'s
  // widened Suite lane). The Suite's own money end to end through
  // api/_payments.js's provider seam (`startOrgSubscription`,
  // `updateOrgSeats`), the coalesced seat cap `api/_org.js`'s `attachRoom`
  // now reads (an active subscription raises or lowers it, a
  // never-authenticated one does not raise it, a lapsed one drops it to
  // zero without detaching a single already-published Room), the creator
  // tier charge and `seatCoversCreatorTier`'s (WS-R28) one caller, and
  // `applyWebhook`'s widened three-lane resolution (follower/org/creator,
  // one signature-verify-then-apply door for all three). THREE NEGATIVE
  // CONTROLS: (a) an unsigned webhook writes nothing to any billing table;
  // (b) a Suite subscription in state 'created' does not raise the seat
  // cap; (c) a creator charge started while a seat covers them is refused
  // before the provider is ever reached (the only db call made is the
  // exemption's own read).
  //
  // Offline, deterministic, $0, no DB, no network, no real provider, no GPU.
  "org-billing": "org-billing/run.mjs",
  // WS-R39, migration 101 (`vy_room_follower.settings_reviewed_at`). The
  // follower's own page: `roomSettings` (one composed read: disclosure,
  // memory consent, the three check-in channels, the room's price, any OPEN
  // cap-reached offer, `settings_reviewed_at`) and `roomSettingsReviewed`
  // (the one write, session-scoped exactly as `roomSetLocale`'s is). A
  // two-follower world proves B carries none of A's own channel/offer state;
  // the cap-reached offer is recorded, surfaced, and dismissed exactly once
  // (`api/_phase-gate.js`'s real `recordOffer`/`roomDismissOffer`); a static
  // proof that `RoomApp.tsx`'s cap-reached card is gated on BOTH the refusal
  // and the offer row, never either alone; both locales carry every new key.
  // THREE NEGATIVE CONTROLS: (a) a body-supplied follower id is ignored by
  // `roomSettingsReviewed`; (b) the composed read's own SQL never selects a
  // message column, a static scan proven to bite on a poisoned copy; (c) a
  // string naming the banned word or carrying an em dash fails the copy gate.
  //
  // Offline, deterministic, $0, no DB, no network, no model call.
  "room-account": "room-account/run.mjs",
  // WS-R36, migration 098. Creator payouts as a product: the Suite share
  // folded into `runPayoutRollup`'s own arithmetic (a FLAT share of the
  // Suite's own per-seat price, `SUITE_SEAT_SHARE_BP`, never a re-derivation
  // of what the Suite's ledger actually collected), the closed payout state
  // machine (built -> pending_account | queued -> sent -> settled | failed,
  // one transition each), the `sendPayout`/`registerFundAccount` seam twins
  // (never a bank detail, only the reference the provider issued), and the
  // statement (`payoutStatementFromRows`/`payoutStatement`) - the four
  // numbers, the period, the follower subscription count, the Suite line,
  // the TDS disclosure sentence, the state, and nothing per follower.
  // THREE NEGATIVE CONTROLS: (a) a payout with no fund account never reaches
  // the provider (zero calls); (b) a statement never contains a follower
  // identifier (static scan of the builder); (c) a second `sent` transition
  // on the same payout is refused by the WHERE.
  //
  // Offline, deterministic, $0, no DB, no network, no real provider.
  payouts: "payouts/run.mjs",
  // WS-R37, migration 099 (`vy_renewal_reminder`). The due-select's window
  // and NOT EXISTS (one statement per subject kind, no `vy_room_follower`/
  // `vy_room_thread` reference anywhere in this file), the insert-then-send
  // idempotency (`recordAndSend`), the cancel op per subject kind through
  // the seam (never immediately - `cancel_at_period_end`, distinct from
  // `state`), and `renewedUnaskedCount`'s wired LEFT JOIN against the real
  // `vy_creator_subscription`. THREE NEGATIVE CONTROLS: (a) a second sweep
  // in the same day inserts nothing and sends nothing; (b) a cancelled (or
  // cancel-at-period-end) subscription is never reminded; (c) a follower's
  // reminder carries no message text of theirs (static scan).
  //
  // Offline, deterministic, $0, no DB, no network, no real provider, no GPU.
  renewals: "renewals/run.mjs",
  // WS-R38. THE DOOR BATTERY — every way into a Room, attacked offline,
  // through the REAL decision modules the thin HTTP doors call (never a
  // re-implemented check): forged/expired sessions, cross-Room sessions,
  // body-supplied ids belonging to someone else, webhook replay and
  // signature tampering, an owner bearer reaching for another owner's
  // replica/org, rate-key malformation, invite-code guessing, and the OTP
  // verify brute-force floor (re-asserting WS-R32). The door LIST is
  // enumerated by a static rule (reads a request body AND imports one of
  // the closed set of Room/owner-door decision modules, or is
  // `api/account.js` by name) and asserted complete against `api/`'s own
  // directory listing, so a new door cannot appear unattacked. Two real
  // findings were fixed building it: the 12h session TTL was enforced on
  // only three of ten-plus session-consuming ops (`assertSessionFresh` now
  // shared by every one of them), and `api/room.js`'s `thread` op created
  // rows with no check that a live, attested follower still existed for
  // the session at all (`createFollowerThread`). See evals/room-doors/
  // run.mjs's own header for the full account and what each fix closed.
  //
  // Offline, deterministic, $0, no DB, no network, no GPU, no model call.
  "room-doors": "room-doors/run.mjs",
  // WS-R46. The Room on a creator's own site — one script tag, one button.
  // `api/embed.js` is Meera's precedent; this is the Room's own version,
  // narrowed by one law that widget never carried: v0 never frames the
  // Room, so a follower who clicks through always lands ON the Room, in a
  // new tab, never inside a creator's page.
  //
  // The script is executed for real, with `new Function` against a
  // hand-rolled DOM fake (no jsdom): a published Room renders the button,
  // the SERVER's own disclosure text and the "?via=embed" link; a missing
  // `data-room`, an unpublished Room and an unknown slug all remove the
  // script's own tag rather than leaving a dead button behind, and the
  // last two answer through the REAL `resolveRoom` with the IDENTICAL
  // `{room:null}` shape — a page must never learn whether a slug exists.
  // Three negative controls prove the checks bite rather than being
  // vacuous: a second fetch target, a follower-table reference, and an em
  // dash caught by the real `scripts/check-copy.mjs` scanner.
  //
  // Offline, deterministic, $0, no DB, no network, no model call.
  "room-embed": "room-embed/run.mjs",
  // WS-R47, migration 106: creators invite creators. Extends WS-R23's own
  // front door (evals/invites/run.mjs) with a fresh, narrowly-scoped fake db
  // rather than editing that file's own: `issueCreatorInvite`'s quota INSERT
  // (three codes issue, a fourth is zero rows, an unpublished or draft-Room
  // creator is refused the same way), `myInvites` (owner-scoped, states
  // only, no code text, quota computed off the same rows it returns),
  // redemption proven unchanged (a creator-issued code redeems through
  // `createSelfReplica`'s own CTE, which never references `issued_kind`),
  // and the funnel's one aggregate line (the n>=5 floor never discloses a
  // smaller true number, "application OR replica" both count, an operator-
  // issued redemption never does, and a redemption from before this week
  // does not). Three NEGATIVE CONTROLS: (a) a body-supplied
  // `issued_by_user_id` is ignored — a static scan proves both owner ops
  // pass only the verified bearer's own id; (b) the stored row never
  // carries the plain code — a static scan of the INSERT's own column list
  // plus a fixture read; (c) an em dash or the word "clone" in a
  // Share-tab-shaped fixture fails `scripts/check-copy.mjs`'s real scanner
  // under `src/studio/`'s own SCOPES options.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "creator-invites": "creator-invites/run.mjs",
  // WS-R45. The creator directory (`api/_creators.js`), the crawler feed
  // (`api/_sitemap.js`) and the `list`/`unlist`/`set_bio` ops added to
  // `api/_room-publish.js`, all driven through a fake `db`. Proves the
  // directory's own predicate (listed AND published, never one without the
  // other) holds for both readers; that the directory read never names a
  // follower table or runs an aggregate over one (a static scan of its own
  // source, so the guarantee cannot silently drift the way a comment could);
  // that a non-owner's `list` is refused by the owner-scoped WHERE; and that
  // a bio carrying an em dash or a Rooms-vocabulary word is refused by the
  // REAL `scripts/check-copy.mjs` scanner rather than a second, hand-rolled
  // regex. The directory's JSON-LD builder is pulled out of
  // `site/creators.html`'s own real source text and executed, never
  // reimplemented. Offline, deterministic, $0, no DB, no network, no model call.
  "creator-directory": "creator-directory/run.mjs",
  // WS-R48. SUITES SELL THEMSELVES — site/suites.html (the B2B front door,
  // both locales), the self-serve "Start a Suite" flow (a name and a seat
  // count survive a sign-in redirect through startSuiteDraft.ts's own
  // localStorage pattern, `studioAuth.ts`'s `restoreStudioMode()` restated,
  // and land in the EXISTING SuiteCard.tsx/orgApi.ts, never a new write
  // path), the apply form's `intent:"suite"` (migration 107), and two ops
  // board lines (`suitesFunnelThisWeek`). THREE NEGATIVE CONTROLS: (a) every
  // currency-adjacent digit run on the page is one of api/_org.js's own two
  // real per-seat prices, a static scan; (b) a seat count outside
  // vy_org/vy_org_subscription's own CHECK (extracted from db/schema.sql) is
  // refused by a fake db enforcing that CHECK standalone, not only by the
  // JS bound that also happens to refuse it; (c) a poisoned copy fixture
  // fails scripts/check-copy.mjs's real scanner in this file's own shape,
  // and the real page scans clean under it.
  //
  // Offline, deterministic, $0, no DB, no network, no real provider, no GPU.
  "suites-self-serve": "suites-self-serve/run.mjs",
  // WS-R42, migration 104. "The money reconciles": `reconcile` (a pure
  // function over rows - follower-lane ledger sum vs. payout gross minus
  // suite share; the Suite lane recomputes `runPayoutRollup`'s OWN flat
  // per-seat formula from `suiteRows` rather than comparing against an
  // org-lane ledger sum, which is not the invariant that actually holds -
  // see api/_payments.js's own header on `reconcile` for why; the creator
  // lane is reported, never compared), the creator-tier charge ledger
  // (`vy_creator_charge_event`, written inside `applyWebhook`'s creator lane
  // in the SAME statement as the state flip, idempotent on `(provider,
  // provider_charge_ref)`, only for a landed charge kind with a positive
  // amount), and `scripts/check-mirrors.mjs` (every `// mirror of
  // api/<file>.js#<NAME>` marker parsed on both sides). FOUR NEGATIVE
  // CONTROLS: (a) one ledger row removed produces exactly one finding
  // naming the Room and the difference in paise; (b) a payout's
  // `suite_share_inr` for a Room not attached at period end is a finding;
  // (c) the creator-tier charge for a seat-covered creator writes zero
  // ledger rows, proven structurally (zero `vy_creator_subscription` rows,
  // and the ledger's own FK makes a charge row impossible without one);
  // (d) `check-mirrors` fails on a fixture pair that differs by exactly one.
  //
  // Offline, deterministic, $0, no DB, no network, no real provider.
  "payments-reconcile": "payments-reconcile/run.mjs",
  // WS-R40, migration 102. Share and arrival: the crawler-only unfurl at
  // /r/<slug> (`api/_room-page.js` over `api/_room-publish.js`'s new
  // `publicRoomBySlug`), the Room header's share control (a static scan of
  // `RoomApp.tsx`'s own url builder), the arrival upsert
  // (`recordRoomArrival`/`resolveArrivalVia`, `api/_room-surface.js`), and
  // the creator funnel's own n>=5 floored growth line
  // (`shareArrivalsThisWeek`, `api/_funnel.js`). Also proves `vercel.json`'s
  // bot rewrite sits ABOVE the existing static one and its `has` regex
  // matches every named unfurl bot and not an ordinary phone browser. FOUR
  // NEGATIVE CONTROLS: (a) the share url builder names no follower id,
  // session, or token, static; (b) a `via` shaped like SQL becomes 'direct'
  // before it ever reaches SQL; (c) the funnel line below the floor is the
  // fixed sentence, never a number; (d) a Hindi string with an em dash fails
  // the real `scripts/check-copy.mjs` scanner.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "room-share": "room-share/run.mjs",
  // WS-R55. The Room's pictures: `renderRoomCard`/`computeCardLayout`
  // (`api/_room-card.js`) drawn with `@napi-rs/canvas` (not the
  // `@resvg/resvg-js` the brief named — see that file's own header for the
  // measured Devanagari shaping corruption that ruled it out) and the
  // bundled `@expo-google-fonts/noto-sans-devanagari` face. Proves: the SVG
  // for `en` and `hi`, both kinds (og/story), sized exactly to
  // `ROOM_CARD_SIZES`; the identical-bytes rule (a paused Room and an
  // unknown slug rasterise to hash-identical PNGs); every rendered line —
  // name, bio, disclosure sentence, brand mark — scans clean under the REAL
  // `scripts/check-copy.mjs` scanner; the ETag is stable, distinct per kind
  // and per Room, and identical for every unpublished-or-unknown slug. TWO
  // NEGATIVE CONTROLS: (a) a poisoned fixture carrying `row.follower_count`
  // is caught by a static scan of this file's own `row.<field>` property
  // access, which the REAL `api/_room-card.js`/`api/room-card.js` pass
  // clean (only `display_name`/`one_line_bio`/`default_locale`); (b) a bio
  // containing the banned word "clone" is caught by the real scanner when
  // run through this file's own rendered text.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "room-card": "room-card/run.mjs",
  // WS-R52, migration 112. The studio in Hindi: src/studio/copy.ts is a
  // locale table with the SAME shape as src/room/copy.ts, reusing
  // evals/room-locale/run.mjs's own proof shape rather than a second
  // mechanism -- KEY PARITY (STUDIO_COPY_TABLE.en and .hi carry the exact
  // same keys, asserted against the real export), a STATIC SCAN over every
  // src/studio/*.tsx file for a JSX text node of three or more words that is
  // not read from `t.` (an allowlist, justified entry by entry, for
  // server-authored prose and the honesty-gated blockerClass.ts/
  // QuickStartPath.tsx vocabulary copy.ts's own header names), the owner
  // preference op's ownership predicate (`setOwnedReplicaLocale`, migration
  // 112 -- an account can set only its own replica's locale, never another
  // owner's), and scripts/check-copy.mjs's Devanagari bans reconfirmed live
  // on src/studio/. THREE NEGATIVE CONTROLS: (a) a Hindi string with an em
  // dash fails the dash rule; (b) a Hindi string containing क्लोन/मॉडल
  // fails the rooms-vocabulary rule; (c) an owner attempting to set a
  // SECOND account's replica locale writes nothing and the second account's
  // row is unchanged.
  //
  // Offline, deterministic, $0, no network, no model call, no GPU. Runs
  // against a fake db (no NEON_URL needed).
  "studio-locale": "studio-locale/run.mjs",
  // WS-R59: the installable Room. The per-Room manifest builder
  // (`api/_room-manifest.js` over `api/_room-publish.js`'s `publicRoomBySlug`)
  // for English and Hindi, proven byte-identical (SHA-256) to
  // `public/room.webmanifest` for the unpublished/paused/unknown case; the
  // REAL `public/room-sw.js` source statically scanned for the one law that
  // must never break (no `/api/` response is ever reachable by a cache
  // write), with a NEGATIVE CONTROL worker that does cache one; the
  // second-visit/30-day-dismiss rule (`src/room/installPrompt.ts`, bundled
  // from source with esbuild) driven with a fake storage, THROWING storage
  // included; and the manifest builder's own copy against the real
  // `scripts/check-copy.mjs` scanner, with a NEGATIVE CONTROL manifest
  // string carrying a banned word.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU, no
  // browser.
  "room-install": "room-install/run.mjs",
  // WS-R53, migration 110. The taste: three questions a stranger may ask a
  // creator's AI before the sign-in wall, from creator material alone,
  // remembering nothing. `roomTaste` (`api/_room-taste.js`) over the REAL
  // `resolveRoom`/`gatedReply`/engine compile — three accepted turns then a
  // named 429 from `api/_rate-limit.js`'s own `room_taste` scope, the
  // disclosure carried on turn one only, the per-Room `taste_enabled` switch
  // (migration 110), and a byte-diff proving the compiled prompt differs
  // from a remembering follower's ONLY in the absence of follower memory —
  // never in the agent material both lanes compile from. FOUR NEGATIVE
  // CONTROLS: (a) a taste turn built to call a real follower-lane writer
  // (`joinRoom`) fails the reach proof `evals/room-leak/run.mjs` runs, so
  // this suite re-derives the identical proof rather than trusting a
  // sibling file's result silently; (b) a fourth answer past the 3/day limit
  // is refused before the model is ever reached; (c) a compiled prompt
  // seeded with a fake follower memory string is caught by the byte-diff;
  // (d) a Hindi disclosure string with an em dash fails the real
  // `scripts/check-copy.mjs` scanner.
  //
  // Offline, deterministic, $0, no DB, no network, no GPU.
  "room-taste": "room-taste/run.mjs",
  // WS-R64. THE LIVE PROBE'S OWN OFFLINE PROOF. `scripts/probe-live.mjs`
  // (NOT itself a gate -- it is a documented post-deploy step, see
  // docs/gurukul/DEPLOY.md and AGENTS.md's deploy paragraph, run against a
  // real base URL, which a gate must never touch) checks a REAL deployment
  // for what the tree promised: vercel.json's headers[] per route class,
  // the Room's crawler unfurl and its og.png/story.png/manifest, the
  // installable manifest, /room-sw.js, /room-embed.js, the directory/
  // suites/sitemap/robots/privacy/delete-account pages, POST /api/room's
  // two safe refusals (unknown op, no session), GET /api/room-embed for an
  // unknown slug, and all twelve cron sweeps refusing an unauthenticated
  // caller -- every expectation parsed from THIS repo's own source
  // (`scripts/probeLiveExpectations.mjs`), never a second literal.
  //
  // This suite proves the PROBE's own logic against `evals/probe-live/
  // fakeServer.mjs` on 127.0.0.1:8940 (above 8935, so it never collides
  // with the layout/performance/accessibility/headers gates' own ports): a
  // well-behaved fixture yields zero findings; two NEGATIVE CONTROLS (a
  // dropped header, a corrupted manifest byte) each produce exactly the
  // finding that defect should; and a MUTATED copy of the real script,
  // fed a third, disallowed POST op, is proven to refuse to run before
  // ever touching the network -- the static self-scan the live script's
  // own header promises, exercised rather than merely asserted.
  //
  // Offline, deterministic, $0, no DB, no real network (127.0.0.1 only),
  // no model call, no GPU, no browser.
  "probe-live": "probe-live/run.mjs",
  // WS-R65: the creator's first five minutes, the Feed tab's own path card
  // (`src/studio/CreatorPath.tsx`). The step order equals
  // `api/_funnel.js#FUNNEL_STEPS` byte for byte (both derived from the SAME
  // mirrored string, `CREATOR_PATH_STEPS_ORDER`/`FUNNEL_STEPS_ORDER`); the
  // Readiness floors (70/55) mirror `api/_readiness.js` exactly;
  // `computeCreatorPath` is fuzzed as a pure function over 2000+ input
  // combinations (deterministic, a DONE prefix then at most one CURRENT
  // then an AHEAD suffix, and the disappearance rule -- hidden once
  // `room_published`, back only if paused -- holding across the whole
  // space); TWO NEGATIVE CONTROLS run the REAL `scripts/check-mirrors.mjs`
  // against a REORDERED step string and a wrong Readiness floor, proving
  // the mirror gate the brief asks for actually bites a drift.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU, no
  // browser.
  "studio-path": "studio-path/run.mjs",
  // WS-R67: FLAG THIS REPLY (migration 116). The boundary law driven through
  // the REAL decision module (`api/_room-surface.js::flagReply`/
  // `unflagReply`/`followerFlags`, `api/_review-queue.js::readFlaggedReplies`/
  // `neverRuleFromFlaggedReply`), never a re-implemented check: the read-back
  // that proves a flag's reply text came from this follower's OWN history
  // (never the request body), the unique-index refusal for a second flag of
  // the same reply, the creator's count grouped per reply hash (ten followers,
  // one card, n=10), the two-lane erasure, and a NEGATIVE CONTROL that a
  // body-supplied reply text never reaches the creator's lane.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "room-flags": "room-flags/run.mjs",
  // WS-R66: the creator's public page (`/c/<slug>`, migration 115). Drives
  // the REAL `api/_creator-page.js` (the listed-AND-published-AND-unpaused
  // read, the pure HTML builder, the pure Person+FAQPage JSON-LD builder)
  // and the REAL `api/_room-publish.js` (`setRoomShowcase`/
  // `removeRoomShowcase`/`readRoomShowcase`) through a small hand-rolled
  // fake db. THREE NEGATIVE CONTROLS, named in this workstream's own brief:
  // (a) a review card whose `kind` is 'follower_declined' is refused as a
  // showcase source, even when its `state` is 'sounds_right' - the WHERE
  // clause `kind <> 'follower_declined'` is the column that tells a real
  // follower's own words apart from creator material; (b) a sixth slot
  // (`position = 6`) is refused before any SQL runs, and overwriting an
  // occupied slot never yields six active rows (a fake-db 23505 proves the
  // retiring UPDATE is not merely convention); (c) an unlisted Room's page
  // is byte-identical to an unknown slug's. Also proves the em-dash/Rooms-
  // vocabulary copy gate on showcase text via the REAL `scripts/
  // check-copy.mjs` scanner, that `/sitemap.xml` carries `/c/<slug>` beside
  // `/r/<slug>`, that `vercel.json` rewrites and headers `/c/:slug`, and a
  // STATIC scan proving the showcase writer is reachable ONLY from the
  // owner-authenticated `api/room-publish.js`, never any follower-facing
  // file.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "creator-page": "creator-page/run.mjs",
  // WS-R70. The creator's export (api/_creator-export.js, over api/replica.js's
  // `export` op) — the DSAR pair api/_replica-full-erasure.js's own erasure
  // is the other half of. STATIC: OWNER_LANE_TABLES is compared against
  // api/_replica-full-erasure.js's own source text (every table it reaches
  // by name, minus PERSON_TABLES and four named, deliberate gaps) so a
  // table added to either file and not the other fails the gate. DYNAMIC:
  // two owners, one of them a published Room with a real follower in it,
  // through the real `creatorExport` — Owner A's export carries Owner A's
  // own rows in every one of the seven scopes this file's manifest uses,
  // zero of Owner B's, and zero follower-lane rows at all, even though a
  // follower's own thread, membership, subscription, conversation and
  // handoff ask all live in the SAME room/replica the export is scoped to.
  // FOUR NEGATIVE CONTROLS: (a) a follower-lane table added to a COPY of
  // the manifest's table list is caught by the boundary scan; (b) a table
  // dropped from a COPY of the manifest is caught by the completeness
  // comparison; an owner with no replica yet gets an honest empty export,
  // never a crash; the HTTP door's own wiring (the op, the rate scope, the
  // authenticated-user-only id) is asserted against the real source.
  //
  // Offline, deterministic, $0, no DB, no network, no model call.
  "creator-export": "creator-export/run.mjs",
  // WS-R74 (migration 118). The creator's weekly push (api/_creator-push.js,
  // over api/replica.js's `push_subscribe`/`push_revoke` ops and the
  // Monday-morning cron, api/creator-push-sweep.js) — WS-R62's operator
  // push mechanism restated for a creator's own Room. CONFIG (unset VAPID
  // reports honestly unconfigured, never a fake key). SUBSCRIBE/REVOKE
  // through the real functions with a fake db, including a class-e NEGATIVE
  // CONTROL (another owner's endpoint is untouched by a stranger's revoke
  // call). PAYLOAD BUILDER: pure, parameter-list-bounded, a static scan
  // proves it names none of this repo's follower-facing content columns.
  // SWEEP: one push per published Room, sourced from a real Pulse world
  // (readPulse's own `combo_buckets`, never a second query this file
  // writes itself), with the ledger's own unique (room_id, week_start)
  // index proven as the ONLY idempotency mechanism — a second sweep tick
  // the same week sends zero further pushes, and an UNPUBLISHED or PAUSED
  // Room is never selected at all. THREE NEGATIVE CONTROLS: (a) the payload
  // builder's own static scan, (b) the ledger's WHERE refusing a same-week
  // resend, (c) a 404/410 from the push service revoking that one
  // subscription and never touching another.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "creator-push": "creator-push/run.mjs",
  // WS-R76 (migration 120). The self-check cron: env presence by NAME only
  // (mirrors scripts/write-config.mjs's own required/optional lists, kept
  // in sync by a static parse of that file's own source, never an import —
  // that file WRITES api/_config.js and calls process.exit at module
  // scope), `select 1` through the real api/_db.js failure shape
  // (`neon_url_missing` named exactly), a small explicit list of
  // information_schema reads proving every migration family the tree ships
  // is present in the live catalog, and every OTHER cron's own staleness
  // against vercel.json's schedule (self-check's own row excluded).
  // NEGATIVE CONTROLS: a fixture that reports an env value's length or a
  // prefix of one fails a static leak scan of the real source; a database
  // outage skips (c)/(d) rather than cascading false "table missing"
  // findings; a missing migration table or column is reported by its own
  // name; a healthy result records zero incidents.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "self-check": "self-check/run.mjs",
  // WS-R79. Language tagging for screen readers — the detection primitive
  // every `Localized` component and every server-side `langSpan` call
  // defers to (`src/room/copy.ts#detectRoomTextLang`, `src/studio/
  // copy.ts#detectStudioTextLang`), proven against every real translated
  // leaf string in both copy tables plus the named edge cases (digits, a
  // bare loanword, a matra-only fragment, mixed script), and `api/
  // _creator-page.js`'s `buildCreatorPageHtml`, proven against a
  // deliberately mismatched Room (Hindi name/bio/showcase, page requested
  // in English) by parsing the real, shipping HTML output rather than
  // trusting it by construction. The browser-based proof — a real rendered
  // DOM, `scripts/check-accessibility.mjs`'s own `langTagAudit`, its
  // always-on self-test, and this workstream's fired-and-reverted negative
  // control — lives in that gate, not here; this suite is the offline half
  // under it.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "lang-tag": "lang-tag/run.mjs",
  // WS-R78. The QR encoder (`api/_qr.js`, pure JS, byte mode, EC level M,
  // versions 1-10, no third-party runtime for the encoder itself — see
  // that file's own header on why `qrcode` (npm) was measured and rejected
  // in favour of writing it). GF(256) hygiene; Reed-Solomon divisibility
  // (an independent polynomial-division routine, not `_qr.js`'s own,
  // proving a valid codeword block IS divisible by its generator and a
  // corrupted one is not); known-vector BCH format info (EC level M, all
  // 8 masks) and BCH version info (versions 7-10) against the standard
  // published tables; structural sanity across a version spread including
  // one forced into 7-10; a self-consistency round trip on the
  // format/version-info modules; and — the layer that actually matters —
  // `jsqr` (npm, zero dependencies, a devDependency, never imported by
  // `api/`) decoding REAL rasterised pixels back to the exact input text
  // across versions 1/4/7/8 and four different masks. This suite's own
  // header names the two real bugs (a byte-reversed Reed-Solomon generator
  // polynomial, an MSB-first format-info write where the spec wants
  // LSB-first) that every earlier, purely self-referential layer passed
  // twice over while a real scanner could not read a single poster; see
  // `context/rejected.md#ws-r78-reversed-rs-generator-polynomial-passed-every-self-check`.
  // FOUR NEGATIVE CONTROLS: flipping one byte of a valid RS codeword block
  // breaks divisibility; flipping one format-info module changes the
  // recovered mask pattern; erasing a finder pattern's own pixels in the
  // rendered PNG breaks the real scanner's read; `chooseVersion` throws
  // one byte past every version 1-10's own capacity.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "qr": "qr/run.mjs",
  // WS-R75 (migration 119). Dormancy: a follower who has not visited for a
  // year is told, then forgotten with a receipt, on a schedule the follower
  // can see, behind a flag that is off. Drives the REAL `dormancyNoticeDue`/
  // `dormancyForgetDue`/`dormancySweep` (api/_dormancy.js) and the REAL
  // `roomForgetForFollower` (api/_room-surface.js) over a fake db: a
  // follower past the notice threshold gets a notice and only a notice; a
  // follower past the forget threshold with no visit since is forgotten
  // through the SAME delete sequence a follower's own "forget me" op uses;
  // `ROOM_DORMANCY` unset runs neither statement. TWO NEGATIVE CONTROLS: (a)
  // a forget attempted with no prior notice is refused by the predicate
  // itself (never reaches roomForgetForFollower); (b) a follower who visited
  // AFTER their notice is never forgotten, even though the notice column was
  // never cleared - the predicate's own timestamp comparison, not a cleared
  // column, is what protects them.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "room-dormancy": "room-dormancy/run.mjs",
  // WS-R88 (migration 125). The operator's morning digest:
  // `api/_operator-digest.js`'s `digestCounts` (the n>=5 follower floor,
  // reading only already-aggregated fields off `opsOverview`'s own shape,
  // never a Room's slug), `operatorDigestPayload` (the WS-R22 "parameter
  // list is the enforcement" shape, a static scan proving its own source
  // names no follower/Room-content column, the body under 200 characters),
  // `sendOperatorDigest`'s ledger claim (the unique `day` index is the
  // idempotency, a second sweep tick the same day sends nothing more),
  // `sendTestOperatorDigest` (sends to the caller's own subscription only,
  // writes no ledger row, refuses a bearer not on OPS_OWNER_USER_IDS even
  // called directly), and `lastOperatorDigest`'s own board read. THREE
  // NEGATIVE CONTROLS: a body carrying a Room's slug or display name is
  // impossible by construction (static scan); a follower count under 5
  // never appears as an exact number in the body; a bearer not on the
  // operator allowlist calling `sendTestOperatorDigest` directly pushes to
  // nobody.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "operator-digest": "operator-digest/run.mjs",
  // WS-R87. Handoff v1 on the relational kernel: api/_relational-core.js,
  // a dependency-free port of the sibling repo's disclosure-act evaluator
  // (/home/user/Vyakti-GroupAI, packages/relational-core/src/privacy.ts).
  // Test vectors ported by hand from that repo's privacy.test.ts and
  // privacy-matrix.test.ts (commit 9cdc1dc), cited line by line: the closed
  // act list, deny-always-wins, a grant bound to an exact policy_version,
  // expiry as an exclusive boundary, and an independent-oracle cross-check
  // (exhaustive here rather than fast-check's random sample, since this
  // module has no such dependency). Two NEGATIVE CONTROLS the workstream's
  // own brief names directly: a grant whose scope is another Room is
  // refused; a deny beats a grant.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU,
  // no import of the sibling repo (read on disk only, never required).
  "relational-core": "relational-core/run.mjs",
  // WS-R85 (migration 122). The share kit: one tap gives a creator the exact
  // text and picture for WhatsApp, an Instagram bio, a YouTube description
  // and a Telegram channel post, each carrying its own `?via=` (`api/_share-
  // kit.js`'s pure `buildShareKit`, no db). Proves: all four channels, both
  // locales, each under its own platform's real limit, url shaped
  // `<origin>/r/<slug>?via=<channel>` with every channel a member of
  // `api/_room-surface.js`'s `ROOM_ARRIVAL_VIA` (migration 122's own CHECK);
  // the brief's own picture mapping (story for WhatsApp/Telegram, og for
  // YouTube, none for Instagram); a Room that has never published gets no
  // kit at all — nothing honest to share yet; a static scan proves no
  // follower/session/person/thread identifier is reachable from this file's
  // own code; and copy parity — `SHARE_KIT_COPY` is byte-identical, both
  // locales, to the REAL `src/studio/copy.ts`/`hiCopy.ts` `shareKit` section
  // (`evals/studio-locale/run.mjs`'s own esbuild-bundle technique). THREE
  // NEGATIVE CONTROLS: (a) a text over its own channel's limit THROWS rather
  // than truncating; (b) a follower-identifier fixture is caught by the same
  // static scan the real file passes; (c) a drifted copy of one template is
  // caught by the same parity comparator.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "share-kit": "share-kit/run.mjs",
  // WS-R86 (migration 123). Follower referrals: "Bring a friend" mints a
  // hash-bearing link (`referralHashFor`, `api/_room-surface.js`); the join
  // op credits the referrer exactly once, on the joiner's genuinely FIRST
  // join (the xmax-based new-row detection), never a repeat toggle; a
  // self-referral (the joiner's own recomputed hash equals the `ref` they
  // carried) is refused structurally in the WRITE's own WHERE clause, not
  // a JS `if`. Drives the REAL `roomReferralLink`/`joinRoom`/`roomExport`
  // (api/_room-surface.js), `friendsBroughtThisWeek`/`friendArrivalsThisWeek`
  // (api/_funnel.js) over a fake db. THREE NEGATIVE CONTROLS: (a) a joiner
  // presenting their own hash as `ref` writes zero referral rows; (b) a
  // repeat join (the memory toggle) with the SAME `ref` still present in
  // the caller mints no second row; (c) a malformed `ref` (wrong length,
  // uppercase, SQL-shaped) never reaches the insert at all.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "room-referrals": "room-referrals/run.mjs",
  // WS-R83. `docs/legal/HINDI-CONSENT-REVIEW.md` proposes Hindi for the six
  // consent-ceremony studio files WS-R61/WS-R71 held back from Hindi
  // conversion for legal review (context/decisions.md
  // #ws-r61-modelconsentgate-left-untouched-consent-ceremony-legal-text and
  // #ws-r71-consent-ceremony-files-found-and-not-converted). This suite
  // re-extracts every consent statement, checkbox label, ceremony heading,
  // legend, primary action and boundary/refusal line from the REAL six
  // files and asserts each lands in the document's English column (a future
  // edit to a ceremony fails this suite until the document is updated), runs
  // the REAL `scanSource` from scripts/check-copy.mjs over every proposed
  // Hindi row (zero offences; a hand-built क्लोन row is the negative
  // control), and cross-checks the document's cited statement_set/
  // policy_version ids against the real exported constants that write them.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "consent-review": "consent-review/run.mjs",
  // WS-R99. ADVERSARIAL FOLLOWER INPUTS THROUGH THE ONE DOOR. The leak
  // battery (WS-R8, R68) proves retrieval never crosses scopes for ORDINARY
  // turns; nobody had ever sent it a hostile one. `evals/room-adversarial/
  // corpus.mjs` carries 64 hostile inputs (English and Hindi: prompt
  // injection, requests for another follower's or the creator's private
  // material by name and by position, role-play as the creator or an
  // operator, requests to reveal the system prompt, homoglyph/zero-width
  // unicode variants, and the two structural edges — oversized, empty),
  // driven through the REAL follower lane (`api/_room-surface.js::roomSay`)
  // and the REAL taste lane (`api/_room-taste.js::roomTaste`) in the full
  // world (`evals/room-leak/world.mjs`'s own five Rooms, hundred followers),
  // with the model seam replaced by a fake that returns its ENTIRE compiled
  // prompt as the reply.
  //
  // The assertion is STRUCTURAL: the captured compiled prompt (what the fake
  // model actually received and echoed) contains the speaking follower's own
  // tokens only, never another follower's, never an operator string; a
  // direct `engine.compile()` comparison proves the compiled prompt is
  // byte-identical between a hostile turn and a same-length benign one
  // except the substituted turn text; the never-rule matcher itself
  // (`api/_never-rules.js`, `api/_surface.js::gateReply`) is proven directly
  // to suppress a hostile-elicited forbidden phrase in the SAME shape a
  // benign one gets — alongside a NAMED, HONEST GAP found while building
  // this: neither `roomSay` nor `roomTaste` currently passes `neverRules`
  // into `gatedReply` at all, so a creator's "Never say this" rule has ZERO
  // EFFECT on `/r/<slug>` today, only on the widget and Mirror Call.
  //
  // TWO NEGATIVE CONTROLS, both proven to actually catch what they claim to:
  // a struck recall (ignores person/agent scoping) DOES leak, caught by the
  // same token scan; a non-echoing fake model's reply trivially scans clean
  // (the vacuous-pass risk the workstream brief names by name), caught
  // instead by a separate echo-completeness self-test that the broken fake
  // fails and the real one passes.
  //
  // Registered as its OWN gate line rather than folded into `room-leak`'s
  // own report (see `evals/room-adversarial/run.mjs`'s header for why): the
  // Build section named two new files, not an edit to an already 2,100+
  // line, heavily concurrently-edited shared file, and this suite's own
  // method (a corpus, a fake-model echo harness, a direct compile() diff)
  // is a different shape of proof than that file's token-scan layers.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "room-adversarial": "room-adversarial/run.mjs",
  // WS-R94. THE FOLLOWER'S JOURNEY, REHEARSED END TO END: a real Chromium
  // drives the REAL built Room (`dist/room.html`, the real `/c/<slug>`
  // handler) through the REAL `api/room.js`/`api/creator-page.js` HTTP doors
  // — `evals/rehearsal/harness.mjs` mounts them, unmodified, over a fixture
  // database (`evals/room-doors/fixtures.mjs`, extended) via a Node
  // module-resolution hook (`evals/rehearsal/loader.mjs`, `evals/agent-room/
  // loader.mjs`'s own precedent) that redirects exactly `./_db.js`,
  // `./_surface.js` (the model call only) and `./_auth.js` (Supabase auth
  // only) — nothing else is faked. Every OTHER suite in this registry that
  // drives `roomSay`/`roomTaste`/`joinRoom` calls them directly with its own
  // `deps.loadAgent`/`deps.engine`/`deps.reply` overrides; this is the one
  // caller that goes through the unmodified door with zero deps, which is
  // exactly why it found what it found (see `context/rejected.md`'s
  // WS-R94 entries and `context/decisions.md#ws-r94-harness-over-fixture-db-
  // not-a-second-fake-server`).
  //
  // Open a stranger's taste on `/c/<slug>` (the static island) to its own
  // ceiling; join `/r/<slug>?via=search` with the age attestation and
  // memory consent; say three things; read a citation; open a thread; the
  // account page (a real language switch, the disclosure, "Bring a
  // friend"); a SECOND browser context opens the referral link and joins;
  // export; forget. Three negative controls: a fourth taste turn refused
  // server-side after the UI itself hides the input; exporting one
  // follower's session with another follower's bearer refused (403); the
  // forget-completeness check itself proven non-vacuous against a
  // deliberately mutated state. Runs the ENGLISH walk here (gate budget,
  // `measurements.md#ws-r94-rehearsal-wall-clock-2026-09-05` — under 30s
  // including a real `vite build`); `node evals/rehearsal/follower.mjs
  // --full` additionally runs the SAME 22 checks in Hindi (a real language
  // switch from the taste screen's own header, not a fixture-only `?lang=`
  // flag — `/r/<slug>` has no such flag). Gracefully skips (exit 0) if
  // `playwright` is not installed, `scripts/check-accessibility.mjs`'s own
  // posture. $0, no network beyond 127.0.0.1.
  "rehearsal-follower": "rehearsal/follower.mjs",
  // WS-R100 (migration 126). The follower's receipt: a number, the date,
  // the Room, the amount split into its GST lines, the platform's legal
  // name and GSTIN (or a named placeholder), in the follower's own
  // language, built from the ledger and never from the provider's page.
  // Proves the pure math (financial-year boundary, the VY/<FY>/<n> shape
  // and Rule 46(b)'s sixteen-character cap enforced as a throw, gstSplit's
  // own arithmetic identities), the counter's atomic claim under
  // concurrency (two different claims land two different, sequential
  // numbers; the same payment event claimed twice burns no second number),
  // the builder in both locales including the honest placeholder path when
  // the platform's own legal identity is unset, the scoped read through the
  // real follower lane, and export. TWO NEGATIVE CONTROLS: a receipt for
  // another follower's real payment_event_id is refused by the WHERE; a
  // duplicate claim for one payment event is refused (no second row, no
  // second counter number burned). Forget's own nullify door is proven
  // statically against the real source (api/memory.js's `q` is imported
  // directly from api/_db.js, not injectable) - see the final report for
  // what remains for `EXPLAIN` against the live database.
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "room-receipt": "room-receipt/run.mjs",
  // WS-R95 (wave fifteen). The creator's journey rehearsed end to end: a
  // real Chromium drives the REAL built studio (`dist/studio.html`) against
  // `evals/rehearsal/harness-creator.mjs`'s real local HTTP server, which
  // routes to the REAL `api/replica.js`, `api/context-items.js`,
  // `api/review-queue.js`, `api/readiness.js` and `api/room-publish.js`
  // handlers over `evals/room-doors/fixtures.mjs`'s `rehearsalCreatorDb`
  // fixture — sign in (a seeded session, never a real OTP), create a
  // replica, add one text source, read Readiness locked below the floor,
  // decide three review cards (Sounds right, Close fix it, Never say
  // this), verify the resulting never-rule bites a matching reply through
  // the REAL predicate function, publish the Room once Readiness is seeded
  // to cross the floor, pick a showcase card, read the share kit, and
  // download the export and read its manifest. FOUR NEGATIVE CONTROLS:
  // publishing below the floor is refused (409, named by code); the
  // eligible-showcase read never offers a follower-sourced card AND
  // forcing one through the door is refused; an unrelated reply is not
  // caught by the minted never-rule; the export carries zero rows for
  // every follower-lane table it names. This suite made a real product
  // finding: `readinessScreen`'s "knows_your_material" part can never be
  // measured today (no recall-run writer exists anywhere in this tree), so
  // NO replica can cross the publish floor through a real computation —
  // crossing it here is a fixture SEED, the same shortcut
  // `evals/room-publish/run.mjs`'s own fixture takes, confirmed by this
  // suite to be the only reachable path rather than merely a convenient
  // one. See `evals/rehearsal/creator.mjs`'s own header for the full list
  // of what is driven through the browser's DOM versus through the
  // harness's own HTTP door directly (both reach the identical real
  // handler), and for the UI gate this suite found (the Share tab's
  // showcase picker does not mount for a replica whose runtime is not
  // active). Runs the English walk only; set `REHEARSAL_FULL=1` to also
  // run the Hindi walk (both locales pass; Hindi is not in this gate's own
  // time budget). $0, no model call, no GPU; Chromium only (never
  // `playwright install` — /opt/pw-browsers is pre-installed).
  "rehearsal-creator": "rehearsal/creator.mjs",
  // WS-R98. The operator digest/incident/self-check alert reaching
  // Telegram, no migration: `api/_operator-telegram.js`'s
  // `operatorTelegramChatIds`/`operatorTelegramConfigured` (pure, env
  // only), `sendOperatorTelegram` over a fake Telegram client (`api/_room-
  // telegram.js#sendRoomCheckinMessage`'s own fake-fetch shape reused, no
  // new HTTP client), and the three real callers
  // (`api/_operator-digest.js#sendOperatorDigest`,
  // `api/_incidents.js#notifyNewIncidentKinds`,
  // `api/_self-check.js#sendSelfCheckTelegramAlert`) each folding exactly
  // one summary field into their own `withSweepRun` digest. THREE NEGATIVE
  // CONTROLS: a chat id not on `OPS_TELEGRAM_CHAT_IDS` is never sent to
  // (proven directly against every url a fake fetch was called with); a
  // 429/5xx is never recorded as a `provider_telegram` incident (only
  // 403/400 are, and they remove nothing from the env-backed list); a body
  // carrying a forbidden content name (a Room's slug, among others) fails a
  // runtime content scan and sends zero messages to any chat.
  //
  // Offline, deterministic, $0, no DB, no network (every fetch is a fake),
  // no model call, no GPU.
  "operator-telegram": "operator-telegram/run.mjs",
  // WS-R96: the day-one runbook (`docs/gurukul/DAY-ONE.md`) and its script
  // (`scripts/day-one.mjs`). Proves `scripts/dayOneRunbook.mjs#parseRunbook`
  // against the REAL runbook table (never a retyped copy), including the
  // REQUIRED NEGATIVE CONTROL — a row whose Proving Command cell is blanked
  // out fails the WHOLE parse, not one row of it — plus a second control for
  // a dropped column. Then drives the REAL `scripts/day-one.mjs` as a
  // subprocess against `evals/day-one/fakeServer.mjs` (a thin wrapper around
  // the REAL `evals/probe-live/fakeServer.mjs`, reusing its server code
  // rather than a second copy) in three self-check states — stub config,
  // half configured, complete — asserting the exact per-step done/blocked
  // verdicts each state should produce, that every `manual:` row is always
  // `unknown` and never silently "done", and that the exit code always
  // matches whether any row is blocked. Two more cases: no operator bearer
  // given (every `self-check:` row degrades to `unknown`, probe-live rows
  // are unaffected) and an unreachable base URL (never crashes, never claims
  // a step is done).
  //
  // Offline, deterministic, $0, no DB, no real network (127.0.0.1 only), no
  // model call, no GPU, no browser.
  "day-one": "day-one/run.mjs",
  // WS-R97. The follower's transparency page (`/r/<slug>/about`, no
  // migration): what this AI knows about you, what the creator can see,
  // how long it is kept, what a referral link carries, the free cap and
  // what a paid tier adds, all read from the Room's own row and imported
  // (never mirrored-by-literal) platform constants. Drives the REAL
  // `api/_room-about.js` (`publicRoomAboutBySlug`/`buildRoomAboutHtml`)
  // over a fake db. Proves: (1) the predicate is published+unpaused,
  // deliberately NEVER `listed_at`-gated, unlike `/c/<slug>`; (2) the
  // builder is pure, both locales; (3) every number on the page is the
  // real imported constant (`PULSE_MIN_FOLLOWERS`, `DORMANCY_GRACE_DAYS`,
  // the three room cap constants), checked both by rendered value and by a
  // static import-source scan; (4) the retention section reads the Room's
  // own `dormancy_days`, with different content when it is null; (5) the
  // WS-R90 hreflang/x-default/og:locale shape; (6) vercel.json carries the
  // rewrite (ordered before the generic `/r/:slug` catch-all) and the
  // headers entry. NEGATIVE CONTROL: an unpublished Room, a paused Room,
  // and an unknown slug all render BYTE IDENTICAL platform-only output,
  // while a published-but-UNLISTED Room does not (this page's own
  // predicate deliberately differs from `/c/<slug>`'s here).
  //
  // Offline, deterministic, $0, no DB, no network, no model call, no GPU.
  "room-about": "room-about/run.mjs",
  // WS-R101. The recall run: Readiness's `knows_your_material` part gets its
  // writer. `generateRecallSet` (deterministic, zero model calls) over a fake
  // db's mined context items, approved review cards and transcribed
  // interview answers; `scoreAnswer` (pure, 0-100) with its own negative
  // control (order-blind scoring cannot tell an echo from the same words
  // shuffled); `scoreRecallRun`/`runRecallMeasurement` driven through the
  // REAL compiled agent (`api/_engine.gen.js`, the DEMO_TEACHER fixture
  // sheet) with a fake `reply`; the rate predicate and the supersede-on-
  // insert, both against a fake db with a controllable clock; `readRecallRun`
  // reading the stored row back; and the capstone `evals/room-doors`/
  // `evals/readiness` cannot prove alone — the publish lock crossing through
  // a REAL recall run in the fixture world, no seed of `vy_replica_readiness`
  // itself, superseding `context/decisions.md#ws-r95-readiness-floor-
  // crossing-is-seeded-never-computed`'s own reversal condition.
  //
  // Offline, deterministic, $0, no network beyond the local esbuild bundle
  // step (fixture-only, no external fetch), one real compiled-agent call
  // path exercised with a fake reply — no live model call, no GPU.
  "recall-run": "recall-run/run.mjs",
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
