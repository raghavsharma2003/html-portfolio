// The `mirror-call/v1` wire format. WS-X's half of the contract WS-Y's
// `src/studio/mirrorCallApi.ts` is the other half of.
//
// ── why this is its own file ─────────────────────────────────────────────
// `mirrorCallApi.ts` is deliberately "the ONLY place the wire format appears"
// on the client. This is the same discipline on the server: every field name
// the studio reads is constructed HERE, out of the internal row shapes, and
// nowhere else. The two files are the contract, and a change to either is a
// one-file diff a reviewer can hold in their head.
//
// The internal shapes are deliberately NOT the wire shapes. `vy_mirror_delta`
// carries `origin`, `own_voice_state`, `score_source` and the rest because the
// data model has to be able to say things the studio has no way to render; the
// wire carries what the studio contracted for. Collapsing the two would make
// every schema addition a client-visible change.
import {
  CONDITIONING_S3GEN_MS,
  MIRROR_DELTA_KINDS,
  mirrorClean,
} from "./_mirrorcall.js";

export const MIRROR_CALL_CONTRACT = "mirror-call/v1";
export const FIDELITY_FAMILY = "speechbrain-ecapa-voxceleb";

/** Every op this deployment serves. The handshake echoes it, and WS-Y checks
 *  its own REQUIRED_OPS against it — so an op missing from a deployment is a
 *  named error at connect time rather than a mysterious 400 mid-call. */
export const MIRROR_CALL_OPS = Object.freeze([
  "contract", "create", "status", "ingest_window", "deltas",
  "delta_action", "turn_voice", "turn_feedback", "end",
  // WS-R5. The interview's gap preview, and the only op it adds: the interview
  // itself is a MODE of `create`, not a second call, because a second call lane
  // would be a second reply assembler (`mirror-call-reply-is-the-one-door`).
  // Optional on the client, like `turn_voice` and `status`: a deployment
  // without it runs calibration calls and the studio says the interview is not
  // available here rather than offering a button that 400s.
  "interview_gaps",
]);

/** The two modes a Mirror Call can open in. `calibrate` is what every existing
 *  client asks for by not asking, so an old studio against a new deployment
 *  behaves exactly as it did. */
export const MIRROR_CALL_MODES = Object.freeze(["calibrate", "interview"]);

/** Ops the client knows about that this deployment does NOT serve.
 *
 *  EMPTY as of WS-AC. `turn_voice` used to live here, and the comment that
 *  stood in its place is kept in the git history rather than deleted from the
 *  record: WS-X did not own the clone's reply lane, so the op answered 501 and
 *  every window returned `turn: null` with `clone_reply_lane_not_wired`. It is
 *  now served — the text through `api/_mirrorcall-reply.js` and the audio
 *  through WS-W's admission broker, unforked.
 *
 *  The constant STAYS, and it stays exported, checked and empty. WS-Y's client
 *  reads `unserved_ops` to say WHY a missing op is missing rather than guessing
 *  from a 400, and an empty list is a positive statement ("this deployment
 *  serves everything the contract names") that an absent field is not. It is
 *  also the place the next unfinished op goes, and a list that has to be
 *  reintroduced is a list that gets forgotten. */
export const MIRROR_CALL_UNSERVED_OPS = Object.freeze([]);

/** DEVIATION FROM THE CLIENT'S DEFAULT, declared on the handshake so the studio
 *  can see it rather than discover it.
 *
 *  `mirrorCallApi.ts` posts window audio as MULTIPART and says the alternative
 *  is "the `enrollmentApi` pattern" — a signed upload handle. This backend
 *  takes the handle, and the reason is not preference:
 *
 *   1. The bytes never touch the function. A serverless body limit is a hard
 *      ceiling a 30 s window sits just under today and would exceed the moment
 *      anyone raises the sample rate or sends anything but PCM16.
 *   2. It reuses the CONSENTED lane. `/api/replica-source` checks the capture
 *      and storage scopes in SQL, verifies the stored object's size and mime,
 *      and puts the row inside `docs/REPLICA-ERASURE.md`'s chain. A multipart
 *      path would be a SECOND way into the private biometric bucket, and
 *      `api/_replica-storage.js` is the one place that may know how that bucket
 *      is addressed.
 *   3. An ASR retry re-reads the same object instead of asking the owner to
 *      speak again.
 *
 *  The client change is `ingestAudioWindow` and `saveMirrorCallTurnFeedback`
 *  only — three fields of JSON instead of a FormData. */
export const MIRROR_CALL_TRANSPORT = Object.freeze({
  ingest_window: "source_handle",
  turn_feedback: "json",
  detail: "POST JSON { session_id, seq, duration_ms, source_id, client_hint? }. " +
    "Upload the WAV first through /api/replica-source (create_upload -> signed PUT -> finalize) " +
    "and pass the source_id. Multipart is answered 415 with this same note.",
});

/** Internal delta kinds -> the five the studio renders. The internal set is
 *  finer than the client's on purpose (it distinguishes which sheet field a
 *  phrase-bank chip targets, and which statistical signal an advisory came
 *  from), and the wire says which of the client's buckets it falls in. The
 *  precise internal kind rides alongside as `mirror_kind` for anyone reading a
 *  log; the studio ignores it. */
const CLIENT_KIND = Object.freeze({
  phrase_habit: "phrase_habit",
  slang_habit: "phrase_habit",
  filler_advisory: "register",
  laughter_advisory: "register",
  stretch_advisory: "register",
  code_switch_advisory: "register",
  feedback_note: "delivery",
});

/** Internal ASR failure codes -> the six drop reasons the studio's union
 *  admits. The RAW code travels beside it: the studio needs a reason it can
 *  render, and an operator needs the code that was actually raised, and
 *  collapsing them would lose the second. Anything unmapped is
 *  `audio_unusable`, which is the truthful default for "we could not get words
 *  out of this" and never `asr_empty`, which would claim silence we did not
 *  measure. */
export function dropReason(failureCode) {
  const code = String(failureCode || "");
  if (/429|rate|slow_down/i.test(code)) return "rate_limited";
  if (/empty|transcript_missing/i.test(code)) return "asr_empty";
  if (/timeout|unreachable|abort/i.test(code)) return "asr_timeout";
  if (/too_long|window_too_long/i.test(code)) return "too_long";
  if (/too_short/i.test(code)) return "too_short";
  return "audio_unusable";
}

const seconds = (ms) => Math.round((Number(ms) || 0) / 100) / 10;

/**
 * THE TWO NUMBERS, in the studio's field names (WS-Z adoption delta A2).
 *
 * `measurement_*` describes how well we can MEASURE this speaker and grows
 * with pooled audio. `conditioning_*` describes what the NEXT reply is built
 * from and moves only when a better ~10 s window is selected. A single figure
 * would climb steadily beside a clone that cannot have changed, which is the
 * `disclosure-announces-the-clone` family of defect.
 *
 * ── TWO DECLARED DEVIATIONS, both in the honest direction ────────────────
 *  1. `conditioning_window_score` is NOT an ECAPA number today. The client's
 *     comment describes it as one. This backend ranks candidate windows with a
 *     server-side DSP probe of the stored bytes (voiced fraction, level,
 *     clipping) because no ECAPA-per-window scorer exists yet, and a
 *     wav-probe number rendered as ECAPA would be a scale claim nobody
 *     measured. `conditioning_score_source` says which it is, on every payload.
 *  2. `measurement_score` / `measurement_confidence` / `p10` are null until a
 *     `vy_voice_fidelity` row exists, and one cannot exist without biometric
 *     consent through a live liveness challenge that nobody has passed
 *     (context/STATE.md). Null, never 0 — the client's own comment says 0
 *     "would render as a terrible clone".
 */
export function wireFidelity({ fidelityRow, pooledMs, pooledWindows, selection, selections = 0, ceiling = null }) {
  const score = fidelityRow
    ? (typeof fidelityRow.score === "string" ? JSON.parse(fidelityRow.score) : fidelityRow.score || {})
    : null;
  return {
    family: FIDELITY_FAMILY,
    policy_version: String(fidelityRow?.policy_version || ""),
    ceiling: ceiling === null || ceiling === undefined ? null : Number(ceiling),
    measurement_score: score && typeof score.mean === "number" ? score.mean : null,
    // No confidence is computed for the pooled estimate. Emitting a number
    // here would be inventing one; the client's own contract says null means
    // "the server does not compute one".
    measurement_confidence: null,
    p10: score && typeof score.p10 === "number" ? score.p10 : null,
    windows: Number(pooledWindows) || 0,
    pooled_seconds: seconds(pooledMs),
    conditioning_window_score: selection ? Number(selection.score) : null,
    conditioning_seconds: selection ? seconds(selection.conditioning_ms) : null,
    window_selected_at: selection?.selected_at ?? null,
    window_selections: Number(selections) || 0,
    // ── fields beyond the contract, ignored by the client, load-bearing for
    //    anyone reading the payload ──
    conditioning_score_source: selection?.score_source ?? null,
    conditioning_truncation_ms: CONDITIONING_S3GEN_MS,
    scale_note: "speaker-embedding similarity; NOT a claim about how the clone sounds",
    pool_growth_note: "pooled audio improves the MEASUREMENT only; synthesis changes only on a new selection",
  };
}

/**
 * One delta, in the studio's field names.
 *
 * `citation` is REQUIRED by the client and refused at its door if absent — "a
 * chip the owner cannot trace back to something they said is a chip they
 * cannot judge". It is built from the stored `citation` jsonb rather than
 * re-derived here, so the quote a studio renders is the quote that was cited
 * when the chip was proposed and not whatever the transcript looks like now.
 *
 * `proposal` is a DESCRIBED SHAPE, never a line the clone could say
 * (`recited-prompt`). It names the field and the fragment; the fragment itself
 * is already ≤3 words with no terminal punctuation, enforced three times over
 * (the mine, `mergeDeltaIntoSheet`, and migration 058's CHECK).
 */
export function wireDelta(row) {
  if (!row) return null;
  const internal = String(row.kind || "");
  const citation = row.citation && typeof row.citation === "object"
    ? row.citation
    : (typeof row.citation === "string" ? JSON.parse(row.citation || "{}") : {});
  const evidence = row.evidence && typeof row.evidence === "object"
    ? row.evidence
    : (typeof row.evidence === "string" ? JSON.parse(row.evidence || "{}") : {});
  const field = String(row.target_field || "");
  const fragment = String(row.fragment || "");
  return {
    delta_id: row.delta_id,
    kind: CLIENT_KIND[internal] || "register",
    field,
    proposal: field
      ? `add "${fragment}" to ${field}`
      // An advisory chip proposes a MEASUREMENT for the owner to confirm or
      // wave away; it writes no field, and saying so on the chip is what stops
      // a studio implying it did.
      : `noted: ${internal.replace(/_advisory$/, "")}${fragment ? ` "${fragment}"` : ""} — records your judgement, changes no sheet field`,
    citation: {
      turn_id: String(citation.turn_id || ""),
      quote: mirrorClean(citation.quote, 240),
      occurrences: Number(citation.occurrences ?? row.occurrences ?? 0) || 0,
    },
    evidence: {
      occurrences_this_call: Number(evidence.count ?? row.occurrences ?? 0) || 0,
      occurrences_total: Number(row.occurrences ?? 0) || 0,
      calls: Number(evidence.calls ?? 1) || 1,
      corpus_words: Number(row.corpus_tokens ?? 0) || 0,
    },
    status: row.state,
    applied: row.state === "accepted" && Boolean(row.applied_at),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : "",
    // Beyond the contract, ignored by the client:
    mirror_kind: internal,
    // mined-from-BEHAVIOUR vs accepted-from-JUDGEMENT, never averaged. The
    // Mirror Call's sycophancy hazard lives in the gap between them.
    origin: row.origin,
    query: MIRROR_DELTA_KINDS[internal]?.query ?? "feature",
    advisory: !field,
  };
}

export const wireDeltas = (rows) => (Array.isArray(rows) ? rows : []).map(wireDelta).filter(Boolean);

/**
 * One clone turn, in the studio's field names. WS-AC.
 *
 * The client's contract is three fields — `turn_id`, `text`, `can_voice` — and
 * `ingestAudioWindow` reads exactly those. Everything past them is beyond the
 * contract and ignored by the studio, and every one of them is here because a
 * payload that carries a plausible reply and cannot say WHICH persona produced
 * it, or whether the caption is the whole reply, is the shape
 * `plausible-return-hides-a-dead-pipeline` warns about wearing a friendlier
 * face.
 *
 * `can_voice` is a STATEMENT ABOUT THIS DEPLOYMENT, computed from whether the
 * synthesis route is configured at all, and it is deliberately not optimistic.
 * The studio only calls `turn_voice` when it is true, so a `true` on a
 * deployment with no broker origin buys a guaranteed round trip that ends in a
 * 503 — and the owner reads that as their clone failing rather than as an
 * environment that was never wired. `voice_absent_reason` names which it is.
 */
export function wireTurn(row, { canVoice = false, voiceAbsentReason = "" } = {}) {
  if (!row) return null;
  const text = String(row.text || "");
  if (!text) return null;
  const assembled = Number(row.assembled_chars ?? text.length) || text.length;
  return {
    turn_id: String(row.turn_id || ""),
    text,
    can_voice: Boolean(canVoice),
    // ── beyond the contract, ignored by the client, load-bearing for anyone
    //    reading the payload ──
    //
    // 'draft' is the honest marker the brief asked for. It is not a warning
    // and it is not an error: calibrating before publishing is the normal case
    // and the whole reason the Mirror Call exists. It is a fact the owner is
    // entitled to, because "which of my two personas did I just grade" has no
    // other answer and a wrong answer costs them the call.
    sheet_source: row.sheet_source,
    sheet_id: row.sheet_id ?? null,
    // Non-null only when the caption is SHORTER than what the engine produced.
    // The caption and the audio are the same string in every case, so this is
    // the one place the difference is visible, and leaving it out would make
    // the trim silent (`silent-truncation`).
    truncated: assembled > text.length
      ? { spoken_chars: text.length, assembled_chars: assembled, cap: text.length }
      : null,
    agent_slug: row.agent_slug || "",
    // Counts only. What the gate caught must not travel — `gateReply`'s rule.
    gate: { applied: Boolean(row.gate_applied), findings: Number(row.gate_findings ?? 0) || 0 },
    voice_state: row.voice_state || "unspoken",
    voice_absent_reason: canVoice ? "" : String(voiceAbsentReason || ""),
  };
}
