// Readiness — one number, five parts, one action, and the publish lock.
// Vyakti Rooms v1, WS-R3.
//
// ═════════════════════════════════════════════════════════════════════════
// THE LAW THIS FILE IS BUILT AROUND
// ═════════════════════════════════════════════════════════════════════════
//
// DESIGN-LAW §1: no fake numbers. Every part below is EITHER a real
// measurement carrying its own n, its method and its date, OR an honest
// "not measured yet" state naming the one action that would measure it.
//
//   A part with no instrument renders as such. It never renders as 0 and
//   never as a placeholder. The overall is UNDEFINED until every part has a
//   value, and the publish lock stays locked while any part is unmeasured.
//
// That is `plausible-return-hides-a-dead-pipeline` (context/rejected.md, this
// repo's most expensive law) applied to a score: "a stage that returns a
// plausible value on failure is invisible to every check that does not compare
// it to reality". A readiness of 61 assembled out of three real numbers and
// two guesses is exactly that stage, and it would be the most persuasive
// version of it this product could ship, because a creator would act on it.
//
// So the honest output of this module today includes two parts that say NOT
// MEASURED YET, and it says so on the screen, and the lock is therefore closed
// for every replica. That is a true report of where the instruments stand, and
// it is the opposite of a bug. §4 below names each absent writer.
//
// ═════════════════════════════════════════════════════════════════════════
// §1. WHY A REAL NUMBER UNDER A WRONG LABEL IS STILL A FAKE NUMBER
// ═════════════════════════════════════════════════════════════════════════
//
// The tempting v0 for "knows your material" is claims reviewed over claims
// mined. It is a real fraction with a real denominator and it is available
// today. It is also NOT the thing the label names: a creator reading "Knows
// your material 88" understands "it can answer 88% of what I know", and what
// the number would mean is "you have clicked through 88% of the claims we
// proposed". `measured-but-not-felt` is this failure with the polarity
// reversed — there, a measured delta nobody could see; here, a measured
// quantity nobody asked about, wearing the name of the one they did.
//
// Review coverage is therefore rendered as the DETAIL under an unmeasured
// part ("142 claims mined, 18 reviewed"), and the action is the one that
// moves it. The number stays absent until the instrument exists.
//
// ═════════════════════════════════════════════════════════════════════════
// §2. WHY "SOUNDS LIKE YOU" NEEDS THE OWNER'S OWN CEILING
// ═════════════════════════════════════════════════════════════════════════
//
// `ground-truth-ceiling` (context/measurements.md, 2026-08-18): the trusted
// judge agreed with its own archived verdicts 77.1% of the time, so the
// pre-registered 80% bar sat ABOVE the ceiling of its own ground truth. The
// lesson generalises exactly: a similarity score means nothing until you know
// what score the person scores against THEMSELVES.
//
// A cosine of 0.71 is excellent for one speaker and poor for another, because
// speakers differ in how consistent their own recordings are. Expressing it as
// a percent of a CONSTANT — including this repo's own 0.8869, which was
// measured for one owner — would import one person's ceiling into everybody
// else's score. So this part is measured only when BOTH halves exist: a
// standing fidelity row for the live voice AND a self-similarity ceiling
// measured on the same person's own held-out recordings. The screen says which
// half is missing, and it says "71 of your own 100" when both are present, so
// the denominator is never invisible.
//
// ═════════════════════════════════════════════════════════════════════════
// §3. WHY EXACTLY ONE PART IS A CHECKLIST FRACTION
// ═════════════════════════════════════════════════════════════════════════
//
// `activity-is-a-read-not-a-progress-bar` (context/decisions.md, WS-AF): of
// seven asynchronous lanes exactly one may report a real fraction, because a
// status ladder is not a fraction of work — "a two-hour lecture is not half
// done when the row says `transcribed`".
//
// "Knows what not to say" is a fraction and does not break that rule, and the
// difference is worth stating because it is the thing that makes a fraction
// legitimate: its denominator is a FIXED, ENUMERATED SET whose members are
// each independently verifiable at read time, not a ladder of stages. Three
// protections, each a yes or a no, checked one at a time. Nothing about
// finishing the first one predicts the cost of the third, and nothing here
// moves on a schedule. The other four parts are ratios of measured events or
// they are unmeasured; none of them is a ladder either.
//
// ═════════════════════════════════════════════════════════════════════════
// §4. THE INSTRUMENTS, AND THE TWO THAT DO NOT EXIST YET
// ═════════════════════════════════════════════════════════════════════════
//
//   knows_your_material    HAS AN INSTRUMENT NOW (WS-R101, migration 127,
//                          api/_recall-run.js), but it is OWNER-TRIGGERED,
//                          never automatic: a held-out question set built
//                          from the replica's own sources is scored against
//                          the real compiled agent through `gatedReply`, and
//                          production's reply seam costs money per question
//                          (`RECALL_RUN`, off by default,
//                          docs/gurukul/ENV-MANIFEST.md's own section). Until
//                          an owner presses "Measure now" (or the flag is
//                          off), `readRecallRun` below returns null exactly
//                          as it always did, and the part reads "not
//                          measured yet" — an honest state, not a bug.
//
//   sounds_like_you        HALF AN INSTRUMENT. vy_voice_fidelity is live and
//                          real (api/_fidelity.js). The owner's own ceiling is
//                          read from the approved voice genome's
//                          definition.evidence.self_similarity_ceiling and
//                          nothing writes that key yet. See §2.
//
//   thinks_like_you        LIVE. vy_mirror_feedback verdicts, which are the
//                          creator's own "sounds right" / "close, fix it"
//                          taps on their clone's turns. Needs n >= 20.
//
//   knows_what_not_to_say  LIVE. Approved boundary claims are the never-say
//                          rules (api/_person-model.js maps domain='boundary'
//                          into definition.boundaries), the approved person
//                          model is what makes them final, and the teacher
//                          sheet's escalationRoute is where a distressed
//                          person is sent.
//
//   up_to_date             LIVE. Bi-temporal validity on the claim ledger
//                          (vy_replica_claim.t_valid_to, the replica lane's
//                          half of migration 056's event-time pair) plus the
//                          age of the newest source.
//
// The three live parts are why this screen is worth shipping before the other
// two instruments exist: it is the only surface that tells a creator WHICH
// instrument is missing, instead of quietly averaging around it.
//
// ═════════════════════════════════════════════════════════════════════════
// §5. THE SHAPE OF THIS FILE
// ═════════════════════════════════════════════════════════════════════════
//
// `readinessScreen(inputs)` is PURE: rows in, screen model out, no I/O, no
// clock of its own (the caller passes `now`). Every eval in evals/readiness/
// drives it directly. `readOwnedReadiness` is the only thing that touches a
// database, and api/readiness.js is thin over it — api/clone-chat.js over
// api/_clonechat.js, the house pattern, and the reason is that this
// environment has no database, so logic in a handler is logic no eval can run.
import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";
import { replicaId } from "./_replica.js";
import { FIDELITY_POLICY_VERSION } from "./_fidelity.js";

export const READINESS_POLICY_VERSION = "replica-readiness/v1";

/** The floors. Vyakti Rooms v1: publishing is locked below 70 overall or 55
 *  on any part. Data, not literals scattered through the SQL, because the
 *  three gates that consult them (runtime activation, channel connect, this
 *  screen) must not be able to disagree about where the floor is. */
export const READINESS_OVERALL_FLOOR = 70;
export const READINESS_PART_FLOOR = 55;

/** ONE blocker code for every locked shape: never computed, computed and
 *  below the floor, computed with a part still unmeasured. The WS-B loader
 *  precedent that api/_fidelity.js states for FIDELITY_BLOCKER — a caller must
 *  not be able to tell "never measured" from "measured and failed" by probing
 *  the gate, because the difference is the creator's business and the screen
 *  is where they are told it, at length, in words. */
export const READINESS_BLOCKER = "readiness_floor_not_met";

/** Part order is FIXED and it is load-bearing twice: the screen renders left
 *  to right in this order, and the weakest-part tie-break walks it, so the
 *  suggested action is deterministic for a given set of inputs. */
export const READINESS_PARTS = Object.freeze([
  "knows_your_material",
  "sounds_like_you",
  "thinks_like_you",
  "knows_what_not_to_say",
  "up_to_date",
]);

export const PART_LABELS = Object.freeze({
  knows_your_material: "Knows your material",
  sounds_like_you: "Sounds like you",
  thinks_like_you: "Thinks like you",
  knows_what_not_to_say: "Knows what not to say",
  up_to_date: "Up to date",
});

/** The minimum sample each ratio needs before it is a measurement rather than
 *  an anecdote. api/_fidelity.js's `minCandidate` states the same rule for the
 *  voice bench ("a score over one window is an anecdote") and these are its
 *  equivalents. Below the floor the part is UNMEASURED, never a small number
 *  computed from a small sample. */
export const MIN_MIRROR_FEEDBACK = 20;
export const MIN_VALIDITY_CLAIMS = 5;

/** Never-say rules: the count of approved boundary claims that makes the
 *  protection count as configured rather than started. Three is the smallest
 *  number that is a policy rather than an example. */
export const MIN_NEVER_SAY_RULES = 3;

/** A source older than this is stale enough to say so out loud. Not a gate:
 *  it changes the DETAIL sentence and can trigger the suggested action, and it
 *  never silently multiplies the number. */
export const SOURCE_STALE_DAYS = 180;

export class ReadinessError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

function requireUuid(value, code) {
  const text = String(value || "").toLowerCase();
  if (!UUID.test(text)) throw new ReadinessError(code, 400);
  return text;
}

const num = (value, fallback = 0) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
};

const iso = (value) => {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
};

const pct = (numerator, denominator) => {
  if (!(denominator > 0)) return null;
  const value = Math.round((100 * numerator) / denominator);
  return Math.max(0, Math.min(100, value));
};

const days = (from, now) => {
  const at = from ? new Date(from).getTime() : NaN;
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / DAY_MS)) : null;
};

// ─────────────────────────────────────────────────────────────────────────
// THE ACTION TABLE
// ─────────────────────────────────────────────────────────────────────────
//
// FIXED, and every entry points at a control that EXISTS. That is
// `activity-is-a-read-not-a-progress-bar`'s rule about retries, transferred:
// "a one-click retry is offered only where one exists ... a button that called
// nothing would be a fake progress bar with a label on it."
//
// Which is why there is no "Book the interview" here even though it is the
// nicest copy in the spec. There is no scheduler in this product. The
// twenty-minute interview IS the Mirror Call, it exists, it is on the Meet
// step, and the button says so.
export const READINESS_ACTIONS = Object.freeze({
  review_claims: Object.freeze({
    code: "review_claims", label: "Review 20 claims", step: "meet", anchor: "#person-model-studio",
  }),
  add_sources: Object.freeze({
    code: "add_sources", label: "Add sources", step: "feed", anchor: "#context-locker",
  }),
  run_mirror_call: Object.freeze({
    code: "run_mirror_call", label: "Run one Mirror Call", step: "meet", anchor: "#mirror-call",
  }),
  long_mirror_call: Object.freeze({
    code: "long_mirror_call", label: "Run a 20 minute Mirror Call", step: "meet", anchor: "#mirror-call",
  }),
  record_reference: Object.freeze({
    code: "record_reference", label: "Record a matched reference clip", step: "meet", anchor: "#voice-enrollment-lab",
  }),
  add_never_say: Object.freeze({
    code: "add_never_say", label: "Add never say rules", step: "meet", anchor: "#person-model-studio",
  }),
});

const action = (code) => {
  const row = READINESS_ACTIONS[code];
  if (!row) throw new ReadinessError("readiness_action_unknown", 500);
  return row;
};

function part(id, fields) {
  const measured = Number.isFinite(fields.value);
  return Object.freeze({
    id,
    label: PART_LABELS[id],
    value: measured ? fields.value : null,
    measured,
    // n and method travel WITH the number, always. context/measurements.md's
    // house rule: a number without n, method and date cannot be compared
    // against a future one, which is the only thing numbers are for.
    n: Number.isFinite(fields.n) ? fields.n : null,
    method: fields.method,
    measured_at: fields.measured_at || null,
    detail: fields.detail,
    reason: measured ? null : fields.reason,
    action: fields.action || null,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// THE FIVE PARTS
// ─────────────────────────────────────────────────────────────────────────

function knowsYourMaterial(input, _now) {
  const claims = input.claims || {};
  const mined = num(claims.mined);
  const reviewed = num(claims.reviewed);
  const recall = input.recall || null;

  // The measured path (WS-R101, `api/_recall-run.js`). `recall` is
  // `readRecallRun`'s own shape: `{score, n, method, computed_at}`, the
  // latest unsuperseded `vy_recall_run` row (migration 127). `score` is
  // already a 0-100 integer over `n` held-out questions built from the
  // replica's own sources and scored against the real compiled agent — it is
  // used directly, never re-derived from a correct/total pair, because the
  // stored row IS the measurement rather than raw counts this function would
  // have to re-aggregate.
  if (recall && Number.isFinite(Number(recall.score)) && num(recall.n) > 0) {
    const n = num(recall.n);
    const value = Math.max(0, Math.min(100, Math.round(Number(recall.score))));
    return part("knows_your_material", {
      value,
      n,
      // "measured on N questions from your own material", never a bare
      // number — this file's own header names that rule.
      method: `Held-out recall run: measured on ${n} questions from your own material.`,
      measured_at: iso(recall.computed_at),
      detail: `${mined} claims mined from what you gave us, ${reviewed} reviewed by you.`,
      action: value < READINESS_PART_FLOOR ? action("add_sources") : null,
    });
  }

  // The honest path, which is where every replica sits today. §1 above is why
  // the review counts are the DETAIL and not the number.
  return part("knows_your_material", {
    value: null,
    n: mined || null,
    method: "A held-out recall run over questions built from your own sources. No run has been scored yet.",
    measured_at: null,
    detail: mined
      ? `${mined} claims mined from what you gave us, ${reviewed} reviewed by you. Reviewing them is what a recall run is scored against.`
      : "Nothing has been mined yet, so there is nothing to ask your AI about.",
    reason: mined ? "no_recall_run" : "no_claims_mined",
    action: mined ? action("review_claims") : action("add_sources"),
  });
}

function soundsLikeYou(input, _now) {
  const fidelity = input.fidelity || null;
  const ceiling = input.owner_ceiling || null;
  const mean = fidelity ? num(fidelity.mean, NaN) : NaN;
  const ceilingValue = ceiling ? num(ceiling.value, NaN) : NaN;
  const windows = fidelity ? num(fidelity.windows) : 0;

  if (!fidelity || !Number.isFinite(mean)) {
    return part("sounds_like_you", {
      value: null,
      n: null,
      method: "Speaker similarity against your own recordings, as a share of your own ceiling.",
      measured_at: null,
      detail: "Your voice has not been measured against your own recordings yet.",
      reason: "no_fidelity_row",
      action: action("record_reference"),
    });
  }

  // §2. A similarity score with no ceiling to divide by is a number we have
  // and cannot interpret. Saying the number and refusing to score it is the
  // honest shape, and it is exactly what `ground-truth-ceiling` asks for.
  if (!Number.isFinite(ceilingValue) || ceilingValue <= 0) {
    return part("sounds_like_you", {
      value: null,
      n: windows || null,
      method: "Speaker similarity against your own recordings, as a share of your own ceiling.",
      measured_at: iso(fidelity.computed_at),
      detail: `Similarity ${mean.toFixed(3)} over ${windows} windows. Your own ceiling has not been measured, so there is nothing to compare it against yet.`,
      reason: "no_owner_ceiling",
      action: action("record_reference"),
    });
  }

  const value = Math.max(0, Math.min(100, Math.round((100 * mean) / ceilingValue)));
  return part("sounds_like_you", {
    value,
    n: windows || null,
    method: `Speaker similarity ${mean.toFixed(3)} over your own ceiling ${ceilingValue.toFixed(4)}.`,
    measured_at: iso(fidelity.computed_at),
    detail: `${value} of your own 100. Measured over ${windows} windows of your live voice.`,
    action: value < READINESS_PART_FLOOR ? action("record_reference") : null,
  });
}

function thinksLikeYou(input, _now) {
  const mirror = input.mirror || {};
  const soundsRight = num(mirror.sounds_right);
  const fixIt = num(mirror.fix_it);
  const total = soundsRight + fixIt;

  if (total < MIN_MIRROR_FEEDBACK) {
    return part("thinks_like_you", {
      value: null,
      n: total || null,
      method: `Your own sounds-right and fix-it taps on Mirror Call turns. Needs ${MIN_MIRROR_FEEDBACK}.`,
      measured_at: iso(mirror.latest_at),
      detail: total
        ? `${total} of ${MIN_MIRROR_FEEDBACK} corrections so far. One more Mirror Call gets there.`
        : "You have not corrected your AI on a call yet.",
      reason: "too_few_corrections",
      action: action("run_mirror_call"),
    });
  }

  const value = pct(soundsRight, total);
  return part("thinks_like_you", {
    value,
    n: total,
    method: `${soundsRight} sounds-right against ${fixIt} fix-it over your last ${total} corrections.`,
    measured_at: iso(mirror.latest_at),
    detail: `You kept ${soundsRight} of the last ${total} turns and corrected ${fixIt}.`,
    action: value < READINESS_PART_FLOOR ? action("long_mirror_call") : null,
  });
}

function knowsWhatNotToSay(input, _now) {
  const safety = input.safety || {};
  const rules = num(safety.never_say_rules);
  const approved = Boolean(safety.person_model_approved);
  const escalation = Boolean(safety.escalation_route);

  // §3. Three protections, each independently verifiable, checked one at a
  // time. Not a ladder: nothing here predicts the cost of the next one.
  const protections = [
    { code: "person_model_approved", ok: approved },
    { code: "never_say_rules", ok: rules >= MIN_NEVER_SAY_RULES },
    { code: "escalation_route", ok: escalation },
  ];
  const satisfied = protections.filter((row) => row.ok).length;
  const value = pct(satisfied, protections.length);
  const missing = protections.find((row) => !row.ok);

  return part("knows_what_not_to_say", {
    value,
    n: protections.length,
    method: `${satisfied} of ${protections.length} protections you configure are in place. The crisis helplines and the spoken AI disclosure are always on and are not counted here.`,
    measured_at: iso(safety.person_model_approved_at),
    detail: rules
      ? `${rules} never say rules you have approved.`
      : "No never say rules yet. These are the lines your AI refuses to cross.",
    action: missing
      ? (missing.code === "never_say_rules" || missing.code === "escalation_route"
        ? action("add_never_say")
        : action("review_claims"))
      : null,
  });
}

function upToDate(input, now) {
  const freshness = input.freshness || {};
  const total = num(freshness.claims_total);
  const valid = num(freshness.claims_valid);
  const newestAge = days(freshness.newest_source_at, now);
  const sourceLine = newestAge === null
    ? "No source has landed yet."
    : newestAge > SOURCE_STALE_DAYS
      ? `Your newest source is ${newestAge} days old, so anything since then is missing.`
      : `Your newest source is ${newestAge} days old.`;

  if (total < MIN_VALIDITY_CLAIMS) {
    return part("up_to_date", {
      value: null,
      n: total || null,
      method: `Share of your approved claims whose validity has not expired. Needs ${MIN_VALIDITY_CLAIMS} approved claims.`,
      measured_at: null,
      detail: `${total} approved claims. ${sourceLine}`,
      reason: "too_few_claims",
      action: action("add_sources"),
    });
  }

  const value = pct(valid, total);
  const stale = newestAge !== null && newestAge > SOURCE_STALE_DAYS;
  return part("up_to_date", {
    value,
    n: total,
    method: `${valid} of ${total} approved claims are still inside their validity window.`,
    measured_at: iso(freshness.newest_source_at),
    detail: `${total - valid} of ${total} claims have passed their date. ${sourceLine}`,
    action: value < READINESS_PART_FLOOR || stale ? action("add_sources") : null,
  });
}

const PART_BUILDERS = Object.freeze({
  knows_your_material: knowsYourMaterial,
  sounds_like_you: soundsLikeYou,
  thinks_like_you: thinksLikeYou,
  knows_what_not_to_say: knowsWhatNotToSay,
  up_to_date: upToDate,
});

// ─────────────────────────────────────────────────────────────────────────
// THE SCREEN MODEL
// ─────────────────────────────────────────────────────────────────────────

/**
 * readinessScreen(inputs) — rows in, the whole screen out. PURE.
 *
 * `inputs.now` is the clock and it is an argument, never `Date.now()` read
 * inside a part builder: a fixture that cannot pin the clock cannot assert on
 * an age, and every "days old" sentence here is an age.
 */
export function readinessScreen(inputs = {}) {
  const now = Number.isFinite(Number(inputs.now)) ? Number(inputs.now) : Date.now();
  const parts = READINESS_PARTS.map((id) => PART_BUILDERS[id](inputs, now));
  const unmeasured = parts.filter((row) => !row.measured);
  const measured = parts.filter((row) => row.measured);

  // THE UNDEFINED OVERALL. Not zero, not a partial mean over the parts that
  // happen to have numbers. A mean over three of five parts is a number whose
  // denominator changes when an instrument lands, so a clone would appear to
  // get worse on the day it was measured better.
  const overall = unmeasured.length === 0
    ? Math.round(measured.reduce((sum, row) => sum + row.value, 0) / measured.length)
    : null;
  const minPart = unmeasured.length === 0
    ? measured.reduce((low, row) => Math.min(low, row.value), 100)
    : null;

  const blockers = [];
  for (const row of unmeasured) blockers.push({ part: row.id, code: "not_measured_yet" });
  for (const row of measured) {
    if (row.value < READINESS_PART_FLOOR) blockers.push({ part: row.id, code: "below_part_floor" });
  }
  if (overall !== null && overall < READINESS_OVERALL_FLOOR) {
    blockers.push({ part: null, code: "below_overall_floor" });
  }

  // THE WEAKEST PART. Deterministic by construction: unmeasured parts come
  // first in READINESS_PARTS order (an absent instrument is weaker than any
  // number, because a number can at least be acted on), then the lowest
  // measured value, ties broken by the same fixed order.
  const weakest = unmeasured.length
    ? unmeasured[0]
    : measured.reduce((low, row) => (row.value < low.value ? row : low), measured[0]);

  const locked = blockers.length > 0;
  return Object.freeze({
    policy_version: READINESS_POLICY_VERSION,
    computed_at: new Date(now).toISOString(),
    overall,
    min_part: minPart,
    unmeasured_count: unmeasured.length,
    parts,
    floors: Object.freeze({ overall: READINESS_OVERALL_FLOOR, part: READINESS_PART_FLOOR }),
    // The lock is reported here so a screen can render it; it is ENFORCED by
    // the SQL predicates in api/_replica-runtime.js and api/_clonechannel.js.
    // This boolean is a picture of the gate, never the gate itself.
    publish_locked: locked,
    blockers: Object.freeze(blockers),
    weakest_part: weakest ? weakest.id : null,
    suggested_action: weakest && weakest.action ? weakest.action : null,
  });
}

/** Every number the screen was computed from, hashed. Two computes with the
 *  same hash describe the same clone, so the writer skips the second and the
 *  history stays a record of changes rather than of polls. */
export function readinessInputsHash(inputs = {}) {
  return sha256Hex(canonicalJson({
    policy: READINESS_POLICY_VERSION,
    claims: inputs.claims || null,
    recall: inputs.recall || null,
    fidelity: inputs.fidelity || null,
    owner_ceiling: inputs.owner_ceiling || null,
    mirror: inputs.mirror || null,
    safety: inputs.safety || null,
    freshness: inputs.freshness || null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// THE READS
// ─────────────────────────────────────────────────────────────────────────

const RECALL_RUN_SQL = `select r.score, r.n, r.method, r.created_at
  from vy_recall_run r
 where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.superseded_at is null
 order by r.created_at desc limit 1`;

/** THE SEAM §4 named, now wired (WS-R101, migration 127, `api/_recall-run.js`).
 *  Reads the latest unsuperseded `vy_recall_run` row and returns
 *  `{score, n, method, computed_at}`, or null when no run has ever been
 *  scored for this replica — the honest state every replica was in before
 *  this workstream, and the state any replica remains in until its owner
 *  presses "Measure now" (or `RECALL_RUN` is off, in which case the op that
 *  would write this row refuses before it ever runs). A function rather
 *  than an inline query so this stays the ONE place `knowsYourMaterial`
 *  reads from, exactly as it was when it always returned null. */
export async function readRecallRun(db, ownerUserId, rid) {
  if (typeof db !== "function") return null;
  const rows = await db(RECALL_RUN_SQL, [rid, ownerUserId]);
  const row = rows[0];
  if (!row) return null;
  return {
    score: Number(row.score),
    n: Number(row.n),
    method: String(row.method || ""),
    computed_at: row.created_at,
  };
}

const CLAIM_LEDGER_SQL = `select
  count(*) filter (where c.status in ('proposed','approved'))::int as mined,
  count(*) filter (where c.status in ('approved','rejected','superseded'))::int as reviewed,
  count(*) filter (where c.status='approved')::int as approved,
  count(*) filter (where c.status='approved' and c.domain='boundary')::int as never_say_rules,
  count(*) filter (where c.status='approved'
                     and (c.t_valid_to is null or c.t_valid_to > now()))::int as claims_valid
  from vy_replica_claim c
 where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid`;

const FIDELITY_SQL = `select f.score,f.status,f.computed_at
  from vy_voice_fidelity f
 where f.replica_id=$1::uuid and f.owner_user_id=$2::uuid
   and f.policy_version=$3 and f.superseded_at is null
 order by f.computed_at desc limit 1`;

// The owner's own ceiling, read off the approved voice genome's evidence.
// A key rather than a column because it is EVIDENCE about a recording set,
// which is what `definition` already holds ("distributions and accepted
// private source ids", migration 015). Nothing writes it yet; §2 and §4.
const CEILING_SQL = `select
    (g.definition->'evidence'->>'self_similarity_ceiling') as ceiling,
    (g.definition->'evidence'->>'self_similarity_windows') as windows,
    g.created_at as measured_at
  from vy_replica_voice_genome g
 where g.replica_id=$1::uuid and g.status='approved'
 order by g.version desc limit 1`;

// The creator's own taps. `verdict='up'` is "sounds right"; 'down' and
// 'rephrase' are both "close, fix it" — a rephrase IS a correction, and
// counting it as neutral would inflate the number in exactly the direction
// that flatters the product.
const MIRROR_SQL = `select
    count(*) filter (where m.verdict='up')::int as sounds_right,
    count(*) filter (where m.verdict in ('down','rephrase'))::int as fix_it,
    max(m.created_at) as latest_at
  from vy_mirror_feedback m
 where m.replica_id=$1::uuid and m.owner_user_id=$2::uuid`;

const SAFETY_SQL = `select
    (select max(p.created_at) from vy_replica_profile p
      where p.replica_id=r.replica_id and p.status='approved') as person_model_approved_at,
    exists(select 1 from vy_replica_profile p
            where p.replica_id=r.replica_id and p.status='approved') as person_model_approved,
    exists(select 1 from vy_teacher_sheet s
            where s.agent_id=r.agent_id and s.status in ('validated','published')
              and coalesce(s.sheet->>'escalationRoute','') <> '') as escalation_route
  from vy_replica r
 where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
 limit 1`;

// Freshness reads BOTH intake lanes, because a creator who only ever pasted
// links has no vy_replica_source row and their newest material is not older
// than the platform. Reading one lane would have reported "no source yet" to a
// person whose locker was full.
const FRESHNESS_SQL = `select greatest(
    coalesce((select max(s.created_at) from vy_replica_source s
               where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid
                 and s.state in ('uploaded','processing','ready')), 'epoch'::timestamptz),
    coalesce((select max(i.created_at) from vy_context_item i
               where i.replica_id=$1::uuid and i.owner_user_id=$2::uuid
                 and i.status in ('received','extracted','mined','routed')), 'epoch'::timestamptz)
  ) as newest_source_at`;

/**
 * Gather every input for one owner's one replica. Six small reads rather than
 * one twenty-CTE statement, on purpose: each one is separately EXPLAIN-able
 * against the live database, and `offline-mocks-cannot-type-check-sql` is why
 * that matters more than the round trip.
 */
export async function readReadinessInputs(db, ownerUserId, id, options = {}) {
  const owner = requireUuid(ownerUserId, "owner_required");
  const rid = requireUuid(replicaId(id), "replica_id_required");
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();

  const owned = await db(
    `select r.replica_id from vy_replica r
      where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.lifecycle <> 'purging'
      limit 1`,
    [rid, owner],
  );
  if (!owned[0]) return null;

  const [ledger, fidelity, ceiling, mirror, safety, freshness, recall] = await Promise.all([
    db(CLAIM_LEDGER_SQL, [rid, owner]),
    db(FIDELITY_SQL, [rid, owner, FIDELITY_POLICY_VERSION]),
    db(CEILING_SQL, [rid]),
    db(MIRROR_SQL, [rid, owner]),
    db(SAFETY_SQL, [rid, owner]),
    db(FRESHNESS_SQL, [rid, owner]),
    readRecallRun(db, owner, rid),
  ]);

  const ledgerRow = ledger[0] || {};
  const fidelityRow = fidelity[0] || null;
  const score = fidelityRow
    ? (typeof fidelityRow.score === "string" ? JSON.parse(fidelityRow.score) : fidelityRow.score || {})
    : null;
  const ceilingRow = ceiling[0] || null;
  const ceilingValue = ceilingRow ? Number(ceilingRow.ceiling) : NaN;
  const mirrorRow = mirror[0] || {};
  const safetyRow = safety[0] || {};
  const newest = freshness[0]?.newest_source_at || null;
  // 'epoch' is the greatest() sentinel for "neither lane has a row". It has to
  // become null before it reaches a part, or the screen would report a source
  // that landed in 1970 rather than no source at all — a plausible return
  // hiding an empty locker.
  const newestSourceAt = newest && new Date(newest).getTime() > 0 ? iso(newest) : null;

  return {
    now,
    replica_id: rid,
    claims: {
      mined: num(ledgerRow.mined),
      reviewed: num(ledgerRow.reviewed),
      approved: num(ledgerRow.approved),
    },
    recall,
    fidelity: score && Number.isFinite(Number(score.mean))
      ? { mean: Number(score.mean), windows: num(score.windows), status: fidelityRow.status, computed_at: iso(fidelityRow.computed_at) }
      : null,
    owner_ceiling: Number.isFinite(ceilingValue) && ceilingValue > 0
      ? { value: ceilingValue, n: num(ceilingRow.windows) || null, measured_at: iso(ceilingRow.measured_at) }
      : null,
    mirror: {
      sounds_right: num(mirrorRow.sounds_right),
      fix_it: num(mirrorRow.fix_it),
      latest_at: iso(mirrorRow.latest_at),
    },
    safety: {
      never_say_rules: num(ledgerRow.never_say_rules),
      person_model_approved: safetyRow.person_model_approved === true || safetyRow.person_model_approved === "true",
      person_model_approved_at: iso(safetyRow.person_model_approved_at),
      escalation_route: safetyRow.escalation_route === true || safetyRow.escalation_route === "true",
    },
    freshness: {
      claims_total: num(ledgerRow.approved),
      claims_valid: num(ledgerRow.claims_valid),
      newest_source_at: newestSourceAt,
    },
  };
}

/** Write the snapshot, unless the newest one already describes this clone.
 *  One statement, so it cannot half-apply (009's law), and the guard is INSIDE
 *  the statement rather than a read-then-write in JS, where two polls arriving
 *  together would both see no match and both insert. */
export async function snapshotReadiness(db, ownerUserId, rid, screen, inputsHash) {
  const rows = await db(
    `insert into vy_replica_readiness
       (replica_id,owner_user_id,policy_version,overall,min_part,unmeasured_count,
        parts,blockers,suggested_action,inputs_hash)
     select $1::uuid,$2::uuid,$3,$4::int4,$5::int4,$6::int4,$7::jsonb,$8::jsonb,$9::jsonb,$10
      where not exists (
        select 1 from vy_replica_readiness x
         where x.replica_id=$1::uuid and x.owner_user_id=$2::uuid
           and x.computed_at=(select max(y.computed_at) from vy_replica_readiness y
                               where y.replica_id=$1::uuid and y.owner_user_id=$2::uuid)
           and x.inputs_hash=$10
      )
     returning readiness_id,computed_at`,
    [
      rid, ownerUserId, READINESS_POLICY_VERSION,
      screen.overall, screen.min_part, screen.unmeasured_count,
      JSON.stringify(Object.fromEntries(screen.parts.map((row) => [row.id, {
        value: row.value, measured: row.measured, n: row.n,
        method: row.method, measured_at: row.measured_at, reason: row.reason,
      }]))),
      JSON.stringify(screen.blockers),
      JSON.stringify(screen.suggested_action || {}),
      inputsHash,
    ],
  );
  return rows[0] || null;
}

/**
 * The endpoint's whole job: gather, compute, snapshot, return.
 *
 * The snapshot write is not optional and it is not deferred. The publish lock
 * is a SQL predicate on the LATEST snapshot, so a screen that renders a fresh
 * computation without storing it would show a creator a passing score while
 * the gate still read a stale failing row. The screen and the lock have to be
 * looking at the same row.
 */
export async function readOwnedReadiness(db, ownerUserId, id, options = {}) {
  const inputs = await readReadinessInputs(db, ownerUserId, id, options);
  if (!inputs) return null;
  const screen = readinessScreen(inputs);
  const hash = readinessInputsHash(inputs);
  if (options.snapshot !== false) {
    await snapshotReadiness(db, requireUuid(ownerUserId, "owner_required"), inputs.replica_id, screen, hash);
  }
  return { ...screen, inputs_hash: hash };
}
