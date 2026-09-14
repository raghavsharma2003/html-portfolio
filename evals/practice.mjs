// The practice stack — syllabus taxonomy, the grading state machine, and the
// practice → words layer — against the CURRENT source.
//
//   node evals/practice.mjs
//
// Bundles the real TypeScript on every run, the same way evals/chesstalk.mjs
// does and for the same reason CLAUDE.md gives about parsetest.v2: a frozen
// bundle passes forever while the source rots.
//
// ── the weighting, and why ────────────────────────────────────────────────
//
// Three sections here matter more than the rest.
//
// 1. THE MULTI-CORRECT PARTIAL SCHEME. `student-app-spec.md` §4.3 calls the
//    simplified all-or-nothing version corrupting "for every multi-correct
//    attempt", and it is right: a student who found three of four options and
//    stopped scores +3 under the real scheme and 0 under the easy one, and the
//    mastery track that gets built out of those numbers is what chooses their
//    next problem. Every edge of the scheme is here — all-correct-selected,
//    every correct subset, and one-wrong-kills even when every correct option
//    was also picked.
//
// 2. THE ABILITY-LABEL BAN. `teacher-arc.md` §2.2 bans handing a
//    sixteen-year-old a category for their own capability, and §3.1 bans the
//    praise half of the same move. The check is a grep over everything
//    `practiceTalk.ts` can emit, and it carries its own negative control: the
//    same check is re-run with the rule STRUCK and must go quiet, because a
//    ban that passes against a corpus it cannot see is a ban that is not
//    there.
//
// 3. THE TERMINAL FENCE, both halves. `activity.ts`'s `STATE_LAW` must reach a
//    chess block byte for byte after this workstream touched the function that
//    renders it, and the practice block must carry the practice law instead of
//    a fence about checkmate.

import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// Derived from this file's location, never hardcoded: a literal
// "/home/user/html-portfolio" is true of exactly one container and silently
// wrong everywhere else.
const REPO = resolve(HERE, "..");
const OUT = mkdtempSync(join(tmpdir(), "practice-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(join(REPO, "src/engine/practice/syllabus"))};\n` +
    `export * from ${JSON.stringify(join(REPO, "src/engine/practice/session"))};\n` +
    `export * from ${JSON.stringify(join(REPO, "src/engine/practiceTalk"))};\n` +
    `export * from ${JSON.stringify(join(REPO, "src/engine/activity"))};\n`,
);
const BUNDLE = join(OUT, "practice.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { cwd: REPO, stdio: "inherit" },
);
const C = await import(pathToFileURL(BUNDLE).href);
const {
  SYLLABUS, syllabusIssues, masteryNodes, nodeFor, nameFor, isUnder,
  MARKING, FORMATS, BANDS, FLOOR_SECONDS, maxMarksFor,
  grade, composeSet, startSession, submit, skip, endEarly, currentQuestion,
  moments, momentsAt, summarize, SLIP_SUPPORT, floorSecondsFor,
  attemptFact, momentFact, practiceState, practiceIdea, settledClause,
  practiceNote, practiceRecord, practiceActivity, hasAbilityLabel, ABILITY_LABELS,
  renderActivity, activityNote, STATE_LAW, stateLawFor,
  ACTIVITY_BLOCK_MAX,
} = C;

let fail = 0;
let count = 0;
const ok = (name, cond, extra = "") => {
  count++;
  if (!cond) { fail++; console.log(`FAIL ${name}${extra ? " — " + extra : ""}`); }
};
const eq = (name, got, want) => {
  count++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
};

const NOW = Date.UTC(2026, 7, 25, 12, 0);
const WORKED = 90_000; // comfortably over every format's floor

// Real ids from the real taxonomy — a fixture that invents an id proves the
// engine works on a syllabus nobody ships.
const IBP = "m.calculus.integration.by-parts";
const SUBST = "m.calculus.integration.substitution";
const GAUSS = "p.em.electrostatics.gauss-law";
const NERNST = "c.phys.electrochemistry.nernst-equation";
const ROLLING = "p.mech.rotational-dynamics.rolling";
const CHAPTER_LEAF = "c.org.hydrocarbons"; // no topics entered yet

// ══ 1. THE TAXONOMY ═══════════════════════════════════════════════════════

eq("the syllabus has no structural issues", syllabusIssues(), []);
ok("three subjects", SYLLABUS.length === 3, String(SYLLABUS.length));
eq("subject ids", SYLLABUS.map((s) => s.id), ["p", "c", "m"]);

{
  const chapters = SYLLABUS.flatMap((s) => s.units.flatMap((u) => u.chapters));
  ok("the chapter level is exhaustive enough to be a syllabus",
    chapters.length >= 60, String(chapters.length));
  ok("every chapter id is <subject>.<unit>.<chapter>",
    chapters.every((c) => c.id.split(".").length === 3),
    chapters.find((c) => c.id.split(".").length !== 3)?.id);
  const expanded = chapters.filter((c) => c.topics.length);
  ok("the exemplar chapters are expanded", expanded.length >= 4, String(expanded.length));
  // The three the spec names by example, by id — a rename of any of them
  // breaks a mastery track and a `vy_pattern` citation, so it should break a
  // test first.
  for (const id of [IBP, GAUSS, NERNST, ROLLING])
    ok(`the spec's example topic exists: ${id}`, nodeFor(id) !== null);
  ok("a chapter with no topics is still a leaf", masteryNodes().includes(CHAPTER_LEAF));
  ok("an expanded chapter is NOT a leaf itself",
    !masteryNodes().includes("m.calculus.integration"));
  ok("every expanded chapter's topics are leaves",
    expanded.every((c) => c.topics.every((t) => masteryNodes().includes(t.id))));
  const leaves = masteryNodes();
  ok("leaves are unique", new Set(leaves).size === leaves.length);
}

ok("nameFor gives a human name", nameFor(IBP) === "integration by parts", nameFor(IBP));
ok("nameFor is empty on an unknown id", nameFor("m.nope.nope.nope") === "");
ok("isUnder walks a chapter down to its topics", isUnder(IBP, "m.calculus.integration"));
ok("isUnder is prefix-SAFE on the dot",
  !isUnder("p.em.electrostatics-lab.x", "p.em.electrostatics"));
ok("isUnder is reflexive", isUnder(CHAPTER_LEAF, CHAPTER_LEAF));

// The taxonomy is a shared constant. A caller that sorts it in place reorders
// it for everyone, and the freeze is what makes that impossible rather than
// impolite.
ok("the syllabus is frozen", Object.isFrozen(SYLLABUS) && Object.isFrozen(SYLLABUS[0].units));

// ══ 2. THE MARKING SCHEMES ════════════════════════════════════════════════

eq("every format has a scheme", FORMATS.filter((f) => !MARKING[f]), []);
eq("single-correct is +3/-1", [MARKING.single_correct.full, MARKING.single_correct.wrong], [3, -1]);
eq("multi-correct is +4 / +1 partial / -2", [
  MARKING.multi_correct.full,
  MARKING.multi_correct.partialPerOption,
  MARKING.multi_correct.wrong,
], [4, 1, -2]);
ok("integer carries NO negative marking", MARKING.integer.wrong === 0);
ok("numerical carries NO negative marking", MARKING.numerical.wrong === 0);
ok("no format pays for a skip", FORMATS.every((f) => MARKING[f].skipped === 0));
eq("matrix max marks scale with the row count", [maxMarksFor("matrix_match", 4), maxMarksFor("matrix_match", 3)], [8, 6]);
ok("every format has a floor time", FORMATS.every((f) => FLOOR_SECONDS[f] > 0));
ok("four bands", BANDS.length === 4);

// ══ 3. GRADING, EVERY FORMAT ══════════════════════════════════════════════

const q = (over) => ({ id: "q", topicId: IBP, band: "standard", ...over });

const opts = (...chosen) => ({ kind: "options", chosen });
const val = (value) => ({ kind: "value", value });
const mat = (rows) => ({ kind: "matrix", rows });
const SKIP = { kind: "skipped" };

// ── single-correct ────────────────────────────────────────────────────────
{
  const Q = q({ key: { format: "single_correct", correct: "B" } });
  eq("single: right is +3", grade(Q, opts("B"), WORKED).marks, 3);
  eq("single: wrong is -1", grade(Q, opts("C"), WORKED).marks, -1);
  eq("single: skipped is 0", grade(Q, SKIP, 0).marks, 0);
  eq("single: an empty selection is a skip, not a wrong answer",
    grade(Q, opts(), 0).verdict, "skipped");
  // A surface that submits two options on a single-correct question is broken;
  // eating it as wrong beats throwing away the paper.
  eq("single: two options graded wrong, never thrown", grade(Q, opts("B", "C"), WORKED).marks, -1);
  eq("single: full marks means correct", grade(Q, opts("B"), WORKED).correct, true);
}

// ── multi-correct: the section that matters most ──────────────────────────
{
  const Q = q({ key: { format: "multi_correct", correct: ["A", "B", "C"] } });
  eq("multi: ALL-CORRECT-SELECTED is +4", grade(Q, opts("A", "B", "C"), WORKED).marks, 4);
  eq("multi: …and order does not matter", grade(Q, opts("C", "A", "B"), WORKED).marks, 4);
  eq("multi: SUBSET of 2, nothing wrong, is +2", grade(Q, opts("A", "B"), WORKED).marks, 2);
  eq("multi: SUBSET of 1, nothing wrong, is +1", grade(Q, opts("B"), WORKED).marks, 1);
  eq("multi: ONE WRONG KILLS — even with every correct option also picked",
    grade(Q, opts("A", "B", "C", "D"), WORKED).marks, -2);
  eq("multi: one wrong alone is also -2", grade(Q, opts("D"), WORKED).marks, -2);
  eq("multi: one wrong plus one right is still -2", grade(Q, opts("A", "D"), WORKED).marks, -2);
  eq("multi: nothing selected is 0", grade(Q, opts(), 0).marks, 0);
  eq("multi: a partial subset is NOT `correct`", grade(Q, opts("A", "B"), WORKED).correct, false);
  eq("multi: a repeated option is not double credit", grade(Q, opts("A", "A"), WORKED).marks, 1);
  // A two-option key, which is where an all-or-nothing shortcut hides.
  const Q2 = q({ key: { format: "multi_correct", correct: ["B", "D"] } });
  eq("multi: half of a two-option key is +1", grade(Q2, opts("B"), WORKED).marks, 1);
  eq("multi: both of a two-option key is +4", grade(Q2, opts("B", "D"), WORKED).marks, 4);
}

// ── integer and numerical ─────────────────────────────────────────────────
{
  const Q = q({ key: { format: "integer", value: 7 } });
  eq("integer: right is +4", grade(Q, val(7), WORKED).marks, 4);
  eq("integer: wrong is 0 — no negative marking", grade(Q, val(8), WORKED).marks, 0);
  eq("integer: nothing entered is a skip", grade(Q, SKIP, 0).verdict, "skipped");

  const N = q({ key: { format: "numerical", value: 0.3, tolerance: 0.01 } });
  eq("numerical: inside tolerance is +4", grade(N, val(0.305), WORKED).marks, 4);
  eq("numerical: outside tolerance is 0", grade(N, val(0.35), WORKED).marks, 0);
  // 0.1 + 0.2 !== 0.3 in binary, and a student who typed the right number to
  // two decimals must not lose four marks to representation.
  eq("numerical: a float edge exactly at the band still scores",
    grade(q({ key: { format: "numerical", value: 0.3, tolerance: 0.1 } }), val(0.1 + 0.2 + 0.1), WORKED).marks, 4);
  eq("numerical: a non-number is a skip", grade(N, val(Number.NaN), WORKED).verdict, "skipped");
}

// ── matrix-match ──────────────────────────────────────────────────────────
{
  const key = {
    format: "matrix_match",
    rows: [
      { row: "P", cols: ["1"] },
      { row: "Q", cols: ["2", "3"] },
      { row: "R", cols: ["4"] },
      { row: "S", cols: ["5"] },
    ],
  };
  const Q = q({ key });
  eq("matrix: every row right is +8", grade(Q, mat(key.rows), WORKED).marks, 8);
  eq("matrix: …and is `correct`", grade(Q, mat(key.rows), WORKED).correct, true);
  eq("matrix: a multi-column row needs the whole set",
    grade(Q, mat([{ row: "Q", cols: ["2"] }]), WORKED).marks, -1);
  eq("matrix: three right and one wrong is 3×2 − 1", grade(Q, mat([
    { row: "P", cols: ["1"] },
    { row: "Q", cols: ["3", "2"] },
    { row: "R", cols: ["4"] },
    { row: "S", cols: ["1"] },
  ]), WORKED).marks, 5);
  eq("matrix: an untouched row costs nothing", grade(Q, mat([{ row: "P", cols: ["1"] }]), WORKED).marks, 2);
  eq("matrix: no rows at all is a skip", grade(Q, mat([]), 0).verdict, "skipped");
  eq("matrix: max marks come off the KEY's row count", grade(Q, mat(key.rows), WORKED).maxMarks, 8);
}

// ── determinism and purity ────────────────────────────────────────────────
{
  const Q = q({ key: { format: "multi_correct", correct: ["A", "C"] } });
  const r = opts("A");
  const a = grade(Q, r, WORKED);
  const b = grade(Q, r, WORKED);
  eq("the same attempt graded twice is the same object", a, b);
  eq("grading does not mutate the response", r.chosen, ["A"]);
  eq("grading does not mutate the question", Q.key.correct, ["A", "C"]);
}

// ══ 4. VERDICTS ═══════════════════════════════════════════════════════════

const SIGN_STEP = "the sign on the second term";
const withDistractors = (over) => q({
  key: { format: "single_correct", correct: "A" },
  distractors: [
    { answer: "B", nature: "slip", step: SIGN_STEP },
    { answer: "C", nature: "conceptual" },
  ],
  ...over,
});

{
  const Q = withDistractors();
  eq("verdict: full marks, worked, is a clean solve", grade(Q, opts("A"), WORKED).verdict, "clean_solve");
  eq("verdict: a tagged slip is a slip", grade(Q, opts("B"), WORKED).verdict, "slip");
  eq("verdict: …and carries the step", grade(Q, opts("B"), WORKED).step, SIGN_STEP);
  eq("verdict: a tagged conceptual distractor is a conceptual miss",
    grade(Q, opts("C"), WORKED).verdict, "conceptual_miss");
  eq("verdict: …and carries NO step to name", grade(Q, opts("C"), WORKED).step, undefined);
  // The default. An untagged wrong answer is NOT promoted to a slip: a slip
  // claim needs evidence, exactly the way a pattern claim does.
  eq("verdict: an UNTAGGED wrong answer is a conceptual miss, never a slip",
    grade(Q, opts("D"), WORKED).verdict, "conceptual_miss");
  eq("verdict: an unanswered question is skipped", grade(Q, SKIP, 0).verdict, "skipped");

  // RUSHED OUTRANKS THE SCORE, both ways round — that is the whole point of it.
  eq("verdict: a RIGHT answer under the floor is rushed",
    grade(Q, opts("A"), 3_000).verdict, "rushed");
  eq("verdict: a WRONG answer under the floor is rushed too",
    grade(Q, opts("B"), 3_000).verdict, "rushed");
  ok("verdict: a rushed right answer still scores its marks",
    grade(Q, opts("A"), 3_000).marks === 3);
  eq("verdict: a skip is never `rushed`, however fast", grade(Q, SKIP, 0).verdict, "skipped");
  // The boundary, exactly.
  const floor = floorSecondsFor(Q) * 1000;
  eq("verdict: exactly at the floor is not rushed", grade(Q, opts("A"), floor).verdict, "clean_solve");
  eq("verdict: one millisecond under is", grade(Q, opts("A"), floor - 1).verdict, "rushed");
  eq("verdict: a per-question floor override wins",
    grade(withDistractors({ floorSeconds: 1 }), opts("A"), 2_000).verdict, "clean_solve");
}
{
  const M = q({ key: { format: "multi_correct", correct: ["A", "B", "C"] } });
  eq("verdict: a correct subset is partial", grade(M, opts("A", "B"), WORKED).verdict, "partial");
  eq("verdict: a subset with a wrong option is NOT partial",
    grade(M, opts("A", "D"), WORKED).verdict, "conceptual_miss");
}

// NEGATIVE CONTROL: every verdict is reachable. A branch no input produces is
// a branch that does not exist, and it would look complete forever.
{
  const M = q({ key: { format: "multi_correct", correct: ["A", "B"] } });
  const Q = withDistractors();
  const reached = new Set([
    grade(Q, opts("A"), WORKED).verdict,
    grade(M, opts("A"), WORKED).verdict,
    grade(Q, opts("B"), WORKED).verdict,
    grade(Q, opts("D"), WORKED).verdict,
    grade(Q, SKIP, 0).verdict,
    grade(Q, opts("A"), 1_000).verdict,
  ]);
  eq("NEGATIVE CONTROL: all six verdicts are reachable", [...reached].sort(),
    ["clean_solve", "conceptual_miss", "partial", "rushed", "skipped", "slip"]);
}

// ══ 5. THE SESSION ════════════════════════════════════════════════════════

/** A tiny bank across two chapters and three bands. */
const BANK = [
  { id: "b1", topicId: IBP, band: "standard", key: { format: "single_correct", correct: "A" } },
  { id: "b2", topicId: SUBST, band: "standard", key: { format: "integer", value: 4 } },
  { id: "b3", topicId: GAUSS, band: "standard", key: { format: "single_correct", correct: "B" } },
  { id: "b4", topicId: IBP, band: "advanced", key: { format: "single_correct", correct: "C" } },
  { id: "b5", topicId: CHAPTER_LEAF, band: "standard", key: { format: "single_correct", correct: "D" } },
];

{
  const cfg = { topicIds: ["m.calculus.integration"], band: "standard", n: 5 };
  const set = composeSet(BANK, cfg);
  eq("composeSet filters to the chapter's topics", set.map((x) => x.id), ["b1", "b2"]);
  eq("composeSet respects the band", composeSet(BANK, { ...cfg, band: "advanced" }).map((x) => x.id), ["b4"]);
  eq("composeSet respects n", composeSet(BANK, { ...cfg, n: 1 }).map((x) => x.id), ["b1"]);
  eq("composeSet takes a chapter-level leaf by its own id",
    composeSet(BANK, { topicIds: [CHAPTER_LEAF], band: "standard", n: 5 }).map((x) => x.id), ["b5"]);
  // Determinism: the same seed twice, and a shuffled bank does not change the
  // answer — a set that cannot be replayed cannot be regraded when a key turns
  // out to be wrong.
  const all = { topicIds: ["p", "c", "m"], band: "standard", n: 4 };
  eq("composeSet is deterministic for a seed",
    composeSet(BANK, all, 7).map((x) => x.id), composeSet(BANK, all, 7).map((x) => x.id));
  eq("composeSet does not depend on the bank's arrival order",
    composeSet(BANK, all, 7).map((x) => x.id),
    composeSet([...BANK].reverse(), all, 7).map((x) => x.id));
  ok("a seeded set is a permutation of the unseeded one",
    JSON.stringify(composeSet(BANK, all, 7).map((x) => x.id).slice().sort()) ===
      JSON.stringify(composeSet(BANK, all).map((x) => x.id).slice().sort()));
}

/** Build a session over questions given inline. */
function sessionOf(questions, cfg = {}) {
  return startSession(
    { topicIds: [...new Set(questions.map((x) => x.topicId))], band: "standard", n: questions.length, ...cfg },
    questions,
    NOW,
  );
}

{
  const qs = [
    q({ id: "a", key: { format: "single_correct", correct: "A" } }),
    q({ id: "b", topicId: GAUSS, key: { format: "single_correct", correct: "A" } }),
  ];
  let s = sessionOf(qs);
  ok("a fresh session opens on the first question", currentQuestion(s).id === "a");
  ok("a fresh session is not over", !s.over && !s.endedEarly);
  const s1 = submit(s, opts("A"), WORKED);
  ok("submit does not mutate the session it was given", s.graded.length === 0);
  ok("submit advances", s1.index === 1 && currentQuestion(s1).id === "b");
  const s2 = submit(s1, opts("B"), WORKED);
  ok("the set closes on the last answer", s2.over && !s2.endedEarly);
  eq("a submit against a finished set is a no-op", submit(s2, opts("A"), WORKED).graded.length, 2);
  const early = endEarly(s1);
  ok("endEarly is distinct from finishing", early.over && early.endedEarly);
  eq("endEarly does not invent answers", early.graded.length, 1);
  eq("skip records a skipped verdict", skip(s, 0).graded[0].verdict, "skipped");
}

// ── the summary ───────────────────────────────────────────────────────────
{
  const qs = [
    q({ id: "a", key: { format: "single_correct", correct: "A" } }),
    q({ id: "b", topicId: GAUSS, key: { format: "multi_correct", correct: ["A", "B"] } }),
    q({ id: "c", topicId: GAUSS, key: { format: "integer", value: 3 } }),
  ];
  let s = sessionOf(qs);
  s = submit(s, opts("A"), WORKED);      // clean, +3
  s = submit(s, opts("A"), WORKED);      // partial, +1
  s = submit(s, SKIP, 0);                // skipped, 0
  const sum = summarize(s);
  eq("summary counts marks", sum.marks, 4);
  eq("summary counts the whole paper's max, skips included", sum.maxMarks, 3 + 4 + 4);
  eq("summary counts clean solves", sum.clean, 1);
  eq("summary counts answered, excluding skips", sum.answered, 2);
  eq("per-topic tallies are keyed by leaf", sum.byTopic.map((t) => t.topicId), [IBP, GAUSS]);
  eq("per-topic marks add up", sum.byTopic.map((t) => t.marks), [3, 1]);
  eq("per-topic verdict tallies", sum.byTopic.map((t) => [t.clean, t.partial, t.skipped]), [[1, 0, 0], [0, 1, 1]]);

  // Unreached questions still count toward what the set was worth.
  let e = sessionOf(qs);
  e = endEarly(submit(e, opts("A"), WORKED));
  eq("an abandoned set is still worth what it was worth", summarize(e).maxMarks, 3 + 4 + 4);
  eq("…and nothing is invented for the unreached questions", summarize(e).answered, 1);
}

// ══ 6. THE MOMENT SHAPES ══════════════════════════════════════════════════

const slipQ = (id, topicId = IBP, step = SIGN_STEP) => ({
  id,
  topicId,
  band: "standard",
  key: { format: "single_correct", correct: "A" },
  distractors: [{ answer: "B", nature: "slip", step }],
});

// ── first_clean_solve_of_topic ────────────────────────────────────────────
{
  const qs = [slipQ("a"), slipQ("b"), slipQ("c", GAUSS)];
  let s = sessionOf(qs);
  s = submit(s, opts("A"), WORKED);
  s = submit(s, opts("A"), WORKED);
  s = submit(s, opts("A"), WORKED);
  const ms = moments(s);
  eq("first clean solve fires once per topic",
    ms.filter((m) => m.shape === "first_clean_solve_of_topic").map((m) => m.topicId), [IBP, GAUSS]);
  eq("…and cites the attempt it is made of",
    ms.find((m) => m.shape === "first_clean_solve_of_topic").questionIds, ["a"]);

  // NEGATIVE CONTROL: "first" means first EVER. A student with prior clean
  // solves on the topic gets no first-solve moment, which is `milestones.ts`'s
  // fire-once-ever rule applied across sessions.
  let p = startSession(
    { topicIds: [IBP, GAUSS], band: "standard", n: 3, priorCleanTopicIds: [IBP] },
    qs, NOW,
  );
  p = submit(p, opts("A"), WORKED);
  eq("NEGATIVE CONTROL: no first-solve moment when the record already has one",
    moments(p).filter((m) => m.shape === "first_clean_solve_of_topic"), []);
  // NEGATIVE CONTROL: a rushed right answer is not a clean solve, so it is not
  // a first clean solve either.
  let r = sessionOf(qs);
  r = submit(r, opts("A"), 1_000);
  eq("NEGATIVE CONTROL: a rushed right answer fires nothing", moments(r), []);
}

// ── comeback_after_miss ───────────────────────────────────────────────────
{
  const qs = [slipQ("a"), slipQ("b")];
  let s = startSession({ topicIds: [IBP], band: "standard", n: 2, priorCleanTopicIds: [IBP] }, qs, NOW);
  s = submit(s, opts("B"), WORKED); // slip
  s = submit(s, opts("A"), WORKED); // clean
  const ms = moments(s);
  eq("a comeback fires after a miss on the same topic",
    ms.map((m) => m.shape), ["comeback_after_miss"]);
  eq("…and cites BOTH halves — the miss and the solve",
    ms[0].questionIds, ["a", "b"]);

  // NEGATIVE CONTROL: no earlier miss, no comeback.
  let n = startSession({ topicIds: [IBP], band: "standard", n: 2, priorCleanTopicIds: [IBP] }, qs, NOW);
  n = submit(n, opts("A"), WORKED);
  n = submit(n, opts("A"), WORKED);
  eq("NEGATIVE CONTROL: a clean run is not a comeback", moments(n), []);

  // NEGATIVE CONTROL: a miss on a DIFFERENT topic is not the same story.
  let d = startSession({ topicIds: [IBP, GAUSS], band: "standard", n: 2, priorCleanTopicIds: [IBP, GAUSS] },
    [slipQ("a", GAUSS), slipQ("b", IBP)], NOW);
  d = submit(d, opts("B"), WORKED);
  d = submit(d, opts("A"), WORKED);
  eq("NEGATIVE CONTROL: a miss on another topic does not make a comeback", moments(d), []);
}

// ── streak_of_slips_same_step ─────────────────────────────────────────────
{
  const qs = [slipQ("a"), slipQ("b"), slipQ("c"), slipQ("d")];
  const cfg = { topicIds: [IBP], band: "standard", n: 4, priorCleanTopicIds: [IBP] };
  let s = startSession(cfg, qs, NOW);
  for (let i = 0; i < 3; i++) s = submit(s, opts("B"), WORKED);
  const ms = moments(s).filter((m) => m.shape === "streak_of_slips_same_step");
  eq("three slips on one step is a shape", ms.length, 1);
  eq("…it names the step", ms[0].step, SIGN_STEP);
  eq("…and cites all three", ms[0].questionIds, ["a", "b", "c"]);
  ok("the support bar is the vy_pattern bar", SLIP_SUPPORT === 3);

  // NEGATIVE CONTROL: two is an anecdote.
  let two = startSession(cfg, qs, NOW);
  two = submit(submit(two, opts("B"), WORKED), opts("B"), WORKED);
  eq("NEGATIVE CONTROL: two slips are not a shape",
    moments(two).filter((m) => m.shape === "streak_of_slips_same_step"), []);

  // NEGATIVE CONTROL: it fires ONCE, not again on the fourth.
  let four = submit(s, opts("B"), WORKED);
  eq("NEGATIVE CONTROL: the shape fires once, not per additional slip",
    moments(four).filter((m) => m.shape === "streak_of_slips_same_step").length, 1);

  // NEGATIVE CONTROL: a clean solve on the topic breaks the run. The shape is
  // a repetition that is STILL GOING; one that stopped is a thing to say
  // nothing about.
  let broken = startSession(cfg, qs, NOW);
  broken = submit(broken, opts("B"), WORKED);
  broken = submit(broken, opts("B"), WORKED);
  broken = submit(broken, opts("A"), WORKED); // clean — breaks it
  broken = submit(broken, opts("B"), WORKED);
  eq("NEGATIVE CONTROL: a clean solve breaks the slip run",
    moments(broken).filter((m) => m.shape === "streak_of_slips_same_step"), []);

  // NEGATIVE CONTROL: different steps do not add up.
  let mixed = startSession(cfg, [slipQ("a"), slipQ("b", IBP, "the u-dv choice"), slipQ("c")], NOW);
  mixed = submit(mixed, opts("B"), WORKED);
  mixed = submit(mixed, opts("B"), WORKED);
  mixed = submit(mixed, opts("B"), WORKED);
  eq("NEGATIVE CONTROL: slips at different steps are not one run",
    moments(mixed).filter((m) => m.shape === "streak_of_slips_same_step"), []);

  // NEGATIVE CONTROL: an UNTAGGED wrong answer has no step and cannot join a
  // run. The evidence bar doing its job, not a gap.
  let untagged = startSession(cfg, [
    q({ id: "a", key: { format: "single_correct", correct: "A" } }),
    q({ id: "b", key: { format: "single_correct", correct: "A" } }),
    q({ id: "c", key: { format: "single_correct", correct: "A" } }),
  ], NOW);
  for (let i = 0; i < 3; i++) untagged = submit(untagged, opts("D"), WORKED);
  eq("NEGATIVE CONTROL: untagged misses never become a slip run",
    moments(untagged).filter((m) => m.shape === "streak_of_slips_same_step"), []);
}

// ── ONE EVENT, ONE NOTE ───────────────────────────────────────────────────
//
// The digest failure, which is a CALL-SITE bug by construction: a poke that
// sends the session's last moment re-announces a comeback that landed two
// questions ago, every question, for the rest of the set.
{
  const qs = [slipQ("a"), slipQ("b"), slipQ("c"), slipQ("d")];
  const cfg = { topicIds: [IBP], band: "standard", n: 4, priorCleanTopicIds: [IBP] };
  let s = startSession(cfg, qs, NOW);
  s = submit(s, opts("B"), WORKED); // slip
  s = submit(s, opts("A"), WORKED); // clean — the comeback completes HERE
  eq("the moment is attributed to the attempt that completed it",
    momentsAt(s, "b").map((m) => m.shape), ["comeback_after_miss"]);
  eq("…and not to the attempt that started it", momentsAt(s, "a"), []);
  s = submit(s, opts("A"), WORKED);
  eq("NEGATIVE CONTROL: a later question does not re-announce it", momentsAt(s, "c"), []);
  ok("…while the session still holds it", moments(s).length === 1);
}

// ══ 7. SHAPELINT ══════════════════════════════════════════════════════════
//
// The three rules that stop a fact becoming a line she recites, plus the two
// this layer adds: no ability label, and no internal id read aloud.

const collected = [];

function shapelint(label, f) {
  const bad = [];
  // `recited-prompt`: a capital start plus terminal punctuation IS a line.
  if (/^[A-Z][^.?!]*[.?!]$/.test(f)) bad.push("sentence-shaped");
  if (/^(i\b|i'm\b|main\b|mai\b|mujhe\b|meri\b|mera\b|maine\b)/i.test(f)) bad.push("first-person");
  const n = f.trim().split(/\s+/).filter(Boolean).length;
  if (n > 14) bad.push(`${n} words`);
  if (hasAbilityLabel(f)) bad.push("ability label");
  if (/\b[a-z]+(?:\.[a-z0-9-]+){2,}\b/i.test(f)) bad.push("internal id");
  ok(`shapelint ${label}: "${f}"`, bad.length === 0, bad.join(", "));
}

const collect = (label, fs) => {
  for (const f of fs) {
    if (!f) continue;
    collected.push(f);
    shapelint(label, f);
  }
};

// Every verdict's fact row, on a long topic name — the worst case for the
// word budget is the longest name in the syllabus, not the shortest.
{
  const LONG = "m.calculus.integration.limit-of-sum";
  const Q = { ...withDistractors(), topicId: LONG };
  for (const [r, ms] of [[opts("A"), WORKED], [opts("B"), WORKED], [opts("C"), WORKED],
    [SKIP, 0], [opts("A"), 1_000]]) {
    collect("attemptFact", [attemptFact(grade(Q, r, ms))]);
  }
  const M = { ...q({ key: { format: "multi_correct", correct: ["A", "B", "C"] } }), topicId: LONG };
  collect("attemptFact/partial", [attemptFact(grade(M, opts("A", "B"), WORKED))]);
  collect("attemptFact/her", [attemptFact(grade(Q, opts("A"), WORKED), "her")]);
}

// Every moment shape's fact row.
{
  for (const shape of ["first_clean_solve_of_topic", "comeback_after_miss", "streak_of_slips_same_step"]) {
    collect("momentFact", [momentFact({ shape, topicId: IBP, step: SIGN_STEP, questionIds: ["a", "b", "c"] })]);
  }
  // The unnamed-step fallback — a shape whose step is missing must not print
  // "undefined" into a prompt.
  const f = momentFact({ shape: "streak_of_slips_same_step", topicId: IBP, questionIds: ["a", "b", "c"] });
  ok("a stepless slip run does not print undefined", !/undefined/.test(f), f);
  collect("momentFact/stepless", [f]);
}

// ══ 8. THE ABILITY-LABEL BAN ══════════════════════════════════════════════

/** The check, written once so the negative control can re-run it with the rule
 *  struck. `labels` is passed in for exactly that reason. */
function labelHits(rows, labels) {
  const re = new RegExp(`\\b(${labels.join("|")})\\w*\\b`, "i");
  return labels.length ? rows.filter((r) => re.test(r)) : [];
}

// A full session, rendered every way this file can render it, so the grep runs
// over the real corpus rather than a sample of it.
const CORPUS = [];
{
  const qs = [
    slipQ("a"),
    slipQ("b"),
    slipQ("c"),
    { ...slipQ("d"), ref: "JEE 2019 Paper 1 Q7" },
    q({ id: "e", topicId: GAUSS, key: { format: "multi_correct", correct: ["A", "B"] } }),
    q({ id: "f", topicId: CHAPTER_LEAF, key: { format: "numerical", value: 2.5, tolerance: 0.05 } }),
  ];
  let s = sessionOf(qs);
  const answers = [opts("B"), opts("B"), opts("B"), opts("A"), opts("A"), val(9)];
  for (const a of answers) {
    CORPUS.push(practiceState(s), practiceIdea(s), settledClause(s));
    s = submit(s, a, WORKED);
    const last = s.graded[s.graded.length - 1];
    const m = momentsAt(s, last.questionId)[0] ?? null;
    CORPUS.push(attemptFact(last), practiceNote(s, last, m));
    CORPUS.push(...practiceActivity(s, NOW, m).facts);
  }
  CORPUS.push(practiceState(s), practiceIdea(s), ...practiceRecord(s));
  for (const m of moments(s)) CORPUS.push(momentFact(m));
  const rows = CORPUS.flatMap((r) => String(r).split("; ")).filter(Boolean);
  collect("corpus", rows);

  eq("NOT ONE ability label in anything practiceTalk emits",
    labelHits(rows, ABILITY_LABELS), []);

  // NEGATIVE CONTROL, the one that matters: the check has to be capable of
  // failing. A ban that passes against a corpus it cannot see is not a ban.
  const poisoned = [...rows, "he is weak in organic", "she called him a natural"];
  ok("NEGATIVE CONTROL: the check CATCHES a planted label",
    labelHits(poisoned, ABILITY_LABELS).length === 2,
    JSON.stringify(labelHits(poisoned, ABILITY_LABELS)));
  // And with the RULE STRUCK it goes quiet — which is what proves the list,
  // rather than some accident of the corpus, is doing the work.
  eq("NEGATIVE CONTROL: with the rule struck the planted labels pass",
    labelHits(poisoned, []), []);

  // The predicate itself, on both sides.
  ok("hasAbilityLabel catches the arc's own banned nouns",
    ["brilliant", "genius", "topper-material", "a natural"].every(hasAbilityLabel));
  ok("hasAbilityLabel catches the §2.2 examples",
    ["you're weak in organic", "not a maths person is sloppy", "a slow starter"].some(hasAbilityLabel));
  ok("hasAbilityLabel catches the numeric diagnosis", hasAbilityLabel("his rank will be fine"));
  ok("hasAbilityLabel does NOT fire on naming the act",
    !hasAbilityLabel("he slipped at the sign on the second term"));
  ok("…nor on a marks count", !hasAbilityLabel("3 of 8 clean, 11 of 32 marks"));
  ok("the banned list is not empty", ABILITY_LABELS.length >= 10);
}

// ══ 9. STATE, IDEA AND THE SETTLED CLAUSE ═════════════════════════════════
{
  const qs = [slipQ("a"), slipQ("b"), slipQ("c")];
  let s = sessionOf(qs);
  ok("state opens on question 1", practiceState(s) === "in progress, question 1 of 3", practiceState(s));
  ok("nothing answered yet says so", /nothing answered yet/.test(settledClause(s)));
  s = submit(s, opts("B"), WORKED);
  ok("state advances", practiceState(s) === "in progress, question 2 of 3", practiceState(s));
  // TENSE IS LAW: the answer that just went in is IN, and the next question is
  // the only open one.
  ok("the settled clause closes the answer that went in", /answer is in/.test(settledClause(s)));
  ok("…and names the open question", /question 2 is open/.test(settledClause(s)));
  s = submit(submit(s, opts("A"), WORKED), opts("A"), WORKED);
  ok("a finished set says so and counts", practiceState(s) === "set finished, 2 of 3 clean", practiceState(s));
  ok("a finished set closes the clause entirely", settledClause(s) === "");

  // The abandoned set is stated as abandoned AND located.
  let e = endEarly(submit(sessionOf(qs), opts("A"), WORKED));
  ok("an abandoned set is located", /ended early after 1 of 3/.test(practiceState(e)), practiceState(e));
  ok("…and never claims a result", !/finished/.test(practiceState(e)));
  ok("an untouched abandoned set says that instead",
    practiceState(endEarly(sessionOf(qs))) === "the set ended before a question was answered");

  // The idea ladder.
  ok("a single-topic set says so", /only/.test(practiceIdea(sessionOf(qs))), practiceIdea(sessionOf(qs)));
  const mixed = sessionOf([slipQ("a"), slipQ("b", GAUSS), slipQ("c", NERNST)]);
  ok("a mixed set counts its topics", /3 topics/.test(practiceIdea(mixed)), practiceIdea(mixed));
  ok("an empty set has no idea to state", practiceIdea(sessionOf([])) === "");
  // A live slip run is the most specific plan there is.
  let run = startSession({ topicIds: [IBP], band: "standard", n: 3, priorCleanTopicIds: [IBP] }, qs, NOW);
  for (let i = 0; i < 3; i++) run = submit(run, opts("B"), WORKED);
  ok("a live slip run becomes the plan", practiceIdea(run).includes(SIGN_STEP), practiceIdea(run));
  // `pyq` is an id and would be read out as three letters on the voice lane.
  const past = startSession({ topicIds: [IBP], band: "pyq", n: 1 },
    [{ ...slipQ("a"), band: "pyq" }], NOW);
  ok("the pyq band reaches her as words, never as the id",
    /past paper/.test(practiceIdea(past)) && !/pyq/i.test(practiceIdea(past)), practiceIdea(past));
}

// ══ 10. THE RECORD ════════════════════════════════════════════════════════
{
  const qs = [slipQ("a"), slipQ("b"), slipQ("c"), q({ id: "d", topicId: GAUSS, key: { format: "integer", value: 2 } })];
  let s = sessionOf(qs);
  for (let i = 0; i < 3; i++) s = submit(s, opts("B"), WORKED);
  s = submit(s, val(2), WORKED);
  const rec = practiceRecord(s);
  collect("record", rec);
  ok("the record says what the set was", /4 standard questions/.test(rec[0]), rec[0]);
  ok("…and how it went, counted", /1 of 4 clean/.test(rec[1]), rec[1]);
  ok("…and carries ONE shape, the most specific", rec.filter((r) => /slips at/.test(r)).length === 1);
  ok("the record is at most four rows", rec.length <= 4, String(rec.length));

  // An abandoned set is located in the record too.
  const e = practiceRecord(endEarly(submit(sessionOf(qs), opts("B"), WORKED)));
  ok("the record locates an abandoned set", e.some((r) => /put it down after 1 of 4/.test(r)), JSON.stringify(e));
  collect("record/early", e);
}

// ══ 11. THE ACTIVITY BLOCK ════════════════════════════════════════════════
{
  const qs = [
    slipQ("a"),
    { ...slipQ("b"), ref: "JEE 2019 Paper 1 Q7" },
    q({ id: "c", topicId: GAUSS, key: { format: "single_correct", correct: "A" } }),
  ];
  let s = sessionOf(qs);
  s = submit(s, opts("B"), WORKED);
  const a = practiceActivity(s, NOW);
  eq("the activity declares its kind", a.kind, "practice");
  ok("the student's turn is never hers", a.waitingOnHer === false);
  ok("a live set is not over", a.over === false);
  ok("the first row is where it stands", a.facts[0] === "it is his question to answer", a.facts[0]);
  ok("state is present and machine-derived", /^in progress, question 2 of 3$/.test(a.state), a.state);
  for (const f of a.facts) shapelint("activity", f);

  // NAMEABLE: topic names and refs, never ids. An identifier she emits that
  // was not in her input is treated as INVENTED by the honesty gate, and an
  // internal id in her mouth is characters read aloud.
  ok("nameable carries the topic names", a.nameable.includes("integration by parts"));
  ok("…and the human reference", a.nameable.includes("JEE 2019 Paper 1 Q7"));
  ok("…and NOT one internal id", !a.nameable.some((n) => /\.[a-z-]+\./.test(n)), JSON.stringify(a.nameable));
  ok("…and nothing from outside the set", !a.nameable.includes(nameFor(NERNST)));

  // The rendered block: the head names a practice set, the fence is the
  // PRACTICE fence, and the whole thing stays inside the measured ceiling.
  const block = renderActivity(a, NOW + 5 * 60_000);
  ok("the head names the activity", /A PRACTICE SET/.test(block), block.slice(0, 80));
  ok("the block carries the state line", block.includes("state: in progress, question 2 of 3"));
  ok("the block carries the PRACTICE fence", block.includes(stateLawFor("practice")));
  ok("…and NOT the chess one", !block.includes(STATE_LAW));
  ok("no checkmate vocabulary in a revision session", !/checkmate|stalemate/i.test(block));
  ok("the block is inside the measured ceiling", block.length <= ACTIVITY_BLOCK_MAX, String(block.length));

  // A finished set: the head flips and the state stops being "in progress".
  let done = submit(submit(s, opts("A"), WORKED), opts("A"), WORKED);
  const fin = renderActivity(practiceActivity(done, NOW), NOW + 60_000);
  ok("a finished set reads as finished", /JUST FINISHED A PRACTICE SET/.test(fin));
  ok("…and its state says so", fin.includes("state: set finished, 2 of 3 clean"));
  ok("a finished set is inside the ceiling too", fin.length <= ACTIVITY_BLOCK_MAX, String(fin.length));

  // NEGATIVE CONTROL — the fence must not be claimable early. An unfinished
  // set may never render a finished state.
  ok("NEGATIVE CONTROL: a live set never renders a finished state",
    !renderActivity(practiceActivity(s, NOW), NOW).includes("set finished"));
}

// ── the note that rides the live lane ─────────────────────────────────────
{
  const qs = [slipQ("a"), slipQ("b")];
  let s = sessionOf(qs);
  s = submit(s, opts("B"), WORKED);
  const g = s.graded[0];
  const note = practiceNote(s, g);
  collect("note", note.split("; "));
  ok("the note carries the fact", note.includes("slipped at"), note);
  ok("…and the settled clause, so nothing reads as pending", note.includes("answer is in"), note);

  const wrapped = activityNote(note, { state: practiceState(s), idea: practiceIdea(s), kind: "practice" });
  ok("the wrapped note is angle-bracketed", wrapped.startsWith("<context:"));
  ok("…and carries the PRACTICE fence", wrapped.includes(stateLawFor("practice")));
  ok("…and not the chess one", !wrapped.includes(STATE_LAW));
}

// ══ 12. THE BYTES THE OTHER ACTIVITIES ALREADY HAD ════════════════════════
//
// This workstream edited `truthBlock` and `activityNote`, which every existing
// activity renders through. Both were touched to add a per-kind fence, and the
// property that makes that edit safe is that the four kinds which existed
// before it render EXACTLY what they rendered — so it is asserted rather than
// believed.

for (const kind of ["chess", "ttt", "wyr", "watch"]) {
  ok(`${kind} still gets STATE_LAW, byte for byte`, stateLawFor(kind) === STATE_LAW);
}
ok("practice is the only override", stateLawFor("practice") !== STATE_LAW);
{
  const chessish = {
    kind: "chess",
    startedAt: NOW,
    facts: ["it is his move", "she is playing white"],
    nameable: ["e4"],
    state: "in progress, move 3",
    idea: "the italian game, quick development",
  };
  const block = renderActivity(chessish, NOW + 60_000);
  ok("a chess block still ends in STATE_LAW", block.includes(STATE_LAW));
  ok("…and its head is unchanged", /IN THE MIDDLE OF A GAME OF CHESS/.test(block));
  const note = activityNote("he played e4", { state: "in progress, move 3" });
  ok("a note with no kind still carries STATE_LAW", note.includes(STATE_LAW));
  ok("…and is otherwise byte-identical to what it was",
    note === `<context: he played e4. state: in progress, move 3. ${STATE_LAW} this happened in the room, not in the conversation — fold it into whatever you two were talking about, finish your thought first, or let it pass. only remark if it genuinely grabs you, short, your own words. never reference this note>`,
    note);
}

// ══ 13. NO DIALOGUE ANYWHERE ══════════════════════════════════════════════
//
// The corpus, checked once more as a whole for the failure this layer exists
// to prevent: a line she could say. `recited-prompt` measured her own example
// quotes recited on 4 of 5 turns, and a practice set would pay it per question.

ok("the corpus is not empty", collected.length > 30, String(collected.length));
ok("no row is a quoted line", !collected.some((f) => /["“”']{1}.*["“”']{1}/.test(f)),
  collected.find((f) => /["“”']{1}.*["“”']{1}/.test(f)));
ok("no row is second person — nothing here is addressed to the student",
  !collected.some((f) => /\byou(r|'re)?\b/i.test(f)),
  collected.find((f) => /\byou(r|'re)?\b/i.test(f)));
ok("no row claims a standing pattern",
  !collected.some((f) => /\balways\b|\bnever\b|\bevery time\b/i.test(f)),
  collected.find((f) => /\balways\b|\bnever\b|\bevery time\b/i.test(f)));
ok("no row is Hinglish — her register is hers",
  !collected.some((f) => /\b(hai|nahi|tha|karo|matlab|yaar|arre)\b/i.test(f)),
  collected.find((f) => /\b(hai|nahi|tha|karo|matlab|yaar|arre)\b/i.test(f)));

console.log(fail ? `${fail} FAILURES of ${count}` : `ALL ${count} PASS`);
process.exit(fail ? 1 : 0);
