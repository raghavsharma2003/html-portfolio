// api/_recall-run.js — WS-R101: the recall run. Readiness's `knows_your_material`
// part has always rendered "not measured yet" (`api/_readiness.js` §4) because
// nothing in this tree ever generated a held-out question set from a replica's
// own sources and scored a real answer against it. This file is that writer.
//
// ═════════════════════════════════════════════════════════════════════════
// WHY THE QUESTION SET IS BUILT BY A TEMPLATE, NEVER BY A MODEL CALL
// ═════════════════════════════════════════════════════════════════════════
//
// A model asked to "write a question this passage answers" is a model asked
// to grade its own exam: the same weights that might fail to retrieve the
// passage are the weights writing the question that tests retrieving it, and
// a systematic blind spot in the model becomes a systematic blind spot in the
// eval, invisibly. `generateRecallSet` below is a PURE, DETERMINISTIC template
// over rows already in the database — a passage's own first sentence, wrapped
// in one fixed sentence. Two runs over the same sources produce byte-identical
// questions (`evals/recall-run/run.mjs` asserts the hash), and the only model
// call anywhere in this file is the ONE the question is actually testing:
// the compiled agent answering it, through `gatedReply`, the one door.
//
// ═════════════════════════════════════════════════════════════════════════
// WHY THE SCORER IS ORDER-SENSITIVE, AND WHAT THAT COSTS
// ═════════════════════════════════════════════════════════════════════════
//
// `evals/recallbench` (Meera's memory benchmark) scores retrieval by VERBATIM
// SUBSTRING containment of an expected key in a rendered block — precise, but
// built for short, distinctive names and claims, not a full passage of prose a
// compiled agent will paraphrase. Its shape is restated here rather than
// imported unchanged (its `retrievedFrom`/`keysOf` are wired to a fixture's
// `dyad` object and a `memories` block heading structure that has no
// equivalent here — nothing pure to import). What is kept is the METHOD:
// score what actually reached the answer, not an internal row list, and treat
// a word that only appears because the model happened to reuse it as weaker
// evidence than a whole ordered run of the source's own words.
//
// `scoreAnswer` blends two components: how much of the passage's own
// VOCABULARY reached the answer (order-blind, `RECALL_UNIGRAM_WEIGHT`), and
// how much of the passage's own WORD ORDER survived, via a longest-common-
// subsequence ratio (`RECALL_ORDER_WEIGHT`). The order term exists for exactly
// one purpose, proven in `evals/recall-run/run.mjs`'s own negative control: a
// scorer built from vocabulary alone cannot tell a genuine paraphrase apart
// from the SAME WORDS IN THE WRONG ORDER, and a model that memorised a bag of
// facts without their relationships would pass such a scorer every time.
import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";
import { replicaId } from "./_replica.js";
import { gatedReply, loadEngine, makeCtx, splitForLimit, think } from "./_surface.js";
import { mirrorReplyAgent } from "./_mirrorcall-store.js";
import { mirrorReplyModule } from "./_mirrorcall-reply.js";
import { loadNeverRules } from "./_review-queue.js";
import { compileNeverRules } from "./_never-rules.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class RecallRunError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

function fail(code, status = 400, details) {
  throw new RecallRunError(code, status, details);
}

function requireUuid(value, code) {
  const text = String(value || "").trim().toLowerCase();
  if (!UUID.test(text)) fail(code, 400);
  return text;
}

/** `RECALL_RUN` — off by default. The reply seam this file drives costs money
 *  per question in production (`think`, a real model call), so a "Measure now"
 *  press must not be reachable until an operator turns this on.
 *  docs/gurukul/ENV-MANIFEST.md's own section names the exact value. */
export function recallRunEnabled(env = process.env) {
  return String(env?.RECALL_RUN || "") === "1";
}

// ─────────────────────────────────────────────────────────────────────────
// THE QUESTION SET
// ─────────────────────────────────────────────────────────────────────────

/** Below this many passages a run would be an anecdote wearing a score, the
 *  same MIN_* discipline `api/_readiness.js` already applies to its other
 *  parts (`MIN_MIRROR_FEEDBACK`, `MIN_VALIDITY_CLAIMS`). Refused by name
 *  rather than silently scored on fewer. */
export const RECALL_SET_MIN = 20;

/** A passage this short (after whitespace collapse) cannot carry a real
 *  question — most such rows are a title, a filename, or a one-line reply
 *  the AI declined, and a question built from it would ask nothing. */
const RECALL_PASSAGE_MIN_CHARS = 40;

/** A passage longer than this is truncated at the nearest word boundary. The
 *  scorer's LCS term is O(n*m); this bound plus `LCS_WORD_CAP` below keep one
 *  question's scoring cost flat regardless of how large a source document
 *  was. The QUESTION only ever quotes the first sentence, so truncating the
 *  tail of the EXPECTED ANSWER never changes what is asked, only how much of
 *  a long document counts as "the passage" being tested. */
const RECALL_PASSAGE_MAX_CHARS = 1200;

const CONTEXT_ITEM_SQL = `select i.item_id as source_id, t.body as body
   from vy_context_item i
   join vy_context_item_text t on t.item_id = i.item_id
  where i.replica_id=$1::uuid and i.owner_user_id=$2::uuid
    and i.status in ('mined','routed')
  order by i.created_at asc
  limit 500`;

// 'sounds_right' only, deliberately narrower than every decided card
// (`state in ('sounds_right','fixed','never')`): a 'fixed' card's own
// `answer_text` is the answer the owner corrected AWAY from, and a 'never'
// card's answer is one the owner forbade outright — scoring a held-out run
// against either would ask the clone to reproduce the wrong thing and call a
// low score progress. Only a card the owner tapped "sounds right" is a
// passage this run may hold the clone to.
const REVIEW_CARD_SQL = `select c.card_id as source_id, c.answer_text as body
   from vy_review_card c
  where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid
    and c.state = 'sounds_right' and c.answer_text <> ''
  order by c.created_at asc
  limit 500`;

// An interview answer (075) carries no text of its own — `vy_interview_answer`
// is a shape-and-provenance row, and the words the owner actually said live on
// the `vy_mirror_window` it points at. Only a WINDOW WHOSE OWN TRANSCRIPT
// EXISTS is a passage: `asr_state='transcribed'` excludes a window still
// pending or one ASR dropped, which would otherwise join to an empty string
// and be filtered by the length check below anyway, less legibly.
const INTERVIEW_ANSWER_SQL = `select a.answer_id as source_id, w.transcript as body
   from vy_interview_answer a
   join vy_mirror_window w on w.window_id = a.window_id
  where a.replica_id=$1::uuid and a.owner_user_id=$2::uuid
    and w.asr_state = 'transcribed' and w.transcript <> ''
  order by a.created_at asc
  limit 500`;

function normalizePassage(text) {
  const collapsed = String(text || "").replace(/\s+/g, " ").trim();
  if (collapsed.length <= RECALL_PASSAGE_MAX_CHARS) return collapsed;
  const cut = collapsed.slice(0, RECALL_PASSAGE_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > RECALL_PASSAGE_MAX_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/** The passage's own first sentence, PURE. Sentence-terminal punctuation
 *  within the first 240 characters wins; a passage with none (a single long
 *  clause, common in a spoken transcript) falls back to its first 160
 *  characters rather than growing the "question" to the whole passage. */
function firstSentence(passage) {
  const match = passage.match(/^.{1,240}?[.!?](?=\s|$)/);
  if (match) return match[0].trim();
  return passage.length > 160 ? passage.slice(0, 160).trim() : passage;
}

/** THE ONE TEMPLATE. One fixed sentence, no branching on source kind, no
 *  variation a future edit could accidentally make source-dependent — a
 *  question generator that phrased context-item questions differently from
 *  interview questions would be scoring the PHRASING gap, not the recall gap. */
function questionFromSentence(sentence) {
  return `In your own words, tell me more about this: "${sentence}"`;
}

/**
 * Build the held-out question set from a replica's own sources: mined/routed
 * context items, the review queue's approved ("sounds right") cards, and
 * transcribed interview answers. Deterministic for a fixed set of source rows
 * (`evals/recall-run/run.mjs` asserts the hash), refused by name below
 * `RECALL_SET_MIN`. No model call — see this file's header.
 */
export async function generateRecallSet(db, ownerUserId, replicaIdValue, _deps = {}) {
  if (typeof db !== "function") fail("recall_run_db_required", 503);
  const owner = requireUuid(ownerUserId, "owner_required");
  const rid = requireUuid(replicaId(replicaIdValue), "replica_id_required");

  const [contextRows, reviewRows, interviewRows] = await Promise.all([
    db(CONTEXT_ITEM_SQL, [rid, owner]),
    db(REVIEW_CARD_SQL, [rid, owner]),
    db(INTERVIEW_ANSWER_SQL, [rid, owner]),
  ]);

  // FIXED concatenation order, not a merge by date: mined material is
  // normally the largest and most representative source, so it goes first
  // and is never crowded out by whichever query happened to return last.
  const sourced = [
    ...contextRows.map((row) => ({ source_kind: "context_item", source_id: row.source_id, body: row.body })),
    ...reviewRows.map((row) => ({ source_kind: "review_card", source_id: row.source_id, body: row.body })),
    ...interviewRows.map((row) => ({ source_kind: "interview_answer", source_id: row.source_id, body: row.body })),
  ];

  const seen = new Set();
  const questions = [];
  for (const row of sourced) {
    const passage = normalizePassage(row.body);
    if (passage.length < RECALL_PASSAGE_MIN_CHARS) continue;
    // Two rows carrying the same words (a claim mined verbatim from a
    // context item, then also quoted back as a review card's answer) must
    // not become two questions with one real passage between them — that
    // would inflate `n` without adding a single new thing to be tested on.
    const dedupeKey = sha256Hex(passage.toLowerCase());
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const sentence = firstSentence(passage);
    if (!sentence) continue;
    questions.push({
      // A hash of (source_kind, source_id) rather than an incrementing
      // index: stable across a source list that only ever grows, and it
      // never collides across the three tables' own separate uuid spaces.
      question_id: sha256Hex(`${row.source_kind}:${row.source_id}`).slice(0, 16),
      source_kind: row.source_kind,
      source_id: String(row.source_id),
      question_text: questionFromSentence(sentence),
      expected_answer: passage,
    });
  }

  if (questions.length < RECALL_SET_MIN) {
    fail("recall_set_too_small", 409, { found: questions.length, min: RECALL_SET_MIN });
  }

  const setHash = sha256Hex(canonicalJson(questions.map((q) => ({
    id: q.question_id,
    source_kind: q.source_kind,
    source_id: q.source_id,
    question_text: q.question_text,
    expected_answer: q.expected_answer,
  }))));

  return { questions, set_hash: setHash };
}

// ─────────────────────────────────────────────────────────────────────────
// THE SCORER — pure, no I/O, no model
// ─────────────────────────────────────────────────────────────────────────

/** Weight given to plain vocabulary overlap (order-blind: did the passage's
 *  own words reach the answer at all). */
export const RECALL_UNIGRAM_WEIGHT = 0.4;
/** Weight given to word ORDER surviving, via a longest-common-subsequence
 *  ratio. This is the term the negative control in `evals/recall-run/run.mjs`
 *  proves is load-bearing: without it, the same words in a random order score
 *  identically to a verbatim echo. */
export const RECALL_ORDER_WEIGHT = 0.6;

/** Longest-common-subsequence cost is bounded by capping both sequences —
 *  the passage is already bounded by `RECALL_PASSAGE_MAX_CHARS`, so in
 *  practice this only ever trims an unusually long ANSWER. */
const LCS_WORD_CAP = 220;

function normalizeWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function longestCommonSubsequenceLength(a, b) {
  const left = a.slice(0, LCS_WORD_CAP);
  const right = b.slice(0, LCS_WORD_CAP);
  if (!left.length || !right.length) return 0;
  let prev = new Array(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i++) {
    const curr = new Array(right.length + 1).fill(0);
    for (let j = 1; j <= right.length; j++) {
      curr[j] = left[i - 1] === right[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[right.length];
}

/**
 * Score one answer against the passage it was supposed to demonstrate
 * knowledge of. PURE, 0-100 integer. `evals/recall-run/run.mjs` §2 pins the
 * three anchors this docstring promises: an answer that echoes the passage
 * scores 100, an empty answer scores 0, and the SAME WORDS in a different
 * order score strictly between the two — never equal to either, because
 * `RECALL_UNIGRAM_WEIGHT` alone (no order term) would put a shuffled echo at
 * 100 too, and that gap is exactly what the order term exists to close.
 */
export function scoreAnswer(passageText, answerText) {
  const passageWords = normalizeWords(passageText);
  const answerWords = normalizeWords(answerText);
  if (!passageWords.length || !answerWords.length) return 0;
  const passageSet = new Set(passageWords);
  const answerSet = new Set(answerWords);
  const distinct = [...passageSet];
  const covered = distinct.filter((w) => answerSet.has(w)).length;
  const unigramRecall = covered / distinct.length;
  const lcsLen = longestCommonSubsequenceLength(passageWords, answerWords);
  const orderRatio = lcsLen / Math.min(passageWords.length, LCS_WORD_CAP);
  const raw = RECALL_UNIGRAM_WEIGHT * unigramRecall + RECALL_ORDER_WEIGHT * orderRatio;
  return Math.max(0, Math.min(100, Math.round(raw * 100)));
}

/** The method string stored on the row (`vy_recall_run.method`) — an
 *  internal, versioned label for HOW the score was produced, distinct from
 *  the sentence a creator reads (`api/_readiness.js::knowsYourMaterial`
 *  builds that one from `n` at read time, never from this stored text). */
export const RECALL_RUN_METHOD_VERSION = "recall-run/v1";

const RECALL_ANSWER_TEXT_MAX = 2000;

/**
 * Drive every question in `questions` through the REAL compiled agent via
 * `gatedReply` (`deps.reply`; production supplies none and this function
 * falls back to `think`, exactly `assembleMirrorReply`'s own convention) and
 * score each answer. No database access — `deps.engine` and `deps.module`
 * are handed in, `runRecallMeasurement` below is what has a `db`.
 *
 * @param questions `generateRecallSet`'s own `questions` array.
 * @param deps `{ engine, module, agentId?, neverRules?, reply?, now? }` —
 *   `neverRules` must already be COMPILED (`compileNeverRules`, same
 *   contract every other `gatedReply` caller follows,
 *   `api/_room-surface.js::roomNeverRules`'s own shape); this function does
 *   not compile raw DB rows itself.
 */
export async function scoreRecallRun(questions, deps = {}) {
  const list = Array.isArray(questions) ? questions : [];
  const engine = deps.engine;
  const module = deps.module;
  if (!engine || !module) fail("recall_run_engine_unavailable", 503);
  const reply = typeof deps.reply === "function" ? deps.reply : (compiled, turns) => think(engine, compiled, turns);
  const neverRules = Array.isArray(deps.neverRules) ? deps.neverRules : [];
  const now = deps.now ?? Date.now();

  // A REQUEST/RESPONSE surface exactly like `assembleMirrorReply`'s own
  // adapter: nothing here transmits anywhere, so `send` has nothing to do
  // and exists only because `makeCtx` requires one.
  const adapter = {
    surface: "web",
    verify: async () => ({ ok: true, reason: "" }),
    parse: () => [],
    send: async () => ({ ok: true }),
    render: (text) => splitForLimit(text, RECALL_ANSWER_TEXT_MAX),
  };
  const ctx = makeCtx(adapter, { engine, agent: module, agentId: deps.agentId || undefined, reply });

  const rows = [];
  for (const question of list) {
    const compiled = engine.compile({
      agent: module,
      // No vibe, no facts, exactly the calibration lane's own reasoning
      // (`assembleMirrorReply`'s header): a recall run tests the AI's OWN
      // material, not its familiarity with any one follower.
      user: { name: "", vibe: [], facts: {} },
      messageCount: 0,
      medium: "text",
      mode: "chat",
      voiceEngine: "none",
      isDirective: false,
      watching: false,
      innerThread: "",
      innerWants: "",
      // NOTHING RETRIEVED, `roomTaste`'s own reasoning restated: this run
      // is testing the compiled agent's OWN material, not any memory, so
      // claiming a shared past here would be false by construction.
      memories: "",
      herLife: "",
      cultureNoteText: "",
      latestUserText: question.question_text,
    });
    const turns = [{ role: "user", content: question.question_text }];
    let answerText = "";
    let neverRuleHit = "";
    try {
      const gated = await gatedReply(ctx, compiled, turns, {
        record: [],
        label: "studio/recall-run",
        neverRules,
      });
      answerText = gated?.text || "";
      neverRuleHit = gated?.neverRule || "";
    } catch {
      // A reply lane failure is a zero for this question, never a thrown
      // run: one bad turn must not blank an owner's entire measurement.
      answerText = "";
    }
    rows.push({
      id: question.question_id,
      score: scoreAnswer(question.expected_answer, answerText),
      answered: Boolean(answerText),
      never_rule: neverRuleHit,
    });
  }

  const n = rows.length;
  const overall = n ? Math.round(rows.reduce((sum, row) => sum + row.score, 0) / n) : 0;
  return {
    score: overall,
    n,
    method: `${RECALL_RUN_METHOD_VERSION}: ${n} template questions over held-out passages from the replica's own sources, scored by vocabulary overlap and word order against the source text.`,
    computed_at: new Date(now).toISOString(),
    rows,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// THE WRITE — one statement, superseding, rate-limited by its own predicate
// ─────────────────────────────────────────────────────────────────────────

/** One run per replica per hour. The reply seam this file drives costs money
 *  per question in production, and this is the second, structural layer under
 *  `RECALL_RUN` (which only gates whether the op exists at all) — the same
 *  two-layer shape `api/_review-queue.js`'s foundry-spend reservation uses
 *  for a different budget. */
const RECALL_RUN_RATE_WINDOW = "1 hour";

// ONE statement — 009's law, `api/_fidelity.js`'s own `FIDELITY_INSERT_SQL`
// shape (a superseding CTE feeding a guarded INSERT), extended by one more
// CTE: `guard` decides ONCE whether this call is inside the rate window, and
// both the supersede and the insert are gated on the SAME `guard.ok` so a
// rate-limited call cannot supersede the standing measurement without
// replacing it — that would leave a creator's last real score invisible
// while reporting nothing wrong.
const RECALL_RUN_INSERT_SQL = `with guard as (
  select not exists (
    select 1 from vy_recall_run x
     where x.replica_id=$1::uuid and x.owner_user_id=$2::uuid
       and x.created_at > now() - interval '${RECALL_RUN_RATE_WINDOW}'
  ) as ok
), superseded as (
  update vy_recall_run r
     set superseded_at=now()
   where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.superseded_at is null
     and (select ok from guard)
  returning r.run_id
)
insert into vy_recall_run (run_id,replica_id,owner_user_id,score,n,method,set_hash)
select gen_random_uuid(),$1::uuid,$2::uuid,$3::int4,$4::int4,$5,$6
 where (select ok from guard)
returning run_id,created_at`;

/** The one write. Returns `{run_id, created_at}` or null when the rate
 *  predicate refused it — never throws for that case, so the caller decides
 *  the refusal's name and status. */
export async function storeRecallRun(db, ownerUserId, replicaIdValue, scored, setHash) {
  if (typeof db !== "function") fail("recall_run_db_required", 503);
  const owner = requireUuid(ownerUserId, "owner_required");
  const rid = requireUuid(replicaId(replicaIdValue), "replica_id_required");
  const rows = await db(RECALL_RUN_INSERT_SQL, [
    rid, owner, Number(scored.score), Number(scored.n), String(scored.method || ""), String(setHash || ""),
  ]);
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────
// THE OP — the whole "Measure now" flow, `api/readiness.js`'s thin door over it
// ─────────────────────────────────────────────────────────────────────────

/**
 * Gather, generate, score, store — one call. Every decision an eval can
 * reach with a fake `db` and fake `deps.engine`/`deps.reply` — `api/readiness.js`
 * itself does nothing but call this and shape the HTTP response.
 */
export async function runRecallMeasurement(db, ownerUserId, replicaIdValue, deps = {}) {
  if (typeof db !== "function") fail("recall_run_db_required", 503);
  const owner = requireUuid(ownerUserId, "owner_required");
  const rid = requireUuid(replicaId(replicaIdValue), "replica_id_required");
  const env = deps.env || process.env;
  if (!recallRunEnabled(env)) fail("recall_run_off", 503);

  // Ownership, checked BEFORE anything else touches the replica's rows —
  // `api/_readiness.js::readReadinessInputs`'s own predicate, restated: a
  // replica that is not the caller's answers exactly as a replica that does
  // not exist, never a 403 that would confirm it belongs to someone else.
  const owned = await db(
    `select r.replica_id from vy_replica r
      where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.lifecycle <> 'purging'
      limit 1`,
    [rid, owner],
  );
  if (!owned[0]) fail("replica_not_found", 404);

  const set = await generateRecallSet(db, owner, rid, deps);

  const sheetRow = deps.sheetRow !== undefined ? deps.sheetRow : await mirrorReplyAgent(db, owner, rid);
  if (!sheetRow) fail("clone_sheet_absent", 409);
  // `mirrorReplyModule` throws its OWN named error (code/status) for an
  // invalid or wrong-agent sheet — let it propagate rather than re-wrapping,
  // `assembleMirrorReply`'s own posture.
  const built = mirrorReplyModule(sheetRow);

  const engine = deps.engine !== undefined ? deps.engine : await loadEngine();
  if (!engine) fail("recall_run_engine_unavailable", 503);

  // COMPILED, the same contract every other `gatedReply` caller follows —
  // `api/_room-surface.js::roomNeverRules`'s own shape, restated for a lane
  // with no Room. A raw DB row handed to `gatedReply` uncompiled would
  // silently never match anything, which is `plausible-return-hides-a-dead-
  // pipeline` wearing a safety rule's clothes.
  const neverRules = deps.neverRules !== undefined
    ? deps.neverRules
    : compileNeverRules(await loadNeverRules(db, rid, owner));

  const scored = await scoreRecallRun(set.questions, {
    engine,
    module: built.module,
    agentId: built.agentId,
    neverRules,
    reply: deps.reply,
    now: deps.now,
  });

  const stored = await storeRecallRun(db, owner, rid, scored, set.set_hash);
  if (!stored) fail("recall_run_rate_limited", 429);

  return {
    run_id: stored.run_id,
    score: scored.score,
    n: scored.n,
    method: scored.method,
    computed_at: stored.created_at,
    set_hash: set.set_hash,
  };
}
