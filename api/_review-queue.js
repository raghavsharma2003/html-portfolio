// The review queue — WS-R4. Where fidelity is actually made.
//
// One card at a time: a question the audience will really ask, the answer the
// AI gave, and three buttons. Thirty seconds a card, and the number moves.
//
//   Sounds right   the answer stands, and where the card came from a mined
//                  claim the claim is approved through the existing claim
//                  decision path
//   Close, fix it  the owner's better answer becomes a CITED SOURCE
//                  (vy_replica_source, purpose='correction') and everything
//                  derived from the old answer is INVALIDATED so it is rebuilt
//   Never say this a row on vy_review_never_rule that the reply predicate
//                  enforces at the one door
//
// ═════════════════════════════════════════════════════════════════════════
// THE THREE LAWS THIS FILE IS BUILT AGAINST, AND WHERE THEY ARE WRITTEN DOWN
// ═════════════════════════════════════════════════════════════════════════
//
// 1. `recited-prompt` (context/rejected.md). Anything sentence-shaped in a
//    brief gets recited verbatim; measured twice, in unrelated features. The
//    owner's better answer is the most recitable string this product can
//    produce, so it NEVER enters a persona. It is stored as a source and
//    retrieved, exactly as 059 stores `vy_mirror_feedback.rephrase_text` as
//    evidence and refuses to let it become a sheet edit.
//
// 2. `mirror-call-approval-is-one-sql-clause` (context/decisions.md). The
//    owner's tap is ONE SQL clause, and the write is UPSTREAM of the state
//    flip. `decideReviewCard` below flips a card to 'fixed' only when the
//    correction source row already exists and is still this owner's — so a tap
//    whose correction did not land leaves the card OPEN rather than "fixed and
//    silently uncorrected". Migration 074's `vy_review_card_fixed_gate` is the
//    same law as a CHECK, so the half-landed row is unrepresentable rather than
//    merely untested.
//
// 3. `gate0-structural` (docs/gurukul/safety-floor-teacher.md). "Prompt
//    instructions leaked 57-98%; the SQL predicate leaked 0 of 31,122 … a
//    sentence in a brief is a preference, a predicate on the output is a
//    guarantee." So "Never say this" writes a ROW, and `compileNeverRules` /
//    `replyViolatesNeverRule` are applied inside `api/_surface.js::gateReply`,
//    the one door every surface's bytes leave by. Nothing is added to a prompt.
//
// ═════════════════════════════════════════════════════════════════════════
// WHAT `sounds_right` DELIBERATELY DOES NOT DO
// ═════════════════════════════════════════════════════════════════════════
//
// The brief asks for an exemplar row on `vy_replica_turn_exemplar`. That table
// is keyed `feedback_id` with a composite FK to `vy_replica_turn_feedback`,
// which is itself bound to a completed `vy_replica_dialogue_turn` with a
// matching `response_hash` and an ACTIVE runtime capability. A review card is
// not a dialogue turn: three of the four card kinds have no turn at all. The
// only way to write that row from here would be to mint a dialogue turn that
// never happened, which is a fabricated record in the one table whose whole
// purpose is to be evidence. So `sounds_right` records the decision on the card
// and, where the card came from a mined claim, approves THAT claim through the
// vocabulary `api/_person-model.js` already uses. See
// context/rejected.md#review-exemplar-needs-a-turn-that-never-happened.
//
// A 'delta' card records its decision and touches `vy_mirror_delta` NOT AT ALL.
// `api/_mirrorcall-store.js::decideMirrorDelta` is the only statement in this
// repo that may move a Mirror Call chip, by decision, and a second writer here
// would delete the guarantee that decision buys.
import { createHash, randomUUID } from "node:crypto";
import {
  NEVER_RULE_MAX,
  NEVER_RULE_MIN_CHARS,
  NEVER_RULE_SHINGLE,
  compileNeverRules,
  normaliseForMatch,
  replyViolatesNeverRule,
} from "./_never-rules.js";
import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";
import { ELIGIBLE_TRANSCRIPTS_SQL } from "./_replica-claims.js";
import {
  beginFoundrySpend,
  markFoundrySpendUncertain,
  releaseFoundrySpendBeforeCall,
  reserveFoundrySpend,
  settleFoundrySpend,
} from "./_provider-budget.js";
import { questionMessages } from "./_review-queue/questions.js";
import { createPendingSource } from "./_replica-source.js";
import { tableApplied } from "./memory.js";

/** The queue never shows more than this many open cards. A queue that can grow
 *  without bound is a queue nobody opens twice: the promise is "card 14 of 30",
 *  and 30 is the whole promise. */
export const REVIEW_OPEN_CAP = 30;

// WS-R112: 'instruction_shaped' appended. Migration 129 widens the DATABASE
// CHECK the same way; this array is the JS-side mirror `generateReviewCards`/
// `decideReviewCard` validate against.
export const REVIEW_CARD_KINDS = Object.freeze(["question", "claim", "delta", "follower_declined", "instruction_shaped"]);
// WS-R112: 'remove_source' appended — the third decision on an
// 'instruction_shaped' card ("Remove this source"), valid for NO other kind
// (`decideReviewCard`'s own WHERE-clause gate enforces that, never a JS
// check alone). It maps to the EXISTING `state='never'` column value
// (`STATE_FOR_DECISION` below): migration 129 widens `kind`'s CHECK, not
// `state`'s, so no new state value exists to hold it, and 'never' is the
// closer of the two closeable non-`fixed` states to "we acted against this"
// (`context/decisions.md#ws-r112-remove-source-reuses-the-never-state`).
export const REVIEW_DECISIONS = Object.freeze(["sounds_right", "fixed", "never", "remove_source"]);

/** The DATABASE `state` column value each decision writes. Kept separate
 *  from the decision code itself (never collapsed into one) because
 *  'remove_source' and 'never' are two DIFFERENT creator actions that must
 *  gate DIFFERENT SQL (a never-rule row for one, a source refusal for the
 *  other) while sharing one closed `state` CHECK — see the constant's own
 *  callers in `decideReviewCard` for how the two stay distinguishable in the
 *  audit trail even though the `state` column alone cannot. */
export const STATE_FOR_DECISION = Object.freeze({
  sounds_right: "sounds_right",
  fixed: "fixed",
  never: "never",
  remove_source: "never",
});

/** What a correction may be handed to us as. Audio goes through the ordinary
 *  signed upload and is transcribed by the EXISTING DAG; nothing is transcribed
 *  inline in a request handler. */
export const CORRECTION_KINDS = Object.freeze({
  text: { kind: "text", mimes: ["text/plain"] },
  audio: {
    kind: "audio",
    mimes: ["audio/wav", "audio/x-wav", "audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/opus"],
  },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ReviewQueueError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

function fail(code, status = 400, details) {
  throw new ReviewQueueError(code, status, details);
}

function reviewUuid(value, code) {
  const id = String(value || "").trim().toLowerCase();
  if (!UUID.test(id)) fail(code, 400);
  return id;
}

/**
 * Strip a string down to something a person can read and a database can hold.
 *
 * Control characters go (a card is rendered into a studio), the pseudo-tags a
 * prompt injection wears go the way `api/_replica-feedback.js::cleanCorrection`
 * removes them, and the result is length-capped. Returns '' rather than
 * throwing: an empty answer is a REAL state (the AI declined) and the caller
 * decides whether empty is allowed in that position.
 */
export function reviewText(value, max = 500) {
  return Array.from(String(value ?? ""))
    .filter((character) => {
      const code = character.codePointAt(0);
      return code === 10 || code === 13 || code === 9 || (code >= 32 && code !== 127);
    })
    .join("")
    .replace(/<\/?(?:system|assistant|developer|tool)[^>]*>/gi, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * The dedupe key, over (kind, the thing being judged).
 *
 * WHICH HALF OF A CARD IS "the thing being judged" DIFFERS BY KIND, and getting
 * that wrong collapses the whole queue. A 'question' or 'follower_declined'
 * card is judged on its QUESTION: the same question asked twice is one card
 * even when the AI answered it differently, and two questions that happened to
 * draw the same answer are two cards. A 'claim' or 'delta' card is the
 * opposite: its prompt is a fixed line of studio copy, so hashing the prompt
 * would make every mined claim in the replica collapse into one card. Those are
 * judged on the mined text itself.
 *
 * Migration 074's unique index on (replica_id, dedupe_hash) is what makes this
 * structural rather than a property of whichever generator ran last.
 *
 * WS-R112: 'instruction_shaped' is a THIRD shape, keyed on `originRef` (the
 * `context_item:<item_id>` pointer) rather than on the prompt or the answer.
 * The card's prompt is the flagged passage's first SENTENCE and its answer
 * is a class-name reason — both are DERIVED text that a re-mine of the exact
 * same stored source could, in principle, re-render with a different word
 * wrap or a differently-punctuated first sentence, so hashing either would
 * risk a re-mine minting a second card for the same source. The item id
 * never changes between mines, so it is the one stable subject
 * (`context/decisions.md#ws-r112-instruction-shaped-dedupe-keys-on-the-item-
 * not-the-sentence`).
 */
export function reviewDedupeSubject(kind, promptText, answerText, originRef) {
  if (kind === "instruction_shaped") return String(originRef ?? "");
  return kind === "claim" || kind === "delta" ? String(answerText ?? "") : String(promptText ?? "");
}

export function reviewDedupeHash(kind, promptText, answerText, originRef) {
  const subject = reviewDedupeSubject(kind, promptText, answerText, originRef);
  return createHash("sha256")
    .update(`vyakti:review-card:v1:${String(kind)}:${normaliseForMatch(subject)}`)
    .digest("hex");
}

// ═════════════════════════════════════════════════════════════════════════
// THE NEVER-RULE PREDICATE — a guarantee, not a preference
// ═════════════════════════════════════════════════════════════════════════
//
// The MATCH lives in `api/_never-rules.js`, which imports nothing, because
// `api/_surface.js` applies it on every surface's reply path and must not gain
// a transitive dependency on storage config or a database client to do so.
// This file owns the ROWS: what a valid pattern is, how one is written, and how
// the active set is read back. Re-exported here so a caller that already has
// this module does not have to know there are two files.
export {
  NEVER_RULE_MAX,
  NEVER_RULE_MIN_CHARS,
  NEVER_RULE_SHINGLE,
  compileNeverRules,
  normaliseForMatch,
  replyViolatesNeverRule,
};

export function neverRulePattern(value) {
  const pattern = reviewText(value, 200);
  if (normaliseForMatch(pattern).length < NEVER_RULE_MIN_CHARS) fail("never_rule_pattern_too_short", 400);
  return pattern;
}

/** The active rules for one replica, ready for `compileNeverRules`. Owner-
 *  scoped in the WHERE clause, 009's law, and bounded. */
export async function loadNeverRules(db, replicaIdValue, ownerUserId) {
  if (typeof db !== "function") fail("review_db_required", 503);
  const rows = await db(
    `select n.rule_id, n.pattern, n.revoked_at
       from vy_review_never_rule n
      where n.replica_id = $1::uuid and n.owner_user_id = $2::uuid and n.revoked_at is null
      order by n.created_at asc
      limit 200`,
    [replicaId(replicaIdValue), reviewUuid(ownerUserId, "review_owner_required")],
  );
  return rows;
}

// ═════════════════════════════════════════════════════════════════════════
// CARD GENERATION — pure, so it is testable, and hooked, so it is not coupled
// ═════════════════════════════════════════════════════════════════════════

/**
 * The event shape WS-R1's Room hands us for a question the AI declined or
 * answered with low confidence.
 *
 * ACCEPTED AS A SHAPE, NOT AS AN IMPORT. This file must not depend on the
 * Room's code to be finished, and the Room must not depend on this file's
 * schema: the contract is these five fields and nothing else. An event that
 * does not match returns null and is counted as dropped, never guessed at.
 */
export function followerDeclinedEvent(value) {
  const question = reviewText(value?.question, 500);
  if (!question) return null;
  const confidence = Number(value?.confidence);
  const declined = value?.declined === true;
  if (!declined && !(Number.isFinite(confidence) && confidence < 0.6)) return null;
  return Object.freeze({
    question,
    answer: reviewText(value?.answer, 4_000),
    declined,
    confidence: Number.isFinite(confidence) ? confidence : null,
    event_ref: reviewText(value?.event_ref, 96),
  });
}

function card(kind, promptText, answerText, sourceRefs, originRef) {
  const prompt = reviewText(promptText, 500);
  if (!prompt) return null;
  const answer = reviewText(answerText, 4_000);
  const refs = Array.isArray(sourceRefs) ? sourceRefs.slice(0, 8) : [];
  const origin = reviewText(originRef, 128);
  return {
    kind,
    prompt_text: prompt,
    answer_text: answer,
    source_refs: refs,
    origin_ref: origin,
    dedupe_hash: reviewDedupeHash(kind, prompt, answer, origin),
  };
}

/**
 * (a) mined claims + (b) Mirror Call deltas + (c) follower questions the AI
 * declined + (d) a synthetic question set -> cards, deduplicated, capped.
 *
 * PURE. No database, no clock, no network. `existing` is the dedupe hashes
 * already on the queue and `openCount` is how many open cards it already holds,
 * so the cap is a property of the QUEUE rather than of one generation run.
 *
 * The order is deliberate and it is the product's own claim: real follower
 * conversations first, then what we mined from the owner's own material, and
 * the synthetic questions LAST, because they are the scaffolding that fills an
 * empty queue before launch and the first thing that should fall off the end
 * once real questions exist.
 */
export function generateReviewCards(input = {}) {
  const cap = Math.max(1, Math.min(REVIEW_OPEN_CAP, Number(input.cap ?? REVIEW_OPEN_CAP)));
  const seen = new Set((Array.isArray(input.existing) ? input.existing : []).map(String));
  const room = Math.max(0, cap - Math.max(0, Number(input.openCount || 0)));
  const dropped = { invalid: 0, duplicate: 0, over_cap: 0 };
  const cards = [];

  const drafts = [];
  for (const event of Array.isArray(input.followerEvents) ? input.followerEvents : []) {
    const shaped = followerDeclinedEvent(event);
    if (!shaped) { dropped.invalid++; continue; }
    drafts.push(card("follower_declined", shaped.question, shaped.answer, [], shaped.event_ref));
  }
  for (const claim of Array.isArray(input.claims) ? input.claims : []) {
    drafts.push(card(
      "claim",
      "Does your AI have this right about you?",
      claim?.body,
      (Array.isArray(claim?.source_ids) ? claim.source_ids : []).map((id) => ({ source_id: String(id) })),
      claim?.claim_id ? `claim:${claim.claim_id}` : "",
    ));
  }
  for (const delta of Array.isArray(input.deltas) ? input.deltas : []) {
    drafts.push(card(
      "delta",
      "Should your AI pick this up from you?",
      delta?.fragment,
      (Array.isArray(delta?.cited_windows) ? delta.cited_windows : []).map((seq) => ({ window_seq: Number(seq) })),
      delta?.delta_id ? `delta:${delta.delta_id}` : "",
    ));
  }
  for (const question of Array.isArray(input.questions) ? input.questions : []) {
    drafts.push(card(
      "question",
      question?.question,
      question?.answer,
      (Array.isArray(question?.source_ids) ? question.source_ids : []).map((id) => ({ source_id: String(id) })),
      question?.origin_ref ? String(question.origin_ref).slice(0, 128) : "",
    ));
  }

  for (const draft of drafts) {
    if (!draft) { dropped.invalid++; continue; }
    // A claim or a delta card with no answer to show is not a card: those two
    // kinds ARE the mined text, so an empty one has nothing on it to judge.
    // A 'follower_declined' or a 'question' card with no answer is the
    // opposite. The AI declining, or not having been asked yet, is exactly the
    // case where the owner's own answer is worth the most, and the composer on
    // that card writes it straight into a correction source.
    if (!draft.answer_text && (draft.kind === "claim" || draft.kind === "delta")) {
      dropped.invalid++;
      continue;
    }
    if (seen.has(draft.dedupe_hash)) { dropped.duplicate++; continue; }
    if (cards.length >= room) { dropped.over_cap++; continue; }
    seen.add(draft.dedupe_hash);
    cards.push(draft);
  }
  return Object.freeze({ cards: Object.freeze(cards), dropped: Object.freeze(dropped), room });
}

// ═════════════════════════════════════════════════════════════════════════
// READS
// ═════════════════════════════════════════════════════════════════════════

const OWNED = `select r.replica_id from vy_replica r
  where r.replica_id = $1::uuid and r.owner_user_id = $2::uuid
    and r.lifecycle not in ('revoked','purging')`;

export function clientCard(row) {
  return {
    card_id: String(row.card_id),
    kind: row.kind,
    prompt_text: row.prompt_text,
    answer_text: row.answer_text,
    source_refs: Array.isArray(row.source_refs) ? row.source_refs
      : (typeof row.source_refs === "string" ? JSON.parse(row.source_refs) : []),
    state: row.state,
    decided_at: row.decided_at ?? null,
    // Counts and states only. A source id is an internal handle and the studio
    // has no use for one; `has_correction` is the whole fact it renders.
    has_correction: Boolean(row.correction_source_id),
    created_at: row.created_at,
  };
}

/**
 * The queue as the studio renders it: the open cards in decision order, plus
 * the two real counts the progress line is made of.
 *
 * `decided` and `open` are counted in SQL rather than derived from the returned
 * page, because "card 14 of 30" has to be true and a page is not a count.
 */
export async function readReviewQueue(db, ownerUserId, replicaIdValue) {
  if (typeof db !== "function") fail("review_db_required", 503);
  const rid = replicaId(replicaIdValue);
  const owner = reviewUuid(ownerUserId, "review_owner_required");
  const [owned, cards, totals, rules] = await Promise.all([
    db(OWNED, [rid, owner]),
    db(
      `select c.card_id, c.kind, c.prompt_text, c.answer_text, c.source_refs, c.state,
              c.decided_at, c.correction_source_id, c.created_at
         from vy_review_card c
        where c.replica_id = $1::uuid and c.owner_user_id = $2::uuid and c.state = 'open'
        order by c.created_at asc, c.card_id asc
        limit 30`,
      [rid, owner],
    ),
    db(
      `select count(*) filter (where c.state = 'open')::int4 as open_count,
              count(*) filter (where c.state <> 'open')::int4 as decided_count,
              count(*) filter (where c.state = 'fixed')::int4 as fixed_count,
              count(*) filter (where c.state = 'never')::int4 as never_count
         from vy_review_card c
        where c.replica_id = $1::uuid and c.owner_user_id = $2::uuid`,
      [rid, owner],
    ),
    db(
      `select count(*)::int4 as active_rules from vy_review_never_rule n
        where n.replica_id = $1::uuid and n.owner_user_id = $2::uuid and n.revoked_at is null`,
      [rid, owner],
    ),
  ]);
  if (!owned[0]) return null;
  const counts = totals[0] || {};
  return {
    replica_id: rid,
    cards: cards.map(clientCard),
    open_count: Number(counts.open_count || 0),
    decided_count: Number(counts.decided_count || 0),
    fixed_count: Number(counts.fixed_count || 0),
    never_count: Number(counts.never_count || 0),
    active_never_rules: Number(rules[0]?.active_rules || 0),
    cap: REVIEW_OPEN_CAP,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// FLAGS (WS-R67, migration 116) — the card source for a follower's "Flag
// this", never a second reply assembler and never a second consent gate.
// ═════════════════════════════════════════════════════════════════════════
//
// `vy_room_reply_flag` gets no `kind` of its own on `vy_review_card`
// (REVIEW_CARD_KINDS is deliberately untouched by this workstream): a flag is
// a fact about what was said and how many times it was flagged, not a
// generated question with its own lifecycle, and folding it into that table
// would need a `count` column that table does not have and this workstream's
// migration does not add. Instead the creator's queue reads the flag table
// directly, live, at display time - `count(*) ... group by reply_sha256` IS
// "ten followers, one card, n=10", a property of the READ rather than
// something any row has to remember.

/**
 * The creator's aggregate read: every flagged reply on this replica, newest
 * first, with a count and a reason breakdown. The join reaches `vy_room`
 * ONLY to scope by (replica_id, owner_user_id) - `vy_room_reply_flag` itself
 * names no follower, no thread, no person at all (migration 116's own
 * header), so nothing this statement selects can ever be a follower's word
 * or identity. `evals/room-leak/run.mjs`'s own layer 7 proves this by a real
 * multi-follower world, not merely by reading this comment.
 */
export async function readFlaggedReplies(db, ownerUserId, replicaIdValue, deps = {}) {
  if (typeof db !== "function") fail("review_db_required", 503);
  const rid = replicaId(replicaIdValue);
  const owner = reviewUuid(ownerUserId, "review_owner_required");
  // Gated exactly as `api/_room-surface.js`'s Room extras are: a database
  // that has not yet applied migration 116 gets an EMPTY list rather than a
  // 500 on an undefined-table error - a deploy-ordering guard, never a claim
  // that nothing was flagged. Injectable so an offline eval never reaches a
  // real database to ask.
  const applied = deps.tableApplied ?? tableApplied;
  if (!(await applied("vy_room_reply_flag"))) return [];
  const rows = await db(
    `select f.reply_sha256, f.reply_text,
            count(*)::int4 as flag_count,
            count(*) filter (where f.reason = 'wrong')::int4 as wrong_count,
            count(*) filter (where f.reason = 'harmful')::int4 as harmful_count,
            count(*) filter (where f.reason = 'not_them')::int4 as not_them_count,
            count(*) filter (where f.reason = 'other')::int4 as other_count,
            max(f.created_at) as last_flagged_at
       from vy_room_reply_flag f
       join vy_room r on r.room_id = f.room_id
      where r.replica_id = $1::uuid and r.owner_user_id = $2::uuid
      group by f.reply_sha256, f.reply_text
      order by flag_count desc, last_flagged_at desc
      limit 50`,
    [rid, owner],
  );
  return rows.map((row) => ({
    reply_sha256: row.reply_sha256,
    reply_text: row.reply_text,
    count: Number(row.flag_count || 0),
    reasons: {
      wrong: Number(row.wrong_count || 0),
      harmful: Number(row.harmful_count || 0),
      not_them: Number(row.not_them_count || 0),
      other: Number(row.other_count || 0),
    },
    // "Never say this" pre-selected for harmful - the workstream brief's own
    // words. True the moment even ONE flag on this reply named harmful, so
    // the queue points the creator at the sharper decision rather than
    // leaving them to notice a minority reason on their own.
    suggest_never: Number(row.harmful_count || 0) > 0,
    last_flagged_at: row.last_flagged_at,
  }));
}

/**
 * "Never say this," off a flagged reply. The SAME table
 * (`vy_review_never_rule`) and the SAME predicate
 * (`compileNeverRules`/`replyViolatesNeverRule`, applied inside
 * `api/_surface.js::gateReply`) every never-rule already uses -
 * `card_id` is null because a flag is not a review card (this section's own
 * header). `pattern` is read back from `vy_room_reply_flag` by
 * (replica, reply hash), never trusted off the request body - the SAME
 * boundary law `api/_room-surface.js::flagReply` enforces one file over.
 */
export async function neverRuleFromFlaggedReply(db, ownerUserId, input, deps = {}) {
  if (typeof db !== "function") fail("review_db_required", 503);
  const rid = replicaId(input?.replica_id);
  const owner = reviewUuid(ownerUserId, "review_owner_required");
  const hash = String(input?.reply_sha256 || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) fail("review_flag_hash_invalid", 400);
  const applied = deps.tableApplied ?? tableApplied;
  if (!(await applied("vy_room_reply_flag"))) fail("review_flag_not_found", 404);
  const found = await db(
    `select f.reply_text
       from vy_room_reply_flag f join vy_room r on r.room_id = f.room_id
      where r.replica_id = $1::uuid and r.owner_user_id = $2::uuid and f.reply_sha256 = $3::text
      order by f.created_at asc limit 1`,
    [rid, owner, hash],
  );
  if (!found[0]) fail("review_flag_not_found", 404);
  const pattern = neverRulePattern(found[0].reply_text);
  const reason = reviewText(input?.reason, 500);
  const rows = await db(
    `with existing as (
       select rule_id from vy_review_never_rule
        where replica_id = $1::uuid and owner_user_id = $2::uuid
          and lower(pattern) = lower($3::text) and revoked_at is null
     ), inserted as (
       insert into vy_review_never_rule (replica_id, owner_user_id, pattern, reason)
       select $1::uuid, $2::uuid, $3::text, $4::text
        where not exists (select 1 from existing)
       on conflict do nothing
       returning rule_id
     )
     select coalesce((select rule_id from inserted), (select rule_id from existing)) as rule_id`,
    [rid, owner, pattern, reason],
  );
  return { rule_id: rows[0]?.rule_id ?? null, pattern };
}

// ═════════════════════════════════════════════════════════════════════════
// SHOWCASE PICKER (WS-R72) — the read `api/_room-publish.js`'s `setRoomShowcase`
// needed a browsing screen for. `api/room-publish.js?op=showcase_set` already
// accepts a `sourceCardId` and enforces the eligibility predicate on its OWN
// write; this is the SAME predicate, restated on a READ so the studio can
// list what a creator is allowed to pick from before they pick it
// (`context/decisions.md#ws-r66-showcase-card-picker-ui-not-built-v0`, the
// open item this closes).
// ═════════════════════════════════════════════════════════════════════════

/**
 * Every DECIDED review card eligible to become a showcase slot's source: the
 * IDENTICAL predicate `api/_room-publish.js::setRoomShowcase` enforces on its
 * own copy-from-card write (`kind <> 'follower_declined' and state =
 * 'sounds_right'`, both inside this ONE select), never a JS filter applied
 * after the rows are already in hand. This is what makes a follower-sourced
 * card structurally unable to reach the picker: the WHERE clause is the only
 * place the boundary is drawn, and it is drawn once, in the same words, on
 * both the read and the write (`ws-r66-showcase-eligibility-is-a-where-
 * clause-on-kind`'s own reasoning, restated for a second caller).
 */
export async function readEligibleShowcaseCards(db, ownerUserId, replicaIdValue) {
  if (typeof db !== "function") fail("review_db_required", 503);
  const rid = replicaId(replicaIdValue);
  const owner = reviewUuid(ownerUserId, "review_owner_required");
  const rows = await db(
    `select card_id, kind, prompt_text, answer_text
       from vy_review_card
      where replica_id = $1::uuid and owner_user_id = $2::uuid
        and state = 'sounds_right' and kind <> 'follower_declined'
      order by decided_at desc nulls last, card_id asc
      limit 50`,
    [rid, owner],
  );
  return rows.map((row) => ({
    card_id: String(row.card_id),
    kind: row.kind,
    prompt_text: row.prompt_text,
    answer_text: row.answer_text,
  }));
}

// ═════════════════════════════════════════════════════════════════════════
// "SOUNDS RIGHT ANYWAY" (WS-R72) — the flagged-reply card's OTHER action.
// ═════════════════════════════════════════════════════════════════════════
//
// No new column and no new table (this workstream's brief: no migration).
// `vy_room_reply_flag` (migration 116) already carries no follower identity of
// any kind (`readFlaggedReplies`'s own header), so there is no "state" column
// to flip and nothing to preserve about WHO flagged it — dismissing a
// flagged-reply card is therefore the SAME shape `unflagReply` already uses
// one file over for a follower's own withdrawal (`api/_room-surface.js`): a
// DELETE, never a flip. The difference is scope. `unflagReply` deletes ONE row
// (the withdrawing follower's own), scoped by `follower_id`; this deletes
// EVERY row for this reply on this Room, scoped by owner — the creator is not
// taking back one follower's flag, they are saying "I looked at this and it
// stands," which clears the card for every follower who flagged it, the same
// way marking a review card `sounds_right` clears it from the open queue for
// good rather than for one asker.
export async function dismissFlaggedReply(db, ownerUserId, input, deps = {}) {
  if (typeof db !== "function") fail("review_db_required", 503);
  const rid = replicaId(input?.replica_id);
  const owner = reviewUuid(ownerUserId, "review_owner_required");
  const hash = String(input?.reply_sha256 || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) fail("review_flag_hash_invalid", 400);
  const applied = deps.tableApplied ?? tableApplied;
  if (!(await applied("vy_room_reply_flag"))) fail("review_flag_not_found", 404);
  const rows = await db(
    `delete from vy_room_reply_flag f
       using vy_room r
      where r.room_id = f.room_id and r.replica_id = $1::uuid and r.owner_user_id = $2::uuid
        and f.reply_sha256 = $3::text
      returning f.id`,
    [rid, owner, hash],
  );
  if (!rows.length) fail("review_flag_not_found", 404);
  return { dismissed: rows.length, reply_sha256: hash };
}

/** What generation reads: the claims still awaiting a decision, the Mirror Call
 *  chips nobody has tapped, and the dedupe hashes already on the queue. Every
 *  statement carries owner_user_id inside its WHERE clause. */
export async function collectReviewInputs(db, ownerUserId, replicaIdValue) {
  const rid = replicaId(replicaIdValue);
  const owner = reviewUuid(ownerUserId, "review_owner_required");
  const [owned, claims, deltas, existing, totals] = await Promise.all([
    db(OWNED, [rid, owner]),
    db(
      `select c.claim_id, c.body, c.source_ids from vy_replica_claim c
        where c.replica_id = $1::uuid and c.owner_user_id = $2::uuid and c.status = 'proposed'
          and c.sensitive = false
        order by c.confidence desc, c.claim_id asc limit 60`,
      [rid, owner],
    ),
    db(
      `select d.delta_id, d.fragment, d.cited_windows from vy_mirror_delta d
        where d.replica_id = $1::uuid and d.owner_user_id = $2::uuid
          and d.state in ('proposed','deferred') and d.fragment <> ''
        order by d.occurrences desc, d.delta_id asc limit 60`,
      [rid, owner],
    ),
    db(
      `select c.dedupe_hash from vy_review_card c
        where c.replica_id = $1::uuid and c.owner_user_id = $2::uuid limit 500`,
      [rid, owner],
    ),
    db(
      `select count(*) filter (where c.state = 'open')::int4 as open_count from vy_review_card c
        where c.replica_id = $1::uuid and c.owner_user_id = $2::uuid`,
      [rid, owner],
    ),
  ]);
  if (!owned[0]) return null;
  return {
    replica_id: rid,
    claims: claims.map((row) => ({
      claim_id: String(row.claim_id),
      body: row.body,
      source_ids: Array.isArray(row.source_ids) ? row.source_ids : [],
    })),
    deltas: deltas.map((row) => ({
      delta_id: String(row.delta_id),
      fragment: row.fragment,
      cited_windows: Array.isArray(row.cited_windows) ? row.cited_windows : [],
    })),
    existing: existing.map((row) => String(row.dedupe_hash)),
    openCount: Number(totals[0]?.open_count || 0),
  };
}

/**
 * The synthetic question set, generated from the replica's OWN material.
 *
 * The generator is injected, so `evals/review-queue/run.mjs` drives this exact
 * function with a fixture and no network, and the spend goes through
 * `api/_provider-budget.js` exactly as `extractOwnedClaims` does: a question
 * set is metered by the same ledger as every other model call in the product
 * rather than spending beside it.
 *
 * Excerpts are the owner-reviewed transcript spans `api/_replica-claims.js`
 * already qualifies (its `ELIGIBLE_TRANSCRIPTS_SQL`, reused rather than
 * re-derived): spans of the VERIFIED subject speaking, from sources with no
 * third parties, with test adapters excluded in SQL.
 */
export async function generateSyntheticQuestions(db, ownerUserId, replicaIdValue, generator, options = {}) {
  if (!generator || typeof generator.generate !== "function") fail("review_question_generator_unavailable", 503);
  const rid = replicaId(replicaIdValue);
  const owner = reviewUuid(ownerUserId, "review_owner_required");
  const rows = await db(ELIGIBLE_TRANSCRIPTS_SQL, [rid, owner]);
  const excerpts = rows
    .map((row) => ({ source_id: String(row.source_id), text: String(row.text || "") }))
    .filter((row) => row.text.length >= 40)
    .slice(0, 20);
  // NOT an empty list. A replica with no reviewed transcript has no material to
  // draw questions from, and saying that is a different sentence from "the
  // generator produced none" (`plausible-return-hides-a-dead-pipeline`).
  if (!excerpts.length) fail("review_question_excerpts_absent", 409);

  let reservation = null;
  let started = false;
  try {
    reservation = await reserveFoundrySpend(db, {
      operation: "review_question",
      requestKey: `${rid}:${excerpts.length}`,
      adapter: generator,
      messages: questionMessages(excerpts, options.count),
    });
    if (reservation) {
      try {
        await beginFoundrySpend(db, reservation);
      } catch (error) {
        await releaseFoundrySpendBeforeCall(db, reservation, error).catch(() => null);
        throw error;
      }
      started = true;
    }
    const produced = await generator.generate({ excerpts, count: options.count, signal: options.signal });
    if (reservation) {
      try {
        await settleFoundrySpend(db, reservation, produced?.usage);
      } catch (error) {
        await markFoundrySpendUncertain(db, reservation, error);
      }
    }
    return Array.isArray(produced?.questions) ? produced.questions : [];
  } catch (error) {
    if (started && reservation) await markFoundrySpendUncertain(db, reservation, error).catch(() => null);
    throw error;
  }
}

// ═════════════════════════════════════════════════════════════════════════
// WRITES
// ═════════════════════════════════════════════════════════════════════════

/**
 * Persist generated cards.
 *
 * ONE statement, `jsonb_to_recordset` over the whole batch, ownership proved in
 * SQL (`authorized`) rather than by the caller, and `on conflict do nothing` on
 * the dedupe index so a re-run of the generator is free. The final cap is
 * enforced HERE as well as in `generateReviewCards`, because the pure function
 * cannot see a card another request inserted while it was thinking.
 */
export async function persistReviewCards(db, ownerUserId, replicaIdValue, cards) {
  if (typeof db !== "function") fail("review_db_required", 503);
  const rid = replicaId(replicaIdValue);
  const owner = reviewUuid(ownerUserId, "review_owner_required");
  const payload = (Array.isArray(cards) ? cards : []).slice(0, REVIEW_OPEN_CAP).map((row) => ({
    kind: String(row.kind),
    prompt_text: String(row.prompt_text),
    answer_text: String(row.answer_text ?? ""),
    source_refs: Array.isArray(row.source_refs) ? row.source_refs : [],
    origin_ref: String(row.origin_ref ?? ""),
    dedupe_hash: String(row.dedupe_hash),
  }));
  if (!payload.length) return [];
  const rows = await db(
    `with authorized as (${OWNED}), room as (
       select greatest(0, $4::int4 - count(*) filter (where c.state = 'open'))::int4 as slots
         from vy_review_card c
        where c.replica_id = $1::uuid and c.owner_user_id = $2::uuid
     ), drafts as (
       select e.item->>'kind' as kind,
              e.item->>'prompt_text' as prompt_text,
              coalesce(e.item->>'answer_text', '') as answer_text,
              coalesce(e.item->'source_refs', '[]'::jsonb) as source_refs,
              coalesce(e.item->>'origin_ref', '') as origin_ref,
              e.item->>'dedupe_hash' as dedupe_hash,
              e.ordinal as rank
         from jsonb_array_elements($3::jsonb) with ordinality as e(item, ordinal)
     ), inserted as (
       insert into vy_review_card
         (replica_id, owner_user_id, kind, prompt_text, answer_text, source_refs, origin_ref, dedupe_hash)
       select a.replica_id, $2::uuid, d.kind, d.prompt_text, d.answer_text, d.source_refs,
              d.origin_ref, d.dedupe_hash
         from authorized a cross join drafts d cross join room
        where d.rank <= room.slots
       on conflict (replica_id, dedupe_hash) do nothing
       returning card_id, kind, prompt_text, answer_text, source_refs, state, decided_at,
                 correction_source_id, created_at
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1::uuid, $2::uuid, 'review.cards.generate', 'review_card',
              (select count(*) from inserted)::text, $5, 'allowed',
              jsonb_build_object('written', (select count(*) from inserted))
        where (select count(*) from inserted) > 0
     )
     select * from inserted order by created_at asc, card_id asc`,
    [rid, owner, JSON.stringify(payload), REVIEW_OPEN_CAP, REPLICA_POLICY_VERSION],
  );
  return rows.map(clientCard);
}

// ═════════════════════════════════════════════════════════════════════════
// WS-R112. THE INSTRUCTION-SHAPED-MATERIAL CARD.
// ═════════════════════════════════════════════════════════════════════════
//
// A short, readable phrase for each class `api/_material-detector.js` can
// name, joined below into the card's `answer_text` — never the raw class
// TOKEN alone, because a card is read by a creator, not grepped by a
// developer. Kept here, server-side, rather than left to the studio to
// map, so the string a creator reads is the same string `evals/review-
// queue/run.mjs` can assert against.
const MATERIAL_FLAG_CLASS_LABEL = Object.freeze({
  instruction_override: "tries to override your AI's instructions",
  fake_system_prompt: "is written to look like a system prompt",
  role_reassignment: "tries to reassign your AI to a different role",
  exfil_bait: "asks your AI to repeat back what someone else said",
  other_creator_identity: "names a different creator as who built this AI",
  secret_shaped: "asks your AI to remember and repeat a secret-looking string",
  homoglyph: "hides one of the above behind lookalike characters",
});

function materialFlagReason(matchedClasses) {
  const labels = (Array.isArray(matchedClasses) ? matchedClasses : [])
    .map((cls) => MATERIAL_FLAG_CLASS_LABEL[cls] || cls);
  return labels.length ? `This source ${labels.join("; and it ")}.` : "";
}

/**
 * ONE card per flagged source, written from the mining path
 * (`api/_context-locker.js::mineStored`, itself calling
 * `api/_context-mining.js::materialFlagFor`) — never a runtime filter and
 * never a silent drop. `on conflict (replica_id, dedupe_hash) do nothing`,
 * keyed on the SOURCE (`reviewDedupeSubject`'s own 'instruction_shaped'
 * branch), so a re-mine of the same item never doubles the card — the exact
 * idempotence `persistReviewCards`'s own dedupe index already gives every
 * other kind, extended here rather than re-invented.
 *
 * Capped by the SAME open-queue room every other card generator respects
 * (`persistReviewCards`'s own `room` CTE, restated here for one card rather
 * than a batch): a hostile bulk upload cannot grow the queue past
 * `REVIEW_OPEN_CAP` any more than an ordinary one can.
 *
 * @returns the newly written card, or `null` when nothing NEW landed — the
 *          queue was full, or (the dedupe index's own job) this exact source
 *          already has one. `mineStored` marks the underlying item mined
 *          either way; the card is a NOTIFICATION of a finding, never a
 *          precondition for storing the source.
 */
export async function persistInstructionShapedCard(db, ownerUserId, replicaIdValue, itemId, flag) {
  if (typeof db !== "function") fail("review_db_required", 503);
  const rid = replicaId(replicaIdValue);
  const owner = reviewUuid(ownerUserId, "review_owner_required");
  const matchedClasses = Array.isArray(flag?.matchedClasses) ? flag.matchedClasses : [];
  if (!matchedClasses.length) return null;
  const originRef = `context_item:${String(itemId).trim().toLowerCase()}`;
  const promptText = reviewText(flag.firstSentence || "", 500)
    || "This source reads like an instruction aimed at your AI, not material to teach it from.";
  const answerText = reviewText(materialFlagReason(matchedClasses), 4_000);
  const dedupeHash = reviewDedupeHash("instruction_shaped", promptText, answerText, originRef);
  const rows = await db(
    `with authorized as (${OWNED}), room as (
       select greatest(0, $8::int4 - count(*) filter (where c.state = 'open'))::int4 as slots
         from vy_review_card c
        where c.replica_id = $1::uuid and c.owner_user_id = $2::uuid
     ), inserted as (
       insert into vy_review_card
         (replica_id, owner_user_id, kind, prompt_text, answer_text, source_refs, origin_ref, dedupe_hash)
       select a.replica_id, $2::uuid, 'instruction_shaped', $3::text, $4::text, $5::jsonb, $6::text, $7::text
         from authorized a cross join room
        where room.slots > 0
       on conflict (replica_id, dedupe_hash) do nothing
       returning card_id, kind, prompt_text, answer_text, source_refs, state, decided_at,
                 correction_source_id, created_at
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1::uuid, $2::uuid, 'review.card.material_flag', 'review_card',
              (select card_id from inserted)::text, $9, 'allowed',
              jsonb_build_object('item_id', $10::text, 'matched_classes', $11::jsonb)
        where exists (select 1 from inserted)
     )
     select * from inserted`,
    [rid, owner, promptText, answerText, JSON.stringify([{ item_id: String(itemId) }]), originRef, dedupeHash,
      REVIEW_OPEN_CAP, REPLICA_POLICY_VERSION, String(itemId), JSON.stringify(matchedClasses)],
  );
  return rows[0] ? clientCard(rows[0]) : null;
}

/**
 * Mint the pending correction source for one card.
 *
 * "Close, fix it" typed and "Close, fix it" DICTATED are the same lane: the
 * bytes go to the private bucket through the existing signed upload, the source
 * is finalized through the existing `api/replica-source.js?op=finalize`, and the
 * DAG transcribes an audio one exactly as it transcribes a lecture. NOTHING is
 * transcribed inside a request handler — an ASR call on the decision path is a
 * thirty-second card that takes forty seconds.
 */
export async function openCorrectionUpload(db, ownerUserId, input, deps = {}) {
  const rid = replicaId(input?.replica_id);
  const owner = reviewUuid(ownerUserId, "review_owner_required");
  const cardId = reviewUuid(input?.card_id, "review_card_id_required");
  const shape = CORRECTION_KINDS[String(input?.correction_kind || "text")];
  if (!shape) fail("review_correction_kind_invalid", 400);
  const mime = String(input?.mime || "").split(";", 1)[0].trim().toLowerCase();
  if (!shape.mimes.includes(mime)) fail("review_correction_mime_invalid", 400);
  // The card must be OPEN and this owner's before a byte is admitted. A signed
  // upload URL minted for a card that is already decided is an upload with
  // nowhere to land.
  const open = await db(
    `select c.card_id from vy_review_card c join vy_replica r
        on r.replica_id = c.replica_id and r.owner_user_id = c.owner_user_id
      where c.card_id = $3::uuid and c.replica_id = $1::uuid and c.owner_user_id = $2::uuid
        and c.state = 'open' and r.lifecycle not in ('revoked','purging') limit 1`,
    [rid, owner, cardId],
  );
  if (!open[0]) fail("review_card_not_open", 409);
  const create = deps.createSource || createPendingSource;
  const source = await create(db, owner, rid, {
    kind: shape.kind,
    mime,
    byte_size: input?.byte_size,
    sha256: input?.sha256,
    contains_third_parties: false,
    purpose: "correction",
  }, { sourceId: deps.sourceId || randomUUID() });
  if (!source) fail("capture_and_storage_consent_required", 409);
  return source;
}

/**
 * ONE decision, ONE statement.
 *
 * The clause that carries the whole law is `candidate ... where c.state='open'`
 * joined to `correction ... where s.purpose='correction'`: a 'fixed' decision
 * cannot flip the card unless the correction source is already there, is this
 * owner's, and has not been rejected. Strike either half and a tap that lost
 * its correction reports success. `evals/review-queue/run.mjs` strikes them and
 * FAILS unless the struck copy writes, which is what proves the clause is doing
 * the work.
 *
 * `invalidated` is the derived-material half. It does NOT patch a derived row:
 * it retires the draft person profile and the person_profile build that were
 * derived from the answer the owner just corrected, so the next build re-derives
 * from a source set that now contains the correction. The audit fact
 * `derived_models_invalidated` is the same fact `source.delete.request` writes
 * in `api/_replica-source.js`, deliberately spelled the same way so one grep
 * finds every place derived material is thrown away.
 */
export async function decideReviewCard(db, ownerUserId, input) {
  if (typeof db !== "function") fail("review_db_required", 503);
  const rid = replicaId(input?.replica_id);
  const owner = reviewUuid(ownerUserId, "review_owner_required");
  const cardId = reviewUuid(input?.card_id, "review_card_id_required");
  const decision = String(input?.decision || "");
  if (!REVIEW_DECISIONS.includes(decision)) fail("review_decision_invalid", 400);
  // WS-R112. The DB `state` column stays the four values migration 074
  // opened; `decision` (the raw code, `$4` below) is what every GATE keys
  // on, so 'remove_source' never trips the never-rule branch it maps onto
  // for storage. See `STATE_FOR_DECISION`'s own header.
  const dbState = STATE_FOR_DECISION[decision];

  const correctionSourceId = decision === "fixed"
    ? reviewUuid(input?.correction_source_id, "review_correction_source_required")
    : null;
  // The never-rule's pattern defaults to the ANSWER the owner just forbade,
  // which is the thing they tapped. It is a matcher, never a prompt line.
  const pattern = decision === "never"
    ? neverRulePattern(input?.pattern || input?.answer_text || "")
    : "";
  const reason = decision === "never" ? reviewText(input?.reason, 500) : "";

  const rows = await db(
    `with authorized as (${OWNED}), candidate as (
       select c.card_id, c.kind, c.origin_ref, c.answer_text
         from vy_review_card c join authorized a on a.replica_id = c.replica_id
        where c.card_id = $3::uuid and c.owner_user_id = $2::uuid and c.state = 'open'
     ), correction as (
       select s.source_id from vy_replica_source s cross join candidate
        where $4::text = 'fixed' and s.source_id = $5::uuid and s.replica_id = $1::uuid
          and s.owner_user_id = $2::uuid and s.purpose = 'correction'
          and s.state <> 'rejected'
     ), existing_rule as (
       select n.rule_id from vy_review_never_rule n cross join candidate
        where $4::text = 'never' and n.replica_id = $1::uuid and n.owner_user_id = $2::uuid
          and lower(n.pattern) = lower($6::text) and n.revoked_at is null
     ), inserted_rule as (
       insert into vy_review_never_rule (replica_id, owner_user_id, pattern, reason, card_id)
       select $1::uuid, $2::uuid, $6::text, $7::text, c.card_id from candidate c
        where $4::text = 'never' and not exists (select 1 from existing_rule)
       -- The partial unique index on (replica_id, lower(pattern)) where
       -- revoked_at is null. A concurrent tap on the same phrase must not be a
       -- 500: it lands nothing, landed_rule is empty, the card stays OPEN and
       -- the caller gets a named refusal it can retry. Failing in the direction
       -- of "your tap did not take" is correct; failing in the direction of
       -- "flipped, rule missing" is the one thing that must not happen.
       on conflict do nothing
       returning rule_id
     ), landed_rule as (
       select rule_id from inserted_rule union all select rule_id from existing_rule
     ), decided as (
       update vy_review_card c
          set state = $9::text, decided_at = now(),
              correction_source_id = (select source_id from correction)
         from candidate k
        where c.card_id = k.card_id and c.state = 'open'
          and ($4::text <> 'fixed' or exists (select 1 from correction))
          and ($4::text <> 'never' or exists (select 1 from landed_rule))
          -- WS-R112. "Remove this source" exists for NO card kind but
          -- 'instruction_shaped' - a WHERE-clause boundary, never a JS
          -- check alone, per gate0-structural.
          and ($4::text <> 'remove_source' or k.kind = 'instruction_shaped')
       returning c.card_id, c.kind, c.origin_ref, c.prompt_text, c.answer_text, c.source_refs,
                 c.state, c.decided_at, c.correction_source_id, c.created_at
     ), removed_item as (
       -- WS-R112. origin_ref is context_item:<item_id> for every
       -- 'instruction_shaped' card (persistInstructionShapedCard's own
       -- write) - 13 characters before the id, substring(... from 14)
       -- restated from claim_target's own from-7 one CTE below (that
       -- one strips 'claim:', 6 characters plus the colon).
       select (substring(d.origin_ref from 14))::uuid as item_id
         from decided d
        where $4::text = 'remove_source' and d.origin_ref ~ '^context_item:[0-9a-f-]{36}$'
     ), item_refused as (
       -- "Remove this source": the item is marked refused, by name, the
       -- SAME state a source the platform never read at all carries
       -- (vy_context_item_refusal_named's own gate: refused always names
       -- why). applyIngestRunDelta (api/_channel-ingest.js) refuses to
       -- approve a run whose source item is refused - the "sheet rebuild"
       -- half of this law, read and fixed by this workstream rather than
       -- assumed already true.
       update vy_context_item i
          set status = 'refused', refusal_reason = 'instruction_shaped', updated_at = now()
         from removed_item ri
        where i.item_id = ri.item_id and i.replica_id = $1::uuid and i.owner_user_id = $2::uuid
       returning i.item_id
     ), claim_target as (
       select (substring(d.origin_ref from 7))::int8 as claim_id, d.state
         from decided d where d.origin_ref ~ '^claim:[0-9]+$'
     ), claim_decided as (
       insert into vy_replica_claim_decision
         (claim_id, replica_id, owner_user_id, decision, reason_code, policy_version)
       select t.claim_id, $1::uuid, $2::uuid,
              case t.state when 'sounds_right' then 'accepted'
                           when 'never' then 'rejected' else 'superseded' end,
              case t.state when 'sounds_right' then 'accurate'
                           when 'never' then 'not_me' else 'replaced' end, $8::text
         from claim_target t
        where exists (select 1 from vy_replica_claim c
                       where c.claim_id = t.claim_id and c.replica_id = $1::uuid
                         and c.owner_user_id = $2::uuid)
       returning claim_id, decision
     ), claim_state as (
       update vy_replica_claim c
          set status = case k.decision when 'accepted' then 'approved'
                                       when 'rejected' then 'rejected' else 'superseded' end,
              updated_at = now()
         from claim_decided k
        where c.claim_id = k.claim_id and c.replica_id = $1::uuid and c.owner_user_id = $2::uuid
     ), retired_profiles as (
       update vy_replica_profile p set status = 'retired'
        where p.replica_id = $1::uuid and p.status = 'draft'
          and exists (select 1 from decided d where d.state = 'fixed')
     ), retired_builds as (
       update vy_replica_model_build b
          set state = 'retired', failure_code = 'owner_correction_recorded', updated_at = now()
        where b.replica_id = $1::uuid and b.owner_user_id = $2::uuid
          and b.build_kind = 'person_profile' and b.state in ('queued','retry','review')
          and exists (select 1 from decided d where d.state = 'fixed')
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1::uuid, $2::uuid, 'review.card.decide', 'review_card', d.card_id::text, $8,
              case when d.state = 'never' then 'denied' else 'allowed' end,
              jsonb_build_object('decision', d.state, 'kind', d.kind,
                                 'derived_models_invalidated', d.state = 'fixed',
                                 'never_rule', (select count(*) from landed_rule),
                                 'decision_code', $4::text,
                                 'source_removed', exists (select 1 from item_refused))
         from decided d
     )
     select * from decided`,
    [rid, owner, cardId, decision, correctionSourceId, pattern, reason, REPLICA_POLICY_VERSION, dbState],
  );
  if (rows[0]) return clientCard(rows[0]);
  // A refusal is NAMED. "Not yours" and "does not exist" are the same answer
  // (api/_clonechannel.js's rule), so the only thing distinguished here is the
  // state an owner can act on.
  const still = await db(
    `select c.state from vy_review_card c
      where c.card_id = $3::uuid and c.replica_id = $1::uuid and c.owner_user_id = $2::uuid limit 1`,
    [rid, owner, cardId],
  );
  if (!still[0]) fail("review_card_not_found", 404);
  if (still[0].state !== "open") fail("review_card_already_decided", 409);
  fail(decision === "fixed" ? "review_correction_source_missing" : "review_decision_not_applied", 409);
  return null;
}
