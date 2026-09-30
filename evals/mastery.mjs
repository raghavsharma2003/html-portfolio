// The mastery fold — `src/engine/practice/mastery.ts` — against the CURRENT
// source. Same reason `evals/practice.mjs` bundles fresh on every run
// (CLAUDE.md's note on `parsetest.v2`): a frozen bundle passes forever while
// the source rots.
//
//   node evals/mastery.mjs
//
// Three properties, and they are the whole reason this file exists rather
// than being three more `ok()` lines at the bottom of `practice.mjs`:
//
// 1. THRESHOLDS. Each `MasteryLevel` requires both its score band AND its own
//    minimum attempt count — a lucky single guess must not read as
//    "mastered", and too little evidence must not let a good score skip the
//    bar (`mastery.ts`'s header on why one axis alone corrupts the signal).
//
// 2. NO DECAY BY ABSENCE. Two summary lists that differ only by "more
//    sessions happened, all with zero attempts on this topic" (i.e. nothing
//    that touches the topic at all) must fold to the IDENTICAL mastery for
//    that topic. This is the property the module's whole design (no clock
//    read, no timestamp field consulted) exists to make structurally true,
//    and this is the test that would catch a future edit reintroducing one.
//
// 3. MONOTONICITY / ORDER-INDEPENDENCE. The same set of graded attempts,
//    chunked into a different number of sessions in a different order, folds
//    to the same mastery — summing counters is commutative, and this is what
//    "the level depends on the record, never on how it arrived" cashes out
//    to as an assertion.

import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const OUT = mkdtempSync(join(tmpdir(), "mastery-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(join(REPO, "src/engine/practice/syllabus"))};\n` +
    `export * from ${JSON.stringify(join(REPO, "src/engine/practice/session"))};\n` +
    `export * from ${JSON.stringify(join(REPO, "src/engine/practice/mastery"))};\n`,
);
const BUNDLE = join(OUT, "mastery.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { cwd: REPO, stdio: "inherit" },
);
const C = await import(pathToFileURL(BUNDLE).href);
const {
  composeSet, startSession, submit, summarize,
  foldMastery, masteryOf, levelForXp, xpFromGraded,
  MIN_ATTEMPTS, SCORE_BANDS, XP_TIERS,
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

// ── a tiny synthetic bank, single-correct only, one topic ─────────────────
// Real content lives in `demoBank.ts`; this eval needs full control over how
// many attempts land clean vs wrong, which a fixed real bank does not give.

const TOPIC = "m.calculus.integration.by-parts";
const BAND = "foundation";
const bank = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `syn.${String(i).padStart(3, "0")}`,
    topicId: TOPIC,
    band: BAND,
    key: { format: "single_correct", correct: "A" },
  }));

const WORKED = 60_000; // over foundation's floor (session.ts FLOOR_SECONDS.single_correct = 20s)

/** Run N single-correct attempts against a fresh set, `results[i]` true =
 *  answer A (correct), false = answer B (wrong). Returns the session. */
function runSet(results) {
  const qs = composeSet(bank(results.length), { topicIds: [TOPIC], band: BAND, n: results.length });
  let s = startSession({ topicIds: [TOPIC], band: BAND, n: results.length }, qs, Date.UTC(2026, 7, 25));
  for (const r of results) {
    s = submit(s, { kind: "options", chosen: [r ? "A" : "B"] }, WORKED);
  }
  return s;
}

// ══ 1. THRESHOLDS ══════════════════════════════════════════════════════════

{
  // Zero attempts: unattempted, regardless of anything else.
  const empty = foldMastery([]);
  eq("no summaries → unattempted", masteryOf(empty, TOPIC).level, "unattempted");

  // One clean solve: a perfect score, but under every level's attempt floor
  // above "building" — must NOT read as solid or mastered off one question.
  const one = foldMastery([summarize(runSet([true]))]);
  const m1 = masteryOf(one, TOPIC);
  ok("one clean solve is 100% score", m1.score === 1, String(m1.score));
  eq("…but one attempt cannot be more than 'building'", m1.level, "building");

  // Three clean solves clears the `developing`/`solid` attempt bar (3) at a
  // perfect score, which clears the `solid` score band (0.7) too — expect
  // 'solid', not yet 'mastered' (needs MIN_ATTEMPTS.mastered attempts).
  const three = foldMastery([summarize(runSet([true, true, true]))]);
  const m3 = masteryOf(three, TOPIC);
  ok("three clean solves clears the solid score band", m3.score >= SCORE_BANDS.solid);
  eq("…and the solid attempt bar, but not mastered's", m3.level, "solid");
  ok("three attempts is under the mastered attempt bar", 3 < MIN_ATTEMPTS.mastered);

  // MIN_ATTEMPTS.mastered clean solves: both bars clear, expect 'mastered'.
  const nMastered = MIN_ATTEMPTS.mastered;
  const mastered = foldMastery([summarize(runSet(Array(nMastered).fill(true)))]);
  eq(`${nMastered} clean solves → mastered`, masteryOf(mastered, TOPIC).level, "mastered");

  // Same attempt count, all wrong: score 0 (single_correct wrong = -1, but
  // score is clamped to [0,1]) — must read as 'building', not crash negative.
  const allWrong = foldMastery([summarize(runSet(Array(nMastered).fill(false)))]);
  const mw = masteryOf(allWrong, TOPIC);
  ok("all-wrong score is clamped at 0, never negative", mw.score === 0, String(mw.score));
  eq("all-wrong stays at 'building' however many attempts", mw.level, "building");

  // A mixed record right at the 'developing' score band boundary.
  // developing needs score >= 0.4 and attempts >= MIN_ATTEMPTS.developing.
  const nDev = Math.max(MIN_ATTEMPTS.developing, 5);
  const results = Array.from({ length: nDev }, (_, i) => i % 2 === 0); // ~50% clean
  const dev = foldMastery([summarize(runSet(results))]);
  const md = masteryOf(dev, TOPIC);
  ok("a ~50% record clears the developing score band", md.score >= SCORE_BANDS.developing);
  ok("…and sits at developing or better, never building",
    md.level === "developing" || md.level === "solid" || md.level === "mastered", md.level);
}

// ══ 2. NO DECAY BY ABSENCE ═════════════════════════════════════════════════

{
  const OTHER_TOPIC = "p.em.electrostatics.gauss-law";
  const otherBank = (n) =>
    Array.from({ length: n }, (_, i) => ({
      id: `syn.other.${i}`,
      topicId: OTHER_TOPIC,
      band: BAND,
      key: { format: "single_correct", correct: "A" },
    }));

  const base = summarize(runSet([true, true, true, true, true, true]));
  const before = masteryOf(foldMastery([base]), TOPIC);

  // "Absence" modelled as: many more sessions happen, all on a DIFFERENT
  // topic — nothing about THIS topic's record changes, no clock is read, and
  // no timestamp is ever passed to `foldMastery`. If the topic's mastery
  // moved at all here, something started reading time or session count as a
  // penalty against a topic that was simply not touched.
  let sessions = [base];
  for (let i = 0; i < 10; i++) {
    const qs = composeSet(otherBank(1), { topicIds: [OTHER_TOPIC], band: BAND, n: 1 });
    let s = startSession({ topicIds: [OTHER_TOPIC], band: BAND, n: 1 }, qs, Date.UTC(2026, 7, 25 + i));
    s = submit(s, { kind: "skipped" }, 0);
    sessions.push(summarize(s));
  }
  const after = masteryOf(foldMastery(sessions), TOPIC);

  eq("untouched-topic mastery is byte-identical after unrelated 'absence' sessions",
    after, before);
}

// ══ 3. MONOTONICITY / ORDER-INDEPENDENCE ═══════════════════════════════════

{
  // The same 9 attempts (6 clean, 3 wrong), chunked three different ways.
  const pattern = [true, false, true, true, false, true, true, false, true];

  const oneChunk = foldMastery([summarize(runSet(pattern))]);

  const threeChunks = foldMastery([
    summarize(runSet(pattern.slice(0, 3))),
    summarize(runSet(pattern.slice(3, 6))),
    summarize(runSet(pattern.slice(6, 9))),
  ]);

  // Same summaries, folded in REVERSE order — commutative, so order must not
  // matter either.
  const reversed = foldMastery(
    [
      summarize(runSet(pattern.slice(0, 3))),
      summarize(runSet(pattern.slice(3, 6))),
      summarize(runSet(pattern.slice(6, 9))),
    ].reverse(),
  );

  // Incremental folding — one session at a time, passing `prior` forward —
  // must agree with folding the whole list at once. This is the shape a real
  // caller uses (a set finishes, its summary is folded onto what came before)
  // and it is the one `evals/mastery.mjs` most needs to protect: a caller
  // that folds incrementally must see IDENTICAL state to one that reloads a
  // whole history and folds it in one call.
  let incremental = new Map();
  for (const chunk of [pattern.slice(0, 3), pattern.slice(3, 6), pattern.slice(6, 9)]) {
    incremental = foldMastery([summarize(runSet(chunk))], incremental);
  }

  const a = masteryOf(oneChunk, TOPIC);
  const b = masteryOf(threeChunks, TOPIC);
  const c = masteryOf(reversed, TOPIC);
  const d = masteryOf(incremental, TOPIC);

  eq("one 9-question set vs three 3-question sets: same attempted/clean/marks/score/level",
    [b.attempted, b.clean, b.marks, b.maxMarks, b.score, b.level],
    [a.attempted, a.clean, a.marks, a.maxMarks, a.score, a.level]);
  eq("folding order (reversed) does not change the result", c, b);
  eq("incremental folding (prior carried forward) agrees with folding all at once", d, b);
}

// ══ 4. XP — STRICTLY FROM GRADED OUTCOMES ══════════════════════════════════

{
  const qs = composeSet(bank(4), { topicIds: [TOPIC], band: BAND, n: 4 });
  let s = startSession({ topicIds: [TOPIC], band: BAND, n: 4 }, qs, Date.UTC(2026, 7, 25));
  s = submit(s, { kind: "options", chosen: ["A"] }, WORKED); // clean solve, +marks
  s = submit(s, { kind: "options", chosen: ["B"] }, WORKED); // wrong, negative marks
  s = submit(s, { kind: "skipped" }, 0); // skipped, 0 marks
  s = submit(s, { kind: "options", chosen: ["A"] }, 1_000); // correct but RUSHED (under floor)

  const xp = xpFromGraded(s.graded);
  ok("XP counts the clean solve's marks", xp > 0, String(xp));
  ok("XP excludes the rushed attempt even though it was technically correct",
    xp === Math.max(0, s.graded[0].marks), `xp=${xp} clean=${s.graded[0].marks}`);
  ok("XP never goes negative from a single wrong/skip",
    xpFromGraded([s.graded[1]]) === 0 && xpFromGraded([s.graded[2]]) === 0);

  const lv = levelForXp(0);
  eq("zero XP is level 1", lv.level, 1);
  ok("the first XP tier is the next-tier target at zero XP", lv.nextTierXp === XP_TIERS[0]);
  const top = levelForXp(XP_TIERS[XP_TIERS.length - 1] + 1);
  ok("XP past the last tier has no next tier", top.nextTierXp === null);
  ok("level rises monotonically with XP", levelForXp(XP_TIERS[0]).level > levelForXp(0).level);
}

console.log(fail ? `${fail} FAILURES of ${count}` : `ALL ${count} PASS`);
process.exit(fail ? 1 : 0);
