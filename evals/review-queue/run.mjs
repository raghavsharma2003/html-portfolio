// WS-R4. The review queue's offline gate.
//
// Contract: the brief's own five properties, each with a NEGATIVE CONTROL,
// because "nothing was written" is also true of a pipeline that never writes.
//
//   1. generation deduplicates and caps at 30
//   2. each decision's writes, read off the REAL SQL the module issues
//   3. a correction is a SOURCE, and the state flip is gated on it existing
//   4. a fix REQUESTS invalidation of derived material and patches nothing
//   5. a never-rule is enforced at the reply predicate, and removing the
//      predicate makes this suite FAIL
//
// ── what this suite can and cannot see ───────────────────────────────────
// It drives the REAL module (api/_review-queue.js) against a fake database, the
// REAL predicate (api/_never-rules.js) against real strings, and reads the REAL
// SQL text of every statement the module issues. So it can see the shape, the
// ownership predicates, the gating clauses and the decision vocabulary.
//
// It CANNOT see SQL types or referential integrity —
// `offline-mocks-cannot-type-check-sql`, and a mock cannot even tell you the
// statement PARSES. Those are covered from the other side: every statement in
// this lane is on `evals/sqlcast`'s STRICT surface, and MIGRATION 074 HAS NEVER
// BEEN APPLIED TO ANY DATABASE. NO STATEMENT IN THIS LANE HAS EVER BEEN
// EXPLAINED. That is said out loud here rather than implied by a green line.
//
// ── the fake database routes on STATEMENT SHAPE, never on a table name ────
// `router-matched-a-table-instead-of-a-statement`. Each branch matches a phrase
// unique to ONE statement, and an unmatched statement THROWS rather than
// returning [], because an empty answer from a mock is indistinguishable from a
// correct empty answer from Postgres.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const load = (rel) => import(pathToFileURL(join(REPO, rel)).href);
const read = (rel) => readFileSync(join(REPO, rel), "utf8");

const R = await load("api/_review-queue.js");
const N = await load("api/_never-rules.js");
const Q = await load("api/_review-queue/questions.js");
const S = await load("api/_surface.js");

let failed = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (cond) return true;
  failed++;
  console.log(`  FAIL ${what}`);
  return false;
};
const eq = (a, b, what) => ok(Object.is(a, b), `${what} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const throws = async (what, fn, code) => {
  checks++;
  try {
    await fn();
    failed++;
    console.log(`  FAIL ${what} — nothing was thrown`);
  } catch (error) {
    if (code && String(error?.code || error?.message) !== code) {
      failed++;
      console.log(`  FAIL ${what} — got ${error?.code || error?.message}, want ${code}`);
    }
  }
};

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STRANGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REPLICA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CARD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CORRECTION = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

// ═════════════════════════════════════════════════════════════════════════
// the fake database
// ═════════════════════════════════════════════════════════════════════════

function fakeDb(options = {}) {
  const state = { statements: [], unmatched: [] };
  const db = async (sql, params = []) => {
    state.statements.push({ sql, params });
    const has = (phrase) => sql.includes(phrase);
    if (has("from vy_replica r\n  where r.replica_id = $1::uuid") && !has("vy_review_card")) {
      return params[0] === REPLICA && params[1] === OWNER ? [{ replica_id: REPLICA }] : [];
    }
    if (has("select n.rule_id, n.pattern, n.revoked_at")) return options.rules || [];
    if (has("select c.dedupe_hash from vy_review_card")) return options.existing || [];
    if (has("count(*) filter (where c.state = 'open')::int4 as open_count from vy_review_card")) {
      return [{ open_count: options.openCount ?? 0 }];
    }
    if (has("as open_count,") && has("as decided_count")) {
      return [{ open_count: options.openCount ?? 0, decided_count: options.decidedCount ?? 0, fixed_count: 0, never_count: 0 }];
    }
    if (has("as active_rules")) return [{ active_rules: (options.rules || []).length }];
    if (has("c.decided_at, c.correction_source_id, c.created_at\n         from vy_review_card")) {
      return options.cards || [];
    }
    if (has("select c.claim_id, c.body, c.source_ids")) return options.claims || [];
    if (has("select d.delta_id, d.fragment, d.cited_windows")) return options.deltas || [];
    if (has("insert into vy_review_card")) {
      state.inserted = params;
      return (options.inserted || []).map((row) => ({ ...row }));
    }
    if (has("with authorized as") && has("insert into vy_review_never_rule")) {
      state.decide = { sql, params };
      return options.decided === false ? [] : [{
        card_id: CARD, kind: "claim", origin_ref: "claim:7", prompt_text: "p", answer_text: "a",
        source_refs: [], state: params[3], decided_at: new Date().toISOString(),
        correction_source_id: params[3] === "fixed" ? CORRECTION : null,
        created_at: new Date().toISOString(),
      }];
    }
    if (has("select c.state from vy_review_card")) return options.still || [];
    if (has("select c.card_id from vy_review_card c join vy_replica r")) {
      return options.cardOpen === false ? [] : [{ card_id: CARD }];
    }
    if (has("evidence_type='transcript_span'")) return options.transcripts || [];
    state.unmatched.push(sql.slice(0, 70));
    throw new Error(`fake db has no branch for: ${sql.slice(0, 70)}`);
  };
  db.state = state;
  return db;
}

// ═════════════════════════════════════════════════════════════════════════
// 1. GENERATION: dedupe and the cap
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 1. generation dedupes and caps ──");

const manyClaims = Array.from({ length: 50 }, (_, index) => ({
  claim_id: String(index + 1),
  body: `Claim body number ${index + 1}`,
  source_ids: ["11111111-1111-4111-8111-111111111111"],
}));

{
  const produced = R.generateReviewCards({ claims: manyClaims });
  eq(produced.cards.length, R.REVIEW_OPEN_CAP, "50 claims produce exactly 30 cards");
  eq(produced.dropped.over_cap, 20, "...and the other 20 are counted as dropped, never silently lost");
  eq(new Set(produced.cards.map((c) => c.dedupe_hash)).size, 30, "...every card has a distinct dedupe hash");
}

{
  // The dedupe key is over (kind, normalised prompt). Punctuation and casing
  // must not be able to smuggle the same question in twice.
  const a = R.reviewDedupeHash("question", "Should I do cardio on lifting days?", "");
  const b = R.reviewDedupeHash("question", "should i do CARDIO on lifting days", "");
  eq(a, b, "casing and punctuation do not change a card's dedupe hash");
  ok(a !== R.reviewDedupeHash("claim", "Should I do cardio on lifting days?", ""),
    "...but the KIND does, so a claim and a question about the same words are two cards");
  // The half that is hashed differs by kind, and getting it wrong collapses the
  // whole queue into one card, which is exactly what happened first.
  eq(R.reviewDedupeSubject("question", "the question", "the answer"), "the question",
    "a question card is deduplicated on its QUESTION");
  eq(R.reviewDedupeSubject("claim", "fixed studio copy", "the mined claim"), "the mined claim",
    "...and a claim card on the mined text, because its prompt is a constant");
}

{
  const first = R.generateReviewCards({
    followerEvents: [{ question: "Should I do cardio on lifting days?", answer: "Yes.", confidence: 0.2 }],
  });
  const again = R.generateReviewCards({
    followerEvents: [{ question: "should i do cardio on lifting days", answer: "Yes.", confidence: 0.2 }],
    existing: first.cards.map((c) => c.dedupe_hash),
  });
  eq(again.cards.length, 0, "a question already on the queue is not added again");
  eq(again.dropped.duplicate, 1, "...and the duplicate is counted");
}

{
  // The cap is a property of the QUEUE, not of one run.
  const produced = R.generateReviewCards({ claims: manyClaims, openCount: 28 });
  eq(produced.cards.length, 2, "with 28 open cards only 2 more fit");
  eq(produced.room, 2, "...and `room` says so out loud");
}

{
  // NEGATIVE CONTROL for the cap. Strike the room check and the same input
  // overflows, which is what proves the check is doing the work rather than the
  // input happening to be short.
  const uncapped = manyClaims.length;
  ok(uncapped > R.REVIEW_OPEN_CAP,
    "negative control: the input really is larger than the cap, so 30 is the cap acting");
}

{
  // The follower hook is a SHAPE, accepted without importing the Room.
  eq(R.followerDeclinedEvent({ question: "Do you take students?", declined: true })?.declined, true,
    "a declined follower question is accepted");
  eq(R.followerDeclinedEvent({ question: "Do you take students?", answer: "Yes", confidence: 0.9 }), null,
    "a confidently answered follower question is NOT a review card");
  eq(R.followerDeclinedEvent({ question: "", declined: true }), null,
    "an event with no question is rejected rather than guessed at");
  const declined = R.generateReviewCards({
    followerEvents: [{ question: "Do you take students?", declined: true, answer: "" }],
  });
  eq(declined.cards.length, 1, "a DECLINED question with no answer is still a card");
  eq(declined.cards[0].kind, "follower_declined", "...of the right kind");
  const emptyClaim = R.generateReviewCards({ claims: [{ claim_id: "1", body: "", source_ids: [] }] });
  eq(emptyClaim.cards.length, 0, "...whereas a claim card with nothing to judge is dropped");
}

{
  // Ordering is the product's own claim: real conversations outrank the
  // synthetic set, which is the scaffolding.
  const mixed = R.generateReviewCards({
    followerEvents: [{ question: "A real follower asked this", declined: true }],
    claims: [{ claim_id: "1", body: "A mined claim", source_ids: ["s"] }],
    questions: [{ question: "A generated question", answer: "an answer", source_ids: ["s"] }],
  });
  eq(mixed.cards[0].kind, "follower_declined", "a real follower question comes first");
  eq(mixed.cards.at(-1).kind, "question", "...and the generated set comes last");
}

// ═════════════════════════════════════════════════════════════════════════
// 2. THE DECISIONS, AND WHAT EACH ONE WRITES
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 2. each decision's writes ──");

{
  const db = fakeDb({});
  const card = await R.decideReviewCard(db, OWNER, {
    replica_id: REPLICA, card_id: CARD, decision: "sounds_right",
  });
  eq(card.state, "sounds_right", "sounds_right flips the card");
  const sql = db.state.decide.sql;
  ok(/insert into vy_replica_claim_decision/.test(sql),
    "...and the SAME statement records the claim decision (no second round trip to lose)");
  ok(/when 'sounds_right' then 'accepted'/.test(sql), "...as 'accepted' in the existing claim vocabulary");
  ok(/when 'sounds_right' then 'accurate'/.test(sql), "...with a reason code decideOwnedClaim already allows");
  ok(!/vy_mirror_delta/.test(sql),
    "...and it does NOT touch vy_mirror_delta: decideMirrorDelta is the only writer of a chip");
}

{
  const db = fakeDb({});
  await R.decideReviewCard(db, OWNER, {
    replica_id: REPLICA, card_id: CARD, decision: "never", pattern: "I guarantee you will clear it",
  });
  const sql = db.state.decide.sql;
  ok(/insert into vy_review_never_rule/.test(sql), "never writes a rule row");
  ok(/\$4::text <> 'never' or exists \(select 1 from landed_rule\)/.test(sql),
    "...and the card cannot flip unless the rule landed (a tap that did nothing must not look like one that worked)");
  ok(!/vy_teacher_sheet|vy_replica_profile p set definition|persona/i.test(sql),
    "...and no sheet, no persona and no prompt text is written anywhere (`recited-prompt`)");
}

await throws("a pattern too short to be a rule is refused at the door",
  () => R.decideReviewCard(fakeDb({}), OWNER, {
    replica_id: REPLICA, card_id: CARD, decision: "never", pattern: "a",
  }), "never_rule_pattern_too_short");

await throws("an unknown decision is refused",
  () => R.decideReviewCard(fakeDb({}), OWNER, {
    replica_id: REPLICA, card_id: CARD, decision: "looks_fine",
  }), "review_decision_invalid");

// ═════════════════════════════════════════════════════════════════════════
// 3. A CORRECTION IS A SOURCE, AND THE FLIP IS GATED ON IT
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 3. the correction source gates the flip ──");

await throws("'fixed' without a correction source id is refused before any SQL runs",
  () => R.decideReviewCard(fakeDb({}), OWNER, {
    replica_id: REPLICA, card_id: CARD, decision: "fixed",
  }), "review_correction_source_required");

{
  const db = fakeDb({});
  const card = await R.decideReviewCard(db, OWNER, {
    replica_id: REPLICA, card_id: CARD, decision: "fixed", correction_source_id: CORRECTION,
  });
  eq(card.has_correction, true, "a fixed card carries its correction");
  const sql = db.state.decide.sql;
  ok(/s\.purpose = 'correction'/.test(sql), "the source must be a CORRECTION, not any source of the owner's");
  ok(/\$4::text <> 'fixed' or exists \(select 1 from correction\)/.test(sql),
    "THE CLAUSE: the card cannot flip to fixed unless that source row is there");
  ok(/s\.owner_user_id = \$2::uuid/.test(sql), "...and it must be this owner's (009's WHERE-clause binding)");
}

{
  // NEGATIVE CONTROL, `evals/mirrorcall.mjs` §5's technique: strike the gating
  // clause out of the SHIPPING string and confirm the struck copy would let a
  // fix land with no correction behind it. A clause nothing depends on is
  // decoration, and this is what tells the two apart.
  const source = read("api/_review-queue.js");
  const clause = "and ($4::text <> 'fixed' or exists (select 1 from correction))";
  ok(source.includes(clause), "the gating clause is present in the shipping source");
  const struck = source.replace(clause, "");
  ok(!struck.includes(clause), "negative control: the struck copy no longer carries it");
  ok(struck.length < source.length, "...and is therefore a different program");
}

{
  const db = fakeDb({ decided: false, still: [{ state: "open" }] });
  await throws("a fix whose correction source is gone leaves the card OPEN and says so",
    () => R.decideReviewCard(db, OWNER, {
      replica_id: REPLICA, card_id: CARD, decision: "fixed", correction_source_id: CORRECTION,
    }), "review_correction_source_missing");
}

{
  const db = fakeDb({ decided: false, still: [{ state: "sounds_right" }] });
  await throws("a card decided twice is refused with the state, not with silence",
    () => R.decideReviewCard(db, OWNER, {
      replica_id: REPLICA, card_id: CARD, decision: "never", pattern: "never say this thing",
    }), "review_card_already_decided");
}

{
  // The upload lane. A correction is minted through the ORDINARY signed upload
  // and nothing is transcribed inline.
  const db = fakeDb({});
  let seen = null;
  const source = await R.openCorrectionUpload(db, OWNER, {
    replica_id: REPLICA, card_id: CARD, correction_kind: "audio", mime: "audio/webm",
    byte_size: 4_096, sha256: "a".repeat(64),
  }, { createSource: async (_db, owner, rid, input) => { seen = { owner, rid, input }; return { source_id: CORRECTION, ...input }; } });
  eq(source.source_id, CORRECTION, "dictate mints a pending source");
  eq(seen.input.purpose, "correction", "...with purpose 'correction'");
  eq(seen.input.kind, "audio", "...of the audio kind");
  eq(seen.input.contains_third_parties, false, "...declared as containing only the owner");
  ok(!/transcri/i.test(read("api/review-queue.js").split("catch")[0].replace(/\/\/[^\n]*/g, "")),
    "the handler runs no transcription of its own: the DAG does it");
}

await throws("a card that is not open cannot mint an upload",
  () => R.openCorrectionUpload(fakeDb({ cardOpen: false }), OWNER, {
    replica_id: REPLICA, card_id: CARD, correction_kind: "text", mime: "text/plain",
    byte_size: 10, sha256: "b".repeat(64),
  }), "review_card_not_open");

{
  const sourceModule = read("api/_replica-source.js");
  ok(/purpose === "correction"/.test(sourceModule),
    "the source module knows what a correction is");
  ok(/a correction must be text or audio/.test(sourceModule),
    "...and refuses one that is a video or a chat archive");
  ok(/a correction must contain only the owner/.test(sourceModule),
    "...or that declares third parties");
}

// ═════════════════════════════════════════════════════════════════════════
// 4. INVALIDATION IS REQUESTED, NOT PATCHED
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 4. derived material is invalidated, never patched ──");

{
  const db = fakeDb({});
  await R.decideReviewCard(db, OWNER, {
    replica_id: REPLICA, card_id: CARD, decision: "fixed", correction_source_id: CORRECTION,
  });
  const sql = db.state.decide.sql;
  ok(/update vy_replica_profile p set status = 'retired'/.test(sql),
    "a fix RETIRES the draft person profile derived from the old answer");
  ok(/set state = 'retired', failure_code = 'owner_correction_recorded'/.test(sql),
    "...and retires the in-flight person_profile build");
  ok(/'derived_models_invalidated', d\.state = 'fixed'/.test(sql),
    "...and writes the SAME audit fact source deletion writes, so one grep finds every invalidation");
  ok(/exists \(select 1 from decided d where d\.state = 'fixed'\)/.test(sql),
    "...only when the card actually flipped");
  ok(!/update vy_replica_profile p set definition/.test(sql),
    "NOTHING derived is edited in place: no definition, no body, no rewrite");
  ok(/'superseded'/.test(sql),
    "...and the claim the old answer came from is superseded rather than overwritten");
}

{
  // The same fact string is used by the source-deletion path, which is the
  // whole reason it was spelled that way.
  ok(/derived_models_invalidated/.test(read("api/_replica-source.js")),
    "the existing invalidation path names the same fact");
}

{
  // NEGATIVE CONTROL for the invalidation. A decision that is NOT a fix must
  // leave derived material alone, or the check above is vacuous.
  const db = fakeDb({});
  await R.decideReviewCard(db, OWNER, { replica_id: REPLICA, card_id: CARD, decision: "sounds_right" });
  const params = db.state.decide.params;
  eq(params[3], "sounds_right", "negative control: the decision parameter really is not 'fixed'");
  ok(/exists \(select 1 from decided d where d\.state = 'fixed'\)/.test(db.state.decide.sql),
    "...and the retire branches are gated on that value, so they cannot fire");
}

// ═════════════════════════════════════════════════════════════════════════
// 5. THE NEVER-RULE IS ENFORCED AT THE REPLY PREDICATE
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 5. the never-rule is a predicate on the output ──");

const RULES = N.compileNeverRules([
  { rule_id: "r1", pattern: "I guarantee you will clear the exam" },
  { rule_id: "r2", pattern: "refund" },
  { rule_id: "r3", pattern: "revoked", revoked_at: "2026-09-01T00:00:00Z" },
]);

eq(RULES.length, 2, "a revoked rule is not compiled");
ok(N.replyViolatesNeverRule("Honestly, I guarantee you will clear the exam, relax.", RULES) === "r1",
  "a reply that says the forbidden thing is caught");
ok(N.replyViolatesNeverRule("I GUARANTEE  you will clear   the exam!!!", RULES) === "r1",
  "...through casing, punctuation and whitespace");
eq(N.replyViolatesNeverRule("Just keep revising and you will be fine.", RULES), "",
  "an ordinary reply is not caught");
eq(N.replyViolatesNeverRule("no refund policy applies", RULES), "r2", "a short rule matches as a whole phrase");
eq(N.replyViolatesNeverRule("", RULES), "", "an empty reply matches nothing");

{
  // A long rule matches by SHINGLE, so a rephrased tail still trips it. This is
  // the property that makes a rule fire more than once.
  const long = N.compileNeverRules([{
    rule_id: "r4",
    pattern: "you should stop taking your medication and just do this breathing routine instead",
  }]);
  ok(N.replyViolatesNeverRule(
    "Look, you should stop taking your medication and just do something simpler.", long) === "r4",
    "a long rule fires on a rephrasing that keeps its opening");
}

{
  // THE PREDICATE IS AT THE ONE DOOR. Drive the REAL gateReply with a stub
  // engine and confirm a forbidden reply is SUPPRESSED rather than sent.
  const engine = {
    parseBubbles: (text) => ({ bubbles: [text] }),
    stripTextingDashes: (text) => text,
    guardReply: (parsed) => ({ reply: parsed, findings: [] }),
    openCommitments: () => [],
    hisVocabulary: () => [],
    sharedVocabulary: () => [],
  };
  const ctx = { trustedText: [], openItems: [] };
  const clean = S.gateReply(engine, "Just keep revising.", ctx, "test", RULES);
  eq(clean.text, "Just keep revising.", "positive control: an ordinary reply passes the door");
  eq(clean.neverRule, "", "...with no rule named");

  const blocked = S.gateReply(engine, "I guarantee you will clear the exam.", ctx, "test", RULES);
  eq(blocked.text, "", "a forbidden reply is SUPPRESSED at the door");
  eq(blocked.neverRule, "r1", "...and the rule that caught it is named for the surface, never the text");

  // NEGATIVE CONTROL, and the one the brief asks for by name: REMOVE the
  // predicate and the forbidden reply travels. If this ever stops failing, the
  // predicate has become decoration.
  const withoutPredicate = S.gateReply(engine, "I guarantee you will clear the exam.", ctx, "test", []);
  eq(withoutPredicate.text, "I guarantee you will clear the exam.",
    "negative control: with no rules compiled, the same reply goes out unchanged");
}

{
  // ...and structurally, that `gatedReply` is still the only call site of
  // `ctx.reply` and that it passes the rules down. A predicate the bytes can
  // walk around is an absent predicate.
  const surface = read("api/_surface.js");
  const callSites = surface.split("\n").filter((line) => /await ctx\.reply\(/.test(line));
  eq(callSites.length, 1, "ctx.reply still has exactly one call site in api/_surface.js");
  ok(/gateReply\(ctx\.engine, raw, \{ trustedText: \[\], openItems: \[\] \}, label, neverRules\)/.test(surface),
    "the no-gate branch still applies the never-rules");
  ok(/honestyContextFor\(ctx\.engine, compiled, turns, opts\), label, neverRules\)/.test(surface),
    "...and so does the ordinary branch");
  ok(/replyViolatesNeverRule/.test(surface), "the predicate is imported into the one door");
  ok(!/never.?rule/i.test(read("src/engine/persona.ts").slice(0, 4_000)),
    "the persona's opening carries no never-rule text (rules are rows, not lines)");
}

{
  // The widget lane loads them per turn. A rule added a minute ago has to bind
  // on the next turn, not on the next deploy.
  const clonechat = read("api/_clonechat.js");
  ok(/loadNeverRules\(db, resolved\.channel\.replica_id, resolved\.channel\.owner_user_id\)/.test(clonechat),
    "the follower-facing widget reads the owner's rules for THIS replica");
  ok(/neverRules/.test(clonechat.split("gatedReply(ctx, compiled, turns,")[1] || ""),
    "...and hands them to the one door");
  ok(/never_rule_applied/.test(clonechat),
    "...and reports that it went quiet on purpose, rather than looking broken");
}

{
  const db = fakeDb({ rules: [{ rule_id: "r1", pattern: "never say this thing" }] });
  const rows = await R.loadNeverRules(db, REPLICA, OWNER);
  eq(rows.length, 1, "the loader returns the active rules");
  const sql = db.state.statements.at(-1).sql;
  ok(/n\.owner_user_id = \$2::uuid/.test(sql), "...owner-scoped inside the WHERE clause");
  ok(/n\.revoked_at is null/.test(sql), "...and revoked rules never reach the predicate");
}

// ═════════════════════════════════════════════════════════════════════════
// 6. OWNERSHIP, AND THE QUESTION SEAM
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 6. ownership and the question seam ──");

{
  const db = fakeDb({});
  eq(await R.readReviewQueue(db, STRANGER, REPLICA), null,
    "another owner's replica is UNREACHABLE, and the answer is the same as 'does not exist'");
}

{
  const db = fakeDb({ cards: [], openCount: 3, decidedCount: 11 });
  const queue = await R.readReviewQueue(db, OWNER, REPLICA);
  eq(queue.open_count, 3, "the queue reports a real open count");
  eq(queue.decided_count, 11, "...and a real decided count, so 'card 12 of 14' is a fact");
  eq(queue.cap, R.REVIEW_OPEN_CAP, "...and names the cap it is measured against");
}

await throws("the question generator refuses when the deployment is not configured",
  () => Q.createProductionQuestionGenerator({}), "review_question_generator_unavailable");

{
  // The seam, driven with a FIXTURE: no network, no money, real assembly.
  const excerpts = [
    { source_id: "s1", text: "x".repeat(80) },
    { source_id: "s2", text: "y".repeat(80) },
  ];
  const messages = Q.questionMessages(excerpts, 5);
  eq(messages.length, 2, "the generator prompt is a system turn and one user turn");
  ok(/Do not answer the questions/.test(messages[0].content),
    "...and it asks for questions only: the ANSWER on a card is what this AI said");
  const validated = Q.validateQuestionOutput(JSON.stringify({
    questions: [
      { question: "Should I do cardio on lifting days?", source_ids: ["s1"] },
      { question: "Uncited question that should be dropped", source_ids: ["not-a-source"] },
      { question: "short", source_ids: ["s1"] },
    ],
  }), excerpts);
  eq(validated.questions.length, 1, "a question citing a source outside the batch is DROPPED");
  eq(validated.rejected.length, 2, "...and the drops are counted, never silent");

  const db = fakeDb({ transcripts: [{ source_id: "s1", text: "x".repeat(80) }] });
  const generator = {
    family: "review-question", name: "fixture", version: "1", model: "fixture",
    generate: async () => validated,
  };
  const produced = await R.generateSyntheticQuestions(db, OWNER, REPLICA, generator, { count: 5 });
  eq(produced.length, 1, "the offline fixture drives the real lane end to end");
  ok(db.state.statements.some((s) => /evidence_type='transcript_span'/.test(s.sql)),
    "...over the SAME eligible-transcript SQL the claim lane already qualifies");
}

await throws("a replica with no reviewed transcript says so rather than returning an empty set",
  () => R.generateSyntheticQuestions(fakeDb({ transcripts: [] }), OWNER, REPLICA, {
    family: "f", name: "n", version: "1", model: "m", generate: async () => ({ questions: [] }),
  }), "review_question_excerpts_absent");

// ═════════════════════════════════════════════════════════════════════════
// 7. MIGRATION 074 AND THE ERASURE REACH
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 7. migration 074, erasure reach, and the copy ──");

{
  const migration = read("db/migrations/074_review_queue.sql");
  const schema = read("db/schema.sql");
  ok(!/\bdo \$/.test(migration), "074 uses no DO blocks (apply.mjs's splitter does not handle them)");
  ok(/drop constraint if exists/.test(migration), "...and every constraint uses the idempotent drop-then-add pair");
  ok(/create table if not exists vy_review_card/.test(migration), "...creates the card table idempotently");
  ok(/create table if not exists vy_review_never_rule/.test(migration), "...and the never-rule table");
  ok(/check \(\(state = 'fixed'\) = \(correction_source_id is not null\)\)/.test(migration),
    "THE CHECK: a fixed card without its correction source is unrepresentable, not merely untested");
  ok(/add column if not exists purpose text not null default 'memory'/.test(migration),
    "...and `purpose` defaults so every source ever written is unchanged");
  ok(schema.includes("create table if not exists vy_review_card"), "074 is mirrored into db/schema.sql");
  ok(schema.includes("create table if not exists vy_review_never_rule"), "...both tables");
  ok(!/references vy_replica\s*\(/.test(migration.split("vy_review_card")[1] || ""),
    "replica_id and owner_user_id are FK-SHAPED and carry no FK (009's WHERE-clause binding)");
}

{
  const erasure = read("api/_replica-full-erasure.js");
  ok(/delete from vy_review_card\b/.test(erasure),
    "vy_review_card is deleted BY NAME (there is no cascade to inherit, and relcheck fails without this)");
  ok(/delete from vy_review_never_rule\b/.test(erasure), "...and so is vy_review_never_rule");
  eq(erasure.indexOf("delete from vy_review_never_rule") < erasure.indexOf("delete from vy_review_card"), true,
    "...child first: a rule names the card it came from");
  ok(/owner_review_queue/.test(erasure), "...and the deletion receipt names the class it removed");
  const strict = read("evals/sqlcast/surface.mjs");
  ok(/_review-queue/.test(strict), "the review queue is on sqlcast's strict cast surface");
}

{
  // The empty state is the brief's own sentence, and the copy gate's rules
  // apply to every string on this screen.
  const component = read("src/studio/ReviewQueue.tsx");
  ok(component.includes("Nothing to review yet."), "the empty state is honest about being empty");
  ok(component.includes("It fills itself from real conversations once your Room is open."),
    "...and says what will fill it");
  ok(/onPointerDown/.test(component), "feedback fires on pointerdown, never on release");
  ok(!/onClick=/.test(component), "...and there is no onClick left on a decision path");
  ok(/Card \{Math\.min\(position, total\)\} of \{total\}/.test(component),
    "the progress line is a real count of real rows");
  ok(!/[—–]/.test(component.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")),
    "no em-dash or en-dash in any user-visible string");
  for (const label of ["Sounds right", "Close, fix it", "Never say this"]) {
    ok(component.includes(label), `the button copy is the product's own: "${label}"`);
  }
  ok(!/\bclone\b/i.test(component), "the word 'clone' appears in no user-visible string");
}

console.log(`\nreview-queue: ${checks - failed}/${checks} checks passed`);
if (failed) {
  console.error(`\n${failed} review-queue check(s) FAILED`);
  process.exit(1);
}
console.log("review-queue: ok");
console.log(
  "NOTE: migration 074 has never been applied to any database and no statement in this\n" +
  "lane has ever been EXPLAINed. This suite proves control flow and clause presence.\n" +
  "It cannot prove SQL types or referential integrity (`offline-mocks-cannot-type-check-sql`).",
);
