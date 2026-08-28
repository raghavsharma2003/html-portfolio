// The ingestion seam — the statistical pass, the phrase-bank rule, the draft
// assembler's honesty, and the studio endpoint's dispatch (Gurukul WS-F).
//
//   node evals/ingest.mjs
//
// Offline, deterministic, $0, no DB. Bundles the REAL TypeScript on every run
// (evals/teachersheet.mjs's pattern, and CLAUDE.md's reason: a frozen bundle
// passes forever while the source rots), and drives the endpoint's logic
// through a FAKE `db` so the same code path a browser reaches is the one this
// suite reaches.
//
// ── what this suite is actually guarding ──────────────────────────────────
//
// 1. THE NUMBERS ARE THE PRODUCT. `ingestion-research.md` §4's whole finding
//    is that the countable half of persona extraction has no prior art and is
//    the half worth building; a statistical pass whose numbers drift between
//    two runs of the same transcript is worth nothing at all. So determinism
//    is asserted directly, and the tiebreaks that make it hold are asserted
//    with it.
//
// 2. THE ≥5 RULE NEEDS A HELD-OUT HALF, AND THE FIXTURE PROVES WHY. "socho
//    zara" occurs 8 times in the half the draft is mined from and 2 times in
//    the half it is checked against. An in-sample check passes it. The suite
//    asserts it is REJECTED — which is the only assertion here that would go
//    quiet if someone replaced the split with a cheaper one.
//
// 3. THE DRAFTER'S HONESTY IS A PROPERTY, NOT A VIBE. `draft` ∪ `gaps` must be
//    exactly the sheet contract, every drafted field must carry provenance,
//    and no field may be filled that nothing supplied. That last one gets the
//    NEGATIVE CONTROL this repo requires of every gate: a deliberately
//    dishonest copy of the assembler, which fills a field it has no evidence
//    for, and which the honesty predicate MUST catch. A check that passes
//    against the bug it exists to catch is not a check.
//
// 4. THE PUBLISH GATE FAILS CLOSED, AND UNVERIFIED IS NOT A PASS. Three
//    phrase-bank states, three assertions, and one of them is the state that
//    does not exist in a boolean.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LECTURE_TURNS, TEACHER_SPEAKER, STUDENT_SPEAKER } from "./fixtures/lecture-hinglish.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const OUT = mkdtempSync(join(tmpdir(), "ingest-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(join(REPO, "src/engine/ingest/transcriptStats"))};\n` +
    `export * from ${JSON.stringify(join(REPO, "src/engine/ingest/sheetDraft"))};\n` +
    `export * from ${JSON.stringify(join(REPO, "src/engine/ingest/qualitativePass"))};\n` +
    `export { DEMO_TEACHER } from ${JSON.stringify(join(REPO, "src/engine/agents/characters/demoTeacher"))};\n`,
);
const BUNDLE = join(OUT, "ingest.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error ` +
    `--alias:@capacitor/core=${join(HERE, "stubs/capacitor.mjs")}`,
  { cwd: REPO, stdio: "inherit" },
);
const M = await import(pathToFileURL(BUNDLE).href);
const {
  transcriptStats,
  verifyPhraseBank,
  splitHeldOut,
  draftFromSignals,
  FIELD_SOURCE_CLASS,
  createStubQualitativePass,
  createQualitativePass,
  QUALITATIVE_PROPOSABLE_FIELDS,
  PHRASE_BANK_MIN_OCCURRENCES,
  DEMO_TEACHER,
} = M;

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

const { derive, heldOut } = splitHeldOut(LECTURE_TURNS);
const stats = transcriptStats(derive, { teacherSpeaker: TEACHER_SPEAKER });
const occurrencesOf = (fragment) =>
  verifyPhraseBank([fragment], heldOut, { teacherSpeaker: TEACHER_SPEAKER }).findings[0].occurrences;

// ── 1. the split ──────────────────────────────────────────────────────────
console.log("\n── splitHeldOut: per-speaker parity, not global index parity ──");
ok("both halves carry both speakers", [derive, heldOut].every((half) =>
  half.some((t) => t.speaker === TEACHER_SPEAKER) && half.some((t) => t.speaker === STUDENT_SPEAKER)));
ok(
  "the teacher's turns are split evenly between the halves (±1)",
  Math.abs(
    derive.filter((t) => t.speaker === TEACHER_SPEAKER).length -
      heldOut.filter((t) => t.speaker === TEACHER_SPEAKER).length,
  ) <= 1,
);
// THE NEGATIVE CONTROL for the split. A global-index parity split is the
// obvious implementation and it is catastrophic on an alternating transcript:
// it hands one half every teacher turn and the other half a corpus of somebody
// else's words. Re-run here on a purely alternating transcript, where it must
// be visibly wrong — if this copy looked fine, the per-speaker version above
// would not be earning anything.
const alternating = Array.from({ length: 20 }, (_, i) =>
  i % 2 === 0 ? { speaker: TEACHER_SPEAKER, text: "dekho theek hai" } : { speaker: STUDENT_SPEAKER, text: "haan sir" },
);
const globalParity = {
  derive: alternating.filter((_, i) => i % 2 === 0),
  heldOut: alternating.filter((_, i) => i % 2 === 1),
};
ok(
  "global-index parity would put ZERO teacher turns in the held-out half (the bug)",
  globalParity.heldOut.every((t) => t.speaker !== TEACHER_SPEAKER),
);
const perSpeaker = splitHeldOut(alternating);
ok(
  "per-speaker parity puts half the teacher's turns there instead",
  perSpeaker.heldOut.filter((t) => t.speaker === TEACHER_SPEAKER).length === 5,
);

// ── 2. determinism ────────────────────────────────────────────────────────
console.log("\n── transcriptStats: determinism on an 80-turn Hinglish lecture ──");
const again = transcriptStats(derive, { teacherSpeaker: TEACHER_SPEAKER });
ok("same transcript in, byte-identical stats out", JSON.stringify(stats) === JSON.stringify(again));
// The tiebreak assertion. Without "descending count, then ASCENDING fragment"
// two equal-count fragments come back in map order and this suite fails
// intermittently — and an intermittent gate is worse than none.
const ties = (rows) =>
  rows.every((row, i) => i === 0 || rows[i - 1].count > row.count || rows[i - 1].fragment < row.fragment);
ok("catchphrases sorted count-desc then fragment-asc", ties(stats.catchphrases));
ok("fillers sorted the same way", ties(stats.fillers));
ok(
  "reordering the transcript does not change the measured totals",
  JSON.stringify(transcriptStats([...derive].reverse(), { teacherSpeaker: TEACHER_SPEAKER }).codeSwitch) ===
    JSON.stringify(stats.codeSwitch),
);

console.log("\n── transcriptStats: the signals are actually there ──");
ok("code-switch measured on both axes", stats.codeSwitch.tokenRatio > 0 && stats.codeSwitch.turnRatio > 0,
  `token ${stats.codeSwitch.tokenRatio} / turn ${stats.codeSwitch.turnRatio}`);
ok("filler distribution is non-empty and led by a real Hinglish filler",
  stats.fillers.length >= 4 && ["dekho", "socho", "theek hai", "achha"].includes(stats.fillers[0].fragment),
  stats.fillers.slice(0, 4).map((f) => `${f.fragment}:${f.count}`).join(" "));
ok("multi-word fillers count as ONE signal, not two halves",
  stats.fillers.some((f) => f.fragment === "theek hai"));
ok("laughter counted, and never as a label", stats.laughter.length > 0 &&
  !stats.laughter.some((l) => l.fragment.includes("*")));
ok("stretch tokens counted", stats.stretch.length > 0, stats.stretch.map((s) => s.fragment).join(" "));
ok("per-1k rates are present so two corpora of different sizes are comparable",
  stats.fillers.every((f) => f.per1k > 0));

// DIARIZATION. The student says "sahiii" and never says "dekho"; a counter
// that measured both speakers together would report the student's habits as
// the teacher's, and a teacher clone would then be built partly out of a
// sixteen-year-old's speech.
console.log("\n── transcriptStats: the student's words are not the teacher's ──");
const studentStats = transcriptStats(LECTURE_TURNS, { teacherSpeaker: STUDENT_SPEAKER });
const bothSpeakers = transcriptStats(
  LECTURE_TURNS.map((t) => ({ ...t, speaker: TEACHER_SPEAKER })),
  { teacherSpeaker: TEACHER_SPEAKER },
);
ok("the student's stretch token is in the STUDENT's counts", studentStats.stretch.some((s) => s.fragment === "sahiii"));
ok("...and NOT in the teacher's", !transcriptStats(LECTURE_TURNS, { teacherSpeaker: TEACHER_SPEAKER })
  .stretch.some((s) => s.fragment === "sahiii"));
ok("collapsing the speakers changes the token count (so the filter is doing work)",
  bothSpeakers.tokens > transcriptStats(LECTURE_TURNS, { teacherSpeaker: TEACHER_SPEAKER }).tokens);
ok("with no speaker given, the most-talkative one is chosen and NAMED",
  transcriptStats(LECTURE_TURNS).speaker.label === TEACHER_SPEAKER &&
    transcriptStats(LECTURE_TURNS).speaker.chosenBy === "most-tokens");

// ── 3. the phrase-bank rule, all three bands ──────────────────────────────
console.log("\n── verifyPhraseBank: teacher-sheet-spec.md §4.3, three bands ──");
const verified = verifyPhraseBank(["dekho", "theek hai", "achha"], heldOut, { teacherSpeaker: TEACHER_SPEAKER });
ok("habitual fragments verify", verified.verified && verified.failures.length === 0,
  verified.findings.map((f) => `${f.fragment}:${f.occurrences}`).join(" "));
ok("...and each cleared the spec's threshold, not some other number",
  verified.findings.every((f) => f.occurrences >= PHRASE_BANK_MIN_OCCURRENCES));

const line = verifyPhraseBank(["sanity check"], heldOut, { teacherSpeaker: TEACHER_SPEAKER });
ok("a fragment said once or twice is a LINE, not a verbalism",
  !line.verified && line.failures[0].code === "phrase-bank-is-a-line", `${line.findings[0].occurrences}x`);

const below = verifyPhraseBank(["axis"], heldOut, { teacherSpeaker: TEACHER_SPEAKER });
ok("3-4 occurrences is below threshold, and says so with its own code",
  !below.verified && below.failures[0].code === "phrase-bank-below-threshold", `${below.findings[0].occurrences}x`);

const tooLong = verifyPhraseBank(["units nahi likhe toh answer"], heldOut, { teacherSpeaker: TEACHER_SPEAKER });
ok("more than three words is rejected on SHAPE regardless of frequency",
  !tooLong.verified && tooLong.failures[0].code === "phrase-bank-too-long");

// THE HELD-OUT CONTROL — the reason this whole apparatus exists.
console.log("\n── the held-out control: an in-sample check cannot fail ──");
const inSample = verifyPhraseBank(["socho zara"], derive, { teacherSpeaker: TEACHER_SPEAKER });
const outOfSample = verifyPhraseBank(["socho zara"], heldOut, { teacherSpeaker: TEACHER_SPEAKER });
ok("'socho zara' passes comfortably against the half it was mined from",
  inSample.verified, `${inSample.findings[0].occurrences}x in-sample`);
ok("...and is REJECTED against the held-out half — so held-out is what catches it",
  !outOfSample.verified && outOfSample.failures[0].code === "phrase-bank-is-a-line",
  `${outOfSample.findings[0].occurrences}x held-out`);

// THE NO-EVIDENCE MARKER. The state a boolean cannot hold.
console.log("\n── no transcript evidence: unverified, and never a pass ──");
for (const [label, evidence] of [["undefined", undefined], ["null", null], ["empty array", []]]) {
  const none = verifyPhraseBank(["dekho"], evidence);
  ok(`${label} evidence -> verified:false with a NAMED reason`,
    none.verified === false && none.unverifiedReason === "no-transcript-evidence");
  ok(`${label} evidence -> heldOutTokens is 0, so no count is implied`, none.heldOutTokens === 0);
}
ok("the shape half still runs with no corpus (a 4-word item is still too long)",
  verifyPhraseBank(["one two three four"], null).failures[0].code === "phrase-bank-too-long");
ok("...but a short unmeasured fragment is NOT reported as failing",
  verifyPhraseBank(["dekho"], null).findings[0].code === undefined);

// ── 4. the drafter's honesty ──────────────────────────────────────────────
console.log("\n── draftFromSignals: draft ∪ gaps IS the contract ──");
const teacherInput = {
  name: "Arjun Sir",
  identityWho: DEMO_TEACHER.identityWho,
  syllabusScope: DEMO_TEACHER.syllabusScope,
  credentialFacts: DEMO_TEACHER.credentialFacts,
  strictness: 2,
  warmth: 3,
  pacePreference: "balanced",
  // the teacher's SELECTION from the candidate list — two habits and one line
  boardVerbalisms: ["dekho", "theek hai", "socho zara"],
};
const drafted = draftFromSignals(stats, teacherInput, { heldOut });

const contract = new Set(Object.keys(FIELD_SOURCE_CLASS));
const drafts = new Set(Object.keys(drafted.draft));
const gapped = new Set(drafted.gaps.map((g) => g.field));
ok("every drafted field is a contract field", [...drafts].every((f) => contract.has(f)));
ok("draft and gaps do not overlap", [...drafts].every((f) => !gapped.has(f)));
ok("draft ∪ gaps covers the whole contract, all of it",
  drafts.size + gapped.size === contract.size &&
    [...contract].every((f) => drafts.has(f) || gapped.has(f)),
  `${drafts.size} drafted + ${gapped.size} gaps = ${contract.size}`);
ok("every gap names a reason", drafted.gaps.every((g) => g.reason && g.sourceClass));
ok("every drafted field carries provenance",
  [...drafts].every((f) => drafted.provenance.some((p) => p.field === f)));
ok("deterministic: same inputs, byte-identical draft",
  JSON.stringify(draftFromSignals(stats, teacherInput, { heldOut })) === JSON.stringify(drafted));

console.log("\n── draftFromSignals: what it refuses to write ──");
ok("no register bullet is invented — the skeleton is Relational Core",
  !drafted.draft.languageVoiceRule && !drafted.draft.voiceFillers && !drafted.draft.voiceLanguageBalance);
ok("...and the MEASUREMENT behind them is published instead",
  drafted.measurements.hindiMarkerTokenRatio > 0 && drafted.measurements.topFillers.length > 0);
ok("the register bullets' gaps say so specifically",
  drafted.gaps.find((g) => g.field === "languageVoiceRule")?.reason === "measured-needs-canonical-bullet");
ok("crisisLines is never drafted, even if a teacher typed one",
  !("crisisLines" in draftFromSignals(stats, { ...teacherInput, crisisLines: "made up" }, { heldOut }).draft));
ok("FLOOR fields are gapped as platform-owned",
  ["crisisLines", "cloneDisclosureFact", "academicIntegrityStance"].every(
    (f) => drafted.gaps.find((g) => g.field === f)?.reason === "platform-floor"));
ok("TCH fields nobody typed are gapped as needing the teacher",
  drafted.gaps.find((g) => g.field === "identityLife")?.reason === "needs-teacher-input");
ok("the LLM-judgement fields are gapped as needing the qualitative pass",
  ["explanationOrder", "analogyBank", "commonMistakeBank"].every(
    (f) => drafted.gaps.find((g) => g.field === f)?.reason === "needs-qualitative-pass"));

console.log("\n── draftFromSignals: the phrase bank is PRUNED, not carried ──");
ok("the teacher's two habits survived", Array.isArray(drafted.draft.boardVerbalisms) &&
  drafted.draft.boardVerbalisms.includes("dekho") && drafted.draft.boardVerbalisms.includes("theek hai"));
ok("the LINE the teacher also picked was pruned out",
  !drafted.draft.boardVerbalisms.includes("socho zara"),
  drafted.draft.boardVerbalisms.join(", "));
ok("exSlangRepeat is derived from the same verified set, in the quoted-list shape",
  typeof drafted.draft.exSlangRepeat === "string" && drafted.draft.exSlangRepeat.startsWith('("dekho"'),
  String(drafted.draft.exSlangRepeat));
const unselected = draftFromSignals(stats, { name: "Arjun Sir" }, { heldOut });
ok("with nothing selected, the field is a GAP with the candidates waiting",
  !("boardVerbalisms" in unselected.draft) &&
    unselected.gaps.find((g) => g.field === "boardVerbalisms")?.reason === "needs-teacher-confirmation" &&
    unselected.candidates.length > 0);
const noEvidence = draftFromSignals(stats, teacherInput, {});
ok("with no held-out corpus, the field is a gap and NOT an unverified fill",
  !("boardVerbalisms" in noEvidence.draft) &&
    noEvidence.gaps.find((g) => g.field === "boardVerbalisms")?.reason === "unverified-no-held-out-evidence");

// THE NEGATIVE CONTROL. A drafter that fakes a field must be caught by the
// honesty predicate, or the predicate is measuring nothing.
console.log("\n── negative control: a drafter that FAKES a field must be caught ──");
const honest = (result) => {
  const keys = Object.keys(result.draft);
  const named = new Set(result.gaps.map((g) => g.field));
  const covered = keys.every((f) => result.provenance.some((p) => p.field === f)) &&
    keys.length + named.size === contract.size &&
    keys.every((f) => !named.has(f));
  return covered;
};
function draftFromSignalsFAKING(s, input, opts) {
  const result = draftFromSignals(s, input, opts);
  // The bug this control models is the ordinary one: a field nothing supplied,
  // filled with something plausible, and quietly removed from the gap list so
  // the sheet "looks complete". It is exactly what a pipeline sized for the
  // wrong number of fields does (teacher-sheet-spec.md §0).
  return {
    ...result,
    draft: { ...result.draft, explanationOrder: "picture → equation → limiting case → number" },
    gaps: result.gaps.filter((g) => g.field !== "explanationOrder"),
  };
}
ok("the honest drafter passes the honesty predicate", honest(drafted));
ok("the FAKING drafter is caught by it", !honest(draftFromSignalsFAKING(stats, teacherInput, { heldOut })));
// And the second half of the same control: filling a field but leaving it in
// gaps must also fail, or the predicate only checks one direction.
ok("a field both drafted AND gapped is caught too",
  !honest({ ...drafted, draft: { ...drafted.draft, identityLife: "x" } }));

// ── 5. the qualitative seam is a stub, and says so ────────────────────────
console.log("\n── the LLM qualitative pass: declared, wired to nothing ──");
const stub = createStubQualitativePass();
const proposal = await stub.propose({ turns: derive, teacherSpeaker: TEACHER_SPEAKER, fields: ["analogyBank"] });
ok("the stub returns NOTHING", proposal.proposals.length === 0);
ok("...and names why, rather than looking like an empty success",
  proposal.unavailable === "qualitative_pass_not_implemented");
let threw = "";
try { createQualitativePass(); } catch (e) { threw = e.code; }
ok("the production selector THROWS rather than silently falling back to the stub",
  threw === "qualitative_pass_unavailable");
ok("the proposable set excludes the safety floor and the private-life fields",
  !QUALITATIVE_PROPOSABLE_FIELDS.includes("crisisLines") &&
    !QUALITATIVE_PROPOSABLE_FIELDS.includes("identityLife") &&
    !QUALITATIVE_PROPOSABLE_FIELDS.includes("boardVerbalisms"));

// ── 6. the endpoint's logic, against a fake db ────────────────────────────
//
// `api/_teacher-sheet-draft.js` takes `db` as its first argument for exactly
// this reason (api/replica-claims.js's split). The fake below dispatches on
// distinctive substrings of each statement rather than on the whole SQL text,
// so reformatting a query does not break the suite while CHANGING one does.
console.log("\n── api/_teacher-sheet-draft.js: the studio endpoint's logic (no DB) ──");
const D = await import(pathToFileURL(join(REPO, "api/_teacher-sheet-draft.js")).href);

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const REPLICA = "33333333-3333-4333-8333-333333333333";
const AGENT = "44444444-4444-4444-8444-444444444444";

function fakeDb(state) {
  const calls = [];
  const db = async (sql, params) => {
    calls.push(sql);
    if (sql.includes("select r.replica_id, r.agent_id")) {
      return params[0] === REPLICA && params[1] === state.owner ? [{ replica_id: REPLICA, agent_id: state.agentId }] : [];
    }
    if (sql.includes("from vy_teacher_sheet s") && sql.includes("join vy_replica r on r.agent_id")) {
      return params[1] === state.owner && state.row ? [state.row] : [];
    }
    if (sql.includes("insert into vy_teacher_sheet") || sql.includes("update vy_teacher_sheet s\n          set sheet")) {
      if (params[1] !== state.owner) return [];
      state.row = {
        sheet_id: state.row?.sheet_id ?? "55555555-5555-4555-8555-555555555555",
        agent_id: state.agentId,
        version: params[3],
        sheet: JSON.parse(params[2]),
        status: "draft",
        consent_artifact_id: state.row?.consent_artifact_id ?? null,
        created_at: "2026-08-26T00:00:00Z",
        updated_at: "2026-08-26T01:00:00Z",
        published_at: null,
      };
      return [state.row];
    }
    if (sql.includes("set status = 'published'")) {
      // The SQL consent predicate, honoured by the fake — it is the third
      // layer migration 051 describes, and a fake that ignored it would let
      // this suite report a publish the database would have refused.
      if (params[1] !== state.owner || !state.row?.consent_artifact_id) return [];
      state.row = { ...state.row, status: "published", published_at: "2026-08-26T02:00:00Z" };
      return [state.row];
    }
    return [];
  };
  db.calls = calls;
  return db;
}

// GET
{
  const state = { owner: OWNER, agentId: AGENT, row: null };
  const db = fakeDb(state);
  ok("GET on an owned replica with no sheet yet -> an EMPTY draft, not a 404",
    (await D.readOwnedTeacherSheet(db, OWNER, REPLICA))?.draft === null);
  ok("GET on someone else's replica -> null, indistinguishable from not existing",
    (await D.readOwnedTeacherSheet(db, OTHER, REPLICA)) === null);
  ok("every statement carried owner_user_id in its predicate",
    db.calls.every((sql) => sql.includes("owner_user_id = $2")));
}

// save_draft
{
  const state = { owner: OWNER, agentId: AGENT, row: null };
  const db = fakeDb(state);
  const incomplete = { slug: "teacher-x", name: "X" };
  const saved = await D.saveOwnedTeacherSheetDraft(db, OWNER, REPLICA, incomplete);
  ok("an INCOMPLETE draft is still saved", saved.sheet.draft?.name === "X");
  ok("...and comes back ok:false with structured field errors the studio can render",
    saved.ok === false && saved.errors.length > 0 &&
      saved.errors.every((e) => typeof e.field === "string" && typeof e.code === "string"),
    `${saved.errors.length} errors`);
  ok("the errors NAME the fields, not the sheet",
    saved.errors.some((e) => e.field === "boundaryParagraph" && e.code === "arc-override-missing"));

  const complete = await D.saveOwnedTeacherSheetDraft(db, OWNER, REPLICA, DEMO_TEACHER);
  ok("a complete sheet saves with ok:true and no errors", complete.ok && complete.errors.length === 0);
  ok("updated_at rides on the response (the field the client already declares)",
    !!complete.sheet.updated_at);
  ok("the consent artifact's uuid never leaves the server",
    complete.sheet.consent_artifact_id === null || complete.sheet.consent_artifact_id === "present");
  ok("saving someone else's replica -> null, no write",
    (await D.saveOwnedTeacherSheetDraft(db, OTHER, REPLICA, DEMO_TEACHER)) === null);

  let code = "";
  try { await D.saveOwnedTeacherSheetDraft(db, OWNER, "not-a-uuid", DEMO_TEACHER); } catch (e) { code = e.code; }
  ok("a malformed replica_id is refused before any query", code === "valid_replica_id_required");
  try { await D.saveOwnedTeacherSheetDraft(db, OWNER, REPLICA, "["); } catch (e) { code = e.code; }
  ok("an unparseable sheet body is refused as itself, not as 90 missing fields",
    code === "sheet_unparseable");
}

// publish — fails closed
{
  const state = { owner: OWNER, agentId: AGENT, row: null };
  const db = fakeDb(state);
  await D.saveOwnedTeacherSheetDraft(db, OWNER, REPLICA, DEMO_TEACHER);

  const noConsent = await D.publishOwnedTeacherSheet(db, OWNER, REPLICA);
  ok("publish with no consent artifact -> blocked, and it names the blocker",
    !noConsent.ok && noConsent.blockers.includes("consent_artifact_missing"),
    noConsent.blockers.join(", "));
  ok("...and the row did not move", state.row.status === "draft");

  // Consent arrives (the replica lab's lane writes this column, not this one).
  state.row.consent_artifact_id = "b1000000-0000-4000-8000-000000000001";
  const published = await D.publishOwnedTeacherSheet(db, OWNER, REPLICA);
  ok("publish with consent + a valid sheet -> published", published.ok && published.sheet.status === "published");
  ok("...and the phrase bank is reported UNVERIFIED, not passed",
    published.phraseBank.verified === false &&
      published.phraseBank.unverifiedReason === "no-transcript-evidence");

  ok("publishing someone else's replica -> null", (await D.publishOwnedTeacherSheet(db, OTHER, REPLICA)) === null);
}

// publish — with evidence, the ≥5 rule is a gate
{
  const state = { owner: OWNER, agentId: AGENT, row: null };
  const db = fakeDb(state);
  const habitual = { ...DEMO_TEACHER, boardVerbalisms: ["dekho", "theek hai"], exSlangRepeat: '("achha")' };
  await D.saveOwnedTeacherSheetDraft(db, OWNER, REPLICA, habitual);
  state.row.consent_artifact_id = "b1000000-0000-4000-8000-000000000001";

  const withEvidence = await D.publishOwnedTeacherSheet(db, OWNER, REPLICA, {
    evidence: { transcript: LECTURE_TURNS, teacherSpeaker: TEACHER_SPEAKER },
  });
  ok("evidence + genuinely habitual verbalisms -> published, phrase bank VERIFIED",
    withEvidence.ok && withEvidence.phraseBank.verified === true,
    `${withEvidence.phraseBank.heldOutTokens} held-out tokens`);
}
{
  const state = { owner: OWNER, agentId: AGENT, row: null };
  const db = fakeDb(state);
  // The same sheet with one LINE smuggled into the phrase bank. Its shape is
  // legal (two words, no terminal punctuation) so `validateTeacherSheet` has
  // nothing to say about it — only the corpus can tell.
  const withLine = { ...DEMO_TEACHER, boardVerbalisms: ["dekho", "socho zara"] };
  await D.saveOwnedTeacherSheetDraft(db, OWNER, REPLICA, withLine);
  state.row.consent_artifact_id = "b1000000-0000-4000-8000-000000000001";

  const blocked = await D.publishOwnedTeacherSheet(db, OWNER, REPLICA, {
    evidence: { transcript: LECTURE_TURNS, teacherSpeaker: TEACHER_SPEAKER },
  });
  ok("a LINE in the phrase bank BLOCKS the publish once evidence exists",
    !blocked.ok && blocked.errors.some((e) => e.code === "phrase-bank-is-a-line"),
    blocked.errors.map((e) => `${e.field}:${e.code}`).join(", "));
  ok("...the error names the field and the count", blocked.errors.some(
    (e) => e.field === "boardVerbalisms" && String(e.detail).includes("socho zara")));
  ok("...and the row stayed a draft", state.row.status === "draft");
  // The control: the same sheet, the same gate, no evidence.
  const unblocked = await D.publishOwnedTeacherSheet(db, OWNER, REPLICA);
  ok("without evidence the same sheet publishes — and is marked unverified, never verified",
    unblocked.ok && unblocked.phraseBank.unverifiedReason === "no-transcript-evidence");
}

// the dry run
{
  const verdict = D.validateSheetBody(DEMO_TEACHER, { transcript: LECTURE_TURNS, teacherSpeaker: TEACHER_SPEAKER });
  ok("validate is a dry run: a verdict with no write and no db argument at all",
    typeof verdict.ok === "boolean" && Array.isArray(verdict.errors));
  ok("the demo teacher's placeholder consent blocks it there too",
    verdict.blockers.includes("consent_artifact_placeholder"));
  ok("evidence handed to validate produces real stats for the studio to render",
    D.statsForEvidence({ transcript: LECTURE_TURNS, teacherSpeaker: TEACHER_SPEAKER })?.tokens > 0);
  ok("no evidence -> no stats, rather than an empty-looking measurement",
    D.statsForEvidence({}) === null);
}

console.log(fail ? `\n${fail} of ${pass + fail} FAILURES` : `\nALL ${pass} CHECKS PASS`);
process.exitCode = fail ? 1 : 0;
