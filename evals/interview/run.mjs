// The interview — WS-R5. `node evals/interview/run.mjs`
//
// Offline, deterministic, $0, no database, no network, no model call, no
// credential. It drives the REAL gap model (api/_interview-gaps.js), the REAL
// store statements (api/_interview-store.js) against a fake database that
// routes on statement SHAPE, the REAL prompt splice (api/_mirrorcall-reply.js)
// and the REAL person-model builder (api/_person-model.js).
//
// ── what this suite exists to gate ───────────────────────────────────────
//
// 1. THE RANKING IS THE PRODUCT. An interview has five questions and twenty
//    minutes, so which five is the whole feature. §1 asserts the three
//    orderings the brief names — a contradiction outranks everything, a sheet
//    field with NO evidence outranks one with some, and a thinly covered topic
//    produces a gap where a well covered one produces none.
//
// 2. NO QUOTABLE SENTENCE REACHES THE PROMPT. `recited-prompt` is measured
//    twice on this codebase (example quotes recited on 4/5 turns; taste written
//    as polished sentences read out verbatim twice, eight turns apart). An
//    interview question is the single most recitable object this feature could
//    produce, so §2 runs `src/engine/shapelint.ts`'s OWN `lintLine` over every
//    line of every ask block the model can generate, including the ones built
//    out of the owner's own claim bodies. The lint is bundled from the real
//    TypeScript on every run, not frozen.
//
// 3. THE DETECTOR THAT COULD NOT RUN SAYS SO. §5 is the negative control the
//    brief asks for and it is the point of the file: the same assertion that
//    passes with the contradiction detector wired MUST FAIL with it disabled,
//    and the payload must report `detectors.contradiction === false` rather
//    than an empty list that reads as "no contradictions found".
//
// 4. AN ANSWER BECOMES A SOURCE AND NOTHING ELSE MOVES.
//    `mirror-reference-accumulation-was-inert`: a growing pool is not a
//    changing clone. §4 asserts the answer write stamps a source and that NO
//    statement this lane issues names `vy_teacher_sheet`,
//    `vy_mirror_conditioning` or `vy_mirror_finetune_job`.
//
// 5. THE REGISTER INPUT IS ACTUALLY READ. §6 drives the person-model builder
//    with the same claims twice, once with the interview source ids and once
//    without, and fails unless the two differ. A builder that ignored the
//    argument would pass every other assertion in this file.
//
// ── what it CANNOT see ───────────────────────────────────────────────────
// SQL types and referential integrity. `offline-mocks-cannot-type-check-sql`:
// a mock cannot even tell you the statement parses. Migration 075 is UNAPPLIED
// and no statement added by this workstream has ever executed against a
// database. Said out loud here rather than implied by a green line.
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const load = (rel) => import(pathToFileURL(join(REPO, rel)).href);

let failed = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (cond) return true;
  failed++;
  console.log(`  FAIL ${what}`);
  return false;
};
const eq = (a, b, what) =>
  ok(Object.is(a, b), `${what} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ── the real shape lint, bundled from the real TypeScript ─────────────────
// `evals/mirrorcall.mjs`'s pattern and CLAUDE.md's reason: a frozen bundle
// passes forever while the source rots. This one matters more than most,
// because the property it proves (no line in an ask block is sentence-shaped)
// is only as true as the definition of "sentence-shaped" that is actually
// shipping.
const OUT = mkdtempSync(join(tmpdir(), "interview-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(
  ENTRY,
  `export { lintLine } from ${JSON.stringify(join(REPO, "src/engine/shapelint"))};\n`,
);
const BUNDLE = join(OUT, "interview.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error ` +
    `--alias:@capacitor/core=${join(REPO, "evals/stubs/capacitor.mjs")}`,
  { cwd: REPO, stdio: "inherit" },
);
const { lintLine } = await import(pathToFileURL(BUNDLE).href);

const gaps = await load("api/_interview-gaps.js");
const store = await load("api/_interview-store.js");
const reply = await load("api/_mirrorcall-reply.js");
const person = await load("api/_person-model.js");
const engine = await load("api/_engine.gen.js").catch(() => null);

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STRANGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REPLICA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MIRROR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const WINDOW = "11111111-1111-4111-8111-111111111111";
const SOURCE_A = "44444444-4444-4444-8444-444444444441";
const SOURCE_B = "44444444-4444-4444-8444-444444444442";

// The overlap predicate the real handler injects, from the real engine bundle.
// A build without it is a build where the contradiction detector CANNOT run,
// which is exactly the state §5 controls for.
const overlaps = typeof engine?.validityOverlaps === "function" ? engine.validityOverlaps : null;

const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString();
const NOW = Date.UTC(2026, 8, 3);

let nextClaim = 1;
const claim = (over = {}) => ({
  claim_id: String(nextClaim++),
  domain: "biography",
  key: "topic",
  body: "something",
  origin: "self_declared",
  confidence: 0.8,
  status: "approved",
  decision: "accepted",
  source_ids: [SOURCE_B],
  t_valid_from: null,
  t_valid_to: null,
  created_at: iso(2026, 1, 1),
  updated_at: iso(2026, 1, 1),
  ...over,
});

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 1. the ranking is the product ──");
// ═════════════════════════════════════════════════════════════════════════

// Two claims on ONE subject, with disjoint event-time horizons and different
// bodies. `src/engine/validity.ts`: two rows named `exam` in November and in
// May are two exams; two rows on one subject whose horizons do not overlap and
// whose bodies differ are a CHANGE this platform cannot date itself.
const CONTRADICTION = [
  claim({
    domain: "event", key: "exam date", body: "neet pg in november",
    t_valid_from: iso(2026, 3, 1), t_valid_to: iso(2026, 4, 1), updated_at: iso(2026, 3, 1),
  }),
  claim({
    domain: "event", key: "exam date", body: "neet pg in may",
    t_valid_from: iso(2026, 8, 20), t_valid_to: iso(2026, 12, 1), updated_at: iso(2026, 8, 20),
  }),
];

// A sheet whose `exComfort` is filled (one piece of evidence) and whose
// `exDontKnow` is empty (none). Everything else on the sheet is absent, which
// is the ordinary pre-interview state.
const SHEET = {
  exComfort: "sits with it first",
  subjectStrands: ["rotational motion", "thermodynamics"],
};

// `rotational motion` is well covered: three things name it. `thermodynamics`
// is named by nothing.
const COVERED = [
  claim({ domain: "preference", key: "rotational motion", body: "rotational motion is where they lose marks" }),
  claim({ domain: "value", key: "teaching", body: "rotational motion first, always" }),
];
const SPANS = [{ source_id: SOURCE_A, topic: "rotational motion", title: "rotational motion, lecture 4" }];

const base = {
  claims: [...CONTRADICTION, ...COVERED],
  sheet: SHEET,
  transcriptSpans: SPANS,
  contextItems: [],
  now: NOW,
};

const model = gaps.buildInterviewGaps(base, { overlaps });

// The three orderings, each as its own predicate so §5 can re-run the first one
// against the disabled fixture.
const contradictionRanksFirst = (m) => m.gaps[0]?.kind === "contradiction";
ok(contradictionRanksFirst(model), "a contradiction ranks first");
ok(overlaps !== null, "the overlap predicate came from the real engine bundle (without it §1 proves nothing)");

const sheetGaps = model.gaps.filter((g) => g.kind === "sheet_field");
const zero = sheetGaps.find((g) => g.evidence_count === 0);
const some = sheetGaps.find((g) => g.evidence_count > 0);
ok(Boolean(zero), "a sheet field with no evidence produces a gap");
ok(Boolean(some), "a sheet field with SOME evidence still produces a gap while it is under the floor");
ok(Boolean(zero && some) && zero.rank < some.rank,
  "a sheet gap with zero evidence ranks above one with some");
eq(some?.evidence_count, 1, "the filled field counts its one piece of evidence rather than reporting none");

const topicGaps = model.gaps.filter((g) => g.kind === "thin_topic");
const thin = topicGaps.find((g) => g.topic.includes("thermodynamics"));
ok(Boolean(thin), "a thinly covered topic produces a gap");
ok(!topicGaps.some((g) => g.topic.includes("rotational")),
  "a well covered topic produces NO gap (thin beats covered)");
ok(Boolean(thin) && model.gaps.filter((g) => g.kind === "sheet_field").every((g) => g.rank < thin.rank),
  "every sheet-field gap outranks a thin-topic gap");

// Two thin topics, one thinner. The thinner has to come first or the ranking is
// not reading its own evidence count.
const twoThin = gaps.buildInterviewGaps({
  ...base,
  sheet: { ...SHEET, subjectStrands: ["optics", "magnetism"] },
  claims: [...CONTRADICTION, claim({ domain: "preference", key: "optics", body: "optics is fine" })],
  transcriptSpans: [],
}, { overlaps });
const optics = twoThin.gaps.find((g) => g.topic.includes("optics"));
const magnetism = twoThin.gaps.find((g) => g.topic.includes("magnetism"));
ok(Boolean(optics && magnetism) && magnetism.rank < optics.rank,
  "between two thin topics the thinner one ranks higher");

// Readiness. Three plausible row shapes are accepted; an unrecognised one
// produces NO gap rather than a guessed one.
for (const [label, readiness] of [
  ["array of {part,score}", { parts: [{ part: "mind", score: 0.2 }, { part: "relation", score: 0.9 }] }],
  ["object of part->score", { part_scores: { mind: 0.2, relation: 0.9 } }],
  ["scores alias", { scores: { mind: 0.2, relation: 0.9 } }],
]) {
  const m = gaps.buildInterviewGaps({ ...base, readiness }, { overlaps });
  const row = m.gaps.find((g) => g.kind === "readiness");
  ok(Boolean(row), `a readiness snapshot shaped as ${label} produces the weakest part's gap`);
  eq(row?.detail?.part, "mind", `and it names the weakest part (${label})`);
}
const unknownShape = gaps.buildInterviewGaps({ ...base, readiness: { overall: 61, note: "hi" } }, { overlaps });
ok(!unknownShape.gaps.some((g) => g.kind === "readiness"),
  "a readiness row in an unrecognised shape produces NO gap rather than a guessed one");
eq(unknownShape.detectors.readiness, false,
  "and the payload says the readiness detector did not run, rather than that readiness is fine");

// A part an interview cannot move (voice) is not turned into a question.
const voiceWeakest = gaps.buildInterviewGaps({
  ...base, readiness: { parts: [{ part: "voice", score: 0.05 }] },
}, { overlaps });
ok(!voiceWeakest.gaps.some((g) => g.kind === "readiness"),
  "a readiness part an interview cannot move (voice) produces no question");

// The opening is five, and it is the top five.
ok(model.opening.length <= gaps.INTERVIEW_OPENING_GAPS, "the opening is at most five gaps");
ok(model.opening.every((g, i) => g.rank === i + 1), "the opening is the top of the ranking, in order");

// Answered shapes are not re-asked.
const answeredAgain = gaps.buildInterviewGaps(
  { ...base, answeredShapeHashes: [model.gaps[0].shape_hash] },
  { overlaps },
);
ok(!answeredAgain.gaps.some((g) => g.shape_hash === model.gaps[0].shape_hash),
  "a shape answered in an earlier interview is not asked again");
eq(answeredAgain.skipped_answered, 1, "and the count of what was skipped is reported");

// Determinism. An interview that ranked differently on a re-open would be an
// interview nobody could reproduce, and migration 075 freezes the list on the
// strength of this.
const again = gaps.buildInterviewGaps(base, { overlaps });
eq(JSON.stringify(again.gaps), JSON.stringify(model.gaps),
  "the ranking is byte-identical on a re-run over the same rows");

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 2. no quotable sentence reaches the prompt ──");
// ═════════════════════════════════════════════════════════════════════════

// Every gap this fixture space can produce, including the readiness ones and
// the contradiction built out of the owner's own claim bodies.
const everyGap = [
  ...model.gaps,
  ...twoThin.gaps,
  ...gaps.buildInterviewGaps({ ...base, readiness: { parts: [
    { part: "mind", score: 0.1 }, { part: "relation", score: 0.2 },
    { part: "memory", score: 0.3 }, { part: "safety", score: 0.4 },
  ] } }, { overlaps }).gaps,
];
ok(everyGap.length >= 8, "the lint runs over a real spread of gaps, not one");

let lintFailures = 0;
for (const gap of everyGap) {
  const block = gaps.renderInterviewAsk(gap);
  ok(block.length > 0, `every gap renders an ask block (${gap.kind}/${gap.topic})`);
  for (const line of block.split("\n")) {
    const report = lintLine(line.replace(/^- /, ""));
    if (report.reasons.length) {
      lintFailures += 1;
      console.log(`  FAIL shapelint on "${line}": ${report.reasons.join("; ")}`);
    }
  }
}
eq(lintFailures, 0, "every line of every ask block passes the REAL shapelint line rules");

// The `why` copy is UI prose and is deliberately sentence-shaped. It must not
// be in the block: if it were, the block would carry lines a model can recite.
for (const gap of everyGap) {
  const block = gaps.renderInterviewAsk(gap);
  ok(!block.includes(gap.why), `the owner-facing "why" prose never enters the ask block (${gap.kind})`);
}

// The contradiction's cited values are FRAGMENTS. A sentence-shaped claim body
// is the case that matters, because a real claim body often is one.
const sentenceBody = gaps.buildInterviewGaps({
  ...base,
  claims: [
    claim({
      domain: "event", key: "exam date",
      body: "My NEET PG attempt is in November and I have told everyone that already, so please stop asking me about it!",
      t_valid_from: iso(2026, 3, 1), t_valid_to: iso(2026, 4, 1),
    }),
    claim({
      domain: "event", key: "exam date",
      body: "It moved. The exam is in May now.",
      t_valid_from: iso(2026, 8, 20), t_valid_to: iso(2026, 12, 1),
    }),
  ],
}, { overlaps });
const cited = sentenceBody.gaps.find((g) => g.kind === "contradiction");
ok(Boolean(cited), "a contradiction is still found when both claim bodies are full sentences");
const citedBlock = gaps.renderInterviewAsk(cited);
ok(!/[.!?]/.test(citedBlock.replace(gaps.INTERVIEW_ASK_HEADER, "")),
  "no terminal punctuation survives into a cited value, so nothing in the block is sentence-shaped");
for (const line of citedBlock.split("\n")) {
  eq(lintLine(line.replace(/^- /, "")).reasons.length, 0,
    `a sentence-shaped claim body still lints clean once cited: "${line}"`);
}
ok(gaps.citationFragment("really?!") === "really", "terminal punctuation is stripped repeatedly, not once");
ok(gaps.citationFragment("one. two.") === "one", "an interior sentence break keeps the first clause only");

// The module contains no question text at all. A grep-shaped assertion, because
// the law is about the SOURCE as much as the output: a question written here is
// a question one edit away from a prompt.
const gapSrc = readFileSync(join(REPO, "api/_interview-gaps.js"), "utf8");
const codeOnly = gapSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
ok(!/["'`][^"'`\n]*\?["'`]/.test(codeOnly),
  "no string literal in the gap model ends in a question mark");

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 3. the ask block goes where the compiler leaves room ──");
// ═════════════════════════════════════════════════════════════════════════
//
// `prompt-position` is measured: an identical rule fired 0/8 mid-brief and 8/8
// appended last. The appended-last set is CLOSED AT TWO, so the ask goes
// immediately before it — exactly where compiler.ts puts T16 and T19.

const FORGET = "\n\nFORGET_DECISION_BLOCK";
const compiled = { core: "CORE", tail: `T1\n\nT16${FORGET}`, system: `CORET1\n\nT16${FORGET}` };
const agentModule = { FORGET_DECISION: FORGET };
const ask = gaps.renderInterviewAsk(model.gaps[0]);

const spliced = reply.spliceInterviewAsk(compiled, agentModule, ask);
ok(spliced !== null, "the ask splices into a well-formed tail");
ok(spliced.tail.endsWith(FORGET), "FORGET_DECISION is still the tail's literal suffix");
ok(spliced.tail.includes(ask), "the ask block is in the tail");
ok(spliced.tail.indexOf(ask) < spliced.tail.lastIndexOf(FORGET),
  "the ask sits BEFORE the appended-last set, never after it");
eq(spliced.system, `${compiled.core}${spliced.tail}`, "the system string is rebuilt from the spliced tail");
eq(reply.spliceInterviewAsk(compiled, agentModule, "")?.tail, compiled.tail,
  "an empty ask leaves a calibration call's prompt byte-identical");

// NEGATIVE CONTROL. A tail that does not end where the compiler says it ends is
// REFUSED. Appending after FORGET_DECISION would break the position law of the
// whole persona on a lane nobody re-reads, so the honest answer is no turn.
eq(reply.spliceInterviewAsk({ core: "C", tail: "T1\n\nT16" }, agentModule, ask), null,
  "NEGATIVE CONTROL: a tail not ending in FORGET_DECISION is refused, never appended to");
eq(reply.spliceInterviewAsk(compiled, {}, ask), null,
  "NEGATIVE CONTROL: an agent with no FORGET_DECISION is refused rather than guessed at");
ok(reply.MIRROR_TURN_ABSENT_REASONS.includes("interview_ask_unplaceable"),
  "and the refusal has a named reason in the frozen vocabulary");

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 4. the session lifecycle, and what an answer becomes ──");
// ═════════════════════════════════════════════════════════════════════════

function fakeDb(seed = {}) {
  const state = {
    mirror: [{
      session_id: MIRROR, replica_id: REPLICA, owner_user_id: OWNER,
      policy_version: "p1", state: seed.mirrorState ?? "open",
    }],
    interviews: [],
    answers: [],
    sources: [
      { source_id: SOURCE_A, replica_id: REPLICA, owner_user_id: OWNER, purpose: "memory" },
      // Another replica's source, same owner. The join is what refuses it, and
      // a fake that did not model it could not prove that.
      { source_id: SOURCE_B, replica_id: "99999999-9999-4999-8999-999999999999", owner_user_id: OWNER, purpose: "memory" },
    ],
    statements: [],
    unmatched: [],
  };
  const db = async (sql, params) => {
    state.statements.push(sql);
    const has = (f) => sql.includes(f);

    // recordInterviewAnswer — matched FIRST because its statement contains the
    // discriminators of the smaller reads it joins.
    // `mirror-fake-db-matched-a-session-instead-of-a-decision`: a large
    // statement contains the phrases of every small one inside it.
    if (has("update vy_replica_source s set purpose = 'interview'")) {
      const [iid, owner, sourceId, answerId, kind, topic, hash, windowId] = params;
      const iv = state.interviews.find((i) => i.session_id === iid && i.owner_user_id === owner && !i.ended_at);
      if (!iv) return [];
      const src = state.sources.find((s) =>
        s.source_id === sourceId && s.replica_id === iv.replica_id && s.owner_user_id === owner);
      if (src) src.purpose = "interview";
      if (state.answers.some((a) => a.session_id === iid && a.question_shape_hash === hash)) return [];
      const row = {
        answer_id: answerId, session_id: iid, replica_id: iv.replica_id, owner_user_id: owner,
        gap_kind: kind, topic, question_shape_hash: hash,
        source_id: src ? src.source_id : null, window_id: windowId,
        created_at: new Date().toISOString(),
      };
      state.answers.push(row);
      iv.answers_captured += 1;
      return [row];
    }

    if (has("insert into vy_interview_session")) {
      const [msid, owner, iid, payload] = params;
      const mirror = state.mirror.find((m) =>
        m.session_id === msid && m.owner_user_id === owner && m.state === "open");
      if (!mirror) return [];
      if (state.interviews.some((i) => i.mirror_session_id === msid)) return [];
      const row = {
        session_id: iid, replica_id: mirror.replica_id, owner_user_id: owner,
        mirror_session_id: msid, policy_version: mirror.policy_version,
        started_at: new Date(seed.startedAt ?? Date.now()).toISOString(), ended_at: null,
        gaps: JSON.parse(payload), questions_asked: 0, answers_captured: 0,
        updated_at: new Date().toISOString(),
      };
      state.interviews.push(row);
      return [row];
    }

    if (has("set questions_asked = i.questions_asked + 1")) {
      const [iid, owner] = params;
      const iv = state.interviews.find((i) => i.session_id === iid && i.owner_user_id === owner && !i.ended_at);
      if (!iv) return [];
      iv.questions_asked += 1;
      return [iv];
    }

    if (has("set ended_at = now()")) {
      const [iid, owner] = params;
      const iv = state.interviews.find((i) => i.session_id === iid && i.owner_user_id === owner && !i.ended_at);
      if (!iv) return [];
      iv.ended_at = new Date().toISOString();
      return [iv];
    }

    if (has("select distinct a.question_shape_hash")) {
      const [rid, owner] = params;
      return state.answers
        .filter((a) => a.replica_id === rid && a.owner_user_id === owner)
        .map((a) => ({ question_shape_hash: a.question_shape_hash }));
    }

    if (has("from vy_interview_answer a")) {
      const [iid, owner] = params;
      return state.answers.filter((a) => a.session_id === iid && a.owner_user_id === owner);
    }

    if (has("from vy_interview_session i")) {
      const [msid, owner] = params;
      const iv = state.interviews.find((i) => i.mirror_session_id === msid && i.owner_user_id === owner);
      return iv ? [iv] : [];
    }

    if (has("s.purpose = 'interview'")) {
      const [rid, owner] = params;
      return state.sources
        .filter((s) => s.replica_id === rid && s.owner_user_id === owner && s.purpose === "interview")
        .map((s) => ({ source_id: s.source_id }));
    }

    state.unmatched.push(sql);
    throw new Error(`unmatched statement: ${sql.slice(0, 120)}`);
  };
  return { db, state };
}

{
  const { db, state } = fakeDb();
  const opened = await store.openInterviewSession(db, OWNER, MIRROR, model.opening);
  ok(Boolean(opened), "an interview opens on an OPEN mirror session");
  eq(opened.gaps.length, model.opening.length, "the gap list is frozen onto the row at open");
  eq(opened.questions_asked, 0, "no question has been asked yet");

  // Re-opening resumes rather than duplicating. A studio reconnecting after a
  // dropped socket must find its own interview.
  const resumed = await store.openInterviewSession(db, OWNER, MIRROR, model.opening);
  eq(resumed.interview_id, opened.interview_id, "a second open RESUMES the same interview");
  eq(state.interviews.length, 1, "and does not create a second row");

  // A stranger holding the session id gets nothing.
  eq(await store.openInterviewSession(db, STRANGER, MIRROR, model.opening), null,
    "a stranger holding the mirror session id cannot open an interview on it");
  eq(await store.getInterviewByMirrorSession(db, STRANGER, MIRROR), null,
    "and cannot read one");

  await store.markQuestionAsked(db, OWNER, opened.interview_id);
  const asked = await store.getInterviewByMirrorSession(db, OWNER, MIRROR);
  eq(asked.questions_asked, 1, "asking a question is counted");
  eq(asked.answers_captured, 0, "and answering is a separate fact");

  const gap = model.opening[0];
  const answer = await store.recordInterviewAnswer(db, OWNER, opened.interview_id, {
    gapKind: gap.kind, topic: gap.topic, questionShapeHash: gap.shape_hash,
    sourceId: SOURCE_A, windowId: WINDOW,
  });
  ok(Boolean(answer), "an answer is recorded");
  eq(answer.audio_kept, true, "and it kept its audio");
  eq(state.sources.find((s) => s.source_id === SOURCE_A).purpose, "interview",
    "THE ANSWER BECOMES A SOURCE: the captured window is stamped purpose=interview");

  const counted = await store.getInterviewByMirrorSession(db, OWNER, MIRROR);
  eq(counted.answers_captured, 1, "the answer count moved");
  eq(counted.open_gaps, counted.gaps.length - 1, "and the open-gap arithmetic follows it");

  // Idempotence. A retried window against an already answered gap must change
  // NOTHING, including the count — `mirror-call-nul-in-a-template-literal`'s
  // lesson: an idempotence assertion is the only instrument that can see a
  // silent double-write.
  const retry = await store.recordInterviewAnswer(db, OWNER, opened.interview_id, {
    gapKind: gap.kind, topic: gap.topic, questionShapeHash: gap.shape_hash,
    sourceId: SOURCE_A, windowId: WINDOW,
  });
  eq(retry, null, "a retried answer against the same shape inserts nothing");
  eq((await store.getInterviewByMirrorSession(db, OWNER, MIRROR)).answers_captured, 1,
    "and the count does not double");

  // A source belonging to a DIFFERENT replica is refused by the join, so the
  // answer lands with no audio rather than with somebody else's material.
  const second = model.opening[1];
  const crossReplica = await store.recordInterviewAnswer(db, OWNER, opened.interview_id, {
    gapKind: second.kind, topic: second.topic, questionShapeHash: second.shape_hash,
    sourceId: SOURCE_B, windowId: WINDOW,
  });
  eq(crossReplica.source_id, null, "a source from another replica is refused rather than attached");
  eq(crossReplica.audio_kept, false, "and the answer reports the loss instead of hiding it");
  eq(state.sources.find((s) => s.source_id === SOURCE_B).purpose, "memory",
    "and that other replica's source is NOT stamped");

  eq((await store.interviewSourceIds(db, OWNER, REPLICA)).length, 1,
    "the register lane finds exactly the stamped source");
  eq((await store.interviewSourceIds(db, STRANGER, REPLICA)).length, 0,
    "and a stranger finds none");

  const ended = await store.endInterviewSession(db, OWNER, opened.interview_id);
  ok(Boolean(ended?.ended_at), "the interview ends");
  eq(await store.endInterviewSession(db, OWNER, opened.interview_id), null,
    "and a second end is a no-op rather than a second close");

  eq(state.unmatched.length, 0, "every statement this lane issued was matched by the fake");

  // NOTHING IN THIS LANE TOUCHES THE PERSONA OR THE VOICE.
  // `mirror-reference-accumulation-was-inert`: interview answers grow the
  // SOURCE set, and a lane that could write a sheet field or a conditioning
  // selection would be claiming an effect the mechanism does not have.
  for (const forbidden of ["vy_teacher_sheet", "vy_mirror_conditioning", "vy_mirror_finetune_job", "vy_replica_profile"]) {
    ok(!state.statements.some((s) => s.includes(forbidden)),
      `no statement in the interview lane names ${forbidden}`);
  }
}

{
  // A CLOSED mirror session cannot host an interview.
  const { db } = fakeDb({ mirrorState: "ended" });
  eq(await store.openInterviewSession(db, OWNER, MIRROR, model.opening), null,
    "an interview cannot open on an ended mirror session");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 5. THE NEGATIVE CONTROL: a detector that could not run ──");
// ═════════════════════════════════════════════════════════════════════════
//
// The brief's own requirement, and the shape `mirrorcallreply.mjs` §5
// established: a suite that only asserts the good path proves nothing about
// the rule, because the good path was already right.

const noDetector = gaps.buildInterviewGaps(base, {});
ok(!contradictionRanksFirst(noDetector),
  "NEGATIVE CONTROL: with the contradiction detector disabled, the §1 assertion FAILS");
ok(!noDetector.gaps.some((g) => g.kind === "contradiction"),
  "and no contradiction gap is invented without the predicate that finds one");
eq(noDetector.detectors.contradiction, false,
  "and the payload says the DETECTOR did not run, not that there are no contradictions");
eq(model.detectors.contradiction, true,
  "while the wired model says the detector did run, so the two are distinguishable");
ok(noDetector.gaps.length > 0,
  "the rest of the list still builds, so a missing predicate degrades rather than blanks");

// The same shape one level down: overlapping validity is NOT a contradiction.
// Two rows named `exam` for November and May are two exams, and superseding or
// questioning the first would delete a real fact.
const overlapping = gaps.buildInterviewGaps({
  ...base,
  claims: [
    claim({ domain: "event", key: "exam date", body: "neet pg in november", t_valid_from: iso(2026, 3, 1), t_valid_to: iso(2026, 12, 1) }),
    claim({ domain: "event", key: "exam date", body: "neet pg in may", t_valid_from: iso(2026, 4, 1), t_valid_to: iso(2027, 5, 1) }),
  ],
}, { overlaps });
ok(!overlapping.gaps.some((g) => g.kind === "contradiction"),
  "two dated claims whose horizons OVERLAP are two facts, not a contradiction");

// A rejected claim is not evidence, in either direction.
const rejected = gaps.buildInterviewGaps({
  ...base,
  claims: CONTRADICTION.map((row) => ({ ...row, decision: "rejected" })),
}, { overlaps });
ok(!rejected.gaps.some((g) => g.kind === "contradiction"),
  "claims the owner rejected cannot contradict each other");

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 6. the dialogue register, and the control that proves it is read ──");
// ═════════════════════════════════════════════════════════════════════════

// A claim set that clears `personModelReadiness` so the builder will run at all.
const READY = [
  claim({ domain: "identity", key: "self_name", body: "Arjun", source_ids: [SOURCE_A] }),
  claim({ domain: "language", key: "languages", body: "hindi, english", source_ids: [SOURCE_B] }),
  claim({ domain: "habit", key: "humor", body: "dry", source_ids: [SOURCE_A] }),
  claim({ domain: "boundary", key: "refusal", body: "no medical advice", source_ids: [SOURCE_B] }),
];

const withIds = person.buildPersonModelDefinition(READY, NOW, { interviewSourceIds: [SOURCE_A] });
const withoutIds = person.buildPersonModelDefinition(READY, NOW);

ok(withIds.speech.dialogue_register !== undefined,
  "the person model always carries a dialogue-register block");
eq(withIds.speech.dialogue_register.sources, 1, "it counts the interview sources it was given");
eq(withIds.speech.dialogue_register.claims.length, 2,
  "and lists exactly the claims that came from one");
ok(withIds.speech.dialogue_register.claims.every((c) => ["identity", "habit"].includes(c.domain)),
  "and no claim from a non-interview source is in it");

// THE CONTROL. A builder that ignored the argument would produce the same block
// both ways and every other assertion here would still pass.
eq(withoutIds.speech.dialogue_register.sources, 0,
  "NEGATIVE CONTROL: without the interview source ids the block reports zero sources");
eq(withoutIds.speech.dialogue_register.claims.length, 0,
  "NEGATIVE CONTROL: and lists no claims, so a builder ignoring the input would fail here");
ok(JSON.stringify(withIds.speech.dialogue_register) !== JSON.stringify(withoutIds.speech.dialogue_register),
  "the two differ, which is the only thing that proves the input is actually read");

// A source id that matches nothing produces an empty list, not a wrong one.
const wrongIds = person.buildPersonModelDefinition(READY, NOW, { interviewSourceIds: [WINDOW] });
eq(wrongIds.speech.dialogue_register.claims.length, 0,
  "an interview source no claim cites contributes no claims");
eq(wrongIds.speech.dialogue_register.sources, 1,
  "while still reporting that the source exists, so 'no claims yet' is distinguishable from 'no interviews'");

// The claim read has to CARRY source_ids or the register is dead on the live
// database while every fixture above stays green.
const personSrc = readFileSync(join(REPO, "api/_person-model.js"), "utf8");
ok(/select c\.claim_id[^`]*c\.source_ids/.test(personSrc),
  "the claims statement selects source_ids, without which the register is a dead pipeline");

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 7. migration 075 ──");
// ═════════════════════════════════════════════════════════════════════════

const { splitSql } = await import(pathToFileURL(join(REPO, "db/migrations/apply.mjs")).href);
const migration = readFileSync(join(REPO, "db/migrations/075_interview.sql"), "utf8");
const statements = splitSql(migration);
ok(statements.length > 0, "migration 075 splits into statements");
ok(!/\bdo\s+\$\$/i.test(migration), "no DO block (the splitter does not handle one)");
ok(!/create (or replace )?function/i.test(migration), "no function");
for (const stmt of statements) {
  const head = stmt.replace(/^(\s*--[^\n]*\n)+/g, "").trim();
  ok(/^(create table if not exists|create (unique )?index if not exists|alter table)/i.test(head),
    `every statement is independently idempotent: ${head.slice(0, 60)}`);
}
ok(/vy_interview_session_answer_gate/.test(migration),
  "an answer implies a question, as a CHECK rather than as JS");
ok(/create unique index if not exists vy_interview_session_mirror_ix/.test(migration),
  "one interview per mirror call, as a unique index rather than as a branch");
ok(/create unique index if not exists vy_interview_answer_shape_ix/.test(migration),
  "one answer per question per interview, as a unique index");
ok(/references vy_replica \(replica_id, owner_user_id\) on delete cascade/.test(migration),
  "both tables cascade from vy_replica, which is what relcheck's reach walk needs");

// The erasure cascade, both layers. 059's argument: relying on a cascade means
// relying on an FK nobody re-checks, and an interview answer is the person
// answering a question about themselves.
const erasure = readFileSync(join(REPO, "api/_replica-full-erasure.js"), "utf8");
for (const table of ["vy_interview_answer", "vy_interview_session"]) {
  ok(new RegExp(`delete from ${table}\\b`).test(erasure),
    `the erasure job deletes ${table} by name`);
}
ok(erasure.indexOf("delete from vy_interview_answer") < erasure.indexOf("delete from vy_interview_session"),
  "child first: the answer is deleted before the session it names");
ok(erasure.indexOf("delete from vy_interview_session") < erasure.indexOf("delete from vy_mirror_session"),
  "and both before the mirror session they cascade from");
ok(/"owner_interview_answers"/.test(erasure),
  "the deletion receipt names the interview as its own class");

// The schema mirror. A migration that is not in db/schema.sql is a table a
// fresh deploy cannot rebuild.
const schema = readFileSync(join(REPO, "db/schema.sql"), "utf8");
for (const table of ["vy_interview_session", "vy_interview_answer"]) {
  ok(schema.includes(`create table if not exists ${table}`), `${table} is mirrored into db/schema.sql`);
}
ok(/alter table vy_replica_source add column if not exists purpose/.test(schema),
  "the source purpose column is mirrored too");

console.log(
  `\n${failed ? "FAILED" : "PASSED"} — ${checks - failed}/${checks} checks` +
  `\n  NOT PROVEN HERE: SQL types and referential integrity. Migration 075 is unapplied` +
  `\n  and no statement in this lane has executed against a database` +
  `\n  (offline-mocks-cannot-type-check-sql). Nor is it proven that a model handed` +
  `\n  the ask block actually asks the question: that needs a paid run and nobody has done one.`,
);
process.exit(failed ? 1 : 0);
