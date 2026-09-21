// videoEnrollApi.ts — the fetch wrapper for `/api/video-enroll` (WS-AD).
//
// The only file in the studio that knows a route or a JSON key for this lane,
// which is the shape `mirrorCallApi.ts` established: when the backend moves,
// exactly one file changes, and a contract mismatch is one diff rather than a
// hunt through a component tree.
import { replicaRequest } from "./replicaApi";

export type VideoEnrollState =
  | "admitted" | "extracting" | "scoring" | "transcribing" | "ready" | "refused" | "failed";

/** The chosen conditioning window. `start_ms` is the number the owner's
 *  complaint is about: if it is 0 the head of the video won on merit, and if
 *  it is not, the lane found something better somewhere else in the lecture. */
export interface ReferenceWindow {
  start_ms: number;
  end_ms: number;
  score: number | null;
  /** What produced the score. Today a WAV signal probe, NOT ECAPA fidelity. */
  score_source: string;
}

export interface RankedWindow extends ReferenceWindow {
  rank: number;
  voiced_fraction: number;
  snr_db: number;
  clipping_fraction: number;
  /** null means diarization did not run — NOT "one speaker". */
  speaker_purity: number | null;
}

export interface VideoEnrollment {
  enrollment_id: string;
  video_id: string;
  channel_url: string;
  state: VideoEnrollState;
  /** Named, always, when state is `refused` or `failed`. Never blank. */
  failure_code: string | null;
  duration_ms: number | null;
  audio_bytes: number | null;
  /** PRESENCE, never the id. */
  attested: boolean;
  reference_window: ReferenceWindow | null;
  transcript_chars: number | null;
  created_at: string | null;
  windows?: RankedWindow[];
}

export interface VideoEnrollLimits {
  perOwnerPerDay: number;
  maxDurationMs: number;
  maxAudioBytes: number;
  globalPerDay: number;
}

export interface VideoEnrollView {
  enrollments: VideoEnrollment[];
  limits: VideoEnrollLimits;
  /** Whether THIS deploy can extract at all. The screen renders the paste box
   *  as available or as a to-do from this rather than offering a button that
   *  answers 503. */
  extraction_configured: boolean;
}

export interface VideoEnrollReceipt {
  stage: string;
  outcome: "ok" | "failed" | "refused" | "degraded";
  elapsed_ms: number;
  failure_code?: string;
  [key: string]: unknown;
}

export interface VideoEnrollResult {
  enrollment: VideoEnrollment;
  stats?: {
    windows_scored: number;
    windows_eligible: number;
    head_window_rank: number | null;
    /** How much better than "just take the first ten seconds" this run did. */
    selected_over_head_delta: number | null;
    diarization_present: boolean;
  };
  reference_promoted: boolean;
  receipts: VideoEnrollReceipt[];
  deduped?: boolean;
}

/** The five statements the owner ticks. Mirrored from
 *  `CHANNEL_ATTESTATIONS` in api/_channel-watch.js — the server requires all
 *  five and refuses the request otherwise, so a screen that offered four
 *  would be a screen whose submit button cannot work. */
export const VIDEO_ATTESTATIONS = [
  "owns_or_controls_channel",
  "is_rights_holder_of_uploads",
  "authorizes_audio_extraction_for_own_replica",
  "understands_tos_exposure_is_not_copyright_permission",
  "understands_revocation_stops_extraction",
] as const;

export type VideoAttestation = (typeof VIDEO_ATTESTATIONS)[number];

export async function loadVideoEnrollments(token: string, replicaId: string): Promise<VideoEnrollView> {
  return replicaRequest<VideoEnrollView>(
    token,
    `/api/video-enroll?replica_id=${encodeURIComponent(replicaId)}`,
  );
}

export async function loadEnrollmentWindows(token: string, enrollmentId: string): Promise<RankedWindow[]> {
  const data = await replicaRequest<{ windows: RankedWindow[] }>(
    token,
    `/api/video-enroll?enrollment_id=${encodeURIComponent(enrollmentId)}`,
  );
  return data.windows || [];
}

export async function enrollFromVideoLink(
  token: string,
  replicaId: string,
  input: { videoUrl: string; channelUrl: string; attestations: Record<VideoAttestation, boolean> },
): Promise<VideoEnrollResult> {
  return replicaRequest<VideoEnrollResult>(token, "/api/video-enroll", {
    method: "POST",
    // A 15-minute video is an Azure container wake, a media download and a
    // batch ASR call. The default 20 s timeout in `replicaRequest` would abort
    // a request that is working, so this one is given the real budget.
    signal: AbortSignal.timeout(600_000),
    body: JSON.stringify({
      replica_id: replicaId,
      video_url: input.videoUrl,
      channel_url: input.channelUrl,
      attestations: input.attestations,
    }),
  });
}
