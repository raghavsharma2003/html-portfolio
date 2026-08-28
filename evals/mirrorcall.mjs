// The Mirror Call state machine and the chip-approval property (WS-Y).
//
//   node evals/mirrorcall.mjs
//
// Offline, deterministic, $0, no DB, no browser. Bundles the REAL TypeScript
// on every run (`evals/teachersheet.mjs`'s pattern, and CLAUDE.md's reason: a
// frozen bundle passes forever while the source rots).
//
// ── what this suite is actually guarding ──────────────────────────────────
//
// 1. AN UNACCEPTED CHIP IS NEVER APPLIED. `MIRROR-CALL-SPEC.md` §laws makes
//    approval AMBIENT, not automatic: "the owner being present and
//    authenticated IS the approval channel, but presence alone is not
//    approval — the tap is." Section 3 below FUZZES the reducer with 4000
//    pseudo-random event sequences and asserts that no chip is ever applied
//    without a server acknowledgement carrying `applied: true` for that exact
//    delta id. This is the negative-control shape the rest of this repo's
//    suites use: the property is checked against the space of things the UI
//    can actually do, not against the one path a demo takes.
//
// 2. THE END-OF-CALL SWEEP DEFERS, IT DOES NOT ACCEPT. An un-actioned chip at
//    call end goes to the ordinary review queue. The failure mode this catches
//    is the friendly one — "the owner was clearly happy, apply the rest" —
//    which is exactly the silent self-update the spec forbids.
//
// 3. THE CLONE DOES NOT SPEAK FIRST (`clone-initiative-record-has-no-absence`:
//    silence, gaps and streaks are not inputs the predicate HAS). Here that is
//    structural: `WINDOW_RESULT` is the only event that can add a clone
//    caption, and the fuzz asserts clone captions never outnumber owner
//    windows.
//
// 4. A DROPPED WINDOW IS VISIBLE AND PRODUCES NOTHING. No silent truncation:
//    a dropped window must add a caption saying so, must not add a clone turn,
//    and must not be counted as an owner window.
//
// 5. THE TWO FIDELITY METERS NEVER GRADE THE VOICE, AND MOVE FOR DIFFERENT
//    REASONS. Every branch of `fidelityStatusLine` is checked for the words the
//    earbench owns, and the honesty line + caveats are asserted to name ECAPA /
//    speaker-embedding similarity. `docs/gurukul/EARBENCH.md`: nothing in this
//    repo is evidence about how a cloned voice SOUNDS. The split itself is a
//    property here: pooling more audio MUST move the measurement meter and MUST
//    NOT move the conditioning meter, because Chatterbox truncates its
//    reference to 10 s and the clone therefore cannot have changed
//    (`mirror-learning.md` §1.1, adoption delta A2). A single meter would have
//    hidden exactly that.
//
// 5b. THE RAIL IS CAPPED AND EVERY CHIP CARRIES ITS n. Three chips a minute,
//    surplus straight to review later and flagged as never-shown; and an n=1
//    chip is a different strength from an n=9-across-three-calls chip, because
//    one call is below every stylometric floor in the sweep (adoption deltas
//    A4/A5).
//
// 6. THE CLIENT NORMALIZER CANNOT BE TALKED INTO "APPLIED". `normalizeDelta`
//    is run against a server payload that claims a rejected delta landed on
//    the sheet, which is the wire-level version of the same failure.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const OUT = mkdtempSync(join(tmpdir(), "mirrorcall-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(join(REPO, "src/studio/mirrorCallMachine"))};\n` +
    `export { normalizeDelta, normalizeFidelity, MAX_WINDOW_MS, REQUIRED_OPS, MIRROR_CALL_CONTRACT } from ${JSON.stringify(join(REPO, "src/studio/mirrorCallApi"))};\n`,
);
const BUNDLE = join(OUT, "mirrorcall.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { cwd: REPO, stdio: "inherit" },
);
const M = await import(pathToFileURL(BUNDLE).href);
const {
  callReducer,
  INITIAL_CALL_STATE,
  chipIsApplied,
  appliedChips,
  deferredChips,
  pendingChips,
  canCapture,
  canEnd,
  dropCopy,
  readMeasurementFidelity,
  readConditioningFidelity,
  fidelityStatusLine,
  evidenceLine,
  evidenceStrength,
  CHIPS_PER_MINUTE,
  FIDELITY_HONESTY,
  FIDELITY_CAVEAT,
  MEASUREMENT_CAVEAT,
  CONDITIONING_CAVEAT,
  METER_PAIR_NOTE,
  normalizeDelta,
  MAX_WINDOW_MS,
  REQUIRED_OPS,
  MIRROR_CALL_CONTRACT,
} = M;

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

const run = (events, start = INITIAL_CALL_STATE) => events.reduce(callReducer, start);

const delta = (id, over = {}) => ({
  delta_id: id,
  kind: "phrase_habit",
  field: "phraseHabits",
  proposal: `note: says "${id}" a lot`,
  citation: { turn_id: `t-${id}`, quote: `${id} yaar`, occurrences: 3 },
  evidence: { occurrences_this_call: 3, occurrences_total: 3, calls: 1, corpus_words: 400 },
  status: "proposed",
  applied: false,
  created_at: "2026-08-26T00:00:00.000Z",
  ...over,
});

const session = (over = {}) => ({
  session_id: "s1",
  replica_id: "r1",
  contract: MIRROR_CALL_CONTRACT,
  state: "live",
  gpu: { warm: true, estimated_ready_seconds: null },
  window_ms_max: MAX_WINDOW_MS,
  fidelity: null,
  ops: [...REQUIRED_OPS],
  ...over,
});

const windowResult = (over = {}) => ({
  window_id: "w1",
  seq: 1,
  dropped: null,
  owner_transcript: "basically I never say it that way",
  turn: { turn_id: "turn-1", text: "haan basically same", can_voice: true },
  deltas: [],
  fidelity: null,
  reference: null,
  ...over,
});

const CONNECTED = [
  { type: "PROBE_START" },
  { type: "PROBE_OK", voiceAvailable: true },
  { type: "CONNECT" },
  { type: "SESSION_OPEN", session: session() },
];

// ── 1. the phase machine ───────────────────────────────────────────────────
console.log("\n── the call phase machine ──");

ok("a fresh machine is idle and cannot capture", INITIAL_CALL_STATE.phase === "idle" && !canCapture(INITIAL_CALL_STATE));

const absent = run([{ type: "PROBE_START" }, { type: "PROBE_ABSENT", detail: "404" }]);
ok(
  "a missing route lands in backend_absent, never in idle",
  absent.phase === "backend_absent" && absent.absentDetail === "404",
  absent.phase,
);
ok(
  "backend_absent cannot be talked into connecting",
  run([...[{ type: "PROBE_START" }, { type: "PROBE_ABSENT", detail: "404" }], { type: "CONNECT" }]).phase === "backend_absent",
);

const warming = run([
  { type: "PROBE_START" },
  { type: "PROBE_OK", voiceAvailable: true },
  { type: "CONNECT" },
  { type: "SESSION_OPEN", session: session({ state: "warming", gpu: { warm: false, estimated_ready_seconds: 150 } }) },
]);
ok("a cold GPU lands in warming and the mic stays shut", warming.phase === "warming" && !canCapture(warming), warming.phase);
ok(
  "the warming caption states the two-to-three minute cold start",
  /two to three minutes/.test(warming.captions.at(-1).text),
  warming.captions.at(-1).text,
);
ok("WARM opens the call", callReducer(warming, { type: "WARM" }).phase === "live");

const connected = run(CONNECTED);
ok("a warm session is live and can capture", connected.phase === "live" && canCapture(connected));
ok("end is offered while connecting, warming and live", canEnd(connected) && canEnd(warming));

// A window may not be sent from a machine that is not live. This is the guard
// that stops a queued upload from a call the owner already ended.
const afterEnd = run([...CONNECTED, { type: "END" }, {
  type: "ENDED",
  end: { session_id: "s1", ended_at: "", deferred: [], accepted_count: 0, rejected_count: 0, finetune: { queued: true, job_id: "j1", reason: null }, fidelity: null },
}]);
ok("a window arriving after ENDED changes nothing", run([{ type: "WINDOW_RESULT", result: windowResult() }], afterEnd).cloneTurns === 0);

// ── 2. dropped windows are loud and produce nothing ────────────────────────
console.log("\n── a dropped window (no silent truncation) ──");

const dropped = run([...CONNECTED, { type: "WINDOW_RESULT", result: windowResult({ dropped: { reason: "asr_timeout" }, owner_transcript: "", turn: null }) }]);
ok("a dropped window adds a caption that says so", dropped.captions.some((c) => c.kind === "dropped"));
ok("a dropped window adds no clone turn", dropped.cloneTurns === 0 && !dropped.captions.some((c) => c.kind === "clone"));
ok("a dropped window is not counted as an owner window", dropped.ownerWindows === 0 && dropped.droppedWindows === 1);
ok(
  "every drop reason has copy that asks for it again, and none of it is 'something went wrong'",
  ["asr_timeout", "asr_empty", "too_short", "too_long", "audio_unusable", "rate_limited"].every((reason) => {
    const copy = dropCopy(reason);
    return /again\?/.test(copy) && !/something went wrong/i.test(copy);
  }),
);

// ── 3. THE property: an unaccepted chip is never applied ───────────────────
console.log("\n── the chip-approval property, fuzzed ──");

const simple = run([...CONNECTED, { type: "WINDOW_RESULT", result: windowResult({ deltas: [delta("d1"), delta("d2")] }) }]);
ok("chips arrive as proposed and none is applied", simple.chips.length === 2 && appliedChips(simple).length === 0);

const tapped = run([{ type: "CHIP_ACTION", deltaId: "d1", action: "accept" }], simple);
ok(
  "TAPPING accept does not apply anything — only the server ack can",
  tapped.chips[0].status === "accepting" && appliedChips(tapped).length === 0,
);

const acked = run([{ type: "CHIP_RESULT", delta: delta("d1", { status: "accepted", applied: true }) }], tapped);
ok("a server ack with applied:true is what applies it", appliedChips(acked).length === 1 && acked.chips[0].status === "accepted");

const ackedNotLanded = run([{ type: "CHIP_RESULT", delta: delta("d1", { status: "accepted", applied: false }) }], tapped);
ok(
  "accepted-but-not-landed renders as accepted and NOT applied",
  ackedNotLanded.chips[0].status === "accepted" && appliedChips(ackedNotLanded).length === 0,
);

const failed = run([{ type: "CHIP_FAILED", deltaId: "d1", message: "network" }], tapped);
ok(
  "a failed accept goes back to actionable, never to applied",
  failed.chips[0].status === "proposed" && failed.chips[0].serverApplied === false && failed.chips[0].error === "network",
);

// A re-proposal of an already-actioned chip must not re-open it: a late
// duplicate from the mining pass would otherwise silently un-reject something.
const rejected = run([
  { type: "CHIP_ACTION", deltaId: "d2", action: "reject" },
  { type: "CHIP_RESULT", delta: delta("d2", { status: "rejected" }) },
  { type: "WINDOW_RESULT", result: windowResult({ window_id: "w2", seq: 2, deltas: [delta("d2")] }) },
], simple);
ok(
  "a re-proposed chip does not un-reject itself",
  rejected.chips.find((c) => c.delta.delta_id === "d2").status === "rejected",
);

// The refresh path is the same merge, so it must obey the same rule: a chip
// the owner already rejected must not come back as proposed because the server
// re-listed it.
const refreshed = run([
  { type: "CHIP_ACTION", deltaId: "d2", action: "reject" },
  { type: "CHIP_RESULT", delta: delta("d2", { status: "rejected" }) },
  { type: "DELTAS_SYNCED", deltas: [delta("d2"), delta("d7")] },
], simple);
ok(
  "a refresh does not un-reject a dismissed chip, and does pick up a new one",
  refreshed.chips.find((c) => c.delta.delta_id === "d2").status === "rejected" &&
    refreshed.chips.some((c) => c.delta.delta_id === "d7" && c.status === "proposed"),
);
ok(
  "a refresh carrying an applied:true claim for an unactioned chip does not apply it",
  appliedChips(run([{ type: "DELTAS_SYNCED", deltas: [delta("d8", { status: "proposed", applied: true })] }], simple)).length === 0,
);

// The fuzz. Every event a user can cause, in every order, including ones the
// UI would never emit — the property has to hold against the machine, not
// against the happy path.
// Every chip-bearing event carries an explicit `at`, spread across four
// minutes: without it the reducer would read the wall clock and the per-minute
// chip budget would make the fuzz depend on when it ran.
const FUZZ_T0 = 1_700_000_000_000;
const EVENTS = (ids) => [
  { type: "WINDOW_RESULT", at: FUZZ_T0, result: windowResult({ deltas: ids.map((id) => delta(id)) }) },
  ...ids.flatMap((id) => [
    { type: "CHIP_ACTION", deltaId: id, action: "accept" },
    { type: "CHIP_ACTION", deltaId: id, action: "reject" },
    { type: "CHIP_RESULT", delta: delta(id, { status: "accepted", applied: false }) },
    { type: "CHIP_RESULT", delta: delta(id, { status: "rejected", applied: false }) },
    // The dishonest twin: a server payload claiming a REJECTED delta landed.
    { type: "CHIP_RESULT", delta: delta(id, { status: "rejected", applied: true }) },
    { type: "CHIP_FAILED", deltaId: id, message: "boom" },
    { type: "RATE_TURN", turnId: "turn-1", rating: "down", deltas: [delta(id)], at: FUZZ_T0 + 60_000 },
    { type: "DELTAS_SYNCED", deltas: [delta(id, { status: "accepted", applied: true })], at: FUZZ_T0 + 120_000 },
  ]),
  { type: "WINDOW_RESULT", at: FUZZ_T0 + 180_000, result: windowResult({ dropped: { reason: "asr_empty" }, owner_transcript: "", turn: null }) },
  { type: "WINDOW_RESULT", at: FUZZ_T0 + 180_000, result: windowResult() },
  { type: "SPEAK_START", turnId: "turn-1" },
  { type: "SPEAK_END" },
  { type: "END" },
  {
    type: "ENDED",
    end: { session_id: "s1", ended_at: "", deferred: [delta("dx", { status: "deferred" })], accepted_count: 0, rejected_count: 0, finetune: { queued: false, job_id: null, reason: "no_consented_windows" }, fidelity: null },
  },
];

// A tiny deterministic PRNG — a fuzz nobody can re-run is an anecdote.
let seed = 20260826;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const ids = ["d1", "d2", "d3"];
const pool = EVENTS(ids);
let violations = 0;
let unauthorizedApply = 0;
let cloneWithoutOwner = 0;
let appliedAfterEnd = 0;
for (let trial = 0; trial < 4_000; trial++) {
  let state = run(CONNECTED);
  const seen = new Set(); // delta ids that got an accept ack carrying applied:true
  const length = 6 + Math.floor(rand() * 14);
  for (let step = 0; step < length; step++) {
    const event = pool[Math.floor(rand() * pool.length)];
    if (event.type === "CHIP_RESULT" && event.delta.status === "accepted" && event.delta.applied === true) {
      seen.add(event.delta.delta_id);
    }
    // The delta LIST is the other server payload that can authorise, and only
    // for a chip the client has never seen — a re-list cannot flip one the
    // owner already actioned, which `mergeChips` enforces and the targeted
    // case above asserts. Taps are not in this list, which is the point: the
    // only two ways `applied` can become true are both the server saying so.
    if (event.type === "DELTAS_SYNCED") {
      for (const d of event.deltas) {
        if (d.status === "accepted" && d.applied === true) seen.add(d.delta_id);
      }
    }
    if (event.type === "CHIP_RESULT" && (event.delta.status !== "accepted" || event.delta.applied !== true)) {
      seen.delete(event.delta.delta_id);
    }
    const before = state;
    state = callReducer(state, event);
    // THE property.
    for (const chip of state.chips) {
      if (chipIsApplied(chip) && !seen.has(chip.delta.delta_id)) unauthorizedApply++;
    }
    // The clone never speaks first.
    if (state.cloneTurns > state.ownerWindows) cloneWithoutOwner++;
    // Ending never applies anything the owner did not.
    if (event.type === "ENDED" && appliedChips(state).length > appliedChips(before).length) appliedAfterEnd++;
    if (state.chips.some((chip) => chip.status === "accepted" && chip.delta.status === "rejected")) violations++;
  }
}
ok("4000 fuzzed sequences: no chip was ever applied without a server accept ack", unauthorizedApply === 0, `${unauthorizedApply} violations`);
ok("4000 fuzzed sequences: clone turns never exceed owner windows", cloneWithoutOwner === 0, `${cloneWithoutOwner} violations`);
ok("4000 fuzzed sequences: ending a call never applied a new chip", appliedAfterEnd === 0, `${appliedAfterEnd} violations`);
ok("4000 fuzzed sequences: no chip held an accepted status over a rejected delta", violations === 0, `${violations} violations`);

// The fuzz's own negative control: a reducer that trusts the tap must fail the
// same property. A check that passes against the bug it exists to catch is not
// a check.
function trustingReducer(state, event) {
  if (event.type === "CHIP_ACTION" && event.action === "accept") {
    return {
      ...state,
      chips: state.chips.map((chip) =>
        chip.delta.delta_id === event.deltaId ? { ...chip, status: "accepted", serverApplied: true } : chip
      ),
    };
  }
  return callReducer(state, event);
}
let trustingViolations = 0;
{
  let state = run(CONNECTED);
  state = trustingReducer(state, { type: "WINDOW_RESULT", result: windowResult({ deltas: [delta("d1")] }) });
  state = trustingReducer(state, { type: "CHIP_ACTION", deltaId: "d1", action: "accept" });
  if (appliedChips(state).length > 0) trustingViolations++;
}
ok(
  "the negative control fails it: a reducer that trusts the tap DOES apply an unacknowledged chip",
  trustingViolations === 1,
);

// ── 4. the end-of-call sweep ───────────────────────────────────────────────
console.log("\n── un-actioned chips roll into review later ──");

const beforeEnd = run([
  { type: "CHIP_ACTION", deltaId: "d1", action: "accept" },
  { type: "CHIP_RESULT", delta: delta("d1", { status: "accepted", applied: true }) },
], simple);
ok("one accepted, one still waiting", appliedChips(beforeEnd).length === 1 && pendingChips(beforeEnd).length === 1);

const swept = run([
  { type: "END" },
  {
    type: "ENDED",
    end: {
      session_id: "s1", ended_at: "2026-08-26T00:10:00.000Z",
      deferred: [delta("d2", { status: "deferred" }), delta("d9", { status: "deferred" })],
      accepted_count: 1, rejected_count: 0,
      finetune: { queued: true, job_id: "job-1", reason: null }, fidelity: null,
    },
  },
], beforeEnd);
ok("the un-actioned chip is deferred, not accepted", swept.chips.find((c) => c.delta.delta_id === "d2").status === "deferred");
ok("the accepted chip stays applied through the sweep", appliedChips(swept).length === 1);
ok("nothing new became applied at end", appliedChips(swept).every((chip) => chip.delta.delta_id === "d1"));
ok("a delta the client never saw still lands in the review rail", deferredChips(swept).some((c) => c.delta.delta_id === "d9"));
ok(
  "the end caption says the fine-tune is QUEUED, not running",
  /queued/.test(swept.captions.at(-1).text) && /after the call/.test(swept.captions.at(-1).text),
  swept.captions.at(-1).text,
);

const noFinetune = run([
  { type: "END" },
  {
    type: "ENDED",
    end: { session_id: "s1", ended_at: "", deferred: [], accepted_count: 0, rejected_count: 0, finetune: { queued: false, job_id: null, reason: "no_consented_windows" }, fidelity: null },
  },
], beforeEnd);
ok(
  "no fine-tune queued says so, with the server's reason",
  /No fine-tune was queued/.test(noFinetune.captions.at(-1).text) && /no consented windows/.test(noFinetune.captions.at(-1).text),
  noFinetune.captions.at(-1).text,
);

// ── 5. the two fidelity meters say what they are ───────────────────────────
// Adoption delta A2 of `docs/gurukul/research/mirror-learning.md`. Chatterbox
// truncates the reference to 10s/6s in `prepare_conditionals`, so pooled audio
// past that cannot change synthesis while the ECAPA estimate keeps improving.
// One number would climb beside a clone that mechanically cannot have changed.
console.log("\n── the fidelity meters' honesty ──");

const FORBIDDEN = /\b(sounds?|quality|realistic|natural(ness)?|indistinguishable|perfect|good|excellent)\b/i;
ok(
  "the honesty line names ECAPA and speaker-embedding similarity",
  /ECAPA/.test(FIDELITY_HONESTY) && /speaker-embedding similarity/i.test(FIDELITY_HONESTY),
  FIDELITY_HONESTY,
);
ok(
  "the caveat says the number is not about how it sounds",
  /does not measure how the voice sounds/i.test(FIDELITY_CAVEAT),
  FIDELITY_CAVEAT,
);
ok(
  "the measurement caveat says it is about measurement, not the clone",
  /not how good the clone is/i.test(MEASUREMENT_CAVEAT) && /the clone does not change/i.test(MEASUREMENT_CAVEAT),
  MEASUREMENT_CAVEAT,
);
ok(
  "the conditioning caveat names the ~10 second read and denies that more audio moves it",
  /10 seconds/.test(CONDITIONING_CAVEAT) && /never because more audio was collected/i.test(CONDITIONING_CAVEAT),
  CONDITIONING_CAVEAT,
);
ok(
  "the pair note explains why the two numbers differ",
  /different reasons/i.test(METER_PAIR_NOTE) && /better reference window/i.test(METER_PAIR_NOTE),
  METER_PAIR_NOTE,
);

const fidelity = (over = {}) => ({
  family: "speechbrain-ecapa-voxceleb",
  policy_version: "voice-fidelity/v1",
  ceiling: 0.8869,
  measurement_score: 0.7753,
  measurement_confidence: 0.62,
  p10: 0.7479,
  windows: 9,
  pooled_seconds: 240,
  conditioning_window_score: 0.7901,
  conditioning_seconds: 10,
  window_selected_at: "2026-08-26T00:04:00.000Z",
  window_selections: 2,
  ...over,
});

// THE meter-split property: pooling more audio moves the measurement meter and
// must NOT move the conditioning meter. This is the whole reason there are two.
const early = fidelity({ windows: 2, pooled_seconds: 40, measurement_score: 0.74, measurement_confidence: 0.3 });
const later = fidelity({ windows: 22, pooled_seconds: 600, measurement_score: 0.7753, measurement_confidence: 0.82 });
ok(
  "pooled audio moves the measurement meter",
  readMeasurementFidelity(later).score > readMeasurementFidelity(early).score &&
    readMeasurementFidelity(later).confidence > readMeasurementFidelity(early).confidence,
);
ok(
  "the same pooling does NOT move the conditioning meter",
  readConditioningFidelity(later).score === readConditioningFidelity(early).score,
);
const reselected = fidelity({ conditioning_window_score: 0.83, window_selections: 3, window_selected_at: "2026-08-26T00:09:00.000Z" });
ok(
  "only a re-selected window moves the conditioning meter",
  readConditioningFidelity(reselected).score > readConditioningFidelity(later).score &&
    readConditioningFidelity(reselected).selections === 3,
);
ok(
  "the two meters are labelled apart, and neither label is 'fidelity'",
  /how well we can measure you/i.test(readMeasurementFidelity(later).label) &&
    /what the next reply is built from/i.test(readConditioningFidelity(later).label),
);

const readings = [
  readMeasurementFidelity(null),
  readMeasurementFidelity(fidelity({ measurement_score: null, windows: 0, pooled_seconds: 0 })),
  readMeasurementFidelity(fidelity({ ceiling: null })),
  readMeasurementFidelity(fidelity({ windows: 1 })),
  readMeasurementFidelity(fidelity({ measurement_score: 0.5 })),
  readMeasurementFidelity(later),
  readConditioningFidelity(null),
  readConditioningFidelity(fidelity({ conditioning_window_score: null })),
  readConditioningFidelity(fidelity({ ceiling: null })),
  readConditioningFidelity(fidelity({ conditioning_window_score: 0.5 })),
  readConditioningFidelity(later),
];
ok("bands cover unmeasured / no-ceiling / single-window / below-floor / measured",
  new Set(readings.map((r) => r.band)).size === 5, [...new Set(readings.map((r) => r.band))].join(","));
ok(
  "no status line on either meter grades the voice",
  readings.every((r) => !FORBIDDEN.test(fidelityStatusLine(r))),
  readings.map((r) => fidelityStatusLine(r)).find((line) => FORBIDDEN.test(line)) || "",
);
ok(
  "an unmeasured meter shows nothing rather than a zero",
  readings[0].score === null && readings[0].ofCeiling === null && /stays empty/.test(fidelityStatusLine(readings[0])),
);
ok(
  "no printed ceiling ⇒ no bar and copy that says the number has no top",
  readings[2].ofCeiling === null && /no top/.test(fidelityStatusLine(readings[2])),
  fidelityStatusLine(readings[2]),
);
ok("one window is called an anecdote", /anecdote/.test(fidelityStatusLine(readings[3])));
ok(
  "the real first-clone numbers read as 87% of ceiling",
  Math.round(readings[5].ofCeiling * 100) === 87,
  String(readings[5].ofCeiling),
);
ok("the bar is clamped to the ceiling and never overflows",
  readMeasurementFidelity(fidelity({ measurement_score: 0.99, ceiling: 0.8 })).ofCeiling === 1);

// ── 5b. the chip budget and the evidence count ─────────────────────────────
// Adoption deltas A4 and A5. The rail is capped because "people do not enjoy a
// constant stream of questions" (Cakmak & Thomaz, via the sweep), and every
// chip shows its n because one call is below every stylometric floor.
console.log("\n── the chip budget and the evidence count ──");

const T0 = 1_800_000_000_000;
const flood = run([
  ...CONNECTED,
  {
    type: "WINDOW_RESULT",
    at: T0,
    result: windowResult({ deltas: ["b1", "b2", "b3", "b4", "b5"].map((id) => delta(id)) }),
  },
]);
ok(
  `only ${CHIPS_PER_MINUTE} chips reach the rail in one minute`,
  flood.chips.filter((c) => c.status === "proposed").length === CHIPS_PER_MINUTE,
  String(flood.chips.filter((c) => c.status === "proposed").length),
);
ok(
  "the surplus is deferred to review later, flagged as overflow, and never applied",
  flood.chips.filter((c) => c.overflow).length === 2 &&
    flood.chips.filter((c) => c.overflow).every((c) => c.status === "deferred") &&
    appliedChips(flood).length === 0,
);
ok("the overflow count is reported so the rail can say it happened", flood.chipBudget.overflowed === 2);

const nextMinute = run([{
  type: "WINDOW_RESULT",
  at: T0 + 61_000,
  result: windowResult({ window_id: "w2", seq: 2, deltas: [delta("b6")] }),
}], flood);
ok(
  "the budget refills on the next minute",
  nextMinute.chips.find((c) => c.delta.delta_id === "b6").status === "proposed" &&
    nextMinute.chipBudget.admitted === 1,
);

// The budget caps how often the rail ASKS. A delta that arrives already
// actioned by the server is a statement about the sheet, not a question, so it
// must not consume a slot — otherwise a busy server could starve the rail of
// its three questions with rows nobody has to answer.
const withActioned = run([
  ...CONNECTED,
  {
    type: "WINDOW_RESULT",
    at: T0,
    result: windowResult({ deltas: ["c0", "c1", "c2", "c3"].map((id, index) =>
      delta(id, index === 0 ? { status: "accepted", applied: true } : {})) }),
  },
]);
ok(
  "an already-actioned delta does not spend a question slot",
  withActioned.chips.filter((c) => c.status === "proposed").length === CHIPS_PER_MINUTE &&
    withActioned.chipBudget.overflowed === 0 &&
    appliedChips(withActioned).length === 1,
);

ok(
  "an n=1 chip is a weaker strength than an n=9-across-3-calls chip",
  evidenceStrength(delta("e1", { evidence: { occurrences_this_call: 1, occurrences_total: 1, calls: 1, corpus_words: 400 } })) === "single" &&
    evidenceStrength(delta("e2", { evidence: { occurrences_this_call: 3, occurrences_total: 9, calls: 3, corpus_words: 6000 } })) === "repeated",
);
ok(
  "every chip's evidence line states the count it was mined from",
  /heard 1x this call/.test(evidenceLine(delta("e1", { evidence: { occurrences_this_call: 1, occurrences_total: 1, calls: 1, corpus_words: 400 } }))) &&
    /9x across 3 calls/.test(evidenceLine(delta("e2", { evidence: { occurrences_this_call: 3, occurrences_total: 9, calls: 3, corpus_words: 6000 } }))),
  evidenceLine(delta("e2", { evidence: { occurrences_this_call: 3, occurrences_total: 9, calls: 3, corpus_words: 6000 } })),
);
ok(
  "a single-occurrence chip says out loud that once is not a habit",
  /once is a guess, not a habit/.test(evidenceLine(delta("e1", { evidence: { occurrences_this_call: 1, occurrences_total: 1, calls: 1, corpus_words: 400 } }))),
);
ok(
  "a one-call chip names the corpus floor rather than implying a finding",
  /below the length where phrasing claims hold up/.test(
    evidenceLine(delta("e3", { evidence: { occurrences_this_call: 3, occurrences_total: 3, calls: 1, corpus_words: 1900 } })),
  ),
);

// ── 6. the wire normalizer cannot be talked into "applied" ─────────────────
console.log("\n── the client normalizer, against a dishonest server ──");

ok(
  "a rejected delta claiming applied:true normalizes to NOT applied",
  normalizeDelta({ ...delta("d1"), status: "rejected", applied: true }).applied === false,
);
ok(
  "a proposed delta claiming applied:true normalizes to NOT applied",
  normalizeDelta({ ...delta("d1"), status: "proposed", applied: true }).applied === false,
);
ok(
  "an accepted delta with applied:true is honoured — the server is the authority upward",
  normalizeDelta({ ...delta("d1"), status: "accepted", applied: true }).applied === true,
);
let citationRejected = false;
try {
  normalizeDelta({ ...delta("d1"), citation: undefined });
} catch {
  citationRejected = true;
}
ok("a chip with no citation is refused at the door — an unjudgeable chip is not rendered", citationRejected);
let statusRejected = false;
try {
  normalizeDelta({ ...delta("d1"), status: "applied" });
} catch {
  statusRejected = true;
}
ok("an unknown status is refused rather than guessed", statusRejected);

console.log(fail ? `\n${fail} of ${pass + fail} FAILURES` : `\nALL ${pass} CHECKS PASS`);
process.exitCode = fail ? 1 : 0;
