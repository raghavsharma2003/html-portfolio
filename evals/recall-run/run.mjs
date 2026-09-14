// WS-R101 — THE RECALL RUN. Readiness's `knows_your_material` part gets its
// writer.
//
//   node evals/recall-run/run.mjs
//   node evals/run.mjs recall-run
//
// Offline, deterministic, $0, no network beyond a local esbuild bundle step
// (fixture-only, nothing fetched), no GPU. One real compiled-agent call path
// is exercised (`api/_engine.gen.js`, the checked-in generated engine bundle)
// with a FAKE `reply` — never a live model call.
//
// ═════════════════════════════════════════════════════════════════════════
// §0. WHAT THIS SUITE PROVES, AND THE ONE FINDING IT REVERSES
// ═════════════════════════════════════════════════════════════════════════
//
// `context/decisions.md#ws-r95-readiness-floor-crossing-is-seeded-never-
// computed` names its own reversal condition in full: "A recall-run writer
// landing anywhere in this tree ... re-run this rehearsal's 'cross the
// floor' step by feeding all SIX inputs ... and if it passes for real, this
// decision is superseded rather than edited in place." §6 below is that
// re-run — not literally WS-R95's own Chromium rehearsal (out of this
// workstream's scope; still open, named in this workstream's final report),
// but the identical claim proved at the layer under it: a REAL
// `runRecallMeasurement` call, over a fake `db` that also answers every
// other Readiness input, produces a stored `vy_recall_run` row that
// `readOwnedReadiness` reads back into a `knowsYourMaterial` value high
// enough, alongside four other genuinely-measured parts, to cross the
// publish floor — with `vy_replica_readiness` NEVER seeded directly.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const API = join(ROOT, "api");

let checks = 0;
function ok(name, cond, extra = "") {
  checks++;
  if (!cond) console.log(`FAIL ${name}${extra ? `   ${extra}` : ""}`);
  assert.ok(cond, name);
  if (cond) console.log(`ok ${checks} - ${name}`);
}
function eq(actual, expected, name) {
  const cond = JSON.stringify(actual) === JSON.stringify(expected);
  if (!cond) console.log(`FAIL ${name}   got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  assert.ok(cond, name);
  checks++;
  console.log(`ok ${checks} - ${name}`);
}
async function threw(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
}

const RECALL = await import(pathToFileURL(join(API, "_recall-run.js")).href);
const {
  generateRecallSet, scoreAnswer, scoreRecallRun, runRecallMeasurement,
  storeRecallRun, recallRunEnabled, RECALL_SET_MIN, RECALL_RUN_METHOD_VERSION,
} = RECALL;

// WS-R118: the keyed set §7/§8 below measure the real scorer against.
const KEYED = await import(pathToFileURL(join(ROOT, "evals/recall-run/keyed.mjs")).href);

const READINESS = await import(pathToFileURL(join(API, "_readiness.js")).href);
const {
  readRecallRun, readOwnedReadiness, readinessScreen,
  READINESS_OVERALL_FLOOR, READINESS_PART_FLOOR,
} = READINESS;

// ── recallRunEnabled — a pure predicate over `env`, checked in isolation ──
ok('recallRunEnabled requires the EXACT string "1"', recallRunEnabled({ RECALL_RUN: "1" }) === true);
for (const off of [undefined, "", "true", "yes", "0"]) {
  ok(`recallRunEnabled(${JSON.stringify(off)}) is off`, recallRunEnabled({ RECALL_RUN: off }) === false);
}
ok("recallRunEnabled defaults to process.env when no env is given", typeof recallRunEnabled() === "boolean");

const ROOM_FIXTURES = await import(pathToFileURL(join(ROOT, "evals/room/fixtures.mjs")).href);
const { loadFixtureAgent, REPLICA_ID, OWNER } = ROOM_FIXTURES;
// `evals/room/fixtures.mjs` names only ONE owner; the second is
// `evals/room-doors/fixtures.mjs`'s own `OWNER_B` value, restated here
// rather than imported from a door-battery-specific fixture file this suite
// otherwise has no reason to depend on.
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const NEVER_RULES = await import(pathToFileURL(join(API, "_never-rules.js")).href);

// ═════════════════════════════════════════════════════════════════════════
// FIXTURE PASSAGES — the "replica's own sources" every §, past §1, draws on
// ═════════════════════════════════════════════════════════════════════════
//
// Deliberately plain, first-person biographical sentences with no claim
// about a THIRD PARTY and nothing that would read as a fact the compiled
// agent needs a citation for — this suite tests the RECALL instrument, not
// the honesty layer sitting under `gatedReply`, and a passage shaped like a
// contestable claim would confound the two.
function passageText(i) {
  return `Story number ${i} from my own life: I spent time learning something new and it changed how I think about my own work, more than I expected it to.`;
}

function contextItemRows(n, startAt = 0) {
  return Array.from({ length: n }, (_, i) => ({
    source_id: `ctx-${startAt + i}`,
    body: passageText(startAt + i),
    created_at: startAt + i,
  }));
}

function sourceDb(state) {
  return async function db(sql) {
    if (/from vy_context_item/.test(sql)) return state.context_item || [];
    if (/from vy_review_card/.test(sql)) return state.review_card || [];
    if (/from vy_interview_answer/.test(sql)) return state.interview_answer || [];
    throw new Error(`sourceDb: unrecognized query: ${sql}`);
  };
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §1: generateRecallSet — deterministic, refused small, grows ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = { context_item: contextItemRows(25) };
  const db = sourceDb(state);
  const a = await generateRecallSet(db, OWNER, REPLICA_ID);
  const b = await generateRecallSet(db, OWNER, REPLICA_ID);
  eq(a.set_hash, b.set_hash, "the same sources produce the SAME set_hash across two independent generations");
  ok("every source row that clears the length floor becomes a question", a.questions.length === 25);
  ok("every question quotes the passage's own first sentence in the fixed template",
    a.questions.every((q) => q.question_text.startsWith('In your own words, tell me more about this: "')
      && q.question_text.includes(q.expected_answer.split(/[.!?]/)[0].trim())));
  ok("the expected answer IS the passage, verbatim (whitespace-collapsed)",
    a.questions[0].expected_answer === passageText(0));

  const small = { context_item: contextItemRows(RECALL_SET_MIN - 1) };
  const smallErr = await threw(() => generateRecallSet(sourceDb(small), OWNER, REPLICA_ID));
  ok(`below ${RECALL_SET_MIN} passages the run is refused by name (recall_set_too_small)`,
    smallErr?.code === "recall_set_too_small" && smallErr?.status === 409);
  eq(smallErr?.details, { found: RECALL_SET_MIN - 1, min: RECALL_SET_MIN }, "the refusal names how many were found and how many are needed");

  // GROWS WITH SOURCES: the same 20, then one more added.
  const twenty = { context_item: contextItemRows(RECALL_SET_MIN) };
  const before = await generateRecallSet(sourceDb(twenty), OWNER, REPLICA_ID);
  eq(before.questions.length, RECALL_SET_MIN, "exactly the minimum passes at exactly the minimum");
  const twentyOne = { context_item: contextItemRows(RECALL_SET_MIN + 1) };
  const after = await generateRecallSet(sourceDb(twentyOne), OWNER, REPLICA_ID);
  eq(after.questions.length, RECALL_SET_MIN + 1, "a new source is a new question");
  ok("the set_hash changes the moment a new source is added", after.set_hash !== before.set_hash);

  // A too-short passage (a filename, a one-line decline) is filtered before
  // it can become a question that asks nothing.
  const withShort = { context_item: [...contextItemRows(RECALL_SET_MIN), { source_id: "ctx-short", body: "ok", created_at: 999 }] };
  const filtered = await generateRecallSet(sourceDb(withShort), OWNER, REPLICA_ID);
  eq(filtered.questions.length, RECALL_SET_MIN, "a too-short passage is filtered, not turned into a question");

  // A literal duplicate (the same words mined twice, once as a context item
  // and once quoted back as a review card's own answer) counts once.
  const dup = {
    context_item: contextItemRows(RECALL_SET_MIN),
    review_card: [{ source_id: "rc-dup", body: passageText(0) }],
  };
  const deduped = await generateRecallSet(sourceDb(dup), OWNER, REPLICA_ID);
  eq(deduped.questions.length, RECALL_SET_MIN, "a passage repeated across two source tables is one question, not two");

  // FIXED CONCATENATION ORDER: context items, then review cards, then
  // interview answers — `generateRecallSet`'s own documented policy.
  const mixed = {
    context_item: contextItemRows(RECALL_SET_MIN),
    review_card: [{ source_id: "rc-1", body: "A completely different sentence about my own habits and how they formed over many years of practice." }],
    interview_answer: [{ source_id: "ia-1", body: "Another distinct sentence, spoken on a call, about a memory that still shapes how I decide things today." }],
  };
  const mixedSet = await generateRecallSet(sourceDb(mixed), OWNER, REPLICA_ID);
  const kinds = mixedSet.questions.map((q) => q.source_kind);
  const lastContext = kinds.lastIndexOf("context_item");
  const firstReview = kinds.indexOf("review_card");
  const firstInterview = kinds.indexOf("interview_answer");
  ok("context items are concatenated before review cards", lastContext < firstReview);
  ok("review cards are concatenated before interview answers", firstReview < firstInterview);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: scoreAnswer — echo=100, empty=0, shuffled strictly between ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const passage = "the quick brown fox jumps over the lazy dog while the old clock ticks softly in the corner of the quiet room";
  // A FIXED, hand-authored shuffle — never a random one, so this suite is
  // deterministic across every run rather than flaky on an unlucky seed.
  const shuffled = "room ticks corner dog jumps clock lazy quiet the softly the of fox brown quick in the old while over";
  const echoScore = scoreAnswer(passage, passage);
  const emptyScore = scoreAnswer(passage, "");
  const shuffledScore = scoreAnswer(passage, shuffled);
  eq(echoScore, 100, "an answer that echoes the passage scores 100");
  eq(emptyScore, 0, "an empty answer scores 0");
  ok("the SAME WORDS in a different order score strictly between the two",
    shuffledScore > 0 && shuffledScore < 100, `shuffled=${shuffledScore}`);
  ok("...and specifically nowhere near either extreme (both terms are actually blended)",
    shuffledScore >= 20 && shuffledScore <= 80, `shuffled=${shuffledScore}`);

  // Unrelated content scores near zero but is not necessarily exactly 0 —
  // a stray shared word ("the") is real vocabulary overlap and the scorer
  // is not asked to be a plagiarism detector.
  const unrelated = scoreAnswer(passage, "monsoon prices rose sharply across three states this quarter according to the ministry");
  ok("unrelated content scores low", unrelated < 30, `unrelated=${unrelated}`);

  // Case and punctuation are not the test.
  eq(scoreAnswer(passage, passage.toUpperCase() + "!!!"), 100, "case and punctuation do not change an echo's score");

  // ── THE NEGATIVE CONTROL ────────────────────────────────────────────────
  // `RECALL_ORDER_WEIGHT`'s own docstring promise: without the order term, a
  // scorer built from vocabulary alone cannot tell a genuine paraphrase (or
  // an echo) apart from the SAME WORDS IN THE WRONG ORDER. Proved by
  // patching the real module (never a second, hand-written copy of the
  // scorer) and re-running the identical two calls.
  console.log("\n── §2b: negative control — an order-blind scorer cannot tell them apart ──");
  const source = readFileSync(join(API, "_recall-run.js"), "utf8");
  const GUARD = "  const raw = RECALL_UNIGRAM_WEIGHT * unigramRecall + RECALL_ORDER_WEIGHT * orderRatio;";
  ok("the negative control finds the exact scoring line it means to patch", source.includes(GUARD));
  const patched = source.split(GUARD).join("  const raw = unigramRecall;");
  ok("the patch actually changed the source", patched !== source);
  const rewritten = patched.replace(
    /from "\.\/([^"]+)"/g,
    (_match, rel) => `from "${pathToFileURL(join(API, rel)).href}"`,
  );
  const dir = mkdtempSync(join(tmpdir(), "recall-run-nc-"));
  const file = join(dir, "patched.mjs");
  writeFileSync(file, rewritten);
  const NC = await import(pathToFileURL(file).href);
  const ncEcho = NC.scoreAnswer(passage, passage);
  const ncShuffled = NC.scoreAnswer(passage, shuffled);
  eq(ncEcho, 100, "the patched (order-blind) scorer still gives an echo 100 — same words, all present");
  eq(ncShuffled, 100, "...and gives the SHUFFLED answer 100 too — INDISTINGUISHABLE from the echo, which is exactly the defect the order term exists to close");
  ok("the REAL module does NOT have this defect (its shuffled score is strictly below 100)", shuffledScore < 100);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: scoreRecallRun — the real compiled agent, a fake reply ──");
// ═════════════════════════════════════════════════════════════════════════
const { engine, SHEET } = await loadFixtureAgent(ROOT);
const module = engine.sheetToModule(SHEET);

function echoReplyOver(questions) {
  const byQuestion = new Map(questions.map((q) => [q.question_text, q.expected_answer]));
  return async (_compiled, turns) => byQuestion.get(turns[turns.length - 1]?.content || "") || "";
}

{
  const set = await generateRecallSet(sourceDb({ context_item: contextItemRows(RECALL_SET_MIN) }), OWNER, REPLICA_ID);
  const echoed = await scoreRecallRun(set.questions, { engine, module, reply: echoReplyOver(set.questions) });
  eq(echoed.n, RECALL_SET_MIN, "one row per question");
  ok("an echoed passage scores well above the part floor", echoed.score >= READINESS_PART_FLOOR, `score=${echoed.score}`);
  ok("every row answered something", echoed.rows.every((r) => r.answered));
  ok(`the stored method names ${RECALL_RUN_METHOD_VERSION}`, echoed.method.startsWith(RECALL_RUN_METHOD_VERSION));

  const silent = await scoreRecallRun(set.questions, { engine, module, reply: async () => "" });
  eq(silent.score, 0, "a reply lane that answers nothing scores 0 overall");
  ok("...and every row is unanswered", silent.rows.every((r) => !r.answered && r.score === 0));

  // A reply-lane failure on ONE question is a zero for THAT question, never
  // a thrown run — one bad turn must not blank the whole measurement.
  const flaky = await scoreRecallRun(set.questions, {
    engine, module,
    reply: async (compiled, turns) => {
      if (turns[turns.length - 1]?.content === set.questions[0].question_text) {
        throw new Error("simulated reply-lane failure");
      }
      return echoReplyOver(set.questions)(compiled, turns);
    },
  });
  ok("a single failing question does not throw the whole run", flaky.n === RECALL_SET_MIN);
  ok("...and the rest still scored well", flaky.score > 0);

  // NEVER-RULES ride through to `gatedReply` exactly as every other reply
  // lane's — a rule matching the echoed answer suppresses THAT question's
  // text and names itself on the row, others untouched.
  const targetAnswer = set.questions[0].expected_answer;
  // COMPILED, `scoreRecallRun`'s own contract (`compileNeverRules`, the same
  // shape `api/_room-surface.js::roomNeverRules` hands every Room reply
  // lane) — a raw `{pattern}` row would never match anything.
  const neverRules = NEVER_RULES.compileNeverRules([{ rule_id: "nr-1", pattern: targetAnswer.slice(0, 24), revoked_at: null }]);
  const gated = await scoreRecallRun(set.questions, { engine, module, reply: echoReplyOver(set.questions), neverRules });
  eq(gated.rows[0].answered, false, "a matching never-rule suppresses the answer to the question it matches");
  ok("...and names the rule that fired", Boolean(gated.rows[0].never_rule));
  ok("...while every OTHER question is unaffected", gated.rows.slice(1).every((r) => r.answered));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: runRecallMeasurement / storeRecallRun — the write, gated ──");
// ═════════════════════════════════════════════════════════════════════════
//
// A hand-written SQL emulation, `offline-mocks-cannot-type-check-sql`'s own
// caveat restated: this proves the CONTROL FLOW the real
// `RECALL_RUN_INSERT_SQL` CTE describes (guard, supersede, insert, all
// three gated on the same predicate) — never that the real statement
// PARSES or that its types are correct. That is `scripts/relcheck.mjs`'s
// and the live-EXPLAIN's job, named in this workstream's own final report.
function measurementDb(state) {
  return async function db(sql, params) {
    if (/r\.lifecycle <> 'purging'/.test(sql)) {
      const [rid, owner] = params;
      const row = (state.replicas || []).find((r) => r.replica_id === rid && r.owner_user_id === owner);
      return row ? [{ replica_id: row.replica_id }] : [];
    }
    if (/from vy_context_item/.test(sql)) return state.context_item || [];
    if (/from vy_review_card/.test(sql)) return state.review_card || [];
    if (/from vy_interview_answer/.test(sql)) return state.interview_answer || [];
    if (/from vy_review_never_rule/.test(sql)) return state.never_rules || [];
    if (/insert into vy_recall_run/.test(sql)) {
      const [rid, owner, score, n, method, setHash] = params;
      const now = state.clock();
      const withinHour = (state.recall_runs || []).some((r) =>
        r.replica_id === rid && r.owner_user_id === owner && !r.superseded_at && now - r.created_at < 3_600_000);
      if (withinHour) return [];
      for (const r of state.recall_runs || []) {
        if (r.replica_id === rid && r.owner_user_id === owner && !r.superseded_at) r.superseded_at = now;
      }
      state.recall_runs = state.recall_runs || [];
      const row = { run_id: `run-${state.recall_runs.length + 1}`, replica_id: rid, owner_user_id: owner, score, n, method, set_hash: setHash, created_at: now, superseded_at: null };
      state.recall_runs.push(row);
      return [{ run_id: row.run_id, created_at: new Date(now).toISOString() }];
    }
    if (/select r\.score, r\.n, r\.method, r\.created_at/.test(sql)) {
      const [rid, owner] = params;
      const rows = (state.recall_runs || [])
        .filter((r) => r.replica_id === rid && r.owner_user_id === owner && !r.superseded_at)
        .sort((a, b) => b.created_at - a.created_at);
      const row = rows[0];
      return row ? [{ score: row.score, n: row.n, method: row.method, created_at: new Date(row.created_at).toISOString() }] : [];
    }
    throw new Error(`measurementDb: unrecognized query: ${sql}`);
  };
}

const sheetRow = { sheet_id: "sh-1", agent_id: "agent-1", status: "published", consent_artifact_id: "consent-1", slug: SHEET.slug, sheet: SHEET };

// `storeRecallRun` in isolation, one level under `runRecallMeasurement`.
{
  const state = { recall_runs: [], clock: () => Date.parse("2026-09-05T09:00:00.000Z") };
  const db = measurementDb(state);
  const stored = await storeRecallRun(db, OWNER, REPLICA_ID, { score: 91, n: 22, method: "recall-run/v1: 22 questions" }, "f".repeat(64));
  ok("storeRecallRun writes a row and returns its id", Boolean(stored?.run_id));
  const again = await storeRecallRun(db, OWNER, REPLICA_ID, { score: 91, n: 22, method: "recall-run/v1: 22 questions" }, "f".repeat(64));
  ok("a second store call inside the same hour is refused (returns null, never throws)", again === null);
}

{
  const T0 = Date.parse("2026-09-05T10:00:00.000Z");
  const state = {
    replicas: [{ replica_id: REPLICA_ID, owner_user_id: OWNER }],
    context_item: contextItemRows(RECALL_SET_MIN + 3),
    clock: () => T0,
  };
  const db = measurementDb(state);
  const baseDeps = { env: { RECALL_RUN: "1" }, sheetRow, engine, now: T0 };
  // `reply` here is a FACTORY over the questions `generateRecallSet` built
  // internally — `runRecallMeasurement` does not expose the set before
  // scoring, so the reply function looks up by TEXT rather than by a
  // closure over a pre-known list, `echoReplyOver`'s own shape reused with
  // a self-building map instead.
  const echoAnyQuestion = async (_compiled, turns) => {
    const text = turns[turns.length - 1]?.content || "";
    const m = text.match(/^In your own words, tell me more about this: "(.+)"$/);
    return m ? state.context_item.map((r) => r.body).find((b) => b.startsWith(m[1].split(":")[0])) || m[1] : "";
  };

  // OFF BY DEFAULT: refused before ANY query runs.
  const throwingDb = async (sql) => { throw new Error(`should never be queried while RECALL_RUN is off: ${sql}`); };
  const offErr = await threw(() => runRecallMeasurement(throwingDb, OWNER, REPLICA_ID, { ...baseDeps, env: {}, db: throwingDb, reply: echoAnyQuestion }));
  ok("RECALL_RUN unset refuses by name (recall_run_off) before touching the database", offErr?.code === "recall_run_off" && offErr?.status === 503);

  // TOO FEW SOURCES: refused before any model call.
  const tinyState = { replicas: [{ replica_id: REPLICA_ID, owner_user_id: OWNER }], context_item: contextItemRows(5), clock: () => T0 };
  const tinyErr = await threw(() => runRecallMeasurement(measurementDb(tinyState), OWNER, REPLICA_ID, { ...baseDeps, reply: echoAnyQuestion }));
  ok("too few sources refuses by name (recall_set_too_small)", tinyErr?.code === "recall_set_too_small");

  // OWNERSHIP: a different owner's bearer against the same replica_id.
  const stolenErr = await threw(() => runRecallMeasurement(db, OWNER_B, REPLICA_ID, { ...baseDeps, reply: echoAnyQuestion }));
  ok("a different owner's bearer is refused replica_not_found, never another owner's data", stolenErr?.code === "replica_not_found" && stolenErr?.status === 404);

  // THE REAL RUN, first time: stores a row.
  const first = await runRecallMeasurement(db, OWNER, REPLICA_ID, { ...baseDeps, reply: echoAnyQuestion });
  ok("the first run stores a row and returns a run_id", Boolean(first.run_id));
  ok("its score is well above the part floor (an echoed answer)", first.score >= READINESS_PART_FLOOR, `score=${first.score}`);

  // RATE LIMIT: a second call within the hour is refused, and the standing
  // row is UNTOUCHED (not superseded by a refused call).
  const rateErr = await threw(() => runRecallMeasurement(db, OWNER, REPLICA_ID, { ...baseDeps, reply: echoAnyQuestion }));
  ok("a second run inside the hour is refused by name (recall_run_rate_limited)", rateErr?.code === "recall_run_rate_limited" && rateErr?.status === 429);
  ok("the refused call did NOT supersede the standing row", state.recall_runs.filter((r) => !r.superseded_at).length === 1);

  // AN HOUR LATER: a second real run supersedes the first.
  state.clock = () => T0 + 61 * 60_000;
  const second = await runRecallMeasurement(db, OWNER, REPLICA_ID, { ...baseDeps, reply: echoAnyQuestion });
  ok("an hour later, a new run is accepted", Boolean(second.run_id) && second.run_id !== first.run_id);
  const standing = state.recall_runs.filter((r) => !r.superseded_at);
  eq(standing.length, 1, "exactly one unsuperseded row exists after the second run");
  eq(standing[0].run_id, second.run_id, "...and it is the NEW one");
  ok("the first row is now superseded", state.recall_runs.find((r) => r.run_id === first.run_id)?.superseded_at === T0 + 61 * 60_000);

  // readRecallRun reads the standing row back in the exact shape
  // `knowsYourMaterial` consumes.
  const read = await readRecallRun(db, OWNER, REPLICA_ID);
  eq(read.score, second.score, "readRecallRun's score matches the stored run");
  eq(read.n, second.n, "...and n");
  ok("...and a computed_at", Boolean(read.computed_at));

  // A REPLICA WITH NO RUN AT ALL still answers null, exactly as before this
  // workstream — the honest state readRecallRun always returns absent an
  // actual measurement.
  const neverMeasured = await readRecallRun(db, OWNER, "00000000-0000-4000-8000-000000000000");
  eq(neverMeasured, null, "a replica with no stored run reads null, not a fabricated zero");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: knowsYourMaterial reads the stored shape directly ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const screen = readinessScreen({
    now: Date.parse("2026-09-05T12:00:00.000Z"),
    claims: { mined: 40, reviewed: 30, approved: 30 },
    recall: { score: 88, n: 24, method: `${RECALL_RUN_METHOD_VERSION}: 24 questions`, computed_at: "2026-09-05T09:00:00.000Z" },
    fidelity: null,
    owner_ceiling: null,
    mirror: { sounds_right: 0, fix_it: 0, latest_at: null },
    safety: { never_say_rules: 0, person_model_approved: false, escalation_route: false },
    freshness: { claims_total: 0, claims_valid: 0, newest_source_at: null },
  });
  const part = screen.parts.find((p) => p.id === "knows_your_material");
  eq(part.value, 88, "the part's value IS the stored run's score, not a re-derived correct/total ratio");
  eq(part.n, 24, "n comes from the stored run");
  ok('the method sentence says "measured on N questions from your own material" and never a bare number',
    part.method === "Held-out recall run: measured on 24 questions from your own material.");
  ok("measured_at is the run's own computed_at", part.measured_at === "2026-09-05T09:00:00.000Z");

  const unmeasured = readinessScreen({
    now: Date.parse("2026-09-05T12:00:00.000Z"),
    claims: { mined: 0, reviewed: 0, approved: 0 },
    recall: null,
    fidelity: null, owner_ceiling: null,
    mirror: { sounds_right: 0, fix_it: 0, latest_at: null },
    safety: { never_say_rules: 0, person_model_approved: false, escalation_route: false },
    freshness: { claims_total: 0, claims_valid: 0, newest_source_at: null },
  });
  ok("with no recall run at all, the part is still honestly unmeasured",
    !unmeasured.parts.find((p) => p.id === "knows_your_material").measured);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: THE CAPSTONE — the publish lock crosses through a REAL run ──");
// ═════════════════════════════════════════════════════════════════════════
//
// Every one of Readiness's FIVE inputs answered from a fake `db` that also
// answers `runRecallMeasurement`'s own queries — the SAME `db` function for
// both, so the recall run this section stores is read back by the SAME
// mechanism a live `GET /api/readiness` would use. `vy_replica_readiness`
// (the SNAPSHOT table) is written only by `readOwnedReadiness` itself, at
// the end, exactly as production does — never seeded.
{
  const T0 = Date.parse("2026-09-05T14:00:00.000Z");
  const iso = (daysAgo) => new Date(T0 - daysAgo * 86_400_000).toISOString();
  const state = {
    replicas: [{ replica_id: REPLICA_ID, owner_user_id: OWNER }],
    context_item: contextItemRows(RECALL_SET_MIN + 5),
    never_rules: [],
    teacher_sheet: sheetRow,
    recall_runs: [],
    readiness_snapshots: [],
    clock: () => T0,
  };
  const echoAnyQuestion = async (_compiled, turns) => {
    const text = turns[turns.length - 1]?.content || "";
    const m = text.match(/^In your own words, tell me more about this: "(.+)"$/);
    if (!m) return "";
    const stem = m[1].split(":")[0];
    return state.context_item.map((r) => r.body).find((b) => b.startsWith(stem)) || m[1];
  };

  const db = async (sql, params) => {
    // ── readReadinessInputs' six reads, plus the ownership predicate the
    //    same text also serves for `runRecallMeasurement` ──────────────
    if (/r\.lifecycle <> 'purging'/.test(sql)) {
      const [rid, owner] = params;
      const row = state.replicas.find((r) => r.replica_id === rid && r.owner_user_id === owner);
      return row ? [{ replica_id: row.replica_id }] : [];
    }
    if (/from vy_replica_claim c/.test(sql)) {
      return [{ mined: 40, reviewed: 34, approved: 34, never_say_rules: 5, claims_valid: 30 }];
    }
    if (/from vy_voice_fidelity f/.test(sql)) {
      return [{ score: JSON.stringify({ mean: 0.75, windows: 12 }), status: "warn", computed_at: iso(1) }];
    }
    if (/from vy_replica_voice_genome g/.test(sql)) {
      return [{ ceiling: "0.86", windows: "8", measured_at: iso(9) }];
    }
    if (/from vy_mirror_feedback m/.test(sql)) {
      return [{ sounds_right: 30, fix_it: 5, latest_at: iso(3) }];
    }
    if (/from vy_replica_profile p/.test(sql)) {
      return [{ person_model_approved_at: iso(5), person_model_approved: true, escalation_route: true }];
    }
    if (/newest_source_at/.test(sql) && /vy_replica_source s/.test(sql)) {
      return [{ newest_source_at: iso(11) }];
    }
    // ── recall run: source reads, teacher sheet, never-rules, the write, the read ──
    if (/from vy_context_item/.test(sql)) return state.context_item;
    if (/from vy_review_card/.test(sql)) return [];
    if (/from vy_interview_answer/.test(sql)) return [];
    if (/from vy_review_never_rule/.test(sql)) return state.never_rules;
    if (/from vy_teacher_sheet s/.test(sql)) return [state.teacher_sheet];
    if (/insert into vy_recall_run/.test(sql)) {
      const [rid, owner, score, n, method, setHash] = params;
      const now = state.clock();
      for (const r of state.recall_runs) if (!r.superseded_at) r.superseded_at = now;
      const row = { run_id: "run-capstone", replica_id: rid, owner_user_id: owner, score, n, method, set_hash: setHash, created_at: now, superseded_at: null };
      state.recall_runs.push(row);
      return [{ run_id: row.run_id, created_at: new Date(now).toISOString() }];
    }
    if (/select r\.score, r\.n, r\.method, r\.created_at/.test(sql)) {
      const row = state.recall_runs.find((r) => !r.superseded_at);
      return row ? [{ score: row.score, n: row.n, method: row.method, created_at: new Date(row.created_at).toISOString() }] : [];
    }
    // ── the readiness snapshot itself — written by readOwnedReadiness,
    //    never seeded by this test ──────────────────────────────────────
    if (/insert into vy_replica_readiness/.test(sql)) {
      state.readiness_snapshots.push(params);
      return [{ readiness_id: "snap-1", computed_at: new Date(state.clock()).toISOString() }];
    }
    throw new Error(`capstone db: unrecognized query: ${sql}`);
  };

  // BEFORE: no run has ever been stored, so the part is unmeasured and the
  // screen is locked exactly as `evals/readiness/run.mjs`'s own "today"
  // fixture describes for every real replica right now.
  const before = await readOwnedReadiness(db, OWNER, REPLICA_ID, { now: T0 });
  const beforePart = before.parts.find((p) => p.id === "knows_your_material");
  ok("before any run, knows_your_material is honestly unmeasured", !beforePart.measured);
  ok("...and the screen is locked", before.publish_locked === true);

  // THE REAL RUN. RECALL_RUN=1, a fake `reply` that echoes the passage back
  // (never seeding `vy_recall_run` directly — this is a full pass through
  // `generateRecallSet` -> `scoreRecallRun` -> `storeRecallRun`).
  const run = await runRecallMeasurement(db, OWNER, REPLICA_ID, {
    env: { RECALL_RUN: "1" }, engine, reply: echoAnyQuestion, now: T0,
  });
  ok("the capstone run stores a real, scored row", Boolean(run.run_id) && run.score > 0);

  // AFTER: the SAME db, re-read through readOwnedReadiness — never a seed.
  const after = await readOwnedReadiness(db, OWNER, REPLICA_ID, { now: T0 + 1000 });
  const afterPart = after.parts.find((p) => p.id === "knows_your_material");
  ok("after the real run, knows_your_material is measured", afterPart.measured === true);
  eq(afterPart.value, run.score, "...at exactly the score the real run produced (no re-derivation, no rounding drift)");
  ok("every one of the five parts is now measured (the OTHER four came from the fake db's own genuinely-measured rows, not a seed)",
    after.parts.every((p) => p.measured));
  ok("the overall is a real number, not null", after.overall !== null);
  ok(`the overall clears the publish floor (${READINESS_OVERALL_FLOOR})`, after.overall >= READINESS_OVERALL_FLOOR, `overall=${after.overall}`);
  ok(`every part clears the part floor (${READINESS_PART_FLOOR})`, after.parts.every((p) => p.value >= READINESS_PART_FLOOR), JSON.stringify(after.parts.map((p) => [p.id, p.value])));
  eq(after.publish_locked, false, "THE PUBLISH LOCK CROSSES — through a real recall run and four other real measurements, never a seed of vy_replica_readiness");
  ok("vy_replica_readiness was written by readOwnedReadiness itself, exactly twice (before, after) — never pre-seeded by this test",
    state.readiness_snapshots.length === 2);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §7: THE KEYED SET — WS-R118, the scorer calibrated ──");
// ═════════════════════════════════════════════════════════════════════════
//
// `evals/recall-run/keyed.mjs`'s own header has the full account: 60
// hand-authored (passage, answer) pairs, six classes, a band per class a
// person would sign. This section measures the REAL `scoreAnswer` against
// every case, logs per-class agreement (n and method, `context/measurements
// .md`'s own house rule), and gates on it — a regression here means a future
// change to the scorer moved it OFF what a person would call correct, which
// is exactly the thing WS-R101 shipped with no way to detect.
{
  const byClass = new Map();
  const misses = [];
  for (const c of KEYED.RECALL_KEYED_CASES) {
    const [lo, hi] = KEYED.RECALL_KEYED_BANDS[c.cls];
    const score = scoreAnswer(c.passage, c.answer);
    const inBand = score >= lo && score <= hi;
    const row = byClass.get(c.cls) || { n: 0, ok: 0 };
    row.n++;
    if (inBand) row.ok++;
    byClass.set(c.cls, row);
    if (!inBand) misses.push(`${c.id}: score=${score} not in [${lo},${hi}] (${c.reason})`);
  }
  let totalOk = 0, totalN = 0;
  for (const cls of KEYED.RECALL_KEYED_CLASSES) {
    const row = byClass.get(cls) || { n: 0, ok: 0 };
    totalOk += row.ok; totalN += row.n;
    console.log(`  ${cls}: ${row.ok}/${row.n} agree with the keyed band`);
  }
  eq(totalN, 60, "the keyed set carries at least the 60 cases WS-R118's own brief requires");
  ok(`every keyed case agrees with the scorer measured on the current tree (n=${totalN})`,
    totalOk === totalN, misses.join("\n  "));
  // §0 of `api/_recall-run.js`'s own header + `context/measurements.md
  // #ws-r118-recall-scorer-keyed-agreement`: BEFORE this workstream, the
  // identical 60-case keyed set measured against WS-R101's original
  // `scoreAnswer` (vocabulary + order, no stemming, no synonyms, no
  // contradiction penalty, no evasion floor, and the Devanagari matra bug)
  // agreed on 49/60 — every class but contradiction (0/10) and evasive
  // (9/10, one Hindi case 2 points over its own ceiling). That number is not
  // re-derived here (the pre-WS-R118 function no longer exists in this
  // file to import), but it is the "before" this section's 60/60 is the
  // "after" of, logged in full with method and date in
  // `context/measurements.md`.
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §8: NEGATIVE CONTROLS — the contradiction cap and the evasion floor are load-bearing ──");
// ═════════════════════════════════════════════════════════════════════════
//
// Same technique as §2b above: patch the REAL module's source text, remove
// exactly one guard, re-import the patched copy, and show the assertions
// this file already makes now FAIL against it. A guard whose removal changes
// nothing is not a guard.
{
  const source = readFileSync(join(API, "_recall-run.js"), "utf8");

  // ── (a) remove the contradiction cap: the contradiction class collapses ──
  const CONTRADICTION_GUARD = "  if (hasContradiction(passageWordsRaw, answerWordsRaw)) {\n"
    + "    score = Math.min(score, RECALL_CONTRADICTION_CAP);\n"
    + "  }\n";
  ok("the contradiction-cap negative control finds the exact guard it means to patch",
    source.includes(CONTRADICTION_GUARD));
  const patchedNoContradiction = source.split(CONTRADICTION_GUARD).join("");
  ok("...and the patch actually changed the source", patchedNoContradiction !== source);

  // ── (b) remove the evasion floor: "I don't know" scores well above 10 ──
  const EVASION_GUARD = "  if (answerWordsRaw.length < RECALL_EVASION_MIN_WORDS) {\n"
    + "    score = Math.min(score, RECALL_EVASION_CAP);\n"
    + "  }\n";
  ok("the evasion-floor negative control finds the exact guard it means to patch",
    source.includes(EVASION_GUARD));
  const patchedNoEvasion = source.split(EVASION_GUARD).join("");
  ok("...and the patch actually changed the source", patchedNoEvasion !== source);

  async function importPatched(text, tag) {
    const rewritten = text.replace(
      /from "\.\/([^"]+)"/g,
      (_match, rel) => `from "${pathToFileURL(join(API, rel)).href}"`,
    );
    const dir = mkdtempSync(join(tmpdir(), `recall-run-${tag}-`));
    const file = join(dir, "patched.mjs");
    writeFileSync(file, rewritten);
    return import(pathToFileURL(file).href);
  }

  const NC_A = await importPatched(patchedNoContradiction, "nc-contradiction");
  const contraCases = KEYED.RECALL_KEYED_CASES.filter((c) => c.cls === "contradiction");
  const [contraLo, contraHi] = KEYED.RECALL_KEYED_BANDS.contradiction;
  const contraInBand = contraCases.filter((c) => {
    const s = NC_A.scoreAnswer(c.passage, c.answer);
    return s >= contraLo && s <= contraHi;
  }).length;
  ok(`without the contradiction cap, the contradiction class no longer agrees (was 10/10, patched=${contraInBand}/10)`,
    contraInBand < contraCases.length);

  const NC_B = await importPatched(patchedNoEvasion, "nc-evasion");
  // A purpose-built example, separate from the keyed set: a passage that
  // happens to open with the exact words an "I don't know"-shaped answer
  // would reuse, so removing the floor has real overlap to inflate the
  // score with — the same reason `evals/readiness/run.mjs` §4 removes a
  // guard against fixtures chosen to expose it, not fixtures that would
  // pass either way.
  const idkPassage = "I do not know why I quit my old job, and honestly I have never looked back.";
  const idkAnswer = "I do not know.";
  const idkWithFloor = scoreAnswer(idkPassage, idkAnswer);
  const idkWithoutFloor = NC_B.scoreAnswer(idkPassage, idkAnswer);
  ok(`the real scorer holds "I do not know." to the evasive band (scored ${idkWithFloor})`,
    idkWithFloor >= 0 && idkWithFloor <= 10);
  ok(`...but WITHOUT the evasion floor, the same answer scores above 10 (scored ${idkWithoutFloor})`,
    idkWithoutFloor > 10, `got ${idkWithoutFloor}`);
}

console.log(`\n${checks} checks, all pass.`);
