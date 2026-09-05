// The Mirror Call — the calibration call where a clone learns from its own
// human. WS-X, the server half of `mirror-call/v1`.
//
// Contract: docs/gurukul/MIRROR-CALL-SPEC.md, plus the two research redirects
// it now carries — `mirror-learning-is-selection-not-accumulation`
// (context/decisions.md, 2026-08-26) and its adoption deltas A1–A6.
// The wire is `src/studio/mirrorCallApi.ts` (WS-Y) and `api/_mirrorcall-wire.js`
// (here); those two files are the whole contract.
//
//   GET  /api/mirror-call?op=contract              the deployment handshake
//   GET  /api/mirror-call?op=status&session_id=…   is the GPU warm, where is fidelity
//   GET  /api/mirror-call?op=deltas&session_id=…   the chip rail
//   GET  /api/mirror-call?op=turn_voice&…          the clone's protected audio
//   POST /api/mirror-call?op=create                { replica_id }
//   POST /api/mirror-call?op=ingest_window         { session_id, seq, duration_ms, source_id }
//   POST /api/mirror-call?op=delta_action          { session_id, delta_id, action }
//   POST /api/mirror-call?op=turn_feedback         { session_id, turn_id, rating, … }
//   POST /api/mirror-call?op=end                   { session_id }
//
// `op` is read from the QUERY STRING, which is where the client puts it. The
// body is JSON on every op — see MIRROR_CALL_TRANSPORT for the one declared
// deviation from the client's default and the three reasons for it.
//
// ═════════════════════════════════════════════════════════════════════════
// WHAT THIS ENDPOINT IS NOT
// ═════════════════════════════════════════════════════════════════════════
//
// It is not the call. `src/voice/liveCall.ts` is the call, it may import
// nothing beyond `./level` and `../engine/diag`, and `evals/echosim` gates any
// change to it — so the Mirror Call is built AROUND the call engine and this
// file touches none of it. Capture and learning hang off the call's existing
// seams: the studio already has the owner's audio and the turn boundaries.
//
// ═════════════════════════════════════════════════════════════════════════
// THE CLONE'S REPLY — WS-AC, and what changed
// ═════════════════════════════════════════════════════════════════════════
//
// This block used to say that `turn_voice` answers 501 and that every window
// returns `turn: null`. Both were true and neither is any more, and the text is
// replaced rather than amended because a header that describes a lane the file
// no longer has is the most expensive kind of stale comment.
//
// What happens now, on each half:
//
//  TEXT. After ASR, `api/_mirrorcall-reply.js` assembles the reply through the
//  SAME door every other surface's bytes leave by — `sheetToModule` over the
//  owner's own TeacherSheet, `engine.compile`, `gatedReply`. It is not a second
//  chat engine and there is no fallback persona in it: a replica with no sheet
//  produces NO TURN and a named reason. The turn is stored (migration 060) so
//  the synthesis half can bind to it, and `sheet_source` rides on every payload
//  so an owner always knows whether they just graded their published clone or
//  their draft.
//
//  AUDIO. `opTurnVoice` synthesises THAT STORED TEXT through WS-W's
//  `handleVoicePreviewPanel` — the admission broker, the HMAC, the audible
//  disclosure prefix, the watermark and the provenance ledger, all of it
//  unforked and none of it re-decided here. The one thing this file adds is the
//  binding: the text comes from `getMirrorTurn`, never from the query string.
//  The 202-warming contract is passed through byte for byte, so the studio's
//  honest "your voice runtime is starting" state is the SAME state the preview
//  panel shows, produced by the same code.
//
// What is still absent is still named. `turn_absent_reason` is a member of
// `MIRROR_TURN_ABSENT_REASONS` and nothing else; `voice_absent_reason` says why
// a turn that exists cannot be spoken on this deployment. A lane that answered
// silence would be the fake-progress-bar failure with a speaker on it, and none
// of the states below is silent.
//
// It is not an upload endpoint. Window audio reaches the private bucket through
// the ordinary consented lane and arrives here as a `source_id`.
//
// ═════════════════════════════════════════════════════════════════════════
// THE HONESTY CONTRACT ON EVERY INGEST RESPONSE
// ═════════════════════════════════════════════════════════════════════════
//
// "If ASR lags or a window drops, the chip stream says so; a quiet learning
// loop that dropped its input looks identical to a clone with nothing to
// learn." So `dropped` and `fidelity` ride on EVERY window result, not only
// failing ones, and both are computed from the window ROWS rather than from
// what this invocation happened to do.
//
// The same rule governs the voice loop, and after WS-Z it is sharper. The pool
// can grow all call and change nothing: Chatterbox conditions on at most ten
// seconds. So the response carries TWO numbers — a measurement that improves
// with pooled audio and a conditioning score that moves only when a better ten
// seconds is SELECTED — and never a single figure that would climb beside a
// clone which cannot have changed.
import { randomUUID } from "node:crypto";
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { configuredLiveAsrProvider } from "./_asr/registry.js";
import { probeEnrollmentWav } from "./_audio/wav.js";
import { readPrivateReplicaObject } from "./_replica-storage.js";
import { WARMUP, voiceWarmth } from "./_voice/warmup.js";
import {
  CONDITIONING_S3GEN_MS,
  MIRROR_CHIP_BUDGET_PER_MIN,
  MIRROR_WINDOW_MAX_MS,
  MirrorCallError,
  bestConditioningCandidate,
  budgetChips,
  conditioningScore,
  mineMirrorDeltas,
  mirrorClean,
  mirrorCoverage,
  mirrorDecision,
  mirrorFeedbackInput,
  mirrorReferenceGrowth,
  mirrorUuid,
  mirrorWindowInput,
} from "./_mirrorcall.js";
import {
  MIRROR_CALL_CONTRACT,
  MIRROR_CALL_OPS,
  MIRROR_CALL_TRANSPORT,
  MIRROR_CALL_UNSERVED_OPS,
  dropReason,
  wireDelta,
  wireDeltas,
  wireFidelity,
  wireTurn,
} from "./_mirrorcall-wire.js";
import {
  MIRROR_REPLY_TEXT_MAX,
  MIRROR_TURN_ABSENT_REASONS,
  assembleMirrorReply,
  mirrorReplyHistory,
} from "./_mirrorcall-reply.js";
import {
  INTERVIEW_LENGTH_MS,
  INTERVIEW_OPENING_GAPS,
  buildInterviewGaps,
  renderInterviewAsk,
} from "./_interview-gaps.js";
import {
  endInterviewSession,
  getInterviewByMirrorSession,
  listInterviewAnswers,
  markQuestionAsked,
  openInterviewSession,
  readInterviewInputs,
  recordInterviewAnswer,
} from "./_interview-store.js";
import {
  decideMirrorDelta,
  endMirrorSession,
  getMirrorTurn,
  getProposedMirrorDelta,
  listMirrorDeltas,
  listMirrorTurns,
  listMirrorWindows,
  listUnactionedMirrorDeltas,
  mirrorCorpusTokens,
  mirrorDeltaTally,
  mirrorDraftGenomeVersion,
  mirrorReferenceBaseline,
  mirrorReplyAgent,
  mirrorSelectionCount,
  mirrorWindowAudioRef,
  noteMirrorTurnVoice,
  openMirrorSession,
  proposeMirrorDelta,
  recordMirrorFeedback,
  recordMirrorTurn,
  recordMirrorWindow,
  resolveMirrorSession,
  scoreMirrorWindow,
  selectConditioningWindow,
  settleMirrorWindow,
  standingConditioning,
  standingMirrorFidelity,
} from "./_mirrorcall-store.js";
import { createProductionProtectionAdapters } from "./_provenance/registry.js";
import { protectReplicaStream } from "./_provenance/delivery.js";
import { createOpenChatterboxPreviewProvider } from "./_voice/providers/open-chatterbox-preview.js";
import { handleVoicePreviewPanel } from "./_voice/preview-panel.js";
import {
  beginOwnedVoicePreview,
  createNeonVoicePreviewLedger,
  markVoicePreviewFailed,
} from "./_replica-voice-preview.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  // The provenance headers a protected clip carries, plus the warming contract's
  // Retry-After. Exposed for the same reason `api/voice-preview.js` exposes
  // them: a clip whose generation id and disclosure scheme are unreadable from
  // the browser is a clip nobody can trace back to its ledger row.
  res.setHeader("Access-Control-Expose-Headers",
    "X-Vyakti-Generation, X-Vyakti-Disclosure, X-Vyakti-Model-Commitment, Retry-After");
  res.setHeader("Cache-Control", "no-store");
}

/** The one real ceiling anchor this platform has, named with its provenance
 *  rather than hardcoded as if it were universal: it is ONE speaker's
 *  self-vs-self number (`first-real-clone`, n=2, spread 1e-6, 2026-08-26). The
 *  client renders both meters against it and says both are topless when it is
 *  null; borrowing a different speaker's ceiling would be worse than having
 *  none. */
const PRINTED_CEILING = 0.8869;

/**
 * Is the GPU warm, honestly.
 *
 * `voiceWarmth` is WS-W's per-process warmth memory, and it answers warm /
 * warming / cold from what this process has actually observed. The ETA is the
 * MEASURED cold-start range (161 s ready, reported as a 2–3 minute band), and
 * it is emitted only while a wake is believed in flight — a countdown shown
 * against a cold service nobody has poked is a number nobody measured.
 */
function gpuState() {
  const origin = String(process.env.AZURE_OPEN_VOICE_ORIGIN || "");
  if (!origin) {
    // No broker configured: not "cold", UNCONFIGURED. Reported as not-warm with
    // no estimate, because an estimate here would be an estimate of nothing.
    return { warm: false, estimated_ready_seconds: null, state: "unconfigured" };
  }
  const warmth = voiceWarmth.read(origin);
  return {
    warm: warmth.state === "warm",
    estimated_ready_seconds: warmth.state === "warming"
      ? Math.round(WARMUP.coldStartEtaHighMs / 1000)
      : null,
    state: warmth.state,
  };
}

/** The fidelity block, assembled from every number that exists and none that
 *  does not. */
async function fidelityFor(db, ownerUserId, replicaId, sessionId) {
  const [row, selection, selections, windows, baseline] = await Promise.all([
    standingMirrorFidelity(db, ownerUserId, replicaId),
    standingConditioning(db, ownerUserId, replicaId),
    mirrorSelectionCount(db, ownerUserId, replicaId, sessionId),
    listMirrorWindows(db, ownerUserId, replicaId, sessionId),
    mirrorReferenceBaseline(db, ownerUserId, replicaId, sessionId),
  ]);
  const pool = mirrorReferenceGrowth(windows, baseline);
  return {
    fidelity: wireFidelity({
      fidelityRow: row,
      pooledMs: pool.total_ms,
      pooledWindows: pool.total_windows,
      selection,
      selections,
      ceiling: PRINTED_CEILING,
    }),
    pool,
    windows,
  };
}

/** `reference` on a window result: how the CANDIDATE POOL grew, or null when
 *  this window was not admitted to it. Named `reference` because that is the
 *  client's field; the pool it counts is a candidate pool, and the fidelity
 *  block's `pool_growth_note` says what growth does and does not mean. */
function referenceBlock(window, pool) {
  if (!window?.reference_admitted) return null;
  return {
    consented_windows: pool.total_windows,
    total_seconds: Math.round(pool.total_ms / 100) / 10,
  };
}

/**
 * Score a candidate window from the stored bytes and re-run the selection.
 *
 * A REAL server-side DSP measurement (`api/_audio/wav.js`'s probe, the same
 * validator the enrollment lane uses) over the audio that is actually stored.
 * A client-supplied score would be a number this process did not measure.
 *
 * It is NOT speaker identity — admission is decided by consent and the
 * own-voice predicate, both upstream of here — and it is NOT ECAPA, which is
 * why `score_source` travels with every score and every selection.
 */
async function scoreAndSelect(db, ownerUserId, replicaId, sessionId, window, bytes) {
  if (!window?.reference_admitted || !bytes) return null;
  let score = null;
  try {
    score = conditioningScore(probeEnrollmentWav(bytes), window.duration_ms);
  } catch {
    // Not canonical enrollment WAV: a refusal to RANK, not a rank of zero. The
    // window stays unscored, ineligible for selection, and counted as
    // `unscored_candidates`.
    return null;
  }
  if (score === null) return null;
  await scoreMirrorWindow(db, ownerUserId, replicaId, window.window_id, score, "wav_probe");
  const pool = await listMirrorWindows(db, ownerUserId, replicaId, sessionId);
  const best = bestConditioningCandidate(pool);
  if (!best) return null;
  // Installs a new selection only if it is STRICTLY better than the standing
  // one — the SQL says so, not this line.
  return selectConditioningWindow(db, ownerUserId, replicaId, sessionId, best);
}

/**
 * Re-mine the rolling transcript, budget the rail, and propose.
 *
 * `known` is built from the deltas ALREADY in the table, whatever their state,
 * so a rejected chip is never re-proposed and an accepted one is never
 * duplicated. The store's `on conflict … where state in ('proposed','deferred')`
 * is the second copy of that rule, against the race this read cannot see.
 */
async function mineAndPropose(db, ownerUserId, replicaId, sessionId, session, windows) {
  const existing = await listMirrorDeltas(db, ownerUserId, replicaId, sessionId);
  const known = new Set(existing.map((d) => `${d.kind} ${d.fragment || ""}`));
  const live = windows.filter((w) => w.asr_state === "transcribed");
  const transcribed = live.map((w) => ({ seq: Number(w.seq), transcript: w.transcript || "" }));

  const { deltas, stats, guarded } = mineMirrorDeltas(transcribed, known);

  // The CROSS-CALL corpus, not this call's. Confidence accumulates across
  // calls because one 30-minute call yields ~1,800–2,300 owner words, below
  // every published stylometric floor (WS-Z A4).
  const corpus = await mirrorCorpusTokens(db, ownerUserId, replicaId);

  // The rail is rate-budgeted per minute and weighted to FEATURE queries;
  // the surplus is PERSISTED as 'deferred' for the review queue, never
  // dropped (WS-Z A5).
  const elapsedMs = Date.now() - new Date(session?.started_at || Date.now()).getTime();
  const minedSoFar = existing.filter((d) => d.origin === "mined" && d.state === "proposed").length;
  const { propose, deferred } = budgetChips(deltas, elapsedMs, minedSoFar);

  const cited = [];
  for (const delta of [...propose.map((d) => ({ d, state: "proposed" })),
    ...deferred.map((d) => ({ d, state: "deferred" }))]) {
    const row = await proposeMirrorDelta(db, ownerUserId, replicaId, sessionId, {
      ...delta.d,
      state: delta.state,
      corpusTokens: corpus.tokens,
      // THE CITATION. The client refuses a chip without one at the door, and it
      // is right to: a chip the owner cannot trace back to something they said
      // is a chip they cannot judge. Built from the FIRST window the fragment
      // was actually heard in, with the owner's own (already PII-scrubbed)
      // words around it.
      citation: citationFor(live, delta.d),
    });
    if (row && delta.state === "proposed") cited.push(row);
  }
  return { proposed: cited, stats, guarded, corpus };
}

/** The quote a chip is judged on: the transcript of the first window that
 *  contains the fragment, trimmed around it. For a chip with no fragment (the
 *  code-switch ratio) the first cited window's opening words stand in, because
 *  a ratio is measured over the whole span and there is no single moment to
 *  point at — and saying that with the span rather than inventing a moment is
 *  the honest version. */
function citationFor(windows, delta) {
  const seq = delta.citedWindows?.[0];
  const window = windows.find((w) => Number(w.seq) === Number(seq)) || windows[0];
  const text = String(window?.transcript || "");
  let quote = text;
  if (delta.fragment) {
    const at = text.toLowerCase().indexOf(delta.fragment.toLowerCase());
    if (at >= 0) quote = text.slice(Math.max(0, at - 60), at + delta.fragment.length + 60);
  }
  return {
    // The client's `turn_id` for an OWNER turn is the window it was said in.
    turn_id: String(window?.window_id || ""),
    quote: mirrorClean(quote, 240),
    occurrences: Number(delta.occurrences ?? 0),
  };
}

/**
 * Can this deployment carry a turn to a speaker at all?
 *
 * Deliberately pessimistic, and deliberately not a guess about the GPU. Warmth
 * is a LATENCY question the 202 contract already answers honestly; this is a
 * CONFIGURATION question, and answering it optimistically costs the owner a
 * round trip that ends in a 503 they will read as their clone failing.
 */
function voiceRouteState() {
  if (!String(process.env.AZURE_OPEN_VOICE_ORIGIN || "")) {
    return { canVoice: false, reason: "voice_route_unconfigured" };
  }
  if (!String(process.env.OPEN_VOICE_HMAC_SECRET || "")) {
    return { canVoice: false, reason: "voice_route_unconfigured" };
  }
  return { canVoice: true, reason: "" };
}

/**
 * Assemble, store and wire one clone turn.
 *
 * Wrapped in its own try/catch for the same reason `scoreAndSelect` is: the
 * personality loop and the caption rail are independent of the clone's reply,
 * and a reply failure must never cost the owner the transcript, the chips and
 * the fidelity numbers that same window earned. A failure here is a NAMED
 * absent reason on a 200, never a 500 that loses all four.
 */
async function cloneTurnFor(db, ownerUserId, replicaId, sessionId, window, windows, askBlock = "") {
  const route = voiceRouteState();
  const absent = (reason) => ({ turn: null, reason, canVoice: false, voiceAbsentReason: "", asked: false });
  try {
    // Owner-scoped in SQL, both of them. A caller who does not own this replica
    // never reached here (`resolveMirrorSession` refused), and if the predicate
    // above were ever widened these two would still return nothing.
    const [sheetRow, priorTurns] = await Promise.all([
      mirrorReplyAgent(db, ownerUserId, replicaId),
      listMirrorTurns(db, ownerUserId, replicaId, sessionId),
    ]);

    // The rolling call MINUS the window being answered — that one is
    // `latestText`, and including it twice would show the clone the owner's
    // last line as both history and prompt.
    const history = mirrorReplyHistory(
      windows.filter((w) => String(w.window_id) !== String(window.window_id)),
      priorTurns,
    );

    const assembled = await assembleMirrorReply({
      sheetRow,
      history,
      latestText: String(window.transcript || ""),
      // Empty on a calibration call, which is why that lane's bytes do not
      // move. On an interview it is the note about what to ask, spliced into
      // the one prompt position the compiler leaves open.
      askBlock,
    });
    if (!assembled.ok) return absent(assembled.reason);

    const row = await recordMirrorTurn(db, ownerUserId, replicaId, sessionId, {
      windowId: window.window_id,
      text: assembled.text,
      assembledChars: assembled.assembledChars,
      sheetSource: assembled.sheetSource,
      sheetId: assembled.sheetId,
      agentSlug: assembled.agentSlug,
      gateApplied: assembled.gate.applied,
      gateFindings: assembled.gate.findings,
    });
    // No row means the window was not this owner's or the session closed
    // between the ASR call and now. Both are real, both are transient, and
    // neither is "the clone had nothing to say".
    if (!row) return absent("clone_reply_failed");

    return {
      turn: wireTurn(row, { canVoice: route.canVoice, voiceAbsentReason: route.reason }),
      reason: "",
      canVoice: route.canVoice,
      voiceAbsentReason: route.reason,
      // A question counts as ASKED only when a turn carrying it actually landed
      // as a row. Counting it when the block was built would count questions a
      // failed assembly never asked, and `questions_asked` is a number the
      // studio prints beside `answers_captured`.
      asked: Boolean(askBlock) && Boolean(assembled.asked),
    };
  } catch {
    return absent("clone_reply_failed");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// THE INTERVIEW MODE — WS-R5
// ─────────────────────────────────────────────────────────────────────────
//
// A Mirror Call has two modes and they differ in ONE thing: whether the clone's
// turn carries a note about what to ask. Everything else — the transport, the
// consent freeze, the window table, the ASR lane, the mine, the chip rail, the
// reply assembler, the synthesis path — is the same code running unchanged.
// That is deliberate and it is the reason this section is short: a second call
// lane would be `mirror-call-reply-is-the-one-door` reopened, and the interview
// is the mode where it would matter most, because the owner is answering
// questions ABOUT THEMSELVES and a second assembler would be collecting that
// under rules nobody re-checked.
//
// ── THE CLONE STILL DOES NOT SPEAK FIRST ────────────────────────────────
// The interview does not open by talking. The owner says something (anything),
// and the clone's answer to that window carries the first question. This is not
// a compromise for the sake of a state machine: `clone-initiative-record-has-no-
// absence` is the law, a `WINDOW_RESULT` is the only event that can produce a
// clone caption, and an interview that opened by speaking would be the one lane
// in this product where the clone starts a conversation with a person.
//
// ── WHICH QUESTION IS OUTSTANDING, WITHOUT A COLUMN FOR IT ──────────────
// Gaps are asked in rank order, so `gaps[answers_captured]` IS the outstanding
// question and `questions_asked > answers_captured` IS "one is outstanding".
// Two counters and an ordered list, rather than a `current_gap_id` column that
// could disagree with them. A derived answer that cannot drift beats a stored
// one that can — `last-message-wins-cross-tab`'s lesson, one field instead of
// three.
//
// ── AND WHAT IT REFUSES TO CLAIM ────────────────────────────────────────
// `mirror-reference-accumulation-was-inert`: interview answers grow the SOURCE
// SET. They do not change the voice, they do not change the persona, and
// nothing in this section writes a sheet field, selects a conditioning window
// or queues a fine-tune. The whole output of an interview is consented sources
// plus two honest counts.

/** Has this interview run its twenty minutes? Computed from the row's own
 *  `started_at` rather than from a client clock, for the reason every deadline
 *  in this repo is server-side: a client that wants a longer interview should
 *  not be able to have one by lying about the time. */
function interviewExpired(interview, now = Date.now()) {
  const started = Date.parse(String(interview?.started_at || ""));
  if (!Number.isFinite(started)) return false;
  return now - started >= INTERVIEW_LENGTH_MS;
}

/** `validityOverlaps`, from the engine bundle, exactly as `api/consolidate.js`
 *  reaches it and for the same stated reason: a second definition of "do these
 *  intervals overlap" is the mirrored-logic mistake that file already names.
 *
 *  A missing bundle returns null, `buildInterviewGaps` reports
 *  `detectors.contradiction === false`, and the studio renders that. It does
 *  NOT silently produce a gap list with no contradictions in it, which would be
 *  indistinguishable from an archive that has none. */
async function validityOverlapsFn() {
  const mod = await import("./_engine.gen.js").catch(() => null);
  return typeof mod?.validityOverlaps === "function" ? mod.validityOverlaps : null;
}

/** Read everything, rank the gaps. Owner-scoped in SQL by `readInterviewInputs`;
 *  pure from there down. */
async function gapsFor(db, ownerUserId, replicaId) {
  const [inputs, overlaps] = await Promise.all([
    readInterviewInputs(db, ownerUserId, replicaId),
    validityOverlapsFn(),
  ]);
  return buildInterviewGaps(inputs, { overlaps });
}

/** What the wire carries about an interview. Counts and topics, never a
 *  question: the question text does not exist as a stored object anywhere in
 *  this feature, and a payload that carried one would be the first place it
 *  could be copied out of (`recited-prompt`). */
function wireInterview(interview, model = null) {
  if (!interview) return null;
  const gaps = Array.isArray(interview.gaps) ? interview.gaps : [];
  return {
    interview_id: interview.interview_id,
    started_at: interview.started_at,
    ended_at: interview.ended_at,
    length_ms: INTERVIEW_LENGTH_MS,
    expired: interviewExpired(interview),
    questions_asked: interview.questions_asked,
    answers_captured: interview.answers_captured,
    // The gap list, with the shapes but without a rendered question. `topic`
    // and `why` are what the studio shows; `shape` rides along for anyone
    // reading the payload and is notes, not lines.
    gaps: gaps.map((gap, index) => ({
      gap_id: gap.gap_id,
      kind: gap.kind,
      topic: gap.topic,
      evidence_count: gap.evidence_count,
      why: gap.why,
      shape: gap.shape,
      shape_hash: gap.shape_hash,
      rank: gap.rank ?? index + 1,
      answered: index < Number(interview.answers_captured ?? 0),
    })),
    // WHICH DETECTORS COULD RUN. Present on every payload that carries a gap
    // list, because a gap list is only readable next to what produced it.
    detectors: model?.detectors ?? null,
    inputs_present: model?.inputs_present ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// ops
// ─────────────────────────────────────────────────────────────────────────

async function opCreate(db, ownerUserId, body) {
  // Two modes, one call. Anything that is not the interview is a calibration
  // call, and an unknown value is NOT an error: a client from a future build
  // asking for a mode this deployment does not have should get the call it can
  // have, with `mode` on the response saying which it got.
  const mode = String(body?.mode || "calibrate") === "interview" ? "interview" : "calibrate";
  const session = await openMirrorSession(db, ownerUserId, body.replica_id);
  // ONE answer for "not yours", "does not exist", "revoked" and "consent is not
  // on file" — api/_teachersheet.js's discipline. A caller that could tell them
  // apart could enumerate other people's replicas.
  if (!session) return { status: 409, body: { error: "mirror_session_unavailable" } };

  // The gap list is built ONCE and frozen onto the interview row. See migration
  // 075's header: an interview whose fourth question came from a different
  // ranking than its first is an interview nobody can reproduce.
  let interview = null;
  let model = null;
  if (mode === "interview") {
    model = await gapsFor(db, ownerUserId, session.replica_id);
    interview = await openInterviewSession(
      db, ownerUserId, session.session_id, model.opening,
    );
  }

  const { fidelity } = await fidelityFor(db, ownerUserId, session.replica_id, session.session_id);
  const gpu = gpuState();
  return {
    status: 201,
    body: {
      session: {
        session_id: session.session_id,
        replica_id: session.replica_id,
        contract: MIRROR_CALL_CONTRACT,
        // The mode the server actually opened, never the one that was asked
        // for. An interview whose gap model could not be built opens as a
        // calibration call and says so rather than pretending to interview.
        mode: interview ? "interview" : "calibrate",
        interview: wireInterview(interview, model),
        // 'warming' unless this process has SEEN the broker answer. The studio
        // shows the honest 2–3 minute wait rather than a progress bar over a
        // number nobody measured.
        state: gpu.warm ? "live" : "warming",
        gpu,
        window_ms_max: MIRROR_WINDOW_MAX_MS,
        fidelity,
        ops: [...MIRROR_CALL_OPS],
        // Beyond the contract, and load-bearing: the studio can render why the
        // voice loop is not growing without guessing.
        consent: {
          scopes: session.consent_scopes,
          reference_consent: session.reference_consent,
          reference_scope: session.reference_scope,
        },
        transport: MIRROR_CALL_TRANSPORT,
      },
    },
  };
}

async function opIngestWindow(db, ownerUserId, req) {
  // The declared transport deviation, answered loudly rather than by a 400 the
  // client would read as a bad window. See MIRROR_CALL_TRANSPORT.
  const contentType = String(req.headers?.["content-type"] || "");
  if (contentType.includes("multipart/form-data")) {
    return {
      status: 415,
      body: { error: "mirror_ingest_expects_source_handle", details: MIRROR_CALL_TRANSPORT },
    };
  }
  const body = req.body || {};
  const session = await resolveMirrorSession(db, ownerUserId, body.session_id);
  if (!session) return { status: 404, body: { error: "mirror_session_unavailable" } };
  if (session.state !== "open") return { status: 409, body: { error: "mirror_session_not_open" } };
  const replicaId = session.replica_id;
  const sessionId = session.session_id;
  const input = mirrorWindowInput(body);

  // The row exists BEFORE the transcription is attempted. A window that dies
  // mid-ASR must leave a visible pending row, never nothing — a missing row is
  // indistinguishable from a window nobody sent.
  const pending = await recordMirrorWindow(db, ownerUserId, replicaId, sessionId, input);
  if (!pending) return { status: 409, body: { error: "mirror_window_rejected", details: { seq: input.seq } } };

  let failureCode = "";
  let asr = null;
  let bytes = null;
  try {
    const ref = input.sourceId
      ? await mirrorWindowAudioRef(db, ownerUserId, replicaId, input.sourceId)
      : null;
    if (!ref) {
      failureCode = input.sourceId ? "source_not_finalized" : "no_audio_reference";
    } else {
      // Read only for a window that is a CANDIDATE and therefore has a score to
      // earn. The transcriber does its own read; a second read for every window
      // would buy latency inside a live call for nothing.
      if (pending.reference_admitted) {
        const object = await readPrivateReplicaObject({
          storageBucket: ref.storageBucket,
          objectPath: ref.storagePath,
        }, { maxBytes: 33_554_432 });
        bytes = object?.body ?? null;
      }
      const provider = configuredLiveAsrProvider();
      if (!provider) failureCode = "asr_provider_unavailable";
      else {
        const result = await provider.transcribe(
          { ...ref, durationMs: input.durationMs },
          body.lang_hint || "hi-IN",
        );
        // The sync lane returns one turn per window — one speaker, by
        // construction. Joined rather than indexed so a provider that DOES
        // diarize contributes every word.
        const text = result.turns.map((t) => t.text).join(" ").trim();
        if (!text) failureCode = "asr_empty_transcript";
        else asr = { transcript: text, provider: result.provider, model: result.model };
      }
    }
  } catch (error) {
    // A transcription failure is a DROPPED WINDOW, not a failed request. The
    // call is still running and the owner is still talking; 500ing would lose
    // the window AND the honesty about having lost it.
    failureCode = String(error?.code || "asr_failed").slice(0, 64);
  }

  const settled = await settleMirrorWindow(db, ownerUserId, replicaId, pending.window_id,
    asr ? asr : { failureCode: failureCode || "asr_failed" });
  const window = settled || pending;

  // THE VOICE LOOP. Nothing happens unless the window was ADMITTED, which needs
  // consent plus a measured owner-voice verdict — so today this is a no-op on
  // every replica, and the withheld reasons say why.
  let selection = null;
  try {
    selection = await scoreAndSelect(db, ownerUserId, replicaId, sessionId, window, bytes);
  } catch {
    // A scoring failure must never fail the ingest: the personality loop is
    // independent of the voice loop, and the window stays unscored and visible.
    selection = null;
  }

  const windows = await listMirrorWindows(db, ownerUserId, replicaId, sessionId);
  const mined = asr
    ? await mineAndPropose(db, ownerUserId, replicaId, sessionId, session, windows)
    : { proposed: [], stats: null, guarded: [], corpus: null };

  // ── THE INTERVIEW, IF THIS CALL IS ONE ─────────────────────────────────
  //
  // Ordered exactly like this on purpose: the owner's window ANSWERS the
  // outstanding question BEFORE the next one is chosen. The other order would
  // ask question n+1 while question n was still outstanding, and then the
  // answer that arrived next would be filed against the wrong gap — an answer
  // bound to a question the person was not answering, which is worse than no
  // answer at all because it looks like data.
  const interviewBefore = await getInterviewByMirrorSession(db, ownerUserId, sessionId).catch(() => null);
  let interview = interviewBefore;
  let askBlock = "";
  let answer = null;
  if (interview) {
    const gaps = Array.isArray(interview.gaps) ? interview.gaps : [];
    // Answer the outstanding question. `asr` null means the window dropped, and
    // a dropped window is an ABSENCE, not an answer — filing one would be
    // recording that the owner answered something they may never have said.
    if (asr && interview.questions_asked > interview.answers_captured) {
      const outstanding = gaps[interview.answers_captured];
      if (outstanding) {
        answer = await recordInterviewAnswer(db, ownerUserId, interview.interview_id, {
          gapKind: outstanding.kind,
          topic: outstanding.topic,
          questionShapeHash: outstanding.shape_hash,
          // The SAME source the window rode in on. There is no second capture
          // and no second upload lane: the interview's answer audio IS the
          // Mirror Call window's audio, stamped `purpose='interview'` so
          // retrieval can prefer it for register.
          sourceId: window.source_id || null,
          windowId: window.window_id,
        }).catch(() => null);
        // Re-read rather than increment in JS. The write is idempotent (a
        // retried window against an answered gap inserts nothing), so the
        // counter after the write is the only number that is true.
        interview = await getInterviewByMirrorSession(db, ownerUserId, sessionId).catch(() => interview);
      }
    }
    // Choose the next question. Stops at twenty minutes and stops when the five
    // gaps are done, and both stops are the interview ending itself rather than
    // running until somebody gets bored.
    const next = interviewExpired(interview) ? null : gaps[interview.answers_captured];
    if (next) askBlock = renderInterviewAsk(next);
  }

  // THE CLONE'S REPLY. Attempted only when the owner's window became words:
  // "the clone does not answer nothing" is WS-Y's own comment on the `turn`
  // field, and `clone-initiative-record-has-no-absence` is the law behind it —
  // a dropped window is an ABSENCE, and an absence is not an input the reply
  // predicate has. A clone that answered a silence would be answering something
  // nobody said.
  const reply = asr
    ? await cloneTurnFor(db, ownerUserId, replicaId, sessionId, window, windows, askBlock)
    : { turn: null, reason: "owner_window_dropped", canVoice: false, voiceAbsentReason: "", asked: false };

  // Counted only after the turn carrying it actually landed as a row. A
  // question counted at build time would be a question the studio prints as
  // asked and the owner never heard.
  if (interview && reply.asked) {
    interview = await markQuestionAsked(db, ownerUserId, interview.interview_id).catch(() => interview);
  }

  const { fidelity, pool } = await fidelityFor(db, ownerUserId, replicaId, sessionId);
  const coverage = mirrorCoverage(windows);

  return {
    status: 200,
    body: {
      window: {
        window_id: window.window_id,
        seq: Number(window.seq),
        // Non-null exactly when the window did not become owner words.
        dropped: window.asr_state === "dropped"
          ? { reason: dropReason(window.failure_code), failure_code: window.failure_code }
          : null,
        owner_transcript: window.asr_state === "transcribed" ? String(window.transcript || "") : "",
        turn: reply.turn,
        // Present EXACTLY when `turn` is null, and drawn from a frozen
        // vocabulary. WS-Y's normalizer refuses a payload carrying both a drop
        // and a turn; this is the other side of that rule — a null turn with no
        // reason is a clone that went quiet for a cause nobody can name, which
        // is the state `no-silent-truncation` exists to make unrepresentable.
        ...(reply.turn ? {} : { turn_absent_reason: reply.reason }),
        deltas: wireDeltas(mined.proposed),
        fidelity,
        reference: referenceBlock(window, pool),
        // Beyond the contract:
        coverage,
        candidates: pool,
        conditioning_changed: Boolean(selection),
        corpus: mined.corpus,
        // Fragments the recited-prompt guard refused, so a mine that dropped
        // everything is distinguishable from a transcript with nothing in it.
        guarded: mined.guarded,
        measured: mined.stats
          ? {
            tokens: mined.stats.tokens,
            turns: mined.stats.totalTurns,
            code_switch_token_ratio: mined.stats.codeSwitch.tokenRatio,
          }
          : null,
        // WS-R5, and null on every calibration call. `answer_captured` is the
        // honest per-window fact: an interview window that answered nothing
        // (because nothing was outstanding, or because the write conflicted
        // with a retry) says so rather than leaving the studio to infer it from
        // a count that did not move.
        interview: interview
          ? {
            ...wireInterview(interview),
            answer_captured: answer ? { topic: answer.topic, audio_kept: answer.audio_kept } : null,
            // Whether THIS turn carried a question. The question itself is
            // inside `turn.text` and nowhere else.
            asked_this_turn: Boolean(reply.asked),
          }
          : null,
      },
    },
  };
}

async function opDeltaAction(db, ownerUserId, body) {
  const session = await resolveMirrorSession(db, ownerUserId, body.session_id);
  if (!session) return { status: 404, body: { error: "mirror_session_unavailable" } };
  const replicaId = session.replica_id;
  const sessionId = session.session_id;
  const deltaId = mirrorUuid(body.delta_id, "mirror_delta_id_invalid");
  const decision = mirrorDecision(body.action ?? body.decision);

  const pendingDelta = await getProposedMirrorDelta(db, ownerUserId, replicaId, sessionId, deltaId);
  if (!pendingDelta) return { status: 409, body: { error: "mirror_delta_not_actionable" } };

  const { row } = await decideMirrorDelta(
    db, ownerUserId, replicaId, sessionId, deltaId, decision, { pendingDelta },
  );
  if (!row) {
    // The delta is still un-actioned. Either the draft moved between the read
    // and the write, or the session closed. Both are retryable and both are
    // NAMED, because "accepted but nothing happened" is the one answer this
    // endpoint may never give — and the client treats this response as the
    // authority on whether the chip landed.
    return { status: 409, body: { error: "mirror_delta_apply_conflict", details: { delta_id: deltaId } } };
  }
  return { status: 200, body: { delta: wireDelta(row) } };
}

async function opTurnFeedback(db, ownerUserId, req) {
  const contentType = String(req.headers?.["content-type"] || "");
  if (contentType.includes("multipart/form-data")) {
    return { status: 415, body: { error: "mirror_feedback_expects_json", details: MIRROR_CALL_TRANSPORT } };
  }
  const body = req.body || {};
  const session = await resolveMirrorSession(db, ownerUserId, body.session_id);
  if (!session) return { status: 404, body: { error: "mirror_session_unavailable" } };
  const replicaId = session.replica_id;
  const sessionId = session.session_id;

  // The client sends `rating` (up/down) plus an optional note and an optional
  // re-recorded correction. A correction present makes the verdict a
  // 'rephrase', which is a stronger signal than a thumb and is stored as one.
  const hasCorrection = Boolean(body.correction_source_id || body.note);
  const input = mirrorFeedbackInput({
    turn_ref: body.turn_id ?? body.turn_ref,
    verdict: hasCorrection && body.rating !== "up" ? "rephrase" : (body.rating ?? body.verdict),
    rephrase_text: body.note ?? body.rephrase_text,
  });
  const row = await recordMirrorFeedback(db, ownerUserId, replicaId, sessionId, input);
  if (!row) return { status: 409, body: { error: "mirror_session_not_open" } };

  const chip = await proposeMirrorDelta(db, ownerUserId, replicaId, sessionId, {
    kind: "feedback_note",
    fragment: `${input.verdict}:${input.turnRef}`.slice(0, 64),
    targetField: "",
    // origin='judgement', in its own column, never averaged with the mined
    // signal. The owner is judging a clone of THEMSELVES: a thumbs-up rewards
    // "sounds like me as I would LIKE to sound", and the miner — which reads
    // what was actually said — is the only thing pulling the other way.
    // Keeping them apart is what makes that drift a number someone can look at.
    origin: "judgement",
    occurrences: 0,
    corpusTokens: 0,
    evidence: { verdict: input.verdict, turn_ref: input.turnRef, has_rephrase: Boolean(input.rephraseText) },
    // A judgement cites the turn it judged. It is a citation of the CLONE's
    // turn, not of the owner's words, and it carries no quote for that reason:
    // quoting the clone back at the owner as evidence of the owner's own style
    // is the sycophancy loop in one field.
    citation: { turn_id: input.turnRef, quote: "", occurrences: 0 },
    citedWindows: [],
  });
  return {
    status: 201,
    body: { feedback_id: row.feedback_id, deltas: chip ? wireDeltas([chip]) : [] },
  };
}

async function opEnd(db, ownerUserId, body) {
  const session = await resolveMirrorSession(db, ownerUserId, body.session_id);
  if (!session) return { status: 404, body: { error: "mirror_session_unavailable" } };
  const replicaId = session.replica_id;
  const sessionId = session.session_id;
  // WS-R5. Closed BEFORE the mirror session, because the interview row is what
  // the summary below is built from and an interview left open on an ended call
  // is a row nothing will ever close.
  const interviewOpen = await getInterviewByMirrorSession(db, ownerUserId, sessionId).catch(() => null);
  const interviewEnded = interviewOpen
    ? (await endInterviewSession(db, ownerUserId, interviewOpen.interview_id).catch(() => null)) || interviewOpen
    : null;

  const ended = await endMirrorSession(db, ownerUserId, replicaId, sessionId);
  if (!ended) return { status: 409, body: { error: "mirror_session_not_open" } };

  const [tally, deferred, { fidelity }] = await Promise.all([
    mirrorDeltaTally(db, ownerUserId, replicaId, sessionId),
    listUnactionedMirrorDeltas(db, ownerUserId, replicaId, sessionId),
    fidelityFor(db, ownerUserId, replicaId, sessionId),
  ]);
  return {
    status: 200,
    body: {
      call: {
        session_id: sessionId,
        ended_at: new Date().toISOString(),
        // Chips nobody actioned. They go to the ordinary review queue — never
        // onto the sheet. NOTHING in the end path writes a sheet byte, and
        // that absence is the point.
        deferred: wireDeltas(deferred),
        accepted_count: tally.accepted,
        rejected_count: tally.rejected,
        finetune: {
          queued: Boolean(ended.finetune_job_id),
          job_id: ended.finetune_job_id || null,
          // A reason whenever it was NOT queued. "No consented candidate audio"
          // is an honest answer; a fake progress bar is not.
          reason: ended.finetune_job_id
            ? null
            : "no consented owner-verified candidate audio in this call",
          lane: "per_expert_adapter",
          note: "queued only; no runner exists in this repo yet",
          reference_windows: Number(ended.finetune_reference_windows ?? 0),
          reference_ms: Number(ended.finetune_reference_ms ?? 0),
        },
        fidelity,
        // Beyond the contract:
        applied_count: tally.applied,
        reembedding: {
          jobs: Number(ended.reembedding_jobs ?? 0),
          queue: "vy_replica_processing_job step=voice_quality",
        },
        // WS-R5. What the interview learned, and what the next one would ask.
        // Null on a calibration call.
        interview: interviewEnded
          ? {
            ...wireInterview(interviewEnded),
            answers: await listInterviewAnswers(db, ownerUserId, interviewEnded.interview_id).catch(() => []),
            // The topics that came back with audio, and the ones that did not.
            // Two lists rather than one count, because "we asked and lost it"
            // and "we never got there" are different things to tell an owner.
            learned: (Array.isArray(interviewEnded.gaps) ? interviewEnded.gaps : [])
              .slice(0, Number(interviewEnded.answers_captured ?? 0))
              .map((gap) => ({ kind: gap.kind, topic: gap.topic })),
            next_would_ask: (Array.isArray(interviewEnded.gaps) ? interviewEnded.gaps : [])
              .slice(Number(interviewEnded.answers_captured ?? 0))
              .map((gap) => ({ kind: gap.kind, topic: gap.topic, why: gap.why })),
            // The one thing an owner must not be allowed to infer wrongly from
            // a screen full of new material. `mirror-reference-accumulation-was-
            // inert`: the answers grew the SOURCE set and nothing else moved.
            effect: {
              sources_added: Number(interviewEnded.answers_captured ?? 0),
              voice_changed: false,
              persona_changed: false,
              note: "your answers were saved as new material. Nothing about your AI changed during this call.",
            },
          }
          : null,
      },
    },
  };
}

/**
 * `interview_gaps` — the preview behind "Start the interview".
 *
 * A GET on a replica, not on a session: the studio has to be able to show what
 * the interview would ask BEFORE anyone opens a call, and opening a call to
 * find out would spend a consent freeze and an open-session slot on a preview.
 *
 * It is the same pure function the call uses, over the same reads, so the list
 * the owner sees on the button is the list the interview opens with — unless
 * the archive changed in between, which is exactly when it should differ.
 */
async function opInterviewGaps(db, ownerUserId, replicaIdValue) {
  const rid = mirrorUuid(replicaIdValue, "mirror_replica_id_invalid");
  const owned = await db(
    `select r.replica_id from vy_replica r
      where r.replica_id = $1::uuid and r.owner_user_id = $2::uuid
        and r.lifecycle not in ('revoked','purging') limit 1`,
    [rid, ownerUserId],
  );
  // ONE answer for "not yours", "gone" and "revoked".
  if (!owned[0]) return { status: 404, body: { error: "mirror_session_unavailable" } };
  const model = await gapsFor(db, ownerUserId, rid);
  return {
    status: 200,
    body: {
      interview: {
        length_ms: INTERVIEW_LENGTH_MS,
        opening_gaps: INTERVIEW_OPENING_GAPS,
        gaps: model.opening.map((gap) => ({
          gap_id: gap.gap_id,
          kind: gap.kind,
          topic: gap.topic,
          evidence_count: gap.evidence_count,
          why: gap.why,
          rank: gap.rank,
        })),
        total_gaps: model.gaps.length,
        skipped_answered: model.skipped_answered,
        // Rendered beside the list, always. A short list because the archive is
        // complete and a short list because a detector could not run are
        // different facts and the studio has to be able to say which.
        detectors: model.detectors,
        inputs_present: model.inputs_present,
      },
    },
  };
}

async function opStatus(db, ownerUserId, sessionIdValue) {
  const session = await resolveMirrorSession(db, ownerUserId, sessionIdValue);
  if (!session) return { status: 404, body: { error: "mirror_session_unavailable" } };
  const { fidelity } = await fidelityFor(db, ownerUserId, session.replica_id, session.session_id);
  const gpu = gpuState();
  return {
    status: 200,
    body: {
      session: {
        state: session.state === "open" ? (gpu.warm ? "live" : "warming") : "ended",
        gpu,
        fidelity,
      },
    },
  };
}

/**
 * `turn_voice` — the clone speaking, in the owner's own cloned voice.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WHAT THIS FUNCTION DOES NOT DO, WHICH IS MOST OF IT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * It does not sign anything, wake anything, verify an owner's consent scopes,
 * prepend a disclosure, embed a watermark, open a ledger row or decide what a
 * cold start looks like. All of that is `api/_voice/preview-panel.js` and the
 * fence it authorizes through, reached with the SAME collaborators
 * `api/voice-preview.js` wires — the same provider, the same protection
 * adapters, the same ledger, the same warmth registry.
 *
 * That is not laziness, it is the brief: a second path to a cloned voice is a
 * second place the disclosure prefix can be dropped, and `disclosure-announces-
 * the-clone` is already on the books as a defect that a fork would have made
 * invisible instead of merely awkward. `evals/mirrorcallreply.mjs` §5 keeps a
 * FORKED synthesis path beside the real one and fails unless the fork is caught
 * — the negative control that proves the reuse is load-bearing.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * THE ONE THING IT DOES ADD
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The binding. `text` comes from `getMirrorTurn` — a row the SERVER wrote after
 * the SERVER assembled the reply — and there is no branch that reads a string
 * from the query, the body or a header. The studio cannot make the clone say
 * anything the server did not author, which is the rule
 * `src/studio/mirrorCallApi.ts` states and this is where it is true.
 *
 * `genome_version` is resolved from the database for the same reason: the
 * preview panel gets it from a screen, a call has no screen, and accepting it
 * from the caller would let a client choose which version of a person's voice
 * speaks.
 */
async function opTurnVoice(db, ownerUserId, query, makeDeps) {
  const session = await resolveMirrorSession(db, ownerUserId, query?.session_id);
  if (!session) return { status: 404, body: { error: "mirror_session_unavailable" } };
  const replicaId = session.replica_id;
  const sessionId = session.session_id;

  const turn = await getMirrorTurn(db, ownerUserId, sessionId, query?.turn_id);
  // ONE answer for "no such turn", "not in this session" and "not yours" —
  // `api/_teachersheet.js`'s discipline. A caller that could tell them apart
  // could enumerate another owner's calls.
  if (!turn) return { status: 404, body: { error: "mirror_turn_unavailable" } };

  const route = voiceRouteState();
  if (!route.canVoice) {
    await noteMirrorTurnVoice(db, ownerUserId, sessionId, turn.turn_id, {
      state: "refused", failureCode: route.reason,
    }).catch(() => null);
    // 503, not 501. The route is served and the deployment is not configured —
    // WS-Y reads 501 as "the seam is not wired" and falls back to captions
    // permanently, which is the wrong permanence for a missing env var.
    return { status: 503, body: { state: "error", error: "open_voice_origin_required" } };
  }

  // Belt-and-braces over `capMirrorReply`, which already caps assembly at this
  // width. If the two ever disagree the honest answer is a NAMED refusal, not a
  // clip of the first sentence — a voice that stops mid-thought and says
  // nothing about it is the silent-truncation shape with a speaker on it.
  if (turn.text.length > MIRROR_REPLY_TEXT_MAX) {
    await noteMirrorTurnVoice(db, ownerUserId, sessionId, turn.turn_id, {
      state: "refused", failureCode: "turn_longer_than_synthesis_cap",
    }).catch(() => null);
    return { status: 413, body: { state: "error", error: "mirror_turn_text_too_large" } };
  }

  const genomeVersion = await mirrorDraftGenomeVersion(db, ownerUserId, replicaId);
  if (genomeVersion === null) {
    await noteMirrorTurnVoice(db, ownerUserId, sessionId, turn.turn_id, {
      state: "refused", failureCode: "voice_genome_absent",
    }).catch(() => null);
    return { status: 409, body: { state: "error", error: "mirror_turn_voice_no_genome" } };
  }

  // The deps are built HERE and not by the caller, because building them
  // constructs the HMAC provider, which fails closed when the origin or the
  // secret is absent. Constructing it before the route check above would turn
  // an honest, named 503 into a 500 that says nothing.
  let result;
  try {
    result = await handleVoicePreviewPanel(
      {
        op: "preview",
        replica_id: replicaId,
        genome_version: genomeVersion,
        // THE SERVER'S OWN WORDS. See the header.
        text: turn.text,
        language_id: String(query?.language_id || "en").toLowerCase(),
      },
      makeDeps(),
    );
  } catch (error) {
    const code = String(error?.code || "");
    const configured = code === "open_voice_origin_required" || code === "open_voice_origin_invalid" ||
      code === "open_voice_hmac_secret_required";
    await noteMirrorTurnVoice(db, ownerUserId, sessionId, turn.turn_id, {
      state: "refused", failureCode: configured ? code : "voice_preview_failed",
    }).catch(() => null);
    return configured
      ? { status: 503, body: { state: "error", error: code } }
      : { status: 500, body: { state: "error", error: "voice_preview_failed" } };
  }

  if (result.kind === "audio") {
    await noteMirrorTurnVoice(db, ownerUserId, sessionId, turn.turn_id, {
      state: "spoken",
      generationId: result.headers?.["X-Vyakti-Generation"] || null,
    }).catch(() => null);
    return { status: result.status, audio: result.body, headers: result.headers, turnId: turn.turn_id };
  }

  // 202 is the warming contract, passed through unchanged including
  // `Retry-After`. The studio's copy for it is the same copy the preview panel
  // produces because it is literally the same body.
  await noteMirrorTurnVoice(db, ownerUserId, sessionId, turn.turn_id, {
    state: result.status === 202 ? "warming" : "refused",
    failureCode: result.status === 202 ? "" : String(result.body?.error || "voice_preview_failed"),
  }).catch(() => null);
  return { status: result.status, body: result.body, headers: result.headers };
}

/** The collaborators `handleVoicePreviewPanel` takes. Identical to
 *  `api/voice-preview.js`'s, assembled in one place so a change to the real
 *  wiring cannot reach one route and miss the other. */
function voicePanelDeps(db, ownerUserId, signal) {
  const provider = createOpenChatterboxPreviewProvider();
  const protection = createProductionProtectionAdapters({ db });
  return {
    origin: process.env.AZURE_OPEN_VOICE_ORIGIN,
    warmth: voiceWarmth,
    traceId: `mirror_${randomUUID().replaceAll("-", "")}`,
    signal,
    provider,
    authorize: (input) => beginOwnedVoicePreview(db, ownerUserId, input),
    markFailed: (generationId, error) => markVoicePreviewFailed(db, ownerUserId, generationId, error),
    readObject: (locator) => readPrivateReplicaObject(locator, {
      maxBytes: 20 * 1024 * 1024,
      timeoutMs: 30_000,
    }),
    protect: (input) => protectReplicaStream({
      ...input,
      adapters: Object.freeze({ ...protection, ledger: createNeonVoicePreviewLedger(db) }),
    }),
  };
}

async function opDeltas(db, ownerUserId, sessionIdValue) {
  const session = await resolveMirrorSession(db, ownerUserId, sessionIdValue);
  if (!session) return { status: 404, body: { error: "mirror_session_unavailable" } };
  const rows = await listMirrorDeltas(db, ownerUserId, session.replica_id, session.session_id);
  return { status: 200, body: { deltas: wireDeltas(rows) } };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "GET or POST only" });
  }
  const op = String(req.query?.op || req.body?.op || "");

  // The handshake answers before auth is consulted for anything but identity.
  // Its whole job is to make "the route is not deployed" (404) distinguishable
  // from "your session expired" (401) and from "that session id is gone" (404
  // on a real op) — three states that all arrive as 404 if you only ever call
  // the real ops.
  if (!allow(ipOf(req), "mirror_call", 240)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (op === "contract") {
      return res.status(200).json({
        contract: MIRROR_CALL_CONTRACT,
        ops: [...MIRROR_CALL_OPS],
        // Named, not merely absent. Empty as of WS-AC: every op the client
        // knows about is served here. The field stays because an EMPTY list is
        // a positive statement and an absent field is not.
        unserved_ops: [...MIRROR_CALL_UNSERVED_OPS],
        unserved_reason: {},
        transport: MIRROR_CALL_TRANSPORT,
        limits: {
          window_ms_max: MIRROR_WINDOW_MAX_MS,
          chip_budget_per_min: MIRROR_CHIP_BUDGET_PER_MIN,
          conditioning_truncation_ms: CONDITIONING_S3GEN_MS,
          reply_text_max: MIRROR_REPLY_TEXT_MAX,
        },
        // Beyond the contract. `turn_voice` being SERVED and the deployment
        // being able to reach a GPU are two different facts, and a studio that
        // conflated them would tell the owner their clone is mute when the
        // truth is an unset environment variable. WS-Y's client ignores this;
        // an operator reading a handshake should not have to.
        voice_route: voiceRouteState(),
        // The complete vocabulary of `turn_absent_reason`, published so a
        // client can render an unknown value as unknown rather than as blank.
        turn_absent_reasons: [...MIRROR_TURN_ABSENT_REASONS],
      });
    }

    // A live call posts a window every few seconds plus a chip decision
    // whenever the owner taps. Generous for one call and still bounded — an
    // unbounded ingest lane is an unbounded ASR bill.
    if (!allow(user.id, "mirror_call_user", 600)) return res.status(429).json({ error: "slow_down" });

    if (MIRROR_CALL_UNSERVED_OPS.includes(op)) {
      // 501, not 404: the route exists and this op does not. The client reads
      // both as "seam not wired" and falls back to captions, but an operator
      // reading a log needs them apart.
      return res.status(501).json({ error: `mirror_op_not_served:${op}` });
    }

    let result;
    if (req.method === "GET") {
      if (op === "status") result = await opStatus(q, user.id, req.query?.session_id);
      else if (op === "deltas") result = await opDeltas(q, user.id, req.query?.session_id);
      else if (op === "interview_gaps") result = await opInterviewGaps(q, user.id, req.query?.replica_id);
      else if (op === "turn_voice") {
        // A SECOND, TIGHTER BUCKET. The shared `mirror_call_user` allowance is
        // sized for windows and chip taps, which are cheap; a synthesis is GPU
        // money. Four a minute is the same number `api/voice-preview.js` gives
        // the panel, and a cascade call cannot outrun it — one window at a time
        // means at most one turn every few seconds.
        if (!allow(user.id, "mirror_turn_voice", 4)) {
          return res.status(429).json({ state: "error", error: "slow_down" });
        }
        const aborter = new AbortController();
        req.on?.("aborted", () => aborter.abort(new Error("client_aborted")));
        const deadline = setTimeout(() => aborter.abort(new Error("voice_preview_timeout")), 240_000);
        try {
          result = await opTurnVoice(q, user.id, req.query || {},
            () => voicePanelDeps(q, user.id, aborter.signal));
        } finally {
          clearTimeout(deadline);
        }
        for (const [name, value] of Object.entries(result.headers || {})) res.setHeader(name, value);
        if (result.audio) {
          res.setHeader("Content-Length", String(result.audio.length));
          return res.status(result.status).send(result.audio);
        }
        return res.status(result.status).json(result.body);
      } else return res.status(400).json({ error: "unknown_op" });
    } else if (op === "create") result = await opCreate(q, user.id, req.body || {});
    else if (op === "ingest_window") result = await opIngestWindow(q, user.id, req);
    else if (op === "delta_action") result = await opDeltaAction(q, user.id, req.body || {});
    else if (op === "turn_feedback") result = await opTurnFeedback(q, user.id, req);
    else if (op === "end") result = await opEnd(q, user.id, req.body || {});
    else return res.status(400).json({ error: "unknown_op" });

    return res.status(result.status).json(result.body);
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({
      error: status === 500 ? "mirror_call_failure" : String(error.code || error.message),
      ...(status < 500 && error?.details ? { details: error.details } : {}),
    });
  }
}

export { MirrorCallError };

/** `turn_voice` may sit on a cold GPU. The panel route already carries this
 *  ceiling and the wait shape below it is identical — `dispatchWake` gives up
 *  WAITING at 12 s and answers 202, so the long tail here is a warm synthesis,
 *  not a spinner. */
export const config = { maxDuration: 300 };
