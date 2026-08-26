// One link, one clone — the single-video enrollment lane (Gurukul WS-AD).
//
// The owner's ask, verbatim in intent: "I want to put a link to my 15-minute
// video where I'm teaching something and make the clone from it — and it's
// not necessary that the first 10 seconds will be clear, so handle it. Enable
// this for all accounts so my friends can also test it."
//
// Four requirements, and each maps to a named thing here:
//
//   "a link to my video"        → `parseVideoUrl`, an id and nothing else
//   "make the clone from it"    → extract → rank → promote → transcribe
//   "the first 10 s ... handle" → `rankReferenceWindows`, best window ANYWHERE
//   "for all accounts"          → `_video-enroll/quota.js`, named refusals
//
// ── this is a composition, not a new pipeline ────────────────────────────
// Everything load-bearing here already existed and was built by somebody
// else. `vy_channel_attestation` (WS-S) is the consent artifact and is REUSED
// unchanged — a single video is still audio from a channel, so it is gated by
// the same "this channel is mine" row, with the same revocation and the same
// one-year term. `services/media-extract` does the extraction. The ASR
// registry does the transcript. `api/_teacher-sheet-draft.js` does the sheet
// pass. `beginOwnedVoicePreview`'s fence decides whether the owner may hear
// it. This file adds exactly two things that did not exist: a per-video
// admission with caps, and the window ranking.
//
// ── the ownership check is STRUCTURAL, and it is not ours ────────────────
// Nothing here verifies that the video belongs to the attested channel.
// `services/media-extract` does, from YouTube's own metadata, BEFORE it
// downloads a byte, and refuses `channel_binding_mismatch`. That ordering is
// the whole reason a "paste any link" box is not a downloader: the caller
// cannot express "fetch somebody else's video", because the request carries
// an attested channel key and the service resolves the uploader itself. The
// negative control for this is in `evals/videoenroll.mjs` and it asserts the
// REFUSAL, because a gate that has only ever been tested by things that pass
// is not known to be a gate.
//
// ── what is NOT true of this file today ──────────────────────────────────
// `context/measurements.md#youtube-extraction-blocked-from-azure`: extraction
// from the deployed Azure egress returns `extractor_bot_check` on every
// player client tried (n=10). So the extraction step of this lane, live,
// fails — and it fails with a NAMED state that this file surfaces verbatim
// rather than collapsing into "something went wrong". The rest of the lane
// (ranking, ASR, sheet, promotion) runs on any 16 kHz mono WAV and is reached
// today by the upload lane; it is reached by the LINK lane the moment a
// cookie or proxy lever lands. Building it to fail honestly at one named step
// is the difference between a lane that is waiting for one env var and a lane
// nobody can tell the state of.
import { randomUUID } from "node:crypto";
import { replicaId } from "./_replica.js";
import { channelRef } from "./_channel/contracts.js";
import { rankReferenceWindows, WINDOW_SCORE_SOURCE, WindowScoringError } from "./_video-enroll/windows.js";
import {
  VideoEnrollQuotaError,
  assertVideoEnrollAdmission,
  videoEnrollLimits,
  videoEnrollUsage,
} from "./_video-enroll/quota.js";

export { VIDEO_ENROLL_LIMITS, videoEnrollLimits } from "./_video-enroll/quota.js";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const VIDEO_ENROLL_STATES = Object.freeze([
  "admitted", "extracting", "scoring", "transcribing", "ready", "refused", "failed",
]);

export class VideoEnrollError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

function fail(code, status = 400, details) {
  throw new VideoEnrollError(code, status, details);
}

/**
 * A YouTube watch/short/youtu.be link → an 11-character video id.
 *
 * It returns an ID, never a URL, for the same reason `services/media-extract`
 * accepts one: an id cannot carry a host, a path, a credential or a redirect,
 * so "extract this arbitrary thing" stops being expressible one layer earlier
 * than the service. Playlist and channel parameters are DROPPED rather than
 * rejected — a teacher pastes whatever their phone copied, and refusing a
 * link because it has `&list=` on the end would be a refusal about clipboard
 * hygiene rather than about permission.
 */
export function parseVideoUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) fail("video_url_required", 400);
  if (VIDEO_ID.test(raw)) return raw;
  let url;
  try { url = new URL(raw); } catch { fail("video_url_invalid", 400); }
  if (url.protocol !== "https:" && url.protocol !== "http:") fail("video_url_invalid", 400);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let candidate = "";
  if (host === "youtu.be") {
    candidate = url.pathname.replace(/^\/+/, "").split("/")[0];
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const path = url.pathname.replace(/\/+$/, "");
    if (path === "/watch") candidate = url.searchParams.get("v") || "";
    else {
      const matched = /^\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})$/.exec(path);
      candidate = matched ? matched[1] : "";
    }
  } else {
    fail("video_url_not_youtube", 400);
  }
  if (!VIDEO_ID.test(candidate)) fail("video_url_not_a_video", 400);
  return candidate;
}

function clientRow(row, windows = null) {
  return {
    enrollment_id: row.enrollment_id,
    video_id: row.video_id,
    channel_url: row.channel_url,
    state: row.state,
    failure_code: row.failure_code || null,
    duration_ms: row.duration_ms == null ? null : Number(row.duration_ms),
    audio_bytes: row.audio_bytes == null ? null : Number(row.audio_bytes),
    // PRESENCE, never the id — `clientWatch`'s rule. A studio renders a badge.
    attested: Boolean(row.attestation_id),
    reference_window: row.selected_window_start_ms == null ? null : {
      start_ms: Number(row.selected_window_start_ms),
      end_ms: Number(row.selected_window_start_ms) + Number(row.selected_window_length_ms || 0),
      score: row.selected_window_score == null ? null : Number(row.selected_window_score),
      score_source: row.score_source || WINDOW_SCORE_SOURCE,
    },
    transcript_chars: row.transcript_chars == null ? null : Number(row.transcript_chars),
    created_at: row.created_at,
    ...(windows ? { windows } : {}),
  };
}

/** The receipts row. Every stage's own wall clock, written whether the stage
 *  SUCCEEDED or FAILED, because the cost of a bot check is a real cost and a
 *  cost table that only counts successes understates the lane exactly where
 *  it is going wrong. `measurements.md` gets its per-clone number from here
 *  rather than from an estimate. */
function stageReceipt(stage, startedAt, outcome, extra = {}) {
  return Object.freeze({
    stage,
    outcome,
    elapsed_ms: Math.max(0, Date.now() - startedAt),
    ...extra,
  });
}

/**
 * The whole lane, for one pasted link.
 *
 * Dependencies are INJECTED rather than imported, so `evals/videoenroll.mjs`
 * drives the real control flow with fixture audio and a fake db. That is the
 * same reason `api/_channel-ingest.js` takes a `deps` bag: this environment
 * has neither `NEON_URL` nor `api/_config.js`, so anything wired by import is
 * anything no eval can ever execute (`dead-writers`).
 *
 * @param {Function} db
 * @param {string}   ownerUserId
 * @param {object}   input   { replica_id, video_url, channel_url, attestations }
 * @param {object}   deps    { extractAudio, fetchAudioBytes, diarize, transcribe,
 *                             proposeSheetDraft, promoteReference, attest, now, env }
 */
export async function enrollFromVideo(db, ownerUserId, input, deps = {}) {
  if (!UUID.test(String(ownerUserId || ""))) fail("owner_required", 401);
  const rid = replicaId(input?.replica_id);
  const videoId = parseVideoUrl(input?.video_url);
  const channel = channelRef(input?.channel_url);
  const limits = videoEnrollLimits(deps.env || process.env);
  const receipts = [];
  const enrollmentId = deps.enrollmentId || randomUUID();

  // ── 1. consent, BEFORE anything is counted or fetched ──────────────────
  // The attestation is recorded (or re-confirmed) first, so an owner who has
  // not attested cannot consume a quota slot by trying. Reused verbatim from
  // WS-S: same statements, same receipt construction, same revocation.
  let attestation;
  const attestStarted = Date.now();
  try {
    if (typeof deps.attest !== "function") fail("video_enroll_attestation_unavailable", 503);
    attestation = await deps.attest({
      ownerUserId, replicaId: rid, channel, attestations: input?.attestations,
    });
  } catch (error) {
    receipts.push(stageReceipt("attest", attestStarted, "refused"));
    if (error instanceof VideoEnrollError) throw error;
    // The attestation module's own codes travel through UNCHANGED. "all
    // channel ownership attestations are required" is a sentence the studio
    // renders next to the checkboxes; flattening it here would lose the only
    // information the owner can act on.
    fail(String(error?.code || error?.message || "video_enroll_attestation_denied"),
      Number.isInteger(error?.status) ? error.status : 409);
  }
  if (!attestation?.live) fail("video_enroll_attestation_not_live", 409);
  receipts.push(stageReceipt("attest", attestStarted, "ok"));

  // ── 2. the caps ────────────────────────────────────────────────────────
  const usage = await videoEnrollUsage(db, ownerUserId);
  assertVideoEnrollAdmission({ usage, limits });

  const created = await db(
    `with owned as (
       select replica_id from vy_replica
        where replica_id = ($1)::uuid and owner_user_id = ($2)::uuid
          and subject_mode = 'self'
          and lifecycle not in ('revoked','purging')
     )
     insert into vy_video_enrollment
       (enrollment_id, replica_id, owner_user_id, video_id, channel_url, provider,
        attestation_id, state, score_source)
     select ($3)::uuid, owned.replica_id, ($2)::uuid, $4, $5, 'youtube',
            ($6)::uuid, 'extracting', $7
       from owned
     on conflict (owner_user_id, video_id, enrollment_day) do nothing
     returning enrollment_id, replica_id, video_id, channel_url, state, failure_code,
               duration_ms, audio_bytes, attestation_id, selected_window_start_ms,
               selected_window_length_ms, selected_window_score, score_source,
               transcript_chars, created_at`,
    [rid, ownerUserId, enrollmentId, videoId, channel.url, attestation.attestation_id, WINDOW_SCORE_SOURCE],
  );
  const row = created?.[0];
  // No row means one of two things and they are NOT the same: the replica is
  // not this owner's (a 404 that must not distinguish "yours" from "does not
  // exist" — an existence oracle over the uuid space), or this exact video is
  // already enrolled today (an idempotent no-op a double-click produces).
  if (!row) {
    const existing = await db(
      `select enrollment_id, replica_id, video_id, channel_url, state, failure_code,
              duration_ms, audio_bytes, attestation_id, selected_window_start_ms,
              selected_window_length_ms, selected_window_score, score_source,
              transcript_chars, created_at
         from vy_video_enrollment
        where owner_user_id = ($1)::uuid and video_id = $2
          and enrollment_day = current_date
        limit 1`,
      [ownerUserId, videoId],
    );
    if (existing?.[0]) return Object.freeze({ enrollment: clientRow(existing[0]), receipts, deduped: true });
    fail("replica_not_found", 404);
  }

  const mark = async (state, patch = {}) => {
    await db(
      `update vy_video_enrollment
          set state = $3, failure_code = coalesce($4, failure_code),
              duration_ms = coalesce(($5)::int8, duration_ms),
              audio_bytes = coalesce(($6)::int8, audio_bytes),
              object_path = coalesce($7, object_path),
              selected_window_start_ms = coalesce(($8)::int4, selected_window_start_ms),
              selected_window_length_ms = coalesce(($9)::int4, selected_window_length_ms),
              selected_window_score = coalesce(($10)::numeric, selected_window_score),
              transcript_chars = coalesce(($11)::int4, transcript_chars),
              receipts = coalesce(($12)::jsonb, receipts),
              updated_at = now()
        where enrollment_id = ($1)::uuid and owner_user_id = ($2)::uuid`,
      [enrollmentId, ownerUserId, state, patch.failureCode ?? null,
        patch.durationMs ?? null, patch.audioBytes ?? null, patch.objectPath ?? null,
        patch.windowStartMs ?? null, patch.windowLengthMs ?? null,
        patch.windowScore ?? null, patch.transcriptChars ?? null,
        patch.receipts ? JSON.stringify(patch.receipts) : null],
    );
  };

  // ── 3. extraction ──────────────────────────────────────────────────────
  // The step that is BLOCKED from Azure today. Its code is carried through
  // verbatim so `channel_extract_extractor_bot_check` reaches the studio as
  // itself; the studio has a state for it by name, and the owner is told the
  // truth ("YouTube refused our server, here is the upload path instead")
  // rather than "failed".
  let audio;
  const extractStarted = Date.now();
  try {
    audio = await deps.extractAudio({
      videoId,
      attestation: {
        receiptHash: attestation.receipt_hash,
        channelUrl: attestation.channel_url,
        expiresAt: attestation.expires_at,
      },
      ownerUserId,
      replicaId: rid,
      enrollmentId,
      maxDurationMs: limits.maxDurationMs,
    });
  } catch (error) {
    const code = String(error?.code || error?.message || "video_enroll_extract_failed");
    receipts.push(stageReceipt("extract", extractStarted, "failed", { failure_code: code }));
    await mark("failed", { failureCode: code, receipts });
    fail(code, Number.isInteger(error?.status) ? error.status : 502, { stage: "extract" });
  }
  receipts.push(stageReceipt("extract", extractStarted, "ok", {
    audio_bytes: Number(audio?.byteSize || 0), duration_ms: Number(audio?.durationMs || 0),
  }));

  // The caps are enforced a SECOND time, on the real numbers, because the
  // first check ran before anything knew how long the video was. A 90-minute
  // lecture that slipped past a metadata-free admission is refused here with
  // its real duration attached rather than silently processed.
  try {
    assertVideoEnrollAdmission({ usage, limits, durationMs: audio?.durationMs, byteSize: audio?.byteSize });
  } catch (error) {
    receipts.push(stageReceipt("admit_measured", extractStarted, "refused", { failure_code: error.code }));
    await mark("refused", { failureCode: error.code, durationMs: audio?.durationMs, audioBytes: audio?.byteSize, receipts });
    throw error;
  }
  await mark("scoring", { durationMs: audio.durationMs, audioBytes: audio.byteSize, objectPath: audio.storagePath, receipts });

  // ── 4. diarization, then the ranking ───────────────────────────────────
  // Diarization is OPTIONAL and its absence is carried as `null` purity, not
  // as an assumed 1.0 — see `speakerPurity`. A lane that assumed a single
  // speaker would happily condition the clone on a student's question.
  let segments = null;
  const diarizeStarted = Date.now();
  if (typeof deps.diarize === "function") {
    try {
      const result = await deps.diarize({ objectPath: audio.storagePath, ownerUserId, replicaId: rid });
      segments = Array.isArray(result?.segments) ? result.segments : null;
      receipts.push(stageReceipt("diarize", diarizeStarted, "ok", { segments: segments?.length || 0 }));
    } catch (error) {
      // A failed diarization degrades the ranking; it does not fail the lane.
      // The degradation is RECORDED so that a window chosen without purity
      // information is distinguishable later from one chosen with it.
      segments = null;
      receipts.push(stageReceipt("diarize", diarizeStarted, "degraded", {
        failure_code: String(error?.code || error?.message || "diarize_failed"),
      }));
    }
  }

  let ranking;
  const scoreStarted = Date.now();
  try {
    const bytes = await deps.fetchAudioBytes({ objectPath: audio.storagePath, ownerUserId, replicaId: rid });
    ranking = rankReferenceWindows(bytes, { segments, limit: 12 });
  } catch (error) {
    const code = error instanceof WindowScoringError
      ? error.code
      : String(error?.code || error?.message || "video_enroll_scoring_failed");
    receipts.push(stageReceipt("score_windows", scoreStarted, "failed", { failure_code: code }));
    await mark("failed", { failureCode: code, receipts });
    fail(code, Number.isInteger(error?.status) ? error.status : 500, { stage: "score_windows" });
  }
  if (!ranking.selected) {
    const code = "video_enroll_no_usable_window";
    receipts.push(stageReceipt("score_windows", scoreStarted, "failed", { failure_code: code }));
    await mark("failed", { failureCode: code, receipts });
    fail(code, 422, { stage: "score_windows", stats: ranking.stats });
  }
  receipts.push(stageReceipt("score_windows", scoreStarted, "ok", {
    windows_scored: ranking.stats.windows_scored,
    windows_eligible: ranking.stats.windows_eligible,
    selected_over_head_delta: ranking.stats.selected_over_head_delta,
  }));

  // Every candidate is STORED, not just the winner. Two reasons and both are
  // about the owner rather than about us: the studio can offer "try the next
  // best one" without re-extracting a 15-minute video, and the ranking is
  // auditable when a clone sounds wrong — which is the one moment anybody
  // will want to know what the alternatives were.
  // ONE statement for every candidate, expanded server-side from a single
  // jsonb parameter. A loop of N inserts over Neon's SQL-over-HTTP endpoint is
  // N round trips for a fixed, known-size list; `jsonb_to_recordset` is the
  // shape the rest of this repo already uses for the same reason. `window_id`
  // is `gen_random_uuid()` (built in since PG13) rather than a parallel array
  // parameter — pairing an array against a recordset by position is a join
  // waiting to be silently off by one.
  await db(
    `insert into vy_video_enrollment_window
       (window_id, enrollment_id, replica_id, owner_user_id, rank, start_ms, end_ms,
        score, voiced_fraction, snr_db, clipping_fraction, speaker_purity, score_source, metrics)
     select gen_random_uuid(), ($1)::uuid, ($2)::uuid, ($3)::uuid, w.rank, w.start_ms, w.end_ms,
            w.score, w.voiced_fraction, w.snr_db, w.clipping_fraction, w.speaker_purity, $4, w.metrics
       from jsonb_to_recordset(($5)::jsonb) as w(rank int4, start_ms int4, end_ms int4,
            score numeric, voiced_fraction numeric, snr_db numeric, clipping_fraction numeric,
            speaker_purity numeric, metrics jsonb)
     on conflict (enrollment_id, start_ms) do nothing`,
    [enrollmentId, rid, ownerUserId, WINDOW_SCORE_SOURCE,
      JSON.stringify(ranking.candidates.map((window) => ({ ...window, metrics: window })))],
  );

  // ── 5. the window becomes the replica's active voice reference ─────────
  // NOT by relaxing anything. `beginOwnedVoicePreview`'s fence requires an
  // `enhance`-stage artifact carrying a `selected` decision AND listed in the
  // genome's `references.enrollment_artifact_ids`. `promoteReference` creates
  // exactly those three facts for the chosen window and nothing else, so
  // "Preview my voice" speaks from this window through the same fence, the
  // same consents and the same liveness requirement as an uploaded reference.
  let promoted = null;
  const promoteStarted = Date.now();
  if (typeof deps.promoteReference === "function") {
    try {
      promoted = await deps.promoteReference({
        ownerUserId, replicaId: rid, enrollmentId,
        objectPath: audio.storagePath, window: ranking.selected,
      });
      receipts.push(stageReceipt("promote_reference", promoteStarted, "ok"));
    } catch (error) {
      // A reference that could not be promoted is the difference between "the
      // clone can speak" and "it cannot", so it is recorded loudly — but it
      // does not discard a successful extraction and transcript.
      receipts.push(stageReceipt("promote_reference", promoteStarted, "failed", {
        failure_code: String(error?.code || error?.message || "promote_reference_failed"),
      }));
    }
  }

  // ── 6. the transcript, and the sheet draft it feeds ────────────────────
  await mark("transcribing", {
    windowStartMs: ranking.selected.start_ms,
    windowLengthMs: ranking.selected.end_ms - ranking.selected.start_ms,
    windowScore: ranking.selected.score,
    receipts,
  });
  let transcript = null;
  let proposal = null;
  const asrStarted = Date.now();
  if (typeof deps.transcribe === "function") {
    try {
      transcript = await deps.transcribe({ objectPath: audio.storagePath, ownerUserId, replicaId: rid, durationMs: audio.durationMs });
      receipts.push(stageReceipt("transcribe", asrStarted, "ok", {
        turns: transcript?.turns?.length || 0, chars: String(transcript?.text || "").length,
      }));
    } catch (error) {
      transcript = null;
      receipts.push(stageReceipt("transcribe", asrStarted, "failed", {
        failure_code: String(error?.code || error?.message || "transcribe_failed"),
      }));
    }
  }
  if (transcript && typeof deps.proposeSheetDraft === "function") {
    const sheetStarted = Date.now();
    try {
      proposal = await deps.proposeSheetDraft({ ownerUserId, replicaId: rid, enrollmentId, transcript });
      receipts.push(stageReceipt("sheet_draft", sheetStarted, "ok", { proposed: proposal?.proposed ?? 0 }));
    } catch (error) {
      proposal = null;
      receipts.push(stageReceipt("sheet_draft", sheetStarted, "failed", {
        failure_code: String(error?.code || error?.message || "sheet_draft_failed"),
      }));
    }
  }

  await mark("ready", {
    transcriptChars: transcript ? String(transcript.text || "").length : null,
    receipts,
  });

  return Object.freeze({
    enrollment: clientRow({
      ...row,
      state: "ready",
      duration_ms: audio.durationMs,
      audio_bytes: audio.byteSize,
      selected_window_start_ms: ranking.selected.start_ms,
      selected_window_length_ms: ranking.selected.end_ms - ranking.selected.start_ms,
      selected_window_score: ranking.selected.score,
      transcript_chars: transcript ? String(transcript.text || "").length : null,
    }, ranking.candidates),
    stats: ranking.stats,
    rejected_windows: ranking.rejected,
    reference_promoted: Boolean(promoted),
    proposal,
    receipts,
  });
}

export async function listVideoEnrollments(db, ownerUserId, replicaIdValue, limit = 25) {
  const rid = replicaId(replicaIdValue);
  const rows = await db(
    `select enrollment_id, replica_id, video_id, channel_url, state, failure_code,
            duration_ms, audio_bytes, attestation_id, selected_window_start_ms,
            selected_window_length_ms, selected_window_score, score_source,
            transcript_chars, created_at
       from vy_video_enrollment
      where replica_id = ($1)::uuid and owner_user_id = ($2)::uuid
      order by created_at desc
      limit ($3)::int4`,
    [rid, ownerUserId, Math.max(1, Math.min(100, Number(limit) || 25))],
  );
  return rows.map((row) => clientRow(row));
}

export async function readVideoEnrollmentWindows(db, ownerUserId, enrollmentIdValue) {
  if (!UUID.test(String(enrollmentIdValue || ""))) fail("enrollment_id_invalid", 400);
  const rows = await db(
    `select rank, start_ms, end_ms, score, voiced_fraction, snr_db,
            clipping_fraction, speaker_purity, score_source
       from vy_video_enrollment_window
      where enrollment_id = ($1)::uuid and owner_user_id = ($2)::uuid
      order by rank asc
      limit 64`,
    [enrollmentIdValue, ownerUserId],
  );
  return rows.map((row) => ({
    rank: Number(row.rank),
    start_ms: Number(row.start_ms),
    end_ms: Number(row.end_ms),
    score: Number(row.score),
    voiced_fraction: Number(row.voiced_fraction),
    snr_db: Number(row.snr_db),
    clipping_fraction: Number(row.clipping_fraction),
    speaker_purity: row.speaker_purity == null ? null : Number(row.speaker_purity),
    score_source: row.score_source || WINDOW_SCORE_SOURCE,
  }));
}

export { VideoEnrollQuotaError };
