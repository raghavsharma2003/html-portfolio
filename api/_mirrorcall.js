// The Mirror Call's pure half — validation, the incremental delta mine, the
// reference-growth arithmetic and the chip-stream honesty report. WS-X.
//
// Contract: docs/gurukul/MIRROR-CALL-SPEC.md.
//
// NOTHING HERE REACHES THE NETWORK OR THE DATABASE. Same split as
// api/_asr/contracts.js and api/_fidelity.js, and for the same two reasons: the
// mine is then testable offline against fixtures with no credentials, and the
// one module that decides what may be written onto a real person's clone has no
// I/O in it to hide a decision behind.
//
// ═════════════════════════════════════════════════════════════════════════
// WHY ONLY TWO SHEET FIELDS ARE WRITABLE, AND THE REST ARE ADVISORY
// ═════════════════════════════════════════════════════════════════════════
//
// `transcriptStats` measures six things off a transcript. Only two of them have
// a TeacherSheet field whose type is a list of measured fragments:
// `boardVerbalisms` (readonly string[]) and `exSlangRepeat` (a parenthesised
// short list). Every other ING field the mine touches — `voiceFillers`,
// `voiceLaughter`, `voiceStretch`, `voiceLanguageBalance` — is a STRING: a
// register BULLET, written as prose, that lands in a compiled prompt and is
// said aloud by a clone of a named living person.
//
// `sheetDraft.ts` already refuses to write those and names the refusal
// `measured-needs-canonical-bullet`: "The measurement is in `measurements`; the
// sentence is not this module's to write." A Mirror Call that rendered a
// measured filler ratio into a prose bullet, mid-call, on a tap, would be doing
// exactly what CLAUDE.md's first hard-won rule forbids — anything
// sentence-shaped in a prompt gets recited — and it would be doing it under
// time pressure with no editor.
//
// So the mine proposes those signals as ADVISORY chips: they carry the number,
// they are accept/rejectable so the owner's judgement is recorded, and
// accepting one writes NO sheet field. `target_field = ''` is that fact, and
// migration 058's CHECK makes it structural.
//
// Reversal condition, stated because a decision without one is dogma: the day a
// canonical-bullet renderer exists with a human confirming the SENTENCE (not
// the number), the advisory kinds get target fields and this comment is the
// record of what changed.
//
// ═════════════════════════════════════════════════════════════════════════
// WHY THE MINE IS INCREMENTAL AND CITED
// ═════════════════════════════════════════════════════════════════════════
//
// The statistical pass is re-run over the WHOLE rolling transcript on every
// window, because a catchphrase is a frequency and a frequency computed over
// one window is not one. What is incremental is the PROPOSAL: a fragment that
// already has a chip in this session refreshes that chip's evidence and does not
// spawn a second one, and a fragment whose chip the owner already rejected is
// never re-proposed. The store's
// `on conflict ... where state in ('proposed','deferred')` clause is where that
// becomes true of the data rather than of this function.
//
// Citations are recomputed each time from the windows themselves rather than
// accumulated, so a citation list can never name a window whose transcript was
// later superseded — and so the count and the citation cannot disagree.
import {
  transcriptStats,
  tokenize,
  countFragment,
  PHRASE_BANK_MAX_WORDS,
} from "./_engine.gen.js";

// ═════════════════════════════════════════════════════════════════════════
// WHY THE VOICE LOOP SELECTS RATHER THAN ACCUMULATES (WS-Z, delta A1)
// ═════════════════════════════════════════════════════════════════════════
//
// `mirror-learning-is-selection-not-accumulation` (context/decisions.md,
// 2026-08-26; sweep at docs/gurukul/research/mirror-learning.md §1.1). The
// finding is a code read, not a paper: Chatterbox's `prepare_conditionals()`
// slices the reference twice before the model sees it — `DEC_COND_LEN =
// 10 * S3GEN_SR` (10 s for the S3Gen conditioning) and `ENC_COND_LEN =
// 6 * S3_SR` (6 s for the T3 speech-prompt tokens) — and `generate()` takes
// exactly one `audio_prompt_path`. There is no multi-reference input.
//
// So "call audio accumulates into the reference set and the next turn
// synthesises off the enriched reference" is mechanically inert under the model
// we ship: turn 40 conditions on at most ten seconds, exactly as turn 2 did.
// Our own point sits where that predicts — ECAPA 0.7753 at 71 s of reference
// against a 0.8869 self-vs-self ceiling, and 71 s is already seven times the
// truncation window, so the residual gap is not a duration deficit and no
// amount of call audio closes it.
//
// This module therefore mines a CANDIDATE POOL and runs a SELECTION over it.
// `bestConditioningCandidate` is the whole voice loop: the clone's voice
// changes when a better ten seconds is chosen, and at no other moment.

/** S3Gen's conditioning slice. Ten seconds is not a tuning knob — it is the
 *  constant the shipped model truncates at, and a candidate longer than this
 *  contributes exactly nothing past it. */
export const CONDITIONING_S3GEN_MS = 10_000;
/** The T3 speech-prompt slice. A candidate shorter than this gives the token
 *  side of the model less than it asks for, so it is the floor a candidate
 *  must clear to be selectable at all. */
export const CONDITIONING_T3_MS = 6_000;

export const MIRROR_SESSION_STATES = Object.freeze(["open", "ended", "aborted"]);
export const MIRROR_WINDOW_STATES = Object.freeze(["pending", "transcribed", "dropped"]);
/** 'proposed' is on the live rail, 'deferred' is what the per-minute chip
 *  budget held back for the review queue, and both are UN-ACTIONED. The
 *  never-silent-update law is stated over that PAIR, not over 'proposed'
 *  alone: a chip the budget deferred is still one the owner has not decided,
 *  and it is still undecidable-into-the-sheet without a tap. */
export const MIRROR_DELTA_STATES = Object.freeze(["proposed", "deferred", "accepted", "rejected"]);

/** Sarvam's synchronous endpoint refuses audio over 30 s and says so ("Please
 *  use the batch API for longer audio files", measured 2026-08-26,
 *  context/STATE.md). The batch lane took 137 s on a 71 s file, which cannot
 *  serve a chip stream inside a live call — so a longer window is REFUSED at
 *  the door rather than silently routed to a lane that answers after the call
 *  has ended. Migration 058 states the same number as a CHECK. */
export const MIRROR_WINDOW_MAX_MS = 30_000;
export const MIRROR_WINDOW_MIN_MS = 250;

/** The diarization label the owner's own turns carry inside a Mirror Call.
 *  There is exactly one speaker in the mined half by construction — the owner,
 *  on their own authenticated session — so the label is fixed rather than
 *  chosen, and `transcriptStats` is given it explicitly. Letting it fall back
 *  to "the most talkative speaker" would silently measure the CLONE's turns if
 *  a caller ever mixed them in. */
export const MIRROR_OWNER_SPEAKER = "OWNER";

/** ECAPA cosine floor for "this window is the owner speaking" (WS-Z A3).
 *
 *  Deliberately BELOW the fidelity policy's activation floor and above nothing
 *  measured on a different speaker: this answers "is this the same person",
 *  not "is this clone good enough to ship". It is PROVISIONAL in exactly the
 *  sense `api/_fidelity.js` says its own thresholds are — shaped from the
 *  published same-speaker ECAPA range, not from any measurement of our own
 *  call audio. What replaces it is a different-speaker control set on real
 *  Mirror Call windows. Until then a window that cannot be measured at all is
 *  'unverified' and is REFUSED, which is the direction that cannot be wrong. */
export const MIRROR_OWNER_SIMILARITY_FLOOR = 0.62;

/** The scope that must be live for call audio to join the candidate pool.
 *
 *  `training` is a VERIFIED_MODEL_SCOPE (api/_replica-consent.js): it cannot be
 *  granted by account attestation, only through the live biometric challenge.
 *  So today, for every replica in existence, this evaluates false and reference
 *  growth is WITHHELD — and that is the honest state, printed on every window,
 *  not a pipeline quietly doing nothing. `plausible-return-hides-a-dead-
 *  pipeline` is the rejection this constant exists to not repeat. */
export const MIRROR_REFERENCE_SCOPE = "training";

/** The scopes a Mirror Call needs merely to run: capture the owner's audio,
 *  store the window, transcribe it. All three are account-attestable, so a
 *  Mirror Call is runnable today and only its voice loop is gated. */
export const MIRROR_SESSION_SCOPES = Object.freeze(["capture", "storage", "transcription"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class MirrorCallError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.name = "MirrorCallError";
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

function fail(code, status = 400, details) {
  throw new MirrorCallError(code, status, details);
}

export function mirrorUuid(value, code) {
  const id = String(value || "").trim();
  if (!UUID.test(id)) fail(code, 400);
  return id;
}

/** Control characters and prompt-fence tags stripped at the seam, the same
 *  fence api/_asr/contracts.js puts on transcript text and for the same
 *  reason: everything in this module ends up adjacent to a prompt, and a fence
 *  applied by every caller is a fence one caller will forget. */
export function mirrorClean(value, max = 4000) {
  return Array.from(String(value ?? ""))
    .filter((character) => {
      const code = character.codePointAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .replace(/<\/?(?:system|assistant|developer|tool)[^>]*>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * PII SCRUB, applied before a transcript is STORED — not before it is
 * rendered, and not before it is mined. (WS-Z A4.)
 *
 * WeClone's genuinely stealable stage, in shape if not in library: Presidio
 * auto-filters phone numbers, emails, credit cards and IPs before anything
 * built from a chat log is written. A Mirror Call mines a LIVE transcript, so
 * an account number or an address said aloud would otherwise reach a text
 * column, then an n-gram count, then a chip, then a prompt — and a phrase-bank
 * fragment is spoken out loud by a clone of a real named person.
 *
 * Two things this deliberately is NOT:
 *
 *  - It is NOT a guarantee. WeClone's own README says detection "cannot
 *    guarantee 100% identification", and this is a regex pass over romanised
 *    Hinglish, which is weaker still. It is a floor. Saying so here is the
 *    difference between a floor and a claim.
 *  - It does NOT split a token, and it never grows the text. A single-token
 *    match (an email, a bare 10-digit number) becomes exactly one token, so
 *    the per-1000 ratios computed over the same text are unchanged. A GROUPED
 *    match — "4111 1111 1111 1111" — collapses four tokens into one, so a
 *    scrubbed card number under-counts the corpus by three tokens. That is a
 *    real and bounded distortion and it is stated rather than papered over:
 *    against a corpus measured in thousands of words it moves a per-1000 ratio
 *    in the third decimal, and it can only ever REMOVE tokens the mine had no
 *    business counting as habits anyway.
 *
 * The scrub runs at the SEAM (once, at store time), not at each call site —
 * a scrub every caller has to remember is a scrub one caller will forget.
 */
export const PII_TOKEN = "redacted";

const PII_PATTERNS = Object.freeze([
  // email
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
  // credit-card-shaped: 13-19 digits, optionally grouped
  /\b(?:\d[ -]?){13,19}\b/g,
  // Indian mobile / international, with or without country code
  /\b(?:\+?\d{1,3}[ -]?)?\d{10}\b/g,
  // IPv4
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  // any remaining run of 6+ digits: account numbers, Aadhaar fragments, OTPs
  /\b\d{6,}\b/g,
]);

export function scrubPii(text) {
  let out = String(text ?? "");
  for (const pattern of PII_PATTERNS) out = out.replace(pattern, PII_TOKEN);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// conditioning: the score, and the selection over it
// ─────────────────────────────────────────────────────────────────────────

/**
 * Score one candidate window for CONDITIONING quality, from a real DSP probe
 * of the real bytes.
 *
 * The inputs are `api/_audio/wav.js::probeEnrollmentWav`'s outputs — rms, peak,
 * activeRatio, clippedRatio — measured over the audio that is actually stored.
 * Nothing here is supplied by a client, and nothing here is a model: a
 * client-supplied score would be a number the server did not measure, and
 * `first-real-clone`'s first rule is that nothing is fabricated.
 *
 * WHAT IT IS NOT: it is not speaker similarity and it is not perceptual
 * quality. It ranks candidates by how much clean, loud-enough, unclipped
 * SPEECH a ten-second slice would contain — which is the property the S3Gen
 * conditioning slice is sensitive to and the one a bad ten seconds fails on.
 * `score_source = 'wav_probe'` records that on every row, so the day a
 * voice-evidence-derived scorer lands its numbers are recognisably a different
 * scale rather than silently comparable.
 *
 * Returns `null` when the window cannot be conditioned on at all (shorter than
 * the T3 slice), which is a refusal to rank rather than a low rank.
 */
export function conditioningScore(probe, durationMs) {
  const ms = Number(durationMs ?? probe?.durationMs ?? 0);
  if (!Number.isFinite(ms) || ms < CONDITIONING_T3_MS) return null;
  const active = Math.max(0, Math.min(1, Number(probe?.activeRatio ?? 0)));
  const rms = Math.max(0, Math.min(1, Number(probe?.rms ?? 0)));
  const clipped = Math.max(0, Math.min(1, Number(probe?.clippedRatio ?? 0)));
  // Voiced fraction is the dominant term: ten seconds that is half silence is
  // five seconds of conditioning wearing a longer duration.
  // Level is a plateau, not a ramp — an rms of 0.12 and an rms of 0.30 both
  // condition fine, and rewarding the louder one would select for shouting.
  const level = Math.min(1, rms / 0.08);
  const penalty = Math.min(1, clipped * 20);
  const score = active * 0.6 + level * 0.4 - penalty * 0.5;
  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

/** How much of a window can ever condition S3Gen. */
export function conditioningMs(durationMs) {
  return Math.max(0, Math.min(CONDITIONING_S3GEN_MS, Number(durationMs) || 0));
}

/**
 * THE VOICE LOOP.
 *
 * Pick the best scored, admitted candidate. Ties break on the LONGER
 * conditioning slice and then on the newer window — deterministic, because an
 * intermittent selection is a clone whose voice changes for no reason.
 *
 * Returns `null` when nothing is selectable, and the caller reports why. Today
 * that is the normal answer: admission needs `owner_verified`, which needs an
 * ECAPA measurement against an enrolled voice profile, which needs biometric
 * consent nobody has granted.
 */
export function bestConditioningCandidate(windows) {
  const eligible = (Array.isArray(windows) ? windows : []).filter((w) =>
    (w?.reference_admitted ?? w?.referenceAdmitted) &&
    w?.quality_score !== null && w?.quality_score !== undefined &&
    Number(w?.conditioning_ms ?? 0) >= CONDITIONING_T3_MS);
  if (!eligible.length) return null;
  return eligible.slice().sort((a, b) =>
    Number(b.quality_score) - Number(a.quality_score) ||
    Number(b.conditioning_ms) - Number(a.conditioning_ms) ||
    String(b.window_id).localeCompare(String(a.window_id)))[0];
}

/**
 * THE TWO NUMBERS (WS-Z A2), and why they may never be one.
 *
 * `voice-evidence`'s ECAPA estimate pools every window, so the MEASUREMENT
 * gets better as a call goes on. Synthesis conditions on ten seconds and gets
 * better only when a different ten seconds is selected. A single meter would
 * therefore climb while the clone could not possibly have changed — the same
 * class of defect as `disclosure-announces-the-clone`: a surface stating
 * something the underlying mechanism does not support.
 *
 * So this returns two labelled blocks and no combined figure. There is
 * deliberately no `overall` key for a UI to reach for.
 */
export function voiceMeter({ fidelityRow, pooledMs, pooledWindows, selection, unscoredCandidates = 0 }) {
  return Object.freeze({
    measurement_confidence: Object.freeze({
      // How well we can MEASURE this speaker. Grows with pooled audio.
      pooled_ms: Number(pooledMs) || 0,
      pooled_windows: Number(pooledWindows) || 0,
      measured: Boolean(fidelityRow),
      means: "how well we can measure you — improves as more of your audio pools",
      does_not_mean: "that the clone sounds any different",
    }),
    synthesis_conditioning: Object.freeze({
      // What the NEXT turn will actually synthesise from.
      selected: Boolean(selection),
      window_id: selection?.window_id ?? null,
      score: selection?.score ?? null,
      score_source: selection?.score_source ?? null,
      conditioning_ms: selection?.conditioning_ms ?? 0,
      selected_at: selection?.selected_at ?? null,
      unscored_candidates: Number(unscoredCandidates) || 0,
      means: "the audio the next clone turn conditions on — changes ONLY when the selection changes",
      truncation: Object.freeze({
        s3gen_ms: CONDITIONING_S3GEN_MS,
        t3_ms: CONDITIONING_T3_MS,
        source: "chatterbox prepare_conditionals(): DEC_COND_LEN / ENC_COND_LEN",
      }),
    }),
  });
}

/**
 * THE RECITED-PROMPT GUARD, JS half.
 *
 * A fragment that reaches `boardVerbalisms` is said aloud by a clone of a real
 * named person, every time the shape fits. `transcriptStats` already caps
 * n-grams at three words, but this module must not depend on that cap holding
 * for a caller that supplies its own fragment — so the rule is re-asserted
 * where the write is decided.
 *
 * Returns "" when the fragment is safe, and the REASON when it is not, because
 * a studio that has to tell an owner why a chip did not appear cannot do it
 * from a boolean.
 */
export function fragmentRejection(fragment) {
  const text = mirrorClean(fragment, 64);
  if (!text) return "empty";
  if (/[.!?]/.test(text)) return "sentence-shaped";
  const words = text.split(" ").filter(Boolean);
  if (words.length > PHRASE_BANK_MAX_WORDS) return `over-${PHRASE_BANK_MAX_WORDS}-words`;
  return "";
}

// ─────────────────────────────────────────────────────────────────────────
// input validation
// ─────────────────────────────────────────────────────────────────────────

/**
 * One ingested owner-turn window.
 *
 * `source_id` is OPTIONAL and its absence is meaningful rather than tolerated:
 * a window with no consented private object can be transcribed and mined, and
 * can never join the reference set. The studio uploads audio through the
 * ordinary `api/replica-source` lane (create_upload -> PUT -> finalize) and
 * passes the id here. This endpoint deliberately does NOT accept audio bytes:
 * a second upload path into the private bucket would be a second place that
 * knows how consented biometric storage is addressed, and `_replica-storage.js`
 * is the one place that may know.
 */
export function mirrorWindowInput(value) {
  const input = value && typeof value === "object" ? value : {};
  const seq = Number(input.seq);
  if (!Number.isSafeInteger(seq) || seq < 1 || seq > 100_000) fail("mirror_window_seq_invalid");
  const durationMs = Number(input.duration_ms ?? input.durationMs);
  if (!Number.isSafeInteger(durationMs) || durationMs < MIRROR_WINDOW_MIN_MS) {
    fail("mirror_window_duration_invalid");
  }
  // Refused at the door, loudly, rather than routed to the batch lane. See
  // MIRROR_WINDOW_MAX_MS.
  if (durationMs > MIRROR_WINDOW_MAX_MS) {
    fail("mirror_window_too_long", 413, { max_ms: MIRROR_WINDOW_MAX_MS, duration_ms: durationMs });
  }
  const sourceId = input.source_id ?? input.sourceId;
  return Object.freeze({
    seq,
    durationMs,
    sourceId: sourceId === undefined || sourceId === null || sourceId === ""
      ? null
      : mirrorUuid(sourceId, "mirror_window_source_invalid"),
  });
}

export function mirrorFeedbackInput(value) {
  const input = value && typeof value === "object" ? value : {};
  const turnRef = mirrorClean(input.turn_ref ?? input.turnRef, 128);
  if (!turnRef) fail("mirror_feedback_turn_ref_required");
  const verdict = String(input.verdict || "").trim();
  if (!new Set(["up", "down", "rephrase"]).has(verdict)) fail("mirror_feedback_verdict_invalid");
  const rephrase = mirrorClean(input.rephrase_text ?? input.rephraseText, 2000);
  if (verdict === "rephrase" && !rephrase) fail("mirror_feedback_rephrase_required");
  return Object.freeze({ turnRef, verdict, rephraseText: verdict === "rephrase" ? rephrase : "" });
}

export function mirrorDecision(value) {
  const decision = String(value || "").trim();
  if (decision !== "accept" && decision !== "reject") fail("mirror_decision_invalid");
  return decision === "accept" ? "accepted" : "rejected";
}

// ─────────────────────────────────────────────────────────────────────────
// the mine
// ─────────────────────────────────────────────────────────────────────────

/** Every mined delta kind, its sheet target (or '' for advisory) and the
 *  signal it reads. Authored as DATA so the endpoint, the store, the migration
 *  CHECK and the eval all enumerate one list rather than four. */
// `query` is Cakmak & Thomaz's taxonomy (HRI 2012, read at search-summary
// tier): a FEATURE query ("you say 'basically' a lot — add to phrase habits?")
// was preferred by participants, a LABEL query ("was that turn good?") least.
// The rail is weighted by it — see `budgetChips` — and 👍/👎 stays an
// always-available affordance the clone never asks for. (WS-Z A5.)
export const MIRROR_DELTA_KINDS = Object.freeze({
  phrase_habit: { targetField: "boardVerbalisms", signal: "catchphrases", query: "feature", origin: "mined" },
  slang_habit: { targetField: "exSlangRepeat", signal: "catchphrases", query: "feature", origin: "mined" },
  filler_advisory: { targetField: "", signal: "fillers", query: "feature", origin: "mined" },
  laughter_advisory: { targetField: "", signal: "laughter", query: "feature", origin: "mined" },
  stretch_advisory: { targetField: "", signal: "stretch", query: "feature", origin: "mined" },
  code_switch_advisory: { targetField: "", signal: "codeSwitch", query: "feature", origin: "mined" },
  feedback_note: { targetField: "", signal: "owner-feedback", query: "label", origin: "judgement" },
});

/** Chips proposed per minute of call. "People do not enjoy a constant stream
 *  of questions" is the measured finding behind this being a number at all;
 *  the surplus is not discarded, it falls to the post-call review queue the
 *  spec already names as where un-actioned chips go. (WS-Z A5.) */
export const MIRROR_CHIP_BUDGET_PER_MIN = 3;

/** Below this many owner words, a mined claim is under every published
 *  stylometric floor. Eder's systematic experiments put the floor at ≥5,000
 *  running words; other results reach ~2,000; samples under 3,000 produced over
 *  60% false attribution. [Both PDFs failed to decode this sweep — the figures
 *  are at search-summary tier and must be re-read before being quoted to the
 *  owner.] A 30-minute Mirror Call yields roughly 1,800–2,300 owner words (our
 *  arithmetic, not a citation), so a SINGLE CALL IS ALWAYS UNDER THIS. The
 *  constant exists so a studio can say so rather than so a chip can be
 *  suppressed — the chip is a hypothesis, and a hypothesis with its n attached
 *  is the honest object. (WS-Z A4.) */
export const MIRROR_STYLOMETRIC_FLOOR_TOKENS = 2_000;

/**
 * How confident a mined claim is allowed to look, given the corpus behind it.
 *
 * Three named bands rather than a score, because a decimal invites a UI to
 * render it as a percentage and there is no measurement underneath it that
 * would justify one.
 */
export function corpusConfidence(corpusTokens, occurrences) {
  const tokens = Number(corpusTokens) || 0;
  const n = Number(occurrences) || 0;
  const band = tokens >= MIRROR_STYLOMETRIC_FLOOR_TOKENS && n >= 5 ? "supported"
    : tokens >= MIRROR_STYLOMETRIC_FLOOR_TOKENS || n >= 5 ? "weak"
    : "below-every-published-floor";
  return Object.freeze({
    band,
    corpus_tokens: tokens,
    occurrences: n,
    floor_tokens: MIRROR_STYLOMETRIC_FLOOR_TOKENS,
    note: "stylometric sample-size floors, search-summary tier — a chip is a hypothesis, not an attribution",
  });
}

/**
 * The per-minute chip budget, applied to an already-mined list. (WS-Z A5.)
 *
 * FEATURE chips outrank LABEL chips and, within a kind, more evidence outranks
 * less — so the rail spends its budget on the questions people called the
 * smartest and on the claims with the most behind them. Everything over budget
 * is RETURNED, not dropped: the caller defers it to the review queue, which is
 * where the spec already sends un-actioned chips.
 */
export function budgetChips(deltas, elapsedMs, alreadyProposed = 0) {
  const minutes = Math.max(1, Math.ceil((Number(elapsedMs) || 0) / 60_000));
  const allowance = Math.max(0, minutes * MIRROR_CHIP_BUDGET_PER_MIN - (Number(alreadyProposed) || 0));
  const ranked = (Array.isArray(deltas) ? deltas : []).slice().sort((a, b) => {
    const qa = MIRROR_DELTA_KINDS[a.kind]?.query === "feature" ? 0 : 1;
    const qb = MIRROR_DELTA_KINDS[b.kind]?.query === "feature" ? 0 : 1;
    return qa - qb
      || Number(b.evidence?.count ?? 0) - Number(a.evidence?.count ?? 0)
      || String(a.kind + a.fragment).localeCompare(String(b.kind + b.fragment));
  });
  return { propose: ranked.slice(0, allowance), deferred: ranked.slice(allowance), allowance, minutes };
}

/** Frequency floor for a chip. Deliberately lower than the publish rule's 5
 *  for `transcriptStats`'s own stated reason — the gate is `verifyPhraseBank`
 *  against a HELD-OUT half at publish time, and a miner that pre-applies the
 *  gate's threshold has quietly turned a held-out check into an in-sample one.
 *  Higher than 1 because a chip per hapax is a rail nobody can read. */
export const MIRROR_MIN_COUNT = 3;

/** Advisory ratio chips need a corpus before their number means anything. A
 *  code-switch ratio off 12 tokens is not a measurement. */
export const MIRROR_MIN_ADVISORY_TOKENS = 60;

const round = (value, places) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

/**
 * Which windows a fragment was actually heard in.
 *
 * Recomputed rather than accumulated — see the header. Returns ascending
 * sequence numbers, which is the order a caption rail scrolls.
 */
function citationsFor(windows, fragment) {
  const cited = [];
  for (const window of windows) {
    if (countFragment(tokenize(window.transcript || ""), fragment) > 0) cited.push(window.seq);
  }
  return cited;
}

/**
 * Mine the rolling transcript into proposable deltas.
 *
 * @param windows  every TRANSCRIBED window of the session, ascending by seq,
 *                 `{ seq, transcript }`. Dropped and pending windows must not
 *                 be passed: a window whose ASR failed contributes no tokens,
 *                 and including it as an empty string would deflate every
 *                 per-1000 ratio without anything reporting it.
 * @param known    fragments already carrying a chip in this session, as a
 *                 Set of `${kind} ${fragment}` keys. A rejected chip's key
 *                 belongs in here — that is what stops a re-proposal.
 *
 * @returns `{ deltas, stats, guarded }` — `guarded` lists fragments the
 *          recited-prompt guard refused, so a mine that silently dropped
 *          everything is distinguishable from a transcript with nothing in it.
 */
export function mineMirrorDeltas(windows, known = new Set()) {
  const live = (Array.isArray(windows) ? windows : [])
    .filter((w) => w && typeof w.transcript === "string" && w.transcript.trim())
    .sort((a, b) => Number(a.seq) - Number(b.seq));

  const turns = live.map((w) => ({ speaker: MIRROR_OWNER_SPEAKER, text: w.transcript }));
  const stats = transcriptStats(turns, {
    teacherSpeaker: MIRROR_OWNER_SPEAKER,
    minCatchphraseCount: MIRROR_MIN_COUNT,
  });

  const deltas = [];
  const guarded = [];
  const seen = new Set(known);

  const propose = (kind, fragment, evidence) => {
    const key = `${kind} ${fragment}`;
    if (seen.has(key)) return;
    const target = MIRROR_DELTA_KINDS[kind].targetField;
    if (target) {
      const rejection = fragmentRejection(fragment);
      if (rejection) {
        guarded.push({ kind, fragment, reason: rejection });
        return;
      }
    }
    const cited = fragment ? citationsFor(live, fragment) : live.map((w) => w.seq);
    // The citation law, JS half: migration 058 refuses an uncited writable
    // delta, and a mine that produced one would 23514 at insert time. Caught
    // here so the failure names the fragment instead of the constraint.
    if (target && !cited.length) {
      guarded.push({ kind, fragment, reason: "uncited" });
      return;
    }
    seen.add(key);
    deltas.push({
      kind,
      fragment,
      targetField: target,
      // A mined chip is a claim about BEHAVIOUR. Its origin is a column, not a
      // flavour of the same column a judgement uses — see migration 058 and
      // WS-Z §4.4 (the owner is judging a clone of themselves, so the two
      // signals must be able to diverge measurably).
      origin: MIRROR_DELTA_KINDS[kind].origin,
      query: MIRROR_DELTA_KINDS[kind].query,
      // The n, on the chip, always. `corpusTokens` is the SESSION corpus here;
      // the store adds the cross-call total, because confidence accumulates
      // across calls and one call is under every published floor.
      occurrences: Number(evidence.count ?? cited.length ?? 0) || cited.length,
      corpusTokens: stats.tokens,
      evidence,
      citedWindows: cited,
    });
  };

  // ── phrase-bank chips: the only two writable kinds ──
  //
  // One fragment produces at most ONE writable chip. A catchphrase is offered
  // to `boardVerbalisms` when it is multi-word (a board verbalism is a phrase a
  // teacher says while working) and to `exSlangRepeat` when it is a single
  // word (short ordinary slang is the field's own definition). Offering both
  // would ask the owner to confirm one habit twice, which is precisely the
  // defect `maximalOnly` exists to avoid one level down.
  for (const candidate of stats.catchphrases) {
    if (candidate.count < MIRROR_MIN_COUNT) continue;
    const kind = candidate.fragment.includes(" ") ? "phrase_habit" : "slang_habit";
    propose(kind, candidate.fragment, {
      count: candidate.count,
      per1k: candidate.per1k,
      tokens: stats.tokens,
    });
  }

  // ── advisory chips: measured, accept/rejectable, and they write nothing ──
  if (stats.tokens >= MIRROR_MIN_ADVISORY_TOKENS) {
    for (const filler of stats.fillers) {
      if (filler.count < MIRROR_MIN_COUNT) continue;
      propose("filler_advisory", filler.fragment, {
        count: filler.count, per1k: filler.per1k, tokens: stats.tokens,
      });
    }
    for (const item of stats.laughter) {
      if (item.count < MIRROR_MIN_COUNT) continue;
      propose("laughter_advisory", item.fragment, {
        count: item.count, per1k: item.per1k, tokens: stats.tokens,
      });
    }
    for (const item of stats.stretch) {
      if (item.count < MIRROR_MIN_COUNT) continue;
      propose("stretch_advisory", item.fragment, {
        count: item.count, per1k: item.per1k, tokens: stats.tokens,
      });
    }
    if (stats.codeSwitch.hindiMarkerTokens > 0) {
      propose("code_switch_advisory", "", {
        token_ratio: stats.codeSwitch.tokenRatio,
        turn_ratio: stats.codeSwitch.turnRatio,
        hindi_marker_tokens: stats.codeSwitch.hindiMarkerTokens,
        tokens: stats.tokens,
        // The measurement is real and it is measuring the ROMANISED lexicon.
        // Sarvam returns Devanagari, so this reads 0.000 on visibly bilingual
        // speech (`romanised-lexicon-meets-devanagari-asr`, deliberately
        // unpatched). The marker rides on the evidence so a studio rendering
        // the chip can say what the number is and is not.
        lexicon: "romanised-markers",
      });
    }
  }

  return { deltas, stats, guarded };
}

// ─────────────────────────────────────────────────────────────────────────
// the honest arithmetic
// ─────────────────────────────────────────────────────────────────────────

/**
 * The chip stream's honesty report.
 *
 * The spec: "a quiet learning loop that dropped its input looks identical to a
 * clone with nothing to learn." So the numbers a studio needs to tell those
 * apart are computed here, from the WINDOW ROWS, and travel on every ingest
 * response — not only when something went wrong.
 *
 * `coverage` is transcribed milliseconds over ingested milliseconds. It is a
 * RATIO of audio and not of rows, because ten one-second windows dropping is a
 * different loss from one thirty-second window dropping and a row count says
 * they are the same.
 */
export function mirrorCoverage(windows) {
  const rows = Array.isArray(windows) ? windows : [];
  let ingestedMs = 0;
  let transcribedMs = 0;
  let droppedMs = 0;
  let pendingMs = 0;
  const dropped = [];
  for (const row of rows) {
    const ms = Number(row?.duration_ms ?? row?.durationMs ?? 0);
    ingestedMs += ms;
    const state = String(row?.asr_state ?? row?.asrState ?? "pending");
    if (state === "transcribed") transcribedMs += ms;
    else if (state === "dropped") {
      droppedMs += ms;
      dropped.push({
        seq: Number(row?.seq ?? 0),
        duration_ms: ms,
        // Never '' — migration 058's CHECK refuses a reasonless drop.
        failure_code: String(row?.failure_code ?? row?.failureCode ?? ""),
      });
    } else pendingMs += ms;
  }
  return Object.freeze({
    windows: rows.length,
    ingested_ms: ingestedMs,
    transcribed_ms: transcribedMs,
    dropped_ms: droppedMs,
    pending_ms: pendingMs,
    dropped_windows: Object.freeze(dropped.sort((a, b) => a.seq - b.seq)),
    coverage: ingestedMs ? round(transcribedMs / ingestedMs, 3) : 0,
    // The sentence a studio renders. Stated as a fact rather than left for the
    // UI to infer, so a UI that forgets to check `dropped_windows` still shows
    // the truth.
    complete: droppedMs === 0 && pendingMs === 0,
  });
}

/**
 * CANDIDATE-POOL arithmetic. (Formerly reference-set growth; WS-Z A1 renamed
 * the thing it counts, not just the label.)
 *
 * Counts ADMITTED windows only, and separately counts how many of them are
 * SELECTABLE — scored, and long enough to fill the T3 slice. The distinction
 * is the whole point after A1: a pool that grew by twenty windows and gained
 * no selectable candidate has changed nothing about how the clone sounds, and
 * a number that reported only growth would say otherwise.
 *
 * `withheld_windows` names why audio did not enter the pool, so a meter can
 * never move on audio that was never admitted.
 */
export function mirrorReferenceGrowth(windows, baseline = {}) {
  const rows = Array.isArray(windows) ? windows : [];
  const baseWindows = Number(baseline.windows ?? baseline.reference_windows ?? 0) || 0;
  const baseMs = Number(baseline.ms ?? baseline.reference_ms ?? 0) || 0;
  let addedWindows = 0;
  let addedMs = 0;
  let selectable = 0;
  let unscored = 0;
  const withheld = new Map();
  for (const row of rows) {
    const ms = Number(row?.duration_ms ?? row?.durationMs ?? 0);
    if (row?.reference_admitted ?? row?.referenceAdmitted) {
      addedWindows += 1;
      addedMs += ms;
      const scored = row?.quality_score !== null && row?.quality_score !== undefined;
      if (!scored) unscored += 1;
      else if (Number(row?.conditioning_ms ?? 0) >= CONDITIONING_T3_MS) selectable += 1;
    } else {
      const reason = String(row?.admission_reason ?? row?.admissionReason ?? "unknown");
      withheld.set(reason, (withheld.get(reason) ?? 0) + 1);
    }
  }
  return Object.freeze({
    baseline_windows: baseWindows,
    baseline_ms: baseMs,
    added_windows: addedWindows,
    added_ms: addedMs,
    total_windows: baseWindows + addedWindows,
    total_ms: baseMs + addedMs,
    // The number that actually matters after A1. Growth in `total_ms` past the
    // truncation window buys nothing; a new SELECTABLE candidate is the only
    // thing that can change how the clone sounds.
    selectable_candidates: selectable,
    unscored_candidates: unscored,
    withheld_windows: Object.freeze(
      [...withheld.entries()].sort().map(([reason, count]) => ({ reason, count })),
    ),
    // Stated on the wire so a studio cannot render pool growth as improvement.
    pool_growth_is_not_improvement:
      "Chatterbox conditions on at most 10 s; only a new SELECTION changes synthesis",
  });
}

/**
 * Merge one accepted delta into a sheet body, returning the NEW body.
 *
 * Pure and total: it never mutates the input, it refuses a delta whose target
 * is not one of the two phrase-bank fields, and it re-runs the recited-prompt
 * guard one last time before the value can reach a jsonb column. That is the
 * third copy of the guard (mine, this, the CHECK) and it is here because this
 * is the only function in the codebase whose output becomes prompt bytes.
 *
 * Returns `null` when the merge is a no-op (already present, or over the
 * field's ceiling), so the caller can report "accepted, nothing to write"
 * instead of writing an identical sheet and calling it an update.
 */
export const MIRROR_PHRASE_BANK_CEILING = 12;

export function mergeDeltaIntoSheet(sheet, delta) {
  const field = String(delta?.target_field ?? delta?.targetField ?? "");
  if (field !== "boardVerbalisms" && field !== "exSlangRepeat") {
    fail("mirror_delta_not_writable", 409, { target_field: field });
  }
  const fragment = mirrorClean(delta?.fragment, 64);
  const rejection = fragmentRejection(fragment);
  if (rejection) fail("mirror_delta_fragment_unsafe", 409, { reason: rejection });

  const body = sheet && typeof sheet === "object" ? { ...sheet } : {};

  if (field === "boardVerbalisms") {
    const current = Array.isArray(body.boardVerbalisms)
      ? body.boardVerbalisms.map((v) => mirrorClean(v, 64)).filter(Boolean)
      : [];
    if (current.includes(fragment)) return null;
    if (current.length >= MIRROR_PHRASE_BANK_CEILING) return null;
    body.boardVerbalisms = [...current, fragment];
    return body;
  }

  // `exSlangRepeat` ships as a parenthesised quoted list — the same unwrap
  // `fromSheet.ts::verbalismFragments` and `_teachersheet.js::fragmentsOf` do.
  // Re-rendered rather than string-appended so a malformed stored value is
  // normalised rather than compounded.
  const raw = typeof body.exSlangRepeat === "string" ? body.exSlangRepeat : "";
  const current = raw
    .replace(/^[\s(]+|[\s)]+$/g, "")
    .split(",")
    .map((s) => mirrorClean(s, 64).replace(/^["'`]+|["'`]+$/g, "").trim())
    .filter(Boolean);
  if (current.includes(fragment)) return null;
  if (current.length >= MIRROR_PHRASE_BANK_CEILING) return null;
  body.exSlangRepeat = `(${[...current, fragment].map((v) => `"${v}"`).join(", ")})`;
  return body;
}
